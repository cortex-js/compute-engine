import { BoxedExpression, IComputeEngine } from '../public';
import { apply2N } from '../symbolic/utils';
import {
  inverse,
  isBigRational,
  isMachineRational,
  isZero,
} from '../numerics/rationals';
import { Product } from '../symbolic/product';
import { asRational, mul } from '../boxed-expression/numerics';

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
    if (op1.isOne) return ce.inv(op2);
    if (op1.isNegativeOne) return ce.inv(op2).neg();
    const r1 = asRational(op1);
    const r2 = asRational(op2);
    if (r1 && r2 && !isZero(r2)) return ce.number(mul(r1, inverse(r2)));
  }

  if (op1.head === 'Divide' && op2.head === 'Divide') {
    return canonicalDivide(
      ce.function('Multiply', [op1.op1, op2.op2]),
      ce.function('Multiply', [op1.op2, op2.op1])
    );
  }
  if (op1.head === 'Divide')
    return canonicalDivide(op1.op1, ce.function('Multiply', [op1.op2, op2]));
  if (op2.head === 'Divide')
    return canonicalDivide(ce.function('Multiply', [op1, op2.op2]), op2.op1);

  // @fixme: enable below and compare test results
  // const num1 = op1.numericValue;
  // if (num1 !== null) {
  //   if (isMachineRational(num1)) {
  //     const [a, b] = num1;
  //     return canonicalDivide(ce, ce.number(a), ce.mul(ce.number(b), op2));
  //   }
  //   if (isBigRational(num1)) {
  //     const [a, b] = num1;
  //     return canonicalDivide(ce, ce.number(a), ce.mul(ce.number(b), op2));
  //   }
  // }
  // const num2 = op2.numericValue;
  // if (num2 !== null) {
  //   if (isMachineRational(num2)) {
  //     const [a, b] = num2;
  //     return canonicalDivide(ce, ce.mul(op1, ce.number(b)), ce.number(a));
  //   }
  //   if (isBigRational(num2)) {
  //     const [a, b] = num2;
  //     return canonicalDivide(ce, ce.mul(op1, ce.number(b)), ce.number(a));
  //   }
  // }

  const [c1, t1] = ce._toNumericValue(op1);
  const [c2, t2] = ce._toNumericValue(op2);

  const c = c1.div(c2);
  if (c.isZero) return ce.Zero;
  if (c.isOne) return ce._fn('Divide', [t1, t2]);
  if (c.isNegativeOne)
    // Note that .neg() will propagate inside the expression if possible
    return ce._fn('Divide', [t1, t2]).neg();

  const num = ce._fromNumericValue(c.num, t1);
  const denom = ce._fromNumericValue(c.denom, t2);
  if (denom.isOne) return num;

  return ce._fn('Divide', [num, denom]);
}

/**
 * Simplify form of 'Divide' (and 'Rational')
 */

export function simplifyDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression | undefined {
  // @fixme: this is a potential fast path, but not necessary
  // if (op1.numericValue !== null && op2.numericValue !== null) {
  //   const r1 = asRational(op1);
  //   const r2 = asRational(op2);
  //   if (r1 && r2 && !isZero(r2)) return ce.number(mul(r1, inverse(r2)));
  // }

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

export function evalNDivide(
  ce: IComputeEngine,
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  let result = simplifyDivide(ce, op1, op2);
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
