/**
 * Tycho document open, part 1: the cost of `evaluate()` on large 3-D surface
 * bodies.
 *
 * When Tycho opens the Desmos art document `2ki2hjsouf`, its series inference
 * (`guardedEvaluate` in Tycho's `src/plot-core/list-materialize.ts`) calls
 * `evaluate()` on 15 expressions that each take more than 5 ms. They are the
 * bodies of 3-D parametric surfaces in the free parameters `u` and `v`, after
 * Tycho has inlined the document functions: trees of `PointList`, `PointX`,
 * `ListJoin`, `Comprehension` and arithmetic, up to 67 KB of MathJSON. The
 * inputs do not read any document symbol (only `u`, `v`, bound variables and
 * a local `Block` variable), so this script replays them on a fresh engine.
 *
 * The inputs are in `2ki2hjsouf.fixture.json.gz` (written by a capture run of
 * the Tycho pipeline in Node with CE 0.170.0; field `evaluate`). The engine
 * settings are the ones Tycho uses: machine precision, degrees.
 *
 * Protocol: each input is boxed (not timed), then `evaluate()` is timed.
 * Every run boxes the input again. One warm-up run, then RUNS runs; the
 * median and the range are reported per input and for the sum.
 *
 *   npx tsx benchmarks/tycho-document-open/evaluate.ts           # RUNS=5
 *   RUNS=7 ONLY=0,1 npx tsx benchmarks/tycho-document-open/evaluate.ts
 *   node --cpu-prof --cpu-prof-dir=<dir> --import tsx \
 *     benchmarks/tycho-document-open/evaluate.ts                  # profile
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadavg } from 'node:os';
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const RUNS = Number(process.env.RUNS ?? 5);
const ONLY = process.env.ONLY?.split(',').map(Number);

type Fixture = {
  engine: { angularUnit: 'deg' | 'rad' };
  evaluate: { tychoMs: number; json: MathJsonExpression }[];
};
const fixture: Fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      process.env.FIXTURE ??
        new URL('./2ki2hjsouf.fixture.json.gz', import.meta.url)
    )
  ).toString()
);

const ce = new ComputeEngine();
ce.precision = 'machine';
ce.angularUnit = fixture.engine.angularUnit;
ce.declare('u', 'real');
ce.declare('v', 'real');

const inputs = fixture.evaluate
  .map((e, i) => ({ ...e, i }))
  .filter((e) => !ONLY || ONLY.includes(e.i));

function runOnce(): number[] {
  return inputs.map(({ json }) => {
    const expr = ce.box(json);
    const t = performance.now();
    expr.evaluate();
    return performance.now() - t;
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log(`load average before: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`);
runOnce(); // warm-up
const runs: number[][] = [];
for (let r = 0; r < RUNS; r++) runs.push(runOnce());

console.log('input  json bytes  Tycho ms  median ms  (min-max)');
inputs.forEach(({ i, json, tychoMs }, k) => {
  const xs = runs.map((r) => r[k]);
  console.log(
    `${String(i).padStart(5)}  ${String(JSON.stringify(json).length).padStart(10)}  ${String(tychoMs).padStart(8)}  ${median(xs).toFixed(1).padStart(9)}  (${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)})`
  );
});
const totals = runs.map((r) => r.reduce((a, b) => a + b, 0));
console.log(
  `total: median ${median(totals).toFixed(0)} ms (${Math.min(...totals).toFixed(0)}-${Math.max(...totals).toFixed(0)}) over ${RUNS} runs; Tycho sum ${inputs.reduce((a, e) => a + e.tychoMs, 0)} ms`
);
console.log(`load average after: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`);
