# Function declaration hoisting across execution routes

Date: 2026-10-21. Status: in progress. ROADMAP entries: "Function declaration
hoisting across execution routes (PLANNED)" and "The 3
`batch9-evaluation.test.ts` failures".

## The problem

Since commit `c43a44d41` (the callable-binding work, 2026-10-20), a call
resolves its head through the binding it was created with
(`callableBindingInContext`, `boxed-expression/binders.ts`). A call whose
head has no value when it is evaluated stays symbolic, keeps that binding
(`_withSameBinding`), and is resolved again each time the result is
evaluated. So a result that holds such a call changes its value when the name
is assigned later, in the same evaluation.

The three failing tests of `test/compute-engine/batch9-evaluation.test.ts`
show it: in `Sum(Block(If(k = 2, h := z ↦ 2z), h(k)), k, 1, 3)` the term
`h(1)` is evaluated while `h` has no value. The loop assigns `h` at `k = 2`,
and the final fold evaluates the accumulated `h(1) + 4 + 6` again, which now
resolves `h(1)` to `2`. The answer is `12`; the expected answer is
`10 + h(1)`.

## The two rules (decided in ROADMAP, implemented together)

1. **A sticky unresolved call, for one top-level evaluation.** The result of
   evaluating a call whose head has no value stays symbolic for the rest of
   the top-level evaluation that produced it, even when the name is assigned
   later in that evaluation (a `Sum` fold, a later statement of a nested
   block). Evaluating it again in that evaluation evaluates its operands but
   does not resolve its head. A later top-level evaluation (the next Epsil
   statement, a host `r.evaluate()`) resolves it again, as before this
   change. A `Block` that the host evaluates directly is a program, the
   counterpart of an `executeEpsil` run: each of its statements is its own
   top-level evaluation. The original, unevaluated call keeps its
   forward-reference behavior: evaluating it after the name is defined
   applies the definition, in the same top-level evaluation too.

   A first version made the mark permanent. Every `function` statement that
   the preparation step of section B does not prepare (after a `type`
   statement, a body that reads an earlier value with no static type, a
   generic function) then changed a program that answered `9`
   (`let a = g(3)`, then `function g(k) { k^2 }`, then `a`) into one that
   answered `g(3)`. With the mark scoped to the top-level evaluation, the read
   of `a` in the last statement resolves it, as before.

2. **Function declarations are available throughout their scope on every
   route; assignments take effect when they execute.** A `function` statement
   (`DefineFunction` with a `Function` literal) is installed before the first
   statement of its statement list runs. An assignment of a function literal
   (`g = (k) => …`, `let g = (k) => …`) is not.

On the Epsil sequential runner, `let a = g(3)` before
`function g(k) { k^2 }` answers `9` because `a` holds the unresolved `g(3)`
and is resolved when `a` is read by a later statement, a later top-level
evaluation. Rule 2 makes `g` available when the first statement runs, so the
value of `g(3)` is right inside the statement too (`let a = String(g(3))`).

## Where each route stands (measured 2026-10-21, probe `String(g(3))`)

The probe stores `String(g(3))` in statement 1, so the value shows when the
call was resolved.

| Route | `let a = String(g(3))`, then `function g(k) { k^2 }` | then `g = (k) => k^2` |
| --- | --- | --- |
| Whole-block interpreter (`ce.box(Block)`) | `"9"`: the `DefineFunction` canonical handler installs the clause at canonicalization, before the first statement runs (`CLAUSE_INSTALLED_AHEAD`, `library/core.ts`) | `"g(3)"` |
| Compiler (`compileBlock`) | hoists `function` statements to the front (`withDefineFunctionDeclares`, `compilation/base-compiler.ts`) | fails closed |
| Epsil runner (`executeEpsil`) | `"g(3)"`: statements are boxed one at a time, so the clause is installed only when its statement is reached | `"g(3)"` |

A `function` statement inside a function body or a loop body is installed at
canonicalization on every route (nested blocks are canonicalized as a whole).

So the declaration-preparation step is needed in the Epsil runner only. The
whole-block interpreter and the compiler keep their mechanism, and the three
routes share the rule that says which statements are declarations.

