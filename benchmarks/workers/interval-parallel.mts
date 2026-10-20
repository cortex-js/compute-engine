// Worker-thread benchmarks for the kernel-pool design
// (docs/plans/2026-10-20-worker-kernel-pool.md). Run each file on a quiet
// machine under the shared-box lock:
//   npx tsx benchmarks/workers/<file>.mts
// Worker threads inherit the tsx loader, so the workers import the engine from
// source too. The results of 2026-10-20 are in the design document.
// Evaluate a compiled interval-js function over an array of input intervals:
// serial on the main thread, then split over K persistent workers that
// rebuild the function from its code text with the interval library.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CE_SRC, INTERVAL_SRC, median, ms } from './common.mts';
const KIND = { interval: 0, empty: 1, entire: 2, singular: 3, partial: 4 } as Record<string, number>;

/** Build the callable from the compile result's text, as a worker would. */
function build(IA: unknown, code: string, preamble: string | undefined, vars: string[]) {
  // Inputs arrive as flat Float64Array lo/hi pairs per variable; outputs as
  // (lo, hi, kind) triples.
  const fn = new Function('_IA', '_', `${preamble ?? ''}; return ${code};`) as (ia: unknown, v: Record<string, { lo: number; hi: number }>) => any;
  return (inputs: Float64Array[], out: Float64Array, from: number, to: number) => {
    const v: Record<string, { lo: number; hi: number }> = {};
    for (const name of vars) v[name] = { lo: 0, hi: 0 };
    for (let i = from; i < to; i++) {
      for (let k = 0; k < vars.length; k++) { v[vars[k]].lo = inputs[k][2 * i]; v[vars[k]].hi = inputs[k][2 * i + 1]; }
      const r = fn(IA, v);
      const o = 3 * (i - from);
      out[o] = r.value?.lo ?? NaN; out[o + 1] = r.value?.hi ?? NaN; out[o + 2] = KIND[r.kind] ?? 9;
    }
  };
}

if (isMainThread) {
  const { ComputeEngine, compile } = await import(CE_SRC);
  const { IntervalArithmetic } = await import(INTERVAL_SRC);
  const ce = new ComputeEngine();
  const cases: [string, string, string[], number][] = [
    ['1D cheap, 2000 columns', '\\sin(x)/x', ['x'], 2000],
    ['1D medium, 2000 columns', '\\sin(x^2)+\\cos(3x)/(1+x^2)', ['x'], 2000],
    ['1D medium, 200k cells', '\\sin(x^2)+\\cos(3x)/(1+x^2)', ['x'], 200_000],
    ['2D implicit, 512x512 cells', '\\sin(x)\\cos(y)+x^2-y^2-0.3', ['x', 'y'], 512 * 512],
    ['2D implicit, 1024x1024 cells', '\\sin(x)\\cos(y)+x^2-y^2-0.3', ['x', 'y'], 1024 * 1024],
  ];
  const K = [1, 2, 4, 8];
  const pool = await Promise.all(Array.from({ length: Math.max(...K) }, () => new Promise<Worker>((res) => {
    const w = new Worker(new URL(import.meta.url), { workerData: {} });
    w.once('message', () => res(w));
  })));
  console.log('case | serial run() ms | serial text-built ms | ' + K.map((k) => `${k} workers ms`).join(' | ') + ' | best speedup');
  for (const [label, latex, vars, n] of cases) {
    const r = compile(ce.parse(latex), { to: 'interval-js' });
    if (!r.success) { console.log(label, 'compile failed'); continue; }
    const inputs = vars.map((_, k) => {
      const a = new Float64Array(2 * n);
      const side = vars.length === 1 ? n : Math.round(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const idx = k === 0 ? i % side : Math.floor(i / side);
        const lo = -8 + (16 * idx) / side;
        a[2 * i] = lo; a[2 * i + 1] = lo + 16 / side;
      }
      return a;
    });
    const reps = n > 100_000 ? 3 : 7;
    // Serial through run().
    const v: Record<string, { lo: number; hi: number }> = {};
    const tRun = median(Array.from({ length: reps }, () => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < vars.length; k++) v[vars[k]] = { lo: inputs[k][2 * i], hi: inputs[k][2 * i + 1] };
        r.run(v);
      }
      return performance.now() - t0;
    }));
    // Serial through the text-built function (the worker's path, on the main thread).
    const kernel = build(IntervalArithmetic, r.code, (r as any).preamble, vars);
    const outSerial = new Float64Array(3 * n);
    const tText = median(Array.from({ length: reps }, () => {
      const t0 = performance.now();
      kernel(inputs, outSerial, 0, n);
      return performance.now() - t0;
    }));
    // Parallel.
    const par: number[] = [];
    for (const k of K) {
      const workers = pool.slice(0, k);
      const ts: number[] = [];
      let out: Float64Array | undefined;
      for (let rep = 0; rep < reps; rep++) {
        const t0 = performance.now();
        const chunk = Math.ceil(n / k);
        const parts = await Promise.all(workers.map((w, j) => new Promise<[number, Float64Array]>((res) => {
          const from = j * chunk, to = Math.min(n, from + chunk);
          const slices = inputs.map((a) => a.slice(2 * from, 2 * to));
          w.once('message', (o: Float64Array) => res([from, o]));
          w.postMessage({ code: r.code, preamble: (r as any).preamble, vars, inputs: slices, count: to - from }, slices.map((s) => s.buffer));
        })));
        out = new Float64Array(3 * n);
        for (const [from, o] of parts) out.set(o, 3 * from);
        ts.push(performance.now() - t0);
      }
      // Check the parallel result against the serial one.
      let mismatch = 0;
      for (let i = 0; i < out!.length; i++) if (!(out![i] === outSerial[i] || (Number.isNaN(out![i]) && Number.isNaN(outSerial[i])))) mismatch++;
      if (mismatch) console.log(`  ${k} workers: ${mismatch} mismatching values`);
      par.push(median(ts));
    }
    const best = Math.min(...par);
    console.log(`${label} | ${ms(tRun)} | ${ms(tText)} | ${par.map(ms).join(' | ')} | ${(tText / best).toFixed(2)}x (${K[par.indexOf(best)]} workers)`);
  }
  for (const w of pool) w.terminate();
} else {
  const { IntervalArithmetic } = await import(INTERVAL_SRC);
  let kernel: ReturnType<typeof build> | undefined, lastCode = '';
  parentPort!.postMessage('ready');
  parentPort!.on('message', (job: { code: string; preamble?: string; vars: string[]; inputs: Float64Array[]; count: number }) => {
    if (!kernel || lastCode !== job.code) { kernel = build(IntervalArithmetic, job.code, job.preamble, job.vars); lastCode = job.code; }
    const out = new Float64Array(3 * job.count);
    kernel(job.inputs, out, 0, job.count);
    parentPort!.postMessage(out, [out.buffer]);
  });
}
