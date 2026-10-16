import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import {
  continuousRange,
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';

function smallInteger(
  e: Expression,
  min: number,
  max: number
): number | undefined {
  return isNumber(e) &&
    e.isExact &&
    e.isInteger &&
    Number.isSafeInteger(e.re) &&
    e.re >= min &&
    e.re <= max
    ? e.re
    : undefined;
}

/** Closed generating functions on compact intervals strictly inside their
 * convergence disk. The enclosure proves uniform absolute convergence, so
 * replacement and integration are justified without testing sample points. */
export function integrateDefiniteSeries(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !isFunction(f, 'Sum') ||
    f.nops !== 2 ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !lower.isPure ||
    !upper.isPure ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    limits = f.op2;
  if (
    !isFunction(limits, 'Limits') ||
    limits.nops !== 3 ||
    !limits.op3.isSame(ce.PositiveInfinity)
  )
    return undefined;
  const index = sym(limits.op1),
    start = smallInteger(limits.op2, 0, 1024);
  if (!index || index === x || start === undefined) return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction !== 1 && direction !== -1) return undefined;
  const lo = direction === 1 ? lower : upper,
    hi = direction === 1 ? upper : lower;
  let power = f.op1,
    order = 0;
  if (isFunction(f.op1, 'Multiply') && f.op1.nops === 2 && start === 0) {
    const binomial = f.op1.ops.find((t) => isFunction(t, 'Binomial'));
    const other = f.op1.ops.find((t) => t !== binomial);
    if (
      !binomial ||
      !other ||
      !isFunction(binomial, 'Binomial') ||
      sym(binomial.op2) !== index
    )
      return undefined;
    const p = getPolynomialCoefficients(binomial.op1, index);
    if (!p || p.length !== 2 || !p[1].isSame(1)) return undefined;
    const k = smallInteger(p[0], 0, 32);
    if (k === undefined) return undefined;
    order = k;
    power = other;
  }
  if (
    !isFunction(power, 'Power') ||
    sym(power.op2) !== index ||
    power.op1.has(index)
  )
    return undefined;
  const ratio = power.op1;
  const r = continuousRange(ratio, x, lo, hi);
  if (
    !r ||
    exactSign(op('Add', r[0], 1)) !== 1 ||
    exactSign(op('Subtract', 1, r[1])) !== 1
  )
    return undefined;
  const reduced = op(
    'Divide',
    op('Power', ratio, start),
    op('Power', op('Subtract', 1, ratio), order + 1)
  );
  // The rewrite removes the only Sum; recursive integration cannot revisit it.
  const value = ce
    .function('Integrate', [
      reduced,
      ce.function('Limits', [ce.symbol(x), lower, upper]),
    ])
    .evaluate();
  return value.has('Integrate') ? undefined : value;
}

/** A finite product times its logarithmic derivative is integrated by endpoint
 * products, without expanding a high-degree polynomial. Positive factors on
 * the interval rule out denominator poles in the logarithmic derivative. */
export function integrateProductDerivative(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !isFunction(f, 'Multiply') ||
    f.nops !== 2 ||
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !definiteUnshadowed(f)
  )
    return undefined;
  const product = f.ops.find((t) => isFunction(t, 'Product'));
  const sum = f.ops.find((t) => isFunction(t, 'Sum'));
  if (
    !product ||
    !sum ||
    !isFunction(product, 'Product') ||
    !isFunction(sum, 'Sum') ||
    product.nops !== 2 ||
    sum.nops !== 2
  )
    return undefined;
  const pl = product.op2,
    sl = sum.op2;
  if (
    !isFunction(pl, 'Limits') ||
    !isFunction(sl, 'Limits') ||
    pl.nops !== 3 ||
    sl.nops !== 3 ||
    !pl.op2.isSame(sl.op2) ||
    !pl.op3.isSame(sl.op3)
  )
    return undefined;
  const pi = sym(pl.op1),
    si = sym(sl.op1);
  const a = smallInteger(pl.op2, -4096, 4096),
    b = smallInteger(pl.op3, -4096, 4096);
  if (
    !pi ||
    !si ||
    pi === x ||
    si === x ||
    a === undefined ||
    b === undefined ||
    b < a ||
    b - a > 4095
  )
    return undefined;
  if (!isFunction(sum.op1, 'Divide') || !sum.op1.op1.isSame(1))
    return undefined;
  const shape = (e: Expression, index: string): Expression | undefined => {
    const p = getPolynomialCoefficients(e, x);
    if (!p || p.length !== 2 || !p[1].isSame(1)) return undefined;
    const q = getPolynomialCoefficients(p[0], index);
    return q && q.length === 2 && q[1].isSame(1) && !q[0].has([x, index])
      ? q[0]
      : undefined;
  };
  const offset = shape(product.op1, pi),
    other = shape(sum.op1.op2, si);
  if (!offset || !other || !offset.isSame(other)) return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const endpoint = (v: Expression): Expression | undefined => {
    const start = smallInteger(op('Add', v, offset, a), 1, 8192);
    if (start === undefined) return undefined;
    return op(
      'Divide',
      op('Factorial', start + b - a),
      op('Factorial', start - 1)
    );
  };
  const first = endpoint(lower),
    last = endpoint(upper);
  return first && last ? op('Subtract', last, first) : undefined;
}
