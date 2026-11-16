# Reviewed source-freeze deletion attribution

Frozen baseline: `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`. Raw capture: 2026-11-16T08:08:56.688Z. Attribution: 2026-11-16T08:08:59.135Z. All production source hashes verified against the raw capture. No source edits, tests, builds or git commands in Tycho.

**This is accounting, not a semantic/code-review pass.** Rerun both instruments after any production change. Test expectation migration is outside the production counts.

## Required five-mechanism breakdown

Every changed AST-code physical line is one integer unit. A line is neutral only when its complete nontrivia AST-leaf code belongs to a proved unchanged moved body/fragment. A mixed wrapper line containing new tokens stays fully charged to its documented dominant owner. Partial-token matches are supplementary proof only, never fractional line credit. No line belongs to two mechanisms. Raw physical columns retain comment/blank/move churn and allocate each physical diff line once; only code gross totals neutralize reused code.

| Mechanism | Raw physical +/− | Charged code + | Charged code − | Net |
| --- | ---: | ---: | ---: | ---: |
| M1: Program registration and shared sequence canonicalization policy | 338/1097 | 284 | 526 | -242 |
| M2: Stable Program variable lifetime and assignment-contract integration | 263/111 | 188 | 53 | 135 |
| M3: Existing sync/async evaluator continuation/cancellation and reporting hooks | 225/310 | 196 | 132 | 64 |
| M4: Checker projection, pure diagnostic flow and obsolete-control removal | 290/1575 | 245 | 745 | -500 |
| M5: Parser, public execute/check adapters, direct compile and parsed-container consumers | 192/279 | 143 | 166 | -23 |
| Neutral retained code: Neutral retained code | 0/0 | 79 | 102 | -23 |

Raw combined production: **+1135/−1724 AST code lines**, physical **+1308/−3372**. After neutral retained code: added **1056**, deleted **1622**, net **-566**. All gross/net code counts are integer physical-line units; mixed wrapper lines remain fully charged.

## Retained code: no deletion credit

- M5 CLI and math/member-call consumer repairs are explicitly allocated: CLI empty Program handling, shared Limit argument inference, deferred constant member calls and divide guards are distinct runtime consumers; exact witnesses are recorded separately.
- M1 owns the extracted global library-name guard and declaration-origin registration; exact retained guard statements are neutral, and new helper/static-check wrappers remain charged.
- M3 owns the optional Declare-target identity on existing type-refusal ErrorCodes and its read-only reporting lookup; the weak provenance map is not a binding registry.
- M2 owns assignment admission and the temporary clause shell; statement re-registration identity in multi-clause.ts is overridden to M1.
- Imports/signatures use the importing module mechanism unless explicitly overridden; no line is charged to both the imported policy and its adapter.
- Sequence metadata consumed by adapters/checker is owned by the common canonicalizer (M1); persistent variable flags/types/initializer lifetime are M2.
- Editor debugger/inline callbacks are consumer adapter code (M5); engine hook invocation and execute result bridge are M3.
- Existing raw diagnostic/binding-site walks and obsolete early-function graph removal are M4; syntax/container dispatch and implicit-variable consumer fixes are M5.
- Most execute diagnostic rendering stayed unchanged in Git context, so it generates no added/deleted units at all. Changed wrappers, source-index/range substitutions, new debugger flags and altered guards are charged.
- The widener body has 34 raw-text-identical lines neutral on each side. Its export/signature/import integration remains charged.
- No automatic source-level copy matching beyond the reviewed token-identical fragments is used. The errors[0].toString() subexpression inside a changed source-location template was inspected and intentionally left charged with that changed template.

### Reviewed partial relocations

