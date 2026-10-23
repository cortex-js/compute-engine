# Type System Model

**Status:** normative internal reference for the implemented type system.

This document records the type-system invariants that implementation code may
rely on. Public syntax and API behavior belong in `doc/08-guide-types.md`; open
work belongs in `TYPE_SYSTEM_ROADMAP.md` or an active file under `plans/`.

## Type algebra and compatibility

- Types are immutable values parsed into the `Type` AST in `src/common/type/`.
- Subtyping is a set-containment question. Compatibility is the directional
  admission relation used at call and assignment boundaries; it may admit an
  operand that is not a subtype when the operand is not provably unusable.
- `unknown` means information is not yet available. It must not be treated as
  either `any` or a proof of incompatibility. `any` is an explicit dynamic
  boundary.
- Union, intersection, negation, value types, numeric ranges, records,
  collections, arrows, and nominal references are reduced without attaching
  mutable provenance to `Type` objects.
- Absence in a numeric result normalizes to `NaN`. `Missing` remains a
  non-numeric absence value and comparisons over it use three-valued logic.

### The subtype hierarchy and the role of `unknown`

`unknown` is an inference marker, not a content type (user decisions D1 to
D5, 2026-10-21, `plans/2026-10-21-unknown-inference-marker.md`). It asks
the engine to determine a type; it does not promise that a datum is
present, absent or of any particular content. The subtype relation reads it
so:

```text
never <: every type
integer <: value <: expression
function <: expression
symbol <: expression
every type <: unknown          (any, error, missing and nothing included)
unknown <: any
unknown <: unknown
```

So `isSubtype(X, 'unknown')` is true for every `X`, and `unknown` is a
subtype only of `any` and of itself: `unknown` proves no contract. A test
for "a value, not a marker" is spelled `expression` or `value`, not
`unknown`. `never` is the bottom type, below all types, including
`unknown`, `error`, `nothing` and `missing`.

Because every type is below `unknown`, `isSubtype('nothing', t)` answers
"can `t` hold `Nothing`?", and an `unknown` arm makes the answer true. A
site that needs EVIDENCE that a type admits a marker asks
`provablyAdmits('nothing' | 'missing' | 'error', t)` (`subtype.ts`), which
ignores an `unknown` arm and reads a union or a `broadcastable<T>` one arm
at a time.

Joins and meets:

- The general join is neutral in `unknown`, as in `never`:
  `widen('unknown', 'integer')` is `integer`. The inference joins read
  `unknown` as "no information yet" (the seed of a recursion fixpoint, a
  call whose callee is not derived yet).
- A join derived from a VALUE keeps the unresolved arm:
  `joinUnresolvedArm()` (`subtype.ts`) for the slots of a tuple (beside
  absence markers only, so a free symbol in a point stays a numeric slot)
  and for the element join of `ListJoin`/`Join`.
- The reducer absorbs a value arm into `unknown` (`integer | unknown` is
  `unknown`), keeps an absence arm beside it (`missing | unknown`), and
  reduces a union with an `error` arm to `error`.
- A meet resolves `unknown`: `narrow('unknown', 'integer')` is `integer`.

A function signature with a parameter that is not inferred yet,
`(unknown, unknown) -> number`, does not satisfy `(any, any) -> number`:
`acceptsParameter()` (`subtype.ts`) lets such a parameter accept an
`expression`, not `any` or an absence marker. The generic solver does not
read an `unknown` parameter as evidence for a type variable
(`signatureHasUnresolvedParameter()`, `instantiate.ts`).

