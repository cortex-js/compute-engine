# CE-71: closed records, optional fields and key removal

Status: approved, 2026-11-07. The user decided decision 0 and approved the
recommended options of decisions A, B and C on 2026-11-07. Not implemented.
Issue: `issues/CE-71.md`.

CE-71 asks four questions, which come from Q5 and Q10 of
`docs/plans/2026-10-20-bare-tuple-record-any.md`: how a record field is left
out, how a record type says that a field is optional, whether an operation
removes a key, and how `Dot`, the ordering operators and the structural
conversions treat `Nothing`.

## 1. Decision 0: records are closed, dictionaries are open

**User decision of 2026-11-07.** A dictionary is a bag of fields: any string
keys, with values of one type (`dictionary<V>`). A record has exactly the
fields that its type lists; some of them can be optional. There is no width
subtyping: a record with more fields is not a subtype of a record type with
fewer fields. Depth subtyping stays: `record{a: integer}` is a subtype of
`record{a: real}`.

This replaces decision Q6 of `docs/plans/2026-10-20-bare-tuple-record-any.md`
("retain current open records and width subtyping").

| Program | Before | After |
| --- | --- | --- |
| `let s: record{a: integer} = {a -> 1, z -> "x"}` | accepted | refused: `z` is not a field of the type |
| `f(r: record{a: integer})` called with `{a -> 1, b -> 5}` | accepted | refused |
| `r.b` in `f` | the value; the type is reported as `error` | static error: `b` is not a field |
| `record{a: integer}` and `dictionary<integer>` | not related | the record is a subtype of the dictionary |
| `Values(r)` with `r: record{a: integer, b: string}` | `list<any>` | `list<integer \| string>` |
| type of `if c { {a -> 1} } else { {a -> 2, b -> "x"} }` | `record{a: integer}` | `record{a: integer, b: string?}` |

Before this decision, the engine had three kinds of record. A record type
written in a declaration was open. The type of a dictionary value was closed
(the `closed` marker on `RecordType`, `src/common/type/types.ts`). A nominal
record type (`type circle = record{…}`) was closed by its constructor. After
it, every record type is closed and the `closed` marker goes away. The bare
`record` still means "any record".

A program that must accept extra fields takes a `dictionary`. An explicit
open form, for example `record{a: integer, ...}`, is not part of this
change; it can be added if a program needs it.

**Measurement.** On 2026-11-07, in a separate worktree at `8f2129bb0`, the
type parser was changed to make every written record type closed, and the 59
test files that name a record type were run. Before: 59 files pass. After: 20
tests fail in 7 files, and one more file does not start. Every failure
tests openness itself (the CE-4 and CE-77 test files, the width-subtyping
cases of `test/common/types.test.ts`) or shows the `closed` marker in a
snapshot. No Epsil test, constructor test or compilation test fails. The
library has no operator signature that names a record type.

## 2. What is already settled

