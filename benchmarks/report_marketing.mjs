// Curated "marketing" comparison generator.
//
//   node benchmarks/report_marketing.mjs
//
// Reads the already-computed results.json (run report.mjs first) and emits a
// short, readable product comparison: Compute Engine vs the shipping
// competitors (SymPy, math.js, NumPy), on quality and performance.
//
// It is deliberately curated — only cases that *differentiate* the tools are
// shown (anything every package solves identically and at similar speed adds
// no information and is left out). The internal "current vs published" and
// experimental Rubi columns are not shown here; this is a product view.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(__dirname, 'cases.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(__dirname, 'results.json'), 'utf8'));
const { matrix, versions } = data;
const caseById = Object.fromEntries(suite.cases.map((c) => [c.id, c]));

// Product columns (the shipping libraries). CE = the current build.
const COLS = [
  { key: 'ce-current', label: 'Compute Engine' },
  { key: 'sympy', label: 'SymPy' },
  { key: 'mathjs', label: 'math.js' },
  { key: 'numpy', label: 'NumPy' },
];

// Curated, differentiating cases grouped by capability. Each row is here
// because the tools visibly differ on it (quality and/or performance).
const GROUPS = [
  {
    title: 'Arbitrary-precision & exact arithmetic',
    blurb: 'High-precision constants, special functions, and exact big integers.',
    ids: ['N06', 'N04', 'N08'], // π to 200 digits, 100!, Γ(1/3)
  },
  {
    title: 'Symbolic simplification',
    blurb: 'Reducing an expression to a simpler equivalent form.',
    ids: ['S01', 'S02', 'S09'], // (x²−1)/(x−1), sin²+cos², (x³−1)/(x−1)
  },
  {
    title: 'Differentiation',
    blurb: 'All three compute these correctly — here the difference is speed (see the Performance section).',
    ids: ['D06', 'D04'], // d/dx xˣ, d/dx x²·sin x
  },
  {
    title: 'Symbolic integration',
    blurb: 'Indefinite integrals — the capability JavaScript numeric libraries lack entirely.',
    ids: ['A03', 'A04', 'A06'], // ∫x·eˣ, ∫1/(1+x²), ∫1/(x³+1)
  },
];

const SYM = { correct: '✅', partial: '🟡', wrong: '❌', unsupported: '—', unevaluated: '🟡', timeout: '⏱', error: '❌' };
// Marketing notes are softened/normalized from the raw verdict notes.
function qualityCell(tk, c) {
  const m = matrix[c.id]?.[tk];
  if (!m) return '—';
  const v = m.verdict.v;
  if (v === 'unsupported') return '— <sub>not supported</sub>';
  if (v === 'unevaluated') return '🟡 <sub>not solved</sub>';
  if (v === 'correct') {
    // For numerics, show the precision the case targets (correct = matches the
    // reference to that precision); display rounding can shave a digit off the
    // raw match count, which isn't meaningful here.
    if (c.verify.kind === 'decimal') return `✅ <sub>${c.verify.sigdigits} digits</sub>`;
    if (c.verify.kind === 'integer') return '✅ <sub>exact</sub>';
    return '✅';
  }
  if (v === 'partial') return `🟡 <sub>${m.verdict.note || 'partial'}</sub>`;
  if (v === 'wrong') return `❌ <sub>${m.verdict.note || 'incorrect'}</sub>`;
  if (v === 'error') return '❌ <sub>error</sub>';
  return SYM[v] || '❌';
}

function ms(tk, c) {
  const r = matrix[c.id]?.[tk]?.res;
  return r && r.status === 'ok' && typeof r.timeMs === 'number' ? r.timeMs : null;
}
function fmtMs(x) {
  if (x == null) return '—';
  if (x < 0.01) return '<0.01 ms';
  if (x < 1) return x.toFixed(2) + ' ms';
  if (x < 100) return x.toFixed(1) + ' ms';
  return Math.round(x) + ' ms';
}

let md = '';
const w = (s = '') => { md += s + '\n'; };

w('# Compute Engine — how it compares');
w();
w(`_A quick, like-for-like comparison of Compute Engine against widely-used open-source math libraries. ${data.generated.slice(0, 10)}._`);
w();
w('**Compute Engine is the only library here that combines symbolic computation ' +
  '(simplify, differentiate, integrate) with arbitrary-precision numerics — and runs ' +
  'natively in the browser and Node.js at JavaScript speed.** SymPy matches it on ' +
  'symbolic breadth but needs a Python runtime and is markedly slower per call; math.js ' +
  'runs in JavaScript but has no symbolic integration and only light simplification; ' +
  'NumPy is numeric-only and limited to ~16 digits.');
w();

