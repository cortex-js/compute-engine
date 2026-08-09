# Lazy Collection Evaluation — Depth, Not Size

**Status**: v3.2 (2026-08-09) — **Changes 1 and 2 IMPLEMENTED**; see
"Implementation record" at the end for measured results, the three spec
refinements made during implementation, and the open follow-ups. The
body below is the reviewed spec, kept as ratified.
v3.1 (author's amendment): Change 2 redesigned around a **variadic
`Append`** — `(collection, value+) -> collection` — replacing v3's
one-element-list wrappers; same-head flattening only, dropping the four
cross-head rewrites and with them the tuple-source and erasure guards.
(`value+`, not the sketched `scalar+`: row/point appends are atomic
non-scalars today — verified — and must keep working.) Also since v3:
the `mapSource` self-reference guard (the "Adjacent bug" below) has
**shipped**, with direct, mutual, and nested-view cycles verified
symbolic.
Two dual adversarial review rounds (Claude + Codex), every finding
verified empirically before adoption. Round 1 (v1→v2): "evaluate returns
`this`" was unsound (the operand walk is what resolves symbol/effectful
operands); the bare `Append→Join` splice is a type error for scalars;
the affected-set boundary is the def-level `lazy` flag; the
`maxCollectionSize` cap; async underspecification; family-closure
ambiguity. Round 2 (v2→v3): the accumulator's own `Assign` bumps the
generation, so the memo needs a **constant-result key** to deliver O(n);
the wrapper flatten is wrong for **tuple-typed sources** (verified:
`Append((1,2),3)` has 3 elements, `Join((1,2),[3])` has 2); the closure
was missing the `Join(Append(…),…)` case; `Insert`/`DeleteAt`/
`ReplaceAt`/`ChunkBy` have conditional `evaluate` handlers and are **not
covered** by Change 1; erasure markers (`Nothing`); the
merge-into-literal recipe was dropped for the cost-equivalent, alias-safe
append-a-fresh-operand rule.

**Problem in one line**: accumulating into a collection
(`xs = Append(xs, v)` in a loop) is **quadratic**, because `evaluate()`
on a lazy collection view re-walks its whole operand chain on every call
and memoizes nothing.

**Scope**: two changes, independently landable and composable —
**(1)** memoize the fall-through evaluation of lazy collection views so
re-evaluating an already-evaluated view is O(1); **(2)** flatten
`Append`/`Join` chains at construction so structural depth stays
bounded. Sync evaluation only; async parity is a named follow-up (see
"Async").

**Non-goals**: mutable values, parameter modes (`inout`/`mutable`), a
`mutable` effect label — all dispositioned in `docs/EFFECTS-MODEL.md`
§"Label admission". Copy-on-write / uniqueness tracking is a separate,
later optimization. The Map self-reference stack overflow is adjacent
but **not closed by this plan** (see "Adjacent bug"). The
over-threshold blowup of the four conditional-handler operators is
**out of scope with a named follow-up** (below).

## Affected operator set — corrected twice

v1 claimed "~30 operators, family-wide"; v2 claimed 20 "at one seam".
Both wrong. The boundaries, verified per-definition-block:

- **Def-lazy views** (`lazy: true` on the definition): `Map`, `Filter`,
  `Scan`, `Differences`, `TakeWhile`, `DropWhile`, `FlatMap`,
  `Tabulate`, `Dedup`. `holdMap` (`hold.ts:36`) returns their operands
  unevaluated — no step-4 recursion, **out of scope**.
- **Change 1's set — lazy views with NO def-level `lazy` and NO
  `evaluate` handler** (16): `Range`, `Linspace`, `Join`, `Append`,
  `Take`, `Drop`, `Rest`, `Most`, `Slice`, `Reverse`, `RotateLeft`,
  `RotateRight`, `Zip`, `Iterate`, `Cycle`, `Fill`. These fall through
  to the generic step-4 walk on every `evaluate()` — the quadratic this
  plan fixes.
