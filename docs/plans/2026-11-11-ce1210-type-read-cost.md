# CE-1210: the cost of a type read with binding units

Status: DRAFT for the user's approval. No code is written.

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
   marks. Result: a table in this file, and a decision to continue, to split
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
