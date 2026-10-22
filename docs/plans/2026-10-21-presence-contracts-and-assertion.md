# Presence contracts and the presence assertion (Q1 and Q3)

Status: decided 2026-10-21 (P1 (a), P1b yes, P2 (a), P3 (a), P4 `?!` and `⁈`
with `AssertPresent`, P5 (b) in its safe form) and implemented the same day,
slices S1 to S6; section 9 is the implementation record.

Scope: what a declaration `x: T` promises about absence (question Q1 of
`docs/plans/2026-10-20-bare-tuple-record-any.md`), when a possibly absent
value is a diagnostic (Q3), and how an author asserts that a value is
present. Out of scope, deferred in `ROADMAP.md`: record-field omission and
key removal (Q5/Q6), value capture (Q11), hoisting, and a compiled
representation of `Nothing`.

Every behavior quoted below was measured on the main tree at commit
`7cbbd3a50` (2026-10-21) with probe scripts; the engine routes use `ce.box`
and `ce.assign`, the Epsil routes use `executeEpsil`.

## 1. Vocabulary

- **Absent value**: `Missing`, `Undefined`, `NaN` or `Indeterminate`. This
  is the set `IsMissing` recognizes and `Coalesce` / `??` discharges (user
  decision of 2026-10-20). `Nothing` is an omission marker, not an absent
  value: it passes through both.
- **A type that excludes absence**: a type with no `missing` member, such as
  `string`, `tuple<number, number>` or `list<string>`. The type `number`
  admits `NaN`, so it never excludes the numeric absence marker. The types
  `real`, `integer` and `complex` hold finite values only and exclude `NaN`
  (correction of 2026-10-22: this entry first said that every numeric type
  admits `NaN`; `isSubtype('nan', 'real')` is false).
- **A possibly absent expression**: an expression whose static type has a
  `missing` member. `xs[i]` with `xs: list<string>` is typed
  `missing | string` because the index is not proved in range.
- **Present(T)**: the outcomes of `T` that are not absent. `presentType()` in
  `src/common/type/coalesce.ts` computes it: `string | missing` gives
  `string`, `number` gives `number` without `nan`, an unresolved type stays
  unresolved.

## 2. What the implementation does today

### 2.1 Assigning an absent value to a declared symbol (Q1)

| Input | Engine (`ce.declare` then `ce.assign`) | Epsil |
| --- | --- | --- |
| `s: string`, then `s := Missing` | Accepted. `s` reports type `string` and evaluates to `Missing`. | `let s: string = Missing`: the static check reports `static-type-error` ("missing" is not compatible with "string"), and the program still runs and binds `Missing`. A later `s := Missing` is silent. |
| `s: string`, then `s := Undefined` | Accepted, same as `Missing`. | Not probed separately. |
| `s: string`, then `s := 5`, `s := NaN`, `s := Nothing` | Refused: "The value … is not compatible with the type string". | `let s: string = 5`: static error and runtime error. |
| `n: integer`, then `n := Missing` | Accepted; `n` reports `integer`, evaluates to `Missing`. | Same as `s`. |
| `xs: list<string>`, then `xs := ["a", Missing]` | Accepted; `xs` reports `list<string>`, holds an absent cell. | `let xs: list<string> = ["a", Missing]`: no static report, binds. |
| `xs: list<string>`, then `xs := Missing` | Accepted; `xs` reports `list<string>`, evaluates to `Missing`. | Same. |
| `y: string`, initialized from a possibly absent read | not applicable | `let y: string = xs[i]`: no static report, binds whatever the read gives. |

The rule behind the first column is the one recorded in `docs/ERROR-MODEL.md`
("Assignment admits `missing` into a declared type", 2026-09-09): the value's
`missing` member is removed before the subtype test
(`matchesDeclaredTypeAxes`, `src/compute-engine/boxed-expression/effects-inference.ts`).
Its motivating case was a restricted value, `3 {a > 0}`, which then typed
`integer | missing`. Since the decision of 2026-09-25 a numeric restriction
masks to `NaN` and types `integer | nan`, which is a subtype of `number`
without any strip; the strip is still what admits a bare `Missing`, an
`Undefined`, and a restricted non-numeric value such as `(1, 2) {a > 0}`
(typed `missing | tuple<integer, integer>`) into a declaration that
excludes absence.

