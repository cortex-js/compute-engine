import { BoxedExpression, IComputeEngine } from '../public';
import { makePositive } from '../symbolic/utils';
import { canonicalNegate } from '../symbolic/negate';
import { reducedRational } from '../numerics/numeric';

/**
 * Canonical form of 'Divide' (and 'Rational')
 * - remove denominator of 1
 * - simplify the signs
 * - factor out negate (make the numerator and denominator positive)
 * - if Divide, transform into Multiply/Power
 */
export function canonicalDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  if (op1.isLiteral && op2.isLiteral) {
    if (op1.isOne) return ce.inverse(op2);
    if (op1.isNegativeOne) return canonicalNegate(ce.inverse(op2));
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return canonicalNegate(op1);

    const [n, d] = [op1.asSmallInteger, op2.asSmallInteger];
    if (n !== null && d !== null && d !== 0)
      return ce.number(reducedRational([n, d]));
  }

  if (op1.head === 'Divide' && op2.head === 'Divide') {
    return ce.divide(ce.mul([op1.op1, op2.op2]), ce.mul([op1.op2, op2.op1]));
  }
  if (op1.head === 'Divide') return ce.divide(ce.mul([op1.op1, op2]), op1.op2);
  if (op2.head === 'Divide') return ce.divide(ce.mul([op1, op2.op2]), op2.op1);

  // eslint-disable-next-line prefer-const
  let [nSign, n] = makePositive(op1);
  // eslint-disable-next-line prefer-const
  let [dSign, d] = makePositive(op2);

  n = n.canonical;
  d = d.canonical;

  if (d.isLiteral && d.isOne) return nSign * dSign < 0 ? canonicalNegate(n) : n;

  // Divide: transform into multiply/power
  d = ce.inverse(d);
  if (n.isOne) return d;
  if (n.isNegativeOne) return canonicalNegate(d);
  if (nSign * dSign > 0) return ce.mul([n, d]);
  return ce.negate(ce.mul([n, d]));
}
