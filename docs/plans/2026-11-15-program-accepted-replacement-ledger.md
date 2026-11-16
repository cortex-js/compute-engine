# Program replacement ledger after the variable/flow decisions

Status: implementation authorized by the user's accepted Program-variable and
diagnostic-flow rules, 2026-11-15. This ledger is established before production
edits. It replaces the checker cost and aggregate estimate in the
[responsibility split](2026-11-15-preparation-responsibility-split.md), using the
[accepted semantic rules](2026-11-15-program-binding-diagnostic-rules.md) and the
[Program contract](2026-11-12-program-operator-spec.md).

The withdrawn 55–75-line checker-adapter estimate and the aggregate 313–448
addition estimate are not implementation budgets or evidence. No replacement
numerical addition estimate is asserted here. Actual additions and deletions
will be recorded separately by mechanism, excluding tests, instruments and
documentation. Existing bodies moved unchanged are neutral.

## Changed obligations

| Mechanism | Obligation now removed | Replacement and owner |
| --- | --- | --- |
| Callable variables | Simulate value-to-operator promotion, sticky first replacement signature, reconciliation against earlier literal annotations | Declaration/canonical sequence owns a stable value binding. Existing assignment admission enforces its contract. The runtime writes its value; the checker does not emulate a transition |
| Callable diagnostics | Install signatures on definitions and make ordinary boxing stricter using `_staticPinnedCallees` | Read-only reaching function-value facts at canonical use sites. Existing literal/signature admission rules provide validation; unknown facts may be discarded |
| Assignment evidence | Declare/shadow/refine/retype checker bindings using `_infer` and `_staticAssignmentEvidence` | Canonical sequence owns declarations and static type evidence. Diagnostic flow separately records the reaching literal/evidence without changing definitions or runtime types |
| Aliases | Copy a pin into another definition and promote its current literal signature to a contract | Copy the current value fact at the alias statement; keep the declared/coarse static type of the destination |
| Function-before-assignment/constant workarounds | Install saved literals and restore pins around a later top-level function clause | P2 canonical ordering and the common declaration/duplicate/assignment rules. Legacy operator paths receive conservative diagnostics rather than checker-side mutation simulation |
| Checker route | Independent statement boxing and binding preparation, with special controls inside `box.ts` and `validate.ts` | Box one checker projection through the common sequence canonicalizer. Keep raw typo/presence/provenance/source diagnostics and necessary existing registry isolation; migrate every obsolete control caller |
| Compiler analysis | None of the IR lowering/optimization obligations becomes checker work | Reuse existing source identity/type/signature and binding-aware extraction helpers where identical. No checker IR, shape-contract expansion, compile prerequisite, new evaluator or universal analysis service |

## Named retirement set before editing

The prior Program-only set is 538 AST-leaf code lines / 658 physical lines,
with exact spans in the responsibility split. Those deletions remain required.
The following additional mutation/transition declarations are now candidates
for retirement. All are in `src/epsil/static-diagnostics.ts`, source SHA-256
`82fc5645c72c0e6b5324346beddc1f70da05c6ce742f1762f54bbbbbf7a88fe6`.

| Declaration | Source lines | Physical | Code |
| --- | --- | ---: | ---: |
| `applyAssignmentTypeEffect` | 758–948 | 191 | 113 |
| `declareStatementNames` | 968–982 | 15 | 15 |
| `registerPinnedSignature` | 2494–2702 | 209 | 142 |
| `pinnedAliasOf` | 2718–2730 | 13 | 13 |
| `passScopeDefinition` | 2738–2745 | 8 | 8 |
| `assignOverUserFunction` | 2780–2806 | 27 | 23 |
| `installAssignedLiteralBeforeClause` | 2833–2861 | 29 | 25 |
| `keepConstantBinding` | 2893–2909 | 17 | 15 |
| `PinnedSignature` | 3440–3446 | 7 | 7 |
| `reassignedPin` | 3474–3498 | 25 | 25 |
| `replacePin` | 3513–3531 | 19 | 19 |
| `isNamedSignature` | 3536–3541 | 6 | 6 |
| Additional named set | | 566 | 411 |
| Prior plus additional named set | | 1,224 | 949 |

Counts exclude leading JSDoc, blank/comment-only lines and JSDoc AST nodes;
multiline literals count on every physical line intersecting a nontrivia leaf.
References were searched across `src/`: these declaration names are private to
the checker or appear in explanatory comments elsewhere. Alias/literal/contract
analysis remains necessary, so the new pure flow implementation is charged as
an addition; moved bodies do not earn deletion credit. The 949 lines are an
inventory of named obligations, not earned reduction or permission to add that
many lines. Final credit requires removing the obsolete mechanism and callers.

Additional obsolete engine fields, their type declarations, setup/restore paths,
and checker-only branches in `box.ts`/`validate.ts` are uncredited until the
actual diff establishes their retirement. Do not merely rename these engine
controls or move mutation into a callback.

## Production addition/deletion accounting

