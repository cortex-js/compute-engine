# Elementwise `Which`/`If` over list-valued conditions

**Status: RATIFIED 2026-07-27 — R1–R4 (incl. R4 uniform-`NaN` and R4′) as
recommended, user-confirmed.**
**Date:** 2026-07-27 · **Trigger:** Tycho item 102.

## 1. Motivation

The 0.97.0 broadcast model made comparisons first-class elementwise
operations: with `n = [3,2,1,3]`, the engine answers `n == 3` →
`["True","False","False","True"]` (`list<boolean>`). But the engine's own
conditionals cannot consume the shape the engine just built — `Which` and
`If` over a list-valued condition stay unreduced. The lifted comparisons
manufacture `list<boolean>` values with exactly one natural consumer, and
that consumer refuses them. This is a composability gap *inside* the
ratified broadcast model, not a consumer-specific semantic.

Elementwise conditional selection is the standard array-language primitive:
NumPy `np.select`/`np.where`, Julia `ifelse.(…)`, R `ifelse()`. In Desmos it
is unavoidable — piecewise braces are the language's only conditional and
lists broadcast through everything, so any imported document combining a
piecewise with a list hits the gap (masking, classification, conditional
styling, simulation step rules).

**Witness (Tycho item 102, Game-of-Life step, document `2lzec8zwrz`):**
`S → {n=3: 1, n=2: S, 0}` over a 900-element board `S` and neighbour-count
list `n` — i.e. `Which(n==3, 1, n==2, S, True, 0)` must produce a 900-element
list: `1` where the count is 3, the old cell where it is 2, else `0`.

Tycho ships a ~100-line boundary lowering (`broadcastPiecewise`,
`tycho/src/graph-paper/actions/firing.ts`) with a plain-JS numeric fast path
added purely because forcing the engine's lazy broadcast `Map` (~8 µs per
element per condition — the item-103 drain floor) blew their 50 ms
interactive budget. They will retire it if CE adopts the semantics *and* the
native evaluation fits the budget.

## 2. Current behavior (probed 2026-07-27, bare engine)

| probe | result |
| --- | --- |
| `n == 3`, `n` a 4-list | `["True","False","False","True"]` — broadcasts |
| `Which(n==3, 1, n==2, S, True, 0)` | stays unreduced |
| `If(n==3, 1, 0)` | stays unreduced |
| `.type` of the witness | `finite_integer \| vector<finite_integer^4>` — union comes from the list-valued **arm**; with scalar arms the type is plain `finite_integer` (the handler does not represent the elementwise case at all) |
| scalar `Which` with no matching clause | the `Undefined` symbol |
| `If(False, 1)` (no else) | `Nothing` |
| `If(Missing, 1, 0)` | catchable error “The condition is absent…” (2026-07-24 ruling) |

## 3. Activation gate

The elementwise path activates iff, after evaluating conditions in clause
order, **at least one condition is an indexed collection whose cells are all
condition values** (`True` / `False` / `Missing`). Everything else is
untouched:

- All-scalar conditions → existing scalar semantics, bit-for-bit unchanged.
- A condition evaluating to a *symbolic* expression, or to a collection with
  any symbolic / non-boolean cell → the whole expression stays **inert**, as
  today. This preserves every existing `Which` *producer* (Solve validity
  guards, the B15 conditional-values adopters emit symbolic conditions and
  must keep round-tripping unreduced).
- Non-indexed collections (`Set`, …) and unknown-length participants follow
  the broadcast model's standing rules (not compared until known).
- The scalar typo path (`If(3, …)` spell-check throw) is unchanged — the
  gate never reinterprets a non-boolean scalar.

## 4. Rulings requested

### R1 — Selection semantics: first-match per element, scalars lift

Result length n = the common length of every list-valued participant.
Per position j, the selected clause is the first whose condition is `True`
at j (a scalar `True`/`False` condition lifts to every position). The output
cell is the selected arm's value at j: a scalar arm lifts; a list-valued arm
is indexed at j. This is `np.select`, and byte-for-byte what Tycho's
lowering implements. **Recommended: adopt.**

### R2 — Arm evaluation: at most once, whole, only if selected somewhere

