/**
 * Quadrature next to a singular endpoint: the extrapolation of the corner
 * shells of the adaptive Gauss–Kronrod quadrature, and the double-exponential
 * (tanh-sinh) rule.
 *
 * A double has a limited range: no node can be closer to `0` than about
 * `5e-324`, and no node can be closer to a NONZERO bound `b` than the spacing
 * of the doubles near `b` (about `1.1e-16` for `b = 1`). For a slowly
 * integrable singularity, a large part of the integral is closer to the bound
 * than that: `∫₀^δ x^(−0.999) dx = 1000·δ^0.001` is about 500 for `δ = 1e-300`,
 * so every rule that only samples the integrand gives about 508 for
 * `∫₀¹ x^(−0.999) dx = 1000`. Tanh-sinh gives 508.9, and the adaptive
 * Gauss–Kronrod quadrature 508.2.
 *
 * The integral over the part that cannot be sampled is found by
 * extrapolation, as in the QUADPACK routine `QAGS`. Each bisection of the
 * panel that touches an endpoint sheds one dyadic shell (see `shellsDiverge`
 * in `gauss-kronrod.ts`). The integral over the first corner panel is the
 * limit of the partial sums of the shell integrals. For an algebraic or
 * logarithmic singularity `x^(−p)·lnᵠx`, the shells decrease like `rᵏ·kᵠ`
 * (`r = 2^(p−1)`), and Wynn's ε-algorithm finds the limit of such partial
 * sums. When the shells decrease only like a power of `k`
 * (`1/(x·ln²x)`: the k-th shell is `1/(k·(k+1)·ln 2)`), the ε-algorithm does
 * not converge, and the Levin u-transform finds the limit.
 *
 * This module stays in the numerics layer: no imports from
 * `boxed-expression` or the engine core (zero-cycle budget).
 */

import {
  checkDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';

/** The shells shed by the bisections of the panel that touches one endpoint
 * of the adaptive Gauss–Kronrod quadrature. */
export interface CornerSeries {
  /** `shells[k]` is the integral over the k-th shell: the points at a
   * distance between `width/2^(k+1)` and `width/2^k` from the endpoint. */
  shells: number[];
  /** `shellErrors[k]` is the Gauss–Kronrod error estimate of `shells[k]`. */
  shellErrors: number[];
  /** `shellQuadpackErrors[k]` is the QUADPACK part of `shellErrors[k]`,
   * without the estimate of the null rules (`quadpackError`,
   * `gauss-kronrod.ts`). The test of the accuracy of a shell reads it (see
   * `SHELL_RELATIVE_ERROR`); the uncertainty of an extrapolation reads
   * `shellErrors`. When it is absent, the test reads `shellErrors`. */
  shellQuadpackErrors?: number[];
  /** The sum of the values and the sum of the errors of the panels of the
   * adaptive quadrature inside the corner panel before the first bisection
   * (the points at a distance less than `width` from the endpoint). */
  value: number;
  error: number;
  /** The width of the corner panel before the first bisection. */
  width: number;
  /** The endpoint. */
  endpoint: number;
  /** The last corner panel: the panel that touches the endpoint when the
   * adaptive loop stopped, with its width, its value and its error. Its
   * value is in `value` and its error in `error` only when they are finite:
   * they are not when a node of the panel rounds to a singular endpoint (see
   * `uncountedArea`). When they are finite, the error can be too small for a
   * strong singularity (see `lastPanelGap`). */
  last?: { width: number; value: number; error: number };
}

/** The result of the adaptive Gauss–Kronrod quadrature on a finite
 * interval, with the shells of the two corners. */
export interface GaussKronrodOutcome {
  estimate: number;
  error: number;
  converged: boolean;
  /** The shells at an endpoint stopped shrinking (`shellsDiverge`). */
  divergent: boolean;
  /** The refinement stopped on the spacing of the doubles while the tail at
   * an endpoint was not shown to shrink (`tailUnresolved`). */
  unresolved: boolean;
  /** The sum of the magnitudes of the values of the panels: the scale of the
   * integrand, which bounds the absolute tolerance. */
  magnitude: number;
  /** The integrand is `NaN` on a set that is not some isolated points, and
   * its finite samples next to that set are not of rounding size: a bisected
   * panel and its two children each have a majority of `NaN` samples (see
   * `adaptiveFinite`, `gauss-kronrod.ts`). `estimate` and `error` are then
   * `NaN`. */
  nanRegion?: true;
  /** The deepest panel whose distance to each endpoint is more than twice
   * its width, when the adaptive loop bisected it at least
   * `INTERIOR_SITE_DEPTH` times (see `gauss-kronrod.ts`): the refinement
   * went deep at a point inside the interval, which is the signature of a
   * singularity there. The shells left by the bisection toward a singular
   * endpoint are at a distance of one width from it, and are not such a
   * panel. */
  interiorSite?: { a: number; b: number };
  lo: CornerSeries;
  hi: CornerSeries;
}

export interface QuadratureResult {
  estimate: number;
  error: number;
  converged: boolean;
  divergent: boolean;
  /** Set with `divergent` when the shells at an endpoint oscillate without
   * shrinking (`shellTrend`): the integral has no value, and no sign (it is
   * not `+∞` or `−∞`), so a caller must not look for the sign of a pole at
   * the bound. */
  oscillates?: true;
  /** The value next to a singular endpoint was found by the extrapolation
   * of the shells, and two extrapolations agree. `error` is then the error
   * of the extrapolation, which can be larger than the tolerance (but at
   * most `EXTRAPOLATED_RELATIVE_ERROR` times the magnitude of the estimate):
   * such a result is not `converged`, but its error is an estimate of the
   * true error, not a lower bound. */
  extrapolated?: boolean;
  /** Set on a result that did not converge, is not `extrapolated` and is
   * not `divergent`, and whose error is finite, when an endpoint is a
   * singular corner (at least `SINGULAR_SHELLS` shells) that this module
   * could not resolve, and the shells of each singular corner have one sign
   * (an algebraic or logarithmic singularity, not an oscillation).
   * `error` is then widened to cover the difference with tanh-sinh and the
   * uncertainty of the corners. A caller must not replace such a result by
   * a Monte-Carlo estimate: uniform samples under-weight the neighborhood of
   * the singularity, and Monte Carlo gave `0.3220 ± 0.0063` for
   * `∫₀^0.01 dx/(x·(−ln x)·ln²(−ln x)) = 0.6548…`, where this result is
   * `0.5028 ± 0.223`. */
  singularCorner?: true;
}

/**
 * The smallest number of shells at a corner that makes the corner
 * "singular": the adaptive loop bisected the panel at that endpoint at least
 * this many times. A smooth integrand converges on the 16 starting panels
 * with few bisections, and they are seldom all at the same corner. Below this
 * count, the result of the adaptive quadrature is used without change, so a
 * smooth integrand pays nothing for this module.
 */
const SINGULAR_SHELLS = 8;

/** The smallest number of shells that the extrapolation uses. */
const MIN_EXTRAPOLATION_SHELLS = 12;

/**
 * A shell is accurate when its width is at least this many times the spacing
 * of the doubles at the endpoint (`|endpoint|·2⁻⁵²`, or the smallest
 * denormal at 0). The nodes of a narrower shell are rounded to the doubles,
 * so its Gauss–Kronrod value is off by about the spacing over the width
 * (relative). For `(1 − t)^(−0.95)·ln(1 − t)` next to 1, the 49th shell
 * (width `2⁻⁵³`) is off by 30 %, and the extrapolation of all 49 shells
 * gives a wrong value. This bound keeps 28 shells.
 */
const ACCURATE_SHELL_SPACINGS = 2 ** 20;

/**
 * The largest relative Gauss–Kronrod error of a shell that the
 * extrapolation uses. A shell of an integrand that oscillates without bound
 * at the endpoint (`sin(1/x)` at 0) is not accurate, and the extrapolation of
 * such shells gives a wrong value: with the 19 shells of `∫₀¹ sin(1/x) dx`,
 * two orders of the ε-algorithm agree to 1e-5 on a value that is off by
 * 2e-3.
 */
const SHELL_RELATIVE_ERROR = 1e-8;

/** The first shell of the Levin u-transform. */
const LEVIN_START = 8;

/** The largest number of partial sums in the table of the ε-algorithm. More
 * entries amplify the rounding errors of the shells. */
const EPSILON_SUMS = 20;

/**
 * The largest relative difference between two extrapolations of the same
 * corner (two orders of one method, or the two methods) that accepts them.
 * The difference is relative to the larger magnitude of the two values. It is
 * not relative to the sum of the magnitudes of the shells: for shells that
 * grow, that sum is huge, and two values that differ by more than their own
 * size were accepted (`sin(ln x)/x^1.1` at 0 gave `−2.2e13` with an error of
 * `2.8e17`).
 *
 * Measured on `x^(−p)·lnᵠx` at 0 and at 1 and on `x^(−1.01)` at `∞`, the
 * two accepted extrapolations differ by at most `7e-10` (relative). The
 * divergent series of the shells of `1/(x·ln x)` at 0 makes the two orders
 * of the ε-algorithm differ by `7e-4` (330 panels) to `5e-2` (1500 panels).
 */
const EXTRAPOLATION_AGREEMENT = 1e-6;

/**
 * The factor applied to the difference of the two accepted extrapolations to
 * give the error of the extrapolation. Two orders that agree can both be
 * off by more than their difference: on `∫₀¹ x^(−0.999) dx` the true error
 * of the result is 2.6 times the difference.
 */
const EXTRAPOLATION_SAFETY = 10;

/**
 * The smallest exponent `α` of a decrease `1/kᵅ` of the shells that lets the
 * Levin u-transform be used. A divergent series such as the shells of
 * `1/(x·ln x)` (`α = 1`) also gives stable Levin values, which are not the
 * value of anything. The shells of `1/(x·ln²x)` have `α = 2`.
 */
const LEVIN_MIN_DECAY = 1.5;

/**
 * The largest difference, in natural logarithm, between the logarithm of a
 * shell and the model `ln C + q·ln(k + β) + ρ·k` fitted to the last half of
 * the shells (see `shellTrend`). Measured on `x^(−p)·lnᵠx` at 0 and at 1
 * (`q` up to 3), `1/(x·ln²x)` at 0, `1/√(1 − x²)` at 1 and `x^(−1.01)` at
 * `∞`, the largest difference is `3.2e-4` (`(1 − t)^(−0.95)·ln(10⁻³·(1 − t))`,
 * whose logarithm has a shifted scale). A peak that the shells have not
 * passed yet (`1/(10⁻¹² + x²)`: the shells double until the distance to 0 is
 * about `10⁻⁶`, then they halve) gives `4e-2` to `9e-2`. The 28 shells next
 * to 1 of `sin(0.1·ln(1 − t))/(1 − t)` (no value) cover less than half a
 * period of the oscillation, have one sign, and give `8.7e-3`.
 */
const SHELL_MODEL_RESIDUAL = 1e-3;

/**
 * The largest rate `ρ` of the model of `shellTrend` that is read as "no
 * geometric growth" when the shells decrease like a power of `k`. The fit
 * gives a small positive `ρ` for `1/(x·ln²x)`, where the true rate is 0:
 * `2.4e-4` with 84 shells, `1.9e-5` with 314 shells.
 */
const SHELL_RATE_TOLERANCE = 1e-3;

/**
 * For shells that change sign: the largest ratio of the largest magnitude of
 * a shell in the last quarter of the shells to the largest magnitude in the
 * first quarter. The shells of `sin(ln x)/x` at 0 oscillate with a constant
 * amplitude (the integral has no value), and the extrapolation of their
 * partial sums gives a value (`−1` or `−1.0876`, according to the number of
 * shells) that is not the value of anything.
 */
const SHELL_ENVELOPE_DECAY = 0.5;

/**
 * For shells that change sign: the largest relative residual of the fit of
 * the recurrence `shell(k + 2) = p·shell(k + 1) + q·shell(k)` that reads as
 * "the shells are two geometric terms" (see `oscillationRate`). Next to an
 * endpoint where the integrand is `x^(−a)` times a sine or a cosine of
 * `c·ln x` (`sin(ln x)/x` at 0), the shells are exactly
 * `Re(C·z^k)` with `z = 2^(a − 1)·e^(±i·c·ln 2)`, and the residual is the
 * rounding of the shells: `1e-15` to `2e-14`, and `1.5e-9` for the 27
 * shells next to the endpoint 1 of `sin(ln(1 − t))/(1 − t)`.
 */
const TWO_TERM_RESIDUAL = 1e-6;

/**
 * For shells that are two geometric terms (`TWO_TERM_RESIDUAL`): the largest
 * distance of the rate `|z|` of the terms to 1 that reads as "the
 * oscillation does not shrink". The terms of a convergent series tend to 0,
 * so such shells have no limit, and the integral has no value. The fitted
 * rate of `sin(ln x)/x` at 0 is 1 within `4e-15`, and within `7.4e-11` next
 * to the endpoint 1; the rate of `cos(ln x)/x^0.9999` (a convergent
 * integral, `1.0e-4`) is `1 − 6.9e-5`. A convergent integral whose rate is
 * closer to 1 than this is given no value.
 */
const STEADY_RATE_TOLERANCE = 1e-8;

/**
 * The rate `|z|` of shells that change sign and are two geometric terms
 * `Re(C·z^k)` with a complex `z`: the shells of `x^(−a)` times a sine or a
 * cosine of `c·ln x` next to 0. The rate is `√(−q)` for the fit by least
 * squares of the recurrence `shell(k + 2) = p·shell(k + 1) + q·shell(k)`
 * over `shells`, when its relative residual is at most `TWO_TERM_RESIDUAL`
 * and the roots of `z² − p·z − q` are not real. `undefined` otherwise: the
 * oscillation is of another kind (`sin(1/x)` at 0), or the shells are too
 * few.
 */
function oscillationRate(shells: number[]): number | undefined {
  const n = shells.length;
  if (n < 6) return undefined;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  let norm = 0;
  for (let k = 0; k + 2 < n; k++) {
    const [s0, s1, s2] = [shells[k], shells[k + 1], shells[k + 2]];
    a11 += s1 * s1;
    a12 += s1 * s0;
    a22 += s0 * s0;
    b1 += s2 * s1;
    b2 += s2 * s0;
    norm += s2 * s2;
  }
  const det = a11 * a22 - a12 * a12;
  if (!(Math.abs(det) > 0) || !(norm > 0)) return undefined;
  const p = (b1 * a22 - b2 * a12) / det;
  const q = (a11 * b2 - a12 * b1) / det;
  if (!(p * p + 4 * q < 0)) return undefined;
  let residual = 0;
  for (let k = 0; k + 2 < n; k++) {
    const e = shells[k + 2] - p * shells[k + 1] - q * shells[k];
    residual += e * e;
  }
  if (!(Math.sqrt(residual / norm) <= TWO_TERM_RESIDUAL)) return undefined;
  return Math.sqrt(-q);
}

/**
 * Whether the shells `shells` (counted from a distance `2^(−β)` to the
 * endpoint) decrease as the shells of a convergent series do, so that the
 * limit of their partial sums can be found by extrapolation (`'converges'`),
 * or oscillate without shrinking, so that the integral has no value
 * (`'oscillates'`), or neither (`'unknown'`).
 *
 * - When the last half of the shells changes sign (or vanishes): the shells
 *   converge when the largest magnitude in the last quarter is at most
 *   `SHELL_ENVELOPE_DECAY` times the largest magnitude in the first quarter.
 *   Otherwise, when the last half is two geometric terms
 *   (`oscillationRate`), they converge when the rate of the terms is less
 *   than 1, and oscillate when it is 1 or more (`STEADY_RATE_TOLERANCE`).
 *   Other shells give `'unknown'`.
 * - When the last half of the shells has one sign: the model
 *   `|shell k| = C·(k + β)^q·e^(ρ·k)` is fitted by least squares to the
 *   logarithms of the last half of the shells. The shells converge when the
 *   fit is close (`SHELL_MODEL_RESIDUAL`), and the model is the term of a
 *   convergent series: `ρ < 0` (a geometric decrease, perhaps with a power
 *   of `k`: `x^(−p)·lnᵠx` gives `ρ = (p − 1)·ln 2`, `q = ᵠ`), or `ρ ≈ 0` and
 *   `q ≤ −LEVIN_MIN_DECAY` (`1/(x·ln²x)`: `q = −2`). Only the last half
 *   decides: a sign change in the first shells (`x^(−0.999)·(ln x + 10)`
 *   changes sign at `x = e^(−10)`) does not.
 *
 * Without this test, the ε-algorithm turned the GROWING shells of
 * `∫₀¹ dx/(10⁻¹² + x²)` (each shell is twice the previous one until the
 * distance to 0 is about `10⁻⁶`) into the antilimit `−1`, for an integral of
 * `1570795.33`, and the oscillating shells of `∫₀¹ sin(ln x)/x dx` (no
 * value) into `−1` or `−1.0876`, according to the number of shells.
 */
function shellTrend(
  shells: number[],
  beta: number
): 'converges' | 'oscillates' | 'unknown' {
  const n = shells.length;
  const from = Math.floor(n / 2);
  const tail = shells.slice(from);
  const oneSign = tail.every((v) => v > 0) || tail.every((v) => v < 0);
  if (!oneSign) {
    const block = Math.max(3, Math.floor(n / 4));
    let first = 0;
    let last = 0;
    for (let k = 0; k < block; k++) {
      first = Math.max(first, Math.abs(shells[k]));
      last = Math.max(last, Math.abs(shells[n - 1 - k]));
    }
    if (last <= SHELL_ENVELOPE_DECAY * first) return 'converges';
    // The envelope shrinks slowly or not at all. Only two geometric terms
    // show which: their rate is found to the rounding of the shells. The
    // ε-algorithm finds the limit of the partial sums of two geometric terms
    // whose rate is less than 1 (`cos(ln x)/x^0.999` at 0). A largest
    // magnitude in the last quarter close to the one in the first quarter
    // does not show that the envelope does not shrink: that of
    // `cos(ln x)/x^0.999` is `0.96` times the first with 84 shells.
    const rate = oscillationRate(tail);
    if (rate === undefined) return 'unknown';
    if (rate >= 1 - STEADY_RATE_TOLERANCE) return 'oscillates';
    return 'converges';
  }

  // The least-squares fit of `ln|shell k| = c + q·ln(k + β) + ρ·k` over the
  // last half of the shells, by the normal equations (3 × 3).
  const m = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const rows: number[][] = [];
  for (let k = from; k < n; k++) {
    const row = [1, Math.log(k + beta), k, Math.log(Math.abs(shells[k]))];
    rows.push(row);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 4; j++) m[i][j] += row[i] * row[j];
  }
  // Gauss–Jordan elimination with partial pivoting.
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    if (!(m[c][c] !== 0)) return 'unknown';
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const factor = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= factor * m[c][j];
    }
  }
  const [c0, q, rho] = [
    m[0][3] / m[0][0],
    m[1][3] / m[1][1],
    m[2][3] / m[2][2],
  ];
  if (!Number.isFinite(c0) || !Number.isFinite(q) || !Number.isFinite(rho))
    return 'unknown';
  for (const [, lk, k, y] of rows)
    if (!(Math.abs(c0 + q * lk + rho * k - y) <= SHELL_MODEL_RESIDUAL))
      return 'unknown';
  if (rho < 0) return 'converges';
  return rho <= SHELL_RATE_TOLERANCE && q <= -LEVIN_MIN_DECAY
    ? 'converges'
    : 'unknown';
}

