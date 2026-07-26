# Random family redesign — block-scoped seeding

**Status**: design ratified 2026-07-25 (revised three times: after the dual
spec review, after the `WithRandomSeed` direction change, then after a second
dual review round — 24 findings applied, see
`docs/scratch/2026-07-25-random-signature-redesign_SPEC_REVIEW.md`).
**Implemented 2026-07-25.** Where implementation reality diverged from the text,
the text is corrected in place and marked; the durable model reference extracted
from this plan is [`docs/RANDOMNESS-MODEL.md`](../RANDOMNESS-MODEL.md), and
§11 records what was learned while building it.

**Scope**: `WithRandomSeed` (new), `Random` (domain-only), `RandomChoice` (new),
`RandomSample`/`RandomShuffle` (renamed from `Sample`/`Shuffle`);
`RandomInteger`, `RandomList`, `RandomSeed` and the `ce.randomSeed` property all
removed. Plus the JS and GPU compile targets.

**No longer blocked.** An earlier revision needed intersection-signature support
from a parallel workstream, because `Random`'s seed and domain arguments had to
be told apart by overload. With seeding moved out of the argument list there is
nothing to disambiguate: a plain `((collection | set<real>)?) -> any` accepts
`Random()` and `Random(xs)` and rejects `Random(5)` and `Random(5, 7)` —
verified. That dependency is dropped.

(That workstream has since landed — commit `407c1e3c` — and overload sets now
validate and resolve return types correctly, verified. This design simply no
longer needs them.)

Two independent changes travel together: the **seeding redesign** (§2–§7) and an
**implementation fix** to `RandomSample`/`RandomShuffle` (§5). The second is a
pre-existing performance and OOM defect, not a consequence of the first, but
they touch the same operators.

## 1. Problem

`Random`'s first argument was a *seed* or a *bound* depending on the argument's
type (`library/core.ts:1690`), and seeding was spread across three unrelated
mechanisms. Reproduced against `main` at 0.94.0:

**P1 — meaning dispatches on the argument's numeric type.** Integer-typed →
bound, real-typed → seed. Nothing in the surface syntax signals which.

**P2 — the seed branch is unreachable for integral seeds.** `5.0` canonicalizes
to `5`, so an integral seed silently becomes a bound:

```
Random(5.0)  => 3        // bound, not seed 5
Random(0.5)  => 0.2725…  // seed
```

**P3 — the static type contradicts the runtime behavior.** The `type` handler
(`core.ts:1657`) branches on the *declared* type; `evaluate` (`core.ts:1690`) on
the *evaluated* operand. With `r: real` assigned `5`, `Random(r)` types
`finite_number` but evaluates through the integer branch, returning `3`.

**P4 — seed position is inconsistent.** Leading in `Random(seed)`; trailing in
`RandomList(n, seed)`, `Shuffle(xs, seed)`, `Sample(xs, k, seed)`.

**P5 — two seeded PRNGs.** `Random`/`Shuffle`/`Sample` use the GLSL fract-sin
hash (`numerics/random.ts:18`); `RandomList(n, seed)` and `ce.randomSeed` use
`mulberry32(hashSeed(…))`. So `Random(0.5)` → `0.2725…` while
`First(RandomList(1, 0.5))` → `0.1282…`, though both mean "the first draw from
seed 0.5".

**P6 — WITHDRAWN.** An earlier draft claimed the seed meant a pure value hash
for `Random` but a stream initializer elsewhere. Verified false:
`RandomList(3, 0.5)`, `Shuffle(L, 0.5)` and `Sample(L, 2, 0.5)` all replay
identically, and `RandomList(1, 0.5)` equals the first element of
`RandomList(3, 0.5)`. One rule covered the family; `Random(0.5) + Random(0.5) =
2 × 0.2725…` was that rule at `k = 1`, not a second meaning.

**P7 — bound conventions disagree.** `Random(m, n)` is upper-exclusive and does
not normalize reversed bounds (`Random(7, 2)` → `4`, drawing from `[3,7]`);
`RandomInteger(a, b)` is upper-inclusive and swaps.

**P8 — three seeding mechanisms, none composable.** `ce.randomSeed` (global,
host-only), the `RandomSeed(n)` operator (global, expression-level), and
per-operator seed arguments (local, per call). Nothing scopes; nothing nests.

**P9 — compiled draws ignore `ce.randomSeed`.** Compiled `Random()` emits a bare
`Math.random()`, bypassing the engine RNG. Verified: with `ce.randomSeed = 42`
re-asserted, interpreted replays `0.6405801123473793` every time while compiled
returns a different value every run. A compiled `Map` silently stops being
reproducible.

### How the redesign resolves them

| | Resolution |
|---|---|
| P1, P2, P3, P4 | No seed argument exists. The first operand is always a domain. |
| P5 | One generator (§4). **Every** draw in the family — `Random`, each position of `RandomChoice`/`RandomSample`, each swap of `RandomShuffle` — consumes the same counter-based stream (§4 draw-consumption contract). |
| P6 | Withdrawn — nothing to fix. |
| P7 | `RandomInteger` and `Random(m,n)` removed; ranges are `Range`, which normalizes. |
| P8 | One mechanism: `WithRandomSeed` frames, which nest. |
| P9 | Counter-based draws are computed identically interpreted and compiled (§7). |

## 2. The shape

Seeding moves out of the argument list entirely and becomes a **block-scoped
frame**.

```
WithRandomSeed(42, Random())                     // deterministic real in [0,1)
WithRandomSeed("cell-a7", (Random(), Random()))  // two DIFFERENT draws; block replays
WithRandomSeed(s, WithRandomSeed(t, Random()))   // nests; innermost wins

Random()                                         // unframed: live, nondeterministic
Random(Range(1, 6))                              // domain-only; no seed argument
```

Two consequences worth stating plainly, because they are the point:

- **Inside a frame, repeated draws differ, and the frame as a whole replays.**
  `WithRandomSeed(42, (Random(), Random()))` gives two different values, and gives the
  same two values every time. That is what a seed is normally understood to mean,
  and it is what the old `Random(0.5) + Random(0.5) = 2 × 0.2725…` did not do.
- **Outside a frame, randomness is live.** There is no ambient seed to set, so an
  unseeded draw is nondeterministic by construction — which is what an
  animation/ticker needs, and what seeding a global stream used to break.

### `WithRandomSeed(seed, body)`

