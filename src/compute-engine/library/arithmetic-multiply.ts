import { Complex } from 'complex.js';

import {
  MAX_ITERATION,
  MAX_SYMBOLIC_TERMS,
  reducedRational,
} from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { complexAllowed, preferDecimal } from '../boxed-expression/utils';
import { canonicalNegate } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { flattenOps } from '../symbolic/flatten';
import {
  isInMachineRange,
  reducedRational as reducedRationalDecimal,
} from '../numerics/numeric-decimal';

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

  // Accumulate rational, machine, decimal, complex and symbolic products
  let [numer, denom] = [1, 1];
  let [decimalNumer, decimalDenom] = [ce._DECIMAL_ONE, ce._DECIMAL_ONE];
  let machineProduct = 1;
  let decimalProduct = ce._DECIMAL_ONE;
  let complexProduct = Complex.ONE;
  const product = new Product(ce);

  for (const arg of ops) {
    if (arg.symbol === 'Nothing' || arg.isOne) continue;
    if (!arg.isLiteral) {
      product.addTerm(arg);
    } else {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        if (preferDecimal(ce)) {
          [decimalNumer, decimalDenom] = reducedRationalDecimal([
            decimalNumer.mul(n),
            decimalDenom.mul(d),
          ]);
        } else [numer, denom] = reducedRational([numer * n, denom * d]);
      } else if (arg.decimalValue !== null) {
        if (arg.decimalValue.isInteger())
          decimalNumer = decimalNumer.mul(arg.decimalValue);
        else decimalProduct = decimalProduct.mul(arg.decimalValue);
      } else if (arg.machineValue !== null) {
        if (preferDecimal(ce)) {
          if (Number.isInteger(arg.machineValue))
            decimalNumer = decimalNumer.mul(arg.machineValue);
          else decimalProduct = decimalProduct.mul(arg.machineValue);
        } else machineProduct *= arg.machineValue;
      } else if (arg.complexValue !== null) {
        complexProduct = complexProduct.mul(arg.complexValue);
      } else product.addTerm(arg);
    }
  }

  if (!complexAllowed(ce) && complexProduct.im !== 0) return ce._NAN;

  if (decimalDenom.eq(ce._DECIMAL_ONE) && isInMachineRange(decimalNumer)) {
    numer = denom * decimalNumer.toNumber();
    decimalNumer = ce._DECIMAL_ONE;
  }

  if (
    preferDecimal(ce) ||
    !decimalProduct.eq(ce._DECIMAL_ONE) ||
    !(decimalNumer.eq(ce._DECIMAL_ONE) && decimalDenom.eq(ce._DECIMAL_ONE))
  ) {
    // Fold into decimal
    let d = decimalProduct.mul(machineProduct);
    if (mode === 'N') {
      d = d.mul(numer).div(denom);
      d = d.mul(decimalNumer).div(decimalDenom);
    } else {
      if (denom === 1) {
        if (decimalDenom.eq(1)) {
          d = d.mul(decimalNumer).mul(numer);
        } else
          product.addTerm(
            ce.box([
              'Rational',
              ce.number(decimalNumer.mul(numer)),
              ce.number(decimalDenom),
            ])
          );
      } else {
        product.addTerm(ce.number([numer, denom]));
        product.addTerm(
          ce.box(['Rational', ce.number(decimalNumer), ce.number(decimalDenom)])
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
    // Fold into complex (there is no decimal component)
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
      if (op1.decimalValue && op2.decimalValue)
        return ce.number(op1.decimalValue.mul(op2.decimalValue));
      if (op1.machineValue && op2.machineValue)
        return ce.number(op1.machineValue * op2.machineValue);
    }
  }

  if (op1.symbol === 'Nothing') return op2;
  if (op2.symbol === 'Nothing') return op1;
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

export function evalMultiplication(
  ce: IComputeEngine,
  expr: BoxedExpression,
  range: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  const index = range.op1.symbol ?? 'i';
  const lower = range.op2.asSmallInteger ?? 1;
  const upper = range.op3.asSmallInteger ?? MAX_ITERATION;

  const fn = expr.head === 'Lambda' ? expr.op1 : expr.subs({ [index]: '_' });

  if (
    (mode === 'evaluate' || mode === 'simplify') &&
    upper - lower < MAX_SYMBOLIC_TERMS
  ) {
    const terms: BoxedExpression[] = [];
    for (let i = lower; i <= upper; i++) {
      const n = ce.number(i);
      terms.push(fn.subs({ _1: n, _: n }));
    }
    if (mode === 'simplify') return ce.mul(terms).simplify();
    return ce.mul(terms).evaluate();
  }

  if (mode === 'N' && upper - lower < MAX_ITERATION) {
    if (preferDecimal(ce)) {
      let v = ce.decimal(1);
      for (let i = lower; i <= upper; i++) {
        const n = ce.number(i);
        const r = fn.subs({ _1: n, _: n }).evaluate();
        const val = r.decimalValue ?? r.asFloat;
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
  return undefined;
}
