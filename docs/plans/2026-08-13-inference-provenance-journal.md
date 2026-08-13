# Inference Provenance & Journal

**Date**: 2026-08-13 · **Status**: DESIGN — phase 1 agreed, phase 2 direction
agreed, phase 3 needs a future ruling

## Motivation

Three converging needs:

1. **Two-site diagnostics.** An `incompatible-type` error today reports the
   failing use but not where the conflicting type came from. When a symbol was
   *inferred* `boolean` because it appeared once as an `And` operand, a later
   numeric use fails with a one-sided message. The fix is provenance: record,
   for every inference write, which expression triggered it.
2. **Aggregation of ad-hoc observers.** The single point where an inference
   write lands (`BoxedSymbol.infer()`, `boxed-symbol.ts`) currently interleaves
   four independent mechanisms: the `_resolveOnlyDepth` suppression gate, the
   `_narrowingSink` scope-containment observation, the
   `_inferenceTxDepth`/`_freshlyInferred` transaction record, and a
   `_noteStateEvent` emission. Three of these are observers of the same event
   ("a definition's type was written by inference") with different filters.
3. **Groundwork for transactional rollback.** The absence of a rollback
   primitive has shaped architecture in at least four places, each a bespoke
   "don't let this write escape" mechanism (see Phase 2).

## Hard constraint: no provenance on `Type` objects — ever

`Type` objects are interned, deep-frozen, and shared across all engines
(`TYPE_CACHE`, `src/common/type/parse.ts` — the P-BOX registration-accretion
win collapses ~2000 signature parses per `new ComputeEngine()` into shared
cache hits). Two occurrences of `boolean` are the same frozen object.
Stamping origin information onto `Type`/`BoxedType` is therefore
architecturally impossible without destroying interning. Provenance lives on
**definitions** (`BoxedValueDefinition` / operator definitions), which are
per-engine and per-scope.

## Phase 1 — provenance records + single-emission refactor

### Data model

```ts
// boxed-value-definition.ts
type TypeProvenanceEntry = {
  /** The type this write installed (the post-fold result). */
  type: BoxedType;
  kind: 'declared' | 'auto-declared' | 'inferred' | 'assumed' | 'value-derived';
  /** Which axis of the definition's contract this write touched. */
  axis: 'type' | 'effects';
  /** For 'inferred': the expression whose canonicalization triggered the
   * write — the And(), the call, the Add() — not the bare symbol
   * occurrence. */
  cause?: Expression;
  /** Original-input span of the cause, when the parse that produced it
   * stamped one. Optional in phase 1. */
  span?: { start: number; end: number };
};
```

The `'auto-declared'` kind records a binding *created* as a side effect of
boxing (the auto-declare path in `engine-expression-entrypoints.ts`), with
the boxed expression as `cause`. This answers "was this binding pre-existing,
or created by the pass currently running?" — a predicate the first-boxing
binding-divergence fix (Tycho item 178(a)/(c)) needs, and one that type-write
provenance alone cannot answer.

**Sequencing agreement (2026-08-13)**: this provenance write and the
178(a)/(c) fix land in the same function (`createSymbolExpression`'s
auto-declare path). Agreed with that fix's owner: the provenance write goes
in FIRST (it is additive — recording a kind at the existing decision point);
the 178 fix (which changes what the decision point does — the target scope
of the declaration) rebases onto it. Whichever session touches that function
pings the other before starting.

Stored as `_typeProvenance: TypeProvenanceEntry[] | undefined = undefined` on
`BoxedValueDefinition`, declared upfront (like `_deadStack`, `_activationOf`)
for object-shape stability, allocated on first write. The existing `===`
reference-preservation dedup in `infer()` means entries append only on actual
type changes, so the array stays tiny (typically 1–2 entries). Cap at a small
N as a safety valve (entries hold `Expression` references and must not become
a leak).

`inferredType` and `effectsDeclared` remain as boolean fields (read in ~30
places) but are kept consistent with the record; they are logically derived
views ("is there a `'declared'` entry on this axis?"). Migrate readers
opportunistically, not in this change.

### Single event channel

One internal emission, `_noteInferenceWrite(event)`, at each real write
point:

- `BoxedSymbol.infer()` — value-definition branch and operator-definition
  branch (`boxed-symbol.ts`)