| Property | Ruling |
|---|---|
| Seed type | `finite_real` or `string` — complex and non-finite literals are signature-invalid; runtime non-finite and symbolic seeds follow the §4 folding table. Folding is the normative two-word `foldSeed` (§4). |
| Scoping | **Dynamic** — the frame is active through user-function calls, not just lexically inside `body`. |
| Nesting | Allowed; **innermost frame wins** (a config shadows, per `docs/TIMEOUT-MODEL.md`'s "budgets compose, configs shadow"). |
| Counters | **Independent per frame.** A frame's *n*-th draw is `hash(seed, n)` regardless of nested frames — see below. |
| Seed evaluation | **Once per frame entry**, not per draw. |
| Laziness | `lazy: true` — `body` must not evaluate before the frame exists. |

Counters are per-frame, so a nested frame cannot perturb its parent:

```
WithRandomSeed(1, (
   Random(),               // hash(1, 0)
   WithRandomSeed(2, Random()),  // hash(2, 0)
   Random()                // hash(1, 1)  ← unaffected by the inner frame
))
```

This is what makes per-cell seeding safe for a document: adding or editing one
cell's inner frame cannot change another cell's values.

### The counter-based stream

> The *n*-th draw within a frame is **`hash(seed, n)`** — a pure function of the
> seed and the draw index, with no mutable stream state.

This is the load-bearing choice, and it buys four things at once:

1. **Interpreted/compiled bit-parity.** Both evaluate the same formula, so a
   compiled plot and an interpreted preview agree exactly. P9 disappears.
2. **GPU feasibility.** A fragment shader has no persistent stream and cannot
   carry mutable RNG state across invocations. It *can* compute `hash(seed, n)`.
   Block-scoped seeding would otherwise be unimplementable on WGSL.
3. **Reset-on-entry compiled semantics** falls out — a frame's counter starts at
   0 by definition.
4. **Frame independence** (above) is definitional rather than bookkeeping.

Two contracts this imposes, both requested by Tycho and both accepted:

- **Draws are IEEE float64 regardless of precision mode**, so parity survives
  high-precision evaluation.
- **The seed→stream mapping is stable across CE versions.** A silent hash change
  re-randomizes every stored document and churns render ground-truth corpora.
  Pin it with published test vectors (§8) and treat a change as breaking.

The unseeded arm is **exempt from parity by design**: outside a frame there is no
determinism to preserve, so compiled `Math.random()` and interpreted
`ce._random()` need not agree. There is no observable mismatch because there is
no expectation of one.

### Parity is tiered — the GPU cannot be bit-equal

"Bit-parity" cannot mean one number across all targets: GLSL and WGSL have **no
f64**, and GLSL ES float ops are not IEEE-pinned. Stating a flat bit-parity
contract would promise something no shader can deliver. The contract is
therefore tiered around the integer stream:

| Tier | Contract |
|---|---|
| **Canonical object** | the **integer stream** `hash(seed, n)` — uint32 ops, exact on ES 3.0 and WGSL |
| **f64 targets** (interpreted, JS) | bit-identical to each other; present the integer stream as f64 |
| **GPU targets** (GLSL, WGSL) | present the **same integer stream** as f32 via integer ops plus an **exact power-of-two conversion** — e.g. `(u >> 8) * 2^-24` — never through implementation-rounded float math. Holds for **host-folded seeds** (literals and host uniforms); a shader-computed seed derives its own stream — §7 GPU seed ABI |

So a GPU draw is deterministic across GPUs and derived from the identical
integer stream, diverging from the f64 tier by ≤2⁻²⁴ — a stated, bounded
difference rather than an unspecified one.

### The generator — PCG3D

Ratified 2026-07-25, after validation against the source paper. `hash(seed, n)`
is **PCG3D** (Jarzynski & Olano, *Hash Functions for GPU Rendering*, JCGT 2020,
§6 — <https://jcgt.org/published/0009/03/02/paper.pdf>), pure u32 operations:

```glsl
uint3 pcg3d(uint3 v)                    // verbatim, main paper §6
{
    v = v * 1664525u + 1013904223u;
    v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
    v ^= v >> 16u;
    v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
    return v;
}
```

The seed is **64 bits**, carried as two u32 words, so all three inputs vary —
the 3→3 configuration the paper actually benchmarked:

```
w0, w1, w2 = pcg3d(seedLo, seedHi, n)   // w2 unused

f64 tier  =  (w0 * 2^21 + (w1 >>> 11)) * 2^-53      // 53-bit mantissa
GPU tier  =  (w0 >>> 8) * 2^-24                      // exact, from w0 alone

seed folding:  foldSeed(seed) → (seedLo, seedHi); numeric → the two u32
               halves of the f64 bit pattern; string → two FNV-1a runs.
               Normative algorithm and constants in §4.
```

Widening the seed is free: `hashSeed` already computes the 64-bit intermediate
for numeric seeds (`setFloat64`, then `getUint32(0) ^ getUint32(4)`) and
currently **discards half the information** by xoring the halves together. Use
them as two words instead.

The two tiers therefore agree to within 2⁻²⁴ **by construction**, because the
f32 presentation is the top 24 bits of the same `w0` the f64 value is built
from — not by coincidence or tuning.

Why this one, against the constraints of §2:

- **No u64 anywhere.** Neither JS nor GLSL/WGSL has 64-bit integers, so a
  64-bit algorithm (SplitMix64, PCG64) would be *emulated on both sides* — two
  independent emulations of one algorithm is exactly where a cross-target
  bit-parity contract breaks. PCG3D is a transcription on each side, not a
  reimplementation.
- **Three words natively**, more than the f64/f32 split needs; a 32-bit
  finalizer would need two salted invocations whose independence we would have
  to argue rather than inherit.
- **Quality, per the authors' own measurements** (supplementary, p. 3): PCG3D
  fails **1** TestU01 BigCrush test. PCG2D fails **35**, PCG3D16 38, PCG4D 0.
  The paper's recommended spanning set for 2- and 3-input use is `iqint3,
  xxhash32 multibyte2, pcg3d, pcg4d` — PCG2D is deliberately not in it.
- **Adjacent seeds decorrelate**, which is what most hashes on this list fail:
  per-cell seeds are commonly derived (`base + cellIndex`), and the paper is
  explicit that chained PRNGs "may be great when used sequentially, but when
  used in parallel with neighboring seeds, they fall short."
- **Published and citable.** A third party must be able to reimplement this to
  verify a stored document; "CE's custom mix" is not a specification.

> **How this choice was arrived at, because the process matters more than the
> result.** An earlier revision of this spec specified PCG2D on recalled
> constants. Validation against the paper found the *constants* were correct —
> but that PCG2D fails 35 BigCrush tests to PCG3D's 1, and that the authors do
> not recommend it for this use. Local probes (10-bin χ², adjacent-seed
> correlation) score the two alike and **cannot distinguish them**; they rule out
> gross failure, nothing more. Trust the paper's test battery over any check
> written here, and transcribe constants from the source rather than from
> recall. Pin the constants, the operation order, and both presentation formulas
> with the §8 vectors in the same commit.

## 3. Target surface

| Form | Result |
|---|---|
| `WithRandomSeed(seed, body)` | `body` evaluated with a frame seeded by `seed` |
| `Random()` | real in `[0,1)` |
| `Random(Interval(a,b))` | real in `[a,b)` |
| `Random(Range(…))` | element of the range |
| `Random(xs)` | element of `xs` |
| `RandomChoice(domain, k)` | `k` draws, **with** replacement |
| `RandomSample(xs, k)` | `k` elements, **without** replacement |
| `RandomShuffle(xs)` | permutation |

Every draw above is live outside a frame and deterministic inside one. There is
no seed argument anywhere in the family.

Removed: `RandomInteger`, `RandomList`, `RandomSeed`, the `ce.randomSeed`
property, and every per-operator `seed` parameter.

## 4. Per-operator changes

### `WithRandomSeed` — new operator

```
signature: '(finite_real | string, any) -> expression'
type:      ([, body]) => body?.type ?? undefined   // body bound by `canonical` first — see below
lazy:      true
```

Mirror `HoldValues` (`core.ts:1423`), the most recent scoping operator: it is
`lazy: true` with a `canonical` handler for exactly the same reason — the body
must not evaluate before the frame exists — **and it carries the body's type
through**, which is the part an earlier draft of this spec omitted.

**The `type` handler is load-bearing, not cosmetic.** A bare
`-> expression` return makes a framed draw opaque, and D6's fail-closed rule
declines to compile comparisons and connectives when an operand may be a
collection. So `WithRandomSeed(s, Random()) < y` — any randomized inequality or
shaded-region row — would not be provably scalar and the whole predicate would
fall off the compile path. That is the item-86 failure class exactly. It also
stops `RandomChoice`'s `list<integer^3>`-style shaping from propagating through
a frame. `HoldValues` has the analogous handler (`core.ts:1439`) — but **do not
copy it blind**: probed on `main`, `ce.box(['HoldValues', ['Random']]).type` is
`unknown`, because on the box/parse routes the held body arrives **unbound**
with no resolved type to pass through. The `canonical` handler must
canonicalize the held body first (`op.canonical` — value-safe: binds structure,
substitutes no values) so the `type` handler reads a bound `body.type`, and the
acceptance tests are route-specific:
`ce.box(['WithRandomSeed', 42, ['Random']]).type` and its parsed equivalent
must both be `finite_real` **pre-evaluation**. Fix `HoldValues` the same way
while here — it has the same latent gap.

### Seed folding

`foldSeed(seed) → (seedLo, seedHi)`, both u32 — **normative**; pin it with the
§8 vectors. It replaces `hashSeed` (`numerics/random.ts`), which folds to a
single u32 by XORing the two halves — exactly the information loss §2 rejects —
and silently maps non-finite values to `0`. Do not reuse it.

| Seed | Ruling |
|---|---|
| finite real | write the f64 (`DataView.setFloat64`, **big-endian** — the DataView default); `seedLo = getUint32(0)` (high word), `seedHi = getUint32(4)` (low word). **No XOR.** `0.5` and `1234.5` decorrelate, and so do seeds differing only in low mantissa bits |
| `-0` | normalized to `0` before folding. The raw bytes differ (sign bit), but `-0 === 0` everywhere else in the language, so distinct streams would be a trap |
| `NaN`, `±∞`, complex | signature-invalid as literals (the `finite_real`-or-`string` signature); a seed **expression** that evaluates to a non-finite or non-real value is a **structured error** at frame entry, never a hash |
| symbolic — does not reduce to a literal at frame entry | the whole `WithRandomSeed` expression stays **symbolic/unevaluated**, mirroring the non-literal `k` rule in the validation table below |
| string | two FNV-1a runs over the **UTF-16 code units** (each 16-bit unit XORed whole, then multiplied by the FNV prime `16777619`): `seedLo` from offset basis `0x811C9DC5` (the standard 32-bit basis), `seedHi` from offset basis `0xCBF29CE4` (the high word of the 64-bit FNV basis `0xCBF29CE484222325`). Published, citable constants; §8 pins vectors including non-ASCII strings |

### Draw-index assignment

`n` is the draw index within the frame. The ordering that assigns it:

- **`n` increments in evaluation order** — dynamic, matching the scoping rule.
  Control flow therefore matters: `If(c, Random(), 0)` consumes an index only
  when the branch runs, and short-circuiting `And`/`Or` likewise.
- **`Map` and comprehension bodies consume indices in iteration order** —
  element *i*'s draws follow element *i−1*'s.
- **Lazy collections draw at materialization time, from whatever frame is then
  active** (ruled 2026-07-25). `Map(xs, …).evaluate()` is a lazy view; its body
  draws when elements are materialized. A caller who wants the values framed
  materializes inside the frame — with an operator that actually consumes the
  collection: `ListFrom`, an index (`At`), or a reducer such as `Sum`. (`N()` is
  NOT one — it returns another lazy view, so the draws still happen later.) A
  view created inside a frame but materialized after it draws from whatever
  frame is active *then* — dynamic scoping applied consistently, not a defect.
  The docs must show the materialize-inside-the-frame idiom.

Consequence worth documenting rather than hiding: **editing a body so it draws
earlier shifts every later draw in the same frame.** That is inherent to a
stream, and it is precisely why consumers should seed per-row or per-cell rather
than wrapping a whole document in one frame. The docs should steer that way
explicitly.

**Draw-consumption contract.** Every operation consumes a fixed, specified
number of indices. This is load-bearing: every later value in the frame depends
on it, and a compiled implementation can return correct output while leaving
the counter in the wrong place — invisible to result-only parity tests, which
is what §8's trailing-draw probes exist to catch.

| Operation | Indices consumed |
|---|---|
| `Random()` / `Random(Interval)` / `Random(Range)` / `Random(xs)` | exactly **1**, for every domain kind |
| `RandomChoice(domain, k)` | exactly **k** |
| `RandomSample(xs, k)` | exactly **k** |
| `RandomShuffle(xs)`, `n` elements | exactly **n − 1** (one per Fisher-Yates swap) |
| `k = 0` / empty result | **0** |
| any validation error | **0** — validation completes before the first draw |

Two rulings fall out:

- **No reservoir sampling anywhere in the family.** Algorithm R consumes one
  draw per element visited — a count-dependent number, which would make
  `Random(xs)`'s consumption depend on whether `xs` happens to be indexed,
  silently shifting every later draw in the frame. Non-indexed branches instead
  **count first** (`count` when defined, else one counting pass over `each()` —
  counting consumes **no** draws; CE collections are re-iterable views), then
  draw exactly the indices the table promises, then make one targeted selection
  pass.
- **The counter is a u32.** The draw index is `next mod 2³²`; a frame's stream
  has period 2³². Wraparound is documented, not an error — a single frame
  consuming four billion draws is outside any supported use.

**Only evaluation consumes** (ruled 2026-07-25): draw indices are consumed by
evaluation and only by evaluation, so the engine is free to not evaluate what it
can prove it does not need — a branch not taken, a lazy view never materialized,
or a count-preserving wrapper erased at canonicalization
(`Count(RandomShuffle(xs))` → `Count(xs)`, consuming **zero** draws) — and in
every such case the counter does not advance; consumers must not rely on a
discarded expression's draws for counter positioning.

### Frame stack

- **Pop on throw.** `withRandomSeedFrame` must restore the stack in a `finally`, or a
  body that throws leaks its frame into everything evaluated afterwards.
- **The stack belongs to the evaluation context, not the engine singleton.** CE
  evaluations can suspend (deadline and async paths), and an engine-global stack
  would cross-contaminate interleaved evaluations. Follow whatever discipline the
  existing scope stack uses; note that concurrent async evaluation on one engine
  is a known, deliberately-unfixed CE constraint, so the frame stack must not be
  the thing that makes it worse.

### Frames across the interpret↔compile boundary

Dynamic scoping has to survive compilation, or it silently becomes lexical at
the boundary — a compiled body would ignore the frame it is running inside and
draw live instead. Three cases, one mechanism:

1. An **interpreted** frame containing an **auto-compiled** `Map` body that
   draws. This is the §6 requirement, so it must work.
2. A **compiled** function called from interpreted code inside a frame.
3. A **fully compiled** frame whose draws happen inside compiled user-function
   calls — draw order is dynamic, so the counter must thread through call
   boundaries in emitted code.

**Ruling: a frame is a runtime object — `{ seedLo, seedHi, next }`, the counter
a mutable cell — and there is exactly one frame stack per engine, owned by the
engine's current evaluation context, which interpreter and compiled code both
reach through the engine.**

The naive reading ("pass a handle into compiled code") implies two frame
representations kept in agreement. Don't build that. **The binding is an engine
reference.** Today `makeSysHelpers()` builds each compiled artifact's `_SYS`
with no engine reference at all (`javascript-target.ts`); it becomes
`makeSysHelpers(ce)`, and `_SYS.drawNextRandomNumber()` resolves — **at call
time** — the owning engine's current evaluation context, reads the innermost
frame of its stack, advances the counter, and returns `hash(seed, n)`. Compiled
`WithRandomSeed` emits a prologue pushing onto that same per-engine stack and a
`finally` popping it — the same thing `withRandomSeedFrame` does interpreted.
The same engine reference is how `_SYS.sample`/`_SYS.shuffle` loops reach the
active deadline (§5): one binding, not two.

```
interpreted:  WithRandomSeed(42, Map(xs, x ↦ N(Random())))
                                   ↓ auto-compiles
compiled body calls _SYS.drawNextRandomNumber()
   → reads the interpreter's frame, advances its counter
```

One mechanism covers all three cases:

| Case | Resolution |
|---|---|
| 1 — interpreted frame → auto-compiled `Map` body | body calls `_SYS.drawNextRandomNumber()`, reading the interpreter's frame |
| 2 — compiled function called from an interpreted frame | same; the frame is ambient, which *is* dynamic scoping |
| 3 — fully compiled frame, draws inside compiled calls | compiled `WithRandomSeed` pushes onto the same stack; callees read it |

**Nothing is threaded through signatures**, so compiled function arity is
unchanged — which matters, because those functions are invoked from plot
evaluation and from consumer code.

Three consequences to implement carefully:

- **The stack lives on the evaluation context**, reached through the compiled
  artifact's engine reference at call time — never a module-level slot, which
  would be a process singleton cross-contaminating engines. Boundary cases this
  pins down: a compiled function invoked **outside any evaluation** sees an
  empty stack → live draw; **two engines never share frames** — an artifact
  compiled by engine A reads A's stack even if invoked while engine B is
  evaluating (frames are per-engine, like scopes); **nested
  compiled-calling-compiled** artifacts of one engine share that engine's
  stack, which is what dynamic scoping requires. The frame stack still inherits
  CE's existing, deliberately-unfixed constraint on concurrent async evaluation
  over one engine; it must not worsen that, and cannot independently fix it.
- **Codegen may not reorder, batch, or elide draws.** Compiled bodies must
  consume indices in the same order and count as the interpreter, or the shared
  counter desynchronizes. Eliminating a repeated `Random()` as a common
  subexpression would be a correctness bug — `pure: false` on the random
  operators is what prevents it, and is the second reason that flag stays after
  §6 stops using it as an eligibility gate.
- **Framed-vs-unframed is decided at CALL time, never at compile time.** A
  compiled function is compiled once and may later be called from inside a
  frame, so the compiler cannot know. Every compiled `Random()` therefore emits
  `_SYS.drawNextRandomNumber()` unconditionally, and *that helper* branches:
  active frame → `hash(seed, n)` and advance; no frame → `Math.random()`.
  Emitting a bare `Math.random()` because no frame existed at compile time is
  exactly the case-2 bug above — dynamic scope silently becoming lexical.

#### The GPU boundary is genuinely one-domain

A shader invocation cannot share a mutable counter cell with the host, and
fragments run in parallel, so a shared counter would be nondeterministic by
construction. **GPU frames must be lexically inside the shader**: the seed is an
expression (typically invocation-varying), the counter is a local, and every
invocation runs its own frame from `n = 0`.

This is not a compromise — it is how shader randomness already works. Per-pixel
seeding is `WithRandomSeed(perPixelSeed, Random())`, one frame per fragment
(the seed folds in-shader — §7 GPU seed ABI). What must
**fail closed** is the cross-domain case: a shader draw inside a *host* frame is
a compile error, never a silent live draw.

So Tycho's proposed one-domain rule holds exactly where it is physically true,
and the shared stack applies where it is not.

#### Implementation order

Parity vectors (§8) gate everything from step 3 on — they are what replaces the
eligibility gate deleted in §6.

1. Frame representation, stack on the evaluation context, `withRandomSeedFrame` with
   `finally`.
2. `_SYS.drawNextRandomNumber()` and the interpreter path. Get the §8 vectors green here, before
   any codegen exists to disagree with them.
3. Compiled `WithRandomSeed` prologue/epilogue against the same stack (case 3).
4. Auto-compile handoff (cases 1–2) — by then merely "do not clear the pointer".
5. GPU, lexical-only, cross-domain failing closed.

### LaTeX spelling

`\operatorname{WithRandomSeed}(seed, body)`. Pinned **here** rather than left to the
implementation, because it is a persistence surface exactly like the hash: stored
documents carry it, and consumers' re-serializing passes match on it. §8 requires
a parse → serialize → parse round-trip test citing this spelling.

**Implementation trap, from your own ledger:** a `lazy: true` operator's held
operands arrive **unbound**, so raw-`ce.box(…)` and `ce.parse(…)` input reaches
the evaluate handler with unresolved parse sugar while `ce.function(pre-boxed)`
works. The handler must canonicalize each held operand it consumes, and the test
suite must include **box-route and parse-route probes**, not only
`ce.function(...)`. A suite exercising one route misses this entire failure
class.

The frame stack is engine state pushed/popped around the body evaluation. The
internal helper mirrors `withValueShield` (`utils.ts:890`) — a plain function
taking `ce`, **not** public `ce.` API:

```ts
withRandomSeedFrame(ce, seed, () => { … })
```

A **LaTeX spelling that survives parse→serialize round trips** is required
(Tycho ask; re-serializing must be stable — see their `z`-rename lesson). Add
round-trip tests, not just parse tests.

### `Random` (`library/core.ts:1645`)

```
signature: '((collection | set<real>)?) -> any'
```

One plain signature — no overload set needed. Verified: it accepts `Random()`
and `Random(xs)`, and rejects `Random(5)` and `Random(5, 7)`.

The `type` handler derives the result from the domain:

```ts
type: ([domain]) => {
  if (domain === undefined) return 'finite_real';
  return collectionElementType(domain.type.type) ?? 'any';
}
```

Verified: `collectionElementType` returns `integer` for `Range(1,6)`, `number`
for `Range(0.5,2.5)`, `real` for `Interval`, `string` for a list of strings, and
the union for a mixed list. The seed branch that made P3 possible is gone
entirely, so there is no literal-vs-declared-type trap left here.

`sgn` must be rewritten: it currently reads `ops.every(x => x.isNonNegative)`
against numeric bounds, but `Range(1,10).isNonNegative` is `undefined` under
domain-first. Derive non-negativity from the domain's endpoints, and return
`'non-negative'` for the no-arg form.

`evaluate` branches, **in this order** — the two closed-form domains are
short-circuited before any collection machinery:

1. **No operand** → one draw from the ambient frame (or live if unframed).
2. **`Interval(lo, hi)`** → `lo + u * (hi - lo)`, i.e. **`[lo, hi)`**. Endpoint
   markers are **ignored** — a float draw cannot respect an open endpoint.
   Endpoints must be finite reals.
3. **`Range(…)`** → `first + step * floor(u * count)` over the range's
   *normalized* parameters. Do not re-derive them: reuse `range()` in
   `library/collections.ts`, which already infers a descending step for
   `Range(7,2)` (verified: count 6, first 7, last 2) and treats a zero or
   sign-mismatched step as empty (verified: `Range(5,1,1)` → count 0). There is
   no "swap reversed bounds" step.
4. **Finite indexed collection** → `xs.at(1 + floor(u * count))`.
5. **Finite non-indexed collection** → count-then-select: obtain the count
   (`count` when defined, else one counting pass — consumes no draws), draw
   **one** index, then one targeted traversal to that position. Never a
   reservoir (§4 draw-consumption contract).
6. Anything else → error.

**Never materialize.** Branch 4 must index, never `Array.from(xs.each())`.
`Shuffle` (`collections.ts:4410`) and `Sample` (`statistics.ts:735`) both
materialize; copying that here would turn `Random(Range(1, 1000000))` into a
million-element allocation for one draw. Verified: `.at()` on that range returns
`500000` without materializing.

**Domains that must error** (`out-of-range`, naming the domain kind):

- **Unbounded `Interval`** — `Interval(Open(-oo), 0)` is legal
  (`collections.ts:1326`); no uniform distribution exists.
- **Empty `Interval`** — test `.isEmptyCollection`, **never `count === 0`**.
  Verified: `Interval(1,0)` and `Interval(1,1)` both report `count: Infinity`
  with `isEmptyCollection: true`, so a `count` test would silently draw from a
  reversed or degenerate interval.
- **Infinite collection**, including an unbounded `Range`. Known from the type
  and bounds — not a reason to force a lazy collection.
- **Empty collection**.

**Non-flat domains.** `Random(matrix)` draws along the first axis — a *row*
(`List(List(1,2),List(3,4))).at(1)` is `[1,2]`). `Random(Tuple(…))` draws an
element, treating the tuple as an ordinary finite indexed collection —
deliberately unlike `Join`, where a tuple operand is one atomic element
(ratified 0.92.1). State the contrast in the docs.

### `RandomChoice` — new operator

```
signature: '(collection | set<real>, number) -> list<any>'
```

`k` independent draws from `domain`, **with replacement**. Domain-first,
matching `RandomSample`.

`k` is typed `number`, not `integer`: a caller who computes a count
(`Count(xs)/2`, a fitted value, `4N` where `N` is a slider) should not have to
round it first. **This directly satisfies a blocking Tycho requirement** — their
import runs before sliders bind, so a count that must type `integer` up front
cannot be satisfied by any correct document (3 corpus states affected). It is
rounded on evaluation: `toInteger` (`numerics.ts:186`) already applies
`Math.round`, half-toward-`+∞` (`2.5 → 3`, `-2.5 → -2`); non-finite or
unsafe-range values return `null` and error.

`RandomChoice` is `RandomSample`'s twin:

|  | with replacement | without replacement |
|---|---|---|
| `k` draws | `RandomChoice(xs, k)` | `RandomSample(xs, k)` |

Following Python (`random.choices`/`random.sample`) and Mathematica
(`RandomChoice`/`RandomSample`). Unlike `RandomSample`, `k` may exceed the
domain size — that is what replacement means.

**The source domain is never materialized; only the `k` drawn elements are:**

| Domain | How `k` draws are taken | Cost |
|---|---|---|
| `Range` / `Interval` | closed-form arithmetic — no indexing | O(k), independent of `n` |
| finite indexed | `k` independent `xs.at(1 + floor(u * count))` | O(k), independent of `n` |
| finite non-indexed | count first (`count`, else a counting pass — consumes no draws), draw `k` indices, then **one** `each()` pass keeping the selected positions with multiplicity | O(k) memory, O(n) time (two passes when the count needs one) |

With replacement there is **no bookkeeping between draws** — each is
independent, so `RandomChoice(Range(1, 10^9), 5)` touches nothing. The *result*
is an eagerly materialized list of `k` elements, which is the return value, not
a materialization of the domain. Eagerness is the draw-once contract inherited
from `RandomList` (Tycho item 76).

The `type` handler shapes the result with the domain's element type:
`RandomChoice(Range(1,6), 3)` → `list<integer^3>`. Keep the size cap and the
"zero count stays unshaped" rule from `core.ts:1751`.

**New operator**: follow the `add-operator` checklist, and set `pure: false` —
now the *sole* auto-compile gate (§6).

### `RandomInteger`, `RandomList`, `RandomSeed` — removed

- `RandomInteger(…)` → `Random(Range(…))`.
- `RandomList(n)` → `RandomChoice(Interval(0,1), n)`.
- `RandomSeed(n)` → `WithRandomSeed(n, …)` around the work.

`RandomList`'s compile machinery is **replaced, not ported**: the three-mode
structure at `javascript-target.ts:3410` (`makeRandomList`) is built entirely
on the bake machinery §7 deletes (`target.randomSeed`, `randomState.counter++`,
`mulberry32` streams), and none of its modes survives a world with no
compile-time seed — the only modes now are framed/unframed, decided per call
inside `_SYS.drawNextRandomNumber()`. `RandomChoice` gets a fresh handler over
that primitive; only the branch-on-domain-kind shape is worth keeping. The
item-80 tests (`tycho-item-80-randomlist-compile.test.ts`) pin baked behavior
and are rewritten to the new semantics (§8), not re-pointed. The draw-once
eagerness contract from item 76 carries over.

The size cap already carries the general name `MAX_RANDOM_ELEMENT_COUNT`
(`numerics/random.ts:16`, renamed by `e84b1114`); it now also caps
`RandomChoice`, `RandomShuffle` and `RandomSample`. No rename needed.

### `k` validation — `RandomChoice` and `RandomSample`

Domain validity is checked **first**, before any `k` test, and is defined **by
kind, never by `count`** — a bounded `Interval` reports `count: Infinity`, the
same trap flagged for `Random` above, and a count-based check would reject
`RandomChoice(Interval(0,1), n)`, the prescribed `RandomList` migration (§9).
The rules: for `RandomSample` and `RandomShuffle` the domain must satisfy
**`isIndexedCollection`** (the runtime gate behind the `indexed_collection`
signature type) — this excludes `Interval` **and** non-indexed collections
such as `Set`, while lazy indexed views pass (a `Filter` over a `Range`
reports `isIndexedCollection: true`, verified). For `RandomChoice`, an
`Interval` is valid iff its endpoints are finite and it is not
`isEmptyCollection` (closed-form draws), and any other collection is valid iff
finite and non-empty — indexed or not. An invalid domain
errors regardless of `k`. `k` is rounded before these checks. The `k = n` and
`k > n` rows apply to enumerable domains only — a continuous `Interval` has no
`n`, so `RandomChoice(Interval(…), k)` accepts any `0 ≤ k ≤ cap`.

| `k` (after rounding) | `RandomChoice` | `RandomSample` |
|---|---|---|
| non-literal / symbolic | stays symbolic (`undefined`) | stays symbolic (`undefined`) |
| non-finite / unsafe range | `out-of-range` error | `out-of-range` error |
| `k < 0` | `out-of-range` error | `out-of-range` error |
| `k = 0` | empty list | empty list |
| `0 < k ≤ n` | list of `k` | list of `k` |
| `k = n` | list of `k` | permutation |
| `k > n` | legal — repeats | `out-of-range` error |
| `k > cap` | `out-of-range` error | `out-of-range` error |

`k > n` legal for one and an error for the other is the observable difference
between the twins; test it directly. This **changes `RandomSample`'s behavior**:
today `Sample` returns `undefined` for `k < 0` and `k > n` (`statistics.ts:735`).

## 5. `RandomSample` and `RandomShuffle`

### `RandomSample` (`library/statistics.ts:725`) — renamed, seedless, and no longer materializing

```
signature: '(indexed_collection, number) -> list'
```

Without-replacement **semantics** are unchanged, matching Python's
`random.sample` and Mathematica's `RandomSample`.

"Without replacement" means each *position* is drawn at most once, **not** each
*value*. On a multiset, repeats are expected — `Sample(List(1,1,2), 2)` returns
`[1,1]` in about a quarter of trials, verified. This is why it is not called
`SampleUnique`/`SampleDistinct`: both names would guarantee something it does not
provide. Say so in the docs.

The implementation is replaced. Today it does `Array.from(xs.each())`, runs a
**full** Fisher-Yates over all `n`, and returns the first `k`. Measured:
`Sample(Range(1, 1000000), 3)` takes **303 ms** and allocates a million boxed
numbers to draw three; indexed access to the same range is ~0 ms. At larger
sizes this is an uncatchable heap-OOM (the item-64b class).

1. **Finite indexed** → **sparse Fisher-Yates**: partial Fisher-Yates for `k`
   steps over the *index space*, holding only touched positions in a
   `Map<number, number>` (absent key = identity position); read winners with
   `.at()`. O(k) time and memory.
2. **Non-indexed collection** (`Set`, …) → **invalid domain** — the §4 gate is
   `isIndexedCollection`. This narrows today's `Sample`, which materializes
   any finite collection via `Array.from`; the §9 tombstone already makes the
   head-level break loud, and the narrower domain travels with it.
   (`RandomChoice` still accepts non-indexed domains via count-then-select.)
3. **Infinite collection** → error (today: `undefined`).

Seeded output necessarily changes — but under this redesign every seeded call
site is being rewritten into a `WithRandomSeed` frame anyway, so there is no
before/after value to preserve.

### `RandomShuffle` (`library/collections.ts:4400`) — renamed, seedless, bounded

```
signature: '(indexed_collection) -> indexed_collection'
```

**The algorithm is deliberately left alone.** A permutation needs every element,
so materializing is correct and there is no sparse trick to apply. Two things
do carry forward explicitly: the existing `type` handler — `Shuffle`
(`collections.ts:4399`) narrows the result to `list<elementType>`, and losing
that in the rename would be a silent typing regression (result typing is
load-bearing for compile eligibility, §4) — and the §4 draw-consumption row:
exactly `n − 1` draws, one per Fisher-Yates swap, in both engines.

What it lacks is a guard: `Shuffle(Range(1, 10^9))` passes `isFiniteCollection`
and then tries to allocate a billion boxed numbers. Add what `RandomList` had
(`core.ts:1780`, `core.ts:1798`): refuse past the size cap with `out-of-range`,
and check the deadline.

### Deadline checks

**Every** O(k)/O(n) loop this redesign introduces or touches performs an
amortized `checkDeadline(ce._deadlineFrame)` every 1024 iterations: sparse
Fisher-Yates, the counting and selection passes of the count-then-select
branches, `RandomChoice` materialization, and `RandomShuffle`.

### Rename inventory

All verified present on `main`:

| Site | Change |
|---|---|
| `collections.ts:4400`, `statistics.ts:725` | rename definitions; `pure: false` already added |
| `javascript-target.ts:1141` | compile handler keyed `Shuffle:` → `RandomShuffle:` |
| `collections.ts:123` | `COUNT_PRESERVING_WRAPPERS` contains `'Shuffle'` |
| `collections.ts:124` | `MEMBERSHIP_PRESERVING_WRAPPERS` contains `'Shuffle'` |
| LaTeX dictionary | old-head aliases, including any lowercase `\operatorname{shuffle}` |
| `math-json/OPERATORS.json`, `CATEGORIES.json` | old-head entries |

`EXCLUDED_HEADS` is **already deleted** (2026-07-25) — the `pure: false` check
subsumed it, and a hardcoded name list drifts silently (it contained
`'RandomVariate'`, an operator that never existed). One fewer registry to keep in
sync during the rename.

## 6. Auto-compile eligibility — the gate is deleted

**Random draws inside a compiled `Map` are a requirement of this release**, not a
follow-up: Tycho's per-sample-point draws must stay in the hot path rather than
dropping to the interpreter.

That means `pure: false` can no longer gate auto-compile. The rationale it stood
on is gone anyway: unseeded, compiled `Random()` calls `Math.random()` per
element and matches the interpreter exactly; the real divergences were baking
under a compile-time `ce.randomSeed` and compiled code bypassing the engine RNG
(P9). **This redesign removes both causes** — `ce.randomSeed` ceases to exist,
and counter-based draws compute identically in both engines.

**Resolution: remove the purity check from `bodyEligible` entirely.**
Eligibility becomes the compiler's own D6 question — *can the target emit
semantically-equivalent code?* — answered by whether a handler exists. Nothing
is listed, flagged, or kept in sync.

Verified that the two categories separate cleanly:

| Operator | JS handler | Eligible |
|---|---|---|
| `Random`, `RandomList`→`RandomChoice`, `Shuffle`→`RandomShuffle` | yes | **yes** — parity by construction (§2) |
| `Sample`→`RandomSample` | **added by this spec** (§7) | **yes** |
| `Assume`, `RandomSeed`, `RandomInteger`, `RandomPrime` | none | no — fails closed |
| `Assign`, `Declare` | n/a | no — handled structurally before the check |

`pure: false` stays on every random operator: it is still the correct *semantic*
property and still feeds `isPure` → `isConstant`, which is what stops the engine
believing a shuffle of a literal list is constant. It simply stops doubling as a
compile gate. One property, one purpose — the same lesson that removed
`EXCLUDED_HEADS`.

**This makes D6 load-bearing.** With no purity backstop, a compile handler whose
semantics silently diverge from the interpreter would now slip through into
auto-compiled bodies. Every handler in the random family must therefore be
covered by the interpreted/compiled parity vectors of §8 — those tests are no
longer just a nicety, they are the thing standing in for the gate.

## 7. Compile targets

### JS target

- **Every `Random()` emits `_SYS.drawNextRandomNumber()`** — one emission, no
  compile-time branch. The helper decides at call time:

  ```js
  _SYS.drawNextRandomNumber = () => {
    const f = _SYS.frame;                   // innermost active frame, or null
    if (f === null) return Math.random();   // unframed → live
    return hash(f.seed, f.next++);          // framed → deterministic, advances
  };
  ```

  One compiled artifact does both, decided per call. Compiled with no frame in
  scope:

  ```js
  const f = compile(Random() + Random());

  f()                                     // Math.random() + Math.random()
  f()                                     // different again — nondeterministic

  withRandomSeedFrame(ce, 42, () => f())  // hash(42,0) + hash(42,1)
  withRandomSeedFrame(ce, 42, () => f())  // identical to the line above
  ```

  Called **outside** a frame: a live draw, no counter consumed, no frame state
  touched, and repeated calls differ — which is the ticker/animation case
  working correctly. Parity is trivially satisfied, because interpreted unframed
  `Random()` is also `Math.random()`: both engines are nondeterministic and
  there is no claim to break. That is what "the unseeded arm is exempt from
  parity" means — the absence of a contract, not an exemption granted to hide a
  difference.

  This is the point most likely to be "optimized" into a bug. It is tempting to
  emit a bare `Math.random()` when no frame is active at compile time — but
  whether a frame is active is a **call-time** property, and the same compiled
  function may later be invoked from inside an interpreted frame (§4, case 2).
  Deciding at compile time turns dynamic scope into lexical scope silently.

  The cost is one function call and a null check per draw instead of an inlined
  `Math.random()`. That is the price of the frame semantics; a JIT will inline
  the helper. Do not special-case it away.
- **The interpreter-side primitive is the same code path.** `ce._random()`
  (`index.ts:1044`) — today `this._rng ? this._rng() : Math.random()`, seeded
  from the removed `ce.randomSeed` — is redefined to the identical contract
  (innermost frame → `hash(seed, n)` and advance; no frame → `Math.random()`),
  and `_SYS.drawNextRandomNumber` delegates to it through the engine reference.
  Parity between engines is one function, not two kept in agreement. The
  `_rng` field, the `randomSeed` backing store, and `_randomNumericSeed()`
  (`index.ts:1050`, which existed solely to feed the bake path) are deleted.
- **No baking.** The bake path (`javascript-target.ts:1664`) and its
  `randomState.counter` machinery are deleted along with `ce.randomSeed`.
- Domains compile to **descriptors, never compiled collections**: `Interval` →
  inline `lo + u * (hi - lo)`, endpoints inlined; `Range` → integer arithmetic
  on `u` over the normalized `(first, step, count)`, literal bounds folded at
  compile time. No `Range` expansion in emitted code, ever — and the
  descriptor rule is why: the existing JS `Range` **collection** handler
  materializes via `Array.from`, so passing a compiled collection to a
  sampling helper would violate the §8 non-materialization tests. A literal
  list compiles to the JS array it already is.
- Other collection domains → fail closed (D6), stay interpreted.
- `RandomChoice` and `RandomShuffle` compile handlers are **rewrites** over
  `_SYS.drawNextRandomNumber()` — see the §4 "replaced, not ported" ruling;
  the existing `Shuffle` handler (`javascript-target.ts:1140`) and
  `makeRandomList` are built on the deleted bake machinery.
- **`RandomSample` gains a compile handler** — it has none today. Add
  `_SYS.sample(domainDescriptor, k, …)` alongside the existing `_SYS.shuffle`
  (`javascript-target.ts:1136`), implementing the same sparse Fisher-Yates as
  the interpreter (§5) so the two agree by construction rather than by
  coincidence.

All four random operators therefore compile. That uniformity is what lets §6
delete the eligibility gate: "has a handler" becomes a meaningful answer to
"can this be compiled", instead of an accident of which operators happened to
get one.

**Symbolic bounds degenerate only at runtime**: compiled code cannot raise the
interpreter's structured errors, so the runtime descriptor emits a plain `Error`
naming the operator. It must not silently return `NaN` or draw from a reversed
range.

> **Corrected 2026-07-25 (implementation).** An earlier revision stated the rule
> as "compiled `Random(Range(1,n))` with `n <= 0` throws". That is **wrong**, and
> would have broken parity: two-operand `Range` normalization infers a
> **descending** step, so `Range(1, 0)` is the two-element range `[1, 0]` and the
> *interpreter* legitimately draws from it (verified: `Random(Range(1,0))` → `0`
> or `1`). The implemented rule is parity-preserving — the descriptor throws
> **exactly where the interpreter errors**: a zero or sign-mismatched *explicit*
> step, non-finite bounds, an unbounded or empty `Interval`. A degenerate
> two-operand range is not one of those cases on either side.

### GPU target

`WithRandomSeed` is what makes shader randomness expressible: a fragment shader has no
persistent stream, but `hash(seed, n)` needs none.

| Form | GLSL | WGSL |
|---|---|---|
| `Random()` unframed | fragment shader: deterministic spatial noise (below); any other stage **throws** | **throws** — no `gl_FragCoord` |
| `Random()` inside `WithRandomSeed` | `hash(seed, n)` | `hash(seed, n)` |
| `Random(Interval/Range)` inside `WithRandomSeed` | arithmetic on `hash(seed, n)` | same |
| `Random(collection)` | **throws** — no general indexing | **throws** |
| `RandomChoice`/`RandomSample`/`RandomShuffle` | **throws** | **throws** |

The rule: **every unframed form throws on WGSL** (no stream, no fragment
coordinate); every framed `Interval`/`Range` draw compiles on both. This is
strictly better than the old design, where WGSL required an explicit seed
argument on every call site.

#### GPU seed ABI

A shader has no f64 and no strings, so the normative `foldSeed` (§4) cannot run
in a shader. Which fold applies is decided by where the seed value lives:

| Seed form | Folding | Stream identity |
|---|---|---|
| compile-time constant (number or string; `tryGetConstant` on the boxed value — post-review fix, so `Pi` folds the true f64, not the truncated emission string) | **host** `foldSeed`; `(seedLo, seedHi)` emitted as `uvec2` constants | **identical** to the interpreted/JS stream for that seed |
| ~~host-provided uniform~~ — **NOT IMPLEMENTED; fails closed** (post-review: a `vars`-mapped seed **throws** naming this row, instead of silently diverging) | ~~host folds, uploads a `uvec2` uniform per render~~ | ~~identical to the interpreted/JS stream~~ |
| bare invocation-varying **symbol** — `perPixelSeed`, not `vars`-mapped | **in-shader**: `seedLo = floatBitsToUint(seed)` (WGSL: `bitcast<u32>`), `seedHi = 0u` | its **own** stream — deterministic given the seed bits, but *not* the stream a host f64 fold of the same real produces. No contract is broken: an invocation-varying seed has no host counterpart to agree with |
| computed seed **expression** (`x*100 + y`) | **compile error** (post-review: the seed is spliced per draw site; once-evaluation cannot be guaranteed without statement emission — hoist into a symbol) |
| string computed at runtime | impossible in a shader — **compile error** |

`floatBitsToUint`/`bitcast` are exact bit reinterpretations, so the derived
stream is bit-deterministic **given the seed bits**; the seed *expression's*
own f32 arithmetic remains subject to ordinary GPU float variance (GLSL ES
float ops are not IEEE-pinned). Determinism claims stop at the fold's input —
say so in the docs. The §2 "same integer stream" tier contract applies to the
host-folded row, the only seed form that exists on both sides of the boundary.

> **Corrected 2026-07-25 (implementation): the "host-provided uniform" row was
> not built.** There is no CE-controlled uniform plumbing — nothing in the GPU
> targets uploads a `uvec2` seed uniform, and adding one means owning a
> render-time upload protocol the compiler does not currently have. A seed
> mapped through the compiler's `vars` option emits a *symbol name*, not a
> literal. **Post-review update (staged-review finding 7): that case now FAILS
> CLOSED** — it previously fell through to the shader-computed fold and
> silently produced a different stream than the host, the one silent case in
> an otherwise loud boundary; it now throws naming this ABI row and the two
> supported options. A consumer that wants the host-identical stream passes a
> **constant** seed at compile time. Building the uniform row is a separate
> piece of work, not a defect in this one.

#### Unframed GLSL draws are spatial noise — a stated exception

A `gl_FragCoord`-derived seed is stable for a fragment across renders, so an
unframed GLSL fragment draw is **deterministic spatial noise**, not the live
randomness §2 promises elsewhere — a shader has no clock to be live with.
Document it as the one exception to the liveness contract; consumers who want
time variation pass a time uniform into a frame seed. Two pins make it
well-defined:

- Repeated unframed draws in one invocation consume an **invocation-local u32
  counter** (`n = 0, 1, …` in execution order — a shader-local mutable), so
  they decorrelate instead of returning one value.
- The current emission is unconditional on shader stage
  (`gpu-target.ts:1773-1787` emits `gl_FragCoord` code whenever the language
  isn't WGSL): it gains a **stage check**, and an unframed draw in a GLSL
  *vertex* shader **throws at CE compile time** — matching WGSL's fail-closed
  behavior instead of emitting code that fails later at GPU shader-compile
  time.

**ES 3.0+ is the baseline**, so the counter-based hash's uint32 ops are
available. Confirmed: `glsl-target.ts:101` defaults `#version 300 es`, and the
shared GPU base declares the `uint`/`uvec` types (`gpu-target.ts:103-120`). No
WebGL1 fallback is needed. The two loose ends an earlier revision flagged here
— constraining the `version` parameter and removing stale ES 1.00 comments —
were **already fixed on `main` by `e84b1114`**: the GLSL target now throws on
versions below 300 (`glsl-target.ts:112`) and the misleading comments are
gone. Nothing remains to do.

## 8. Test plan

Rewrite (these pin behavior being removed): `a4-actions-random.test.ts`,
`random.test.ts`, `random-seed.test.ts`, `a1-c1-compile-parity.test.ts:221-263`,
`compile.test.ts`, `tycho-item-80-randomlist-compile.test.ts`,
`cortex/programs.test.ts`.

`WithRandomSeed`:

- `WithRandomSeed(42, (Random(), Random()))` — the two draws **differ**, and the whole
  block replays identically on re-evaluation. This is the headline behavior.
- String seeds: `WithRandomSeed("cell-a7", …)` deterministic; a different string gives
  a different stream.
- **Nesting**: the §2 example asserted exactly — an inner frame does not perturb
  the outer frame's subsequent draws.
- Innermost wins; frames survive **user-function calls** (dynamic scope), not
  just lexical nesting.
- Seed evaluated **once per frame entry** — a seed expression with an observable
  effect runs once, not per draw.
- **Box-route and parse-route probes** for every form. `WithRandomSeed` is
  `lazy: true`, so held operands arrive unbound and a `ce.function(…)`-only
  suite misses the failure class entirely.
- **LaTeX round-trip**: parse → serialize → parse is stable.
- Unframed `Random()` is nondeterministic (two evaluations differ) — the
  property that keeps tickers alive.
- **Typing**: `WithRandomSeed(42, Random())` types `finite_real` (not `expression`),
  and a framed draw inside a comparison — `WithRandomSeed(s, Random()) < y` — still
  JS-compiles. Without the `type` handler this predicate silently leaves the
  compile path (§4).
- **Seed identity**: two identical frames *anywhere* produce identical draws.
  Consumers rely on this (it is why per-cell seeds must differ), and it can
  surprise someone who wraps two cells in the same frame.
- **Pop on throw**: a body that throws restores the frame stack; a draw
  evaluated afterwards is unframed.
- Draw-index ordering (§4): `If(c, Random(), 0)` consumes an index only when the
  branch runs; a `Map` body consumes indices in iteration order.
- Seed folding (§4): `-0` and `0` give the **same** stream; a seed expression
  evaluating to `NaN`/`±∞`/complex is a structured error, not a shared
  zero-seed stream; a symbolic seed leaves the frame unevaluated; `foldSeed`
  itself is pinned — the `(seedLo, seedHi)` words for numeric and string
  seeds, including non-ASCII strings.
- **Draw-consumption probes** — every row of the §4 consumption table, for
  every operator: run the operation inside a frame, then compare a trailing
  `Random()` against the expected `hash(seed, n)`. This catches an
  implementation that returns correct output while consuming the wrong number
  of indices — invisible to result-only parity tests. Include: each `Random`
  domain branch consuming exactly 1; `RandomShuffle` consuming `n − 1`;
  validation errors and `k = 0` consuming 0.

**Stability vectors** (the cross-version contract):

- A committed table of `(seed, n) → value` for numeric and string seeds. Treat a
  diff here as a breaking change, not a test update — a silent hash change
  re-randomizes every stored document and churns render corpora.
- Draws are IEEE float64 **regardless of precision mode**: the same vectors hold
  under `precision = 'machine'` and high precision.
- **GPU vectors too.** The f64 table cannot validate the shader tier (§2). Pin
  the raw PCG3D words `(w0, w1)` for each `(seedLo, seedHi, n)`, the f32 presentation
  `(w0 >>> 8) * 2^-24`, and assert the GPU draw is within 2⁻²⁴ of the f64 draw —
  the stated bound, not an unspecified "approximately". Pinning the raw words
  (not just the presented floats) is what lets a third party verify a
  reimplementation against the paper.

`Random` / domains:

- `Random(Range(1,6))` inclusive at both ends; `Range(7,2)` descending;
  `Range(1,10,2)` odd values only; `Range(0.5,2.5)` drawing a **non-integer** and
  typing `number`.
- `Random(Interval(0,1))`, `Random(Interval(-5,-1))` — in range, typed `real`.
- `Random(List(…strings…))` returns a string and **types** as `string`.
- `Random(matrix)` draws a row; `Random(Tuple(1,2,3))` draws an element.
- `Random(5)`, `Random(5,7)` → **invalid** (signature rejects them).
- Empty/reversed `Interval(1,0)`, `Interval(1,1)` → error (the `count === 0`
  trap: these report `count: Infinity`).
- Unbounded `Interval`/`Range`, infinite collection, empty collection → error.
- Removed heads (`RandomInteger`, `RandomList`, `RandomSeed`, `Sample`,
  `Shuffle`) → assert the **tombstone throws**, naming the replacement. A test
  per head, since a missing tombstone reverts that head to silent-inert with no
  other signal.

Non-materialization — a spy on the domain's iterator that **fails if `each()` is
touched**, preferred over timing assertions:

- `Random(Range(1, 1000000))`, `RandomChoice(Range(1, 1000000), 1000)`,
  `RandomSample(Range(1, 1000000), 3)`.

`RandomChoice` / `RandomSample` / `RandomShuffle`:

- The §4 `k` table, both operators, every row.
- Non-integer `k`: `2.7 → 3`, `2.4 → 2`, `2.5 → 3`, `-0.4 →` empty list. Assert
  the half-way case; it is what a reimplementation gets wrong.
- **Distribution tests with objective thresholds** — the sparse Fisher-Yates is a
  rewrite of a correctness-critical algorithm and an off-by-one yields output
  that looks random but is biased. Pinned arrangement: **one** enclosing
  `WithRandomSeed(42, …)` frame, one continuous stream (never re-seeded per
  trial — that would replay a single value), 10,000 draws over a 5-element
  domain; each element's count within **±150 of 2,000** (≈3.7σ for a fair
  draw). Under a pinned seed the sequence is fixed, so the test is
  deterministic — the tolerance is a correctness band, not a flake margin.
