# Statistics for real data work — distributions, correlation, fitting (design proposal)

**Status:** approved 2026-07-04 (§9 answers inline); Phase 1 in progress ·
**Date:** 2026-07-04 ·
**Roadmap:** Product feature track item 1 (agreed 2026-07-04): probability
distributions (Normal/Binomial/Poisson PDF/CDF/quantile),
correlation/covariance, and least-squares fitting.

## 1. Goals and consumers

- **Tycho / Graph Paper:** scientists, students and educators working with
  real data — plot a fitted line over a scatter, shade a normal tail, compute
  a p-value-shaped quantity, quote a correlation. The library today stops at
  descriptive stats (`Mean`…`Histogram`); this is the highest-value
  analytical gap for that audience.
- **Education:** results must read like the textbook. `CDF` of a normal is
  `½(1 + erf((x−μ)/(σ√2)))`, not a float; a binomial PMF at exact `p` is an
  exact rational. The exactness contract is a differentiator over every JS
  competitor (math.js has none of this; jStat is float-only).
- **Plotting:** `PDF(NormalDistribution(0, 1), x)` must lower to a plain
  closed-form expression in `x` — directly compilable (JS/GPU) and plottable
  with zero new plotting work.

Non-goals (v1): hypothesis-test operators (t-test, χ²-test), multivariate
distributions, Spearman/rank correlation, nonlinear (iterative) fitting,
weighted regression, model objects with diagnostics. Random *sampling* from
distributions is Phase 3 (§8).

## 2. Shape of the feature

Three independent sub-features, one design:

1. **Distributions** — distribution values + generic `PDF`/`CDF`/`Quantile`.
2. **Data relationships** — `Covariance`/`Correlation` (+ population
   variants).
3. **Least-squares fitting** — `LinearRegression`/`PolynomialFit`.

(2) and (3) need no new numeric kernels and are independent of (1).

## 3. Distributions

### 3.1 Distribution-as-value

Distributions are first-class inert values built by constructor heads,
Mathematica-style, rather than a flat `NormalPDF`/`NormalCDF`/… family:

```
["NormalDistribution", mu, sigma]        // sigma = standard deviation
["BinomialDistribution", n, p]
["PoissonDistribution", lambda]
["UniformDistribution", a, b]
["ExponentialDistribution", lambda]      // lambda = rate
```

- One `PDF`/`CDF`/`Quantile` head each, instead of 3×N operators; adding a
  distribution later is one table entry, no new API.
- The value composes: it can be assigned (`d ≔ NormalDistribution(0,1)`),
  passed around, and later consumed by `RandomVariate` or overloaded
  `Mean`/`Variance` (§9 Q4) without new surface.
- **Naming:** the full `…Distribution` names are Mathematica-compatible and
  sidestep a hard collision — `Normal` is already the Series BigO-stripper
  and `Binomial` the binomial coefficient. The Graph Paper UI can display
  friendlier labels.
- Constructors are canonical but inert (no `evaluate`); they validate arity
  and parameter ranges (`sigma > 0`, `0 ≤ p ≤ 1`, `n` integer…) the way
  operators validate today — out-of-range *literal* parameters produce an
  error node; symbolic parameters pass through.
- **Typing:** declare a nominal type per head plus a union, following the
  `limits` precedent (`index.ts` `declareType('limits', 'expression<Limits>')`):
  `distribution = expression<NormalDistribution> | expression<BinomialDistribution> | …`,
  so the consuming operators get real signatures
  (`PDF: (distribution, number) -> number`).

The five v1 distributions cover the roadmap ask (Normal/Binomial/Poisson)
plus the two that are nearly free and pedagogically common
(Uniform/Exponential). Student-t, χ², F, Geometric, etc. are Phase 3 — they
need the inverse-incomplete kernels (§5) that v1 deliberately avoids.

### 3.2 `PDF`, `CDF`, `Quantile`

```
["PDF", dist, x]        // density; for discrete distributions, the PMF
["CDF", dist, x]        // P(X ≤ x)
["Quantile", dist, p]   // least x with CDF(x) ≥ p
```

`evaluate` **lowers to a closed form** whenever one exists — that is the
core design move. The result is a plain expression in the remaining symbolic
arguments, so display, `simplify`, `D`, `Integrate`, `compile`, and plotting
all work with no distribution-specific support:

