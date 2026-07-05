# SymPy Diophantine Module — Porting Assessment (Solve Phase 3, Step 1)

**Date:** 2026-07-04
**Status:** Assessment complete — awaiting sign-off on porting subset
**Corpus:** `sympy/solvers/diophantine/diophantine.py`, SymPy 1.14.0, BSD-3.
3,980 lines (single file) + 1,071-line test suite. Local copy in
`venv/lib/python3.14/site-packages/sympy/solvers/diophantine/`.
**Context:** Phases 1+2 (domain-constrained Solve) are implemented — see
`docs/plans/2026-07-04-solve-domain-design.md`. Phase 3 adds symbolic integer
solving so integer-typed/domained unknowns reach a closed-form solver before
the enumeration fallback, and unbounded integer solves stop being inert.

---

## 1. What the corpus contains

SymPy declares 12 equation classes, but **only 7 have solvers**; 5 are
classification stubs whose `solve()` raises `NotImplementedError`
(InhomogeneousTernaryQuadratic, InhomogeneousGeneralQuadratic,
HomogeneousGeneralQuadratic, CubicThue — yes, CubicThue is a stub in SymPy
itself, with zero solved test cases).

| Class | Solves | Algorithm | Result shape | LOC incl. exclusive helpers |
|---|---|---|---|---|
| Linear | a₁x₁+…+aₙxₙ+c=0, **any n** | extended GCD + chained bivariate reduction | parametric family, n−1 params | ~165, self-contained |
| Univariate | p(x)=0, integer roots | `solveset_real` ∩ ℤ (don't port; rational-root theorem instead) | finite | ~40 |
| BinaryQuadratic | Ax²+Bxy+Cy²+Dx+Ey+F=0 | 4 discriminant cases; Pell core = `diop_DN` (PQa continued fractions, LMM) | finite (elliptic/parabolic) or parametric families via fundamental-unit recurrence (hyperbolic/Pell) | ~180 + 700–900 helper closure |
| HomogeneousTernaryQuadraticNormal | ax²+by²+cz²=0 | Legendre + descent + Gaussian reduction + Holzer | one primitive solution | ~430 closure |
| HomogeneousTernaryQuadratic | + cross terms | completing-the-square → Normal; recurses into BinaryQuadratic | base solution or 2–3-param family | +250 on top of both stacks |
| GeneralSumOfSquares | x₁²+…+xₙ²=k, n≥3 | Fermat/Lagrange decompositions (`power_representation`) | finite, `limit`-controlled | ~530, self-contained |
| GeneralPythagorean | Σaᵢ²xᵢ² = aₙ₊₁²xₙ₊₁² | pure closed-form parametrization | family, n−1 params | ~40, trivial deps |
| GeneralSumOfEvenPowers | Σxᵢᵉ=k, e even | shares `power_representation` | finite | +30 once SumOfSquares exists |

**Top-level machinery:** `classify_diop` is cheap (monomial-coefficient dict +
max degree — no real `Poly` needed). The `diophantine()` entry's one heavy
dependency is **`factor_list` (multivariate factorization over ℚ)** used to
split reducible equations like `x²−y²=0`; skipping auto-factoring loses only
that and keeps every class shippable via the direct dispatch path.

### The gating dependency: `sqrt_mod`

Modular square roots for composite moduli (Tonelli–Shanks + Hensel lifting +
CRT) gate the general-N Pell path (`diop_DN` line 2047, `cornacchia` 2197) and
the entire ternary-descent family. ~150–250 lines, ~1–2 days. CE already has
`modPow`, Miller–Rabin `isPrimeBigint`, and `jacobiSymbol`
(`library/number-theory.ts`, `numerics/primes.ts`), so the port is moderate,
not hard. The additive tier (sum of squares / Pythagorean) never touches it.
Pure Pell N=±1 (the MathNet case) never touches it either.

## 2. Test suite as validation corpus

`tests/test_diophantine.py`: **~180–185 exact expected-value assertions** on
the public solving surface plus **~95 oracle-style checks**
(`check_solutions`: substitute and verify residual = 0). Randomized /
SymPy-internal / `DiophantineSolutionSet`-API tests are not worth porting.

Coverage concentration is exactly where we want it:

- **Pell (`test_DN` + `test_bf_pell`)** — ~51 exact cases, the richest block;
  cites Robertson's paper, includes 30-digit fundamental solutions, all
  no-solution regimes, D=0/N=0 degenerate parametric cases.
- **Linear (`test_linear` + regressions)** — ~28 cases: 1–4 variables, gcd
  non-divisibility → no solution, zero/negative coefficients.
- BinaryQuadratic non-Pell cases (~35 mostly oracle), GeneralSumOfSquares
  (~17), GeneralPythagorean (~9, incl. one exact parametric).

Parametric-form conventions are inconsistent in SymPy (indexed `t_0, t_1…` for
linear; bare `t` for quadratic; `p,q` for ternary; `m1…` for Pythagorean) and
SymPy's own tests avoid asserting ternary dummy identity (they extract free
symbols and check shape + oracle). **Port lesson:** pick one canonical
parameter scheme, assert exact forms for linear/Pell, oracle-style for the
rest.

