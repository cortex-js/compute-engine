# Broadcast-chain lowering for stacked lazy `Map`s ("Map fusion")

**Status: RATIFIED 2026-07-27 — R1–R6 as recommended, user-confirmed.**
**Date:** 2026-07-27 · **Trigger:** Tycho item 103 (lazy-Map drain floor).

## 1. Motivation

Broadcast arithmetic over a lazy collection stacks lazy `Map`s: the item-103
witness `d(x) := 1 + Mod(Range(0,899) + x, 900)` canonicalizes to THREE
nested `Map`s, so one 900-element drain performs 2,700 full `makeLambda`
applications. The flat per-element cost caps interactive consumers (Tycho)
at roughly 6k drained elements per 50 ms frame; Tycho added a plain-JS
numeric fast path to its `broadcastPiecewise` lowering purely because of
this floor. The ROADMAP records `Map(Map(s,f),g) → Map(s, g∘f)` as the
structural lever; this design measures that lever against the alternatives
and recommends a different locus.

## 2. Measurements (2026-07-27)

Harness: `tsx` on source, one long-lived engine, interleaved rounds, medians
(steady-state; a long-lived interactive engine is the scenario that
matters). `tsx`-on-source runs ≈2× slower than `dist`; ratios are the
signal. Witness drain = 900 elements of the `d(29)` stack via `each()`.

**Route decomposition (µs/element, warm):**

| route | today | note |
| --- | --- | --- |
| `evaluate()`, stacked 3-`Map` | 17.0 | the item-103 floor |
| `.N()`, default (bignum-preferred) precision | 41.0 | auto-compile declines by design |
| `.N()`, machine precision | 1.8 | auto-compile: 3 compiles, 2700/2700 compiled hits — **already solved** |
| bare `Range` `each()` (no `Map`) | 0.4 | iteration floor |
| identity-body `Map` (invoke floor) | 2.0 | per-level `makeLambda` overhead, warm |
| eager `_fn(op, args).evaluate()` per level | ~3.4/op | the interpreted-arithmetic floor |

**Strategy comparison (`evaluate()` route, µs/element, warm, same
process):**

| strategy | µs/elt | ratio | churn |
| --- | --- | --- | --- |
| S0 — today (nested iterators, 3 invokes) | 17.0 | 1× | — |
| S1 — closure composition only (walk chain, compose `applicable()` fns) | 16.8 | **1.0×** | none |
| S2 — **direct per-element evaluation** (walk chain, `ce._fn(op, slots).evaluate()` per level, no `makeLambda`) | 10.2 | **1.67×** | none |
| S3 — structural fusion ceiling (hand-fused single `Map`, still one invoke + fused-body interpretation) | 12.4 | 1.37× | canonical forms change |

Same comparison on the `.N()` route at **default** precision: 41.0 → 12.7
(**3.2×**, S2 lowering with the per-level `N` marker honored) — the invoke
path's per-call `evaluateInOwnBindings` numeric pass is bypassed too. At
machine precision the auto-compile path already serves 1.8 µs/elt on the
stacked form; a fused compiled body measures 0.8 µs/elt (raw compiled fn:
0.036), so the compiled route's remaining headroom is boxing hops, not
lambda applications.

Element-for-element parity of S2 against today's path was verified on the
witness (both routes) and on the reactive-scalar probe (§5 R3).

**Why S1 fails and S2 works:** composing closures still pays one
`makeLambda` invoke per level; the invoke machinery (fresh `Scope`,
`declareParameterActivation`, `hideBodyScopeParams`, `captureClosures`,
binding-keyed substitution, own-bindings numeric pass) is what the ~2–2.3
µs/level floor (and 3× that on the N route) buys, and none of it is needed
when the mapping function is the broadcast-built shape — one operator
application whose operands are the parameters and closed scalars. A CPU
profile confirms no single hot spot beyond this: the rest is the interpreted
arithmetic pipeline itself (`add`/`flatten`/exact-numeric folds), whose
per-op cost (~3.4 µs warm) is the true floor of any interpreted drain.

**Honest baseline note:** the 2026-07-27 profile session quoted ~8 µs/elt
per application (≈37 ms for the witness drain) measured cold on `dist`;
steady-state warm the same drain is ~15 ms (`tsx`). Both the problem and the
win survive warm-up; the acceptance targets below are stated as ratios
against the same-harness baseline, not absolute milliseconds.

## 3. Design space disposition

- **A — structural fusion at canonicalization** (`Map(Map(s,f),g)` →
  `Map(s,g∘f)`): REJECTED. Measured ceiling 1.37× — *worse* than drain-time
  lowering (1.67×), because the fused body still pays one invoke plus full
  interpreted evaluation of a deeper tree. Costs it would add: every
  canonical form changes (snapshot blast radius across the suite,
  serialization, Tycho-visible `.json`), the composed body must be built
  with the binder framework (capture-avoiding substitution into a lambda
  body — `.subs()` is not capture-avoiding), and `Length`/`Count`/facet
  delegation through the chain must be re-audited. All cost, less win.
