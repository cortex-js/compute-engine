# Arbitrary constants: the parameter of a family of roots and the constant of integration

Status: revision 2. The direction is the user's (2026-11-12), and the
choices A1 to A7 of section 8 were APPROVED by the user on 2026-11-12
(revision 2 followed a review by two reviewers; section 11). No code is
written. The implementation starts after step 1 of the bound-once spec is
on main (session `compute-engine-06` sends the hash), and after the two
measurements of section 9, whose results are in section 12.

It takes over one test case of the temporary-symbol spec
(`2026-11-12-fresh-symbol-spec.md`, E2): the names made by
`freshParameters()` and by `integrationConstants()`. A name that a result
shows to the user must print and be read again, so it cannot be a
temporary symbol. The other generated names of the solvers
(`freshSymbolName()`: `dsolveroot`, `dsolvep`, …) are internal and stay
with that spec (its E6).

Sources: the engine at `7305ef84b8e97bf25bc97dbcdaef2e6e48d81772`. The
results marked "run" were run on it, with the two operators declared by
hand (`ce.declare('ArbitraryConstant', { signature: '(integer) -> number' })`,
and `(integer) -> integer` for `ArbitraryInteger`).

## 1. Today

- `Solve(sin x = 0, x)` is `[π t]` (run). The parameter comes from
  `freshParameters()` (`boxed-expression/diophantine.ts:328`, 10 calls in
  `solve-domain.ts`, `solve-congruence.ts`, `solve-system.ts`,
  `diophantine.ts`). It tries `t`, `t_1`, …; skips a name of the
  equation, a name that the user declared or used, a name with a value or
  under an assumption; DECLARES the name with the type `integer` in the
  global scope (after the solve, `ce.assign('t', 0.5)` throws: run); and
  keeps its definitions in a `WeakSet` to use them again. After
  `ce.parse('t+1')` the same solve is `[π t_1]` (run). The code of the
  families works on records (`RootFamily`: a root and a spacing) and
  makes the parameter last, in `familyExpression()`
  (`solve-domain.ts:3981`); it does not read the parameter back.
- A differential equation or a recurrence gets `c_1`, `c_2`, … from
  `integrationConstants()` (`symbolic/solver-utils.ts:26`, 18 calls in
  `differential-equations.ts`, 1 in `recurrences.ts`). It skips a name of
  the equation and a name with a definition that is not inferred, and
  declares nothing. Three sites then find the constants by the pattern
  `/^c_\d+$/` and solve or substitute by name: the initial conditions of a
  differential equation (`differential-equations.ts:1711`), those of a
  recurrence (`recurrences.ts:220`), and `symbolic/interpret.ts:593`.

So a solve writes in the scope of the user, the result depends on what was
boxed before, and the tests that keep a parameter apart from a symbol of
the user are a loop of their own.

## 2. The rule

Two operators of the standard library:

| Operator | Type | Stands for |
|---|---|---|
| `["ArbitraryConstant", k]` | `(integer) -> number` | any number: a constant of integration, the free parameter of an identity (`x = x`) |
| `["ArbitraryInteger", k]` | `(integer) -> integer` | any integer: the parameter of a family of roots, of a diophantine or a congruence solution |

1. **The index.** After the canonical form, the operand is an integer
   literal `k ≥ 1`. Any other call (`Z(0)`, `Z(-1)`, `Z(x)`, no operand,
   two operands) is an error of the canonical form, by a handler of the
   operator: the signature alone accepts them (run: `Z(-1)` is valid
   with the declaration). `Z(1 + 1)` is `Z(2)`.
2. The operators have no value: `evaluate()` and `N()` leave a call as it
   is. A call is pure and constant. No target has a lowering.
3. **Inside one result, two calls with the same index are the same value,
   and two calls with different indexes are independent**: nothing is
   known of their equality.
4. **The indexes are given for one public operation.** One evaluation of
   `Solve`, `DSolve` or `RSolve` has one set of used indexes for each
   operator. It starts with the indexes that occur in the input as the
   solver works on it: every operand, the conditions included, after the
   values of the names it reads are put in. Every part of the operation
   that needs a constant, a solver called inside it included, takes the
   smallest index that is not in the set, and adds it. A strategy that
   fails gives its indexes back.
