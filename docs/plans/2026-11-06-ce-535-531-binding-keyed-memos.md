# Memos keyed on the bindings they read (CE-535, CE-531, CE-321)

Status: approved by the user on 2026-11-06, then STOPPED the same day (user
decision (B), §7). No part of it is in the code, except the snapshot rule for
block locals (§7). Decision 2 (b) of
`docs/plans/2026-10-30-evaluation-cache-architecture.md` stays in force.

The user chose, on 2026-11-06 in `issues/CE-535.md`, to write one design for
CE-535 and CE-531. For the memos named in this document, this design was to
replace Decision 2 (option (b), "no key per call now") of
`docs/plans/2026-10-30-evaluation-cache-architecture.md`. The caches of each
node (`_type`, `_sgn`, `_effects`) do not change.

## 1. The problem

Many memos of the engine are keyed on `_cacheGeneration()`, the `any` version.
Every declaration, every scope pop that is not clean, every type write and
every inference advances it. Then each such memo misses, and it computes the
same answer again.

**CE-535.** `literalBodyResultType()` (`boxed-expression/call-result-type.ts`)
walks the body of a user function to type one of its calls. Its memo is keyed
on `_cacheGeneration()`. Measured on 2026-11-06 at `69d0faf1b`, with the
rewritten fixture (`benchmarks/tycho-document-open/rebind.ts`, one warm replay
of 1 994 `ce.rebind` calls):

- The memo gets 677 hits and 269 misses. 246 of the misses compute a key that
  the same replay computed before, and each gives the same type again.
- The walks take 20 % of the replay in a CPU profile (about 160 ms of about
  800 ms).
- The 246 repeated walks all happen with the same world and semantic
  versions. With the definition version added to the key as well, only 124 of
  them have the same versions.
- 559 events advance the type version in the replay. About 150 come from
  binders (`canonicalizeBinder`, `box.ts`), about 86 from block locals that
  canonicalization declares, about 140 from the row scopes, 91 from type
  writes and 45 from inferences.

So a key made of engine versions cannot serve these walks. A binder's
declaration also cannot be made exempt: a symbol reads its value by name
through the current scope chain (`BoxedSymbol._value`, `boxed-symbol.ts`), so
inside a binder an expression that existed before reads the binder's
variable. The tests in
`test/compute-engine/ce-535-531-binder-declaration-cache.test.ts` keep that
rule.

**CE-531 and CE-321.** Each call of a function literal declares its
parameters in a new call scope, and that advances the `any` version. Then
every value memo keyed on it misses after each call: the lazy collection memo
(`_memoizedLazyCollectionValue()`, `boxed-function.ts`) and the value that
`At(A, I)` reads (`_materializedAt`). CE-321 measured 0.25 s at depth 9 of a
chain of applications. These two issues are not measured again here (§4,
phase 3).

## 2. What exists already

- **A key on the bindings read, for value memos.** `snapshotMemoDeps()` and
  `memoDepsStillValid()` (`collection-element-memo.ts`) record, for each
  symbol occurrence of an expression and of the definitions it reaches
  (stored values, the bodies of user functions, the reads of a sequence
  handler): the definition, its `_writeVersion`, and the binding that the
  name resolves to from the current scope. A check of the snapshot fails when
  a value was written, when a definition was replaced, or when a new binding
  shadows the name. The element memo, the stored-value memo and the
  collection-facet memo use it, with the world version.
- **A key that a call does not move, for the type of a node.** CE-689
  (`db796d62e`) added the type version: the `any` version without the
  declarations and the pops of a call. A type computation reads the static
  bindings (`static-typing-view.ts`), so a call cannot change a type. A
  binder still advances the type version, by 2 for each `D`.
- **A count that marks an answer that must not be kept.**
  `noteStackDependentAnswer()` and `stackDependentAnswerCount()`
  (`static-typing-view.ts`) mark a type that read an answer of a computation
  still in progress. A memo compares the count before and after its fill.

The memo of `literalBodyResultType()` and the two value memos of CE-531 use
none of the first and the third.

## 3. The design

Each memo named here keeps its key on `_cacheGeneration()` as the fast check.
When that check fails, the memo checks a second key before it computes again.
The second key is:

1. the world version and the facts bit (`_cacheGeneration() & 1`). The world
   version moves for assumptions, settings and non-scratch inferences;
2. the static view key, for a type memo: the innermost call frame and
   `staticViewDiverges()`, as in `_typeCacheGeneration()`;
3. a dependency snapshot (`snapshotMemoDeps()`, with `bindingSites`) of the
   expression that the memo answers for. For CE-535 this is the literal; the
   snapshot also walks the bodies of the user functions that the body calls.

When the second key is valid, the memo serves the entry and stores the
current generation in it, so the next read uses the fast check again. When
it is not valid, the memo computes again, as today.

**Type writes must move a definition version.** Today `_writeVersion`
advances at a value write and at a restore. A type computation reads the
type of a definition through the definition that the symbol captured
(`BoxedSymbol.type`), not by name. So `_writeVersion` must also advance at
each write of the type of a value definition (the type setter, an inference
that narrows or widens it) and at each write of the signature of an operator
definition (`_setSignature()`), and the snapshot must compare it for an
operator dependency too. This adds invalidations to the element memo, and
removes none, so it is sound.

**Reads that the snapshot does not see.** A handler can read a binding by
name for a name that does not occur in the expression
(`ce.lookupDefinition()`). The snapshot does not record such a read. A
lookup counter, built as `noteStackDependentAnswer()` is, makes this safe: a
lookup inside a type computation advances it; a node type computed with a
lookup is marked, and a read of a marked type advances the counter again; a
memo stores no second key when the counter moved during its fill. Phase 1
measures how many fills this rule refuses.

