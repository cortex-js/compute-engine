# The earlier binding mechanism: what still runs

Status: a list for the user, 2026-11-12. **User decision, 2026-11-12: the
engine adopts the new model, and the leftovers are removed.** The examples
that reach them are contrived; after a removal, the tests that fail are
read one by one, and a failing test counts only when it is a program that
a user would plausibly write and be surprised by. Order: leftovers 1 to 4
and 5 (a) first, as a measurement in a worktree; 5 (b), 6 and 7 as the
recommendations below say. Nothing is removed on main yet, and no source
file is changed.

**Leftovers 5 (b) and 6 are decided too** (user decision 2026-11-12, given
in session `compute-engine-06` and recorded as D15 of
`2026-11-11-bound-once-spec.md`): nothing is inferred for a parameter from
the body. This replaces the recommendation "keep" for 5 (b) and 6 below.
Leftover 7 is still to decide. The removal of all of them lands in one
change by session `compute-engine-42`, after step 1 of the bound-once spec
is on main. Measurements: leftovers 1 to 4 by `compute-engine-42` (a
worktree on main, the failing tests classified); 5 (a), and 5 (b) with 6,
by `compute-engine-06`
(`/Users/arno/dev/compute-engine-recovery/probe-infer-report.md`). Source read and run: main at
`7305ef84b8e97bf25bc97dbcdaef2e6e48d81772`.

The flag `_bindingUnits` was removed in
`830047dc6ce4962f59bb7780998c443ad04f28c8`. Its message ends with "The parts
of the earlier mechanism that still run are kept". The agent that made the
commit reported seven. This document checks each against the source, gives a
program that reaches it with the result of today, what the model says
(`2026-11-09-binding-units-model.md`, sections 2 and 4, and
`2026-11-11-bound-once-spec.md`, sections 2, 10 and 11), what its removal
would change for that program, and what depends on it.

"Today" is the output of a run on the source above. The run wraps
`BoxedSymbol._inferWithoutFacts()`, `BoxedSymbol._inferOnOuterBinding()` and
`ce._recursionKnots.set()` at run time and prints the bindings of each
scope of the result; it edits no source file. "Removed" is derived from the
code, not run.

All seven exist and run. Two findings differ from the report:

- Leftover 5 is wider than "outside a root boxing". The write on a
  definition also runs inside a root boxing, for every definition that the
  boxing made in a scope that it created (a parameter, a body free name, the
  shadow of leftover 3). That is the common case: it runs for `x ↦ x + 1`.
- Leftover 7 has two parts. The report names the read (the call typing).
  The write that it reads, a retype of an inferred host definition to
  `function` when a `DefineFunction` is boxed, is a write on a host
  definition at boxing (`library/core.ts:7766` and `:8241`).

One mechanism joins leftovers 1, 2, 3 and most of 4 and 5: a function
literal's body has a scope of its own that the boxing makes, and a name of
the body with no definition gets a valueless COPY in that scope. A call
hides the copy and reads the name outside. The copy exists to hold a type.
The four leftovers are the four ways to make or to feed the copy.

## Summary

