# Program implementation: semantic migration evidence

Production checkpoint: `/tmp/wt-program-accepted-sol`, detached baseline `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`. No commits, staging or publication. Parent owns aggregate build/full/browser/editor validation, Tycho adapters, guides and replacement ledger.

## Measurements before existing semantic expectation changes

Root full pre-update census: `/private/tmp/program-full-census.log`, source unchanged across run, exit1:141 failed/1907 passed/11 skipped suites;1019 failed/84306 passed/780 skipped/2 todo tests;39 failed/4221 passed snapshots. Browser sandbox failures were included; parent owns rerun with Chromium permission. JSON export failed on circular Expression after summary; log is authoritative.

Focused old-expectation checkpoint: `/tmp/program-focused-fixes.json`,8files364tests,64failed300passed,0snapshots. New Program30 and provenance5 passed; old CE semantic expectations had not been edited. Later runtime repair census `/tmp/program-focused-stable.json`:15files530tests,58failed472passed. The source-only runtime regressions were repaired before intentional expectation migration.

Latest completed focused run: `/tmp/program-focused-reviewed.{log,json}`,22files1327tests,1327passed0failed,89snapshots passed,exit0. `timeout -k30 600 npx jest --watchman=false -w4` under own `codex-program:implement` lock. Acquire load7.7/7.8/7.8; release8.1/7.8/7.9. Source/test manifests before/after compare0 (`/tmp/program-reviewed-{before,after}.txt`). Program suite45 cases. Includes original8 plus Block-local, Tabulate, defaults, nested diagnostics, binder sites, parallel, recursive type declarations, clauses, generic variables, indexed writes, callback admission, spread compilation and parser resource/root controls.

CURRENT source differs from that checkpoint in exactly `src/epsil/execute-epsil.ts` and `test/epsil/program.test.ts`: the fourth review finding's deep-value reporting backstop, three deep-value cases (Program45→48), and stronger async captured-context assertion. `/tmp/program-reviewed-current.txt` records current hashes; diff against after manifest proves the two changed files. Latest execute hash6ebc25c93e809664cf10991eea6399f64a5e3e6f. Root now owns full validation of this final source; no own test process or queue entry remains. No duplicate22-file rerun is claimed.

Latest current-source typecheck: `npm run typecheck`,exit0, `/tmp/program-typecheck-reviewed-final.log`. Changed-source/test oxlint plus new diagnostic-flow and Program files:exit0,no warnings, `/tmp/program-oxlint-reviewed-final.log`. Editor build/DAP/LSP passed earlier checkpoint; root owns refreshing them for final source.

Independent review fixes after the earlier1202-case pass:

1. Refused duplicate statements no longer contribute type/const/default metadata: existing `staticDeclarations` consumes shared accepted STATEMENT identities after the duplicate pass; raw const-write registration requires canonical Declare. `let x=1;const x=2;x=3;x` and string duplicate both give3,number,nonconstant,duplicate-only diagnostic.
2. Direct Program budget restoration: sync retains spent caller frame; async reporting restores the catch ambient frame immediately and async finally restores in existing evaluation context, avoiding reinstalling a closed host frame. Source probes: sync Error/spenttrue/frameidentitytrue/stepsLeft−1; async immediate identitytrue; after await captured-context identitytrue/spenttrue/−1; outside frameundefined.
3. Prepared typed const function declaration initializes on each sync/async rerun, while ordinary const writes remain refused. Existing declaration initialization owner reused.
4. Deep host results cannot bypass existing value-walk guards: duplicate marker uses shallow boxed Error/ErrorCode; range narrowing and static-marker predicate use walkValue. Current source probes: depth10 value→5/no diagnostics; depth2000→5/walk runtime diagnostic; deep Error payload→5. Three final Jest cases await root aggregate run.

## Accepted changes, retained witnesses

