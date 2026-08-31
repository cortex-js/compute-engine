# Implementation plan: the finite-by-default numeric-lattice flip

Status: **Phases 0–2 complete 2026-08-28** (Phase 2 delivered and staged:
the five `finite_*` names retired with one-cycle parse aliases;
`finite_number` split `number`-at-claims / `complex`-at-gates to preserve
compiler lane discrimination — recorded below; test sweep was 167 files,
not 158). Previously: **Phase 0 committed 2026-08-27; Phase 1 delivered
2026-08-28**
(steps 1.1–1.8 complete; dual review passed with 17 merged findings
applied; full suite green on the delivered base — 624 suites, 31,407
tests, snapshot delta zero beyond the enumerated deliberate pin changes;
staged, awaiting the user's commit). Phases 2–3 not started. Deviations
from the checklist as written are recorded in the per-step notes below
the checklist; open defects from the phase are filed in `ROADMAP.md`.

Authority: the ratified decision record
(`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`, rulings
R-A, R-B, L1–L10 with the L4/L6 amendments), the ratified design
(`docs/TYPE_SYSTEM_ROADMAP.md` §8), and the migration data measured by
the 2026-08-26 audits (roadmap §8.5). Signature style during the
migration follows `docs/SIGNATURE-GUIDELINES.md`.

How to use this document: phases execute in order, each delivered as a
worktree diff onto the shared tree and committed by the user before the
next phase starts. A session resuming this work reads this plan, then
the checklists below; update the checkboxes and the per-phase status
lines as items land. The executable conformance suite
(`test/compute-engine/error-model.test.ts`) and the full test suite are
the tripwires: every phase ends with both green and its snapshot delta
COUNTED AND REPORTED, never silently absorbed.

Ground rules for every phase:

- Multi-file work happens in a private worktree; the deliverable is a
  `git apply`-ed diff (`docs/SHARED-BOX-PROTOCOL.md` §1). Full-suite
  runs take the box lock.
- Never update a snapshot marked `@fixme`.
- Dual review (`/review-files`) before any phase's source diff counts
  as done; test and markdown files are exempt.
- The type-handler twin files (`library/type-handlers.ts` and
  `library/type-handlers-types.ts`) change only in lockstep.

---

## Phase 0 — Additive: the new types exist (NON-BREAKING)

Goal: `infinity`, `nan`, and the singleton spellings `+oo`, `-oo`,
`~oo` become declarable, parseable, matchable types — while every
EXISTING value keeps its current principal type and every existing
`matches()` answer is unchanged. Retyping values is Phase 1.

Why this is coherent before the flip: in the current lattice the
overlap `real ∩ infinity = {+∞, −∞}` needs an atom, and the atom
already exists — `non_finite_number`. Phase 0 exploits it
(`infinity ⊃ non_finite_number`, plus the `~oo` singleton); Phase 1
retires it.

Checklist (the sites follow the adding-a-primitive-type pattern):

- [x] `common/type/types.ts`: add `'infinity'` and `'nan'` to
      `PrimitiveType`/`NumericPrimitiveType`; document the tower
      change in the header comment as "transitional — see Phase 1".
- [x] `common/type/primitive.ts`: the ordered primitive-name list and
      `NUMERIC_TYPES`/`NUMERIC_TYPES_SET`.
- [x] `common/type/subtype.ts`: `PRIMITIVE_SUBTYPES` entries —
      `number ⊃ infinity ⊃ non_finite_number`; `number ⊃ nan`;
      `nan` disjoint from everything else. The `~oo` singleton is a
      value-literal type whose base is `infinity` (the value-literal
      subtype placement code, currently at the NaN/±∞ literal cases).
      `+oo`/`-oo` literals additionally stay `<: non_finite_number`
      (unchanged pre-flip behavior).
- [x] Parser (`common/type/parser.ts`): accept the new names; decide
      and pin the singleton spellings (`+oo`, `-oo`, `~oo` as value
      types — confirm the tokenizer handles them; if not, the interim
      spelling is the value-literal syntax that already parses).
- [x] Serializer round-trip pins (serialize → reparse → `isSame`).
- [x] `widen-value.ts`: widening TARGETS only — a NaN literal's widen
      target becomes `nan` ONLY IF no stored contract changes;
      otherwise defer to Phase 1 (measure: if any snapshot or
      `.type` string changes, defer).
- [x] Meet/disjointness spot pins: `meet(real, infinity)` =
      `non_finite_number`; `nan` disjoint from `complex`, `real`,
      `error`; `~oo <: infinity`, `~oo ⊄ complex`.
- [x] New pins in a dedicated test file (`lattice-phase0.test.ts`),
      plus box/parse-route probes.
- [x] CHANGELOG entry naming the NEW PRIMITIVES explicitly (downstream
      consumers match primitive names as literal strings; every new
      name must be called out).
- [x] **Tycho heads-up (exit item):** send the exact list of new type
      names and singleton spellings, and the Phase 1/2 retirement list
      (`finite_number`, `finite_complex`, `finite_real`,
      `finite_rational`, `finite_integer`, `non_finite_number`), so
      their name-switch classifiers get lead time before the breaking
      release. Sent to the Tycho POC session 2026-08-29: new primitives,
      the `matches('real')` silent break, the retirement/alias contract,
      the `isExtendedReal` rename, and the `BoxedType.finite_*` statics
      removal.

Exit gate: `npm run typecheck` + full-src native tsc clean; full suite
green under the box lock; snapshot delta ~0 (report the exact count);
conformance suite untouched and green.

## Phase 1 — The flip (BREAKING; one worktree, may land as several diffs)

Goal: bare numeric names mean finite; values retype; the doubled tower's
machinery comes out. Sub-steps in dependency order; 1.1–1.2 are one
diff (they cannot be split soundly), the rest may land separately.

- [x] **1.1 Lattice semantics.** Rewrite `PRIMITIVE_SUBTYPES` to the
      disjoint tree (`number = complex ⊔ infinity ⊔ nan`;
      `integer ⊂ rational ⊂ real ⊂ complex`, all finite;
      `imaginary ⊂ complex`). Delete the machinery that exists only for
      the doubled tower: `COVERING_UNION_MAP`/`unionCoveringMembers`,
      `finiteBaseType` (and its two consumers), the covering-union
      collapse in `reduce.ts`, the interleaved rungs of
      `SUPERTYPE_PROBE_ORDER`. `infinity` is defined by infinite
      magnitude (L2(a)); `non_finite_number` leaves the union (its
      consumers migrate in 1.6).
- [x] **1.2 Value retyping (lockstep cluster).** `oo`/`-oo` literals
      → the `+oo`/`-oo` singletons (widen target `infinity`); `NaN` →
      `nan`; `~oo` → the `~oo` singleton. The three
      `NumericValue.type` getters (`numeric-value/exact-…`,
      `machine-…`, `big-numeric-value.ts` — the last two also produce
      the mixed-infinite `complex` returns that become `infinity` per
      L2(a)) change in the SAME diff as the eleven string-equality
      gates that compare against them (`cost-function.ts`,
      `boxed-expression/numerics.ts`, `arithmetic-mul-div.ts`,
      `boxed-number.ts`, `order.ts`) — a gate comparing against a
      string the getter no longer returns fails silently.
- [x] **1.3 Predicate renames (L4 as amended).** `isReal` →
      `isExtendedReal` (family-wide: every ±∞-admitting predicate).
      The old names are REMOVED so typecheck drives the caller sweep;
      each caller chooses extended vs finite explicitly. `isFinite`
      keeps its name and means finite MAGNITUDE (`∞ + i` → `false`).
      Sweep the sign-fold and `1/±∞` guards during the rename (the
      type-keyed-guard failure class).
- [x] **1.4 Assignment promotion.** The declared-type ladder for
      `x := oo` (`boxed-value-definition.ts:913`,
      `engine-declarations.ts` promotion) gets an explicit infinite
      branch (promote to `infinity`, or `number` — decide at
      implementation with a pin either way; the ladder's
      widen-interaction comment inverts).
- [x] **1.5 Span constructors (L10).** Infinite endpoints are extent
      markers in BOTH constructors: `Contains(Interval(0,oo), oo)`
      flips to `False` (pin the flip); `Range(1,oo)` element type stops
      leaking the endpoint (`indexed_collection<integer>`); delete the
      `FINITE_NUMERIC_TYPE` narrowing map (`library/core.ts:1098`);
      `Length(Range(1,oo))` evaluates to `+oo`, declared
      `integer | +oo`.
- [x] **1.6 The 43 `non_finite_number` sites.** Migrate per the
      audit's site-by-site classification (roadmap §8.5 records where
      the classification lives): signed-guarantee sites → `+oo | -oo`,
      any-non-finite sites → `infinity` (usually `| nan`). NO blanket
      rename anywhere.
