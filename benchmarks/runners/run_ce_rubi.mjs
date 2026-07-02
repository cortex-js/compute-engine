// Compute Engine WARM single-process batch runner (minified bundles).
//
//   node run_ce_rubi.mjs                 # packs ON  → tool "ce-rubi"  (CE+R/F)
//   CE_LOAD_PACKS=0 node run_ce_rubi.mjs # packs OFF → tool "ce-warm" (base CE)
//
// Runs ALL cases in a single process and prints one JSON line per case. With
// CE_LOAD_PACKS=1 (default) it loads the published **integration-rules** (Rubi)
// and **identities** (Fungrim) bundles onto the engine; with CE_LOAD_PACKS=0 it
// loads neither, giving a base-CE baseline measured through the *identical*
// harness. Both modes use the same minified `compute-engine` bundle as the
// `ce-current` column.
//
// IMPORTANT — comparability. These times are **warm steady-state** (one engine,
// caches accumulate across the 55 cases), so they are directly comparable to
// EACH OTHER (packs off vs on = true rule-pack overhead) but NOT to the
// per-case *cold* `ce-current` / `ce-pub` columns produced by run_ce.mjs (one
// fresh process per case). report.mjs runs this file in both modes and shows
// the packs-off vs packs-on delta as the honest overhead figure.
//
// loadIntegrationRules registers an integration provider that is consulted
// before the built-in integrator, so `Integrate(...).evaluate()` automatically
// uses Rubi. Running all cases in one process makes the (~0.2 s) rule load
// happen once. Precision is reset to the engine default at the start of every
// case so an arbitrary-precision `N` case cannot leak its precision into later
// symbolic cases.
//
// Bundle paths default to ../../dist/* and can be overridden:
//   CE_CURRENT_BUNDLE · CE_INTEGRATION_RULES_BUNDLE · CE_IDENTITIES_BUNDLE
//   CE_LOAD_PACKS=0 disables both packs (base-CE-warm baseline)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'dist');
const CE_BUNDLE = process.env.CE_CURRENT_BUNDLE || join(DIST, 'compute-engine.min.esm.js');
const IR_BUNDLE = process.env.CE_INTEGRATION_RULES_BUNDLE || join(DIST, 'integration-rules.min.esm.js');
const ID_BUNDLE = process.env.CE_IDENTITIES_BUNDLE || join(DIST, 'identities.min.esm.js');

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));

// CE_LOAD_PACKS=0 → base-CE-warm baseline only (no Rubi, no Fungrim). Default
// builds BOTH engines in this one process and emits a `ce-warm` and a `ce-rubi`
// line per case, so the packs-off/packs-on delta shares process warmth and is a
// clean measure of rule-pack overhead (no cross-process JIT variance).
const LOAD_PACKS = process.env.CE_LOAD_PACKS !== '0';

const { ComputeEngine } = await import(CE_BUNDLE);
const ceBase = new ComputeEngine();
// Engine default precision — restored before every case so a high-precision `N`
// case does not leak its precision into subsequent symbolic cases.
const DEFAULT_PRECISION = ceBase.precision;

let ceRubi = null;
if (LOAD_PACKS) {
  ceRubi = new ComputeEngine();
  try {
    const { loadIntegrationRules } = await import(IR_BUNDLE);
    loadIntegrationRules(ceRubi); // Rubi algebraic-integration corpus (~2,647 rules)
    const { loadIdentities } = await import(ID_BUNDLE);
    loadIdentities(ceRubi); // Fungrim identity corpus
  } catch (e) {
    console.error('rule-pack load failed, emitting base-CE only:', e && e.message);
    ceRubi = null;
  }
}

// Engines to measure, in a fixed order so both share the per-case warm-up state.
const ENGINES = [['ce-warm', ceBase], ...(ceRubi ? [['ce-rubi', ceRubi]] : [])];

function emit(tool, o) {
  process.stdout.write(JSON.stringify({ tool, packs: tool === 'ce-rubi', ...o }) + '\n');
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

// Run one case on one engine and return its result object (no id/tool — those
// are added by emit). Precision is reset per call so cases stay independent.
function runCase(ce, kase) {
  const input = kase.inputs.ce;
  ce.precision = DEFAULT_PRECISION; // reset per case (the N-decimal branch overrides it)
  try {
    if (input.op === 'N') {
      if (kase.verify.kind === 'integer') {
        const timing = timeit(() => ce.expr(input.mathjson).evaluate());
        const r = ce.expr(input.mathjson).evaluate();
        return { status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing };
      }
      ce.precision = input.precision;
      const timing = timeit(() => ce.expr(input.mathjson).N());
      const r = ce.expr(input.mathjson).N();
      return { status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing };
    } else if (input.op === 'simplify') {
      const timing = timeit(() => ce.expr(input.mathjson).simplify());
      const original = ce.expr(input.mathjson);
      const result = original.simplify();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [kase.verify.var]: ce.number(p) })));
      return { status: 'ok', text: result.toString(), inputText: original.toString(), values, ...timing };
    } else if (input.op === 'diff') {
      const build = () => ce.expr(['D', input.mathjson, input.var]).evaluate();
      const timing = timeit(build);
      const result = build();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [input.var]: ce.number(p) })));
      return { status: 'ok', text: result.toString(), values, ...timing };
    } else if (input.op === 'integrate') {
      // loadIntegrationRules routes Integrate through Rubi (then falls back to
      // the built-in integrator), so a plain evaluate() exercises the full stack.
      const build = () => ce.expr(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
      const timing = timeit(build);
      const result = build();
      if (isUnevaluated(result))
        return { status: 'unevaluated', text: result.toString(), values: [], ...timing };
      const a = parseFloat(kase.verify.a);
      const b = parseFloat(kase.verify.b);
      const fb = num(result.subs({ [input.var]: ce.number(b) }));
      const fa = num(result.subs({ [input.var]: ce.number(a) }));
      return { status: 'ok', text: result.toString(), values: [fb - fa], ...timing };
    } else if (input.op === 'evaluate') {
      const build = () => ce.expr(input.mathjson).evaluate();
      const timing = timeit(build);
      const result = build();
      if (isUnevaluated(result))
        return { status: 'unevaluated', text: result.toString(), values: [], ...timing };
      return { status: 'ok', text: result.toString(), values: [num(result)], ...timing };
    } else if (input.op === 'solve') {
      const build = () => ce.expr(input.mathjson).solve(input.var);
      const timing = timeit(build);
      const roots = build();
      const values = realRootValues(roots);
      return {
        status: values.length ? 'ok' : 'unevaluated',
        text: (roots ?? []).map((r) => r.toString()).join(', '),
        values,
        ...timing,
      };
    }
    return { status: 'error', error: `unknown op ${input.op}` };
  } catch (e) {
    return { status: 'error', error: String(e && e.message ? e.message : e) };
  }
}

for (const kase of suite.cases) {
  for (const [tool, ce] of ENGINES) emit(tool, { id: kase.id, ...runCase(ce, kase) });
}
