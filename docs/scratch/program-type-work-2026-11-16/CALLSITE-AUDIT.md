# Program type-work callsite audit

Read-only production audit at `050a140880e56a9698fa61b99ef7205a53b651c9`.
No production edits, tests, builds, timings or new instrumentation. Changed-input
traces are pending. Source proof that a helper discards an input is distinct from
proof that two derivations received the same inputs.

## What each requester needs

| Requester | Identity | Parameters / compatibility | Result | Effects | Required work |
| --- | --- | --- | --- | --- | --- |
| `core.ts:8537`, `recordInitializerEvidence` callable branch | Whether the initializer is statically callable | No parameter/default comparison | Only callable classification | No | The valid syntactic Function shortcut already exists. A nonliteral initializer can return a function, so `square(x)` or `Add(...)` cannot be classified by operator spelling alone. |
| `core.ts:4196`, `joinAssignmentEvidence`; `:4520`, `assignedEvidenceType` | Existing target definition; unchanged identity alone is insufficient | Target's inferred/declared/open status controls recording | Current complete value type, including collection/tuple cells and absence domain | Only as part of a function-valued type | Keep the current-value read and widening/join rules. A declared target is not replaced by inferred evidence. |
| `core.ts:4678`, `recordPatternEvidence` | Existing target for each leaf | Existing tuple pattern matching | Current tuple result and each component | Only when a component itself is callable | Keep rereading the tuple shape: a later read can lose a leaf and must discard its earlier evidence. Do not introduce a second destructuring algorithm. |
| `assignment-evidence.ts:197`, `withEvidenceSession` | Registered existing target objects | None added | Rerun current-value joins until unchanged; coarsen/reset under existing limits | None added | Nested Blocks share the outer session. Back edges can change earlier value types after later writes. All registered sites must remain eligible for the existing fixpoint. |
| `boxed-function.ts:16503`, `boundCallType` entry | Current callee half / forward binding, not merely spelling | Existing overload/generic resolution when the result needs it | Full application result | A literal's arrow includes effects | Preserve `_reboxedForCallee`, forward repair, recursion-knot handling and existing result derivation. |
| `effects-inference.ts:1933`, `functionLiteralCallSignatureType` | Literal's written scope versus current scope | Written-scope slots/defaults | Written-scope result | Current-scope effects | The two scope computations have different inputs. The second full signature contributes only effects for ordinary signatures, but this is a separate possible narrowing to the existing `functionLiteralArrowEffects` query, not a demonstrated hot-path reduction yet. Generic/error fallback must remain. |
| `function-utils.ts:7525`, parameter-signature requester | Existing literal | Parameters/defaults/variadic slots only | Deliberately `any` | None | Existing `functionLiteralParameterSignature` is the narrower owner for argument-only questions; do not substitute it for result/effect requests. |

The existing small source is `function square(x){x*x}; let x=3;
let y=square(x); y+1`; the real notebook fixture is `let a=3; let b=a+1; b`
(`benchmarks/program-regression-child.mjs:13,26`). The latter executes through
Tycho's analyze/executeCortexCell/publication route. Checker and execution use
different prepared bindings and presence projections, so their derivations are
not interchangeable.

A first evidence join can change the target's type and emit a type-write event
(`core.ts:4580`). Thus a later RHS type query may miss the engine's broader type
cache even when its own callee/operands did not change. This is a source-level
possibility, not a measured unchanged-input trace. Conversely, the loop example
in `assignment-evidence.ts:1` changes an earlier element read through a later
collection write; removing the revisit would allow a wrong compiled value.
Getter counts alone distinguish neither situation.

## Four helpers currently receive types they may never inspect

These are source proofs of unused inputs. They remain true even if operand types
changed; no dependency tracking or previous-result cache is needed.

| Existing owner | Eager boxed caller | Existing decisive guard | Input unnecessary when guard returns |
| --- | --- | --- | --- |
| `collection-utils.ts:6507`, `appliesToListCoordinateTuple` | `boxed-function.ts:16570`, `expr.ops.map(x => x.type.type)` | `!overTuples && !LIST_COORDINATE_TUPLE_ARITHMETIC.has(operator)` | Every operand type. The helper immediately returns false. |
| `collection-utils.ts:6543`, `addsPointToNumberCollection` | `boxed-function.ts:16586`, another operand-type map for library heads | Operator is neither Add nor Subtract | Every operand type. The helper immediately returns false. |
| `derive-application-type.ts:1526`, `withCodomainForAbsentAnswer` | `boxed-function.ts:17063,17177`, operand-type maps after a handler answer | `stripMissingFromType(answered) !== 'never'` | Every operand type. The existing handler answer is returned unchanged. |
| `broadcast-lift-type.ts:793`, `passesAbsentCellsThrough` | `boxed-function.ts:16745` map, also `:16694` in the generic context | Operator belongs to neither existing absent-cell set | The operand type. The helper returns false before missing/cell inspection. |