- [x] **1.7 The fourteen silent-flip classes.** Each by hand, each
      with a pin: the `Sinh`/`Cosh` realness gates, `extremumType` and
      `absFunctionType` bare-tier rungs, `Sinc`/Fresnel finite-limit
      gate, `logType`/pole-join `complex` claims (`→ complex | ±oo`
      unions), `LogIntegral`'s `real` claim, `innerProductSumType`'s
      all-real test, the tensor dtype dispatch (`tensor-fields.ts:566`
      — `infinity`/`nan` need their own arm or cells silently change
      storage class), `effects-inference.ts:688` (condition REVERSES —
      an `integer` parameter now proves finiteness),
      `boxed-function.ts`'s closure-narrowing successor sites,
      `assume.ts` meet-based contradiction outcomes, and the compiled
      clause guards (`base-compiler.ts` `jsClauseParamGuard`: `real` →
      `Number.isFinite`; new guards for `infinity`/`nan`).
- [x] **1.8 L9 lands by doing nothing** — the number-theory heads'
      parameters tighten with the rename in Phase 2; add
      signature-rejection pins for `GCD(oo, 2)`-class calls.

Exit gate: typecheck + native tsc; targeted suites for every touched
area; full suite under the box lock with the snapshot delta counted,
triaged, and reported; conformance-suite pins updated DELIBERATELY
(each changed pin re-examined against the ratified rulings, gap rows
re-labeled where a gap closes).

