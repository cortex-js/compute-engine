# Group theory operator reference

The optional group-theory library adds native permutation, finite-group, exact
matrix, and polycyclic computations to the Compute Engine. This reference covers
its public expression operators and their representation contracts. The
[capability and benchmark ledger](../../benchmarks/group-theory.md) describes
algorithm choices, measurements, and resource policies in more detail.

## Loading and evaluating

```javascript
import { ComputeEngine } from '@cortex-js/compute-engine';
import { loadGroupTheory } from '@cortex-js/compute-engine/group-theory';

const ce = new ComputeEngine();
loadGroupTheory(ce);

const s3 = ce.box([
  'PermutationGroup',
  ['List', ['Permutation', ['List', 2, 3, 1]], ['Permutation', ['List', 2, 1]]],
  ['PermutationAction', 3],
]).evaluate();

ce.box(['GroupOrder', s3.json]).evaluate().json; // 6
ce.box(['GroupIsAbelian', s3.json]).evaluate().json; // 'False'
ce.box(['PermutationOrbit', s3.json, 1]).evaluate().json; // ['List', 1, 2, 3]
```

Loading is synchronous. Repeating the call with the same effective options is
idempotent. Different options on an already-loaded engine, invalid ceilings, or
conflicting operator names cause the loader to throw. Loading returns a
`GroupTheoryLoadReport` with `operatorCount`. Group operators are absent from
the default library until loaded.

MathJSON lists start with `List`; tuples start with `Tuple`. The same operators
are callable from Epsil using ordinary function calls and list literals after
loading the library into that engine. Boolean results serialize as `True` and
`False`. An optional mathematical result serializes as `Nothing` when absent.

## Values and domains

| Type                 | Meaning                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Permutation`        | A finite-support bijection, encoded by the images of points `1..n`. Trailing fixed points are removed; `Permutation([])` is the identity.                                        |
| `PermutationAction`  | The declared point set `1..degree`. Degree zero is allowed.                                                                                                                      |
| `PermutationGroup`   | A list of permutation generators and a declared action. An empty generator list gives the trivial group in that action.                                                          |
| `GroupMatrix`        | An exact square matrix over the rationals (characteristic `0`) or a prime field (characteristic `p`). Matrix values may be singular; matrix-group generators must be invertible. |
| `MatrixGroup`        | Dimension, characteristic, and invertible generators. Empty generators still retain the field and dimension.                                                                     |
| `GroupDescriptor`    | The union `PermutationGroup \| MatrixGroup`.                                                                                                                                     |
| `GroupElement`       | The union `Permutation \| GroupMatrix`. Membership and domain compatibility are checked by the operation using it.                                                               |
| `GroupHomomorphism`  | Source and target descriptors, with complete element/image pairs.                                                                                                                |
| `GroupQuotientValue` | Source group, normal kernel, and a verified surjective projection onto the quotient representation.                                                                              |
| `GroupPcSequence`    | An ambient descriptor and a validated polycyclic generating sequence in it. An induced sequence can represent a proper subgroup of that ambient group.                           |
| `PcGroup`            | A checked collected presentation of a finite polycyclic group, independent of enumeration.                                                                                       |
| `PcElement`          | A canonical coordinate vector bound to a `PcGroup` presentation.                                                                                                                 |

Group descriptors retain generators, not a canonical name for the subgroup. Use
`GroupEqual(G,H)` for group equality; structural equality of expressions is not
a substitute. Two permutation groups must use the same action degree for group
relations. Matrix domains must have the same dimension and field. The library
does not silently identify permutation and matrix representations or isomorphic
groups with different domains. Explicit homomorphisms can connect different
representations.

Products use right actions: `PermutationCompose(a,b)` applies `a` and then `b`.
Conjugation is `x^g = g^-1 x g`, and `[x,y] = x^-1 y^-1 x y`. Matrices act on
row vectors by right multiplication. Permutation points, generator word labels,
and finite polycyclic positions are one-based. Only an imported multiplication
table uses zero-based element indices, with identity at index zero.

`PcGroup` and `PcElement` are separate from `GroupDescriptor` and
`GroupElement`. Use the `Pc*` operators for collected presentations. General
structural queries such as `GroupCenter` do not yet dispatch to this
representation.

## Options and execution limits

Where supported, the last argument is `options: dictionary<integer>?`. In
MathJSON this is a dictionary value, for example:

```javascript
ce.box([
  'GroupElements', s3.json,
  { dict: { maxElements: 6, maxProducts: 12 } },
]).evaluate();
```

An omitted option uses the installed ceiling. A call can lower a ceiling, not
raise it. Options control execution and are never stored as mathematical data in
a group or map. The accepted keys depend on the algorithm and representation:

| Query family                                                                                                                                                        | Per-call keys                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupOrder`, `GroupContains`, `GroupIsSubgroup`, `GroupIndex`, `GroupEqual`, `GroupIsNormal`, `GroupIsAbelian` on permutation groups; `PermutationPointStabilizer` | `maxWork`, `maxLevels`, `maxOrbitPoints`, `maxOrbitEdges`, `maxStoredImages`; generic group queries also accept `maxElements` and `maxPoints` |
| `GroupElements` on permutation groups                                                                                                                               | `maxElements`, `maxProducts`, `maxImageWork`, `maxStoredImages`                                                                               |
| `PermutationOrbit`, `PermutationOrbits`                                                                                                                             | `maxPoints`, `maxEdges`                                                                                                                       |
| `PermutationTransversal`                                                                                                                                            | `maxPoints`, `maxEdges`, `maxProducts`, `maxImageWork`, `maxStoredImages`                                                                     |
| Bounded finite-group, map, matrix, finite polycyclic, and section operations                                                                                        | `maxElements`, `maxWork`, `maxPoints`; only limits relevant to the operation affect its algorithm                                             |
| Collected `PcGroup`, `PcElement`, and `Pc*` operations                                                                                                              | `maxWork`                                                                                                                                     |

