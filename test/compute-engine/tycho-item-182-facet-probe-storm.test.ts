/**
 * Tycho item 182 — canonicalization-time collection-facet probe storm.
 *
 * Parsing one slot of a Desmos-derived head,
 * `\frac{255(0.5+\frac{1}{60}L[1+3(0..(\mathrm{Length}(D)-1))])}{255}`,
 * against a document-like state (`L` a large literal list, `D` an
 * UNEVALUATED lazy comprehension over slices of `L`, with FORWARD-REFERENCED
 * user functions in the comprehension body) used to run an unbounded
 * facet-probe cascade: every `count`/`isFinite`/`isEmpty` read on the
 * symbolic-bound `Range` numerically evaluated `Length(D)-1`, which
 * re-scanned the comprehension's clause domains, which re-boxed fresh
 * `Range`s and constructed fresh broadcast lambdas whose parameter declares
 * invalidated every generation-keyed cache engine-wide — so nothing ever
 * cached and the loop amplified itself (~9.4 s under Tycho's 5 s span
 * guard; a 4 GB OOM crash without one).
 *
 * The fix is the dependency-precise collection-facet memo
 * (`BoxedFunction._memoizedFacet`, riding `snapshotMemoDeps`/
 * `memoDepsStillValid`), plus two eligibility repairs in the shared
 * dependency machinery: a forward-referenced operator head heals through
 * the resolution chain, and a valueless occurrence the instance's chain
 * cannot reach at all (a lambda body's auto-declared free) is tracked as
 * unresolved (`resolved: undefined`), invalidated the moment a binding
 * for that name first becomes reachable. (Resolving such occurrences
 * through the lambda body's own scope chain was tried and REFUTED —
 * closures re-root at evaluation, so the walk reads the ambient chain.)
 *
 * Test doctrine (lazy-collection rounds): budgets are pinned on the
 * `facetComputeCount()` module counter — never wall-clock, never prototype
 * patching — with a non-vacuity floor so a silently-disabled memo cannot
 * green the suite.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { facetComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';

/** The document-like state of the lizeqlnn5e repro, scaled down: the
 * forward-reference ORDER of the function assignments is load-bearing
 * (`P_roj` and `R` reference operators assigned only later — the shape that
 * made the comprehension ineligible for dependency snapshots before the
 * heal). */
function documentState(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, lit] of [
    ['P_roj', 'M \\mapsto \\operatorname{PointList}(R(M)[1], R(M)[2])'],
    ['R', 'M \\mapsto R_{xz}(R_{yz}(M-\\bigl\\lbrack0, 0, Y\\bigr\\rbrack))'],
    [
      'R_yz',
      'M \\mapsto \\bigl\\lbrack M[1], M[2]\\cos(a)-M[3]\\sin(a), M[2]\\sin(a)+M[3]\\cos(a)\\bigr\\rbrack',
    ],
    [
      'R_xz',
      'M \\mapsto \\bigl\\lbrack M[1]\\cos(c)-M[3]\\sin(c), M[2], M[1]\\sin(c)+M[3]\\cos(c)\\bigr\\rbrack',
    ],
  ] as const)
    ce.assign(name, ce.parse(lit, { strict: false }));

  const nums = Array.from({ length: 300 }, (_, i) => (i % 97) / 10);
  ce.assign('L', ce.box(['List', ...nums]).evaluate());
  ce.assign(
    'D',
    ce.parse(
      '\\left[P_{roj}(L[3i+(1..3)]) \\operatorname{for} i = (1..(\\frac{\\mathrm{Length}(L)}{3}))-1\\right]',
      { strict: false }
    )
  );
  return ce;
}

const HEAD =
  '\\frac{255(0.5+\\frac{1}{60}L[1+3(0..(\\mathrm{Length}(D)-1))])}{255}';