| | closed form returned by `evaluate` |
| --- | --- |
| Normal PDF | `e^{−(x−μ)²/(2σ²)}/(σ√(2π))` |
| Normal CDF | `½(1 + Erf((x−μ)/(σ√2)))` |
| Normal quantile | `μ + σ√2·ErfInv(2p−1)` |
| Binomial PMF | `Binomial(n,k)·p^k·(1−p)^{n−k}` |
| Binomial CDF | `BetaRegularized(1−p, n−k, k+1)` (at integer/symbolic `k`) |
| Poisson PMF | `λ^k·e^{−λ}/k!` |
| Poisson CDF | `GammaRegularized(⌊k⌋+1, λ)` |
| Uniform, Exponential | elementary closed forms incl. quantiles |

- Discrete `PDF` at a *numeric* non-integer point is `0`; at a symbolic
  point it returns the PMF formula (documented as valid on the support).
- Discrete `Quantile` has no closed form: `evaluate` stays symbolic; `.N()`
  computes it by monotone integer search bracketed by the normal
  approximation (§5).
- `p ∉ [0,1]` → error node; `p = 0/1` → support endpoints (`±∞` for Normal).

### 3.3 `GammaRegularized`, `BetaRegularized` as first-class operators

The discrete CDFs need somewhere to lower *to*. Introduce two user-facing
special functions (Mathematica names and argument order):

```
["GammaRegularized", a, z]      // Q(a,z) = Γ(a,z)/Γ(a)
["BetaRegularized", x, a, b]    // I_x(a,b)
```

They live in the special-functions/statistics library next to `Erf`, follow
the `Erf` template exactly (exact args stay symbolic; special values fold —
`GammaRegularized(1, z) → e^{−z}`; inexact args numericize), and give the
science audience χ²/t-adjacent quantities directly. `CDF` closed forms are
then honest expressions the engine can already round-trip.

## 4. Data relationships and fitting

### 4.1 `Covariance`, `Correlation`

```
["Covariance", xs, ys]     ["Correlation", xs, ys]     // two equal-length collections
["Covariance", points]     ["Correlation", points]     // one collection of (x,y) pairs
```

- Both input conventions accepted (detected structurally: one argument whose
  elements are 2-element collections vs. two collection arguments). A list
  of pairs is a natural Graph Paper scatter; two lists match spreadsheet
  columns.
- `Covariance` is the *sample* covariance (n−1), with `PopulationCovariance`
  for the n-denominator — exactly the existing
  `Variance`/`PopulationVariance` precedent. `Correlation` is Pearson's r
  (denominator convention cancels, so no population variant).
- Dual exact/numeric path, mirroring `Mean` (`library/statistics.ts`
  `exactData`): all-exact data → exact rational/radical result; otherwise
  machine or `BigDecimal` kernels in `numerics/statistics.ts`
  (`covariance`/`bigCovariance`, …). Length mismatch or n < 2 → error node.

### 4.2 `LinearRegression`, `PolynomialFit`

```
["LinearRegression", xs, ys]            // → ["Tuple", b0, b1]  (fit: b0 + b1·x)
["LinearRegression", points]
["PolynomialFit", xs, ys, degree]       // → ["List", c0, c1, …, c_deg]  (ascending)
["PolynomialFit", points, degree]
```

- **Result = coefficients, constant term first** (ascending, matching the
  polynomial `Coefficients` convention). Coefficients are the honest
  primitive: the app can display, tabulate, or build the model from them.
- **Optional trailing variable argument returns the fitted expression
  instead**: `["PolynomialFit", pts, 2, "x"]` → `c0 + c1·x + c2·x²` — the
  one-call plottable answer for Graph Paper (§9 Q3).
- `LinearRegression` is `PolynomialFit` degree 1 with a friendlier name and a
  `Tuple` result (intercept, slope).
- **Algorithm:** linear case via the closed form (`b1 = Cov(x,y)/Var(x)`,
  `b0 = ȳ − b1·x̄`) — which makes the exact path free. General degree via
  Vandermonde normal equations solved by the existing Gaussian elimination
  with partial pivoting (`boxed-expression/solve-linear-system.ts`); exact
  data goes through exact elimination, so rational data yields **exact
  rational fit coefficients** — a real differentiator. Degree capped (`deg ≤
  min(n−1, 12)`) and conditioning documented (normal equations square the
  condition number; fine at these degrees, and QR can replace the solver
  later behind the same API).