Permutation element operations and the three permutation constructors have no
per-call options. `GroupGenerators` and `GroupIdentity` read a permutation
descriptor directly; they do not build a chain or enumerate elements. Their
generic signatures accept and validate the finite options for both
representations. For the generic permutation chain queries, `maxElements` and
`maxPoints` are accepted finite-model controls but do not cause table or action
enumeration. Their effective `maxWork` is bounded by both `maxFiniteWork` and
`maxChainWork`. `PermutationPointStabilizer` retains its chain-only options.

Loader settings are supplied to `loadGroupTheory(ce, settings)`:

| Loader setting               |    Default |     Maximum |
| ---------------------------- | ---------: | ----------: |
| `maxDegree`                  |    100,000 |     100,000 |
| `maxGenerators`              |      1,024 |       1,024 |
| `maxGeneratorImages`         |  1,000,000 |   1,000,000 |
| `maxClosureElements`         |     10,000 |      10,000 |
| `maxClosureProducts`         |    100,000 |     100,000 |
| `maxClosureImageWork`        |  5,000,000 |   5,000,000 |
| `maxClosureStoredImages`     |  1,000,000 |   1,000,000 |
| `maxOrbitPoints`             |    100,000 |     100,000 |
| `maxOrbitEdges`              |  1,000,000 |   1,000,000 |
| `maxTransversalProducts`     |    100,000 |     100,000 |
| `maxTransversalImageWork`    |  5,000,000 |   5,000,000 |
| `maxTransversalStoredImages` |  1,000,000 |   1,000,000 |
| `maxChainWork`               | 50,000,000 |  50,000,000 |
| `maxChainLevels`             |        256 |         256 |
| `maxChainOrbitPoints`        |    100,000 |     100,000 |
| `maxChainOrbitEdges`         |  1,000,000 |  50,000,000 |
| `maxChainStoredImages`       |  1,000,000 | 100,000,000 |
| `maxFiniteElements`          |        256 |         256 |
| `maxFiniteWork`              | 50,000,000 |  50,000,000 |
| `maxMatrixActionPoints`      |    100,000 |     100,000 |

Element-count ceilings are at least one; other ceilings can be zero. Values must
be safe integers within their kernel range. The finite table bound applies when
the selected algorithm constructs a complete group model. Permutation chain
queries, faithful finite-field matrix actions, and collected presentation
arithmetic can handle orders larger than 256. Permutation `GroupElements` uses
its separate closure bounds. A bounded structural operation can still fail on a
group whose order was computed successfully.

Further fixed bounds include 4,096 enumerated subgroups, 4,096 automorphisms,
one million expanded homomorphism output units per query, matrix dimension 32,
and form computations in dimension at most eight. Collected presentations have
rank at most 64 and at most one million logical coefficient slots including
collection scratch space. Matrix coefficients and collected presentation scalar
inputs have 4,096-bit bounds; some intermediate matrix elimination integers have
a separate larger bound. The collected group order is an exact product and may
exceed the scalar-input bit bound. Large exact results can encounter these
limits before the logical work budget runs out.

A limit error is not `False`, `Nothing`, an infinite order, or a partial list.
For example, a rational matrix group's closure exceeding `maxElements` does not
prove that the group is infinite. Ordinary invalid data and exhausted budgets
produce error expressions such as `incompatible-type`,
`incompatible-permutation-action`, `group-work-limit`,
`finite-group-element-limit`, `subgroup-count-limit`,
`automorphism-count-limit`, or `group-map-output-limit`. Permutation algorithms
also report their specific `permutation-closure-*`, `permutation-orbit-*`, and
`permutation-chain-*` limits. Engine cancellation propagates. Unresolved valid
symbolic operands remain symbolic; nested errors are preserved.

## Quotient and representation examples

A quotient carries its projection; its group value is not itself the source
group or a list of cosets:

```javascript
const r = ['Permutation', ['List', 2, 3, 4, 1]];
const r2 = ['Permutation', ['List', 3, 4, 1, 2]];
const c4 = ce.box([
  'PermutationGroup', ['List', r], ['PermutationAction', 4],
]).evaluate();
const c2 = ce.box([
  'PermutationGroup', ['List', r2], ['PermutationAction', 4],
]).evaluate();
const quotient = ce.box(['GroupQuotient', c4.json, c2.json]).evaluate();
const projection = ce.box(['GroupQuotientProjection', quotient.json]).evaluate();
const quotientGroup = ce.box(['GroupQuotientGroup', quotient.json]).evaluate();
ce.box(['GroupOrder', quotientGroup.json]).evaluate().json; // 2
ce.box(['GroupOrder', ['GroupHomomorphismKernel', projection.json]])
  .evaluate().json; // 2
```

The quotient is returned in a regular permutation representation. A lift is a
chosen source representative satisfying `projection(lift(q)) = q`; it need not
preserve multiplication. Maps serialize complete pairs, so their meaning does
not depend on an internal enumeration order. `GroupHomomorphismCompose(f,g)`
applies `f` first and then `g`; the intermediate groups must match as actual
groups in compatible domains, though their generator lists can differ.

Exact rational matrices use characteristic zero:

```javascript
const rotation = ['GroupMatrix', 0, ['List', ['List', 0, -1], ['List', 1, 0]]];
const matrixGroup = ['MatrixGroup', 2, 0, ['List', rotation]];
ce.box(['GroupOrder', matrixGroup]).evaluate().json; // 4
ce.box(['GroupMatrixDeterminant', rotation]).evaluate().json; // 1
ce.box(['GroupOrder', ['GeneralLinearGroup', 2, 3]]).evaluate().json; // 48
```