/**
 * Wynn's ε-algorithm on the partial sums `s`: the last entry of the highest
 * even column of the table, or `undefined` when no entry is finite.
 */
export function wynnEpsilon(s: number[]): number | undefined {
  const n = s.length;
  if (n < 3) return undefined;
  let previous: number[] = new Array(n + 1).fill(0);
  let current = s.slice();
  let best: number | undefined;
  for (let column = 1; current.length > 1; column++) {
    const next: number[] = [];
    for (let i = 0; i + 1 < current.length; i++)
      next.push(previous[i + 1] + 1 / (current[i + 1] - current[i]));
    // A column with a non-finite entry ends the table: a difference of 0 (a
    // series that has already converged, or a cancellation) gives an
    // infinite entry, and the entries after it are not defined.
    if (!next.every(Number.isFinite)) break;
    if (column % 2 === 0) best = next[next.length - 1];
    previous = current;
    current = next;
  }
  return best;
}

/**
 * The Levin u-transform of order `k` of the partial sums `s`, from the sum of
 * index `n` to the sum of index `n + k`. `s[i]` is the sum of the terms of
 * index 0 to `i`; the term index is offset by `beta`.
 */
export function levinU(
  s: number[],
  n: number,
  k: number,
  beta: number
): number | undefined {
  if (n < 1 || n + k >= s.length) return undefined;
  let numerator = 0;
  let denominator = 0;
  let binomial = 1;
  for (let j = 0; j <= k; j++) {
    const term = s[n + j] - s[n + j - 1];
    const omega = (beta + n + j) * term;
    if (!(omega !== 0) || !Number.isFinite(omega)) return undefined;
    const c =
      (j % 2 === 0 ? 1 : -1) *
      binomial *
      Math.pow((beta + n + j) / (beta + n + k), k - 1);
    numerator += (c * s[n + j]) / omega;
    denominator += c / omega;
    binomial = (binomial * (k - j)) / (j + 1);
  }
  const v = numerator / denominator;
  return Number.isFinite(v) ? v : undefined;
}

/**
 * The integral over the part of a corner that the shells do not cover, by
 * extrapolation of the partial sums of the shells.
 *
 * Returns `value`, the integral over the corner panel before the first
 * bisection (the limit of the partial sums of the shells), with its `error`
 * when two extrapolations agree. Otherwise returns `spread`, a measure of
 * the uncertainty of the integral over the corner panel: the largest
 * difference between the value of the panels of the corner and a value that
 * an extrapolation gave, or, when the shells do not decrease as a convergent
 * series does, the range of the partial sums of the last half of the shells
 * (the values of the extrapolations are then antilimits, which can be
 * anything: `8.96e13` for `∫₀¹ dx/(10⁻⁶ + x)`). `spread` is 0 when there are
 * too few accurate shells.
 *
 * When the extrapolations do not agree, or the trend of the shells is not
 * known, `value` can also be the sum of the shells plus the tail of a model
 * of the shells (see `shellTail`). When no model is accepted, `spread`
 * includes the part of the corner past the last accurate shell, estimated
 * from the tail of a power fitted to the shells. `oscillates` is set when
 * the shells oscillate without shrinking (see `shellTrend`): the integral
 * has no value.
 */
export function extrapolateCorner(
  corner: CornerSeries
):
  | { ok: true; value: number; error: number }
  | { ok: false; spread: number; oscillates?: true } {
  const { count: n, wide, accurate } = accurateShells(corner);
  if (n < MIN_EXTRAPOLATION_SHELLS) return { ok: false, spread: 0 };
  // An inaccurate shell followed by accurate ones is not the start of the
  // behavior next to the endpoint: the integrand has a feature at that
  // distance from the endpoint, and a model of the shells before it does not
  // describe the shells after it. For `(x < 0.3 ? 0 : 1) + |x − c|^(−1/2)`
  // with `c = 0.3 + 1e-6`, the shell that holds the step at 0.3 next to the
  // singular endpoint `c` was inaccurate, the extrapolation of the shells
  // before it left out the strip `[0.3, c]`, and the result was `± 3.1e-12`
  // for a true error of `1e-6`. The corner then keeps the value of its
  // panels, unless the shells oscillate (`shellTrend` below): the shells of
  // `sin(3·ln t)/t` next to 0 include inaccurate shells whose value is near
  // 0, between accurate ones.
  let featureAfterShells = false;
  for (let k = n + 1; k < corner.shells.length && wide(k); k++)
    if (accurate(k)) {
      featureAfterShells = true;
      break;
    }
  const shells = corner.shells.slice(0, n);
  // The index of a shell counted from a distance of 1 to the endpoint is
  // `k + beta` (see the Levin u-transform below).
  const beta = Math.max(1, Math.log2(1 / corner.width));

  const sums: number[] = [];
  let sum = 0;
  let magnitude = 0;
  let shellError = 0;
  for (let k = 0; k < n; k++) {
    sum += shells[k];
    magnitude += Math.abs(shells[k]);
    shellError += corner.shellErrors[k];
    sums.push(sum);
  }

  // Shells that decrease too slowly for the ε-algorithm and the Levin
  // u-transform: the limit is the sum of the shells plus the tail past the
  // last accurate shell, from a model of the shells (see `shellTail`). When
  // no model is accepted, the tail past the last shell is part of the
  // uncertainty of the value of the corner: `missing` is the difference
  // between the value of the corner and the sum of the shells plus the tail
  // of the power model, plus twice that tail, or 0 when the power model has
  // no finite tail. The tail of a power fitted to shells that are not a
  // power can be off by more than its own size: for `((−ln t)^(−1.1) +
  // (−ln t)^(−1.6))/t` at 0 on `[0, ½]`, the missing tail is 1.18 times the
  // tail of the power model, and for `1/(x·(−ln x)·ln²(−ln x))` at 0 on
  // `[0, 0.01]`, whose shells decrease more slowly than any power, it is 2.04
  // times that tail (`0.152` for `0.0744`). Without `missing`, the result
  // was `7.24 ± 0.39` for the integral `12.45`.
  const modelled = ():
    | { ok: true; value: number; error: number }
    | { ok: false; missing: number } => {
    const t = shellTail(shells, beta);
    if (t.ok)
      return {
        ok: true,
        value: sum + t.tail,
        error: Math.max(t.error, 4 * Number.EPSILON * magnitude) + shellError,
      };
    const missing =
      t.tail === undefined
        ? 0
        : Math.abs(sum + t.tail - corner.value) + 2 * Math.abs(t.tail);
    return { ok: false, missing: Number.isFinite(missing) ? missing : 0 };
  };

  // Shells that do not decrease as a convergent series does have no limit to
  // find (see `shellTrend`).
  const trend = shellTrend(shells, beta);
  if (featureAfterShells && trend !== 'oscillates')
    return { ok: false, spread: 0 };
  if (trend !== 'converges') {
    let missing = 0;
    if (trend === 'unknown') {
      const m = modelled();
      if (m.ok) return m;
      missing = m.missing;
    }
    const recent = sums.slice(Math.floor(n / 2));
    const spread = Math.max(Math.max(...recent) - Math.min(...recent), missing);
    return trend === 'oscillates'
      ? { ok: false, spread, oscillates: true }
      : { ok: false, spread };
  }

  // Two orders of each method. The ε-algorithm uses the last `EPSILON_SUMS`
  // sums, and the same number of sums one shell earlier.
  const m = Math.min(EPSILON_SUMS, n - 1);
  const epsilonUpTo = (end: number): Extrapolation =>
    extrapolation(sums, end - m, end, (s) =>
      wynnEpsilon(s.slice(end - m, end))
    );
  const epsilon = [epsilonUpTo(n), epsilonUpTo(n - 1)];

  // The Levin u-transform uses the term index of a shell from a distance of
  // 1 to the endpoint (`beta`): the k-th term of `1/(x·ln²x)` is
  // `1/(k·(k+1)·ln 2)` with that index. Orders 3 and 4, from the shells
  // `LEVIN_START` and `2·LEVIN_START`: from a later shell, the differences
  // of the transform cancel and lose the digits (from the shell 1000, two
  // orders differ by 1e-2).
  // The transform of order `k` from the shell `start` reads the sums
  // `start − 1` to `start + k`.
  const levin: Extrapolation[] = [];
  if (shellDecayExponent(shells, beta) >= LEVIN_MIN_DECAY)
    for (const start of [LEVIN_START, 2 * LEVIN_START])
      for (const order of [3, 4])
        levin.push(
          extrapolation(sums, start - 1, start + order + 1, (s) =>
            levinU(s, start, order, beta)
          )
        );

  let spread = 0;
  for (const { value: v } of [...epsilon, ...levin])
    if (v !== undefined) spread = Math.max(spread, Math.abs(v - corner.value));

  // The pair that agrees best: the two orders of one method, or one order
  // of each method. When the shells decrease as a power of their index
  // (`powerDecay`), only the Levin u-transform is used: the ε-algorithm
  // finds the limit of partial sums that converge geometrically, not of
  // partial sums that converge as a power of the index, and two of its
  // orders can agree on a wrong value. For `∫₀^½ dx/(x·(−ln x)³)`, the two
  // orders of the ε-algorithm agreed to `1.2e-9` on a value that is off by
  // `1.7e-7`, and the result was `1.040684324 ± 0.000000012` (the integral
  // is `1/(2·ln²2) = 1.0406844905…`). The Levin values were within `5e-9`.
  const powerDecay = levin.length > 0 && shellsDecayAsPower(shells, beta);
  type Candidate = Extrapolation | undefined;
  const pairs: [Candidate, Candidate][] = powerDecay
    ? [
        [levin[0], levin[1]],
        [levin[2], levin[3]],
        [levin[0], levin[2]],
      ]
    : [
        [epsilon[0], epsilon[1]],
        [levin[0], levin[1]],
        [levin[2], levin[3]],
        [levin[0], levin[2]],
        [epsilon[0], levin[2]],
      ];
  // A pair whose value is not stable under the rounding of the sums (an
  // infinite `roundingSensitivity`) is not used: the next pair, or the model
  // of the shells when no pair is left, gives the value.
  let best:
    { value: number; difference: number; sensitivity: number } | undefined;
  for (const [x, y] of pairs) {
    if (x?.value === undefined || y?.value === undefined) continue;
    const difference = Math.abs(x.value - y.value);
    const scale = Math.max(Math.abs(x.value), Math.abs(y.value));
    if (!(difference <= EXTRAPOLATION_AGREEMENT * scale)) continue;
    if (best !== undefined && !(difference < best.difference)) continue;
    const sensitivity = roundingSensitivity(x, sums);
    if (Number.isFinite(sensitivity))
      best = { value: x.value, difference, sensitivity };
  }
  if (best === undefined) {
    const m = modelled();
    return m.ok ? m : { ok: false, spread: Math.max(spread, m.missing) };
  }

  // The error is the difference of the two extrapolations, enlarged, plus
  // the errors of the shells, and at least the rounding error of the sum of
  // the shells and the change of the extrapolation that the rounding of the
  // sums gives (see `roundingSensitivity`).
  const error =
    Math.max(
      EXTRAPOLATION_SAFETY * best.difference,
      best.sensitivity,
      4 * Number.EPSILON * magnitude
    ) + shellError;
  return { ok: true, value: best.value, error };
}

/**
 * An extrapolation of the partial sums of the shells: its `value` (or
 * `undefined` when the method gives no value), the function `of` that
 * computes it from the sums, and the range of the sums that it reads, from
 * `from` (included) to `to` (excluded).
 */
type Extrapolation = {
  value: number | undefined;
  from: number;
  to: number;
  of: (sums: number[]) => number | undefined;
};

function extrapolation(
  sums: number[],
  from: number,
  to: number,
  of: (sums: number[]) => number | undefined
): Extrapolation {
  return { value: of(sums), from, to, of };
}

/**
 * The change of an extrapolation when the partial sums that it reads change
 * by their rounding error: the sum, over each sum `s` that it reads, of the
 * change of the extrapolated value when `s` alone becomes `s·(1 + ε)`.
 *
 * The rounding of a partial sum is up to half an ulp of the sum. When the
 * shells decrease slowly, the extrapolation amplifies that rounding. Two
 * orders of the ε-algorithm that read almost the same sums change in the
 * same way, so their difference does not show it. The shells of
 * `∫₀¹ x^(−p) dx` next to 0 have the ratio `2^(p − 1)`. For `p = 0.9998`, the
 * two orders differ by `1.5e-9`, the true error of the result is `3.4e-7`,
 * and this sum of changes is `8.6e-7`. For `p = 0.9999`, the two orders
 * differ by `3.5e-8`, the true error is `1.06e-6`, and this sum of changes is
 * `1.5e-5`.
 *
 * The amplification of the estimated errors of the shells is not counted:
 * the estimates are much larger than the true errors. For `p = 0.9999`, each
 * of the 1019 shells is within one ulp of its exact value (about `1e-16`
 * relative), and the sum of their estimated errors is `7.2e-10`, about
 * `1e-12` relative to each shell. A change of each of the last 20 shells by
 * its mean estimated error (`7e-13`) changes the extrapolation by a total of
 * `4.2e-5`, 40 times the true error.
 *
 * An extrapolation that gives no value after the change of one sum is not
 * stable, and the result is `+∞`.
 */
function roundingSensitivity(x: Extrapolation, sums: number[]): number {
  if (x.value === undefined) return Infinity;
  const s = sums.slice();
  let total = 0;
  for (let i = x.from; i < x.to; i++) {
    const original = s[i];
    s[i] = original + Number.EPSILON * Math.abs(original);
    const v = x.of(s);
    s[i] = original;
    if (v === undefined) return Infinity;
    total += Math.abs(v - x.value);
  }
  return total;
}

/**
 * The shells of a corner that the extrapolation uses (`extrapolateCorner`):
 * the first `count` shells, each accurate and wide. A shell is accurate when
 * it is finite (a shell next to the endpoint can overflow, `x^(−0.999)` is
 * `+∞` at a denormal `x`) and its error is at most `SHELL_RELATIVE_ERROR`
 * relative, and wide when its width is at least `ACCURATE_SHELL_SPACINGS`
 * spacings of the doubles at the endpoint, so that the rounding of its nodes
 * does not matter. The value of the corner nearer to the endpoint than
 * `corner.width/2^count` comes from the extrapolation.
 */
function accurateShells(corner: CornerSeries): {
  count: number;
  wide: (k: number) => boolean;
  accurate: (k: number) => boolean;
} {
  const spacing = Math.max(
    Math.abs(corner.endpoint) * Number.EPSILON,
    Number.MIN_VALUE
  );
  const wide = (k: number) =>
    corner.width / 2 ** (k + 1) >= ACCURATE_SHELL_SPACINGS * spacing;
  // The error of the shell must also be finite: `shellQuadpackErrors` can be
  // finite for a shell whose error is `+∞` (a node position that is not
  // finite, see `gk15`), and the sum of the shell errors would be `+∞`.
  const accurate = (k: number) =>
    Number.isFinite(corner.shells[k]) &&
    Number.isFinite(corner.shellErrors[k]) &&
    (corner.shellQuadpackErrors ?? corner.shellErrors)[k] <=
      SHELL_RELATIVE_ERROR * Math.abs(corner.shells[k]) + Number.MIN_VALUE;
  let count = 0;
  while (count < corner.shells.length && accurate(count) && wide(count))
    count++;
  return { count, wide, accurate };
}

