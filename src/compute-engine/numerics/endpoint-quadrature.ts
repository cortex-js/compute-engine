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
   * `∫₀^0.01 dx/(x·(−ln x)·ln²(−ln x)) = 0.6548…`, where this result was
   * `0.5028 ± 0.0176`. */
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
 * For shells that change sign: the smallest ratio of the largest magnitude
 * of a shell in the last quarter of the shells to the largest magnitude in
 * the first quarter that reads as "the oscillation does not shrink", when
 * the shells change sign at least `SHELL_OSCILLATION_SIGN_CHANGES` times.
 * The terms of a convergent series tend to 0, so such shells have no limit:
 * the integral has no value (`sin(ln x)/x` at 0: the ratio is about 1;
 * `sin(ln x)/x^1.1`: it grows). The ratio is not exactly 1 for a constant
 * amplitude, because the largest magnitude in a block samples the
 * oscillation. An integral that converges but whose shells shrink more
 * slowly than this (`cos(ln x)/x^0.999` with 84 shells: ratio `0.96`) is
 * also given no value: the quadrature cannot find it.
 */
const SHELL_OSCILLATION_STEADY = 0.9;

/** See `SHELL_OSCILLATION_STEADY`. */
const SHELL_OSCILLATION_SIGN_CHANGES = 3;

/**
 * Whether the shells `shells` (counted from a distance `2^(−β)` to the
 * endpoint) decrease as the shells of a convergent series do, so that the
 * limit of their partial sums can be found by extrapolation (`'converges'`),
 * or oscillate without shrinking, so that the integral has no value
 * (`'oscillates'`), or neither (`'unknown'`).
 *
 * - When the last half of the shells changes sign (or vanishes): the shells
 *   converge when the largest magnitude in the last quarter is at most
 *   `SHELL_ENVELOPE_DECAY` times the largest magnitude in the first quarter,
 *   and oscillate when it is at least `SHELL_OSCILLATION_STEADY` times
 *   (see there).
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
    let signChanges = 0;
    for (let k = 1; k < n; k++)
      if (shells[k] * shells[k - 1] < 0) signChanges++;
    if (
      signChanges >= SHELL_OSCILLATION_SIGN_CHANGES &&
      last >= SHELL_OSCILLATION_STEADY * first
    )
      return 'oscillates';
    return 'unknown';
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
function wynnEpsilon(s: number[]): number | undefined {
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
function levinU(
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
 * too few accurate shells. `oscillates` is set when the shells oscillate
 * without shrinking (see `shellTrend`): the integral has no value.
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

  // Shells that do not decrease as a convergent series does have no limit to
  // find (see `shellTrend`).
  const trend = shellTrend(shells, beta);
  if (trend !== 'converges') {
    const recent = sums.slice(Math.floor(n / 2));
    const spread = Math.max(...recent) - Math.min(...recent);
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
  if (best === undefined) return { ok: false, spread };

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
    } else {
      failed = true;
      tailSpread = Math.max(tailSpread, x.spread);
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
