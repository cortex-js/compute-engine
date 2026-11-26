# Mutable arrays (`array<T>`): implementation plan

Status: ACTIVE. It implements
`docs/plans/2026-11-25-mutable-arrays-spec.md` ("the spec"), which the user
approved on 2026-11-25. Written by session `compute-engine-57` on 2026-11-25 at
`30397d7e6c43bf3d4698e393e7725f8b554babd6`. The file and line references below
were read at that commit; find each site again by its function name before an
edit.

Sizes are estimates of changed source lines, not measurements.

## Order

| Stage | Content                                    | Needs        | Release point |
| ----- | ------------------------------------------ | ------------ | ------------- |
| 0     | The decisions U1 to U6, the spec reviews   | The user     |               |
| 1     | The type                                   | Stage 0      |               |
| 2     | The interpreter                            | Stage 1      |               |
| 3     | The host interface                         | Stage 2      | R1            |
| 4     | The `javascript` target                    | Stage 3      | R2            |
| 5     | The GLSL read                              | Stage 4, U1  | R3            |
| 6     | Later items, each on a request by name     |              |               |

At R1 Tycho can build its raster on arrays in the interpreter, with the host
reading the storage. At R2 a compiled timer callback writes the pixels. At R3
a shader reads them.

Each stage is one or more work items. A work item is one `implementer` agent
in a worktree, with the target files named here and its tests as the
definition of done. The orchestrator runs the completion checks of `BUILD.md`
and the review that `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md` requires, then
stages. A commit needs the user's approval in the session that makes it.

## Stage 0. Decisions

1. Done 2026-11-25: the user approved U1 to U6 and reversed none of C1 to
   C10.
2. Done 2026-11-25: the spec was reviewed by two reviewers and revised
   (revision 2).
3. Session `tycho-d9` owns
   `~/dev/tycho/requirements/todo/EPSIL_RASTER_IMAGE.md`, which quotes AR1
   and AR7 of the ruling list. It is told of sections 3, 9, 10.8 and 11 of the
   spec, and answers C7. Done 2026-11-25: its session confirmed the path
   for a pixel that is a tuple of four channels; the answer is in its
   proposal, "Requests to CE".
4. Done 2026-11-25: `docs/plans/2026-11-24-mutable-arrays-ruling-list.md` is
   deleted; the spec carries its content.
5. Done 2026-11-25: revisions 3 to 6 of the spec got a second review by the
   two reviewers, applied in revision 7.

## Stage 1. The type

Files: `src/common/type/`. About 500 lines with tests.

- `types.ts`: `ArrayType { kind: 'array', elements: Type }`, and the
  primitive `'array'` for the bare type.
- `parser.ts` (the dispatch near `parseCollectionType()`), `ast-nodes.ts`,
  `type-builder.ts`, `serialize.ts` (`typeToString()`, `getPrecedence()`):
  parse and print `array<T>`.
- `subtype.ts`: `PRIMITIVE_SUBTYPES`, `typeCategory()`, `inhabitationWalk()`,
  `couldMatchStructure()`, `typeTreeSize()`, `isSubtypeRules()` (invariance:
  mutual subtyping of the cell types, as the object field rule does),
  `narrow2()`, `widen2()`. An array is not in `isIndexedCollection()` and not
  in `fitsBroadcastOrIndexed()`.
- `reduce.ts` (`reduceCompositeType()`, `typesOverlapUncached()`,
  `sameHeadArguments()`), `variance.ts` (a cell is an `inout` position),
  `intern.ts`, `instantiate.ts`, `primitive.ts` (`isValidType()`),
  `parse.ts` (`containsObjectLayout()`), `utils.ts`.
  `collectionElementType()` gives no element type for an array; a new
  `arrayCellType()` does.
- A new pure function `arrayStorageKind(cellType)`, with the table of spec
  section 3: the storage kind, and whether the cell is the tuple of four
  bytes. The interpreter, the compiler and the host interface call it;
  no other code decides a storage.

The type has about 60 sites that name `'list'` in this directory. A site
that is missed puts an array in a default branch. Guard: make each `switch`
over `Type['kind']` exhaustive for the type checker where it is not, in the
files this stage edits, and report the sites that cannot be.

Tests (acceptance case 1, type half): parse and print, the subtype matrix
(`array<S>` against `array<T>`, bare `array`, `array<any>`, `list`,
`collection`, `indexed_collection`, `object`, `any`), variance of a type
parameter, the storage table with its boundary values.

## Stage 2. The interpreter

About 1,300 lines with tests. Three work items, in this order.

**Before it starts.** `boxed-expression/binders.ts`, `boxed-function.ts` and
`lazy-view-context.ts` held uncommitted edits of another session for CE-1831
on 2026-11-25, and that work is in the area of `isElementRebinding()`. Item
2b starts when it is committed.

