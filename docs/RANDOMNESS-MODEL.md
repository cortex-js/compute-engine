# Randomness Model — Design Note

**Status**: ratified and implemented 2026-07-25. The design record — the
problems it fixes, the alternatives rejected, the migration table — is
[`docs/plans/2026-07-25-random-signature-redesign.md`](./plans/2026-07-25-random-signature-redesign.md).
This note is the durable **model reference**: what the engine guarantees, and
what a reimplementation must reproduce.

The frame stack is the second engine-wide, dynamically-scoped runtime mechanism
alongside the deadline stack of [`TIMEOUT-MODEL.md`](./TIMEOUT-MODEL.md), and it
follows that note's one-sentence rule from the other side: **budgets compose,
configs shadow.** A time span composes with `min()`; a random seed frame
**shadows** — the innermost frame wins outright.

## 1. The model in one page

Seeding is not an argument. It is a **block-scoped frame**:

```
WithRandomSeed(42, Random())                     // deterministic real in [0,1)
WithRandomSeed("cell-a7", (Random(), Random()))  // two DIFFERENT draws; block replays
WithRandomSeed(s, WithRandomSeed(t, Random()))   // nests; innermost wins

Random()                                         // unframed: live, nondeterministic
Random(Range(1, 6))                              // domain-only; no seed argument
```

Two consequences, and they are the point:

- **Inside a frame, repeated draws differ and the frame as a whole replays.**
  `WithRandomSeed(42, (Random(), Random()))` yields two different values, and
  the same two values every time.
- **Outside a frame, randomness is live.** There is no ambient seed to set, so
  an unframed draw is nondeterministic by construction — which is what an
  animation or ticker needs. (The one exception is a GLSL fragment shader,
  which has no clock to be live with; see §8.)

The surface:

| Form | Result |
|---|---|
| `WithRandomSeed(seed, body)` | `body` evaluated with a frame seeded by `seed` |
| `Random()` | real in `[0,1)` |
| `Random(Interval(a,b))` | real in `[a,b)` (endpoint markers ignored) |
| `Random(Range(…))` | an element of the range |
| `Random(xs)` | an element of the finite collection `xs` |
| `RandomChoice(domain, k)` | `k` draws, **with** replacement |
| `RandomSample(xs, k)` | `k` elements, **without** replacement |
| `RandomShuffle(xs)` | a permutation |

There is no seed argument anywhere in the family. `RandomInteger`, `RandomList`,
`RandomSeed`, `Sample`, `Shuffle` and the `ce.randomSeed` property are removed
(tombstoned for one release — each throws `operator-removed` naming its
replacement).

## 2. Frames

A frame is a runtime object — `{ seedLo, seedHi, next }` — held in a single
per-engine slot on the evaluation context's runtime state
(`EngineRuntimeState.randomFrame`, reached as `ce._randomFrame`). There is no
array: the *stack* is the JS call stack.

```ts
withRandomSeedFrame(ce, seed, () => { … })   // boxed-expression/utils.ts
```

saves the previous frame, installs `{ …foldSeed(seed), next: 0 }`, and restores
the previous frame in a **`finally`**. That is the whole mechanism, and it gives:

| Property | Ruling |
|---|---|
| Seed type | `finite_real` or `string`. Complex and non-finite **literals** are signature-invalid; a seed *expression* evaluating to a non-finite or non-real value is a structured `out-of-range` error at frame entry, never a hash |
| Scoping | **Dynamic** — the frame is active through user-function calls, not just lexically inside `body` |
| Nesting | Allowed; **innermost wins** (a config shadows) |
| Counters | **Independent per frame** — a frame's *n*-th draw is `hash(seed, n)` regardless of nested frames |
| Seed evaluation | **Once per frame entry**, not per draw |
| Laziness | `WithRandomSeed` is `lazy: true` — `body` must not evaluate before the frame exists |
| Throw | The frame is restored in a `finally`; a draw evaluated after a throwing body is unframed |
| Engine isolation | The slot is per-engine runtime state, never a module-level singleton. Two engines never share frames |

Because counters are per-frame, a nested frame cannot perturb its parent:

```
WithRandomSeed(1, (
   Random(),                     // hash(1, 0)
   WithRandomSeed(2, Random()),  // hash(2, 0)
   Random()                      // hash(1, 1)  ← unaffected by the inner frame
))
```

