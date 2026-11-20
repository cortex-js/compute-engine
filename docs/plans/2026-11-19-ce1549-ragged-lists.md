# CE-1549: compiling `Chunk` and `Partition` whose rows differ in length

Status: design note, not approved. No code is written.

Issue: `issues/CE-1549.md`. Scope: the `javascript` target of the IR compiler
(`src/compute-engine/compilation/ir/`); GLSL, interval and `bigint` decline.

## 1. The question

`Chunk(L, k)`, `Partition(L, n)` with `L: list<real>` of run-time length, and
`Partition(L, p)` with a predicate `p` give a list of lists whose rows can
differ in length. The IR has no type for that value. The note asks whether a
shape is needed at all, and finds that none is: the bare value needs one
opaque value at one place (the result), and the consumers that reduce a row
need no new type.

## 2. What the code does today

Read at `b40a4594124f9564bf2b2a7ae00360c33d414011` and on the working tree.

- A type is a lane and a shape (`IRType`, `ir.ts`); a shape is a list of
  `Length`, each a number or one SSA value. Every row of a list has the same
  inner length.
- The IR cannot hold a list whose inner length is a run-time value: `over()`
  (`lower-lists.ts`) and `list()` (`lower.ts`) decline it ("a list of lists of
  run-time length"), and `inputType()` (`lower-functions.ts`) gives no type to
  such an input. Raggedness is the second gap, not the first.
- A list built and reduced inside a region compiles: with `n: integer`,
  `Map(i ↦ Sum(Take(L, i)), Range(1, n))` compiles (probed).
- `more()` (`lower-lists.ts`) compiles rows of one length only. In order: a
  predicate calls `ragged()`; a count that is not a constant calls `ragged()`
  (before the three-operand branch, so `Partition(L, n, step)` with a
  run-time `n` also reaches `ragged()`); a constant count below 1 declines;
  the three-operand form gives complete windows (compiles for a run-time
  length: `Partition(L, 2, 1)`, probed); the two-operand form needs a stated
  length `m` with `size · rows = m` (`windows()`), else `ragged()`.
- A root `Tuple` whose elements are not of one shape is a multi-result entry
  (`IRFunction.tuple`, `ir.ts`; `retTuple`, `print-js.ts`). A root `Tuple`
  whose elements have one shape is a tuple (`tuple()` in `lower.ts`).
- The string lane is the precedent for an opaque value: no numeric row names
  it, so every row declines it, and no pass has a case for it
  (`ir/README.md`, "The string lane"). No code switches over `Lane`
  exhaustively; the lanes are listed in `ir.ts`, `verify.ts` and `index.ts`.
- `resultType()` (`operators.ts`) gives a signature whose result is a lane the
  shape of its first list operand, and `verify()` recomputes the type with it
  (`case 'op'`). A list operand with a lane result therefore types a list.
- `Profile.resultOnly` (`index.ts`, `admits()`) admits an operation only as an
  entry yield used once, after the passes; its cause names the row's `head`
  and is about colours. Only GLSL sets it.
- `strings` (`CompilationResult`, `types.ts`; `StoredJavaScript`) is public
  and documented as "the code reads or returns a string". The adapter
  (`compileIr`) reads it for `shippable`, `broadcast`, `broadcastAsync` and
  `willUsePool`; `storedExpressionRunner()` (`javascript-runtime.ts`), which
  the stored batch loaders call, refuses it.

## 3. The interpreter's values (the contract)

From `library/collections.ts` (`Chunk.evaluate`, `partitionWalk`), checked by
evaluation:

| Case | Interpreter |
| --- | --- |
| `Chunk(L, k)`, `1 ≤ k ≤ 10,000` | `k` rows; `s = ⌈len/k⌉`; row `i` is `L[i·s .. (i+1)·s)` |
| short last row | `Chunk([1..5], 3)` is `[[1,2],[3,4],[5]]` |
| `k > len` | `Chunk([1,2,3], 5)` is `[[1],[2],[3],[],[]]` |
| `len = 4, k = 3` | `[[1,2],[3,4],[]]` |
| `Chunk([], k)` | `k` empty rows |
| `k ≤ 0`, `k > 10,000` | unevaluated |
| `Partition(L, n)`, `n ≥ 1` | rows of `n`, the last shorter; `⌈len/n⌉` rows; `[]` for `[]`; one row for `n > len` |
| `n ≤ 0` | unevaluated; a non-integer `n` is a type error |
| `Partition(L, p)` | `[[x: p(x)], [x: not p(x)]]`; `Missing` goes to the second |
| a lazy source past `maxCollectionSize` (10,000) | `Chunk` and `Partition(L, p)` unevaluated (`eagerElementWalk()`): `Chunk(Range(1, 10001), 2)` |
| a materialised list of 20,001 elements | `Chunk` and `Partition(L, p)` evaluate (no cap) |

## 4. The options

**(a) A ragged shape across the core.** A per-row length. The type of
`elem(R, i)` would name a length that exists only after a read at `i`, so
every function of `ir.ts` that reads a shape, the verifier's dominance rule,
the passes that track length values, `outline.ts`, `resultType()`, the arms of
`If`, the inputs and the printers change, after the first gap is solved.
Estimate, not measured: 1,000 to 2,000 lines of core code.

**(b) An opaque nested list.** A lane `rows` whose value is the JavaScript
array of arrays, made by per-operator rows and read by no numeric row,
admitted only as the program's result.

**(c) Fusion of the consumers.** `Chunk` and `Partition` become a lazy
`Source` in `source()` (`lower-lists.ts`), as `Range` already is: `length` is
the row count, `at(i)` builds row `i` with `reindexed()` inside the
consumer's region. `Length`, `Map`, a reduction and a `Comprehension` read
sources; a consumer that yields a row declines in `over()` as today. No core
change. It does not serve the bare value.

**(d) Leave it declined.** No cost; the interpreter computes the value.

## 5. Recommendation

(b) for the bare value and (c) for the consumers that reduce a row, in one
change; reject (a). Both settle every shape at compile time and emit no
run-time test of a type.

**The witness of the consumers.** `docs/ISSUE_TRACKING.md` defines
`plausible` as a program of one or two lines that a user would write, with
the inputs declared as a host declares them. `Map(r ↦ Sum(r), Chunk(L, k))`
(the sum of each bin) with `L: list<real>` is such a program, and so are
`Length(Partition(L, n))` and `At(Partition(L, p), 1)` (the elements where `p`
holds). They are `plausible`, so their declines are removed, by (c).

### 5.1 Which operands compile

Every form needs `nops === 2`; the list `L` must be a symbol read as an input
of the entry, or a literal `List` (also a name whose value is one), of reals,
integers or booleans (`flat()`). Its value is then a materialised array in the
interpreter, with no cap. Any other `L` (a `Range`, a `Map`, a `Filter`, a
local, a parameter) declines with "Chunk of a computed list (the interpreter
leaves it unevaluated past maxCollectionSize)". A sound cap check on a
computed source is a separate task. `Partition(L, n, step)` keeps today's
code; with a count that is not a constant it declines with its own cause
("Partition in windows of a size that is not a constant"), not through the
new path, which would give consecutive chunks: a wrong value.

