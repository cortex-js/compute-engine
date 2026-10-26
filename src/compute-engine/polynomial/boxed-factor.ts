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
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import {
  factorRationalPolynomial,
  type RationalFactorOptions,
  type RationalFactorization,
} from './factor-rational.js';
import type { FactorizationResult } from '../factoring-types.js';

/** Read a bounded polynomial without expanding general symbolic expressions. */
export function rationalPolynomialCoefficients(
  expr: Expression,
  variable: string,
  maxDegree = 128,
  throwOnLimit = false
): RationalCoefficient[] | null {
  checkDeadline(expr.engine._deadlineFrame);
  const work = new PolynomialWork(100_000, () =>
    checkDeadlineEvery(expr.engine._deadlineFrame, 0x3ff)
  );
  const P = new FieldPolynomials(Q, work);
  const read = (e: Expression, depth: number): RationalCoefficient[] | null => {
    work.tick();
    if (depth > 128)
      throw new PolynomialBudgetExceeded('conversion-depth-limit');
    if (isNumber(e)) {
      if (!e.isExact || !e.isRational) return null;
      // Read exact coefficients, not their scientific-notation rendering or
      // working-precision decimal projection.
      const rational = asRational(e);
      if (!rational) return null;
      const numerator = bigint(rational[0]),
        denominator = bigint(rational[1]);
      if (numerator === null || denominator === null) return null;
      return P.trim([q(numerator, denominator)]);
    }
    if (sym(e) === variable) return [Q.zero, Q.one];
    if (!isFunction(e)) return null;
    if (e.operator === 'Negate') {
      const a = read(e.op1, depth + 1);
      return a && P.scale(a, q(-1n));
    }
    if (e.operator === 'Add' || e.operator === 'Multiply') {
      let r: RationalCoefficient[] = e.operator === 'Add' ? [] : [Q.one];
      for (const op of e.ops) {
        const a = read(op, depth + 1);
        if (!a) return null;
        if (e.operator === 'Multiply' && r.length + a.length - 2 > maxDegree)
          throw new PolynomialBudgetExceeded('degree-limit');
        r = e.operator === 'Add' ? P.add(r, a) : P.mul(r, a);
      }
      if (r.length - 1 > maxDegree)
        throw new PolynomialBudgetExceeded('degree-limit');
      return r;
    }
    if (e.operator === 'Divide') {
      const a = read(e.op1, depth + 1),
        b = read(e.op2, depth + 1);
      return a && b?.length === 1 ? P.scale(a, Q.inv(b[0])) : null;
    }
    if (e.operator === 'Power') {
      if (!isNumber(e.op2) || !e.op2.isExact || !e.op2.isInteger) return null;
      const exponent = e.op2.re;
      if (!Number.isSafeInteger(exponent) || exponent < 0) return null;
      if (exponent > maxDegree)
        throw new PolynomialBudgetExceeded('degree-limit');
      // Expanded polynomials contain many x^n terms. Construct each monomial
      // directly instead of repeatedly convolving dense arrays of zeros.
      if (sym(e.op1) === variable) {
        work.tick(exponent + 1);
        return [...Array<RationalCoefficient>(exponent).fill(Q.zero), Q.one];
      }
      const a = read(e.op1, depth + 1);
      if (!a) return null;
      if ((a.length - 1) * exponent > maxDegree)
        throw new PolynomialBudgetExceeded('degree-limit');
      let r = [Q.one],
        b = a,
        n = exponent;
      while (n) {
        if (n % 2) r = P.mul(r, b);
        n = Math.floor(n / 2);
        if (n) b = P.mul(b, b);
      }
      return r;
    }
    return null;
  };
  try {
    return read(expr, 0);
  } catch (e) {
    if (!throwOnLimit && e instanceof PolynomialBudgetExceeded) return null;
    throw e;
  }
}

export function factorRationalExpression(
  expr: Expression,
  variable: string
): Expression | null {
  const r = factorRationalExpressionDetailed(expr, variable);
  return r.status === 'complete' || r.status === 'zero' ? r.expression : null;
}

/** Exact rational factoring without treating structural rewrites as certificates. */
export function factorRationalExpressionDetailed(
  expr: Expression,
  variable: string,
  options: RationalFactorOptions = {}
): FactorizationResult {
  const ce = expr.engine;
  const base = {
    domain: 'QQ' as const,
    variable,
    // A refused request stays unevaluated. It is bound, as the result of the
    // `Factor` operator is, so that arithmetic on it does not throw.
    expression: ce._fn('Factor', [expr.canonical, ce.symbol(variable)]),
  };
  let input: RationalCoefficient[] | null;
  try {
    input = rationalPolynomialCoefficients(
      expr,
      variable,
      Math.min(options.maxDegree ?? 128, 128),
      true
    );
  } catch (e) {
    if (e instanceof PolynomialBudgetExceeded)
      return {
        ...base,
        status: 'incomplete',
        reason: e.reason,
        stage: 'conversion',
      };
    throw e;
  }
  if (!input)
    return {
      ...base,
      status: expr.isValid ? 'unsupported' : 'invalid',
      reason: 'unsupported-polynomial',
      stage: 'conversion',
    };
  let result: RationalFactorization;
  try {
    result = factorRationalPolynomial(input, {
      ...options,
      check: () => checkDeadlineEvery(expr.engine._deadlineFrame, 0x3ff),
    });
  } catch (e) {
    if (e instanceof PolynomialBudgetExceeded)
      return {
        ...base,
        status: 'incomplete',
        reason: e.reason,
        stage: 'factorization',
      };
    throw e;
  }
  // An unfinished certificate does not rule out useful factors from the
  // existing rational-root fallback in factorPolynomial().
  const statistics = {
    operations: result.statistics.operations,
    phases: result.statistics.phases,
  };
  if (result.status === 'incomplete')
    return {
      ...base,
      status: 'incomplete',
      reason: result.reason ?? 'uncertified',
      stage: 'factorization',
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
  const scalar = ce
    .number(result.coefficient.numerator)
    .div(ce.number(result.coefficient.denominator));
  const factors: { factor: Expression; multiplicity: number }[] = [];
  for (const f of result.factors) {
    const terms: Expression[] = [];
    for (let i = 0; i < f.coefficients.length; i++) {
      const c = f.coefficients[i];
      if (c === 0n) continue;
      terms.push(
        i === 0
          ? ce.number(c)
          : ce.function('Multiply', [
              ce.number(c),
              i === 1
                ? ce.symbol(variable)
                : ce.function('Power', [ce.symbol(variable), ce.number(i)]),
            ])
      );
    }
    const polynomial = ce.function('Add', terms);
    factors.push({ factor: polynomial, multiplicity: f.multiplicity });
  }
  return {
    ...base,
    status: 'complete',
    coefficient: scalar,
    factors,
    statistics,
    expression: ce.function('Multiply', [
      scalar,
      ...factors.map((f) =>
        f.multiplicity === 1
          ? f.factor
          : ce.function('Power', [f.factor, ce.number(f.multiplicity)])
      ),
    ]),
  };
}
