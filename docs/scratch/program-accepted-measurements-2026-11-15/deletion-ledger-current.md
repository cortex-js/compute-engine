# FINAL-REVIEWED-SOURCE-FREEZE production deletion ledger

Captured 2026-11-16T05:03:08.306Z; frozen CE baseline `ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`; candidate `/tmp/wt-program-accepted-sol`.

**Not a final deletion claim.** Rerun after candidate freeze and finish the manual attribution below. This run reads sources and git objects only; it builds/runs no CE or Tycho code and performs no git command in Tycho.

Integrity: captured file hashes stable at end; tracked changed-file set stable; untracked file set stable; parse diagnostics 0.

## Metric

Changed physical lines intersecting nontrivia TypeScript AST leaf-token ranges; skip JSDoc AST nodes/EOF; multiline literals intersect each physical line. Non-JS/TS files have physical counts only, code count 0 means not measured.

Diff matching: git diff --no-index --no-ext-diff --no-renames --unified=0; default Git text diff matching. Physical additions/deletions include comments and blank lines. Exact body moves are neutralized only in code gross totals; raw physical churn remains shown. Tests and snapshots are never production credit.

| Category | Files | Physical + | Physical − | AST code + | AST code − |
| --- | ---: | ---: | ---: | ---: | ---: |
| CE production | 36 | 969 | 3197 | 861 | 1650 |
| Tycho production | 3 | 8 | 7 | 5 | 3 |
| CE tests/fixtures | 45 | 743 | 501 | 672 | 389 |
| Editor tests/fixtures | 4 | 79 | 4 | 67 | 4 |
| Snapshots | 0 | 0 | 0 | 0 | 0 |
| Instruments/scripts | 0 | 0 | 0 | 0 | 0 |
| Documentation | 6 | 205 | 124 | 0 | 0 |
| Other | 0 | 0 | 0 | 0 | 0 |

Combined production raw code: +866/−1653; net -787. Automatically neutral unchanged bodies: +34/−34. Remaining charged gross code: +832/−1619.

## Per production file