Counts: a constant below 1, and a constant `k` above `MAX_CHUNK_COUNT`,
decline. A run-time count is checked where it is used and throws a
`RangeError` that names the operator where the interpreter is unevaluated (a
throw is an allowed difference, "Caveats of compiled code"). The alternative,
declining a run-time count as today, is sound and gives fewer compiled
programs. A real count declines in `count()` as today.

### 5.2 (b): the bare value

- `Chunk(L, k)`: `rows.chunk(l, k)`; `Partition(L, n)`: `rows.partition(l,
  n)`, `l` the input array or the array literal.
- `Partition(L, p)`: `ks = listSource(where(e, s, p))`,
  `t = reindexed(e, s, ks.length, (k) => ks.at(k))`, the same with
  `where(e, s, p, true)` for `f`, then `rows.pair(t, f)`. A predicate with an
  effect declines in `where()`.
- The rows of one length that compile today keep their code (`windows()`).
- The helpers (`_SYS.chunk`, `_SYS.partition`, `javascript-runtime.ts`) check
  the count, then build each row with `Array.prototype.slice.call(l, a, b)`,
  so each row is a plain array also for an array-like input (a
  `Float64Array` given with `entryChecks: false`, a value outside the type).
  `rows.pair` is spelled `[$0, $1]`.

**Result typing.** A signature whose result is the lane `rows` gives the
type `{ lane: 'rows', shape: [] }` whatever the shapes of its operands: a rule
in `resultType()`, before the shape comparison, so the two independently sized
operands of `rows.pair` are not compared. `verify()` reads the same function.

