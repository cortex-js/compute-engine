# Boolean value types: predicates that prove a constant say so in their type

Status: IMPLEMENTED 2026-08-29 (rulings 2026-08-29; see the note at the end of §2 on the corrected guard count) — design for
ROADMAP "Boolean value types — RULED 2026-08-27 (O10)". Rulings: O10
(2026-08-27) — string literals keep `string`; boolean VALUE types are
wanted, for derived results, not for the `True`/`False` constants; and
the three §6 questions, RULED by the user 2026-08-29: (1) boolean value
types survive every HANDLER-SIDE boundary while ASSIGNMENT keeps
widening to `boolean` (the stale-proof refinement of the earlier
"survive storage" ruling, §3.2); (2) the first-round producer set as
proposed in §3.1; (3) a symbol DECLARED `boolean` keeps `boolean` when
assigned a `true`-typed value.

Revision 2 incorporates the Claude leg of the dual spec review
(2026-08-29; the Codex leg had produced nothing after 16 minutes and the
revision proceeded single-legged — its findings, if any arrive, go into
a revision 3) and the measurements it prompted: the `Equal` rule is
restated in terms of literal VALUES read through one helper and gated
against NaN/absence (§3.1); the storage rule is made precise —
handler-side boundaries keep value types, ASSIGNMENT keeps widening —
which is what makes a stored claim stale-proof (§3.2); the compiler
section is reframed around what is actually new (§3.3); absence and
collection gating are stated for the handlers themselves (§3.1); the
operand-vs-operand comparison is named as new code (§2); the guard
count is given with its query (§2).

## 1. What this is, in one example

Today every predicate claims the bare type `boolean`, however much it
knows:

- `1 < 2` — type `boolean`, although it is a constant.
- `Equal(a, a)` — type `boolean`, although it is `True` for every `a`.
- `g > 1` under `assume(g > 2)` — type `boolean`, although the assumption
  settles it (and `evaluate()` already answers `True`).
- `IsPrime(7)` — type `boolean`.

The compiler's `If` lowering therefore emits a ternary (or a
`selection` for an elementwise condition) for every one of them, and
`And`/`Or` chains keep every operand. This plan lets a predicate's TYPE
HANDLER claim the value type `true` or `false` when it can prove the
verdict from the operands' TYPES and FACTS — never by evaluating — and
lets the compiler's `If`/`And`/`Or`/`Not` lowering read that claim to
drop dead branches and operands. `1 < 2` types `true`; `Equal(a, a)`
types `true`; `g > 1` under `assume(g > 2)` types `true`;
`If(1 < 2, x, y)` compiles to `x`.

## 2. Code facts that shape the design

Verified empirically 2026-08-29:

- **The value types exist already.** `parseType('true')` is a value node;
  `true <: boolean` holds and `boolean <: true` does not. Nothing in the
  lattice, the parser or the serializer needs to change.
