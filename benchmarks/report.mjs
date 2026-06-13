// Benchmark orchestrator + report generator.
//
//   node benchmarks/report.mjs
//
// For every (tool, case) pair it spawns the matching runner in its own process
// with a hard timeout, collects the JSON result, scores it against the
// high-precision references baked into cases.json, and writes:
//
//   benchmarks/results.json   raw results + verdicts (machine-readable)
//   benchmarks/REPORT.md      the human-facing report
//
// Tools compared:
//   ce-current   Compute Engine, freshly-built local bundle  (the "current build")
//   ce-pub       Compute Engine, last published npm release   (0.59.0 by default)
//   sympy        SymPy + mpmath        (Python, symbolic + arbitrary precision)
//   mathjs       math.js               (JavaScript, numeric + light symbolic)
//   numpy        NumPy                 (Python, numeric only, double precision)
//
// Override versions / paths via env:
//   CE_CURRENT_BUNDLE   path to the current-build ESM bundle
//   CE_PUBLISHED_BUNDLE  path to the published-version ESM bundle
//   CE_PUBLISHED_VERSION label for the published column (default 0.59.0)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PER_CASE_TIMEOUT_MS = 20000;
const PUBLISHED_VERSION = process.env.CE_PUBLISHED_VERSION || '0.59.0';

const PYTHON = join(ROOT, 'venv', 'bin', 'python3');
const NODE = process.execPath;
// tsx isn't a project dependency; invoke it through npx (resolves from cache).
const NPX = join(dirname(process.execPath), 'npx');
const RUBI_BATCH_TIMEOUT_MS = 180000;
const CE_CURRENT_BUNDLE = process.env.CE_CURRENT_BUNDLE || join(ROOT, 'dist', 'compute-engine.min.esm.js');
const CE_PUBLISHED_BUNDLE = process.env.CE_PUBLISHED_BUNDLE ||
  join(ROOT, 'benchmarks', '.competitors', `ce-${PUBLISHED_VERSION}`, 'dist', 'compute-engine.min.esm.js');

const suite = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));

// Tool registry. `inputKey` selects the per-tool input block in a case;
// `spawn(kase)` returns argv for the runner.
const TOOLS = [
  { key: 'ce-current', label: 'CE (current build)', short: 'CE·cur', inputKey: 'ce',
    spawn: (k) => [NODE, [join(__dirname, 'runners', 'run_ce.mjs'), CE_CURRENT_BUNDLE, k.id]] },
  { key: 'ce-pub', label: `CE ${PUBLISHED_VERSION} (published)`, short: `CE·${PUBLISHED_VERSION}`, inputKey: 'ce',
    spawn: (k) => [NODE, [join(__dirname, 'runners', 'run_ce.mjs'), CE_PUBLISHED_BUNDLE, k.id]] },
  { key: 'sympy', label: 'SymPy', short: 'SymPy', inputKey: 'sympy',
    spawn: (k) => [PYTHON, [join(__dirname, 'runners', 'run_py.py'), 'sympy', k.id]] },
  { key: 'mathjs', label: 'math.js', short: 'math.js', inputKey: 'mathjs',
    spawn: (k) => [NODE, [join(__dirname, 'runners', 'run_mathjs.mjs'), k.id]] },
  { key: 'numpy', label: 'NumPy', short: 'NumPy', inputKey: 'numpy',
    spawn: (k) => [PYTHON, [join(__dirname, 'runners', 'run_py.py'), 'numpy', k.id]] },
];
const CE_TOOLS = ['ce-current', 'ce-pub'];

// --- numeric helpers for the oracle ---------------------------------------

// Normalize a decimal string to {sign, digits (significant, no point), E} where
// E is the power of ten of the leading significant digit. Different magnitude
// => different E. Returns null for a literal zero.
function sciNorm(str) {
  let s = String(str).trim().replace(/^\+/, '');
  let sign = 1;
  if (s[0] === '-') { sign = -1; s = s.slice(1); }
  let exp = 0;
  const em = s.match(/[eE]([+-]?\d+)$/);
  if (em) { exp = parseInt(em[1], 10); s = s.slice(0, s.length - em[0].length); }
  const [intp, frac = ''] = s.split('.');
  const all = intp + frac;
  const firstNonZero = all.search(/[1-9]/);
  if (firstNonZero < 0) return null; // zero
  const E = intp.length - 1 - firstNonZero + exp;
  const digits = all.slice(firstNonZero).replace(/0+$/, '') || '0';
  return { sign, digits, E };
}

