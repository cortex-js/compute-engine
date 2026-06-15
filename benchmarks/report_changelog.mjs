// CHANGELOG table generator.
//
//   node benchmarks/report_changelog.mjs            # print to stdout
//   node benchmarks/report_changelog.mjs > out.md   # …or capture
//
// Reads the curated `changelog`-tagged cases from cases.json and their measured
// results from results.json (produced by report.mjs) and emits two
// release-ready Markdown tables, meant to be pasted into CHANGELOG.md when a
// release lands meaningful performance or coverage improvements:
//
//   1. Numeric — arbitrary-precision (200-digit) evaluation, absolute median
//      ms per call (lower is better). Columns: CE current / CE published /
//      SymPy / math.js. Highlights the bignum-kernel work (Γ, ψ at high
//      precision) and arithmetic like π².
//
//   2. Symbolic — antiderivatives, derivatives, simplification, evaluation and
//      solving, as **× faster than SymPy** (SymPy_time / engine_time, so higher
//      is better; SymPy itself is `1×`). SymPy is the baseline because, versus
//      the last RELEASE, most of these cases are new capabilities (the release
//      simply fails), which would make a ratio-to-release table all `✓`/`—`.
//      `—` marks a fail / no-result; `✓` marks a case an engine solves that
//      SymPy can't. What is new this release is still visible: compare the
//      current and published CE columns (a `—` under the release next to a
//      number under the current build).
//
// The CE + Rubi/Fungrim column ("CE + R/F") loads the published Rubi
// (integration-rules) and Fungrim (identities) bundles onto the same minified
// engine, so its timings ARE comparable and shown as real speed factors.
//
// To re-run end to end:
//   npm run build production
//   ./venv/bin/python3 benchmarks/gen_cases.py
//   node benchmarks/report.mjs
//   node benchmarks/report_changelog.mjs > /tmp/changelog-tables.md
//
// Override the "current" column label (e.g. to the upcoming version) with
//   CE_CURRENT_LABEL='CE 0.60.0' node benchmarks/report_changelog.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const suite = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));
let results;
try {
  results = JSON.parse(readFileSync(join(__dirname, 'results.json'), 'utf8'));
} catch {
  console.error('error: benchmarks/results.json not found — run `node benchmarks/report.mjs` first.');
  process.exit(1);
}
const matrix = results.matrix || {};
const versions = results.versions || {};

const PUB_VERSION = versions.cePublished || '0.59.0';
const CUR_LABEL = process.env.CE_CURRENT_LABEL || 'CE (current)';
const PUB_LABEL = `CE ${PUB_VERSION}`;

// --- cell helpers ----------------------------------------------------------

const NONE = '—';

const cellOf = (id, tk) => matrix[id]?.[tk] || null;
const isCorrect = (id, tk) => cellOf(id, tk)?.verdict?.v === 'correct';
const timeOf = (id, tk) => {
  const r = cellOf(id, tk)?.res;
  return r && r.status === 'ok' && typeof r.timeMs === 'number' ? r.timeMs : null;
};

// Absolute median ms per call (numeric table). Sub-ms keeps two decimals.
function fmtMs(ms) {
  if (ms == null) return NONE;
  if (ms < 1) return ms.toFixed(2);
  if (ms < 10) return ms.toFixed(1);
  if (ms < 1000) return String(Math.round(ms));
  return (ms / 1000).toFixed(1) + ' s';
}

// A speedup factor for the symbolic table (SymPy time ÷ engine time). Higher is
// better; SymPy itself is 1×. Values < 1 (engine slower than SymPy) keep a
// decimal so they read honestly (e.g. 0.6×).
function fmtSpeedup(r) {
  if (r == null || !isFinite(r) || r <= 0) return NONE;
  if (r >= 10) return Math.round(r) + '×';
  return r.toFixed(1) + '×';
}

const md = (s) => s;
const row = (cells) => '| ' + cells.join(' | ') + ' |';

const tagged = (table) =>
  suite.cases
    .filter((c) => c.changelog && c.changelog.table === table)
    .sort((a, b) => (a.changelog.order ?? 0) - (b.changelog.order ?? 0));

let out = '';
const w = (s = '') => { out += s + '\n'; };

// ===========================================================================
// Numeric table
// ===========================================================================

const NUM_COLS = [
  { key: 'ce-current', label: CUR_LABEL },
  { key: 'ce-pub', label: PUB_LABEL },
  { key: 'sympy', label: 'SymPy' },
  { key: 'mathjs', label: 'math.js' },
];

const numCases = tagged('numeric');

w('#### Numeric performance (200-digit precision)');
w();
w('Median time per call, in **milliseconds — lower is better**. ' +
  `\`${NONE}\` means the tool returned no usable result at that precision.`);
w();
w(row(['Expression', ...NUM_COLS.map((c) => c.label)]));
w(row(['---', ...NUM_COLS.map(() => '--:')]));
for (const c of numCases) {
  const cells = NUM_COLS.map((col) =>
    isCorrect(c.id, col.key) ? fmtMs(timeOf(c.id, col.key)) : NONE
  );
  w(row([`$${c.latex}$`, ...cells]));
}
w();

// A one-line summary of the largest current-vs-published speedups, computed
// from the data so it never drifts from the table.
const speedups = numCases
  .map((c) => {
    const cur = isCorrect(c.id, 'ce-current') ? timeOf(c.id, 'ce-current') : null;
    const pub = isCorrect(c.id, 'ce-pub') ? timeOf(c.id, 'ce-pub') : null;
    return cur && pub ? { c, factor: pub / cur } : null;
  })
  .filter((x) => x && x.factor >= 2)
  .sort((a, b) => b.factor - a.factor);
