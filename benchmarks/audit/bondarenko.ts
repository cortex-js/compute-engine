// Bondarenko integration set for the CE-vs-SymPy audit (run with `npx tsx`).
//
//   npx tsx benchmarks/audit/bondarenko.ts
//
// Ingests Vladimir Bondarenko's 35 integration problems (an independent test set
// from the Rubi MathematicaSyntaxTestSuite, MIT — vendored under
// `benchmarks/bondarenko/`), and runs each indefinite integral on four
// configurations — base CE, CE+Rubi+Fungrim, SymPy, and Mathematica — graded by
// the operation invariant `d/dx(result) ≈ integrand` sampled numerically (so the
// suite's optimal antiderivatives aren't needed). These are hard nested-radical /
// log / transcendental integrands, so base CE is expected to solve only a
// handful; the Rubi integrator recovers more; Mathematica is the reference.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadTestFile } from '../../scripts/rubi/load-tests.ts';
// Import the MINIFIED production bundles, not `src/`, so live `console.assert`
// (~2× overhead on the symbolic engine) is stripped and CE timings reflect
// shipped code. Requires `npm run build production` first. See
// PERFORMANCE_FINDINGS.md P0-2.
import { ComputeEngine } from '../../dist/esm-min/compute-engine.js';
import { loadIdentities } from '../../dist/esm-min/identities.js';
import { loadIntegrationRules } from '../../dist/esm-min/integration-rules.js';
import { mathJsonToWL } from '../runners/mathjson-to-wl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PYTHON = join(ROOT, 'venv', 'bin', 'python3');
const NODE = process.execPath;
const WOLFRAM_BATCH = join(__dirname, '..', 'runners', 'run_wolfram_batch.mjs');
// Several integrands need |x| < 1 (Sqrt[1-x], Log[x²+Sqrt[1-x²]]), so the pool
// leads with points inside (0,1).
const POINTS = [0.13, 0.35, 0.7, 1.3, 2.1, 3.4];
const TOL = 1e-6;
// Finite-difference fallback step and tolerance: `D` of some special functions
// (PolyLog, elliptic kernels) doesn't numericize even when F itself does, so
// those sample points fall back to a central difference of F. h = 1e-4
// balances O(h²) truncation against float64 cancellation in F(p±h); the
// looser per-point tolerance absorbs the O(h²) error while still catching
// wrong antiderivatives (off by sign / magnitude, not by 1e-5).
const FD_H = 1e-4;
const FD_TOL = 1e-4;

const CONSTS: Record<string, string> = { Pi: 'pi', ExponentialE: 'E', ImaginaryUnit: 'I', EulerGamma: 'EulerGamma' };

const ce = new ComputeEngine(); // base engine — no Rubi, no Fungrim

// Second engine configured the way a consumer enables the optional libraries:
// the Fungrim identities (simplify + solve rules) and the Rubi integrator. The
// latter registers an integration provider that `Integrate` consults
// automatically before the built-in antiderivative — no explicit driver call.
let ceRF: any = null;
try {
  ceRF = new ComputeEngine();
  loadIdentities(ceRF, { solve: true });
  loadIntegrationRules(ceRF, { timeLimitMs: 8000 });
} catch (e: any) { console.error('Rubi/Fungrim setup failed (column dropped):', e?.message); ceRF = null; }

// Extract the central real value from a `.N()` result.
const reOf = (r: any): number => {
  if (r && r.operator === 'PlusMinus') r = r.op1 ?? r;
  if (r && typeof r.re === 'number') return r.re;
  return Number(String(r?.toString() ?? '').split('±')[0].trim());
};
const numAt = (engine: any, boxed: any, v: string, p: number): number | null => {
  try { const x = reOf(boxed.subs({ [v]: engine.number(p) }).N()); return isFinite(x) ? x : null; }
  catch { return null; }
};