5. The families of one list of solutions share one parameter, as today
   (`[π/6 + 2π·Z(1), 5π/6 + 2π·Z(1)]`): each member of the list is a set
   of solutions of its own. The components of one solution share an index
   only when one parameter gives both (`(Z(1), 1 − Z(1))`).
6. Nothing is declared, in any scope, and no definition is read to choose
   an index.

**The limit of rule 3.** Two results of two operations both use the index
1 (rule 4). An expression that combines them identifies their constants:
`r1 − r2` is `0`, in a host, in a `Map` over a list of equations, in an
Epsil program. It is what the engine does today, where every solve of an
engine uses `t`. The reference page of the operators states it, with the
remedy: replace the indexes of one result first. The engine does not
renumber (choice A4).

## 3. Examples

"Today" and the rows marked "run" are run. The other "proposed" values are
derived. `C` is `ArbitraryConstant`, `Z` is `ArbitraryInteger`.

| # | Program | Today | Proposed |
|---|---|---|---|
| 1 | `Solve(sin x = 0, x)` | `[π t]`, and `t: integer` is declared | `["List", ["Multiply", "Pi", ["ArbitraryInteger", 1]]]`, nothing declared |
| 2 | `ce.parse('t+1')`, then row 1 | `[π t_1]` | the same as row 1 |
| 3 | `y' = y` | `y = c_1 e^x` (run) | `y = C(1)·e^x` |
| 4 | `y'' = y` | `c_1 e^x + c_2 e^{-x}` | indexes 1 and 2 |
| 5 | `C(1) − C(1)`, simplified | | `0` (run) |
| 6 | `C(1) − C(2)`, simplified | | stays (run) |
| 7 | `C(1).isEqual(C(2))`; `C(1).isEqual(C(1))` | | `undefined`; `true` (run) |
| 8 | `D(C(1)·x + C(2), x)` | | `C(1)` (run) |
| 9 | `Integrate(C(1)·x, x)` | | `½·C(1)·x²` (run) |
| 10 | `sin(π·Z(1))`, simplified | | `0` (run: the type `integer` is enough) |
| 11 | `(π·Z(1)).replace({ match: Z(1), replace: 3 }, { recursive: true })`, evaluated | `(π t).subs({ t: 2 })` is `2π` (run) | `3π` (run) |
| 12 | `unknowns` of a family | `["t"]` for `π t` (run) | no constant: `(x·Z(1)).unknowns` is `["x"]` (run) |
| 13 | `compile(π·Z(1) + 1)` | `Math.PI * _.t + 1`, `t` is an input (run) | declines, `unsupported: ["ArbitraryInteger"]` (run); the host replaces the constant first (row 11) |
| 14 | a second solve whose input holds `Z(1)` | | its new parameter is `Z(2)` (rule 4) |
| 15 | `r1 − r2` for two results of row 1 | `0` (run) | `0`: both use the index 1 |
| 16 | `a := π·Z(1)`; `Solve(sin(x − a) = 0, x)` | | the parameter is `Z(2)`: the input as the solver works on it holds `Z(1)` |
| 17 | `b := C(1)`; `y' = b·y` | | the constant is `C(2)`: `C(2)·e^{C(1)·x}` |
| 18 | `y' = y`, `y(0) = 2`; a recurrence with its initial values | `2e^x` | the same: no constant in the result |
| 19 | `Solve(x = C(1), x ∈ 1..5)` | with a free symbol in place of `C(1)`: not decided | not decided (with the declaration alone it is `[]`: run by a reviewer; section 5) |
| 20 | `Z(0)`, `Z(-1)`, `Z(x)`, `Z()`, `Z(1, 2)` | | each an error (rule 1) |
| 21 | `x: real`; `Solve(x = C(1) + 1, x)` | `[c_1 + 1]` for `c_1` (run) | `[C(1) + 1]`: a constant is a generic real parameter for the solver (section 12) |

## 4. What is printed

- **MathJSON** is the call, and it boxes to the same call. This is the
  form to store and to compare.
