# `list<T>` holds elements, `tensor<U>` holds cells

Status: decided 2026-10-21 (user decisions D1 to D5 below), implementation
in progress the same day. This document records the decisions, the rules
that follow from them, and the implementation slices. When the work lands,
the rules move to `docs/TYPE-SYSTEM.md` and `doc/08-guide-types.md`, the
residue to `ROADMAP.md`, and this file is deleted.

## 1. The problem

Until 2026-10-21 a list type with no dimensions, `list<E>`, was read two
ways at once:

- **Cell reading** (the subtype relation, `src/common/type/subtype.ts`): `E`
  is the scalar type of the cells, and the list "admits any shape", so a
  matrix of integers is a `list<number>`.
- **Element reading** (the public guide, the runtime, `collectionElementType`
  in `src/common/type/utils.ts`, the compiler, every library consumer):
  `E` is the type of what indexing returns, so a matrix of integers is a
  `list<vector<integer>>`.

The two readings cannot both hold. The rules added on 2026-10-21 to keep
them together (`isScalarTopElement`, `holdsListElements`, the peel in every
case, `flattenedListMatches`, the multi-axis `peeledRowMatches`, the
mixed-depth meet in `reduce.ts`) broke covariance (`vector<value>` was not
a `vector<any>`) and left a soundness hole, measured on the main tree:

```
L: list<number> := [[1, 2], [3, 4]]     accepted
At(L, 1)                                 typed number, value [1, 2]
L[1] + 1                                 typed number, value [2, 3]
Mean(L)                                  admitted, runtime incompatible-type
compiled Sum(L)                          "01,23,4"
```

## 2. Decisions (user, 2026-10-21)

**D1. `list<T>` and `set<T>`: `T` is the type of the elements.** A matrix of
integers is a `list<vector<integer>>` and a `list<list<integer>>`, never a
`list<integer>`. `list<integer>` and `list<list<integer>>` are unrelated,
and their meet is empty.

**D2. `vector<U>`, `matrix<U>`, `tensor<U>` and `list<U^dims>`: `U` is the
type of the cells**, the leaves at depth equal to the rank. The elements of
a matrix are its rows. `tensor<U>` means "any rank, cells `U`"; it needs its
own representation (it parsed as `list<number>` with no dimensions).

**D3. The cell type `U` is `number` or a subtype of `number`.** This matches
the runtime: the tensor fields in `src/compute-engine/tensor/tensor-fields.ts`
are `number`, `complex` and `expression` (an expression standing for a
number). A symbolic matrix `[[x, 1], [0, x]]` already types `matrix<2x2>`.
Consequences: `[True, False]` types `list<boolean>` and `['a', 'b']` types
`list<string>` (they typed `list<boolean^2>` and `list<string^2>`; a
fixed-length sequence of non-numbers is a `tuple`); `matrix<list<integer>>`
and `vector<string>` are parse errors.

Measured cost (slice 2, 2026-10-21): the engine also attaches lengths to
lists of points (`list<tuple<number, number>^3>`, read by the point-list
width typing and the GPU fixed-length lowering), to boolean masks (`M < 3`
over a matrix types `list<boolean^(2x2)>`, read by the element-wise
`When`/`If` gates), to `Map` results and random lists. With the numeric
rule, four GPU compile tests fail (`tycho-item-231`, `pointlist-compile-zip`:
a bound list of three points is a `list<tuple<integer, integer>>` with no
length, so `PointX(P)` lowers to a shader array and `Add` over it is refused;
the Tycho use is a min-distance field over a bound point list), and about
70 tests lose a length in an expected type. With the alternative rule every
one of those passes.

