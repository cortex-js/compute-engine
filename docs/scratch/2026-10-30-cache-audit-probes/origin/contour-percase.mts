// Per-case timing for probe-contour (diagnostic, untimed lock-free run).
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
const src = await import('./probe-contour-cases.mts');
const cases = src.cases;
for (let rep = 0; rep < 3; rep++) {
  const ce = new ComputeEngine();
  const out: string[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    const r = ce.box(c).evaluate();
    out.push(`${(performance.now() - t0).toFixed(0)}ms ${c[0]} ${r.toString().slice(0, 60)}`);
  }
  if (rep === 2) console.log(process.env.CE_CACHE_OFF ?? 'none', '\n' + out.join('\n'));
}
