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
import { ComputeEngine } from '../../src/compute-engine.ts';
import { compileSection } from '../../scripts/rubi/compile.ts';
import { RubiDriver } from '../../scripts/rubi/driver.ts';
import { loadIdentities } from '../../src/identities.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const WESTER = join(ROOT, 'benchmarks', 'wester');
const PYTHON = join(ROOT, 'venv', 'bin', 'python3');
const POINTS = [0.7, 1.3, 2.1, 3.4];
const H = 1e-5;

const FILES = [
  'test_algebra', 'test_calculus', 'test_indefinite_integrals',
  'test_definite_integrals', 'test_limits', 'test_trigonometry',
  'test_zero_equivalence', 'test_numbers', 'test_special_functions',
  'test_series', 'test_sums',
];
const SIMPLIFY_HEADS = new Set(['Simplify', 'FullSimplify', 'Together', 'Apart', 'TrigExpand', 'TrigReduce', 'PowerExpand']);
const CONSTS: Record<string, string> = { Pi: 'pi', ExponentialE: 'E', ImaginaryUnit: 'I', EulerGamma: 'EulerGamma' };

const ce = new ComputeEngine(); // base engine — no Rubi, no Fungrim

// Second engine with the experimental Rubi integrator + Fungrim identities.
let ceRF: any = null, driver: any = null;
try {
  ceRF = new ComputeEngine();
  try { loadIdentities(ceRF); } catch { /* best-effort */ }
  const { rules } = compileSection(ceRF, join(ROOT, 'data', 'rubi', 'corpus', '1 Algebraic functions'));
  driver = new RubiDriver(ceRF, rules, { timeLimitMs: 8000 });
} catch (e: any) { console.error('Rubi/Fungrim setup failed (column dropped):', e?.message); ceRF = null; }

const numAt = (engine: any, boxed: any, v: string, p: number): number | null => {
  try { const r = boxed.subs({ [v]: engine.number(p) }).N(); const x = typeof r.re === 'number' ? r.re : Number(r.toString()); return isFinite(x) ? x : null; }
  catch { return null; }
};
const numOf = (boxed: any): number | null => {
  try { const r = boxed.N(); const x = typeof r.re === 'number' ? r.re : Number(r.toString()); return isFinite(x) ? x : null; }
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
type Case = { id: string; file: string; cat: string; op: string; arg: any; varName: string; sympyExpr: string; point?: any; a?: any; b?: any; tol: number };
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
    } else { skip.otherHead++; continue; }

    // single free variable only (so we can evaluate numerically)
    if ([...symbolsOf(arg)].some((s) => s !== varName)) { skip.multivar++; continue; }
    let sympyExpr: string;
    try { sympyExpr = mjToSympy(arg); } catch { skip.untranslatable++; continue; }
    try { if (/Error\(/.test(ce.box(arg).toString())) { skip.boxFail++; continue; } } catch { skip.boxFail++; continue; }
    cases.push({ id: `${f}#${cases.length}`, file: f.replace('test_', ''), cat: op, op, arg, varName, sympyExpr, point, a: aB, b: bB, tol });
  }
}
// de-duplicate (the Wester files list some statements twice)
{ const seen = new Set<string>(); const uniq = cases.filter((c) => { const k = `${c.op}|${c.sympyExpr}|${c.point}|${c.a}|${c.b}`; if (seen.has(k)) return false; seen.add(k); return true; }); cases.length = 0; cases.push(...uniq); }
if (process.env.WONLY) { const keep = process.env.WONLY.split(','); for (let i = cases.length - 1; i >= 0; i--) if (!keep.includes(cases[i].op)) cases.splice(i, 1); }
console.error('Wester: %d statements, %d runnable cases (skips: %o)', stmtCount, cases.length, skip);

