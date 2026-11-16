# Program bindings and diagnostic flow: semantic decisions

Status: proposal for acceptance, not implementation authorization. No line budget
is assigned. This refines the [Program stop report](../scratch/2026-11-15-program-only-coordinator-report.md)
under the [approved Program specification](2026-11-12-program-operator-spec.md).
The objective remains removal of duplicate binding semantics, not a general
analysis framework or a compiler expansion.

## Recommendation

Apply D11's variable rule to `let`/`const` declarations in a Program as well as
Block locals. A declaration establishes a binding and its static type; assignment
writes a value without changing the binding into an operator or adopting the
replacement value's signature as a contract.

- An explicit type on the declaration is the contract. An explicit function
  signature retains the existing parameter, result, default, generic and effect
  admission rules; do not reconstruct those rules in the checker.
- Without an explicit type, a syntactic function initializer gives the coarse
  type `function`, as D11 already specifies for locals. An unannotated alias whose
  initializer is statically callable also gets `function`; it copies neither the
  source variable's contract nor the current literal's signature into a new
  implicit declaration. An unresolved initializer gives
  `unknown`. Other data uses existing Block canonicalization, widening and
  assignment admission; this proposal adds no alternative type inference.
- The actual function value keeps its annotations, names, defaults, closure,
  partial application and effects. Its own argument checks still apply when
  called. These properties are not a permanent contract inherited from a value
  previously stored in the variable. Bare parameters remain `unknown` under D15.
- Mutable `function` variables accept successive function values. A definitely
  nonfunction value does not satisfy that type. A `const` rejects assignment and
  retains its value; constness is a property of the binding, not of the value type.
- A new declaration in a later Program may replace a declaration from an earlier
  Program and establish another type (P7). Assignment in a later Program writes
  the existing binding and must satisfy its contract. Two declarations in the
  same Program remain an error. Fixed type means fixed for that declaration,
  not permanently fixed for a spelling across notebook edits.

Top-level `function` statements retain the approved global/clause semantics and
canonical order. This recommendation concerns variables holding function values;
it does not redesign host `ce.assign()`, library operators, nominal constructors
or clause replacement. General host/global inference behavior is not silently
changed. Earlier retained expressions keep existing CE home-scope/re-resolution
behavior; no immutable document revisions or snapshot of all captured state is
promised.

This requires acceptance of removing the current top-level exception: D11 says
globals are unchanged, and the Epsil declarations guide currently permits a
top-level inferred variable to change kind. Making Program variables follow the
Block rule must be recorded explicitly rather than called diagnostic cleanup.
The public type of an unannotated callable variable also changes from an adopted
literal signature to `function`. That is an observable typing change; preserving
all current compilation coverage is not promised by this analysis.

## Observed witnesses and proposed results

Current results were executed against source, not inferred solely from tests.
[The probe and raw output](../scratch/program-binding-diagnostic-evidence-2026-11-15/README.md)
record the exact sources, diagnostics, binding kind/type, and caller-scope reruns.
Proposed results below are consequences of the recommended rules, not executions
of a candidate.

