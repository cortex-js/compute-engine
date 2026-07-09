// Compute Engine WARM single-process batch runner (minified bundles).
//
//   node run_ce_rubi.mjs                 # emits ce-current, ce-pub, ce-rubi
//   CE_LOAD_PACKS=0 node run_ce_rubi.mjs # emits ce-current, ce-pub (no Rubi/Fungrim)
//
// Runs ALL cases in a single long-lived process and prints one JSON line per
// (engine, case). It measures up to THREE Compute Engine configurations, ALL
// under identical, warm, in-process conditions so their per-call times are
// mutually comparable:
//
//   ce-current  base CE on the freshly-built minified bundle (CE_CURRENT_BUNDLE)
//   ce-pub      base CE on the last published release bundle  (CE_PUBLISHED_BUNDLE)
//   ce-rubi     ce-current + the published integration-rules (Rubi) and
//               identities (Fungrim) packs — CE_LOAD_PACKS=1 (default)
//
// WHY ONE PROCESS FOR ALL CE COLUMNS. The V8 JIT tiers up (Ignition → Sparkplug
// → Maglev → TurboFan) only after a code path runs many times; a fresh process
// that runs a single case ~50 times never reaches the steady state a long-lived
// process reaches after 55 cases. Measuring each CE column in its own cold
// process (the previous run_ce.mjs topology) therefore reported the SAME engine
// as 1.5–2× slower than a warm one — an artifact that made `ce-current` look
// slower than the pack-loaded `ce-rubi`, which is impossible on pure numerics
// where no rule can fire. Running every CE column back-to-back in one warm
// process removes that asymmetry: the three columns share identical JIT/cache
// state, so `ce-current` vs `ce-rubi` is now a true rule-pack overhead figure
// and `ce-current` vs `ce-pub` is a true release-over-release delta.
//
// Python/Wolfram comparators do not need this: SymPy/NumPy are interpreted (no
// JIT tiering, so a cold process is already at steady state) and Wolfram times
// warm inside its kernel. math.js (also V8) is still cold-per-process — the one
// residual cross-tool asymmetry, documented in benchmarks/README.md.
//
// loadIntegrationRules registers an integration provider consulted before the
// built-in integrator, so `Integrate(...).evaluate()` automatically uses Rubi.
// Running all cases in one process makes the (~0.2 s) rule load happen once.
// Precision is reset to the engine default at the start of every case so an
// arbitrary-precision `N` case cannot leak its precision into later cases.
//
// Bundle paths default to ../../dist/esm-min/* and can be overridden:
//   CE_CURRENT_BUNDLE · CE_PUBLISHED_BUNDLE
//   CE_INTEGRATION_RULES_BUNDLE · CE_IDENTITIES_BUNDLE
//   CE_LOAD_PACKS=0 disables both packs (drops the ce-rubi column)

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'dist');
const CE_BUNDLE = process.env.CE_CURRENT_BUNDLE || join(DIST, 'esm-min', 'compute-engine.js');
const PUB_BUNDLE = process.env.CE_PUBLISHED_BUNDLE || '';
const IR_BUNDLE = process.env.CE_INTEGRATION_RULES_BUNDLE || join(DIST, 'esm-min', 'integration-rules.js');
const ID_BUNDLE = process.env.CE_IDENTITIES_BUNDLE || join(DIST, 'esm-min', 'identities.js');

const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));

// CE_LOAD_PACKS=0 → drop the Rubi/Fungrim (ce-rubi) column, still emit
// ce-current and ce-pub. Default builds all available engines in this one
// process so every CE column shares the same warm-up state.
const LOAD_PACKS = process.env.CE_LOAD_PACKS !== '0';

const { ComputeEngine } = await import(CE_BUNDLE);
const ceBase = new ComputeEngine();
// Engine default precision — restored before every case so a high-precision `N`
// case does not leak its precision into subsequent symbolic cases.
const DEFAULT_PRECISION = ceBase.precision;

// Published release engine (separate ESM module → its own ComputeEngine class).
// Loaded into the SAME process so its times are measured under identical warmth.
let cePub = null;
if (PUB_BUNDLE && existsSync(PUB_BUNDLE)) {
  try {
    const mod = await import(PUB_BUNDLE);
    cePub = new mod.ComputeEngine();
  } catch (e) {
    console.error('published-bundle load failed, dropping ce-pub column:', e && e.message);
    cePub = null;
  }
}