- `RandomSample` draws each **position** at most once; separately assert with a
  pinned seed that `RandomSample(List(1,1,2), 2)` **can** return `[1,1]`.
- `RandomChoice` independence: **not** "no repeated value" (a correct draw may
  repeat) — use a pigeonhole assertion over `N > |domain|` draws under a fixed
  seed.
- The `isIndexedCollection` gate: `RandomSample(Set(1,2,3), 2)` and
  `RandomShuffle(Set(1,2,3))` → invalid domain; `RandomChoice(Set(1,2,3), 2)`
  is legal (count-then-select); a lazy indexed view (`Filter` over a `Range`)
  is legal for all three.
- `RandomShuffle` past the cap → `out-of-range`, not an OOM.
- All honor an enclosing `withTimeLimit`.

Compile:

- **Interpreted/compiled bit-parity for framed draws**, the central contract —
  and now doing the job the deleted eligibility gate used to do (§6). Cover
  **every** random handler: `Random`, `RandomChoice`, `RandomSample`,
  `RandomShuffle`, each with a framed seed, comparing compiled output to
  interpreted element by element. With no purity backstop, a handler that
  diverges silently reaches auto-compiled bodies; these tests are what stops it.
- The unseeded arm is exempt — assert that it is *not* required to match.
- **A `Map` body containing a framed draw compiles** (`stats.compiledHits`
  increments), which is the §6 requirement, and its values match the
  interpreter's.
