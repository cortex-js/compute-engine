// Shared helpers for the worker benchmarks. Imports the engine from source
// through tsx; worker threads inherit the tsx loader from the main thread.
export const CE_SRC = new URL('../../src/compute-engine.ts', import.meta.url).href;
export const INTERVAL_SRC = new URL('../../src/compute-engine/interval/index.ts', import.meta.url).href;
export const RUNTIME_SRC = new URL('../../src/compute-engine/compilation/javascript-runtime.ts', import.meta.url).href;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
export function timeIt(fn: () => unknown, reps: number): number {
  fn(); // warm-up
  const t: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  return median(t);
}
export function ms(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
}
/** Tycho row 404 model: a cos(bx + c) + dx + e. Data of N points, with noise. */
export function makeData(n: number, seed = 1): { xs: number[]; ys: number[] } {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(1, n - 1)) * 12;
    xs.push(x);
    ys.push(1.5 * Math.cos(2.17 * x + 0.4) + 0.1 * x + Math.E + (rnd() - 0.5) * 0.2);
  }
  return { xs, ys };
}
export const TYCHO = { xs: [1, 3.22, 5.27, 10.49, 7.12], ys: [4.3, 1.18, 0.01, 1.48, 3.44] };
export const MODEL = ['Add', ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]], ['Multiply', 'd', 'x'], 'ExponentialE'];
export const PARAMS = ['List', 'a', 'b', 'c', 'd'];
export function fitCall(xs: number[], ys: number[], options?: unknown, params: unknown = PARAMS): unknown[] {
  return ['FindFit', ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])], MODEL, params, ['List', 'x'], ...(options === undefined ? [] : [options])];
}