/** The smallest width of a shell that `uncountedArea` reads, in units of
 * `|endpoint|·ε` (at least the spacing of the doubles at the endpoint).
 * The nodes of a narrower shell are rounded to the doubles. Measured on
 * `(x − 10⁶)^(−p)` next to `10⁶` (`p = 0.1` and `0.5`), the relative error of
 * a shell of 2 to 32 units of `|endpoint|·ε` is at most `8e-4`, and of a
 * shell of 1 unit `8e-3`. With 4 units or more instead of 2, the deepest
 * shells that `uncountedArea` read were too far from the endpoint to see a
 * second term: `(x − e)^(−1/2)·(x − e − 10⁻⁵)` with `e = 10⁹` was
 * `± 6.4e-9` for a true error of `7.2e-9` (`± 2.8e-8` with 2 units). */
const UNCOUNTED_MODEL_SPACINGS = 2;

/** The largest relative difference between the three ratios of four
 * consecutive shells that `uncountedArea` reads as one geometric
 * decrease. */
const UNCOUNTED_RATIO_SPREAD = 1e-2;

/** The factor applied to the area of the model in `uncountedArea`. */
const UNCOUNTED_SAFETY = 2;

/**
 * A bound of the integral over the last corner panel, `[0, δ]` from the
 * endpoint (`δ = corner.last.width`), when the value or the error of
 * that panel is not finite, so that the result of the adaptive quadrature
 * does not count it. Else 0.
 *
 * Next to a singular endpoint `e` far from 0, the bisections of the corner
 * panel stop at the spacing of the doubles at `e`: a node of the last panel
 * rounds to `e`, where the integrand is not finite, and that panel is left
 * out. For `(x − e)^(−p)` this is the area `u^(1−p)/(1 − p)` of the first
 * double `u` above `e`. Tanh-sinh leaves it out too (its nodes that round to
 * `e` are left out). Without this bound, `∫ (x − 10⁶)^(−0.9) dx` on
 * `[10⁶, 10⁶ + 1]` was `± 0.12` for a true error of `1.03`, and
 * `∫ (x − 10⁶)^(−0.1) dx` was `converged`, `± 5.7e-11`, for a true error of
 * `7e-10`. Next to 0 the last panel is left out only when the integrand
 * overflows at its nodes, which are denormals: for
 * `x^(−0.97)·(x < 10⁻⁴ ? 2 : 1)` on `[0, 1]`, the last panel
 * `[0, 5.2e-318]` holds `2.0e-8`, and the result was `± 2.6e-9` for a true
 * error of `2.0e-8`. When the extrapolation of the shells is used, it
 * replaces the whole corner, this panel included.
 *
 * The model: next to an endpoint where `|f| ≈ A·x^(−p)`, the shells decrease
 * geometrically, each `r = 2^(p − 1)` times the one before, and the integral
 * over `[0, D]` is the sum of the geometric tail: `s·r^m/(1 − r)` for a
 * shell `s` that covers `[2^(m−1)·D, 2^m·D]`. The ratio `r` is read from
 * the three ratios of four consecutive shells that have one sign and are at
 * least `UNCOUNTED_MODEL_SPACINGS` spacings wide: the deepest such shells,
 * or, when their ratios give no model, the next ones toward the interior.
 * When the ratios agree to `UNCOUNTED_RATIO_SPREAD`, `r` is the largest. When
 * they fall toward the endpoint (two terms, the deeper one more singular,
 * as for `(x − e)^(−0.9)·(x − e − 10⁻⁷)` next to `e = 10⁶`, ratios `0.988`,
 * `0.962`, `0.943`), `r` is the deepest ratio plus that margin: the next
 * ratios are smaller. Ratios that rise toward the endpoint, or shells that
 * change sign (a zero of a smooth factor), give no model. The result is
 * `UNCOUNTED_SAFETY` times the area of the model. A ratio of at least 1 is a
 * singularity that is not integrable, and the bound is `+∞`. When no four
 * shells give a model, the bound is 0. When the shells decrease as a power of
 * their index (a logarithmic singularity such as `1/(x·ln²x)`), the bound is
 * also at least `UNCOUNTED_SAFETY` times the area of that power
 * (`powerCornerArea`), because the geometric tail is then too small.
 *
 * A pole some doubles outside the interval does not make the last panel
 * infinite (the integrand is finite at the endpoint), so the model of a
 * singularity AT the endpoint is not used there. A guard that returns `NaN`
 * at the endpoint does: the panel is left out, and the area of the model is
 * then larger than the area of the panel, which is still a bound.
 */
export function uncountedArea(corner: CornerSeries): number {
  const last = corner.last;
  if (
    last === undefined ||
    (Number.isFinite(last.value) && Number.isFinite(last.error))
  )
    return 0;
  return cornerModelArea(corner, last.width, true);
}

/**
 * `UNCOUNTED_SAFETY` times the integral over the distances `[0, delta]`
 * from the endpoint of the model of the shells of `uncountedArea`, or of the
 * power of `powerCornerArea`: `+∞` for a ratio of at least 1. When there is
 * no geometric model, the result is `fallbackArea` with `fallback` (else 0),
 * or the power area when that is larger.
 *
 * The result is the largest of three areas: the area of the model of the
 * deepest shells (`cornerModel`), the area of the model of the deepest
 * shells whose values are accurate enough for their ratios to mean
 * something (`skipNoisy`), and, when the shells decrease as a power of their
 * index, the area of that power (`powerCornerArea`, which does not read
 * `fallback`). The geometric models are not a bound for such shells.
 *
 * The deepest shells can be only some doubles wide, and their values are
 * then off by several percent. For `1/√(0.3 − x)` with a step at `1.6e-9`
 * from `0.3` (the step stops the extrapolation), the shells 2 to 16 doubles
 * wide have ratios `0.745`, `0.721` and `0.56` that fall toward the endpoint,
 * the model of the deepest shells has the ratio `0.567` instead of
 * `2^(−1/2)`, and the area that tanh-sinh leaves out was `4.7e-9` instead of
 * about `2e-8`: the result was `± 4.7e-9` for a true error of `1.08e-8`. The
 * larger of the two geometric areas is used, not the model of the accurate
 * shells alone: for `(x − 10⁹)^(−1/2) + 1.33e-5·(x − 10⁹)^(−0.99)` on
 * `[10⁹, 10⁹ + 1]`, the deepest shells carry the second term, and the model
 * of the accurate shells alone made the error `1.851e-3` for a true error of
 * `1.865e-3` (`1.890e-3` with the deepest shells).
 */
function cornerModelArea(
  corner: CornerSeries,
  delta: number,
  fallback = false
): number {
  const area = (skipNoisy: boolean) => {
    const model = cornerModel(corner, delta, skipNoisy);
    if (model === undefined) return fallback ? fallbackArea(corner, delta) : 0;
    if (model === 'divergent') return Number.POSITIVE_INFINITY;
    return Number.isFinite(model.area)
      ? UNCOUNTED_SAFETY * model.area
      : Number.POSITIVE_INFINITY;
  };
  return Math.max(
    area(false),
    area(true),
    UNCOUNTED_SAFETY * powerCornerArea(corner, delta)
  );
}

/**
 * The smallest number of consecutive shells from which `powerCornerArea`
 * reads a power. Next to `10⁶`, the corner panel of `u^(−1)·(−ln u)^(−q)` on
 * an interval of width `1e-3` has 9 shells with a relative error of at most
 * `MODEL_SHELL_RELATIVE_ERROR`: with 12 (`MIN_EXTRAPOLATION_SHELLS`), the
 * result for `q = 1.1` was `± 1.08` for a true error of `7.32`. A power read
 * from shells that are not a power only makes the area larger (`cornerModelArea`
 * takes the largest of three areas): on the corpora of
 * `docs/plans/2026-10-31-ce695-power-corner-area.md`, 8 shells instead of 12
 * changed no other result.
 */
const POWER_MODEL_MIN_SHELLS = 8;

/**
 * The largest difference, in natural logarithm, between the logarithm of a
 * shell and a fit of `powerCornerArea` that reads as a power of the depth.
 * Measured: at most `8.1e-4` for `u^(−1)·(−ln u)^(−q)` (`q` from 1.1 to 4,
 * next to 0, 0.3, 0.7, 1, 3.7, 1000.5 and `10⁶`; the largest is next to 0.7
 * for `q = 1.1`, where the shells are 29). Shells that are not a power:
 * `2.8e-2` to `4.0e-2` for `(1000.5 − x)^(−1/2)` plus a step next to 1000.5
 * (two geometric terms), `1.7e-2` for `x^(−0.9)·(1 + 100u)` next to `10⁶`,
 * and `3.5e-3` for `x^(−0.99)·(1 + 100u)` next to 1000.5.
 */
const POWER_MODEL_RESIDUAL = 2e-3;

/**
 * The largest value that `UNCOUNTED_SAFETY` times the area of a power can
 * have in `powerCornerArea`: a larger area, or a tail that overflows, is
 * capped at this value. The areas of the two corners and the other error
 * terms are added, and a sum of finite doubles near `Number.MAX_VALUE` can
 * overflow; a sixteenth leaves room for the terms.
 */
const POWER_AREA_LIMIT = Number.MAX_VALUE / 16;

/**
 * The integral over the distances `[0, delta]` from the endpoint of a power
 * of the depth fitted to the deepest shells, when those shells decrease as a
 * power of their index (`shellsDecayAsPower`), as next to a logarithmic
 * singularity `1/(u·(−ln u)^q)`. Else 0. `cornerModelArea` takes the largest
 * of this area and the two areas of the geometric model of `cornerModel`.
 *
 * The geometric model is not a bound for such shells. Shells that decrease
 * as `1/kᵅ` have a ratio close to 1, and the tail of a geometric series with
 * that ratio is about `(α − 1)/α` of the tail of the power. For `1/(x·ln²x)`
 * on `[0, ½]` plus a step of area `1e-6` on `[0, 1e-3]`, the integrand
 * overflows in the last corner panel `[0, 5e-324]`, the step stops the
 * extrapolation, and the area of that panel was bounded by the geometric
 * model only: the result was `± 1.28e-3` for a true error of `1.38e-3`. Next
 * to `10⁶`, `u^(−1)·(−ln u)^(−1.1)` was `± 1.24` for a true error of `7.32`.
 *
 * The shells read: the deepest run of at least `POWER_MODEL_MIN_SHELLS`
 * consecutive shells that are finite, not 0, of one sign, at least
 * `UNCOUNTED_MODEL_SPACINGS` spacings wide, with a relative error of at most
 * `MODEL_SHELL_RELATIVE_ERROR`, extended toward the interior as far as the
 * shells are such. This is a weaker test than the `1e-8` test of
 * `accurateShells`, which is for the extrapolation: next to `10⁶`, only 6
 * shells pass that one. The index `k` of a shell is its index in `corner.shells`, and its depth is
 * `y = k + beta + ½` (`beta` as in `extrapolateCorner`). The power
 * `ln|shell| = c + q·ln y` is fitted (`fitShellModel`) to the last half of
 * the run, to its last quarter, and to the quarter before it, and the area
 * is the largest of their tails (`modelTail`) from the depth of `delta`. A
 * range of fewer than 4 shells is not fitted: a power fits 2 or 3 shells
 * with almost no residual, so the fit is no test, and its exponent is noisy.
 * With 9 shells next to `10⁶` (`u^(−1)·(−ln u)^(−1.02)` on an interval of
 * width `1e-3`), the last 2 shells fit `q = −0.995`, which refused the power,
 * and the result was `± 1.50` for a true error of `47.0`; without that fit it
 * is `± 111`.
 *
 * A fit is no evidence of a power, and the area is 0 (the geometric bound
 * stays), when its largest difference to the logarithm of a shell is more
 * than `POWER_MODEL_RESIDUAL`, or when `q ≥ −1` (the tail of such a power is
 * not finite, and shells of a convergent integral that fit it are not a
 * power: `x^(−0.99)·(1 + 100u)` next to `10⁶` fits `q = −0.135`). The area
 * is capped so that `UNCOUNTED_SAFETY` times it is at most
 * `POWER_AREA_LIMIT` (`Number.MAX_VALUE / 16`): the sum of the bounds of the
 * two corners and the other error terms then stays finite. An error of `+∞`
 * takes away `singularCorner` (see `resolveCorners`), and a caller can then
 * use a Monte-Carlo estimate, which understates the uncertainty next to a
 * singularity. A capped area is smaller than the tail, but it is the largest
 * bound that the sums can hold.
 */
function powerCornerArea(corner: CornerSeries, delta: number): number {
  if (!(delta > 0)) return 0;
  const shells = corner.shells;
  const errors = corner.shellQuadpackErrors ?? corner.shellErrors;
  const spacing = Math.max(
    Math.abs(corner.endpoint) * Number.EPSILON,
    Number.MIN_VALUE
  );
  // A shell whose `shellErrors` is not finite is refused, as in
  // `accurateShells`: its QUADPACK error can be finite all the same.
  const usable = (k: number) =>
    Number.isFinite(shells[k]) &&
    Number.isFinite(corner.shellErrors[k]) &&
    shells[k] !== 0 &&
    errors[k] <= MODEL_SHELL_RELATIVE_ERROR * Math.abs(shells[k]) &&
    corner.width / 2 ** (k + 1) >= UNCOUNTED_MODEL_SPACINGS * spacing;
  // The runs from the deepest shell toward the interior: `last` is the
  // deepest shell of a run, and `first` the shell where it starts.
  let last = shells.length - 1;
  let first = last;
  for (; last >= 0; last = first - 1) {
    while (last >= 0 && !usable(last)) last--;
    if (last < 0) return 0;
    first = last;
    while (
      first > 0 &&
      usable(first - 1) &&
      Math.sign(shells[first - 1]) === Math.sign(shells[last])
    )
      first--;
    if (last - first + 1 >= POWER_MODEL_MIN_SHELLS) break;
  }
  if (last < 0) return 0;
  const n = last - first + 1;
  const beta = Math.max(1, -Math.log2(corner.width));
  if (!shellsDecayAsPower(shells.slice(first, last + 1), beta + first))
    return 0;
  const half = first + Math.floor(n / 2);
  const quarter = Math.floor(n / 4);
  // `log2(width) − log2(delta)`, not `log2(width/delta)`: the quotient
  // overflows when `delta` is a denormal, such as the width `5e-324` of the
  // last corner panel next to 0.
  const depth = beta + Math.log2(corner.width) - Math.log2(delta);
  let largest = 0;
  for (const [from, to] of [
    [half, last + 1],
    [last + 1 - quarter, last + 1],
    [half, last + 1 - quarter],
  ]) {
    if (to - from < 4) continue;
    const fit = fitShellModel(shells, from, to, beta, 'power');
    if (
      fit === undefined ||
      !(fit.residual <= POWER_MODEL_RESIDUAL) ||
      !(fit.model.q < -1)
    )
      return 0;
    // With `q < −1`, `modelTail` is `undefined` only when the tail overflows.
    largest = Math.max(
      largest,
      modelTail(fit.model, depth) ?? Number.POSITIVE_INFINITY
    );
  }
  return Math.min(largest, POWER_AREA_LIMIT / UNCOUNTED_SAFETY);
}

/**
 * The largest relative error of a shell (its QUADPACK error, see
 * `CornerSeries.shellQuadpackErrors`) that `cornerModel` reads with
 * `skipNoisy`: a quarter of `UNCOUNTED_RATIO_SPREAD`, so that the errors of
 * the four shells of a window do not change their ratios by more than the
 * spread that reads as one ratio.
 */
const MODEL_SHELL_RELATIVE_ERROR = UNCOUNTED_RATIO_SPREAD / 4;

/**
 * The largest relative difference between the value of a finite last corner
 * panel and the integral of the model of the shells over it
 * (`cornerModel`) that `lastPanelHoldsFeature` reads as agreement, for
 * shells that decrease at least as fast as those of a bounded integrand
 * (ratio at most `1/2`). The Gauss–Kronrod value of `x^q` on `[0, w]`
 * (`0 ≤ q ≤ 2`) is within `1e-4` of the integral.
 */
const LAST_PANEL_AGREEMENT = 1e-3;

/**
 * Whether the value of the finite last corner panel disagrees with the
 * model of the shells (`LAST_PANEL_AGREEMENT`): the integrand changes inside
 * that panel, where no shell samples it, and the model is no evidence about
 * the part of the panel next to the endpoint. Read only when the ratio of
 * the model is at most `1/2` (with the margin `UNCOUNTED_RATIO_SPREAD`):
 * for a stronger singularity the Gauss–Kronrod value of the panel differs
 * from the integral by much more (see `lastPanelGap`).
 *
 * `(x − 1000)^(−0.9)·(x − 1000 − 10⁻¹¹)` on `[1000, 1001]` has its zero 88
 * spacings from 1000, inside a last panel of 65,000 spacings. The shells
 * are those of `(x − 1000)^0.1`, the panel differs from their model by
 * `0.57 %`, and with the model the error of the tanh-sinh value
 * (`tanhSinhLoss`, `resolveCorners`) left out the part of
 * `−10⁻¹¹·(x − 1000)^(−0.9)` next to 1000: the result was `converged`,
 * `± 2.5e-12`, for a true error of `5.1e-12`.
 */
function lastPanelHoldsFeature(corner: CornerSeries): boolean {
  const last = corner.last;
  if (
    last === undefined ||
    !Number.isFinite(last.value) ||
    !Number.isFinite(last.error)
  )
    return false;
  const model = cornerModel(corner, last.width);
  if (
    typeof model !== 'object' ||
    model.low === undefined ||
    !(model.ratio <= 0.5 * (1 + UNCOUNTED_RATIO_SPREAD))
  )
    return false;
  const expected = model.sign * model.area;
  return (
    Math.abs(last.value - expected) > LAST_PANEL_AGREEMENT * Math.abs(expected)
  );
}