// MathJSON → SymPy source. Copied from wester.ts (same behavior for every head
// that appears in this set: Add/Subtract/Negate/Multiply/Divide/Power/Sqrt/
// Exp/Ln/Sin/Cos/Tan/Sinh/Cosh/Tanh/Arctan).
function mjToSympy(e: any): string {
  if (typeof e === 'number') return String(e);
  if (typeof e === 'string') return CONSTS[e] || e;
  const [h, ...a] = e;
  const A = a.map(mjToSympy);
  switch (h) {
    case 'Add': return '(' + A.join(' + ') + ')';
    case 'Subtract': return '(' + A[0] + ' - ' + A[1] + ')';
    case 'Negate': return '(-' + A[0] + ')';
    case 'Multiply': return '(' + A.join('*') + ')';
    case 'Divide': return '(' + A[0] + '/' + A[1] + ')';
    case 'Power': return '(' + A[0] + ')**(' + A[1] + ')';
    case 'Rational': return 'Rational(' + a[0] + ',' + a[1] + ')';
    case 'Sqrt': return 'sqrt(' + A[0] + ')';
    case 'Root': return '(' + A[0] + ')**(Rational(1,' + a[1] + '))';
    case 'Abs': return 'Abs(' + A[0] + ')';
    case 'Exp': return 'exp(' + A[0] + ')';
    case 'Ln': case 'Log': return 'log(' + A.join(', ') + ')';
    case 'Sin': case 'Cos': case 'Tan': case 'Cot': case 'Sec': case 'Csc':
    case 'Sinh': case 'Cosh': case 'Tanh':
      return h.toLowerCase() + '(' + A[0] + ')';
    case 'Arcsin': return 'asin(' + A[0] + ')';
    case 'Arccos': return 'acos(' + A[0] + ')';
    case 'Arctan': return 'atan(' + A[0] + ')';
    default: throw new Error('untranslatable: ' + h);
  }
}

function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function timeit(fn: () => void) {
  let t = performance.now(); fn();
  const iters = Math.min(15, Math.max(1, Math.round(60 / Math.max(performance.now() - t, 0.01))));
  const times: number[] = [];
  for (let i = 0; i < iters; i++) { t = performance.now(); fn(); times.push(performance.now() - t); }
  return median(times);
}

// --- load cases -------------------------------------------------------------
type Case = { id: string; integrand: any; varName: string; steps: number; sympyExpr: string };
const { problems, errors } = loadTestFile(join(ROOT, 'benchmarks'), 'bondarenko/bondarenko-problems.m');
if (errors.length) console.error('Bondarenko: %d parse errors', errors.length);
const cases: Case[] = [];
for (const p of problems) {
  let sympyExpr: string;
  try { sympyExpr = mjToSympy(p.integrand); } catch (e: any) { console.error('skip %d: %s', p.index, e?.message); continue; }
  cases.push({ id: `bondarenko#${p.index}`, integrand: p.integrand, varName: p.variable, steps: p.steps, sympyExpr });
}
console.error('Bondarenko: %d problems, %d runnable cases', problems.length, cases.length);

// --- numeric reference (the invariant target: the integrand itself) ---------
function refSamples(c: Case): (number | null)[] {
  const f = ce.expr(c.integrand);
  return POINTS.map((p) => numAt(ce, f, c.varName, p));
}

// --- run one configuration --------------------------------------------------
// When `engine` has the Rubi rules loaded (the CE+R/F engine), `Integrate`
// consults them automatically, so the same code path runs on every engine.
function runOn(engine: any, c: Case) {
  try {
    const build = () => engine.expr(['Integrate', c.integrand, ['Tuple', c.varName]]).evaluate();
    const timeMs = timeit(build);
    const F = build();
    if (F == null || F.operator === 'Integrate' || /\bint\(/.test(F.toString())) return { status: 'unsolved', text: F ? F.toString() : 'null', values: [], timeMs };
    const dF = engine.expr(['D', F, c.varName]).evaluate();
    const values: (number | null)[] = [], fd: boolean[] = [];
    for (const p of POINTS) {
      const v = numAt(engine, dF, c.varName, p);
      if (v != null) { values.push(v); fd.push(false); continue; }
      const hi = numAt(engine, F, c.varName, p + FD_H), lo = numAt(engine, F, c.varName, p - FD_H);
      values.push(hi == null || lo == null ? null : (hi - lo) / (2 * FD_H));
      fd.push(true);
    }
    return { status: 'ok', text: F.toString(), values, fd, timeMs };
  } catch (e: any) { return { status: 'error', error: String(e?.message ?? e).slice(0, 120) }; }
}

// --- SymPy (per-task) -------------------------------------------------------
// Unlike the Wester integrands, several Bondarenko integrands make SymPy's
// `integrate` hang indefinitely (nested radicals, log-of-radical), and
// run_sympy_wester.py runs a task list in ONE process with no per-task timeout —
// so a single hang would exhaust the whole batch. We invoke the (unmodified)
// runner one task per process with a per-task timeout, so a hang loses only that
// case (recorded as `unsolved`) and every other case still scores.
const SYMPY_TASK_TIMEOUT_MS = 25000;
function runSymPy(): Record<string, any> {
  const dir = mkdtempSync(join(tmpdir(), 'bondarenko-'));
  const tmp = join(dir, 'task.json');
  const by: Record<string, any> = {};
  let n = 0;
  for (const c of cases) {
    console.error('SymPy %d/%d', ++n, cases.length);
    const task = [{ id: c.id, op: 'integrate', expr: c.sympyExpr, var: c.varName, points: POINTS }];
    writeFileSync(tmp, JSON.stringify(task));
    // Retry a timed-out task once: a transient machine stall otherwise records
    // a solvable case as unsolved (observed: 5 spurious timeouts in one run,
    // all ≤3s when replayed solo). A genuine hang costs 2× the cap, still
    // bounded per case.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = execFileSync(PYTHON, [join(__dirname, 'run_sympy_wester.py'), tmp], { encoding: 'utf8', timeout: SYMPY_TASK_TIMEOUT_MS });
        for (const line of out.trim().split('\n')) { try { const o = JSON.parse(line); if (o.id) by[o.id] = o; } catch {} }
        break;
      } catch (e: any) {
        const isTimeout = e.killed || e.code === 'ETIMEDOUT';
        if (isTimeout && attempt === 0) { console.error('  timeout, retrying %s', c.id); continue; }
        by[c.id] = isTimeout ? { status: 'unsolved', text: 'timeout', values: [] } : { status: 'error', error: (e.message || String(e)).split('\n')[0].slice(0, 120) };
      }
    }
  }
  return by;
}

