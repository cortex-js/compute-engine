# Prepared expressions and shared compiler annotations — review draft

Research/design only, 2026-11-09. No production implementation or public API change is proposed by this document alone.

## Recommendation and baseline

Adopt a compilation-session-owned prepared artifact, followed by a target-specific annotation whose facts are authoritative for explicitly migrated decisions. Keep structured expressions and scoped side tables. Do not require CPS or SSA first. The next experiment should vary the chosen numeric lane and operand conversion, rather than repeat the prior experiment's uniformly real answers.

The source baseline is committed CE HEAD `916aff07c13e34482688631008c0c7a0275e45af`. All CE source/contract statements below refer to `git show` at that revision, not the working tree. Evidence is the committed `docs/plans/2026-11-09-js-profile-experiments/` report set, particularly README.md, annotation-experiment.md, profile-scope.md and their retained instruments. The integration experiment itself used `43679ce5df346479eb94b25a5882f798eafd5c74`; it is evidence of feasibility, not an implementation in this baseline.

Relevant committed references:

- `src/compute-engine/compilation/fragment.ts`: `FragmentScope`, `FragmentAnnotation`, `FragmentDefinition`, `makeWalker`, `walkIf`.
- `gpu-shader-target.ts`: `GpuPreparedRoot`, `prepareAndType`, `emitPreparedRoot`; its existing contract already prohibits tree rewrites between preparation and emission.
- `javascript-target.ts`: `prepareCompilation` lowers parallel heads, angular units, partial applications and fixed-width collections, and creates the target/CSE context.
- `compiler-core.ts`: `compileExpression` still performs shared admission and has emission-time aliases/overrides, folding and function lowering obligations.
- `docs/COMPILATION-MODEL.md`: compiled-value caveats, shape rules R1–R6, fail-closed rules, compile modes, stored runtime and worker boundaries.
- `docs/EFFECTS-MODEL.md`: implemented effect inference/projection, confinement, frame participation, capability snapshots. The document includes future designs; this proposal does not assume every section is implemented.

There is concurrent, **uncommitted** GLSL work. At inspection it adds `FragmentSignature.when`, scope-aware complex-lane selection (`complexValuedIn`), function broadcast metadata and additional broadcasting/color handling. These are relevant design signals, not accepted baseline APIs. The signature predicate calls the existing lane reader with reconstructed local frames; that is a useful transitional producer, not elimination of duplicate readers. Reconcile this proposal after that work lands; do not duplicate or overwrite it. Compilation/effects documents also have peer edits. No peer files were modified for this draft.

## 1. Ownership and lifetime

One compilation session owns preparation, its resolved dependency environment, annotation and emission. A prepared artifact consists conceptually of:

| Component | Ownership rule |
| --- | --- |
| Prepared root and reachable prepared function bodies | Owned as a logical immutable graph for this session; original boxed objects can be reused, but no stage may mutate them or change their meaning underneath the annotation. |
| Environment | Binding/definition identities actually resolved from boxed lexical context, input declarations, capture policy and selected definition versions. Ambient name lookup is not an interchangeable substitute. |
| Policy | Target, numeric mode, relevant representation options, host overrides and source mappings, fold/CSE policy, iteration/resource limits, angular unit and other preparation dependencies. |
| Provenance | Mapping from transformed nodes to original source occurrences for diagnostics; this is separate from identity used for correctness. |
| Prepared generation | An opaque session-local identity that changes whenever graph, dependency environment or policy changes. No global cache protocol is implied. |

The generation can simply be the identity of the compile-local artifact; it does not require global node IDs, cache epochs, freezing the user engine or redesigning engine mutability. Resolved binding handles and lexical scopes are sufficient for the initial identity contract.

Initially the artifact is internal and short lived. Do not expose serialized prepared trees, persistent annotation caches or public prepared handles. An emitter consumes the annotation produced for exactly this artifact and policy. Treat target/compiler mutable state as session-owned or explicitly scoped and restored, including nested compilation. A target singleton must not retain another session's facts.

The current `readonly` fields containing mutable Maps do not enforce immutability. Builders may mutate private maps while typing; consumers receive a read-only view and no mutation authority after successful publication. This can begin as an internal discipline rather than deep-freezing all boxed expressions.

