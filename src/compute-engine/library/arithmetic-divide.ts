import { BoxedExpression } from '../public';
import { canonicalMultiply } from './arithmetic-multiply';
import { NumericValue } from '../numeric-value/public';
import { bigint } from '../numerics/numeric-bigint';
import { asSmallInteger } from '../boxed-expression/numerics';

/**
 * Canonical form of 'Divide' (and 'Rational')
 * - remove denominator of 1
 * - simplify the signs
 * - factor out negate (make the numerator and denominator positive)
 * - if numerator and denominator are integer literals, return a rational number
 *   or Rational expression
 * - evaluate number literals
 */
export function canonicalDivide(
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  const ce = op1.engine;
  if (!op1.isValid || !op2.isValid) return ce._fn('Divide', [op1, op2]);

  if (op2.isZero) return ce.NaN;

  // a/a = 1 (if a ≠ 0)
  if (op2.isNotZero === true) {
    if (op1.symbol !== null && op1.symbol === op2.symbol && op1.isConstant)
      return ce.One;

    if (op1.isSame(op2)) return ce.One;
  }

  // -a/-b = a/b
  if (op1.operator === 'Negate' && op2.operator === 'Negate') {
    op1 = op1.op1;
    op2 = op2.op1;
  }

  // (a/b)/(c/d) = (a*d)/(b*c)
  if (op1.operator === 'Divide' && op2.operator === 'Divide') {
    return canonicalDivide(
      canonicalMultiply(ce, [op1.op1, op2.op2]),
      canonicalMultiply(ce, [op1.op2, op2.op1])
    );
  }

  // (a/b)/c = a/(b*c)
  if (op1.operator === 'Divide')
    return canonicalDivide(op1.op1, canonicalMultiply(ce, [op1.op2, op2]));

  // a/(b/c) = (a*c)/b
  if (op2.operator === 'Divide')
    return canonicalDivide(canonicalMultiply(ce, [op1, op2.op2]), op2.op1);

  // a/1 = a
  if (op2.isOne) return op1;

  // 1/a = a^-1
  if (op1.isOne) return op2.inv();

  // a/(-1) = -a
  if (op2.isNegativeOne) return op1.neg();

  // 0/a = 0, 0
  if (op1.isZero) return ce.Zero;

  // Note: (-1)/a ≠ -(a^-1). We distribute Negate over Divide.

  // √a/√b = √(a/b) as a numeric value
  if (op1.operator === 'Sqrt' && op2.operator === 'Sqrt') {
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a * b, rational: [1, b] }));
  } else if (op1.operator === 'Sqrt') {
    // √a/b = √(a/b) as a numeric value
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a, rational: [1, b] }));
  } else if (op2.operator === 'Sqrt') {
    // a/√b = a/(√b) as a numeric value
    const a = asSmallInteger(op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: b, rational: [a, b] }));
  }

  // Are both op1 and op2 a numeric value?
  let v1 = op1.numericValue;
  const v2 = op2.numericValue;
  if (v1 !== null && v2 !== null) {
    if (
      (typeof v1 !== 'number' && v1.im !== 0) ||
      (typeof v2 !== 'number' && v2.im !== 0)
    ) {
      // If we have an imaginary part, not a rational
      return ce._fn('Divide', [op1, op2]);
    }

    if (
      typeof v1 === 'number' &&
      Number.isInteger(v1) &&
      typeof v2 === 'number' &&
      Number.isInteger(v2)
    )
      return ce.number([v1, v2]);

    if (typeof v1 === 'number' && Number.isInteger(v1)) {
      if (v1 === 0) return ce.Zero;
      if ((v2 as NumericValue).type === 'integer') {
        const b = (v2 as NumericValue).bignumRe;
        if (b !== undefined) {
          if (b.isInteger()) return ce.number([bigint(v1)!, bigint(b)!]);
        } else {
          const d = (v2 as NumericValue).re;
          if (Number.isInteger(d)) return ce.number([v1, d]);
        }
      }
    }

    return ce._fn('Divide', [op1, op2]);
  }

  // At least one of op1 or op2 are not numeric value.
  // Try to factor them.

  const [c1, t1] = op1.toNumericValue();
  if (c1.isZero) return ce.Zero;

  const [c2, t2] = op2.toNumericValue();

  if (c2.isZero) return ce.NaN;

  const c = c1.div(c2);

  if (c.isOne) return t2.isOne ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
    return t2.isOne ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  // If c is not exact, don't use. For example: `π/4` would remain as
  // `π/4` and not `0.25π`
  if (c.type !== 'integer' && c.type !== 'rational')
    return ce._fn('Divide', [t1.mul(c1), t2.mul(c2)]);

  const num = c.numerator.isOne ? t1 : t1.mul(ce.number(c.numerator));
  const denom = c.denominator.isOne ? t2 : t2.mul(ce.number(c.denominator));

  return denom.isOne ? num : ce._fn('Divide', [num, denom]);
}
