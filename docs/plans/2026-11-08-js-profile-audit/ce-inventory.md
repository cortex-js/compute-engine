# Compute Engine consumer and decision inventory

Evidence: read-only inspection of `/tmp/wt-js-profile-audit`, pinned at `9c126c5d8`. Line references below are relative to this worktree, not the moving main checkout. No tests, benchmarks, probes, source changes, or git mutations were performed. This is a source-based inventory, not a completeness or correctness certification. No new defect was established.

## Principal finding

The numeric-kernel profile is a useful shared compiler vocabulary, but it cannot replace the distinct semantic contracts of its internal consumers. In particular, a compiled double-valued function is not automatically suitable for exact Map evaluation, solver rejection proofs, complex quadrature, or shipping to a worker. Keep those consumer gates and result adapters while migrating admission/emission.

The common implicit compilation policy seam is `src/compute-engine/implicit-compile.ts:50`. It honors `ce.jit`, disables repeated CSP attempts after an EvalError, propagates cancellation, and silently declines ordinary compile failures. It forces `fallback: false` and `entryChecks: false`: internal consumers own the argument contract and validate results. Its `withCapturedCallBindings` walk (line 113) visits reachable function bodies and stored symbol values to reconcile lexical callable bindings. A profile pass must run inside this effective binding environment, not inspect a bare serialized expression separately.

## Consumer matrix

| Consumer and evidence | Current contract and route | Profile migration obligation |
| --- | --- | --- |
| Map/Filter numeric drains, `library/map-auto-compile.ts:47`, `:669`, `:745`, `:821`, `:887` | Positional lambda. Marked numeric tier is machine-precision only; exact tier requires integer-closed, overflow-free proof; predicate tier yields boolean. Per-instance cache records dependencies and definition write versions. Compile collects `symbolDeps` and `varsObjectRefs`; unbound inputs have no channel into lambda ABI and decline. Elements can fall back to interpretation. | Numeric profile admission is necessary, not sufficient for exact tier. Preserve dependency invalidation, lexical capture identity, calling convention, precision gates, and element fallback. Do not migrate arbitrary Map merely because it is Map. |
| Reduce fast path, `library/collections.ts:11279`–`:11365` | Compiles reducer lambda only for numeric approximation/inexact inputs at machine precision, real seed/elements and nonnested elements. Changes to interpreter when accumulator ceases to be a finite machine number; preserves exactness and collection enumeration behavior. | Require scalar reducer ABI and retain precision/result checking. Parallel reduction is a separate contract: do not infer associativity from a compiled reducer. |
| Quadrature/integration, `library/calculus.ts:2441` (`integrandPartsOf`), `:1701` (`withComplexAtNaN`), `:1758` | Compiles univariate lambda; otherwise interpreted application. Integrand is split into real/imaginary parts. Pure integrands can lazily compile complex-mode retry at a NaN sample and use log-space fallback. Integration variable shielding changes compile scope. | Numeric profile must eventually cover complex mode and callable captures, but strict-only migration can leave this consumer on old target. Replay/purity policy stays outside ordinary admission; never duplicate impure sampling. |
| Numeric derivatives, `library/calculus.ts:6089` (`numericApplier`), `:5829` (compiled derivative lowering) | Univariate lambda can yield scalar or numeric array/point. Interpreter fallback numericizes result. Compiled undefined can trigger interpreted application. Compiled D/ND lowering uses purity/shape gates before constructing `_SYS.nd` calls. | Include vector-valued numeric kernels in eventual profile. Keep real projection and purity restrictions; “kernel” is not synonymous with scalar output. |
| Limits, `library/calculus.ts:6315`, `:6343`; `symbolic/limit.ts:2768` | Real sample arguments; finite/infinite approach handling. Numeric route passes explicit iteration budget. Sample iteration cancellation is converted to NaN at this consumer. Non-real constants can use interpreted real/imaginary extrapolation. | Budget and cancellation behavior are part of migration parity, including per-sample handling. Do not replace scalar numeric projection with arbitrary compiled values. |
| NDSolve, `differential-equation-utils.ts:310`, `:328`, `:378`, `:406` | Compiles RHS expressions using vars-object ABI after substituting dependent calls with synthetic state names. Each RHS projects to number; system evaluation requires all derivatives finite. An uncompiled RHS can make this construction unavailable. | Scalar numeric inputs/results; binding substitutions and reserved synthetic names preserved. Independent trajectory evaluation is distinct from parallelizing dependency-ordered ODE time steps. |
| FindFit, `nonlinear-fit.ts:660`, `:687` | `implicitCompileNumericResult` returns numeric runner and complete compilation result. Interpreter fallback uses substitution and N. `storedKernel` checks target exactly `javascript`, expression calling convention, runtimeVersion and `isShippableCode`, then stores code/preambles/entryPlan/reconstructionDigits. | Experimental target identity must not accidentally disable worker shipping. Worker portability is distinct from numeric result projection and must preserve runtime ABI metadata. |
| Finite solve-domain sieve, `boxed-expression/solve-domain.ts:1543`, `:1839` | Compiled predicate lambda enables a larger enumeration budget; compiled values are a float prefilter, with exact validation. Inexact predicates and some chains deliberately skip compilation because float rejection could remove interpreter solutions. | Numeric/boolean profile acceptance cannot override this consumer's numerical proof restrictions or automatically raise enumeration budgets. |
| Periodic-root checks, `boxed-expression/solve-domain.ts:4075`, `:4333` | `realFunction` uses projected numeric expression runner; interpreter fallback otherwise. Separate `interval-js` compilation supplies root-free enclosure proof and rejects unexpected result shapes. | Keep interval target/enclosure contract separate. JS profile parity does not establish interval-proof parity. |
| Stochastic equality, `boxed-expression/stochastic-equal.ts:91`; `boxed-expression/init-lazy-refs.ts:47` | Lazy injected compiler is the implicitCompile helper. Only NaN-propagating expressions compile; NaN samples can be interpreted, with further precision checks. | Preserve probing/recheck policy, not just values from compiled samples. |
| General numeric helper, `library/utils.ts:2059`; `implicit-compile.ts:261`, `:274` | `implicitCompileNumeric` projects any non-number result to NaN. Its sibling exposes stored compilation metadata for worker use. | Useful initial consumer seam, but make migration selection explicit and preserve cancellation/JIT/capture behavior. |