/**
 * The ratio of the shells that `fallbackArea` assumes: the ratio of the
 * shells of `x^(−0.99)`, `2^(−0.01)`. The exponent of an integrable
 * singularity is less than 1, and no finite sampling tells `x^(−p)` with
 * `p` close to 1 from a divergent integrand (see `SHELL_DECAY` in
 * `gauss-kronrod.ts`), so a bound must assume a largest exponent.
 */
const UNCOUNTED_FALLBACK_RATIO = 2 ** -0.01;

/**
 * The area over the distances `[0, delta]` from the endpoint when the shells
 * give no model (`cornerModel`): the tail of shells that continue the
 * larger of the last two finite shells with the ratio
 * `UNCOUNTED_FALLBACK_RATIO` (`x^(−0.99)`), or 0 when no shell is finite.
 *
 * The shells give no model when the integrand changes sign next to the
 * endpoint, or when the ratios of the deepest shells fall below `1/2` (a
 * zero of the integrand is close). For `(x − e)^(−0.9)·(x − e − z)` the
 * deepest shells, past the zero, are those of `−z·(x − e)^(−0.9)`, whose
 * area over the last panel is `1/(2^0.1 − 1) = 14` times the shell next to
 * it; the fallback is `1/(2^0.01 − 1) = 144` times. With the model of the
 * shells farther out instead (those of `(x − e)^0.1`), `e = 10⁶`,
 * `z = 10⁻⁹` was `± 1.3e-10` for a true error of `1.0e-9`, and with
 * `z = 10⁻⁷` and `e = 10⁹` (the zero inside the first double) `± 9.3e-8`
 * for `1.85e-7`.
 */
function fallbackArea(corner: CornerSeries, delta: number): number {
  const finite: number[] = [];
  for (let k = corner.shells.length - 1; k >= 0 && finite.length < 2; k--)
    if (Number.isFinite(corner.shells[k])) finite.push(k);
  if (finite.length === 0 || !(delta > 0)) return 0;
  const amplitude = Math.max(...finite.map((k) => Math.abs(corner.shells[k])));
  // The halvings from the outer edge of the deepest finite shell to `delta`.
  const m = Math.max(1, Math.log2(corner.width / 2 ** finite[0] / delta));
  const r = UNCOUNTED_FALLBACK_RATIO;
  const area = (amplitude * r ** m) / (1 - r);
  return Number.isFinite(area) ? area : Number.POSITIVE_INFINITY;
}

/**
 * The integral over the distances `[0, delta]` from the endpoint of the
 * model of the shells described in `uncountedArea`, as a magnitude: `area`
 * with the ratio `r` of the model, and, when the ratios of the window agree
 * (`UNCOUNTED_RATIO_SPREAD`), `low` with the smallest of them. When they
 * fall toward the endpoint, `area` is an upper bound only, and `low` is
 * `undefined`. `'divergent'` for a ratio of at least 1 that the ratios agree
 * on, `undefined` when there is no model. `sign` is the sign of the shells
 * of the window, and `ratio` the ratio `r`.
 *
 * With `skipNoisy`, a window that holds a shell whose relative error is
 * more than `MODEL_SHELL_RELATIVE_ERROR` is skipped, and the search goes on
 * toward wider shells (see `cornerModelArea`). Such a window still gives no
 * model when its ratios do not agree (`UNCOUNTED_RATIO_SPREAD`), fall toward
 * the endpoint, and the deepest one is below `1/2`, as without `skipNoisy`:
 * that is the sign of a zero of the integrand next to the
 * endpoint, and the shells farther out do not describe the integrand past
 * that zero. For `(x − 10⁹)^(−0.9)·(x − 10⁹ − 10⁻⁷)` the deepest shells have
 * relative errors up to `0.74` and ratios that fall to `0.38`; the model of
 * the shells farther out made the error `1.1e-7` for a true error of
 * `1.9e-7`.
 */
function cornerModel(
  corner: CornerSeries,
  delta: number,
  skipNoisy = false
):
  | { area: number; low: number | undefined; sign: number; ratio: number }
  | 'divergent'
  | undefined {
  if (!(delta > 0)) return undefined;
  const shells = corner.shells;
  const spacing = Math.max(
    Math.abs(corner.endpoint) * Number.EPSILON,
    Number.MIN_VALUE
  );
  // `shells[k]` covers the distances from `width/2^(k+1)` to `width/2^k`.
  let last = shells.length - 1;
  while (
    last >= 0 &&
    !(corner.width / 2 ** (last + 1) >= UNCOUNTED_MODEL_SPACINGS * spacing)
  )
    last--;
  for (let j = last; j >= 3; j--) {
    const window = shells.slice(j - 3, j + 1);
    if (!window.every(Number.isFinite)) continue;
    const ratios = [1, 2, 3].map((i) => window[i] / window[i - 1]);
    if (!ratios.every((q) => q > 0)) continue;
    if (skipNoisy) {
      const errors = corner.shellQuadpackErrors ?? corner.shellErrors;
      let noisy = false;
      for (let k = j - 3; k <= j; k++)
        if (!(errors[k] <= MODEL_SHELL_RELATIVE_ERROR * Math.abs(shells[k])))
          noisy = true;
      if (noisy) {
        const spread = Math.max(...ratios) - Math.min(...ratios);
        if (
          !(spread <= UNCOUNTED_RATIO_SPREAD * Math.max(...ratios)) &&
          ratios[0] >= ratios[1] &&
          ratios[1] >= ratios[2] &&
          ratios[2] < 0.5
        )
          return undefined;
        continue;
      }
    }
    let r = Math.max(...ratios);
    let low: number | undefined = Math.min(...ratios);
    if (!(r - low <= UNCOUNTED_RATIO_SPREAD * r)) {
      // Ratios that fall toward the endpoint: the deepest one, with the
      // margin of the rounding of the shells.
      if (!(ratios[0] >= ratios[1] && ratios[1] >= ratios[2])) continue;
      // Ratios that fall below `1/2`: the shells shrink faster than those
      // of a bounded integrand, toward a zero of the integrand next to the
      // endpoint, and the integrand past that zero is not described by
      // these shells or by the shells farther out (see
      // `UNCOUNTED_FALLBACK_RATIO`).
      if (ratios[2] < 0.5) return undefined;
      r = ratios[2] * (1 + UNCOUNTED_RATIO_SPREAD);
      low = undefined;
      // Shells that still grow toward the endpoint, with ratios that fall:
      // the limit of the ratios is not known, and it is not shown to be 1
      // or more.
      if (!(r < 1)) continue;
    }
    if (!(r < 1)) return 'divergent';
    // The halvings from the outer edge of the shell `j` to `delta`.
    const m = Math.log2(corner.width / 2 ** j / delta);
    const tail = (q: number) => (Math.abs(shells[j]) * q ** m) / (1 - q);
    return {
      area: tail(r),
      low: low === undefined ? undefined : tail(low),
      sign: Math.sign(shells[j]),
      ratio: r,
    };
  }
  return undefined;
}

/**
 * The smallest ratio of the shells (`2^(p − 1)` for `x^(−p)`) for which
 * `lastPanelGap` reads the model: `p ≥ 3/4`. For a weaker singularity the
 * Gauss–Kronrod error of the panel is larger than its true error (2.8 times
 * for `p = 0.8`), and the geometric model of shells that decrease as fast as
 * those of a bounded integrand (ratio `1/2`) is not accurate enough to
 * contradict it: for `ln|x − c|` on `[1000, 1001]` with `c` 10⁵ doubles
 * above 1000, the shell that holds `c` is 13 % larger than the model, and
 * the result was not converged, `± 1.9e-8`, for a true error of `8e-12`.
 */
const LAST_PANEL_MIN_RATIO = 2 ** -0.25;

/**
 * The amount by which the error of the last corner panel is smaller than
 * the difference between its value and the integral of the model of the
 * shells over it (see `cornerModel`), or 0. Only a model whose ratios agree,
 * with a ratio of at least `LAST_PANEL_MIN_RATIO`, is read, and the panel
 * must be finite (else see `uncountedArea`).
 *
 * The Gauss–Kronrod error of a panel that touches a singular endpoint is too
 * small for a strong singularity. On `[0, 1]` for `x^(−p)` (the same for
 * every panel `[0, w]`, by scaling), the error over the true error is `1.06`
 * for `p = 0.9`, `0.46` for `p = 0.95`, `0.26` for `p = 0.97` and `0.08` for
 * `p = 0.99`. The extrapolation of the shells or the tanh-sinh rule usually
 * finds the difference. Neither did for `x^(−0.95)·(x < 0.01 ? 2 : 1)` on
 * `[0, 1]`: the step is inside the corner panel, so the shell that holds it
 * stops the extrapolation, and tanh-sinh did not converge. The last corner
 * panel `[0, 5.4e-197]` was `1.8e-9 ± 2.0e-9` for an integral of `6.1e-9`,
 * and the result was `converged`, `± 3.6e-9`, for a true error of `4.4e-9`.
 */
export function lastPanelGap(corner: CornerSeries): number {
  const last = corner.last;
  if (
    last === undefined ||
    !Number.isFinite(last.value) ||
    !Number.isFinite(last.error)
  )
    return 0;
  const model = cornerModel(corner, last.width);
  if (
    typeof model !== 'object' ||
    model.low === undefined ||
    !(model.ratio >= LAST_PANEL_MIN_RATIO)
  )
    return 0;
  // Only a contradiction counts: no value of the model, between `low` and
  // `area`, is within the error of the panel. The geometric model is not
  // exact for a logarithmic factor (the ratios of the shells of `ln²(x − e)`
  // fall slowly toward `1/2`), and the panel error was right there.
  const value = model.sign * last.value;
  if (model.low <= value + last.error && value - last.error <= model.area)
    return 0;
  const gap = Math.max(model.area - value, value - model.low) - last.error;
  return Number.isFinite(gap) && gap > 0 ? gap : 0;
}

/** Whether the last `SINGULAR_SHELLS` shells of a corner are all positive
 * or all negative. */
function shellsHaveOneSign(corner: CornerSeries): boolean {
  const last = corner.shells.slice(-SINGULAR_SHELLS);
  return last.every((v) => v > 0) || last.every((v) => v < 0);
}

/**
 * The exponent `α` of the decrease `1/kᵅ` of the last half of the shells,
 * with the index `k` of a shell counted from a distance of 1 to the endpoint
 * (`offset` is the index of the first shell). Geometric shells give a large
 * value. `0` when the shells change sign or vanish. The signs are compared,
 * not the product, because the product of two small shells underflows to 0.
 */
function shellDecayExponent(shells: number[], offset: number): number {
  const n = shells.length;
  const i = Math.floor(n / 2);
  const j = n - 1;
  const u = shells[i];
  const v = shells[j];
  if (!((u > 0 && v > 0) || (u < 0 && v < 0))) return 0;
  return Math.log(u / v) / Math.log((offset + j + 1) / (offset + i + 1));
}

/**
 * The largest ratio of the decay exponent of the last half of the shells to
 * the decay exponent of the half before (see `shellsDecayAsPower`) for
 * shells that decrease as a power of their index. Measured: `1.001` for the
 * shells of `1/(x·(−ln x)^q)` at 0 (`q` = 1.5 to 4), `2.0` for the
 * geometric shells of `x^(−0.99)` at 0.
 */
const POWER_DECAY_RATIO = 1.25;

/**
 * Whether the shells decrease as a power `1/kᵅ` of their index `k` (counted
 * from a distance of 1 to the endpoint, `offset` is the index of the first
 * shell), as for a logarithmic singularity `1/(x·(−ln x)^q)`, and not
 * geometrically, as for `x^(−p)`. The decay exponent of power shells is the
 * same on the last half of the shells and on the half before. The decay
 * exponent of geometric shells `rᵏ` grows in proportion to `k`, so it is
 * about twice as large on the last half.
 */
function shellsDecayAsPower(shells: number[], offset: number): boolean {
  const late = shellDecayExponent(shells, offset);
  const early = shellDecayExponent(
    shells.slice(0, Math.floor(shells.length / 2)),
    offset
  );
  return early > 0 && late > 0 && late <= POWER_DECAY_RATIO * early;
}

/**
 * The smallest number of accurate shells with which `shellTail` accepts the
 * tail of a model of the shells. With fewer shells, it returns the tail of a
 * power fitted to the shells only as an estimate of the part that is
 * missing. Next to 0 a corner has about 1000 accurate shells with the
 * default budget of 1500 panels, and more than 64 with a budget of 100
 * panels, with which the tail of `1/(t·(−ln t)^1.1)` at 0 is found within
 * `0.003` (error `0.0099`). Next to a nonzero endpoint a corner has fewer
 * than 30 accurate shells (see `ACCURATE_SHELL_SPACINGS`), too few to tell a
 * power of the depth from other decreases.
 */
const SHELL_TAIL_MIN_SHELLS = 64;

/**
 * The largest difference, in natural logarithm, between the logarithm of a
 * shell and the model of `shellTail` that accepts the model. Measured on the
 * last half of the 1023 accurate shells at 0 on `[0, ½]`: the power model
 * gives at most `1e-7` for `1/(t·(−ln t)^p)` (`p` from 1.02 to 2), and `2e-3`
 * for `−t^0.0001/(t·ln t)`, for which the model with a rate gives `7e-9`. For
 * `1/(t·(ln 1000 − ln t)^1.1)` (the scale of the logarithm is not 1), the
 * power model gives `7e-4`, the model with a rate `9e-5`, and the model with
 * a term in `1/y` `1.4e-6`.
 */
const SHELL_TAIL_RESIDUAL = 1e-5;

/**
 * A model of the shells for `shellTail`: the logarithm of the magnitude of
 * the integrand per unit of depth `y` is `c + q·ln y + rate·y + d/y`.
 */
type ShellModel = { c: number; q: number; rate: number; d: number };

/**
 * The least-squares fit of the model `basis` (see `ShellModel`; `c` and `q`
 * are always fitted) to the logarithms of the magnitudes of the shells
 * `from` to `to − 1`, with the depth `y = k + beta + ½` for shell `k`, and
 * the largest difference between the model and the logarithm of a shell.
 * The fit uses the QR decomposition of the matrix of the basis functions
 * (modified Gram–Schmidt): the normal equations square the condition
 * number, which is large because `ln y`, `y` and `1/y` are close to linear
 * on the range of the fit.
 */
function fitShellModel(
  shells: number[],
  from: number,
  to: number,
  beta: number,
  basis: 'power' | 'rate' | 'offset'
): { model: ShellModel; residual: number } | undefined {
  const rows = to - from;
  const target: number[] = [];
  const columns: number[][] = [[], [], []];
  for (let k = from; k < to; k++) {
    const y = k + beta + 0.5;
    target.push(Math.log(Math.abs(shells[k])));
    columns[0].push(1);
    columns[1].push(Math.log(y));
    columns[2].push(basis === 'rate' ? y : 1 / y);
  }
  const m = basis === 'power' ? 2 : 3;
  const q = columns.slice(0, m).map((column) => column.slice());
  const r: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < j; i++) {
      let dot = 0;
      for (let k = 0; k < rows; k++) dot += q[i][k] * q[j][k];
      r[i][j] = dot;
      for (let k = 0; k < rows; k++) q[j][k] -= dot * q[i][k];
    }
    let norm = 0;
    for (let k = 0; k < rows; k++) norm += q[j][k] * q[j][k];
    norm = Math.sqrt(norm);
    if (!(norm > 0)) return undefined;
    r[j][j] = norm;
    for (let k = 0; k < rows; k++) q[j][k] /= norm;
  }
  const x = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let s = 0;
    for (let k = 0; k < rows; k++) s += q[i][k] * target[k];
    for (let j = i + 1; j < m; j++) s -= r[i][j] * x[j];
    x[i] = s / r[i][i];
  }
  if (!x.every(Number.isFinite)) return undefined;
  let residual = 0;
  for (let k = 0; k < rows; k++) {
    let v = 0;
    for (let j = 0; j < m; j++) v += columns[j][k] * x[j];
    residual = Math.max(residual, Math.abs(v - target[k]));
  }
  return {
    model: {
      c: x[0],
      q: x[1],
      rate: basis === 'rate' ? x[2] : 0,
      d: basis === 'offset' ? x[2] : 0,
    },
    residual,
  };
}

/**
 * The integral of the model `e^(c + q·ln y + rate·y + d/y)` (see `ShellModel`)
 * over the depths `y` from `depth` to `∞`, or `undefined` when it diverges.
 *
 * The substitution `y = depth·e^w` gives `e^(c + rate·depth)·depth^(q+1)`
 * times `J = ∫₀^∞ e^((q+1)·w + rate·depth·(e^w − 1) + (d/depth)·e^(−w)) dw`.
 * With `rate < 0`, `J` is the Simpson sum on `[0, W]` for
 * `W = ln(1 + 50/(−rate·depth))`, where the term `rate·depth·(e^w − 1)` is
 * `−50`. The term `(q + 1)·w` is positive when `q > −1`, but the exponent at
 * `W` is still at least `50 − (q + 1)·(1 + ln(50/(q + 1)))` below its
 * largest value (45 for `q + 1 = 1`), and the integrand decreases faster
 * than exponentially past `W`. `W` is not finite when `−rate·depth` is
 * below about `2.8e-307`, and the tail is then `undefined`. With
 * `rate = 0`, `J` is the Simpson sum on `[0, 40]` plus
 * `∫₄₀^∞ e^((q+1)·w) dw = e^(40·(q+1))/(−q − 1)` (the factor in `d` is then
 * `1` within `e^(−40)`). With `rate = d = 0`, `J = 1/(−q − 1)`, so the
 * integral is `C·K^(1−p)/(p − 1)` for `C = e^c`, `p = −q` and `K = depth`.
 */
