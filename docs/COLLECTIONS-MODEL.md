# Collections Model

**Status:** normative internal reference for implemented collection behavior.

## One representation

Collection values use ordinary boxed collection heads. Tensors are canonical
`List` expressions with a lazy tensor view; there is no second `BoxedTensor`
value representation. Shape and cell type are derived from the collection and
may be cached, but the view does not change expression identity.

Dimensioned tensor types bridge to their nested-list encoding. Shape
regularity is independent of the cell type, and tensor operations must keep
the inferred cell type a sound upper bound of the literal cells.

## Broadcasting and pairing

Implicitly lifted operators use strict length agreement. Explicit pairing
constructors (`Zip`, variadic `Map`, and `PointList`) use shortest-input
semantics. Scalars lift and are evaluated once. The detailed mismatch policy,
including unknown and infinite lengths, is normative in
`BROADCAST-MODEL.md`.

Result typing follows the value route. If an operator broadcasts over a
collection, its scalar result type is lifted to a collection result exactly
once. Tensor-specialized `Add` and `Multiply` provide their tensor result type
directly and are not wrapped a second time.

Elementwise `If`/`Which` belongs to the strict lifted regime. Conditions and
selected list-valued arms share a length; selection is lazy per element;
unmatched positions preserve shape with the documented absence value.

## Tuple slots and aligned rows

A data tuple has fixed positions. `Nothing` occupies a slot rather than
removing it: `(1, Nothing, 3)` has three coordinates, and its second coordinate
is `Nothing`. Counting or indexing the tuple does not evaluate earlier
coordinates to discover which ones survive. Tuple types retain the same slots,
including `nothing` and possible `nothing` results. `Map` resolves possible
omission in the coordinate it reads before deciding whether to invoke its
callback; reading a later index does not scan earlier coordinates.

A tuple whose coordinates are all missing is still present:
`(Missing, Missing)` is a pair, not a missing whole value. `Zip` constructs one
such tuple per aligned source position, up to the shortest source length. It
keeps `Nothing` coordinates and all-missing rows. `ListFrom(Zip(...))` retains
these rows because each row is a present tuple; omission is immediate, not
recursive into its coordinates.

The LaTeX spelling `(x,)` still constructs a singleton tuple; its trailing
comma is syntax. `(x, Nothing)` constructs a pair with an actual omitted
coordinate. Explicit `Sequence` operands still splice under their ordinary
omission rules.
`Single`, `Pair` and `Triple` retain `Nothing` slots and validate the resulting
arity. Lists continue to omit immediate `Nothing` during construction.
`TupleFrom` retains its existing omission behavior pending a separate decision
on structural conversions. Ordinary function arguments and the effect/capture
rules for nested views are separate work. The legacy empty-tuple type reduces
to `nothing`; a distinct unit/empty-tuple type remains a design question.

Compilation refuses tuple construction with possible `Nothing` coordinates and
`Zip` sources with possible immediate `Nothing` until targets can distinguish
it from missing data. JavaScript and Python preserve explicitly constructed
all-missing tuples in their existing tuple representations.

## Lazy collections

Laziness is a depth property, not permission to skip operand evaluation.
Evaluating a lazy collection resolves the operands required to define the view
but does not materialize an unbounded or oversized sequence. Materialization,
enumerability, and known length are separate facts.

An eager producer may declare `canEnumerate` when its elements can be walked
without first replacing the expression with a materialized list. Unknown
enumerability stays `undefined`; callers must not collapse it to `false`.

A lazy operator holds its operands. When its source is not a collection
value yet, the evaluation of the lazy node evaluates that source once and
applies the operator to the value. Such a source is an eager operator call
(the element read `At(t, 1)`, a `Sort`), a call of a user function, or a
symbol whose value is such a call. With `t` assigned `([3, 1, 2], [4])`,
`Dedup(At(t, 1))` evaluates to `Dedup([3, 1, 2])`, a view that materializes
to `[3, 1, 2]`, and `ArgMax(At(t, 1))` evaluates to `1`. The rule applies to:

- the source slots (the slots typed as a collection) of `Map`, `Filter`,
  `Reduce`, `Scan`, `Any`, `All`, `TakeWhile`, `DropWhile`, `FlatMap`,
  `MaxBy`, `MinBy`, `ArgMax`, `ArgMin`, `Dedup` and `Differences`;
- the collection of the first `Element` clause of a `Comprehension`, when it
  does not mention the index of a clause;
- a collection-typed operand at a numeric parameter of a lazy broadcastable
  operator (`Numerator`, `Denominator`, `NumeratorDenominator`), which then
  broadcasts over the value as it does over a literal list;
- a view whose operands are evaluated (`Reverse`, `Join`, `Take`, ...) under
  an explicit `materialization` option: the view is materialized after its
  operands are evaluated, so `Reverse(At(t, 1)).evaluate({ materialization:
  true })` is `[2, 1, 3]`.