- **Compile once, call framed and unframed** — the call-time-branch contract
  (§7). Compile a function containing `Random()` with **no frame active**, then
  call it (a) unframed → nondeterministic, and (b) from inside a
  `WithRandomSeed` frame → deterministic, matching the interpreter and advancing
  the frame's counter. A compiler that resolved the branch at compile time
  passes every other test in this plan and fails this one.
- A `Map` body containing `Assume` still falls back to the interpreter — the
  fail-closed path that replaces the purity gate.
- The full §7 GPU matrix, per language and per form — including the seed-ABI
  rows (host-folded literal/uniform vs shader-computed seed).
- **Cross-domain fail-closed**: GPU-compiling a draw whose only enclosing
  `WithRandomSeed` frame is on the host side throws at CE compile time (§4
  "The GPU boundary") — never a silent unframed draw. Likewise the GLSL stage
  check: an unframed draw compiled for a non-fragment stage throws (§7).
- A compiled domain that degenerates at runtime throws a plain `Error` naming
  the operator rather than returning `NaN`, and throws **exactly where the
  interpreter errors** — a zero or sign-mismatched explicit `Range` step,
  non-finite bounds, an unbounded or empty `Interval`. Not `Range(1, n)` with
  `n <= 0`: that normalizes to a descending range and both engines draw from it
  (see the §7 correction).