- **B — drain-time closure composition** (as literally stated): REJECTED as
  the mechanism — measured no win (16.8 vs 17.0). The *locus* (fusion as an
  iteration detail inside the iterator, zero canonical churn) is right and
  is kept; the composition must bypass `makeLambda`, not stack it.
- **C — cheapen the `makeLambda` invoke path** (reuse one scope/frame per
  drain): REJECTED. The warm invoke floor is 2.0 µs/level and the lowering
  recovers ~all of it for the shapes that stack (broadcast-built lambdas);
  what C would additionally serve is user-written deep-body lambdas
  (`_q ↦ _q² + 1`), where body interpretation dominates and the floor is a
  small fraction. A shared mutable frame also risks aliasing for escaping
  closures and value-definition reuse against `_writeVersion`/reactive
  semantics — real hazard for a residual ~1 µs/level.
- **B′ — drain-time direct evaluation of the lowered chain**: **ADOPTED**
  (rulings below). Walk the `Map` spine at drain start, extract each
  level's `(operator, slot layout, N-marker)`, then serve elements from one
  loop: per element, per level, `ce._fn(op, slots).evaluate(napprox)` —
  falling back to the untouched general path whenever any level doesn't
  match the shape.
- **Exact-mode compilation for `evaluate()` drains** (compile
  integer-closed bodies with overflow-guarded float64/bigint arithmetic;
  potential further ~5–10× to the compiled floor): DEFERRED — requires new
  compiler support (guarded integer codegen, `Number.isSafeInteger`
  checkpoints) and its own exactness-soundness argument. Recorded as the
  next lever if the interpreted floor is still limiting after this lands.

## 4. Terminology

- **Broadcast-shaped lambda**: a canonical `Function` literal whose
  parameters are bare (no type annotations, no defaults) and whose body —
  after unwrapping a single-statement `Block` and then an optional `N`
  marker — is either (a) a bare parameter symbol (identity), or (b) a
  single function application each of whose operands is a parameter symbol
  or a parameter-free subexpression ("closed operand"). This is exactly the
  shape `lazyBroadcastMap` constructs; user-written lambdas match only if
  they happen to canonicalize to it (`x ↦ x + 1` does; `x ↦ x² + 1` does
  not).
- **Lowerable level**: a lazy `Map` whose mapping function is
  broadcast-shaped.
- **Spine**: the maximal chain of lowerable levels reached from a drained
  `Map` by following source operands. A multi-source (variadic) level may
  terminate the walk: its sources become the base streams. Anything else —
  a non-`Map` source, a non-lowerable lambda, `Filter`, an eager `List` —
  is a base stream, drained via its own `each()` (an inner lowerable `Map`
  reached *as one of several sources* still lowers its own spine inside its
  own iterator, so seams cost one iterator hop, which S1 shows is ~free).

## 5. Rulings requested

### R1 — Locus: drain-time lowering in the `Map` collection handlers; no canonical-form change

Fusion is an iteration detail. The lowering lives in `Map`'s `collection`
handlers (`iterator` and `at`), next to the existing auto-compile trigger.
Canonical forms, `.json`, serialization, types, and facet delegation
(`count`/`isEmpty`/`isFinite`) are untouched — expected snapshot churn:
**zero**. The lowering is computed once per instance and memoized in a
`WeakMap` (canonical expressions are structurally immutable, so the memo
needs no invalidation — same argument as the `lazyMapNumericApproximation`
rewrap memo). **Recommended: adopt.**

### R2 — Scope of the fast path: broadcast-shaped levels only, shape-checked at drain time, silent structural fallback

A level that fails the shape check (annotated or defaulted parameters,
multi-statement `Block` body, deep parameter position, non-application
body) ends the spine there; the drain above it proceeds lowered, the rest
through the general path. No operator allowlist, no name sets — the gate is
purely structural. User-visible behavior of non-matching `Map`s is
byte-identical by construction. **Recommended: adopt.**

### R3 — Per-element evaluation contract of a lowered level

Per element, the level evaluates `ce._fn(op, slots)` where parameter slots
hold the incoming element value(s) and closed slots hold the **original
canonical body operand nodes** — not copies, not re-boxed. Consequences,
each mirroring the general path exactly:

- **Same dispatch**: the interpreted path evaluates the same operator with
  the same operand sequence (the body node with the parameter resolved to
  its value); lazy operators (`Add`, `Multiply`) receive raw operands and
  drive evaluation themselves in both paths.
- **Reactivity**: closed operands carry their bindings (post
  symbol-identity repair), so out-of-scope evaluation resolves identically
  and a mid-drain reassignment is honored on the next element (probed:
  `Add(Range(1,200), y)` with `y := 7` then `y := 100` — interpreter and
  lowered path agree at every step).
