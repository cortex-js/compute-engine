import { BoxedExpression, IComputeEngine } from '../public';
import { apply2N, makePositive } from '../symbolic/utils';
import { canonicalNegate } from '../symbolic/negate';
import {
  asRational,
  inverse,
  isBigRational,
  isMachineRational,
  isRationalZero,
  mul,
} from '../numerics/rationals';
import { asCoefficient } from '../numerics/factor';
import { Product } from '../symbolic/product';

/**
 * Canonical form of 'Divide' (and 'Rational')
 * - remove denominator of 1
 * - simplify the signs
 * - factor out negate (make the numerator and denominator positive)
 * - if numerator and denominator are integer literals, return a rational number
 *   or Rational experssion
 * - if Divide, transform into Multiply/Power
 */
export function canonicalDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  if (!op1.isValid || !op2.isValid) return ce._fn('Divide', [op1, op2]);

  if (op1.head === 'Negate' && op2.head === 'Negate') {
    op1 = op1.op1;
    op2 = op2.op1;
  }

  if (op1.numericValue !== null && op2.numericValue !== null) {
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return ce.neg(op1);
    if (op1.isOne) return ce.inv(op2);
    if (op1.isNegativeOne) return ce.neg(ce.inv(op2));
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isRationalZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  if (op1.head === 'Divide' && op2.head === 'Divide') {
    return canonicalDivide(
      ce,
      ce.mul(op1.op1, op2.op2),
      ce.mul(op1.op2, op2.op1)
    );
  }
  if (op1.head === 'Divide')
    return canonicalDivide(ce, ce.mul(op1.op1, op2), op1.op2);
  if (op2.head === 'Divide')
    return canonicalDivide(ce, ce.mul(op1, op2.op2), op2.op1);

  const num1 = op1.numericValue;
  if (num1 !== null) {
    if (isMachineRational(num1)) {
      const [a, b] = num1;
      return canonicalDivide(ce, ce.number(a), ce.mul(ce.number(b), op2));
    }
    if (isBigRational(num1)) {
      const [a, b] = num1;
      return canonicalDivide(ce, ce.number(a), ce.mul(ce.number(b), op2));
    }
  }
  const num2 = op2.numericValue;
  if (num2 !== null) {
    if (isMachineRational(num2)) {
      const [a, b] = num2;
      return canonicalDivide(ce, ce.mul(op1, ce.number(b)), ce.number(a));
    }
    if (isBigRational(num2)) {
      const [a, b] = num2;
      return canonicalDivide(ce, ce.mul(op1, ce.number(b)), ce.number(a));
    }
  }

  const [c1, t1] = asCoefficient(op1);
  const [c2, t2] = asCoefficient(op2);
  if (!c1.isOne || !c2.isOne) {
    const c = ce.div(c1, c2);
    const r = asRational(c);
    if (r) {
      const [n, d] = r;
      let [nt, dt] = [ce.mul(ce.number(n), t1), ce.mul(ce.number(d), t2)];
      if (dt.isNegative) {
        dt = ce.neg(dt);
        nt = ce.neg(nt);
      }
      if (dt.head === 'Negate') {
        dt = dt.op1;
        nt = ce.neg(nt);
      }
      if (nt.isZero) return ce.Zero;
      if (dt.isOne) return nt;
      return ce._fn('Divide', [nt, dt]);
    }

    const en = ce.mul(c, t1);
    if (en.isZero) return ce.Zero;
    if (t2.isOne) return en;
    return ce._fn('Divide', [en, t2]);
  }

  // eslint-disable-next-line prefer-const
  let [nSign, n] = makePositive(op1);
  // eslint-disable-next-line prefer-const
  let [dSign, d] = makePositive(op2);

  n = n.canonical;
  d = d.canonical;

  if (d.numericValue !== null && d.isOne)
    return nSign * dSign < 0 ? canonicalNegate(n) : n;

  if (nSign * dSign > 0) return ce._fn('Divide', [n, d]);
  if (n.numericValue) return ce._fn('Divide', [canonicalNegate(n), d]);
  return canonicalNegate(ce._fn('Divide', [n, d]));
}

/**
 * Simplify form of 'Divide' (and 'Rational')
 */

export function simplifyDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression | undefined {
  if (op1.numericValue !== null && op2.numericValue !== null) {
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isRationalZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  return new Product(ce, [op1, ce.inv(op2)]).asRationalExpression();
}

export function evalDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  let result = simplifyDivide(ce, op1, op2);
  if (result?.head === 'Divide') {
    if (!result.op1.isExact || !result.op2.isExact) {
      result =
        apply2N(
          op1,
          op2,
          (n, d) => n / d,
          (n, d) => n.div(d),
          (n, d) => n.div(d)
        ) ?? result;
    }
  }

  if (result !== undefined) return result;

  return ce._fn('Divide', [op1, op2]);
}