| Project/file | Physical +/− | Raw AST +/− | Exact move +/− | Charged AST +/− |
| --- | ---: | ---: | ---: | ---: |
| CE: `src/common/debug-hook.ts` | 14/0 | 11/0 | 0/0 | 11/0 |
| CE: `src/compute-engine/boxed-expression/ambient-chain.ts` | 2/1 | 2/1 | 0/0 | 2/1 |
| CE: `src/compute-engine/boxed-expression/binders.ts` | 3/1 | 3/1 | 0/0 | 3/1 |
| CE: `src/compute-engine/boxed-expression/box.ts` | 31/57 | 29/24 | 0/0 | 29/24 |
| CE: `src/compute-engine/boxed-expression/boxed-function.ts` | 7/51 | 4/5 | 0/0 | 4/5 |
| CE: `src/compute-engine/boxed-expression/boxed-value-definition.ts` | 71/2 | 44/1 | 34/0 | 10/1 |
| CE: `src/compute-engine/boxed-expression/effects-inference.ts` | 2/2 | 2/2 | 0/0 | 2/2 |
| CE: `src/compute-engine/boxed-expression/function-literal.ts` | 2/2 | 2/2 | 0/0 | 2/2 |
| CE: `src/compute-engine/boxed-expression/lazy-view-context.ts` | 2/2 | 2/2 | 0/0 | 2/2 |
| CE: `src/compute-engine/boxed-expression/named-arguments.ts` | 1/1 | 1/1 | 0/0 | 1/1 |
| CE: `src/compute-engine/boxed-expression/parameter-defaults.ts` | 22/0 | 19/0 | 0/0 | 19/0 |
| CE: `src/compute-engine/boxed-expression/validate.ts` | 7/88 | 5/16 | 0/0 | 5/16 |
| CE: `src/compute-engine/compilation/compile-expression.ts` | 4/0 | 2/0 | 0/0 | 2/0 |
| CE: `src/compute-engine/function-utils.ts` | 76/21 | 73/21 | 0/0 | 73/21 |
| CE: `src/compute-engine/index.ts` | 4/7 | 2/5 | 0/0 | 2/5 |
| CE: `src/compute-engine/library/calculus.ts` | 2/1 | 2/1 | 0/0 | 2/1 |
| CE: `src/compute-engine/library/control-structures.ts` | 229/243 | 217/103 | 0/0 | 217/103 |
| CE: `src/compute-engine/library/core.ts` | 35/111 | 32/75 | 0/34 | 32/41 |
| CE: `src/compute-engine/statement-position.ts` | 27/0 | 22/0 | 0/0 | 22/0 |
| CE: `src/compute-engine/types-definitions.ts` | 1/0 | 1/0 | 0/0 | 1/0 |
| CE: `src/compute-engine/types-engine.ts` | 5/30 | 2/3 | 0/0 | 2/3 |
| CE: `src/compute-engine/types-expression.ts` | 1/0 | 1/0 | 0/0 | 1/0 |
| CE: `src/epsil/diagnostic-flow.ts` | 148/0 | 141/0 | 0/0 | 141/0 |
| CE: `src/epsil/error-explanations.ts` | 7/7 | 7/7 | 0/0 | 7/7 |
| CE: `src/epsil/error-location.ts` | 2/2 | 2/2 | 0/0 | 2/2 |
| CE: `src/epsil/execute-epsil.ts` | 86/1022 | 77/545 | 0/0 | 77/545 |
| CE: `src/epsil/occurrences.ts` | 6/102 | 3/69 | 0/0 | 3/69 |
| CE: `src/epsil/parse-epsil.ts` | 4/4 | 4/4 | 0/0 | 4/4 |
| CE: `src/epsil/parser.ts` | 5/5 | 5/5 | 0/0 | 5/5 |
| CE: `src/epsil/resolve-library-names.ts` | 6/14 | 1/1 | 0/0 | 1/1 |
| CE: `src/epsil/serialize-epsil.ts` | 2/10 | 2/10 | 0/0 | 2/10 |
| CE: `src/epsil/signature-notes.ts` | 3/1 | 2/1 | 0/0 | 2/1 |
| CE: `src/epsil/static-diagnostics.ts` | 50/1260 | 42/626 | 0/0 | 42/626 |
| CE: `vscode-epsil/src/debug-worker.ts` | 68/70 | 65/58 | 0/0 | 65/58 |
| CE: `vscode-epsil/src/inline-runner.ts` | 29/41 | 28/36 | 0/0 | 28/36 |
| CE: `vscode-epsil/src/server.ts` | 5/39 | 4/23 | 0/0 | 4/23 |
| Tycho: `src/graph-paper/notebook/ce-notebook-evaluator.ts` | 2/2 | 1/1 | 0/0 | 1/1 |
| Tycho: `src/graph-paper/notebook/cortex-analysis.ts` | 3/2 | 2/1 | 0/0 | 2/1 |
| Tycho: `src/plot-core/prelude-runner.ts` | 3/3 | 2/1 | 0/0 | 2/1 |

## Named retirement inventory

The nominal 949-code-line inventory is fully enumerated: 921 declared named-helper lines plus 28 declared fragment lines. The frozen source remeasures 947 lines under the stated metric. `prepareFunctionDeclarations` has 228 rather than 230: two inline return-property JSDoc lines are excluded. No other inventory count differs. Do not silently award the nominal extra two lines. Inventory is not earned deletion credit; code moves and remaining callers must still be accounted for.

| Name | Expected code | Frozen AST code | Declaration remains | Original-file identifier refs |
| --- | ---: | ---: | ---: | ---: |
| `prepareFunctionDeclarations` | 230 | 228 | 0 | 0 |
| `hasOuterDefinition` | 8 | 8 | 0 | 0 |
| `outerDefinitionType` | 9 | 9 | 0 | 0 |
| `statementWrites` | 65 | 65 | 0 | 0 |
| `isSettledBefore` | 8 | 8 | 0 | 0 |
| `functionLocalNames` | 23 | 23 | 0 | 0 |
| `namesIn` | 12 | 12 | 0 | 0 |
| `writtenNames` | 21 | 21 | 0 | 0 |
| `boxTopLevelStatement` | 25 | 25 | 0 | 0 |
| `runsAsProgram` | 15 | 15 | 0 | 0 |
| `isProgramBlock` | 8 | 8 | 0 | 0 |
| `firstDeclarationIndex` | 10 | 10 | 0 | 0 |
| `topLevelRedeclaration` | 10 | 10 | 0 | 0 |
| `topLevelDeclarationIndexes` | 23 | 23 | 0 | 0 |
| `declaredByEarlierStatement` | 14 | 14 | 0 | 0 |
| `topLevelUseCheck` | 17 | 17 | 0 | 0 |
| `TOP_LEVEL_USE_CHECKS` | 4 | 4 | 0 | 0 |
| `TOP_LEVEL_DECLARATIONS` | 4 | 4 | 0 | 0 |
| `isLibraryConstant` | 4 | 4 | 0 | 0 |
| `applyAssignmentTypeEffect` | 113 | 113 | 0 | 0 |
| `declareStatementNames` | 15 | 15 | 0 | 0 |
| `registerPinnedSignature` | 142 | 142 | 0 | 0 |
| `pinnedAliasOf` | 13 | 13 | 0 | 0 |
| `passScopeDefinition` | 8 | 8 | 0 | 0 |
| `assignOverUserFunction` | 23 | 23 | 0 | 0 |
| `installAssignedLiteralBeforeClause` | 25 | 25 | 0 | 0 |
| `keepConstantBinding` | 15 | 15 | 0 | 0 |
| `PinnedSignature` | 7 | 7 | 0 | 0 |
| `reassignedPin` | 25 | 25 | 0 | 0 |
| `replacePin` | 19 | 19 | 0 | 0 |
| `isNamedSignature` | 6 | 6 | 0 | 0 |