**Implemented rule (the alternative), chosen 2026-10-21 by the session on
the strength of the measurement, to be confirmed by the user:** a list may
carry dimensions when its cell type cannot hold a list (`list<boolean^2>`,
`list<tuple<number, number>^3>`, `list<string^2>`, `list<boolean^(2x2)>`
parse; `list<list<integer>^2>` and `matrix<list<integer>>` do not); the
names `vector<U>`, `matrix<U>` and `tensor<U>` require a cell type that can
hold a number (`vector<string>`, `tensor<boolean>` are parse errors). The
relation reads every dimensioned list by its cells, so both rules are sound;
the numeric rule is a change of `cellTypeMayCarryDimensions()` in
`src/common/type/primitive.ts` plus the tests above. A list of unknown rank
(`dimensions: null`) exists only with numeric cells, because its only
spelling is `tensor<U>`; a broadcast of unknown rank with a non-numeric
result is typed as a plain nested list.

**D4. `broadcastable<T>` is `T | tensor<T>` for numeric `T`.** A list of
numbers of any rank fits `broadcastable<number>`; `list<list<number>>` does
not. For a non-numeric `T` the user's intent was a plain union,
`boolean | list<boolean>` or `string | list<string>`, with no
`broadcastable` node. The inventory of 2026-10-21 (section 3.6) found that
the same node also spells "a point or a list of points"
(`broadcastable<tuple<number, number>>`, point arithmetic) and
"a color or a list of colors" (the color compile target), in about 30
engine sites and 100 test lines, so the implementation keeps the node for
every `T` and gives it the meaning `T | list<T>` (rank 1, the list read by
its elements) when `T` is not numeric. The result is the same set of values
as the spelled union; only the spelling differs. Replacing the non-numeric
spelling with the plain union is a follow-up the user can still ask for,
once this change has landed.

**D5. The two families relate one way.** `matrix<U>` is a
`list<vector<U>>`, `list<vector<U>>` is not a matrix (its rows may differ in
length). A `list<U>` with numeric `U` and a `vector<U>` denote the same set
of values (every list of numbers is a rank-1 tensor): the relation holds in
both directions, without changing either spelling. This reverses the
ROADMAP entry "A list of one-element vectors is a subtype of a list of
scalars" (2026-10-21), which asked for `list<vector<integer^1>>` to be a
`list<integer>`: under D1 it is not, and the entry is closed as decided
the other way.

## 3. Rules

Notation: `dims` is a dimension list; `-1` is an open length.

### 3.1 Representation

`ListType` keeps one node kind. The `dimensions` field distinguishes three
cases:

| `dimensions`   | spelling                    | meaning                                |
| -------------- | --------------------------- | -------------------------------------- |
| absent         | `list<E>`                   | a list whose elements are `E`          |
| `number[]`     | `vector<U>`, `matrix<U>`, `list<U^dims>` | a tensor of that rank, cells `U` |
| `null`         | `tensor<U>`, bare `tensor`  | a tensor of unknown rank (1 or more), cells `U` |

`null` rather than a new node kind: the 100 readers of `dimensions` in
`src/compute-engine` narrow with `if (dims)` or `dims?.`, which then treat an
unknown-rank tensor as a plain list of its cells, the reading they apply
today; the readers that narrow with `!== undefined` fail the typecheck and
are audited one by one. A helper `listRank(t)` returns the rank, or
`undefined` for a plain list or an unknown-rank tensor.

The parser rejects a `vector`, `matrix`, `tensor` or `list<U^dims>` whose
cell type is a concrete type that is not a subtype of `number`. A top
(`any`, `unknown`), `never` and a type variable or reference are accepted,
because a skeleton or a generic declaration spells them. The relation itself
does not depend on D3: a dimensioned list is read by cells whatever its cell
type, so an internally built type stays sound; the restriction is what the
parser and the literal typing produce.

### 3.2 Element type

`collectionElementType(t)`:

- `list<E>`: `E`.
- `list<U^dims>` of rank 1: `U`; of rank `n >= 2`: `list<U^dims[1..]>`.
- `tensor<U>`: `U | tensor<U>`.
- `set<E>`: `E`. `broadcastable<T>`: `T | tensor<T>` read as above, that
  is `T | T | tensor<T>` = `T | tensor<T>`.

