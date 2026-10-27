/**
 * Adaptive Gauss–Kronrod quadrature for definite integrals.
 *
 * The core rule is the 15-point Gauss–Kronrod rule (GK15). The local error
 * estimate is the larger of the QUADPACK estimate, from the embedded 7-point
 * Gauss rule, and the estimate of 8 null rules of the same 15 samples
 * (`nullRuleError`). Panels are subdivided
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
  nextDouble,
  OFFSET_SINGULARITY_SPACINGS,
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

/**
 * The null rules of the 15 GK15 nodes, for the error estimate of a panel
 * (`nullRuleError`). A null rule of degree `d` is a set of 15 weights, one
 * per node, whose sum applied to any polynomial of degree at most `d` is 0.
 * Applied to the integrand, it measures the part of the integrand that the
 * polynomials of degree `d` cannot represent on the panel.
 *
 * The rules are the 8 vectors of highest degree of an orthonormal basis of
 * `R^15` (Euclidean inner product over the nodes) made by the Gram–Schmidt
 * process from the Legendre polynomials `P_0, …, P_14` sampled at the nodes,
 * scaled to the Euclidean norm of the Kronrod weights. The vector made from
 * `P_k` is orthogonal to the samples of all the polynomials of degree below
 * `k`, so it is a null rule of degree `k − 1`. The rules are mutually
 * orthogonal, as the error estimate requires. `NULL_RULES[i]` has degree
 * `13 − i`, and its weights are in the increasing order of the nodes:
 * `−XGK[0], …, −XGK[6], 0, XGK[6], …, XGK[0]`.
 *
 * Source: J. Berntsen and T. O. Espelid, "Error estimation in automatic
 * quadrature routines", ACM Trans. Math. Software 17 (1991), 233–252.
 */
const GK15_NULL_RULES: {
  nodes: readonly number[];
  rules: readonly (readonly number[])[];
} = (() => {
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let k = 0; k < 7; k++) {
    nodes.push(-XGK[k]);
    weights.push(WGK[k]);
  }
  nodes.push(0);
  weights.push(WGK[7]);
  for (let k = 6; k >= 0; k--) {
    nodes.push(XGK[k]);
    weights.push(WGK[k]);
  }
  const legendre = (n: number, x: number): number => {
    if (n === 0) return 1;
    let p0 = 1;
    let p1 = x;
    for (let k = 2; k <= n; k++) {
      const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
      p0 = p1;
      p1 = p2;
    }
    return p1;
  };
  const norm = (v: readonly number[]) =>
    Math.sqrt(v.reduce((s, vi) => s + vi * vi, 0));
  const basis: number[][] = [];
  for (let n = 0; n < 15; n++) {
    let v = nodes.map((x) => legendre(n, x));
    // Two passes of the orthogonalization, for a basis orthogonal to the
    // rounding of the machine.
    for (let pass = 0; pass < 2; pass++)
      for (const q of basis) {
        const d = q.reduce((s, qi, i) => s + qi * v[i], 0);
        v = v.map((vi, i) => vi - d * q[i]);
      }
    const length = norm(v);
    basis.push(v.map((vi) => vi / length));
  }
  const scale = norm(weights);
  return {
    nodes,
    rules: [14, 13, 12, 11, 10, 9, 8, 7].map((k) =>
      basis[k].map((v) => v * scale)
    ),
  };
})();
const NULL_RULES = GK15_NULL_RULES.rules;

/** The GK15 nodes on `[−1, 1]` in increasing order, and the null rules of
 * `NULL_RULES` on them, for the tests. */
export const GK15_NULL_RULES_FOR_TESTS = GK15_NULL_RULES;

/**
 * An estimate of the error of the GK15 value of a panel, from the null
 * rules of its 15 samples (`NULL_RULES`), as in the Berntsen–Espelid
 * method.
 *
 * The difference of the Kronrod and the Gauss sums is one number, and it
 * can be near 0 by chance when the integrand has a kink or a jump inside the
 * panel. For example, for `1/max(0.01, √(x² + 0.758125²) − 1)` on
 * `[−0.6689453125, −0.66650390625]`, which has a kink at 0.31 of the
 * half-width from the center, the difference is `1.2e-10`, the QUADPACK
 * error is `4e-11`, and the true error is `1.6e-5`. The 8 null rules give 8
 * numbers, and they are all near 0 only when the integrand is near a
 * polynomial of degree 6 on the panel.
 *
 * The null rules are grouped in pairs of consecutive degrees, an even and an
 * odd one, `E_k = √(N_(2k)² + N_(2k+1)²)`, so that a pair does not depend on
 * the parity of the integrand. `E_0` is the pair of highest degree. On a
 * panel where the integrand is smooth and well resolved, the pairs decrease
 * fast as the degree increases: each ratio `E_k/E_(k+1)` is small, and `r`
 * is the largest of them. The estimate is:
 *
 * - `r > 1` (the pairs do not decrease: the integrand is not resolved on the
 *   panel): `NULL_RULE_SAFETY · max(E_k)`.
 * - `NULL_RULE_CRITICAL_RATIO < r ≤ 1` (the pairs decrease slowly, as for a
 *   kink): `NULL_RULE_SAFETY · r · E_0`.
 * - `r ≤ NULL_RULE_CRITICAL_RATIO` (the asymptotic regime of a smooth
 *   integrand): `NULL_RULE_SAFETY · c^(1 − α) · r^α · E_0`, with
 *   `c = NULL_RULE_CRITICAL_RATIO` and `α = NULL_RULE_DECAY_POWER`. The
 *   GK15 value is exact for polynomials of degree 22 and `E_0` measures the
 *   degree 13, so with a decrease `r` per two degrees the error is about
 *   `r^4.5·E_0`; the power `α = 3` is smaller, for safety.
 *
 * The panel error is the larger of this estimate and the QUADPACK error, so
 * it is never smaller than the QUADPACK error.
 *
 * It is an estimate, not a bound. Measured on one panel `[−1, 1]` with a
 * kink at `t`:
 *
 * - For `10x + 3 + max(0, x − t)` and `eˣ + 0.01·|x − t|` (25,000 positions
 *   with `|t| < 0.99`), it was never smaller than the true error.
 * - Nearer to an endpoint, the kink is seen by one node only (the outer
 *   node is at `0.9915`), and the estimate was up to 15 times too small. A
 *   kink between the outer node and the endpoint is seen by no node
 *   (`hiddenEdgeError` examines that gap).
 * - A smooth part that the null rules see more than the kink can hide a
 *   small kink: for `e^(5x) + 0.0316·|x − 0.51|` the panel reports
 *   `1.9e-6` for a true error of `8.3e-5`. In a sweep of `10x + 3`, `eˣ`
 *   and `cos 3x` plus a kink or a jump of size `1`, `10⁻²` or `10⁻⁴`, 121
 *   of 33,948 panels were too small, 116 of them with `cos 3x`. On the panels of the bisections, the
 *   smooth part is resolved and the kink is seen: the adaptive quadrature of
 *   this example reports `4.3e-10` for a true error of `1.7e-11`.
 *
 * On smooth integrands, the evaluation counts are the same as with the
 * QUADPACK error alone (`∫₀¹ eˣ dx`, `∫₀^π sin x dx` and `∫₋₅⁵ dx/(1 + x²)`
 * converge on the 16 starting panels).
 *
 * The estimate is `NaN` when a sample is not finite.
 */
function nullRuleError(
  samples: readonly number[],
  absHalfLength: number,
  noise: number
): number {
  const pairs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const even = NULL_RULES[2 * k];
    const odd = NULL_RULES[2 * k + 1];
    let n0 = 0;
    let n1 = 0;
    for (let i = 0; i < 15; i++) {
      n0 += even[i] * samples[i];
      n1 += odd[i] * samples[i];
    }
    pairs.push(Math.hypot(n0, n1) * absHalfLength);
  }
  if (!pairs.every((e) => Number.isFinite(e))) return NaN;
  // A pair of the size of the rounding of the samples (`noise`, see `gk15`)
  // is not information about the integrand: it is taken as 0. Without this,
  // the rounding of a polynomial integrand gave an error of some units in
  // the last place of the magnitude, and `∫₋₃₀³⁰ x³ dx = 0` did not meet the
  // absolute tolerance `1e-12`.
  for (let k = 0; k < 4; k++) if (pairs[k] <= noise) pairs[k] = 0;
  const largest = Math.max(...pairs);
  if (largest === 0) return 0;
  let r = 0;
  for (let k = 0; k < 3; k++) {
    if (pairs[k] === 0) continue;
    r =
      pairs[k + 1] === 0
        ? Number.POSITIVE_INFINITY
        : Math.max(r, pairs[k] / pairs[k + 1]);
  }
  if (r > 1) return NULL_RULE_SAFETY * largest;
  if (r > NULL_RULE_CRITICAL_RATIO) return NULL_RULE_SAFETY * r * pairs[0];
  return (
    NULL_RULE_SAFETY *
    NULL_RULE_CRITICAL_RATIO ** (1 - NULL_RULE_DECAY_POWER) *
    r ** NULL_RULE_DECAY_POWER *
    pairs[0]
  );
}

/** The size of the rounding of a null rule, in units of the rounding of the
 * samples (`gk15`): `Number.EPSILON` times the integral of the magnitude of
 * the integrand on the panel, plus the rounding of the positions of the
 * nodes. QUADPACK uses the same bound for the rounding of the GK15 value. */
const NULL_RULE_NOISE_ULPS = 50;
/** The factor of safety of `nullRuleError`. */
const NULL_RULE_SAFETY = 10;
/** The largest ratio of two consecutive pairs of null rules for which
 * `nullRuleError` takes the integrand as smooth on the panel. */
const NULL_RULE_CRITICAL_RATIO = 0.25;
/** The power of the ratio in the estimate of a smooth panel
 * (`nullRuleError`). */
const NULL_RULE_DECAY_POWER = 3;