- **Impurity/draw order** (`docs/RANDOMNESS-MODEL.md`): a closed impure
  operand (a spliced raw `Random()`) is the same node the interpreter's
  body evaluation re-evaluates per element — same draw count, and element
  order through the stack is preserved by construction (element *i*
  traverses every level before element *i+1* starts, exactly as nested
  iterators do today). **No memoization of closed operands in this design,
  even provably pure ones** — parity first; a pure-operand memo is a
  measured follow-up.
- **Exactness**: `evaluate()` stays exact — the lowered level calls
  `.evaluate()` (no approximation flag). A level whose body carried the `N`
  marker (`Block(N(inner))`) evaluates with
  `{ numericApproximation: true }`, per level, mirroring the marker's
  position in the chain.
- **Failure parity**: a failed level mirrors its own route — on the iterator
  the failing level's position-preserving `absenceMarker` becomes the element
  value and flows through the remaining levels (exactly as a declined
  `makeLambda` application does today), while on `at()` the whole access
  short-circuits to `undefined`, as the general single-source `at` does.
- **Deadline**: `_fn(...).evaluate()` and the base-stream `each()` are
  already deadline-aware; the lowered loop adds no unguarded segment.

**Recommended: adopt.**

### R4 — Auto-compile keeps precedence, per level

At drain start the lowered iterator asks `mapAutoCompileRunner(levelExpr,
{ drainStart: true })` for **each** level (the walk has every level's `Map`
instance in hand) and consults that runner first per element, falling back
to the level's direct evaluation — the same precedence the level's own
iterator applies today. Caches, stats, the draw-counter rollback, and the
machine-precision/bignum gate all keep their existing semantics and
instance keying. (Composing the levels' compiled runners on raw floats —
skipping inter-level boxing, 1.8 → ~0.8 µs/elt — is a compatible follow-up
inside the same loop, not part of this design.) The `_computeValue` steps
3/3b ordering is untouched (ratified non-goal). **Recommended: adopt.**

### R5 — `at()` uses the same lowering

Random access re-derives the element through the memoized lowered chain
(one `_fn` chain application) instead of one `makeLambda` invoke per level;
each `at()` remains its own auto-compile micro-drain. **Recommended:
adopt.**

### R6 — Out of scope (dispositions to record)

Structural canonicalization fusion (A), frame reuse (C), closure-only
composition (B) — rejected with the §2/§3 measurements. Exact-mode
compilation — deferred, next lever. Lowering through non-`Map` lazy views
(`Filter`, `Take`, windowing ops) — out of scope; their lambdas are
predicates/reshapers, not element transforms, and the broadcast stack that
motivates this design is `Map`-only. **Recommended: adopt.**

## 6. Acceptance

- **Witness**: warm `d(29)` 900-element `evaluate()` drain ≥1.6× vs
  same-harness baseline (measured 17.0 → 10.2 µs/elt; ≈9 ms `tsx`, ≈5 ms
  `dist` — the eager-zip cost of the same three ops, which is this route's
  floor short of exact-mode compilation); `.N()` at default precision ≥3×
  (41.0 → 12.7); `.N()` at machine precision not regressed (auto-compile
  path, 1.8 µs/elt, stats vector unchanged: 3 attempts / 2700 hits on the
  witness). 8-term neighbour-sum (`d(k)` for 8 offsets, elementwise-added):
  today ≈129 ms warm `tsx`, lowered ≈77 ms (est. ≈39 ms `dist`) — inside
  the 50 ms frame on `dist`. Box-microloop canary alongside every
  measurement.
- **Correctness**: element-for-element parity probes stacked-vs-lowered on
  both routes; route parity (box/parse/function construction of the
  witness); reactive mid-drain reassignment probe; impure-body draw-count
  vectors (`random-vectors.test.ts` must not regenerate); full suite with
  snapshot blast radius measured — expected churn **zero**; never `-u` an
  `@fixme`.

## 7. Implementation sketch (post-ratification)

1. `collection-utils.ts` (or a sibling `map-lowering.ts`):
   `lowerMapSpine(expr)` → `{ base: Expression[], levels: LoweredLevel[] }
   | undefined`, with the `WeakMap` memo; `LoweredLevel = { expr, op,
   slots: (Expression | ParamIndex)[], napprox }`.
2. `library/collections.ts` `Map.collection.iterator`/`at`: attempt the
   lowering first; lowered loop integrates each level's
   `mapAutoCompileRunner`; structural fallback to the existing code
   (kept verbatim).
3. Tests: parity block (stacked vs lowered, both routes, both precisions),
   shape-gate negatives (annotated param, deep body, multi-statement
   block), reactivity probe, impure-body draw parity, variadic mid-chain
   level, `at()` route, and the witness perf pin (ratio-based, canary-
   normalized).

No changes to `function-utils.ts`, `_computeValue`, canonical handlers, or
serialization.
