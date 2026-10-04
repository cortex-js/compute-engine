/**
 * Adaptive Gauss–Kronrod quadrature for definite integrals.
 *
 * The core rule is the 15-point Gauss–Kronrod rule (GK15) with the embedded
 * 7-point Gauss rule providing the local error estimate. Panels are subdivided
 * largest-error-first until the total error meets the requested tolerance or the
 * interval budget is exhausted.
 *
 * Deterministic and near machine-precision on smooth integrands. Infinite
 * bounds are mapped to a finite interval by smooth variable transforms whose
 * endpoint singularities fall outside the (interior) GK nodes.
 *
 * This module stays in the numerics layer: no imports from `boxed-expression`
 * or the engine core (zero-cycle budget).
 */

import {
  checkDeadline,
  getAmbientDeadline,
  withAmbientDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import {
  resolveSingularEndpoints,
  type GaussKronrodOutcome,
} from './endpoint-quadrature.js';

// GK15 abscissae on [-1, 1], positive half only (symmetric about 0).
// XGK[1], XGK[3], XGK[5] are the non-central abscissae of the 7-point Gauss
// rule; XGK[0], XGK[2], XGK[4], XGK[6] are the abscissae optimally added by
// the Kronrod extension; XGK[7] = 0 is the shared central node.
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691,
  0.7415311855993945, 0.5860872354676911, 0.4058451513773972,
  0.2077849550078985, 0.0,
];

// Weights of the 15-point Kronrod rule (paired index-for-index with XGK).
const WGK = [
  0.0229353220105292, 0.0630920926299786, 0.1047900103222502,
  0.1406532597155259, 0.1690047266392679, 0.1903505780647854,
  0.2044329400752989, 0.2094821410847278,
];

// Weights of the 7-point Gauss rule. WG[0..2] pair with the odd-indexed
// Kronrod nodes XGK[1], XGK[3], XGK[5]; WG[3] is the central weight (node 0).
const WG = [
  0.1294849661688697, 0.2797053914892767, 0.3818300505051189,
  0.4179591836734694,
];

interface Panel {
  a: number;
  b: number;
  value: number;
  error: number;
  /** The number of bisections that produced this panel from a starting
   * panel: 0 for a starting panel, and one more than the parent for a child.
   * Set by the adaptive loop, not by `gk15`. */
  depth?: number;
}

/**
 * Apply the GK15 rule to a single finite panel `[a, b]`.
 * Returns the 15-point estimate and a QUADPACK-style error estimate.
 */
export function gk15(f: (x: number) => number, a: number, b: number): Panel {
  const center = 0.5 * (a + b);
  const halfLength = 0.5 * (b - a);
  const absHalfLength = Math.abs(halfLength);

  const fc = f(center);
  let resg = WG[3] * fc; // 7-point Gauss accumulator
  let resk = WGK[7] * fc; // 15-point Kronrod accumulator

  // Function values at the ± node pairs, kept for the resasc refinement.
  const fv1: number[] = new Array(7);
  const fv2: number[] = new Array(7);

  // Non-central Gauss nodes: XGK[1], XGK[3], XGK[5].
  for (let j = 0; j < 3; j++) {
    const k = 2 * j + 1;
    const absc = halfLength * XGK[k];
    const f1 = f(center - absc);
    const f2 = f(center + absc);
    fv1[k] = f1;
    fv2[k] = f2;
    const fsum = f1 + f2;
    resg += WG[j] * fsum;
    resk += WGK[k] * fsum;
  }

  // Kronrod-only nodes: XGK[0], XGK[2], XGK[4], XGK[6].
  for (let j = 0; j < 4; j++) {
    const k = 2 * j;
    const absc = halfLength * XGK[k];
    const f1 = f(center - absc);
    const f2 = f(center + absc);
    fv1[k] = f1;
    fv2[k] = f2;
    resk += WGK[k] * (f1 + f2);
  }

  const value = resk * halfLength;

  // Error estimate (QUADPACK dqk15): scale the Gauss/Kronrod difference by the
  // local mean-deviation `resasc` so a smooth panel reports a tight bound.
  const reskh = resk * 0.5;
  let resasc = WGK[7] * Math.abs(fc - reskh);
  for (let k = 0; k < 7; k++)
    resasc += WGK[k] * (Math.abs(fv1[k] - reskh) + Math.abs(fv2[k] - reskh));
  resasc *= absHalfLength;

  let error = Math.abs((resk - resg) * halfLength);
  if (resasc !== 0 && error !== 0)
    error = resasc * Math.min(1, Math.pow((200 * error) / resasc, 1.5));

  return { a, b, value, error };
}

/** Selection key: a non-finite panel error is treated as the worst offender. */
function errorKey(e: number): number {
  return Number.isFinite(e) ? e : Number.POSITIVE_INFINITY;
}

/** A panel whose value or error is non-finite (e.g. the integrand hit a
 * removable singularity at a node). It contributes 0 to the running totals but
 * still blocks convergence until it is subdivided away. */
function panelIsBad(p: Panel): boolean {
  return !Number.isFinite(p.value) || !Number.isFinite(p.error);
}

/**
 * Number of equal panels the adaptive loop starts from, instead of the single
 * panel `[a, b]`.
 *
 * A single starting panel makes convergence a function of what 15 nodes happen
 * to see, and the adaptive loop can never recover from a first panel that reads
 * as zero: the GK/Gauss difference is then also ~0, so the error estimate meets
 * `atol` and the integral "converges" on the first evaluation. The witness is a
 * peak far narrower than the interval whose weight vanishes at the center node
 * — `∫₋₅₀⁵⁰ x²·φ(x) dx` (φ the standard normal density) samples `0` at the
 * center and `~1e-22` at every other node, and returns `3e-21 ± 5e-21` for a
 * true value of `1`. The bare `∫φ` over the same interval converges correctly,
 * because `φ(0)` is sampled.
 *
 * Starting from a fixed subdivision raises the sampling floor so the peak is
 * seen. This is a mitigation, not a guarantee — a peak narrower than `(b−a)/N`
 * can still be missed, and the error estimate remains unable to report it.
 *
 * `N = 16` was picked by measuring relative error and evaluation count over a
 * battery (Gaussian moments 0/1/2/4/6 over `[-50, 50]`, the comb `φ(x)³⁵⁰`,
 * `sin`, `√x`, `1/(1+x²)`, `e^(−x²)`, and a semi-infinite χ² tail):
 *
 * | N | moments 1–6      | `∫φ³⁵⁰` rel. err | total evaluations |
 * | - | ---------------- | ---------------- | ----------------- |
 * | 1 | all 100% wrong   | 2250%            | 1575              |
 * | 2 | exact            | 25%              | 3360              |
 * | 8 | exact            | 2.7%             | 3450              |
 * | 16| exact            | 0.14%            | 4410              |
 * | 32| exact            | 0.001%           | 6390              |
 *
 * Two panels already fix the moment family; the comb is what buys the rest.
 * The aggregate cost is ~2.8× the single-panel budget, but it is not uniform:
 * more starting panels often SAVE refinements later (`e^(−x²)` over `[-5, 5]`
 * costs 225 evaluations at N=1 and 240 at N=16). The real cost lands on
 * integrals that used to converge on the first panel — `∫₀¹ sin x` goes from 15
 * to 240 evaluations, i.e. a compiled integral called per plotted sample goes
 * from ~40 µs to ~130 µs. That is the trade: a 3× slower cheap integral in
 * exchange for a whole family that was silently, confidently wrong.
 *
 * NESTING: this floor MULTIPLIES across the levels of an iterated integral,
 * which runs one full quadrature per outer node — a smooth 2-D integral goes
 * from 225 to 57 600 evaluations (256×), and another 16× per added dimension.
 * A caller that nests must pass `initialPanels` explicitly; see
 * `initialPanelsForDimensions`.
 */
