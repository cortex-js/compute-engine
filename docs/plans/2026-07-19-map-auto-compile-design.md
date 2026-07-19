# Auto-compiling lazy-`Map` element lambdas on numeric drains — Design

**Date**: 2026-07-19 (v2 — revised against the dual spec review, findings in
[`docs/scratch/MAP_AUTO_COMPILE_SPEC_REVIEW.md`](../scratch/MAP_AUTO_COMPILE_SPEC_REVIEW.md);
supersedes the same-day v1)
**ROADMAP**: "Auto-compile lazy-`Map` element lambdas on numeric drains
(ratified 2026-07-19, from the Tycho item-42 addendum)" — collections backlog.
**Status**: **RATIFIED 2026-07-19** (both product decisions resolved — see
§ Ratification). Normative; ready for implementation.

## Problem

Draining a lazy `Map` whose element lambda applies an interpreted user
function costs the full symbolic-evaluation pipeline per element — ~15
ms/element on the filed repro (a 40-term `Sum` of a user function over a
2469-element broadcast). The profile is diffuse (canonical ordering, type
checks, exact-rational machinery) — architectural, no single defect. The
same lambda through the explicit compile route measures **6.1 µs/element**
(~2500× on the full sweep) with digit parity at machine precision.
Consumers currently bound interpreted drains with `ce.withTimeLimit()`
(0.86.0) or migrate hot paths to the explicit compile route by hand.

## Architecture summary

One sentence: when a lazy `Map` is drained numerically at machine
precision, an eligibility-gated compile attempt produces a per-logical-
instance cached compiled element function, validated per invocation
against the same two-axis keys that govern the comprehension cache, with
silent per-element interpreter fallback.

The v1 spec assumed two pieces of infrastructure that do not exist (review
findings 1, 2): `Map` has **no per-instance element memos** (the two-axis
`WeakMap` cache — `comprehensionCaches`, `library/control-structures.ts` —
is `Comprehension`-only), and the item-39 N-rewrap **returns a fresh `Map`
instance on every `.N()`** (`collection-utils.ts:754`), so nothing keyed on
"the collection instance" survives across top-level drains. Both are
addressed structurally below.

## D1 — Cache identity (review 1, 2)

- **Memoize the N-rewrap.** `lazyMapNumericApproximation` gains a
  module-scoped `WeakMap<Expression, Expression>` (original `Map` →
  rewrapped `Map`). The rewrap is purely structural (built from `fn.json`),
  so the memo needs no invalidation: the same original always yields the
  same wrapped shape, and returning the *same instance* is what makes every
  downstream per-instance state (this cache, and any future memo) survive
  repeated `.N()` calls on one logical Map. Per-instance semantics stay
  exactly as item 40 ratified: `subs()`/re-box copies are new originals and
  run cold.
- **The compile cache is a new module-scoped
  `WeakMap<Expression, MapCompileCache>`** in the collections module,
  modeled on (but distinct from) `comprehensionCaches`, keyed on the
  **rewrapped** `Map` instance (stable per logical Map by the memo above).
  Record shape:

  ```
  MapCompileCache = {
    state: 'compiled' | 'no-compile',
    fn?: (args: number|Complex ...) => unknown,   // compiled runner
    deps?: { def: BoxedValueDefinition, version: number }[], // capture set
    generation: number,      // _mutationGeneration stamp
    tolerance: number,       // ce.tolerance stamp (baked by equality codegen)
    reason?: 'structural' | 'abi' | { symbol: string }, // no-compile cause
    attemptedThisDrain?: boolean,
  }
  ```

  There is no element-result memo in this design; the compiled function is
  the cache. (A `Map` element memo, if ever wanted, is a separate design.)

## D2 — Trigger and route matrix (review 4, 16)

**Precondition (all routes):** the engine is machine-precision at drain
time — predicate: **`!bignumPreferred(ce)`**, the same test the numeric
kernels use (`ce.precision` ≤ `MACHINE_PRECISION`; note `ce.precision`
*gets* a number — `'machine'` is setter-only sugar, and the **default
engine precision is 21, i.e. bignum-preferred, so this feature never fires
on a default-configured engine**; the plot/analyze consumers run machine).
At bignum precision the interpreter produces digits float64 cannot match,
so no attempt is made.

**Trigger point:** the `Map` collection handlers (`iterator` and `at` in
`library/collections.ts`), when the element lambda's body carries the
numeric marker — the canonical `Block(N(body))` shape (single-statement
Block whose statement is an `N` application), produced by the item-39
rewrap and by the `addN`/`mulN` N-maps. The marker is matched and the `N`
stripped for compilation (compiled code is already numeric).

Route-by-route disposition:

| Route | Covered? | How |
|---|---|---|
| `.N()` / `evaluate({numericApproximation})` on a lazy Map → item-39 rewrap → later `each()`/`at()` | **Yes** | memoized rewrap → marked lambda → trigger in handlers |
| `addN`/`mulN` N-map drains (item-52 placement) | **Yes** | those construct the same marked shape; drains go through the same handlers |
| Async mirror (`_computeValue` step 2c) | **Yes** | same rewrap, same memo |
| User-authored `Map(…, Function(N(body)))` | **Yes, deliberately** | shape-identical to the marker; at machine precision an interpreted drain of `N(body)` yields the same float64s, so compiling it is semantics-preserving. (At bignum precision the precision gate blocks the attempt.) |
| Explicit materialization (`_computeValue` step 3, which runs **before** the rewrap) | **No (v1)** | the materialization drain sees the unmarked Map; it stays interpreted. Documented gap, revisit on a profile — do NOT reorder step 3/3b (item-39: explicit materialization wins). |
| Exact (`evaluate()`) drains | **Never** | no marker, and exactness contract forbids it |
| Empty / partial drains | trigger runs at most once (first element); an empty drain never compiles | |

**Eligibility gate** (checked once per attempt, before compiling):

1. The lambda body (transitively through called user functions, via the
   same recursive walk `analyzeReferences` performs) contains **no impure
   or excluded heads**: `Random`, `RandomInteger`, `RandomVariate`,
   seeded `Shuffle`, `Assign`/`Declare` targeting non-parameter symbols,
   and **loops without literal bounds** (bare `Loop`, `Sum`/`Product`/
   `Loop` with runtime-valued bounds). Literal-bounded big-ops (the
   repro's 40-term `Sum`) are eligible. Rationale: seeded `Random` bakes
   one draw per call site where the interpreter advances per element
   (review 7); unbounded compiled loops are uninterruptible (review 15) —
   acceptable when the user explicitly compiled, not on an automatic path.
2. `analyzeReferences(body).freeSymbols` minus the lambda parameters is
   **empty** (review 11): a valueless symbol has no channel into the
   positional call ABI, and the interpreter would return a symbolic
   element. The offending symbol is recorded in the `no-compile` reason
   (see D4 for when that clears).
3. The result-shape gate is **not** a static check: scalar-vs-other is
   enforced by the compile attempt itself (D6 fail-closed covers tuple/
   list bodies — review 25) plus the runtime result validation in D5.

## D3 — Capture tracking and invalidation (review 3, 5, 6, 10, 13)

- **Dependencies come from the compiler, not a body walk** (review 3): the
  compile attempt passes a collector through the target; `tryFoldKnownSymbol`
  and `ensureUserFunctionEmitted` record every symbol id whose **value or
  function-literal definition they actually consult**, transitively (both
  already recurse; the collector rides along; `registry.compiling` provides
  cycle protection). The recorded def *identities* + their `_writeVersion`s
  form `deps`.
- **Scope discipline** (review 5): v1 compiles only when every consulted
  capture resolves in the **ambient engine scope at compile time** — the
  same `engine._getSymbolValue()` resolution the compiler already uses.
  A `Function` literal carrying its own `localScope` whose captures
  resolve *through that scope* to non-ambient bindings is **ineligible**
  (fall back, `no-compile: 'structural'`). Validation then re-resolves each
  dep **by name in the ambient scope** and compares (a) definition
  identity — catching shadowing declares and def swaps — and (b)
  `_writeVersion`. Baking and validation therefore use one resolution
  algorithm by construction.
- **Validation frequency** (review 6): a cheap check runs **before every
  compiled invocation** (both `iterator.next` and `at`): compare the
  stamped `_mutationGeneration` and `ce.tolerance`. On mismatch, run the
  full dep walk (identity + `_writeVersion`); if all deps are unchanged,
  **re-stamp and keep the compiled function** — this is what prevents the
  animation-scenario thrash (review 13: unrelated per-frame `ce.assign`
  bumps the global axis; only a genuine dep change forces a recompile). If
  a dep changed: discard, recompile (a fresh attempt — legitimate
  recompiles are not failures). Mid-drain mutation is thereby honored: the
  element after an interleaved reassignment sees the new value, matching
  the interpreter's per-element re-read.
- **Engine configuration** (review 10): `ce.tolerance` is baked by the
  equality codegen → stamped and checked per invocation (above). Seeded
  randomness is excluded by the purity gate, so `randomSeed` needs no
  stamp. These are the only two compiler-baked engine inputs identified;
  the implementation must keep this inventory next to the stamp fields.
  *(Implementation correction, 2026-07-19: post-implementation review found
  a third compiler-baked input this inventory missed — `ce.angularUnit`,
  baked by `rewriteAngularUnit`. It is stamped and checked identically to
  `ce.tolerance`: a change forces a recompile, never a re-stamp.)*

## D4 — Fallback and failure semantics (review 8, 19, 23, 24)

- **Compile attempts are bounded**: at most **one attempt per drain** per
  instance (`attemptedThisDrain`, reset when a drain starts). This bounds
  the review-19 pathology (a side-effecting uncompilable lambda bumping
  the global generation per element cannot re-arm more than once per
  drain).
- **`no-compile` marks and what clears them**:
  - `'structural'` (unsupported head, D6 guard, excluded head, non-ambient
    scope): permanent for the instance lifetime — deterministic, cannot
    succeed later. Cheap short-circuit on every subsequent drain.
  - `{ symbol }` (unbound free symbol): cleared when that symbol's
    definition changes (`_writeVersion`/identity via the normal validation
    walk) — assigning the symbol re-enables one fresh attempt.
  - `'abi'` (runtime result-shape failure, D5): permanent — deterministic.
  - **Timeout / `CancellationError` during a compile attempt: no mark, and
    the cancellation propagates** (review 8). A deadline expiry reflects
    the moment's budget, not the instance; swallowing it would break the
    `withTimeLimit` contract. The next drain (with a fresh budget) may
    attempt again.
- **Silence**: the compile pipeline is invoked with **`fallback: false`
  and the throw is caught** (review 23) — this is the mechanism that keeps
  the existing "Compilation fallback" `console.warn` from firing; the
  auto path never warns.
- **Runtime throws from the compiled function propagate** — they are not
  swallowed into fallback (a runaway recursive user function surfaces its
  error to the caller). Note the exception-type divergence is the one
  documented in the recursive-lambdas design: compiled runaway throws
  `RangeError` where the interpreter's guard throws `CancellationError`
  (review 24) — this design inherits, and does not widen, that contract.

## D5 — Runner ABI (review 9, 12, 14)

- **Input conversion, per element, per source**: the source element must be
  a number literal (`isNumber`); real values convert via their machine
  float (`.re`), complex via `{re, im}`. At machine precision the
  interpreter itself computes in float64, so this matches the interpreter's
  own input handling; exact inputs whose float64 conversion is lossy
  (integers beyond 2^53, rationals) lose the same digits the machine-
  precision interpreter loses — parity is against **machine-precision
  `.N()`**, which is the only mode the trigger admits (review 12; the
  adversarial cases go in the test corpus, not the contract). For a
  multi-source (zip) `Map`: **all** arguments must convert; if any element
  fails, that whole element row falls back to the interpreter (the
  compiled function keeps serving other rows).
- **Result validation, per invocation**: a finite or NaN `number` → boxed
  number; an object with numeric `re`/`im` → boxed `Complex`; `Infinity`/
  `-Infinity` → the corresponding boxed infinity. Anything else
  (`undefined`, boolean, array, malformed object) is an ABI failure: fall
  back to the interpreter for that element **and** mark the instance
  `no-compile: 'abi'` (deterministic — review 9).
- **NaN double-check** (review 14): emission is chosen statically, so a
  real-emitted body can return NaN where the machine-precision interpreter
  leaves the reals (`x ↦ √x` at −4 → complex). Rule: when the compiled
  function returns **NaN**, re-evaluate that element through the
  interpreter and use its result. A genuinely-NaN element pays double
  evaluation (correct either way); a domain-crossing element gets the
  interpreter's complex value — parity restored without runtime dispatch.
  (Bodies that are *statically* complex compile in complex mode and don't
  need this often; the check applies uniformly regardless.)

## D6 — Deadlines (review 15, 21)

- **Compilation is structural** (canonicalize + codegen, no evaluation);
  its cost is bounded by expression size. It runs under whatever engine
  deadline is armed; `CancellationError` propagates per D4. It arms
  nothing itself.
- **Drain interruptibility is unchanged from the existing contract**: a
  drain inside `.N()`/`withTimeLimit` has an armed deadline and the drain
  loop checks it every K = 256 elements (K is an internal constant, not
  exposed; compiled elements are ~µs so the check is free). A detached
  `each()`/`at()` walk of a lazy Map has no armed deadline **today**, with
  or without this feature — callers wrap such walks in `withTimeLimit()`
  (the documented pattern); this design does not change that, and the
  every-K check is simply inert when no deadline is armed (review 21).
  The single-long-element hazard is excluded by eligibility (no
  runtime-bounded/unbounded loops, D2).
- **Amortization** (review 22): accepted explicitly — a compile attempt is
  one-shot per instance and costs ~ms; an unknown-length source that
  realizes 2 elements overpays once and never again. No peek/threshold in
  v1.

## D7 — Environment gate (review 20) — *ratified*

Auto-compilation executes dynamically generated code (the `Function`
constructor), which strict-CSP pages (no `'unsafe-eval'`), MV3 browser
extensions, edge runtimes, and hardened Node reject — and even a *caught*
attempt fires a CSP violation report on `report-to` pages.

**Engine-level flag `ce.jit: 'auto' | 'off'`** (default `'auto'`),
governing **every implicit-compilation path** — this feature AND the
existing numeric-quadrature integrand auto-compilation (which crosses the
same line today with no guard) — not just Map drains; the scope is
deliberately general so future implicit-codegen paths inherit it.

- `'auto'`: implicit compilation attempts run. On the first
  environment-level failure to *construct* a function (CSP `EvalError` —
  distinct from an ordinary compile failure), the engine latches `'off'`
  engine-wide — detect once, not per instance — and all subsequent
  implicit paths interpret silently, capping report spam at one violation
  total.
- `'off'`: no implicit codegen is ever attempted (a strict-CSP host sets
  this up front and generates zero violation reports); also serves as the
  diagnostic kill switch (interpreter-vs-compiled bisection) and the
  performance A/B lever.
- **Explicit `compile()` is exempt**: a direct user request keeps failing
  loudly with the environment's own error, regardless of the flag.

Wiring the quadrature path onto the flag ships with this feature (a
one-site check where the integrand compile is attempted).

## Test plan (review 18)

Instrumentation first: a module-level `_mapAutoCompileStats` counter
(attempts, compiled-hits, revalidations, recompiles, per-element
fallbacks, NaN double-checks), exported for tests — every test below
asserts **counter deltas**, not just values, so an all-interpreter
implementation cannot pass.

1. Repro-shaped drain: digit parity vs machine-precision `.N()` +
   `attempts === 1`, `compiled-hits === N`.
2. **Cache identity**: `.N()` twice on one logical Map → second drain
   `attempts === 0`, `compiled-hits > 0` (the D1 memo working).
   `subs()` copy → fresh attempt (item-40 contract).
3. Exactness: plain `evaluate()` drain stays exact/symbolic, `attempts === 0`.
4. Precision gate: same drain at `ce.precision = 21` (the default!) and
   `50` → `attempts === 0`, bignum digits intact; at machine → fires.
5. Invalidation: reassign a captured symbol **between** drains → recompile
   (deps changed); reassign an **unrelated** symbol → revalidation but no
   recompile (the review-13 thrash guard); reassign **mid-drain** via an
   interleaved iterator → the next element reflects the new value.
6. Transitive captures: value-chain (`a := i+1`) and called-user-function
   captures invalidate correctly; an interleaved `Sum` (ephemeral
   loop-index writes) does not (item-38 semantics).
7. Purity: seeded `Random` body → ineligible, interpreter stream advances
   per element (digit-check against seeded interpreter run); unseeded
   `Random` → ineligible.
8. Free symbols: lambda referencing undeclared `k` → `no-compile: {k}`,
   symbolic elements; `ce.assign('k', …)` → next drain attempts and
   compiles.
9. ABI: mixed numeric/symbolic source rows (per-row fallback); a
   multi-source Map with one non-numeric column element; boolean-returning
   body → `'abi'` permanent.
10. NaN double-check: `x ↦ √x` over `[4, −4]` → `[2, 2i]` matching the
    interpreter, one NaN-double-check counted.
11. Failure semantics: uncompilable head → one attempt this drain, zero
    the next (structural permanence); compile timeout under a tiny
    `withTimeLimit` → `CancellationError` propagates, no mark, later
    drain succeeds.
12. Tolerance: change `ce.tolerance` between drains of an
    equality-containing body → recompile (stamp mismatch).
13. Runtime throw: runaway recursive user function inside a drain →
    `RangeError` to the caller, not fallback.
14. Routes: `each()`-only and `at()`-only access after one `.N()`;
    `addN`/`mulN` drain; async route; explicit materialization does NOT
    attempt (documented v1 gap pinned as such).
15. No console output in any of the above (spy on `console.warn`).

## Non-goals (v1)

Exact drains; bignum drains; tuple/list-valued lambdas (D6 fail-closed
enforces); non-`Map` lazy collections (`Filter`, `Comprehension` bodies);
cross-instance interning (item-40 boundary); an element-result memo for
`Map`; covering the explicit-materialization route; changing the explicit
`compile()` API or its warning behavior.

## Ratification (closed 2026-07-19)

1. **D7 flag — RATIFIED with generalization**: `ce.jit: 'auto' | 'off'`
   (not the Map-specific `jitCollections`), governing all implicit
   compilation including the existing quadrature integrand path; explicit
   `compile()` exempt. Default `'auto'` with engine-wide latch on CSP
   failure.
2. **Explicit-materialization route gap — RATIFIED as a v1 non-goal**:
   the materialization drain (which runs before the item-39 rewrap in
   `_computeValue`) stays interpreted; the step-3/3b ordering is not
   revisited. Pinned as a documented gap in the test plan (test 14).