| # | Leftover | Where | Runs when | The model says | Recommended |
|---|---|---|---|---|---|
| 1 | Declaration of a symbol in a scope that the boxing made | `engine-expression-entrypoints.ts:369` (`createSymbolExpression`) | a name with no definition is boxed in the body of a function literal | boxing declares nothing; the type of the name is in the environment of the unit | remove with 2, 3, 4: one change, "a body free name is a free name" |
| 2 | Declaration of a call head | `boxed-expression/box.ts:3374` (`makeCanonicalFunctionCore`) | a call whose head has no definition is boxed in the body of a literal, or the head is a parameter | the `function` reading is a requirement in the environment | free head: remove with 1. Parameter head: keep (it is the parameter's own definition) |
| 3 | Shadow of a library operator used as a value | `boxed-expression/validate.ts:1123` (`devolveUnappliedOperator`) | `N` or `D` is a value operand in the body of a literal | the occurrence is a variable of the unit; no declaration | remove with 1 |
| 4 | `BoxedSymbol._inferOnOuterBinding()` | `boxed-expression/boxed-symbol.ts:1551` | a use narrows a copy of leftover 1 | no copy, so nothing to forward | remove with 1; its last branch (`:1623`) is a declaration and goes first |
| 5 | Narrowing write of `BoxedSymbol._inferWithoutFacts()` on a definition | `boxed-expression/boxed-symbol.ts:1672-1865` | (a) outside a boxing; (b) in a boxing, on a definition the boxing made in a scope it created | "the narrowing write on a host definition" is removed | (a) remove: two call sites. (b) keep for parameters, binder variables and block locals; goes for copies with 1 |
| 6 | Fresh-matrix repair on a definition | `boxed-expression/validate.ts:6233-6391` (`repairFreshMatrixInference`) | the repaired name has a definition whose uses wrote on it: a parameter | not named by the model | keep while 5 (b) is kept; it is the same write |
| 7 | Recursion-knot placeholder | read `boxed-expression/boxed-function.ts:16567-16576`; write `library/core.ts:7753-7776`, `:8237` | a `DefineFunction` or a function `Assign` is boxed for a name that has an inferred value definition | boxing writes nothing on a host definition | keep the read; decide the write with D8 (below) |

## 1. Declaration of a symbol in a scope that the boxing made

**Source.** `createSymbolExpression()`, `engine-expression-entrypoints.ts`.
A name with no definition is a free name with a home scope and no
declaration when the home scope existed before the boxing
(`isPersistentScope(homeScope) !== false`, line 355). Otherwise line 369
declares it in the current scope with the inferred type `unknown`, marks it
as a free-symbol declaration and as a body free name (lines 388-396), and
records an `auto-declared` provenance entry (line 401).

The two parameter branches above it (lines 136-298) also declare at boxing.
They declare the parameter itself, which the model keeps (bound-once rule 4:
a parameter is a name of the unit of the literal). They are not leftovers.

**Program.**

```js
const f = ce.box(['Function', ['Tuple', 'x', 'y'], 'x']);
ce.assign('y', 5); ce.function('Apply', [f, ce.number(2)]).evaluate();
```

Today: the body scope holds `x: unknown` and `y: unknown`, both inferred and
valueless. `ce.lookupDefinition('y')` at the top is `undefined` before the
assignment. The value is `(2, 5)`: the call hides the copy and reads the
`y` of the top scope.

**The model.** "Nothing is written at boxing." The free name of a function
body is in the list of decisions that go in the environment: "the free name
of a function body (its home scope is the scope that the literal is written
in)" (model, section 2). The code already computes that home scope
(`bodyFreeNameHomeScope()`, line 423) and stores it on the copy.

**Removed (derived, not run).** `y` in the body is a free name whose home
scope is the top scope, as an occurrence written outside the literal is.
The value `(2, 5)` is the same: the read by name already goes to the top
scope. The type of the literal is the same when the type of `y` is read
from the environment of the unit. What goes with it: the hiding of the copy
at a call (`hideBodyScopeParams()`, `function-utils.ts`), the marks
`markFreeSymbolDeclaration` and `markBodyFreeName`, the rebuild of a
construction when a sibling occurrence outside the binder declares the same
name (`noteTransientAutoDeclare()`, Tycho item 178), `outerFreeNameHome()`,
and leftover 4 whole.

**Depends on it.**
- `isFreeSymbolDeclarationInBody()` (`assignment-locals.ts`): an assignment
  in a body does not treat the copy as a declaration. Under D8 (a local must
  be declared) the question does not arise.
- `sameBinding()` (`compare.ts`) reads the home scope of the copy.
- Leftover 3 declares its shadow "as a free name does"
  (`validate.ts:1117`).
- Leftover 7: the placeholder of a local recursive function is a copy made
  by this line (`core.ts:7749` calls `ce.symbol(name)`).
- The declaration is journaled for a rollback (family 4,
  `engine-declarations.ts:530`).

## 2. Declaration of a call head

**Source.** `makeCanonicalFunctionCore()`, `box.ts:3331-3381`. A call whose
head has no applicable definition: when the head is not a parameter, has no
definition at all and its home scope is persistent, nothing is declared and
the call keeps a free head (lines 3366-3372). Otherwise line 3374 runs
`ce.declare(name, { type: 'function', inferred: true }, autoScope)`. The
declared binding is marked a forward-call reference (line 3377), or
recorded as the parameter's binding (line 3379).

Three cases reach line 3374: the head is a parameter of a literal being
boxed; the home scope is one that the boxing made; the name has a
definition that is not applicable (a value definition).

**Program.**

```js
const f = ce.box(['Function', ['g', 'x'], 'x']);
ce.assign('g', ce.box(['Function', ['Multiply', 't', 't'], 't'])); ce.function('Apply', [f, ce.number(3)]).evaluate();
```

Today: the body scope holds `g: function` (inferred, valueless) and
`x: unknown`. No `g` at the top. The type of the literal is
`(x: unknown) any -> unknown`. The value is `9`.

The parameter case, `ce.box(['Function', ['g', 2], 'g'])`: the body scope
holds `g: function`, the literal is typed `(g: unknown) -> unknown`, and
applied to `t ↦ t + 1` it gives `3`.

**The model.** "A call head read as a function (`f(x)`)" is a decision of
the environment (model, section 2). The code that decides whether a name is
a function "takes the occurrence or the environment as an argument".

**Removed (derived, not run).** For the free head: the call in the body has
a free head, as the same call at the top has today. The value `9` is the
same: the head is resolved when the call is evaluated. The forward-call
reference mark and `_reboxedForForwardCallee()` are no longer reached from a
body. For the parameter head: the declaration IS the definition of the
parameter and must stay; only its place moves if the parameter is declared
when the literal is entered and not at its first reference.

**Depends on it.** `markForwardCallReference()` and its readers
(`forward-call-reference.ts`, `engine-infer.ts:234`,
`boxed-function.ts:16584`); `noteProvisionalCall()` on the next lines and
the registry (`provisional-application.ts`, 649 lines), which the model
removes in slice 2; four comments of `invisible-operator.ts` that say "as
`makeCanonicalFunctionCore()` does" for the same declaration made by the
juxtaposition reading.

## 3. Shadow of a library operator used as a value

**Source.** `devolveUnappliedOperator()`, `validate.ts:1059-1144`. For a
one-letter uppercase name bound to a library operator (`N`, `D`) at a value
position: when the scope that would hold the shadow is persistent, the
occurrence becomes a free name and nothing is declared (`_asFreeVariable()`,
line 1119). Otherwise lines 1123-1136 declare the name `unknown` in the
scope, mark the definition `_isDevolvedShadow`, note it with the boxing
state, and box the name again.

It has five call sites in `validate.ts` (lines 1183, 1775, 5147, 5454,
5708). `isRepairableOperatorSymbol()` (`overload.ts:393`) is its write-free
copy, used by the trial validation; its comment says it "stays in lockstep".

**Program.**

```js
const f = ce.box(['Function', ['Add', 'N', 'x'], 'x']);
ce.assign('N', 10); ce.function('Apply', [f, ce.number(1)]).evaluate();
```

Today: the body scope holds `x: number` and `N: number` (inferred,
valueless). `N` at the top is still the library operator before the
assignment. The value is `11`. At the top level, `ce.box(['Add', 'N', 1])`
declares nothing: `N` resolves to the operator and `unknowns` is `['N']`.

**The model.** "A variable made for a library name used as a value
(`N + 1`)" is a decision of the environment.

**Removed (derived, not run).** The occurrence in the body is a free name
read as a variable, as at the top level. The value `11` is the same. The
flag `_isDevolvedShadow`, `noteDevolvedShadow()`, the rebind of a later
operand of the same expression (line 1142) and the rebuild that the shadow
requests are no longer reached.

**Depends on it.** The assertion against a trial frame (line 1070,
`repairsForbiddenByRollbackFrame()`); `overload.ts:376-393`;
`engine-declarations.ts:2874` (an explicit declaration over a shadow);
`function-utils.ts:12195`; `compilation/builtin-callback.ts:199`. Test files
that name it include `unapplied-operator-fallback.test.ts`,
`ce-597-unknowns-library-letter-operand.test.ts`,
`builtin-name-value-binding.test.ts`.

## 4. `BoxedSymbol._inferOnOuterBinding()`

**Source.** `boxed-symbol.ts:1551-1626`. Called after each narrowing write
of leftover 5 (line 1863) and by `_bindToOuterBinding()` (line 1521, from a
list literal). It returns at once outside a function literal, for a
function type, a constant, a value, a block local, a parameter, a name that
starts with `_`. For a copy of leftover 1 it does one of three things:

- an outer binding exists at or above the scope of the literal: narrow it
  (line 1599). Inside a root boxing that write goes in the environment
  (`_unitWriteScope()`), so it is not a write on the definition;
- none exists and the outer scope is persistent: write the requirement on a
  free name of that scope, in the environment (lines 1613-1619);
- none exists and the outer scope is one the boxing made: DECLARE the name
  there with the type `t`, inferred (line 1623).

**Program.**

```js
const b = ce.box(['Block', ['Function', ['Add', 'x', 'y'], 'x']]);
b.type; ce.lookupDefinition('y');
```

Today: the scope of the `Block` holds `y: number` (inferred, valueless),
made by line 1623; the body scope of the literal holds `x: number` and a
second `y: number`. The type is `(x: unknown) -> number`. No `y` at the
top. With the literal alone (`ce.box(['Function', ['Add', 'x', 'y'], 'x'])`)
the second branch runs: no declaration, and `ce.box('y').type` is `unknown`
afterwards.

**The model.** Section 4 removes it by name: "the declaration of a free
name at boxing and the narrowing write on a host definition
(`BoxedSymbol._inferWithoutFacts()` for a host name,
`_inferOnOuterBinding()`)".

**Removed (derived, not run).** With leftover 1 removed there is no copy,
so the function has no input: the use `x + y` writes `y: number` in the
environment under the home scope of `y`, directly. Removed alone, with the
copy kept: the copy is narrowed and the outer name is not, so the type of
the literal says `number` for a `y` that a call reads outside, which is the
defect it was written for (CE-473). It cannot go before leftover 1.

**Depends on it.** `narrowFreeSymbolCells()` (`canonical-utils.ts`) through
`_bindToOuterBinding()`; `noteOuterFreeName()` and `outerFreeNameHome()`
(`engine-boxing-state.ts`), read by leftover 1; the comments of
`assignment-locals.ts:94`, `function-utils.ts:9685`, `types-engine.ts:2772`.
Under D8 a `Block` does not get an undeclared local, so the third branch
would declare a name that the block never declared: check it with session
compute-engine-06 before D8 lands on main.

## 5. Narrowing writes of `BoxedSymbol._inferWithoutFacts()` on a definition

**Source.** `boxed-symbol.ts:1628-1866`. For a value definition whose type
is inferred or `unknown`, `_unitWriteScope()` (line 1157) decides: the write
goes in the environment when a root boxing is active and the definition
either existed before the boxing or was made by it in a persistent scope.
Otherwise lines 1672-1865 write on the definition: `_setType()`, the
`inferredType` flag, a state event, `_noteInferenceWrite()` (provenance, the
fresh-inference set, the narrowing sink), the initializer alias, and
leftover 4.

So the write on a definition runs in two cases:

- **(a) no root boxing is active.** Two engine sites call `_infer()` on a
  symbol at an assignment or a declaration: `engine-declarations.ts:4162`
  and `boxed-value-definition.ts:698`.
- **(b) a root boxing is active and the boxing made the definition in a
  scope that it created**: a parameter, a copy of leftover 1, a shadow of
  leftover 3.

**Program, case (a).**

```js
ce.declare('q', 'integer'); ce.declare('uu', 'unknown');
ce.assign('q', ce.symbol('uu')); ce.lookupDefinition('uu');
```

Today: `uu` is `integer`, and its `inferredType` flag is now `true` (it was
declared, with the type `unknown`). The trace shows the write with no root
boxing active. With `uu` a free name (no `ce.declare('uu', …)`), nothing is
written and `ce.box('uu').type` stays `unknown`. The same write runs for
`ce.declare('r', { type: 'real', value: ce.symbol('zz') })`: `zz` becomes
`real`.

**Program, case (b).**

```js
const f = ce.box(['Function', ['Add', 'x', 1], 'x']);
f.type;
```

Today: the body scope holds `x: number`, written by line 1778 during the
root boxing. The type prints `(x: unknown) -> number`.

**The model.** Section 4 removes "the narrowing write on a host definition
(`BoxedSymbol._inferWithoutFacts()` for a host name)". Case (a) is a write
on a host definition by an assignment, not by a boxing: the model says a
scope changes "by a declaration, an assignment, a definition, or a commit",
and says nothing about an assignment that types a second name. Case (b) for
a parameter is not a host definition: bound-once rule 4 keeps the parameter
as a name of the unit of the literal, and D6 says definitions stay static
and activations hold values.

**Removed (derived, not run).** Case (a): `uu` keeps the type `unknown`;
`Tuple(q)` is typed `tuple<integer>` while its value is typed
`tuple<unknown>`, which is the reason given at the call site. The
alternative that the model allows is a refused assignment that reports its
cause (model slice 5). Case (b) for a parameter: the definition of `x`
keeps `unknown`, and the signature of the literal must read the requirement
from the environment of the literal's unit; that is a change of where
parameter inference lives, not a removal. Case (b) for a copy or a shadow
goes with leftovers 1 and 3.

**Depends on it.** The rollback journal, family 1 (line 1758): see "The
rollback" below. `SCALAR_USES_MAP`; `_initializerAlias`; the narrowing sink
(`InspectableScope.narrowings()`); `_freshlyInferred`, which leftover 6
reads; `residue-class.ts:537`; `library/collections.ts:6338`;
`library/core.ts:8557`.

## 6. The fresh-matrix repair on a definition

**Source.** `repairFreshMatrixInference()`, `validate.ts:6211`. For each
free variable of the operand, `unitRepairSite()` gives the entry of an
environment to replace (lines 6225-6231, and 6329-6335 for the write). When
it gives `undefined` (the uses of the name wrote on its definition, line
6157), lines 6233-6266 test the definition (`inferredType`, fresh or
`unknown`, no shape evidence) and lines 6337-6390 write on it: `_setType()`
to the matrix type, `inferredType = false`, a provenance entry, the
fresh-inference set, a state event, then the operand is boxed again. Three
call sites (`validate.ts:5132`, `5442`, `5697`).
`couldRepairFreshMatrixInference()` (line 6024) is the write-free test for
a trial.

**Program.**

```js
const f = ce.box(['Function', ['Determinant', ['Add', 'A', 'B']], 'A', 'B']);
f.isValid; f.type;
```

Today: valid, typed `(A: matrix, B: matrix) -> number`. The trace shows `A`
and `B` first written `unknown -> number` on their definitions (leftover 5,
case (b)), then the body scope holds `A: matrix` and `B: matrix`: the
repair replaced the types on the definitions. With `A` and `B` free names
(`ce.box(['Determinant', ['Add', 'A', 'B']])`), or declared `unknown` by the
host, the repair writes in the environment and no definition changes.

**The model.** Not named. It follows the rule of leftover 5: a definition
that the boxing made in a scope that it created may be written.

**Removed (derived, not run).** `A + B` types the parameters `number`,
`Determinant` refuses the operand, and the literal is invalid
(`incompatible-type`). The host's remedy is a typed parameter
(`A: matrix`).

**Depends on it.** `_freshlyInferred` and its window
(`_inferenceTxDepth`); the journal families 1 and 6 (lines 6357, 6384);
`library/utils.ts:4037`; `binding-units-matrix-repair.test.ts`,
`matrix-operator-typing.test.ts`, and the "failure leg inside an open
rollback frame" tests of `inference-rollback.test.ts`. If parameter
inference moves to the environment of the literal's unit (leftover 5, case
(b)), this branch is dead and the environment branch serves both.