- `BoxedFunction.infer()` — the inferred-result-signature narrowing path
  (`boxed-function.ts`, the site that already calls `sink._recordNarrowing`)
- the four `inferredType` write sites in `assume.ts` (kind `'assumed'`)
- explicit declaration (`engine-declarations.ts`) records the `'declared'`
  anchor entry — the other half of every two-site diagnostic

Event payload: `{def, symbol, from, to, axis, cause, kind}`.

Existing mechanisms become subscribers of this channel:

| Mechanism | Subscriber filter |
| --- | --- |
| provenance (new) | keep all; append to the definition's history |
| `_freshlyInferred` | `from.isUnknown`, within the outermost-boxing window (`_inferenceTxDepth > 0`) |
| `_narrowingSink` | definition resolves in a scope enclosing the contained scope |

The subscriber shims must preserve current semantics exactly — in particular
the sink's dedup (`from === to` and string-equality skip) and its
chained-narrowing collapse into a single `{from, to}` entry per name
(`engine-inspectable-scope.ts`, `_recordNarrowing`).

**Non-goals of the aggregation:**

- `_resolveOnlyDepth` is a write *policy* (suppresses the write itself), not
  an observer. It stays a gate, unchanged.
- `_noteStateEvent` is NOT merged. Per the state-event invalidation design it
  is the sole axis writer for cache invalidation, and the
  axis-self-invalidation pitfall (an event firing during a cached computation
  must never advance an axis that computation reads) makes it the wrong
  channel for rich subscribers. The journal is passive and data-only — the
  same posture as the error-reporting frame chain.

### Cause capture — ambient, following existing precedent

`infer()` is called from ~20 sites and never sees the enclosing expression.
Rather than threading a parameter through every site (a public-surface change
on `BoxedExpression.infer`), use the ambient pattern already established
twice at this boundary (`_narrowingSink`, `_inferenceTxDepth`):

- `ce._inferenceCause: Expression | null`, set by the validator /
  canonicalizer around a call's argument checking (one assignment per
  validated call in `validate.ts`; one in the
  `narrowArgsFromInferredSignature` path in `box.ts`), cleared in `finally`.
- The write points read it into the event. Zero cost when `null`.

### Copy / rollback integration

- (Corrected during implementation: there is no `.copy()` on
  `BoxedValueDefinition` — the earlier draft misread `toJSON()`. Per-call
  activations reference the static binding via `_activationOf` rather than
  copying it, so there is no copy path to slice; nothing to do.)
- The static checking pass's provisional-registry rollback must not leave
  orphaned entries: if it rolls back by swapping definition objects the
  history travels for free; if it mutates in place, the history needs the
  same rollback. Verify at implementation time.

### As implemented (2026-08-13, same day)

Deviations from the sketch above, chosen during implementation:

- **No recorded `'declared'` / `'value-derived'` anchors.** Recording an
  entry in the `BoxedValueDefinition` constructor would tax engine
  construction (~2000 library definitions per `new ComputeEngine()`). Both
  anchors are derivable — `inferredType === false` means declared,
  `inferredType === true` with a value means value-promoted — so the enum
  keeps the kinds (reserved) but nothing writes them. Entries are recorded
  only at inference writes, assumption writes, and auto-declarations.
- **Assumption writes record provenance directly, not via
  `_noteInferenceWrite`.** Routing them through the channel would have
  reported them to the narrowing sink for the first time — a behavior
  change in `InspectableScope.narrowings()`, not a refactor. The channel
  aggregates exactly the observers `infer()` already had; `assume.ts` calls
  `recordTypeProvenance` alone (`recordAssumedType` helper).
- **The ambient cause holds `{operator, ops}` raw inputs**, installed by a
  save/restore wrapper around `makeCanonicalFunction` (`box.ts`), and is
  materialized into a NON-canonical expression lazily by the first write
  that records it — raw-form boxing binds nothing, so materialization
  cannot recurse into inference.
