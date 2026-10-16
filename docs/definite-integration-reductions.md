# Exact definite integration reductions

These reductions address five gaps exposed by competition integrals: exact
arithmetic, symmetry and trigonometric moments, discrete periodic moments,
improper endpoints, and sums or products. They run through the existing
`Integrate` API. They are bounded symbolic algorithms, not a general decision
procedure for integration or convergence.

## Exact arithmetic and branches

Polynomial expansion must construct integer multinomial coefficients exactly.
For example, the middle coefficient of `(1+x)^60` is
`118264581564861424`, beyond the machine integer range. The expansion path uses
a BigInt binomial recurrence in which every division is exact. The exported
machine-number `choose()` API is unchanged.

Keeping `x*(1-x)^99` factored also avoids cancellation between enormous
coefficients: its integral from zero to one is `1/10100`. On main before this
change, CE with Rubi returned approximately `-20037032693.7514`.
The primitive endpoint regression also calls Rubi directly, bypassing the Beta
shortcut, and requires the exact result `1/10100`.

A real reflection identity avoids a branch-sensitive primitive for
`sqrt(x)/(sqrt(x)+sqrt(2012-x))` on `[1,2011]`. Reflecting about the midpoint
makes the two fractions sum to one, so the integral is `1005`. The previous
Rubi endpoint expression contained `-503*i*pi`. This change resolves that
family directly; it does not certify every primitive returned by a provider.

## Symmetry and trigonometric moments

Odd symmetry is used only after a structural real-continuity proof on the
closed interval. In particular, oddness of `1/x` on `[-1,1]` does not establish
convergence or authorize returning its principal value.

For `p(x)/(p(x)+p(a+b-x))`, interval enclosures prove continuity and exclude a
zero denominator before applying reflection. On a positive radian quadrant,
`1/(1+tan(x)^p)` has complementary reflected values and finite endpoint limits
for finite exact `p>0`, giving `pi/4`.

Products of affine sines and cosines use real product-to-sum identities. At
most eight factors are expanded, bounding the term count by 256. Complete
quadrants and periods instead use Wallis moments, including powers up to a
combined degree of 4096. A lone affine sine or cosine retains the normal
integration-provider route. Radian-specific formulas decline other angular
units; existing unit-aware integration remains available.

## Periodic and nested discrete functions

For a nonnegative integer power `p`, the integral of `Fract(u)^p` has a
continuous piecewise primitive

`(Floor(u) + Fract(u)^(p+1))/(p+1)`.

An affine substitution handles any nonzero exact real slope, negative cells,
partial periods, and reversed bounds. New moments cover powers 2 through 64;
the existing affine discrete integrator handles power one. Sums of at most 64
such moments are evaluated without enumerating every jump. The canonical
form `u-Floor(u)` is recognized too.

For positive integer `m`, the identities
`Floor(Floor(u)/m)=Floor(u/m)` and
`Ceil(Floor(u)/m)=Floor((u+m-1)/m)` reduce nested switches with affine `u`.
They reuse the existing exact discrete integrator. Nonlinear jump sets and
general nested discontinuous expressions still use existing bounded
partitioning or remain unevaluated.

## Endpoint convergence and substitutions

Two-endpoint Beta moments `c*x^p*(1-x)^q` on `[0,1]` require `p>-1` and
`q>-1`. Integer and half-integer shape parameters yield exact factorial and
radical values. Factorization through fractional powers is allowed only when
nonnegativity is proved, preserving principal-root branches. Single-endpoint
power integrals retain the provider and elementary power-rule route.

For a positive exact real `a`, Fermi moments extend the existing Bose path:

- `Integral(1/(exp(a*x)+1), x=0..infinity) = Ln(2)/a`, from
  `u=exp(-a*x)` with transformed bounds one and zero.
- For integer `1<=n<=32`, the result is
  `(1-2^(-n))*n!*Zeta(n+1)/a^(n+1)`.
- The Bose moment with `n=0` still diverges at zero.

For positive `n`, the Fermi formula follows by subtracting twice the Bose
moment at `2a` from the Bose moment at `a`. Both Bose integrals converge, so
this subtraction is justified. These are targeted substitutions with proved
domains, not a general nested-substitution search.

## Series and finite products

Geometric tails and binomial generating functions are replaced by their
closed rational forms only when a continuous interval enclosure proves
`-1<r(x)<1` uniformly over the entire compact integration interval. The
geometric start index is an integer from zero through 1024. Binomial orders
are integers from zero through 32. Boundary convergence, conditional
convergence, and unspecified parameter signs are not inferred from samples.
Removing the single recognized `Sum` strictly decreases the problem before
calling integration again. Bound indices are kept distinct from the
integration variable.

For `P(x)=Product(x+k+c,k=a..b)`, the product multiplied by
`Sum(1/(x+k+c),k=a..b)` is `P'(x)`. Matching bounds and affine factors identify
this relation without expanding the product. Positive integer endpoint
factors permit factorial ratios, with at most 4096 factors. Positivity over
the interval excludes poles in the reciprocal sum. Other products decline.

## Verification and profiling

`test/compute-engine/integrate-competition-exact.test.ts` exercises exact
answers and reversed bounds both with and without Rubi. It also tests unsafe
domains, divergent Bose moments, degree mode, user-defined functions,
assigned variables and indices, and coefficients beyond the machine integer
range. The existing provider, piecewise, cancellation, contour, residue, limit,
and expansion suites protect surrounding behavior.

The shared fixture contains mathematical examples, not copied contest
statements or an imported corpus. Exact regression checks compare symbolic
values and reject inexact numerical leaves; numerical agreement alone is not
an exact-integration success.

