import { BoxedExpression } from '../public';
import { apply2N } from '../symbolic/utils';
import {
  inverse,
  isBigRational,
  isMachineRational,
  isZero,
} from '../numerics/rationals';
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

  if (op1.head === 'Negate' && op2.head === 'Negate') {
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

  if (op1.head === 'Divide' && op2.head === 'Divide') {
    return canonicalDivide(
      canonicalMultiply(ce, [op1.op1, op2.op2]),
      canonicalMultiply(ce, [op1.op2, op2.op1])
    );
  }
  if (op1.head === 'Divide')
    return canonicalDivide(op1.op1, canonicalMultiply(ce, [op1.op2, op2]));
  if (op2.head === 'Divide')
    return canonicalDivide(canonicalMultiply(ce, [op1, op2.op2]), op2.op1);

  if (op2.isOne) return op1;

  const [c1, t1] = ce._toNumericValue(op1);
  const [c2, t2] = ce._toNumericValue(op2);

  const c = c1.div(c2);
  if (c.isZero) return ce.Zero;
  if (c.isOne) return t2.isOne ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
    return t2.isOne ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  const num = ce._fromNumericValue(c.num, t1);
  const denom = ce._fromNumericValue(c.denom, t2);

  return denom.isOne ? num : ce._fn('Divide', [num, denom]);
}

export function evalDivide(
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  const ce = op1.engine;
  let result = op1.div(op2);
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

export function evalNDivide(
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  const ce = op1.engine;
  let result = op1.div(op2);
  if (result?.head === 'Divide') {
    result =
      apply2N(
        op1,
        op2,
        (n, d) => n / d,
        (n, d) => n.div(d),
        (n, d) => n.div(d)
      ) ?? result;
  }

  const num = result?.numericValue;
  if (isBigRational(num)) {
    const [n, d] = num;
    return ce.number(n / d);
  }
  if (isMachineRational(num)) {
    const [n, d] = num;
    return ce.number(n / d);
  }

  if (result !== undefined) return result;

  return ce._fn('Divide', [op1, op2]);
}
