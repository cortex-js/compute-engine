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
import { readCorpusDocs, compileRuleDocs } from './compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';

// pass tolerance for central-difference verification (h=1e-4: truncation
// ~1e-8 relative, roundoff ~1e-12)
const REL_TOL = 1e-5;
const MIN_POINTS = 3;
// mixed-sign sample points: special-function results (₂F₁ etc.) often
// evaluate only in part of the domain (|z|<1), and negative x reaches it
const X_POINTS = [
  0.31, 0.73, 1.27, 1.83, 2.41, 2.97, 0.52, 1.61, -0.23, -0.41, -0.87,
  -1.31, 0.05, -0.05, 0.11, -0.11, 0.17, -0.17, -2.17, -3.61,
];
// fallback for integrands with an empty real domain: generic complex
// points (off the real axis, away from small-radius branch points)
const COMPLEX_POINTS: { re: number; im: number }[] = [
  { re: 0.37, im: 0.59 },
  { re: -0.43, im: 0.91 },
  { re: 1.21, im: -0.33 },
  { re: 0.83, im: 1.47 },
  { re: -1.57, im: -0.71 },
  { re: 2.23, im: 0.41 },
];
const PARAM_ASSIGNMENTS = 2;
// wall-clock budget for the numeric verification phase of a single problem.
// Each sample point is a subs+N on the (possibly large) result; a degree-20
// ₂F₁/Appell antiderivative can cost seconds per N, and 8 assignments × 20
// points then runs for minutes. The leafCount>10k guard only catches the
// giant results; this caps the slow-but-not-huge tail too. On expiry the
// verdict is taken from the evidence gathered so far (see classifyTimeout).
const VERIFY_BUDGET_MS = 8000;

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
  | 'solved-formal'
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

function leafCount(e: BoxedExpression): number {
  if (!e.ops) return 1;
  return 1 + e.ops.reduce((s, op) => s + leafCount(op), 0);
}

function containsOperator(expr: BoxedExpression, op: string): boolean {
  if (expr.operator === op) return true;
  if (expr.ops) return expr.ops.some((x) => containsOperator(x, op));
  return false;
}

type C = { re: number; im: number };

function complexAt(
  expr: BoxedExpression,
  x: string,
  value: number | C
): C | null {
  const xv =
    typeof value === 'number' ? value : expr.engine.number(value);
  // N() respects ce.timeLimit and throws CancellationError when a single
  // evaluation runs too long (a slow ₂F₁/Appell point); treat that as an
  // unusable point (null), not a harness error.
  let v: BoxedExpression;
  try {
    v = expr.subs({ [x]: xv as any }).N();
  } catch (e) {
    if (e instanceof Error && e.constructor.name === 'CancellationError')
      return null;
    throw e;
  }
  if (!isNumber(v)) return null;
  const re = v.re;
  const im = v.im;
  if (typeof re !== 'number' || typeof im !== 'number') return null;
  if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
  return { re, im };
}

/** Richardson-extrapolated central difference F′(x) at a (possibly
 * complex) point, differencing along the real axis: combines steps h and
 * h/2 for O(h⁴) truncation — high-order poles like x⁻¹⁰⁰ and degree-20
 * polynomial antiderivatives are far outside plain central-difference
 * accuracy at REL_TOL. */
function dF(
  F: BoxedExpression,
  x: string,
  xv: number | C,
  h: number
): C | null {
  const at = (d: number): C | null =>
    complexAt(
      F,
      x,
      typeof xv === 'number' ? xv + d : { re: xv.re + d, im: xv.im }
    );
  const Fp = at(h);
  const Fm = at(-h);
  if (!Fp || !Fm) return null;
  // catastrophic-cancellation guard: when F(x±h) agree to ~9+ digits the
  // difference is double-precision noise (degree-20 expanded polynomial
  // antiderivatives evaluated near a root of the integrand) — no usable
  // derivative signal at this point
  const fMag = Math.max(
    Math.hypot(Fp.re, Fp.im),
    Math.hypot(Fm.re, Fm.im)
  );
  if (Math.hypot(Fp.re - Fm.re, Fp.im - Fm.im) < 1e-9 * fMag) return null;
  const d1 = { re: (Fp.re - Fm.re) / (2 * h), im: (Fp.im - Fm.im) / (2 * h) };
  const Fp2 = at(h / 2);
  const Fm2 = at(-h / 2);
  if (!Fp2 || !Fm2) return d1;
  const d2 = { re: (Fp2.re - Fm2.re) / h, im: (Fp2.im - Fm2.im) / h };
  return { re: (4 * d2.re - d1.re) / 3, im: (4 * d2.im - d1.im) / 3 };
}