const INITIAL_PANELS = 16;

/** The minimum number of panels, all non-finite, that stops the adaptive
 * loop of `adaptiveFinite` with a `NaN` result. The loop also requires that a
 * bisection gave two non-finite children. See `mustStopAllBad` in
 * `adaptiveFinite`. */
const ALL_BAD_STOP_PANELS = 16;

/** The smallest error that `adaptiveQuadrature` reports, in units of
 * `Number.EPSILON` times the larger of `|estimate|` and the sum of the
 * magnitudes of the panel values: the rounding of a sum of double values.
 * See the floor in `adaptiveQuadrature`. */
const ROUNDOFF_ULPS = 4;

/**
 * The per-level starting-panel count for a `dimensions`-deep iterated integral,
 * chosen so the floor stays ~`INITIAL_PANELS` for the WHOLE integral instead of
 * per level. Without this an iterated integral pays `INITIAL_PANELS^dimensions`
 * — the 256× above — which would recreate the stalls this seeding exists to
 * prevent. 1-D is unchanged at 16; 2-D uses 4 per level (16 total), 3-D uses 3
 * (27 total). Never below 2, because a single starting panel is the defect.
 */
export function initialPanelsForDimensions(dimensions: number): number {
  if (!Number.isFinite(dimensions) || dimensions < 2) return INITIAL_PANELS;
  return Math.max(2, Math.round(Math.pow(INITIAL_PANELS, 1 / dimensions)));
}

/**
 * Whether a NON-converged adaptive-quadrature result should still be preferred
 * over the Monte-Carlo fallback that every caller keeps for it.
 *
 * `converged: false` means "GK15 did not reach `rtol` (1e-10) within its panel
 * budget" — it does NOT mean the result is bad. A budget-exhausted panel set
 * routinely carries a residual error bound many orders of magnitude tighter
 * than anything sampling can reach: the Monte-Carlo estimator's own noise floor
 * is its standard error, ~`1/√n` relative (≈3e-4 at `n = 1e7`, ≈1e-2 at
 * `n = 1e4`). Handing such a result to Monte Carlo replaces a MORE accurate
 * answer with a less accurate one, and pays `n` integrand evaluations to do it.
 *
 * That trade is merely wasteful when one integrand evaluation is a few
 * nanoseconds of compiled arithmetic, and catastrophic when it is itself a
 * quadrature: for an iterated integral whose outer level stalls at 1e-8, the
 * fallback runs 1e7 inner quadratures — ~8 minutes — to turn a `± 3e-8` answer
 * into a `± 1e-3` one. The sample budget is picked from whether the integrand
 * COMPILED, never from what one sample costs, so nesting multiplies it.
 *
 * So reserve the fallback for results Monte Carlo could actually improve: a
 * non-finite estimate, or an error bound no better than the sampler's floor.
 * A near-zero estimate has no relative scale to compare against and keeps the
 * historical fallback.
 *
 * @param monteCarloSamples the sample count the caller would spend on the
 * fallback — the floor is `1/√n` relative, so a smaller budget accepts a looser
 * quadrature bound.
 */
export function quadratureBeatsMonteCarlo(
  r: { estimate: number; error: number },
  monteCarloSamples: number
): boolean {
  if (!Number.isFinite(r.estimate) || !Number.isFinite(r.error)) return false;
  const scale = Math.abs(r.estimate);
  if (!(scale > 0)) return false;
  return r.error <= scale / Math.sqrt(monteCarloSamples);
}

/**
 * How many consecutive corner refinements make one comparison block in the
 * endpoint-divergence test below. 20 halvings shrink the corner interval by
 * ~1e6, so a bounded integrand's block contribution drops by the same factor —
 * a wide margin against the `SHELL_DECAY` threshold.
 */
const SHELL_BLOCK = 20;

/**
 * The largest block-over-block ratio still read as "the tail is shrinking".
 *
 * The exactly-solvable family fixes this: `x^(−p)` on `[0, 1]` sheds blocks in
 * the ratio `2^((1−p)·SHELL_BLOCK)`, so the test says "divergent" exactly for
 * `p ≥ 1 + log₂(SHELL_DECAY)/SHELL_BLOCK`. At 0.99 that boundary is `p ≈
 * 1.00072`: `1/x` (ratio exactly 1) and every stronger pole are caught, while
 * the convergent `x^(−0.999)` (ratio 0.9862) and `x^(−0.99)` (0.8706) are not.
 * The remaining gap is `x^(−p)` with `1 − 0.0007 < p < 1` — convergent, but its
 * shells are within 1.4 % of a log-divergent one's over a 1e6 range of `x`, so
 * no finite sampling separates them.
 *
 * Erring high is deliberate: a false positive rejects a legitimate integral,
 * a false negative only leaves the pre-existing Monte-Carlo fallback in place.
 * The same choice makes `1/(x·ln x)` (divergent) and `1/(x·ln²x)` (convergent)
 * BOTH read as non-divergent — their block ratios are `1 − B/n` and `1 − 2B/n`
 * at refinement depth `n`, i.e. both approach 1 from below and neither reaches
 * 0.99 inside the panel budget.
 *
 * A slowly varying factor can push the ratio of a CONVERGENT integral above
 * this threshold for a while: `x^(−0.95)·ln x` sheds blocks in the ratio
 * `2^(−1)·(m + 20)/m` at depth `m`, which is `1.28` at the first comparison and
 * falls toward `0.5` only as the depth grows. So a ratio above the threshold
 * is not enough: the ratio must also have stopped falling, or must stay above
 * the threshold when its fall is extrapolated (see `shellsDiverge`).
 */
