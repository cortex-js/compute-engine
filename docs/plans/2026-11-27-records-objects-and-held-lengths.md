# Records as objects, field lengths carried by the value: implementation plan

Status: approved for implementation by the user on 2026-11-27; revision 2
(after the dual review `docs/scratch/RECORDS_OBJECTS_AND_HELD_LENGTHS_SPEC_REVIEW.md`);
no stage is started. Written on 2026-11-27 at
`0b95ab566890f5a38c0e457693a68626cac178ad`. The file and line references were
read at that commit. Before an edit, find each site again by its function name.
Sizes are estimates of changed source lines, not measurements.

## Goal

JavaScript compiles records by two mechanisms today:

- **Program records** (CE-1652, `compilation/ir/README.md`, "Records"):
  named tuples, dictionary literals, and tuples and lists of mixed lanes. A
  program can read them (`Field`, `At`, `match`) and pass them to user
  functions. Every list field must have a length known at compile time, and
  a record built in a loop declines.
- **Tagged results** (CE-1904, `IRType.resultRecord`): a dictionary with a
  literal `__tag`, at the entry result only. Its list fields can have run-time
  lengths, and `records.build` builds a list of them. The program cannot
  read one.

Both are `lane: 'record'` values made by `make()` (`lower-records.ts`). The
difference is that a tagged result forgets the length of each field. It can
do so because no code reads the record after it is made.

This plan merges the two mechanisms into one:

1. A record with field names is a JavaScript object at run time, not an
   array of its fields.
2. A list field of a record can have a run-time length. The value carries
   the length, and a reader gets it with `.length`.
3. A list of records is a value of the program: a build of records, a read
   of an element, a loop over the list.

Then `resultRecord` and `records.build` are deleted. The tagged result of
CE-1904 becomes an ordinary dictionary record.

This reverses two user decisions recorded in `docs/COMPILATION-MODEL.md`
"Records" (lines 3257–3262 at the commit above): "a field of a run-time
length (user decision) … declines", and that a tagged result is return-only.
The user approved the reversal on 2026-11-27.

**Witness:** `corpus`. Tycho's drawing prelude `Figure`
(`~/dev/tycho/src/graph-paper/notebook/drawing/prelude.ts`, line 111, as
session tycho-c8 reported it on 2026-11-27; not read here) takes its `geom`
as a parameter, and `[circle(p, 1) for p in P]` builds a list of figures.
Both decline today. Tycho's geometry records (`~/dev/tycho/src/plot-core/geometry-operators.ts`,
line 27) have the shape `{ __tag, dim, geom: [x0, y0, …] }`. The probes are in
`scripts/repros/2026-11-27-ce1913-ce1914-declared-records.mts`.

**Out of scope:**

- GLSL, the interval mode and the `bigint` mode. They hold no record except
  GLSL's `vecN` record of a nominal tuple of two to four numbers, which has
  no list field. They are unchanged, and their profiles keep `record` in
  `scalarLanes`.
- An input of the entry of type `list<P>` for a record type `P`, and an entry
  input of a record type with a list field of unstated length
  (`settledType()` and `numericRecordInput` in `lower-records.ts` keep their
  refusals). The host sends these inputs, so their run-time form is a
  separate contract; it is a later item on request.
