import { checkDeadline } from '../../common/interruptible';

export type RK4Options = {
  steps: number;
  deadline?: number;
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
