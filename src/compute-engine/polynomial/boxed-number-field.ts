import {
  checkDeadline,
  checkDeadlineEvery,
} from '../../common/interruptible.js';
import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { bigint } from '../numerics/bigint.js';
import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import {
  RationalNumberField,
  factorNumberFieldPolynomial,
  type NumberFieldElement,
  type NumberFieldFactorOptions,
} from './number-field.js';
import { NumberFieldWork } from './number-field-work.js';

function rational(e: Expression): RationalCoefficient | undefined {
  if (!isNumber(e) || !e.isExact || !e.isRational) return undefined;
  const r = asRational(e);
  if (!r) return undefined;
  const n = bigint(r[0]),
    d = bigint(r[1]);
  return n === null || d === null ? undefined : q(n, d);
}

/** An explicit abstract generator, or a root of a rational binomial. */
function definingPolynomial(g: Expression): RationalCoefficient[] | undefined {
  if (isFunction(g, 'AlgebraicGenerator')) {
    if (g.ops.length !== 1 || !isFunction(g.op1, 'List')) return undefined;
    if (g.op1.ops.length < 2 || g.op1.ops.length > 129) return undefined;
    // Lazy operands can still contain Rational/Divide function nodes. Their
    // canonical form is exact; numerical evaluation would lose the relation.
    const coefficients = g.op1.ops.map((c) => rational(c.canonical));
    if (coefficients.some((c) => c === undefined)) return undefined;
    return coefficients as RationalCoefficient[];
  }
  const r = rational(g);
  if (r) return [Q.neg(r), Q.one];
  // Canonical exact square roots and i can be boxed numbers rather than
  // function nodes. Squaring them exactly avoids a floating-point projection.
  if (isNumber(g) && g.isExact) {
    const square = rational(g.mul(g));
    if (square) return [Q.neg(square), Q.zero, Q.one];
  }
  if (sym(g) === 'ImaginaryUnit') return [Q.one, Q.zero, Q.one];
  if (!isFunction(g)) return undefined;
  let degree: number | undefined;
  if (g.operator === 'Sqrt') degree = 2;
  else if (g.operator === 'Root') {
    const n = rational(g.op2);
    if (n?.denominator === 1n) degree = Number(n.numerator);
  } else if (g.operator === 'Power') {
    const n = rational(g.op2);
    if (n?.numerator === 1n) degree = Number(n.denominator);
  }
  if (!degree || !Number.isSafeInteger(degree) || degree < 2 || degree > 128)
    return undefined;
  const base = rational(g.op1);
  if (!base) return undefined;
  return [
    Q.neg(base),
    ...Array<RationalCoefficient>(degree - 1).fill(Q.zero),
    Q.one,
  ];
}

/** Validate the abstract generator without choosing a complex embedding. */
export function validateAlgebraicGenerator(
  g: Expression
): Expression | undefined {
  const ce = g.engine;
  checkDeadline(ce._deadlineFrame);
  try {
    const polynomial = definingPolynomial(g);
    if (!polynomial) return ce.error('invalid-algebraic-generator');
    RationalNumberField.create(polynomial, {
      check: () => checkDeadlineEvery(ce._deadlineFrame, 0x3ff),
    });
  } catch (e) {
    if (e instanceof PolynomialBudgetExceeded) return undefined;
    if (e instanceof RangeError) return ce.error('invalid-algebraic-generator');
    throw e;
  }
  return undefined;
}

/**
 * Bridge Factor to exact Q(alpha)[x]. Undefined means the request stays
 * unevaluated; it must not silently fall back to a different coefficient field.
 */
