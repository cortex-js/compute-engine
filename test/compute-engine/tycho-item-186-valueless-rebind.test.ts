/**
 * Tycho item 186 — a valueless→valueless rebind of a pinned binding must
 * not invalidate dependency-precise memos.
 *
 * The item-182 storm class survived in document context because of ONE
 * dependency-validation rule: `memoDepsStillValid` failed whenever a dep's
 * occurrence no longer pinned the identical inner value definition. A
 * lambda-body free that no chain resolves (`R_xz`'s `c` below) has a
 * VALUELESS auto-declared pinned binding, and bare-symbol canonicalization
 * re-auto-declares such a name (`ce.symbol(name)` →
 * `_declareSymbolValue`/`updateDef`), replacing the shared wrapper's inner
 * definition in place while bumping no version axis. Every facet snapshot
 * that walked the body was then born-stale: each `count`/`isEmpty` probe of
 * the comprehension recomputed, the recompute re-canonicalized broadcast
 * lambdas and swapped the binding again, and one `ce.parse` of the
 * lizeqlnn5e color head built ~460K broadcast lambdas before timing out
 * (ROADMAP.md "Tycho item 186" — C₂ span at L-length 304).
 *
 * The fix: a swap from one VALUELESS definition to another VALUELESS one is
 * a re-auto-declare, not a semantic change — a definition holding no value
 * never supplies what a walk reads; the name resolves through the scope
 * chain, which the re-resolution check still validates. Identity (and
 * `_writeVersion` continuity) stays load-bearing when either side holds a
 * value.
 *
 * Test doctrine (lazy-collection rounds): budgets are pinned on the
 * `facetComputeCount()` module counter — never wall-clock — with
 * non-vacuity floors. The swap is performed at the seam (replacing the
 * pinned wrapper's inner definition directly), which is byte-for-byte what
 * the auto-declare route does: no state event, no version bump.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { facetComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';
import {
  snapshotMemoDeps,
  memoDepsStillValid,
} from '../../src/compute-engine/boxed-expression/collection-element-memo';
import { _BoxedValueDefinition } from '../../src/compute-engine/boxed-expression/boxed-value-definition';

/** The scaled lizeqlnn5e state of the item-182 suite: forward-referenced
 * user functions, `R_xz` carrying the free symbol `c` that no reachable
 * scope declares. */
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
  return ce;
}

/** The comprehension whose dependency closure reaches `c` through
 * `P_roj` → `R` → `R_xz`'s lambda body. */
function makeD(ce: ComputeEngine) {
  return ce.parse(
    '\\left[P_{roj}(L[3i+(1..3)]) \\operatorname{for} i = (1..(\\frac{\\mathrm{Length}(L)}{3}))-1\\right]',
    { strict: false }
  );
}

/** The pinned wrapper of the snapshot's `c` dependency, reached the same
 * way the engine reaches it: the occurrence's `_def` binding wrapper. */
function cDepAndWrapper(ce: ComputeEngine, D: ReturnType<typeof makeD>) {
  const deps = snapshotMemoDeps(D);
  expect(deps).toBeDefined();
  const cDep = (deps as unknown as { name: string }[]).find(
    (d) => d.name === 'c'
  ) as unknown as {
    occurrence: { _def: { value: unknown } };
    valueDef: { value: unknown };
    resolved: unknown;
  };
  // Non-vacuity: the storm's shape — a valueless pinned binding whose name
  // chain-resolves to nothing.
  expect(cDep).toBeDefined();
  expect(cDep.valueDef.value).toBeUndefined();
  expect(cDep.resolved).toBeUndefined();
  return { deps: deps!, cDep, wrapper: cDep.occurrence._def };
}

describe('Tycho item 186 — valueless rebind of a lambda-body free', () => {
  test('a valueless→valueless inner-definition swap keeps the facet memo serving', () => {
    const ce = documentState();
    const D = makeD(ce);
    expect(D.count).toBe(100);
    const settled = facetComputeCount();
    expect(D.count).toBe(100); // warm repeat
    expect(facetComputeCount() - settled).toBe(0);

    const { deps, wrapper } = cDepAndWrapper(ce, D);

    // The auto-declare route's swap: a fresh VALUELESS inner definition
    // replaces the pinned one, no state event, no version bump.
    wrapper.value = new _BoxedValueDefinition(ce, 'c', {});

    expect(memoDepsStillValid(D, deps)).toBe(true);
    const before = facetComputeCount();
    expect(D.count).toBe(100);
    expect(facetComputeCount() - before).toBe(0); // memo survived the rebind
  });

  test('a swap to a definition HOLDING a value still invalidates', () => {
    const ce = documentState();
    const D = makeD(ce);
    expect(D.count).toBe(100);

    const { deps, wrapper } = cDepAndWrapper(ce, D);

    const withValue = new _BoxedValueDefinition(ce, 'c', {});
    withValue.value = ce.box(5);
    wrapper.value = withValue;

    // Either side holding a value makes identity load-bearing again.
    expect(memoDepsStillValid(D, deps)).toBe(false);
    const before = facetComputeCount();
    expect(D.count).toBe(100); // same answer (count never read `c`'s value)
    expect(facetComputeCount() - before).toBeGreaterThan(0); // recomputed
  });

  test('a binding for the name becoming REACHABLE still invalidates (case-2 discipline)', () => {
    const ce = documentState();
    const D = makeD(ce);
    expect(D.count).toBe(100);

    const { deps } = cDepAndWrapper(ce, D);
    ce.assign('c', 2); // the chain now resolves `c` → re-resolution flips
    expect(memoDepsStillValid(D, deps)).toBe(false);
  });
});