If the value of the source is an error, the error is the value of the node,
with a breadcrumb that names the operator and the operand. If the value cannot
be a collection (the number `5`), the value of the node is the
`incompatible-type` error that names the expected collection type. If the
source stays symbolic (`Sort(xs)` for a valueless `xs`), the node stays as it
is. The display preview (`toString()`, the `latex` getter, `toLatex()` without
a `materialization` option) does not evaluate an operand of a view that is not
a collection value yet: an unevaluated view over such an operand prints as
written (`\mathrm{Reverse}(t[1])`, `\mathrm{Join}(\mathrm{src}(1), [4])`), and
its value prints after an evaluation. The implementation is
`heldEagerSources()`, `materializesAfterOperands()` and
`previewHoldsEagerOperand()` in `boxed-expression/boxed-function.ts`.

A source that is provably not a collection is refused when the call is boxed,
as for an eager operator: `Dedup(5)` is `Dedup(Error(incompatible-type,
collection, 5))`, an invalid call typed `error`
(`refusedCollectionSourceOperands()` in `boxed-expression/validate.ts`).

A source slot declared `indexed_collection` (`Differences`, `ArgMax`,
`ArgMin`) reads its source by position, and refuses a collection without
positions (a set, a dictionary, `Integers`). The boxing refuses a literal
set: `Differences(Set(3, 1))` is `Differences(Error(incompatible-type,
indexed_collection, set<integer>))`. A symbol of a wider declared type that
holds a set is admitted by the boxing, and the evaluation gives the error as
the value of the node, with the frame of the operator. The positional eager
operators `DeleteAt`, `ReplaceAt` and `Insert` do the same: with
`c: collection<integer>` assigned `Set(3, 1)`, `DeleteAt(c, 1)` is
`Error(incompatible-type, indexed_collection, set<integer>)`, as `Sort(c)` is.
Before, these operators read the set in its iteration order. Decision of the
user, 2026-10-17.

Memoized collection elements record their actual dependencies. A state event
invalidates only entries whose dependency axes changed. Cyclic lazy views stay
symbolic rather than recursing without bound.

## Lists of machine numbers

A broadcast over more than a hundred elements answers a lazy `Map`. That form
exists for a source that is itself lazy or very large, such as a `Map` over a
long `Range`. A `List` of machine numbers is already in memory, so for such
operands the arithmetic is computed at once, on doubles, and answered as a
list that holds its numbers unboxed (`ce.list()`). Decision of the user,
2026-09-21: eager arithmetic for machine-numeric lists at machine precision.
The implementation is `machineBroadcast`
(`boxed-expression/machine-broadcast.ts`); both places that choose between
the lazy form and the element loop ask it first (`lazyBroadcastMapIfNeeded`
and `broadcastOverIndexedCollections` in `collection-utils.ts`).

The one rule: the doubles are used only when they are the values the
interpreter computes element by element. Every other case takes the route it
took before.

- **Operands.** A `List` for which `isMachineNumeric` is true, a symbol whose
  value is such a list, or a machine number. An exact rational (`1/2`), a
  radical, a complex number, a symbol or a nested list among the elements
  declines. An exact rational SCALAR is admitted in a sum or a product of two
  operands (`L / 3` is `Multiply(1/3, L)`): with a float the interpreter
  makes one operation with the double of the rational, `x·(p/q)` or
  `x + (p/q)` (measured on 16,000 cells each); a list that holds an integer
  declines, because `(1/3)·2` is the exact `2/3`. Every value must be finite:
  `0 · ∞`, `∞ − ∞` and `NaN` are decided by the interpreter.
- **Heads.** `Add` and `Multiply` of two or more operands, `Negate`, and a
  scalar times a vector on the tensor route (`scaleMachineVector`). One
  operation on two doubles is correctly rounded in any order; with three or
  more operands the integers are combined first, exactly, as the interpreter
  does, and then the floats from left to right. The last digit of a float
  may then differ from the element-by-element value, which is accepted for
  the performance (user decision, 2026-09-21). An exact value never
  changes.
- **Functions of one number.** `Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`,
  `Sinh`, `Cosh`, `Tanh`, `Ln`, `Sqrt`, `Abs`, `Floor`, `Ceil`, `Round`,
  `Power` with a machine-number exponent, `Arctan`, `Arcsin`, `Arccos` and a
  power of `e` (`machine-broadcast.ts`, `FUNCTION_KERNELS`). Each kernel is
  the `Math` primitive the scalar route
  computes for a machine float, measured bit for bit on 3,000 random floats
  per head under both routes. `Round` is the one head whose kernel is not a
  bare `Math` primitive: a value halfway between two integers is rounded
  with the rule of `ce.roundingTies` (by default away from zero:
  `Round(-0.5)` is `-1`), which `Math.round` does not do, so the kernel is
  `roundToInteger` — the rule the scalar route follows at every precision. The inputs on which the scalar route takes
  another way are declined, and the whole list then keeps the lazy form:
  an integer element under `evaluate()` (`Sinh(1)` and `Sqrt(2)` are exact;
  `|−3|`, `⌊2.5⌋` and `3^2` are admitted), an argument outside the real
  domain (`Sqrt` and `Ln` of a negative, `Arcsin` outside `[−1, 1]`), a
  value past a million in magnitude for `Tan` and its relatives (the pole
  `~oo`), under `evaluate()` the exponent `0.5` of `e` (`e^0.5` is `√e`),
  an angular unit other than radians, and a non-finite result. The
  trigonometric heads and their inverses decline no special argument: the
  scalar route answers an exact value only for an exact argument (an exact
  rational multiple of `π` for `Sin`, the exact `1/2` for `Arcsin`), and a
  float is never special, so `Sin(3.141592653589793)` is the float
  `1.2246467991473532e-16` and `Arcsin(0.5)` is `0.5235987755982989`, on
  both routes. `Log` and `Lb` (canonically `Log(x, 2)`), and
  `Log(x, 10)`, compute `Math.log10` and `Math.log2`, the primitives of the
  `N()` route; another base has no kernel.