- **LaTeX (choice A3).** A call prints inside a command that adds
  nothing to what is shown and that the parser reads back as the call
  (the user's proposal, 2026-11-12): `\constant{c_{1}}` for
  `ArbitraryConstant(1)`, `\constant{n_{1}}` for `ArbitraryInteger(1)`.
  A reader sees `c_1` and `n_1`. The parser reads `\constant{c_{k}}` and
  `\constant{n_{k}}` with `k` a positive integer; any other content is
  an error. Without the command, `c_1` is the symbol of the user, as
  today. A renderer must know the command: MathLive defines it as a
  macro that shows its argument, and another renderer needs
  `\newcommand{\constant}[1]{#1}`. An editor must also write the
  command back when the user copies or edits the formula: if it writes
  the expansion `c_{1}`, the copy is the symbol of the user again. Tycho
  has its own typesetting and mathfield, not MathLive; whether its macros
  take an argument and what its mathfield writes back are not checked
  (Tycho measures it when it adopts the change). Today `\constant{c_{1}}` parses to
  an `unexpected-command` error (run), so no existing input changes.

## 5. The hard cases

- **Code that reads `unknowns` to say "nothing is left to decide".** A
  parameter was a symbol, so an expression that held one had an unknown,
  and the solver did not decide about it. A call is not in `unknowns`, so
  the same code would now decide, and can give a wrong "no solution"
  (row 19). The sites that a reviewer found in `solve-domain.ts`:
  `confirmExact()` (`:5045`, read by the author),
  `rootsCheckedByChain()` (`:1697`), `commonRoots()` (`:476`, `:497`),
  `arccosOfNonNegative()` (`:2955`) (the last three not read by the
  author). The rule: a function `hasArbitraryConstant(expr)`, and each
  test of this kind counts an expression that holds a constant as one
  that has an unknown. Every read of `unknowns` and of `freeVariables` in
  the solver files is checked against this rule in the change.
- **Initial conditions** (`differential-equations.ts:1711`,
  `recurrences.ts:220`) solve for the constants as symbols, and `Solve`
  takes symbols as unknowns. Inside `DSolve` and `RSolve` the constants
  stay the symbols they are today, made by the loop of
  `integrationConstants()` against the names of the equation; the
  operation replaces each one that is left by `C(k)` when it returns
  (choice A7). These two sites then work unchanged (row 18).
  `symbolic/interpret.ts:593` reads the constants of a RESULT of `RSolve`
  by the pattern `/^c_\d+$/`: it collects the calls by their operator
  instead.
- **Two results with the same index**: the limit of rule 3.
- **Compiled code.** A call has no lowering, so a compilation that holds
  one declines and names the operator (row 13). A decline is the wanted
  result: a constant with no value has no number. No handler is added.
- **Assumptions.** `ce.assume()` about a call is not needed for the type,
  which the operator gives. Today's test "the name is under an
  assumption" goes.
- **The sign and the range.** A solver that wants "a positive constant"
  has no way to say it; it does not today either.

## 6. What is removed, and what stays

Removed: `freshParameters()` with its loop, the `WeakSet`
`parameterDefinitions`, the declaration in the global scope, the reads of
`freeNameWasMade()` and of the assumptions, and the limitation that its
comment states (a non-canonical expression made before the solve); the
read of the definitions in `integrationConstants()`; the sentence of the
comment of `freshSymbol()` (`symbolic/series.ts:2100`) that excludes `t`.

Stays: the loop of `integrationConstants()` against the names of the
equation, for the symbols that live inside one `DSolve` or `RSolve`
(choice A7).

## 7. What changes for a user (breaking)

1. The parameter of a family of roots is `["ArbitraryInteger", k]`, not
   the symbol `t`; a constant of integration is
   `["ArbitraryConstant", k]`, not the symbol `c_k`; the free parameter
   of an identity (`x = x`) is `["ArbitraryConstant", 1]`, not `t`.
2. They are not in `unknowns`, `symbols` or `freeVariables`. A host finds
   them by their operator.
3. `r.subs({ t: 2 })` and `ce.assign('c_1', 2)` no longer reach them. The
   replacement is row 11.
4. A solve "for the parameter" (`Solve(π t = 3π, t)` on a result) needs
   that replacement first: an unknown is a symbol.
5. A solve declares nothing. `t` stays free for the user:
   `ce.assign('t', 0.5)` after a solve is accepted, and an expression in
   `t` made after a solve no longer has the type `integer`.
6. A compilation of a result with a constant declines, where it took `t`
   or `c_1` as an input (row 13).
7. The LaTeX of a family is `\pi\constant{n_{1}}`, shown as `π n_1`,
   where it was `\pi t`. A renderer without the macro `\constant`
   shows an error.
8. `Solve` and `D` with no stated variable infer it from the free names.
   A result that held `t` could make `Solve` of that result infer `t`;
   a constant is never inferred as the variable.

Each is a line of `CHANGELOG.md`, `[Unreleased]`, "Breaking changes". The
pages of `~/dev/cortexjs.io/docs/compute-engine/` to update:
`81-reference-calculus.md` (it says that the constants are "named `c_1`,
`c_2`, …" and shows eight results with them), the page that documents
`Solve` and its families, and a reference entry for the two operators
with the limit of rule 3. Each example is run before its result is
written.

## 8. Choices (approved by the user, 2026-11-12)

- **A1. The names `ArbitraryConstant` and `ArbitraryInteger`.** They say
  what the value is, not which solver made it, so a recurrence, a
  congruence and an identity use them too. Alternatives:
  `IntegrationConstant` and `SolutionConstant` (the user's first words);
  `C` (Mathematica's `C[1]`, too short for a library name here).
- **A2. Two operators.** Alternative: one operator with the type as a
  second operand (`["Arbitrary", 1, "integer"]`). It is open to any type
  and makes the type of a call depend on an operand. Recommended: two.
- **A3. LaTeX `\constant{c_{k}}` and `\constant{n_{k}}`**: a wrapper
  that shows nothing of its own and makes the LaTeX round-trip.
  Alternatives: `c_{k}` and `n_{k}` bare, which parse to a symbol of the
  user (a result copied from Tycho's notebook into a cell would be
  another expression); a visible notation such as a double-struck
  letter. Recommended: the wrapper. Its cost is one macro in each
  renderer.
- **A4. The indexes start again for each operation, and the engine does
  not renumber** (the limit of rule 3). Alternative: a counter of the
  engine, so that two results never share an index. The result would
  then depend on what the engine did before, and row 15 would not be
  `0`. Recommended: for each operation.
- **A5. One change for both families of sites**, the solvers
  (`freshParameters()`) and the differential equations and recurrences
  (`integrationConstants()`). Alternative: the solvers first.
  Recommended: one change, because the operators, the serializer and the
  documentation are shared; the count of changed tests is reported
  before it lands.
- **A6. No lowering is added for compiled code** (row 13). A host that
  compiled a family with `t` as an input replaces the constant with a
  symbol of its own first. Tycho's answer of 2026-11-12 (read from its
  source, nothing run): no Tycho code calls `Solve`, `DSolve` or `RSolve`
  in a graph document, and none compiles, plots or substitutes a result
  of one, or names `t` or `c_k`. Its notebook shows such a result and
  stores its MathJSON with the cell. It reads `freeVariables` of every
  result and reports a free name as unresolved: by that code a family
  `π t` is reported today as a result with an undefined name `t`, and
  the report goes with this change. A decline of a compilation is
  accepted.
- **A7. Inside `DSolve` and `RSolve` the constants stay symbols until
  the result.** Alternative: the calls from the start, and the code of
  the initial conditions solves for calls, which `Solve` does not do.
  Recommended: symbols inside, calls at the boundary. The cost is that
  the name loop of `integrationConstants()` stays.

## 9. To measure before the code

- The tests and snapshots that change. 69 test files name `Solve`,
  `DSolve` or `RSolve`, and 21 hold `t_1` or `c_1` (text searches, upper
  bounds of the files, not of the tests). The count of changed
  expectations is reported before the change lands.
- The reads of `unknowns` and of `freeVariables` in the solver files,
  each with its decision under the rule of section 5.

## 10. Acceptance

1. Rows 1 to 21 of section 3, as tests; row 19 for both operators. The
   programs of the table of section 12 give what a free symbol gives, or
   stay undecided; none gives `[]` or drops a root.
2. In a new engine, after a solve, a differential equation and a
   recurrence, `ce.lookupDefinition()` of `t`, `t_1`, `c_1`, `c_2` is
   `undefined`. In an engine where the user declared `t: integer` and
   assigned `c_1`, those definitions, values and types are the same
   before and after, and the results are those of the new engine.
3. The same call after `ce.parse('t + c_1')` gives the same result.
4. The MathJSON of each result boxes to an expression that `isSame()` the
   result.
5. A system with two independent families uses two indexes; a list of
   alternative families uses one (rule 5). `y''' + y = C(1)` gives the
   indexes 2, 3 and 4 (the solver of the homogeneous part sees a reduced
   equation: `differential-equations.ts:1514`). A constant that occurs
   only in a condition is counted.
6. The tests of `DSolve` and `RSolve` with initial conditions and the
   tests of `Interpret` with a recurrence pass, with no change of their
   expected values.
7. `freshParameters` and `parameterDefinitions` are not in the source.
8. The two operators are in the operator reference, with the rule of the
   indexes and the limit of rule 3, and each example of the changed
   pages was run.

## 11. What the review changed (2026-11-12)

Two reviewers, 6 and 11 findings, 5 of them on the same point. Changed:
the indexes are given for one public operation, from the input as the
solver works on it (a stored value that holds a constant, a helper that
sees a reduced equation); the rule for the code that reads `unknowns`
(a wrong "no solution" otherwise); the initial conditions and
`Interpret` (choice A7); the validation of the index needs a handler;
the limit of rule 3 is stated; breaking changes 4, 5 (the type of `t`)
and 7 (the parse); acceptance items 2, 5 and 6; what this spec takes
from E6 of the other spec (nothing). This revision was not reviewed
again.

## 12. The measurements (2026-11-12)

### The tests that pin a generated name

Measured at `3938e5938`, in a worktree, with the names renamed (`t` to
`zq`, `c_k` to `zc_k`, and the four patterns `/^c_\d+$/` with them) and the
full suite run once: **119 tests fail in 12 test files, and 51 snapshots in
2 of those files**; 90,615 tests pass. The files:
`solve-domain`, `solve-periodic-families`, `solve-nested-periodic`,
`solve-diophantine`, `solve-collection-operand`, `differential-equations`,
`recurrences`, `conditional-values`, `issue-397-small-fixes`,
`antiderivative-step-budget`, `integrate-limit-user-function-capture`,
`binding-units-infer-report` (all `.test.ts` in `test/compute-engine/`).
This counts the tests that name `t` or `c_k`. It is a lower bound of the
tests that the change touches: a test that only reads `unknowns`, or that
compiles a family, is not in it.

### The solver reads of `unknowns`, `freeVariables`, `symbols`

An audit of the 43 reads in the ten solver files, at
`2c58616b27e275e3b61a144f90eeb73ec4f73e08`, each read and classified, 13
probes run with the two operators declared by hand. 30 are safe (most test
a value after `N()`, and `N()` of a call stays a call, as for a symbol
with no value), 2 are improvements, 10 need the rule of section 5, 1 is
the question below.

The sites that need the rule (a test of "no unknown" also tests
`hasArbitraryConstant()`), with what the declaration alone gives:

| Site | Program | With the call | With a free symbol |
|---|---|---|---|
| `validateRoots`, `solve.ts:6653` | `Solve(sin x = C(1), x)`; also `√x = C(1)`, `C(1)·sin x = 1`, `sin x = Z(1)`, `cos x = cos(π·Z(1))` | `[]` | guarded families |
| `factorHasNoRoot`, `solve.ts:3198` | `Solve((x − 1)·C(1)^x = 0, x)` | `[1]` | not decided |
| `univariateRoots`, `solve.ts:5190` | `Solve((x − 1)(x − C(1)) = 0, x)` | the two roots by the quadratic formula | `[1, a]` |
| `evaluateSolveOperands`, `solve-domain.ts:818`, `:828` | `Solve([x² = 4, x ≠ Z(1)], x)` | `[2, −2]` | not decided |
| `confirmExact`, `solve-domain.ts:5045`, `:5051` | `Solve(x = C(1), x ∈ 1..5)` | `[]` | not decided |
| `rSolveBody`, `interpret.ts:593`, `:597` | every `Interpret` of a linear recurrence | declines, once `RSolve` returns calls | a closed form |
| `validateAnchor`, `interpret.ts:730` | `Interpret(1+1+2+3+5+8+…+C(1))` | 17 s, then the input | 13 ms |

The first is the case that matters: a result of an earlier solve put in a
new equation gives "no solution" for ordinary equations. `rSolveBody`
collects the calls by their operator, as section 5 says.

**After the rule, more declines than with a symbol.** The equality prover
(`compare.ts:945`, `:951`, `:1095`, `:1213`) samples the free variables of
an expression, and a call is not one: `sin(arcsin a) − a` is proved zero,
the same with `C(1)` is not decided. So a root that a symbol proves stays
guarded or undecided with a constant. No value is wrong. A prover that
samples a constant is a later change, on request.

**A constant is a generic real parameter in the solver's checks (user
decision, 2026-11-12).** `isRealForSolve()` (`solve.ts:3495`) reads a
symbol with no type as a generic real parameter, and `filterRootsByType()`
(`:6766`) keeps a guarded root when every symbol of it is real. Both read
an arbitrary constant as they read a symbol with no type. So with `x`
declared `real`, `Solve(x = C(1) + 1, x)` is `[C(1) + 1]`, as today's
`c_1` gives `[c_1 + 1]` (run); with the type `number` alone it would stay
unevaluated. The type of the operator is unchanged.

**Callers after the fact.** No caller of `freshParameters()` (10 sites) or
of `integrationConstants()` (19 sites) reads the name of what it got, or
substitutes or tests by it. Not audited: the callers of
`filterRootsByAssumptions()` and `emptyRootsAnswer()` in
`boxed-function.ts:7030` and `explain.ts`.

**A defect of today, filed as CE-1253**: the pattern `/^c_\d+$/` of the
initial conditions also takes a parameter of the user named `c_1` for a
constant of integration (`DSolve([y'' = y, y(0) = c_1, y'(0) = 0], y, x)`
gives `y = 0`). The fix (pass the names that `integrationConstants()`
returned) is made in this change, which works in the same functions.

## 13. Where the implementation differs (2026-11-12)

- **`integrationConstants()` still reads the definitions** (section 6 said
  the read goes). The symbols `c_k` that live inside one `DSolve` or
  `RSolve` are boxed in the scope of the user, so a `c_1` that the user
  declared or assigned would give its type or its value to the internal
  constant. The loop skips a name that has a definition. The name is never
  in a result: the index of the result comes from the allocator.
- **Row 17** is `C(2)·e^{b·x}`, not `C(2)·e^{C(1)·x}`: `DSolve` does not
  put the stored value of `b` in the result, and never did. The index is 2.
- **The index of a new constant is decided from the result, not from the
  input** (it replaces "seeded from the input" of rule 4, with the same
  results for the rows of section 3). During an operation a new constant
  has a provisional index, a negative number that no other constant has.
  When the outermost operation ends, the indexes in use are those of the
  result (with the stored values of the names it holds, the bodies of the
  functions it calls, dictionary values) and of the input; each provisional
  index that occurs in the result gets the smallest free index, in the
  order it was made. One that is not in the result gets none: this is how
  a failed strategy gives its index back. A scan of the input alone missed
  a constant that only an evaluation shows (a stored function that returns
  `Z(1)`), and two independent constants then got one index. A provisional
  index is an error outside the operation that made it, and a check in the
  test builds refuses a result that holds one. Known limit (`crafted`): a
  function with an effect that runs during a solve and stores the result
  of a nested solve stores a provisional index.
- The seed from the input does not read the assigned value of an unknown
  of the operation, which the solver does not read either.
- The LaTeX parser also reads `\constant{c_1}` (no braces around the
  index). A wrong content gives `unexpected-argument`.