Docs: `doc/80-reference-arithmetic.md:457-505`,
`doc/03-guide-expressions.md:293`, and
**`docs/architecture/actions-and-randomness.md`**, which still documents
`Random(m,n) → [m,n)` and the old per-operator-seed forms (it never mentions
`ce.randomSeed` — verified, zero grep hits). Plus one **new** durable doc:
**`docs/RANDOMNESS-MODEL.md`** — the frame stack is a second engine-wide,
dynamically-scoped runtime mechanism alongside the deadline stack, and it gets
the treatment `docs/TIMEOUT-MODEL.md` gave time spans: the ratified model
(frames, `foldSeed`, the stream, the draw-consumption contract, the GPU seed
ABI) in one reference, pointed to from `ARCHITECTURE.md`.

## 9. Migration

Everything changes in one release, with no deprecation window.

### Tombstones — removed heads must throw, not go inert

Verified on `main`:

```
ce.box(['ZzzUnknownOperatorXyz', 1, 2])
  → isValid: true | evaluate() → ZzzUnknownOperatorXyz(1, 2)
```

An unrecognized head is a **valid, inert expression**. Simply deleting
`RandomInteger`, `RandomList`, `RandomSeed`, `Sample` and `Shuffle` would mean
every stored MathJSON document calling them silently stops producing randomness
and returns an unevaluated expression — the hardest failure class to notice,
because nothing errors and the document still renders.

