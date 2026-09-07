# Numeric list store (Tycho 265) and typed-array boundary (Tycho 263)

**Status:** implemented 2026-09-07 (delivered unstaged, then staged, on the
main tree); revised the same day after a dual spec
review (`docs/scratch/2026-09-07-numeric-list-store-and-typed-array-boundary_SPEC_REVIEW.md`).
Rulings needed before code (§6).

Tycho filed items 261–265 on 2026-09-06 from one instrument: the Game of
Life step over a 40 000-cell board (`tycho/docs/COMPUTE_ENGINE.md`, and
`tycho/scripts/repros/2026-09-06-gol-next-lever-attribution.mts`). Items
261, 262 and 264 shipped on 2026-09-07 (CSE dominance rule, rotation views,
per-shape broadcast kernels). This document covers the two open items.

## 1. Recommendation

- **Item 265 (an engine `List` value backed by a numeric array): do it.** It
  is where the remaining cost is. Boxing a 40 000-element list costs 2.5 ms,
  the first type read costs 2.2 ms more, and `assign` walks the list once
  more. A list built over a plain `number[]` store answers all of these in
  one pass over the store (about 0.05 ms). The design keeps ONE
  representation: the value is still a canonical `List` `BoxedFunction`;
  the array is a lazily materialized source for its operands, not a second
  value class. The store is a plain `readonly number[]`, not a typed array,
  for the reason given under item 263.
- **Item 263 (a typed-array contract for the `javascript` target): no
  typed-array pipeline, and no new option.** Measured on the witness shape,
  a `Float64Array` pipeline is not faster than the plain `Array` pipeline
  the target emits today (§2). V8 already stores these arrays as unboxed
  doubles. Rewriting the 84 `Array.isArray` sites and the
  `map`/`filter`/`slice` lowerings against typed arrays has no measured
  payoff and a large blast radius. What remains of item 263 is the entry
  check: a typed array handed to a list-declared symbol is accepted by copy,
  and a non-array is an error instead of a silent `NaN`. The carrier stays
  a plain `number[]` end to end, which is also what item 265's accessor
  returns, so the two items fit with no copy between them.

## 2. Measurements (this box, load 3.6, quiet)

Witness (`gol-probe.mts`, the shipped Life step, board by reference):

| line | ms per generation |
|---|---|
| full step, twice-read `n` | 1.36 |
| `n` alone (8 rotations + broadcast sum) | 0.60 |
| hand-written typed-array loop | 0.52 |

Container comparison (`bound-probe.mts`, same shape, hand-written):

| shape | plain `Array` | `Float64Array` |
|---|---|---|
| fused single pass | 0.45 | 0.51 |
| multi-pass (sum, two `eq`, select), temps allocated per pass | 0.82 | 0.77 |
| fused single pass, real-valued board (a double array, not a small-integer array) | 0.48 | 0.45 |
| multi-pass, real-valued board | 0.80 | 0.72 |
| `Array.from(Float64Array)` of 40 000 | 0.70 | |
| index-copy `number[]` → new `Array` | 0.056 | |
| `Float64Array.from(number[])` | 0.027 | |

The typed container does not change the cost of the witness, for an integer
board or a real board (within 10 %). The remaining 2.6× between the
artifact and the fused loop is pass structure (each helper is one full pass
with one allocation), which is the item-264 residue, not a container
question. Note that `Array.from` over a typed array is slow (0.7 ms) — a
conversion must be an index loop.

Engine side (`bound-probe.mts`, the item-265 instrument):

| operation on a 40 000-element list | ms |
|---|---|
| `ce.box(['List', ...board])` | 2.49 |
| `ce.function('List', board.map(ce.number))` | 2.42 |
| first `.type` read (the shape walk `shapedListTypeD`) | +2.2 |
| `ce.assign('S', boxed)` with the type already cached | 0.54 |
| `.each()` + `.re` read-out | 0.77 |
| `.ops[i].re` read-out | 0.11 |