**`Nothing` never removes a key.** The user decision of 2026-11-02
(`docs/ERROR-MODEL.md`, "One static error, one dynamic non-value per
domain") makes `Nothing` an ordinary element: `{a -> Nothing}` keeps `a`.

**The fourth question needs no new rule.** Each operator treats `Nothing` as
it treats any other value of the wrong type. Checked on 2026-11-07 with the
Epsil CLI: `TupleFrom`, `SetFrom`, `DictionaryFrom`, `Append`, `Join` and
`Flatten` keep it; `Fold` and `Reduce` give it to the callback, which gives
`incompatible-type`; `Sort` and `Ordering` stay unevaluated, as they do for
`Sort([3, "a", 1])`. `Dot([1, Nothing], [1, 2])` stays unevaluated where it
must give `incompatible-type`: defect CE-1101. The paired statistics no longer
skip `Nothing`, so Q10 has no open part.

## 3. Optional fields

A closed record needs optional fields: the join in the last row of the table
in §1 cannot be typed without one. A declared type cannot name `missing`, so
`record{b: string | missing}` is not a way to write one.

The rules, with the spelling of decision B:

- `record{a: integer, b: string?}`: the key `b` can be absent; when it is
  there, its value is a `string`.
- A read `r.b` is typed `string`, with the implicit absent value of a read,
  as `At` is (`docs/ERROR-MODEL.md`, "`Missing` is a result only", rule 5):
  `Missing`, or `NaN` for a numeric field.
- `record{a: integer}` and `record{a: integer, b: string}` are subtypes of
  `record{a: integer, b: string?}`. The reverse is not true.
- A record type is a subtype of `dictionary<V>` when every field type,
  optional fields too, is a subtype of `V`.
- The join of two record types has the keys of both; a key that only one has,
  or that is optional in one, is optional. The meet has the keys of both; a
  key that one requires and the other does not have makes the meet `never`.
- A nominal record constructor requires each field that is not optional,
  accepts the optional fields, and refuses other keys.
- A store follows the rule of 2026-11-02: a field that holds `Missing` is
  accepted where the declared type accepts a present value
  (`matchesOrAbsent()`).

## 4. Decision A: does a field that holds `Missing` keep its key?

Example: `label(x) = If(x > 0, "pos")`, then `r = {label -> label(-1), n -> 2}`.

- **(a) The key stays (today).** `r` is `{label -> Missing, n -> 2}`, typed
  `record{label: string | missing, n: integer}` by inference. It fits
  `record{label: string, n: integer}` by the store rule, as `(Missing, 2)`
  fits `tuple<string, integer>`.
- **(b) `Missing` removes the key.** `r` is `{n -> 2}`, and `{label ->
  label(x)}` is typed `record{label: string?}`. This changes dictionary
  construction in `box.ts`, `DictionaryFrom`, the merge, and the table of
  2026-11-02.

A read `r.label` gives `Missing` in both. The difference shows in `Keys`,
`Length`, iteration, equality and serialization.

**User decision 2026-11-07: (a).** A field keeps its key as a tuple keeps its slot and
a list keeps its position. A program that leaves a field out says so, with
`DeleteAt` (decision C) or with a conditional merge:
`{-> , ...(if c { {label -> "pos"} } else { {->} }), n -> 2}` (checked: it
gives `{n -> 2}` when `c` is false).

## 5. Decision B: the spelling of an optional field

- **(a) `b: string?`**, the marker that an optional function argument
  already uses (`(number, number?) -> number`, the grammar comment in
  `src/common/type/types.ts`). One spelling for "can be left out" in the
  type language.
- **(b) `b?: string`**, the TypeScript spelling. Familiar to JavaScript
  users, but a second spelling for the same idea.

**User decision 2026-11-07: (a), `b: string?`.**

## 6. Decision C: removing a key, and why not `delete r.b`

A record is an immutable value. Epsil already refuses `r.b = "y"` with
"Build an updated copy with the new `b`, or declare the type as `object{…}`".
A statement `delete r.b` would be the one statement that changes a record,
so it would contradict that rule. `delete` is a reserved word with no use
today (`src/epsil/reserved-words.ts`).

The consistent form is an expression that returns a copy, as the merge does
for adding or changing a field (`{-> , ...r, b -> "y"}`, checked: its type is
the precise record):

- **(a) No new operation.** Keep the idiom
  `DictionaryFrom(Filter(r, e => e[1] != "b"))`, typed `dictionary<any>`:
  the field types are lost.
- **(b) A dictionary and record overload of `DeleteAt`:
  `r2 = DeleteAt(r, "b")`, Epsil `deleteAt(r, "b")`.** `At(r, "b")` reads a
  field by its key, so `DeleteAt` with a key is its inverse.

The rules of (b):

- It returns a copy without the key; `r` does not change. A key that is not
  there gives the value unchanged, with no error. A key that is not a string
  gives `incompatible-type`.
- The type, for a literal key: `record{a: integer, b: string?}` gives
  `record{a: integer}`; `record{a: integer, b: string}` gives
  `record{a: integer}`; `dictionary<V>` stays `dictionary<V>`. For a key
  known only at evaluation, every field of the record becomes optional.
- A value of a nominal record type keeps its type when the key is an
  optional field, and is refused with `incompatible-type` when the key is a
  required field: the result would not be a value of the type.
- One key per call, as `DeleteAt` takes one index today.
- Compiled code: not checked in this design. The implementation checks
  whether a target compiles `At` on a dictionary; if no target does,
  `DeleteAt` on a dictionary declines too.

A statement form (`delete r.b` as short for `r = deleteAt(r, "b")`) would
need the same short form for `r.b = v`; both or neither. Not proposed.

The key test stays `Contains(Keys(r), "b")`; no new operator.

**User decision 2026-11-07: (b).** Cost: one overload, its type handler, tests
and two reference pages; estimate under 100 lines of source.

## 7. The change

One issue of size L (CE-71):

- `RecordType`: remove `closed`; add the set of optional keys. Type parser
  and serializer (`b: string?`), `isSubtype`, `reduceRecordType`, the record
  meet and join, the record-to-dictionary relation, `matches` on a
  dictionary value, interning.
- `Field` and `At` type handlers: a listed field gives its type; an optional
  field gives its type with the implicit absent value; an unlisted field is
  a static error. `Values` gives the join of the field types.
- The nominal constructor check accepts the optional fields.
- `DeleteAt` overload (decision C).
- Rewrite the tests that test openness (7 files, measured above).
- Documentation: `docs/TYPE-SYSTEM.md`, the comment on `RecordType`, the
  Epsil types page, the cortexjs.io types guide (`08-guide-types.md`, the
  two width-subtyping passages), the paragraph of `docs/ERROR-MODEL.md` on
  dictionary entries that hold `Missing`, a superseded note at Q6 of the
  2026-10-20 plan, and a Breaking changes entry in `CHANGELOG.md`: a host
  that declares `record{a: integer}` and assigns a value with more fields is
  now refused.
- The comment of `reduceDictionaryType()` (`src/common/type/reduce.ts`) says
  that writing `Nothing` into an entry deletes it; that rule was superseded
  on 2026-11-02. Correct it in the same change.

Separate: CE-1101 (P4), `Dot` over a list that holds `Nothing`.
