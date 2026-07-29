# Derived sub-streams — bringing the stochastic estimators under the seed frame

**Status**: **COMPLETE.** Steps 1–5 implemented 2026-07-28 — the interpreted
path is done and both §1 witnesses are fixed. Step 6 (the compiled tier) was
**declined 2026-07-29**: compiled integrals sample live even inside a frame,
as a ruled exception rather than an open item. The reasoning is in §5.1. There
is no outstanding work in this document.

The tag decision (§3) was **ruled 2026-07-28: Option A, using the engine's
`.hash` directly**, accepting that a future change to the hash function shifts
seeded estimates.

Written after the purity-flag audit of the random family (committed
`6b15aced`), which is what surfaced the gap.

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
| `javascript-target.ts` `_SYS.integrate` | **no** | **no** | NOT WIRED — ruled, §5.1 |
| `javascript-target.ts` `_SYS.integrateMC` | **no** | **no** | NOT WIRED — ruled, §5.1 |
| `stochastic-equal.ts` sample loop | yes (`a.engine`) | yes (`a.hash ^ b.hash`) | Well-known points are already deterministic and stay outside the sub-stream |

### Why the compiled tier could not be wired cheaply

Recorded because it is the background to the §5.1 ruling, and because anyone
revisiting that ruling needs it.

`integrate` and `integrateMC` live on `SYS_HELPERS`, a **module-level** object
(`javascript-target.ts:3512`). They have no `ce` in scope, so they cannot reach
the ambient frame at all. Only `makeRandomHelpers(ce)` is per-engine, spliced
onto the prototype-derived object by `makeSysHelpers(ce)`
(`javascript-target.ts:3854`). Wiring them would mean moving both out of the
static prototype into the per-engine factory — the move `drawNextRandomNumber`
already represents.

They would additionally need the tag **baked as a literal at compile time**:
`compileIntegrate` has the expression and could emit `expr.hash` into the
generated call, but the runtime helper cannot recover it.

And baking the hash would give a compiled artifact a seed derived from the
expression it was compiled from. Recompiling the same expression reproduces it
(the hash is structural), but an artifact cached across an engine upgrade that
changed `hashCode` would disagree with a freshly compiled one — the §3.1 drift
reaching the compile cache.

None of this is prohibitive on its own. It is the nested-restart problem in
§5.1, not this plumbing, that decided the ruling.

### 5.1 The compiled tier stays live — RULED

> **Ruling, 2026-07-29: step 6 is declined.** An integral inside a compiled
> artifact samples `Math.random()` even within a `WithRandomSeed` frame. This
> is a deliberate, documented exception to the interpreted/compiled bit-parity
> claim of `RANDOMNESS-MODEL.md` — the second one, after the GPU tier — not a
> deferred task. A seeded integral that must reproduce is evaluated, not
> compiled. The finding that motivated the ruling follows.

The verified split:

```
∫₀¹ sin(1/x) dx, seed 42, twice

  interpreted  .N()      →  0.50426 ± 0.00020   0.50426 ± 0.00020    replays
  compiled     compile() →  0.50404             0.50405             does not
```

**Why not simply fix it.** The naive fix is worse than the status quo, which is
the crux of the ruling.

The interpreted path allocates **one** sub-stream in `nIntegrateMultiple` and
threads it through every level, so the stream keeps advancing as the inner
estimator is re-run once per outer quadrature node. Compiled code has no such
place to put it: `compileIntegrate` emits one **independent** `_SYS.integrate`
call per limit, and the inner one is invoked afresh at every outer node.

If each call derives its own sub-stream from its tag, the inner estimator
restarts at `n = 0` on **every** outer node — sampling the identical points
each time. That is not merely a different stream; it changes the numerics. The
inner estimate's error stops being independent noise across nodes and becomes a
fixed offset, which the outer quadrature then integrates as if it were signal.
Today's `Math.random()` does not have this problem (it never restarts), so
shipping the naive version would make framed nested integrals *numerically
worse* while making them reproducible — a bad trade made silently.

Three ways out were considered, and **all three were declined**:

- **Thread the sub-stream through generated code.** The outermost call
  allocates and passes a handle down to the nested calls (something like
  `_SYS.integrateNest(tag, (sub) => …)`). Faithful to the interpreter, but it
  changes the shape of the emitted code and adds a helper — too much machinery
  for the exposure below.
- **Memoize per frame.** Keep one sub-stream per `(frame, tag)` in a
  `WeakMap` keyed on the frame object. Simple — but it **breaks the Option A
  property**: the second of two identical integrals in one frame would continue
  the first one's stream instead of repeating it, which is exactly the
  reordering-insensitivity §3 was chosen for. Rejected outright.
- **Bring only the single-limit compiled case under the frame** (it has one
  call, so no restart problem), leaving nested compiled integrals live.
  Cheapest, and offered — but declined, because it makes framedness depend on
  the integrand's dimension, which is harder to explain than a clean tier
  boundary.

**Why the exposure is small enough to accept.** A smooth integrand never
reaches the stochastic estimator in compiled code at all: `∫₀¹ x² dx` folds to
the literal `0.3333333333333333` at compile time, and anything else smooth
converges under deterministic Gauss–Kronrod (GK15). Monte Carlo is reached only
on a pathological integrand, or when `quadrature: 'monte-carlo'` is explicitly
requested.

**The residual sharp edge, stated plainly.** Because only hard integrands fall
through, the non-reproducibility appears exactly when a user's integrand
happens to be difficult — which from their side is unpredictable. Someone who
moves a working seeded computation into `compile()` for speed, or edits an
integrand until it stops converging, loses replay with no diagnostic. That is
the accepted cost. `RANDOMNESS-MODEL.md` carries the guidance that pays it
down: a seeded integral that must reproduce is evaluated, not compiled.

Consequently there is **no interpreted/compiled parity test for integrals**,
and none should be added: the tiers are not expected to agree here. (Even if
step 6 were ever revisited, parity would mean "same sub-stream seed", not "same
value" — the sample budgets already differ between the paths at 1e4 / 1e7 /
10e6.)

---

## 6. Purity and the flag surface

Neither estimator becomes `drawsRandom`. That flag means "consumes indices
from the ambient frame", which is exactly what a derived sub-stream does *not*
do — and `hasPendingImpureApplication` (`library/core.ts:147`) uses it to
decide whether a surviving application still owes the frame draws. An
`Integrate` that completed owes nothing.

**But one that did NOT complete does** (found in review, 2026-07-29). The
sub-stream is derived when the estimator actually runs, so an estimator left
unevaluated — `NIntegrate(f, 0, n)` with `n` unbound — is completed later,
against whatever frame is active *then*. With the gate keyed on `drawsRandom`
alone, `WithRandomSeed` stripped its wrapper and the deferred completion
sampled live: `e.evaluate().subs({n:1}).N()` drifted run to run while
`e.subs({n:1}).N()` was stable — the seeded→unseeded conversion of item 104,
for estimates instead of draws.

The fix is a second flag, `readsRandomFrame`, meaning **"reads the frame,
consumes no indices"**. `Integrate` and `NIntegrate` carry it;
`hasPendingImpureApplication` keeps the frame for either flag. It is
deliberately NOT spelled `drawsRandom: true`, which would also make an
estimator consume indices and shift every sibling draw — the property §5 pins.
`inferLambdaFlags` propagates it, so `g(u) := NIntegrate(…, 0, u)` keeps the
frame too; unlike `drawsRandom` it does **not** imply `pure: false`, since a
framed estimate is reproducible, which is what `pure` claims.

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

Cross-reference (2026-07-28): `docs/EFFECTS-MODEL.md` (v3) adopts this
section's ruling as its normative **noise-floor convention** —
nondeterminism confined below the reported error bound of an approximation
is approximation error, not an effect.

---

## 7. What stays outside the frame

`RandomExpression` (`library/random-expression.ts`) keeps bare `Math.random()`
and keeps `drawsRandom: false`. It is a fuzzer harness that generates random
*expressions*, not a numeric estimator; it was marked `pure: false` in
`6b15aced` because it is nondeterministic, but it owes the seed frame nothing
and nothing in the model promises it replays. Bringing it in would be scope
creep with no consumer.

