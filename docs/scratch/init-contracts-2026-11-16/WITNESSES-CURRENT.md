# Historical and updated initialization-contract witnesses

This sheet separates interpreter values, native compilation, and interpreter
fallback. A passing `result.run()` assertion is **not** native compilation evidence
unless `result.success` was also true. “Not executed” is not a decline or a passing
value check.

## Source identities and evidence limits

| Label | Source and evidence |
| --- | --- |
| Historical consolidated control | `dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`, unchanged control at `/private/tmp/ce-init-contracts-measurement/current/ce`. The four original witness suites passed 66 tests before implementation; see [baseline results](baseline-witnesses.json) and [control notes](CONTROLS.md). |
| Historical D1 candidate | November 16 implementation in `/private/tmp/ce-init-contracts-20261116`. Direct witness results are `/private/tmp/ce-init-contracts-candidate-witnesses.json`; this is not the updated candidate. |
| Historical original interpreter control | `ffff1d44f`, `/private/tmp/program-only-accepted-baseline-20261115/ce`; used for the separately capped full annotated-gasket interpreter control. This is distinct from the consolidated `dbcfdca7e` compiler baseline. |
| Updated control | `fd7bad6e1`, `/private/tmp/ce-init-contracts-current-measurement-20261118/current/ce`, with the intervening compiler changes and without the current D1 patch. |
| Updated candidate | `fd7bad6e1` plus the D1 patch in `/private/tmp/ce-init-contracts-current-review`, including the fixed-unknown matrix-order correction. Final paired witness results are linked below. |

The updated source has retired the historical whole-gasket compilation tests and
removed `PROGRAM` from `recursive-list-builder-compile.test.ts`. The probe uses the
unchanged source text retained in the November 16 fixture tree; it does not substitute
a smaller program and call that full-gasket parity. Intervening compiler changes
must be separated from D1 coverage changes by comparing the updated control with
the updated candidate.

## Gasket and recursive programs

The complete gasket oracle is 224 circles. Program `a` and recursive `PROGRAM`
return `[224,[4,6,18,54,86,28,8,8,4,4,4,0]]`; inlined `b` and `c` return `224`.

| Witness | Historical consolidated control | Historical D1 candidate | Updated paired status |
| --- | --- | --- | --- |
| Gasket `a-user-functions.epsil`, original unannotated source | Native JavaScript value matches the complete oracle. The original test disables fallback. | No independent final whole-fixture result is asserted here. | Both `success:false`, `outside-profile`: `DefineFunction` unsupported. No fallback was run by the paired compiler probe. |
| Gasket `a`, existing `seen(acc: list<tuple<number,number,number,number>>, c)` annotation | Native JavaScript value matches the complete oracle, fallback disabled. | No independent final whole-fixture result is asserted here. | Both `success:false`, `outside-profile`: `DefineFunction` unsupported. Full interpreted oracle separately confirmed on original/control/candidate below. |
| Gasket `b-inlined-tuples.epsil`, original | Native JavaScript gives 224, fallback disabled. | No independent final whole-fixture result is asserted here. | Both `success:false`, `outside-profile`: tuple of tuples. No fallback run. |
| Gasket `c-inlined-flat-lists.epsil`, original | Native JavaScript gives 224, fallback disabled. | No independent final whole-fixture result is asserted here. | Both `success:false`, `outside-profile`: `Loop` without `Element`. No fallback run. |
| Recursive `PROGRAM`, original unannotated | The test was already `test.failing`: its compilation failure is expected, not native parity. | Direct probe: valid expression, `success:false`; `ListJoin` operand 1 is not an indexed collection. No fallback/native value was executed by that probe. | Both `success:false`, `outside-profile`: `DefineFunction` unsupported. No fallback run. |
| Recursive `PROGRAM`, existing two annotations | Native compilation is explicitly checked successful, then gives the complete oracle. | Direct probe: `success:true`; native value matches the complete oracle. | Both `success:false`, `outside-profile`: `DefineFunction` unsupported. No fallback run. |
| Small `function f(acc){let out=acc;out=[...out,1];out};f([0])` | Existing control promises unknown parameter and nested result `[[0,1]]`. | Unknown parameter/result retained; no whole-list contract inferred from assignment. | Both valid; interpreter and compiler fallback give `[[0,1]]`, diagnostics empty. Both native `success:false`: `DefineFunction` unsupported. |
| Same small builder with `acc:list` | Existing annotated result `[0,1]` and native compile success are tested historically. | Explicit contract preserves `[0,1]`. | Both valid; interpreter and compiler fallback give `[0,1]`, diagnostics empty. Both native `success:false`: `DefineFunction` unsupported. |