- Degenerate input (constant `xs`, `n ≤ deg`) → error node, not NaN.

### 4.3 Empirical `Quantile`

`Quantile` overloads on data: `["Quantile", collection, p]` computes the
empirical quantile, using the same Moore–McCabe-compatible convention as the
existing `Quartiles` so `Quantile(xs, 1/4)` agrees with `Quartiles(xs)`
(self-consistency over NumPy type-7 compatibility, §9 Q5). The collection
case and distribution case are distinguished by the first argument's type.

## 5. Numeric kernels

New kernels in `numerics/special-functions.ts` (they are general special
functions, not distribution-specific):

| kernel | machine | bignum | algorithm |
| --- | --- | --- | --- |
| regularized incomplete gamma `P(a,x)`/`Q(a,x)` | new | new | series for `x < a+1`, continued fraction otherwise (NR `gammp`/`gammq`), on top of existing `gammaln`/`bigGammaln` |
| regularized incomplete beta `I_x(a,b)` | new | new | Lentz continued fraction (NR `betacf`) + symmetry `I_x(a,b) = 1 − I_{1−x}(b,a)` |

- The existing `incompleteGammaUpper` (machine-only, unregularized) stays;
  the new regularized pair is what CDFs and `GammaRegularized` consume.
- **Bignum variants are in scope for v1**: the engine's stated policy is
  wrong-digit kernels are P0s (July 2026 correctness review), so shipping
  machine-only kernels that silently feed a 100-digit `.N()` is not
  acceptable. Both algorithms are straightforward in `BigDecimal` given the
  existing `bigGammaln`/`bigExp`/`bigLn`. If a case exceeds a kernel's
  validated range, return `undefined` (stay symbolic) — never wrong digits.
- **No inverse-incomplete kernels in v1.** Quantiles need inverses only for
  the gamma/beta families: Normal uses the existing `erfInv`/`bigErfInv`,
  Uniform/Exponential are closed-form, Binomial/Poisson are integer searches
  on a monotone CDF (start at the normal-approximation estimate, step; cost
  O(√variance) worst case, `checkDeadline`-guarded). Inverse regularized
  gamma/beta (Newton on the kernels) arrives in Phase 3 with Student-t/χ²/F.

Distribution-specific glue (discrete-quantile search, parameter plumbing)
goes in a new `numerics/distributions.ts`; data kernels
(`covariance`, `correlation`, fit assembly) extend `numerics/statistics.ts`
with the usual machine + `big*` pairs over `Iterable`s.

Library code: distributions + `PDF`/`CDF`/`Quantile` + the two regularized
operators in a new `library/distributions.ts`, registered under the existing
`statistics` category in `library/library.ts`; `Covariance`…`PolynomialFit`
extend `library/statistics.ts`.

## 6. Exactness contract

Standard discipline, stated once: `evaluate()` returns exact values or
closed symbolic forms — a CDF of exact arguments is an exact expression in
`Erf`/`GammaRegularized`/…, a binomial PMF at rational `p` is an exact
rational; only inexact (float) arguments numericize on the plain evaluate
path. `.N()` numericizes via the §5 kernels, dispatching on
`bignumPreferred`. Closed-form construction uses `ce.function('Add'|…)`
(never the `.add()`/`.mul()` methods, which fold exact literal pairs to
floats), and no handler calls `.simplify()`.

## 7. Notation and compilation

- **Serialize:** all new heads round-trip via the default
  `\operatorname{…}(…)` path (the `Series`/`TrigExpand` pattern). No custom
  serializers in v1.
- **Parse conveniences** (in `definitions-statistics.ts`):
  `\operatorname{cov}` → `Covariance`, `\operatorname{corr}` →
  `Correlation`, joining the existing `\operatorname{var}` alias.
  **Deliberately deferred:** `\mathcal{N}(μ, σ²)` — the textbook notation
  takes the *variance* as second argument while `NormalDistribution` takes
  σ, a silent-wrong-answer trap; and `\Phi` — collides with the plain symbol.
  Revisit with the Graph Paper UI once real notebooks show the demand.