Prime-field matrices reduce rational entries modulo `p`; denominators must be
nonzero in that field. Supported prime characteristics are at most 65,521. This
is not an extension-field implementation of `GF(p^k)`. Invariant bilinear forms
are matrices `B` satisfying `g B g^T = B`. Quadratic forms use upper-triangular
coefficient matrices for `q(v) = sum(i<=j, B[i,j] v[i] v[j])`, including
characteristic two. Returned bases may contain singular matrices.

A vector or projective action returns `(permutationGroup, points, faithful)`.
The permutation point numbered `i` refers to entry `i` of the returned point
list (one-based). The full vector action is faithful. The projective action
normalizes nonzero vectors to represent lines; it has a possible scalar kernel.
Its faithfulness marker is `True` over F2 and `Nothing` over other prime fields
when the subgroup's scalar kernel has not been determined. Do not use the order
of that projective image as the matrix group's order without a kernel argument.

## Polycyclic coordinates and collected presentations

A finite sequence `P = GroupPcSequence(G,[g1,...,gr])` uses normal forms
`g1^e1 ... gr^er`, with `0 <= ei < relativeOrder[i]`. It describes a strict
subnormal cyclic series. `GroupPcgs(G)` computes one for a finite solvable group
and returns `Nothing` when the complete computation proves nonsolvability. The
finite sequence and its coordinate dictionary use the bounded finite model.

`GroupPcPresentation(P)` converts a finite sequence into checked collected
relations. It preserves the order of the coordinate positions and relative
orders. After conversion, `Pc*` arithmetic no longer enumerates the group:

```javascript
const sequence = ce.box(['GroupPcSequence', c4.json, ['List', r]]).evaluate();
const presentation = ce.box(['GroupPcPresentation', sequence.json]).evaluate();
const x = ['PcElement', presentation.json, ['List', 1]];
ce.box(['PcCoordinates', ['PcPower', x, 4]]).evaluate().json; // ['List', 0]
```

The constructor is
`PcGroup(relativeOrders, powers, conjugates, inverseConjugates)`. All four lists
run from the first generator to the last. For generator `gi` of relative order
`mi`, `powers[i]` is the tail coordinate vector for `gi^mi`, of length `r-i-1`
when indexing the input arrays from zero. Row `conjugates[i]` contains one such
vector for each later generator `gj`, representing `gi^-1 gj gi`.
`inverseConjugates[i]` similarly represents `gi gj gi^-1`. Each row has `r-i-1`
vectors, each of length `r-i-1`. The last power vector and the last two
conjugation rows are empty.

Relative orders are integers at least two. Four empty lists give the trivial
group. The constructor verifies the power and conjugation consistency conditions
and rejects inconsistent relations; it does not complete arbitrary
presentations. `PcElement` accepts canonical coordinates in range, not arbitrary
unreduced words. `PcPower` accepts signed integer exponents. Arithmetic requires
the same mathematical presentation; an isomorphism to a different presentation
is not inferred.

```javascript
const hugeCyclic = [
  'PcGroup', ['List', 1000000000000],
  ['List', ['List']], ['List', ['List']], ['List', ['List']],
];
ce.box(['PcGroupOrder', hugeCyclic]).evaluate().json; // 1000000000000
ce.box(['PcCoordinates', ['PcPower', ['PcElement', hugeCyclic, ['List', 42]], 3]])
  .evaluate().json; // ['List', 126]
```

Finite PC sifting by a subgroup `H` preserves the right coset `Hx` and yields
identity exactly for membership. It is distinct from choosing the least
coordinate representative of `Hx`. Section operations take a numerator `H` and a
denominator `N` normal in `H`, within the parent finite sequence. Section
coordinates can include relative-order-one positions. Linear actions require a
nontrivial elementary abelian section whose returned coordinates form a
prime-field vector basis; affine actions use homogeneous row coordinates.

## Operator tables

The following tables show the mathematical signatures. To keep them readable,
the trailing `options: dictionary<integer>?` argument is omitted wherever it is
registered; the options section above identifies each family. `nothing` is the
optional result type whose value is `Nothing`. Names and argument types follow
the installed operators. In descriptions, `G` is the first group argument, `H`
the second, and `K` the third unless otherwise stated.

### Permutation values and point actions

