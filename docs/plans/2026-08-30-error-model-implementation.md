# Error-model implementation (Contract B) — plan

**Status:** in progress. Phase A started 2026-08-30.

The design is `docs/ERROR-MODEL.md`. Contract B was ratified 2026-08-27 as
ruling R-A of the numeric-lattice ratification package
(`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`). The
conformance suite is `test/compute-engine/error-model.test.ts`. This plan
turns the ratified declaration model into engine machinery. What already
conforms by construction (the 2026-08-29 conformance round: NaN propagation
through the numeric family via the `isExact` split, the demanded-operands
rule via `selectsOperands`, the `IsPrime` family conventions) stays as it
is; this plan adds the DECLARATION surface those behaviors were supposed to
be derived from, and the generic gates that read it.

## The model in one paragraph

A definition declares three separable facts (ERROR-MODEL §4, Contract B):
the carrier signature `(D₁, …) -> S`; a per-parameter NaN policy
`nanBehavior: propagate | handle | reject` with a mechanically derived
default; and a partiality declaration — `total`, `may-marker` (the omitted
default), or a `definedWhen` predicate — plus a `requires` contract
precondition. The framework derives the application behavior (the §4
behavior table) and the application type
(`S | marker(S) | nan`, narrowing when discharged) from the declaration.
One implementation in the generic dispatch path, not one per operator.

## The template: `missingBehavior`

`nanBehavior` is specified as symmetric with `missingBehavior`, whose
machinery touches exactly the seams the NaN policy needs:

| Seam | `missingBehavior` today | `nanBehavior` addition |
| --- | --- | --- |
| Declaration | `OperatorDefinitionFlags.missingBehavior` + `missingStrip` (`types-definitions.ts`) | `nanBehavior`, operator-level or per-slot |
| Resolution | `resolvedMissingBehavior` getter, mechanical default (`boxed-operator-definition.ts`) | `resolvedNanBehaviorAt(i)`, derived default below |
| Boxing | strip-before-validate in `box.ts` (`stripsMissingAt`) | NaN-policy-before-disjointness (§4 composition rule step 1) |
| Runtime | gate 4a in `_computeValueUnabsorbed` + async twin (`boxed-function.ts`) | pre-handler NaN gate, same two routes |
| Typing | absence absorption in the type seam (`boxed-function.ts` ~5560) | `\| nan` arm derivation (Phase C) |

## The migration-safe derived default

ERROR-MODEL §4 derives `propagate` "when the slot's carrier is a subtype
of `complex` that is not a subtype of `integer`, and the result type is
numeric; `reject` otherwise". That test presupposes Contract B's precise
carriers. Today most operators still declare bare `(number)` slots, and
after the lattice flip `number` is NOT a subtype of `complex` (it contains
`nan` and `infinity`) — so the literal reading would derive `reject` for
`Sin(NaN)` and contradict the pinned conformance behavior.

The implementation therefore binds the policy channel to the carrier's
treatment of `nan`:

- **The slot's carrier ADMITS `nan`** (bare `number`, `any`, `unknown`, a
  union containing `nan`): the policy channel is INERT. `NaN` is an
  ordinary domain member; the handler sees it and IEEE semantics (via the
  `isExact` split) carry propagation. This is the status quo for every
  unmigrated operator, and it is why Phase B changes no behavior until a
  signature flips.
- **The slot's carrier EXCLUDES `nan`** (a precise carrier: `real`,
  `complex`, `integer`, …): the §4 policy applies, with the derived
  default exactly as the doc states it. The NaN row runs before domain
  membership: a proven `NaN` in a `propagate` slot is admitted at boxing
  and the application evaluates to `NaN`; in a `handle` slot it is
  admitted and the handler answers; in a `reject` slot it is an `Error`.

An explicit `nanBehavior` declaration overrides the default in either
world (e.g. `IsPrime` declares `handle` even while its carrier is wide).

## Phases

### Phase A — declaration surface and resolution (no behavior change)

Implemented 2026-08-30 (worktree `ce-wt-error-model`, delivered onto the
main tree as unstaged changes). Pins:
`test/compute-engine/error-model-declarations.test.ts`.

- [x] `nanBehavior?: NanBehavior | readonly (NanBehavior | undefined)[]`
      on `OperatorDefinitionFlags` (`types-definitions.ts`), mirrored in
      `types-expression.ts`. Operator-level value applies to every slot; an
      array gives per-slot values (holes fall back to the derived
      default).
- [x] `partiality?: 'total' | 'may-marker'` and
      `definedWhen?: (args) => boolean | undefined` and
      `requires?: (args) => boolean | undefined` on the definition.
      Omitted partiality means `may-marker` (the sound default). A
      `definedWhen` declaration implies the partiality is that predicate;
      declaring both `partiality: 'total'` and `definedWhen` is a
      definition error.
- [x] Storage, `_update`, and serialization in
      `_BoxedOperatorDefinition`, next to `missingBehavior`.
- [x] `resolvedNanBehaviorAt(i)` implementing the table above (returns
      `'inert'` while the carrier admits `nan`). Never cached, computed
      from the current signature like `resolvedMissingBehavior`.
- [x] Explicit declarations where the convention is already ruled:
      `IsPrime`/`IsComposite` family `nanBehavior: 'handle'`
      (`library/arithmetic.ts` — the §4 comment at the definition already
      names it); `Mod` `definedWhen: b ≠ 0`. `Heaviside` does NOT declare
      `partiality: 'total'` yet: with today's `(number)` carrier the claim
      would be false (`Heaviside(i)` has no value). The `total` claim
      lands together with the `(real)` carrier flip in Phase F.