### 2a. The value

- New `boxed-expression/boxed-array.ts`, on the pattern of
  `boxed-object.ts`: the cell type, the storage (`arrayStorageKind()`), the
  count, the version, the serial, a pinned type; a read and a store that are
  the only code that touches the cells; the value conversion of spec section
  3, a tuple cell included (a read builds the tuple, of the named type when
  the cell type is named; a store writes its values). The store follows
  `BoxedObject._store()` step for step: the foreign
  engine refusal, the redundant store, the version, `_objectStoreEpoch`, the
  state event. The fields are initialized in one order, so that every array
  has one hidden class.
- `type-guards.ts`: the guard. `compare.ts`: the identity arms beside the
  object arms of `same()` and `eqImpl()`.
- `object-deps.ts`: an array is a `VersionedObject`; a read calls
  `recordObjectRead()`, a construction `noteObjectConstructed()`.
- `object-walk.ts`: `containsObject()` answers true for an array, and
  `objectJson()` gets the array arm (the list snapshot under `Object`, with
  the cycle marker).
- `serialize.ts` and `ascii-math.ts`: the JSON arm and the display rule of
  spec section 8. The hash reads the serial alone; the digest is the content
  digest of `BoxedObject`, with `markVolatileDigest()`.
- `index.ts`: the internal factory, beside `ce._object()`.

### 2b. The operators and the store

- `library/collections.ts`: `Swap` (the exchange of the storages and the
  counts of two arrays, the effect `state`).
- First, a measurement: with the canonical form of spec section 6 for an
  element write whose types do not prove a list, count the tests and
  snapshots that change (decision C1). Report the count before the rest of
  the item.
- `library/collections.ts`: `ArrayFrom` beside `ListFrom` (the optional type
  operand, the cell type with no operand, the type at canonicalization, the
  effect `state`, an array as the source, the fill of `Repeat` with no list,
  the allocation function and the three failures that give
  `array-allocation-refused`); the array arm of the evaluation of `At` (also
  with several indexes, and with a range or a list as the index, which gives
  a list built at once), of `Length` and of `ListFrom` (the error for cells
  that can hold an object or an array), and their result types.
- `library/core.ts`: `Assign` admits an `At` target (today
  `checkType(ce, lhs, 'symbol')` refuses it); the two canonical forms of an
  element write, chosen by the static types; `assignSteps()` gets the `At`
  branch beside the `Field` branch, with the three cases of "The base of a
  store"; the error `immutable-value-assignment` (this closes CE-1797); the
  run error for an element write of a constant that holds a list.
- `library/control-structures.ts`: `AddTo` accepts `At(base, i)` for any
  base, in its canonical form and in `evaluateAddTo()`.
- `boxed-expression/effects-of.ts` (`mutationEffects()`) and
  `effects-inference.ts`: the label `state` for a store of a cell, and both
  labels where the types do not decide.
- `error-explanations.ts`: `array-allocation-refused`, and the remedies of
  `immutable-value-assignment`.

### 2c. Epsil

- `src/epsil/parser.ts`: `addToAssignment()` accepts an index of any
  expression (`p.pixels[i] += v` gives
  `AddTo(At(Field(p, "pixels"), i), v)`). No other parser form changes.
- `src/epsil/static-diagnostics.ts`: `constant-assignment` for an element
  write only when the types prove a list.
- `src/epsil/program-sites.ts` and `execute-epsil.ts` read the element-write
  form: check each reader against an array.
- The reference pages under `src/epsil/docs/`.

Tests: acceptance cases 1 to 8 (the interpreter halves) and the display
half of 11. The cost test of case 7 is an instrument in `scripts/repros/`,
run and reported, with one test that a loop of 100,000 interpreted stores
ends.

Documents: `docs/TYPE-SYSTEM.md`, `docs/COLLECTIONS-MODEL.md`,
`docs/EFFECTS-MODEL.md`, `docs/ERROR-MODEL.md`, the amendments of Appendix B
(spec section 17), `src/math-json/OPERATORS.json`, `CHANGELOG.md`, and the
pages of
`~/dev/cortexjs.io/docs/compute-engine/` that list the types and the
collection operators.

## Stage 3. The host interface

About 250 lines with tests.

- `boxed-array.ts`: the public members `cells`, `version`, `count`,
  `cellType`, `noteStore()`, `swapCells()`. `types-expression.ts`:
  `ArrayInterface`, with the three guarantees of the host in its
  documentation.
- `index.ts` and `types-engine.ts`: `ce.array()` (with its refusals),
  `ce.arrayAllocation` and `ce.arrayCreated`.