This is what makes per-cell seeding safe for a document: adding or editing one
cell's inner frame cannot change another cell's values.

The frame stack inherits CE's existing, deliberately-unfixed constraint on
concurrent async evaluation over one engine (see `TIMEOUT-MODEL.md` §6.4). It
does not worsen it and cannot independently fix it.

### Symbolic and invalid seeds

| Seed at frame entry | Result |
|---|---|
| finite real, or string | frame installed |
| `NaN`, `±∞`, complex | `out-of-range` error — never a shared zero-seed stream |
| does not reduce to a literal (a symbol, an error) | the whole `WithRandomSeed` expression stays **unevaluated** |

### Partial evaluation keeps the frame

A body that cannot **finish** its draws — an impure application survives
evaluation, e.g. `RandomShuffle(Range(1, n))` with `n` unbound — also leaves
the whole `WithRandomSeed` expression **unevaluated**. Returning the partial
result would strip the seed frame, and every later draw from the stored
partial would be live: seeded randomness silently converted to unseeded
(Tycho item 104). Because replay is deterministic from draw 0, evaluating the
intact expression later (once the free symbol binds) reproduces any draws
that did complete and yields exactly the single-evaluation stream —
`e.evaluate().subs({n: 5}).N()` and `e.subs({n: 5}).N()` are the same values.

Two shapes are **completed values**, not pending draws, and do strip the
frame: a lazy view whose lambda draws at materialization (the §6 ruling — the
escape stays a live-draw escape, whether the view is the result itself or a
cell of a returned `List`/`Tuple`; a view that BINDS its own variables, such
as a `Comprehension`, counts here too — its body is the lambda, spelled
without a `Function` node), and `Hold` content (inert until
`Release`, under whatever frame is active then). A lazy view beneath a
**surviving eager consumer** (`ListFrom(Map(range, x ↦ Random()))` whose
length has not resolved) is the opposite case: the materialization was asked
for *inside* the frame, so its draws are owed and the frame is kept. A body
that evaluates to a structured error passes the error through (§5: an error
consumed zero draws), rather than hiding it behind an inert wrapper.

Pending-ness is keyed on two operator flags — never on impurity in general, so
a surviving `Assign` or `Declare` is impure but owes nothing to the frame and
does not keep the expression wrapped:

- **`drawsRandom`** — the operator consumes indices from the stream (`Random`,
  `RandomShuffle`, a nested `WithRandomSeed`).
- **`readsRandomFrame`** — the operator reads the frame through a derived
  sub-stream while consuming **no** indices: the stochastic estimators. A
  *completed* estimate owes nothing (its node is gone), but one that could not
  finish — `NIntegrate(f, 0, n)` with `n` unbound — derives its sub-stream only
  when it finally runs, so the frame must survive to that point or the deferred
  completion samples live.

The stochastic **estimators** — Monte-Carlo integration, the sampled equality
probe — are `drawsRandom: false` for the same reason, and deliberately so.
They replay under a frame, but through a *derived sub-stream*: a private
counter seeded from the frame that consumes **none** of its indices (see
[`docs/plans/2026-07-28-derived-substreams.md`](./plans/2026-07-28-derived-substreams.md)).
An integral may take 1e7 samples and its sampling loop is deadline-truncated,
so charging them to the frame would both shift every later `Random()` draw and
make replay depend on wall-clock time. Because a completed estimate owes the
frame nothing, it must not pin one. One consequence worth knowing: the same
integral samples the same points wherever it sits in a frame, so `∫f - ∫f` is
exactly `0` under a seed.

**Compiled integrals are a ruled exception to the bit-parity claim above**
(ruled 2026-07-29). An integral inside a compiled artifact samples live even
within a frame. The reason is structural: the generated code emits one
independent quadrature call per limit, and the inner call of a nested integral
runs afresh at every outer quadrature node — a per-call sub-stream would
restart at `n = 0` each time, sampling identical points, which converts
independent noise into a bias the outer quadrature integrates as signal. That
is a worse trade than staying live. The exposure is narrow: a smooth integrand
folds to a constant at compile time or converges under deterministic
Gauss–Kronrod, so only a pathological integrand reaches the estimator at all.
**A seeded integral that must reproduce should be evaluated, not compiled.**