- **The storage machinery already keeps them.** `widenValueTypes` treats
  string and boolean value nodes as LEAVES ("no handler manufactures
  them"), and the `_literalType`-gated strip at the storage boundaries
  (`solveArm`, `receiverType`, `storedCellType`, the function-literal
  signature strip) only fires for NUMBER literals. So "survive storage"
  is the machinery's current behavior; this plan does not touch a
  boundary. What it must do is DOCUMENT that this is now deliberate
  (the walker comment's reason — "no handler manufactures them" — stops
  being true) and pin it.
- **The boolean literals have no literal type.** `ce.box(true).type` is
  `boolean`, `_literalType` is `undefined`. Per O10 this stays so: a
  literal's identity is already visible to every consumer, and giving
  `True` the type `true` would only churn every predicate's storage
  contract for nothing. The value type is a HANDLER CLAIM, like `Abs`'s
  range.
- **Predicates fold at evaluate but not in the type.** `1 < 2`,
  `Equal(a, a)`, `g > 1` (assumed), `IsPrime(7)` all EVALUATE to `True`
  today; their types stay `boolean`. The evaluated literal's type is also
  `boolean` (previous point) — so the soundness harness must judge a
  proven `true` claim against the evaluated VALUE, exactly as it judges
  numeric enclosures (`type-soundness.test.ts` already does this for
  numbers).
- **The bounds reader exists; the operand-vs-operand comparison is NEW
  code.** The descriptor helpers `provablyLess`/`…Greater`/`…Equals`/
  `…Differs` (`library/type-handlers-types.ts`) compare ONE operand to a
  machine CONSTANT, reading a literal's value, a type's bounds and
  openness, and the sign facts. `Less(x, y)` over two ranged symbols
  needs a range-vs-range disjointness test with open endpoints — the
  same rule the open-bounds plan §3.3 gives for the subtype relation,
  but not yet written as a comparison. `typeBounds`/`intervalOfType` is
  reusable for it; the comparison itself is this plan's work.
- **Literal values come in two spellings.** `1`, `1.0` and `1/1` all
  carry the value type `1`; but `0.5` is a value node while `1/2` is the
  rational SINGLETON RANGE `rational<0.5..0.5>` (ruling O9). A rule that
  compares value NODES structurally would decline `Equal(0.5, 1/2)`
  (safe, but a lost proof) — so literal values are read through
  `operandLiteralValue`, which already unifies both spellings, and
  compared as numbers.
- **The compiler already folds CLOSED predicates, but never removes a
  dead branch.** Measured: `If(1 < 2, x, y)` compiles to
  `((true) ? (_.x) : (_.y))` — the condition constant-folds (the compiler
  evaluates a closed subtree) yet the ternary and BOTH branches are
  emitted; `Not(1 < 2)` folds to `false`; and the non-closed
  `If(Equal(a, a), x, y)` compiles to a runtime
  `Math.abs((_.a) - (_.a)) <= 1e-10` test. So what this plan adds is (1)
  proofs for NON-closed predicates (`Equal(a, a)`, comparisons settled by
  an assumption or a declared range), which no evaluation can fold, and
  (2) BRANCH ELIMINATION on any constant condition, closed or proven.
  The `If` lowering (`base-compiler.ts`, `h === 'If'`) asks
  `target.selection` first, then emits the ternary; `And`/`Or`/`Not`
  lower through one helper (~6555) with a "dominant" value per head.
- **Type-keyed `boolean` guards — CORRECTED at implementation time.**
  The first count (49 sites, 30 of them string comparisons) was wrong:
  most `=== 'boolean'` hits are JavaScript `typeof x === 'boolean'`
  checks on runtime values, not on type nodes. The genuine type-string
  sites are four: `sum-representation.ts` (the compile bucket
  classifier), `multi-clause.ts` (`enumerateFiniteDomain`), and two
  `case 'boolean':` arms in `base-compiler.ts` bucket switches that emit
  `typeof … === 'boolean'` on the target — the last two read the bucket
  the classifier already answered, so teaching the classifier the value
  node covers them. The `matches('boolean')` calls keep working unchanged
  because `true <: boolean`.

## 3. The mechanism

### 3.1 Which handlers claim, and from what

A predicate's type handler claims `true`/`false` ONLY from type-channel
and fact-channel proofs — the O7 purity doctrine: no evaluation, no
value peeking beyond a literal's own value type. The first-round
producers, each with its proof source:

| Head | Claims `true` when | Claims `false` when |
| --- | --- | --- |
| `Less`/`Greater`/`LessEqual`/`GreaterEqual` | the operands' intervals are DISJOINT in the claimed order (`a.hi < b.lo`, or equal with an open touching endpoint — the range-vs-range rule of the open-bounds plan §3.3) | disjoint in the opposite order, or equal-closed for the strict heads |
| `Equal` | (a) both operands are the SAME symbol AND its type is NaN-free and absence-free (`intervalOfType(type) !== undefined` and no `missing` member) — `NaN ≠ NaN`, and `Equal(a, a)` over a `Missing` is `Missing`, so "structural" is NOT "for any value"; (b) both are number literals whose VALUES are equal, read through `operandLiteralValue` (never by comparing type NODES: `True` and `False` both type bare `boolean`, and two large integers share one coarse range) | the intervals are disjoint (open endpoints per the open-bounds rule); or two number literals with different values |
| `NotEqual` | the mirror | the mirror |
| `IsPrime`/`IsComposite`/`IsEven`/`IsOdd` (number-theory heads over a LITERAL) | the literal's value decides | likewise |
| `And`/`Or`/`Not`/`Xor` | the operands' claims decide by the truth table (`And` with any `false` → `false`; all `true` → `true`; `Not` flips) | |
| `Element(x, S)` with a literal set and a literal `x` | membership of the value | non-membership |

Everything else stays `boolean`. A claim that cannot be proven from
these sources stays `boolean` — `boolean` remains the sound generic
answer, and a wrong `true` is the one failure mode this plan must never
have. The comparison rules reuse `intervalOfType` / `typeBounds`
directly, so they inherit the open-endpoint semantics already pinned.

**Layering (states the order for the HANDLERS, not only the compiler):**
every producer's proof runs strictly AFTER its existing absence
computation (`relationalAbsenceType` / `comparisonResultType` in
`relational-operator.ts`, which already answer `missing` or
`boolean | missing` for an operand that may be absent) has returned a
definite `boolean`, and after collection-shape detection
(`isPossiblyCollectionTyped`) has ruled out a non-scalar (elementwise)
result. The value claim is layered ONTO those functions' `boolean`
answer, never computed ahead of them: `Less(x, 1)` with
`x: real<0..> | missing` stays `boolean | missing`, and `Less` over a
list stays whatever the elementwise typing gives.

Two further consequences of this layering: an expression whose type is
exactly `true` is therefore provably present and scalar, so the
compiler's absence guard in §3.3 is belt-and-suspenders, not a live
path; and every proof reads TYPES only, so a proven claim can never
depend on evaluation order or effects (§3.3 on purity).

The one subtle case: **NaN.** `Less(NaN, 1)` evaluates to `False`, and
so does `Less(1, NaN)`; comparisons involving an operand that may be NaN
must NOT claim `false` from "not less" reasoning — an operand whose type
admits NaN (`number`, `nan`) reads as no interval (`intervalOfType`
answers `undefined`), so the comparison handlers decline automatically.
Pinned.

### 3.2 Storage: survive at the handler boundaries; assignment keeps widening

The review raised the decisive question: a `true` STORED from a
predicate over an ASSUMED symbol — `assume(g > 2); b := (g > 1)` — has
no rewind when `forget(g)` or a scope pop retracts the assumption
(`rewindAssumedTypeWrites` in `engine-assumptions.ts` revisits only the
symbol the assumption is ABOUT). So "survive storage" must say WHICH
storage. Measured 2026-08-29:

- **Assignment already widens, for numbers AND booleans.** `h := g + 1`
  under `assume(g > 2)` stores `h: real` although the expression types
  `real<3<..>`; `b := (g > 1)` stores `b: boolean`; after `forget(g)`
  both are unchanged and sound. Assignment's inference path widens
  independently of `widenValueTypes`.
- **The handler-side boundaries keep boolean value nodes today**:
  `widenValueTypes` treats them as leaves, and the `_literalType`-gated
  strips (`solveArm`, `receiverType`, `storedCellType`, the
  function-literal signature) fire only for number literals.

The rule, then — a REFINEMENT of the 2026-08-29 ruling that keeps its
intent (a proven `true` is not thrown away by the type machinery) while
making it stale-proof: boolean value types SURVIVE every handler-side
boundary — a solved type variable (`identity(Equal(a,a))` types `true`),
a function-literal signature (`() -> true`), a dictionary/record cell, a
protocol receiver — and ASSIGNMENT KEEPS WIDENING to `boolean`, exactly
as it widens a numeric interval to its tier. A symbol never stores a
claim that an assumption could later retract, so no dependency-tracking
rewind is needed and `forget()` stays as it is. (A declared `b: boolean`
assigned a `true`-typed value is admitted and keeps `boolean` — the
declaration is the contract, per the 2026-08-18 inference ruling.) This
is §6 question 3.

Pins: a `true` surviving each handler boundary; `b := (g > 1)` under an
assumption storing `boolean` and staying sound after `forget(g)`;
`widenValueTypes`'s boolean-leaf comment updated (the "no handler
manufactures them" rationale is retired).

### 3.3 The compiler consumes the claim

In the compile targets, before the existing lowering:

- `If(c, t, f)`: if `c.type` is the value type `true`, compile `t`
  alone; if `false`, compile `f` alone. Placed before `target.selection`
  only as the cheaper order — a constant condition is scalar, so the
  elementwise hook would return `null` anyway; the ordering is not
  load-bearing. This is what turns today's `((true) ? (_.x) : (_.y))`
  into `_.x`.
- `And`/`Or`: drop operands whose type is the identity for the head
  (`true` for `And`, `false` for `Or`); if any operand's type is the
  dominant value (`false` for `And`, `true` for `Or`), the whole node
  compiles to that constant. The existing absence/`NaN` rule for these
  heads (~6555) must run FIRST: an operand that may be ABSENT is not a
  droppable constant even when its present-value type is `true`.
- `Not`: a `true`/`false` operand compiles to the constant.
- `Which`: a clause whose condition types `false` is dropped; a clause
  typing `true` truncates the clause list after it. (Same rule as `If`,
  applied per clause.)

The interpreter is unchanged: `evaluate()` already folds these. The
claim changes only what the COMPILER emits — which is the O10
motivation — plus what `.type` reports.

**Purity of a dropped operand.** Dropping a clause or operand means its
expression is never emitted. That is sound here because every producer
head's operands are numeric/boolean expressions the compiler treats as
pure (the compile targets have no effectful lowering for them), and
because a claim is a TYPE fact that holds independently of evaluation
order. An operand the effects model marks impure must not be dropped;
the compiler's existing effect check (the skippability gate is
oracle-aware) runs before elimination, and the plan pins one case.

