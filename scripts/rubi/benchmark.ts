// Rubi test-suite baseline benchmark — runs the *current* Compute Engine
// integrator (`Integrate` → `antiderivative()`) over a slice of the Rubi
// test suite and verifies each result by differentiation + seeded numeric
// sampling (same strategy as scripts/fungrim/numeric-check.ts).
//
// Usage (from the repo root):
//   npx tsx scripts/rubi/benchmark.ts \
//       [--suite <path>]                 # default: $RUBI_TESTS or ~/dev/rubi/MathematicaSyntaxTestSuite-master
//       [--chapter "1 Algebraic functions/1.1 Binomial products"]
//       [--limit <n>] [--sample <n>] [--seed <n>] [--report <path>]
//
// Per-problem outcomes:
//   solved-correct  — CE returned an antiderivative F and D(F) ≈ integrand
//                     at ≥ MIN_POINTS sample points, no failures
//   solved-wrong    — CE returned an antiderivative, but D(F) ≠ integrand
//   inconclusive    — mixed/insufficient numeric evidence
//   unsolved        — result still contains `Integrate`
//   not-evaluable   — D(F) − f could not be numerically evaluated
//   error           — box/evaluate threw
//
// CAUTION: CE evaluation is currently non-interruptible (ROADMAP item 2);
// a hanging problem hangs the harness. The report is written incrementally
// (--report + .partial) so a hang is attributable to the last started
// problem. RUBI_SKIP env: comma-separated `<file>#<index>` to skip.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

import { loadTests, Problem } from './load-tests';
import type { Json } from './wl-parser';

const REL_TOL = 1e-6;
const MIN_POINTS = 3;
const X_POINTS = [0.31, 0.73, 1.27, 1.83, 2.41, 2.97, 0.52, 1.61];
const PARAM_ASSIGNMENTS = 2;

const KNOWN_CONSTANTS = new Set([
  'ExponentialE',
  'Pi',
  'ImaginaryUnit',
  'PositiveInfinity',
  'GoldenRatio',
  'EulerGamma',
  'CatalanConstant',
]);

type Outcome =
  | 'solved-correct'
  | 'solved-wrong'
  | 'inconclusive'
  | 'unsolved'
  | 'not-evaluable'
  | 'error';

type ProblemResult = {
  file: string;
  index: number;
  source: string;
  outcome: Outcome;
  result?: string;
  detail?: string;
  ms: number;
};

// Deterministic PRNG (mulberry32), same role as scripts/fungrim/sample.ts.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function collectSymbols(expr: Json, out: Set<string>): void {
  if (typeof expr === 'string') {
    if (!KNOWN_CONSTANTS.has(expr)) out.add(expr);
    return;
  }
  if (Array.isArray(expr)) {
    // skip the operator position for known string heads
    for (let i = 1; i < expr.length; i++) collectSymbols(expr[i], out);
  }
}

function containsOperator(expr: BoxedExpression, op: string): boolean {
  if (expr.operator === op) return true;
  if (expr.ops) return expr.ops.some((x) => containsOperator(x, op));
  return false;
}

function complexAt(
  expr: BoxedExpression,
  x: string,
  value: number
): { re: number; im: number } | null {
  const v = expr.subs({ [x]: value }).N();
  if (!isNumber(v)) return null;
  const re = v.re;
  const im = v.im;
  if (typeof re !== 'number' || typeof im !== 'number') return null;
  if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
  return { re, im };
}

