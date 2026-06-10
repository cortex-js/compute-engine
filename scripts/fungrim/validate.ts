// Fungrim corpus validation harness — CLI entry point
// (FUNGRIM-PLAN-1-TRANSLATOR.md §5, milestone M5).
//
// Usage (from the repo root):
//   npx tsx scripts/fungrim/validate.ts --corpus data/fungrim \
//       [--numeric] [--topic <t>] [--id <xxxxxx>] [--seed <n>]
//
// Stage 1 (always): declare the symbol shells from declarations.json, then
// per entry declare its variables (typed from assumptions) and ce.box() the
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

function parseArgs(argv: string[]): {
  corpus: string;
  numeric: boolean;
  topic?: string;
  id?: string;
  seed: number;
} {
  const args = {
    corpus: 'data/fungrim',
    numeric: false,
    topic: undefined as string | undefined,
    id: undefined as string | undefined,
    seed: 42,
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
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return args;
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
