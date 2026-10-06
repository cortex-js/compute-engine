import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';

import type { Expression, IComputeEngine } from '../global-types.js';

import { MachineNumericValue } from '../numeric-value/machine-numeric-value.js';
import type { NumericValue } from '../numeric-value/types.js';
import { bignumPreferred, boxBignumResult } from './utils.js';
import { isNumber } from './type-guards.js';
import { isImaginaryPartNaN } from './imaginary-part.js';

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
 * When an argument is a float, the result is a float, even when its value is
 * an integer: at every precision, `2.0^2` is the float `4`, as
 * `boxKernelResult()` does for a big-decimal result. A `MachineNumericValue`
 * is never exact, so it carries that result.
 *
 * Otherwise a safe-integer result stays exact: machine kernels return them
 * for exact special values (e.g. `BesselI(0, 0)` = 1), and `ce.number()`
 * interns the small ones. Non-finite values keep their canonical boxing
 * (±oo, NaN).
 */
function boxMachineNumber(
  ce: IComputeEngine,
  value: number,
  args: ReadonlyArray<Expression>
): Expression {
  if (!Number.isFinite(value)) return ce.number(value);
  // A zero result is the float `+0`: `Math.ceil(-0.3)` is `-0`, and the
  // engine does not keep the sign of a float zero anywhere else (the
  // literal `-0.0` and the product `-1.0 · 0.0` are `+0`, and a big decimal
  // has no negative zero).
  if (args.some((x) => isNumber(x) && !x.isExact))
    return ce.number(new MachineNumericValue(value === 0 ? 0 : value));
  if (bignumPreferred(ce) && !Number.isSafeInteger(value))
    return ce.number(new MachineNumericValue(value));
  return ce.number(value);
}

/**
 * True if a number literal has no exactness to lose under D2's "inexact
 * argument numericizes" rule — the `isExact` property of a number literal.
 *
 * A number's `isExact` getter is authoritative. `ExactNumericValue`
 * represents exact complex values directly (Gaussian rationals like `1+i`,
 * `1/2+i`; pure-imaginary radicals like `√2·i`), and a complex value from
 * the host with integer parts (`ce.number(new Complex(2, 3))`) is stored
 * exact when it is created. A complex float is inexact even when both its
 * parts are integers (`1.0+1.0i`, or the result `(0.5+0.5i)·2`): it is not
 * read as exact from the values of its parts.
 *
 * Non-number-literal expressions (symbols like `Pi`, unevaluated functions)
 * are treated as exact here: they have no float to lose, and any exact
 * reduction for them is the caller's job, not this predicate's.
 */
