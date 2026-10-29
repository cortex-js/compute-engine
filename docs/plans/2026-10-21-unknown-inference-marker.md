# `unknown` as an inference marker: analysis and proposal

Status: decided 2026-10-21 (user: D1 yes, D2 yes, D3 yes, D4 yes, D5 option
(a), D6 yes); implemented 2026-10-21 (slices 1 to 4; D4 narrowed and D6 not
applied, see section 5). The user confirmed the narrowed D4 on 2026-10-22;
D6 was measured on 2026-10-22 (section 5). On 2026-10-23 the user decided
not to apply D6 (confirmed 2026-10-24): the library signatures keep
`-> unknown`, because `-> any` stops the inference of the type downstream. This note
answers questions Q2, Q7 and Q8 of
[the collection types proposal](2026-10-20-bare-tuple-record-any.md). It is
limited to `unknown` and inference. Presence assertions and the diagnostic
policy for possible absence (Q1/Q3), record-field omission (Q5/Q6), value
capture (Q11), function hoisting and a compiled representation of `Nothing`
stay deferred in `ROADMAP.md`; nothing here depends on them.

Agreed intent (user, 2026-10-20): `unknown` is an inference marker, a
placeholder for a type that is not known yet. It is not a concrete content
type. A bare collection family name (`list`, `set`, `dictionary`,
`collection`, `indexed_collection`, `tuple`, `record`) admits unrestricted
contents, the same set of values as the `<any>` form. An explicit content
annotation (`list<integer>`, `list<value>`, `list<expression>`) is a
contract and stays restrictive.

Every statement below about current behavior was measured on 2026-10-21 on
`main` at `23db30a67` with `npx tsx` probes against the source. The files
named are where the behavior is implemented.

## 1. Current implementation

### 1.1 The subtype relation reads `unknown` as a top with four exclusions

`isSubtype` (`src/common/type/subtype.ts`, the `rhs === 'unknown'` rules at
lines 245 and 2503) implements:

```text
integer <: value <: expression <: unknown <: any
missing, nothing, error, any   are NOT  <: unknown
never                           <: unknown
unknown <: Y   only for Y = any, Y = unknown, or a union with such an arm
a union  <: unknown  only when every arm is
```

Consequences measured:

| Question | Answer today |
| --- | --- |
| `list<integer \| missing> <: list<unknown>` | false |
| `list<integer \| missing> <: list` | true |
| `list <: list<any>` and `list<any> <: list` | true, true (mutual) |
| `list<unknown> <: list` | true |
| `list <: list<unknown>` | false |
| `list<expression> <: list<unknown>` | true |
| `list<unknown> <: list<expression>` | false |
| `tuple<unknown, missing> <: indexed_collection<unknown>` | false |
| `unknown.couldMatch('missing')` | false |
| `narrow('unknown', 'missing')` | `never` |
| `broadcastable<any> <: unknown`, `!integer <: unknown` | true (the two relation gaps in `ROADMAP.md`) |

So after Option B there are three distinct spellings for a list with no
element restriction in mind: bare `list` and `list<any>` are the same set of
values, and `list<unknown>` is a third, strictly smaller set that excludes
`missing`, `nothing` and `error` elements. The explicit request to infer is
today the most restrictive of the three. This is the opposite of the agreed
intent, where `list<unknown>` requests inference and restricts nothing.

The exclusions date from the 2026-08-17 rule "bare `list` is values only,
`list<any>` admits absence", which Option B replaced. The comment at
`subtype.ts:235` records why `any <: unknown` was refused then: the two
disagreed on `nothing`, which broke transitivity through `list<nothing>`.
That reason disappears once `nothing <: unknown` holds.

### 1.2 Four other operations each read `unknown` differently

