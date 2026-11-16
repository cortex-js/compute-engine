# Mechanical Program test-consumer migrations

Worktree: `/tmp/wt-program-accepted-sol`. Scope is raw parse-container and observed-statement adaptation only. No source logic, test snapshots, emitted strings, runtime values or diagnostic expectations were changed in this task. One public type assertion was separately authorized by root and is identified below. All full evaluate/compile route inputs remain `Program`; nested `Block` nodes retain their scope.

Root-owned grammar files and test/utils.ts, and implementer-owned semantic files, were excluded. Root’s common validEpsil helper already asserts Program and unwraps only a sole grammar payload. The 141-file/1,019-failure pre-expectation census preceded these changes; it is not replaced by a passing claim.

## Exact migration locations and rationale

| Test file under test/ | Changed consumer / cases |
| --- | --- |
| epsil/binder-sites-of.test.ts | sitesOf observes operand1 of parsed Program; documentBindings and execution still receive the complete Program. |
| epsil/library-names.test.ts | resolved helper unwraps a sole observed statement and preserves multi-statement Program. Raw spelling, serializer read-back loops and compiled-lane JSON observe the statement; compile input stays Program. Root additionally changed only the constructed declared/nested fixture OUTER heads to Program, retaining nested Block. |
| epsil/named-arguments-parse.test.ts | ast helper observes sole payload; all named-argument carrier expectations unchanged. |
| epsil/generic-function-sugar.test.ts | lowered helper observes sole payload; recovery assertions do likewise. Multi-statement type+function grammar retains Program; serialization round-trip compares both full Programs. |
| epsil/parameter-default-values.test.ts | parse helper/wrong-arrow recovery/pair recovery observe payload. Root separately authorized describeName(g).type to function for unannotated let g=(xs=[],mode="auto")=>xs; explicit f default signature expectation unchanged. |
| epsil/lambda-arrow.test.ts | parse helper and legacy-arrow recovery observe sole payload; literal bodies and arrow diagnostics unchanged. |
| epsil/paren-operand-source-range.test.ts | parse helper observes sole payload but retains Program for multiple statements, so offsets remain on the intended syntax node. |
| epsil/single-block-program.test.ts | Only outer expected head Block→Program; inner do Block retained. Test title/comments describe distinct forms; execution/serialization expectations unchanged. |
| epsil/statements.test.ts | Two multi-statement raw grammar root heads Block→Program; nested loop/if/function Blocks retained. |
| epsil/declare-type.test.ts | Two multi-statement raw grammar root heads Block→Program; runtime/type expectations unchanged. |
| epsil/protocols.test.ts | Four multi-statement raw grammar root heads Block→Program; malformed-conformance recovery observes sole surviving declaration payload. |
| epsil/type-variables-epsil.test.ts | One multi-statement annotation grammar outer head Block→Program; generic/type semantics untouched. |
| epsil/definition-head-multiline.test.ts | Two multi-statement recovered grammar outer heads Block→Program. |
| epsil/type-conformance-multiline.test.ts | Three combined declare/conform raw grammar outer heads Block→Program; nested member bodies retained. |
| epsil/multi-clause.test.ts | lowered helper observes sole definition payload; full multi-clause programs and serialize/parse route equality retained. |
| epsil/parallel-for.test.ts | parse introspection helper observes a sole loop/comprehension/assignment payload; full compiler, diagnostics and execution routes retain Program. |
| epsil/member-call.test.ts | Raw parse helper observes sole member-call payload. Qualified-call canonical shape observed after full Program boxing through op1; compile/evaluate inputs unchanged. |
| epsil/latex-islands.test.ts | Spliced-primary shape and source-offset observations use sole Program operand; lexer/diagnostic expectations unchanged. |
| epsil/tuple-param-destructuring.test.ts | Duplicate-parameter recovery shape observes sole function payload; diagnostic expectations unchanged. |
| epsil/item-400-assign-function.test.ts | Raw AST helper observes sole definition/assignment payload; both spelling routes and program execution unchanged. |
| compute-engine/design-d-callback-contract.test.ts | Nine Epsil route-parity observations extract op1 after boxing the complete Program (Filter,TakeWhile,IndexWhere,Partition,Reduce,CountIf,Fold,Scan,Any). No expected canonical strings or rejection semantics changed. |
| compute-engine/field-accessor.test.ts | Raw field/member-call shape observes sole parser operand; canonical Apply shape observed after full Program boxing. |
| compute-engine/function-literal-rest-parameter.test.ts | epsilJson and malformed-spread recovery observe sole literal/definition payload; full evaluate/compile/round-trip routes unchanged. |
| compute-engine/lambda-param-element-inference.test.ts | One Filter route-parity comparison observes op1 after full Program boxing. |
| compute-engine/protocol-dispatch.test.ts | Qualified Comparable.compare parser/canonical-shape observations use sole payload after parsing/boxing respectively; protocol setup/static/evaluate routes unchanged. |
| compute-engine/protocol-properties.test.ts | Bare four-operand property-store serialization recovery observes sole parser payload; store values/effects/diagnostics unchanged. |
| compute-engine/spread-literal-result-kind.test.ts | Five spread-literal canonical/LaTeX observations extract op1 after full Program boxing; absent-spread read-back compares payload. Full compiled program route unchanged. |
| epsil/hold-functions.test.ts | Two raw DefineFunction attributes observations extract sole payload; full definitionSites and serialization inputs remain Program. |
| epsil/std-qualified-name.test.ts | parsed/resolved helpers unwrap only sole observed payload; multi-statement std::floor case retains Program and updates only outer expected head. |
| epsil/assign-to-list-element.test.ts | lastStatement introspection recognizes Program outer head; nested Blocks, full execution/compile routes and list-write expectations unchanged. |

