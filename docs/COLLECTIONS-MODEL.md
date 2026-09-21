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

## Lazy collections

Laziness is a depth property, not permission to skip operand evaluation.
Evaluating a lazy collection resolves the operands required to define the view
but does not materialize an unbounded or oversized sequence. Materialization,
enumerability, and known length are separate facts.

An eager producer may declare `canEnumerate` when its elements can be walked
without first replacing the expression with a materialized list. Unknown
enumerability stays `undefined`; callers must not collapse it to `false`.

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
  declines. Every value must be finite: `0 · ∞`, `∞ − ∞` and `NaN` are decided
  by the interpreter.
- **Heads.** `Add` and `Multiply` of exactly two operands, `Negate`, and a
  scalar times a vector on the tensor route (`scaleMachineVector`). One
  operation on two doubles is correctly rounded in any order. A sum or a
  product of three or more operands is not reproduced: the interpreter adds
  the exact operands apart from the floats. A function head (`Sin`, `Sqrt`,
  `Power`, `Divide`) keeps the lazy form: an integer argument stays exact
  under `evaluate()` (`Sin(1)`), a negative argument can have a complex
  value, and the primitive must be the one the interpreter uses.
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

JavaScript compilation emits the same shortest zip. Point projections may
compile directly when shape is known. GPU construction remains fail-closed;
the implemented GPU `At` boundary is specified in `COMPILATION-MODEL.md`.

## Strings

Strings are indexed collections of grapheme-cluster `character` values, while
preserving their string kind through operations designated as
string-preserving. Search ranges and slicing count grapheme clusters, never UTF
code units. Regular expressions, sequence operations, joining, and collation
rules are normative in `STRING_ROADMAP.md` until that document is renamed.