export function factorNumberFieldExpression(
  expr: Expression,
  variable: string,
  generator: Expression,
  options: NumberFieldFactorOptions = {}
): Expression | undefined {
  const ce = expr.engine;
  checkDeadline(ce._deadlineFrame);
  let interrupted = false;
  const check = () => {
    try {
      checkDeadlineEvery(ce._deadlineFrame, 0x3ff);
      options.check?.();
    } catch (e) {
      interrupted = true;
      throw e;
    }
  };
  try {
    const modulus = definingPolynomial(generator);
    if (!modulus) return undefined;
    const field = RationalNumberField.create(modulus, { ...options, check });
    const work = new NumberFieldWork(100_000, check, false, 16384);
    const K = field.withWork(work);
    const P = new FieldPolynomials(K, work);
    const maxDegree = Math.min(options.maxDegree ?? 128, 128);
    const scalar = (r: RationalCoefficient): NumberFieldElement =>
      field.element([work.rational.add(r, Q.zero)], work);
    const read = (
      e: Expression,
      depth = 0
    ): NumberFieldElement[] | undefined => {
      work.tick();
      if (depth > 128 || !e.isValid) return undefined;
      if (e.isSame(generator)) return [field.generator];
      if (
        (e.operator === 'Sqrt' ||
          e.operator === 'Root' ||
          sym(e) === 'ImaginaryUnit') &&
        e.canonical.isSame(generator)
      )
        return [field.generator];
      const r = rational(e);
      if (r) return P.trim([scalar(r)]);
      if (sym(e) === variable) return [K.zero, K.one];
      // Unpack exact numeric atoms to their symbolic arithmetic representation.
      // Non-rational atoms cannot be converted using .re/.im without rounding.
      if (isNumber(e)) {
        if (!e.isExact) return undefined;
        if (field.degree === 2 && isNumber(generator)) {
          const multiple = rational(e.div(generator));
          if (multiple) return [K.mul(scalar(multiple), field.generator)];
        }
        const unpacked = ce.expr(e.json, { form: 'raw' });
        if (!isFunction(unpacked)) return undefined;
        return read(unpacked, depth + 1);
      }
      if (!isFunction(e)) return undefined;
      if (e.operator === 'Complex' && e.ops.length === 2) {
        return read(
          ce.function(
            'Add',
            [
              e.op1,
              ce.function('Multiply', [e.op2, ce.symbol('ImaginaryUnit')], {
                form: 'raw',
              }),
            ],
            { form: 'raw' }
          ),
          depth + 1
        );
      }
      if (e.operator === 'Negate') {
        const a = read(e.op1, depth + 1);
        return a && P.scale(a, K.fromInteger(-1n));
      }
      if (e.operator === 'Add' || e.operator === 'Multiply') {
        let result: NumberFieldElement[] = e.operator === 'Add' ? [] : [K.one];
        for (const op of e.ops) {
          const a = read(op, depth + 1);
          if (!a) return undefined;
          if (
            e.operator === 'Multiply' &&
            result.length + a.length - 2 > maxDegree
          )
            return undefined;
          result = e.operator === 'Add' ? P.add(result, a) : P.mul(result, a);
        }
        return result.length - 1 <= maxDegree ? result : undefined;
      }
      if (e.operator === 'Divide') {
        const a = read(e.op1, depth + 1),
          b = read(e.op2, depth + 1);
        return a && b?.length === 1 ? P.scale(a, K.inv(b[0])) : undefined;
      }
      if (e.operator === 'Power') {
        const exponent = rational(e.op2);
        if (
          !exponent ||
          exponent.denominator !== 1n ||
          exponent.numerator < -128n ||
          exponent.numerator > 128n
        )
          return undefined;
        let n = Number(exponent.numerator);
        let a = read(e.op1, depth + 1);
        if (!a || (a.length - 1) * Math.abs(n) > maxDegree) return undefined;
        if (n < 0) {
          if (a.length !== 1) return undefined;
          a = [K.inv(a[0])];
          n = -n;
        }
        let result = [K.one];
        while (n) {
          if (n % 2) result = P.mul(result, a);
          n = Math.floor(n / 2);
          if (n) a = P.mul(a, a);
        }
        return result;
      }
      return undefined;
    };
    const input = read(expr);
    if (!input) return undefined;
    const result = factorNumberFieldPolynomial(field, input, {
      ...options,
      check,
    });
    if (result.status === 'incomplete') return undefined;
    if (result.status === 'zero') return ce.Zero;
    const power = (base: Expression, n: number): Expression =>
      n === 0
        ? ce.One
        : n === 1
          ? base
          : ce.function('Power', [base, ce.number(n)]);
    const coefficient = (a: NumberFieldElement): Expression =>
      ce.function(
        'Add',
        a.coefficients.flatMap((c, i) =>
          c.numerator === 0n
            ? []
            : [
                ce.function('Multiply', [
                  ce.number(c.numerator).div(ce.number(c.denominator)),
                  power(generator, i),
                ]),
              ]
        )
      );
    return ce.function('Multiply', [
      coefficient(result.coefficient),
      ...result.factors.map((f) =>
        power(
          ce.function(
            'Add',
            f.coefficients.flatMap((c, i) =>
              field.isZero(c)
                ? []
                : [
                    ce.function('Multiply', [
                      coefficient(c),
                      power(ce.symbol(variable), i),
                    ]),
                  ]
            )
          ),
          f.multiplicity
        )
      ),
    ]);
  } catch (e) {
    if (interrupted) throw e;
    if (e instanceof PolynomialBudgetExceeded) return undefined;
    // Malformed/reducible defining polynomials and division by zero are not
    // certificates. Leave the explicit-domain request intact for inspection.
    if (e instanceof RangeError) return undefined;
    throw e;
  }
}
