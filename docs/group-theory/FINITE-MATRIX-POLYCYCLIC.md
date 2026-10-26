# Finite, matrix and polycyclic group implementation

Chapters 39, 44 and 45 are **not complete**. The [operation ledger](CHAPTER-COVERAGE.json) inventories all 323 numbered operation headings in the live official manual and distinguishes bounded native implementations, host-only implementations, partial implementations, missing operations, and GAP-specific runtime policies. Counts are not a percentage of mathematical coverage: operations differ greatly in scope and difficulty.

This implementation uses original Epsil/TypeScript algorithms and Compute Engine's existing expression, type, exact arithmetic, lattice, cancellation and checkpoint infrastructure. It adds no GAP parser, interpreter, executable dependency or production bridge. All work remains in the isolated `codex/gap-group-theory-plan` worktree; the first PR is a draft for maintainer feedback on the foundation, with continued development expected.

## What is implemented

The [finite-group kernel](../../src/compute-engine/group-theory/finite-group.ts) certifies complete multiplication tables. Imported, matrix and quotient tables receive full identity, inverse and associativity checks; tables built internally from validated permutation products inherit associativity and retain closure, identity and inverse checks. Immutable subgroup values belong to one specific table. Permutation and matrix models retain explicit correspondence between element indices and their original values. This is a small-group reference backend alongside the existing [verified permutation chains](VERIFIED-GROUP-BASELINE.md), not a replacement for the chain algorithms.

Its algorithms include generated subgroups, containment, index, equality, intersection, joins, conjugation, normality, centralizers, normalizers, normal closure, core, center, commutator and derived subgroups, subnormality, right cosets, transversals, double cosets, conjugacy classes, roots, complete subgroup enumeration, maximal/normal subgroups, Fitting and solvable radicals, socle, Frattini subgroups, Sylow subgroups, quotients, and positive generator-word factorization.

The [structural layer](../../src/compute-engine/group-theory/finite-structure.ts) adds certified homomorphisms, composition/inversion, kernels/images, exhaustive automorphisms and characteristic tests, Hall subgroups, complement conjugacy representatives, composition/chief/supersolvable series, p-central series, Omega/Agemo, rational conjugacy classes, exponent, abelianization invariants, independent abelian generators, minimal generating sets, generating-tuple counts, commutator length and subgroup conjugacy classes.

The [matrix kernel](../../src/compute-engine/group-theory/matrix.ts) provides exact immutable square matrices over Q and prime fields, multiplication, inversion, determinant, powers, transpose and right vector actions. Matrix-group construction rejects singular generators and incompatible dimensions or fields. It includes bounded closure, finite-table conversion, full vector and projective actions, natural GL/SL constructors and recognition, determinant-one and integral-group tests, invariant bilinear and quadratic form spaces, and a verified invariant row lattice for finite rational groups. GL(4,2) order 20,160 is checked through its faithful vector action and a permutation chain, without enumerating its elements.

The [polycyclic kernel](../../src/compute-engine/group-theory/polycyclic.ts) constructs pcgs for finite solvable groups by refining their derived series without enumerating subgroup lattices, validates user sequences, proves every cyclic subnormal factor and unique normal form, computes coordinates and signed products, depths, leading coefficients, relative orders, heads, reductions and special-product coordinates. It handles composite relative orders and trivial factors. Induced sequences are verified against every parent-tail intersection. Sifting, canonical right-coset representatives and two-subgroup factorizations use explicit parent domains.

The [quotient layer](../../src/compute-engine/group-theory/polycyclic-quotient.ts) retains checked numerator/denominator groups and projection/lift maps. It computes quotient coordinates, images and full preimages of subgroups, and linear/affine actions on elementary abelian sections. A lift is a deterministic section; it is not asserted to be a homomorphism. The [action layer](../../src/compute-engine/group-theory/polycyclic-actions.ts) refines supplied subnormal series while retaining their boundaries, verifies complete finite permutation action maps, and returns orbit-stabilizer results with original-group witnesses.

## Epsil interface

Install the opt-in library with `installGroupTheory(ce)` from [the library module](../../src/compute-engine/library/group-theory.ts). The earlier `installPermutationFoundation` name remains supported. Both install the same definitions atomically, under the engine's checkpoint lifecycle. The default library bundle and public export surface are unchanged.

Run the [complete Epsil example](../../scripts/group-theory/exact-groups.epsil):

```text
node node_modules/tsx/dist/cli.mjs scripts/group-theory/exact-groups-probe.ts
```

The checked result is `Tuple(3, [2], 18, [2,3], 168, True)`: the derived subgroup order and abelianization of S3, its number of generating pairs, its pcgs relative orders, the order of GL(3,2), and cyclicity of a rational rotation group.

The [adapter](../../src/compute-engine/library/finite-group-theory.ts) defines the exact operation names and signatures. Principal call patterns are:

```text
GroupMatrix(characteristic, rows)
MatrixGroup(dimension, characteristic, generators)
GeneralLinearGroup(dimension, prime, maxWork)
SpecialLinearGroup(dimension, prime, maxWork)
GroupOrder(group, maxElements, maxWork)
GroupDerivedSubgroup(group, maxElements, maxWork)
GroupIsSolvable(group, maxElements, maxWork)
GroupRightCosets(group, subgroup, maxElements, maxWork)
GroupQuotient(group, normalSubgroup, maxElements, maxWork)
GroupPcgs(group, maxElements, maxWork)
GroupPcSequence(group, sequence, maxElements, maxWork)
GroupPcExponents(pcgs, element, maxWork)
GroupPcElement(pcgs, exponents, maxWork)
GroupPcSift(parentPcgs, subgroup, element, maxWork)
GroupModuloPcExponents(parentPcgs, numerator, denominator, element, maxWork)
MatrixGroupOrderByAction(group, maxPoints, maxWork)
```

