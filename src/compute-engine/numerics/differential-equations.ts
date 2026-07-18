import { checkDeadline } from '../../common/interruptible.js';

export type RK4Options = {
  steps: number;
  deadline?: number;
};

export type RK45Options = {
  /** Relative error tolerance per step (default 1e-11). */
  rtol?: number;
  /** Absolute error tolerance per step (default 1e-13). */
  atol?: number;
  /** Cap on accepted+rejected integration steps (default 10 000). */
  maxSteps?: number;
  deadline?: number;
};

/**
 * Dense-output representation of one accepted RK45 step: the quartic
 * continuous extension over `[x, x + h]`, in the nested (Horner-like) form
 * used by Hairer's DOPRI5 (`rcont1..rcont5`):
 *
 *   y(x + θh) = r1 + θ·(r2 + (1−θ)·(r3 + θ·(r4 + (1−θ)·r5)))
 */
export type RK45DenseStep = {
  readonly x: number;
  readonly h: number;
  readonly r1: readonly number[];
  readonly r2: readonly number[];
  readonly r3: readonly number[];
  readonly r4: readonly number[];
  readonly r5: readonly number[];
};

export type RK45Solution = {
  /** Accepted-step dense intervals, in integration order. */
  readonly steps: readonly RK45DenseStep[];
  readonly x0: number;
  readonly x1: number;
  /** State at `x1`. */
  readonly y1: readonly number[];
};

export type ODESample = readonly [x: number, y: number];
export type ODEVectorSample = readonly [x: number, y: readonly number[]];

/**
 * Fixed-step classical fourth-order Runge-Kutta solver for scalar explicit
 * initial value problems: y' = f(x, y), y(x0) = y0.
 */
export function rk4(
  f: (x: number, y: number) => number,
  x0: number,
  y0: number,
  x1: number,
  options: RK4Options
): ODESample[] | undefined {
  const steps = Math.trunc(options.steps);
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isInteger(steps) ||
    steps <= 0
  )
    return undefined;

  const h = (x1 - x0) / steps;
  const samples: ODESample[] = [[x0, y0]];
  let x = x0;
  let y = y0;

  for (let i = 0; i < steps; i++) {
    if ((i & 0xff) === 0) checkDeadline(options.deadline);

    const k1 = f(x, y);
    const k2 = f(x + h / 2, y + (h * k1) / 2);
    const k3 = f(x + h / 2, y + (h * k2) / 2);
    const k4 = f(x + h, y + h * k3);
    if (![k1, k2, k3, k4].every(Number.isFinite)) return undefined;

    y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    x = i === steps - 1 ? x1 : x + h;
    if (!Number.isFinite(y)) return undefined;
    samples.push([x, y]);
  }

  return samples;
}

/**
 * Fixed-step classical fourth-order Runge-Kutta solver for first-order systems:
 * y' = f(x, y), y(x0) = y0.
 */
export function rk4System(
  f: (x: number, y: readonly number[]) => readonly number[] | undefined,
  x0: number,
  y0: readonly number[],
  x1: number,
  options: RK4Options
): ODEVectorSample[] | undefined {
  const steps = Math.trunc(options.steps);
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(x1) ||
    !Number.isInteger(steps) ||
    steps <= 0 ||
    y0.length === 0 ||
    !y0.every(Number.isFinite)
  )
    return undefined;

  const addScaled = (
    y: readonly number[],
    dy: readonly number[],
    scale: number
  ): number[] => y.map((yi, i) => yi + scale * dy[i]);

  const combine = (
    y: readonly number[],
    k1: readonly number[],
    k2: readonly number[],
    k3: readonly number[],
    k4: readonly number[],
    h: number
  ): number[] =>
    y.map((yi, i) => yi + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));

  const h = (x1 - x0) / steps;
  const samples: ODEVectorSample[] = [[x0, [...y0]]];
  let x = x0;
  let y = [...y0];

  for (let i = 0; i < steps; i++) {
    if ((i & 0xff) === 0) checkDeadline(options.deadline);

    const k1 = f(x, y);
    if (!k1 || k1.length !== y.length || !k1.every(Number.isFinite))
      return undefined;
    const k2 = f(x + h / 2, addScaled(y, k1, h / 2));
    if (!k2 || k2.length !== y.length || !k2.every(Number.isFinite))
      return undefined;
    const k3 = f(x + h / 2, addScaled(y, k2, h / 2));
    if (!k3 || k3.length !== y.length || !k3.every(Number.isFinite))
      return undefined;
    const k4 = f(x + h, addScaled(y, k3, h));
    if (!k4 || k4.length !== y.length || !k4.every(Number.isFinite))
      return undefined;

    y = combine(y, k1, k2, k3, k4, h);
    x = i === steps - 1 ? x1 : x + h;
    if (!y.every(Number.isFinite)) return undefined;
    samples.push([x, [...y]]);
  }

  return samples;
}

