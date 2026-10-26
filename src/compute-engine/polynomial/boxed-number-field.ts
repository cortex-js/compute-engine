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
import type { FactorizationResult } from '../factoring-types.js';

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
    if (g.ops.length !== 1) return undefined;
    // The operand of a lazy operator arrives unbound on the parse route:
    // `AlgebraicGenerator([-2, 0, 1])` holds `Delimiter(List(…))`. The
    // canonical form removes the delimiter and keeps the entries exact.
    const list = g.op1.canonical;
    if (!isFunction(list, 'List')) return undefined;
    if (list.ops.length < 2 || list.ops.length > 129) return undefined;
    // Lazy operands can still contain Rational/Divide function nodes. Their
    // canonical form is exact; numerical evaluation would lose the relation.
    const coefficients = list.ops.map((c) => rational(c.canonical));
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

/**
 * The fields whose defining polynomial was proved irreducible, by the text of
 * that polynomial made monic (so `2t² - 4` and `t² - 2` share an entry). Each
 * `AlgebraicGenerator` evaluation, each reduced power of a generator and each
 * `Factor` call with a field argument needs the field, and the proof is a
 * complete rational factorization of the polynomial. A `RationalNumberField`
 * is immutable and does not depend on an engine, so one instance serves every
 * call. Only a successful proof is kept; the oldest entry is removed when the
 * cache is full. A call that finds its field here does not spend its own
 * budget on the proof: the proof does not depend on the budget once it
 * succeeded.
 */
const certifiedFields = new Map<string, RationalNumberField>();
const MAX_CERTIFIED_FIELDS = 64;

function certifiedField(
  polynomial: readonly RationalCoefficient[],
  options: NumberFieldFactorOptions
): RationalNumberField {
  const key = new FieldPolynomials(Q)
    .monic(polynomial)
    .map((c) => `${c.numerator}/${c.denominator}`)
    .join(',');
  const cached = certifiedFields.get(key);
  if (cached) return cached;
  const field = RationalNumberField.create(polynomial, options);
  if (certifiedFields.size >= MAX_CERTIFIED_FIELDS)
    certifiedFields.delete(certifiedFields.keys().next().value!);
  certifiedFields.set(key, field);
  return field;
}

/**
 * The field of an `AlgebraicGenerator` whose defining polynomial is proved
 * irreducible, or `undefined`: the descriptor is malformed or reducible, or
 * the proof does not finish within the default budget. A cancellation by the
 * deadline is not caught.
 */
export function certifiedGeneratorField(
  g: Expression
): RationalNumberField | undefined {
  if (!isFunction(g, 'AlgebraicGenerator')) return undefined;
  const polynomial = definingPolynomial(g);
  if (!polynomial) return undefined;
  const ce = g.engine;
  try {
    return certifiedField(polynomial, {
      check: () => checkDeadlineEvery(ce._deadlineFrame, 0x3ff),
    });
  } catch (e) {
    if (e instanceof PolynomialBudgetExceeded || e instanceof RangeError)
      return undefined;
    throw e;
  }
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
    certifiedField(polynomial, {
      check: () => checkDeadlineEvery(ce._deadlineFrame, 0x3ff),
    });
  } catch (e) {
    // A defining polynomial too large to certify within the budget is not
    // checked here. `Factor` certifies the field again with its own budget,
    // and never factors over a field it could not certify.
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
  const r = factorNumberFieldExpressionDetailed(
    expr,
    variable,
    generator,
    options
  );
  return r.status === 'complete' || r.status === 'zero'
    ? r.expression
    : undefined;
}