Record actual production code and physical additions/deletions separately for:

1. Program registration and shared sequence canonicalization policy.
2. Stable Program variable lifetime and existing assignment-contract integration.
3. Existing sync/async evaluator continuation/cancellation and reporting hooks.
4. Checker projection, pure diagnostic flow and removal of obsolete controls.
5. Parser, public execute/check adapters, direct compile and parsed-container
   consumers, including the small authorized Tycho edits.

Tests, snapshots/pinned emissions, measurement instruments and documentation get
separate totals. The retained Tycho prelude runner and Document preparation earn
no method-deletion credit. The final patch must reduce combined production code
and retire the named duplicate binding mechanisms; source diagnostics moved to
hooks remain neutral. At the pre-edit point actual production additions and
deletions were both zero.

The first instrumented candidate confirms a two-line inventory correction:
`prepareFunctionDeclarations` contains two inline return-type JSDoc lines that
the earlier count included. Applying the stated JSDoc-excluding metric gives
228 rather than 230 code lines for that declaration, and 947 rather than 949
for the combined named set. Physical spans are unchanged. Final accounting uses
the remeasured figure, with no deletion credit for those two comment lines.

## Gates and scope

Before production edits, freeze matched baseline sources/build options and
establish control repeatability. Prior exploratory timings are not an accepted
envelope. Measure normal and JIT-off interpreter routes, construction/boxing,
first/repeated/failed-statement runs, checking/type-protocol checks, showcase
initialization, rerun/edit consumers and calibrated allocation/live heap controls.
Record per-case spread and contention; missing controls are not passes.

Validate execute/check/direct sync/async evaluation, direct compilation and
parsed-container consumers, plus cancellation, source/debug hooks, sibling error
continuation, presence/provenance and existing registry restoration. Report each
intentional runtime, diagnostic, public-type and compilation-coverage difference
with its witness. Count changed tests and pinned emissions before changing their
expectations.

Stop for review before expanding beyond common canonicalization/assignment
contracts plus a diagnostic-only fact pass. In particular, no new evaluator,
binding algorithm, registry snapshot framework, prepared-type bridge, IR lowering
for checking, source IR/CFG framework, Document revisions, A1 publication change,
numeric-context change, experimental walker, symbol-sites API or compiled Program
runner is authorized. Conservative loss of unproved diagnostic facts and ordinary
compilation declines are available instead of broader analysis.

## Integration decisions pinned by witnesses

Declaration admission follows authored order, before P2 sorts accepted statements
for canonical preparation and execution. `const c=1; function c(x){x}; c` keeps
`1` and reports the later declaration once, with the first declaration's site.
A failed initializer still reserves its declaration name within that Program.
A later Program may replace it under P7. Function-clause domain collisions stay
with the existing clause owner; in `f(n)=1; f=(x=>42); f(m)=2; f(0)`, the duplicate
clause is refused and the accepted later value assignment yields `42`.

The Program-variable widener is the existing Block policy: numeric mutable
bindings use `number`, rather than introducing a new `real` default. Stored
function values retain their own parameter annotations, names, defaults and
effects under the coarse `function` binding contract.

Host-created `Block` containers now consistently retain local scope and one
enclosing evaluation. The retired host-Block-as-Program heuristics are an
intentional P1 change, including their library-constant deferral behavior.
Tests that intend a caller-scoped program use `Program`; tests of a lexical
Block explicitly construct or extract that Block.

Program serialization must preserve the existing authored-order permutation,
so reboxing `const W=5; function f(k=W){k+1}; f()` still admits the earlier
constant default. Canonical operands remain P2-sorted internally. Avoiding the
JSON route in a compiler test is insufficient evidence for that contract.

The last prepared-declaration seam reuses the existing statement write identities
and declaration rollback owner: a prepared declaration initializes its own
canonical binding even after another Program was boxed in that namespace. A
private success signal must distinguish an admitted stored Error value from a
refused declaration and retain committed dependent repairs. Rollback saves every
target's current incumbent, including an undisplaced tuple leaf. This is not a
new binder or snapshot framework. The initial rough 20-line integration estimate
was recosted to roughly 25–30 code lines before the additional owner bookkeeping;
only the final instrumented gross counts are delivery evidence.

Independent review confirmed that P7 does not require an already canonical
initializer to acquire a different binding home on replay. Fresh Program boxing
uses the current caller; an existing initializer retains its bound-once home.
Adding fresh-parse semantics to the same prepared object across changed contracts
would be separate scope and is not implemented.

The final matched preflight corrected an instrument assumption: baseline
`const x=0;x/x` is1, while the candidate isNaN. The runtime-local quotient guard
therefore includes an intentional constant-zero correction, in addition to
preserving the baseline let-zero result. Ordinary library constants and nonzero
host constants still cancel to1. Host-declared zero constants remain an older
separate defect in both arms (CE-1361). No numeric context or precision setting
changes. Failed preflight evidence is retained; original matched workload
controls are unchanged.
