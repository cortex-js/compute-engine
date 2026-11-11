# CE-1210: the cost of a type read with binding units

Status: step 0 APPROVED by the user on 2026-11-11; the rest is a draft.
The user is open to reversing a decision of the model when the measure
shows that it causes the cost (section 9). No code is written.

Issue: `issues/CE-1210.md`. Model: `docs/plans/2026-11-09-binding-units-slice-1-spec.md`
(rules 3, 4, 8 and 13).

## 1. The problem

Since 0.187.0 the type of a symbol is computed at each read, and the cached
type of a compound expression is checked at each hit against every symbol
read under it. Before, a symbol read the type of its definition and a hit
compared one number (`ce._typeCacheGeneration()`).

Measured on 2026-11-11 (units off / units on; the figures and their
conditions are in the issue):

| Case | Off | On |
|---|---|---|
| parse and simplify, undeclared symbols, 2,000 rounds | 3.0 to 3.3 s | 4.0 s |
| the same loop with the symbols declared (CPU, 3,000 rounds) | 443 to 450 ms | 477 to 483 ms |
| `integration-rules.test.ts` (loads the rule bundle) | 8.5 s | 15 to 16 s |
| `ce-882-shared-copies.test.ts` (a chain of 20,000 calls) | 5.7 s | 27 to 30 s |
| Tycho codegen audit, 115 documents | 41.0 s | 52.5 s |
| Tycho `othello`, one interpreted call (CPU, whole process) | 9.6 s | 10.8 s |

The off column will not exist after the flag is removed. The targets of
section 6 are therefore absolute times, taken from this column.

## 2. Where the time goes

Three costs, from CPU profiles of the loop, of the rule loading and of the
`othello` call:

1. **The read of a free name** (`BoxedSymbol._unitType()`, the branch with no
   definition). Each read looks for the entry of the name in the environment
   of the trial, of the operation and of the unit
   (`readUnitEntry()`), tests the variable record (`readsUnitVariable()`),
   and resolves the name from the current scope
   (`freeNameBindingInContext()`). The loop makes 3.4 million such reads.
2. **The read of a symbol that has a definition** (the other branch). Each
   read resolves the name from the current scope (`_contextBinding()`), to
   find a declaration in a pushed scope that hides the definition, and reads
   the entry of the definition when its type is inferred or `unknown`. In
   the `othello` call this is about 290 ms of the 1.2 s added.
3. **The check of a cached type.** The cache of a compound expression keeps
   three recorded reads for each free name under it and one for each
   definition with an inferred type (`UnitReadToken`, `ResolutionToken`,
   `binding-unit.ts`). A hit computes the version of each recorded read
   again (`objectDepsValid()`), which repeats costs 1 and 2, and merges the
   reads into each cache that is being computed (`mergeObjectDeps()`). In
   the rule loading this is the largest part.

An experiment that made the versions of the recorded reads free (unsound)
moved the rule loading from 1.70 to 1.47 times the time with units off. So
a cheap version is not enough: the walk of the recorded reads at each hit,
and the direct reads, must also go.

## 3. What a type read depends on

A read of the type of a symbol gives the same result as the previous read
of the same symbol when none of the following changed. The table names
where each one is written today.

| State | Written at |
|---|---|
| The entries and the variable records of a unit environment | `UnitEnvironment`, 5 sites that move `_counter`, and the undo of the journal (`binding-unit.ts`) |
| The operation and the trial in progress | `EngineBoxingState.withOperation()`, `withTrial()`, and the capture and restore of an asynchronous operation |
| The current scope | `ce._evalContextStack`: 2 pushes and 2 pops (`engine-scope.ts`), 7 assignments of the whole stack (`effects-registry.ts`, `function-utils.ts`, `lazy-view-context.ts`, `index.ts`) |
| The bindings of a scope | `scope.bindings.set()`, `.delete()`, `.clear()`: 60 sites in 19 files; a scope is made at 36 sites |
| The parent of a scope | 8 sites (`engine-scope.ts`, `ambient-chain.ts`, `function-utils.ts`, `engine-inspectable-scope.ts`) |
| The static view of the bindings | `static-typing-view.ts`: `hiddenBodyBindings`, `appliedBodyScopeCount`, `frameBodyScopes` (5 sites) |
| The scopes of stored values | `storedValueScopes.add()`, 2 sites (`binders.ts`) |
| The type of a definition, the assumptions | already counted: `typeVersion` (`engine-configuration-lifecycle.ts`) and the facts bit, both in `ce._typeCacheGeneration()` |

