# Static-shape compilation: every shape is settled at compile time

Status: DECIDED 2026-10-31 by the user: option (A) of §5, with the
clarifications of R2 (the host decides where a dispatch is paid, by what it
declares) and R5 (an unsupplied input and a value outside the declared type,
`NaN` or `±Infinity` for `real` included, give an undefined result that can
differ per target). Written 2026-10-31 by session compute-engine-10 after the
user's question of the same day. Nothing is implemented yet; §6 lists the
steps. §7 lists the open ROADMAP entries that the rule closes or changes
(survey of the whole file). The answers of the Tycho session (tycho-desk) are
in §8.

## 1. The question

The user asked whether the compiler should stop handling expressions with
incomplete, ambiguous or wrong input, and instead require the host to pass
(1) expressions whose types settle every shape, and (2) argument values that
match those types, with no guarantee otherwise. The user also proposed that a
function such as `f(x) = x + 1`, whose parameter can receive a scalar or a
list, be compiled as two versions, one per shape, instead of one body that
tests the shape at run time.

The rule of 2026-10-31 (`docs/COMPILATION-MODEL.md`, "Fail closed", option
(b) of `docs/plans/2026-10-31-compiled-code-contract-for-errors.md`) already
covers part (2) for values: a value outside its declared or inferred type
gives an unspecified result. It was applied to one case (a sub-expression of
static type `error` declines). It says nothing about shapes that the static
types leave open, and the compiler still resolves those at run time.

## 2. The evidence

### 2.1 The defects of the last two days

Of the ROADMAP entries added since 2026-10-29 (CE-621 to CE-711), about 45
concern compiled code. Classified by cause:

| Class | What it is | Entries | Count |
| --- | --- | --- | --- |
| H | The host passes a value outside the type, or no value | CE-631, 634, 656, 706, 710; issue #488 follow-ups 13, 14, 15, 38 | 9 |
| P | The program breaks its own declared type at run time, which the static type does not show (`Declare(p, integer); p := 0.5`; `h: (real) -> integer` with body `t/2`) | CE-662, 669, 673, 676, 677, 681, 707, 630 | 8 |
| S | A value whose static type admits two shapes (scalar or list, point or list of points) is dispatched at run time, and one consumer has no test (`_SYS.bcastFn(_fn_q, _.u) + 1` gives the string `"2,4,61"`) | CE-658, 693; follow-ups 13, 31; `callResultGuard`, `declaredTopGuard` decisions | 6 |
| L | A lowering defect with no relation to types or shapes | CE-651, 652, 653, 654, 655, 684, 685, 686, 687, 688, 646, 636, 644, 679 | 14 |
| API | The input form of `broadcast()` or the interval runner | CE-632, 633, 678 | 3 |

Classes H, P and S are 23 of 40 classified entries. Each H, P or S fix is a
check at one site; the next review round finds the site without the check.
The history of follow-up 8 of issue #488 (a string argument to a function
literal) shows the pattern: each round found one more shape that still gave a
value (a union argument, a call through another function, a local variable,
`Sum` of a boolean, a `Match` capture, Python `True == 1`), until one static
rule (the `error` static type declines) replaced them all.

The user rulings that the run-time shape dispatch rests on are themselves a
patchwork: a guard is emitted at every call with a non-literal argument
(2026-08-30), not for an argument declared scalar or constructed from one by
scalar arithmetic (2026-09-07), a parameter inferred scalar in a body is
trusted (2026-09-08), a declared-scalar callback broadcasts like an inferred
one (2026-09-22). The code that applies them (`compile-user-calls.ts`,
`javascript-value-facts.ts`, `compiler-type-facts.ts`, about 6,000 lines
together) exists to decide where a test can be left out.

### 2.2 What Tycho's documents compile to today

Measured on the whole-corpus codegen audit of CE 0.175.0 (757 documents,
`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.175.0-all-cc286fe3d.json`,
8,826 JavaScript records with code):