function modelTail(model: ShellModel, depth: number): number | undefined {
  const { c, q, rate, d } = model;
  if (!(rate <= 0) || (rate === 0 && !(q < -1))) return undefined;
  const scale = Math.exp(c + rate * depth + (q + 1) * Math.log(depth));
  if (rate === 0 && d === 0) return scale / (-q - 1);
  const width = rate < 0 ? Math.log1p(50 / (-rate * depth)) : 40;
  if (!Number.isFinite(width)) return undefined;
  const intervals = 2 * Math.ceil(25 * width);
  const h = width / intervals;
  const g = (w: number) =>
    Math.exp(
      (q + 1) * w + rate * depth * Math.expm1(w) + (d / depth) * Math.exp(-w)
    );
  let sum = g(0) + g(width);
  for (let i = 1; i < intervals; i++) sum += (i % 2 === 1 ? 4 : 2) * g(i * h);
  let j = (sum * h) / 3;
  if (rate === 0) j += Math.exp((q + 1) * width) / (-q - 1);
  const tail = scale * j;
  return Number.isFinite(tail) ? tail : undefined;
}

/**
 * The integral over the part of a corner past the last accurate shell, from a
 * model of the shells, with its error, or `undefined` when no model fits.
 * This is for the shells that the ε-algorithm and the Levin u-transform do
 * not extrapolate: shells that decrease as a power `k^(−p)` of their index
 * with `1 < p < LEVIN_MIN_DECAY`, such as the shells of `1/(t·(−ln t)^1.1)` at
 * 0. Without it, the quadrature gave `5.19 ± 0.79` for
 * `∫₀^½ dt/(t·(−ln t)^1.1) = (ln 2)^(−0.1)/0.1 = 10.37`: most of the integral
 * is in the part of the corner closer to 0 than the doubles allow.
 *
 * The derivation. Shell `k` is the integral over the points at a distance
 * between `2^(−(y+1))` and `2^(−y)` to the endpoint, for the depth
 * `y = k + beta`. Write it as `∫ g(u) du` over the depths `u` from `y` to
 * `y + 1`, where `g(u) = f(endpoint ± 2^(−u))·2^(−u)·ln 2` is the integral
 * per unit of depth. The integral of `g` on a unit range is `g` at the middle
 * of the range, within a relative error `g''/(24·g)`, which is `O(1/y²)` for
 * the models below. So the shells are samples of `g` at `y = k + beta + ½`,
 * and the part of the corner past the last accurate shell `n − 1` is
 * `∫ g(u) du` from `n + beta` to `∞` (`modelTail`). For `1/(t·(−ln t)^p)`
 * at 0, `g(u) = (ln 2)^(1−p)·u^(−p)`, a power of the depth.
 *
 * The models of `ln|g(y)|`, fitted by least squares to the last half of the
 * shells (`fitShellModel`):
 * - `c + q·ln y`, a power of the depth, used when its largest difference to
 *   the logarithm of a shell is at most `SHELL_TAIL_RESIDUAL`, and `q < −1`.
 *   The tail is then `C·K^(1−p)/(p − 1)` with `C = e^c`, `p = −q` and
 *   `K = n + beta`.
 * - Otherwise, the better fit of `c + q·ln y + rate·y` (a power with a slow
 *   exponential decrease: `−t^a/(t·ln t)` gives `g(y) = e^(−a·y·ln 2)/y`,
 *   whose tail is not a power) and `c + q·ln y + d/y` (a power of a depth
 *   with a different origin: the shells of `1/(t·(ln 1000 − ln t)^1.1)` are
 *   about `(y + 10)^(−1.1)`), when it is at most `SHELL_TAIL_RESIDUAL`, and
 *   its tail is finite.
 * The power is tried first: a rate fitted to the shells of a pure power is
 * not 0 (about `1e-9`, from the terms in `1/y²` that the models leave out),
 * and a negative rate cuts the tail of a power off at the depth `1/|rate|`. For
 * `1/(t·(−ln t)^1.02)`, the tail with a rate of `−5e-10` is a third of the
 * tail without one.
 *
 * The error is `EXTRAPOLATION_SAFETY` times the largest difference between
 * the tail of the model fitted to the last half of the shells and the tails
 * of the same model fitted to the last quarter and to the quarter before it.
 * A model that does not describe the shells gives tails that change with the
 * part of the shells that it is fitted to. When the power is accepted, the
 * difference with the tail of the model with a rate is added to the error,
 * unless that rate is ruled out (see the comment in the function). A tail
 * whose error is not smaller than the tail is not accepted.
 *
 * When no tail is accepted (no model fits, the tail is not smaller than its
 * error, or there are fewer than `SHELL_TAIL_MIN_SHELLS` shells), the result
 * has `ok: false` and, when there is one, the tail of a model as an estimate
 * of the part of the corner that is missing: the tail of the model that was
 * not accepted, or the largest of the tails of a power fitted to the last
 * half, the last quarter and the quarter before it.
 *
 * The model is an assumption on the part of the corner that no shell
 * samples: a factor that changes the integrand only past the deepest shell
 * (`t^(10⁻⁸)`, a decrease that the shells cannot see) changes the integral
 * and not the result.
 */
function shellTail(
  shells: number[],
  beta: number
): { ok: true; tail: number; error: number } | { ok: false; tail?: number } {
  const n = shells.length;
  if (n < MIN_EXTRAPOLATION_SHELLS) return { ok: false };
  const half = Math.floor(n / 2);
  const quarter = Math.floor(n / 4);
  const tail = shells.slice(half);
  if (!(tail.every((v) => v > 0) || tail.every((v) => v < 0)))
    return { ok: false };
  const sign = tail[0] > 0 ? 1 : -1;
  const depth = n + beta;
  // The fits on the last half of the shells, on the last quarter and on the
  // quarter before it.
  const ranges: [number, number][] = [
    [half, n],
    [n - quarter, n],
    [half, n - quarter],
  ];

  // The tail of the power model when no model is accepted: the largest of
  // the tails of the power fitted to the three ranges. The exponent fitted
  // to shells that decrease more slowly than any power is closer to `−1` on
  // the last quarter, which gives a larger tail.
  const powerTail = (): number | undefined => {
    let largest: number | undefined;
    for (const [from, to] of ranges) {
      const fit = fitShellModel(shells, from, to, beta, 'power');
      const value = fit === undefined ? undefined : modelTail(fit.model, depth);
      if (value !== undefined && !(largest !== undefined && largest >= value))
        largest = value;
    }
    return largest === undefined ? undefined : sign * largest;
  };
  if (n < SHELL_TAIL_MIN_SHELLS) return { ok: false, tail: powerTail() };

  const accept = (basis: 'power' | 'rate' | 'offset') => {
    const fit = fitShellModel(shells, half, n, beta, basis);
    if (fit === undefined || !(fit.residual <= SHELL_TAIL_RESIDUAL))
      return undefined;
    const value = modelTail(fit.model, depth);
    return value === undefined ? undefined : { ...fit, basis, value };
  };
  let best = accept('power');
  if (best === undefined) {
    const rate = accept('rate');
    const offset = accept('offset');
    best =
      rate === undefined
        ? offset
        : offset === undefined || rate.residual <= offset.residual
          ? rate
          : offset;
  }
  if (best === undefined) return { ok: false, tail: powerTail() };

  let difference = 0;
  for (const [from, to] of ranges.slice(1)) {
    const fit = fitShellModel(shells, from, to, beta, best.basis);
    const value = fit === undefined ? undefined : modelTail(fit.model, depth);
    if (value === undefined) return { ok: false, tail: sign * best.value };
    difference = Math.max(difference, Math.abs(value - best.value));
  }
  let error = EXTRAPOLATION_SAFETY * difference;

  // A power that fits the shells does not rule out a slow exponential
  // decrease: for `t^(10⁻⁸)/(t·(−ln t)^1.1)` at 0 on `[0, ½]`, the factor
  // `t^(10⁻⁸)` changes the shells by `7e-6` over the accurate shells, and the
  // power fits them within `2e-7`, but that factor makes the tail past the
  // last shell `3.49` and not the `5.18` of the power. So the model with a
  // rate is also fitted. The difference between its tail and the tail of the
  // power, plus the change of its tail on the three ranges, is part of the
  // error, unless the rate is ruled out: the fitted rate is not negative (no
  // finite tail), or it is within its own change on the three ranges of 0
  // and its tail differs from the tail of the power by less than the error.
  // The rate fitted to the shells of a pure power is positive (about `1e-9`,
  // from the terms in `1/y²` that the models leave out), so a rate smaller
  // than about `1e-9` is not found, and its effect on the tail is not in the
  // error.
  if (best.basis === 'power') {
    const fit = fitShellModel(shells, half, n, beta, 'rate');
    const value =
      fit === undefined || !(fit.model.rate < 0)
        ? undefined
        : modelTail(fit.model, depth);
    if (fit !== undefined && value !== undefined) {
      let rateSpread = 0;
      let rateTailSpread = 0;
      for (const [from, to] of ranges.slice(1)) {
        const other = fitShellModel(shells, from, to, beta, 'rate');
        if (other === undefined) {
          rateSpread = Infinity;
          continue;
        }
        rateSpread = Math.max(
          rateSpread,
          Math.abs(other.model.rate - fit.model.rate)
        );
        const t = modelTail(other.model, depth);
        if (t !== undefined)
          rateTailSpread = Math.max(rateTailSpread, Math.abs(t - value));
      }
      const alternative = Math.abs(value - best.value);
      if (!(-fit.model.rate <= rateSpread && alternative < error))
        error += alternative + EXTRAPOLATION_SAFETY * rateTailSpread;
    }
  }

  // A tail whose error is at least its size is not a value: the shells of
  // `1/(t·(−ln t))` at 0 (a divergent integral) fit a power with an exponent
  // a little below `−1`, and the tail of that power is finite and large
  // (`2.96e6 ± 1.54e7`).
  if (!(error < best.value)) return { ok: false, tail: sign * best.value };
  return { ok: true, tail: sign * best.value, error };
}

/**
 * The double-exponential (tanh-sinh) rule on a finite interval `[a, b]`.
 *
 * The substitution `x = c + h·tanh(π/2·sinh t)` (`c` the center, `h` the
 * half-width) makes the integrand decay double-exponentially in `t`, so the
 * trapezoidal rule in `t` converges fast even for an integrable singularity
 * at an endpoint. The distance of a node to the nearer endpoint is computed
 * as `2h/(1 + e^(2|s|))` (`s = π/2·sinh t`), not as `b − x`, so the nodes
 * near an endpoint are as close as the doubles allow.
 *
 * The step is halved at each level (the nodes of a level are the nodes of the
 * previous level plus the new midpoints), and the sum is truncated at the
 * `t` where the distance to the endpoint underflows. The error estimate is
 * the difference between the last two levels. The rule stops when this
 * difference is at most the tolerance, or when the next level would exceed
 * `maxEvaluations`.
 *
 * `usable` is `false` when the integrand is not finite at a node away from
 * the endpoints (where a singularity can make it overflow).
 */
export function tanhSinh(
  f: (x: number) => number,
  a: number,
  b: number,
  options: {
    rtol: number;
    atol: number;
    maxEvaluations: number;
    deadline: number | DeadlineFrame | undefined;
  }
): { estimate: number; error: number; converged: boolean; usable: boolean } {
  const c = 0.5 * (a + b);
  const h = 0.5 * (b - a);
  // The `t` where `e^(−2|s|)` underflows: `|s| = 372`.
  const tMax = Math.asinh((2 * 372) / Math.PI);
  let usable = true;

  const term = (t: number): number => {
    const s = (Math.PI / 2) * Math.sinh(t);
    const e = Math.exp(-2 * Math.abs(s));
    const distance = (2 * h * e) / (1 + e);
    if (!(distance > 0)) return 0;
    const x = t > 0 ? b - distance : t < 0 ? a + distance : c;
    // The node rounds to the endpoint: no closer node exists.
    if (!(x > a && x < b)) return 0;
    const weight =
      (h * (Math.PI / 2) * Math.cosh(t) * 4 * e) / ((1 + e) * (1 + e));
    const v = f(x);
    if (!Number.isFinite(v)) {
      // Next to an endpoint, a singular integrand can overflow: the node is
      // left out. Elsewhere, the rule cannot be used.
      if (Math.abs(t) < 3) usable = false;
      return 0;
    }
    return weight * v;
  };

  let step = 1;
  let sum = term(0);
  let evaluations = 1;
  for (let k = 1; k * step <= tMax; k++) {
    sum += term(k * step) + term(-k * step);
    evaluations += 2;
  }
  let previous = sum * step;
  let estimate = previous;
  let error = Infinity;
  let converged = false;
  for (let level = 1; ; level++) {
    // The next level evaluates as many new nodes as all the levels before.
    if (evaluations * 2 > options.maxEvaluations) break;
    checkDeadline(options.deadline);
    step /= 2;
    for (let k = 1; k * step <= tMax; k += 2) {
      sum += term(k * step) + term(-k * step);
      evaluations += 2;
    }
    estimate = sum * step;
    error = Math.abs(estimate - previous);
    previous = estimate;
    if (!usable || !Number.isFinite(estimate)) break;
    if (
      level >= 3 &&
      error <= Math.max(options.atol, options.rtol * Math.abs(estimate))
    ) {
      converged = true;
      break;
    }
  }
  usable = usable && Number.isFinite(estimate);
  return { estimate, error, converged: usable && converged, usable };
}

/**
 * The largest error of an extrapolated result, relative to its magnitude,
 * that is accepted as a result (`extrapolated: true`). Above it, the
 * extrapolation is not used: the extrapolations of the shells of
 * `sin(ln x)/x^1.1` at 0 (no value) agreed on `−2.2e13` with an error of
 * `2.8e17`, and the three callers returned that value. Accepted
 * extrapolations measured on `x^(−p)·lnᵠx` have a relative error below
 * `1e-8`.
 */
const EXTRAPOLATED_RELATIVE_ERROR = 1e-3;

/**
 * The result of the adaptive Gauss–Kronrod quadrature, corrected at a
 * singular endpoint.
 *
 * - A divergence found by the shells (`shellsDiverge`) stands: the
 *   extrapolation runs only after that test.
 * - With no singular corner (fewer than `SINGULAR_SHELLS` shells at each
 *   end), the result is unchanged.
 * - A converged result next to a singular corner is checked against
 *   tanh-sinh. When tanh-sinh does not converge, the converged result is
 *   kept: tanh-sinh with `maxEvaluations` nodes does not resolve a narrow
 *   peak next to a bound (`1/(10⁻¹² + x²)` at 0), and the result of a rule
 *   that did not converge is no evidence against one that did. When the
 *   difference is within 10 times the error of the Gauss–Kronrod result (or
 *   within the tolerance), the result is converged: the tanh-sinh value is
 *   returned (more accurate on an endpoint singularity), with the larger of
 *   its error and the difference. Otherwise the convergence of the
 *   Gauss–Kronrod quadrature can be false (`1/(x·ln²x)` on `[0, ½]` gives
 *   `1.4413105` with an error `1.4e-13`; the integral is `1.4426950`), and
 *   the shells are extrapolated.
 * - A result that did not converge, or that tanh-sinh contradicts, is
 *   corrected by the extrapolation of the shells of each singular corner
 *   (`extrapolateCorner`). The error is the error of the extrapolations plus
 *   the error of the other panels. The corrected result is used only when
 *   its error is at most `EXTRAPOLATED_RELATIVE_ERROR` times its magnitude
 *   (or within the tolerance).
 * - When the extrapolation is not used and tanh-sinh contradicted a
 *   converged result, the Gauss–Kronrod result is returned, not converged,
 *   with its error widened to cover the difference.
 * - Otherwise, the tanh-sinh value is returned when it converged and is
 *   within the error of the Gauss–Kronrod result. Else the Gauss–Kronrod
 *   result is returned, not converged, with its error widened to cover the
 *   difference with tanh-sinh and the uncertainty of each corner (the
 *   `spread` of `extrapolateCorner`).
 * - A tail that could not be shown to shrink (`unresolved`) is a divergence
 *   unless the extrapolation of that corner is used. So is a corner whose
 *   shells oscillate without shrinking (`shellTrend`): the integral has no
 *   value (`∫₀¹ sin(ln x)/x dx`), and the Monte-Carlo fallback of a caller
 *   would give a value with a small error, such as `−1.995 ± 0.037` for
 *   `∫₁^∞ sin(ln x)/x dx`.
 *
 * The absolute tolerance is `min(atol, rtol·magnitude)`, as in the adaptive
 * quadrature (`adaptiveFinite`, `gauss-kronrod.ts`): a fixed `atol` makes
 * the integral of a small integrand "converged" with any relative error.
 */