Distinguish compilation reuse from execution of an already built result. An embedded captured constant is a snapshot chosen by preparation; later engine reassignment does not magically invalidate that generated function or change the embedded constant. Dynamic inputs remain supplied through the runner according to its input contract. Record which bindings were embedded, supplied dynamically or otherwise retained under an existing runtime contract. A new compilation may choose a new snapshot. Annotation lifetime/invalidation concerns compilation and cache reuse, not revocation of already generated code.

Environment changes between separate `canCompile` and `compile` calls require fresh preparation. Their answers agree for the same expression, environment and options; a declaration/reassignment between calls is not covered by the earlier result. Avoid cross-call reuse until a real dependency-version protocol exists.

## 2. Scope, binding and occurrence identity

An annotation lookup is at least `(prepared generation, lexical scope identity, expression identity)`. The existing per-scope `Map<Expression, Facts>` is a useful starting point. Names are diagnostic labels and scope lookup keys, not globally unique binding identities. A resolved binding is identified by its declaring scope plus declaration/definition identity; an input has an equivalent session-local identity.

An identical boxed object can occur in multiple lexical scopes, function specializations or evaluation positions. Facts that depend only on immutable type/representation can share a scoped entry. Facts that depend on order cannot be keyed merely by expression identity: sharing a node is not evidence that it is evaluated once. Keep use/edge identity where an operation consumes it, and introduce occurrence/region identity before storing order-sensitive facts. The prepared artifact includes the actual specialized body and scope for each function variant; a key based only on the printed function name is insufficient.

Resolve a shadowing local before an outer binding, retain the current read-before-declaration rule, and keep captured definition identity through inlining. The Tycho inventory demonstrated why an ambient lookup can identify the wrong body. Do not classify a call as a standard operator solely from its head spelling; preserve builtin/custom provenance and overrides.

**Facts stable for one binding:** declared/inferred settled shape, binding role, storage representation, and lexical ownership. These can remain fixed through same-shape assignments. **Facts not stable for one binding:** current value, constantness, sign/range inferred from an initializer, array contents, a selected callable value, or availability of a previously computed expression. They require an assignment version and possibly alias/frame dependencies.

Start with the sound simple rule: never attach initializer-derived value facts to mutable locals; invalidate affected value facts at assignment and unknown writes. A later precise analysis may introduce versions and joins. Do not add path-sensitive shape inference to remove declines: the shape contract deliberately declines a local assigned incompatible shapes. SSA would help value reasoning later, but is unnecessary for fixed binding representations now.

## 3. Preparation and rewrites

Preparation closes the expression graph that annotation and emission will use: root rewrites, reachable body preparation, specialization, constant-selection decisions and normalized operand roles. A logical artifact can contain lazily prepared bodies, but each body must complete preparation and annotation before emission, under the same session/environment; no unresolved body may be presented as already admitted.

Recommended first rule: a structural or binding rewrite after annotation invalidates the annotation and requires reannotation of the affected compilation unit. Start with whole-unit reannotation rather than selective invalidation. Preserve original-node provenance for diagnostics, not old facts on a newly constructed node. No emitter should silently call the old type/shape reader because a required annotation is missing.

Not every emission operation is a tree rewrite. Naming a temporary, referring to a previously emitted value, choosing parentheses or adding a runtime helper can preserve annotated semantics without new expression nodes. CSE must have permission to reuse a value at that point and in that region; text aliases alone do not grant permission. If a fold, algebraic rewrite, function expansion, vector unroll or helper specialization synthesizes an expression that emission recursively visits, that expression needs preparation and annotation first. Alternatively record the selected literal/lowering in a prepared plan and emit it without pretending it is the original expression's operand tree.

The JS integration proved exact-node plumbing for a single scope, but missing synthesized nodes deliberately failed. It did not establish closure for every JS emission rewrite. Inventory those rewrite sites before promising broad admission/emission parity.

## 4. Semantic types, target lanes and conversions

Keep these distinct:

1. The source declaration/inferred semantic type and literal structure constrain validity and settled shape.
2. The fragment type records the supported computational category for this prepared operation.
3. The selected target representation/lane records how this occurrence is lowered under the compile mode and constant policy.
4. Each value-consuming operand edge records its resolved conversion into that operation.

A JS `number` representation does not prove the source was an integer, and a broad semantic numeric type does not by itself select a complex kernel. Conversely, a real operand may feed an operation whose selected result lane is complex. In particular the prior probe's Sqrt promotion query cannot be generalized from its operand's real/complex fact: it was sound only because admission rejected the cases that promoted.

Store an operation's chosen result lane on the operation, and use edge conversions for real-to-complex arguments and branch joins. Do not infer result lane by asking whether any operand is complex. Use the existing target policy as the compatibility oracle while consolidating it into the producer; do not redefine strict/complex semantics to make a simpler signature table work. Folded negative constants, unknown-sign real radicals and explicit complex values must be handled or explicitly declined according to the existing compiled-code contract.

The committed fragment already supports real/complex joins and per-edge conversion lists. Define operand addressing precisely before general use: value operands versus binding names, metadata, held bodies and optional/omitted operands must not be confused by a positional list. No need to redesign it for the first fixed-arity slice, but consumers must know which list positions represent which edges.

Representation equality, output normalization and ABI shape are also separate. Existing JS complex helpers may return a number for a real result under their established contract; a selected complex computation lane is not a promise that every returned value is always a `{re, im}` object. Keep current runtime assembly and boundary conventions.

## 5. Admission and emission authority

Admission composes shared validity/shape rules, profile vocabulary/effect restrictions and target representability. An annotation's successful signature match does not waive shared static-error, captured-binding, custom-source or resource checks. Represent these obligations explicitly in the artifact's admitted state; do not equate `annotation.refusal === undefined` with every possible prerequisite being discharged.

For a migrated family, admission and emission read the same lane, conversions, binding resolution and call specialization. Emission may choose target syntax/helpers, but may not re-decide these facts. While migrating, mark exactly which decisions have authoritative facts; legacy decisions outside that boundary remain legacy. An absent required fact is an internal invariant failure, not permission for recomputation. The public facade should fail closed with a distinguishable diagnostic while development checks expose the invariant violation.

Profile and execution intent are separate policy axes. A numerical profile describes permitted vocabulary/types/effects; independent-worker eligibility additionally requires portable captures/runtime dependencies, ownership and execution semantics. A local mutable accumulator can fit a numeric profile without proving safe shared mutation. A `canCompile` request may eventually carry an execution requirement, but this draft proposes internal policy separation, not a new public option or a concurrent-by-default profile. No positive eligibility should be inferred from a syntax inventory alone. Even a supported execution requirement is not a promise that a particular invocation uses a pool: current `runAsync()` routing can choose serial execution for thresholds, pool availability and payload/size reasons. Keep capability, chosen route and performance observations distinct.

## 6. Effects and evaluation order

Reuse the existing effects source of truth and actual callable provenance. Do not invent a competing effect taxonomy inside fragments. An admitted operation also needs its evaluation contract: eager or lazy operand roles, ordered regions, possible external effects and frame dependencies. Type annotation must not execute an effectful branch to discover its facts.

A pure enclosing function may mutate confined locals, so its local writes still matter to scheduling and CSE inside its body. A same-shaped reassignment invalidates value reuse even though it does not invalidate the binding representation. Pure also does not universally mean independent of execution context: the effects contract distinguishes random draws from frame-reading derived substreams. Random-frame changes, escaping writes, unknown calls and host source require the corresponding barrier/dependency treatment.

For the first slice, preserve existing evaluation order and CSE restrictions. Keep branch conversions inside the chosen branch; never hoist or duplicate a Random draw. Record enough effect/region dependency to justify any optimization actually performed; do not build a general effect SSA merely to annotate arithmetic. Unknown effect/capture provenance blocks the proposed profile or concurrency requirement, even when ordinary legacy compilation can still be offered separately.

## Execution evidence is a separate boundary

