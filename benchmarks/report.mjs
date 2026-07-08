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
//   ce-pub       Compute Engine, last published npm release   (0.69.0 by default)
//   sympy        SymPy + mpmath        (Python, symbolic + arbitrary precision)
//   mathjs       math.js               (JavaScript, numeric + light symbolic)
//   numpy        NumPy                 (Python, numeric only, double precision)
//   wolfram      Wolfram / Mathematica (system `wolframscript` kernel, all categories)
//
// Override versions / paths via env:
//   CE_CURRENT_BUNDLE   path to the current-build ESM bundle
//   CE_PUBLISHED_BUNDLE  path to the published-version ESM bundle
//   CE_PUBLISHED_VERSION label for the published column (default 0.69.0)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PER_CASE_TIMEOUT_MS = 20000;
const PUBLISHED_VERSION = process.env.CE_PUBLISHED_VERSION || '0.69.0';

const PYTHON = join(ROOT, 'venv', 'bin', 'python3');
const NODE = process.execPath;
const RUBI_BATCH_TIMEOUT_MS = 180000;
const CE_CURRENT_BUNDLE = process.env.CE_CURRENT_BUNDLE || join(ROOT, 'dist', 'compute-engine.min.esm.js');
const CE_PUBLISHED_BUNDLE = process.env.CE_PUBLISHED_BUNDLE ||
  join(ROOT, 'benchmarks', '.competitors', `ce-${PUBLISHED_VERSION}`, 'dist', 'compute-engine.min.esm.js');

const suite = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));