The explicit multi-statement grammar witnesses whose OUTER expected head changed were:

```epsil
let y = 3
if c { 1 } else { 2 }
let x = 5
if x > 0 { 1 } else { 2 }
type alias point = tuple<number, number>
let p: point = (1, 2)
let type = 5
type + 1
type Point = tuple<number, number> is Comparable
let type = 5
type + 1 is integer
let type = 5
type.x is integer
let type = 5
type
string is integer
let g: (T) -> boolean where T: (real) -> real
let h = 2
```

The remaining explicit outer-head cases are the two line-split p(n) definition-head recovery witnesses and the three combined Rec/Obj declare/conform witnesses in the table’s multiline test files. Only their outer expected string literal was changed; every operand/parameter/member body stayed byte-identical.

## Checks and direct exit codes

All commands used `timeout -k 30 600 npx jest -w 4 --watchman=false -- <explicit files>` under the dedicated `codex-program-accepted:test-consumers` lock. Exact argv, selected files, direct child exit, duration and source/input fingerprints are in the linked JSON. Every source/test input fingerprint matched around its run. No snapshot updates, full/core suites, builds or timings ran in this test-consumer task.

| Run | Result | Evidence |
| --- | --- | --- |
| batch1:8 files | exit1;4 passed/4 failed;334 passed/13 failed tests;0 snapshots | [argv and certification](parser-consumers-batch1.json), [raw log](parser-consumers-batch1-log.txt) |
| batch2:23 files | exit1;9 passed/14 failed;1,258 passed/285 failed tests;0 snapshots | [argv and certification](parser-consumers-batch2.json), [raw log](parser-consumers-batch2-log.txt), [failure cases](parser-consumers-batch2-failures.json) |
| batch3:17 files | exit1;8 passed/9 failed;1,179 passed/31 failed tests;0 snapshots | [argv and certification](parser-consumers-batch3.json), [raw log](parser-consumers-batch3-log.txt), [failure cases](parser-consumers-batch3-failures.json) |

The first batch’s four passing files (named-arguments-parse, generic-function-sugar, lambda-arrow, single-block-program) were not repeated unchanged. The second batch’s nine passing files (library-names, paren-operand-source-range, statements, definition-head-multiline, latex-islands, tuple-param-destructuring, item-400-assign-function, function-literal-rest-parameter, lambda-param-element-inference) were not repeated unchanged. Previously failed consumers were rerun after relevant source fixes; batch3’s eight passing files are member-call, protocols, protocol-dispatch, field-accessor, type-conformance-multiline, parameter-default-values, hold-functions and std-qualified-name.

Batch2 exposed a type/protocol publication cascade. The production owner fixed its temporal initialization ordering, and batch3 reduced 285 failures to31. Those source repairs were not made by this task. The31 remaining failures and exact cases were returned to root/implementer for accepted-contract versus defect classification; no runtime expectation was rewritten to make them pass. They concern property-store results, stable binding-kind writes, binder timing/metadata, callable/generic contracts and known compilation controls. These test results are a partial validation checkpoint, not a claim that the implementation is ready to commit.

Root separately authorized the small implementation.md boxedEarly explanation correction; it now describes every Program occurrence (direct statements and function bodies) being prepared early, known constness and unavailable mutable execution values. No source helper/behavior was changed for that documentation follow-up.

All test locks were released after their batches. No staging, Git mutation or commit occurred. Issues created/removed by this mechanical migration task:0/0. No further clear raw-container migration was identified among the remaining inspected full-census files; their complete Program evaluation/compilation routes were preserved for semantic triage.
