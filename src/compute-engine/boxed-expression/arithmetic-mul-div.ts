import { isSubtype } from '../../common/type/subtype';

import type { BoxedExpression, ComputeEngine } from '../global-types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { SMALL_INTEGER } from '../numerics/numeric';
import { isOne } from '../numerics/rationals';
import { bigint } from '../numerics/bigint';

import { asRational, asSmallInteger } from './numerics';
import { Product } from './product';
import { expandProducts } from './expand';
import { negateProduct } from './negate';
import { order } from './order';
import { NumericValue } from '../numeric-value/types';

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

  if (op1.isNaN || op2.isNaN) return ce.NaN;

  // A purely numeric expression (no symbols) that is not already a literal.
  // Such expressions may simplify to 0 (e.g. 1-1) and we want to avoid
  // collapsing divisions like 0/(1-1) or (1-1)/(1-1) during canonicalization.
  const op2IsConstantExpression =
    op2.symbols.length === 0 && !op2.isNumberLiteral;

  // 0/0 = NaN, a/0 = ~∞ (a≠0)
  // Note: We only check .is(0) here, not .N().is(0), because .N() can be
  // expensive (e.g., Monte Carlo integration) and canonicalization must be fast.
  // Expressions like (1-1)/0 won't be detected as 0/0 here, but will be
  // handled during simplification.
  if (op2.is(0)) return op1.is(0) ? ce.NaN : ce.ComplexInfinity;

  // 0/a = 0 (a≠0, a is finite)
  if (op1.is(0) && op2.isFinite !== false) {
    // Be conservative with constant (no-unknown) denominators that aren't
    // already a literal number. Avoid 0/(1-1) -> 0 during canonicalization.
    if (op2IsConstantExpression)
      return ce._fn('Divide', [op1, op2], { canonical: false });
    return ce.Zero;
  }

  // a/∞ = 0, ∞/∞ = NaN (check before a/a = 1 rule)
  if (op2.isInfinity) return op1.isInfinity ? ce.NaN : ce.Zero;

  // a/a = 1 (if a ≠ 0 and a is finite)
  if (op2.is(0) === false && op2.isFinite !== false) {
    if (op1.symbol !== null && op1.symbol === op2.symbol && op1.isConstant)
      return ce.One;

    // (x+1)/(x+1) = 1 (if x+1 ≠ 0)
    if (op1.isSame(op2)) {
      // Same conservative guard as above: don't collapse constant expressions
      // like (1-1)/(1-1) into 1 during canonicalization.
      if (op2IsConstantExpression)
        return ce._fn('Divide', [op1, op2], { canonical: false });
      return ce.One;
    }
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
  if (op2.is(1)) return op1;

  // a/(-1) = -a
  if (op2.is(-1)) return op1.neg();

  // 1/a = a^-1
  if (op1.is(1)) return op2.inv();

  // Note: (-1)/a ≠ -(a^-1). We distribute Negate over Divide.

  // √a/√b = (1/b)√(ab) as a numeric value
  if (op1.operator === 'Sqrt' && op2.operator === 'Sqrt') {
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a * b, rational: [1, b] }));
  } else if (op1.operator === 'Sqrt') {
    // √a/b = (1/b)√a as a numeric value
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a, rational: [1, b] }));
  } else if (op2.operator === 'Sqrt') {
    // a/√b = (a/b)√b as a numeric value
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
      // If we have an imaginary part, keep the division
      return ce._fn('Divide', [op1, op2]);
    }

    // a/b with a and b integer literals -> a/b rational
    // But handle division by zero: 0/0 = NaN, a/0 = ~∞
    if (
      typeof v1 === 'number' &&
      Number.isInteger(v1) &&
      typeof v2 === 'number' &&
      Number.isInteger(v2)
    ) {
      if (v2 === 0) return v1 === 0 ? ce.NaN : ce.ComplexInfinity;
      return ce.number([v1, v2]);
    }

    if (typeof v1 === 'number' && Number.isInteger(v1)) {
      if (v1 === 0) return ce.Zero;
      if (typeof v2 !== 'number' && isSubtype(v2.type, 'integer')) {
        const b = v2.bignumRe;
        if (b !== undefined) {
          if (b.isInteger()) return ce.number([bigint(v1)!, bigint(b)!]);
        } else {
          const d = v2.re;
          if (Number.isInteger(d)) return ce.number([v1, d]);
        }
      }
    }

    return ce._fn('Divide', [op1, op2]);
  }

  // At least one of op1 or op2 are not numeric value.
  // Try to factor them.

  // @fixme: toNumericValue will collapse any exact value. So 2*x*5 will be 10*x. This is not desirable for canonicalization.
  const [c1, t1] = op1.toNumericValue();
  if (c1.isZero) return ce.Zero; // @fixme can't happen? Checked for 0 above

  const [c2, t2] = op2.toNumericValue();

  if (c2.isZero) return ce.NaN; // @fixme can't happen? Checked for 0 above

  const c = c1.div(c2);

  if (c.isOne) return t2.is(1) ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
    return t2.is(1) ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  // If c is exact, use as a product: `c * (t1/t2)`
  // So, π/4 -> 1/4 * π (prefer multiplication over division)
  if (c.isExact) {
    if (t1.is(1) && t2.is(1)) return ce.number(c);
    if (t2.is(1)) return canonicalMultiply(ce, [ce.number(c), t1]);

    return ce._fn('Divide', [
      canonicalMultiply(ce, [ce.number(c.numerator), t1]),
      canonicalMultiply(ce, [ce.number(c.denominator), t2]),
    ]);
  }
  return ce._fn('Divide', [op1, op2]);
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
    if (num.is(0)) {
      // 0/0 = NaN, 0/±∞ = NaN
      if (denom === 0 || !isFinite(denom)) return ce.NaN;
      return num; // 0
    }
    // a/1 = a
    if (denom === 1) return num;
    // a/(-1) = -a
    if (denom === -1) return num.neg();
    // a/0 = ~∞ (a≠0) - ComplexInfinity as "better NaN"
    if (denom === 0) return ce.ComplexInfinity;

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
    if (num.is(0)) {
      if (denom.is(0) || denom.isFinite === false) return ce.NaN;
      return ce.Zero;
    }

    // a/1 = a
    if (denom.is(1)) return num;

    // a/(-1) = -a
    if (denom.is(-1)) return num.neg();

    // a/0 = NaN (a≠0)
    if (denom.is(0)) return ce.NaN;

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

