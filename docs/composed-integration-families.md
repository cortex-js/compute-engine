# Composing exact integration families

These extensions connect existing CE algorithms and add bounded reductions for
five families. They use the existing `Integrate` interface and do not recognize
competition IDs or use benchmark reference answers. Unsupported inputs remain
with the existing integrator; rejection of a method is not a divergence claim.

## Review: solver priority and original-domain checks

The established provider/native primitive path runs before the new general
definite reductions. A closed, usable exact result retains its existing form.
The native logarithmic recurrence and compositional search likewise follow
the established antiderivative strategies. Bare affine trig/hyperbolic heads
and reciprocal syntax decline speculative rationalization; integer powers also
retain their established indefinite route. Thus elementary tangent and
`x*Ln(x)` keep their existing representations.

Candidate loops cancel only structurally identical multiplicative bases; they
do not call `simplify()`. Expensive rational reduction is considered only after
the old variable has disappeared, with bounded rational degrees. The affine
normalization in the definite substitution engine retains its existing degree
guard. The search is bounded, not a general algebraic-equivalence oracle.

Three exceptions to primitive-first ordering are explicit:

- Existing discontinuity/kink and symbolic-exponent splitting must precede
  endpoint subtraction. If finite piecewise splitting declines (for example,
  `x^2-Floor(x)*Ceil(x)` on `[0,2022]`), a certified compact reduction may
  still solve it without enumerating every cell.
- Sparse reciprocal denominators with powers above 64 try their direct
  reciprocal-pair reduction before polynomial expansion. The reducer proves
  positivity of the original denominator on the positive reciprocal interval.
  The degree-2022 rational fixture is an example.
- Powers above 64 try the direct generalized-Beta terminal, not substitution
  search. For example, `(1-x^(1/2024))^2024` on `[0,1]` has a factored Beta
  value; expanding its primitive first is prohibitively expensive. The
  terminal proves its positive-domain and endpoint convergence conditions.

Every successful general fallback is checked against the original integrand
with `interiorPoleVerdict` and the constant-factor pole check before its answer
is accepted. Main's exponential-divisor support is included, so finding a new
primitive for `exp(x)/(exp(2*x)-1)` cannot justify subtraction across zero.
An unsuccessful reduction does not change an unsupported integral into a
divergence classification. In particular, reciprocal elementary functions
without a closed native primitive retain main's inert behavior.

The reductions carry their own parameter and interval conditions. The generic
speculative symbolic-pole scan cannot replace those certificates: it treats
the bound positive integer in a telescoping product as an unconstrained free
parameter. Concrete original-domain pole checks still apply.

The optional Rubi polynomial/exponential/trig recurrence permits symbolic
polynomial coefficients because it performs finitely many coefficient
operations and divides only by a nonzero rational determinant. Logarithmic
substitution instead launches recursive integration, so free symbolic
coefficients remain excluded to avoid speculative symbolic rational searches.

The earlier frozen competition counts below describe their recorded builds,
not a newly measured score for these review changes.

### Review diagnostics

The portable profiler includes `--suite ordinary` for the reported elementary
cases and the exponential-pole regression. On Node 22.14.0, one warmup and three
timed solves of the corrected bundle give these local medians:

| Case | Median |
| --- | ---: |
| coth on [-1,1] | 21 ms |
| 1/sinh on [-1,1], left inert | 7 ms |
| tan on [-1,1] | 16 ms |
| tan on [0,1] | 14 ms |
| x*Ln(x) on [1,e] | 13 ms |
| exponential pole on [-1,1], Indeterminate | 19 ms |

The preceding PR bundle reaches the eight-second diagnostic budget on coth
and some reciprocal-sinh repeats, and its symmetric tangent median is 3.24 s.
Machine load changes during these sequential runs, so these are not precise
speedup ratios. A separate alternating-build check (five warmups and ten timed
solves per build) gives main/fixed wall medians of 31/33 ms for coth, 15/14 ms
for reciprocal sinh, 253/242 ms for tangent, and 155/162 ms for x*Ln(x).
The changing absolute times illustrate why these are machine-local diagnostics,
not a portable performance ranking.