`value` accepts data values, including scalars, collections, objects and
opaque values such as regular expressions. `expression` also accepts
functions and symbols. Both exclude the immediate `missing`, `nothing` and
`error` types, but include numeric `nan`, and therefore `NaN` and
`Indeterminate`. These contracts alone do not establish presence for
`IsMissing`, `??` or the presence assertion `x?!`; the absence predicate
(`isMissingValue`) includes both numeric markers. See the
[numeric absence amendment](ERROR-MODEL.md#numeric-absence-handling--agreed-change-of-2026-10-20).

As a declaration, an `unknown` element or slot asks for refinement: bare
`list`, `list<unknown>`, bare `tuple`, bare `record` and a transparent alias
of any of them refine from each assignment (`xs: list<unknown> := [1,
Missing]` reports `list<integer | missing>`), while `list<any>` is a
contract that never moves (`placeholderSkeletonOf()`,
`boxed-value-definition.ts`). A nested `unknown` position
(`list<tuple<unknown, integer>>`) does not refine.

### Declared types and absence

A declared type is a contract on every value the symbol takes (user
decisions P1 and P1b, 2026-10-21,
`plans/2026-10-21-presence-contracts-and-assertion.md`). `s: string`
refuses `Missing` and `Undefined` as it refuses `5`, and `xs: list<string>`
refuses `["a", Missing]`. Write the absence into the type when it is
possible: `string | missing`, `list<string | missing>`, or a refining
declaration (`list`, `list<unknown>`). `number` admits `NaN`; `real`,
`integer` and `complex` hold finite values only and refuse it, so
`real | nan` is the declaration that admits it. The check is
`matchesDeclaredTypeAxes()` (`effects-inference.ts`) on the engine's
assignment route and the Epsil run time, and `declaredTypeMismatch()`
(`src/epsil/static-diagnostics.ts`) in the Epsil static check, which also
reports a possibly absent initializer (`let y: string = xs[i]`, typed
`missing | string`; `let r: real = zs[i]`, typed `nan | real`).

A library operator with no declared absence behavior refuses an absent
operand at a parameter typed as data (`string`, `boolean`, `value`, …) with
`incompatible-type` (decision P2, `refusesAbsentOperandAt()`,
`boxed-operator-definition.ts`). Numeric, collection, function,
`expression`, `symbol`, `any` and `unknown` parameters are exempt, and so
are lazy and held operators. The discharges are `x ?? fallback`, an
`isMissing` guard (narrowed for the static check by
`src/epsil/presence-narrowing.ts`), and `x?!`. The type of `x?!` is
`presentType()` of the operand (`common/type/coalesce.ts`): the type without
`missing` and `nan`, with `nothing` kept. The type of `x ?? y` is
`presentType(Tx) | Ty` (`coalesceResultType()`): the last fallback is
returned even when it is absent, so with `y: missing` the result is still
possibly absent.

## Collection family contracts

A bare collection name constrains kind, not contents. `list`, `set`,
`dictionary`, `collection` and `indexed_collection` accept exactly the same
values as their explicit `<any>` forms. Bare `tuple` accepts every tuple,
regardless of arity or slot types; `tuple<any>` has exactly one slot. Bare
`record` accepts every record. This does not make a missing whole collection
an instance of that family.

Use `list<integer>` for integer elements, `list<expression>` to exclude
immediate `missing`, `nothing` and `error`, or `list<value>` to exclude
immediate functions and symbols as well. These restrictions are immediate:
a nested collection is itself a value. Numeric `NaN` and `Indeterminate`
remain numeric outcomes, even where named absence markers are excluded.

Explicit element arguments remain explicit through parsing, reduction and
serialization. In particular, `<unknown>` no longer collapses into a bare
family name; bare `list` and `list<unknown>` denote the same values and both
refine as declarations (previous section). The numeric
defaults and rank constraints of vector, matrix and tensor spellings remain;
the next section gives their rules.

Compiler shape checks cannot use a bare kind as proof that its elements
exclude Nothing. A raw lazy collection can retain omitted positions. Until
compiled targets have a distinct omission representation, operations that
need that distinction require an explicit omission-free content contract,
a structural proof, or a compilation refusal.

### Lists, tensors and `broadcastable`

A list type with no dimensions is read by its ELEMENTS, the values that indexing
returns. A list type with dimensions (a `list<U^n>`, a vector, a matrix, a
`tensor<U^dims>`) and a tensor of unknown rank are read by their CELLS, the values at the depth of the rank. The two
readings do not mix: a matrix of integers is a `list<vector<integer>>` and a
`list<list<integer>>`, and it is not a `list<integer>`.

**The three forms.** A list type is one node kind, `ListType`
(`src/common/type/types.ts`). Its `dimensions` field selects the form:

| `dimensions` | Spelling                                                  | Meaning                                         | Element type                                                 |
| ------------ | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| absent       | `list<E>`                                                 | a list whose elements are `E`                   | `E`                                                          |
| an array     | `list<U^n>`, `vector<U>`, `matrix<U>`, `tensor<U^(dims)>` | a tensor of that rank, with cells `U`           | rank 1: `U`; rank 2 or more: the rows, `tensor<U^dims[1..]>` |
| `null`       | `tensor<U>`, bare `tensor`                                | a tensor of unknown rank (1 or more), cells `U` | `U \| tensor<U>`                                             |

`-1` in `dims` is an axis of any length, spelled `?`. In the tables below,
`tensor<U^dims>` stands for every spelling of the second form, whatever its
rank. `listTensorRank(t)`
(`src/common/type/types.ts`) returns the rank of the second form, and
`undefined` for the other two. `collectionElementType()`
(`src/common/type/utils.ts`) returns the element type of the table. `set<E>` is
read like `list<E>`: its elements are `E`. A code site that reads `dimensions`
must handle all three values: `if (dims)` treats a `tensor<U>` as a plain list
of its cells, and `dims !== undefined` followed by `dims.length` fails on it.

**The cells and the axes.** A list has elements and may have a length;
`vector`, `matrix` and `tensor` have cells, of any type that is not a list, and
may have a shape. The bare names `vector`, `matrix` and `tensor` mean number
cells. The type builder (`src/common/type/type-builder.ts`) applies two rules:

- The cells of every head with a shape cannot be lists
  (`cellTypeMayCarryDimensions()` in `src/common/type/primitive.ts`,
  re-exported by `utils.ts`). The predicate refuses a list of any form,
  `collection`, `indexed_collection`, `broadcastable`, the bare names of these
  families, and a union or an intersection with such an arm. So
  `list<list<integer>^2>`, `list<vector<integer^3>^2>`, `list<list^2>`,
  `matrix<list<integer>>` and `tensor<list<integer>>` are parse errors: the
  shape is written in one place. The error names that spelling when it can be
  found: `list<list<integer^3>^2>` is refused with "Write
  `matrix<integer^(2x3)>`". Every other cell type is valid with every head:
  `list<boolean^2>`, `vector<string^3>`, `list<tuple<number, number>^3>`,
  `matrix<boolean^(2x2)>`, `matrix<boolean>`, `list<(integer | missing)^3>`,
  `tensor<boolean>` and `tensor<tuple<number, number>>` parse.
- A `list` has one axis at most, its length (`list<integer^3>`). A list with two
  or more axes is refused, with an error that names the spelling to use:
  `list<boolean^(2x2)>` and `list<boolean^2x2>` give "Write
  `matrix<boolean^(2x2)>` instead", `list<integer^(2x3x4)>` gives "Write
  `tensor<integer^(2x3x4)>` instead". The same holds with `?` and with
  dimension variables (`list<T^(MxN)>` is refused, `matrix<T^(MxN)>` is
  valid).

These are the user decisions of 2026-10-22 (option U of
`docs/plans/2026-10-22-list-lengths-and-tensor-shapes.md`). Before them a
`vector` or `matrix` cell had to be able to hold a number, and an array of
booleans of rank 2 was spelled `list<boolean^(2x2)>`.

**The printed form.** `typeToString()` (`src/common/type/serialize.ts`) is the
only function that chooses the head, by rank. Rank 1 is `vector<…>` when the
cells can hold a number (`cellTypeCanHoldANumber()`, which only the printer
asks) and `list<E^n>` otherwise: `vector<integer^3>`, `list<boolean^2>`, and
`vector<string^2>` prints `list<string^2>`. Rank 2 is always `matrix<…>`:
`matrix<integer^(2x2)>`, `matrix<boolean^(2x2)>`, `matrix<boolean>` for open
axes, and `matrix<2x2>` for number cells. Rank 3 or more is
`tensor<U^(…)>`: `tensor<integer^(2x3x4)>`. An unknown rank is `tensor<U>`.
Every printed form parses back to the same type.

The engine asks `cellTypeMayCarryDimensions()` before it attaches dimensions to
the type of a list literal, a broadcast or a `Map` result: `[[1, 2], [3, 4]]` is
`matrix<integer^(2x2)>`, `[True, False]` is `list<boolean^2>`,
`[(1, 2), (3, 4)]` is `list<tuple<integer, integer>^2>`, `M < 3` with
`M := [[1, 2], [3, 4]]` is `matrix<boolean^(2x2)>`, `(1, 2) * M` is
`matrix<tuple<integer, integer>^(2x2)>`, and the ragged `[[1], [2, 3]]`
is `list<vector<integer^1> | vector<integer^2>>`. A broadcast whose result rank
is not known (over operands of different ranks, over an operand whose type is a
union of ranks, or over a tensor of unknown rank) is typed `tensor<R>` for a
result `R` that cannot hold a list: `U + 1` with
`U: list<integer> | matrix<integer>` is `tensor<integer>`, and `T < 3` with
`T: tensor<integer>` is `tensor<boolean>`. A symbol declared `broadcastable<T>`
that holds a list is read as a tensor of unknown rank too: with
`b: broadcastable<number>` holding a list, `-b` is `tensor`. An operand whose
elements may be lists of any depth (`any`, bare `list`, `list<any>`, a bare
`indexed_collection`) is mapped at its leaves, so the result type holds lists
at any depth: `Sin(xs)` with `xs: list<any>` is `list<list<any> | number>`, and
`C < 2` with `C: indexed_collection` is `list<boolean | list<any>>`
(`broadcastShapedResultType()` and `unknownShapeOperandDepth()`, `utils.ts`).
An element-wise `Which` or `If` reads such a mask as element-wise
(`isPossiblyNestedBooleanMask()`, `library/control-structures.ts`): a flat
value selects position by position, and a nested value does not evaluate.

The subtype relation does not depend on these rules: a list with dimensions is
read by its cells, whatever its cell type. A stricter rule, under which every
list with dimensions and every tensor has numeric cells, is a change of
`cellTypeMayCarryDimensions()` alone. It was measured on 2026-10-21 and not
applied: a bound list of points then loses its length, so the GPU target refuses
a minimum-distance field over a list of points (four tests), and about 70
expected types lose a length. The user can still choose it
(`docs/plans/2026-10-21-list-element-tensor-cell.md`, decision D3).

**Subtype.** `R` is the element type of the left side, from the table above (the
rows of a matrix).

| Left           | Right                                               | Holds when                                                                               |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `list<E1>`     | `list<E2>`                                          | `E1 <: E2`                                                                               |
| `list<E>`      | `collection<F>`, `indexed_collection<F>`            | `E <: F`                                                                                 |
| `list<E>`      | `list<U^-1>` (a `vector<U>` of any length)          | `E <: U`; never for a fixed length or a rank of 2 or more                                |
| `list<E>`      | `tensor<U>`, `broadcastable<U>`                     | `E <: U`                                                                                 |
| `tensor<U^dims>` | `tensor<V^dims2>`                                   | `U <: V`, the same rank, and each axis of `dims2` is `-1` or equal to the axis of `dims` |
| `tensor<U^dims>` | `tensor<V>`                                         | `U <: V`                                                                                 |
| `tensor<U^dims>` | `broadcastable<V>`                                  | `U <: V`                                                                                 |
| `tensor<U^dims>` | `list<E>`, `collection<E>`, `indexed_collection<E>` | `R <: E`                                                                                 |
| `tensor<U>`    | `tensor<V>`, `broadcastable<V>`                     | `U <: V`                                                                                 |
| `tensor<U>`    | `list<E>`, `collection<E>`, `indexed_collection<E>` | `U \| tensor<U> <: E`                                                                    |
| `tensor<U>`    | `tensor<V^dims>`                                    | never: the rank is not known                                                             |

Examples: `matrix<integer>` is a `list<vector<integer>>`, a
`list<list<integer>>`, a `collection<vector<integer>>` and a `tensor<integer>`,
but not a `list<integer>` or a `collection<integer>`. A `list<vector<integer>>`
is not a matrix, because its rows can have different lengths. A `list<U>` with a
number type `U` and a `vector<U>` denote the same values, so the relation holds
in both directions between them. `list<integer>` and `list<list<integer>>` are
not related. The relation is covariant in the cell type and in the element type:
`vector<value>` is a `vector<any>`, and `list<expression^3>` is a `list<any^3>`.

**`broadcastable<T>`** is `T | tensor<T>` for a `T` that cannot hold a list (a
number type, `boolean`, `string`, a tuple, `integer | missing`). A matrix of
numbers is a `broadcastable<number>`, and a matrix of integers is a
`broadcastable<integer | missing>`; a `list<list<number>>` is not a
`broadcastable<number>`, because its rows can have different lengths.
`broadcastable<boolean>` is `boolean | tensor<boolean>`: a comparison over a
matrix gives a matrix of booleans, which `boolean | list<boolean>` does not
hold. `broadcastable<tuple<number, number>>` is a point or an array of points of
any rank. The node is kept for every `T` (`broadcastableOf()` builds it), so a
site that tests `kind === 'broadcastable'` sees every spelling. Its element type
is `T | tensor<T>`; for a `T` that can hold a list or can be indexed (a tuple,
a string, a record, a dictionary), what an index returns
(`indexElementType()`, used only by `At` with a scalar or a gather index,
`First`, `Second`, `Third`, `Last` and the selectors `Take`, `Drop`, `Rest`,
`Most`, `Slice`) also includes the elements of `T`
itself, so an index into `broadcastable<vector<2>>` is `number | vector<2>`,
an index into `broadcastable<tuple<number, number>>` is
`number | tuple<number, number> | tensor<tuple<number, number>>`, and an index
into `broadcastable<string>` is `character | string | tensor<string>`. A tuple
or a string is still one cell for broadcasting.
`broadcastable<T>` is a subtype of `T | tensor<T>`, and not
of `T | list<T>`: a site that accepts a number or a numeric array of any rank
spells `number | tensor`.

**Meet.**

- `list<E1> & list<E2>` is `list<E1 & E2>`. When the element meet is `never`,
  the result is `list<never>`, the type of the empty list `[]`, which is a value
  of both: `list<integer> & list<string>` and
  `list<integer> & list<list<integer>>` are `list<never>`.
- `tensor<U^dims> & tensor<V^dims2>` is the cell meet with the meet of the
  shapes, axis by axis: an axis of any length meets a fixed length as the fixed
  length, and two different fixed lengths give `never`.
  `matrix<integer^(2x?)> & matrix<number^(?x3)>` is `matrix<integer^(2x3)>`;
  `vector<integer^2> & vector<integer^3>` and
  `matrix<integer> & vector<integer>` are `never`. A meet of two list types is
  `never` only when their shapes exclude each other.
- `list<E> & list<U^-1>` is `list<E & U>`: `list<integer> & vector<number>` is
  `list<integer>`. A `vector<U>` of any length and a `list<U>` hold the same
  values when `U` cannot hold a list, so the reducer drops the open axis.
- `tensor<U> & tensor<V>` is `tensor<U & V>`, and `tensor<U> & tensor<V^dims>`
  is `tensor<(U & V)^dims>`: `tensor<number> & matrix<integer>` is `matrix<integer>`.
- `list<E> & tensor<U^dims>` with a rank of 2 or more is decided by the meet of
  `E` and the rows `R`: the result is `tensor<U^dims>` when `R <: E`
  (`list<vector<number>> & matrix<integer>` is `matrix<integer>`), `never` when
  the meet of `E` and `R` is `never` (`list<integer> & matrix<integer>`), and
  the intersection as written otherwise.

These rules are the rules of the type reducer (`reduceType()`,
`src/common/type/reduce.ts`). `narrow()` (`src/common/type/subtype.ts`) gives
the same answers for two list types, but it answers `never` for some pairs of
different kinds that share values
(`matrix<number> & collection<vector<integer>>` is `matrix<integer>` in the
reducer): `ROADMAP.md` records this as an open defect.

**Join.** The join (`widen()`) of a list with dimensions and a plain list is a
plain list of the join of their elements: `matrix<integer>` and `list<integer>`
join to `list<integer | vector<integer>>`.

These rules replace, since the user decisions of 2026-10-21, a relation that
also read the `E` of `list<E>` as a cell type, so that a matrix was a
`list<number>`. What changed for users is in the `CHANGELOG.md` entry "A list
type with no dimensions is read by its elements".

## Number literal types

The public `.type` of a number literal is its literal type: the most precise
claim available at that expression. `ce.box(21).type` is `21` and
`ce.box(0.5).type` is `0.5`. The form of the claim depends on the value:

- When a machine double holds the value exactly, the type is that value. An
  exact rational is the exception: it keeps its tier through a singleton
  range, so `1/2` types `rational<0.5..0.5>`. The lattice deliberately does
  not class a bare numeric value as rational — `0.5 <: rational` is false —
  so a bare value type would lose the tier.
- When no machine double holds the value exactly, the type is a compact
  closed range on the tier of the value. Both bounds are rounded outward to
  two significant digits: `1/3` types `rational<0.33..0.34>`, `√2` types
  `real<1.4..1.5>`, and `10³⁰ + 1` types `integer<9.9e+29..1.1e+30>`. The
  bounds provably contain the exact value and exclude zero, so the sign of
  the literal stays a type fact, and the range is never a singleton. A
  magnitude outside the range of normal doubles has no sound compact
  enclosure and falls back to a sign-only claim: `10⁴⁰⁰` types
  `(integer<0..>) & !0`.
- `NaN` and `±∞` are singleton value types like any other exactly held
  value: `ce.box(NaN).type` is `NaN` and `ce.box(Infinity).type` is
  `+oo`. A complex literal has no literal type, because its tier already
  carries all the information. String and boolean literals are not
  affected: they report `string` and `boolean`.

Consumers may read the bounds of an enclosing range as a type fact. A domain
check does exactly that, which is why `Arcsin(1/3)` types `real`.

A literal type lives at an EXPRESSION position only. Every storage position
widens it back to its tier: an inferred declaration, a solved type variable
(`identity(5)` binds `T = integer`, never `5`), a derived function-literal
signature (`() -> 21` is stored as `() -> integer`) and a stored handler
result. A literal type is therefore never a stored
contract, and code that classifies a numeric type must use subtyping, never
the name of the type.

The implementation is `_computeLiteralType` and `literalEnclosureType` in
`src/compute-engine/boxed-expression/boxed-number.ts`.

### Composite types carry tiers

A literal value type belongs to a number-literal NODE only. Every composite
type synthesized from a value — a tuple, a list, a set, a sequence, a point
list, a record or dictionary, the body of a mapping stage, a held literal —
is a stored contract, and a stored contract carries each numeric component's
TIER: `(√2, 1)` types `tuple<real, integer>`, `{x: 1/3}` types
`record{x: rational}`, `[0.5, 1]` types `vector<real^2>`. The component
nodes keep their literal types (`(√2, 1)` has `op1.type` equal to
`real<1.4..1.5>`). The tier is read directly off the literal's value
(`numberLiteralTierType`, `boxed-expression/literal-tier.ts`; a container
type handler reads it as the `tier` of the literal's structure node), so a
composite of many literals is typed without building one literal type per
component only to widen it away.

The rule applies to number LITERALS. A non-literal component contributes its
own type as it stands: an application's range claim (`Abs(r)` claims
`real<0..>`, so `(|r|, 1)` types `tuple<real<0..>, integer>`), a declared
constant's ranged type (`Pi`), a symbol's declared or inferred type.

The tier of a non-finite literal follows `widenValueTypes`: `NaN` is `nan`,
a signed infinity is the pair `+oo | -oo` (never the lone singleton, so a
contract inferred from one observed `+∞` does not reject a later `−∞`, and
never `infinity`, which would also admit `~oo`), and `~oo` is `infinity`.

Flat composite types — a tuple, list, set, dictionary or record whose
components are all primitive names or other flat composites — are interned
(`common/type/intern.ts`): equal types are one frozen object, so the 5,000
cells of a point list are one `tuple<real, real>` and the list's element
fold joins them by identity. The contract and its cost are pinned in
`test/compute-engine/composite-type-synthesis.test.ts`.

## Polymorphism

Universal variables are written in a trailing `where` clause:

```text
(T, mapping: (T) any -> U) -> U where T, U
```

The prefix `forall` spelling is not supported. A variable may have a ground
bound, and instantiation must respect variance and every occurrence of that
variable. Generic function literals, generic aliases, and parameterized
nominal types share the same variable representation and instantiation
machinery.

A clause variable has one of two KINDS, decided by where it occurs. A
variable that occurs only at type positions is a type variable, solved by
joining the types of the operands it meets. A variable that occurs in a
collection's length slot (`list<T^N>`, `vector<T^N>`, `matrix<T^(MxN)>`), or
that fills a nominal type's value parameter, is a VALUE variable: it stands
for a non-negative integer length, it is solved by equality across every position
it occurs in (two operands that pin it to different lengths reject the later
one), and at a type position (`(n: N, x: vector<T^N>) -> N where T, N`) it
denotes the singleton type of that value, bound from a literal's type (`3`,
or a declared `integer<3..3>`). An operand whose type states no length binds
nothing and is admitted, as at a literal length. A solved value variable
substitutes as the value-literal type (`Length([1,2,3])` declared
`(list<T^N>) -> N` is typed `3`); an unsolved one reads as its bound,
`integer<0..>` unless the clause declares a narrower integer range. In a list
type the variable is stored as the `-1` wildcard plus a name
(`ListType.dimensionVariables`), so every reader of lengths sees "length not
known" without change. A nominal type may take a value parameter (`type
permutation<N> = list<integer^N>`): its constructor solves the length
(`permutation([2,1,3])` is `permutation<3>`, and the empty list fixes the
length 0: `permutation([])` is `permutation<0>`), two solved applications are
unrelated unless equal, and an unsolved one prints as the family
`permutation<integer<0..>>`. The kind is named `value`, not `dimension`,
because booleans and strings are meant to join once their literals carry
singleton types; arithmetic between lengths (`^(M+N)`) is not supported.
Design record: `docs/plans/2026-09-29-dimension-variables-design.md`.

A generic function whose parameter is a bare type variable maps over a
collection operand at its leaves, and the call type puts back every list level
it went through (`genericLiftLevels()`, `boxed-expression/boxed-function.ts`,
with `liftedElementTypeOf()` in `instantiate.ts`). With
`f: (x: T) -> tuple<T, T> where T`, `f(h)` for `h: list<list<integer>>` is
`list<list<tuple<integer, integer>>>`, and an `indexed_collection` or
`broadcastable` operand is read the same way. When the operand type is a union
whose options the call reads differently (a list is mapped, a set or a scalar is
passed whole), the result is the join of one answer per option:
`f(u)` for `u: list<integer> | set<integer>` is
`list<tuple<integer, integer>> | tuple<set<integer>, set<integer>>`. A
`collection<E>` operand can be either, so it gets both answers. With several
such operands, every combination is typed; above eight combinations the result
is `any` (`operandArms()`, `boxed-function.ts`).

Transparent aliases substitute their arguments into their body. Nominal types
mint identity: structural equality with the body is not membership. A
parameterized nominal reference retains its type arguments and variance;
recursive nominal references are resolved through the global registry instead
of eager alias expansion.

## Declarations and the global registry

Type and protocol declarations are engine-global and top-level only. The Epsil
static pre-pass acts as a top-level surrogate and runs registry mutations in a
rollback frame so later statements can be checked without leaking provisional
state into real evaluation.

Within one Epsil batch, duplicate type/protocol/sum declarations and duplicate
function clauses are checked as one compilation unit. Across batches the newer
definition replaces the older one; clients that require notebook replay use
checkpoint/restore rather than depending on partially updated historical
state.

## Functions, overloads, and callbacks

An intersection of arrow types is an overload set. Resolution filters
inapplicable arms, orders applicable arms by specificity, and preserves
declaration order for ties. Trial validation occurs in an inference rollback
frame so rejected arms cannot mutate engine inference state.

The result type of a call is the result of the selected arm, with one
exception. When the argument types do not decide the arm, the call can take
more than one arm at run time. This is the case for an argument typed `unknown`
or `any`, which rejects no arm, and for an argument whose type only overlaps a
parameter: a `collection` argument at a `string` parameter can be a string or
not. When the possible arms have different results, the result type is the
join of their results: `Slice(s, 1, 2)` with an untyped or `collection`-typed
`s` is `list<any> | string`, not the result of one arm. A type variable
whose argument does not satisfy its bound reads as the part of the bound the
argument can be (`T where T: string` with a `collection` argument gives
`string`). Argument validation still uses the selected arm, and inference into
arguments uses the join of the viable arms' parameters.

Multi-clause functions use the same ordering. Concrete calls refuting every
clause are rejected statically; a call whose applicability was undecidable and
later has no matching runtime clause produces `no-matching-clause`. Arguments
are evaluated once.

Callback slots use honest arrow types. There is no `callback<S>` constructor.
Compatibility admits a callback unless it is provably unusable, while still
checking static arity, parameter direction, result compatibility, and effect
subset. Data-bearing argument positions determine generic variables; callback
positions constrain them but do not independently invent incompatible
solutions. An inline lambda may be rebuilt with contextual parameter types at
the application site; that inference is per application, not stored on the
shared literal.

## First-class type values

`type` is both the primitive type of type values and the result type of `Type`.
`TypeFrom` converts a type spelling or settled type expression into a type
value. `StringFrom` converts a type value back to its stable spelling.

- `Subtype(a, b)` compares two type values.
- `MatchesType(value, typeValue)` is the runtime membership primitive.
- `Conforms(value, protocol...)` tests protocol conformance.
- Surface `is` and type patterns lower to `MatchesType`; they do not maintain a
  second membership implementation.
- Type-value structural equality uses the ordinary `Same` tier. Type algebra
  is performed by type operators, never by evaluating arbitrary expressions as
  types.

An unannotated function literal is deliberately excluded from definitive
runtime type membership while its signature can still be inference-widened.
Such a test stays symbolic rather than returning a false negative.

## Protocols, sums, and objects

Protocols are global nominal contracts. Conformance may be conditional on type
variables. Static dispatch resolves directly when the receiver type proves a
single implementation; dynamic dispatch uses the runtime nominal tag. Compiled
code declines when a target cannot represent the required tag or dispatch.

Sum declaration sugar creates the variants and a transparent union in one
atomic registry operation. A compiled sum erases its tag only when the variant
representations are statically disjoint; otherwise JavaScript uses a tagged
representation and targets without that representation fail closed.

An object value is a `BoxedObject`; the instance itself is the mutable heap
record. Its nominal type is pinned at construction. Slots store evaluated
expressions, mutation increments the object version, and equality is identity
unless an explicit protocol supplies other semantics. Objects are references,
not structural records, and do not gain structural subtyping.

## Inference provenance and rollback

Provenance belongs to definitions, not `Type` objects. Every inference write
can record its source expression and axis. Rollback frames journal all
inference-visible state changed during a trial, including type/effect writes,
fresh-inference bookkeeping, and provisional registry changes. Frames nest;
rollback is unconditional for speculative checks and must restore both values
and invalidation metadata.

The current implementation entry points are the definition provenance journal,
the engine inference transaction helpers, and the state-event funnel described
in `EFFECTS-MODEL.md`.

## Sources of truth

- Public language and API: `doc/08-guide-types.md`
- Effects: `EFFECTS-MODEL.md`
- Collection inference: `INFERENCE_ROADMAP.md`
- Open type-system work: `TYPE_SYSTEM_ROADMAP.md` and active plans
- Historical implementation chronology: `STATUS_REPORT.md` and Git history