- **Reductions of a body.** `Sum(…).N()` of a body with no indexing set
  first evaluates the body on the numeric route and adds the doubles when
  the value is a finite list of machine numbers, so that `Sum(Exp(L)).N()`
  reaches a kernel that works under `N()` only; `Sum(L / 3).N()` then adds
  `0.333… · v` where `Sum(L / 3).evaluate().N()` adds `v / 3`. Any other
  value (an overflow to an infinity, a pole, a lazy collection) takes the
  exact route, as before.
- **Precision.** Machine precision only. Above it a broadcast of integers
  over a symbol keeps the lazy `Map` that the exact compiled tier reads (see
  "Map execution"). Each float must be stored as a double. A float made at a higher precision
  keeps its decimal digits after the engine is set to machine precision, and
  the interpreter multiplies those digits (`0.1 · 3` is `0.3` for such a
  `0.1`; the doubles give `0.30000000000000004`).
- **Exact integers.** A cell whose operands are all integers declines when
  an operand or the result is past the safe integer range. Any result that is an integer past the safe range declines,
  because `ce.number()` makes it an exact big integer.
- **Reductions.** At machine precision `Sum`, `Max` and `Min` fold the doubles
  of such a list. `Sum` adds in order, which is what the fold does. `Max` and
  `Min` apply the rules of the comparison the fold uses: a value replaces the
  extremum so far only when it differs from it by more than the tolerance of
  the engine, except against `0`, whose comparison reads the sign.
- **Coordinates.** `PointX`, `PointY` and `PointZ` over a written-out list of
  more than a hundred points answer a list of unboxed doubles when every
  coordinate is a machine number.

What a consumer of the lazy form sees: the result is a `List` of numbers where
it was `Map(f, L)`. It is a value, as the result already was for a hundred
elements or fewer: a later assignment to `L` does not change it, where the
lazy `Map` named the symbol `L` and followed it. The elements are the same
numbers. One difference in later arithmetic is known: an element that is an
integer-valued result of float arithmetic (`1.5 + 1.5`) is held as the integer
`3`, and a `Sum` of such elements past `2^53` is then the exact integer where
the fold over the lazy form answered a rounded float.

## Map execution

Stacked eligible `Map` views may lower to one element loop. Lowering preserves
per-level numeric-approximation mode, effects, dependency revalidation,
failure behavior, and `at()`/iterator parity. It does not fuse through
predicate or reshaping views.

Implicit JIT is controlled by the engine-wide `jit` setting. Exact and
bignum drains remain interpreted unless an exactness proof admits a compiled
route. Per-element ABI failures fall back according to the documented route;
environment failures latch implicit JIT off for that engine.

## Points and `PointList`

Numeric tuples are point values only where the point contract applies; tuple
structure in general remains structural data. `PointList` pairs its collection
sources to the shortest source and lifts scalar components. Components are
evaluated once in operand order.

A coordinate is a number or a list of numbers, so a component that is a
point is refused. A component whose type is a tuple (the bare `tuple`,
`tuple<…>`, a union of tuples, possibly absent) is refused when the call is
boxed: `PointList([1, 2], (5, 6))` is `PointList([1, 2],
Error(incompatible-type, list<number> | number, tuple<integer, integer>))`.
A component whose value is a tuple (a symbol declared `unknown`) is refused
when the call is evaluated. Before, the whole point was put in each
coordinate: `[(1, (5, 6)), (2, (5, 6))]`. Decision of the user, 2026-10-17.

JavaScript compilation emits the same shortest zip. Point projections may
compile directly when shape is known. GPU construction remains fail-closed;
the implemented GPU `At` boundary is specified in `COMPILATION-MODEL.md`.

## Strings

Strings are indexed collections of grapheme-cluster `character` values, while
preserving their string kind through operations designated as
string-preserving. Search ranges and slicing count grapheme clusters, never UTF
code units. Regular expressions, sequence operations, joining, and collation
rules are normative in `STRING_ROADMAP.md` until that document is renamed.