| Operation | How it reads `unknown` | Where |
| --- | --- | --- |
| `widen` (join) | Neutral, like `never`: `widen(unknown, integer)` is `integer`, `widen(unknown, missing)` is `missing`. The unresolved part is dropped. | `widen2`, `superType` (`subtype.ts:3965`, `:4251`) |
| Union reduction | Kept as an arm: `unknown \| integer` stays `integer \| unknown`. | `reduceUnionType` (`src/common/type/reduce.ts`) |
| Generic solver join | Absorbing: one `unknown` bound makes the variable `unknown`, ahead of `any`; a top-level one waives the bound check. | `joinBounds` (`src/common/type/instantiate.ts:1869`) |
| Call admission | Admitted without a check, like `any`, decided at run time. | `validateArguments` (`src/compute-engine/boxed-expression/validate.ts:924`) |
| `narrow` (meet) | Resolving: `narrow(unknown, X)` is `X`. | `narrow2` (`subtype.ts`) |

The join is the one that conflicts with the intent. Three open ROADMAP
defects are this one rule:

- `ListJoin(fs, [2])` with `fs: list<unknown>` is typed `list<integer>`
  while its value can be `[Error(…), 2]`.
- `Filter(tu, x ↦ x > 0)` and `Sort(tu)` with
  `tu: tuple<unknown, missing> := (1, Missing)` are typed `list<missing>`;
  the values are `[1]` and `[1, Missing]`. `collectionElementType` joins the
  slots and the join drops the `unknown` slot.
- `[1, Error("x")]` is typed `list<unknown>`, a type that excludes `error`
  elements, so a literal's own type does not contain the literal.

(`Append(tb, 5)` with `tb: tuple`, listed in the same ROADMAP entry as typed
`list<integer>`, is typed `list<any>` today. The entry is outdated for that
example.)

### 1.3 Omitted versus explicit element annotations

Declaration refinement is the placeholder-skeleton mechanism
(`isConstructorPlaceholderType` and `refineConstructorPlaceholder` in
`src/compute-engine/boxed-expression/boxed-value-definition.ts`, the
assignment step in `src/compute-engine/engine-declarations.ts:3772`). It
triggers only when the declared type is one of the five primitive names
`list`, `set`, `dictionary`, `collection`, `indexed_collection`. Measured:

```text
a: list           := [1, 2]        a reports list<integer>; a = ["x"] re-refines to list<string>
b: list<any>      := [1, 2]        b reports list<any>                   (contract, correct)
u: list<unknown>  := [1, 2]        u reports list<unknown>               (no refinement: conflict)
u: list<unknown>  := [1, Missing]  accepted, u reports list<unknown>     (value not in the type)
t: tuple          := (1, Missing)  t reports tuple                       (no refinement)
r: record         := {a: 1}        r reports record                      (no refinement)
d: dictionary     := {a: 1}        d reports dictionary<integer>
lq: list          := [opq(1), 2]   lq reports list  (an unknown element reads as "no evidence")
x: unknown        := 5             x reports integer                     (correct)
f: (unknown) -> unknown := x ↦ x+1 f reports (unknown) -> number          (correct)
```

The explicit `<unknown>` is excluded on purpose (the comment on
`isConstructorPlaceholderType` says explicit content arguments, including
`<unknown>`, do not trigger refinement). That rule was written when
`list<unknown>` normalized to the bare name. It now makes the explicit
inference request inert.

A declared type is never moved by a use: `lb[1] + 1` leaves `lb: list` as
`list`, and `lu[1] + 1` leaves `lu: list<unknown>` as `list<unknown>`. That
part is consistent for all three spellings and should stay (the types guide,
"When Inference Triggers", item 4).

### 1.4 Generic bounds and the unbound fallback (Q7)

- `where T` and `where T: unknown` are one representation: the type builder
  drops a `: unknown` bound (`src/common/type/type-builder.ts:142`) and the
  serializer prints the shorthand (`src/common/type/serialize.ts:373`).
- A variable with no call-site bound and no declared bound is solved to
  `unknown` (`instantiate.ts:1501`) and listed in `unbound`.
- Admission does not depend on the bound: `(list<T>) -> list<T> where T`
  and the same signature with `where T: any` both admit `[1, Missing]` and
  type the call `list<integer | missing>`; `(collection<T>) -> T where T`
  applied to `lu: list<unknown>` types `unknown`, applied to `la: list<any>`
  types `any`. The satisfiability check only reads a declared bound.
- The 19 explicit `where T: any` bounds in `library/collections.ts`
  therefore change only two things: the diagnostic display and the type
  written onto a lazy operand (next point).