## 7. The recursion-knot placeholder

**Source, the read.** `boxed-function.ts:16567-16576`: a call of a name
that has a recursion knot types `unknown` when the name resolves to the
binding that the knot recorded and that binding is an inferred value
definition typed the bare `function`. Lines 16577-16587 are the newer
branch: the knot of a free name holds a scope, and a call with a free head
types `unknown`.

**Source, the write.** `library/core.ts:7738-7776` (`DefineFunction`) and
`:8226-8245` (`Assign` of a function): when the target has no definition,
`ce.symbol(name)` is called (which declares a copy only in a scope that the
boxing made, leftover 1); when the target has an inferred value definition,
`_setType('function')` retypes it and sends a `type-write` event. Line 7808
records that definition in the knot.

**Program.**

```js
ce.declare('h', { type: 'unknown', inferred: true });
ce.box(['DefineFunction', 'h', ['Function', ['If', ['Equal', 'n', 0], 1, ['Multiply', 'n', ['h', ['Subtract', 'n', 1]]]], 'n']]);
```

Today: the trace shows the knot set with "a value definition typed
`function`, inferred": the placeholder. After the boxing `h` is the
operator `(n: unknown) -> number`, and `h(4)` is `24`. With no prior
definition of `h` at the top level, the knot holds a scope and no
placeholder is made. In the body of a literal, a local recursive function
(`Function(Block(DefineFunction(h, …), h(x)), x)`) gets a placeholder: the
copy of leftover 1, retyped `function`. Its value at `4` is `24`.