| | Records | Occurrences |
| --- | --- | --- |
| Free symbols with a declared type | | 17,750 |
| Free symbols with an inferred type (`number` 51, `unknown` 41, other 7) | 9 records hold an inferred `unknown` | 99 |
| `Array.isArray` run-time shape tests | 377 | 1,675 |
| `_SYS.bcast(` operator broadcast with a run-time shape test | 557 | 1,304 |
| `_SYS.bcastFn(` user-call broadcast with a run-time shape test | 174 | 297 |
| `!== undefined` tests for an unsupplied input | 1,179 | 5,011 |

Among the 8,071 records whose every free symbol is a DECLARED scalar (`real`,
a range, `integer`, `real | signed_infinity | nan`), so no list can enter:

| | Records | Occurrences |
| --- | --- | --- |
| `Array.isArray` | 179 | 510 |
| `_SYS.bcast(` | 142 | 279 |
| `!== undefined` | 1,052 | 3,459 |

Example (`exoplanet-transit`, every input declared `real`):

```
_.L_0 * (-(((_tv5) => Array.isArray(_tv5) ? _SYS.bcastFn(_fn_f, _tv5) : _fn_f(_tv5))(_.c * (_.x + -_.x_1)) * …
```

The same call compiled in isolation (`f := x ↦ x + 1`, `c, x, x_1: real`,
options `broadcast: true, mode: 'strict'`) gives `_fn_f(_.c * (_.x + -_.x_1))`
with no test. tycho-desk found the cause (§8, Q1): Tycho binds the body of
every document function with its parameters at `broadcastable<number | tuple>`
and declares the return `-> unknown` on purpose (a narrowed return misreports
a broadcast call `l([P, Q])` as scalar). So the static type of a nested call
`g(x, y)` is `unknown`, the outer call `I(√g(x, y))` sees a wide argument, and
the guard is emitted. tycho-desk counted 282 of the 326 `bcastFn` records as
having only numeric inputs. The shape is known from the types at the call
site; the compiler loses it at the declared return of the inner call.

The run-time cost of the test on the JavaScript target is small: tycho-desk
measured the emitted pattern against the direct call at 5 to 11 ns per call
for both, with no difference above the noise (Node 26.13.0, a monomorphic
`Array.isArray` on a number). The benefit of removing the tests is the
fragility of §2.1 and the code that decides where to emit them, not the
JavaScript run time. The WebGL cost of row 480 is a different mechanism.