### 3.3 Subtype

Lists with no dimensions:

- `list<E1> <: list<E2>` iff `E1 <: E2`.
- `list<E> <: collection<F>`, `<: indexed_collection<F>` iff `E <: F`.
- `list<E> <: list<U^[-1]>` (a `vector<U>` with open length) iff `E <: U`
  (D5). Not for a fixed length, and not for rank 2 or more.
- `list<E> <: tensor<U>` iff `E <: U` (the rank-1 reading).

Dimensioned lists (rank `n`, cells `U`, rows `R` = the element type of 3.2):

- `list<U^dims> <: list<V^dims2>` iff `U <: V`, same rank, and each axis
  of `dims2` is `-1` or equal to the axis of `dims`.
- `list<U^dims> <: tensor<V>` iff `U <: V`.
- `list<U^dims> <: list<E>` iff `R <: E` (`matrix<integer> <: list<vector<integer>>`,
  `vector<integer> <: list<integer>`, `matrix<integer>` not `<: list<integer>`).
- `list<U^dims> <: collection<F>`, `<: indexed_collection<F>` iff `R <: F`.
- `list<U^dims> <: broadcastable<V>` iff `U <: V`.

Unknown-rank tensors:

- `tensor<U> <: tensor<V>` iff `U <: V`.
- `tensor<U> <: list<E>`, `<: collection<E>`, `<: indexed_collection<E>`
  iff `U | tensor<U> <: E`.
- `tensor<U> <: list<V^dims>` never (the rank is not known).
- `tensor<U> <: broadcastable<V>` iff `U <: V`.

Removed: `isScalarTopElement`, `holdsListElements`, `peeledRowMatches`,
`flattenedListMatches`, `rhsHoldsScalars`, the "encoding bridge" peel loop,
the flatten-merge toward a target with no dimensions, and
`flattenNestedListType` where it served the relation. The nested spelling
`list<vector<U^3>^2>` is no longer a legal type (its cells are vectors, D3),
so nothing needs to flatten.

Covariance is restored: `vector<value> <: vector<any>`,
`list<expression^3> <: list<any^3>`.

### 3.4 Meet and join

- `list<E1> & list<E2>` = `list<E1 & E2>`, always: when the element meet is
  `never` the answer is `list<never>`, the type of the empty list `[]`, which
  is a value of both (`list<integer> & list<string>` is `list<never>`, and so
  is `broadcastable<integer> & broadcastable<string>`). A meet of two list
  types is `never` only when their shapes exclude each other
  (`vector<integer^2> & vector<integer^3>`, a rank-1 tensor beside a rank-2
  one).
- `list<U^dims> & list<V^dims2>` = the cell meet with the axis-wise meet of
  the shapes (an open axis meets a fixed one as the fixed one; two different
  fixed lengths give `never`).
- `list<E> & list<U^[-1]>` = `list<(E & U)^[-1]>` (D5).
- `tensor<U> & tensor<V>` = `tensor<U & V>`; `tensor<U> & list<V^dims>` =
  `list<(U & V)^dims>`.
- `list<E> & list<U^dims>` for rank 2 or more: the element meet `E & R`
  decides; the result is `list<U^dims>` when `R <: E`, `never` when the
  element meet is `never`, otherwise kept as an intersection.
- `narrow2` answers the same as the reducer for these pairs. The general
  disagreement between `narrow()` and the reducer on incomparable composites
  stays a separate ROADMAP item.
- `widen` is unchanged except that the join of a dimensioned list and a
  plain list is a plain list of the element join.

The mixed-depth machinery in `reduce.ts` (`elementsAtMixedDepth`,
`elementsCanNest`, `rowsCanHoldCells`, `matrixReadings`, `meetMatrixWith`,
`mayShareMatrix`, `meetShapedWithUnshapedList`, `meetDimensionedElements`,
`scalarsBesideLists`) is removed. `typesOverlap`, `couldMatch` and
`provablyDisjoint` follow the rules of 3.3.

