// Compute Engine + Rubi + Fungrim benchmark runner (run with `npx tsx`).
//
//   npx tsx runners/run_ce_rubi.ts
//
// Unlike the other runners (one case per process), this one runs ALL cases in a
// single process and prints one JSON line per case (tool: "ce-rubi"). Reason:
// it must build from source (the Rubi harness lives in scripts/rubi/, not in
// the shipped bundle) and compile ~2.6k algebraic rules once — too costly to
// repeat per case. The RubiDriver has its own deadline (timeLimitMs) and
// catches CancellationError, so a single long-lived process is hang-safe.
//
// This column models "current Compute Engine with everything enabled":
//   - antiderivative: try the Rubi rule driver; fall back to the built-in
//     integrator if Rubi can't solve it.
//   - numeric / simplify / derivative: the base engine with the Fungrim
//     identity corpus loaded.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine.ts';
import { compileSection } from '../../scripts/rubi/compile.ts';
import { RubiDriver } from '../../scripts/rubi/driver.ts';
import { loadIdentities } from '../../src/identities.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const suite = JSON.parse(readFileSync(join(__dirname, '..', 'cases.json'), 'utf8'));

const ce = new ComputeEngine();
try {
  loadIdentities(ce); // Fungrim corpus
} catch {
  /* Fungrim load is best-effort; continue without it */
}
const { rules } = compileSection(ce, join(ROOT, 'data', 'rubi', 'corpus', '1 Algebraic functions'));
const driver = new RubiDriver(ce, rules, { timeLimitMs: 10000 });

function emit(o: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ tool: 'ce-rubi', ...o }) + '\n');
}
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function timeit(fn: () => void) {
  let t = performance.now();
  fn();
  const first = performance.now() - t;
  const iterations = Math.min(30, Math.max(1, Math.round(120 / Math.max(first, 0.01))));
  for (let i = 0; i < Math.min(2, iterations); i++) fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) { t = performance.now(); fn(); times.push(performance.now() - t); }
  return { timeMs: median(times), minMs: Math.min(...times), iterations };
}
const num = (boxed: any) => {
  const v = boxed.N();
  return typeof v.re === 'number' ? v.re : Number(v.toString());
};

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
      const values = pts.map((p: number) => num(result.subs({ [kase.verify.var]: ce.number(p) })));
      emit({ id, status: 'ok', text: result.toString(), inputText: original.toString(), values, ...timing });
    } else if (input.op === 'diff') {
      const build = () => ce.box(['D', input.mathjson, input.var]).evaluate();
      const timing = timeit(build);
      const result = build();
      const pts = kase.verify.points.map(parseFloat);
      const values = pts.map((p: number) => num(result.subs({ [input.var]: ce.number(p) })));
      emit({ id, status: 'ok', text: result.toString(), values, ...timing });
    } else if (input.op === 'integrate') {
      // Try Rubi first; fall back to the built-in integrator.
      const integrand = ce.box(input.mathjson);
      let result: any = null;
      let source = 'rubi';
      const t0 = performance.now();
      try {
        const r = driver.int(integrand, input.var);
        if (r != null) result = ce.box(r as any);
      } catch { /* fall through */ }
      if (result == null || result.operator === 'Integrate') {
        source = 'builtin';
        result = ce.box(['Integrate', input.mathjson, ['Tuple', input.var]]).evaluate();
      }
      const timeMs = performance.now() - t0;
      if (result == null || result.operator === 'Integrate' || /\bint\(/.test(result.toString())) {
        emit({ id, status: 'unevaluated', text: result ? result.toString() : 'null', values: [], timeMs, minMs: timeMs, iterations: 1, via: source });
      } else {
        const a = parseFloat(kase.verify.a);
        const b = parseFloat(kase.verify.b);
        const fb = num(result.subs({ [input.var]: ce.number(b) }));
        const fa = num(result.subs({ [input.var]: ce.number(a) }));
        emit({ id, status: 'ok', text: result.toString(), values: [fb - fa], timeMs, minMs: timeMs, iterations: 1, via: source });
      }
    } else {
      emit({ id, status: 'error', error: `unknown op ${input.op}` });
    }
  } catch (e: any) {
    emit({ id, status: 'error', error: String(e && e.message ? e.message : e) });
  }
}
