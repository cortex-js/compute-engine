# A stored function body checks its readings when it is used

Status: Superseded as the plan of record by
`docs/plans/2026-11-09-binding-units-model.md` (2026-11-09). Kept for its
measurements. Earlier status: DRAFT, waits for approval. Step 0 is done (results below). No code
before the approval.

## The problem

A `Function` literal is canonicalized once and stored. Three decisions of
that canonicalization depend on definitions that can come later
(`boxed-expression/provisional-application.ts`, header):

1. `2a(t)` is read as a product because `a` has no function definition
   (`invisible-operator.ts`, `noteProvisionalApplication()`).
2. `clean(cs)` is read as a call of a name with no definition, so the
   parameter types of `clean` did not narrow `cs` (`box.ts`,
   `noteProvisionalCall()`).
3. `g(cs)` calls a function whose signature is inferred, which a later
   definition of `g` can replace (`box.ts`, the two other
   `noteProvisionalCall()` sites).

Today a new definition of the name PUSHES the change: a registry holds every
definition that waits on a name, and `updateDef()` re-derives them
(`repairWave()`, `function-utils.ts`). The push needs: the registry and its
weak references, a rollback journal and a checkpoint journal for it, a repair
after each rebuild, a guard against re-entry, a deferred queue, a limit of
two rebuilds per wave, and a rule that says which waiting definitions can
see the new binding. That rule is a second description of scoping. In
CE-1102 it needed four cases (a scope above, a scope under, a run-time copy
of a scope, a binding shared by two scopes), and two review rounds each
found a case it missed. 14 source files use the mechanism.

## The proposal

Nothing happens at the definition of a name. A stored body checks its own
readings before it is used, and is re-derived then when one of them changed.

**What a body records.** The record of a literal exists today (the raw
operands, the names, the home scope, the assignment locals:
`ProvisionalLiteral`). It gains, for each name, a stamp: the binding that
`lookup(name, home scope)` gave at the canonicalization, and the version of
its definition. The noting sites do not change.

**The check.** Before a definition made from a literal is applied, typed,
compiled, or read by the host:

1. If no definition changed in the engine since the last check of this
   body, the body is current. This is one integer comparison.
2. Otherwise, for each recorded name whose counter moved: make the function
   that the name resolves to current first (the same check, with a guard for
   a cycle), then resolve the name from the home scope and compare the
   stamp.
3. If a stamp changed, re-derive the body from its raw operands in its home
   scope, as `repairWave()` does today, and record the new stamps.

The engine keeps one counter for all definitions and one counter per name.
A counter moves at each change of a binding of that name in any scope: a
declaration, a redefinition, a value write that changes whether the name is
a function, a re-derivation of the definition, an install by
`ce.createScope()`, a rollback or a checkpoint restore.

**The scoping rule.** A reading depends only on the bindings that
`lookup()` finds from the home scope of the literal. "Can this definition
see the new binding" is then the lookup itself. A definition in a discarded
scope is never used, so it is never re-derived.

## What is removed

`DEPENDENTS`, `REGISTRATIONS` and the functions that read and write them;
the repair hook and `repairWave()` with its cascade, `REPAIRING`, `DEFERRED`
and the rebuild limit; the entries that the registry writes in the rollback
journal and in the checkpoint journal (a restore moves the counters
instead);
`scopeOfBinding()`, `sameLexicalLevel()` and the `declaredIn` / `boundIn`
arguments; the refusal in `withValues()` (decision 2).

## What changes for a user (breaking)

1. **An invalid body is reported at the use, not at the definition of the
   name.** `g(t) := 2a(t)`, then `a(x, y) := x + y`. Today: the definition
   of `a` throws `DependentRebuildError`. Proposal: the definition of `a`
   succeeds; `g(1)` stays unevaluated, as it does today after the throw.
2. **`withValues()` accepts a name that a stored body applies.**
   `f(t) := a(t+1)` with `a` not declared, then
   `ce.withValues({ a: 2 }, () => f(1))`. Today: throws (or not, by the time
   of the last garbage collection). Proposal, expected: `4` inside the call
   (the body reads `a·(t+1)`), and `f(1)` is `a(2)` again after it.