function runProblem(
  p: Problem,
  seed: number,
  rubi?: { ce: ComputeEngine; driver: RubiDriver }
): ProblemResult {
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

  // Fresh engine per problem (avoids cross-problem state) — except in
  // --rubi mode, where compiled patterns are tied to a shared engine.
  const ce = rubi?.ce ?? new ComputeEngine();

  try {
    const f = ce.expr(p.integrand as any);
    const result = rubi
      ? (rubi.driver.int(f, p.variable) ??
        ce.function('Integrate', [f, ce.symbol(p.variable)]))
      : ce.expr(['Integrate', p.integrand as any, p.variable]).evaluate();

    if (containsOperator(result, 'Integrate'))
      return done('unsolved', { result: result.toString() });

    // verification on huge results can grind for minutes — call it
    // inconclusive rather than stalling the harness (numeric
    // central-difference is per-point subs+N, so the budget is generous)
    if (leafCount(result) > 10_000)
      return done('inconclusive', {
        result: result.toString().slice(0, 400),
        detail: 'result too large to verify',
      });

    // Verify: F′(x) ≈ f(x) at sample points via numeric central
    // difference — deliberately NOT symbolic D: the engine's
    // D→simplify pipeline has an unsound x/√(x²) → 1 rewrite (loses
    // sign(x)) that poisons derivative-based checks. (See RUBI.md.)
    const params = new Set<string>();
    collectSymbols(p.integrand, params);
    params.delete(p.variable);

    const rand = mulberry32(seed ^ hash(`${p.file}#${p.index}`));
    let passes = 0;
    let fails = 0;
    let worst = 0;
    let budgetHit = false;
    const tVerify = Date.now();
    const overBudget = (): boolean => Date.now() - tVerify > VERIFY_BUDGET_MS;
    const failPoints: string[] = [];
    // real-axis samples retained for the region-phase (formal) analysis
    type Sample = { k: number; x: number; lhs: C; rhs: C; err: number };
    const realSamples: Sample[] = [];
    const exprByAssignment = new Map<
      number,
      { Fk: BoxedExpression; fk: BoxedExpression }
    >();
    let assignmentIndex = -1;
    // checks one sample point; returns true when enough evidence gathered
    const checkPoint = (
      Fk: BoxedExpression,
      fk: BoxedExpression,
      assignment: Record<string, number>,
      xv: number | C
    ): void => {
      const mag =
        typeof xv === 'number' ? Math.abs(xv) : Math.hypot(xv.re, xv.im);
      const h = 1e-4 * Math.max(0.01, mag);
      const lhs = dF(Fk, p.variable, xv, h);
      const rhs = complexAt(fk, p.variable, xv);
      if (!lhs || !rhs) return;
      const scale =
        1 + Math.hypot(rhs.re, rhs.im) + Math.hypot(lhs.re, lhs.im);
      const err = Math.hypot(lhs.re - rhs.re, lhs.im - rhs.im) / scale;
      worst = Math.max(worst, err);
      if (typeof xv === 'number')
        realSamples.push({ k: assignmentIndex, x: xv, lhs, rhs, err });
      if (err < REL_TOL) passes++;
      else if (err > 1e-3) {
        fails++;
        failPoints.push(
          `x=${JSON.stringify(xv)} ${JSON.stringify(assignment)} dF=${lhs.re.toPrecision(4)}${lhs.im ? '+' + lhs.im.toPrecision(3) + 'i' : ''} f=${rhs.re.toPrecision(4)}${rhs.im ? '+' + rhs.im.toPrecision(3) + 'i' : ''}`
        );
      }
    };

    // run PARAM_ASSIGNMENTS assignments always; keep drawing fresh ones
    // (up to 8) while the sample points haven't hit the domain enough
    // times (restricted-domain integrands like √(−2−bx)·√(2−bx))
    for (let k = 0; k < 8 && fails === 0; k++) {
      if (k >= PARAM_ASSIGNMENTS && passes >= MIN_POINTS) break;
      if (overBudget()) {
        budgetHit = true;
        break;
      }
      const assignment: Record<string, number> = {};
      for (const name of params)
        assignment[name] = 0.5 + 2.5 * rand(); // generic positive reals
      const Fk = result.subs(assignment);
      const fk = f.subs(assignment);
      assignmentIndex = k;
      exprByAssignment.set(k, { Fk, fk });
      for (const xv of X_POINTS) {
        checkPoint(Fk, fk, assignment, xv);
        if (passes >= MIN_POINTS && fails === 0 && k >= PARAM_ASSIGNMENTS - 1)
          break;
        // a single slow point (huge ₂F₁ result) can blow the budget mid
        // assignment — stop here and classify on what we have
        if (overBudget()) {
          budgetHit = true;
          break;
        }
      }
    }

    // empty real domain (e.g. √(2−3x)·√(−5+2x)): differentiate along the
    // real axis at generic complex points instead — D(F) = f is an
    // identity of analytic functions, valid off the branch cuts
    if (passes === 0 && fails === 0 && !overBudget()) {
      for (let k = 0; k < PARAM_ASSIGNMENTS && !overBudget(); k++) {
        const assignment: Record<string, number> = {};
        for (const name of params) assignment[name] = 0.5 + 2.5 * rand();
        const Fk = result.subs(assignment);
        const fk = f.subs(assignment);
        for (const xv of COMPLEX_POINTS) {
          checkPoint(Fk, fk, assignment, xv);
          if (overBudget()) {
            budgetHit = true;
            break;
          }
        }
      }
      // a lone borderline complex point is weak evidence either way
      if (passes > 0 || fails > 0) {
        if (fails === 0 && passes < MIN_POINTS)
          return done('inconclusive', {
            result: result.toString(),
            detail: `complex-point verification: passes=${passes} worst=${worst.toExponential(2)}`,
          });
      }
    }

    if (fails === 0 && passes >= MIN_POINTS)
      return done('solved-correct', { result: result.toString() });

    // Region-phase formal acceptance. Rubi rule chains compose principal
    // branches; on integrands whose radicands change sign the composed
    // antiderivative can differ from f by a CONSTANT unimodular phase on
    // some regions of the real axis. This is inherent to Rubi itself
    // (verified by composing rules 1.1.1.4#30 → 1.1.2.3#41 literally in
    // mpmath: the principal-branch composition flips sign for x < −7/5
    // and x > 5/2 on 1.1.1.4#104, while the suite's hand-optimized
    // expected form does not — Rubi's own test verification is symbolic,
    // so it never sees this). Accept as 'solved-formal' when:
    //   (1) some region matches exactly (≥ MIN_POINTS passing points), and
    //   (2) every failing point has dF/f UNIMODULAR (pure phase, no
    //       magnitude error) and LOCALLY CONSTANT (same ratio at x ± δ —
    //       rejects smoothly-varying ratios from wrong coefficients).
    // A globally wrong phase (e.g. e^{iπ/4} everywhere — the old #1711
    // bug class) has no passing region and is still solved-wrong.
    if (fails >= 2 && passes >= MIN_POINTS) {
      const ratio = (n: C, d: C): C | null => {
        const m2 = d.re * d.re + d.im * d.im;
        if (m2 < 1e-30) return null;
        return {
          re: (n.re * d.re + n.im * d.im) / m2,
          im: (n.im * d.re - n.re * d.im) / m2,
        };
      };
      let formal = true;
      for (const s of realSamples) {
        if (s.err < REL_TOL) continue;
        const q = ratio(s.lhs, s.rhs);
        if (!q || Math.abs(Math.hypot(q.re, q.im) - 1) > 1e-3) {
          formal = false;
          break;
        }
        // local constancy of the phase at x ± δ (δ small enough to stay
        // within the same region for O(1)-spaced breakpoints; a crossing
        // yields a mismatched ratio → conservative rejection)
        const exprs = exprByAssignment.get(s.k);
        if (!exprs) {
          formal = false;
          break;
        }
        const delta = Math.max(0.02, 0.02 * Math.abs(s.x));
        let confirmed = 0;
        for (const xq of [s.x - delta, s.x + delta]) {
          const h = 1e-4 * Math.max(0.01, Math.abs(xq));
          const lhs = dF(exprs.Fk, p.variable, xq, h);
          const rhs = complexAt(exprs.fk, p.variable, xq);
          if (!lhs || !rhs) continue;
          const q2 = ratio(lhs, rhs);
          if (q2 && Math.hypot(q2.re - q.re, q2.im - q.im) < 2e-3)
            confirmed++;
        }
        if (confirmed === 0) {
          formal = false;
          break;
        }
      }
      if (formal)
        return done('solved-formal', {
          result: result.toString(),
          detail: `region-phase formal match: passes=${passes} phase-fails=${fails}; ${failPoints
            .slice(0, 2)
            .join('; ')}`,
        });
    }

    if (fails >= 2)
      return done('solved-wrong', {
        result: result.toString(),
        detail: `worst rel err ${worst.toExponential(2)}; ${failPoints
          .slice(0, 2)
          .join('; ')}`,
      });
    // Ran out of verification budget before reaching a verdict. With clear
    // evidence (solved-correct / solved-wrong / solved-formal) we returned
    // above; here the evidence is thin, so label it as a timeout rather
    // than 'not-evaluable' (which wrongly implies the integrand could not
    // be sampled at all).
    if (budgetHit && fails < 2)
      return done('inconclusive', {
        result: result.toString().slice(0, 400),
        detail: `verification budget exceeded (${Date.now() - tVerify}ms, passes=${passes} fails=${fails})`,
      });
    if (passes === 0 && fails === 0)
      return done('not-evaluable', {
        result: result.toString().slice(0, 300),
      });
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
  let rubiRules: string | null = null;
  let only = '';
  let keysFile = '';
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rubi':
        rubiRules = argv[++i];
        break;
      case '--only':
        only = argv[++i];
        break;
      case '--keys':
        // file with one `<file>#<index>` key per line — re-validate an
        // explicit set of problems (e.g. a cluster from a prior report)
        keysFile = argv[++i];
        break;
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
  if (only) slice = slice.filter((p) => p.source.includes(only));
  if (keysFile) {
    const wanted = new Set(
      fs
        .readFileSync(keysFile, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    slice = slice.filter((p) => wanted.has(`${p.file}#${p.index}`));
    console.log(`--keys: matched ${slice.length}/${wanted.size} keys`);
  }
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

  // --rubi <corpus-section-dir>: use the compiled Rubi rule driver on a
  // shared engine instead of the built-in integrator.
  let rubi: { ce: ComputeEngine; driver: RubiDriver } | undefined;
  if (rubiRules !== null) {
    const ce = new ComputeEngine();
    const t0 = Date.now();
    // The trig/exponential/hyperbolic chapters are NOT self-contained: their
    // reduction chains bottom out in algebraic base-case integrals that live
    // in Chapter 1 — e.g. ∫1/(a+b·sin) does a tangent-half-angle substitution
    // to ∫1/(a+2b·x+a·x²), an algebraic quadratic-rational integral closed by
    // Chapter-1 rules 1082/1083/217. Loading a higher chapter WITHOUT its
    // Chapter-1 foundation strands every such residual as an inert Integrate.
    // The shipped `loadIntegrationRules` bundles exactly this foundation
    // (Chapters 1, 2, 3, 6, §8.8 + the target section); mirror it here so the
    // benchmark measures the integrator as it actually ships. Chapter 3
    // (logarithms) is in the foundation because Chapter-2 §2.2 reduces
    // ∫(c+dx)^m·F^{gx}/(a+b·F^{gx}) into a Chapter-3 log/PolyLog integral,
    // and §8.8 (polylogarithm) terminates that telescope
    // (∫x^m·PolyLog[n,·] → PolyLog[n+1]). Only the 8.8 FILE is in the shipped
    // bundle — preloading the rest of Chapter 8 here would diverge from
    // production (and 8.7 Zeta has known compile skips).
    // Foundation dirs are
    // prepended (higher rule priority, matching Rubi's global rule order where
    // the algebraic rules precede the trig rules) and de-duplicated against the
    // target so pointing `--rubi` at a foundation chapter is a no-op.
    const corpusRoot = path.dirname(rubiRules);
    const foundationDirs = (
      process.env.RUBI_NO_FOUNDATION !== undefined
        ? []
        : [
            '1 Algebraic functions',
            '2 Exponentials',
            '3 Logarithms',
            '6 Hyperbolic functions',
            '8 Special functions/8.8 Polylogarithm function.json',
          ]
    )
      .map((d) => path.join(corpusRoot, d))
      .filter(
        (d) =>
          fs.existsSync(d) &&
          path.resolve(d) !== path.resolve(rubiRules) &&
          !path.resolve(rubiRules).startsWith(path.resolve(d) + path.sep)
      );
    const docs = [
      ...foundationDirs.flatMap((d) =>
        fs.statSync(d).isDirectory()
          ? readCorpusDocs(d)
          : [JSON.parse(fs.readFileSync(d, 'utf8'))]
      ),
      ...readCorpusDocs(rubiRules),
    ];
    const { rules, skipped } = compileRuleDocs(ce, docs);
    console.log(
      `rubi: compiled ${rules.length} rules (${skipped.length} skips) in ${Date.now() - t0}ms` +
        (foundationDirs.length
          ? ` [+foundation: ${foundationDirs.map((d) => path.basename(d)).join(', ')}]`
          : '')
    );
    if (skipped.length > 0)
      console.log(
        `  compile skips: ${skipped
          .slice(0, 5)
          .map((s) => `${s.id}: ${s.reason}`)
          .join('; ')}`
      );
    rubi = {
      ce,
      driver: new RubiDriver(ce, rules, { timeLimitMs: 15_000 }),
    };
  }

  const results: ProblemResult[] = [];
  const counts: Record<Outcome, number> = {
    'solved-correct': 0,
    'solved-formal': 0,
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
    const r = runProblem(p, seed, rubi);
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
    // strict + region-phase formal (Rubi-parity rate: Rubi-in-Mathematica
    // itself produces the region-phase forms; see runProblem)
    solvedRate:
      slice.length > 0
        ? (
            (counts['solved-correct'] + counts['solved-formal']) /
            slice.length
          ).toFixed(4)
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