export function resolveSingularEndpoints(
  f: (x: number) => number,
  a: number,
  b: number,
  gk: GaussKronrodOutcome,
  options: {
    rtol: number;
    atol: number;
    maxEvaluations: number;
    deadline: number | DeadlineFrame | undefined;
  }
): QuadratureResult {
  const r = resolveCorners(f, a, b, gk, options);
  // A singularity some doubles inside or outside an endpoint
  // (`offsetSingularity`): the area next to it is not resolved by the
  // shells, and it is added to the error.
  // Where the value next to each singular corner comes from: the
  // extrapolation of the shells (`r.extrapolated` is set only when every
  // singular corner was extrapolated), which is a model of a singularity AT
  // the endpoint nearer to it than the last accurate shell; the samples of
  // the Gauss–Kronrod panels (the estimate is `gk.estimate`); or else the
  // tanh-sinh rule.
  const source = (corner: CornerSeries): CornerSource =>
    r.extrapolated === true
      ? {
          kind: 'model',
          width: corner.width / 2 ** accurateShells(corner).count,
        }
      : { kind: r.estimate === gk.estimate ? 'samples' : 'tanh-sinh' };
  let offset = 0;
  if (gk.lo.shells.length >= SINGULAR_SHELLS)
    offset += offsetSingularity(f, a, b, 1, source(gk.lo), options.deadline);
  if (gk.hi.shells.length >= SINGULAR_SHELLS)
    offset += offsetSingularity(f, b, a, -1, source(gk.hi), options.deadline);
  if (offset === 0 || !Number.isFinite(r.error)) return r;
  const error = r.error + offset;
  const tolerance = Math.max(
    Math.min(options.atol, options.rtol * gk.magnitude),
    options.rtol * Math.abs(r.estimate)
  );
  // An extrapolated result is accepted with an error above the tolerance
  // only when that error is at most `EXTRAPOLATED_RELATIVE_ERROR` times its
  // magnitude (`resolveCorners`), and the callers use an `extrapolated`
  // estimate even when it is not `converged`. The same test is applied to
  // the larger error: with poles 1 and 4 doubles above `0.3` on `[0.3, 1]`,
  // the error was `+∞` and the result was still `extrapolated`.
  const extrapolated =
    r.extrapolated === true &&
    Number.isFinite(error) &&
    error <=
      Math.max(tolerance, EXTRAPOLATED_RELATIVE_ERROR * Math.abs(r.estimate));
  return {
    ...r,
    error,
    converged: r.converged && error <= tolerance,
    ...(r.extrapolated === true ? { extrapolated } : {}),
  };
}

/** The smallest exponent of a power `|x − c|^(−p)` that `offsetSingularity`
 * counts as a singularity. */
const OUTSIDE_MIN_EXPONENT = 0.05;

/**
 * The largest difference, relative to the size of its parts, between a
 * difference of two dyadic exponents and the model of a pole outside the
 * interval (`outsidePoleShape`). For a pole 1 to 10⁵ doubles outside, with
 * the smooth factors `1`, `1 + 100·u`, `1/(1 + 100·u)`, `e^u` and
 * `e^(−300·u)` (endpoints 1 to 10⁶), the difference was at most `2.5e-5`;
 * `5.4e-4` for `2 + sin(1000·u)` and `2.2e-3` for `1 + 1000·u` (at
 * `e = 10⁶`, where `1000·u` reaches 0.12 at the last sample; with a
 * tolerance of `10⁻³` that pole was not counted, and the result was
 * `converged`, `± 5.48e-8`, for a true error of `5.53e-8`). For a logarithm
 * at the endpoint the difference was `0.4` or more, and for `ln|x − c|`
 * with `c` 10⁴ doubles outside `0.047` or more. A logarithm 10⁵ doubles
 * outside (`1.4e-3` to `2e-3`) is counted as a pole: its error is too
 * large, not too small.
 */
const OUTSIDE_SHAPE_TOLERANCE = 5e-3;

/**
 * The factor applied to the error that a pole outside the interval adds
 * (`offsetSingularity`). The same factor 2 as the error of a singular point
 * inside an endpoint, where the model puts about as much area in the wrong
 * place as the area it leaves out. With it, the error bounded the true
 * error in the 450 cases measured (see `offsetSingularity`); for the
 * tanh-sinh rule the largest part needed was `0.56·R`, for a charge of
 * `2·R`.
 */
const OUTSIDE_MODEL_SAFETY = 2;

/** The largest number of doubles from an endpoint at which
 * `offsetSingularity` reads the integrand. */
export const OFFSET_SINGULARITY_SPACINGS = 2 ** 20;

/** The largest number of consecutive doubles from an endpoint in a run of
 * samples that are not finite in `offsetSingularity`. The doubles after the
 * eighth are read one by one. When the double after the last one of the
 * limit is inside the interval and not finite, the error is `+∞`. */
const NON_FINITE_RUN_SPACINGS = 2 ** 10;

/**
 * An error for a singular point some doubles inside or outside the endpoint
 * `e` of the interval (`other` is the other endpoint, `direction` points
 * from `e` into the interval), or 0.
 *
 * The shells next to a singular endpoint are accurate only down to
 * `ACCURATE_SHELL_SPACINGS` doubles from it, and the part nearer to it is a
 * model of a singularity AT the endpoint. A singular point that is not
 * exact in binary can be some doubles from it:
 *
 * - Inside: `|t − 0.1·3|^(−1/2)` on `[0.3, 1]` is singular at
 *   `0.30000000000000004`, one double above `0.3`; the result was
 *   `converged`, `± 2.7e-13`, for a true error of `1.5e-8` (the part
 *   between `0.3` and the singular point is lost).
 * - Outside: `|t − (0.7 − 0.4)|^(−1/2)` on `[0.3, 1]` is singular at
 *   `0.29999999999999993`, one double below; the result was `converged`,
 *   `± 4e-13`, for a true error of `1.5e-8` (the model adds the area of a
 *   singularity at `0.3`, which is not there).
 *
 * The function reads `|f|` at 1 to 8 doubles from `e`, then at 16, 32, …
 * up to `OFFSET_SINGULARITY_SPACINGS` doubles (25 samples), except at
 * `e = 0`, where the doubles are denormals. None of the samples is outside
 * the interval.
 *
 * Inside: the largest sample is not the first one and is more than 1.5
 * times the first one, or a sample is not finite. Samples that are not
 * finite at consecutive doubles are one singular point, at the far end of
 * their run from `e`. The run ends at most `NON_FINITE_RUN_SPACINGS`
 * doubles from `e`; when the double after that is also not finite, the
 * error is `+∞`. A sample farther from `e` that is not
 * finite is another singular point, and the error is `+∞`. When the
 * largest sample is finite, the point of largest `|f|` near it is found to
 * the double (`samplePeak`), and it is a singular
 * point only when `|f|` there is larger than at the doubles next to it by
 * more than `2⁻²⁰` relative: a smooth peak (`1/((x − 10⁶ − 10⁻⁵)² +
 * 10⁻¹²)`) is flat at that scale, and it was taken for a singularity (an
 * error of `1.1e6` for a true error of `7`). The exponent `p` of the
 * singularity is read from the samples at `D` and `3D` beyond the singular
 * point `c`, where `D` is the distance from `e` to `c` (at `2D` and `5D`,
 * then `1.5D` and `4D`, when the integrand is 0 at one of them), and the
 * error is `2·D·|f(c + D)|/(1 − p)`: the integral of `|x − c|^(−p)` over
 * the `D` between `e` and `c` is `D·|f(c + D)|/(1 − p)`, and the model puts
 * about as much in the wrong place. (A bound `4·D·|f(c + D)|`, valid for
 * `p ≤ 3/4` only, gave `± 2.75` for a true error of `69` with `p = 0.99`.)
 * When `p ≥ 1` there is no finite bound, and the error is `+∞`.
 *
 * Outside: at a singularity AT `e`, `|f| ~ A·x^(−p)` and the exponent
 * between two dyadic samples, `log₂(|f(2^j)|/|f(2^(j+1))|)`, is about `p`
 * for every `j`. At a singular point `m` doubles outside, it is about 0 for
 * `2^j ≪ m` and `p` for `2^j ≫ m`. `p`, `m` and the part of a smooth
 * factor in the exponents are read from the exponents (`fitOutsidePole`).
 * When the exponent of the first two samples, without the smooth part, is
 * less than 0.8 times `p` (and `p` is more than 0.05), there is a pole at
 * the distance `M = m·s` outside, and the error depends on where the value
 * next to `e` comes from (`source`; `R = s·A·M^(−p)` is `|f|` next to `e`
 * times the spacing `s`), times `OUTSIDE_MODEL_SAFETY`:
 *
 * - the extrapolation of the shells (`'model'`): the value nearer to `e`
 *   than the last accurate shell, at the distance `D`, is the model of a
 *   singularity AT `e`, which puts `A·D^(1−p)/(1 − p)` there, and the pole
 *   puts `A·((D + M)^(1−p) − M^(1−p))/(1 − p)`. The error is the
 *   difference, about `A·M^(1−p)/(1 − p)` for `M ≪ D`. For a pole 10⁴
 *   doubles below `e = 1000` with `p = 3/4`, the true error was `2.32e-2`
 *   and the difference `2.31e-2`.
 * - the tanh-sinh rule (`'tanh-sinh'`): its nodes next to `e` are rounded to
 *   the doubles, and the error is `R`. Measured on 154 such results (poles 1
 *   to 10⁵ doubles outside, the smooth factors of `OUTSIDE_SHAPE_TOLERANCE`,
 *   endpoints 1 to 10⁶), the part of the true error that the error of the
 *   result did not cover was at most `0.56·R` for one double outside, and
 *   `0.08·R` for 10 doubles or more.
 * - the samples of the Gauss–Kronrod panels (`'samples'`): their error
 *   includes the rounding of the nodes (`positionShift`, `gauss-kronrod.ts`),
 *   except within one spacing of `e`, and the error is `R·min(1, s/M)`. Of
 *   294 such results, one needed more than their error: `0.12·R`, for one
 *   double outside.
 *
 * The area of the model over `4M`, `A·(4M)^(1−p)/(1 − p)`, for every
 * result, made 21 of 162 correct converged results not converged (`± 0.354`
 * for a true error of `7.5e-10` with a pole 10⁵ doubles below `e = 10⁶`).
 * For one double outside and `p = 1/2`, the first
 * exponent is `0.29`. A singularity AT `e` with a slowly varying factor
 * (`x^(−1/2)·|ln x|`) has exponents from `0.53` to `0.55`. The exponents
 * must also have the shape of a pole outside (`outsidePoleShape`): a pole
 * at `e` with a zero of the numerator next to it, or a logarithm inside the
 * interval, also gives a small first exponent. The function polls
 * `deadline` before each sample.
 */
function offsetSingularity(
  f: (x: number) => number,
  e: number,
  other: number,
  direction: 1 | -1,
  source: CornerSource,
  deadline: number | DeadlineFrame | undefined
): number {
  // At 0 the doubles are denormals: a singular point some of them from it
  // holds no area that matters.
  if (e === 0 || !Number.isFinite(e) || !Number.isFinite(other)) return 0;
  // The spacing of the doubles at `e`, toward the interval.
  const spacing = Math.abs(nextDouble(e, direction) - e);
  const inside = (x: number) =>
    direction > 0 ? x > e && x < other : x < e && x > other;
  const size = (x: number) => {
    const v = Math.abs(f(x));
    return Number.isNaN(v) ? Number.POSITIVE_INFINITY : v;
  };
  const at = (k: number) => e + direction * k * spacing;
  const distances: number[] = [];
  for (let k = 1; k <= 8; k++) distances.push(k);
  for (let k = 16; k <= OFFSET_SINGULARITY_SPACINGS; k *= 2) distances.push(k);
  const values: number[] = [];
  for (const k of distances) {
    if (!inside(at(k))) break;
    checkDeadline(deadline);
    values.push(size(at(k)));
  }
  if (values.length < 3) return 0;
  let peak = 0;
  for (let i = 1; i < values.length; i++)
    if (values[i] > values[peak]) peak = i;

  // Inside.
  if (
    !Number.isFinite(values[peak]) ||
    (peak > 0 && peak < values.length - 1 && values[peak] > 1.5 * values[0])
  ) {
    // A run of samples that are not finite at consecutive doubles is one
    // singular point, at the far end of the run from `e`. Next to a zero of
    // a difference that cancels in doubles, the integrand is `+∞` at some
    // doubles: `cos(t/2)/√(cos t − cos ½)` is `+∞` at ½ and at the 2 doubles
    // below it, because `cos t − cos ½` is 0 there. With the singular point
    // at the first double, the sample at the second double was read as a
    // second singular point, and the error was `+∞`. The run is made of the
    // samples at the distances 1 to 8 that follow the first sample that is
    // not finite. When the run reaches the sample at the distance 8, the
    // doubles after that sample are read one by one, each with `nextDouble`
    // from the one before (`at(k)` does not give consecutive doubles when
    // the spacing changes at a power of two), and the run ends at the last
    // double that is not finite (`1/√(cos t − cos 0.05)` is `+∞` at more
    // than 12 doubles below 0.05). The run ends at most
    // `NON_FINITE_RUN_SPACINGS` doubles from `e`: when the double after that
    // is also not finite, the error is `+∞`. The dyadic samples after 8 are not joined
    // to the run: poles at 8 and 16 doubles from `e` are two singular
    // points. When a sample farther from `e` than the end of the run is not
    // finite, there are finite doubles between them, so it is another
    // singular point, and the error is `+∞`. This is also true when there
    // is no run (`+∞` at 1 and 5 doubles from `e`).
    let c = at(distances[peak]);
    if (!Number.isFinite(values[peak])) {
      let last = peak;
      while (
        last + 1 < values.length &&
        distances[last + 1] === distances[last] + 1 &&
        !Number.isFinite(values[last + 1])
      )
        last++;
      c = at(distances[last]);
      if (distances[last] === 8) {
        let k = 8;
        for (;;) {
          const next = nextDouble(c, direction);
          if (!inside(next)) break;
          checkDeadline(deadline);
          if (Number.isFinite(size(next))) break;
          if (k === NON_FINITE_RUN_SPACINGS) return Number.POSITIVE_INFINITY;
          c = next;
          k++;
        }
      }
      for (let i = 0; i < values.length; i++)
        if (
          direction * (at(distances[i]) - c) > 0 &&
          !Number.isFinite(values[i])
        )
          return Number.POSITIVE_INFINITY;
    }
    if (Number.isFinite(values[peak])) {
      const lo = at(distances[Math.max(0, peak - 1)]);
      const hi = at(distances[peak + 1]);
      c = samplePeak(
        size,
        Math.min(lo, hi),
        Math.max(lo, hi),
        inside,
        deadline
      );
      const top = size(c);
      const below = nextDouble(c, -1);
      const above = nextDouble(c, 1);
      const side = Math.max(
        inside(below) ? size(below) : 0,
        inside(above) ? size(above) : 0
      );
      if (Number.isFinite(top) && side >= top * (1 - 2 ** -20)) return 0;
    }
    const d = Math.abs(c - e);
    // The distances (in units of `d`) of the two samples that give `p`. When
    // the integrand is 0 at a sample, the ratio gives no exponent, and the
    // next pair is tried: in `(x − (1 + 4u))/√|x − (1 + u)|` on `[1, 2]`
    // (`u = Number.EPSILON`), the numerator is 0 at `c + 3d`, and the error
    // was `+∞`.
    for (const [near, far] of [
      [1, 3],
      [2, 5],
      [1.5, 4],
    ]) {
      const x1 = c + direction * near * d;
      const x3 = c + direction * far * d;
      if (!inside(x1) || !inside(x3)) continue;
      const v1 = size(x1);
      const v3 = size(x3);
      // Both samples finite: a sample that is not finite is another singular
      // point (poles at `e + s` and `e + 4s`), and `p` read from it is not an
      // exponent (it was `−∞`, and the error was finite).
      if (!Number.isFinite(v1) || !Number.isFinite(v3))
        return Number.POSITIVE_INFINITY;
      if (!(v1 > 0 && v3 > 0)) continue;
      // The distances of the samples from `c`, after the rounding of `x1` and
      // `x3` to doubles.
      const r1 = Math.abs(x1 - c);
      const r3 = Math.abs(x3 - c);
      if (!(r3 > r1 && r1 > 0)) continue;
      // A negative `p` (`|f|` grows away from `c`) is counted as 0: in
      // `sin t/√|t − π|` on a lobe that starts one double below the double
      // `π̃` nearest to `π`, the zero of `sin` is next to the pole at `π̃`.
      const p = Math.log(v1 / v3) / Math.log(r3 / r1);
      if (!(p < 1)) return Number.POSITIVE_INFINITY;
      const q = Math.max(0, p);
      // `|f|` at the distance `d` from `c`, from the sample at `r1`.
      const v = v1 * (r1 / d) ** q;
      return (2 * d * v) / (1 - q);
    }
    return Number.POSITIVE_INFINITY;
  }

  // Outside: the exponents between the dyadic samples (1, 2, 4, 8, 16, …).
  const dyadic = distances
    .map((k, i) => [k, values[i]] as const)
    .filter(([k, v]) => (k & (k - 1)) === 0 && v !== undefined);
  if (dyadic.length < 8) return 0;
  const raw: number[] = [];
  for (let i = 0; i + 1 < dyadic.length; i++)
    raw.push(Math.log2(dyadic[i][1] / dyadic[i + 1][1]));
  if (!raw.every((q) => Number.isFinite(q))) return 0;
  const fit = fitOutsidePole(raw);
  if (fit === undefined) return 0;
  const { p } = fit;
  const exponents = raw.map((q, j) => q - smoothExponent(fit, j));
  if (!(p > OUTSIDE_MIN_EXPONENT)) return 0;
  if (!(exponents[0] < 0.8 * p)) return 0;
  if (!outsidePoleShape(exponents, raw, fit)) return 0;
  if (!(p < 1)) return Number.POSITIVE_INFINITY;
  // `|f| ≈ A·((k + m)·s)^(−p)` at the last sample, `k` doubles from `e` and
  // `m` doubles from the pole. With `k·s` alone, `A` was 7 % too small for a
  // pole 10⁵ doubles outside.
  const [kLast, vLast] = dyadic[dyadic.length - 1];
  const amplitude = vLast * ((kLast + fit.m) * spacing) ** p;
  const M = fit.m * spacing;
  // `|f|` next to `e` times the spacing of the doubles: the scale of the
  // error of a rule whose nodes next to `e` are rounded to the doubles.
  const rounding = spacing * amplitude * M ** -p;
  if (source.kind !== 'model')
    return (
      OUTSIDE_MODEL_SAFETY *
      rounding *
      (source.kind === 'samples' ? Math.min(1, spacing / M) : 1)
    );
  const D = source.width;
  // The model puts `A·D^(1−p)/(1 − p)` over `[e, e + D]`, and the pole puts
  // `A·((D + M)^(1−p) − M^(1−p))/(1 − p)` there.
  const misplaced =
    (amplitude * Math.abs(D ** (1 - p) - ((D + M) ** (1 - p) - M ** (1 - p)))) /
    (1 - p);
  return OUTSIDE_MODEL_SAFETY * misplaced;
}

