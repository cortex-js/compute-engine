# Generator-based groups and bounded closure

Phase 0 implementation slice, 2026-10-26. Builds on [validated permutation values](VALIDATED-PERMUTATIONS.md) in the same initiative worktree. The library remains opt-in; this historical slice is included in the initial foundation-review draft.

## Implemented operations

```epsil
let p = Permutation([2, 1])
let q = Permutation([1, 3, 2])
let G = PermutationGroup([p, q], PermutationAction(3))
let elements = PermutationGroupElements(G, 6, 12)
count(elements)
// 6
```

`PermutationGroup(generators, action)` stores an explicit finite list of checked generators and an explicit finite action. Each generator must preserve that action's point set. `PermutationGroupElements(group, maxElements, maxProducts)` returns a complete eager list or an error; both limits are required. These names remain experimental CE heads usable from Epsil.

An empty generator list defines the trivial group on the supplied action, including an action of degree zero. The result contains the identity permutation even when the action has no points. An action of degree five retains that context even though its identity element stores no images.

Generators retain their order, duplicates, and identity elements. Their individual image arrays are normalized by the checked value constructor. The group descriptor is immutable and does not claim to be a minimal generating set or a canonical subgroup identity. Two different descriptors can generate the same subgroup. Constructor equality has deliberately not been made injective: structural differences do not prove mathematical inequality. General subgroup equality and membership remain later explicit queries.

## Implementation and mathematical guarantee

The [pure group kernel](../../src/compute-engine/group-theory/permutation/groups.ts) defines `PermutationGroupValue`, portable decoding, and `enumeratePermutationGroup()`. It depends on the existing checked permutation kernel, not the engine composition root. The [CE adapter](../../src/compute-engine/library/group-theory.ts) adds group construction and enumeration to the existing explicit installer.

Closure starts with identity and processes elements in breadth-first discovery order. For every discovered element, it computes its right product with every supplied generator. Normalized image arrays provide exact deduplication keys within the common permutation domain. The order is deterministic for a given ordered generator list, but is not a canonical order of the abstract group.

Positive generator words suffice here: in a finite permutation group, the inverse of a generator is a positive power of that generator. Therefore, when the frontier is completely processed, the result is precisely the generated subgroup. This argument depends on the finite, validated permutation representation; the routine must not be reused for arbitrary monoids or infinite presentations under the same guarantee.

The list is returned only after all frontier products have been checked. Discovering an expected number of elements does not end the search. For example, S3 from these two generators requires twelve products to finish this routine. A budget of eleven produces an error even if all six elements have already been discovered. A limit of six elements still succeeds when the remaining products only repeat known elements.

There is no partially published list, group-order field, membership fact, or derived cache. Constructor evaluation, hashing, printing, and serialization do not run closure. The result is a bounded reference tool for teaching and independent checks; scalable order and membership still require the planned verified stabilizer chains.

## Resource contracts

Current protective caps are provisional, not benchmark-derived performance claims:

| Limit | Default / maximum | Configuration |
| --- | --- | --- |
| Input/action degree | 100,000 | Existing `maxDegree` installation/host option may lower it |
| Supplied generators | 1,024 | `maxGenerators` may lower it |
| Stored generator image entries | 1,000,000 | `maxGeneratorImages` may lower it |
| Closure elements | Caller must specify 1..10,000 | `maxElements` argument |
| Attempted right products | Caller must specify 0..100,000 | `maxProducts` argument |
| Cumulative product image width | 5,000,000 | Host `maxImageWork`; installer `maxClosureImageWork` may lower it |
| Retained closure image entries | 1,000,000 | Host `maxStoredImages`; installer `maxClosureStoredImages` may lower it |

Product width is the maximum normalized support degree of its two operands, charged before multiplication. This is a logical work measure, not a CPU-instruction count. Product count also bounds work on identity generators whose image width is zero. Generator count and image-entry limits bound descriptor copying and decoding. Host JSON decoding charges raw generator image lengths before allocating their validated copies; CE receives child expressions that may already have normalized trailing fixed points.

