// Artifact-freshness self-test (ROADMAP item 3, CI gate).
//
// The checked-in artifact (src/compute-engine/fungrim/fungrim-core-data.json)
// stores match patterns in CANONICAL form. Canonicalization changes elsewhere
// in the engine can silently break matching — the patterns simply stop firing
// at runtime with no error anywhere. (This happened once during development:
// raw-form patterns no-fired ~123 entries; the compiler self-test caught it.)
//
// This script makes that protection continuous: it takes a deterministic
// stride sample of the artifact's rules, recompiles their corpus entries
// through the FULL compiler pipeline (guard compilation, orientation,
// canonicalization, dedup, scratch-engine self-test — see compile-rules.ts)
// against the CURRENT engine, and asserts every sampled rule is re-emitted
// identically. Any skip (no-fire, box-error, wildcard-loss, …) or field
// drift fails the run.
//
// Usage (from the repo root):
//   npx tsx scripts/fungrim/artifact-freshness.ts [--sample <n>]
//
// Exit codes: 0 = fresh; 1 = drift detected; 2 = setup error.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadCorpus } from './load';
import type { Entry } from './load';
import { compileEntries, isSliceEntry } from './compile-rules';
import type {
  CompiledFungrimRule,
  CurationOverrides,
} from './compile-rules';

const DEFAULT_SAMPLE = 25;

function parseArgs(argv: string[]): { sample: number } {
  const args = { sample: DEFAULT_SAMPLE };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sample':
        args.sample = Number(argv[++i]);
        if (!Number.isInteger(args.sample) || args.sample < 2) {
          console.error('--sample must be an integer >= 2');
          process.exit(2);
        }
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return args;
}

/** Evenly spaced deterministic sample of `k` indices over [0, n). */
function strideSample(n: number, k: number): number[] {
  const indices = new Set<number>();
  const count = Math.min(k, n);
  for (let i = 0; i < count; i++)
    indices.add(Math.round((i * (n - 1)) / (count - 1)));
  return [...indices].sort((a, b) => a - b);
}

function main(): void {
  const args = parseArgs(process.argv);
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rootDir = path.resolve(scriptDir, '../..');
  const artifactPath = path.join(
    rootDir,
    'src/compute-engine/fungrim/fungrim-core-data.json'
  );
  const corpusDir = path.join(rootDir, 'data/fungrim');
  const overridesPath = path.join(scriptDir, 'curation-overrides.json');

  if (!fs.existsSync(artifactPath)) {
    console.error(`No artifact at ${artifactPath}`);
    process.exit(2);
  }
  if (!fs.existsSync(path.join(corpusDir, 'corpus'))) {
    console.error(`No corpus at ${corpusDir}`);
    process.exit(2);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
    rules: CompiledFungrimRule[];
  };
  if (!Array.isArray(artifact.rules) || artifact.rules.length === 0) {
    console.error('Artifact has no rules');
    process.exit(2);
  }

  // Solve-target rules are NOT produced by `compileEntries` (the slice→
  // simplify compiler): they are a hand-managed overlay derived by
  // `apply-solve-templates.ts` and validated by its own end-to-end self-test
  // (and its `--check` gate). This freshness check only verifies that the
  // primary simplify rules still recompile from their corpus entries, so it
  // skips the `:solve` overlay.
  const primaryRules = artifact.rules.filter((r) => r.target !== 'solve');
  const solveCount = artifact.rules.length - primaryRules.length;

  const sampled = strideSample(primaryRules.length, args.sample).map(
    (i) => primaryRules[i]
  );
  console.log(
    `Artifact-freshness self-test: ${sampled.length} of ` +
      `${primaryRules.length} simplify rules (deterministic stride sample` +
      `${solveCount > 0 ? `; ${solveCount} solve rules skipped — see apply-solve-templates --check` : ''})`
  );

  const corpus = loadCorpus(corpusDir);
  const overrides: CurationOverrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};
  const slice: Entry[] = [
    ...corpus.entries.filter(isSliceEntry),
    ...(overrides.inject ?? []),
  ];
  const entryByRuleId = new Map(slice.map((e) => ['fungrim:' + e.id, e]));

  const failures: string[] = [];

  // Every sampled artifact rule must still have a corpus entry to compile
  // from (a miss means the artifact is stale relative to the corpus).
  const sampleEntries: Entry[] = [];
  for (const rule of sampled) {
    const e = entryByRuleId.get(rule.id);
    if (e === undefined)
      failures.push(`${rule.id}: no corpus entry for this artifact rule`);
    else sampleEntries.push(e);
  }

  // Recompile the sampled entries through the full pipeline. Compilation is
  // per-entry (orientation, guards, self-test); the only cross-entry stage,
  // undirected dedup, keeps the earliest entry — and every sampled id is an
  // artifact survivor, so a subset compile must re-emit all of them.
  const result = compileEntries(sampleEntries, corpus.declarations, overrides);
  const recompiled = new Map(result.rules.map((r) => [r.id, r]));
  const skipById = new Map(result.skips.map((s) => ['fungrim:' + s.id, s]));

  const FIELDS = [
    'match',
    'replace',
    'guards',
    'purpose',
    'target',
    'class',
  ] as const;

  for (const rule of sampled) {
    if (!entryByRuleId.has(rule.id)) continue; // already reported above
    const fresh = recompiled.get(rule.id);
    if (fresh === undefined) {
      const skip = skipById.get(rule.id);
      failures.push(
        skip === undefined
          ? `${rule.id}: not re-emitted (no skip record)`
          : `${rule.id}: now skipped — ${skip.reason}` +
              (skip.detail === undefined ? '' : ` (${skip.detail})`)
      );
      continue;
    }
    for (const f of FIELDS) {
      const was = JSON.stringify(rule[f]);
      const now = JSON.stringify(fresh[f]);
      if (was !== now)
        failures.push(
          `${rule.id}: ${f} drifted\n    artifact:   ${was.slice(0, 200)}\n    recompiled: ${now.slice(0, 200)}`
        );
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} freshness failure(s) — the checked-in artifact ` +
        'is out of sync with the current engine.\n' +
        'Regenerate with: npx tsx scripts/fungrim/compile-rules.ts\n'
    );
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }

  console.log(
    `OK — all ${sampled.length} sampled rules recompile identically and ` +
      'fire on the current engine.'
  );
}

main();