| Operator                     | Signature                                                                        | Meaning                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Permutation`                | `(list<integer>) -> Permutation`                                                 | Construct from a bijective image list. Fixed trailing points are omitted in the normalized value. |
| `PermutationAction`          | `(integer) -> PermutationAction`                                                 | Construct the point domain 1 through the supplied degree.                                         |
| `PermutationGroup`           | `(list<Permutation>, PermutationAction) -> PermutationGroup`                     | Construct a generator descriptor in the supplied action; every generator must fit the action.     |
| `PermutationCompose`         | `(Permutation, Permutation) -> Permutation`                                      | Product a b, applying a first and then b.                                                         |
| `PermutationInverse`         | `(Permutation) -> Permutation`                                                   | Inverse permutation.                                                                              |
| `PermutationPower`           | `(Permutation, integer) -> Permutation`                                          | Signed integer power.                                                                             |
| `PermutationOrder`           | `(Permutation) -> integer`                                                       | Exact order of an element, computed from its cycles.                                              |
| `PermutationCycles`          | `(Permutation) -> list<list<integer>>`                                           | Disjoint nontrivial cycles; fixed points are omitted.                                             |
| `PermutationConjugate`       | `(Permutation, Permutation) -> Permutation`                                      | For arguments (x,g), return g^-1 x g.                                                             |
| `PermutationCommutator`      | `(Permutation, Permutation) -> Permutation`                                      | For arguments (x,y), return x^-1 y^-1 x y.                                                        |
| `PermutationInAction`        | `(Permutation, PermutationAction) -> Permutation`                                | Check that the permutation fits the action and return the same mathematical permutation.          |
| `PermutationApply`           | `(Permutation, integer, PermutationAction) -> integer`                           | Image of the supplied point in the supplied action.                                               |
| `PermutationOrbit`           | `(group: PermutationGroup, point: integer) -> list<integer>`                     | Orbit of one point, including that point.                                                         |
| `PermutationOrbits`          | `(group: PermutationGroup) -> list<list<integer>>`                               | Partition the whole declared action, including singleton fixed-point orbits.                      |
| `PermutationTransversal`     | `(group: PermutationGroup, point: integer) -> list<tuple<integer, Permutation>>` | Pairs (point,t) with t taking the supplied base point to that point.                              |
| `PermutationPointStabilizer` | `(group: PermutationGroup, point: integer) -> PermutationGroup`                  | Subgroup fixing the supplied point, computed with a stabilizer chain.                             |

### Basic group queries and construction

| Operator                  | Signature                                                  | Meaning                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupFromTable`          | `(list<list<integer>>) -> PermutationGroup`                | Import a square table indexed 0..n-1 with identity 0, verify the group laws, and return its faithful right regular permutation group.         |
| `GroupGenerators`         | `(GroupDescriptor) -> list<GroupElement>`                  | Validated generators of the descriptor, preserving their supplied order; not a minimum generating set.                                        |
| `GroupIdentity`           | `(GroupDescriptor) -> GroupElement`                        | Identity element in the descriptor representation.                                                                                            |
| `GroupElements`           | `(GroupDescriptor) -> list<GroupElement>`                  | Complete list, identity first. Permutation inputs use the separate closure API; matrix inputs use the bounded finite model.                   |
| `GroupOrder`              | `(GroupDescriptor) -> integer`                             | Exact order. Uses a stabilizer chain for permutations, a feasible faithful vector action for prime-field matrices, or bounded matrix closure. |
| `GroupContains`           | `(GroupDescriptor, GroupElement) -> boolean`               | Whether the compatible element belongs to G.                                                                                                  |
| `GroupIsSubgroup`         | `(GroupDescriptor, GroupDescriptor) -> boolean`            | Whether H is contained in G; the parent is the first argument.                                                                                |
| `GroupIndex`              | `(GroupDescriptor, GroupDescriptor) -> integer`            | Index [G:H]; H must be a subgroup of G.                                                                                                       |
| `GroupEqual`              | `(GroupDescriptor, GroupDescriptor) -> boolean`            | Equality of the generated subgroups in a common domain.                                                                                       |
| `GroupIsNormal`           | `(GroupDescriptor, GroupDescriptor) -> boolean`            | Whether H is normal in G.                                                                                                                     |
| `GroupIsSubnormal`        | `(GroupDescriptor, GroupDescriptor) -> boolean`            | Whether H is subnormal in G.                                                                                                                  |
| `GroupIsCharacteristic`   | `(GroupDescriptor, GroupDescriptor) -> boolean`            | Whether every automorphism of G preserves H. Structural shortcuts compare actual subgroups; otherwise a bounded automorphism search is used.  |
| `GroupIsConjugate`        | `(GroupDescriptor, GroupElement, GroupElement) -> boolean` | Whether the two supplied elements of G are conjugate by an element of G.                                                                      |
| `GroupIntersection`       | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Intersection G intersect H in their common domain.                                                                                            |
| `GroupJoin`               | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Subgroup generated by G and H.                                                                                                                |
| `GroupCentralizer`        | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Elements of G commuting with all of H. H need not be contained in G, but both must share a domain.                                            |
| `GroupNormalizer`         | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Elements of G normalizing H. H need not be contained in G, but both must share a domain.                                                      |
| `GroupNormalClosure`      | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Smallest normal subgroup of G containing H; requires H contained in G.                                                                        |
| `GroupCore`               | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Largest normal subgroup of G contained in H; requires H contained in G.                                                                       |
| `GroupCommutatorSubgroup` | `(GroupDescriptor, GroupDescriptor) -> GroupDescriptor`    | Subgroup generated by all [g,h] with g in G and h in H.                                                                                       |

### Finite structure and invariants

