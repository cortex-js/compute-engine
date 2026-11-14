import { BigDecimal } from '../../big-decimal/index.js';

/**
 * Arbitrary-precision kernels that sum series with terms of both signs lose
 * digits to cancellation: the value is far below the largest term that went
 * into it (J₀(100) ≈ 0.02 against terms of size 10⁴⁰). `bigWithCancellation`
 * runs such a kernel and measures the loss, so the value returned carries the
 * digits asked for or is not returned.
 */

/** A value and the size of the largest quantity that went into it. */
export interface Scaled {
  value: BigDecimal;
  peak: BigDecimal;
}

/** Digits carried past the ones asked for on the first run. */
const CANCELLATION_GUARD_DIGITS = 20;

/**
 * Digits of the working precision kept between the cancellation and the
 * digits asked for: the rounding errors of a long sum add up to a few units
 * of the last digit carried.
 */
const CANCELLATION_MARGIN_DIGITS = 6;

/** Most digits added to the working precision; past this the kernel declines. */
export const CANCELLATION_MAX_EXTRA_DIGITS = 1500;

/** Runs of a kernel before it declines (each run follows the measured loss). */
const CANCELLATION_MAX_RUNS = 4;

/** The decimal order of magnitude of a non-zero value: ⌊log₁₀|x|⌋. */
export function magnitude(x: BigDecimal): number {
  return x.exponent + x._digitCount() - 1;
}

/**
 * `run(working)` evaluated at `BigDecimal.precision` plus guard digits, which
 * it must read from `BigDecimal.precision`; it returns a value with the
 * largest magnitude in its computation, or `undefined` when it declines.
 *
 * The digits lost are `log₁₀(peak / |value|)`. If the working precision
 * covers them with `CANCELLATION_MARGIN_DIGITS` to spare, the value is
 * rounded to the precision asked for. Otherwise the kernel runs again with
 * the digits it lost added, up to `CANCELLATION_MAX_EXTRA_DIGITS` and
 * `CANCELLATION_MAX_RUNS` runs; a value that is exactly zero at a working
 * precision has lost more digits than were carried and is run again with
 * double the guard. `BigDecimal.precision` is restored.
 */
export function bigWithCancellation(
  run: (working: number) => Scaled | undefined
): BigDecimal | undefined {
  const digits = BigDecimal.precision;
  let extra = CANCELLATION_GUARD_DIGITS;
  try {
    for (let attempt = 0; attempt < CANCELLATION_MAX_RUNS; attempt++) {
      BigDecimal.precision = digits + extra;
      const result = run(digits + extra);
      if (result === undefined || !result.value.isFinite()) return undefined;
      const lost = result.value.isZero()
        ? extra * 2
        : Math.max(0, magnitude(result.peak) - magnitude(result.value) + 1);
      if (!result.value.isZero() && lost + CANCELLATION_MARGIN_DIGITS <= extra)
        return result.value.toPrecision(digits);
      extra = Math.max(extra * 2, lost + CANCELLATION_GUARD_DIGITS);
      if (extra > CANCELLATION_MAX_EXTRA_DIGITS) return undefined;
    }
    return undefined;
  } finally {
    BigDecimal.precision = digits;
  }
}

/** Consecutive terms below the tolerance that end `sumByRatio`. */
const RATIO_SERIES_CONSECUTIVE = 2;

/**
 * Σ term_k for `term_{k+1} = term_k · ratio(k)` from `first` (the term of
 * index `from`), at `BigDecimal.precision`, with the largest term. The caller
 * guarantees that `|ratio(k)|` does not increase for k ≥ `from`; then once the
 * next ratio is at most ½ the tail is at most the term, so the sum ends after
 * `RATIO_SERIES_CONSECUTIVE` terms in a row at most 10^−precision times the
 * largest term with that bound holding. `undefined` past `maxTerms`.
 */
export function sumByRatio(
  first: BigDecimal,
  from: number,
  ratio: (k: number) => BigDecimal,
  maxTerms: number,
  checkTime?: () => void
): Scaled | undefined {
  const tol = new BigDecimal(`1e-${BigDecimal.precision}`);
  let term = first;
  let sum = first;
  let peak = first.abs();
  let small = 0;
  for (let k = from; k < from + maxTerms; k++) {
    checkTime?.();
    const next = ratio(k + 1).abs();
    if (next.lte(BigDecimal.HALF) && term.abs().lte(tol.mul(peak))) {
      if (++small >= RATIO_SERIES_CONSECUTIVE) return { value: sum, peak };
    } else small = 0;
    term = term.mulBounded(ratio(k));
    sum = sum.add(term);
    if (term.abs().gt(peak)) peak = term.abs();
  }
  return undefined;
}
