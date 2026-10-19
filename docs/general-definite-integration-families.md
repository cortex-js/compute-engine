# General definite integration families

The definite integrator combines substitutions, parameter derivatives,
trigonometric transformations, weighted discrete moments, and convergent
series or products. Each reduction covers a parameterized mathematical family;
none uses competition IDs, reference answers, or matching against a problem
list. Existing primitive providers, including optional Rubi, remain fallbacks.
Parameters and bounds must satisfy the methods' exact sign and domain checks.
Unspecified symbolic parameter signs are not inferred, and these methods do
not introduce conditional answers for assumptions the resolver cannot prove.

The follow-on [composed integration families](composed-integration-families.md)
describe reuse of the full integrator after substitution, logarithmic
recurrences, interacting selectors, and polynomial generating functions.

## Substitution and composition

`definite-transform.ts` supplies a bounded transformation search and an internal
`DefiniteReduction` record containing the answer, methods, substitutions, and
established conditions. The existing public `Integrate` API returns the value;
the internal record does not add a new public API contract.

Derivative matching recognizes `f(x)=g'(x)*h(g(x))`. A structural enclosure must
prove that `g` is continuous and monotone throughout the finite interval.
Only an exact cancellation that removes the original variable is accepted.
The transformed terminal method then establishes integrability. This route
needs no inverse branch. Affine interval normalization is another candidate.
Search has a maximum depth of three and twenty candidate attempts, memoizes
visited problems, and does not rewrite through binders. Trigonometric and
switching expressions remain with their dedicated methods.

After direct terminal formulas have been tried, a structural polynomial check
declines further substitution search without expanding the expression. The
existing primitive path is better suited to these inputs. This prevents
derivative candidates and affine normalization from expanding sparse or affine
high-degree polynomials before the normal integrator gets a chance. Seven
parameter-grid regressions check the routing and exact answers.

The first terminal recognizes `c*x^p*(A+B*x^r)^q`, with positive `A` and `r`.
For `B<0`, the upper endpoint must be the positive zero of the binomial.
For `B>0`, the bounds must cover the positive half-line. Writing
`a=(p+1)/r`, the substitution `u=abs(B)*x^r/A` gives the scale factor
`c*A^q*(A/abs(B))^a/r` and respectively:

- `Beta(a,q+1)`, requiring `a>0` and `q+1>0`;
- `Beta(a,-q-a)`, requiring `a>0` and `-q-a>0`.