- **Conditional-handler views** (4): `Insert`, `DeleteAt`, `ReplaceAt`,
  `ChunkBy` **have** `evaluate` handlers gated on
  `MAX_SIZE_EAGER_COLLECTION = 100` (`collection-utils.ts:28`): below
  the threshold they materialize eagerly (cheap); above it the handler
  **declines** and the node falls to the generic unmemoized rebuild,
  where a chained workload blows up much faster than Append's O(n²)
  (review round 2 measured ≈4× per +2 iterations for looped `Insert`
  past ~112 elements — compounding recursive shape/count queries, not
  just the rebuild). Change 1's precondition (no `evaluate` handler)
  **excludes them by construction**. This matters because the planned
  `SetAt`-style indexed-update sugar lowers to exactly these three:
  **an indexed-update loop past 100 elements is NOT fixed by this
  plan.** Follow-up item: either extend the memo to the
  handler-declined fall-through (requires re-arguing result idempotence
  per operator) or fix the compounding queries directly; measure first.

The inventory is regex-derived; the implementation must re-derive it
programmatically (assert `collection.isLazy` ∧ ¬`lazy` ∧ no `evaluate`)
and pin it in a test so a future operator lands in a regime
deliberately.

## Measurements

All numbers `npx tsx` on source, single process, fresh engine per row.
**Relative, not absolute.**

### M1 — operand size is not the driver

`Join(a, b)`, depth 1, milliseconds:

| \|a\| | \|b\| | build | drain | `at(mid)` | `count` |
|---|---|---|---|---|---|
| 1 | 1 | 0.04 | 0.1 | 0.098 | 0.019 |
| 10 000 | 1 | 0.92 | 1.3 | 0.007 | 0.002 |
| 1 | 10 000 | 1.46 | 0.7 | 0.077 | 0.006 |
| 10 000 | 10 000 | 1.53 | 1.5 | 0.006 | 0.002 |
| 100 000 | 100 000 | 16.6 | 9.8 | 0.034 | 0.005 |

A lazy `Join` of two 100 000-element lists builds in 17 ms and answers
`at(mid)` in 0.034 ms. A size-threshold laziness rule has nothing to
bite on. **On "always materialize":** the engine already caps
materialization — `materialize()` (`boxed-function.ts` ~4409) leaves a
finite indexed collection lazy when `count > engine.maxCollectionSize`
(default 10 000, `engine-runtime-state.ts:11`). Always-materialize-at-
construction would either bypass that cap (the OOM risk it exists to
prevent) or respect it (eager below 10 000, lazy above — semantics that
flip on a runtime tunable), and forfeits the sub-ms lazy access above.
Laziness stays the default; both changes preserve it.

### M2 — the quadratic is `evaluate()`

n iterations of `xs = Append(xs, i)`, milliseconds:

| n | build only | + symbol assign/read | **+ evaluate** | both |
|---|---|---|---|---|
| 50 | 4.9 | 2.6 | 37 | 30 |
| 100 | 3.3 | 1.6 | 120 | 178 |
| 200 | 10.7 | 2.3 | 729 | 733 |
| 400 | 38.4 | 4.1 | **5352** | 5306 |

Chain construction is ~38 ms at n=400; the symbol round-trip ~4 ms;
`evaluate()` 5352 ms. (An earlier Epsil-level run of the same loop
measured 5650 ms and an eager-materialization variant 79 ms —
different harness, same regime.)

### M3 — why

- One `evaluate()` on a depth-*d* chain is O(*d*): 1.8 / 3.2 / 4.2 /
  12.6 / 41.9 ms at d = 25 / 50 / 100 / 200 / 400. n calls ⇒ O(n²).
- The result of evaluating a lazy `Append` is another `Append` node
  (the *node* — `toString()` materializes for display via the
  `abstract-boxed-expression.ts` ~264 preview path, which can make this
  look collapsed in probes; check `.operator`, not the printout).
- The result is **not memoized**: a second `evaluate()` on the same
  node costs the same as the first (12.2 ms → 11.0 ms at d=200). The
  memo slots exist — `_value`/`_valueN`
  (`boxed-function.ts:215-222`) — but nothing consults them:
  `evaluate()` calls `_computeValue()()` directly.

### M4 — the mechanism, located

In `BoxedFunction._computeValue` (`boxed-function.ts`): step 3 (~2183)
materializes only when `materialization !== false` — the default is
`false` (`types-kernel-evaluation.ts` ~84), correct, and unchanged by
this plan. Step 3b requires `numericApproximation`. So a Change-1-set
node falls through to step 4, `holdMap(this, (x) => x.evaluate(options))`
(~2202) — the full recursive operand walk — and rebuilds an equivalent
node, every time.