3. **A host that holds a stored body or a signature sees the value of the
   last check.** `ce.lookupDefinition('g')` checks before it returns; an
   object kept from an earlier call is not updated behind the host.

## Results of step 0 (2026-11-09)

Measured on `13c41f1c71b56da1c621b9a1d04951841907ee09` with counters in a
temporary worktree. The two inventories are counts from text searches by a
sub-agent; they were not checked with a reference search.

**The closure case does not need a reading to change.** In
`closure-reroot-frames.test.ts`, the run-time assignment of the local `h`
re-derives the body of `f`, and the re-derived body is the same expression
(the same MathJSON), as a new object. With the re-derivation turned off, or
computed and not installed, `f(n, y ↦ 0)(0)` gives `0` in place of `1`, `3`,
`6`. Four other functions that apply a local function, recursive or not,
give the right value with the re-derivation turned off. So the scoping rule
holds: no reading changes at run time. The test depended on a new body
object for each depth of the recursion, which hid a defect of closures in
recursive calls (CE-1185). That defect is fixed in
`0a502b999dde354c968277dabfa12eb2b8bc32fa`: on that commit, with the
re-derivation turned off, the test case gives `1`, `3`, `6`, and the four
other functions keep their values. Nothing is left to do before step 2 on
this point.

**Bodies with a record, on Tycho.** Every sixth state of the Neyret corpus
(98 of 585 states, 861 rows), two registrations each:

| | Count |
|---|---|
| `Function` literals canonicalized | 2,429 |
| with a record | 156 (6%), in 15 of the 98 documents |
| names per record | 1: 98, 2: 42, 3: 16 |
| notes: a call of a function held as a value, inferred type | 286 |
| notes: a call of a name with no definition | 6 |
| notes: a call of an operator with an inferred signature | 4 |
| notes: a product reading (`2a(t)`) | 0 |
| re-derivations | 30 |
| of which the body is the same MathJSON | 26 |
| of which the type of the literal is the same | 28 |
| evaluations of a function held as a value | 84, none with a record |

The ten-edit script (one state, 14 registrations): 664 literals, 140 with a
record (one name each), 42 re-derivations, all 42 with the same MathJSON and
the same type, no evaluation of a stored function.

What this says: on Tycho's documents the product reading, which is the
reason the mechanism was built, does not occur; the records come from calls
between functions with inferred signatures; and at least 66 of the 72
re-derivations change neither the body nor its type (30 − 4 − 2 = 24 or
more in the sample, 42 in the ten-edit script). Tycho's registration does not evaluate
a stored function: it reads types and compiles. The check must therefore be
cheap on the type and compile reads, not on evaluation. The cost of the
check itself is still not measured: it needs the implementation of step 1.

