# Point orbits and Schreier transversals

Implemented 2026-10-26 in the existing group-theory worktree. Builds on [validated permutations](VALIDATED-PERMUTATIONS.md) and [generator descriptors](GROUPS-AND-CLOSURE.md). The installer remains opt-in; this slice is included in the initial foundation-review draft.

## Epsil operations

```epsil
let G = PermutationGroup([Permutation([2, 1]), Permutation([1, 3, 2])], PermutationAction(5))
PermutationOrbit(G, 1, 3, 6)
// [1, 2, 3]
PermutationOrbits(G, 5, 10)
// [[1, 2, 3], [4], [5]]
PermutationTransversal(G, 1, 3, 6, 2)
// [(1, Permutation([])), (2, Permutation([2, 1])), (3, Permutation([3, 1, 2]))]
```

| Operation | Arguments after group | Result |
| --- | --- | --- |
| `PermutationOrbit` | root, maximum points, maximum generator edges | Complete orbit in breadth-first discovery order |
| `PermutationOrbits` | maximum total points, maximum total generator edges | Complete partition of the explicit action |
| `PermutationTransversal` | root, maximum points, maximum edges, maximum products | Complete list of `(point, representative)` tuples |

All count budgets are required. Orbit order depends on the root and supplied generator order. Partition roots are selected in ascending order. Results include fixed points in the explicit action, even if those points are absent from normalized permutation storage. These operations do not enumerate group elements.

The empty action has an empty orbit partition. It has no valid root. An empty-generator group on a nonempty action has singleton orbits, each with identity representative. Roots and representative targets must be safe integer points in `1..action.degree`; out-of-domain points are errors rather than singleton orbits.

The [runnable example](../../scripts/group-theory/orbits.epsil) uses typed reusable Epsil functions returning `list<integer>` and `list<tuple<integer, Permutation>>`:

```sh
node node_modules/tsx/dist/cli.mjs scripts/group-theory/orbit-probe.ts
```

## Kernel and mathematical contracts

The [pure kernel](../../src/compute-engine/group-theory/permutation/orbits.ts) exposes `PermutationOrbitTree.compute()`, `permutationOrbits()`, and an immutable completed orbit tree with `representative()`, `inverseRepresentative()`, and `transversal()` methods. The [CE adapter](../../src/compute-engine/library/group-theory.ts) provides the three operations above through the existing installer.

Breadth-first search applies each supplied generator to each discovered point. Only exhausting the entire frontier proves completeness. Finite permutations make positive generator words sufficient: their inverse powers are positive powers too. Discovering the expected number of points is not a substitute for checking every edge. For the S3 example, an edge budget of five fails even after all three points have appeared; six succeeds.

Each discovered nonroot point stores a parent index and a forward generator index. Parents precede children, so the immutable arrays encode an acyclic rooted Schreier tree and a generator word for every orbit point. The root uses identity. No array indexed by the entire action domain and no full permutation per point is allocated during tree construction.

For right actions, a representative `t_x` satisfies `root^t_x = x`. For an edge `x -> x^s`, reconstruction uses `t_(x^s) = t_x * s`. This preserves the existing convention `i^(a*b) = (i^a)^b`. The inverse representative sends `x` back to the root. If `H` is the root's stabilizer, the representatives select exactly one element from each right coset `H*t_x`.

A valid action point outside a completed orbit yields host `undefined` from either single-representative method. That is an orbit nonmembership result, never a group-element membership result. Invalid input, exhausted budgets, and cancellation throw instead. A failed computation publishes no tree, partial partition, partial transversal, order, or cached fact.

The compact storage follows the motivation in [GAP chapter 43, stabilizer chains](https://gap-system.github.io/gap/doc/ref/chap43.html). GAP describes inverse edge labels; Epsil's tree stores forward generator indices and explicit parents. This is an original implementation using CE's existing values and execution channels, with no GAP code or runtime dependency.

## Resource and lifecycle contracts

| Resource | Required/default and hard maximum | Accounting |
| --- | --- | --- |
| Orbit points | Required; 0..100,000 | Newly discovered points, including roots; shared across a partition |
| Generator edges | Required; 0..1,000,000 | Every attempted generator application, including duplicate and identity edges |
| Representative products | Required; 0..100,000 | Every attempted permutation product during reconstruction |
| Representative image work | Default/max 5,000,000 | Sum of maximum operand support degrees, plus inverse-image width when requesting an inverse representative |
| Retained representative images | Default/max 1,000,000 | Sum of normalized image lengths in the returned transversal, or the single returned representative |

Existing receiving limits for action degree, generator count, and generator image entries apply before both search and representative reconstruction. The CE installer can lower `maxTransversalImageWork` and `maxTransversalStoredImages`; host reconstruction accepts `maxImageWork` and `maxStoredImages`.

A full transversal shares its reconstruction budgets across all points and uses exactly `orbit.length - 1` products by reusing parent representatives. A single representative uses one product per tree-path edge. Inverting it adds image work but no product. All partition orbits share one point/edge budget, including fixed points; an empty action accepts zero budgets. Zero point allowance cannot produce a rooted orbit.

Retained-image accounting does not claim a total memory ceiling. A temporary product, intermediate path representative, tree arrays, CE boxing, and parser allocations have separate costs. The degree, point, generator, and image-work caps bound the kernel's temporary work. A point-only search does not incur dense transversal image costs.

Actual exhaustion throws `PermutationOrbitLimitError` in the kernel and becomes a CE `Error` with one of these codes:

- `permutation-orbit-point-limit`
- `permutation-orbit-edge-limit`
- `permutation-transversal-product-limit`
- `permutation-transversal-image-work-limit`
- `permutation-transversal-storage-limit`

Invalid limits use input errors. Cancellation propagates unchanged, with checks during search, path reconstruction, multiplication, partition collection, and result encoding. Failed calls do not poison later retries. These are synchronous bounded routines; worker scheduling remains future work.

Consumers revalidate group descriptors across canonical, raw, structural, and `strict: false` entry routes. Merely boxing, hashing, printing, or serializing a query does not execute it. Symbolic groups and points stay unresolved until supplied. The installer registers the new operations atomically and checkpoint restore removes/restores definitions and ordinary saved results.

Save descriptors/queries or ordinary list/tuple results as MathJSON, then install the library in the receiving engine before evaluation. There is no trusted serialized tree/certificate importer. A deserialized list of representatives is ordinary data, not proof of membership or orbit completeness.

## Evidence and next dependency

The six group-theory suites pass **159 tests**, including 51 added for orbits and integration. The new tests cover the manual's natural-action example with an additional fixed point, every root in C4/V4/D8/A4/S4 and intransitive/trivial fixtures, independent known image expectations, full-closure cross-checks, inverse representatives, disjoint right-coset coverage, and Schreier identities `t_x*s*t_(x^s)^-1` fixing the root. A nine-point S9 orbit succeeds although its group order exceeds the existing closure element cap.

Tests also cover empty actions, redundant/identity generators, forged descriptors, every budget boundary, receiving limits, cancellation during search and reconstruction, typed Epsil, round trips, and checkpoints. No GAP executable, benchmark, or browser/worker validation is claimed.

Follow-up: the [verified group baseline](VERIFIED-GROUP-BASELINE.md) now implements bounded Schreier generation, complete deterministic chains, certificate verification, exact order/membership, and a point-stabilizer constructor. Original-generator words and optimized/reduced chains remain next. The 159 tests above describe the orbit milestone; the combined foundation now passes 202 tests. [Chapter 43 dependency plan](GAP-43-ROADMAP.md) records the wider target.
