/**
 * Serialize→parse round-trip property over the regression corpus
 * (../parser-test-cases.json). Stage 3 "corpus lane" of
 * The serialize/parse property described by docs/LANGUAGE-MODEL.md.
 *
 *   npx tsx check-roundtrip.ts [--failures] [--update]
 *
 * The property, for every corpus input that parses cleanly:
 *
 *     t  = ce.parse(input)          // CANONICAL
 *     t2 = ce.parse(t.latex)        // CANONICAL, same engine
 *     assert t2.isSame(t)           // STRUCTURAL tier — deliberate
 *
 * `isSame` (the structural tier, `Same`) is the assertion named in the design
 * doc. The harness runs fresh engines with no assignments, so the property is
 * invariant under the value-following flip of the equality-tiers split.
 *
 * Engine discipline (mirrors check-corpus.ts): ONE FRESH ENGINE PER CORPUS
 * ROW, so one row's free-symbol inference cannot contaminate the next. Both
 * the parse and the reparse run on that SAME engine — `isSame` compares symbol
 * binding definitions by identity, so a cross-engine comparison is false for
 * every symbol and the property would be vacuous. The consequence is a real
 * failure class ("inference-drift"): the first parse leaves inferred types in
 * the engine, and those types can change how the reparse canonicalizes. Those
 * are recorded as exceptions, not designed away.
 *
 * Inputs that do NOT parse cleanly (throw, invalid, or an `Error`
 * subexpression) are skipped — this harness measures the serializer, not the
 * parser; check-corpus.ts owns parser coverage.
 *
 * Failures are checked against the versioned exception list
 * ../roundtrip-exceptions.json. Each entry carries the original LaTeX, the
 * reserialized LaTeX, a brief mismatch, a failure `class`, and a `reason`
 * ("bug" or "documented-lossy"). CI FAILS on a round-trip failure that is NOT
 * in the list, AND on a listed failure whose defect has drifted (the
 * reserialized LaTeX or the mismatch no longer matches the recorded one) —
 * a regression that turns a known failure into a different one must not pass
 * silently. Listed entries that now pass are reported but do not fail, and
 * `--update` refreshes drifted entries instead of failing. `--update` rewrites
 * the list from the current run (new entries land as class "unclassified",
 * reason "bug" — triage them).
 */
import { ComputeEngine } from '../../../src/compute-engine';
import * as fs from 'fs';
import * as path from 'path';

const scriptDir = path.dirname(process.argv[1]);
const corpusPath = path.join(scriptDir, '..', 'parser-test-cases.json');
const exceptionsPath = path.join(scriptDir, '..', 'roundtrip-exceptions.json');

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const exceptionsFile = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));

const showFailures = process.argv.includes('--failures');
const update = process.argv.includes('--update');

type Exception = {
  latex: string;
  reserialized: string;
  mismatch: string;
  class: string;
  reason: 'bug' | 'documented-lossy';
  note?: string;
};

const expected = new Map<string, Exception>(
  (exceptionsFile.exceptions as Exception[]).map((e) => [e.latex, e])
);

type Failure = {
  latex: string;
  reserialized: string;
  mismatch: string;
};

/** Truncate a JSON blob so the exception list stays readable. */
function brief(s: string, max = 220): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Run the round-trip property on one input.
 * Returns `null` if the property holds or the input is skipped.
 */
function roundTrip(input: string): { skipped: boolean; failure: Failure | null } {
  const ce = new ComputeEngine();
  let t: ReturnType<ComputeEngine['parse']>;
  try {
    t = ce.parse(input);
    if (!t.isValid || JSON.stringify(t.json).includes('"Error"'))
      return { skipped: true, failure: null };
  } catch {
    return { skipped: true, failure: null };
  }

  let reserialized: string;
  try {
    reserialized = t.latex;
  } catch (e) {
    return {
      skipped: false,
      failure: {
        latex: input,
        reserialized: '',
        mismatch: `serialization threw: ${e}`,
      },
    };
  }

  let t2: ReturnType<ComputeEngine['parse']>;
  try {
    t2 = ce.parse(reserialized);
  } catch (e) {
    return {
      skipped: false,
      failure: { latex: input, reserialized, mismatch: `reparse threw: ${e}` },
    };
  }

  let same = false;
  try {
    same = t2.isSame(t);
  } catch (e) {
    return {
      skipped: false,
      failure: { latex: input, reserialized, mismatch: `isSame threw: ${e}` },
    };
  }
  if (same) return { skipped: false, failure: null };

  const a = brief(JSON.stringify(t.json));
  const b = brief(JSON.stringify(t2.json));
  const mismatch =
    a === b
      ? `identical MathJSON, isSame false (binding/order): ${a}`
      : `${a}  ≠  ${b}`;
  return { skipped: false, failure: { latex: input, reserialized, mismatch } };
}

const inputs: string[] = [
  ...corpus.fragments.map((c: any) => c.latex),
  ...corpus.unicodeAnswers.map((c: any) => c.input),
];