| Rule | Witness / final behavior | Expectation migration |
|---|---|---|
| P1 explicit root | Empty, single and multiple statements parse as Program; resource-limit null recovery becomes empty Program with whole-source offsets | Parser payload helpers assert root then extract one grammar payload; no fabricated Block. Root/baseline agents own mechanical raw consumers. |
| P2 canonical order | Paired signature applies before an earlier textual call; top-level clauses, generic functions and constructors after types are available to executable statements | Hoisting/compiled-declared/clauses witnesses now exercise Program; helpers intended to exercise actual Block explicitly construct Block and keep local timing rules. Hoisting suite remains56 cases. |
| P2 declarations vs functions | `let h=(x)=>x; function h(u){u}`: canonical function precedes conflicting value declaration; declaration is refused once | Existing const/value/function conflict witnesses retained, new expected refusal is variable-redeclaration at value declaration. |
| P7 new declarations | Later Program let/const replaces prior binding/type; `let z=9` then `let z=z+1;z` gives10 | New Program witnesses cover let+const reruns, caller scope and prior initializer binding. Earlier retained mutable closure uses existing caller re-resolution. |
| Stable data | `let x=1` reports number; later Program x=1.5 succeeds; x="a" refuses and keeps1.5 | Public type assertions integer→number; original indexed string/tuple-to-list operator tests explicitly declare any to preserve that operation's coverage, plus new implicit-string contract refusal witness. |
| Stable callable variable | Repeated integer→string→integer literals all replace the function value; final string argument refuses under latest integer literal | Old sticky replacement expectations updated; aliases remain value snapshots; explicit signature and const refusals remain. Scalar→function witness retained separately: assignment-type-mismatch+expected-function, stored scalar0. Static-lambda cases28→29. |
| Coarse public callable type | Untyped callable variable has type function, while actual literal keeps names/defaults/annotations/closure | Default description assertion uses function. FlatMap's coarse callback stays canonical and its literal rejects bad cells at runtime. No host ce.assign redesign. |
| Nonmutating diagnostics | Known literal/alias facts validate uses and preserve literal argument/provenance notes; refused writes keep earlier facts; uncertain writes/effects invalidate | Flow pass spies on declare/assign/_infer/type-write pass. Existing rollback and presence/provenance tests pass. |
| Conservative global transitions | `function h(x:integer){x};h:=(u)=>"s";h(u:3)` gives"s" without stale-x diagnostic; old x label still fails at runtime | Shared write metadata supplies existing operator identity to diagnostic invalidation. Checker does not emulate assignment. Named refusal reuses existing `_refusedOps`/callee stamp to recheck against runtime interface. |
| P9 sequence value | Final declaration/assignment gives Nothing; property/indexed store operands retain their existing assigned-value behavior | Generic declaration result assertion updated. Root owns property-store fixture/result migration and direct statement-value controls. |
| Source-only binder timing | `let L:any=[1,2];limit(total(L)*t,1)` now yields `t * total(1)` (old initialized-value route yielded `total([1,2])`) | Explicit declared any supplies no list proof during Program canonicalization; raw binder API is conservative rather than naming wrong binder. `boxedEarly` covers every Program use. Constness is known at hoist: earlier const a5 limit(a+h,1) remains6. |

## Separate shared Limit repair (observable Block math change)

Not attributed to P2: the existing `canonicalImplicitLimitFunction` first inferred a parameter from valueless local unknowns, then retained it when the shared eligibility predicate excluded every candidate. The one existing zero-candidate branch now builds a zero-parameter literal with `canonicalFunctionLiteralArguments`; no new math analysis or operator handler.

Executed against frozen baseline SOURCE and final candidate SOURCE:

- `function f(){let L=[1,2];limit(sum(L),1)};f()` — baseline1, candidate3, no diagnostics on either. Existing nonnumeric-variable exclusion requires3. Added a numeric regression to Program tests.
- `function f(){let L=[1,2];limit(length(L),1)};f()` — baseline unevaluated `lim_(L -> 1) {Length(L)}`, candidate2.
- Unrecognized-head fixture `limit(total(L),1)` with a body-local list now stays `total([1,2])`, previously `total(1)`.

Controls: explicit Limit variable remains bound (`let L=[1,2];limit(total(L),L,0)`→total(0)); ordinary numeric implicit variable remains (`let a=5;limit(a+h,1)`→h+1). Program nonnumeric inferred-list witness preserves total([1,2]).

## Source inventory

At checkpoint, production `src` excluding guide pages: tracked physical diff718additions/3046deletions; new diagnostic-flow148physical lines gives866additions/3046deletions,net−2180. This physical total includes baseline agent's error-explanation string edits; excludes editor adapter source. Parent computes AST-code ledger and aggregate cost. Existing widenLocalType moved from core to boxed-value-definition (neutral relocation; no earned removal credit). New diagnostic flow148physical lines is analysis-only, reusing canonical identities and existing admission/argument rules.

All source references to `_staticPinnedCallees`, `_staticAssignmentEvidence`, `prepareFunctionDeclarations`, `registerPinnedSignature` and `applyAssignmentTypeEffect` are gone. Lifetime reader classification is in `lifetime-audit-sol.md`. No new binder/type registry, evaluator, IR lowering or framework.
