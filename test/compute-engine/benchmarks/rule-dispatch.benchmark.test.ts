/**
 * M0 scale-benchmark scaffold for the rule-dispatch track
 * (docs/fungrim/FUNGRIM-PLAN-2-RULES.md §3 M0, finished in M4).
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
import { loadIdentities, FUNGRIM_CORE } from '../../../src/identities';
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

// ---------------------------------------------------------------------------
// M5 — Real-corpus scenario: the full Fungrim Phase-1 artifact (558 rules)
// loaded via loadIdentities() (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.7 item 3, §3 M5).
//
// Same machine-independent philosophy as the M0 scenario above (in-process
// ratio, never absolute milliseconds), with one methodology hardening: the
// unloaded and loaded measurements are INTERLEAVED on two engines and the
// ratio is the median of per-pair ratios. Measuring all baseline runs before
// all loaded runs (the M0 style) is vulnerable to a load regime change
// between the two phases (e.g. CI starting parallel workers mid-test), which
// was observed to inflate the phase-ordered ratio from ~3x to >8x on the
// same machine.
//
// ACCEPTANCE TARGET: simplify() over the M0 corpus with the full artifact
// loaded ≤ 1.5× the unloaded baseline. The hard assertion below is a
// generous CI budget (same never-flake style as the M0 scenario's <1000);
// the measured ratio is reported via console.info so the 1.5× target is
// auditable in the run log. Idle dev-laptop measurement: ~3-3.5x — ABOVE the
// 1.5x target. The overhead concentrates in identity-recognition rules whose
// match heads are core arithmetic operators (Multiply/Add/Divide bucket
// collisions on every node), not in specific-value buckets; if the target is
// to be met, the §2.4 fallback (per-head functional dispatcher with the
// `operators` hint) or an arithmetic-head pre-filter in the loader is the
// designated fix.
//
// Unlike the synthetic-inert scenario, fungrim rules CAN legitimately fire
// (that is their purpose), so before/after results are not asserted equal —
// any differences are counted and reported instead. On the assumption-free
// M0 corpus no fungrim rule is expected to fire (guards require typed
// symbols; the corpus' specific values are outside the artifact heads).
// ---------------------------------------------------------------------------

describe('rule-dispatch real-corpus benchmark (M5, Fungrim Phase-1 artifact)', () => {
  it('measures simplify() with the full 558-rule artifact loaded via loadIdentities()', () => {
    // Two engines: ceBase stays unloaded, ceLoaded gets the full artifact.
    // Interleaved runs make each (base, loaded) pair share the same load
    // regime, so the per-pair ratio is robust to ambient machine noise.
    const ceBase = new ComputeEngine();
    const ceLoaded = new ComputeEngine();

    const exprsBase = BENCH_CORPUS.map((src) => ceBase.parse(src));
    const exprsLoaded = BENCH_CORPUS.map((src) => ceLoaded.parse(src));

    // Warm-up + baseline-result capture on the unloaded engine
    const { results: baselineResults } = timeSimplify(exprsBase);

    //
    // Load the full Phase-1 artifact into ceLoaded
    //
    const loadStart = globalThis.performance.now();
    const report = loadIdentities(ceLoaded);
    const loadMs = globalThis.performance.now() - loadStart;
    // Default load registers the simplify-target rules (the solve overlay is
    // skipped without { solve: true }).
    expect(report.loaded).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );

    // First call after the load re-boxes the (now 558-rule larger) set —
    // measure the one-time amortization cost separately. Also captures the
    // loaded results for the differential report.
    const firstStart = globalThis.performance.now();
    const { results: loadedResults } = timeSimplify(exprsLoaded);
    const firstLoadedRun = globalThis.performance.now() - firstStart;

    //
    // Interleaved measurement: MEASURED_RUNS (base, loaded) pairs
    //
    const baselineTimes: number[] = [];
    const loadedTimes: number[] = [];
    const pairRatios: number[] = [];
    for (let i = 0; i < MEASURED_RUNS; i++) {
      const base = timeSimplify(exprsBase).ms;
      const loaded = timeSimplify(exprsLoaded).ms;
      baselineTimes.push(base);
      loadedTimes.push(loaded);
      pairRatios.push(loaded / Math.max(base, 0.0001));
    }
    const baseline = median(baselineTimes);
    const loaded = median(loadedTimes);
    const ratio = median(pairRatios);

    // Fungrim rules are NOT inert by design; report (don't assert) changes.
    const changed = loadedResults.filter((r, i) => r !== baselineResults[i]);

    const amortization = firstLoadedRun / Math.max(loaded, 0.0001);

    console.info(
      `[fungrim real-corpus benchmark] corpus: ${BENCH_CORPUS.length} expressions, ` +
        `${MEASURED_RUNS} interleaved run pairs (median)\n` +
        `  unloaded baseline:        ${baseline.toFixed(1)} ms/run ` +
        `(runs: ${baselineTimes.map((t) => t.toFixed(1)).join(', ')})\n` +
        `  +${report.loaded} fungrim rules:      ${loaded.toFixed(1)} ms/run ` +
        `(runs: ${loadedTimes.map((t) => t.toFixed(1)).join(', ')})\n` +
        `  degradation ratio:        ${ratio.toFixed(2)}x (target ≤ 1.5x; ` +
        `pair ratios: ${pairRatios.map((r) => r.toFixed(2)).join(', ')})\n` +
        `  loadIdentities() call:    ${loadMs.toFixed(1)} ms\n` +
        `  first run after load (incl. one-time rule boxing): ` +
        `${firstLoadedRun.toFixed(1)} ms (${amortization.toFixed(1)}x steady-state)\n` +
        `  corpus results changed by fungrim rules: ${changed.length}`
    );

    expect(baseline).toBeGreaterThan(0);
    // Acceptance target: ratio ≤ 1.5x (see header comment — currently ~3x on
    // an idle dev laptop; the actual measurement is in the log above). The
    // hard CI budget is deliberately generous so this suite documents the
    // number without ever failing CI on noise — it still catches a return to
    // the pre-index linear-scan regime (~10x+ and growing with rule count).
    expect(ratio).toBeLessThan(8);
    // First-call amortization: the one-time boxing of 550+ extra rules must
    // stay within an order of magnitude of a steady-state run (absolute
    // floor for very fast machines / very noisy CI).
    expect(firstLoadedRun).toBeLessThan(Math.max(20 * loaded, 10_000));
  });
});