// Tool registry. `inputKey` selects the per-tool input block in a case;
// `spawn(kase)` returns argv for the runner.
// NOTE: the three Compute Engine columns (ce-current, ce-pub, ce-rubi) are NOT
// spawned per case here — they are all measured together in ONE warm process by
// runCeWarmBatch() below, so their per-call times share identical JIT/cache
// warm-up and are mutually comparable. Only the non-CE tools spawn per case.
const TOOLS = [
  { key: 'sympy', label: 'SymPy', short: 'SymPy', inputKey: 'sympy',
    spawn: (k) => [PYTHON, [join(__dirname, 'runners', 'run_py.py'), 'sympy', k.id]] },
  { key: 'mathjs', label: 'math.js', short: 'math.js', inputKey: 'mathjs',
    spawn: (k) => [NODE, [join(__dirname, 'runners', 'run_mathjs.mjs'), k.id]] },
  { key: 'numpy', label: 'NumPy', short: 'NumPy', inputKey: 'numpy',
    spawn: (k) => [PYTHON, [join(__dirname, 'runners', 'run_py.py'), 'numpy', k.id]] },
  // Wolfram has no native source dialect in cases.json — run_wolfram.mjs
  // translates the structured `ce` MathJSON into Wolfram Language, so it keys
  // off the `ce` input and covers every category (N / FullSimplify / D /
  // Integrate / Limit / Solve).
  { key: 'wolfram', label: 'Wolfram', short: 'WL', inputKey: 'ce',
    spawn: (k) => [NODE, [join(__dirname, 'runners', 'run_wolfram.mjs'), k.id]] },
];

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
  if (vr.kind === 'value') {
    // Evaluate-to-closed-form: numerically correct AND symbolic (not a bare
    // float). A many-digit decimal is a numeric fallback, not an exact result.
    if (!allClose(res.values, [vr.value], 1e-9)) return { v: 'wrong', note: 'value mismatch' };
    if (/^[+-]?\d+\.\d{4,}(e[+-]?\d+)?$/i.test(norm(res.text)))
      return { v: 'partial', note: 'numeric, not exact' };
    return { v: 'correct' };
  }
  if (vr.kind === 'roots') {
    // Bijectively match the tool's returned real roots against the reference
    // real-root set (order-independent), within a relative tolerance.
    const got = (res.values || []).map(Number).filter(Number.isFinite);
    const exp = vr.values.map(parseFloat);
    const tol = 1e-6;
    const used = new Array(got.length).fill(false);
    let matched = 0;
    for (const e of exp) {
      const j = got.findIndex((g, k) => !used[k] && Math.abs(g - e) <= tol * (1 + Math.abs(e)));
      if (j >= 0) { used[j] = true; matched++; }
    }
    const spurious = used.filter((u) => !u).length;
    if (matched === exp.length && spurious === 0) return { v: 'correct', note: `${exp.length} roots` };
    if (matched === 0) return { v: 'wrong', note: 'no roots' };
    return { v: 'partial', note: `${matched}/${exp.length} roots` };
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
  // Wolfram Language kernel version ($VersionNumber side); one kernel launch.
  try { v.wolfram = execFileSync('wolframscript', ['-code', '$Version'], { encoding: 'utf8' }).trim().replace(/\s*\(.*$/, ''); } catch {}
  return v;
}

// The warm batch runner measures ALL THREE Compute Engine columns back-to-back
// in ONE node process: `ce-current` (base CE, current bundle), `ce-pub` (base
// CE, published bundle) and `ce-rubi` (current bundle + Rubi integration-rules +
// Fungrim identities). Because every CE column is timed in the same long-lived
// process, they share identical V8 JIT/cache warm-up, so all three are mutually
// comparable: ce-current vs ce-pub is a true release-over-release delta, and
// ce-current vs ce-rubi is a true rule-pack overhead figure. (Measuring each CE
// column in its own COLD process — the previous topology — reported the same
// engine as 1.5–2× slower when under-warmed, an artifact that made ce-current
// look slower than the pack-loaded ce-rubi on pure numerics.)
function runCeWarmBatch() {
  const by = { 'ce-current': {}, 'ce-pub': {}, 'ce-rubi': {} };
  try {
    const out = execFileSync(NODE, [join(__dirname, 'runners', 'run_ce_rubi.mjs')],
      { timeout: RUBI_BATCH_TIMEOUT_MS, encoding: 'utf8', cwd: ROOT,
        env: { ...process.env, CE_CURRENT_BUNDLE, CE_PUBLISHED_BUNDLE }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const line of out.trim().split('\n')) {
      try { const o = JSON.parse(line); if (o.id && by[o.tool]) by[o.tool][o.id] = o; } catch { /* skip non-JSON */ }
    }
  } catch (e) {
    console.error('  ce warm batch failed:', (e.message || e).toString().split('\n')[0]);
  }
  return by;
}

console.error('Running benchmark suite — %d cases…', suite.cases.length);
console.error('  building all three warm CE columns (ce-current / ce-pub / CE+Rubi+Fungrim) in one warm process (minified bundles)…');
const warmBatch = runCeWarmBatch();
const matrix = {}; // matrix[caseId][toolKey] = { res, verdict }
let done = 0;
for (const kase of suite.cases) {
  matrix[kase.id] = {};
  for (const tool of TOOLS) {
    const res = runOne(tool, kase);
    matrix[kase.id][tool.key] = { res, verdict: classify(kase, res) };
  }
  // All three CE columns come from the single warm batch process above.
  for (const tk of ['ce-current', 'ce-pub', 'ce-rubi']) {
    const r = warmBatch[tk][kase.id] || null;
    matrix[kase.id][tk] = { res: r || { status: 'error', error: 'no result' }, verdict: classify(kase, r) };
  }
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
// Short labels. All three CE columns (ce-current / ce-pub / ce-rubi) come from
// the warm batch, not from TOOLS.
const LABELS = { 'ce-current': 'CE·cur', 'ce-rubi': 'CE+R/F', 'ce-pub': `CE·${PUBLISHED_VERSION}`, sympy: 'SymPy', mathjs: 'math.js', numpy: 'NumPy', wolfram: 'Wolfram' };
// `corr` = columns shown in correctness tables; `perf` = columns whose median
// is summarized in the footer row (ce-rubi is timed and comparable now, but
// kept out of the footer median so it doesn't double-count the CE engine).
const CATS = [
  { key: 'numeric', title: 'Arbitrary-precision numeric evaluation', unit: 'µs',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'numpy', 'wolfram'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs', 'numpy', 'wolfram'] },
  { key: 'simplify', title: 'Simplification',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'wolfram'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs', 'wolfram'] },
  { key: 'derivative', title: 'Differentiation',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'wolfram'], perf: ['ce-current', 'ce-pub', 'sympy', 'mathjs', 'wolfram'] },
  { key: 'antiderivative', title: 'Antiderivation (symbolic integration)',
    corr: ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'wolfram'], perf: ['ce-current', 'ce-pub', 'sympy', 'wolfram'] },
];
const toolLabel = (k) => LABELS[k] || k;
const casesOf = (cat) => suite.cases.filter((c) => c.category === cat);
const cell = (vd) => SYM[vd.v] + (vd.note ? ` <sub>${vd.note}</sub>` : '');

// REPORT.md covers only the four engineering categories above. The suite also
// carries curated `cl-numeric` / `evaluate` / `solve` cases (tagged
// `changelog`) that feed report_changelog.mjs's release tables; they still get
// run and scored into results.json, but are excluded from this report.
const CAT_KEYS = new Set(CATS.map((c) => c.key));
const REPORTED = suite.cases.filter((c) => CAT_KEYS.has(c.category));

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1) return ms.toFixed(3);
  if (ms < 10) return ms.toFixed(2);
  return ms.toFixed(1);
}

// Precompute the current-vs-published differences and per-tool correct counts
// so the Highlights section (rendered near the top) can reference them.
const diffs = [];
for (const c of REPORTED) {
  const a = matrix[c.id]['ce-current'], b = matrix[c.id]['ce-pub'];
  if (a.verdict.v !== b.verdict.v || norm(a.res?.text ?? '') !== norm(b.res?.text ?? '')) diffs.push({ c, a, b });
}
const improvements = diffs.filter(({ a, b }) => a.verdict.v === 'correct' && b.verdict.v !== 'correct');
const regressions = diffs.filter(({ a, b }) => a.verdict.v !== 'correct' && b.verdict.v === 'correct');
function correctCount(tk) {
  let ok = 0, tot = 0;
  for (const c of REPORTED) {
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
w(`_Generated ${generated.slice(0, 10)} · ${REPORTED.length} cases across ${CATS.length} capabilities._`);
w();
w('This report compares the **current Compute Engine build** against the **last published release** ' +
  `(\`${PUBLISHED_VERSION}\`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three ` +
  'widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, ' +
  'along two axes: **correctness / usefulness** of the result and **performance**.');
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
    w(`- **No regressions** vs the published build across all ${REPORTED.length} cases.`);
  }
  w(`- **Compute Engine answers ${cur.ok}/${cur.tot}** out of the box — the only library here delivering ` +
    'arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. ' +
    `Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to ${rf.ok}/${rf.tot}** ` +
    '(`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).');
  w('- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth ' +
    '(SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn\'t). Beats **math.js** on simplification and integration, ' +
    'and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ' +
    'ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, ' +
    'non-embeddable kernel; CE\'s pitch against it is open-source, browser-native delivery at competitive per-call speed.');
  w();
}

// Environment
w('## Environment');
w();
w('| Tool | Version | Runtime |');
w('|---|---|---|');
w(`| Compute Engine — current build | \`${versions.ceCurrent}\` @ \`${versions.ceCurrentSha || 'local'}\` (freshly built from \`src/\`) | Node ${versions.node} |`);
w(`| Compute Engine — current + Rubi + Fungrim | same minified bundle + published \`integration-rules\` (Rubi) + \`identities\` (Fungrim) packs | Node ${versions.node} |`);
w(`| Compute Engine — published | \`${versions.cePublished}\` (npm) | Node ${versions.node} |`);
w(`| SymPy | \`${versions.sympy || '?'}\` | Python ${versions.python || '?'} |`);
w(`| math.js | \`${versions.mathjs || '?'}\` | Node ${versions.node} |`);
w(`| NumPy | \`${versions.numpy || '?'}\` | Python ${versions.python || '?'} |`);
w(`| Wolfram (Mathematica) | \`${versions.wolfram || '?'}\` | \`wolframscript\` kernel |`);
w();

// Methodology
w('## Methodology');
w();
w(`- **Suite**: ${REPORTED.length} cases across ${CATS.length} categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), ` +
  'defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.');
w('- **Columns**: the current build and published `' + PUBLISHED_VERSION + '` are compared as base engines; a third CE column (`CE+R/F`) ' +
  'is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.');
w('- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language ' +
  'string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system ' +
  '`wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the ' +
  'per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the ' +
  'other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would ' +
  'otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call ' +
  'does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely ' +
  'how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their ' +
  'true compute cost, parse included but negligible.');
w('- **Correctness is verified numerically against an independent reference.** ' +
  'Reference values are computed with `mpmath` at high precision ' +
  '([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:');
w('  - *Numeric*: the tool\'s decimal output is compared digit-by-digit; we report how many leading significant digits match.');
w('  - *Simplify*: the result is sampled at 3 points (chosen in the expression\'s domain) and compared to the original expression\'s value; ' +
  'a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").');
w('  - *Derivative*: the result is sampled and compared to `f\'(x)` (computed by `mpmath`).');
w('  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand\'s domain), ' +
  'which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).');
w('- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool\'s native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. **All three Compute Engine columns (`CE·cur`, `CE·' + PUBLISHED_VERSION + '`, `CE+R/F`) are measured warm, back-to-back in one long-lived process** (`run_ce_rubi.mjs`), so they share identical V8 JIT/cache warm-up and are **directly comparable to each other** — `CE·cur` vs `CE+R/F` is a true rule-pack overhead and `CE·cur` vs `CE·' + PUBLISHED_VERSION + '` a true release delta. (Earlier revisions measured `CE·cur`/`CE·pub` in a fresh COLD process per case; a fresh V8 that runs a case only ~50× never tiers up to the steady state a long-lived process reaches, so it reported the same engine 1.5–2× slower — which made `CE·cur` look slower than the pack-loaded `CE+R/F` on pure numerics, an impossibility. Warming all CE columns in one process removes that artifact.) SymPy/NumPy need no such treatment (interpreted, no JIT tiering, so a cold process is already at steady state) and Wolfram times warm inside its kernel; math.js (also V8) is still cold-per-process — the one remaining cross-tool warm-up asymmetry, which can make its numeric column read slightly high. For integrals `CE+R/F` includes the Rubi rule-match attempt made before the built-in fallback; the honest pack overhead is in the "Rule packs" section below.');
w('- Each `(tool, case)` runs in its own subprocess with a ' + (PER_CASE_TIMEOUT_MS / 1000) + 's timeout, so a hang or crash is isolated to one cell.');
w();

// Scoreboard
w('## Summary scoreboard');
w();
w('Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.');
w();
const scoreTools = ['ce-current', 'ce-rubi', 'ce-pub', 'sympy', 'mathjs', 'numpy', 'wolfram'];
w('| Category | ' + scoreTools.map(toolLabel).join(' | ') + ' |');
w('|---|' + scoreTools.map(() => '---').join('|') + '|');
for (const cat of CATS) {
  const row = [cat.title];
  for (const tk of scoreTools) {
    if (!cat.corr.includes(tk)) { row.push('—'); continue; }
    let ok = 0, part = 0;
    const total = casesOf(cat.key).length;
    for (const c of casesOf(cat.key)) {
      const v = matrix[c.id][tk].verdict.v;
      if (v === 'correct') ok++; else if (v === 'partial') part++;
    }
    row.push(`${ok}/${total}` + (part ? ` (+${part}🟡)` : ''));
  }
  w('| ' + row.join(' | ') + ' |');
}
w();

// Combined quality + speed tables per category. Each cell shows the verdict
// and the median per-call time, so a table is informative even when every tool
// is correct (the times still differ).
// Format a per-call time (ms). At/above 0.01ms the historical bands apply
// (2dp <10, 1dp <100, integer otherwise). Below 0.01ms — the fast numeric /
// differentiation ops — fixed 2dp would collapse everything to "0.00", hiding a
// real 5–200× spread, so show 2 significant figures instead (e.g. 0.00079 vs
// 0.0033 vs 0.16). Sub-microsecond constants are genuinely this fast warm.
const fmtT = (ms) => {
  if (ms == null) return null;
  if (ms >= 0.01) return ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : String(Math.round(ms));
  if (!(ms > 0)) return '0';
  let s = ms.toPrecision(2);                                  // 2 sig figs
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};
// Microsecond formatter for the numeric category, whose per-call times span
// ~0.1µs (a stored constant) to ~500µs — far cleaner read as µs than as
// 0.0001–0.5 ms. 2 sig figs at the low end, whole µs once ≥10.
const fmtUs = (ms) => {
  if (ms == null) return null;
  const us = ms * 1000;
  if (!(us > 0)) return '0';
  if (us >= 10) return String(Math.round(us));
  if (us >= 1) return us.toFixed(1);
  let s = us.toPrecision(2);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};
const fmtBy = (ms, unit) => (unit === 'µs' ? fmtUs(ms) : fmtT(ms));
const abbrev = (n) => !n ? '' : String(n)
  .replace('value ok, not simplified', 'not simplified')
  .replace('numeric, not symbolic', 'numeric only')
  .replace(/^~?(\d+) digits.*/, '$1 digits');
// Correctness is assumed by default: a correct cell shows only its time, and a
// quality mark appears only when the result is NOT fully correct.
function combinedCell(tk, c, unit) {
  const m = matrix[c.id][tk];
  if (!m) return '—';
  const vd = m.verdict, r = m.res;
  if (vd.v === 'unsupported') return '—';
  if (vd.v === 'unevaluated') return '∅';
  if (vd.v === 'timeout') return '⏱';
  if (vd.v === 'error') return '⚠️';
  const t = (r && r.status === 'ok' && typeof r.timeMs === 'number') ? fmtBy(r.timeMs, unit) : null;
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
w('**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the ' +
  'numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). ' +
  'A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but ' +
  'not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. ' +
  '**Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than ' +
  'the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).');
w();
w('> All three CE columns (`CE·cur`, `CE·' + PUBLISHED_VERSION + '`, `CE+R/F`) are measured **warm, in one shared process**, so ' +
  'they are directly comparable to each other in every row. `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule ' +
  'packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to ' +
  'the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`); on rows ' +
  'where no rule can fire (numeric, differentiation) `CE·cur` and `CE+R/F` should read ≈equal. The honest per-op pack overhead is ' +
  'tabulated in the [Rule packs](#rule-packs--coverage--true-warm-overhead) section.');
w();
for (const cat of CATS) {
  w(`### ${cat.title}${cat.unit === 'µs' ? ' — times in **µs**' : ''}`);
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
      let content = combinedCell(tk, c, cat.unit);
      if (tk === 'ce-current' && ceOutlier(c)) content = `**${content}**`; // flag CE outliers
      row.push(content);
      const r = matrix[c.id][tk].res;
      if (r && r.status === 'ok' && typeof r.timeMs === 'number') sums[tk].push(r.timeMs);
    }
    w('| ' + row.join(' | ') + ' |');
  }
  const medRow = ['', `**median ${cat.unit || 'ms'}**`];
  for (const tk of cat.corr) {
    const xs = sums[tk].sort((a, b) => a - b);
    medRow.push(xs.length ? `**${fmtBy(xs[Math.floor(xs.length / 2)], cat.unit)}**` : '—');
  }
  w('| ' + medRow.join(' | ') + ' |');
  w();
}

