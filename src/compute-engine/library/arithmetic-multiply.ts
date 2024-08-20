import type { BoxedExpression, IComputeEngine } from '../public';

import { order } from '../boxed-expression/order';

import { Product } from '../boxed-expression/product';
import { expandProducts } from '../boxed-expression/expand';
import { flatten } from '../boxed-expression/flatten';
import { negateProduct } from '../boxed-expression/negate';

/**
 * The canonical form of `Multiply`:
 * - removes `1` anb `-1`
 * - simplifies the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 *
 * The input ops may not be canonical, the result is canonical.
 */
export function canonicalMultiply(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions
  ops = flatten(ops, 'Multiply');

  if (ops.length === 1) return ops[0];

  const xs: BoxedExpression[] = [];
  const denominator: BoxedExpression[] = [];
  let sign = 1;
  let infinityCount = 0;
  let isZero = false;

  for (let i = 0; i < ops.length; i++) {
    let op = ops[i];

    // Order matters: function that may change the op must be first
    // -(x)
    if (op.operator === 'Negate') {
      sign = -sign;
      op = op.op1;
    }

    // a/b -> separate numerator and denominator
    if (op.operator === 'Divide') {
      const [a, b] = op.ops!;
      if (a.isOne) {
        denominator.push(b);
        continue;
      }
      if (a.isNegativeOne) {
        sign = -sign;
        denominator.push(b);
        continue;
      }
      if (b.isZero) return ce.NaN;
      denominator.push(b);
      op = a;
    }

    if (op.isZero) {
      isZero = true;
      continue;
    }

    if (op.isOne) continue;

    if (op.isNegativeOne) {
      sign = -sign;
      continue;
    }

    // i
    if (op.symbol === 'ImaginaryUnit') {
      xs.push(ce.number(ce.complex(0, 1)));
      continue;
    }

    if (op.symbol === 'PositiveInfinity') {
      infinityCount += 1;
      continue;
    }
    if (op.symbol === 'NegativeInfinity') {
      infinityCount += 1;
      sign = -sign;
      continue;
    }

    if (op.isInfinity) {
      if (op.isNegative) sign = -sign;
      infinityCount += 1;
    }

    let v = op.numericValue;
    if (v === null) {
      xs.push(op);
      continue;
    }
    //
    // Number
    //
    if (typeof v === 'number') {
      if (v < 0) {
        sign = -sign;
        v = -v;
      }

      // Are we followed by a complex number?
      if (ops[i + 1]?.symbol === 'ImaginaryUnit') {
        xs.push(ce.number(ce.complex(0, v)));
        i++;
        continue;
      }

      // Are we followed by a sqrt?
      const next = ops[i + 1]?.structural;
      if (next?.operator === 'Sqrt') {
        const a = next.op1.numericValue;
        if (typeof a === 'number' && a > 0 && Number.isInteger(a)) {
          // we had v√a
          xs.push(ce.number(ce._numericValue({ decimal: v, radical: a })));
          i++;
          continue;
        }
      }

      xs.push(ce.number(v));
      continue;
    }

    if (v.type === 'rational') {
      if (v.numerator.isZero) isZero = true;

      denominator.push(ce.number(v.denominator));
      v = v.numerator;
      if (v.isOne) continue;
      if (v.isNegativeOne) {
        sign = -sign;
        continue;
      }
      if (v.isZero) {
        isZero = true;
        continue;
      }
    }

    //
    // Numeric Value
    //
    if (v.im !== 0) {
      xs.push(op);
      continue;
    }

    if (v.sgn() === -1) {
      sign = -sign;
      v = v.neg();
    }

    if (!v.isExact) {
      // We have a numeric value, but it's not exact, it's a float

      // Are we followed by a complex number?
      if (ops[i + 1]?.symbol === 'ImaginaryUnit') {
        xs.push(ce.number(ce.complex(0, v.re)));
        i++;
        continue;
      }
      xs.push(ce.number(v));
      continue;
    }

    // Are we followed by a sqrt?
    const next = ops[i + 1]?.structural;
    if (next?.operator === 'Sqrt') {
      const a = next.op1.numericValue;
      if (typeof a === 'number') {
        if (a > 0 && Number.isInteger(a)) {
          // we had v√a
          const x = v.mul(ce._numericValue({ radical: a }));
          if (x.isExact) {
            xs.push(ce.number(x));
            i++;
            continue;
          }
        }
      } else if (a !== null) {
        if (a.type === 'integer') {
          // we had v√a
          const x = v.mul(ce._numericValue({ radical: a.re }));
          if (x.isExact) {
            xs.push(ce.number(x));
            i++;
            continue;
          }
        }
        if (a.type === 'rational') {
          // we had v√(n/d) -> (v/d)√(nd)
          const [n, d] = [a.numerator, a.denominator];
          xs.push(
            ce.number(v.mul(ce._numericValue({ radical: n.re * d.re })).div(d))
          );
          i++;
          continue;
        }
      }
    }
    xs.push(ce.number(v));
  }

  if (isZero) return infinityCount > 0 ? ce.NaN : ce.Zero;

  if (denominator.length > 0) {
    const den = canonicalMultiply(ce, denominator);
    if (den.isZero || den.isNaN) return ce.NaN;
    if (den.isInfinity) return infinityCount > 0 ? ce.NaN : ce.Zero;
    if (den.isNegativeOne) sign = -sign;
    else if (!den.isOne) {
      let num: BoxedExpression;
      if (xs.length === 0) {
        num = sign < 0 ? ce.NegativeOne : ce.One;
      } else if (xs.length === 1) {
        num = sign < 0 ? xs[0].neg() : xs[0];
      } else {
        if (sign < 0) num = negateProduct(ce, xs);
        else num = ce._fn('Multiply', [...xs].sort(order));
      }

      if (num.isNumberLiteral && den.isNumberLiteral) {
        const nv = ce._numericValue(num.numericValue!);
        const dv = ce._numericValue(den.numericValue!);
        const r = nv.div(dv);
        if (r.isExact) return ce.number(r);
      }

      return ce._fn('Divide', [num, den]);
    }
  }

  if (infinityCount > 0)
    return sign < 0 ? ce.NegativeInfinity : ce.PositiveInfinity;

  if (xs.length === 0) return sign < 0 ? ce.NegativeOne : ce.One;
  if (xs.length === 1) return sign < 0 ? xs[0].neg() : xs[0];

  if (sign < 0) return negateProduct(ce, xs);

  return ce._fn('Multiply', [...xs].sort(order));
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

  return new Product(ce, xs).asExpression();
}

export function mulN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  const ce = xs[0].engine;

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    xs = exp.ops!;
  }

  return new Product(ce, xs).asExpression('N');
}