- **Diagnostics ride the existing `DiagnosticNote` channel**:
  `provenanceNote` in `src/epsil/signature-notes.ts` names the committing
  site for an `incompatible-type` diagnostic. Resolution is
  **binding-accurate** (user-ruled 2026-08-13, accepting the snapshot blast
  radius): the engine attaches the faulted operand ITSELF as the error's
  site operand — `createErrorExpression` had been silently dropping the
  expression `where` that every `validate.ts` mint site already passed and
  that `IComputeEngine.typeError` always declared — so the note reads
  provenance off `whereOp.valueDefinition` directly. Scope-correct even for
  a parameter or local whose scope is gone at diagnostic time, and immune
  to a same-named outer binding shadowing it (the ambient-lookup fallback
  remains only for callers holding no boxed error). Two consequences of the
  new operand: every argument-validation `incompatible-type` error gains a
  site operand (`["Error", EC]` → `["Error", EC, operand]`) — the measured
  snapshot blast radius is recorded below — and `describeError` now renders
  the site ("expected `number`, got `boolean` **at `p`**"); the dedup key
  stays deterministic. The static tier pairs JSON errors with their boxed
  twins via a local walker that mirrors `collectErrors`' traversal
  (operands AND dictionary values — the boxed `.errors` getter walks `ops`
  only and misses a `let` initializer's dictionary value). The runtime
  tier passes its boxed errors directly and mints notes too.

  Three follow-on contract repairs the site operand forced, all landed the
  same day:
  - **Dedup stays site-less** (`dedupKey`, static-diagnostics.ts): the
    per-statement diagnostic dedup and the authored-error subtraction key
    on the description WITHOUT the site — the site names WHERE, not WHAT,
    so it must not split one problem into per-site diagnostics nor stop an
    authored (site-less) error value from matching the engine-minted
    equivalent. The rendered message keeps the site. (Caught by the CLI
    "one diagnostic per problem, not per cascade" pin: 2 → 3 without this.)
  - **`Error(c)` match patterns ignore the site** (`normalizeErrorSubject`,
    match-dispatch.ts): like the `ErrorTrace` breadcrumb, the site is
    provenance, not payload — `Error(c)` destructures a sited or bubbled
    error exactly as a hand-written one, while `Error(c, w)` still binds
    the site. Without this every existing `Error(c)` rescue arm silently
    stopped matching engine-minted errors.
  - **`errorWhere()`** now (correctly) returns the site for validation
    errors — its pin recorded the empty-slot era and was updated.

  Measured blast radius of the shape change: 42 snapshots + ~73 inline
  pins across 33 suites, all updated; final full suite green.

  A second dual review (Claude + Codex) scoped to this round's files ran
  2026-08-13 PM. Outcomes: (1) a sequence wildcard (`Error(__all)`) no
  longer triggers where-stripping despite its syntactic arity of one;
  (2) the boxed-error pairing walker visits depth-first left-to-right,
  matching `collectErrors`' order, so identical-JSON twins pair with the
  error the dedup loop keeps; (3) the where-slot match rule is documented
  and pinned as UNIFORM — a legacy string context and the new site are the
  same slot, `Error(c)` ignores either, `Error(c, w)` binds either;
  (4) root-only normalization (nested `Error(Error(c))` does not see
  through the inner where/trace — a pre-existing trace-era limitation) is
  recorded in `ROADMAP.md`; (5) a claimed dedup regression was REFUTED —
  its baseline was the intermediate post-site state, not the pre-site
  behavior the CLI pin records, which `dedupKey` restores exactly.
- **Mirror obligation**: `types-expression.ts` keeps structural mirrors of
  the definition interfaces; `_typeProvenance` had to land there too
  (`TypeProvenanceEntryMirror`). Any future field on these interfaces has
  the same two-file obligation.
- **`epoch` field** (added same day at the 178-fix owner's request, after
  they verified the cause predicate against their witness): the
  "was this entry recorded by the pass running now?" query on `cause` is a
  CONTAINMENT test (an auto-declare cause is a symbol occurrence, so
  identity against the root being canonicalized is always false), which is
  O(tree) — too hot for their auto-declare decision path. Each entry now
  also stamps `ce._boxingEpoch`, a counter incremented on the
  `_inferenceTxDepth` 0 → 1 transition in `beginInferenceTransaction`, so
  the same question is one integer comparison. `undefined` epoch = the
  write happened outside any boxing pass; fall back to containment.
  **Pass granularity is contractual** (stated by the 178-fix owner after
  verifying on their witness, 2026-08-13): all entries within one
  outermost pass share one epoch, deliberately — same-pass bindings are
  exactly what that fix treats as shareable. A finer-grained stamp would
  break the consumer; do not increase the resolution.

### Diagnostics consumption

`type-compatibility-error.ts` and the `incompatible-type` builders in
`validate.ts` look up the definition's provenance and append one line:

```
Expected `number`, but `x` has type `boolean`
  … inferred from its use in `And(x, y)`
```

Phase 1 prints `cause.toString()`; when a `span` is present (the Epsil route
already has line/col infrastructure) the diagnostic points at source instead.
**`describeError` is the diagnostic dedup key** (error-reporting design): the
provenance line goes in the *detail*, never in the key, or identical errors
stop deduplicating.

### Parser-separation contract

The type-system parser (`src/common/type/`) and the main parser stay
disentangled. The only new information flow is for pointing *inside* a type
annotation, and the rule is:

- **The type parser stays in local coordinates, permanently.** Anything it
  reports is an offset into the string it was handed. It never learns about
  documents, engines, or base offsets — not even as a passed-in number.
- **The caller owns the translation.** The main parser knows where the type
  substring began; a provenance `span` is composed (`base + local`) at the
  call boundary by the declaration site. Sharing by composition, not shared
  state.
- **No spans inside `Type` objects** (see the interning constraint above). If
  a diagnostic ever needs sub-type positions, re-parse the type string at
  diagnostic time in an offset-reporting mode: diagnostics are cold, the
  parse is cheap, the hot path is untouched.

Guardrail: any proposal to pass a base offset *into* `parseType` "for
convenience" is rejected — translate outside.

## Phase 2 — transaction scopes with rollback over the journal

A journaled write is undoable: a tx scope records journal positions and can
restore `{def, from}` pairs on abort. This subsumes several bespoke
"don't let writes escape" mechanisms:

1. **Overload resolution §4.2 WRITE-FREE** (`overload.ts`,
   `docs/plans/2026-07-25-overload-resolution-design.md`): the arm filter
   exists because trial-validating each arm would leak `infer()` writes from
   rejected arms, and it must MIRROR `validateArguments` admission logic
   "both ways" — a standing parallel-maintenance hazard (three separate
   mirror comments in the file). With rollback, trial validation becomes safe
   and the mirror can collapse into calling `validateArguments` itself.
   **§4.3 is untouched**: inference into operands still uses the JOIN over
   surviving arms, never the winner — trial each arm under a rolled-back tx,
   then apply the join once. Retiring the mirror is the first phase-2 target
   because its correctness spec is already written down.
2. **Static checking pass provisional-registry rollback** — evaluate
   unification after (1).
3. **First-boxing binding divergence** (Tycho item 178(a)/(c),
   `docs/plans/2026-08-13-first-boxing-binding-divergence.md`): the first
   boxing of an expression declares a free symbol as a side effect, so
   `ce.box(J).isSame(ce.box(J))` can be false and the inferred type differs
   between first and later boxings. Its owner intends to build the fix on
   this rollback primitive rather than a parallel mechanism — treat that
   plan as a phase-2 consumer when designing the tx API.
4. `_resolveOnlyDepth` and `withValueShield` are *expressible* as
   always-rollback txs but are cheaper as-is; the win is that they stop being
   patterns to replicate.

### Constraints on the tx primitive from prospective consumers

Stated 2026-08-13 by the owner of the first-boxing-binding-divergence fix
(who may ultimately not need a tx — their leading candidate makes the
auto-declare target structural, chosen from expression shape — so these are
consumer inputs, not requirements to over-design around):

- **Declarations, not only type writes.** A binding being *created* as a
  boxing side effect must be revertible; reverting inferred types on
  existing definitions does not cover it.
- **Re-entrant.** Canonicalization recurses through binders, so a tx opens
  inside another tx; nesting must compose, not flatten to the outermost.
- **Identity semantics must be stated explicitly.** `isSame` compares
  binding identity via `sameBindingDef`/`staticBindingOf`. The design must
  say whether a definition discarded by rollback and later recreated is
  equivalent under that relation — if not, a rollback-based fix converts the
  divergence defect into a subtler identity defect.
- **Cost.** Canonicalization is hot and hits per-binder scope pushes; a tx
  must allocate lazily on first journaled write, never eagerly per scope
  push, or it will show in the binder-body benchmarks.

## Phase 3 (optional — needs a ruling) — direction-rule revision

### The model as it stands (correcting an earlier draft of this section)

Inference of unannotated symbols is NOT one-shot. `TYPE_SYSTEM_ROADMAP.md` §1
states the model: "evidence-based and *revisable* (narrow from argument use,
widen from value assignment, non-monotone override per D11, forward-ref
re-derivation) rather than a once-and-final principal type." What produces
order-sensitivity is the **direction rules**, not an absence of revision.
Measured behavior (fixture: `docs/scratch/2026-08-13-inference-direction-rules.mts`,
`x` pre-declared `number`; measured across the Tycho-integration,
named-arguments, and this session, 2026-08-13, each probe re-run here):

