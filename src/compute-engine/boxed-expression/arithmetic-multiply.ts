import type { BoxedExpression, IComputeEngine } from '../public';

import { order } from './order';

import { Product } from './product';
import { expandProducts } from './expand';
import { negateProduct } from './negate';
import { isSubtype } from '../../common/type/subtype';
import { NumericValue } from '../numeric-value/public';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { isOne } from '../numerics/rationals';
import { asRational } from './numerics';
import { SMALL_INTEGER } from '../numerics/numeric';

/**
 * The canonical form of `Multiply`:
 * - removes `1` anb `-1`
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
  ce: IComputeEngine,
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
        isSubtype(next.op1.type, 'finite_integer')
      ) {
        // Next is a sqrt of a literal integer
        let radical = next.op1.numericValue!;
        if (typeof radical !== 'number') radical = radical.re;

        if (radical >= SMALL_INTEGER) {
          ys.push(x);
          continue;
        }

        // Is it preceded by a rational?
        if (isSubtype(x.type, 'finite_rational')) {
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