// --- Wolfram / Mathematica (batch) -----------------------------------------
// The problems are already Mathematica, so Wolfram is the natural reference.
// We translate the parsed integrand MathJSON (not the raw statement) into
// Wolfram Language and grade it with the identical invariant logic. `real: true`
// mirrors run_sympy_wester.py's `symbols(var, real=True)`.
function runWolfram(): Record<string, any> {
  const by: Record<string, any> = {};
  const tasks: any[] = [];
  for (const c of cases) {
    try {
      tasks.push({ id: c.id, op: 'integrate', expr: mathJsonToWL(c.integrand), var: c.varName, points: POINTS });
    } catch (e: any) {
      by[c.id] = { status: 'error', error: String(e?.message ?? e).slice(0, 120) };
    }
  }
  if (!tasks.length) return by;
  const tmp = join(mkdtempSync(join(tmpdir(), 'bondarenko-wl-')), 'spec.json');
  writeFileSync(tmp, JSON.stringify({ real: true, tasks }));
  try {
    const out = execFileSync(NODE, [WOLFRAM_BATCH, tmp], { encoding: 'utf8', timeout: 1800000, maxBuffer: 64 * 1024 * 1024 });
    for (const line of out.trim().split('\n')) { try { const o = JSON.parse(line); if (o.id) by[o.id] = o; } catch {} }
  } catch (e: any) { console.error('wolfram failed:', (e.message || e).toString().split('\n')[0]); }
  return by;
}

// --- grading (identical for every config) ----------------------------------
function grade(c: Case, ref: (number | null)[], res: any) {
  if (!res || res.status === 'error') return { v: 'error', note: res?.error };
  if (res.status === 'unsolved') return { v: 'unsolved' };
  const minValid = Math.min(2, ref.length);
  let valid = 0, ok = 0;
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i], g = res.values?.[i];
    if (r == null || g == null || !isFinite(r) || !isFinite(g)) continue;
    valid++;
    const tol = res.fd?.[i] ? FD_TOL : TOL; // finite-diff points carry O(h²) error
    if (Math.abs(g - r) <= tol * (1 + Math.abs(r)) + 1e-9) ok++;
  }
  if (valid < minValid) return { v: 'inconclusive' };
  if (ok < valid) return { v: 'wrong' };
  return { v: 'correct' };
}

console.error('Running CE (base) + CE+Rubi/Fungrim + SymPy + Wolfram over %d cases…', cases.length);
const sympyById = runSymPy();
console.error('SymPy done.');
const wolframById = runWolfram();
console.error('Wolfram done.');
const hasRF = !!ceRF;
const rows = cases.map((c, i) => {
  console.error('CE %d/%d %s', i + 1, cases.length, ce.expr(c.integrand).toString().slice(0, 40));
  const ref = refSamples(c);
  const ceRes = runOn(ce, c);
  const rfRes = ceRF ? runOn(ceRF, c) : null;
  const syRes = sympyById[c.id] || { status: 'error', error: 'no result' };
  const woRes = wolframById[c.id] || { status: 'error', error: 'no result' };
  return {
    c, ref,
    ce: { res: ceRes, v: grade(c, ref, ceRes) },
    rf: { res: rfRes, v: rfRes ? grade(c, ref, rfRes) : { v: 'na' } },
    sy: { res: syRes, v: grade(c, ref, syRes) },
    wo: { res: woRes, v: grade(c, ref, woRes) },
  };
});

