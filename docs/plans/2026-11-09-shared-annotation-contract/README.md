# Shared compiler annotation contract and browser execution evidence

Review draft and bounded experiments, November 9, 2026. The next useful JS
compiler step is a small integration that exercises **both real and complex
lanes**, backed by one prepared-expression and annotation contract. The browser
experiment independently confirms that current CE can execute the adapted
Buddhabrot reduction through its own worker pool. No production changes are
included.

## Proposed compiler contract

The [contract draft](annotation-contract.md) recommends:

- One compile-local artifact owns the prepared root, resolved function bodies,
  lexical environment and target policy. Published annotations are read-only.
- Facts belong to that artifact, scope and expression. Printed names and equal
  syntax do not establish binding identity or permission to reuse a value.
- Structural rewrites require reannotation. Missing facts fail closed; emission
  must not quietly fall back to an old type reader.
- Result lanes and operand conversions are explicit. An operand's real type
  does not settle its operation's result lane.
- Profile admission, worker eligibility and the actual execution route are
  distinct. An embedded capture remains the snapshot chosen at compilation;
  later engine assignments do not revoke already generated code.

Keep the current scoped expression representation. CPS or SSA is not a
prerequisite for this contract. The next implementation slice is Add, Negate,
Sqrt and If with real and explicitly complex cases, existing mode rules and
lazy conversions. It should prove that annotations drive different emission
choices before expanding to mutable locals and loops. The draft contains an
acceptance matrix and alternatives for review.

## New Tycho prelude fixtures

The refreshed catalogue has nine prelude showcases. The three additions are
traffic-jam, heat-spread and Othello; the previous six authored preludes are
unchanged at the pinned revision. Their 14 focused existing regression tests
passed.

Traffic supplies a simultaneous state-update fixture; heat diffusion supplies
separate input/output arrays and boundary conditions; Othello supplies hidden
loops, early exits and variable-length numeric lists. These are later-stage
binding, state and collection fixtures. Their passing tests do not establish
profile admission or safe parallel execution. See the
[inventory and fixture recommendations](prelude-refresh.md).

## Browser result

Current CE at `916aff07c` used `createKernelPool()` and `runAsync()` in a dedicated
Chromium coordinator with two nested workers. At 100 and 25,000 samples, all
90,001 histogram entries and the cursor matched the original serial algorithm,
the adapted serial algorithm and an independent reference. The probe also
checked no-pool and below-threshold routing, abort after dispatch, and a correct
replacement job. It records termination requests, not observed worker exits.

The adaptation explicitly marks the outer loop parallel and changes six
histogram updates into recognized additive reductions. The current compile must
omit `iterationBudget` to admit the pool route. This is an algorithm/runtime
integration choice, not something a numeric profile supplies automatically.

A separate control ran the exact Tycho prelude-worker implementation against
installed CE 0.184.0 and checked its numerical output. It used synchronous
compilation. The experiment has not integrated a pool with the real document
manager, prelude deadline service or page navigation. No browser speedup is
claimed. See the [browser report](browser-report.md) and its retained evidence.

## Recommended implementation order

1. Implement the internal varying-lane annotation slice against the reviewed
   ownership contract, preserving the traditional JS target.
2. Add bound-function and same-shape local-state fixtures, using the new preludes
   before broadening the profile vocabulary or doing another whole-corpus audit.
3. Separately design Tycho's async prelude execution and pool lifecycle around
   current CE APIs, including its iteration-budget policy. Test supersession,
   deadlines and child-worker cleanup through the actual product service.

These recommendations add no ROADMAP entries. The delivered source files are
replayable research instruments; no public compiler target or API was added.

## Replay and evidence

Use private worktrees at CE `916aff07c13e34482688631008c0c7a0275e45af` and Tycho
`0e6482e1f08f3925852cae9fc157da9a9e274463`, with their required dependencies and
Tycho's installed CE 0.184.0. Copy the four `instruments/profile-browser-*` files
into Tycho's `scripts/`. Their explicit source paths expect `/tmp/wt-js-contract`
and `/tmp/wt-tycho-browser-profile`; use those paths or adjust them consistently.
The runner bundles isolated source entries and starts an ephemeral loopback
server. It needs local server and Chromium launch permissions and the shared
machine lock. It does not need a whole-app build or dependency replacement.

The browser report gives the exact bounded command. JSON outputs and build
metafiles are compressed under `evidence/`; the original/adapted Epsil and diff
are under `instruments/`. Inventory status records the exact focused test
command and test-source hashes. Bundle hashes and the final manifest preserve
provenance. This bundle does not archive generated browser bundles.

Independent reviews are complete; five evidence checks were strengthened and
the browser rerun passed. See [review status](evidence/review-status.json) and
[validation record](evidence/run-status.md).