**The model.** "Nothing is written at boxing." The retype of a host
definition is such a write. The model's own answer for the self-call is the
unit: the body of a function definition is one unit, and the name being
defined is known to it.

**Removed (derived, not run).** The read alone, with the write kept: a
self-call in the body is typed from the placeholder's bare `function`, and
the broadcast lift guesses a result type from a collection argument (the
reason in the comment at line 16553). The write alone: the self-call
resolves to an inferred value definition that is not typed `function`, and
is read as a product or refused. Both go together when the knot of every
name holds a scope (the branch of lines 16577-16587), which needs leftover
1 removed for the local case and a rule for the host case.

**Depends on it.** `_reboxedForForwardCallee()`; `boxed-function.ts:1308`
and `:4993` (two other reads of `_recursionKnots`); the journal, family 1
(`core.ts:7759`, `:8241`); `clause-identity.ts:148`;
`assign-recursion.test.ts`. Under D8 a local function of a block is
declared, so the local case has a declared definition and no copy; whether
a top-level `DefineFunction` over an inferred name still occurs under D8 is
a question for session compute-engine-06.

## The rollback of an inference (`inference-rollback.ts`)

`ce._withRolledBackInference()` (`index.ts:1063`) has two callers: the
overload trial (`validate.ts:4436`, with `forbidsRepairs: true`) and the
Epsil static check (`static-diagnostics.ts:642`). Its journal has eight
families. What each leftover's removal does to it:

| Leftover | Journal entries it makes | After its removal |
|---|---|---|
| 1 | family 4 (a declaration), family 7 (the `auto-declared` provenance entry) | no entry from a body free name; family 4 stays for explicit declarations, parameters and block locals |
| 2 | family 4; family 5 when the call is noted as provisional (the registry) | no entry from a free head; a parameter head still records family 4 |
| 3 | family 4; it is forbidden in a trial frame (assertion) and admitted by `isRepairableOperatorSymbol()` | no entry; the assertion, the `forbidsRepairs` option's first reason and the lockstep copy in `overload.ts` are no longer needed for it |
| 4 | none of its own: branch 1 and 2 write through `_infer()` (leftover 5 or an environment), branch 3 through family 4 | nothing to undo |
| 5 | family 1 (the type slots, `boxed-symbol.ts:1758`), family 6 (`_freshlyInferred`), family 7 (provenance), family 8 (the narrowing sink) | case (a) removed: no entry outside a boxing. Case (b) kept for parameters: family 1 still records each parameter narrowing made inside a frame. Family 1 can go only when no use writes on a definition at all, parameters included |
| 6 | family 1 and family 6 (`validate.ts:6357`, `:6384`); forbidden in a trial frame | with the definition branch removed, the repair writes only in environments, which a trial already throws away; the second reason for `forbidsRepairs` goes |
| 7 | family 1 (`core.ts:7759`, `:8241`) | no entry |