**The walk is load-bearing, not redundant** (v1 got this wrong). It is
what resolves a symbol operand to its value
(`Append([1,2], y).evaluate().at(3)` → `5`; unevaluated `.at(3)` → `y`,
because collection handlers return `expr.op2` raw), and what performs an
effectful operand's effects (`Append(xs, Random())` draws at evaluate
time; `Append(xs, Assign(…))` writes). Any fix must keep the first walk
and eliminate the *repeat* walks.

## Change 1 — memoize the fall-through evaluation of lazy views

**Rule.** For a node in Change 1's set (canonical, `isLazyCollection`,
no `evaluate` handler, def not `lazy`), under default options
(`materialization === false`, `numericApproximation === false`):

1. On `evaluate()`, consult the `_value` memo; on a valid hit (keying,
   below) return the memoized result — O(1).
2. On a miss, run today's step-4 walk unchanged, producing result `R`.
3. **Memoize both directions**: this node ↦ `R`, and — because `R` is a
   freshly rebuilt node whose own memo is empty — prime `R`'s memo with
   `R` itself (`evaluate` is idempotent on this path: `R`'s operands
   are already-evaluated). Without the second write the accumulator
   stays O(n²): iteration *k*'s `op1` is iteration *k−1*'s **result**,
   which was produced, never evaluated, so its miss re-walks the chain.
   **Both writes share one gate** — they happen only when the
   computation settled without consuming a provisional (re-entrant)
   edge; a provisional computation memoizes *neither* direction
   (self-priming a provisional `R` would freeze a wrong value harder
   than today's no-cache behavior). (Equivalent alternative: when the
   evaluated tail is operand-identical to `this.ops`, return `this`
   instead of rebuilding — self-priming becomes automatic. Either is
   acceptable; the invariant to pin in a test is *iteration cost is
   O(1) after the first evaluate*.)

**Keying — the constant-result key is what makes the loop O(n)**
*(round-2 finding, verified)*. `Assign` bumps `ce._generation`
(measured: two assigns, 15→16→18), and the accumulator assigns every
iteration — a memo keyed only on the current generation is invalidated
by the loop's own writes and never hits. The key is therefore dual,
exactly the split `_type` already uses (~1459-1462):

- **Constant + pure node** (`ops.every(isConstant) && isPure`) —
  generation-**independent** entry (`generation = undefined`). The
  evaluated result `R` in the accumulator is a chain over literals:
  constant, pure, and thus immune to the loop's generation bumps.
- **Anything else** (e.g. the live `Append(xs, i)` with a symbol
  operand) — generation-gated, like `_type`: valid only for the
  generation observed at computation. `Append(xs, y)` re-resolves `y`
  after `y := …` — today's semantics, preserved. These nodes are
  evaluated once per loop iteration anyway; their memo is a bonus, not
  the mechanism.

**Purity gate.** Never memoize an impure node (`Append(xs, Random())`
re-draws on every `evaluate()`, exactly as today). The accumulator is
still O(n) in the impure case: each iteration evaluates its *new* node
once, and the *result* stored in the binding is pure (the draw resolved
into it) and memoizable.

