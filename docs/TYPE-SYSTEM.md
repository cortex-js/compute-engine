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

An operand typed `unknown` is read as a number or a tensor of numbers (user
decision 2026-10-23). `Add` and `Multiply` with such an operand are typed
`broadcastable<number>`: `f(x) + f(y)` with `f: (any) -> unknown`, and `2 · u`
with `u: broadcastable<unknown>`. `Sum` and `Product` over a list whose
elements are typed `unknown` are typed the same way. A cell of such an operand
may be any number, so the result does not take the tier of the other operand
(`[1, 2] + u` is `broadcastable<number>`, not `vector<integer^2>`). The type
does not hold a point or a ragged list that comes through such an operand: if
`f` returns `(1, 2)`, `f(x) + f(y)` is the point `(2, 4)`. This is the rule
that a use of an unknown symbol follows: the use narrows the symbol to a number.

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

The static type of an expression and the type of its value can use different
range bounds, so a test of soundness compares the VALUE with the static type,
not the two types. The interval arithmetic of the type handlers keeps four
significant digits: `2.0 + 1/3` is typed `real<2.329..2.341>`, and its value
`2.333…` is typed `real<2.3..2.4>`. The value is in the static range, but
`real<2.3..2.4>` is not a subtype of `real<2.329..2.341>`. A probe of a ranged
or composite static type asks `typeAcceptsValue(value, staticType)`, as the
nightly soundness grid does (`test/compute-engine/nightly/type-soundness-grid.test.ts`),
never `isSubtype(value.type, staticType)`. The engine itself already works this
way: an assignment checks the value against the declared type, not the value's
compact type, so `t: real<0..0.334>` accepts `1/3` and `list<real<0..1>>`
accepts a computed `[0.666…]` (measured 2026-10-25). Rounding the static
ranges outward to the two-digit grid of the value was measured and rejected
(user decision 2026-10-25): the rounding adds up through nested
subexpressions, so `√(1 − ((k − 0.5)/40)²)` with `k` from 1 to 40 became
`complex`. In the same way, the cells of a list literal are typed by their tier
without a range: `Abs([1, 2])` is typed `list<integer<0..>^2>`, and its value
`[1, 2]` is typed `vector<integer^2>`. Typing literal cells with a sign range
was measured and rejected too (user decision 2026-10-25): the handlers then
derive tighter ranges than a sign range on the value can state.

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

### The inferred signature of a function literal

The signature of a function literal says what its body proves about every
call, and nothing more (user decision 2026-10-22, ROADMAP CE-25, landed
2026-10-23). A parameter with no annotation and no use that narrows it has the
type `unknown`, and it can receive any value, so a list literal that holds it
is a list of elements of unknown type: `x ↦ [x]` is
`(x: unknown) -> list<unknown>` and `x ↦ [[x]]` is
`(x: unknown) -> list<list<unknown>>`. It was `(unknown) -> vector<1>`, which reads the parameter as a number: `g("a")` is
`["a"]` and `g(Set(1, 2))` is `[Set(1, 2)]`, calls that succeed and that a
`vector<1>` does not hold. A false type is worse than an imprecise one,
because other code decides on it: with the honest signature, three defects
that the old one hid were found and fixed (`At` and `First` refused an operand
typed `missing | unknown`, `PointX` of it was typed `missing`, and compiled
folds over a `list<unknown>` gave `null` or a string).

A nested function literal has a type of its own, and its body can read a
parameter of the enclosing literal: in `x ↦ (() ↦ [x])`, the inner literal's
own typing read the captured `x` as a number cell. The derivation types a
nested literal again with the parameters of the enclosing literals added to
its own, so the signature is `(x: unknown) -> () -> list<unknown>` (ROADMAP
CE-379, landed 2026-10-23). A parameter of the nested literal that shadows the
captured name is read as its own: `x ↦ ((x: real) ↦ [x])` keeps
`(x: real) -> vector<real^1>`.