**Ship a tombstone definition for each removed head, for one release**: a
definition whose `evaluate` throws

```
operator-removed: `Shuffle` has been removed — use `RandomShuffle`
```

Deleted next cycle. A few lines each, and it converts the entire silent class
into loud errors.

This is worth doing even though the redesign is otherwise a clean break, because
the "only adopter" argument is about the wrong population. CE is a **published
npm package**. Tycho may be the only consumer of the *seeded* forms, but
`Sample` and `Shuffle` are general-purpose operators any consumer may call, and
a third party has none of the same-cycle coordination Tycho does. Tycho's own
data point: their importer emits `RandomList`, `Sample`, and
`At(RandomList(1, seed), 1)` today, and a shipped onboarding template carries a
removed head — they survive only by agreement.

With tombstones in place, **every row of the migration table below fails
loudly**, and the unverified "Tycho is the only adopter" premise stops being
load-bearing for safety. It still matters for scheduling, not for correctness.

`ce.randomSeed` gets an **accessor tombstone** for one release: a
getter/setter that throws, naming `WithRandomSeed`. The TypeScript removal is
loud only for type-checked embedders — a plain-JS caller assigning to a
removed property on an extensible object **succeeds silently**, and randomness
quietly stops being seeded: exactly the silent failure class the operator
tombstones exist to prevent, closed for a few lines of code.