- A symbol used as the source of a lazy operator is narrowed to the
  parameter type with the variables read as their bounds: `Filter(zs, p)`
  with undeclared `zs` writes `collection<unknown>` onto `zs`
  (`validate.ts:337`), and `hh: (unknown) -> unknown := xs ↦ Filter(xs, …)`
  reads `(collection<unknown>) -> collection<unknown>`. The write is
  inferred (movable), which is right; the spelling is the narrow third type
  of section 1.1. A test pins it
  (`test/compute-engine/collection-operator-parameter-inference.test.ts`,
  35 lines mention `<unknown>`).

### 1.5 Assignment of an unresolved value

A value typed `unknown` is admitted into any declared symbol without a
check, while a value typed `any` is refused:

```text
opq: (number) -> unknown;  s: string := opq(1)    accepted; s reports string
opa: (number) -> any;      s2: string := opa(1)   refused
```

This is the 2026-08-15 ruling recorded in the types guide. It is coherent
with the marker role (a placeholder cannot refute a contract), but after
the admission `s` reports `string` as if proved. Whether that assignment
should check the value when it is evaluated is the presence question of
Q1 and stays deferred. The arithmetic typing of the two tops also differs:
`opq(1) + 1` is `broadcastable<number>` and `opa(1) + 1` is `any`. That
difference is acceptable: the first is an inference result for an
unresolved operand, the second honors a contract that proves nothing.

### 1.6 Aliases

A transparent alias hides the inference instruction. With
`ce.declareType('L', 'list', { alias: true })`, `al: L := [1, 2]` reports
`L`, not `list<integer>`; the same for an alias of `list<unknown>`. An alias
of `list<any>` reporting `LA` is correct (a contract). The placeholder test
compares the primitive spelling and does not resolve a reference.

### 1.7 Display and serialization

- The three spellings `list`, `list<unknown>`, `list<any>` are distinct type
  nodes and print as written, so a declaration round trip preserves the
  instruction today. A union of two of them is not reduced: `list | list<any>`
  prints as such although they are mutual subtypes.
- An unbound variable is displayed as `unknown` in an `incompatible-type`
  message (`validate.ts:3330`): `idc(5)` for
  `idc: (indexed_collection<T>) -> T where T` reports the expected type
  `indexed_collection<unknown>`. The same call with `where T: any` reports
  bare `indexed_collection`. The ROADMAP asks for a display contract.
- A union with an unresolved arm prints the arms alphabetically:
  `missing | unknown`.
- `declaredType` of a refined symbol returns the refined type
  (`list<integer>`), not the written contract (`list`); the contract is only
  reachable through the internal skeleton.

### 1.8 Documentation that still describes the old rule

- `doc/08-guide-types.md` (gitignored, local) still says bare `list` is
  `list<unknown>` and `list<any>` is strictly wider (lines 193, 535 to 545,
  2395 to 2410), and the diagram and the `unknown` section describe the
  four exclusions as current.
- `docs/INFERENCE_ROADMAP.md` lines 4, 27 and 38 say the same.
- The ROADMAP audit list names the code comments still to correct.

### 1.9 Library signatures that spell `unknown`

Counts by grep over `src/compute-engine/library`: 43 `-> unknown` result
slots, 21 `(unknown …` parameter slots, 7 `(any) -> unknown` callback slots,
reducer callbacks spelled `(unknown, T) any -> unknown`, one
`tuple<string, unknown>` entry type, a few `collection<unknown>` in
comments. They fall into three groups, to be inventoried one by one in
slice 5:

1. A result slot on an operator that has a type handler: the handler types
   the call, and the slot is a placeholder that means "ask the handler".
2. A result or parameter slot on an operator without a handler: an opaque,
   unrestricted value. Under the agreed rule this is `any`.
3. A relationship between positions, such as a reducer accumulator
   `(unknown, T) -> unknown` with `initial: value`: a named variable
   (`(A, T) -> A` with `initial: A where A`) states the relationship;
   `unknown` cannot.

## 2. Recommended rules (plain language)

R1. **`unknown` is a type still to be inferred, not a set of values.** Every
contract is a set of values: `any` (everything), `expression`, `value`,
`integer`, `list<integer>`, and so on. A bare family name is a contract on
the kind only (`list` is `list<any>`).