/** Where the value of the integral next to a singular corner comes from (see
 * `resolveSingularEndpoints` and `offsetSingularity`). */
type CornerSource =
  | {
      /** The extrapolation of the shells: a model of a singularity AT the
       * endpoint over the distance `width` from it. */
      kind: 'model';
      width: number;
    }
  /** The samples of the Gauss–Kronrod panels, or of the tanh-sinh rule. */
  | { kind: 'samples' | 'tanh-sinh' };

/** The exponents of a pole `m` doubles outside an endpoint, with a smooth
 * factor (see `fitOutsidePole`). */
interface OutsidePoleFit {
  /** The exponent of the pole. */
  p: number;
  /** The distance of the pole from the endpoint, in doubles. */
  m: number;
  /** The coefficient of `2^j` in the smooth part of the exponent `q_j`. */
  linear: number;
  /** The coefficient of `4^j` in the smooth part of the exponent `q_j`. */
  quadratic: number;
}

/** The pole part `log₂((2^(j+1) + m)/(2^j + m))` of the dyadic exponent
 * `q_j` of a pole `m` doubles outside an endpoint, for `p = 1`. */
function outsidePoleExponent(j: number, m: number): number {
  return Math.log2((2 ** (j + 1) + m) / (2 ** j + m));
}

/** The part of the smooth factor in the dyadic exponent `q_j`. */
function smoothExponent(fit: OutsidePoleFit, j: number): number {
  return fit.linear * 2 ** j + fit.quadratic * 4 ** j;
}

/**
 * The exponent `p`, the distance `m` (in doubles) and the smooth part of a
 * pole outside an endpoint, read from the dyadic exponents
 * `q_j = log₂(|f(2^j·s)|/|f(2^(j+1)·s)|)` (`raw`), or `undefined`.
 *
 * The model is `q_j = p·log₂((2^(j+1) + m)/(2^j + m)) + C·2^j + D·4^j`: the
 * pole `(k + m)^(−p)` and a smooth factor `g`. `log g` is about linear in
 * the distance `k` at this scale, and its curvature is the `4^j` part (for
 * `1 + 100·u` at `e = 10⁶`, without that part the last exponents missed the
 * model by `5e-3`, with it by `2.5e-5`). For a fixed `m`, `p`, `C` and `D`
 * are read from the last three exponents; `m` is read from the first one,
 * `q₀ − C − D = p·log₂((2 + m)/(1 + m))`. The two steps alternate until `m`
 * changes by less than `10⁻¹²` relative (at most 100 steps: the last
 * exponents depend little on `m`).
 *
 * A model with a pole part that halves at each step (`p − A/2^j`) holds only
 * for `2^j ≫ m`. For a pole 10⁴ doubles outside, the last exponents missed
 * it by 3 %, and by 20 % for 10⁵ doubles, and the pole was not counted:
 * `(x − c)^(−3/4)` with `c` 10⁴ doubles below `e = 10³` was `converged`,
 * `± 1.5e-10`, for a true error of `2.3e-2`.
 */
function fitOutsidePole(raw: number[]): OutsidePoleFit | undefined {
  const n = raw.length;
  if (n < 6) return undefined;
  const mFrom = (q0: number, p: number) => {
    const r = 2 ** (q0 / p);
    return r > 1 && r < 2 ? (2 - r) / (r - 1) : Number.NaN;
  };
  // The last three exponents are at `j = n − 1, n − 2, n − 3`, and
  // `K = 2^(n−3)`.
  const K = 2 ** (n - 3);
  let m = mFrom(raw[0], raw[n - 1]);
  for (let step = 0; step < 100; step++) {
    if (!(m > 0 && Number.isFinite(m))) return undefined;
    const a = outsidePoleExponent(n - 1, m);
    const b = outsidePoleExponent(n - 2, m);
    const c = outsidePoleExponent(n - 3, m);
    // The weights `1, −6, 8` cancel `C·2^j` (`4K − 12K + 8K`) and `D·4^j`
    // (`16K² − 24K² + 8K²`).
    const p =
      (raw[n - 1] - 6 * raw[n - 2] + 8 * raw[n - 3]) / (a - 6 * b + 8 * c);
    if (!(p > 0 && Number.isFinite(p))) return undefined;
    // `rb = 2K·C + 4K²·D` and `rc = K·C + K²·D`.
    const rb = raw[n - 2] - p * b;
    const rc = raw[n - 3] - p * c;
    const quadratic = (rb - 2 * rc) / (2 * K * K);
    const linear = (rc - K * K * quadratic) / K;
    const next = mFrom(raw[0] - linear - quadratic, p);
    if (!(next > 0 && Number.isFinite(next))) return undefined;
    const done = Math.abs(next - m) <= 1e-12 * m;
    m = next;
    if (done) return { p, m, linear, quadratic };
  }
  return undefined;
}

/**
 * Whether the dyadic exponents `q_j = log₂(|f(2^j·s)|/|f(2^(j+1)·s)|)` at
 * the doubles next to an endpoint (`raw`, and `exponents` without their
 * smooth part) are those of a pole `(k + m)^(−p)` that is `m > 0` doubles
 * outside the interval: `q_j = p·log₂((2^(j+1) + m)/(2^j + m))`. `p`, `m`
 * and the smooth part are the `fit` (`fitOutsidePole`).
 *
 * - `m` is read from `q₀`, and the model must give `q₁` and `q₂` within
 *   `10⁻³·p`. For a pole outside (`m` from 1 to 10⁵), the difference was
 *   at most `2e-7·p` with the smooth factors `1`, `1 + 100·u`,
 *   `1/(1 + 100·u)`, `e^u` and `e^(−300·u)`, `2.2e-5·p` with
 *   `2 + sin(1000·u)` and `1.7e-4·p` with `1 + 1000·u`. For a pole AT the
 *   endpoint with a zero of the numerator next to it (`|f| ∝ |k −
 *   z|·k^(−p−1)`, as in `sin t/|t − π|^1.5` on a lobe that starts at the
 *   double nearest to `π`, where `z = 0.27`) it is at least `0.09·p`, and
 *   for `ln²(x − e)` at least `0.17·p` (endpoints 0.3 to 10⁶).
 * - No exponent is less than `−0.02`, and `m` is positive: for
 *   `ln|x − c|` with `c` 10⁵ doubles INSIDE the interval, `m` is negative.
 * - The last exponents settle as those of a pole with a smooth factor do.
 *   The last three exponents give `p` and the smooth part, so the two
 *   differences `q_j − q_(j−1)` before them (`j = n − 3` and `n − 4`) are
 *   compared with the model: each must be within `OUTSIDE_SHAPE_TOLERANCE`
 *   of it, relative to the size of its pole part, its smooth part and the
 *   difference, unless the differences are at the level of rounding. (A test
 *   that the differences halve missed a pole outside with a smooth factor,
 *   whose last differences double: `(1 + 100·u)/√(x − c)`, `c` one double
 *   below 1000, was `converged`, `± 5.4e-12`, for a true error of `6.7e-7`.)
 *
 * This replaces a test of `f(e)`, which the quadrature does not sample
 * (`f(e)` is not finite at a singular endpoint, but a guard can return
 * `NaN` or `+∞` there for a pole outside).
 */
function outsidePoleShape(
  exponents: number[],
  raw: number[],
  fit: OutsidePoleFit
): boolean {
  const { p, m } = fit;
  if (exponents.some((q) => q < -0.02)) return false;
  if (!(m > 0)) return false;
  const pole = (j: number) => p * outsidePoleExponent(j, m);
  if (Math.abs(pole(1) - exponents[1]) > 1e-3 * p) return false;
  if (Math.abs(pole(2) - exponents[2]) > 1e-3 * p) return false;
  // The differences `q_j − q_(j−1)` of the two exponents before the last
  // three (which give `p`, `C` and `D`), compared with the model with its
  // smooth part.
  const n = raw.length;
  const differences = [n - 3, n - 4].map((j) => raw[j] - raw[j - 1]);
  if (
    [n - 1, n - 2, n - 3, n - 4].every(
      (j) => Math.abs(raw[j] - raw[j - 1]) <= 1e-9
    )
  )
    return true;
  // Relative to the size of the parts, not of their sum: the parts can
  // cancel in a difference (`e^u·(x − c)^(−1/4)` at `e = 10⁵`, `c` one
  // double below: a difference was `−2.4e-11` for parts of `1.4e-6`, and
  // the result `converged`, `± 7.6e-11`, for a true error of `3.7e-9`).
  return [n - 3, n - 4].every((j, i) => {
    const d = differences[i];
    const polePart = pole(j) - pole(j - 1);
    const smoothPart = smoothExponent(fit, j) - smoothExponent(fit, j - 1);
    return (
      Math.abs(polePart + smoothPart - d) <=
      OUTSIDE_SHAPE_TOLERANCE *
        (Math.abs(polePart) + Math.abs(smoothPart) + Math.abs(d))
    );
  });
}

/** The number of samples per octave of the distance to the endpoint in
 * `featureNearEndpoint`. A bump whose width is a quarter of its distance to
 * the endpoint holds at least one sample. */
const FEATURE_SAMPLES_PER_OCTAVE = 4;

/** The number of accurate shells, counted back from the last one, over which
 * `featureNearEndpoint` reads the integrand: the shells of the partial sums
 * of the ε-algorithm (`EPSILON_SUMS` sums and one more shell). */
const FEATURE_SHELLS = EPSILON_SUMS + 1;

/** The number of octaves past the last accurate shell over which
 * `featureNearEndpoint` reads the integrand, toward the endpoint. At a
 * nonzero endpoint the last accurate shell is about `ACCURATE_SHELL_SPACINGS
 * = 2²⁰` spacings of the doubles from it, so these octaves reach the
 * `FEATURE_MIN_SPACINGS` limit first. */
const FEATURE_NARROW_OCTAVES = 20;

/** The smallest distance to a nonzero endpoint, in spacings of the doubles
 * there, at which `featureNearEndpoint` tests a sample. Nearer, the samples
 * are only some doubles apart. */
const FEATURE_MIN_SPACINGS = 64;

/** The number of fourth differences on each side of a sample that give its
 * noise level in `featureNearEndpoint` (two octaves). */
const FEATURE_NOISE_WINDOW = 8;

/**
 * The smallest ratio of the fourth difference at a sample to the noise level
 * next to it that `featureNearEndpoint` reads as a feature. The factors 20,
 * 100 and 1000 gave the same results on the 900 steps and bumps of
 * `docs/scratch/2026-10-30-ce691-quadrature/sweep.mts`, on 420 integrals with
 * no feature and on 80 integrals with rounding noise (`cancel.mts`). 100
 * leaves a margin against noise that is not uniform: in the interpreted
 * integrand `y^(−1/2)·e^(−y/2)` of Tycho row 422, the fourth difference at
 * the border of a part with rounding noise was 27 times the noise level of
 * the other side.
 */
const FEATURE_NOISE_RATIO = 100;

/** The smallest fourth difference of the exponents that
 * `featureNearEndpoint` reads as a feature, when the noise level is 0. */
const FEATURE_MIN_DIFFERENCE = 1e-13;

/**
 * Whether the integrand has a feature (a step, a bump, a zero) next to the
 * endpoint of `corner` that the extrapolation of its shells does not see.
 * `direction` points from the endpoint into the interval. The function polls
 * `deadline` before each sample.
 *
 * The extrapolation reads the accurate shells only (`accurateShells`). The
 * value nearer to the endpoint than the last accurate shell, at the
 * distance `D`, is a model of a singularity AT the endpoint. Next to a
 * nonzero endpoint, `D` is about `2²⁰` spacings of the doubles. A shell that
 * holds a small feature can also pass the accuracy test, and the
 * ε-algorithm then reads partial sums that do not converge geometrically.
 * For `(c − x)^(−1/2)` on `[c − 0.3, c]` plus a step or a bump at the
 * distance `d` from `c`, the error was smaller than the true error in 180
 * of 900 extrapolated cases (`docs/scratch/2026-10-30-ce691-quadrature/
 * sweep.mts`): a step of height 1 at `d = 1.27e-10` from `0.3` gave
 * `± 1.4e-13` for a true error of `1.3e-10`, and a step of height `1e-4` at
 * `d = 2.59e-7` from `0.7` gave `± 2.5e-12` for `2.6e-11`.
 *
 * The function reads `|f|` at `FEATURE_SAMPLES_PER_OCTAVE` points per octave
 * of the distance `t` to the endpoint, from the outer edge of the last
 * `FEATURE_SHELLS` accurate shells to `D/2^FEATURE_NARROW_OCTAVES` (at
 * least `FEATURE_MIN_SPACINGS` spacings of the doubles from the endpoint),
 * and some samples past each end of that range. Each sample is at a double,
 * and `t` is its exact distance to the endpoint. Next to an endpoint where
 * `|f| = t^(−p)·h(t)`, the exponent between two samples,
 * `e = ln(|f(t₂)|/|f(t₁)|)/ln(t₁/t₂)`, changes slowly from one pair of
 * samples to the next: it is `p` for a power, `p + O(1/ln t)` for a
 * logarithmic factor, and `p + O(t)` for a smooth factor. A step between two
 * samples changes one exponent, and a bump two. The test reads the fourth
 * difference of the exponents at each sample, and compares it with the
 * noise level next to it: the larger of the medians of the
 * `FEATURE_NOISE_WINDOW` fourth differences on each side, without the five
 * that the sample changes. A feature is a fourth difference larger than
 * `FEATURE_NOISE_RATIO` times the noise level plus `FEATURE_MIN_DIFFERENCE`.
 *
 * The noise level comes from the samples, not from the doubles next to a
 * sample: for `1/√(1 − x²)` next to 1, `x²` moves by an exact step between
 * neighboring doubles, so the rounding error of `1 − x²` (`2e-9` in the
 * exponents) is the same for neighbors. One median over both sides is not
 * used either: the samples of the interpreted integrand of Tycho row 422 have
 * rounding noise farther than `3e-11` from the endpoint and none nearer, and
 * at the border that median came from the side with no noise.
 *
 * A sample of `0` nearer to the endpoint than the outer samples past the
 * tested range and not nearer than its near end is a feature, and so is a
 * sample whose sign is not the sign of the accurate shells, and a sample that
 * is not finite farther from the endpoint than `D` (the shells there are
 * finite, so it is another singular point). Nearer than `D`, a sample that
 * is not finite stops the samples: `x^(−0.99)` overflows at the denormals
 * next to 0. Not tested when the accurate shells change sign: next to an
 * endpoint where the integrand oscillates (`cos(ln t)/t^0.999` at 0), the
 * exponents have poles at the zeros of the integrand.
 *
 * Not seen: a feature smaller than `FEATURE_NOISE_RATIO` times the noise
 * level, a bump narrower than about a quarter of an octave of `t` (it can
 * fall between two samples), a feature nearer than `FEATURE_MIN_SPACINGS`
 * spacings to a nonzero endpoint, a feature in the shells farther from
 * the endpoint than the tested range, which the Levin u-transform and the
 * model of `shellTail` can read, and a feature in the outer octave of the
 * tested range when the corner panel ends there (fewer than about
 * `FEATURE_SHELLS + 3` accurate shells: at a large endpoint such as `10⁵`).
 */
