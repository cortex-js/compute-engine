# `broadcastable<T>` as a Parameter Declaration — Elementwise Contract (Option A)

**Status: RATIFIED 2026-08-08 (user decision, in-session; responds to Tycho
item 157). Implementation in progress.**

## The ruling

A parameter **declared** `broadcastable<T>` is an **elementwise contract**:

1. **Broadcast-wins.** An indexed-collection argument is MAPPED — the lambda
   broadcast fires — even when the element type `T` would also admit the
   collection whole (`T = value`/`unknown`). This resolves the ambiguity
   Tycho's item 157(3ii) asks to have on record: a list matches both the
   "one value, passed whole" arm and the "values, mapped" arm of
   `broadcastable<T>`; the collection arm wins.
2. **One rank down.** The map descends exactly one level: each element binds
   to the parameter WHOLE, even when the element is itself a collection.
   `broadcastable<value>` over `[[1,2],[3,4,5]]` maps twice, binding `[1,2]`
   then `[3,4,5]` — it does NOT recurse to leaves. The declaration arrests
   the descent; this deliberately differs from the unannotated default,
   which re-fires per element and descends to scalars.
3. **`T` checks per element.** After the one rank of descent an element must
   satisfy `T`: `broadcastable<number>` over `[[1,2],3]` produces a loud
   per-element type error for `[1,2]`, never silent further descent.
4. **A scalar argument binds directly** — no list wrapper (`f(5)` → `R`, not
   `list<R>`). An empty collection maps to `[]`; tuples stay atomic; the
   eager/lazy threshold, the strict length-mismatch policy for multiple
   mapped slots (scalars lift, mismatched collections →
   `incompatible-dimensions`), and the `ErrorBroadcast` element context all
   apply — this is the SAME arm the inferred default uses, gated by the
   declaration instead of by absence of evidence.
5. **Typing mirrors the inferred path** (fixes Tycho item 157(1)): definite
   collection argument → `list<R>`; possibly-collection argument →
   `broadcastable<R>`; scalar → `R`. The declared path must never type more
   weakly than the inferred path.

**What this supersedes.** The original lift design (2026-07-16,
`project-broadcastable-lift`) made `isScalarType(broadcastable) = false` in
`paramsAreScalar` — "a broadcastable param takes collections whole, must not
lambda-broadcast" — because `broadcastable<T>` was then the type OF
application results, not a parameter vocabulary. Item 157 repurposes it as
the declaration hosts emit ahead of the broadcast-default flip, and binding
whole makes elementwise behavior an accident of the body (bodies whose heads
broadcast look elementwise; `x ↦ (x, x)` does not). The per-parameter
eligibility deferral ("option (b)", 2026-08-06) is superseded ONLY for
explicitly-declared `broadcastable<T>` slots: the declaration supplies the
rank notion that deferral said was missing. The all-or-nothing
`paramsAreScalar` veto is UNCHANGED for inference-driven gating.

**Blast radius**: no built-in declares a `broadcastable<T>` parameter (all
library occurrences are comments — audited 2026-08-08); the only known
external user is Tycho's flag-gated prototype, which requests exactly this
meaning. Expected snapshot churn: zero.

## Implementation notes

### The recursion-arrest trap (THE subtle bit)

Making the arm fire is not enough. If the per-element evaluation re-enters
the ordinary application pipeline, each `f([1,2])` re-fires the arm
(`broadcastable<value>` admits `[1,2]`, which is again a collection) and the
map recurses to the leaves — reproducing the unannotated default instead of
rule 2. The per-element application for a declared-broadcastable slot must
BIND the element (direct `makeLambda` apply, or an equivalent bind-whole
route), bypassing the broadcast gate. Phase 0 of the implementation must
establish how arms 2b/4b evaluate elements today (the unannotated default's
leaf-descent suggests pipeline re-entry) and pick the arrest mechanism
accordingly. The pair-body witness is the test: `m(x) = (x, x)` declared
`(broadcastable<value>)`:

- `m([1,2])` → `[(1,1), (2,2)]` (was `([1,2],[1,2])` — bound whole)
- `m([[1,2],[3,4,5]])` → `[([1,2],[1,2]), ([3,4,5],[3,4,5])]` (one rank)

### Sites

- **Arm gating**: the lambda-broadcast arms (2b/4b sync, 2b/3b async,
  `boxed-function.ts`) currently gate on `_isLambda && paramsAreScalar(def)`.
  A declared-broadcastable slot needs per-slot gating: broadcastable slots
  map, scalar slots lift, collection/tuple slots bind whole. Do NOT change
  `paramsAreScalar` itself for the inferred route.
