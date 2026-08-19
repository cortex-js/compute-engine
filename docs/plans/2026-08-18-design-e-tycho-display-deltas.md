# Design E — signature-display deltas for consumers (the Tycho notification table)

The coordination artifact Design E §8 requires
(`docs/plans/2026-08-18-compatibility-admission-callbacks.md`): every runtime
signature-display change the E1–E3 conversions produce, in one table, to be
sent to the Tycho maintainers BEFORE their update window. These strings appear
in `Signature(op)`, `BoxedOperatorDefinition.toJSON().signature`, a boxed
operator name's `.type.toString()`, the scope listing, and hover surfaces
built on any of them.

**The one-sentence story for consumers:** callback slots are now honest arrow
types — `(T) any -> boolean` instead of the erased `function` — admitted by
COMPATIBILITY (reject only provably-unusable callbacks), and the
`callback<…>` type constructor no longer exists: it neither appears in any
engine output nor parses in any input.

**Action items for Tycho:**

1. Delete the hand-rolled `callback<…>` erasure — no engine output contains
   the constructor anymore.
2. Grep any persisted type strings for `callback<`: they no longer parse
   (the parser fails with a migration hint). The rewrite is mechanical:
   `callback<S>` → `S` with the effect slot set to `any`
   (`callback<(T) -> boolean>` → `(T) any -> boolean`; parenthesize inside
   unions).
3. Update golden files per the table below. Signatures that were BARE
   (`function` slots with no `where` clause) are now polytypes — hover/docs
   surfaces render a `where` clause where there was none.

| Operator | Before | After |
|---|---|---|
| `Any` / `All` | `(collection, predicate: function?) -> boolean` | `(collection<T>, predicate: (T) any -> boolean?) -> boolean where T` |
| `ArgMax` / `ArgMin` | `(indexed_collection<any>, key: function?) -> integer` | `(indexed_collection<T>, key: (T) any -> unknown?) -> integer where T` |
| `ChunkBy` | `((S, key: function) -> list<string> where S: string) & ((collection<T>, key: function) -> list<list<T>> where T)` | `((S, key: (character) any -> unknown) -> list<string> where S: string) & ((collection<T>, key: (T) any -> unknown) -> list<list<T>> where T)` |
| `CountIf` | `(collection, predicate: function) -> integer` | `(collection<T>, predicate: (T) any -> boolean) -> integer where T` |
| `DropWhile` / `TakeWhile` / `Filter` | `(collection, predicate: function) -> collection` | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` |
| `Find` | `(collection, predicate: function) -> any` | `(collection<T>, predicate: (T) any -> boolean) -> any where T` |
| `FlatMap` | `(collection, mapping: function) -> list` | `(collection<T>, mapping: (T) any -> U) -> list where T, U` |
| `Fold` | `(reducer: function, initial: value, collection) -> value` | `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T` |
| `GroupBy` | `(collection<any>, key: function) -> dictionary<list>` | `(collection<T>, key: (T) any -> unknown) -> dictionary<list> where T` |
| `IndexWhere` | `(collection, predicate: function) -> integer` | `(collection<T>, predicate: (T) any -> boolean) -> integer where T` |
| `Map` | `(mapping: function, collection+) -> indexed_collection` | `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U` |
| `MaxBy` / `MinBy` | `(collection<any>, key: function) -> value` | `(collection<T>, key: (T) any -> unknown) -> value where T` |
| `Ordering` | `(indexed_collection<any>, order: function?) -> list<integer>` | `(indexed_collection<T>, order: ((T) any -> unknown) \| ((any, any) any -> number)?) -> list<integer> where T` |
| `Partition` | `(collection<T>, integer \| function, integer?) -> list<list<T>> where T` | `(collection<T>, ((T) any -> boolean) \| integer, integer?) -> list<list<T>> where T` |
| `Position` | `(collection, predicate: function) -> list<integer>` | `(collection<T>, predicate: (T) any -> boolean) -> list<integer> where T` |
| `Reduce` | `(collection, reducer: function, initial: value?) -> value` | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T` |
| `Scan` | `(collection, reducer: function, initial: value?) -> indexed_collection` | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T` |
| `Sort` | `((T, order: function?) -> T where T: string) & ((indexed_collection<T>, order: function?) -> list<T> where T)` | `((T, order: ((character) any -> unknown) \| ((character, character) any -> number)?) -> T where T: string) & ((indexed_collection<T>, order: ((T) any -> unknown) \| ((any, any) any -> number)?) -> list<T> where T)` |

Unchanged, deliberately (Design E §12d — slots the type language cannot
express honestly): `Iterate` (parametric accumulator contract), `Tabulate`
(dimension-dependent generator arity), `Count` (dual value-or-predicate
second operand). Note `Partition`'s union arms display in reduced order
(arrow arm first) — a `reduceType` ordering, not a semantic change.

Behavioral deltas that ride along (details in the spec's §12b–§12d):
provably-disjoint or provably-non-boolean callbacks now REJECT at
canonicalization with `incompatible-type` naming both arrows; wrong-arity
callbacks keep the `callback-arity` diagnostic; everything that could work —
narrower named callbacks, wildcard `function` symbols, unknown-typed
operands, mixed-element sources — still enters and resolves per element at
evaluation, exactly as before.
