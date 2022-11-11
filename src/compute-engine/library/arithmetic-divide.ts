import { BoxedExpression, IComputeEngine } from '../public';
import { makePositive } from '../symbolic/utils';
import { canonicalNegate } from '../symbolic/negate';
import {
  asRational,
  inverse,
  isBigRational,
  isMachineRational,
  isRationalZero,
  mul,
} from '../numerics/rationals';
import { validateArgument } from '../boxed-expression/validate';

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
  op1 = validateArgument(ce, op1, 'Number');
  op2 = validateArgument(ce, op2, 'Number');

  if (!op1.isValid || !op2.isValid) return ce._fn('Divide', [op1, op2]);

  if (op1.isLiteral && op2.isLiteral) {
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return canonicalNegate(op1);
    if (op1.isOne) return ce.inverse(op2);
    if (op1.isNegativeOne) return canonicalNegate(ce.inverse(op2));
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isRationalZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  if (
    (op1.head === 'Divide' || op1.head === 'Rational') &&
    (op2.head === 'Divide' || op2.head === 'Rational')
  ) {
    return canonicalDivide(
      ce,
      ce.mul([op1.op1, op2.op2]),
      ce.mul([op1.op2, op2.op1])
    );
  }
  if (op1.isLiteral) {
    const r = op1.numericValue;
    if (isMachineRational(r)) {
      const [a, b] = r;
      return canonicalDivide(ce, ce.mul([ce.number(a), op2]), ce.number(b));
    }
    if (isBigRational(r)) {
      const [a, b] = r;
      return canonicalDivide(ce, ce.mul([ce.number(a), op2]), ce.number(b));
    }
  }
  if (op2.isLiteral) {
    const r = op2.numericValue;
    if (isMachineRational(r)) {
      const [a, b] = r;
      return canonicalDivide(ce, ce.mul([op1, ce.number(b)]), ce.number(a));
    }
    if (isBigRational(r)) {
      const [a, b] = r;
      return canonicalDivide(ce, ce.mul([op1, ce.number(b)]), ce.number(a));
    }
  }
  if (op1.head === 'Divide' || op1.head === 'Rational')
    return canonicalDivide(ce, ce.mul([op1.op1, op2]), op1.op2);
  if (op2.head === 'Divide' || op2.head === 'Rational')
    return canonicalDivide(ce, ce.mul([op1, op2.op2]), op2.op1);

  // eslint-disable-next-line prefer-const
  let [nSign, n] = makePositive(op1);
  // eslint-disable-next-line prefer-const
  let [dSign, d] = makePositive(op2);

  n = n.canonical;
  d = d.canonical;

  if (d.isLiteral && d.isOne) return nSign * dSign < 0 ? canonicalNegate(n) : n;

  // Divide: transform into multiply/power
  d = ce.inverse(d);
  if (n.isLiteral) {
    if (n.isOne) return d;
    if (n.isNegativeOne) return canonicalNegate(d);
  }
  if (nSign * dSign > 0) return ce.mul([n, d]);
  return canonicalNegate(ce.mul([n, d]));
}

/**
 * Simplify form of 'Divide' (and 'Rational')
 */

export function simplifyDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression | undefined {
  if (op1.isLiteral && op2.isLiteral) {
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isRationalZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  return undefined;
}