Marks on a definition that the resolution reads (binder variable, parameter
of a function literal, activation, block local, body free name) are set when
the definition is made, before any read of it. Step 0 checks this claim.

## 4. The design

### 4.1 One counter for each engine

`ce._bindingEpoch`: a number that moves at every write of the first seven
rows of the table. The last row keeps its own counter, which every cache
already reads.

The writes are made to pass through few places, so that a missed site is a
type error or cannot be written:

- **Unit environments.** One private method of `UnitEnvironment` moves
  `_counter`; it also moves the epoch of every engine (a module counter:
  an environment does not know its engine, and a write is rare next to a
  read).
- **Operations and trials.** The push and the pop in `EngineBoxingState`.
- **The current scope.** `_evalContextStack` becomes a private field with one
  setter and the two push and pop functions; each moves the epoch.
- **Bindings.** `Scope.bindings` becomes a `ScopeBindings`, a subclass of
  `Map` whose `set()`, `delete()` and `clear()` move the epoch. The type of
  the field changes, so a scope made with a plain `Map` does not compile.
  `Scope` is an exported type: a host that builds a scope by hand must use
  the class. This is a breaking change of an advanced API; section 8, D2.
- **The parent of a scope, the static view, the stored-value scopes.** One
  function for each, in the module that owns the state.

### 4.2 What the counter is used for

Three uses, in the order of their gain. Each one keeps the recorded reads
and their versions as they are: the counter only says "nothing changed
since I last looked", it never says what the answer is.

- **(a) A hit of a cached type.** A cache entry keeps the epoch at which
  its recorded reads were last found valid. A hit at the same epoch skips
  `objectDepsValid()`. This removes cost 3 for repeated hits between two
  writes.
- **(b) The type of a symbol.** A symbol keeps its last type with the epoch
  and the value of `_typeCacheGeneration()` at that read. A read at the same
  two values returns it. When a cache is being computed, the symbol also
  reports the reads that it recorded the first time (kept with the type), so
  the caches see what they see today. This removes costs 1 and 2 for
  repeated reads.
- **(c) The version of a recorded read.** `UnitReadToken` and
  `ResolutionToken` keep their last version with the epoch. This makes a
  check that (a) does not skip cheaper.

### 4.3 The risk, and how the work is checked

The counter moves at each call of a function literal (a scope is pushed)
and at each requirement written while an expression is boxed. If it moves
between most pairs of reads, the three uses gain nothing. This is measured
before anything is built (step 0).

A missed write site gives a stale type, with no error. Two protections:

- The choke points of 4.1.
- **A check mode**, `CE_BINDING_EPOCH_CHECK=1`: every answer taken from a
  memo is also computed the long way, and a difference throws. The full
  suite, the nightly suites and Tycho's codegen audit run in this mode
  before the memo is turned on. The mode stays in the source for later
  changes of the scope code; it is an environment variable read once, not
  an engine option.

## 5. Steps

Each step is one commit with the full suite green.

0. **Measure.** Counters, behind a temporary environment variable, on the
   six cases of section 1: the number of type reads, of cache hits, and of
   writes of each row of the table; the number of reads and hits that follow
   the previous one with no write between them. Check the claim about the
   marks. Also the counts of section 9, which say how often each rule of the
   model changes an answer. Result: a table in this file, and a decision to continue, to split
   the counter (for example one for the environments and one for the scopes,
   if scope pushes dominate), or to stop. The counters are removed.
