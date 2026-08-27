# Ratification brief: the numeric-lattice flip and the error-model package

Date: 2026-08-26. **Status: RATIFIED 2026-08-27** — all recommendations
accepted, with these amendments and follow-ups:

- **L4 amended (naming):** the ±∞-admitting value predicates are RENAMED to
  say what they mean — `isReal` becomes `isExtendedReal`, and the same
  pattern applies across the family (`isExtendedInteger`, …). During the
  migration cycle the old bare names are REMOVED, not silently re-pointed,
  so every caller makes an explicit choice under typecheck; a bare `isReal`
  may return later as the finite test once the migration completes.
- **L4 clarified (finiteness):** `isFinite` means "a numeric value of
  finite MAGNITUDE". A mixed value like `∞ + i` answers `isFinite = false`
  (it is a member of `infinity` under L2(a)); the three-valued contract
  (`undefined` when unknown, category-false for non-numbers) is unchanged.
- **L6 ruled: option (a)** — the declared type describes the mathematical
  value; the float image may saturate to an infinity. To be documented
  where the flip's type semantics are documented, not left implicit.
- **Follow-up deliverable:** documented guidelines for standard-library
  signatures — result-type precision versus readability, parameter
  leniency, and the boxing-time versus evaluation-time contract
  (`docs/SIGNATURE-GUIDELINES.md`, draft created 2026-08-27).

This brief collects every open ruling from two documents into one
sitting-sized decision list:

- `docs/TYPE_SYSTEM_ROADMAP.md` §8 (the numeric-lattice flip, rulings
  L1–L10),
- `docs/ERROR-MODEL.md` §4 and §5 (Contract B and the singleton types).

Each ruling below is self-contained: what happens today (probed on
2026-08-25/26 against `main`), what the proposal changes, the options,
a recommendation, and what happens if nothing is decided. The full
design rationale stays in the two documents; this brief is only the
decision surface. A checklist for quick answers is at the end.

How the rulings depend on each other: **R-A and R-B stand on their
own** — you can approve them with or without the flip. **L1 is the
gate**: if L1 is declined, L2–L10 are moot. L2–L10 are consequences of
L1; most can be ruled by accepting the recommendation.

---

## Part 1 — Independent rulings (valid with or without the flip)

### R-A. Adopt Contract B: signatures declare domains, not admissions

**Today.** A signature must stay wide enough to admit every value the
operator tolerates at runtime. `Heaviside` — whose mathematical truth
is "defined exactly on the real line, values in {0, ½, 1}" — declares
`(number) -> number`, which says almost nothing. The sharp facts live
only inside the TypeScript type handler, invisible to the API surface,
the documentation, and Epsil programs.

**Under Contract B** (ERROR-MODEL §4, as amended by both review
rounds). A definition declares three separable facts: a precise
carrier signature (`Heaviside: (real) -> rational`), a per-parameter
NaN policy (`propagate | handle | reject`, with a mechanical default),
and a partiality declaration (`definedWhen: b ≠ 0` for `Mod`;
`total`; or the sound default `may-marker`). The `error` channel stays
implicit for every operator (the unchecked-exceptions argument: it is
universal, so annotating it carries no information). NaN never needs
to be spelled in a result type: production is captured by the
partiality axis, admission by the policy.

**Options.** Adopt Contract B (the third-round external review of
2026-08-25 recommends this), or keep Contract A (admission-wide
signatures, sharp facts confined to type handlers).

**Recommendation: adopt.** It is also what makes the flip's short
names pay off (see L8).

**If nothing is decided:** Contract A stays; every signature remains
nearly information-free.

### R-B. Name the exceptional points: a `nan` type, and a name for `~oo`

**Today.** `NaN` and `~oo` (complex infinity) are admitted only by the
top type `number`. So `Divide(1, 0)` — which evaluates to `~oo` — has
type `number`, indistinguishable from "any number", and no signature
can say "may be NaN" or "is an infinity".

**Under the proposal** (ERROR-MODEL §5, Proposed). Two singleton
types: `nan` (the value `NaN`) and a named region for `~oo`. These are
new names for existing regions, not moves — `~oo` and `NaN` keep NOT
matching `complex`, so the 2026-08-21 placement ruling stands. If the
flip (L1) is also approved, the `~oo` singleton becomes a member of
the new `infinity` type (L3); if the flip is declined, both singletons
still land as direct children of `number`.

**Recommendation: adopt** in either world.

**If nothing is decided:** the top type keeps its unnameable residue,
and Contract B's derived types collapse to `number` at every
exceptional point.

---

## Part 2 — The gate ruling

### L1. The flip: bare numeric type names mean finite