let ceRubi = null;
if (LOAD_PACKS) {
  ceRubi = new ComputeEngine();
  try {
    const { loadIntegrationRules } = await import(IR_BUNDLE);
    loadIntegrationRules(ceRubi); // Rubi algebraic-integration corpus (~2,647 rules)
    const { loadIdentities } = await import(ID_BUNDLE);
    loadIdentities(ceRubi); // Fungrim identity corpus
  } catch (e) {
    console.error('rule-pack load failed, dropping ce-rubi column:', e && e.message);
    ceRubi = null;
  }
}

// Engines to measure, in a fixed order. All are timed in this one warm process
// so their per-call times are mutually comparable.
const ENGINES = [
  ['ce-current', ceBase],
  ...(cePub ? [['ce-pub', cePub]] : []),
  ...(ceRubi ? [['ce-rubi', ceRubi]] : []),
];

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

// Build the zero-argument thunk that performs a case's core operation. Setting
// the engine precision is a side effect performed here (reset to the default,
// then bumped to the case precision for a decimal `N`), so callers that only
// warm the path — not just those that time it — get the right precision too.
// Shared by the warm-up pass and the measured loop, so both exercise the
// identical code path.
function buildOp(ce, kase) {
  const input = kase.inputs.ce;
  ce.precision = DEFAULT_PRECISION; // reset per case (the N-decimal branch overrides it)
  switch (input.op) {
    case 'N':
      if (kase.verify.kind === 'integer') return () => ce.expr(input.mathjson).evaluate();
      ce.precision = input.precision;
      return () => ce.expr(input.mathjson).N();
    case 'simplify':
      return () => ce.expr(input.mathjson).simplify();
    case 'diff':
      return () => ce.expr(['D', input.mathjson, input.var]).evaluate();
    case 'integrate':
      // loadIntegrationRules routes Integrate through Rubi (then falls back to
      // the built-in integrator), so a plain evaluate() exercises the full stack.
      return () => ce.expr(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
    case 'evaluate':
      return () => ce.expr(input.mathjson).evaluate();
    case 'solve':
      return () => ce.expr(input.mathjson).solve(input.var);
    default:
      return null;
  }
}

// Run one case on one engine and return its result object (no id/tool — those
// are added by emit). Precision is reset per call so cases stay independent.
function runCase(ce, kase) {
  const input = kase.inputs.ce;
  const fn = buildOp(ce, kase); // also (re)sets precision for this case
  if (!fn) return { status: 'error', error: `unknown op ${input.op}` };
  try {
    if (input.op === 'N') {
      const timing = timeit(fn);
      const r = fn();
      return { status: 'ok', text: r.toString(), valueText: r.toString(), values: [], ...timing };
    } else if (input.op === 'simplify') {
      const timing = timeit(fn);
      const original = ce.expr(input.mathjson);
      const result = fn();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [kase.verify.var]: ce.number(p) })));
      return { status: 'ok', text: result.toString(), inputText: original.toString(), values, ...timing };
    } else if (input.op === 'diff') {
      const timing = timeit(fn);
      const result = fn();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p) => num(result.subs({ [input.var]: ce.number(p) })));
      return { status: 'ok', text: result.toString(), values, ...timing };
    } else if (input.op === 'integrate') {
      const timing = timeit(fn);
      const result = fn();
      if (isUnevaluated(result))
        return { status: 'unevaluated', text: result.toString(), values: [], ...timing };
      const a = parseFloat(kase.verify.a);
      const b = parseFloat(kase.verify.b);
      const fb = num(result.subs({ [input.var]: ce.number(b) }));
      const fa = num(result.subs({ [input.var]: ce.number(a) }));
      return { status: 'ok', text: result.toString(), values: [fb - fa], ...timing };
    } else if (input.op === 'evaluate') {
      const timing = timeit(fn);
      const result = fn();
      if (isUnevaluated(result))
        return { status: 'unevaluated', text: result.toString(), values: [], ...timing };
      return { status: 'ok', text: result.toString(), values: [num(result)], ...timing };
    } else if (input.op === 'solve') {
      const timing = timeit(fn);
      const roots = fn();
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

// Warm-up pass: run every case once on every engine BEFORE any timing, so the
// V8 JIT has tiered up the shared code paths uniformly and no engine measured
// early in the suite is penalised by first-touch coldness (which, interleaved
// per case, would otherwise bias `ce-current` slower than `ce-rubi`). Errors
// are ignored here — they surface in the measured pass.
for (let pass = 0; pass < 2; pass++) {
  for (const kase of suite.cases) {
    for (const [, ce] of ENGINES) {
      try { const fn = buildOp(ce, kase); if (fn) fn(); } catch { /* warm-up: ignore */ }
    }
  }
}

// Measured pass — every CE column timed under the same warm conditions.
for (const kase of suite.cases) {
  for (const [tool, ce] of ENGINES) emit(tool, { id: kase.id, ...runCase(ce, kase) });
}