So: removing 1, 2, 3, 4 and 6 leaves the frame with families 1 (parameter
and block-local narrowing, the function-signature writes of family 2 are
separate), 3, 4, 5, 7 and 8. The frame itself cannot be removed while a
use narrows the definition of a parameter (5, case (b)) or while the
registry of family 5 exists (model slice 2). A trial already runs in an
environment that is thrown away (`inTrialEnvironment()`), so for a trial the
frame protects only definitions that the trial's own boxing made, which die
with the trial; the Epsil static check is the caller that still needs the
undo, for declarations and for family 1.

## Not in the reported seven

Found while reading; each still runs on main.

1. **The registry of waiting definitions** (`provisional-application.ts`,
   649 lines; `repairProvisionalDependents()` in `utils.ts:2130`). The model
   removes it in slice 2. It is not a leftover of slice 1, but it is the
   largest part of the earlier mechanism that runs.
2. **The forward-call reference** (`forward-call-reference.ts`,
   `_reboxedForForwardCallee()`), made by leftover 2 and by
   `engine-infer.ts:234`.
3. **The declaration of a head by the juxtaposition reading**
   (`invisible-operator.ts:315`, `:341`, `:468`, `:1245`): the same
   declaration as leftover 2, made on another route. Not probed.
4. **A write on a host definition when an `Assign` is boxed.** With `x` an
   inferred `unknown` host definition, `ce.box(['Block', ['Assign', 'x', 3],
   ['Add', 'x', 1]])` leaves `x: integer` after the boxing, before any
   evaluation. The write is not made by `_inferWithoutFacts()` (no trace
   line); it is the assignment evidence of `library/core.ts`. D8 changes
   this area (`Assign` never makes a local); not analysed further.
5. **`InspectableScope.narrowings()`** (`engine-inspectable-scope.ts:100`)
   and its sink still exist; the model says it "has nothing to report". It
   is fed by leftover 5.
6. **The checkpoint API** (`checkpoint.ts`, 798 lines;
   `checkpoint-journal.ts`, 505 lines) is on main and
   `engine-library-bootstrap.ts:277` calls it. D9 removes it; the memory of
   this project says session compute-engine-d1 does that on main.