## Current JS pipeline and obligations

`javascript-target.ts:11148` applies vars-mapped function-head handling, validates storage hints even though JS ignores them, hides vars-mapped values, renames shadowing calls, and suspends asynchronous-emission context. `compileOrThrow` at line 11206 opens the pool-loop collection, calls `prepareCompilation`, then `compileToTarget`, adds warnings/references, and compiles pool loops and optionally the asynchronous copy. Batch and asynchronous copies invoke preparation separately (`:11458`, `:11288`). Admission must cover these actual bodies, not merely one original root.

`prepareCompilation` at line 11527 lowers parallel heads, rewrites angular units, rewrites partial applications, and unrolls fixed-width collections with caller override/live-source exclusions. It creates caller function/variable resolvers, folding exclusions, fresh naming, definition registries and numeric-mode settings. Near line 11880 it starts CSE on the prepared tree. An insertion point exists, but preparation is not solely a pure tree rewrite: it initializes emission state and performs the bigint preparation path as well.

`compileToTarget` at line 12374 has separate lambda and vars-object routes. Lambda handling chooses bound/emitted parameter names, default values, declared types, scalar-parameter records, enforced parameter assignments and CSE region. Later assembly adds definition/helper preambles and runtime wrapping. The numeric profile must preserve expression versus lambda ABI, result normalization, reference metadata, stored-source metadata and entry-check behavior.