The `assign` cost is the `expr.unknowns.some(...)` walk in
`assignValueAsValue` (`engine-declarations.ts`), which visits every operand.
The read-out cost is the `each()` generator with its deadline check.

Tycho pays the box, the type read and the assign on every interval firing
that writes the board, and the read-out on the next firing and on the plot
(they cache a `number[]` shadow beside the value to skip the read-out today,
`tycho/src/graph-paper/actions/numeric-list-shadow.ts`).

## 3. Item 265 — a `List` with a numeric store

### 3.1 What the value is

A canonical `List` `BoxedFunction` whose operands come from a plain
`readonly number[]` store on demand. It is NOT a new value class: `_kind` is
`'function'`, `operator` is `'List'`, `isCanonical` is true, `.ops` exists
and returns boxed numbers. The only difference from a list built today is
WHEN the operands are boxed: today at construction, here on the first read
of `.ops`. After that read the node holds both the store and the operand
array, and every facet answers the same as for an ordinary list.

This satisfies `docs/COLLECTIONS-MODEL.md` §"One representation" as the
document states it: the value uses the ordinary boxed collection head, the
store does not change expression identity, and the derived facts (shape,
cell type) are the same. §6 asks for an explicit ruling on this reading.

### 3.1a Relation to the tensor view

Tensor-ness today is a view over a canonical `List`
(`boxed-expression/tensor-view.ts`): `candidateShape` and
`structuralShape` walk the operands, `isTensorValue`/`tensorShape` read the
memoized dimensions of `.type`, and `packTensor` builds a throwaway
`AbstractTensor` (`tensor/tensors.ts`, `data: DataTypeMap[DT][]`, a plain
array in row-major order) for one kernel call. The file's rule is that a
pack is NEVER cached on the node, because a pack made for one consumer can
be lossy (a `float64` pack of exact operands for `.N()`) and must not leak
into another consumer.

The store does not conflict with that rule, because the direction is the
opposite. A pack is DERIVED from the operands and can lose information; the
store is the ORIGIN of the operands, and the operands are machine numbers
exactly equal to the store's entries. There is nothing to leak: every
consumer that materializes gets the same operands, and a consumer that
reads the store gets the same numbers. The store is therefore not "a cached
pack", it is the list's literal content in the form the caller gave it.

Overlap, and what is deliberately not done here:

- The store is rank 1 only. A matrix is a nested `List` and gets no store
  in this item. (A row-major store with a shape is the natural extension,
  and it is exactly `AbstractTensor`'s layout, but it is a separate item.)
- `tensorShape` and `isTensorValue` work without materializing, because
  the type carries `[N]` (§3.4). `candidateShape` reads `ops[0]` and would
  materialize; it can gain a store check (answer `[N]`) in the same change,
  because it is on the hot dispatch path of the tensor operators.
- `packTensor` reads `.ops` cell by cell through `TensorField.cast`. For a
  store-backed list a numeric pack is a copy of the store (`slice()`, 0.05
  ms) with dtype `float64`, and a structural pack materializes as today.
  The store-aware pack is a small addition and is included, because
  `AbstractTensor.data` is also a plain `number[]`, so the two agree on the
  container.
- The `AbstractTensor` dtypes (`float64`, `int32`, `bool`, `complex128`,
  `expression`, ...) are a KERNEL-side choice per operation and stay so.
  The store has one dtype, "JS number"; the list's element TYPE
  (`integer`/`real`/...) is derived from the values (§3.4), the same way
  `numberLiteralTierType` derives it for boxed operands.

### 3.2 Public surface

```ts
// Build a List over numbers without boxing each element.
ce.list(values: ArrayLike<number>): Expression;

// Read a List's elements as a plain number array when every operand is a
// MACHINE number (a boxed number whose stored value is a JS number: a
// finite double, an infinity or NaN); undefined otherwise. Answered from
// the store when the list has one, otherwise computed by one walk over
// the operands and cached on the node as a derived array.
expr.array: readonly number[] | undefined;   // a getter
```

**What disqualifies a list.** An operand that is not a machine number
gives `undefined`: a symbol, a nested list, a boolean, a string, an exact
rational (`1/3`), a radical, a bignum, or a complex number, even one whose
imaginary part is zero. The accessor never projects through `.re`, so it
never returns an approximation of an exact value; a caller that wants
floats of an exact list evaluates it with `.N()` first, which is the
existing exact-versus-numeric contract (CLAUDE.md, "Evaluate vs. N").

**The derived array is never promoted to a store.** For an ordinary list
the walk's result is cached on the node for repeated reads, but it stays a
derived value: the node's operands remain the source, and none of the
store-answered facets of §3.3 read it. A list therefore has a store only
when it was built by `ce.list` (or the automatic route of §3.7).
This keeps the §3.1a argument intact: every store entry is exactly one of
the node's operands.

Why a plain array and not a `Float64Array`: the same measurement that
decides item 263 (§2). Typed arrays are not faster for the compiled
pipeline, Tycho's whole seam is `number[]` (their input type, their
`Array.isArray` gates, their shadow), the `javascript` target's argument bag
takes a plain array with no copy, and `AbstractTensor.data` is a plain
array. A `Float64Array` store would force a copy at every one of those
seams (and `Array.from` over a typed array costs 0.7 ms per 40 000). The
one property a typed array gives for free, "every element is a number", the
constructor guarantees instead by checking each element as it copies.

