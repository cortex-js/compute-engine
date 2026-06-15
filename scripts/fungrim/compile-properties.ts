// Compile `data/fungrim/properties.json` into the bundled, operator-indexed
// analytic-property artifact
// `src/compute-engine/function-properties/function-properties-data.json`
// (ROADMAP item 7 — the analytic-property metadata store; Fungrim Feature E,
// docs/fungrim/FUNGRIM.md §4.E).
//
// The translated corpus carries ~131 analytic-property records (poles, zeros,
// branch points/cuts, residues, holomorphic/meromorphic domains, ...). This
// step groups them by operator, computes the argument index of each record's
// distinguished variable (so the numeric evaluator can map a pole set to the
// operand it constrains), and drops translator-only fields (topics, path,
// valueSource). Records with no simple operator head (e.g. a property of an
// `Add` of two functions) are dropped — they can't be keyed by operator.
//
// Deterministic (operators alphabetical, records by id). `--check` is a CI
// freshness gate that fails if the checked-in artifact diverges from a fresh
// compile (mirrors recompile-drift.ts / apply-solve-templates.ts --check):
//
//   npx tsx scripts/fungrim/compile-properties.ts
//   npx tsx scripts/fungrim/compile-properties.ts --check

import * as fs from 'fs';
import * as path from 'path';

type Json = unknown;

interface SourceEntry {
  id: string;
  property: string;
  operator: string | null;
  expr: Json;
  var: string | null;
  domain: Json;
  point: Json;
  condition: Json;
  value: Json;
  assumptions: Json;
}

interface CompiledRecord {
  id: string;
  property: string;
  var: string | null;
  argIndex: number | null;
  expr: Json;
  domain: Json;
  point: Json;
  condition: Json;
  value: Json;
  assumptions: Json;
}

// Index of the record's distinguished variable among the operator's arguments
// (expr is `[head, arg0, arg1, ...]`). Null when there is no single argument
// position (parametric or non-trivial expressions).
function argIndexOf(expr: Json, v: string | null): number | null {
  if (v === null || !Array.isArray(expr)) return null;
  const i = (expr as Json[]).slice(1).findIndex((a) => a === v);
  return i < 0 ? null : i;
}

function compile(source: { generator?: string; entries: SourceEntry[] }) {
  const operators: Record<string, CompiledRecord[]> = {};
  const byProperty: Record<string, number> = {};
  let dropped = 0;

  for (const e of source.entries) {
    if (typeof e.operator !== 'string' || e.operator.length === 0) {
      dropped += 1;
      continue;
    }
    byProperty[e.property] = (byProperty[e.property] ?? 0) + 1;
    const rec: CompiledRecord = {
      id: e.id,
      property: e.property,
      var: e.var ?? null,
      argIndex: argIndexOf(e.expr, e.var ?? null),
      expr: e.expr ?? null,
      domain: e.domain ?? null,
      point: e.point ?? null,
      condition: e.condition ?? null,
      value: e.value ?? null,
      assumptions: e.assumptions ?? null,
    };
    (operators[e.operator] ??= []).push(rec);
  }

  // Deterministic ordering.
  const sortedOps: Record<string, CompiledRecord[]> = {};
  for (const op of Object.keys(operators).sort())
    sortedOps[op] = operators[op].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );

  const manifest = {
    schemaVersion: 1,
    generator: 'scripts/fungrim/compile-properties.ts',
    source: 'data/fungrim/properties.json',
    translator: source.generator ?? null,
    counts: {
      entries: source.entries.length - dropped,
      dropped,
      operators: Object.keys(sortedOps).length,
      byProperty,
    },
  };

  return { manifest, operators: sortedOps };
}

function main(): void {
  const check = process.argv.includes('--check');
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rootDir = path.resolve(scriptDir, '../..');
  const sourcePath = path.join(rootDir, 'data/fungrim/properties.json');
  const artifactPath = path.join(
    rootDir,
    'src/compute-engine/function-properties/function-properties-data.json'
  );

  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const out = JSON.stringify(compile(source), null, 1) + '\n';

  if (check) {
    const current = fs.existsSync(artifactPath)
      ? fs.readFileSync(artifactPath, 'utf8')
      : '';
    if (current !== out) {
      console.error(
        'function-properties artifact is stale. Run:\n' +
          '  npx tsx scripts/fungrim/compile-properties.ts'
      );
      process.exit(1);
    }
    console.log('function-properties artifact is up to date.');
    return;
  }

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, out);

  const c = compile(source).manifest.counts;
  console.log('Fungrim analytic-property compiler');
  console.log(`  entries:   ${c.entries} (dropped ${c.dropped})`);
  console.log(`  operators: ${c.operators}`);
  console.log('  by property:', c.byProperty);
  console.log(`  artifact:  ${path.relative(rootDir, artifactPath)}`);
}

// Run only as a script (not when imported by tests).
if (
  process.argv[1] !== undefined &&
  /compile-properties\.(ts|js|mjs|cjs)$/.test(process.argv[1])
) {
  main();
}

export { compile };
