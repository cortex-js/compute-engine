// Fungrim corpus validation harness — CLI entry point
// (docs/fungrim/FUNGRIM-PLAN-1-TRANSLATOR.md §5, milestone M5).
//
// Usage (from the repo root):
//   npx tsx scripts/fungrim/validate.ts --corpus data/fungrim \
//       [--numeric] [--topic <t>] [--id <xxxxxx>] [--seed <n>]
//
// Stage 1 (always): declare the symbol shells from declarations.json, then
// per entry declare its variables (typed from assumptions) and ce.expr() the
// formula + assumptions. Outcomes: ok / box-error / unknown-symbol /
// timeout. Writes scripts/fungrim/validation-report.json.
//
// Stage 2 (--numeric): seeded numeric spot checks over the
// guardLevel ∈ {none, real-simple} slice. False instances land in
// scripts/fungrim/numeric-failures.json.
//
// Exit code reflects Stage-1 health (CI gate): 0 iff pass rate >= 99%.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCorpus, Entry } from './load';
import { runStage1 } from './box-check';
import { runStage2 } from './numeric-check';
import {
  writeStage1Report,
  writeNumericFailures,
  printStage1Summary,
  printStage2Summary,
} from './report';

const PASS_RATE_GATE = 0.99;

/** Path to the committed Stage-1 report (written by report.ts to this dir). */
const REPORT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'validation-report.json'
);

function parseArgs(argv: string[]): {
  corpus: string;
  numeric: boolean;
  topic?: string;
  id?: string;
  seed: number;
  check: boolean;
} {
  const args = {
    corpus: 'data/fungrim',
    numeric: false,
    topic: undefined as string | undefined,
    id: undefined as string | undefined,
    seed: 42,
    check: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--corpus':
        args.corpus = argv[++i];
        break;
      case '--numeric':
        args.numeric = true;
        break;
      case '--topic':
        args.topic = argv[++i];
        break;
      case '--id':
        args.id = argv[++i];
        break;
      case '--seed':
        args.seed = Number(argv[++i]);
        break;
      case '--check':
        args.check = true;
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return args;
}

/** Read the committed report's Stage-1 failing-entry id set. */
function committedFailureIds(): Set<string> {
  if (!fs.existsSync(REPORT_PATH))
    throw new Error(
      `No committed report at ${REPORT_PATH}; run without --check to generate one.`
    );
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const failures: { id: string }[] = report?.stage1?.failures ?? [];
  return new Set(failures.map((f) => f.id));
}

/**
 * Drift gate (`--check`): compare the fresh Stage-1 failure set against the
 * committed report WITHOUT rewriting it. This is the hard CI gate that the
 * old soft pass-rate threshold (PASS_RATE_GATE) let a multi-entry drift slip
 * under. Exit codes:
 *   1  newly-failing entries (regressions) — investigate and fix.
 *   1  only newly-passing entries — the committed report is stale; regenerate
 *      it (`npx tsx scripts/fungrim/validate.ts --corpus data/fungrim`) and
 *      commit. Newly-passing is never a correctness problem, but it is failed
 *      (not merely warned) on purpose: a soft warning is exactly what allowed
 *      the baseline to silently drift out of date. The remedy is mechanical.
 *   0  fresh failure set matches the committed report exactly.
 * The `--check` run itself never writes the report, so CI stays clean.
 */
function runCheckGate(freshFailureIds: Set<string>): never {
  const committed = committedFailureIds();
  const newlyFailing = [...freshFailureIds].filter((id) => !committed.has(id)).sort();
  const newlyPassing = [...committed].filter((id) => !freshFailureIds.has(id)).sort();

  if (newlyFailing.length === 0 && newlyPassing.length === 0) {
    console.log(
      `\n[--check] OK — Stage-1 failure set matches the committed report ` +
        `(${freshFailureIds.size} failing).`
    );
    process.exit(0);
  }
  if (newlyFailing.length > 0) {
    console.error(
      `\n[--check] REGRESSION — ${newlyFailing.length} entr` +
        `${newlyFailing.length === 1 ? 'y' : 'ies'} newly failing Stage 1:`
    );
    for (const id of newlyFailing) console.error(`  ${id}`);
  }
  if (newlyPassing.length > 0) {
    console.error(
      `\n[--check] STALE REPORT — ${newlyPassing.length} entr` +
        `${newlyPassing.length === 1 ? 'y' : 'ies'} in the committed report ` +
        `now pass: ${newlyPassing.join(', ')}.\n` +
        `  Regenerate: npx tsx scripts/fungrim/validate.ts --corpus data/fungrim`
    );
  }
  process.exit(1);
}

function main(): void {
  const args = parseArgs(process.argv);
  const corpusDir = path.resolve(args.corpus);
  if (!fs.existsSync(path.join(corpusDir, 'corpus'))) {
    console.error(`No corpus found at ${corpusDir}`);
    process.exit(2);
  }

  console.log(`Loading corpus from ${corpusDir} ...`);
  const corpus = loadCorpus(corpusDir);
  console.log(
    `  ${corpus.entries.length} entries, ${corpus.topics.length} topics, ` +
      `${Object.keys(corpus.declarations.declarations).length} shell declarations`
  );

  const filter = (e: Entry): boolean => {
    if (args.topic && e.topic !== args.topic) return false;
    if (args.id && e.id !== args.id) return false;
    return true;
  };

  // --- Stage 1 ---------------------------------------------------------
  const stage1 = runStage1(corpus, filter);
  printStage1Summary(stage1);

  // --- Drift gate (--check): compare against the committed report, do not
  //     rewrite it, and exit non-zero on any divergence. -----------------
  if (args.check) {
    if (args.topic || args.id) {
      console.error(
        '--check requires a full run; do not combine it with --topic/--id.'
      );
      process.exit(2);
    }
    runCheckGate(new Set(stage1.failures.map((f) => f.id)));
  }

  // --- Stage 2 ---------------------------------------------------------
  let stage2;
  if (args.numeric) {
    console.log(
      '\nRunning Stage 2 (numeric spot checks, guardLevel in {none, real-simple}) ...'
    );
    stage2 = runStage2(corpus, filter, args.seed, (done, total) =>
      console.log(`  ... ${done}/${total}`)
    );
    printStage2Summary(stage2);
    const failuresFile = writeNumericFailures(stage2);
    console.log(`\nNumeric failures written to ${failuresFile}`);
  }

  const reportFile = writeStage1Report(stage1, corpusDir, stage2);
  console.log(`Report written to ${reportFile}`);

  if (stage1.passRate < PASS_RATE_GATE) {
    console.error(
      `\nStage 1 pass rate ${(100 * stage1.passRate).toFixed(2)}% is below ` +
        `the ${100 * PASS_RATE_GATE}% gate.`
    );
    process.exit(1);
  }
}

main();
