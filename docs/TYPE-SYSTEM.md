# Type System Model

**Status:** normative internal reference for the implemented type system.

This document records the type-system invariants that implementation code may
rely on. Public syntax and API behavior belong in `cortexjs.io/docs/compute-engine/08-guide-types.md`; open
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

### A store into a declared type: match, or overlap and a test at each read

A store into a symbol whose type was declared (`ce.assign`, the `Assign`
operator, a `Declare` with a value, a typed Epsil `let`) gives one of three
verdicts (`storeAdmission()` in `boxed-expression/effects-inference.ts`):

- **match**: the value fits the declared type (`matchesOrAbsent()`). A read of
  the symbol does not test the value.
- **overlap**: the value does not fit, but its type overlaps the declared type
  (`typesOverlap()` of the type the value presents), and the value holds a
  symbol that is not a constant. The store accepts it, as a call accepts an
  argument of a user function whose type overlaps the parameter type
  (`liftedOperandCannotFit()` in `boxed-expression/validate.ts`). Each read of
  the symbol (`evaluate()`, `N()`, `evaluateAsync()`) tests the evaluated
  value with the same verdict, and a value that the store would refuse is an
  `incompatible-type` error at that read, as a call tests a bound argument.
  A result that is still symbolic and whose type overlaps the declared type is
  read as it is.
- **refuse**: the store throws. This is the verdict for a value whose type has
  no value in common with the declared type, and for a value of literals and
  constants that does not fit (`(1, 2.5)` for `tuple<integer, integer>`). The
  symbol `Missing` at a type that excludes absence, an error value, a
  collection with a failed element, a number literal held through a
  restriction (`2 {a > 0}`), a value at a declared function signature and a
  value at a polymorphic declared type keep their own rules and are not
  admitted on overlap.

Example: with `a: real` and `P: tuple<real, real>`, the value
`(-sqrt(1 - a^2), a)` is typed `tuple<complex, real>`. The store accepts it; a
read with `a = 0.5` gives `(-0.866…, 0.5)`, and a read with `a = 5` gives
`Error(ErrorCode("incompatible-type", "tuple<real, real>",
"tuple<imaginary, integer>"), …)`. `ce.declare("t", "gf8"); ce.assign("t", 2)`
still throws: the types are disjoint.

The cost of the test is one set lookup at each read of a value that matched:
only a value admitted on overlap is recorded (`noteOverlapAdmitted()`), and only
its reads compute the verdict. Compiled code does not test the value: it reads
the symbol as a value of its declared type (`assertHeldValueType()` accepts a
value admitted on overlap), and a value outside the type gives an unspecified
result, within the caveats of `COMPILATION-MODEL.md`.

