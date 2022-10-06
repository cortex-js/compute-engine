import { Complex } from 'complex.js';

import {
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
  reducedRational,
} from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { complexAllowed, preferBignum } from '../boxed-expression/utils';
import { canonicalNegate } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { flattenOps } from '../symbolic/flatten';
import {
  isInMachineRange,
  reducedRational as reducedBigRational,
} from '../numerics/numeric-bignum';

import { square } from './arithmetic-power';

/** The canonical form of `Multiply`:
 * - remove `1`
 * - combine literal small integers and rationals
 * - any arg is literal 0 -> return 0
 * - simplify signs
 * - combine terms with same base
 *    `a a^3` -> `a^4`
 * - simplify the signs:
 *    - i.e. `-2 \times -3` -> `2 \times 3`
 *    - `2 \times -x` -> `-2 \times x`
 *
 * The ops must be canonical, the result is canonical.
 */
export function canonicalMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));
  //
  // Apply associativity
  //
  ops = flattenOps(ops, 'Multiply') ?? ops;

  if (ops.length === 0) return ce.number(1);
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return multiply2(ops[0], ops[1]);

  return new Product(ce, ops).asExpression();
}

export function simplifyMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression | undefined {
  console.assert(ops.length > 1, 'simplifyMultiply(): no arguments');

  console.assert(flattenOps(ops, 'Multiply') === null);

  const product = new Product(ce);
  for (const arg of ops) {
    if (arg.isNaN || arg.symbol === 'Undefined') return ce._NAN;
    product.addTerm(arg);
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
  // First pass: looking for early exits
  //
  for (const op of ops)
    if (op.isNaN || op.symbol === 'Undefined') return ce._NAN;

  console.assert(flattenOps(ops, 'Multiply') === null);

  //
  // Second pass
  //

  // Accumulate rational, machine, bignum, complex and symbolic products
  let [numer, denom] = [1, 1];
  let [bigNumer, bigDenom] = [ce._BIGNUM_ONE, ce._BIGNUM_ONE];
  let machineProduct = 1;
  let bigProduct = ce._BIGNUM_ONE;
  let complexProduct = Complex.ONE;
  const product = new Product(ce);

  for (const arg of ops) {
    if (arg.isNothing || arg.isOne) continue;
    if (!arg.isLiteral) {
      product.addTerm(arg);
    } else {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        if (preferBignum(ce)) {
          [bigNumer, bigDenom] = reducedBigRational([
            bigNumer.mul(n),
            bigDenom.mul(d),
          ]);
        } else [numer, denom] = reducedRational([numer * n, denom * d]);
      } else if (arg.bignumValue !== null) {
        if (arg.bignumValue.isInteger())
          bigNumer = bigNumer.mul(arg.bignumValue);
        else bigProduct = bigProduct.mul(arg.bignumValue);
      } else if (arg.machineValue !== null) {
        if (preferBignum(ce)) {
          if (Number.isInteger(arg.machineValue))
            bigNumer = bigNumer.mul(arg.machineValue);
          else bigProduct = bigProduct.mul(arg.machineValue);
        } else machineProduct *= arg.machineValue;
      } else if (arg.complexValue !== null) {
        complexProduct = complexProduct.mul(arg.complexValue);
      } else product.addTerm(arg);
    }
  }

  if (complexProduct.im !== 0) {
    if (!complexAllowed(ce)) return ce._NAN;
    // We have an imaginary number: fold bignum into machine numbers
    machineProduct *= bigProduct.toNumber();
    bigProduct = ce._BIGNUM_ONE;
    numer *= bigNumer.toNumber();
    denom *= bigDenom.toNumber();
    bigNumer = ce._BIGNUM_ONE;
    bigDenom = ce._BIGNUM_ONE;
  }

  if (bigDenom.eq(ce._BIGNUM_ONE) && isInMachineRange(bigNumer)) {
    numer = denom * bigNumer.toNumber();
    bigNumer = ce._BIGNUM_ONE;
  }

  if (
    complexProduct.im === 0 &&
    (preferBignum(ce) ||
      !bigProduct.eq(ce._BIGNUM_ONE) ||
      !(bigNumer.eq(ce._BIGNUM_ONE) && bigDenom.eq(ce._BIGNUM_ONE)))
  ) {
    // Fold into bignum
    let d = bigProduct.mul(machineProduct);
    if (mode === 'N') {
      d = d.mul(numer).div(denom);
      d = d.mul(bigNumer).div(bigDenom);
    } else {
      if (denom === 1) {
        if (bigDenom.eq(1)) {
          d = d.mul(bigNumer).mul(numer);
        } else
          product.addTerm(
            ce.box([
              'Rational',
              ce.number(bigNumer.mul(numer)),
              ce.number(bigDenom),
            ])
          );
      } else {
        product.addTerm(ce.number([numer, denom]));
        product.addTerm(
          ce.box(['Rational', ce.number(bigNumer), ce.number(bigDenom)])
            .canonical
        );
      }
    }

    if (complexProduct.re !== 1 || complexProduct.im !== 0) {
      // We potentially have a complex result;
      if (isInMachineRange(d)) {
        const z = ce.number(ce.complex(complexProduct.mul(d.toNumber())));
        if (product.isEmpty) return z;
        product.addTerm(z);
      } else {
        if (product.isEmpty)
          return ce._fn('Multiply', [ce.number(complexProduct), ce.number(d)]);

        product.addTerm(ce.number(complexProduct));
        product.addTerm(ce.number(d));
      }
    } else {
      // No complex component
      if (product.isEmpty) return ce.number(d);
      product.addTerm(ce.number(d));
    }
  } else {
    // Fold into complex (there is no bignum component)
    let a = machineProduct;
    if (mode === 'N') {
      a = (a * numer) / denom;
    } else {
      product.addTerm(ce.number([numer, denom]));
    }
    let c: BoxedExpression;
    if (complexProduct.re !== 1 || complexProduct.im !== 0)
      c = ce.number(complexProduct.mul(a));
    else c = ce.number(a);

    if (product.isEmpty) return c;
    product.addTerm(c);
  }

  return product.asExpression();
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

  if (op1.isLiteral && op2.isLiteral) {
    if (op1.isInteger && op2.isInteger) {
      if (op1.bignumValue && op2.bignumValue)
        return ce.number(op1.bignumValue.mul(op2.bignumValue));
      if (op1.machineValue && op2.machineValue)
        return ce.number(op1.machineValue * op2.machineValue);
    }
  }

  if (op1.isNothing) return op2;
  if (op2.isNothing) return op1;
  if (op1.isLiteral && op1.isOne) return op2;
  if (op2.isLiteral && op2.isOne) return op1;
  if (op1.isLiteral && op1.isNegativeOne) return canonicalNegate(op2);
  if (op2.isLiteral && op2.isNegativeOne) return canonicalNegate(op1);

  let sign = 1;
  let c = op1;
  let t = op2;
  if (!c.isLiteral || c.asRational === null) {
    t = op2;
    c = op1;
  }

  console.assert(t.head !== 'Subtract');
  if (t.head === 'Negate') {
    t = t.op1;
    sign = -sign;
  }

  if (c.isLiteral) {
    const [n, d] = c.asRational;
    if (n !== null && d !== null) {
      if (n === d) return t;
      if (n === 0) return ce._ZERO;
      if (t.head === 'Add') {
        if (sign < 0) c = canonicalNegate(c);
        return ce.add(
          t.ops!.map((x) => multiply2(c, x)),
          metadata
        );
      }

      if (t.isLiteral) {
        const [numer, denom] = t.asRational;
        if (numer !== null && denom !== null)
          return ce.number(
            reducedRational([sign * n * numer, denom * d]),
            metadata
          );
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

export function canonicalMultiplication(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression | undefined
) {
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
    index = range.ops?.[0] ?? null;
    lower = range.ops?.[1] ?? null;
    upper = range.ops?.[2] ?? null;
  }

  let fn: BoxedExpression;
  if (index !== null && index.symbol)
    fn = expr.head === 'Lambda' ? expr.op1 : expr.subs({ [index.symbol]: '_' });
  else fn = expr.head === 'Lambda' ? expr.op1 : expr;

  index ??= ce.symbol('Nothing');

  if (upper) range = ce.tuple([index, lower ?? ce.symbol('Nothing'), upper]);
  else if (lower && upper) range = ce.tuple([index, lower, upper]);
  else if (lower) range = ce.tuple([index, lower]);
  else range = index;

  return ce._fn('Product', [ce._fn('Lambda', [fn]), range]);
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
    lower = range.op2.asSmallInteger ?? 1;
    upper = range.op3.asSmallInteger ?? MAX_ITERATION;
  }
  if (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS) return undefined;

  if (mode === 'evaluate' || mode === 'simplify') {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      terms.push(fn.subs({ _1: n, _: n }));
    }
    if (mode === 'simplify') return ce.mul(terms).simplify();
    return ce.mul(terms).evaluate();
  }

  if (preferBignum(ce)) {
    let v = ce.bignum(1);
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      const r = fn.subs({ _1: n, _: n }).evaluate();
      const val = r.bignumValue ?? r.asFloat;
      if (!val) return undefined;
      v = v.mul(val);
    }
  }
  let v = 1;
  for (let i = lower; i <= upper; i++) {
    const n = ce.number(i);
    const r = fn.subs({ _1: n, _: n }).evaluate();
    if (!r.asFloat) return undefined;
    v *= r.asFloat;
  }
  return ce.number(v);
}