// Dormand–Prince 5(4) tableau (DOPRI5). The 5th-order weights are the last
// stage row (FSAL: k7 = f(x+h, y5) is reused as the next step's k1); the
// error estimate is the difference against the embedded 4th-order weights.
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1] as const;
const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
] as const;
// b5 (solution weights) equal the last A row; b4 are the embedded weights.
const DP_E = [
  35 / 384 - 5179 / 57600,
  0,
  500 / 1113 - 7571 / 16695,
  125 / 192 - 393 / 640,
  -2187 / 6784 - -92097 / 339200,
  11 / 84 - 187 / 2100,
  -1 / 40,
] as const;
// Dense-output coefficients (Hairer, Nørsett & Wanner DOPRI5 `d1..d7`).
const DP_D = [
  -12715105075 / 11282082432,
  0,
  87487479700 / 32700410799,
  -10690763975 / 1880347072,
  701980252875 / 199316789632,
  -1453857185 / 822651844,
  69997945 / 29380423,
] as const;

/**
 * Adaptive Dormand–Prince 5(4) solver for first-order systems
 * `y' = f(x, y)`, `y(x0) = y0`, integrating from `x0` to `x1` (either
 * direction). Step size is controlled to the per-step tolerance
 * `atol + rtol·max(|y|)` (RMS norm over components); each accepted step
 * records its quartic dense-output interpolant, so the solution can be
 * sampled anywhere in `[x0, x1]` at the integration accuracy via
 * `rk45Sample`.
 *
 * Returns `undefined` on a non-finite derivative, step-size underflow
 * (e.g. approaching a blow-up), or the step cap — the caller should stay
 * inert rather than return inaccurate values.
 */