// Capability matrix
w('## At a glance');
w();
w('| Capability | Compute Engine | SymPy | math.js | NumPy |');
w('|---|:--:|:--:|:--:|:--:|');
w('| Runs in the browser (JavaScript) | ✅ | ❌ Python | ✅ | ❌ Python |');
w('| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ❌ ~16 digits |');
w('| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ❌ overflow |');
w('| Special functions (ζ, Γ, W) | ✅ | ✅ | partial | ❌ |');
w('| Symbolic simplification | ✅ | ✅ | partial | ❌ |');
w('| Symbolic differentiation | ✅ | ✅ | ✅ | ❌ |');
w('| Symbolic integration | ✅ | ✅ | ❌ | ❌ |');
w('| Typical speed per call | **sub-millisecond** | milliseconds–tens of ms | sub-ms–ms | sub-ms |');
w();
w('_Legend for the tables below: ✅ correct · 🟡 partial or not solved · ❌ incorrect · — capability not supported._');
w();

// Quality
w('## Quality');
w();
w('Each row is a case where the libraries visibly differ — cases everyone solves the ' +
  'same way are omitted. Correctness is verified numerically against an independent ' +
  '`mpmath` reference.');
w();
for (const g of GROUPS) {
  w(`### ${g.title}`);
  w();
  w(`_${g.blurb}_`);
  w();
  w('| Example | ' + COLS.map((c) => c.label).join(' | ') + ' |');
  w('|---|' + COLS.map(() => ':--:').join('|') + '|');
  for (const id of g.ids) {
    const c = caseById[id];
    if (!c) continue;
    w(`| $${c.latex}$ | ` + COLS.map((col) => qualityCell(col.key, c)).join(' | ') + ' |');
  }
  w();
}

// Performance
w('## Performance');
w();
w('Median time per call (warm). Lower is better. Compute Engine and math.js run in ' +
  'Node.js; SymPy and NumPy in Python. Symbolic operations are where the gap is widest.');
w();
const OP_LABEL = { numeric: 'Evaluate', simplify: 'Simplify', derivative: 'Differentiate', antiderivative: 'Integrate' };
const perfIds = GROUPS.flatMap((g) => g.ids);
w('| Operation | Example | Compute Engine | SymPy | math.js |');
w('|---|---|--:|--:|--:|');
const ceTimes = [], spTimes = [];
for (const id of perfIds) {
  const c = caseById[id];
  if (!c) continue;
  const ce = ms('ce-current', c), sp = ms('sympy', c), mj = ms('mathjs', c);
  // The "Nx faster" headline is about symbolic ops, so only those feed the ratio.
  if (ce != null && sp != null && c.category !== 'numeric') { ceTimes.push(ce); spTimes.push(sp); }
  // For numeric evaluation, show the precision — the rows are at different
  // precisions, so their times aren't directly comparable to one another.
  let example = `$${c.latex}$`;
  if (c.category === 'numeric') {
    const prec = c.verify.kind === 'integer' ? 'exact' : `${c.verify.sigdigits} digits`;
    example += ` <sub>(${prec})</sub>`;
  }
  w(`| ${OP_LABEL[c.category]} | ${example} | ${fmtMs(ce)} | ${fmtMs(sp)} | ${fmtMs(mj)} |`);
}
w();
if (ceTimes.length) {
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const ratio = Math.round(med(spTimes) / med(ceTimes));
  w(`On the symbolic operations shared with SymPy above, **Compute Engine is roughly ${ratio}× faster per call** ` +
    `(median ${fmtMs(med(ceTimes))} vs ${fmtMs(med(spTimes))}) — while running in the browser rather than requiring a Python backend.`);
  w();
}

// Bottom line
w('## The bottom line');
w();
w('- **Choose Compute Engine** when you need symbolic math *and* arbitrary precision in a ' +
  'web or Node.js app, with no server-side runtime and sub-millisecond response. It is the ' +
  'only option here that does symbolic integration in JavaScript.');
w('- **SymPy** remains the most comprehensive symbolic engine (it solves some hard integrals ' +
  'Compute Engine does not), and is the right choice for heavy offline computer-algebra work ' +
  'in Python — at the cost of a Python runtime and higher latency.');
w('- **math.js** is a capable JavaScript numerics library with arbitrary precision and ' +
  'differentiation, but it cannot integrate symbolically and rarely simplifies non-trivial ' +
  'expressions.');
w('- **NumPy** is the standard for fast numerical array computing, but it is double-precision ' +
  'only and does no symbolic math — a different tool for a different job.');
w();
w('---');
w();
w(`_Versions: Compute Engine ${versions.ceCurrent}, SymPy ${versions.sympy}, math.js ${versions.mathjs}, NumPy ${versions.numpy}. ` +
  'Methodology and the full case list: [REPORT.md](./REPORT.md). Reproduce: `node benchmarks/report.mjs && node benchmarks/report_marketing.mjs`._');

writeFileSync(join(__dirname, 'REPORT-marketing.md'), md);
console.error('Wrote benchmarks/REPORT-marketing.md');
