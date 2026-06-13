// math.js benchmark runner.
//
//   node run_mathjs.mjs <case-id>
//
// Runs one case from ../cases.json with math.js (installed in the isolated
// benchmarks/.competitors/mathjs-host) and prints ONE line of JSON, matching
// the shape produced by run_ce.mjs so the orchestrator can treat every tool
// uniformly.
//
// math.js supports numeric evaluation (arbitrary precision via its BigNumber
// type), algebraic simplify(), and symbolic derivative(). It has no symbolic
// integration, so antiderivative cases are reported as `unsupported`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , caseId] = process.argv;

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));
const kase = suite.cases.find((c) => c.id === caseId);

function emit(o) {
  process.stdout.write(JSON.stringify({ id: caseId, tool: 'mathjs', ...o }) + '\n');
}
if (!kase) { emit({ status: 'error', error: 'unknown case' }); process.exit(0); }

const input = kase.inputs.mathjs;
if (!input) { emit({ status: 'unsupported', reason: 'no symbolic integration in math.js' }); process.exit(0); }

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function timeit(fn) {
  let t = performance.now();
  fn();
  const first = performance.now() - t;
  const iterations = Math.min(50, Math.max(1, Math.round(150 / Math.max(first, 0.01))));
  for (let i = 0; i < Math.min(3, iterations); i++) fn();
  const times = [];
  for (let i = 0; i < iterations; i++) { t = performance.now(); fn(); times.push(performance.now() - t); }
  return { timeMs: median(times), minMs: Math.min(...times), iterations };
}

const mjPath = join(__dirname, '..', '.competitors', 'mathjs-host', 'node_modules', 'mathjs', 'lib', 'esm', 'index.js');
const math = await import(mjPath);

try {
  if (input.op === 'N') {
    // Arbitrary precision via BigNumber configured to the requested digits.
    // Exact-integer cases get plenty of precision so the comparison is fair
    // (the value, not BigNumber's default precision, is what's under test).
    const digits = kase.verify.kind === 'integer' ? 220 : (input.precision || 64) + 2;
    const big = math.create(math.all, { number: 'BigNumber', precision: digits });
    const timing = timeit(() => big.evaluate(input.expr));
    const r = big.evaluate(input.expr);
    emit({ status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing });
  } else if (input.op === 'simplify') {
    const timing = timeit(() => math.simplify(input.expr));
    const node = math.simplify(input.expr);
    const text = node.toString();
    const pts = kase.verify.points.map(parseFloat);
    const values = pts.map((p) => Number(node.evaluate({ [kase.verify.var]: p })));
    // inputText is math.js's own rendering of the un-simplified input, so the
    // oracle can compare it to `text` to tell whether simplify() changed anything.
    emit({ status: 'ok', text, inputText: math.parse(input.expr).toString(), values, ...timing });
  } else if (input.op === 'diff') {
    const timing = timeit(() => math.derivative(input.expr, input.var));
    const node = math.derivative(input.expr, input.var);
    const pts = kase.verify.points.map(parseFloat);
    const values = pts.map((p) => Number(node.evaluate({ [input.var]: p })));
    emit({ status: 'ok', text: node.toString(), values, ...timing });
  } else {
    emit({ status: 'unsupported' });
  }
} catch (e) {
  emit({ status: 'error', error: String(e && e.message ? e.message : e) });
}