Tycho always supplies every input when it samples
(`~/dev/tycho/docs/COMPUTE_ENGINE_LOG.md`, "Tycho always supplies every input
when it samples"), and the user decided on 2026-10-31 that a missing input
gives an unspecified result, so the 5,011 `!== undefined` tests protect
nothing in Tycho's use.

### 2.3 The shader targets already work this way

GLSL and WGSL have static types and no run-time shape dispatch: every shape
is settled at compile time, a point-or-point-list symbol is written in place
before compilation (`gpuInlinePointValues()`), and a shape the compiler cannot
settle declines. On the same corpus the GLSL target declines 49 records of
3,942 and the JavaScript target 24 of 8,850. The static model is in
production for Tycho's GPU documents. The JavaScript target is the only one
that resolves shapes at run time.

## 3. The proposed rule

R1. **Every input has a declared or inferred shape.** An input (a free
symbol of the compiled expression) whose type is `unknown` or `any`, that is
nothing declared and nothing inferred, is refused at compile time, with the
names of the refused inputs in `unsupported` (Tycho asked for the names,
2026-10-31). A declared union of shapes is not refused: it is the host's
request for a dispatch (R2).

R2. **The host decides where a run-time dispatch is paid, by what it
declares.** (User clarification 2026-10-31.)

- A parameter with no declared type takes its shape from each call site. It
  is compiled once per argument shape that the program uses: `f(t)` with
  `t: real` calls the scalar variant; `f(L)` with `L: list<real>` calls the
  list variant when the body admits a list, or a static element-wise loop
  over the scalar variant when the interpreter would map (a scalar-parameter
  function over a list argument). The specialization machinery exists
  (`trySpecializedUserCall`, `compile-user-specialization.ts`, "one shared
  helper for each proven argument representation"); the change is that the
  argument's static type is the only evidence. A function value handed to a
  callback position (`Map(f, L)`) is handed as the variant for the element
  shape of `L`.
- A parameter or an input DECLARED with a union of shapes
  (`f: (number | list<number>) -> …`, `P: tuple<…> | list<tuple<…>>`) is an
  explicit request for both shapes. The compiler emits one dispatch at that
  binding, the parameter entry or the input entry, and compiles the body
  once per member shape behind it. Each body is monomorphic: no test inside
  it, and a consumer of the value never tests the shape again. The host pays
  one test per call for the parameter it declared this way, and nothing for
  the others.
- The documentation says that a host that knows the shapes it will pass
  should declare them, or compile `f(number)` and `f(list<number>)` as two
  functions, and that a union declaration costs a dispatch per call. The
  compile result can name the bindings compiled with a dispatch (a note next
  to `unsupported`), so a host can see what it paid for; this is optional and
  decided at implementation.

One check for the implementation: tycho-desk says a document function's
parameters are `unknown` in the SIGNATURE and its body is bound with them at
`broadcastable<number | tuple>` (§8, Q1). The first bullet must apply to
them (the signature is what the compiler reads), or the binding type would
count as a declared union and keep a dispatch at every document-function
call. Step 1 of §6 verifies which type the compiler sees.

What is never emitted: a dispatch that the host did not ask for. Today's
guards at calls whose argument has a wide static type, the `any` operand
guard and the call-result guard all go; the only run-time shape test left in
compiled code is the one at a binding the host declared as a union.

The result type of a variant is the type of its body under the variant's
parameter types. A declared return type `unknown` or `any` carries no
information and does not widen it. This clause is essential: Tycho declares
every document function `-> unknown` (§8, Q1), and without it the result of
each nested document-function call has no settled shape, so R3 would decline
the 282 corpus records that carry a guard today instead of compiling them
without one.

R3. **A value the program produces with no settled shape declines.** An `If`
whose branches have different shapes, a call of a function whose result shape
depends on a run-time value, a `Which` over shapes: the compiler declines
with `unsupported` naming the node. This is the simple, sound version: no
value where the interpreter has one, never a different value.

R4. **A declared union of shapes at an input follows R2.** Tycho declares
`P: tuple<number, number> | list<tuple<number, number>>` for a document
variable that can be a point or a list of points (row 479, CE-658). Under R2
such an input compiles, with one dispatch at the entry and two monomorphic
bodies; today it declines on JavaScript (CE-658). Tycho can also avoid the
dispatch: its `compileBody` route already declares the exact shape of the
current value and keys its cache on it (every one of the 254 tuple-typed
compiled inputs in the corpus has an exact shape), and the plot sampler route
could narrow the union from the value and retire the kernel on a shape
change, about one to two days (§8, Q6). That is Tycho's choice, an
optimization, not a requirement of this rule.

R5. **The compiler assumes that every value holds its static type, and emits
no test of it.** (User clarification 2026-10-31: the rule covers the host's
values as well as the program's.) Three cases:

- The program's own values (CE-662, CE-673, CE-681, CE-707 class). Where the
  static type of an assigned value or a call result is not a subtype of the
  declaration, the compiler declines; it never emits a test. The
  interpreter's run-time `incompatible-type` error in these cases is a
  program error, which the compiled code need not reproduce.
- A value the host passes outside the declared or inferred type of an input:
  a string or a list for `real`, and also `NaN` or `±Infinity` for an input
  declared `real` (`real` holds only finite values, `docs/ERROR-MODEL.md`).
  The result is undefined: it can equal the interpreter's, differ from it,
  hang or throw, and it can differ between compile targets. `NaN` and
  `±Infinity` keep their meaning in an input declared
  `real | signed_infinity | nan`, because they are values of that type (Tycho
  asked for this, 2026-10-31).
- No value for an input. The result is undefined in the same sense. A host
  that may leave an input out tests it before the call (`hasUnresolvedInput`,
  or its own check); Tycho always supplies every input when it samples.

This changes one sentence of the current documents. The rule of 2026-10-31
(`docs/COMPILATION-MODEL.md`, "Fail closed", sub-decision 1 of the contract
plan) says that for `NaN` or `±Infinity` at an input declared `real` the
`javascript` target "computes as for an input declared
`real | signed_infinity | nan`" while a GPU target may assume a finite value.
Under R5 that sentence becomes an observation about today's code, not a
guarantee: a host that needs a defined result for a non-finite value declares
the input `real | signed_infinity | nan`.

R6. **The checks that R5 makes unnecessary are removed, not only declared
unnecessary.** The `run()` entry refusals, the same checks in `broadcast()`
and the interval runner, the unsupplied-input guards
(`unsuppliedComparisonGuard`, `collectionReadInputs`, `withTruthOnly`), the
call-result guard, the `any` operand guard and the run-time class of the
CE-662 check (the list is in CE-711 and in §5 of the contract plan).

What does not change: the interpreter's semantics. An untyped parameter
applied to a list still maps element-wise; a declared `list<real>` input is
still read whole; a `broadcastable<T>` parameter still broadcasts. Only the
place where the shape is decided moves, from the run time of each call to the
compile of each expression.

## 4. What is removed and what it costs

Removed (estimates from the 2026-10-31 survey and from reading the module
headers; the implementation measures them):

- The `bcastFn` dispatch and the `Array.isArray` guards at calls, and the
  proofs that avoid them (`provablyScalarArg`, `isConstructedScalar`,
  `certainlyScalarArg`, `staticTypeIsEvidence`, `argumentProvesParameterType`,
  `assignmentsProveType`, the "scalar by construction" rules): a large part of
  `compile-user-calls.ts` (1,992 lines) and `javascript-value-facts.ts`
  (1,720 lines).
- `declaredTopGuard`, `callResultGuard` (`compile-expr-handlers.ts`).
- The `run()` entry refusals (`checkEntry` and its helpers, about 600 lines)
  and the same in `broadcast()` and the interval runner.
- The unsupplied-input guards (`unsuppliedComparisonGuard`,
  `collectionReadInputs`, `withTruthOnly`, about 800 lines in
  `compile-absence.ts`, which is 3,309 lines). The absence of a BLOCK LOCAL
  with no value (CE-636, CE-644) is a program feature and stays.
- The run-time class of the CE-662 check (certain / never / undecidable with a
  test): only the decline stays.
- The run-time tests themselves: one `Array.isArray` per guarded call per
  sample, one `!== undefined` chain per guarded expression per sample. On
  JavaScript their measured cost is within noise (§2.2); the gain is code
  size and the removal of the decision logic, not speed.

Costs:

- **Declines.** An input of type `unknown` or `any`: 9 of 8,826 JavaScript
  records in the corpus (41 symbol occurrences; 36 of them are fresh symbols
  that Tycho creates and does not declare, a one-line Tycho fix, and 5 are
  undeclared axes, §8 Q2). A produced value with no
  settled shape (R3): not measured; the GLSL count (49 declines against 24,
  §2.3) bounds it at about 25 records, 0.3 %, if JavaScript declines what GLSL
  declines for shape reasons. A declaration that the static type of the value
  does not satisfy (R5): not measured; the CE-662 implementation reports its
  "undecidable" class today and can count it.
- **Tycho changes.** Read the refused input names from `unsupported` (about
  one day, tycho-desk's estimate); declare the deferred-gate symbols (one
  line); call `hasUnresolvedInput` before a run (already owed, user decision
  2026-10-31); test `Number.isFinite` before a GPU frame (already planned,
  Tycho ROADMAP row II). Optional, to avoid the entry dispatch of a
  point-or-point-list input: narrow the union in the plot sampler route and
  retire the kernel on a shape change (one to two days, R4). No change to
  how Tycho declares document functions: R2 reads the
  argument shapes CE already has at each call site, which is the option
  tycho-desk recommends (§8, Q5); the alternative, a parameter type declared
  by Tycho per compile, was estimated at one to two weeks with a risk of new
  refusals.
- **Open ROADMAP entries that close by the rule.** CE-706 (option (c): a list
  at an untyped root parameter is a host error; and under R2 a root lambda is
  compiled for the shape the host declares), CE-707 (option (a) is the
  consistent choice: the declared result binds the body; the compiler already
  agrees with the interpreter there, and a body whose static type contradicts
  the declaration declines), CE-662 / 669 / 673 / 681 (decline-only), CE-677
  (no shape guard to fix), CE-683 and CE-711 (this is their implementation),
  CE-693 (an `expression` parameter has a shape per call site).
- **Tests.** The tests of the rulings of 2026-08-30, 09-07, 09-08 and 09-22
  change or go; the `code` text of every record with a guard changes. Count
  to be measured and reported before landing, not a reason to choose.
- **Documentation.** `docs/COMPILATION-MODEL.md`: the "Fail closed" section,
  the paragraph on the `Array.isArray` guard of a user-function call, the
  paragraph on broadcasting wrappers for callbacks, the collections entry
  check; `docs/ERROR-MODEL.md` "An unsupplied variable"; AGENTS.md "Compiled
  code must agree" rule, extended to shapes.

## 5. Options

- **(A) Static shape, this proposal (R1 to R6).** Removes the H, P and S
  classes of §2.1 as a class. Costs the declines and the Tycho changes of §4.
- **(B) Keep the rule of 2026-10-31 and do only CE-711.** Removes the H
  class checks (about 2,500 lines) and their per-call cost. Keeps the run-time
  shape dispatch and the proofs that avoid it, so the S and P classes continue
  to produce one defect per review round. No Tycho change beyond
  `hasUnresolvedInput`.
An earlier draft had a third option, a dispatch kept at a declared
`T | list<T>` input only; the user's clarification of R2 (the host decides by
what it declares) made it part of (A).

Recommendation: (A). If nothing is decided, (B) is what the ROADMAP already
plans, and the S and P classes stay.

## 6. Steps

Each step in its own worktree, with the dual review, the before/after corpus
audit (`reference_codegen_audit_rerun`: a production build of the worktree,
Tycho's `audit-ce-codegen.mts --all` through the redirect hook, compared with
`compare.mjs`), and a report of the declines per target and the `code`
changes.

1. **Admission (R1, R3).** Refuse `unknown` and `any` inputs with their
   names; decline a produced value with no settled shape. Measure the
   declines on the corpus. This step is the prototype the user asked for: a
   local build for Tycho follows it. One test pins the behavior that this
   step changes: in `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts`,
   `At(Apply(a ↦ Block(If(Length(a) > 1, Return(First(a))), Reverse(a)), M), 1)`
   with `M: list<real>` compiles today, and `_SYS.atWithValueMarker` throws
   at run time when the early `Return` gives a number. In the compiled code,
   where `a` is typed from `M`, the `Apply` has the type
   `list<real> | nan | real`, a value with no settled shape, so under R3 the
   compilation declines. Step 1 changes the test to expect a decline, and
   adds the same case with `a: list<real>` written by hand.
2. **Call sites (R2).** The argument's static type selects the variant; remove
   the `bcastFn` dispatch, the `Array.isArray` guards and the scalar proofs.
   The callback wrappers (`_fn_f$b`) become the variant for the element shape.
   A declared union at a parameter or an input gets its one entry dispatch
   with a monomorphic body per member; CE-658 closes with it.
   Two constraints come from the typing of an immediately applied function
   literal (GitHub issue #498, `appliedLiteralTypedFromArguments()` in
   `src/compute-engine/compilation/applied-literal-types.ts`), which already
   gives a bare parameter the static type of its collection argument:
   - The parameter type of a variant must also admit each value that the
     body assigns to the parameter. The argument type is the type of the
     first value only. With `C: list<real>` and an argument of type
     `list<integer>`, `a ↦ Block(Assign(a, C), Length(a))` typed
     `a: list<integer>` declines the assignment, which the interpreter
     accepts. Today such a parameter keeps the type that the body infers.
   - A parameter type that the compiler makes is not a host declaration. A
     union written by the compiler must not cause a dispatch at the
     parameter. Today an argument whose type is a union of shapes does not
     type the parameter: with `P: tuple<real, real> | list<tuple<real, real>>`,
     `Apply(d ↦ Length(d), P)` keeps the inferred type of `d`, and the shape
     is decided by the dispatch at the entry of `P` (R4).
3. **Host values (R6).** Remove the entry refusals and the unsupplied-input
   guards, after Tycho has `hasUnresolvedInput` at its five sites.
4. **Declared types (R5).** Reduce the CE-662 check to its decline; close
   CE-673, CE-681, CE-707 by the rule; decide CE-706 as (c).
5. **Documents** (§4, last item), the guidance to hosts of R2 (declare the
   shapes you will pass, or compile one function per shape; a union costs a
   dispatch per call), and the ROADMAP entries that close.

## 7. Open ROADMAP entries that the rule closes or changes

A read-only survey of all 321 numbered entries of `ROADMAP.md` on
2026-10-31, against R1 to R6 (every entry of the sections "Types and type
inference", "Collections, absence and broadcasting" and "Compilation" read in
full; in the other sections the 47 entries that mention compilation). The
classification was verified on a sample of ten entries. The entries close
when the step that removes their case lands, not before; the ROADMAP entry of
the implementation (CE-712) names them per step.

**Closed by the rule, no work besides the step (13).**

| Entry | Rule | Why |
| --- | --- | --- |
| CE-212 presence guard misses a nested read | R5 | An unsupplied input is undefined; the guards go (step 3) |
| CE-222 undeclared symbol read as a number, list gives a wrong value | R1, R5 | An `unknown` input is refused by name; a list for an inferred `number` is undefined (step 1) |
| CE-242 scalar comparison with an operand absent from `vars` | R5 | The same; the `Missing` program value (CE-218, CE-70) is not this case (step 3) |
| CE-256 record at an `unknown` callback parameter broadcast over its fields | R2 | A callback is compiled for the element shape of its source, no `Array.isArray` wrapper (step 2) |
| CE-259 `2y` with a list for a scalar-typed `y` | R5 | A host error, undefined (step 3) |
| CE-276 standalone lambda does not check its callback parameter types at run time | R5 | No test is emitted; the check-emission table is dropped (step 4) |
| CE-338 broadcast wrapper closure on an `Apply` head | R2 | The wrapper no longer exists (step 2) |
| CE-463 effectful `vars` reads merged by the `any` guard bindings | R1, R6 | `any` inputs are refused and the guard is removed (steps 1, 3) |
| CE-656 condition on a block local that holds an absent input | R5 | An unsupplied input is undefined (step 3) |
| CE-669 interval-js declines an assignment that reads an untyped parameter | R2 | The parameter is typed from its call site, which is the fix the entry proposes (step 2) |
| CE-677 shape test has no case for an open-length vector | R6 | The shape test is removed (step 3) |
| CE-693 declines where an `expression` parameter can receive a collection | R2 | The parameter has a shape per call site; the run-time-test variant is excluded (step 2) |
| CE-706 root function with an untyped parameter given a list | R2, R5 | Option (c): a host error; the root lambda is compiled for the declared shape (step 1) |

**Decided by the rule, work remains in the step (6).** CE-662, CE-673 and
CE-681 become decline-only (step 4; the run-time class goes). CE-707 is
decided as its option (a): the declared result binds the body, a body whose
static type contradicts it declines; the interpreter-side `incompatible-type`
refusal is implemented with step 4. CE-683 and CE-711 are this plan; CE-712
replaces them.

**Changed, the entry stays (14).** CE-64.3 (no Python run-time broadcast
helper), CE-216.2/.4 (`any` operands close; .1/.3 stay), CE-237.1 (static
call-site shape instead of a ported scalar proof), CE-245 (the
`'runtime-list'` emission and the `_SYS.pointSlot` NaN rule are dispatch the
host did not ask for: decline under R3, or one entry dispatch under a declared
union), CE-249.1/.2 (refused by name; the `Array.isArray` role test goes),
CE-268.2/.3 (dispatch only at a declared union), CE-279.6/.7 close and .3/.4
are restated, CE-342.3 closes (per-shape specialization is R2), CE-343 (the
`Abs` decline is re-judged), CE-467 (an `integer | range` argument is a
declared union: one entry dispatch, and the range branch is the open
question), CE-507.12 (the interval-runner entry refusal goes), CE-658 (a
union-declared input compiles with one entry dispatch), CE-660 (the compiled
half of the comparison goes), CE-676 (the run-time element test goes; the
out-of-range index question stays).

**Unchanged (144 read, 144 not read).** Lowering defects, missing
lowerings, GPU numerics, performance, symbolic and LaTeX items. CE-630,
CE-636 and CE-644 (a block local with no value) are program features and
stay.

So of 322 open entries the rule closes 13 outright, decides 6 more, and
changes 14. The Compilation section is mostly missing lowerings and GPU
numerics, which no contract rule touches.

## 8. Answers of the Tycho session (tycho-desk, 2026-10-31)

Read from the Tycho code and the 0.175.0 whole-corpus audit; nothing was
changed in Tycho. Summarized; the file names are tycho-desk's.

- **Q1, is the argument shape known at compile time?** At the call site, yes,
  through the types Tycho declares (axes `real`, sliders `real` or a range,
  collections `list<…>` or their current type; `ce-module-registry.ts`,
  `resolveCECompile`). Inside a definition, no: `deriveDefinitionSignatureFromBody`
  (`src/plot-core/ce-definitions.ts`) gives a parameter a `tuple` type only
  when the body reads `.x`/`.y`/`.z`; every other parameter is `unknown` in
  the signature and bound at `broadcastable<number | tuple>`; the return is
  `-> unknown` on purpose. A document function with a refused broad
  PARAMETER type would decline almost every document-function call.
- **Q2, `unknown` or `any` inputs.** Never on purpose. 41 `unknown` inputs
  (all inferred) in 6 documents: 36 are `tychoDeferredGate<i>c<j>` symbols
  that `compiledElementVerdicts` (`src/graph-paper/graph/relation-family.ts`)
  creates and does not declare (one-line fix: declare them `real`); 5 are
  undeclared axes. No `any`. A refusal today gives the generic warning
  "could not be compiled" (`classifyScalarDecline`, `src/plot/ce-compile.ts`);
  naming the input is about a day.
- **Q3, list arguments to document functions.** In plot kernels, rare: of the
  direct `_fn_` call arguments that are a single free symbol, 2,104 are
  scalar-typed and 0 list-typed. List-valued definitions (`f(L)` through
  `compileBody` or the interpreter) were not measured.
- **Q4, cost of the shape tests.** No recorded measurement. Micro-benchmark:
  the emitted pattern and the direct call both 5 to 11 ns per call, no
  difference above the noise. A benchmark of the 282 numeric-input records
  through the CE runtime with and without the tests is about an hour with a
  local build; not started.
- **Q5, which option Tycho could adopt.** (a) CE specializes at compile time
  from the static type of each argument: no Tycho change, and CE already has
  the types. (b) Tycho declares a parameter type per compile: one to two
  weeks, with a risk of new refusals (narrowed parameter declarations broke
  body binding before, D-212). Tycho recommends (a).
- **Q6, the point-or-point-list union.** The union comes from `_deriveValueType`
  (`document-ce-manager.ts`) at registration, before the value exists. The
  `compileBody` route (`src/plot-core/compiled-body.ts`) already declares the
  exact shape of the current value and keys its cache on it; all 254
  tuple-typed compiled inputs in the corpus have an exact shape. The plot
  sampler route shadows the union as declared (`ce-module-registry.ts`,
  byReference branch) and is where row 479 declines. Narrowing it from the
  value and retiring the kernel on a shape change is one to two days, and
  removes the Tycho side of row 479.