**The use boundary.** A `rows` value is admitted only as an entry yield used
once (`resultOnly` on the JavaScript profile). The invariant: every lowering
that reads a `rows` value either checks its lane and declines, or passes it
through unchanged, or does not depend on it; in the last two cases the result
equals the interpreter's. From the code read: `Rank`, `Shape`, `Flatten`,
`Transpose` check the lane (`numbers()`, `lower-matrices.ts`); `Max`, `Mean`,
arithmetic and comparisons find no signature; `Length`, `Map`, `Sum` read a
source and decline "a scalar where a list is required"; `ListJoin`,
`PointList`, `List` and a one-shape `Tuple` wrap it in a list of the lane,
which `scalarLanes` refuses; `Coalesce` and `AssertPresent` pass it through
(`absent()` gives `false` for the lane), and `IsMissing` gives `False`, the
interpreter's value, after which `dce` removes the producer. A local returned
by a root `Block` and an identity `Apply` are the same SSA value, and admitted.
A user function that returns its `rows` argument compiles when `inline` copies
it and declines otherwise; one that ignores it gives the interpreter's value.
An `If` between two `rows` values is refused unless `fold` takes one arm. A
root `Tuple` of a `rows` value and an element of another shape
(`Tuple(Chunk(L, 2), L)`) is a multi-result entry and is admitted; with a
scalar (`Tuple(Chunk(L, 2), x)`) it declines ("elements of two types");
`Tuple(Chunk(L, 2), Chunk(L, 2), L)` declines, since `cse` makes one value
used twice.

**The refusal cause.** `resultOnly` becomes a map from the operation to its
cause, so that `admits()` names the operator without a `head`: the GLSL
entries keep the colour text, the `rows.*` entries give "Chunk or Partition
with rows of different lengths, other than as the result of the program".

