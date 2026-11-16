# Stable batch phase 1: implementation ledger

Experimental source base: `ed54c0a68949924176b45251b7f4c4f2871ff93b`.
This document describes the bounded F01–F09 implementation, not a migration
approval. The coordinator owns matched timing, allocation, retention and the
final proceed/revise/stop recommendation.

The sections through the original verification evidence describe commit
`817f3a87c`. The current bounded revision is recorded at the end of this ledger
and in the [revision report](2026-11-15-stable-batch-phase1-revision-report.md).

## Implemented boundary

`src/compute-engine/experimental/stable-batch.ts` is an internal, unexported
package module. `prepareBatch(engine, entries, externalDefinitions)` captures
plain declaration descriptions, copies and freezes their syntax, collects
heads, resolves direct binding identities and records conservative static type
strings and effects. Acyclic explicitly typed named functions are supported.
Mutable slots require explicit types. The host's existing engine is reused;
preparing a revision does not construct an engine or publish declarations.

`PreparedBatch` has frozen arrays and records, not a published mutable map.
`ReadNode.type` is a prototype getter over its frozen direct binding. Builder
maps are discarded. Runtime instances own a separate map from binding identity
to CE value. Writes perform literal admission against the fixed slot type;
they do not box source syntax or invoke the builder. Revisions do not share
that value map. Host precision and effect handlers are runtime configuration
on the explicitly supplied engine; they are not static type inputs or captured
value-cache keys. That initial implementation adds no persistent value cache;
the bounded revision below introduces one explicit instance-owned result.

Arithmetic executes the captured **existing CE library evaluate handlers** for
Add and Multiply on CE numeric values. This retains CE exact/arbitrary
precision arithmetic, numeric approximation and arithmetic validation; the
prototype does not calculate addition or multiplication in JavaScript. The
small execution walker supplies binding reads and parameter frames, invokes
revision-owned bodies and passes evaluated values to those handlers. List
literal construction uses CE boxing at preparation. A statically invalid
`AssertPresent(Missing)` carries CE's existing `expected-present` error value;
its initializer is never executed during preparation. Runtime initialization
leaves failed slots uninitialized and continues valid siblings.

The host's external operators in F06 are **explicit declarative body
records**, supplied through `externalDefinitions`, rather than arbitrary CE
callbacks. The fixture adapter replaces its host descriptor registry and
supplies a new snapshot on each preparation. Old revisions retain copied
bodies and signatures. Arbitrary JavaScript callbacks with ambient mutable
state are outside this boundary; shadowed arithmetic library handlers are
refused. This experiment does not claim to snapshot arbitrary `ce.declare()`
callbacks or adopt changes from them implicitly.

F08 prepares Function/Map/Range syntax only as immutable revision-dependent
opaque records, sufficient to classify transfer refusal. Evaluating or invoking
these values explicitly returns unsupported. It does not implement closure
capture, lazy enumeration or phase-2 invocation. Aggregate transfer recursively
classifies every component before writing the target. Tuple transfer is
conservatively unsupported. Literal integer lists, strings and numbers pass
through explicit transfer. Other collection element types may be refused by
conservative admission. Mutable callable slots are explicitly unsupported.

Program, recursion, compilation, macro/binder expansion, assumption-dependent
simplification, overload trials, mutable inferred declarations, general
collection mapping and every remaining phase-2 fixture are outside this
implementation. Unknown operators return unsupported. No production API or
published contract changes.

## Mechanisms