| Operator                            | Signature                                                        | Meaning                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GroupIsAbelian`                    | `(GroupDescriptor) -> boolean`                                   | Whether all group elements commute; permutation inputs retain the specialized chain implementation.                      |
| `GroupIsCyclic`                     | `(GroupDescriptor) -> boolean`                                   | Whether one element generates G. The trivial group is cyclic.                                                            |
| `GroupIsSolvable`                   | `(GroupDescriptor) -> boolean`                                   | Whether the derived series terminates at the identity.                                                                   |
| `GroupIsNilpotent`                  | `(GroupDescriptor) -> boolean`                                   | Whether G is nilpotent; prime-power and abelian cases use direct structural tests.                                       |
| `GroupIsPerfect`                    | `(GroupDescriptor) -> boolean`                                   | Whether the derived subgroup equals G.                                                                                   |
| `GroupIsSimple`                     | `(GroupDescriptor) -> boolean`                                   | Whether G is nontrivial and has no nontrivial proper normal subgroup.                                                    |
| `GroupIsElementaryAbelian`          | `(GroupDescriptor) -> boolean`                                   | Whether G is elementary abelian; the trivial group returns True.                                                         |
| `GroupIsPGroup`                     | `(GroupDescriptor) -> boolean`                                   | Whether the order is a prime power; the trivial group returns True. No prime argument is supplied.                       |
| `GroupIsSupersolvable`              | `(GroupDescriptor) -> boolean`                                   | Whether G has a normal series with prime cyclic factors.                                                                 |
| `GroupExponent`                     | `(GroupDescriptor) -> integer`                                   | Least common multiple of element orders.                                                                                 |
| `GroupNilpotencyClass`              | `(GroupDescriptor) -> integer \| nothing`                        | Nilpotency class, 0 for the trivial group, or Nothing when G is not nilpotent.                                           |
| `GroupPrime`                        | `(GroupDescriptor) -> integer \| nothing`                        | Prime dividing a nontrivial prime-power order; Nothing for the trivial group or a mixed-prime order.                     |
| `GroupCenter`                       | `(GroupDescriptor) -> GroupDescriptor`                           | Center Z(G).                                                                                                             |
| `GroupDerivedSubgroup`              | `(GroupDescriptor) -> GroupDescriptor`                           | Derived subgroup [G,G].                                                                                                  |
| `GroupFrattiniSubgroup`             | `(GroupDescriptor) -> GroupDescriptor`                           | Intersection of maximal subgroups. Prime-power and abelian groups use algebraic formulas.                                |
| `GroupFittingSubgroup`              | `(GroupDescriptor) -> GroupDescriptor`                           | Largest nilpotent normal subgroup.                                                                                       |
| `GroupSolvableRadical`              | `(GroupDescriptor) -> GroupDescriptor`                           | Largest solvable normal subgroup.                                                                                        |
| `GroupSocle`                        | `(GroupDescriptor) -> GroupDescriptor`                           | Subgroup generated by the minimal nontrivial normal subgroups.                                                           |
| `GroupAbelianInvariants`            | `(GroupDescriptor) -> list<integer>`                             | Sorted primary cyclic factor orders of the abelianization G/[G,G], not a divisibility-chain invariant-factor convention. |
| `GroupMinimalGenerators`            | `(GroupDescriptor) -> list<GroupElement>`                        | A generating tuple of minimum length; the general fallback is bounded and potentially expensive.                         |
| `GroupIndependentAbelianGenerators` | `(GroupDescriptor) -> list<GroupElement>`                        | Generators of primary cyclic direct factors. Requires G abelian.                                                         |
| `GroupEulerianFunction`             | `(GroupDescriptor, integer) -> integer`                          | Number of ordered generating tuples of the supplied nonnegative length, allowing repeated elements.                      |
| `GroupCommutatorLength`             | `(GroupDescriptor, GroupElement) -> integer \| nothing`          | Least number of commutator factors for the element; Nothing outside the derived subgroup.                                |
| `GroupFactorization`                | `(GroupDescriptor, GroupElement) -> list<integer> \| nothing`    | A shortest positive word in the descriptor generators, as one-based generator labels. Identity has the empty word.       |
| `GroupNthRoots`                     | `(GroupDescriptor, GroupElement, integer) -> list<GroupElement>` | All elements y of G satisfying y^n = x, for arguments (G,x,n).                                                           |

### Subgroup lists, series, cosets, and prime subgroups

| Operator                         | Signature                                                                         | Meaning                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GroupSubgroups`                 | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Complete subgroup lattice, including the identity subgroup and G.                                                                |
| `GroupNormalSubgroups`           | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | All normal subgroups of G.                                                                                                       |
| `GroupMaximalSubgroups`          | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | All maximal proper subgroups of G.                                                                                               |
| `GroupSubgroupConjugacyClasses`  | `(GroupDescriptor) -> list<list<GroupDescriptor>>`                                | Subgroups partitioned into conjugacy classes under G.                                                                            |
| `GroupConjugacyClasses`          | `(GroupDescriptor) -> list<list<GroupElement>>`                                   | Elements partitioned into conjugacy classes under G.                                                                             |
| `GroupRationalClasses`           | `(GroupDescriptor) -> list<list<GroupElement>>`                                   | Classes generated by conjugacy and taking powers coprime to the element order.                                                   |
| `GroupDerivedSeries`             | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Descending derived series, stopping when stable. A nonsolvable result need not end at identity.                                  |
| `GroupLowerCentralSeries`        | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Descending lower central series, stopping when stable. A nonnilpotent result need not end at identity.                           |
| `GroupUpperCentralSeries`        | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Ascending upper central series, starting at identity and stopping when stable.                                                   |
| `GroupCompositionSeries`         | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Descending series with simple factors, including G and identity.                                                                 |
| `GroupChiefSeries`               | `(GroupDescriptor) -> list<GroupDescriptor>`                                      | Descending series of subgroups normal in G with no normal subgroup between successive terms.                                     |
| `GroupRightCosets`               | `(GroupDescriptor, GroupDescriptor) -> list<list<GroupElement>>`                  | Complete element lists of right cosets Hx in G; H must be a subgroup of G.                                                       |
| `GroupRightTransversal`          | `(GroupDescriptor, GroupDescriptor) -> list<GroupElement>`                        | One representative of each right coset Hx in G.                                                                                  |
| `GroupDoubleCosets`              | `(GroupDescriptor, GroupDescriptor, GroupDescriptor) -> list<list<GroupElement>>` | Element lists of HxK in G, for arguments (G,H,K).                                                                                |
| `GroupComplementRepresentatives` | `(GroupDescriptor, GroupDescriptor) -> list<GroupDescriptor>`                     | One G-conjugacy representative for each complement of the supplied normal subgroup H; empty if none exist.                       |
| `GroupSylowSubgroup`             | `(GroupDescriptor, integer) -> GroupDescriptor`                                   | One Sylow p-subgroup, for arguments (G,p). p must be prime.                                                                      |
| `GroupPCore`                     | `(GroupDescriptor, integer) -> GroupDescriptor`                                   | Largest normal p-subgroup of G.                                                                                                  |
| `GroupHallSubgroups`             | `(GroupDescriptor, list<integer>) -> list<GroupDescriptor>`                       | All Hall subgroups for the supplied list of primes. A finite nilpotent group has exactly one; other groups use a bounded search. |
| `GroupPCentralSeries`            | `(GroupDescriptor, integer) -> list<GroupDescriptor>`                             | Descending lower exponent-p central series, P_(i+1) = [P_i,G] P_i^p; requires a p-group.                                         |
| `GroupOmega`                     | `(GroupDescriptor, integer, integer) -> GroupDescriptor`                          | For (G,p,k), subgroup generated by elements killed by p^k; requires a p-group and nonnegative k.                                 |
| `GroupAgemo`                     | `(GroupDescriptor, integer, integer) -> GroupDescriptor`                          | For (G,p,k), subgroup generated by p^k-th powers; requires a p-group and nonnegative k.                                          |

