import { Complex } from 'complex.js';
import { reducedRational } from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { complexAllowed, useDecimal } from '../boxed-expression/utils';
import { canonicalNegate } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { flattenOps } from '../symbolic/flatten';
import { isInMachineRange } from '../numerics/numeric-decimal';

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
  //
  // Apply associativity
  //
  ops = flattenOps(ops, 'Multiply') ?? ops;

  if (ops.length === 0) return ce.symbol('Nothing');
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return multiply2(ops[0], ops[1]);

  return new Product(ce, ops).asExpression();
}

export function processMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  _mode: 'simplify' | 'evaluate'
): BoxedExpression | undefined {
  console.assert(ops.length > 1, 'processMultiply(): no arguments');

  console.assert(flattenOps(ops, 'Multiply') === null);

  const product = new Product(ce);
  for (const arg of ops) {
    if (arg.isNaN || arg.isMissing || arg.symbol === 'Undefined') return ce.NAN;
    product.addTerm(arg);
  }

  return product.asExpression();
}

export function numEvalMultiply(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression | undefined {
  console.assert(ops.length > 1, 'processMultiply(): no arguments');

  //
  // First pass: looking for early exits
  //
  for (const arg of ops)
    if (arg.isNaN || arg.isMissing || arg.symbol === 'Undefined') return ce.NAN;

  console.assert(flattenOps(ops, 'Multiply') === null);

  //
  // Second pass
  //

  // Accumulate rational, machine, decimal, complex and symbolic products
  let [numer, denom] = [1, 1];
  let machineProduct = 1;
  let decimalProduct = ce.DECIMAL_ONE;
  let complexProduct = Complex.ONE;
  const product = new Product(ce);

  for (const arg of ops) {
    if (arg.symbol !== 'Nothing' && !arg.isOne) {
      const [n, d] = arg.rationalValue;
      if (n !== null && d !== null) {
        [numer, denom] = [numer * n, denom * d];
      } else if (arg.decimalValue !== null) {
        decimalProduct = decimalProduct.mul(arg.decimalValue);
      } else if (arg.machineValue !== null) {
        if (useDecimal(ce))
          decimalProduct = decimalProduct.mul(arg.machineValue);
        else machineProduct *= arg.machineValue;
      } else if (arg.complexValue !== null) {
        complexProduct = complexProduct.mul(arg.complexValue);
      } else product.addTerm(arg);
    }
  }

  if (!complexAllowed(ce) && complexProduct.im !== 0) return ce.NAN;

  if (useDecimal(ce) || !decimalProduct.eq(ce.DECIMAL_ONE)) {
    // Fold into decimal
    const d = decimalProduct.mul(numer).div(denom).mul(machineProduct);

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
    // Fold into complex
    const a = (machineProduct * numer) / denom;
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
  if (op1.symbol === 'Nothing') return op2;
  if (op2.symbol === 'Nothing') return op1;
  if (op1.isLiteral && op1.isOne) return op2;
  if (op2.isLiteral && op2.isOne) return op1;
  if (op1.isLiteral && op1.isNegativeOne) return canonicalNegate(op2);
  if (op2.isLiteral && op2.isNegativeOne) return canonicalNegate(op1);

  const ce = op1.engine;

  if (op1.isMissing || op2.isMissing) return ce._fn('Multiply', [op1, op2]);

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

  const [n, d] = c.asRational;
  if (c.isLiteral && n !== null && d !== null) {
    if (n === d) return t;
    if (n === 0) return ce.ZERO;
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
    if (sign < 0) return ce._fn('Multiply', [canonicalNegate(c), t], metadata);
    return ce._fn('Multiply', [c, t], metadata);
  }

  if (c.isSame(t)) return ce.power(c, 2);

  const product = new Product(ce, [c, t]);

  if (sign > 0) return product.asExpression();
  return canonicalNegate(product.asExpression(), metadata);
}
