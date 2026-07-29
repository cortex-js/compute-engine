# Derived sub-streams — bringing the stochastic estimators under the seed frame

**Status**: design proposal, 2026-07-28. Not implemented. The one open
decision — how a sub-stream is identified (§3) — was **ruled 2026-07-28:
Option A, using the engine's `.hash` directly**, accepting that a future change
to the hash function shifts seeded estimates. The rest of the document is
awaiting implementation, not further design. Written after the purity-flag
audit of the random family (committed `6b15aced`), which is what surfaced the
gap.

**Scope**: `numerics/monte-carlo.ts` (Monte-Carlo integration) and
`boxed-expression/stochastic-equal.ts` (the sampled equality probe) — the two
remaining `Math.random()` call sites in the engine that are not part of the
random family and are not reached by `WithRandomSeed`. Plus the small
primitive both would share.

**Not in scope**: the random family itself (`Random`, `RandomChoice`,
`RandomSample`, `RandomShuffle`, `RandomPrime`), which already draws from the
frame; the GPU tier, which has no stochastic estimators; and
`library/random-expression.ts`, whose `RandomExpression` is a fuzzer harness
that deliberately owes the frame nothing (see §7).

Prerequisite reading: [`docs/RANDOMNESS-MODEL.md`](../RANDOMNESS-MODEL.md) §§1,
2, 4 — the frame mechanism, per-frame counters, and the draw-consumption
contract this proposal must not break.

---

## 1. Problem

`WithRandomSeed` promises, in §1 of the model note, that *"inside a frame,
repeated draws differ and the frame as a whole replays."* Two estimators break
that promise, because they sample `Math.random()` directly rather than
`ce._random()`.

### Witness 1 — Monte-Carlo integration

`monteCarloEstimate` is the fallback when adaptive Gauss–Kronrod quadrature
does not converge. Reached from `library/calculus.ts` (three sites: the
iterated-integral inner level, the `Integrate` numeric path, and the
semi-infinite path) and from the JS compile target's `_SYS.integrate` /
`_SYS.integrateMC`.

```
∫₀¹ sin(1/x) dx

  .N()                         →  0.50454 ± 0.00020
  .N()                         →  0.50426 ± 0.00020
  .N()                         →  0.50448 ± 0.00020

  WithRandomSeed(42, …).N()    →  0.50383 ± 0.00020
  WithRandomSeed(42, …).N()    →  0.50400 ± 0.00020   ← frame ignored
  WithRandomSeed(42, …).N()    →  0.50391 ± 0.00020
```

A document cell that integrates a hard integrand does not reproduce, even
seeded. This is the same class of defect as the `RandomPrime` framing bug
fixed in `6b15aced` — a stochastic result outside the frame's reach — but it
was not caught by the flag audit because `Integrate` carries no `drawsRandom`
declaration to contradict.

### Witness 2 — `stochasticEqual`

`stochastic-equal.ts:133` samples `NUM_RANDOM = 41` points per unknown, at
`(Math.random() - 0.5) * 2 * RANDOM_RANGE`, reached from `compare.ts:518`.
This one produces a non-reproducible **decision**, not just a
non-reproducible number: the probe returns `true` / `false` / `undefined`, and
which sample points it happens to draw determines whether a near-miss is
caught. A seeded document cannot replay an `isEqual` verdict.

### Why the obvious fix is wrong

Swapping `Math.random()` for `ce._random()` — the one-line fix that was
correct for `RandomPrime` — is **not** correct here, for one reason: volume.
`RandomPrime` consumes a handful of indices. Monte-Carlo integration consumes
**1e4 to 1e7**.

Routing those through the frame counter would mean:

- Adding, removing, or editing an integral inside a seeded block silently
  shifts every subsequent `Random()` draw in that block. §2 of the model note
  sells per-cell isolation precisely so that "adding or editing one cell's
  inner frame cannot change another cell's values"; this would reintroduce the
  same hazard *within* a cell.
- The §4 draw-consumption table — which states an exact count per operator
  (`Random` = 1, `Choice` = k, `Shuffle` = n−1) — becomes unstateable for
  `Integrate`, whose count depends on whether quadrature converged, on the
  sample budget (1e4 vs 1e7 vs 10e6 depending on the call path), and on
  whether the deadline truncated the loop.
- The deadline interaction is worse than cosmetic: `monteCarloEstimate` breaks
  out of its sampling loop when the deadline expires, so the number of indices
  consumed would depend on **wall-clock time**. A frame would stop replaying
  on a loaded machine.

That last point alone disqualifies the naive fix. Whatever we do must not let
the frame's own counter depend on timing.

---

## 2. Proposal — derived sub-streams