The new routing tests exercise all twelve elementary trig/hyperbolic heads,
reciprocals and integer powers; ensure established primitives do not call the
composition search; vary exponential-pole slopes, positions and orientations;
preserve root syntax during structural cancellation; and test symbolic
coefficients in the finite Rubi recurrence. The 20 routing tests and 63 Rubi
helper tests pass together on Node 26. A 52-test Node 22 review recheck and a
23-test final structural/substitution recheck also pass. The latter includes
mixed radicals and nested substitutions. These are overlapping targeted
checks, not a full repository pass or a replacement competition score.

## Rubi substitution helper follow-up

The Rubi rule trace for `Cos(Ln(x))` stops without a recursive sub-integral:
the existing `FunctionOfLog` consumer handles `F(Ln(x))/x`, not the Jacobian
needed here. Independently tracing `exp(x)*Cos(x)` through the Rubi driver
also returns no primitive (the public integrator can still use its native
fallback). A new logarithmic substitution connects these steps, and a finite
coefficient recurrence closes `P(x)*exp(a+b*x)*Sin/Cos(c+d*x)` for polynomial
degree at most eight and rational slopes. It therefore also handles polynomial
factors in the logarithm, shifted affine log arguments, and weighted variants
when the transformed expression closes. It is not an example-specific formula.

Three Rubi utility placeholders now have bounded implementations:

- `SubstForFractionalPowerOfLinear` returns the original four-element Rubi
  tuple, with the Jacobian split between the tuple and its rule consumer. It
  combines fractional powers of one affine base using their least common
  denominator, at most twelve.
- `InverseFunctionOfLinear` finds a supported inverse function of an affine
  argument. `SubstForInverseFunction` replaces the chosen inverse first, then
  replaces the original coordinate using its forward function. It does not
  cancel other inverse/forward compositions or assume their branches agree.
- The inverse-rule consumers also require Wolfram-compatible inverse head
  names, `Part` on function arguments, and the specific constant-base
  exponential `MatchQ` predicate. Tests require each of the four bundled
  arctangent/arccotangent/artanh/arccoth substitution rules to fire.

These helpers require literal nonzero rational slopes. Their tree traversal
is limited to 128 nodes and powers of magnitude at most 32, and rejects
calculus and binding constructs. They neither introduce assumptions about
free parameters nor rewrite bound variables. A logarithmic substitution is
retried only when it removes all dependent logarithms, preventing a cycle.
Existing rule priority and successful existing answers take precedence.
The speculative logarithmic driver path also declines free parameters, to
avoid spending the rule budget on symbolic-coefficient rational subproblems.

The `FunctionOfLinear` and `PowerVariableExpn` guard placeholders are not
changed: their alternative substitution consumers are not bundled, so turning
the recognizers on alone would disable usable integration-by-parts rules.
Likewise, this follow-up does not claim complete upstream Rubi utility
semantics or implement definite symmetry, nested floor integration, or a new
convergence algorithm.

`rubi-substitution-helpers.test.ts` checks tuple Jacobians, isolated corpus-rule
consumers, derivative identities and finite differences, complex logarithms,
alternative variables, endpoint behavior, and rejection cases.
`scripts/profile-rubi-substitutions.ts` accepts independently frozen engine
and rule bundles and records one warmup plus three timed repetitions. This is
a local diagnostic, not a cross-machine performance ranking.

The frozen diagnostic compares the preceding PR build (`1bb5784e`) with the
helper implementation, with Rubi enabled on both. Seven previously unevaluated
fixtures return primitives: six logarithmic compositions and a degree-four
polynomial times an exponential and sine. The other five fixtures retain
answers. For example, `Cos(Ln(x))` now returns the equivalent of
`Exp(Ln(x))*(Cos(Ln(x))+Sin(Ln(x)))/2`, retaining the logarithm's domain.

| Warm diagnostic | Before | After | After median (ms) |
| --- | --- | --- | ---: |
| `Cos(Ln(x))` | Unevaluated | Primitive | 231 |
| `Ln(x)^2*Sin(Ln(x))` | Unevaluated | Primitive | 512 |
| `x^2*Cos(Ln(x))` | Unevaluated | Primitive | 255 |
| `x^4*Exp(-2*x)*Sin(3*x)` | Unevaluated | Primitive | 786 |

