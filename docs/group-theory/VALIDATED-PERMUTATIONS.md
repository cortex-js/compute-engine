# Validated permutation values and finite-action compatibility

Phase 0 implementation spike, 2026-10-26. The code is opt-in and remains in the initiative worktree. It establishes the checked-value boundary for the [foundation decisions](FOUNDATIONS.md); it is not the base-capability release or a completed group library. This slice is included in the initial foundation-review draft.

Follow-up: [Generator-based groups and bounded closure](GROUPS-AND-CLOSURE.md) now builds on this value slice. The six operations and 57-test count below describe the checked-value milestone; the [orbit/transversal follow-up](ORBITS-AND-TRANSVERSALS.md) is followed by the [verified group baseline](VERIFIED-GROUP-BASELINE.md); the combined foundation now has 26 operations and 202 tests.

## What is implemented

The [pure kernel](../../src/compute-engine/group-theory/permutation/values.ts) provides immutable `PermutationValue` and `PermutationAction` values, ordered composition, inverse, point action, and action-compatibility checks. It does not import ComputeEngine.

The [CE adapter](../../src/compute-engine/library/group-theory.ts) explicitly installs six experimental operations into an engine:

| Operation | Meaning |
| --- | --- |
| `Permutation(images)` | Validate an explicit image list and normalize trailing fixed points |
| `PermutationAction(degree)` | Retain the finite point set `{1,...,degree}`; degree zero is allowed |
| `PermutationCompose(p, q)` | Right-action product: first apply p, then q |
| `PermutationInverse(p)` | Inverse permutation |
| `PermutationApply(p, point, action)` | Check compatibility and return the image of a point in the specified action |
| `PermutationInAction(p, action)` | Check that p acts within this finite action, then return p |

These are experimental CE heads callable from Epsil, not a frozen public vocabulary or package export. The adapter is absent from the default library bundle. Use `installPermutationFoundation(ce)` from its source module in this worktree; no core type-system or evaluator changes were needed.

`PermutationInAction` does not decide membership in a generated subgroup. All supported permutations share the ambient domain of finite-support bijections on positive integers. Finite action degree is separate context. In particular:

```epsil
let p = Permutation([2, 1, 3])
// Normalized element: Permutation([2, 1])
PermutationApply(p, 3, PermutationAction(3))
// 3: the action preserves the fixed third point
PermutationInAction(Permutation([1, 3, 2]), PermutationAction(2))
// Error: permutation-outside-action
```

Composition supports different stored lengths through implicit trailing fixed points. The identity has an empty image list. This gives the same value for `[2,1]` and `[2,1,3]` without conflating actions on two and three points. Equality and hashing of normalized CE values agree; differing concrete permutations compare unequal.

## Checked-value boundary

CE's existing `declareType(..., { mint: false })` option allows a nominal declaration without its default raw constructor. The adapter supplies checked constructor definitions using the ordinary canonicalization and evaluation hooks. This resolves the immediate D2 integration question without adding a general validation framework to all nominal types.

The constructor checks literal payloads during canonicalization when possible. Boxing never evaluates a producer. Inputs such as `Permutation(listFrom(1..3))` remain expressions until evaluation produces an explicit list, which is then checked. An unbound symbolic input remains an unresolved constructor expression. Its nominal type is not a certificate of validity.

Every arithmetic/action operation decodes and validates the operand head, arity, images, and finite-action descriptor. Raw (`form: 'raw'`) or structural MathJSON, disabled static checking, and direct host calls therefore do not bypass mathematical validation. A syntactic `Permutation` head is never accepted as evidence of a valid host value.

The host kernel copies and freezes normalized arrays. Private fields distinguish constructed instances from forged plain objects or prototype lookalikes. Host descriptor decoding checks kind, schema version, ambient domain, and payload before constructing a value; it rejects unexpected descriptor fields. No group computation occurs in construction, equality, hashing, or printing.

Image lists must contain each integer in `1..length` exactly once. Duplicate, missing, fractional, negative, zero, out-of-range, nonnumeric, and unsafe-integer entries are rejected. Lazy views are not enumerated automatically; explicitly materialize finite views with CE's collection operations before requesting a permutation. The materializer has its own CE resource behavior.