Terminology: a clause is (condition, arm); "arm" is the VALUE expression
only. Conditions always evaluate first, fully — they compute selection and
are not governed by this ruling.

An arm is evaluated only if selection reaches it for ≥1 position, and then
at most once, **as a whole expression**. What R2 deliberately does NOT
promise is that cells at unselected positions are never *computed* — that
cannot be a guarantee, for a structural reason: "evaluate the arm at
position j only" is not an operation that exists. Obtaining it would
require syntactic per-position projection (`S → S[j]`), which is unsound —
a list symbol inside an arm does not always mean elementwise (`1/S`
projects; `Mean(S)` is a reducer consuming `S` whole; `S/Total(S)` needs
both readings of the same symbol; `f(S)` is undecidable unevaluated). The
only reliable lift-vs-index classifier is the SHAPE of the evaluated value
— the same values-not-syntax principle as the evaluate-ONCE rule.

The whole-arm contract is observably equivalent to masked evaluation in
almost all cases because CE's partial functions yield cell values, not
throws (`1/[2,0]` → `[1/2, ~oo]`; selection discards the `~oo`). The
differences are confined to: an arm whose whole evaluation throws
structurally (surfaced deliberately); impure cells (draw counts — the
randomness model's "evaluation consumes only what it needs" ruling blesses
skipping); and perf (eager whole-arm zip at ~2.2 µs/element beats
per-position lazy access at ~8 µs/element unless selection is very
sparse). The engine MAY skip computing unselected cells (e.g. when the
arm's value is a lazy view); the user may not rely on it. Guaranteed
per-position masked semantics stays expressible as
`Map(S, s ↦ If(s ≠ 0, 1/s, NaN))`, where the scalar `If` short-circuits
per element. **Recommended: adopt; document the contract in the operator
doc.**

### R3 — Length policy: strict, lifted regime

All list-valued participants — conditions AND selected list-valued arms —
must share one length; any mismatch is `incompatible-dimensions` via the
shared `broadcastLengthMismatch` check. Elementwise selection joins the
LIFTED regime of `docs/BROADCAST-MODEL.md` (it is an implicit broadcast the
user did not spell as pairing). Unbounded participant vs finite = mismatch;
unknown length = not compared. **Recommended: adopt — forced by the ratified
model; the alternative (shortest) is the truncation class the 0.97.0 ruling
eliminated.**

### R4 — The no-match cell (the one genuinely open choice)

When no clause matches at position j (no default clause):

- **(a) `NaN` — recommended.** Elementwise selection is a numeric-array
  operation; `NaN` is the position-preserving absent-value marker on the
  numeric path (nothing-vs-missing model), matches the 2026-07-24 stance
  that absence at runtime is a data state, matches Desmos, and keeps the
  result drainable by numeric consumers. Note the asymmetry it creates:
  scalar `Which` keeps answering the `Undefined` symbol.
- (b) `Undefined` per cell — symmetric with the scalar form, but poisons a
  numeric list with a symbolic cell; every downstream numeric drain then
  needs a discharge step.
- (c) `Missing` per cell — maximally explicit absence, same poisoning
  concern as (b), and `Missing` is Kleene in comparisons, which invites
  three-valued surprises downstream.

Whichever marker is ruled, it is **uniform — never type-directed**. A
"NaN if the arms are numeric, `Undefined` otherwise" rule was considered
and rejected: (1) it keys the *value* of an expression off declared/
inferred types, which are routinely far wider than runtime values — an arm
calling a `→ unknown`-declared helper would flip the marker, and
re-declaring a helper would change unrelated data; (2) the all-no-match
case (`Which(S != 0, "hot")` with `S` all zeros) evaluates no arm at all
under R2, so there are no runtime values to classify and the rule
degenerates to (1); (3) the no-match cell exists only when the author
omitted a default clause, and any specific marker is one explicit clause
away (`…, True, Missing`), which is better style regardless. The cost of
uniformity — a `NaN` cell widening a non-numeric list — is confined to
exactly the case (3) dissolves.

Sub-ruling R4′ — a `Missing` **condition** cell: per-cell application of the
scalar ruling — the output cell is the same catchable
"condition is absent" error expression the scalar form produces
(position-preserving; selection at other positions is unaffected).
Alternative: `NaN`, simpler but silently conflates "absent condition" with
"no match". **Recommended: error cell, for consistency with the ratified
scalar ruling.**

## 5. Scope

**In:** `Which` and `If` (same gap, same gate, one shared implementation) —
evaluate handlers and type handlers, `library/control-structures.ts`.
The type handler must answer `list<T>^n` (T = join of the reachable arms'
element types) when a condition is provably a boolean collection, replacing
today's blind scalar/union answers.

**Implementation constraint (perf, load-bearing):** the elementwise path
must materialize conditions and zip **eagerly in the handler** — never by
stacking lazy broadcast `Map`s. The item-103 profile puts the lazy-lambda
path at ~8 µs/element/condition (3 conditions × 900 elements ≈ 22 ms just
for conditions); an eager zip of materialized lists measured ~2 ms per 900
elements. Perf acceptance: the witness (3 clauses × 900) evaluates in ≤5 ms
on the reference machine, comfortably inside Tycho's 50 ms budget.

**Out (demand-gated follow-ups, record in ROADMAP):**
- Compiled lowering (`_SYS` selection helper). Tycho's firing path is
  interpreted, so the interpreter alone closes item 102; a compiled form
  joins the boolean-head-guard revisit already on the roadmap (item-86
  adjacency).
- `When` (a guard *carrier* with threading algebra, not a selector — its
  semantics are unrelated).
- Any change to scalar `Which`/`If` behavior, including the scalar no-match
  `Undefined` and the typo-path throw.

## 6. Interactions reviewed

- **Solve / B15 producers:** emit symbolic conditions → gate keeps them
  inert. No interaction.
- **Missing/Kleene rulings (2026-07-24):** R4′ extends the If-condition
  ruling per cell; comparisons stay Kleene over `Missing`, so a condition
  list can legitimately contain `Missing` cells.
- **`Nothing` erasure:** scalar `If(False, 1)` → `Nothing` is unchanged;
  the elementwise form never emits `Nothing` cells (positions must be
  preserved — R4 governs).
- **Broadcast model doc:** gains a short "selection" note under the lifted
  regime; `docs/BROADCAST-MODEL.md` pins list grows the new suite.
- **Lazy-operator trap:** `Which`/`If` are `lazy: true` heads — held
  operands arrive unbound on the box/parse routes. The handler must
  canonicalize held operands it consumes, and the suite must probe
  `ce.function(...)`, `ce.box(...)`, AND `ce.parse(...)` routes (standing
  route-parity discipline, cf. `find-fit.test.ts`).

## 7. Test plan

- GoL witness parity: CE result ≡ Tycho's `broadcastPiecewise` output on a
  non-trivial 900-cell board (and a small hand-checked 4-cell table).
- Route parity: box / parse / pre-boxed function routes agree.
- R1: scalar-condition lift, scalar-arm lift, list-arm indexing, first-match
  precedence order.
- R2: unselected arm not evaluated (probe with an arm that records
  evaluation); selected arm evaluated exactly once.
- R3: condition/condition, condition/arm, and arm/arm mismatches all
  `incompatible-dimensions`; infinite vs finite mismatch; unknown length
  stays inert.
- R4/R4′: no-default no-match cell; `Missing` condition cell; all-`False`
  conditions.
- Gate: symbolic condition stays inert (incl. a Solve-produced `Which`
  round-trip pin); non-boolean cell stays inert; scalar behavior
  byte-identical (existing suites are the pin).
- Type handler: `list<…>^n` narrowing; declared vs literal collection
  spellings (both `list<boolean>` and `indexed_collection<boolean>`).
- Perf smoke: witness ≤ 5 ms interpreted (measured with the box-microloop
  canary alongside).

## 8. Rollout

CHANGELOG `[Unreleased]` entry (behavior addition — previously-inert
expressions now reduce; no existing reduced result changes). Ledger reply to
Tycho: "adopted, semantics below; retire `broadcastPiecewise` once you
measure the native path inside your budget — the NaN no-match matches your
lowering" (or the R4 alternative if ruled differently). ROADMAP: remove
item-102 mention; add the compiled-lowering follow-up.