### Homomorphisms and quotients

| Operator                     | Signature                                                                                          | Meaning                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GroupHomomorphism`          | `(GroupDescriptor, GroupDescriptor, list<tuple<GroupElement, GroupElement>>) -> GroupHomomorphism` | Validate a complete list of (sourceElement,targetElement) pairs, covering every source element exactly once and preserving all products.   |
| `GroupHomomorphismByImages`  | `(GroupDescriptor, GroupDescriptor, list<GroupElement>, list<GroupElement>) -> GroupHomomorphism`  | For (source,target,generators,images), verify that generators generate the source and that their proposed images extend to a homomorphism. |
| `GroupHomomorphismApply`     | `(GroupHomomorphism, GroupElement) -> GroupElement`                                                | Apply a map to a source element.                                                                                                           |
| `GroupHomomorphismSource`    | `(GroupHomomorphism) -> GroupDescriptor`                                                           | Source descriptor.                                                                                                                         |
| `GroupHomomorphismTarget`    | `(GroupHomomorphism) -> GroupDescriptor`                                                           | Target descriptor, which may be larger than the image.                                                                                     |
| `GroupHomomorphismKernel`    | `(GroupHomomorphism) -> GroupDescriptor`                                                           | Kernel as a subgroup in the source representation.                                                                                         |
| `GroupHomomorphismImage`     | `(GroupHomomorphism) -> GroupDescriptor`                                                           | Image as a subgroup in the target representation.                                                                                          |
| `GroupHomomorphismImageOf`   | `(GroupHomomorphism, GroupDescriptor) -> GroupDescriptor`                                          | Image of the supplied source subgroup.                                                                                                     |
| `GroupHomomorphismPreimage`  | `(GroupHomomorphism, GroupDescriptor) -> GroupDescriptor`                                          | Full inverse image of a target subgroup, including the kernel.                                                                             |
| `GroupHomomorphismPreimages` | `(GroupHomomorphism, GroupElement) -> list<GroupElement>`                                          | All source elements mapping to the supplied target element; empty if it is outside the image.                                              |
| `GroupHomomorphismInverse`   | `(GroupHomomorphism) -> GroupHomomorphism`                                                         | Inverse map; requires a bijective homomorphism.                                                                                            |
| `GroupHomomorphismCompose`   | `(GroupHomomorphism, GroupHomomorphism) -> GroupHomomorphism`                                      | For (f,g), apply f and then g. Intermediate domains must match as groups.                                                                  |
| `GroupAutomorphisms`         | `(GroupDescriptor) -> list<GroupHomomorphism>`                                                     | Complete bounded list of automorphisms, each with explicit source and target. Rendering also has a total output bound.                     |
| `GroupQuotient`              | `(GroupDescriptor, GroupDescriptor) -> GroupQuotientValue`                                         | Construct G/H with H normal in G; returns a quotient value carrying its projection.                                                        |
| `GroupQuotientValue`         | `(GroupDescriptor, GroupDescriptor, GroupHomomorphism) -> GroupQuotientValue`                      | Validate (source,kernel,projection): the projection must be surjective with exactly the declared normal kernel.                            |
| `GroupQuotientGroup`         | `(GroupQuotientValue) -> GroupDescriptor`                                                          | The target group of the quotient projection.                                                                                               |
| `GroupQuotientProjection`    | `(GroupQuotientValue) -> GroupHomomorphism`                                                        | Verified homomorphism from the numerator onto the quotient group.                                                                          |
| `GroupQuotientLift`          | `(GroupQuotientValue, GroupElement) -> GroupElement`                                               | Choose a numerator element projecting to the supplied quotient element. This section is not asserted to be a homomorphism.                 |

### Exact matrices and matrix groups

| Operator                             | Signature                                                                           | Meaning                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupMatrix`                        | `(integer, list<list<rational>>) -> GroupMatrix`                                    | Construct from (characteristic,rows). Rows must be square and exact rational entries; normalization uses Q or the prime field.        |
| `MatrixGroup`                        | `(integer, integer, list<GroupMatrix>) -> MatrixGroup`                              | Construct from (dimension,characteristic,generators); all generators must be invertible in that domain.                               |
| `GroupMatrixMultiply`                | `(GroupMatrix, GroupMatrix) -> GroupMatrix`                                         | Product of two matrices in the same field and dimension.                                                                              |
| `GroupMatrixInverse`                 | `(GroupMatrix) -> GroupMatrix`                                                      | Inverse of a nonsingular matrix.                                                                                                      |
| `GroupMatrixTranspose`               | `(GroupMatrix) -> GroupMatrix`                                                      | Transpose matrix.                                                                                                                     |
| `GroupMatrixPower`                   | `(GroupMatrix, integer) -> GroupMatrix`                                             | Signed integer power; negative exponents require an invertible matrix.                                                                |
| `GroupMatrixDeterminant`             | `(GroupMatrix) -> rational`                                                         | Exact determinant in the matrix field.                                                                                                |
| `MatrixGroupDimension`               | `(MatrixGroup) -> integer`                                                          | Dimension of the representation.                                                                                                      |
| `MatrixGroupCharacteristic`          | `(MatrixGroup) -> integer`                                                          | 0 for Q, otherwise the prime field characteristic.                                                                                    |
| `MatrixGroupOrder`                   | `(MatrixGroup) -> integer`                                                          | Matrix-specific order query; GroupOrder is the representation-independent spelling.                                                   |
| `MatrixGroupElements`                | `(MatrixGroup) -> list<GroupMatrix>`                                                | Bounded complete matrix closure; GroupElements also accepts a matrix group.                                                           |
| `MatrixGroupPcgs`                    | `(MatrixGroup) -> GroupPcSequence \| nothing`                                       | Compute a finite polycyclic sequence, or Nothing for a proved nonsolvable group; GroupPcgs also accepts matrix groups.                |
| `MatrixGroupTranspose`               | `(MatrixGroup) -> MatrixGroup`                                                      | Group generated by transposes of the supplied generators.                                                                             |
| `MatrixGroupIsSubgroupSL`            | `(MatrixGroup) -> boolean`                                                          | Whether every generator has determinant one.                                                                                          |
| `MatrixGroupIsIntegral`              | `(MatrixGroup) -> boolean`                                                          | Whether the rational group lies in GL(n,Z): integer generator entries and determinant +1 or -1. Returns False for prime-field groups. |
| `MatrixGroupInvariantBilinearForms`  | `(MatrixGroup) -> list<GroupMatrix>`                                                | Basis of matrices B satisfying g B g^T = B for every generator; basis matrices can be singular.                                       |
| `MatrixGroupInvariantQuadraticForms` | `(MatrixGroup) -> list<GroupMatrix>`                                                | Basis of invariant quadratic forms, encoded as upper-triangular coefficient matrices.                                                 |
| `MatrixGroupVectorAction`            | `(MatrixGroup) -> tuple<PermutationGroup, list<list<integer>>, boolean \| nothing>` | Full finite-field vector action; returns (permutationGroup,pointVectors,True).                                                        |
| `MatrixGroupProjectiveAction`        | `(MatrixGroup) -> tuple<PermutationGroup, list<list<integer>>, boolean \| nothing>` | Action on one-dimensional subspaces; returns normalized point representatives and a faithfulness marker.                              |
| `GeneralLinearGroup`                 | `(integer, integer) -> MatrixGroup`                                                 | Natural GL(d,p), for arguments (dimension,prime).                                                                                     |
| `SpecialLinearGroup`                 | `(integer, integer) -> MatrixGroup`                                                 | Natural SL(d,p), for arguments (dimension,prime).                                                                                     |
| `MatrixGroupIsNaturalGL`             | `(MatrixGroup) -> boolean`                                                          | Whether this prime-field subgroup is the whole natural GL(d,p), using a certified order.                                              |
| `MatrixGroupIsNaturalSL`             | `(MatrixGroup) -> boolean`                                                          | Whether this prime-field subgroup is the whole natural SL(d,p), checking determinant one and certified order.                         |
| `MatrixGroupOrderByAction`           | `(MatrixGroup) -> integer`                                                          | Order through the faithful full vector action; requires a prime field and feasible action bounds.                                     |
| `MatrixGroupInvariantLattice`        | `(MatrixGroup) -> GroupMatrix`                                                      | A row basis of an invariant rational lattice for a group whose finite closure completes. Requires characteristic zero.                |