| Classification | File and function | Evidence / remaining obligation |
| --- | --- | --- |
| Actually removed | None | Zero existing production lines or methods deleted. |
| Bypassed | `binding-unit.ts`: `readUnitEntry`, `readsUnitVariable`, `unitReadToken`, `UnitReadToken._version` | Prepared binding identities/types and value operations run with each entry set to throw. No unit environments or read tokens are attached to prepared nodes. |
| Bypassed | `boxed-expression/object-deps.ts`: `beginObjectDeps`, `recordObjectRead`, `mergeObjectDeps`, `objectDepsValid` | No dependency collector, propagation or validation is needed by the supported prepared path; each entry is set to throw after preparation. |
| Bypassed | `boxed-expression/boxed-symbol.ts`: `_cachedResolution` | Static reads and supported execution use direct identities rather than external symbol resolution/version guards. |
| Bypassed | `boxed-expression/boxed-function.ts`: `_reboxedForCallee` | Named bodies use captured immutable records and direct calls, rather than checking a live callee definition and reboxing it. |
| Still required | Existing CE engine, library bootstrap, `BoxedType`, numeric values and library arithmetic handlers | Preparation captures audited library handlers; literal construction and arithmetic retain CE costs. Production expression users still require all mechanisms above. |
| Still required | Existing general boxed function/symbol/type/caching machinery | Remains in the same distribution and engine for nonexperimental callers, library setup and unsupported constructs. No projected whole-file deletion is credited. |
| Newly added | `Builder`, `PreparedBatch`, `ReadNode`, `BatchInstance`, two diagnostic error classes | Temporary parallel preparation/activation machinery; five node variants, frozen binding records, descriptor capture and explicit literal transfer/admission. |
| Newly added | Fixture adapter, tests, diagnostic bundle transform | Experimental scaffolding, all counted below; diagnostic transform is absent from production timing builds. |

These probes establish absence of dependencies in this finite supported subset.
They do not prove these functions can be removed for every production consumer.
Projected migration deletion count: **unestablished**, credited as zero. A
production migration must identify callers and replace them before claiming
removal. No Tycho source was changed.

## Counts including coexistence

After independent-review fixes, the implementation adds 357 TypeScript lines;
the adapter adds 80 JavaScript lines; semantic/invariant tests add 112 lines;
the separate diagnostic build/probe adds 91 lines. Total implementation and
verification coexistence: **640 lines added, zero removed**. This ledger and
the coordinator's measurement files/documentation are additional scaffolding,
not included in that 640. Existing evaluator, binder, unit environments,
read tokens and dependency collectors coexist unchanged. There is no new branch
or field on an existing production boxed node and no package export.

## Verification evidence

- `node --import tsx --test benchmarks/stable-batch/phase1.test.mjs`: eight
  tests pass, including every frozen F01–F09 step. Additional checks observe
  copied syntax, frozen direct records, final free-name requirements, unchanged
  revision/type identities during writes, rejected nonfinite real writes,
  unchanged source/target instances after refused transfer, numeric-object literal
  admission including nonfinite refusal, and 100 writes with
  general `engine.box` replaced by a throw.
- Scoped `npx oxlint` passes on the implementation, adapter, tests and probes.
- `npx tsc --ignoreConfig --target es2022 --module es2022 --moduleResolution
  bundler --types node --skipLibCheck --noEmit
  src/compute-engine/experimental/stable-batch.ts`: exit 0.
- The coordinator ran `node benchmarks/stable-batch/phase1-probes.mjs` under the
  shared box lock. Attempt 0 exposed a live Missing-symbol resolution in the
  error initializer; the captured CE error fixes that dependency. Attempt 1
  passes every fixture with all ten listed entries throwing after preparation.
  The independent review then found that the attempted static-read sweep used
  an observable result that had stripped the unit. The corrected probe retains
  the raw unit and asserts nonzero visited unit/binding counts; the coordinator
  ran that final diagnostic successfully: 20 units and 48 bindings visited,
  with no forbidden calls.
  Each probe has a nonzero real-production positive control, respectively
  `2, 1, 1, 2, 2, 2, 1, 2, 42, 2` in the probe-list order. Unit controls use
  real `UnitEnvironment`, collector, lookup, variable-read and dependency
  validation operations; the ordinary boxed expression supplies external
  resolution and callee controls. Diagnostic output is separate from timing.

Implementation source SHA-256 at freeze:
`1e4014a52cba5fcad5f063111c01fc299dc0d59d412b14d626b9f6af8a0fef4e`.
Adapter SHA-256:
`0b27639e5632211e5e0b9a5bcffb17366600a7c6f603a56b07dc740f830a8331`.
Tests SHA-256:
`90b3d9dff975db40326a6c6f0530a31fe8242f7071bc45726b49b977c986ccd2`.
Probes SHA-256:
`79a4785dde6f8f19052281a7fcdcc3b027fadf1a2df93b31e98f3ee2cc0a95c7`.

