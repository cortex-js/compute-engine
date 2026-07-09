// Wester suite ingestion for the CE-vs-SymPy audit (run with `npx tsx`).
//
//   npx tsx benchmarks/audit/wester.ts
//
// Reads Michael Wester's Mathematica test files (benchmarks/wester/*.m), parses
// each statement with the project's `wl-parser` (scripts/rubi/wl-parser.ts),
// keeps the ones whose head is an operation CE supports, and runs each on three
// configurations — base CE, CE+Rubi+Fungrim, and SymPy — graded by an
// operation invariant computed numerically (so the original Out[] answers
// aren't needed):
//   - Integrate[f, x]            : d/dx(result) ≈ f
//   - Integrate[f, {x,a,b}]      : result ≈ Simpson quadrature of f over [a,b]
//   - D[f, x]                    : result ≈ central-difference derivative of f
//   - Limit[f, x->a]             : result ≈ f evaluated near a
//   - Factor/Expand/Simplify[e]  : result value-equal to e
//
// Skipped (counted in the yield report): nth derivatives, multivariate inputs,
// infinite-bound definite integrals, directional limits, untranslatable heads,
// and stateful statements (Set/Clear/%).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseWL } from '../../scripts/rubi/wl-parser.ts';
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
const WESTER = join(ROOT, 'benchmarks', 'wester');
const PYTHON = join(ROOT, 'venv', 'bin', 'python3');
const NODE = process.execPath;
const WOLFRAM_BATCH = join(__dirname, '..', 'runners', 'run_wolfram_batch.mjs');
const POINTS = [0.7, 1.3, 2.1, 3.4];
const H = 1e-5;

const FILES = [
  'test_algebra', 'test_calculus', 'test_indefinite_integrals',
  'test_definite_integrals', 'test_limits', 'test_trigonometry',
  'test_zero_equivalence', 'test_numbers', 'test_special_functions',
  'test_series', 'test_sums', 'test_equations', 'test_number_theory',
];
const SIMPLIFY_HEADS = new Set(['Simplify', 'FullSimplify', 'Together', 'Apart', 'TrigExpand', 'TrigReduce', 'PowerExpand']);
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

// Extract the central real value from a `.N()` result. A numeric definite
// integral / limit estimate comes back as `PlusMinus[value, error]` (its `.re`
// is NaN), so unwrap it to `value` — otherwise every ±-annotated result graded
// as "unsolved" (CORRECTNESS_FINDINGS #27, `numOf` mis-parse).
const reOf = (r: any): number => {
  if (r && r.operator === 'PlusMinus') r = r.op1 ?? r;
  if (r && typeof r.re === 'number') return r.re;
  return Number(String(r?.toString() ?? '').split('±')[0].trim());
};
const numAt = (engine: any, boxed: any, v: string, p: number): number | null => {
  try { const x = reOf(boxed.subs({ [v]: engine.number(p) }).N()); return isFinite(x) ? x : null; }
  catch { return null; }
};
const numOf = (boxed: any): number | null => {
  try { const x = reOf(boxed.N()); return isFinite(x) ? x : null; }
  catch { return null; }
};

function symbolsOf(e: any, acc = new Set<string>()): Set<string> {
  if (typeof e === 'string') { if (!(e in CONSTS) && /^[a-zA-Z][a-zA-Z0-9]*$/.test(e)) acc.add(e); }
  else if (Array.isArray(e)) e.slice(1).forEach((x) => symbolsOf(x, acc));
  return acc;
}

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

// --- load + categorize runnable cases --------------------------------------
type Case = { id: string; file: string; cat: string; op: string; arg: any; varName: string; sympyExpr: string; arg2?: any; sympyExpr2?: string; point?: any; a?: any; b?: any; tol: number };
const cases: Case[] = [];
const skip = { parseFail: 0, otherHead: 0, multivar: 0, definiteIter: 0, untranslatable: 0, boxFail: 0 };
let stmtCount = 0;
const isFiniteBound = (x: any) => typeof x === 'number';