## Changes

### A. The sticky rule (`boxed-expression/boxed-function.ts`)

The engine numbers its top-level evaluations
(`boxed-expression/evaluation-epoch.ts`): `BoxedFunction.evaluate` and
`evaluateAsync` start a new number for an evaluation that is not nested in
another one. In `applyFunctionLiteralWith`, the two sites that return an
unresolved call (`evaluatedUnresolvedCall()` and the `_withParseScope`
rebuild) mark the result with the current number. The mark is a `WeakMap`
from the result to that number (`EVALUATED_UNRESOLVED_CALLS`), and a result
is sticky while its number is the current one.

The test is in `evaluate()`, just before `_canonicalToEvaluate()`, and at the
start of `_evaluateAsyncUncounted()`, after a new top-level evaluation has
started. A sticky result evaluates its operands (with the operand options)
and returns a marked copy with the same binding; it does not read the
callee, does not look for an operator definition, does not report
`read-before-declaration`, and is not boxed again against a later definition
of the name (`_reboxedForCallee()` revalidates the arguments against the new
definition: with `g` declared as a `function`, a stored `g(3)` read after
`g` received a function of a string returned an `incompatible-type` error).

The original call is never marked: the `h(k)` of a `Sum` body is one node,
evaluated at each `k`, and it must resolve at `k = 2` after the assignment at
`k = 2`. Its result is a copy of it. To avoid a new copy (and a rebuild of
each parent that compares the identity of its operands) at each evaluation,
`UNRESOLVED_CALL_RESULTS` keeps, for each original, the last copy with its
number and operands, and returns it again in the same top-level evaluation
when the operands are the same objects. A copy of an earlier evaluation is
not reused: a stored value can hold it, and it keeps its own number. A
rebuilt expression (`subs`, a canonical rebuild of a parent) is not marked
and resolves as before.

**Program blocks.** The `Block` evaluate handlers (`evaluateBlock`,
`evaluateBlockAsync`, `library/control-structures.ts`) treat a block that the
host evaluates directly as a program (`runsAsProgram()`): on the synchronous
route, the block is the outermost evaluation and no asynchronous evaluation
is pending; on the asynchronous route, the depth is 0 and the block is the
only pending asynchronous evaluation; and no `executeEpsil` run is in
progress (a top-level `do` statement of an Epsil program is a nested
block). A block that is not canonical (boxed with `{ form: 'raw' }` or
`{ form: 'structural' }`) is evaluated by its canonical form, one
evaluation deeper, so the outermost evaluation is not always at depth 1.
Each such delegation raises a count (`_delegatedEvaluations` while the
synchronous delegation runs, `_delegatedAsyncEvaluations` until the
asynchronous one settles; `delegateEvaluation()`,
`delegateEvaluationAsync()`, `boxed-function.ts`), and the test is that
the depth (the in-flight count on the asynchronous route) is 1 plus that
count. The statement runners (`evaluateStatements`,
`evaluateStatementsAsync`, `function-utils.ts`) take a `program` parameter,
and start a new top-level evaluation before each statement after the first.
On the synchronous route the new number is taken only while no
asynchronous evaluation is pending: a statement can start an
`evaluateAsync()` that it does not await, and the later parts of that
evaluation must keep reading its own number. On the asynchronous route the
new number is taken only while the count of pending asynchronous
evaluations is the count when the statements started, because asynchronous
evaluations that run at the same time share one number.

Measured: `Block(r := fn(3), fn := Function(2z, z), (r, fn(3)))` answers
`(6, 6)`, as before this work, on both routes, and also when the block is
boxed raw or structural;
`Sum(Block(If(k = 2, h := Function(2z, z)), h(k)), k, 1, 3)` answers
`10 + h(1)`; and `u = h(1)`, `h = (x) => x`, `u` answers `1` through
`ce.box(parseEpsil(src)[0])` and through `executeEpsil`.

Two cases are not programs although the host could mean one: a host
synchronous evaluation of a block while an asynchronous evaluation is
pending on the same engine (it cannot be told apart from a synchronous part
of that asynchronous evaluation), and two host asynchronous evaluations of
blocks that run at the same time. Their statements run in one top-level
evaluation.