### Finite polycyclic sequences

| Operator                        | Signature                                                                                      | Meaning                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupPcgs`                     | `(GroupDescriptor) -> GroupPcSequence \| nothing`                                              | Compute a polycyclic sequence of a bounded finite solvable group, or Nothing when nonsolvable.                                                                         |
| `GroupPcSequence`               | `(GroupDescriptor, list<GroupElement>) -> GroupPcSequence`                                     | Validate the supplied sequence in an ambient group; each retained factor must be nontrivial cyclic and subnormal.                                                      |
| `GroupPcPresentation`           | `(GroupPcSequence) -> PcGroup`                                                                 | Convert a finite sequence to a checked collected PcGroup, preserving coordinate positions and relative orders.                                                         |
| `GroupPcRelativeOrders`         | `(GroupPcSequence) -> list<integer>`                                                           | Relative orders of the sequence generators.                                                                                                                            |
| `GroupPcSeries`                 | `(GroupPcSequence) -> list<GroupDescriptor>`                                                   | Tail subgroups, including the generated subgroup and identity.                                                                                                         |
| `GroupPcExponents`              | `(GroupPcSequence, GroupElement) -> list<integer>`                                             | Canonical coordinate vector of an element represented by the sequence.                                                                                                 |
| `GroupPcElement`                | `(GroupPcSequence, list<integer>) -> GroupElement`                                             | Evaluate a canonical coordinate vector; coordinates must be in their relative-order ranges.                                                                            |
| `GroupPcLinearCombination`      | `(GroupPcSequence, list<integer>) -> GroupElement`                                             | Evaluate the ordered generator product with arbitrary signed integer exponents.                                                                                        |
| `GroupPcDepth`                  | `(GroupPcSequence, GroupElement) -> integer`                                                   | One-based position of the first nonzero coordinate, or rank+1 for identity.                                                                                            |
| `GroupPcLeadingExponent`        | `(GroupPcSequence, GroupElement) -> integer`                                                   | First nonzero coordinate, or 0 for identity.                                                                                                                           |
| `GroupPcRelativeOrder`          | `(GroupPcSequence, GroupElement) -> integer`                                                   | Order of the element modulo the next tail at its depth; 1 for identity.                                                                                                |
| `GroupPcHead`                   | `(GroupPcSequence, GroupElement, integer) -> GroupElement`                                     | For (P,x,d), retain only coordinates at positions strictly before d.                                                                                                   |
| `GroupPcReduced`                | `(GroupPcSequence, GroupElement, GroupElement) -> GroupElement`                                | For (P,x,y), remove the leading coordinate of x by left multiplication by powers of y^-1; requires equal nonidentity depth and a solvable leading-coordinate equation. |
| `GroupPcRelativePowerExponents` | `(GroupPcSequence, integer) -> list<integer>`                                                  | For (P,i), coordinates of gi raised to its relative order. i is one-based.                                                                                             |
| `GroupPcConjugateExponents`     | `(GroupPcSequence, integer, integer) -> list<integer>`                                         | For (P,i,j), coordinates of gi^-1 gj gi. The conjugating generator is the first position.                                                                              |
| `GroupPcCommutatorExponents`    | `(GroupPcSequence, integer, integer) -> list<integer>`                                         | For (P,i,j), coordinates of [gi,gj] = gi^-1 gj^-1 gi gj.                                                                                                               |
| `GroupInducedPcSequence`        | `(GroupPcSequence, GroupDescriptor) -> GroupPcSequence`                                        | Sequence of the supplied subgroup induced by the parent sequence and its tails.                                                                                        |
| `GroupPcSift`                   | `(GroupPcSequence, GroupDescriptor, GroupElement) -> GroupElement`                             | For (P,H,x), a residue in Hx; identity exactly when x belongs to H.                                                                                                    |
| `GroupPcCanonicalElement`       | `(GroupPcSequence, GroupDescriptor, GroupElement) -> GroupElement`                             | For (P,H,x), representative of Hx with the least parent coordinate vector.                                                                                             |
| `GroupPcgsBySeries`             | `(GroupDescriptor, list<GroupDescriptor>) -> nothing \| tuple<GroupPcSequence, list<integer>>` | Refine a descending subnormal series ending at identity; returns (sequence,oneBasedTailBoundaries), or Nothing if a required factor is not solvable.                   |
| `GroupPcOrbit`                  | `(GroupPcSequence, integer) -> tuple<list<integer>, list<GroupElement>, GroupPcSequence>`      | For a permutation-backed sequence and point, returns (orbitPoints,representativeElements,stabilizerSequence).                                                          |
| `GroupPcStabilizer`             | `(GroupPcSequence, integer) -> GroupPcSequence`                                                | Sequence for the point stabilizer; requires a permutation-backed sequence.                                                                                             |

### Finite polycyclic sections and actions

| Operator                      | Signature                                                                                        | Meaning                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GroupModuloPcRelativeOrders` | `(GroupPcSequence, GroupDescriptor, GroupDescriptor) -> list<integer>`                           | For (P,H,N), relative orders of the quotient coordinates for H/N. N must be normal in H.                                                                                |
| `GroupModuloPcExponents`      | `(GroupPcSequence, GroupDescriptor, GroupDescriptor, GroupElement) -> list<integer>`             | For (P,H,N,x), coordinates of xN, with x in H.                                                                                                                          |
| `GroupModuloPcElement`        | `(GroupPcSequence, GroupDescriptor, GroupDescriptor, list<integer>) -> GroupElement`             | For (P,H,N,coordinates), choose a lift in H of the represented coset.                                                                                                   |
| `GroupPcLinearAction`         | `(GroupPcSequence, GroupDescriptor, GroupDescriptor, GroupElement) -> GroupMatrix`               | For (P,H,N,x), row-action matrix of conjugation by x on H/N. x must normalize both H and N; section coordinates must form a nontrivial elementary abelian vector basis. |
| `GroupPcAffineAction`         | `(GroupPcSequence, GroupDescriptor, GroupDescriptor, GroupElement, GroupElement) -> GroupMatrix` | For (P,H,N,x,t), homogeneous row-action matrix for v -> v A + b, where A comes from conjugation by x and b is the coordinate vector of tN.                              |