The existing recursive annotations are exactly these replacements:

```text
function fill(p, q, r, depth, acc)
→ function fill(p, q, r, depth, acc: list<tuple<number, number, number, number>>)
function seen(acc, c)
→ function seen(acc: list<tuple<number, number, number, number>>, c)
```

The full existing annotated `a` fixture was also interpreted once on each arm,
with precision 21 and an identical 30-second process wall cap. All three returned
the complete oracle with zero diagnostics and direct process exit 0. This is a
bounded correctness control, not a throughput comparison:

| Arm | Process wall seconds | Timeout | Full oracle | Raw result |
| --- | --- | --- | --- | --- |
| Original `ffff1d44f` | 9.872 | No | Match | [JSON](annotated-gasket-interpreter-original.json) |
| Updated control `fd7bad6e1` | 6.850 | No | Match | [JSON](annotated-gasket-interpreter-control.json) |
| Main candidate | 7.749 | No | Match | [JSON](annotated-gasket-interpreter-candidate.json) |

All arms used the same source hash, recorded in the packets, with only the existing
`seen` annotation. [Runner](run-annotated-gasket-interpreters.py) enforces the cap
and records physical exit codes; [child](annotated-gasket-interpreter.mjs) records
the direct interpreter result. The combined runner exited 0. Unannotated full-gasket
and full recursive interpreter executions were not added. Historical fixture
comments report 21–69 second interpreter executions; those old timings are not
new observations.
The performance harness's length/curvature checksum 415 is a bounded collection
helper, not the complete 224-circle program; see [measurement scope](MEASUREMENTS.md).

## Collection values and compilation

These existing direct logs distinguish `compiled:false` from a successful fallback:
`/private/tmp/init-observed-compute-engine.log` (updated unpatched main source),
`/private/tmp/init-observed-ce-init-contracts-20261116.log` (historical candidate),
and `/private/tmp/init-observed-ce-init-contracts-current-review.log` (updated
candidate before the matrix-order correction). They are prior observations;
final paired outputs below supersede them for the exact listed probe sources.

| Witness | Earlier unpatched observation | Updated candidate observation | Annotation/migration and limit |
| --- | --- | --- | --- |
| Empty list grown by squares, length oracle 3 | `xs:list<integer>`, `i:integer`; interpreter 3; native `success:false`, fallback 3 (`List(): an empty list`). | `xs:list<unknown>`, `i:number`; interpreter 3; native `success:false`, fallback 3 (same empty-list capability limit). Types are stable before/after execution. | Final paired probe: annotation is valid on both; interpreter/fallback 3, no diagnostics. Both native declines: local `list<real>` outside profile. |
| Growing row queue, length oracle 4 | Queue `list<list<integer>>`; interpreter 4; native decline, fallback 4. | Queue `list<list<number>>`; interpreter 4; native decline, fallback 4. Current reason: `Loop` without `Element`. | Final paired probe: annotation valid on both; interpreter/fallback 4, no diagnostics. Both native declines: local `list<list<real>>` outside profile. |
| Row accumulator, scalar oracle 14 | Rows `matrix<integer^(2x2)>`, scalar/index integer; interpreter 14; native decline, fallback 14. | Rows `list<list<number>>`, scalar/index number; interpreter 14; native decline, fallback 14. | Length erasure is intentional; fallback agreement is not restored native coverage. |
| Vector local later assigned a matrix, no annotation | Historical behavioral test rejects the second assignment against the initial list contract. | Current behavioral test retains the rejection. | Explicit `list<integer | list<integer>>` admits both shapes. Current interpreter result is `[[1,2]]`; mapped result `[[2,4]]`. Compiler explicitly reports `success:false`/`outside-profile`, and `run()` supplies interpreter fallback. |
| Written bare parameter assigned `[7,8]`, then Map/Filter/Reverse; called with `[1.5,-2,0.25]` | Whole-list outputs `[14,16]`, `[8]`, `[8,7]`. | Bare parameter stays unknown; outputs are repeated per input cell: `[[14,16],[14,16],[14,16]]`, `[[8],[8],[8]]`, `[[8,7],[8,7],[8,7]]`. | Existing `list<number>` parameter annotation preserves the original flat outputs on both literal and named calls. This is runtime binding behavior, not merely a compiler decline. |