- **Compilation:** continuous `PDF`/`CDF`/`Quantile` compile for free —
  `evaluate` lowers them to elementary expressions plus `Erf`/`ErfInv`,
  which every target already maps. Add JS `_SYS` entries for
  `GammaRegularized`/`BetaRegularized`/`Covariance`/`Correlation` and the
  Python maps (`scipy.special.gammaincc`/`betainc`, `np.cov`/`np.corrcoef`)
  to keep the parity suites green; everything else fails closed per policy.

## 8. Testing

- **Kernel accuracy:** golden values from `mpmath` (`benchmarks/` venv) for
  `P`/`Q`/`I_x` across the series/CF boundary and at machine + 50 + 200
  digits; the wrong-digit bar is the July-2026 review standard.
- **Closed-form battery:** `PDF`/`CDF`/`Quantile` exact forms vs the §3.2
  table; exactness grid entries (exact in → exact out; float in → float
  out); round-trip LaTeX.
- **Consistency laws:** `CDF(Quantile(d, p)) = p` (continuous, numeric);
  `Quantile(d, CDF(d, k)) = k` at integer `k` (discrete);
  `∑ PMF = 1` on truncated supports; `N(∫ PDF) ≈ CDF` spot checks;
  `Correlation(xs, xs) = 1`; `Covariance(xs, ys) =`
  `Mean(xs·ys) − Mean(xs)·Mean(ys)` (population) on exact data.
- **Fitting:** recover exact coefficients from exactly-polynomial data
  (rational in → rational out); degenerate inputs error cleanly; numeric fit
  vs NumPy `polyfit` within tolerance; `LinearRegression` = degree-1
  `PolynomialFit`.
- **Compile parity:** new `_SYS`/scipy entries exercised by the existing
  parity suites; `PDF(NormalDistribution(0,1), x)` compiles and matches
  `.N()` at sample points.
- New `test/compute-engine/statistics.test.ts` (data ops + regression) and
  `distributions.test.ts` (distributions + kernels).

## 9. Open questions (for review)

1. **Distribution set for v1** — Normal/Binomial/Poisson (the roadmap ask)
   plus Uniform/Exponential (nearly free). OK, or trim to the named three?

[*] Let's include Uniform and Exponential.


2. **`NormalDistribution(μ, σ)` takes the standard deviation** (Mathematica
   and scipy `loc/scale` convention), not the variance. Confirm.

[*] Confirmed

3. **Fit result shape** — coefficients by default (`Tuple`/ascending
   `List`), with an optional trailing variable argument returning the fitted
   *expression* (`["PolynomialFit", pts, 2, "x"]` → `c0 + c1·x + c2·x²`).
   Keep the expression variant in v1?

[*] Yes, keep the expression variant in v1.

4. **Overload `Mean`/`Variance`/`StandardDeviation` on distributions**
   (`Mean(NormalDistribution(μ, σ)) → μ`, `Variance(BinomialDistribution(n,p))
   → n·p·(1−p)`)? Requires widening their first-argument type to include
   `distribution`. Cheap and Mathematica-compatible — propose yes, in the
   distributions phase.

[*] Agreed.

5. **Empirical `Quantile` convention** — match `Quartiles` (Moore–McCabe)
   for internal self-consistency, diverging from NumPy's default (type 7).
   Confirm.

[*] Confirmed

6. **Phase order** — distributions first (matches the roadmap wording), or
   the data track (§4) first since it is kernel-free and the fastest win?
   The tracks are independent; proposal: distributions first.

[*] Agreed.

## 10. Phasing and effort

| Phase | Content | Effort |
| --- | --- | --- |
| 1 | Regularized incomplete gamma/beta kernels (machine + bignum) + `GammaRegularized`/`BetaRegularized` + 5 distribution heads + `PDF`/`CDF`/`Quantile` (+ `Mean`-family overloads per Q4) + LaTeX + compile entries | M |
| 2 | `Covariance`/`Correlation`/`PopulationCovariance` + `LinearRegression`/`PolynomialFit` + empirical `Quantile` | M |
| 3 (demand-gated) | Inverse regularized gamma/beta + Student-t/χ²/F/Geometric + `RandomVariate` (seeded, reusing the `Sample` RNG policy) + fit diagnostics (R²) | M/L |

Phases 1 and 2 are independent and individually shippable; each is roughly
one focused session in the Series mold.
