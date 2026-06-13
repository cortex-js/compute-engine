// Compute Engine benchmark runner.
//
//   node run_ce.mjs <module-path> <case-id>
//
// Imports the Compute Engine bundle at <module-path> (so the orchestrator can
// point it at either the freshly-built local bundle or a published version),
// runs the single case <case-id> from ../cases.json, and prints ONE line of
// JSON describing the result (status, displayed output, the numeric values
// used for correctness verification, and a median timing).
//
// Running one case per process keeps a hang or crash isolated to that case:
// the orchestrator spawns us with a hard timeout and records a clean result
// either way.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , modulePath, caseId] = process.argv;

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));
const kase = suite.cases.find((c) => c.id === caseId);
if (!kase) {
  process.stdout.write(JSON.stringify({ id: caseId, tool: 'ce', status: 'error', error: 'unknown case' }) + '\n');
  process.exit(0);
}

function emit(o) {
  process.stdout.write(JSON.stringify({ id: caseId, tool: 'ce', ...o }) + '\n');
}

// Median of an array of numbers.
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Warm up, then time `fn` over an adaptive iteration count; return {timeMs, minMs, iterations}.
function timeit(fn) {
  let t = performance.now();
  fn();
  const first = performance.now() - t;
  const iterations = Math.min(50, Math.max(1, Math.round(150 / Math.max(first, 0.01))));
  for (let i = 0; i < Math.min(3, iterations); i++) fn();
  const times = [];
  for (let i = 0; i < iterations; i++) {
    t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  return { timeMs: median(times), minMs: Math.min(...times), iterations };
}

const { ComputeEngine } = await import(modulePath);
const ce = new ComputeEngine();

const input = kase.inputs.ce;
const num = (boxed) => {
  const v = boxed.N();
  return typeof v.re === 'number' ? v.re : Number(v.toString());
};

try {
  if (input.op === 'N') {
    // Arbitrary-precision numeric / exact-integer evaluation.
    if (kase.verify.kind === 'integer') {
      const timing = timeit(() => ce.box(input.mathjson).evaluate());
      const r = ce.box(input.mathjson).evaluate();
      emit({ status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing });
    } else {
      ce.precision = input.precision;
      const timing = timeit(() => ce.box(input.mathjson).N());
      const r = ce.box(input.mathjson).N();
      emit({ status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing });
    }
  } else if (input.op === 'simplify') {
    const timing = timeit(() => ce.box(input.mathjson).simplify());
    const original = ce.box(input.mathjson);
    const result = original.simplify();
    const pts = suite.cases.find((c) => c.id === caseId).verify.points.map(parseFloat);
    const values = pts.map((p) => num(result.subs({ [kase.verify.var]: ce.number(p) })));
    emit({
      status: 'ok',
      text: result.toString(),
      inputText: original.toString(),
      values,
      ...timing,
    });
  } else if (input.op === 'diff') {
    const build = () => ce.box(['D', input.mathjson, input.var]).evaluate();
    const timing = timeit(build);
    const result = build();
    const pts = kase.verify.points.map(parseFloat);
    const values = pts.map((p) => num(result.subs({ [input.var]: ce.number(p) })));
    emit({ status: 'ok', text: result.toString(), values, ...timing });
  } else if (input.op === 'integrate') {
    const build = () => ce.box(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
    const timing = timeit(build);
    const result = build();
    // An unevaluated integral comes back as an Integrate node.
    if (result.operator === 'Integrate' || /\bint\(/.test(result.toString())) {
      emit({ status: 'unevaluated', text: result.toString(), values: [], ...timing });
    } else {
      const a = parseFloat(kase.verify.a);
      const b = parseFloat(kase.verify.b);
      const fb = num(result.subs({ [input.var]: ce.number(b) }));
      const fa = num(result.subs({ [input.var]: ce.number(a) }));
      emit({ status: 'ok', text: result.toString(), values: [fb - fa], ...timing });
    }
  } else {
    emit({ status: 'error', error: `unknown op ${input.op}` });
  }
} catch (e) {
  emit({ status: 'error', error: String(e && e.message ? e.message : e) });
}