## Limits, cancellation, and state

The current degree cap is **100,000**, an initial protective bound rather than a measured performance promise. An installation or host call can lower the cap with `maxDegree`; it cannot increase it beyond this bound. The input list length is checked before allocating validation buffers, even if trailing fixed points would later disappear. Action degrees and decoded payloads also respect the cap. This bounds kernel-owned arrays, not input-parser memory or total process memory.

Validation, composition, inversion, and encoding cooperate with cancellation checks. The adapter uses CE's current deadline/step-budget frame and catches only its own input-validation errors. Caller cancellation propagates unchanged. A complete algebra work/allocation accounting system and browser-worker execution remain future work.

Installation uses a checkpoint to roll back partial type/operator registration. Existing names are not overwritten. Engine checkpoint restore can remove an installation or restore saved values; reinstallation after restoration is tested. There is no module-global engine registry or derived algebra cache to restore.

## Serialization

CE values serialize as ordinary MathJSON, for example:

```json
["Permutation", ["List", 2, 1]]
```

A fresh engine must install the definitions before interpreting the descriptor as a checked permutation. Every reload repeats validation under the receiving engine's configured cap. The MathJSON heads currently define the experimental schema; a versioned public package format remains to be settled before release.

Pure host values also expose versioned JSON descriptors through `toJSON()` and `fromJSON()`. Both elements and finite actions carry the ambient domain descriptor `{ "kind": "positive-integer-permutations", "version": 1 }`. Unknown versions or another domain kind are rejected. Raw JSON objects never acquire the private-field brand by themselves.

## Reproduce and verify

Run the [complete Epsil example](../../scripts/group-theory/validated-permutations.epsil) with:

```sh
node node_modules/tsx/dist/cli.mjs scripts/group-theory/validated-probe.ts
```

It constructs values and an action, composes in both orders, computes an inverse, calls a typed Epsil square function, and applies a permutation to a retained fixed point.

Run the focused tests with:

```sh
node node_modules/jest/bin/jest.js --config config/jest.config.cjs --runInBand --reporters default --runTestsByPath test/compute-engine/group-theory-values.test.ts test/compute-engine/group-theory-foundation.test.ts
```

The two suites pass **57 tests**. The [kernel suite](../../test/compute-engine/group-theory-values.test.ts) includes all 720 permutations of six points for inverse/identity laws, every pair in S4 for action compatibility with composition, and every triple in S3 for associativity. The [integration suite](../../test/compute-engine/group-theory-foundation.test.ts) covers Epsil, host, MathJSON, malformed/forged inputs, symbolic resolution, explicit materialization, normalization/equality, finite actions, fresh-engine reload, limits, cancellation, strict-mode independence, and checkpoint/installation lifecycle.

These are bounded correctness checks, not a benchmark, a GAP differential run, or a proof for all future representations. The original [Phase 0 substrate experiment](../../scripts/group-theory/phase0-model.epsil) remains separate: its unrestricted `PhasePermutation` intentionally demonstrates why nominal typing alone is insufficient.

## What this changes in the foundation plan

- D1's distinction between ambient permutation domain and finite action degree is executable.
- D2 has a viable integration route using existing CE hooks. The trusted boundary is validation during evaluation/decoding, not the nominal type tag.
- D3's right-action convention, normalized element equality, and inverse are tested.
- D5/D6 have initial cancellation, checkpoint, and portable-value evidence. General budgets, mathematical fact caches, representation maps, and compilation/worker contracts remain open.

Generator-based descriptors and bounded closure are now implemented in the follow-up. [Point orbits and Schreier transversals](ORBITS-AND-TRANSVERSALS.md) now follow those descriptors; the [verified group baseline](VERIFIED-GROUP-BASELINE.md) now adds cycles, integer powers, element order, bounded full Schreier chains, membership, and group order. Generic algebra protocols over checked representations and optimized/reduced BSGS remain open. Phase 0's broader GAP inventory, independent runner, and design review remain open. Continue in this worktree until base capabilities are ready for the planned PR.