**Documented difference.** With `B(h) = Block(r := h(k), h := z ↦ 2z, r)`,
`await Promise.all([B(h).evaluateAsync(), B(q).evaluateAsync()])` gives
`h(k)` and `q(k)`, while the two awaited one after the other give `2k` and
`2k`: the value of a block that the host evaluates asynchronously depends
on other asynchronous evaluations that are pending at the same time. Giving
each asynchronous evaluation its own number (carried in the evaluation
options or the context stack) is a redesign of `evaluation-epoch.ts` that
this work does not do; it is recorded in ROADMAP.md, and
`test/compute-engine/sticky-unresolved-call.test.ts` pins both answers.

The values of a dictionary are evaluated one level deeper, as the operands
of a function expression are (`BoxedDictionary.evaluate`), so a `Block`
that is a value of a dictionary is a nested block, as in a `List` or a
`Tuple`: `{"a" -> B(h)}` evaluates to `{"a" -> h(k)}`.

### B. The declaration-preparation step (shared rule, Epsil runner)

#### The shared rule

`isFunctionDeclarationStatement(ce, statement)` in
`library/control-structures.ts` says which statements are function
declarations: a `DefineFunction` whose name is a symbol, whose clause is a
`Function` literal, whose name is not an absence marker (`Nothing`,
`Missing`, `Undefined`), and whose name is not the constructor of a declared
nominal type (a constructor definition is an assignment to the type's
constructor, `defineFunctionClause`, `multi-clause.ts`). The same-name
function of an alias type is an ordinary function and is accepted.
`isHoistedFunctionDefinition(ce, statement)` adds one condition: the
definition is not generic. The `DefineFunction` canonical handler
(`library/core.ts`) installs no generic clause at canonicalization, and no
clause onto a name whose definition is generic already or whose earlier
clause it skipped (rule G2: a generic function has one clause); the test
reads the return marker of the literal and the definition of the name
without canonicalizing anything (`isGenericDefinition()`). So a generic
definition takes effect when its statement runs, on the whole-block route
and on the Epsil runner. Both rules read the statement structurally, so they
work on a statement that is not canonical. Three routes use them:

- The block canonicalization (`canonicalBlock`) uses
  `isFunctionDeclarationStatement` for its hoist of function names, so a
  generic name is still made block-local. That hoist keeps its other checks:
  it skips `Nothing`, a name the block scope binds already, and every name of
  the type registry, alias types included, so a same-name function of an
  alias type is still not made block-local. Two cases are no longer hoisted:
  a `DefineFunction` whose clause is not a `Function` literal (the handler
  installs nothing for it), and a definition of `Missing` or `Undefined`,
  which was declared as a function-typed block local before.
- The compiler uses `isFunctionDeclarationStatement` in
  `withDefineFunctionDeclares`, so a constructor definition is no longer
  rewritten to a `Declare` of a local function. A generic definition is still
  moved to the front: the compiled code needs its declaration before the
  first statement (`test/compute-engine/compile-block-local-function.test.ts`,
  three tests, fail when the generic definitions are not moved).
- The Epsil runner uses `isHoistedFunctionDefinition` for the step below.

The static reading of the declared type of a `let`/`const` statement (the
`declaredTypes` loop of `canonicalBlock`) moved, unchanged, into the
exported helper `staticDeclarations(ce, ops)`, which `canonicalBlock` now
calls. `statementDeclaredNames` and `closedLiteralType` are exported for
the Epsil runner.

#### The preparation step in `executeEpsil`

`prepareFunctionDeclarations()` (`src/epsil/execute-epsil.ts`) runs after the
static pass and the advisory scans, before the statement loop. It is skipped
when the host's time budget expired during the static pass. It reads each
statement boxed with `{ form: 'raw' }`, which binds and declares nothing.

