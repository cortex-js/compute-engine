// CE-1210: exact call counts of every function of a Compute Engine bundle
// over the benchmark cases D01 D03 D05-D08 A01 CR2 CE1-CE3 (V8 precise
// coverage with call counts). The counts are deterministic: no box lock, no
// timing. The total per evaluation tracks the time ratio between releases.
//
//   node scripts/repros/2026-11-15-ce1210-call-counts.mjs <bundle.js> <out.json> [calls]
//   node scripts/repros/2026-11-15-ce1210-call-counts.mjs --compare <a.json> <b.json> [top]
//
// A bundle is an UNMINIFIED ESM entry (dist/esm/compute-engine.js of a build,
// so that functions keep their names); chunks beside it are counted too.
// `calls` is the number of evaluations of each case after 50 warm-up calls
// (default 200). `--compare` prints the totals per evaluation and the
// functions whose count differs most.
import inspector from 'node:inspector';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CASES = 'D01,D03,D05,D06,D07,D08,A01,CR2,CE1,CE2,CE3'.split(',');

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3, 5).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const top = +(process.argv[5] ?? 40);
  const per = (x) => x.total / x.evaluations;
  console.log(`calls per evaluation: ${per(a).toFixed(0)} -> ${per(b).toFixed(0)} (${(per(b) / per(a)).toFixed(3)})`);
  const names = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  const d = [...names].map((n) => [n, (a.counts[n] ?? 0) / a.evaluations, (b.counts[n] ?? 0) / b.evaluations]);
  d.sort((x, y) => Math.abs(y[2] - y[1]) - Math.abs(x[2] - x[1]));
  for (const [n, x, y] of d.slice(0, top))
    console.log(`${x.toFixed(0).padStart(7)} -> ${y.toFixed(0).padStart(7)}  ${(y - x >= 0 ? '+' : '') + (y - x).toFixed(0)}  ${n}`);
  process.exit(0);
}

const [bundle, out, calls = '200'] = process.argv.slice(2);
const suite = JSON.parse(readFileSync(new URL('../../benchmarks/cases.json', import.meta.url), 'utf8'));
const { ComputeEngine } = await import(pathToFileURL(bundle).href);
const ops = CASES.map((id) => {
  const ce = new ComputeEngine();
  const input = suite.cases.find((c) => c.id === id).inputs.ce;
  const f =
    input.op === 'diff' ? () => ce.expr(['D', input.mathjson, input.var]).evaluate()
    : input.op === 'integrate' ? () => ce.expr(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate()
    : () => ce.expr(input.mathjson).evaluate();
  for (let i = 0; i < 50; i++) f();
  return f;
});
const session = new inspector.Session();
session.connect();
const post = (m, p) => new Promise((res, rej) => session.post(m, p, (e, r) => (e ? rej(e) : res(r))));
await post('Profiler.enable');
await post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
for (const f of ops) for (let i = 0; i < +calls; i++) f();
const { result } = await post('Profiler.takePreciseCoverage');
const dir = pathToFileURL(bundle).href.replace(/[^/]*$/, '');
const counts = Object.create(null);
let total = 0;
for (const script of result) {
  if (!script.url.startsWith(dir)) continue;
  for (const fn of script.functions) {
    const n = fn.ranges[0].count;
    if (n === 0) continue;
    const name = fn.functionName || '(anonymous)';
    counts[name] = (counts[name] ?? 0) + n;
    total += n;
  }
}
const evaluations = CASES.length * +calls;
writeFileSync(out, JSON.stringify({ evaluations, total, counts }));
console.log(`${Object.keys(counts).length} functions, ${(total / evaluations).toFixed(0)} calls per evaluation`);
