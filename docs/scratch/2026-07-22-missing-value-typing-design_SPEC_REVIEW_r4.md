# Spec review — `docs/plans/2026-07-22-missing-value-typing-design.md` (revision 5)

Dual review (Claude + Codex/gpt-5.6 high reasoning), merged and deduplicated.

**20 findings — 1 critical, 10 high, 8 medium, 1 low · 1 flagged by both reviewers · 0 open questions**

(Findings 19–20 were restored from the raw Codex output during merge
reconciliation; they are appended at the end of the High section to keep the
existing cross-reference numbering stable.)

Per-review-round note: this is revision 5, past three prior rounds (§10 resolution
maps). Findings below are NEW or challenge a §10 resolution as defective (stated
explicitly where that's the case) — nothing here re-reports an adequately-resolved
round-1/2/3 finding.

---

## Critical

**1. [critical] [Both] [consistency] I6 vs §3.C/§9 — a `number | missing` cell's absence representation directly contradicts itself**

Location: §2 I6; §3.C aggregate table; §9 test-vector appendix.

I6 states: "The value domain of a position is a function of its type — a
`number`-typed (or `number | missing`) cell is numeric (absence = `NaN`)." Read
literally, any position typed `number | missing` must represent absence as
`NaN`, never the `Missing` symbol.

But the spec's own normative vectors put the literal `Missing` symbol in exactly
such a position: `Max(1, Missing, 3) : number | missing = Missing` (§9), not
`NaN`. The static type is `number | missing` (a numeric-domain type per I6), yet
the interpreter result is the object-domain symbol. Nothing in §3.C's aggregate
rule or §3.D's discharge section states the distinction between "an
out-of-band/computed hole in a numeric position" (I6 says → `NaN`) and "a
literal `Missing` operand propagated through arithmetic/aggregation into a
numeric-typed position" (test vectors keep it as `Missing`). An implementer
following I6 as written would "fix" the `Max` vector to return `NaN` and break
it, or conversely mis-implement `marker(T)` absorption for `At`.

This is also the substance of round-1's **Q3 ("Missing in a numeric slot")**,
which the prior review (`…_SPEC_REVIEW.md`) recorded as open/acknowledged, not
resolved — and revision 5's §7 no longer lists Q3 at all (see finding 18).

*Suggestion:* Narrow I6 to state precisely where the type-directed
representation choice applies (out-of-band access via `marker(T)`, and
compiled targets) versus where a symbolically-propagated literal `Missing`
legitimately persists inside a `number | missing`-typed position at the
interpreter level. State explicitly that `IsMissing`/`Coalesce` are
representation-agnostic *because* both forms can co-occur under the same
static type — and add a test vector that exercises both forms in the same
position to lock in the distinction.

---

## High

**2. [high] [Codex] [completeness] §3.C `marker(T)` is not total over unions/edge inputs**

Location: §3.C `marker(T)` definition.

The three cases (`T <: number` / `T` settled non-numeric / `T` indeterminate)
don't cover a mixed settled union like `number | missing` or `number | string`
— neither a subtype of `number` nor "indeterminate," and calling it "settled
non-numeric" directly conflicts with I6 treating `number | missing` as numeric
(see finding 1). Also undefined: empty tuple/record joins, and `At(Missing, i)`
/ `elt(xs)` when `xs` itself has no element type available.

*Suggestion:* Define `marker` recursively/exhaustively for settled unions
(splitting numeric vs. non-numeric arms), and for empty joins / `never` /
absent-base cases. State how a mixed-domain result (part numeric, part object)
is represented and how compiled `IsMissing` tests both simultaneously. Also
state the compiled ABI rule: does a compiled function parameter typed
`number | missing` accept the `Missing` value, or must the caller encode it as
`NaN`? (`Number.isNaN(undefined)` is `false`, so an unconverted `Missing`
crossing the compile boundary silently disagrees with the interpreter.)

**3. [high] [Codex] [architecture-fit] §3.F's "every `propagate` operator is numeric" premise is false for `Add`/`Negate`, which the spec itself declares `propagate`**

Location: §3.F ("Every `propagate` operator is numeric (params `<: number`)");
§5 ("`Add`/`Negate` declare `'propagate'`" because their "`value`-typed
signatures would otherwise default to `pass-through`").

Verified against source: `Add`'s signature in
`src/compute-engine/library/arithmetic.ts:309` is `'(value+) -> value'`, not
number-only — `value` also covers tuples, colors, matrices, etc. (per
`docs/plans/2026-07-20-tensor-unification-design.md` §D2, which documents
color/tuple arithmetic). §3.F's justification for removing the runtime
propagation guard entirely rests on "every propagate operator is numeric," but
§5 explicitly contradicts this by declaring `Add`/`Negate` (value-typed, i.e.
capable of non-numeric operands) as `propagate`. Without a guard, a
`Missing`/absence in a non-numeric-domain operand of `Add`/`Negate` has no
defined runtime or compiled behavior — `NaN`-native float propagation doesn't
apply to a color or tuple operand.

*Suggestion:* Either restrict `propagate`'s no-guard optimization to
effectively-scalar-numeric signatures and specify a distinct policy for
`Add`/`Negate` over non-numeric `value` operands, or keep an object-domain
propagation guard for `propagate` definitions whose parameters admit
non-numeric cells.

**4. [high] [Codex] [architecture-fit] The two-axis target capability (`numericAbsence: 'nan' // always`) doesn't hold for the interval or GPU targets**

Location: §3.F "Target capability" block.

Verified against source:
`src/compute-engine/compilation/interval-javascript-target.ts` represents a
number as an interval object and NaN as `{ lo: NaN, hi: NaN }` (lines
711–712/831–832) — a raw `Number.isNaN(x)` test (as §3.F prescribes for
`IsMissing`) doesn't apply to an interval value.
`src/compute-engine/compilation/gpu-target.ts` documents (lines 341–353) that
neither GLSL nor WGSL has a `NaN` identifier at all, and ships dedicated
`gpuNaN()`/`gpuNaNFor()` helpers with per-target bit-cast/const-eval
workarounds specifically because a naive `NaN` literal doesn't compile. §3.F's
`numericAbsence: 'nan' // always` flattens all of this into a single constant
tag with no target-specific expression, `isMissing`, or `coalesce` operation —
the "no guard, native NaN" parity claim is unimplementable as written for these
two targets.

*Suggestion:* Make `numericAbsence` a real per-target capability object (at
least `literal`, `isMissing(x)`, `coalesce(x,d)`), and either specify its
interval/GPU implementations (reusing the existing `gpuNaN`/interval-object
machinery) or explicitly declare those targets as compile-error for any
`missing`-carrying numeric position.

**5. [high] [Codex] [consistency] P1 is declared "independently landable" while being knowingly I5-unsound until P3 — and §10's resolution of round-3 finding 11 doesn't actually close this**

Location: §6 P1/P3 and "Each phase is independently landable"; §10 row 11.

P1 changes `At`/component runtime results to yield `Missing`/`NaN`, but the
computed result-type handlers (§3.C) that make the *static type* honestly
reflect that possibility are deferred to P3. Per I5 ("a static type must not
claim a position is non-missing when the runtime can produce absence there"),
a program built on P1 alone (before P2/P3 land) can have `At` return `Missing`
at runtime while its static type still claims non-missing — a direct I5
violation, not a temporary implementation detail, if P1 is genuinely
independently landable/shippable as the phasing table claims. §10's resolution
of round-3 finding 11 — "§6: I5-sound for access operators at P3" — only
restates *when* soundness is reached; it doesn't reconcile that gap with the
"independently landable" claim for P1 and P2. The resolution acknowledges the
gap rather than resolving it.

*Suggestion:* Either state plainly that P1/P2 are not independently shippable
to production on their own (only P0 through P3 together restore I5-soundness
for access operators, so "independently landable" should be qualified to mean
"independently reviewable/mergeable, not independently releasable"), or pull
the result-type handler into P1 so no landed state is I5-unsound.

**6. [high] [Codex] [completeness] The access-mode matrix leaves existing gather/deferred-index runtime behavior (mask, out-of-range drop, mixed-type indices) undecided**

Location: §3.C access-mode matrix; §4 "Reverses gather stays narrow".

Existing runtime code (`src/compute-engine/library/collections.ts`,
`compilation/javascript-target.ts`) drops out-of-range entries from an
integer-gather, treats an empty index collection as a boolean mask, accepts a
scalar boolean for deferred broadcast, and leaves mixed/non-integer index
collections inert. The new `list<T | marker(T)>` typing (reversing "gather
stays narrow") implies gathers now *preserve* holes instead of dropping
entries, but no runtime rule states this explicitly, nor does the matrix cover
empty-index, mixed-index, or scalar-boolean-index modes. This is exactly the
kind of behavior an interpreter and a compiler implementer could resolve
differently without a normative rule.

*Suggestion:* Add explicit runtime + typing rows for out-of-range gathers
(does length now match the index collection, holes included?), empty index
collections, mixed boolean/integer index collections, and scalar boolean
indices; state explicitly whether gather length-preservation is itself a
breaking change (it appears to be, on top of the ones already listed in §5).

**7. [high] [Codex] [completeness] `Coalesce`'s "first non-absent operand" rule doesn't define the all-absent or undecidable-operand cases**

Location: §3.D `Coalesce` semantics and result type.

Unspecified: `Coalesce(Missing, Missing)` (all operands absent — is the last
`Missing` returned, or something else?); `Coalesce(NaN, Missing)` (mixed-domain
all-absent); and what happens when an intermediate operand's absence can't be
statically decided (e.g., a symbolic value). The result-type rule ("every
operand but the last contributes its stripped type; the last its full type")
implies the final operand is returned as-is when everything upstream is
absent, but this is never stated as a runtime rule, and "totality (`… -> T`)
requires an arm-free final operand" is not actually total under I6, since
`number` already includes the possibility of `NaN` (an absent value) per I6's
own definition — so even an "arm-free" final `number` operand doesn't
guarantee a present result.

*Suggestion:* State the runtime result for an all-absent `Coalesce` chain
explicitly (return the last operand unchanged, presumably still absent), state
what happens with an undecidable intermediate operand, and either qualify or
drop the "totality" claim given I6's NaN-is-absence subtlety.

**8. [high] [Codex] [consistency] `At`'s parameter-strip rule contradicts itself between §3.A and §3.C**

Location: §3.A ("`At` strips its *value* parameter, not the *index*") vs. §3.C
("A `handle` `At` strips **both** parameters, so both validate; both are
**absorbing**") and §8/§9 (`At(xs, Missing)` must validate and absorb).

These are directly incompatible: if only the value parameter strips (§3.A),
then `At(xs, Missing)` — a literal `Missing` in the *index* position — fails
`Tᵢ° <: Pᵢ` validation (the index parameter's declared type presumably doesn't
include `missing`), contradicting §3.C's/§9's requirement that it validates
and returns the absorbing marker. Beyond the direct contradiction, the spec
never defines a concrete mechanism (a strip-mask field, a per-parameter
`handle` contract) for how "parameter-specific" stripping is declared and
consumed by validation, typing, and runtime uniformly — it's asserted in prose
only.

*Suggestion:* Resolve to one policy (§3.C/§9 evidently intend "both strip");
fix §3.A's wording, and define a concrete per-parameter strip declaration
(e.g. a bitmask or set of stripped parameter positions on the `handle`
definition) that validation/typing/runtime can all consult identically (per
I5's "one declaration, all consumers agree").

**9. [high] [Claude] [completeness] The runtime value for an indeterminate-element out-of-band access is never stated — not even in the normative test vector for it**

Location: §3.C "Indeterminate normalization"; §9 test-vector appendix
(`At(list, 9) [elt unknown] : unknown (normalized, I5-sound)`).

§10's resolution of round-1 finding 13 settles only the *static type* of this
case (normalizes to `unknown`). The corresponding §9 test vector states the
type but — unlike every neighboring vector in the same table (`At(list<number>,
9) : number = NaN`, `At(list<string>, 9) : string | missing = Missing`, etc.)
— gives **no `=` runtime value**. Since §3.F branches compile-time behavior
hard on numeric-vs-object domain per position, and an `unknown`-typed position
is neither, there is no stated decision procedure for what the interpreter (or
a compile target) actually produces here: `NaN`, always `Missing`, or a
probe-actual-elements heuristic (as the reverted implementation's
`absenceMarker()` reportedly did).

*Suggestion:* State the runtime (and compile-time, if reachable) decision
procedure for an indeterminate element type explicitly — e.g., default to
`Missing` (object domain) since the type is not `<: number` — and add the `=`
value to the §9 vector.

**19. [high] [Codex] [feasibility] Chained `At`'s "carry the marker verbatim" rule is not representable when the marker is numeric (absorbed into `number`)**

Location: §3.C chained-`At` rule ("preserve any already-present marker arm
unchanged") and `At(Missing, i) → marker(elt(xs))`.

Two representability gaps. (a) `At(Missing, i)` is defined as
`marker(elt(xs))`, but a `Missing` base has no element type — `elt(xs)` is
undefined for it. (b) The chained rule requires preserving "an
already-present marker arm," but a *numeric* access marker is absorbed into
`number` (I1/§3.C) — after a step whose result is numeric, there is no
distinguishable marker arm left in the plain-union representation to
"preserve": an absent `NaN` marker and a valid numeric element have the same
type. The branch-wise algorithm as stated therefore cannot do what it claims
for chains that peel through a numeric layer; the union representation lacks
the provenance the rule assumes.

*Suggestion:* Define the missing-base result explicitly (including its assumed
element domain), and for chains either (i) make absorption value-level — any
absent intermediate (Missing or NaN, provenance-irrelevant per I6)
short-circuits the rest of the chain, with the result marker recomputed from
the final step's element domain — or (ii) carry an internal typing state
distinct from the normalized public union, or (iii) declare chains that peel
to a numeric scalar invalid. Option (i) is the only one that needs no new
type machinery.

**20. [high] [Codex] [completeness] Kleene `Equal` is unspecified for `NaN` operands, and its compile lowering diverges from native `==` on every target**

Location: §3.D `Equal` rule; §3.F discharge lowering.

The design treats `NaN` as absence with provenance irrelevant (I6), and
`Equal` as Kleene over absence — but only `Equal(x, Missing)` gets a value
rule. Undefined: `Equal(NaN, 1)`, `Equal(NaN, NaN)` — Kleene absence says
`Missing` (R: `NaN == 1` is `NA`), native float `==` says `false`. No stated
representation for an absent boolean (boolean is object-domain, so
`Missing`/`undefined`?), and no lowering rule: existing JS/GPU/interval
targets lower `Equal` to native or target equality, which yields `false`, not
absence — a silent interpreter/compiled divergence on every target unless the
lowering adds an `isnan` guard (possible on JS/Python, not reliably on GPU).

*Suggestion:* Specify the scalar and broadcast truth tables for `Missing`/NaN
operand combinations, the absent-boolean representation per domain, and the
per-target lowering (JS: `(Number.isNaN(a)||Number.isNaN(b)) ? undefined :
a===b` or documented native-`==` divergence; GPU: fail closed). Add
interpreter/JS/GPU acceptance or compile-error vectors.

---

## Medium

**10. [medium] [Claude] [completeness] No empty-input rule for the order-selection aggregate row**

Location: §3.C aggregates table.

Only the `Mean`-family row states "a `NaN` datum or empty input is `NaN`."
The `Max`/`Min`/`Supremum`/`Infimum`/`Mode` row has no equivalent note, and
`Quartiles`' "same condition" doesn't disambiguate which rule it inherits.
Neither §8 nor §9 tests `Max([])`/`Min([])` — a basic case any test suite
hits immediately.

*Suggestion:* Add an explicit empty-input rule to the order-statistic row
(pick `NaN`, `Missing`, or an error, and justify it), disambiguate
`Quartiles`, and add a `Max([])` vector to §8/§9.

**11. [medium] [Claude] [completeness] Binary `propagate` op over two collection operands with a per-cell (not whole-operand) Missing isn't connected to the tensor-unification packing fallback**

Location: §3.B worked examples (`Add(Missing, matrix)`); §3.E runtime section.

§3.B's static typing correctly handles a collection operand whose *element*
type carries `| missing`. §3.E's runtime section, however, only demonstrates
per-element re-entry for a *unary* op over a flat list
(`Sin([1,Missing,3])`). It never states the runtime rule for a binary
`propagate` op (`Add`/`Multiply`) over two same-shaped collection operands
where one *cell* is `Missing`, nor connects to
`docs/plans/2026-07-20-tensor-unification-design.md` §D2.3/D3 (line 141: any
cell "non-numeric/non-boolean by type kind... falls back to generic
elementwise broadcast"), where a `missing`-kind cell must demote the whole
operand out of packed numeric kernels before per-cell propagation can even
run. §4 ("Interactions with prior ratified decisions") never mentions this
integration point, and this is the territory of round-1 finding 16, which §10
doesn't list as resolved.

*Suggestion:* Add a runtime rule and worked example for a binary `propagate`
op over two collection operands with a per-cell Missing, and cite the D2.3
packing-fallback dependency explicitly.

**12. [medium] [Claude] [feasibility] "Proxy operand carrying the stripped type" (§3.B step 3) has no implementation mechanism**

Location: §3.B step 3 ("Handlers receive proxy operands carrying `Tᵢ°`; value-
level inspection is unaffected — stripping only touches the static type").

The current implementation invokes an operator's `type` handler with the real
operand expressions (verified at
`src/compute-engine/boxed-expression/boxed-function.ts:2277`,
`def.type(expr.ops, {engine})`) — there's no existing notion of a "proxy
operand" that reports a stripped `.type` while leaving value-level behavior
untouched. Given `BoxedExpression`'s generation-tracked `_type` caching (per
tensor-unification design §D2.3a) and this repo's documented caution around
that cache, this is a core algorithmic step left as an unimplementable black
box.

*Suggestion:* Specify the proxy mechanism concretely (a thin type-override
wrapper satisfying only the interface surface handlers touch, or a scoped
save/override/restore of `_type` around the handler call) and confirm it's
compatible with `_type`'s generation-tracked cache.

**13. [medium] [Codex] [edge-case] Nested cells whose type is exactly `missing` have no `missingness` classification**

Location: §3.0 cell table; §3.B `missingness(T)` definition.

`missingness(T)` is `definite` only for "a whole scalar operand... exactly
`missing`," and `possible` only for a cell that is `A | missing` (a union). A
*nested* cell that is exactly `missing` with no union arm — e.g. an element of
`list<missing>` — matches neither rule. Left undefined, step 1's strip
("bare-`missing` cell → `never`") could silently turn `Sin(list<missing>)`
into `list<never>`, losing the missingness signal, while §3.0's table
separately implies any exactly-`missing` cell collapses the *whole* result to
`missing` — which would incorrectly discard collection shape.

*Suggestion:* Define nested exact-`missing` cells as contributing
possible/definite missingness distinct from a whole-operand absent scalar, and
add a `Sin(list<missing>)` type + runtime vector.

**14. [medium] [Codex] [completeness] `Equal`'s cell-aware typing is asserted, not actually specified for broadcast/list shapes — and §10 marks it resolved**

Location: §3.D `Equal` ("...including list-broadcast modes"); §10 row 6.

Because `Equal` is `handle`, §3.B's generic reattachment is explicitly skipped
for it (step 4 note), so `Equal`'s own custom handler must do the cell-aware
work. But §3.D gives it one sentence with no algorithm for how the handler
preserves list rank/shape, distinguishes whole-operand definite absence from
per-cell possible absence, or combines two differently-shaped collection
operands per the broadcast rules in
`docs/plans/2026-07-20-tensor-unification-design.md` §D6. There's no
collection-valued `Equal` test in §8/§9 either. §10 marks round-3 finding 6
("`Equal` no result-type rule") resolved by pointing at this same sentence —
the resolution doesn't actually supply the missing algorithm.

*Suggestion:* Give `Equal` a concrete scalar-to-shaped typing rule and add
normative vectors for scalar-vs-list, `list<number|missing>`-vs-list, nested/
dimensioned lists, and mismatched-shape broadcast.

**15. [medium] [Codex] [consistency] `reject` degrades to undefined pass-through-like behavior in non-strict mode**

Location: §3.A resolved-behavior table (`reject` → "strips? no"); §3.E ("`reject`
follows the existing strict/non-strict split: strict → Error; non-strict →
validation skipped").

If non-strict mode skips validation entirely, a `Missing` operand reaches a
`reject`-declared operator's ordinary handler unchanged — a handler that was
never designed to receive `Missing` (since the declaration says it should be
rejected). The spec doesn't state what that handler does with an unexpected
`Missing` (crash, silently propagate it incorrectly, produce a type-unsound
result) — it's simply undefined, and this reading makes `reject` behaviorally
equivalent to `pass-through` in non-strict mode despite §3.A distinguishing
them.

*Suggestion:* Either give `reject` its own runtime gate that fires regardless
of strict mode (since it's meant to be a hard invariant, not a validation
nicety), or explicitly document that non-strict `reject` is unsound/undefined
and scope that limitation, with a corresponding non-strict test vector.

**16. [medium] [Codex] [completeness] `Nothing`-erasure boundaries and positional exceptions aren't enumerated**

Location: §2 I2; §6 P1 ("collection literals + lazy iteration").

The spec doesn't enumerate which collection constructors erase `Nothing`
(List/Set/Tuple/dictionary/record?), whether erasure applies only to a literal
`Nothing` symbol or also to an operand that *evaluates* to `Nothing`, or which
lazy operators (`Map`, etc.) filter a yielded `Nothing`. It also doesn't
address positional structures where erasure would corrupt arity — e.g.
dictionary key/value pairs (the reverted reference implementation reportedly
needed a special non-erasing dictionary-pair path per the auto-memory note on
`nothing-vs-missing-markers`).

*Suggestion:* Enumerate erasure per constructor (List/Set/Tuple/
dictionary-record), state whether evaluated-to-`Nothing` erases as well as
literal `Nothing`, and explicitly carve out non-erasing positional exceptions
(dictionary/record key-value pairs) with a route-parity test.

**17. [medium] [Codex] [architecture-fit] The stated implementation baseline (`f50e1619`) is stale relative to current HEAD, and the P0 byte-for-byte parity oracle doesn't distinguish that drift from real regressions**

Location: Header; §5; §8 ("P0 parity: a Missing/Nothing-free program evaluates
identically to `f50e1619`").

Verified: current HEAD (`915c1a33`) is 18 commits ahead of `f50e1619`
(`git rev-list --count f50e1619..HEAD` = 18), and those commits include
unrelated feature work (Missing-free changes: RandomList JS compile, Join
behavior, async eval scope, rubi Euler-substitution lever, simplify
sign-inference). Requiring exact byte-for-byte match against `f50e1619`, as
literally stated, would flag all of that legitimate intervening work as
"churn," or tempt an implementer to accidentally regress it to match the
stale baseline.

*Suggestion:* Distinguish the historical *feature* baseline (the commit this
design conceptually reverted to) from the actual implementation base (current
main at time of landing). State that P0 parity is measured against the
implementation-start HEAD, not literally `f50e1619`, and reserve direct
`f50e1619` comparison for surfaces known unaffected by the intervening
commits.

---

## Low

**18. [low] [Claude] [question] Q3 ("Missing in a numeric slot") silently dropped from §7 without a resolution citation**

Location: §7 Open questions.

The round-1 review recorded an open "Q3 — Missing in a numeric slot" question
(prior review file, line 88: "Q3 (Missing in a numeric slot)"). Revision 5's
§7 lists Q2 and Q-E1 as still-open and gives explicit "Decided: Qx → …"
citations for Q-C1/Q-F1/Q-F2/Q4/D-Q1 — but Q3 appears in neither list. Given
finding 1 shows the underlying tension (a literal `Missing` entering a
`number`-typed position) is still live in the current text, Q3 looks
omitted rather than actually settled.

*Suggestion:* Either add a "Decided: Q3 → …" citation to the section that
settles it (if finding 1 is resolved, that resolution IS the Q3 answer — cite
it), or restore Q3 to the open list.

---

## Suggested revisions (themed)

- **Theme A — I6/marker domain representation is self-contradictory:**
  findings 1, 2, 18 (18 is a paper-trail symptom of the same root issue).
  Fix these together: pin down exactly when a numeric-domain position holds
  `NaN` vs. the literal `Missing` symbol, and make `marker(T)` total.
- **Theme B — §3.F "propagate is always numeric, no guard needed" oversimplifies:**
  findings 3, 4. Both stem from treating `propagate`/numeric-domain compilation
  as float-only; `Add`/`Negate` (value-typed) and the interval/GPU targets
  break that assumption.
- **Theme C — `At`/access semantics gaps:** findings 6, 8, 9, 19. All concern
  under- or self-contradictorily specified `At` behavior (strip contradiction,
  gather/mask modes, indeterminate-element runtime value, chained-marker
  representability).
- **Theme D — discharge & aggregate edge cases:** findings 7, 10, 14, 20
  (`Coalesce` all-absent, empty-input aggregates, `Equal` shape-awareness and
  NaN truth table / lowering).
- **Theme E — Missing/Nothing classification edge cases:** findings 13, 16
  (nested exact-`missing` cells, `Nothing`-erasure boundaries).
- **Standalone:** 5 (phasing/landability), 11 (tensor-packing integration),
  12 (proxy-operand feasibility), 15 (`reject` non-strict), 17 (stale baseline).

---

## Proposed resolutions (for revision 6)

Drafted by the merger, not the reviewers — these are design proposals for the
author to ratify or reject, one per theme. R1 is the load-bearing one; most of
the rest follow from it.

### R1 — Domain normalization at value construction (resolves 1, 2, 13, 18; defuses half of 20)

Adopt one rule and state it as the sharpened I6: **an absent value is
normalized to its position's domain representation at the moment a result
value is constructed.** The `Missing` symbol never inhabits a numeric-domain
result cell; `NaN` never stands for absence in an object-domain cell.

- A `propagate` operator's result cells are numeric by construction, so
  absence flowing through one **becomes `NaN`**: `Sin(Missing) : number =
  NaN`, `Add(Missing, 1) = NaN`, `Max(1, Missing, 3) : number = NaN`,
  `Sin([1, Missing, 3]) = [Sin(1), NaN, Sin(3)] : list<number>`. (§9 vectors
  change accordingly.)
- Literal containers are not results — `List(1, Missing, 3)` keeps `Missing`
  as data (`list<integer | missing>`), preserving I3's motivation.
- `handle` results keep the §3.C `marker(T)` rule, which is already this rule
  (`number` absorbed / `missing` visible) — §3.C needs no change.

Consequences that pay for themselves:

- **§3.B collapses for `propagate`.** Since every propagate result cell is
  numeric, the reattach step is always absorption: result type = base type,
  no `| missing` arm, no definite/possible machinery on the propagate path.
  The definite/possible distinction survives only inside §3.C `handle`
  handlers, where it belongs. `Sin(list<missing>) : list<number> = [NaN, …]`
  (finding 13 resolved by construction).
- **`marker(T)` becomes total** by arm-splitting: `marker(A | B) =
  marker(A) ⊔ marker(B)`; `number | missing` can no longer *arise* as a
  propagate result type, and where it appears as declared data the union
  splits cleanly (finding 2). Empty joins / `never` → `missing`.
- **Compile parity is trivial** for numeric positions (NaN native, no guard),
  and the compiled ABI rule falls out: a numeric-domain parameter's absent
  value **is** `NaN` — the interpreter already normalized it, so nothing
  crosses the boundary as `Missing`.
- Q3 finally gets its "Decided:" line — this rule is the Q3 answer.

The alternative (keep `Missing` symbolically at the interpreter, weaken I6 to
out-of-band holes + compile only) preserves Julia-style `sin(missing) =
missing` aesthetics but leaves interpreter/compiled representation divergence
discharged only through `IsMissing`, and keeps all of the §3.B possible/
definite machinery alive. Not recommended.

### R2 — Guard-free is a property of the result cell's domain, not of the operator (resolves 3)

Replace "every `propagate` operator is numeric" with: a `propagate`
application compiles guard-free **iff every result cell is numeric-domain**
(true for all float/tensor/color cells — their components are numeric).
`Add`/`Negate` over `value`-typed operands: broadcast descends to cells; a
numeric cell gets `NaN`, a genuinely object-domain cell gets the runtime
object gate (interpreter) and fails closed under compilation. In practice
every current `Add` cell is numeric, so the compiled story is unchanged — the
spec text just stops overclaiming.

### R3 — Absence capability as target-supplied operations (resolves 4)

```
absence: {
  numeric: { make(): code, isAbsent(x): code, coalesce(x, d): code },
  object?: { nullLiteral, isAbsent(x), coalesce(x, d) },
}
```

- JS/Python: `NaN` / `Number.isNaN` / ternary; `undefined` / `None` for
  object.
- Interval target: `make` = the existing whole-interval-NaN object,
  `isAbsent` = `isnan(x.lo)` — reuses machinery already in
  `interval-javascript-target.ts`.
- GPU targets: `make` = existing `gpuNaN()`; declare `isAbsent` **only if**
  the target can guarantee `isnan` survives fast-math; otherwise omit it and
  `IsMissing`/`Coalesce` on that target are a compile error (fail closed —
  propagation still works natively, discharge doesn't).
- No `object` axis on GPU (booleans compile but *absent* booleans don't —
  fixes the "never compiles non-numeric" overclaim, since Kleene `Equal`
  results are object-domain).

### R4 — `At` semantics (resolves 6, 8, 9, 19)

- **Strip:** per-parameter strip set declared on the definition
  (`missingStrip: 'all' | number[]`); `At` declares `'all'`. Fix §3.A's
  "value parameter, not the index" sentence — §3.C's "both" is the intent.
  One declared field, consumed identically by validation, typing, runtime
  (I5).
- **Chains — value-level absorption, not type-level marker carrying.** Any
  absent intermediate (Missing *or* NaN, provenance-irrelevant per I6)
  short-circuits the remaining steps; the result is absence in the *final*
  position's domain. `At(Missing, i) = Missing`; `At(m, 9, 0)` with
  `m : list<list<number>>` → step 1 `Missing`, absorbed → final cell numeric
  → `NaN`. The type rule types each step independently (marker recomputed per
  step) — sound, and needs no provenance the union can't represent
  (finding 19's option i).
- **Gather is length-preserving** (this is the "reverses gather stays
  narrow" runtime half): `At(xs, [1, 9, 2])` has the index's length, holes in
  the element domain (`NaN`/`Missing`). Breaking — add to §5's list. Empty
  index list → empty list. Mask length mismatch → error (replaces silent
  prefix application). Scalar-boolean and mixed index collections: unchanged
  (inert), stated explicitly.
- **Indeterminate element type:** static type stays `unknown` (as decided);
  the *runtime* marker is value-directed — inspect the actual collection's
  element domain (all numeric → `NaN`, else `Missing`), which is what the
  reverted `absenceMarker()` did. Not compilable (no concrete type), so no
  compile rule needed. Add the `=` value to the §9 vector.

### R5 — Discharge and aggregate edges (resolves 7, 10, 14, 20)

- **`Coalesce` all-absent:** returns the last operand's value unchanged
  (still absent). An operand whose absence is undecidable (symbolic) leaves
  the tail unevaluated (`Coalesce` returns partially-applied, like any
  symbolic short-circuit). Reword "totality": an arm-free final operand
  guarantees an arm-free *type*, not a present value (NaN ∈ number).
- **Empty aggregates:** all 15 → `NaN` on empty input (`Quartiles` →
  `(NaN, NaN, NaN)`), matching the Mean-row rule; `Mode([])` = `NaN`. Add
  `Max([])` to §8/§9.
- **`Equal` truth table:** any absent operand (either domain) → `Missing`
  (Kleene; matches R where `NaN == 1` is `NA`). Note this means `Equal(NaN,
  NaN)` is `Missing`, not `False` — worth an explicit CHANGELOG callout.
  Broadcast: per-cell, shape per tensor-design §D6; result element type
  `boolean | missing` when any operand cell can be absent. Lowering: JS/
  Python emit the `isAbsent`-guarded form (`(isNaN(a)||isNaN(b)) ? undefined
  : a === b`); GPU: `Equal` over possibly-absent operands is a compile error
  (discharge with `Coalesce` first) — fail closed, consistent with R3.
- Add normative vectors: scalar-vs-list `Equal`, `list<number|missing>`
  `Equal`, `Equal(NaN, NaN)`, compiled JS `Equal` parity.

### R6 — Phasing: types travel with the runtime change (resolves 5)

Move the §3.C access-mode *type* rows for exactly the operators whose runtime
P1 changes (`At`, `First`/…, component/point accessors) **into P1**. The
general lift (§3.B) stays P2; aggregates, `Coalesce`/`IsMissing`, `Equal`
stay P3. Then every landed state is I5-sound and "independently landable"
is true without qualification.

### R7 — Standalone fixes

- **Proxy operands (12):** no proxy objects. Extend the type-handler context
  with `operandTypes?: readonly BoxedType[]`; the §3.B pipeline passes the
  stripped types there, and the handler-invocation shim consults the override
  before `ops[i].type`. No `_type` cache interaction.
- **`reject` non-strict (15):** `reject` is enforced by the same runtime gate
  that implements `propagate`/`handle` (behavior resolution), not by strict
  validation — it errors in both modes. §3.E's strict/non-strict sentence
  applies only to the *shape* of the error (Error expr vs. thrown), not to
  whether the gate fires.
- **Binary collection cells (11):** state that a `missing`-carrying cell type
  demotes packed numeric kernels to generic elementwise broadcast
  (tensor-design §D2.3), then the per-cell gate applies. Worked example under
  R1: `Add([1, Missing], [10, 20]) = [11, NaN] : list<number>`.
- **`Nothing` erasure table (16):** `List`/`Set`/`Sequence` splicing and lazy
  yields (e.g. a `Map` body producing `Nothing`) erase; erasure applies to an
  operand that *evaluates* to `Nothing`, not just the literal (route-parity
  test). `Tuple` erases like `List` (a constructor, not a fixed-arity type
  ascription). Dictionary/record: a `Nothing` **value** erases its entry; a
  `Nothing` key is an error; the key–value pair tuple itself is a non-erasing
  position (the reverted implementation's carve-out, now normative).
- **Baseline (17):** P0 parity is measured against the HEAD at implementation
  start; `f50e1619` is demoted to historical reference (the commit the
  *feature* work was reverted from).