### 3.5 Generics

The admission skeleton of `matrix<T^(MxN)>` no longer needs
`ANY_OR_LIST_ELEMENT` (`any | list<any>` as the cell type): `any` cells are
read as cells, so `list<any^(-1x-1)>` admits every matrix. A generic
`indexed_collection<T>` applied to a matrix binds `T` to the row type
`vector<U>`; applied to a `tensor<U>` it binds `T` to `U | tensor<U>`.

### 3.6 The engine

- The literal typing attaches dimensions only when
  `cellTypeMayCarryDimensions(cell)` holds (D3: the cell is a subtype of
  `number`, or `never`). The sites: `shapedListTypeD` (`collections.ts`
  6278, through `classifyCellD`), `mapResultType` (3448) and
  `zipMapResultType` (3532), PointList (9474), `heldOperandType` (`core.ts`
  1736), `pipeMapResultType` (1774), `randomListType` (2658),
  `elementwiseResultType` (`control-structures.ts` 2258), the point
  quotient and product types (`arithmetic.ts` 2222, 2375, 3350, 9069,
  9150), `broadcastShapedResultType` (`utils.ts` 1902) and its callers in
  `broadcast-lift-type.ts` (2064, 2069) and `boxed-function.ts` (10342),
  and the `missing` arm added to a dimensioned list's cells
  (`broadcast-lift-type.ts` 999 and 1270). `[[1, 2], [3, 4]]` is still
  `matrix<integer^(2x2)>`; `[True, False]` is `list<boolean>`;
  `[(1, 2), (3, 4)]` is `list<tuple<integer, integer>>`; a ragged
  `[[1], [2, 3]]` is `list<vector<integer^1> | vector<integer^2>>`.
- A broadcast over a tensor returns the tensor's shape when the cell result
  is numeric (`Sin(M)` is `matrix<2x2>`), and nested plain lists when it is
  not: `M < 3` is `list<list<boolean>>` (it was `list<boolean^(2x2)>`, a
  spelling the parser now refuses, so it would not round-trip).
- `broadcastableOf(T)` (`boxed-expression/broadcast-lift-type.ts` line
  2333) keeps returning the `broadcastable` node, and the top itself for
  `any`/`unknown` as today. The sites that build the node directly
  (`relational-operator.ts` 2169, `control-structures.ts` 2176, `core.ts`
  1072, `arithmetic.ts` 3266 and 6395) stay. The sites that test
  `kind === 'broadcastable'` keep working, since the node is kept for every
  `T` (D4). The two helpers that read the collection half of the node as
  `list<T>` (`scalarOrCollectionUnionBranches` and `unionArms` in
  `collection-utils.ts`) read it as `tensor<T>` for numeric `T`.
- The sites that read a `null` dimensions as a crash (`!== undefined` then
  `.length`): `linear-algebra.ts` 1209 and 7547, `type-handlers.ts` 1834,
  1913, 2055, 2084, `collections.ts` 9482, `value-membership.ts` 391 (which
  must also read the element of a `tensor<U>` as `U | tensor<U>`),
  `tensor-view.ts` 184, `base-compiler.ts` 14736 and 37329 (which prints the
  declared type and must print `tensor<U>`). The sites that read it as rank
  1 (`type-handlers.ts` 1651, `broadcast-lift-type.ts` 1423, `arithmetic.ts`
  3348, `python-target.ts` 1789) and as "not a fixed shape"
  (`collection-utils.ts` 1738 and 1843, `arithmetic.ts` 2981 and 3018,
  `broadcast-lift-type.ts` 176, `type-guards.ts` 308) decide one route for
  an unknown-rank operand: it is a broadcast trigger, not a tensor-handler
  operand. `transposedShape` (`linear-algebra.ts` 1235) keeps `null`.