The updated full-suite pass of `block-local-list-rank-join.test.ts` establishes its
explicit decline assertions. A pass of `tycho-item-332-block-let-literal-type.test.ts`
alone does not establish native coverage: its `expectParity()` invokes default
fallback and asserts `run()` without asserting `success`.

## Corpus annotations already observed

The November 16 witness packet records `run-length-encoding` original refusing a
`character` write to the fixed `string` carrier. Annotating `prev:string|character`
removes that refusal and gives the fixture's concrete encoded/decoded tuple. This
is an explicit union migration, not an inferred widening.

For `isbn-verifier`, both forms in that packet return a symbolic `Map` with no
diagnostics. The `cs:list<character>` annotation preserves the intended character
contract, but that packet does **not** establish the commented boolean-list oracle.
A diagnostic-free symbolic result must not be reported as concrete corpus parity.

## Final paired probe results

The reproducible script is [witnesses-current-probe.mjs](witnesses-current-probe.mjs).
It was syntax-checked with `node --check` (exit 0). It records original and annotated
sources separately, expression validity, compiler `success`, diagnostic, execution
route and value. Failed large compilations do not launch interpreter fallback.
Small sources also run through a fresh `executeEpsil` engine.

Both commands ran serially under the coordinator's final validation lock, with
direct exit 0 (0.70 and 0.82 seconds). Corrected final packets:
[updated control](witnesses-updated-control.json),
[updated candidate](witnesses-updated-candidate.json). Commands:

```sh
node --import /Users/arno/dev/compute-engine/node_modules/tsx/dist/loader.mjs docs/scratch/init-contracts-2026-11-16/witnesses-current-probe.mjs /private/tmp/ce-init-contracts-current-measurement-20261118/current/ce /private/tmp/ce-init-contracts-20261116 /private/tmp/init-witnesses-updated-control.json
node --import /Users/arno/dev/compute-engine/node_modules/tsx/dist/loader.mjs docs/scratch/init-contracts-2026-11-16/witnesses-current-probe.mjs /private/tmp/ce-init-contracts-current-review /private/tmp/ce-init-contracts-20261116 /private/tmp/init-witnesses-updated-candidate.json
```

Both packets contain 14 separately named sources: six large gasket/recursive
sources and eight small collection/recursive sources. **Native success is false
for all 14 on both updated arms.** Thirteen are valid and decline outside the IR
profile; the unannotated rank-change program is invalid and declines with
`static-type-error`. The seven valid small programs have matching interpreter and
fallback values on both arms, with no diagnostics. The invalid rank-change program
refuses the matrix write and retains `[1,2]` with `assignment-type-mismatch` on both;
its fallback packet records JSON `null`, not a matching interpreter value. The
probe's JSON serialization does not distinguish literal null from a nonfinite
number serialized as null, so no more precise fallback-value claim is made.

Thus these updated paired rows establish no D1-only native-coverage loss: both arms
already share the reported compiler-profile limits. Historical native successes
must remain visible, rather than being replaced by fallback assertions. The large
compiler probes deliberately do not execute fallback; the separate annotated
interpreter control above supplies its full oracle evidence.

The first packet attempt contained three malformed migration spellings with no
space before `=` after a generic type, accidentally tokenizing `>=`. Those outputs
are retained as [rejected control probe](witnesses-updated-control-unspaced-probe.json)
and [rejected candidate probe](witnesses-updated-candidate-unspaced-probe.json).
They are not valid annotation-migration evidence. Only the probe strings were
corrected (`list<real> = []`, etc.); the corrected commands above were rerun with
unchanged engine source. No production or test expectation was changed for this
sheet. No witness workload ran concurrently with the measurement workload.