**Which statements are prepared.** A `function` statement is prepared only
when all four conditions below hold. The clauses of a multi-clause function
are prepared together, or none of them is, so that they are installed in
their written order. So no clause of a name is prepared when another
`DefineFunction` statement of that name is not a hoisted definition (a
generic definition, a clause that is not a `Function` literal, a statement
whose raw boxing threw): in `function f<T>(x: T) -> T { x }`,
`let a = f(3)`, `function f(x: integer) { 2*x }`, `a`, the generic
definition is installed first and the later clause is refused, so `a` is
`3`; with the later clause prepared, `a` was `6` and the generic definition
was refused. A first version that prepared every `function`
statement broke two existing programs and two existing tests; each condition
names the program that required it.

1. **The program can call the function before its definition.** A statement
   that is not a function definition names the function before its last
   `function` statement, directly or through the bodies of the functions it
   names (a statement that calls `f`, where `f` calls `g`, makes `g`
   prepared too). A use in the body of a function defined earlier is not a
   call when its statement runs, and does not count by itself. The reason:
   preparing only some functions installs them in another order than the
   written one, and the order shows. In `g(t) = 2a(t)` then
   `a(x, y) = x + y`, the arity error is the value of the definition that
   comes second (`test/epsil/definition-order-error-value.test.ts`), and in
   `function f() { h = 1; h }` then `function h() { 5 }`, the assignment in
   `f` must stay a local of `f`
   (`test/epsil/function-body-local-assignment.test.ts`). A program with no
   call before a definition runs as it did before this step existed.
2. **No statement before it declares a type, a protocol or a conformance.**
   The annotations of the function can name a type that such a statement
   declares, and the type does not exist before its statement runs. The JSON
   parser of `src/epsil/docs/examples.md` (checked by
   `test/epsil/documentation.test.ts`) declares `type alias json = …` first,
   and its functions return `tuple<json, integer>`. `parseArray` calls
   `parseValue`, which is defined after it, so `parseValue` was prepared
   before the alias existed, and its definition was refused at its turn with
   `incompatible-type`. A `function` statement whose name a `DeclareType` or
   `DeclareSumType` statement of the program declares (the type name, or the
   name of a variant of a sum type) is not prepared either, wherever it is: it
   is the smart constructor of that type, and it can only be defined after
   the type statement has run.
