/* One-command driver for the BigDecimal primitive-op microbench.
 *
 *   node benchmarks/big-decimal/run-ops.mjs
 *
 * Spawns one FRESH PROCESS per (column, precision) — BigDecimal.precision is a
 * process-global and the constant caches (ln10/π/ln2) are single-entry, so a
 * fresh process per precision keeps each block honest (no cross-precision cache
 * thrash). Columns:
 *   - CE HEAD    : dist/esm-min/compute-engine.js (current working-tree build)
 *   - CE 0.86.1  : benchmarks/.competitors/ce-0.86.1/dist/... (last published)
 *   - mpmath     : ./venv/bin/python3 ops-bench.py (raw bignum reference)
 *
 * Writes ops-results.json (machine-readable sidecar for diffing across runs)
 * and prints the Markdown tables to stdout for pasting into BIGNUM-COMPARISON.md.
 *
 * Env overrides: PRECS="21,50,100" BUDGET=200 to shorten a smoke run.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PRECS = (process.env.PRECS ?? '21,50,100,200,500').split(',').map(Number);
const BUDGET = Number(process.env.BUDGET ?? 250);

const CUR = resolve(ROOT, 'dist/esm-min/compute-engine.js');
const OLD = resolve(ROOT, 'benchmarks/.competitors/ce-0.86.1/dist/esm-min/compute-engine.js');
const PY = resolve(ROOT, 'venv/bin/python3');
const MJS = resolve(HERE, 'ops-bench.mjs');
const PYB = resolve(HERE, 'ops-bench.py');

const COLUMNS = [
  ['CE HEAD', 'node', [MJS, CUR, null, String(BUDGET), 'CE HEAD']],
  ['CE 0.86.1', 'node', [MJS, OLD, null, String(BUDGET), 'CE 0.86.1']],
  ['mpmath', PY, [PYB, null, String(BUDGET)]],
];

function runCell(cmd, argsTemplate, prec) {
  const args = argsTemplate.map((a) => (a === null ? String(prec) : a));
  const bin = cmd === 'node' ? process.execPath : cmd;
  const out = execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split('\n').pop());
}

// results[col][prec][op] = perOp ns
//
// INTERLEAVED cell order: precision outer, column inner, so the columns being
// compared run back-to-back within seconds of each other. With column-outer
// order the first and last column ran ~75s apart, and machine-state drift
// (thermal, background load) landed asymmetrically on one column — observed
// as a 4x inflation of whichever column ran during a busy spell. Same lesson
// as the cross-library harness (all CE columns warm in one process).
const results = {};
const opOrder = [];
for (const [name] of COLUMNS) results[name] = {};
process.stderr.write(`Running ops-bench: precisions=${PRECS.join(',')} budget=${BUDGET}ms\n`);
for (const prec of PRECS) {
  for (const [name, cmd, tpl] of COLUMNS) {
    process.stderr.write(`  ${name} @ ${prec}d ...`);
    const t0 = Date.now();
    let json;
    try {
      json = runCell(cmd, tpl, prec);
    } catch (e) {
      process.stderr.write(` FAILED (${e.message.split('\n')[0]})\n`);
      results[name][prec] = {};
      continue;
    }
    results[name][prec] = Object.fromEntries(json.rows.map((r) => [r.op, r.perOp]));
    for (const r of json.rows) if (!opOrder.includes(r.op)) opOrder.push(r.op);
    process.stderr.write(` ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }
}

// ---- sidecar --------------------------------------------------------------
const sidecar = {
  generated: new Date().toISOString(),
  budgetMs: BUDGET,
  precisions: PRECS,
  columns: COLUMNS.map((c) => c[0]),
  unit: 'ns/op',
  note: 'CE HEAD = dist working-tree build; CE 0.86.1 = last published npm tarball.',
  results,
};
const sidecarPath = resolve(HERE, 'ops-results.json');
writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
process.stderr.write(`\nWrote ${sidecarPath}\n\n`);

// ---- markdown tables ------------------------------------------------------
const fmt = (v) => (v == null ? '—' : v >= 1000 ? Math.round(v).toLocaleString('en-US') : String(v));
const PRIMITIVES = ['add', 'sub', 'mul', 'div', 'sqrt', 'round', 'normalize', 'normalize_tz', 'cmp'];
const COMPOSITES = ['ln', 'exp', 'cos', 'zeta3'];
const OPLABEL = {
  round: 'round¹', normalize: 'normalize²', normalize_tz: 'normalize (tz)⁴', zeta3: 'ζ(3)³',
};

function table(ops, title) {
  // Layout: for each op, three sub-rows (one per column) sharing the op label.
  const out = [];
  out.push(`### ${title}`);
  out.push('');
  const header = '| op | column | ' + PRECS.map((p) => `${p}d`).join(' | ') + ' |';
  out.push(header);
  out.push('| --- | --- | ' + PRECS.map(() => '---:').join(' | ') + ' |');
  for (const op of ops) {
    const opl = OPLABEL[op] ?? op;
    COLUMNS.forEach(([name], ci) => {
      const cells = PRECS.map((p) => fmt(results[name]?.[p]?.[op]));
      const opCell = ci === 0 ? `\`${opl}\`` : '';
      out.push(`| ${opCell} | ${name} | ${cells.join(' | ')} |`);
    });
  }
  return out.join('\n');
}

console.log(table(PRIMITIVES, 'Primitive operations (ns/op, lower is faster)'));
console.log('');
console.log(table(COMPOSITES, 'Composite consumers (ns/op) — prove op-level wins propagate'));
console.log('');
console.log('¹ `round` = `toPrecision(p)` on a `p+16`-digit operand (rounding + re-normalize).');
console.log('² `normalize` = constructing from a `bigint` with a realistic (nonzero) last digit — the case real arithmetic produces (0 of 39,900 instrumented kernel significands had trailing zeros); the constructor runs `normalize()`.');
console.log('⁴ `normalize (tz)` = ADVERSARIAL trailing-zero operands forcing the strip loop; tracks the worst case, not workload cost.');
console.log('³ `ζ(3)` = an Apéry series kernel on CE; the mpmath column uses native `mpmath.zeta(3)` (not Apéry), so it is a reference point, not an algorithm-identical race.');