describe('Tycho item 182 — collection-facet probe storm', () => {
  test('canonicalizing the At-broadcast head stays within the facet-compute budget', () => {
    const ce = documentState();
    const before = facetComputeCount();
    const expr = ce.parse(HEAD, { strict: false });
    const delta = facetComputeCount() - before;
    expect(expr.isValid).toBe(true);
    // Measured 32 on 2026-08-14; the pre-fix storm ran hundreds of
    // thousands of computes (unbounded — OOM without a deadline). Generous
    // headroom, still three orders below the disease.
    expect(delta).toBeLessThan(200);
    // Non-vacuity: the parse DOES probe facets — a zero delta would mean
    // the counter (or the probe path) is disconnected, not that the storm
    // is fixed.
    expect(delta).toBeGreaterThanOrEqual(1);
  });

  test('a re-parse of the same head runs on a warm memo', () => {
    const ce = documentState();
    ce.parse(HEAD, { strict: false });
    const before = facetComputeCount();
    ce.parse(HEAD, { strict: false });
    expect(facetComputeCount() - before).toBeLessThan(10);
  });

  test('repeated facet reads on one instance are memo hits with identical answers', () => {
    const ce = documentState();
    const range = ce.box(['Range', 0, ['Subtract', ['Length', 'D'], 1]]);
    // In this scaled state `Length(D)` resolves concretely (300-element
    // `L`, 3-element slices → 100), so the symbolic-bound Range answers a
    // definite count. The pin is STABILITY: repeat reads answer
    // identically and do not recompute.
    const finite = range.isFiniteCollection;
    const count = range.count;
    expect(count).toBe(100);
    expect(finite).toBe(true);
    const settled = facetComputeCount();
    expect(range.isFiniteCollection).toBe(finite);
    expect(range.count).toBe(count);
    expect(range.isEmptyCollection).toBe(false);
    expect(facetComputeCount() - settled).toBeLessThanOrEqual(1); // isEmpty may compute once
    const third = facetComputeCount();
    expect(range.count).toBe(count);
    expect(range.isEmptyCollection).toBe(false);
    expect(facetComputeCount() - third).toBe(0);
  });

  test('a value write to a dependency refreshes a memoized count', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'T',
      ce.parse('\\left[x \\operatorname{for} x = 1..n\\right]', {
        strict: false,
      })
    );
    expect(ce.box(['Length', 'T']).evaluate().isSame(4)).toBe(false);
    ce.assign('n', 4);
    expect(ce.box(['Length', 'T']).evaluate().isSame(4)).toBe(true);
    ce.assign('n', 7);
    expect(ce.box(['Length', 'T']).evaluate().isSame(7)).toBe(true);
  });

  test('an ephemeral binder-index write refreshes the memoized count per iteration', () => {
    const ce = new ComputeEngine();
    // Length([x for x in 1..k]) is k; a memo serving a stale count across
    // Sum iterations would not total 15.
    const sum = ce.parse(
      '\\sum_{k=1}^{5} \\mathrm{Length}(\\left[x \\operatorname{for} x = 1..k\\right])',
      { strict: false }
    );
    expect(sum.evaluate().isSame(15)).toBe(true);
  });

  test('a count degraded by the iteration limit is never frozen', () => {
    const ce = new ComputeEngine();
    // A DEPENDENT comprehension (y's domain depends on x) has no closed-form
    // count, so counting it enumerates — 1275 iterations here — and gives up
    // with "unknown" when `ce.iterationLimit` is lower than that.
    const comp = ce.box([
      'Comprehension',
      'y',
      ['Element', 'x', ['Range', 1, 50]],
      ['Element', 'y', ['Range', 1, 'x']],
    ]);
    ce.iterationLimit = 100;
    expect(comp.count).toBe(undefined);
    // The limit-degraded "unknown" must not have been stored: `iterationLimit`
    // writes advance no axis the memo keys on, so a frozen entry would
    // survive a raised limit. The settled-only gate declines instead — a
    // repeat read at the same limit RECOMPUTES.
    const before = facetComputeCount();
    expect(comp.count).toBe(undefined);
    expect(facetComputeCount()).toBeGreaterThan(before);
    // And with the limit raised, the same instance answers definitively.
    ce.iterationLimit = 10_000;
    expect(comp.count).toBe(1275);
  });

  test('an operator→scalar kind swap of a walked lambda head invalidates the memo', () => {
    const ce = new ComputeEngine();
    // `h` is forward-referenced from `g`'s body; the kind swap
    // `assign('h', 5)` advances NO version axis (`redefine
    // {callableAfter: false}` is zero-mask), so only the dependency's
    // inner-operator identity check can catch it.
    ce.assign('g', ce.parse('x \\mapsto h(x)+1', { strict: false }));
    ce.assign('h', ce.parse('x \\mapsto 2x', { strict: false }));
    ce.assign(
      'C',
      ce.parse('\\left[g(x) \\operatorname{for} x = 1..m\\right]', {
        strict: false,
      })
    );
    const cValue = ce.box('C').evaluate();
    const c0 = facetComputeCount();
    const first = cValue.count;
    expect(facetComputeCount()).toBeGreaterThan(c0); // non-vacuity: computed
    const c1 = facetComputeCount();
    expect(cValue.count).toBe(first);
    expect(facetComputeCount()).toBe(c1); // repeat read: memo hit
    ce.assign('h', 5);
    const c2 = facetComputeCount();
    expect(cValue.count).toBe(first); // the count itself is body-independent…
    expect(facetComputeCount()).toBeGreaterThan(c2); // …but it must RECOMPUTE
  });
});