| Old | New | Fails how? |
|---|---|---|
| `Random()` | unchanged | — |
| `Random(0.5)` | `WithRandomSeed(0.5, Random())` | **loud** — invalid argument |
| `Random(n)`, `n > 0` | `Random(Range(0, n-1))` | **loud** — signature rejects a number |
| `Random(m, n)`, `m < n` | `Random(Range(m, n-1))` | **loud** — arity |
| `ce.randomSeed = s` | `WithRandomSeed(s, …)`, or `withRandomSeedFrame` internally | **loud** — accessor tombstone throws (plus TS error for typed embedders) |
| `RandomInteger(…)` | `Random(Range(…))` | **loud** — tombstone throws |
| `RandomList(n)` | `RandomChoice(Interval(0,1), n)` | **loud** — tombstone throws |
| `RandomList(n, seed)` | `WithRandomSeed(seed, RandomChoice(Interval(0,1), n))` | **loud** — tombstone throws |
| `Shuffle(xs)` / `Sample(xs,k)` | `RandomShuffle` / `RandomSample` | **loud** — tombstone throws |
| `Shuffle(xs, seed)` | `WithRandomSeed(seed, RandomShuffle(xs))` | **loud** — tombstone throws |
| `RandomSeed(s)` | `WithRandomSeed(s, …)` around the work | **loud** — tombstone throws |

Every row fails loudly: an error, a rejected signature, a TypeScript break, or
a tombstone throw. That is what the tombstones buy — without them the last six
rows are silent.

Note the `-1` on the `Random(n)`/`Random(m,n)` rows: those bounds were exclusive
and `Range` is inclusive. **The formulas hold only in their stated ranges** —
`Random(0)` returns the integer `0` today, but `Random(Range(0,-1))` draws from
the *two*-element descending range `[0,-1]`. Degenerate old calls (`n <= 0`,
`m >= n`) need hand rewriting; the release note must say so rather than offering
a formula that is wrong at the edges.

### Tycho

Tycho is the only adopter, and their doc (`../tycho/docs/COMPUTE_ENGINE.md`)
already argues for this design. Their asks and this spec's answers:

| Ask | Status |
|---|---|
| `WithRandomSeed` fully shadows; drop `ce.randomSeed` and per-operator seeds | **adopted** (§2) |
| seed is number\|string, FNV-1a for strings | **adopted** (§4) |
| dynamic scoping via a stack of seed frames | **adopted** (§2) |
| counter-based stream, `hash(seed, n)` | **adopted** (§2) — and it is what makes WGSL feasible |
| reset-on-entry compiled semantics | **adopted** — falls out of per-frame counters |
| interpreted/compiled bit-parity for framed draws only | **adopted** (§8); unseeded arm exempt |
| draws are IEEE float64 regardless of precision mode | **adopted** (§8) |
| seed→stream mapping stable across CE versions | **adopted** (§8 vectors) |
| seed evaluated once per frame entry | **adopted** (§2) |
| innermost frame wins | **adopted** (§2) |
| frames active through user-function calls | **adopted** (§2, dynamic scope) |
| LaTeX spelling surviving round trips | **adopted** (§4, §8) |
| count must accept `number`, not strict `integer` | **adopted** (§4) — unblocks 3 corpus states |

Their adoption plan (one `WithRandomSeed` per row; per-cell derived seeds, never one
shared document seed) works under independent counters — which is precisely why
that ruling matters: with a shared counter, two cells would perturb each other.

They also note a **hard ordering constraint**: their `RandomList(1, seed)[1]`
workaround must be retired in the *same* cycle as this release, and not before.

Their spec review (2026-07-25) raised ten findings; all are adopted. Two changed
rulings — the runtime frame handle (§4) and tombstones (§9) — and one corrected
a straight omission: `WithRandomSeed` had no `type` handler, which would have dropped
framed draws off the compile path inside comparisons (§4). Two items land on
*their* side, not CE's:

- **Probe their corpus for `random(L, n)` with `n > len(L)`.** Their lowering
  emits `Sample(L, n)`, and `RandomSample` turns today's `undefined` into an
  `out-of-range` error (§4 `k` table). If Desmos clamps, the clamp belongs in
  their lowering.
- **The "3 corpus states affected" figure** for the `k: number` typing is from
  their own doc; they should confirm which states during adoption.

> **"Tycho is the only adopter" is no longer load-bearing.** It was the sole
> safety justification for a no-window break while removed heads went silently
> inert. With tombstones, a third-party consumer gets a loud error naming the
> replacement instead of a document that quietly stops randomizing, so the
> premise now affects **scheduling only** — when to coordinate, not whether the
> release is safe. It remains unverified, and that is now acceptable.

## 10. Open items

1. **`Random(xs)` vs. `RandomChoice(xs, 1)`** — a docs gap, not a design
   conflict. Identical distribution; the wrapper is the only difference. Both
   stay. Fix with a cross-reference and one table:

   | | one draw | `k` draws |
   |---|---|---|
   | with replacement | `Random(xs)` | `RandomChoice(xs, k)` |
   | without replacement | `Random(xs)` | `RandomSample(xs, k)` |
   | all of them | — | `RandomShuffle(xs)` |

   **Closed 2026-07-25**: the table ships in `doc/80-reference-arithmetic.md`,
   with the cross-reference in both directions.

2. **GPU sibling-draw order is not pinned across drivers** (opened 2026-07-25
   by the implementation; **RULED 2026-07-25: accepted as a documented
   caveat** — no per-call-site indices, no refusal of multi-draw expressions;
   revisit only if a consumer reports it). GLSL leaves the evaluation
   order of an expression's operands unspecified — WGSL pins left-to-right —
   so for two sibling draws in **one expression** inside one GLSL frame, which
   one receives `n = 0` and which `n = 1` is driver-dependent:
   `Random() - Random()` in a single frame may differ in **sign** between GPUs.

   What *is* pinned: the multiset of values drawn, and each draw's own
   determinism. What is not: the assignment of indices to sibling positions.
   The host tiers evaluate left to right and have no such freedom, so this is
   also a (bounded) GLSL-vs-host divergence beyond the §2 2⁻²⁴ bound.

   The mutable invocation-local counter is **required** regardless — a loop
   body must advance the index, and a purely positional (lexical) index cannot
   express that — so this is not fixable by dropping the counter. The
   candidate fixes are all costlier: emit each draw into its own `let`/local
   in source order (needs statement emission, which a shader *expression*
   target does not have), or refuse multi-draw expressions on GLSL. Neither is
   worth doing before a consumer reports it. The caveat is repeated at
   `allocGPURandomCounter` (`compilation/gpu-target.ts`) and in
   `docs/RANDOMNESS-MODEL.md` §8.

*(The hash choice was open here; it is now ratified — see §2 "The generator".)*

Resolved during design, recorded so they are not re-opened:

- Per-operator seed arguments → replaced wholesale by `WithRandomSeed`.
- "Ten dice rolls" gap → `RandomChoice`. Briefly specced as a `RandomList`
  domain argument; reverted, because it collided with `Sample` on meaning and
  argument order.
- `Sample` vs `RandomChoice` naming → replacement carried by the name.
  `SampleUnique`/`SampleDistinct` rejected: without replacement is over
  positions, not values, so those names would be false on a multiset.
- `Random` prefix applied to the whole impure family.
- Folding `RandomShuffle` into `RandomSample(xs)` (Mathematica's design) →
  rejected: `k` and `seed` were both optional numbers. Moot now that seeds are
  gone, but the naming still stands on its own.
- `Interval` endpoint markers → ignored; draw is half-open.
- `Sample` materialization → sparse Fisher-Yates / count-then-select.
- `Shuffle` materialization → inherent to a permutation; bounded instead.
- `EXCLUDED_HEADS` → deleted; `pure: false` subsumes it.
- Overload-set signature dependency → dissolved with the seed argument.
- Reservoir sampling (`Random` branch 5, `RandomSample` non-indexed) → replaced
  by count-then-select so every operator consumes a fixed number of draws (§4
  draw-consumption contract).
- GPU seed handling → host-folded for compile-time constants
  (stream-identical), in-shader bit-reinterpretation fold for bare
  invocation-varying symbols (own stream); computed seed expressions,
  `vars`-mapped seeds, and runtime strings all **fail closed** (§7 GPU seed
  ABI, tightened in the staged-review round).
- `_SYS` frame binding → per-engine via `makeSysHelpers(ce)`, resolved at call
  time; never a module-level slot (§4, §7).

## 11. Implementation notes (2026-07-25)

What the build found, beyond the in-place corrections in §7 and §8 above.

### 11.1 A `.N()` double-draw defect — found and fixed

Building the parity vectors surfaced a **pre-existing** defect unrelated to
seeding: `Add` and `Multiply` were passing their **raw** operands to the numeric
kernels `addN`/`mulN` rather than the operands they had just evaluated. For a
pure operand that is only wasted work; for an **impure** one it is a second
draw. `N(Random() + Random())` therefore consumed **four** indices, not two —
each operand evaluated once for the symbolic pass and again inside the numeric
pass — which silently violates the §4 draw-consumption contract and desynchronizes
every later draw in the frame.

Fixed by threading the evaluated operands into `addN`/`mulN`. This is exactly
the failure class the trailing-draw probes of §8 exist to catch: the *values*
looked fine, only the counter was wrong.

The related lazy-materialization question raised during the same work is a
ruling, not a defect, and is already recorded in §4.

### 11.2 `compileShader` emitted no preamble — FIXED 2026-07-25

`GLSLTarget.compileShader()` / `WGSLTarget.compileShader()` assemble a complete
shader — `#version`, `precision`, `in`/`out`/`uniform` declarations, `void
main()` — but **never emit the helper preamble**. A shader produced this way
that uses any `_gpu_*` helper references a function it does not define, and
fails at GPU shader-compile time.

This is **not** new and not caused by the random work: it was true of every
`_gpu_*` helper (`_gpu_gcd`, the fractal helpers, …) before this redesign. The
random family simply adds `_gpu_pcg3d`/`_gpu_rnd_draw` and the per-frame counter
globals to the set of things that go missing, and the counter globals make it
slightly more visible because they must be declared at file scope.

The single-expression entry points (`compile()` / `compileToSource()`) are
unaffected — they return the preamble alongside the code, and the caller
concatenates.

**Fixed 2026-07-25** (same cycle, after review): the sniffing block that
derives the preamble from the emitted code was extracted into
`GPUTarget.preambleFor(code)`; `compileOrThrow` uses it for the
`CompilationResult.preamble` channel, and both `compileShader`s now compile
their body statements first, derive the preamble from the joined emissions,
and splice it after the declarations, ahead of the entry point. Pinned by the
"compileShader splices the helper preamble" block in `random-gpu.test.ts`
(framed draw + `Gamma` on GLSL, framed draw on WGSL, and a helper-free shader
gaining nothing). Note the known consumer (Tycho) uses the
`compile()`+`preamble` route exclusively and assembles shaders itself, so this
fix double-defines nothing for them.

### 11.3 What went as designed

Worth recording, because these were the risky parts:

- The **call-time branch** (§7) held: one compiled artifact, compiled with no
  frame active, draws live when called unframed and deterministically when
  called from inside a `WithRandomSeed` frame, advancing that frame's counter.
- The **`type`-handler-through-`canonical`** fix (§4) was needed exactly as
  predicted: without canonicalizing the held body, the box and parse routes
  read `unknown`. `HoldValues` had the same latent gap and got the same fix.
- **Domains as descriptors** (§7): no random path materializes a `Range`, in
  either engine.
- The **tombstones** (§9) are the only reason the removal is safe to ship in
  one release; each removed head throws `operator-removed` on the box, parse
  and `ce.function` routes alike.