- The element-wise condition gates (`BOOLEAN_MASK_TYPE`,
  `BOOLEAN_COLLECTION_TYPE`, `possiblyElementwiseCondition` in
  `control-structures.ts`) accept a nested boolean list when D3 removes the
  dimensions of a mask.
- `mayBeMatrixPowerBase` (`boxed-expression/matrix-operand.ts` 59) answered
  false for a matrix because a matrix matched `list<number>`; under D1 it
  answers true. `Integrate` (`calculus.ts` 4606) respells its result arm
  `list<number>` as `tensor`. `Reshape` (`linear-algebra.ts` 2168) reads
  the cell type through the element type, not `col.elements`.
- The compiled folds (`javascript-target.ts` 10657 to 10690,
  `base-compiler.ts` 17307 `foldsCollectionElements`) take the guarded
  element-wise fold for a `tensor<U>` operand, whose element is
  `U | tensor<U>`.
- `fitsBroadcastOrIndexed` (`subtype.ts`) reads a list by 3.2 and 3.3; no
  flat reading.
- Library signatures: `Norm` and `Trace` spell `tensor` and keep admitting
  matrices through `tensor<U>`. The statistics signatures spell
  `collection<any>` and keep admitting a matrix; `collectData` refuses a row
  at run time as before. Every signature that spells `list<number>` to mean
  "a numeric array of any rank" must be found and respelled `tensor`:
  the inventory is part of slice 2.
- The `unknown` marker work of 2026-10-21 (commit `7cbbd3a50`) is preserved:
  the `rhs === 'unknown'` early return, `provablyAdmits`, `acceptsParameter`,
  `joinUnresolvedArm`, `narrow2` treating `unknown` as the identity, the
  `covers` rule of `reduceUnionType`, and the tuple branch of
  `collectionElementType`. `test/compute-engine/unknown-inference-marker.test.ts`
  pins them.

## 4. Measured cost (experiment of 2026-10-21, disposable worktree at
`6d4651eaa`, `subtype.ts` alone changed to the element reading)

| group                                               | tests |
| --------------------------------------------------- | ----- |
| library signature fed a matrix (`Norm`, `Trace`, spelled `tensor`) | 78 |
| tests that pin the cell reading itself              | 65    |
| inference results that change (broadcast wrapper, generic one-level wrap) | 3 |

The 78 vanish once `tensor<U>` has its own meaning. The 65 are rewritten to
the new rules (files: `list-subtype-transitivity` 33,
`broadcastable-list-meaning` 16, `type-relation-gaps` 10,
`dimension-variables` 2, `list-shape-typing` 2, `type-variables` 1,
`type-variables-collections` 1, `tycho-373-passthrough-broadcast-typing` 1,
`machine-broadcast` 1, `batch9-series-residue-subtype` 2). Nine of them pin
decisions of 2026-10-21 that D1 reverses on purpose: a matrix is not a
`vector<unknown>` or a `vector<any>` (still true under D1, since the rank
differs), and `list<vector<integer^3>>` is a `list<integer>` (false under
D1).

## 5. Implementation slices

One worktree, `/private/tmp/wt-list-element-20261021`, cut from `119beb329`.
Each slice ends with the typecheck clean and its targeted tests green. The
full suite runs once under the box lock at the end, with the snapshot count
reported. One dual review of the whole diff before it is applied to the
main tree.

