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
