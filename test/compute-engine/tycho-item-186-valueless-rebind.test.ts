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
 * Since the boxing declares no copy of a free name of a function body, the
 * `c` of `R_xz` is a free name with no definition: there is no inner
 * definition to swap, and the test of the swap is gone. The test below keeps
 * the rule that a binding for the name becoming reachable invalidates.
 */
import { ComputeEngine } from '../../src/compute-engine';
import {
  snapshotMemoDeps,
  memoDepsStillValid,
} from '../../src/compute-engine/boxed-expression/collection-element-memo';

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

/** The snapshot of the dependencies of `D`, with its `c` dependency. */
function cDep(D: ReturnType<typeof makeD>) {
  const deps = snapshotMemoDeps(D);
  expect(deps).toBeDefined();
  const dep = (deps as unknown as { name: string }[]).find(
    (d) => d.name === 'c'
  ) as unknown as { valueDef: unknown; resolved: unknown } | undefined;
  // Non-vacuity: `c` is a free name of the body of `R_xz` with no
  // definition, which no chain resolves.
  expect(dep).toBeDefined();
  expect(dep!.valueDef).toBeUndefined();
  expect(dep!.resolved).toBeUndefined();
  return deps!;
}

describe('Tycho item 186 — valueless rebind of a lambda-body free', () => {
  test('a binding for the name becoming REACHABLE still invalidates (case-2 discipline)', () => {
    const ce = documentState();
    const D = makeD(ce);
    expect(D.count).toBe(100);

    const deps = cDep(D);
    expect(memoDepsStillValid(D, deps)).toBe(true);
    ce.assign('c', 2); // the chain now resolves `c` → re-resolution flips
    expect(memoDepsStillValid(D, deps)).toBe(false);
  });
});