3. **No statement before it gives the name a value.** That is an
   assignment, or a `let`/`const` with an initial value. The definition then
   depends on that value: it adds a clause to the function the assignment
   installs, it is refused on a name that holds a number, and it decides
   whether the assignment is accepted. In
   `test/epsil/execute.test.ts` ("a refused assignment over a function of an
   earlier program leaves its definition"), the program
   `h := (u: string) => u` then `function h(a: string) { a }` must report
   the refused assignment; with the clause installed first, the assignment
   was accepted. A `let` with no value (`let g: (integer) -> integer`) does
   not prevent the preparation.
4. **Each variable that the body uses has, before the statement, the
   binding that it has when the statement runs in order**
   (`isSettledBefore()`). The body is canonicalized before the earlier
   statements run, so the preparation must give it the same static picture
   of each variable it uses, or not prepare the function. For a name `n`
   that the body uses, let `S` be the statements before the `function`
   statement that declare or write `n` (a `let`/`const` of `n`, with or
   without a value; an assignment to `n`). If `S` is empty, `n` is settled.
   Otherwise `n` is settled only when all of these hold:
   - the program scope does not bind `n` when the preparation starts. A
     binding of an earlier program run on the same engine is replaced in
     order, by the `let` of this program, but not under the preparation:
     after a first program `let c = "old"`, the second program
     `let c = 2`, `let a = String(g())`, `function g() { c^2 }`, `g()` boxed
     `c^2` against the string and kept the `incompatible-type` error;
   - `S` has exactly one statement. With two, the preparation can declare
     only one type: in `let c = "old"`, `c = 2`, `let a = String(g())`,
     `function g() { c^2 }`, `g()`, it kept the `string` type of the `let`,
     where in order `c^2` is boxed after `c = 2`;
   - that statement gives `n` a static picture: a `let`/`const` with a
     declared type, with a closed literal value (a number, a string, or a
     list or tuple of such, `closedLiteralType()`), or with neither a type
     nor a value (in order the body then also sees a valueless `unknown`),
     or an assignment of a closed literal to `n` alone. A value with no
     static type is not known before its statement runs, and a use of the
     valueless variable narrows its type: in
     `test/epsil/corpus/rosetta/roman-decode.epsil` (checked by
     `test/epsil/corpus.test.ts`), the body `value[String(c)]` made `value`
     a string, and `let value = {I -> 1, …}` then gave it a dictionary, so
     the function was refused ("Invalid function").

   An unsettled name defers the function: it is not prepared, and its
   statement takes effect when it runs. The names defined by `function`
   statements of the program and the names that the function binds for its
   own body (its parameters and the targets of the `let` statements of its
   body block, `functionLocalNames()`) are not checked:
   `function g(k) { k^2 }` after `let k = {I -> 1}` is prepared. (The corpus
   program itself has no call before its definition, so condition 1 is
   enough there; condition 4 covers the same body when a call comes first.)

The statements are read once, in one pass that builds, for each name, the
list of the statements that declare or write it, with the static type that
each gives (`statementWrites()`). Conditions 3 and 4 and step 1 below read
that map. Conditions 1 to 3 are applied first; condition 4 is checked only
for the functions that they leave, before any statement is prepared.

**What happens for each prepared statement `j`, in program order:**

1. The names that statements before `j` declare (`let`/`const` targets,
   with the static type of the last `let` that gives one, from
   `staticDeclarations()`; and assignment targets, with the type of the
   first assigned value when it is a closed literal, as that assignment
   gives it when it runs, or `unknown`) are declared in the program scope,
   valueless and
   `inferred: true`, as the block hoist does. A name the program scope binds
   already is skipped, and so is an assignment target that an enclosing
   scope declares, since the assignment writes that binding. This keeps the
   meaning of the body: an assignment to a name an earlier `let` declares
   stays a `scope` write, a body that reads `i` after `let i = 2` reads the
   variable and not the imaginary unit, and `let g: (integer) -> integer`
   before the definition gives the binding the declared type (the clause is
   installed with its inferred signature until the `let` runs; see section
   D). No push on
   the shadowed-parameter stack is needed: `let i = 2`,
   `function g() { i^2 }`, `[g(), i^2]` answers `[4, 4]` with the binding
   alone.
2. The protocol-property scan (`scanProtocolPropertyCalls`) runs on the raw
   statement before it is boxed, for the reason the statement loop gives:
   boxing a call infers a function signature for an undeclared head, which
   would defeat the warning. The loop does not scan that statement again. The
   names that the earlier statements declare are passed to the scan as bound
   names, since their values are not assigned yet and the scan cannot see
   that one of them holds a function; this can only make the scan quieter.
3. The statement is boxed after a deadline check, with the
   declaration-route marker (`_epsilDeclarationRoute`) raised as the loop
   raises it, so the clause is installed now. The boxed statement is kept
   and evaluated at its own turn; the loop does not box it a second time. A
   boxing that throws leaves the statement to the loop, which boxes it at its
   turn and reports the error there. An expired time budget ends the
   preparation, and the first deadline check of the loop records the
   cancellation as the value of the program.

   A known difference from a program that runs in order: when the program
   stops before a prepared statement runs (an earlier statement uses up the
   time or step budget, and the statement loop stops), the clause of the
   prepared statement stays installed. After such a cancelled program, a
   prepared function is defined although its statement did not run. The
   binding is not removed: the clause can have been added to a function that
   an earlier program defined, and removing the binding would remove that
   function too.
4. The bindings made in step 1 for a name that an enclosing scope defines
   (a library constant such as `i`, `e` or `Pi`, another library
   definition, a binding of a host scope around the program scope,
   `hasOuterDefinition()`) are removed with `ce.undeclare(name)`, which
   calls `removeBinding` (`engine-declarations.ts`) after checks that always
   pass for a binding of the current program scope. A statement before the
   `let` then still reads the outer definition, as it does when the program
   runs in order (for a library constant, as the block route's deferred
   declaration does too). Step 1 does not skip these names: the body boxed
   in step 2 must bind the variable (`let i = 2` before
   `function g() { i^2 }` gives `4`). The other bindings stay: a `let` later
   upgrades its binding in place, as it upgrades an auto-declared one.
5. When all the statements are prepared, the bindings that step 1 made and
   step 4 kept are marked as later declarations of the program scope, with
   the set that the whole-block route uses for the top-level block of a
   program (`LATER_DECLARATIONS`, `library/control-structures.ts`, through
   `markLaterDeclarations()` and `laterDeclarationReached()`). The statement
   loop removes a name from the set before it boxes the first statement that
   declares or writes the name, and the names that are left when the run
   ends (a run that the time budget stops, or an exception) are removed in
   the `finally` of `executeEpsil()` (`LaterDeclarations`,
   `execute-epsil.ts`). While a name is in the set, a function body that is
   boxed in the program scope does not count its binding as declared
   (`isDeclaredInScopeChain()`), so an assignment to the name in the body
   makes a local of the body, as when the program runs in order. Without
   this, in `function f() { t = 1; t }`, `let a = String(g())`, `let t = 0`,
   `function g() { 5 }`, `[f(), t]`, the preparation of `g` declared `t`,
   the assignment in `f` was read as a write to the program variable `t`,
   and `f` was refused because it does not declare the `scope` effect; the
   value was `[f(), 0]` with a `runtime-error` diagnostic. The value is now
   `[1, 0]`, as on the whole-block route and as before the preparation step
   existed. With `function f() scope { … }`, the value is `[1, 0]` too
   (before this change, `[1, 1]`). A read of the name in a statement before
   its `let` still finds the binding, which has no value, and gives the
   symbol `t`. The marking is done after the preparation loop: the bodies of
   the prepared statements come after the statements that declare these
   names, and they must see the bindings.

**Documented differences from the whole-block route.** Measured on
2026-10-21. The cases of the second list are pinned by
`test/epsil/function-declaration-hoisting.test.ts`; the cases of the first
are pinned by no test.

- *A call made before the `let` of a variable that the body reads.* The top
  level of the Epsil runner has no binding that is declared and not yet
  initialized (the block route marks such a binding `_uninitialized`,
  `createBlockLocals`, `function-utils.ts`). So the body reads the variable
  as a symbol with no value, or reads the library constant when the name is
  one.

  | Program | Epsil runner | Whole-block route | Compiler |
  | --- | --- | --- | --- |
  | `let a = String(g())`, `let c = 2`, `function g() { c^2 }`, `[a, g()]` | `["c^2", 4]` (before this step: `["g()", 4]`) | the `read-before-declaration` error for `c` | (with `let a = g()`) the compiled code throws `ReferenceError: Cannot access 'c' before initialization` |
  | `let a = g()`, `let c = 2`, `function g() { c^2 }`, `[a, g()]` | `[4, 4]`: `a` holds `c^2`, and the last statement reads `c` after its `let` | the `read-before-declaration` error for `c` | see the row above |
  | `let a = String(g())`, `let i = 2`, `function g() { i^2 }`, `[a, i^2, g()]` | `["-1", 4, 4]` (before this step: `["g()", 4, 4]`) | the `read-before-declaration` error for `i` | not measured |

- *A function statement that is not prepared.* The Epsil runner installs it
  when its statement runs (the conditions of section B, and a generic
  function). A call before it stays unresolved inside its own statement, so
  the `String(…)` probe shows the call. Without the probe, the variable holds
  the unresolved call, and the statement that reads it, a later top-level
  evaluation, resolves it: the program gives the value it gave before this
  work.

  | Program | Epsil runner | Whole-block route |
  | --- | --- | --- |
  | `let h = (x) => 3 * x`, `let a = String(g(2))`, `function g(k) { h(k) }`, `a` | `"g(2)"` | `"6"` |
  | the same with `let a = g(2)` | `6` | `6` (compiler: `6`) |
  | `let v = {I -> 1}`, `let a = String(g(3))`, `function g(k) { v["I"] + k }`, `a` | `"g(3)"` | `"4"` |
  | the same with `let a = g(3)` | `4` | `4` |
  | `type alias num = number`, `let a = String(g(3))`, `function g(k: num) { k^2 }`, `a` | `"g(3)"` | the `invalid-type-declaration` error: a block cannot declare a type |
  | the same with `let a = g(3)` | `9` | the same error |
  | `let a = String(f(3))`, `function f<T>(x: T) -> T { x }`, `a` | `"f(3)"` | `"f(3)"`: the canonical handler does not install a generic clause ahead |
  | the same with `let a = f(3)` | `3` | `3` |

### C. What changes for users

The only change that a program can observe is inside one top-level
evaluation. A later top-level evaluation (the next Epsil statement, the next
statement of a block that the host evaluates, a host call of `evaluate()`)
resolves a stored unresolved call, as before this work.

- `let a = g(3); g = (k) => k^2; a` still answers `9` on the Epsil runner and
  the whole-block route: `a` holds the unresolved `g(3)`, and the last
  statement resolves it. The assignment itself takes effect when it executes:
  `let a = String(g(3)); g = (k) => k^2; a` answers `"g(3)"`.
- A stored host result resolves again on its next `evaluate()`:
  `r = ce.parse('g(3)').evaluate(); ce.assign('g', …); r.evaluate()` is `9`,
  as is the original expression.
- `let a = g(3); function g(k) { k^2 }; a` still answers `9` on every route.
- On the Epsil runner, a call before a `function` statement now resolves
  when its statement runs: `let a = String(g(3)); function g(k) { k^2 }; a`
  answers `"9"` (it answered `"g(3)"`), within the four conditions of
  section B.
- Inside one top-level evaluation, a stored unresolved call keeps its value
  after a later assignment of the name. In a `Sum` whose term assigns `h` at
  `k = 2`, the term `h(1)` stays `h(1)`:
  `Sum(Block(If(k = 2, h := Function(2z, z)), h(k)), k, 1, 3)` answers
  `10 + h(1)` (it answered `12`). In a nested block,
  `[Block(r := g(3), g := Function(k², k), r)]` answers `[g(3)]` (it answered
  `[9]`). In Epsil, `do { u = h(1); h = (x) => x; u }` answers `h(1)` (it
  answered `1`); `r = do { u = h(1); h = (x) => x; u }`, then `r`, still
  answers `1`, because the read of `r` is in the next statement.
- A block that the host evaluates directly keeps its answers:
  `Block(r := fn(3), fn := Function(2z, z), (r, fn(3)))` answers `(6, 6)`,
  because each statement of such a block is its own top-level evaluation.
  The declaration forms answer the same: with `function h(x) { x }` in place
  of the assignment, `u = h(1)`, then `u`, answers `1`, and with
  `DefineFunction(fn, Function(2z, z))` in place of `fn := …`, the block
  answers `(6, 6)`.

## Tests

- `test/compute-engine/batch9-evaluation.test.ts`: the three failing tests
  pass.
- A new test file for the sticky rule
  (`test/compute-engine/sticky-unresolved-call.test.ts`): inside one
  top-level evaluation, a stored result stays symbolic after the assignment
  (a nested block, the `Sum` of `batch9-evaluation.test.ts`), its operands
  still evaluate, and it is not checked against a later definition of the
  name; a later top-level evaluation resolves a stored result and the
  original call; the asynchronous route agrees; an expression rebuilt by
  `subs()` resolves its head.
- `test/compute-engine/block-assignment-local-per-run.test.ts` and
  `test/epsil/function-body-local-assignment.test.ts`: a block that the host
  evaluates and an Epsil program keep their answers (`(6, 6)` and `1`); a
  `do` block that reads a stored call in the same statement gives `h(1)`.
- A new Epsil test file for the preparation step, with the `String(…)` probe:
  resolution at statement time for a call before a `function` statement
  (single clause, multi-clause, hold function), the declared signature kept,
  earlier `let` and assignment bindings kept (the `scope` write error, the
  shadowed constant, the constant read before its `let`), a constructor not
  hoisted, `let g = 5` before `function g` keeps its error, an assignment of
  a lambda not hoisted, and parity with the whole-block route and the
  compiler. It also covers the selection conditions of section B: a
  recursive multi-clause function, a function reached only through the body
  of another prepared function, a sum-type variant constructor, a function
  after a `type` statement, an assignment to the same name before the
  function, a body that reads an earlier dictionary-valued variable, a body
  that calls a lambda bound by an earlier `let`, a generic function, and a
  parameter or a body `let` with the name of an earlier untyped variable
  (`test/epsil/function-declaration-hoisting.test.ts`). Each case that is
  not prepared also checks the value without the probe, which the program
  gives by later resolution.

## Measurement

The full suite runs in the worktree with the box lock before the review. The
number of failing tests and changed snapshots is reported, not absorbed.

### D. Found on the way and fixed: a stale clause behind a declared signature

On the whole-block route, `let g: (integer) -> integer` then
`function g(k) { 2k }` then `g(1.5)` answered `3`, where the Epsil runner
reports `incompatible-type`. The block canonicalizes every statement first,
so the clause is installed before the `Declare` runs; the `Declare` handler
then drops the binding that holds the unchecked clause and declares the name
fresh (`CLAUSE_INSTALLED_AHEAD`, `library/core.ts`). A call canonicalized
before that point holds the dropped record by identity and kept running its
unchecked clause. The handler now retires the dropped record as
`ce.undeclare()` retires one, with the helper that both use
(`retireBindingRecord()`, `engine-declarations.ts`: `updateDef` to an empty
value definition, `markRetiredBinding`, a declaration counted for the scope,
and the `binding-repair` and `redefine` state events), so the call reads the
definition the scope holds when it is evaluated. Unlike `ce.undeclare()`,
the removal of the binding from the scope records no undo step on the
rollback frame of an inference trial, as for the other binding that the
handler drops. Test: `test/compute-engine/block-declared-signature-clause.test.ts`.

**Open: a call between a typed valueless `let` of the function name and the
`function` statement stays unresolved.** Measured on 2026-10-21, on both
routes: `let g: (integer) -> integer`, `let a = String(g(2))`,
`function g(k) { 2*k }`, `a` answers `"g(2)"`, where `"4"` is expected. The
same program with the call before the `let` (`let a = String(g(2))` first)
answers `"4"`. The cause: the clause is installed ahead of its statement (by
the preparation step on the Epsil runner, by the block canonicalization on
the whole-block route), and the `Declare` statement then finds the binding
marked `CLAUSE_INSTALLED_AHEAD`, drops it and declares the name fresh; the
call of the next statement finds no clause, and the `function` statement
installs it again only at its own turn.

A fix that keeps the binding when its type equals the declared type is not
sound as it stands: the clause installed ahead does not carry the declared
signature. The binding that the preparation step (or the block hoist)
declares for `g` is `inferred: true`, and `declaredSignatureOf()`
(`multi-clause.ts`) reads no declaration from an inferred value definition,
so `defineFunctionClause()` installs the clause unchecked, with the
signature inferred from the literal: `(unknown) -> number` for
`function g(k) { 2*k }`, `(unknown) -> string` for `function g(k) { "s" }`.
Kept as it is, that binding would answer `3` for `g(1.5)` and accept the
clause that returns a string. So the claim of step 1 that the earlier `let`
"gives the clause its declared signature" holds only once the `Declare`
statement has run and the `function` statement installs its clause again.
Two directions are possible; neither is implemented:

- In the `CLAUSE_INSTALLED_AHEAD` branch of the `Declare` handler, after the
  fresh declaration, install again at once the clauses that were installed
  ahead, under the declared signature (this needs the literal, the origin
  and the attributes of each install, kept with the marker and journaled
  with it). A clause that violates the signature is then refused at that
  point, and its statement reports the error at its turn as today.
- Keep the binding only when the installed signature is not inferred (each
  parameter and the result are annotated, `function g(k: integer) -> integer`)
  and is the declared type. This covers only annotated clauses.

The values on the current tree, to keep with either fix:
`let g: (integer) -> integer`, `function g(k) { "s" }`, `g(2)` answers
`Error(ErrorCode("incompatible-type", "integer", "string"), "s")` with no
diagnostic on the Epsil runner and the same value on the whole-block route,
and `let g: (integer) -> integer`, `let a = String(g(2))`,
`function g(k) { 2*k }`, `[a, g(1.5)]` gives, on the Epsil runner, the
value `[a, g(Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5))]`
with one diagnostic (`static-type-error`, `incompatible-type`, at
`g(1.5)`).