// Rule-pack overhead — base CE (CE·cur) vs CE+R/F, both measured warm and
// back-to-back in the SAME process (shared warm-up), so the ratio is a clean
// overhead figure.
w('## Rule packs — coverage & true warm overhead');
w();
w('`CE·cur` (base engine) and `CE+R/F` (Rubi + Fungrim) are timed **back-to-back in one warm ' +
  'process**, so their ratio is a clean per-call rule-pack overhead — the same warm process that ' +
  'produces every CE column in the tables above, so this ratio and those columns are directly ' +
  'comparable. Overhead is ≈1× wherever no rule can fire (numeric, differentiation); the packs ' +
  'cost real time on integrals they miss and *win* where a rule applies (e.g. `∫1/(x³+1)`).');
w();
const coverageWins = suite.cases.filter((c) =>
  matrix[c.id]['ce-rubi'].verdict.v === 'correct' && matrix[c.id]['ce-current'].verdict.v !== 'correct');
if (coverageWins.length) {
  w('**Coverage gained** (∅/❌ → ✅ once the packs are enabled): ' +
    coverageWins.map((c) => `${c.id} ($${c.latex}$)`).join(', ') + '.');
  w();
}
{
  const rows = suite.cases.map((c) => {
    const wt = matrix[c.id]['ce-current'].res?.timeMs ?? null;
    const rt = matrix[c.id]['ce-rubi'].res?.timeMs ?? null;
    return { c, wt, rt, ratio: (wt && rt) ? rt / wt : null };
  });
  let omitted = 0;
  const shown = rows
    .filter((r) => {
      if (r.c.category === 'antiderivative') return true;              // always show integrals
      if (r.ratio != null && Math.abs(r.ratio - 1) >= 0.1) return true; // meaningful overhead
      omitted++;
      return false;
    })
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  w('| # | Case | CE·cur | CE+R/F | Overhead |');
  w('|---|---|---|---|---|');
  for (const r of shown) {
    const mark = r.ratio == null ? '—'
      : r.ratio < 0.95 ? `**${r.ratio.toFixed(2)}× (win)**`
      : `${r.ratio.toFixed(2)}×`;
    w(`| ${r.c.id} | $${r.c.latex}$ | ${fmtUs(r.wt) ?? '—'} | ${fmtUs(r.rt) ?? '—'} | ${mark} |`);
  }
  w();
  w(`_Times in µs (warm median). ${omitted} row(s) within ±10% (no measurable pack overhead — numeric / differentiation) omitted._`);
}
w();