R2. **Where `unknown` can be written, that position is refined by evidence:**

| Written | Meaning | Today |
| --- | --- | --- |
| `x: unknown` | Same as no annotation; refined by assignments and uses | yes |
| `f: (unknown) -> unknown` | Each slot refined by the assigned body | yes |
| `xs: list<unknown>`, `set<unknown>`, `dictionary<unknown>`, `collection<unknown>`, `indexed_collection<unknown>` | Element slot refined by each assignment, exactly like the bare name; the kind is the contract | no |
| `t: tuple`, `r: record` (bare) | Slot and field types refined by each assignment; the kind is the contract | no |
| `tuple<unknown, integer>`, `record{a: unknown}`, `list<list<unknown>>` | A nested position refined by assignment | no; see D2 for the scope |
| `where T` | An inference variable; `where T: unknown` is the same thing | yes |
| A computed `unknown` (an unbound variable's fallback, a read from an unresolved element, a `-> unknown` result with no handler) | Unresolved: admitted anywhere, proves nothing, refined downstream | partly (see R4) |

Examples of developer-visible behavior under R2:

```text
xs: list<unknown> := [1, 2]          xs reports list<integer>; xs = ["a"] re-refines to list<string>
xs: list<unknown> := [1, Missing]    xs reports list<integer | missing>
xs: list<expression> := [1, Missing] refused (immediate missing is excluded by the contract)
xs: list<any> := [1, 2]              xs reports list<any>
t: tuple := (1, Missing)             t reports tuple<integer, missing>; t = (1, 2, 3) re-refines
r: record := {a: 1}                  r reports record{a: integer}
type L = list;  a: L := [1, 2]       a reports list<integer>  (the alias carries the instruction)
type LA = list<any>; b: LA := [1, 2] b reports LA
```

R3. **Admission and proof.** `X.matches('unknown')` is true for every `X`,
including `missing`, `nothing`, `error` and `any`: an unresolved position
may still turn out to hold anything. `'unknown'.matches(Y)` is true only
for `Y = any`, `Y = unknown` and a union with such an arm: an unresolved
type never proves a contract. `couldMatch('unknown', Y)` is true for every
`Y`. As sets of values `unknown` and `any` are then the same top, two
spellings with different instructions, exactly as bare `list` and
`list<any>` are today. The relation stays a partial order: the
non-transitivity that refused `any <: unknown` in August came from
`nothing` being below `any` but not below `unknown`; R3 removes that
disagreement.

R4. **A join keeps the unresolved part.** `widen(unknown, integer)` is
`integer | unknown`; `widen(unknown, missing)` is `missing | unknown`. A
union never absorbs an `unknown` arm into a known arm or a known arm into
`unknown` (the reducer already does this). A meet resolves:
`narrow(unknown, integer)` stays `integer`. Consequences:

```text
ListJoin(fs, [2]) with fs: list<unknown>     typed list<integer | unknown>   (today list<integer>)
Filter(tu, p) with tu: tuple<unknown, missing> typed list<missing | unknown>  (today list<missing>)
[1, Error("x")]                              typed list<error | integer>     (today list<unknown>: a literal's type is known)
```

R5. **A read from an unresolved element stays unresolved and keeps a
possible miss visible.** `First(xs)` with `xs: list<unknown>` is
`missing | unknown`. This is the ROADMAP design item "a `missing` arm for an
access over `any` or `unknown` elements" (44 tests measured on 2026-10-20,
with Epsil static errors in `programs.test.ts`). It is the diagnostic
policy of Q3, so it stays deferred; R4 makes the representation available
when Q3 is decided.