export function isExactNumber(x: Expression): boolean {
  if (!isNumber(x)) return true;
  return x.isExact;
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

/**
 * True if a kernel result is `undefined` or a NaN number/Complex/BigDecimal —
 * the signal that the value is "outside this kernel's implemented (real)
 * domain", used to trigger a cascade to a complex-valued kernel. A boxed
 * `Expression` result is never a domain signal and never cascades.
 */
function isNaNKernelResult(r: unknown): boolean {
  if (r === undefined) return true;
  if (typeof r === 'number') return Number.isNaN(r);
  if (r instanceof Complex) return r.isNaN();
  if (r instanceof BigDecimal) return r.isNaN();
  return false;
}

/**
 * Box the big-decimal result of a kernel. When an argument is a float, the
 * result is a float, even when its value is an integer: `2.0^2` is the float
 * `4`. Otherwise an integer-valued result is exact (`boxBignumResult`).
 */
function boxKernelResult(
  ce: IComputeEngine,
  result: BigDecimal | number,
  args: ReadonlyArray<Expression>
): Expression {
  if (
    result instanceof BigDecimal &&
    args.some((x) => isNumber(x) && !x.isExact)
  )
    return ce.number(ce._numericValue(result));
  return boxBignumResult(ce, result);
}

/**
 * Box the complex result of a double kernel, `{re, im}`. When an argument is
 * a float, the result is a float, even when its value is a Gaussian integer
 * or its imaginary part is `0`: at every precision `i^{2.0}` is the float
 * `-1`, as `boxMachineNumber()` makes a real result a float.
 * `_numericValue()` makes a safe-integer `{re, im: 0}` exact, which is what
 * a caller that builds exact data wants, so the float is made here with the
 * inexact factory of the engine.
 *
 * Otherwise (every argument is exact) a real result (`im === 0`) that is a
 * safe integer is exact, as `boxMachineNumber()` makes a real result exact.
 * A result with a nonzero imaginary part is a float, even when both its
 * parts are integers: it is boxed from the plain data `{re, im}`, never from
 * a `Complex`, which `_numericValue()` reads as a value from the host and
 * makes exact when its parts are integers.
 */
export function boxComplexKernelResult(
  ce: IComputeEngine,
  value: { re: number; im: number },
  args: ReadonlyArray<Expression>
): Expression {
  // A kernel with no value gives a NaN part (a double kernel at an infinite
  // argument): the value is `NaN`, as for a real kernel. A numeric value
  // cannot hold a NaN imaginary part.
  if (Number.isNaN(value.re) || Number.isNaN(value.im)) return ce.NaN;
  if (args.some((x) => isNumber(x) && !x.isExact))
    return ce.number(
      ce._inexactNumericValue({
        re: value.re === 0 ? 0 : value.re,
        im: value.im === 0 ? 0 : value.im,
      })
    );
  return ce.number(ce._numericValue({ re: value.re, im: value.im }));
}

/**
 * The value of an operator at operands of which one at least is complex,
 * computed with the big-decimal methods of `NumericValue` (`sqrt()`, `pow()`,
 * `root()`, `ln()`, `exp()`, the arithmetic) instead of a `complex.js`
 * kernel.
 *
 * In an engine working above machine precision, a `BigNumericValue` holds
 * both parts of a complex value as big decimals, and its methods compute
 * both parts at the working precision. The `complex.js` kernels compute in
 * doubles: they give 16 digits, and they read an imaginary part too small
 * or too large for a double (`10^{-800}`, `10^{800}`) as `0` or `Infinity`.
 *
 * Each operand is converted to an inexact big-decimal value first, so an
 * exact operand is computed at the working precision. Returns `undefined` when the
 * engine works at machine precision, when an operand is a machine value (it
 * holds only doubles, so the double kernel gives the same answer), or when
 * the method gives `NaN`: the caller then uses its double kernel.
 *
 * Design note: `docs/plans/2026-09-27-big-decimal-imaginary-part.md` §2.3.
 */
export function complexNumericValueRoute(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  fn: ((...xs: NumericValue[]) => NumericValue | undefined) | undefined
): Expression | undefined {
  if (fn === undefined || !bignumPreferred(ce)) return undefined;
  const values: NumericValue[] = [];
  for (const op of ops) {
    if (!isNumber(op)) return undefined;
    const nv = op.numericValue;
    const value = (typeof nv === 'number' ? ce._numericValue(nv) : nv).N();
    if (value instanceof MachineNumericValue) return undefined;
    // `N()` keeps an exact integer (and `0`, `1`, `-1`) exact, and the
    // methods of an exact value compute a complex operand in doubles
    // (`ExactNumericValue.pow` with a complex exponent), so `2^{i·10^{-800}}`
    // would lose its imaginary part. Every operand is therefore rebuilt with
    // the inexact factory of the engine, from its big-decimal parts.
    values.push(
      ce._inexactNumericValue({
        re: value.bignumRe ?? value.re,
        im: value.bignumIm ?? value.im,
      })
    );
  }
  const result = fn(...values);
  if (result === undefined || result.isNaN) return undefined;
  return ce.number(result);
}

export function apply(
  expr: Expression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: BigDecimal) => BigDecimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex,
  numericValueFn?: (x: NumericValue) => NumericValue | undefined
): Expression | undefined {
  if (!isNumber(expr)) return undefined;
  const ce = expr.engine;

  // A `NaN` ARGUMENT propagates: the kernels use a NaN result to mean
  // "outside this kernel's implemented domain", which is why one otherwise
  // leaves the application symbolic (`isNaNKernelResult`), but a NaN that was
  // already in the argument is not a report about the domain — it is the
  // indeterminate value flowing through, and `f(NaN)` is `NaN`. Without this
  // the cascade reads the propagated NaN as a domain exit and the application
  // stays inert, which ERROR-MODEL §1 forbids as a terminal answer.
  // `applyN` carries the same guard for the n-ary kernels.
  if (Number.isNaN(expr.re) || isImaginaryPartNaN(expr)) return ce.NaN;

  let result: number | Complex | BigDecimal | undefined = undefined;
  // The test is `isComplex`, not `im !== 0`: an exact value with an
  // imaginary part too small for a double (`10^{-800}·i`) is complex and must
  // reach the complex kernel, not the real branch, which reads only `re`. The
  // complex kernels (`complex.js`) compute in doubles by nature, so they
  // receive the double projections `re` and `im`, and for that value they see
  // an imaginary part of `0`. The same rule applies in `applyN` and `apply2`.
  // Design note: `docs/plans/2026-09-27-big-decimal-imaginary-part.md` §5.
  if (expr.isComplex) {
    // An operator that has a big-decimal method (`numericValueFn`) computes
    // both parts at the working precision. Only the others use the double
    // kernel: the complex transcendental kernels stay machine precision at
    // every engine precision (decision D4 of the design note).
    const viaNumericValue = complexNumericValueRoute(
      ce,
      [expr],
      numericValueFn
    );
    if (viaNumericValue !== undefined) return viaNumericValue;
    result = complexFn?.(ce.complex(expr.re, expr.im));
  } else {
    const re = expr.re;
    const bigRe = expr.bignumRe;
    if (bigRe !== undefined && bignumPreferred(ce) && bigFn)
      result = bigFn(bigRe);
    else if (bignumPreferred(ce) && bigFn) result = bigFn(ce.bignum(re));
    else result = fn(re);

    // Cascade to the complex kernel when the real-domain kernel signals
    // "outside its domain" with NaN (e.g. `arctanh(2)`, `arcsin(2)`): the
    // value is complex for these real inputs. Mirrors `applyN`'s NaN cascade.
    if (complexFn && Number.isFinite(re) && isNaNKernelResult(result))
      result = complexFn(ce.complex(re, 0));
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex)
    return boxComplexKernelResult(ce, { re: result.re, im: result.im }, [expr]);
  if (typeof result === 'number') return boxMachineNumber(ce, result, [expr]);
  return boxKernelResult(ce, result, [expr]);
}

