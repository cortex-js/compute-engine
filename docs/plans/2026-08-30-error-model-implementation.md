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
unknown NaN behavior, wherever a policy is consulted. The richer
representation — policies as effects/refinements in the function type
versus definition metadata on callable values — is the open design item
of §7 and is NOT decided by this plan.

**SHIPPED 2026-08-31.** The audit found the floor already held almost
everywhere by construction: `resolvedPartiality` answers `may-marker` by
default, user functions are excluded from the runtime gates (Phase D),
and NO callback-consuming site (`Map`, callback validation, compilation)
reads the Contract B fields at all — the only consumers are this plan's
own seams. Two changes made the floor STRUCTURAL instead of
remembered-per-consumer:

- `isUserFunctionDefinition` on the definition (lambda, or unscoped
  strict multi-clause) is now the single source of truth — the
  dispatch-site `isUserFunctionDef` delegates to it — and BOTH resolution
  entry points consult it: `resolvedNanBehaviorAt` answers `'inert'` and
  `contractBResultAdjustment` answers `'none'` for user callables, so
  every future consumer is floor-safe without knowing the rule.
- This closed a real leak the audit exposed — with a precision the
  review pass added: a DECLARED-then-ASSIGNED lambda lives as a VALUE
  definition (no operator definition, and the value-route boxing never
  passes `nanPolicyAt`), so that route never leaked. The leak was real
  for OPERATOR-DEFINITION-shaped lambdas — a `declare()` whose `evaluate`
  is a function literal — where the boxing admission does consult
  `resolvedNanBehaviorAt` and a `(real) -> real` carrier derived
  `propagate`. With the floor, boxing keeps plain carrier semantics for
  every user-callable shape (both shapes pinned).
- The review also settled the floor's PRIORITY, symmetrically: it is
  ABSOLUTE for user callables — explicit `nanBehavior`/`partiality`
  fields on a user-fn definition are ignored by both resolution entry
  points — because the runtime gates exclude user functions
  unconditionally, and honoring a declaration in the type story alone
  would put a claim there that no runtime channel backs. (Codex's
  competing reading — that the floor should WIDEN user-callable
  application types — was refuted by the standing Phase C measurement:
  same mechanism, larger population.)

### Phase F rulings — 2026-08-31 (Arno)

Two rulings, given together when the Heaviside carrier question was put:

1. **Heaviside declares `(real | +oo | -oo) -> rational<0..1>`** — the
   extended real line spelled with the singletons, keeping
   `Heaviside(±oo)` = 1/0 and excluding `~oo` at the boundary.
2. **`non_finite_number` RETIRES.** The name is misleading: `~oo` and
   `∞ + i` are non-finite numbers, yet neither is a member. Sites
   migrate to `infinity` where "any infinite value" is meant, and to
   `+oo | -oo` where the signed guarantee matters. This executes the
   site-by-site migration the L5 amendment deferred
   (`docs/TYPE_SYSTEM_ROADMAP.md` §8.4).

Retirement execution plan (inventory 2026-08-31: 178 src sites in 33
files, 174 test sites in 26 files, 13 doc files, and the three
`NumericValue.type` kernel gates that ANSWER the name):

- **R1 — core lattice**: remove the primitive from the type union and
  the subtype/reduce/widen/primitive tables; parse-accepted deprecated
  alias for one release cycle normalizing to `+oo | -oo` (the exact
  same set — the L7 pattern; never `infinity`, which would silently
  widen); the `NumericValue.type` gates answer the signed singleton.