function featureNearEndpoint(
  f: (x: number) => number,
  corner: CornerSeries,
  direction: 1 | -1,
  deadline: number | DeadlineFrame | undefined
): boolean {
  const e = corner.endpoint;
  const spacing = Math.max(Math.abs(e) * Number.EPSILON, Number.MIN_VALUE);
  const n = accurateShells(corner).count;
  const accurate = corner.shells.slice(0, n);
  if (!(accurate.every((v) => v > 0) || accurate.every((v) => v < 0)))
    return false;
  const sign = Math.sign(accurate[0]);
  // The distance of the last accurate shell to the endpoint.
  const last = corner.width / 2 ** n;
  // The tested range, `[near, far]`.
  const far = corner.width / 2 ** Math.max(0, n - FEATURE_SHELLS);
  const near = Math.max(
    FEATURE_MIN_SPACINGS * spacing,
    last / 2 ** FEATURE_NARROW_OCTAVES
  );
  // Past each end of the tested range, enough samples for the window of
  // the noise level, the five fourth differences that a sample changes, and
  // the four exponents of a fourth difference. Not farther than the corner
  // panel, which is inside the interval.
  const extra = FEATURE_NOISE_WINDOW + 5;
  const top = Math.min(
    corner.width,
    far * 2 ** (extra / FEATURE_SAMPLES_PER_OCTAVE)
  );
  const bottom = Math.max(
    spacing,
    near / 2 ** (extra / FEATURE_SAMPLES_PER_OCTAVE)
  );
  const distances: number[] = [];
  const values: number[] = [];
  for (let i = 0; ; i++) {
    const target = top / 2 ** (i / FEATURE_SAMPLES_PER_OCTAVE);
    if (!(target >= bottom)) break;
    const x = e + direction * target;
    const t = Math.abs(x - e);
    if (!(t > 0)) break;
    // Next to the endpoint, two targets can round to the same double.
    if (distances.length > 0 && t === distances[distances.length - 1]) continue;
    checkDeadline(deadline);
    const y = f(x);
    const v = Math.abs(y);
    if (v === 0) {
      if (t >= near) return true;
      break;
    }
    if (!Number.isFinite(v)) {
      if (t >= last) return true;
      break;
    }
    // A step that changes the sign of the integrand and not its magnitude
    // (`(t < d ? −1 : 1)/√t`) leaves the exponents of `|f|` unchanged.
    if (Math.sign(y) !== sign) return true;
    distances.push(t);
    values.push(v);
  }
  // `exponents[i]` is the exponent between the samples `i` and `i + 1`.
  const exponents: number[] = [];
  for (let i = 0; i + 1 < distances.length; i++)
    exponents.push(
      Math.log(values[i + 1] / values[i]) /
        Math.log(distances[i] / distances[i + 1])
    );
  // `differences[i]` is the fourth difference centered on the exponent
  // `i + 2`, the exponent between the samples `i + 2` and `i + 3`.
  const differences: number[] = [];
  for (let i = 2; i + 2 < exponents.length; i++)
    differences.push(
      Math.abs(
        exponents[i - 2] -
          4 * exponents[i - 1] +
          6 * exponents[i] -
          4 * exponents[i + 1] +
          exponents[i + 2]
      )
    );
  const median = (v: number[]) => {
    const sorted = [...v].sort((p, q) => p - q);
    return sorted[Math.floor(sorted.length / 2)];
  };
  for (let i = 0; i < differences.length; i++) {
    const t = distances[i + 2];
    if (!(t >= near && t <= far)) continue;
    // A change of one exponent changes the five fourth differences from
    // `i − 2` to `i + 2`: they are left out of the noise level.
    const before = differences.slice(
      Math.max(0, i - 2 - FEATURE_NOISE_WINDOW),
      Math.max(0, i - 2)
    );
    const after = differences.slice(i + 3, i + 3 + FEATURE_NOISE_WINDOW);
    // At the outer end of the range, the corner panel can leave no room for
    // samples past it (few accurate shells). A noise level from the side
    // toward the endpoint only is not used there: the fourth differences of a
    // smooth factor such as `exp(10⁻⁴·t⁵)` fall by `2^(−5/4)` per sample
    // toward the endpoint, and that side gave a noise level 181 times
    // smaller than the fourth difference at the sample.
    if (before.length < 4 || after.length < 4) continue;
    const noise = Math.max(median(before), median(after));
    if (differences[i] > FEATURE_NOISE_RATIO * noise + FEATURE_MIN_DIFFERENCE)
      return true;
  }
  return false;
}

/** The double next to `x` toward `+∞` (`direction` 1) or `−∞` (−1). */
export function nextDouble(x: number, direction: 1 | -1): number {
  if (Number.isNaN(x) || x === direction * Infinity) return x;
  if (x === 0) return direction * Number.MIN_VALUE;
  const buffer = new Float64Array([x]);
  const bits = new BigInt64Array(buffer.buffer);
  bits[0] += x > 0 === direction > 0 ? 1n : -1n;
  return buffer[0];
}

/**
 * The point of `[lo, hi]` where `size` is largest, by a golden-section
 * search and then a walk of at most 64 doubles while `size` is larger at a
 * neighbor. Only the points where `inside` is true are read.
 */
function samplePeak(
  size: (x: number) => number,
  lo: number,
  hi: number,
  inside: (x: number) => boolean,
  deadline: number | DeadlineFrame | undefined
): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let x1 = b - ratio * (b - a);
  let x2 = a + ratio * (b - a);
  let f1 = inside(x1) ? size(x1) : 0;
  let f2 = inside(x2) ? size(x2) : 0;
  for (let i = 0; i < 200 && a < x1 && x1 < x2 && x2 < b; i++) {
    checkDeadline(deadline);
    if (f1 >= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - ratio * (b - a);
      f1 = inside(x1) ? size(x1) : 0;
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + ratio * (b - a);
      f2 = inside(x2) ? size(x2) : 0;
    }
  }
  let s = f1 >= f2 ? x1 : x2;
  let fs = Math.max(f1, f2);
  for (let i = 0; i < 64 && fs < Infinity; i++) {
    checkDeadline(deadline);
    const down = nextDouble(s, -1);
    const up = nextDouble(s, 1);
    const fDown = inside(down) ? size(down) : 0;
    const fUp = inside(up) ? size(up) : 0;
    if (fDown <= fs && fUp <= fs) break;
    if (fUp >= fDown) {
      s = up;
      fs = fUp;
    } else {
      s = down;
      fs = fDown;
    }
  }
  return s;
}

/** The result of `resolveSingularEndpoints` before the test of a singularity
 * inside an endpoint (`offsetSingularity`). */
function resolveCorners(
  f: (x: number) => number,
  a: number,
  b: number,
  gk: GaussKronrodOutcome,
  options: {
    rtol: number;
    atol: number;
    maxEvaluations: number;
    deadline: number | DeadlineFrame | undefined;
  }
): QuadratureResult {
  // The area of the last corner panel of each singular corner, when the
  // adaptive quadrature left that panel out (`uncountedArea`). It is in the
  // error of every Gauss–Kronrod value below. It is not in the error of an
  // extrapolated value, whose extrapolation replaces the whole corner, and a
  // tanh-sinh value has its own term (`tanhSinhExtra`).
  const singular = [gk.lo, gk.hi].filter(
    (c) => c.shells.length >= SINGULAR_SHELLS
  );
  const uncounted = singular.reduce((sum, c) => sum + uncountedArea(c), 0);
  // The part of the error of the last corner panel of each singular corner
  // that its Gauss–Kronrod error misses (`lastPanelGap`). It is in the error
  // of every Gauss–Kronrod value below.
  const gkError =
    gk.error + singular.reduce((sum, c) => sum + lastPanelGap(c), 0);
  // Tanh-sinh leaves out its nodes that round to an endpoint (those closer
  // than half a spacing `u` of the doubles), and reads the other nodes at the
  // nearest double: its value lacks about the integral over `[0, u/2]` from
  // each singular endpoint. For `x^(−p)` (`0.1 ≤ p ≤ 0.99`), the reading at
  // the nearest double adds a loss of at most `0.024` times the area of the
  // first double, and the whole loss is `0.54` to `0.99` times that area,
  // about half of the area of the model over `[0, u/2]` (which has the
  // factor `UNCOUNTED_SAFETY`). For `∫ (x − 1000)^(−0.1) dx` on
  // `[1000, 1001]`, the tanh-sinh value was `converged`, `± 1.77e-12`, for a
  // true error of `1.85e-12` (the area of the first double is `2.5e-12`).
  // The error of a tanh-sinh value `t` with the error `error` is the smaller
  // of two bounds: `error` plus that area from the model of the shells
  // (`cornerModelArea`), and `|t − g|` plus the error of the Gauss–Kronrod
  // value `g` (with `uncounted` and `lastPanelGap`), never less than
  // `error`. The second one is often smaller:
  // the last corner panel of `g` is finite when its nodes do not round to
  // the endpoint, and its value counts the first double. For
  // `ln²(x − 1000)` on `[1000, 1001]` (0 at 1000), the first bound is
  // `3.1e-10`, the second `1.5e-10`, and the true error `7e-11`.
  const tanhSinhLoss = singular.reduce((sum, c) => {
    const u = Math.abs(
      nextDouble(c.endpoint, c === gk.lo ? 1 : -1) - c.endpoint
    );
    // A last corner panel wider than `TANH_SINH_MODEL_SPACINGS` spacings
    // holds a part of the corner that no shell samples, and the model is no
    // evidence about the first double: the loss is then not known, and the
    // second bound is used.
    if (lastPanelHoldsFeature(c)) return Number.POSITIVE_INFINITY;
    return sum + cornerModelArea(c, 0.5 * u, uncountedArea(c) > 0);
  }, 0);
  const tanhSinhExtra = (t: { estimate: number }, error: number) =>
    Math.min(
      tanhSinhLoss,
      Math.max(
        0,
        Math.abs(t.estimate - gk.estimate) + gkError + uncounted - error
      )
    );
  const plain = (
    r: {
      estimate: number;
      error: number;
      converged: boolean;
    },
    extra = uncounted
  ): QuadratureResult => {
    if (extra === 0)
      return {
        estimate: r.estimate,
        error: r.error,
        converged: r.converged,
        divergent: false,
      };
    const error = r.error + extra;
    return {
      estimate: r.estimate,
      error,
      converged:
        r.converged &&
        error <=
          Math.max(
            Math.min(options.atol, options.rtol * gk.magnitude),
            options.rtol * Math.abs(r.estimate)
          ),
      divergent: false,
    };
  };
  const divergentResult: QuadratureResult = {
    estimate: gk.estimate,
    error: gk.error,
    converged: false,
    divergent: true,
  };
  if (gk.divergent) return divergentResult;
  // A non-finite estimate with a tail that was not shown to shrink is a
  // divergence, as with a finite estimate.
  if (!Number.isFinite(gk.estimate))
    return gk.unresolved ? divergentResult : plain(gk);

  const corners = [gk.lo, gk.hi].filter(
    (c) => c.shells.length >= SINGULAR_SHELLS
  );
  if (corners.length === 0) return gk.unresolved ? divergentResult : plain(gk);

  // From here, an endpoint is a singular corner: a result that did not
  // converge carries `singularCorner` (see `QuadratureResult`). Not when its
  // error is not finite: a panel of the adaptive quadrature then has no
  // value, and the estimate is not a value of the integral. Not when the
  // shells of a corner change sign either: the integrand oscillates there
  // (`sin(1/x)` at 0), uniform samples are not biased toward one side, and
  // the callers keep their Monte-Carlo fallback. Only the finite shells are
  // read: the narrowest shells of `1/(x·(−ln x)·ln²(−ln x))` overflow.
  const oneSign = corners.every((c) => {
    const last = c.shells.filter(Number.isFinite).slice(-SINGULAR_SHELLS);
    return (
      last.length > 0 && (last.every((v) => v > 0) || last.every((v) => v < 0))
    );
  });
  const unresolvedCorner = (
    r: {
      estimate: number;
      error: number;
      converged: boolean;
    },
    extra = uncounted
  ): QuadratureResult => {
    const q = plain(r, extra);
    return q.converged || !oneSign || !Number.isFinite(q.error)
      ? q
      : { ...q, singularCorner: true };
  };

  const atol = Math.min(options.atol, options.rtol * gk.magnitude);
  const tolerance = (v: number) => Math.max(atol, options.rtol * Math.abs(v));

  let ts: ReturnType<typeof tanhSinh> | undefined;
  const runTanhSinh = () => (ts ??= tanhSinh(f, a, b, { ...options, atol }));

  // A converged result: the tanh-sinh rule must not contradict it.
  // `contradiction` is the difference with a converged tanh-sinh value that
  // does not agree.
  let contradiction: number | undefined;
  if (gk.converged && !gk.unresolved) {
    const t = runTanhSinh();
    if (!t.usable || !t.converged)
      return unresolvedCorner({
        estimate: gk.estimate,
        error: gkError,
        converged: gkError === gk.error || gkError <= tolerance(gk.estimate),
      });
    const difference = Math.abs(t.estimate - gk.estimate);
    // A last corner panel that holds a feature the shells do not see
    // (`lastPanelHoldsFeature`): the Gauss–Kronrod value integrates that
    // panel, and tanh-sinh leaves out the part of it next to the endpoint,
    // so the Gauss–Kronrod value is kept. With the tanh-sinh value and the
    // bound of its error through the Gauss–Kronrod value (`tanhSinhExtra`),
    // `(x − 10⁶)^(−0.9)·(x − 10⁶ − 10⁻¹¹)` on `[10⁶, 10⁶ + 1]` was not
    // converged, `± 1.55e-10`, for a true error of `6.4e-11`; the
    // Gauss–Kronrod value is `± 8.1e-11` for `1.1e-11`.
    if (
      difference <= Math.max(tolerance(gk.estimate), 10 * gk.error) &&
      singular.some(lastPanelHoldsFeature)
    )
      return unresolvedCorner({
        estimate: gk.estimate,
        error: gkError,
        converged: gkError <= tolerance(gk.estimate),
      });
    if (difference <= Math.max(tolerance(gk.estimate), 10 * gk.error)) {
      const error = Math.max(t.error, difference);
      return unresolvedCorner(
        {
          estimate: t.estimate,
          error,
          converged: error <= tolerance(t.estimate),
        },
        tanhSinhExtra(t, error)
      );
    }
    contradiction = difference;
  }

  // The extrapolation of each singular corner.
  let estimate = gk.estimate;
  let error = gk.error;
  let failed = false;
  let tailSpread = 0;
  let oscillates = false;
  for (const corner of corners) {
    let x = extrapolateCorner(corner);
    // A feature of the integrand next to the endpoint that the shells do not
    // show (`featureNearEndpoint`) stops the extrapolation, as a feature
    // that the shells show does (`featureAfterShells` in
    // `extrapolateCorner`). The correction of the refused extrapolation and
    // its error stay in the uncertainty of the Gauss–Kronrod result, as for
    // an extrapolation that is not used (see `tailSpread` below). When a
    // corner already failed, the result is not extrapolated, and the
    // integrand is not sampled.
    if (
      x.ok &&
      !failed &&
      featureNearEndpoint(
        f,
        corner,
        corner === gk.lo ? 1 : -1,
        options.deadline
      )
    )
      x = { ok: false, spread: Math.abs(x.value - corner.value) + x.error };
    if (x.ok) {
      estimate += x.value - corner.value;
      error += x.error - corner.error;
      // When the corrected result is not used, the Gauss–Kronrod result
      // misses the correction of this corner, so the correction is part of
      // the uncertainty of that result. The tail of a model of the shells
      // (`shellTail`) can be most of the integral and have an error above
      // `EXTRAPOLATED_RELATIVE_ERROR`: for `1/(t·(ln 1000 − ln t)^1.1)` at 0
      // on `[0, ½]`, the result was `2.99 ± 2.6e-12` without this, and the
      // integral is `8.16`. The uncertainties of the corners are added: the
      // Gauss–Kronrod result misses the corrections of all the corners. With
      // the largest one only, `∫₀¹ (−ln(t/2))^(−1.1)/t +
      // (−ln((1 − t)/2))^(−2)/(1 − t) dt = 11.816` gave `6.608 ± 5.182`.
      tailSpread += Math.abs(x.value - corner.value) + x.error;
    } else {
      failed = true;
      tailSpread += x.spread;
      if (x.oscillates === true) oscillates = true;
    }
  }
  error = Math.max(error, 0);
  if (
    !failed &&
    Number.isFinite(estimate) &&
    Number.isFinite(error) &&
    error <=
      Math.max(
        tolerance(estimate),
        EXTRAPOLATED_RELATIVE_ERROR * Math.abs(estimate)
      )
  ) {
    return {
      estimate,
      error,
      converged: error <= tolerance(estimate),
      divergent: false,
      extrapolated: true,
    };
  }
  if (oscillates) return { ...divergentResult, oscillates: true };
  if (gk.unresolved) return divergentResult;

  if (contradiction !== undefined)
    return unresolvedCorner({
      estimate: gk.estimate,
      error: Math.max(gkError, tailSpread, contradiction),
      converged: false,
    });

  // Tanh-sinh is a rule for an algebraic or logarithmic singularity, whose
  // shells have one sign. Next to an endpoint where the integrand oscillates
  // (`sin(1/x)` at 0), it is less accurate than the Gauss–Kronrod result, and
  // its evaluations are wasted.
  if (!corners.every(shellsHaveOneSign))
    return unresolvedCorner({
      estimate: gk.estimate,
      error: Math.max(gkError, tailSpread),
      converged: false,
    });

  const t = runTanhSinh();
  if (t.usable && t.converged && Math.abs(t.estimate - gk.estimate) <= gk.error)
    return plain(
      { estimate: t.estimate, error: t.error, converged: true },
      tanhSinhExtra(t, t.error)
    );

  // The Gauss–Kronrod result, with a bound that covers the difference with
  // tanh-sinh and the uncertainty of the corners. The difference
  // with tanh-sinh is used only when it is larger than the error estimate of
  // tanh-sinh (the difference of its last two levels): otherwise the
  // difference can come from the error of tanh-sinh.
  let widened = Math.max(gkError, tailSpread);
  const difference = Math.abs(t.estimate - gk.estimate);
  if (t.usable && t.error < difference) widened = Math.max(widened, difference);
  return unresolvedCorner({
    estimate: gk.estimate,
    error: widened,
    converged: false,
  });
}