function runProblem(p: Problem, seed: number): ProblemResult {
  const start = Date.now();
  const done = (
    outcome: Outcome,
    extra: Partial<ProblemResult> = {}
  ): ProblemResult => ({
    file: p.file,
    index: p.index,
    source: p.source,
    outcome,
    ms: Date.now() - start,
    ...extra,
  });

  // Fresh engine per problem: avoids cross-problem state (declared
  // parameter types, assumption scopes) leaking into results.
  const ce = new ComputeEngine();

  try {
    const f = ce.box(p.integrand as any);
    const result = ce
      .box(['Integrate', p.integrand as any, p.variable])
      .evaluate();

    if (containsOperator(result, 'Integrate'))
      return done('unsolved', { result: result.toString() });

    // Verify: D(result, x) − f ≈ 0 at sample points, for seeded
    // generic positive parameter assignments.
    const dF = ce
      .function('D', [result, ce.symbol(p.variable)])
      .evaluate();

    const params = new Set<string>();
    collectSymbols(p.integrand, params);
    params.delete(p.variable);

    const rand = mulberry32(seed ^ hash(`${p.file}#${p.index}`));
    let passes = 0;
    let fails = 0;
    let worst = 0;
    for (let k = 0; k < PARAM_ASSIGNMENTS && fails === 0; k++) {
      const assignment: Record<string, number> = {};
      for (const name of params)
        assignment[name] = 0.5 + 2.5 * rand(); // generic positive reals
      const dFk = dF.subs(assignment);
      const fk = f.subs(assignment);
      for (const xv of X_POINTS) {
        const lhs = complexAt(dFk, p.variable, xv);
        const rhs = complexAt(fk, p.variable, xv);
        if (!lhs || !rhs) continue;
        const scale =
          1 + Math.hypot(rhs.re, rhs.im) + Math.hypot(lhs.re, lhs.im);
        const err =
          Math.hypot(lhs.re - rhs.re, lhs.im - rhs.im) / scale;
        worst = Math.max(worst, err);
        if (err < REL_TOL) passes++;
        else if (err > 1e-3) fails++;
        if (passes >= MIN_POINTS && fails === 0 && k === PARAM_ASSIGNMENTS - 1)
          break;
      }
    }

    if (fails === 0 && passes >= MIN_POINTS)
      return done('solved-correct', { result: result.toString() });
    if (fails >= 2)
      return done('solved-wrong', {
        result: result.toString(),
        detail: `worst rel err ${worst.toExponential(2)}`,
      });
    if (passes === 0 && fails === 0) return done('not-evaluable');
    return done('inconclusive', {
      result: result.toString(),
      detail: `passes=${passes} fails=${fails} worst=${worst.toExponential(2)}`,
    });
  } catch (e) {
    return done('error', { detail: String(e) });
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function main(): void {
  const argv = process.argv;
  let suite =
    process.env.RUBI_TESTS ??
    path.join(os.homedir(), 'dev/rubi/MathematicaSyntaxTestSuite-master');
  let chapter = '1 Algebraic functions';
  let limit = Infinity;
  let sample = 0;
  let seed = 42;
  let reportPath = 'scripts/rubi/baseline-report.json';
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--suite':
        suite = argv[++i];
        break;
      case '--chapter':
        chapter = argv[++i];
        break;
      case '--limit':
        limit = parseInt(argv[++i]);
        break;
      case '--sample':
        sample = parseInt(argv[++i]);
        break;
      case '--seed':
        seed = parseInt(argv[++i]);
        break;
      case '--report':
        reportPath = argv[++i];
        break;
      default:
        console.error(`unknown option ${argv[i]}`);
        process.exit(2);
    }
  }

  const { problems, errors } = loadTests(suite, chapter);
  console.log(
    `loaded ${problems.length} problems from "${chapter}" (${errors.length} parse errors)`
  );
  if (errors.length > 0)
    console.log(
      `  first parse errors: ${errors
        .slice(0, 3)
        .map((e) => `${e.file}:${e.line} ${e.error}`)
        .join('; ')}`
    );

  let slice = problems;
  if (sample > 0) {
    // deterministic sample spread over the whole chapter
    const rand = mulberry32(seed);
    slice = [...problems]
      .map((p) => ({ p, k: rand() }))
      .sort((a, b) => a.k - b.k)
      .slice(0, sample)
      .map((x) => x.p)
      .sort((a, b) =>
        a.file === b.file ? a.index - b.index : a.file < b.file ? -1 : 1
      );
  }
  if (slice.length > limit) slice = slice.slice(0, limit);

  const skip = new Set(
    (process.env.RUBI_SKIP ?? '').split(',').filter(Boolean)
  );

  const results: ProblemResult[] = [];
  const counts: Record<Outcome, number> = {
    'solved-correct': 0,
    'solved-wrong': 0,
    inconclusive: 0,
    unsolved: 0,
    'not-evaluable': 0,
    error: 0,
  };

  const partialPath = reportPath + '.partial';
  for (let i = 0; i < slice.length; i++) {
    const p = slice[i];
    const key = `${p.file}#${p.index}`;
    if (skip.has(key)) continue;
    // incremental progress marker — identifies the hanging problem if any
    fs.writeFileSync(partialPath, JSON.stringify({ at: key, i, results }));
    const r = runProblem(p, seed);
    results.push(r);
    counts[r.outcome]++;
    if ((i + 1) % 50 === 0)
      console.log(
        `  ${i + 1}/${slice.length}  correct=${counts['solved-correct']} wrong=${counts['solved-wrong']} unsolved=${counts.unsolved}`
      );
  }

  const summary = {
    suite,
    chapter,
    seed,
    total: slice.length,
    counts,
    solvedCorrectRate:
      slice.length > 0
        ? (counts['solved-correct'] / slice.length).toFixed(4)
        : 'n/a',
  };
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, results }, null, 2)
  );
  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);

  console.log('\n=== Baseline summary ===');
  for (const [k, v] of Object.entries(counts))
    console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`  total            ${slice.length}`);
  console.log(`report: ${reportPath}`);
}

main();
