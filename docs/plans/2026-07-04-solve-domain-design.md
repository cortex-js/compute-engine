# Solve over a Domain — Design

**Date:** 2026-07-04 · **Status:** proposed
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
