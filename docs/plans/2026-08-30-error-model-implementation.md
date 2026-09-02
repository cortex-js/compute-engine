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
- **The omitted `may-marker` default does not add `| nan` to result
  types yet.**
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
  **RE-MEASURED 2026-09-01, after Phase F completed** (two-line flip:
  `resolvedPartiality` in BOTH `contractBResultAdjustment` and the
  `applyContractB` candidacy gate, so settled non-numeric codomains take
  the `missing` arm too, as §2 rule 4 says): **412 failures across 86
  suites plus 7 snapshots** — three times the 08-31 number, and the
  same structural classes: `integer → integer | nan` (76 pins),
  `string → missing | string` (56), `tree<integer> → tree<integer> |
  missing`, and SHAPE claims destroyed (`vector<integer^3>` →
  `list<integer | nan^3>`, matrices likewise). Phase F did not shrink the
  population: the flipped heads carry type handlers, and the widening
  hits the HANDLER-LESS majority. Conclusion: binding the default is not
  a batch but a library-wide migration — every total builtin would have
  to declare `partiality: 'total'` (or the default stays opt-in and
  `docs/ERROR-MODEL.md` §4 is amended to say so).
  **RULED 2026-09-01 (Arno): the default stays opt-in — CLOSED.** The
  omitted `may-marker` is a runtime contract and contributes no type
  arm; `docs/ERROR-MODEL.md` §4 and its derived-type block are amended,
  with the ruling logged there. No code change: the staged opt-in IS
  the ratified semantics. `total` keeps its meaning as the stronger
  auditable claim. The input-side twin (`Length(First(t))` receiving
  `Missing`) is governed by `missingBehavior`, already shipped.
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