The committed worker evidence used a custom Node scheduler and stored runtime from the installed CE package, not the current-source compiler's worker-pool route and not Tycho's browser worker hierarchy. Its private-buffer reduction and cancellation controls inform the ownership contract; they do not establish browser portability, transfer costs, teardown behavior or current `runAsync()` route selection. A browser experiment must identify its actual package/source revisions and exercise Tycho's hierarchy separately.

Profiles do not discover parallel algorithms. Marking an intended loop for parallel execution, separating independent orbit ranges, allocating private histogram buffers, choosing a reducer and committing the cursor once are explicit algorithm-authoring steps. They are distinct from proving that a program uses a numeric vocabulary or that its compiled artifact can be loaded in another worker. Preserve existing language/runtime semantics for explicit parallel constructs; do not infer parallel independence from a pure function or ordinary loop annotation. Buddhabrot motivates that separate adaptation and browser execution experiment, while the first annotation slice remains serial.

## 7. Failure categories

Keep ordinary unsupported admission distinct from internal invalidation failures:

| Cause | Result |
| --- | --- |
| Invalid expression/static `error`, untyped input, unsettled shape, lane mismatch | Preserve existing public diagnostics and unsupported names/nodes. |
| Unsupported profile head/type/effect or target representation/conversion | Structured decline naming the innermost relevant original node, binding/definition and policy. |
| Unresolved callable/capture provenance or unavailable execution requirement | Explicit uncertainty/requirement decline; do not label it an unsupported arithmetic operator. |
| Resource/recursion/size boundary | Existing limit decline with the relevant limit. |
| Wrong generation/scope, missing fact, emitter-created unannotated node | Internal invariant diagnostic; no recomputation or guessed facts. |

The existing fragment reasons (`head`, `signature`, `symbol`, `place`, `limit`) can remain implementation details initially. Do not change public diagnostic codes merely to mirror a new internal union. Refusal selection must remain stable enough for `canCompile` and `compile` to agree for a fixed artifact.

## 8. First meaningful migration and acceptance

Migrate scalar numeric lane selection and operand/branch conversion for a closed small family: Add, Negate, Sqrt and three-operand If, with literals, declared scalar inputs and boolean conditions. Admit both real and explicitly complex computations under existing mode rules. Add Multiply/Divide/Sin/Cos only if needed for actual captured fixtures, not to enlarge the experiment. Keep unsupported functions, collections, mutable locals and host source as explicit declines at first.

This is more useful than another all-real prototype: the same emitter decision must take both its real and complex paths from annotation, and at least one nontrivial conversion must be consumed. The producer may temporarily call the existing lane policy once under the correct scope; the emitter must not call it again. Measure exact dynamic queries avoided, static sites removed, added producer logic and remaining callers separately. A compatibility adapter is not a deleted reader.

Acceptance fixtures (to be implemented and run later, not claimed verified here):

| Fixture | Required evidence |
| --- | --- |
| Real Add/Negate versus the same heads with an explicitly complex input/literal | Different annotated result lanes drive actual real versus complex emission; independent value oracle and existing JS control. |
| `Sqrt(x)` for real x, `Sqrt(-4)`, and `Sqrt(z)` for complex z, strict/complex modes | Operand lane and result lane remain distinct; selected promotion/fold and emitted path agree, or unsupported policy explicitly declines. |
| `If(C, x, z)` with real x and complex z | Real-to-complex branch conversion is recorded and consumed lazily; no unrelated runtime type dispatch is added. |
| Original arithmetic/If fixtures with CSE and folding independently on/off | Value, emitted source where intended, and runtime assembly compatibility; log whether optimization actually triggers. |
| Existing seeded Random lazy fixture | Result and next-stream value agree; no duplicated/hoisted draws. If Random is outside the next slice, retain this as an explicit admission-negative plus legacy control until admitted. |
| Node cloned after annotation; same node in different scope/generation | Missing/mismatched fact is rejected deterministically, never recomputed. |
| Shadowing local named like a global; captured callable then ambient reassignment | Identity/control fixtures: initial slice declines unsupported binders/functions; later scoped slice must prove correct resolution before enabling them. |
| Local assigned real then list; local assigned two real values | First declines under shape rules; second later demonstrates fixed storage with invalidated value facts, not initializer reuse. |
| Captured slider declared real and assigned a value, including identity `vars` mapping plus `hideValues` | Preserve the plot-host contract when captures are admitted; do not generalize the first slice's broad stored-binding refusal into a public policy. |
| Explicit-step empty loop versus descending `Range(1,0)`; Buddhabrot local histogram update | Reserved next-stage fixtures for loop normalization/effects; first slice declines. No runtime-zero-iteration assumption is imported from JS loops. |
| Unknown host call, static error, heterogeneous If, scalar-versus-list union input | Correct existing diagnostics or explicit unsupported-slice decline; no accidental acceptance from broad source types. |