The engine reads an operand of unknown type as a number in one place: where an
operation demands a number. `x ↦ x + 1` is `(x: unknown) -> number` because `Add`
accepts nothing else: a string argument fails anyway, so the type describes
every call that succeeds (the rule of 2026-10-23 above, under "Lists, tensors
and `broadcastable`"). That is inference from evidence. A list literal demands
nothing of its cells, and a call site with a free symbol as its argument is no
evidence either (`g(z)` is typed by the signature, not as `[z]`; reading a free
symbol as a number was option (b) of CE-25, rejected). A call with a typed
argument is typed from the body: `m := t ↦ [[t, 1], [2, 3]]` applied to `2` is
a `matrix<integer^(2x2)>`, and applied to `r: real` a `matrix<real^(2x2)>`.

A use of a call at a typed parameter may refine a result that the body leaves
`unknown`: `k := x ↦ x` used in `k(1) + 2` gets the result `real`
(`_inferWithoutFacts`, `boxed-expression/boxed-function.ts`). A result that
the body states is kept when it may fit the parameter: `Trace(g(2))` with the
`g` above, at a parameter typed `number | tensor`, leaves
`list<list<unknown>>` as it is. The join of the two (the former behavior,
`list<list<unknown>> | number | tensor`) is not a refinement, and it made
`Determinant(g(x))` decline to compile.

Where it is reasonable to require a declaration from the user, and where to
guess, follows one principle: guess where a wrong guess is caught at run time,
require information where a wrong guess corrupts a result silently.

- The interpreter checks every operand at evaluation. An imprecise type there
  costs precision, never correctness, so the interpreter does not require
  declarations: an index into `g(x)` with `x: any` is `missing | unknown`, and
  the value, a number or a list, is checked when it is read.
- Compiled code commits each operand to a lane (a number, a complex number, a
  list, a point) when it compiles, and a wrong lane produces wrong numbers with
  no error. So a compile target may require a declaration, and a decline with
  a message that names it is the right answer when the lane cannot be told:
  `Trace(g(x)) + 1` in the complex lane, with `x` a free input, declines, and
  `x: number` or `g: (number) -> matrix` makes it compile. A reachable decline
  is still a defect to fix: the compiler already commits an untyped free input
  to the number lane wherever arithmetic reads it, and it can make the same
  commitment when it types a call with such an input (ROADMAP CE-377).

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

## Value kinds and kind types

A **value kind** is a set of values that are not numbers but take part in
arithmetic with their own rules: a residue class, an element of a finite
field, a measurement. A kind is declared on the operator definition of the
head that constructs its values, with the `arithmetic` field
(`ArithmeticDefinition`, `types-definitions.ts`). The result type of that
head is the **kind type**. The public description is in
`doc/06-guide-augmenting.md` ("Declaring a Value Kind") and
`doc/08-guide-types.md` ("Kind Types"); the design and the decisions are in
`plans/2026-10-26-value-kinds.md` (ROADMAP CE-507). This section states the
type rules.

Two readings are used, and they cannot be merged:

- **Dispatch is by head.** A value is a call; its head names a definition;
  the definition holds the hooks. Two heads can have one kind type
  (`ResidueClass` and a user `MyMod` are both `residue`) with different
  hooks.
- **Recognition is by type.** `r - r` with `r: residue` and no value, and
  `g(2)/g(2)` with `g: (integer) -> residue`, have no head to read. Only the
  declared type says that the value will be of a kind. An expression is
  recognized as holding a kind value when its symbol's declared type, its
  callee's declared result type or the type of its symbol's value has an arm
  that is a kind type, or when it holds a call of a kind head at any depth.

### Kind types

A kind type is one of:

- a **kind primitive**: a name of the type language with an entry in the
  subtype table of `common/type/subtype.ts` that lists no subtype and no
  supertype but `value`, and that is in `KIND_PRIMITIVES`
  (`boxed-expression/value-kinds.ts`). `residue` is the only one. Only the
  library adds one, because a library signature is parsed before any engine
  exists and must be able to name it;
- a **nominal type whose definition is exactly `value`**, declared with
  `ce.declareType(name, 'value', { mint: false })`. This is the form a host
  declares. Types are engine-level (one namespace for each engine), so the
  kind type is too.

The engine treats the two forms in the same way everywhere: the dispatch,
the recognition, the admission, the registry and the compile contract read
"a kind type", never "a primitive".

Subtyping and disjointness:

- A kind type is a subtype of `value`, and so of `expression` and `any`. For
  a primitive this is its table entry. For a nominal type it is a rule that
  reads the definition (`valueKindDeclaration()` in `subtype.ts`, used by
  `isValue()`), in the same way as an object type is a subtype of `object`
  (`isObjectType()`). Any other nominal type is opaque: not a subtype of its
  definition.
- A kind type is disjoint from every type except `value`, `expression`,
  `any`, `unknown` and itself; two kind types are disjoint from each other.
  For a nominal type this is a rule of `provablyDisjointRules()`, which
  would otherwise unfold the reference to `value`, and `value` overlaps the
  numbers, the strings and the collections. The disjointness is what keeps
  the number rules away from a kind value.
- `narrow('residue', 'number')` is `never`. A join with a number type is
  the union: `widen('residue', 'integer')` is `integer | residue`, not
  `value`. The join with `unknown` is the kind type.
- A list of kind values is read by its cells: `[c, d]` is a
  `list<residue^2>`, and `[GF8(1), GF8(2)]` a `list<gf8^2>`
  (`cellTypeMayCarryDimensions()` in `common/type/primitive.ts` reads a
  registered kind type). A kind cell cannot hold a number, so such a list is
  never a `vector` or a `tensor`. `ℤ/nℤ` (`QuotientRing(Integers, n)`) is a
  `set<residue>`.
- A symbol declared with a kind type accepts a value of the kind and refuses
  a number: an integer is a representative of a residue class, not the
  class (`Element(7, ℤ/5ℤ)` is `False`).

Both rules for a nominal type read the definition only, so they hold before
any head of the kind is declared, and they do not depend on the kind
registry or on the order of the declarations.

### The declaration checks

At `ce.declare(head, { signature, arithmetic })`, before anything is
installed (`prepareKindRegistration()`, `value-kinds.ts`):

- The result type of every arm of the signature must be a kind type, a union
  of kind types, or one of these with the marker arms `nan`, `missing`,
  `nothing`, `error`. A transparent alias is read as its definition. Refused:
  a number type, `boolean`, `string`, `expression`, `symbol`, `function`, a
  collection type, `value`, `any`, `unknown`, a generic signature, a nominal
  type with type parameters (`gf<7>`), a nominal type defined as another
  nominal type, a nominal type defined as anything but exactly `value`, and
  a nominal type declared with a minted constructor (the default of
  `declareType()`; the record keeps the choice in `_minted`). So
  `-> residue | integer` is refused: recognition by that type would protect
  every integer.
- A head that gives `add` must give `negate`: `a - b` is canonically
  `Add(a, Negate(b))`, so without `negate` a difference never folds.
- **The fields of the type.** `admittedAs`, `resultType` and `compile.type`
  belong to the kind type, because a free symbol of the type has no head to
  ask. They are stored in the TYPE part of the registry. The first head of a
  type that gives a field sets it. Another head of the type that is LIVE at
  the same time (its definition is in the dispatch part, which includes a
  definition of a popped scope) must leave the field out (it then uses the
  type's) or give an equal one: by value for `admittedAs` (absent counts as
  `'none'` for the first head), by identity for `resultType` and
  `compile.type`. When no other head of the type is live, a new
  registration replaces the fields. A head of a type that a LIBRARY head
  registered while the engine was constructed cannot add a `resultType` or a
  `compile.type` that the library left out, nor give another `admittedAs`:
  `MyMod` cannot give `residue` a `compile.type`, because that would set the
  lowering of every free `r: residue` and of `ResidueClass` arithmetic.

The type-declaration funnel (`declareType()`, `engine-declarations.ts`)
protects a registered kind type: a declaration of the same name that makes
it an alias, gives it type parameters, mints a constructor for it, or
defines it as anything but exactly `value` is refused, so the subtype and
disjointness rules keep holding. This matters for a `DeclareType` statement
that runs again in a later Epsil batch, the one route that can replace a
type definition.

### The kind registry

The registry of an engine (`ce._kindRegistry`, read and written only through
`boxed-expression/value-kinds.ts`) has two parts:

- The TYPE part maps a kind type to its fields and its live heads. It is
  engine-level, like the type registry: a head declared with a kind in a
  nested scope registers its type for the engine, and `popScope()` does not
  remove it. The head is gone, but the protection of its type stays, which
  is the safe direction.
- The DISPATCH part maps a bound operator DEFINITION (not the spelling of
  the head) to its arithmetic, so an expression keeps the hooks of the
  definition it was bound to. An inner scope that declares another head of
  the same name does not change the outer expressions. A redeclaration of
  the same binding (`{ extend: true }`) replaces the entry; a redeclaration
  without `arithmetic`, and the removal of the binding, remove the entry
  (the type, its protection and its fields stay).

A generation counter is incremented by every registration, replacement,
removal and checkpoint restore. The recognition caches
(`boxed-expression/residue-class.ts`) store the generation they were
computed under, so an expression boxed before a kind was declared is
recognized after it. Admission is not revisited: an expression refused at
boxing before the hook existed stays refused.

Three per-engine gates for each kind type let an engine that never uses a
kind skip the walks that look for its values: a value of the type was
constructed; a value of the type was assigned to a symbol; a symbol or a
user callable was declared with a type that has an arm of the kind type. A
kind registered after the library bootstrap opens its gates at
registration. The library signatures and the library kind heads do not open
a gate. A gate only opens: a checkpoint does not restore it, and an open
gate costs a walk, never a wrong answer.

The registry is part of the bounded state of a checkpoint
(`CHECKPOINT-MODEL.md`).

### Admission: where a kind value is accepted

A kind type is disjoint from the number types, so a parameter typed with a
number type does not accept it by subtyping. A kind value is admitted at
three groups of parameters (`boxed-expression/kind-admission.ts`):

1. **The arithmetic operators, by rule.** The operand check of `Add`,
   `Subtract`, `Multiply`, `Negate`, `Divide`, `Power`, `Sqrt`, `Root` and
   `Square` admits every kind type for which a registered head of the type
   gives the hook the operator calls: `add` for `Add` and `Subtract`,
   `multiply` for `Multiply`, `negate`, `divide`, and `power` for `Power`,
   `Sqrt`, `Root`, `Square`. The check removes the absence arms of the
   operand type and the admitted kind arms, and requires what remains to be
   `never` or a subtype of `number`, element by element inside a collection
   type. So `integer | gf8`, `gf8 | missing` and `list<integer | gf8>` are
   admitted, and `string | gf8` is refused. The same rule runs on the
   type-only route (`deriveApplicationType()`,
   `boxed-expression/derive-application-type.ts`), so that boxing and the
   typing of a mapping body agree. The signatures of these operators do not
   name a kind type: the rule reads the registry, at boxing. An arithmetic
   operator used as a function value (`Map(Negate, L)`, `Reduce(L, Add)`)
   is checked with its signature widened by the same kind types
   (`groupOneCallbackType()`). The operators of group 1 are selected by
   their NAME.
2. **By type.** A parameter typed `value`, `any`, `expression`, `unknown` or
   with the kind type admits a kind value through subtyping: `List`, `Hold`,
   `Equal`, `IsMissing`, `Assign`, `GCD` (`(any*)`), `Max`, `Min`, the
   relational operators, and every lazy or structural operator. These
   operators run their own handlers, which see the value as a value.
3. **As a number**, by the `admittedAs` field of the kind type:
   - `'none'` (the default): no further admission. `residue` is a `'none'`
     kind (user decision 2026-10-23): a class is an element of a finite ring
     with no order and no embedding into the reals, so `Sin(c)`, `Floor(c)`
     and `c < d` have no meaning, and admitting it as an integer would let it
     reach integer code that computes from the representative;
   - `'real'`: admitted at every parameter that admits `real` once its
     absence arms are removed (`real`, `number`, `complex`,
     `complex | infinity`; not `integer` nor a ranged type);
   - `'number'`: admitted at every parameter that admits `number` or `real`.

   The **carrier** is what the kind stands in for. The operand check
   replaces each kind arm of the operand type by the narrowest carrier the
   parameter admits (`real` when the parameter admits `real`, else
   `number`), also in the cells of a collection type and the components of a
   tuple type, and then checks the result against the parameter as usual
   (`withKindCarriers()`). So `umeasurement` (a `'number'` kind) at `real`
   passes as `real`, at `complex` as `number`, and at `integer` is refused;
   `string | umeasurement` at `real` is refused through its `string` arm;
   `list<umeasurement>` at `list<real>` passes. The carrier rule does not
   apply at a parameter that admits the kind by type (group 2), nor at the
   group-1 operators, which admit by hook only: a `'number'` kind without
   `power` is refused by `Square` and `Sqrt`.

**Admission is not subtyping.** `isSubtype('umeasurement', 'real')` is
`false`. Inference never reads a kind value as a number, `real | umeasurement`
is a union, and a symbol declared `real` refuses a kind value. The carrier
rule belongs to the operand check only (`checkNumericArgs()`,
`nonNumericOperandError()` in `validate.ts`, the signature check of
`boxed-operator-definition.ts`, and the type-only route).

**Overloads.** When an operator has several arms, an arm that admits each
kind operand by type (`(real | umeasurement) -> …`) is chosen over an arm
that admits it only through the carrier (`(real) -> …`), even when the
specificity rule of `overload.ts` would prefer the narrower arm
(`armAdmitsKindsByType()`). The apply status and the result type come from
the chosen arm, on boxing and on the type-only route.

**A function with a body** (its value is a `Function` expression: a lambda,
a `ce.declare` with a MathJSON or LaTeX body, an Epsil function) does not use
the carrier rule (user decision B, 2026-10-26). Its body was canonicalized
with the declared types of its parameters, and the canonical form folds
`x/x` to `1` for a symbol typed `real` or `unknown`. So a parameter typed
with a number type refuses a kind value at the call (`f: (real) -> real`
applied to a measurement is an `incompatible-type` error), and a parameter
typed `unknown`, `value`, `any` or with the kind type admits it (an untyped
lambda's body may have folded `x/x`; a lambda meant for kind values types
its parameter). The bound variable of a binder over a collection of kind
values is typed by the element type, so its body is recognized; the
contextual element type given to an untyped lambda (`box.ts`) includes the
registered kind types, and a pre-boxed untyped lambda passed to such a
binder is canonicalized again with that element type, so the box, parse and
`ce.function()` routes agree.

### Apply sites

An operator is an **apply site** for a kind when at least one operand that
holds a value of the kind was admitted only through the carrier (group 3),
the operator is not lazy, it has an `evaluate` handler, it is not a function
with a body, and it is not one of the operators that use the other hooks
(group 1, the six relational operators, `Max`, `Min`, `Sort`, `Clamp`)
(`isApplySite()`). The dispatch calls the kind's `apply` hook in place of
the operator's `evaluate` handler. A threadable operator maps over a
collection operand first, and `apply` is called for each element; an
operator whose parameter is a collection type is an apply site when the
elements of the collection include a kind value, and `apply` receives the
collection and its elements, enumerated once and only when the collection is
small enough (`engine.maxCollectionSize`) and of known finite size. When the
kind gives no `apply`, the operator's handler runs and sees the value as it
is. The numeric property queries on a kind value (`isPositive`, `sgn`,
`isInteger`, `re`, …) answer `undefined` or `NaN`, so a canonical fold that
reads them does not fire. The canonical folds of a group-3 operator that do
not read a numeric property (`Log(1, b)` → `0`) are guarded like the number
rules.

### Result types

The kind typing applies at the operators of group 1, the apply sites, and
the group-2 operators that NAME a kind type in a parameter. Every other
operator (`GCD`, `List`, `Hold`, a function with a body) uses its own type
handler on the operand as typed. `Sum`, `Product` and `Reduce` over a
collection of kind values are typed as `Add` (`Multiply`) over the element
type: `Sum([c1, c2])` is `residue`. For the typing, a kind TYPE has `apply`
or `compare` when any registered head of the type gives it. At those
operators, the static result type is, in order:

1. The SHAPE is derived by replacing each kind arm of an operand type by a
   scalar placeholder and running the operator's own type handler:
   `c · (1, 2)` is a `tuple<residue, residue>`, `c · [1, 2]` a
   `list<residue^2>`.
2. Each placeholder cell of the result is replaced by the CELL type: the
   union, over the kind types among the operands, of that type's
   `resultType()` answer when it gives one (it receives the dispatched
   operator, `'Add'` for a difference and `'Power'` for `Sqrt`, `Root`,
   `Square`, and the operand types without their shapes, and may answer a
   type string), else the kind type itself. So a valueless `q1 / q2` with
   `q1, q2: uq` and a `resultType` that answers `number | uq` for `Divide`
   is typed `number | uq`.
3. The kind-free arms of a possibly-kind operand keep the operator's
   ordinary result: `Negate(u)` with `u: real | umeasurement` is
   `real | umeasurement`.
4. An operator whose declared result type is not a number type keeps it:
   the relational operators are `boolean`.
5. An apply site whose kind type has no `apply` is typed by the operator's
   ordinary result with the carrier in place of the kind arm, because the
   operator's own handler runs. A group-2 operator that names the kind type
   in its parameter and has a handler keeps its declared result type, unless
   the kind type's `resultType` answers for it.

`Max`, `Min` and `Clamp` with a kind that has `compare` are typed as the
union of the kind arms of their operands and of the operator's own type over
the kind-free operands: `Max(U, 3)` is `integer<3..3> | umeasurement`. With
a kind that has no `compare`, they are typed `error` and evaluate to an
`incompatible-type` error.

### Evaluation and protection, in short

The type rules above decide where a kind value goes. The evaluation rules
are in the guide; the ones that interact with types are:

- A sum or a product with kind values asks each kind's `add` (`multiply`)
  once, in the order of first occurrence. The operands that hold no kind
  value are combined as one ordinary sub-sum (sub-product); the operands
  that hold one (a fold's value, an operand no hook folded, a valueless
  symbol of a kind type) are placed beside it with no other fold.
- The comparisons use `compare`; `Equal` without an answer from `compare`
  asks the `eq` handlers of the two heads, then answers `False` for two
  values of disjoint types, `True` for two identical values, and stays
  unevaluated otherwise.
- `simplify()` applies no rewrite rule at a node whose operator is of group
  1 or an apply site, when a kind value is held at any depth below it by the
  non-strict recognition (an arm `real | umeasurement` counts); only the
  evaluation through the hooks and the folding of the kind-free terms run
  there. The rules `x - x = 0`, `x/x = 1`, the absorbing zero and infinity,
  `Expand`, `Factor` and `Together` check the same recognition.
- The compile boundary uses the STRICT recognition: an expression that holds
  a kind value for certain, or whose result type is a kind type for certain,
  declines unless the kind type gives a lowering for the target; an
  expression that only may hold one (`number | residue`) compiles as a
  number. See `COMPILATION-MODEL.md`, "Value kinds".

A symbol typed `value` or `unknown` can hold a kind value without saying so,
and the number rules still apply to it: with `w: value`, `w/w` is `1` when
it is boxed, as `x/x` is for an undeclared `x`. A symbol that will hold a
kind value is declared with the kind type.

### Residue classes

`residue` is the kind primitive of a residue class, an element of ℤ/nℤ (user
decision 2026-10-23, `plans/2026-10-23-residue-class-type.md`).
`ResidueClass(k, n)` declares its arithmetic with the `arithmetic` field
(`admittedAs: 'none'`, no `compare`, no `resultType`, no `compile`); its
hooks are the residue functions of `boxed-expression/residue-class.ts`. A
user head declared `-> residue` gives its own hooks, and its values do not
combine with those of `ResidueClass` (each head folds its own values). The
signatures of the arithmetic operators do not name `residue` any more: they
admit it by the group-1 rule, which reads the registry. So an engine built
without the `ResidueClass` definition does not admit `residue` at `Add`, but
still protects a symbol declared `residue` (a primitive is a kind type in
every engine). `Max(c, x)` and `Min(c, x)` are typed `error`, because
classes have no `compare`.

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
