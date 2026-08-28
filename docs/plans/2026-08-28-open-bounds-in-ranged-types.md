# Open bounds in ranged types

Status: RULED and IMPLEMENTED 2026-08-28 (grammar/AST/normal form in `common/type/{lexer,parser,numeric-range,reduce,subtype,utils}.ts`; assume refinement in `assume.ts`; descriptor field retired; kernel openness in `numerics/interval-arithmetic.ts`; pins: `test/compute-engine/open-bounds.test.ts`) — design for the
OPEN-BOUNDS half of the ROADMAP entry "Ranged types: interval
arithmetic and open bounds" (the interval-arithmetic half shipped
2026-08-27, `docs/plans/2026-08-27-interval-arithmetic-result-types.md`).
The four questions in §6 were RULED by the user 2026-08-28: question 1
— the chained-inequality markers `real<0<..<3>` (`0<..` spells
"0 < x", `..<3` spells "x < 3"; `>` stays purely a bracket); questions
2, 3, 4 — YES as recommended (open range is canonical with the §3.2
normal form; the kernel carries openness per §3.5; the descriptor
`facts.bounds` retires with the §3.4 scoping). Every example below
uses the ruled `0<..` lower marker. Written against the post-flip lattice (Phase 1
of the finite-by-default migration: bare `real`/`integer` are
finite-only; the extended-real spelling is `real | non_finite_number`,
constant `EXTENDED_REAL_TYPE` in `common/type/primitive.ts`).

Revision 2 incorporates the dual spec review of 2026-08-28. The
load-bearing corrections: openness propagation is an ATTAINABILITY
analysis, not an exactness gate alone — with the closed-zero
multiplication corner, corner ties, and interior zeros spelled out
(§3.5); the `facts.bounds` retirement is scoped to symbol-self bounds
(part-subject assumptions like `Re(s) > 1` have no type slot and keep
the assumption-index channel, §3.4); the meet/intersection rules,
integer-tier normalization, empty-range normalization, the
value-vs-range subtype branch and the reducer normal form are now
specified (§3.2, §3.3); marker adjacency is lexically mandatory (§2).

## 1. The problem: strictness lives in three places

A range type's endpoints are CLOSED — the grammar has no way to write
"x > 0" as a single range. Today the strict facts travel three separate
channels:

1. **The `& !k` intersection convention**, but only for `k = 0`:
   "positive" is spelled `(real<0..>) & !0` (`positiveRangeType`,
   `common/type/utils.ts`). The assume refinement emits `!k` for no
   other endpoint, so `assume(0 < v && v < 1)` refines the TYPE to
   `(real<0..1>) & !0` and the strict `< 1` never reaches it.
2. **`facts.bounds`** — a descriptor-only side channel
   (`operand-descriptor.ts`, fed by
   `getInequalityBoundsFromAssumptions`) carrying a valueless symbol's
   assumption bounds as machine numbers WITH `lowerStrict`/
   `upperStrict`. It exists precisely because the type cannot say
   "strictly below 1" (introduced with the bounded-inverse conversion,
   2026-08-25).
3. **`typeExcludesValue`** — the `provably*` helpers read a
   hand-declared exclusion (`(real<0..1>) & !0 & !1`) as strictness at
   a closed endpoint, so authors CAN spell open intervals today, but
   only as intersections, and nothing produces them automatically.

Three channels means three chances to disagree and a permanent tax:
every new consumer must remember to consult `facts.bounds` between the
literal channel and the type channel. The fix is to let the TYPE say
it — for the class of facts a type CAN say (see §3.4 for the class it
cannot).

## 2. The syntax

