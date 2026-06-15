// Compute Engine + Rubi + Fungrim benchmark runner (minified bundles).
//
//   node run_ce_rubi.mjs
//
// Runs ALL cases in a single process and prints one JSON line per case
// (tool: "ce-rubi"). It loads the published **integration-rules** (Rubi) and
// **identities** (Fungrim) bundles onto one fresh engine, then runs every case
// through the same op handling as run_ce.mjs. Because it uses the same minified
// `compute-engine` bundle as the `ce-current` column — plus the rule packs —
// its timings are directly comparable to the other tools (unlike the old
// from-source/`tsx` runner, whose times read several× high).
//
// loadIntegrationRules registers an integration provider that is consulted
// before the built-in integrator, so `Integrate(...).evaluate()` automatically
// uses Rubi. We run all cases in one process so the (already fast, ~0.2 s) rule
// load happens once.
//
// Bundle paths default to ../../dist/* and can be overridden:
//   CE_CURRENT_BUNDLE · CE_INTEGRATION_RULES_BUNDLE · CE_IDENTITIES_BUNDLE

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'dist');
const CE_BUNDLE = process.env.CE_CURRENT_BUNDLE || join(DIST, 'compute-engine.min.esm.js');
const IR_BUNDLE = process.env.CE_INTEGRATION_RULES_BUNDLE || join(DIST, 'integration-rules.min.esm.js');
const ID_BUNDLE = process.env.CE_IDENTITIES_BUNDLE || join(DIST, 'identities.min.esm.js');

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));

const { ComputeEngine } = await import(CE_BUNDLE);
const ce = new ComputeEngine();
try {
  const { loadIntegrationRules } = await import(IR_BUNDLE);
  loadIntegrationRules(ce); // Rubi algebraic-integration corpus (~2,647 rules)
} catch (e) {
  console.error('integration-rules load failed:', e && e.message);
}
try {
  const { loadIdentities } = await import(ID_BUNDLE);
  loadIdentities(ce); // Fungrim identity corpus
} catch (e) {
  console.error('identities load failed:', e && e.message);
}

function emit(o) {
  process.stdout.write(JSON.stringify({ tool: 'ce-rubi', ...o }) + '\n');
}
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
const num = (boxed) => {
  const v = boxed.N();
  return typeof v.re === 'number' ? v.re : Number(v.toString());
};
function realRootValues(roots) {
  const out = [];
  for (const r of roots ?? []) {
    const v = r.N();
    const re = typeof v.re === 'number' ? v.re : Number(v.toString());
    const im = typeof v.im === 'number' ? v.im : 0;
    if (Number.isFinite(re) && Math.abs(im) < 1e-7) out.push(re);
  }
  return out;
}
const UNEVAL = /^(Limit|Integrate|Sum|Product)$/;
const isUnevaluated = (r) => UNEVAL.test(r.operator ?? '') || /\b(int|lim|sum)\(/.test(r.toString());

for (const kase of suite.cases) {
  const input = kase.inputs.ce;
  const id = kase.id;
  try {
    if (input.op === 'N') {
      if (kase.verify.kind === 'integer') {
        const timing = timeit(() => ce.box(input.mathjson).evaluate());
        const r = ce.box(input.mathjson).evaluate();
        emit({ id, status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing });
      } else {
        ce.precision = input.precision;
        const timing = timeit(() => ce.box(input.mathjson).N());
        const r = ce.box(input.mathjson).N();
        emit({ id, status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing });
      }
    } else if (input.op === 'simplify') {
      const timing = timeit(() => ce.box(input.mathjson).simplify());
      const original = ce.box(input.mathjson);
      const result = original.simplify();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [kase.verify.var]: ce.number(p) })));
      emit({ id, status: 'ok', text: result.toString(), inputText: original.toString(), values, ...timing });
    } else if (input.op === 'diff') {
      const build = () => ce.box(['D', input.mathjson, input.var]).evaluate();
      const timing = timeit(build);
      const result = build();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [input.var]: ce.number(p) })));
      emit({ id, status: 'ok', text: result.toString(), values, ...timing });
    } else if (input.op === 'integrate') {
      // loadIntegrationRules routes Integrate through Rubi (then falls back to
      // the built-in integrator), so a plain evaluate() exercises the full stack.
      const build = () => ce.box(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
      const timing = timeit(build);
      const result = build();
      if (isUnevaluated(result)) {
        emit({ id, status: 'unevaluated', text: result.toString(), values: [], ...timing });
      } else {
        const a = parseFloat(kase.verify.a);
        const b = parseFloat(kase.verify.b);
        const fb = num(result.subs({ [input.var]: ce.number(b) }));
        const fa = num(result.subs({ [input.var]: ce.number(a) }));
        emit({ id, status: 'ok', text: result.toString(), values: [fb - fa], ...timing });
      }
    } else if (input.op === 'evaluate') {
      const build = () => ce.box(input.mathjson).evaluate();
      const timing = timeit(build);
      const result = build();
      if (isUnevaluated(result)) {
        emit({ id, status: 'unevaluated', text: result.toString(), values: [], ...timing });
      } else {
        emit({ id, status: 'ok', text: result.toString(), values: [num(result)], ...timing });
      }
    } else if (input.op === 'solve') {
      const build = () => ce.box(input.mathjson).solve(input.var);
      const timing = timeit(build);
      const roots = build();
      const values = realRootValues(roots);
      emit({
        id,
        status: values.length ? 'ok' : 'unevaluated',
        text: (roots ?? []).map((r) => r.toString()).join(', '),
        values,
        ...timing,
      });
    } else {
      emit({ id, status: 'error', error: `unknown op ${input.op}` });
    }
  } catch (e) {
    emit({ id, status: 'error', error: String(e && e.message ? e.message : e) });
  }
}