Introduce a **derived sub-stream**: a private counter-based stream whose seed
is deterministically derived from the ambient frame, and which consumes
**zero** indices from that frame.

```
frame  { seedLo, seedHi, next }         ← ce._randomFrame, unchanged
   │
   │  derive(seedLo, seedHi, tag)       ← pure; does NOT touch `next`
   ▼
substream  { seedLo', seedHi', n = 0 }  ← private, local to one estimator call
```

Properties this buys, mapped to the objections in §1:

| Objection | Resolved by |
|---|---|
| Adding an integral shifts later draws | The frame's `next` is **read, never advanced** |
| Draw count unstateable | The frame consumes **0** indices for an integral, in every path |
| Count depends on wall clock | Deadline truncation affects only the private counter |
| Estimator still non-reproducible | The sub-stream seed is a pure function of the frame seed and the tag |

Outside a frame the derivation returns `Math.random` unchanged. That is not a
concession — it is §1's ruling ("outside a frame, randomness is live") and §8's
("the unseeded arm is exempt from parity by design"). An unframed integral
stays stochastic, exactly as today.

### The primitive

In `numerics/random.ts`, beside `foldSeed` / `frameDraw` / `pcg3d`:

```ts
/** Successive uniforms in [0, 1). Deterministic when derived from a frame,
 *  live (Math.random) when derived outside one. */
export type RandomSubstream = () => number;

export function deriveSubstream(
  frame: RandomSeedFrame | undefined,
  tag: number
): RandomSubstream;
```

Framed: fold `(frame.seedLo, frame.seedHi, tag)` through `pcg3dWords` into a
fresh word pair, then hand back a closure over a private `n` that returns
`frameDraw(lo', hi', n++)`. Unframed: return `Math.random`.

`pcg3dWords` already takes exactly three u32 inputs and returns two words, so
the derivation needs no new hashing — this is the same primitive the frame
itself uses, applied one level up. Note the deliberate difference from the GPU
tier: `allocGPURandomCounter` allocates a counter *per frame* at compile time,
which is a different mechanism solving a different problem (no shared mutable
state in a shader). The only thing borrowed here is the shape — a private
counter rather than a shared one.

Engine accessor, mirroring `_random()`:

```ts
/** @internal */
_substream(tag: number): RandomSubstream {
  return deriveSubstream(this._runtimeState.randomFrame, tag);
}
```

---

## 3. What identifies a sub-stream — RULED

`tag` distinguishes one sub-stream from another within a frame.

> **Ruling, 2026-07-28: Option A, `tag = expr.hash`, using the engine's
> existing hash directly.** The hash-drift consequence spelled out below is
> **accepted**, not mitigated: a future change to `hashCode` or to any
> expression kind's hash is allowed to shift seeded estimates. No frozen
> serialization, no "never regenerate" banner on `.hash`. See §3.1 for what
> that means for tests.

### Option A — structural tag (RULED)

`tag = expr.hash` of the integral node (or of integrand + limits). `hash` is
already on the public expression type (`types-expression.ts:650`), implemented
per kind and memoized on `BoxedFunction` (`boxed-function.ts:226`); it is a
pure function of structure, so two separately-parsed copies of the same
integral agree (verified).

- `∫f` in a seeded cell yields the same estimate no matter what else is in the
  cell, and no matter where it sits in evaluation order. Full referential
  transparency; reordering-insensitive.
- Two *identical* integrals in one frame get identical sample points, so they
  return identical estimates. For a Monte-Carlo estimate of the same quantity
  this is arguably the correct answer, not a defect — but it does mean
  `∫f - ∫f` is exactly `0` under a frame, where today it is a small nonzero
  residual. That is a behavior change worth stating explicitly.
- Requires the tag to be available at the call site. The three `calculus.ts`
  sites have the expression; `_SYS.integrate` in the compiled tier does **not**
  (see §5) and would need a compile-time-baked constant.
- **`.hash` becomes load-bearing for seeded values.** Today it is an internal
  detail, free to change — nothing stored depends on its value. Feeding it into
  a seed means a future change to `hashCode`, or to how any expression kind
  builds its hash, changes every seeded estimate. **Accepted by ruling** (the
  alternative — a frozen serialization owned by this mechanism — was considered
  and declined; it buys stability across engine versions at the cost of a
  second, divergent notion of structural identity).

### Option B — allocation counter (declined)

Add a second counter `sub` to `RandomSeedFrame`, incremented per sub-stream
allocation; `tag = sub++`.

- Two identical integrals get independent sample points and therefore
  independent estimates with independent error — the textbook Monte-Carlo
  reading.
- Costs the property Option A buys: adding an integral *before* another one
  shifts the second one's sample points. Weaker than the status quo hazard
  (`Random()` draws stay unaffected either way), but it is the same *kind* of
  fragility, one level down.
