# Binding units: an expression is bound once

Status: the direction is approved by the user on 2026-11-11 ("I'm on board
with the spec"), and so is the delivery rule of section 7. The decisions D1
to D4 of section 8 wait for the measurements M1 to M3. No code is written.
Not yet reviewed with `/review-spec`.

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
| 8 | `e = parse('\\pi + 1')`; push; `Pi: integer = 3` (a library constant can be declared only in a nested scope); `e.type`, `e.evaluate()` | `integer`, `1 + Module(Pi)`: the type reads the pushed `Pi`, the value does not | `real`, `π + 1` |
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
3. The macro kind (model slice 4).
4. The batch (model slice 3).

Each is a spec of its own. Steps 3 and 4 can change places; the user
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
(`docs/plans/2026-11-11-bound-once-evidence/prototype-four-sites-and-fallback.patch.txt`,
which also holds the change of M1 below;
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

Not done: the full suite on the prototype with the shield change, the
deletions of section 5, M3 (running).