Consequence for readers of the symbol: a declared symbol's reported type
loses the absence. `s` says `string` while its value is `Missing`; nothing
downstream can see the absence until evaluation.

### 2.2 Reading a possibly absent value

| Read | Static type | Comment |
| --- | --- | --- |
| `xs[i]`, `xs: list<string>`, `i: integer` | `missing \| string` | not proved in range |
| `xs[2]`, `xs: list<string>` (declared, no length) | `missing \| string` | the declared type carries no length |
| `["a", "b"][2]` | `string` | literal list, literal index |
| `xs[2]`, `xs: list<string^3>` | `string` | declared length proves the position |

This is the behavior the 2026-10-20 plan describes and it is sound. It is
also why strict diagnostics bite: with a declared list of unknown length,
every indexed read is possibly absent.

### 2.3 A possibly absent argument at a parameter that excludes absence (Q3)

Three different rules apply today, by the kind of callee.

**A user function** (a declared signature on the engine, or an Epsil
`function` / annotated lambda), parameter `string`:

| Argument | Boxing (engine) | Evaluation | Epsil static check |
| --- | --- | --- | --- |
| `Missing` (typed `missing`) | refused, `incompatible-type` | — | reported |
| `xs[i]` (typed `missing \| string`) | accepted; the call is typed `string` | present: computed; absent: `incompatible-type` error value | reported as an error, even for `xs[1]` when `xs` holds one element |
| `xs[i] ?? "d"` | accepted | computed | not reported |
| `xs[i] ?? RuntimeError("expected-present")` | accepted; typed `string` | present: computed; absent: `Error("expected-present")` | not reported |
| `v` after `if isMissing(v) { … } else { f(v) }` | accepted | computed | **reported**: the guard does not narrow `v` |