| Witness | Current behavior | Recommended behavior | Kind of change |
| --- | --- | --- | --- |
| `let k = (n: integer) => n + 1; k(1.5)` | Static argument diagnostic and runtime Error; `k` is a value definition with the literal's signature | Same bad-call diagnostic and Error; binding type `function`, literal still requires integer | Public static type changes; no intended runtime value change |
| Integer `let k`, then `k = (s: string) => s; k("a")` | First replacement succeeds and converts `k` to an operator; result `"a"` | Replacement succeeds; `k` stays a `function` variable; result `"a"` | Representation/type change; no intended value change for this case |
| Same program, then `k = (n: integer) => n; k("a")` | Second replacement is refused; prior string function remains; result `"a"` with an intervening runtime error | Second replacement succeeds; final call of integer function with string gives Error | Runtime semantic change: remove history-dependent sticky replacement signature |
| `const k = (n: integer) => n + 1; k = (s: string) => s; k("a")` | Constant-write and integer-argument diagnostics; original function remains; final Error | Same retained value and failures | No intended runtime change; read-only flow replaces mutation-based checking |
| `let k: (integer) -> integer = (n) => n; k = (s: string) => s` | Replacement refused; original value remains | Same refusal under explicit binding contract | No intended runtime change |
| `let g = k` before replacing `k` | `g` keeps the integer function; `g(2)` is 2 | Same value copy, not a live alias to `k`'s variable | No intended runtime change |
| `let g = k` after replacing `k` with string function | `g("a")` is `"a"`; `g(1)` is diagnosed and gives Error | Same value snapshot and call diagnostics; no implicit signature promotion of `g` | Static type changes where inferred; runtime copy semantics preserved |
| Integer function called through `let x = 1.5`, also through `let x: number = 1.5` | `incompatible-type` and runtime Error | Preserve proof from the reaching literal `1.5`, without changing `x`'s binding type | Diagnostic precision comes from flow, not a tighter variable contract |
| Same call with `let x = g()` and unresolved `g` | No static rejection; call stays symbolic in the probe | Unknown evidence remains provisionally admitted; no evaluation to guess it | No intended precision increase |
| Top-level `let x = 1; x = "a"; x` | `"a"` | Follow existing Block assignment admission; reject incompatible kind change and keep prior value | Runtime change from removing the top-level exception; not diagnostic-only |
| Later Program redeclares integer `k` as string `k`, then calls `k("b")` | Runtime installs new value and returns `"b"`; checker erroneously cites old integer signature for `let` and `const` | New declaration's facts replace earlier declaration's facts; return `"b"` with no stale-signature diagnostic | Diagnostic correction; rerun replacement semantics remain |

The last observation is filed as [CE-1352](../../issues/CE-1352.md). Checking left
the observed engine binding identity and public type unchanged after each call;
this does not prove that the existing checker makes no transient writes. Current
source shows that it writes and rolls them back. The rerun probes exercise CE's
caller scope, not the full Tycho notebook UI. Tycho's evaluator additionally
contains script execution in a child scope and publishes accepted outputs; that
host policy remains unchanged.

The alternative of fixing the initializer's full signature would reject the
first integer-to-string function replacement. It would turn a value's parameter
annotations, inferred return information and names into a persistent variable
contract, contrary to D11's chosen local rule. Annotating the variable explicitly
already expresses that intention. Keeping today's promotion-on-first-replacement
would preserve the history-dependent contract and its duplicated checker model.
Neither alternative is recommended.

## Diagnostic flow is separate from binding

The earlier stop finding needs qualification: current checker helpers do perform
duplicate preparation, but the existence of value-sensitive diagnostics does not
prove that engine mutations are necessary. A nonmutating analysis of values
reaching uses is not a second binding algorithm when the canonicalizer alone
determines declarations, binding identity, static types and accepted/refused
statement structure.

Use the canonical boxed expressions, existing CE definition identities and CE
`Type`/function-literal metadata. Flow facts belong to a particular use and the
value that reaches it; a later assignment must not retroactively change an
earlier call's facts. No new source AST, binding registry, checker IR, SSA
numbering, CFG service or immutable prepared-type layer is proposed.

The remaining analysis tracks a known function value or literal evidence through
straight-line declarations and assignments, copies the current value fact at an
alias, and reads annotations from the actual value at a call. An alias does not
inherit defaults or parameter names that exist only on the source variable's
declared call interface; its own declaration and the copied value determine its
calls under the existing rules. A definitely refused
constant/contract write retains the old fact. An uncertain RHS, uncertain write,
branch, loop or effectful call conservatively joins or discards the relevant
facts; it never runs the program to decide. Possible partial writes before an
error must not be mistaken for an atomic rollback. Mutable collection aliases
must lose value facts when a write may invalidate them. Do not build a general
alias or interprocedural fixed-point analysis for this delivery.

Use existing argument/arity/subtype and effect-admission rules read-only rather
than reimplementing callable semantics. Preserve partial application, defaults,
named argument rules, D15 mapping and annotation provenance. Unknown callees or
arguments need no guessed contract. For legacy operator/clause transitions that
cannot be predicted using existing read-only rules, lose diagnostic precision
rather than simulate `ce.assign()` or reproduce its transition algorithm. This
conservative boundary is a diagnostic-precision decision to accept; it is not a
permission to change runtime behavior.