**Today.** The tower is doubled: `integer ⊂ rational ⊂ real ⊂ complex`
admit the two signed infinities at every level, and a `finite_*` twin
of each level excludes them. Probed: `oo.matches('real')` and
`oo.matches('integer')` are both `true`; `oo.type` prints
`non_finite_number`. The `finite_*` spellings appear ~835 times in
`src/` — finite is the common case, and it carries the long name.

**Under the flip.** `integer`, `rational`, `real`, `complex` contain
only finite values. A new type `infinity` (members include `+oo`,
`-oo`, `~oo` — see L2/L3) and the `nan` singleton sit beside `complex`
under `number`, which decomposes exactly:
`number = complex ⊔ infinity ⊔ nan` — a disjoint tree. The extended
real line is spelled `real | infinity` (or exactly `real | +oo | -oo`
with the singletons). `oo.type` becomes the singleton `+oo`, which
carries its sign. This matches the mathematical convention (ℝ excludes
∞; the *extended* reals add it) and IEEE 754's own taxonomy (finite
numbers, two infinities, NaNs are three disjoint groups; "Not a
Number" is the standard's name). A user who wants the `double`
contract writes `number` — which is exactly the IEEE datum set.

A negation-based alternative (`real & !infinity`, keeping `real` wide)
was considered and rejected: it creates the lattice's first partial
overlap between primitives, makes the deliberately-conservative
negation checker load-bearing, and puts the verbose spelling on the
majority case. Full argument: roadmap §8.3.

**Cost.** This is a silent-break class for downstream consumers: a
`.matches('real')` on a possibly-infinite value changes its answer
with no error anywhere. It requires a coordinated major-version
release (L8). The in-repo migration was audited on 2026-08-26: ~85%
mechanical, with the judgment sites enumerated (roadmap §8.5).

**Recommendation: adopt.**

**If nothing is decided:** the doubled tower stays; R-A and R-B can
still land alone.

---

## Part 3 — Consequences of L1 (rule by accepting or amending)

### L2. What exactly is inside `infinity`?

Mixed directed infinite values exist: `∞ + i` (infinite real part,
finite imaginary part) is today typed `complex` and is deliberately
NOT the same value as `~oo`. After the flip, `complex` is finite, so
these values need a home.

- **(a) Recommended:** define `infinity` as "any numeric value of
  infinite magnitude". The three singletons `+oo`, `-oo`, `~oo` are
  its notable members; `∞ + i` is an anonymous further inhabitant.
- (b) Canonicalize every mixed infinite value to `~oo` (Mathematica's
  behavior). This is a value-level change, not just a type change.
- (c) Leave them typed bare `number` — rejected: it recreates the
  unnameable residue the whole proposal exists to remove.

**If nothing is decided:** implementation order decides it silently —
the outcome L2 exists to prevent.

### L3. `~oo` belongs to `infinity`; its type is spelled `~oo`

Division — the most common source of a blow-up — produces `~oo`, so
the everyday honest result contract is `real | infinity`. If `~oo`
lived outside `infinity`, every such signature would need to remember
`| ~oo`, and forgetting is a silent under-claim. With it inside, the
imprecision runs the safe way (over-admits), and exactness is
recoverable as `real | +oo | -oo`. Naming: the singleton is spelled
`~oo` (matches how the value prints); the name `complex_infinity`
proposed in ERROR-MODEL §5 is subsumed.

**Recommendation: adopt both halves.** Deciding nothing leaves `~oo`'s
placement to L2's default.

### L4. The value-level predicates do not flip with the type names

`oo.isReal` is `true` today, and folds consume it (sign logic,
`1/±∞ = 0`). The flip does not force the predicates to change, and
they should not change silently — a prior incident (retyping `~oo`)
silently disabled an `Add` guard.

**Recommendation:** predicates keep their current meanings —
`isReal` means "on the extended real line", `isFinite` keeps its
three-valued contract — and `type.matches('real')` becomes the
one-word finiteness test. Whatever is ruled, the guards are swept
explicitly during migration.

**If nothing is decided:** the migration decides per-site, which is
how the last silent-guard bug happened.

### L5. `non_finite_number` is retired, not renamed

The current atom means "a *signed, real* infinity" ({`+oo`, `-oo`}) —
a guarantee the `1/±∞ = 0` folds and sign-aware gates rely on. The new
`infinity` admits the unsigned `~oo`, so a blanket rename would
silently weaken those guards. The 2026-08-26 audit classified all 43
code sites individually: each migrates to `infinity` (where it means
"any infinite value") or to `+oo | -oo` (where it consumes the signed
guarantee); no uniform answer exists.

**Recommendation: confirm** the site-by-site migration. Deciding
nothing risks a grep-and-replace during implementation.