`compiler-core.ts:487` reaches `compileOutermost`; at line 524 it runs `assertAdmitted` after successful emission to prefer a more specific emission decline. Declared union dispatch is performed at that boundary (`:585`). Per-node static error handling also exists (`:1456`). A pre-emission fragment pass should specify diagnostic precedence and annotate each specialization; blindly moving this admission earlier changes more than performance.

## Three source traces for a representative experiment

These are proposed fixtures whose routes were inspected; they were not executed by this audit.

### A. Typed scalar plotting/integrand body: Sin(a*x) + x*x

1. Prepare under the actual bindings and angular unit (`javascript-target.ts:11527`). Caller overrides disable incompatible rewrites and folding.
2. Scalar/collection admission is spread across `compiler-core.ts:3416` (`compileExpr`), broadcast guards (`:4073`), and `javascript-value-facts.ts:394` (`isScalarValue`). The latter has its own scalar arithmetic vocabulary (`:402`).
3. Parent Add asks `BaseCompiler.isComplexValued` for operands (`javascript-target.ts:4645`). Sin asks it again for its argument and may select a pi-multiple helper (`:8678`). Scalar Multiply has its own branch (`:8946`). These are queries of type/representation, not emitted-source formatting alone.
4. `compileToTarget` supplies lambda or vars-object wrapper; `compileOrThrow` attaches references and batch/async routes.

Initial annotation slice: statically scalar strict inputs, arithmetic and a small intrinsic set, known representation per value, no caller overrides. Keep pi-multiple specialization as an explicit lowering decision rather than pretending the semantic type selects the exact helper.

### B. Conditional numeric kernel: If(c, Sqrt(x), y) + 1

1. Same preparation; strict versus complex mode affects the radical result even for real x.
2. `compile-conditionals.ts:54` first asks the target's element-wise selection path, then requires scalar condition, computes live-arm complex coercion (`:92`), and compiles arms through distinct CSE regions (`:102`). A statically known condition removes an arm (`:111`).
3. Sqrt chooses operand-complex, constant, promoted-result, or real lowering (`javascript-target.ts:8693`). Its parent independently queries complexness.
4. The duplicate result helpers at `javascript-target.ts:10025`, `:10065`, `:10095` explicitly document synchronization with the shared complexness classifier and GPU classifier. `complexOperandCode` (`:10116`) independently chooses real-to-complex lifting.

This is the clearest bounded proof of annotation value: record one result lane and operand conversions so the parent and child cannot disagree. Retain lazy arm regions. No CPS is necessary to model this, and a single shared prelude for both branch calls would be incorrect.

### C. Numeric loop with a scalar local accumulator

1. Epsil/MathJSON parallel heads become Loop/Assign forms in preparation, retaining parallel provenance; ordinary counted loops also reach loop compilation.
2. `compile-blocks.ts:147` determines local bindings and assignment shapes. `javascript-value-facts.ts:96` records bindings whose values remain scalar across the scope; it explicitly distinguishes shadowing through scope parents.
3. `compile-loops.ts:1151` chooses counted-range lowering; `:1699` compiles Loop; `compiler-core.ts:4887` emits body statements. Comprehension/invariant paths have separate hoisting (`compile-loops.ts:435`). Indexed Sum/Product is another route (`javascript-target.ts:17961`), and records scalar counters at `:18311`.
4. Statement wrappers can be expanded via `javascript-statements.ts`; pool-loop extraction and async-copy assembly are separate from ordinary run emission.

Loop experiment should first preserve sequential order with explicit initial/carried/next values and break/continue destinations. A scalar invariant of a binding can be annotated today; the value written on iteration k, whether a read can move across a write, or whether iterations can reduce in parallel cannot be represented by scope/name type facts alone.

## Stable facts versus occurrence-dependent facts