Storage is charged only when a new element is retained. It does not count every temporary candidate, and it is not a total process-memory ceiling. At most one candidate is processed at a time in the search; the existing degree cap bounds that candidate. CE boxing and input parsing have their own allocation costs. Encoding a completed list also cooperates with cancellation.

Invalid limit settings use input errors. Actual closure exhaustion throws `PermutationClosureLimitError` in the kernel and becomes one of these CE error codes:

- `permutation-closure-element-limit`
- `permutation-closure-product-limit`
- `permutation-closure-image-work-limit`
- `permutation-closure-storage-limit`

None means that an element is absent, a group is infinite, or a partial count is the order. Caller cancellation propagates through the existing CE cancellation channel. A later call with more generous valid limits performs a fresh computation. No partial data survive the failed call.

## Entry routes, serialization, and state

Every group consumer decodes its descriptor again. Raw and structural MathJSON, `strict: false`, plain host objects, and prototype lookalikes do not bypass validation. Generator and action domains are checked before closure begins. Unresolved symbolic inputs remain constructor candidates; explicit collection producers are evaluated before their resulting lists are validated. Constructors never implicitly enumerate a lazy generator collection.

MathJSON retains the action and generator list:

```json
["PermutationGroup", ["List", ["Permutation", ["List", 2, 1]]], ["PermutationAction", 3]]
```

Install the optional definitions in a fresh engine before interpreting a saved descriptor. Receiving limits apply on reload. Host JSON uses a `permutation-group` descriptor with schema version 1, a versioned action descriptor, and versioned element descriptors. Unknown versions, unsupported domains, malformed generators, and unexpected descriptor fields are rejected. No asserted order or cached membership information is trusted from JSON.

The installer registers the group type and both operations in the existing transaction. A conflict in the third nominal declaration rolls back the entire installation. Checkpoint restore can remove the definitions or restore a saved group, and reinstallation works afterwards. The new kernel has no module-global registry or mutable mathematical cache.

## Verification and runnable example

The [Epsil example](../../scripts/group-theory/group-closure.epsil) constructs S3, enumerates it through a typed reusable function, counts the complete list, and constructs a trivial group on five points. Run:

```sh
node node_modules/tsx/dist/cli.mjs scripts/group-theory/group-probe.ts
```

The four foundation suites pass **108 tests**, including 51 added for groups and closure:

- [Group kernel tests](../../test/compute-engine/group-theory-groups.test.ts): an independent six-element S3 fixture; C4, V4, D8, A4, and S4 size/inverse checks; empty and redundant generators; distinct descriptors of the same subgroup; exact budget boundaries; invalid settings; portable decoding; and cancellation during a search.
- [Group integration tests](../../test/compute-engine/group-theory-closure.test.ts): typed Epsil workflows, all boxing modes, disabled static checking, symbolic/materialized inputs, unequal descriptors without an unsupported inequality claim, failed-and-retried queries, receiving limits, serialization, atomic registration, and checkpoints.
- The 57 earlier checked-value tests continue to pass.

Run the focused group suites with:

```sh
node node_modules/jest/bin/jest.js --config config/jest.config.cjs --runInBand --reporters default --runTestsByPath test/compute-engine/group-theory-groups.test.ts test/compute-engine/group-theory-closure.test.ts
```

No GAP executable or performance benchmark was used for these checks. The next slice, [point orbits and Schreier transversals](ORBITS-AND-TRANSVERSALS.md), now builds on these descriptors. The [verified group baseline](VERIFIED-GROUP-BASELINE.md) now adds bounded Schreier generation and verified chains for exact order and membership. Phase 0's broader architecture/inventory work, independent GAP runner, public API/loading decisions, and browser/worker work remain open. Keep the implementation here until the agreed base capabilities are ready for a PR.