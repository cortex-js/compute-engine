# Compute Engine — Roadmap

This file lists the work that remains: open defects, performance problems,
missing capabilities, design questions and tasks. When an item is done, remove
it. `CHANGELOG.md` and the git history keep the record of finished work.

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

Next free reference: CE-474.

**Entry format.**

```markdown
### CE-<n>. <What is wrong, or what to do>

**Status:** <state>; <kind>[, <size>].[ <decision>.][ <links>.]

<The input, what happens today, what should happen, the cause and the
proposed fix.>

- **CE-<n>.1** <A sub-item that can be fixed alone.>
```

- `<state>` is `open`, `in progress`, `decision needed`, `design needed`,
  `on demand` (do it when a user asks for it) or `deprioritized`.
- `<kind>` is `defect`, `wrong value` (a defect that gives a wrong result with
  no error), `performance`, `capability`, `design`, `task` or `documentation`.
- Record a user decision with its date. Link the plan document, the GitHub issue
  or PR, and the Tycho ledger row when there is one.
- Write what a person needs to do the work: a reproduction, the cause, the files
  and functions, the options and their costs. Do not record who found the item,
  when, or how.

**Finished work.** When an entry is done, delete it. When a sub-item is done,
delete its bullet and keep the numbers of the other sub-items. When part of an
entry is done, change its text to say only what remains.

**Related documents.** `docs/epsil/ROADMAP.md` (Epsil language and tools),
`docs/TYPE_SYSTEM_ROADMAP.md` and `docs/INFERENCE_ROADMAP.md` (type system),
`docs/rubi/RUBI.md` (Rubi integration rules), `docs/fungrim/FUNGRIM.md` (Fungrim
identities), `docs/mathnet/README.md` (MathNet parser corpus),
`benchmarks/README.md` (benchmarks), `docs/plans/` (plans and design records).

## Sections

- [Tycho ledger asks](#tycho-ledger-asks) (CE-1 to CE-2)
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

## Tycho ledger asks

### CE-1. A `window` option of the `grid` layout of `broadcast`

**Status:** on demand; capability. Waits for a measurement by Tycho. Part (3) of
Tycho row 416, which Tycho closed at 0.160.0 with this part not done.

The `grid` layout already has shared inputs and several outputs per cell (parts
1 and 2 of the row). Part 3 is a `window` option that names the neighbours of a
shared input by offset. It would also let the worker pool chunk the grid by
slabs with a one-cell halo. It waits until Tycho measures its two kernels on the
stride layout and shows that the option gives more speed: the neighbours are
index arithmetic on the shared array, and the halo chunking follows from the
shared input.

Tycho's kernels: a cell kernel of thirteen numbers (the case index 0 to 255 and
twelve edge fractions `F_a / (F_a - F_b)`, NaN on an edge with no sign change)
and a point kernel of three (the gradient by central differences of the shared
array, one-sided on the boundary), in two passes over the grid. Eight to
twenty-seven `_SYS.atNumeric` reads per cell are acceptable. A direct
typed-array read for an index that is provably in range is a later optimization
of the same kernels.

### CE-2. Ask Tycho to read a user function whose result can be absent as scalar

**Status:** open; task. Waits for Tycho. Request filed 2026-10-22 in
`~/dev/tycho/docs/COMPUTE_ENGINE.md`, section "Standing Tycho-side follow-ups".
Close CE-2 when Tycho reports there that the request is done (or that the
problem does not occur on its installed release). Report:
`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-09-report.md`
(records in `ce-0.127.0.json` of that folder, CE 0.127.0).

- **CE-2.1** A user function declared `-> unknown` types `broadcastable<number>`
  through every broadcastable head (`\sin(u(t))` for `u: (unknown) -> unknown`,
  with the body assigned in ANOTHER scope). This causes the audit's largest item
  (465 `_SYS.bcast` sites, 42 `PointList` declines on GLSL). Tycho's importer
  keeps the declared `-> unknown` result wide unless the body's type
  `matches('number')`, and `missing | number` (a piecewise with no default)
  fails that test. The CE typing is correct: a piecewise with no default keeps
  its `missing | T` type (decision 2026-09-09). The fix is on Tycho's side: read
  `missing | T`, with `T` numeric, as a scalar result. On CE main (2026-10-22),
  with the body assigned in the scope that reads it, `u(t)` is
  `missing | real<0..>` and `\sin(u(t))` is `number`; with only the declaration
  visible, `\sin(u(t))` is still `broadcastable<number>`. The request asks Tycho
  to measure again on 0.161.0 first.
- Known difference that stays: `g(3) + 0` evaluates to `Missing` while
  `g(3) + 1` evaluates to `NaN`, because the identity element is dropped at
  canonicalization (`g(3) + 0` IS `g(3)`).
- The piecewise decidedness guard `(v === v) ? … : NaN` stays, although Tycho's
  item 276 asks to drop it. `Which(Equal(NaN, 5), 1, True, 0)` is `Missing` in
  the interpreter, so the compiled piecewise must answer `NaN` when the compared
  value is `NaN`; without the guard `NaN === 5` is `false` and the else arm
  answers. `compile-equality-exact.test.ts` pins the interpreter's `Missing`.
- Not CE's: the inline `At` lambda (Tycho's own override), the "Unknown
  operator" declines (importer binding), and the 2× re-compile of every declined
  row.

## Types and type inference

### CE-472. The derived type of a call does not check the arguments against a declared signature

**Status:** open; defect.

With `k` declared `(tuple<number, number>) -> number` and assigned a function
literal, the boxed `k(3)`, `k(True)`, `k(NaN)` and `k([1, 2])` are typed `error`
(`validateArguments`, `boxed-function.ts`), but
`deriveApplicationType(ce, 'k', …)` gives `number` for all of them: the value
branch of `deriveApplicationType()`
(`boxed-expression/derive-application-type.ts`) never checks the operands
against a declared signature. A type derived for a function literal that calls
`k` can then miss the error. Fix: the same contract check in that branch as on
the boxed route. An INFERRED signature is not a contract and keeps its own rules
(`inferredCallSignature()`, `call-result-type.ts`).

### CE-3. `unknown` as an inference marker: what the migration left open

**Status:** open; defect, small. Plan:
docs/plans/2026-10-21-unknown-inference-marker.md. User decision 2026-10-23:
decision D6 is not applied (the library keeps `-> unknown`), so CE-3.4 is
closed.

The plan (decisions D1 to D6) makes `unknown` an inference marker. A declared
`unknown` is an inference seed that each use narrows (user decision 2026-10-20).
The declaration for a list of unknown content is `list<value>`, not `any` or
`list<any>` (user decision 2026-10-21).

- **CE-3.5** A nested `unknown` position (`tuple<unknown, integer>`,
  `list<list<unknown>>`, `record{a: unknown}`) is unrestricted and does not
  refine from an assignment yet (scope of decision D2).

### CE-4. `record{a: integer}` against `dictionary<integer>` constrains only the listed fields

**Status:** open; defect.

The open-record relation constrains only the listed fields when it compares
`record{a: integer}` with `dictionary<integer>`. But width subtyping permits
more fields with other value types. Enumeration also reports only the types of
the listed fields. Correct this together with the exact validation of a
dictionary literal: a change of the relation alone rejects valid dictionary
literals and assignments. Measured 2026-10-24 together with CE-10: the sound
rule (a record fits `dictionary<T>` only when `T` admits `any`) makes 61 tests
fail in 10 suites, most of them real regressions (a synthesized record against a
dictionary annotation, `Filter`/`Dedup` over a dictionary, Epsil JSON aliases,
named-argument calls through a constant receiver).

### CE-10. A record with an extra `any` field breaks subtype transitivity

**Status:** open; defect, small. Plan:
`docs/plans/2026-10-20-bare-tuple-record-any.md`.

- **CE-10.1** Five transitivity violations through a record with an extra field
  of type `any`:
  `record{a: integer, b: any} <: record{a: integer} <: dictionary`, but the
  first is not `<: dictionary`. Record-to-record allows extra fields;
  record-to-dictionary checks every field. Decision Q6 of the plan keeps open
  records with width subtyping, so a record is not a dictionary of its known
  field types. That rule for explicit value types (`record{a: integer}` no
  longer `<: dictionary<integer>`) makes 44 tests fail in 4 suites (`types`,
  `collections`, `compile-extremum-collection-operand`,
  `named-arguments-record-field`), and the bare-name cases also involve
  `unknown`. Do this with the plan's implementation. Measured again 2026-10-24:
  see CE-4 (61 failing tests in 10 suites, mostly real regressions).

### CE-27. An access over `any` or `unknown` elements has no `missing` arm

**Status:** design needed; design. User decision 2026-10-20: a design item, not
a small fix.

`First(W)` with `W: list<any> := []` is typed `unknown`, but evaluates to
`Missing`. Making `withMarker` answer `any` for `any` and `missing | unknown`
for `unknown` broke 44 tests in 14 suites (measured 2026-10-19). Two assert
`unknown` directly (`types.test.ts:2683` `At(anIndexed, 1)`,
`missing-value.test.ts:195` `At(Missing, 1)`). The `missing` arm then flows into
use-driven inference, so Epsil reports `sol[1][1]` as a static error
(`programs.test.ts`). Question: how should a `missing` arm on an access result
flow through inference?

### CE-30. A polymorphic callback over rows is typed `unknown` cells

**Status:** open; defect, small.

`Map(k, fs)` with `k: ((integer) -> T) -> T where T` and `fs := [[x ↦ x + 1]]`
is typed `matrix<unknown^(1x1)>` for the value `[[2]]`; expected
`matrix<number^(1x1)>` (the flat `fs1 := [x ↦ x + 1]` gives `vector<1>`).
`broadcastCallbackResultType` (`callback-broadcast-admission.ts`) declines
because `signatureParamsAreScalar` is false for an arrow parameter, but the
evaluation maps over the rows. A fix must find which mapping the run time does
and solve `T` with `inferTypeArguments`.

### CE-36. A signature derivation inside a cached type read can miss a widening in its own scope

**Status:** open; defect, small.

A value-type inference advances the `any` version only when no cached
computation is running (`runWhenIdle`), so that it does not retire the type
being computed. A derivation reached from a `_type` read runs inside one. A type
that its body cached before a WIDENING of one of its own temporary symbols can
then be read once more, and the memoized result may be narrower than it should
be. No reachable witness was found. Closing it needs an immediate advance for a
widening inside the derivation's scope, which the deferred design avoids on
purpose.

### CE-38. A mutually recursive pair that builds a list is typed `collection` when it is not declared

**Status:** open; defect, small.

The list hypothesis of `_deriveSignature` runs only for a body that names its
own function. With `F: (unknown, unknown) -> unknown` assigned
`(n, K) ↦ { n = K - 1: [n], otherwise: join([n], G(n + 1, K)) }` and `G`
assigned `(n, K) ↦ F(n, K)`, both derive `-> collection<number>` (pinned in
`recursive-function-result-type.test.ts`).

A pair that is also self-recursive (`F` names `F` and `G`) does not improve
either: `G`'s signature is derived while `F`'s is, reads the re-entrancy guard's
`unknown` for `F`, and is memoized as `-> unknown` (measured 2026-09-29: `F` is
`-> collection<number>` and `G` stays `-> unknown` on later reads). So the
hypothesis pass reads `unknown` from `G` and is refuted.

A declared pair is now typed `-> list<number>` (the hypothesis follows the
callees, and a derivation that reads a provisional signature stores no memo).
What remains is an UNDECLARED pair, which is typed at install, in order:
assigning `F` then `G` gives `collection<number>` for both; `G` then `F` gives
`list<any>`.

### CE-39. Static types that do not contain the value of the expression

**Status:** in progress; defect. CE-39.1 still needs a decision; CE-39.2, 39.3,
39.4 and 39.6 were decided on 2026-10-25.

The probes check `isSubtype(value type, static type)`. These defects are in code
that existed before the result type handlers of `FindRoot`, `FindFit`, the
linear-algebra operators, the trigonometric rewrites and `TupleFrom`.

- **CE-39.1** A float cell can be typed `integer`, so a handler that claims
  `rational` is not sound (decision needed). A parsed `2.0` is typed `integer`,
  and `1.5e308` is too. `Inverse` and `MatrixPower` with a negative exponent
  claim `rational` cells: `Inverse` of `[[2.0, 1], [1, 3]]` is typed
  `matrix<rational^(2x2)>`, and its value is `matrix<real^(2x2)>`. `Determinant`
  of `[[2.0, 1/3], [1, 3]]` is typed `rational`, and its value is a float. The
  matrix product of the same operands has the same defect. The new handlers use
  a table that never claims `rational` from a product or a quotient
  (`matrixResultCellType`, `library/linear-algebra.ts`). The options: the older
  handlers use the same table, or a float literal stops being typed `integer`.
- **CE-39.2** (decision needed again: option (a), decided 2026-10-25, was
  implemented in a worktree and loses precision in nested expressions; see the
  end of this item) The range of a sum with a float operand does not contain the
  value type. `2.0 + 1/3` is typed `real<2.329..2.341>`, and its value is typed
  `real<2.3..2.4>`, which is not a subtype of it: a computed value that is not
  exactly a double gets a range with two significant digits (`ENCLOSURE_DIGITS`,
  `boxed-number.ts`). Options: (a) round the static ranges outward to the same
  grid (many pinned range types change); (b) give computed values a tighter
  range (undoes the compact-type design). The nightly soundness grid compares
  the value with the static range, so it passes. Measured 2026-10-25 with option
  (a) (outward rounding in `attachInterval`, `numerics/interval-arithmetic.ts`):
  the value types hold, but the rounding adds up through nested subexpressions.
  `√(1 − ((k − 0.5)/40)²)` for `k` from 1 to 40 becomes `complex` (it was
  `real`): `(k − 0.5)/40` is `real<0.012..1.1>`, its square `..1.3`, so `1 − …`
  is `real<-0.31..1>`. Two tests fail on it. Options: (i) accept the loss; (ii)
  the handlers read unrounded internal intervals and only the reported type is
  rounded (a separate internal range channel, a larger change); (iii) return to
  the old ranges and compare the value with the range in the nightly check.
