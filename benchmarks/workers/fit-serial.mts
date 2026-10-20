// Worker-thread benchmarks for the kernel-pool design
// (docs/plans/2026-10-20-worker-kernel-pool.md). Run each file on a quiet
// machine under the shared-box lock:
//   npx tsx benchmarks/workers/<file>.mts
// Worker threads inherit the tsx loader, so the workers import the engine from
// source too. The results of 2026-10-20 are in the design document.
import { CE_SRC, TYCHO, makeData, fitCall, timeIt, ms } from './common.mts';
const { ComputeEngine } = await import(CE_SRC);
const ce = new ComputeEngine();
const variants: [string, unknown][] = [
  ['local', undefined],
  ['global b (multi-start)', { dict: { global: { dict: { b: [0.1, 6] } } } }],
  ['global b,c (separable)', { dict: { global: { dict: { b: [0.1, 6], c: [0, 6.3] } } } }],
];
console.log('rows | variant | median ms | iterations | converged');
for (const [label, data] of [['Tycho 5', TYCHO], ['100', makeData(100)], ['1000', makeData(1000)], ['10000', makeData(10000)]] as const) {
  for (const [v, opt] of variants) {
    const expr = ce.box(fitCall(data.xs, data.ys, opt) as any);
    let rec: any;
    const reps = data.xs.length >= 10000 ? 3 : 5;
    const t = timeIt(() => { rec = expr.evaluate(); }, reps);
    const get = (k: string) => { const v = rec.get?.(k); return Number.isFinite(v?.re) ? v.re : v?.toString?.(); };
    console.log(`${label} | ${v} | ${ms(t)} | ${get('iterations')} | ${get('converged')}`);
  }
}