R6. **Display.** `unknown` prints as `unknown`. A refined symbol prints its
refined type; its declaration serializes the annotation as written (bare,
`<unknown>` or `<any>`). An editor hover shows the refined type and, when
the symbol has a skeleton, the written contract next to it ("declared
`list`"). An unbound generic variable in a diagnostic is shown by its name
as the signature wrote it (D5).

R7. **Aliases.** A transparent alias carries the inference instruction of
its definition. An opaque (nominal) type does not.

R8. **Library signatures.** `any` for an unrestricted input or an opaque
result; `unknown` only where a type handler or a body refines the slot; a
named variable for a relationship between positions.

R9. **The unbound fallback stays `unknown` (Q7).** With R3 an unbounded
variable admits what `any` admits, and `unknown` keeps the "to be inferred"
reading downstream. The 19 `where T: any` bounds in `collections.ts` become
equivalent to `where T`; leave them, and stop adding new ones for admission.

## 3. Decisions for the user

Each decision names what happens if nothing is decided.

**D1. Subtype reading of `unknown` (R3).** Make `missing`, `nothing`,
`error` and `any` subtypes of `unknown`.
Example: `xs: list<unknown> := [1, Missing]`. Today the value is admitted by
the lenient absence rule but its type `list<integer | missing>` is not a
subtype of the declaration. Under R3 it is.
Recommended: yes. No decision: `list<unknown>` stays a third, narrower
content contract, and Q8 stays open; D2 cannot be implemented coherently
without it.

**D2. Explicit `<unknown>` requests inference (R2).** Make `list<unknown>`
and the other four families refine from assignment like the bare name.
Recommended: yes, top-level element slot first. Nested positions
(`tuple<unknown, integer>`, `list<list<unknown>>`, `record{a: unknown}`)
in a later slice; until then a nested `unknown` is unrestricted and not
inferred, and the types guide says so. No decision: the explicit request
stays inert.

**D3. Bare `tuple` and `record` refine from assignment.** `t: tuple :=
(1, Missing)` reports `tuple<integer, missing>`, `r: record := {a: 1}`
reports `record{a: integer}`; each re-assignment re-refines; the contract
stays the bare kind. Without this, `t[1]` types `any` for the lifetime of
`t`. Recommended: yes. No decision: the two kinds stay opaque after
assignment, unlike the five others.

**D4. Joins keep the unresolved arm (R4).** Changes displayed types where an
`unknown` meets a known type; fixes three ROADMAP defects. Recommended:
yes, with the full-suite blast radius measured and reported before
landing. No decision: the three defects stay open.

**D5. Diagnostic display of an unbound generic variable.** Options:
(a) the variable's name as written, `expected indexed_collection<T>`
(recommended: it never lies and tells the author the slot is generic);
(b) the bare family name, `indexed_collection`;
(c) today, `indexed_collection<unknown>`.
No decision: (c), and the display differs by whether the library wrote
`: any`.

**D6. Library signature cleanup (R8).** After the inventory of slice 5,
rewrite the group 2 slots to `any` and the group 3 slots to named
variables. Affects hovers and `library.md`, not behavior. Recommended: yes,
last. No decision: the documentation keeps calling opaque results `unknown`.

Deferred on purpose, with the question that owns them: the `missing` arm on
a read from an `unknown` or `any` element (Q3); checking an admitted
unresolved value when it is evaluated (Q1).

## 4. Implementation slices

Each slice is one worktree, one dual review, full suite measured under the
box lock with the snapshot count reported. The slices are ordered by
dependency; 1 and 2 can be reviewed together.

**Slice 1: the relation (D1).** `subtype.ts` rules at 245 and 2503,
`couldMatch`, the `narrow` comment at 3897, `isScalarTopElement`, and the
`broadcastable`/negation gap fix becomes unnecessary (both already hold).
Update `doc/08-guide-types.md` (diagram, the `unknown` section, the
element-annotation table, the bare-constructor section),
`docs/INFERENCE_ROADMAP.md` header, `docs/ERROR-MODEL.md` if it states the
exclusions, and the `subtype.ts` comments that give the August reasons.
Acceptance:
- `missing`, `nothing`, `error`, `any` match `unknown`; `unknown` matches
  `any` and `unknown` only.
- `list`, `list<any>`, `list<unknown>` are mutual subtypes;
  `list<integer | missing>` matches all three; `list<unknown>` does not
  match `list<expression>`.
- The transitivity and `couldMatch` sample of the collection plan (79
  types) reports no violation through `unknown`.
- Full suite: failures triaged as outdated expectations or defects; no
  `@fixme` snapshot updated.

**Slice 2: declaration refinement (D2, D3, R7).** `isConstructorPlaceholderType`
accepts the `<unknown>` composite forms and bare `tuple`/`record`;
`refineConstructorPlaceholder` gains tuple slot and record field cases and
keeps an `unknown` element as the arm the value gives it; the skeleton test
resolves a transparent alias. Epsil `let x: list<unknown> = …` goes through
the same route (check the typed-`let` upgrade in `execute-epsil.ts`).
Acceptance:
- The R2 example table holds on the `ce.declare`/`ce.assign` route, the
  `Declare`/`Assign` MathJSON route and the Epsil `let` route.
- Re-assignment re-refines; an explicit `list<any>` or `list<integer>`
  never moves.
- `Declare` serialization round trip preserves each of the three spellings
  and an alias name.
- `typeof` and the editor hover show the refined type.

**Slice 3: joins (D4).** `widen2` and `superType` in `subtype.ts`; the
element joins in `collectionElementType` (`src/common/type/utils.ts:563`),
`joinedElementTypeD` and `shapedListTypeD` (`library/collections.ts`); the
list-literal typing of a cell typed `error`.
Acceptance:
- The three R4 examples; the value of each is a member of its static type.
- `[1, Error("x")]` is `list<error | integer>`; `[opq(1), 2]` is
  `list<integer | unknown>` and `lq: list := [opq(1), 2]` reports it.
- Blast radius measured and reported before landing.

**Slice 4: display and the lazy-operand write (D5, R6).** `validate.ts:3330`
display bindings; the lazy narrowing at `validate.ts:337` writes the bare
family (`collection`) instead of `collection<unknown>`; the
`collection-operator-parameter-inference` pins updated; the hover text in
`vscode-epsil` shows the written contract beside the refined type.
Acceptance:
- `idc(5)` reports `expected indexed_collection<T>` (or the chosen option).
- `Filter(zs, p)` writes `collection` onto `zs`; `zs := [1, "a", 2]` is
  still accepted afterwards (the anchor pin of the parameter-side callback
  ruling).
- A `where T` and a `where T: any` signature display the same way.

**Slice 5: library inventory and cleanup (D6, R8).** A table in this
document classifying every `-> unknown` and `(unknown` library slot into
the three groups of section 1.9; then the rewrites, `npm run doc`, and a
CHANGELOG entry that lists the changed public signatures.
Acceptance: no test asserts a changed behavior, only changed signature
text; `library.md` regenerated.

Later slice, after 2: nested `unknown` positions refine (D2 scope).

## 5. Implementation record (2026-10-21)

What landed, measured against the full suite on a clean-HEAD worktree
(59 failures on HEAD, all in `collection-type-followups`,
`collection-absent-followups`, `map-over-tuple-result` and
`tuple-argument-binding`, none of them touched by this work; 0 of 4,271
snapshots changed):

- **D1** as decided: `isSubtype(X, 'unknown')` is true for every `X`
  (`isPrimitiveSubtype` and `isSubtype`, `subtype.ts`); `unknown` matches
  only `any` and itself. Every site that read `isSubtype('nothing' |
  'missing' | 'error', t)` as EVIDENCE (a tuple slot that may hold `Nothing`,
  a callback that may return it, a compiler refusal of an omission-capable
  source) now asks `provablyAdmits(marker, t)`, which ignores an `unknown`
  arm; the sites that read it as "not proven safe" keep `isSubtype`. Two
  consequences of the new edges needed their own rule: a lambda whose
  parameters are not inferred yet (`(unknown, unknown) -> number`) must not
  satisfy `(any, any) -> number` (`acceptsParameter` in the signature rule
  keeps the pre-D1 verdict: such a parameter accepts an `expression`, not
  `any` or a marker), and an operand typed `error` with no error value is
  refused on the strict pass of an overload trial at a parameter that reads
  `unknown`, so the overlap pass still reads the generic arm's result at its
  bound (`strictTrialRefusesUnheldError`, `validate.ts`; `takesByOverlap`,
  `overload.ts`).
- **D2, D3, R7** as decided: `placeholderSkeletonOf()`
  (`boxed-value-definition.ts`) reads the bare families, their explicit
  `<unknown>` forms, bare `tuple`/`record` and a transparent alias of any of
  them; `refineConstructorPlaceholder()` refines tuple slots and record
  fields. A declared `x: unknown` assigned a literal still promotes
  (`engine-declarations.ts`: an `unknown` incumbent is not joined).
- **D4 narrowed** (confirmed by the user on 2026-10-22). The general join
  (`widen`) keeps `unknown` NEUTRAL: the
  first measurement, with the arm kept everywhere, failed about 60 tests in
  20 suites, because the inference joins read `unknown` as "no information
  yet" (the seed of a recursion fixpoint, the result of a call whose callee
  is not derived yet), and the arm spread `| unknown` through every derived
  signature (`F: (unknown, unknown) -> list<number | unknown>` for a
  list-building recursion). The arm is kept where the join is derived from a
  VALUE: `joinUnresolvedArm()` (`subtype.ts`) for the slots of a tuple
  (beside markers only, so a free symbol in a point stays a numeric slot and
  `Third((1, x))` out of range is `NaN`) and for the element join of
  `ListJoin`/`Join` (an operand whose whole type is `unknown` stays neutral).
  The union reducer absorbs a value arm into `unknown` (`integer | unknown`
  is `unknown`) and keeps a marker arm (`missing | unknown`), so the
  representation R5 needs exists. Developer-visible results: `ListJoin(fs,
  [2])` with `fs: list<unknown>` is `list<unknown>` (not the `list<integer |
  unknown>` of section 2); `Filter(tu, p)` is `list<missing | unknown>`;
  `Sort(tu)` stays `list<missing>` (ROADMAP).
