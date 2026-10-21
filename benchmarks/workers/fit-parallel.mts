// Worker-thread benchmarks for the kernel-pool design
// (docs/plans/2026-10-20-worker-kernel-pool.md). Run each file on a quiet
// machine under the shared-box lock:
//   npx tsx benchmarks/workers/<file>.mts
// Worker threads inherit the tsx loader, so the workers import the engine from
// source too. The results of 2026-10-20 are in the design document.
//
// The global search of `FindFit` on the kernel pool
// (docs/plans/2026-10-20-findfit-global-grid.md, section 4): each case runs
// through `evaluate()` on an engine with no pool, and through
// `evaluateAsync()` on engines whose pool has 1, 4 and 8 workers (the
// separable scan runs on the workers, the solver runs on this thread). The
// table gives the median wall time of one call, in ms, and whether every
// pooled record is the record of `evaluate()`. The cases are Tycho's
// deciding cases of row 407 (200 rows), its five-point control, and the
// 1,000-row case over b in [0.3, 628] (target: under 250 ms with 8 workers).
// The time includes the setup of each call (data, differentiation,
// compilation) and, on the pool, the transfer of the rows to each worker.
import { Worker } from 'node:worker_threads';
import { loadavg } from 'node:os';
import { CE_SRC, TYCHO, MODEL, PARAMS, median, ms } from './common.mts';

const { ComputeEngine, createKernelPool } = await import(CE_SRC);
const WORKER = new URL('../../src/kernel-worker.ts', import.meta.url);

/** `n` points evenly spaced on `[0, 10]`, with no noise, from `a = 2`,
 * `b`, `c = 0.5`, `d = 0.1`: the data of Tycho's instrument. */
function dense(n: number, b: number): { xs: number[]; ys: number[] } {
  const xs = Array.from({ length: n }, (_, i) => (10 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(b * x + 0.5) + 0.1 * x + Math.E);
  return { xs, ys };
}
const call = (
  { xs, ys }: { xs: number[]; ys: number[] },
  ranges: Record<string, number[]>
): unknown[] => [
  'FindFit',
  ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
  MODEL,
  PARAMS,
  ['List', 'x'],
  { dict: { global: { dict: ranges } } },
];
const HI_200 = (2 * Math.PI) / (10 / 199);
const C = [0, 2 * Math.PI];
const cases: [string, unknown[]][] = [
  ['200 rows, b = 2.2, [0.3, 2π/gap]', call(dense(200, 2.2), { b: [0.3, HI_200], c: C })],
  ['200 rows, b = 50, [0.3, 2π/gap]', call(dense(200, 50), { b: [0.3, HI_200], c: C })],
  ['200 rows, b = 2.2, [0.3, 120]', call(dense(200, 2.2), { b: [0.3, 120], c: C })],
  ['200 rows, b = 2.2, [0.3, 60]', call(dense(200, 2.2), { b: [0.3, 60], c: C })],
  ['5 rows (5hn1azxfc8), [0.1, 6]', call(TYCHO, { b: [0.1, 6] })],
  ['1,000 rows, b = 2.2, [0.3, 628]', call(dense(1000, 2.2), { b: [0.3, 628], c: C })],
];

const load = () => loadavg().map((x) => x.toFixed(1)).join(' / ');
console.log(`load average at start: ${load()}`);

const SIZES = [1, 4, 8];
const pools = SIZES.map((size) =>
  createKernelPool({ create: () => new Worker(WORKER), size })
);
const t0 = performance.now();
await Promise.all(pools.map((p) => p.prewarm()));
console.log(`start-up of ${SIZES.reduce((a, b) => a + b, 0)} workers: ${ms(performance.now() - t0)} ms`);
const plain = new ComputeEngine();
const pooled = pools.map((workers) => new ComputeEngine({ workers }));

const REPS = 7;
console.log(`case | evaluate | ${SIZES.map((k) => `evaluateAsync, ${k} worker${k > 1 ? 's' : ''}`).join(' | ')} | same record`);
for (const [label, c] of cases) {
  const expr = plain.box(c as any);
  let reference = '';
  const times = (run: () => unknown) => {
    const t: number[] = [];
    for (let i = 0; i < REPS; i++) {
      const s = performance.now();
      run();
      t.push(performance.now() - s);
    }
    return t;
  };
  reference = expr.evaluate().toString(); // warm-up
  const serial = median(times(() => expr.evaluate()));
  const cells: string[] = [];
  let same = true;
  for (const ce of pooled) {
    const e = ce.box(c as any);
    same &&= (await e.evaluateAsync()).toString() === reference; // warm-up
    const t: number[] = [];
    for (let i = 0; i < REPS; i++) {
      const s = performance.now();
      const rec = await e.evaluateAsync();
      t.push(performance.now() - s);
      same &&= rec.toString() === reference;
    }
    cells.push(ms(median(t)));
  }
  console.log(`${label} | ${ms(serial)} | ${cells.join(' | ')} | ${same ? 'yes' : 'NO'}`);
}
console.log(`load average at end: ${load()}`);
for (const p of pools) p.dispose();