**Mechanism warning — borrow `_type`'s staleness *concept*, NOT its
`cachedValue` implementation** *(round-2 finding)*. `_type` runs through
the shared `cachedValue()` helper, which stamps the generation **before**
computing — the exact re-entrancy hazard the `_effects` comment
(~416-436) documents (a re-entrant read returns the previous
generation's value as fresh). A self-referential binding
(`xs := Append(xs, …)`) is precisely the shape that re-enters. Model the
mechanics on `_effectsOf`'s hand-rolled fields: in-flight marker,
provisional answer on re-entry, stamp only after a computation that
consumed no provisional edge.

**Why memoization rather than v1's early return or an operand-selective
walk.** The early return skips the load-bearing first walk (unsound).
The operand-selective walk (skip recursion only into the family-view
operand) is right for the accumulator but wrong for a hand-built deep
chain evaluated once — the skipped subtree's symbols stay unresolved,
the same regression one level down. Memoization keeps the first walk
byte-identical to today and eliminates only the repeats; its entire
semantic surface is *staleness*, governed by generation + constancy.

**Expected effect.** Accumulation O(n): ~38 ms build + ~5 ms drain vs
5352 ms at n=400, ≈125× (Epsil loop measured ~95× — same regime).

**Known residual**: `.N()` / `numericApproximation: true` bypasses the
memo (the rule's precondition) and step 3b only serves `Map`
(`lazyMapNumericApproximation` declines other operators), so an
accumulator driven by `.N()` stays O(n²). Rare pattern; documented so
it is not later mistaken for a regression.

### Open questions — Change 1

- **Q1.1.** Options identity: the memo is consulted under *default*
  options only; verify every non-default combination
  (`materialization` truthy forms, `numericApproximation`) bypasses it
  and reaches its current path unchanged.
- **Q1.2.** Memory: the memo pins the result for the node's lifetime.
  The chain is alive anyway via `op1` references — confirm no doubling
  via both `R` and a rebuilt near-copy.
- **Q1.3.** `isPure`/`isConstant` cost: both are themselves memoized,
  but confirm the accumulator's per-iteration constancy/purity checks
  on the memoized `op1` are O(1), not a second O(d) walk.

## Change 2 — flatten `Append`/`Join` chains at construction

v1's bare splice was a type error (`Join` is
`(collection*) -> collection`; only **tuples** are atomic operands, via
`isAtomicJoinOperand`; a scalar operand is `incompatible-type`).
`Append(c, v)` appends *any* `v` atomically. v3 wrapped each appended
value in a one-element list literal for `Join` to splice; **v3.1
supersedes that with a variadic `Append`** (author's amendment): making
`Append` itself variadic keeps every appended value in a position with
`Append`'s own atomic semantics — no wrapper nodes, and two of v3's
guards dissolve because the head never changes.

**Signature.** `Append` becomes `(collection, value+) -> collection`.
The existing binary MathJSON form is the variadic form with one value —
fully backward compatible. **`value+`, not `scalar+`** (the amendment
sketched `scalar+`): today's `Append` accepts *any* value atomically,
and the non-scalar cases are load-bearing — appending a row to a matrix
(`Append([[1,2],[3,4]], [5,6])` → 3 rows, verified) and a point to a
point list (`Append([(1,2)], (3,4))`, verified) — and neither a list
nor a tuple matches `scalar` (verified against the type lattice).
`scalar+` would break both. If rejecting collection-valued elements is
ever wanted (an explicitness argument), that is a separate breaking
ruling with its own migration, not part of this plan. The type handler
must be upgraded alongside: today it is `joinResultType([ops[0]])` —
the appended value's type is **already ignored** (pre-existing
imprecision); the variadic version folds the element types of *all*
trailing operands into the result's element type.

**Rule.** At canonicalization (all routes: `ce.box`, `ce.parse`,
`ce.function`), flatten **same-head** nesting only:

| Outer(inner) | Rewrite |
|---|---|
| `Append(Append(c, …vs), …ws)` | `Append(c, …vs, …ws)` |
| `Join(Join(…inner), …outer)` | `Join(…inner, …outer)` |

Both are exact by construction: the head is unchanged, so every operand
keeps the same position semantics it had — `Append`'s trailing values
stay atomic values of a variadic `Append`, and an inner `Join` is a
collection operand being spliced (its tuple operands stay atomic
operands after the splice). **The four cross-head rewrites of v3 are
dropped** — they were what created the tuple-source hazard
(`Append` *enumerates* a tuple source; `Join` holds a tuple operand
*atomic*: `Append((1,2), 3)` has 3 elements, `Join((1,2), [3])` has 2 —
round-2 CRITICAL, verified) and the erasure hazard (constructing
`List(Nothing)` erases what `Append` validation would flag). With
same-head flattening neither situation arises: no head change, no
wrapper construction. A mixed `Append`/`Join` chain flattens within
each same-head run, so depth is bounded by the **alternation count**,
not the operation count — an accumulator loop uses one operator (depth
1), and Change 1 owns the evaluate cost of the rare alternating chain
anyway.

**Remaining guard.** Validation ordering: the flatten runs in a
canonical handler, *before* ordinary argument validation. It must not
outrun it — splice only operands that pass `Append`'s per-value
validation (`Nothing`, `Sequence`, spread markers, invalid operands
decline the rewrite), preserving today's error results byte-for-byte on
all three routes.

**Cost and composition** *(round-2 finding: state the combined
complexity)*. Each flatten step rebuilds the operand array (`_ops` is
immutable): O(width) pointer copies per step, **O(n²) total** — but
pointer-array copies, not evaluation: at n=1600 that is ~1.3M pointer
moves, milliseconds. Change 1 remains the asymptotic fix for
*evaluation*; Change 2 bounds *structural* depth for every tree walker
(serialization, hashing, `isSame`, `count`, type computation, stack
limits — a depth-10⁴ chain overflows structural recursion; width-10⁴
does not). **Acceptance budget**: with both changes, the M2 loop at
n ∈ {100, 400, 1600} must scale sub-quadratically in wall time and stay
within ~2× of the Change-1-only build+drain figure at n=400; if the
operand-array copying breaks that budget at n=1600, ship Change 1 alone
and re-scope Change 2 to a chunked representation.

### Open questions — Change 2

- **Q2.1.** Result-type parity: the upgraded variadic type handler must
  agree with (or strictly improve on) the nested chain's element-type
  inference; note the binary handler's existing blind spot above.
- **Q2.2.** Display: `Append(c, v₁, v₂, …)` serializes naturally (it
  *is* an Append), so the v3 display concern shrinks — but measure the
  snapshot blast radius anyway (CLAUDE.md gate): any test pinning the
  nested form's serialization will churn.
- **Q2.3.** Non-finite sources (`Iterate`, `Cycle` as `c`): flattening
  must not force or misreport `count`; confirm handler parity with the
  nested form.
- **Q2.4.** Collection-handler generalization: `count` becomes
  `op1.count + (nops − 1)`, `at`/`iterator`/`contains` walk the
  trailing operands; verify negative indexing and the lazy `isFinite`
  logic against the binary handlers' behavior.

## Async — follow-up CLOSED (2026-08-09)

*(Original scoping, kept for the record: sync-only; `_computeValueAsync`
had no materialization step at all and its own `holdMapAsync` walk.)*

**Shipped**: `evaluateAsync` participates in the SAME memo — shared
entries in both directions (a settled sync entry answers an async call
and vice versa), an in-flight-promise slot (`_lazyValuePending`,
deliberately separate from the sync re-entrancy marker) so concurrent
async evaluations of one node share a single walk, all gates carried
over (settled-only across both provisional channels sampled across the
awaits, purity, epoch, scope identity, dual key, elementMemo/non-finite
exclusion), and one async-only rule: an aborted or rejected walk
memoizes neither direction and clears the slot. `_computeValueAsync`
now mirrors sync step 3 for all four `materialization` forms (shared
`materialize()`; a per-element `materializeAsync` was judged out of
minimal scope — no operator with collection handlers defines
`evaluateAsync` today, verified programmatically and flagged in-code
for whoever adds one). Sync-arrives-during-async: the sync call ignores
the pending promise and computes; same keys and stamps, last write to
settle wins (values equal modulo node identity). Async re-entry cannot
deadlock: symbol `evaluateAsync` is `Promise.resolve(this.evaluate())`,
so re-entrant reads land on the sync path's marker. Verified this
session: async accumulator n=200 in 30 ms with per-iteration identity
stability; cross-path and concurrent-async object identity.

## Adjacent bug — fixed separately (shipped 2026-08-09)

**Status: the `mapSource` guard has shipped** (`collections.ts`
`mapSource`, + regression tests in `bug-fixes.test.ts`); direct, mutual
(`as := Map(bs,…); bs := Map(as,…)`), and nested-view
(`cs := Map(Reverse(cs),…)`) cycles all verified symbolic — the mutual
case is caught by the in-window `_dereference` cycle protocol even
though the `isSelfReferential` flag is direct-only. Original analysis,
kept for the record:

`xs := [1,2,3]; xs := Map(xs, v ↦ v+1); Sum(xs).evaluate()` overflowed
the stack (verified: raw `RangeError` at the engine boundary; Epsil
masks it as an error value, a direct host caller crashes). The cycle is
`mapSource` (`collections.ts` ~435) → symbol `.evaluate()` →
`_dereference` → `isFiniteCollection` → `mapSource` again — the
`CycleQuery.Dereference` guard releases before the caller's shape query
re-enters, so each loop turn is a completed dereference nested inside
the previous shape frame. **Neither change here touches that path**:
Change 1 memoizes `BoxedFunction.evaluate` results (the cycle never
completes an evaluate to memoize), and `Map` is def-lazy, outside both
sets. Fix tracked separately; recommended shape: guard in `mapSource` —
return the source unresolved when it is a symbol whose definition
`isSelfReferential`, landing `Map` on the documented degrade-to-symbolic
behavior `Filter` already has. Change 1's settled-only memo gate exists
partly because self-referential bindings of Change-1-set views are the
same hazard class.

## Risk and verification

- **Snapshot blast radius**: both changes alter evaluated forms of
  collection expressions; run the full suite, count changed snapshots,
  surface for review; never `-u` an `@fixme`.
- **Route parity**: box / parse / `ce.function` for both changes.
- **Change 1 probes**: symbol operand resolves on first evaluate and
  re-resolves after reassignment (generation key); **the real loop
  shape** — `RHS.evaluate()` then `Assign`, per iteration — is O(1) per
  iteration after the first (operation-count or time-ratio test; this
  is the probe that catches the generation-bump failure, which
  two evaluates of one untouched node does not); `Random()` operand
  re-draws every evaluate (purity gate); self-referential binding
  memoizes neither direction (settled-only gate); explicit
  `materialization` forms and `.N()` unchanged.
- **Change 2 probes**: atomicity triple (scalar / list / tuple appended
  value) equals the nested form element-for-element — including
  row-to-matrix and point-to-pointlist appends, and a **tuple-typed
  source** (`Append(Append((1,2), 3), 4)` must still enumerate to
  4 elements — same-head flattening keeps this exact, pin it);
  `Nothing`/`Sequence`/invalid appended values preserve today's
  validation results on all three routes; a same-head `Append` chain
  stays depth 1 and a mixed chain's depth equals its alternation count;
  variadic back-compat (binary `["Append", c, v]` MathJSON unchanged);
  non-finite sources (Q2.3); handler generalization (Q2.4).
- **Benchmarks**: per `benchmarks/README.md` (read first), pin
  accumulation n ∈ {100, 400, 1600} reporting **build and evaluate
  separately** (the acceptance budget above), and depth-1 `Join` at
  |a| = |b| = 100 000 for `at`/`count`/drain (the M1 wins must not
  regress).

## Sequencing

1. Programmatic three-regime inventory + pinning test.
2. Change 1 (memoization) — semantic surface is staleness only; settle
   Q1.1–Q1.3 with probes during implementation.
3. Change 2 — the variadic `Append` signature + handler generalization
   first (independently useful), then the same-head flatten; settle
   Q2.1–Q2.4, measure snapshot blast radius, check the acceptance
   budget, then land (or ship Change 1 alone per the budget clause).
4. Measure both; only then decide whether anything further
   (width-indexed `at`, copy-on-write, chunked representation) is worth
   pursuing.
5. Separately tracked follow-ups — **all three now shipped
   (2026-08-09)**: the `mapSource` self-reference guard (see "Adjacent
   bug"); the over-threshold `Insert`/`DeleteAt`/`ReplaceAt`/`ChunkBy`
   blowup (see "Follow-up CLOSED" — the `SetAt`-sugar path is
   unblocked); async parity (see "Async — follow-up CLOSED").

## Implementation record (2026-08-09, v3.2)

Both changes landed the same day, implemented in parallel (Change 1 in
`boxed-expression/boxed-function.ts` + `cycle-guard.ts`; Change 2 in
`library/collections.ts` + both compile targets), each verified by a
negative control (change disabled → its tests fail: 22/33 and 25/47).

### Measured results

M2 accumulator (`xs = Append(xs, i)`, evaluate+Assign per iteration,
`npx tsx` on source):

| n | before | after (both changes) |
|---|---|---|
| 100 | 150.7 ms | 13.4 ms |
| 400 | 5352 ms | **42.4 ms** (≈126×) |
| 1600 | — | 387.8 ms |

Scaling 100→400 = 3.2×, 400→1600 = 9.1× (quadratic signature ≈16×) —
**acceptance budget met** (sub-quadratic; combined n=400 is 1.12× the
Change-1-only 37.7 ms). The chain canonicalizes to one node
(`nops = 1601` at n=1600 — depth 1). M1 guard: warmed lazy-`Join`
`at(mid)` at |a|=|b|=100 000 is 0.008–0.011 ms — no regression.
Full-suite snapshot blast radius: **zero changed snapshots** (see suite
counts in the session record; nothing `-u`'d).

### Spec refinements made during implementation (all reviewed-in)

1. **Priming is restricted to the generation-independent (constant+pure)
   key.** Priming a generation-keyed `R` was observably wrong: in
   `xs := Append(xs, 1)` the Assign's RHS produces an `R` that the
   binding write then makes self-referential; priming froze `R ↦ R` and
   changed `node.evaluate()` output vs baseline. The accumulator's `R`
   is always constant+pure, so nothing of the O(n) result is lost.
2. **The settled-gate consumes a second provisional channel**: the
   symbol-binding cycle guard's fail-closed answers are as provisional
   as the memo's own in-flight marker, and route-dependent
   (`Append(xs,1)` self-referential answers differ evaluated directly
   vs through the symbol). `cycle-guard.ts` now exposes a monotone
   `cycleDetectionCount()`; a computation that observed a bump memoizes
   neither direction. This is the spec's "settled without consuming a
   provisional edge", made concrete.
3. **Change 2 required compile-target fixes** the plan missed: both the
   JS and Python `Append` lowerings read only `args[1]` and would have
   silently dropped values 2..k of a flattened variadic node. Fixed in
   both targets (`[...(c), v₁, v₂]` / `[*c, v₁, v₂]`).

### Post-review hardening (same day, dual staged-diff review)

A dual adversarial review of the staged implementation found and fixed:

4. **The "generation-independent" key gained a `_semanticEpoch` axis.**
   The constant+pure entry as first implemented was invalidated by
   nothing — but `ce.precision`/`ce.angularUnit` run `_reset()`
   precisely because stored numeric content goes stale (verified: a
   memoized `N(1/3)` kept 20 digits after `precision = 60`). Both entry
   kinds and the priming write now stamp and check `ce._semanticEpoch`
   (bumped by `_reset()`, assume/forget, redefinition — never by value
   writes, so the accumulator's O(n) is untouched).
5. **The generation-gated key gained an ambient-scope identity axis.**
   Re-pushing an already-populated scope bumps no counter, so a
   top-level-memoized `Append(xs, 9)` served the outer `xs` inside the
   re-entered scope (verified, order-dependent results). The gated entry
   now also requires the fill-time `lexicalScope` object identity; no
   global per-push generation bump (which would cold-start every
   generation cache — scoped operators push per evaluation).
6. **Retention: infinite `elementMemo` views are not memoized**
   (`Iterate` — the memo would pin its ever-growing element cache for
   the source node's lifetime).
7. Smaller: 1-ary non-strict `Append` now reports `isEmpty` from its
   source (was a `count === 0`/`isEmpty === false` contradiction, both
   reviewers); compile targets emit the identity for it instead of
   falling back; `appendResultType` no longer types tuple SOURCES
   atomically (`Append((1,2), 3)` now `list<finite_integer>` — the
   "source-side sharpening" follow-up below, done); the wall-clock
   ratio test was dropped as CI-flaky (the deterministic identity test
   pins the mechanism; perf ownership → `benchmarks/`).

### Inventory as pinned (supersedes the doc's regex-derived counts)

`test/compute-engine/lazy-collection-regimes.test.ts` derives regimes
from the runtime definitions (47 operators with collection handlers):

- **Change-1 set: 19** — the 16 listed plus `Permutations` and
  `Combinations` (`library/combinatorics.ts`, genuinely memoized) and
  `Tuple` (its `isLazy` answers `false` for every instance — membership
  inert, pinned as such).
- **def-lazy: 13** — the 9 listed plus `Comprehension`, `When`, `List`,
  `Set` (`Interval` has the `lazy` flag but no `isLazy` handler).
- **conditional-handler: 7** — the 4 listed plus `Partition`, `Repeat`,
  `SlidingWindow` (same `MAX_SIZE_EAGER_COLLECTION` shape, same
  exclusion by construction).

### Q1.3 answered; the residual is elsewhere

Per-iteration cost still grows slowly (58 → 225 µs from n=100 to
n=1600). Measured: the memo key computation is NOT the driver (constant
key: 40.3 → 37.9 ms at n=400), and removing `.evaluate()` makes the
loop linear — the residual O(depth-ish) cost is in `ce.function`
canonicalization (`getReferences`/`getSymbols`/binder rewriting) and
`ce.assign`'s symbol scan. Follow-up territory (assign/canonicalization),
not a defect of either change.

### Behavior deltas — RATIFIED (user ruling, 2026-08-09; all pinned in tests)

1. **`Append(c, Sequence(v₁, v₂))` splices** to a valid variadic
   `Append` (was an `unexpected-argument` error). Ruled correct:
   `Sequence` is the engine-wide splice marker, flattened into every
   variadic operator's argument list before any handler runs — the old
   error was an artifact of the binary arity, not a design choice, and
   `Sequence` cannot be an element, so no atomic-append reading is lost
   (use `List`/`Tuple` for that).
2. **Non-strict `Append(c)` is the identity** (was padded with an
   `Error` operand — an invalid node that still enumerated 3 elements,
   one an error object). Ruled correct: "append nothing" = identity is
   the natural zero-values reading, and lenient mode's contract is to
   make the best of what was given. Strict mode is unchanged
   (`Error("missing")`, invalid — verified).
3. **Repeated `evaluate()` of a memoized view returns the same object**,
   not a value-identical fresh copy (all memoized views; visible for
   below-threshold `Insert` because the memo is consulted before the
   conditional handler). Ruled correct: expressions are immutable and
   node-sharing is the engine's normal mode; `.isSame`/`.isEqual`/
   serialization are indistinguishable, only host-side `===` can tell,
   and freshness is directly at odds with the memo the perf results
   rest on.

### Follow-up CLOSED: the conditional-handler over-threshold blowup

The follow-up named in "Affected operator set" and "Sequencing" item 5 —
`Insert`/`DeleteAt`/`ReplaceAt`/`ChunkBy` (+ `Partition`/`Repeat`/
`SlidingWindow`) past `MAX_SIZE_EAGER_COLLECTION`, which blocked
`SetAt`-sugar loops — is **fixed**, on both axes the plan offered
("either extend the memo … or fix the compounding queries directly").
Both were needed; each was verified by a negative control.

1. **The compounding queries** were a plain double recursion, not a
   subtle one: `insertPosition`/`targetPosition` (`library/collections.ts`)
   read `op1.count` for their index-range guard, and every
   `count`/`isEmpty`/`isFinite` facet then read it AGAIN — cost(d) =
   2·cost(d−1) on a chained view, i.e. **2^depth**. Threading the
   already-computed length through new `insertPositionOf`/
   `targetPositionOf` variants makes each level pay one source walk;
   the facets derive finiteness from the same `n` rather than asking
   `op1.isFiniteCollection` (a second recursive walk that would restore
   the doubling). Measured on a depth-16 chain over a 110-element base:
   `.count` 7.8 ms → 0.01 ms, `isFiniteCollection` 7.9 ms → 0.01 ms. At
   depth 30 a shape query now costs 30–31 source `count` reads (pinned
   with a read budget in the test, because the doubling is SYNCHRONOUS —
   a jest timeout can never interrupt it).
2. **The memo's `evaluate`-handler exclusion is removed**
   (`_isMemoizableLazyCollection`). Those handlers are deterministic in
   their operands, so under an unchanged (generation, epoch, scope) key a
   re-run declines — or materializes — identically; consulting the memo
   BEFORE the handler runs is therefore sound too, and keeps the diff to
   one deleted condition. All other gates are unchanged (settled-only,
   purity, epoch, scope identity, constant+pure vs generation-keyed dual
   key, elementMemo/non-finite exclusion).

Accumulator (`xs := Insert(xs, 1, i)`, evaluate+`Assign` per iteration,
`npx tsx` on source): 40 iterations over a 90-element base took
**213 851 ms** before (≈2× per iteration past 100 elements; the plan's
round-2 measurement of ≈4× per +2 iterations, confirmed); after, 140
iterations to a 230-element view take **255 ms** (418 ms with axis 1
only — axis 2 is a further 1.6×). The regime inventory in
`test/compute-engine/lazy-collection-regimes.test.ts` keeps all three
regimes; conditional-handler is still distinct (its handler decides
between materializing and falling through), it is simply no longer
excluded from the memo.

Not addressed, deliberately: `evaluate()` on an unevaluated depth-`d`
chain is still O(d²) (each level runs its own O(d) shape queries) — the
memo collapses the REPEAT cost to O(1), which is what the accumulator
needs; a one-shot deep chain is not a measured workload.

### New follow-ups from implementation

- `Append`'s **source-side** type inference reuses
  `isAtomicJoinOperand`, but an `Append` source is never atomic — fixing
  it would sharpen `Append(tuple, …)` to `list<element>` instead of a
  union. Small, worth a ruling.
- `Join` flatten is position-0 only (per the spec table);
  `Join(a, Join(b, c))` stays nested. Splicing at any position would
  also be exact — extend if a real workload produces it.