**Recommended porting slice for Linear + Pell (+BinaryQuadratic edges):
~100–120 jest assertions**; +~25 if sum-of-squares/Pythagorean are included.

## 3. CE integration surface (what exists / what's missing)

- **Hook points** (both in `boxed-expression/solve-domain.ts`): univariate
  integer case → inside `solveOverDomain` between the symbolic-filter step and
  the enumeration fallback (after line ~246); multivariable case → at the top
  of `solveOverMultipleDomains` **before** the enumeration budget check
  (line ~345), so unbounded/over-budget integer domains get a symbolic path.
- **Today, `Solve(3x+4y==7, x, y)` with no domains is inert**: single `Equal`
  with 2 unknowns hits `varNames.length !== 1 → null` in
  `boxed-function.ts:1136`. With two domain specs it enumerates O(N·M).
- **No parametric-family result construct exists.** Trig root families are
  *not* represented symbolically — `expandPeriodicRoots`
  (`solve-domain.ts:689–766`) computes kmin/kmax from the domain bounding
  range and materializes concrete members, exact-confirming each by
  substitution, capped at 1000. That is the precedent to mirror: **finite
  domains instantiate the family; only unbounded solves surface a parameter.**
- **Result contract today:** `List` of values (univariate) / `List` of
  `Tuple`s (multivariable enumeration). The system-solver `Record` shape is
  deliberately not surfaced.