**When there is no snapshot.** `snapshotMemoDeps()` returns `undefined` for
an expression it cannot follow (for example a raw symbol as an operand). The
memo then has no second key, as today.

**Why the cases of the tests stay correct.** The sign cache, which most of
the tests in `ce-535-531-binder-declaration-cache.test.ts` read, keeps its
key. For the memos of this design, the same cases give:

- A binder of `x` around a call of a user function whose body reads `x` by
  name: the snapshot records that `x` resolves to the outer binding. Inside
  the binder, `x` resolves to the binder's variable, so the check fails and
  the type is computed again. After the binder, the entry made inside fails
  the check in the same way.
- A call of a function literal: its parameter resolves to the binding of
  that call. The next call makes a new binding, so a value memo entry of a
  node of the body made in the previous call fails the check (the `comp`,
  `mapAt`, `filterLen` and `sumx` cases of CE-543 in the same file). An
  expression that does not read the parameter keeps its entry across calls:
  that is the gain for CE-531.

**Cost of the check.** A check reads each dependency of the snapshot once and
resolves its name from the current scope. A fill walks the expression once to
take the snapshot. Phase 2 measures both on the replay. For comparison, the
rebind of the 425-byte witness tree of CE-535, most of it in the walk that
the check replaces, takes 16 to 17 ms.

**Verification mode.** With `CE_CACHE_VERIFY=1`, each entry that the second
key serves is also computed again, and a difference throws, with the memo
and the expression in the message. Each phase runs the full Jest suite and
the corpus check in this mode once, and its report gives the result.

## 4. Phases

| Phase | Work | Accepted when |
| ----- | ---- | ------------- |
| 1 | `_writeVersion` at type and signature writes; the lookup counter; one helper for the second key; the verification mode. No memo uses it yet. | Full suite passes; the count of fills that the lookup rule would refuse on the replay is in the report. |
| 2 | CE-535: the memo of `literalBodyResultType()` uses the second key. | On the replay, at most 50 walks miss (today 269), and the replay is at least 15 % faster; verification mode passes. |
| 3 | CE-531 and CE-321: the lazy collection memo and `_materializedAt` use the second key. Starts with a measurement on the chain of Tycho row 453 and the CE-321 chain at depth 9. | The measured gain is in the report; if it is below 10 %, the phase stops and the issues are closed with the numbers. |

Each phase is one change with its own review. Estimated size: phase 1 M,
phase 2 S, phase 3 M.

## 5. Rejected alternatives

- **No version advance for a binder's declaration.** Unsound: the tests above
  fail (a sign cached outside is served inside).
- **Key on engine versions only** (as `declaredResultMemoKey()`,
  `declared-parameter-result.ts`). With the definition version it serves at
  most 124 of 246 walks; without it, it does not see a type write.
- **Bind the binder's variable before its `canonical` handler runs**, so that
  a read by name inside the handler does not see it. This changes when a
  value is visible inside a binder, which the tests lock, and it does not
  help CE-531.
- **Record every read while a memo fills.** A node type served from its own
  cache inside the fill hides the reads that made it, so each node would also
  need a list of its reads. The static snapshot gets the same set from the
  expression.
- **Change the caches of each node** (`_type`, `_sgn`). In the replay, the
  type cache misses 14 022 times out of 1 279 573 reads because of a version
  advance (1.1 %), and the sign cache 14 times. Not worth a change now.

## 6. What the user decides

Approve this document, or change it. If it is approved, phase 1 starts. If
nothing is decided, no code changes, and CE-535 and CE-531 stay open.

## 7. Result (2026-11-06): stopped

Phases 1 and 2 were built in a worktree and measured on the replay of §1;
nothing of them was applied.

- **The lookup counter of §3 refuses every fill.** In the replay, the fills
  made about 63 700 lookups by name, nearly all of operator names that occur
  in the walked body (`Add` 14 885, `Multiply` 14 242, `Ceil` 7 056). The
  counter moved in all 269 fills, so the second key served none of the 246
  repeated walks.
- **A narrower rule needs a record of each read.** The rule that was then
  built refuses a fill only when it looks up a name that the stamp does not
  record with the same binding. Each type computation and each memo fill
  records the names it looks up, and the type cache of each node keeps them
  with its cell, because a served type hides the reads that made it. With
  that rule the memo missed 22 times instead of 269, no served entry
  differed from a new walk (verification mode), and the replay was about
  11 % faster (median 646 and 654 ms against 723 and 742 ms on the main
  checkout, load average about 2.7 to 3.0). The 15 % target of phase 2 was
  not met.
- **The record is complete only if every lookup by name is recorded.**
  Recording in `ce.lookupDefinition()` missed the direct callers of
  `lookup()` (`function-utils.ts`), for example `receiverDefinition()`
  (`field-callee.ts`), which can run inside a type computation. Recording in
  the five lookup functions still left 156 direct `.bindings.get(` and 53
  `.bindings.has(` calls in `src/compute-engine` that were not audited. The
  diff had grown to about 500 lines in 9 files, plus a new module.

**User decision 2026-11-06 (B):** stop, and close CE-535. CE-531 and CE-321
return to the board. A new design would need one point that records every
read of a scope binding (for example a map class for `Scope.bindings` whose
`get` and `has` record), and its cost on the hottest code is not measured.

**Kept:** the dependency snapshot (`snapshotMemoDeps()`,
`collection-element-memo.ts`) now accepts a block local declared with a
value. The target of a `Declare` or `Assign` that an enclosing `Block` binds,
and the type operand of such a `Declare` written as a symbol, are skipped:
they name the local and its type and read no binding. Before, such a block
had no memo entry. Test: `test/compute-engine/element-memo-block-local.test.ts`.