- **R2 — mechanical src sweep**: every consumer site rewrites to the
  semantics-preserving `+oo | -oo` spelling (or the singleton constants).
  NO site widens to `infinity` in this pass — a widening admits `~oo`
  and is a behavior change, so any such upgrade is a separate, measured
  follow-up per site.

  **Execution findings (2026-08-31), each load-bearing:**
  - **`widenValueTypes` must PRESERVE the ±∞ value types.** The O9 seam
    widens every handler result to strip over-specific literal-type
    contracts, and it sent ±∞ value nodes to `infinity` — which
    destroyed every signed-pair claim the retirement had just respelled
    (`Ln(0)` typed `infinity`, and joins degraded `1 + Ln(0)` to bare
    `number`, breaking `isExtendedReal` downstream). Post-retirement the
    `+oo`/`-oo` value types ARE the canonical spelling of the
    extended-real claims, so the widener now keeps them (NaN still
    widens to `nan`).
  - The kernel windows keep the coarser tier: `NumericValue.type`,
    `stripNumericRanges` and the broadcast-cell window answer
    `infinity` for a signed infinity (no primitive names the pair), and
    the sign is read off the VALUE where it matters. A consumer that
    classifies both must accept `infinity` and `+oo | -oo` alike
    (recorded at the literal-type window in `boxed-number.ts`).
  - `BoxedType.non_finite_number` static RENAMED to
    `BoxedType.signed_infinity` (breaking, the Phase 2 `finite_*`
    statics precedent).
  - The signed-infinity value types now PRINT as `+oo`/`-oo` (they
    printed `Infinity`/`-Infinity`).
  - **`signed_infinity` is the intentional one-word spelling of the
    pair** (ruled by Arno 2026-08-31, after questioning whether widening
    to an anonymous union read as arbitrary): the parser accepts it as a
    permanent named spelling of `+oo | -oo`, and the serializer prints a
    union containing both members under the name — an extended-real
    union displays `real | signed_infinity`. The retired
    `non_finite_number` alias normalizes to the same union. The
    `widen(+oo)` chain reads `+oo → signed_infinity → infinity →
    number`, each rung forgetting exactly one fact (which sign;
    directedness; everything).
- **R3 — test sweep + full-suite blast radius** (type-string assertions
  update mechanically; snapshot delta measured and reported).
- **R4 — docs sweep, CHANGELOG breaking entry, L5 closure note in the
  roadmap.**

Then the Heaviside flip lands on the retired-name world as the Phase F
pilot.

**Retirement (R1–R4), the `signed_infinity` naming, and the Heaviside
pilot ALL SHIPPED 2026-08-31** (one commit; final combined gate 645/645
suites, 31,279 tests, snapshot delta 0). The pilot proved the full
pattern: domain signature declared, hand-written type handler deleted,
claims framework-derived, off-carrier inputs erroring at boxing per the
ruling. Two per-flip traps recorded for the batches ahead: an
extended-real carrier DERIVES `reject` (declare `nanBehavior:
'propagate'` explicitly), and each flip must sweep tests pinning the old
inert-forever behavior plus the migration-fixture ledger comments.
Next batches, in order: `Sign`; the order-dependent family
(`Floor`/`Ceil`/`Round`/`Truncate`, comparisons); the complex-extension
family (`Sin`, `Sqrt`, `Ln`, `Exp`, `Arcsin`, `Erf` → `(complex)`
carriers). One measured batch at a time.