**Who relies on the error at the definition.** `DependentRebuildError` is
caught at three places in `library/core.ts`: the pre-declaration of
`DefineFunction` ignores it, and the evaluation of `DefineFunction` and of
`Assign` return its error value. Two tests assert the error at the
definition (`definition-order.test.ts`, "an incompatible arity is rejected
in either order" and "the error surfaces and no dependent is dropped").
Seven tests of `protocols.test.ts` and `protocol-effects.test.ts` assert that
a later registration is refused because of a stored body with a declared
effects contract; whether they go through this repair is not checked. Eleven
tests read the registry directly and go with it. About 22 tests assert the
value of the dependent after the later definition and stay valid. No code in
`src/epsil/` catches the error; `src/epsil/docs/syntax.md` and `types.md`
describe the re-derivation at the definition and change.

**Readers of a stored body or signature.** 27 read sites of `_lambdaLiteral`
outside its class, about 250 reads of `signature` or `inferredSignature`
(an estimate: the search does not separate other objects with a `signature`
field), and the host reaches both through `ce.lookupDefinition()`. A check
at each read site is not practical. The check belongs in the accessors of
the definition (the body and the signature become getters).

**The rule for a cycle.** A body whose check is in progress counts as
current for a check that reaches it again. When the outermost check ends,
each body that was reached while in progress is checked once more. A body is
derived at most twice in one outermost check, as in a repair wave today.

## A variant to decide: canonicalize the body at its first use

The definition stores the raw operands only. The canonical body is made at
the first read of the body, the type or the signature, and the record of
stamps keeps it current after that, as in the proposal.

Example: a document defines `f(x) := h(x) + 1`, then `h`, then plots `f`.
Proposal above: `f` is canonicalized at its definition without `h`, and
again at its first use. Variant: `f` is canonicalized once, at its first
use, when `h` exists. With the counts above, the variant removes most of the
72 re-derivations of the sample, since the functions are defined first and
read after.

What the variant adds to the breaking changes: every effect of the
canonicalization moves to the first use. That is the validity error of the
body, the inferred signature and effects of the definition, and the
declarations that the body makes for its free names (today
`f(x) := x + b` declares `b` at the definition of `f`).

**Measured (same sample, 2,429 literals).** The first read of the type or
of the operands of each literal, after its canonicalization:

| First read | Literals |
|---|---|
| inside `ce.assign()`, by the engine | 1,940 (80%) |
| elsewhere | 475 |
| never | 14 |

Inside `ce.assign()` the readers are `resultUnderDeclaredParameters()` (the
result type under the declared parameter types: 1,520), `mentionsName()` in
`assignNamedValue()` (674 as the first read), `capturedSymbols()` and
`ascribeDeclaredParameterTypes()`. So today the first use IS the definition,
and the reader is the engine, not Tycho: the variant gains nothing unless
these derivations of `assign()` become lazy too.

The first read that is NOT inside a `ce.assign()`: 743 literals (31%) have
one; 1,686 (69%) are never read again in this workload, 106 of the 156 with a
record among them. The readers are Tycho's `_rawCell()` (356) and
`rebindCanonical()` (78), and in the engine `resultUnderDeclaredParameters()`
(340) and `callsItselfDirectly()` in `_deriveSignatureOnce()` (198).

Limits of this count: the script registers and evaluates the cells and does
not plot, so no body is compiled; in the application a plotted function is
read by the compiler. A literal is counted at each canonicalization, so one
definition counts once per registration.

What it says: if `assign()` derived nothing from the body, about two thirds
of the bodies of a registration would not be canonicalized at all in a
document that is not plotted. The time this would save is not measured. The
price is that `assign()` no longer knows the
signature, the effects, the captures or the validity of the function when it
returns.

## Steps

0. **Measure and trace, no behavior change.** Trace the closure case. Count,
   on Tycho's corpus and the test suite: bodies with a record, names per
   body by kind, uses per body. List every reader of a stored body or
   signature. List the tests that expect the error at the definition. Write
   the numbers and the cycle rule into this document, then ask for the
   approval.
1. **The check beside the push.** Implement the record, the counters and the
   check, but only compare: at each use, does the check agree with the state
   that the push left? Run the full suite and Tycho's corpus audit, and
   report each disagreement. Each one is a case the push or the check has
   wrong.
2. **The switch.** The check re-derives; the push and the items of "What is
   removed" are deleted. `CHANGELOG.md`, "Breaking Changes".
3. **Documents.** `docs/SCOPING-MODEL.md` (the forward-reference paragraph),
   `docs/TYPE-SYSTEM.md` and `docs/CHECKPOINT-MODEL.md` (the registry
   journals), the `withValues()` page of cortexjs.io.

## Done when

- The full suite passes, with the tests of breaking changes 1 and 2 updated
  and counted in the report.
- Tycho's corpus audit gives the same values as on the release before.
- Tycho's ten-edit script
  (`scripts/repros/2026-11-07-ky-registration-growth.mts`) stays flat with
  no forced collection, and the registration time of the corpus is not
  higher than before the change (the limit is set from the numbers of
  step 0).
- `provisional-application.ts` holds the capture and the record only.

## Decisions for the approval

1. Breaking change 1 (the error moves to the use). Saying no keeps an eager
   check at each definition, which needs the registry again.
2. Breaking change 2 (`withValues()` accepts the name). Saying no needs a
   list of the names that stored bodies apply, a small part of the registry.
3. Step 1 (compare before the switch). It costs one more implementation
   round; without it, a missed case appears as a wrong value after the
   switch.
