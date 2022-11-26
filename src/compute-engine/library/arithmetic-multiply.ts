import {
  asSmallInteger,
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
} from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata, Rational } from '../public';
import { bignumPreferred } from '../boxed-expression/utils';
import { canonicalNegate } from '../symbolic/negate';
import { Product } from '../symbolic/product';

import { square } from './arithmetic-power';
import {
  asRational,
  isMachineRational,
  isRationalOne,
  isRationalZero,
  mul,
  neg,
} from '../numerics/rationals';
import { apply2N } from '../symbolic/utils';
import { validateArgument } from '../boxed-expression/validate';

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

  if (ops.length === 0) return ce.number(1);
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return multiply2(ops[0], ops[1]);

  const product = new Product(ce);
  for (const op of ops) {
    if (op.isNaN || op.symbol === 'Undefined') return ce._NAN;
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
    if (op.isNaN || op.symbol === 'Undefined') return ce._NAN;
    product.addTerm(op);
  }

  return product.asExpression();
}

function fastEvalMultiply(ops: BoxedExpression[]): number | null {
  let prod = 1;
  for (const op of ops) {
    if (typeof op.numericValue !== 'number') return null;
    prod *= op.numericValue;
  }
  return prod;
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
  if (mode === 'N' && ce.numericMode === 'machine') {
    ops = ops.map((x) => x.N());
    const result = fastEvalMultiply(ops);
    if (result !== null) return ce.number(result);
  }

  //
  // First pass: looking for early exits
  //
  for (const op of ops) {
    if (op.isNaN || op.symbol === 'Undefined') return ce._NAN;
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
      ) ?? ce._NAN
    );
  }
  if (
    op1.isNaN ||
    op2.isNaN ||
    op1.symbol === 'Undefined' ||
    op2.symbol === 'Undefined'
  )
    return ce._NAN;
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
      if (isRationalZero(r)) return ce._ZERO;
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

  if (c.hash === t.hash && c.isSame(t)) {
    return square(ce, c);
  }

  const product = new Product(ce, [c, t]);

  if (sign > 0) return product.asExpression();
  return canonicalNegate(product.asExpression(), metadata);
}

// Canonical form of `["Product"]` (`\prod`) expressions.
export function canonicalMultiplication(
  ce: IComputeEngine,
  body: BoxedExpression | undefined,
  range: BoxedExpression | undefined
) {
  body ??= ce.error(['missing', 'Function']); // @todo not exactly a function, more like a 'NumericExpression'

  let index: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;
  let upper: BoxedExpression | null = null;
  if (
    range &&
    range.head !== 'Tuple' &&
    range.head !== 'Triple' &&
    range.head !== 'Pair' &&
    range.head !== 'Single'
  ) {
    index = range;
  } else if (range) {
    // Don't canonicalize the index. Canonicalization as the
    // side effect of declaring the symbol, here we're using
    // it to do a local declaration
    index = range.ops?.[0] ?? null;
    lower = range.ops?.[1]?.canonical ?? null;
    upper = range.ops?.[2]?.canonical ?? null;
  }

  // The index, if present, should be a symbol
  if (index && index.head === 'Hold') index = index.op1;
  if (index && index.head === 'ReleaseHold') index = index.op1.evaluate();
  index ??= ce.symbol('Nothing');
  if (!index.symbol)
    index = ce.error(['incompatible-domain', 'Symbol', index.domain]);
  else index = ce.hold(index);

  // The range bounds, if present, should be Real numbers
  if (lower) lower = validateArgument(ce, lower, 'ExtendedRealNumber');
  if (upper) lower = validateArgument(ce, upper, 'ExtendedRealNumber');

  if (lower && upper) range = ce.tuple([index, lower, upper]);
  else if (upper)
    range = ce.tuple([index, lower ?? ce._NEGATIVE_INFINITY, upper]);
  else if (lower) range = ce.tuple([index, lower]);
  else range = index;

  return ce._fn('Product', [body, range]);
}

export function evalMultiplication(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (expr.head !== 'Lambda') return undefined;
  const fn = expr.op1;

  let lower = 1;
  let upper = MAX_ITERATION;
  if (
    range.head === 'Tuple' ||
    range.head === 'Triple' ||
    range.head === 'Pair' ||
    range.head === 'Single'
  ) {
    lower = asSmallInteger(range.op2) ?? 1;
    upper = asSmallInteger(range.op3) ?? MAX_ITERATION;
  }
  if (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS) return undefined;

  if (mode === 'evaluate' || mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      terms.push(fn.subs({ _1: n, _: n }));
    }
    const product = ce.mul(terms);
    return mode === 'simplify' ? product.simplify() : product.evaluate();
  }

  let product: Rational = bignumPreferred(ce) ? [1n, 1n] : [1, 1];

  for (let i = lower; i <= upper; i++) {
    const n = ce.number(i);
    const r = fn.subs({ _1: n, _: n });
    const term = r.N();
    if (term.numericValue === null) return undefined;
    product = mul(product, term);
  }

  if (isMachineRational(product)) return ce.number(product[0] / product[1]);
  return ce.number(ce.bignum(product[0]).div(ce.bignum(product[1])));
}