- **Number-theory substrate:** extended GCD exists (`extGcd`, private in
  `library/number-theory.ts:1153` — must move down to `numerics/`, since
  numerics can't import from library), plus `bigintSqrt`, CRT, `modPow`,
  Miller–Rabin, `jacobiSymbol`, trial-division `bigPrimeFactors`. **Missing:**
  periodic continued fraction of √D / PQa (the Pell core), Tonelli–Shanks,
  Cornacchia, and the linear family wrapper.
- **Placement** (per `docs/architecture/CURRENT-ARCHITECTURE.md` layering):
  pure bigint kernels in **`numerics/diophantine.ts`** (no engine imports;
  unit-testable standalone); recognition/boxing/dispatch in
  **`boxed-expression/diophantine.ts`**, imported by `solve-domain.ts` — a
  peer of `solve.ts`/`polynomials.ts`, no new cycles. Re-run madge after
  wiring.
- **MathNet acceptance case `0jxv`** (mathnet-characterization.md:279): find
  smallest x+y, x,y ≥ 1 integers, x²−29y²=1. Answer **11621**
  (x=9801, y=1820). Pure Pell N=1 — covered by PQa alone, no `sqrt_mod`.

## 4. Ranked recommendation (value-per-effort for CE)

Effort assumes CE's existing bigint substrate; "days" are experienced-dev
person-day equivalents.

| Rank | Item | Value | Effort | Verdict |
|---|---|---|---|---|
| 1 | **Linear, n-variable** | ⭐⭐⭐⭐⭐ | 1.5–2.5d | **Port.** Kernel (extGcd) already exists; family construction + n-var chaining is the work. The canonical student ask. |
| 2 | **Pell `x²−Dy²=N` (`diop_DN`)** | ⭐⭐⭐⭐ | 4–6d (incl. sqrt_mod) or 3–4d for N=±1 + brute-force small N | **Port.** PQa + fundamental solution + family recurrence + `diop_bf_DN` fallback. General-N (LMM) needs the Tonelli–Shanks port (~1–2d, moderate given modPow/jacobi exist). |
| 3 | GeneralPythagorean | ⭐⭐⭐⭐ | 1–1.5d | Cheap, high wow-factor; but ≥3 unknowns strains the Solve surface (multi-param families). Natural fast-follow, not core. |
| 4 | GeneralSumOfSquares (+EvenPowers) | ⭐⭐⭐⭐ | 3–4.5d | Self-contained, no sqrt_mod; but fits better as a dedicated representation function than as Solve output. Defer to a later phase. |
| 5 | Full BinaryQuadratic (elliptic/parabolic/perfect-square/simple-hyperbolic + `transformation_to_DN`) | ⭐⭐⭐ | +3–5d over Pell | Defer; first slice recognizes diagonal forms directly, general Bxy/Dx/Ey transform later. |
| 6 | Ternary quadratics | ⭐ | 6–9d | Skip. Low student value, pulls in both descent and Pell stacks. |
| 7 | `diophantine()` auto-factoring (`factor_list`) | ⭐⭐ | 3–4d | Skip for now; direct dispatch covers the target forms. |
| — | CubicThue, inhomogeneous/general quadratic | — | 0 | Stubs in SymPy; nothing to port. |

### Proposed Step 2 scope (pending sign-off)

**Core: Linear (n-var) + Pell x²−Dy²=N with general N (incl. Tonelli–Shanks).**
≈ 7–9 days equivalent, heavily parallelizable across sub-agents:

- `numerics/diophantine.ts`: extGcd (moved), linear family kernel, PQa,
  fundamental-solution extraction, solution-family recurrence, `diop_bf_DN`,
  Tonelli–Shanks `sqrtMod`.
- `boxed-expression/diophantine.ts`: form recognition (via
  `getPolynomialCoefficients`), dispatch, family boxing, domain instantiation
  (kmin/kmax bounding mirroring `expandPeriodicRoots`, exact-confirm, cap).
- Wiring at the two `solve-domain.ts` hook points + the no-domain
  multi-unknown path (`Solve(3x+4y==7, x, y)` returns the parametric family
  instead of staying inert).
- Validation: ~100–120 ported jest assertions (`test_linear`, `test_DN`,
  `test_bf_pell`, quadratic-degenerate slices) + MathNet 0jxv acceptance test.

**Result contract (to finalize in Step 2, direction):** finite/bounded domains
→ concrete `List` of `Tuple`s exactly as Phase 2 emits today (families
instantiated over the domain box, each member exact-confirmed). Unbounded
integer solves → `List` of `Tuple`s of expressions in fresh integer
parameter(s), with parameter domain made explicit in the result (mechanism to
be settled against the existing `Element` spec shape — e.g.
`Tuple(1+4t, 1−3t)` with `t ∈ ℤ` surfaced as a condition, not a bare free
symbol left ambiguous). Mirrors SymPy semantics while keeping the Phase 1/2
value-shaped contract intact for the audit oracle.

### Correctness watch-items (from the corpus)

1. Sign/gcd conventions: `_remove_gcd`, `base_solution_linear`'s `b<0 ⇒ t→−t`
   flip — replicate exactly or families come out sign-flipped vs the tests.
2. `equivalent()` solution-class test and `symmetric_residue` centering in
   `diop_DN` are historically bug-prone.
3. Don't port `solveset_real` uses (Univariate, parabolic case) — replace
   with rational-root / integer-quadratic helpers.
4. Parameter hygiene: fresh parameter symbols must not collide with user
   symbols (SymPy's `merge_solution` uses numbered symbols).