### L6. Machine overflow versus the finiteness promise

A bare `real` result type is, after the flip, a finiteness promise —
and machine evaluation can break it: `MAX_VALUE + MAX_VALUE`
evaluates to `Infinity` from two finite operands. (The NaN half —
`Sin(10000i).N()` overflowing to NaN — is already covered by Contract
B's `may-marker` partiality.)

- **(a) Lean:** document that the declared type describes the
  mathematical value, and the float image may saturate to an infinity
  — the standard IEEE expectation.
- (b) Mechanically widen every numeric-route result with `| infinity`
  — noisy, penalizes every result for a rare escape.
- (c) Normalize float overflow to `NaN` like other
  non-representability — a value-level change
  (`MAX_VALUE + MAX_VALUE` would stop being `Infinity`).

**If nothing is decided:** (a) happens implicitly but undocumented,
and the first bug report about it has no ruling to point at.

### L7. Deprecation path for the retired names

**Recommendation:** the five `finite_*` spellings remain
parse-accepted deprecated aliases for one release cycle, normalizing
to the bare names (their meanings coincide after the flip), and are
never emitted by serialization. `non_finite_number` gets no alias —
its meaning has no successor (L5). The alternative — a hard cut —
breaks every stored type string at once.

### L8. One package, one release

The flip changes ERROR-MODEL §5's settled premise (the directed
infinities leave `real`/`complex`), and Contract B's carrier
discipline is what makes the flip's short names valuable — so ratify
the flip together with R-A/R-B, or decline the flip and land R-A/R-B
alone. The release is major-version and coordinated: downstream
consumers are known to match primitive type names as literal strings,
so the release notes must name every new primitive (`infinity`,
`nan`, the singletons) and every retirement explicitly.

### L9. Wide-parameter, finite-result heads tighten their admission

About 30 signatures (mostly `library/number-theory.ts`) are written
`(integer) -> finite_integer` today. After the flip the same intent is
spelled `(integer) -> integer` — and the *parameter* now means finite,
so a call like `GCD(oo, 2)` is rejected at the signature instead of
reaching the handler.

- **(a) Recommended:** accept the tightening — an infinity is outside
  these operators' mathematical domain, and signature-level rejection
  is Contract B working as intended.
- (b) Widen those parameters to `integer | infinity` to preserve
  today's admission exactly.

### L10. Span constructors: infinite endpoints are extent, not members

An unbounded span involves three separate facts: the element type
(every member of `Range(1, oo)` is a finite integer), the extent (the
collection is unbounded), and the endpoint syntax (the `oo` marks
unboundedness, it does not name a last element). Probed 2026-08-26,
the engine is inconsistent: `Contains(Range(1,oo), oo)` is already
`False` and `Last(Range(1,oo))` is `NaN`, but
`Contains(Interval(0,oo), oo)` is **`True`**, and `Range(1,oo)`'s
element type leaks the endpoint (it types
`indexed_collection<number>` instead of `…<integer>`).

**Recommendation:** in BOTH constructors an infinite endpoint marks
unbounded extent and is never a member (`Interval`'s answer becomes
`False` — a fix, since ∞ is not a real number and the set claims
`set<real>`); elements type bare `integer`/`real`; the infinity
surfaces only through extent-reading operators —
`Length(Range(1,oo))`, inert today, can then honestly evaluate to
`+oo` with declared type `integer | +oo`.

---

## Checklist

| ID | Question, in one line | Recommendation |
| --- | --- | --- |
| R-A | Adopt Contract B (domain signatures, NaN policies, partiality)? | adopt |
| R-B | Add the `nan` singleton and a named type for `~oo`? | adopt |
| L1 | Bare numeric names mean finite; add `infinity`; retire `finite_*`? | adopt |
| L2 | `infinity` = "infinite magnitude" (houses `∞ + i`)? | option (a) |
| L3 | `~oo` inside `infinity`, spelled `~oo`? | adopt |
| L4 | Predicates keep meanings; `matches('real')` = finiteness test? | adopt |
| L5 | `non_finite_number` retired via site-by-site migration? | confirm |
| L6 | Float overflow: documented saturation escape? | option (a) |
| L7 | `finite_*` as one-cycle deprecated aliases? | adopt |
| L8 | Ratify as one package; coordinated major release? | adopt |
| L9 | Accept admission tightening at finite-result heads? | option (a) |
| L10 | Infinite endpoints are extent markers, never members? | adopt |

To rule: answer per ID (an "all recommendations accepted" is a valid
single answer, as is any subset with amendments). Rulings land in the
two source documents; this brief is then marked ratified and becomes
the decision record.