7. **An observation, not checked against a contract:** the type of
   `x ↦ x + 1` prints `(x: unknown) -> number` while the definition of `x`
   in the body scope is `number`.

## Decisions for the user

1. **Leftovers 1, 2 (free head), 3 and 4 as one change: a name of a literal
   body with no definition is a free name of the scope the literal is
   written in.** Recommended: yes, after step 1 of the bound-once spec is on
   main, as its own change. The three programs above give the same values.
   It removes the copy, its hiding at a call, the two marks, the rebuild for
   a sibling occurrence and `_inferOnOuterBinding()`. Alternative: keep them
   until the macro kind, which also binds a body in each reader.
2. **Leftover 5, case (a): an assignment or a declaration that types a
   second, typeless name.** Recommended: remove the two call sites and leave
   the name `unknown`; the mismatch that results is reported by slice 5 of
   the model (a refused assignment reports its cause). Alternative: keep,
   as the one write on a host definition that an explicit statement of the
   host causes.
3. **Leftover 5, case (b), and leftover 6: parameter inference writes on
   the definition of the parameter.** Recommended: keep. It is not a host
   definition, and D6 keeps definitions static for activations. Moving it to
   the environment of the literal's unit would remove journal family 1 and
   the definition branch of the matrix repair, and is a design task of its
   own, done only if the user asks for it.
4. **Leftover 7, the retype of an inferred host definition by a
   `DefineFunction` that is boxed.** Recommended: decide after D8 is on
   main, with the answer of session compute-engine-06 on whether the case
   still occurs. If it does: the knot holds a scope for every name (the
   existing second branch), and the retype goes.
5. **Item 4 of "Not in the reported seven"** (the type write of a boxed
   `Assign` on a host definition): say whether it is to be listed as an
   eighth leftover. Recommended: yes, checked after D8.

## Under the bound-once worktree (answer of compute-engine-06)

From session compute-engine-06, 2026-11-12, "from the diff of each file
against base `5eb1778b5`, worktree `/tmp/wt-compute-engine-ad-step1` at
`f99f91ec4`, not a line-by-line read". (When this document was written the
worktree's HEAD was `cac18012d900866f645763cb65037b254a4f611b`; the answer
was not checked against it.)

All seven are KEPT there. None is removed or made unreachable by the rule
or by D8.

| # | In the worktree |
|---|---|
| 1 | kept; the file has 7 more lines: a symbol with a definition records its home scope |
| 2 | kept unchanged (`ce.declare(name, { type: 'function', inferred: true }, autoScope)`) |
| 3 | kept, 8 more lines: the shadow declared in a function body is marked as a body free name, so it skips the library operator |
| 4 | unchanged |
| 5 | unchanged (`narrowInferredType()` writes on the definition) |
| 6 | unchanged (`unitRepairSite()` returning `undefined`) |
| 7 | unchanged |

D8 removed a different piece: the implicit local of a first assignment
(`declareAssignmentLocals` in `assignment-locals.ts`, the hoisting in
`canonicalBlock`, the first-assignment-in-branch check).

`inference-rollback.ts` survives with 5 more lines: a rollback that undid
something emits a `declare` event, so that a cached resolution is not
served after it. That event exists only because leftover 5 and the other
writes on definitions can be rolled back; D7 of the bound-once spec says it
goes when those writes go. That session asked what removing 5, and 1, 2 and
4, would do to `_withRolledBackInference()`: the answer is the table of
"The rollback of an inference" above. In short: 1 and 2 stop making
family 4 entries for body names, 4 makes none of its own, and 5 keeps
family 1 alive for as long as a parameter is narrowed on its definition, so
the `declare` event of the worktree stays until decision 3 above is taken
the other way.

