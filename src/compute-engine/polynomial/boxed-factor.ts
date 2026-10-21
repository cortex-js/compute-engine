import { checkDeadline } from '../../common/interruptible.js';
import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import { factorRationalPolynomial } from './factor-rational.js';

/** Read a bounded polynomial without expanding general symbolic expressions. */
export function rationalPolynomialCoefficients(
  expr: Expression,
  variable: string,
  maxDegree = 128
): RationalCoefficient[] | null {
  const work = new PolynomialWork(100_000, () =>
    checkDeadline(expr.engine._deadlineFrame)
  );
  const P = new FieldPolynomials(Q, work);
  const read = (e: Expression, depth: number): RationalCoefficient[] | null => {
    work.tick();
    if (depth > 128) return null;
    if (isNumber(e)) {
      if (!e.isExact || !e.isRational) return null;
      return P.trim([
        q(BigInt(e.numerator.toString()), BigInt(e.denominator.toString())),
      ]);
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
          return null;
        r = e.operator === 'Add' ? P.add(r, a) : P.mul(r, a);
      }
      return r.length - 1 <= maxDegree ? r : null;
    }
    if (e.operator === 'Divide') {
      const a = read(e.op1, depth + 1),
        b = read(e.op2, depth + 1);
      return a && b?.length === 1 ? P.scale(a, Q.inv(b[0])) : null;
    }
    if (e.operator === 'Power') {
      if (!isNumber(e.op2) || !e.op2.isExact || !e.op2.isInteger) return null;
      const exponent = e.op2.re;
      if (
        !Number.isSafeInteger(exponent) ||
        exponent < 0 ||
        exponent > maxDegree
      )
        return null;
      const a = read(e.op1, depth + 1);
      if (!a || (a.length - 1) * exponent > maxDegree) return null;
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
    if (e instanceof PolynomialBudgetExceeded) return null;
    throw e;
  }
}

export function factorRationalExpression(
  expr: Expression,
  variable: string
): Expression | null {
  const input = rationalPolynomialCoefficients(expr, variable);
  if (!input) return null;
  const result = factorRationalPolynomial(input, {
    check: () => checkDeadline(expr.engine._deadlineFrame),
  });
  if (result.status === 'incomplete') return null;
  const ce = expr.engine;
  if (result.status === 'zero') return ce.Zero;
  const scalar = ce
    .number(result.coefficient.numerator)
    .div(ce.number(result.coefficient.denominator));
  const factors = [scalar];
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
    factors.push(
      f.multiplicity === 1
        ? polynomial
        : ce.function('Power', [polynomial, ce.number(f.multiplicity)])
    );
  }
  return ce.function('Multiply', factors);
}
