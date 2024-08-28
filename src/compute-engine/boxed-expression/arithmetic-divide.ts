import type { BoxedExpression } from '../public';
import type { NumericValue } from '../numeric-value/public';
import { asSmallInteger } from './numerics';
import { bigint } from '../numerics/bigint';

import { canonicalMultiply } from './arithmetic-multiply';
import { Product } from './product';

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

  if (op2.isZero) return op1.isZero ? ce.NaN : ce.ComplexInfinity;

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
  const v1 = op1.numericValue;
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

export function div(
  num: BoxedExpression,
  denom: number | BoxedExpression
): BoxedExpression {
  const ce = num.engine;

  num = num.canonical;
  if (typeof denom !== 'number') denom = denom.canonical;

  // If the numerator is NaN, return NaN
  if (num.isNaN) return ce.NaN;

  if (typeof denom === 'number') {
    if (isNaN(denom)) return ce.NaN;
    if (num.isZero) {
      // 0/0 = NaN, 0/±∞ = NaN
      if (denom === 0 || !isFinite(denom)) return ce.NaN;
      return num; // 0
    }
    // a/1 = a
    if (denom === 1) return num;
    // a/(-1) = -a
    if (denom === -1) return num.neg();
    // a/0 = NaN (a≠0)
    if (denom === 0) return ce.NaN;

    if (num.isNumberLiteral) {
      const n = num.numericValue!;
      // If num and denom are literal integers, we keep an exact result
      if (typeof n === 'number') {
        if (Number.isInteger(n) && Number.isInteger(denom))
          return ce.number(ce._numericValue({ rational: [n, denom] }));
      } else if (n.isExact && Number.isInteger(denom)) {
        return ce.number(n.asExact!.div(denom));
      }
    }
  } else {
    if (denom.isNaN) return ce.NaN;
    if (num.isZero) {
      if (denom.isZero || denom.isFinite === false) return ce.NaN;
      return ce.Zero;
    }

    // a/1 = a
    if (denom.isOne) return num;
    // a/(-1) = -a
    if (denom.isNegativeOne) return num.neg();
    // a/0 = NaN (a≠0)
    if (denom.isZero) return ce.NaN;

    if (num.isNumberLiteral && denom.isNumberLiteral) {
      const numV = num.numericValue!;
      const denomV = denom.numericValue!;
      if (
        typeof numV === 'number' &&
        typeof denomV === 'number' &&
        Number.isInteger(numV) &&
        Number.isInteger(denomV)
      ) {
        return ce.number(ce._numericValue({ rational: [numV, denomV] }));
      } else if (
        typeof numV === 'number' &&
        Number.isInteger(numV) &&
        typeof denomV !== 'number'
      ) {
        if (denomV.isExact) {
          return ce.number(ce._numericValue(numV).div(denomV.asExact!));
        }
      } else if (
        typeof denomV === 'number' &&
        Number.isInteger(denomV) &&
        typeof numV !== 'number'
      ) {
        if (numV.isExact) {
          return ce.number(numV.asExact!.div(denomV));
        }
      } else if (typeof numV !== 'number' && typeof denomV !== 'number') {
        if (numV.isExact && denomV.isExact) {
          return ce.number(numV.asExact!.div(denomV.asExact!));
        }
      }
    }
  }
  const result = new Product(ce, [num]);
  result.div(typeof denom === 'number' ? ce._numericValue(denom) : denom);
  return result.asRationalExpression();
}
