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
  /** The sum of the values and the sum of the errors of the panels of the
   * adaptive quadrature inside the corner panel before the first bisection
   * (the points at a distance less than `width` from the endpoint). */
  value: number;
  error: number;
  /** The width of the corner panel before the first bisection. */
  width: number;
  /** The endpoint. */
  endpoint: number;
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
  // Only the shells that are accurate: finite (a shell next to the endpoint
  // can overflow, `x^(−0.999)` is `+∞` at a denormal `x`), and wide enough
  // for the rounding of its nodes not to matter (see
  // `ACCURATE_SHELL_SPACINGS`).
  const spacing = Math.max(
    Math.abs(corner.endpoint) * Number.EPSILON,
    Number.MIN_VALUE
  );
  let n = 0;
  while (
    n < corner.shells.length &&
    Number.isFinite(corner.shells[n]) &&
    corner.shellErrors[n] <=
      SHELL_RELATIVE_ERROR * Math.abs(corner.shells[n]) + Number.MIN_VALUE &&
    corner.width / 2 ** (n + 1) >= ACCURATE_SHELL_SPACINGS * spacing
  )
    n++;
  if (n < MIN_EXTRAPOLATION_SHELLS) return { ok: false, spread: 0 };
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
  const epsilon = [
    wynnEpsilon(sums.slice(n - m)),
    wynnEpsilon(sums.slice(n - 1 - m, n - 1)),
  ];

  // The Levin u-transform uses the term index of a shell from a distance of
  // 1 to the endpoint (`beta`): the k-th term of `1/(x·ln²x)` is
  // `1/(k·(k+1)·ln 2)` with that index. Orders 3 and 4, from the shells
  // `LEVIN_START` and `2·LEVIN_START`: from a later shell, the differences
  // of the transform cancel and lose the digits (from the shell 1000, two
  // orders differ by 1e-2).
  const levin: (number | undefined)[] = [];
  if (shellDecayExponent(shells, beta) >= LEVIN_MIN_DECAY)
    for (const start of [LEVIN_START, 2 * LEVIN_START])
      for (const order of [3, 4]) levin.push(levinU(sums, start, order, beta));

  let spread = 0;
  for (const v of [...epsilon, ...levin])
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
  const pairs: [number | undefined, number | undefined][] = powerDecay
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
  let best: { value: number; difference: number } | undefined;
  for (const [u, v] of pairs) {
    if (u === undefined || v === undefined) continue;
    const difference = Math.abs(u - v);
    const scale = Math.max(Math.abs(u), Math.abs(v));
    if (!(difference <= EXTRAPOLATION_AGREEMENT * scale)) continue;
    if (best === undefined || difference < best.difference)
      best = { value: u, difference };
  }
  if (best === undefined) {
    const m = modelled();
    return m.ok ? m : { ok: false, spread: Math.max(spread, m.missing) };
  }

  // The error is the difference of the two extrapolations, enlarged, plus
  // the errors of the shells, and at least the rounding error of the sum of
  // the shells.
  const error =
    Math.max(
      EXTRAPOLATION_SAFETY * best.difference,
      4 * Number.EPSILON * magnitude
    ) + shellError;
  return { ok: true, value: best.value, error };
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
 * value. `0` when the shells change sign or vanish.
 */
function shellDecayExponent(shells: number[], offset: number): number {
  const n = shells.length;
  const i = Math.floor(n / 2);
  const j = n - 1;
  const u = shells[i];
  const v = shells[j];
  if (!(u * v > 0)) return 0;
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
  const plain = (r: {
    estimate: number;
    error: number;
    converged: boolean;
  }): QuadratureResult => ({
    estimate: r.estimate,
    error: r.error,
    converged: r.converged,
    divergent: false,
  });
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
  const unresolvedCorner = (r: {
    estimate: number;
    error: number;
    converged: boolean;
  }): QuadratureResult =>
    r.converged || !oneSign || !Number.isFinite(r.error)
      ? plain(r)
      : { ...plain(r), singularCorner: true };

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
    if (!t.usable || !t.converged) return plain(gk);
    const difference = Math.abs(t.estimate - gk.estimate);
    if (difference <= Math.max(tolerance(gk.estimate), 10 * gk.error)) {
      const error = Math.max(t.error, difference);
      return unresolvedCorner({
        estimate: t.estimate,
        error,
        converged: error <= tolerance(t.estimate),
      });
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
    const x = extrapolateCorner(corner);
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
      error: Math.max(gk.error, tailSpread, contradiction),
      converged: false,
    });

  // Tanh-sinh is a rule for an algebraic or logarithmic singularity, whose
  // shells have one sign. Next to an endpoint where the integrand oscillates
  // (`sin(1/x)` at 0), it is less accurate than the Gauss–Kronrod result, and
  // its evaluations are wasted.
  if (!corners.every(shellsHaveOneSign))
    return unresolvedCorner({
      estimate: gk.estimate,
      error: Math.max(gk.error, tailSpread),
      converged: false,
    });

  const t = runTanhSinh();
  if (t.usable && t.converged && Math.abs(t.estimate - gk.estimate) <= gk.error)
    return plain({ estimate: t.estimate, error: t.error, converged: true });

  // The Gauss–Kronrod result, with a bound that covers the difference with
  // tanh-sinh and the uncertainty of the corners. The difference
  // with tanh-sinh is used only when it is larger than the error estimate of
  // tanh-sinh (the difference of its last two levels): otherwise the
  // difference can come from the error of tanh-sinh.
  let widened = Math.max(gk.error, tailSpread);
  const difference = Math.abs(t.estimate - gk.estimate);
  if (t.usable && t.error < difference) widened = Math.max(widened, difference);
  return unresolvedCorner({
    estimate: gk.estimate,
    error: widened,
    converged: false,
  });
}