interface Panel {
  a: number;
  b: number;
  value: number;
  error: number;
  /** The number of bisections that produced this panel from a starting
   * panel: 0 for a starting panel, and one more than the parent for a child.
   * Set by the adaptive loop, not by `gk15`. */
  depth?: number;
  /** The QUADPACK error of the panel alone, without the null-rule estimate
   * that `error` includes (`nullRuleError`), plus the same `hiddenEdgeError`
   * as `error`. Set by `gk15`. The test of the accuracy of a shell next to a
   * singular endpoint (`SHELL_RELATIVE_ERROR`, `endpoint-quadrature.ts`)
   * reads this error: it was calibrated with the QUADPACK error, and on the
   * shells of `sin(3·ln t)/t` next to 0 the null-rule estimate is 1 to 150
   * times larger. With `error`, the first shell failed the test, and the
   * oscillation of the shells was not found. With the test loosened to
   * `1e-7` instead, the inaccurate shells of `|x − 0.7|^(−3/4)` passed it,
   * and the result was `± 2.5e-7` for a true error of `9.1e-4`. */
  quadpackError?: number;
  /** The part of `error` that comes from the rounding of the nodes to the
   * doubles (`positionShift`). Set by `gk15`, added to `error` by the
   * adaptive loop (`adaptiveFinite`). Bisection does not make the
   * sum of these parts smaller: each node is still up to half a unit in the
   * last place from its exact position. */
  positionError?: number;
  /** The largest slope of the integrand between two consecutive nodes of the
   * panel, at the positions of the nodes as `gk15` computes them (0 when
   * they are all one double), times the half width of the panel. It is
   * computed as `|Δf|·(h/Δx)`, without the slope itself, which can overflow
   * when `Δx` is a few doubles (`(x − 1)·2¹⁰⁵⁰` on `[1, 1 + 129·ε]`). Set by
   * `gk15`. */
  slopeTimesHalfLength?: number;
  /** The number of samples of the integrand on this panel, of 15, that are
   * `NaN`. An infinite sample (an integrable singularity at a node) is not
   * counted. Set by `gk15`. */
  nanSamples?: number;
  /** The number of samples of the integrand on this panel, of 15, that are
   * not finite (`NaN` or infinite). Set by `gk15`. */
  nonFiniteSamples?: number;
  /** The largest magnitude of a finite sample on this panel, or `-∞` when
   * no sample is finite. Set by `gk15`. */
  largestFinite?: number;
  /** The smallest and the largest node of this panel where the sample is
   * `NaN`. Set by `gk15` when `nanSamples` is not 0. */
  nanNodes?: [first: number, last: number];
  /** True when the boundary of a `NaN` set in this panel or in a panel it
   * comes from was examined, and the values next to it were of rounding size
   * (`nanSetBorderIsLarge`). The panel and its children are then not
   * examined again. Set by the adaptive loop. */
  nanUndecided?: boolean;
  /** The sample at the center of the panel. Set by `gk15`. The center of a
   * panel is the common endpoint of its two children, so the adaptive loop
   * gives it to them as an edge sample (`edgeA`, `edgeB`). */
  centerSample?: number;
  /** The samples at the four nodes nearest to `a` and to `b`, nearest
   * first. Set by `gk15`, read by `hiddenEdgeError`. */
  nodesNearA?: [number, number, number, number];
  nodesNearB?: [number, number, number, number];
  /** The sample of the integrand AT `a` and AT `b`, when the adaptive loop
   * has it (see `hiddenEdgeError`). */
  edgeA?: number;
  edgeB?: number;
}

/**
 * The value at `x` of the parabola through the points `(xs[i], vs[i])`.
 */
function parabolaAt(
  xs: readonly [number, number, number],
  vs: readonly [number, number, number],
  x: number
): number {
  const [x0, x1, x2] = xs;
  return (
    (vs[0] * (x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) +
    (vs[1] * (x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) +
    (vs[2] * (x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1))
  );
}

/** The distances from an endpoint of a panel to the four GK15 nodes nearest
 * to it, in half-widths of the panel, nearest first. */
const EDGE_NODE_DISTANCES = [1 - XGK[0], 1 - XGK[1], 1 - XGK[2], 1 - XGK[3]];

/**
 * An error to add to the GK15 error of a panel, for a jump or a kink of the
 * integrand between an endpoint of the panel and the node nearest to it.
 *
 * No node of GK15 is at an endpoint of the panel: the nearest node is at
 * `0.0043·(b − a)` from it. When the integrand jumps inside this gap, all 15
 * samples are on one side of the jump. The Gauss and the Kronrod sums then
 * agree, the error estimate of the panel is about 0 (exactly 0 for a constant
 * piece), and the area between the jump and the endpoint is lost. A kink in
 * the gap loses the area between the two pieces in the same way. For
 * `1/max(ε, √(x² + y²) − 1)` cut to 0 at `x = −√(1 − y²)` with `ε = 0.01`,
 * the quadrature on `[−10, 10]` reported `converged` with an error of about
 * `6e-10` when its true error was `5e-6` (`y = 0.1`, a jump), `2e-5`
 * (`y = 0.640025`, a kink) and `0.2` (one `y` near `0.78`). An outer integral
 * over `y` of this inner integral had an error of `4e-4`.
 *
 * The test uses the sample AT the endpoint, when the adaptive loop has it:
 * the center of the parent panel, or a common endpoint of two starting
 * panels. The parabola through the three nodes nearest to the endpoint
 * predicts the sample at the endpoint, and the parabola through the next
 * three nodes predicts the sample at the nearest node. On a smooth piece the
 * first prediction is the better one: its distance is much shorter (its
 * error is about 20 times smaller for a smooth integrand). When the first
 * prediction misses by more than the second one, the gap may hide a jump or
 * a kink, and the area lost is at most the miss times the gap.
 *
 * The jump can also be AT the endpoint (`Floor` at an integer, `Sign` at 0,
 * a value at one point only): then no area is lost, but the sample at the
 * endpoint still misses, in each panel that ends there, after each
 * bisection. To tell the two cases apart, the integrand is sampled once
 * more, at `HIDDEN_EDGE_PROBE` times the gap from the endpoint. When this
 * sample agrees with the parabola of the nodes as well as the nearest node
 * does, the jump or the kink is between the probe and the endpoint, and the
 * bound is the miss times this much shorter distance. Otherwise the bound is
 * the miss times the gap, and the panel is bisected until the bound meets
 * the tolerance (each bisection halves the gap). A smooth integrand that
 * varies faster than the nodes can follow can also fail the test, and is
 * bisected, as it must be. A sample that is not finite (a singularity at the
 * endpoint, a removable singularity at a node) gives no test.
 */
function hiddenEdgeError(p: Panel, f: (x: number) => number): number {
  const halfWidth = 0.5 * Math.abs(p.b - p.a);
  // The distances from each endpoint to the four nodes nearest to it, in
  // half widths, at the positions of the nodes as `gk15` computes them. On a
  // panel not many units in the last place wide, the nodes are rounded to
  // the doubles, and these distances are not `EDGE_NODE_DISTANCES`: the
  // parabolas of a smooth integrand fitted at the nominal distances miss the
  // edge sample by the slope times the rounding. When rounded nodes
  // coincide, no parabola can be fitted, and the edge sample is compared
  // with the nearest node alone.
  const distancesA = [0, 1, 2, 3].map(
    (k) => (nodeAt(p.a, p.b, k) - p.a) / halfWidth
  );
  const distancesB = [0, 1, 2, 3].map(
    (k) => (p.b - nodeAt(p.a, p.b, 14 - k)) / halfWidth
  );
  const atEdge = (
    endpoint: number,
    direction: 1 | -1,
    edge: number | undefined,
    nodes: [number, number, number, number] | undefined,
    distances: number[]
  ): number => {
    if (edge === undefined || nodes === undefined) return 0;
    if (!Number.isFinite(edge) || !nodes.every((v) => Number.isFinite(v)))
      return 0;
    const [v0, v1, v2, v3] = nodes;
    const [d0, d1, d2, d3] = distances;
    // The gap between the endpoint and its nearest node: at least the
    // nominal one, and the whole distance to the rounded node when it is
    // farther. On the panel `[J − u, J]` (`u` the spacing of the doubles at
    // `J`, a jump at `J`), all the nodes round to `J`, the gap is the whole
    // panel, and with the nominal gap the error was `5e-10` for a lost area
    // of `1.2e-7` (`J = 10⁶ + 0.3`).
    const gap = Math.max(EDGE_NODE_DISTANCES[0], d0) * halfWidth;
    const rounding =
      64 *
      Number.EPSILON *
      Math.max(
        Math.abs(edge),
        Math.abs(v0),
        Math.abs(v1),
        Math.abs(v2),
        Math.abs(v3)
      );
    if (!(0 < d0 && d0 < d1 && d1 < d2 && d2 < d3)) {
      // The step from the edge sample to the nearest node, against the
      // change that the slope of the panel predicts over the gap. With the
      // step alone, a smooth integrand on panels some doubles wide reported
      // each change of one double as a hidden jump: on the 16 starting
      // panels of `∫ e^(x − 10⁹) dx` over `[10⁹, 10⁹ + 10⁻⁵]` (5 doubles
      // each), `1.4e-14` per endpoint.
      // The slope is the largest between two distinct consecutive nodes of
      // the panel (`Panel.slopeTimesHalfLength`): the four nodes nearest to the endpoint
      // can be one double.
      // A change that is not finite is no evidence that the step is smooth.
      const step = Math.abs(edge - v0);
      const change = 2 * (p.slopeTimesHalfLength ?? 0) * (gap / halfWidth);
      return Number.isFinite(change) && step <= change + rounding
        ? 0
        : step * gap;
    }
    const miss = Math.abs(edge - parabolaAt([d0, d1, d2], [v0, v1, v2], 0));
    const inward = Math.abs(v0 - parabolaAt([d1, d2, d3], [v1, v2, v3], d0));
    if (miss <= inward + rounding) return 0;
    // The probe is inside the gap, near the endpoint, and at least some
    // units in the last place from it (`direction` points into the panel).
    const probe =
      endpoint +
      direction *
        Math.max(
          gap * HIDDEN_EDGE_PROBE,
          4 * Number.EPSILON * Math.abs(endpoint)
        );
    const distance = Math.abs(probe - endpoint);
    if (distance > 0 && distance < gap) {
      const sample = f(probe);
      const predicted = parabolaAt(
        [d0, d1, d2],
        [v0, v1, v2],
        distance / halfWidth
      );
      if (
        Number.isFinite(sample) &&
        Math.abs(sample - predicted) <= inward + rounding
      )
        return miss * distance;
    }
    return miss * gap;
  };
  return (
    atEdge(p.a, 1, p.edgeA, p.nodesNearA, distancesA) +
    atEdge(p.b, -1, p.edgeB, p.nodesNearB, distancesB)
  );
}

/** The spacing of the doubles at `x`, or twice it when `x` is just below a
 * power of 2 (`Math.log2` can round up there): a distance from `x` that
 * moves it to another double. */
function ulpOf(x: number): number {
  const m = Math.abs(x);
  if (!(m >= 2 ** -1022)) return Number.MIN_VALUE;
  return 2 ** (Math.floor(Math.log2(m)) - 52);
}

/** The distance from an endpoint of a panel to the probe of
 * `hiddenEdgeError`, as a fraction of the distance from the endpoint to the
 * nearest node. */
const HIDDEN_EDGE_PROBE = 2 ** -40;

/** The `i`-th GK15 node of the panel `[a, b]`, in increasing order (`i`
 * from 0 to 14): the position where `gk15` samples the integrand. The node
 * is clamped to the panel: on a panel a few doubles wide, the rounded
 * center minus the rounded offset of an outer node can round to a double
 * outside it, and `∫ (2 − x) dx` over `[1, 1 + 5ε]` sampled the integrand
 * at `1 − ε/2`, where an integrand such as `√(x − 1)` is not defined. */
function nodeAt(a: number, b: number, i: number): number {
  const center = 0.5 * (a + b);
  const halfLength = 0.5 * (b - a);
  const x =
    i < 7
      ? center - halfLength * XGK[i]
      : i === 7
        ? center
        : center + halfLength * XGK[14 - i];
  return Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b));
}