- **D5 (a)** as decided: `validate.ts` and `overload.ts` display an unbound
  variable by its name.
- **D6 not applied.** The rewrite is not behavior-free, which section 3
  claimed: a library result slot `-> any` is a contract that stops downstream
  inference (`f(1) + 1` is `any`, where `-> unknown` gives
  `broadcastable<number>`), and a parameter `any` narrows an inferable
  operand to `any`. The inventory below (a heuristic scan of `signature:`
  strings in `src/compute-engine/library`; "handler" means a `type:` handler
  was found in the same definition) is the starting point for a per-site
  review; no signature was changed.
- **D6 measured (2026-10-22)**, from the definitions themselves
  (`STANDARD_LIBRARIES`, each `signature` parsed with `parseType()`, the
  type of each documented example read from the boxed example before
  evaluation). Of the 656 library signatures, 44 spell `unknown`:
  - 24 have the result `unknown`, and 21 of them have a `type` handler. A
    handler's answer replaces the signature's result, so for these 21 the
    `-> unknown` slot is only the fallback when the handler gives up. The
    examples are resolved (`Coalesce`, `AssertPresent`, `Typed`, `Field`,
    `At` are `integer`; `Evaluate` and `N` are numeric), except `Hold` and
    `ReleaseHold` (opaque on purpose) and `Pipe` whose stage is an operator
    name (`16 |> Sqrt` is `unknown`; a defect, in `ROADMAP.md`). Rewriting
    these slots to `-> any` changes only the fallback, and there it stops
    inference instead of leaving the type open.
  - 3 have the result `unknown` and no handler: `Spread`, `FixedPoint` and
    `MemberCall`. For these the slot is the type, and `-> any` would stop
    the inference after the call.
  - 11 spell `unknown` in a parameter: `Block` (`unknown*`), `Dictionary`
    (`tuple<string, unknown>*`), and the callback slots of `Reduce`, `Fold`,
    `Scan` (`(unknown, T) -> unknown`) and of `Ordering`, `MaxBy`, `MinBy`,
    `ArgMax`, `ArgMin`, `GroupBy` (`(T) -> unknown`). Under D1 every result
    type is below `unknown`, so a callback result `-> unknown` accepts every
    result, as `-> any` does. An annotated callback is accepted:
    `reduce([1, 2, 3], (acc: integer, x: integer) => acc + x, 0)` is `6`
    with no diagnostic, and so are `fold` and `maxBy` with typed callbacks.

  Conclusion: the rewrite to `any` changes the documentation text and, where
  a handler gives up or is missing, removes inference. It is not applied.