Raw typo, guarded presence, authored-error provenance, source ranges, deduplication
and diagnostic rendering remain checker work. They can inspect the source
projection while referring to canonical bindings. Flow errors must not be written
into the executable Program or used to replace its static types. Existing isolated
boxing and necessary type/protocol restoration remain; a read-only flow phase
does not justify removing their undo or changing publication timing.

## Existing compiler and IR reuse

The inspected IR entry is `compileWithIrProfile()` in `ir/adapter.ts`, through
`compileSlice()` and `sliceProgram()` in `ir/index.ts`. The latter runs lowering,
verification, optional interval narrowing, optimization passes, target admission,
then printing through `compileSlice()`. The important boundary is successful
**lowering**, not merely successful printing: numeric types, SSA values and most
IR facts are produced during lowering before target admission, but no complete
IR is available when lowering declines partway through.

| Concern | Existing producer and representation | Specific reuse; limit |
| --- | --- | --- |
| Source binding identities | `boxed-expression/type-guards.ts`: `freeBinding`, `resolvedValueDefinition`; binder identity helpers. `ir/lower-functions.ts:userBinding` reads those value/operator definition objects; `functionLowering` keys its function map by definition object | Reuse CE identities and resolved occurrences directly. Do not allocate a second source ID system or resolve authored names independently. IR's local frame names are lowering bookkeeping, not an authoritative source-binding registry |
| Source types and callable contracts | Canonical nodes and CE `Type`, `FunctionSignature`, function-literal annotations. IR `signatureTypes()` reads these and converts them into numeric parameters/results | Reuse source types, signature accessors and admission predicates **before** conversion. The conversion retains positional parameter names but not the full named-call/default/effect/partial-application contract; it is not the checker's callable contract |
| Typed values | `ir.ts:V`, `IRType`, `Builder.newValue`: SSA values typed as numeric/boolean/complex/color lanes and list lengths during lowering | Reuse the separation of binding identity from value identity as the semantic model. Do not use numeric `IRType` as CE's source type or convert unknown/error/string/function values merely to make a checker IR possible |
| Assignment and facts at uses | `lower-context.ts:Binding.v`; `lower.ts:assign`, `arm`, `branch`: successive values, saved incoming values, branch-result joins. `ir.ts:useIndex` indexes already-emitted values | Follow the existing value-at-use rule: replace the written binding's reaching fact while preserving facts about previously copied values. Use canonical nodes and a diagnostic side table; do not clone IR frames/builders or create another SSA graph. IR def-use indexes cannot describe a source program that never lowered |
| Mutable inputs | `compile-expression.ts` handles `inputs` and `symbolic` before IR adaptation. `lower.ts` records free inputs and lifted inputs; `assign()` permits local writes and declines writes to input/nonlocal bindings | Reuse the source binding's declared type. An input value supplied on another call does not change its static contract. IR is not an existing mutable caller-namespace/writeback service; printer `let` flags and loop-carried SSA values do not supply one. No new input mutation support is part of this decision |
| Effects | Source `EffectSet`, signature provenance and existing effect inference/admission; `ir/effects.ts` separately computes `pure`/`may-fail`/`effectful` on emitted instructions and lowered call graphs | Reuse source effect summaries to discard diagnostic facts around writes/unknown calls. Keep IR classifications for movement, sharing, folding and trace checks. An IR optimization permission is not an Epsil effect annotation or a proof a source assignment succeeds |
| Guarded facts | Existing checker presence analysis; `ir/narrow.ts` inserts arm-specific interval clamps and scoped SSA substitutions after lowering/verification | Reuse existing source presence rules. IR narrowing is useful precedent for facts scoped to uses, not a reusable source presence/type service. Do not import interval clamps or broaden branch-dependent shape inference |
| Existing non-IR compiler analysis | `compile-locals.ts:blockLocalValueFrame` already keys assigned expressions by definition; `nestedAssignmentsTo` accounts for shadowing. `compile-loops.ts:reboundLocalNames`, `noteLocalFunction`, `compile-blocks.ts` track statement order and conservative callable rebinding | Reuse binding-aware assignment/declaration extraction and shadow handling where the same work is needed, through narrowly shared pure helpers if necessary. `LocalEntry.values` is an all-writes collection, not the reaching value of one use; the rebound set intentionally declines compilation rather than predicting each replacement. Do not pretend either is a complete diagnostic flow result |

