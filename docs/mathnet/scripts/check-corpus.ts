/**
 * Run the curated regression corpus (../parser-test-cases.json) against the
 * current parser and report progress per category.
 *
 *   npx tsx check-corpus.ts [--failures]
 *
 * Every case in the corpus FAILED at the time it was captured (see the
 * corpus `date`/`engineVersion`). A case counts as FIXED when ce.parse()
 * returns a valid expression with no "Error" subexpression and no throw.
 * --failures also prints each still-failing input.
 */
import { ComputeEngine } from '../../../src/compute-engine';
import * as fs from 'fs';
import * as path from 'path';

const scriptDir = path.dirname(process.argv[1]);
const corpus = JSON.parse(
  fs.readFileSync(path.join(scriptDir, '..', 'parser-test-cases.json'), 'utf8')
);
const showFailures = process.argv.includes('--failures');
const ce = new ComputeEngine();

function outcome(input: string): 'fixed' | 'error' | 'throw' {
  try {
    const expr = ce.parse(input);
    if (expr.isValid && !JSON.stringify(expr.json).includes('"Error"'))
      return 'fixed';
    return 'error';
  } catch {
    return 'throw';
  }
}

const byCategory: Record<string, { fixed: number; total: number }> = {};
let throws = 0;

for (const c of corpus.fragments) {
  const stat = (byCategory[c.category] ??= { fixed: 0, total: 0 });
  stat.total++;
  const res = outcome(c.latex);
  if (res === 'fixed') stat.fixed++;
  else if (showFailures) console.log(`[${c.category}] ${res}: ${c.latex}`);
  if (res === 'throw') throws++;
}

let ansFixed = 0;
for (const c of corpus.unicodeAnswers) {
  const res = outcome(c.input);
  if (res === 'fixed') ansFixed++;
  else if (showFailures) console.log(`[answer] ${res}: ${c.input}`);
  if (res === 'throw') throws++;
}

console.log(`\nCorpus captured ${corpus.date} on v${corpus.engineVersion}`);
console.log('category                fixed / total');
let fixed = 0;
let total = 0;
for (const [cat, s] of Object.entries(byCategory).sort(
  (a, b) => b[1].total - a[1].total
)) {
  console.log(`${cat.padEnd(24)}${String(s.fixed).padStart(5)} / ${s.total}`);
  fixed += s.fixed;
  total += s.total;
}
console.log(`${'TOTAL fragments'.padEnd(24)}${String(fixed).padStart(5)} / ${total}`);
console.log(
  `${'unicode answers'.padEnd(24)}${String(ansFixed).padStart(5)} / ${corpus.unicodeAnswers.length}`
);
console.log(`throws: ${throws} (must be 0)`);