| Fragment | Expected/frozen code | Deleted frozen code | Exact old fragment remains |
| --- | ---: | ---: | --- |
| Program-as-Block deferral declarations | 12/12 | 12 | false |
| Deferral boundary | 1/1 | 1 | false |
| Deferral count | 1/1 | 1 | false |
| Per-statement deferred constant shadows | 13/13 | 13 | false |
| Deferral cleanup loop | 1/1 | 1 | false |

## Exact unchanged body relocations

- src/compute-engine/library/core.ts:4280 (widenLocalType) → src/compute-engine/boxed-expression/boxed-value-definition.ts:2389 (widenLocalType): 34/34 neutral code lines.

## Remaining obsolete-name/control references

Text matches below include explanatory comments and unrelated same-name helpers; inspect before treating them as retained calls.

- `assignOverUserFunction` — src/compute-engine/multi-clause.ts:950
- `namesIn` — src/compute-engine/function-utils.ts:5291
- `namesIn` — src/compute-engine/function-utils.ts:5424
- `namesIn` — src/compute-engine/function-utils.ts:5485
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:3670
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24562
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24625
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24644
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24698
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24726
- `namesIn` — src/compute-engine/boxed-expression/boxed-function.ts:24779

## Unresolved manual attribution

Exact-body move recognition is deliberately conservative. Any moved partial body, changed wrapper, whitespace-changed body, same-name unrelated helper or interleaved mechanism must be reviewed manually before final per-mechanism accounting. Raw diff totals and project net are exact for the captured text; charged gross totals remain provisional until this attribution is complete.

The per-file totals are not yet the required five-mechanism breakdown: shared core/evaluator/checker files interleave responsibilities. Do not assign a whole file to one mechanism merely to fill the table. The JSON lists unmatched deleted function bodies and every production file needing attribution. No partial-body relocation receives automatic deletion credit.

## Obsolete control/caller status

- `_staticPinnedCallees`: 0 text references in candidate src.
- `_staticAssignmentEvidence`: 0 text references in candidate src.
- `TOP_LEVEL_USE_CHECKS`: 0 text references in candidate src.
- `TOP_LEVEL_DECLARATIONS`: 0 text references in candidate src.
- `runsAsProgram`: 0 text references in candidate src.
- `isProgramBlock`: 0 text references in candidate src.
- `firstDeclarationIndex`: 0 text references in candidate src.
- `prepareFunctionDeclarations`: 0 text references in candidate src.
- `boxTopLevelStatement`: 0 text references in candidate src.

## This measurement instrument

The main-checkout instrument is outside the candidate diff and receives zero production credit: 182 physical / 177 AST code lines, SHA-256 `d717db6912ddda2529a50d122ab8079eb8d3b32d728453558cce7d637b592e1a`. Other main-checkout reports/adapters are deliberately not mixed into the candidate production diff.

## Reproduction

```sh
node /Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15/deletion-ledger.mjs --repo /Users/arno/dev/compute-engine --candidate /tmp/wt-program-accepted-sol --baseline ffff1d44fc566ef01fb52a0ce67b6797797f4dcf --tycho-before /private/tmp/program-accepted-tycho-before --tycho-live /Users/arno/dev/tycho --output /Users/arno/dev/compute-engine/docs/scratch/program-accepted-measurements-2026-11-15 --phase PROVISIONAL
```

Artifacts: `deletion-ledger-current.json` records source hashes, parser diagnostics, per-file totals, exact-body moves and all retirement checks. The instrument itself is measurement code and gets no production credit.
