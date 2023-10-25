import { MAX_SYMBOLIC_TERMS, asBignum, asFloat } from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { bignumPreferred } from '../boxed-expression/utils';
import { canonicalNegate } from '../symbolic/negate';
import { Product } from '../symbolic/product';

import { square } from './arithmetic-power';

import {
  asRational,
  isRationalOne,
  isRationalZero,
  mul,
  neg,
} from '../numerics/rationals';
import { apply2N } from '../symbolic/utils';
import { canonicalLimits, normalizeLimits } from './utils';
import { each } from '../collection-utils';

/** The canonical form of `Multiply`:
 * - remove `1`
 * - combine literal integers and rationals
 * - any arg is literal 0 -> return 0
 * - combine terms with same base
 *    `a a^3` -> `a^4`
 * - simplify the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 *
 * The ops must be canonical, the result is canonical.
 */
export function canonicalMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));

  if (ops.length === 0) return ce.One;
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return multiply2(ops[0], ops[1]);

  const product = new Product(ce);
  for (const op of ops) {
    if (op.isNaN || op.symbol === 'Undefined') return ce.NaN;
    product.addTerm(op);
  }
  return product.asExpression();
}

export function simplifyMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.head !== 'Multiply'));
  const product = new Product(ce);
  for (let op of ops) {
    op = op.simplify();
    if (op.isNaN || op.symbol === 'Undefined') return ce.NaN;
    product.addTerm(op);
  }

  return product.asExpression();
}

export function evalMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  mode: 'N' | 'evaluate' = 'evaluate'
): BoxedExpression | undefined {
  console.assert(ops.length > 1, 'evalMultiply(): no arguments');

  //
  // @fastpath
  //
  if (mode === 'N') {
    ops = ops.map((x) => x.N());
    if (
      (ce.numericMode === 'machine' || ce.numericMode === 'auto') &&
      ops.every((x) => typeof x.numericValue === 'number')
    ) {
      let prod = 1;
      for (const op of ops) prod *= op.numericValue as number;
      return ce.number(prod);
    }
  }

  //
  // First pass: looking for early exits
  //
  for (const op of ops) {
    if (op.isNaN || op.symbol === 'Undefined') return ce.NaN;
    if (!op.isExact) mode = 'N';
  }
  console.assert(ops.every((x) => x.head !== 'Multiply'));

  if (mode === 'N') ops = ops.map((x) => x.N());
  else ops = ops.map((x) => x.evaluate());

  //
  // Second pass
  //

  return new Product(ce, ops).asExpression(mode);
}

/**
 * Multiply op1 by op2. Distribute if one of the argument is a small integer
 * and the other is an addition.
 *
 * The result is canonical
 *
 * @todo: check if op1 or op2 (or both) are 'Divide' or `Power(_, -1)`
 *
 */
function multiply2(
  op1: BoxedExpression,
  op2: BoxedExpression,
  metadata?: Metadata
): BoxedExpression {
  console.assert(op1.isCanonical);
  console.assert(op2.isCanonical);
  const ce = op1.engine;

  if (op1.symbol === 'ImaginaryUnit') {
    const f = asFloat(op2);
    if (f !== null) return ce.number(ce.complex(0, f));
  }
  if (op2.symbol === 'ImaginaryUnit') {
    const f = asFloat(op1);
    if (f !== null) return ce.number(ce.complex(0, f));
  }
  if (op1.numericValue !== null && op2.numericValue !== null) {
    const f1 = asFloat(op1);
    const f2 = asFloat(op2);
    if (f1 !== null && ce.isComplex(op2))
      return ce.number(ce.complex(f1 * op2.re, f1 * op2.im));
    if (f2 !== null && ce.isComplex(op1))
      return ce.number(ce.complex(f2 * op1.re, f2 * op1.im));
  }

  if (
    op1.numericValue !== null &&
    op2.numericValue !== null &&
    op1.isInteger &&
    op2.isInteger
  ) {
    return (
      apply2N(
        op1,
        op2,
        (a, b) => a * b,
        (a, b) => a.mul(b)
      ) ?? ce.NaN
    );
  }
  if (
    op1.isNaN ||
    op2.isNaN ||
    op1.symbol === 'Undefined' ||
    op2.symbol === 'Undefined'
  )
    return ce.NaN;
  if (op1.isNothing) return op2;
  if (op2.isNothing) return op1;
  if (op1.numericValue !== null) {
    if (op1.isOne) return op2;
    if (op1.isNegativeOne) return canonicalNegate(op2);
  }
  if (op2.numericValue !== null) {
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return canonicalNegate(op1);
  }
  let sign = 1;
  let [t, c] = op1.numericValue !== null ? [op1, op2] : [op2, op1];

  console.assert(t.head !== 'Subtract');
  if (t.head === 'Negate') {
    t = t.op1;
    sign = -sign;
  }

  if (c.numericValue !== null) {
    const r = asRational(c);
    if (r) {
      if (isRationalOne(r)) return t;
      if (isRationalZero(r)) return ce.Zero;
      if (t.head === 'Add') {
        if (sign < 0) c = canonicalNegate(c);
        return ce.add(
          t.ops!.map((x) => multiply2(c, x)),
          metadata
        );
      }

      const tr = asRational(t);
      if (tr) {
        const p = mul(r, tr);
        return ce.number(sign < 0 ? neg(p) : p, { metadata });
      }
      if (sign < 0)
        return ce._fn('Multiply', [canonicalNegate(c), t], metadata);
      return ce._fn('Multiply', [c, t], metadata);
    }
  }

  if (c.hash === t.hash && c.isSame(t)) return square(ce, c);

  const product = new Product(ce, [c, t]);

  if (sign > 0) return product.asExpression();
  return canonicalNegate(product.asExpression(), metadata);
}