**A user-defined function carries the flag too.** `f() := Random()` gives `f`
an inferred `pure: false, drawsRandom: true`, derived from the heads its body
applies, so a draw behind a user function is seen by this gate and by the
draw-consumption accounting — a call is not a hole in the model. The inference
is a one-way downgrade from heads with a *known* definition, so it has one
documented blind spot: a head that has no definition at the point of
definition — a higher-order parameter (`f(g) := g()`), or a callee defined
*after* its caller — is assumed pure. Set the flag explicitly on the
definition when that matters.

Keeping the expression whole means a later `evaluate()` **re-runs the
body** — the standard semantics of re-evaluating any unreduced impure
expression. Draws are deterministic under the frame (replay from draw 0),
but a non-random side effect in the body (`Assign(x, x+1)`) executes once
per evaluation, exactly as it would in any other expression that did not
reduce. A pipeline that stores the kept expression should treat it like any
other unreduced impure expression: substitute, then evaluate once.

### LaTeX

`\operatorname{WithRandomSeed}(seed, body)`, serializing as
`\mathrm{WithRandomSeed}(…)`. This is a persistence surface exactly like the
hash: stored documents carry it and consumers' re-serializing passes match on
it, so parse → serialize → parse is pinned by test.

## 3. `foldSeed` — normative

A seed folds to **two u32 words**, `(seedLo, seedHi)`
(`numerics/random.ts`). This is a cross-version contract; the vectors below are
pinned by `test/compute-engine/random-vectors.test.ts`.

**Numeric seed.** Write the f64 with `DataView.setFloat64` (**big-endian** — the
`DataView` default) and read back two words: `seedLo = getUint32(0)` (the *high*
word of the bit pattern), `seedHi = getUint32(4)` (the low word). **No XOR.**

> Folding the two halves together — what the retired `hashSeed` did — discards
> half the information, which is exactly what makes seeds differing only in low
> mantissa bits collide.

**`-0`** is normalized to `0` before folding. The raw bytes differ in the sign
bit, but `-0 === 0` everywhere else in the language, so distinct streams would
be a trap.

**Non-finite** input **throws**; callers translate that into the structured
`out-of-range` error of §2.

**String seed.** Two FNV-1a runs over the string's **UTF-16 code units** — each
16-bit unit XORed *whole*, then multiplied by the FNV prime `16777619` —
differing only in the offset basis:

| Word | Offset basis |
|---|---|
| `seedLo` | `0x811C9DC5` (the standard 32-bit FNV basis) |
| `seedHi` | `0xCBF29CE4` (the high word of the 64-bit basis `0xCBF29CE484222325`) |

Published, citable constants, so a third party can reproduce them.

Worked vectors:

| Seed | `seedLo` | `seedHi` |
|---|---|---|
| `0`, `-0` | `0x00000000` | `0x00000000` |
| `0.5` | `0x3FE00000` | `0x00000000` |
| `42` | `0x40450000` | `0x00000000` |
| `"cell-a7"` | `0x1163A2F4` | `0x96EAC847` |

## 4. The stream — PCG3D

> The *n*-th draw within a frame is **`hash(seed, n)`** — a pure function of the
> seed and the draw index, with no mutable stream state.

