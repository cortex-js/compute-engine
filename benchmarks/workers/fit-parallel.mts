// Worker-thread benchmarks for the kernel-pool design
// (docs/plans/2026-10-20-worker-kernel-pool.md). Run each file on a quiet
// machine under the shared-box lock:
//   npx tsx benchmarks/workers/<file>.mts
// Worker threads inherit the tsx loader, so the workers import the engine from
// source too. The results of 2026-10-20 are in the design document.
// Whole-engine-in-a-worker emulation of a parallel global fit: K workers each
// boot an engine and run FindFit with a K-th of the global range of b; the
// main thread keeps the lowest residual. Each worker still runs the full
// 24-point multi-start grid over its sub-range, so K workers do K times the
// starts of the serial call: the table reports wall time and throughput.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CE_SRC, TYCHO, makeData, fitCall, median, ms } from './common.mts';
if (isMainThread) {
  const { ComputeEngine } = await import(CE_SRC);
  const ce = new ComputeEngine();
  const K = [1, 2, 4, 8];
  const t0b = performance.now();
  const pool = await Promise.all(Array.from({ length: Math.max(...K) }, () => new Promise<Worker>((res) => {
    const w = new Worker(new URL(import.meta.url), { workerData: {} });
    w.once('message', () => res(w));
  })));
  console.log(`boot of ${pool.length} engine workers (parallel): ${ms(performance.now() - t0b)} ms`);
  console.log('rows | serial full range ms (iters) | ' + K.map((k) => `${k} workers ms (total iters)`).join(' | ') + ' | throughput gain at best K');
  for (const [label, data] of [['Tycho 5', TYCHO], ['1000', makeData(1000)], ['10000', makeData(10000)]] as const) {
    const full = { dict: { global: { dict: { b: [0.1, 6] } } } };
    const expr = ce.box(fitCall(data.xs, data.ys, full) as any);
    let rec: any;
    const reps = data.xs.length >= 10000 ? 3 : 5;
    const tSerial = median(Array.from({ length: reps }, () => { const t0 = performance.now(); rec = expr.evaluate(); return performance.now() - t0; }));
    const itSerial = rec.get('iterations').re;
    const cells: string[] = [];
    let bestGain = 0;
    for (const k of K) {
      const ts: number[] = []; let iters = 0;
      for (let rep = 0; rep < reps; rep++) {
        const t0 = performance.now();
        const results = await Promise.all(pool.slice(0, k).map((w, j) => new Promise<{ rss: number; iterations: number }>((res) => {
          const lo = 0.1 + (5.9 * j) / k, hi = 0.1 + (5.9 * (j + 1)) / k;
          w.once('message', res);
          w.postMessage({ call: fitCall(data.xs, data.ys, { dict: { global: { dict: { b: [lo, hi] } } } }) });
        })));
        iters = results.reduce((s, r) => s + r.iterations, 0);
        ts.push(performance.now() - t0);
      }
      const t = median(ts);
      const gain = (iters / t) / (itSerial / tSerial);
      bestGain = Math.max(bestGain, gain);
      cells.push(`${ms(t)} (${iters})`);
    }
    console.log(`${label} | ${ms(tSerial)} (${itSerial}) | ${cells.join(' | ')} | ${bestGain.toFixed(2)}x`);
  }
  for (const w of pool) w.terminate();
} else {
  const { ComputeEngine } = await import(CE_SRC);
  const ce = new ComputeEngine();
  parentPort!.postMessage('ready');
  parentPort!.on('message', (job: { call: unknown[] }) => {
    const rec: any = ce.box(job.call as any).evaluate();
    parentPort!.postMessage({ rss: rec.get('residualNorm')?.re ?? NaN, iterations: rec.get('iterations')?.re ?? 0 });
  });
}