/**
 * The value of a function at a point iy of the imaginary axis, computed from
 * REAL kernels: `fn(y)` (and `bigFn(y)` above machine precision) give the
 * real and imaginary parts `[re, im]` of the value.
 *
 * Several functions are, on the imaginary axis, a real function of y times
 * `i`, plus a constant: erf(iy) = i·erfi(y), erfc(iy) = 1 − i·erfi(y),
 * Si(iy) = i·Shi(y), Ci(iy) = Chi(|y|) ± iπ/2. The complex kernel of such a
 * function leaves a roundoff residue in the part that is a constant (it
 * gives `erf(i)` as `2.2·10⁻¹⁶ + 1.65i`), and computes the other part in
 * doubles at every precision. The real kernels give the constant part exactly and,
 * when there is a big-decimal kernel, the other part at the working
 * precision.
 *
 * Returns `undefined` when `expr` is not a number on the imaginary axis (a
 * complex number with a real part of exactly 0, exact or float): the caller
 * then uses its general route. Returns `null` when a part of the value is
 * not finite: the value is past the number range, and the caller leaves the
 * expression unevaluated. A complex value that is too large has a direction
 * that no infinity of the engine holds (the rule of `Gamma`, see
 * `boxExpOfComplexLog()`): `erf(27i)` at machine precision, `Si(1000i)`.
 */