The implementation session ran no build, full/core suite, corpus, public docs
update, staging or commit. The coordinator owns independent review, combined
integration checks and performance/memory results. Broad tests were omitted
because existing production behavior is unchanged and the task expressly
limits delegated validation to the experimental path.

## One bounded revision after coordinator review

The [fixed criteria](2026-11-15-stable-batch-revision-criteria.md) preceded every
revised candidate measurement. CPU/allocation profiles preceded source changes.
The direct-only trial preceded the cache trial. Final source SHA-256:
`b68404d15fb255c929aa9f9f04cbe09de43a657bcd5deb5858ca09365089c896`.

| Classification | Concrete mechanism | Evidence and cost |
| --- | --- | --- |
| Actually removed | No production method or tracking mechanism | Zero deletion credit; the existing production consumers remain unchanged. |
| Still bypassed | The original ten unit/dependency/external-resolution entry points above | Final armed fixtures, static sweep of 20 units/48 bindings, and cache sweep of three misses/two hits/one write pass; every positive control fires. |
| Newly added | `PreparedBatch.resolve`, immutable `{unit,binding}` handle, `BatchInstance.evaluateHandle` | One-time lookup/creation is included in preparation. O(1) unit identity check prevents foreign-revision use; the name route remains separately measured. Direct-only adds 17 source lines and does not close the runtime gap. |
| Newly added | Readonly prepared `Binding.cacheable` | Derived once from settled number/string type and conservative scope-only effects; no runtime inference or dependency collection. Construction cost and allocation increase versus the frozen prototype. |
| Newly added | `BatchInstance.cached`, at most one `CachedResult` | One result for one binding/mode/context, not a per-entry Map. Key covers engine/global working/requested precision, tolerance, rounding, angular unit, strictness and immutable effects identity. |
| Newly added | Explicit cache transitions in `initialize`, `write`, `evaluateBinding` | Accepted writes, including unrelated writes, and initialization clear it. Refused writes preserve it. Other binding/mode/context misses replace it; transient configuration bypasses/clears; unsuccessful or aggregate computations are not stored. |
| Still required | The binding-keyed value Map and existing CE arithmetic/numeric handlers | No indexed slots, new arithmetic handler, callback snapshot mechanism or general evaluator extension. Misses continue through the existing experimental walker and audited CE handlers. |
| Newly added | Matched mapped-profile attribution, warmed numerical/snapshot/harness retention, fixed criteria | Function-entry attribution limits are explicit. Finite total-heap bounds include code/harness bytes; RSS/capacity are separately reported. All scaffolding and raw instruments count as additions. |

The one record adds a runtime context check, not contextual static types. In
this subset the scope effect means instance-owned slot reads; every write to
those values crosses the explicit invalidation boundary. Immutable definition
bodies and audited pure handlers cannot read mutable host bindings or invoke
host capabilities. F06 declarative-source and F08 opaque-refusal limits remain.
No hidden invalidation graph or ambient assumption key is introduced.

The final tracked source/instrument/test total is **1,823 lines**, net **+525**
against the initial 1,298. Engine source is 415 lines (+60/-2, net +58); the
direct-only step was +17 and the cache increment net +41. Tests grow net +209,
instruments net +258. A seven-line site-hypothesis JSON, documentation, evidence
and temporary orchestration/analysis are separate. The two deleted experimental
source lines are not a production-method deletion. Tycho modifications and
actual/projection deletion credits remain zero.

Ten semantic, six cache, ten revision-instrument, seven prior instrument and one
recursive-attribution tests pass; scoped native TypeScript/Oxlint, ast-grep,
combined typecheck/dependency check and the 18-suite core set pass. Independent
Sol reviews of instruments, direct access and cache deltas leave no actionable
finding. Byte-identical files reuse those checks.

Disposition: **stop for coordinator review**. Runtime/allocation and the new
finite warmed-heap gates pass. Scalar preparation is 9.210 µs against the fixed
8.862-µs historical cap in all six processes. No construction cap is waived and
no further optimization or phase-2 implementation follows automatically. The
parallel phase-2a costing identifies only a conditional 274-line Tycho deletion
ceiling, with no actual deletion and substantial retained host policy.
