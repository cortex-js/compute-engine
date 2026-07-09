import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import type { Expression, IComputeEngine } from '../global-types.js';

import { MachineNumericValue } from '../numeric-value/machine-numeric-value.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import { bignumPreferred } from './utils.js';
import { isNumber } from './type-guards.js';

/**
 * Box a kernel result that is a plain JS double.
 *
 * In an engine working above machine precision, a plain-double result means
 * it was computed at machine precision (either no bignum kernel exists for
 * the operator, or the bignum kernel signalled "out of domain" and the
 * machine lane answered). Wrap it as a `MachineNumericValue` so it carries
 * its true ~16-digit precision instead of impersonating a full-precision
 * bignum: previously `BesselI(0, 100).N()` at 50 digits printed 43 digits
 * of a 16-digit value. A machine-precision operand then contaminates
 * downstream arithmetic to machine precision, mirroring float contagion.
 *
 * Small integers stay exact: machine kernels return them for exact special
 * values (e.g. `BesselI(0, 0)` = 1), and `ce.number()` interns them.
 * Non-finite values keep their canonical boxing (±oo, NaN).
 */
function boxMachineNumber(ce: IComputeEngine, value: number): Expression {
  if (
    bignumPreferred(ce) &&
    Number.isFinite(value) &&
    !(Number.isInteger(value) && Math.abs(value) <= SMALL_INTEGER)
  )
    return ce.number(new MachineNumericValue(value));
  return ce.number(value);
}

/**
 * True if a number literal has no exactness to lose under D2's "inexact
 * argument numericizes" rule — the counterpart of `NumberLiteralInterface`'s
 * `isExact`, patched for one architectural wrinkle.
 *
 * A number's `isExact` getter is authoritative, and since D12-A
 * `ExactNumericValue` represents exact complex values directly (Gaussian
 * rationals like `1+i`, `1/2+i`; pure-imaginary radicals like `√2·i`), so
 * those literals report `isExact === true` on their own. However a complex
 * literal can still arrive through the inexact `Big`/`MachineNumericValue`
 * lane with exactly-representable components — notably the engine's `i`
 * constant itself (`ce.I` is a machine complex). Treat such a value with an
 * *integer* real part and an *integer* imaginary part (a Gaussian integer)
 * as exact too, so exact Gaussian arithmetic (`(1+i)^2 = 2i`, WP-2.16) and
 * symbolic-stay identities keyed on an exact complex argument (e.g. an
 * Eisenstein series at τ = i) are preserved. A non-Gaussian complex float
 * (`1.5+2i`) still numericizes — it never was representable exactly.
 *
 * Non-number-literal expressions (symbols like `Pi`, unevaluated functions)
 * are treated as exact here: they have no float to lose, and any exact
 * reduction for them is the caller's job, not this predicate's.
 */
export function isExactNumber(x: Expression): boolean {
  if (!isNumber(x)) return true;
  if (x.isExact) return true;
  return x.im !== 0 && Number.isInteger(x.re) && Number.isInteger(x.im);
}

/**
 * Decide whether a numeric `evaluate()` handler should numericize now
 * (dispatch to `apply`/`apply2`/`applyN`) rather than stay symbolic.
 *
 * Per the exactness contract (CLAUDE.md "Evaluate vs. N"): a *numeric
 * approximation* request (`numericApproximation`, i.e. `.N()`) always
 * numericizes; otherwise an *inexact* (float) argument has no exactness to
 * preserve and numericizes even under plain `evaluate()` — mirroring the
 * `Cos`/`Sqrt`/`Power` convention (policy D2). Exact operands (integers,
 * rationals, radicals, symbolic constants like `Pi`, Gaussian integers, or
 * non-number-literal expressions — see `isExactNumber`) do not trigger this
 * on their own; call sites should still run their own exact-value
 * reductions (poles, `f(0)`, …) before consulting this.
 *
 * Mixing exact and inexact operands numericizes the whole call (float
 * contagion), matching `Add`/`Multiply`'s numeric-literal folding.
 */
export function shouldNumericize(
  numericApproximation: boolean | undefined,
  ...ops: ReadonlyArray<Expression | undefined | null>
): boolean {
  if (numericApproximation) return true;
  return ops.some((op) => op != null && !isExactNumber(op));
}

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
  if (typeof result === 'number') return boxMachineNumber(ce, result);
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
    return boxMachineNumber(ce, result);
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
        // Use an existing `bignumRe` directly rather than re-wrapping it via
        // `ce.bignum(...)` (a redundant BigDecimal copy); only convert the plain
        // float when no bignum is available — matching `applyN`'s pattern above.
        result = bigFn(
          expr1.bignumRe ?? ce.bignum(re1),
          expr2.bignumRe ?? ce.bignum(re2)
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
  if (typeof result === 'number') return boxMachineNumber(ce, result);
  return ce.number(result);
}