Characteristic zero means Q, and a prime characteristic means Fp. Matrix entries must be exact rationals; approximate floats, symbolic coefficients and irrational numbers are rejected. A rational denominator divisible by p is invalid. The matrix constructor accepts singular values for forms, while the group constructor requires invertibility.

Generic group operations accept permutation or matrix descriptors. Order, membership, subgroup/equality/index/normality and abelianness queries now select specialized permutation algorithms. Eligible prime-field matrix order queries use faithful vector actions; matrix abelianness uses generators. The maxElements argument bounds enumeration, not group order on these specialized paths. See [algorithm and runtime details](PERFORMANCE.md). Compatible subgroups need not contain one another for joins, intersections, commutator subgroups, centralizers or normalizers; these queries construct a common generated ambient group within the supplied bounds. Subgroup-containment predicates return false for compatible elements outside the parent. Incompatible fields/actions remain errors.

`GroupQuotient` returns a tuple containing a regular permutation representation of the quotient and a complete source-element/image table. `GroupPcgs` returns `Nothing` only after proving non-solvability; resource exhaustion is an error. `GroupPcSequence` retains the original group representation and supplied element sequence. An induced Epsil sequence preserves its elements but does not serialize a parent certificate; operations needing a parent receive it explicitly and rebuild/check the induced sequence. No imported MathJSON certificate is trusted.

Matrix action results contain the permutation group, ordered points, and a faithfulness result. Full vector actions and full projective actions over F2 are faithful. Other projective actions return `Nothing` for unknown faithfulness because scalar kernels are possible; no scalar-kernel certificate is returned. These actions use row vectors: `(v A) B = v (A B)`.

Invariant-form APIs return a basis for the full solution space, which can include singular forms. Quadratic forms use upper-triangular coefficient matrices and preserve characteristic-two distinctions. No classical-group recognition follows merely from finding such a basis.

## Bounds and failure semantics

- Finite-table order: 1 through 256. Imported, matrix and quotient table validation checks all associativity triples; checked permutation models use the private representation-backed construction path.
- Every finite computation receives a `GroupWork` ledger with at most 50,000,000 logical units. Nested computations share the ledger; nested polynomial and chain work is conservatively charged in addition to cancellation checkpoints. Units are not milliseconds or a formal CPU-cost model.
- Complete subgroup or automorphism enumeration is capped at 4,096 results. Small order alone does not guarantee that an exhaustive query will finish within these bounds.
- Matrix dimension: 1 through 32. Form-space solvers accept dimension at most 8. Matrix groups have at most 256 generators.
- Prime characteristics: 2 through 65,521, checked for primality. Exact coefficients are bounded to 4,096 bits before normalization. Signed exponent inputs are bounded to 16,384 bits.
- Matrix actions accept at most 100,000 points and at most 1,000,000 vector-coordinate or generator-image entries. The count is checked before point/image allocation. The inherited permutation action and chain bounds also apply.
- Pcgs length: at most 256. Complete normal forms have at most 256 elements. Input tails, parent intersections and subgroup normality are verified before a pcgs or quotient value is published.
- Generating-tuple length is at most 4,096. Counts remain exact big integers.
- Explicit element/step/storage limits yield errors, never partial groups, truncated subgroups, false property claims or cached conclusions. Caller cancellation propagates unchanged.
- Matrix and pcgs constructors validate on evaluation, not boxing. A surrounding expression may evaluate constructor operands before the outer query's own ledger begins; budgets are per evaluated operator, not a global budget for an entire expression tree. Engine deadline cancellation applies throughout.
- No arbitrary table or callback can bypass group axioms. The host table constructor validates every axiom; host actions validate all multiplication equations before traversal.

## Verification and remaining scope

The new [kernel tests](../../test/compute-engine/group-theory-finite.test.ts) and [Epsil tests](../../test/compute-engine/group-theory-exact-integration.test.ts) cover known S3/S4/D8/C4/A4/A5 results, all S4 induced subgroups, finite-group and pcgs round trips, corrupted tables/maps, exact matrix arithmetic and forms, quotient correspondence, GL(4,2) recognition, invariant lattices, limits, cancellation, typed Epsil, raw/structural/canonical forms, serialization and atomic registration. A5 is proved non-solvable before pcgs failure. No GAP executable or differential test was run.

The operation ledger still marks 177 operation headings missing, 25 partial, and 17 specific to GAP runtime policies. Another 20 have bounded host implementations without complete Epsil equivalents. These counts describe the current inventory, not a completion estimate. Broader representation support and production validation also remain required even for the bounded-native rows.

The largest missing dependencies are:

- Chapter 39: free/finitely presented domains, general structural descriptions and catalogs, cohomology and extension machinery, Schur covers/multipliers/exterior squares, several p-group and lattice algorithms, and complete group-map/series interfaces.
- Chapter 44: finite extension fields and embeddings, cyclotomic domains, sesquilinear and up-to-scalar forms, full classical-group recognition, restriction of scalars, integral normalizers/centralizers, Bravais groups and crystallographic operations.
- Chapter 45: persistent canonical/induced/modulo value interfaces, all specialized series predicates and constructors, LG-series with Hall systems and head complements, special pcgs, and the remaining subgroup/action interfaces. Generic finite coordinates are not a substitute for these contracts.

The next changes must extend this ledger with implementations and independent evidence. Do not mark these chapters complete on the strength of the bounded reference backend. A first foundation-review PR does not assert chapter completion.