/**
 * Twice the magnitude of the change of the GK15 value of the panel that
 * the rounding of its nodes to the doubles makes (see `gk15`): `|h·Σ w_k·
 * s_k·(x̃_k − x_k)|`, with `s_k` the slope of the samples at the nodes on each
 * side of node `k` (one side at the outer nodes), 0 between nodes that
 * round to the same double.
 */
function positionShift(
  a: number,
  b: number,
  samples: readonly number[]
): number {
  const h = 0.5 * (b - a);
  const xs = Array.from({ length: 15 }, (_, i) => nodeAt(a, b, i));
  const abscissa = (i: number) => (i < 7 ? -XGK[i] : i === 7 ? 0 : XGK[14 - i]);
  const weight = (i: number) =>
    i < 7 ? WGK[i] : i === 7 ? WGK[7] : WGK[14 - i];
  // `Δf·(shift/Δx)`, not `(Δf/Δx)·shift`: the slope alone can overflow
  // when `Δx` is a few doubles.
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(14, i + 1);
    const dx = xs[hi] - xs[lo];
    if (dx === 0) continue;
    const shift = xs[i] - a - h * (1 + abscissa(i));
    sum += weight(i) * (samples[hi] - samples[lo]) * (shift / dx);
  }
  // Twice the first-order estimate: on `[10⁶, 10⁶ + 10⁻⁹]` (8 doubles) the
  // estimate was 0.9 times the change.
  return 2 * Math.abs(h * sum);
}

/**
 * Apply the GK15 rule to a single finite panel `[a, b]`.
 * Returns the 15-point estimate and an error estimate: the larger of the
 * QUADPACK error and the null-rule error (`nullRuleError`).
 */