- Documentation: the types guide (local), `docs/INFERENCE_ROADMAP.md`,
  `docs/ERROR-MODEL.md`, `ARCHITECTURE.md` (API trap) and `CHANGELOG.md`.
- Not done: the Epsil hover does not show the written contract beside the
  refined type (R6); a nested `unknown` position does not refine (D2 scope).
  Both are in `ROADMAP.md` under the `unknown` residues.

### Library signatures that spell `unknown`

| File | Operator | Signature | Type handler |
| --- | --- | --- | --- |
| `collections.ts` | `?` | `(value: indexed_collection<any> \| dictionary<any>, index: (number \| string \| character \| boolean \| indexed_collection<any>)+) -> unknown` | no handler |
| `collections.ts` | `Dictionary` | `(tuple<string, unknown>*) -> dictionary` | no handler |
| `collections.ts` | `Reduce` | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T` | handler |
| `collections.ts` | `Fold` | `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T` | no handler |
| `collections.ts` | `Scan` | `(indexed_collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T` | handler |
| `collections.ts` | `Field` | `(value: any, field: string) -> unknown` | handler |
| `collections.ts` | `MemberCall` | `(receiver: any, member: string, arguments: any*) -> unknown` | no handler |
| `collections.ts` | `At` | `(value: any, index: (number|string|character|boolean|indexed_collection<any>)+) -> unknown` | handler |
| `collections.ts` | `Ordering` | `(indexed_collection<T>, order: (((T) any -> unknown)` | ((any, any) any -> number | boolean))?) -> list<integer> where T: any | no handler |
| `collections.ts` | `Sort` | `((T, order: (((character) any -> unknown)` | ((character, character) any -> number | boolean))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> number | boolean))?) -> list<T> where T: any) | no handler |
| `collections.ts` | `MaxBy` | `(collection<T>, key: (T) any -> unknown) -> value where T` | handler |
| `collections.ts` | `MinBy` | `(collection<T>, key: (T) any -> unknown) -> value where T` | handler |
| `collections.ts` | `ArgMax` | `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | no handler |
| `collections.ts` | `ArgMin` | `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | no handler |
| `collections.ts` | `ChunkBy` | `((S, key: (character) any -> unknown) -> list<string> where S: string) & ((indexed_collection<T>, key: (T) any -> unknown) -> list<list<T>> where T: any)` | no handler |
| `collections.ts` | `GroupBy` | `(collection<T>, key: (T) any -> unknown) -> dictionary<list> where T` | handler |
| `control-structures.ts` | `?` | `(unknown*) -> unknown` | handler |
| `control-structures.ts` | `Which` | `(expression+) -> unknown` | handler |
| `control-structures.ts` | `Match` | `(expression, expression+) -> unknown` | handler |
| `control-structures.ts` | `FixedPoint` | `(any) -> unknown` | no handler |
| `core.ts` | `Unevaluated` | `(any) -> unknown` | handler |
| `core.ts` | `Coalesce` | `(any+) -> unknown` | handler |
| `core.ts` | `Hold` | `(any) -> unknown` | handler |
| `core.ts` | `ReleaseHold` | `(any) -> unknown` | handler |
| `core.ts` | `Typed` | `(any, string` | symbol) -> unknown | handler |
| `core.ts` | `Object` | `(any, string?) -> unknown` | handler |
| `core.ts` | `Spread` | `(any) -> unknown` | no handler |
| `core.ts` | `Apply` | `(name:any, arguments:any*) -> unknown` | handler |
| `core.ts` | `ApplyWhole` | `(name:any, arguments:any*) -> unknown` | handler |
| `core.ts` | `Pipe` | `(value, function) -> unknown` | handler |
| `core.ts` | `ProtocolMember` | `(protocol: string, member: string, arguments: any*) -> unknown` | handler |
| `core.ts` | `ProtocolProperty` | `(protocol: string, property: string, receiver: any, value: any?) -> unknown` | handler |
| `core.ts` | `Evaluate` | `(any) -> unknown` | handler |
| `core.ts` | `EvaluateAt` | `(function, lower:expression, upper:expression) -> unknown` | handler |
| `core.ts` | `N` | `(any, (integer` | list<number>)?) -> unknown | handler |
| `core.ts` | `NumericApproximation` | `(any) -> unknown` | handler |