// Canonical form of `["Product"]` (`\prod`) expressions.
export function canonicalProduct(
  ce: IComputeEngine,
  body: BoxedExpression | undefined,
  range: BoxedExpression | undefined
) {
  // Product is a scoped function (to declare the index)
  ce.pushScope();

  body ??= ce.error('missing');

  const limits = canonicalLimits(range);
  const result = limits
    ? ce._fn('Product', [body.canonical, limits])
    : ce._fn('Product', [body.canonical]);

  ce.popScope();
  return result;
}

export function evalMultiplication(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression | undefined,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  let result: BoxedExpression | undefined | null = null;

  const body =
    mode === 'simplify'
      ? expr.simplify()
      : expr.evaluate({ numericMode: mode === 'N' });

  if (!range) {
    // The body is a collection, e.g. Product({1, 2, 3})
    if (bignumPreferred(ce)) {
      let product = ce.bignum(1);
      for (const x of each(body)) {
        const term = asBignum(x);
        if (term === null) {
          result = undefined;
          break;
        }
        if (!term.isFinite()) {
          product = term;
          break;
        }
        product = product.mul(term);
      }
      if (result === null) result = ce.number(product);
    } else {
      let product = 1;
      for (const x of each(body)) {
        const term = asFloat(x);
        if (term === null) {
          result = undefined;
          break;
        }
        if (term === null || !Number.isFinite(term)) {
          product = term;
          break;
        }
        product *= term;
      }
      if (result === null) result = ce.number(product);
    }
    return result ?? undefined;
  }

  const [index, lower, upper, isFinite] = normalizeLimits(range);

  if (!index) return undefined;

  const fn = expr;
  if (mode !== 'N' && (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS))
    return undefined;

  const savedContext = ce.swapScope(fn.scope);
  ce.pushScope();
  fn.bind();

  if (mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      ce.assign({ [index]: i });
      terms.push(fn.simplify());
    }
    result = ce.mul(terms).simplify();
  }

  if (mode === 'evaluate') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      ce.assign({ [index]: i });
      terms.push(fn.evaluate());
    }
    result = ce.mul(terms).evaluate();
  }

  if (mode === 'N') {
    // if (result === null && !fn.scope) {
    //   //
    //   // The term is not a function of the index
    //   //

    //   const n = fn.N();
    //   if (!isFinite) {
    //     if (n.isZero) result = ce._ZERO;
    //     else if (n.isPositive) result = ce._POSITIVE_INFINITY;
    //     else result = ce._NEGATIVE_INFINITY;
    //   }
    //   if (result === null && fn.isPure)
    //     result = ce.pow(n, ce.number(upper - lower + 1));

    //   // If the term is not a function of the index, but it is not pure,
    //   // fall through to the general case
    // }

    //
    // Finite series. Evaluate each term and multiply them
    //
    if (result === null && isFinite) {
      if (bignumPreferred(ce)) {
        let product = ce.bignum(1);
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asBignum(fn.N());
          if (term === null || !term.isFinite()) {
            result = term !== null ? ce.number(term) : undefined;
            break;
          }
          product = product.mul(term);
        }
        if (result === null) result = ce.number(product);
      }

      // Machine precision
      let product = 1;
      const numericMode = ce.numericMode;
      const precision = ce.precision;
      ce.numericMode = 'machine';
      for (let i = lower; i <= upper; i++) {
        ce.assign({ [index]: i });
        const term = asFloat(fn.N());
        if (term === null || !Number.isFinite(term)) {
          result = term !== null ? ce.number(term) : undefined;
          break;
        }
        product *= term;
      }
      ce.numericMode = numericMode;
      ce.precision = precision;

      if (result === null) result = ce.number(product);
    }

    if (result === null) {
      //
      // Infinite series.
      //

      // First, check for divergence
      ce.assign({ [index]: 1000 });
      const nMax = fn.N();
      ce.assign({ [index]: 999 });
      const nMaxMinusOne = fn.N();

      const ratio = asFloat(ce.div(nMax, nMaxMinusOne).N());
      if (ratio !== null && Number.isFinite(ratio) && Math.abs(ratio) > 1) {
        result = ce.PositiveInfinity;
      } else {
        // Potentially converging series.
        // Evaluate as a machine number (it's an approximation to infinity, so
        // no point in calculating with high precision), and check for convergence
        let product = 1;
        const numericMode = ce.numericMode;
        const precision = ce.precision;
        ce.numericMode = 'machine';
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asFloat(fn.N());
          if (term === null) {
            result = undefined;
            break;
          }
          // Converged (or diverged), early exit
          if (Math.abs(1 - term) < Number.EPSILON || !Number.isFinite(term))
            break;
          product *= term;
        }
        if (result === null) result = ce.number(product);
        ce.numericMode = numericMode;
        ce.precision = precision;
      }
    }
  }

  ce.popScope();
  ce.swapScope(savedContext);

  return result ?? undefined;
}