- [x] Unit pins for the resolution math (derived default per carrier
      shape, override precedence, per-slot arrays) in
      `test/compute-engine/error-model-declarations.test.ts`.

### Phase B — the NaN gates (behavior bound to precise carriers)

- [x] Boxing seam (`validateArguments` path in `box.ts`): the NaN policy
      is tested BEFORE ordinary type disjointness (§4 composition rule
      step 1). A proven `NaN` in a `propagate`/`handle` slot is admitted
      even though `nan` lies outside the carrier
      (`nanPolicyAdmitsParam`, threaded through
      `ValidateArgumentsInternals.nanPolicyAt` so ad-hoc library callers
      keep plain carrier semantics). A `reject` slot deliberately has NO
      carve-in: the ordinary carrier mismatch already produces the
      immediate `Error` the policy asks for.
- [x] Runtime seam (`_computeValueUnabsorbed` step 4a-0 + the
      `evaluateAsync` twin, step 3a-0): a pre-handler gate applying the
      §4 composition ordering — a `reject`-slot `NaN` → `Error`; else
      any `propagate`-slot `NaN` → `NaN`; else `handle` slots and
      ordinary evaluation proceed. Runs on the evaluated tail, so
      demanded strict siblings still evaluate (evaluation counts never
      change).
- [x] THIRD seam, found by the pilot test: the dispatch-time runtime
      conformance re-test (`runtimeConformanceError`, step 4d) refuted
      the very operand the boxing admission carved in — a
      `handle`-slot `NaN` reached evaluation and came back
      `incompatible-type`. Its `refutes` verdict now takes the same
      policy carve-in, passed from `genericRuntimeConformance`. Any
      FUTURE re-validation seam must remember this class: an
      admission carve-in at boxing needs the matching carve-in at every
      re-test of the same contract.
- [x] Conformance pins: the §4 rows of `error-model.test.ts` continue to
      pass unchanged; new pins exercise precise-carrier pilots
      (propagate admission+evaluation, derived reject, explicit handle,
      reject-beats-propagate composition, sibling evaluation counts).
- [ ] Full-suite blast radius measured and reported (expected ~0: no
      shipped signature uses precise carriers yet). BLOCKED on the box
      lock at the time of writing; run before staging is called done.

### Phase C — the derived application type

Result-type derivation reads the declaration: the application type is
`S | marker(S) | nan`, dropping `| nan` when no propagating slot's
argument type can contain `nan`, and dropping the marker when partiality
is `total` or `definedWhen` is proven for these arguments. The
`realOnlyStepType` class of hand-written type handlers becomes the
framework default read off the declaration (pilot: `Heaviside`). Not
started.

### Phase D — partiality channels at runtime

`definedWhen(args)` false → the rule-4 codomain marker; `requires(args)`
false → `Error`. Centralized pre-handler, next to the Phase B gate. The
framework owns the channel routing; the operator supplies only the
predicate.

**Minimal generic enforcement SHIPPED 2026-08-30** (dual-review finding:
declarations without a runtime channel are a lie): steps 4a-1 (sync) and
3a-1 (async) in `boxed-function.ts` — `requires` provably false → an
`evaluation-error`; `definedWhen` provably false → `NaN`, but only into a
NUMERIC codomain (`signatureResultIsNumeric`); a non-numeric codomain is
left to the handler, which owns its own marker vocabulary. Still open in
this phase: per-overload attachment, the non-numeric codomain markers
(`Missing` for collections?), and typing-side discharge (a proven
`definedWhen` should sharpen the derived application type — Phase C).

### Phase E — the higher-order floor

The conservative floor of §4 ("Policies are part of a callable's
contract"): an unknown or user-defined callable is `may-marker` with
unknown NaN behavior, wherever a policy is consulted (`Map`, callback
validation, compilation). The richer representation — policies as
effects/refinements in the function type versus definition metadata on
callable values — is the open design item of §7 and is NOT decided by
this plan; the floor is mandatory under any representation, so it can
land first. Not started.

### Phase F — signature flips, operator-by-operator

Each flip (e.g. `Heaviside: (real) -> rational<0..1>`, `total`) is its
own measured change governed by `docs/SIGNATURE-GUIDELINES.md`, because a
precise carrier changes admission: post-flip `real` excludes `±oo`, so
`Heaviside(±oo)` (today `1`/`0`) becomes an `Error` unless the carrier is
spelled `real | +oo | -oo`. Every flip must measure its snapshot blast
radius and decide the extended-value spelling explicitly. Not started —
and deliberately not part of the machinery phases.

## Known hazards, recorded before they bite

- **Operators with canonical handlers bypass declared-signature
  validation** (§4 names this the migration hazard). The Phase B boxing
  seam must claim that class too, or migrated operators with canonical
  handlers stay in the drift population.
- **`Rgb`-style bespoke NaN meanings.** The step-4a missing gate's
  comment records that some operators give a literal `NaN` operand its
  own meaning. Such operators keep working while their carriers admit
  `nan`; when their signatures flip, they must declare
  `nanBehavior: 'handle'` in the same change.
- **`~oo` is NOT governed by the NaN policy.** It is an ordinary value
  governed by carrier types (§4: the `IsPrime(~oo)` asymmetry is
  deliberate). No `~oo` arm belongs in any of the new gates.
- **The gates must not change evaluation counts.** Quiet propagation
  never skips a sibling operand's effects (§4 composition rule step 2).
