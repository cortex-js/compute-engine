// Worker-thread benchmarks for the kernel-pool design
// (docs/plans/2026-10-20-worker-kernel-pool.md). Run each file on a quiet
// machine under the shared-box lock:
//   npx tsx benchmarks/workers/<file>.mts
// Worker threads inherit the tsx loader, so the workers import the engine from
// source too. The results of 2026-10-20 are in the design document.
// Worker start-up and message costs: time until a worker that imports (a) the
// interval library, (b) the compiled-code runtime, (c) the whole engine from
// source, (d) the whole engine from the built bundle, reports ready; then the
// round-trip of a Float64Array by copy and by transfer.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { INTERVAL_SRC, RUNTIME_SRC, CE_SRC, median, ms } from './common.mts';
const DIST = new URL('../../dist/esm-min/compute-engine.js', import.meta.url).href;
if (isMainThread) {
  const spawn = (what: string) => new Promise<number>((res, rej) => {
    const t0 = performance.now();
    const w = new Worker(new URL(import.meta.url), { workerData: { what } });
    w.once('message', () => { res(performance.now() - t0); w.terminate(); });
    w.once('error', rej);
  });
  for (const what of ['nothing', 'interval', 'runtime', 'engine-src', 'engine-dist']) {
    const ts: number[] = [];
    for (let i = 0; i < 3; i++) ts.push(await spawn(what));
    console.log(`spawn + import ${what}: median ${ms(median(ts))} ms (${ts.map(ms).join(', ')})`);
  }
  // Round trips through a persistent echo worker.
  const w = new Worker(new URL(import.meta.url), { workerData: { what: 'echo' } });
  await new Promise((r) => w.once('message', r));
  for (const n of [1e4, 1e5, 1e6]) for (const transfer of [false, true]) {
    const ts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = new Float64Array(n);
      const t0 = performance.now();
      const p = new Promise((r) => w.once('message', r));
      if (transfer) w.postMessage(a, [a.buffer]); else w.postMessage(a);
      await p;
      ts.push(performance.now() - t0);
    }
    console.log(`round trip Float64Array(${n}) ${transfer ? 'transfer' : 'copy'}: median ${ms(median(ts))} ms`);
  }
  w.terminate();
} else {
  const what = workerData.what as string;
  if (what === 'interval') await import(INTERVAL_SRC);
  else if (what === 'runtime') { const m = await import(RUNTIME_SRC); m.createJavaScriptRuntime({}); }
  else if (what === 'engine-src') { const m = await import(CE_SRC); const ce = new m.ComputeEngine(); m.compile(ce.parse('x^2+1')); }
  else if (what === 'engine-dist') { const m = await import(DIST); const ce = new m.ComputeEngine(); m.compile(ce.parse('x^2+1')); }
  parentPort!.postMessage('ready');
  if (what === 'echo') parentPort!.on('message', (a: Float64Array) => parentPort!.postMessage(a, [a.buffer]));
}