Source: ROADMAP CE-800, option 1 (user decision 2026-11-04; Tycho row 483).

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
`error` types, but include numeric `nan`, and therefore `NaN`. These
contracts alone do not establish presence for
`IsMissing`, `??` or the presence assertion `x?!`; the absence predicate
(`isMissingValue`) includes `NaN`. See the
[numeric absence amendment](ERROR-MODEL.md#numeric-absence-handling--agreed-change-of-2026-10-20).

As a declaration, an `unknown` element or slot asks for refinement: bare
`list`, `list<unknown>`, bare `tuple`, bare `record` and a transparent alias
of any of them refine from each assignment (`xs: list<unknown> := [1,
Missing]` reports `list<integer | missing>`), while `list<any>` is a
contract that never moves (`placeholderSkeletonOf()`,
`boxed-value-definition.ts`). A nested `unknown` position
(`list<tuple<unknown, integer>>`) does not refine.

### `missing` is a marker type: inferable, not declarable

`missing` is the type of the symbol `Missing`, a marker type like
`error` (user decision of 2026-11-02, `ERROR-MODEL.md`, "`Missing` is a
result only"). It cannot be written in a declared type: `ce.declare('w',
'real | missing')`, an operator signature with a parameter `real |
missing`, a parameter annotation `(x: real | missing) -> …`, a `Declare`
statement and an Epsil annotation that name it are errors, at any depth
(`list<string | missing>`). The result type of a signature may name it.
Inference still gives a constructed value a `missing` arm
(`Map(i ↦ At(names, i), [1, 99])` is typed `list<string | missing>`), and
an operator over an operand typed `missing` is typed `missing`.

The marker is implicit in a result type, as `error` is (`ERROR-MODEL.md`
§4, the rule of 2026-09-01): `At` is `(indexed_collection<T>, integer+) ->
T`, `First` and `Last` are `(indexed_collection<T>) -> T`, and `If(c, e)`
with no else is `(boolean, T) -> T`. With `ss: list<string>`, `At(ss, i)`
is typed `string`, and its value is `Missing` when `i` is out of range;
with `ys: list<real>`, `At(ys, i)` is typed `real`, and its value is
`NaN` out of range. A read whose position is proved not to exist is typed
by its marker alone (`At([1, 2], 5)` is typed `nan`). So a type does not
show that a read may be absent, and no presence test decides from a type
alone that such a read is present (`mayHoldRestriction()`,
`boxed-expression/conditional-value.ts`). `IsMissing` is `(any) ->
boolean` and `Coalesce` is `(any, T) -> T`.

### Declared types and absence

A declared type is a contract on every present value the symbol takes
(user decisions P1 and P1b, 2026-10-21,
`plans/2026-10-21-presence-contracts-and-assertion.md`): `s: string`
refuses `5`, and `xs: list<string>` refuses `[5, "a"]`. Since 2026-11-02
the absence cannot be written into a declared type (`string | missing` is
an error, see above), so a store into a declared name accepts the marker
`Missing` where the type accepts a present value: `s: string` takes
`At(["a"], 5)`, and `xs: list<string>` takes `["a", Missing]`
(`matchesOrAbsent()`, `effects-inference.ts`). `matches` stays strict:
`missing` is not a subtype of `string`. `number` admits `NaN`; `real`,
`integer` and `complex` hold finite values only and refuse it, so
`real | nan` is the declaration that admits it. The check is
`matchesOrAbsent()` (`effects-inference.ts`) on the engine's
assignment route and the Epsil run time, and `declaredTypeMismatch()`
(`src/epsil/static-diagnostics.ts`) in the Epsil static check, which
removes the `missing` arms of the value's type in the same way: an
initializer that is always absent (`let y: string = xs[5]` with `xs` a
list of two strings, typed `missing`) and one that may be absent
(`let y: string = xs[i]`, typed `string`) are not reported.

A value whose type is `unknown` states nothing about itself, so
`matchesDeclaredTypeAxes()` admits it at a declared type without a check,
here or later (`xs: list<number>` binds the value of an undeclared `f(0)`).
This matches the argument check, which also admits an `unknown`-typed
argument at a typed parameter. A declared function signature is the
exception: it keeps refusing an `unknown` value, because that value would
satisfy the arity, effects and polymorphism checks all at once without
proof. The absence symbol `Missing` is tested before this rule.

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
a nested collection is itself a value. Numeric `NaN` remains a numeric
outcome, even where named absence markers are excluded.

### Records are closed, dictionaries are open

A value of `record{a: integer, b: string}` has exactly the keys `a` and
`b`. A field written with a `?` after its type is optional
(`record{a: integer, b: string?}`): a value can leave its key out. The
`RecordType` node keeps the optional keys in `optional`, a sorted list that
`makeRecordType()` (`src/common/type/types.ts`) normalizes. A dictionary
(`dictionary<V>`) has any string keys, each holding a `V`. The type of a
dictionary literal is the record of exactly its keys.

- There is no width subtyping: `record{a: integer, b: string}` is not a
  subtype of `record{a: integer}`. Depth subtyping stays:
  `record{a: integer}` is a subtype of `record{a: real}`.
- `record{a: integer}` and `record{a: integer, b: string}` are subtypes of
  `record{a: integer, b: string?}`; the reverse is false.
- A record type is a subtype of `dictionary<V>` when every field type,
  optional fields too, is a subtype of `V`.
- The join of two record types has the keys of both; a key that one side
  does not have, or makes optional, is optional. The meet has the keys
  that both list; a key that one side requires and the other does not list
  makes the meet `never`.
- A read of a listed field has the field type. A read of an optional field
  that the value leaves out gives the absent value of the field type
  (`Missing`, or `NaN` for a numeric field), as an index out of range does.
  A read of a field that a DECLARED record type does not list (`Field` or
  `At` with a literal key, on a variable whose type was declared: a typed
  parameter, a typed `let`) is refused when it is boxed (`unknown-field`,
  `unknownRecordFieldError()` in `library/collections.ts`). The type of a
  dictionary literal, of a variable whose type was inferred from its value,
  or of a constant, describes only that value: a key that the value does
  not have reads as the absent value of a read, as for a dictionary. With a key
  known only at evaluation, the read is one of the field values.
- A store follows the rule of `docs/ERROR-MODEL.md`, rule 5: a field that
  holds `Missing` is accepted where the field type accepts a present value,
  and it keeps its key.
- `DeleteAt(r, "b")` returns a copy without the key. Its type loses the
  field; with a key known only at evaluation, every field becomes optional.
- A nominal record constructor requires each field that is not optional,
  accepts the optional fields, and refuses other keys.

A program that must accept other keys takes a `dictionary`. Design record:
`docs/plans/2026-11-07-ce71-record-fields.md`.

Explicit element arguments remain explicit through parsing, reduction and
serialization. In particular, `<unknown>` no longer collapses into a bare
family name; bare `list` and `list<unknown>` denote the same values and both
refine as declarations (previous section). They differ when an element is
read: an element of a bare `list` (that is, `list<any>`) reads `any`, which
stops inference downstream, and an element of `list<unknown>` reads
`unknown`, which later uses refine. With `g1: (number) -> list` and
`g2: (number) -> list<unknown>`, `At(g1(x), 1)` is typed `any` and
`At(g2(x), 1)` is typed `unknown`. This difference is intended. The numeric
defaults and rank constraints of vector, matrix and tensor spellings remain;
the next section gives their rules.

Compiler shape checks cannot use a bare kind as proof that its elements
exclude `Nothing`. A list, a tuple and a lazy view keep a `Nothing` element
in its position. The compiled targets have no representation of `Nothing`,
so an operation that can meet one requires an explicit content contract
that excludes it, a structural proof, or a compilation refusal.

Some type tests that look exact are not. A check on the element type of a
collection must allow for these facts:

- `complex` is a supertype of `real`, so `list<integer>` matches
  `list<complex>`. A test for "may hold complex elements" written as
  `matches('list<complex>')` also accepts every list of integers; add
  `!matches('list<real>')`, or use `couldBeNonRealNumber`
  (`src/common/type/utils.ts`).
- `number` is a supertype of both `real` and `complex`, so `list<number>`
  matches neither `list<real>` nor `list<complex>`. No static test can
  classify its elements.
- A written list types `list<…>` or `vector<…>`, while a range or a declared
  parameter often types `indexed_collection<…>`. `list<integer>` matches
  `indexed_collection<integer>`, but not the reverse, so a test written
  against `list<…>` misses those operands.
- `tuple` is a subtype of `indexed_collection`. To leave tuples out, test the
  tuple kind explicitly.
- `.isCollection` is false for a computed list whose operands are symbols
  (`L^2` or `|L - 1|` with `L` assigned a list), although its type is a list
  type. Use the type for such a node. `.staticShape` gives the shape that the
  type promises, without evaluation (`docs/COLLECTIONS-MODEL.md`, "The shape
  of an unevaluated application").

Compiled code reads each value in the shape that its declared or inferred
static type gives, and emits no run-time test of a type: a value outside its
type gives an undefined result, and a value with no settled shape declines
(`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time"). So
declare an input with the narrowest type that holds every value it will
receive.

`string` and `range` are subtypes of `collection<any>` (a string is an
indexed collection of characters, `STRING_STRUCTURAL_TYPE` in
`primitive.ts`), and `typeCouldBeCollection('string')` is true. A test for
"this union has a collection arm" written as
`arms.some((a) => isSubtype(a, 'collection<any>'))` therefore matches
`string | integer`. When the test means a composite collection, require a
type object: `typeof a !== 'string' && isSubtype(a, 'collection<any>')`.

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
is `list<vector<integer^1> | vector<integer^2>>`.

A free symbol cell (a symbol with no value) whose type is `unknown` or a number
type is read as a number cell: `[[a, b], [c, d]]` is `matrix<2x2>`, and the list
does not infer the symbols (`narrowFreeSymbolCells()`, `canonical-utils.ts`). A
cell whose type can hold a list (`matrix`, `tensor`, `number | tensor`, `value`)
removes the shape of the literal, because the cell can be a matrix and the
literal a block matrix: in an expression where `Determinant(a)` gives `a`
the type `matrix` (`Determinant(a) + Determinant([[a, b], [c, d]])`), or after
`a` is declared with that type (also by `ce.infer()`), `[[a, b], [c, d]]` is
`list<list<unknown>>`, and the matrix operators leave it unevaluated. A use of
`a` in another expression does not change the literal: after
`ce.box(['Determinant', 'a'])`, `[[a, b], [c, d]]` boxed alone is
`matrix<2x2>`. The same holds for a use in `Trace(a)` (`number | tensor`, the
parameter of `Trace`), `Norm(a)` or `Flatten(a)`. A literal operand of a parameter that is a tensor of unknown rank
does not give its cells the element type `number | tensor`
(`distributeLiteralElementInference()`, `validate.ts`; GitHub issue #505), so
`Trace([[a, b], [c, d]])` keeps the shape of its own operand.

A broadcast whose result rank
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
that a use of an unknown symbol follows: the use requires a number of the
symbol.

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

Both kinds reach a type predicate as a `{kind: 'reference'}` node, not as the
structure they name. A predicate that asks "is this type shaped like X" must
unfold a transparent alias and leave a nominal reference folded
(`unfoldAliasOnDescent()`, `common/type/utils.ts`). Reading `.kind` directly
refuses an alias it should admit; resolving both admits a nominal type that
the lattice refuses, because a nominal type is not a subtype of its
definition. `resolveTypeForCompilation()` resolves both, because compilation
erases types; it does not belong in a lattice predicate. A recursive alias
reaches itself through the reference's `def`, so every function that unfolds
a reference needs a cycle guard (`beginUnfold()` in `subtype.ts`, or the
`seen` set of `unfoldAliasOnDescent()`); without one, a rejected value can
overflow the stack.

The broadcast lift follows the same rule: it unfolds a transparent
collection alias and types its result by the structure it builds. With
`nums` a transparent alias of `list<number>` and `v: nums`, `2v` and `Sin(v)`
are typed `list<number>`, not `nums`.

## Declarations and the global registry

Type and protocol declarations are engine-global and top-level only. The Epsil
static pre-pass acts as a top-level surrogate and runs registry mutations in a
rollback frame so later statements can be checked without leaking provisional
state into real evaluation.

Within one Epsil batch, duplicate type/protocol/sum declarations and duplicate
function clauses are checked as one compilation unit. Across batches the newer
definition replaces the older one.

A constant is a property of the binding, not of the type. `isConstant` is
stored on the value definition, next to its type, value and `holdUntil`
(`_BoxedValueDefinition`, `boxed-value-definition.ts`); there is no `const`
type. Constness says whether a name can be assigned again, not what values it
holds: a constant declared `real` holds a value of type `real`, and putting
constness in the type would make subtyping and joins answer questions about
names instead of values.

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

### Default values of optional parameters

A parameter of a function signature can have a default value, written after
its type: `(x: number, factor: number = 2) -> number`. The parameter name is
optional, as for any parameter: `(number, number = 2) -> number`.

- A parameter with a default is optional. It is not also marked with `?`:
  `number? = 2` is a parse error.
- Order: the required parameters, then the parameters with a default, then
  the optional parameters without a default. A parameter with a default
  after an optional parameter without one is a parse error, and so is a
  required parameter after a parameter with a default. The reason is that
  the defaults are filled by position: with `(x, a: number?, b: number = 2)`,
  a call with one argument would put the default of `b` in the slot of `a`.
- A variadic parameter cannot have a default, and a signature with a
  default cannot have a variadic parameter (optional and variadic
  parameters do not mix).
- A default is allowed only in the argument list of a function signature. In
  a tuple type (`tuple<x: number, k: number = 2>`, or `(number, number = 2)`
  with no arrow) it is a parse error.
- The values: a number that a JavaScript `number` holds (`2`, `-1`, `1.5`,
  `NaN`, `+oo`, `-oo`; the word `Indeterminate` is read as `NaN`), a
  string (`"abc"`), `true` or `false`, a symbol
  (`Integers`, or a backticked name), the empty list `[]` and the empty
  dictionary `{}`. An identifier in default position is a symbol name, not a
  type name. `True` and `False` are read as the booleans `true` and `false`,
  so `flag: boolean = True` prints as `flag: boolean = true`.
- Refused values: `Nothing` and `Missing` (leave the parameter optional
  instead), `~oo`, a list or a dictionary with contents,
  and a symbol that names a parameter of the same signature
  (`(x: number, k: number = x)`). For a list with contents, declare a
  constant symbol and use its name as the default.

The default is part of the type: it is stored on the parameter
(`NamedElement.default`, a `ParameterDefault`), and the serializer prints it,
so `typeToString` and `typeToIdentityKey` tell apart two signatures that
differ only by a default. Subtyping and matching ignore the default, as they
ignore the parameter name: `(x: number, k: number = 2) -> number` and
`(x: number, k: number = 3) -> number` match each other, and both match
`(x: number, k: number?) -> number`. A default changes what a call means, not
which calls are admitted.

Where a default is used: on the parameters of the top-level signature of an
operator definition (`ce.declare("Scaled", { signature })`, `ce.assign`) and
of a declared variable (`ce.declare("g", "(number, number = 2) -> number")`).
The declaration boxes each default once, in the declaring scope, and checks
it against the parameter type; it throws when the default does not fit:

- A number, a string, a boolean, `[]` or `{}` must match the parameter type.
  `factor: number = "a"` and `xs: number = []` are refused;
  `xs: list<number> = []` and `opts: dictionary = {}` are accepted, because
  the types of the two empty values, `list<never>` and `dictionary<never>`,
  match every list and dictionary type.
- A symbol is checked as the same symbol written as the argument of a call
  is checked. A declared symbol whose type does not fit is refused
  (`k: number = Integers`, `Integers` is a `set<integer>`); a symbol that is
  not declared has the type `unknown` and is accepted at every parameter
  type (`mode: symbol = Automatic`). When the parameter type lists literal
  symbol types (`mode: symbol<Auto> | symbol<Manual>`), the default must be
  one of them: `= Atuo` is refused. With `ce.strict` set to `false`, a call
  does not check the type of its arguments, so a declared symbol whose type
  does not fit is accepted (`k: number = Integers`), as `Integers` written
  as the argument of a call is accepted in non-strict mode. The check of the
  literal symbol types is still made.

A declaration also throws for a default that nothing would use:

- in an arm of an overloaded signature (an intersection of signatures): "a
  default value in an overloaded signature is not supported yet";
- on a parameter whose type mentions a type variable
  (`(x: T, k: T = 2) -> T where T`): "a default value on a generic parameter
  is not supported yet";
- anywhere else in a type: in the type of a parameter
  (`(f: (number, number = 2) -> number) -> number`), in the result type, an
  element type (`list<(number, number = 2) -> number>`), a union arm, a record
  field, a `Typed` annotation, or the body of `ce.declareType()`: "a default
  value is allowed only in a top-level function signature". The parser
  accepts these types; the check is made where the type is installed.

One exception to "subtyping ignores the default": when a VALUE is checked
against a DECLARED function type (a declaration with a value, an
assignment), a parameter of the declared signature with a default counts as
a required parameter. A call of the variable always reaches the value with
that argument, because the default is inserted when the call leaves it out.
So with `g` declared `(number, number = 2) -> number`, the assignment of
`(x, k) => x * k` (which requires two arguments) is accepted, and the
assignment of `(x) => x` is still refused: it does not take the second
argument. The declared type is read this way by `defaultedSlotsAsRequired()`
(`src/common/type/subtype.ts`) before the value check; `isSubtype()` itself
is unchanged.

#### A default on a parameter of a function literal

A parameter of a function literal has a default value when it is wrapped in
`Optional`: `["Function", ["Multiply", "x", "k"], "x", ["Optional", "k", 2]]`,
which Epsil spells `(x, k = 2) => x * k`. The wrapped parameter is a symbol
or `["Typed", symbol, type]`; the default is a number, a string, `True`,
`False`, a symbol, `["List"]` or `["Dictionary"]` with no operands, the same
values as in a signature. The default is canonicalized with the literal, in
the scope where the literal is written. The signature-string spelling
`["Function", body, "'(x: number, k: number = 2) -> number'"]` gives the same
literal.

- The literal's inferred signature puts a parameter with a default among the
  optional parameters, with its default:
  `((x, k = 2) => x * k).type` is `(x: unknown, k: unknown = 2) -> number`,
  and `((x, k: number = 2) => x * k).type` is
  `(x: unknown, k: number = 2) -> number`. The default does not change the
  slot type: it is the annotation, or the type that the uses of the body
  infer, as for a parameter without a default.
- A call that supplies every parameter before the first parameter with a
  default is a full call: `((x, k = 2) => x * k)(3)` is 6, and its canonical
  form is `Apply(⟨literal⟩, 3, 2)`. A call with fewer arguments is a partial
  application, as before; its residual keeps the default:
  `((x, k = 2) => x * k)()` is `(_1, Optional(_2, 2)) => …`, which gives 6
  for `3` and 15 for `(3, 5)`.
- `ce.assign` of such a literal gives the user function the signature of the
  literal, defaults included, so `f(3)` canonicalizes to `f(3, 2)`. With
  `inferredSignature: true`, the defaults of the literal replace the declared
  ones, as its types do.
- An operator that chooses how to call a callback from its arity reads the
  number of required parameters (`requiredArity()`,
  `src/common/type/utils.ts`): `Sort(L, (x, k = 2) => x * k)` uses the
  literal as a unary key, and `Iterate((x, k = 2) => x + k, 0)` calls it with
  the previous value only.
- A symbol default is a free variable of the literal, not a parameter, and is
  read as the same symbol written in the call is read.
- Errors, each on the parameter operand: a default that does not fit the
  parameter type is `incompatible-type` (`(x, k = "a") => x * k`, where
  `Multiply` needs a number); a default that is not one of the values above,
  that names a parameter of the same literal, or that is `Nothing`,
  `Missing`, `ComplexInfinity` or a rational is `expected-a-literal-default`;
  `Optional` on a rest or destructuring parameter, and a plain or rest
  parameter after an `Optional`, are `expected-a-symbol`; `Optional` with no
  default is `missing`; `Optional` outside a parameter list is
  `unexpected-argument`. `["Typed", "k", "'number?'"]` is
  `invalid-parameter-annotation`: `number?` is not a type, and a parameter
  of a literal is optional when it has a default.
- The LaTeX of the literal writes the parameter `k = 2`:
  `(x, k=2)\mapsto kx`. The LaTeX parser does not read that notation back as
  a default yet.

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

The type of a node of a function body comes from the declared (static)
bindings only: a type computation never reads the values that a call gives
the parameters (user decision 2026-10-30, ROADMAP CE-689, GitHub issue #487).
While a type is computed, a read by name, or a read of the value of a symbol,
sees the bindings of the literal as they are outside every call: in the body
of `x ↦ …`, `x` is the parameter, with no value, in the call `g(3)` as in the
call `g("ab")` (`static-typing-view.ts`). So the type of a node of the body
is the same in every call, and the engine does not compute it again at each
call (`typeVersion`, `engine-configuration-lifecycle.ts`). Evaluation still
reads the values of the call, and so do the sign and value of a node.

Two kinds of type are still computed again. A type depends on the scope it
is read in: a block-local function or variable is found only from inside
the block, so `x / c` with a block local `c` is `rational` when read inside
the call that runs the block and `infinity | nan | real` at global scope.
So the key of a cached type also names the innermost call frame, and two
calls of the same literal share their entries. And a type computed from an
answer that holds only while another computation is in progress (the result
of a recursive call, read while the result of the same function is being
derived, is the declared `unknown`) is kept only until the next call
(`stackDependentAnswerCount`, `static-typing-view.ts`).

A branch of an `If` or a `Which` that calls a user function and is typed
`unknown` makes the conditional `unknown`, unless the call can be a recursive
call: the result type of its function is being computed at that time (the
name has no body yet and an assignment or a declaration that gives it one is
in progress, the signature of its definition is being derived, or the type of
its function literal is being computed; `unknownCallMayBeRecursive()`,
`declared-parameter-result.ts`). A type that leaves such a call out holds only
while that computation runs, and the type cache does not keep it after it. A
recursive call is left out of the join of the branches, so
`r := n ↦ If(n = 0, 1, r(n − 1))` is typed `(n: unknown) -> integer` by its
base case. A call of a function that is not defined yet is not left out: with
`q: real`, `If(q < 2, g(1), 0)` is `unknown`, because `g := x ↦ x / 2` can
later make its value `1/2` (CE-836).

This rule is simple and sound, and it loses precision in a mutual recursion
where the call of the branch reaches the function in computation only through
another function. With `F` and `G` declared `function`,
`F := n ↦ If(n = 0, x > 0, G(n − 1))`, then `G := n ↦ F(n)`, the type of
`F(m)` is `unknown`, although every value is a boolean: `G(n − 1)` is
`unknown` only because it reads `F`, but the result type of `G` is not being
computed. Two functions that call each other, where the first is assigned
before the second exists, can also get wider types: the result of `ha` or
`hb` of `test/compute-engine/ce-479-recursive-map-result-type.test.ts` is a
subtype of `list<integer | list>`, and it can be wider than that type, for
example `list<integer | list<unknown>>`. Each of these types holds every
value.

Known limitation: in a mutual recursion, the type of a call of the second
function can leave out a value when the call of the first function was typed
first. With `f` and `g` declared `(unknown) -> unknown` and `m: integer`,
`f := n ↦ If(n = 0, "a", g(n − 1))`, then `g := n ↦ If(n = 0, 2, f(n − 1))`:
when the type of `f(m)` is read first, `g(m)` is typed `number`, but `g(1)`
is `"a"`. The body of `g` is typed while the result type of `f` is computed,
with `f(n − 1)` left out of the join as a recursive call, and the type cache
keeps that type after the computation of `f` ends. A sound fix records, for
each cached type, the computations it depends on, in the most-used cache of
the engine; it is done when a program from real use shows the defect. The
analysis and the two attempts that failed are in
`docs/plans/2026-11-08-ce1091-mutual-recursion-type-cache.md`.

A use of a call at a typed parameter may refine a result that the body leaves
`unknown`: `k := x ↦ x` used in `k(1) + 2` gets the result `real`
(`_inferWithoutFacts`, `boxed-expression/boxed-function.ts`). A result that
the body states is kept when it may fit the parameter: `Trace(g(2))` with the
`g` above, at a parameter typed `number | tensor`, leaves
`list<list<unknown>>` as it is. The join of the two (the former behavior,
`list<list<unknown>> | number | tensor`) is not a refinement, and it made
`Determinant(g(x))` decline to compile.

When a function literal annotates some parameters and leaves others bare
(`(p, acc: list<number>) ↦ …`), a call checks its arguments only against the
annotated slots. Each bare slot admits any argument, as every slot does when
nothing is annotated, although `signature` still reports the type inferred
for it from the body (user decision 2026-09-30). The definition keeps this
call-time signature in `_validationSignature` (`types-definitions.ts`);
`signature` is what result typing and broadcasting read.

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
`cortexjs.io/docs/compute-engine/06-guide-augmenting.md` ("Declaring a Value Kind") and
`cortexjs.io/docs/compute-engine/08-guide-types.md` ("Kind Types"); the design and the decisions are in
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
  (`boxed-expression/value-kinds.ts`): `residue`, `measurement`, `quantity`
  and `enclosure`. Only the library adds one, because a library signature is
  parsed before any engine exists and must be able to name it;
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
a gate. Nor does a value that a library makes while it loads: the value of
a physical constant (`SpeedOfLight`) is a quantity, and
`deferKindValueGates()` (`value-kinds.ts`) keeps the gates closed during
`loadLibraryDefinitions()` (`engine-library-bootstrap.ts`), which then asks
each such constant to make its value again when it is first read. So an
engine that never reads a physical constant and never makes a quantity does
not pay for the walks of the recognition of `quantity` (about 10% of the
time of an ordinary evaluation, measured 2026-10-26). The `carrier` and
`resultType` checks of the apply sites (`someKindAdmittedByCarrier()`,
`someKindHasResultType()`) read the same gates, so the `'number'` kind
`measurement` costs nothing in an engine that has made no measurement. A
gate only opens, and an open gate costs a walk, never a wrong answer.

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
     reach integer code that computes from the representative. `quantity`
     is a `'none'` kind too: the operators that accept a quantity name
     `quantity` in their parameter type (group 2), see "Measurements and
     quantities" below;
   - `'real'`: admitted at every parameter that admits `real` once its
     absence arms are removed (`real`, `number`, `complex`,
     `complex | infinity`; not `integer` nor a ranged type);
   - `'number'`: admitted at every parameter that admits `number` or `real`.
     `measurement` is a `'number'` kind.

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
(group 1, the six relational operators, `Max`, `Min`, `ElementMax`,
`ElementMin`, `Sort`, `Clamp`) (`isApplySite()`). The dispatch calls the
kind's `apply` hook in place of the operator's `evaluate` handler. A threadable operator maps over a
collection operand first, and `apply` is called for each element; an
operator whose parameter is a collection type is an apply site when the
elements of the collection include a kind value, and `apply` receives the
collection and its elements, enumerated once and only when the collection is
small enough (`engine.maxCollectionSize`) and of known finite size. When the
kind gives no `apply`, the operator's handler runs and sees the value as it
is. The numeric fact queries on a kind value (`isPositive`, `sgn`,
`isInteger`, `isFinite`, …) answer `undefined`, so a canonical fold that
reads them does not fire. The numeric accessors (`re`, `im`, `bignumRe`,
`bignumIm`, `valueOf()`) answer `NaN`, unless the kind gives
`numericValue()`: then they read the number it answers (the nominal of a
measurement, user decision of 2026-10-26, plan section 13.2). The `apply`
dispatch runs before the handler at every admitted operator, so a kernel
that reads `re` never sees a kind value. The canonical folds of a group-3
operator that do not read a numeric property (`Log(1, b)` → `0`) are guarded
like the number rules.

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
  unevaluated otherwise. `compare` can answer `'unordered'` (two known
  values with no order, a measurement with a complex nominal): the four
  order operators answer `False`, `Equal` and `NotEqual` go to the `eq`
  handlers, and `Max`, `Min`, `Sort` stay unevaluated. `Max` and `Min` keep
  the first operand of a tie, and `Clamp(x, lo, hi)` returns `x` when it is
  equal to a bound. `compare` receives `context.tolerance` from `.is()` (its
  `tolerance` argument, or `engine.tolerance`), and `undefined` from every
  other comparison.
- `isExact(value)` of the kind says whether a value is exact
  (`isInexactOperand()`). Absent, the values are exact.
- `isNaN(value)` of the kind says whether a value stands for no value (a
  measurement with a `NaN` nominal, a quantity with a `NaN` magnitude;
  `kindValueIsNaN()`). Such a value follows the rule of the number `NaN`
  and `compare` is not asked: `Max`, `Min`, `ElementMax`, `ElementMin` and
  `Clamp` give `NaN`, the four order operators give `False`, and `Equal`
  gives `False` also for the value and itself. Absent, no value is `NaN`.
  The type is not changed: such a value keeps its kind type, not `nan`.
- `simplify()` applies no rewrite rule at a node whose operator is of group
  1 or an apply site, when a kind value is held at any depth below it by the
  non-strict recognition (an arm `real | umeasurement` counts); only the
  evaluation through the hooks and the folding of the kind-free terms run
  there. The hooks receive in `written` the operands as they were written
  before `simplify()` simplified them (`withOperandsWrittenBefore()`,
  `kind-dispatch.ts`), so a hook that reads `Negate(b)` there gives the same
  answer as under `evaluate()`. The rules `x - x = 0`, `x/x = 1`, the absorbing zero and infinity,
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

### Measurements and quantities

`measurement` and `quantity` are the kind primitives of `Measurement(value,
error)` (`library/measurement-arithmetic.ts`, `MEASUREMENT_ARITHMETIC`) and
`Quantity(magnitude, unit)` (`library/quantity-kind.ts`,
`QUANTITY_ARITHMETIC`). Each is in `KIND_PRIMITIVES` and has an entry in the
subtype table of `common/type/subtype.ts`, so a library signature can name
it. The decisions are in section 13 of `plans/2026-10-26-value-kinds.md`
(ROADMAP CE-507). Both heads are typed by their signatures:
`(value, value) -> measurement` and `(value, value) -> quantity`. Before
phase 2, a measurement was typed with the type of its nominal and a quantity
`value`.

- **`measurement` is a `'number'` kind.** A measurement is admitted through
  the carrier at every parameter that admits `number` or `real` (also a
  parameter typed by a type variable bounded by `number`, `(T) -> T where
  T: number`, where the call is typed with the kind arm and not with `T`),
  and refused at `integer` and at a ranged parameter. A symbol declared
  `real`, `number` or `integer`, and a function with a body over a number
  type, refuse it (decision B). Every library operator that admits it is an
  apply site, and `apply` answers. `resultType` answers
  `number | measurement` for every operator except `Add`, `Negate`,
  `PreIncrement`, `PreDecrement`, `Conjugate`, `Real`, `Re` and `Abs`,
  whose result keeps the uncertainty of the operand and so is always a
  measurement: a propagated uncertainty of 0 collapses to the bare value
  (`makeMeasurement()`), so `Floor(2.5 ± 0.1)` is the number `2`. A complex
  nominal is not visible in the type: a complex measurement at a parameter
  that is real (no arm admits `complex`) is refused at evaluation by
  `apply` (`realOnlyParameter()`), with `incompatible-type`.
- **`quantity` is a `'none'` kind.** It is admitted at the arithmetic
  operators (group 1), at the parameters typed `value`, `any`, `expression`
  or `unknown` (group 2: `UnitConvert`, `List`, the relational operators,
  `Max`, `Min`), and at the operators whose parameter type names `quantity`:
  the 24 trigonometric, hyperbolic and inverse functions
  (`(complex | quantity) -> number`, with an `infinity` or
  `signed_infinity` arm where the function had one) and `Abs`
  (`(complex | infinity | quantity) -> number`). An angle (`30 deg`) folds
  to radians at canonicalization; any other quantity is admitted and stays
  unevaluated. Every other operator refuses a quantity at boxing:
  `Floor(2 m)`, `Hypot(2 m, 3)`, `Mean([2 m, 4 m])`. `resultType` answers
  `number | quantity` for `Multiply`, `Divide` and `Power` (also `Sqrt`,
  `Root`, `Square`: a unit with no dimension gives a number), `quantity` for
  `Abs`, and `number` for the trigonometric functions. The `quantity` arm of
  these signatures does not take part in inference: a use of a valueless
  symbol at `Abs` or `Arctan` infers the other arms, not `quantity`.
- **A union of numbers and kind values in a literal matrix keeps its
  shape**: `[[2 ± 0.1, 2], [3, 4]]` is a
  `matrix<integer | measurement^(2x2)>`, which the matrix operators admit
  through the carrier (`shapedListTypeD()`, `collections.ts`).
- **The physical constants** are declared `value` (`library/library.ts`),
  and their value is a quantity, typed `quantity`.

### Enclosures

`enclosure` is the kind primitive of `Enclosure(lo, hi)`
(`library/enclosure.ts`; the hooks are `ENCLOSURE_ARITHMETIC` in
`library/enclosure-arithmetic.ts`), a closed interval that holds one real
number. It is in `KIND_PRIMITIVES` and has an entry in the subtype table of
`common/type/subtype.ts` with no subtype: like the other kind types it is a
subtype of `value` (so of `expression` and `any`) and disjoint from every
other type. So `enclosure` is not a subtype of `real`, and a symbol declared
`real` refuses an enclosure. The design is section 4.9.2 of
`plans/2026-10-26-value-kinds.md` (ROADMAP CE-507).

- **The signature of the head** is
  `(real | signed_infinity | nan | set<real>, (real | signed_infinity | nan)?) -> enclosure | nan`.
  The `type` handler of the head answers `enclosure` when there are two
  endpoints whose types exclude `NaN` and at least one type excludes the
  infinities (`Enclosure(0, +oo)` is `enclosure`), and
  `enclosure | nan` otherwise: a `NaN` endpoint, the same infinity twice and
  an empty set give the indeterminate value. The canonical handler refuses,
  with `incompatible-type`, an endpoint that is a value of a kind (a
  measurement, a quantity, an enclosure), because admission is not
  subtyping and would admit it; the evaluate handler checks the endpoints
  again after it evaluates them.
- **`enclosure` is a `'real'` kind.** An enclosure is admitted through the
  carrier at every parameter that admits `real` (`real`, `number`,
  `complex`), and refused at `integer` and at a ranged parameter. Every
  library operator that admits it this way is an apply site. `Measurement`
  and `Quantity`, whose parameters are `value`, refuse an enclosure in
  their canonical and evaluate handlers.
- **`resultType`** answers `enclosure` for `Abs`, `Sin`, `Cos`, `Sinh`,
  `Cosh`, `Tanh`, `Arctan`, `Arsinh`, `Erf`, `Erfc`, `Fract`, `Sign` and
  `Heaviside`, whose image is never empty. For `Add`, `Negate`, `Subtract`,
  `Multiply`, `Sum` and `Product` it answers `enclosure` when no operand
  type admits an infinity or `NaN`, and `enclosure | nan` otherwise
  (`x + 1` with `x: enclosure` is `enclosure`; `x + y` with `y: number` is
  `enclosure | nan`, since `x + +oo` is indeterminate). For `Max`, `Min`,
  `Clamp`, `ElementMax` and `ElementMin` it answers `enclosure`, or
  `enclosure | signed_infinity | nan` when an operand type admits an
  infinity or `NaN` (`Max(x, +oo)` is the number `+oo`). Every other
  operator (`Divide`, `Power`, `Sqrt`, `Ln`, `Tan`, `Floor`, `Mean`, …) is
  `enclosure | nan`, because its image can be empty.
- **The endpoints under `.N()` are machine doubles**, converted outward
  (`lo` down, `hi` up), at every `ce.precision`: the interval library
  computes with doubles. The type does not record this; it is a property of
  the value. Under `evaluate()` with exact endpoints the endpoints stay
  exact.
- **A list of enclosures** is read by its cells: `[Enclosure(0, 1), 2]` is
  a `list<enclosure | integer^2>`, and `Sin` of it evaluates to a
  `list<enclosure | real^2>`. Such a list is never a `vector`.

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

## The type of a name with no explicit type

Boxing (`ce.parse()`, `ce.box()`, `ce.expr()`, `ce.function()`) declares no
name, and it does not narrow, widen or mark an existing definition, also one
that is inferred or of type `unknown`. A name with no definition is a free
name (`SCOPING-MODEL.md`, "Free names"). A use of a name puts a requirement on
it (`x + 1` requires `number`). When the name has no explicit type (no
definition, an inferred definition, or the type `unknown`), the requirement is
kept with the expression: one outermost boxing is one unit, and its
environment holds, for each (home scope, name), the meet of the requirements
of its uses (`binding-unit.ts`). A requirement whose meet with the entry is
`never` is not written, and the entry keeps the earlier requirement.

The type of an occurrence is, in this order:

1. the type of its resolved definition, when that type is explicit;
2. the meet of the type of an inferred or `unknown` definition and the entry
   of the unit; when the meet is `never`, the type of the definition;
3. the entry of the unit, when there is no definition;
4. `unknown`.

With `a = ce.parse('x + 1')`: `a.op1.type` is `number`,
`ce.box('x').type` is `unknown` (a unit with no use of `x`), and
`ce.lookupDefinition('x')` is `undefined`. After `ce.declare('x', 'string')`,
`a.op1.type` is `string`; after `ce.assign('x', ce.string('ab'))`, it is
`string` too (the meet is `never`, so the definition wins).

A parameter of a function literal with no annotation follows the same rule
while the literal is boxed (its body, and the rebinding of a body boxed
before the literal): a use writes its requirement under the definition of
the parameter in an environment of the literal, and a later use reads the
meet of the type that the definition starts with and the requirements so
far. During the trial of an arm of an overloaded operator, the write goes in
the environment of the trial, which is thrown away with it. When the boxing
of the literal ends, the type that a read then gives is written on the
definition once, marked as inferred, with the use that last changed it as
its provenance: `a ↦ a[1] + a[2]` is typed
`(a: tuple<number, number>) -> number`. That write has no rollback record:
the definition was made by this boxing. When it changes a type, one state
event follows it, because a type cached on another node during the boxing
can depend on the type of the parameter before the literal was complete
(the cache keys do not hold the definitions they read). After that, the
definition is one that existed before any later boxing: a use in the body
boxed again (a compilation that substitutes a call into it) writes its
requirement in the environment of that unit, as for any inferred
definition. A read of the environment of the literal is a dependency only
of the caches computed during the boxing: a computation that started
before boxes the literal again.

An operation (`evaluate()`, `simplify()`, `subs()`, `compile()`, …) writes its
requirements in an environment of its own, which reads the environments of
its input. It does not change the types that the input reads. The
environment of an outermost operation is thrown away: a symbol that the host
made before the operation reads `unknown` in the result
(`COMPILATION-MODEL.md`, "An input with no type declines").

`ce.infer(exprs)` commits the requirements. For each (home scope, name) in
the units of `exprs`, it takes the meet of their entries, met with the type
of an inferred definition that the home scope holds, and declares the name
there, marked as inferred, or narrows that inferred definition. It skips a
name, and reports the reason, when the home scope is not the current scope or
an ancestor of it (`'out-of-scope'`), when the name has an explicit
definition there (`'defined'`), when the meet is `never` (`'conflict'`), or
when it is `unknown` (`'untyped'`). The order of `exprs` does not change the
result. With `c = ce.parse('x(3)')`, `ce.infer([a, c])` skips `x` as a
conflict; `ce.infer([a])` declares `x: number`, and a later `ce.infer([c])`
skips `x` as a conflict. A library name that a unit reads as a variable (`N`
in `N + 1`) is declared as a variable that shadows the library name in that
scope, and a call head as a `function` (`p + q(2) + 1` declares `p: number`
and `q: function`). `ce.assume()` declares the names that it constrains, as
it is a host statement and not a boxing.

## A static type does not depend on a value

The static type of a node is a function of the definitions, of their
declared or inferred types, and of the values of constants (a constant may
have the literal type of its value). The write of the value of a variable, a
parameter, a binder index or a block local changes no type, and it
invalidates no cached type: the type version (`typeVersion`,
`engine-configuration-lifecycle.ts`) does not move.

- In a type computation (`withStaticTypingView`) a definition that is not a
  constant has no value (`storedValue`, `boxed-value-definition.ts`). One
  exception: a variable whose value holds a function literal, because the
  signature of a user function comes from its value; the write of such a
  value moves the type version.
- A variable whose value is a literal keeps the type its assignment recorded.
  A variable whose value reads other names has the static type of that value
  (`declaredType`, `boxed-value-definition.ts`), read with the assumptions
  hidden and widened to its tier as an inferred declaration is: it follows a
  change of the TYPE of those names, never their values. With `y := x + 1`,
  `y` is `number`; after `x := [1, 2]`, which changes the type of `x`, `y` is
  `vector<integer^2>`. A definition held by activations (a block local, a
  parameter, the variable of a binder) keeps its recorded type. A variable
  with no type and no inferred type is `unknown`, whatever it holds.
- A declared type is read as declared: with `P: collection<number>` and
  `P := [1, 2]`, `Sin(P)` is `broadcastable<number>`, the type of `Sin(P)`
  for every value the declaration admits.
- An assignment that changes the TYPE of a variable (the widening of an
  inferred type, the adoption of the value's type, the element refinement of
  a declared placeholder such as `list<unknown>`), and the restore of
  `ce.withValues()`, report a `type-write` event of their own.
- An assumption does not narrow the type of a symbol that holds a value: the
  facts are merged only into the type of a symbol with no value
  (`_typeWithFacts`).
- A sign, a count, an evaluation or an application computed in a type
  computation reads no value either, so a memo of such an answer never
  serves or stores an entry across the two views (`staticViewDiverges()`):
  the caches keyed on `_cacheGeneration()` take a key of their own inside a
  type computation, the collection facets (`BoxedFunction._facetMemo`) are
  keyed on the view, and the shared evaluation memo, the application memo
  and the eager source values are bypassed in it. With `x: real` holding 4, `Sqrt(x + 1)` is `complex`,
  also after the sign of `x + 1` was read outside a type computation. The
  key of a type that depends on the derivations in progress
  (`_typeCacheFallbackGeneration()`) is not one of them: a type does not
  depend on a value, and only the frame of an application in progress gives
  it a key of its own (`activationViewDiverges()`).
- An assumption refines the type of a variable with no value only, so a
  write that gives a variable a value, or takes it away, while assumptions
  are in force moves the type version (the `typeRead` flag of the
  `value-write` event, also at the restore of `ce.withValues()`).
- The kind of the value of a collection operation is not its static type. A
  `Map`, `Filter` or `Scan` whose type says nothing (`unknown`, `any`) or is an
  abstract `collection<T>` is an indexed collection when its sources hold
  indexed values (`BoxedFunction.isIndexedCollection`): with `fs` untyped and
  holding a list, `Map(w ↦ w(1), fs)` is typed `unknown` and evaluates to a
  list.
- A type handler that narrows by the value of an operand narrows only for a
  literal and a constant. With `z: real` holding `π/2`, `Tan(z)` is `real`,
  the type of `Tan` at a generic real, and its value is `~oo`, which `real`
  does not hold. The same holds for a parameter: with
  `h: (real) -> unknown := t ↦ Tan(t)`, `h(π/2)` is `real` and its value is
  `~oo`. `Tan(π/2)` written with the constant is `number`.

## Inference provenance and rollback

Provenance belongs to definitions, not `Type` objects. Every inference write
can record its source expression and axis. Rollback frames journal all
inference-visible state changed during a trial, including type/effect writes,
fresh-inference bookkeeping, and provisional registry changes. Frames nest;
rollback is unconditional for speculative checks and must restore both values
and invalidation metadata. A write in the environment of a unit or an
operation is not journaled: a trial (the admission of an overloaded operator,
the Epsil static check) runs in an environment that is thrown away when it
ends.

The current implementation entry points are the definition provenance journal,
the engine inference transaction helpers, and the state-event funnel described
in `EFFECTS-MODEL.md`.

Writing the type `unknown` to a value definition clears its value: the type
setter of `boxed-value-definition.ts` treats `unknown` as a reset. An
inference that narrows a bound symbol against an `unknown` or `any` slot
computes `unknown` and must not write it back, or it silently unbinds the
symbol at parse time. Code that infers again for a symbol that already holds
a value must skip an `unknown` result.

## Adding a primitive type

A primitive type (`range`, `string`) is a bare string in the type AST, while
`list` or `tuple` types with arguments are objects with a `kind`. Adding one
changes every switch over collection kinds, and the type check finds none of
these sites; only the full test suite does. The sites, as of the `range`
type:

- Declaration: the `PrimitiveType` union (`common/type/types.ts`), the kind
  arrays of `common/type/primitive.ts` (`INDEXED_COLLECTION_TYPES` feeds the
  others), and a `PRIMITIVE_SUBTYPES` entry.
- A primitive whose members have a known element type (`range` holds
  integers) needs one shared structural constant (`RANGE_STRUCTURAL_TYPE`)
  expanded at every structural site: `isSubtype()` before its bare-string
  fall-through, `collectionElementType()` and `isCollectionLike()`
  (`common/type/utils.ts`), `liftedElementTypeOf()`, `isMappedActual()` and
  `walkPattern()` (`common/type/instantiate.ts`; without the last one a
  type variable never binds, and `Sort(Range(1, 5))` is typed `list<any>`),
  the `typeCouldBe…` predicates of `collection-utils.ts`, and
  `mapResultType()` (`library/collections.ts`; without a case, `Map` over the
  value rebuilds a `Set`).
- Choose the element type that the value reported before the change, so
  that downstream types do not change.
- A narrower type can make a kind-preserving signature false: once spans
  typed `range`, `Reverse: (T) -> T where T: indexed_collection` claimed
  `range` for a descending result. Every `(T) -> T` operator that can change
  the kind needs its own case in the same change.
- A host that classifies types by `kind` does not see the new primitive as
  a collection. The CHANGELOG entry says that it is a primitive name, not a
  kind.

## Sources of truth

- Public language and API: `cortexjs.io/docs/compute-engine/08-guide-types.md`
- Effects: `EFFECTS-MODEL.md`
- Collection inference: `INFERENCE_ROADMAP.md`
- Open type-system work: `TYPE_SYSTEM_ROADMAP.md` and active plans
- Historical implementation chronology: `STATUS_REPORT.md` and Git history

## Static binding view

A function call makes a frame that is an activation of the body scope: it
holds the static definition of each parameter and of each local of the body,
with the values of this call (`docs/SCOPING-MODEL.md`, "Activations").
Ordinary evaluation therefore reads argument values and the values of locals
from that frame. During type computation, `withStaticTypingView` changes
lookup:

- A type computation reads no value from the activation of a call.
- An activation frame is skipped when reached as the parent of its body.
- A lookup starting in an activation frame on the current stack reads the
  body's static bindings instead.
- An occurrence of a function-literal parameter whose binding is not reachable
  reads no binding, not another binding of the same name. A read outside a type
  computation still reads the name. The first such read of an engine gives its
  type computations cache keys of their own (`staticViewDiverges()`).
- An occurrence of a block local (a `Declare` statement) follows the same
  rule when the only binding of its name that the lookup reaches is not a
  local of that block. With `n := [1, 2]`,
  `Block(Declare(n, "real", 2), n + 1)` is typed `real`, not `list<real>`. A
  run of the block writes the value of the local in its activation and makes
  no binding, so a type computation in the run reads the static definition.

A captured frame reached through a different scope chain, or no longer on the
current stack, remains visible. Such a frame belongs to the closure made by the
call. Active applications are associated with their engine, including suspended
applications; lookup uses the current evaluation stack rather than inferring
membership from a history of pushes and pops. Replacing a stack must not leave
lookup reading frames from the previous stack.

The view affects only the engine whose type computation is running. A type
handler that evaluates another engine reads that engine's ordinary bindings.
Evaluating the same engine stays in the static view and cannot make a type
depend on a particular call's argument values. Type handlers must not evaluate;
`guardedTypeHandlerCall` enforces version stability in tests and when
`CE_TYPE_PURITY_GUARD` is set.

Type-cache versions exclude activation declarations and frame pops because
those events do not change the static bindings. Sign, value, effect and other
evaluation caches still depend on parameter values: their static-view entries
use distinct keys (`staticViewDiverges`, `_cacheGeneration`, `_effectsOf`).
Three memos are bypassed instead, because their keys do not change inside the
view: the application memo of function literals, the memo of shared nodes
(keyed on the frame of the call) and the lazy value memo of `BoxedFunction`
(keyed on the generation and the lexical scope). A type handler can evaluate a
node: the type of `self(self, Take(f, Len(f) - 1))` reads whether the `Take` is
finite, which evaluates `Len(f)` with `f` unbound. An entry stored then would
be served to the evaluation of the call (GitHub issue #507). An application
suspended on another stack
still contributes to the engine's count of active bodies used by this check.