**Batch 4 — the complex-extension family (`Sin`, `Sqrt`, `Ln`,
`Arcsin`, `Erf`; `Exp` deferred) — IMPLEMENTED 2026-08-31.** Two
rulings taken before implementation (Arno, 2026-08-31): `Sin`/`Arcsin`
declare the FINITE complex carrier and an infinite argument is an
incompatible-type error (no value, no limit — ruling L9's chain); and
`~oo` is uniformly off-carrier for the whole family (it had been
inconsistent: `Sqrt(~oo)` → NaN, `Erf(~oo)` → `~oo`, and `Ln(~oo)`
DIVERGED between routes — evaluate → NaN, `.N()` → an arbitrary
`∞ + iπ/4`). What shipped:

- `Sqrt`/`Ln`/`Erf`: `(complex | signed_infinity)` carriers (their
  values at ±∞ are genuine — `√±∞`, `Ln(+∞) = +∞`, `Erf(±∞) = ±1`;
  `Ln(0) = −∞` is an in-carrier pole VALUE), explicit
  `nanBehavior: 'propagate'`, results `complex | infinity`
  (`√(−∞) = ~oo`, `Ln(−∞) = ∞ + iπ`) / plain `complex` for `Erf`
  (bounded). `Sin`/`Arcsin`: `(complex) -> number`.
- **Three enforcement seams, and the seam is part of each pin**
  (`error-model.test.ts`): `Erf` validates at BOXING (no
  canonical/fastpath); `Sqrt`/`Ln` fast-path canonicalization
  (`makeNumericFunction`), so the dispatch-time conformance re-test
  answers the error at EVALUATION; the trig factory's `canonical`
  handler bypasses BOTH, so `Sin`/`Arcsin` enforce the carrier in the
  factory's evaluate handler behind a new `finiteComplexCarrier`
  factory flag — all three are instances of the tracked timing
  deviation of `docs/SIGNATURE-GUIDELINES.md` §4.
- **`Exp` is NOT flipped**: `Exp(x)` canonicalizes to `Power(e, x)`,
  so no `Exp` application survives to validate or evaluate — a precise
  carrier there would be a claim nothing enforces. Recorded at the
  definition; the flip rides with `Power`'s own future migration.
- **`Sin`/`Arcsin` deliberately declare the RESULT `number`, not
  `complex`**: the compiled lanes' kind-preservation discipline
  documents its reliance on the wide result
  (`resultIsComplexValued`, javascript-target.ts), and the per-call
  sharpness lives in the type handlers.
- **One compiler fix the batch surfaced, general**: the complex-LANE
  machinery (`addDeclaredComplexParams`, `ensureUserFunctionValueRef`,
  `assertCallbackLaneMatch`) read a declared `complex` parameter as a
  lane request. True for a USER declaration (`f(z: complex) := …` wants
  `{re, im}`), false for a built-in's Contract B carrier — `Sin:
  (complex)` spells "finite complex, reals included" — and the
  misreading flipped the synthesized `Map(Sin, xs)` callback wrapper to
  `_SYS.csin` cells under a scalar `reduce` (a wrong `0`). The shared
  `laneRequestParamType` now answers `undefined` for engine-authored
  built-ins (the `builtinCallbackArity` class), keeping builtin
  callbacks on the real-default-plus-runtime-rule discipline their
  direct applications use. (The guard is load-bearing at
  `addDeclaredComplexParams` — the synthesized-wrapper body's lane; the
  other two sites are literal-gated so an unshadowed built-in never
  reaches them today, and carry the guard as defensive consistency.)
- **Two bounded enforcement gaps, documented as accepted** (both
  surfaced by the batch's dual review): a VALUELESS symbol declared
  with an off-carrier type (`s: signed_infinity`; `Sin(s)`) stays
  symbolic — the fast-path/canonical boxing bypass skips the type-level
  rejection, and evaluation has no value to report on — and the
  COMPILED lanes keep their pre-flip numeric behavior at the new error
  points (compiled `sin(Infinity)` → `NaN`), the same accepted-
  divergence class as compiled `Heaviside(~oo)` (see the CHANGELOG
  breaking entry). Also reviewed and left as-is: the `Sqrt`/`Erf` type
  handlers' `'number'` fallback branches for maybe-NaN operands — a
  narrower `complex | infinity` answer there would EXCLUDE the `nan`
  the propagate policy can deliver while handler authority suppresses
  the framework's own `| nan` arm, so the wide answer is the NaN-honest
  one.
- Type handlers all KEPT (they carry the per-call sharpness); the only
  handler edits make `Sqrt`/`Erf` decline on a proven-NaN operand so
  the framework answers the sharp `nan`.
- **Full-suite gate: 3 failures, each triaged and fixed** (all other
  suites green, snapshot delta 0): two pins updated to the new
  signatures (the epsil CLI diagnostic quoting `Ln`'s signature;
  `Derivative(Sin)` now typing `(complex) -> number`), and ONE real
  regression fixed in `symbolic/limit.ts` — `lim ln(1/x²)` at 0 had
  been RIGHT BY ACCIDENT (substitution folds `1/0²` to `~oo`, and the
  old `Ln(~oo).N()` happened to have `re = ∞`); post-flip the
  substitute is an incompatible-type Error and the limit machinery
  returned it as the answer. `substituteAtFinitePoint` now declines an
  INVALID substitute so the directed strategies answer (`1/x² → +∞`,
  `Ln(+∞) = +∞`). The fix postdates the batch's dual review; it is
  verified by the two limit suites plus calculus.

**Batch 5 — the remaining complex-extension heads (the 21 remaining
trig-factory heads + `Erfc`, `Sinc`, `FresnelS`, `FresnelC`) —
IMPLEMENTED 2026-09-01.** Three rulings taken before implementation
(Arno, 2026-09-01), each option recommended and ratified:

1. **A head whose value is the same in every direction of infinity
   admits `~oo`** (carrier `complex | infinity`): `Arcsec`, `Arccsc`,
   `Arcoth`, `Arcsch` — each composes through `1/x` and the inner
   inverse head (arccos, arcsin, artanh, arsinh) is continuous at 0.
   `Arcsec(~oo)` is the exact `π/2` now (it used to answer a machine
   float even under `evaluate()`).
2. **A finite IMAGINARY value at a real infinity is encoded, not
   rejected**: `Artanh(±∞) = ∓(π/2)i`, `Arsech(±∞) = (π/2)i` — the
   continuations of the principal branch the engine already implements
   at finite arguments (`Artanh(2)` answers `0.549… − (π/2)i`), and
   Mathematica's values. They used to answer `NaN` by kernel artifact.
3. **`Arcosh(−∞)` follows the `Ln(−∞)` treatment**: in-carrier,
   symbolic under `evaluate()`, `∞ + iπ` (machine complex) under `.N()`.

One correction to ruling 1's premise, found after the ruling and
recorded in the head's comment: **`Arccot` fell OUT of the ruling's
scope.** The question listed it among the five reciprocal-composed
heads, but the engine's branch has range `(0, π)` (`Arccot(−1) = 3π/4`),
so `Arccot(+∞) = 0` and `Arccot(−∞) = π` disagree — there is no value
at the single point `~oo`, and the old answer (`Arccot(~oo) = 0`)
contradicted the engine's own `Arccot(−∞)`. `Arccot` is therefore
`complex | signed_infinity` and `Arccot(~oo)` is an error. The ruling's
PRINCIPLE (admit `~oo` exactly where a genuine direction-independent
value exists) is what the code implements; the same analysis keeps
`~oo` off-carrier for `Arsech` (arcosh's branch cut passes through 0,
so the complex directions disagree even though both real approaches
give `iπ/2`).

What shipped:

- **The factory flag generalized to a carrier parameter**:
  `trigFunction(…, carrier)` with the three spellings `'complex'`
  (no value at any infinity — `Sin`, `Arcsin`, and now `Cos`, `Tan`,
  `Sec`, `Csc`, `Cot`, `Arccos`), `'complex | signed_infinity'`
  (values at `±∞` only — the six hyperbolics, `Arsinh`, `Arcosh`,
  `Artanh`, `Arsech`, `Arccot`), and `'complex | infinity'` (the four
  ruling-1 heads). The factory builds the signature from the carrier,
  declares `nanBehavior: 'propagate'` for the extended carriers (they
  are not subtypes of `complex`, so the derived default would be
  `reject`), and its evaluate arm — the enforcement seam for every
  factory head, since the `canonical` handler bypasses boxing
  validation — errors off-carrier infinities and folds in-carrier ones
  through the new `nonFiniteTrigValue` table on BOTH routes (the
  values are exact; the `Erf(±∞) = ±1` precedent).
- **Two NaN-by-artifact defects fixed by the fold**: `Arsinh(−∞)` and
  `Arcoth(±∞)` answered `NaN` (the kernels' `ln`-based formulas hit
  `−∞ + ∞`); their genuine values (`−∞`, `0`) answer now.
- `Erfc` mirrors `Erf` verbatim (`(complex | signed_infinity) ->
  complex`, explicit propagate, proven-NaN handler decline);
  `Sinc`/`FresnelS`/`FresnelC` take the same carrier and result (every
  value finite), all four validating at BOXING. Their shared
  `boundedEntireRealType` handler declines a provably-NaN element type
  so the framework answers the sharp `nan`.
- **Compiled lanes verified unaffected**: `Map(Cos, xs)` stays on the
  real kernel (the batch-4 `laneRequestParamType` builtin exemption
  covers all factory heads), and results stay the wide `number` for
  every kind-preserving factory head (`resultIsComplexValued`
  reliance).
- Fungrim: 3/3 suites green — no identity in the bundled artifact
  became unboxable.
- Old pins swept: `type-handler-parity.test.ts`'s `Sinc(NaN)=number`
  and `Sinc(~oo)=number` rows updated to the sharp `nan` / boxing
  error. Family pins added to `error-model.test.ts` ("the remaining
  complex-extension heads").
- `Exp` remains deferred to `Power`'s flip; `Arctan`, `Arctan2`,
  `Haversine`, `InverseHaversine`, and the four integral functions
  (`SinIntegral` etc.) were NOT in this batch's scope and keep their
  current signatures.
- **Dual review caught two real defects, both fixed with the batch**
  (Codex; the Claude leg added one style nit):
  1. The SIMPLIFY rules still rewrote the flipped heads at infinities to
     `NaN` (`simplify-trig.ts`, `simplify-hyperbolic.ts`) — and had
     diverged for `Sin`/`Arcsin`/`Arccos` since batch 4 unnoticed. The
     rules now fold the same values as the evaluate route and DECLINE
     where the head has no value (the evaluate route owns the error);
     the `simplify.test.ts` blocks pinning the old `-> NaN` rewrites
     were updated, and route-agreement pins added to
     `error-model.test.ts`.
  2. The new inverse-circular values at infinity ignored `angularUnit`
     while the finite folds convert (`arctan(1)` answers 45 in degree
     mode) — and the same defect pre-existed in `Arctan(±∞)`'s own
     evaluate arm and simplify rule. All now build on `halfTurnAngle`;
     inverse-HYPERBOLIC values are areas, not angles, and deliberately
     take no conversion. Pinned in `error-model.test.ts`.
  Two review findings were refuted as already-ruled accepted classes:
  compiled lanes keeping numeric behavior at the new points (the real
  lane cannot represent `−iπ/2`; the batch-4 CHANGELOG precedent), and
  the evaluation-time error seam for canonical-handler heads (the
  tracked timing deviation of `docs/SIGNATURE-GUIDELINES.md` §4, pinned
  deliberately since batch 4).

**Batch 6 — `Power`, with `Exp`/`Exp2` riding along — IMPLEMENTED
2026-09-01.** The last Phase F batch. Three rulings taken before
implementation (Arno, 2026-09-01), each option recommended and ratified:

1. **The EXPONENT slot excludes `~oo`**: `b^z` has no value at `z = ~oo`
   for ANY base — the result depends on the direction of approach in
   every case (the same analysis that made `Sin(±∞)` an error). So
   `2^~oo`, `0^~oo`, `(~oo)^~oo`, `Exp(~oo)`, `Exp2(~oo)` are
   incompatible-type errors (they all answered NaN).
2. **The BASE slot admits `~oo`** (carrier `complex | infinity`): a
   positive power of `~oo` is `~oo` and a negative power is 0 in every
   direction, so the values are genuine. This also fixed a defect:
   `(~oo)^-1` answered NaN through `.inv()` while `(~oo)^-2` answered 0
   and the `Divide` route's `1/~oo` answered 0 — it answers 0 now (the
   fix is in `canonicalPower`'s `-1`-exponent arm; `NumericValue.inv()`
   itself is untouched). `(~oo)^0` keeps the indeterminate-form NaN.
3. **A non-real base at a `±∞` exponent folds by its modulus**, closing
   a route divergence (`(1+i)^{+∞}` stayed symbolic under `evaluate()`
   and answered NaN under `.N()`): |b| > 1 → `~oo`, |b| < 1 → 0,
   |b| = 1 with b ≠ 1 → NaN (`complexBaseAtInfiniteExponent`,
   `arithmetic-power.ts`; an EXACT base whose |b|² merely rounds to the
   boundary declines rather than risk a wrong claim).

The signature is the family's first PER-SLOT carrier pair:
`(complex | infinity, complex | signed_infinity) -> number`, explicit
`nanBehavior: 'propagate'`, result kept the wide `number`
(`resultIsComplexValued` reliance, like `Sin`). What the batch measured
and recorded:

- **The enforcement seam is the EVALUATE HANDLER, not the dispatch-time
  conformance re-test.** The batch brief predicted the `Sqrt`/`Ln` seam
  (fast-pathed canonicalization → conformance re-test at evaluation),
  but `genericRuntimeConformance` SKIPS any definition with a custom
  `canonical` handler — and `Power` has one — so the re-test never runs
  for it. Measured mid-batch: with only the signature flipped, `2^~oo`
  still answered NaN. `Power` therefore enforces the exponent carrier in
  its own evaluate handler (`POWER_EXPONENT_CARRIER_TYPE` +
  `engine.typeError`), the trig-factory arrangement. Any future flip of
  an operator with a `canonical` handler needs the same in-handler arm.
- **`canonicalPower` had to STOP folding the off-carrier points** (the
  `x^~oo → NaN`, `0^~oo → NaN`, and `1^~oo → NaN` arms now return the
  node unchanged): the folds ran at boxing, before any enforcement seam,
  so the error could never surface. The in-carrier indeterminate forms
  (`0^0`, `1^±∞`, `(±∞)^0`, `(+∞)^i`) still fold to NaN at
  canonicalization.
- **Batch 4 missed the `Sqrt`/`Ln` SIMPLIFY twins** — found by this
  batch's route-agreement survey: `Sqrt(~oo).simplify()` and
  `Ln(~oo).simplify()` still rewrote to NaN through the `.sqrt()`/`.ln()`
  methods while the evaluate route answered the carrier error. Both
  rules now decline on `~oo` (the batch-5 trig convention). This
  re-confirms the standing rule: every evaluate-semantics flip must
  sweep the simplify twins, and the twins of PRIOR batches deserve a
  probe too.
- Type sharpness matches the `Sin` precedent, not `Sqrt`'s: the type
  handler declines on a proven-NaN operand, but canonical-handler heads
  do not get the framework's sharp-`nan` arm, so `Power(NaN, 2)` types
  `number` (as `Sin(NaN)` does). Recorded, not fought.
- Blast radius: ONE behavioral pin updated
  (`arithmetic.test.ts` — `(+∞)^~oo` NaN → error) and six inline
  snapshots in `canonical-form.test.ts` (the `x^{~oo}` block — nodes now
  survive canonicalization unfolded). Family pins added to
  `error-model.test.ts` ("Power: per-slot carriers"). No Fungrim
  identity uses a `~oo` exponent (verified by artifact scan); the
  canaries (both sinc limits, `∫₀^∞ e^(−x)`, `∫₀^∞ sin(x)/x` under
  `.N()`, `lim ln(1/x²)` at 0, `∫₀^∞ 1/(1+x²)`, `lim (1+1/n)^n`,
  `√2·√2`) all stayed green.
- `(+∞)^(+∞) = +∞` (ruled earlier this release) is untouched.
- **Dual review caught two real defects, both fixed with the batch**
  (the modulus-boundary one flagged by BOTH legs, from opposite sides):
  1. The unit-circle boundary of the modulus fold was decided by machine
     doubles, which cannot decide it in either direction — an exact
     `(1 + 10⁻¹⁰i)` (modulus > 1) computed `re² + im²` as exactly 1 and
     wrongly answered NaN, and a float `√3/2 + 0.5i` (modulus 1)
     computed 0.9999999999999999 and wrongly answered 0. Fixed with an
     EXACT integer test: every exact value is `(p/q)√c + (r/s)√m·i`, so
     |v|² is the rational `(p²c·s² + r²m·q²)/(q²s²)` and the comparison
     against 1 is bigint arithmetic (`exactModulusSquaredVsOne`) —
     definitive for rational AND radical components
     (`((√2/2)(1+i))^∞ = NaN` exactly). A float base within a few ulps
     of the circle answers NaN (machine precision cannot distinguish it
     from modulus 1); an exact base outside the exact test's reach
     declines inside a 10⁻⁹ band. The review also caught that the
     comment's worked example `(3+4i)/5 → 1.0000000000000002` was
     empirically FALSE (3-4-5 rounds to exactly 1; `(5+12i)/13` is a
     real reproduction) — a "verify math empirically" lapse.
  2. `Power(NaN, ~oo)` answers NaN, not the carrier error: the
     dispatch-time NaN-propagation gate runs before the evaluate
     handler, so a NaN operand short-circuits the whole application and
     the handler's carrier check never sees it. PINNED AS INTENDED
     rather than fought: it matches IEEE `pow(NaN, x) = NaN` and
     Mathematica's Indeterminate propagation, and the opposite ordering
     (error wins, as `Round(NaN, ~oo)` gets) is an artifact of Round's
     earlier BOXING seam — the per-head seam-timing differences are the
     already-accepted class. Recorded in the handler comment, the
     CHANGELOG, and a pin. ⚠️ For any future MULTI-SLOT canonical-handler
     flip: the evaluate-seam carrier check runs only on NaN-free
     applications; if error-wins semantics is ever wanted there, it
     needs a framework change, not a handler change.
  3. One missed simplification closed (review nit): an exact base whose
     components OVERFLOW the double range (`(10⁴⁰⁰ + i)^∞`) now folds
     through the overflow arm (a finite literal with a non-finite
     double read has modulus far above 1) instead of declining.
- **The full-suite gate caught one more defect in the batch's own code**
  (fixed, gate re-run): widening the `-1`-exponent fold's guard from
  `a.isInfinity && (a.isNegative || a.isPositive)` to bare `a.isInfinity`
  made a symbol with the EMPTY type `never` fold to 0 — the bottom type
  matches every type, so a never-typed operand answers `isInfinity` true
  (the exact trap `isMatrixTyped` guards against a few lines up, and the
  reason `interval-division.test.ts` pins `Power(m, -1)` as `never`).
  Chasing it exposed the PRE-EXISTING siblings: a never-typed base
  already folded `m^∞ → ~oo`, `m^-∞ → 0`, `m^0 → 1`, and a never-typed
  exponent folded `2^m → +∞` — the 2026-08-29 interval-division fix had
  guarded only the matrix rewrite. `canonicalPower` now has a single
  early-out for a `never`-typed operand (either slot), pinned in
  `interval-division.test.ts`. ⚠️ General rule this re-teaches: any fold
  keyed on a bare type-channel predicate (`isInfinity`, `isFinite`,
  `isGreater`, sign reads) must exclude the bottom type or keep a
  value/literal witness, or `never`-typed operands walk in.

**Batch 7 — the elementary remainder (`Abs`, `Log` + aliases, `Arctan`,
`Arctan2`, `Root`), with `Sqrt`/`Ln` re-ruled at `~oo` — IMPLEMENTED
2026-09-01.** Survey first (all five heads, every exceptional point, all
three routes): `Abs` was clean; `Log` disagreed across the three routes at
almost every point and `evaluate()` was wrong at three (`Log(0, 1/2)`,
`Log(+∞, +∞)`, `Log(0, 0)`); `Arctan2` lost the sign of `y` at `x = −∞`,
answered NaN at the four infinite corners, and stayed INERT for `~oo` or
complex operands; `Root` stayed symbolic under `evaluate()` at several
exact points; and the Power ruling had exposed an inconsistency —
`Power(~oo, 1/2) = ~oo` (pre-existing) against `Sqrt(~oo)` = Error
(batch 4) and `Root(~oo, 3)` = NaN. Four rulings (Arno, 2026-09-01), each
recommended and ratified:

1. **The modulus rule decides `~oo`**: a head whose modulus grows without
   bound in every direction has the value `~oo` — `√(~oo) = ∛(~oo) =
   ln(~oo) = log_b(~oo) = ~oo`. This REVERSES batch 4's `Sqrt`/`Ln`
   error at `~oo`, which was a uniformity choice (with `Sin`), not a
   no-value argument. `Erf(~oo)` stays an error (bounded oscillation).
   Carriers: `Sqrt`, `Ln`, `Log`, `Root`, `Abs` all take
   `complex | infinity`.
2. **`Log(x, b) := Ln(x) / Ln(b)` at every point**, under extended
   arithmetic — no special table: `Log(8, 1) = ~oo`, `Log(8, 0) = 0`,
   `Log(1, 1) = NaN`, `Log(0, 1/2) = +∞`, negative base = finite complex.
   Implemented once, in `logarithmAtExceptionalPoint`
   (`boxed-expression/logarithm.ts`), and consumed by `BoxedNumber.ln()`
   (evaluate route + simplify twin), the `Ln`/`Log` N handlers, and
   `simplifyLog` (whose hand-rolled table had drifted: base 0/1 → NaN).
3. **`Root(x, n) := Power(x, 1/n)` at every point**: index 0 is `x^~oo`
   → an Error, declared as the `requires` precondition (the dispatch
   gate answers it); index `±∞`/`~oo` is `x^0` (1, or NaN for `0^0`/
   `∞^0`); an infinite radicand delegates to `pow` (`rootAtExceptionalPoint`);
   an exact non-integer rational index rewrites to `Power` at
   canonicalization (`Root(2, 1/2) = 4`).
4. **`Arctan2` takes the IEEE corner values** (`±π/4`, `±3π/4`), matching
   the compiled lane's `Math.atan2` and Mathematica; the `x = −∞` sign
   defect is fixed alongside. Both folds are built on `halfTurnAngle`
   (the batch-5 rule); the simplify twin was ALSO using raw `ce.Pi`
   (pre-existing, fixed).

Decided by precedent, not asked: `Arctan(~oo)` is an error (the branch
ends `±π/2` disagree — the `Arccot` analysis); `Arctan(±i) = ~oo` folds
under `evaluate()`.

Seams, per head (each pinned): `Arctan`/`Arctan2` have no `canonical`
handler and are not fast-pathed, so BOXING validation rejects `~oo` and
complex operands at creation (the `Erf` seam), and the dispatch
conformance re-test refutes a value that arrives later (a symbol
assigned `i` after boxing) — a held value at boxing time is admission
evidence and is rejected at creation too. `Sqrt`/`Ln`/`Log`/`Root` no
longer have any off-carrier non-NaN point, so their seams carry no
error; `Root(x, 0)` is the `requires` gate (an `evaluation-error`, not an
`incompatible-type` error — the value `0` IS in the carrier; the
PRECONDITION fails).

Other defects fixed with the batch: `Ln(+∞)` stayed symbolic under
`evaluate()` (batch 4's "`Ln(+∞) = +∞`" was the `.N()` route);
`Log(−∞, b).N()` answered `~oo` (now `∞ + i·π/ln b`, the `Ln(−∞)`
convention); `Log(8, −2).N()` answered NaN; the box-time fold
`Log(1, b) → 0` fired for `b = 1` (now `0/0 = NaN`) and `b = NaN`; the
`Root` simplify twin rewrote index 0 to NaN and `Root(0, n < 0)` to NaN
(evaluate: Error / `~oo`) and folded `Root(0, +∞) → 0` against evaluate's
NaN — it now delegates infinite literal operands to `evaluate()`.

Pins swept: the batch-4 family test (`Sqrt`/`Ln` moved from the error
loop to a value loop), the Power-batch simplify-decline pins for
`Sqrt`/`Ln` (they FOLD now), `simplify.test.ts` Rules blocks (`root(0)(2)`
declines, `root(−π)(0) = ~oo`, `log_c(0)` declines for a symbolic base,
`log_1(3) = ~oo`), and `trigonometry.test.ts`'s complex-`Arctan2` pin
(symbolic → boxing error). Family pins added to `error-model.test.ts`
("the elementary remainder"). Fungrim: no identity at a changed point
(artifact scan + 3 suites). Canaries green.

Dual review (both legs stalled twice on the harness's stream watchdog
before a clean run; Codex 5 medium, Claude 1 high + 1 low):
- FIXED: `Arctan(±i)` was detected through the machine projections
  (`re === 0 && |im| === 1`), so an exact `(1 − 2⁻⁵⁴)i` folded to `~oo`
  — the same double-boundary class as the Power batch's modulus finding;
  it compares with `isSame(I)` now.
- FIXED (a class the numeric model had left unnamed): "anonymous"
  infinities — a complex literal with an infinite component (`∞ + i`),
  a member of the `infinity` TYPE that neither `isInfinity` nor
  `isFinite` reports — were classified finite by the logarithm helper
  and missed `BoxedNumber.sqrt()`'s new arm (the generic kernel computed
  `∞ − ∞`). Both now consult `hasInfiniteComponent` (logarithm.ts),
  which asks the NUMERIC VALUE (`bignumRe.isFinite()`), because the
  machine projection cannot tell `∞ + i` from a finite bignum beyond the
  double range: `10^1000` projects `re` to `Infinity`, and the first fix
  attempt made `Log(−∞, 10^1000)` answer NaN. ⚠️ Rule: never test
  finiteness of a literal through `.re`/`.im`.
- FIXED: `Math.log(base.re)` in the `Log(−∞, b)` numeric arm lost a
  bignum base (now `bignumRe.ln()`).
- FIXED (low): the `Arctan2` infinity table was duplicated in the
  simplify rule; `arctan2AtInfinity` now lives in
  `boxed-expression/trigonometry.ts` beside `halfTurnAngle` and both
  routes call it.
- REFUTED (Codex): "`Log(1, b)` with a symbolic base folds to 0 against
  the quotient rule" — it is the engine's generic-point convention, the
  same that folds `1^x` to 1 (documented there as matching
  SymPy/Mathematica; Mathematica's `Log[b, 1]` is 0). The convention is
  now named in the `box.ts` fold comment.
- REFUTED (Claude, rated high): "the simplify twin regressed — a symbol
  holding `+∞` no longer folds under `Ln`". Measured on the pre-batch
  tree: it never folded — `simplify()` is deliberately VALUE-BLIND (the
  `hasAssignedVariable` guard in simplify.ts; `BoxedSymbol.ln()` says
  the same), so the old generic-getter checks were never reached with
  such an operand. The reviewer verified the new behavior but not the
  old. The classifier was nonetheless moved to the generic getters
  (harmless, and it carries the anonymous-infinity fix), with a comment
  that states the value-blindness fact instead of the reviewer's
  assumed one.

Full-suite gate, first run: 3 failures / 32,173, snapshot delta 0. Two
stale pins (the Epsil CLI note quoting `Ln`'s signature; an
assume-extended pin expecting a fresh `r` used in `Abs(r)` to stay
`number` — the use now infers `Abs`'s carrier `complex | infinity`, the
same inference every flipped head produces), and ONE real defect the
ruling created through a caller: `Argument(z)` delegates to
`Arctan2(im, re)`, and `~oo` is represented as `(∞, ∞)`, so the IEEE
corner rule turned the direction-less `~oo` into the direction `π/4`.
`Argument` now guards `~oo` itself (NaN, as its own test pins). ⚠️ Rule
for future corner-value rulings: grep for callers that DELEGATE to the
head with raw components — they can feed it a representation, not a
value.

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