| Retained fragment | Before → after | Why neutral |
| --- | --- | --- |
| `src/compute-engine/engine-declarations.ts` | 2695–2695 → 4786–4786 | Existing global-name guard statement extracted unchanged; new helper and checking-global condition remain charged. |
| `src/compute-engine/engine-declarations.ts` | 2696–2696 → 4787–4787 | Existing global-name guard statement extracted unchanged; new helper and checking-global condition remain charged. |
| `src/compute-engine/engine-declarations.ts` | 2698–2698 → 4791–4791 | Existing global-name guard statement extracted unchanged; new helper and checking-global condition remain charged. |
| `src/compute-engine/engine-declarations.ts` | 2699–2711 → 4792–4804 | Existing global-name guard statement extracted unchanged; new helper and checking-global condition remain charged. |
| `src/compute-engine/function-utils.ts` | 3909–3915 → 3950–3954 | Existing asynchronous statement call/options reused inside the new evaluation thunk; await/result/thunk/budget wrappers stay charged. |
| `src/epsil/execute-epsil.ts` | 865–874 → 690–690 | Unknown-function result scan retained in the Program result hook; only formatting/location changed. |
| `src/epsil/execute-epsil.ts` | 580–587 → 495–495 | Protocol-property advisory scan moved before common Program boxing, retaining the identical call. |
| `src/epsil/execute-epsil.ts` | 537–543 → 520–520 | Existing nested-statement reporter construction reused by the new result-hook bridge; changed binding/assignment wrapper stays charged. |
| `vscode-epsil/src/debug-worker.ts` | 811–811 → 625–625 | Existing step-mode verdict moved from the top-level driver into statementHook. |
| `vscode-epsil/src/debug-worker.ts` | 609–609 → 608–608 | Existing missing-source-offset guard moved before top-level hook dispatch. |
| `vscode-epsil/src/inline-runner.ts` | 118–121 → 101–104 | Existing inline-result value/error rendering moved unchanged into onStatement. |
| `vscode-epsil/src/inline-runner.ts` | 122–122 → 105–105 | Existing inline-result NDJSON write moved unchanged into onStatement. |

### Additional exact retained reporting lines

| File | Before → after |
| --- | --- |
| `vscode-epsil/src/debug-worker.ts` | 796 → 612 |
| `vscode-epsil/src/debug-worker.ts` | 801 → 615 |
| `vscode-epsil/src/debug-worker.ts` | 802 → 616 |
| `vscode-epsil/src/debug-worker.ts` | 810 → 624 |
| `vscode-epsil/src/debug-worker.ts` | 812 → 629 |
| `vscode-epsil/src/debug-worker.ts` | 813 → 630 |
| `vscode-epsil/src/debug-worker.ts` | 815 → 632 |
| `vscode-epsil/src/debug-worker.ts` | 853 → 835 |
| `vscode-epsil/src/debug-worker.ts` | 855 → 838 |
| `vscode-epsil/src/debug-worker.ts` | 856 → 839 |
| `vscode-epsil/src/debug-worker.ts` | 859 → 842 |
| `vscode-epsil/src/debug-worker.ts` | 862 → 843 |
| `vscode-epsil/src/debug-worker.ts` | 863 → 844 |
| `vscode-epsil/src/debug-worker.ts` | 864 → 845 |
| `vscode-epsil/src/debug-worker.ts` | 866 → 847 |
| `vscode-epsil/src/inline-runner.ts` | 113 → 96 |
| `vscode-epsil/src/inline-runner.ts` | 114 → 97 |
| `vscode-epsil/src/inline-runner.ts` | 117 → 100 |

The proved subtree fragments and corresponding complete debugger/inline reporting lines have identical nontrivia AST leaf-token sequences and a recorded hash in `deletion-relocation-map-final.json`; identifier-renamed snippets are not treated as unchanged. Exact integer line allocation and supplementary matched-leaf counts are in `deletion-ledger-attribution-final.json`. Changed formatting can make old/new line counts differ, so neutralization removes that apparent deletion credit as well.

## Runtime-consumer witnesses