| Suitable for prepared-tree/binding annotation | Needs value identity, occurrence/region or effects |
| --- | --- |
| Declared input shape and runtime representation | Which assignment a read observes |
| Parameter specialization under a fixed call shape | Local value range after a particular write |
| Proven same-shape local across all writes | Whether an operation can move out of a loop or branch |
| Result lane for a prepared node in its scope and mode | Whether repeated evaluations/calls may be merged |
| Resolved operand representation conversions | Shared mutable capture lifetime and aliasing |
| Static point width or list element layout | RNG stream, cancellation, throwing, host callbacks, reduction order |

Mode, caller overrides, binding environment, and tree revision must be part of the annotation context. `constantFold:false`, CSE options, angular unit, and live vars can change what is emitted or read; an annotation must not escape that context. JS scalar facts already distinguish scope parents and written parameters; do not flatten these to a global name map.

## Recommended first authoritative slice

1. Use the existing implicitCompile boundary only to select an experimental route for explicitly chosen scalar numeric consumers; preserve its policy wrapper unchanged.
2. Extract a prepared-compilation internal boundary without copying orchestration; start strict real/integer/boolean scalar inputs, arithmetic, conditionals and selected intrinsics. Initially decline host overrides and broader shapes in the experimental target.
3. Feed annotated scalar facts and lane/conversion facts into the selected emitter handlers; assert missing facts rather than silently ask legacy queries. Start with parent Add/Multiply and child Sqrt/Sin, with a conditional coercion case. Strict real inputs can still have complex-valued subexpressions from constants or statically negative types, so either annotate that case correctly or explicitly narrow the admitted slice.
4. Remove those selected redundant queries from the experimental path. Do not delete the shared classifier globally while traditional JS, interval-js, and GLSL still use it.
5. After complex-mode coverage, the documented copies `resultIsComplexValued`, `resultIsWideUnderComplexDiscipline`, `promotesToComplexLane`, and `complexOperandCode` become concrete candidates for replacement by annotation lookups/conversion emission. Their complete deletion depends on all callers migrating, not the pilot alone.
6. Derive legacy local frames from annotation for the later function/loop slice. Keep occurrence-specific scalar/range facts separate until the structured IR owns assignment versions.

## Recommended parity fixtures

- Positional scalar lambda versus vars-object plotting expression with the same mathematical body.
- Captured callable whose ambient name is shadowed, and same-name data read.
- Map machine tier and exact overflow-safe tier; dependency changed between drains.
- Quadrature real domain and pure strict-to-complex retry; impure integrand without replay.
- Vector-valued derivative callback.
- Solver predicate sieve with exact constants versus an inexact predicate intentionally not compiled.
- FindFit stored expression kernel and nonshippable runtime dependency.
- Conditional mixed real/complex arms with effect traces on each branch.
- Same-shape local accumulator loop, shadowed index, early break, and exhausted budget.

## Validation boundary

All findings above are current-source descriptions or explicitly labeled recommendations. Source was searched and read only; no code-generation outputs or timing claims were measured. No issues were created or removed. Parent should run the chosen fixtures and own any benchmark, corpus audit, defect triage, or final integration checks. Full tests, typecheck, lint, builds and dual code review were intentionally omitted because this audit changed no source.

## Exact candidate inputs for the disposable IR probe

These are unexecuted candidates for the parent to validate. Declare `x: real`,
`n: integer`. Preserve the repeated expression through structural construction
or `ce.expr` so canonicalization does not erase the purpose of the first case.

1. Repeated arithmetic: `['Add', ['Sin', ['Add', ['Multiply', 'x', 'x'], 1]], ['Cos', ['Add', ['Multiply', 'x', 'x'], 1]]]`.
2. Lazy conditional: `['If', ['Greater', 'x', 0], ['Sqrt', 'x'], ['Negate', 'x']]`. Exercise both signs; a separate host-call trace control can demonstrate that only one branch executes.
3. Accumulator loop: `['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'i', 'x']]], ['Element', 'i', ['Range', 1, 'n']]], 's']`. Loop syntax follows `test/compute-engine/compile-loop.test.ts:13`; exercise `n=0,1,8`, `x=0.5` against the simple sum oracle.