// --- report -----------------------------------------------------------------
const SYM: Record<string, string> = { correct: '✅', partial: '🟡', wrong: '❌', unsolved: '∅', error: '⚠️', inconclusive: '·', na: '—' };
let md = '';
const w = (s = '') => { md += s + '\n'; };
const count = (pred: (r: any) => boolean) => rows.filter(pred).length;

w('# Bondarenko integration set — Compute Engine vs SymPy vs Mathematica');
w();
w('_Runner: **minified production bundles** (`dist/esm-min/*.js`, `console.assert` stripped) — CE times reflect shipped ' +
  'code. Rebuild with `npm run build production` before running._');
w();
w("Vladimir Bondarenko's 35 integration problems — an independent test set from the Rubi " +
  '[MathematicaSyntaxTestSuite](https://github.com/RuleBasedIntegration/MathematicaSyntaxTestSuite) (MIT), vendored under ' +
  '`benchmarks/bondarenko/`. These are hard nested-radical / log / transcendental integrands. Each indefinite integral is ' +
  'graded by the operation invariant **`d/dx(F) ≈ f`** sampled numerically (per-point relative tolerance ' +
  `${TOL}, ≥2 valid points required), so the suite's optimal antiderivatives aren't needed. Where the symbolic ` +
  'derivative of a CE result doesn\'t numericize (PolyLog, elliptic kernels), the point falls back to a central ' +
  `finite difference of \`F\` itself (relative tolerance ${FD_TOL}). ` +
  '✅ correct · ❌ wrong · ∅ not solved · ⚠️ error · · inconclusive (domain).');
w();
w('## Summary');
w();
w('Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + ' +
  'Fungrim; **SymPy** = the open-source comparator; **Mathematica** = the reference baseline (the CAS these problems ' +
  'are written in).');
w();
const N = cases.length;
w(`- **CE ${count((r) => r.ce.v.v === 'correct')}/${N}**` +
  (hasRF ? ` · **CE+R/F ${count((r) => r.rf.v.v === 'correct')}/${N}**` : '') +
  ` · **SymPy ${count((r) => r.sy.v.v === 'correct')}/${N}**` +
  ` · **Mathematica ${count((r) => r.wo.v.v === 'correct')}/${N}** correct.`);
w(`- Against the **Mathematica** baseline, base CE trails on **${count((r) => r.ce.v.v !== 'correct' && r.wo.v.v === 'correct')}** cases` +
  (hasRF ? `; **${count((r) => r.ce.v.v !== 'correct' && r.wo.v.v === 'correct' && r.rf.v.v === 'correct')}** of those recovered by Rubi/Fungrim` : '') + '.');
w();
w('| Operation | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'SymPy | Mathematica |');
w('|---|--:|' + (hasRF ? '--:|' : '') + '--:|--:|');
w(`| Indefinite ∫ | ${count((r) => r.ce.v.v === 'correct')}/${N} | ` +
  (hasRF ? `${count((r) => r.rf.v.v === 'correct')}/${N} | ` : '') +
  `${count((r) => r.sy.v.v === 'correct')}/${N} | ${count((r) => r.wo.v.v === 'correct')}/${N} |`);
w();

w('## Per-case results');
w();
w('| # | Steps | Integrand | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'SymPy | Mathematica | CE+R/F result |');
w('|--:|--:|---|:-:|' + (hasRF ? ':-:|' : '') + ':-:|:-:|---|');
for (const r of rows) {
  const n = r.c.id.split('#')[1];
  const steps = Number.isNaN(r.c.steps) ? '' : String(r.c.steps);
  const integrand = ce.expr(r.c.integrand).toString().replace(/\|/g, '\\|').slice(0, 40);
  const rfText = (r.rf.res?.text || '').replace(/\|/g, '\\|').slice(0, 40);
  w(`| ${n} | ${steps} | \`${integrand}\` | ${SYM[r.ce.v.v] || '·'} | ` +
    (hasRF ? `${SYM[r.rf.v.v] || '·'} | ` : '') +
    `${SYM[r.sy.v.v] || '·'} | ${SYM[r.wo.v.v] || '·'} | \`${rfText}\` |`);
}
w();
w('---');
w('_Reproduce: `npx tsx benchmarks/audit/bondarenko.ts`. One op (indefinite integration), graded by the invariant ' +
  '`d/dx(F) ≈ f`. CE times are from the minified production bundles._');

writeFileSync(join(__dirname, 'REPORT-bondarenko.md'), md);
console.error('Wrote benchmarks/audit/REPORT-bondarenko.md (%d cases)', cases.length);
