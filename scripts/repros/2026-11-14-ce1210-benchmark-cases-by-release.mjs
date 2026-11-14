// CE-1210: time benchmark cases (benchmarks/cases.json) on several Compute
// Engine bundles in one warm process, rounds alternated, ratios to the first.
//
//   node scripts/repros/2026-11-14-ce1210-benchmark-cases-by-release.mjs . 0.186.0,0.187.0:off,current
//
// A version reads benchmarks/.competitors/ce-<v>/ (provision it as in
// benchmarks/README.md); `current` reads dist/esm-min (npm run build production).
// `:off` sets ce._bindingUnits = false; it restores the old speed on 0.187.x
// and changes nothing on 0.188.1. Env: CASES, ROUNDS,
// DECLARE (comma-separated names declared `real`). Keep a group to about six
// bundles: 23 bundles in one process did not finish in 30 minutes.
// Hold the box lock for a timing run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, list] = process.argv.slice(2);
const ROUNDS = +(process.env.ROUNDS ?? 7);
const CASES = (process.env.CASES ?? 'N03,D01,D03,D05,D06,D07,D08,CE1,CE2,CE3,A01,CR2,CS1').split(',');
const suite = JSON.parse(readFileSync(join(repo, 'benchmarks/cases.json'), 'utf8'));
const cases = suite.cases.filter((c) => CASES.includes(c.id));

const engines = [];
for (const v of list.split(',')) {
  const [ver, flag] = v.split(':');
  const p = ver === 'current'
    ? join(repo, 'dist/esm-min/compute-engine.js')
    : join(repo, `benchmarks/.competitors/ce-${ver}/dist/esm-min/compute-engine.js`);
  const mod = await import(pathToFileURL(p).href);
  const ce = new mod.ComputeEngine();
  if (flag === 'off') { ce._bindingUnits = false; if (ce._bindingUnits !== false) throw new Error('switch not taken'); }
  for (const n of (process.env.DECLARE ?? '').split(',').filter(Boolean)) ce.declare(n, 'real');
  engines.push({ v, ce, def: ce.precision });
}

function buildOp(e, kase) {
  const { ce } = e, input = kase.inputs.ce;
  ce.precision = e.def;
  switch (input.op) {
    case 'N':
      if (kase.verify.kind === 'integer') return () => ce.expr(input.mathjson).evaluate();
      ce.precision = input.precision;
      return () => ce.expr(input.mathjson).N();
    case 'simplify': return () => ce.expr(input.mathjson).simplify();
    case 'diff': return () => ce.expr(['D', input.mathjson, input.var]).evaluate();
    case 'integrate': return () => ce.expr(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
    case 'evaluate': return () => ce.expr(input.mathjson).evaluate();
    case 'solve': return () => ce.expr(input.mathjson).solve(input.var);
  }
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function timeit(fn) {
  let t = performance.now(); fn(); const first = performance.now() - t;
  const n = Math.min(50, Math.max(5, Math.round(150 / Math.max(first, 0.01))));
  for (let i = 0; i < 3; i++) fn();
  const ts = [];
  for (let i = 0; i < n; i++) { t = performance.now(); fn(); ts.push(performance.now() - t); }
  return median(ts);
}
// warm-up: two passes of every case on every engine
for (let p = 0; p < 2; p++) for (const k of cases) for (const e of engines) { try { buildOp(e, k)(); } catch {} }

const res = {}; // res[v][id] = [ms per round]
for (let r = 0; r < ROUNDS; r++) {
  const order = engines.map((_, i) => engines[(i + r) % engines.length]);
  for (const k of cases) for (const e of order) {
    let ms; try { ms = timeit(buildOp(e, k)); } catch { ms = NaN; }
    ((res[e.v] ??= {})[k.id] ??= []).push(ms);
  }
}
const base = engines[0].v;
const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
console.log(`ratio to ${base} (median over ${ROUNDS} rounds); node ${process.version}`);
console.log(['case', ...engines.map((e) => e.v)].join('\t'));
const ratios = Object.fromEntries(engines.map((e) => [e.v, []]));
for (const k of cases) {
  const b = median(res[base][k.id]);
  const row = [k.id + ` (${b.toFixed(3)}ms)`];
  for (const e of engines) { const x = median(res[e.v][k.id]) / b; row.push(x.toFixed(2)); if (k.id !== 'CS1' && k.id !== 'N03') ratios[e.v].push(x); }
  console.log(row.join('\t'));
}
console.log(['geo (excl N03,CS1)', ...engines.map((e) => geo(ratios[e.v]).toFixed(2))].join('\t'));