export function applyOnImaginaryAxis(
  expr: Expression,
  fn: (y: number) => [re: number, im: number],
  bigFn?: (y: BigDecimal) => [re: BigDecimal | number, im: BigDecimal | number]
): Expression | null | undefined {
  if (!isNumber(expr) || !expr.isComplex) return undefined;
  if (expr.re !== 0 || (expr.bignumRe !== undefined && !expr.bignumRe.isZero()))
    return undefined;
  const ce = expr.engine;
  if (Number.isNaN(expr.im) || isImaginaryPartNaN(expr)) return undefined;

  if (bigFn && bignumPreferred(ce)) {
    const [re, im] = bigFn(expr.bignumIm ?? ce.bignum(expr.im));
    const isFinite = (x: BigDecimal | number) =>
      typeof x === 'number' ? Number.isFinite(x) : x.isFinite();
    if (!isFinite(re) || !isFinite(im)) return null;
    return ce.number(ce._inexactNumericValue({ re, im }));
  }

  const [re, im] = fn(expr.im);
  if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
  return boxComplexKernelResult(ce, { re, im }, [expr]);
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

  if (ops.some((op) => Number.isNaN(op.re) || isImaginaryPartNaN(op)))
    return ce.NaN;

  let result: number | Complex | BigDecimal | undefined = undefined;

  const isNaNResult = (r: typeof result): boolean =>
    r === undefined ||
    (typeof r === 'number'
      ? Number.isNaN(r)
      : r instanceof Complex
        ? r.isNaN()
        : r.isNaN());

  if (ops.some((op) => op.isComplex)) {
    // The complex kernels of the special functions compute in doubles at
    // every engine precision (decision D4 of
    // `docs/plans/2026-09-27-big-decimal-imaginary-part.md`).
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
    // No part is removed: a small part of the value of a float argument is
    // kept, as in `apply` (ARCHITECTURE.md, "Chopping and the `im === 0`
    // convention").
    return boxComplexKernelResult(ce, result, ops);
  }
  if (typeof result === 'number') {
    if (Number.isNaN(result)) return undefined;
    return boxMachineNumber(ce, result, ops);
  }
  if (result.isNaN()) return undefined;
  return boxKernelResult(ce, result, ops);
}

export function apply2(
  expr1: Expression,
  expr2: Expression,
  fn: (x1: number, x2: number) => number | Complex,
  bigFn?: (x1: BigDecimal, x2: BigDecimal) => BigDecimal | Complex | number,
  complexFn?: (x1: Complex, x2: number | Complex) => Complex | number,
  numericValueFn?: (
    x1: NumericValue,
    x2: NumericValue
  ) => NumericValue | undefined
): Expression | undefined {
  if (!isNumber(expr1) || !isNumber(expr2)) return undefined;

  const ce = expr1.engine;

  // A `NaN` ARGUMENT propagates — the same rule as in `apply`/`applyN` above.
  // The real branch below skips a NaN operand outright, which left the
  // application with no result and therefore symbolic; that reads a
  // propagated NaN as a report about the kernel's domain, which it is not.
  if (
    Number.isNaN(expr1.re) ||
    isImaginaryPartNaN(expr1) ||
    Number.isNaN(expr2.re) ||
    isImaginaryPartNaN(expr2)
  )
    return ce.NaN;

  let result: number | Complex | BigDecimal | undefined = undefined;
  if (expr1.isComplex || expr2.isComplex) {
    // A non-real operand needs the complex kernel. Without one the
    // application stays symbolic: the real branches below read only `.re`,
    // so falling through would silently DROP the imaginary part and answer
    // the value at a different point.
    // An operator with a big-decimal method computes at the working
    // precision; the double kernel is used otherwise (decision D4, see
    // `apply`).
    const viaNumericValue = complexNumericValueRoute(
      ce,
      [expr1, expr2],
      numericValueFn
    );
    if (viaNumericValue !== undefined) return viaNumericValue;
    if (!complexFn) return undefined;
    result = complexFn(
      ce.complex(expr1.re, expr1.im),
      ce.complex(expr2.re, expr2.im)
    );
    if (result === undefined) return undefined;
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
    // No part is removed, as in `apply` and `applyN`.
    return boxComplexKernelResult(ce, result, [expr1, expr2]);
  // Do not chop a real result: a legitimately-small value (e.g. 10^-100 from
  // `Power(10, -100)`) is not roundoff noise, and chopping it to 0 is both
  // wrong and inconsistent with the single-argument `apply` above.
  if (typeof result === 'number')
    return boxMachineNumber(ce, result, [expr1, expr2]);
  return boxKernelResult(ce, result, [expr1, expr2]);
}