- shared-Limit-sum (M5): function f(){let L=[1,2];limit(sum(L),1)};f(); Exact matched frozen production bundles: baseline `1` → candidate `3`; diagnostics 0/0.. Shared Limit binder/argument consumer repair; separate runtime value difference, not hidden inside sequence-owner totals.
- shared-Limit-length (M5): function f(){let L=[1,2];limit(length(L),1)};f(); Exact matched frozen production bundles: baseline `lim_(L -> 1) {Length(L)}` → candidate `2`; diagnostics 0/0.. Same shared argument-owner repair; distinct observable case retained explicitly.
- division-zero-let (M5): let x=0;x/x; Exact matched frozen production bundles: baseline `NaN` → candidate `NaN`; diagnostics 0/0.. Division folding must not turn a Program-bound zero denominator into finite1; Program fixture test/epsil/program.test.ts zero aliases.
- division-zero-const (M5): const x=0;x/x; Exact matched frozen production bundles: baseline `1` → candidate `NaN`; diagnostics 0/0.. Constant alias zero stays subject to the same pole guard; no numeric-context change.
- division-zero-alias-let (M5): let x=0;let y=x;y/y; Exact matched frozen production bundles: baseline `NaN` → candidate `NaN`; diagnostics 0/0.. Runtime-local division guard; alias case recorded separately. No numeric-context change.
- division-zero-alias-const (M5): const x=0;const y=x;y/y; Exact matched frozen production bundles: baseline `1` → candidate `NaN`; diagnostics 0/0.. Runtime-local division guard; alias case recorded separately. No numeric-context change.

Changed or ambiguous old relocation candidates receive no neutral credit and remain wholly charged: 0. See the final relocation map for exact reasons.

## Per-file mechanism allocation