### Later bound-state acceptance from the new Tycho preludes

Tycho `0e6482e1f` adds `traffic-jam`, `heat-spread` and `othello` to the six prelude showcases recorded at `8777c57e3`; the six earlier authored preludes are unchanged between those revisions. These are later bound-state fixtures, not additions to the initial scalar-lane slice or evidence that any proposed profile admits them.

| Later fixture | Contract it exercises |
| --- | --- |
| Heat `heatneighbor`/`heatwall`, then `heatstep` | Captured grid size, typed scalar/boolean decisions and indexed input; then separate output allocation, boundary/wall behavior and clamped diffusion. Test uniform fields and a corner/wall spot before attempting output partitioning. |
| Traffic `roadstep`, then the two-target S/H action | Local numeric bindings stay out of free inputs; every driver reads the old state. Both action RHS expressions observe the same input snapshot, including the repeated roadstep call used to append history. |
| Othello `ray` → `flips` → `hasmove`, then `legal`/`play` | Transitive calls, typed integer/boolean locals and early exit; later, variable-length numeric lists and board updates through a local alias. Numeric element types alone do not discharge ownership or alias obligations. |

The three existing Node showcase files ran fresh in the private Tycho checkout with installed CE `0.184.0`: **14 passed, 0 failed, 0 skipped, exit 0** (traffic 6, heat 5, Othello 3), with two workers and bounded timeouts. They exercise independent old-state traffic calculations, heat conservation/boundary assertions, and Othello reference rules and pass/end transitions. This is observed regression evidence for the existing implementation; it is not annotation, prepared-artifact, profile-admission or browser-worker evidence. Exact command, test hashes and logs: `evidence/inventory/status.json` and adjacent logs. The source inventory and candidate rationale are in `prelude-refresh.md`.

When this later stage begins, capture actual gateway expressions and resolved environments before and after one real action, alongside the standalone function fixtures. Preserve authored, Tycho-lowered and CE-prepared observations as distinct stages. Do not infer that gather-style heat/traffic updates or scatter-style Buddhabrot accumulation can share the same parallel execution plan.

After the slice passes, migrate one bound function and same-shape local accumulator, then collections and captured plot callbacks. At that point decide whether assignment versions/structured regions suffice or SSA pays for itself. CPS is not required by an expression annotation contract; explicit async/control transformation is a separate execution project. Keep the traditional JS route available and unchanged until meaningful parity is demonstrated. No public `js-fragment` target is required to test this internally.

## Decisions for review

1. **Recommend session-local immutable publication first.** Alternative: reusable public prepared handles with dependency invalidation. The latter adds lifecycle/API obligations before a demonstrated consumer.
2. **Recommend operation result lanes plus operand conversions as authoritative.** Alternative: semantic types alone plus emitter-side lane queries; this retains the duplication and cannot explain real-input complex-result cases.
3. **Recommend whole-unit reannotation after structural changes initially.** Alternative: incremental fact transfer/versioning. Adopt it only after measuring a real cost and proving ownership rules.
4. **Recommend the small real/complex family above as the next implementation experiment.** Alternative: add loops to the current all-real slice first. That broadens scope without proving annotation controls a varying lowering decision.
5. **Recommend profile admission and execution requirements remain separate internal inputs.** Public names/defaults, an alternative target registration and cross-call prepared-artifact caching wait for review and evidence.

No unanswered product decision blocks drafting or these recommendations. Annotation acceptance fixtures require later implementation authorization and validation. The focused existing Tycho regressions above were run as a separate inventory follow-up; no build or timing run was needed for this document. No production source or peer edits were changed.
