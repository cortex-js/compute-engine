# Compute Engine — Roadmap

This file lists the work that remains: open defects, performance problems,
missing capabilities, design questions and tasks. It records FUTURE work only.
Work in progress has no entry: the session that does it holds the state, in
the plan document or the handoff file, and `CHANGELOG.md` and the git history
keep the record of finished work. Work that another record tracks, a GitHub
issue or a Tycho ledger row, gets no entry that repeats it; an entry exists
only for the part of that work this file adds (a decision, a design, the
steps), and it links the other record.

## How to use this file

**References.** Each entry has a reference `CE-<n>`. A sub-item that can be
fixed alone has a reference `CE-<n>.<m>`. Use the reference in commit messages,
code comments, plans and replies, for example "fixes CE-42.3".

- A reference does not change. Do not renumber entries, and do not give the
  number of a removed entry to a new entry.
- A new entry takes the number on the line "Next free reference" below. Read the
  file again just before you add an entry, and increase that line in the same
  edit.
- Put a new entry in the section of its topic. In a section, entries are not in
  number order.

Next free reference: CE-837.

**Entry format.**

```markdown
### CE-<n>. <What is wrong, or what to do>

**Status:** <state>; <kind>[, <size>].[ <decision>.][ <links>.]
**Witness:** <strength>; <the program, what it gives, what it should give>.

<The input, what happens today, what should happen, the cause and the
proposed fix.>

- **CE-<n>.1** <A sub-item that can be fixed alone.>
```