These Node 22.14.0 measurements use one warmup, three repetitions, a
4-second cooperative deadline, and 300,000 rule steps. Other background work
was active, so the times are evidence of bounded completion, not speedup
claims. All twelve final primitives were separately checked against direct
55-digit quadrature of the original integrands on `[0.4, 1.3]`; three
logarithmic fixtures were also checked on `[-2, -0.4]` with principal complex
values. All fifteen primitive-difference comparisons meet a `1e-45` relative
tolerance. These checks do not certify behavior across singularities or cuts.

Validation: all 63 new helper/composition tests pass on Node 22.14.0 and
26.10.0; all 334 existing tests in the five Rubi utility, matcher,
normal-form, driver, and substitution suites pass on Node 22.14.0. Five
wall-time-sensitive existing tests initially returned unevaluated results
under competing solver load; the complete isolated rerun passes with their
original budgets. No test deadline was increased. Changed-source lint, source
and test type checking, formatting, and the dependency-cycle check pass.
This is targeted validation, not a full repository/CI pass.

The frozen optional rule bundle has SHA-256
`4ed13d1295c3671e3f2006659bbc29b25c7b6ca410386459d90e04161f997985`;
rebuilding the current implementation reproduces it. The core-engine bundle
is byte-identical to the preceding build, so this follow-up does not change
native integration when the optional rule package is not loaded.

### Complete competition comparison with Rubi enabled

Both frozen builds completed all 976 competition cases, with matching unique
case IDs, case hashes, corpus/harness fingerprints, Node 22.14.0, three workers,
and unchanged hard budgets: 30 seconds solving, 10 seconds verifying, and
120 seconds loading the engine/rules. The rule budget is 300,000 steps.
This compares against the preceding PR build, not a new main-branch baseline.
Counts refer to benchmark records; equivalent integrals can occur in different
sources. This is not every printed competition problem.

| Original run outcome | Before | After |
| --- | ---: | ---: |
| Returned answers | 624 | 644 |
| Unevaluated | 333 | 313 |
| Solver timeouts | 15 | 15 |
| Exact reference matches, unreviewed | 154 | 156 |
| Local derivative identities | 370 | 382 |
| Restricted-domain identities | 20 | 23 |
| Verifier timeouts | 24 | 22 |

All twenty new answers contain no inexact numeric literals: eighteen are
indefinite and two are definite. Twelve pass local derivative checks, three
pass restricted-domain checks, and two exactly match unreviewed imported
references. Three trig/hyperbolic answers remain `unverified` in the original
journal; independently differentiating the stored answers and rewriting to
exponentials proves zero residual for all three, without using references or
introducing branch assumptions. Those supplementary proofs do not relabel the
original benchmark records.

No previously returned answer is lost or changed. One unchanged answer's
identity check timed out in the new run; a separate fresh verification of the
stored answer passes within the same ten-second budget. Other verifier-only
label changes are retained, not counted as solver improvements. Across the
full final run, 54 answers remain labeled unverified, 22 hit the verifier
budget, five have numerical support only, and two are approximation-only.
Three adapter translation failures and one divergent result are unchanged;
seven source translation failures remain outside the 976-case population.
No mismatches were detected, but this is not a global-domain correctness proof.

The full Rubi corpus baseline remains paused. These results are for the
competition corpus with the optional Rubi package enabled; the earlier native
competition comparison below is a separate measurement.

## 1. Compositional substitution and rationalization

`integration-composition.ts` forms `f/g'`, replaces an inner expression `g` by
a fresh coordinate, and proceeds only if the original variable disappears.
Integer monomial relations and proportional exponential phases allow matching
beyond identical syntax trees. The transformed problem goes back to the
primitive or definite integrator, rather than only to a fixed list of terminal
formulas. Thus `x^(2r-1)*exp(x^r)` can use the existing integration-by-parts
algorithm after `u=x^r`.