**Batches and stored code.** A new optional public field `rows: true` on the
compilation result and on `StoredJavaScript` ("the result is a list of lists
of rows of different lengths: no batch form"), separate from `strings`, whose
documented meaning stays. Where `strings` refuses, `rows` refuses too, with
its own `TypeError`: `broadcast`, the batch slice, `broadcastAsync`,
`willUsePool` (false), `shippable` (false), and `storedExpressionRunner()`, so
`loadBroadcast()`, `loadBroadcastSlice()` and `loadBroadcastAsync()` throw.
The stored copy keeps the field. `run()`, `runtime.load()` and `runAsync()`
return the nested arrays.

### 5.3 (c): the consumers

`source()` gets a case for a library `Chunk` or `Partition` of two operands,
with the operand rule of 5.1: `length` is `k`, `⌈len/n⌉` or 2, and `at(i)` is
row `i` from `reindexed()` over `L`, of length
`max(0, min(s, len − i·s))` (`Chunk`), `min(n, len − i·n)` (`Partition`), or
`t` and `f` above (a constant index picks one; a run-time index is an `if`
between two lists of two lengths, `ir/README.md`, "Lists"). `At` of a constant
index in range of a constant count (`Chunk`, the predicate form) reads
`at(i)`; any other `At` declines (an absent row, as for lists of lists today).
A row with a run-time length that the consumer yields declines in `over()`.
On GLSL the case compiles only when every row length is a constant.

## 6. Core touch points

| File | Function | Change |
| --- | --- | --- |
| `ir/ir.ts` | `Lane`, header comment | add `'rows'` |
| `ir/operators.ts` | `resultType()` | a `rows` result is `{ lane: 'rows', shape: [] }`, no shape comparison |
| `ir/verify.ts` | `define()` in `region()` | add `'rows'` to the lane list (the `op` case reads `resultType()`) |
| `ir/index.ts` | `Profile`, `TARGETS` | `resultOnly` as a map to causes (GLSL rewritten); JavaScript: `rows` in `lanes` and `scalarLanes`, three `resultOnly` entries |
| `ir/index.ts` | `admits()` | the cause from the map; "a list of rows" in the `scalarLanes` text |
| `ir/adapter.ts` | `compileIr` | the `rows` flag in `shippable`, `inFrame`, `broadcastAsync`, `willUsePool` and the result |
| `compilation/types.ts` | `CompilationResult`, `StoredJavaScript` | the public field `rows` |
| `compilation/javascript-runtime.ts` | `storedExpressionRunner()`, the stored copy | refuse `rows`; its error |

No change to `passes.ts`, `print.ts`, `outline.ts` or the GLSL and interval
printers. To check while implementing: a pass that reads `shape.length ===
0` as "a number" must also read the lane, as for `string`; a miss is a
`SliceInternalError` in the suite, since the verifier checks each operand
against its row (`operandFits`).

## 7. Peripheral touch points

- `ir/operators.ts`: rows `rows.chunk`, `rows.partition` (`may-fail`),
  `rows.pair` (`pure`), with no `head`; a `may-fail` count check for 5.3.
- `ir/print-js.ts`: their spellings; `javascript-runtime.ts`: the helpers.
- `ir/lower-lists.ts`: `more()` (5.1, 5.2) and `source()` (5.3);
  `ir/lower.ts`: the `At` case.
- Documentation: `ir/README.md` ("Lists"; a "rows lane" section beside "The
  string lane"); `docs/COMPILATION-MODEL.md` ("Collections"); `types.ts` doc
  of `rows`; `CHANGELOG.md`; the compile guide in
  `~/dev/cortexjs.io/docs/compute-engine/` if it lists the operators.

## 8. Tests

In `test/compute-engine/ir-list-operators-ce1531.test.ts` or a new
`ir-ragged-rows-ce1549.test.ts`, compared with the interpreter by `read()`:

- Values, at `L` of lengths 0, 1, 4, 5, 6, 7: `Chunk(L, 2)`, `Chunk(L, 3)`,
  `Chunk(L, 5)` at length 3, `Chunk(L6, 4)`, `Partition(L, 2)`,
  `Partition(L, 10)`, `Partition(L, p)` true on none, some and all elements,
  `Chunk(List(1, 2, 3), 2)`; `Block(…, Chunk(L, 2))`; `Tuple(Chunk(L, 2), L)`.
- The cap: `Chunk(L, 2)` and `Partition(L, p)` at a length of 10,001 compile
  and agree; `Chunk(Range(1, 10001), 2)` and `Chunk(Map(…, L), 2)` decline.
- Counts: `k: integer` at 1, 2, 7; a `RangeError` at 0, -1, 10,001; the
  constants 0 and 10,001 decline. `Partition(L, n, 1)` with `n: integer`
  declines with its cause.
- (c): `Map(r ↦ Sum(r), Chunk(L, 3))`, `Map(r ↦ Length(r), Partition(L, 2))`,
  `Length(Chunk(L, 3))`, `Length(Partition(L, 2))`, `At(Partition(L, p), 1)`,
  `At(Chunk(L, 3), -1)`; declines: `Map(r ↦ r, Chunk(L, 3))`,
  `At(Partition(L, 2), 1)`.
- The boundary sweep, with the passes on and off: `IsMissing`, `Coalesce`,
  `AssertPresent`, `Rank`, `Shape`, `Flatten`, `Transpose`, `ListJoin`,
  `Max`, `Mean`, `PointList` of `Chunk(L, 2)`; a local; `f(Chunk(L, 2))`
  with `f := t ↦ t` and `f := t ↦ 1`, `inline` on and off;
  `If(x > 0, Chunk(L, 2), Chunk(L, 3))` and `If(True, …)`;
  `Tuple(Chunk(L, 2), x)`; `Tuple(Chunk(L, 2), Chunk(L, 2), L)`. Each gives
  the interpreter's value or declines.
- Batches: `broadcast`, `broadcastAsync`, `willUsePool`, `shippable`,
  `loadBroadcast`, `loadBroadcastSlice`, `loadBroadcastAsync` refuse;
  `run()`, `runtime.load()` and `runAsync()` return the nested arrays.
- Targets: `Chunk(L, 2)` declines on `glsl`, `interval` and `bigint`, and for
  a list of points or of complex numbers.

## 9. Size estimates

Estimates from the code read, not measured.

| Part | Compiler core | Runtime and API | Peripheral (src) | Tests |
| --- | --- | --- | --- | --- |
| (b) | 30 to 45 lines | 20 to 30 lines | 90 to 130 lines | 150 to 200 lines |
| (c) | 0 | 0 | 70 to 110 lines | 60 to 80 lines |
| (a), rejected | 1,000 to 2,000 lines | | | |

## 10. Alternatives rejected

- **(a)**: cost; it must first solve inner run-time lengths.
- **The root `Tuple` mechanism**: serves the predicate form and a constant
  `k`, not `Partition(L, n)` of a run-time row count.
- **A list type that hides the rows** (lane `real`, shape `[{ v }]`): the
  passes read the shape and would scalarize or fold its elements.
- **Reusing `strings` for the batch refusal**: its public meaning is "reads or
  returns a string".
- **A cap check on a computed source**: a run-time test of a count against an
  engine setting copied at compile time; declining the source is simpler.
- **The old compiler's `[]` for a run-time count below 1**: not an allowed
  difference; a throw is.

## 11. Decisions taken in the note, and the question

Declines kept, documented with their example in the README "rows lane"
section:

- A literal ragged list as the result, `List(List(x, y), List(z))`: declines
  ("elements of two types"). A known-limitations line marked `plausible?`.
- `Chunk(P, 2)` of a list of points: declines (`flat()`). A line marked
  `plausible?`. Lists of complex numbers or colours: decline (`crafted`).
- A computed source (5.1) and a consumer that yields a row (5.3): decline.
- A run-time count: accepted with a throw (5.1); the alternative is the
  decline of today.

**Q1 (for the user). Add the lane `rows` to the core: about 30 to 45 lines
of compiler core and 20 to 30 of runtime and public API (a new public field
`rows` on the compilation result)?** Recommended: yes. Without it, (c) still
compiles the consumers, and the bare `Chunk(L, k)`, `Partition(L, n)` and
`Partition(L, p)` as the result keep falling back to the interpreter.
