# Broadcast Model — Length-Mismatch Policy

**Status**: ratified 2026-07-27 (consult in-session; supersedes the staged
2026-07-27 attempt to pull `PointList` into the strict regime, which was
reverted the same day). The lifted-operator half shipped with the element-wise
rounds of 2026-07-24/26 (see `CHANGELOG.md` under 0.97 "Breaking Changes").

## The rule

There are two regimes, and which one applies is decided by **what the user
wrote**, not by the operand shapes:

1. **An operator LIFTED over collections requires length agreement.** When an
   operator is implicitly broadcast over collection operands — `Add`,
   `Multiply`, `Divide`/`Power`/`Mod`, the ordering relations, the logical
   connectives, `ElementMax`/`ElementMin`/`Clamp` — a length mismatch is
   `incompatible-dimensions`, never a silent zip-to-shortest. The user asked
   for `a + b`, not for a pairing; truncation would return a plausible answer
   that silently discards data.

2. **An explicit PAIRING constructor defines its length as the shortest
   input.** `Zip`, the variadic `Map`, and `PointList` are operations whose
   *defined output* is the pairing up to the shorter operand — the shortest
   length is the contract, not a truncated version of some longer true
   answer. `PointList([1,2,3],[10,20])` is two points (a ratified consumer
   contract, Tycho item 52); `Zip` with an unbounded source is the enumerate
   idiom.

Corollary rules for the strict regime:

- A **scalar** operand is a LIFT, not a participant — it never mismatches.
- A **broadcast operand is evaluated ONCE** (broadcasting is an operation on
  values): `L < Random()` draws once; a per-element draw is written
  explicitly as `Map(L, l ↦ l < Random())`.
- An **unbounded** operand against a finite one is a mismatch (`count` is
  `Infinity`, which agrees with no finite length).
- An operand whose length is **not yet known** is not compared — there is
  nothing to compare until it resolves. (Residue: the lazy variadic `Map`
  that then zips those uses shortest-input semantics, so a late-resolving
  mismatch can still truncate; see ROADMAP "Broadcast semantics residue".)
- An **empty** operand alongside a non-empty one is a mismatch; a lone empty
  operand broadcasts to `Nothing` (`Not([])`).

## Why this split

- **Failure-mode asymmetry.** In the lifted case a mismatch almost always
  means a bug (an off-by-one `Range`, a `Filter` that changed length); an
  error is recoverable in seconds, while truncation produces a
  plausible-but-wrong answer whose discarded tail is undetectable after the
  fact. In the pairing case the shortest length is the documented output, and
  the permissive semantics stays *expressible* — a user who means
  "pair as far as both go" writes `Zip`/`Map` — while the reverse (recovering
  strictness from a truncating default) would be impossible.
- **Precedent.** Strict lifting is where the ecosystem converged: NumPy
  errors on shape mismatch (its broadcasting only lifts size-1 axes — the
  scalar-lift rule generalized), Julia throws `DimensionMismatch`,
  Mathematica's `Thread` errors, and R's recycling is the standing cautionary
  tale. For explicit pairing, Python's `zip` kept shortest as the default and
  added `strict=True` as an opt-in (PEP 618) — evidence both that
  shortest-zip bugs are real *and* that the remedy is an opt-in check, not a
  default flip.
- **Consistency.** `Add` on mismatched vectors has no mathematical meaning,
  so it must error; any truncating choice for comparisons or connectives
  would re-create the head-dependent inconsistency (and the old
  size-threshold incoherence) that the 2026-07-24 ruling removed. Conversely,
  making `PointList` strict while `Zip` stays shortest would create a new
  inconsistency *within* the pairing family — and making the whole family
  strict kills the unbounded-zip idiom.

## Consequences for consumers

- Desmos-style silent truncation of ragged *operator* operands is not
  replicated by the engine; an importer that wants it clamps (or lowers to
  `Zip`/`Map`) at its own boundary. `PointList` needs no such clamping — its
  shortest-zip is the Desmos-compatible pairing, contained by design in this
  one constructor (Tycho item 25 moved it out of generic `Tuple` evaluation
  for exactly this reason).