| Production file | Mechanisms receiving charged line units |
| --- | --- |
| CE: `src/cli/compile.ts` | M5: added 3, deleted 1 |
| CE: `src/common/debug-hook.ts` | M3: added 11, deleted 0 |
| CE: `src/compute-engine/boxed-expression/ambient-chain.ts` | M2: added 2, deleted 1 |
| CE: `src/compute-engine/boxed-expression/arithmetic-mul-div.ts` | M5: added 8, deleted 2 |
| CE: `src/compute-engine/boxed-expression/binders.ts` | M2: added 3, deleted 1 |
| CE: `src/compute-engine/boxed-expression/box.ts` | M4: added 8, deleted 23; M2: added 26, deleted 3 |
| CE: `src/compute-engine/boxed-expression/boxed-function.ts` | M1: added 9, deleted 4; M2: added 1, deleted 2 |
| CE: `src/compute-engine/boxed-expression/boxed-value-definition.ts` | M2: added 10, deleted 1 |
| CE: `src/compute-engine/boxed-expression/effects-inference.ts` | M2: added 2, deleted 2 |
| CE: `src/compute-engine/boxed-expression/function-literal.ts` | M2: added 2, deleted 2 |
| CE: `src/compute-engine/boxed-expression/lazy-view-context.ts` | M2: added 2, deleted 2 |
| CE: `src/compute-engine/boxed-expression/named-arguments.ts` | M2: added 1, deleted 1 |
| CE: `src/compute-engine/boxed-expression/parameter-defaults.ts` | M1: added 19, deleted 0 |
| CE: `src/compute-engine/boxed-expression/type-compatibility-error.ts` | M3: added 13, deleted 14 |
| CE: `src/compute-engine/boxed-expression/validate.ts` | M4: added 5, deleted 16 |
| CE: `src/compute-engine/compilation/compile-expression.ts` | M5: added 2, deleted 0 |
| CE: `src/compute-engine/declaration-origin.ts` | M1: added 5, deleted 1 |
| CE: `src/compute-engine/engine-declarations.ts` | M2: added 3, deleted 2; M1: added 6, deleted 2 |
| CE: `src/compute-engine/function-utils.ts` | M3: added 70, deleted 16 |
| CE: `src/compute-engine/index.ts` | M3: added 2, deleted 1; M4: added 0, deleted 4 |
| CE: `src/compute-engine/library/calculus.ts` | M5: added 2, deleted 1 |
| CE: `src/compute-engine/library/collections.ts` | M5: added 3, deleted 0 |
| CE: `src/compute-engine/library/control-structures.ts` | M1: added 201, deleted 102; M2: added 37, deleted 4; M3: added 23, deleted 3 |
| CE: `src/compute-engine/library/core.ts` | M1: added 13, deleted 29; M2: added 84, deleted 30; M3: added 4, deleted 0 |
| CE: `src/compute-engine/multi-clause.ts` | M1: added 3, deleted 0; M2: added 3, deleted 2 |
| CE: `src/compute-engine/statement-position.ts` | M2: added 10, deleted 0; M1: added 27, deleted 1 |
| CE: `src/compute-engine/types-definitions.ts` | M2: added 1, deleted 0 |
| CE: `src/compute-engine/types-engine.ts` | M3: added 2, deleted 1; M4: added 0, deleted 2 |
| CE: `src/compute-engine/types-expression.ts` | M2: added 1, deleted 0 |
| CE: `src/epsil/diagnostic-flow.ts` | M4: added 170, deleted 0 |
| CE: `src/epsil/error-explanations.ts` | M5: added 7, deleted 7 |
| CE: `src/epsil/error-location.ts` | M5: added 2, deleted 2 |
| CE: `src/epsil/execute-epsil.ts` | M5: added 26, deleted 37; M3: added 71, deleted 97; M1: added 1, deleted 387 |
| CE: `src/epsil/occurrences.ts` | M4: added 3, deleted 69 |
| CE: `src/epsil/parse-epsil.ts` | M5: added 4, deleted 4 |
| CE: `src/epsil/parser.ts` | M5: added 5, deleted 5 |
| CE: `src/epsil/resolve-library-names.ts` | M5: added 1, deleted 1 |
| CE: `src/epsil/serialize-epsil.ts` | M5: added 2, deleted 10 |
| CE: `src/epsil/signature-notes.ts` | M4: added 2, deleted 1 |
| CE: `src/epsil/static-diagnostics.ts` | M4: added 57, deleted 630 |
| CE: `vscode-epsil/src/debug-worker.ts` | M5: added 49, deleted 42 |
| CE: `vscode-epsil/src/inline-runner.ts` | M5: added 20, deleted 28 |
| CE: `vscode-epsil/src/server.ts` | M5: added 4, deleted 23 |
| Tycho: `src/graph-paper/notebook/ce-notebook-evaluator.ts` | M5: added 1, deleted 1 |
| Tycho: `src/graph-paper/notebook/cortex-analysis.ts` | M5: added 2, deleted 1 |
| Tycho: `src/plot-core/prelude-runner.ts` | M5: added 2, deleted 1 |

## Separate nonproduction totals

| Category | Files | Physical +/− | AST code +/− |
| --- | ---: | ---: | ---: |
| CE tests/fixtures | 109 | 1383/918 | 1207/672 |
| Editor tests/fixtures | 4 | 79/4 | 67/4 |
| Snapshots | 0 | 0/0 | 0/0 |
| Instruments/scripts | 0 | 0/0 | 0/0 |
| Documentation | 11 | 259/138 | 0/0 |
| Other | 0 | 0/0 | 0/0 |

Main-checkout measurement instruments/reports are outside this candidate diff and receive zero production credit. The primary ledger separately records its own instrument size. Other measurement scripts remain measurement artifacts. No snapshot/pinned-emission change is inferred from passing/failing assertions; only actual changed snapshot files count here.

## Retirement and completeness

The nominal 949-line retirement set is fully enumerated by the primary ledger; its frozen source remeasures 947 under the stated JSDoc-excluding metric. All named declarations/fragments and obsolete controls are independently reported there. This attribution adds no retirement credit for relocated unchanged code.

All captured production code line units are allocated, including imports, new wrappers and shared integration lines. Unresolved manual attribution: none for this capture. This does not certify semantics, completion checks, or the absence of later production edits.

## Reproduce

```sh
node /Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15/deletion-ledger-final.mjs
node /Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15/attribute-deletion-ledger-final.mjs
```