1. **The choke points** of 4.1 and the counter, with no reader. No behavior
   change. The breaking change of `Scope.bindings` is in this step.
2. **Use (a)**, with the check mode. Measure.
3. **Use (b)**, in the check mode first. Measure.
4. **Use (c)**, only if the profile after step 3 still shows the versions.
5. **CE-1200** (`isFinite` of a function expression is not cached): cache it
   with the keys of the type cache. It is a separate, small change that
   removes the quadratic walk of `ce-882-shared-copies`, with any design.

## 6. Acceptance

- The values of every test are unchanged; the full suite and the nightly
  suites pass, also in the check mode.
- Times, under the box lock, one worker, three rounds, against the off
  column of section 1: the loop within 10%; `integration-rules.test.ts`
  within 15%; Tycho's audit sum and the `othello` instrument within 10%
  (measured by Tycho on a build). `ce-882-shared-copies` within 15% after
  step 5.
- No recorded read is removed: a cache entry is valid in exactly the cases
  where it is valid today (the check mode shows it).

## 7. What this does not do

- It does not change the rules of the model. A symbol still reads the
  declaration that hides its definition, and an operation still reads the
  environments of its input.
- It does not make a first read cheaper. An expression that is boxed, typed
  once and dropped pays what it pays today. If step 0 shows that most reads
  are first reads, the work is elsewhere: fewer recorded reads for each name
  (option 2 of the issue), or a cheaper resolution
  (`freeNameBindingAndScope()`, which package B offered to review).

## 8. Decisions for the user

- **D1. Go for step 0.** It is a measurement, a few hours, and it decides
  the rest. Recommended.
- **D2. `Scope.bindings` becomes a class.** Alternative: keep the `Map` and
  move the counter at each of the 60 write sites by hand; a new site that
  forgets it gives a stale type. Recommended: the class. A host that reads
  `scope.bindings` is not affected; a host that builds a scope by hand is
  (none known: Tycho's `src/` and `workers/` have no `bindings: new Map` and
  no write of `.bindings`, by a search on 2026-11-11).
- **D3. The check mode stays in the source** after the work. Alternative:
  remove it with the counters of step 0. Recommended: keep it.
- **D4. The order with the flag removal.** This work starts after the
  removal of `_bindingUnits` is committed, so that it is written once.
  Recommended.

## 9. Rules of the model that cause the cost

The counter of section 4 keeps every rule and pays for them with a memo.
The other way is to change a rule. Each rule below is a decision of the
slice 1 spec; step 0 counts how often it changes an answer, in the full
suite and in Tycho's audit, so that the choice is made on figures.

| Rule | What it costs | What reversing it would mean | Count of step 0 |
|---|---|---|---|
| R-a. A free name resolves in the current scope at each read (rules 3 and 4): a held expression reads a declaration made later, also in a pushed scope. | The scope walk at each read, and one recorded read for each name in each cache (costs 1 and 3). | A free name resolves from its home scope; a declaration moves `typeVersion`, as today, so a later declaration in the home chain is still read. A declaration in a pushed scope is read only after `ce.rebind(expr)`, which Tycho already calls at each of its compile sites. | Reads whose resolution from the current scope differs from the resolution from the home scope. |
| R-b. A symbol that has a definition reads a declaration that hides it in a pushed scope (`_contextBinding()` at each type read). | The scope walk at each read of every bound symbol (cost 2). Before binding units a bound symbol read its definition. | A bound symbol reads its definition; `ce.rebind(expr)` binds it to the hiding declaration. | Reads where `_contextBinding()` gives another definition than the symbol's own. |
| R-c. A read looks in the environment of the trial, then of the operation, then of the unit, each through its parents (rules 8 and 13). | Three lookups at each read, and the walk of the input of an operation. | No alternative proposed: the order independence of an operation depends on it. The lookup can be made cheap (an environment with no entry is skipped). | Reads that find an entry in the operation or the trial, against reads that find it in the unit or nowhere. |
| R-d. A cache records three reads for each free name (entry, variable record, resolution). | The walk at each hit is three times longer (cost 3). | One recorded read with a combined version (option 2 of the issue). With R-a reversed, the resolution read disappears. | Recorded reads for each cache entry, by kind. |

