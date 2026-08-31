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
is `total` or `definedWhen` is proven for these arguments.

**Core derivation SHIPPED 2026-08-31**
(`contractBResultAdjustment` on the definition;
`applyContractB` inside the `maybeAbsorb` funnel of `type()` in
`boxed-function.ts` — every def-path return flows through it). Three
deliberate scope decisions, each reversible in one line once measured:

- **Handler authority**: the derivation applies only when NO per-operator
  type handler answered. A handler's claim is conditioned on the evidence
  it read (`realOnlyStepType` answers `rational<0..1>` only for a
  proven-real operand); widening it would degrade the sharper authority,
  observable as `Heaviside(x).isNonNegative` regressing through
  `signOfType`.
- **The omitted `may-marker` default contributes no type arm yet.**
  Binding it engine-wide flips every handler-less precise numeric result
  to `S | nan` at once, which silently defeats `matches('integer')`-style
  type-keyed guards (a recorded pitfall class). Explicit declarations —
  `partiality: 'may-marker'`, `definedWhen` — do bind.
  **MEASURED 2026-08-31**: the one-line flip
  (`resolvedPartiality` instead of the raw field in
  `contractBResultAdjustment`) was run against the full suite in a
  worktree — 126 test failures across 28 suites plus 1 snapshot, versus
  ZERO with the staged opt-in default. The failures are structural
  (polytype echo pins, broadcast lifts, overload-arm specificity,
  aggregate typing, generic `(T) -> T` echoes), confirming the staging.
  The doc-faithful default binds with the Phase F flips, after those
  consumers learn to condition on the derived application type — the
  migration path §4 itself prescribes.
- **Broadcast-lifted results are widened PER CELL**
  (`widenNumericCellsWithNan`, `common/type/utils.ts` — the recursive
  twin of `absorbNumericAbsence`): a broadcast application types
  `list<real | nan>`, never a top-level union with the collection.
  (The original scalar-only cut was reversed by the Phase C dual review.)
- **Overload sets participate through the seam's numeric proof**: the raw
  signature of an overload set is an intersection, for which
  `signatureResultIsNumeric` answers false, so the seam passes its own
  instantiated-result verdict as `contractBResultAdjustment`'s second
  argument. The RUNTIME partiality gate (Phase D) still reads the getter
  and therefore still skips overload sets — open with the rest of full
  Phase D.
- **`definedWhen`/`requires` carry a documented purity contract** (pure,
  structure-and-static-types only, exceptions treated as undecided): the
  predicates now run inside the cached `.type` derivation, and the
  type-path call is wrapped so a throwing predicate degrades to the
  undischarged verdict instead of crashing the getter.

Also open: the `realOnlyStepType`-class handler retirement waits on the
Phase F signature flips (with today's `(number)` carriers the handlers
are what carry the sharpness — `Heaviside` cannot be the pilot until its
carrier is precise). Pins: the "derived application type" describe in
`test/compute-engine/error-model-declarations.test.ts`.

### Phase D — partiality channels at runtime

`definedWhen(args)` false → the rule-4 codomain marker; `requires(args)`
false → `Error`. Centralized pre-handler, next to the Phase B gate. The
framework owns the channel routing; the operator supplies only the
predicate.

**Minimal generic enforcement SHIPPED 2026-08-30** (dual-review finding:
declarations without a runtime channel are a lie): steps 4a-1 (sync) and
3a-1 (async) in `boxed-function.ts` — `requires` provably false → an
`evaluation-error`; `definedWhen` provably false → `NaN`, but only into a
NUMERIC codomain; a non-numeric codomain was left to the handler.

**Full Phase D SHIPPED 2026-08-31**:

- **The codomain marker generalizes past numeric** (§2 rule 4): a false
  `definedWhen` answers `NaN` into a numeric codomain and `Missing` — the
  one primitive quiet datum — into a settled non-numeric or indeterminate
  one, at evaluation (both routes) and in the derived application type
  (`codomainMarkerType`; per-arm markers for a union codomain). An
  undischarged DECLARED partiality widens every cell of the result with
  its own marker (`widenCellsWithMarker` — numeric cells `| nan`,
  non-numeric settled cells `| missing`). The adjustment verdicts are now
  `'none' | 'widen-nan' | 'widen-marker' | 'is-marker'`; the
  numeric-codomain gate and the `resultIsNumeric` hint parameter are
  gone, which is also what lets overload sets participate everywhere.
- **Per-overload attachment, for everything DERIVABLE** (§4 "attach per
  overload"): `resolvedNanBehaviorAt(i, armSignature?)` derives per-slot
  policies from the RESOLVED arm; the runtime NaN gates and the marker
  gate read the arm off `_resolvedOverload` (via `resolvedArm`), so an
  overloaded operator's numeric arm propagates NaN and marks with `NaN`
  while its string arm marks with `Missing`.
- Both predicates are try/caught at the runtime gates too (a purity
  violation reads as "undecidable", never a crash).
- **USER FUNCTIONS (lambdas, multi-clause definitions) are a sanctioned
  opt-out of ALL the runtime gates** — found by the full-suite gate, not
  assumed: a multi-clause function's own dispatch owns a NaN operand (a
  clause guarded on `NaN` or `infinity` must SEE the value; a wide
  fallback clause must catch it), and the generic gates were preempting
  it (4 test failures across the compiled and Epsil multi-clause
  suites). The gates now exclude `isUserFunctionDef` exactly as the
  dispatch conformance check always has. TypeScript trap on the way in:
  the negated type predicate narrows `def` to `never` — the hoisted
  `boolean` const is load-bearing, as at `genericRuntimeConformance`.
- `signatureResultIsNumeric` deleted (its last consumer was the minimal-D
  gate).

Deliberate deferrals, recorded here rather than discovered later:

- **Explicit PER-ARM declaration spellings** (a different explicit
  `nanBehavior`/`partiality` per overload arm) are not representable. The
  derived defaults are per-arm; explicit declarations stay
  operator-level. No operator needs the distinction today; the spelling
  gets designed when one does.
- **The boxing admission carve-in stays operator-level**: `nanPolicyAt`
  is consulted during arm TRIALS, before a resolution exists, so it
  cannot read "the" arm. Overload sets therefore keep plain carrier
  semantics at boxing; the runtime gates own the per-arm behavior.

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