const SHELL_DECAY = 0.99;

/**
 * The largest relative fall of the block ratio from one shell to the next
 * that is still read as "the ratio has stopped falling".
 *
 * For a pole of order 1 or more the ratio is constant (`1/x`, `1/x²`) or
 * approaches its limit geometrically (`tan x` at `π/2`, where the shells are
 * `ln 2 + O(4^(−k))`), so it is flat to much better than this. With a
 * logarithmic factor `lnᵠx` the ratio falls by about `20·q/m²` per shell at
 * depth `m`: more than this bound until `m ≈ 300·√q`, by which point the
 * ratio of an integrand `x^(−p)·lnᵠx` with `p < 0.995` is below
 * `SHELL_DECAY`.
 */
const SHELL_TREND_FLAT = 2e-4;

/**
 * The largest quotient of two successive falls of the logarithm of the block
 * ratio that is read as a GEOMETRIC fall.
 *
 * A pole with a large regular part (`1/(1 − x) − 100` at `x = 1`) has shells
 * `ln 2 − 100·w` for a shell of width `w`, so its block ratio approaches 1
 * from above, and the fall halves from one shell to the next. A logarithmic
 * factor gives falls in the quotient `(m/(m + 1))²` at depth `m`, about 0.93
 * at the first comparison and closer to 1 after. A geometric fall has the
 * limit `ln r − d·γ/(1 − γ)` for the last fall `d` and the quotient `γ`.
 */
const SHELL_GEOMETRIC_FALL = 0.6;

/**
 * The margin, in halvings, added to the depth that `shellsDiverge` assumes
 * when it extrapolates a falling ratio.
 *
 * The extrapolation assumes the fall comes from a factor `ln(1/x)ᵠ`, whose
 * contribution to the logarithm of the ratio is `c/m` at depth `m`, where `m`
 * counts halvings from a distance of 1 to the endpoint. A logarithm with a
 * different scale (`ln(x/1000)`) shifts `m`. Assuming a DEEPER `m` than the
 * true one makes the extrapolated limit LOWER than the true one, so the
 * margin only delays a diagnosis of divergence; it never makes one.
 */
const SHELL_DEPTH_MARGIN = 2 * SHELL_BLOCK;

/**
 * The smallest `|Σ shells| / Σ|shells|` a block must have for its sum to mean
 * anything. A block of shells that alternate in sign sums to a small residue of
 * near-cancelling terms; the ratio of two such residues is noise and can land
 * anywhere (`∫₀¹ sin(1/x)/x dx` — conditionally convergent — produces 7.6).
 * Divergence, by contrast, needs a tail of consistent sign, so a real one
 * scores ~1 here.
 */
const SHELL_COHERENCE = 0.5;

/**
 * The smallest number of shells in each half of a short corner series that
 * `tailUnresolved` compares. With fewer, the corner was bisected only a few
 * times, which a bounded integrand can also need.
 */
const SHORT_TAIL_BLOCK = 8;

/** The smallest width of a shell, in spacings of the doubles at the
 * endpoint, that `tailUnresolved` compares in a short corner series. */
const SHORT_TAIL_SPACINGS = 2 ** 8;

/** Signed sum and total magnitude of the block of shells from `from`. */
function blockSum(
  shells: number[],
  from: number
): [sum: number, magnitude: number] {
  let sum = 0;
  let magnitude = 0;
  for (let i = from; i < from + SHELL_BLOCK; i++) {
    sum += shells[i];
    magnitude += Math.abs(shells[i]);
  }
  return [sum, magnitude];
}

/**
 * The ratio of the block of shells that ends at shell `end` (excluded) to the
 * block before it, or `undefined` when the comparison is not available.
 */
function blockRatio(shells: number[], end: number): number | undefined {
  if (end - 2 * SHELL_BLOCK < 0) return undefined;
  const [recent, recentMag] = blockSum(shells, end - SHELL_BLOCK);
  const [prior, priorMag] = blockSum(shells, end - 2 * SHELL_BLOCK);

  // A non-finite block is not evidence either way: a deep enough shell makes
  // ANY integrand with an unbounded endpoint overflow, convergent or not
  // (`x^(−0.99)` reaches `1e320` at denormal `x`), so the comparison is
  // simply unavailable.
  if (!Number.isFinite(recent) || !Number.isFinite(prior) || prior === 0)
    return undefined;

  // Both block sums must be sums, not cancellation residues.
  if (
    Math.abs(recent) < SHELL_COHERENCE * recentMag ||
    Math.abs(prior) < SHELL_COHERENCE * priorMag
  )
    return undefined;
  return recent / prior;
}

/**
 * Whether the refinement toward an endpoint stopped before it could tell a
 * convergent tail from a divergent one: at some point the block ratio of the
 * shells was at least `SHELL_DECAY` (with a block that carries more than the
 * tolerance), and `shellsDiverge` deferred the decision because the ratio was
 * still falling.
 *
 * This happens next to a NONZERO endpoint, where the corner panel reaches the
 * spacing of the floating-point numbers after about 48 bisections, and the
 * loop stops on `roundoffStop`: the falling ratio can belong to `(1 − x)^(−0.95)·ln(1 − x)` (convergent, but
 * the part of the tail closer to 1 than the spacing holds almost half of the
 * integral) or to `1/(1 − x) − 10⁴` (divergent).
 */
