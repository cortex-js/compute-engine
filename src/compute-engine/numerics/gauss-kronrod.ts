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

/**
 * Adaptive GK15 over a finite interval `[a, b]`.
 */
function adaptiveFinite(
  f: (x: number) => number,
  a: number,
  b: number,
  rtol: number,
  atol: number,
  maxIntervals: number
): { estimate: number; error: number; converged: boolean } {
  const first = gk15(f, a, b);
  const panels: Panel[] = [first];
  let totalValue = first.value;
  let totalError = first.error;
  let roundoffStop = false;

  const tolerance = () => Math.max(atol, rtol * Math.abs(totalValue));

  while (panels.length < maxIntervals) {
    if (Number.isFinite(totalError) && totalError <= tolerance()) break;

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

    totalValue += left.value + right.value - iv.value;
    totalError += left.error + right.error - iv.error;

    panels[worst] = left;
    panels.push(right);
  }

  const converged =
    !roundoffStop &&
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
 *
 * Returns the `estimate`, an error `error` bound, and whether the requested
 * tolerance was met (`converged`). Infinite bounds are handled by variable
 * transform; `a === b` is 0; `a > b` negates the swapped result; a `NaN` bound
 * yields a non-converged `NaN` estimate.
 */
export function adaptiveQuadrature(
  f: (x: number) => number,
  a: number,
  b: number,
  options?: { rtol?: number; atol?: number; maxIntervals?: number }
): { estimate: number; error: number; converged: boolean } {
  const rtol = options?.rtol ?? 1e-10;
  const atol = options?.atol ?? 1e-12;
  const maxIntervals = options?.maxIntervals ?? 1500;

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
    // (-∞, ∞): x = t/(1 - t²), t ∈ (-1, 1). dx = (1 + t²)/(1 - t²)² dt.
    g = (t) => {
      const om = 1 - t * t;
      return (f(t / om) * (1 + t * t)) / (om * om);
    };
    lo = -1;
    hi = 1;
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

  return adaptiveFinite(g, lo, hi, rtol, atol, maxIntervals);
}