For definite integrals, the supported maps are positive powers on a positive
interval, logarithms on that interval, and exponentials with a real nonzero
affine phase. Reversed and infinite endpoints are transformed explicitly.
The downstream definite solver still resolves endpoint limits and poles.
Fractional-power rationalization uses a common denominator at most twelve
and requires a certified positive real domain; an unrestricted complex
primitive does not acquire that assumption.

Search uses at most six candidates and two nested levels, excludes binders
and discrete selectors, and checks the caller's deadline. The shared rational
coordinate helper bounds numerator and denominator degrees at 24 *before*
constructing common denominators or expanding. These are conservative work
limits, not statements about elementary integrability.

The speculative composition search excludes free symbolic coefficients:
degree alone does not bound symbolic coefficient algebra and expansion.
Those inputs retain the established native/provider routes. Numeric exact
coefficient variations still describe general families; this extension does
not claim unrestricted parameter-dependent rationalization.

## 2. Trigonometric and hyperbolic coordinates

`integration-normalize.ts` rewrites reciprocal trig functions using sine and
cosine, and hyperbolic functions using exponentials. It retains denominator
structure and respects CE's radian convention. Small integer powers of
quotients are normalized before choosing a substitution.

For `sin(u)^m*cos(u)^n`, integer `m+n` even allows `t=tan(u)`:

`sin(u)^m*cos(u)^n du = t^m*(1+t^2)^(-(m+n)/2-1) dt`.

This often produces a much smaller rational expression than the half-angle
substitution. Definite use requires a continuous original integrand and one
tangent chart. Tight sine/cosine interval enclosures include all intervening
critical points, so an interior zero cannot be skipped. Other supported
rational trig expressions use the existing split half-angle charts.

The half-angle transformation stays on the split definite path. A generic
local indefinite primitive such as `2*Arctan(Tan(x/2))` cannot safely feed
ordinary endpoint subtraction across charts. Supporting that extension needs
domain-bearing primitives or explicit winding corrections. Full-period and
reversed-bound regressions prevent this shortcut from returning zero. Simple
sine/cosine cells retain their registered-provider route.
Elementary affine trig/hyperbolic primitives and integer powers also retain
their established native/provider routing. Rationalizing `Tanh(x)` or `Sech(x)`
would add unnecessary branch and verification complexity without solving a new
problem.

## 3. Logarithmic recurrences and parameter differences

`integration-logarithmic.ts` integrates `c*x^p*Ln(x)^m` for integer
`1<=m<=8` using a finite integration-by-parts recurrence. With `a=p+1`, its
primitive is

`c*x^a * sum_{j=0}^m (-1)^j*m!/(m-j)! * Ln(x)^(m-j)/a^(j+1)`.

The `a=0` case uses `c*Ln(x)^(m+1)/(m+1)` instead. Unknown parameter signs or
unsupported branches are not guessed.

On `[0,1]`, a linear combination `sum c_j*x^p_j/Ln(x)` is reduced to
`sum c_j*Ln(p_j+1)` when every `p_j>-1` and `sum c_j=0` exactly. Differentiating
with respect to a power parameter gives `1/(p+1)`; subtracting a common power
fixes the constant. The coefficient condition makes the endpoint at one
removable. Individual divergent logarithmic-denominator terms are never
integrated separately. This is not a general artificial-parameter search.

## 4. Interacting selectors and reciprocal weights

`definite-discrete-algebra.ts` expresses polynomial interactions of `Floor`,
`Ceil`, and `Fract` sharing one affine phase in terms of a single floor value.
Off the finite jump set, `Ceil(u)=Floor(u)+1` and `Fract(u)=u-Floor(u)`.
Polynomial surroundings ensure that changing isolated point values does not
alter the integral. Selector denominators and singular outer functions are
excluded. Degree-eight coefficients delegate to the weighted-moment engine;
work does not grow with the number of cells.

For a positive affine phase `u`, the primitive of `Floor(u)/u` is
`n*Ln(u)-Ln(n!)`, with `n=Floor(u)`. Adjacent formulas agree at integer
boundaries. Ceiling and fractional-part variants follow by linearity, including
partial cells and reversed orientation. Exact factorial construction is bounded
to cell indices at most 4096. This does not cover arbitrary rational weights,
unrelated selector phases, or arbitrary nested floor expressions.

