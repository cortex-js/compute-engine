// Recompile-drift gate for the Fungrim artifact
// (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.7 — the "no silent drops" safety net).
//
// THE PROBLEM THIS GUARDS AGAINST. The checked-in artifact's simplify rules
// are produced by `compile-rules.ts`, which validates each rule with an
// OFFLINE, ISOLATED self-test (`expr.replace(singleRule)`, one pass). But some
// rules only fire as part of the FULL loaded rule set — other rules normalize
// the expression first, then these match. The isolated self-test cannot
// reproduce that emergent, multi-rule behavior, so it can report a false
// "no-fire" for a rule that genuinely fires at runtime. A full recompile would
// then silently DROP such a rule — a silent capability loss. The sampled
// `artifact-freshness.ts` (25 of ~1376 rules) does not reliably catch it.
//
// THE GATE. This script does a FULL recompile of the slice and compares the
// emitted simplify-rule id SET against the checked-in artifact:
//   - DROPPED: a committed rule a recompile no longer emits (the silent-loss
//     case) — reported with the recompile's skip reason.
//   - ADDED:   a rule a fresh recompile emits that the artifact lacks (a
//     capability the artifact could gain on a regenerate).
// Any drop or add that is NOT explicitly allowlisted in
// `curation-overrides.json` (`recompileDivergence.dropped` / `.added`, keyed by
// bare entry id with a justification note) FAILS the gate. So every divergence
// is either reproducible or a human-acknowledged, documented exception — never
// silent. Stale allowlist entries (no longer diverging) are reported as a
// warning so the allowlist stays honest.
//
// Solve-target rules (`fungrim:<id>:solve`) are excluded: they are a separate
// overlay (apply-solve-templates.ts), not produced by `compileEntries`.
//
// Run:  npx tsx scripts/fungrim/recompile-drift.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

import { compileEntries, isSliceEntry } from './compile-rules';
import type { CompiledFungrimRule, CurationOverrides } from './compile-rules';
import { loadCorpus } from './load';
import type { Entry } from './load';

type Artifact = { rules: CompiledFungrimRule[] };
type DivergenceAllow = {
  dropped?: Record<string, string>;
  added?: Record<string, string>;
};

function main(): void {
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rootDir = path.resolve(scriptDir, '../..');
  const corpusDir = path.join(rootDir, 'data/fungrim');
  const overridesPath = path.join(scriptDir, 'curation-overrides.json');
  const artifactPath = path.join(
    rootDir,
    'src/compute-engine/fungrim/fungrim-core-data.json'
  );

  const corpus = loadCorpus(corpusDir);
  const overrides: CurationOverrides & {
    recompileDivergence?: DivergenceAllow;
  } = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};
  const allow: DivergenceAllow = overrides.recompileDivergence ?? {};
  const allowDropped = allow.dropped ?? {};
  const allowAdded = allow.added ?? {};

  const slice: Entry[] = [
    ...corpus.entries.filter(isSliceEntry),
    ...(overrides.inject ?? []),
  ];

  console.log(
    `Recompile-drift gate: recompiling ${slice.length} slice entries…`
  );
  const result = compileEntries(slice, corpus.declarations, overrides);
  const recompiledIds = new Set(result.rules.map((r) => r.id));
  const skipById = new Map(result.skips.map((s) => ['fungrim:' + s.id, s]));

  const artifact: Artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  // Compare only the primary (slice-derived) simplify rules; the `:solve`
  // overlay is owned by apply-solve-templates.ts.
  const committed = artifact.rules.filter((r) => r.target !== 'solve');
  const committedIds = new Set(committed.map((r) => r.id));

  const dropped = [...committedIds].filter((id) => !recompiledIds.has(id)).sort();
  const added = [...recompiledIds].filter((id) => !committedIds.has(id)).sort();

  const bare = (id: string): string => id.replace(/^fungrim:/, '');
  const failures: string[] = [];
  const acknowledged: string[] = [];

  for (const id of dropped) {
    const skip = skipById.get(id);
    const why = skip
      ? `${skip.reason}${skip.detail ? ` (${skip.detail})` : ''}`
      : 'not re-emitted';
    if (bare(id) in allowDropped)
      acknowledged.push(`  ~ DROP ${id} — ${why}\n      → ${allowDropped[bare(id)]}`);
    else failures.push(`  ✗ DROP ${id} — recompile: ${why} [NOT allowlisted]`);
  }
  for (const id of added) {
    if (bare(id) in allowAdded)
      acknowledged.push(`  ~ ADD  ${id}\n      → ${allowAdded[bare(id)]}`);
    else
      failures.push(
        `  ✗ ADD  ${id} — a fresh recompile emits this rule, absent from the artifact [NOT allowlisted]`
      );
  }

  // Stale allowlist hygiene: entries that no longer diverge.
  const droppedSet = new Set(dropped.map(bare));
  const addedSet = new Set(added.map(bare));
  const stale = [
    ...Object.keys(allowDropped)
      .filter((k) => !droppedSet.has(k))
      .map((k) => `dropped:${k}`),
    ...Object.keys(allowAdded)
      .filter((k) => !addedSet.has(k))
      .map((k) => `added:${k}`),
  ];

  console.log(
    `  committed simplify rules: ${committed.length} | recompiled: ${result.rules.length}`
  );
  console.log(
    `  divergence: ${dropped.length} dropped, ${added.length} added ` +
      `(${acknowledged.length} allowlisted, ${failures.length} unaccounted)`
  );
  if (acknowledged.length > 0) {
    console.log('  acknowledged divergence (allowlisted):');
    for (const a of acknowledged) console.log(a);
  }
  if (stale.length > 0)
    console.log(
      `  ⚠ stale allowlist entries (no longer diverging — please remove): ${stale.join(', ')}`
    );

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} unaccounted recompile divergence(s) — a fresh ` +
        'recompile would silently change the shipped rule set.\n' +
        'Each must be either fixed (so it reproduces) or allowlisted in\n' +
        "curation-overrides.json's `recompileDivergence` with a justification:\n"
    );
    for (const f of failures) console.error(f);
    console.error(
      '\n(A DROP of a rule that genuinely fires at runtime is a self-test ' +
        'false-negative — keep it and document why. A DROP of a dead rule is ' +
        'safe — document it and remove the rule on the next regenerate. An ADD ' +
        'is a rule the artifact is missing.)'
    );
    process.exit(1);
  }

  console.log(
    `OK — every recompile divergence is accounted for (no silent drops or adds).`
  );
}

// Run only as a script (not when imported by tests).
if (
  process.argv[1] !== undefined &&
  /recompile-drift\.(ts|js|mjs|cjs)$/.test(process.argv[1])
) {
  main();
}
