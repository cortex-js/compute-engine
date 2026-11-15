// CE-1210: compare Compute Engine bundles on benchmark cases, one process per
// case and bundle (no shared heap), rounds alternated.
//
//   node scripts/repros/2026-11-14-ce1210-ab-cases.mjs a=<bundle.js> b=<bundle.js> ...
//
// A bundle is an ESM entry (dist/esm-min/compute-engine.js of a build, or of
// benchmarks/.competitors/ce-<v>/). Prints, for each case, the median time of
// ITERS calls of each bundle as a ratio to the first, and the geometric mean
// with its value in each round. Env: CASES (default the group of CE-1210),
// ITERS (default 2000), ROUNDS (default 3). Hold the box lock for a timing run.
//
// The in-process instrument (2026-11-14-ce1210-benchmark-cases-by-release.mjs)
// loads every bundle in one process; its ratios to 0.186.0 came out about 10%
// higher than this one's on the same bundles.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CASES = (process.env.CASES ?? 'D01,D03,D05,D06,D07,D08,A01,CR2,CE1,CE2,CE3').split(',');
const ITERS = +(process.env.ITERS ?? 2000);
const ROUNDS = +(process.env.ROUNDS ?? 3);
const self = fileURLToPath(import.meta.url);

if (process.argv[2] === '--child') {
  const [, , , bundle, id, iters] = process.argv;
  const suite = JSON.parse(readFileSync(new URL('../../benchmarks/cases.json', import.meta.url), 'utf8'));
  const { ComputeEngine } = await import(pathToFileURL(bundle).href);
  const ce = new ComputeEngine();
  const input = suite.cases.find((c) => c.id === id).inputs.ce;
  const f =
    input.op === 'diff' ? () => ce.expr(['D', input.mathjson, input.var]).evaluate()
    : input.op === 'integrate' ? () => ce.expr(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate()
    : () => ce.expr(input.mathjson).evaluate();
  for (let i = 0; i < 50; i++) f();
  const t = performance.now();
  for (let i = 0; i < +iters; i++) f();
  console.log(performance.now() - t);
  process.exit(0);
}

const arms = process.argv.slice(2).map((a) => { const i = a.indexOf('='); return { name: a.slice(0, i), bundle: a.slice(i + 1) }; });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const logs = arms.map(() => []);
const perRound = Array.from({ length: ROUNDS }, () => arms.map(() => []));
console.log(['case', ...arms.map((a) => a.name)].join('\t'));
for (const id of CASES) {
  const t = arms.map(() => []);
  for (let r = 0; r < ROUNDS; r++)
    arms.forEach((a, i) => { t[i].push(+execFileSync(process.execPath, [self, '--child', a.bundle, id, String(ITERS)], { encoding: 'utf8' }).trim()); });
  const base = median(t[0]);
  console.log([id, ...t.map((x) => (median(x) / base).toFixed(3))].join('\t'));
  t.forEach((x, i) => { logs[i].push(Math.log(median(x) / base)); x.forEach((v, r) => perRound[r][i].push(Math.log(v / t[0][r]))); });
}
const geo = (xs) => Math.exp(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3);
console.log(['geo', ...logs.map(geo)].join('\t'));
perRound.forEach((r, k) => console.log([`round ${k + 1}`, ...r.map(geo)].join('\t')));