### Collected polycyclic presentations

| Operator           | Signature                                                                                               | Meaning                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PcGroup`          | `(list<integer>, list<list<integer>>, list<list<list<integer>>>, list<list<list<integer>>>) -> PcGroup` | Construct and validate relative orders, power tails, forward conjugation tails, and inverse conjugation tails. No complete element enumeration is required. |
| `PcElement`        | `(PcGroup, list<integer>) -> PcElement`                                                                 | Bind canonical in-range bigint coordinates to a presentation.                                                                                               |
| `PcGroupOrder`     | `(PcGroup) -> integer`                                                                                  | Exact product of relative orders.                                                                                                                           |
| `PcRelativeOrders` | `(PcGroup) -> list<integer>`                                                                            | Relative orders in presentation order.                                                                                                                      |
| `PcIdentity`       | `(PcGroup) -> PcElement`                                                                                | Identity element with all coordinates zero.                                                                                                                 |
| `PcGenerators`     | `(PcGroup) -> list<PcElement>`                                                                          | Standard generators with one unit coordinate, in presentation order.                                                                                        |
| `PcCoordinates`    | `(PcElement) -> list<integer>`                                                                          | Canonical coordinates of a collected element.                                                                                                               |
| `PcMultiply`       | `(PcElement, PcElement) -> PcElement`                                                                   | Multiply elements in the same presentation.                                                                                                                 |
| `PcInverse`        | `(PcElement) -> PcElement`                                                                              | Inverse within the presentation.                                                                                                                            |
| `PcPower`          | `(PcElement, integer) -> PcElement`                                                                     | Signed integer power within the presentation.                                                                                                               |

## Implementation references

The optional entry point is [src/group-theory.ts](../../src/group-theory.ts).
Expression registration and decoding live in
[group-theory.ts](../../src/compute-engine/library/group-theory.ts),
[finite-group-theory.ts](../../src/compute-engine/library/finite-group-theory.ts),
and [pc-group-theory.ts](../../src/compute-engine/library/pc-group-theory.ts).
The kernels under
[src/compute-engine/group-theory](../../src/compute-engine/group-theory) are
implementation modules, not additional supported package exports.

General structural operations can still require exponential subgroup or
automorphism searches. Collected presentations currently provide arithmetic, not
the full general structural API; infinite relative orders and arbitrary
presentation completion are not supported. Prime-power extension fields and
general infinite matrix-group algorithms are also outside this interface. See
the [capability ledger](../../benchmarks/group-theory.md) for measured workloads
and the distinction between implemented bounded algorithms and future
representation or scalability work.