`ce.list` copies its input by an index loop into a fresh array
(0.06 ms for 40 000): the caller keeps ownership of its array and the store
is never shared with caller data. The input may be a `number[]` or any
`ArrayLike<number>` including a `Float64Array`. The constructor reads
`length` once; it must be a non-negative safe integer, else `TypeError`.
It then reads each index from `0` to `length - 1` once; each value must be
a JS number (`typeof v === 'number'`, so a hole, `undefined`, a string or
an object is a `TypeError`), never a silent `NaN`. A getter that throws
propagates. `-0` is normalized to `+0` in the store, which is what
`ce.number(-0)` boxes to, so the materialized operands and the store agree.

The store is frozen (`Object.freeze`) once at construction. It costs
nothing measurable, and a caller that writes into the array returned by
`array` then fails in strict mode instead of silently
desynchronizing the cached `hash`, `type` and `isSame` answers from the
contents. The derived array of an ordinary list (above) is frozen the same
way. Tycho copies on read today and can keep doing so; a caller that
passes the array straight into a compiled function's argument bag does not
need to copy, because compiled bodies never write to their inputs.

An empty input goes through the ordinary path (`ce.function('List', [])`) so
the empty list keeps its current type and identity.

### 3.3 Facets answered from the store

The following read the store when present and do not materialize the
operands. Everything else reads `.ops`, which materializes once.