if (speedups.length) {
  w('Biggest gains over `' + PUB_VERSION + '`: ' +
    speedups
      .map(({ c, factor }) => `$${c.latex}$ **${factor >= 10 ? Math.round(factor) : factor.toFixed(1)}× faster**`)
      .join(', ') + '.');
  w();
}

// ===========================================================================
// Symbolic table
// ===========================================================================

const SYM_COLS = [
  { key: 'ce-current', label: CUR_LABEL },
  { key: 'ce-rubi', label: 'CE + R/F' },
  { key: 'ce-pub', label: PUB_LABEL },
  { key: 'sympy', label: 'SymPy' },
  { key: 'mathjs', label: 'math.js' },
];

const GROUP_ORDER = ['antiderivative', 'derivative', 'simplify', 'evaluate', 'solve'];
const GROUP_TITLE = {
  antiderivative: 'Antiderivatives',
  derivative: 'Derivatives',
  simplify: 'Simplification',
  evaluate: 'Evaluation',
  solve: 'Solving',
};

// The symbolic table is baselined on **SymPy** and reads as "× faster than
// SymPy" (higher = better) — because vs the published release most of these
// cases are *new capabilities* (the baseline simply fails), so a ratio to it
// would be all `✓`/`—`. SymPy solves nearly everything here, which makes it the
// useful speed reference. Coverage still shows through: a `—` is a fail, and a
// column that solves a case SymPy *can't* shows `✓`.
function symCell(id, tk, baseTime) {
  if (!isCorrect(id, tk)) return NONE;             // this engine can't do it
  if (tk === 'sympy') return '1×';                 // the reference
  if (baseTime == null) return '✓';                // solves it, SymPy doesn't
  const t = timeOf(id, tk);
  return t == null ? '✓' : fmtSpeedup(baseTime / t); // higher = faster than SymPy
}

const symCases = tagged('symbolic');
const byGroup = {};
for (const c of symCases) (byGroup[c.changelog.group] ??= []).push(c);

w('#### Symbolic capability & performance');
w();
w('Each cell is **how many times faster than SymPy** that engine is on the case ' +
  '(`SymPy ÷ engine`, so **higher is better**; SymPy itself is `1×`). ' +
  `\`${NONE}\` means the engine can't do the case; \`✓\` means it solves a case SymPy can't. ` +
  `Compare the **${CUR_LABEL}** and **${PUB_LABEL}** columns to see what is *new this release* ` +
  `(a \`${NONE}\` under \`${PUB_VERSION}\` next to a number under the current build). ` +
  'The **CE + R/F** column is the current build with the opt-in Rubi integrator + Fungrim ' +
  'identities loaded (`loadIntegrationRules` / `loadIdentities`), on the same minified bundle.');
w();
w(row(['Operation', ...SYM_COLS.map((c) => c.label)]));
w(row(['---', ...SYM_COLS.map(() => ':--:')]));
const blankRest = SYM_COLS.map(() => '');
for (const g of GROUP_ORDER) {
  const cases = (byGroup[g] || []).sort((a, b) => (a.changelog.order ?? 0) - (b.changelog.order ?? 0));
  if (!cases.length) continue;
  w(row([`**${GROUP_TITLE[g] || g}**`, ...blankRest]));
  for (const c of cases) {
    const baseTime = isCorrect(c.id, 'sympy') ? timeOf(c.id, 'sympy') : null;
    w(row([`$${c.latex}$`, ...SYM_COLS.map((col) => symCell(c.id, col.key, baseTime))]));
  }
}
w();

// Median speedup vs SymPy across the cases the best CE configuration solves and
// SymPy also solves — a single honest headline computed from the data.
const ceBest = (id) =>
  isCorrect(id, 'ce-current') ? timeOf(id, 'ce-current')
    : isCorrect(id, 'ce-rubi') ? timeOf(id, 'ce-rubi') : null;
const symSpeedups = symCases
  .map((c) => {
    const ce = ceBest(c.id);
    const sp = isCorrect(c.id, 'sympy') ? timeOf(c.id, 'sympy') : null;
    return ce && sp ? sp / ce : null;
  })
  .filter((x) => x != null)
  .sort((a, b) => a - b);
if (symSpeedups.length) {
  const median = symSpeedups[Math.floor(symSpeedups.length / 2)];
  const max = symSpeedups[symSpeedups.length - 1];
  w(`Across the cases both solve, Compute Engine is a **median ${median >= 10 ? Math.round(median) : median.toFixed(1)}× ` +
    `faster than SymPy** (up to ${Math.round(max)}×), in the browser rather than a Python backend.`);
  w();
}

// ===========================================================================
// Provenance footnote
// ===========================================================================

w('<sub>');
w(`Measured ${(results.generated || '').slice(0, 10)} · ` +
  `Compute Engine \`${versions.ceCurrent || '?'}\`${versions.ceCurrentSha ? ` @ \`${versions.ceCurrentSha}\`` : ''} (current build) · ` +
  `published \`${PUB_VERSION}\` · ` +
  `SymPy \`${versions.sympy || '?'}\` · math.js \`${versions.mathjs || '?'}\` · Node \`${versions.node || '?'}\`. ` +
  'Correctness is verified numerically against an independent `mpmath` reference, never another tool. ' +
  'Reproduce with `npm run build production && ./venv/bin/python3 benchmarks/gen_cases.py && ' +
  'node benchmarks/report.mjs && node benchmarks/report_changelog.mjs`.');
w('</sub>');

process.stdout.write(out);
const outPath = join(__dirname, 'CHANGELOG-TABLES.md');
writeFileSync(outPath, out);
console.error(`\nWrote ${outPath}`);