- The arguments of a rest parameter of run-time length (`restRecord()`,
  `lower-functions.ts`, "a rest parameter that is a list of a run-time
  length"). That record has no names and the engine value is a `Tuple` of
  the arguments. It keeps its decline and is a later item on request.
- A field of rank 2 or more whose inner length is not static. It keeps its
  decline. Today a tagged result admits it; no test and no Tycho handler uses
  one (`compile-tagged-results.test.ts`; Tycho's `geom` is flat). The
  narrowing goes in the CHANGELOG entry of stage 3.
- A record built in a random frame keeps its decline. A random frame draws
  in a fixed order, and its yields are not a build of one record type; no
  witness asks for it.

## Why lengths are named today, and what changes

An IR type names each run-time length by the value that holds it
(`Length = number | { v: V }`, `ir.ts:72`). The verifier and the passes use
that value to prove that two lists line up: lists that share a length need
no `_agree` check. GLSL needs a length that is a number.

A record's type travels with the record into callers, into function results
and into the results of loop bodies. A `{ v }` length means nothing there
(`lower-records.ts:186–188`), so `make()` declines
("a record with a field of a run-time length").

The change is confined to the field types of a record. The first axis of a
list field's shape (`IRType.fields[k].shape[0]`) gets a third form of
length, `'carried'`: the length is that of the field's array, and the type
names no value. The general `Length` does not change, so none of its 67
sites that test `typeof n === 'number'` changes. A field read emits a new
operation, `field.len(record, k)`, before the read. It gives the length of
the field's array as an integer value `n`, and the `field` read is then
typed with `{ v: n }`. The verifier sees the length defined before the value
that names it, as `verify.ts:124` requires; `rows.len` (`operators.ts:539`)
reads a row length the same way. From the read on, the field is an ordinary
list of run-time length, with the usual `_agree` checks where two lengths
must agree (`f.geom + g.geom`). That check runs once per operation, outside
the loop. `docs/COMPILATION-MODEL.md` admits such a check for an operation
that already loops over its operands.

This keeps the rule "shapes are settled at compile time": the lane and the
rank of a field are static. Only a length is read at run time, and that read
is not a type test.

## Decisions taken by the plan (each can be reversed)

- **D1. A first-axis field length that is not a compile-time constant is
  always carried.** The alternative carries a length only when the record
  leaves the scope of the length. Always carrying is simpler, and it is
  sound. Its cost is one `.length` read per field read that is not a read of
  a part (`parts`, see stage 2). An `_agree` check is added where a field,
  read after the record went through a call, a local, an `If` or a loop,
  meets a list of the same length.
- **D2. A join widens field lengths.** Two field types of one lane and one
  rank whose first-axis lengths differ join to `'carried'`. Two constants
  (2 and 3), a constant and a carried length, and two carried lengths all
  give `'carried'`. This holds at every join: `If` and `match` arms, a local
  assigned twice, the yields of a build, and the types of the calls of one
  user function. It is sound because the array carries its length. Inner
  axes still have to be equal.
- **D3. Only the first axis of a field can be carried.** Inner axes stay
  static: a list of points `['carried', 2]` is admitted.
- **D4. An object has its keys in declaration order.** A named tuple has the
  order of its type, and a dictionary literal the order of its keys. A
  record with no names (a `Tuple` or a `List` of mixed lanes, the arguments
  of a rest parameter) stays an array.
- **D5. An input of the entry of a named-tuple type is read by name, with no
  copy.** Today `recordInput` (`print-js.ts:620`) copies the host's object
  into an array. A field the host leaves out reads `undefined`, and a field
  name that is a property of `Object.prototype` (`constructor`) that the host
  leaves out reads that property. Both are allowed: an input left out is
  unspecified (AGENTS.md).
- **D6. The result conversion stays only for a complex field.** A field that
  can hold a complex number keeps `_SYS.ir.normalize`, at any depth.
- **D7. The name `__proto__` declines as a field name of every record.** In
  an object literal `{"__proto__": v}` sets the prototype.
  `dictionary()` (`lower-records.ts`) already declines it for a dictionary
  literal; stage 1 extends this to a named tuple and a declared record type.

## Stages

| Stage | Content | Fixes | Size (estimate) |
| ----- | ------- | ----- | --------------- |
| 1 | Named records as objects | CE-1914 | 200–300 |
| 2 | Carried field lengths | | 250–400 |
| 3 | Lists of records, deletion of `resultRecord` | | 400–650 |

The stages land one after another, and each is one `implementer` work item.
A stage is complete when its tests and the existing record tests pass. The
existing record tests are `test/compute-engine/compile-records*.test.ts`,
`compile-tagged-results.test.ts`, `ir-records-glsl.test.ts`,
`ir-record-fields-glsl.test.ts`, `record-entry-type.test.ts`,
`named-arguments-record-field.test.ts` and
`held-record-at-dictionary-parameter.test.ts`. Completion checks and review
then follow `BUILD.md` and `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`. Every
compiled value is compared with the interpreter's value, as
`compile-records.test.ts` does. Each case runs with `optimize` on and off.

**Benchmark.** `benchmarks/codegen-samples.mjs` compares the generated
runners of two checkouts (median nanoseconds per call, alternating order).
Stage 1 adds record cases to it: a field read in a loop, a named-tuple input
read field by field, and a record result. Stage 2 adds a field read of a
carried length in a loop. Each stage runs the harness against the commit
before it, holding the box lock. A median more than 5% slower on a record
case is reported to the user before the stage lands.

### Stage 1. Named records as objects

The printer changes. The IR types are unchanged.

- `list` of a record type with `names` (`print-js.ts:625–632`) prints an
  object literal for every named record. Today only `resultRecord` does.
  A key that is not an identifier is quoted with `JSON.stringify`.
- `field`: an op spelling receives no types, so a new hook
  `Syntax.field?(record: string, index: number, type: IRType): string` is
  called by `print.ts` for the op `field`. On JavaScript it prints
  `record.name`, or `record["name"]` for a name that is not an identifier, for
  a record with names, and `record[index]` for one without. GLSL keeps
  its spelling `$0[int($1)]`. The CSE key of a `field` op does not change: it
  is the record value and the index.
- `recordInput` (`print.ts:344`, `print-js.ts:620`) is no longer used for a
  named record (D5).
- `recordResult()` (`print-js.ts:250–270`) rewrites only a field that can
  hold a complex number (D6), for example
  `{ "z": _SYS.ir.normalize(v.z) }` of a record with a complex field `z`. A
  named record without one is returned as it is, and a record with no names
  is an array where it is made.
- `boxValue()` (`print-js.ts:1088–1113`), which makes the engine's value of a
  record before a host call (CE-1652 step 5, CE-1906), reads each field by
  name.
- Check every other site that reads a record value as an array:
  `print-js.ts:980`, `:1058` and `:1168`, the `index.ts` refusals at
  `:351`, `:439` and `:785`, and `adapter.ts:270` and `:550–557`.
- D7: a named tuple type or a declared record type with a field
  `__proto__` declines.
- CE-1914 is fixed in this stage, because it touches the same lowering:
  - A call of the constructor function of a declared record type
    (`type Fig = record{…}` with `function Fig(…) { {…} }`) is lowered as a
    call of a program function whose result is the dictionary record of its
    body. Today it reaches the host-call path (`lower.ts:8748–8770`) and
    declines as "a call of the function Fig of the host". The record keeps
    `head: 'Dictionary'` and adds `nominal: 'Fig'`. The engine value of a
    `Fig` is `Fig(Dictionary(…))`, the constructor applied to its payload
    (`src/epsil/docs/types.md`, "Constructor functions"; the raw-payload arm
    of `installConstructorFunction()`, `type-constructors.ts`). `boxValue()`
    makes that value for a record with both `head: 'Dictionary'` and
    `nominal`. The raw-payload arm checks the payload and skips the body,
    so the user's constructor does not run again. A raw-payload call in the
    program (`Fig({…})`) is lowered as the dictionary literal with the
    nominal name. The checks of the payload are static: the literal's keys
    and field types must be those of the type, otherwise the call declines.
  - A record of a declared type and an untyped dictionary literal are two
    types (`sameFields` compares `nominal`), so `If(c, Fig(…), {…})`
    declines. The interpreter's value of that `If` has two types too.
  - A dictionary literal with a field whose value is `Nothing` makes a
    field of the lane `nothing` (`null`), as a named tuple field does.
    Today it declines "Nothing as a value" (`lower.ts:4974`). The
    interpreter keeps the key: `{a -> 1, alpha -> Nothing}` evaluates to
    `Dictionary(KeyValuePair("a", 1), KeyValuePair("alpha", Nothing))`
    (probe of 2026-11-27).
  - A spread of a value of a declared record type (`{...f, kind -> "x"}`)
    declines in compiled code while CE-1913 is open: the interpreter gives
    an error there.
  - Delete `issues/CE-1914.md` with the fix.

Tests: a compiled named record is an object, with `Object.keys` in
declaration order. A field read gives the interpreter's value. An input
object is read with no copy: compare its fields, not its identity. A record
passed to a host function gives the same engine value as before
(`compile-records-host.test.ts`), and a `Fig` passed to a host function gives
`Fig(Dictionary(…))`. Also test a dictionary record with a key that is not an
identifier, a complex field, and a nested record with no names. The field
`__proto__` declines. The CE-1914 cases of the repro script compile and give
the interpreter's values. The spread of a `Fig` declines. GLSL is unchanged
(`ir-records-glsl.test.ts`).

### Stage 2. Carried field lengths

- `ir.ts`: the first entry of a field's shape can be `'carried'`, only in
  `IRType.fields[k].shape[0]`. Every other shape (a value's own `shape`, an
  inner axis of a field) stays `Length`. `typeToString()` spells it `*`
  (`record(geom: real[*])`). `sameShape()`, `isSubType()`, `joinType()` and
  `sameFields()` handle it explicitly: two carried lengths are equal; a
  number or a `{ v }` is a subtype of `'carried'`; a join of two different
  first-axis lengths of one rank is `'carried'` (D2). `lengthValues()` and
  `mapLengths()` read a value's own `shape`, not `fields`, so they never see
  it; an assertion in each says so.
- `operators.ts`: a row `field.len` takes a record and a constant field
  index and gives an integer, printed `$0.name.length` (or `$0[k].length` for
  a record with no names) on JavaScript. It is `pure`.
- `verify.ts`: the `list` case of a record admits a field value of shape
  `[n, …]` (`n` a number or a `{ v }`) for a field type `['carried', …]`.
  The `field` case admits an output `{ v: n }` for a field type
  `'carried'` when `n` is the output of a `field.len` of the same record
  and index. Any other `{ v }` there fails. Add malformed-IR tests for both
  rules.
- `make()` (`lower-records.ts:190–235`): a first-axis length that is not a
  constant becomes `'carried'` (D1) and no longer declines. An inner length
  that is not static still declines (D3), and so does a field of the lane
  `rows`. The `resultRecord` branch (`shape.map(() => 0)`) is not changed in
  this stage.
- `field()` (`lower-records.ts:411–433`): the read of a field made in the same
  lowering (`parts`) gives the value it was made of, with its own length, as
  today. Otherwise, when the field's first axis is `'carried'`, emit
  `field.len` first and type the `field` read with its output.
- A record with a carried field can now be a user function's parameter and
  result, a local, an `If` arm, a `match` arm and a protocol method's
  `self`. Find each place that declines a record whose field names a length
  value: search for `lengthValues(` applied to a field type, and for the
  messages that name a record and a length. Make each one accept
  `'carried'`.
- `nothingRefusal()` and the list refusals of `index.ts:340–445` let a list
  be a field of a record already. Check that they still hold for a carried
  field.

Tests: a record whose list field comes from a `list<real>` parameter
(`T(kind, g)`), from `take(L, n)` with `n` 0 and 2, and from an empty list.
A field read in the function that made the record, and in another function.
The record as a function result. `If(c, T("a", [1, 2]), T("b", g))` and
`If(c, T("a", [1, 2]), T("b", [1, 2, 3]))` (D2). One user function called
with records whose fields have lengths 2 and 3. A protocol method reading
`self.geom[1]`. `f.geom + g.geom` of two records: equal lengths give the
value, and unequal lengths throw `incompatible-dimensions`, as the
interpreter's error does. A list of points in a field (`['carried', 2]`). A
field of rank 2 with a run-time inner length declines. The verifier tests
above.

### Stage 3. Lists of records; deletion of `resultRecord`

- The rule: a record is `lane === 'record' && shape.length === 0`. A value of
  the lane `record` with the shape `[n]` is a list of records of one record
  type: a JavaScript array of objects, or of arrays for records with no
  names. `n` is an ordinary `Length`. A list of lists of records, and a field
  that is a list of records, decline in this stage.
- Audit every test of `lane === 'record'` in `compilation/ir/` (about 60,
  in 15 files) and decide for each whether it means "a record" (add
  `shape.length === 0`) or "of the lane". Among them: the `list` case of
  `verify.ts`, the printer's `list`, `Length` in `lower.ts` (the field count of
  a record, the element count of a list of records), `typeToString()` (spell
  a list of records `Fig[n]`), `fitsList()`, `unboxable()` and
  `holdsArray()`.
- Helpers that rebuild a type from `{ lane, shape }` must keep `fields`,
  `names`, `nominal`, `marks` and `head` when they add, remove or remap an
  outer axis: `elementType()` and `mapLengths()` (`ir.ts`), `listOf()`
  (`operators.ts`, the result rows of `build` and `filter`), the build-yield
  conversion of `region()` (`lower.ts`), the `inner` type of `boxValue()`
  (`print-js.ts`), and every other `lane: x.lane, shape:` site (about 13).
- Lift the two refusals of a list of records on JavaScript only: `verify.ts`
  `define()` ("a list of records") becomes a refusal of rank 2 or more, and
  `record` leaves the `scalarLanes` of the JavaScript profile
  (`index.ts:153`).
- The loop decline (`lower.ts:5733–5739`, "a record made in a build, a filter
  or a random frame") is lifted for `build` and `filter`. The yields join by
  D2.
- Readers of a list of records: `At` and the element read (`elem`),
  `Length`, a `Comprehension` or `Map` over it (`for f in figs`), a parameter
  or result of a user function, and the entry result. Every other reader
  declines, as a list of strings does for the operators it does not have. A
  call `area(figs)` of a function with a parameter `f: Fig` is typed as the
  interpreter types it (R2 of `docs/COMPILATION-MODEL.md`): when the static
  type makes the call map over the list, it compiles as a `Map`; otherwise it
  declines.
- Absence: `At(figs, i)` of an index not proven in range is the operand of a
  discharge (`IsMissing`, `Coalesce`, `AssertPresent`) only if the record can
  be absent. `absent()` in `lower.ts` treats a record as present. Such an
  `At` therefore declines when its value reaches a discharge, and this
  decline is checked before the passes fold the read away. An `At` in range,
  an element read in a loop over the list, and an `At` that reaches no
  discharge compile. The value of an out-of-range `At` that reaches no
  discharge is unspecified, as an absent operand is (AGENTS.md).
- The entry result of a list of records: an array of the records. A complex
  field of each element is normalized by D6, in a loop.
- A literal list of records of one type is a list of records. A literal list
  of records of several types (a `Polygon` and a `Marker`) stays a record
  with no names, an array of records, through `fitsList()`. This is also the
  path of a mixed `List` of tagged dictionaries at the entry.
- Delete `resultRecord` and its readers: `ir.ts` (the field, `sameFields`,
  `typeToString`'s "result " prefix), `lower-records.ts` (`make()`,
  `dictionary()`), `lower-lists.ts:1238–1312` (the `resultRecords` parameter)
  and `:1657`, `lower.ts:2460–2475` and `:2625–2636` (the dictionary branch,
  the `List`-of-tagged branch, the `Comprehension` branch), `index.ts:425`,
  `verify.ts:251–270` (also the `rows` branch), `adapter.ts:548–550`, and
  `print-js.ts:251` and `:626`. Delete `records.build` (`operators.ts:838`,
  `print-js.ts:199`, `passes.ts:758`, `lower-lists.ts:1296`). Keep the
  host-handler detection `taggedRecord` (`lower.ts:2460`) only for the rules
  that it still needs: the refusal of a tagged result with fields `re` and
  `im`, and an empty `List()` field typed as a list of reals.
- `docs/COMPILATION-MODEL.md` "Records" and the README "Records" section:
  rewrite them as one mechanism (see Documentation).

Tests: `compile-tagged-results.test.ts` keeps every output case. Its test "an
ordinary consumer cannot read the return-only representation" is inverted:
`At(HostPath(Take(coords, n)), "coordinates")` compiles and gives the
interpreter's value for `n` 0 and 4. Its `shippable === false` and
`broadcast` expectations stay (a record is not shippable and has no batched
form). New: `[P(k, t) for k in 1..3]` of a named tuple, now compiled.
`Map` over a list of records, the field reads of each element, and a filter
of records, also one that keeps no record. A list of records returned from a
user function and read by the caller. `figs[i]` in range and out of range,
negative `i`, and `IsMissing(figs[i])`, `figs[i] ?? f0` and `figs[i]?!`
(which decline). A list of records with a complex field as the entry result.
`area(figs)` with `area(f: Fig)`.

## Documentation

Each stage updates `compilation/ir/README.md` "Records" and the "Records"
section of `docs/COMPILATION-MODEL.md`, and writes a `CHANGELOG.md` entry
(`CODING-STYLEGUIDE.md`):

- Stage 1: records compile as objects; CE-1914.
- Stage 2: the passage "a field of a run-time length (user decision):
  Tycho's `dash(...)` … declines" is replaced by the carried-length rule,
  citing the approval of 2026-11-27.
- Stage 3: the passage on tagged results (return-only) is replaced; the
  decline of a tagged field of rank 2 with a run-time inner length is
  recorded.

The result of `run()` for a named record is an object today and stays one,
so no host sees a change of representation. What changes for a host is the
set of programs that compile. Stage 3 checks the compile guide in
`~/dev/cortexjs.io/docs/compute-engine/` for a statement about records, and
updates it under the AGENTS.md rule for that directory.

## Tycho

After stage 2, Tycho's `Figure` (a named tuple or a declared record) compiles
with a `geom` given as a parameter. After stage 3, a comprehension of figures
compiles too. Tell tycho-c8, or Tycho's current session, at each release
that carries a stage.