Reversing R-a and R-b removes the resolution from the read path and from
the caches, with no counter and no memo: a type read then depends on the
environments (R-c) and on `ce._typeCacheGeneration()` only. It changes
documented behavior of 0.187.0 (a held expression and a declaration in a
pushed scope), so it needs the counts, the list of tests that change, and
the user's decision.

## 10. Result of step 0 (2026-11-11)

Counters in a worktree at `830047dc6`, removed after the measure. Full suite
(88,207 tests, 1,972 test-file records), and four small cases.

**Repeats** (a read or a check that follows the previous one of the same
symbol or cache entry with no write of an environment, an operation, a
trial or the scope stack between them; writes of scope bindings are not
counted, so these are upper bounds):

| | Full suite | Loop, undeclared | Loop, declared | Rule loading | Tycho `othello` call |
|---|---|---|---|---|---|
| Type reads of a free name | 86.4 M, 93% repeat | 706 k, 94% | none | 1.1 M, 88% | none |
| Type reads of a defined name | 212.6 M, 97% repeat | 46 k, 85% | 757 k, 96% | 3 k | 1.9 M, 88% |
| Checks of a cached type | 98% repeat | 90% | 77% | 89% | 86% |

The counter of section 4 would therefore work. In the `othello` call, 5.5
million lookups of an environment entry all find nothing.

**Reads whose answer depends on the current scope** (what the rules R-a
and R-b of section 9 pay for), full suite:

| Read | Total | Finds a definition that the host declared directly | Finds one that the engine declared |
|---|---|---|---|
| Type, free name | 86.4 M | 2,165 | 248,871 |
| Type, defined name | 212.6 M | 37,254 | 160,366 |
| Value, free name | 24.0 M | 906 | 31,187 |
| Value, defined name (not a parameter, a binder variable or a block local) | 33.8 M | 50,486 | 4,378 |

"The host declared directly": `ce.declare()` or `ce.assign()` called with at
most four engine frames before the first frame outside the engine.

- 126 test files have a read that finds a host declaration. Two kinds:
  a declaration that shadows a library name in the same scope (`Pi` in
  `shadowed-constants`, `module-qualified-name`, `solve-domain`), and a
  declaration in a pushed scope read by an expression boxed before it (`s`
  in `tycho-325-integrate-list-limit-broadcast`, `T` in
  `compile-gpu-shared-calls`, `t` in the compile fallback tests).
- 168 more test files have such a read only for a definition that the
  engine declared: `Solve`, the integrals, `NIntegrate`, the trigonometric
  simplifications and the GPU compile push a scope, declare a variable in
  it and read an expression that was boxed outside. These are sites of the
  engine that reversal B would have to rebind.
- In the four small cases and in Tycho's `othello` call, no type read
  depends on the current scope.

**Tycho's source audit** (78 `pushScope` calls): 6 affected sites, 4 that
are affected by the rule as proposed (a tree rebuilt with `ce.function()`
from operands boxed outside; a stored value evaluated while its
dependencies are assigned in a child scope, for which `ce.withValues()` is
the construct), the rest not affected. Its run of a counting build is
pending.

**What the figures say.** Both designs are possible. The counter keeps
every answer and needs the choke points of 4.1. Reversal B removes the
resolution from the type read and from the caches, changes the answers of
the reads above, and needs: a rebind at each engine site of the 168 files
(to be listed from the reports, by engine function), the two kinds of host
dependence decided (a shadow of a library name in the same scope must keep
working: a symbol then resolves by name from its home scope, cached on
`typeVersion`, not from the definition it had at boxing), and six to ten
edits in Tycho.