function tailUnresolved(
  shells: number[],
  tolerance: number,
  width: number,
  endpoint: number
): boolean {
  // A corner that was bisected more than `3·SHELL_BLOCK` times had room for
  // `shellsDiverge` to follow the fall of the ratio (an endpoint at 0 allows
  // about 1000 bisections), so its decision stands.
  if (shells.length > 3 * SHELL_BLOCK) return false;
  // Next to a bound of large magnitude, the corner panel reaches the spacing
  // of the doubles before `2·SHELL_BLOCK` bisections (about 29 next to
  // `10⁶`), so no block ratio is available. The two halves of the shells
  // are compared instead: `1/(x − 10⁶)` on `[10⁶, 10⁶ + 1]` (divergent) has
  // shells of `ln 2` each, and the quadrature gave `22.7 ± 0.58` for it.
  // The shells narrower than `SHORT_TAIL_SPACINGS` spacings of the doubles
  // at the endpoint are left out: their nodes are rounded to the doubles
  // (the last two of the 29 shells next to `10⁶` are `0.708` and `0.5`).
  if (shells.length < 2 * SHELL_BLOCK) {
    const spacing = Math.max(
      Math.abs(endpoint) * Number.EPSILON,
      Number.MIN_VALUE
    );
    let n = shells.length;
    while (n > 0 && width / 2 ** n < SHORT_TAIL_SPACINGS * spacing) n--;
    const half = Math.floor(n / 2);
    if (half < SHORT_TAIL_BLOCK) return false;
    let recent = 0;
    let recentMagnitude = 0;
    let prior = 0;
    let priorMagnitude = 0;
    for (let i = 0; i < half; i++) {
      const p = shells[n - 2 * half + i];
      const r = shells[n - half + i];
      prior += p;
      priorMagnitude += Math.abs(p);
      recent += r;
      recentMagnitude += Math.abs(r);
    }
    if (!Number.isFinite(recent) || !Number.isFinite(prior) || prior === 0)
      return false;
    // The sums of shells that change sign are cancellation residues (see
    // `SHELL_COHERENCE`).
    if (
      Math.abs(recent) < SHELL_COHERENCE * recentMagnitude ||
      Math.abs(prior) < SHELL_COHERENCE * priorMagnitude
    )
      return false;
    return Math.abs(recent) > tolerance && recent / prior >= SHELL_DECAY;
  }
  for (let end = 2 * SHELL_BLOCK; end <= shells.length; end++) {
    if (!(Math.abs(blockSum(shells, end - SHELL_BLOCK)[0]) > tolerance))
      continue;
    const ratio = blockRatio(shells, end);
    if (ratio !== undefined && ratio >= SHELL_DECAY) return true;
  }
  return false;
}

/**
 * Whether a corner-shell sequence is the signature of a DIVERGENT endpoint.
 *
 * `shells[k]` is the integral over the piece shed by the k-th bisection of the
 * panel touching an endpoint — i.e. the dyadic shells `[x₀+d/2^(k+1), x₀+d/2^k]`
 * of the singular endpoint `x₀`, each computed by GK15 on an interval that does
 * NOT contain the singularity, so each is accurate. The integral near `x₀` is
 * exactly the sum of that series, and the question "does the integral exist"
 * is exactly "does the series converge".
 *
 * The test compares the sum of the last `SHELL_BLOCK` shells against the sum of
 * the `SHELL_BLOCK` before it. A convergent improper integral is Cauchy here:
 * `∫₀¹ x^(−1/2)` sheds `2^(−k/2)`, `∫₀¹ ln x` sheds `k·2^(−k)`, and a bounded
 * integrand sheds `2^(−k)` — every block is a small fraction of its
 * predecessor. A log-divergent one (`1/x`) sheds a CONSTANT `ln 2` per shell,
 * so consecutive blocks are equal; a power-divergent one (`1/x²`) sheds a
 * growing amount. Hence "the last 20 halvings contributed as much as the 20
 * before them" separates the two classes STRUCTURALLY — no threshold on the
 * estimate or on the reported error is involved, which matters because a
 * legitimate improper integral routinely reports a LOOSER relative error than
 * a divergent one does.
 *
 * The sums are SIGNED, so a conditionally convergent oscillatory tail (whose
 * shells do not shrink but do cancel) is not misread as divergent, and a
 * negatively divergent integral (`−1/x`) still shows a ratio of 1.
 *
 * A ratio of at least `SHELL_DECAY` is not enough when the ratio is still
 * falling: `x^(−0.95)·ln x` (convergent, `∫₀¹ = −400`) shows `1.28` at the
 * first comparison. So the ratio is also computed one and two shells
 * earlier. A ratio that has stopped falling means divergence; a falling one
 * means divergence only when its extrapolated limit is at least
 * `SHELL_DECAY` (see `SHELL_GEOMETRIC_FALL` and `SHELL_DEPTH_MARGIN`). `depth` is the number of halvings from a distance of 1 to the
 * endpoint at the first shell, plus `SHELL_DEPTH_MARGIN`; the extrapolation
 * reads the depth of a shell as its index plus `depth`.
 */
function shellsDiverge(
  shells: number[],
  tolerance: number,
  depth: number
): boolean {
  const n = shells.length;
  if (n < 2 * SHELL_BLOCK + 2) return false;
  const ratioAt = (end: number) => blockRatio(shells, end);

  // A non-shrinking tail below the requested tolerance cannot change the
  // answer; only a tail that actually carries mass is a divergence.
  if (!(Math.abs(blockSum(shells, n - SHELL_BLOCK)[0]) > tolerance))
    return false;

  // The ratio at the last three shells. Successive ratios share all but one
  // shell of each block, so the comparisons need only `2·SHELL_BLOCK + 2`
  // shells: next to a NONZERO endpoint `x₀` the corner panel can be bisected
  // only about 48 times before its width reaches the spacing of the
  // floating-point numbers near `x₀` (the loop then stops on `roundoffStop`).
  const last = ratioAt(n);
  const before = ratioAt(n - 1);
  const first = ratioAt(n - 2);
  if (last === undefined || before === undefined || first === undefined)
    return false;
  if (!(last >= SHELL_DECAY) || !(before > 0) || !(first > 0)) return false;

  // The ratio has stopped falling: a pole of order 1 or more.
  if (last >= before * (1 - SHELL_TREND_FLAT)) return true;

  // The ratio is still falling: extrapolate its limit. The integral diverges
  // only when the limit ratio is still at least `SHELL_DECAY`.
  const fall = Math.log(before) - Math.log(last);
  const previousFall = Math.log(first) - Math.log(before);
  let limit: number;
  if (previousFall > 0 && fall / previousFall <= SHELL_GEOMETRIC_FALL) {
    // A geometric fall (see `SHELL_GEOMETRIC_FALL`).
    const q = fall / previousFall;
    limit = Math.log(last) - (fall * q) / (1 - q);
  } else {
    // A logarithmic factor: model the logarithm of the ratio as `L + c/m` at
    // depth `m` (see `SHELL_DEPTH_MARGIN`), and solve for `L` from the last
    // two ratios.
    const m = n - SHELL_BLOCK + depth;
    limit = m * Math.log(last) - (m - 1) * Math.log(before);
  }
  return limit >= Math.log(SHELL_DECAY);
}

