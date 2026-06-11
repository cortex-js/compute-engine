import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal';

import type { Expression } from '../global-types';

import { bignumPreferred } from './utils';
import { isNumber } from './type-guards';

export function apply(
  expr: Expression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: BigDecimal) => BigDecimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): Expression | undefined {
  if (!isNumber(expr)) return undefined;
  const ce = expr.engine;

  let result: number | Complex | BigDecimal | undefined = undefined;
  if (expr.im !== 0) result = complexFn?.(ce.complex(expr.re, expr.im));
  else {
    const bigRe = expr.bignumRe;
    if (bigRe !== undefined && bignumPreferred(ce) && bigFn)
      result = bigFn(bigRe);
    else {
      const re = expr.re;
      if (bignumPreferred(ce) && bigFn) result = bigFn(ce.bignum(re));
      else result = fn(re);
    }
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex)
    return ce.number(ce._numericValue({ re: result.re, im: result.im }));
  return ce.number(result);
}

/**
 * N-ary kernel dispatcher for special functions.
 *
 * Routing:
 * - any complex operand → `complexFn`
 * - bignum preferred and `bigFn` available → `bigFn`
 * - otherwise → machine `fn`; if `fn` returns NaN on finite inputs and a
 *   `complexFn` is available, retry it (the value may be complex for real
 *   inputs, e.g. EllipticK(m) for m > 1).
 *
 * A NaN result on finite inputs yields `undefined` (the expression stays
 * symbolic) rather than a NaN literal: the kernels use NaN to signal
 * "outside the implemented domain", not a mathematical result.
 */
export function applyN(
  ops: ReadonlyArray<Expression>,
  fn: (...xs: number[]) => number | Complex,
  bigFn?: (...xs: BigDecimal[]) => BigDecimal | Complex | number,
  complexFn?: (...xs: Complex[]) => Complex
): Expression | undefined {
  if (!ops.every((op) => isNumber(op))) return undefined;
  const ce = ops[0].engine;

  if (ops.some((op) => Number.isNaN(op.re) || Number.isNaN(op.im)))
    return ce.NaN;

  let result: number | Complex | BigDecimal | undefined = undefined;

  const isNaNResult = (r: typeof result): boolean =>
    r === undefined ||
    (typeof r === 'number'
      ? Number.isNaN(r)
      : r instanceof Complex
        ? r.isNaN()
        : r.isNaN());

  if (ops.some((op) => op.im !== 0)) {
    result = complexFn?.(...ops.map((op) => ce.complex(op.re, op.im)));
  } else {
    // Cascade: bignum (if preferred) → machine → complex. A NaN from a
    // kernel means "outside this kernel's implemented domain", so a
    // lower-precision or complex-valued answer is better than none.
    if (bignumPreferred(ce) && bigFn)
      result = bigFn(...ops.map((op) => op.bignumRe ?? ce.bignum(op.re)));
    if (isNaNResult(result)) result = fn(...ops.map((op) => op.re));
    if (
      isNaNResult(result) &&
      complexFn &&
      ops.every((op) => Number.isFinite(op.re))
    ) {
      // The value may be complex for real arguments
      result = complexFn(...ops.map((op) => ce.complex(op.re, 0)));
    }
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex) {
    if (Number.isNaN(result.re) || Number.isNaN(result.im)) return undefined;
    return ce.number(
      ce._numericValue({ re: ce.chop(result.re), im: ce.chop(result.im) })
    );
  }
  if (typeof result === 'number') {
    if (Number.isNaN(result)) return undefined;
    return ce.number(result);
  }
  if (result.isNaN()) return undefined;
  return ce.number(result);
}

export function apply2(
  expr1: Expression,
  expr2: Expression,
  fn: (x1: number, x2: number) => number | Complex,
  bigFn?: (x1: BigDecimal, x2: BigDecimal) => BigDecimal | Complex | number,
  complexFn?: (x1: Complex, x2: number | Complex) => Complex | number
): Expression | undefined {
  if (!isNumber(expr1) || !isNumber(expr2)) return undefined;

  const ce = expr1.engine;

  let result: number | Complex | BigDecimal | undefined = undefined;
  if (expr1.im !== 0 || expr2.im !== 0) {
    result = complexFn?.(
      ce.complex(expr1.re, expr1.im),
      ce.complex(expr2.re, expr2.im)
    );
  }

  if (result === undefined && bigFn) {
    let bigRe1 = expr1.bignumRe;
    let bigRe2 = expr2.bignumRe;
    if (bigRe1 !== undefined || bigRe2 !== undefined) {
      bigRe1 ??= ce.bignum(expr1.re);
      bigRe2 ??= ce.bignum(expr2.re);
      result = bigFn(bigRe1, bigRe2);
    }
  }
  if (result === undefined) {
    const re1 = expr1.re;
    const re2 = expr2.re;
    if (!isNaN(re1) && !isNaN(re2)) {
      if (bignumPreferred(ce) && bigFn)
        result = bigFn(
          ce.bignum(expr1.bignumRe ?? re1),
          ce.bignum(expr2.bignumRe ?? re2)
        );
      else result = fn(re1, re2);
    }
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex)
    return ce.number(
      ce._numericValue({ re: ce.chop(result.re), im: ce.chop(result.im) })
    );
  // Do not chop a real result: a legitimately-small value (e.g. 10^-100 from
  // `Power(10, -100)`) is not roundoff noise, and chopping it to 0 is both
  // wrong and inconsistent with the single-argument `apply` above. (The
  // complex branch still chops each component, where a tiny re/im part is
  // typically trig roundoff.)
  return ce.number(result);
}