Phase 1 implementation notes (2026-08-27, recorded at completion):

- The `PrimitiveType` union did not shrink: the five `finite_*` names and
  `non_finite_number` remain as formally-strict subtypes of the bare
  names until the Phase 2 codemod. `finite_number` is deliberately
  INCOMPARABLE to `complex`: making it a subtype flips
  `isNonRealNumber('finite_number')` and switches the compiler to
  complex lowering for every generic numeric expression (measured, 26
  suites).
- Signed-guarantee result claims KEEP the `non_finite_number` spelling
  this phase (it still means exactly the signed pair, and the primitive
  is not match-equivalent to the `+oo | -oo` union). The spelling flip
  happens with the Phase 2 retirement. The `PositiveInfinity` /
  `NegativeInfinity` constant declarations did move to the `+oo`/`-oo`
  singletons.
- 1.3 renamed only `isReal` → `isExtendedReal` (all 80 callers chose
  extended semantics; NaN now answers `false` — a bug fix with measured
  zero fallout). `isInteger`/`isRational` keep their names: post-flip
  they are uniformly finite on both routes, so there is no ambiguity to
  resolve. Sign predicates keep their names.
- 1.4 promotes `x := oo` to `infinity` and `x := NaN` to `nan`; the
  `complex → number` rung was kept (now the ladder's one non-tier
  widening — open polish question).
- 1.5: `Length(Range(1,oo))` evaluates to `+oo` but its stored type
  surfaces as `infinity | integer`, not `integer | +oo` — every handler
  result passes through `widenValueTypes()` (ruling O9), which widens
  the singleton. Making a singleton survive needs an O9 exemption
  ruling. `Subset(NegativeIntegers, Integers)` stays `False` until
  Phase 2 removes the synonyms (pinned with explanation).
- 1.7: `extremumType` is knowingly loose (`Max(∞,3)` → `number`) —
  tightening is blocked by the frozen shadow-parity harness and belongs
  with that harness's retirement. The tensor-dtype silent flip predicted
  by the audit does not exist (measured: ∞/NaN literals fell to
  `expression` both before and after); string-tier arms were added for
  the broadcast-cell window.