/**
 * Adaptive GK15 over a finite interval `[a, b]`.
 */
function adaptiveFinite(
  f: (x: number) => number,
  a: number,
  b: number,
  rtol: number,
  atol: number,
  maxIntervals: number,
  initialPanels: number,
  deadline: number | DeadlineFrame | undefined
): GaussKronrodOutcome {
  const panels: Panel[] = [];

  // Incremental accumulators. A non-finite panel contribution must NOT enter
  // the running totals: subtracting a stale `NaN`/`±∞` parent when it is later
  // subdivided into finite children would leave the totals poisoned forever
  // (removable singularity at a node — see `panelIsBad`). Instead, bad panels
  // add 0 to `totalValue`/`totalError` and are tallied in `badPanels`, which
  // gates convergence until every one has been subdivided away.
  let totalValue = 0;
  let totalError = 0;
  // The sum of the magnitudes of the panel values, for the absolute
  // tolerance (see `tolerance` below).
  let totalMagnitude = 0;
  let badPanels = 0;
  let roundoffStop = false;
  let divergent = false;

  // Fold a panel into the running totals, skipping non-finite contributions.
  const addPanel = (p: Panel) => {
    if (Number.isFinite(p.value)) {
      totalValue += p.value;
      totalMagnitude += Math.abs(p.value);
    }
    if (Number.isFinite(p.error)) totalError += p.error;
    if (panelIsBad(p)) badPanels += 1;
  };
  const removePanel = (p: Panel) => {
    if (Number.isFinite(p.value)) {
      totalValue -= p.value;
      totalMagnitude -= Math.abs(p.value);
    }
    if (Number.isFinite(p.error)) totalError -= p.error;
    if (panelIsBad(p)) badPanels -= 1;
  };

  // Start from `initialPanels` equal panels rather than the single `[a, b]`.
  // Both counts are floored: a fractional `maxIntervals` would otherwise make
  // the loop run `ceil(n)` times while the `i === n - 1` endpoint clamp never
  // fires, so the last panel would extend PAST `b` and the routine would
  // integrate the wrong interval. Degenerate splits (an interval so narrow the
  // cut points collapse under float roundoff) fall back to the single panel.
  const n = Math.max(
    1,
    Math.min(Math.floor(initialPanels), Math.floor(maxIntervals))
  );
  for (let i = 0; i < n; i++) {
    // Deadline check per panel: a panel is at least 15 integrand
    // evaluations, and for an ITERATED integral each evaluation is itself a
    // full inner quadrature, so without this check a nested oscillatory
    // integral under a 1 s `withTimeLimit` ran for minutes. An expired
    // deadline throws the timeout: the deadline belongs to the caller, and a
    // partial sum of panels is not the value of the integral
    // (`docs/TIMEOUT-MODEL.md` §2).
    checkDeadline(deadline);
    const lo = i === 0 ? a : a + ((b - a) * i) / n;
    const hi = i === n - 1 ? b : a + ((b - a) * (i + 1)) / n;
    if (!(lo < hi)) {
      panels.length = 0;
      break;
    }
    panels.push(gk15(f, lo, hi));
  }
  if (panels.length === 0) panels.push(gk15(f, a, b));
  panels.forEach(addPanel);

  // Endpoint-divergence bookkeeping: follow the panel that touches each end of
  // the interval. Bisecting it sheds one dyadic shell (the child NOT touching
  // the endpoint) and leaves a new, half-as-wide corner panel — so the adaptive
  // loop already produces the shell series `shellsDiverge` needs, for free and
  // in order. Only the corner chain is tracked: a divergence can only sit at an
  // endpoint, since an interior blow-up would be shed by a bisection on both
  // sides and, at worst, leaves an unsubdividable panel (`roundoffStop`).
  let cornerLo = panels[0];
  let cornerHi = panels[panels.length - 1];
  const shellsLo: number[] = [];
  const shellsHi: number[] = [];
  const shellErrorsLo: number[] = [];
  const shellErrorsHi: number[] = [];
  // The depth of the first shell of each corner, for `shellsDiverge`: the
  // number of halvings from a distance of 1 to the endpoint (0 for a corner
  // panel wider than 1), plus a margin.
  const depthOf = (p: Panel) =>
    Math.max(0, Math.log2(1 / (p.b - p.a))) + SHELL_DEPTH_MARGIN;
  const depthLo = depthOf(cornerLo);
  const depthHi = depthOf(cornerHi);
  const widthLo = cornerLo.b - cornerLo.a;
  const widthHi = cornerHi.b - cornerHi.a;
  const regionLo = cornerLo.b;
  const regionHi = cornerHi.a;

  // The absolute tolerance `atol` is scaled down for an integrand whose
  // values are small: `rtol` times the sum of the magnitudes of the panel
  // values when that is smaller. With a fixed `atol = 1e-12`, the integral
  // of `x^(−0.999)·10⁻³⁰⁰` on `[0, 1]` (`10⁻²⁹⁷`) was "converged" at
  // `9.76e-300 ± 8.1e-300`. The scale is the sum of the magnitudes, not the
  // magnitude of the sum: an integral of `0` (`sin x` over a period) keeps
  // the absolute tolerance.
  const tolerance = () =>
    Math.max(
      Math.min(atol, rtol * Math.max(totalMagnitude, 0)),
      rtol * Math.abs(totalValue)
    );

  // True when no panel is finite.
  const allPanelsBad = () => badPanels === panels.length;
  // True when a bisection gave two bad children. A non-finite value at one
  // point (a removable singularity such as `(x²-1)/(x²-1)` at x = ±1) makes
  // at most one panel bad, because a point is a node of at most one panel.
  // When a bad panel is bisected, a point at its center goes to the shared
  // boundary of the two children, which is not a node of either child. A
  // point at another node of the parent is, in general, not a node of a
  // child. So two bad children show non-finite values at new points, not
  // only the isolated point that made the parent bad.
  let refinementFailed = false;
  // True when the loop must stop with a `NaN` result: no panel is finite,
  // there are at least `ALL_BAD_STOP_PANELS` panels, and a bisection gave
  // two bad children. Without this stop, all errors are infinite and the
  // loop would keep halving panels until they are too narrow to split (more
  // than 30,000 evaluations).
  //
  // "No panel is finite" alone is not enough evidence: k isolated points can
  // make k panels bad. For example, on [0, 16] with the 16 default starting
  // panels, `u/u` with `u = x - floor(x) - 0.5` is NaN at the center of each
  // starting panel and 1 everywhere else. The failed bisection is the
  // evidence that such points do not give. When all panels are bad, the loop
  // bisects a panel with the smallest depth first (see the selection below),
  // so the first bisection moves the point at the center of a starting panel
  // to a boundary, and that panel becomes finite. The panel count increases
  // by one at each bisection, so a loop that starts with fewer than
  // `ALL_BAD_STOP_PANELS` panels bisects up to this count before it stops.
  const mustStopAllBad = () =>
    refinementFailed && panels.length >= ALL_BAD_STOP_PANELS && allPanelsBad();

  while (panels.length < maxIntervals) {
    if (badPanels === 0 && totalError <= tolerance()) break;
    if (mustStopAllBad()) break;
    // Deadline check per bisection, as in the initial-panel loop above. Each
    // iteration costs two GK15 evaluations (30 integrand calls), so the
    // overshoot past the deadline is bounded by a single bisection.
    checkDeadline(deadline);

    // Pick the panel with the largest (or non-finite) error. When all panels
    // are bad, all errors are infinite: pick the first panel with the
    // smallest depth. Otherwise the loop bisects the same starting panel
    // again and again (after a bisection, the left child takes the index of
    // its parent), and never bisects the other starting panels.
    let worst = 0;
    if (allPanelsBad()) {
      for (let i = 1; i < panels.length; i++)
        if ((panels[i].depth ?? 0) < (panels[worst].depth ?? 0)) worst = i;
    } else {
      for (let i = 1; i < panels.length; i++)
        if (errorKey(panels[i].error) > errorKey(panels[worst].error))
          worst = i;
    }

    const iv = panels[worst];
    const mid = 0.5 * (iv.a + iv.b);
    // Panel too small to subdivide further (float roundoff): no more progress
    // possible on the worst offender.
    if (mid <= iv.a || mid >= iv.b) {
      roundoffStop = true;
      break;
    }

    const left = gk15(f, iv.a, mid);
    const right = gk15(f, mid, iv.b);
    left.depth = right.depth = (iv.depth ?? 0) + 1;
    if (panelIsBad(left) && panelIsBad(right)) refinementFailed = true;

    removePanel(iv);
    addPanel(left);
    addPanel(right);

    panels[worst] = left;
    panels.push(right);

    if (iv === cornerLo) {
      cornerLo = left;
      shellsLo.push(right.value);
      shellErrorsLo.push(right.error);
    }
    if (iv === cornerHi) {
      cornerHi = right;
      shellsHi.push(left.value);
      shellErrorsHi.push(left.error);
    }
    // Stop as soon as the corner series is diagnosed: continuing only spends
    // the rest of the panel budget bisecting toward a singularity, which is
    // both the whole cost of a divergent integral and — once the shells reach
    // denormal arguments — the point where the shed values overflow and the
    // diagnosis is no longer available.
    const tol = tolerance();
    if (
      shellsDiverge(shellsLo, tol, depthLo) ||
      shellsDiverge(shellsHi, tol, depthHi)
    ) {
      divergent = true;
      break;
    }
  }

  // The refinement stopped on the floating-point spacing while the tail at an
  // endpoint was not shown to shrink (see `tailUnresolved`). The estimate is
  // then the sum of a truncated tail that may be far from the value, or the
  // integral may diverge. `adaptiveQuadrature` reports it as divergent, so
  // that no finite value is given for it, unless the extrapolation of the
  // shells finds the value of the tail (`resolveSingularEndpoints`).
  const unresolved =
    roundoffStop &&
    !divergent &&
    (tailUnresolved(shellsLo, tolerance(), widthLo, a) ||
      tailUnresolved(shellsHi, tolerance(), widthHi, b));
  // The value and the error of the panels inside each starting corner
  // panel, which the extrapolation of its shells replaces. Non-finite panels
  // are left out, as in the totals.
  let insideValueLo = 0;
  let insideErrorLo = 0;
  let insideValueHi = 0;
  let insideErrorHi = 0;
  for (const p of panels) {
    if (panelIsBad(p)) continue;
    if (p.b <= regionLo) {
      insideValueLo += p.value;
      insideErrorLo += p.error;
    } else if (p.a >= regionHi) {
      insideValueHi += p.value;
      insideErrorHi += p.error;
    }
  }
  const corners = {
    lo: {
      shells: shellsLo,
      shellErrors: shellErrorsLo,
      value: insideValueLo,
      error: insideErrorLo,
      width: widthLo,
      endpoint: a,
    },
    hi: {
      shells: shellsHi,
      shellErrors: shellErrorsHi,
      value: insideValueHi,
      error: insideErrorHi,
      width: widthHi,
      endpoint: b,
    },
  };

  // No panel has a finite value, so the totals (which skip bad panels) hold
  // 0, and 0 is not the value of the integral. Report NaN, the same result
  // as a NaN bound. This is also true when the loop stopped for another
  // reason before a bisection failed: the panel budget (for example
  // `maxIntervals` not larger than the number of starting panels, so the
  // loop does not bisect). Then an integrand with removable
  // singularities at the node of each starting panel also gives NaN,
  // because no finite value is known.
  if (allPanelsBad())
    return {
      estimate: NaN,
      error: NaN,
      converged: false,
      divergent: false,
      unresolved: false,
      magnitude: 0,
      ...corners,
    };

  const converged =
    !divergent &&
    !unresolved &&
    !roundoffStop &&
    badPanels === 0 &&
    Number.isFinite(totalValue) &&
    Number.isFinite(totalError) &&
    totalError <= tolerance();

  // A bad panel has a non-finite value, which the totals skip. When a bad
  // panel that does not touch an endpoint is left, `totalError` is not a
  // bound of the error, and the error is `+∞`: a caller must not keep the
  // estimate as accurate (`quadratureBeatsMonteCarlo`). The outer integral
  // of `∫₀^10 ∫₃^4 (y − x)⁻² dx dy`, whose inner integral has no value for
  // `y` in `[3, 4]`, gave `2.703 ± 2.2e-9` from the panels outside
  // `[3, 4]`. A bad panel next to an endpoint (at a distance of at most
  // `2⁻³⁰·(b − a)`) is not counted: there, an integrable singularity can
  // overflow at the nodes of the narrowest shells (`1/(x·ln x·ln²(−ln x))`
  // is `±∞` at a denormal `x`), and the tail is examined by the endpoint
  // tests (`shellsDiverge`, `tailUnresolved`) and by the extrapolation of
  // the shells (`resolveSingularEndpoints`).
  const corner = (b - a) * 2 ** -30;
  const valueMissing =
    badPanels > 0 &&
    panels.some((p) => panelIsBad(p) && p.a - a > corner && b - p.b > corner);
  return {
    estimate: totalValue,
    error: valueMissing ? Number.POSITIVE_INFINITY : totalError,
    converged,
    divergent,
    unresolved,
    magnitude: Math.max(totalMagnitude, 0),
    ...corners,
  };
}