Not analysed: activations (D6) rely on the definitions of a parameter, a
binder variable and a block local being those made at boxing. Whether the
definitions of leftover 1 or 4 (the free name of a literal's body) are
among the definitions that D6 reads is not known; nothing in this document
assumes either way, and decision 1 must be checked against the activation
design before it is implemented. The compile options depend on none of the
seven, as far as that session knows.

## The measurement of leftovers 1 to 4 (2026-11-12)

In a worktree at main `8913dae82c0098918132a6a16789945f8fc4269a`; nothing
landed. Patch:
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/54119b18-87c0-4818-a978-a767f79e31b6/scratchpad/leftovers-removal.patch`
(5 files, +50 −229). The full suite ran once with every removal, to 2,038
of 2,050 files (it hit its time limit on a loaded machine): 27 tests failed
in 11 files, no snapshot. The final patch (leftover 2 put back, one fix)
had single files and a batch of 133 files, not a full run.

- **Leftovers 1, 3, 4: removed.** 7 tests fail, all tests of the old rule
  (they read the copy itself: the body's `f` is not the global `f`). The
  values of their programs are unchanged. A closure still reads the right
  value (`add(2)(3)` is 5; `f := x ↦ x + g`, then `g := 10`, `f(1)` is 11).
- **A fix the removal needs**: `capturedSymbols()`
  (`function-literal.ts`) skipped a name with no definition, so the
  compiled `g(1)` of `g := x ↦ x + y; y := "s"` gave `"1s"` where the
  interpreter gives an error (11 tests). It now records a free name of
  the body.
- **Leftover 2 (the free head): NOT removed. It needs a decision.**
  Without the declaration, a function that calls a function defined later
  (`R := M ↦ R_xz(R_yz(…))` before `R_xz` exists) is inferred to have
  effects (`effects-inference.ts:3470`: an undeclared head has effects
  `any`), and nothing computes its effects again when the head is defined.
  A Tycho document then does not finish
  (`tycho-item-182-facet-probe-storm.test.ts`: 7 s at HEAD, not finished
  in 400 s). Witness: `corpus`. Options: (a) compute the effects of a
  definition again when a free head it calls gets a definition; (b) a free
  head is read as pure; (c) keep leftover 2.
- **Unreachable after 1, 3, 4** (not deleted): in `engine-boxing-state.ts`
  `noteTransientAutoDeclare()`, `noteOuterFreeName()`,
  `outerFreeNameHome()`, `noteDevolvedShadow()`; in `binders.ts`
  `markBodyFreeName()` and what reads its mark; `markFreeSymbolDeclaration()`
  of `assignment-locals.ts`; the reads of `_isDevolvedShadow`. The rollback
  keeps its families 1 and 4 (parameters, block locals, leftover 2).
- Not measured: the tests that the removal of 5 (a), 5 (b) and 6 changes.

## The removal on step 1, with D15 (2026-11-12): measured, not landed

In a worktree at main `d2f392f08`: leftovers 1, 3, 4, 5 (a), 5 (b) and 6
removed, leftover 2 and 7 kept. Patch
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/54119b18-87c0-4818-a978-a767f79e31b6/scratchpad/leftovers2.patch`
(37 files, +285 −2,324). No test was updated. It lands after the macro
kind is staged (session `compute-engine-67`), rebuilt on it.

One full suite run (before a last fix of the result type of `Negate`):
**958 tests fail in 176 files that pass on main**; no snapshot fails. Almost
all come from D15 (no parameter inference), not from leftovers 1 to 4
(7 tests, measured earlier). The groups, from the text of the failures
(only the value group was read test by test):

| Group | Tests / files | What |
|---|---|---|
| the type of a parameter or a signature | 240 / 41 | `h(x) := mean(x)` was `(x: list) -> …`, is `(x: unknown) -> …` |
| a call with a list now maps | 153 / 36 | `xs ↦ Length(xs)` on `[1, 2, 3]`: was 3, is a list of errors |
| compiled routes | 227 / 65 | a point, tuple or string parameter with no annotation declines or emits other code |
| the result type of a body or a call | 94 / 29 | `t ↦ (t, t², t³)` is `tuple<unknown, number, number>` |
| the Epsil corpus | 13 / 1 | `isPal(integerDigits(n))` with an untyped list parameter maps |
| tests of the removed mechanism | 18 / 6 | |
| values | 203 / 61 | mostly a list argument that now maps; three cases below |

To decide, each a program that a user writes:

1. `\lim_{x \to 0^-} |x|/x` stays unevaluated (it is −1 on main): the
   derivative of `Abs` reads an operand that is not typed `number` as a
   norm. Recommended: an `unknown` operand is a scalar there, as the rule of
   2026-10-23 says.
2. A curve `t ↦ (t, t², t³)`: its derivative at a point is typed
   `tuple<number, number, unknown>`.
3. `Rest(g(u))` for that `g` is an `incompatible-type` error: a defect of
   older code that D15 reaches (CE-1265).

Also filed: CE-1264 (a partial application of a function with an annotated
parameter gives `Error("missing")`, on main too).

The rollback keeps every journal family: block locals, binder variables,
the definition branch of the matrix repair and three sites of
`library/core.ts` still write. The `declare` event after a rollback stays.