const t0 = Date.now();
let skipped = 0;
let passed = 0;
const failures: Failure[] = [];
for (const input of inputs) {
  const r = roundTrip(input);
  if (r.skipped) skipped++;
  else if (r.failure === null) passed++;
  else failures.push(r.failure);
}
const elapsed = Date.now() - t0;

// --- Reconcile against the exception list ---------------------------------
const failed = new Map(failures.map((f) => [f.latex, f]));
const unexpected = failures.filter((f) => !expected.has(f.latex));
const stale = [...expected.keys()].filter((k) => !failed.has(k));
const drifted = failures.filter((f) => {
  const e = expected.get(f.latex);
  return (
    e !== undefined &&
    (e.reserialized !== f.reserialized || e.mismatch !== f.mismatch)
  );
});

// --- Report ---------------------------------------------------------------
console.log(`\nRound-trip property: ce.parse(t.latex).isSame(t)  [structural tier]`);
console.log(`Corpus ${path.basename(corpusPath)} captured ${corpus.date} on v${corpus.engineVersion}`);
console.log(`${'corpus inputs'.padEnd(28)}${String(inputs.length).padStart(5)}`);
console.log(`${'skipped (parse not clean)'.padEnd(28)}${String(skipped).padStart(5)}`);
console.log(`${'checked'.padEnd(28)}${String(inputs.length - skipped).padStart(5)}`);
console.log(`${'round-trips'.padEnd(28)}${String(passed).padStart(5)}`);
console.log(`${'failures'.padEnd(28)}${String(failures.length).padStart(5)}`);
console.log(`${'  known (exception list)'.padEnd(28)}${String(failures.length - unexpected.length - drifted.length).padStart(5)}`);
console.log(`${'  drifted (defect changed)'.padEnd(28)}${String(drifted.length).padStart(5)}`);
console.log(`${'  UNEXPECTED'.padEnd(28)}${String(unexpected.length).padStart(5)}`);
console.log(`${'elapsed'.padEnd(28)}${String(elapsed).padStart(5)} ms`);

const byClass: Record<string, { bug: number; lossy: number }> = {};
for (const f of failures) {
  const e = expected.get(f.latex);
  const cls = e?.class ?? 'UNEXPECTED';
  const stat = (byClass[cls] ??= { bug: 0, lossy: 0 });
  if (e?.reason === 'documented-lossy') stat.lossy++;
  else stat.bug++;
}
if (failures.length > 0) {
  console.log('\nfailure class                              bug / documented-lossy');
  for (const [cls, s] of Object.entries(byClass).sort(
    (a, b) => b[1].bug + b[1].lossy - (a[1].bug + a[1].lossy)
  ))
    console.log(`${cls.padEnd(42)}${String(s.bug).padStart(4)} / ${s.lossy}`);
}

if (showFailures)
  for (const f of failures) {
    const e = expected.get(f.latex);
    console.log(`\n[${e?.class ?? 'UNEXPECTED'}] ${f.latex}`);
    console.log(`  → ${f.reserialized}`);
    console.log(`  ${f.mismatch}`);
  }

if (stale.length > 0) {
  console.log(
    `\n${stale.length} exception(s) now round-trip` +
      (update ? ' (removed):' : ' (run with --update to remove):')
  );
  for (const s of stale) console.log(`  [${expected.get(s)!.class}] ${s}`);
}

if (drifted.length > 0) {
  console.log(
    `\n${drifted.length} exception(s) still failing with different detail` +
      (update
        ? ' (refreshed):'
        : ' — DRIFTED (fix the regression, or run with --update to refresh):')
  );
  for (const f of drifted) {
    console.log(`  ${f.latex}`);
    console.log(`    → ${f.reserialized}`);
    console.log(`    ${f.mismatch}`);
    const e = expected.get(f.latex)!;
    console.log(`    recorded → ${e.reserialized}`);
    console.log(`    recorded   ${e.mismatch}`);
  }
}

if (unexpected.length > 0) {
  console.log(`\n${unexpected.length} UNEXPECTED round-trip FAILURE(S):`);
  for (const f of unexpected) {
    console.log(`  ${f.latex}`);
    console.log(`    → ${f.reserialized}`);
    console.log(`    ${f.mismatch}`);
  }
}

if (update) {
  const next: Exception[] = failures
    .map((f) => {
      const e = expected.get(f.latex);
      const next: Exception = {
        latex: f.latex,
        reserialized: f.reserialized,
        mismatch: f.mismatch,
        class: e?.class ?? 'unclassified',
        reason: e?.reason ?? ('bug' as const),
      };
      if (e?.note !== undefined) next.note = e.note;
      return next;
    })
    .sort((a, b) => (a.class + a.latex).localeCompare(b.class + b.latex));
  exceptionsFile.exceptions = next;
  exceptionsFile.lastChecked = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    exceptionsPath,
    JSON.stringify(exceptionsFile, null, 1) + '\n'
  );
  console.log(
    `\nUpdated ${path.basename(exceptionsPath)} (${next.length} exception(s), lastChecked: ${exceptionsFile.lastChecked})`
  );
}

if (unexpected.length > 0 || (drifted.length > 0 && !update)) process.exit(1);