Cross-reference (2026-07-28): `docs/EFFECTS-MODEL.md` (v3) adopts this
ruling — an earlier draft's proposal to migrate `RandomExpression` onto the
stream was withdrawn in its favor — and represents this state as the
`entropy` effect label: impure, not frame-owing, not replayable.

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
6. ~~*(Phase 2)* Move `integrate` / `integrateMC` into the per-engine helper
   factory and thread the sub-stream through the compiled tier.~~
   **DECLINED 2026-07-29 — see §5.1.** Compiled integrals sample live, by
   ruling. Do not implement this without revisiting that ruling first.

Steps 1–5 shipped and leave the compiled tier exactly as it was.

## 9. Tests — as built

In `test/compute-engine/derived-substreams.test.ts`, with the `deriveSubstream`
stability vectors in `random-vectors.test.ts`.

Every assertion is a **property**, never a pinned numeric value — see §3.1. A
test that hardcodes what a seeded integral evaluates to would be correct on the
day it was written and a false alarm the next time a hash changes.

**Two corrections to what this section originally planned**, both found while
building it:

- **Deadline behavior is not what was assumed.** The plan said a short
  `withTimeLimit` truncates the estimate, which then still replays. It does
  not: the budget is enforced by **throwing**, and where the sampling loop
  *does* truncate, the sample count varies, so the estimate genuinely does not
  replay. Only the frame's untouched counter is invariant. The test now
  asserts the real property — that the estimator's draw count is
  deadline-dependent, which is precisely *why* those draws must not be charged
  to the frame — against `monteCarloEstimate` directly.
- **Cost forced a cheaper witness.** A real Monte-Carlo integral is seconds
  (1e7 samples once the integrand compiles); an iterated one is effectively
  unbounded. The suite uses an integrand that is non-finite everywhere
  (`√(−1−x²)`), which reaches the estimator and derives its sub-stream, then
  bails at the 32-sample viability probe — same wiring, ~18ms. The full-cost
  `∫₀¹ sin(1/x)` witness is kept as a single `it.skip` with instructions. Two
  traps are recorded in the test file's header: never put a real or iterated MC
  integral in that file, and never spy on `_substream` by assigning to the
  engine **instance** (it changes the object's shape and costs the engine its
  fast paths — it took the file from ~5s to ~26s; patch the prototype instead).

- Replay: the §1 witness (`∫₀¹ sin(1/x)`) returns bit-identical values across
  repeated evaluations under one seed, and different values under different
  seeds. Compare the two evaluations to *each other*; do not write the number
  down.
- Isolation (the whole point): `WithRandomSeed(s, (Random(), ∫f, Random()))`
  yields the **same two draws** as `WithRandomSeed(s, (Random(), Random()))`.
  This is the assertion that fails under the naive `ce._random()` fix and is
  therefore the one that proves the design.
- Deadline: the estimator's draw count is deadline-dependent (generous budget →
  thousands of draws; already-expired deadline → it throws before taking a
  sample), which is why those draws are not charged to the frame. Asserted
  against `monteCarloEstimate`, not through an integral — see the correction
  above.
- Unframed liveness: outside a frame, repeated evaluation still varies.
- `stochasticEqual`: a seeded `isEqual` verdict replays.
- Public-API compatibility: `monteCarloEstimate` called with the old
  five-argument signature behaves as before.
- The Option A property: `∫f` at two different positions inside one frame
  agree, and agree with the same integral evaluated in a frame whose other
  contents differ. This is what the structural tag buys and the counter option
  would not.
- Hash-drift tolerance, as a guard on ourselves: the suite must still pass if
  `hashCode` is perturbed. Worth confirming once by hand — if any test fails
  under a perturbed hash, it pinned a value it should not have.
- **Not tested, deliberately**: interpreted/compiled agreement for integrals.
  The tiers are not expected to agree (§5.1). Do not add such a test.