## 5. Polynomial generating functions and shifted products

`definite-series.ts` handles `Sum(P(n)*r(x)^n,n=N..infinity)` for polynomial
`P` of degree at most six and `0<=N<=32`. A symbolic range enclosure must place
`r` strictly inside `(-1,1)` on the compact integration interval. This proves
uniform absolute convergence even with the polynomial weight. Repeated use
of `r*d/dr` on `1/(1-r)` constructs the rational generating functions, and a
bounded finite prefix handles nonzero starting indices. A convergence-boundary
example is explicitly rejected by this reduction.

The finite product recognizer now permits `g(n+m)/g(n)` with integer
`1<=m<=8`, where `g` is affine in the index. It leaves only the first and last
`m` factors. All factors in the extended index interval must be nonzero on the
integration interval before cancellation. General infinite products still need
their separate convergence proofs.

## Exactness and verification

A registered provider may return a closed primitive whose endpoint evaluation
contains approximations. For exact inputs and a symbolic request, CE now tries
an exact native alternative in that situation. It does not unregister the
provider or bypass the existing pole, branch, and endpoint checks. Rubi-enabled
hyperbolic regressions cover this case.

The separate integral-benchmark checkout also contains verifier fixes:

- Integer exponents, including lexically bound sum/product indices, can
  discharge a CE-versus-principal-power warning.
- A symbolic range proof can discharge a warning on a real integration
  interval, without assigning real assumptions to unrelated parameters.
- Exact Gamma recurrence/reflection and Beta normalization compare equivalent
  special-function answers. Matching a reference does not certify convergence.
- Scientific notation for a metadata-certified exact integer is exported as
  integer digits. Bounded chunk parsing supports large factorial answers without
  disabling Python's global integer-string safety limit.

These benchmark changes are separate from the CE source PR. Unresolved branch
warnings and missing references remain unverified. Imported reference matches
retain their unreviewed label, and local derivative identities are not claims
of global domain correctness.

`integrate-composed-families.test.ts` checks generated parameter variations,
orientations, exact output, domain rejections, provider compatibility, and work
limits. `fixtures/integration-composed.ts` supplies twelve reproducible examples
to the portable profiler's `--suite composed`. Numerical derivative checks and
independent high-precision quadrature supplement exact-output checks; they do
not replace proofs or silently promote unresolved benchmark results.

The full competition comparison uses the same 976 inputs as the preceding PR
baseline: 312 definite and 664 indefinite records, with Rubi disabled. Source
translation failures remain outside this population and adapter failures remain
inside it. Superseded partial runs are preserved and excluded from full scores.
Solver changes and verifier-only rechecks are reported separately.

## Focused verification and performance

The corrected build passes 986 tests across 14 suites on Node 22.14.0,
including all 98 new family tests, 64 Rubi substitution tests, and 824 existing
regressions. Node 26.10.0 also passes all 98 new tests. The existing coverage
includes endpoint and interior poles, improper integrals, symbolic bounds,
angular units, step budgets, piecewise integration, and provider routing.
Independent 55-digit quadrature and convergent-series checks cover 45 cases,
both natively and with the Rubi provider enabled; all agree within `1e-45`
relative tolerance. Numerical agreement supplements the derivations above;
it does not certify global branches or turn an unreviewed reference into a
reviewed one.

The portable profiler's twelve composed fixtures move from one exact match
on the preceding build to twelve. Three-repeat warm medians on the corrected
build range from about 10 ms to 2.6 seconds under concurrent local test load.
The quadratic generating-function case is the slowest fixture. All 21
reciprocal fixtures remain exact matches; the degree-2022, bound-2022 case
has an approximately 12 ms warm median. These are diagnostic observations,
not controlled cross-machine speedup measurements.

The profiler explicitly opens `withTimeLimit()` spans for solving and answer
comparison. Assigning the retired `ce.timeLimit` property does not arm a
deadline. These cooperative spans remain distinct from the full benchmark's
hard, per-process solver timeout.