`ir/lower.ts:Facts` records read/write names, loops and eligibility for closed
folding; it is not a source narrowing/provenance result. `analyzeReferences()` in
the existing compiler describes references as code generation sees them,
including folded values and target support. It is not a replacement lexical
resolver for the checker. Extracting only a genuinely identical pure source
operation would simplify ownership; importing target/compiler state into the
checker would not.

IR lowering can reject a static `error`, unsupported operator, callable value,
unknown input or unsupported shape before returning a usable program. It can
also call `N()` on eligible closed expressions, specialize numeric lanes, capture
engine values and introduce hidden length/capture parameters. Disabling passes
does not disable all those operations; calling `lower()` directly is therefore
not a checker route. Final entry plans, lowered input records, optimized effects,
def-use counts, storage annotations and printed code are downstream artifacts,
not prerequisites for checking. Invalid and noncompilable siblings still need
their source diagnostics and must not suppress checking the rest of a Program.

The compiler retains its existing shape contract: declarations/static types and
literal structure settle shapes; flow diagnostics do not add a more precise
shape-selection algorithm, new dynamic callable support or a compile prerequisite
to checking. A conservative compilation decline remains acceptable. There is no
reason to extend IR with error/string/function lanes or make all source programs
lower merely to remove duplicated checker binding semantics.

## Helpers affected and analysis retained

| Existing helper/mechanism | Disposition under the recommendation |
| --- | --- |
| `registerPinnedSignature`, `replacePin`, `reassignedPin`, mutation-oriented `PinnedSignature.firstWins` state | Unnecessary for the stable Program-variable path: no value-to-operator promotion or inherited replacement pin to emulate. Known-current-literal and explicit-contract facts still need read-only validation |
| `pinnedAliasOf` | Keep the value-copy fact, not the engine pin lookup/type installation. Alias analysis reads the existing binding identities and copies the current evidence; it never re-resolves a name or retypes `g` |
| `applyAssignmentTypeEffect`, `declareStatementNames` | Canonicalizer owns declarations, static types, tuple/shadow rules. Remove their duplicate declarations and `_infer` writes. Last-write/literal evidence, conservative invalidation and diagnostic use-site validation remain |
| `installAssignedLiteralBeforeClause`, `keepConstantBinding` | Same-Program saved-literal/const-before-function workaround becomes unnecessary with P2 and the shared canonicalizer's errors. Do not claim every legacy/external clause path disappears without inspecting its remaining callers |
| `_staticPinnedCallees`, `_staticAssignmentEvidence` as controls on ordinary boxing | Checker diagnostics should no longer need to mutate definitions or install these controls to make call boxing act differently. Their value/evidence information moves to diagnostic-only facts; ordinary runtime literal checks remain |
| `assignOverUserFunction` and operator reconciliation emulation | Not needed for stable variables. Do not retain a checker-side mutation simulation for global clauses/legacy operators; reuse read-only common admission where available, otherwise be conservative about diagnostics |
| Separate top-level duplicate/use/head preparation helpers named in the Program plan | Still replaced by canonical sequence rules/metadata; diagnostic flow does not reintroduce them |

These are ownership decisions, not measured deletion claims. Source diagnostics,
literal argument proofs, aliases, constant-write reasoning, effects/presence,
provenance and source mapping remain real analysis. The recommended change
removes their authority to create or change bindings; it does not claim checking
needs no analysis.

## Acceptance requested and work performed

Accept the stable Program-variable rule, including repeated function replacement
and rejection of incompatible nonfunction writes; accept literal annotations as
properties of values unless the variable explicitly declares a contract; retain
P7 redeclaration across Programs; and accept conservative diagnostic precision
when a read-only flow fact cannot be established. Only after these decisions
should implementation design and cost be revisited. No budget or blanket promise
of preserving every diagnostic/compiled emission is made here.

Work performed: current source/reference reads, one bounded executable witness
instrument and an independent Sol source review of the semantic/IR assessment.
No production, test or Tycho edits, compiler experiment, universal analysis service
or performance claim. Source fingerprints matched around the probe. Suites,
builds, worktrees and a production code review were omitted because this is a
semantic proposal, not an implementation. CE-1352 records an older checker defect
found by the requested rerun witness; it is not fixed in this analysis-only task.
