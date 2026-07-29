import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import type { Rational } from '../numerics/types.js';

import type { Expression, ExpressionInput } from '../global-types.js';
import type { NumberLiteralInterface } from '../types-expression.js';
import { isExpression } from './utils.js';

import { SMALL_INTEGER } from '../numerics/numeric.js';
import { bigint } from '../numerics/bigint.js';

import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { NumericValue } from '../numeric-value/types.js';
import { bigintValue } from '../numerics/expression.js';
import { MathJsonExpression } from '../types.js';
import { isNumber } from './type-guards.js';

export function asRational(expr: Expression): Rational | undefined {
  if (!isNumber(expr)) return undefined;
  const num = expr.numericValue;
  if (typeof num === 'number' && !Number.isFinite(num)) return undefined;
  if (
    num instanceof NumericValue &&
    (num.isNaN || num.isPositiveInfinity || num.isNegativeInfinity)
  )
    return undefined;

  if (typeof num === 'number') {
    if (!Number.isInteger(num)) return undefined;
    return [num, 1];
  }

  const type = num.type;
  if (type !== 'finite_integer' && type !== 'finite_rational') return undefined;

  if (num.im !== 0) return undefined;

  if (num instanceof ExactNumericValue) {
    if (num.radical !== 1) return undefined;
    return num.rational;
  }

  const bignumRe = num.bignumRe;
  if (bignumRe !== undefined && bignumRe.isInteger())
    return [bigint(bignumRe)!, BigInt(1)];

  const re = num.re;
  if (Number.isInteger(re)) return [re, 1];

  return undefined;
}

/**
 * Extract the exact integer value of a `NumericValue`, or `null` if it does
 * not represent an exact integer.
 *
 * This reads the exact underlying representation directly — the integer
 * numerator of an `ExactNumericValue`, or the integer-valued `BigDecimal` of a
 * `BigNumericValue` (via its exact significand) — and never round-trips through
 * `bignumRe`, which is rendered at the engine's working precision and would
 * silently round any integer with more digits than `ce.precision` (corrupting
 * large-integer number theory: `IsPrime`, `FactorInteger`, `Mod`, …).
 */
function exactIntegerValue(num: NumericValue): bigint | null {
  if (num.im !== 0) return null;
  const exact = num.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  // A value of the form a/b·√c is an integer only when c = 1 (no radical).
  if (exact.radical !== 1) return null;
  const [n, d] = exact.rational;
  const bn = typeof n === 'bigint' ? n : BigInt(n);
  const bd = typeof d === 'bigint' ? d : BigInt(d);
  if (bd === BigInt(0)) return null;
  if (bn % bd !== BigInt(0)) return null; // a non-integer rational
  return bn / bd;
}

export function asBigint(
  x: Complex | BigDecimal | ExpressionInput | undefined
): bigint | null {
  if (x === undefined || x === null) return null;

  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isInteger(x)) return BigInt(x);

  if (isExpression(x)) {
    if (!isNumber(x)) return null;
    const num = x.numericValue;

    if (typeof num === 'number') {
      if (Number.isInteger(num)) return BigInt(num);
      return null;
    }

    // Extract the exact integer without a precision-limited round-trip.
    const exact = exactIntegerValue(num);
    if (exact !== null) return exact;

    if (num.im !== 0) return null;

    // Not an exact integer: only accept a genuine integer-valued float.
    if (!Number.isInteger(num.re)) return null;

    return BigInt(num.re);
  }

  if (x instanceof BigDecimal || typeof x === 'string') return bigint(x);

  if (x instanceof Complex) {
    if (x.im === 0) return bigint(x.re);
    return null;
  }

  return bigintValue(x as MathJsonExpression);
}

export function asBignum(expr: Expression | undefined): BigDecimal | null {
  if (expr === undefined || expr === null) return null;
  if (!isNumber(expr)) return null;
  const num = typeof expr === 'number' ? expr : expr.numericValue;

  if (typeof num === 'number') return expr.engine.bignum(num);

  if (num.im !== 0) return null;

  const re = num.bignumRe ?? num.re;
  if (typeof re === 'number' && isNaN(re)) return null;
  return expr.engine.bignum(re);
}

/**
 * Validate if the expression is a small integer.
 * A small integer is an integer between -SMALL_INTEGER and SMALL_INTEGER (inclusive).
 * Returns null if the expression is not a small integer.
 *
 * Unlike `toInteger()` this functions fails if the expression is not an
 * integer. `toInteger()` will round the value to the nearest integer.
 */