- 1.8: `GCD`/`LCM`/`Binomial` declare `any*`/`number` parameters and do
  NOT reject an infinity; the rejection pins use `NthPrime`,
  `IntegerSqrt`, `Fibonacci` and `Repeat`. `Hypot(2, ∞)` now rejects at
  the signature — a genuine capability loss under L9(a) (open question:
  widen those parameters, at the cost of a symbol-inference side
  effect).
- Open rulings routed to the user: NaN-component complex values type
  `nan` (no ratified ruling covers them); the `Hypot` widening; the
  `complex → number` rung; the O9 singleton widening.

## Phase 2 — The mechanical sweep

- [x] **Codemod** over `src/` (NOT `common/type/`, already rewritten):
      `finite_integer → integer`, `finite_rational → rational`,
      `finite_real → real`, `finite_complex → complex`,
      `finite_number → complex` (the one non-obvious mapping: "any
      finite number" IS the new finite `complex`), inside quoted type
      strings in `signature:` values, handler `return`s,
      `parseType(...)`/range-constructor arguments, and
      `.matches(...)`/`isSubtype(...)` calls; collapse dual-listed
      `'X' || 'finite_X'` pairs. EXCLUDED: every `non_finite_number`
      occurrence (done in 1.6), the 1.7 files (done by hand),
      comments (rewritten for meaning in the same pass, by hand).
- [x] The type-handler twins in one diff.
- [x] **L7 aliases:** the five `finite_*` names parse as deprecated
      aliases normalizing to the bare names for one release cycle
      (`common/type/parser.ts`), never emitted by serialization;
      `non_finite_number` gets NO alias. Pin alias-in → bare-out.
- [x] Test-file sweep (158 files; mechanical, same mapping).
- [x] Docs: ARCHITECTURE.md's non-finite typing convention section,
      `doc/08-guide-types.md`, ERROR-MODEL §6's erasure-direction
      wording, CHANGELOG.

Exit gate: same as Phase 1, plus
`npx madge --circular --extensions ts src/compute-engine` (imports
moved) and a grep proving no `finite_*` spelling survives outside the
parser's alias table and historical docs.

## Phase 3 — Measurement, conformance, release

- [ ] Full suite + nightly type-soundness grid; snapshot blast radius
      surfaced as a number in the phase report.
- [x] Conformance suite: every §7 gap row this suite covered is CLOSED
      and re-pinned as ordinary conformance (`Sin(NaN)` and the whole
      numeric family; `Heaviside(NaN)` plus its `Sign` twin;
      `markerType()`/`withMarker()` answering `nan`; the `IsPrime`
      family per `docs/SIGNATURE-GUIDELINES.md` §3.3, with the
      `IsComposite` definition repaired alongside it; and
      `If(True, 5, err)` under the demanded-operands rule, implemented
      as the new `selectsOperands` definition flag). The `IsPrime(-7)`
      per-operator convention was RULED 2026-08-29 in the same round: a
      prime is a positive integer greater than 1 (SymPy's convention), so
      a negative integer answers `False`. Still OPEN in §7: only the
      `internal-error` native-fault code, which is not in the ratified
      package.
- [x] **Now-unblocked defect:** the confirmed
      `compile(Heaviside)(NaN) → 1` (ROADMAP entry) — fixed across the
      three lowerings, and the interpreter was aligned in the
      conformance round so the route divergence the compiled fix opened
      is closed too. The `compile(1/x)(0) → Infinity` vs `~oo`
      divergence was RULED 2026-08-28 (the float projection of a pole)
      and is documented in `docs/COMPILATION-MODEL.md`.
- [ ] Release notes: every new primitive (`infinity`, `nan`, the
      singleton spellings) and every retirement named explicitly;
      `matches('real')`-flip called out as the silent-break;
      major-version bump; Tycho coordination confirmed (their grep
      list from the Phase 0 heads-up).

---

## Explicitly out of scope for this migration

- Contract B's `nanBehavior`/`definedWhen` machinery (ratified R-A) —
  its implementation is a separate initiative that BUILDS ON the flip;
  only the vocabulary it needs (the types) lands here.
- The type-handler retirement features (roadmap §9.2 ranks 2–4).
- The `If`/`Which` `Nothing`-vs-`Undefined` repair (ROADMAP entry;
  needs its own small ruling on the marker fold).