| facet | answer from the store |
|---|---|
| `count`, `nops`, `isEmpty`, `isFinite`, `isLazyCollection` | `store.length`, false |
| `at(i)`, `iterator`/`each()` | `ce.number(store[i - 1])` |
| `contains(x)` | store equality (below) when `x` is a machine-number literal; else materialize and use the handler as today |
| `elttype` | parity with the existing handler (§3.4) |
| `type` | `list<T^N>` from one pass (§3.4) |
| `hash` | fold of the numbers (must equal the fold of the boxed operands' hashes; `BoxedNumber.hash` of a machine number is a pure function of the value, so this holds — verify with a test) |
| `isSame(other)` | store-to-store compare (store equality, element-wise) when both have a store; else materialize |
| `unknowns`, `symbols`, `freeSymbols` | `[]` |
| `isPure`, `isConstant` (value-level), `isValid` | true |
| `has(v)` | the operator-name match as today (`has('List')` is true, for the string and the array overloads); the operand walk answers false without materializing |
| `evaluate()`, `N()`, `_computeValue` | the node itself: a list of machine numbers is its own value |
| `array` | the store |

**Store equality.** Two entries are equal when both are `NaN`, or when
they are `===`. This is `BoxedNumber.isSame` restricted to machine numbers
(`isSame` is reflexive on `NaN`, `===` is not; `-0` cannot occur in a
store). The `contains` fast path applies only when the target is a boxed
machine number (`isNumber(x)` with a JS-number value); an exact rational,
a bignum or a complex target takes the materializing path, so the answer
is never computed through `.re`.

Where these live. `count`, `at`, `iterator`, `contains` and `elttype` are
the handlers returned by `basicIndexedCollectionHandlers()`
(`collection-utils.ts`). That factory is shared by `Set`, `List` and
`Tuple`, and the store check goes inside the factory body, which is
harmless because only a `List` can carry a store (next paragraph). `nops`,
`hash`, `isConstant`, `isPure`, `isValid`, `has`, `isSame`, `unknowns`,
`symbols`, `freeSymbols`, `type` and `_computeValue` are overridden or
short-circuited on `BoxedFunction`.

The audit of `boxed-function.ts` that this list comes from: the members
that read `this._ops` are `hash`, `isConstant`, `json`, `ops`, `nops`,
`isValid`, `canonical`, `toNumericValue`, `has`, `type`, `evaluate`,
`subsetOf` and `_computeValue`. Of these, `json`, `canonical` (returns the
node itself for a canonical list, so its walk is not reached),
`toNumericValue` (not reachable for a list) and `subsetOf` (a `Set`
question) are left to materialize, on purpose. `symbols` and `unknowns`
live on the abstract base and walk through the public `ops`; they get a
`BoxedFunction` override. `isPure` on `BoxedFunction` reads the definition
and the operands; it gets the store check too. A `.nops` read is the most
common operand access in the engine (arity checks, `op1`), so a store
check there is not optional: without it the first arity check anywhere
boxes the whole list.

`_ops` becomes a getter in `BoxedFunction`: it returns the stored operand
array, or builds it from the store on first access. There are 36 direct
`this._ops` reads in `boxed-function.ts`; none change, because the members
listed above short-circuit BEFORE reaching their `_ops` read, and the rest
are meant to materialize. The `BoxedFunction` constructor gains an options
member `numericStore?: readonly number[]`; when it is given, `ops` may be
omitted, and the constructor asserts `operator === 'List'` (a `Tuple`, a
`Set` or any other head with a store is a programming error, thrown at
construction, so no other operator's handlers ever see a store).

### 3.4 Type derivation

The `List` type handler (`library/collections.ts`) takes operand
DESCRIPTORS, which the framework builds from boxed operands, so the
handler cannot be the place of the short circuit: by the time it runs, the
operands exist. The short circuit is in `BoxedFunction.get type`
(`boxed-function.ts`), before the handler is called, for a node with a
store; the handler in `library/collections.ts` is not changed.

The short circuit answers: dimensions `[N]`; element type the widening of
the literal tiers present in the store, computed in one pass with the same
rules as `numberLiteralTierType` (`literal-tier.ts`): `integer` when
`Number.isInteger`, `real` for another finite number, `nan` for `NaN`,
`+oo | -oo` for an infinity. So `[1, 0, 1]` types `list<integer^3>`, which
`ce.box` gives today (measured: `vector<integer^40000>` prints for the
witness board; the printed form is the same either way). The result is
interned like any composite type and cached on the node under the same
world-version key as a literal list tree (`_typeEpoch`). A test asserts
type equality between `ce.list(xs).type` and
`ce.box(['List', ...xs]).type` for integer, mixed real, `NaN`, infinity,
single-element and two-element samples.

`elttype` is a separate handler with its own rule today: for one operand it
returns that operand's own type (the literal type, `1` for `[1]`), and for
more it widens the operands' types. The store version must give the SAME
answer as the existing handler for the same operands; parity is the
requirement, pinned by a test over the samples above. For `N === 1` it
boxes its one element and returns its type. For `N > 1` it widens the
tiers as the type short circuit does; if the parity test shows a sample
where widening the operand types differs from widening the tiers, the
implementation follows the handler and records the case in the test.

### 3.5 What stays eager

- Any operation that builds a NEW list from this one (broadcast `Add`,
  `Map`, `RotateLeft` when materialized, `Sort`, ...) produces an ordinary
  list. The store is not propagated through the interpreter. Tycho's lanes
  need the store only at the two ends (write after a firing, read before the
  next one and for the plot), so this is enough for item 265. Propagation
  through broadcast is a later, separate item if it is ever needed.
- `.json`, `.latex`, `toMathJson` walk `.ops` and materialize. A 40 000
  element serialization is slow today and stays slow.
- A structural `packTensor` (`tensor-view.ts`) reads `.ops` and
  materializes; the numeric pack reads the store (§3.1a).

### 3.6 `assign` and identity

`ce.assign('S', list)` stores the expression it is given (the
`ce.expr(value)` of an `Expression` is the same object). Tycho's memos and
its by-reference frame admission key on the identity of the assigned
object, so this must stay true; a test pins `ce.lookupDefinition('S').value
=== list` after assign. The `unknowns` walk in `assignValueAsValue` becomes
free (§3.3).

### 3.7 Automatic route (optional, second step)

`ce.box(['List', ...])` and `ce.function('List', ops)` could route to the
store when every operand is a JS number. This gives the fast path to callers
that do not know the new constructor. It is deferred to a second step, after
the explicit constructor has a full-suite run, and is gated on a
measurement of the snapshot blast radius (the type and the serialization
are the same by construction, so the expected count is zero, but it must be
measured, not assumed).

### 3.8 Compile lane

The `javascript` target folds a symbol's value into the artifact as an
array literal (`const _val_S = [ ... ]`), capped at 20 000 nodes
(`MAX_FOLD_EXPANDED_NODES`), and since the preamble hoist of 2026-09-07
that literal is evaluated once per artifact, not per call. What remains
is the cap and the size of the literal text: a 40 000-element value
cannot be folded at all today, and a value under the cap costs its text
at every compile. A store-backed value could instead be handed to the
artifact by reference through the per-artifact `_SYS` object, with no
literal text and no cap. That is a separate change with its own hoisting
rules; it is recorded here, not planned.

### 3.9 Tests

`test/compute-engine/numeric-list.test.ts`:

- constructor: type equality with the boxed form (§3.4 samples), `count`,
  `nops`, `at` incl. negative index, `each()`, `contains`, `isSame` in both
  directions against a boxed list, `hash` equality, `json` equality,
  `has('List')` and `has(['List'])` true before and after materialization,
  `elttype` parity (§3.4), `-0` normalization, empty input, `evaluate()`
  returns the node itself.
- store equality: `NaN` is contained in a list holding `NaN`; a list with
  `NaN` `isSame` itself and a boxed list with `NaN`; `contains` with an
  exact-rational target (`1/3`) takes the materializing path and answers
  as the boxed list does.
- constructor input validation: a `Float64Array` input, an `ArrayLike`
  with a negative, fractional, `NaN` or unsafe `length` (`TypeError`), a
  hole, a string element, an object element (`TypeError`), a throwing
  getter (propagates).
- a `Tuple` or `Set` constructed with a store throws at construction.
- laziness: `array`, `.count`, `.nops`, `.type`, `.hash`,
  `isConstant`, `isPure`, `has('x')`, `unknowns` and `evaluate()` on a
  fresh value do not materialize (count `ce.number` calls through a spy,
  or read the operand storage through a test-only probe); `.ops`
  materializes once and later reads reuse it.
- `array` on an ordinary machine-number list computes, caches
  and freezes; on a list with a symbol, an exact rational, a bignum, a
  radical or a complex operand returns `undefined`, and reading it changes
  nothing (type, `isSame`, `json` and exact `evaluate()` before and after
  the read are equal). The frozen store rejects a write in strict mode.
- assign identity (§3.6), and a compiled by-reference round trip: assign,
  compile with the symbol declared valueless in a pushed scope, `run` with
  `array` in the bag, rebuild with `ce.list(result)`.
- interpreter parity: `Add(ce.list(xs), 1)`, `RotateLeft`, `Sum`, `Max`,
  `Sort` give the same result as over the boxed list.
- cost pin under `CE_PERF`: constructor + type + assign of 40 000 elements
  under 0.3 ms.

## 4. Item 263 — typed-array boundary for the `javascript` target

### 4.1 Findings

- The compilation directory has no typed-array awareness: 84 `Array.isArray`
  sites, none of `ArrayBuffer.isView`. A `Float64Array` in the argument bag
  passes `checkEntry` untouched and is then read as a SCALAR: `_SYS.bcast`
  gives `NaN`, `_SYS.at` gives `NaN` without the `atNumeric` guard firing,
  `_SYS.select` throws on a non-boolean condition, `Flatten` throws a
  `TypeError` (no `.flat`), and `Map`/`Filter`/`Accumulate` lowerings would
  return a typed array that coerces booleans and complex cells to numbers.
- Tycho itself rejects a typed array on both sides today (`listInput` and
  `isNumberArray` in `tycho/src/plot-core/compiled-body.ts` are
  `Array.isArray` gates), and sizes a typed input as length 1. So the
  contract must be opt-in; a default change breaks Tycho's current lanes.
- Inside the artifact the container makes no measured difference (§2).

### 4.2 What ships — the entry check (proposed)

No compile option. The carrier contract of the `javascript` target stays
"a plain `Array` in, a plain `Array` out", and the document says so.

**Which symbols the check covers.** A symbol read from the caller whose
declared type the target lowers to a JS array, decided by a type-level
predicate (`isListEntryType`, `javascript-target.ts`): the type matches
`list<any>` or the indexed-collection shape top, and NO string inhabits it
(`isSubtype('string', t)` is false). The second half excludes `string`
itself and the bare `indexed_collection` (which a string inhabits), while
`list<...>`, `vector<...>`, `range` and `indexed_collection<number>` stay
covered. The exclusion matters: a string-typed or bare
`indexed_collection`-typed symbol is a legitimate caller value for the
compiled string operations, and a gate on the shape alone would treat it
as a list. (The draft named the expression-level predicate
`isIndexedCollectionOperand`; it admits the bare `indexed_collection`, so
it could not serve.) A symbol whose declared type is a union that admits
both a scalar and a collection (`number | list<number>`) is not covered.

**Both entry routes.** The target has two entry plans: the `vars` kind,
built by `varsEntryPlan` for an expression compiled against free symbols
(the caller passes an object, `run({ S: board })`), and the `args` kind,
built by `lambdaEntryPlan` for a compiled lambda whose parameters are
positional. Both plans gain a list class beside the real/complex classes
(names for `vars`, indices for `args`), and both branches of `checkEntry`
apply the rules below. Tycho's witness uses the `vars` route; a lambda
`(board: list<number>) -> ...` is the `args` route and is tested too.

For every covered symbol, `checkEntry` applies:

- a plain `Array` is accepted as today, with no copy;
- a numeric typed array (`Float64Array`, `Float32Array`, `Int32Array`, ...;
  not a `BigInt` view) is accepted and copied by an index loop into a plain
  `Array` once per call (0.056 ms for 40 000; 4 % of the witness step). The
  artifact body is unchanged and sees a plain array. This cannot break a
  caller: today the same call gives `NaN` or throws;
- any other value (a number, a string, an object, `undefined`) passes
  through untouched, as today. The draft made this an entry error on the
  premise that such a call "gives `NaN` or throws" today; the
  implementation found the premise false: several lowerings dispatch on the
  RUNTIME shape and handle a scalar correctly (`Add(M, 1)` with
  `M: list<number>` bound to `5` gives `6`), and
  `test/compute-engine/compile-elementwise-bigop.test.ts` pins that lane on
  purpose ("a scalar-at-runtime body stays scalar"). So the error is not
  shipped; §6 ruling 3 records the evidence and stays open.

**Exit.** Unchanged: `normalizeRunResult` keeps returning a fresh plain
`Array`. A typed result was in Tycho's ask only as the other end of a
typed carrier, and the carrier stays plain (§3.2).

### 4.3 Typed arrays inside the artifact (declined)

Rewriting the `_SYS` helpers and the emitted lowerings against typed arrays
would touch the 84 sites, every `.map`/`.filter`/`.slice`/`.flat`/spread
lowering, the `RotView` and broadcast kernels, and the result normalizer,
with a result-kind rule per helper (`eq` answers booleans, `select` may mix
cells). The measured gain on the witness is nil. Declined. Reopen only with
a measurement that shows a typed pipeline at least 1.5× faster than the
plain one on a witness Tycho cares about.

### 4.4 Tests

`test/compute-engine/compile-list-entry.test.ts`: a typed array is
accepted and copied (the body sees `Array.isArray` true and the caller's
buffer is not aliased), a scalar, a string, an object and a non-numeric
view on a list-declared symbol pass through untouched (a scalar gives the
runtime-projected value it gives today), a plain array still passes without
a copy (identity visible through a caller-supplied `functions` entry), a
string-typed symbol still accepts a string, an `indexed_collection`-typed
symbol still accepts a string and an array, a `number | list<number>`
symbol still accepts a scalar, the same acceptance and errors through a
compiled lambda with a `list<number>` parameter (the `args` route), and
the Life witness round trip with a `Float64Array` board in and a plain
`Array` out.

## 5. Delivery

1. Item 265 §3.1–3.6 and §3.9 (one worktree, dual review, full suite under
   the box lock). Files: `boxed-function.ts`, `collection-utils.ts`,
   `library/collections.ts` (type handler), `engine-expression-entrypoints.ts`
   and `index.ts` (constructor), `types-expression.ts` (accessor), `api.md`
   regenerated, CHANGELOG.
2. Item 263 §4.2 and §4.4 (same worktree or a second one). Files:
   `compilation/javascript-target.ts` (`varsEntryPlan`, `lambdaEntryPlan`,
   both branches of `checkEntry`), `docs/COMPILATION-MODEL.md` (the
   carrier contract stated), CHANGELOG.
3. Optional third step: §3.7 automatic route, after a blast-radius count.
4. Ping Tycho with the version. Their half: replace the
   `ce.function('List', ops)` write with `ce.list(values)`, read
   through `array` in place of the shadow (their seam stays
   `number[]`, nothing to widen), and drop the typed-carrier plan under
   item 263 with the measurement in §2 as the reason.

## 6. Rulings needed

1. **One representation.** `docs/COLLECTIONS-MODEL.md` says collection
   values use ordinary boxed heads and there is no second representation.
   Under this proposal `ce.list([1, 0, 1])` is a canonical `List`
   `BoxedFunction` with `.ops` that boxes on first read; the `number[]`
   store is a lazily materialized operand source. Is this within the ruling, or
   does it need the ruling amended? If it is outside the ruling and cannot
   be amended, item 265 cannot be built, and Tycho keeps paying about 5 ms
   per board write.
2. **Name — RULED 2026-09-07.** The constructor is `ce.list(values)` and
   the accessor is the getter `expr.array`. (The draft had `ce.numericList`
   and `numericElements()`.)
3. **Entry error for a non-array on a list-declared symbol — NOT SHIPPED,
   evidence recorded.** The draft assumed `run({ S: 5 })` for
   `S: list<number>` returns `NaN` quietly. It does not: the lowerings
   project on the runtime shape, `Add(S, 1)` gives `6`, and
   `compile-elementwise-bigop.test.ts` pins "a scalar-at-runtime body stays
   scalar" on purpose. The shipped change leaves a non-array untouched.
   Open question, for a later round if wanted: should a scalar on a
   list-declared binding become an error anyway (which retires that lane
   and its pin), or is the runtime projection the contract? Saying nothing
   keeps the projection.
4. **Closing item 263 as "no typed pipeline".** Tycho asked for a typed
   carrier because they expected it to be faster. The measurement says it
   is not. The proposal answers item 263 with the entry check only and
   tells Tycho to keep `number[]`. Agree, or keep a typed-array result
   option on the table for a later round? Saying nothing closes it.