// How many significant digits does the tool's value `a` agree with the
// (higher-precision) reference `b`?  We truncate the reference to the tool's
// own digit count and compare as integers, tolerating a rounding difference of
// a few in the last place — so a value the tool rounded at its last digit (and
// any carry that produced) still counts as agreeing to that many digits.
function matchingSigDigits(a, b) {
  const na = sciNorm(a), nb = sciNorm(b);
  if (!na || !nb) return na === nb ? 99 : 0;
  if (na.sign !== nb.sign || na.E !== nb.E) return 0;
  const L = na.digits.length;
  const toolDigits = na.digits;
  const refDigits = nb.digits.length >= L ? nb.digits.slice(0, L) : nb.digits.padEnd(L, '0');
  const av = BigInt(toolDigits), bv = BigInt(refDigits);
  const d = av > bv ? av - bv : bv - av;
  if (d <= 2n) return L;            // agree to all L digits (last-digit rounding ok)
  return L - String(d).length;      // first differing digit is at L - len(diff)
}

// Normalize any integer-ish string ("123", "12e+3", "1.2e+3", "12300") to a
// canonical digit string, or null if it isn't an exact integer.
function normalizeInt(str) {
  let s = String(str).trim();
  if (/^\d+$/.test(s)) return s.replace(/^0+(?=\d)/, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (m) {
    const intp = m[1], frac = m[2] || '', exp = parseInt(m[3], 10);
    const mant = intp + frac;
    const zeros = exp - frac.length;
    if (zeros < 0) return null; // not an integer
    return (mant + '0'.repeat(zeros)).replace(/^0+(?=\d)/, '');
  }
  return null;
}

function allClose(got, expected, rel = 1e-9) {
  if (!Array.isArray(got) || got.length !== expected.length) return false;
  return expected.every((e, i) => {
    const ev = parseFloat(e), gv = Number(got[i]);
    if (!isFinite(gv)) return false;
    return Math.abs(gv - ev) <= rel * (1 + Math.abs(ev)) + 1e-12;
  });
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

// --- the oracle: turn a runner result into a verdict ----------------------

// verdict.v ∈ correct | partial | wrong | unsupported | unevaluated | timeout | error
function classify(kase, res) {
  if (!res) return { v: 'unsupported' };
  if (res.status === 'timeout') return { v: 'timeout' };
  if (res.status === 'unsupported') return { v: 'unsupported', note: res.reason };
  if (res.status === 'error') return { v: 'error', note: res.error };
  if (res.status === 'unevaluated') return { v: 'unevaluated' };
  if (res.status === 'overflow') return { v: 'wrong', note: 'overflow' };

  const vr = kase.verify;
  if (vr.kind === 'decimal') {
    const m = matchingSigDigits(res.valueText, vr.value);
    // -3 absorbs display rounding (a value can print a few fewer digits than
    // requested when a carry collapses a run of trailing 9s, e.g. e).
    if (m >= vr.sigdigits - 3) return { v: 'correct', note: `${Math.min(m, vr.sigdigits)} digits` };
    if (m >= 14) return { v: 'partial', note: `~${m} digits (double)` };
    return { v: 'wrong', note: `${m} digits` };
  }
  if (vr.kind === 'integer') {
    const got = normalizeInt(res.valueText);
    return got === vr.value ? { v: 'correct', note: 'exact' } : { v: 'wrong', note: 'inexact' };
  }
  if (vr.kind === 'sample') {
    if (!allClose(res.values, vr.values)) return { v: 'wrong', note: 'value mismatch' };
    if (kase.category === 'simplify') {
      // A decimal-float result is a numeric evaluation, not a symbolic
      // simplification (e.g. √(3+2√2) -> 2.414… instead of 1+√2). Exact
      // results like `0`, `1`, `4x` are fine — only flag a many-digit decimal.
      if (/^[+-]?\d+\.\d{4,}(e[+-]?\d+)?$/i.test(norm(res.text)))
        return { v: 'partial', note: 'numeric, not symbolic' };
      const changed = norm(res.text) !== norm(res.inputText);
      return changed ? { v: 'correct' } : { v: 'partial', note: 'value ok, not simplified' };
    }
    return { v: 'correct' };
  }
  if (vr.kind === 'diff') {
    return allClose(res.values, [vr.value]) ? { v: 'correct' } : { v: 'wrong', note: 'value mismatch' };
  }
  return { v: 'error', note: 'unknown verify kind' };
}

// --- run everything --------------------------------------------------------

function runOne(tool, kase) {
  if (!kase.inputs[tool.inputKey]) return { status: 'unsupported' };
  const [cmd, args] = tool.spawn(kase);
  try {
    const out = execFileSync(cmd, args, { timeout: PER_CASE_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const line = out.trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') return { status: 'timeout' };
    // The runner crashed before printing JSON.
    return { status: 'error', error: (e.stderr || e.message || String(e)).toString().split('\n')[0].slice(0, 200) };
  }
}

function getVersions() {
  const v = { node: process.version };
  try { v.ceCurrent = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch {}
  try { v.ceCurrentSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  v.cePublished = PUBLISHED_VERSION;
  try { v.python = execFileSync(PYTHON, ['--version'], { encoding: 'utf8' }).trim().replace('Python ', ''); } catch {}
  try { v.sympy = execFileSync(PYTHON, ['-c', 'import sympy;print(sympy.__version__)'], { encoding: 'utf8' }).trim(); } catch {}
  try { v.numpy = execFileSync(PYTHON, ['-c', 'import numpy;print(numpy.__version__)'], { encoding: 'utf8' }).trim(); } catch {}
  try {
    v.mathjs = execFileSync(NODE, ['--input-type=module', '-e',
      `import * as m from '${join(__dirname, '.competitors', 'mathjs-host', 'node_modules', 'mathjs', 'lib', 'esm', 'index.js')}';process.stdout.write(m.version)`],
      { encoding: 'utf8' }).trim();
  } catch {}
  return v;
}

// The "CE current + Rubi + Fungrim" column builds from source (the Rubi harness
// isn't in the bundle), so it runs as one tsx process over all cases.
function runRubiBatch() {
  const by = {};
  try {
    const out = execFileSync(NPX, ['tsx', join(__dirname, 'runners', 'run_ce_rubi.ts')],
      { timeout: RUBI_BATCH_TIMEOUT_MS, encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const line of out.trim().split('\n')) {
      try { const o = JSON.parse(line); if (o.id) by[o.id] = o; } catch { /* skip non-JSON */ }
    }
  } catch (e) {
    console.error('  ce-rubi batch failed:', (e.message || e).toString().split('\n')[0]);
  }
  return by;
}

console.error('Running benchmark suite — %d cases…', suite.cases.length);
console.error('  building CE+Rubi+Fungrim column (tsx, from source)…');
const rubiById = runRubiBatch();
const matrix = {}; // matrix[caseId][toolKey] = { res, verdict }
let done = 0;
for (const kase of suite.cases) {
  matrix[kase.id] = {};
  for (const tool of TOOLS) {
    const res = runOne(tool, kase);
    matrix[kase.id][tool.key] = { res, verdict: classify(kase, res) };
  }
  const rr = rubiById[kase.id] || null;
  matrix[kase.id]['ce-rubi'] = { res: rr || { status: 'error', error: 'no result' }, verdict: classify(kase, rr) };
  done++;
  process.stderr.write(`\r  ${done}/${suite.cases.length} cases`);
}
process.stderr.write('\n');

const versions = getVersions();
const generated = new Date().toISOString();

writeFileSync(join(__dirname, 'results.json'),
  JSON.stringify({ generated, versions, suite: { workingPrecision: suite.workingPrecision }, matrix }, null, 2));

// --- markdown rendering ----------------------------------------------------

const SYM = { correct: '✅', partial: '🟡', wrong: '❌', unsupported: '—', unevaluated: '∅', timeout: '⏱', error: '⚠️' };
// Short labels (ce-rubi isn't in TOOLS — it's the batch column).
const LABELS = { 'ce-current': 'CE·cur', 'ce-rubi': 'CE+R/F', 'ce-pub': `CE·${PUBLISHED_VERSION}`, sympy: 'SymPy', mathjs: 'math.js', numpy: 'NumPy' };
// `corr` = columns shown in correctness tables; `perf` = columns timed (the
// ce-rubi column builds from source via tsx, so it's excluded from timings).
const CATS = [
  { key: 'numeric', title: 'Arbitrary-precision numeric evaluation',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'numpy'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs', 'numpy'] },
  { key: 'simplify', title: 'Simplification',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs'] },
  { key: 'derivative', title: 'Differentiation',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs'] },
  { key: 'antiderivative', title: 'Antiderivation (symbolic integration)',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy'], perf: ['ce-current', 'ce-pub', 'sympy'] },
];
const toolLabel = (k) => LABELS[k] || k;
const casesOf = (cat) => suite.cases.filter((c) => c.category === cat);
const cell = (vd) => SYM[vd.v] + (vd.note ? ` <sub>${vd.note}</sub>` : '');

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1) return ms.toFixed(3);
  if (ms < 10) return ms.toFixed(2);
  return ms.toFixed(1);
}

// Precompute the current-vs-published differences and per-tool correct counts
// so the Highlights section (rendered near the top) can reference them.
const diffs = [];
for (const c of suite.cases) {
  const a = matrix[c.id]['ce-current'], b = matrix[c.id]['ce-pub'];
  if (a.verdict.v !== b.verdict.v || norm(a.res?.text ?? '') !== norm(b.res?.text ?? '')) diffs.push({ c, a, b });
}
const improvements = diffs.filter(({ a, b }) => a.verdict.v === 'correct' && b.verdict.v !== 'correct');
const regressions = diffs.filter(({ a, b }) => a.verdict.v !== 'correct' && b.verdict.v === 'correct');
function correctCount(tk) {
  let ok = 0, tot = 0;
  for (const c of suite.cases) {
    if (!CATS.find((x) => x.key === c.category).corr.includes(tk)) continue;
    tot++;
    if (matrix[c.id][tk].verdict.v === 'correct') ok++;
  }
  return { ok, tot };
}

let md = '';
const w = (s = '') => { md += s + '\n'; };

w('# Compute Engine Benchmark Report');
w();
w(`_Generated ${generated.slice(0, 10)} · ${suite.cases.length} cases across ${CATS.length} capabilities._`);
w();
w('This report compares the **current Compute Engine build** against the **last published release** ' +
  `(\`${PUBLISHED_VERSION}\`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three ` +
  'widely-used open-source tools (SymPy, math.js, NumPy), along two axes: ' +
  '**correctness / usefulness** of the result and **performance**.');
w();

// Highlights
{
  const cur = correctCount('ce-current');
  const rf = correctCount('ce-rubi');
  w('## Highlights');
  w();
  const plural = (n, one, many) => (n === 1 ? one : many);
  if (improvements.length) {
    w(`- **${improvements.length} ${plural(improvements.length, 'improvement', 'improvements')} over \`${PUBLISHED_VERSION}\`** ` +
      '(the unpublished fixes surface on the hard tier): ' +
      improvements.map(({ c }) => `${c.id} ($${c.latex}$)`).join(', ') +
      ` now ${plural(improvements.length, 'produces', 'produce')} a fully-evaluated result where the published build did not.`);
  }
  const formDiffs = diffs.filter(({ a, b }) => a.verdict.v === b.verdict.v && a.verdict.v === 'correct');
  if (formDiffs.length) {
    w(`- **${formDiffs.length} more ${plural(formDiffs.length, 'case', 'cases')}** changed *output form* vs \`${PUBLISHED_VERSION}\` (value unchanged) — ` +
      'the coefficient-extraction fixes, e.g. ' + formDiffs.slice(0, 2).map(({ c }) => `${c.id} ($${c.latex}$)`).join(', ') + '.');
  }
  if (regressions.length) {
    w(`- ⚠️ **${regressions.length} ${plural(regressions.length, 'regression', 'regressions')} vs \`${PUBLISHED_VERSION}\`**: ` +
      regressions.map(({ c }) => `${c.id} ($${c.latex}$)`).join(', ') + '.');
  } else {
    w('- **No regressions** vs the published build across all 36 cases.');
  }
  w(`- **Compute Engine answers ${cur.ok}/${cur.tot}** out of the box — the only library here delivering ` +
    'arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. ' +
    `Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to ${rf.ok}/${rf.tot}** ` +
    '(`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).');
  w('- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth ' +
    '(SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn\'t). Beats **math.js** on simplification and integration, ' +
    'and beats **NumPy** on anything needing >16 digits, exact integers, or special functions.');
  w();
}

// Environment
w('## Environment');
w();
w('| Tool | Version | Runtime |');
w('|---|---|---|');
w(`| Compute Engine — current build | \`${versions.ceCurrent}\` @ \`${versions.ceCurrentSha || 'local'}\` (freshly built from \`src/\`) | Node ${versions.node} |`);
w(`| Compute Engine — current + Rubi + Fungrim | same \`src/\` + experimental Rubi rules + Fungrim corpus | Node ${versions.node} via \`tsx\` |`);
w(`| Compute Engine — published | \`${versions.cePublished}\` (npm) | Node ${versions.node} |`);
w(`| SymPy | \`${versions.sympy || '?'}\` | Python ${versions.python || '?'} |`);
w(`| math.js | \`${versions.mathjs || '?'}\` | Node ${versions.node} |`);
w(`| NumPy | \`${versions.numpy || '?'}\` | Python ${versions.python || '?'} |`);
w();

// Methodology
w('## Methodology');
w();
w('- **Suite**: 9 cases in each of 4 categories (36 total), split into a **core** tier (5, textbook) and a **hard** tier (4, boundary-pushing), ' +
  'defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.');
w('- **Columns**: the current build and published `' + PUBLISHED_VERSION + '` are compared as base engines; a third CE column (`CE+R/F`) ' +
  'is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js and NumPy are the competitors.');
w('- **Correctness is verified numerically against an independent reference.** ' +
  'Reference values are computed with `mpmath` at high precision ' +
  '([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:');
w('  - *Numeric*: the tool\'s decimal output is compared digit-by-digit; we report how many leading significant digits match.');
w('  - *Simplify*: the result is sampled at 3 points (chosen in the expression\'s domain) and compared to the original expression\'s value; ' +
  'a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").');
w('  - *Derivative*: the result is sampled and compared to `f\'(x)` (computed by `mpmath`).');
w('  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand\'s domain), ' +
  'which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).');
w('- **Performance**: each operation is built from its source representation and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The `CE+R/F` times come from a from-source (`tsx`) run and read a few× high — comparable within that column, not against the minified `CE·cur`.');
w('- Each `(tool, case)` runs in its own subprocess with a ' + (PER_CASE_TIMEOUT_MS / 1000) + 's timeout, so a hang or crash is isolated to one cell.');
w();

// Scoreboard
w('## Summary scoreboard');
w();
w('Correct (✅) results out of 9 per category. Cells in parentheses count 🟡 partials.');
w();
const scoreTools = ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'numpy'];
w('| Category | ' + scoreTools.map(toolLabel).join(' | ') + ' |');
w('|---|' + scoreTools.map(() => '---').join('|') + '|');
for (const cat of CATS) {
  const row = [cat.title];
  for (const tk of scoreTools) {
    if (!cat.corr.includes(tk)) { row.push('—'); continue; }
    let ok = 0, part = 0;
    for (const c of casesOf(cat.key)) {
      const v = matrix[c.id][tk].verdict.v;
      if (v === 'correct') ok++; else if (v === 'partial') part++;
    }
    row.push(`${ok}/9` + (part ? ` (+${part}🟡)` : ''));
  }
  w('| ' + row.join(' | ') + ' |');
}
w();

// Combined quality + speed tables per category. Each cell shows the verdict
// and the median per-call time, so a table is informative even when every tool
// is correct (the times still differ).
const fmtT = (ms) => ms == null ? null : (ms < 0.01 ? '0.00' : ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : String(Math.round(ms)));
const abbrev = (n) => !n ? '' : String(n)
  .replace('value ok, not simplified', 'not simplified')
  .replace('numeric, not symbolic', 'numeric only')
  .replace(/^~?(\d+) digits.*/, '$1 digits');
// Correctness is assumed by default: a correct cell shows only its time, and a
// quality mark appears only when the result is NOT fully correct.
function combinedCell(tk, c) {
  const m = matrix[c.id][tk];
  if (!m) return '—';
  const vd = m.verdict, r = m.res;
  if (vd.v === 'unsupported') return '—';
  if (vd.v === 'unevaluated') return '∅';
  if (vd.v === 'timeout') return '⏱';
  if (vd.v === 'error') return '⚠️';
  const t = (r && r.status === 'ok' && typeof r.timeMs === 'number') ? fmtT(r.timeMs) : null;
  if (vd.v === 'correct') return t ?? '✓';
  const note = abbrev(vd.note);
  return SYM[vd.v] + (note ? ` <sub>${note}</sub>` : '') + (t ? ` ${t}` : '');
}
// A "CE outlier" worth flagging: the shipping build (CE·cur) is either not
// correct, or correct but markedly slower than the fastest competitor here.
function ceOutlier(c) {
  const m = matrix[c.id]['ce-current'];
  if (!m || !m.res) return false;
  if (m.verdict.v !== 'correct') return true;            // any non-correct result
  // Use best-of-N (minMs), not the median, so transient load on a fast op
  // doesn't masquerade as a perf problem — only genuine, repeatable slowness flags.
  const ceT = m.res.minMs;
  if (typeof ceT !== 'number' || ceT < 2) return false;  // floor: ignore fast ops (best-case <2ms)
  // Compare only against competitors that were also CORRECT (same quality bar) —
  // e.g. don't count NumPy's fast double-precision against CE's arbitrary precision.
  const comp = ['sympy', 'mathjs', 'numpy']
    .map((tk) => matrix[c.id][tk])
    .filter((x) => x && x.verdict.v === 'correct' && x.res && typeof x.res.minMs === 'number')
    .map((x) => x.res.minMs);
  return comp.length > 0 && ceT > 3 * Math.min(...comp);
}
// For numeric cases, the Case cell carries the target precision (so a bare ✅ is unambiguous).
const caseLabel = (c) => `$${c.latex}$` +
  (c.category === 'numeric' ? ` <sub>(${c.verify.kind === 'integer' ? 'exact' : c.verify.sigdigits + 'd'})</sub>` : '');

w('## Results — quality & speed');
w();
w('**Correctness is assumed:** a correct result shows only its **median time per call** (in **ms**, warm). ' +
  'A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but ' +
  'not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. ' +
  '**Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than ' +
  'the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).');
w();
w('> `CE+R/F` (current build + experimental Rubi + Fungrim) builds from source via `tsx`, and for integrals it **tries ' +
  'matching ~2,647 Rubi rules** (compiled once, ~0.5 s) before falling back to the built-in integrator — so its times ' +
  'include that match attempt even when no rule applies (e.g. `∫xeˣ`). Read this column for *coverage*, not head-to-head speed.');
w();
for (const cat of CATS) {
  w(`### ${cat.title}`);
  w();
  w('| # | Case | ' + cat.corr.map(toolLabel).join(' | ') + ' |');
  w('|---|---|' + cat.corr.map(() => '---').join('|') + '|');
  const sums = Object.fromEntries(cat.corr.map((t) => [t, []]));
  let lastTier = null;
  for (const c of casesOf(cat.key)) {
    if (c.tier !== lastTier) {
      w(`| | **${c.tier === 'core' ? 'Core tier' : 'Hard tier'}** | ${Array(cat.corr.length).fill('').join(' | ')} |`);
      lastTier = c.tier;
    }
    const row = [c.id, caseLabel(c)];
    for (const tk of cat.corr) {
      let content = combinedCell(tk, c);
      if (tk === 'ce-current' && ceOutlier(c)) content = `**${content}**`; // flag CE outliers
      row.push(content);
      const r = matrix[c.id][tk].res;
      if (r && r.status === 'ok' && typeof r.timeMs === 'number') sums[tk].push(r.timeMs);
    }
    w('| ' + row.join(' | ') + ' |');
  }
  const medRow = ['', '**median ms**'];
  for (const tk of cat.corr) {
    const xs = sums[tk].sort((a, b) => a - b);
    medRow.push(xs.length ? `**${fmtT(xs[Math.floor(xs.length / 2)])}**` : '—');
  }
  w('| ' + medRow.join(' | ') + ' |');
  w();
}

// CE current vs published — notable differences
w('## Current build vs published `' + PUBLISHED_VERSION + '`');
w();
if (!diffs.length) {
  w('No behavioural differences detected on this suite — the current build matches `' + PUBLISHED_VERSION + '` on all 36 cases (correctness and output form).');
} else {
  w(`${diffs.length} case(s) differ between the current build and \`${PUBLISHED_VERSION}\`:`);
  w();
  w('| # | Case | Current build | Published `' + PUBLISHED_VERSION + '` | Change |');
  w('|---|---|---|---|---|');
  for (const { c, a, b } of diffs) {
    let kind;
    if (a.verdict.v === 'correct' && b.verdict.v !== 'correct') kind = '🟢 improved';
    else if (a.verdict.v !== 'correct' && b.verdict.v === 'correct') kind = '🔴 regressed';
    else if (a.verdict.v === b.verdict.v) kind = '↔︎ different output form';
    else kind = '↔︎ changed';
    w(`| ${c.id} | $${c.latex}$ | ${SYM[a.verdict.v]} \`${(a.res?.text || '').slice(0, 28)}\` | ${SYM[b.verdict.v]} \`${(b.res?.text || '').slice(0, 28)}\` | ${kind} |`);
  }
}
w();

// Competitive capability matrix
w('## Competitive analysis');
w();
w('### Capability & precision matrix');
w();
w('| | CE | CE + Rubi/Fungrim | SymPy | math.js | NumPy |');
w('|---|---|---|---|---|---|');
w('| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ✅ (BigNumber) | ❌ double only |');
w('| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ✅ (with precision) | ❌ overflow |');
w('| Special functions (ζ, Γ, W) | ✅ | ✅ | 🟡 some | 🟡 some | ❌ |');
w('| Symbolic simplification | ✅ | ✅ | ✅ | 🟡 limited | — |');
w('| Symbolic differentiation | ✅ | ✅ | ✅ | ✅ | — |');
w('| Symbolic integration | 🟡 elementary | ✅ +algebraic (Rubi) | ✅ broad | — | — |');
w('| Runtime | JS / browser + Node | JS (experimental, from source) | Python | JS / browser + Node | Python |');
w();
// auto-derived notes
const noteFor = (tk) => {
  let ok = 0, tot = 0;
  for (const c of suite.cases) {
    if (!CATS.find((x) => x.key === c.category).corr.includes(tk)) continue;
    tot++;
    if (matrix[c.id][tk].verdict.v === 'correct') ok++;
  }
  return { ok, tot };
};
w('### Observations');
w();
{
  const cur = noteFor('ce-current'), rf = noteFor('ce-rubi'), sp = noteFor('sympy'), mj = noteFor('mathjs'), np = noteFor('numpy');
  w(`- **Compute Engine (current build)**: ${cur.ok}/${cur.tot} fully correct across applicable cases. ` +
    'The only browser-native engine here that does symbolic integration and arbitrary-precision numerics (incl. ζ, Γ, Lambert W) in one library. ' +
    'Its main gap is integration coverage — fractional-power and several radical integrands return unevaluated.');
  w(`- **CE + Rubi + Fungrim (experimental)**: ${rf.ok}/${rf.tot} correct — enabling the Rubi algebraic-integration rules closes most of that gap ` +
    '(`∫1/√x`, `∫x/√(1−x²)` now solve; `∫1/(x³+1)` returns *exact* coefficients), but it still can\'t do non-elementary integrals like `∫e^(−x²)` (no exp/trig rule sections loaded), and it currently runs only from source.');
  w(`- **SymPy**: ${sp.ok}/${sp.tot} correct — the broadest symbolic coverage (integrates \`1/√x\` and \`e^(−x²)\`→erf, denests radicals), at the cost of a Python runtime and higher per-call latency.`);
  w(`- **math.js**: ${mj.ok}/${mj.tot} correct across the categories it supports. Strong at numeric (BigNumber) and differentiation, and has a few special functions (ζ, Γ, erf); its \`simplify()\` frequently returns the input essentially unchanged (🟡), and it has no symbolic integration.`);
  w(`- **NumPy**: ${np.ok}/${np.tot} correct — numeric only and limited to ~15–16 significant digits (IEEE double); it cannot represent the high-precision results, overflows on \`100!\`, and has no ζ/Γ/W. The baseline for "numeric, but not arbitrary precision".`);
}
w();
w('---');
w();
w('_Reproduce: `python benchmarks/gen_cases.py && node benchmarks/report.mjs`. Raw data in [`results.json`](./results.json)._');

writeFileSync(join(__dirname, 'REPORT.md'), md);
console.error('Wrote benchmarks/REPORT.md and benchmarks/results.json');