export function gk15(f: (x: number) => number, a: number, b: number): Panel {
  const center = 0.5 * (a + b);
  const halfLength = 0.5 * (b - a);
  const absHalfLength = Math.abs(halfLength);

  // The integrand is sampled at the nodes of `nodeAt`, which are in `[a, b]`.
  const fc = f(nodeAt(a, b, 7));
  let resg = WG[3] * fc; // 7-point Gauss accumulator
  let resk = WGK[7] * fc; // 15-point Kronrod accumulator

  // Function values at the ± node pairs, kept for the resasc refinement.
  const fv1: number[] = new Array(7);
  const fv2: number[] = new Array(7);

  // Non-central Gauss nodes: XGK[1], XGK[3], XGK[5].
  for (let j = 0; j < 3; j++) {
    const k = 2 * j + 1;
    const f1 = f(nodeAt(a, b, k));
    const f2 = f(nodeAt(a, b, 14 - k));
    fv1[k] = f1;
    fv2[k] = f2;
    const fsum = f1 + f2;
    resg += WG[j] * fsum;
    resk += WGK[k] * fsum;
  }

  // Kronrod-only nodes: XGK[0], XGK[2], XGK[4], XGK[6].
  for (let j = 0; j < 4; j++) {
    const k = 2 * j;
    const f1 = f(nodeAt(a, b, k));
    const f2 = f(nodeAt(a, b, 14 - k));
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
  const quadpackError = error;

  // The difference of the two sums can be near 0 by chance for a kink or a
  // jump inside the panel: the error is also at least the estimate of the
  // null rules of the same 15 samples (`nullRuleError`).
  let resabs = WGK[7] * Math.abs(fc);
  for (let k = 0; k < 7; k++)
    resabs += WGK[k] * (Math.abs(fv1[k]) + Math.abs(fv2[k]));
  resabs *= absHalfLength;
  const samples = [
    fv1[0],
    fv1[1],
    fv1[2],
    fv1[3],
    fv1[4],
    fv1[5],
    fv1[6],
    fc,
    fv2[6],
    fv2[5],
    fv2[4],
    fv2[3],
    fv2[2],
    fv2[1],
    fv2[0],
  ];
  // The rounding of the samples: of their values (some units in the last
  // place of `resabs`), and of the positions of the nodes, which are
  // doubles. A node is up to half a unit in the last place of `center` from
  // its exact position, and the sample there differs by up to the slope of
  // the integrand times that distance. On `[10⁹, 10⁹ + 1e-6]` (8 units in
  // the last place wide), the null rules of `e^(x − 10⁹)` measured this
  // rounding, `2e-14`, and the error was `2.3e-13` for a true error of
  // `8e-22`. The slope is the largest slope between two consecutive nodes,
  // at their rounded positions, and it is kept multiplied by the half
  // length (`Panel.slopeTimesHalfLength`), which does not overflow: with
  // `(x − 1)·2¹⁰⁵⁰` on `[1, 1 + 129·ε]`, the slope was `+∞`, the noise floor
  // `+∞` suppressed every null-rule pair, and the result was `converged` with
  // a true error of 1e4 times its error.
  let slopeTimesHalfLength = 0;
  for (let i = 0; i + 1 < 15; i++) {
    const dx = nodeAt(a, b, i + 1) - nodeAt(a, b, i);
    if (dx !== 0)
      slopeTimesHalfLength = Math.max(
        slopeTimesHalfLength,
        Math.abs(samples[i + 1] - samples[i]) * (absHalfLength / Math.abs(dx))
      );
  }
  const nodeRounding = ulpOf(center) * slopeTimesHalfLength;
  const noise = NULL_RULE_NOISE_ULPS * (Number.EPSILON * resabs + nodeRounding);
  const nullError = nullRuleError(samples, absHalfLength, noise);
  // The QUADPACK error is never larger than `resasc`, the integral of the
  // deviation of the integrand from its mean on the panel, and the null-rule
  // estimate is not either. A panel where the integrand is not resolved
  // (`sin(1/x)` next to 0) has a null-rule estimate of 10 times its largest
  // pair, which can be larger than `resasc`. With this bound, the error of
  // `∫₀¹ sin(1/x) dx` is `6.1e-5` (`5.7e-5` with the QUADPACK error alone);
  // without it, `3.4e-4`, for a true error of `4e-7`, and the caller used
  // the Monte-Carlo fallback (`quadratureBeatsMonteCarlo`).
  if (nullError > error) error = Math.max(error, Math.min(nullError, resasc));

  // The nodes are doubles: the rule samples the integrand at `x̃_k`, not at
  // the exact nodes `x_k = a + h·(1 + t_k)` (`t_k` the GK15 abscissae, `h`
  // the half length). The value then differs from the GK15 value by about
  // `h·Σ w_k·f'(x_k)·(x̃_k − x_k)`. The distance `x̃_k − a` is exact when
  // `x̃_k` and `a` are within a factor 2 of each other (Sterbenz), which is
  // the case when the shifts matter (the panel is narrow against its
  // distance to 0); otherwise it is rounded by at most `ε·|x̃_k − a|`. So
  // `x̃_k − x_k` is known, and the slope `f'` is read from the samples next
  // to the node. Each shift is up to half a unit in the last place of
  // `center`, whatever the width of the panel: `sin(10³·(x − a))` over
  // `[10⁶, 10⁶ + 0.01]` was `converged`, `± 2.2e-13`, for a true error of
  // `2.3e-11`, and `∫ e^(x − 10⁹) dx` over `[10⁹, 10⁹ + 10⁻⁴]` `± 1.1e-18`
  // for `3.8e-13`. The term is computed only when it can be much larger than
  // the rounding of the value: `ulp(center)·slope·h > 16·ε·resabs`. Below
  // that, it is of the size of the rounding of the sum of the panels, and
  // on the panels of `∫₋₃₀³⁰ x³ dx = 0` (where it cancels by symmetry) it
  // was larger than the absolute tolerance `1e-12`.
  const shift =
    nodeRounding > 16 * Number.EPSILON * resabs
      ? positionShift(a, b, samples)
      : 0;
  // The term is not in `error` here: the adaptive loop adds it
  // (`adaptiveFinite`), and the lobes of the oscillatory quadrature
  // (`oscillatory-quadrature.ts`) have their own floor for this rounding
  // (`lobeRoundingScale`); with the term in the error of each lobe panel,
  // `∫ from 10⁵ of sin t/√t` had no result. It is not in `quadpackError`
  // either: the test of the accuracy of a shell next to a singular endpoint
  // reads it (see `Panel.quadpackError`), and the term grows next to a
  // singular point (the uncertainty of an extrapolation reads `error`).
  // A term that is not finite is not known: it makes the error of the panel
  // `+∞`, and the adaptive loop bisects the panel (it was 0).
  const positionError = Number.isFinite(shift)
    ? shift
    : Number.POSITIVE_INFINITY;

  // Count the `NaN` samples and the other samples that are not finite, and
  // find the largest finite sample. A `NaN` value can also come from samples
  // `+∞` and `−∞` in the same panel, which are not `NaN` samples.
  let nanSamples = 0;
  let nonFiniteSamples = 0;
  let largestFinite = Number.NEGATIVE_INFINITY;
  let nanFirst = Number.POSITIVE_INFINITY;
  let nanLast = Number.NEGATIVE_INFINITY;
  const tally = (v: number, x: number) => {
    if (Number.isFinite(v)) {
      if (Math.abs(v) > largestFinite) largestFinite = Math.abs(v);
      return;
    }
    nonFiniteSamples += 1;
    if (Number.isNaN(v)) {
      nanSamples += 1;
      nanFirst = Math.min(nanFirst, x);
      nanLast = Math.max(nanLast, x);
    }
  };
  tally(fc, nodeAt(a, b, 7));
  for (let k = 0; k < 7; k++) {
    tally(fv1[k], nodeAt(a, b, k));
    tally(fv2[k], nodeAt(a, b, 14 - k));
  }

  const panel: Panel = {
    a,
    b,
    value,
    error,
    quadpackError,
    positionError,
    slopeTimesHalfLength,
    nanSamples,
    nonFiniteSamples,
    largestFinite,
    centerSample: fc,
    nodesNearA: [fv1[0], fv1[1], fv1[2], fv1[3]],
    nodesNearB: [fv2[0], fv2[1], fv2[2], fv2[3]],
  };
  if (nanSamples > 0) panel.nanNodes = [nanFirst, nanLast];
  return panel;
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

/** The smallest number of `NaN` samples (or of samples that are not finite),
 * of the 15 samples of a panel, that shows that the integrand is `NaN` (or
 * not finite) on a part of the panel, not only at some isolated points. A
 * point is at most one node of a panel, so a few isolated points give a few
 * such samples. See `nanRegion` and `refinementFailed` in `adaptiveFinite`. */
const NAN_MAJORITY = 8;

/** The largest ratio of the values next to the boundary of a set where the
 * integrand is `NaN` to the largest finite sample of the integrand, for which
 * that set is not reported as a region with no value (`nanRegion` in
 * `adaptiveFinite`). Below this ratio the integrand has decreased to the size
 * of the rounding of its largest value at the boundary, which is also what an
 * integrand that overflows in its tail shows (`sinh x/cosh² x` is `∞/∞` for
 * `x > 710`, where its value is about `10⁻³⁰⁸`). See `nanSetBorderIsLarge`. */
const NAN_BORDER_RATIO = 2 ** -50;

/** The distance from the boundary of a `NaN` set, as a fraction of the
 * interval, of the first point where `nanSetBorderIsLarge` reads the
 * integrand. The function also reads it at 2, 4 and 8 times this distance. */
const NAN_BORDER_DISTANCE = 2 ** -20;

/** The largest number of boundaries of `NaN` sets that one adaptive loop
 * examines (`nanSetBorderIsLarge`). Each examination costs about 30 to 60
 * evaluations of the integrand. After this number, a `NaN` set is not
 * reported as a region with no value. */
const NAN_BORDER_TESTS = 32;

/** The smallest error that `adaptiveQuadrature` reports, in units of
 * `Number.EPSILON` times the larger of `|estimate|` and the sum of the
 * magnitudes of the panel values: the rounding of a sum of double values.
 * See the floor in `adaptiveQuadrature`. */
const ROUNDOFF_ULPS = 4;

/**
 * The smallest number of bisections of a panel far from both endpoints
 * (`interiorSite` in `GaussKronrodOutcome`, `endpoint-quadrature.ts`) for
 * `adaptiveQuadrature` to read the panel as the site of a singularity
 * inside the interval, and to split the interval there
 * (`interiorSingularPoint`).
 *
 * The endpoint analysis (`shellsDiverge`, `tailUnresolved` and the
 * extrapolation of the shells, `resolveSingularEndpoints`) reads only the
 * panels at the two endpoints. A singularity inside the interval was not
 * analyzed: `∫₋₁² (t − 0.3)⁻² dt`, which diverges, gave `8.9e16`, and
 * `∫₋₁² |t − 1/3|^(−1/2) dt` reported `converged` with an error of `4.9e-10`
 * when its true error was `1.3e-8`. Measured with 16 starting panels: an
 * algebraic singularity inside the interval is bisected 52 times or more (to
 * the spacing of the doubles), and a logarithmic singularity, a kink, a jump
 * and a peak of width `1e-6` at most 32 times. A split at a point where the
 * integrand is smooth gives the same value, at the cost of a second
 * quadrature.
 */
const INTERIOR_SITE_DEPTH = 40;

/**
 * A panel far from both endpoints is also the site of a singularity when its
 * width is at most this number of spacings of the doubles at its position
 * (`Number.EPSILON·|x|`). Far from 0, the spacing stops the bisection before
 * `INTERIOR_SITE_DEPTH`: next to the pole of `(t − 1000000.3)⁻²` on
 * `[999999, 1000002]`, the doubles are `1.2e-10` apart and a starting panel
 * can be bisected about 31 times. Next to 1/3, 4096 spacings are a depth of
 * about 39, the same reading as `INTERIOR_SITE_DEPTH`; a jump of `⌊t⌋` on
 * `[0, 3.3]` (depth 30, width `2e-10`) is not a site.
 */
const INTERIOR_SITE_ULPS = 4096;

/** The number of times `adaptiveQuadrature` splits an interval at a
 * singularity inside it (see `INTERIOR_SITE_DEPTH`): a half can split again,
 * at another singularity, up to this depth. */
const MAX_INTERIOR_SPLITS = 3;

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
 * BOTH stay below this threshold: their block ratios are `1 − B/n` and
 * `1 − 2B/n` at refinement depth `n`, i.e. both approach 1 from below and
 * neither reaches 0.99 inside the panel budget. A different test separates
 * them: the exponent of the power of the depth that the shells follow (see
 * `shellsDecayAsPower`).
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
 * The relative difference within which three successive block ratios of
 * {@link shellsDiverge} are the SAME ratio. The shells of a pure power
 * `t^(−p)` shrink geometrically, each `2^(p−1)` of the one before, so their
 * block ratio is constant to the rounding of the block sums (about `1e-15`).
 * A ratio that rises toward 1 (the shells of `1/(t·ln t)`, which diverges,
 * are about `1/k` at depth `k`) changes by about `20/k²` per shell, `2e-5`
 * at the deepest shells a bound at 0 allows, far more than this. (That
 * integrand is not a case for this test: its ratio stays below
 * `SHELL_DECAY` at every reachable depth, and its divergence is found by
 * `shellsDecayAsPower`.)
 */
const SHELL_GEOMETRIC_SAME = 1e-9;

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
 * The smallest number of shells with which `shellsDecayAsPower` estimates the
 * exponent of the shells. The estimate assumes that the shells are a power
 * `C·k^(−p)` of the depth `k`, and the terms of lower order make it too low:
 * for the shells `ln(1 + 1/k)` of `−1/(t·ln t)` at 0 on `[0, ½]` (exactly
 * `p = 1`), the estimate is `0.878` after 60 shells, `0.981` after 100 and
 * `0.9967` after 200. Next to a nonzero endpoint the corner panel is
 * bisected only about 48 times (see `shellsDiverge`), so there the test is
 * not available: at 48 shells, the estimate for `1/(x·ln x)` at `∞` (`0.87`)
 * and for the convergent `1/(x·ln^1.1 x)` (`0.95`) are on the same side of 1.
 */
const SHELL_POWER_MIN_SHELLS = 10 * SHELL_BLOCK;

/**
 * The largest exponent `p` of the shells `C·k^(−p)` (see
 * `shellsDecayAsPower`) that is read as a divergence. The series of the
 * terms `k^(−p)` diverges for `p ≤ 1` and converges for `p > 1`. The margin
 * above 1 is for the terms of lower order: `−1/(t·ln t) − 5/(t·ln²t)`
 * (divergent) gives an estimate of `1.003` after 200 shells. Measured after
 * 200 shells at 0 on `[0, ½]`: `−1/(t·ln t)` gives `0.9967`, and the
 * convergent `1/(t·ln²t)` gives `1.99`, `1/(t·(−ln t)^1.02)` gives `1.017`,
 * and `−t^0.0001/(t·ln t)` gives `1.021`. The convergent integrands that
 * this test reads as divergent have shells whose exponent is within 0.01 of
 * 1 at every reachable depth: `1/(t·(−ln t)^p)` with `p` from 1 to about
 * `1.008` (`∫₀^½ = (ln 2)^(1−p)/(p − 1)`, at least 125), and
 * `−t^ε/(t·ln t)` with `ε` up to about `3·10⁻⁵`. The quadrature cannot find
 * the value of these integrals: the part of the tail past the deepest shell
 * is most of the integral, and before this test the result was a wrong
 * finite value.
 */
const SHELL_POWER_DIVERGENT = 1.005;

/**
 * The largest difference between the exponents that `shellsDecayAsPower`
 * estimates from three successive pairs of blocks. The estimates for a power
 * of the depth agree to within `0.003` after 200 shells. Shells whose sum
 * oscillates slowly (`(2 + sin(ln t))/(t·ln t)`) give estimates that change
 * sign from one pair to the next.
 */
const SHELL_POWER_SPREAD = 0.05;

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
 * Whether the shells toward an endpoint decrease as a power `C·k^(−p)` of the
 * depth `k` with `p ≤ SHELL_POWER_DIVERGENT`: the signature of a divergent
 * integral whose block ratio stays below `SHELL_DECAY` at every depth that
 * the doubles allow. The shells of `−1/(t·ln t)` at 0 are `ln(1 + 1/k)`,
 * about `1/k`, and `∫₀^½ −1/(t·ln t) dt` is `+∞` (the antiderivative is
 * `−ln(−ln t)`), but the block ratio is about `1 − 20/k` and reaches 0.99
 * only at `k = 2000`, past the deepest shell (about 1070 next to 0).
 *
 * The series of the terms `k^(−p)` diverges when `p ≤ 1`, because its
 * partial sums grow as `ln k` (`p = 1`) or as `k^(1−p)` (`p < 1`), and
 * converges when `p > 1`. Shells that decrease geometrically (a pure power
 * of `t`, a bounded integrand) decrease faster than every power of `k`.
 *
 * The exponent is read from the change of the block ratio `r` with the
 * depth. For shells `C·k^(−p)`, the block ratio at depth `m` is about
 * `((m + B)/m)^(−p)` for `B = SHELL_BLOCK`, so `−ln r` is about `B·p/m`,
 * and `−1/ln r` is about `m/(B·p)`: it increases by `1/p` when the blocks
 * move `B` shells deeper. This estimate does not need the depth `m` itself,
 * which is not known when the logarithm in the integrand has a different
 * scale (`ln(t/1000)`).
 *
 * The exponent is estimated from the four block ratios that end at the last
 * shell and `B`, `2·B` and `3·B` shells before it, which gives three
 * estimates. The test is true when all of the block ratios are in `(0, 1)`,
 * the three estimates are positive, at most `SHELL_POWER_DIVERGENT`, and
 * agree to within `SHELL_POWER_SPREAD`. A
 * geometric decrease has a constant block ratio, so the change of `−1/ln r`
 * is zero or a rounding error, and the estimate is very large or negative.
 */
function shellsDecayAsPower(shells: number[]): boolean {
  const n = shells.length;
  if (n < SHELL_POWER_MIN_SHELLS) return false;
  let lowest = Infinity;
  let highest = -Infinity;
  let previous: number | undefined;
  for (let j = 3; j >= 0; j--) {
    const ratio = blockRatio(shells, n - j * SHELL_BLOCK);
    if (ratio === undefined || !(ratio > 0 && ratio < 1)) return false;
    const inverse = -1 / Math.log(ratio);
    if (previous !== undefined) {
      const p = 1 / (inverse - previous);
      if (!(p > 0 && p <= SHELL_POWER_DIVERGENT)) return false;
      lowest = Math.min(lowest, p);
      highest = Math.max(highest, p);
    }
    previous = inverse;
  }
  return highest - lowest <= SHELL_POWER_SPREAD;
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
  // A ratio below `SHELL_DECAY`: the shells shrink, but they can shrink too
  // slowly for the series to converge (see `shellsDecayAsPower`).
  if (!(last >= SHELL_DECAY)) return shellsDecayAsPower(shells);
  if (!(before > 0) || !(first > 0)) return false;

  // The ratio has stopped falling: a pole of order 1 or more — unless the
  // three ratios are the same ratio BELOW 1. The shells then shrink
  // geometrically, and a geometric series converges, however slowly:
  // `t^(−0.9999)` sheds `2^(−0.0001)` of the previous shell every time, a
  // block ratio of `0.9986`, and `∫₀¹ t^(−0.9999) dt` is `10000`; the tail
  // past the deepest shell is found by the extrapolation of the shells
  // (`resolveSingularEndpoints`). A pole of order 1 has a ratio of exactly 1
  // (`1/t` sheds `ln 2` per shell) and a steeper pole a ratio above 1, so a
  // constant ratio below 1 by more than the rounding of the block sums is
  // not a pole (see `SHELL_GEOMETRIC_SAME`).
  if (last >= before * (1 - SHELL_TREND_FLAT)) {
    const same =
      Math.abs(last - before) <= SHELL_GEOMETRIC_SAME * last &&
      Math.abs(before - first) <= SHELL_GEOMETRIC_SAME * before;
    return !(same && last < 1 - SHELL_GEOMETRIC_SAME);
  }

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
 * Whether the integrand has values that are not of rounding size next to the
 * boundary of a set where it is `NaN`. `parent` is a panel of `[a, b]` with a
 * majority of `NaN` samples, and `largest` is the largest finite sample on
 * the interval.
 *
 * On each side of the `NaN` nodes of `parent`, the function finds a point
 * where `f` is not `NaN` (it steps out from the outermost `NaN` node by
 * `1/16`, `1/8`, … of the width of `parent`, inside the open interval
 * `(a, b)`), and bisects between the two points until the boundary is known
 * to `NAN_BORDER_DISTANCE·(b − a)/16`. It then reads `f` at `1`, `2`, `4` and
 * `8` times `NAN_BORDER_DISTANCE·(b − a)` from the boundary, away from the
 * `NaN` set. The values at these points, at a fixed fraction of the interval
 * from the boundary, show what is next to the boundary:
 * - next to a set where the integrand has no real value, a value that is not
 *   of rounding size: `√x` at `x = 2⁻²⁰` is `0.001`, and `x^(−1/2)` is large;
 * - in a tail where the terms of a decreasing integrand overflow, a value of
 *   about `10⁻³⁰⁸`: `eˣ/(1 + eˣ)²` is `∞/∞` for `x > 709.8`, and is
 *   `10⁻³⁰⁵` at `x = 702`.
 * The samples of the panels next to the `NaN` set can be far from it: on
 * `[0, 10000]`, the starting panel `[0, 625]` of the logistic density holds
 * its peak, and the `NaN` set starts at `709.8`.
 *
 * Returns `true` when a value read next to a boundary (an infinite value
 * included) is larger than `NAN_BORDER_RATIO` times `largest` (or than the
 * values read, when they are larger). Returns `false` when no boundary
 * could be found (`f` is `NaN` up to the ends of the interval, or the points
 * to read are outside it or `NaN`): then the `NaN` set is not reported as a
 * region with no value.
 */
function nanSetBorderIsLarge(
  f: (x: number) => number,
  a: number,
  b: number,
  parent: Panel,
  largest: number
): boolean {
  if (parent.nanNodes === undefined) return false;
  const distance = (b - a) * NAN_BORDER_DISTANCE;
  const width = parent.b - parent.a;
  // The largest magnitude of `f` next to the boundary on the side `dir`
  // (`-1` for the left, `1` for the right) of the `NaN` node `xNaN`, or
  // `undefined` when no boundary was found on that side.
  const borderValue = (xNaN: number, dir: number): number | undefined => {
    // A panel or an interval so narrow that its sixteenth, or the reading
    // distance, rounds to 0 gives no step to search with: doubling a step
    // of 0 never moves, and the search would read the same `NaN` point
    // without end (`[0, 64 · Number.MIN_VALUE]`).
    if (!(width / 16 > 0) || !(distance > 0)) return undefined;
    let xValue: number | undefined;
    for (let step = width / 16; step <= b - a; step *= 2) {
      const x = xNaN + dir * step;
      if (!(x > a && x < b)) break;
      if (!Number.isNaN(f(x))) {
        xValue = x;
        break;
      }
    }
    if (xValue === undefined) return undefined;
    let n = xNaN;
    let v = xValue;
    while (Math.abs(v - n) > distance / 16) {
      const m = 0.5 * (n + v);
      if (m === n || m === v) break;
      if (Number.isNaN(f(m))) n = m;
      else v = m;
    }
    let result: number | undefined;
    for (let j = 0; j < 4; j++) {
      const x = v + dir * distance * 2 ** j;
      if (!(x > a && x < b)) break;
      const y = f(x);
      if (Number.isNaN(y)) break;
      result = Math.max(result ?? 0, Math.abs(y));
    }
    return result;
  };
  const [first, last] = parent.nanNodes;
  const values = [borderValue(first, -1), borderValue(last, 1)].filter(
    (v): v is number => v !== undefined
  );
  if (values.length === 0) return false;
  const border = Math.max(...values);
  if (border === Number.POSITIVE_INFINITY) return true;
  return border > NAN_BORDER_RATIO * Math.max(largest, border);
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
  // The sum of the `positionError` parts of the errors of all the panels.
  // It is a rounding: like the rounding floor of the result (see
  // `ROUNDOFF_ULPS` in `quadrature`), it is held against
  // `rtol·max(|estimate|, magnitude)`, not against the tolerance of the
  // adaptive loop. With the tolerance, the first part of
  // `∫ from 10⁵ of sin t/√t` (152 wide, a rounding of `6e-12` against a
  // tolerance of `3e-13`) did not converge, and the oscillatory quadrature
  // (`oscillatory-quadrature.ts`) had no result.
  let totalRounding = 0;
  const roundingMet = () =>
    totalRounding <= rtol * Math.max(Math.abs(totalValue), totalMagnitude);
  // Each part meets its own test, and their sum meets the larger of the two
  // tests: with the two tests alone, a reducible error and a rounding of
  // 0.75 times the tolerance each gave a `converged` result with an error of
  // 1.5 times the tolerance (`1.5 + cos(3000·(x − 10⁵))` on
  // `[10⁵, 10⁵ + 1]`, `rtol = 6.31e-10`: 1.89 times).
  const metTolerance = () =>
    totalError - totalRounding <= tolerance() &&
    roundingMet() &&
    totalError <=
      Math.max(
        tolerance(),
        rtol * Math.max(Math.abs(totalValue), totalMagnitude)
      );
  const reducible = (p: Panel) => p.error - (p.positionError ?? 0);
  // The sum of the magnitudes of the panel values, for the absolute
  // tolerance (see `tolerance` below).
  let totalMagnitude = 0;
  let badPanels = 0;
  let roundoffStop = false;
  let divergent = false;
  // True when the loop stopped because the integrand is `NaN` on a set that
  // is not some isolated points (see the test after each bisection below).
  let nanRegion = false;
  // The number of boundaries of `NaN` sets examined by `nanSetBorderIsLarge`
  // (see the test after each bisection below).
  let nanBorderTests = 0;

  // Add to the error of a panel the bound of the area that a jump next to
  // one of its endpoints can hide from the nodes (`hiddenEdgeError`).
  const addHiddenEdgeError = (p: Panel) => {
    // The rounding of the nodes to the doubles (`positionShift`).
    if (Number.isFinite(p.error)) p.error += p.positionError ?? 0;
    if (Number.isFinite(p.error)) {
      const hidden = hiddenEdgeError(p, f);
      p.error += hidden;
      if (p.quadpackError !== undefined) p.quadpackError += hidden;
    }
  };

  // Fold a panel into the running totals, skipping non-finite contributions.
  const addPanel = (p: Panel) => {
    if (Number.isFinite(p.value)) {
      totalValue += p.value;
      totalMagnitude += Math.abs(p.value);
    }
    if (Number.isFinite(p.error)) {
      totalError += p.error;
      totalRounding += p.positionError ?? 0;
    }
    if (panelIsBad(p)) badPanels += 1;
  };
  const removePanel = (p: Panel) => {
    if (Number.isFinite(p.value)) {
      totalValue -= p.value;
      totalMagnitude -= Math.abs(p.value);
    }
    if (Number.isFinite(p.error)) {
      totalError -= p.error;
      totalRounding -= p.positionError ?? 0;
    }
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
  // The samples at the common endpoints of the starting panels, for the
  // test of a jump next to an endpoint of a panel (`hiddenEdgeError`). The
  // integrand is not sampled at `a` and `b`, where it can be singular.
  const boundarySamples: number[] = [];
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
    const p = gk15(f, lo, hi);
    if (i > 0) p.edgeA = boundarySamples[i - 1];
    if (i < n - 1) {
      boundarySamples.push(f(hi));
      p.edgeB = boundarySamples[i];
    }
    panels.push(p);
  }
  if (panels.length === 0) panels.push(gk15(f, a, b));
  panels.forEach((p) => {
    addHiddenEdgeError(p);
    addPanel(p);
  });

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
  // The QUADPACK parts of the errors of the shells, for the test of their
  // accuracy (`CornerSeries.shellQuadpackErrors`, `endpoint-quadrature.ts`).
  const shellQuadpackErrorsLo: number[] = [];
  const shellQuadpackErrorsHi: number[] = [];
  // The depth of the first shell of each corner, for `shellsDiverge`: the
  // number of halvings from a distance of 1 to the endpoint (0 for a corner
  // panel wider than 1), plus a margin.
  const depthOf = (p: Panel) =>
    Math.max(0, Math.log2(1 / (p.b - p.a))) + SHELL_DEPTH_MARGIN;
  let depthLo = depthOf(cornerLo);
  let depthHi = depthOf(cornerHi);
  let widthLo = cornerLo.b - cornerLo.a;
  let widthHi = cornerHi.b - cornerHi.a;
  let regionLo = cornerLo.b;
  let regionHi = cornerHi.a;

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
  // True when a bisection gave two bad children that each have at least
  // `NAN_MAJORITY` samples that are not finite. A non-finite value at one
  // point (a removable singularity such as `(x²-1)/(x²-1)` at x = ±1) is at
  // most one node of a panel. The center of a child can be such a point:
  // with `u = x − ⌊x⌋`, `sin(u)/u` is `0/0` at each integer, and on
  // `[0, 64]` the centers of the 16 starting panels and of their children
  // are integers, so two bad children alone stopped the loop with `NaN`
  // (the integral is `64·2·Si(1/2) = 63.1177`). The other nodes are at
  // irrational fractions of the panel from its center, so isolated points
  // give a few non-finite samples, and two children with a majority of
  // them show that the integrand is not finite on a part of each child.
  let refinementFailed = false;
  // True when the loop must stop with a `NaN` result: no panel is finite,
  // there are at least `ALL_BAD_STOP_PANELS` panels, and a bisection gave
  // two bad children (`refinementFailed`). Without this stop, all errors are
  // infinite and the loop would keep halving panels until they are too narrow
  // to split (more than 30,000 evaluations).
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
    if (badPanels === 0 && metTolerance()) break;
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
      // The part of the error that a bisection can make smaller: without the
      // rounding of the nodes (`positionError`).
      for (let i = 1; i < panels.length; i++)
        if (errorKey(reducible(panels[i])) > errorKey(reducible(panels[worst])))
          worst = i;
    }

    const iv = panels[worst];
    // The errors that a bisection can make smaller meet the tolerance, and
    // the rounding of the nodes does not: more panels cannot help. Without
    // this stop, `sin(10³·(x − a))` over `[10⁶, 10⁶ + 0.01]` used the whole
    // panel budget (44,775 evaluations). The result is not converged. A
    // stop on the rounding alone, while other errors were still larger than
    // the tolerance, ended `1/((x − 10⁶ − 10⁻⁵)² + 10⁻¹²)` on
    // `[10⁶, 10⁶ + 1]` after 1,696 evaluations with a true error of `7.2`.
    // A bad panel (a non-finite value, which `totalError` leaves out) is not
    // a rounding: the loop goes on to bisect it away.
    if (
      badPanels === 0 &&
      totalError - totalRounding <= tolerance() &&
      !roundingMet()
    )
      break;
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
    // The center of the parent is the common endpoint of the children.
    left.edgeA = iv.edgeA;
    left.edgeB = right.edgeA = iv.centerSample;
    right.edgeB = iv.edgeB;
    addHiddenEdgeError(left);
    addHiddenEdgeError(right);
    if (
      panelIsBad(left) &&
      panelIsBad(right) &&
      (left.nonFiniteSamples ?? 0) >= NAN_MAJORITY &&
      (right.nonFiniteSamples ?? 0) >= NAN_MAJORITY
    )
      refinementFailed = true;

    // Stop with a `NaN` result (`nanRegion`) when the integrand is `NaN` on
    // a part of the interval and has no value there. For example, the real
    // function `Math.sqrt(y)` is `NaN` for every `y < 0`, and its integral on
    // an interval that includes negative values has no real value. Without
    // this stop, each bisection of a panel inside the `NaN` set gives two
    // bad children, the loop bisects them until the panel budget is used
    // (more than 30,000 evaluations), and the caller then samples the
    // integrand for the Monte-Carlo fallback (`1e7` evaluations). Three
    // conditions must be true:
    //
    // 1. The parent and its two children each have at least `NAN_MAJORITY`
    //    `NaN` samples of 15. A `NaN` at isolated points (removable
    //    singularities: `(x² − 1)/(x² − 1)` at `x = ±1`, `u/u` with
    //    `u = x − ⌊x⌋` at each integer) does not stop the loop. Each point is
    //    at most one node of a panel. The center of a panel can be such a
    //    point, but the other nodes are at irrational fractions of the panel
    //    from its center, so a few isolated points give a few `NaN` samples.
    //    An infinite sample (an integrable singularity) is not a `NaN`
    //    sample.
    //
    // 2. The parent is not inside the `2⁻³⁰·(b − a)` next to an endpoint.
    //    There, the narrowest shells can sample the integrand where its
    //    value rounds below a bound of its domain (`√(1 − x² − y²)` just
    //    inside the bound `x = √(1 − y²)`), and the endpoint tests and the
    //    extrapolation of the shells examine that tail. A parent that
    //    touches an endpoint but is wider than that is tested: the `NaN` set
    //    of `∫_{−0.2}^∞ y^(−1/2)·e^(−y/2) dy` starts at the endpoint.
    //
    // 3. The values of the integrand next to the boundary of the `NaN` set,
    //    at a small fixed fraction of the interval from it, are not of
    //    rounding size: larger than `NAN_BORDER_RATIO` times the largest
    //    finite sample on the interval (`nanSetBorderIsLarge`). An integrand
    //    that decreases to 0 can be `NaN` in its tail because its terms
    //    overflow (`sinh x/cosh² x` is `∞/∞`, and `eˣ/(1 + eˣ)²` is `∞/∞`,
    //    for `x > 710`), and the integral has a value. The values next to
    //    such a tail are of rounding size. They are also of rounding size
    //    next to a `NaN` set at a zero of high order (the real code of
    //    `y^20.5·e^(−y/2)` is `NaN` for `y < 0`), and the two cases are not
    //    different from the values alone. Then, and when no boundary is
    //    found, the loop continues as if this test did not exist: the bad
    //    panels are bisected, and the caller decides what to do with the
    //    result, which does not converge. The children of the panel are
    //    marked (`nanUndecided`), and the panels that come from them are not
    //    examined again, but another `NaN` set in another part of the
    //    interval is examined. At most `NAN_BORDER_TESTS` boundaries are
    //    examined.
    if (iv.nanUndecided === true) left.nanUndecided = right.nanUndecided = true;
    else if (
      nanBorderTests < NAN_BORDER_TESTS &&
      (iv.nanSamples ?? 0) >= NAN_MAJORITY &&
      (left.nanSamples ?? 0) >= NAN_MAJORITY &&
      (right.nanSamples ?? 0) >= NAN_MAJORITY &&
      iv.b - a > (b - a) * 2 ** -30 &&
      b - iv.a > (b - a) * 2 ** -30
    ) {
      nanBorderTests += 1;
      let largest = Math.max(
        left.largestFinite ?? Number.NEGATIVE_INFINITY,
        right.largestFinite ?? Number.NEGATIVE_INFINITY
      );
      for (const p of panels)
        largest = Math.max(
          largest,
          p.largestFinite ?? Number.NEGATIVE_INFINITY
        );
      if (nanSetBorderIsLarge(f, a, b, iv, largest)) {
        nanRegion = true;
        break;
      }
      left.nanUndecided = right.nanUndecided = true;
    }

    removePanel(iv);
    addPanel(left);
    addPanel(right);

    panels[worst] = left;
    panels.push(right);

    if (iv === cornerLo && iv === cornerHi) {
      // A single starting panel is the corner of both endpoints. Its
      // children are the two corners: each is not a shell of the other
      // corner. The corners then start from the two halves, so that the
      // extrapolation of one corner does not replace the panels of the
      // other (with one starting panel, the integral of `(1 − x)^(−1/2)` on
      // `[0, 1]` was `4`, twice its value `2`).
      cornerLo = left;
      cornerHi = right;
      depthLo = depthOf(left);
      depthHi = depthOf(right);
      widthLo = mid - iv.a;
      widthHi = iv.b - mid;
      regionLo = mid;
      regionHi = mid;
    } else {
      if (iv === cornerLo) {
        cornerLo = left;
        shellsLo.push(right.value);
        // An error of `+∞` (a node position that is not finite, `gk15`)
        // stays `+∞`: `+∞ − positionError` is `NaN` when `positionError` is
        // also `+∞`.
        shellErrorsLo.push(
          Number.isFinite(right.error)
            ? right.error - (right.positionError ?? 0)
            : right.error
        );
        shellQuadpackErrorsLo.push(right.quadpackError ?? right.error);
      }
      if (iv === cornerHi) {
        cornerHi = right;
        shellsHi.push(left.value);
        shellErrorsHi.push(
          Number.isFinite(left.error)
            ? left.error - (left.positionError ?? 0)
            : left.error
        );
        shellQuadpackErrorsHi.push(left.quadpackError ?? left.error);
      }
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
  // panel, which the extrapolation of its shells replaces. A non-finite
  // value or error is left out, as in the totals (`addPanel`): a panel with a
  // finite value and a non-finite error is bad, but its value is in
  // `totalValue`, and it must be replaced with the other panels of the
  // corner. When it was left out here, its value stayed in the corrected
  // result: with 1500 panels, `∫₀¹ cos(ln t)/t^0.99 dt` was
  // `0.010051002 ± 1.8e-10`, and the integral is `0.0099990001`.
  let insideValueLo = 0;
  let insideErrorLo = 0;
  let insideValueHi = 0;
  let insideErrorHi = 0;
  for (const p of panels) {
    const value = Number.isFinite(p.value) ? p.value : 0;
    const error = Number.isFinite(p.error) ? p.error : 0;
    if (p.b <= regionLo) {
      insideValueLo += value;
      insideErrorLo += error;
    } else if (p.a >= regionHi) {
      insideValueHi += value;
      insideErrorHi += error;
    }
  }
  const corners = {
    lo: {
      shells: shellsLo,
      shellErrors: shellErrorsLo,
      shellQuadpackErrors: shellQuadpackErrorsLo,
      value: insideValueLo,
      error: insideErrorLo,
      width: widthLo,
      endpoint: a,
      last: {
        width: cornerLo.b - cornerLo.a,
        value: cornerLo.value,
        error: cornerLo.error,
      },
    },
    hi: {
      shells: shellsHi,
      shellErrors: shellErrorsHi,
      shellQuadpackErrors: shellQuadpackErrorsHi,
      value: insideValueHi,
      error: insideErrorHi,
      width: widthHi,
      endpoint: b,
      last: {
        width: cornerHi.b - cornerHi.a,
        value: cornerHi.value,
        error: cornerHi.error,
      },
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
  // The same `NaN` result is given when the integrand is `NaN` on a set that
  // is not some isolated points (`nanRegion`), with the flag that tells a
  // caller not to sample the integrand.
  if (nanRegion || allPanelsBad())
    return {
      estimate: NaN,
      error: NaN,
      converged: false,
      divergent: false,
      unresolved: false,
      magnitude: 0,
      ...(nanRegion ? { nanRegion: true as const } : {}),
      ...corners,
    };

  const converged =
    !divergent &&
    !unresolved &&
    !roundoffStop &&
    badPanels === 0 &&
    Number.isFinite(totalValue) &&
    Number.isFinite(totalError) &&
    metTolerance();

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
  // The deepest panel inside the interval (see `interiorSite` in
  // `GaussKronrodOutcome`). The bisection toward a singular endpoint leaves
  // shells that touch neither endpoint, `[a + w, a + 2w]`, whose distance to
  // the endpoint is their width: they belong to the endpoint analysis. A
  // panel next to a singularity inside the interval is narrower than half
  // its distance to each endpoint.
  let site: Panel | undefined;
  for (const p of panels) {
    const w = p.b - p.a;
    if (
      p.a - a > 2 * w &&
      b - p.b > 2 * w &&
      ((p.depth ?? 0) >= INTERIOR_SITE_DEPTH ||
        w <= INTERIOR_SITE_ULPS * Number.EPSILON * Math.abs(p.a + p.b) * 0.5) &&
      (site === undefined || (p.depth ?? 0) > (site.depth ?? 0))
    )
      site = p;
  }
  return {
    estimate: totalValue,
    error: valueMissing ? Number.POSITIVE_INFINITY : totalError,
    converged,
    divergent,
    unresolved,
    magnitude: Math.max(totalMagnitude, 0),
    ...(site === undefined ? {} : { interiorSite: { a: site.a, b: site.b } }),
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
 * The errors of the integrals computed inside the integrand of a quadrature
 * called with `nestedErrors` (see `adaptiveQuadrature`).
 */
type NestedErrors = {
  /** The sums of the errors, and of the tolerances, of the inner results
   * reported during the current evaluation of the integrand. */
  errors: number;
  tolerances: number;
  /** The same sums, each term divided by the magnitude of the estimate,
   * for the inner results with an estimate that is not 0. */
  relativeErrors: number;
  relativeTolerances: number;
  /** Whether an inner result was reported during the current evaluation. */
  reported: boolean;
  /** The number of evaluations of the integrand with a finite value and an
   * inner result. */
  count: number;
  /** The sums of the errors, and of the tolerances, of these values (see
   * `withNestedErrors`). */
  errorSum: number;
  toleranceSum: number;
  /** The sum of the magnitudes of these values. */
  magnitudeSum: number;
  positive: boolean;
  negative: boolean;
};

/** The collector of the quadrature whose integrand is being evaluated now,
 * or `undefined` when no such quadrature asked for one (`nestedErrors`). */
let nestedErrorSink: NestedErrors | undefined;
/** The value of `activeQuadratures` while that integrand is evaluated. An
 * inner quadrature that starts at this count is an integral of the
 * integrand, and reports its result to the sink. A quadrature that starts
 * deeper is computed inside the integrand of an inner one, and is counted in
 * the result of that inner one. */
let nestedErrorDepth = -1;

/** Report the result of an inner quadrature that started when
 * `activeQuadratures` was `depth` (see `nestedErrorDepth`), with the
 * tolerance that it was asked to meet. */
function reportNestedResult(
  depth: number,
  r: { estimate: number; error: number },
  tolerance: number
): void {
  const sink = nestedErrorSink;
  if (sink === undefined || depth !== nestedErrorDepth) return;
  if (!Number.isFinite(r.estimate) || !Number.isFinite(r.error)) return;
  sink.reported = true;
  sink.errors += r.error;
  sink.tolerances += tolerance;
  if (r.estimate !== 0) {
    sink.relativeErrors += r.error / Math.abs(r.estimate);
    sink.relativeTolerances += tolerance / Math.abs(r.estimate);
  }
}

/**
 * Run the quadrature `run` of `f` over `[a, b]`, and add to its error the
 * errors of the integrals computed inside `f` (see `nestedErrors` in
 * `adaptiveQuadrature`).
 *
 * The quadrature sees the error of an inner integral only as noise of its
 * integrand. An inner error that changes little from one node to the next
 * (the inner tolerance is relative, and its error has the same sign at
 * neighboring nodes) looks smooth, and the error of the outer quadrature
 * does not contain it. The added term estimates the integral of the error of
 * the integrand, as `nIntegrateMultiple` (`library/calculus.ts`) does for
 * each level of an iterated integral.
 *
 * The error of a value `v` of the integrand is not known from the errors
 * `e` of its inner integrals `I`: it depends on how `v` changes with `I`. It
 * is taken as the larger of `Σ e` (`v = c ± I`, a change of 1 per unit of
 * `I`) and `|v|·Σ e/|I|` (`v = c·I`, a value proportional to `I`). An
 * integrand that changes faster than these with its inner integrals
 * (`(∫…)²` with `|∫…| > 1/2`) has a larger error.
 *
 * The added term estimates the integral of this error. When the values keep
 * one sign, it is the ratio of the summed errors to the summed magnitudes of
 * the values, times the magnitude of the outer estimate: this ratio does not
 * depend on where the nodes are when the relative error of the values is the
 * same everywhere. The ratio is of the VALUES, not of the inner integrals:
 * for `c − ∫…` with values near 0, the outer estimate is near 0 but the
 * ratio is large. Otherwise it is the mean error of the values times the
 * length of the interval, or nothing when the interval is infinite.
 *
 * The result is `converged` only when it converged, and the added term is
 * not larger than the same term computed from the tolerances that the inner
 * integrals were asked to meet plus the part of `max(atol, rtol·|estimate|)`
 * that the outer error leaves. So an inner result with an error larger than
 * its tolerance (one that did not converge) makes the outer result not
 * converged. An inner tolerance at the scale of the outer one does not: the
 * outer result cannot be more accurate than its integrand, and requiring
 * this would make every integral of an integral not converged.
 */
function withNestedErrors(
  f: (x: number) => number,
  a: number,
  b: number,
  rtol: number,
  atol: number,
  run: (g: (x: number) => number) => AdaptiveQuadratureResult
): AdaptiveQuadratureResult {
  const sink: NestedErrors = {
    errors: 0,
    tolerances: 0,
    relativeErrors: 0,
    relativeTolerances: 0,
    reported: false,
    count: 0,
    errorSum: 0,
    toleranceSum: 0,
    magnitudeSum: 0,
    positive: false,
    negative: false,
  };
  const g = (x: number): number => {
    const previousSink = nestedErrorSink;
    const previousDepth = nestedErrorDepth;
    nestedErrorSink = sink;
    nestedErrorDepth = activeQuadratures;
    sink.errors = sink.tolerances = 0;
    sink.relativeErrors = sink.relativeTolerances = 0;
    sink.reported = false;
    let v: number;
    try {
      v = f(x);
    } finally {
      nestedErrorSink = previousSink;
      nestedErrorDepth = previousDepth;
    }
    if (sink.reported && Number.isFinite(v)) {
      sink.count += 1;
      sink.errorSum += Math.max(sink.errors, Math.abs(v) * sink.relativeErrors);
      sink.toleranceSum += Math.max(
        sink.tolerances,
        Math.abs(v) * sink.relativeTolerances
      );
      sink.magnitudeSum += Math.abs(v);
      if (v > 0) sink.positive = true;
      if (v < 0) sink.negative = true;
    }
    return v;
  };
  const r = run(g);
  if (sink.count === 0 || !Number.isFinite(r.estimate)) return r;
  // The integral of the error of the integrand, from the sum `sum` of the
  // errors of its values.
  const integral = (sum: number): number => {
    if (!(sink.positive && sink.negative) && sink.magnitudeSum > 0)
      return (sum / sink.magnitudeSum) * Math.abs(r.estimate);
    const span = Math.abs(b - a);
    return Number.isFinite(span) ? (sum / sink.count) * span : 0;
  };
  const extra = integral(sink.errorSum);
  if (!(extra > 0)) return r;
  const tolerance = Math.max(atol, rtol * Math.abs(r.estimate));
  return {
    ...r,
    error: r.error + extra,
    converged:
      r.converged &&
      extra <= integral(sink.toleranceSum) + Math.max(0, tolerance - r.error),
  };
}

/** The result of `adaptiveQuadrature`. */
type AdaptiveQuadratureResult = {
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
  /** The integrand is `NaN` on a set that is not some isolated points, and
   * `estimate` and `error` are `NaN`: the integral has no value. A caller
   * must not sample the integrand (Monte Carlo), whose mean is then also
   * `NaN`. See `GaussKronrodOutcome` in `endpoint-quadrature.ts`. */
  nanRegion?: true;
};

/**
 * The integral over `[a, c]` from its integrals over the two halves `[a, b]`
 * and `[b, c]`. Neither half has `nanRegion`: the caller returns such a half
 * directly, since the integral then has no value.
 */
function combineHalves(
  left: AdaptiveQuadratureResult,
  right: AdaptiveQuadratureResult,
  rtol: number,
  atol: number
): AdaptiveQuadratureResult {
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
  // Either half diverging makes the whole integral divergent: a divergent
  // half has no finite value, and the other half cannot cancel it (∞ − ∞ is
  // not a value).
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
}

/**
 * The point of `[lo, hi]` where the integrand `f` is singular, near the
 * panel `site` that the adaptive loop bisected `INTERIOR_SITE_DEPTH` times
 * or more, or `undefined` when that point is not strictly inside
 * `(lo, hi)`.
 *
 * The singular point is in the panel or next to it: in a neighboring panel
 * of the same width when it is a boundary of panels. A golden-section search
 * for the largest `|f|` on the panel and its two neighbors finds it to the
 * spacing of the doubles, since `|f|` grows without bound toward it. A
 * sample that is `NaN` or infinite counts as the largest.
 */
function interiorSingularPoint(
  f: (x: number) => number,
  lo: number,
  hi: number,
  site: { a: number; b: number }
): number | undefined {
  const w = site.b - site.a;
  let a = Math.max(lo, site.a - w);
  let b = Math.min(hi, site.b + w);
  const windowA = a;
  const windowB = b;
  const size = (x: number) => {
    const y = Math.abs(f(x));
    return Number.isNaN(y) ? Number.POSITIVE_INFINITY : y;
  };
  const ratio = (Math.sqrt(5) - 1) / 2;
  let x1 = b - ratio * (b - a);
  let x2 = a + ratio * (b - a);
  let f1 = size(x1);
  let f2 = size(x2);
  // Each step keeps 0.618 of the interval: 200 steps reduce any interval of
  // doubles to its spacing, where `x1` and `x2` stop moving.
  for (let i = 0; i < 200 && a < x1 && x1 < x2 && x2 < b; i++) {
    if (f1 >= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - ratio * (b - a);
      f1 = size(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + ratio * (b - a);
      f2 = size(x2);
    }
  }
  let s = f1 >= f2 ? x1 : x2;
  // The search stops when `x1` and `x2` stop moving, which can be some
  // doubles from the singular point: for `|x − 0.3|^(−1/2)`, it stopped at
  // `0.2999999999999999`, one double below the singular point `0.3`. The
  // half that then held the singular point inside it was 3 doubles wide, its
  // nodes rounded to these doubles, and it reported `2.2e-8 ± 2e-23` for an
  // integral of about `4.5e-8` (the result was `± 6e-13` for a true error of
  // `2.2e-8`). So the point moves to a neighboring double while `|f|` is
  // larger there, at most `SINGULAR_POINT_STEPS` doubles.
  // A neighbor outside `(lo, hi)` is not sampled: the integrand can be
  // singular or not defined at an endpoint and beyond it (`2 − x` on
  // `[1, 1 + 64·ε]` was sampled below 1).
  let fs = size(s);
  let localMaximum = false;
  for (let i = 0; i < SINGULAR_POINT_STEPS && fs < Infinity; i++) {
    const down = nextDouble(s, -1);
    const up = nextDouble(s, 1);
    const fDown = down > lo ? size(down) : Number.NEGATIVE_INFINITY;
    const fUp = up < hi ? size(up) : Number.NEGATIVE_INFINITY;
    if (fDown <= fs && fUp <= fs) {
      localMaximum = true;
      break;
    }
    if (fUp >= fDown) {
      s = up;
      fs = fUp;
    } else {
      s = down;
      fs = fDown;
    }
  }
  // A point at or past an edge of the search window that is not `lo` or
  // `hi`, where `|f|` is finite and still grows (the walk found no local
  // maximum), is not a singular point: `|f|` is monotone across the window.
  // In `(x − e)^(−1/4) + (x − e < 2e-5 ? 10 : 0)` on `[e, e + 1/16]`,
  // `e = 10⁵`, the window around the deep panels at the step ends below the
  // step, where `|f|` grows toward the singular endpoint `e`. The split there
  // left the step `6.3e-8` inside the right half, before its first node, and
  // the result was `± 1.5e-8` for a true error of `6.4e-7`. A pole one double
  // past the edge (`|x − 0.3|^(−1/2)`) ends the walk at `+∞` or at a local
  // maximum.
  const edge = (windowB - windowA) * 2 ** -30;
  if (
    !localMaximum &&
    fs < Infinity &&
    ((windowA > lo && s - windowA <= edge) ||
      (windowB < hi && windowB - s <= edge))
  )
    return undefined;
  return s > lo && s < hi ? s : undefined;
}

/** The largest number of doubles by which `interiorSingularPoint` moves the
 * point found by its search. */
const SINGULAR_POINT_STEPS = 64;

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
 * `NaN`. An integrand that is `NaN` on a set that is not some isolated points
 * (a bisected panel and its two children each have a majority of `NaN`
 * samples), next to finite samples that are not of rounding size, yields a
 * `NaN` estimate and `nanRegion: true` at once, after a few hundred
 * evaluations: the integral has no value. Next to finite samples of rounding
 * size (a tail where the terms of a decreasing integrand overflow, such as
 * `sinh x/cosh² x` for `x > 710`), the `NaN` panels are bisected as other bad
 * panels, and the result does not converge.
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
    /** With `singularEndpoints`, the number of times the interval may still
     * be split at a singularity inside it (default `MAX_INTERIOR_SPLITS`;
     * see `INTERIOR_SITE_DEPTH`). The recursive calls on the two halves
     * pass one less. */
    interiorSplits?: number;
    /** When `true`, the integrand computes integrals of its own (with this
     * function), and the reported error includes an estimate of the
     * integral of their errors (see `withNestedErrors`). Without it, an
     * error of the inner integrals that varies slowly with the variable is
     * not in the reported error. The default is `false`. */
    nestedErrors?: boolean;
  }
): AdaptiveQuadratureResult {
  // An integral computed inside the integrand of a quadrature that collects
  // the errors of its inner integrals reports its result (see
  // `nestedErrorDepth`). It reports once, here: after the parts of a split
  // interval are combined, after the negation of reversed bounds, and after
  // the errors of its own inner integrals are added.
  const entryDepth = activeQuadratures;
  const result =
    options?.nestedErrors === true
      ? withNestedErrors(
          f,
          a,
          b,
          options.rtol ?? 1e-10,
          options.atol ?? 1e-12,
          (g) => quadrature(g, a, b, options)
        )
      : quadrature(f, a, b, options);
  reportNestedResult(
    entryDepth,
    result,
    Math.max(
      options?.atol ?? 1e-12,
      (options?.rtol ?? 1e-10) * Math.abs(result.estimate)
    )
  );
  return result;
}

/** The distance from the split point to the nearest samples that
 * `splitPointIsJump` reads, as a fraction of the interval. */
const SPLIT_PROBE = 2 ** -30;

/** The largest spread of the samples on one side of a jump, as a fraction
 * of the jump (`splitPointIsJump`). */
const SPLIT_FLAT = 2 ** -10;

/** `quadrature` does not split off the part between a split point and an
 * endpoint when that part is at most `OFFSET_SINGULARITY_SPACINGS` doubles
 * wide and at most this fraction of the interval or of
 * `OFFSET_SINGULARITY_SPACINGS` doubles. */
const SLIVER_FRACTION = 2 ** -10;

/**
 * True when the point `s` of `[lo, hi]` found by `interiorSingularPoint` is
 * at a jump of `f`, not at a singularity. The function reads `f` at `s` and
 * at 1, 2, 4 and 8 times `δ = SPLIT_PROBE·(hi − lo)` (at least the spacing
 * of the doubles at `s`) on each side of `s`. It is a jump when the 9
 * values, in the order of their points, are two runs: the values of each
 * run are within `SPLIT_FLAT` times the jump of each other, the jump being
 * the distance between the two runs. The jump can be between any two of the
 * samples.
 *
 * Not a jump:
 * - One level only (the samples agree): there is no evidence of a jump, and
 *   the interval is split as before.
 * - Values that change continuously, as next to a singularity:
 *   `|x − 20|^(−1/2)` on `[20, 20 + 3.4e-13]` read at `s = 20 + 4.6e-14`
 *   changes by a factor 1.5 over the samples on the side of 20, and
 *   `100000 − ln |x − 0.3|` read at `s = 0.3 + 1e-15` has `34.5` above the
 *   constant at `s` and `18` to `20` at the other samples. (A test of the
 *   relative spread of the magnitudes read the first case as a jump, and the
 *   oscillatory integral `∫₀^∞ sin t/√|t − 5| + sin t/√|t − 20| dt` was
 *   `NaN`; it also read the second case as a jump, because the constant
 *   made the relative spread small.)
 * - An oscillation at the scale of `δ`: the runs alternate.
 *
 * What remains relative: `δ` is relative to the interval, and the flatness
 * is relative to the jump, so a singularity that changes the integrand by
 * less than `SPLIT_FLAT` times the jump between `δ` and `8δ` from `s`, next
 * to a jump at `s`, is read as a jump.
 *
 * The samples must be strictly inside `[lo, hi]`: an endpoint of the
 * integral is not sampled, since the integrand can be singular there. When
 * the interval is too narrow for that, the answer is `false`.
 */
export function splitPointIsJump(
  f: (x: number) => number,
  lo: number,
  hi: number,
  s: number
): boolean {
  const delta = Math.max((hi - lo) * SPLIT_PROBE, ulpOf(s));
  if (!(s - 8 * delta > lo && s + 8 * delta < hi)) return false;
  const values = [-8, -4, -2, -1, 0, 1, 2, 4, 8].map((k) => f(s + k * delta));
  if (!values.every((v) => Number.isFinite(v))) return false;
  // The two runs: the values before and after the one change of side.
  for (let cut = 1; cut < values.length; cut++) {
    const left = values.slice(0, cut);
    const right = values.slice(cut);
    const leftMin = Math.min(...left);
    const leftMax = Math.max(...left);
    const rightMin = Math.min(...right);
    const rightMax = Math.max(...right);
    const jump = Math.max(rightMin - leftMax, leftMin - rightMax);
    if (
      jump > 0 &&
      leftMax - leftMin <= SPLIT_FLAT * jump &&
      rightMax - rightMin <= SPLIT_FLAT * jump
    )
      return true;
  }
  return false;
}

/** The quadrature of `adaptiveQuadrature`, without the errors of the inner
 * integrals (`nestedErrors`). */
function quadrature(
  f: (x: number) => number,
  a: number,
  b: number,
  options: Parameters<typeof adaptiveQuadrature>[3]
): AdaptiveQuadratureResult {
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
    const r = quadrature(f, b, a, { ...options, deadline });
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
    const left = quadrature(f, a, 0, halfOptions);
    // A half where the integrand is `NaN` on a set that is not some isolated
    // points makes the whole integral have no value.
    if (left.nanRegion === true) return left;
    const right = quadrature(f, 0, b, halfOptions);
    if (right.nanRegion === true) return right;
    return combineHalves(left, right, rtol, atol);
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
      // The integrand is `NaN` on a set that is not some isolated points:
      // the integral has no value, and there is nothing to extrapolate.
      if (r.nanRegion === true)
        return {
          estimate: NaN,
          error: NaN,
          converged: false,
          divergent: false,
          nanRegion: true as const,
        };
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
      if (options?.singularEndpoints === true) {
        const whole = floored(
          resolveSingularEndpoints(g, lo, hi, r, {
            rtol,
            atol,
            maxEvaluations: 2 * maxIntervals,
            deadline,
          })
        );
        // The refinement went deep at a point inside the interval (see
        // `INTERIOR_SITE_DEPTH`): the interval is split there, so that the
        // singularity is at an endpoint of each half, where the endpoint
        // analysis reads it. Each half gets half the panel budget, as for
        // the split of `(−∞, ∞)` above. The split result is kept, except
        // when the whole interval converged and the split did not converge,
        // was not extrapolated, did not diverge and does not oscillate. A
        // divergent or oscillating split is kept in every case: it is what
        // the whole interval could not see. A whole result that was only
        // extrapolated is not kept against the split: its extrapolation
        // corrects the endpoints, not the site inside the interval.
        const splits = options.interiorSplits ?? MAX_INTERIOR_SPLITS;
        if (whole.divergent || r.interiorSite === undefined || splits <= 0)
          return whole;
        const s = interiorSingularPoint(g, lo, hi, r.interiorSite);
        if (s === undefined) return whole;
        // The refinement also goes deep at a jump, and the search then finds
        // a point of the larger side, near the jump. The interval is not
        // split there. The endpoint analysis of a half reads the jump next
        // to its endpoint as a singularity and extrapolates the shells: for
        // `x < 1000.3 ? 1000 : −3` on `[1000, 1001]`, the split points were
        // `1.3e-10` from the jump and the result was `± 1.4e-11` for a true
        // error of `1.3e-7`; the whole interval had `± 1.6e-8` for a true
        // error of `2e-9`. A half also reported `0 ± 0` when the jump was
        // between the split point and its nearest node: for
        // `1/max(0.001, √(x² + y²) − 1)`, cut to 0 at `x = −√(1 − y²)`, on
        // `[−10, 10]` with `y = 0.374625`, the split point was `2.4e-12`
        // from the jump, and the result was `± 7.9e-12` for a true error of
        // `2.4e-9`.
        if (splitPointIsJump(g, lo, hi, s)) return whole;
        // A singular point some doubles from an endpoint: the part between
        // them cannot be integrated, and the test of a singularity inside
        // an endpoint (`offsetSingularity`, `endpoint-quadrature.ts`) has
        // added its area to the error of the whole interval. Split, the
        // narrow part was 2 doubles wide for `|t − c|^(−1/2)` on `[0.3, 1]`
        // with `c` 2 doubles above 0.3, and the result was `± 4e-13` for a
        // true error of `6e-9`.
        // The part must also be a small fraction of the interval, or hold
        // few doubles (`SLIVER_FRACTION` of each): on a narrow interval,
        // every point is within `OFFSET_SINGULARITY_SPACINGS` doubles of an
        // endpoint. For `|x − c|^(−1/2)` with `c` the midpoint of
        // `[1, 1 + 2⁻³²]`, each half holds 2¹⁹ doubles, and without this
        // the interval was not split and the error was `+∞`. A part of at
        // most 2¹⁰ doubles is not split off on any interval: the nodes of
        // its panels are some doubles apart.
        const sliver = (e: number) =>
          SLIVER_FRACTION *
          Math.max(hi - lo, OFFSET_SINGULARITY_SPACINGS * ulpOf(e));
        if (
          (s - lo <= OFFSET_SINGULARITY_SPACINGS * ulpOf(lo) &&
            s - lo <= sliver(lo)) ||
          (hi - s <= OFFSET_SINGULARITY_SPACINGS * ulpOf(hi) &&
            hi - s <= sliver(hi))
        )
          return whole;
        const halfOptions = {
          rtol,
          atol,
          maxIntervals: Math.ceil(maxIntervals / 2),
          initialPanels,
          deadline,
          singularEndpoints: true,
          interiorSplits: splits - 1,
        };
        const left = quadrature(g, lo, s, halfOptions);
        if (left.nanRegion === true) return left;
        const right = quadrature(g, s, hi, halfOptions);
        if (right.nanRegion === true) return right;
        const split = combineHalves(left, right, rtol, atol);
        if (
          whole.converged &&
          !split.converged &&
          split.extrapolated !== true &&
          !split.divergent &&
          split.oscillates !== true
        )
          return whole;
        return split;
      }
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