- `serialize.ts` and `types-serialization.ts`: the option `objects`.
- The option `objects` is the public form of the internal hook that item 2a
  added for `.latex` (the JSON walk writes an array of more than 16 cells as
  its type and count there).
- `src/compute-engine.ts` and `src/core.ts`: the exports.

Tests: acceptance cases 8 (the `noteStore()` part), 10 (without the
compiled `draw`) and 11. `src/api.md` is generated.

**R1.** Tycho is told what is released.

## Stage 4. The `javascript` target

About 2,000 lines with tests. Three work items; 4b needs 4a, and 4c needs
both.

### 4a. The lane and the lowering

- `compilation/ir/ir.ts`: the lane `array`, with the storage kind and the
  lane of a cell in the IR type. `operators.ts`: the rows for a read, a
  store, a read-add-store, the count, the three constructions (a fill, a
  list, a copy), the copy to a list and `Swap`. The read of a cell, of the
  count and of the storage, the store and `Swap` are effectful (decision
  C6). `effects.ts`, `verify.ts`.
- `lower.ts`:
  - the type of an input and of a parameter (the site of "the input p of
    type P");
  - a name whose value is an array: an input that `run()` reads at each call
    from the definition of the name at the compilation, not in `captures`;
  - a name whose value holds an array (a named tuple): a reference of the
    program (`Program.refs`, new), listed in `captures`;
  - `At`, `Length`, `ListFrom` and `ArrayFrom` of an array, and `At` with a
    range, a list of indexes or a list of booleans as the index (the gathers
    of a list, over cells of one number);
  - `Assign(At(base, i), v)` and `AddTo(At(base, i), e)` (the site of "a
    write that is not to a name"), and `Swap(a, b)`;
  - the two arms of an `If`;
  - an array, and a record or a list literal that holds one, as an argument
    of a host function (`hostCall()`);
  - each decline of spec section 10.6, with a message that names the case.
- `lower-functions.ts` (an array parameter of a user function that is
  called by its name), `lower-records.ts` (an array field), `outline.ts` (the
  decline in a `parallel for`).
- A tuple cell: the read as a tuple, the read of one element with no tuple
  built (the fold of an `elem` of a read), the store of a tuple that the
  code builds with no array allocated.
- The list write of "List updates" reads the form `Assign(At(L, i), v)` too,
  for a function whose untyped parameter holds a list in one of its copies.

### 4b. The printer, the runtime and the adapter

- `print-js.ts`: the spellings. A read is
  `+c[i > 0 ? i - 1 : c.length + i]` with `c` the storage read from the array
  at that use: the unary plus makes `NaN` of a read outside the cells. A
  store increments the version and writes `c[i > 0 ? i - 1 : c.length + i]`,
  with no range test. For a tuple cell the position is four times the
  position of the cell, and a negative index counts from `c.length / 4`.
  `boxValue()` passes an array through. `runtimeOf()` binds the references
  and the construction to the engine.
- `javascript-runtime.ts`: the entry check of an array parameter.
- `adapter.ts`: the store epoch and the state event before each host call
  and when `run()` returns or throws; `shippable` false; the refusal of `load()`; the report
  of the inputs (`lowered`); `implicitCompile()` gives no result.

### 4c. A function that assigns a variable and calls the host (decision U6)

For a variable that is a number, a boolean or an array (spec section 10.7).

- `lower.ts`: `hostCall()` no longer declines when `assigns` holds no list.
  The call takes the value of each assigned variable as an operand and gives
  its new value as a result (a record, read as a user call reads the record
  of a function that writes), and the names are rebound as `stateWrite()`
  rebinds them. `facts()` lists each variable of `assigns` as read and
  written by a host call, so a `Loop` carries them and the arms of an `If`
  give them. The scan of `assignedNames()` counts a user function that
  reaches a host call as a reader and a writer of each assigned variable. A
  variable of an array type is in `assigns`, and a user function writes one
  as it writes a number.
- The declines of spec section 10.7, each with its message.
- `print-js.ts` (`hostCaller()`) and `adapter.ts` (`assigningRun()`): one
  shared pair of functions writes a variable to the engine and reads it, used
  when `run()` starts and returns and around each host call. A name that
  holds an array is read at each `run()`.
- Before the item starts: read `assignedNames()`, `facts()` and the state of
  user functions (CE-1776), and confirm the estimate of U6 (500 to 800
  lines); report a larger cost before going on.

Tests: acceptance case 12b. Documents: `docs/COMPILATION-MODEL.md`,
"Functions of the host" and "Variables that a function assigns" (also what a
call that throws writes).

### Measurements, before 4b is done

Each is an instrument in `scripts/repros/` and a line in the report.

1. A loop of 64,000 stores to an array parameter (acceptance case 13), and
   the same in Tycho's instrument.
2. The cost of the version increment at each store (decision C4). If it is
   more than a tenth of the loop, report it with the alternative.
3. A frame of 320 × 200 written through `set` with a tuple cell of four
   bytes, against Tycho's 1.0 ms for four byte writes to a block-local list.
4. The cost of the index selection `i > 0 ? i - 1 : n + i`. If it is
   measurable, the lowering drops it when the sign fact of the index
   (`lower.ts`, the bound of a ranged type) proves `i >= 1`.

Tests: the compiled halves of acceptance cases 3a, 4a, 5, 8, 9 and 10, and
cases 12 to 14. Case 12 is a parity suite that runs each program on the
interpreter and compiled, and compares the cells: a sieve, a sort by
exchanges, a table of a dynamic program, a frame fill through the helpers
`get` and `set`. Case 12a is the Game of Life with two arrays and `swap`;
case 12b belongs to item 4c.

Documents: `docs/COMPILATION-MODEL.md` ("Sums and objects", a section
"Arrays", the two caveat lines, the known limitations of spec section 10.6),
`compilation/ir/README.md`, `CHANGELOG.md`, and the compile pages of
`~/dev/cortexjs.io/docs/compute-engine/`. Read `benchmarks/README.md` before
adding the loop of measurement 1 as a benchmark.

**R2.** Tycho is told what is released.

## Stage 5. The GLSL read

About 500 lines with tests. It starts when U1 is confirmed and Tycho has
answered C7.

- `compilation/ir/index.ts`: the GLSL profile admits the array lane for an
  input (a free name with no value, or a name of `inputs`); an array is
  always in storage; the decline of a name with an array value, a store,
  `AddTo` of a cell, `Swap`, a construction, `ListFrom`, a read with a range
  or a list as the index, an array result, a cell range outside ±2^24 and a
  constant index that is 0 or not an integer.
- `print-glsl.ts`: the sampler type from the storage kind; a texel helper
  with a `highp usampler2D` and one with a `highp isampler2D` parameter
  beside `_gpu_ir_texel`; the count read from the uniform `A_count` in the
  index test, where a list has its length as a literal.
- `adapter-glsl.ts`: the report of an array input (`lowered`, and the new
  field `count` of `freeSymbolTypes`), the decline of a second input named as
  a count, and an array argument of a user function (the sampler and the
  count).
- `storage-hints.ts`: the check of a hinted name admits an array input, and
  the hint `'sampler2D'` on an array of `Uint8Array` cells selects the
  normalized texture.
- A tuple cell: the texel read as a `vec4` (`RGBA8UI`, or the normalized
  `RGBA8`), with one fetch and one index test.

Tests: acceptance case 15. The emitted text is pinned. One page with a WebGL2
context uploads an array (padded to a full last row, `UNPACK_ALIGNMENT` 1)
and compares the cells that the shader reads; it is
run one time (the Chrome extension, or a headless Playwright script when
another session holds the browser) and its result is in the report.

Documents: `docs/COMPILATION-MODEL.md` ("GPU `At`", "Sums and objects", the
limit of 16,777,216 cells), `compilation/ir/README.md`, Appendix B (B9),
`CHANGELOG.md`.

**R3.**

## Stage 6. Later items

None is started without a request by name.

- Growth: `Push`, `Pop`, `Insert`, `RemoveAt` (spec section 13).
- The collection integration and the traversal rule (spec section 14).
- Phase 4 of `docs/plans/2026-08-13-mutable-objects-implementation-plan.md`:
  field reads and stores of an object on JavaScript.
- Bitwise operators on integers and a `uint` lane on GLSL.

## Risks

- **A missed site of the type.** Stage 1 names the guard.
- **The canonical form of an element write whose types do not prove a
  list** changes (decision C1). Stage 2b measures the tests and snapshots
  that change before it goes on; if the count is large, report it with the
  alternatives of C1.
- **`Assign` is on the path of every assignment.** Stage 2b runs the
  interpreter benchmarks of `benchmarks/README.md` before and after.
- **A compiled site that sees two storage kinds.** One site of the emitted
  code reads one kind, from the static type, so the JavaScript engine sees a
  monomorphic read. A user function is compiled once for each type of its
  arguments.
- **The work of another session in `isElementRebinding()`** (stage 2).

## Starting a stage

A session that starts a stage reads the spec, this plan and the shared-machine
documents that `AGENTS.md` names, checks that the decisions of stage 0 are in
the spec, and reads the sites of its stage again at the current commit. It
reports, for each work item: the tests added, the checks run with their exit
codes, the measurements, and each case that it declined with its example.