These conditions establish both endpoint convergence and the real branch of
the fractional powers. Reversed bounds negate the result. Canonical `Root`
and `Sqrt` inputs are recognized without distributing fractional powers over
arbitrary products. Large exponents remain factored. Exact special functions
are valid closed forms; numerical approximation is not substituted for one.
The base identities are Euler's Beta and Beta-prime integrals in
[DLMF 5.12](https://dlmf.nist.gov/5.12).

If either Beta parameter is a positive integer at most 64, a short rising
factorial quotient reduces the answer directly. This preserves small rational
answers when the other parameter is large, without constructing and then
cancelling large factorials. The competition comparison caught an answer-form
regression in this path; the correction has a separate frozen bundle and
parameter-grid tests, rather than overwriting the original run.

## Parameter differentiation

`definite-parameter.ts` evaluates mixed logarithmic Beta moments:

`Integral(x^(a-1)*(1-x)^(b-1)*Ln(x)^j*Ln(1-x)^k, x=0..1)`.

For positive `a,b`, these are mixed parameter derivatives of `Beta(a,b)`.
An integrable power-log bound exists in a neighborhood of those parameters,
justifying differentiation under the integral. A memoized multivariate
Leibniz recurrence computes derivatives up to total order six. Positive
integer and half-integer polygamma values reduce through their recurrence to
exact logarithms, zeta values, and finite sums. Other positive arguments retain
exact polygamma expressions.

A second family introduces the coefficient parameter in
`Ln(1+c*x^r)/x`, with `r>0`, over `[0,b]`. Differentiation with respect to `c`
gives an elementary rational integral, and the value at `c=0` fixes the
constant. The answer is `-PolyLog(2,-c*b^r)/r`. The condition
`1+c*b^r>=0` excludes a real logarithm branch crossing; equality admits an
integrable endpoint logarithm. This is a family recognizer with a derivation,
not an unrestricted search for artificial parameters or a general Leibniz-rule
engine with moving endpoints.

## Rational trigonometric transformations

`definite-trig-transform.ts` handles rational functions of sine and cosine
sharing one affine phase, in radians. The original integrand must have a
certified real continuous enclosure on the finite interval. The substitution
`t=tan(phase/2)` replaces sine and cosine by rational functions and includes
the Jacobian. Rational numerator/denominator collection and polynomial
cancellation precede delegation to the existing definite integrator.

Every odd-pi chart boundary is located exactly and splits the transformed
problem into monotone intervals. A chart pole is not classified as an
integrand pole. The method limits integer powers, expression size, and chart
count. Existing full-period residue integration remains available through the
normal fallback; this change does not duplicate the contour engine.

## Weighted discrete and accumulating jump integrals

`definite-periodic.ts` integrates polynomial weights of degree at most eight
against powers one through eight of `Floor(a*x+b)`, `Ceil(a*x+b)`, and
`Fract(a*x+b)`. This includes negated weights and first moments needed by
selector-polynomial decomposition. Negative slopes, negative cells, partial periods, and reversed bounds
use one continuous piecewise primitive.

After affine substitution, put `u=n+t`, where `n=Floor(u)` and `0<=t<1`.
Expand the polynomial weight in `n+t`, integrate powers of `t`, and sum powers
of `n` using Faulhaber's recurrence. Its polynomial identities also represent
oriented sums at negative integer indices. The work depends on the polynomial
degree and moment order, not on the number of cells. Tests compare this method
with the independent finite root-partition integrator and cover a billion
cells exactly.

For an accumulating jump set, the identity
`Floor(c/x)=Sum(1_(x<=c/n),n=1..infinity)` gives
`Integral(x^(s-1)*Floor(c/x),x=0..c)=c^s*Zeta(s)/s`, for `c>0,s>1`.
Nonnegative termwise integration proves the formula. Polynomial weights with
zero constant term use linearity; corresponding ceiling and fractional-part
moments follow algebraically. The existing nonlinear root partitioner still
handles finite nonlinear switches. Arbitrary accumulating or interacting jump
sets are not newly certified.

## Series and products

`definite-summation.ts` adds four general reductions:

- Mellin moments `x^p*Ln(x)^m/(1-x^r)` on `[0,1]`, with `p>-1`, `r>0`,
  and integer `1<=m<=8`, become Hurwitz-zeta values. An absolutely integrable
  geometric expansion justifies interchange even though convergence is not
  uniform at the endpoint. The plus denominator also allows order zero,
  evaluated as a convergent digamma difference rather than divergent zeta
  terms. For positive integer/half-integer Mellin parameters, the recurrence
  `J(a+1)=1/a-J(a)`, with `J(1)=Ln(2)` and `J(1/2)=Pi/2`, preserves elementary
  values. An independent polynomial-division grid tests this reduction, so
  series recognition does not replace basic rational answers with unsimplified
  quarter-argument digamma values.
- Nonnegative series `Sum(x^(r*(n+a)-1)/(n+a)^k,n=N..infinity)` integrate
  to `HurwitzZeta(k+1,N+a)/r`, with `r>0`, `N+a>0`, nonnegative integer `N`,
  and integer `1<=k<=8`. The finite zeta integral sum establishes convergence.
  Tests vary the starting index, exponent scale, and shift, including negative
  shifts whose first summation denominator is still positive.
- Finite products `Product(g(n+1)/g(n),n=a..b)` telescope when `g` is affine
  in the index and every factor is proved nonzero throughout the integration
  interval. Comparing polynomial coefficients preserves bound-index scope.
- Infinite telescoping products use `g(n)=1+c(x)/(n+d)^p`, positive factors,
  positive starting denominator, and integer `1<=p<=8`. On a compact interval,
  bounded continuous `c(x)` gives uniform convergence of `g(n)` to one.
  The product becomes `1/g(start)` before integration.

These checks do not authorize arbitrary exchanges of sums, products, limits,
and integrals. A failed condition returns to the existing integrator; it does
not assert divergence.

## Verification

`fixtures/integration-families.ts` contains generated parameter grids and
mathematical regression examples. The suite runs every fixture in both
orientations, with and without Rubi, checks exact symbolic agreement, and
rejects inexact number leaves. Separate tests reject invalid convergence and
branch conditions, hidden zeros in products, shadowed library functions,
non-radian trig substitutions, and bound-variable leakage.

The portable profiler accepts `--suite families`, `--suite polynomials`, or
`--suite reciprocal` to
run the corresponding shared fixture grids against independently built bundles.
Timings record runtime, module hashes,
budgets, warmup, and repeated solver measurements. Concurrent coverage workers
make these diagnostic timings, not controlled cross-engine speed rankings.

The complete comparison population contains 976 imported records: 866 MIT and
110 additional CMIMC, HMMT, Wisconsin, and Berkeley records. Both definite and
indefinite records are retained. The comparison uses identical per-case
budgets and a frozen harness. An initial four-configuration run included
both provider modes; the final complete comparison is CE-only, as explained
below. Seven untranslated records in the
additional-source inventory remain separately recorded. This population is
not every printed problem from those competitions. References and branch
assumptions retain their existing review status.

The imported population includes 34 explicit floor integrands, 21 sums, and
five products, but no explicit ceiling or fractional-part integrands. The
generated family tests therefore supplement competition coverage; a benchmark
gain alone cannot establish coverage of every new method.

The initial CE-only before/after pair completed all 976 records. Its Beta
answer-form regression was corrected in a separately frozen full CE rerun.
A final reviewed bundle also includes the zero-order moment recurrence;
its audit subsequently found a polynomial-routing performance regression.
The final polynomial-guard bundle corrects that general routing issue. Each
bundle and run is retained separately.
The superseded Rubi-enabled comparison prefixes were stopped and retained,
not presented as full scores. A complete corrected-bundle Rubi-enabled
competition comparison is not claimed; both provider modes are covered by
the family tests. The pre-rational-fix comparison completes all 976 records in each
configuration, with matching IDs, input hashes, runtime, budgets, and harness.

| Full-run outcome | Preceding implementation | Before rational fix |
| --- | ---: | ---: |
| Returned definite answers (312 inputs) | 87 | 98 |
| Exact definite-reference matches | 80 | 89 |
| Local derivative identities (664 indefinite inputs) | 103 | 109 |
| Solver timeouts, all inputs | 10 | 6 |
| Verifier timeouts, all inputs | 28 | 16 |

Nine formerly unevaluated cases now return answers: seven exact reference
matches and two unverified symbolic expressions. Four solver timeouts also
become answers, and one verifier timeout becomes an exact reference match.
These timing recoveries are not all attributed to new mathematical methods.
No previously returned answer was lost or changed, and no previously obtained
exact reference match or local derivative identity was lost. No numerical
mismatch verdict appeared. References remain unreviewed, and identity checks
do not establish global branch or domain completeness.

The final definite-answer population also contains seven unverified results,
one numerically supported symbolic result, and one approximation-only result.
Three adapter translation errors remain inside the 976 inputs, separately from
the seven source translation failures outside that population. Partial Rubi
journals are not full benchmark scores.

All sixteen final verifier timeouts were rechecked separately with the same
ten-second budget. Four completed as unverified and twelve remained timeouts;
no additional reference matches or derivative identities were established.
The original paired-run scores and solver evidence were not overwritten.

After the answer-form and polynomial-routing corrections, all 252 family
tests pass on Node 22 and Node 26. The final bundle matches all 84 generated
profiling references exactly. Independent 45-digit quadrature agrees on all
49 noninteger-parameter, mixed-logarithm, and shifted-phase cases. These
numerical cross-checks supplement, rather than replace, the symbolic checks.
Source/test type checking and changed-source lint pass; the final dependency
check finds no cycles across 460 files. The existing integration-rule,
piecewise, and competition suites also pass all 222 tests against the final
code, for 474 distinct passing Node 22 tests across these four suites. The
shared polynomial fixtures were additionally rechecked after extraction for
the portable profiler.

Earlier in this change, a broader Node 22 run passed 1495 tests and eight
snapshots across 34 integration, contour, residue, limit, compilation, and
expansion suites, with one test skipped. It emitted a worker-shutdown warning
despite exit status zero. Public declaration consumers, type-level contracts,
and CLI type checking also passed. That broader run predates the final
corrections; it is not a new full-repository pass. The previous repository-wide
run's 17 unresolved failures remain documented in the preceding review notes.

The final-bundle warm profile records median solver times of 40.09 ms for
the high-degree fractional-power substitution, 21.07 ms for the scaled
Beta-prime case, and 211.57 ms for nested logarithmic substitutions. The
half-angle chart split median is 272.55 ms. These are
three-repeat diagnostics under concurrent load, not controlled speedups over
the preceding build. The billion-cell weighted-moment test is exact and its
algorithm does not enumerate cells.

The sparse high-degree polynomial that exposed the routing regression timed
out at 30 seconds in three pre-guard full runs. After the guard, its three-repeat
fresh-engine median is 112.48 ms, excluding engine construction. A seven-case
sparse/affine polynomial grid has medians of 36.89-130.60 ms and exact answers
throughout. These timings demonstrate the routing issue and its remedy; they
are not a controlled cross-machine speed ranking.

The final full run returns that polynomial's original rational answer in
148 ms of reported solver time. A high-degree fractional-power Beta case
changes from a 30-second solver timeout to an exact reference match in about
156 ms. One already-unsolved high-degree rational case changed from unevaluated
after roughly 19.8 seconds to the 30-second timeout. The sparse reciprocal
reduction and rational search guard below address that regression; this table
is the preserved pre-rational-fix comparison.

The preceding-build warm profiler ran beyond its requested four-second limit
on a late large-power case and was stopped. Subsequent review found that its
assignment to the retired `ce.timeLimit` property did not arm a deadline.
The profiler now uses explicit `withTimeLimit()` spans for warmup, evaluation,
and reference comparison, and records that cooperative budget semantics in
its output. The historical partial output is retained only for individual
diagnostic observations, not an aggregate before score. The full competition
comparison always used separate process-enforced timeouts and is unaffected.

## Sparse reciprocal rational integrals

`definite-reciprocal.ts` pairs `f(x)` with `f(1/x)/x^2` on positive
reciprocal bounds. It computes their sum using sparse Laurent polynomials,
then requires exact division with zero remainder before integrating the
resulting monomials. This covers rational and logarithmic moments without
factoring high-degree denominators. Coefficients of a single nonzero sign
certify that the original denominator has no positive real zeros. General
nested divisors, fractional powers, mixed-sign denominators, and nonpositive
or nonreciprocal bounds decline rather than assuming continuity.

For example, for positive integer `n` and `b > 0`, the reciprocal sum for
`(1+x^2)/(x^2+x^(n+2))` is `1+x^-2`; its integral from `1/b` to `b` is
`b-1/b`. Another family, `1/(x+x^(n+1))`, has reciprocal sum `1/x`
and integral `log(b)`. The implementation recognizes the algebraic identity,
not these formulas or any competition problem identifier. Reversed bounds
retain the sign. Sparse arithmetic permits at most 64 terms, 4096 work units,
and 32 quotient steps, with bounded integer exponents.

A separate structural numerator/denominator degree estimate keeps rational
expressions above degree 64 out of derivative-matching and affine substitution
search. Direct certified terminals run first; existing primitive providers
remain available afterward. This is a conservative search limit, not a claim
that high-degree rational integrals are unsolvable.

The degree-2022 MIT example previously exceeded the competition runner's
30-second solver budget. A 20.17-second CPU sample of the pre-fix bundle
attributes 92.7% of sampled time to polynomial GCD under substitution
simplification, including 34.7% in power expansion. The problematic call path
is `integrateBySubstitution -> simplify -> cancelCommonFactors -> polynomialGCD
-> expandPower`. The final reciprocal reduction returns `4088483/2022`;
its three-repeat warm median is 14.57 ms on Node 22.14.0. All 21 reciprocal
profiling fixtures match exact references, including degrees through 8192.
These local diagnostics run under concurrent load and are not a cross-machine
performance ranking. The CPU profile was bounded externally because a soft
engine deadline did not interrupt the original expansion promptly.

The dedicated suite checks both native and Rubi-enabled integration, reversed
bounds, logarithmic results, a three-term denominator, zero reciprocal sums,
unsupported inputs, interior and endpoint poles, and the structural search
guard. Tests assert identities and routing behavior rather than fragile
wall-clock thresholds.

## Final competition audit and test results

The rational-fix bundle completes all 976 imported competition cases, with
976 unique IDs and matching input hashes in both compared journals. This is
an incremental comparison against the preceding definite-reduction
implementation, not a new full-population comparison against unmodified main.
The earlier main comparison is recorded in `definite-integration-reductions.md`.

| Outcome | Preceding implementation | Final branch |
| --- | ---: | ---: |
| Returned answers across 976 inputs | 270 | 284 |
| Returned definite answers across 312 inputs | 87 | 99 |
| Exact definite reference matches | 80 | 90 |
| Local derivative identities across 664 indefinite inputs | 103 | 109 |
| Solver timeouts | 10 | 5 |
| Verifier timeouts | 28 | 13 |

No previously returned answer changed or disappeared; no exact reference match
or derivative identity was lost. Timing recoveries are not all mathematical
coverage gains. Compared with the immediately preceding polynomial-guard
bundle, the only solver-status change is the degree-2022 rational integral:
timeout to exact reference match, with 68.56 ms reported solver time. All other
returned answers are unchanged. The reference verifier checks exact equality;
the positive-domain argument above independently justifies this reduction.

The final definite population includes seven unverified answers, one
numerically supported symbolic answer, one approximation-only answer, 208
unevaluated cases, three adapter translation errors, and two solver timeouts.
All thirteen verifier timeouts belong to indefinite cases. Seven source
translation failures remain outside the 976-case inventory. Neither incomplete
provider-enabled journals nor the paused full Rubi corpus are scored here.

The frozen final module SHA-256 is
`be3fbd1ac3b3dfea0f998bb67c7db66433d4d4910d3c1889a37b4c06046e7fe3`;
the preceding implementation is
`a43018d4fdcf2ffd4a48f6d9ea53bb0481c7a37b8ef409e98c19bd47c3ce2a57`.
Both use Node 22.14.0, three workers, 120-second setup, 30-second solve,
10-second verification budgets, and the same warm verifier harness
`b1d93401bea44edd3a011b5184a287316a18ea503d0a1dbe26a60bd3696e63c2`.
A fresh build from the staged source reproduces the final module hash.

Final verification passes 534 tests across the five focused Node 22 suites:
60 reciprocal tests, 252 general-family tests, and 222 competition, piecewise,
and integration-provider tests. Node 26.10.0 passes the 312 reciprocal and
general-family tests. Source and test type checks, changed-source lint,
profiler lint with an explicit script TypeScript project, formatting, and
the 461-file zero-cycle dependency check pass. The 21-case reciprocal profiler
matches every exact reference and exits unsuccessfully on a failed match.
The earlier full-repository failures remain untriaged; this is not a claim
that the entire repository or CI passes.

## Remaining boundaries

The substitution search requires an exactly matched derivative and a proven
monotone inner function. General inverse substitutions, algebraic field
extensions, and automatic splitting of nonmonotone substitutions remain
outside this change. Parameter differentiation is restricted to the derived
families above, not automatic discovery of arbitrary parameterized problems.
Trig rationalization uses one affine phase and conservative continuity bounds;
an inconclusive enclosure declines rather than assuming a denominator is safe.
Weighted jump formulas do not cover arbitrary interacting jump sequences.
Series and product reductions require their explicit convergence checks.

Exact special-function output and a simplified elementary constant are distinct
success levels. For example, some Beta/Gamma answers still need recurrence or
reflection normalization to match a reference syntactically. The independent
verifier may also retain unresolved branch obligations even where the new
integration method establishes a positive real interval. Numerical agreement
is retained as supporting evidence, not promoted to symbolic verification.