- If the hidden-bug class in pairing ever bites, the sanctioned extension is
  a PEP-618-shaped **opt-in strict mode** on the pairing operations (a
  `strict` variant answering `incompatible-dimensions`), never a flip of the
  shipped shortest default.

## Where it lives

- The single mismatch check: `broadcastLengthMismatch`, applied in
  `broadcastOverIndexedCollections`, in the `lazyBroadcastMap` funnel (both
  `collection-utils.ts`), and at the `BoxedFunction` broadcast steps.
  `strictLengths = true` is the default parameter; `PointList`
  (`library/collections.ts`) is the only opt-out.
- Compiled lowering: `_SYS.bcast` on the JavaScript target mirrors the
  interpreter per POSITION (an empty or mismatched position projects to NaN
  without poisoning siblings).
- Pins: `compiled-elementwise-boolean.test.ts` ("the mismatch ruling reaches
  every broadcast path", including the `PointList` opt-out),
  `points-arithmetic.test.ts` (zip-to-shorter),
  `pointlist-lazy-broadcast.test.ts` (ragged lazy transpose),
  `multiply-mixed-collection-kinds.test.ts` (mixed-kind operands join the
  strict regime).

## Audit record (2026-07-27)

Empirical probe of every operator that can see ≥2 collection operands
(mismatched `[1,2,3]` vs `[10,20]`, plus the edge rules), on the box route.

**Conformant — strict regime errors:** `Add`, `Subtract`, `Multiply`
(mixed-kind), `Divide`, `Power`, `Root`, `Mod`, `Log(base)`, `ElementMax`,
`ElementMin`, `Clamp`, all four orderings, `And`/`Or`/`Xor`/`Nand`/`Nor`/
`Implies`/`Equivalent`, measurement lists (`[1,2,3] m + [1,2] m`), and a
scalar-parameter function literal applied to mismatched collections (incl.
an infinite operand). Edge rules all hold: scalar lift, empty vs non-empty
mismatch, lone-empty → `Nothing`, unknown-length skipped.

**Conformant — pairing regime shortest:** `Zip`, variadic `Map`, `PointList`.

**Fixed by this audit:** the `addN`/`mulN` value paths routed a provably
INFINITE operand (`Cycle`, `Range(1,∞)` — `count` is `Infinity`, a KNOWN
length) to the lazy `Map` via `isUnknownLengthBroadcast` with no mismatch
check, so `Add([1,2,3], Range(1,∞))` answered `[2,4,6]` while `Less` on the
same operands errored. The check now lives in the `lazyBroadcastMap` funnel
(strict by default, pairing opt-out threaded through).

**Out of scope, verified no silent loss:** `Quotient` and `Atan2` do not
broadcast at all (inert even at matched lengths — a coverage gap, not a
truncation; adding `broadcastable` signatures would be a separate feature).
`GCD`/`LCM`/`Max`/`Min` are flatten-REDUCERS over their collection arguments
(`GCD([4,6],[8,10])` = 2), not element-wise maps — ragged input is
well-defined. `Equal`/`NotEqual` on two collections is whole-collection
equality (mismatched lengths → definitively `False`/`True`). `Dot`/`Cross`
error on dimension grounds of their own.

**Known residues (tracked in ROADMAP):** `Multiply` of two mismatched `List`
literals stays inert-symbolic (never truncated, never diagnosed) — and the
unit-carrying variant (`[1,2,3] · ([1,2]·Meter)`) lands in the same inert
shape; a late-resolving mismatch inside the lazy variadic `Map` can still
truncate. Cosmetic: `Covariance`/`Correlation` are strict but answer
`unexpected-argument` ("collections differ in length") rather than
`incompatible-dimensions`. A non-indexed collection operand (`Add(L,
Naturals)`) is lifted like a scalar, producing inert `Naturals + 1` cells —
arguably deserving its own ruling.