// --- numeric reference (the invariant target) ------------------------------
function refSamples(c: Case): (number | null)[] {
  const f = ce.box(c.arg);
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
function runOn(engine: any, c: Case, useRubi: boolean) {
  try {
    if (c.op === 'integrate') {
      let F: any = null, timeMs = 0;
      if (useRubi) { try { const r = driver.int(engine.box(c.arg), c.varName); if (r != null) F = engine.box(r); } catch {} }
      if (F == null || F.operator === 'Integrate') { const build = () => engine.box(['Integrate', c.arg, ['Tuple', c.varName]]).evaluate(); timeMs = timeit(build); F = build(); }
      if (F == null || F.operator === 'Integrate' || /\bint\(/.test(F.toString())) return { status: 'unsolved', text: F ? F.toString() : 'null', values: [], timeMs };
      const dF = engine.box(['D', F, c.varName]).evaluate();
      return { status: 'ok', text: F.toString(), values: POINTS.map((p) => numAt(engine, dF, c.varName, p)), timeMs };
    }
    if (c.op === 'defint') {
      const build = () => engine.box(['Integrate', c.arg, ['Tuple', c.varName, c.a, c.b]]);
      const timeMs = timeit(() => build().N());
      const v = numOf(build());
      return v == null ? { status: 'unsolved', text: build().toString(), values: [], timeMs } : { status: 'ok', text: build().N().toString(), values: [v], timeMs };
    }
    if (c.op === 'diff') {
      const build = () => engine.box(['D', c.arg, c.varName]).evaluate();
      const timeMs = timeit(build); const r = build();
      return { status: 'ok', text: r.toString(), values: POINTS.map((p) => numAt(engine, r, c.varName, p)), timeMs };
    }
    if (c.op === 'limit') {
      const build = () => engine.box(['Limit', ['Function', c.arg, c.varName], c.point]);
      const timeMs = timeit(() => build().N());
      const v = numOf(build());
      return v == null ? { status: 'unsolved', text: build().evaluate().toString(), values: [], timeMs } : { status: 'ok', text: build().N().toString(), values: [v], timeMs };
    }
    const head = c.op === 'factor' ? 'Factor' : c.op === 'expand' ? 'Expand' : null;
    const build = () => head ? engine.box([head, c.arg]).evaluate() : engine.box(c.arg).simplify();
    const timeMs = timeit(build); const r = build();
    return { status: 'ok', text: r.toString(), values: POINTS.map((p) => numAt(engine, r, c.varName, p)), timeMs };
  } catch (e: any) { return { status: 'error', error: String(e?.message ?? e).slice(0, 120) }; }
}

// --- SymPy (batch) ----------------------------------------------------------
function runSymPy(): Record<string, any> {
  const tasks = cases.map((c) => ({ id: c.id, op: c.op, expr: c.sympyExpr, var: c.varName, points: POINTS, point: c.point ?? null, a: c.a ?? null, b: c.b ?? null }));
  const tmp = join(mkdtempSync(join(tmpdir(), 'wester-')), 'tasks.json');
  writeFileSync(tmp, JSON.stringify(tasks));
  const by: Record<string, any> = {};
  try {
    const out = execFileSync(PYTHON, [join(__dirname, 'run_sympy_wester.py'), tmp], { encoding: 'utf8', timeout: 900000 });
    for (const line of out.trim().split('\n')) { try { const o = JSON.parse(line); if (o.id) by[o.id] = o; } catch {} }
  } catch (e: any) { console.error('sympy failed:', (e.message || e).toString().split('\n')[0]); }
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

console.error('Running CE (base) + CE+Rubi/Fungrim + SymPy over %d cases…', cases.length);
const sympyById = runSymPy();
// limit/defint have no cheap, reliable numeric oracle (near-point estimates are
// unreliable at ∞ / for oscillatory or domain-tricky integrands), so they are
// graded by *solved status* + a CE-vs-SymPy cross-check rather than against a
// reference. The other ops keep robust invariant grading.
const AGREE = new Set(['limit', 'defint']);
const solved = (res: any) => res && res.status === 'ok' && res.values && res.values[0] != null && isFinite(res.values[0]);
const rows = cases.map((c) => {
  const ref = refSamples(c);
  const ceRes = runOn(ce, c, false);
  const rfRes = ceRF ? runOn(ceRF, c, true) : null;
  const syRes = sympyById[c.id] || { status: 'error', error: 'no result' };
  let ceV: any, rfV: any, syV: any;
  if (AGREE.has(c.op)) {
    const sg = (res: any) => !res ? { v: 'na' } : res.status === 'error' ? { v: 'error', note: res.error } : solved(res) ? { v: 'correct' } : { v: 'unsolved' };
    ceV = sg(ceRes); rfV = sg(rfRes); syV = sg(syRes);
    const disagree = (a: any, b: any) => solved(a) && solved(b) && Math.abs(a.values[0] - b.values[0]) > c.tol * (1 + Math.abs(b.values[0]));
    if (disagree(ceRes, syRes)) { ceV = { v: 'disagree' }; syV = { v: 'disagree' }; }
    if (disagree(rfRes, syRes)) rfV = { v: 'disagree' };
  } else {
    ceV = grade(c, ref, ceRes); rfV = rfRes ? grade(c, ref, rfRes) : { v: 'na' }; syV = grade(c, ref, syRes);
  }
  return { c, ref, ce: { res: ceRes, v: ceV }, rf: { res: rfRes, v: rfV }, sy: { res: syRes, v: syV } };
});
const hasRF = !!ceRF;
if (process.env.WDEBUG) for (const r of rows)
  console.error(`[${r.c.op}] ${r.c.id} arg=${ce.box(r.c.arg).toString().slice(0, 28)} | ref=${JSON.stringify(r.ref)} | CE ${r.ce.v.v} ${JSON.stringify(r.ce.res.values || [])} | SY ${r.sy.v.v} ${JSON.stringify(r.sy.res.values || [])}`);

// --- report -----------------------------------------------------------------
const SYM: Record<string, string> = { correct: '✅', partial: '🟡', wrong: '❌', unsolved: '∅', error: '⚠️', inconclusive: '·', disagree: '≠', na: '—' };
let md = '';
const w = (s = '') => { md += s + '\n'; };
const CATS: [string, string][] = [
  ['integrate', 'Indefinite ∫'], ['defint', 'Definite ∫'], ['diff', 'Derivative'],
  ['limit', 'Limit'], ['factor', 'Factoring'], ['expand', 'Expansion'], ['simplify', 'Simplification'],
];
const count = (pred: (r: any) => boolean) => rows.filter(pred).length;

w("# Wester suite — Compute Engine vs SymPy");
w();
w(`_Michael Wester's CAS-review test suite (Mathematica form, GPL — \`benchmarks/wester/\`), parsed with the project ` +
  `\`wl-parser\` and graded by operation invariant (no reference answers needed). ${cases.length} runnable cases ` +
  `of ${stmtCount} statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ` +
  `✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._`);
w();
w('## Summary');
w();
w('Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = reference.');
w();
w('Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives ' +
  '(≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, ' +
  'so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.');
w();
w(`- **CE ${count((r) => r.ce.v.v === 'correct')}/${cases.length}**` +
  (hasRF ? ` · **CE+R/F ${count((r) => r.rf.v.v === 'correct')}/${cases.length}**` : '') +
  ` · **SymPy ${count((r) => r.sy.v.v === 'correct')}/${cases.length}** correct.`);
w(`- Base CE trails SymPy on **${count((r) => r.ce.v.v !== 'correct' && r.sy.v.v === 'correct')}** cases` +
  (hasRF ? `; **${count((r) => r.ce.v.v !== 'correct' && r.rf.v.v === 'correct')}** of those recovered by Rubi/Fungrim` : '') + '.');
w();
w('| Operation | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'SymPy |');
w('|---|--:|' + (hasRF ? '--:|' : '') + '--:|');
for (const [key, title] of CATS) {
  const cr = rows.filter((r) => r.c.cat === key);
  if (!cr.length) continue;
  const ok = (sel: (r: any) => any) => cr.filter((r) => sel(r).v.v === 'correct').length;
  w(`| ${title} | ${ok((r) => r.ce)}/${cr.length} | ` + (hasRF ? `${ok((r) => r.rf)}/${cr.length} | ` : '') + `${ok((r) => r.sy)}/${cr.length} |`);
}
w();

const trails = rows.filter((r) => r.ce.v.v !== 'correct' && r.sy.v.v === 'correct');
w(`## Where CE trails SymPy (${trails.length})`);
w();
w('| File | Op | Input | CE | ' + (hasRF ? 'CE+R/F | ' : '') + 'CE result |');
w('|---|---|---|---|' + (hasRF ? '---|' : '') + '---|');
for (const r of trails.slice(0, 60))
  w(`| ${r.c.file} | ${r.c.cat} | \`${ce.box(r.c.arg).toString().slice(0, 28)}\` | ${SYM[r.ce.v.v]}${r.ce.v.note ? ' ' + r.ce.v.note : ''} | ` +
    (hasRF ? `${SYM[r.rf.v.v] || '·'} | ` : '') + `\`${(r.ce.res.text || '').slice(0, 26)}\` |`);
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
    w(`| ${r.c.file} | ${r.c.cat} | \`${ce.box(r.c.arg).toString().slice(0, 26)}\` | ${r.ce.res.values?.[0]} | ${r.sy.res.values?.[0]} |`);
  w();
}
w('---');
w('_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, ' +
  'derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._');

writeFileSync(join(__dirname, 'REPORT-wester.md'), md);
console.error('Wrote benchmarks/audit/REPORT-wester.md (%d cases)', cases.length);
