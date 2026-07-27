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
}

/**
 * Apply the GK15 rule to a single finite panel `[a, b]`.
 * Returns the 15-point estimate and a QUADPACK-style error estimate.
 */
function gk15(f: (x: number) => number, a: number, b: number): Panel {
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
 * Adaptive GK15 over a finite interval `[a, b]`.
 */
function adaptiveFinite(
  f: (x: number) => number,
  a: number,
  b: number,
  rtol: number,
  atol: number,
  maxIntervals: number,
  initialPanels: number
): { estimate: number; error: number; converged: boolean } {
  const panels: Panel[] = [];

  // Incremental accumulators. A non-finite panel contribution must NOT enter
  // the running totals: subtracting a stale `NaN`/`±∞` parent when it is later
  // subdivided into finite children would leave the totals poisoned forever
  // (removable singularity at a node — see `panelIsBad`). Instead, bad panels
  // add 0 to `totalValue`/`totalError` and are tallied in `badPanels`, which
  // gates convergence until every one has been subdivided away.
  let totalValue = 0;
  let totalError = 0;
  let badPanels = 0;
  let roundoffStop = false;

  // Fold a panel into the running totals, skipping non-finite contributions.
  const addPanel = (p: Panel) => {
    if (Number.isFinite(p.value)) totalValue += p.value;
    if (Number.isFinite(p.error)) totalError += p.error;
    if (panelIsBad(p)) badPanels += 1;
  };
  const removePanel = (p: Panel) => {
    if (Number.isFinite(p.value)) totalValue -= p.value;
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

  const tolerance = () => Math.max(atol, rtol * Math.abs(totalValue));

  while (panels.length < maxIntervals) {
    if (badPanels === 0 && totalError <= tolerance()) break;

    // Pick the panel with the largest (or non-finite) error.
    let worst = 0;
    for (let i = 1; i < panels.length; i++)
      if (errorKey(panels[i].error) > errorKey(panels[worst].error)) worst = i;

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

    removePanel(iv);
    addPanel(left);
    addPanel(right);

    panels[worst] = left;
    panels.push(right);
  }

  const converged =
    !roundoffStop &&
    badPanels === 0 &&
    Number.isFinite(totalValue) &&
    Number.isFinite(totalError) &&
    totalError <= tolerance();

  return { estimate: totalValue, error: totalError, converged };
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
 * Returns the `estimate`, an error `error` bound, and whether the requested
 * tolerance was met (`converged`). Semi-infinite bounds are handled by a
 * variable transform; the doubly-infinite case `(-∞, ∞)` is split at 0 into two
 * semi-infinite integrals (so a divergent half is detected instead of masked by
 * symmetric cancellation of an odd integrand), each half receiving half the
 * panel budget and the combined result re-checked against the tolerance;
 * `a === b` is 0; `a > b` negates the swapped result; a `NaN` bound yields a
 * non-converged `NaN` estimate.
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
  }
): { estimate: number; error: number; converged: boolean } {
  const rtol = options?.rtol ?? 1e-10;
  const atol = options?.atol ?? 1e-12;
  const maxIntervals = options?.maxIntervals ?? 1500;
  const initialPanels = options?.initialPanels ?? INITIAL_PANELS;

  if (Number.isNaN(a) || Number.isNaN(b))
    return { estimate: NaN, error: NaN, converged: false };

  if (a === b) return { estimate: 0, error: 0, converged: true };

  if (a > b) {
    const r = adaptiveQuadrature(f, b, a, options);
    return { estimate: -r.estimate, error: r.error, converged: r.converged };
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
    return { estimate, error, converged };
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

  return adaptiveFinite(g, lo, hi, rtol, atol, maxIntervals, initialPanels);
}