export function asSmallInteger(
  expr: number | Expression | undefined
): number | null {
  if (expr === undefined || expr === null) return null;
  if (typeof expr === 'number') {
    if (
      Number.isInteger(expr) &&
      expr >= -SMALL_INTEGER &&
      expr <= SMALL_INTEGER
    )
      return expr;
    return null;
  }
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;

  if (typeof num === 'number') {
    if (Number.isInteger(num) && num >= -SMALL_INTEGER && num <= SMALL_INTEGER)
      return num;
    return null;
  }

  if (num.im !== 0) return null;

  const n = num.re;
  if (Number.isInteger(n) && n >= -SMALL_INTEGER && n <= SMALL_INTEGER)
    return Number(n);
  return null;
}

/**
 * Convert a boxed expression to a machine integer.
 * Returns null if the expression cannot be converted to an integer.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 *
 * Unlike `asSmallInteger()`, this function does not restrict the result to
 * [-SMALL_INTEGER, SMALL_INTEGER], and it rounds a non-integer real part to
 * the nearest integer.
 *
 * Returns null when the result is not finite or exceeds the safe-integer range
 * (|n| > 2^53): a machine `number` cannot represent such an integer exactly, so
 * returning a rounded value would silently lose precision. Callers that need
 * the exact value of a large integer must use `toBigint()`/`asBigint()`
 * instead. (This is what makes `toInteger` unsuitable for value-semantic uses
 * such as primality testing — see `isPrime` in predicates.ts.)
 */