/** The expression bridge and diagnostics share conversion, limits and certificates. */
export function factorNumberFieldExpressionDetailed(
  expr: Expression,
  variable: string,
  generator: Expression,
  options: NumberFieldFactorOptions = {}
): FactorizationResult {
  const ce = expr.engine;
  checkDeadline(ce._deadlineFrame);
  const base = {
    domain: 'NumberField' as const,
    variable,
    generator,
    expression: ce.function('Factor', [expr, ce.symbol(variable), generator], {
      form: 'raw',
    }),
  };
  let stage: 'field-certification' | 'conversion' | 'factorization' =
    'field-certification';
  const refused = (
    status: 'incomplete' | 'unsupported' | 'invalid',
    reason: string
  ): FactorizationResult => ({ ...base, status, reason, stage });
  // The first exception thrown by the deadline or by the caller's `check`.
  // The certification of the field can catch it and throw a different
  // budget exception, so the original is kept here and rethrown.
  let interruption: { error: unknown } | undefined;
  const check = () => {
    try {
      checkDeadlineEvery(ce._deadlineFrame, 0x3ff);
      options.check?.();
    } catch (e) {
      interruption ??= { error: e };
      throw e;
    }
  };
  // Public expression factoring uses a larger default than the kernel.
  // Certification and factoring each receive this limit; it is not a shared
  // end-to-end budget. Cached field certificates do not spend it again.
  const maxOperations = options.maxOperations ?? 20_000_000;
  try {
    if (!expr.isValid || !generator.isValid)
      return refused('invalid', 'invalid-expression');
    const modulus = definingPolynomial(generator);
    if (!modulus) return refused('unsupported', 'unsupported-generator');
    const field = certifiedField(modulus, {
      ...options,
      maxOperations,
      check,
    });
    stage = 'conversion';
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
      if (depth > 128)
        throw new PolynomialBudgetExceeded('conversion-depth-limit');
      if (!e.isValid) return undefined;
      if (e.isSame(generator)) return [field.generator];
      if (
        (e.operator === 'Sqrt' ||
          e.operator === 'Root' ||
          sym(e) === 'ImaginaryUnit') &&
        e.canonical.isSame(generator)
      )
        return [field.generator];
      // An unpacked exact complex number holds raw `Rational` nodes:
      // `3/4 + i` is `Complex(Rational(3, 4), 1)`.
      const r = rational(isFunction(e, 'Rational') ? e.canonical : e);
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
            throw new PolynomialBudgetExceeded('degree-limit');
          result = e.operator === 'Add' ? P.add(result, a) : P.mul(result, a);
        }
        if (result.length - 1 > maxDegree)
          throw new PolynomialBudgetExceeded('degree-limit');
        return result;
      }
      if (e.operator === 'Divide') {
        const a = read(e.op1, depth + 1),
          b = read(e.op2, depth + 1);
        return a && b?.length === 1 ? P.scale(a, K.inv(b[0])) : undefined;
      }
      if (e.operator === 'Power') {
        const exponent = rational(e.op2);
        if (!exponent || exponent.denominator !== 1n) return undefined;
        if (exponent.numerator < -128n || exponent.numerator > 128n)
          throw new PolynomialBudgetExceeded('degree-limit');
        let n = Number(exponent.numerator);
        // Expanded inputs contain many monomials. Read x^n directly instead
        // of repeatedly convolving dense arrays containing mostly zeros.
        if (sym(e.op1) === variable && n >= 0) {
          if (n > maxDegree) throw new PolynomialBudgetExceeded('degree-limit');
          work.tick(n + 1);
          return [...Array<NumberFieldElement>(n).fill(K.zero), K.one];
        }
        let a = read(e.op1, depth + 1);
        if (!a) return undefined;
        if ((a.length - 1) * Math.abs(n) > maxDegree)
          throw new PolynomialBudgetExceeded('degree-limit');
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
    if (!input)
      return refused(
        expr.isValid ? 'unsupported' : 'invalid',
        'unsupported-polynomial'
      );
    stage = 'factorization';
    const result = factorNumberFieldPolynomial(field, input, {
      ...options,
      maxOperations,
      check,
    });
    // A failed internal check (an exact product or congruence that does not
    // hold) also gives `incomplete`, so that no wrong factorization is
    // returned. It is a defect, not a limit: make it visible in development.
    console.assert(
      result.reason !== 'verification-failed',
      'Number field factorization failed an internal verification'
    );
    const statistics = {
      operations: result.operations,
      phases: result.statistics.phases,
      direct: result.statistics.direct,
      norms: result.statistics.norms,
    };
    if (result.status === 'incomplete')
      return {
        ...base,
        status: 'incomplete',
        reason: result.reason ?? 'uncertified',
        stage,
        statistics,
      };
    if (result.status === 'zero')
      return {
        ...base,
        status: 'zero',
        expression: ce.Zero,
        coefficient: ce.Zero,
        factors: [],
        statistics,
      };
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
    const factors = result.factors.map((f) => ({
      factor: ce.function(
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
      multiplicity: f.multiplicity,
    }));
    const content = coefficient(result.coefficient);
    return {
      ...base,
      status: 'complete',
      coefficient: content,
      factors,
      statistics,
      expression: ce.function('Multiply', [
        content,
        ...factors.map((f) => power(f.factor, f.multiplicity)),
      ]),
    };
  } catch (e) {
    if (interruption) throw interruption.error;
    if (e instanceof PolynomialBudgetExceeded)
      return refused('incomplete', e.reason);
    // Malformed/reducible defining polynomials and division by zero are not
    // certificates. Leave the explicit-domain request intact for inspection.
    if (e instanceof RangeError)
      return refused('invalid', 'invalid-field-or-coefficient');
    throw e;
  }
}
