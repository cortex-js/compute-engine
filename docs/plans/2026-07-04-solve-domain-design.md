# Solve over a Domain — Design

**Date:** 2026-07-04 · **Status:** Phases 1 & 2 IMPLEMENTED (same day) —
`boxed-expression/solve-domain.ts` + `solve-domain.test.ts` (46 tests).
Phase 2 notes vs. this design: Interval domains (§2.3) required no new code
(Phase 1's contains-filter already had endpoint semantics); root-family
expansion (§2.2) additionally recovers scaled-argument principal roots via a
linearizing substitution (`sin 2x`: the trig rules don't fire on scaled
arguments), capped at 1,000 members with degradation to principal roots;
the assumptions bridge (§2.4) filters at the outer `.solve()` boundary in
`boxed-function.ts` plus both solve-domain paths, testing assumption
expressions by substitution (not `verify()`). **Phase 3 (symbolic diophantine)
IMPLEMENTED (2026-07-04)** — `numerics/diophantine.ts` (pure bigint kernels) +
`boxed-expression/diophantine.ts` (recognition/boxing/dispatch) +
`solve-diophantine.test.ts` (19 tests); see the Phase 3 section at the end of
this document.
**Motivation:** the MathNet assessment (`docs/mathnet/`) identified
enumeration/finite-domain solving as the one genuine *capability* gap the
corpus exposed ("find all n ≤ 1000 such that …", Pell-style search). Agreed
direction: **extend `Solve`**, not a new `SolveWhen` head.

## Goal

```
Solve(x^2 - 5x + 6 = 0, x ∈ 1..1000)        → List(2, 3)
Solve(2^n ≡ 1 (mod 7), n ∈ 1..20)           → List(3, 6, 9, 12, 15, 18)
Solve(x^3 + y^3 = 1729, x ∈ 1..12, y ∈ 1..12) → List((1,12), (9,10), (10,9), (12,1))   [Phase 2]
```

Symbolic solve first; filter the roots to the domain. When the symbolic
solver comes up empty and the domain is finite and affordable, enumerate —
with a compiled predicate when possible, under the engine's deadline.

## API surface

### MathJSON

`Solve` becomes variadic: `Solve(expr, spec₁, spec₂, …)` where each *spec* is

- a **symbol** — exactly today's behavior (`Solve(eq, x)`), or
- an **`Element(symbol, collection)`** — unknown plus domain, or
- an **`Element(symbol, collection, condition)`** — with an extra boolean
  filter, mirroring the indexing-set convention `Sum`/`Product` already use
  (`INDEXING_SET_HEADS` includes `Element`;
  `definitions-arithmetic.ts:2024-2029` parses `n \in S, n>0` into exactly
  this shape).

Rationale for `Element` rather than a positional third "domain" argument:
it names which unknown each domain belongs to (no ambiguity once
multi-variable arrives), it reuses an existing canonicalization
(`sets.ts:627-714`), and it matches the big-operator indexing convention, so
the LaTeX story below comes for free.

### LaTeX

No new syntax needed. `\operatorname{Solve}(x^2=4,\; x \in \{1..10\})`
already produces `Element` + `Range` structurally: `\in` → `Element`
(`definitions-sets.ts:642`), `..`/`\ldots` → `Range`
(`definitions-core.ts:1286-1355`). Serialization of the extended form
round-trips through the same entries.

### String helper / method

`expr.solve(...)` keeps its current signature. The domain form is reached
through the operator (`ce.box(['Solve', eq, ['Element', 'n', range]])` or
parse). A convenience overload (`solve(unknown, domain)`) can come later; it
is sugar, not semantics.

## Library changes (`core.ts:898-920`)

- Signature `'(any, symbol) -> list'` → `'(any, any+) -> list'`; drop
  `checkArity(ce, ops, 2)` in favor of validating each spec in `canonical`:
  a spec that is neither a symbol nor `Element(symbol, collection[, cond])`
  becomes an `Error` operand. `Solve` **stays `lazy`** — the equation must
  not pre-evaluate (`core.ts:906`), and domain collections are lazy anyway
  (`Range` `isLazy`, `collections.ts:344`).
- `evaluate` routes: no domains → current path (`ops[0].solve(unknown)`,
  `core.ts:910-919`). With a domain → the pipeline below. Multi-spec with
  domains → Phase 2; until then, return unevaluated (inert), never a wrong
  answer.

## Univariate pipeline (Phase 1)

New module `src/compute-engine/boxed-expression/solve-domain.ts` (keep
`solve.ts`, already 2,446 lines, focused on the symbolic solver).

### 1. Type refinement from the domain

Before solving, refine the scratch unknown's type from the domain's element
type — `Range` of integers → `integer` (`collections.ts:311-319` computes
this), `Interval` → `real`. This slots into the existing mechanism:
`findUnivariateRoots` already declares the scratch `_x` with the unknown's
declared type (`solve.ts:1890-1891`) and `filterRootsByType`
(`solve.ts:2274-2295`) already drops non-integer roots for integer unknowns.
Net effect: `x ∈ 1..1000` automatically discards the non-integer root of a
quadratic before we even test membership.

### 2. Symbolic solve, then membership filter

Run `findUnivariateRoots` as today. For each surviving root `r`, test
`domain.contains(r)` (`Range.collection.contains`,
`collections.ts:355-386`, is tolerance- and step-aware). Kleene handling:

- `True` → keep; `False` → drop;
- `undefined` (symbolic root or symbolic bounds) → **keep**. Rationale:
  dropping would silently lose valid solutions; the contract is that
  membership filtering is best-effort exact, and an undecidable membership
  keeps the root (same conservative posture as `validateRoots`,
  `solve.ts:2226`). If a condition operand is present, apply it the same
  way (evaluate; keep on `True`/undefined, drop on `False`).

If the symbolic path produced **at least one root**, return the filtered
list — do *not* also enumerate. (A root family that symbolic solve reports
only by principal value — trig, congruences — is a known limitation, listed
under Phase 2.)

### 3. Enumeration fallback

Trigger: symbolic solve returned `null`/no roots, **and** the domain is
enumerable and affordable:

- `domain.count` (`collections.ts:345-353`) is finite and
  `≤ MAX_SOLVE_ENUMERATION` (new constant; propose `10^6` when a compiled
  predicate is available, `MAX_ITERATION` = 10,000 (`numeric.ts:40`) when
  interpreting). Over budget → return unevaluated, never partial.

Predicate construction — this is where the extension quietly becomes more
general than equation-solving:

- **`Equal(lhs, rhs)`** → compile `lhs - rhs` and accept candidates with
  `|f(x)| ≤ tolerance`, then **confirm exactly** (see below).
- **Any boolean-valued expression** (`Congruent`, `Divides`, `Less`, `And`
  of conditions…) → compile the predicate itself; accept on `true`. This
  makes `Solve(2^n ≡ 1 (mod 7), n ∈ 1..20)` work with zero extra machinery,
  and subsumes the `Filter(Range, pred)` idiom with solver ergonomics.

Mechanics, mirroring `Reduce` (`collections.ts:1039-1074`):

1. `const compiled = engine._compile(pred)` (`index.ts:602-606`; never
   throws — falls back to the interpreter with `success:false`).
2. If `compiled.calling === 'lambda' && compiled.run`, iterate
   `domain.iterator` (`collections.ts:388-409`) calling the compiled
   function; else substitute-and-evaluate per element (`applicable`-style),
   under the lower budget.
3. Interrupt discipline: `if ((++steps & 0x3ff) === 0)
   checkDeadline(ce._deadline)` (`interruptible.ts:33-40`; stride
   convention per its doc). A `CancellationError` propagates, as in
   `Sum` (`arithmetic.ts:2466-2476`).
4. **Exact confirmation stage:** every candidate that passes the compiled
   (float) sieve is re-checked by exact engine evaluation
   (substitute + `isEqual(0)` / boolean evaluate) before being reported —
   floats lie for large integers (`2^53`), and this mirrors what
   `validateRoots` already does for symbolic roots. The compiled pass is a
   sieve, not an oracle.

### 4. Result contract

Same shape as today: a `List` of bare root **values** (`core.ts:916-918`) —
the audit oracle (`benchmarks/audit/solve.ts:74-100`) depends on
value-shaped results. Enumeration yields ascending domain order; the
symbolic path keeps solver order (unchanged today). Empty result is
`List()`; *inability* to decide (over budget, non-enumerable domain +
unsolved) returns the expression **unevaluated** — the standard CE
convention for "no closed form", and distinguishable from "no solutions".

## Phase 2 (separate PR-sized chunks, in value order)

1. **Multi-variable enumeration**: `Solve(eq, x ∈ D₁, y ∈ D₂)` over the
   cartesian product, budget = `∏ count ≤ MAX_SOLVE_ENUMERATION`; result:
   `List` of `Tuple`s in spec order (the system solver's `Record` shape is
   not value-shaped; tuples keep the oracle-friendly contract).
2. **Root-family expansion**: when symbolic solve returns principal values
   for periodic equations (trig rules in `UNIVARIATE_ROOTS`,
   `solve.ts:64-638`) and the domain is a bounded interval/range, expand
   `x₀ + k·period` over the domain instead of enumerating.
3. **`Interval` domains** (real, non-enumerable): filter-only semantics +
   inequality-style endpoint checks (reuse `satisfiesInequalities`,
   `boxed-function.ts:1626-1634`).
4. **Assumptions bridge**: `assume(n ∈ Range(1,1000))` today refines type
   only; its bounds are ignored by univariate solve (`assume.ts:842-859` vs
   `solve.ts:2274`). Once domain filtering exists, route those bound
   assumptions through the same membership filter.

## Phase 3 (not this design)

Symbolic diophantine classes (linear `ax+by=c`, Pell) — assess SymPy's
BSD-licensed `diophantine` module as a porting corpus first (the 2026-06-10
dataset research did not cover it).

## Non-goals

- No new head (`SolveWhen` rejected — 2026-07-04 discussion).
- No partial results on budget/timeout exhaustion.
- No change to the no-domain `Solve` behavior, return shape, or laziness.
- Enumeration does not attempt symbolic domains (`x ∈ PrimeNumbers` etc.);
  `convertInfiniteSetToLimits` (`library/utils.ts:28-42`) exists if a capped
  treatment is ever wanted, but capping silently is wrong for Solve.

## Tests / acceptance

- Unit (`test/compute-engine/solve-domain.test.ts`): quadratic filtered by
  range (integer + non-integer roots), predicate enumeration (`Congruent`,
  `Divides`), boolean `And` conditions via the 3-operand `Element`, budget
  refusal (large range + unsolvable → unevaluated), deadline interruption
  (`CancellationError`), float-sieve exactness (a case where tolerance
  would lie, e.g. near-integer root of a large-coefficient cubic), empty
  `List` vs unevaluated distinction, no-domain regression suite untouched
  (`solve.test.ts`, `solve-rules.test.ts`).
- MathNet-derived spot cases (from `docs/mathnet/`): the Pell case
  (id `0jxv`), a "sum of n ≤ N with divisor property" case — as
  known-answer tests.
- The audit harness (`benchmarks/audit/solve.ts`) is unaffected (2-arg
  calls) but can grow a `domain` case class later.

---

## Phase 3 — Symbolic diophantine solving (2026-07-04)

Integer-typed / integer-domained unknowns now reach a closed-form integer
solver **before** the enumeration fallback, and fully unbounded integer solves
stop being inert. Scope of the first slice (per the porting assessment,
`docs/plans/2026-07-04-diophantine-assessment.md`):

- **Linear, any number of unknowns** — `a₁x₁ + … + aₙxₙ + c = 0` with exact
  integer/rational coefficients (rationals are cleared through the lcm of
  denominators).
- **Pell / diagonal binary quadratic, general N** — exactly two unknowns,
  `A·u² + B·v² + C = 0` with no cross or linear term, reducible to
  `X² − D·Y² = N` because `|A| = 1` or `|B| = 1` (after clearing denominators).
  This subsumes the elliptic (`D < 0`, finite), degenerate (`D = 0`,
  square-`D`) and hyperbolic (`D > 0` non-square, infinite family) regimes — the
  kernel handles them all.

### Result contract (decided)

1. **All unknowns bounded to a finite integer domain** → a concrete `List` of
   `Tuple`s, exactly the Phase 2 shape, sorted lexicographically ascending by
   tuple coordinates. Every emitted member passes `domain.contains` for its
   coordinate (so `Range` steps are honored) **and** is exact-confirmed by
   substitution into the equation (mirroring `expandPeriodicRoots`). Cap:
   `MAX_DIOPHANTINE_EXPANSION = 1000` members; an instantiation that would
   exceed it returns `undefined`, leaving the existing enumeration/budget path
   to run unchanged.
2. **All unknowns fully unbounded over ℤ** (a declared integer-typed unknown
   with no domain, the `Integers` collection, or a doubly-infinite `Range`) →
   a **parametric** `List` of `Tuple`s whose entries are canonical expressions
   in fresh integer parameters. Free parameters in a `Solve` result range over
   ℤ (documented convention — nothing is declared in the user's scope).
   - Linear `ax + by = c`: one tuple `(x₀ + (b/g)·t, y₀ − (a/g)·t)`; `n ≥ 3`
     variables: one tuple in `n − 1` parameters.
   - Pell `family`: for each class rep `(r, s)` **two** tuples — the family and
     its global negation — each entry the exact closed form
     `x_t = ((r+s√D)(T+U√D)^t + (r−s√D)(T−U√D)^t)/2`,
     `y_t = ((r+s√D)(T+U√D)^t − (r−s√D)(T−U√D)^t)/(2√D)`, `t ∈ ℤ` (the unit has
     norm 1, so `(…)^t` handles `t < 0` as the conjugate automatically). Pell
     `finite` results are already complete → concrete tuples; the degenerate
     `linear-family` variant emits `(a + b·y, y)` with a fresh `y` parameter.
3. **Half-bounded** (`Range(1, +∞)`) or otherwise not-finitely-instantiable
   integer domains → **not dispatched**; existing behavior is left untouched
   (documented limitation — a domain constraint is never silently dropped).

An empty `List` is a decision (a proven-unsolvable equation such as
`6x + 9y = 4`); `undefined` means "not a diophantine form I handle" and falls
through to the existing path.

**Deviation from the literal dispatch spec (deliberate, to preserve the Phase-2
contract):** for a **bounded, non-empty _linear_** system the diophantine path
returns `undefined` (defers to enumeration) rather than surfacing the concrete
tuples. Enumeration yields the identical tuples within budget, and — crucially —
an over-budget bounded box for a linear equation stays *inert*, exactly as
Phase 2 promised (`solve-domain.test.ts`'s "product over budget stays
unevaluated"). What the bounded linear path *does* surface is the fast
**emptiness proof** (`6x + 9y = 4` over a 10⁶ box → `[]` without sweeping). The
genuinely new bounded capability — reaching a family enumeration cannot, over a
box far beyond the enumeration budget — is delivered by the **Pell** path
(MathNet `0jxv`: `x² − 29y² = 1` over `[1, 10⁵]²` → `[(9801, 1820)]`).

### Dispatch points (`boxed-expression/solve-domain.ts`)

- `solveOverMultipleDomains`: before the enumeration budget check, when the
  equation is an integer equation and every domain is integer-valued
  (`isIntegerDomain` — a bounded `Range` or the `Integers` set; not a
  half-bounded `Range` nor a real `Interval`, whose element type degrades to
  `number`) and carries no extra `Element` condition, attempt
  `tryDiophantineSolve`. A result (including an empty `List`) is used; the engine
  deadline is honored here too, since this path bypasses the deadline-checked
  enumeration loop.
- `evaluateSolve`, no-domain multi-unknown branch: when the equation is a single
  `Equal` and **every** unknown is *declared* integer-typed (a plain untyped
  symbol must NOT dispatch — that is a real-domain solve), attempt
  `tryDiophantineSolve` with unbounded domains → parametric/finite `List`.
- No existing behavior for non-integer cases changes.

### Parameter freshness

Parameters are named `t, t_1, t_2, …`, skipping any name that appears among the
equation's symbols or is bound to a value in the current context (a bound `t`
with a value would evaluate inside the result). Nothing is declared in the
user's scope; the parameters surface as free symbols.

### Kernel

Pure-bigint kernels live in `numerics/diophantine.ts` (engine-free, a hand port
of the relevant pieces of SymPy 1.14.0's BSD-licensed `diophantine.py`, plus a
direct Tonelli–Shanks / Hensel `sqrtMod`): `extendedGcd`,
`solveLinearDiophantine`, `solvePell` / `pellFundamental` / `bruteForcePell`,
and the `DiophantineBudgetError` anti-hang backstop. The **family-generation
rule** the boxing layer enumerates is pinned in the `PellResult` doc comment:
over all class reps `(r, s)`, every `(r + s√D)·(T + U√D)^t` for `t ∈ ℤ`
(inverse unit for `t < 0`) **together with** the global negation `(−x, −y)`;
the `linear-family` variant's `xOfY: [a, b]` means `x = a + b·y` with `y` free.
Recognition/boxing/dispatch live in `boxed-expression/diophantine.ts`
(`tryDiophantineSolve`, `isIntegerDomain`, `MAX_DIOPHANTINE_EXPANSION`), a peer
of `solve.ts`/`polynomials.ts` — no new import cycles (madge-verified).

### Deliberately deferred

- `transformation_to_DN` for **general** binary quadratics (cross terms `Bxy`,
  linear terms `Dx`/`Ey`) — only diagonal unit-coefficient forms are recognized.
- The **sum-of-squares / Pythagorean** tier (`x₁² + … + xₙ² = k`, `n ≥ 3`) — a
  better fit for a dedicated representation function than for Solve output.
- `diophantine()` **auto-factoring** of reducible equations (`factor_list`).
- **Instantiation over half-bounded** domains (`Range(1, +∞)`) — needs a
  one-sided family walk with a soundness argument; left inert for now.
