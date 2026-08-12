// Cache-stats measurement over three workloads (CE_CACHE_STATS=1):
//  A. Big-op loop — the motivating "loop in a sum" case, with a mixed body
//     (index-dependent and index-independent subtrees).
//  B. Slider ticks — the "isolated write" case: many bindings, one written
//     per tick, most evaluated expressions independent of it.
//  C. A real Epsil program — the recursive JSON parser example.
import { readFileSync } from 'node:fs';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import {
  formatCacheStats,
  resetCacheStats,
} from '../../src/common/cache-stats';

function section(title: string, fn: () => void): void {
  resetCacheStats();
  const t0 = performance.now();
  fn();
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n===== ${title} (${ms} ms) =====`);
  console.log(formatCacheStats());
}

// ---------- A. Big-op loop ----------
section('A. Sum loop: \\sum_{i=1}^{1000} (i^2 + x·y + x/i), x,y assigned', () => {
  const ce = new ComputeEngine();
  ce.assign('x', 3);
  ce.assign('y', 5);
  const e = ce.parse('\\sum_{i=1}^{1000} (i^2 + x\\cdot y + \\frac{x}{i})');
  e.evaluate();
});

// ---------- B. Slider ticks ----------
section('B. Slider: 200 bindings, 100 exprs (indep), 20 exprs (dep), 100 ticks', () => {
  const ce = new ComputeEngine();
  for (let k = 0; k < 200; k++) ce.assign(`a_{${k}}`, k + 1);
  ce.assign('s', 0);
  // 100 expressions that do NOT reference the slider…
  const indep = Array.from({ length: 100 }, (_, j) =>
    ce.parse(
      `a_{${j % 200}}^2 + \\frac{a_{${(j + 7) % 200}}}{a_{${(j + 13) % 200}} + 1}`
    )
  );
  // …and 20 that do.
  const dep = Array.from({ length: 20 }, (_, j) =>
    ce.parse(`s\\cdot a_{${j}} + s^2`)
  );
  for (let t = 0; t < 100; t++) {
    ce.assign('s', t);
    for (const e of indep) e.evaluate();
    for (const e of dep) e.evaluate();
  }
});

// ---------- C. Epsil program ----------
section('C. Epsil JSON parser (demo.epsil), 20 runs', () => {
  const ce = new ComputeEngine();
  const src = readFileSync(
    '/Users/arno/dev/compute-engine/vscode-epsil/examples/demo.epsil',
    'utf8'
  );
  for (let r = 0; r < 20; r++) executeEpsil(ce, src);
});

