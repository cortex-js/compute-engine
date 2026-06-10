/**
 * M0 scale-benchmark scaffold for the rule-dispatch track
 * (FUNGRIM-PLAN-2-RULES.md §3 M0, finished in M4).
 *
 * Measures `simplify()` over the shared corpus:
 *   (a) with the standard simplification rule set only, and
 *   (b) after pushing 1,500 synthetic INERT pattern rules (heads `F0`…`F149`)
 *       onto `ce.simplificationRules`.
 *
 * M0 DOCUMENTS THE PROBLEM the operator index (M2) solves: without indexing,
 * every rule is linearly scanned per node per pass, so (b) is expected to be
 * ~10x+ slower than (a) even though none of the synthetic rules can ever
 * fire. The measured ratio is reported via `console.info`; the assertion
 * budget is deliberately VERY generous so this suite never fails CI on the
 * pre-index baseline (machine-independent: we assert a ratio between two
 * in-process measurements, never absolute milliseconds — same approach as
 * `performance.test.ts`).
 *
 * M4 will tighten the budget to the Feature-A acceptance criterion
 * (+1,500 indexed rules ≤ 1.5x standard baseline) once the index is in.
 *
 * Caveat (from the plan): REVIEW E7 (`.simplify()` calls inside rules)
 * currently dominates some rule costs; ratios here are chosen to be robust
 * whether or not E7 lands.
 */

import { ComputeEngine } from '../../../src/compute-engine';
import {
  SIMPLIFY_CORPUS_FLAT,
  SYNTHETIC_HEAD_COUNT,
  SYNTHETIC_RULE_COUNT,
  declareSyntheticHeads,
  makeSyntheticRules,
} from '../rule-dispatch-corpus';

jest.setTimeout(600_000);

// Pre-index, a full 1,500-rule pass over the whole corpus is slow; use a
// stable, representative subset (every other expression) to keep this suite
// fast enough for CI while still exercising every rule family.
const BENCH_CORPUS: ReadonlyArray<string> = SIMPLIFY_CORPUS_FLAT.filter(
  (_, i) => i % 2 === 0
);

const MEASURED_RUNS = 3;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

type ParsedExpression = ReturnType<ComputeEngine['parse']>;

/** Time one `simplify()` pass over `exprs`. Returns elapsed ms and the
 * serialized results (used to verify the synthetic rules are inert). */
function timeSimplify(exprs: ReadonlyArray<ParsedExpression>): {
  ms: number;
  results: string[];
} {
  const start = globalThis.performance.now();
  const results = exprs.map((e) => e.simplify().toString());
  const ms = globalThis.performance.now() - start;
  return { ms, results };
}

describe('synthetic rule generation helper', () => {
  it('generates the requested number of inert rules with unique ids and literals', () => {
    const rules = makeSyntheticRules();
    expect(rules.length).toBe(SYNTHETIC_RULE_COUNT);

    const ids = new Set(
      rules.map((r) => (typeof r === 'object' ? r.id : undefined))
    );
    expect(ids.size).toBe(SYNTHETIC_RULE_COUNT);

    // Heads cycle over F0…F149
    const heads = new Set(
      rules.map((r) =>
        typeof r === 'object' && Array.isArray(r.match) ? r.match[0] : ''
      )
    );
    expect(heads.size).toBe(SYNTHETIC_HEAD_COUNT);
  });

  it('synthetic rules can be declared, pushed and boxed without errors', () => {
    const ce = new ComputeEngine();
    declareSyntheticHeads(ce, 10);
    ce.simplificationRules.push(...makeSyntheticRules(100, 10));
    // Trigger boxing of the extended rule set
    const result = ce.parse('x + 0').simplify();
    expect(result.json).toEqual('x');
  });
});

describe('rule-dispatch scale benchmark (M0 baseline)', () => {
  it('measures simplify() degradation from +1,500 inert (never-firing) rules', () => {
    const ce = new ComputeEngine();
    declareSyntheticHeads(ce);

    const exprs = BENCH_CORPUS.map((src) => ce.parse(src));

    //
    // (a) Standard rule set
    //
    // Warm-up: boxes the standard rule set, warms the JIT
    timeSimplify(exprs);

    const baselineTimes: number[] = [];
    let baselineResults: string[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) {
      const { ms, results } = timeSimplify(exprs);
      baselineTimes.push(ms);
      baselineResults = results;
    }
    const baseline = median(baselineTimes);

    //
    // (b) Standard rule set + 1,500 synthetic inert rules
    //
    ce.simplificationRules.push(...makeSyntheticRules());

    // First call after the push re-boxes the (now 1,500+ rule) set —
    // measure the one-time boxing cost separately.
    const boxingStart = globalThis.performance.now();
    timeSimplify(exprs);
    const firstLoadedRun = globalThis.performance.now() - boxingStart;

    const loadedTimes: number[] = [];
    let loadedResults: string[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) {
      const { ms, results } = timeSimplify(exprs);
      loadedTimes.push(ms);
      loadedResults = results;
    }
    const loaded = median(loadedTimes);

    // The synthetic rules must be inert: same results, before and after.
    // (This is also a primitive form of the M2 differential invariant.)
    expect(loadedResults).toEqual(baselineResults);

    const ratio = loaded / Math.max(baseline, 0.0001);

    console.info(
      `[rule-dispatch benchmark] corpus: ${BENCH_CORPUS.length} expressions, ` +
        `${MEASURED_RUNS} measured runs (median)\n` +
        `  standard rule set:        ${baseline.toFixed(1)} ms/run ` +
        `(runs: ${baselineTimes.map((t) => t.toFixed(1)).join(', ')})\n` +
        `  +${SYNTHETIC_RULE_COUNT} inert rules:        ${loaded.toFixed(1)} ms/run ` +
        `(runs: ${loadedTimes.map((t) => t.toFixed(1)).join(', ')})\n` +
        `  degradation ratio:        ${ratio.toFixed(1)}x\n` +
        `  first run after push (incl. one-time rule boxing): ${firstLoadedRun.toFixed(1)} ms`
    );

    // M0: informational only. The pre-index expectation is ~10x+ degradation;
    // the budget below is deliberately loose so this suite documents the
    // problem without ever failing CI. M4 tightens this to the Feature-A
    // acceptance criterion: ratio ≤ 1.5.
    expect(baseline).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1000);
  });
});