- Trivially available everywhere, including the compiled tier.

Declined: a document model wants reproducibility and reordering-insensitivity
more than it wants two textually identical integrals to be statistically
independent. The `∫f - ∫f = 0` consequence is called out in
`RANDOMNESS-MODEL.md` rather than hidden.

### 3.1 What the accepted hash drift means in practice

The guarantee this mechanism provides is **replay within one engine build**,
not stability across builds. Three consequences follow, and they are the whole
practical content of the ruling:

- **No test may pin the numeric value of a seeded estimate.** A snapshot or an
  inline expectation like `expect(seededIntegral).toBe(0.50383)` would be a
  correct assertion today and a spurious failure the next time anyone touches
  a hash — with no defect behind it. Assert *properties* instead: two
  evaluations agree; two seeds differ; two positions of the same integrand
  agree. §9 is written this way and must stay that way.
- **The §8 stability vectors cover `deriveSubstream`, not the tag.** Pin
  `deriveSubstream(lo, hi, tag)` for fixed literal inputs — that is a real
  persistence surface, same as `foldSeed`. Do NOT pin `expr.hash` itself, and
  do not add the "never regenerate" banner to it: the ruling deliberately
  leaves it free.
- **A changelog note is owed whenever a hash change lands**, since it silently
  moves every seeded estimate. Cheap to write, and it is the only warning a
  consumer with stored values will get.

---

## 4. `monteCarloEstimate` — a public API constraint

`monteCarloEstimate` is exported from `src/numerics.ts`
(`export * from './compute-engine/numerics/monte-carlo.js'`), so it is part of
the published surface. Its signature is:

```ts
monteCarloEstimate(f, a, b, n = 1e5, deadline?): { estimate, error }
```

The sub-stream must therefore arrive as an **optional trailing parameter**, not
a replacement for `Math.random()` inside:

```ts
monteCarloEstimate(f, a, b, n = 1e5, deadline?, draw: RandomSubstream = Math.random)
```

Defaulting to `Math.random` keeps every existing external call
byte-for-byte identical in behavior, and keeps the change out of the breaking
section of the changelog. All four `sampler` closures and the 32-sample
all-non-finite probe then call `draw()` instead of `Math.random()`.

Note the probe loop consumes sub-stream indices too. That is correct and must
stay inside the sub-stream: it is part of the estimator's deterministic
behavior, and excluding it would make replay depend on whether the probe
happened to bail early.

---

## 5. Call sites

| Site | Has ambient frame? | Has a tag? | Notes |
|---|---|---|---|
| `calculus.ts` iterated-integral inner level | yes (`ce`) | yes | Inner levels of one integral should share **one** sub-stream, allocated at the outermost level — otherwise the count of sub-streams depends on the integrand's dimension |
| `calculus.ts` `Integrate` numeric path | yes (`ce`) | yes | The main witness |
| `calculus.ts` semi-infinite path | yes (`engine`) | yes | Falls through to `monteCarloEstimate` after the oscillatory attempt |
| `javascript-target.ts` `_SYS.integrate` | **no** | **no** | See below |
| `javascript-target.ts` `_SYS.integrateMC` | **no** | **no** | Same |
| `stochastic-equal.ts` sample loop | yes (`a.engine`) | yes (`a.hash ^ b.hash`) | Well-known points are already deterministic and stay outside the sub-stream |

### The compiled tier needs a structural change

`integrate` and `integrateMC` live on `SYS_HELPERS`, a **module-level** object
(`javascript-target.ts:3512`). They have no `ce` in scope, so they cannot reach
the ambient frame at all. Only `makeRandomHelpers(ce)` is per-engine, spliced
onto the prototype-derived object by `makeSysHelpers(ce)`
(`javascript-target.ts:3854`).

Bringing the compiled tier under the frame therefore requires moving
`integrate` / `integrateMC` out of the static prototype and into the per-engine
helper factory — the same move `drawNextRandomNumber` already represents. This
is mechanical but it is not a one-liner, and it is the reason the compiled tier
should be **phase 2** rather than part of the first cut.

The compiled tier additionally needs its tag **baked as a literal at compile
time**: `compileIntegrate` has the expression and can emit `expr.hash` into the
generated call, but the runtime helper cannot recover it. This is the one real
cost of the Option A ruling, and it lands entirely in phase 2 — steps 1–5 are
unaffected.

A knock-on worth noting before implementing phase 2: baking the hash means a
compiled artifact carries a seed derived from the expression it was compiled
from. Recompiling the same expression reproduces it (the hash is structural),
but an artifact cached across an engine upgrade that changed `hashCode` would
disagree with a freshly compiled one. That is the accepted drift of §3.1
reaching the compile cache; it is not a new decision, just a place it surfaces.