Source: `refusesAbsentArgument` in `src/compute-engine/boxed-expression/validate.ts`
(the static report exists only while the Epsil pre-pass runs), the
`declaredScalarConformance` runtime check in `boxed-function.ts`, and the
test `test/compute-engine/absent-argument-annotated-parameter.test.ts`.
The report is pinned by one test ("the Epsil static pre-pass reports an
argument that may be absent"). The ROADMAP entry "An absent argument at a
function parameter" records a false report of this check on the gasket
program.

**A library operator.** The operator's resolved absence behavior
(`resolvedMissingBehavior`, `boxed-operator-definition.ts`) is one of
`reject`, `propagate`, `handle`, or `pass-through`. Only 73 of 655 operators
declare one. `propagate` is resolved for a declared signature whose
parameters are all numeric, collection or function typed (304 operators);
everything else resolves to `pass-through` (278 operators), which means "no
rule: the handler receives the absent value". Measured with a symbol typed
`T | missing` holding `Missing` at the first parameter (one argument only,
so multi-parameter operators that need a second argument were refused for
arity and are not counted):

| Resolved behavior | What happens with the absent argument |
| --- | --- |
| `propagate` (numeric and collection operators) | 194 answer the absence marker of their result (`NaN` for a number, `Missing` otherwise) |
| `handle` (declared: reducers, logic, `At`, `Coalesce`, …) | 24 answer the marker, 3 an error value, 1 a value |
| `pass-through`, string operators (`ToUpperCase`, `Trim`, `StringJoin`, `Characters`, …, 43 operators) | an `incompatible-type` error value at evaluation |
| `pass-through`, 24 operators (`Parse`, `IsSquareMatrix`, `PolynomialDegree`, `TruthTable`, …) | compute a value from the absent argument as if it were data |
| `pass-through`, 21 symbolic operators (`Integrate`, `Derivative`, `ForAll`, `Exists`, …) | stay unevaluated |
| `pass-through`, `If` / `Which` / `When` | an error value: "The condition is absent (`Missing`). Discharge absence with `Coalesce()` or `IsMissing()` before branching" |

So for a parameter that excludes absence there is no default: the answer
depends on which handler was written when. The plan's rule 5 ("an
unannotated or `any` parameter that receives absence needs the same defined
semantics; defaults should be centralized") is not implemented for the
`pass-through` class. The Epsil static check does not report a possibly
absent argument at a library parameter, only at a user function's.

### 2.4 Fallback and the failing-fallback idiom

| Expression | Type | Evaluation | Compiled (JavaScript) |
| --- | --- | --- | --- |
| `xs[i] ?? "d"` | `string` | the element or `"d"` | compiled |
| `xs[i] ?? RuntimeError("expected-present")` | `string` (corrected 2026-10-20) | the element, or `Error("expected-present")` | not compiled: `RuntimeError` has no JavaScript lowering, the whole expression falls back to the interpreter |
| `IsMissing(NaN)`, `IsMissing(Indeterminate)` | `boolean` | `True`, `True` | compiled |
| `Nothing ?? 5` | — | `Nothing` passes through | compiled only when the operand type excludes `nothing` |

The idiom works in the interpreter and is the only way to say "fail if
absent" today. It is verbose, the error code is the author's to invent, and
it does not compile.

### 2.5 The proposed spelling `?!`

- The Epsil lexer scans a maximal run of operator characters into one token,
  so `?!` is already one `OPERATOR` token, and U+2048 `⁈` is mapped to `?!`
  by the character table (`src/epsil/characters.ts`). The parser gives the
  token no meaning: `xs[i]?!` and `3⁈` report `unexpected-symbol`.
- The same maximal munch applies to the factorial today: `3!+1` and `3!^2`
  are `unexpected-symbol` (`!+`, `!^`), `3! + 1` is `7`. A postfix `?!`
  inherits this: `x?!+1` is the token `?!+`; `x?! + 1` is the form to write.
  This is an existing convention, not a new restriction.
- Postfix operators are parsed in one place (`parser.ts`, the postfix loop
  before `peekInfix`), from one table (`src/epsil/operators.ts`, kind
  `postfix`, `Factorial` at precedence 110). Serialization of a postfix
  operator parenthesizes a lower-precedence operand (`(√x)!`) and never
  glues two postfix spellings (`(n!)!`, never `n!!`).
- No LaTeX spelling exists for `Coalesce`, `IsMissing` or an assertion. A
  LaTeX document cannot write the absent case out; that is why the engine
  defers the check to evaluation.

### 2.6 Where absence can be discharged statically today

`??` removes the absent case from the type (section 2.4). Nothing else does:
an `isMissing(v)` test in an `if` does not narrow `v` in either branch, and
a declared length is the only proof a read is in range. The pre-pass
therefore reports correct programs that test before they call.

## 3. Conflicts

- **C1. Epsil and the engine disagree on `let s: string = Missing`.** The
  static check reports it as an error, the runtime binds it. One of the two
  is wrong under any rule.
- **C2. A declared type is a promise the reader cannot trust.** `s: string`
  reports `string` while holding `Missing`. The plan's rule 4 requires that
  a known absence not disappear from analysis merely because the declared
  contract says `string`. Today it disappears.
- **C3. A declared element contract is not checked.** `xs: list<string>`
  accepts `["a", Missing]`. This is the open ROADMAP item "A declared
  collection accepts an assigned value that is not of its type" and the
  cell-level form of C2.
- **C4. The strict static report has no escape.** The pre-pass reports
  `f(xs[i])` at an annotated parameter even when the author has tested
  `isMissing` first, and the only accepted discharge is `??`, which forces an
  invented value or the verbose `RuntimeError` idiom. The plan's
  recommendation was to provide a checked assertion and basic proofs before
  making possible absence a hard diagnostic. The order was reversed.
- **C5. Library operators have no default for an absent argument.** The
  `pass-through` class answers an error value, a computed value, or stays
  inert depending on the handler (section 2.3). Rule 5 asks for one
  centralized default with explicit exceptions.
- **C6. Two different rules for the same situation.** A possibly absent
  argument at a user function's `string` parameter is reported statically
  in Epsil; the same argument at `Trim(…)` is not, and both answer an
  `incompatible-type` error value at evaluation.
- **C7. The failing-fallback idiom does not compile.** `RuntimeError` has no
  JavaScript lowering, so a program that uses the recommended "fail if
  absent" form loses compilation of the enclosing expression.
- **C8. The motivating case of the 2026-09-09 strip has moved.** A numeric
  restriction now types `integer | nan`, which needs no strip. What the
  strip still admits is exactly the set of values a strict contract would
  refuse: a bare `Missing`, `Undefined`, and a restricted non-numeric value.

## 4. Recommended rules, in plain language

- **R1. A declared type is a contract on every value the symbol takes.**
  `s: string` refuses `Missing` and `Undefined` as it refuses `5`. An author
  who wants absence writes it: `s: string | missing`. A `number`
  declaration still admits `NaN`, because `nan` is part of `number`; `real`,
  `integer` and `complex` refuse it, as they did before. The same holds for a
  declared collection: `xs: list<string>` refuses `["a", Missing]`; write
  `list<string | missing>`, or a bare `list` / `list<unknown>` that refines
  from the value (decisions D2 and D3 of 2026-10-21). The Epsil static check
  and both runtimes give the same answer.
- **R2. A read of a declared symbol can trust the declaration.** Under R1,
  `s` typed `string` holds a string. No separate presence tracking is
  needed for declared symbols. Inferred types keep their `T | missing`
  member as today.
- **R3. One default for an absent argument at a library parameter that
  excludes absence: refuse it.** The answer is the `incompatible-type` error
  value user functions already give. Operators that own their absence
  semantics keep declaring `handle`; numeric and collection operators keep
  `propagate`; operators that hold their operands symbolically
  (`Integrate`, `ForAll`, …) are exempt because they do not evaluate the
  operand. Computing a value from `Missing` as if it were data (the 24
  `pass-through` operators of section 2.3) stops.
- **R4. A possibly absent argument is a runtime check in the engine and a
  static report in Epsil, with the same discharges on both sides.** The
  engine keeps admitting `T | missing` at `T` and checking at evaluation,
  because a LaTeX document cannot write a discharge. Epsil reports it, at a
  user function and at a library parameter alike, once the author has three
  ways to discharge it: a fallback (`??`), an assertion (`?!`), or a guard
  (`isMissing`) that narrows.
- **R5. The presence assertion `x?!`.** Evaluates `x` once; returns it
  unchanged when present; produces a runtime error when absent (`Missing`,
  `Undefined`, `NaN`, `Indeterminate`); passes `Nothing` through; propagates
  an error operand. Its type is `Present(T)`. It is a checked operation: a
  compiler removes the check only when the static type already excludes
  absence, and a target that cannot raise declines. It checks the whole
  value only, never nested cells.
- **R6. A guard narrows.** In the branch of `if isMissing(v) { … } else
  { … }` where `v` is known present, and after `if isMissing(v) { return … }`
  in the rest of the block, `v` is typed `Present(T)` for the static check.
  The interpreter needs no change: the check is already deferred there.

Developer-visible examples under R1 to R6, Epsil:

```text
let s: string = Missing            error: a string declaration refuses an absent value
let s: string | missing = Missing  fine
let xs: list<string> = ["a", Missing]   error; write list<string | missing> or let xs = [...]
let n: number = 3 {a > 0}          fine: a numeric restriction masks to NaN, a number

function f(p: string) { p }
f(xs[i])                 reported: xs[i] may be absent
f(xs[i] ?? "d")          fine, replaces the absent datum
f(xs[i]?!)               fine; fails at run time with `expected-present` when absent
if isMissing(xs[i]) { "none" } else { f(xs[i]) }   fine (guard narrows)

trim(xs[i])              reported, same rule as f (today: silent, error value at run time)
xs[i] + 1                fine: a numeric parameter reads absence as NaN
Nothing?!                Nothing
NaN?!, (0/0)?!           runtime error
(n!)?!                   assertion on a factorial; serialized with the parentheses
x?! + 1                  the space before `+` is required, as in `3! + 1`
```

## 5. Decisions for the user

Each decision names what is recommended and what saying no means.

### P1. What does `s: T` promise about absence? (Q1)

Situation: today `ce.declare('s', 'string'); ce.assign('s', Missing)` binds
and `s` keeps reporting `string`; Epsil's static check reports the same
statement and its runtime binds it (C1, C2).

- **(a) Strict contract (recommended, rule R1).** Assigning `Missing` or
  `Undefined` to a declaration that excludes absence is a type error, on
  the engine and in Epsil, statically and at run time. The 2026-09-09 rule
  in `docs/ERROR-MODEL.md` is reversed. A restricted non-numeric value such
  as `(1, 2) {a > 0}` (typed `missing | tuple<integer, integer>`) needs a
  declaration `tuple<number, number> | missing` or a fallback. Known cost:
  three test files assign `Missing` to a declared symbol
  (`absence-discharge.test.ts` declares `text: string` in one row,
  `absent-point-arithmetic.test.ts`, `tycho-row376-any-tuple.test.ts`),
  plus the error-model prose. Tycho's source does not assign `Missing` to a
  declared symbol (checked 2026-10-21).
- **(b) Success contract with tracked presence.** Keep admitting `Missing`,
  and make a read of the symbol report the absence (a computed type or a
  separate presence flag every consumer must read). New machinery with no
  user benefit over (a) beyond not having to write `| missing`.
- **(c) Status quo.** C1 and C2 stay; the Epsil static report on
  `let s: string = Missing` is then a false positive and should be removed.

If nothing is decided: the status quo, with the Epsil/runtime disagreement.

### P1b. Is a declared element contract checked on assignment?

Situation: `xs: list<string> := ["a", Missing]` is accepted (C3).

- **Yes (recommended).** The value's type `list<string | missing>` is
  checked against the declaration as any other value is; refused. The
  refining forms (`list`, `list<unknown>`) are unaffected. This closes the
  ROADMAP item "A declared collection accepts an assigned value that is not
  of its type".
- **No.** The declaration stays a success contract for cells; readers of
  `xs[i]` see `missing | string` anyway, so the practical cost is smaller
  than P1's; but `Count(xs)` style operations and compiled code read the
  declared element type as proof.

If nothing is decided: the item stays open in ROADMAP.

### P2. What does a library operator do with an absent argument at a parameter that excludes absence?

Situation: no default; 43 string operators answer an error value, 24
operators compute from `Missing`, `If` answers a dedicated error (section
2.3, C5).

- **(a) Refuse, uniformly (recommended, rule R3).** The resolved default for
  a declared non-numeric, non-collection parameter becomes `reject`,
  answering the `incompatible-type` error value. Exceptions stay explicit:
  declared `handle`, resolved `propagate`, and operators that hold their
  operands. The 24 "compute from Missing" operators change behavior; each
  is listed in the implementation slice and checked.
- **(b) Propagate the result's marker.** `Trim(Missing)` would be `Missing`.
  Silent, and different from what a user function does with the same
  argument.
- **(c) Status quo**, per handler.

If nothing is decided: (c).

### P3. When is a possibly absent argument a static diagnostic in Epsil?

Situation: reported at a user function's annotated parameter only, as an
error, before any assertion or narrowing exists (C4, C6). The engine
defers to evaluation and must keep doing so for LaTeX input.

- **(a) Keep the error, extend it to library parameters, ship the
  discharges first (recommended, rule R4).** Order: the assertion (S1) and
  guard narrowing (S3) land; then the report covers library operators
  whose parameter excludes absence (S6), measured on the Epsil test corpus
  and the Tycho repro programs before it is enabled.
- **(b) Downgrade the existing report to a warning** until S1 and S3 land,
  then (a).
- **(c) User functions only, forever.** C6 stays.

If nothing is decided: (c), with the C4 false reports on guarded code until
S3 lands (S3 is a linter defect fix and needs no decision).

### P4. The assertion: spelling, name, error code

Situation: `?!` is proposed, lexes as one token, parses as nothing (section
2.5).

- **Spelling (recommended): postfix `?!`, alias `⁈`**, precedence 110 like
  `!`, must abut its operand, a space before a following operator as for
  `!`. Alternatives: a named function only (`assertPresent(x)`), or a
  different glyph.
- **MathJSON name (recommended): `AssertPresent`**, a lazy unary operator
  with `missingBehavior: 'handle'`. Alternatives considered: `Present`
  (reads as a predicate), `Require` (too generic), `Unwrap` (names a
  representation Epsil does not have). Epsil also accepts the function
  spelling `assertPresent(x)` through the usual library-name mapping.
- **Error code (recommended): `expected-present`**, with the operand's
  source text as the error's detail, matching the idiom the 2026-10-20 plan
  used.

If nothing is decided: no assertion; the `RuntimeError` idiom remains the
only "fail if absent", and it does not compile.

### P5. Compiled assertion on a target that cannot raise

JavaScript and Python can throw; GLSL and WGSL cannot.

- **(a) Decline (recommended).** A shader program with an unproved `?!`
  does not compile; the author discharges with `??` or proves the position.
  This is the fail-closed stance the compile targets already take for an
  absent datum they cannot represent.
- **(b) Compile as the identity** on those targets, trusting the author.
  This is the "unchecked assertion" the plan rejected.

If nothing is decided: (a).

## 6. Implementation details (not decisions)

- `AssertPresent` lives in `src/compute-engine/library/core.ts` beside
  `Coalesce` and `IsMissing`, lazy with a `canonical` handler (the
  lazy-operator trap), `selectsOperands: false` (an error operand
  propagates), type `presentType(op.type)` from
  `src/common/type/coalesce.ts`, evaluation through `isMissingValue`
  (`boxed-expression/type-guards.ts`).
- Epsil: one row in `src/epsil/operators.ts` (`AssertPresent`, `?!`,
  postfix, 110); the postfix loop in `parser.ts` needs no change; the
  serializer's postfix branch already parenthesizes lower-precedence
  operands and must also parenthesize a postfix operand (`(n!)?!`,
  `(x?!)!`) because the lexer would merge the spellings.
  `library-names.ts` maps `assertPresent`.
- The static check: `refusesAbsentArgument` stays the rule; the pre-pass
  accepts an argument whose type is `Present(T)`, which `AssertPresent`'s
  type handler gives it. Guard narrowing (S3) is a pre-pass concern:
  `canonicalizationDiagnostics` boxes statement by statement; narrowing a
  symbol inside a block needs the branch structure, which the Epsil AST has
  before lowering. The engine's `If` evaluation needs nothing.
- Compilation: `base-compiler.ts` already classifies the absence axis of a
  type for `Coalesce` (`absenceAxisForType`); `AssertPresent` compiles to
  the same test followed by a raise on the JavaScript and Python targets,
  and the check is omitted when the compilation type has no absence axis
  (static proof). Targets without a raise decline (P5a).
- P1: `matchesDeclaredTypeAxes` (`effects-inference.ts`) drops the
  `missing` strip; the `never` carve-out for a callable declaration becomes
  moot. Epsil's `declaredTypeMismatch` already reports the literal case;
  the runtime `Declare` path then agrees. ERROR-MODEL's 2026-09-09 entry is
  rewritten as a decision record pointing here.
- P2: `resolvedMissingBehavior` resolves `reject` instead of `pass-through`
  for a declared signature whose first-position parameter type excludes
  absence and is not a collection, function or `expression`, unless the
  definition is `lazy` or holds its operands. The behavior gate in
  `boxed-function.ts` already implements `reject` (it answers
  `unexpected-argument`; for consistency with user functions it should
  answer `incompatible-type` naming the parameter type).

## 7. Slices and acceptance criteria

Order: S1, S3, S2 can start on P4/P5 alone. S4 needs P1/P1b. S5 needs P2.
S6 needs P3 and lands after S1 and S3.

- **S1. The assertion operator.** `AssertPresent` in the library; Epsil
  `?!`/`⁈`/`assertPresent`; serialization round trip; docs (`types.md`
  absence section, `operators.md` beside `??`, the types guide, the
  Epsil error catalogue entry for `expected-present`).
  Acceptance: `f(xs[i]?!)` has no static report and runs; `xs[5]?!` is
  `Error("expected-present")` with the operand named; `NaN?!` and
  `(0/0)?!` are errors; `Nothing?!` is `Nothing`; `Error(…)?!` propagates
  the error; the type of `xs[i]?!` is `string`, of `n?!` with `n: number`
  is `number` without `nan`; `(n!)?!` and `(x?!)!` round trip through the
  serializer; `x?!+1` is diagnosed as `3!+1` is today.
- **S2. Compiled assertion.** JavaScript and Python lower it; GLSL/WGSL
  decline unless the type excludes absence; the check is omitted under a
  static proof.
  Acceptance: `compile(xs[i]?! , javascript)` throws at an absent index and
  returns the element otherwise; the same program with `xs: list<string^3>`
  and a literal index compiles with no check; a WGSL compile of an unproved
  assertion is declined with a message naming `AssertPresent`.
- **S3. Guard narrowing in the Epsil static check.** `isMissing(v)` and
  `!isMissing(v)` conditions narrow `v` in the corresponding branch and
  after an early return.
  Acceptance: the two programs of C4 produce no report; a program that uses
  `v` in the absent branch at a strict parameter is still reported; the
  ROADMAP gasket false report is re-measured (fixed or still open, stated).
- **S4. Strict declared contracts (P1, P1b).** Engine assignment, Epsil
  runtime and static check agree; ERROR-MODEL and the types guide updated;
  the three test files adjusted to declare `| missing` where they mean it.
  Acceptance: `s: string := Missing` is refused on both routes with the
  same message shape as `s := 5`; `s: string | missing := Missing` binds;
  `n: number := 3 {a > 0}` binds (numeric restriction); `xs: list<string>
  := ["a", Missing]` is refused; `xs: list := ["a", Missing]` refines to
  `list<string | missing>`; full suite measured and the changed tests
  listed.
- **S5. One default for an absent argument at a library parameter (P2).**
  Acceptance: the inventory of section 2.3 rerun shows no `pass-through`
  operator computing a value from `Missing` and no handler-specific error
  text where the default applies; each of the 24 operators whose answer
  changes is listed with its before/after; operators that hold operands are
  unchanged.
- **S6. The static report at library parameters (P3a).** Acceptance: the
  Epsil test corpus and the Tycho repro programs are run with the report
  enabled; every new report is either a true possibly absent argument or a
  defect fixed before the slice lands; the count is stated.

## 8. Residues this analysis does not settle

- The accessor proofs (`First(Rest(xs))`, a declared list that is known not
  empty) stay as the ROADMAP entry "An absent argument at a function
  parameter" records them; `?!` is the author's tool until a proof exists.
- `Undefined` has no type of its own (it is typed `unknown`), so a strict
  contract refuses it only through the value check, never statically.
- Record-field omission (Q5/Q6) decides what `rm: record := {a: Missing}`
  means; P1b covers lists and tuples only.

## 9. Implementation record (2026-10-21)

Decisions taken by the user: P1 (a) strict declared contract; P1b yes; P2 (a)
refuse uniformly; P3 (a) keep the error and extend it to library parameters
once the discharges exist; P4 postfix `?!`, alias `⁈`, MathJSON
`AssertPresent`, error code `expected-present`; P5 (b) in the safe form: on a
target that cannot raise the assertion compiles as the identity and is not
read as a proof, so a later absence test on the value keeps its own rule.

What landed, by slice:

- **S1.** `AssertPresent` in `src/compute-engine/library/core.ts` (lazy,
  `handle`, type `presentType(operand)`, evaluation through
  `isMissingValue`); the `?!` row in `src/epsil/operators.ts` (postfix, 110);
  `peekPostfix` in `parser.ts` reads a fancy glyph (`⁈`) in postfix position
  as the parser already did in infix position; the serializer needed nothing
  (`(n!)?!`, `(x?!)!`). There is no lowercase `assertPresent` spelling: the
  naming rule gives none to an operator with a symbol (`coalesce` has none);
  the function form is `AssertPresent(x)`. The plan's section 6 said
  otherwise; this record corrects it.
- **S2.** A `raise` entry in the compile target's absence capability
  (`compilation/types.ts`), supplied by the JavaScript target (an arrow
  function that throws) and the Python target (the generator-throw idiom
  the target already used). `base-compiler.ts` lowers `AssertPresent` as the
  target's `coalesce` with the raise as the fallback, omits the check when
  the compilation type has no `missing` member and admits no `nan`, and
  compiles the identity on a target without `raise`. `AssertPresent` is in
  the named-lowering set and in the input walk beside `Coalesce` and
  `IsMissing`.
- **S3.** `src/epsil/presence-narrowing.ts`: for the static check only, a
  read of a symbol in a region an `isMissing` test proves present is wrapped
  in `AssertPresent` before the statement is boxed
  (`canonicalizationDiagnostics`, `static-diagnostics.ts`). Regions: the
  else arm of `If(IsMissing(v), …)`, the then arm of `If(Not(IsMissing(v)),
  …)`, the later operands of `And` after `Not(IsMissing(v))` and of `Or` after
  `IsMissing(v)`. A reassignment ends the region; a function literal is not
  entered; binding positions and the operand of `IsMissing`/`Coalesce`/
  `AssertPresent` are not wrapped. `if let v: !missing = …` already narrowed.
- **S4.** `matchesDeclaredTypeAxes` (`effects-inference.ts`) no longer strips
  the value's `missing` member, and refuses the absence symbols `Missing` and
  `Undefined` (typed `unknown`) at a declaration that does not admit
  `missing`. `declaredTypeMismatch` (`static-diagnostics.ts`) treats a list,
  tuple or set literal of closed literals as closed, so `let xs: list<string>
  = ["a", Missing]` is reported statically, and reports a possibly absent
  initializer at a declaration that excludes absence. The `presentedValueType`
  of the assumption check is unchanged. Added 2026-10-22: the same report for
  a `nan` arm at a declaration that does not admit `nan` (`let r: real =
  zs[i]`, typed `nan | real`), when every other arm of the value fits the
  declaration; the run time already refused that value. `let r: real = a / b`
  (`infinity | nan | real`) overlaps the declaration and is not reported.
- **S5.** `refusesAbsentOperandAt(i)` and `declaredParameterTypeAt(i)` on the
  operator definition (`boxed-operator-definition.ts`, mirrored in
  `types-definitions.ts` and `types-expression.ts`); both evaluation gates in
  `boxed-function.ts` (the synchronous one and its asynchronous twin) answer
  `incompatible-type` naming the parameter for a `pass-through` operator at
  such a position. The declared `reject` keeps its `unexpected-argument`
  message.
- **S6.** `refusesAbsentArgument` (`validate.ts`) takes the operand index and
  the box route's `refusesAbsentAt` (three sites in `box.ts`), so the Epsil
  static check reports a possibly absent argument at a library parameter on
  the terms of S5.

Measurements (worktree on `119beb329`):

- The library inventory of section 2.3 rerun after S5, one `T | missing`
  argument holding `Missing` at the first parameter of each operator with a
  declared signature (623 operators): `pass-through` operators answering an
  error value 43 → 63; computing a value from the marker 24 → 12; answering
  the marker 17 → 10; inert 21 → 20. The 12 that still compute are
  `Signature`, `Wildcard`, `WildcardSequence`, `WildcardOptionalSequence`,
  `DeclareProtocol` (a `symbol` parameter, read as a form), `Condition`
  (`expression`), and `TrigExpand`, `TrigToExp`, `TrigReduce`,
  `PolynomialDegree`, `CoefficientList`, `PolynomialRoots` (operators that
  hold their operands). The 10 that still answer the marker are `Expand`,
  `ExpandAll`, `Factor`, `Together`, `Distribute`, `Cancel`,
  `PartialFraction`, `Apart` (`lazy`), `Matrix` and `BuiltinFunction`. The
  numeric and collection operators (`propagate`, 194) and the declared
  `handle` operators are unchanged.
- The gasket program of the ROADMAP entry "An absent argument at a function
  parameter" runs with no diagnostic before and after this work: that false
  report was fixed by an earlier change.
- Test files added: `test/compute-engine/assert-present.test.ts`,
  `test/epsil/assert-present.test.ts`, `test/epsil/presence-narrowing.test.ts`,
  `test/compute-engine/declared-contract-presence.test.ts`,
  `test/compute-engine/absent-argument-library-default.test.ts`. One existing
  test changed: `absence-discharge.test.ts` (the `text: string` row now
  expects the assignment of `Missing` to be refused). The full-suite
  comparison against the clean-HEAD baseline is in the delivery report.

Dual review (Claude and Codex, 2026-10-21): 11 findings, all applied. The
three both reviewers found: the binder rule of the narrowing read the wrong
operand (`Loop`, `Comprehension`, `Sum`, `Product` put the body first and
the binder in an `Element`/`Limits` clause); the Python object-axis
`coalesce` repeated its operand, so the compiled assertion and `Coalesce`
evaluated it twice; the static report of a possibly absent initializer
exempted numeric declarations, which hid `let n: number = m` with `m:
number | missing`. The others: the library refusal fired at boxing on every
route for a `missing`-typed symbol (now a static-check report only; the
evaluation gate refuses at run time); a loop back edge kept a proof past a
reassignment; a guard inside a function literal was not narrowed; a
collection with a symbolic cell kept the assertion unevaluated (`Length([x,
1]?!)` did not reduce; `Coalesce` had the same rule and now returns such a
value too); a message quoted `v?!` the author did not write; the right side
of `v := f(v)` lost its proof; the interval JavaScript target had no `raise`
(it now raises, and its `run()` converts the throw into the `entire`
interval as it does every error); two comment and indentation nits. Full
suite after the fixes: see the delivery report.