/**
 * The number of `adaptiveQuadrature` calls on the call stack. The quadrature
 * is synchronous, so module state is safe here, as for `activeIntegrals` in
 * `compilation/javascript-target.ts`.
 */
let activeQuadratures = 0;

/**
 * Whether an `adaptiveQuadrature` call is running: an integral computed now
 * is the integrand of an enclosing integral, and is computed once at each
 * node of the enclosing quadrature. The compiled `_SYS.integrate` uses it to
 * skip its Monte-Carlo fallback (1e7 samples at each node) when the
 * enclosing integral is computed by the interpreter, which its own count of
 * activations does not see.
 */
export function insideQuadrature(): boolean {
  return activeQuadratures > 0;
}

/**
 * Numerically approximate the definite integral of `f` from `a` to `b` using
 * adaptive Gauss–Kronrod (GK15) quadrature.
 *
 * @param options.rtol Relative tolerance target (default 1e-10).
 * @param options.atol Absolute tolerance target (default 1e-12).
 * @param options.maxIntervals Panel budget before giving up (default 1500).
 * @param options.initialPanels Equal panels to start the adaptive loop from
 * (default `INITIAL_PANELS`). An ITERATED integral must reduce this — the floor
 * multiplies across levels; see `initialPanelsForDimensions`.
 *
 * Returns the `estimate`, an error `error` bound, whether the requested
 * tolerance was met (`converged`), and whether the integral was found to
 * DIVERGE (`divergent` — the shells shed by refinement toward an endpoint stop
 * shrinking, see `shellsDiverge`, or the refinement reached the floating-point
 * spacing at an endpoint before the shells were shown to shrink, see
 * `tailUnresolved`). A `divergent` result has no finite value:
 * `estimate` is whatever the panel budget happened to accumulate before it ran
 * out, and callers must not report it (nor hand the integrand to a sampler,
 * which would launder the divergence into a plausible-looking number).
 * Semi-infinite bounds are handled by a
 * variable transform; the doubly-infinite case `(-∞, ∞)` is split at 0 into two
 * semi-infinite integrals (so a divergent half is detected instead of masked by
 * symmetric cancellation of an odd integrand), each half receiving half the
 * panel budget and the combined result re-checked against the tolerance;
 * `a === b` is 0; `a > b` negates the swapped result; a `NaN` bound yields a
 * non-converged `NaN` estimate. An integrand that is non-finite at every node
 * of every panel also yields a non-converged `NaN` estimate (and `NaN` error):
 * the loop stops when no panel is finite, there are at least 16 panels
 * (fewer starting panels are bisected up to 16 first), and a bisection gave
 * two non-finite children. An integrand that is non-finite only at some
 * isolated nodes (removable singularities, such as `(x²-1)/(x²-1)` on
 * [-2, 2], or one point at the center of each of the 16 starting panels) is
 * still integrated, even when every starting panel is bad: the bad panels
 * are bisected until their nodes miss the singular points. If the panel
 * budget stops the loop before any panel is finite, the estimate is also
 * `NaN`.
 *
 * An expired deadline throws a timeout `CancellationError`; there is no
 * partial result.
 */
