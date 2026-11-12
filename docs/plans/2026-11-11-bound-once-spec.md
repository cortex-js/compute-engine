# Binding units: an expression is bound once

Status: APPROVED by the user on 2026-11-11, after the measurements of
section 9: the rule (D1), a popped scope keeps its definitions (D2), the
compile options in the same change (D3), the order and the delivery rule
of section 7 (D4), and the binder case of section 4. Step 1 of section 7
is being implemented. A measure of the time on a quiet machine is still
owed (M3). The spec was reviewed on 2026-11-11
(`2026-11-11-bound-once-evidence/spec-review-2026-11-11.md`, 18 findings);
section 10 answers them and wins over the earlier sections where they
differ. Its choices C1 to C8 are the author's, for the user to confirm or
reverse.

Model: `docs/plans/2026-11-09-binding-units-model.md`. This spec replaces
rules 3 and 4 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md` and
the parts of rules 5 and 7 that follow from them. Measurements:
`docs/plans/2026-11-11-ce1210-type-read-cost.md`, sections 1, 2 and 10
(its sections 4 to 8, the counter, are withdrawn).

## 1. Why

The goal of the binding work is less code in the engine and in Tycho, and
simpler rules. It is not compatibility, and it is not the smallest change
for Tycho (user, 2026-11-11).

Slice 1 as built resolves each symbol in the CURRENT scope at each read of
its type and of its value. The model says something else: a unit is bound
once, and "an expression that the host holds is a value and does not
change" (model, section 2). The departure has three costs:

- **Speed** (CE-1210): a scope walk at each type read, a recorded read for
  each name in each cached type, and a check of those reads at each cache
  hit. Tycho's audit is 1.12 to 1.24 times slower, one interpreted call
  1.35 to 1.39 times. Neither a declaration nor `ce.infer()` on Tycho's side
  recovers it (Tycho's trials, 2026-11-11: 0 changed records, no gain).
- **Rules**: the walk needs the static view of the bindings, the scopes of
  stored values, the swept home of a block local, the binding of the
  caller, and the tests that tell them apart (`binders.ts`,
  `static-typing-view.ts`).
- **It lets a host change what an expression means by pushing a scope
  around it.** Tycho does this on every compile, around every expansion of
  a function, and at every evaluation of a document (666,697 such reads in
  its 115-document audit). These are the workarounds that the model is
  meant to remove.

## 2. The rule

1. **An expression resolves each name from the scope it was boxed in**
   (the home scope of the occurrence), for its type and for its value. The
   current scope plays no part.
2. **The resolution is cached, and done again when a definition of that
   name changes** in any scope (the counter of the name, model section 2).
   So a declaration or an assignment made later in the home scope, or in
   one of its ancestors, is read. A declaration in a scope that is not the
   home scope or an ancestor of it is never read.
3. **`ce.rebind(expr)` gives the expression bound in the current scope.**
   It is the only way to make an expression read another scope. A stored
   function body is bound again by the engine when a name it reads gets
   another definition (slice 2 of the model).
4. **A parameter, the variable of a binder and the local of a block** are
   names of the unit that the literal, the binder or the block belongs to.
   A call binds the parameters in its frame, a binder its variable in its
   scope, a block its locals in its run. This is unchanged.
5. **A scope that was popped keeps its definitions.** An expression boxed
   in it reads them, as it did before the pop.
6. **`compile()` takes the types of its inputs as options** and needs no
   scope: `inputs` (name to type), `symbolic` (names whose stored value is
   not inlined: they are inputs), `byReference` (lists passed by reference,
   with the element type and, for a shader, the width). A type given at the
   call wins over a definition, for that compilation only.
7. The environments of a unit, of an operation and of a trial (rules 2, 8
   and 13 of the slice 1 spec) are unchanged.

## 3. Examples

"Today" is run on the source at `830047dc6`. "Proposed" is derived from the
rule, not run. In rows 8 and 9 the type and the value of today disagree:
the two reads do not walk the scopes the same way.

| # | Program | Today | Proposed |
|---|---|---|---|
| 1 | `e = parse('x+1')`; push; `x: integer = 5`; `e.type`, `e.evaluate()` | `integer`, `6` | `number`, `x + 1` |
| 2 | `x: real = 0.5`; `e = parse('x+1')`; push; `x: integer = 5`; `e.type`, `e.evaluate()` | `integer`, `6` | `real`, `1.5` |
| 3 | `x: real = 0.5`; `e = parse('2x')`; push; `x: list<number> = [1,2]`; `e.type`, `e.evaluate()` | `list<number>`, `[2,4]` | `real`, `1` |
| 4 | as 1, 2 or 3, then `ce.rebind(e)` in the pushed scope | reads the pushed `x` | the same |
| 5 | `e = parse('x+1')`; then `x: integer = 2` in the same scope; `e.type`, `e.evaluate()` | `integer`, `3` | the same |
| 6 | `e = parse('x < 2')`; push; `x: real`; `compile(e)` | compiles | declines (`x` has no type); `compile(e, { inputs: { x: 'real' } })` compiles, with no scope |
| 7 | `a = 2`; `f := x ↦ a·x`; push; `a = 10`; `f(3)` | `6` | `6` |
| 8 | `e = parse('\\pi + 1')`; push; `Pi: integer = 3` (a library constant can be declared only in a nested scope); `e.type`, `e.evaluate()` | `integer`, `π + 1` (printed `1 + Module(Pi)` in that scope): the type reads the pushed `Pi`, the value does not | `real`, `π + 1`, printed the same way |
| 9 | push; `x: integer = 5`; `e = parse('x+1')`; pop; `e.type`, `e.evaluate()` | `integer`, `x + 1`: the type and the value disagree | `integer`, `6`: the popped scope keeps its `x` (rule 5) |

Row 9 is the largest change of meaning for a host that keeps expressions
across a pop. Its alternative is in section 8, D2.

## 4. The hard cases

- **The engine's own algorithms.** `Solve`, the integrals, `NIntegrate`,
  `Limit`, the trigonometric simplifications and the GPU compile push a
  scope, declare a variable in it, and read an expression that was boxed
  outside. 168 test files reach such a site (step 0 of CE-1210). The source
  has scope pushes in about 25 files (`solve.ts` 12, `function-utils.ts`
  14, `library/calculus.ts` 9, `javascript-structured-lower.ts` 12,
  `control-structures.ts` 5, `limit.ts` 3, …). Each site is changed to one
  of: bind the expression inside (`rebind`), substitute the variable, or
  declare nothing and pass the type to the operation. No site keeps a
  fallback to the current scope. The list by function is measurement M1.
- **A binder and an operand boxed outside** (approved 2026-11-11).
  `ce.function('Sum', [body, …])` with a `body` that was boxed outside: the
  binder boxes its body again in its own scope, so the occurrences of its
  variable in the body are bound to it, and the other names of the body
  keep their home scope. This is what rule 2 of the slice 1 spec says a
  binder does ("a binder that boxes its body again"). An operand of a
  function that is not a binder is not boxed again.
- **A stored value.** The value of a definition is an expression, so it
  reads the scope it was boxed in. "Evaluate with these values for a
  moment" is `ce.withValues()`, which writes on the existing definitions.
  It must accept a name that has no definition and a list value (Tycho,
  item 4).
- **`ce.function(op, operands)`** with boxed operands boxes nothing again:
  the operands keep their home scope. This is unchanged.
- **Caches.** A cached type depends on the environments (unchanged) and on
  the counters of the names it resolved. The recorded read of a resolution
  (`ResolutionToken`) and its check at each hit go away: the counters are
  in `ce._typeCacheGeneration()` already (a declaration moves it).
- **Cost of `rebind`.** Tycho would call it on two hot paths until the
  compile options and the macro kind remove them. Measurement M3.

## 5. What is removed in the engine

To be measured before approval (M2), by deleting in a worktree:

- the resolution from the current scope at each type read
  (`BoxedSymbol._unitType()`: `_contextBinding()` for a symbol with a
  definition, `freeNameBindingInContext()` from the current scope for a
  free name, `_ownDefinitionOnChain()`), and `ResolutionToken`,
  `noteResolutionRead()`;
- in the value read (`bindingInContext()`, `binders.ts`), every rule that
  accepts a definition of another scope than the home chain: the binding of
  the caller, the swept home, the scopes of stored values, the test of a
  foreign binder;
- the static view of the bindings (`static-typing-view.ts`), if nothing
  else needs it once a type read no longer walks the scopes;
- the sentence of `docs/SCOPING-MODEL.md` and of the guides that says a
  held expression reads a declaration made in a pushed scope.

## 6. What it removes in Tycho, and what the engine must provide

From Tycho's table of 2026-11-11 (sizes are upper bounds, lines with
comments, Tycho `c321f7e51`). The reads are those of its 115-document
audit that the rule changes.

| Tycho workaround | Reads | Construct that replaces it | Tycho lines deleted | The engine provides |
|---|---|---|---|---|
| Inlining of document functions and field macros: stored bodies substituted under parameter shadows, trees rebuilt with `ce.function()`, the `At` override | 476,000 | the macro kind (model slice 4): a definition bound at each reader as a local | about 3,900 (`document-ce-manager.ts`, `macro-arity.ts`) | the macro kind, with parameters; one local per macro in compiled code; one meaning for a stored and an inlined body (`max` of two arguments, `At`); a parameter that takes a list whole |
| The pop and push of the document scope at each evaluation, and the registration order code | not counted apart | the batch (model slice 3), with identity: an unchanged member keeps its definition | about 3,500, and 2,660 more if the batch returns types | the batch with the eight results of Tycho's answer of 2026-11-09 |
| The compile seam: declarations pushed around every compile | 185,000 | rule 6 | about 850 and 7 `rebind` calls | the three options of rule 6 |
| Style and colour expressions: snapshot values declared in child scopes | not in the audit | `ce.withValues()`; for colour definitions, temporary definitions for one evaluation (the macro mechanism) or the batch | about 250 | `withValues` for a name with no definition and for a list |

Tycho's order of value: the macro kind, then the batch, then the compile
options. The compile options are the smallest change of the engine.

## 7. Order of work

1. This rule (sections 2 to 5) with the compile options of rule 6. It
   closes CE-1210 and removes the compile seam in Tycho.
2. Stored function bodies as units with stamps (model slice 2), which rule
   3 needs for a body that reads a name defined later.
3. A fresh symbol (approved by the user on 2026-11-11, as its own short
   spec): a symbol with an identity that no parse produces, compared by
   identity, with a deterministic spelling when it is serialized or emitted
   in compiled code (numbered for each expression or compilation, not for
   the process). It is for a temporary that must be named at the top level.
   Most temporaries need no name once binding is lexical: a parameter, a
   binder variable, a block local and a macro cannot collide. It replaces
   the collision loops of the engine (`freshSymbol()` in
   `symbolic/series.ts`, the parameters of a periodic `Solve` family, the
   renaming of a block local at an application, `_ce_iterate_accumulator`)
   and of Tycho (seven generators; its list of 2026-11-11). It comes before
   or with the macro kind.
4. The macro kind (model slice 4).
5. The batch (model slice 3).

Each is a spec of its own. Steps 4 and 5 can change places; the user
decides (model decision 3).

**Delivery to Tycho** (user decision 2026-11-11). A step is delivered to
Tycho only when Tycho can delete code with it, even if the adoption is work.
Step 1 alone would make Tycho add a rebind around each expansion of a
function and after each swap of its document scope, so Tycho does not adopt
it alone: it stays on 0.187.1 until the steps that replace those
workarounds exist (the macro kind for the expansion, the batch for the
swap). The compile options can be adopted when they exist, since they only
delete code. Until an adoption, Tycho checks each step with its codegen
audit and its `othello` instrument on a scratch build, as on 2026-11-11.
A release of the engine between two adoptions is the user's decision.

## 8. Measurements before approval, and decisions

Measurements (each a result paragraph in this file):

- **M1.** The engine sites that read an outside expression in a scope they
  pushed, by function, with the change each one needs.
- **M2.** A prototype of rules 1, 2 and 5 in a worktree: the lines deleted,
  the test files that fail, sorted into "tests the old rule" and "an engine
  site of M1".
- **M3.** The time of `ce.rebind()` on Tycho's two hot paths, and the
  CE-1210 cases on the prototype (the loop, the rule loading,
  `ce-882-shared-copies`, Tycho's `othello` instrument and audit).

Decisions:

- **D1. The rule of section 2.** Recommended.
- **D2. Rule 5, a popped scope keeps its definitions.** Alternative: an
  expression whose home scope was popped resolves from the nearest ancestor
  that is still current. It is what a host that pops and pushes expects
  today, and it keeps a dependence on the current scope. Recommended: rule
  5 as written, with the batch as the answer for a host that rebuilds its
  scope.
- **D3. Rule 6, the compile options, in the same change as the rule.**
  Recommended: without them every host must push a scope or rebind to
  compile.
- **D4. The order of section 7.**

## 9. Results of the measurements

### M2, first part (2026-11-11): the answers, with nothing deleted

A prototype at `eed70f79a` changes four places of `boxed-symbol.ts`
(`docs/plans/2026-11-11-bound-once-evidence/prototype.patch.txt`, which
also holds the changes of M1 below; its new file is `hidden-values.ts.txt`;
about 30 lines): a free name resolves from its home scope for its type and
for its value, and a symbol with a definition reads that definition unless
it is a parameter, the variable of a binder or the local of a block. It
deletes nothing and keeps the caches as they are.

- The nine rows of section 3 give the "Proposed" column, except row 8,
  whose value is `1 + Module(Pi)` and not `π + 1` (not examined).
- Full suite (no nightly tests): 287 of 88,610 tests fail, in 107 of 2,038
  files. Step 0 had counted 294 files with a read that depends on the
  current scope: in most of them the answer does not depend on it.
- 32 of the 107 files push a scope in the test itself (the list is in the
  evidence folder). They test the old rule, or use the host pattern that
  `rebind` or the compile options replace.
- 75 files do not (180 of the 287 failures). The largest groups are the
  compile fallback, which evaluates the expression with its inputs declared
  in a scope of its own (`compile-absent-point-spelling` 26,
  `compile-fallback-absent-spelling` 24, `compile-entry-string-refusal` 11,
  `interval-fallback-answers` 4), compiled calls of user functions
  (`multi-clause-compile` 7, `compile-unemittable-function-value` 7), and a
  free name captured by a function literal (`ce-473-captured-free-symbol`
  6, `issue-489-curried-function-capture` 6, `hold-values` 5). `Solve`, the
  integrals and the limits do not fail.

### M1, first part (2026-11-11): the interpreted fallback of `compile()`

The largest group of the 75 files is one engine function: the `run` that a
declined compilation returns (`fallbackRun`, `compile-references.ts`). It
pushed a scope, declared a shadow of each input with the type of its
run-time value (six cases) and assigned it, then evaluated the expression,
which was boxed outside. With the rule it becomes
`ce.withValues(values, () => expr.evaluate())`: 22 lines in place of 51,
and no scope. With that one change, the nine test files of the group pass
(222 tests), and the full suite goes from 287 failures in 107 files to 110
in 48.

What remains, 110 failures:

- 55 in 27 files that push a scope in the test.
- 55 in 21 files that do not: `HoldValues` and the value shield, which hide
  a value with a valueless shadow in a scratch scope (`hold-values` 5,
  `value-shield-scratch-scope` 3); a free name captured by a function
  literal and the renaming of a local at an application
  (`ce-473-captured-free-symbol` 6, `issue-489-curried-function-capture`
  4, `derivative-user-function-body` 3, four files with 1);
  `tycho-325-integrate-list-limit-broadcast` 7 (its helper declares values
  in a scope: the host pattern, in a helper); `simplify` 5;
  `ce-597-unknowns-library-letter-operand` 4;
  `ce-535-531-binder-declaration-cache` 4; ten files with 1 or 2.

### M1, second part (2026-11-11): the value shield

The second engine site is the value shield (`withValueShield()`,
`boxed-expression/utils.ts`, called at 15 places of `library/calculus.ts`
and by `HoldValues`; and the same arrangement in `simplifyValueBlind()`,
`simplify.ts`). To make a name read as a pure symbol, it pushed a scope,
made it a scratch scope, declared a valueless shadow of each name, marked
each shadow as a shield, ran the work under a cache key of its own, popped
the scope, and bound the result again away from the dead shadows
(`rebindEscaping()`). In the prototype it is a list of names whose value is
hidden for the extent of the call, which the value read tests: 12 lines in
place of 137 in the two functions. The marks of a shield
(`markShieldDeclaration()`, `isShield()`, six tests in `binders.ts`) and
the scratch scope of a shield then have no user; they are not deleted in
the prototype.

With it, of the 48 files that still failed: 87 failures in 39 files (51 in
25 files that push a scope in the test; 36 in 14 files that do not). The
full suite was not run again after this change.

The 36, by mechanism:

- An operand boxed outside and placed under a binder with `ce.function()`
  reads the outer value (`ce-535-531-binder-declaration-cache` 4,
  `hold-values` 3). The rule says an operand keeps its home scope; whether
  a binder binds an operand that was boxed outside is a case for section 4.
- A free name captured by a function literal, and its type after an
  assignment (`ce-473-captured-free-symbol` 6); the renaming of a block
  local at an application (`issue-489-curried-function-capture` 4).
- A library letter read as a variable and assigned later
  (`ce-597-unknowns-library-letter-operand` 4).
- `tycho-325-integrate-list-limit-broadcast` 7: its helper declares values
  in a scope.
- Eight files with one failure each.

The full suite with the shield change: 97 failures in 46 files (it broke
tests in five files that passed before: `calculus`,
`caller-local-argument-binding`, `ce-1102-…`, `ce-616-…`, `ce-827-…`; not
examined).

### M2, second part (2026-11-11): lines

The prototype so far is +59 and −202 lines in 5 files, with one new file
of 28 lines. It also drops the recorded read of a resolution for a free
name (11 lines become 4). It does not delete the code that lost its users.
What then has no user, or only the users that the rule removes, by a count
of references in the prototype: `noteResolutionRead()`, `ResolutionToken`
and its registry, `homeScopeKey()`, `_ownDefinitionOnChain()`; for the
shield, `markShieldDeclaration()` (12 references in 4 files), `isShield()`
(8), `binderHidesAssignedValue()`. What the value read of a parameter, a
binder variable and a block local still needs is not measured:
`binders.ts` has 2,256 lines, `static-typing-view.ts` 325,
`scratch-scopes.ts` 111, and `rebindEscaping()` and `withScratchScope()`
have other callers (20 and 17 references).

### M3 (2026-11-11): not conclusive

The machine was loaded during both attempts (load 9 to 15 under the box
lock, then 29), so these are indications only. Production builds, three
pairs, Tycho's `othello` instrument (median of 15 rounds): base 914, 875,
723 ms; prototype 648, 787, 650 ms. The loop of undeclared symbols shows
no clear difference on the builds (the recorded reads were still there),
and about 5% on the source after the recorded read of the resolution was
dropped (minimum of 11 runs: 922 to 967 ms against 885 to 908 ms). The
cost of `ce.rebind()` is not measured. A measure on a quiet machine, by
Tycho's method, is still owed.

## 10. After the review (2026-11-11)

Numbers in parentheses are the findings of the review file.

### C1. The one exception to rule 1: activations (1, 2, 15)

Rule 1 is about which DEFINITION a name means. A parameter, the variable of
a binder and the local of a block mean their declaration in the scope of
the literal, the binder or the block, by rule 1 like any name. Their VALUE
is another matter: it belongs to one call or one run. It is read in the
activation of that scope that the evaluation in progress is in, or, for a
function value that left its call, in the activation that it kept
(`retainCallFrameOfResult()`, `retainScope()`). This lookup
(`bindingInContext()` for these three kinds: `callerBinding()`, the swept
home, `activationBindingOf()`) stays as it is in step 1, and so do the keys
of the type cache for a call frame. Recursion and closures work as today;
`issue-489` and `ce-473` are acceptance tests.

So section 5, second bullet, is reduced: step 1 removes from the value read
only what accepts a plain declaration of another scope than the home chain.
What the activation lookup can lose is measured in the result of step 1,
not promised. A simpler activation lookup (a stack of activations for each
scope, read directly) is a later step, with stored bodies.

Alternative: replace the lookup now. Not chosen: it is a second mechanism
in one change.

### C2. Rule 2 applies to every occurrence (9)

An occurrence that had a definition at boxing is not pinned to it. It keeps
its home scope, and resolves again from it when the counter of its name
moved: an occurrence boxed in a child scope, which read the definition of
an ancestor, reads a declaration made later in that child. The prototype
pins it; the implementation does not. The head of a call follows the same
rule: "Callable resolution" of `docs/SCOPING-MODEL.md` (an existing call
keeps its selected binding) is replaced. Example for the tests: `x: real`
at the top; push; `e = parse('x+1')`; `ce.declare('x', 'integer')` in the
pushed scope; `e.type` is `integer`.

### C3. The home chain is fixed (8)

The parents of a home scope, as rule 1 walks them, are those of the boxing.
The chaining of the scope of a binder or a block onto the ambient scope at
evaluation (`ambient-chain.ts`, `scope-chaining.ts`, the ruling of
2026-09-15 in `docs/SCOPING-MODEL.md`: "a directly evaluated expression
reads the environment it is evaluated in") is reversed by rule 1 and is
removed, with the memo path that resolves through it
(`withAmbientChain`). `Sum(n·k, k, 1, 3)` boxed at the top reads the `n` of
the top.

The recorded read of a resolution is dropped only for a kind of occurrence
for which this holds: the resolution from the home chain changes only at a
declaration, and a declaration moves `typeVersion`. That is a free name
and a symbol with a plain definition, once the ambient chaining is gone.
For a parameter, a binder variable and a block local the keys of today
stay (C1).

### C4. Temporary values and hidden values: `ce.withValues()`, nothing new (3, 4, 14)

Revised on 2026-11-11 and confirmed by the user the same day. The first
answer to the review was a new record on the evaluation context. It is
withdrawn: the engine already has the construct.

`ce.withValues(values, fn)` writes each value on the definition of the
name and puts back the earlier value and type when `fn` returns; the value
`undefined` gives the name no stored value while `fn` runs. The
interpreted fallback of `compile()` and the value shield (`simplify()`,
`HoldValues`, the calculus functions) use it, and their scopes, shadow
declarations and shield marks are deleted. No mechanism is added.

Known costs, measured in step 1 and reported, not designed around:

- A write on a definition moves the type version, so each call retires
  cached types. The scratch scope of the shield existed to avoid that.
- `withValues` finds a definition from the current scope. An engine site
  runs it where the names of its expression resolve.
- `withValues` is synchronous and refuses a value outside the declared
  type.

If the first cost is too high, the remedy is a change of how `withValues`
is built (a record that the value read tests, with no write), behind the
same API. That is a later decision, taken on figures.

### C5. A popped scope (5)

`popScope()` keeps releasing what a definition subscribed to (a popped
definition is not rounded again at a change of precision), and stops
marking the definitions as dead: a read of one by an expression boxed in
the scope is valid, and the debug check of dead bindings
(`ce._debugBindings`, `assertLiveRead()`) no longer fires for it. The same
holds for `InspectableScope.dispose()`. The marks that keep a call frame
for a function value (C1) stay.

### C6. The compile options (6)

Step 1 delivers two options; the third waits.

```ts
inputs?: Readonly<Record<string, TypeString>>;
symbolic?: readonly string[];
```

- A name in `inputs` is an input of the compilation with the given type.
  Its stored value, if any, is not folded. The given type replaces its
  declared type, its inferred type and the requirement of its unit, for
  this compilation only, in the expression and in the stored bodies and
  values that the compilation reads. It does not apply to an occurrence
  that a binder of the expression binds. The rules of
  `docs/COMPILATION-MODEL.md` for an input apply to the given type:
  `unknown` and `any` are refused, a union is a dispatch.
- A name in `symbolic` is an input with the type it has (declared, or
  given in `inputs`); with no type it is refused as an untyped input. It is
  `inputs` with the current type of the name.
- The constant fold and the interpreted fallback read the given types and
  treat the named values as absent.
- How the engine does it is not part of the contract: it may bind the
  expression again in a scope of its own, as `compiler-core.ts` does for a
  declared union.
- `byReference` (lists passed by reference, the width of a sampler) is not
  in step 1: its relation to the existing options `storage` and `vars`,
  and what it promises about aliasing and writes in place, need a section
  written with Tycho.

### C7. Binders, comparisons, stored bodies, serialization (10, 11, 13, 16)

- **Binders.** The heads whose operands have a `bound` or `clause` role
  (`docs/SCOPING-MODEL.md`, "Binders"), `Function` and `Block` included.
  When `ce.function()` makes one from a boxed body, it boxes the body again
  in its scope: every free occurrence of its variables is bound to it,
  whatever it resolved to before, and an inner binder of the same variable
  is not entered. `subs()` and `replace()` box nothing again, except
  through a binder they build this way.
- **`sameBinding()`**, `readBinding()`, the getters of a free name and the
  collection protocol (rules 5 and 7 of the slice 1 spec) use the
  resolution of rules 1 and 2. Two occurrences of one name with different
  home scopes that resolve to different definitions are different symbols:
  `x - x` is `0` only when both resolve to the same definition, or both to
  none in the same home scope.
- **A stored function body in step 1.** Rule 2 already gives it a
  definition made later for a name it reads. What it does not give is a
  reading fixed at boxing (a head read as a variable, `N` as a variable).
  The registry of waiting definitions and its repair stay in step 1, with
  their lookup from the home scope of the body; slice 2 replaces them.
- **Serialization** (`.json`, `.latex`, `toString()`) is not a read of a
  type or a value. It keeps qualifying a library name against the current
  scope, as today (row 8).

### C8. Acceptance of step 1 (7, 12, 17)

1. A test for each row of section 3 and for the examples of C2 and C3,
   written with the API calls, with the "Proposed" result.
2. M1 complete: each place of the engine that pushes a scope, in a table
   in the evidence folder, with what it declares, its remedy (bind inside,
   substitute, a temporary value, or an entry in the environment of the
   operation, which is what "pass the type" means), and a test that shows
   which definition is read.
3. Every test that the change makes fail is sorted: it tests the old rule
   (rewritten with `rebind`, `withValues` or the compile options, listed by
   file in the result), or it is an engine site (fixed). None is left.
4. The full suite and the nightly suites pass; lint, `check:docs`,
   `check:deps`.
5. The result paragraph lists the code removed, with line counts, against
   section 5 as reduced by C1.
6. Time, on a quiet machine by Tycho's method: its `othello` instrument and
   its codegen audit sum within 10% of 0.187.1 with `CE_BINDING_UNITS=0`
   (473 to 493 ms; 40.5 to 42.0 s); the loop of undeclared symbols and
   `integration-rules.test.ts` are reported, with no threshold in step 1
   (their cost is the recorded reads of the unit environments, which rule 1
   does not remove).
7. Tycho's codegen audit on a scratch build: the records that change are
   listed and explained by the rule (Tycho does not adopt step 1: section
   7).

## 11. After the first implementation (2026-11-11)

A first implementation of sections 2 and 10 (the patch is
`2026-11-11-bound-once-evidence/step1-round3.patch.txt`; 423 test files
pass with it; source +732 and −898 lines) needed four narrow rules to pass,
and its net removal fell at each round of fixes (389, 290, 166 lines). The
user and the author read this as a sign that two choices of section 10
were wrong. Three decisions of the user, 2026-11-11, replace them.

### D5. A binder and a boxed operand: what the engine does today (replaces the binder case of section 4 and of C7)

Revised 2026-11-11 (user: "as long as we have a rule we can explain, let's
go with the one that is easiest to implement"). The first form of D5, "a
boxed operand is never captured", is withdrawn: with it 267 tests failed in
51 files, about 200 places of the engine build `D`, `Function`,
`Integrate`, `Sum`, `Map` or `Block` around boxed parts, and the raw form
that it told them to pass binds every other name of the body again in the
current scope, against rule 1.

The rule is the one of the two mechanisms that exist (the post-phase of
the binder hook, `bindBindingSites`, `boxed-expression/box.ts`, and the
parameter repair of a function literal, `rebindParameters`,
`function-utils.ts`), unchanged: a binder with a variable operand
(`Function`, `Sum`, `Product`, `Integrate`, `D`, …) built around a boxed
operand binds the occurrences of its variables in that operand. A `Block`
does not: a statement boxed outside the block keeps its names, because the
`Declare` of the block makes a new variable. With `x: real = 5`:

| Program | 0.187.1 | With this rule |
|---|---|---|
| `Function(ce.parse('x^2'), x)` applied to 3 | 9 | 9 |
| `Sum(ce.parse('k^2'), k = 1..3)` | 14 | 14 |
| `Block(Declare(x, 7), ce.parse('x+1'))` | 8 | 6 |

Nothing is added for it. Whether the two mechanisms match an occurrence by
its spelling or by its definition is not examined; a capture of a variable
of the same spelling from another scope, if a test shows one, is an issue
file.

### D6. Activations (replaces C1)

Every evaluation of a function literal, of a binder and of a block makes an
activation: the values of its locals for that evaluation, with a link to
the activation in which the literal, the binder or the block was itself
evaluated. A parameter, a binder variable and a block local are read by
following these links from the activation of the evaluation in progress. A
function value keeps the link of the activation that made it. There is no
search of the stack of evaluations in progress. The results of these
programs are unchanged; they are the acceptance tests of D6:

| Program | Result |
|---|---|
| `add(a) := x ↦ x + a`; `g := add(2)`; `h := add(10)`; `g(1)`, `h(1)` | 3, 11 |
| `kk(a) := g(1)`; `kk(100)` | 3 |
| `fact(5)`, recursive | 120 |
| `Block(s = 0, Loop(Block(s = s + i), i in 1..4), s)`, also asynchronous and two at a time | 10 |

It replaces the caller binding, the swept home, the marks that keep a call
frame for a function value, and the two narrow rules of the first
implementation (an activation for a nested scope only when its parent has
one on the stack; a search of the stack for a parameter). It is part of
step 1. Its design is
`2026-11-11-bound-once-evidence/activations-design.md` (six steps, about
700 lines deleted by its estimate); the user approved it on 2026-11-11.

### D7. The two other narrow rules

- The placeholder of a renamed call of a user function that shadows a
  library operator (`shadowing-calls.ts`): the renamed call is bound
  directly to the copy that holds the function, so nothing is read through
  the current scope. The rewrite of the compiler does not replace this
  file (session compute-engine-7a, 2026-11-11: three targets use it).
- The declaration event after a rollback of an inference exists because
  some inferences still write on definitions (the parts of the earlier
  mechanism that the removal of the flag left). It goes when those writes
  go; the list of those parts, with an example of each, is owed to the
  user.

### D8. A local of a block is declared (user decisions, 2026-11-11)

The second step of the activations stopped on `Block(c := 5, 2c)`: a run of
a block removed the definitions that the boxing made and made new ones, and
the assignment wrote the new one. With D6 a run makes no definition. The
user then chose to remove the guess that made it necessary:

- **A local of a block is made only by a `Declare`, and a `Declare` is
  allowed only at the top level of a block.** A `Declare` in a branch of an
  `If`, or anywhere else below a statement, is an error.
- **`Assign(c, v)` writes the `c` that is in scope and never makes one.** In
  a block, with no `c` in scope, it is an error.
- **The type of a local** is the type that its `Declare` gives, or the type
  of the initial value of the `Declare` as known at boxing; `unknown` when
  nothing is known.
- **A run of a block writes the values of its locals in its activation and
  makes no definition.** The removal of the definitions of the boxing at
  each run, the definitions of a run, and the evidence that an assignment
  makes a local (`sweepCanonicalizationBindings()`,
  `declareAssignmentLocals()`, `createBlockLocals()`, the
  `first-assignment-in-branch` check) are removed.
- **Epsil**: a local is written with `let` (user: "that would be OK").
  An assignment without `let` writes an existing variable.

| Program | 0.187.1 | With D8 |
|---|---|---|
| `Block(Declare(c, 5), 2c)` | 10 | 10 |
| `Block(c := 5, 2c)`, no `c` in scope | 10, a new local | error: `c` is not declared |
| `Block(c := 5, 2c)`, a global `c` | 10, a new local hides the global | 10, and the global `c` is 5 |
| `Block(If(True, Declare(t, 3)), t)` | 3 | error: a declaration in a branch |
| `Block(If(False, Declare(t, 3)), t)`, a global `t = 9` | 9 | the same error |

The survey (`2026-11-11-bound-once-evidence/d8-survey.md`) answered the
open points, and the user decided the rest on 2026-11-11:

- **LaTeX**: no change. In a `;` block the parser already gives a
  `Declare` for the first `:=` of a name and an `Assign` for the later ones.
- **Epsil**: the spelling is the existing `let c = 5`. The top level of a
  program is a block: a variable is introduced by `let` there too (user:
  "require the `let`"). 17 programs of the documentation and 1 of the
  corpus change; Tycho's 13 onboarding preludes need none.
- **Outside any block** (`ce.assign('c', 5)`, an `Assign` evaluated at the
  host level): it declares the variable in the current scope, as today.
- **Two declarations of one name in one block**: an error, as today
  (`variable-redeclaration`).
- **A read before the declaration**: the name means the local in the whole
  block; a read before its `Declare` runs is an error, as today
  (`read-before-declaration`); the initial value of a `Declare` is computed
  with the outer name (`Block(Declare(z, z + 1), z)` with a global `z = 9`
  is 10).
- **Destructuring**: the same rule; new names need a declaration.
- **The type of a local** with an initial value: the type of that value as
  the boxing types it.

D8 deletes about 890 lines by the survey's count (the removal of
definitions at each run, the definitions of a run, `assignment-locals.ts`,
the assignment evidence). Up to 212 test files have a block that assigns a
name it does not declare; 12 are about the implicit local and change in
meaning.