- `<state>` tells an agent whether it may start the work without asking:
  - `ready`: an agent may start it. A `defect` or `wrong value` entry whose fix
    needs no user decision is `ready`. So is a request from Tycho (see below).
    An entry of any other kind is `ready` only when the user approved it, and
    its status line records that approval with its date ("approved
    2026-11-01").
  - `waits for user (<reason>)`: the user acts before an agent starts. The
    reason is `decision` (the entry states the question, the options with
    their costs, and the option the agent recommends), `design` (the next step
    is a design document that the user approves; an agent that judges the
    change worth it writes the document and says so in its report), or
    `approval` (an idea the user has not approved yet; the user makes the
    entry `ready`, with the date, or deletes it).

  There is no `in progress`: the session that starts an item removes the entry
  (see "Started and finished work").
- `<kind>` is `defect`, `wrong value` (a defect that gives a wrong result with
  no error), `performance`, `capability`, `design`, `task` or `documentation`.
- `<size>` is an estimate: `S` (one function or file and its tests), `M`
  (several files in one part of the engine), or `L` (several parts of the
  engine, or a plan document first).
- `<strength>` says how the defect was reached:
  - `corpus`: a Tycho document or ledger row, a GitHub issue, a benchmark, or
    a program a host sent;
  - `plausible`: a program of one or two lines that a user would write, with
    the inputs declared as a host declares them;
  - `crafted`: a program built to reach the case, where a type, a target and
    a construct are chosen together.

  A defect entry has a `corpus` or `plausible` witness. A `crafted` witness
  of a compiled-code difference goes to the known-limitations list of
  `docs/COMPILATION-MODEL.md` ("Caveats of compiled code"), not here, and a
  difference that those caveats allow is recorded nowhere. A `crafted`
  witness of an interpreter defect is an entry only when the user says to
  record it. An entry written before 2026-11-01 may have no witness line: the
  triage of that date adds one or deletes the entry.
- An agent adds an entry for a defect in older code that its task found and
  did not fix (`AGENTS.md`, "Fix every defect"), with the witness line, and
  for an item that the user asked to record. A defect that the task's change
  introduces is fixed, not recorded. An idea for a capability, a performance
  change, a design or a task goes in the agent's report to the user, and
  becomes an entry (`waits for user (approval)`) only when the user says to
  record it.
- Record a user decision with its date. Link the plan document, the GitHub issue
  or PR, and the Tycho ledger row when there is one.
- Write what a person needs to do the work: a reproduction, the cause, the files
  and functions, the options and their costs. Do not record who found the item,
  when, or how.

**Requests from Tycho** (user decision 2026-11-04). Tycho files its requests as
numbered rows in its `docs/COMPUTE_ENGINE.md` ("Open Requests for CE
Maintainers"). An open row there is work this project owes, even when its
wording sounds settled. The row is the one record of that work, and it gets no
entry here, also when its fix needs a decision, a design or several steps. The
CE replies in the row hold the cause, the files, the options, the decision and
the release that ships the fix. Tycho deletes the row when the fix verifies.
How to answer a row is described in the "Instructions for the CE team" section
of that file.

**Started and finished work.** An entry is removed when its work starts, not
when it ends: the session that does the work keeps the entry's content where
it needs it (the plan document, the task brief, the handoff file), and the
commit and `CHANGELOG.md` record the result. When the work stops before it is
done, the session writes the entry again, with the same reference, saying only
what remains. When a sub-item starts, delete its bullet and keep the numbers of
the other sub-items. An entry that waits for a decision or a design stays
until the decision is made or the design is written; then the work starts and
the entry goes.

**Related documents.** `docs/epsil/ROADMAP.md` (Epsil language and tools),
`docs/TYPE_SYSTEM_ROADMAP.md` and `docs/INFERENCE_ROADMAP.md` (type system),
`docs/rubi/RUBI.md` (Rubi integration rules), `docs/fungrim/FUNGRIM.md` (Fungrim
identities), `docs/mathnet/README.md` (MathNet parser corpus),
`benchmarks/README.md` (benchmarks), `docs/plans/` (plans and design records).

## Sections

- [Types and type inference](#types-and-type-inference) (CE-3 to CE-69)
- [Collections, absence and broadcasting](#collections-absence-and-broadcasting)
  (CE-70 to CE-90)
- [Evaluation, canonical forms and scoping](#evaluation-canonical-forms-and-scoping)
  (CE-91 to CE-136)
- [Symbolic computation](#symbolic-computation) (CE-137 to CE-175)
- [Numeric evaluation and special functions](#numeric-evaluation-and-special-functions)
  (CE-176 to CE-208)
- [Compilation](#compilation) (CE-209 to CE-290)
- [LaTeX parsing and serialization](#latex-parsing-and-serialization) (CE-291 to
  CE-305)
- [Epsil](#epsil) (CE-306 to CE-312)
- [Performance](#performance) (CE-313 to CE-353)
- [Tests, tools, documentation and release tasks](#tests-tools-documentation-and-release-tasks)
  (CE-354 to CE-359)

## Types and type inference

### CE-836. A call of a function that is not declared, as an arm of `If` or `Which`, adds nothing to the type

**Status:** ready; defect, M.
**Witness:** plausible; with `q: real` and `g` not declared, `If(q < 2, g(1), 0)` has the type `integer`; when `g` is defined later as `x ↦ x / 2` and `q = 1`, the same expression is `1/2`. With `L = [1, 3, 5]`, `Which(L < 2, g(1), True, 0)` has the type `vector<integer^3>` and is `[1/2, 0, 0]`.

The arm `g(1)` has the type `unknown`, and the join of the arm types leaves
an `unknown` arm out. `untypedArm()` in `library/control-structures.ts` makes
the result `unknown` for a symbol that is not declared and for a library
operator over one, but not for a call of a function that is not a library
operator: a recursive call is typed `unknown` while the result type of its
function is derived, and a recursive function must keep the type of its base
case (`test/compute-engine/ce-447-conditional-unknown-branch.test.ts`). The
scalar typing of `If` and `Which` and the element-wise typing
(`armGivesUnknownCells()`) both use this rule. The fix must tell a function
whose result type is being derived from a name that has no definition, and
read a call of the second as `unknown`. A call over a list (`g(L)`, a
`list<unknown^3>`) is already kept.

### CE-545. A call over an `unknown` operand and over the wide CE-502 form are typed by different rules

**Status:** waits for user (decision); types. Found 2026-10-27 while fixing Tycho row 468.
**Witness:** crafted; Needs an operand declared with the wide CE-502 form.

A call over an operand typed `unknown` is typed with the wide form
`number | tuple | list<number | tuple | list<any>>` (`S(1, g(2))`). A call over
an operand typed with that wide form, which is narrower than `unknown`, is typed
`any` when the body is not component-wise (`T(y)` with `T := a ↦ a + 1`): the
tuple arm answers `any` (`componentwiseTupleCallType`, `call-result-type.ts`).
Tests lock the `any` answer (`broadcastable-typing.test.ts`,
`tycho-373-passthrough-broadcast-typing.test.ts`). Either the `unknown` rule is
too narrow for a body that is not component-wise, or the wide-form rule is too
wide. Since 2026-10-27 a `Max`/`Min` body over numbers and tuples is typed
`number` on both (Tycho row 468). That rule reads a bare `tuple` argument as a
point, a tuple of numbers (`extremumReadsANumber`, `call-result-type.ts`); a
tuple whose coordinate types are known must hold numbers or collections of
numbers. User decision 2026-10-27: the bare `tuple` arm of the wide form keeps
that reading (a point). What remains open is the first question: which of the
two rules for a body that is not component-wise is right.

### CE-27. An access over `any` or `unknown` elements has no `missing` arm

**Status:** waits for user (design); design. User decision 2026-10-20: a design item, not
a small fix.
**Witness:** plausible; `First(W)` with `W: list<any> := []` typed `unknown`, value `Missing`.

`First(W)` with `W: list<any> := []` is typed `unknown`, but evaluates to
`Missing`. Making `withMarker` answer `any` for `any` and `missing | unknown`
for `unknown` broke 44 tests in 14 suites (measured 2026-10-19). Two assert
`unknown` directly (`types.test.ts:2683` `At(anIndexed, 1)`,
`missing-value.test.ts:195` `At(Missing, 1)`). The `missing` arm then flows into
use-driven inference, so Epsil reports `sol[1][1]` as a static error
(`programs.test.ts`). Question: how should a `missing` arm on an access result
flow through inference?

### CE-40. The type of a held operand of a lazy operator is read without its binding

**Status:** ready; defect.
**Witness:** plausible; CE-40.2: `(xs) ↦ (xs \.

A `lazy` operator receives its operands unbound. The two readers of a held
operand's type are now one module, `library/held-operand-type.ts`
(`heldOperandType` and `heldDenotedType`).

- **CE-40.2** A held name is typed by the binding where the type is read, not by
  the one it is evaluated with. `heldOperandType` looks a held symbol up by
  name, as do the `Pipe` derivations of a held application head
  (`pipeImplicitTopicCallType`, `pipeShorthandApplicationType`). In
  `(xs) ↦ (xs |> Filter(p))` with a global `xs: list<string>`, the pipe is typed
  from the global, and the parameter is the list that is filtered. The static
  check can then report an error for a correct program. The stage typing
  `pipeNamedStageType` resolves only the names of library operators
  (`resolvesToSystemBinding()`, `operand-descriptor.ts`), which a parameter that
  has the name of a library operator (`(Sqrt) ↦ 16 |> Sqrt`) still defeats. A
  fix records, when the lazy operator is canonicalized, which held names a local
  scope binds. `TrigExpand`, `TrigToExp` and `TrigReduce` avoid the problem by
  binding their operand at canonicalization.

### CE-51. Make built-in collections conform to `Iterable` and `Indexable` protocols

**Status:** waits for user (design); design. Decision P8 and §7 item 6(h) of
`docs/TYPE_SYSTEM_ROADMAP.md`.
**Witness:** none; Protocol design (decision P8 of TYPE_SYSTEM_ROADMAP).

The audit of 2026-08-21 sized the move of the collection capability from the
type lattice onto the protocol system.

- **Three overlapping answers to "is this a collection".** (1) The lattice:
  `collection<T>`, `indexed_collection<T>`, `list<T>`, … (~139 predicate sites
  and 76 operator-signature bounds). (2) The run-time handlers:
  `CollectionHandlers` on a definition (`types-definitions.ts`, 14 members,
  `iterator` and `count` required, `defaultCollectionHandlers` in
  `collection-utils.ts` derives the rest) with the
  `isCollection`/`isIndexedCollection`/`isFiniteCollection` accessors. This is a
  structural protocol in all but name, reachable from JavaScript only. (3) The
  nominal protocol registry (`engine-protocols.ts`), which has no collection
  protocol. The documented split between CAPABILITY and SHAPE
  (`types-expression.ts`, the `isCollection` doc) is why ~24 sites check both
  (`op.isCollection || op.type.matches('collection<any>')`). The clearest case
  is `BoxedFunction.isIndexedCollection`, a capability accessor whose final
  answer is `this.type.matches('indexed_collection<any>')`.
- **Site classification** (`src/`, without the lattice implementation in
  `common/type/`): 69 predicate sites are pure capability checks ("can I
  iterate, index or count this"; 40 of them in `compilation/`). 70 read shape,
  element, inference or representation (28 in `library/collections.ts`) and must
  stay on the lattice. 10 are mixed (capability checks with tuple or string
  atomicity exceptions). Of the 76 signature bounds, ~57 are capability bounds
  (`Count`, `IsEmpty`, `Contains`, `Join`, the statistics folds). Migrating the
  capability sites alone touches 19 files (24 with the signature bounds).
- **What the protocol system can do today:** built-in lattice types are legal
  conformance targets (`conformanceTargetProblem` admits `string`,
  `list<integer>`, a conditional head `list<T>`); a JavaScript host handler
  satisfies a member with no Epsil source (`ProtocolHostHandler`); dispatch keys
  on the TYPE of the receiver, so an untagged `["List", 1, 2]` dispatches; and
  `where T is Iterable` is a working constraint slot.
- **What it cannot do, by effort:** protocol extension (`Indexable extends
  `Iterable`) is available since commit `fc5d21302` (CE-713, 2026-10-31):
  when CE-51 adopts it, the sentence "`Indexable` alone grants no membership"
  of Appendix A is removed (spec `docs/plans/2026-10-31-protocol-refinement.md`
  §4). Parameterized protocols
  (`Iterable<T>`): `assertV1MemberShape` bans generic members, and conditional
  conformance gets element MATCHING but not element OUTPUT in the result type of
  a member. A dynamic-tier compiled guard that can see element types (the
  `array` bucket is rejected). The bridge that grants membership (conformance ⇒
  inhabits `collection`), which needs `isSubtype` to consult the conformance
  oracle and inverts the `common/type` ⊥ engine layering that the P36 oracle
  seam exists to keep. Compiled dispatch is JavaScript-only.
- **Handler members that are not protocol-shaped:** `elementMemo` is a boolean
  attribute, not a member. `isCollection` is a PER-INSTANCE conformance veto
  (`When`), which nominal conformance cannot express.
  `isLazy`/`isFinite`/`isEmpty`/`isEnumerable` are derived facets, not
  conformance. The `string` option of the index of `at` is dead (no library `at`
  handler accepts a string; keyed access is on `BoxedDictionary`).
  `canEnumerate`/`elementCount` on eager producers form a second, mutually
  exclusive partial conformance that a unification must place.

Recommendation: do not replace the lattice. Make `CollectionHandlers` the
implementation of two engine-declared protocols (`Iterable` over the
`collection` tier, `Indexable` over the `indexed_collection` tier, as §4 of the
same document decides), and point the 69 capability checks at conformance so
that the double checks disappear.

- **CE-51.1** Write the requirement-table design document that item 6(h) asks
  for. The member table above is its input.
- **CE-51.2** Point the 69 capability checks at conformance.

### CE-443. A pure function literal with nine or more nested literals is typed with effects `any`

**Status:** waits for user (design); types. Found 2026-10-24 while fixing CE-347.
**Witness:** crafted; Needs a pure literal nested 9 deep; answer `any` is the safe direction.

The effects walker stops at a depth of 8 nested function literals
(`MAX_LITERAL_DEPTH`, `boxed-expression/effects-inference.ts`) and then answers
`any`, so a pure literal nested 9 deep is typed `(unknown) any -> …`. This is
the safe direction but loses precision. A fix needs a design choice: the nested
walk shares its confinement state with the enclosing literal.

### CE-769. A partial `Apply` used as a `Map` callback is typed `number` and the call is a type error

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; A partial application used as a `Map` callback gives `incompatible-type`; the interpreter should map it.

A partial application used as a `Map` callback gives `incompatible-type`; the interpreter should map it. Found during the work of 2026-10-30 and 2026-10-31 (Item 5); the
reproduction above is the record.

### CE-772. A function assigned in a `Block` gets its static type before the assignment

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Type computed before `f` is assigned; a type that does not hold the value can give a compiled wrong shape (as F56).

Type computed before `f` is assigned; a type that does not hold the value can give a compiled wrong shape (as F56). Found during the work of 2026-10-30 and 2026-10-31 (Defect 25); the
reproduction above is the record.

## Collections, absence and broadcasting

### CE-682. A `Linspace` with an infinite endpoint: its reads disagree with each other

**Status:** waits for user (decision); defect. Found 2026-10-30 in the review of the
interval-js `Linspace` lowering.
**Witness:** crafted; `Linspace(0, +∞, 3)` reads disagree; an infinite endpoint is a value nobody writes.

For `L = Linspace(0, +∞, 3)` the interpreter gives:

| Read | Value |
| --- | --- |
| iteration (`L.each()`, a loop over `L`) | no elements |
| `Sum(L)` | `0` |
| `Count(L)`, `Length(L)` | `3` |
| `At(L, 1)`, `At(L, 2)` | `NaN` |
| `Max(L)` | `+∞` |

So `L` is an empty list for iteration and `Sum`, and a list of three elements
for `Count`, `At` and `Max`. A `NaN` endpoint (`Linspace(0, NaN, 3)`) splits
in another way: iteration gives no elements, `Count` gives `3`, `Max` gives
`NaN`, and `At` and `Sum` stay unevaluated. The iterator declines an endpoint
that is not finite (`Linspace` in `library/collections.ts`), and `count`, `at`
and the reducers do not.

The compile targets cannot agree with all of these at once. Today the
JavaScript target gives `[]` for `Linspace(0, +∞, 3)`, and `interval-js` gives
no value (`empty`), so that it never gives a value that one of the
interpreter's reads contradicts.

Decide which reading is the value of `L`:

- **(a) No value.** `L` has no value when an endpoint is not finite: every
  read gives no value (`Sum` too, which gives `0` today). `interval-js`
  already does this; the JavaScript target would test the endpoints.
- **(b) The samples of the formula.** `L` is `[0, +∞, +∞]`: the iterator
  gives these elements, so `Sum` is `+∞` and a loop runs 3 times; `At(L, 1)`
  is `0`. `interval-js` would give these values.
- **(c) An empty list.** `Count` and `Length` give 0, `At` gives no element,
  `Max` gives its empty-list value; the targets give `[]`.

With no decision, the reads stay in disagreement, and `interval-js` keeps
giving no value for such a `Linspace`.

### CE-666. The count of a list can be larger than the number of elements of its value

**Status:** ready; defect. Found 2026-10-30 while fixing CE-661.
**Witness:** plausible; Interpreter: `[If(0 < u, Nothing, (1, 1)), (2, 3)]` has `count` 2 but one element when the condition is true.

`[If(0 < u, Nothing, (1, 1)), (2, 3)]` has `count` 2, but when the condition is
true its value has one element (`Nothing` is dropped). A broadcast over such a
list inherits the count. A count that can depend on a free variable should be
`undefined`, as for `Range(1, Floor(u))`.

### CE-70. Presence contracts: absent arguments that are not refused or not reported

**Status:** ready; defect, small. Plan:
docs/plans/2026-10-21-presence-contracts-and-assertion.md (decisions P1 to P5;
section 9 has the record).
**Witness:** plausible; CE-70.2: Epsil `if !isMissing(v) { let g = () => f(v) … }` is still reported; plan decisions P1 to P5 exist.

- **CE-70.1** An operator that holds its operands (`lazy`: `Expand`, `Factor`,
  `Together`, `ToCNF`) answers `Missing` for an absent argument. This is the
  exemption of decision P2.
- **CE-70.2** The static guard narrowing does not enter a function literal, and
  it stops at a reassignment of the guarded name. So
  `if !isMissing(v) { let g = () => f(v) … }` is still reported.
- **CE-70.3** `Undefined` has no type of its own (it is typed `unknown`). So a
  strict declaration refuses it only by its value, never statically.
- There is no lowercase `assertPresent` spelling, by the rule that an operator
  with a symbol has no lowercase name (`coalesce` has none either). The function
  form is `AssertPresent(x)`.
- A `missing` cell inside a value (`list<string | missing>`) is judged by the
  element contract, not by the report on the whole value. Decision P1b asks for
  this.

### CE-71. Decide record-field omission, optional fields and a key-removal operation

**Status:** waits for user (design); design.
**Witness:** none; Record-field omission design (Q5, Q10 of a plan).

Decide how a record field is omitted, how an optional field is represented, and
whether an explicit key-removal operation exists. Also classify the custom folds
that remain, `Dot`, ordering and the structural conversions (questions Q5 and
Q10 of `docs/plans/2026-10-20-bare-tuple-record-any.md`).

### CE-72. `Scan` over a source declared with a `missing` element type is typed without the `missing` arm

**Status:** ready; defect.
**Witness:** plausible; `Scan` over a source declared `list<integer \.

For a source declared `list<integer | missing>`, the `Scan` type handler
receives `list<integer>`: the `missing` arm is dropped before the handler runs,
so the result is typed `list<number>` while an absent seed stays in the value. A
fix inside the `Scan` handler cannot see the arm; find where the operand type
loses it. (A `Missing` inside a list LITERAL is typed `nan`, a subtype of
`number`, so `Scan([Missing, Missing], Add)` typed as a numeric list is
consistent.)

### CE-74. The type of a lazy view does not say that an element can be `Nothing`

**Status:** waits for user (design); design. User decision 2026-10-20: a lazy view (`Map`,
`Tabulate`, `Table`, `Scan`, `Iterate`) keeps a `Nothing` result in its own
display, count, `.at()` and `.each()`; turning it into a list erases it.
**Witness:** plausible; `Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])` typed without `nothing`; `Zip` loses elements.

Done so far: `Map` keeps an immediate omission in its result type and does not
call the callback for omitted inputs; `Filter` drops immediate omissions; paired
statistics skip whole aligned observations; numeric aggregates skip omitted
data; data tuples keep `Nothing` slots; `Zip` keeps coordinate alignment and
all-missing rows. Other producers and the remaining consumers still need their
own policies.

The view's type does not record the omission:
`m = Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])` is typed `vector<integer^3>`,
although `.at(2)` is `Nothing`. Consumers that read the element type then
disagree. The original findings, measured 2026-10-20 (some consumers changed
after them, see above):

- `Filter(m, x ↦ True)` makes `incompatible-type integer nothing` error cells.
- `Zip(m, [7, 8, 9])` gives `[(1, 7), (8), (9)]`: the tuple erases `Nothing`, so
  each pair loses its first element.
- `Mean(m)` is an error, while `Max(m)` and `Product(m)` skip `Nothing`;
  `Total(m)` stays unevaluated.
- A compiled `Map` falls back and returns `[1, null, null]`.

Sub-items:

- **CE-74.1** Question: does the element type of a view include `nothing` when
  its callback can return `Nothing`?
- **CE-74.2** Question: how does each reducer treat a `Nothing` element (skip
  it, as a list literal does, or treat it as an error)? Whether `Ordering(m)`
  gives the positions of every element of the view (3) or of the erased list (1,
  today) depends on the same question.
- **CE-74.3** `Sort` over a view whose every element is `Nothing`
  (`Sort(Map(x ↦ Nothing, [1, 2]))`) stays unevaluated, so `IsEmpty` of it stays
  unevaluated too. It should be `[]`.

### CE-79. Indexing and slicing a collection whose count is a `bigint`

**Status:** ready; capability. User decision 2026-10-06: `at()` and the readers
that compute an index from the count accept a `bigint` index. Issue #416.
**Witness:** corpus; Ready with user decision 2026-10-06; GitHub issue #416 (`Last(Range(1, 10^20))` stays unevaluated).

A collection count that is not a safe integer is a `bigint` (`expr.count`, the
`count` collection handler; see `smallCount()` in
`boxed-expression/collection-count.ts`). The readers that index or slice with
the count still take a `number`, so they treat such a count as unknown: `at()`
takes a `number` index, and `Last(Range(1, 10^20))` stays unevaluated because
the last index, 10^20, is not a safe integer. To do: make `at()` and the readers
that compute an index from the count (`Last`, a negative index, `Take`/`Drop`
with a negative count, `Most`, the rotations) accept a `bigint` index, so that
these give their value.

### CE-81. Three lazy collections assigned to a variable stay a live view of the variables they read

**Status:** ready; defect, small.
**Witness:** plausible; `let big = filter(1.oo, c => c > k)`, later `k = 10` changes `first(big)` from 4 to 11.

An assignment statement stores the elements of a FINITE lazy collection that
reads a variable, as a list when the value is an indexed collection and as a set
when it is typed as a set (`assignedValue`, `library/core.ts`). Three cases are
left lazy and keep their variables by name:

- **CE-81.1** A collection with no last element cannot be listed:
  `let big = filter(1..oo, c => c > k)` still keeps `k`, and a later `k = 10`
  changes `first(big)` from `4` to `11`.
- **CE-81.2** A `Filter` over a dictionary is a dictionary, and no operator
  lists a lazy dictionary as a dictionary.
- **CE-81.3** A `Filter` over a set held by a local whose type was inferred
  `collection<any>` is not typed as a set, and is not indexed.

A fix replaces each variable the collection reads by its current value and keeps
the collection lazy. The replacement must reach inside the function literal (the
`k` of the predicate) without touching the literal's own parameters. The host
function `ce.assign()` stores the value it is given, on purpose: a host that
defines one name from another wants the live view.

### CE-82. Point arithmetic with a valued symbol: the type and the value disagree

**Status:** ready; defect, small.
**Witness:** plausible; `Q := [(1, 2), (3, 4)]`, `x := 5`: `Q + x` typed a list of points, evaluates to a list of errors.

With `Q := [(1, 2), (3, 4)]` and `x := 5`:

- **CE-82.3** `Q + x` is typed `list<tuple<integer, integer>^2>` but evaluates
  to a list of errors, and `x + (1, 1)` is typed
  `integer | tuple<integer, integer>` but evaluates to one error: a number-typed
  symbol beside a point. The check `addsPointToNumberCollection`
  (`collection-utils.ts`) reads operand TYPES only. A number symbol whose type
  was only inferred keeps such a sum symbolic under `evaluate()`, so to type it
  `error` from the type alone would be wrong; a fix needs the symbol's value.

### CE-773. `Scan(M, (a, t) ↦ a + t, 0)` over the rows of a matrix stays unevaluated

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; A running sum of matrix rows is a one-line program; file says "check intent" first.

A running sum of matrix rows is a one-line program; file says "check intent" first. Found during the work of 2026-10-30 and 2026-10-31 (Item 30); the
reproduction above is the record.

## Evaluation, canonical forms and scoping

### CE-834. An asynchronous run of a block does not end when a global with the name of a local holds a list

**Status:** ready; defect, S.
**Witness:** plausible; with `n := [1, 2]`, `ce.box(['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 1]]).evaluateAsync()` does not end: the heap grows until the process stops (measured with a limit of 1 GB). `evaluate()` gives `3`.

Without the global `n`, or with `n := 5`, the asynchronous run gives `3`. A
stack trace taken in the loop shows the asynchronous evaluation of `n + 1`
(`boxed-expression/boxed-function.ts`, the test
`hasUnresolvedCollectionOperand(this.ops, isBroadcastableCollection)` of the
asynchronous broadcast step), which reads `.value` of the operand `n` through
`bindingInContext()` (`boxed-expression/binders.ts`). The probable cause, not
verified: this read does not find the binding that the run made for the local
`n`, and reads the global by name, so the operand counts as the list `[1, 2]`,
the sum is applied to each element, and each element evaluates `n + 1` again.
A type computation no longer makes this read
(`isOutsideBindingOfBlockLocal()`), but an evaluation keeps the read by name.
The fix finds why the binding of the run is not in the chain of that read.
Then add an asynchronous case to
`test/compute-engine/ce-827-block-local-type-ignores-same-name-binding.test.ts`.

### CE-832. A call boxed before its head is declared as a data symbol does not evaluate to `expected-function`

**Status:** ready; defect (consistency), M.
**Witness:** plausible; Interpreter: box `g(x) + 1`, then `ce.declare('g', 'real')`: `evaluate()` gives `g(x) + 1`, and the same expression boxed after the declaration gives the `expected-function` error.

Box the expression, then run `ce.declare('g', 'real')`. The call `g(x)`
evaluates to itself. With `ce.assign('g', 5)` too, it evaluates to the error
`incompatible-type` (`'function'`, `'5'`). The same call boxed after the
declaration is the error `expected-function`. The operators that evaluate
the call give its value: `Sum(g(k), Limits(k, 1, 3))` gives
`g(1) + g(2) + g(3)`, `Product` gives the product, `ND(x ↦ g(x), 1)` and
`Apply(Derivative(x ↦ g(x)), 1)` stay unevaluated, and `NLimit(x ↦ g(x), 0)`
gives `NaN`. Boxed after the declaration, each one is the error.

`Integrate`, `D`, `Limit` and `NIntegrate` report the error with a check of
their own: `dataSymbolCallError()` in `library/calculus.ts`, which uses
`errorValueWhere()` of `boxed-expression/error-value.ts`, and for `Integrate`
the test `liftIntegrand(ops[0]).isValid` in its evaluate handler. That check
does not reach a call below a selecting operator, so
`D(If(x > 2, g(x), x^2), x)` keeps a derivative for each branch, where the
expression boxed after the declaration is the error.

Cause: `BoxedFunction._canonicalToEvaluate()` (`boxed-function.ts`) evaluates
a call boxed again only for a call that recorded its callee
(`_reboxedForCallee()`). A call boxed before its name had a definition is
boxed again only to read its type (`_reboxedForForwardCallee()`), and that
function refuses a new call that is an `Error`. Proposed fix: the evaluation
of such a call gives the call boxed again when it is the `expected-function`
error. The check of the four operators in `library/calculus.ts` can then be
removed if the error reaches them through their operand.

### CE-752. A lazy view returned from a `Block` reads a valueless local as the global of the same name

**Status:** ready; defect, small. User decision 2026-11-05: option (a).
Found 2026-11-01 while fixing a caller-binding defect (a function called with a block-local valueless `y`
read the global `y`; that part is fixed).
**Witness:** plausible; `Block(Declare(y,'real'), [y])` evaluated again gives `[5]`.

With a global `y := 5` and `f := x ↦ NumericApproximation(x)`,
`Block(Declare(y, 'real'), Map(f, [y]))` gives `[5]`: the block returns a lazy
view, and its elements are read after the block's scope is popped. A binding
from a popped scope reads its name in the current scope (the rule written in
the `bindingInContext` comment, `boxed-expression/binders.ts`), which is the
global `y`. The same holds without a function: `Block(Declare(y, 'real'), [y])`
gives `[y]`, and evaluating that result again gives `[5]`;
`Map(x ↦ x + 0.5, [y])` gives `[5.5]`. Expected: the local `y`, which has no
value (`[y]`, `[y + 0.5]`).

Question: what does a binding of a block that has ended read?

- (a) Recommended: a binding that a block run removed reads as its own
  valueless definition once the block's scope is no longer live:
  `Map(f, [y])` gives `[y]`, and evaluating `[y]` again stays `[y]`. This
  changes the written rule for a popped scope.
- (b) A block that returns a lazy view holding a valueless local reads its
  elements before the block ends. Narrower, but `[y]` evaluated again still
  gives `[5]`.
- (c) No change: these cases keep reading the global value.

### CE-739. An assignment, `Return`, `Break` or `Continue` inside a conditional whose condition is a collection has no defined meaning

**Status:** waits for user (design); design, medium. Filed 2026-11-01 from CE-722 (user
decision 2026-11-01: the compiler declines this shape; the meaning in the
interpreter is this entry).
**Witness:** crafted; Needs a list condition with an action branch (`If(M[1], p ≔ 5)`, `M: list<any>`); compiler already declines.

An `If` or a `Which` whose condition is a list selects element by element: with
`L: list<real>`, `If(L > 0, 1, -1)` gives a list. When a branch is an action
rather than a value, the result is not defined, and the interpreter's results
do not follow one rule. Measured at `e3ca9c1a6`: with `L = [-1, -2]`,
`Block(p ≔ 0, If(L > 0, p ≔ 5), 2p)` gives `0`; with `M: list<any>` and
`M = [[True, False]]`, `Block(p ≔ 0, If(M[1], p ≔ 5), 2p)` gives `10`, so the
assignment ran when one element of the condition was true. A `Return`, `Break`
or `Continue` in such a branch has the same problem: it is one action, not a
per-element value.

Candidate rules, to choose in a short design document:

- The branch runs when any element of the condition is true (the result of
  `M[1]` above); `p` is then a number. The compiler can emit this.
- The condition of a branch that has an action must be a boolean; a collection
  there is an error at canonicalization or evaluation. The compiler then
  declines it as an invalid expression, which it does today.
- The assignment is done element by element and `p` becomes a list. This
  changes the type of `p` and is the hardest to compile.

Until this is decided the compiler declines the shape (CE-722) and the
interpreter's current results stand.

### CE-709. `Solve` with a float over a real domain lists only exact roots, and can claim no solution

**Status:** waits for user (decision); wrong value.
**Witness:** crafted; Witnesses are floats nobody writes (`x = 10.0000000000001`, `x² = -1e-20`).

The interpreter compares numbers within `engine.tolerance` (1e-10). Over a
real domain, `Solve` lists the exact roots of an equation with a float, not
the values that the tolerance also accepts. When a root is just outside the
domain, the result is `[]`, which is false:

- `Solve(x = 10.0000000000001, x ∈ Interval(-10, 10))` gives `[]`, but
  `Equal(10, 10.0000000000001)` is `True`, so `x = 10` is a solution.
- `Solve(x² = -1e-20, x ∈ ℝ)` gives `[]`, but the equation is `True` at
  `x = 0`.

Over a discrete domain the same case now stays unevaluated (or is
enumerated). Options:

- **(a)** Over a real domain, an equation with a float stays unevaluated when
  the domain or the real type removes a root. Cost: `x² = -1.5` over `ℝ`
  changes from `[]` to no answer.
- **(b)** Keep the current contract: over a real domain, `Solve` lists exact
  roots, and a value within the tolerance of a root is not a separate
  solution. Document it in the `Solve` reference with the example above.

If nothing is decided, (b) stays in force but is not documented.

### CE-692. Make `subs()` capture-avoiding

**Status:** ready; design, medium. User decisions 2026-10-30: `subs()` becomes
capture-avoiding; for the two binders that cannot be renamed before evaluation
(a held block's `Assign`, a `Declare` inside an `If` branch), option (a): the
replacement is inserted as today, documented with examples, and an internal
variant returns `undefined` there. Starts after the fix of GitHub issue #489 is
committed. Plan:
`docs/plans/2026-10-30-capture-avoiding-subs.md`.
**Witness:** plausible; Ready with user decisions dated 2026-10-30 and a plan; `Sum(j + k, …).subs({j: k})` gives 12.

Today `Sum(j + k, Limits(k, 1, 3)).subs({j: k})` gives `Sum(k + k, …)`, which
is `12`: the replacement `k` is captured by the index. After the change, the
index is renamed first: `Sum(k + k_1, Limits(k_1, 1, 3))`, which is `3k + 6`.
Nine internal callers check for this capture and decline today; each check is
removed in its own step, with a test.

### CE-657. A cache keeps a random draw or the value of an impure operator when the node does not look impure

**Status:** waits for user (design); wrong values; needs a design. Found 2026-10-30 by the reviews
of the store-guard work (evaluation-cache plan, step 1); the same on HEAD
`d1b7d0838`. Taken out of step 1 by user decision 2026-10-30, after four
attempted designs each gave a new defect.
**Witness:** crafted; Needs a host operator declared `pure: false` or one node reused across seeds; four designs failed.

`isPure` of a node does not follow the value of a symbol it reads, and the store
guard (`boxed-expression/store-guard.ts`) counts only host code that states no
purity. So a cache can keep a value that changes at each evaluation:

- A symbol whose value draws or calls an impure operator: with `q` a host
  operator declared `pure: false` and
  `ce.declare('r', { value: ce.box(['q']) })`, `r` alone gives 2, then 3, but
  `Reverse(List(5, r))` gives `[1,5]` at every evaluation, and two concurrent
  `evaluateAsync()` calls share one call of `q`. The same with `r` holding
  `Random()`, a dictionary that holds `q()`, a raw (not canonical) `Random()`,
  `ReleaseHold(Hold(Random()))`, or `At(Map(x ↦ x + q(), [1,2]), 1)`.
- A draw under a seed served under another seed: `r := Random()`,
  `x = Reverse(List(1, r))`; `WithRandomSeed(3, x)`, then `WithRandomSeed(4, x)`
  on the same `x` gives the seed-3 draw, and `x` alone gives it again.

Attempts and why each failed:

- Count when a symbol whose value is not `isPure` is read: it also counted
  undeclared function calls (`a := g(1)`), so many caches stopped storing (a
  sequence workload went from 45 ms to 963 ms), and it changed the result of the
  sequence term memo, which defines one draw per term.
- Count only a value that calls a nondeterministic operator, found by a walk of
  the value: the walk missed a raw value, `ReleaseHold`, and a function literal
  applied by `Map`.
- Exempt the draws made inside a `WithRandomSeed` frame: gave the seed case
  above.
- Count at the evaluation of each nondeterministic operator, and take back the
  draws of a seeded frame when it ends: not reviewed to the end; it makes a
  count go down, and it is not clear that a computation holding the whole frame
  is deterministic when the seed is not a constant.

What a design must decide: which caches define a result and must keep one set of
draws per instance (today: the element memo, the facet memo, the materialized
`at()` cell, the sequence terms; see `docs/RANDOMNESS-MODEL.md` §6), and how a
seeded frame is identified so that its draws can be cached only with it. The
same design decides one related gap: the element memo accepts the provisional
counts of the store guard (a cut cycle, a re-entrant signature read, an
iteration limit, a provisional lazy value or cell), so it can keep an element
computed from a provisional answer, where the other caches refuse such a store;
it accepts them today so that its draws and host calls stay the same as before
the store guard. The cost limit is the paired benchmark of
`benchmarks/evaluation-caches.ts` (no workload slower than 1.25×).

### CE-649. An async host handler that evaluates the node containing it waits on itself

**Status:** waits for user (decision); defect (a hang), needs a design decision. Found 2026-10-30 by
the review of the store-guard work (evaluation-cache plan, step 1); the same on
HEAD `00869b80a`.
**Witness:** crafted; Hang needs an async host handler that evaluates its own containing node.

When `evaluateAsync()` reads a lazy collection node, a second caller of the same
node with the same signal, frames and effects joins the walk in progress
(`_lazyValuePending`, `boxed-expression/boxed-function.ts`) instead of starting
its own. If a host operator inside the node has an `evaluateAsync` handler that
itself calls `evaluateAsync()` on that node, the handler joins the walk that is
waiting for the handler, and neither promise settles. Repro: a host operator
`g`, `pure: true`, whose `evaluateAsync` handler runs
`await node.evaluateAsync(); return 5`, where `node` is `Reverse(List(1, g()))`;
`node.evaluateAsync()` never settles. The synchronous route ends: it stops the
recursion and gives `[5,1]`.

Three attempted fixes each gave a new defect, so a fix needs a design:

- Refusing a join when the caller has the same async evaluation number as the
  walk misses a handler that calls after an `await` (it gets a new number), and
  made a handler that always re-evaluates its node recurse without limit (each
  refused caller starts a walk that is not shared).
- Refusing a join while the walk has a pending host handler misses a deadlock
  through two separately started nested walks (an outer walk joins an inner
  walk, whose handler then awaits the outer node).
- Limiting the number of open async walks per node counts unrelated concurrent
  callers as recursion; at the limit the synchronous fallback does not run
  async-only operators and gives a wrong value.

Options:

- (a) Carry the evaluation context across `await` (`AsyncLocalStorage` in
  Node.js; browsers have no equivalent), so that a handler's nested call is
  known to belong to the walk it would wait on. The engine then refuses that
  join and stops the recursion as the synchronous route does.
- (b) Never join a walk for a caller that host code started. Two concurrent
  evaluations of one node then each run the node's host code, where today they
  share one run.
- If nothing is decided: the hang stays, as on HEAD.

### CE-607. `Expand` and other rewrites copy one random draw into several

**Status:** ready; defect. Found 2026-10-28 while fixing CE-598.
**Witness:** plausible; `Expand((r(t) + 1)^2)` with `r` declared `random` makes three draws from one.

`Expand((r(t) + 1)^2)`, with `r` declared with the `random` effect, gives
`r(t)^2 + 2r(t) + 1`: one draw becomes three independent ones, which changes the
distribution. This is the opposite of CE-598 (one draw copied rather than two
merged). Any rewrite that duplicates a subexpression (expansion of a power or a
product, distribution, substitution of a repeated variable) has the same problem
when the subexpression draws. A fix needs a rule for when such a rewrite is
allowed (for example, refuse it, or keep the power unexpanded). CE-598 also
guarded only the identity rules that its sweep showed merging draws; other
hand-written simplify rules compare subexpressions with `isSame`
(`simplify-trig.ts`, `simplify-power.ts`, `simplify-log.ts`, `simplify-abs.ts`,
`fu.ts`, the Rubi rules) and may still read two draws as one value. Both need a
systematic audit. Same-argument identities that the CE-598 fix found and left
unguarded: `commonTerms()` (`arithmetic-mul-div.ts`, used by `Factor` on
relations); `collectFactors()` (`factor.ts`, partial fractions, probably
unreachable with a draw); `a!/b!` and `n!/(k!(n−k)!) → Binomial`
(`simplify-divide.ts`); `log_c(c^x·y)`, `log_c(c^x/y)` and the denominator form,
`c^log_c(x) → x`, `c^(log_c x + y)`, `c^(log_c x · y)`, `c^(log_c x / y)`
(`simplify-log.ts`); `Root(x^n, n) → |x|` with a drawn index
(`simplify-power.ts`); the grouping of sum terms by a common remaining factor
(`simplify-rules.ts`).

### CE-608. The targets of a destructuring assignment in a `Block` are listed as unknowns

**Status:** ready; defect. Found 2026-10-28 by the review of CE-597.
**Witness:** plausible; `Block(Assign(Tuple(a, b), Tuple(1, 2)), Add(a, b)).unknowns` is `['a', 'b']`, should be `[]`.

`Block(Assign(Tuple(a, b), Tuple(1, 2)), Add(a, b))` evaluates to 3 and does not
declare `a` or `b` outside the block, but its `.unknowns` is `['a', 'b']`. A
plain local, `Block(Assign(c, 1), Add(c, 1))`, gives `[]`. The free-variable
walk (`collectReferences`, `abstract-boxed-expression.ts`) does not count the
symbols of a `Tuple` target of `Assign` as locals of the block. Same on main
before CE-597.

### CE-537. The free-variable walk misreads two binders

**Status:** ready; defect. Found 2026-10-27 while fixing `subs()` for Tycho row
464; `subs()` now follows this walk, so it inherits both readings.
**Witness:** plausible; `Exists(y < x, x)` and `{x².

- In a RAW `Sum(j·k, Limits(k, 1, k))` (no operator definition), the walk treats
  the index as bound in the whole `Limits` clause, so it reports only `j` as
  free. The upper bound `k` reads the enclosing binding and is free, as the walk
  reports for the canonical form.
- In `Exists(y < x, x)`, with a bare symbol as the quantified variable, the walk
  reports `x` as free, where `Exists(y < x, Element(x, S))` binds it.
- A set-builder with the membership in its condition, `{x² | x ∈ ℤ}`
  (`Set(x², Condition(Element(x, Integers)))`), reports `x` as free, and
  `subs({x: 3})` replaces it. Which name a set-builder binds is decided by the
  parser (`setBuilder()`, `latex-syntax/dictionary/definitions-sets.ts`); the
  walk would need the same rule.
- The target of an `Assign` outside a `Block` is a write to an outer symbol. The
  walk reports it as free, so `If(z > 0, Assign(z, 5), 0).subs({z: 7})` replaces
  the target and gives an `Error` node. Decide whether a write target is kept by
  `subs()`.

### CE-539. Compiling to a shader infers the root's free symbols as `number`

**Status:** ready; defect. Found 2026-10-27 while working on CE-525.
**Witness:** plausible; Compiling a user-function call to a shader changes the declared type of free `x`, `y` to `number` for the engine life.

The GPU root inliners (`inlineCollectionValuedCallsAtRoot`, and
`inlineSharedUserFunctionCalls` in `compilation/gpu-shared-calls.ts`) substitute
user-function bodies with `subs()`. As a side effect the engine infers the free
`x` and `y` of the compiled expression as `number`: their type goes from
`unknown` to `number` for the life of the engine. A compile should not change
the declarations of the symbols it reads.

### CE-534. A recursive `replace()` replaces a bound variable, the binder included

**Status:** waits for user (design); defect. Found 2026-10-27 while fixing `subs()` for
Tycho row 464 (CE-530).
**Witness:** plausible; `replace({match: 'j', replace: 10}, {recursive: true})` rewrites a `Sum` index.

`j + Sum(j, Limits(j, 1, 3))` with
`replace({match: 'j', replace: 10}, {recursive: true})` gives
`10 + Sum(10, Limits(Error…, 1, 3))`: the rule rewrites the index of the `Sum`
and its bound occurrences, as `subs()` did before CE-530. The recursion is in
`applyRule` (`rules.ts`). A fix must decide how a rule that matches a literal
symbol treats a bound occurrence, while the simplification rules must still
rewrite inside the body of a binder (`Sum(2k, …)` to `2·Sum(k, …)`).

### CE-91. Define value capture on assignment, mutable-object boundaries and view reads

**Status:** waits for user (design); design.
**Witness:** none; Design of value capture and view reads (plan Q11); no reproduction in the entry.

Define the ordinary capture of a value on assignment, the boundaries of mutable
objects, and the behavior of a view that is read more than once or whose read
has effects (question Q11 of `docs/plans/2026-10-20-bare-tuple-record-any.md`;
the probes are in `docs/plans/2026-10-20-lazy-view-read-capture-probes.md`).

### CE-103. A result built with the library π serializes as `Pi` in a scope that rebinds `Pi`

**Status:** waits for user (decision); defect, S.
**Witness:** crafted; Needs `Pi` declared locally plus a `.json` round trip inside that scope.

A declaration of `Pi` is refused in the global scope only, so that a function
parameter, a `Sum` index or a block local can still be named `Pi`. In such a
nested scope, a result that the engine builds with the library π serializes as
`Pi`, and boxing its JSON again inside that scope reads the local. Example: in
a block with `Declare(Pi, real)` and `Assign(Pi, 3)`, `r` is the value of
`Sum(1/n², n, 1, ∞)` (`π²/6`, N = 1.6449); `ce.box(r.json)` inside the block
gives `3²/6 = 1.5`. Outside the block it gives 1.6449 again. Evaluation inside
the block is correct: `s := Sum(…); s` gives `π²/6` (the assignment snapshot,
`snapshotRunVariables()` in `function-utils.ts`, no longer reads the library
constant as the local).

Options:

- (a) Serialize such a symbol with a spelling that a local cannot capture.
  MathJSON has none today: this adds one to the documented serialization
  rules, and every consumer must read it.
- (b) Each site that builds a result with π keeps it symbolic when `Pi` is
  shadowed, as the trigonometric sites do (`holdsShadowedPi()`). Many sites
  change, and a value is lost where one exists.
- (c) Document that a JSON round trip inside a scope that rebinds `Pi` reads
  the local. No code change.

Recommended: (c). Only an explicit `.json` round trip inside the scope is
affected. If nothing is decided, the behavior stays and is not documented.

### CE-105. Error frames do not name the canonical operand or the declared call

**Status:** ready; defect, small. See also CE-109.
**Witness:** plausible; Epsil `let v = Ln("a") + Ln(2)` underlines the whole call; error frames name wrong operands.

- **CE-105.1** The frame of an error that the evaluation of an operand of `Add`
  or `Multiply` makes counts the operands of the RESULT of the handler, not of
  the canonical call. With `let s: any = "a"`, `Sin(s) * Cos(x)` (canonical
  order `Sin(s)·Cos(x)`) gives the frames
  `Multiply argument 2, Divide argument 1`. These two operators are lazy: their
  handler evaluates the operands, and `_computeValue()`
  (`boxed-expression/boxed-function.ts`) reads the error out of the result tree
  with `errorValue(result)`. So the Epsil error location does not trust such an
  index and underlines the whole call (`Sin(u) * Ln(w)`), unless only one
  written operand can make an error. Fix: a frame that names the canonical
  operand (found with `errorEvaluatedFrom`, as `_deferredErrorFrame()` does).
- **CE-105.2** In Epsil, `let v = Ln("a") + Ln(2)` underlines the whole call for
  the runtime error, and its `static-type-error` underlines the whole statement.
  The `Ln` frame matches two written calls, so `locateError()`
  (`src/epsil/error-location.ts`) treats it as ambiguous. The error carries the
  offending value `"a"`, and `cannotBeValue()` already tells that `Ln(2)` cannot
  have made it: use it to drop the call whose argument differs before the match
  is called ambiguous.
- **CE-105.3** The frames of `3 - Ln(w)` (with `let w: any = "s"`) are
  `Negate argument 1, Add argument 1`, with no `Ln` frame, while `Ln(w) * 2` has
  one. Find why the `Ln` call adds no frame there.

### CE-111. Some lazy operators still run synchronously under `evaluateAsync`

**Status:** ready; capability. Issue #392. Approved 2026-11-01.
**Witness:** corpus; CE-111.4 approved 2026-10-31 (async iterator, spec ready); CE-111.1, .5 are design (keep); rest proposed under issue #392.

An operator opts in to the asynchronous route with `evaluatesOperands` ("the
handler demands and evaluates every held operand and reads nothing else of their
structure"): the route then awaits each held operand in order and runs the
handler on the values. A handler that stops early, or evaluates only some of its
operands, has an asynchronous twin of its own. `N`, `Add`, `Multiply`,
`Evaluate`, `ReleaseHold`, the chainable relations, and the lazy operators
listed in the code (flag, twin on the operand, or twin on the walk of a
collection through `runAsync`) already yield and honour an abort signal.

- These operators stay synchronous by design, because an `await` between
  operands does not interrupt their long step. They read the structure of an
  operand or build a definition: `Numerator`, `Denominator`,
  `NumeratorDenominator`, `Interpret`, `Head`, `Tail`, `Type`, `Signature`,
  `About`, `Symbol`, `Subscript`, `Unevaluated`, `Function`, `Rule`,
  `Predicate`, `IsSame`, `Same`, `MatchesType`, `Conforms`, `IsCompatibleUnit`,
  `UnitDimension`, `Spread`, `Declare*`, `DefineFunction`, `Assume`,
  `Condition`. They transform an operand symbolically: the polynomial heads,
  `Together`, `Apart`, `PartialFraction`, `Cancel`, `Expand*`, `Factor`,
  `Distribute`, `TrigExpand`, `TrigReduce`, `TrigToExp`, `ReplaceAll`,
  `Derivative`, `JacobianMatrix`, `InverseFunction`. They hand a held function
  or expression to a synchronous solver or quadrature: `Solve`, `DSolve`,
  `RSolve`, `FindRoot`, `FindFit`, `NIntegrate`, `NLimit`, `Limit`, `Residue`,
  `ND`, `NDSolve`, `InterpolatingFunction`, `EvaluateAt`.
- **CE-111.1** These operators stay synchronous, can have a long operand, and
  need a design: `Assign` (the right-hand side is evaluated in about ten
  branches, interleaved with writes to the scope), `When` and
  `Match` (conditional evaluation of a branch, with a large handler), `FlatMap`
  (its materialization walks a lazy view without a generator), `Timing` (a
  wall-clock measure that would include the yields), `WithRandomSeed` and
  `HoldValues` (their frame, a seed or a value shield, cannot span an `await`),
  and `NumericApproximation` (the marker of a lazy `Map`, evaluated per
  element).
- **CE-111.2** A user function whose body is already suspended on this engine (a
  recursive body, or a second call of the literal from another evaluation) and
  one with a free symbol in an argument run synchronously, because the scope of
  the body has room for one suspended frame. A recursive function yields in the
  statements of its outermost call only.
- **CE-111.5** Design needed. Under `evaluateAsync()`, `IndexWhere` checks
  whether a predicate step met a collection whose elements are not known (an
  incomplete walk) only up to the first `await` of that step. The synchronous
  search (`searchIndex`, `library/collections.ts`) gives no answer when the
  predicate meets such a collection, so that a missed element can never
  become a "found" or "not found" answer. The asynchronous walk
  (`indexWhereAsyncWalk`) reads the count `incompleteWalkCount()` before and
  after each step, but that count is shared by the whole engine
  (`boxed-expression/incomplete-walks.ts`), and another evaluation can change
  it during an `await`. So when the part of a predicate step after its first
  `await` walks a collection with unknown elements and still answers `True`,
  `evaluateAsync()` can give an index where `evaluate()` gives no answer. No
  input that shows the difference has been found: a predicate such as
  `y ↦ AsyncOnly(y) > 0 ∧ Count(FlatMap([1, 2], x ↦ Join([x], v))) > 0`
  (with `v` valueless) stays undecided on both routes, because the `Count`
  stays unevaluated. A fix needs an incomplete-walk count that belongs to one
  evaluation (its evaluation context), so that each `noteIncompleteWalk()`
  call adds to the count of the evaluation that is current. The same count
  would let the other asynchronous walks over lazy sources (CE-111.4) check
  their reads across an `await`. Documented in the CHANGELOG entry of
  `07b9f66fa`.
- **CE-111.4** Design needed. The elements of a lazy collection are computed
  synchronously when they are read, also under `evaluateAsync()`. So an
  operator that has only an `evaluateAsync` handler stays unevaluated in each
  element. With `AsyncOnly` declared `(number) -> number` with only an
  `evaluateAsync` handler that returns `x + 5`,
  `await Take(Apply(y ↦ AsyncOnly(y), Range(1, 100000)), 2).evaluateAsync()`
  gives `[AsyncOnly(1), AsyncOnly(2)]`; it should give `[6, 7]`. `Apply` makes
  a lazy `Map` for a large source or a source of unknown length
  (`applyLiteralMapped`, `library/core.ts`), and the reader computes each
  element with `evaluate()`. A small source is mapped eagerly and is awaited
  (`Apply(y ↦ AsyncOnly(y), [1, 2])` is `[6, 7]`). `Map` and `Filter` are
  always lazy views, for a source of any size: `Map` has no `evaluate` or
  `evaluateAsync` handler, and its elements are computed when the view is read
  (`materialize()`, `boxed-function.ts`). So, at commit `80a1c36c2`,
  `await Map(AsyncOnly, [1, 2]).evaluateAsync()` and
  `await Pipe([1, 2], Map(AsyncOnly)).evaluateAsync()` read
  `[AsyncOnly(1), AsyncOnly(2)]`, and `Map(y ↦ -AsyncOnly(y), [1, 2])` and
  `Map(Composition(Negate, AsyncOnly), [1, 2])` read
  `[-AsyncOnly(1), -AsyncOnly(2)]`; `Filter([1, 2, 3], y ↦ AsyncOnly(y) > 7)`
  reads as the error "Filter predicate must return "True" or "False"". Until
  the iterator exists, `evaluateAsync({ materialization: true })` gives the
  awaited values for `Map` (`[6, 7]` and `[-6, -7]`), because
  `materializeAsync()` awaits each element; it does not help `Filter`, which
  then throws the same error, because the predicate is still applied
  synchronously. A fix needs a way for a
  lazy collection to give its elements asynchronously (an asynchronous
  iterator next to `each()`, used by the asynchronous readers), or a rule
  that a lazy collection whose element expression holds an operator with only
  an asynchronous handler is made eager under `evaluateAsync()`. The first
  keeps the size of a large source; the second is simple but computes every
  element. User decision 2026-10-31: the first option, an asynchronous
  iterator of the elements of a lazy collection, used by the asynchronous
  readers. A one-page spec comes before the implementation: which lazy
  operators get the iterator, which readers use it, and how an abort signal
  and the evaluation context carry across each `await`.

### CE-123. A validation phase before canonicalization, so that a probe does not declare

**Status:** waits for user (design); design.
**Witness:** none; Validation phase idea, "do it when a third instance appears".

Two computations must VALIDATE an expression (decide what it is or what it would
produce) without changing the environment. Each pays for this with a scratch
scope plus an exemption from cache invalidation:

- the `Pipe` implicit-map type handler (`PIPE_IMPLICIT_MAP_TYPE`,
  `library/core.ts`) canonicalizes held operands to decide whether a stage maps
  implicitly, and keeps a memo of the generation observed AFTER the derivation;
- the fix of item 219 ("Reading a nested lazy view's type was exponential in
  depth").

The user's proposal (2026-08-21): give the engine a phase before
canonicalization whose job is validation. Regular canonicalization calls it, and
internal constructions can SKIP it and use a cheaper canonicalization without
validation. A probe that needs only "what type would this application have" then
takes the cheap option and never declares, so no scratch-scope exemption is
necessary. Not scoped or scheduled. Do it when a third instance of the pattern
appears.

### CE-131. Disjunctive (`Or`) guards in the assumptions system

**Status:** ready; design. Plan: docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md
§7 (non-goals). Approved 2026-11-01.
**Witness:** corpus; a Fungrim corpus count (87 entries).

87 complex-domain Fungrim corpus entries cannot be discharged because their
guards have an `Or` at the root. The assumptions design does not cover
disjunction. About 43 other failures are symbolic bounds (`|z| < φ−1`), which
the assume-side decomposition drops on purpose. Support for disjunctive facts is
a design extension (case splitting or watched-disjunct propagation). The guard
census (`scripts/fungrim/guard-census.json`, now 89.6 % complex-domain
dischargeable) shows what it would gain. Do it when there is demand.

### CE-133. Other test-suite markers: assumptions, `Function` snapshot, equivalence groups

**Status:** ready; defect.
**Witness:** corpus; Test-suite markers; CE-133.3 is the `grudnitski` equivalence benchmark (9 skipped groups); CE-133.1/.2 have no program (would be drop).

- **CE-133.1** Range and interval membership assumptions are not connected
  (`assumptions.test.ts`, `@fixme` setup lines).
- **CE-133.2** A malformed positional-parameter name `_1_0` in a `Function`
  snapshot (`functions.test.ts`).
- **CE-133.3** The `grudnitski.test.ts` equivalence benchmark has 9
  `describe.skip` groups (equation scaling and identity-based `isEquivalent`).

`test/playground.ts` tracks its own items (notation decisions, Iverson/Boole and
inequality → `Range` wishes, matcher internals).

### CE-135. `Subscript(a, k)` fuses to `a_k` and loses a binder-bound `k`

**Status:** ready; defect, low priority.
**Witness:** plausible; `Subscript(a, k)` inside a `Sum` over `k` fuses to `a_k` and loses the index binding.

`["Subscript", "a", "k"]` canonicalizes to the fused symbol `a_k`. When `k` is
an index bound by a binder, the binding is lost. A correct fix needs
binder-aware canonicalization: at fusion time the canonicalizer has no scope of
the enclosing binder. Workaround: the call form `["a_", "k"]` (the Fungrim
corpus uses it).

### CE-767. An asynchronous `Max`, `Min` or `Sum` of a `FlatMap` with an async-only callback stays unevaluated

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; `Max(FlatMap([1, 2], x ↦ [x, slowF(x)]))` under `evaluateAsync()` gives `Max(2, slowF(1), slowF(2))`, not 20. State: NOT STARTED.

`Max(FlatMap([1, 2], x ↦ [x, slowF(x)]))` under `evaluateAsync()` gives `Max(2, slowF(1), slowF(2))`, not 20. State: NOT STARTED. Found during the work of 2026-10-30 and 2026-10-31 (4b list); the
reproduction above is the record.

### CE-820. A closure stored under a declared signature reads the bindings of the scope that stores it

**Status:** ready; wrong value, S. A session that started the fix stopped on a
usage limit on 2026-11-06. Its partial fix (3 files, +125 −6:
`engine-declarations.ts`, a test file, a `CHANGELOG.md` item; not reviewed) is
in the worktree `/tmp/wt-cebatch-820` and in the patch
`~/.local/state/compute-engine-batches/2026-11-06T153903Z/CE-820-partial.patch`.
Read and verify it before writing a new fix.
**Witness:** plausible; with `h = n ↦ Block(g := z ↦ 0, z ↦ g(z) + n)`, `Declare(q, "(real) -> real", h(1))` and `q(0)` gives `1 + g(0)`, and should give 1. `k = n ↦ Block(Declare(g, "(real) -> real", h(n)), z ↦ g(z) + n)` and `k(1)(0)` gives "Recursion limit exceeded", and should give 2.

The same programs with the type `unknown` give the correct values, so the
declared signature causes the failure. The cause is not traced. The likely
cause is that the route for a declared signature in `engine-declarations.ts`
(`ascribeDeclaredParameterTypes()`, `reconcileFunctionLiteralReturn()`) builds
the literal again from its MathJSON, which drops the scopes that the closure
captured.

## Symbolic computation

### CE-613. `Limit` of `e^{√x}/x^5` at infinity gives 0 instead of `+∞`

**Status:** ready; defect, M. User decision 2026-11-05: option (c).
**Witness:** plausible; `lim e^{√x}/x^5` at ∞ gives 0, should be +∞.

`lim_{x→∞} e^{√x}/x^5` is `+∞`, and `lim x^5/e^{√x}` is 0; today they give 0
and `+∞`. The growth comparison of `symbolic/limit.ts` ranks `e^g` above every
power of `x` only when it proves `g → +∞`; `tendsToInfinity` has no rule for
`Sqrt` or `Root`, so the comparison falls back to samples at `x = 8, 30, 120`,
where `e^{√x}/x^5` still decreases (`numericGrowthCompare()`), and the
fallback answers 0.

A fix is written in the worktree `/tmp/wt-compute-engine-fb-ce613` (patch in
the session's scratch directory, not committed): `Sqrt`/`Root` in
`tendsToInfinity`, and `exponentialLevel()`, which ranks `b^g` above every
power when `g` grows like a positive power of `x`, or like `(ln x)^p` with an
exact degree `p > 1` (`logPowerDegree()`, exact `bigint` fractions). Three
review rounds each found a new wrong limit in the fix of the round before, all
of the same kind: when the rules cannot rank `e^g`, the sampled fallback gives
a definite answer that is wrong.

- Round 1: `e^{(ln(x+1))^2}/x^9` gave 0 (expected `+∞`).
- Round 2: a degree computed in doubles:
  `g = (((ln(x+1))^{11/10})^{11/10})^{100/121}` has exact degree 1, and
  `e^g/x^9` gave `+∞` (expected 0).
- Round 3: a float exponent is not read as a degree, so
  `e^{(ln(x+1))^{1.5}}/x^9` gives 0 (expected `+∞`).

Two more wrong limits of the same kind exist at HEAD: `e^{ln(x)·ln(x+1)}/x^9`
gives 0 (expected `+∞`; `tendsToInfinity` reads a product only from samples),
and two exponentials of the top growth level, such as `e^{√x}` against
`x·e^{(ln x)^2}`, are compared only by the samples.

Options:

- (a) Keep the structural analysis and read a float exponent as its exact
  binary value (`1.5` is `3/2`), then review once more. Each new form of `g`
  that the rules do not know still goes to the sampled fallback, which can
  answer wrongly.
- (b) Make the sampled fallback sound: when the rules cannot rank two terms,
  the limit is not decided from the samples at `x = 8, 30, 120`; it stays
  unevaluated (or the probes move out until the order of growth is settled,
  as in Gruntz's algorithm). Cost: some limits that the samples now get right
  stay unevaluated; the snapshot count is not measured.
- (c) Both: (a) for the known forms, and (b) for every other form.

Recommended: (c). (a) alone cannot remove the class of wrong answers; (b)
alone loses limits that the rules can settle. If nothing is decided, the
wrong value of the title stays.

### CE-141. `simplify()` does not reduce some exact definite integrals from Rubi

**Status:** ready; defect, small.
**Witness:** corpus; Integration-families benchmark audit lists 8 Rubi values `simplify()` cannot reduce; CE-141.3 is a question.

The report of `npx tsx benchmarks/audit/integration-families.ts` lists the exact
values that `simplify()` cannot reduce to the reference (8 of 578 runs on
2026-10-19). All 8 come from Rubi results:

- **CE-141.2** Rubi's value of `∫ (1+x²)/(x²+x⁹) dx` on `[1/b, b]` holds
  `Hypergeometric2F1` terms that cancel. `simplify()` has no rule that relates
  `₂F₁(1, 1/7; 8/7; −z)` to `₂F₁(1, 1/7; 8/7; −1/z)`.

- **CE-141.3** (question) `simplify()` of
  `\int_{-\infty}^{\infty}\frac{x^2-1}{(x-1)(x^4+1)}dx` returns the integral
  with a reduced integrand, not its value, while `evaluate()` gives `π/√2`.
  Decide whether `simplify()` evaluates a definite integral that has an exact
  value; if not, delete this item.

### CE-142. Some infinite sums and products give an unevaluated, wrong-shaped or inconsistent result

**Status:** ready; defect, small.
**Witness:** plausible; `\sum_{k=0}^\infty (-2)^k` simplifies to `~oo`; `simplify()` misses telescoping that `evaluate()` finds.

Each case also holds for the explicit `\sum_{k=1}^{\infty}` form. None gives a
wrong value. `evaluate()` and `.N()` now give the limit of a divergent or
vanishing infinite product of a rational body (`divergentInfiniteProduct()`,
`library/utils.ts`) and telescope a two-term body whose second term is not a
`Negate` (`telescopingParts()`); `simplify()` does not call either.

- **CE-142.3** `\sum_{k=0}^\infty (-2)^k` simplifies to `~oo` (complex
  infinity), while `evaluate()` leaves it unevaluated. The partial sums are real
  and oscillate, so `~oo` is not the right description.
- **CE-142.6** `\sum x^k`, with no subscript, is `Sum(x^k)` with no indexing
  clause, and it evaluates to `x^k` (the one-operand form reads a non-collection
  operand as itself). Check whether that is intended: `\sum_k x^k` (with an
  index and no bounds) runs over `k = 1..∞`.

- **CE-142.8** `simplify()` does not telescope and does not use the infinite
  product limit: `\sum_{k=1}^n (\frac1{k+x}-\frac1{k+x+1})`,
  `\sum_{k=2}^n(\sin(k+1)-\sin k)` and `\prod_{k=1}^\infty k/(k+1)` stay as
  written under `simplify()` while `evaluate()` gives the closed form.
  `simplify-sum.ts` never calls `symbolicSumClosedForm()`. Likewise
  `\prod_{k=1}^\infty(1+1/k^2)` stays unevaluated under `simplify()` while
  `evaluate()` gives `sinh(π)/π`.

### CE-143. The rounding margin of a float contour or integrand does not bound the pole position

**Status:** waits for user (design); design.
**Witness:** none; Soundness of the float margin for poles; no reproduction.

A float radius, center, vertex or integrand coefficient is read as the exact
value it holds, and the sum of the half-ulp rounding bounds of the replaced
floats is a margin: a pole closer to the contour than the margin is
`undetermined` (`symbolic/contour.ts`, `parseContour()`;
`symbolic/contour-integrate.ts`, `exactFloatLiterals()`). The margin is a bound
on the coordinates, not on the poles: the root of `a·z − b` moves by about
`|b/a²|` times the error in `a`, and a multiple root moves by a fractional power
of the error. The margin stops the last bit of a float from deciding a pole that
sits on the contour; it does not prove that a pole farther away than the margin
is on the right side. A strict bound needs a root-perturbation bound for each
polynomial factor.

### CE-148. A complex-valued function whose parts cannot be separated has no symbolic limit

**Status:** ready; capability, small. Issue #396. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #396.

`complexLimitAtPosInf` (`symbolic/limit.ts`) separates the real and imaginary
parts of a complex-valued function only for sums, products, quotients, integer
powers and the exponential. So `Limit(t ↦ t·Gamma(2 + i·t), ∞)` stays
unevaluated, although its limit is `0`; `.N()` gives a value near `0` for it.

### CE-153. Contour integration does not certify the complex roots of most polynomials of degree 3 or more

**Status:** ready; capability, small. PR #410. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with PR #410.

`ce.contourIntegrate()` needs every root of a denominator in exact form. For a
polynomial of degree 3 or more that is not even, it uses `solve()`, which
returns only the real roots. The pole set is then not certified and the status
is `unsupported`: `1/(z³ − 2)` and `z/(z⁷ − 1)` on `|z| = 2` stay unevaluated.
An attempt that wrote the roots of `zⁿ − c` as `|c|^(1/n)(cos θ + i sin θ)` gave
correct values, but took 1.2 s to 1.5 s for `n = 3` and reached the 5 s time
limit for `n = 5` and `n = 7`. Most of the time goes to the exact sign tests and
the Laurent expansions at points that contain `cos(2π/n)`. A fix needs a cheaper
residue at a simple pole of `h(z)/(zⁿ − c)`, which is `h(p)·p/(n·c)`, computed
before the Laurent kernel runs, and a measurement of where the remaining time
goes.

### CE-158. Definite integrals of `Abs` and `Sign`: undecided sign changes

**Status:** ready; capability, small. Issue #352. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #352.

A definite integral whose integrand has `Abs(u)` or `Sign(u)`, with `u` linear
or quadratic in the integration variable, is split at the points where `u`
changes sign, and each piece is integrated with `Abs(u)` replaced by `±u` and
`Sign(u)` by `±1` (`integrateAcrossKinks`, `library/calculus.ts`).

- **CE-158.2** When the position of a sign change relative to the bounds cannot
  be decided, the integral is not split. An antiderivative with a `Sign(u)` term
  that depends on the variable then leaves the integral unevaluated, because
  `F(b) − F(a)` includes the jump of that term if the sign change is between the
  bounds. Examples: `\int_2^a |x|\cos x\,dx` (it gave
  `\sin(a)|a| + \cos(a)\operatorname{sgn}(a) - 2\sin 2 - \cos 2`, correct for
  `a > 0` and wrong for `a < 0`) and `\int_0^1 |x - c|\cos x\,dx`. A conditional
  value (a `When` over the sign of `a`, or of `c`), or a use of the assumptions
  on `a`, would give these a value again.

### CE-168. Wester problems with no CE API: periodic decimals, real QE, matrix functions, tests

**Status:** waits for user (design); capability. Decision 2026-07-05: do not alias
Mathematica spellings.
**Witness:** none; Wester problems with no CE API.

These Wester problems have no CE API to express them, so they cannot be a
`test.skip`. Each needs a naming and design decision first; then its acceptance
test goes into `wester.test.ts`. The Mathematica→CE table is in
`docs/MATHEMATICA-NAMES.md`. Probe CE's own names before you add an item here:
many heads that seem missing exist under CE names (`NthPrime`, `NPartition`,
`PowerMod`, `ModularInverse`, `StirlingS1`, `Rationalize`, `PrimitiveRoot`,
`ContinuedFraction`, matrix ∞-`Norm`, `BaseForm`, finite-domain
`ForAll`/`Exists`).

- **CE-168.1** Repeating decimals, producer direction: an equivalent of
  `ToPeriodicForm` that renders an exact rational as a periodic-decimal object.
  The `repeatingDecimal` option of the LaTeX serializer covers only float
  display. (Repeating-decimal literals already box as exact rationals.)
- **CE-168.2** Quantifier elimination over ℝ. `ForAll`/`Exists` evaluate only
  over finite domains; the Wester and Liska–Steinberg stability problems need QE
  over real closed fields (CAD or virtual substitution). A major subsystem,
  listed for completeness, not planned.
- **CE-168.3** `MatrixExp` and general matrix functions (sine of a matrix).
  `Exp` of a matrix broadcasts element-wise (documented); it is not the matrix
  exponential.
- **CE-168.4** Symbolic singular values (`SVD` is float-only).
- **CE-168.5** Jordan and Smith normal forms.
- **CE-168.6** Hypothesis testing (`MeanTest` and others), not declared. Do it
  only if the statistics work needs it.

### CE-170. Rubi: integration coverage by chapter

**Status:** ready; capability. Rung history: `docs/rubi/RUBI.md` §5. Approved 2026-11-01.
**Witness:** corpus; Proposed Rubi coverage work with benchmark scores, no wrong results.

The shipped bundle (`src/compute-engine/rubi/rubi-rules-data.json`, through
`@cortex-js/compute-engine/integration-rules`) holds Chapters 1 (Algebraic), 2
(Exponentials), 3 (Logarithms), 5 (Inverse trig), 6 (Hyperbolics), 7 (Inverse
hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant and §8.8 Polylogarithm: 6,574
rules, 6.98 MB. CI checks that the bundle is up to date. The history of each
rung (R1 to R32: mechanism, score changes, dead ends) is in `docs/rubi/RUBI.md`
§5 and in Git history; it is not repeated here.

Scores (seed 5, s120 unless stated, 2026-07-12):

- 4.1 Sine 107/120 and 331/400 (file 4.1.11 93/113); 4.3 Tangent 72/120; 4.5
  Secant 69/120.
- Chapter 3 Logarithms 70/120.
- Chapter 5: 5.1 sine 65, 5.2 cosine 76 to 78 (the verify deadline makes it
  vary), 5.3 tangent 64, 5.4 cotangent 62, 5.5 secant 56, 5.6 cosecant 52 (at
  least 375/720, about 52 %; the 5.5 and 5.6 scores are older than the last
  re-runs).
- Chapter 7: 7.1 sine 79, 7.2 cosine 51, 7.3 tangent 85, 7.4 cotangent 95, 7.5
  secant 44, 7.6 cosecant 54 (408/720 = 56.7 %).
- 1.1 Binomial products 112/120; 1.1.3 General 185/200 (s200; the one unsolved
  problem, #259, is an integer-power rational); Chapter 1 exhaustive about 90 to
  91 %; Chapter 2 about 72 % effective (seed 42); Chapter 6 Hyperbolics 73/120
  (0 wrong); Wester indefinite integrals 6/8.

**Wrong results.** No suite has a genuine wrong result. Every flagged "wrong" is
a known false wrong of the verifier: numeric ₂F₁/AppellF1 grading at a
non-integer symbolic-exponent substitution, `√(sin²)=|sin|`, and the cube-root
or fractional-power branch at a negative x. Before you believe a wrong flag,
differentiate the antiderivative and compare at integer substitutions.

**Where the trig routing is.** The runtime part (`rubi-utils.ts`, `driver.ts`)
holds `deactivateTrig` (only x-free, linear or bare-monomial arguments become
inert; composite quadratic or √-inner arguments stay active for the substitution
rules), `cofunctionShift` (`sec → csc[θ+π/2]` and `cot → −tan[θ+π/2]`, both on
by default), `unifyInertTrig` and its cofunction product clauses,
`standaloneCosineShift`, `reciprocalToPower` (it does not apply under fractional
powers, for branch safety, and keeps reflection-produced `csc[·+π/2]` heads raw,
with a `(a+b·sec²)^p` exception that sends 4.5.7 to the sin/cos rules), and the
driver fallbacks. Each fallback checks its result (numeric evaluability or a
derivative check) and fails closed.

A/B environment switches: `RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`, `RUBI_NO_COFN`,
`RUBI_NO_COFN_COT`, `RUBI_NO_SKELETON`, `RUBI_NO_SICI`, `RUBI_NO_SICI_COMPLEX`,
`RUBI_NO_SECBIN`, `RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`, `RUBI_NO_TRIGSUB`
(subproblem trig bridge), `RUBI_NO_R25` (quartic-denominator ExpandIntegrand
guard), `RUBI_NO_R26` (rational normal form retry in the exp-substitution
fallback), `RUBI_NO_R27` (poly×trig product reduction), `RUBI_NO_R28`
(mixed-parity Laurent numerator × binomial radical linearity split),
`RUBI_NO_R29` (algebraic-in-hyperbolic `u = Sinh/Cosh/Tanh[v]` substitution),
`RUBI_NO_R30` (rational-in-hyperbolic cyclotomic-factored `t = e^v`
substitution), `RUBI_NO_R8` (poly×single-angle-hyperbolic → `y = e^w` PolyLog),
`RUBI_NO_R31` (nested-radical substitution, pre-filter
`hasNestedRadicalCandidate`), `RUBI_NO_R32` (Euler substitution
`t = √a·x + √Q`).

**Driver budgets.** The driver stops after a step budget (300,000 steps per
integral, `RUBI_STEP_BUDGET`), not after a time. Its two sub-searches (the
native rational fallback and the clean-up simplify) have their own step budgets.
What still depends on the clock is listed in the entry "Big-decimal coefficients
grow to thousands of digits in the polynomial GCD of a Rubi simplification".
`loadIntegrationRules(ce, { stepBudget, timeLimitMs })` is independent of a
`withTimeLimit` span: a heavy test must raise the loader budget and also set a
long enough span.

**Numeric zero tests.** Do not gate Rubi's `PossibleZeroQ` (`zeroQ`) or the
`PosAux` sign heuristic (`rubi/rubi-utils.ts`) on `.unknowns`. `.N()` resolves
symbolic identities with free variables that `simplify()` cannot see
(`(4-root b / 4-root a)^2 - sqrt(b)/sqrt(a)` numericizes to `0`), and a gated
`zeroQ` lost a closed form (integration-rules #544). The same applies to
`numericMagnitude` (`symbolic/solver-utils.ts`, used by
`symbolic/recurrences.ts`) and the rationalize-denominator test
(`symbolic/simplify-power.ts`): each keeps a bare `.N()` with a comment. The
rule for the gate in `boxed-expression/numerics.ts` (`numberLiteralOf()`,
`numericValueOf()`, `complexValueOf()`): use it only where "no numeric value"
sends the caller to its give-up branch. Do not cache `unknowns` for the gate:
the gate is 2 to 50 times cheaper than the `.N()` it replaces.

**Benchmark command.**
`npx tsx scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine" --sample 120 --seed 5 --report /tmp/x.json`.

- Always pass `--report`: the default path overwrites the committed baseline.
- `--rubi` mode preloads the Chapter 1/2/3/4.1/4.3/4.5/5/6/7/§8.8 foundation, as
  the shipped bundle does (`RUBI_NO_FOUNDATION` disables it). 4.1 baselines from
  before 2026-07-04 are not comparable.
- Run suites one after the other: concurrent runs change each other's driver and
  verifier timing.
- A `--rubi` target that is a Chapter 4 subsection (for example
  `.../4 Trig functions/4.1 Sine`) sets `corpusRoot` to the Chapter 4 folder, so
  no foundation loads and the score (58) is lower than the shipped §4.1 score
  (107, `loadIntegrationRules`). Measure Chapter 4 sections through the shipped
  bundle.
- After a change, `solved-correct` must go up while genuine `wrong` and
  `not-evaluable` stay 0.

**How to find the next change.** The "unimplemented-predicate" trace census
gives wrong priorities: the late catch-all rules (`FunctionOfTrigOfLinearQ`,
`TrigSimplifyQ`) are checked on nearly every unsolved problem but are not the
blocker. Count the actual rule-fail and inner-condition reasons, trace the
residual integrand, and use `wolframscript` to see Rubi's real chain:

```mathematica
Get["~/dev/rubi/Rubi-4.17.3.0/Rubi/Rubi.m"];
Trace[Rubi`Int[Cos[x]^4, x], HoldPattern[Rubi`Int[_, _]]]
Rubi`Private`DeactivateTrig[Cos[x]^4, x]   (* -> sin[Pi/2 + x]^4 *)
```

Open items, in priority order:

- Chapter 3 unsolved tail: 43/120 (s120 seed 5). 15 are expected `Unintegrable`
  (Rubi also returns them unevaluated, so CE's inert `Integrate` is correct).
  About 30 are deep. Family table: `docs/rubi/RUBI.md` §5 R19/R20.
  - **CE-170.1** Poly×log by-parts residuals that end in `∫artanh(√)/x`,
    symbolic-order-`k` `PolyLog` recurrences, or `ArcSinh·Log` (3.1.4, 3.1.5).
    The bundled Chapter 5 and 7 base cases do not reach these shapes. The lever
    is a symbolic-order `PolyLog` recurrence.
  - **CE-170.2** 6 problems `∫Log[Sin/Tan/Csc²]` (3.5). Two parts are missing: a
    `D` reduction for the inert trig heads (CE's `D` knows `Tan`, not the inert
    `tan` head that the driver carries), and a Chapter 4 foundation for the
    by-parts sub-integral (only 4.1, 4.3 and 4.5 are bundled).
  - **CE-170.3** 4 problems `∫Log[·]/rational` → `PolyLog[2]`; 3 problems
    `(a+b·Log[c(d+ex)ⁿ])^p × rational` with half-integer residuals; 4 problems
    with a fractional or negative power in the log argument →
    `Gamma`/`Ei`/`LogIntegral` with an `x^(2/3)` or `e/√x` substitution. All
    need new production rules or kernels, not more bundled rules.
- **CE-170.4** Deep half-integer and elliptic chains in Chapter 4.1: #53 (a
  23-step half-integer Fresnel chain), #248 (48 steps), and the composite
  `cot^m/(a+b·sin)^n` and `(a+b·sin²)^(p/2)` tan/cot-power recursions (4.1.1.3,
  4.1.7), which may fold into CE-170.5.
- **CE-170.5** `TrigSimplify`/`TrigSimplifyQ` (Pythagorean reductions). Low
  value: do it only if a concrete residual class needs it. One known member: #93
  (`csc^(−1/2)·sin` cancellation).
- **CE-170.6** A circular `TrigReduce` (multiple-angle elementary form) for
  `sin^n` products. The exp-form reduction works, but it verifies past the
  harness budget and takes precedence over trig-form rules in the whole chapter,
  so it is switched off.
- **CE-170.7** Hard cubic-and-higher x-denominator Si/Ci shapes decline (they
  stay unsolved, not wrong). The complex-argument
  `ExpIntegralEi`/`SinIntegral`/`CosIntegral`, negative-order incomplete Γ and
  `Shi`/`Chi` kernels exist (branch details: `docs/rubi/RUBI.md` §5 R18/R21).
- **CE-170.8** Chapter 5 residual: only the ₃F₂/`HypergeometricPFQ` terminal
  forms remain (the one `not-evaluable` row in each of 5.1 and 5.2 at s120 seed
  5 is such a form). They need a generalized ₚFq head, which CE does not have
  (out of scope). Chapter 7 has the same shape on a smaller scale, and the
  hyperbolic fallback covers it.
- Chapter 6 residuals (mostly shared capability):
  - **CE-170.9** Function-of-exp rows with a residual of degree 4 or more
    (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
    `Coth⁵/(a+b·Coth)`): the symbolic quartic-or-higher residual needs a real
    root finder. 7 more rows are expected `Unintegrable`.
  - **CE-170.10** Extend the shared linear-factor partial fraction
    (`expandRationalOverLinears`) to repeated roots (`Csch²`/`Coth²` →
    `(y−1)²(y+1)²`) and complex roots (`Tanh` → `y²+1`). #243, #408 and #455
    decline today; the change also reaches the similar trig rows of the
    single-angle trig-to-exp fallback (`singleAngleTrigExpFallback`).
  - **CE-170.11** By-parts machinery for rows whose numerator hyperbolic is a
    power in the additive denominator (for example `a+b·Sinh⁴`).
  - **CE-170.12** The bare `(a+b·Sinh²)^(3/2)` even-parity shape (EllipticE/F),
    the ₚFq row #518, and the `√(Sinh·Tanh)`/`√(Cosh·Coth)` quarter-power rows
    (6.7.1 #560/#563).

### CE-173. The simplification case of issue #189

**Status:** ready; defect. Issue #189.
**Witness:** corpus; Issue #189 names the simplification case.

`simplify-rules.ts` refers to a simplification case of issue #189.

### CE-175. A multi-index big operator with a dependent bound stays symbolic

**Status:** ready; defect, low priority.
**Witness:** plausible; `Sum(j, Limits(i,5,5), Limits(j,i,10))` stays symbolic; a dependent bound is an ordinary double sum.

`Sum(j, Limits(i,5,5), Limits(j,i,10))` canonicalizes intact but stays symbolic:
`classifyBigopDomain` reads the symbolic lower bound `i` as not enumerable. To
enumerate it, the multi-set walk must resolve dependent bounds again at each
iteration. This may be the same problem as CE-115.

### CE-781. `D` of a definite integral in another variable stays unevaluated

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Expected 1/2; differentiation under a definite integral is a one-line program.

Expected 1/2; differentiation under a definite integral is a one-line program. Found during the work of 2026-10-30 and 2026-10-31 (Item 15); the
reproduction above is the record.

## Numeric evaluation and special functions

### CE-600. An engine computes at the precision of the engine built last, not its own

**Status:** waits for user (design); defect (needs a design). Found 2026-10-28 while measuring why
`test/compute-engine/item-395-log-gamma-barnes-g.test.ts` took 38 s.
**Witness:** plausible; Two engines with different precisions in one host.

`BigDecimal.precision` is global to the module, and constructing an engine (or
setting its precision) writes it. An engine whose `precision` is 21 then
computes at the precision of the engine built after it: with a 3000-digit engine
built first, `LogBarnesG(0.7).N()` on a 21-digit engine takes 33 s instead of 4
ms (measured in a probe on HEAD `0904d0592`). The test file now restores the
global precision after each test, which hides the defect there only. Expected:
each engine evaluates at its own precision, whatever other engines exist.
Options to decide: each engine sets the global precision on entry to a numeric
evaluation (cheap, but a nested call of another engine and an asynchronous
evaluation can still interleave), or the precision is passed to the big-decimal
operations instead of read from a global (correct, a large change).
`ARCHITECTURE.md` records the current behavior as an API trap.

### CE-599. A double integral with an integrable isolated singular point gives `NaN`

**Status:** ready; defect. Found 2026-10-28 (the test "AN ISOLATED SINGULAR POINT
IN A DOUBLE INTEGRAL", `test/compute-engine/integrate-symbolic-pole.test.ts`,
accepts `NaN` or the value).
**Witness:** plausible; Interpreter gives `NaN` for a finite double integral of `1/r` around an interior point (about 1.9451).

`∫₀¹∫₀¹ ((x − 1/64)² + (y − 1/64)²)^(−1/2) dy dx` is finite, about 1.9451
(around the point the integrand is `1/r` and the area element `r dr dθ`). The
numeric evaluation returns `NaN`: the scan for moving poles finds the point, the
inner integral diverges on the two lines through it (a set of zero measure), and
`nIntegrateMultiple` (`library/calculus.ts`) then gives `NaN`. Expected: about
1.9451, for example by splitting the domain at the point, or a change of
variables around it, when the singular set is a point where the integrand grows
like `1/r^p` with `p` less than the dimension.

### CE-690. Rounding noise next to a singular bound stops the extrapolation of the corner shells

**Status:** waits for user (design); defect (accuracy); numerics. User decision
2026-10-30: record it as a design item. GitHub issue #494 (closed by the fix of
the infinite error, commit `fb5469f19`).
**Witness:** corpus; GitHub issue #494.

`N(Integrate(t ↦ cos(t/2)/√(cos t − cos ½), [0, ½]))` is
`2.2214414411509225 ± 0.0007` (true error `2.8e-8`); 0.170.0 gave
`2.221441469078394 ± 8.3e-12` (true error `7.9e-13`). In doubles,
`cos t − cos ½` cancels next to ½, so the integrand is noisy there. The corner
shells at ½ number 25 and 26 fail the accuracy test (relative errors `3.5e-8`
and `1.2e-7` against `SHELL_RELATIVE_ERROR = 1e-8`), and shell 27 passes it by
chance (`4.5e-11`). `extrapolateCorner()` (`numerics/endpoint-quadrature.ts`)
reads an accurate shell after an inaccurate one as a feature of the integrand
(`featureAfterShells`), and refuses to extrapolate. The rule exists for a step
next to the pole: `(x < 0.3 ? 0 : 1) + |x − c|^(−1/2)` with `c = 0.3 + 1e-6`.

The fix needs a test that tells rounding noise from a small feature. Two tests
were measured and rejected, on 900 integrals (a step or a bump of height 1,
`1e-2` or `1e-4` at 30 distances from 1e-3 to 1e-11 of a pole `(c − x)^(−1/2)`
at `c` = 0.3, 0.7, 1, 3.7, 1000.5):

- A second extrapolation, of the shells up to the last accurate one, compared
  with the first: it agrees for a step too, because the Levin transform reads
  the early shells, and the error of the inaccurate shell makes the tolerance
  wide. A step at `d = 1e-6` from 0.3 gave `± 2e-12` for a true error of `1e-6`.
- The extrapolation kept with its error enlarged by 10 times the errors of the
  inaccurate shells, used only when that is less than the error of the corner
  panels: 26 cases that are correct today got an error that is too small, all
  with height `1e-2` (`± 9.0e-11` for a true error of `1.1e-10`). The error of
  the shell that holds a small feature can be more than 10 times smaller than
  the area that the extrapolation leaves out.

A sound test could estimate the rounding noise of the integrand directly (the
change of `f` between neighboring doubles at the nodes of a shell, compared with
the smooth change), or compare the accurate shells after the inaccurate ones
with the shells that the model of the first shells predicts.

- **CE-690.1** (waits for a user decision) A quadrature result that did not converge and
  is next to a singular bound (`singularCorner`) reports at least
  `|estimate|/√mcSamples` (`integrateRealPart()`, `library/calculus.ts`): for
  the integral above, `± 7.0e-4` (`2.22/√10⁷`), although the error of the
  quadrature, which already covers the difference with tanh-sinh and the
  uncertainty of the corners, is `1.2e-7`. The floor exists because the error of
  a result that did not converge can be far too small. Options: (a) keep the
  floor (nothing changes); (b) do not apply it to a `singularCorner` result,
  after a measurement that shows its error covers the true error on the endpoint
  test corpus. With (b) the integral above is `± 1.2e-7`.

### CE-179. Under `.N()`, some uses of a parameter in a user-function body read the rounded argument

**Status:** waits for user (design); wrong value. User decision 2026-10-18: only the last
statement of a body gets the numeric request (option (a)).
**Witness:** crafted; Arguments such as `(25! − 1)/48` chosen next to a jump of `Floor`.

The exact re-read of a recorded argument (`exact-argument-source.ts`) handles a
parameter written alone as the operand of a jump function. The LAST statement of
a body with several statements gets the numeric request, so
`f := x ↦ Block(z := 1, Floor(x))` gives `f((25! − 1)/24!).N()` = 24. These
shapes still read the float bound to the parameter:

- **CE-179.1** A jump function of an expression of a parameter. With
  `f := x ↦ Floor(2x)`, `f((25! − 1)/48).N()` gives 25, where the correct value
  is 24. For `2x`, the recorded argument must replace the parameter before the
  exact re-read, and `subs` replaces by name without respecting binders, so this
  needs a substitution that respects them. Today `exactRealValueOf`
  (`constraint-subject.ts`) refuses an exact value that reads such a parameter,
  so the result falls back to the float instead of a wrong exact value. The same
  cause in a comparison: with `g := x ↦ Equal(x − 10^30, 1)`, `g(10^30 + 1).N()`
  gives `False`, because the float of `x − 10^30` is `0`, far from `1`, so the
  comparison never asks for exact values. Written without the function, the
  comparison gives `True` (its operand is an exact constant expression).
- **CE-179.2** A callback of `Map`, `Filter` or a comprehension. With
  `h := x ↦ Filter([1], k ↦ x < 25k)`, `h((25! − 1)/24!).N()` gives `[]`, where
  the correct value is `[1]`; `Map` and `Comprehension` read 25 for 24 in the
  same way. The elements are computed by the collection handlers, which receive
  no evaluation options, and a lazy `Map` view is computed after the activation
  has ended, so the recorded argument is gone. A fix needs a design for how a
  collection view keeps the numeric request (the one existing case is
  `lazyMapNumericApproximation`). `Reduce` has its own `.N()` rule for folds
  (`withExactFoldFallback`).
- **CE-179.3** An early `Return` in a statement that is not the last:
  `Block(If(x > 1, Return(Floor(x))), 0)` gives 25, exact 24. A fix needs an
  evaluation option that only `Return` honors, carried by `If`, `Which`, `Block`
  and `Loop` and removed by every inner function application, so that values in
  the middle stay exact.
- A jump in an earlier statement (`y := Floor(x); y` gives 25) is accepted by
  the decision of 2026-10-18.

### CE-181. `.N()` of a `k^{-p}` shell integral (`1 < p < 1.5`) at a nonzero or infinite bound is wrong

**Status:** ready; wrong value, small.
**Witness:** plausible; Textbook integral `∫_2^∞ dx/(x ln^{1.1} x)` gives a wrong value (wide error) for `10.3733`; CE-181.4 is "not a defect", drop.

Next to a bound at `0`, the part of the integral that cannot be sampled is
computed from a model fitted to the sampled shells (`shellTail`,
`numerics/endpoint-quadrature.ts`), so `\int_0^{1/2} \frac{dt}{t(-\ln t)^{1.1}}`
gives `10.37329 ± 0.00007` (exact `10.3733`).

- **CE-181.1** The same integrand at a nonzero or infinite bound still gives a
  wrong value: `\int_{1/2}^{1} \frac{dt}{(1-t)(-\ln(1-t))^{1.1}}` gives
  `3.40 ± 21.6`, and `\int_2^{\infty} \frac{dx}{x(\ln x)^{1.1}}` is in the same
  situation, both for the exact `10.3733`. There, a corner has fewer than 30
  accurate shells, too few to accept a model (a model needs 64), so the value
  stays the plain quadrature and only the error bar (which includes twice the
  fitted tail) is correct. One possible fix in `adaptiveQuadrature`: a change of
  variable that moves the singular bound to `0`, where about 1000 shells are
  available (the same change that CE-182 needs).
- **CE-181.2** `\int_0^1 x^{-0.9999}\,dx` reports `10000.00000 ± 3.5e-7` while
  the true error is `1.06e-6`: the ε-algorithm's estimate
  (`EXTRAPOLATION_SAFETY` times the difference of two orders) is too small by a
  factor of three there.
- **CE-181.3** `\int_0^{0.01} dx/(x(-\ln x)\ln^2(-\ln x))` reports
  `0.5028 ± 0.223` for a true error of `0.152` (covered, by the factor of two on
  the fitted tail).
- **CE-181.4** The comment at `SHELL_POWER_DIVERGENT` does not list the family
  of `\ln(-\ln t)/(t(-\ln t)^{1.1})`. That integrand converges (about `99.9`)
  but is reported divergent, because its exponent is below `1` at every depth a
  double reaches. This is a sampling limit, not a defect.

### CE-182. `.N()` of a `1/(x·ln x)` divergence at a nonzero bound or at infinity gives a finite value

**Status:** ready; wrong value, small.
**Witness:** plausible; Textbook divergent `∫_2^∞ dx/(x ln x)` gives `4.0 ± 1.5` under `.N()`; `evaluate()` gives `+∞`.

- **CE-182.1** `\int_2^\infty \frac{dx}{x\ln x}` gives `4.0 ± 1.5` and
  `\int_{1/2}^{1} \frac{-1}{(1-t)\ln(1-t)}\,dt` gives `4.0 ± 1.7`. Both are
  `+∞`, and `evaluate()` gives `+∞` for both. Next to `0` the quadrature can
  bisect about 1070 dyadic shells, which is enough for the power-law test
  (`shellsDecayAsPower`, `numerics/gauss-kronrod.ts`) to read the exponent of
  `1/k` shells as `1`. Next to a nonzero bound, or at infinity after the change
  of variable, the corner panel can be bisected only about 48 times. At that
  depth the estimated exponent is `0.87` for the divergent `1/(x ln x)` and
  `0.95` for the convergent `1/(x ln^{1.1} x)`, so no threshold separates them.
  A fix needs a deeper shell structure next to a nonzero bound (for example, a
  change of variable that moves the bound to `0`; see also CE-181).
- **CE-182.2** Two integrands that the test reports divergent get different
  verdicts: `(−ln t)^{-1.001}/t` gives `+∞` and `−t^{0.00001}/(t ln t)` gives
  `NaN`. The sign read of a detected divergence is not the same on the two.

### CE-185. A numeric integral next to a singular bound: remaining cases

**Status:** ready; defect, small.
**Witness:** plausible; CE-185.3: divergent `∫₀^½ dt/(t·ln t)` gives `-6.9 ± 1.6`; CE-185.1, .2, .6, .7 crafted and .9 no reproduction: drop.

`Integrate(f, x, a, b).N()` and `NIntegrate` (`integrateRealPart`,
`library/calculus.ts`) find the part of an integral next to a singular bound by
extrapolation of the shells of the corner panel, and check a converged result
against the tanh-sinh rule (`resolveSingularEndpoints`,
`numerics/endpoint-quadrature.ts`). The compiled `_SYS.integrate` and the levels
of an iterated integral (`nIntegrateMultiple`) do the same. These cases remain
(measured 2026-10-01):

- **CE-185.1** ∫₀¹ t^(−0.995)·ln t dt = −1/0.005² = −40000 gives `NaN` under
  `.N()` and `NIntegrate` with a COMPILED integrand: with 1500 panels the
  divergence test of the shells (`shellsDiverge`, `numerics/gauss-kronrod.ts`)
  reads it as divergent before the extrapolation runs. An integrand that does
  not compile (330 panels) gives `-39999.99995 ± 0.00025`.
- **CE-185.2** A pole with a large regular part at a NONZERO bound is not found
  by the quadrature: ∫₀¹ (1/(1 − t) − 10⁵) dt (`+∞`) gives a Monte-Carlo value
  such as `-99963 ± 32` under `.N()`, and ∫₀^{π/2} (tan t − 10⁴) dt (`+∞`) gives
  `-15676.4 ± 9.0`. `.evaluate()` gives `+∞` for both.
- **CE-185.3** ∫₀^½ dt/(t·ln t) diverges to `−∞` (`.evaluate()` gives `−∞`). The
  shells shrink like `1/n`, which the divergence test reads as convergent. The
  Gauss–Kronrod value differs from the tanh-sinh value and no extrapolation
  agrees, so its error is widened, and `.N()` gives `-6.9 ± 1.6` (the
  Gauss–Kronrod value, kept next to a singular corner that is not resolved,
  `singularCorner`). The model fitted to the shells (`shellTrend`,
  `numerics/endpoint-quadrature.ts`) gives the power `q = −1.0` for this
  integral and `q = −2.0` for the convergent `1/(t·ln²t)`: it declines the
  extrapolation, but does not report the divergence. A power `q ≥ −1` with no
  geometric decrease (`ρ ≈ 0`) could be reported as divergent.
- **CE-185.6** An oscillation in `ln(1 − t)` whose period is longer than the
  shells next to 1 is not found: ∫₀¹ sin(0.05·ln(1 − t))/(1 − t) dt has no
  value, but its 28 shells next to 1 have one sign and fit the model of a
  convergent series (`x^(−p)·lnᵠx`) to `7e-4` in logarithm
  (`SHELL_MODEL_RESIDUAL` is `1e-3`; convergent integrands measured fit to
  `3.2e-4`), and `.N()` gives `-19.99999999 ± 0.00000020`. With `0.1·ln` the fit
  is `8.7e-3`, and `.N()` gives `-18.7 ± 8.5`.
- **CE-185.7** Next to a bound of large magnitude, the corner panel reaches the
  spacing of the doubles after few bisections, and fewer than 12 shells are
  accurate, so no extrapolation is possible: ∫ (t − 10⁶)^(−0.99) dt = 100 on
  `[10⁶, 10⁶ + 1]` gives `20.31 ± 0.59` under `.N()`. For ∫ (t − 10⁶)^(−½) dt =
  2 the adaptive quadrature gives `1.9999772 ± 0.0000106` (true error 2.3e-5);
  the error reported by `.N()` (`± 0.00063`, the Monte-Carlo minimum) covers it.
- **CE-185.9** The compile-time fold price of a numeric integral
  (`FOLD_QUADRATURE_EVALS`, `compilation/base-compiler.ts`) covers the
  Gauss–Kronrod quadrature and the tanh-sinh check, but not the oscillatory
  quadrature of a semi-infinite interval (`integrateSemiInfiniteOscillatory`,
  `numerics/oscillatory-quadrature.ts`), which `integrateRealPart` and
  `_SYS.integrate` run first. It integrates up to 2000 lobes, each by adaptive
  Gauss–Kronrod with up to 256 panels (`LOBE_PANELS`), after a scan of up to 200
  000 steps for each zero, and when no value is found it runs the adaptive
  quadrature over the whole interval, so its worst case is far above the price.
  A typical run takes about 3e3 evaluations (∫₀^∞ sin x/√x dx: 3000).

### CE-186. Oscillatory integrals whose lobe sums have no period or converge slowly are `NaN`

**Status:** ready; capability, small. User decision 2026-10-04: until a method
gives a value, the result stays `NaN`; do not let these integrals fall back to
Monte Carlo. Issue #405. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #405; result is an honest `NaN` by user decision.

Both cases are in `integrateSemiInfiniteOscillatory`
(`numerics/oscillatory-quadrature.ts`). Monte Carlo gave wrong values with small
errors for them (`-0.033 ± 0.027` for `∫_{100}^∞ sin t·cos 3t/t dt`, true value
`-0.0019`; `0.072 ± 0.018` for `∫₀^∞ sin t·cos(√2·t)/t dt`, true value 0).

- **CE-186.1** Two frequencies whose ratio is not rational:
  `∫₀^∞ sin t·cos(√2·t)/t dt = 0` and `∫₀^∞ sin t·cos(√3·t)/√t dt` are `NaN`.
  The lobes of such an integrand have no period, so their sums are not
  accelerated by the ε-algorithm (the values move irregularly) or by the Levin
  u-transform of the sums of one period of lobes (there is no period). After
  2000 lobes, the routine returns `NaN` rather than a value with an error that
  is too small. `(sin t + sin(√2·t))/t` has a value after 2000 lobes, with an
  error of `6.8e-6`.
- **CE-186.2** A lower bound far from 0 with lobes that repeat a pattern: from
  0, `∫ sin t·cos 3t/t dt`, `∫ sin t·(2 + cos t)/t dt` and
  `∫ (sin t + sin 2t)/t dt` have a value. From `a = 100`, `1000` or `10⁴` they
  are `NaN`. The sums of their lobes converge as `1/k`, so the ε-algorithm does
  not find the integral, and they need the Levin u-transform of the block sums
  (`blockLevin`). Far from 0, the block sums decrease slowly in the index `j` of
  the block (as `(a/W + j)^(−2)`, with `W` the width of a block), the estimate
  of the exponent of the decrease is less than `LEVIN_MIN_BLOCK_DECAY`, and no
  Levin value is returned. `∫ₐ^∞ sin(t/2)·cos 2t/t dt` has a value from these
  bounds, because its ε values converge. A Levin u-transform with the index
  shifted by `a/W` was tried and not kept: for `sin t·(2 + cos t)/t` from `10⁴`
  its value was `1.8e-4` from the integral, with a range of its values of only
  `7e-8`.

A method that does not depend on the lobes is necessary. Possible methods:

- write the integral as `∫ₐ^X f + ∫_X^∞ f` and find the tail from an asymptotic
  expansion of `f`;
- accelerate the partial integrals `∫ₐ^X f` as a function of `X` (Sidi's mW
  transformation with a period of each frequency);
- when the integrand is a known product of sines and cosines, write the integral
  as the sum of the integrals of each frequency.

### CE-833. A numeric integral with a narrow peak at a bound gives 0

**Status:** ready; wrong value, M.
**Witness:** plausible; `\int_0^1 e^{-10^8 x} dx` gives `0` with `.N()`, and the value is `1e-8`.

`\int_0^1 \frac{e^{-10^8 x}}{x^{0.99}} dx` also gives `0`; the value is
`82.704`. Both results are exact zeros with no error. With the rate `10^6`,
the second integral gives `86.52 ± 0.12` for the value `86.602`.

`adaptiveQuadrature` (`numerics/gauss-kronrod.ts`) starts with 16 panels. The
node nearest to the bound `0` is at about `2.7e-4`, where `e^{-10^8 x}`
underflows to `0`, so every node gives `0`, the Gauss and Kronrod sums agree,
and the result is `0` with an error of `0` and `converged`. The test for a
feature hidden next to the end of a panel (`hiddenEdgeError`) does not sample a
bound of the integral, because the integrand can be singular there. A possible
fix: sample the integrand at a sequence of points that approach each bound
(`a + (b − a)·2^(−k)`), and bisect the first panel toward the bound while these
samples are not at the level of the nodes. `evaluate()` of the first witness
gives the exact value, so `.N()` could also use the antiderivative when the
quadrature result is `0`.

### CE-192. `Hypergeometric2F1` at machine precision has up to 3.7e-11 relative error

**Status:** ready; defect, small.
**Witness:** plausible; `Hypergeometric2F1(-6.937, -4.123, 4.354, -0.662).N()` has `3.7e-11` relative error at machine precision.

Measured against mpmath over 2100 points: the largest relative error, 3.7e-11 at
`a = −6.937, b = −4.123, c = 4.354, z = −0.662`, comes from the Gauss-series
branch, which accepts up to 1e6 of cancellation (`GAUSS_2F1_MAX_LOSS`); that
point does not use the connection-formula prefactors. Computing the Γ ratio of a
prefactor as one quotient through log-gamma differences was tried and is LESS
accurate (over 3000 random 4-tuples in [−8, 16]: direct product max 22.7 ulp,
mean 4.4; log-gamma differences max 97.8 ulp, mean 21.4), and the real `gamma()`
itself is up to 26 ulp off for negative arguments. A fix needs a more accurate
`gamma()` for negative arguments, or a tighter loss bound for the Gauss series
with another route for the points it then refuses.

### CE-206. Known numeric inaccuracies pinned in the tests

**Status:** ready; defect.
**Witness:** plausible; Interpreter inaccuracies pinned in tests: bignum `Arccos` near 1 loses about 8 digits, `ζ(−0.5)` 4 ulp off.

- **CE-206.1** Bignum `Arccos` near 1 loses about 8 digits (endpoint
  cancellation; a per-case skip in `mpmath-kernels.test.ts`).
- **CE-206.2** `ζ(−0.5)` is about 4 ulp off (the test tolerance is relaxed).
- **CE-206.3** One inexact `Multiply` case where the big-precision route is less
  accurate than the machine evaluation (`arithmetic.test.ts`, `@fixme`).

## Compilation

### CE-785. The compiler's stack limit for a nested expression fell from about 420 to about 370 levels

**Status:** ready; defect, S. User decision 2026-11-03: the nightly fall of the measured limit (first compile in a warm Jest worker) from 347 at `585acfab5` to 346 at `b10958fda` is accepted; it is not a new defect.
**Witness:** plausible; `test/compute-engine/compile-deep-nesting.test.ts` › "a chain of 350 sines and cosines compiles" fails in the full Jest suite (`success: false`) and passes when the file runs alone.

The compiler is recursive, so an expression nested deeply enough overflows
the stack and the compilation falls back to the interpreter. The test file
records limits of about 420 levels for a `Sin`/`Cos` chain after CE-320.2,
and sets the test depth at 350, about 20% below. At commit `4c55bdbee`
(and at `3ba729792`), a bisection with `npx tsx` outside Jest gives a limit
of about 370 levels. In a Jest worker that has run other test files, the
stack left is smaller, and 350 levels no longer compile. A polynomial in
Horner form nests two levels per degree, so a realistic expression reaches
this limit. Find which commit after CE-320.2 added frames on the path of
every operand (`compileExpr`, `_compileInner` and the reference analysis of
`compile-references.ts` are the recursive functions), and make those frames
smaller again, as CE-320.2 did, or change the recursion of the deep cases to
a loop. Then measure both limits again and update the comment of the test.

### CE-715. The `bigint` compile mode: the shapes it declines

**Status:** ready; capability. The mode `compile(expr, { mode: 'bigint' })`
on the `javascript` target computes integer values as JavaScript `bigint`
values (`docs/COMPILATION-MODEL.md`, "Compile modes"; spec
`docs/plans/2026-10-31-ce715-bigint-compile-mode.md`). The sub-items below
are the shapes that the mode declines (the expression then runs on the
interpreter), with a priority by how often each occurs (AGENTS.md: a decline
is a defect). Example: with `n: integer`, `DigitSum(n)` declines with the
diagnostic code `bigint-lane`. The reply to GitHub issue #503 is deferred by
the user.
**Witness:** corpus; Declines of the `bigint` mode, named for GitHub #503; check that #503 needs these shapes, else drop as declines.

- **CE-715.2** (medium) A rational `Range`/`Sum`/`Product` bound (`Sum(i, i = 1..n/2)`
  is `3` at `n = 5`).
- **CE-715.3** (high) Integer-typed heads not on the allow-list (`DigitSum`,
  `IntegerDigits`, `IndexOf`), boolean heads other than the comparisons and
  `IsPrime` (`IsEven`), and every string head, `String` included: the
  interpreter prints `String(n^2)` at `n = 10^15` as `"1e+30"`, and the
  JavaScript `String` of a `bigint` prints all the digits, so `String` needs
  a helper that prints as the interpreter does.
- **CE-715.4** (low) A binding typed `integer | infinity` as a lane input.
- **CE-715.5** (medium) A `bigint` output form for `broadcast()`,
  `broadcastAsync()` and the stored batch loaders.
- **CE-715.7** (low) The Python target's `Rational` lowering as an exact
  `fractions.Fraction`.
- **CE-715.8** (medium) Control and comparison shapes that the lane analysis
  declines in the first version (user decision 2026-10-31): `Piecewise` (its
  engine type is not a number type, so its branches need their own refined
  type), a chained comparison (`a < n < b`), a `Block` with more than one
  statement, an `If` with no else branch, and a `Which` with no final `True`
  clause. With `n: integer`, `Piecewise(…)` over integer branches runs on the
  interpreter in the mode today.

### CE-741. A complex argument to an untyped parameter that the body narrows to `real` gives `NaN` or a wrong value (JavaScript)

**Status:** ready; wrong value, M. Starts after CE-712.2 is committed: it
extends the per-call-site variant selection of CE-712.2. Plan:
`docs/plans/2026-10-31-static-shape-compilation.md`, rule R2.
**Witness:** plausible; `g := x ↦ If(x > 0, Mod(x, 3), x)`, `g(Sqrt(y))` at y = 16 gives 4 in complex/auto mode; interpreter 1.

With `y: real`, `f := x ↦ Mod(x, 3)` and `f(Sqrt(y))`, in mode `auto` (which
compiles again in mode `complex`) or `complex`, the compiled code gives `NaN`
for y = 16 and for y = 2.25; the interpreter gives 1 and 1.5. With
`g := x ↦ If(x > 0, Mod(x, 3), x)`, `g(Sqrt(y))` gives 4 for y = 16 (the
interpreter gives 1), because `0 < {re: 4, im: 0}` is false in JavaScript;
for y = −16 it gives `4i`, which is correct. `Floor`, `Ceil`, `Round` and
`Remainder` have the same defect, in a named function and in an inline
`Apply` of a function literal. `Max`, `Min`, `Abs` and `Sign` are correct.

Cause: `x` has no declared type, but canonicalization narrows it to `real`
(`inferredType: true`) from its use in `Mod`. `isComplexValued()`
(`compilation/compiler-core.ts`) therefore treats `x` as real, and the body
uses the real kernel with no guard, while the call passes a `{re, im}`
object. On JavaScript, `ensureSpecializedUserCallEmitted()` makes no variant
for a complex argument; only the shader targets make one.

Fix: an inferred type is not a declaration. Under rule R2, an untyped
parameter is compiled once per argument shape used at its call sites, and
the lane (a number or a `{re, im}` object) is part of the shape. Add the lane
of each argument (`isComplexValued(arg)` in mode `complex`) to the variant key
of CE-712.2, and give the variant's parameter the argument's type when the
parameter has no declared type. For a named function, the key is the list
`types[]` that the loop over the arguments fills in
`ensureSpecializedUserCallEmitted()` (`compilation/compiler-core.ts`); it
already has a `complexArgument` flag. For an inline `Apply` and a callback
literal, the types come from `literalWithParameterTypes()` and
`expressionParameterVariantTypes()` (`compilation/compile-callbacks.ts`). Then the guarded complex kernels apply. A
parameter declared `real` that receives a complex argument stays a lane
mismatch (rule R5). Tests: `Mod`, `Remainder`, `Floor`, `Ceil`, `Round`; the
`g` case at y = 16 and y = −16; a recursive function, whose recursive call
takes the variant of its own argument type; the named and inline forms.

### CE-722. A conditional that selects element by element and whose branch assigns a name is not compiled

**Status:** ready; documentation, small. User decision 2026-11-01: option (a),
the decline is the rule. Found 2026-10-31 during CE-712.1. The meaning of the
expression in the interpreter is a separate question, CE-739.
**Witness:** crafted; Ready with user decision 2026-11-01 option (a); remaining work is one example in `docs/COMPILATION-MODEL.md`.

With `L: list<real>` and `L = [-1, -2]`,
`Block(p ≔ 0, If(L > 0, p ≔ 5), 2p)` gives `0` in the interpreter. At HEAD
`e3ca9c1a6` the compiled JavaScript gave `10`: it ran the branch when any
element of `L > 0` was true. With `M: list<any>`,
`Block(p ≔ 0, If(M[1], p ≔ 5), 2p)` gave `0` compiled for
`M = [[True, False]]`, where the interpreter selects element by element and
gives `10`. CE-712.1 makes an `If` or a `Which` whose condition is or can be a
collection, and whose branch assigns a name or has a `Return`, a `Break` or a
`Continue`, decline with the code `'unsettled-shape'` on every target.

Decision 2026-11-01: the compiler keeps the decline. The value of `p` after
an element-wise selection whose branch assigns it has a shape that depends on
the run-time selection, so the static-shape rule (CE-712, R3) declines it
whatever the interpreter does. Remaining work: `docs/COMPILATION-MODEL.md`
gets this example in the list of declines that the static-shape rule requires
(with CE-712.5). If CE-739 later defines the meaning so that `p` has one
shape (for example, the branch runs when any element of the condition is
true, and `p` is a number), the compiler can emit that, as a new entry.

### CE-735. A compiled `Loop` ended by a `Break` with a value gives `undefined` on JavaScript

**Status:** ready; wrong value, S.
**Witness:** crafted; javascript; `Loop(If(x > 1, Break(3), Break(3)))` with `x: real` at 2; compiled `undefined`; interpreter 3.

With `x: real`, `Loop(If(x > 1, Break(3), Break(3)))` compiles to this code
(formatted):

```js
(() => {
  while (true) {
    if (_.x !== undefined) {
      if (1 < _.x) {
        break;
      } else {
        break;
      }
    }
  }
})();
```

At `x = 2` the compiled code gives `undefined`, and the interpreter gives `3`.
The emitted `break` drops the value of the `Break`. Fix: assign the value of
the `Break` to a result variable of the loop before `break`, and return that
variable after the loop.

### CE-646. Compiled `Contains`/`Unique` over lists of lists decline in any program that holds a lazy collection

**Status:** waits for user (design); enhancement (needs a design). Recorded 2026-10-30 when PR #500
(issue #499) landed in `f2c053f1e`. Not a regression: before that commit every
list-of-lists element was refused.
**Witness:** corpus; Names PR #500 and issue #499.

On the JavaScript target, `Contains`, `Element`, `Unique`, `RangeOf`,
`ContainsSequence`, `StartsWith` and `EndsWith` compare list elements by value
(`_SYS.eqs`). Compiled code lowers every collection to a plain array, but the
interpreter's `.isSame()` keeps a lazy view (`Map`, `Filter`, …) and a `Range`
other than an integer range with literal bounds apart from a list with the same
values. A lazy view stays unlisted when a callback returns it or passes on an
element of a literal unchanged:
`Contains(Map(e ↦ e, [Map(j ↦ j + 1, ys), [9]]), [2, 3])` gives `False`. Three
review rounds found a new gap in each rule for the safe positions of a lazy
node, so by user decision (2026-10-30) the lowering declines when the program, a
value it reads or a user function it calls holds any lazy collection or such a
`Range` (`mayMakeDistinctElement`, `compilation/javascript-target.ts`). So
`Map(k ↦ Contains(xss, k), xss)` evaluates in the interpreter. A design must say
where a lazy view can become a list element at run time (or list callback
results in the interpreter, which changes `.isSame()` results), with tests that
compare each case against `evaluate()`.

### CE-651. interval-js: a `Break` condition that compares an interval input with a number never runs

**Status:** ready; defect (wrong value). Found 2026-10-30 in the review of
CE-636. Also at HEAD `fee72a864`.
**Witness:** plausible; interval-js loop with `If(i > x, Break)` at `x = 2` gives the point interval 6; interpreter 4.

`Block(n ≔ 0; Loop(Block(n ≔ i; If(i > x, Break)), i ∈ 1..5); n + 1)` at
`x = 2`: the interpreter and Python give 4. `interval-js` gives the point
interval 6. In a `Loop` body, the statement-form `If` of the `Break` is emitted
as `if (_.x !== undefined && (_.x < i)) { break }`. On `interval-js`, `_.x` is
an interval object, so the JavaScript comparison `_.x < i` is always false and
the loop never stops early. Expected: the condition of a statement `If` on
`interval-js` goes through the interval comparison, and the compiler refuses the
loop when the comparison is not certain over the whole input interval, because a
loop cannot take both paths.

A library constant in the condition has the same cause:
`Block(s ≔ 0; Loop(Block(If(k > Pi, Break()), s ≔ s + k), k ∈ 1..5); s)`
gives the point interval 15 on `interval-js`; the interpreter gives 6. The
constant is hoisted as an interval object (`if (_k2 < k) { break }`), and the
JavaScript comparison of that object with `k` is always false. `ExponentialE`
gives the same result.

### CE-652. JavaScript, GLSL, WGSL: a `Sum`/`Product` bound that names the loop index reads the new index

**Status:** ready; defect (wrong value). Found 2026-10-30 in the review of
CE-636. Also at HEAD `fee72a864`.
**Witness:** plausible; `Sum(n, Limits(n, 1, n))` with an outer `n = 5` gives 1 on JavaScript; interpreter 15; GLSL/WGSL read the index too.

In `Sum(n, Limits(n, 1, n))` the upper bound `n` is evaluated in the enclosing
scope: it is the outer `n`, not the index. With
`Block(Declare(n); If(x > 3, n ≔ 5); Sum(n, Limits(n, 1, n)))` at `x = 5`, the
interpreter and Python give 15. JavaScript gives 1: the loop is emitted as
`let n = 1; const _upper = Math.floor(n); …`, so the bound reads the new index
(five template strings in `javascript-target.ts`). A lower bound that names the
index, `Limits(n, n, 10)`, becomes `let n = n`, which throws a `ReferenceError`
when the code runs. GLSL and WGSL emit
`for (int n = 1; n <= int(floor(n)); n++)`, which reads the index in the test at
each pass. Python and `interval-js` evaluate the bounds in the enclosing scope
and are correct. Expected: every target evaluates the bounds before the index is
declared, or gives the index a fresh name when a bound names it.

### CE-592. `compileFieldFunction()`: a user function that reads a parameter with an inferred integer type declines

**Status:** waits for user (design); defect (needs a design). Found 2026-10-28 in the review of
CE-591.
**Witness:** plausible; `a := 5; h(t) := t + a` makes `compileFieldFunction` decline with a remedy (declare `a`).

With `a := 5` and `h(t) := t + a` (or `A := (1, 2)` and `h(t) := t + A.x`),
`compileFieldFunction(h(x))` declines: the field function reads `a` from the
buffer as a real number, but the signature of `h`, and the result types that its
callers read, were derived when `a` was an integer. Accepting the wider type
only in the body of `h` is unsound: `Floor(h(x))` would drop `floor` because the
caller still reads an integer result. Today the decline names the remedy:
declare the parameter (`ce.declare('a', 'real')`,
`ce.declare('A', 'tuple<real, real>')`) before its first assignment. Expected:
the field compile derives again the signatures and the memoized call types of
the user functions that read a hidden parameter, and restores all of them,
including the captured-type snapshots of the checkpoint journal, on every exit
(`boxed-operator-definition.ts`, `call-result-type.ts`,
`checkpoint-journal.ts`).

### CE-216. A compiled power of a list that may hold points squares each entry of a square matrix

**Status:** ready; defect.
**Witness:** plausible; `p: list` (or `any`) holding `[[1,2],[3,-4]]`: compiled `p^2` is entry-wise, interpreter gives matrix power `[[7,-6],[-9,22]]`; wrong finite values (also .1, .2).

For a base typed bare `list`, `list<unknown>` or `any` (a type that may hold
points), compiled `p^2` gives the power of each entry. When the value is a
square matrix such as `[[1, 2], [3, -4]]`, the interpreter gives the matrix
power `[[7, -6], [-9, 22]]` (reproduced on `556ca8d7e`). Compiled code stores a
list of points `[(1, 2), (3, 4)]` and that matrix as the same array, and the
interpreter powers the points entry by entry, so compiled code cannot choose. It
keeps the entry-wise code, which plot code over point lists needs. Types that
cannot hold a point (`tensor<number>`, `list<list<number>>`,
`broadcastable<number>`) dispatch on the shape of the value. Fix: a compiled
representation of points that differs from a row.

- **CE-216.1** The same holds for `Multiply` since the change of CE-98: for
  operands typed bare `list`, `list<unknown>` or `any`, compiled `p·q` keeps the
  entry-wise product, while the interpreter gives the matrix product when both
  values are matrices. The same representation fixes both.
- **CE-216.2** With an annotated `h := (t: number) ↦ [t, 2t]`, `h(x)[1]^2`
  squares each cell where the interpreter gives the matrix power, following
  the type of CE-371. (The form with `x: any` declines since CE-712.1: an
  input typed `any` is refused.)
- **CE-216.3** `Dot(g(x)[1], [1, 1])` with `x: any` declines: the element may be
  a matrix or a list of points, which compiled code cannot tell apart (the
  interpreter leaves `[(1, 2), (2, 4)]·[1, 1]` unevaluated).

### CE-218. Compiled absence checks need a representation of `Nothing` distinct from `Missing`

**Status:** waits for user (design); capability. User decision 2026-10-20: keep refusing
omission-capable sources. Plan:
`docs/plans/2026-10-20-bare-tuple-record-any.md`.
**Witness:** corpus; Lifts refusals of `Nothing`-capable sources (Tycho 332).

`IsMissing(x)` and non-final operands of `Coalesce` refuse compilation when
their types admit `nothing`, including `any`, `nothing`, and unions such as
`integer | nothing`. The current target representations cannot tell an omission
(unit) result from an absent datum. Treating both as missing would break the
rule that `Nothing` passes through. Constant expressions may fold before this
check; a final fallback is returned without an absence test.

`Map`, `Filter`, predicate-form `Count`, `Covariance`, `PopulationCovariance`,
`Correlation` and the numeric aggregates (including the seeded `Multiply` fold
that represents `Product(collection)`) also refuse compilation when the source
element types admit `Nothing`. Single-source paired statistics inspect tuple
coordinates. Tuple slots and union alternatives are checked before their element
types can absorb omission. Data tuple construction and `Zip` refuse compilation
when coordinates may be `Nothing`. A `Map` with a broad result type compiles
when the callback body proves that every return path excludes omission; an
opaque callback result stays `any`, and an input type cannot stand in for it. So
an unconstrained `collection<any>` needs an annotation that excludes `Nothing`
(for example `list<real>`) to compile. Under the user decision, the unannotated
Tycho 332 and recursive gasket programs stay refused; their numeric collection
annotations compile and give the same 224 circles.

Separate decisions, not part of this item: structural conversion (`TupleFrom`
still omits an immediate `Nothing`), ordinary arguments, the unit/empty-tuple
type, and the capture of bindings (question Q11 of
`docs/plans/2026-10-20-bare-tuple-record-any.md`).

- **CE-218.1** A target that lifts the refusal must represent `Nothing`
  separately from `Missing`/`Undefined`/numeric absence, preserve it across
  inputs, intermediate values and results, and implement checks and fallbacks
  that leave it untouched. Cover interpreter/compiled parity and side-effect
  counts. Coordinate with the raw view representation and serialization of the
  plan above. This is a compiler capability, not a change to the omission
  policy. An unseeded `Reduce` over an empty list is `Nothing` in the
  interpreter and `NaN` when compiled (`Reduce([], Multiply)`), the stand-in for
  `Nothing` pinned in `compile.test.ts`.
- **CE-218.2** Tuple-call lowering can leave an unannotated pass-through result
  typed `any` even when the argument is a numeric tuple, so the tuple
  constructor refuses compilation. Annotating the parameter with its numeric
  tuple type restores compilation. A better proof here does not need a change to
  the slot policy, and must not treat omission as missing data.

### CE-233. Integer and string operators that the JavaScript target does not lower (Epsil corpus)

**Status:** ready; capability. Approved 2026-11-01.
**Witness:** corpus; Epsil corpus report counts declines from missing integer and string lowerings (`IntegerDigits` 7, ..); a corpus decline. State is proposed.

In the Epsil corpus report (`npm run epsil:corpus-report`, run of 2026-10-06),
46 of the 59 compile declines come from a missing lowering. Operators the corpus
uses that the JavaScript target does not lower, by number of programs blocked:
`IntegerDigits` 7, `StringSplit` 3, `Set` 3, `Simplify` 3, `Divisors` 2,
`UnicodeScalars` 2, `NumberFrom` 2, `N` 2, `DigitSum` 2, and one each of
`Iterate`, `IntegerString`, `Permutations`, `LinearSolve`, `FactorInteger`,
`PolynomialQuotient`, `Factor`, `Solve`. The symbolic ones are expected; the
integer and string ones are candidates for a lowering.

The other declines are typing refusals: `At` on a value not provably an indexed
collection, 4; `String`/`Characters` on a value not provably text, 5; a `Loop`
or `Sum` bound that is not a finite number, 4; multi-index `At`, 2; a `Find`
over an infinite range; a `Sort` of characters; a mixed-string ordering; a
`Filter` over a value that may be text.

### CE-244. A point argument with a complex-valued coordinate declines on the JavaScript target

**Status:** ready; defect.
**Witness:** corpus; 244.2: Tycho document `neyret/hpr2q4kles` declines where the interpreter gives 1.024; cause and fix are stated.

The emitted definition of a user function reads a point parameter's coordinates
as plain numbers, so a call whose point argument has a `{re, im}` coordinate
fails closed: "argument 1 is a point with a complex-valued coordinate, and the
emitted definition reads a point parameter's coordinates as real numbers". With
`k := i` and `p: (unknown) -> unknown`, `p(P) := P.x + k`, the forms
`p((x, 1)) + 1`, `\sum_{k} (k + p((x, 1)))` and a `Block` local `k` beside
`p((x, 1))` compile through the point-specialized definition.

- **CE-244.1** `\sum_{k=1}^{3} p((x, \sqrt{x-5}))` declines in both `auto` and
  `strict` mode.
- **CE-244.2** The Tycho corpus document `neyret/hpr2q4kles` declines where the
  interpreter answers 1.024:
  `P_0(M_0, D, d, e_0, a, T_0, r_0) = l(d_{iv}(r(M_0, -a) - C(D, d), A(e_0))) - (D + d) / 2`
  with `A(e_0) = (1, \sqrt{1 - e_0^2})` and `l(V) = \sqrt{V.x^2 + V.y^2}`. Under
  `auto`, the square root of `1 - e_0^2` (unknown sign) promotes to the complex
  kernel, so the inlined `d_{iv}` hands `l` a point with a `{re, im}`
  coordinate. The call fails closed
  (`compile-point-complex-coordinate.test.ts`).

For CE-244.2, two changes are necessary together: the inline substitution must
read through the return-type ascription that an inlined helper leaves around its
point (`Typed(PointList(…), '…')`), and the lane analysis of the enclosing
arithmetic must see the inlined body instead of the call node. Removing the
wrapper alone concatenated a string (`"-0.39[object Object]"`), because the
enclosing `Add` had analyzed the call as real. `isComplexValuedUserCall` already
reads the substituted body for a written-out point argument; extend it to the
ascription-wrapped case and make the substitution accept it.

A CE-only replica of the document (helpers declared with the signatures the
Tycho manager derives, then assigned; `x`, `y` declared `number`; the field
macro `U` written as `(x, y)`) declines the row `P((x, y), 0.47, …) = 0` at the
same `Add` under both point-parameter declarations (the three-arm union with
`indexed_collection<number | tuple<…>>`, and `tuple<…> | list<tuple<…>>`). Every
helper compiles with its point argument written out at the call; only
`P_0((x, y), …)` and `P_1((x, y), …)` decline, inside their bodies. So the
parameter union does not block this document.

### CE-249. Tycho corpus document `s8ishknvhe`: two rows still decline to compile

**Status:** ready; defect. Plan:
`docs/plans/2026-09-19-codegen-reassessment-ce1313.md` (item 3).
**Witness:** corpus; Tycho `s8ishknvhe`: `AsOklab(Hsv(57.29·PointX(A_rg(C)), 1, 0.5))` declines on javascript; 249.3 (no witness) is drop.

A broadcast head now reads a list that mixes complex and real cells, and the
compiled complex arithmetic of the JavaScript target answers a pole as the
interpreter does. The stereographic projection of the document (audit record 146
of `/private/tmp/ce-codegen-reassessment-0919/ce-0.131.3-targeted.json`)
compiles when its point list `C_c` is declared
`list<tuple<number, number, number>>`.

- **CE-249.1** and **CE-249.2**: the repro `Hsv(57.29·PointX(A_rg(C)), 1, 0.5)`
  with `A_rg(p) := (Arg(p.x + i·p.y), Arccos(2·p.z − 1))` compiles on
  `javascript` in `mode: 'complex'`, `'auto'` and `'strict'`, with `C` declared
  `list<tuple<number, number, number>>`, undeclared, or declared
  `broadcastable<tuple<broadcastable<number>, …>>`. For `C` = three points the
  compiled colours equal the interpreter's. A `PointList` component typed
  `list<number> | number` compiles with one entry dispatch.

  What still declines on `javascript`:
  `AsOklab(Hsv(57.29·PointX(A_rg(C)), 1, 0.5))`, with the same `C`: "a color
  conversion over an operand that may be a collection at run time and whose
  type does not prove a color at every element position". The interpreter gives
  a list of three `Oklab` values. `AsOklab(Hsv(H, 1, 0.5))` with `H: list<real>`
  compiles, and `Hsv(57.29·PointX(C), 1, 0.5)` has the type `list<color>`, so
  the decline comes from the type of `Hsv(… A_rg(C) …)`. Not traced.
- **CE-249.3** The other targets were not examined at a pole. The shader targets
  and the Python target have their own complex division and power. Python raises
  `ZeroDivisionError` for a complex division by zero; the shader result is
  whatever the hardware answers for `0.0 / 0.0`. The kernels of the JavaScript
  runtime were checked at an exact zero argument only, which is the one pole a
  floating-point argument reaches exactly.

For Tycho, not a Compute Engine defect: `Min(1, L)` with a list `L` is a
REDUCTION in Compute Engine (it answers one number, interpreted and compiled),
so the saturation and the value of `c_f` are one number for the whole cloud. If
Desmos evaluates `min(1, L)` element by element, the conversion of that row
needs an element-wise form.

### CE-568. CSE: share a pure call across the statements of a `Block`

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Proposed performance idea names Tycho `hyvhlz4chj` but no measured cost.

Each statement value of a `Block` is its own CSE region, so a pure call repeated
in two statements is computed once per statement. Tycho `hyvhlz4chj`: the body
of `f_Bm` (a Desmos `with` lowered to a `Block` of two statements) calls
`p_rand(n + s_eed, n, n)` in both. Sharing across statements needs the temporary
to be bound before the first statement and to stay valid across any assignment
the statements make to a symbol the call reads.

### CE-253. `Sum(At(P, Range(a, b)))` materializes the range on the JavaScript target

**Status:** ready; capability. Approved 2026-11-01.
**Witness:** corpus; Proposed optimization counts 24 corpus `Array.from` sites but no measured cost and no wrong value.

The 24 `Array.from` range sites in the corpus are all places where the range is
needed as a list (7 gather indices, 15 spread elements, 2 broadcast operands);
no site needs only a counting loop. The 7 gather sites need a gather/reduce
fusion in `emitCollectionReduce` (`javascript-target.ts`), which is a new
lowering.

### CE-264. Clause sets that dispatch on `infinity`, `nan` or `non_finite_number` do not compile

**Status:** waits for user (design); capability.
**Witness:** crafted; `g(1/w - 1/w)` with an `infinity` clause; the set declines today.

Compiled float arithmetic does not keep a pole. The interpreter's `~oo - ~oo` is
`~oo`; compiled, it is `Infinity - Infinity`, which is `NaN`. So a guard on a
produced value asks a different question than the interpreter. Example: with
`g(a: infinity) = 1; g(x: number) = 0`, compiled `g(1 / w - 1 / w)` at `w = 0`
answers 0 where the interpreter answers 1. `jsClauseParamGuard`
(`src/compute-engine/compilation/base-compiler.ts`) therefore declines the whole
clause set for those tiers and for the non-finite VALUE types, and the set runs
interpreted (pinned in `test/compute-engine/multi-clause-compile.test.ts`).

A change to the guard does not fix this (measured 2026-08-30). Compilation needs
either a float encoding in which a pole stays a pole through arithmetic, or a
compiler that never folds a pole into a plain JavaScript number.

### CE-269. A DAG-shared symbol value above the fold-size guard does not compile

**Status:** ready; capability, low priority. Approved 2026-11-01.
**Witness:** corpus; Tycho census: four terrain triangle rows of `art/nxlddeh5zv` decline at the fold-size guard; a corpus decline.

On the `javascript` and `interval-js` targets, a symbol's compound pure value is
emitted once as a preamble local (`ensureFoldedValueEmitted`,
`base-compiler.ts`). The inline targets (Python) still fold a value into the
emission at each reference, so `MAX_FOLD_EXPANDED_NODES = 20 000`
(`expandedFoldSize` / `assertFoldableSize`, `base-compiler.ts`; fail closed by
decision 2026-08-23) refuses a pathological DAG-shared tower there. The public
`fallback: true` route falls back to interpreted evaluation; the direct
registered-target route throws (pinned in `compile-fold-size-guard.test.ts`).

- **CE-269.1** Inline targets: add the same preamble binding, or a
  runtime-binding channel (a `_SYS` engine-value lookup) so a compiled member
  does not fall back. Tycho's ledger prefers the runtime-binding channel. Tycho
  states no urgency: it now binds document functions as by-reference lambdas,
  and the item-225 witness (`art/nxlddeh5zv`) no longer runs out of memory, but
  its interpreted member sweep still takes more than 300 s on the fallback.
- **CE-269.2** Sharing INSIDE one symbol's value, on every target. The preamble
  binding is per SYMBOL. Tycho publishes the height map of that document with
  the helper bodies substituted (measured 2026-09-16 on Tycho `03ebe4fc8`): the
  value of `h_eightMap` is one expression of 236,663 distinct nodes, in which
  the dozen reads of each level share the argument of the level below; as text
  it is 25 billion nodes, and `b_ase` holds no value. On the JavaScript target
  the four terrain triangle rows decline at the guard (census 2026-09-16).
  Evaluating the closed value first does not help: at size 64 the literal is
  8,192 points, above the guard alone. Fix: a runtime-binding channel for a
  symbol value, or a binding per node for each sub-expression with several
  parents.

### CE-270. Compile declines in the code-generation census of CE 0.171.0

**Status:** ready; capability. Plan:
docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md (§9). Approved 2026-11-01.
**Witness:** corpus; Census of 0.171.0 on the Tycho corpus lists declines per target (270.1 to 270.4); corpus declines.

Declines (distinct records) per target on the all-states Tycho corpus, CE
0.171.0, measured 2026-10-27 (757 documents, 17,782 records): javascript 35 in
28 documents, glsl 68 in 36, interval-js 89 in 39. At CE 0.128.13 (2026-09-16,
734 documents) they were 112 in 38, 148 in 55 and 188 in 66. Run:
`npx tsx scripts/audit-ce-codegen.mts --all` in Tycho. Open candidates:

- **CE-270.1** JavaScript scalar arithmetic over a list-valued operand: 5 rows
  in 3 documents (was 33), all a point list plus a scalar or a list index
  (`0.7C[C_i] + A`, `Q(T) + \frac{1}{3}[\operatorname{PointList}(0,0), D]`)
  (CE-268).
- **CE-270.2** GLSL `At` over a collection with no static length: 12 rows in 7
  documents (was 32).
- **CE-270.3** GLSL `Integrate`: 1 row (was 15).
- **CE-270.4** interval-js rows over a collection: 14 rows in 5 documents (a
  condition that may be a list, a seeded `RandomChoice` list, a `Which` over a
  collection condition, an absent position) (CE-240).

Other classes in that run: GLSL recursive user functions (9 rows), GLSL constant
collections over 256 elements (7), interval-js ordering over a complex operand
(20), interval-js operators with no lowering (27 rows: `Mandelbrot`, `Julia`,
`GeometricVector`, `D`, `Range` in a comprehension source, `Real`), and the rows
of CE-564. `D`, `PointList` and the complex rows on the interval target are
design limits, not candidates.

### CE-272. Element-wise `Which` over fixed-size collections declines on `glsl` and `interval-js`

**Status:** ready; capability. Tycho item 206.
**Witness:** corpus; 272.2: Tycho `5qn5kcrszu`, 6 javascript records decline (Tycho item 206); 272.1 (no witness) and 272.3 (zero demand) are drop.

The evaluator broadcasts `Which` element-wise over collection-valued operands,
and the `javascript` target lowers the same shape (`compileJSSelection`,
`javascript-target.ts`). The `glsl` and `interval-js` targets fail closed: the
interval target holds one interval per quantity (no collection values, by
design), and the GPU element-wise selection (`compileGPUSelection`,
`gpu-target.ts`) lowers only static `vec2`–`vec4` shapes.

The pre-pass `fixed-width-unroll.ts` covers part of this (pinned in
`test/compute-engine/compile-elementwise-selection-unroll.test.ts`). It pushes a
literal index through a `Which`/`If` whose first condition is a list, and on
through the ordering relations, `Equal`/`NotEqual` against a scalar, `Mod`, the
other element-wise heads and a literal `Range`, down to the literal list. It
also writes a `Which`/`If` whose first condition is a WIDE list built from
non-constant lists (five or more elements, at most 64) as the list of its
per-position selections. This covers `ccoc40kfhj` (24 `interval-js` records).

- **CE-272.1** A selection with no default clause and a point arm is not
  covered: a position that no clause selects is `NaN` element-wise but `Missing`
  for a scalar selection.
- **CE-272.2** A `Which` in statement form inside a lambda that the pass does
  not enter (`5qn5kcrszu`, 6 `javascript` records).
- **CE-272.3** Tycho's Voronoi second-minimum idiom
  (`Min(Which(d == m, 10^9, True, d))`, with `d` a broadcast expression over a
  20-point `PointList` literal): its condition is built from a list of POINTS
  (`|P − (x, y)|`), and the width walk reads lists of scalars only. The
  `javascript` target compiles this shape and gives the correct second minimum,
  so the urgency is low. Tycho measured zero demand on 0.116.1 after a fix on
  its side.

The general design is target-independent: a static broadcast unroll before
target lowering. When every collection leaf in the `Which` clauses is statically
enumerable (materialized `List`/`PointList`/`Range` literals) with one common
length N, project the broadcast expression per element and rewrite to N scalar
selections. `compileGPUExtremum` already folds compile-time component lists of
any length, and the interval `Min`/`Max` handlers fold n scalar arguments. The
projection must fail closed when a collection subterm is not statically
enumerable, when lengths disagree, or when an index-sensitive operator (`Sort`,
`Unique`, …) sits between the leaf and the selection.

Caution: on `glsl`, `Power`/`Square` of a vec operand with a scalar exponent
fails closed on its own (`_gpu_powi` is scalar-only, and the `pow` builtin
requires matching genTypes), pinned in
`test/compute-engine/compile-gpu-shape-gate-holes.test.ts`. Unrolling to SCALAR
selections avoids it; a design that lifts the vec-width cap meets it.

### CE-280. Compile-target coverage: heads and shapes that decline on GLSL and WGSL

**Status:** ready; capability. Ledger: do one sub-item per session. Approved 2026-11-01.
**Witness:** corpus; 280.1: GLSL `Integrate` declines on a corpus row (1 row in CE-270.3), direction decided 2026-10-17; other sub-items drop (no witness; 280.9 allowed).

A decline on a shader target demotes the row from GPU to CPU. Counts are from
the same Tycho corpus as the JavaScript coverage ledger.

Width ceiling, accepted by CE and the consumer: an expression-level shader value
is a vec2 to vec4, so rows of arbitrary width (a 10-curve family, a 900-element
board) have no `vecN` to live in. The consumer handles that with instanced
draws. If profiles ever justify one shader body for such rows, the ask is
array-uniform loop codegen, and it needs witnesses first.

- **CE-280.1** `Integrate` on glsl: quadrature inside a shader (22 states in the
  0.99.0 census). Large. A design pass must come before implementation. User
  decision 2026-10-17 on the direction: a fixed composite rule with an error
  estimate, and `NaN` on non-convergence. A shader quadrature whose error
  estimate is too large gives `NaN`, as the other GPU special functions do. The
  iteration budget is still to decide. Until then, `\int_0^x t^2 \sin t\,dt`
  with `to: 'glsl'` declines.
- `At` on GPU: the scalar-index and literal-gather tiers over statically-sized
  numeric bases are done. The design and the D4 disposition table are in
  `docs/COMPILATION-MODEL.md`; do not derive the table again. Do not retire the
  26-state count until the consumer measures again. Remaining, on demand:
  - **CE-280.2** Static-count dynamic gather (near-zero cost: the same helpers
    in a constructor; a witness count was requested from the consumer).
  - **CE-280.3** Gather with K > 4 (width ceiling).
  - **CE-280.4** Gather with K 0 or 1 (the pinned 1-element-list contract has no
    shader shape).
  - **CE-280.5** Dictionary, string-key and multi-index forms.
  - Not work: runtime-valued boolean masks (the result length is not static, so
    there is no shader value shape) and bases or index lists of unknown length.
- `PointList`/`PointZ`: rules in `docs/COLLECTIONS-MODEL.md`. GPU construction
  stays fail-closed by decision (no runtime-length GPU expression values).
  Remaining, all on demand:
  - **CE-280.7** Components that are not `isListType` (tuple, set, a union with
    a collection) still decline on JavaScript. The lowering is narrower than the
    typing on purpose: such a slot has no per-point representation.
  - **CE-280.8** `hasPointElementType` (`collections.ts` ~684) accepts only
    `{kind:'tuple'}` nodes, not the bare `'tuple'` string (same family as the
    tuple component of `PointList`, refused since 2026-10-18).
  - **CE-280.9** Projecting an EMPTY point list diverges: compiled `[]`,
    interpreter absence. The evaluated empty transpose types `list<never>`, so
    the point-ness cannot be recovered. Pinned as a known parity edge in
    `pointlist-compile-zip.test.ts`.
  - The consumer must count again how much of the 11 states / 36 members + 2
    states closed. Do not mark this bucket resolved on CE numbers.
- **CE-280.10** Complex-element collections in the generic shape check.
  `gpuOperandShape` reads a list of complex elements as `scalar` (through the
  operand fallback of `isComplexValued`), so the generic check
  (`gpuIsComponentwise` / `gpuOperandShape` / `gpuCheckOperandShapes`) has no
  effect for them. The unary fan-out declines them explicitly; the generic
  codegen needs its own complex-element rule.
- Not a gap: a loop-form `Sum`/`Product` inside a conditionally evaluated arm
  stays fail-closed (7 members / 1 state). GLSL's `?:` short-circuits, so
  hoisting a loop out of an arm that it never feeds would shift every later
  `Random()` draw in the shader. The other option (an `if`/`else` lowering with
  a temporary) needs a second witness; the count is one.

### CE-770. Python: `Apply((x, y) ↦ x + y, L, 3)` with a list `L` raises `TypeError` instead of mapping

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Interpreter maps over `L`; a throw where the interpreter gives a list is not an allowed difference.

Interpreter maps over `L`; a throw where the interpreter gives a list is not an allowed difference. Found during the work of 2026-10-30 and 2026-10-31 (Item 6); the
reproduction above is the record.

### CE-771. `(s ↦ Length(s))(t)` with `t: string` throws `RangeError` on JavaScript

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Interpreter gives 3, `Length(t)` alone compiles; file says it is well-typed and stays a defect.

Interpreter gives 3, `Length(t)` alone compiles; file says it is well-typed and stays a defect. Found during the work of 2026-10-30 and 2026-10-31 (Item 12); the
reproduction above is the record.

### CE-777. Compiling `Block(If(x < 1, b ≔ 1, b ≔ 2); b)` declares a global `b`

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Compilation changes the engine's scope; a two-line program.

Compilation changes the engine's scope; a two-line program. Found during the work of 2026-10-30 and 2026-10-31 (Compiling `Block(If(x < 1, b ≔ 1, b ≔ 2); b)` creates a global `b`); the
reproduction above is the record.

### CE-810. WGSL: an `And` under an `Or` is emitted without parentheses, which WGSL does not parse

**Status:** ready; defect, S.
**Witness:** plausible; with `x: real`, `y: real`, the plot condition
`3 < y < x or x < 5` (`Or(Less(3, y, x), Less(x, 5))`) compiles to WGSL as
`(3.0 < y) && (y < x) || x < 5.0`; WGSL needs `((3.0 < y) && (y < x)) || x < 5.0`.

The WGSL grammar gives `&&` and `||` no precedence over each other: a
`short_circuit_or_expression` cannot hold a `&&` operand without
parentheses, so `a && b || c` is a syntax error. The emitted string has not
been run through a WGSL compiler. The GPU targets share the precedence
table of `src/compute-engine/compilation/gpu-emit.ts` (And 4, Or 3), which
follows the C rule that `&&` binds more tightly than `||`; that rule is
correct for GLSL. `Or(And(3 < y, y < x), x < 5)` gives the same string
without the inner parentheses. The same applies to an `Or` under an `And`.

Fix: on WGSL, put parentheses around an `And` operand of an `Or`, and an
`Or` operand of an `And`, including the conjunction that a comparison chain
lowers to (`compileExprOperator()` in `compile-operators.ts`).

### CE-779. GLSL: a `list<real>` input compiles to a bare name and reports success instead of declining

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Shader code that no shader can declare, reported as a success; it must decline.

Shader code that no shader can declare, reported as a success; it must decline. Found during the work of 2026-10-30 and 2026-10-31 (Item 4); the
reproduction above is the record.

### CE-783. JavaScript: `Apply(D(x ↦ sin(nx), x), 1)` throws "is not a function"

**Status:** ready; defect. Approved 2026-11-01.
**Witness:** plausible; Interpreter gives a value; "not compared with HEAD", and F41 (`c12544982`) changed this code: probe first.

Interpreter gives a value; "not compared with HEAD", and F41 (`c12544982`) changed this code: probe first. Found during the work of 2026-10-30 and 2026-10-31 (§5.8b); the
reproduction above is the record.

## LaTeX parsing and serialization

### CE-829. `N_n := n + 1` replaces the library function `N` for the whole engine

**Status:** ready; wrong value.
**Witness:** plausible; after evaluating `N_n\coloneq n+1`, `N(1/4)` gives `5/4`; it gives `0.25` before.

A sequence definition with a symbol index on a library function name is read by
step 2 of `parseAssignStatement()` in `latex-syntax/dictionary/definitions-core.ts`,
before the check for an assignment to a library function, and the evaluation of
`Assign(Subscript("N", "n"), …)` defines `N`. `\operatorname{Add}_n\coloneq n` does
the same (`Add(1, 2)` then gives `unexpected-argument`). `N_0\coloneq 1` alone does not
change `N`, and `N_n\coloneq 5` as a statement of a block declares the local `N_n`:
both must stay valid. The first statement of a block and a row of a `cases`
environment are read before the parser knows that they are in a block, so the error
needs the same two readings as `n_{k}\coloneq 5` on a list. The user decision of
2026-11-06 for CE-826 (a library function cannot be replaced by a LaTeX assignment)
applies, and the error code is `assignment-to-library-function`.

### CE-441. The LaTeX of a rest parameter or a destructuring parameter does not read back as that parameter

**Status:** waits for user (design); defect.
**Witness:** plausible; `((x,y)\mapsto xy)((3,4))` changes value through a LaTeX round trip.

The `Function` serializer (`definitions-core.ts`) writes the parameter as a
plain operand, and the parser has no notation for either form:

- A rest parameter, `["Function", ["Multiply", 2, "x"], ["Spread", "x"]]`, is
  written `\mathrm{Spread}(x)\mapsto2x`. Parsing it gives
  `["Sequence", ["Spread", "x"], ["Error", "'unexpected-operator'", …]]`.
- A destructuring parameter,
  `["Function", ["Multiply", "x", "y"], ["Tuple", "x", "y"]]` (one parameter, a
  pair), is written `(x,y)\mapsto xy`, which parses as the function of TWO
  parameters `x` and `y`. So the round trip changes the value of a call:
  `((x,y)\mapsto xy)((3,4))` evaluates to `12`, and the expression parsed from
  that LaTeX evaluates to the function `(_) => (3 * _, 4 * _)`.
- A parameter with a default value (CE-717),
  `["Function", ["Multiply", "x", "k"], "x", ["Optional", "k", 2]]`, is
  written `(x, k=2)\mapsto kx`. Parsing it gives
  `["Sequence", ["Tuple", "x", ["Equal", "k", 2]], ["Error", "'unexpected-operator'", …]]`
  (recorded by `test/compute-engine/parameter-default-values.test.ts`). The
  parser should read `k=2` in a parameter list as `["Optional", "k", 2]`.

Options: (a) write the destructuring parameter with a second pair of
parentheses, `((x,y))\mapsto xy`, the Epsil spelling, and teach the parser to
read it as one pattern parameter; write a rest parameter `x\ldots\mapsto` or
`\ldots x\mapsto` and read it back; (b) write these literals as
`\mathrm{Function}(…)` with their MathJSON operands, which the parser already
reads. Without a decision the LaTeX of such a literal stays lossy.

### CE-291. `\int dx` is a parse error, and the `d` of `\int \frac{dx}{x}` is reported undeclared

**Status:** ready; defect. `\int dx` parses to `Integrate(1, x)`, and a `d` is
pruned from the report of free symbols only where the integration variable
follows it directly (`dx`), so a free variable named `d` is still reported.
**Witness:** plausible; `\int \frac{dx}{x}` with `diagnostics: true` reports an undeclared symbol `d`.

- **CE-291.2** With `diagnostics: true`, the `d` of a differential inside a
  fraction (`\int \frac{dx}{x}`) is reported as an undeclared symbol `d`. The
  pruning of the dummy variable does not know the `d` token. Pruning every `d`
  in the span of the integrand would hide a real free variable named `d`.

The parser is `parseIntegral()` in
`latex-syntax/dictionary/definitions-calculus.ts`.

### CE-293. A product with a reciprocal round-trips through LaTeX as a different expression

**Status:** ready; defect, small. Same cause as CE-113.
**Witness:** plausible; `Multiply(3, x, Power(y, -1))` round-trips through `\frac{3x}{y}` as `Divide(Multiply(3, x), y)`.

- **CE-293.1** `Multiply(3, x, Power(y, -1))` is written `\frac{3x}{y}`, which
  parses back as `Divide(Multiply(3, x), y)`: the same value, but not the same
  expression. The canonical forms of `Divide` and `Multiply` differ for this
  shape.
- **CE-293.2** The `reciprocal` and `factor` fraction styles write `a/b` as
  `a\times b^{-1}` and `\frac{1}{b}a`. The value reads back correctly, but the
  round trip gives `Multiply(a, Divide(1, b))`, not `Divide(a, b)`.
- **CE-293.3** Every fraction style writes `c\frac{a}{b}` (canonical
  `Multiply(c, Divide(a, b))`) as one fraction, `\frac{ac}{b}`, which reads back
  as `Divide(Multiply(a, c), b)`.

### CE-296. `\iint f\,dx\,dy` parses its `Limits` in the order opposite to the evaluation

**Status:** ready; defect. User decision 2026-10-01: keep "first = outer", as
Mathematica does; change the parser so that `\iint f\,dx\,dy` gives
`Limits(y), Limits(x)`, and correct the reference.
**Witness:** plausible; User decision 2026-10-01; `Integrate(x·y, Limits(x, 0, 2y), Limits(y, 0, 1))` gives `y²`, not `1/2`.

`Integrate(f, Limits(x, …), Limits(y, …))` is evaluated with the FIRST `Limits`
as the OUTERMOST integral: the `evaluate()` loop integrates the last `Limits`
first, and `nIntegrateMultiple` (`library/calculus.ts`) lets the bounds of limit
`i` depend on the variables of limits `0…i−1`. Two tests in
`test/compute-engine/calculus.test.ts` ("dependent inner bound: triangle", "a
bound referencing an INNER integration variable declines") lock this in. `Sum`
and `Product` document the same order
(`cortexjs.io/docs/compute-engine/82-reference-collections.md`: "the first spec
being the outermost").

With constant bounds the order does not change the value. With a dependent bound
it does: `Integrate(x·y, Limits(x, 0, 2y), Limits(y, 0, 1))` evaluates to `y²`
(the `y` in the bound of `x` is a free `y`), not to
`∫₀¹ ∫₀^{2y} x·y dx dy = 1/2`. A bounded iterated integral on the parse route is
a nested `Integrate`, which is not affected.

- **CE-296.1** Change the parser: it reads `\iint f\,dx\,dy` as
  `Limits(x), Limits(y)`, with the innermost variable (`dx`) first.
- **CE-296.2** Correct the double-integral example of
  `cortexjs.io/docs/compute-engine/81-reference-calculus.md`: it lists
  `Tuple(x, 0, 2)` (the inner integral of `\int_1^3\int_0^2 … dx dy`) first.

### CE-297. The lenient grammar makes reading choices that a host cannot detect

**Status:** ready; capability. User decision 2026-10-01: a parenthesized
name is never a function head, and lenient `+-` is `±`. Plan:
`docs/plans/2026-10-01-lenient-ambiguity-codes.md`. Approved 2026-11-01.
**Witness:** corpus; Tycho request (repro file, Tycho reply) that "CE accepted"; the header makes a Tycho request `ready`, the label says `proposed`.

Goal: a host that converts pasted plain text, such as Tycho's
`plainTextToLatex`, should not need its own parser; the lenient grammar
(`ce.parse(text, { strict: false })`) should give it what it needs. Tycho's
converter keeps a first stage (a closed list of tokens and an adjacency table)
because the lenient grammar reads almost any text and gives no signal when it
picks one of two common readings. Tycho will remove that stage if CE publishes
the list of reading choices the lenient grammar makes, with a diagnostic code
(one `ambiguous-*` group) for each choice that has another common reading. Tycho
counts a choice with no code as a CE defect, and CE accepted this commitment.

Of 300 inputs that the converter refuses
(`tycho/scripts/repros/2026-10-01-paste-refused-inputs.json`), the lenient
grammar on CE main reads about 210 with no signal. The full reply is in Tycho's
`docs/COMPUTE_ENGINE.md`, "CE reply 2026-10-01 to answer 4".

- **CE-297.1** Publish the list of reading choices, and give a diagnostic code
  to each choice with another common reading. The classes, with examples: the
  end of an unbraced exponent (`e^2pi`, `x^2y`); an implicit subscript (`x2`); a
  comma outside brackets (`1,5`); `5!=120`; a name, a space and a number
  (`x 2`); a function name with no parentheses before several factors
  (`sin x y`, `log 2 x` = `log_2 x`); a document function with no parentheses
  (`f x`); list labels (`1. y = x`); equation numbers (`y = x^2 (2)`);
  juxtaposed groups (`(a)(b)`); the extent of a radical (`3√8`, `√2π`); `+-` and
  `±`; `<-`; `a..b..c`; `in` after an equation; `Δx`; chains of `=`; bars that
  pair two ways; dates and phone numbers; `atan3(y)`; Greek capitals that look
  like Latin letters.
- **CE-297.2** `(a)(b)` is the call `a(b)` in the canonical form (strict too).
  This may be a defect rather than an ambiguity (see the decision above).
- **CE-297.3** `±1` is `Measurement(0, 1)`. This may be a defect.
- **CE-297.4** `+-` is two signs (see the decision above).
- **CE-297.5** `mod`, `pow`, `trunc`, `Re` and `Im` are not lenient function
  names. This may be a defect.

### CE-305. LaTeX parser cases marked `@fixme` in the tests

**Status:** ready; defect. Each item has a `@fixme` or skipped test in the named
file.
**Witness:** plausible; `@fixme` parser cases such as `\vec{AB}` and pre-subscripts `_p^qx`.

- **CE-305.1** Pre-subscripts and pre-superscripts (`_p^qx`), and `\vec{AB}`
  over a multi-letter argument (`supsub.test.ts`).
- **CE-305.4** Partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips, `operators.test.ts`).

## Epsil

### CE-835. An Epsil definition with a library name as its head replaces the library function for the engine

**Status:** waits for user (decision); design, S. Recorded by user request
2026-11-06.
**Witness:** crafted; `let xs = [7, 8]\nAt(xs, k) := 5`, then `[7, 8][2]`.

An Epsil function definition whose head is the MathJSON name of a library
function (`Sin`, `At`, `Gamma`) defines that name in the scope of the program,
and the scope of a top-level statement is the engine. So the definition
replaces the library function for everything on the engine:

- `At(xs, k) := 5` (also `At(xs, 1) = 5`) is `DefineFunction(At, …)`. After
  it, `[7, 8][2]` gives `[5, 5]`, and so do `ce.box(['At', ['List', 7, 8], 2])`
  and any LaTeX `L[2]` on the same engine.
- `Sin(x) := 5` makes `sin(0)`, `Sin(0)` and LaTeX `\sin(0)` give `5`.
  `function Gamma(x) { x + 100 }` and `Gamma(x) := x + 100` do the same for
  `\Gamma(1)`.
- A lowercase name only shadows: after `sin(x) := 5`, `sin(0)` is `5`, while
  `Sin(0)` and LaTeX `\sin(0)` are `0`.

This is the documented rule, not an accident: `src/epsil/docs/naming.md`
says that a user binding shadows a library name in its scope, and that "a
user `Add` is what `+` calls in its scope", with `function Gamma(x)` as an
example. Two places differ from it:

- The backtick spelling `` `At`(xs, 1) := 5 `` and LaTeX
  `\operatorname{At}(L, k)\coloneq v` already rebind the list
  (`xs = ReplaceAt(xs, 1, 5)`), while the plain spelling `At(xs, 1) := 5`
  defines a function.
- In LaTeX, `\sin(x)\coloneq 5` is the error `assignment-to-library-function`
  (CE-826, user decision 2026-11-06, option (a)). The Epsil spelling has no such
  check.

Options:

- **(a) An `At` head rebinds the list, as the backtick spelling does.**
  `At(xs, k) := 5` becomes `xs = ReplaceAt(xs, k, 5)`, with the checks of an
  element assignment. Other library heads keep the documented shadowing.
  Recommended: `At` is the operator of indexing, and no program defines it on
  purpose.
- **(b) Refuse a library head in the short forms `f(x) := …` and `f(x) = …`**
  with the error `assignment-to-library-function`, as CE-826 does in LaTeX, and
  keep the `function` statement as the documented way to shadow. Can be done
  with (a).
- **(c) Keep a top-level definition of a library name local to the program**,
  so that it does not change the engine for later LaTeX and MathJSON. This
  changes the scope rule of every top-level Epsil statement, and needs a design.
- **(d) Nothing:** the behavior stays as `naming.md` documents it.

Files: `src/epsil/parser.ts` (the short definition forms and
`elementAssignment()`), `src/compute-engine/library/core.ts`
(`DefineFunction`), and `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`
(the LaTeX check of CE-826, `ASSIGNMENT_TO_LIBRARY_FUNCTION`).

### CE-831. The static check reads a `let` named `i` as the imaginary unit

**Status:** ready; defect, S.
**Witness:** plausible; `let i = 1\nlet y: integer = i\ny`.

The program runs and gives `1`, but `checkEpsil()` and `executeEpsil()`
report a `static-type-error`: "The value `i` of type `imaginary` is not
compatible with the declared type `integer`". In the static pass
(`staticDiagnostics()`, `src/epsil/static-diagnostics.ts`), `i` has the type of
the library constant `ImaginaryUnit`; the cause is not traced. A loop that writes an
element, `while i <= 3 { xs[i] = 10 * i\ni = i + 1 }` after `let i = 1`, gets
the same false error, because the position of `ReplaceAt` must be an integer.
`let e = 3\nlet y: integer = e` is not affected, so the fix starts with how
the pass resolves `i`.

### CE-306. `list<list<string>>` and `list<list<integer>>` cannot both conform to a protocol

**Status:** ready; design. User decision 2026-10-23: a value whose only shared
elements are empty lists counts like the empty list: both conformances are
accepted, and a call on such a value (`[[]]`) is ambiguous at dispatch, as a
call on `[]` is. Approved 2026-11-01.
**Witness:** crafted; Status records user decision 2026-10-23 that gives the rule; if that counts as approval, `fix`; otherwise drop (crafted).

In Epsil, `protocol Sizer { function sizeOf(self: Self) -> string }` with
`type list<list<string>> is Sizer { … }` and
`type list<list<integer>> is Sizer { … }` gives the error
`protocol-conformance-overlap` ("meet `list<list<never>>`") for the second
conformance. `list<string>` and `list<integer>` can both be targets: they share
only the empty list, which dispatches as ambiguous. The two nested types share
`[[]]`, which is not empty, so the overlap is real, and the conformance check
(`engine-protocols.ts`) is correct under its rule. Question: should a value
whose only shared elements are empty lists count like the empty list? Probe: run
the Epsil source above with `executeEpsil()` (`src/epsil/execute-epsil.ts`) and
print the `value` of the result.

### CE-310. An Epsil function redefined in a later program cannot change its result type

**Status:** ready; design. User decision 2026-10-23: a redefinition replaces the
whole contract, the result type included, as it does for the effects; code that
used the old result type is checked again where it is next evaluated. Approved 2026-11-01.
**Witness:** plausible; Status records user decision 2026-10-23 that gives the rule; if that counts as approval, `fix`; otherwise drop.

A redefinition across programs replaces its effects (a later
`function g(x: integer) random -> integer { 7 }` replaces an earlier `pure`
contract). But after `function g(x: integer) -> integer { x }`, a later program
with `function g(x: integer) -> string { … }` is refused with
`incompatible-type`. Is that intended (the result type of a name is fixed once
declared), or should the result type be replaced as the effects are?

### CE-311. Make cross-program redefinition an error on the Epsil route and delete the old mechanism

**Status:** ready; task. User decision 2026-08-18. Plan:
`docs/plans/2026-08-18-checkpoint-restore-design.md`. Approved 2026-11-01.
**Witness:** corpus; User decision 2026-08-18 approves the work and the text says the stage can start; label `proposed` conflicts.

User decision 2026-08-18 (Tycho agrees): a cross-program redefinition of types,
protocols, conformances or same-signature clauses becomes an ERROR on the Epsil
(`executeEpsil`) route only. The box route and the host API keep the current
replace/throw semantics permanently: Tycho's recompute passes re-assert
declarations through the box route every 300 ms and depend on idempotency. The
notebook edit gesture uses the engine `checkpoint()`/`restore()` API, which is
shipped (contract in `docs/CHECKPOINT-MODEL.md`; tests include
`checkpoint-in-scope.test.ts` and the differential harness).

- **CE-311.1** The last stage: flip the Epsil route to strict and delete the
  superseded machinery (about 1,384 source lines, 1,891 test lines and 92 test
  changes; §5 of the plan). Tycho's requirement is met: its notebook restores
  the checkpoint before the first changed cell and replays the cells from there
  since 2026-10-16 (Tycho `docs/COMPUTE_ENGINE.md`, section "Checkpoint /
  Restore"). So this stage can start. Until it lands, both mechanisms exist
  together.

### CE-830. Epsil documents show `random(n)` with an integer, which `Random` refuses

**Status:** ready; defect, S.
**Witness:** plausible; the documented program
`function roll(n: integer) random -> integer { random(n) }`, `roll(6)` gives
`roll(6)` with a `static-type-error` diagnostic and should give an integer from 1
to 6.

The signature of `Random` is `((collection<any> | set<real>)?) random -> any`
(`library/core.ts`), so `random(6)` is an `incompatible-type` error. The example
is in `src/epsil/docs/control-flow.md` (the "Effect specifiers" section, two
programs), `src/epsil/docs/types.md` and `src/epsil/docs/implementation.md`. The
fix is to write `random(1..n)` in each example, as `src/epsil/docs/style.md` does.
This form gives an integer from 1 to `n`. The JSON beside the example in
`implementation.md` must show the same change.

### CE-312. Function declaration hoisting: run-time checks, cancellation and route differences

**Status:** ready; defect. User decision 2026-11-05 for CE-312.2: keep the
behavior, with no code change; add it to the Epsil documentation and close
CE-312.2. Plan: docs/plans/2026-10-21-function-declaration-hoisting.md.
**Witness:** plausible; CE-312.3 and .4 name a fix that needs no decision (fix).

The rules: a call evaluated while its head had no value stays symbolic for the
rest of the top-level evaluation that produced it, and a later evaluation
resolves it again. A `Block` evaluated directly by the host counts each
statement as its own evaluation. The Epsil runner installs a `function`
statement before the first statement when a statement before it can call it and
the installation is safe (four conditions in `prepareFunctionDeclarations`,
`src/epsil/execute-epsil.ts`).

- **CE-312.2** A prepared `function` statement stays defined when the program is
  cancelled (time or step budget) before its statement runs. The clause is
  installed in the program scope at preparation; the loop breaks, and a later
  program on the same engine sees the function. The whole-block route has the
  same early install, in the block scope, which goes away with the block.
  Removing the binding is not correct either: the clause may have been
  accumulated onto a function of an earlier program. A later program that
  declares the same name does not re-install the clause that the stopped program
  prepared (the early-clause re-install keeps only the installs of the current
  batch). Documented in the plan. The options were: keep this behavior and
  document it, or record what each prepared name held and restore it when the
  program stops before the statement runs. The user chose the first option.
- **CE-312.3** The declared signature of a function is not checked inside a
  function body. With
  `function h(x) { let g: (integer) -> integer; function g(k) { 2k }; g(x) }`,
  `h(1.5)` answers `3` on both routes, also when the call comes after the
  `function` statement. The body's `Declare` runs in a new scope for each call,
  so it never finds the binding that holds the clause installed ahead, and the
  body's call reads that clause without the declared signature. The re-install
  of early clauses after a declaration (`BLOCK_REINSTALLS`, `library/core.ts`)
  is keyed on the activation template of a block and covers a loop body and a
  block run again, synchronously or asynchronously, but not a function body; its
  comment states the limit.
- **CE-312.4** A program run again on a warm engine with a changed declared
  signature keeps the old parameter type.
  `executeEpsil(ce, 'let f: (integer) -> integer\nfunction f(n) { 2*n }\nf(3)')`
  gives `6`; then
  `executeEpsil(ce, 'let f: (real) -> real\n function f(n) { 2*n }\nf(2.5)')` on
  the same engine gives `Error("no-matching-clause", f(2.5))`, where a new
  engine gives `5`. The preparation step boxes `function f` while `f` still
  holds the signature declared by the first program, and the `DefineFunction`
  canonical handler writes that old parameter type into the canonical literal
  (`declaredForParams` → `ascribeDeclaredParameterTypes`, `library/core.ts`), so
  both the statement's own install and the re-install use `n: integer`. A fix
  belongs in `prepareFunctionDeclarations()` (`src/epsil/execute-epsil.ts`): for
  example, do not prepare a function when an earlier `let` of the program
  declares its name again while the program scope already holds the name with
  another type.
- **CE-312.5** The Epsil runner and the block route give different results
  (measured 2026-10-21). A call before the `let` of a variable the body reads
  (`let a = String(g())`, `let c = 2`, `function g() { c^2 }`) gives `"c^2"` on
  the runner (the top level has no "declared, not yet initialized" state) and
  `read-before-declaration` on the block route.
- **CE-312.6** A `function` statement that the runner does not prepare (after a
  `type` statement, a body that reads an earlier value with no static type, a
  generic function) resolves a call before it when the stored result is read
  again, so the value agrees with the block route. But a value computed from the
  call in the same statement (`String(g(3))`) does not agree.

## Performance

### CE-689. Boxing the nested-`Fold` expression of issue #487 is about 3.5 times slower than in 0.156.0

**Status:** ready; performance, M. GitHub issue #487, closed after the
evaluation part was fixed in `db796d62e`. Approved 2026-11-01.
**Witness:** corpus; GitHub #487, 3.5x boxing regression measured.

Boxing `['Function', RSK_ROW_INSERTION, '_raw']`
(`test/compute-engine/fixtures/rsk-row-insertion.ts`: 8 `Fold`s nested 4 deep)
took 30 ms on the 0.156.0 build and 106 ms on the 0.173.0 build (measured
2026-10-30). At `2e6479dc8` it takes about 110 ms from source (the fastest of
10 warm runs, load average 5 on 18 cores, measured 2026-10-31). One canonical
pass of the same tree with no fold handler (`Fold` renamed) went from 3 ms to
5 ms between those versions, so part of the growth is the cost of each pass.
The fold fixpoint repeats that cost: the inner folds are rejected at every step
(the `If` in their body can be `Missing`), and each rejected fold costs 4
canonical passes in the first step of each enclosing fold
(`FoldRefinementState`, `library/collections.ts`). Two possible fixes: keep the
rejected result of an inner fold across the steps of the enclosing fold, or
make one canonical pass cheaper.

### CE-638. An untyped parameter followed by parentheses is read as a product: `g \mapsto \int_0^1 g(x)\,dx`

**Status:** ready; defect, M. User decision 2026-11-05: option (b).
**Witness:** plausible; User owns the parse decision; `h(p, a) := p(a)` gives a silent product.

In a function literal or a definition, the parser reads `p(a)` as a product
when `p` is a parameter with no type: `headHasNoTypeInformation()`
(`boxed-expression/invisible-operator.ts`) returns false for a parameter of
the literal being read. The CHANGELOG entry of commit `4ac8db89c` documents
this ("The product reading remains for a head that is a value: … a parameter
of the function literal being read (`(x, N) \mapsto x(N+1)`)"), and
`test/compute-engine/juxtaposition-application.test.ts` expects
`(x, N) \mapsto x(N+1)` applied to (2, 3) to give 8. Examples at
`d597ba836`:

- `(g \mapsto \int_0^1 g(x)\,dx)(t \mapsto t^2)` gives an `incompatible-type`
  error, and `.N()` gives NaN; with `(g\colon \mathrm{function})` it gives
  0.3333.
- `h(p, a) := p(a)` is `Multiply(a, p)`, so `h(t \mapsto t^2, 0.5)` gives the
  product `0.5·(t ↦ t²)`.
- The reading of a `\mapsto` parameter depends on an outer declaration of the
  same name: after `ce.declare('g', 'function')`, `g \mapsto g(x)` reads
  `["g", "x"]`; without it, `Multiply(g, x)`. The parser registers an
  unannotated parameter as `'function'` when the outer scope resolves the name
  to a function (`definitions-core.ts`, near the comment "An unannotated
  callable parameter keeps the existing call spelling"), and
  `test/compute-engine/application-policy.test.ts` ("untyped value parameters
  keep multiplication while callable parameters stay local", commit
  `7afa85494`) expects `(f, x) \mapsto f(x)`, with an outer `f` assigned a
  function, applied to `(t ↦ t, 3)` to give 3. A definition
  (`parseFunctionDefinitionBody()`) always reads the parameter as a value, so
  `\mapsto` and `:=` disagree. The fix for option (a) is one change in
  `definitions-core.ts`: register every unannotated `\mapsto` parameter as
  `'value'`; the policy test then gives `Multiply(3, t ↦ t)`.

Options (each removes the dependence on the outer declaration, except
"nothing decided"):

- (a) Keep the rule: an unannotated parameter is always a value (the change
  above; the policy test must then annotate `f`). A higher-order
  literal needs `(g\colon \mathrm{function})`. A definition has no such form
  today: `h(p\colon \mathrm{function}, a) := p(a)` gives
  `Error('expected-a-symbol')` for the parameter. Add a sentence to the LaTeX
  guide.
- (b) Read an untyped parameter as an undeclared head: `p(…)` is an application
  unless the argument contains `p` (as `q(2q)` stays a product).
  `(x, N) \mapsto x(N+1)` then applies `x`, and (2, 3) no longer gives 8. This
  reverses the CHANGELOG statement and the test above; the number of other
  changed tests and snapshots is not measured.
- (c) Option (a), and typed parameters in a definition
  (`h(p\colon \mathrm{function}, a) := p(a)`), as `\mapsto` already allows.

Recommended: (b). Commit `4ac8db89c` chose the application reading for an
undeclared head because a wrong call stays visible and a wrong product is
silent; the same reason applies to an untyped parameter, and it makes the
`\mapsto` reading with an outer function (the policy test) the rule for every
case. (c) is the choice that keeps the documented rule. If nothing is
decided, the higher-order case gives NaN or a product with no warning, and the
reading of a `\mapsto` parameter keeps depending on an outer declaration.

### CE-639. A local function assigned inside an integrand gives an `incompatible-type` error

**Status:** ready; defect. Found 2026-10-30 while reviewing CE-626 (also on
0.174.0).
**Witness:** plausible; One-line integrand `(g \coloneq t\mapsto t^2; g(x))` gives `incompatible-type` error instead of 1/3.

`\int_0^1 (g \coloneq t\mapsto t^2; g(x))\,dx` evaluates to an
`incompatible-type` error; it should give 1/3.

### CE-625. A limit of a call that passes a function as an argument leaves a parameter name in the result

**Status:** ready; defect (wrong values). Found 2026-10-28 while reviewing
CE-614.
**Witness:** plausible; Interpreter wrong value: `Limit(x ↦ h(g, x), 2)` gives `["p", 2]`, should give 4; two-line definitions.

With `g := t ↦ t^2` and `h := (p, a) ↦ p(a)`, `Limit(x ↦ h(g, x), 2)` evaluates
to `["p", 2]` (the parameter name of `h`), where the value is 4. The same
happens on main and with no shadowing scope: the inlining of the call of `h`
does not substitute the function argument `g` for the parameter `p` in a call
position.

### CE-624. The interpreter cannot compute a nested integral of a user-function call

**Status:** ready; capability. Found 2026-10-28 while fixing CE-614. Approved 2026-11-01.
**Witness:** corpus; Tycho row 476 definitions; `NIntegrate` gives NaN with jit off.

With Tycho's row-476 definitions (`c(y, D, e) := \int_{-D}^{D} n(x, y, e)\,dx`)
and `L := 0.5`, `.N()` of `\int_0^1 y\,c(y, L, 0.001)\,dy` gives 1.98376 only
through the compiled route; with `jit = 'off'` it stays unevaluated, and
`NIntegrate` gives NaN after about 6 s.

### CE-535. Canonical `rebind` derives the result type of a user function again after each `D` binder

**Status:** waits for user (design); performance, needs a design. Found by the Tycho document-open
measurement, 2026-10-27. Same cause as CE-531.
**Witness:** corpus; User owns the cache-key design; Tycho document-open benchmark.

When Tycho opens the document `art/2ki2hjsouf`, it makes 1 994 canonical
`ce.rebind` calls; the replay takes about 720 ms. A 425-byte tree such as
`R_3(At(PointList(PointX(S_orry(u)) + … D(PointY(S_orry(u)), u) …)))` takes 14
to 20 ms, about 85 % of it in typing `S_orry(u)` (`callResultTypeOfBinding` and
`literalBodyResultType`, `boxed-expression/call-result-type.ts`, walk the 8.7 KB
body). That walk has a memo keyed on `_cacheGeneration()`, but each `D` goes
through `canonicalizeBinder` (`box.ts`), which declares the bound variable in a
new scope; the declaration and the pop advance the `any` axis, so the memo
misses after each `D`.

An exemption for a declaration into a scope that canonicalization has just
created was built and measured on 2026-10-27 (replay 848 → 664 ms) and then
REMOVED, because it is unsound. A symbol reads its value by name through the
current scope chain (`BoxedSymbol._value`, `boxed-symbol.ts`), and while the
binder's `canonical` handler runs, the binder's variable shadows an outer
binding of the same name; the binder marks its variable only after the handler.
So an expression that existed before the scope (an operand boxed earlier, or the
stored value of an operand symbol, such as `a := x + 1` with `x := 3`) can serve
a sign cached outside, or cache a sign computed inside and keep it after a clean
pop: `sgn(a)` was `undefined` after the binder, with `x := 3`. The type
derivation of a user function reads signs the same way, so its memo is not
lexically scoped either. A narrower rule does not help: all 32 `D` binders of
the replay bind `u`, which is visible outside every time. The regression tests
are in `test/compute-engine/ce-535-531-binder-declaration-cache.test.ts`.

What a fix needs (a design change): either caches whose key does not depend on
name lookups from the current scope (for example, keyed on the bindings they
read), or a binder variable that lookups see as bound before the `canonical`
handler runs. Tycho's side: it classifies each row twice, which doubles the
rebind work (Tycho row ID).

Reproduction: `npx tsx benchmarks/tycho-document-open/rebind.ts`
(`COLD=1 RUNS=1` for the first run only).

### CE-536. `evaluate()` of a large surface body evaluates each copy of a subtree again and types every new node again

**Status:** ready; performance. Found by the Tycho document-open measurement,
2026-10-27. Approved 2026-11-01.
**Witness:** corpus; Tycho document `2ki2hjsouf`, benchmark reproduction, 1.6 s.

When Tycho opens the document `art/2ki2hjsouf`, it calls `evaluate()` on 15
surface bodies in `u` and `v` (2 to 67 KB of MathJSON each): 1 684 ms in Tycho,
1 623 ms in the replay with a production-like bundle (median of 5), 460 ms for
the largest input. Three causes:

- **Copies of a subtree.** Input 0 has 8 100 nodes but 244 distinct subtrees:
  one 3.6 KB `ListJoin` subtree occurs 18 times, because Tycho puts the body of
  `G_APS(u,v)` at each read of `R_3`. Evaluating the copies costs 46 % of input
  0 and 44 % of input 2.
- **Type derivation on each new node.** `boundCallType` (`boxed-function.ts`) is
  about 37 % of `evaluate`: 27 000 calls on input 0 with 184 distinct (operator,
  operand types) keys, and 425 000 `isSubtype` calls (`common/type/subtype.ts`)
  on 1 096 distinct pairs (`real <: number` alone 131 000 times).
- **Cache invalidation.** In inputs 2 to 7, each write of a `Comprehension`
  index and each scope pop advances the `any` axis 104 to 112 times per call,
  and each advance retires the cached `_type` of every expression.

Proposed fixes: (a) inside one `evaluate()` call, a memo keyed on the structural
hash for a subtree with no effect (no `Assign`, no unseeded random draw),
cleared by any state event on the `semantic` axis; (b) a memo of `boundCallType`
keyed on the operator definition, the operand type objects and
`_cacheGeneration()`, after an audit of what else the function reads
(`absentTerm`, `applySiteResultType`, reboxed callees); (c) a fast path in
`isSubtype` for two primitive types. Tycho's side: evaluate an inlined function
call once instead of copying its body at each read.

Reproduction: `npx tsx benchmarks/tycho-document-open/evaluate.ts` (`RUNS=`,
`ONLY=0,2`; `CE_CACHE_STATS=1` prints the `isSubtype` counts). Under `tsx` the
`console.assert` calls are live and add about 1 s; the production build strips
them.

### CE-531. A call of a function literal invalidates the caches on the `any` axis

**Status:** ready; performance. Found 2026-10-27 while fixing the lazy collection
chain of Tycho row 453. Approved 2026-11-01.
**Witness:** corpus; chain of Tycho row 453.

Each call of a function literal declares its parameters in a new call scope
(`declareParameterActivation`, `function-utils.ts`). That declaration sends a
`declare` event that is neither `scratch` nor `parameter`, so it advances the
engine's `any` version. Every cache keyed on that version (`_cacheGeneration()`:
the evaluated form of `At(A, I)`, the memo of a lazy collection value, the
`_type` and `_sgn` caches) then misses after each call. Measured on the chain of
Tycho row 453 at depth 3: the version went from 17 to 7 129 during one read.

An exemption for a declaration into a scope that no lookup has walked through
yet (tried on 2026-10-27 for binders, see CE-535, and removed there as unsound)
is NOT sound for a call scope either. The cached `_type` of a body node is safe,
because `BoxedSymbol.type` reads the body's own binding. But `BoxedSymbol.sgn`
reads the parameter's VALUE by name through the call scope, and `_sgn` is keyed
on the version only: with the exemption, a lazy operator whose operand is the
body node `x + 1` answered `positive` for `f(-5)` right after `f(3)`. Exempting
the entry and advancing at the exit saves nothing (still one advance per call).
What a fix needs: a key for the value-dependent caches of a body node that
includes the values of the call's parameters (or a per-activation cache), so
that a call does not have to advance the engine-wide version. This is a design
question.

### CE-532. A public API that binds values to symbols for the duration of a callback

**Status:** ready; design. Tycho row 453 (second ask).
**Witness:** corpus; Tycho row 453 request is ready by the header rule; status line records no dated user approval of the `ce.withValues` API.

Tycho's `withValuelessVariablesBound()`
(`~/dev/tycho/src/plot-core/list-materialize.ts`) assigns values to document
symbols while it reads point coordinates, and then restores them. It reads the
internal fields `storedValue`, `_placeholderSkeleton` and `_signatureSkeleton`
to do so, and cannot restore a type that `assign` changed. The public
`ce.checkpoint()`/`ce.restore()` snapshot the whole engine and throw during an
evaluation. Proposal: `ce.withValues(values, fn)`. It pushes a scope, declares
in it each name with the given value and with the declared type of the visible
binding (as the internal `withValueShield()` does for valueless names), runs
`fn`, and pops the scope in a `finally`. The outer definition is never written,
so there is nothing to restore. An expression created inside `fn` must not be
kept after `fn` returns.

### CE-313. Evaluating a symbolic closed form again after a state change rebuilds its nodes

**Status:** ready; performance. Same cause as CE-321; fix with that design. Approved 2026-11-01.
**Witness:** corpus; Tycho 29-piece path; text says "fix with that design" (CE-321).

The value of `D(PointY(h(u)), u)` for Tycho's 29-piece path, a symbolic list,
costs about 18 ms each time it is evaluated again after any assignment. The same
node evaluated again with no change in between is a memo hit (0.1 ms). The memo
for unevaluated nodes is keyed on the `any` axis, and a result node has no
entry. Two fixes were considered and both need a decision: seed the memo of each
result node with itself (this assumes that `evaluate()` is idempotent), or test
whether the rebuilt result equals the node (CE-321 measured that this costs more
than it saves).

### CE-314. Worker threads for parallel numeric kernels: the Epsil route and the API name

**Status:** ready; capability. User decision 2026-10-20: the Epsil asynchronous
route waits for Tycho's integration feedback. Tycho's feedback is written
(2026-10-24, Tycho commit `74eea7228`; moved 2026-10-26 to
`~/dev/tycho/docs/COMPUTE_ENGINE_LOG.md`, section "Two standing Tycho-side
follow-ups closed on 2026-10-24 and 2026-10-25": `FindFit.evaluateAsync()` on CE
0.164.0 and `broadcastAsync()` on CE 0.165.0). Tycho has nothing pending on this
entry. Its asks (a time limit and event-loop turns on the asynchronous routes,
`inline: false`, `willUsePool()`, `shippable`, and the `route` of a batch or a
fit) are done; CE-430 is what remains of them. Plan:
`docs/plans/2026-10-20-worker-kernel-pool.md`,
`docs/plans/2026-10-20-findfit-global-grid.md`.
**Witness:** corpus; Ready with user decision 2026-10-20 in status; Tycho row 441; only CE-314.1 (c) remains open.

A compiled function evaluated over an array of inputs, and the starts of a
`FindFit` global search, are pure-number work that worker threads run in
parallel. Steps 1 to 5 of the design are done: `broadcast`/`broadcastAsync` on
compiled results, `INTERVAL_KIND`, `createIntervalRuntime`, `createKernelPool`,
`ce.workers`, the `kernel-worker` entry, and `FindFit.evaluateAsync()`, which
scans on `ce.workers` (1,000 rows over `[0.3, 628]` in 65 ms on 8 workers, 233
ms inline). The default pool size is `hardwareConcurrency - 1`, capped at 8.
There is no whole-engine worker protocol for now.

Sizes measured 2026-10-20 (`benchmarks/workers/*.mts`): an implicit plot of
512×512 interval cells takes 152 ms serially and 27 ms on 8 workers; a 5-point
fit or a 2000-column plot takes under 10 ms and cannot gain. Tycho caps fits at
10 000 rows and samples 500 for the global search.

- **CE-314.1** The Epsil asynchronous route. Epsil has no keyword for parallel
  execution: the engine decides from purity, compilability and size, as it does
  for compilation (design section 5.7). Tycho row 441 (filed 2026-10-24, Tycho
  commit `aa31fffac`) asks for it: a notebook Epsil cell runs through
  `executeEpsil` on the main thread under a 2 s limit, so one large batch of
  independent values (a map over 100 000 elements, a large sum, a grid of
  samples) cannot finish. Ask: run such a batch on `ce.workers` with the same
  result as on the calling thread, and an asynchronous run of the program with
  an abort signal. READY when an Epsil cell that maps a costly function over 100
  000 elements runs on the pool from an engine inside a worker, with the same
  values and faster than on one thread. Measured 2026-10-24:
  `sum(map(x => N(sin(x) + x^2), 1..100000))` takes 4.3 s on one thread with the
  default precision, because the marked tier of the `Map` auto-compilation
  (`map-auto-compile.ts`) declines when the engine prefers bignums; with
  `ce.precision = 'machine'` every element runs compiled and the program takes
  0.2 s. The pool route must answer which precision it runs at. Done 2026-10-24
  (first step): `executeEpsilAsync(ce, source, { signal })`
  (`src/epsil/execute-epsil.ts`), and `evaluateAsync` handlers for `Assign` and
  `Declare`, so that `let fit = findFit(…)` takes the asynchronous route of its
  value. Left: (a) the pool route of a large `Map`/`Sum` drain. User decision
  2026-10-24: machine precision only (the rule of the marked tier). A prototype
  was written and measured on 2026-10-24 (not landed; worktree
  `/tmp/wt-ce3141`): before the drain of `Sum(Map(f, xs))` on the asynchronous
  route, the pool computes the compiled `f` over the source (`Apply(literal, x)`
  compiled to a `broadcast` result), and the runner of `map-auto-compile.ts`
  reads the values by position. Values identical to one thread, but no useful
  gain: for 100,000 elements at machine precision, `N(sin(x) + x^2)` took
  209–235 ms on one thread and 241–259 ms with a pool of 4; bodies of special
  functions 257 → 241 ms and 364 → 290 ms. A compiled element costs under 1 µs;
  the drain itself (the runner's checks, boxing the value, adding the term)
  costs 2 to 3 µs per element on the calling thread. The drain cost is now gone
  for `Sum` (2026-10-24: the sum of a compiled `Map` is computed on doubles,
  about 45 ms for 100,000 elements), so the pool route could pay only for a
  costly compiled body. User decision 2026-10-24: a body with a loop or an inner
  collection stays interpreted, because its compiled values can differ from the
  interpreter's `N` in the last digits (measurements: an exact loop sum
  `1.066407470350872` against the compiled `1.0664074703508735`, an exact
  product `231` against `230.99999999999994`). So the pool route of (a) is NOT
  DONE, by decision, and its prototype is not kept. (c) While
  `executeEpsilAsync` waits on a statement, the engine keeps the fields of the
  run (`_epsilBatchId`, `_epsilStatementResultHook`, `_epsilDeclarationRoute`),
  because the asynchronous parts of the statement read them after their own
  waits; other work on the engine during the wait would see them, so the
  documentation forbids it. Lifting the limit means carrying the three fields
  with the asynchronous evaluation, as its context stack carries the deadline
  frame (`deadlineFrameOf()`, `evaluation-epoch.ts`). Part 2 of row 441 (a pool
  for an engine inside a dedicated worker) needed no change: tested in Node and
  in three browsers on 2026-10-24
  (`test/compute-engine/ce-314-3-nested-pool.test.ts`,
  `benchmarks/workers/nested-pool-browser-probe.mjs`) and documented in
  `cortexjs.io/docs/compute-engine/13-guide-compile.md`.
- The name stays `broadcast`/`broadcastAsync` (Tycho's feedback 2026-10-24: "one
  formula, many points"; `runMany` says less).

### CE-321. Each user-function call retires the inert evaluation memo, so a chain of calls copies each level

**Status:** waits for user (design); performance.
**Witness:** corpus; User owns the type-cache key design; Tycho reproduction script; "no document is blocked".

The memo of an inert evaluation (`_memoizedLazyCollectionValue`,
`boxed-expression/boxed-function.ts`) is keyed on the `any` axis. A call of a
user function advances that axis once: the activation of each parameter is a
declaration with a value into the call frame (`declareParameterActivation`,
`function-utils.ts`). The memo stores a result under the evaluated node, and the
result is a new node with no entry. So the next level of a chain `f^k(P)`
re-evaluates the previous level's result, walks it again and copies every node
it rebuilds. In `inert-evaluate-memo.test.ts` ("a user function applied to its
own result") the distinct nodes are 39, 60, 95, 144, 207, 284 at depths 1 to 6,
quadratic in the depth. The time is linear per level (58 ms at depth 8; 0.25 s
at depth 9 of the Tycho reproduction
`scripts/repros/2026-10-17-inert-pointlist-chain.mts` with 101 points), so no
document is blocked by it.

Do not add a fixpoint test that returns the node itself when its rebuilt result
is structurally the same: the comparison cost more than the copies it saved (692
ms against 230 ms at depth 9 of the Tycho reproduction).

Possible fix: the activation could advance nothing, as the auto-declaration of a
parameter at its first reference does (`parameter` in `axisMaskOf`,
`engine-configuration-lifecycle.ts`). But the body's symbol nodes cache their
type under the `any` axis, and the call's advance is what re-types a body for
the next argument. So the memo needs a key that the activation does not move
(for example, the cached type of a parameter read keyed on the activation it
resolved to). This is a design change of the type cache and needs a decision.

### CE-324. Slow Epsil corpus programs, and a compile step that evaluates a closed program

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Epsil corpus report programs above 5 s.

In the Epsil corpus report (`npm run epsil:corpus-report`, run of 2026-10-06),
the interpreted median is 98 ms.

- Programs above 5 s: `euler/004` 14.7 s (a comprehension of 5050 products with
  a palindrome test), `euler/030` 12.7 s (9000 elements, a digit-power sum
  each), `rosetta/100-doors` 12.4 s (100 passes of a `map` over a `zip` of 100:
  about 1.2 ms per lambda application), `exercism/nth-prime` 9.2 s,
  `exercism/armstrong-numbers` 8.0 s (500 elements: 16 ms per element for
  `integerDigits`, a `map` and a `sum`), `rosetta/kaprekar-numbers` 6.1 s (100
  elements), `euler/036` 5.7 s, `euler/010` 5.2 s. The common factor is the
  per-element cost of a user function applied inside `Filter`/`Map`/`Any`
  (CE-325).

### CE-325. A user function applied per element of a lazy collection costs about 100 µs per application

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Project Euler corpus programs, 20 s.

The full-size Project Euler programs give the right answers but are slow:
`sum(filter(2..9999, isAmicable))` took about 20 s on a loaded machine,
`filter(10..50000, isCurious)` about 20 s per walk. The corpus keeps reduced
sizes for `euler/021`, `euler/029` and `euler/034`, and
`rosetta/kaprekar-numbers` stops at 100. A finite lazy collection keeps its
elements after a complete walk, also with a named callback, so a repeated walk
is served from the memo; the first walk is the problem.

A CPU profile of `isEven(n) = n % 2 == 0` inside `filter(1..20000, isEven)`
(2026-10-07, loaded machine, so an upper bound) gives about 100 µs per
application of a named user function. An inline lambda with an arithmetic body
inside `map` costs 7 µs per element because it is lowered to a broadcast and
never applied as a function; a body such as
`sum(map(d => d^4, integerDigits(n))) == n` costs 0.25 to 1 ms per element.
Where the time of a trivial body goes:

- The body is typed again at every call (about a quarter of the call). A call
  frame declares its parameters with `ce.declare`; every declaration advances
  the `any` version axis (`engine-configuration-lifecycle.ts`), and the type
  cache of every expression keys on that axis (`BoxedFunction.type`), so
  `Mod(n, 2) == 0` derives the types of its operands at each call. The read
  comes from the broadcast check of `Equal` (`skipBroadcastForVectorOps`), which
  asks whether each operand is a text atom, and `isTextAtom` reads the operand's
  type. This is by design: the type of a body expression depends on what the
  frame binds (`f(s) = s < "m"` broadcasts for a list and compares whole for a
  string), and the `definitionVersion` axis exists for memos that must survive
  these declarations.
- The application is boxed and canonicalized again at every call (about a
  quarter). The application memo answers a repeated call with the same number
  arguments, but a fresh argument pays the full boxing.
- The parameter declaration builds a full value definition
  (`declareSymbolValue`, about an eighth), and the application memo key
  serializes each argument to JSON.

A call such as `isEven(n)` inside `filter(1..20000, isEven)` already applies the
function literal directly (option B, user decision 2026-10-17), with a gain of
about 10 to 25 %; the rest of the time is the application of the literal itself.
Open options:

- **CE-325.1** Option A: key the type cache of a function body on the call frame
  instead of the engine generation (a redesign of cache invalidation).
- **CE-325.2** The compiled element function of `Map` takes a named user
  function (exact tier at any precision, marked tier at machine precision), but
  a `Filter`/`Any` predicate is not covered: it returns a boolean, and no tier
  takes it.

### CE-329. A compiled loop that assigns `xs = ReplaceAt(xs, i, v)`: the Python target and aliased locals still copy

**Status:** ready; performance, small. Issue #386. Approved 2026-11-01.
**Witness:** corpus; issue #386; JavaScript part done, Python target copy remains.

On JavaScript, a block local updated with `xs = ReplaceAt(xs, …)` is copied once
and then written in place (`ownedLocalUpdateChains`,
`compilation/in-place-update.ts`; 2026-10-24). Still open: the Python target
keeps the copying form, and the check gives up when the block names the list in
any other way (`ys = xs` before the loop is safe at run time but is refused).

### CE-334. Each call of a user function invalidates every generation-keyed cache

**Status:** ready; performance. Decision 2026-09-24: no general per-call cache
design now; reduce the per-call costs instead. Approved 2026-11-01.
**Witness:** corpus; Tycho document `hyvhlz4chj`; same cause as CE-321.

`invoke` → `declareParameterActivation` declares the parameters of the function
in a new activation scope, and the `declare` state event advances the `any`
cache axis. So a value cached against `ce._cacheGeneration()` misses after any
user-function call in between.

2026-10-24: a declaration no longer scans or types again a list argument that is
written-out data, so the declaration cost does not grow with the length of the
list. For a scalar call the declaration is about 10% of the call: about 4%
building `_BoxedValueDefinition` and 2.6% `isValidSymbol` on the parameter name.

What remains: the cost of each parameter declaration
(`declareParameterActivation`). The closed form of `Derivative(f, n)`
(`symbolic/derivative.ts`) is now keyed on the definitions it reads, and
`skipBroadcastForVectorOps` returns early when the operator declares no
broadcast exemption.

- Marking every activation declaration `scratch` (it advances no axis) is NOT
  sound: three tests of `lambda-param-collection-inference.test.ts` overflow the
  stack (`countdown(xs)` with the body
  `if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) }`, and the two
  mutual-recursion tests). The body node `Length(xs) == 0` is shared by every
  call and its value cache is keyed on the generation, so the second call reads
  the answer of the first call (4) and the base case is never reached. The type
  and sign of a body SYMBOL are safe (its definition is fixed when it is boxed),
  but a cached answer of a compound body node can read the values of the call
  through `_contextValue()`. A sound version needs the caches of a body node to
  depend on the call: for example a per-activation stamp in the key of the value
  and facet caches of a node that reads a parameter, or an axis that only
  activation declarations advance. See the `declare` case of `axisMaskOf`
  (`engine-configuration-lifecycle.ts`).
- Measured 2026-09-24 at machine precision, with the unsound `scratch` change as
  an upper bound: removing every activation advance saves nothing measurable on
  realistic interpreted workloads (the noise functions of Tycho document
  `hyvhlz4chj` on a 20×20 grid, 18,820 calls: 465 → 442 ms), and 30% on a list
  recursion (77 → 52 ms).
- Profile of the Tycho case (40×40 grid, 1,264 ms, top self time):
  development-only `console.assert` calls 8.0%, `viewOfExpression` 7.4%, a V8
  built-in 5.7%, garbage collection 5.1%, then `isSubtype`, `lookup` and
  `declareParameterActivation` at 1–2% each.

### CE-335. Rubi 1.2.2.4 #214 reaches the 30 s guard in the rule matcher

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Rubi test problem 1.2.2.4 #214; CE-335.3 is an audit of radical-to-float folding with no witness.

In a 200-problem chapter-1 sample (`--sample 200 --seed 14`), problem 1.2.2.4
#214 still reaches the 30 s wall-clock guard, unsolved after about 80,000 steps.
The profile has no time in the polynomial GCD. The time is in the rule matcher
(`match.ts`), garbage collection, and about 3.6 s of `console.assert` calls in
the `ExactNumericValue` constructor (`exact-numeric-value.ts`) and near
`get isCollection`. The production build strips `console.*`, so that part is a
cost of development and test runs only; the matcher time is real.

- **CE-335.1** Reduce the time in the rule matcher for #214.
- **CE-335.2** Measure the other guard problems of chapters 2–7 again before the
  guard is made shorter.
- **CE-335.3** Audit `makeMonic` (`.div()`), `resultantRec` and `polyDivide` in
  `rubi-utils.ts`: the `.sub()`/`.add()`/`.div()` methods fold exact radicals to
  floats (`√2 − 2` → `-0.5857…`). `polynomialDivide` no longer uses them on
  coefficients.

### CE-337. Reductions over ten thousand elements are slow at the default precision

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Tycho document `s8ishknvhe`.

Example: `Min(1, 2 − 2·PointZ(C))` over ten thousand points (the colour row of
the Tycho corpus document `s8ishknvhe`, which Tycho interprets because the row
declines to compile, see CE-249). At machine precision it takes 5 ms under
`evaluate()`: the coordinates are read into a list of unboxed doubles, the
arithmetic runs on doubles, and `Min` scans them.

- **CE-337.1** At the default precision each element is computed with
  `BigDecimal`, about 15 µs per element on the interpreter route against 0.23 µs
  for the same `BigDecimal` operations. Next step: a `BigDecimal` counterpart of
  the kernels in `machine-broadcast.ts` that keeps the interpreter's order of
  operations and rounding. Doubles are not allowed here: they change the digits
  (`2 − 2·0.37731147124215664` is `1.24537705751568672` at the default precision
  and `1.2453770575156868` on doubles).
- The derived `array` of a list of big-number floats takes 5.0 ms for ten
  thousand elements (it took 7.7 ms before `machineNumberOf` compared the
  decimals directly, 2026-10-24); the rest is building the `BigDecimal` of each
  double.

For Tycho, not a Compute Engine defect: its lowering of Desmos `min`/`max` with
two or more arguments to `ElementMin`/`ElementMax`
(`elementwise-extrema-lowering.ts`) did not reach that colour row. The engine
received the reducing `Min(1, …)`, so the saturation and the value of the colour
are one number for the whole cloud.

### CE-343. A selection over a decidable list condition costs about 2 ms per element

**Status:** ready; performance. Tycho ask 296.
**Witness:** corpus; Tycho ask 296, document `s8ishknvhe` measured; Tycho request is ready by the header rule.

For the body of Tycho's document `s8ishknvhe` (measured from source with `tsx`,
which adds loader overhead): 500 points → 0.9–1.2 s, 2 000 points → 4.2 s; at 10
000 points the 5 s limit refuses the evaluation. Two causes (measured
2026-09-18):

- **CE-343.1** Repeated sub-expressions are evaluated once per reference. The
  body holds the same inner `Which` six times (Tycho expands the document
  functions `S`, `f` and `N` in place); one inner `Which` costs 130–190 ms at
  500 points. With the inner `Which` evaluated once and bound to a symbol, the
  result takes 0.2–0.3 s. Tycho now binds each repeated function node that reads
  a collection once (`shared-subexpressions.ts` in `dev/tycho`): 10 000 points
  11.0 s → 1.8 s. The engine-side option that helps every caller: share the
  value of structurally identical sub-expressions during one `evaluate()`, keyed
  by `expr.digest`. Two facts constrain this:
  - Calling `S`, `f`, `N` by reference in place of expanding them is NOT
    value-safe. A named function with an untyped parameter maps element-wise
    over a list argument (the declared `broadcastable<T>` contract of item 157),
    so `g(L) = L - mean(L)` answers `[0, 0, 0, 0]` by reference and
    `[-1.5, -0.5, 0.5, 1.5]` expanded. `Apply` of the same lambda, or a
    `list<number>`-typed parameter, gives the whole-list value.
  - A symbol ASSIGNED an unevaluated expression is evaluated again at each read
    (three reads of `W + 1` with `W := Abs(PointX(L)) + Abs(PointY(L))` over 2
    000 points: 430 ms; with the evaluated value assigned: 67 ms). This is the
    definition semantics of an assigned expression, not a defect.
- **CE-343.2** Each element of each broadcast operator is computed by boxing a
  new canonical function (`mapAtCell` and the drain iterator in
  `library/collections.ts`, through `computeBroadcastCell`): operator lookup,
  type handler, operand descriptor, allocation. Measured: 30–40 µs per element
  for `Abs(PointX(L))`, 60–80 µs for `PointX(L) + PointY(L)`, 140–190 µs for
  `Conjugate(PointZ(L) / (PointX(L) + i PointY(L)))`.
- **CE-343.3** The comment on `evaluateElementwiseSelection`
  (`library/control-structures.ts`) quotes about 8 µs per element per condition
  for the lazy broadcast `Map`. Measure it again on a built bundle.

The compiled route does not take this body: Tycho's `javascript` compile of
`C_cf` declines at `Abs` ("cannot compile a broadcastable head over a possibly
list-valued operand", `base-compiler.ts`), because `C_c` has a `number | tuple`
element arm in its declared type (sub-item on `s8ishknvhe` in CE-268).

### CE-346. Compiling a `Derivative` of a deeply nested body runs the failed symbolic attempt to its budget

**Status:** ready; performance. Tycho item 177.
**Witness:** corpus; Tycho item 177 with repro script; ready Tycho request. CE-346.1 is conditional on Tycho's compile-time requirements failing.

Past the differentiation growth budget, the javascript compile emits an
8th-order centered-difference stencil (`_SYS.nd`), and interpreted `N()`
computes the same shared function, bit-identical across routes
(`compile-derivative-numeric-fallback.test.ts`).

The failed symbolic attempt still runs to the growth budget before the fallback
starts: once per derivative node per compile, about 1–2 s per node on the deep
shapes. Tycho's Taylor witness pays it three times, once per order, because the
`derivative()` call of each order re-runs the shared first differentiation.

- **CE-346.1** If Tycho's compile-time requirements fail on this: add an
  over-budget memo keyed on the resolved function LITERAL (shared across the
  sibling `Derivative(f, k)` nodes) and the semantic version. Do not lower the
  budget: that changes which expressions get exact derivatives.

Numbers before the fallback: order-1 compile 6/21/77/429 ms at depth 1/4/8/16,
throws at depth 37; the body without differentiation takes single-digit ms at
every depth. Bare-engine reproduction: `docs/scratch/d209-ce-asks-repro.mts` in
`dev/tycho`.

### CE-349. Cold-start bundle size and six benchmark cases slower than 0.73.0

**Status:** ready; performance. Measure before work. Approved 2026-11-01.
**Witness:** corpus; benchmark cases vs 0.73.0.

- **CE-349.1** Cold-start bundle size.
- **CE-349.2** Six benchmark cases are still < 0.95× vs 0.73.0. The worst is CE4
  erf-integral at 0.62× (growth of the case-specific integrate/simplify
  machinery, not the boxing cost).
- These were measured as unprofitable; do not try them again without a new
  profile: the P2-2 `isSubtype` memo, the P2-4 simplify-history scan, the
  `bignumRe` memo, the P3-1 `.json` cache (status table in
  `PERFORMANCE_FINDINGS.md`), both P1 differentiation levers and the `.mul()`
  fast-path pivot. Read CE-351 before you change `derivative.ts` or
  `sortProductOperands` for speed.

### CE-350. Bignum kernels: remaining speed-ups against mpmath

**Status:** ready; performance, low priority. Approved 2026-11-01.
**Witness:** corpus; mpmath benchmark.

At 1000 digits, `ln`, `exp`, `kˣ`, `sqrt` and `Γ` are as fast as mpmath or
faster.

- **CE-350.1** r-step / rectangular splitting in `fpexp`. The kernel gets about
  3× faster, but it is less than 10 % of `exp(.N())` time, so users see little
  change. Lowest priority.
- **CE-350.2** Base-2 special-function kernels (`gammaln` and others). `Γ` is
  still about 5 to 7 times slower than mpmath at 200 digits. The elementary
  kernels run on a base-2 fixed-point grid, where "round to p bits" is a free
  bit shift. The special functions (`gammalnCore` and the Bernoulli Stirling
  code, `digamma`/`trigamma`/`polygamma`, `zeta`, `beta`) still run on base-10
  `BigDecimal` and pay for the rounding. The port is large: the argument-shift
  product, the Bernoulli-rational series, the reflection formula and the
  `exp`/`ln` glue all move to `bits`-scaled `bigint`s. It should close most of
  the gap. The remaining factor of about 2 is V8 `BigInt` against GMP and needs
  a different bigint backend (for example WASM GMP). The special functions are
  already 130 to 170 times faster than 0.59.0, so this is not a correctness or
  capability gap.

### CE-351. Symbolic evaluation is still slower than in 0.118.2

**Status:** ready; performance. Plan:
docs/plans/2026-09-06-type-facts-per-type.md. Approved 2026-11-01.
**Witness:** corpus; symbolic benchmark, plan doc.

The symbolic benchmark cases became 1.7 to 2.8 times slower in steps at 0.119.0,
0.120.0, 0.121.0 and 0.122.0. Fixes in 0.124.1, 0.124.2 and 0.124.3 recovered
most of it.

Latest absolute measurement (0.124.2 build, µs per call, box lock held at box
load 3 to 5, five interleaved rounds, medians):

| Case                 | 0.118.2 | 0.124.1 |  now | now ÷ 0.118.2 |
| -------------------- | ------: | ------: | ---: | ------------: |
| box `√6x + √2x`      |      41 |      45 |   44 |          1.07 |
| simplify `√6x + √2x` |     234 |     292 |  279 |          1.19 |
| simplify `√(3+2√2)`  |      85 |      95 |   87 |          1.02 |
| solve `x⁴+x²−1=0`    |    2475 |    3165 | 2859 |          1.16 |
| `∫1/(x³+1)dx`        |    1985 |    2661 | 2393 |          1.21 |
| `∫₁² 1/x dx`         |     173 |     221 |  220 |          1.27 |

0.124.3 (shared type facts per type value, `OperatorTypeHandlerOnTypes` returns
`BoxedType | undefined`) is faster than 0.124.2 by 14 to 16 % on the `√6x + √2x`
simplification, 7 % on the solve, 9 % on `∫1/(x³+1)dx` and 25 % on `∫₁² 1/x dx`.
The gap to 0.118.2 was not measured again after 0.124.3.

What remains is the cost of one type derivation of a function node and its
allocations. A fresh `Add(x, y)` / `Power(x, 2)` / `Multiply(√6, x)` node types
in 2.3 / 2.8 / 3.3 µs against 1.2 / 1.1 / 2.5 µs on 0.118.2 (micro-benchmark on
`ce._fn` nodes, 20 000 each). No single line carries it: the handler call is
about 0.4 µs, the function body about 0.5 µs (closures, descriptor array, the
missing-absorption and broadcast scans), then `skipBroadcastForVectorOps`,
`provablyNaNOperand`, `isExtendedRealOperand` and `broadcastsOverTuples` at 0.1
to 0.2 µs each. The definite integral's gap is in boxing:
`makeCanonicalFunctionCore` 110 against 81 µs, `applyOperatorDefinition` 63
against 48, with `hasSignatureArm`, `reduceUnionType` (under `widen`),
`recordTypeProvenance` and `_withoutFacts` at 1 to 3 µs each.

- **CE-351.1** Try a scalar arithmetic dispatch route (the next experiment).
- **CE-351.2** A per-value literal-type cache: the same rational or radical
  value boxes to the same type object.
- **CE-351.3** A descriptor pool.
- **CE-351.4** A memo of `broadcastsOverTuples` / `broadcastableParamSlots` per
  definition.

Literal types are not the cause. Decision (2026-09-06): keep the literal-tier
types as they are. Dropping literal types altogether saved only 10 to 18 % (at
most a third of the gap) and failed 81 type pins; it also loses real results
(`arcsin(1/3)` and `artanh(1/3)` type `complex` instead of `real` without the
enclosure, and `1/(x + 1/3)` with `x: real<0..1>` loses its bounds).

To measure: build first, take the box lock, then run
`CE_PUBLISHED_BUNDLE=<bundle to compare> node benchmarks/runners/run_ce_rubi.mjs`.
It times the published bundle and the current build
(`dist/esm-min/compute-engine.js`) on all cases in one warm process (one engine
per build, a warm-up pass, then the median of up to 50 calls per case) and
prints one JSON line per engine and case; compare the `ce-pub` and `ce-current`
lines. Bundles 0.116.0 to 0.123.2 are in `benchmarks/.competitors/`.

### CE-442. A `D` node with a closed form computes the derivative again at each evaluation

**Status:** ready; performance. Found 2026-10-24 while measuring CE-313. Approved 2026-11-01.
**Witness:** corpus; Tycho row 424, 0.5 s per evaluation.

Evaluating the same `D(PointY(h(u)), u)` node of Tycho's 29-piece path (row 424)
again differentiates again each time, about 0.5 s per evaluation on a loaded
machine. `D` is `lazy`, so the memo of inert evaluations leaves it out, and
`withDeclinedDerivativeMemo` (`library/calculus.ts`) records only declines.
Possible fix: record a successful result with the same dependency stamps as a
decline.

## Tests, tools, documentation and release tasks

### CE-775. The arithmetic guide page of cortexjs.io still owes the text of a public behavior change

**Status:** ready; documentation. Approved 2026-11-01.
**Witness:** plausible; Owed by the AGENTS.md rule on public behavior; the text was in a lost scratch report. Check the cortexjs.io page.

Owed by the AGENTS.md rule on public behavior; the text was in a lost scratch report. Check the cortexjs.io page. Found during the work of 2026-10-30 and 2026-10-31 (F16); the
reproduction above is the record.

