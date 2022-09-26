import { BoxedExpression, IComputeEngine } from '../public';
import { makePositive } from '../symbolic/utils';
import { canonicalNegate } from '../symbolic/negate';
import { reducedRational } from '../numerics/numeric';
import {
  isInMachineRange,
  reducedRational as reducedRationalDecimal,
} from '../numerics/numeric-decimal';

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
  if (op1.isLiteral && op2.isLiteral) {
    if (op1.isOne) return ce.inverse(op2);
    if (op1.isNegativeOne) return canonicalNegate(ce.inverse(op2));
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return canonicalNegate(op1);

    const [n, d] = [op1.asSmallInteger, op2.asSmallInteger];
    if (n !== null && d !== null && d !== 0) return ce.number([n, d]);
    if (op1.isInteger && op2.isInteger) {
      // eslint-disable-next-line prefer-const
      let [nSign, dn] = makePositive(op1);
      // eslint-disable-next-line prefer-const
      let [dSign, dd] = makePositive(op2);
      if (dd.isOne) return nSign * dSign < 0 ? canonicalNegate(dn) : dn;
      if (nSign * dSign > 0) return ce._fn('Rational', [dn, dd]);
      return ce._fn('Rational', [ce.negate(dn), dd]);
    }
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
    const [a, b] = op1.rationalValue;
    if (a !== null && b !== null)
      return canonicalDivide(ce, ce.mul([ce.number(a), op2]), ce.number(b));
  }
  if (op2.isLiteral) {
    const [a, b] = op2.rationalValue;
    if (a !== null && b !== null)
      return canonicalDivide(ce, ce.mul([op1, ce.number(b)]), ce.number(a));
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
  if (n.isOne) return d;
  if (n.isNegativeOne) return canonicalNegate(d);
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
    const [n, d] = [op1.asSmallInteger, op2.asSmallInteger];
    if (n !== null && d !== null && d !== 0)
      return ce.number(reducedRational([n, d]));

    if (op1.isInteger && op2.isInteger) {
      let [dn, dd] = [
        op1.decimalValue ??
          (op1.machineValue ? ce.decimal(op1.machineValue) : null),
        op2.decimalValue ??
          (op2.machineValue ? ce.decimal(op2.machineValue) : null),
      ];
      if (dn !== null && dd !== null) {
        [dn, dd] = reducedRationalDecimal([dn, dd]);
        if (dd.eq(1)) return ce.number(dn);
        if (isInMachineRange(dn) && isInMachineRange(dd))
          return ce.number([dn.toNumber(), dd.toNumber()]);
        return ce._fn('Rational', [ce.number(dn), ce.number(dd)]);
      }
    }
  }

  return undefined;
}