**Interpreter/compiler parity is not automatic here** and must be pinned by
test: an integral evaluated through `.N()` and the same integral through a
compiled artifact must produce the same estimate under the same frame, or the
"compiled and interpreted agree under a frame" contract of §8 is broken for
integrals specifically. Note the sample budgets already differ between the two
paths (1e4 / 1e7 / 10e6), so **parity here means "same sub-stream seed", not
"same value"** — the test must assert replay-within-a-path, plus that both
paths are deterministic, not that they agree numerically. This is worth
stating in the model note, because it is a weaker guarantee than the family's.

---

## 6. Purity and the flag surface

Neither estimator becomes `drawsRandom`. That flag means "consumes indices
from the ambient frame", which is exactly what a derived sub-stream does *not*
do — and `hasPendingImpureApplication` (`library/core.ts:147`) uses it to
decide whether a surviving application still owes the frame draws. An
`Integrate` that completed owes nothing.

`Integrate` also stays `pure: true`. Under a frame it becomes genuinely
reproducible, which is what purity claims; unframed it is stochastic, but so is
every unframed draw in the model, and `Integrate` is not alone in returning an
approximation whose low digits are not pinned.

`stochasticEqual` is reached from `compare.ts`, not from an operator handler,
so it has no flag surface at all.

One consequence to accept deliberately: under a frame, `isEqual` becomes a
reproducible decision. That is a strict improvement, but it means a
previously-flaky verdict becomes *consistently* wrong rather than
intermittently wrong, in whatever cases the sampling is too sparse. That is the
right trade — a reproducible wrong answer is debuggable — but it should not
arrive as a surprise.

---

## 7. What stays outside the frame

`RandomExpression` (`library/random-expression.ts`) keeps bare `Math.random()`
and keeps `drawsRandom: false`. It is a fuzzer harness that generates random
*expressions*, not a numeric estimator; it was marked `pure: false` in
`6b15aced` because it is nondeterministic, but it owes the seed frame nothing
and nothing in the model promises it replays. Bringing it in would be scope
creep with no consumer.

---

## 8. Implementation order

1. `deriveSubstream` + `RandomSubstream` in `numerics/random.ts`, with
   stability vectors in `random-vectors.test.ts` **for fixed literal
   `(lo, hi, tag)` inputs only** — the derivation is a persistence surface the
   moment anything replays through it, same argument as `foldSeed`, and the
   banner there applies: never regenerate. The tag itself is deliberately NOT
   pinned (§3.1).
2. `ce._substream(tag)`.
3. `monteCarloEstimate` gains the optional trailing `draw` parameter,
   defaulting to `Math.random` — no behavior change on its own.
4. The three `calculus.ts` sites pass `ce._substream(tag)`. **Witness 1
   replays after this step**, for the interpreted path.
5. `stochastic-equal.ts` passes a sub-stream. Witness 2 replays.
6. *(Phase 2)* Move `integrate` / `integrateMC` into the per-engine helper
   factory and thread the sub-stream through the compiled tier.

Steps 1–5 are independently shippable and leave the compiled tier exactly as
it is today. Step 6 is where the structural cost sits.

## 9. Tests owed

Every assertion below is a **property**, never a pinned numeric value — see
§3.1. A test that hardcodes what a seeded integral evaluates to would be
correct on the day it was written and a false alarm the next time a hash
changes.

- Replay: the §1 witness (`∫₀¹ sin(1/x)`) returns bit-identical values across
  repeated evaluations under one seed, and different values under different
  seeds. Compare the two evaluations to *each other*; do not write the number
  down.
- Isolation (the whole point): `WithRandomSeed(s, (Random(), ∫f, Random()))`
  yields the **same two draws** as `WithRandomSeed(s, (Random(), Random()))`.
  This is the assertion that fails under the naive `ce._random()` fix and is
  therefore the one that proves the design.
- Deadline independence: the same integral replays under a frame when the
  sampling loop is truncated by a short `withTimeLimit`, i.e. a truncated
  estimate is still deterministic and still consumes zero frame indices.
- Unframed liveness: outside a frame, repeated evaluation still varies.
- `stochasticEqual`: a seeded `isEqual` verdict replays.
- Public-API compatibility: `monteCarloEstimate` called with the old
  five-argument signature behaves as before.
- The Option A property: `∫f` at two different positions inside one frame
  agree, and agree with the same integral evaluated in a frame whose other
  contents differ. This is what the structural tag buys and the counter option
  would not.
- Hash-drift tolerance, as a guard on ourselves: the suite must still pass if
  `hashCode` is perturbed. Worth confirming once by hand during
  implementation — if any test fails under a perturbed hash, it pinned a value
  it should not have.
