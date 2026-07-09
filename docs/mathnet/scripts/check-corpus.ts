/**
 * Run the curated regression corpus (../parser-test-cases.json) against the
 * current parser and report progress per category.
 *
 *   npx tsx check-corpus.ts [--failures] [--update]
 *
 * Every case in the corpus FAILED at the time it was captured (see the
 * corpus `date`/`engineVersion`). A case counts as FIXED when ce.parse()
 * returns a valid expression with no "Error" subexpression and no throw.
 *
 * Each case's `observed` field records the parser outcome as of the corpus
 * `lastChecked` date ("clean", an error code such as "'unexpected-token'",
 * or "throw"). This script enforces it as a contract:
 *   - REGRESSION (recorded clean, now failing) → listed, exit code 1
 *   - improvement (recorded failing, now clean) → listed, so `observed` can
 *     be refreshed
 *   - --update rewrites `observed` to the current outcome (and bumps
 *     `lastChecked`) after you've reviewed the changes
 * --failures also prints each still-failing input.
 */
import { ComputeEngine } from '../../../src/compute-engine';
import * as fs from 'fs';
import * as path from 'path';

const scriptDir = path.dirname(process.argv[1]);
const corpusPath = path.join(scriptDir, '..', 'parser-test-cases.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const showFailures = process.argv.includes('--failures');
const update = process.argv.includes('--update');

/** Current parser outcome: 'clean', 'throw', or the first error code. */
function outcome(input: string): string {
  // A fresh engine per input: the engine narrows free-symbol types from
  // usage persistently, so a shared engine lets one fragment's inference
  // contaminate another's parse (e.g. an early `A \setminus B` narrows `A`
  // to a set and breaks a later `\frac{AB^2}{PC}`). Fragments are
  // independent inputs; measure them independently.
  const ce = new ComputeEngine();
  try {
    const expr = ce.parse(input);
    const json = JSON.stringify(expr.json);
    if (expr.isValid && !json.includes('"Error"')) return 'clean';
    // Extract the first error code, matching the `observed` convention:
    // ["Error","'code'",...] or ["Error",["ErrorCode","'code'",...],...]
    const code =
      json.match(/"ErrorCode","('[^"]*')"/)?.[1] ??
      json.match(/"Error","('[^"]*')"/)?.[1];
    return code ?? "'error'";
  } catch {
    return 'throw';
  }
}

const byCategory: Record<string, { fixed: number; total: number }> = {};
let throws = 0;
const regressions: string[] = [];
const improvements: string[] = [];
const codeChanges: string[] = [];

function checkCase(c: any, input: string, label: string): string {
  const res = outcome(input);
  if (res === 'throw') throws++;
  if (c.observed === 'clean' && res !== 'clean')
    regressions.push(`[${label}] was clean, now ${res}: ${input}`);
  else if (c.observed !== 'clean' && res === 'clean')
    improvements.push(`[${label}] was ${c.observed}, now clean: ${input}`);
  else if (c.observed !== res)
    codeChanges.push(`[${label}] was ${c.observed}, now ${res}: ${input}`);
  if (update) c.observed = res;
  return res;
}

for (const c of corpus.fragments) {
  const stat = (byCategory[c.category] ??= { fixed: 0, total: 0 });
  stat.total++;
  const res = checkCase(c, c.latex, c.category);
  if (res === 'clean') stat.fixed++;
  else if (showFailures) console.log(`[${c.category}] ${res}: ${c.latex}`);
}

let ansFixed = 0;
for (const c of corpus.unicodeAnswers) {
  const res = checkCase(c, c.input, 'answer');
  if (res === 'clean') ansFixed++;
  else if (showFailures) console.log(`[answer] ${res}: ${c.input}`);
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

if (improvements.length > 0) {
  console.log(
    `\n${improvements.length} improvement(s) since ${corpus.lastChecked}` +
      (update ? ' (recorded):' : ' (run with --update to record):')
  );
  for (const s of improvements) console.log(`  ${s}`);
}

if (codeChanges.length > 0) {
  console.log(
    `\n${codeChanges.length} error-code change(s) since ${corpus.lastChecked}` +
      ' (still failing, different diagnostic):'
  );
  for (const s of codeChanges) console.log(`  ${s}`);
}

if (regressions.length > 0) {
  console.log(`\n${regressions.length} REGRESSION(S) since ${corpus.lastChecked}:`);
  for (const s of regressions) console.log(`  ${s}`);
}

if (update) {
  corpus.lastChecked = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(corpusPath, JSON.stringify(corpus, null, 1) + '\n');
  console.log(`\nUpdated ${path.basename(corpusPath)} (lastChecked: ${corpus.lastChecked})`);
}

if (regressions.length > 0 || throws > 0) process.exit(1);