- **CE-39.3** (decision needed again: option (b), decided 2026-10-25, does not
  work; see the end of this item) With `x := 0.5`, `Tuple(Abs(x))` is typed
  `tuple<real<0..>>`, and its value `(0.5)` is typed `tuple<real>`, because a
  literal in a composite is typed by its tier without a range.
  `composite-type-synthesis.test.ts` ("non-literal components keep their own
  claims") and the comment of `storedComponentTypeD` keep the range on purpose.
  Options: (a) strip ranges from the component types of composites (loses
  information); (b) type literal components with a sign range (changes the value
  type of every list literal). The same gap: `Abs([1, 2])` is typed
  `list<integer<0..>^2>`, its value `vector<integer^2>`. Also
  `Tuple(Range(1, 3))` is typed `tuple<range>`, and its value
  `tuple<vector<integer^3>>`. Typing the component `list<integer>` made a
  variable declared `list<range>` refuse `[Range(1, 3)]`, and admitting the
  literal stored `[[1, 2, 3]]`, which is not in `list<range>`: a fix must decide
  what a `list<range>` declaration holds. Measured 2026-10-25 with option (b):
  830 tests fail in 152 suites, and it makes a new gap in the other direction.
  With `f := x ↦ 2x + 1` declared
  `(broadcastable<number>) -> broadcastable<number>`, `f([1, 2, 3])` is typed
  `list<integer<1..>^3>` while its value is typed `list<integer<0..>^3>`: the
  handlers derive tighter ranges from sign-ranged cells than the value carries.
  Remaining options: (a) strip ranges from composite components; (c) accept the
  gap (recommended).

### CE-40. The type of a held operand of a lazy operator is read without its binding

**Status:** open; defect.

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

### CE-42. Accessors keep an absent member when the operand length is not proved

**Status:** open; defect.

`First`, `Second`, `Third`, `Last` and `At` with a literal index lose their
absent member when the operand is proved to hold the position. The proof reads
the length from a list type with a length, a list literal, a string literal, a
`Range` with literal bounds, and `Rest`/`Most`/`Take`/`Drop` of those
(`provenLengthD`, `library/collections.ts`).

- **CE-42.3** A position proved NOT to exist keeps `T | marker(T)` when the
  elements are not numbers, although its value is always the marker (a numeric
  position is typed `nan`: `At([7, 8, 9], 99)`). A chained read (`M[7][1]` over
  a matrix) chooses `NaN` or `Missing` from the element type that the inner
  access states, so the row type must stay.

### CE-43. The static type of a block local narrowed by a use depends on statement order

**Status:** open; defect, small.

The re-read of `let`/`Assign` value types (`library/assignment-evidence.ts`)
excludes locals with a declared type. A local that a USE narrows after its first
recorded assignment type keeps the order-dependent result: a `mutate(v)` call
placed before or after the assignment gives a different static type. To make the
narrowing order-independent, treat use evidence and assignment evidence as two
sets joined at the end of the block, not as writes in statement order. The
runtime value is correct; only the static type is imprecise. Tried 2026-10-24:
letting the first assignment replace a type that came from uses only removes the
order dependence, but `while let [h, ...] = xs { …; xs = Rest(xs) }` stops
compiling (a `string` arm passes through `Rest`), and a meet with the uses is
unsound (`[1.5]` typed `vector<integer^1>`).

### CE-46. Extended-real declarations widen to `number` through a call of a function declared `function`

**Status:** open; defect, low priority. User decision 2026-09-26: the host that
constructs a function gives its type.

Tycho declares plot variables and list seams as `real | signed_infinity | nan`
instead of `number`, and reads `number` as possibly complex. Most operations
keep the narrow type; a call of a function declared bare `function` with a union
argument widens to `number`.

A function declared with a result `unknown` reports the result of its body under
the declared parameter types, and a declared result is used as given, but
`callResultType` returns early when the declared result is a number type.
Removing that early return typed every call from its body, and 17 tests failed
(calls took literal value types, `g(3)` → `integer<6..6>`, and a complex-mode
compiled call lost its `_SYS.cplx` wrapper). Under the decision above, the
host's declaration is the intended fix.

Probe: Tycho's `scripts/repros/2026-09-24-declared-type-precision-probe.mts`.

### CE-47. A tuple argument at a scalar parameter is typed `any`

**Status:** open; defect, small.

The call `h((1, 2))` with `h := x ↦ 2x` (declared `(real) -> real` or not)
evaluates to `(2, 4)` and is typed `any`, because the body decides the shape
(`x ↦ |x|` gives a scalar). The same holds for `Apply(x ↦ 2x, (1, 2))`.

Typing the body with the parameter typed as the tuple was tried and removed: the
descriptor-based derivation (`callResultType`) gave wrong narrow types for a
nested user call inside a list (`P ↦ [q(P), q(P)]`), for `P ↦ P·Norm(P)`, and
for `P ↦ P/(P[1] − 1)`. A precise type needs a tuple-aware derivation.

### CE-51. Make built-in collections conform to `Iterable` and `Indexable` protocols

**Status:** design needed; design. Decision P8 and §7 item 6(h) of
`docs/TYPE_SYSTEM_ROADMAP.md`.

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
- **What it cannot do, by effort:** protocol refinement (`Indexable` requires
  `Iterable`): there is no `requires` field. Parameterized protocols
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

### CE-55. A user-declared lazy operator with an arrow-typed callback slot admits every callback

**Status:** on demand; capability.

Design E's compatibility admission covers every eager slot and the library's
lazy collection operators (through their canonical-handler funnel,
`canonicalCallbackOperand`). A user-declared `lazy: true` operator with an
arrow-typed callback slot still admits every callback until application, because
the lazy branches of `validateArguments` return each operand before the check
runs. The fix is a read-only planning pass at the lazy branches. Its benefit is
narrow: the lazy solve contributes no bindings, so only GROUND arrow slots can
be judged, and an unbound operand's type reads `unknown` (admits everything), so
only NAMED callbacks read through a side-effect-free `lookupDefinition` would be
judged. Do this when a consumer declares lazy operators with arrow slots.
Reasoning recorded in `docs/TYPE-SYSTEM.md`.

### CE-56. The `Sort`/`Ordering` comparator arm cannot keep its element type variable

**Status:** open; design, low priority.

The decided `Sort`/`Ordering` slot spelling was
`((T) any -> unknown) | ((T, T) any -> number)` (Design E §9 item 6). The type
language allows at most one arm of a union to reference a type variable (a
solver-simplicity constraint), so the comparator arm is grounded as
`(any, any) any -> number`. The arity duality and the documentation stay; the
comparator-side disjointness rejection is lost: a `(string, string) -> number`
comparator over an integer list is admitted and fails per element. To restore
the decided spelling, lift the one-variable-arm constraint in `parseType` and
the solve, which affects all union solving. The key arm keeps `T`, and no
shipped signature needs a second variable-bearing arm. Deviation recorded in
`docs/TYPE-SYSTEM.md`.

### CE-57. A callback's parameter types do not bind a data-anchored type variable

**Status:** on demand; capability.

Design E decision R-E3: a callback operand's parameter types never bind a
data-anchored domain variable. So `apply2(IsPrime, x)` leaves `x` `unknown`, and
`CountIf(zs, IsPrime)` leaves `zs: collection<unknown>`. Binding it would create
a contract that the slot does not carry and break a later `zs := [1, "a", 2]`
(the `zs` KEEP pin). The extension point is `solveArm`
(`generic-instantiation.ts`): R-E3′ already lets a callback bind variables with
NO data anchor (the `comp`/`both` behavior), so only the data-anchored case is
open. If a consumer asks for apply-style inference, use SOFT, PER-CALL,
WRITE-FREE bounds: the callback's parameter types may sharpen the call's
instantiation (stamping and result precision), are dropped on conflict with any
data bound (the union-source case must never conflict), and never reach an
`_infer` write (no symbol narrowing, so the `zs` pin holds). Full contribution
with inference writes needs a new decision on the `zs` KEEP pin. Do not build
before a consumer asks.

### CE-58. `ce.declare()` with a value does not apply the default `!scope` effect limit

**Status:** open; defect.

`ce.declare('f', { type: '(...) -> ...', value: writerLiteral })` is the third
caller of `assertDeclaredEffects`. It installs a proven escaping writer without
the scope limit that the two declare-then-assign reconciliation routes apply.

It has no requirement because the same code serves block-local `let` bindings:
their writer closures (a closure that changes a local of its enclosing literal)
must stay installable. No discriminator between global and local is available at
that point: the Epsil static pass also evaluates top-level declares under pushed
scopes, so the context depth does not separate the two. The installed arrow
still carries the inferred `scope` label, so the effect stays visible. What is
missing is the refusal. Checked 2026-10-24: block-local `let` declarations reach
`declareFn` through the `Declare` operator (`declareSteps`, `library/core.ts`),
which calls the public `ce.declare()`, so only a direct host call can be told
apart, and that does not cover a top-level Epsil `let`.

### CE-61. Two kinds of user-defined callee are not checked statically

**Status:** open; capability. User decision 2026-10-17: canonicalization owns
the clause install.

`DefineFunction`'s canonical handler installs the clause once the body has
canonicalized, so later statements of the same program are checked against the
real signature. One case is checked only when it evaluates:

- **CE-61.1** Generic definitions. Rule G2 refuses any clause on a generic
  target, so the install cannot repeat, and the evaluate route would refuse its
  own re-installation. **User decision 2026-10-17 on the direction:
  canonicalization owns the install**: the evaluation step recognizes a clause
  that canonicalization already installed and skips it, so calls to a generic
  function are checked statically. Do it only when other work needs a shared
  installation step for canonicalization and evaluation.

### CE-62. The declared effects of a value-bound function literal are not kept current

**Status:** open; defect.

- **CE-62.2** The arrow of a value-bound function literal is fixed in the effect
  stamps of its callers. The re-derivation (`consultsRegistry`,
  `effects-inference.ts`) keeps a definition current when its body reaches a
  protocol dispatcher directly or through OPERATOR-definition callees. A body
  that reaches one only through a VALUE-bound literal (`g := (x) => speak(x)`
  stored as a value binding, then `f` calling `g`) keeps `g`'s arrow as read
  when `f` was installed: the walk cannot see that the value's own arrow depends
  on the registry. This agrees with the construction-time snapshot semantics,
  but it reduces the transitive reach of the widening guard. Fix: a
  registry-dependence bit on the arrow (or type) of the LITERAL, not only on
  operator definitions.

### CE-63. Contextual callback typing (`callback<S>`): deferred items and known limits

**Status:** on demand; capability.

The 15 collection operators use `callback<S>` for their callbacks.

- **CE-63.1** Seeded-fold accumulator stamping. The accumulator is deliberately
  not stamped (spec §12.1: stamping breaks accumulators that change type, as a
  probe showed). Re-opening needs a bound (`forall T, U: value.`) and a new
  decision.
- **CE-63.2** Bounded numeric element types (`integer<1..10>`) and value-literal
  types do not pass the stamp admission requirement (`admissibleElementType`). A
  one-line widening if needed.

Known limits recorded in spec §9b, no action unless a user asks:

- Applications on the binder route (`rawOps`) skip the contextual stamp. This is
  unreachable today; a comment at the requirement records it.
- The intent that `callback<S>` applies only in a parameter position is not
  enforced: in other positions it behaves as `function`.
- A union of two DIFFERENT `callback<S>` members resolves to the first one seen.
- Undeclared source symbols infer `collection<unknown>` (the standard polytype
  behavior).

### CE-64. `broadcastable<T>` typing: remaining items

**Status:** on demand; capability. Plan:
docs/plans/2026-07-11-broadcast-typing-lift-design.md.

Respect these interactions: the non-finite typing convention, the destructive
effect of `infer(unknown)`, and the contexts that require a scalar (exponents,
comparisons, plot coordinates).

- **CE-64.1** Phase-2 declared-type reconciliation for symbolic-length ranges
  (see the design doc). Two broadcast-lift Phase-2 tests assert the declared
  type and the `Map` form until this is done.
- **CE-64.2** Lambda bodies over untyped parameters still type scalar; only
  applications are lifted. Do this only with a design that types the body from
  the parameter types.
- **CE-64.3** Python broadcast compilation: the Python target lowers arithmetic
  to infix and has no generic `_ce_bcastf` helper, so possibly-collection
  operands fail closed (the interpreter fallback is sound). Build the helper
  only if a compiled-NumPy binding is needed.

### CE-66. Typed function literals: optional and variadic parameters, result check, LaTeX notation

**Status:** on demand; capability. Contract: `docs/LANGUAGE-MODEL.md`.

- **CE-66.1** (S/M) Optional and variadic parameter annotations
  (`["Typed", "xs", "'number+'"]`). The encoding already admits it; `makeLambda`
  needs arity handling. Until then, the signature-string sugar
  (`["Function", body, "'(x: integer) -> real'"]`) rejects these markers.
- **CE-66.2** (S) A strict-mode run-time check of the result against the
  declared return type. Today a return type is only an ascription.
- **CE-66.3** (S) LaTeX notation for typed parameters behind a serialization
  style flag. Today the annotations are dropped in LaTeX.

### CE-67. Operator signatures need generic type arguments

**Status:** open; capability.

The warning in `boxed-operator-definition.ts` that checks the result type
against the `at` handler is disabled. It needs generic type arguments in
signatures: `Map` and `Filter` return an indexed collection if and only if the
input is indexed.

### CE-443. A pure function literal with nine or more nested literals is typed with effects `any`

**Status:** design needed; types. Found 2026-10-24 while fixing CE-347.

The effects walker stops at a depth of 8 nested function literals
(`MAX_LITERAL_DEPTH`, `boxed-expression/effects-inference.ts`) and then answers
`any`, so a pure literal nested 9 deep is typed `(unknown) any -> …`. This is
the safe direction but loses precision. A fix needs a design choice: the nested
walk shares its confinement state with the enclosing literal.

### CE-444. A local declared `any` and assigned a string is typed `indexed_collection<string>` at a `ReplaceAt` update

**Status:** open; types. Found 2026-10-24 by the review fixes of CE-329; not
reproduced outside the compiler yet.

In a compiled block, a local declared `any`, assigned a string and then updated
with `xs = ReplaceAt(xs, i, "z")` has the type `indexed_collection<string>` at
the update. A string does not match that type (the elements of a string are
characters), so the type contradicts the value the local holds. The JavaScript
in-place update does not depend on it (`compileInPlaceUpdateChain` stores the
converted array in its temporary whatever the type says). First reproduce it
with `ce.box(...).type` on the block, then find where the assignment widens the
string.

### CE-449. The meet of a chain of list aliases grows exponentially with depth

**Status:** open; performance.

With aliases `A(n) = list<A(n-1)> | list<list<A(n-1)>>` (or `list<X> | set<X>`),
`reduceType` of the intersection of `A(n)` and `B(n)` takes 4.8 s at depth 10
and 11.4 s at depth 14. With `tuple<X, X> | list<X>` against
`list<list<X>> | tuple<X, X>`, `typesOverlap` takes 0.9 s at depth 12 and 23 s
at depth 16, and the meet does not finish at depth 32. Chains of tuples only are
fast. The fixes that stopped this growth for lists with lengths do not reach
plain lists or a mix of tuples and lists. The four timing tests of
`broadcastable-list-meaning.test.ts` now use tuple chains.

### CE-455. `admissionOf` and `typeAcceptsValue` disagree on a self-negating alias

**Status:** decision needed; defect, low priority. Making `typeAcceptsValue`
give the subtype answer breaks two tests of `value-membership.test.ts` ("bails
(false) when the type has no value component", the `list<0>` case), which pin
its contract as a fallback that answers `false` when the type has no value
component. Agreement needs a decision on that contract.

With the alias `nn = !nn`, `typeAcceptsValue(5, nn)` is `false` and
`admissionOf(5, nn)` is `'admit'`. The type has no fixed point, so neither
answer is specified, but the two functions should agree.

### CE-468. A call of a point function on a collection symbol with no value is an error

**Status:** open; defect, small.

With `g: (tuple<real, real>) -> real` and `L: list<tuple<real, real>>` with no
value, `g(L).evaluate()` gives `incompatible-type` (expected
`tuple<real, real>`). The same for `T: tensor<tuple<…>>` and
`S: list<list<tuple<…>>>`. The call should stay `g(L)` until `L` has a value.
The static type of the call is correct (`list<real>`, `tensor<real>`).

### CE-469. A call with a literal matrix of points at a `broadcastable` parameter is typed `any`

**Status:** open; defect, small.

With `f: (broadcastable<tuple<real, real>>, tuple<real, real>) -> real`,
`f([[(1,2),(3,4)],[(5,6),(7,8)]], (1,1))` is typed `any`; its value
`[[11,13],[15,17]]` is a `list<list<real>>`. Sound but imprecise.

### CE-470. The length of a rest parameter is typed with a `signed_infinity` arm

**Status:** open; defect, small.

`h(a, ...rest) = Length(rest)` has the signature
`(a: unknown, any*) -> integer | signed_infinity`, while
`src/epsil/docs/control-flow.md` documents `-> integer`. A rest parameter is
always a finite list, so its length is a finite integer.

### CE-473. A captured free symbol of a function literal is narrowed on its local copy, not on the outer binding

**Status:** decision needed; wrong value.

A free symbol in the body of a function literal (`y` in `x ↦ [-x, y]`) is
auto-declared in the literal's own scope. Use-inference, including the inference
a list literal makes on its free symbols, narrows that local copy to `number`,
and the literal's result is typed `vector<2>`. At a call, the body reads the
outer binding of `y`, which is not narrowed. With `y := "abc"`, `Apply(g, 3)`
has the static type `vector<2>` and the value `[-3, "abc"]`. An operator that
checks its operand at evaluation (`x ↦ Not(y)`) gives `incompatible-type` there,
but a container does not check. Options: (a) put the narrowing on the outer
binding, as a use at the top level does; (b) do not narrow a captured copy, and
type the cell `unknown` (`x ↦ [-x, y]` would be `list<unknown>`); (c) check the
captured values against the narrowed types at call time. Neighbouring cases:
`test/compute-engine/ce-39-literal-cell-types.test.ts`.

## Collections, absence and broadcasting

### CE-466. The type of a sum of a ragged list and a `broadcastable` is wider than needed

**Status:** open; task (precision; the type is sound).

With `M: list<list<integer> | number>` and `C: broadcastable<number>`, `M + C`
is typed `list<list<list<integer> | number> | number>`, while `M · C` is typed
`list<list<number> | number>`. For one cell, `Add` gives the broadcast typing
its answer for one element (`list<integer> | number`), where `Multiply` gives
`number`. `broadcastLiftType` (`boxed-expression/broadcast-lift-type.ts`) asks
the handler again for the cell type only when the answer is a
`broadcastable<…>`; asking it also when the answer can hold a list would give
`list<list<number> | number>` for `M + C`. Measure the pins that move first.

### CE-70. Presence contracts: absent arguments that are not refused or not reported

**Status:** open; defect, small. Plan:
docs/plans/2026-10-21-presence-contracts-and-assertion.md (decisions P1 to P5;
section 9 has the record).

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

**Status:** design needed; design.

Decide how a record field is omitted, how an optional field is represented, and
whether an explicit key-removal operation exists. Also classify the custom folds
that remain, `Dot`, ordering and the structural conversions (questions Q5 and
Q10 of `docs/plans/2026-10-20-bare-tuple-record-any.md`).

### CE-72. `Scan` over a source declared with a `missing` element type is typed without the `missing` arm

**Status:** open; defect.

For a source declared `list<integer | missing>`, the `Scan` type handler
receives `list<integer>`: the `missing` arm is dropped before the handler runs,
so the result is typed `list<number>` while an absent seed stays in the value. A
fix inside the `Scan` handler cannot see the arm; find where the operand type
loses it. (A `Missing` inside a list LITERAL is typed `nan`, a subtype of
`number`, so `Scan([Missing, Missing], Add)` typed as a numeric list is
consistent.)

### CE-384. A union of collection types drops the `missing` arm of an element

**Status:** open; capability. User decision 2026-10-23: the reduction stays for
now (`collection-type-followups.test.ts`, "Map over a dictionary arm of a
union", pins it).

The union reducer (`reduceUnionType`, `src/common/type/reduce.ts`) keeps the
supertype of two arms related by subtyping. Since every type is a subtype of
`unknown`, `list<missing | unknown>` is a subtype of `collection<unknown>`, so
`collection<unknown> | list<missing | unknown>` reduces to
`collection<unknown>`. The set of values is the same, but `provablyAdmits` no
longer finds the `missing` arm of the elements, so the Epsil static check cannot
report a possibly absent element. Example: `Map(x ↦ x, v)` with
`v: tuple<integer, missing> | dictionary<integer>` is typed
`collection<unknown>`. At the top of a union, decision D1
(`docs/plans/2026-10-21-unknown-inference-marker.md`) keeps `missing | unknown`
as two arms; this entry is the same rule one level down, for the elements of a
collection. Fix: in `covers()` of `reduceUnionType`, do not let an arm whose
elements state `missing` be absorbed by an arm whose elements do not. This
changes the reduction of every such union: measure the test and snapshot changes
in the full suite first.

### CE-74. The type of a lazy view does not say that an element can be `Nothing`

**Status:** design needed; design. User decision 2026-10-20: a lazy view (`Map`,
`Tabulate`, `Table`, `Scan`, `Iterate`) keeps a `Nothing` result in its own
display, count, `.at()` and `.each()`; turning it into a list erases it.

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

### CE-77. A record arm of a union type reads only its declared fields

**Status:** open; defect, small.

A declared open record (`record{a: integer}`) now has the entry type
`tuple<string, any>` wherever its elements are read, and a dictionary LITERAL
keeps the join of its field types (`dictionaryValueValuesType()`,
`common/type/utils.ts`; `facts.elementType` in `operand-descriptor.ts`; the
`solveType` of `SolveActual`; the `Values` and `At` handlers). One site keeps
the old reading: with `ru: record{a: integer} | indexed_collection<integer>`,
`At(ru, 1)` is typed `integer | nan`, from the declared field only.
`use-driven-element-inference.test.ts` ("a union base with a record arm reads
the field values, not the iteration pair") pins that reading, so changing it
means changing that test.

### CE-79. Indexing and slicing a collection whose count is a `bigint`

**Status:** open; capability. User decision 2026-10-06: `at()` and the readers
that compute an index from the count accept a `bigint` index. Issue #416.

A collection count that is not a safe integer is a `bigint` (`expr.count`, the
`count` collection handler; see `smallCount()` in
`boxed-expression/collection-count.ts`). The readers that index or slice with
the count still take a `number`, so they treat such a count as unknown: `at()`
takes a `number` index, and `Last(Range(1, 10^20))` stays unevaluated because
the last index, 10^20, is not a safe integer. To do: make `at()` and the readers
that compute an index from the count (`Last`, a negative index, `Take`/`Drop`
with a negative count, `Most`, the rotations) accept a `bigint` index, so that
these give their value.

### CE-80. Reducers over a `Range`: three cases still walk or round

**Status:** open; defect, small.

`Sum`, `Mean`, `Median`, `Variance`, `PopulationVariance`, `Max` and `Min` of a
literal `Range` with exact bounds and step use a closed form
(`library/range-closed-form.ts`), also when a symbol holds the `Range`, and
under `.N()` the statistics read the held operand before it is made numeric. One
case remains:

- **CE-80.3** Compiled JavaScript builds the whole array before it reduces it
  (`_SYS.range(1, n, …).reduce(…)`, `_SYS.mean(_SYS.range(…))`), so the memory
  use grows with `n`. The closed form, or a counted loop, would not.

### CE-464. A callback stamped from a symbol's current value is outdated after the symbol is reassigned

**Status:** open; defect, small.

The contextual callback solve (`annotateCallbacksFromContextualSolve()`,
`boxed-expression/box.ts`) stamps the parameter type of a `Map` callback from
the VALUE a source symbol holds when the expression is boxed. With `L := [1, 2]`
and `m = Map(x ↦ x + 1, L)`, a later `L := [["a"]]` makes `m.evaluate()` a list
of `incompatible-type` errors, while a fresh box of the same expression gives
the right value. A dictionary symbol with an inferred type behaves the same way
since the CE-77 change (`dd := {a: 1}`, `m = Map(x ↦ x, dd)`, then
`dd := {c: "x"}` gives `Set(Error(...))` on `m` and `Set("x")` on a fresh box).
The stamp should follow the symbol's type at evaluation, or the value-derived
stamp should be retired when the symbol is reassigned, as the value-type caches
are. Pinned in `test/compute-engine/ce-77-open-record-entry-type.test.ts`.

### CE-81. Three lazy collections assigned to a variable stay a live view of the variables they read

**Status:** open; defect, small.

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

**Status:** open; defect, small.

With `Q := [(1, 2), (3, 4)]` and `x := 5`:

- **CE-82.3** `Q + x` is typed `list<tuple<integer, integer>^2>` but evaluates
  to a list of errors, and `x + (1, 1)` is typed
  `integer | tuple<integer, integer>` but evaluates to one error: a number-typed
  symbol beside a point. The check `addsPointToNumberCollection`
  (`collection-utils.ts`) reads operand TYPES only. A number symbol whose type
  was only inferred keeps such a sum symbolic under `evaluate()`, so to type it
  `error` from the type alone would be wrong; a fix needs the symbol's value.

### CE-83. A lazy `Map` or `Filter` over a `Join` or `Append` with an absent operand stays unevaluated

**Status:** open; defect.

`Map(f, Join(Missing, [3]))` should be `Missing`, as `Map(f, Missing)` is. The
source correctly declines to enumerate, but a lazy operator does not evaluate
its collection operand, and conditional threading reads only direct
`When`/`Which` operands.

An `evaluate` handler on `Map`/`Filter` was tried and broke ordinary lazy
evaluation (45 suites): do not do it. The fix belongs in the evaluation step
(`boxed-function.ts`): evaluate a lazy operator's `Join`/`Append` operand when
it may be absent, then thread the result.

### CE-85. An absent list carries no shape: `Missing + 2\{b>0\}` is a scalar

**Status:** open; defect, small.

`[1,2]\{a>0\} + 2\{b>0\}` with both conditions undecided is
`[3\{b>0\}, 4\{b>0\}]\{a>0\}`, and once `a = -1` that held value is `Missing`.
Evaluated fresh with `a = -1`, the list restriction is already `Missing` when
the sum is formed, and `Missing + 2\{b>0\}` threads to `NaN\{b>0\}`: the absent
operand is a bare `Missing`, which carries no shape, so the sum reads it as an
absent scalar and answers the numeric marker still restricted by `b`. The two
routes agree once `b` is decided too (`[NaN, NaN]` for `b = -1` with `a` free on
both). A point keeps its shape: at `t = −1`, `(A\{0<t\}, B) + (A, B)` is
`(NaN, 2B)` typed `tuple<nan, number>`. A fix needs the absent value of a list
to remember that it was a list (a typed absence), which `Missing` does not.

### CE-88. A broadcast does not compare the length of an operand whose length is not yet known

**Status:** open; defect.

Broadcast policy (`docs/BROADCAST-MODEL.md`): strict lengths for LIFTED
operators (a mismatch is `incompatible-dimensions` in the eager zip, the
arithmetic broadcast and the lazy form); shortest input for explicit PAIRING
constructors (`Zip`, variadic `Map`, `PointList`).

The length check reads `count`. An operand that reports `undefined` (a
symbolic-length `Range` before its bound resolves, an operand held raw by a lazy
operator) is skipped, and the broadcast continues. The lazy `Map` then zips
those operands with shortest-input semantics, so a mismatch that becomes visible
only after the length resolves can truncate the result without an error. An
infinite operand is already caught: its `count` is `Infinity`, which does not
match a finite length.

- **CE-88.1** Add a strict lazy zipper that reports `incompatible-dimensions`
  when one operand ends before another. This is a change to `Map` iteration, not
  to the length check.

### CE-89. Lazy collections: `Keys`/`Values`/`Chunk` and the limits of `Map` auto-compile

**Status:** deprioritized; performance, low priority. Model:
`docs/COMPILATION-MODEL.md`.

Convention to keep: `Slice` finiteness is honest. A negative end over an
infinite source is an infinite tail, a negative start over one is inert, and a
source of unknown length reports its finiteness as unknown.

- **CE-89.1** Lazy `Keys`/`Values` (dictionaries are small) and `Chunk` (needs
  the count only). Low value.
- **CE-89.2** `Map` auto-compile does not handle lazy collections other than
  `Map` (`Filter`, `Comprehension` bodies) or bignum drains. Look again with a
  profile.
- The explicit-materialization route stays interpreted by decision: do not
  reorder steps 3/3b of `_computeValue`.

### CE-90. Operators that do not report their element count

**Status:** on demand; capability.

`_broadcastCount` requires `broadcastable === true`. The optional `elementCount`
handler of an operator definition (the `count` twin of `canEnumerate`) lets an
operator give its length without evaluation. `Sort`, `Ordering`, `RandomShuffle`
and `Chunk` have it (pins in
`test/compute-engine/tycho-item-167-broadcast-count.test.ts`).

- **CE-90.1** The other reshaping or eager operators report `undefined`
  (`GroupBy`, `BinCounts`, `Histogram`, `Tally`, `Unique`, `Flatten`, `Shape`,
  `Quartiles`, `RandomChoice`, `RandomSample`, `LinearRegression`,
  `PolynomialFit`, …), and so do the count-preserving pass-throughs (`N`,
  `Evaluate`, `Identity`, `Typed`, `Matrix`, `Transpose`, …). Add an
  `elementCount` handler to each when there is demand. Never put a list of names
  in engine code.
- 56 element-wise operators have the `broadcastable` flag (user decision
  2026-10-17), so `NthPrime([1,2,3])` gives `[2, 3, 5]` with a count of 3. Two
  groups do not have the flag yet: `Degrees` and `DMS` (`trigonometry.ts`), and
  the operators whose result for one element is a collection (`FactorInteger`,
  `Divisors`, `PrimeFactors`, `ExtendedGCD`, `ContinuedFraction`,
  `IntegerDigits`, `PrimitiveRootList`, `DigitCount`), which first need a
  correct broadcast type lift. Both are tracked in CE-103.

## Evaluation, canonical forms and scoping

### CE-91. Define value capture on assignment, mutable-object boundaries and view reads

**Status:** design needed; design.

Define the ordinary capture of a value on assignment, the boundaries of mutable
objects, and the behavior of a view that is read more than once or whose read
has effects (question Q11 of `docs/plans/2026-10-20-bare-tuple-record-any.md`;
the probes are in `docs/plans/2026-10-20-lazy-view-read-capture-probes.md`).

### CE-92. Sticky unresolved-call results with function declaration hoisting on every route

**Status:** open; task.

Implement sticky evaluated results of unresolved calls together with function
declaration hoisting across the sequential runner, the whole-block interpreter
and the compiler. Keep earlier bindings, declared signatures and constructors.
See also CE-312.

### CE-97. The interpreter leaves some collection reductions unevaluated that compiled code computes

**Status:** open; defect.

Reproduced on `cc468eb4f`. `g(t) = [t, 2t]`.

- **CE-97.2** `Determinant(Scan(m, Add))` stays unevaluated for
  `m: matrix<number>`, while the compiled code gives the value (`-2` for
  `[[1,2],[3,4]]`). `Transpose(Scan(p, Add))` at `p = []` also stays
  unevaluated, while compiled code gives `[]`.
- **CE-97.3** `Dot(p, p)` for `p: list<number>` at `p = []`: the interpreter
  leaves `MatrixMultiply([], [])`, typed `number`; the compiled code gives `0`.

### CE-103. A result built with the library π serializes as `Pi` in a scope that rebinds `Pi`

**Status:** open; defect, small.

A declaration of `Pi` is refused in the global scope only, so that a function
parameter, a `Sum` index or a block local can still be named `Pi`. In such a
nested scope, a result that the engine builds with the library π
(`Sum(1/n², n, 1, ∞)` → `π²/6`) still serializes as `Pi` and changes value when
it is boxed again inside that scope. A result that leaves the scope is boxed
with the library constant again, so the problem is limited to a JSON round trip
inside the scope.

### CE-105. Error frames do not name the canonical operand or the declared call

**Status:** open; defect, small. See also CE-109.

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

### CE-107. `isSame` is false between a boxed and a parsed `D` of the same function literal

**Status:** open; defect, small. Tycho row 394.

`isSame` is `false` between `D(x ↦ f, x)` boxed from MathJSON and the same
derivative parsed from `\frac{\mathrm{d}f}{\mathrm{d}x}`, although their `.json`
is the same (`["D", ["Function", ["Block", "f"], "x"], "x"]`). The parsed form
and `ce.box(["D", "f", "x"])` are the same; only the box route of the explicit
function literal differs, and even the occurrences of `x` and `f` compare
different (`sameBinding`, `boxed-expression/compare.ts`).

Cause: `ce.box(["D", ["Function", ["Block", "f"], "x"], "x"])` declares the free
`f` in the local scope of the `Block` when `f` has no global definition yet,
while the parse route declares `f` globally first. So boxing first and parsing
second gives two bindings, and the other order agrees. The same holds for any
literal: `ce.box(['Function', ['Add', 'f', 1], 'x'])` declares `f` in its body
scope, and a later `ce.box('f')` is a different, global `f`. A fix changes where
a free symbol of a function literal is declared (design decision).

### CE-108. Operators treat a symbol that holds or is declared an error in different ways

**Status:** open; defect, small.

- **CE-108.3** With a symbol declared `error` with no value
  (`ce.declare('e', 'error')`), `Length(e)` is valid at boxing and evaluates to
  "expected `collection`, got `error`". A function with a single signature and a
  `list` parameter refuses `e` at boxing. `Length` is declared
  `(any) -> infinity | integer`, so boxing admits `e`, and its evaluate handler
  refuses it. One of the two routes should change.

### CE-109. Errors that a handler creates itself have no `ErrorTrace` frame

**Status:** open; defect, small.

`Count`, `Length`, `First`/`Second`/`Third`/`Last`, `PointX`/`PointY`/`PointZ`,
`Sort`, `Ordering`, `RandomShuffle` and `PointZ`'s dimension error carry the
frame of the operator through `refusedOperandError` / `withErrorFrames`
(`library/collections.ts`). The evaluation adds no frame to an error that a
handler returns as the value of the whole call, so every other handler that
creates an error itself has the same gap. Examples: the `out-of-range` errors of
the sequence-search operator in `collections.ts` (an index below 1, an empty
needle, near lines 12879 and 12889), and the many
`ce.error('incompatible-type')` returns in `library/colors.ts`.

Options: each handler goes through `withErrorFrames`, or the evaluation adds the
frame of the call when a handler returns an error whose frames do not start with
that call.

### CE-111. Some lazy operators still run synchronously under `evaluateAsync`

**Status:** open; capability. Issue #392.

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
  branches, interleaved with writes to the scope), `Pipe` (the topic is handed
  unevaluated to `apply()`, and the shape of the stage decides how), `When` and
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
- **CE-111.3** In the walk of a collection (`Any`, `All`, `MaxBy`, `MinBy`,
  `ArgMax`, `ArgMin`, `Reduce`, `Fold`), a callback that is itself long runs to
  its end first. An asynchronous application of the callback
  (`ApplyOptions.awaitStatements`) would remove that.

### CE-112. A `WithRandomSeed` body that returns an eager operator holding a drawing view is reported pure

**Status:** open; wrong value, small.

`WithRandomSeed(7, Repeat(Map(u ↦ Random(), Range(1, 3)), 2))` reports
`isPure === true`. The escape check (`escapesAsDrawingLazyView`,
`boxed-expression/effects-of.ts`) follows the operands of a LAZY view and the
cells of a literal container, so a lazy `Take`, `Join` or `ListJoin` that holds
a drawing view is impure, as it should be. The two-argument `Repeat` is an eager
application before it is evaluated, so the check treats it as opaque, yet it
evaluates to a `List` of two drawing views, which escape the frame and draw live
at each read. A fix needs a rule for which eager operators store an operand in
their result; it is a separate change from the lazy-view rule.

### CE-113. A quotient has two canonical forms: `x·(1/y)` and `x/y`

**Status:** deprioritized; design, medium. User decision: not now.

`ce.box(['Multiply', 'x', ['Divide', 1, 'y']])` stays
`Multiply(x, Divide(1, y))`, and `.isSame(ce.box(['Divide', 'x', 'y']))` is
`false`. Parsing `x\times(y^2+z^2)^{-1}` gives the same product form, because
`canonicalPower` turns `Power(D, -1)` into `Divide(1, D)` and
`canonicalMultiply()` (`boxed-expression/arithmetic-mul-div.ts`) never merges a
`Divide` factor with the other factors. `evaluate()` and `simplify()` give
`Divide(x, y)` for both, so only `isSame`, hashing and pattern matching see two
forms.

A fold in `canonicalMultiply()` that returns
`canonicalDivide(numerators, denominators)` for a product of scalars with a
`Divide` factor was measured on the full suite (2026-10-03). It must not land
until these are fixed first:

- **CE-113.1** `expandProduct()` (called by `mul()` through `expandProducts()`)
  has branches for `Divide` operands that distribute into a sum numerator and
  call `.mul()`/`.div()` recursively. With the fold, product-rule terms become
  `Divide` nodes and the derivative of a nested radical takes exponential time
  (depth 12: 670 ms → 2,760 ms; `derivatives.test.ts` and both
  `compile-derivative-numeric-fallback` test files did not finish).
- **CE-113.2** A factor `Power(y, -n)` with `n ≠ 1` must go to the denominator
  too, or `x·y^{-2}` and `x/y^2` stay two forms (and `Divide(2,x)·x^{-2}` prints
  as a nested fraction).
- **CE-113.3** `.N()` must give floats for the literals of a quotient it builds:
  `(1/3)·(1/x)` stayed the exact `1/(3x)` with the fold.
- **CE-113.4** Re-measure three integrals that stayed unevaluated with the fold
  (`\int_{-1}^1 a\frac{\sin t}{t}dt`, `\int\frac{\mathrm{arcsinh}(x)}{x}dx` and
  the Rubi case `#544`), because a constant factor ended up inside a numerator.
  The integrator now splits constant numerator factors.

After these, about 7 snapshots and 3 assertions change, all to a single quotient
form. The measured patch (one file, `arithmetic-mul-div.ts`) is not kept in the
repository.

### CE-117. Linear-algebra operators give wrong or questionable values for symbolic or extreme input

**Status:** open; defect.

- **CE-117.4** `LinearSolve` with complex cells that overflow gives `[0, 0]`.
- **CE-117.5** `Kernel([[1.5e308, 1.5e308, 1], [1.5e308, -1.5e308, 1]])` gives
  `[[0, 0, 1]]`, which is not in the kernel: the chop sets the small component
  to zero.
- **CE-117.6** (decision needed) `LUDecomposition`, `QRDecomposition` and
  `CholeskyDecomposition` of exact integer matrices return floats under
  `evaluate()`. An exact route needs: a rational LU with the same pivot choice
  as the float one; an exact Cholesky (LDLᵀ with rational `D`, entries rational
  × √rational); an exact QR by Gram–Schmidt (entries rational/√rational), whose
  signs differ from the Householder floats (negative diagonals in `R`), so the
  sign convention is a decision; type handlers that state exact cell types
  instead of `numeric`; and `.N()` reading the exact result.

### CE-118. Engine code that builds a node by name picks up a user binding in the active scope

**Status:** open; wrong value.

Inside a function body, a local definition named like a library operator is seen
by engine code that runs during that body's evaluation:

- `function f() { function Add(a, b) { 12345 }; expand((y + 1) * (y + 2)) }; f()`
  evaluates to `152399025` (the user `Add` applied to the terms `Expand`
  builds).
- `function f() { function Add(a, b) { 999 }; D(y^2 + y, y) }; f()` is `999`.
- `function f() { function Sin(a) { 999 }; D(cos(y), y) }; f()` is `-999`.

The same shadow in a `do { }` block does not reproduce it. Engine code
(`Expand`, `D`, the polynomial and simplification code) builds
`Add`/`Multiply`/`Sin` nodes by name while the user's function scope is the
current scope, and name resolution cannot tell that construction from a
user-written call. At the top level, the formulas of the derivative table do the
same: after `Sinh(x) := 3x`, `D(Cosh(t), t)` gives `3t`, because the rule for
`Cosh` is the formula `Sinh(x)`. (`D(Sinh(t), t)` is `3`: `D` checks for a user
definition of the name before it uses the rule for that name.)

Fix direction: engine-built nodes resolve their head against the system scope (a
construction route that does not consult the current scope), and only
user-written code uses scope-based resolution.

### CE-120. A float absorbed by an infinity is not seen by the float rule of `Indeterminate`

**Status:** open; defect, small. Plan:
`docs/plans/2026-09-28-indeterminate-value.md`.

An indeterminate form with a float operand answers `NaN` (`0.0·∞` is `NaN`), but
the rule reads the operands as they are when the form is built. When a float was
first absorbed by an infinity, it is gone by then: `Fract(∞ + 0.5)` and
`0·(∞ + 0.5)` evaluate to `Indeterminate`, because `∞ + 0.5` is the exact `∞`
before `Fract` or the product sees it. The absorption itself is correct. A fix
would have `∞ + x` with a float `x` keep a mark that it came from a float, which
the infinity literal cannot carry today. Both answers are pinned in
`test/compute-engine/indeterminate.test.ts`.

### CE-122. A qualified protocol call on an unknown name can stay unevaluated

**Status:** open; defect, small.

`Comparable.compare("a", "b")` with `Comparable` undeclared gives the
`protocol-unknown` error ("`Comparable` is not a protocol") when the receiver is
a top-level valueless symbol typed `unknown` and the arguments fit the member's
arity without the receiver but not with it (`canonicalMemberCall()`,
`library/collections.ts`). What remains: when no registered protocol declares
the member at all, the call stays unevaluated, because it cannot be told apart
from a field call on a free record symbol. An unannotated parameter receiver
(`a.compare(b, c)`) keeps the arity error.

### CE-123. A validation phase before canonicalization, so that a probe does not declare

**Status:** design needed; design.

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

### CE-124. A `Which` whose list condition holds an unknown function over the list stays symbolic

**Status:** open; defect. Tycho ask 296.

The evaluator selects element-wise over a list condition
(`Which([1,5,2] < 3, 10, True, 20)` is `[10, 20, 10]`). But when the condition
holds an unknown function applied to the whole list (measured with `foo(L)`),
the function does not broadcast, so each element of the condition list holds a
copy of `foo(L)`, no element can be decided, and the `Which` stays symbolic: N
copies of an N-element list for each reference. At 500 elements the result was
52 MB. At 10 000 elements under `withTimeLimit(5000)` the symbolic `Which`
returns in about 0.2 s. Tycho's case (`conj`, Desmos's complex conjugate) now
parses as `Conjugate` (`definitions-complex.ts`). Instrument on the Tycho side:
`scripts/repros/2026-09-15-list-conditioned-piecewise-probe.mts` in `dev/tycho`.

### CE-126. The capability registry has handlers for `console` and `entropy` only

**Status:** on demand; capability. Plan: docs/EFFECTS-MODEL.md (Stage 4).

`ce.effects` (the host capability registry) holds two handlers: `console`
(`Print`/`Input`) and `entropy` (`RandomExpression`, and every random operator
evaluated outside a `WithRandomSeed` frame, the stated exception to the coupling
rule). The specification names four more (`network`, `filesystem`, `time`,
`environment`) and the `random` draw kernel. No library operator reads them, so
add each one with the first operator that uses it.

- **CE-126.1** `random`: the seeded draw kernel `draw(seed, n)`, captured at
  frame entry, with compile declining for an expression that carries `random`
  while a non-default kernel is installed. Unframed draws use `entropy`, so the
  kernel is only about replacing PCG3D under a frame.
- **CE-126.2** `time`, `network`, `filesystem`, `environment` have no operator
  yet. The first `network` operator (`Fetch`) is also the first operator that
  returns a promise, and it starts the admission of the `async` label.
- **CE-126.3** Compiled code draws through `_SYS.drawNextRandomNumber()` →
  `ce._random()` and, for the Monte-Carlo integrals, through the engine-bound
  `ce._liveRandom()`, so a mocked `entropy` handler applies to it. A DENIED
  handler makes a compiled function THROW `CapabilityDeniedError` at run time
  (compiled code has no error-value channel, `docs/ERROR-MODEL.md` §6). A
  compile-time decline for a `random`-bearing expression under a denied
  `entropy` handler would fail closed instead. Build it when a host asks.

### CE-127. A free `i` in a subscript is the imaginary unit on one `Subscript` route and a symbol on the other

**Status:** open; defect, low priority. Consumers have a complete workaround.

On a fresh engine, `A_{i,j}` canonicalizes to
`Subscript(A, Sequence(ImaginaryUnit, j))` and `M_{i,j}` to
`At(M, ImaginaryUnit, j)`: the index `i` becomes the imaginary unit, and both
evaluate to `NaN`. But `A_{i+1}` canonicalizes to `Subscript(A, Add(i, 1))` with
`i` a plain `unknown`-typed symbol, and `\sum_{i=1}^{3} A_{i,j}` keeps `i` as
the bound index.

Cause: the `Subscript` canonical handler (`library/core.ts`) has two routes. A
parenthesized or comma subscript arrives as a `Delimiter` and is canonicalized
(`sub = op2.op1.canonical`), so the engine-wide convention "an unbound `i` is
the imaginary unit" applies. Any other subscript expression is passed through
UNCANONICALIZED (`sub = op2`). That keeps `i` symbolic by accident, and it
leaves a non-canonical operand inside a canonical expression.

The defect is the inconsistency, not the default. Reading an unbound `i` as the
imaginary unit is correct for a general user and for complex analysis. What is
wrong is that `A_{i+1}` and `A_{i,j}` disagree, and that a canonical expression
carries a non-canonical operand.

**Workaround (recommended for a consumer with no complex arithmetic):**
`ce.declare('i', 'integer')` before any parse. Then `A_{i,j}`, `A_{i+1}`, `L_i`,
`L[i]` and `M_{i,j}` all index by the symbol. This reaches the bracket and
`subscriptEvaluate` routes, which an engine-side subscript fix cannot reach;
`integer` refuses a fractional index at assignment, where `unknown` would accept
it; round trips stay safe because the serializer emits `\imaginaryI`, never a
bare `i`. The cost: bare-`i` complex literals in that scope become products
(`2i` → `2·i`); `\imaginaryI` stays available. `e` is the opposite case:
declaring it breaks `e^x`, so use per-document scoping plus `\exp(x)`, which
canonicalizes to `Power(ExponentialE, x)` and does not depend on the declared
variable.

**Constraints for an engine fix.** A first attempt (a `canonicalSubscriptIndex`
helper that shielded the index with `pushScope`/`declare`/`popScope`, and
removed the parser's `At` creation) was reverted. Any new attempt must respect
these four facts:

- A temporary shielding scope does not work. The index operands stay bound to a
  disposed scope: two parses of `A_{i,j}` then give `isSame === false` (the
  control `A_{p,q}` gives `true`). This breaks `.isSame()` as an equivalence
  relation and dedup key. An undeclared sibling name (`n` in `A_{i+n}`) is also
  declared in the temporary scope and is then disconnected from a later
  top-level declaration of `n`.
- The parser's `At` lowering must stay. `ce.parse('a_{1}', { form: 'raw' })`
  must be `At(a, 1)`: this is a consumer contract, pinned in
  `raw-subscript-fold-parity.test.ts` and
  `subscript-declared-name-precedence.test.ts` (10 tests fail otherwise).
- `At` cannot shield in its own canonical handler. `At` is not lazy, so its
  index is already the constant when the handler runs. Shielding there needs
  `At` to hold its index position, which is a wider change.
- Four routes need the same rule: the two `Subscript` routes; the
  `subscriptEvaluate` branch (a base that owns its subscripts, the
  `declareSequence` shape), which returns `Subscript(base, op2.canonical)`; and
  bracket indexing (`L[i]`), which the parser turns directly into `At`. A fix of
  only the `Subscript` routes makes the same index mean different things in
  different notations.

The complete fix is a canonicalization-level mechanism: canonicalize a subtree
with the `holdUntil: 'never'` constant substitution suppressed for named
symbols, which all four routes could use. Because the declaration workaround
covers the consumer case, the part worth doing alone is small:

- **CE-127.1** Make the two `Subscript` routes agree, and stop returning a
  non-canonical operand, without changing what a free `i` means.

### CE-128. Pattern matching normalizes an `Error` subject only at the root

**Status:** open; capability. No known user report.

`normalizeErrorSubject` (`match-dispatch.ts`) strips the `ErrorTrace` breadcrumb
of an `Error` subject, and strips its where/site operand when the pattern's
arity does not ask for it, but only at the ROOT of the match. A sited or bubbled
error nested as the cause of another error is not normalized, so an
`Error(Error(c))` pattern does not see through the where or trace of the inner
error. To fix it, the generic recursive matcher must normalize `Error`/`Error`
subject–pattern pairs as it descends.

### CE-130. A pre-boxed operand applied twice through a raw name is not told apart from a binding

**Status:** open; design. Contract: `docs/SCOPING-MODEL.md`.

A pre-boxed operand can be applied twice through a raw name instead of a
binding, and binding identity cannot tell the two apart (raw-name-fallback
provenance). The behavior is pinned by a characterization test marked `@fixme`,
not fixed.

### CE-131. Disjunctive (`Or`) guards in the assumptions system

**Status:** on demand; design. Plan: docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md
§7 (non-goals).

87 complex-domain Fungrim corpus entries cannot be discharged because their
guards have an `Or` at the root. The assumptions design does not cover
disjunction. About 43 other failures are symbolic bounds (`|z| < φ−1`), which
the assume-side decomposition drops on purpose. Support for disjunctive facts is
a design extension (case splitting or watched-disjunct propagation). The guard
census (`scripts/fungrim/guard-census.json`, now 89.6 % complex-domain
dischargeable) shows what it would gain. Do it when there is demand.

### CE-132. Non-finite values: four residual items from the July 2026 reviews

**Status:** open; defect. Summary: docs/STATUS_REPORT.md.

- **CE-132.1** Literal poles of the `Artanh`/`Arcoth` class.
- **CE-132.2** Finiteness of the numeric value of `∞+i`.
- **CE-132.3** The place of `~oo` in the type lattice (question).
- **CE-132.4** Review the positivity of the `Multiply(x, +∞)` fold.

### CE-133. Other test-suite markers: assumptions, `Function` snapshot, equivalence groups

**Status:** open; defect.

- **CE-133.1** Range and interval membership assumptions are not connected
  (`assumptions.test.ts`, `@fixme` setup lines).
- **CE-133.2** A malformed positional-parameter name `_1_0` in a `Function`
  snapshot (`functions.test.ts`).
- **CE-133.3** The `grudnitski.test.ts` equivalence benchmark has 9
  `describe.skip` groups (equation scaling and identity-based `isEquivalent`).

`test/playground.ts` tracks its own items (notation decisions, Iverson/Boole and
inequality → `Range` wishes, matcher internals).

### CE-134. Declared symbols are not checked against existing uses

**Status:** open; defect.

A `@todo` at about line 2459 of `latex-syntax/parse.ts`: a declared symbol is
not checked against an existing symbol, function or inferred use. The check
probably belongs in canonicalization.

### CE-135. `Subscript(a, k)` fuses to `a_k` and loses a binder-bound `k`

**Status:** open; defect, low priority.

`["Subscript", "a", "k"]` canonicalizes to the fused symbol `a_k`. When `k` is
an index bound by a binder, the binding is lost. A correct fix needs
binder-aware canonicalization: at fusion time the canonicalizer has no scope of
the enclosing binder. Workaround: the call form `["a_", "k"]` (the Fungrim
corpus uses it).

## Symbolic computation

### CE-137. Binder clauses and user-function calls under `Integrate`, `Solve` and `Sum`: gaps

**Status:** open; defect, small. Tycho row 412.

A decision of 2026-09-21 says an index never reads a global inside a called
function. The capture cases are fixed (`renameCapturedIndexes()` in
`derivative.ts`, `solveWithRenamedUnknowns()` in `solve-domain.ts`; test
`test/compute-engine/integrate-limit-user-function-capture.test.ts`). These
items remain:

- **CE-137.1** `Solve(t^3 x = 1, t)` with `t, x: real` stays unevaluated. The
  `Root` type handler (`library/arithmetic.ts`) types `Root(1/x, 3)` as
  `number`, which is wider than necessary. Cause: `1/x` has the type `number`,
  because `1/0` is `~oo`.
- **CE-137.3** Four integration helpers (`bindsVariableInOperand` and
  `evaluateInnerIntegrals` in `calculus.ts`, `binds` in
  `piecewise-integrate.ts`, `special-integrate.ts` near line 103) treat a whole
  clause as bound when they skip the operand of an inner binder. At worst this
  skips an optimization.

### CE-139. `D` over a parameter of the same name gives an unevaluated list product

**Status:** open; defect.

`a ↦ (D(a^2, a), Reverse(a))` types its first slot `number`, but over a list the
value is the unevaluated `2 * [1.5, -2, 0.25]` (reproduced on `3799d01dd`).

### CE-141. `simplify()` does not reduce some exact definite integrals from Rubi

**Status:** open; defect, small.

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

**Status:** open; defect, small.

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

**Status:** design needed; design.

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

### CE-144. The real-line residue route rejects a float integrand

**Status:** open; capability, small.

`ContourIntegrate(1/(x² + 2.25), x, RealLineContour(True))`, called directly,
returns "unsupported: Rational coefficients must be exact", while the closed
contours read a float as the exact rational it holds and answer a float. The
`\int_{-\infty}^{\infty}` route is not affected: it integrates through the
antiderivative. Extending the residue route needs a rule for a pole whose
imaginary part is within the rounding of 0, because the float can move the pole
onto or off the real axis.

### CE-145. A characteristic polynomial with float entries keeps a float `0` term

**Status:** open; question, small.

`CharacteristicPolynomial([[1.5, 2], [3, 4]], x)` is `x^2 - 5.5x + 0`: the exact
and float constants of the result now fold, and their sum is a float zero, which
`Terms` keeps by design (`x + 0.0` stays `x + 0` under `evaluate()`, `.N()` and
`simplify()`). Decide whether a float zero summand is dropped from a polynomial
result. If it is kept, delete this entry.

### CE-146. A determinant above the size limit of the cofactor expansion is a nested quotient

**Status:** open; defect, small.

`AbstractTensor.determinant()` (`tensor/tensors.ts`) expands the cofactors of a
matrix with a symbolic entry up to 6×6, and of a matrix with exact irrational
numbers up to 8×8. A larger matrix goes through Bareiss elimination, which
divides by the previous pivot. The values are correct.

- **CE-146.1** A quotient by a sum of radicals or symbols is not reduced, so
  each Bareiss step nests the previous one: the 7×7 symbolic case and a 9×9
  radical case give results of many thousand characters. To do: rationalize each
  exact Bareiss quotient, or use a division-free elimination.
- **CE-146.2** A radical whose square-free radicand is above 10⁶ still becomes a
  float in a product (`ExactNumericValue.mul`), because such a radicand is not
  stored.

### CE-148. A complex-valued function whose parts cannot be separated has no symbolic limit

**Status:** open; capability, small. Issue #396.

`complexLimitAtPosInf` (`symbolic/limit.ts`) separates the real and imaginary
parts of a complex-valued function only for sums, products, quotients, integer
powers and the exponential. So `Limit(t ↦ t·Gamma(2 + i·t), ∞)` stays
unevaluated, although its limit is `0`; `.N()` gives a value near `0` for it.

### CE-149. `Solve` over a bounded domain stays unevaluated in some cases that have a complete answer

**Status:** open; capability, small.

A `Solve` over a bounded domain returns a list only when it is shown to be
complete (`rootListIsComplete()` in `boxed-expression/solve-domain.ts`);
otherwise it stays unevaluated (user decision). These cases stay unevaluated
although a complete answer exists:

- **CE-149.1** Far from 0, `rootSetDivisor()` compares `f(x)` with `f(x + T/n)`
  to a relative 1e-9, which fails near `10^8`, so `sin(13x)·cos(x) = 0` over
  `[10^8, 10^8 + 7]` stays unevaluated. Sampling near 0 instead of near the
  lower bound would fix it.
- **CE-149.2** Near `10^12`, one ulp moves `sin` by about 1e-4, more than the
  scan's `1e-6·scale` threshold, so the scan declines (0.147.0 gave a correct
  list there).
- **CE-149.3** `checkNonPeriodicRoots()` returns no answer when the solver finds
  no root, so an equation that is not periodic never gets a certified `[]`.
- **CE-149.4** An equation with the unknown in a function that the root finder
  cannot invert (`hasNonInvertibleHead()`) gets no answer over a bounded
  interval, also when the function has no root:
  `sin(x)·(BesselJ(0, 50x) + 2) = 0` over `[0.5, 3]` was `[]` and now stays
  unevaluated. A bound on how fast such a function can oscillate would let the
  scan check it.
- **CE-149.5** Over a domain that is not bounded and is not ℝ or ℂ, a periodic
  equation gets no answer, also when its roots are finite in number:
  `x·sin(x) = 0` over `ℤ` (only `0`) and `sin(x) = 0` over `ℤ` were `[0]` and
  now stay unevaluated. A proof that the periods have no common multiple with
  the integers would give the answer.
- **CE-149.6** `sin(x) = 1 - 10^-18` over `[0, 3]` or over ℝ: with the unknown
  declared `real` (`symbolicRoots()`), `findUnivariateRoots()` gives no root, so
  the `Solve` stays unevaluated. Without a domain, it gives both roots
  `π/2 ± 1.4·10^-9`. The same occurs for `1 - c·10^-17` with `c ≤ 8`.
- **CE-149.7** When a factor of a product is not solved (`stats.partial`), the
  scan accepts the list only when each root it finds is a change of sign of `f`
  located to `10^-9·max(1, |x|)` and matches exactly one listed value (`strict`
  in `rootListIsComplete()`). Thus a root at an end of the domain
  (`sin(x)·(x + e^x + 5) = 0` over `[0, 4]`, root `0` at the lower bound), and a
  root where `f` touches zero, give no answer. The scan cannot tell three roots
  in one cell of the scan from one root, but it does not accept a list alone:
  the interval proof (CE-151) rejects a list that misses a root, except a root
  inside the window around a listed root.

### CE-404. `Solve` does not take out a common factor of a sum of trigonometric terms

**Status:** open; capability, small.

`Solve(sin x + 2 sin x cos x = 0, x)` stays unevaluated, although
`sin x · (1 + 2 cos x) = 0` is solved, and so is `cos x + 2 cos x sin x = 0`
once factored. The solver factors a product (the zero-product step) and expands
multiple angles (`solveByMultipleAngleTrig`, `boxed-expression/solve.ts`), but
it never takes a common factor out of a sum that has no multiple angle.
`test/compute-engine/solve-domain.test.ts` uses this equation as an example that
stays unevaluated; move it when this is fixed.

### CE-151. `Solve` over a bounded domain does not see a root that is very near a listed root

**Status:** open; defect. User decision 2026-10-17: add the derivative proof for
a simple root, and keep the tolerance window for a multiple root.

Interval arithmetic proves that a root list over a bounded domain is complete
(`enclosureShowsNoOtherRoot()` in `boxed-expression/solve-domain.ts`): each cell
of the domain must have an enclosure of the equation that excludes 0, except the
cells in the window `[v − t, v + t]` around each listed root `v`. The window
tolerance `t` is `10^−6·max(1, |v|)` (at most 1/16 of a sample step), or
`10^−9·max(1, |v|)` when the list is known to be partial. A second root inside a
window is not seen: the two roots of `(sin x − 1/2)(sin x − 1/2 − 10^−8) = 0`
are `1.15·10^−8` apart, and a list that holds only one of them passes the proof
(the root finder gives both, thus the result is correct today).

A proof of uniqueness closes this gap for a simple root: when the enclosure of
the derivative `f'` over the window excludes 0, `f` is monotonic there and has
at most one root. A root of higher multiplicity (`sin(x)^10` at `π`) has no such
proof. **User decision 2026-10-17:** add the derivative proof for a simple root,
and keep the tolerance window for a multiple root, so
`Solve(sin(x)^10 = 0, x ∈ [3, 4])` still gives `[π]`. A second root closer than
the window to a multiple root can still be missed; giving no answer in that case
would remove correct answers to common equations.

### CE-153. Contour integration does not certify the complex roots of most polynomials of degree 3 or more

**Status:** open; capability, small. PR #410.

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

**Status:** open; capability, small. Issue #352.

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

### CE-159. Fungrim: `Fibonacci` has no growth class and there is no `CartesianPower` operator

**Status:** open; capability, low priority.

- **CE-159.1** `Limit(Fibonacci(n+1)/Fibonacci(n), n→∞)` stays an inert `Limit`,
  because `Fibonacci` has no growth class. To resolve it to φ, add a growth
  level for exponential-class special functions.
- **CE-159.2** A Compute Engine `CartesianPower` operator would make Fungrim
  entry `4099d2` evaluable. `grim2mathjson` emits the shell
  `CartesianPower(S, n)` for a set-based `Pow`, so the entry is `not-evaluable`
  instead of False.

### CE-160. `simplify()` does not sort the operands of `And` and `Or`

**Status:** on demand; capability.

The `eq` handler compares `And`/`Or` modulo permutation and nesting, and the
`commutativeMatch` definition flag drives the permutation branch of the matcher
(`logic-ac-equivalence.test.ts`). Step 3 of the agreed design ("Option B",
2026-08-16) is not built: a canonical sort inside `simplify()` only, so that
simplification can normalize the operand order without changing the written form
or short-circuit evaluation. Do it only when a concrete workflow needs it.

### CE-162. `Series`: bare `O(…)` parsing and expansions that defer

**Status:** on demand; capability.

- **CE-162.1** Bare `O(…)` parsing (design doc §8 Q3). Look at it again for
  lenient mode after the parser work settles.
- **CE-162.2** Expansions at ±∞ that carry a logarithm defer (`1/ln x`,
  `ln(ln x)`, `sin(ln x)`, `e^{1/x}`); a defer is correct, not wrong.
- **CE-162.3** Exact terminating expansions still emit a conservative `BigO`
  (`assembleLaurent` has no notion of exactness).
- **CE-162.4** Combined distinct radicals grow `lcm(d)` without a cap inside
  add/mul (the deadline bounds it and gives a clean defer).
- **CE-162.5** `diffLaurent` asserts `d === 1` (polygamma ladder only).

### CE-164. `Solve`: Diophantine tiers, general inequalities and systems, missing rules

**Status:** open; capability. Plan:
docs/plans/2026-07-04-diophantine-assessment.md.

The Wester `Solve` score is at its ceiling (14/21). The last two gaps, `xˣ = x`
and `sin x = tan x`, are harness artifacts: the harness grades the arbitrary
finite sets of roots that SymPy returns, not a CE capability. The Fungrim track
refers to this explanation.

- Diophantine equations (linear in n variables, Pell and Pythagorean triples are
  done):
  - **CE-164.1** The sum-of-squares tier (a representation function fits it
    better than `Solve`).
  - **CE-164.2** General binary quadratics through `transformation_to_DN`.
  - **CE-164.3** Instantiation over a half-bounded `Range` (inert by design
    today).
  - **CE-164.4** Auto-factoring in the style of `factor_list`.
  - Not planned: ternary quadratics (low value). Refused: weighted-coefficient
    and ≥4-square parametrizations, because the textbook families are provably
    incomplete and the contract emits only complete families.
- **CE-164.5** Inequality and system solving through `Solve` is partial: linear
  inequality systems work, general ones do not (see the `@todo` cases commented
  out in `test/compute-engine/solve.test.ts`).
- **CE-164.6** The solve rule set is incomplete (`solve.ts` "MOAR RULES", and
  two deferred side-condition checks noted in the file).

### CE-165. Multivariate polynomial `GCD` at the scale of the Fateman benchmark

**Status:** open; capability, large.

The variadic `GCD` uses Brown's dense modular GCD (`multivariate-gcd.ts`) and
handles textbook multivariate cases. The 7-variable Fateman GCD benchmark
(Symbolica 4 s / Mathematica 89 s / SymPy 61 min) is above the complexity cap of
the dense algorithm, so it defers. The kernel
(`boxed-expression/multivariate-poly.ts` + `multivariate-gcd.ts`) is shared:
multivariate factorization, `Cancel`/`Together`, partial fractions and
`Resultant` all use the same representation. Tracked against the Fateman
footnote of `benchmarks/audit/`.

- **CE-165.1** Zippel sparse interpolation (dense interpolation is the
  bottleneck at 7 variables; Brown's algorithm is the baseline that Zippel
  extends).
- **CE-165.2** Multi-prime CRT and rational reconstruction (a single large prime
  caps the coefficient size).
- **CE-165.3** Faster `MPoly` arithmetic (the `Map`-keyed leading-term scan is
  O(terms) per call).

### CE-166. `DSolve`/`NDSolve`: system form of `NDSolveFunction`, root clustering, Laplace transforms

**Status:** open; capability.

An unsupported ODE form must stay **inert, not wrong**; keep that contract as
coverage grows. The audit harness (`benchmarks/audit/dsolve.ts` +
`gen_dsolve.py`, a substitute-back residual oracle on 51 cases from SymPy's
`test_ode.py`) grades CE 50/51 correct, 0 wrong, the same as SymPy. The one
unsupported row is variable-coefficient second order (`sin(x)y″ + y′ = cos x`),
where SymPy returns nested unevaluated integrals, which `DSolve` does not
return.

- **CE-166.1** `NDSolveFunction` returns a callable
  `Function(InterpolatingFunction(data, x), x)` for scalar forms only. The
  system form with several dependent variables stays inert. A vector-valued
  interpolating result needs a shape decision. Demand-paced.
- **CE-166.2** Applying a MathJSON literal that was boxed again resolves the
  interpolation one `evaluate()` late (`N()` is immediate). Pinned in tests.
- **CE-166.3** Make the tolerance of the numeric characteristic-root clustering
  more robust, so that near-degenerate roots are grouped reliably as coverage of
  higher-order nonhomogeneous problems grows.
- **CE-166.4** A `LaplaceTransform`/`InverseLaplaceTransform` pair (inert
  today). It is a capability on its own and a second, independent route to
  constant-coefficient IVPs that checks the initial-conditions work. (`RSolve`
  already uses the characteristic-polynomial and root-multiplicity code for
  linear constant-coefficient recurrences, with an `rⁿ·n^k` basis instead of
  `e^{rx}·x^k`.)
- **CE-166.5** A proper `DiracDelta` (derivatives of step functions are 0 almost
  everywhere today). Possible future refinement.

### CE-167. Wester capability gaps: recursive denesting, matrix functions, closed forms

**Status:** open; capability.

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories that `benchmarks/audit/wester.ts`
cannot ingest). A gap is a `test.skip` that asserts the **correct** answer;
removing the skip is the acceptance test. One skip remains.

- **CE-167.1** Wester 9, recursive denesting (the Putnam radical
  `√(14+3√(3+2√(5−12√(3−2√2)))) → 3+√2`). Only single-level `√(a+b√c)` denesting
  is implemented. The multi-level case is an algorithmic project (Landau/Blömer
  style).
- **CE-167.2** Matrix square root beyond exact 2×2 (n×n needs an
  eigendecomposition or Denman–Beavers). Not representable as a skip.
- **CE-167.3** Exact singular values beyond a 2×2 Gram matrix. Not representable
  as a skip.
- **CE-167.4** Two Wester tests are active but weakened, and their comments
  still say "skipped" (outdated). The fused form `row-vector · (a·M1 + M2)`
  asserts the current type rejection of `MatrixMultiply`. The symbolic
  Vandermonde determinant is checked only numerically, because
  `Factor`/`simplify` leave it unfactored (a `/(−w+x)` division artifact).
- **CE-167.5** More closed forms for infinite sums and products beyond the
  `namedSeriesClosedForm` table (for example `β(4)`, Hurwitz-shifted bases
  `(k+m)^{−s}`, higher moments `Σk²rᵏ`). Demand-paced.
- **CE-167.6** Transcribe the remaining Wester categories: systems of equations
  and congruence solving, special functions, transforms, ODEs/PDEs (CE-166),
  vector and tensor analysis, numerical analysis.
- Missing heads noted in comments (`MatrixExp`, matrix functions, Jordan and
  Smith normal forms) are in CE-168.

### CE-168. Wester problems with no CE API: periodic decimals, real QE, matrix functions, tests

**Status:** design needed; capability. Decision 2026-07-05: do not alias
Mathematica spellings.

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

### CE-169. Definite integration does not split the parameter region into a `Which`

**Status:** open; capability. Plan:
docs/plans/2026-07-12-conditional-values-design.md.

The conditional-values design is implemented through Phase 3b (`When` threading,
the `Solve` guards, the convergence conditions). Definite integration is the
only producer of a `Which` still open.

- **CE-169.1** Region splitting for definite integrals. Example:
  `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` is `2π` for `|x| < 1` and
  `0` for `|x| > 1`. Today CE correctly stays inert. The hardest part is to find
  where the poles cross the contour.
- **CE-169.2** An unsatisfiable conjoined guard (`∫₀^∞xᵖdx`) is displayed
  instead of collapsing. It needs contradiction detection in assumptions; not
  worth doing alone.

### CE-170. Rubi: integration coverage by chapter

**Status:** in progress; capability. Rung history: `docs/rubi/RUBI.md` §5.

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

### CE-171. Guarded `arctan` addition and a sum-of-residues-in-a-region helper

**Status:** on demand; capability, small to medium.

The analytic-property store (`ce.functionProperties`, pole-aware `N()`), the
`Residue` operator and the `onBranchCut` guard exist. The logarithm and
power/root simplifications are branch-cut safe: `ln(a) + ln(b) → ln(ab)`
(`simplify-log.ts`) requires every argument to be provably non-negative
(decision of 2026-10-01), and the `.ln()` expansions (`boxed-function.ts`) stay
symbolic when an operand is provably on the negative-real cut. The generic-real
policy for even, odd and irrational exponents is in
[`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).

- **CE-171.1** A guarded `arctan(x) + arctan(y)` addition. This is a new
  capability (CE does not combine inverse trig functions today). Its validity
  region (`xy < 1`) is an arithmetic condition, not a branch-cut membership
  test, so the store does not help.
- **CE-171.2** A sum-of-residues-in-a-region helper. It needs a pole-enumeration
  API over the analytic-property store. (`GammaLn` is not a goal: it has a
  logarithmic branch point and is not meromorphic.)

### CE-172. Simplifications that `simplify.test.ts` skips

**Status:** open; capability. Each item has a `test.skip` in `simplify.test.ts`
(12 in all) that is its acceptance test.

- **CE-172.1** A common denominator for rational expressions
  (`1/(x+1) − 1/x → −1/(x²+x)`).
- **CE-172.2** Recognize inverse hyperbolic functions in logarithms (six
  identities, for example `ln(x+√(x²+1)) → arsinh x`).
- **CE-172.3** Inverse trig conversion (`arctan(x/√(1−x²)) → arcsin x`).
- **CE-172.4** `factor()` extracts common factors from an `Add`
  (`2π+2πe < 4π → 1+e < 2`).
- **CE-172.5** `(−x)^{3/4}`.
- **CE-172.6** `ln((x+1)/e^{2x})`: canonicalization expands it before the log
  rules apply.
- **CE-172.7** The multi-step trig identity of Phase 14 of the Fu paper.

### CE-173. The simplification case of issue #189

**Status:** open; defect. Issue #189.

`simplify-rules.ts` refers to a simplification case of issue #189.

### CE-174. Risch algorithm and fractional calculus

**Status:** deprioritized; capability.

- **CE-174.1** The Risch algorithm is the principled end point for
  `symbolic/antiderivative.ts`. The Rubi rules are the practical route; this is
  a marker, not planned work.
- **CE-174.2** A Liouville–Riemann fractional derivative (`@todo` in
  `library/calculus.ts`). Not planned.

### CE-462. A coefficient times an ellipsis product splits the last sample

**Status:** open; defect, small.

`3(2·4·\dots·2n)` evaluates to `3·2·4·…·2·n`: flattening the product splits the
last sample `2n` of the `ContinuationPlaceholder` pattern into two factors, so
the pattern no longer reads as `2k`. `expand()` and `negate()` keep such a
product intact (`boxed-expression/expand.ts`, `negate.ts`); the `Multiply`
canonical flatten does not.

### CE-175. A multi-index big operator with a dependent bound stays symbolic

**Status:** open; defect, low priority.

`Sum(j, Limits(i,5,5), Limits(j,i,10))` canonicalizes intact but stays symbolic:
`classifyBigopDomain` reads the symbolic lower bound `i` as not enumerable. To
enumerate it, the multi-set walk must resolve dependent bounds again at each
iteration. This may be the same problem as CE-115.

## Numeric evaluation and special functions

### CE-376. A singular endpoint that is not exact in binary reports a converged result with a wrong error bound

**Status:** open; cause not located. Found 2026-10-23 while fixing Tycho
row 427.

The adaptive quadrature (`adaptiveQuadrature` with `singularEndpoints`,
`numerics/gauss-kronrod.ts`) integrates an integrable singularity at an endpoint
correctly when the endpoint is 0 or 1, and not when it is 1/3:

| Integral                        | Result                        | True error |
| ------------------------------- | ----------------------------- | ---------- |
| `∫₀^(5/3) t^(−1/2) dt`          | converged, error `9.7e-12`    | `4.4e-16`  |
| `∫₁² (t − 1)^(−1/2) dt`         | extrapolated, error `1.5e-13` | `1.3e-15`  |
| `∫_(1/3)^2 (t − 1/3)^(−1/2) dt` | converged, error `2.4e-10`    | `6.5e-9`   |

The three integrals have the same value up to a translation. The missing part of
the last one is about the integral over one spacing of the doubles next to 1/3
(`2·√(5.5e-17)`), so the corner panel probably stops at that width with an error
estimate that is too small, and the result is reported as `converged` instead of
going to the extrapolation of the shells. A singularity inside the interval has
the same error since Tycho row 427 was fixed, because the quadrature now splits
the interval at the singularity and each half has it at an endpoint:
`∫₋₁² |t − 1/3|^(−1/2) dt` reports `converged` with an error of `4.5e-10`, and
its true error is `1.3e-8`. Before that fix, the true error was the same and the
result was also reported as `converged`. The interpreter uses the same
quadrature: `∫₋₁² |t − 0.3|^(−1/2) dt` evaluates to
`4.88803179952 ± 0.00000000047`, and the value is
`2·√1.3 + 2·√1.7 = 4.888031812279`.

### CE-179. Under `.N()`, some uses of a parameter in a user-function body read the rounded argument

**Status:** design needed; wrong value. User decision 2026-10-18: only the last
statement of a body gets the numeric request (option (a)).

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

### CE-180. `.N()` rounds an exact operand before the pole and branch-point tests of complex special functions

**Status:** open; wrong value.

- **CE-180.1** The complex routes do not re-read the exact value with extra
  digits, as the real inverse-trig route does.
  `StieltjesGamma(1, (−10³⁰+1)/10³⁰).N()` is `~oo` at 21 digits, where
  `evaluate()` stays symbolic. `Zeta(2, (−10³⁰+1)/10³⁰).N()` gives `2.6449` for
  about `1e60`. `Arcosh(1 + 10⁻³⁰ + 10⁻⁴⁰⁰i)` at 30 digits gives `1e−200(1+i)`.
- **CE-180.2** At machine precision an operand that stays complex,
  `Arcoth(1 + 10⁻¹⁰ + 10⁻²⁰⁰i)`, still reads the double of the real part:
  `complexInverseTrig` returns `undefined` unless the small part is below
  `SMALLEST_PART_RATIO`, so the double kernel runs. (A real operand next to ±1,
  and one whose imaginary part rounds away, is read exactly.) Also unchecked:
  `Arcoth(√(1+10⁻¹⁰)).N()` gives `12.20607260417249`, and `Sqrt` is not in
  `LITERAL_ARITHMETIC`, so that exact operand is not re-read.

### CE-181. `.N()` of a `k^{-p}` shell integral (`1 < p < 1.5`) at a nonzero or infinite bound is wrong

**Status:** open; wrong value, small.

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

**Status:** open; wrong value, small.

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

### CE-183. `PolyLog` past |z| = 1 at an order above 170 stays unevaluated for a very large |z|

**Status:** open; capability, small.

Past the unit circle, a real order uses the first terms of the power series when
they give the value (`polylogSeriesOutsideDisk`, `numerics/numeric-complex.ts`).
The series stops answering when its terms grow before they fall, which happens
when |z| is large compared with 2ˢ, and on the branch cut z > 1 when the
imaginary part −π·(ln z)^{s−1}/Γ(s) is above 1e−20. The other routes do not
answer above the order 170: the inversion formula of the integer orders needs
n!, which overflows a double at n = 171, and Jonquière's inversion of the
non-integer orders needs Γ(s), which overflows at s ≈ 171.6. So `.N()` stays
unevaluated for these points, although the values exist (mpmath gives
`polylog(250, 1e100) = 8.997e99 − 3.778e98i`):

- **CE-183.1** Integer orders: `PolyLog(171, z)`, `PolyLog(200, z)` and
  `PolyLog(250, z)` for z = 1e100, −1e100, 1e100·i and 1e300 + 1e300·i;
  `PolyLog(500, 1e100)`, `PolyLog(500, 1e300 + 1e300i)`,
  `PolyLog(1000, 1e300 + 1e300i)`.
- **CE-183.2** Non-integer orders: `PolyLog(250.5, z)` for the same four z,
  `PolyLog(171.5, 1e300 + 1e300i)`, `PolyLog(1000.5, 1e300 + 1e300i)`,
  `PolyLog(200.5, 1e40)`, and also `PolyLog(20.25, 1e300 + 1e300i)`.
- **CE-183.3** The compiled lane (`_SYS.polyLog`, real values only) gives `NaN`
  for `PolyLog(171, −1e100)`, `PolyLog(200, −1e100)` and `PolyLog(250, −1e100)`.

A possible route: the asymptotic expansion of Liₛ(z) for a large |ln z| (DLMF
25.12.12 with the Hurwitz zeta form of Jonquière's formula), with (2π)ˢ/Γ(s)
computed from logarithms so that it does not overflow.

### CE-394. `.N()` of an integral whose value is next to the largest double is `NaN`

**Status:** open; defect, small; low priority (user decision 2026-10-23: later,
because the result is an honest `NaN` and the fix changes `adaptiveQuadrature`,
which every numeric integral uses). Found 2026-10-23 (session
compute-engine-57).

`∫₀^∞ xⁿ·e⁻ˣ dx` is `n!`. A product that overflows against itself is computed
again in log space at the samples where it is not finite
(`withLogSpaceFallback`, `library/calculus.ts`; `_SYS.finiteOr` in compiled
code), and `.N()`, `NIntegrate` and compiled code give `n!` to 10 digits for
`n = 100` and `n = 150`. For `n = 170` (`170! ≈ 7.3·10³⁰⁶`) the change of
variable of the quadrature (`adaptiveQuadrature`, `numerics/gauss-kronrod.ts`)
multiplies the peak past the largest double, and the result is `NaN`
(`tailIsFinite`, `numerics/divergent-tail.ts`). A scaled quadrature (the
integrand divided by its largest sample) would give the value. Compiled code
with a caller mapping of `Ln`, `Exp`, `Abs`, `Sign` or the arithmetic does not
use the log-space form (`logSpaceOpaque`, `compilation/javascript-target.ts`).

### CE-185. A numeric integral next to a singular bound: remaining cases

**Status:** open; defect, small.

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

**Status:** open; capability, small. User decision 2026-10-04: until a method
gives a value, the result stays `NaN`; do not let these integrals fall back to
Monte Carlo. Issue #405.

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

### CE-187. A nested iterated integral on the parse route loses the error of the inner integral

**Status:** open; wrong value, small.

`.N()` of `\int_0^1\int_0^1 e^{-xy}/x^{0.99} dx dy` gives
`99.575857194449625 ± 0.000000000000000011`; the integral is `99.5758571944484`,
so the true error is `1.2e-12`, 1e5 times the reported error. The outer integral
compiles its integrand, which holds the inner integral, to `_SYS.integrate`
(`compilation/javascript-target.ts`). That call returns a plain number, so the
error of the inner quadrature is not added to the error of the outer one, as
`nIntegrateMultiple` (`library/calculus.ts`) does for
`Integrate(f, Limits(x, …), Limits(y, …))`.

A fix that reported the largest inner error to the enclosing quadrature (a
module-level value in `numerics/gauss-kronrod.ts`, added as `|b − a|` times the
largest inner error) was tried and withdrawn. It understates the error when the
integrand scales or sums inner integrals (`1000·I(x)`, `I₁(x) + I₂(x)`), it
gives no bound on an infinite interval, and the `converged` flag of the outer
result must then be computed again. A correct fix propagates the inner error
through the compiled arithmetic of the integrand, or applies the bound only when
the compiler proves that the integrand IS one inner integral.

### CE-188. `HurwitzZeta(s, a)` declines far left of the imaginary axis for some orders

**Status:** open; capability. Issue #340.

`hurwitzEMComplex` (`numerics/numeric-complex.ts`) sums one direct term for each
unit of −Re(a) before its Euler-Maclaurin tail, so the kernel declines when more
than `HURWITZ_MAX_PASSED_TERMS` (2²⁰) terms lie between a and the right
half-plane: `HurwitzZeta(2.5, −10^7 + i).N()` stays unevaluated (at once). An
integer order has a route whose cost does not depend on Re(a)
(`hurwitzZetaFarLeft`): the polygamma reflection for 2 ≤ s ≤ 10 001, and the
Bernoulli polynomial for s = −n ≤ 0 (n ≤ 60). What still declines:

- **CE-188.1** An order that is not an integer. It needs a representation whose
  cost does not grow with −Re(a) (for example the Hurwitz functional equation
  for a real a).
- **CE-188.2** An order above about 3 000 at a small Im(a), where the error of
  the reflection grows past 1e−12 of the value.
- **CE-188.3** A real a that is a non-positive integer, at every order. There
  `HurwitzZeta` drops the (a + k) = 0 term, while ψ has a pole.
- **CE-188.4** The generalized `Zeta(s, a)` uses the far-left route for an even
  order only: for an odd order its terms left of the axis are ((k + a)²)^(−s/2),
  which is not (k + a)^(−s).

### CE-189. `PolyGamma(m, z)` of an order above 400 declines close to a half-integer on the real axis

**Status:** open; capability. Issue #340.

For `Re(z) < 0`, `polygammaComplex` needs the m-th derivative of cot(πz). Close
to a half-integer with a small `Im(z)`, the two series it can use for that
derivative both lose all their digits, and the third form, a polynomial in
cot(πz), now carries its coefficients with a common power-of-two exponent and is
used up to order 400 (`COT_POLYNOMIAL_MAX_ORDER`,
`numerics/numeric-complex.ts`). Above that, the Horner bound `4^(m+1)` of the
polynomial is past the range of a double, so the order still declines. Most such
values are past the double range anyway (`PolyGamma(200, -3/2 + 1e-4 i)`).

### CE-190. Code that boxes a double with `ce.number(n)` can make an integer-valued float exact

**Status:** open; defect, small.

Since floats print with a fraction part (`2.0`), a site that boxes a double
result with `ce.number(n)` and so makes it exact is visible.

- **CE-190.1** Audit the kernel bridges and the compiled-value readers that call
  `ce.number(double)`; the float route is `ce._inexactNumericValue`.
- **CE-190.2** (decision needed) At machine precision `1.0e800` overflows to
  `PositiveInfinity`, which reports `isExact === true`. `BoxedNumber.isExact`
  (`boxed-number.ts`) states that the signed infinities are exact on purpose,
  there is no inexact-infinity value, and `fromNumericValue` maps every infinite
  value to the `PositiveInfinity`/`NegativeInfinity` constants; overflow under
  `.N()` (`10^{800}`) gives the same exact infinity. Changing this needs an
  inexact-infinity concept, which is a design decision.
- **CE-190.3** The compiled `N()` of a lazy `Map` boxes an integer-valued result
  as exact when its operands and the lambda are exact. An elementary function of
  an exact integer whose double is exactly an integer near 2^53 (`exp(36)`) is
  then exact where the interpreter gives a float (rare).

Rules that stay: a literal with a fraction part (`1.0`, `2.0`, `{num: "1.0"}`)
is a float on every route, and `ce.number(bigDecimal)` is exact for an
integer-valued big decimal (`doc/12-guide-numerical-evaluations.md`, "Exact and
Inexact Numbers: the Spelling Decides"). User decision 2026-10-15:
`BoxedNumber.N()` returns a small exact integer unchanged (`\sqrt{4}.N()` is the
exact `2`); changing it would touch many printed results for no gain.

### CE-191. Ordering of constants with some special functions stays undecided

**Status:** open; capability, low priority.

`approximate()` (`compare.ts`) propagates an error bound through `Gamma`, `Erf`,
`Erfc`, `Erfi`, `Zeta`, `Arcosh` and `Artanh`. At machine precision a fast path
orders `f(literal)` from the machine values when the two are farther apart than
`10⁻⁶` relative. Never a wrong order, only a lost answer.

- **CE-191.1** The `Bessel` family is not covered: a clean derivative bound
  exists only for an integer order, and the kernels' accuracy is unmeasured.
- **CE-191.2** `LambertW` and the polygamma functions are not covered.
- **CE-191.3** A tree whose leaves are not literals is not on the machine fast
  path: `Max(1 + Γ(1/3), 3)` at machine precision stays unevaluated (above
  machine precision the rigorous bound decides it).
- **CE-191.4** The intervals for Γ, ζ, arcosh and artanh are computed with
  doubles, so an argument within about `10⁻¹⁵` relative of a pole is refused at
  every precision (`Γ(−3 + 10⁻³⁰)` against `0` stays undecided at 50 digits).

### CE-192. `Hypergeometric2F1` at machine precision has up to 3.7e-11 relative error

**Status:** open; defect, small.

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

### CE-193. Upper incomplete gamma: regions where the complex machine kernel declines or loses digits

**Status:** open; capability. Issue #353.

The complex kernel `incompleteGammaUpperComplex` (`numerics/numeric-complex.ts`)
returns NaN (so `Gamma(s, x).N()` stays unevaluated) where no method can certify
about 12 digits in doubles. Its series forms carry an error estimate that bounds
the actual error (measured against mpmath on about 7500 points).

- **CE-193.1** `|Im s| > 10` and `|x| < 3|s|`, with `Re x < 0`, or with
  `Re s < 0` and `|x| < |s| + 1`. The continued fraction converges there but to
  a wrong value (error `2e−8` at `s = −0.41 − 23.9i`, `x = 0.088 − 4.0i`), and
  the power series often cancel too far. On 2500 random points with
  `|Re s|, |Im s| ≤ 30` and `0.01 ≤ |x| ≤ 600`, 68 declines are in this region.
  Example: `Gamma(19.427 + 13.838i, -8.4445 - 49.849i)`; mpmath gives
  `-2.3715013352684768e45 - 1.8981893850660706e44i`. Uniform asymptotic
  expansions for a large `|s|` would cover it.
- **CE-193.2** `|x| > 700` near the negative real axis, where only the
  asymptotic series is available, when the part of `Γ(s, x)` that it omits
  (about `2π·e^{π|Im s|}/|Γ(1 − s)|`) is not negligible. Example:
  `Gamma(100 + 600i, -800)` (mpmath `4.714e−133 − 1.980e−133i`).
- **CE-193.3** For a large `|s|` the accuracy is that of the complex `Γ(s)`
  (Lanczos formula): its relative error grows from about `5ε` at `|s| < 1` to
  `500ε` at `|s| = 13` and `5300ε` at `|s| = 790`, and `Gamma(s, x)` inherits it
  (`1.1e−12` at `s = 106 + 657i`, `x = −205 + 517i`). The per-point error
  estimate (`incompleteGammaUpperComplexWithError`) grows with it, and so does
  the cancellation check of `PolyLog`'s inversion formula
  (`polylogInversionComplex`, `numerics/polylog.ts`), which declines about 6% of
  the complex orders with `Re(s) < 0` past the unit disk for this reason. A more
  accurate `Γ(s)` for a large `|s|` (Stirling series with the argument shifted)
  would tighten all three. See also CE-192.

### CE-194. Complex transcendental functions compute in doubles at every precision

**Status:** open; capability. Plan: decision D4 of
`docs/plans/2026-09-27-big-decimal-imaginary-part.md`.

An inexact complex value holds its imaginary part as a big decimal, and `Ln`,
`Exp`, `Power`, `Root`, `Sqrt` and the arithmetic compute both parts at the
working precision.

- **CE-194.1** `Sin`, `Cos`, `Tan` and the other trigonometric and hyperbolic
  functions, `Gamma`, `Zeta`, the Bessel family and every other complex kernel
  still compute in doubles (`complex.js`, `numerics/numeric-complex.ts`):
  `Sin(1+i).N()` at 50 digits has 16 correct digits, and an imaginary part below
  the double range reaches those kernels as `0`. Fix: a big-decimal complex
  kernel per function family (the real `BigDecimal` kernels exist).
- **CE-194.2** In the `e^{iθ}` Euler branch
  (`boxed-expression/arithmetic-power.ts`, `halfTurns`), a large FLOAT angle is
  reduced modulo π at the working precision with no extra digits, so
  `e^{10^{30} i}` at 40 digits has about 10 correct digits
  (`-0.99593119441358739…`, true `-0.99593119440539570…`); `BigNumericValue.exp`
  called directly is correct. The reduction needs about `log10|θ|` more digits,
  or a float angle above machine precision should take `exp` directly.
- Expected float behaviour, not a defect: `e^{1152921504606846977.5 i\pi}`
  `.N()` at precision 50 is `4.5e-32 − i`, the rounding of `c·π` for a 19-digit
  `c` at 50 digits.

### CE-195. Complex eigenvalues, eigenvectors and decompositions of size 3 or more have no numeric route

**Status:** open; capability.

`Eigenvalues([[1, i, 0], [i, 2, 0], [0, 0, 3]])`, `Eigenvectors` of it,
`CholeskyDecomposition([[2, 1+i], [1-i, 3]])`, and `LUDecomposition` and
`QRDecomposition` of a complex matrix stay unevaluated under `evaluate()` AND
under `.N()`. `SingularValues(...).N()` and `SVD(...).N()` of a complex matrix
work through the kernel `singularValueDecomposition(re, im)` in
`numerics/linear-algebra.ts` (QR with column pivoting, then a one-sided Jacobi
pass), which returns the complex `U` and `V`.

- **CE-195.1** Hermitian matrices: the real embedding that this kernel uses also
  gives the eigenvalues. Run Jacobi on the embedding itself and take each
  eigenvalue once; an eigenvector `[x; y]` gives `x + iy`.
- **CE-195.2** A general complex matrix needs a complex QR iteration.
- **CE-195.3** `CholeskyDecomposition`, `LUDecomposition` and `QRDecomposition`
  of a complex matrix.

### CE-196. Adaptive quadrature answers NaN for an integrand finite only on a narrow region

**Status:** open; defect.

The adaptive quadrature stops when all panels are NaN, there are at least 16,
and a bisection gave two NaN children (`ALL_BAD_STOP_PANELS` and
`mustStopAllBad` in `numerics/gauss-kronrod.ts`). Isolated removable
singularities move to panel boundaries when their panel is bisected, so they
still converge, also when there is one at the center of each of the 16 starting
panels. But an integrand that is finite only on a region narrower than 1/16 of
the interval now answers NaN where the old loop could find a finite value. No
test covers this case.

### CE-197. Some Γ-ratio points stay symbolic past the exact-expansion caps

**Status:** open; capability.

- **CE-197.1** `Pochhammer(a, k)` with both `Γ(a)` and `Γ(a + k)` on a pole and
  `|k| > 20` (`SYMBOLIC_EXPANSION_CAP`).
- **CE-197.2** `GammaRegularized(n, z)` for `z < 0`: `evaluate()` for `n > 20`
  (`MAX_GAMMA_Q_SERIES_ORDER`) and `.N()` for `n > 200`
  (`MAX_GAMMA_Q_SERIES_ORDER_NUMERIC`, `library/distributions.ts`; a cap of 1000
  took 10 s).

These results stay symbolic; they are never `NaN`.

### CE-198. A matrix p-norm for `p ∉ {1, 2, ∞}` stays inert

**Status:** open; capability.

The order passes the declared precondition (it is a well-formed order at rank

1. and the operand is inside the carrier. The general matrix p-norm has no
   closed form and needs a numeric kernel.

### CE-199. `.N()` declines some convergent series with a slowly decaying or doubly logarithmic tail

**Status:** open; capability, low priority.

When the integer-power Richardson tableau does not certify, the infinite-series
`.N()` fits the tail exponent of the partial sums
(`fittedExponentExtrapolation`, `library/utils.ts`). The fitted route accepts a
result only with an error estimate at or under `max(1e-12, 1e-11·|v|)`,
agreement between the samples after `2^k` and `2^k + 1` terms, and a fitted
exponent above 0.05, so a divergent series still declines. These stay symbolic
(a safe result):

- **CE-199.1** `Σ 1/n^1.1`: a small exponent amplifies round-off (estimate
  1.2e-10).
- **CE-199.2** `Σ ln(n)/n^1.5`: does not certify under the tight tolerance.
- **CE-199.3** `Σ ln²(n)/n²`: needs each exponent three times in the tableau.
- **CE-199.4** A doubly-infinite sum with a non-integer-power tail: the
  absolute-series check that runs first declines it.

An infinite product that does not converge walks the full term budget before it
declines, as a declining sum does.

### CE-200. `.N()` of a negative base to an odd-denominator power: two remaining limits

**Status:** open; defect, low priority.

The branch of `(-2)^(p/q)` under `.N()` is decided by recovering `p/q` from the
numericized exponent under a coincidence-budget criterion
(`realPowerBranchTerms`, `arithmetic-power.ts`; tests in
`power-negative-base-branch.test.ts`).

- **CE-200.1** The `radical === 1` fast path of `_bignumComponent`
  (`exact-numeric-value.ts`) numericizes an exact rational at the ambient
  precision before the handler sees it. Keeping the exact exponent was measured:
  28 snapshot failures across 5 suites (the display widths of machine `.N()`
  change). It was reverted; it needs its own pass with the snapshot churn
  reviewed.
- **CE-200.2** The branch is decided by float reconstruction at `.N()` time. An
  exponent whose terms are too large to recover from a 15-digit double
  (denominator ≳ 3·10⁵ under the coincidence bound) takes the complex branch.
  The fix is to let the exact exponent survive numericization, which changes the
  evaluate-handler signature and needs its own design. Ask for a decision only
  if a consumer relies on float exponents with very large denominators.

### CE-201. Statistics Phase 3: inverse incomplete gamma/beta, more distributions, sampling, R²

**Status:** on demand; capability. Design doc §10.

- **CE-201.1** Inverse regularized incomplete gamma and beta kernels, and the
  distributions that need them (Student-t, χ², F, Geometric…).
- **CE-201.2** `RandomVariate` sampling (reuse the RNG and seed policy of
  `Sample`).
- **CE-201.3** Fit diagnostics (R²).
- **CE-201.4** The Python execution-parity suite for the scipy mappings is
  skipped until scipy is installed in `./venv`.

### CE-202. `Measurement`: correlated uncertainty, relative error, distributions

**Status:** on demand; capability.

- **CE-202.1** Dual-number correlation tracking (correct by default).
  Independent propagation over- or under-estimates when one measured variable is
  used in several operands (`x·x`, `x/(x+1)`). The design is a
  `BoxedMeasurement` carrier with a per-source identity; the hard part is
  keeping the source id stable across re-boxing (design doc "Non-goals").
- **CE-202.2** Relative-error notation (`±5%`).
- **CE-202.3** Links to distributions and `RandomVariate` (reuse the statistics
  RNG and seed policy).

### CE-203. `FindFit`/`FindRoot` v2: weights, covariance, `FindMinimum`, multi-start search

**Status:** on demand; capability.

- **CE-203.1** Per-point weights. Decided shape: a trailing optional `weights`
  argument, NOT a deduction from the tuple shape.
- **CE-203.2** Parameter uncertainty and covariance output (`JᵀJ⁻¹` is a
  byproduct).
- **CE-203.3** A general `FindMinimum`.
- **CE-203.4** Multi-start and global search. Do it only with corpus evidence of
  basin sensitivity.
- **CE-203.5** Document for consumers: a parameter named `e` canonicalizes to
  `ExponentialE` and cannot be fit.

### CE-204. The error bar of a definite integral is 1.6× optimistic on endpoint-singular integrands

**Status:** open; defect, large.

The tanh-sinh quadrature reports an error bar that is 1.6× too small when the
integrand is singular at an endpoint.

### CE-205. Numeric residuals from the July 2026 reviews

**Status:** open; defect, low priority. Summary: docs/STATUS_REPORT.md.

The source list of these items ended with "…"; the detailed records are in Git
history.

- **CE-205.1** Fu simplification of `sin⁴−cos⁴`.
- **CE-205.2** The error bar of definite integrals and the tanh-sinh route.
- **CE-205.3** Digits of the machine `gamma()` in its middle range.

### CE-206. Known numeric inaccuracies pinned in the tests

**Status:** open; defect.

- **CE-206.1** Bignum `Arccos` near 1 loses about 8 digits (endpoint
  cancellation; a per-case skip in `mpmath-kernels.test.ts`).
- **CE-206.2** `ζ(−0.5)` is about 4 ulp off (the test tolerance is relaxed).
- **CE-206.3** One inexact `Multiply` case where the big-precision route is less
  accurate than the machine evaluation (`arithmetic.test.ts`, `@fixme`).

### CE-207. `LerchPhi` past |z| = 1 declines for a complex `a` whose shift terms are much larger than the value

**Status:** open; capability. Issue #340. Issue #353.

`lerchPhiComplex` (`numerics/lerch-phi.ts`) declines (`N()` stays symbolic)
where no route can vouch for 1e−11 relative accuracy. It does not return a wrong
number: every returned value on about 30 000 sweep points is within 1.1e−12 of a
reference (on a 2026-10-06 sweep of 12 000 points with orders up to 200 and |z|
up to 1e300, within 8.8e−13).

The routes past the circle: for `Re(s) > 0` off the cut, the leading terms of
the series with a proven bound of the rest (`lerchSeriesOutsideDisk`); the
continuation (`lerchContinuedWithError`); the sum over the Fourier modes of the
base point for a real `a` and every `s` that is not a positive integer
(`lerchModesComplex`); an integral route for `Re(s) > 0`
(`lerchIntegralComplex`); and Lerch's transformation formula for a complex `a`
(`lerchFunctionalComplex`). A Taylor series in `a` was tried and removed: it
answered no point that the others miss and cost up to 0.5 s per declined call.

What still declines:

- **CE-207.1** A complex `a` with `Re(a) < 0` where the terms that move `a` into
  the strip `0 ≤ Re(a) ≤ 1` are hundreds of times the value or more: 217 of 1197
  points (`Re(s)` from −30 to 1, `|z|` up to 1e7), 31 of 1200 with `|z| < 32`.
  Example: `LerchPhi(-246.62-375.42i, -29.535, -5.5009-2.4185i)`, reference
  `1.1285770581632545e21 − 1.6446479143332522e22i`. The formula's value is
  3.6e−12 off there, but its estimate is 1.7e−10: the term for the rounding of
  `v = e^{2πib}` is pessimistic at a large order. Extended precision for the
  shift would answer the worst of them.
- **CE-207.2** A complex `a` with `Re(s) ≥ 1/2`, `|Im a| ≳ 3` and `|z| ≥ 1000`,
  where the integral oscillates: 44 of 800 points, for example
  `LerchPhi(2626400, 7.1652, -5.2092-3.5859i)`.
- **CE-207.3** A real `a`, `Re(s) < −9`, `|z| ≥ 1000`: 3 of 3000, where the
  estimate is 8 to 25 times the actual error. Example:
  `LerchPhi(-552.66+1009.12i, -23.020, -6.1124)`, reference
  `−4.7098482456230114e17 − 1.9081680693676611e18i`.

The `hurwitzZetaComplex` kernel is not a limit of the modes route: it is within
88ε of its envelope up to `|Im s| = 20` (`hurwitzKernelWeight`).

References: do not take references for a complex `a` past the unit circle from
mpmath's `lerchphi`. It returns a value on the wrong sheet of the incomplete
gamma term in part of the `a` plane (see `closedTermSheet` in `lerch-phi.ts` and
the tests that pin the corrected values). For `|z|` above about 1e5, `lerchphi`
at 60 digits is also wrong (7.5e−7 at `lerchphi(-9959.2, -8.16, 1.25)`). Use 200
digits or more, or the integral `(1/Γ(s))∫₀^∞ t^(s−1)e^(−at)/(1 − z·e^(−t)) dt`
for `Re(s) > 0`.

### CE-208. `HurwitzZeta` declines some complex arguments with a large `|Im a|` and `|Im s|`

**Status:** open; capability.

`hurwitzZetaComplexWithError` (`numerics/numeric-complex.ts`) declines, so the
expression stays unevaluated, when its per-call error estimate is above 1e−12 of
the value even after the powers are recomputed in double-double. On 11 900 sweep
points against mpmath this happened at 26 points, all with `|Im a| ≥ 3.4` and
`|Im s| ≥ 7` (20 of 1500 with `Re(a)` from −10 to 0, 3 of 2000 with
`Re(a) > 0`).

- **CE-208.1** Cancellation in doubles. Example:
  `HurwitzZeta(-0.22+12.28i, -6.93-4.78i)`, mpmath
  `-1.9865506122150481e-14 - 1.4517190884718218e-13i`. The terms of every route
  are about 1e−7, so their sum in doubles loses the digits. The condition number
  is small (below 4.4e−14), so a route that does not cancel would answer: a
  big-decimal complex Hurwitz kernel, or a representation that does not pass
  over the terms left of the imaginary axis. Another example with `Re(a) > 0`:
  `HurwitzZeta(-11.57+17.97i, 0.0085-4.458i)`, mpmath
  `-1.5251523329103249e-7 - 5.5532800426926228e-7i`.
- **CE-208.2** The kernel also declines for `|Im s|` above about 12 800 (unless
  `Re(a)` is large enough for the Euler–Maclaurin sum) and for `Re(a) < −2^20`,
  both to bound its work.
- **CE-208.3** `HurwitzZeta(0.5, 0.5+1e300i)` is `NaN`, not a decline, because
  the modulus of `a` overflows.

References: do not take references for `Re(a)` far below 0 from mpmath's
`zeta(s, a)`. At `s = 0.3+50i`, `a = −300.5+2i` it disagrees with its own sum of
the 301 passed-over terms plus `ζ(s, a+301)` by 6.8e−6.

## Compilation

### CE-467. A `range` argument at an inferred point parameter declines to compile

**Status:** open; capability, small.

With `d(a) := a[1] + a[2]` (the index reads infer `a: tuple<number, number>`)
and an argument typed `integer | range`, compiled `d(r)` declines on the
JavaScript and interval targets (`checkPointParamCollectionUnionArgs`,
`compilation/base-compiler.ts`), while an argument typed `integer | vector` or
`integer | vector<2>` compiles. The interpreter binds a range of numbers whole
at that parameter, as it binds a list of numbers. Check how a range value
reaches compiled code at run time (an array, or a lazy range object) before
accepting it there.

### CE-463. Compiled effectful input reads are merged by emitted source and reordered

**Status:** open; possible defect, not verified. Reported by a reviewer on the
code committed in `cd704b6b8` (`compilation/base-compiler.ts`, the guard
bindings of `vars`-mapped symbols near lines 13400 to 13435).

- **CE-463.1** The bindings group reads by emitted source, so two symbols mapped
  to the same effectful expression share one read: with `p` and `q` declared
  `any` and both mapped to `_.values.shift()`, compiled `p + q` reads the queue
  once and gives `4` for the values `[2, 3]` instead of `5`. Deduplicate by
  symbol identity, or merge only reads proved free of effects.
- **CE-463.2** The outer bindings evaluate mapped symbols before every other
  operand: for a structural `Subtract(F(), p)` where `F()` and the mapping of
  `p` each consume `_.values.shift()`, the values `[10, 3]` gave `7` before and
  `−7` now. Evaluate the operands in their original order, or decline the guard
  when the effectful reads cannot be bound without reordering.

First write the two tests; if they pass, delete this entry.

### CE-209. `Sum(f(x), Element(x, xs))` does not check `xs` for raw `Nothing` positions

**Status:** open; defect. Part of CE-218.

Add a distinct compiled representation of `Nothing` (CE-218). Keep the compiler
refusals that are sound where omission cannot be represented yet. Audit the
iterator domains too: the omission check of `Sum(f(x), Element(x, xs))` does not
inspect `xs` for raw `Nothing` positions. The clause is binding syntax, not a
collection operand.

### CE-212. The compiled presence guard of a branch misses a variable read only in a nested arm

**Status:** open; defect. Tycho row 413. Part of CE-218.

Compiled code guards a branch so that an unsupplied variable takes no arm. The
guard is static. A variable read only by an arm of a nested `If`/`Which`, or by
a later `Which` condition, is not guarded. So with `y` unsupplied,
`If(If(x > 0, y, 1) > 0, 1, 0)` at `x = 1` is `0`, not `NaN`. Also, a variable
in a nested connective that could decide without it is guarded anyway. A dynamic
guard cannot recover the absence through arithmetic in the arm (`2y` of an
unsupplied `y` is `NaN`, not `undefined`). So this needs the distinct compiled
representation of absence (CE-218).

### CE-216. A compiled power of a list that may hold points squares each entry of a square matrix

**Status:** open; defect.

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
- **CE-216.2** With `g := t ↦ [t, 2t]` and `x: any`, `g(x)[1]^2` at
  `x = [[1, 2], [3]]` squares each cell, where the interpreter gives the matrix
  power: the element may be a matrix or a list of points. With an annotated
  `h := (t: number) ↦ [t, 2t]`, the same failure follows the type of CE-371.
- **CE-216.4** With `p, q: any` holding two matrices, compiled `p·q` and `p^2`
  are entry-wise, where the interpreter gives the matrix product and the matrix
  power. The run-time check of an `any` operand (2026-10-25) sends a list to the
  entry-wise code, as for a bare `list`, because a list of points and a matrix
  are the same array at run time.
- **CE-216.3** `Dot(g(x)[1], [1, 1])` with `x: any` declines: the element may be
  a matrix or a list of points, which compiled code cannot tell apart (the
  interpreter leaves `[(1, 2), (2, 4)]·[1, 1]` unevaluated).

### CE-218. Compiled absence checks need a representation of `Nothing` distinct from `Missing`

**Status:** design needed; capability. User decision 2026-10-20: keep refusing
omission-capable sources. Plan:
`docs/plans/2026-10-20-bare-tuple-record-any.md`.

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

### CE-222. Compiled code reads an undeclared symbol as a number, so a list argument gives a wrong value

**Status:** open; wrong value.

With `M` not declared, `compile(If(M < 3, M, 0))` (JavaScript) emits
`((_.M !== undefined) ? ((_.M < 3) ? (_.M) : (0)) : NaN)`. `run({M: [1, 5]})`
and `run({M: [[1, 2], [3, 4]]})` both give `0`, while the interpreter gives
`[1, 0]` and `[[1, 2], [0, 0]]`. Nothing checks at run time that the argument is
a number. Expected: a run-time check of an argument that the compiled code
assumes to be a number (or a refusal to compile a symbol whose type is not
known), so a list argument gives the interpreter's value or an error.

### CE-227. Two trigonometric argument shapes are not reduced on the shader targets

**Status:** open; defect, small.

A shader computes in float32, and the constant term of a trigonometric argument
is reduced by whole periods at compile time (`gpuReduceTrigOffset`,
`compilation/gpu-target.ts`), so `\sin(x+10^6)` compiles to
`sin(x + -0.35756418)`. One shape is not reduced, and its shader value can be
far from the `javascript` value (a constant term that calls a pure library
function, `\sin(x+\Gamma(20))`, is now folded by `gpuLibraryConstant()` unless
it reaches a caller-mapped name):

- **CE-227.2** A complex argument (`\sin(x+10^6+10^6i)` through `_gpu_csin`).
  Its real part is periodic in the same way, but the constant is one complex
  literal.

A high-precision shader mode is not needed: Tycho's GPU picture promises float32
only, and its curve lanes draw in float64 on the CPU. The shader accuracy
measurements of 2026-10-18 are in the git history of ROADMAP.md before
2026-10-19, under the title "The shader targets compute a large trigonometric
argument in float32 with no warning".

### CE-230. Cases where a compiled user function with a real result still leaves the real lane

**Status:** open; defect, small.

Under the JavaScript target's default `auto` mode, a function declared `-> real`
compiles its body on the real lane, the index of a sum, product, loop or
comprehension over literal bounds is typed `integer<a..b>`, and a user function
is compiled for the range of its argument when the range proves the sign of a
radical in its body. These cases remain:

- **CE-230.3** The range copies of a user function are shared by containment of
  the argument range, in emission order: `1..16` compiled after `2..10` gives
  two copies (`integer<2..>` and `integer<1..>`), where one would do. A copy
  already emitted is not widened.
- **CE-230.4** A clause that becomes a literal `Range` only after
  canonicalization gets the inferred narrowing, which the first assignment of an
  index value widens to `integer`; only a clause whose raw form has integer
  literal bounds is declared ranged.

### CE-233. Integer and string operators that the JavaScript target does not lower (Epsil corpus)

**Status:** open; capability.

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

### CE-234. `Norm` and `Hypot` at extreme magnitudes in the other compile targets

**Status:** open; task.

At machine precision, the interpreter's `Norm` and `Hypot` and the compiled
JavaScript `Norm`, `Hypot` and `Distance` scale the components by a power of 2
when the largest one is outside the range where its square is a normal double
(`scaledPNorm()` in `numerics/linear-algebra.ts`); the Python lowering scales
the default, order-2 and Frobenius norms the same way (`pyNorm` in
`compilation/python-target.ts`). To do for each case below: measure it at 1e-200
and 1e200 (1e-30 and 1e30 for f32), and scale where the result underflows or
overflows.

- **CE-234.1** A literal p-norm with p other than 1, 2 and ∞ in Python (`|x|³`
  overflows above about 5.6e102, inside the range that the power-of-2 rule
  leaves alone).
- **CE-234.2** The interval `Hypot` (`interval/elementary.ts`).
- **CE-234.3** The GLSL and WGSL lowerings (f32, whose range is much smaller).
- **CE-234.4** The spectral norm `Norm(M, 2)`.

### CE-237. The Python target compiles a block-local function only in a direct call

**Status:** open; capability, small.

Python compiles a call of a block-local function as a direct call `h(n)` when
every argument is provably a number, a boolean or a string (`const`, `let`,
`function`, and `Declare` + `Assign`). Tests:
`test/compute-engine/compile-block-local-function.test.ts`.

- **CE-237.1** Still declined, each with its cause: a call whose value is an
  operand of arithmetic (`2 * h(n)`, a recursive `n * fact(n - 1)`), because the
  call has no static result type and Python has no counterpart of the JavaScript
  scalar-result check (`isConstructedScalar`, `javascript-value-facts.ts`, which
  needs a Python review, since a Python tuple repeats under `*`); a call inside
  a lambda body whose argument is the lambda's untyped parameter; a list
  argument (no run-time broadcast); a rebound local; and a call inside a loop
  body (`compilePythonStatements`).
- **CE-237.2** The decline of an `If` with no else branch ("If: wrong number of
  arguments") does not name its cause.

### CE-240. Interval target: census declines that remain are not on the interval lane

**Status:** on demand; capability.

Tycho uses the interval lane for line plots (break detection, with a JavaScript
fallback) and for implicit curves (the CPU quadtree). Parametric curves,
surfaces and 3-D members never use it, although the Tycho census compiles every
row on every target. The declines that remain in the 17 census documents with
point arithmetic were traced to their source rows; none is an implicit curve.

- **CE-240.1** A `PointList` with list components (7 rows): not built, by user
  decision. Five rows (`n7uhaaoq1q`) are `[PointList(…) for …]` comprehensions,
  3-D parametric surfaces; one (`2ki2hjsouf`) is in a document the plan of
  2026-09-15 marks invalid; one (`mk7duulwxf`) is the restriction
  `1 > 0 {|2C·√min(…) − (0..C)| ≤ 1}`, which after the zip stops again at a
  relation over a `list<boolean>` (a list of verdicts is not a result of this
  target). If it is ever wanted: `_IA.bcastPoint` already consumes a list of
  points, so only the zip that builds one from the component lists is missing
  (shortest length, a scalar component repeated), spelled in
  `compileIntervalCollectionValue` under the `PointList` head when a component
  is a list.
- **CE-240.2** `List` in an operand position: two rows (`rwhqbsp4wq`) are
  `P(0.1x, 6000·[0, 0.1, …, 1])`, an explicit list of ten line plots. The
  JavaScript lane compiles them, so the cost is break detection on those lines,
  not the plot. Two rows (`epq7yidtim`) are a 3-D `PointList` comprehension
  under a `distance` restriction, a surface.
- A matrix operand of a kernel (2 rows, `jgcclk1njk`), `GeometricVector` (6
  rows) and `At` over a tuple with a component that is not a number (3 rows) are
  not interval-lane members (vectors are drawing primitives; the matrix rows are
  parametric). They are listed so the next measurement starts from the same
  numbers.
- **CE-240.3** An elementary function over a DECLARED point: `Sin(P)` with
  `P: tuple<number, number>` declines ("the operand is a collection"), while
  `Sin((a, b))` over a literal point of untyped symbols maps over the
  coordinates, as the interpreter does for both. The pin of 2026-09-15 "a point
  is consumed whole, never mapped over" keeps the declared case declining; point
  arithmetic admits only `Add`, `Subtract`, `Negate`, `Multiply` and `Divide`.
  `Abs` and `Hypot` read a point whole (its norm) and must stay out of any
  widening. No census row stops here.

### CE-242. A scalar compiled comparison with an absent operand answers a decided boolean

**Status:** open; defect, design.

`Equal(a, b)` with either operand absent from the object of variables compiles
to `false` (`NotEqual` to `true`); the interpreter answers `Missing` for
`Equal(Missing, 5)` and `NotEqual(Missing, 5)`. The ELEMENT-WISE runtime is
three-valued (an absent cell is marked `NaN`, read by the selection runtime and
the element-wise connective guard); the scalar lowering is not, because four
places rely on a real boolean:

- `BRANCH_RELATIONS` states so.
- `kleeneRelationLeaf` negates the comparison with a bare `not`, which would
  turn a marker into `true`.
- A value-position `And`/`Or` is a plain `&&`, which cannot let a decided
  `false` absorb an undecided operand.
- A chained comparison would need a three-valued fold that still stops at the
  first false pair, as the interpreter does (`evaluateChainOperands`).

Also: the marker arm would have to fire when EITHER operand may be absent (a
literal on one side makes the pair decided today, so `Equal(a, 3)` and
`Equal(a, b)` would disagree), and the emitted arm splices both operands twice,
which double-evaluates a pure but expensive operand (only impure operands are
bound today). A fix must change all of these together.

### CE-244. A point argument with a complex-valued coordinate declines on the JavaScript target

**Status:** open; defect.

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

### CE-245. Point arithmetic with a list of points still refuses to compile in some forms

**Status:** open; defect, small.

These are refusals, not wrong values:

- **CE-245.1** `P\{c\} + [Q_1, Q_2]` ("may be a point or a list of points at run
  time", the `'runtime-list'` emission).
- **CE-245.2** `[P\{c\}, Q] + R` and `[1,2]·P\{c\} + Q` ("scalar arithmetic over
  a list-valued operand").

Accepted rule that stays: on `javascript`, a list held by a free point
coordinate becomes `NaN` (`_SYS.pointSlot`), so `[1,2]·PointList(t,t)` run with
`t = [1,2]` gives `[[NaN,NaN],[NaN,NaN]]` where the interpreter answers
`[(1,1),(4,4)]`. Refusing the compile whenever a coordinate type is `unknown`
would also refuse ordinary plot expressions. On `interval-js`,
`2·PointList(t,1)` with `t = [1,2]` gives the point `([2,4], 2)`; plot variables
on that target are numbers.

### CE-247. Compiled colour values are stored in OKLCh instead of their own colour space

**Status:** open; design.

The compiled constructors store every colour in OKLCh (`_SYS.rgb(0.2, 0.5, 0.7)`
is `{space: 'oklch', …}`), so each `AsRgb`/`AsHsv` of a constructed sRGB colour
makes an OKLCh round trip (compiled `AsRgb(Rgb(0.2, 0.5, 0.7))` gives
`0.20000000000000512`). The snapping tolerances in
`numerics/color-conversion.ts` then correct it.

- **CE-247.1** Fix at the cause: the compiled constructors keep their own space,
  as the interpreter keeps the `Rgb` head.
- **CE-247.2** `numerics/color-conversion.ts` copies conversions of
  `@arnog/colors` because that package rounds to integers and does not clamp HSL
  (`hslToRgb(30, 1, 2)` is `{r: 255, g: 510, b: 765}`). Fix it there and delete
  the copies. The shader helpers (`gpu-target.ts`, `_gpu_srgb_to_oklab` and
  neighbours) are a third copy of the conversion math, with their own f32
  coefficients and an achromatic threshold of `1e-6`.

Symptoms of the OKLCh storage:

- `AsHsv(Hsv(120, 1, 0))` is `Hsv(120, 1, 0)` on the interpreter and `[0, 0, 0]`
  compiled, because OKLCh has no hue at zero chroma (112 of 200 random
  achromatic inputs differ).
- The interpreter's `AsHsv`/`AsHsl` snap a saturation below `1e-9` and a hue
  within `1e-9` of 0 to 0 (`ACHROMATIC_TOLERANCE`, `HUE_TOLERANCE`) only to
  match the compiled round trip, so `AsHsv(Rgb(0.5, 0.5, 0.5000000001))` is
  `Hsv(0, 0, …)`, not exact.
- Compiled `ColorToString(Rgb(1, 0.5, 0))` is `#ff7f00` and the interpreter's is
  `#ff8000`: the round trip gives a green channel of `0.49999999999999795`.

A colour tuple that reaches a colour operator through a VARIABLE keeps the
route's canonical reading (OKLCh on the compiled targets), because its shape is
not known at compile time. This is documented in the handler comments and
pinned; a better answer needs a run-time tag on colour values.

### CE-248. Asking for the lane of a user call emits code and can throw

**Status:** open; design.

A user-function call reads the lane its emitted definition recorded
(`userCallLane`, `recordUserFunctionLane` in `compilation/base-compiler.ts`). A
parent lowering asks for the lane of an operand before it compiles the operand,
so the question emits the definition on demand. This needs a global
`_callSiteTarget`, a per-call route memo, and pruning of definitions that the
question emitted but nothing uses; `isComplexValued` can therefore write
definitions and throw user-facing diagnostics.

Cleaner design: in `compileExpr`, before a lowering reads the lanes of its
operands, emit the definitions of the user-function calls among its direct
operands with the current target and frames. Then `userCallLane` only reads the
record, and the global, the route memo, the ask-time pruning and the throws
inside the predicate go away.

### CE-249. Tycho corpus document `s8ishknvhe`: two rows still decline to compile

**Status:** open; defect. Plan:
`docs/plans/2026-09-19-codegen-reassessment-ce1313.md` (item 3).

A broadcast head now reads a list that mixes complex and real cells, and the
compiled complex arithmetic of the JavaScript target answers a pole as the
interpreter does. The stereographic projection of the document (audit record 146
of `/private/tmp/ce-codegen-reassessment-0919/ce-0.131.3-targeted.json`)
compiles when its point list `C_c` is declared
`list<tuple<number, number, number>>`.

- **CE-249.1** With `C_c` undeclared, the body still declines. Its type is then
  `broadcastable<tuple<broadcastable<number>, …>>`, a value that may be a scalar
  or a collection at run time. The lane analysis of the broadcast closure
  refuses such an operand when it has complex evidence (`_operandElementLane` in
  `compilation/base-compiler.ts`, the `isBoundPossiblyCollectionTyped` case,
  pinned in `test/compute-engine/broadcastable-compile.test.ts`). The reason:
  the entry of the compiled function refuses a scalar binding of a complex-typed
  parameter, so compiling the array case would replace a decline with a run-time
  error. Whether Tycho declares `C_c` with the narrow type is a Tycho question.
  On the Compute Engine side, the refusal can be examined again now that a mixed
  cell is read through `_SYS.cplx`.
- **CE-249.2** The colour row of the point cloud declines under
  `mode: 'complex'`, the mode Tycho compiles it in. It compiles under
  `mode: 'strict'` and `'auto'`. The row is `AsOklab(c_f)` with
  `c_f = Hsv((180/π)·PointX(A_rg(C_cf)), Min(1, 2 − 2·PointZ(C_cf)), Min(1, 2·PointZ(C_cf)))`
  and `A_rg(p) := (Arg(p.x + i·p.y), Arccos(2·p.z − 1))`. Repro without Tycho:
  assign `A_rg` as above, declare `C: list<tuple<number, number, number>>`, and
  compile `Hsv(57.29·PointX(A_rg(C)), 1, 0.5)` with `mode: 'complex'`. The row
  meets a chain of requirements. Three are understood, in this order (measured
  2026-09-20 on Tycho's route; each trial fix let the row reach the next one).
  No trial fix was landed: no route yet compiles the row to a value that can be
  compared with the interpreter.
  - A coordinate read inherits the verdict of the whole point. Under complex
    mode, `Arccos` of a value of unknown range is complex-valued, so the pair
    `A_rg(p)` is too, and `isComplexValued(PointX(A_rg(C)))` answers `true`
    although `PointX` reads `Arg(…)`, which is real. The hue then has complex
    evidence and a possibly-collection type, `operandElementLane` answers
    "undecided", and `Hsv` declines. Trial fix: an arm in
    `_isComplexValuedFunction` (`compilation/base-compiler.ts`) beside the one
    for `At`: a point accessor over ONE point whose coordinates can be seen (a
    `Tuple`, or a call of a user function whose body is a `Tuple` or a
    `PointList`) answers from that coordinate. Tycho's converted `A_rg` builds
    its point with `PointList`, whose operands are not provably numbers, so
    `collectionConstructorBody` must accept any `PointList` for this question.
  - `PointList` refuses a component typed `list<number> | number`.
    `compileJSPointList` (`compilation/javascript-target.ts`) has a run-time
    role test (`Array.isArray`) for a `broadcastable<number>` component. It
    throws "neither a scalar slot nor a list source" for the union
    `list<number> | number`, the type of a coordinate read whose point may be
    one point or a list of points. (Since 2026-10-22, `broadcastable<number>` is
    `number | tensor`, which also holds a matrix, so the two types no longer
    have the same values; for a coordinate read the run-time test is the same.)
    Trial fix: admit to the same run-time test a union whose every member is a
    scalar number type or an indexed collection of scalar numbers, with no tuple
    member.
  - An ordering over `|1/Conjugate(…)|` is refused as complex-valued. Not
    traced: `Less` declines with "an ordering comparison over the complex-valued
    operand" for an `Abs`, which is real by definition. The stereographic
    projection of the same document has the same comparison and compiles, so the
    difference is in the shape of the operand here (`C_cf` is the fully expanded
    `S(f(N(F(0))))`).
  - In the repro without Tycho, the first trial fix moves the decline to
    `Argument` ("a broadcastable head over a possibly list-valued operand"),
    which is the refusal of CE-249.1.
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

### CE-250. interval-js library: `widen()` margins that stay after outward rounding

**Status:** open; design.

`integrate.ts` keeps its `widen()` margin for the partition widths, with a
deliberate factor of three. The composed hyperbolic and reciprocal routines are
built from unrounded kernels and take one rounding step at their own export,
except `remainder`, whose three-operation composition takes three.

### CE-252. Tycho code-generation audit of 2026-09-08: run it again at HEAD

**Status:** open; task.

The audit is
`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-08-report.md` (CE
0.126.2, 862 records over 71 documents).

- **CE-252.1** Audit item J3 does not reproduce at HEAD. The 496 `_SYS.bcast`
  sites over user-function results needed the call to have the type top. Every
  construction tried (assign, declared `-> unknown`, `Block`, `If`, `Which`,
  piecewise) has the type `number` at HEAD, because the Block analysis reads the
  value before the type since 2026-09-08. The constructed-scalar arm is a guard
  for weaker inference. Run the audit again against HEAD before more work here.
- **CE-252.2** Audit item I4 was not worked: interval piecewise arms are
  compiled as per-call closures, and the `Sum` bound is read through an inline
  shape probe.

### CE-253. `Sum(At(P, Range(a, b)))` materializes the range on the JavaScript target

**Status:** open; capability.

The 24 `Array.from` range sites in the corpus are all places where the range is
needed as a list (7 gather indices, 15 spread elements, 2 broadcast operands);
no site needs only a counting loop. The 7 gather sites need a gather/reduce
fusion in `emitCollectionReduce` (`javascript-target.ts`), which is a new
lowering.

### CE-255. GPU literals use the full double spelling instead of the shortest float32 one

**Status:** open; capability.

Folded GPU literals are spelled with the full double `toString` through
`formatFloat` (`0.00015625001105945557`). The shortest float32 round-trip
spelling has about 9 digits and makes shaders smaller. `formatFloat` is shared
by every GPU emission.

### CE-256. A compiled record reaching an `unknown`-typed callback parameter is broadcast over its fields

**Status:** on demand; defect.

The broadcast-aware wrapper that a function value receives decides with
`Array.isArray`, and a record, tuple or nominal value lowers to a bare
JavaScript array. A parameter TYPED as one of those keeps the bare reference
(`signatureParamsLowerToScalars`, `base-compiler.ts`). A parameter left
`unknown` is admitted, as the broadcast requirement of the interpreter admits
it, so `Map(f, persons)` with an unannotated `f(p)` would map over the fields of
each person. Objects have no compiled representation yet, so no corpus reaches
this. Tighten the requirement when objects get a compiled representation.

### CE-259. Compiled arithmetic over a captured scalar-typed symbol does not broadcast at run time

**Status:** on demand; design.

`compile(2y)` emits `2 * _.y`, and `run({ y: [1, 2, 3] })` answers NaN where the
interpreter answers `[2, 4, 6]`. This is the standing contract of the compile
target for a free symbol (a number unless typed as a collection). The
user-function call guard covers only call sites. Decide the contract if a
consumer asks.

### CE-263. Compiled `Norm(v, 0)` answers `NaN` where the interpreter answers a precondition error

**Status:** deprioritized; design.

An `Error` has no float representation, and `NaN` is the documented compiled
spelling for "no value", so the lane changes the error to `NaN` instead of
refusing to compile a whole program for one bad order. Not planned.

The same spelling applies to the compiled `If`/`Which` (decision of 2026-09-02):
a condition that is not exactly `true` or `false` at run time takes no branch
and answers NaN, on the JavaScript-family targets
(`BaseCompiler.conditionDecidability`), on Python (`compilePythonBranch`,
`compilation/python-target.ts`) and in the interpreter. GLSL and WGSL
deliberately keep JavaScript-style selection, because NaN propagation is not
guaranteed on every driver (a shader compiler can assume under fast-math that
operands are never NaN, which is why the shader targets omit the `isAbsent`
capability). Interval-JavaScript lowers `If` to its own `_IA.piecewise` helper.
`When` keeps the truthiness test on every target, because it is not a two-branch
selection.

### CE-264. Clause sets that dispatch on `infinity`, `nan` or `non_finite_number` do not compile

**Status:** design needed; capability.

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

### CE-265. A re-declared operator with a caller `compile` handler switches off call sharing

**Status:** on demand; design. Tycho item 217.

`R(i,x,y) = R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` compiles to a linear artifact on
a stock engine (the CSE harvest binds the repeated self-call: 0.03 ms/call at
depth 18). It becomes exponential (×4 per two levels, 39 ms/call at depth 18)
only after `engine.declare("Which", {...stock})` followed by
`operator.compile = …` on the new definition. A handler attached IN PLACE to the
stock `Which` definition, or a re-declaration WITHOUT a handler, stays linear.
Tycho's shipped install attaches in place and is flat.

Cause: `Harvester.hasCallerCompileHandler` (`compilation/cse.ts`). A `compile`
handler on a definition that is not the system-scope one is a live-source splice
that the harvest cannot analyse. So every node under that head is refused as a
CSE candidate, and every callee body that contains it fails `calleeBodyClean`.
It is admitted only for the NaN-skippability question, where the declared `pure`
of the definition is trusted. An explicit `pure: true` on the re-declaration
does NOT restore sharing (measured). The handler of the built-in definition is
exempt by object identity.

Option, if a consumer needs the re-declaration: the lazy-operand region table
(`LAZY_OPERANDS`) is keyed by operator NAME, so a re-declared `Which` still
opens the right regions at harvest. A caller handler that DECLINES at emission
(returns `undefined`, Tycho's case) then emits through the built-in lowering,
which pushes those regions. The refusal could be narrowed to "a caller handler
that EMITS". This is unknown at harvest time, so it needs a declaration on the
handler (or a contract of `pure` plus "lazy operands as the built-in").

### CE-266. Cross-term CSE could partition a region by index-dependence

**Status:** on demand; design.

A `Sum`/`Product` with compile-time-constant bounds and at most 100 terms
unrolls into a flat operator chain (`UNROLL_LIMIT`,
`compilation/javascript-target.ts`). The unroll opens a FRESH CSE region per
term: the same body nodes are compiled once per index value, so a reuse keyed by
node across terms would emit term 1's temporary for every later term (silent
wrong values). Hoisting an index-independent subexpression out of the terms is a
separate, narrow mechanism. Today it covers COLLECTION-valued subexpressions
only (`hoistLoopInvariants`, controlled by the CSE admissibility predicate;
pinned by `test/compute-engine/compile-sum-unroll-guards.test.ts`).

Nothing is known to be wrong. If more hoist sites of this kind appear, the
general fix is to partition a region's candidate set by index-dependence in
`compilation/cse.ts`, not to add more local hoists. Wait for a second case.

### CE-267. A stored symbol value does not compile where a binder rebinds one of its names

**Status:** open; capability.

A stored symbol value keeps the binding it was written against. The JavaScript
and `interval-js` targets emit the value as a preamble local outside every
emitted function (`bindsFoldedValue`, `base-compiler.ts`). Two shapes have no
such place. Both fail closed (D6), name the symbol and the shadowing name, and
the public route answers through the interpreter. The answer is not wrong; the
capability is missing. Both shapes are pinned in
`compile-fold-shared-values.test.ts`.

- **CE-267.1** A compiled top-level lambda holds its preamble INSIDE the lambda
  body (`userFunctions.valueRoot`), because a compiled lambda takes only its
  declared parameters, so a free symbol has no supply channel.
  `compile((n) ↦ Σ_{n=1}^{3} a)` with `a := n + 1` declines; the interpreter
  answers `3n + 3`. Fix: a lowering that puts the preamble at the ROOT and gives
  the lambda a channel for the value's free names.
- **CE-267.2** The shader targets (`glsl`, `wgsl`) declare statically typed
  functions and have no place for an untyped value binding, so they fold inline.
  `compile(g(2), { to: 'glsl' })` with `a := 3t + 1` and `g := t ↦ t + a`
  declines (it used to emit `_fn_g(float t) { return (3.0 * t + 1.0) + t; }` and
  read the parameter). A shader `Sum` whose body folds a value that names the
  index declines for the same reason. Fix: pass the value as a uniform, or
  alpha-rename the emitted parameter. A Desmos-style kernel where
  `d_00 := p(x, y) · S` is read inside `c_2(x, y)` declines on the shader
  targets for this reason.

### CE-268. JavaScript declines scalar arithmetic over a list-valued operand: open corpus rows

**Status:** open; capability.

A CORE-corpus audit (2026-09-14) found 52 `javascript` records that fail closed
with "cannot compile scalar arithmetic over a list-valued operand" (and one
`Abs` variant). These are not defects, because the interpreter also gives no
value: invalid input (`2ki2hjsouf`, 10 records, and `ifnnzttcqg`, 1, box with an
`Error(incompatible-type)` node; `6kalzeiedk`, 1, references an undefined
operator `B`); a point summed with a scalar (`urbddymicb`, 8,
`(x − C_x)² + (y − C_y)² + (−R_2, −o_ut)`, where the interpreter answers
`Error(incompatible-type, "tuple", "number")`); and `iqnkdz3ptt` (2), a point
plus a number list (`(⌊…⌋, …) + [0, 1]`), which the interpreter answers as an
`incompatible-type` error per element.

- A point summed with a symbol declared
  `indexed_collection<number | tuple<…>> | list<tuple<…>> | tuple<…>` fails
  closed, because that type admits a flat list of numbers, which at run time has
  the same shape as a point (`runtimePointShapeIsUnambiguous`). User decision
  2026-10-17: the compiler does not change; the declaration must be
  `list<tuple<…>> | tuple<…>`. Tycho has declared its point results that way
  since 2026-09-14 (`POINT_RETURN_2D` in Tycho's `document-ce-manager.ts`).
- **CE-268.2** `Power` over a point, a list or a list of points is element-wise
  in the same way (`(3,4)² = (9,16)`, `[3,4]² = [9,16]`, a list of points →
  `[(9,16),(25,36)]`), so the point-or-list ambiguity does not change its
  answer. A union-typed SYMBOL operand already compiles for `Power`, so the
  corpus rows decline in a call structure that is not reproduced yet:
  `hpr2q4kles` (9 records, `P(U(x, y), …)`), `hbvzf9yk1r` (1), and the `Power`
  records of `jgcclk1njk`. Reproduce one of these rows and find the decline
  before you widen the `Power` broadcast admission.
- **CE-268.3** A point whose own coordinate is a list: in `u1bpof8xfg` the
  Multiply compiles, but the enclosing `Add` fails closed, because the point
  `(−cos t, sin t · sgn R)` has a list second coordinate (`sgn R` over a list).
  This is the open point-with-a-list-coordinate shape (decision A,
  `COMPILATION-MODEL.md`).
- **CE-268.4** The "color family" is not a separate color-broadcast gap:
  `AsOklab` over a `list<color>` compiles to `_SYS.bcastColor`. These records
  come from point-list arithmetic in documents with many colors. For
  `s8ishknvhe`, see CE-249. `woeywky0kj` builds an RGB triple in a `list<color>`
  context; the failing operand is not pinned (the isolated row compiles), and a
  clean audit run must capture it.

### CE-269. A DAG-shared symbol value above the fold-size guard does not compile

**Status:** open; capability, low priority.

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

### CE-270. Compile declines in the code-generation census of CE 0.128.13

**Status:** open; capability. Plan:
docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md (§9).

Declines per target on the all-states Tycho corpus (684 documents, measured
2026-09-16): javascript 112 in 38 documents, glsl 148 in 55, interval-js 188
in 66. Open candidates:

- **CE-270.1** JavaScript scalar arithmetic over a list-valued operand, 33 rows
  (CE-268).
- **CE-270.2** GLSL `At` over a collection indexed at run time, 32 rows.
- **CE-270.3** GLSL `Integrate`, 15 rows.
- **CE-270.4** The remaining interval `List` rows (CE-240).
- **CE-270.5** Measure a new all-states baseline on the current release.

`D`, `PointList` and the complex rows on the interval target are design limits,
not candidates.

### CE-271. Collection values on the interval target: three cases that remain

**Status:** on demand; capability. Plan:
docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md.

The interval target maps scalar kernels over provable lists of numbers, carries
arrays across user-function boundaries, builds a range at run time and reduces
over it. Three cases are not done:

- **CE-271.1** A reduction over a bound that is not constant over the cell
  answers `entire`. The indexed `Sum`/`Product` loop (a bound whose endpoints
  floor to different integers) and the run-time range (`_IA.range`, a bound that
  is not a point interval) both give up. The sound refinement is the hull over
  the integer bound pairs: for `Σ_{k=a}^{b} f(k)` with `a ∈ A`, `b ∈ B`, the
  union of the sums over every `(⌊a'⌋, ⌊b'⌋)` pair, computed from prefix sums
  under a pair budget. A plotter refines its cells until the bound is constant,
  so `entire` costs plotting time, not soundness. Do it when a corpus document
  shows the cost.
- **CE-271.2** `D` (a derivative) on the interval target has no lowering beyond
  the closed form. `d/dx L(x)` compiles when the derivative of the body has a
  closed form (the shared `compileDerivative`). The census cases lacked one (16
  declines, 8 documents: a body with a sum over a symbolic bound, an integral, a
  piecewise). The JavaScript target's numeric fallback is a finite-difference
  stencil, which does not enclose the derivative over a cell: do not port it.
  The sound route is forward-mode automatic differentiation in interval
  arithmetic, a jet lane over the interval kernels (the interval counterpart of
  `jet-derivative.ts`). Design work; do it on demand.
- **CE-271.3** A relation over a provable list (`L < 1`) keeps the requirement
  of a scalar operand. Its element-wise value is a list of tri-state verdicts,
  which the result contract (`IntervalValue`) does not admit. Tycho compiles the
  UNMASKED body of an implicit member, never the relation, so no corpus row
  needs it.

### CE-272. Element-wise `Which` over fixed-size collections declines on `glsl` and `interval-js`

**Status:** on demand; capability. Tycho item 206.

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

### CE-273. A shared subexpression in a shader lazy operand with no statement position is expanded at each occurrence

**Status:** open; performance.

A boxed expression is a DAG: `Max(e, e)` holds `e` once. The GLSL and WGSL
targets bind such a shared node to a temporary through the common-subexpression
pass wherever a statement position exists. A conditional whose arm repeats a
subexpression takes the statement form (`gpuArmSharesWork` selects it,
`compileGPUStatementSelection` emits it).

- **CE-273.1** A shared subexpression in a lazy operand with NO reachable
  statement position is not bound: the right side of an `&&`/`||`, and a
  conditional nested where hoisting is refused (inside another arm, or an
  expression-only position). The operand's text unfolds the sharing. Neither
  shader language has a scoped let-expression, so the fix is a restructure that
  lifts such an operand to a statement, or the acceptance that a deeply shared
  lazy operand stays inline.
- **CE-273.2** The common-subexpression pass itself runs super-linearly on a
  very deeply shared DAG: a depth-20 shared tower takes tens of seconds to
  compile even with no conditional, with a linear emission. The cost is in the
  harvest, not in the conditional lowering.

### CE-275. Lazy compilation of infinite collections supports only a small set of operators

**Status:** open; capability.

On the JavaScript target, `Take`/`TakeWhile`-bounded infinite pipelines compile
to lazy `_SYS` iterator streams (`emitLazyStream`, `javascript-target.ts`; tests
in `compile-lazy-collections.test.ts`). Sources: `Range` with a literal `±∞`
stop. Transformers: `Map`/`Filter`/`Drop`/`Rest`. Bounders: `Take`/`TakeWhile`.
Everything else declines at compile time with an error that names the bounding
fix. These are extensions, not defects:

- **CE-275.1** More lazy sources: 1-argument `Repeat(v)` (its handler declines
  with "no compiled representation", which is now only true outside a bounding
  consumer) and `Cycle` (no compile handler at all).
- **CE-275.2** More bounding consumers: `First`/`At(k)`/`Find`/`IndexWhere` over
  an infinite stream have finite answers that a lazy scan could give; today they
  decline.
- **CE-275.3** A symbolic step with an infinite stop (`Range(1, ∞, s)`): a step
  that is negative at run time means an EMPTY range, and a stream cannot decide
  that lazily (see `infiniteRangeStep`).
- **CE-275.4** Python target: no lazy lowering. A non-finite `Range` bound
  declines at compile time even under `Take` (a documented difference from the
  JavaScript target).
- `DropWhile` over an infinite source is inert in the interpreter, so it
  deliberately does not compile (parity, not a gap).

### CE-276. A compiled standalone lambda does not check the types of its callback parameters

**Status:** deprioritized; defect. Decision 2026-08-09: the direction is a
check-emission table per primitive, and "cannot be enforced → decline".

`literal.compile()` then `run(violatingValue)` computes a value without an
error, where the interpreter reports an error. Every route inside the engine
enforces the check. See the "Known limit" section of `docs/TYPE-SYSTEM.md`.

### CE-277. A compiled ordering cannot tell an error operand from a numeric `NaN`

**Status:** open; design.

On the JavaScript target the orderings broadcast through `_SYS.bcast`. An error
operand and a numeric `NaN` are both `NaN` at the ABI, and `NaN < 3` is `false`.
That is correct for a numeric `NaN` (IEEE), but the interpreter keeps an error
as an error. The connectives have a guard (`guardConnectiveAbsence`), because
JavaScript coercion gave a wrong truth value there (`!NaN` → `true`). To do
better, the orderings need a distinct absence sentinel carried through nested
broadcasts.

### CE-279. Compile-target coverage: heads and shapes that decline on the JavaScript target

**Status:** open; capability. Ledger: do one sub-item per session.

This ledger, with the GPU and Python ledgers below, lists the heads that have no
lowering on a target. The counts (`members / states`) come from Tycho's
684-document Desmos corpus at CE 0.99.0; CE-270 has the current counts. They
show demand from one workload, not importance: a head that is rare there can be
common elsewhere. A compile decline is not only a slow option: the consumer's
JavaScript wrapper installs a `() => NaN` stub, so a row that declines draws
nothing. Treat each item as a correctness gap.

On the JavaScript target, 230 members / 81 states fail. By the consumer's
per-bucket provenance rules, 82 members / 25 states are CE target gaps; the
other 148/61 are the consumer's own unexpanded user-function heads, unparsed
LaTeX and document-defined function heads. Use 82/25.

The interval-js domain is scalar (one interval per quantity), so a
collection-valued condition or operand declines by design beyond the
provable-list lowerings of CE-271. The interpreted-mode evaluation memo (CSE
Phase 3) is not pursued: the interpreted residue is target gaps, not work a memo
can share (`docs/plans/2026-07-28-compile-cse-design.md` §10).

- **CE-279.1** Multi-clause user functions: the §8 guard chain compiles on the
  JavaScript target only. The interval, GLSL/WGSL and Python targets decline the
  whole function (fail closed, interpreted fallback). Interval needs
  interval-aware guards. The shader targets need a monomorphized (per-call-site
  arity) lowering because they have no variadic dispatch. No corpus sizing yet.
- Generic user functions: a quantified parameter is read at its DECLARED BOUND
  (`test/compute-engine/compile-generic-monomorphization.test.ts`).
  Per-call-site monomorphization was rejected: it would bring back the
  `$`-suffixed specializations retired 2026-08-16 and has no call site on the
  value-position route. These cases still decline the whole function, with a
  sound interpreted fallback:
  - **CE-279.2** A variable with NO ground bound: `(x: T) -> T where T` names no
    type to compile against, so `gd(y)` emits no `_fn_gd`, and the fallback
    runner answers `42` for `y = 21` and `[2,4,6]` for `y = [1,2,3]`.
  - **CE-279.3** Every target other than JavaScript. The coercion and the
    `_SYS.bcastFn` broadcast are JavaScript conventions, and the shader targets
    synthesize a static signature that this reading was never validated against.
  - **CE-279.4** A declared `broadcastable<T>` parameter over a
    possibly-collection argument (fails closed).
  - **CE-279.5** A body whose bound does not prove the capability it needs, such
    as an indexed read under a `collection<number>` bound.
- **CE-279.6** A bare-function, assign-inferred point function compiled with a
  LIST argument reads it as ONE point. With `f(v) = PointList(…)` declared as a
  bare `function` and its signature inferred at assign time,
  `compile(f(P), {to: 'javascript'})` succeeds, and the emitted `_fn_f(v)` reads
  its argument as a single point (`v[0]`/`v[1]`). A list-of-points argument then
  throws `RangeError: PointList: source component 1 is not an array` at run
  time. The error is loud, but it diverges from the interpreter. It is a sibling
  of the D-232 lambda auto-broadcast residual. Design constraint for the runtime
  broadcast-dispatch guard: `Array.isArray` cannot tell a list to broadcast over
  from a point that IS the argument, so the guard must key on the parameter's
  DECLARED scalar type, never on the runtime shape alone. Repro: tycho
  `scripts/repros/d15-eval-cost-probe.mts`.
- **CE-279.7** The arithmetic OPERAND boundary has the statically-scalar but
  actually-array hole that the call boundary had. The runtime broadcast-dispatch
  guard fixes the call: `f(y)` with `run({y: [1,2,3]})` broadcasts. But
  `f(y + z)` with `run({y: [1,2,3], z: 0})` emits `(_.y + _.z)`, JavaScript
  concatenates the array to the string `"1,2,30"`, `Array.isArray` on the result
  is false, and the direct branch of the guarded call answers `NaN`. The fix is
  the same declared-scalar-type-keyed treatment at scalar-infix operand
  boundaries (or a broadcast-aware `+` lowering). It has the same performance
  risk as the infix lowering of `target.operators`, which has no such check;
  design the two together.
- **CE-279.8** Re-examine the `Multiply` ≥2-arrayish carve-out and the
  complex-element deferral. Both were kept verbatim through the broadcast
  rework.
- **CE-279.9** `Power`/`Root` compile to `NaN` where the interpreter returns a
  complex value. This follows the `finite_number` policy and is not a defect,
  but it is the surprise that the `realOnly` retirement removed for `Sqrt`. The
  fix is to make those type handlers track the negative-base /
  fractional-exponent case, which then lets the emitter fold them complex.
- **CE-279.10** Audit the other compile-time refusals for consistency. The
  retired `realOnly` constant-fold refusal (now `Sqrt(-N)` folds to the complex
  value, or to `NaN` under `realOnly`, on every target) was an instance of a
  class: a deliberate refusal enforced at some sites but not at sibling sites. A
  rationale comment and a passing test show intent, not consistency. For each
  refusal, reach the same mathematical situation another way (a variable, an
  assigned symbol, another head of the same family, another target) and check
  that it is refused there too.
- Needs a witness from the consumer before any work (the compiled meaning is not
  clear):
  - **CE-279.11** `Set` (3/4), `Polygon` (3/16), `Sphere` (1/1),
    `GeometricVector` (1/3). What must `compile(Polygon(…))` return at run time?
    If the real need is membership (`x ∈ S`), the fix is different and much
    smaller.
  - **CE-279.12** `Subscript` (1/1): the probe COMPILES. `['Subscript','a','k']`
    canonicalizes to the fused symbol `a_k` → `_.a_k`. The consumer's bucket is
    outdated, or it is a shape where the fusion does not happen (see the G5 note
    in CE-68, where a binder-bound index cuts the binding).
  - **CE-279.13** `Loop: Element index must be a symbol` (1/1): reproduced only
    when `Loop` gets a malformed index (a literal where a symbol belongs), so CE
    correctly rejects bad input. Probably the consumer's expansion emits a
    malformed `Loop`.

### CE-280. Compile-target coverage: heads and shapes that decline on GLSL and WGSL

**Status:** open; capability. Ledger: do one sub-item per session.

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

### CE-283. Compiled recursive lambdas on GPU targets

**Status:** on demand; capability, medium.

Compiled recursive lambdas use lenient true recursion. Termination is the
caller's responsibility: runaway recursion throws a catchable `RangeError`.
Complex-valued recursion needs a `Typed` `complex` return ascription (untyped
applications type `broadcastable<number>` and reach the complex-broadcast
deferral).

- **CE-283.1** WGSL and GLSL cannot recurse, so the GPU targets stay
  fail-closed. The route is literal-depth unrolling: the v1 memoized
  literal-argument specialization design, kept in the git history of the design
  doc. Do it when a GPU consumer asks.

### CE-284. GLSL loops and helper injection in a custom compile handler

**Status:** open; capability.

- **CE-284.1** `TODO(E3-GLSL)` in `base-compiler.ts`: it needs loop unrolling or
  fixed-size arrays.
- **CE-284.2** The public per-operator `compile` handler has no hook to inject a
  preamble or helpers, so custom loops on GLSL/WGSL are hard to write. Extend
  `OperatorCompileContext` when a real need appears.

### CE-285. List-valued big-operator bodies on the non-JavaScript targets

**Status:** open; defect, low priority. Tycho row 171.

A body with positive collection evidence declines on every non-JavaScript target
with an actionable message (`assertScalarBigOpBody`, `base-compiler.ts`; pins in
`list-valued-summand-compile.test.ts`).

- **CE-285.2** The side effect of the JavaScript comparison test (`a(h(i)) < y`)
  has no dedicated pin.

### CE-286. GPU `LerchPhi` and `PolyLog` answer NaN where the terms cancel in f32

**Status:** open; capability. Issue #340.

The shader targets (`GPU_LERCH_PREAMBLE_GLSL`/`_WGSL`,
`compilation/gpu-target.ts`) compute `LerchPhi(z, s, a)` and `PolyLog(s, z)` for
real operands past the unit disk. The methods: a positive integral for `s > 0`;
the Hermite form with a complex incomplete gamma for `s ≤ 0`; a rational form
for an integer `s` from 0 to −16; the inversion formula for a negative
non-integer order of `PolyLog`; and, after every other method, the sum over the
Fourier modes of the base point `_gpu_lerch_modes` for `z < 0` and
`−30 ≤ s ≤ −3`. Where they answer, they are within 1.5e−5 of the reference
(worst 1.38e−5 on 4193 + 900 points, measured on an Apple M5 Max GPU through
headless Chromium, GLSL and WGSL). Each method declines (NaN) when its own error
estimate exceeds 3e−5 of the value.

What still answers NaN:

- **CE-286.1** Values small against the modes:
  `Φ(−0.8818, −13.863, 1.7443) = −35.664`, `Li_{−11.65}(−22837.6) = −9.73e−6`.
- **CE-286.2** `−3 < s < 0` below `z = −1`:
  `Φ(−381112, −2.5, 0.33116) = −7.403e−6`.
- **CE-286.3** `z > 1` with an integer `s`: `Φ(1.617, −6, 5.7837) = −16191.1`.
- **CE-286.4** Values about 1e37 next to `z = 1` (f32 overflow).
- **CE-286.5** `z < −1` with `a < 0` and an integer `s > 0`
  (`Φ(−5.76, 12, −8.464)`): the shifted terms cancel.
- **CE-286.6** Values below the smallest normal f32, which the GPU flushes to
  zero. A `LerchPhi` true value below 1.18e−38 still returns 0 or a wrong
  subnormal through the core methods.

Far below `z = −1`, the mode sum and Jonquière's inversion decline unless the
value is a finite normal f32. Their 3e−5 test is written `err ≤ 500·|value|`,
because the form `ε·err ≤ 3e−5·|value|` flushed both sides to 0 below about
4e−34 and accepted 0 and ∞. Over `z` in [−1e38, −1] and `s` in [−30, −3] on the
M5 Max, 16 of 3485 `PolyLog` values and 17 of 960 `LerchPhi` values are more
than 1.5e−5 off (15 of them with a true value below the smallest normal f32).

- **CE-286.7** The 3e−5 estimate test admits values up to 2.04e−5 off on this
  GPU (the inversion at `s < −20`, `|z| > 1e20`, and the modes), where the older
  domains state 1.5e−5. A tighter test would decline more values. The doc
  comment states 2.1e−5 for that region.
- **CE-286.8** In an f32 model whose `log2` is 2.5 ulp off, the error estimates
  (built for about 1 ulp) do not cover the far domain (worst 1.24e−4).

Cost: a call takes at most about 1100 loop iterations below `z = −1`, plus up to
128 modes and 100 shift terms for the mode sum, and about 4700 next to `z = 1`
with `s < 0` (the 4096-term series first). The f32 model of the shader text is
`test/compute-engine/gpu-lerch-f32-model.ts`; keep it in step with the text.

### CE-287. GLSL on ANGLE Metal: arithmetic with a constant infinity reads back 0

**Status:** open; defect.

On the Apple M5 Max through headless Chromium's WebGL2 (ANGLE over Metal),
`z + _gpu_inf()` reads back `0.0`. Returning `_gpu_inf()` directly, negating it,
`min`/`max` and comparisons are correct. Every constant spelling of the infinity
was tried (a bit pattern, a global, a loop, `exp(1000)`). Only a bit pattern
computed from a run-time input works, so no helper can fix it; a uniform would.
WGSL is correct.

Both targets spell non-finite constants through `_gpu_nan()`/`_gpu_inf()`, and
the WGSL versions bitcast a `let`: a constant `bitcast<f32>` to NaN or infinity
is a shader-creation error in Chrome ("value inf cannot be represented as
'f32'").

### CE-288. The f32 shader Hurwitz zeta answers NaN next to a zero of ζ(s, a)

**Status:** open; capability, small.

Where the Euler–Maclaurin terms cancel, `_gpu_hurwitz_zeta`
(`GPU_ZETA_PREAMBLE_GLSL`/`_WGSL`, `compilation/gpu-target.ts`) takes ζ(s, b) at
a base point `b` in (0, 1]: Hurwitz's Fourier formula for `s ≤ −3`, Hermite's
integral for `−3 < s < 1`, and `b^(−s) + ζ(s, 1 + b)` from the Taylor series for
`b < 2^−10`. It answers NaN when its error estimate exceeds 3e−5 of the value.
On 18 361 points (`s` from −24.5 to 12, `a` from 0.01 to 30) every value is
within 8.1e−6 on an Apple M5 Max GPU, and 432 are NaN. 387 of them are points
where a half-ulp change of `s` or `a` moves the value by more than 1e−5.

- **CE-288.1** The other 45 NaN values have `−3 < s < 0` next to a zero where
  Hermite's closed terms and integral cancel, for example
  `ζ(−2, 0.4666789…) = −0.0027644` and `ζ(−2.99, 0.8854986…) = 0.0058845`
  (mpmath at the f32 operands). An error estimate on the Taylor series in
  `a − round(a)` recovers 11 of them. The double kernel's exact Bernoulli value
  plus a correction was not ported.
- **CE-288.2** In an f32 model whose `log2` is 2.5 ulp off, 17 values with
  `a > 16` and `s < −21` are up to 1.7e−5 off.

The Apple GPU compiler reassociates `s + (2b − 1)` into `(s + 2b) − 1` (6.7%
error at `ζ(−1e−6, 1/2)`). The shader text guards it with `max(2b − 1, −1)`, and
a test pins the guard; keep the guard.

### CE-289. Compile captured held functions whose ambient binding differs

**Status:** on demand; capability.

The interpreter resolves the captured binding of a callable: direct calls,
eager, lazy and async callbacks, function-valued variables and operator
callbacks. The compiler is conservative: a captured held function with a
different ambient binding refuses compilation. Remove each refusal only when
that lowering preserves binding identity and has interpreter/compiler parity
tests.

### CE-290. Compile `Tabulate`, `Scan` and `Iterate` that can omit elements (Nothing)

**Status:** on demand; capability.

`Tabulate`/`Table`, `Scan` and `Iterate` keep a possible Nothing in their
element types, and a two-dimensional `Tabulate` returns lazy rows. Compiler
guards refuse a `Tabulate` or `Scan` that can omit elements until the targets
have a distinct representation for an omitted element. `Iterate` is not
supported by the compiler. Custom accumulator delivery policies are unchanged.

## LaTeX parsing and serialization

### CE-471. A float plus a fraction is written as a mixed number

**Status:** open; wrong value, small.

`["Add", {"num": "2.0"}, ["Rational", 1, 3]]` is written `2.0\frac{1}{3}`, the
mixed-number form. The parser reads it back as `["Multiply", 2.0, 1/3]`, so a
round trip changes the value from 2.333… to 0.666…. With `2.5` the output is
`\frac{1}{3}+2.5`, which is correct. The mixed-number form must be used only
when the integer part is an exact integer literal.

### CE-441. The LaTeX of a rest parameter or a destructuring parameter does not read back as that parameter

**Status:** design needed; defect.

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

Options: (a) write the destructuring parameter with a second pair of
parentheses, `((x,y))\mapsto xy`, the Epsil spelling, and teach the parser to
read it as one pattern parameter; write a rest parameter `x\ldots\mapsto` or
`\ldots x\mapsto` and read it back; (b) write these literals as
`\mathrm{Function}(…)` with their MathJSON operands, which the parser already
reads. Without a decision the LaTeX of such a literal stays lossy.

### CE-291. `\int dx` is a parse error, and the `d` of `\int \frac{dx}{x}` is reported undeclared

**Status:** open; defect. `\int dx` parses to `Integrate(1, x)`, and a `d` is
pruned from the report of free symbols only where the integration variable
follows it directly (`dx`), so a free variable named `d` is still reported.

- **CE-291.2** With `diagnostics: true`, the `d` of a differential inside a
  fraction (`\int \frac{dx}{x}`) is reported as an undeclared symbol `d`. The
  pruning of the dummy variable does not know the `d` token. Pruning every `d`
  in the span of the integrand would hide a real free variable named `d`.

The parser is `parseIntegral()` in
`latex-syntax/dictionary/definitions-calculus.ts`.

### CE-293. A product with a reciprocal round-trips through LaTeX as a different expression

**Status:** open; defect, small. Same cause as CE-113.

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

### CE-295. Some symbol names with subscripts or styles do not round-trip through LaTeX

**Status:** open; defect, small.

- **CE-295.1** A symbol with two subscripts whose base is an indexed collection.
  With `A` declared as a matrix, the symbol `A_1_2` is written `{A_1}_2`, which
  reads back as `Subscript(At(A, 1), 2)`; the older spelling `A_{1,2}` read back
  as `At(A, 1, 2)`. With `M_1` declared as a list, `{M_1}_2` reads back as
  `At(M_1, 2)`. The parser reads a subscript of a collection as an index unless
  the joined name is declared (`absorbSubscripts()` in
  `latex-syntax/parse-symbol.ts`), and a single subscript has the same problem
  (`A_1`). The current output is pinned in
  `test/compute-engine/latex-syntax/double-subscript-symbol.test.ts`.
- **CE-295.2** A name with the upright style after its first part, when the
  parser drops that style. The parser keeps `\mathrm{}` only around a
  one-character body, and it spells out a styled digit (`x_{\mathrm{1}}` is
  `x_one`). So no spelling reads back as `x_1_upright` or `x__a_1_upright` (they
  are written `x_1` and `\operatorname{x^{a}_1}`, the nearest names) or as
  `speed_upright_1` (it is written `\mathrm{speed}_1`, which reads back as
  `speed_1`). Also, no spelling reads back as a name with a unicode escape right
  after a styled digit part, such as `x_1_bold____002012`: the parser reads no
  text after a style command in a name. The parser never produces these names;
  they come from MathJSON.

### CE-296. `\iint f\,dx\,dy` parses its `Limits` in the order opposite to the evaluation

**Status:** open; defect. User decision 2026-10-01: keep "first = outer", as
Mathematica does; change the parser so that `\iint f\,dx\,dy` gives
`Limits(y), Limits(x)`, and correct the reference.

`Integrate(f, Limits(x, …), Limits(y, …))` is evaluated with the FIRST `Limits`
as the OUTERMOST integral: the `evaluate()` loop integrates the last `Limits`
first, and `nIntegrateMultiple` (`library/calculus.ts`) lets the bounds of limit
`i` depend on the variables of limits `0…i−1`. Two tests in
`test/compute-engine/calculus.test.ts` ("dependent inner bound: triangle", "a
bound referencing an INNER integration variable declines") lock this in. `Sum`
and `Product` document the same order (`doc/82-reference-collections.md`: "the
first spec being the outermost").

With constant bounds the order does not change the value. With a dependent bound
it does: `Integrate(x·y, Limits(x, 0, 2y), Limits(y, 0, 1))` evaluates to `y²`
(the `y` in the bound of `x` is a free `y`), not to
`∫₀¹ ∫₀^{2y} x·y dx dy = 1/2`. A bounded iterated integral on the parse route is
a nested `Integrate`, which is not affected.

- **CE-296.1** Change the parser: it reads `\iint f\,dx\,dy` as
  `Limits(x), Limits(y)`, with the innermost variable (`dx`) first.
- **CE-296.2** Correct the double-integral example of
  `doc/81-reference-calculus.md`: it lists `Tuple(x, 0, 2)` (the inner integral
  of `\int_1^3\int_0^2 … dx dy`) first.

### CE-297. The lenient grammar makes reading choices that a host cannot detect

**Status:** in progress; capability. User decision 2026-10-01: a parenthesized
name is never a function head, and lenient `+-` is `±`. Plan:
`docs/plans/2026-10-01-lenient-ambiguity-codes.md`.

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

### CE-298. The lenient line-level ambiguity checks read the raw tree before `resolveApplications()` regroups it

**Status:** open; defect, small.

`reportLineAmbiguities` (`latex-syntax/lenient-ambiguity.ts`) runs in `parse()`
on the raw result. It already sees the tree after
`normalizeContinuationRanges()` (the range-precedence repair). It does not see
the tree after `resolveApplications()`. Check whether that step regroups a shape
that a line check matches (`NotEqual`, `Less`, `Equal`, `Element`, `Range`,
`Delimiter`, `InvisibleOperator` lists with `Sqrt`, `Factorial`/`Power`). Either
prove that no checked shape moves, or run the checks after that step and keep
the `onAmbiguity` span map valid.

### CE-299. A number followed by a bracket is read as an index, an Iverson bracket or an interval

**Status:** open; defect, small.

Each case gives a visible error, not a wrong value:

- **CE-299.1** `x4[1,2]`: the left side is already the product `x·4`.
- **CE-299.2** `2^3[1,2]` and `\sin 4[1,2]` are read as an index (`At(…)`), then
  give a type error.
- **CE-299.3** `4[x=0]` is an Iverson bracket, so there is no product reading.
- **CE-299.4** `4]1,2[` canonicalizes to `Tuple(4, Interval(…))`, which is
  probably not what an author means.

### CE-301. Very deeply nested parentheses overflow the stack in the parser and on a raw tree

**Status:** open; defect.

A chain of `Delimiter` wrappers boxes to its operand at any depth
(`canonicalDelimiter`, `library/core.ts`; `boxing-deep-trees.test.ts`), and
`containsForeignEngineObject` (`boxed-expression/type-guards.ts`) uses an
explicit stack. Two cases remain:

- **CE-301.1** The recursive descent of the LaTeX parser
  (`parseEnclosure → parsePrimary → parseExpression`) throws at about 1,870
  nesting levels. Realistic input does not reach it; the fix is a parser change.
- **CE-301.2** `.toString()` and `.evaluate()` on a NON-canonical `Delimiter`
  chain 5,000 or more levels deep overflow. The canonical route does not produce
  such a chain; a raw-boxed chain that is serialized before canonicalization
  does.

### CE-302. The LaTeX parser cannot stop at a deadline

**Status:** deprioritized; capability. User decision 2026-08-19: unlikely to be
scheduled, because the inputs that need it are self-inflicted.

The megabyte-scale parses seen in the field come from a consumer that converts
expressions back to LaTeX and parses the result again: LaTeX used as an internal
interchange format. The supported answer is to keep expressions boxed and give
the engine structure directly (raw MathJSON through `ce.box`, or Epsil source;
both routes obey a deadline since 0.111.0/0.116.0). Do this item only if a
workload that is not self-inflicted appears.

**What is wrong.** Canonicalization obeys a deadline; the raw parse does not,
and it grows faster than linearly. Medians of 3, fresh engine per run,
`form: 'raw'` to isolate the parser:

    N        raw parse   canonicalization   raw : canon
    3 000     71 ms          45 ms            1.6 : 1
    6 000    209 ms          49 ms            4.3 : 1
    12 000   719 ms         111 ms            6.5 : 1

The parser grows about 3× per doubling; canonicalization is close to linear.
`form: 'raw'` is not a workaround: it skips the half that already obeys the
deadline. A raw parse under a 1 ms budget and under a 50 ms budget both ran
about 560 ms.

The danger is that a tighter budget has no effect: the parse runs to completion
and only then sees the cancellation. Measured on a 12 000-term sum:

    CANONICALIZE   budget  1 ms → elapsed  17 ms   (17x)
    CANONICALIZE   budget 50 ms → elapsed  51 ms   (1.02x)
    PARSE          budget  1 ms → elapsed 832 ms   (832x)
    PARSE          budget 50 ms → elapsed 795 ms   (16x)

An operator who lowers a budget to bound a risk gets no error and no effect.

**Field data.** The consumer (Tycho) passes `form: 'raw'` at its three most used
parse sites: the Desmos import session (no deadline), the action-firing route
(50 ms budget, one parse per step) and formula classification (5 000 ms budget).
At those sites 100% of the cost is in the parser. On 6 679 imported Desmos
formula slots across 585 states: 0.232 ms/slot raw, 0.380 ms/slot canonical,
worst slot 71 ms (a 69 KB list literal), and the worst slot under a 50 ms span
took 53.9 ms (1.08×). These slots are wide flat LIST LITERALS, not deep operator
chains. Do not quote these numbers as proof that the parse is not a problem: for
deep chains the synthetic curve above applies. The action-firing span is
interactive (a user waits on it); the other spans are background or batch work.
A fix there changes behavior that a user sees.

**Why it is not the canonicalization fix.** Nothing under `latex-syntax/`
references `ComputeEngine`, `_deadlineFrame` or `_timeRemaining`. This is
deliberate: `LatexSyntax` is an injected, structurally typed dependency
(`ILatexSyntax`), as `CLAUDE.md` and `ARCHITECTURE.md` describe. So the parser
has no deadline to read.

- **CE-302.1** Fix when picked up: give the parser an optional cancellation
  callback, supplied at construction or per parse, checked at a stride in
  `parseExpression` (`latex-syntax/parse.ts`), the recursive point of the parse
  walk. Keep it engine-agnostic so that the boundary stays structural. It is an
  interface change to a decoupled subsystem: do not land it in the same pass as
  a release.

### CE-303. MathNet and MATH corpus: remaining parse failures

**Status:** open; capability, small. The MathNet corpus is at 371/428 in CI.

The Hendrycks MATH genre sweep (report: `docs/mathnet/math-genre-sweep.md`,
tagged failures: `math-genre-failures.json`) is at 97.66% clean (371 of 735
failures fixed). Remaining, by rank:

- **CE-303.1** Styling remnants (11, mostly array environments and prose; low
  value).
- **CE-303.2** Units: `yd`/`qt`/`pt` and currency (`USD`, `cents`, `euro`) have
  no `unit-data.ts` symbols. Adding them is a units-subsystem decision, not
  parser work.
- **CE-303.3** `\cancel` inside `array`-environment `@{}`/`\cline` layouts.
- **CE-303.4** Possible upgrades of `IndexedSequence` (lazy-collection
  semantics, the parenthesized `(a_n)_{n\in\mathbb{N}}` form).
- **CE-303.5** ASCII-pipe divisibility (`p|a+1`) is deferred because it
  conflicts with absolute-value syntax. The parenthesized form
  `(a+f(b)) | (a^2+bf(a))` is not ambiguous and could be supported. The sweep
  found 36 more hits.
- **CE-303.6** Richer `array`/`cases` environment variants.
- Out of scope or skipped: set arithmetic (`\{0,1\}+\{1,4\}\equiv…`,
  `2\mathbb{Z}+1`), `array`-environment long-division layouts, `\nabla` puzzle
  operators, repeating decimals `0.abab\overline{ab}`, and prose-heavy or
  fragment-boundary inputs that need natural-language context.

### CE-304. Loose parsing: `5 nPr 2` notation, `_a` wildcards in arrow-string rules, locale separators

**Status:** open; capability, low priority.

- **CE-304.1** Infix calculator notation `5 nPr 2` is not supported. It needs a
  new-notation design, not a map entry.
- **CE-304.2** Explicit `_a` wildcards in arrow-string rules do nothing and give
  no message. They are redundant there, because auto-wildcarding covers them.
- **CE-304.3** Locale separators (documentation and display).
- Not a defect: `sqrt2x` → `√(2x)` is a deliberate policy, consistent with the
  bare-function convention `cos 2x` → `Cos(2x)`.

### CE-305. LaTeX parser cases marked `@fixme` in the tests

**Status:** open; defect. Each item has a `@fixme` or skipped test in the named
file.

- **CE-305.1** Pre-subscripts and pre-superscripts (`_p^qx`), and `\vec{AB}`
  over a multi-letter argument (`supsub.test.ts`).
- **CE-305.4** Partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips, `operators.test.ts`).
- **CE-305.6** (decision needed) `p \operatorname{implies} q` and
  `p \operatorname{iff} q` parse to `Tuple(p, implies, q)` and
  `Tuple(p, iff, q)` (`logic.test.ts`, two `@fixme` markers). `\keyword{iff}`
  gives `Equivalent`, but the `iff` keyword has no `operatorname: true` flag,
  and no `implies` keyword exists. Question: are `\operatorname{iff}` and
  `implies` keyword spellings? That adds notation. The lowercase-arrow
  expectations themselves are current (`\rightarrow` gives `To`).

## Epsil

### CE-306. `list<list<string>>` and `list<list<integer>>` cannot both conform to a protocol

**Status:** open; design. User decision 2026-10-23: a value whose only shared
elements are empty lists counts like the empty list: both conformances are
accepted, and a call on such a value (`[[]]`) is ambiguous at dispatch, as a
call on `[]` is.

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

### CE-309. A list literal of comprehensions with a statement body shows unevaluated `Comprehension` elements

**Status:** decision needed; defect, small.

- **CE-309.3** `let xs = [if k > 1 { k } else { 0 } for k in 1..3]; xs` and
  `[do { k * 2 } for k in 1..3]` show unevaluated `Comprehension(…)` elements,
  with or without an assignment local in the body, while `[k * 2 for k in 1..3]`
  materializes to a `List`. Cause: `Comprehension` is a lazy indexed collection
  with no `evaluate` handler. Decision needed: should an Epsil result
  materialize a lazy comprehension?

### CE-310. An Epsil function redefined in a later program cannot change its result type

**Status:** open; design. User decision 2026-10-23: a redefinition replaces the
whole contract, the result type included, as it does for the effects; code that
used the old result type is checked again where it is next evaluated.

A redefinition across programs replaces its effects (a later
`function g(x: integer) random -> integer { 7 }` replaces an earlier `pure`
contract). But after `function g(x: integer) -> integer { x }`, a later program
with `function g(x: integer) -> string { … }` is refused with
`incompatible-type`. Is that intended (the result type of a name is fixed once
declared), or should the result type be replaced as the effects are?

### CE-311. Make cross-program redefinition an error on the Epsil route and delete the old mechanism

**Status:** open; task. User decision 2026-08-18. Plan:
`docs/plans/2026-08-18-checkpoint-restore-design.md`.

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

### CE-312. Function declaration hoisting: run-time checks, cancellation and route differences

**Status:** open; defect. CE-312.1 and CE-312.2 need a user decision. Plan:
docs/plans/2026-10-21-function-declaration-hoisting.md.

The rules: a call evaluated while its head had no value stays symbolic for the
rest of the top-level evaluation that produced it, and a later evaluation
resolves it again. A `Block` evaluated directly by the host counts each
statement as its own evaluation. The Epsil runner installs a `function`
statement before the first statement when a statement before it can call it and
the installation is safe (four conditions in `prepareFunctionDeclarations`,
`src/epsil/execute-epsil.ts`).

- **CE-312.1** A declared parameter type is not checked at run time when the
  static type of the argument was unknown. With `h` declared
  `(integer) -> integer` and defined `h(k) = 2k`, the host block
  `Block(r := g(h(m)), m := 1.5, r)` nested in a tuple gives `g(3)`: `h(m)` was
  canonicalized while `m` had type `unknown`, so no static check ran, and the
  application of `1.5` to the integer parameter is not checked at run time
  either. `h(1.5)` written directly, and `h(x)` with `x` known to be `real`,
  give `incompatible-type`. Same at `8fc104df4`. Question for the user: should a
  value-definition function with a declared signature check its arguments at run
  time when their static type did not decide (a check per call), or is the
  static check the contract?
- **CE-312.2** A prepared `function` statement stays defined when the program is
  cancelled (time or step budget) before its statement runs. The clause is
  installed in the program scope at preparation; the loop breaks, and a later
  program on the same engine sees the function. The whole-block route has the
  same early install, in the block scope, which goes away with the block.
  Removing the binding is not correct either: the clause may have been
  accumulated onto a function of an earlier program. A later program that
  declares the same name does not re-install the clause that the stopped program
  prepared (the early-clause re-install keeps only the installs of the current
  batch). Documented in the plan; decision wanted.
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

### CE-313. Evaluating a symbolic closed form again after a state change rebuilds its nodes

**Status:** open; performance. Same cause as CE-321; fix with that design.

The value of `D(PointY(h(u)), u)` for Tycho's 29-piece path, a symbolic list,
costs about 18 ms each time it is evaluated again after any assignment. The same
node evaluated again with no change in between is a memo hit (0.1 ms). The memo
for unevaluated nodes is keyed on the `any` axis, and a result node has no
entry. Two fixes were considered and both need a decision: seed the memo of each
result node with itself (this assumes that `evaluate()` is idempotent), or test
whether the rebuilt result equals the node (CE-321 measured that this costs more
than it saves).

### CE-314. Worker threads for parallel numeric kernels: the Epsil route and the API name

**Status:** open; capability. User decision 2026-10-20: the Epsil asynchronous
route waits for Tycho's integration feedback. Tycho's feedback is written
(2026-10-24, Tycho commit `74eea7228`, `~/dev/tycho/docs/COMPUTE_ENGINE.md`,
entry CE-314: `FindFit.evaluateAsync()` on CE 0.164.0 and `broadcastAsync()` on
CE 0.165.0). Its asks (a time limit and event-loop turns on the asynchronous
routes, `inline: false`, `willUsePool()`, `shippable`, and the `route` of a
batch or a fit) are done; CE-430 is what remains of them. Plan:
`docs/plans/2026-10-20-worker-kernel-pool.md`,
`docs/plans/2026-10-20-findfit-global-grid.md`.

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
  `doc/13-guide-compile.md`.
- The name stays `broadcast`/`broadcastAsync` (Tycho's feedback 2026-10-24: "one
  formula, many points"; `runMany` says less).

### CE-430. The canonical form of the data operand of `FindFit.evaluateAsync()` runs in one block

**Status:** on demand; performance, small. User decision 2026-10-25: do not add
the paced canonical form below until a consumer reports a slow abort of a large
fit.

The asynchronous evaluation of a large list gives the event loop a turn about
every 8 ms and honors an abort (`holdMapAsync()`, the `evaluateAsync` handler of
`List`), and written-out data (`_isLiteralData()`) is its own value on the
asynchronous route, as on the synchronous one. The cost was linear in the count
of rows: the 480 ms first measured for 20,000 rows came from machine load and
garbage collection. What remains is the canonical form of the held data operand
(`ops[0].canonical` in `findFitAsync`, `nonlinear-fit.ts`). It is a synchronous
getter and cannot yield: 80 to 220 ms for 20,000 rows at a load average of 40 to
50, about half of the earlier cost. Most of it is the creation of a big-number
value for each float literal (`canonicalNumber`). A fix would make the elements
of a raw `List` canonical in paced chunks inside the parse scope of the list and
check that the result is the same as `.canonical`; this adds a second way for
the data operand of `FindFit` to become canonical. The canonical form of a raw
node is not memoized, so each evaluation of the same `FindFit` expression pays
it again.

### CE-317. An operator with only `evaluateAsync` walks the body at each asynchronous application

**Status:** on demand; performance, small.

With an operator that has only an `evaluateAsync` handler declared, each
application on the asynchronous route walks the body (`hasAsyncOnlyApplication`,
`function-utils.ts`) with no cache. Measured 2026-10-24: the walk is 0.5% of a
depth-60 asynchronous recursion through three helper functions, so no cache was
added. A sound cache key is also hard: the walk follows stored values, and a
value write that is not callable (for example `x` assigned an unevaluated
`AsyncOnly(2)`) does not advance the `callable` axis.

### CE-320. Compiling shared nodes under lazy operands in nested regions is exponential

**Status:** open; performance.

- **CE-320.1** The CSE analysis (`compilation/cse.ts`) walks each distinct node
  once per region. But `e_k = If(c, e_(k-1), e_(k-1))` creates one region per
  chain of lazy arms, so the number of regions grows as `2^k`. This is a
  property of the region model, not of the walk.
- **CE-320.2** The compiler is recursive, so an expression nested deeply enough
  overflows the stack. The failure is safe: `compile()` answers `success: false`
  and runs the interpreter, which gives the right value. User decision
  2026-10-24: raise the limit, do not remove it. The limit was raised on
  2026-10-24: the large cases of `compileExpr` and `_compileInner` moved to
  helper functions (the frame of `compileExpr` went from 1,632 to 328 bytes),
  two callbacks on the path of every operand were removed, and the fold check
  reads `unknowns` from a memo of the compilation. Measured with one compile per
  process: a `Sin`/`Cos` chain compiles up to a depth of 421 (it was 278), and a
  polynomial in Horner form, `a₀ + x(a₁ + x(a₂ + …))`, up to a degree of 208 (it
  was 119); the test is `compile-deep-nesting.test.ts`. Not done, by the same
  decision: removing the limit, by compiling a deep tree from the bottom up with
  a temporary every N levels before the main walk. A CSE binding does not bound
  the depth by itself, because it is compiled at its first occurrence, inside
  the same recursion, so this would be a new mechanism in the region model of
  `cse.ts`.

### CE-321. Each user-function call retires the inert evaluation memo, so a chain of calls copies each level

**Status:** design needed; performance.

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

**Status:** open; performance.

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

**Status:** open; performance.

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

### CE-457. `.N()` of a geometric series with no closed form walks the whole extrapolation budget at machine precision

**Status:** open; performance. Found 2026-10-24 while fixing slowly divergent
series.

With `ce.precision = 'machine'`, `\sum_{k=0}^\infty \frac{2^k}{3^k}` takes about
15 minutes and gives `2.9999999999999987`. At a higher precision the closed form
gives 3, so only machine precision shows it. The Richardson tableau
(`extrapolate`, power 1, `library/utils.ts`) does not converge on a geometric
tail: for the partial sums of `(2/3)^k` it gives 3.2866 with an error estimate
of 0.0067, so the walk goes on to the second acceptance at 2¹⁵ terms, and each
term is an exact bigint ratio. The compiled walk cannot help: `3^k` overflows at
k = 647, and the compiled term 0 sends the walk back to the interpreter.
`Σ k³/(3^k+1)` costs 4 to 12 s for the same reason. A fix needs an acceptance
for a geometric tail (for example, partial sums that are constant over the last
doubling windows), or exact terms that are rounded to doubles earlier.

### CE-329. A compiled loop that assigns `xs = ReplaceAt(xs, i, v)`: the Python target and aliased locals still copy

**Status:** open; performance, small. Issue #386.

On JavaScript, a block local updated with `xs = ReplaceAt(xs, …)` is copied once
and then written in place (`ownedLocalUpdateChains`,
`compilation/in-place-update.ts`; 2026-10-24). Still open: the Python target
keeps the copying form, and the check gives up when the block names the list in
any other way (`ys = xs` before the loop is safe at run time but is refused).

### CE-330. Registering a chain of `-> unknown` functions reads signatures a polynomial number of times

**Status:** open; performance, low priority.

With `W_k` declared `(unknown) -> unknown` and each body calling `W_{k+1}`
twice, registering the chain reads the declared signatures (`_deriveSignature`)
850 times at depth 6, 5 666 at depth 12 and 20 962 at depth 20, about 70 ms at
depth 20 (measured 2026-10-01). Single-call chains are linear. The effects
inference already skips a callee that it walked into the same accumulator
(`expandedLiterals`, `effects-inference.ts`), so the count no longer doubles per
level.

What remains is polynomial: each assignment types its body again, and each read
of a signature whose cache generation has moved reads the type of the function
value before its memo key is built. A cache of the derived signature stamped
with the cache generation, checked before the key is built, gave no measurable
gain at these depths: do not try it again as the fix.

### CE-332. Symbolic differentiation grows super-exponentially with the order

**Status:** open; performance. User decision 2026-09-22: first fix `factor()` on
nested quotients, then measure the snapshot churn of factored derivatives and
decide on that number.

Witness: `f(x) := √(x+√(x+√(x+√(x+x))))`. With `factor()` memoized per engine on
the structural digest (`boxed-expression/factor.ts`), the third derivative does
1,091 factorizations and takes 5.4 s. A factored build (`mulFactored`) is larger
at order three (150,008 characters against 72,637) and takes 44 s, so the chain
rule keeps `.mul()`. The remaining cost is in the expansion: the profile names
`expandProduct`/`expandProducts` (9 s of the 11.7 s third derivative) and `add`,
because the chain rule distributes each level over the previous one.

- **CE-332.1** Options not tried: build the derivative of a nested radical as a
  product of powers without opening it, or simplify per order before
  differentiating again. Either changes the shape of `evaluate()` results and
  needs a snapshot-churn measurement.

### CE-334. Each call of a user function invalidates every generation-keyed cache

**Status:** open; performance. Decision 2026-09-24: no general per-call cache
design now; reduce the per-call costs instead.

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

**Status:** open; performance.

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

**Status:** open; performance.

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

### CE-338. The compiled broadcast wrapper of an inline function literal on an `Apply` head

**Status:** open; performance, small, low priority.

A block-local function that the block only calls is emitted without the
broadcast wrapper (`callOnlyLocalFunctionLiterals`, `base-compiler.ts`). The
wrapper stays when the function is used as a value (it is needed there) and on
an `Apply` head whose argument is not proved scalar, where the wrapper does the
broadcast; `_SYS.bcastFn(literal, x)` in place of a wrapped literal would save
one closure.

### CE-339. The Python target does not hoist in two shapes

**Status:** open; performance.

The Python `Sum`/`Product` with one indexing set hoists its loop-invariant
values (2026-10-24), and small unrolled JavaScript sums hoist in expression
form. Still open: a Python sum with several indexing sets (an inner range can be
empty, so the hoisted value needs a guard per range) and the Python callback
lowerings (`Map` and similar) do not hoist.

### CE-340. The interpreted growing-list loop is quadratic

**Status:** deprioritized; performance.

`let xs = []; for k in 1..n { xs = Join(xs, [k]) }` costs about 0.5 µs per
element per turn on the interpreter (857 ms at 1000 turns; the compiled route
copies a native array per turn). An immutable append copies the list. Options,
if interpreted loops of many thousands of turns become important:

- a growable backing buffer with prefix views (amortized O(1) append; safe
  without ownership analysis, because every holder of an older value keeps its
  own prefix), together with an incremental type for the new node;
- a per-node descriptor cache on the invalidation axis of the type cache.

### CE-458. Compiling a body that several binders share is exponential in the depth of the sharing

**Status:** open; performance, design.

A user function whose body holds a `Sum` and a `Product` over the same subtree,
nested to depth _d_ (the level below shared by both), took 55 s to compile at
_d_ = 10 (measured 2026-10-24). Nothing is evaluated during the compile. Two
causes were fixed on 2026-10-25: unrolled clauses multiplied with no limit on
their total size (`MAX_UNROLLED_NODES`, `compilation/unroll-budget.ts`, read by
the JavaScript, interval and GPU targets), and the complexness analysis started
with an empty memo each time it entered a binder mask (now one memo layer is
kept for each enclosing layer and mask, `_pushKeyedComplexMemoLayer`,
`base-compiler.ts`). Depth 10 now compiles in 1.7 s and depth 12 in 7.8 s (load
10 on 18 cores); the test is `compile-shared-binder-body.test.ts`.

What remains doubles at each level: the shared subtree is emitted once under the
`Sum` and once under the `Product`, because the common-subexpression pass
(`compilation/cse.ts`) does not share a node between two sibling binder bodies.
Two changes are needed: the test of whether a candidate can leave a binder
region must use the FREE names of the candidate (`symbolsOf` and
`mentionsVarying` in `loopInvariantHoistCandidates` count a name that an inner
binder binds again), and a temporary must be placed in the nearest common
ancestor region even when that region holds no occurrence itself. Related to
CE-320.1. The size estimate of `unroll-budget.ts` reads literal bounds only, so
a nested clause whose bounds become constant only after a fold counts as a loop.

### CE-341. Assigning a function literal whose body shares operands is exponential in the sharing depth

**Status:** on demand; performance.

`ce.assign('f', Function(Hold(e), t))`, with `e` a depth-_n_ shared tower
(`Max(e, e)` nested, 31 distinct nodes at depth 30), doubles per level: 1.7 s at
depth 16, 3.1 s at 18, 10.6 s at 19, and the process runs out of memory at 30.
BOXING the same literal takes 1 ms and APPLYING it to an argument takes 9 ms at
depth 30 (both pinned in `dag-shared-walks.test.ts`). Probe: the `assign` line
above at depths 16, 18 and 19. Two walks on the assign route descend each
operand independently:

- **CE-341.1** `Walker.visit` in `boxed-expression/effects-inference.ts`, the
  latent-effects inference of the literal's body
  (`inferFunctionLiteralEffects`). A lazy collection that reads the effects of
  its callback also reaches it: `Map(k ↦ e + k, Range(1, 3)).count` does not
  return at depth 30, while the same `Map` with the tower in its SOURCE answers
  in 3 ms. The visit carries order-sensitive state (the confinement set of
  declared names per sequence, the registry-consulted bits, the saturation early
  return). A per-node memo is sound only if the answer depends only on (node,
  set of declared names), which needs the same analysis as the binder rewrite.
- **CE-341.2** `jsonWithSourceOffsets` in `engine-declarations.ts`. The literal
  is boxed again from its MathJSON (with `sourceOffsets`) to stamp parameter
  types, and `BoxedFunction.structural` rebuilds each path of a shared operand
  as a fresh tree. MathJSON cannot express sharing, so the serialization itself
  is exponential in size. The re-box must work from boxed operands
  (`ce.function('Function', [body, …params])`) instead.

No known consumer assigns a literal whose body is an evaluated value: parsed
bodies are trees, and Tycho never assigns a shared-operand RESULT as a function
body.

### CE-342. Fixed-width collection chains: compile optimizations that remain

**Status:** open; performance. CE-342.1 waits for Tycho: request filed
2026-10-22 in `~/dev/tycho/docs/COMPUTE_ENGINE.md`, section "Standing Tycho-side
follow-ups" (measure the Desmos state `62urmx2dcm` again on 0.161.0).

The by-reference Voronoi row costs about 2.7 µs a sample (the inlined row 1.2 µs
on the same machine). What remains:

- **CE-342.1** Cross-definition CSE. The last-call memo
  (`memoizeSharedDefinitions`, `javascript-target.ts`) answers the row's second
  call of `m(x, y)` from the record of the call inside `m2`. The remaining 2× is
  the nine-point block, computed once inside `m2` (its own inlined `d(x, y)`)
  and once inside `m`. To share it, emit the block once as a helper over
  `(x, y)` that returns the nine distances, memoize it the same way, and read it
  in both bodies. This needs three new things: a CSE harvest whose region spans
  several emitted definitions (`cse.ts` regions are per root, and a candidate
  found in two bodies must become a call that passes the bodies' parameters, not
  a `const` at a region entry); an alignment of parameter names across the
  bodies (`m(u, v)` would not match without alpha-renaming); and a memo of an
  ARRAY result, which the current memo declines (an array compares by identity
  and its consumer may mutate it). Inlining small scalar callees at call sites
  was measured and rejected: a size bound on the AUTHORED body does not bound
  the EMITTED code (`m` is 4 nodes authored, 2 456 characters emitted), and
  making the inliner the primary route changes 374 `_fn_*` call shapes across 35
  test files. Corpus count (tycho-perf, 2026-09-09, 71 documents): a
  collection-valued helper reached from two or more definitions occurs in 2 of
  30 core documents, and only this Voronoi row reaches such a helper through two
  callers.
- **CE-342.2** A fixed width known only from a TYPE
  (`P: list<tuple<number, number>^9>` as a symbol, `At(P, i)` reads) is not
  unrolled; the pass needs a literal `List`. Unrolling from the type would
  rewrite `Map(f, P)` to `[f(At(P, 1)), …, f(At(P, 9))]`, which then needs an
  `At` lowering over a declared list on the shader targets. Corpus count
  (tycho-perf, 2026-09-09): 0 sites on every target, because Tycho expands value
  macros before compiling. The only case is the by-reference Voronoi row, whose
  records fail at binding on Tycho's side (`Unknown operator d`), so the audit
  harness cannot see it.
- **CE-342.3** A point bound to an untyped parameter that cannot be inlined
  fails closed. The call-site substitution declines for an impure point
  argument, a recursive or multi-clause callee, and a body that is invalid over
  a point (`P·P`, `2P + 1`); the compile reports the reason and the
  `fallback: true` route answers through the interpreter. A parameter the body
  never mentions keeps the by-reference call. A per-shape specialization of the
  emitted definition would compile these cases; no consumer has asked.
- **CE-342.4** `Map(h, list)` with a variadic user `h` is not unrolled: no
  target compiles a function literal with a rest parameter, so the unroll would
  gain nothing until one does. A library head with no required parameter
  (`Map(Max, …)`) is not unrolled either, and the JavaScript target cannot
  compile it as a callback.

For Tycho: on `glsl`/`interval-js` the by-reference route needs the plot
variables DECLARED (or supplied through `vars`). An `unknown`-typed argument
could hold a collection that the by-reference call would broadcast, so
`provablyScalarArg` refuses to inline over it. This is a soundness guard, not a
defect.

### CE-343. A selection over a decidable list condition costs about 2 ms per element

**Status:** open; performance. Tycho ask 296.

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

### CE-344. `TYPE_CACHE` clears the whole map when it is full, which makes a 150× slowdown

**Status:** deprioritized; performance. Re-open when `evictClear > 0` on a real
workload.

`TYPE_CACHE` (`common/type/parse.ts`) holds at most 2048 entries. When it is
full it clears the entire map, on the assumption that the set of distinct type
strings is small. Types with lengths break that assumption: each vector size is
its own type string (`vector<finite_integer^303>`, `^304`, ...). Measured by
re-parsing a working set of W distinct length-typed strings in a loop: W <= 2048
costs 0.02-0.11 µs/parse; W = 2100 costs about 3-4 µs/parse (about 150× more),
and stays flat above that, because each overflow drops 100% of the entries.

A different eviction policy does not fix it: FIFO eviction of the oldest entry
was slightly worse (5.8 vs 4.3 µs/parse over the limit), because a working set
larger than the cache, re-parsed in a repeating order, is the worst case for any
policy. The possible fixes:

- **CE-344.1** Reduce the number of distinct type strings: cache a
  length-parameterized type by structure, with the length as a parameter.
- **CE-344.2** Size the cache to the working set.

No real workload reaches the limit: the largest consumer document measured
creates 329 distinct type strings (one with a length), with zero overflow clears
and a 97.1% hit rate over 11,245 reads. `TYPE_CACHE` reports under
`CE_CACHE_STATS` as the `typeParse` class (hits, cold stores, and `evictClear`,
the count of whole-cache clears).

### CE-346. Compiling a `Derivative` of a deeply nested body runs the failed symbolic attempt to its budget

**Status:** open; performance. Tycho item 177.

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

### CE-347. A `Map` nested in the body of a `Map` still canonicalizes faster than linearly with depth

**Status:** open; performance.

A `Map` nested in the body of a `Map` grows faster than linearly (40 → 80
levels: about 3.5×), because the `rebindParameters` of each level walks its
whole body and the result type gains one `list<…>` level per `Map`. Removing
this needs a memo of the symbols of each node in `binders.ts`. At 160 levels
canonicalization overflows the stack.

### CE-348. Evaluate-handler contract: two sites test `unknowns.length === 0` in a dynamic scope

**Status:** on demand; performance.

The evaluate-handler contract (enforce it in review): a `lazy: true` operator
receives RAW operands and its handler owns their single evaluation
(`Add`/`Multiply`/`Sum`/`Product`/`Measurement`/`NumeratorDenominator`
re-evaluate legitimately). A non-lazy operator receives EVALUATED operands and
must not evaluate them again: each call descends the unmemoized subtree again,
and under nesting the cost grows exponentially. Do not delete the lazy
`Add`/`Multiply` maps: that experiment stopped recursive unrolling at one level
per pass.

- **CE-348.1** Two sites test the dynamic-scope predicate
  `unknowns.length === 0`, a latent instance of the same trap with no observed
  misbehavior. Leave them until one shows a problem. The equation-equivalence
  `eq` in `relational-operator.ts` is reachable only through a direct
  `.isEqual()` on two equation objects (`Equal(eq1, eq2)` canonicalizes to a
  chain), and that call runs at top level where `unknowns` is correct.
  `isPolynomialExpression` in `linear-algebra.ts` (3 sites) is behind callers
  that evaluate operands first. A plain `isConstant` swap at either site would
  change how assigned symbols in unevaluated input are classified, so it is not
  a free rename.

### CE-349. Cold-start bundle size and six benchmark cases slower than 0.73.0

**Status:** open; performance. Measure before work.

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

**Status:** open; performance, low priority.

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

**Status:** open; performance. Plan:
docs/plans/2026-09-06-type-facts-per-type.md.

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

### CE-352. Faster free-variable `eq()`: two designed speed-ups

**Status:** on demand; performance.

The free-variable branch of `eq()` samples before it runs the expand+simplify
proof. That change met the need of the Tycho witness (14.6 s → 6.2 s). Build
these only when a workload needs them:

- **CE-352.1** Memo of `_expand(x).simplify()` per engine, for a workload where
  repeated comparisons agree under sampling, so the symbolic proof still runs
  each time. Key: structural hash, with an `isSame` guard. Invalidate on
  `_mutationGeneration` and on the `_writeVersion` of each free symbol (plain
  `_generation` changes on each loop-index write and would never hit inside a
  drain). A bundle-patch prototype measured 14.6 s → 6.6 s on the witness.
- **CE-352.2** Hoist loop-invariant broadcast operands. Each broadcast element
  evaluation resolves invariant scalar operands to new nodes (a WeakMap keyed on
  node identity got zero hits within a drain), so `stochasticEqual` compiles the
  same tree again for each element. Hoisting the operands once per drain keeps
  node identity and allows a compiled-evaluator cache per node. Do it only if a
  witness shows that the sampling compile is the hot part; today one comparison
  costs a compile and about 50 point evaluations.

### CE-353. Bundle cold-start time

**Status:** open; performance.

This is the only performance item left from the July 2026 reviews. The
cache-based speed-ups were measured and gave no gain (2026-07-18): do not try
them again without a new profile.

### CE-442. A `D` node with a closed form computes the derivative again at each evaluation

**Status:** open; performance. Found 2026-10-24 while measuring CE-313.

Evaluating the same `D(PointY(h(u)), u)` node of Tycho's 29-piece path (row 424)
again differentiates again each time, about 0.5 s per evaluation on a loaded
machine. `D` is `lazy`, so the memo of inert evaluations leaves it out, and
`withDeclinedDerivativeMemo` (`library/calculus.ts`) records only declines.
Possible fix: record a successful result with the same dependency stamps as a
decline.

## Tests, tools, documentation and release tasks

### CE-355. Post the next release version to Tycho for rows 418 to 425

**Status:** open; task. Tycho rows 418, 419, 420, 421, 422, 423, 424, 425.

The fixes of Tycho rows 418 to 425 are on main and are not in 0.161.0. Each row
closes when Tycho's instrument prints `READY` on an installed release. When the
next release ships, write its version on each row in
`~/dev/tycho/docs/COMPUTE_ENGINE.md`.

### CE-356. A `Solve` test returned `null` once in a loaded full-suite run

**Status:** open; defect, small. Not reproduced.

The test "a parameter whose type is not declared is real" in
`test/compute-engine/solve.test.ts` failed once in a full run (at commit
`3bdee13b3`, full suite with the default workers):
`Solve((x-1)(\tan(3x)-a)=0, x)` returned `null`. It passes alone, and the solve
takes 50 to 700 ms. The engine has no ambient time limit (`solve.ts` reads
`ce._deadline` only inside a `withTimeLimit` span, and the test arms none), so
the time limit is not the cause. The test now has a 60 s jest timeout, because
it runs about ten solves. If the `null` comes back, record the full output and
the load average, and look for state that another test in the same file leaves
on the shared engine.

### CE-358. Remove the TypeScript 6 compatibility alias

**Status:** open; task, small.

`@typescript/native` (TypeScript 7) runs the build and the typecheck. The module
name `typescript` is an alias for the TypeScript 6 API, because TypeScript 7.0
has no programmatic API and ts-jest, typedoc and madge need one. Bare `npx tsc`
is ambiguous: use the explicit native-binary path. Convention for new files:
relative imports in `src/` use `.js` specifiers.

Remove the alias when TypeScript 7.1 ships its new programmatic API and ts-jest,
typedoc and madge support it. Until then the side-by-side install is the
intended state.

### CE-359. Test suites that fail only under load in a full-suite run

**Status:** open; task.

These suites failed in loaded full-suite runs and passed alone on an idle box.
Before you blame the change under test in a full-suite report, check these. If
one fails in a full run on a quiet box, investigate it as a real defect.

- **CE-359.1** `functions.test.ts`, "ASYNC LANE KEEPS A SCOPED HANDLER'S LOCAL
  SCOPE ALIVE" (6 tests): sensitive to concurrency timing (6-worker run).
- **CE-359.3** `rubi-utils.test.ts`: one test of an R18 rung closure.
- **CE-359.6** `integration-rules-substitutions.test.ts`: 1 test failed (R30
  `∫Tanh(x)²/(a+b·Tanh(x))`) in one run and 5 tests (R29, R30, R8 and their
  `RUBI_NO_*` tests) in another. The integral stayed inert, which agrees with
  the 10-second rule-engine time limit running out under contention. Not run on
  an idle box.