Proposed spellings (the user's, 2026-08-28): an angle marker on the
excluded endpoint —

| Spelling | Meaning |
| --- | --- |
| `real<0<..>` | x > 0 (lower bound open, unbounded above) |
| `real<0..<3>` | 0 ≤ x < 3 (upper bound open) |
| `real<0<..<3>` | 0 < x < 3 (both open) |
| `real<0..3>` | 0 ≤ x ≤ 3 (unchanged) |

The grammar facts, verified empirically against the current parser:

- Every proposed form is a HARD ERROR today, so no existing type
  string changes meaning. `real<5>` (a possible future singleton
  spelling) also errors today, and stays reachable: after the lower
  bound, `>` followed by `..` is the open marker, `>` followed by
  anything else remains available.
- `<`/`>` are single-character tokens in the type lexer (verified:
  `list<integer<0..>>` parses with no `>>`-splitting machinery), so
  the lexer needs no bracket surgery.
- **Marker adjacency is lexically MANDATORY.** The markers are
  compound LEXER tokens (`..<`, and per the §6 ruling `>` -before-`..`
  or `<`-before-`..`), so `real<0 > .. < 3>` is a parse error
  everywhere, not just in some contexts. This is what keeps the
  character-level scanner (next bullet) and the token-level parser in
  agreement: both recognize exactly the adjacent character pairs.
- **The one real breakage is outside the parser**: `scanToClauseComma`
  (`common/type/parse.ts:579`), the character-level bracket-depth scan
  that splits `where`-clause bounds BEFORE parsing, counts every raw
  `<`/`>`. A `>` marker decrements depth (the following clause comma
  is missed), a `<` marker increments it (the scan runs away). The fix
  has precedent in the same function, which already skips `->`: skip
  the marker character pairs without a depth change. Cost by §6
  ruling: the `0>..` spelling needs TWO cases (`>` before `..`, `<`
  after `..`); the `0<..` alternative needs ONE (`<` adjacent to `..`;
  `>` stays purely a bracket). The vscode-epsil TextMate grammar needs
  the same awareness for highlighting (cosmetic).

Marker-direction alternative, for the §6 ruling: `..<3` reads as the
chained inequality "x < 3" (Swift's `..<`). Read the same way, `0>..`
says "0 > x" — the wrong direction; the inequality-consistent lower
marker is `0<..` ("0 < x"), giving `real<0<..<3>`. The user's `0>..`
has a different, also-coherent reading — the marker flips the bracket
outward, away from the excluded endpoint — and keeps the two markers
visually distinct. Both parse cleanly.

## 3. Representation and algebra

### 3.1 AST

The `numeric` node gains two optional flags:

```ts
{ kind: 'numeric', type: tier, lower?: number, upper?: number,
  lowerOpen?: boolean, upperOpen?: boolean }
```

A flag is meaningful only when its bound exists (an absent bound is
already "unbounded"; `lowerOpen` without `lower` is malformed and the
parser cannot produce it). Serialization mirrors the chosen markers.
Endpoint EQUALITY for every rule below is numeric double equality with
`-0` normalized to `0` at construction (`makeNumericRange`), so `-0`
and `0` are one endpoint.

### 3.2 One canonical spelling — the normal form

`real<0<..>` and `(real<0..>) & !0` denote the same set. Two spellings
that stay distinct would force every consumer to normalize — so the
REDUCER (`reduceType`) rewrites intersections into the open range. The
normal form is defined so reduction is ORDER-INDEPENDENT and
IDEMPOTENT over an intersection with any number of members:

- For each `!k` member whose `k` equals a CLOSED endpoint of a range
  member, set that endpoint's open flag and drop the `!k`. The rule
  fires against partially-open nodes too, so it COMPOSES:
  `(real<0..1>) & !0 & !1` reaches `real<0<..<1>` whichever exclusion
  is met first (worked example; this exact spelling is live today —
  `type-handler-parity.test.ts` declares `w01` with it).
- A `!k` whose `k` equals an ALREADY-OPEN endpoint is redundant: drop
  it.
- A `!k` whose `k` lies OUTSIDE the range is vacuous: drop it (this is
  today's behavior for such intersections, restated).
- A `!k` strictly INSIDE the range stays an intersection member —
  there is no range spelling for an interior exclusion (out of scope).
- `positiveRangeType`/`negativeRangeType` BUILD open ranges directly,
  and the `NOT_ZERO_TYPE` intersection retires from those two
  constructors.

**Empty and degenerate ranges.** The open syntax can spell empty sets;
they normalize to the lattice bottom `never`:

- Equal endpoints with EITHER flag open (`real<0<..0>`,
  `real<0..<0>`): empty → `never`.
- Endpoint exclusion of a singleton (`real<5..5> & !5`): empty →
  `never`.
- `lower > upper` remains a PARSE error, exactly as today.
- `never` then behaves as it already does in subtype/join/meet; no new
  rules needed there.

**Integer tiers have no open endpoints in the normal form.** Over a
discrete tier, `integer<0<..>` and `integer<1..>` are the same set,
and `integer<0<..<1>` is empty. Canonicalization NORMALIZES open
integer bounds away: an open lower bound `k` becomes the closed
`floor(k) + 1` (an open upper bound `k` the closed `ceil(k) − 1`),
non-integral closed bounds tighten inward to the nearest integer as
they effectively do today, and a range emptied by the normalization is
`never`. The open markers stay ACCEPTED by the parser on integer tiers
(so the assume refinement can emit uniformly) but never survive to the
canonical form — which also spares every integer-tier consumer from
openness cases entirely. (`rational` and `real` tiers are dense; they
keep their flags.)

**Migration and compatibility.** This canonicalization changes the
SERIALIZED spelling of every positive/negative range: pinned
`(finite_real<0..>) & !0` strings become `finite_real<0<..>`-form. Two
commitments make that safe: the OLD spelling remains parseable
indefinitely (it parses as the intersection and immediately reduces to
the open range, so type strings stored outside this repo keep
working), and the full-suite blast radius plus snapshot count is
measured and surfaced for approval BEFORE landing, per the snapshot
policy — the respelling is mechanical, but the approval of its size is
the user's.

### 3.3 The consumer sweep

Every numeric-range consumer gains open-endpoint cases. The sweep
list, with the rule each applies:

- `isSubtype`, range-vs-range branch (`subtype.ts:1916` region):
  interval inclusion with strictness — at a shared endpoint, closed ⊄
  open, open ⊂ closed.
- `isSubtype`, VALUE-vs-range branch (`subtype.ts:1889` region — a
  distinct code path the naive sweep misses): a literal `v` inhabits a
  ranged type only when it satisfies the possibly-strict bound
  (`v > lower` when `lowerOpen`, not `v ≥ lower`). Without this, the
  value type `0` still tests as a subtype of `real<0<..>`.
- `meetNumericRanges` + `makeNumericRange` (`reduce.ts:643/:673` — the
  function that actually intersects two range nodes): tighter endpoint
  wins; at EQUAL endpoints, OPEN wins (the meet of "x ≥ 0" and
  "x > 0" is "x > 0"). An emptied meet is `never` (§3.2).
- The union/hull READER — `intervalOfType`'s `union` arm in
  `numerics/interval-arithmetic.ts` (plus its intersection arm, the
  meet mirror: open wins on ties). NOTE, from the review: the general
  lattice `widen()` (`subtype.ts`) does NOT hull numeric ranges today
  — `widen(real<0..5>, real<3..10>)` answers bare `real` — and this
  design does NOT change that. The hull-with-openness rule ("an
  endpoint of the hull is open only if every member contributing that
  exact endpoint is open") applies to the READER only.
- `negateNumericType`: reflect bounds AND flags.
- `stripNumericRanges`: unchanged (drops the whole decoration, flags
  included).
- `signOfType`: `lower === 0 && lowerOpen` proves `positive` directly
  (today that needs the intersection walk).
- `typeExcludesValue`: reads `lowerOpen` at `k` exactly as it reads
  `& !k` today; the intersection path stays for interior exclusions.
- `widenValueTypes` (§4.3 walker): flags ride the range node through
  unchanged (ranges already pass).
- The `provably*` comparison helpers — the truth tables, so nothing is
  left to reconstruction. With `B = typeBounds(x)` extended to carry
  the flags, for a machine constant `k`:
  - `provablyGreater(x, k)` ⇔ `B.lo > k`, OR `B.lo === k && B.loOpen`.
  - `provablyGreaterEq(x, k)` ⇔ `B.lo ≥ k` (openness irrelevant).
  - `provablyLess`/`provablyLessEq`: mirrors.
  - `provablyDiffers(x, k)` ⇔ `k` outside `[B.lo, B.hi]`, or at an
    OPEN endpoint equal to `k` (subsumes today's strict-at-`k` read of
    `facts.bounds` and the `!k` walk).
  - Range-vs-range (`x < y`): `x.hi < y.lo`, or `x.hi === y.lo` with
    EITHER touching endpoint open. `≤`: `x.hi ≤ y.lo` (flags
    irrelevant). An empty (`never`) side proves everything vacuously —
    unchanged from how `never` behaves today.
- The interval kernel: §3.5.

### 3.4 The assume refinement emits open bounds — and what retires

`ce.assume(x > k)` currently refines the type to `real<k..>` (plus
`& !0` only when `k = 0`) and records the strict `k` in the fact index
for `facts.bounds` to carry. With open bounds it refines to
`real<k<..>` for EVERY machine `k`.

**What retires — scoped precisely (review correction).** The type
becomes the single channel for SYMBOL-SELF magnitude bounds — the
class where a symbol's own type can carry the fact. It cannot become
the single channel for everything, because two consumer classes are
about facts a symbol's type CANNOT express:

- **Part-subject assumptions** — `assume(Re(s) > 1)`,
  `assume(Abs(z) < 2)`: a symbol's type describes the WHOLE value, not
  a derived part, and `assume.ts` already deliberately skips type
  refinement for part-bearing propositions (the `containsPartTerm`
  guard). These keep the assumption index and
  `getInequalityBoundsFromAssumptions` (whose `Subject` includes the
  `re`/`im`/`abs`/`arg` part extractors) exactly as today.
- **Expression-level ordering consumers** — the strict-ordering block
  in `boxed-expression/compare.ts`, the assumption-pattern queries in
  `engine-assumptions.ts` (B2/B2b), `library/relational-operator.ts`,
  `library/complex.ts`: they query assumptions about expressions, not
  a symbol's refined type, and continue to read the index.

What is deleted, then, is exactly: the DESCRIPTOR field
`facts.bounds`, its `lowerStrict`/`upperStrict` plumbing through
`operand-descriptor.ts`, the `describe()` wiring that populates it
from `getInequalityBoundsFromAssumptions`, and the `provably*`
helpers' consultation of it — replaced by the §3.3 truth tables over
the flagged `typeBounds`. The producer function and the fact index
STAY, serving the two classes above. Exit criterion (review item):
zero remaining references to the descriptor field and its strictness
members anywhere in `src/` (repo-wide grep, not just the named
files), every descriptor constructor updated, typecheck clean, a
named regression test per former consumer, and the withholding re-run
(the §5.7 method) showing the flags as the only live channel for the
symbol-self class.

**The direction-blind rounding fix rides along**: recording an
assumption bound today canonicalizes the bound value first, so
`assume(x > 1 − 10⁻³⁰)` stores the bound `1` — a lower bound rounded
UP, which over-proves in every consumer (open ROADMAP residue of the
bounded-inverse round). The refinement must round a machine-projected
bound OUTWARD by direction (lower bounds down, upper bounds up, one
ulp when inexact — `nextDown`/`nextUp` and the exactness test exist),
sound for closed and open flags alike. An outward-ROUNDED bound also
demotes its open flag to closed: the strict fact was about the
original endpoint, and the moved bound is no longer that endpoint
(same demotion rule as the kernel's, §3.5).

### 3.5 The interval kernel learns openness — attainability, per operation

`Interval` gains `loOpen`/`hiOpen`. The governing question for a
computed extreme value `v` is ATTAINABILITY: **the bound is closed iff
some attained input combination produces exactly `v`; it is open iff
no attained combination does.** Exactness of the endpoint arithmetic
(which the kernel's TwoSum/Dekker machinery already detects) is a
NECESSARY gate — a bound that was ulp-stepped or coarsened has moved
strictly outward, is no longer the true extreme, and is always CLOSED
(claiming openness at a value the set never reaches would be a
stronger claim than the mathematics supports; closed is the sound
demotion). Among exactly-computed bounds, attainability decides, and
it is operation-specific (review corrections — the naive
"open if either input is open" OR-rule is UNSOUND for
multiplication):

- **ADD**: each side has ONE candidate (`a.lo + b.lo` / `a.hi +
  b.hi`), attained iff both endpoints are attained → the bound is
  open iff EITHER input endpoint is open. (`x > 2, y > 3` →
  `x + y > 5`, exactly.)
- **MUL, non-zero corner**: a corner `x₀·y₀` with both factors
  nonzero is attained iff both endpoints are attained → open iff
  either is open.
- **MUL, zero corner — the critical case**: a corner where a factor
  endpoint is exactly `0` yields `0` for EVERY point of the other
  operand, not just its corner. So if the zero endpoint is CLOSED,
  the value `0` is attained regardless of the other factor's flags —
  the corner is CLOSED (`[0, 5] closed at 0, times (2, 3) open`: the
  product's infimum 0 IS attained at x = 0; claiming `> 0` would be
  false). If the zero endpoint is OPEN, that corner never attains 0
  and stays open.
- **MUL, ties across corners**: the extreme may be reached by SEVERAL
  corners with the same numeric value (and, per the previous rule,
  with different attainability). The result flag is the OR of
  attainability over ALL corners reaching the extreme value — a
  closed tie wins. Implementation note: the current corner loop picks
  extremes with strict `<`/`>`, so the openness tracking must
  re-check value-equal corners, not keep the iteration order's
  survivor.
- **Even `powInterval` and `absInterval`, zero-crossing arms**: the
  lower bound `0` comes from an INTERIOR point of the operand
  (`lo < 0 < hi`), which is always attained whatever the operand's
  endpoint flags — unconditionally CLOSED.
- **Monotone `powInterval` arms** (odd; even on a one-signed
  interval): single candidate per side — openness carries iff the
  contributing endpoint is open (and the computation was exact).
- `intervalToRange` writes the flags; `intervalOfType` reads them
  (its union/intersection arms per §3.3).

With these rules, `assume(x > 2); assume(y > 3)` gives `x + y` the
type `real<5<..>` — strictly greater, as the mathematics says.

## 4. What this retires or fixes, concretely

- The descriptor `facts.bounds` channel for symbol-self bounds (the
  fact index itself stays, scoped to what types cannot say — §3.4).
- The `k = 0`-only asymmetry of the assume refinement.
- The direction-blind assumption-bound rounding (§3.4).
- Open-domain proofs from the type alone:
  `assume(0 < v && v < 1); Artanh(v)` types `finite_real` without the
  fact index.

## 5. Testing

- Round-trip pins for every marker combination, including negative and
  exponent-form bounds (`real<-1.5<..<-1.4>`, `real<0..<1e-10>`),
  spaced-marker REJECTION (`real<0 > ..>` errors — §2 adjacency), and
  the `where`-clause scanner cases (`T: real<0<..>, U: integer`).
- Reducer normal form: the composed two-exclusion case
  `(real<0..1>) & !0 & !1` → `real<0<..<1>` in both member orders;
  redundant and outside exclusions dropped; empties → `never`
  (`real<0<..0>`, `real<5..5> & !5`); integer-tier normalization
  (`integer<0<..>` → `integer<1..>`, `integer<0<..<1>` → `never`).
- Algebra matrix: subtype (BOTH branches — range-vs-range and
  value-vs-range), meet, hull-reader, negate over shared endpoints
  with all four open/closed combinations.
- The `provably*` truth tables of §3.3, row by row, including the
  shared-endpoint strict cases and `provablyDiffers` at an open
  endpoint.
- The assume → type → `provably*` chain for strict bounds at nonzero
  endpoints (the `Artanh(v)` open-domain case, today only provable via
  `facts.bounds` — pinned in `inverse-trig-domain-type.test.ts`), and
  the part-subject NON-migration (`assume(Re(s) > 1)` still answers
  through the index — a regression pin per §3.4 consumer).
- The withholding re-run for the descriptor-field retirement, plus the
  repo-wide zero-references grep as a test-time assertion.
- Kernel ENDPOINT-ATTAINABILITY tests (review item — sampling strictly
  inside operands cannot catch a false-open claim): for every
  operation and flag combination, assert the claimed-open bound is
  never attained and the claimed-closed bound is attained by a
  concrete input pair; include the closed-zero mul corner, a
  tied-corner mul case, the interior-zero even-power/abs pins, and the
  stepped-bound demotion pins (exact / inward-rounded / stepped).
- Display blast radius: full suite + snapshot count for the
  `& !0` → open-range respelling, surfaced for approval before
  landing (§3.2).

## 6. Questions that need a ruling

**Question 1 — the lower-bound marker: `0>..` or `0<..`?**
Both parse cleanly. `real<0<..<3>` (your proposal) reads as brackets
flipped outward from the excluded endpoints and keeps the two markers
visually distinct; `real<0<..<3>` reads as the chained inequality
`0 < x < 3` and makes `>` purely a bracket. Cost difference (per the
review): the scanner fix needs two cases for `0>..`, one for `0<..` —
a few lines either way. If no ruling: implementation blocks on the
lexer, parser, and serializer.

**Question 2 — is the open range the canonical spelling?**
Recommend YES, with the §3.2 normal form (composition,
order-independence, empties → `never`, integer normalization) and the
compatibility commitments (old spellings parse forever; blast radius
approved before landing). Saying no keeps the pins but forces every
consumer to normalize forever — the three-channel problem in a new
shape.

**Question 3 — does the interval kernel carry openness in this round?**
Recommend YES, per §3.5's attainability rules — they are now fully
specified, including the multiplication corner cases the naive rule
got wrong. Saying no defers `real<5<..>` sums to a follow-up; the
grammar/algebra half still stands alone.

**Question 4 — does the descriptor `facts.bounds` retire in this
round?** Recommend YES with the §3.4 scoping: the descriptor field and
the `provably*` consultation go; the fact index and
`getInequalityBoundsFromAssumptions` STAY for part-subjects and the
expression-level ordering consumers (`compare.ts`,
`engine-assumptions.ts`, `relational-operator.ts`, `complex.ts`),
which types cannot serve. Saying no ships the grammar with the
descriptor double-bookkeeping still live.

## 7. Out of scope

- Interior exclusions (`& !k` for `k` strictly inside a range) — they
  keep the intersection spelling; no range syntax exists for them.
- Part-subject assumption bounds (`Re(s) > 1`) migrating anywhere —
  they CANNOT move to the type channel (§3.4); their channel stays.
- Making the general lattice `widen()` hull numeric ranges — it
  collapses them to the bare tier today and continues to (§3.3).
- Singleton spellings (`real<5>`) — the grammar keeps the door open
  (§2), nothing here claims it.
- `Divide`/negative-exponent intervals — still deferred with the
  lattice flip's pole story.
- Open bounds in `list<n>` dimensions or any non-numeric `<…>` form.

## 8. Provenance

Closes the second half of ROADMAP "Ranged types: interval arithmetic
and open bounds". Builds on: the interval kernel and its exactness
detection (`numerics/interval-arithmetic.ts`, shipped 2026-08-27), the
bounded-inverse round's `facts.bounds` and `typeExcludesValue`
(2026-08-25, the strictness trap this design removes for symbol-self
bounds), and the Phase 1 finite-by-default lattice (2026-08-28). The
grammar analysis (§2) was verified empirically on 2026-08-28; the
`scanToClauseComma` fix precedent is its existing `->` handling.
Revision 2 follows the dual spec review of 2026-08-28 (both legs'
findings incorporated; the two critical corrections are the §3.5
multiplication attainability rules and the §3.4 retirement scoping).