**Slice 1: the type system** (`src/common/type/`, `test/common/type/`).
`types.ts` (`dimensions?: number[] | null`, `listRank`), `ast-nodes.ts`,
`parser.ts` (`tensor` builds the `null` form; the D3 check), `type-builder.ts`,
`serialize.ts` (`tensor<U>` prints from the `null` form; `list<number>`
prints `list<number>`), `intern.ts`/`shapeKey` (null distinct from absent),
`subtype.ts` (3.3, `fitsBroadcastOrIndexed`, the `broadcastable` rules),
`reduce.ts` (3.4), `utils.ts` (3.2, `staticCollectionDims`),
`instantiate.ts` (3.5), `omission.ts`, `variance.ts`, `size-cap.ts`,
`widen-value.ts`, `conditional-conformance.ts` where they read dimensions.
Acceptance: every relation in section 3 holds on `parseType` inputs; a
corpus check of 120 types reports no covariance, transitivity or
antisymmetry violation; `test/common/type` green;
`unknown-inference-marker.test.ts` green.

**Slice 2: the engine** (`src/compute-engine/`). The literal typing, the
broadcast result typing, `broadcastableOf`, the dispatch sites of 3.6, the
compile targets, the `tensor` respelling of library signatures, the
`collectionElementType` consumers. Acceptance: the soundness probe of
section 1 answers `incompatible-type` at the declaration, `Mean` of a matrix
is refused statically, `Norm`/`Trace` of a matrix evaluate, `Sin(M)` keeps
its shape, `M < 3` is `list<list<boolean>>`, the targeted suites
(`linear-algebra`, `compile-*`, `broadcast*`, `collections*`, `tycho-*`)
green or rewritten.

**Slice 3: tests and documents.** The pinned tests of section 4 rewritten
to the rules; `ROADMAP.md` (the entry of D5 closed, the `narrow` versus
reducer residue recorded); `CHANGELOG.md` Unreleased (breaking: the three
readings); `docs/TYPE-SYSTEM.md`; `doc/08-guide-types.md`; the "Common API
Traps" entry of `ARCHITECTURE.md`; `src/api.md` through `npm run doc` if the type
grammar is in it.

Coordination: session `ce-unknown-workstream` holds its edits to
`src/common/type/*` and the list typing in `library/collections.ts` until
this diff is on the main tree, and re-runs `unknown-inference-marker`,
`bare-families` and `type-relation-gaps` after it lands.

## Implementation record (2026-10-22)

The change is on the main tree as uncommitted changes. A code review of the same
day changes two rules (see "Rules changed by the code review" below).

**What landed, by area.**

- The type system (`src/common/type/`): `types.ts` (`dimensions` can be `null`;
  `listTensorRank()`), `parser.ts` and `type-builder.ts` (the `null` form for
  `tensor<U>`, the two cell rules), `primitive.ts`
  (`cellTypeMayCarryDimensions()`, `cellTypeCanHoldANumber()`), `serialize.ts`,
  `intern.ts`, `subtype.ts` (the relation of section 3.3, the `broadcastable`
  rules, `listElementType()`, `listShapeKey()`), `reduce.ts` (the meet of
  section 3.4), `utils.ts` (the element type of section 3.2,
  `broadcastShapedResultType()`), `instantiate.ts` (the generic solver) and
  `conditional-conformance.ts` (a pattern `list<T>` binds `T` to the elements of
  the receiver).
- The engine (`src/compute-engine/`): the broadcast typing
  (`boxed-expression/broadcast-lift-type.ts`, `boxed-function.ts`,
  `arithmetic-add.ts`, `tensor-view.ts`, `type-guards.ts`,
  `value-membership.ts`, `collection-utils.ts` with `leafwardElementType()`),
  the libraries (`library/arithmetic.ts`, `calculus.ts`, `collections.ts`,
  `control-structures.ts`, `core.ts`, `linear-algebra.ts`, `type-handlers.ts`),
  the protocols (`engine-protocols.ts`) and the compile targets
  (`compilation/base-compiler.ts`, `javascript-target.ts`,
  `interval-javascript-target.ts`, `python-target.ts`).
- The tests: about 40 files in `test/compute-engine/` rewritten to the new
  rules, and the new file `test/common/type/list-element-tensor-cell.test.ts`.