### 3.4 What must NOT change

- No boolean LITERAL gains a literal type (§2, O10).
- No predicate handler evaluates anything (O7 purity).
- `boolean` stays the answer whenever the proof is missing.
- The `Missing`/absence contract of the logic heads is untouched
  (§3.3, the absence rule runs first).

## 4. Soundness and testing

- **Handler proofs vs evaluation**: for every producer head and a battery
  of operand shapes (literals, assumed symbols, open/closed ranges, a
  NaN-admitting operand, a `never` operand), assert: a `true`/`false`
  claim agrees with `evaluate()` when the expression is closed, and a
  non-closed expression's claim is never contradicted by any sample of
  its free variables inside their declared ranges (the attainability
  style of `open-bounds.test.ts`). The failure mode to hunt is a claim
  where evaluation gives the other value.
- **The soundness grid** (`type-soundness.test.ts`) gains the predicate
  heads; a proven `true` against an evaluated literal `True` (whose own
  type is bare `boolean`) is judged by VALUE, as numeric enclosures are.
- **Required negative cases for `Equal`**: `Equal(True, False)` and
  `Equal("a", "b")` must NOT claim `true` (both operands type the same
  bare primitive); two large integers sharing one coarse range must
  not; `Equal(a, a)` with `a: number` (NaN-admitting) or
  `a: real | missing` must stay `boolean`; `Equal(0.5, 1/2)` SHOULD
  claim `true` (the two literal spellings).