| probe | result |
| --- | --- |
| widen from value assignment (`v := 5` then `v := 2.5`) | `integer` → `real` ✓ |
| narrow from argument use, starting at `unknown` | `unknown` → `number` ✓ |
| narrow further from a later declared-signature use (`g(v)`, `g: (integer) -> integer`, after `x·v`) | `number` → `integer` ✓ — use-narrowing is MONOTONE, not one-step |
| narrow from a value assignment (`v := 5` after `x·v`) | no move — excluded |

Probe trap: `v!` after `x·v` appears to show "no further narrowing" but is
vacuous — `Factorial` (and `IsPrime`) pin `number` even on a fresh symbol,
so they cannot discriminate. The non-vacuous control is `Fibonacci`, which
pins `integer` from `unknown` — and it narrows `v` from `number` to
`integer` exactly like the declared-signature route
(`docs/scratch/2026-08-13-inference-narrowing-controls.mts`). So there is
NO route split: uses narrow monotonically by both the operator-context and
declared-signature routes; assignment widens and never narrows;
order-sensitivity is the fixpoint of exactly those rules. The only open
ruling is the assignment-narrowing question below.

Measurement methodology for this doc (this design will generate many
"no move" comparisons): **a "no move" probe proves nothing unless a
fresh-symbol control shows the same context WOULD have moved the type from
`unknown`.** Both vacuous probes above were caught only by that control.