export function adaptiveQuadrature(
  f: (x: number) => number,
  a: number,
  b: number,
  options?: {
    rtol?: number;
    atol?: number;
    maxIntervals?: number;
    initialPanels?: number;
    /** The deadline, as an absolute timestamp (ms) or as the engine's
     * deadline frame (`engine._deadlineFrame`, which gives the thrown error
     * the label of the span). When it expires, the loop throws a timeout
     * `CancellationError`. When omitted, the AMBIENT deadline is inherited:
     * this is how a nested integral reached through compiled code
     * (`_SYS.integrate` has no engine access) stays bounded by the outer
     * `withTimeLimit` span. */
    deadline?: number | DeadlineFrame;
    /** When `true`, a result next to a singular endpoint is corrected by
     * the extrapolation of the shells of the corner panel and checked
     * against the tanh-sinh rule (`resolveSingularEndpoints`,
     * `endpoint-quadrature.ts`). The tanh-sinh rule uses at most
     * `2·maxIntervals` evaluations. The default, `false`, keeps the
     * Gauss–Kronrod result. */
    singularEndpoints?: boolean;
  }
): {
  estimate: number;
  error: number;
  converged: boolean;
  divergent: boolean;
  /** Set only with `singularEndpoints`: see `QuadratureResult` in
   * `endpoint-quadrature.ts`. */
  extrapolated?: boolean;
  /** Set only with `singularEndpoints`: see `QuadratureResult` in
   * `endpoint-quadrature.ts`. */
  oscillates?: true;
  /** Set only with `singularEndpoints`: see `QuadratureResult` in
   * `endpoint-quadrature.ts`. */
  singularCorner?: true;
} {
  const rtol = options?.rtol ?? 1e-10;
  const atol = options?.atol ?? 1e-12;
  const maxIntervals = options?.maxIntervals ?? 1500;
  const initialPanels = options?.initialPanels ?? INITIAL_PANELS;
  // Inherit the ambient deadline BEFORE publishing (below): when this call
  // carries no explicit deadline but runs inside a deadline-bounded numeric
  // routine, the inherited value is what gets re-published — never
  // `undefined`, which would CLEAR the outer deadline for the duration
  // (mirrors `monteCarloEstimate`).
  const deadline = options?.deadline ?? getAmbientDeadline();

  if (Number.isNaN(a) || Number.isNaN(b))
    return { estimate: NaN, error: NaN, converged: false, divergent: false };

  if (a === b)
    return { estimate: 0, error: 0, converged: true, divergent: false };

  if (a > b) {
    const r = adaptiveQuadrature(f, b, a, { ...options, deadline });
    return { ...r, estimate: -r.estimate };
  }

  // Here a < b. A non-finite bound is -∞ (for `a`) or +∞ (for `b`).
  const aInf = !Number.isFinite(a);
  const bInf = !Number.isFinite(b);

  let g: (t: number) => number;
  let lo: number;
  let hi: number;

  if (aInf && bInf) {
    // (-∞, ∞): split at 0 into two semi-infinite integrals. A single symmetric
    // transform makes an odd integrand cancel to exactly 0 on the first panel
    // (GK nodes are symmetric about the center), masking divergence; splitting
    // lets each half's asymmetric transform detect a divergent tail. The two
    // recursive calls are each semi-infinite, so they take non-recursive
    // branches below. Each half gets half the panel budget so the caller's
    // `maxIntervals` cap holds for the whole integral.
    const halfOptions = {
      rtol,
      atol,
      maxIntervals: Math.ceil(maxIntervals / 2),
      initialPanels,
      deadline,
      singularEndpoints: options?.singularEndpoints,
    };
    const left = adaptiveQuadrature(f, a, 0, halfOptions);
    const right = adaptiveQuadrature(f, 0, b, halfOptions);
    const estimate = left.estimate + right.estimate;
    const error = left.error + right.error;
    // Each half converged against a tolerance scaled to its OWN magnitude, so
    // re-check the summed error on the combined result. The relative scale is
    // the halves' combined magnitude, not `|estimate|`: for a cancelling
    // integrand (halves ±M) the achievable absolute accuracy is `rtol·M` —
    // demanding `rtol·|estimate|` (→ `atol` at exact cancellation) would
    // reject correct results like ∫x·e^(−x²) = 0. The reported `error` is the
    // true bound either way. The finiteness test also forces
    // `converged: false` when the sum is NaN (e.g. ∞ + (−∞)); `estimate` is
    // only meaningful when `converged` is true.
    const scale = Math.abs(left.estimate) + Math.abs(right.estimate);
    const converged =
      left.converged &&
      right.converged &&
      Number.isFinite(estimate) &&
      error <= Math.max(atol, rtol * scale);
    // Either half diverging makes the whole integral divergent: the two halves
    // are integrals of the same sign structure over disjoint ranges, so a
    // divergent one cannot be cancelled by the other (∞ − ∞ is not a value).
    const divergent = left.divergent || right.divergent;
    // A half that oscillates without a value makes the whole integral have no
    // value, with no sign.
    if (left.oscillates === true || right.oscillates === true)
      return { estimate, error, converged, divergent, oscillates: true };
    // The whole integral is extrapolated when each half converged or was
    // extrapolated, and it did not converge.
    const extrapolated =
      !converged &&
      (left.converged || left.extrapolated === true) &&
      (right.converged || right.extrapolated === true);
    if (extrapolated)
      return { estimate, error, converged, divergent, extrapolated };
    // A half with a singular corner that was not resolved makes the whole
    // result one (see `QuadratureResult`, `endpoint-quadrature.ts`).
    if (
      !converged &&
      !divergent &&
      (left.singularCorner === true || right.singularCorner === true)
    )
      return { estimate, error, converged, divergent, singularCorner: true };
    return { estimate, error, converged, divergent };
  } else if (bInf) {
    // [a, ∞): x = a + t/(1 - t), t ∈ [0, 1). dx = 1/(1 - t)² dt.
    g = (t) => {
      const om = 1 - t;
      return f(a + t / om) / (om * om);
    };
    lo = 0;
    hi = 1;
  } else if (aInf) {
    // (-∞, b]: x = b - t/(1 - t), t ∈ [0, 1). dx = 1/(1 - t)² dt.
    g = (t) => {
      const om = 1 - t;
      return f(b - t / om) / (om * om);
    };
    lo = 0;
    hi = 1;
  } else {
    g = f;
    lo = a;
    hi = b;
  }

  // Publish the deadline as the ambient one for the duration: the integrand
  // may itself be (or reach, through compiled code) another quadrature or
  // sampler, and the nested call inherits this deadline instead of running
  // unbounded (the item-183 nested-integral hang).
  // The count of running quadratures tells a nested one that it is nested
  // (`insideQuadrature`).
  activeQuadratures++;
  try {
    return withAmbientDeadline(deadline, () => {
      const r = adaptiveFinite(
        g,
        lo,
        hi,
        rtol,
        atol,
        maxIntervals,
        initialPanels,
        deadline
      );
      // The integrand is evaluated in doubles and the panel values are
      // summed in doubles, so the estimate has a rounding error of some
      // units in the last place of the sum of the magnitudes of the panel
      // values. The GK15 error of a smooth panel can be much smaller than
      // that, and the reported error is never less than this rounding.
      // Without the floor, `∫₁² ln³t/(t − 1) dt` gave
      // `0.1425141979357109345283 ± 0.0000000000000000000031`: the error
      // was 3.1e-21, the true error 1.9e-17. The floor is applied to the
      // reported error only: the convergence test of the adaptive loop does
      // not change. But a result is not reported as `converged` when the
      // raised error is larger than `rtol·max(|estimate|, magnitude)`, the
      // tolerance at the scale of the floor. (The absolute tolerance of the
      // adaptive loop, `min(atol, rtol·magnitude)`, is never larger than
      // this.) With `rtol` smaller than `4·Number.EPSILON`, the floor can be
      // larger than the tolerance that the loop met. The scale is
      // the magnitude and not only `|estimate|`: the integral of an odd
      // integrand on a symmetric interval (`∫₋₃₀³⁰ x³ dx = 0`) has an
      // estimate near 0 and a floor at the scale of the magnitude, and with
      // `rtol·|estimate|` it was not converged, and the caller used Monte
      // Carlo (`-160 ± 190`).
      const roundoff =
        ROUNDOFF_ULPS *
        Number.EPSILON *
        Math.max(Math.abs(r.estimate), r.magnitude);
      const floored = <
        T extends { estimate: number; error: number; converged: boolean },
      >(
        q: T
      ): T =>
        q.error < roundoff
          ? {
              ...q,
              error: roundoff,
              converged:
                q.converged &&
                roundoff <= rtol * Math.max(Math.abs(q.estimate), r.magnitude),
            }
          : q;
      if (options?.singularEndpoints === true)
        return floored(
          resolveSingularEndpoints(g, lo, hi, r, {
            rtol,
            atol,
            maxEvaluations: 2 * maxIntervals,
            deadline,
          })
        );
      return floored({
        estimate: r.estimate,
        error: r.error,
        converged: r.converged,
        divergent: r.divergent || r.unresolved,
      });
    });
  } finally {
    activeQuadratures--;
  }
}