export function toInteger(expr: Expression | undefined): number | null {
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;
  const re = typeof num === 'number' ? num : num.re;
  if (!Number.isFinite(re)) return null;
  const n = Math.round(re);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * `toInteger` for an operand that may not have been EVALUATED yet — the
 * integer parameters a collection handler reads (a `Take` count, a
 * `RotateLeft` offset, an `InsertAt` position).
 *
 * Collection handlers are consulted on the *canonical* expression, not on an
 * evaluated one: `.at()`/`.each()`/`.count` are public on any canonical
 * expression, and the pre-evaluation broadcast in
 * `BoxedFunction._computeValue` zips raw operands. A parameter spelled `N-1`
 * is therefore still an `Add` node at that point, where a bare `toInteger`
 * answers `null` — which every call site turned into its own DEFAULT
 * (`?? 1`, `?? 0`), silently substituting a different collection:
 * `RotateLeft(S, N-1) + RotateLeft(S, N-2)` answered `2·RotateLeft(S, 1)`
 * (Tycho item 107).
 *
 * `toInteger` runs first, so a literal operand — the hot path of a drain —
 * costs nothing extra; only a symbolic operand pays one `evaluate()`. An
 * operand that is already a number literal is never re-evaluated: if it is
 * not an integer, no amount of evaluation will make it one.
 */
export function toIntegerOperand(expr: Expression | undefined): number | null {
  const n = toInteger(expr);
  if (n !== null) return n;
  if (expr === undefined || isNumber(expr)) return null;
  return toInteger(expr.evaluate());
}

/** Convert a boxed expression to a bigint.
 * Returns null if the expression cannot be converted to a bigint.
 * If the expression is a complex number, only the real part is considered.
 * If the real part is not an integer, it is rounded to the nearest integer.
 */
export function toBigint(expr: Expression | undefined): bigint | null {
  if (expr === undefined || expr === null) return null;
  if (!isNumber(expr)) return null;
  const num = expr.numericValue;

  // A non-finite value (±∞, NaN) has no bigint: return null per the
  // documented contract — `BigInt(Infinity)` throws a RangeError that would
  // escape `evaluate()` (EX-15: Fibonacci(+∞) & the integer-domain family).
  if (typeof num === 'number')
    return Number.isFinite(num) ? BigInt(Math.round(num)) : null;

  // Prefer an exact extraction for exact integers to avoid the
  // precision-limited `bignumRe` round-trip (see `asBigint`).
  const exact = exactIntegerValue(num);
  if (exact !== null) return exact;

  const n = num.bignumRe ?? num.re;
  if (typeof n === 'number')
    return Number.isFinite(n) ? BigInt(Math.round(n)) : null;

  return bigint(n.round());
}

//
// Gated numericization: "a numeric value, or nothing"
//
// These three helpers share one gate and differ only in the shape they hand
// back. Reach for the narrowest one that fits:
//
//   - `numericValueOf()`  — a finite real machine `number`
//   - `complexValueOf()`  — the `[re, im]` pair, *not* filtered for finiteness
//   - `numberLiteralOf()` — the number literal itself, when the caller needs
//                           the exact representation (`numericValue`,
//                           `bignumRe`) rather than a machine float
//

/**
 * The number literal `x` numericizes to, or `undefined` if it has none.
 *
 * **This is the gate.** An expression with free variables can never
 * numericize to a literal, so `.N()` must not even be started on one: over
 * nested applications of a user function `.N()` re-walks shared sub-chains,
 * making a discarded result cost ~2× per level of nesting — exponential, and
 * the cause of the six defects fixed on 2026-07-25/26. Checking `.unknowns`
 * first costs 2–50× less than the `.N()` it replaces (measured: 0.04 µs on a
 * literal, 1.2 µs on a small symbolic sum, against 0.12 µs / 63 µs for
 * `.N().re`), so the gate is worth paying even when it never fires.
 *
 * A symbol with an *assigned value* is not an unknown, so `sin(y)` with
 * `y := π/4` still numericizes; only genuinely free variables decline.
 *
 * ## The gate is conservative, not exact — so it is NOT universally applicable
 *
 * An expression can carry a free variable and still fold to a literal under
 * `.N()`. The easy cases are degenerate (`0·x → 0`, `x − x → 0`, `e^{0x} → 1`,
 * `Length([x, y]) → 2`), but the important ones are not: **partial
 * numericization floats the exponents**, so
 *
 * ```
 * (⁴√b / ⁴√a)² − √b / √a     →  .N()  →  0        (unknowns: a, b)
 * ```
 *
 * — a correct, genuinely useful zero-detection for an identity `simplify()`
 * cannot see. These helpers decline all of it.
 *
 * That is sound wherever "no numeric value" is the **give-up branch**: the
 * shortcut, rewrite, or acceleration is simply not taken. It is *not* sound at
 * a site whose purpose is to **probe a symbolic expression numerically** —
 * Rubi's `PossibleZeroQ` (`zeroQ` in `rubi/rubi-utils.ts`), its `PosAux` sign
 * heuristic, `numericMagnitude` (`symbolic/solver-utils.ts`), and the
 * rationalize-denominator safety gate (`symbolic/simplify-power.ts`) all
 * deliberately keep a bare `.N()` for this reason. Gating `zeroQ` was measured
 * to lose a closed form outright (integration-rules #544, the R28a
 * mixed-parity split). Before funnelling a new call site, ask which branch
 * `undefined` lands the caller in.
 *
 * (Do not move this gate inside `.N()` itself either. Partial numericization —
 * `sin(2) + x` → `x + 0.909…` — is load-bearing and pinned by ≥12 test
 * locations; see ROADMAP.md § Symbolic-evaluation performance.)
 */
export function numberLiteralOf(
  x: Expression | null | undefined
): (Expression & NumberLiteralInterface) | undefined {
  if (x === null || x === undefined) return undefined;
  if (x.unknowns.length > 0) return undefined;
  const v = x.N();
  return isNumber(v) ? v : undefined;
}

/**
 * The **finite real** machine value of `x`, or `undefined` if `x` has none.
 *
 * Declines a complex value (`im !== 0`) and a non-finite one (`±∞`, `NaN`) as
 * well as a non-numeric expression, so a returned `number` is always safe to
 * compare and arithmetic on. Callers that need `±∞` to pass through, or that
 * apply their own tolerance to the imaginary part, want
 * {@link complexValueOf}.
 *
 * See {@link numberLiteralOf} for the shared `.unknowns` gate and why it is
 * conservative.
 */
export function numericValueOf(
  x: Expression | null | undefined
): number | undefined {
  const v = numberLiteralOf(x);
  if (v === undefined || v.im !== 0) return undefined;
  const re = v.re;
  return Number.isFinite(re) ? re : undefined;
}

/**
 * The real and imaginary machine parts of `x` as `[re, im]`, or `undefined`
 * if `x` does not numericize to a literal.
 *
 * Unlike {@link numericValueOf} this does **not** filter for finiteness: `±∞`
 * and `NaN` parts are returned as-is, because the callers of this shape either
 * take a magnitude (`Math.hypot`, where `∞` must stay `∞` rather than become
 * `NaN` and silently pass a `> tolerance` reject) or apply their own
 * finiteness test. Check `Number.isFinite` yourself if you need it.
 *
 * See {@link numberLiteralOf} for the shared `.unknowns` gate.
 */
export function complexValueOf(
  x: Expression | null | undefined
): readonly [re: number, im: number] | undefined {
  const v = numberLiteralOf(x);
  return v === undefined ? undefined : [v.re, v.im];
}