Consequence: `box(x·v)` then `v := 5` leaves `v: number`; the reverse order
leaves `v: integer`; the value is `5` either way. Both orderings are at the
fixpoint of the direction rules — a wide inferred type after a use is the
model's answer, not a degradation (see the
`reference_inference_direction_rules` memory entry and Tycho item 178).

### The question provenance makes decidable

**Should an assignment be allowed to narrow?** §1 excludes it, and it is not
recorded anywhere whether that exclusion is deliberate or inherited. Today
the exclusion is forced: without provenance, a write cannot know whether the
incumbent type came from a use (evidence about how the symbol is *consumed*
— narrowing over it risks invalidating other sites) or from a value (a fact
about what it *holds*). With provenance, precedence can differ by origin:
e.g. a value assignment may refine a type whose only support is inferred
uses that the narrower type still satisfies. That is a ruling for the user,
posed with the fixture's concrete before/after, and a semantic change with
snapshot blast radius: measure before wanting it.

### Two distinct fixes — do not conflate

The boolean-retype failure (`And(x, …)` infers `x: boolean`; a later numeric
use computes the meet of two *disjoint* types — `never` — so no monotone
narrow can help) has two independent remedies with very different blast
radii:

- **Provenance (phase 1)** improves the *message*: both sites named. No
  semantic change.
- **Revision (this phase)** would prevent some of those failures outright —
  a bounded re-fold of the recorded constraints on conflict, or
  origin-aware precedence as above. Semantic change; separate ruling.

Phase 1 is justified by diagnostics alone and does not presuppose any
phase-3 outcome.

## Explicitly not planned

A dependency tree / deferred-obligation worklist (the shape a batch compiler
like Rust's or the Plasm language's solver uses — see the source note below).
That design solves *scheduling* of constraints that cannot be discharged yet,
which requires seeing a whole program before solving. This engine is
incremental by design: expressions arrive one at a time in a live session and
each canonicalization must discharge its constraints eagerly. There is no
"end of program" at which to force frozen constraints. Revisit only if the
engine grows a whole-program compilation mode.

## Source note

Prompted by a discussion of the Plasm language's type-inference retrospective
(r/ProgrammingLanguages, 2026): fixed sequential inference passes fail on
constraints discovered mid-solve (a fallback type assignment generating new
field-projection constraints); their fix was a worklist with
freeze/unfreeze + dependency tracking, whose retained constraint records also
yielded two-site diagnostics. The transferable half for this engine is the
retained records (provenance, revision), not the scheduler.