- **Storage**: one pin per handler boundary (solve, function literal,
  dictionary cell, receiver) that the value type survives; assignment
  widening pinned with the `assume`/`forget` scenario.
- **Compiler**: `If(1 < 2, x, y)` compiles to `x`'s code with no
  ternary; `And(1 < 2, p)` compiles to `p`; `And(1 > 2, p)` to `false`;
  a `Which` with a `false` clause drops it; an `If` over an operand that
  may be absent keeps its existing lowering; GLSL and interval-js targets
  behave the same as JS (the "FOUR statement-list paths" trap: verify on
  every target).
- **Guard sweep**: DONE — the two genuine type-string sites
  (`sum-representation.ts` bucket, `multi-clause.ts` domain enumeration)
  accept a boolean value node; see the corrected count in §2.
- **Blast radius**: full suite + snapshot count before landing. The
  `.type` of every constant predicate changes from `boolean` to
  `true`/`false`, so error messages and type-inference pins will move;
  measure and surface.

## 5. Out of scope

- A literal type for `True`/`False` (O10).
- String value types (O10: strings keep `string`).
- Proofs that need evaluation or symbolic simplification
  (`sin²x + cos²x = 1` → `true` is `isIdenticallyEqual`'s job).
- Claims through collection/broadcast cells (`Less` over lists).
- Changing what `evaluate()` produces — it already folds.

## 6. Questions that need a ruling

**Question 1 — the storage rule for a DECLARED `boolean` symbol
assigned a `true`-typed value.** §3.2 proposes: keep the declared
`boolean` (the declaration is the contract; assigned symbols are
checked, never rewritten). The alternative — narrow the symbol to
`true` — would make an explicit annotation weaker than an inferred
one, inverting the 2026-08-18 inference ruling. Recommend: keep
`boolean`. If no ruling: implementation blocks at the assignment path.

**Question 3 — refine the storage ruling as §3.2 states it?** The
2026-08-29 ruling said boolean value types survive storage. §3.2
proposes: survive every HANDLER-SIDE boundary, but ASSIGNMENT keeps
widening to `boolean` (as it already widens numeric intervals), because
a stored claim over an assumed symbol would otherwise go stale with no
rewind path. Saying yes keeps the machinery as measured today and needs
no `forget()` changes. Saying "assignment keeps the value type too"
requires a dependency-tracking rewind in `forget()`/scope pop (a
separate design) or accepting documented staleness. Recommend: yes.

**Question 2 — first-round producer set.** Proposed: the comparison
heads, `Equal`/`NotEqual`, the four literal number-theory predicates,
the logic connectives, and literal `Element`. Saying "comparisons and
connectives only" is a smaller, safer first landing (the number-theory
and `Element` producers add literal-only proofs with little compiler
payoff); saying "add `IsInteger`/`IsReal`-style type predicates" pulls
in the type-test family, which reads `matches()` and is a natural next
round rather than this one. Recommend: as proposed.

## 7. Provenance

Ruling O10 in `docs/plans/2026-08-22-type-handlers-on-types.md` §6
(2026-08-27); the storage-survival ruling 2026-08-29. Reuses the
interval kernel's reader and the open-bounds comparison rules
(`docs/plans/2026-08-28-open-bounds-in-ranged-types.md` §3.3) for the
comparison proofs, and the compile targets' existing `If`/`Which`/
`And`/`Or` lowering sites (`compilation/base-compiler.ts`). The guard
count was re-measured and corrected at implementation (§2); the "zero
producers today" fact was measured 2026-08-29.