/**
 * The canonical form of `Multiply`:
 * - removes `1` and `-1`
 * - simplifies the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 * - Numeric values are promoted (['Multiply', 2, 'Sqrt', 3] -> 2√3)
 *
 * The input ops may not be canonical, the result is canonical.
 */

export function canonicalMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  //
  // Remove negations and negative numbers
  //
  let sign = 1;
  let xs: BoxedExpression[] = [];
  for (const op of ops) {
    const [o, s] = unnegate(op);
    sign *= s;
    xs.push(o);
  }

  //
  // Filter out ones
  //
  xs = xs.filter((x) => !x.is(1));

  //
  // If an integer or a rational is followed by a sqrt or an imaginary unit
  // we promote it
  //
  const ys: BoxedExpression[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    // Last item?
    if (i + 1 >= xs.length) {
      ys.push(x);
      continue;
    }
    const next = xs[i + 1];

    // Do we have a number literal followed either by a sqrt or an imaginary unit?

    if (x.isNumberLiteral) {
      // Do we have a Sqrt expression?
      if (
        next.operator === 'Sqrt' &&
        next.op1.isNumberLiteral &&
        next.op1.type.matches('finite_integer')
      ) {
        // Next is a sqrt of a literal integer
        let radical = next.op1.numericValue!;
        if (typeof radical !== 'number') radical = radical.re;

        if (radical >= SMALL_INTEGER) {
          ys.push(x);
          continue;
        }

        // Is it preceded by a rational?
        if (x.type.matches('finite_rational')) {
          const rational = x.numericValue!;
          const [num, den] =
            typeof rational === 'number'
              ? [rational, 1]
              : [rational.numerator.re, rational.denominator.re];
          ys.push(
            ce.number(ce._numericValue({ rational: [num, den], radical }))
          );
          i++;
          continue;
        }
      } else if (
        next.isNumberLiteral &&
        next.numericValue instanceof NumericValue
      ) {
        // Do we have a radical as a numeric value?
        const nextNv = next.numericValue;
        if (
          nextNv instanceof ExactNumericValue &&
          isOne(nextNv.rational) &&
          nextNv.radical !== 1
        ) {
          // We have a number (n) followed by a radical (r)
          // Convert to a numeric value
          const r = asRational(x);
          if (r) {
            ys.push(
              ce.number(
                ce._numericValue({ rational: r, radical: nextNv.radical })
              )
            );
            i++;
            continue;
          }
        } else if (nextNv.im === 1) {
          // "Next" is an imaginary unit. Is it preceded by a real number?
          const nv = x.numericValue!;
          if (typeof nv === 'number') {
            ys.push(ce.number(ce.complex(0, nv)));
            i++;
            continue;
          } else if (nv.im === 0) {
            if (Number.isInteger(nv.re)) {
              ys.push(ce.number(ce.complex(0, nv.re)));
              i++;
              continue;
            } else if (!nv.isExact) {
              ys.push(ce.number(ce.complex(0, nv.re)));
              i++;
              continue;
            }
          }
        }
      }
    }
    ys.push(x);
  }

  // Account for the sign (if negative)
  if (sign < 0) {
    if (ys.length === 0) return ce.number(-1);
    if (ys.length === 1) return ys[0].neg();
    return negateProduct(ce, ys);
  }

  if (ys.length === 0) return ce.number(1);
  if (ys.length === 1) return ys[0];
  return ce._fn('Multiply', [...ys].sort(order));
}

function unnegate(op: BoxedExpression): [BoxedExpression, sign: number] {
  let sign = 1;
  while (op.operator === 'Negate') {
    sign = -sign;
    op = op.op1;
  }

  // If a negative number, make it positive
  if (op.isNumberLiteral && op.isNegative) {
    sign = -sign;
    op = op.neg();
  }

  return [op, sign];
}

export function mul(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (xs.length === 1) return xs[0];

  const ce = xs[0].engine;

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    xs = exp.ops!;
  }

  return new Product(ce, xs).asRationalExpression();
}

export function mulN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  const ce = xs[0].engine;
  xs = xs.map((x) => x.N());
  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    xs = exp.ops!;
  }

  return new Product(ce, xs).asExpression({ numericApproximation: true });
}
