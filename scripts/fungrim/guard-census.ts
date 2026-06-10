// Guard-dischargeability census over the full Fungrim corpus
// (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §11, "Secondary validation": re-run the
// guard-discharge counting after the P1–P4 assumptions extension).
//
// For every corpus entry with assumptions, in a fresh scope:
//   1. `ce.assume()` each top-level And-conjunct
//      → "assumable" when every conjunct returns 'ok' or 'tautology'
//   2. for assumable entries, `ce.verify()` the full assumptions
//      → "dischargeable" when it returns `true`
//
// Output: a guardLevel × {assumable, dischargeable, failure-reasons} table,
// printed and written to scripts/fungrim/guard-census.json.
//
// Run with: npx tsx scripts/fungrim/guard-census.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCorpus, createEngine, type Entry } from './load';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(SCRIPT_DIR, '../../data/fungrim');
const OUT_FILE = path.resolve(SCRIPT_DIR, 'guard-census.json');

/** Per-entry time guard (ms): entries slower than this are classified as
 * 'timeout' (the work is synchronous, so the guard is applied after the
 * fact rather than preemptively). */
const TIME_GUARD_MS = 2000;

// Conjuncts containing a part extractor must be boxed non-canonically so
// the subject shape (`Real(s)`, `Abs(q)`, ...) survives boxing — canonical
// boxing can collapse the part term. Mirrors the P2/P3/P4 test suites.
const PART_HEADS = ['Real', 'Imaginary', 'Abs', 'Argument'];
function hasPartHead(x: unknown): boolean {
  return (
    Array.isArray(x) &&
    (PART_HEADS.includes(x[0] as string) || x.some(hasPartHead))
  );
}

function conjunctsOf(assumptions: unknown): unknown[] {
  if (Array.isArray(assumptions) && assumptions[0] === 'And')
    return assumptions.slice(1);
  return [assumptions];
}

type EntryOutcome =
  | 'dischargeable' // all conjuncts assumable, verify === true
  | 'verify-undefined' // assumable, but verify() returned undefined
  | 'verify-false' // assumable, but verify() returned false (!)
  | 'verify-threw' // assumable, but verify() threw
  | 'not-a-predicate' // some conjunct returned 'not-a-predicate'
  | 'contradiction' // some conjunct returned 'contradiction'
  | 'internal-error' // some conjunct returned 'internal-error'
  | 'assume-threw' // some conjunct threw
  | 'timeout'; // entry exceeded TIME_GUARD_MS

type LevelStats = {
  entries: number;
  assumable: number;
  dischargeable: number;
  failed: number;
  reasons: Record<string, number>;
  /** A few example entry ids per failure reason */
  examples: Record<string, string[]>;
};

function newLevelStats(): LevelStats {
  return {
    entries: 0,
    assumable: 0,
    dischargeable: 0,
    failed: 0,
    reasons: {},
    examples: {},
  };
}

function classifyEntry(
  ce: ReturnType<typeof createEngine>,
  e: Entry
): EntryOutcome {
  const conjuncts = conjunctsOf(e.assumptions);

  ce.pushScope();
  try {
    let assumable = true;
    let failure: EntryOutcome | undefined;

    for (const c of conjuncts) {
      let result: string;
      try {
        result = ce.assume(ce.box(c as any, { canonical: !hasPartHead(c) }));
      } catch {
        assumable = false;
        failure ??= 'assume-threw';
        continue;
      }
      if (result !== 'ok' && result !== 'tautology') {
        assumable = false;
        if (result === 'contradiction') failure ??= 'contradiction';
        else if (result === 'internal-error') failure ??= 'internal-error';
        else failure ??= 'not-a-predicate';
      }
    }

    if (!assumable) return failure!;

    // Dischargeability: verify the full assumptions expression. Box
    // canonically — verify() itself boxes raw, which would leave plain
    // MathJSON unbound.
    let verified: boolean | undefined;
    try {
      verified = ce.verify(ce.box(e.assumptions as any));
    } catch {
      return 'verify-threw';
    }
    if (verified === true) return 'dischargeable';
    if (verified === false) return 'verify-false';
    return 'verify-undefined';
  } finally {
    ce.popScope();
  }
}