- The documents: `CHANGELOG.md` (the Breaking Changes entry "A list type with no
  dimensions is read by its elements" and a Resolved Issues entry),
  `docs/TYPE-SYSTEM.md` (section "Lists, tensors and `broadcastable`"),
  `ARCHITECTURE.md`, `ROADMAP.md`, and the local files `ARCHITECTURE.md` and
  `doc/08-guide-types.md`.

**The cell rule chosen, and why.** A list with dimensions can have any cells
that cannot hold a list: `list<boolean^2>`, `list<string^2>` and
`list<tuple<number, number>^3>` are valid, and the types of the literals do not
change (`[True, False]` is still `list<boolean^2>`). The cells of a type spelled
`vector<U>` or `matrix<U>` must be able to hold a number. The rule of decision
D3 (numeric cells for every list with dimensions) was measured and not applied:
a bound list of points lost its length, so the GPU target refused a
minimum-distance field over a list of points (four tests), and about 70 expected
types lost a length. The relation reads every list with dimensions by its cells,
so both rules are sound, and the numeric rule is a change of
`cellTypeMayCarryDimensions()` alone.

**Rules changed by the code review (2026-10-22).** `tensor<U>` takes the same
cell types as `list<U^dims>`: `tensor<boolean>` and
`tensor<tuple<number, number>>` are valid, `tensor<list<integer>>` is not.
`broadcastable<T>` is `T | tensor<T>` for every `T` that cannot hold a list; the
reading `T | list<T>` for a `T` that is not a number type is removed, because a
comparison over a matrix gives a matrix of booleans, which
`boolean | list<boolean>` does not hold. A broadcast of unknown rank with a
result that is not a number is typed `tensor<R>` (`T < 3` with
`T: tensor<integer>` is `tensor<boolean>`). These rules replace the `tensor<U>`
part of the "Implemented rule" under D3 and the reading `T | list<T>` of D4 in
section 2. The documents follow these rules; their examples were not measured on
the tree when the documents were written.

**Defects of 0.161.0 fixed along the way.**

- `provablyAdmits('nothing', 'broadcastable<unknown>')` was `true`, so a symbol
  declared `(broadcastable<unknown>) -> unknown` refused the literal
  `(x) => (x, x)`.
- A generic function literal over a ragged list was typed by the rows:
  `g([[1], [2, 3]])` with `g` the literal `(x: T) -> tuple<T, T> where T`
  claimed tuples of rows, a type that does not hold the value. It is now
  `list<list<tuple<integer, integer>>>`.
- `mayBeMatrixPowerBase()` (`boxed-expression/matrix-operand.ts`) read a matrix
  as a `list<number>`, so it answered that the base of a power could not be a
  matrix.

**Full suite.** 60 failing tests, all in four files that fail on `HEAD` too:
`collection-type-followups`, `collection-absent-followups`,
`map-over-tuple-result` and `tuple-argument-binding`. 59 failures are identical
to `HEAD`. One is different: test 10 of `collection-type-followups`,
`Map(First, [[], [3]])`, is now typed `list<integer | nan>` where the test
expects `list<any>`. The new type is sound and more precise. No snapshot changed
(0 of 4,271).

**Open user decisions.** Each one is also in `ROADMAP.md`, section "User
decisions owed by the change that reads a list type by its elements".

- Confirm the cell rule of a list with dimensions (any cells that cannot hold a
  list), or ask for the numeric rule of decision D3.
- Confirm that `tensor<U>` takes any cell type that cannot hold a list, not only
  numbers (chosen during the code review because it is the sound reading of
  `broadcastable<boolean>`).
- `Mean` of a matrix: the statistics functions accept a matrix when the
  expression is boxed and refuse it when it is evaluated. Option A: respell the
  data parameter. Option B: a check in the canonical handler.
- A cell pattern `vector<T>` or `list<T^N>` now refuses a matrix, where it bound
  `T` to the rows before: confirm, or ask for the old binding.