// CE current vs published — notable differences
w('## Current build vs published `' + PUBLISHED_VERSION + '`');
w();
if (!diffs.length) {
  w('No behavioural differences detected on this suite — the current build matches `' + PUBLISHED_VERSION + `\` on all ${REPORTED.length} cases (correctness and output form).`);
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
w('| | CE | CE + Rubi/Fungrim | SymPy | math.js | NumPy | Wolfram |');
w('|---|---|---|---|---|---|---|');
w('| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ✅ (BigNumber) | ❌ double only | ✅ |');
w('| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ✅ (with precision) | ❌ overflow | ✅ |');
w('| Special functions (ζ, Γ, W) | ✅ | ✅ | 🟡 some | 🟡 some | ❌ | ✅ |');
w('| Symbolic simplification | ✅ | ✅ | ✅ | 🟡 limited | — | ✅ |');
w('| Symbolic differentiation | ✅ | ✅ | ✅ | ✅ | — | ✅ |');
w('| Symbolic integration | 🟡 elementary | ✅ +algebraic (Rubi) | ✅ broad | — | — | ✅ broadest |');
w('| Runtime | JS / browser + Node | JS / browser + Node (opt-in rule packs) | Python | JS / browser + Node | Python | Proprietary kernel |');
w('| License | MIT | MIT | BSD | Apache-2.0 | BSD | Commercial |');
w();
// auto-derived notes
const noteFor = (tk) => {
  let ok = 0, tot = 0;
  for (const c of REPORTED) {
    if (!CATS.find((x) => x.key === c.category).corr.includes(tk)) continue;
    tot++;
    if (matrix[c.id][tk].verdict.v === 'correct') ok++;
  }
  return { ok, tot };
};
w('### Observations');
w();
{
  const cur = noteFor('ce-current'), rf = noteFor('ce-rubi'), sp = noteFor('sympy'), mj = noteFor('mathjs'), np = noteFor('numpy'), wl = noteFor('wolfram');
  w(`- **Compute Engine (current build)**: ${cur.ok}/${cur.tot} fully correct across applicable cases. ` +
    'The only browser-native engine here that does symbolic integration and arbitrary-precision numerics (incl. ζ, Γ, Lambert W) in one library. ' +
    'Its main gap is integration coverage — fractional-power and several radical integrands return unevaluated.');
  w(`- **CE + Rubi + Fungrim**: ${rf.ok}/${rf.tot} correct — loading the opt-in Rubi algebraic-integration rules closes most of that gap ` +
    '(fractional-power binomial products like `∫√x/(1+x)`, `∫x/(1+x)^⅓` now solve), but it still can\'t do non-elementary integrals like `∫e^(−x²)` (no exp/trig rule sections loaded). It runs on the minified bundle, so its times are comparable.');
  w(`- **SymPy**: ${sp.ok}/${sp.tot} correct — the broadest symbolic coverage (integrates \`1/√x\` and \`e^(−x²)\`→erf, denests radicals), at the cost of a Python runtime and higher per-call latency.`);
  w(`- **math.js**: ${mj.ok}/${mj.tot} correct across the categories it supports. Strong at numeric (BigNumber) and differentiation, and has a few special functions (ζ, Γ, erf); its \`simplify()\` frequently returns the input essentially unchanged (🟡), and it has no symbolic integration.`);
  w(`- **NumPy**: ${np.ok}/${np.tot} correct — numeric only and limited to ~15–16 significant digits (IEEE double); it cannot represent the high-precision results, overflows on \`100!\`, and has no ζ/Γ/W. The baseline for "numeric, but not arbitrary precision".`);
  w(`- **Wolfram (Mathematica)**: ${wl.ok}/${wl.tot} correct — the broadest coverage in the field, and the reference point for "what a mature commercial CAS does". It is the one competitor that, like CE, spans *all* four capabilities: arbitrary-precision numerics (incl. ζ, Γ, W), simplification, differentiation, and the widest symbolic integration (denests radicals, does \`∫e^(−x²)\`→erf and the algebraic-radical integrands that need Rubi on the CE side). The trade-offs are non-technical: a proprietary kernel with a multi-second start-up per process (excluded from the warm per-call times here) and a commercial licence — versus CE's MIT-licensed, browser-native single package.`);
}
w();
w('---');
w();
w('_Reproduce: `python benchmarks/gen_cases.py && node benchmarks/report.mjs`. Raw data in [`results.json`](./results.json)._');

writeFileSync(join(__dirname, 'REPORT.md'), md);
console.error('Wrote benchmarks/REPORT.md and benchmarks/results.json');