function main(): void {
  const corpus = loadCorpus(DATA_DIR);
  const ce = createEngine(corpus.declarations);

  // CE emits console noise (compilation fallbacks for shell heads, assume
  // internal errors that are caught and rethrown...). Keep the census
  // output readable.
  const savedWarn = console.warn;
  const savedError = console.error;
  const savedInfo = console.info;
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};

  const byLevel = new Map<string, LevelStats>();
  const perEntry: Record<
    string,
    { guardLevel: string; outcome: EntryOutcome; ms: number }
  > = {};

  let processed = 0;
  const t0 = Date.now();

  try {
    for (const e of corpus.entries) {
      if (e.assumptions === null || e.assumptions === undefined) continue;

      let stats = byLevel.get(e.guardLevel);
      if (!stats) {
        stats = newLevelStats();
        byLevel.set(e.guardLevel, stats);
      }
      stats.entries += 1;
      processed += 1;

      const start = Date.now();
      let outcome: EntryOutcome;
      try {
        outcome = classifyEntry(ce, e);
      } catch {
        outcome = 'assume-threw';
      }
      const ms = Date.now() - start;
      if (ms > TIME_GUARD_MS) outcome = 'timeout';

      perEntry[`${e.topic}/${e.id}`] = {
        guardLevel: e.guardLevel,
        outcome,
        ms,
      };

      const assumeFailures: EntryOutcome[] = [
        'not-a-predicate',
        'contradiction',
        'internal-error',
        'assume-threw',
      ];
      if (!assumeFailures.includes(outcome) && outcome !== 'timeout')
        stats.assumable += 1;
      if (outcome === 'dischargeable') stats.dischargeable += 1;
      else {
        stats.failed += 1;
        stats.reasons[outcome] = (stats.reasons[outcome] ?? 0) + 1;
        stats.examples[outcome] ??= [];
        if (stats.examples[outcome].length < 5)
          stats.examples[outcome].push(`${e.topic}/${e.id}`);
      }
    }
  } finally {
    console.warn = savedWarn;
    console.error = savedError;
    console.info = savedInfo;
  }

  const elapsed = Date.now() - t0;

  //
  // ── Report ────────────────────────────────────────────────────────────
  //

  const levels = ['none', 'real-simple', 'complex-domain', 'undischargeable'];
  const orderedLevels = [
    ...levels.filter((l) => byLevel.has(l)),
    ...[...byLevel.keys()].filter((l) => !levels.includes(l)),
  ];

  const pct = (n: number, d: number): string =>
    d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`;

  console.log(
    `\nFungrim guard-dischargeability census — ${processed} entries with ` +
      `assumptions (of ${corpus.entries.length} total), ${(
        elapsed / 1000
      ).toFixed(1)}s\n`
  );

  const header = [
    'guardLevel'.padEnd(16),
    'entries'.padStart(8),
    'assumable'.padStart(10),
    'dischargeable'.padStart(14),
    '(% level)'.padStart(10),
    'failed'.padStart(7),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  const totals = newLevelStats();
  for (const level of orderedLevels) {
    const s = byLevel.get(level)!;
    totals.entries += s.entries;
    totals.assumable += s.assumable;
    totals.dischargeable += s.dischargeable;
    totals.failed += s.failed;
    console.log(
      [
        level.padEnd(16),
        String(s.entries).padStart(8),
        String(s.assumable).padStart(10),
        String(s.dischargeable).padStart(14),
        pct(s.dischargeable, s.entries).padStart(10),
        String(s.failed).padStart(7),
      ].join('  ')
    );
  }
  console.log('-'.repeat(header.length));
  console.log(
    [
      'TOTAL'.padEnd(16),
      String(totals.entries).padStart(8),
      String(totals.assumable).padStart(10),
      String(totals.dischargeable).padStart(14),
      pct(totals.dischargeable, totals.entries).padStart(10),
      String(totals.failed).padStart(7),
    ].join('  ')
  );

  console.log('\nFailure reasons per guardLevel:');
  for (const level of orderedLevels) {
    const s = byLevel.get(level)!;
    const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
    if (reasons.length === 0) continue;
    console.log(`  ${level}:`);
    for (const [reason, count] of reasons)
      console.log(
        `    ${reason.padEnd(18)} ${String(count).padStart(5)}  e.g. ${s.examples[
          reason
        ]!.slice(0, 3).join(', ')}`
      );
  }

  const cd = byLevel.get('complex-domain');
  if (cd) {
    console.log(
      `\nSuccess criterion (design §11): complex-domain slice ` +
        `${cd.dischargeable}/${cd.entries} dischargeable ` +
        `(${pct(cd.dischargeable, cd.entries)}), up from ~0% pre-P1.`
    );
  }

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        elapsedMs: elapsed,
        timeGuardMs: TIME_GUARD_MS,
        entriesWithAssumptions: processed,
        totalEntries: corpus.entries.length,
        byGuardLevel: Object.fromEntries(
          orderedLevels.map((l) => [l, byLevel.get(l)])
        ),
        totals,
        perEntry,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE)}`);
}

main();