**Batch 2 — `Sign` — SHIPPED 2026-08-31.** The pilot pattern verbatim:
`Sign: (real | signed_infinity) -> integer<-1..1>` with explicit
`nanBehavior: 'propagate'` (extended-real carrier derives `reject`) and
`partiality: 'total'`; the hand-written `realOnlyStepType` handler and
its `SIGN_REAL_TYPE` constant are deleted — and with `Sign` migrated the
`realOnlyStepType` helper itself had no callers left, so the
`realOnlyStepType`-class retirement Phase C left open is now COMPLETE
(the helper is removed from `type-handlers-types.ts`). Consequences,
each pinned in `type-handler-parity.test.ts` / `error-model.test.ts`:
`Sign(NaN)` types `nan` (was `number`) and still evaluates `NaN` — via
the generic gate now, the handler's own NaN arm is dropped; `Sign(i)`,
`Sign(1+2i)` and `Sign(~oo)` are boxing errors (were inert forever);
`Sign(u)` for `u: number` types `(integer<-1..1>) | nan` (was
`number`); proven extended reals keep the sharp `integer<-1..1>`. The
sgn handler stays the plain operand forward (already
evidence-conditioned, unlike Heaviside's constant claim). The nightly
`type-soundness-grid` ALLOW entries `Sign(i)`/`Sign(1+i)` are removed
(the grid skips invalid expressions).

One artifact consequence, found by the batch's own full-suite gate: the
Fungrim identity `09c107` (`Sign(i) -> i` — the complex sign convention
`z/|z|`) is not representable under the real-only carrier, so it is
removed from the bundled artifact, ledgered in the manifest as a
`box-error` disposition (the `310f36` precedent from the
finite-by-default flip), and noted in the CHANGELOG.

The batch also FIXED a broadcast unsoundness in the shipped Phase C/D
derivation, witnessed by the flip: `contractBResultAdjustment` probed
only the operand's own type for NaN evidence, and `nan` is not a
subtype of `list<number>` — so a broadcast application over
maybe-NaN elements claimed SHARP cells (`Heaviside(L)` for
`L: list<number>` typed `list<rational<0..1>>` while
`Heaviside([1, NaN])` evaluates a `NaN` cell). For a broadcastable
operator the adjustment now descends to the element type (the same
descent the broadcast machinery performs) and answers `widen-nan` on
element-level evidence — never `is-marker`, since a NaN element makes
one CELL NaN, not the whole application. Proven NaN-free elements
(`list<real>`) keep sharp cells. Pinned in
`error-model-declarations.test.ts` ("broadcast NaN evidence is read off
the ELEMENT type").

**Batch 3 — the order-dependent family
(`Floor`/`Ceil`/`Round`/`Truncate`, comparisons) — IMPLEMENTED
2026-08-31** (delivered to the main tree; gate pending at the time of
this note). What each part got, and why:

- **`Floor`/`Ceil`/`Truncate`:
  `(real | signed_infinity) -> integer | signed_infinity`**, explicit
  `nanBehavior: 'propagate'`, `partiality: 'total'`. `Round` is
  `(real | signed_infinity, integer?) -> real | signed_infinity` (the
  precision form is generally non-integer) with the one-element
  `nanBehavior: ['propagate']` so the precision slot keeps the DERIVED
  integer-slot `reject` — `Round(2.5, NaN)` is an error, not a
  propagation.
- **The component-wise complex (Gaussian) rounding is REMOVED.** §4's
  "Choosing carriers" rules order-dependent operators onto `(real)`,
  and the compiled lanes were ALREADY real-only (runtime NaN, or a
  compile-time capability decline, for a complex operand) — the flip
  closes that interpreter/compiler divergence. `Floor(i)`,
  `Round(1+2i)`, `Truncate(~oo)` are boxing errors now (CHANGELOG
  breaking entry).
- **Unlike the pilots, the family KEEPS a (slim) `'types'` handler** —
  `roundingFunctionType` — because the declared result cannot carry the
  finiteness split: a proven finite real sharpens to `integer` (the
  load-bearing claim `matches('integer')` gates read), a proven
  non-finite extended real — by TYPE or by the VALUE channel the
  descriptor reads through an application (`Ceil(Abs(w))`, `w := +∞`) —
  to the signed pair, a proven extended real of unknown finiteness to
  `integer | signed_infinity`, and everything else DECLINES so the
  framework derives the honest claim (with the `nan` arm) from the
  declaration. The legacy expressions-shape twin and the family's
  shadow-parity rows retire with the flip (the handler now deliberately
  diverges from the frozen legacy shape).
- **The comparisons are NOT carrier-flipped, by design.** `Less`/
  `LessEqual` (and the canonicalized `Greater`/`GreaterEqual`) keep
  their wide `(any, any+)` chain carriers: chain decomposition, quantity
  operands and `Missing` all ride through them, they are `lazy` (§4's
  sanctioned validation opt-out), and their `NaN` behavior was already
  ruled (IEEE unordered → `False`, 2026-07-24). The Phase F change is
  the explicit `nanBehavior: 'handle'` declaration documenting that
  ruling on the definition, where §4's conformance sweep can read it.
- **Two engine fixes the batch surfaced, both general:** (1)
  `isSubtype`'s union ⊑ union probe required every lhs member to fit a
  SINGLE rhs member, so a member that is itself a (legal, unreduced)
  nested union was wrongly rejected — witnessed by `widenValueTypes`
  tripping its own supertype assert on
  `(integer | signed_infinity) | nan`; a union member now recurses
  against the whole rhs (pinned in `internals/type-lattice.test.ts`).
  (2) `widenNumericCellsWithNan`/`widenCellsWithMarker` now splice
  `nan` into an existing union instead of minting the nested shape.

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
