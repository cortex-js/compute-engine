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
//      SymPy / math.js / Mathematica. Highlights the bignum-kernel work (Γ, ψ at
//      high precision) and arithmetic like π².
//
//   2. Symbolic — antiderivatives, derivatives, simplification, evaluation and
//      solving, as **× faster than Mathematica** (Mathematica_time / engine_time,
//      so higher is better; Mathematica itself is `1×`). Mathematica is the
//      baseline because it is the capability ceiling — it solves essentially
//      every case — and because, versus the last RELEASE, most of these cases are
//      new capabilities (the release simply fails), which would make a
//      ratio-to-release table all `✓`/`—`. `—` marks a fail / no-result; `✓`
//      marks a case an engine solves that Mathematica can't. What is new this
//      release is still visible: compare the current and published CE columns (a
//      `—` under the release next to a number under the current build).
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

const PUB_VERSION = versions.cePublished || '0.86.1';
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

// Absolute median time per call in **microseconds** (numeric table; lower is
// better). The 200-digit constants span ~4 µs (Mathematica) to ~400 ms (the old
// published Γ/ψ kernels), so sub-10 µs keeps one decimal and larger values group
// thousands with a comma — a single unit reads more honestly than ms, where the
// fastest cells collapse to "0.00".
function fmtUs(ms) {
  if (ms == null) return NONE;
  const us = ms * 1000;
  if (us < 10) return us.toFixed(1);
  return Math.round(us)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A speedup factor for the symbolic table (Mathematica time ÷ engine time).
// Higher is better; Mathematica itself is 1×. Values < 1 (engine slower than
// Mathematica) keep enough precision to read honestly: 0.1–0.9 to one decimal
// (0.6×), and < 0.1 to two significant figures (0.04×) rather than a lossy 0.0×.
function fmtSpeedup(r) {
  if (r == null || !isFinite(r) || r <= 0) return NONE;
  if (r >= 10) return Math.round(r) + '×';
  if (r >= 0.1) return r.toFixed(1) + '×';
  return Number(r.toPrecision(1)) + '×';
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
  { key: 'wolfram', label: 'Mathematica' },
];

const numCases = tagged('numeric');

w('#### Numeric performance (200-digit precision)');
w();
w('Median time per call, in **microseconds — lower is better**. ' +
  `\`${NONE}\` means the tool returned no usable result at that precision.`);
w();
w(row(['Expression', ...NUM_COLS.map((c) => c.label)]));
w(row(['---', ...NUM_COLS.map(() => '--:')]));
for (const c of numCases) {
  const cells = NUM_COLS.map((col) =>
    isCorrect(c.id, col.key) ? fmtUs(timeOf(c.id, col.key)) : NONE
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
  { key: 'wolfram', label: 'Mathematica' },
];

const GROUP_ORDER = ['antiderivative', 'derivative', 'simplify', 'evaluate', 'solve'];
const GROUP_TITLE = {
  antiderivative: 'Antiderivatives',
  derivative: 'Derivatives',
  simplify: 'Simplification',
  evaluate: 'Evaluation',
  solve: 'Solving',
};

// The symbolic table is baselined on **Mathematica** and reads as "× faster
// than Mathematica" (higher = better) — because vs the published release most of
// these cases are *new capabilities* (the baseline simply fails), so a ratio to
// it would be all `✓`/`—`. Mathematica is the capability ceiling and solves
// essentially everything here, which makes it the natural speed reference.
// Coverage still shows through: a `—` is a fail, and a column that solves a case
// Mathematica *can't* shows `✓`.
function symCell(id, tk, baseTime) {
  if (!isCorrect(id, tk)) return NONE;             // this engine can't do it
  if (tk === 'wolfram') return '1×';               // the reference baseline
  if (baseTime == null) return '✓';                // solves it, Mathematica doesn't
  const t = timeOf(id, tk);
  return t == null ? '✓' : fmtSpeedup(baseTime / t); // higher = faster than Mathematica
}

const symCases = tagged('symbolic');
const byGroup = {};
for (const c of symCases) (byGroup[c.changelog.group] ??= []).push(c);

w('#### Symbolic capability & performance');
w();
w('Each cell is **how many times faster than Mathematica** that engine is on the case ' +
  '(`Mathematica ÷ engine`, so **higher is better**; Mathematica itself is `1×`). ' +
  `\`${NONE}\` means the engine can't do the case; \`✓\` means it solves a case Mathematica can't. ` +
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
    const baseTime = isCorrect(c.id, 'wolfram') ? timeOf(c.id, 'wolfram') : null;
    w(row([`$${c.latex}$`, ...SYM_COLS.map((col) => symCell(c.id, col.key, baseTime))]));
  }
}
w();

// Median speed of the best CE configuration relative to the Mathematica
// baseline, across the cases both solve — a single honest headline from the data.
const ceBest = (id) =>
  isCorrect(id, 'ce-current') ? timeOf(id, 'ce-current')
    : isCorrect(id, 'ce-rubi') ? timeOf(id, 'ce-rubi') : null;
const symSpeedups = symCases
  .map((c) => {
    const ce = ceBest(c.id);
    const wl = isCorrect(c.id, 'wolfram') ? timeOf(c.id, 'wolfram') : null;
    return ce && wl ? wl / ce : null;
  })
  .filter((x) => x != null)
  .sort((a, b) => a - b);
if (symSpeedups.length) {
  const median = symSpeedups[Math.floor(symSpeedups.length / 2)];
  const max = symSpeedups[symSpeedups.length - 1];
  const fmt = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1));
  if (median >= 1)
    w(`Across the cases both solve, Compute Engine is a **median ${fmt(median)}× faster than Mathematica** ` +
      `(up to ${Math.round(max)}×) — in the browser, not a proprietary kernel.`);
  else
    w(`Across the cases both solve, Compute Engine runs at a **median ${median.toFixed(1)}× the per-call speed of ` +
      `Mathematica** (up to ${Math.round(max)}× faster on its best case) — in the browser, not a proprietary kernel.`);
  w();
}

// ===========================================================================
// Provenance footnote
// ===========================================================================

w('<sub>');
w(`Measured ${(results.generated || '').slice(0, 10)} · ` +
  `Compute Engine \`${versions.ceCurrent || '?'}\`${versions.ceCurrentSha ? ` @ \`${versions.ceCurrentSha}\`` : ''} (current build) · ` +
  `published \`${PUB_VERSION}\` · ` +
  `SymPy \`${versions.sympy || '?'}\` · math.js \`${versions.mathjs || '?'}\` · Mathematica \`${versions.wolfram || '?'}\` · Node \`${versions.node || '?'}\`. ` +
  'Correctness is verified numerically against an independent `mpmath` reference, never another tool. ' +
  'Reproduce with `npm run build production && ./venv/bin/python3 benchmarks/gen_cases.py && ' +
  'node benchmarks/report.mjs && node benchmarks/report_changelog.mjs`.');
w('</sub>');

process.stdout.write(out);
const outPath = join(__dirname, 'CHANGELOG-TABLES.md');
writeFileSync(outPath, out);
console.error(`\nWrote ${outPath}`);
