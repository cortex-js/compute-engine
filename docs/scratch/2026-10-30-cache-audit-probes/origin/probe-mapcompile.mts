// Origin case of mapCompileCaches (library/map-auto-compile.ts, commit
// 0eb257562, 2026-07-19; design docs/plans/2026-07-19-map-auto-compile-
// design.md at that commit): "a 40-term Sum of a user function over a
// 2469-element broadcast", drained numerically at machine precision; test
// plan item 2 "Cache identity: .N() twice on one logical Map -> second drain
// attempts === 0" (map-auto-compile.test.ts, "memoized rewrap: second drain
// reuses the compiled function").
// With the cache off, each drain (and each `at()`, which is its own drain)
// compiles the lambda again.
// A new engine per run (outside the timer).
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine/library/map-auto-compile.ts';
import { _clearElementMemoForTest } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine/boxed-expression/collection-element-memo.ts';
import { measure } from './harness.mts';

const N = Number(process.env.MAP_N ?? 2469);
const DRAINS = Number(process.env.MAP_DRAINS ?? 5);
const AT_READS = Number(process.env.MAP_AT ?? 500);

function setup() {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.assign(
    'f',
    ce.box([
      'Function',
      ['Sum', ['Divide', ['Sin', ['Multiply', 'j', 'x']], 'j'], ['Limits', 'j', 1, 40]],
      'x',
    ])
  );
  const m = ce.box(['f', ['Range', 1, N]]).evaluate();
  return { ce, m };
}

const fmt = (xs: number[]) => xs.map((v) => v.toPrecision(15)).join(',');

// (a) The origin pattern: the numeric view drained several times. The
// element memo (a separate cache) serves the drains after the first.
await measure(`map-drains N=${N} drains=${DRAINS}`, setup, ({ m }) => {
  _resetMapAutoCompileStats();
  let last: number[] = [];
  for (let d = 0; d < DRAINS; d++) last = [...m.N().each()].map((x) => x.re);
  console.error(`(a) attempts=${stats.attempts} compiledHits=${stats.compiledHits}`);
  return `${m.operator} ${fmt(last)}`;
});

// (b) The same, with the element memo cleared before each drain, as the
// origin test does (`_clearElementMemoForTest`), so each drain reads the
// compile cache. This isolates the compile cache from the element memo.
await measure(`map-drains-no-element-memo N=${N} drains=${DRAINS}`, setup, ({ m }) => {
  _resetMapAutoCompileStats();
  let last: number[] = [];
  for (let d = 0; d < DRAINS; d++) {
    _clearElementMemoForTest(m.N());
    last = [...m.N().each()].map((x) => x.re);
  }
  console.error(`(b) attempts=${stats.attempts} compiledHits=${stats.compiledHits}`);
  return `${m.operator} ${fmt(last)}`;
});

// (c) Element reads by index: each `at()` is its own drain (comment on
// `attemptedThisDrain`).
await measure(`map-at N=${N} reads=${AT_READS}`, setup, ({ m }) => {
  _resetMapAutoCompileStats();
  const v = m.N();
  const out: number[] = [];
  for (let k = 1; k <= AT_READS; k++) out.push(v.at(((k * 37) % N) + 1)!.re);
  console.error(`(c) attempts=${stats.attempts} compiledHits=${stats.compiledHits}`);
  return fmt(out);
});