That is the load-bearing choice. It buys interpreted/compiled bit-parity (both
sides evaluate the same formula), GPU feasibility (a fragment shader has no
persistent stream but *can* compute `hash(seed, n)`), reset-on-entry compiled
semantics (a frame's counter starts at 0 by definition), and frame independence
as a definition rather than as bookkeeping.

`hash` is **PCG3D** — Jarzynski & Olano, *Hash Functions for GPU Rendering*,
JCGT 2020, §6 (<https://jcgt.org/published/0009/03/02/paper.pdf>) — transcribed
verbatim:

```glsl
uint3 pcg3d(uint3 v)
{
    v = v * 1664525u + 1013904223u;
    v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
    v ^= v >> 16u;
    v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
    return v;
}
```

The cross-multiply-adds are **sequential**: `v.y += v.z*v.x` reads the `v.x`
just updated. Pure u32 arithmetic everywhere, so every target is a
*transcription* of one algorithm rather than an independent reimplementation of
it — which is where a cross-target bit-parity contract would otherwise break.
JS uses `Math.imul` for the 32-bit multiplies and `>>> 0` to stay in u32 space.

The seed is 64 bits carried as two words, so all three PCG3D inputs vary — the
3→3 configuration the paper benchmarked:

```
w0, w1, w2 = pcg3d(seedLo, seedHi, n)      // w2 unused by both presentations
```

Why this generator, against the constraints above: no u64 exists in JS or in
GLSL/WGSL, so a 64-bit algorithm would be emulated on both sides; PCG3D fails
**1** TestU01 BigCrush test where PCG2D fails 35; adjacent seeds decorrelate,
which matters because per-cell seeds are commonly derived (`base + cellIndex`);
and it is published and citable, so a third party can verify a stored document.

**Kernel injection point** (EFFECTS-MODEL v5, "Host capabilities"): `hash` is
the *default implementation* of the index-addressed kernel
`ce.effects.random.draw(seed, n)`. A host may install a replacement — for
mocking, for pinning a generator so replay archives stay valid across engine
versions, or for compliance-mandated generators — under the same contract this
section states: a pure function of `(seed, n)`, captured at frame entry.
Everything above the kernel (frames, draw indices, sub-stream seed derivation)
is engine-owned and unaffected by a swap. Compiled targets inline PCG3D
verbatim, so while a non-default kernel is installed, compiling a
`random`-bearing expression **fails closed** (declines with a diagnostic);
custom kernels are interpreted-only.

### Parity is tiered — the GPU cannot be bit-equal

GLSL and WGSL have no f64, and GLSL ES float ops are not IEEE-pinned. A flat
bit-parity contract would promise something no shader can deliver, so the
contract is tiered around the **integer** stream:

| Tier | Contract |
|---|---|
| **Canonical object** | the integer stream `pcg3d(seedLo, seedHi, n)` — u32 ops, exact on ES 3.00 and WGSL |
| **f64 targets** (interpreted, compiled JS) | bit-identical to each other; present the integer stream as f64 |
| **GPU targets** (GLSL, WGSL) | present the **same** integer stream as f32 through integer ops and an **exact power-of-two** conversion — never implementation-rounded float math |

The presentations:

```
f64 tier  =  (w0 * 2^21 + (w1 >>> 11)) * 2^-53      // 53 mantissa bits
GPU tier  =  (w0 >>> 8)  * 2^-24                    // top 24 bits of the SAME w0
```

Because the f32 value is the top 24 bits of the very `w0` the f64 value is built
from, the two tiers agree to within **2⁻²⁴ by construction** — a stated, bounded
difference, not a coincidence and not an unspecified "approximately".

Worked vector (seed `42`, `n = 0`):

| Quantity | Value |
|---|---|
| `(seedLo, seedHi)` | `(0x40450000, 0x00000000)` |
| `(w0, w1)` | `(0xBC9A5701, 0xBF196ADB)` |
| f64 draw | `0.7367300395263549` |
| GPU draw | `0.7367300391197205` |
| divergence | `4.07e-10` (bound `2⁻²⁴ ≈ 5.96e-8`) |

Two further contracts:

- **Draws are IEEE float64 regardless of precision mode.** The same vectors hold
  under `precision = 'machine'` and under high precision, so parity survives
  high-precision evaluation.
- **The seed→stream mapping is stable across CE versions.** A change to any
  constant, to the operation order, to `foldSeed`, or to either presentation
  formula is a **breaking change** — it re-randomizes every stored document and
  churns render ground-truth corpora. `random-vectors.test.ts` pins the raw
  words (not just the presented floats), which is what lets a third party
  validate a reimplementation against the paper. Treat a diff there as a
  release-note item, never as a test update.

## 5. The draw-consumption contract

Every operation consumes a **fixed, specified** number of draw indices. This is
load-bearing rather than incidental: every later value in a frame depends on
where the counter lands, and an implementation can return correct output while
leaving the counter in the wrong place — invisible to result-only parity tests.

| Operation | Indices consumed |
|---|---|
| `Random()` / `Random(Interval)` / `Random(Range)` / `Random(xs)` | exactly **1**, for every domain kind |
| `RandomChoice(domain, k)` | exactly **k** |
| `RandomSample(xs, k)` | exactly **k** |
| `RandomShuffle(xs)`, `n` elements | exactly **n − 1** (one per Fisher-Yates swap) |
| `k = 0`, or an empty result | **0** |
| any validation error | **0** — validation completes before the first draw |

Two rulings fall out of it:

- **No reservoir sampling anywhere in the family.** Algorithm R consumes one
  draw per element *visited* — a count-dependent number, which would make
  `Random(xs)`'s consumption depend on whether `xs` happens to be indexed.
  Non-indexed branches instead **count first** (`count` when defined, else one
  counting pass over `each()`; counting consumes **no** draws, because CE
  collections are re-iterable views), then draw exactly the promised number of
  indices, then make one targeted selection pass.
- **The counter is a u32**: the draw index is `next mod 2³²`, so a frame's
  stream has period 2³². Wraparound is documented, not an error — a single frame
  consuming four billion draws is outside any supported use.

### Draw order

`n` increments in **evaluation order**, which is dynamic, matching the scoping
rule:

- Control flow matters. `If(c, Random(), 0)` consumes an index only when the
  branch runs, and short-circuiting `And`/`Or` likewise.
- `Map` and comprehension bodies consume indices in iteration order: element
  *i*'s draws follow element *i−1*'s.

Consequence, stated rather than hidden: **editing a body so that it draws
earlier shifts every later draw in the same frame.** That is inherent to a
stream. It is also exactly why consumers should seed per row or per cell rather
than wrapping a whole document in one frame — see §9.

### Only evaluation consumes

**Draw indices are consumed by evaluation, and only by evaluation.** The engine
is free to *not* evaluate what it can prove it does not need, and in every such
case the counter does not advance:

- a branch not taken — `If(c, Random(), 0)` when `c` is false;
- a lazy view never materialized — `Map(xs, x |-> Random())` that nobody
  consumes (§6);
- a wrapper erased at **canonicalization** — `Count(RandomShuffle(xs))`
  canonicalizes to `Count(xs)`, because a count-preserving wrapper cannot change
  the answer, so the shuffle never runs and consumes **zero** draws. The same
  applies to `Length`/`IsEmpty`, and to `Contains` (which additionally erases
  `Unique`).

These are three instances of one policy, not three special cases. The practical
rule for consumers: **do not rely on a discarded expression's draws for counter
positioning.** An expression written only to advance the counter may be erased
before it ever runs; draw explicitly (`Random()`, or a fresh frame) instead.

## 6. Lazy collections draw at materialization

**Ruling (2026-07-25): draws happen at materialization, from whatever frame is
active *then*.**

`Map(xs, …).evaluate()` is a lazy view; its body draws when elements are
actually produced. A view created inside a frame but materialized after the
frame has exited draws from whatever frame is active at that later moment. This
is dynamic scoping applied consistently, not a defect.

A caller who wants framed values therefore **materializes inside the frame**:

```
WithRandomSeed(1, ListFrom(Map(Range(1, 3), x |-> Random())))   // replays
WithRandomSeed(1, At(Map(Range(1, 3), x |-> Random()), 1))      // replays
WithRandomSeed(1, Sum(Map(Range(1, 3), x |-> Random())))        // replays

ListFrom(WithRandomSeed(1, Map(Range(1, 3), x |-> Random())))   // LIVE draws:
                                                    // the view escaped the frame
```

**Trap**: `N()` over a lazy `Map` view does **not** force materialization — it
returns another lazy view, so the draws still happen later, outside the frame.
Use an operator that actually consumes the collection (`ListFrom`, an index, a
reducer such as `Sum`).

**`Comprehension` is a lazy view too** — and it is the shape the LaTeX
comprehension syntax parses to, so the trap is one keystroke away in a
document:

```
WithRandomSeed(1, [Random() for k = [1...6]])              // LIVE draws
WithRandomSeed(1, ListFrom([Random() for k = [1...6]]))    // replays
```

The bracket spelling reads like a list literal, but `[… for …]` builds a
`Comprehension`, whose body draws per element at materialization exactly as a
`Map`'s lambda does. It follows this section, not the "partial evaluation
keeps the frame" rule of §2: a `Comprehension` body is per-element work, not a
draw the enclosing evaluation owed (Tycho item 106). Its *clauses* are a
different matter — a clause collection is the view's source, the counterpart
of a `Map`'s source operand, so `Comprehension(k, Element(k,
RandomShuffle(Range(1, n))))` with `n` unbound does keep the frame.

### One instance, one draw set (element memo)

**Ruling (2026-08-02, Tycho item 126): the per-instance element memo applies
to IMPURE element bodies too.** The first complete walk of a lazy view
materializes its elements — drawing then, from whatever frame is active, per
the rule above — and later walks of the SAME instance are served from the
instance's element memo: same elements, no further draws. A distinct instance
(a re-parse, a re-box, a re-derived view) fills its own memo with fresh
draws.

This is the resolution of two principles that pull in opposite directions:

- **Site identity** (the CSE and hoisting guardrails): two `Random()` call
  sites are never merged into one draw. Compilation and simplification
  preserve *how many times the program draws*.
- **Value coherence**: a collection read twice is one value. Two readers of
  the same list — a plot and a mean — must see the same numbers. One call
  site read twice is ONE draw.

The memo delivers coherence as a consequence of memoization, not as a
special case for randomness.

**The coherence window is bounded by the memo's own invalidation.** The
element memo is a cache keyed on the engine's semantic-mutation state: any
semantic mutation (an `assign` — even to an unrelated symbol —, `assume`/
`forget`, a redefinition) invalidates it, and the next walk of a
random-bodied instance draws fresh values. "One instance = one draw set"
therefore holds *between semantic mutations*. It is a read-coherence
property, not replay determinism — for guaranteed replay, seed and
materialize inside a frame (`WithRandomSeed(s, ListFrom(…))`), exactly as
before.

## 7. Crossing the interpret↔compile boundary

Dynamic scoping has to survive compilation, or it silently becomes lexical at the
boundary: a compiled body would ignore the frame it is running inside and draw
live instead.

**The binding is an engine reference, not a frame handle.** There is exactly one
frame slot per engine, and both the interpreter and compiled code reach it
through the engine — one representation, not two kept in agreement.

- `makeSysHelpers(ce)` (`compilation/javascript-target.ts`) builds each compiled
  artifact's `_SYS` bundle **over the compiling engine**.
- `_SYS.drawNextRandomNumber()` delegates to `ce._random()` — the *same*
  primitive the interpreter uses. It resolves the engine's active frame **at call
  time**, advances that frame's counter, and returns `hash(seed, n)`; with no
  frame it returns `Math.random()`.
- Compiled `WithRandomSeed` emits `_SYS.withRandomSeed(seed, () => body)`, which
  is literally `withRandomSeedFrame(ce, seed, …)` — the same push/`finally`-pop
  as the interpreter, on the same slot.

One mechanism therefore covers all three cases:

| Case | Resolution |
|---|---|
| interpreted frame → auto-compiled `Map` body | the body calls `_SYS.drawNextRandomNumber()` and reads the interpreter's frame |
| compiled function called from inside an interpreted frame | the same; the frame is ambient, which *is* dynamic scoping |
| fully compiled frame, draws inside compiled calls | compiled `WithRandomSeed` pushes on the same slot; callees read it |

Nothing is threaded through signatures, so compiled function arity is unchanged.

Three rules the implementation must keep:

- **Framed-vs-unframed is decided at CALL time, never at compile time.** A
  function is compiled once and may later be invoked from inside a frame, so the
  compiler cannot know. Every compiled `Random()` emits
  `_SYS.drawNextRandomNumber()` unconditionally and *the helper* branches.
  Emitting a bare `Math.random()` because no frame happened to be active at
  compile time turns dynamic scope into lexical scope silently — it passes every
  other test and fails only the compile-once/call-framed-and-unframed probe.
- **Codegen may not reorder, batch, or elide draws.** Compiled bodies must
  consume indices in the same order and count as the interpreter, or the shared
  counter desynchronizes. Eliminating a repeated `Random()` as a common
  subexpression would be a correctness bug; `pure: false` on the random
  operators is what prevents it.
- **A call made outside any evaluation sees an empty slot** and draws live; two
  engines never share frames; nested compiled-calling-compiled artifacts of one
  engine share that engine's frame, which is what dynamic scoping requires.

**The unseeded arm is exempt from parity by design.** Outside a frame there is
no determinism to preserve, so compiled `Math.random()` and interpreted
`ce._random()` need not agree. There is no observable mismatch because there is
no expectation of one — the *absence* of a contract, not an exemption granted to
hide a difference.

### Domains compile to descriptors

A `Random`/`RandomChoice`/`RandomSample` domain lowers to a **descriptor**,
never to a compiled collection: a literal `Interval`/`Range` folds to inline
closed-form arithmetic, and a symbolic one builds a runtime `_SYS.domain*`
object. Compiling the domain as a collection would route a `Range` through the
JS `Range` handler, which materializes via `Array.from` — a million-element
allocation to draw three. `RandomSample` uses the same **sparse Fisher-Yates**
over the index space as the interpreter, so the two agree by construction.

Compiled code cannot raise the interpreter's structured errors, so a descriptor
that degenerates at runtime throws a plain `Error` naming the operator — never a
silent `NaN` and never a draw from a reversed range. The descriptor throws
exactly where the interpreter errors: a zero or sign-mismatched **explicit**
step, non-finite bounds, an unbounded or empty `Interval`. Note that
`Range(1, 0)` is *not* such a case — a two-operand `Range` infers a
**descending** step, so it is the two-element range `[1, 0]` and both engines
legitimately draw from it.

## 8. The GPU model, as implemented

A shader invocation cannot share a mutable counter cell with the host, and
fragments run in parallel, so a shared counter would be nondeterministic by
construction. **GPU frames are lexically inside the shader**: the seed is an
expression (typically invocation-varying), the counter is an invocation-local
u32 global (`var<private>` in WGSL, a `uint` global in GLSL) initialized before
the entry point runs, and every invocation runs each of its frames from `n = 0`.

This is not a compromise — it is how shader randomness already works. Per-pixel
seeding is `WithRandomSeed(perPixelSeed, Random())`, one frame per fragment.

| Form | GLSL | WGSL |
|---|---|---|
| `Random()` inside `WithRandomSeed` | `hash(seed, n)` | `hash(seed, n)` |
| `Random(Interval/Range)` inside a frame | arithmetic on the draw | same |
| `Random()` unframed | **fragment** stage: deterministic spatial noise (below); any other stage **throws** | **throws** — no `gl_FragCoord` |
| `Random(collection)` | **throws** — no general indexing | **throws** |
| `RandomChoice` / `RandomSample` / `RandomShuffle` | **throws** | **throws** |
| any draw whose only enclosing frame is on the **host** | **throws** at CE compile time | **throws** |

The last row is the cross-domain rule: a shader draw inside a *host* frame fails
closed, never a silent live draw.

The emitted preamble is the same PCG3D transcription (`_gpu_pcg3d`), with
`_gpu_rnd_draw(seed, n)` presenting `float(w.x >> 8u) * (1.0 / 16777216.0)` —
`2⁻²⁴` exactly — and advancing the caller's counter.

**ES 3.00+ is the baseline** (the GLSL target throws below `300 es`), so the
u32 ops are available; no WebGL1 fallback exists.

### Seed ABI

A shader has neither f64 nor strings, so the normative `foldSeed` cannot run
inside one. Which fold applies is decided by **where the seed value lives**:

| Seed form | Folding | Stream identity |
|---|---|---|
| compile-time constant (number or string — determined by `tryGetConstant` on the boxed value, so `Pi` folds the true f64, never a truncated emission string) | **host** `foldSeed`; `(seedLo, seedHi)` emitted as a `uvec2` / `vec2<u32>` constant | **identical** to the interpreted and JS stream for that seed |
| bare invocation-varying **symbol** (`perPixelSeed`) — not mapped through `vars` | **in-shader**: `seedLo = floatBitsToUint(seed)` (WGSL `bitcast<u32>`), `seedHi = 0u` | its **own** stream — deterministic given the seed bits, but *not* the stream a host f64 fold of the same real produces |
| computed seed **expression** (`x*100 + y`) | **compile error** — the seed source is spliced at every draw site, so once-evaluation cannot be guaranteed without statement emission. Hoist the computation into a varying/symbol and seed with that |
| seed mapped through the compiler's `vars` option | **compile error**, naming the unimplemented host-uniform ABI row (below) |
| a string computed at run time | impossible in a shader | **compile error** |

> **Not implemented: a host-provided uniform row.** The design sketched one more
> form — the host folds a seed and uploads a `uvec2` uniform per render, stream-
> identical to the host tier. No CE-controlled uniform plumbing exists. A seed
> mapped through the compiler's `vars` option therefore **fails closed** (2026
> review round: it previously fell through to the shader-computed fold and
> silently produced a different stream than the host — the one silent case in an
> otherwise loud boundary). A consumer that wants the host stream passes a
> **constant** seed at compile time.

`floatBitsToUint`/`bitcast` are exact bit reinterpretations, so a derived stream
is bit-deterministic *given the seed bits*. The seed **expression's** own f32
arithmetic remains subject to ordinary GPU float variance (GLSL ES float ops are
not IEEE-pinned). Determinism claims stop at the fold's input.

### Unframed GLSL draws are spatial noise — a stated exception

A `gl_FragCoord`-derived seed is stable for a fragment across renders, so an
unframed GLSL fragment draw is **deterministic spatial noise**, not the live
randomness §1 promises elsewhere: a shader has no clock to be live with. This is
the one documented exception to the liveness contract. Consumers who want time
variation pass a time uniform into a frame seed.

Two pins make it well-defined: both fragment coordinates are reinterpreted whole
(so there is no row-aliasing bound), and repeated unframed draws in one
invocation consume a shared invocation-local counter, so they decorrelate
instead of returning one value.

### Open: sibling-draw order on the GPU

GLSL and WGSL do not agree on operand evaluation order — WGSL pins left-to-right
evaluation, GLSL leaves it unspecified. So for two sibling draws in **one
expression** inside one GLSL frame, which one receives `n = 0` and which `n = 1`
is not pinned across drivers: `Random() - Random()` in one frame may differ in
*sign* between GPUs. The set of values drawn is fixed, and each draw is
individually deterministic; only the assignment of indices to sibling positions
is free. The host tiers, which evaluate left to right, have no such freedom.

The mutable-counter design is required regardless (a loop body must advance),
so this is a documented caveat awaiting a ruling rather than a defect with a
known fix. The caveat is repeated at `allocGPURandomCounter`
(`compilation/gpu-target.ts`).

## 9. Guidance: seed per cell, not per document

Two identical frames *anywhere* produce identical draws. That is the contract
consumers rely on, and it is also the thing that surprises someone who wraps two
cells in the same frame and finds them correlated.

The adoption shape that works:

- **One frame per row / per cell**, with a derived seed (`"cell-a7"`,
  `base + cellIndex`), never one frame around a whole document.
- Per-frame counters make this safe: adding, deleting or editing one cell cannot
  change another cell's values (§2).
- PCG3D was chosen partly because **adjacent seeds decorrelate**, so deriving
  seeds arithmetically is sound (§4).

The failure mode of the opposite arrangement is worth stating plainly: with one
document-wide frame, inserting a draw early in the document shifts every later
draw in it (§5). Nothing errors; every value below the edit simply changes.

For per-pixel GPU work the same rule applies one level down: one frame per
fragment, seeded from the fragment's own coordinates or index (§8).

## 10. Where the pieces live

| Piece | File |
|---|---|
| `pcg3d`, `pcg3dWords`, `frameDraw`, `foldSeed`, `RandomSeedFrame`, `MAX_RANDOM_ELEMENT_COUNT` | `src/compute-engine/numerics/random.ts` |
| `withRandomSeedFrame` | `src/compute-engine/boxed-expression/utils.ts` |
| the frame slot | `src/compute-engine/engine-runtime-state.ts`; `ce._randomFrame`, `ce._random()` in `src/compute-engine/index.ts` |
| `WithRandomSeed`, `Random`, `RandomChoice`, tombstones | `src/compute-engine/library/core.ts` |
| `RandomShuffle` | `src/compute-engine/library/collections.ts` |
| `RandomSample` | `src/compute-engine/library/statistics.ts` |
| shared `k` validation | `src/compute-engine/library/random-utils.ts` |
| `_SYS` random helpers, domain descriptors | `src/compute-engine/compilation/javascript-target.ts` |
| GPU frames, seed ABI, PCG3D preamble | `src/compute-engine/compilation/gpu-target.ts` |
| stability vectors | `test/compute-engine/random-vectors.test.ts` |
| GPU tier | `test/compute-engine/random-gpu.test.ts` |