An intermediate full run times out on two large affine-power primitives under
concurrent test load.
A separate paired diagnostic returns the same exact formulas for both builds:
`x*(1-x)^2014` takes approximately 26.1 s before / 23.3 s after, and
`x*(1-x)^2020` takes 21.4 s before / 16.7 s after. This does not demonstrate a
new slowdown; these existing slow paths remain sensitive to load near the
30-second hard limit. Diagnostic reruns do not replace recorded full-run
timeouts or count as additional benchmark successes.

Provider stress testing also checks `(a+b*Tanh(x)^2)^3*Tanh(x)^4`. A 55.7-second
CPU capture of an intermediate build attributes 23.8 seconds to speculative
composition, including 19.7 seconds under expansion. That build exceeds a
100-second diagnostic watchdog, whereas the preceding build solves in about
39.9 seconds. Excluding free symbolic coefficients and preserving elementary
integer-power routing restores the solve to about 37.6 seconds, with the same
evaluated primitive. The generic search must not replace a specialized route
with larger exponential rational expressions merely because their degrees
fit a nominal limit.

A full-run regression exposed the danger of passing a local half-angle
primitive to ordinary endpoint subtraction: an integrand equal to one away
from removable trig holes incorrectly evaluated to zero over a full period.
The generic indefinite shortcut is excluded, and positive/negative full-period
regressions protect the definite chart path. This example remains unsupported
unless cancellation of the removable holes is independently certified.

## Complete frozen competition comparison

The final run completes all 976 unique cases, with matching case IDs and hashes.
It uses Node 22.14.0, three workers, a 30-second hard solver limit, a 10-second
verifier limit, a 120-second setup limit, and warm verification, with Rubi off.
The baseline is the preceding rational-fix implementation on this PR, not a
fresh main-branch run. Reverification preserves every prior solver record.

| Outcome | Prior raw report | Prior results, reverified | Final guarded build |
| --- | ---: | ---: | ---: |
| Returned answers | 284 | 284 | 368 |
| Definite returned answers | 99 | 99 | 126 |
| Exact definite-reference matches, unreviewed | 90 | 97 | 123 |
| Local derivative identities | 109 | 109 | 143 |
| Solver timeouts | 5 | 5 | 5 |
| Verifier timeouts | 13 | 17 | 17 |

There are 84 newly returned answers: 27 definite and 57 indefinite. Of those,
59 have a reference match or local derivative identity; the other 25 remain
unverified. The final report retains 85 unverified answers and 17 verification
timeouts overall. No prior returned answer or prior reference/identity evidence
is lost. No mismatches are detected, which is not a correctness claim for the
unverified answers.

New returned answers span the inventory's syntax-based classifications:
23 exponential, 20 logarithmic, 13 trigonometric, 9 hyperbolic, 8 general
algebraic, 6 radical, 2 inverse-trigonometric, 2 exponential-logarithmic, and
1 piecewise/discrete. These labels are not proofs of which algorithm solved a
case. Series/product coverage is additionally exercised by the generated unit
families and independent checks; the competition inventory does not uniformly
exercise every implemented family.

Seven source translation failures remain outside the 976-case population;
three adapter translation failures remain inside. This inventory includes 866
MIT records and is not every printed competition problem. References retain
their unreviewed status. Full Rubi baseline work remains paused. Earlier
diagnostic builds, including the one with the chart-boundary bug, are excluded
from the final score.

Frozen SHA-256 fingerprints:

- Prior CE bundle: `be3fbd1ac3b3dfea0f998bb67c7db66433d4d4910d3c1889a37b4c06046e7fe3`.
- Final CE bundle: `cad4ba9e676dc525ab59e7ed001fa7f74388f195c283d22f28d90a88a715a6f9`.
- Prior harness: `b1d93401bea44edd3a011b5184a287316a18ea503d0a1dbe26a60bd3696e63c2`.
- Final/reverification harness: `2c99f88e2ca7b0d4fea64beb1c6d3f8b6a3f8bf4d6ebd16bd0ee52768b8261f9`.

Rebuilding the current source reproduces the final bundle fingerprint. The
local audit checks completeness, uniqueness, case hashes, budgets, runtime,
unchanged baseline solver records, and answer/evidence retention. The earlier
repository-wide run has 17 untriaged failures; these targeted checks do not
constitute a full-repository or CI pass.