The helpers also have descriptor/type callers. Those callers can retain their
already-available arrays/types; no new source analysis is required. In particular,
the boxed maps can force the full signature of a Function nested under declaration
or dictionary metadata solely to supply an operand to a helper that returns before
using it. The operator/caller trace must establish which of these occur in the
measured fixtures and their contribution before selecting implementation scope.

## Proposed minimal implementation, not yet authorized

Keep each decisive guard in its existing owner. Accept an already-computed input
or a synchronous thunk, then evaluate the thunk only after the guard:

```ts
operandTypes: ReadonlyArray<Type> | (() => ReadonlyArray<Type>)
// after the existing operator/answer guard:
const types = typeof operandTypes === 'function' ? operandTypes() : operandTypes;
```

For `passesAbsentCellsThrough`, use `Type | (() => Type)` and preserve the
existing two-set operator test before resolving the type. Change only attributed
boxed callers to pass thunks. Existing descriptor callers need no changes.
There is no persistent cache, new predicate registry, inference pass or evaluator.
Keep every positive branch's operand order, missing handling, tuple refusal and
handler answer. This proposal removes only analysis whose result the existing
helper does not use. No implementation is present in this audit.

## Setter hypothesis

`boxed-value-definition.ts:1754` `_setType` sends no engine state event. Its
`_writeType` does increment the binding write version, replace placeholder/signature
skeletons, clear a signature memo, and clear stored values for `unknown`. Therefore
the final Program widening setter at `control-structures.ts:4670` cannot be blamed
for global type-cache invalidation from its count alone. Skipping an equal-type
write requires proof concerning those per-binding effects; it is not proposed
without an attributed trace. `inferredType=false` remains required.

## Additional narrow-query audit

### Literal signature: written shape, current effects

`effects-inference.ts:1933` currently computes the full signature in the written
scope, then the full signature again in the current scope. In its ordinary
signature branch it discards the current parameter/default/rest/result fields
and keeps only `here.effects`. This is unused-result proof even when the scopes
are different; different scopes do not make those discarded fields necessary.

`functionLiteralArrowEffects` at `:2205` is the existing exact projection for
that second demand. Its contract explicitly excludes parameter and body-type
computation. It invokes the same declared/inferred effect union that the full
signature builder invokes. The caller's type computation already uses the
static typing view; the narrower query must run in that same view and current
scope. The written full signature must still be derived first, as now. An
ordinary-signature fast path could then combine that written shape with the
narrow current effects, retaining the existing full-computation branch for
generic, non-signature, malformed/error cases. No second signature builder or
scope cache is needed. The changed-input trace is still needed to show whether
this two-scope branch contributes to the measured fixture.

### Literal application validation: parameters, not the literal result

`box.ts:3313` obtains `annotated.type.type` for
`validatedLiteralApplicationOperands`. Its consumers are:

- `pinnedValidationSignature` (`:3437`): required slots, partial-application
  truncation and relaxation of bare parameters; carries adjuncts through.
- `paramsAreScalar` (`boxed-function.ts:19424`) and `threadableGate`
  (`box.ts:2582`): parameter/rest/broadcast/point positions.
- `validateArguments`: compatibility of the supplied operands with those slots.
- `keepProvisionalOperands` (`box.ts:3364`): candidate parameter types at each
  position, including absence and disjointness checks.

The literal's own return type/effect set does not decide these checks. Parameter
*types* can themselves be function signatures, whose complete contracts must
remain: the proposed narrowing removes only the outer literal result/effects.
`functionLiteralParameterSignature` (`effects-inference.ts:1967`) already builds
the written-scope fixed/optional/default/rest slots with result `any` and no
outer effects. A valid ordinary annotated literal can use that query; invalid or
full-signature-marker literals retain the existing full-type fallback. Also
preserve the type-in-flight fallback already used by the analogous application
query in `function-utils.ts:7525`, rather than assuming every recursive
construction can build a fresh parameter signature.

This path only handles literals with an annotated parameter (`annotatedLiteral`,
`box.ts:3278`). The bare-parameter square fixture does not establish that it is
hot. No proposed implementation or extra measurement has been performed.