export function rk45System(
  f: (x: number, y: readonly number[]) => readonly number[] | undefined,
  x0: number,
  y0: readonly number[],
  x1: number,
  options?: RK45Options
): RK45Solution | undefined {
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(x1) ||
    y0.length === 0 ||
    !y0.every(Number.isFinite)
  )
    return undefined;

  const rtol = options?.rtol ?? 1e-11;
  const atol = options?.atol ?? 1e-13;
  const maxSteps = options?.maxSteps ?? 10_000;
  const deadline = options?.deadline;

  const n = y0.length;
  const dir = x1 >= x0 ? 1 : -1;
  const span = Math.abs(x1 - x0);
  if (span === 0) return { steps: [], x0, x1, y1: [...y0] };

  let x = x0;
  let y = [...y0];
  let k1 = f(x, y);
  if (!k1 || k1.length !== n || !k1.every(Number.isFinite)) return undefined;

  // Initial step: a conservative fraction of the span, bounded away from 0.
  let h = dir * Math.min(span / 100, Math.max(span * 1e-6, 1e-6));

  const steps: RK45DenseStep[] = [];
  const k: number[][] = Array.from({ length: 7 }, () => new Array(n));
  k[0] = [...k1];

  for (let iter = 0; iter < maxSteps; iter++) {
    if ((iter & 0x3f) === 0) checkDeadline(deadline);

    // Don't overshoot the endpoint.
    if (Math.abs(h) > Math.abs(x1 - x)) h = x1 - x;
    // Step-size underflow: the error control cannot meet the tolerance.
    if (Math.abs(h) <= Math.abs(x) * Number.EPSILON * 4 || h === 0)
      return undefined;

    // Stages 2..7 (k[0] carries over via FSAL).
    let failed = false;
    for (let s = 1; s < 7; s++) {
      const ys = new Array<number>(n);
      const a = DP_A[s];
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < s; j++) acc += a[j] * k[j][i];
        ys[i] = y[i] + h * acc;
      }
      const ks = f(x + DP_C[s] * h, ys);
      if (!ks || ks.length !== n || !ks.every(Number.isFinite)) {
        failed = true;
        break;
      }
      k[s] = [...ks];
    }

    let err = 0;
    const y1v = new Array<number>(n);
    if (!failed) {
      // 5th-order solution (weights = last A row) and embedded error.
      const b = DP_A[6];
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < 6; j++) acc += b[j] * k[j][i];
        y1v[i] = y[i] + h * acc;
      }
      for (let i = 0; i < n; i++) {
        let e = 0;
        for (let j = 0; j < 7; j++) e += DP_E[j] * k[j][i];
        e *= h;
        const scale = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y1v[i]));
        err += (e / scale) ** 2;
      }
      err = Math.sqrt(err / n);
      if (!Number.isFinite(err) || !y1v.every(Number.isFinite)) failed = true;
    }

    if (failed) {
      // A non-finite stage: retreat and try a much smaller step.
      h *= 0.25;
      continue;
    }

    if (err <= 1) {
      // Accept: record the dense-output interpolant for [x, x+h].
      const r1 = [...y];
      const r2 = new Array<number>(n);
      const r3 = new Array<number>(n);
      const r4 = new Array<number>(n);
      const r5 = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const dy = y1v[i] - y[i];
        const bspl = h * k[0][i] - dy;
        r2[i] = dy;
        r3[i] = bspl;
        r4[i] = dy - h * k[6][i] - bspl;
        let acc = 0;
        for (let j = 0; j < 7; j++) acc += DP_D[j] * k[j][i];
        r5[i] = h * acc;
      }
      steps.push({ x, h, r1, r2, r3, r4, r5 });

      x = x + h;
      y = y1v;
      k[0] = [...k[6]]; // FSAL

      if (x === x1 || Math.abs(x1 - x) <= Math.abs(x1) * Number.EPSILON * 4)
        return { steps, x0, x1, y1: y };
    }

    // PI-free elementary controller with the customary safety clamp.
    const factor = Math.min(
      5,
      Math.max(0.2, 0.9 * (err > 0 ? err ** -0.2 : 5))
    );
    h *= factor;
  }

  return undefined;
}

/** Evaluate an `rk45System` solution at `x` via its dense output. */
export function rk45Sample(
  solution: RK45Solution,
  x: number
): readonly number[] {
  const steps = solution.steps;
  if (steps.length === 0) return solution.y1;
  // Binary search for the interval containing x (intervals are ordered in
  // integration direction).
  const dir = solution.x1 >= solution.x0 ? 1 : -1;
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const end = steps[mid].x + steps[mid].h;
    if (dir * (x - end) > 0) lo = mid + 1;
    else hi = mid;
  }
  const s = steps[lo];
  const theta = s.h === 0 ? 0 : (x - s.x) / s.h;
  const t = Math.min(1, Math.max(0, theta));
  const t1 = 1 - t;
  return s.r1.map(
    (r1i, i) =>
      r1i + t * (s.r2[i] + t1 * (s.r3[i] + t * (s.r4[i] + t1 * s.r5[i])))
  );
}