To profile independently built before and after bundles:

```sh
npx esbuild scripts/profile-definite-integration.ts --bundle --platform=node --format=esm --outfile=build/profile-definite.mjs
node build/profile-definite.mjs --engine build/ce.mjs --rules build/rules.mjs --repeats 3
```

The profiler records module hashes, Node version, budgets, warmup policy,
individual timings and medians. Run bundles sequentially on an otherwise idle
machine for timing comparisons. Coverage runs with parallel workers are not
performance rankings. Review upstream answer assumptions separately: a match
to an unreviewed reference is not a formally verified benchmark case.

### Focused measurements

On Node 22.14.0, the unchanged main bundle at `a0260c995` matched 9 of the 30
targeted exact references with Rubi. The guarded implementation matches all
30 with and without Rubi. These deliberately targeted examples are regression
coverage, not a representative CAS score.

Illustrative CE with Rubi medians from three warm repetitions are below. The
evaluation budget was 4000 ms; a soft deadline can overshoot. Background tests
were running, so these measurements explain avoided work but do not establish
controlled speedup factors. “Unresolved” is not a successful fast answer.

| Case | Main median and outcome | Changed median and outcome |
| --- | --- | --- |
| `x*(1-x)^99` on `[0,1]` | 691 ms, incorrect negative approximation | 13 ms, exact `1/10100` |
| Radical reflection on `[1,2011]` | 837 ms, spurious imaginary component | 45 ms, exact `1005` |
| `sin(x)^2025*cos(x)^2026` on `[-pi,pi]` | 4045 ms, unresolved | 25 ms, exact `0` |
| `1/(1+tan(x)^2017)` on `[0,pi/2]` | 8695 ms, unresolved | 25 ms, exact `pi/4` |
| `Ceil(Floor(x)/2)` on `[0,20]` | 6 ms, unresolved | 25 ms, exact `100` |
| `1/(1+exp(x))` on `[0,infinity]` | 70 ms, unresolved | 5 ms, exact `Ln(2)` |
| Product derivative with 2023 factors | 196 ms, unresolved | 18 ms, exact `2023*2023!` |

The new suite and the existing provider/piecewise suites have 214 passing tests
on both Node 22.14.0 and Node 26.10.0, including the separately run direct
primitive regression. The separately enabled checkpoint canary passes
46 tests. Source and test type checks, public declaration checks, changed-file
lint, formatting, and the zero-cycle dependency check pass.

The repository-wide Node 22 Jest run completed with 53899 passing tests and
17 failing tests across 10 suites; 928 tests were skipped and one was marked
todo. The three focused integration suites passed. Failures include Windows
path/environment expectations, function typing, recursion handling, and an
asynchronous precision timeout. Their attribution requires comparison against
unchanged main; a full-suite pass is not claimed. The report is retained as
`build/full-tests-node22.json`. The focused Node 26 checks above are not a
full-repository Node 26 run.

### Complete imported MIT definite comparison

All 262 imported MIT definite cases were run, with no sampling. The paired
comparison uses frozen before/after bundles and the same harness and budgets:
30 seconds solving, 120 seconds setup, 10 seconds verification, two workers per
configuration, and a 300000-step Rubi budget. Each journal has 262 unique IDs
matching the input population. These are exact matches to unreviewed upstream
references, not formally certified answers or all printed MIT problems.

| Outcome | CE before | CE after | CE with Rubi before | CE with Rubi after |
| --- | ---: | ---: | ---: | ---: |
| Exact reference match | 56 | 74 | 103 | 122 |
| Unverified answer | 1 | 4 | 4 | 7 |
| Numerically supported only | 0 | 0 | 5 | 5 |
| Numeric mismatch | 0 | 0 | 1 | 0 |
| Approximation only | 0 | 0 | 3 | 1 |
| Not solved | 205 | 184 | 146 | 127 |

No previously exact reference match was lost. Three adapter translation errors
remain in each run. CE timeouts increased from one to four among already
unsolved cases; CE with Rubi timeouts decreased from seven to six. Parallel
contention and one cold attempt per case make those timing outcomes diagnostic,
not a controlled performance comparison.

The paired coverage snapshot precedes the elementary-provider routing and
discrete-deadline compatibility corrections. All 262 CE-only cases were rerun
on the final guarded build, with identical verification verdicts. CE with Rubi
coverage above remains the earlier snapshot; the final guarded build is checked
by the focused Node 22/26 suites and all 30 exact-answer profiling fixtures in
both modes. Frozen bundle hashes and the 1310-record audit are retained with
the local benchmark reports. Imported corpus records are not part of this CE
change.

## Remaining coverage

The subsequent implementation and its bounded family coverage are described
in [General definite integration families](./general-definite-integration-families.md).

General branch certification of provider primitives, unrestricted parameter
differentiation, arbitrary inverse substitutions, conditionally convergent
series, general infinite products, and more complex piecewise jump sets need
additional algorithms and tests. Unknown convergence
or an unsupported reduction returns control to the existing integrator; it is
not proof that the integral diverges.

In the CE with Rubi comparison, the largest remaining unsolved syntax families
are trigonometric (37), piecewise/discrete (24), general algebraic (17), and
exponential and logarithmic (12 each). These are syntax classifications, not
proofs of which integration method each problem needs.

The general-family implementation also covers Beta-prime moments
`x^p/(1+x)^m` on `[0,infinity]` and generalized Beta moments
`x^p*(1-x^r)^q` on `[0,1]`, with transformed-bound and convergence checks.
Keeping these forms factored avoids the expansion cost exposed by the
initial competition comparison.