- **Typing**: `getFunctionResultType`, both the operator-def lambda arm and
  the `valueDefinition` arm (the phase-E application-site precedent) — the
  declared-broadcastable slot takes the same lift the inferred path computes.
  This is Tycho's defect-1 minimal pair:
  `ce.declare('f','(broadcastable<number>) -> unknown')`, `L: list<number>`
  → `f(L)` must type `list<unknown>` (today: bare `unknown`).
- **Validation**: `validateArguments` already admits collections at
  broadcastable slots; confirm the per-element `T` check story (deep checks
  may stay evaluation-time; the declared path must not bake `Error` nodes
  for shapes evaluation handles — the lift's original lesson).
- **Compile**: first pass may fail closed (D6 + interpreter fallback) for
  declared-broadcastable slots on the JS target if the `_SYS.bcastFn`
  admission does not already cover them; note the gap explicitly if so.
  Never emit silently-wrong scalar code.

### Interactions to respect

- Strict length policy: two broadcastable slots fed different-length
  collections → `incompatible-dimensions` (lifted regime,
  `docs/BROADCAST-MODEL.md`); broadcast operands evaluated ONCE.
- Consuming bodies cannot be assigned to broadcastable-declared slots
  (assignment enforcement throws `declaredTypeError` — correct, pin it).
- `(broadcastable<value>)` rejects function-typed arguments (fixed on main,
  pre-dates this work — pin alongside).
- The checker/serializer treat `broadcastable` as opaque (never collapse to
  `T`) — unchanged.

## Test plan (both routes: box + Epsil `Typed` params where expressible)

1. Tycho 157(1) minimal pairs VERBATIM (both `(number)` and
   `(broadcastable<number>)` declarations type `list<unknown>` on `f(L)`).
2. Pair-body witness + one-rank nesting (above).
3. `broadcastable<number>` over `[[1,2],3]` → per-element error, loud.
4. Scalar arg → no wrapper; empty list → `[]`; tuple arg → atomic.
5. Mixed slots: `(a: broadcastable<number>, b: number)` — collection+scalar
   zips/lifts; two broadcastable slots with mismatched lengths →
   `incompatible-dimensions`.
6. If-body (non-arithmetic control flow) maps under the declaration.
7. ErrorBroadcast context appears for a failing element.
8. The inferred-default behavior is UNCHANGED (unannotated params still
   leaf-descend; the arm's existing pins must not move).
9. Assignment enforcement: consuming body vs broadcastable slot still throws.

## Open rulings (recorded 2026-08-08, review round)

1. **An OVERLOAD SET keeps the pre-declaration evaluation and typing.**
   `broadcastableParamSlots` answers only for a plain signature; a
   multi-clause user function has an INTERSECTION type, and which arm a call
   binds is a per-call question the slot plan does not model. So for
   `function m(x: broadcastable<value>) { (x, x) }` +
   `function m(s: string) { s }`, `m([1,2])` still binds the list WHOLE
   (`([1,2],[1,2])`) instead of mapping, and types
   `tuple<broadcastable<value>, broadcastable<value>>`. Type and value AGREE,
   which is what makes the gap tolerable. Both halves must move together —
   resolving the plan from the selected arm for typing alone would make the
   static type disagree with the value. Pinned as a known gap in
   `test/compute-engine/broadcastable-param-declaration.test.ts` ("overload
   sets (finding 3)"). The COMPILE gate is NOT deferred: it answers `true`
   when ANY arm declares a broadcastable slot, so no silently-wrong code is
   emitted for an overload set.

2. **A lazified element carries no `ErrorBroadcast` breadcrumb.** The lazy
   route now performs the per-element `T` check (the mapping function's
   parameter is declared the slot's element type, so a violation is a loud
   `incompatible-type` at element access — the eager and lazy routes no longer
   disagree about whether an element is rejected). What the lazy route still
   does not do is ANNOTATE the failure with the element-wise context
   (`annotateBroadcastErrors`), because there is no eager loop to annotate
   from. That is a pre-existing property of every lazified broadcast,
   including the inferred route, not something the declaration introduced.

## Sequencing (item 157(4) agreed)

Defect-1 fix (this work) → item 151 harvest → the default flip itself. The
flip's scope (engine-wide vs per-host policy) is still open on the CE side —
Epsil/math-notation users benefit from the vectorization default; the flip
should be framed as host policy until ruled otherwise.
