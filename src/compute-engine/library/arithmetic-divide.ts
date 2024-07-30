import { BoxedExpression } from '../public';
import { inverse, isZero } from '../numerics/rationals';
import { asRational, mul } from '../boxed-expression/numerics';
import { canonicalMultiply } from './arithmetic-multiply';

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

  if (op1.operator === 'Negate' && op2.operator === 'Negate') {
    op1 = op1.op1;
    op2 = op2.op1;
  }

  if (op1.numericValue !== null && op2.numericValue !== null) {
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return op1.neg();
    if (op1.isOne) return op2.inv();
    if (op1.isNegativeOne) return op2.inv().neg();
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  if (op1.operator === 'Divide' && op2.operator === 'Divide') {
    return canonicalDivide(
      canonicalMultiply(ce, [op1.op1, op2.op2]),
      canonicalMultiply(ce, [op1.op2, op2.op1])
    );
  }
  if (op1.operator === 'Divide')
    return canonicalDivide(op1.op1, canonicalMultiply(ce, [op1.op2, op2]));
  if (op2.operator === 'Divide')
    return canonicalDivide(canonicalMultiply(ce, [op1, op2.op2]), op2.op1);

  if (op2.isOne) return op1;

  const [c1, t1] = op1.toNumericValue();
  if (c1.isZero) return ce.Zero;

  const [c2, t2] = op2.toNumericValue();

  const c = c1.div(c2);

  if (c.isOne) return t2.isOne ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
    return t2.isOne ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  // If c is not exact, don't use. For example: `π/4` would remain as
  // `π/4` and not `0.25π`
  if (!c.isExact) return ce._fn('Divide', [t1.mul(c1), t2.mul(c2)]);

  const num = c.num.isOne ? t1 : t1.mul(ce.box(c.num));
  const denom = c.denom.isOne ? t2 : t2.mul(ce.box(c.denom));

  return denom.isOne ? num : ce._fn('Divide', [num, denom]);
}