for (const f of FILES) {
  let src: string;
  try { src = readFileSync(join(WESTER, f + '.m'), 'utf8'); } catch { continue; }
  const stmts = src.replace(/\(\*[\s\S]*?\*\)/g, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    stmtCount++;
    let j: any;
    try { j = parseWL(stmt); } catch { skip.parseFail++; continue; }
    if (!Array.isArray(j)) { skip.otherHead++; continue; }
    const head = j[0];
    let op = '', arg: any, varName = '', point: any, aB: any, bB: any, tol = 1e-6;

    if (head === 'Integrate') {
      arg = j[1]; const v = j[2];
      if (typeof v === 'string') { op = 'integrate'; varName = v; }
      else if (Array.isArray(v) && v[0] === 'List' && typeof v[1] === 'string' && v.length === 4) {
        if (!isFiniteBound(v[2]) || !isFiniteBound(v[3])) { skip.definiteIter++; continue; } // improper
        op = 'defint'; varName = v[1]; aB = v[2]; bB = v[3]; tol = 1e-4;
      } else { skip.definiteIter++; continue; }
    } else if (head === 'D') {
      arg = j[1]; if (typeof j[2] !== 'string') { skip.otherHead++; continue; } // nth derivative
      op = 'diff'; varName = j[2]; tol = 1e-5;
    } else if (head === 'Limit') {
      arg = j[1]; const rule = j[2];
      if (j.length > 3 || !Array.isArray(rule) || rule[0] !== 'Rule' || typeof rule[1] !== 'string') { skip.otherHead++; continue; }
      op = 'limit'; varName = rule[1]; point = rule[2]; tol = 2e-3;
    } else if (head === 'Factor' || head === 'Expand') {
      op = head.toLowerCase(); arg = j[1];
      const vs = [...symbolsOf(arg)]; if (vs.length !== 1) { skip.multivar++; continue; } varName = vs[0];
    } else if (SIMPLIFY_HEADS.has(head)) {
      op = 'simplify'; arg = j[1];
      const vs = [...symbolsOf(arg)]; if (vs.length !== 1) { skip.multivar++; continue; } varName = vs[0];
    } else if (head === 'Solve') {
      // Solve[a==b, x] (or Solve[expr, x] meaning expr = 0). Pass the *residual*
      // a−b so the Equal doesn't pre-evaluate to False; systems (List var) skipped.
      const eq = j[1], v = j[2];
      if (typeof v !== 'string') { skip.multivar++; continue; }
      if (Array.isArray(eq) && eq[0] === 'Equal' && eq.length === 3) arg = ['Subtract', eq[1], eq[2]];
      else if (Array.isArray(eq) || typeof eq === 'string' || typeof eq === 'number') arg = eq;
      else { skip.otherHead++; continue; }
      op = 'solve'; varName = v;
    } else if (head === 'PolynomialGCD' || head === 'Resultant') {
      // binary, two-polynomial ops: PolynomialGCD[p,q] / Resultant[p,q,x]
      const p = j[1], q = j[2];
      const isRes = head === 'Resultant';
      if (isRes ? (j.length !== 4 || typeof j[3] !== 'string') : j.length !== 3) { skip.otherHead++; continue; }
      const vs = [...new Set([...symbolsOf(p), ...symbolsOf(q)])];
      const vn = isRes ? j[3] : (vs.length === 1 ? vs[0] : null);
      if (!vn || vs.some((s) => s !== vn)) { skip.multivar++; continue; }
      let s1: string, s2: string;
      try { s1 = mjToSympy(p); s2 = mjToSympy(q); } catch { skip.untranslatable++; continue; }
      try { if (/Error\(/.test(ce.expr(p).toString()) || /Error\(/.test(ce.expr(q).toString())) { skip.boxFail++; continue; } } catch { skip.boxFail++; continue; }
      cases.push({ id: `${f}#${cases.length}`, file: f.replace('test_', ''), cat: isRes ? 'resultant' : 'gcd', op: isRes ? 'resultant' : 'gcd', arg: p, arg2: q, varName: vn, sympyExpr: s1, sympyExpr2: s2, tol: isRes ? 1e-4 : 1e-6 });
      continue;
    } else { skip.otherHead++; continue; }

    // single free variable only (so we can evaluate numerically)
    if ([...symbolsOf(arg)].some((s) => s !== varName)) { skip.multivar++; continue; }
    let sympyExpr: string;
    try { sympyExpr = mjToSympy(arg); } catch { skip.untranslatable++; continue; }
    try { if (/Error\(/.test(ce.expr(arg).toString())) { skip.boxFail++; continue; } } catch { skip.boxFail++; continue; }
    cases.push({ id: `${f}#${cases.length}`, file: f.replace('test_', ''), cat: op, op, arg, varName, sympyExpr, point, a: aB, b: bB, tol });
  }
}
// de-duplicate (the Wester files list some statements twice)
{ const seen = new Set<string>(); const uniq = cases.filter((c) => { const k = `${c.op}|${c.sympyExpr}|${c.sympyExpr2}|${c.point}|${c.a}|${c.b}`; if (seen.has(k)) return false; seen.add(k); return true; }); cases.length = 0; cases.push(...uniq); }
if (process.env.WONLY) { const keep = process.env.WONLY.split(','); for (let i = cases.length - 1; i >= 0; i--) if (!keep.includes(cases[i].op)) cases.splice(i, 1); }
console.error('Wester: %d statements, %d runnable cases (skips: %o)', stmtCount, cases.length, skip);

// --- numeric reference (the invariant target) ------------------------------
function refSamples(c: Case): (number | null)[] {
  if (c.op === 'solve' || c.op === 'gcd' || c.op === 'resultant') return []; // custom-graded below
  const f = ce.expr(c.arg);
  if (c.op === 'integrate') return POINTS.map((p) => numAt(ce, f, c.varName, p));           // integrand
  if (c.op === 'diff') return POINTS.map((p) => {                                            // central difference
    const hi = numAt(ce, f, c.varName, p + H), lo = numAt(ce, f, c.varName, p - H);
    return hi == null || lo == null ? null : (hi - lo) / (2 * H);
  });
  if (c.op === 'limit') {                                                                     // near-point estimate
    if (c.point === 'PositiveInfinity') return [numAt(ce, f, c.varName, 1e6)];
    if (c.point === 'NegativeInfinity') return [numAt(ce, f, c.varName, -1e6)];
    const a0 = Number(c.point);
    const hi = numAt(ce, f, c.varName, a0 + H), lo = numAt(ce, f, c.varName, a0 - H);
    if (hi == null || lo == null || Math.abs(hi - lo) > 1e-3 * (1 + Math.abs(hi))) return [null];
    return [(hi + lo) / 2];
  }
  if (c.op === 'defint') {                                                                    // composite Simpson
    const a0 = Number(c.a), b0 = Number(c.b), n = 200, h = (b0 - a0) / n;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const y = numAt(ce, f, c.varName, a0 + i * h);
      if (y == null) return [null];
      sum += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * y;
    }
    return [(h / 3) * sum];
  }
  return POINTS.map((p) => numAt(ce, f, c.varName, p));                                       // factor/expand/simplify
}

// --- run one configuration --------------------------------------------------
// When `engine` has the Rubi rules loaded (the CE+R/F engine), `Integrate`
// consults them automatically, so every op runs through the same code path on
// every engine.
function runOn(engine: any, c: Case) {
  try {
    if (c.op === 'integrate') {
      const build = () => engine.expr(['Integrate', c.arg, ['Tuple', c.varName]]).evaluate();
      const timeMs = timeit(build);
      const F = build();
      if (F == null || F.operator === 'Integrate' || /\bint\(/.test(F.toString())) return { status: 'unsolved', text: F ? F.toString() : 'null', values: [], timeMs };
      const dF = engine.expr(['D', F, c.varName]).evaluate();
      return { status: 'ok', text: F.toString(), values: POINTS.map((p) => numAt(engine, dF, c.varName, p)), timeMs };
    }
    if (c.op === 'defint') {
      const build = () => engine.expr(['Integrate', c.arg, ['Tuple', c.varName, c.a, c.b]]);
      const timeMs = timeit(() => build().N());
      const v = numOf(build());
      return v == null ? { status: 'unsolved', text: build().toString(), values: [], timeMs } : { status: 'ok', text: build().N().toString(), values: [v], timeMs };
    }
    if (c.op === 'diff') {
      const build = () => engine.expr(['D', c.arg, c.varName]).evaluate();
      const timeMs = timeit(build); const r = build();
      return { status: 'ok', text: r.toString(), values: POINTS.map((p) => numAt(engine, r, c.varName, p)), timeMs };
    }
    if (c.op === 'limit') {
      const build = () => engine.expr(['Limit', ['Function', c.arg, c.varName], c.point]);
      const timeMs = timeit(() => build().N());
      const v = numOf(build());
      return v == null ? { status: 'unsolved', text: build().evaluate().toString(), values: [], timeMs } : { status: 'ok', text: build().N().toString(), values: [v], timeMs };
    }
    if (c.op === 'solve') {
      // The public API is the `.solve()` method (the `Solve` operator doesn't
      // auto-evaluate). It returns the *real* roots.
      const build = () => engine.expr(c.arg).solve(c.varName);
      const timeMs = timeit(() => build());
      const roots: any[] = build() || [];
      if (!roots.length) return { status: 'unsolved', text: '[]', values: [], roots: [], timeMs };
      const resid = engine.expr(c.arg);
      const realRoots: number[] = [], resid_mag: number[] = [];
      for (const root of roots) {
        try {
          const rv = root.N(); const im = typeof rv.im === 'number' ? rv.im : 0;
          if (Math.abs(im) > 1e-9) continue;           // keep real roots
          const z = resid.subs({ [c.varName]: root }).N();
          realRoots.push(typeof rv.re === 'number' ? rv.re : NaN);
          resid_mag.push(Math.hypot(typeof z.re === 'number' ? z.re : 0, typeof z.im === 'number' ? z.im : 0));
        } catch { /* skip unevaluable root */ }
      }
      return { status: 'ok', text: roots.map((r) => r.toString()).join(', '), values: resid_mag, roots: realRoots, timeMs };
    }
    if (c.op === 'gcd') {
      const build = () => engine.expr(['PolynomialGCD', c.arg, c.arg2, c.varName]).evaluate();
      const timeMs = timeit(build); const r = build();
      if (r.operator === 'PolynomialGCD' || /Error/.test(r.toString())) return { status: 'unsolved', text: r.toString(), values: [], timeMs };
      return { status: 'ok', text: r.toString(), values: POINTS.map((p) => numAt(engine, r, c.varName, p)), timeMs };
    }
    if (c.op === 'resultant') {
      const build = () => engine.expr(['Resultant', c.arg, c.arg2, c.varName]).evaluate();
      const timeMs = timeit(build); const r = build();
      if (r.operator === 'Resultant') return { status: 'unsolved', text: r.toString(), values: [], timeMs };
      const v = numOf(r);
      return v == null ? { status: 'unsolved', text: r.toString(), values: [], timeMs } : { status: 'ok', text: r.toString(), values: [v], timeMs };
    }
    const head = c.op === 'factor' ? 'Factor' : c.op === 'expand' ? 'Expand' : null;
    const build = () => head ? engine.expr([head, c.arg]).evaluate() : engine.expr(c.arg).simplify();
    const timeMs = timeit(build); const r = build();
    return { status: 'ok', text: r.toString(), values: POINTS.map((p) => numAt(engine, r, c.varName, p)), timeMs };
  } catch (e: any) { return { status: 'error', error: String(e?.message ?? e).slice(0, 120) }; }
}

// --- SymPy (batch) ----------------------------------------------------------
function runSymPy(): Record<string, any> {
  const tasks = cases.map((c) => ({ id: c.id, op: c.op, expr: c.sympyExpr, expr2: c.sympyExpr2 ?? null, var: c.varName, points: POINTS, point: c.point ?? null, a: c.a ?? null, b: c.b ?? null }));
  const tmp = join(mkdtempSync(join(tmpdir(), 'wester-')), 'tasks.json');
  writeFileSync(tmp, JSON.stringify(tasks));
  const by: Record<string, any> = {};
  try {
    const out = execFileSync(PYTHON, [join(__dirname, 'run_sympy_wester.py'), tmp], { encoding: 'utf8', timeout: 900000 });
    for (const line of out.trim().split('\n')) { try { const o = JSON.parse(line); if (o.id) by[o.id] = o; } catch {} }
  } catch (e: any) { console.error('sympy failed:', (e.message || e).toString().split('\n')[0]); }
  return by;
}

// --- Wolfram / Mathematica (batch) -----------------------------------------
// The Wester files are *already* Mathematica, so Wolfram is the natural
// reference baseline here. We translate the same parsed `arg` MathJSON the other
// configs run (not the raw statement) into Wolfram Language and grade it with the
// identical invariant logic. `real: true` mirrors run_sympy_wester.py's
// `symbols(var, real=True)`.
const wlPoint = (p: any) =>
  p === 'PositiveInfinity' ? 'Infinity' : p === 'NegativeInfinity' ? '-Infinity' : String(p);

function runWolfram(): Record<string, any> {
  const by: Record<string, any> = {};
  const tasks: any[] = [];
  for (const c of cases) {
    try {
      const t: any = { id: c.id, op: c.op, expr: mathJsonToWL(c.arg), var: c.varName, points: POINTS };
      if (c.arg2 !== undefined) t.expr2 = mathJsonToWL(c.arg2);
      if (c.point !== undefined && c.point !== null) t.point = wlPoint(c.point);
      if (c.a !== undefined) t.a = c.a;
      if (c.b !== undefined) t.b = c.b;
      tasks.push(t);
    } catch (e: any) {
      by[c.id] = { status: 'error', error: String(e?.message ?? e).slice(0, 120) };
    }
  }
  if (!tasks.length) return by;
  const tmp = join(mkdtempSync(join(tmpdir(), 'wester-wl-')), 'spec.json');
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
    if (Math.abs(g - r) <= c.tol * (1 + Math.abs(r)) + 1e-9) ok++;
  }
  if (valid < minValid) return { v: 'inconclusive' };
  if (ok < valid) return { v: 'wrong' };
  if (c.op === 'factor' && /sqrt|√|abs|\|/i.test(res.text || '')) return { v: 'partial', note: 'non-polynomial form' };
  return { v: 'correct' };
}

console.error('Running CE (base) + CE+Rubi/Fungrim + SymPy + Wolfram over %d cases…', cases.length);
const sympyById = runSymPy();
const wolframById = runWolfram();
// limit/defint have no cheap, reliable numeric oracle (near-point estimates are
// unreliable at ∞ / for oscillatory or domain-tricky integrands), so they are
// graded by *solved status* + a CE-vs-SymPy cross-check rather than against a
// reference. The other ops keep robust invariant grading.
const AGREE = new Set(['limit', 'defint', 'resultant']); // single-value CE-vs-SymPy agreement
const solved = (res: any) => res && res.status === 'ok' && res.values && res.values[0] != null && isFinite(res.values[0]);
// Solve: each returned root must be sound (residual ≈ 0); a config is **correct**
// only if it's also complete — it covers every real root SymPy finds — else
// **partial** (sound but incomplete, with an "n/m roots" note).
const solveSound = (res: any) => !res ? { v: 'na' } : res.status === 'error' ? { v: 'error', note: res.error }
  : (res.status === 'unsolved' || !res.roots || res.roots.length === 0) ? { v: 'unsolved' }
    : res.values.every((v: any) => v != null && Math.abs(v) < 1e-6) ? { v: 'solved' } : { v: 'wrong' };
const covers = (a: number[], b: number[]) => b.every((br) => a.some((ar) => Math.abs(ar - br) <= 1e-6 * (1 + Math.abs(br))));
// GCD is defined up to a constant, so two gcds agree iff one is a scalar multiple
// of the other (constant ratio across sample points).
const gcdSolved = (res: any) => res && res.status === 'ok' && res.values && res.values.length >= 2 && res.values.every((v: any) => v != null && isFinite(v));
const scalarMultiple = (a: number[], b: number[]) => {
  const ratios: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null && b[i] !== 0) ratios.push(a[i] / b[i]);
  return ratios.length >= 2 && ratios.every((r) => Math.abs(r - ratios[0]) <= 1e-6 * (1 + Math.abs(ratios[0])));
};
const rows = cases.map((c) => {
  const ref = refSamples(c);
  const ceRes = runOn(ce, c);
  const rfRes = ceRF ? runOn(ceRF, c) : null;
  const syRes = sympyById[c.id] || { status: 'error', error: 'no result' };
  const woRes = wolframById[c.id] || { status: 'error', error: 'no result' };
  let ceV: any, rfV: any, syV: any, woV: any;
  if (c.op === 'solve') {
    // Completeness is judged against the reference root set; Mathematica is the
    // baseline, so its real roots define "complete" when present, else SymPy's.
    const refRoots = (woRes && woRes.roots && woRes.roots.length ? woRes.roots : (syRes && syRes.roots)) || [];
    const finalize = (v: any, res: any, against: any[]) => v.v !== 'solved' ? v
      : (against.length && !covers(res.roots || [], against)) ? { v: 'partial', note: `${(res.roots || []).length}/${against.length} roots` }
        : { v: 'correct' };
    ceV = finalize(solveSound(ceRes), ceRes, refRoots); rfV = finalize(solveSound(rfRes), rfRes, refRoots);
    syV = finalize(solveSound(syRes), syRes, refRoots);
    woV = solveSound(woRes); if (woV.v === 'solved') woV = { v: 'correct' };
  } else if (c.op === 'gcd') {
    const st = (res: any) => !res ? { v: 'na' } : res.status === 'error' ? { v: 'error', note: res.error } : gcdSolved(res) ? { v: 'correct' } : { v: 'unsolved' };
    ceV = st(ceRes); rfV = st(rfRes); syV = st(syRes); woV = st(woRes);
    if (gcdSolved(ceRes) && gcdSolved(syRes) && !scalarMultiple(ceRes.values, syRes.values)) { ceV = { v: 'disagree' }; syV = { v: 'disagree' }; }
    if (gcdSolved(rfRes) && gcdSolved(syRes) && !scalarMultiple(rfRes!.values, syRes.values)) rfV = { v: 'disagree' };
  } else if (AGREE.has(c.op)) {
    // A finite `.N()` value is NOT, by itself, correctness — that is exactly
    // how the wrong-definite-integral class (P0-1) stayed invisible
    // (CORRECTNESS_FINDINGS #27). When a trustworthy numeric reference exists
    // (defint: composite Simpson of the integrand; limit: near-point estimate,
    // when reliable) grade each config against it within tolerance. Only when
    // no reference is available (resultant, or a limit whose near-point
    // estimate was rejected as unreliable) do we fall back to solved-status +
    // a CE-vs-SymPy cross-check.
    const refVal = ref[0];
    const hasRef = refVal != null && isFinite(refVal);
    const sg = (res: any) => {
      if (!res) return { v: 'na' };
      if (res.status === 'error') return { v: 'error', note: res.error };
      if (!solved(res)) return { v: 'unsolved' };
      if (hasRef)
        return Math.abs(res.values[0] - refVal) <= c.tol * (1 + Math.abs(refVal)) + 1e-9
          ? { v: 'correct' }
          : { v: 'wrong' };
      return { v: 'correct' };
    };
    ceV = sg(ceRes); rfV = sg(rfRes); syV = sg(syRes); woV = sg(woRes);
    if (!hasRef) {
      const disagree = (a: any, b: any) => solved(a) && solved(b) && Math.abs(a.values[0] - b.values[0]) > c.tol * (1 + Math.abs(b.values[0]));
      if (disagree(ceRes, syRes)) { ceV = { v: 'disagree' }; syV = { v: 'disagree' }; }
      if (disagree(rfRes, syRes)) rfV = { v: 'disagree' };
    }
  } else {
    ceV = grade(c, ref, ceRes); rfV = rfRes ? grade(c, ref, rfRes) : { v: 'na' }; syV = grade(c, ref, syRes); woV = grade(c, ref, woRes);
  }
  return { c, ref, ce: { res: ceRes, v: ceV }, rf: { res: rfRes, v: rfV }, sy: { res: syRes, v: syV }, wo: { res: woRes, v: woV } };
});
const hasRF = !!ceRF;
if (process.env.WDEBUG) for (const r of rows)
  console.error(`[${r.c.op}] ${r.c.id} arg=${ce.expr(r.c.arg).toString().slice(0, 28)} | ref=${JSON.stringify(r.ref)} | CE ${r.ce.v.v} ${JSON.stringify(r.ce.res.values || [])} | SY ${r.sy.v.v} ${JSON.stringify(r.sy.res.values || [])} | WL ${r.wo.v.v} ${JSON.stringify(r.wo.res.values || [])}`);

// --- report -----------------------------------------------------------------
const SYM: Record<string, string> = { correct: '✅', partial: '🟡', wrong: '❌', unsolved: '∅', error: '⚠️', inconclusive: '·', disagree: '≠', na: '—' };
let md = '';
const w = (s = '') => { md += s + '\n'; };
const CATS: [string, string][] = [
  ['integrate', 'Indefinite ∫'], ['defint', 'Definite ∫'], ['diff', 'Derivative'],
  ['limit', 'Limit'], ['solve', 'Solve'], ['gcd', 'Polynomial GCD'], ['resultant', 'Resultant'],
  ['factor', 'Factoring'], ['expand', 'Expansion'], ['simplify', 'Simplification'],
];
const count = (pred: (r: any) => boolean) => rows.filter(pred).length;

w("# Wester suite — Compute Engine vs SymPy vs Mathematica");
w();
w('_Runner: **minified production bundles** (`dist/esm-min/*.js`, `console.assert` stripped) — CE times reflect shipped ' +
  'code. Rebuild with `npm run build production` before running._');
w();
w(`_Michael Wester's CAS-review test suite (Mathematica form, GPL — \`benchmarks/wester/\`), parsed with the project ` +
  `\`wl-parser\` and graded by operation invariant (no reference answers needed). ${cases.length} runnable cases ` +
  `of ${stmtCount} statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ` +
  `✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._`);
w();
w('## Summary');
w();
w('Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + ' +
  'Fungrim; **SymPy** = the open-source comparator; **Mathematica** = the reference baseline (the CAS these test ' +
  'files are written in).');
w();
w('Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives ' +
  '(≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, ' +
  'so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.');
w();
w(`- **CE ${count((r) => r.ce.v.v === 'correct')}/${cases.length}**` +
  (hasRF ? ` · **CE+R/F ${count((r) => r.rf.v.v === 'correct')}/${cases.length}**` : '') +
  ` · **SymPy ${count((r) => r.sy.v.v === 'correct')}/${cases.length}**` +
  ` · **Mathematica ${count((r) => r.wo.v.v === 'correct')}/${cases.length}** correct.`);
w(`- Against the **Mathematica** baseline, base CE trails on **${count((r) => r.ce.v.v !== 'correct' && r.wo.v.v === 'correct')}** cases` +
  (hasRF ? `; **${count((r) => r.ce.v.v !== 'correct' && r.wo.v.v === 'correct' && r.rf.v.v === 'correct')}** of those recovered by Rubi/Fungrim` : '') + '.');
w();
w('| Operation | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'SymPy | Mathematica |');
w('|---|--:|' + (hasRF ? '--:|' : '') + '--:|--:|');
for (const [key, title] of CATS) {
  const cr = rows.filter((r) => r.c.cat === key);
  if (!cr.length) continue;
  const ok = (sel: (r: any) => any) => cr.filter((r) => sel(r).v.v === 'correct').length;
  w(`| ${title} | ${ok((r) => r.ce)}/${cr.length} | ` + (hasRF ? `${ok((r) => r.rf)}/${cr.length} | ` : '') + `${ok((r) => r.sy)}/${cr.length} | ${ok((r) => r.wo)}/${cr.length} |`);
}
w();

const trails = rows.filter((r) => r.ce.v.v !== 'correct' && r.wo.v.v === 'correct');
w(`## Where CE trails Mathematica (${trails.length})`);
w();
w('| File | Op | Input | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'SymPy | Mathematica | CE result |');
w('|---|---|---|---|' + (hasRF ? '---|' : '') + '---|---|---|');
for (const r of trails.slice(0, 60))
  w(`| ${r.c.file} | ${r.c.cat} | \`${ce.expr(r.c.arg).toString().slice(0, 28)}\` | ${SYM[r.ce.v.v]}${r.ce.v.note ? ' ' + r.ce.v.note : ''} | ` +
    (hasRF ? `${SYM[r.rf.v.v] || '·'} | ` : '') + `${SYM[r.sy.v.v] || '·'} | ${SYM[r.wo.v.v] || '·'} | \`${(r.ce.res.text || '').slice(0, 26)}\` |`);
w();
const disagrees = rows.filter((r) => r.ce.v.v === 'disagree');
if (disagrees.length) {
  w(`## CE ≠ SymPy disagreements (${disagrees.length})`);
  w();
  w('_Both produced a value but they differ — at least one is wrong; worth investigating._');
  w();
  w('| File | Op | Input | CE value | SymPy value |');
  w('|---|---|---|---|---|');
  for (const r of disagrees)
    w(`| ${r.c.file} | ${r.c.cat} | \`${ce.expr(r.c.arg).toString().slice(0, 26)}\` | ${r.ce.res.values?.[0]} | ${r.sy.res.values?.[0]} |`);
  w();
}
w('---');
w('_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, ' +
  'derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._');

writeFileSync(join(__dirname, 'REPORT-wester.md'), md);
console.error('Wrote benchmarks/audit/REPORT-wester.md (%d cases)', cases.length);
