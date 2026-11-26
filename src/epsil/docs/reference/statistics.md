---
title: Statistics Reference
sidebar_label: Statistics
slug: /epsil/reference/statistics/
description: "The statistics library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from statistics.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Statistics

The 43 definitions of the statistics library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### betaDistribution

MathJSON `BetaDistribution` · `(real<0<..>, real<0<..>) -> expression<BetaDistribution>`

- argument 1 — The shape α, positive: the density is proportional to x^(α−1)·(1−x)^(β−1). Sample: `2`.
- argument 2 — The shape β, positive. Sample: `3`.

Beta distribution with shape parameters α and β, on the interval [0, 1].

```epsil
mean(betaDistribution(2, 3))
// ➔ 2/5
```

```epsil
cdf(betaDistribution(2, 3), 1/2)
// ➔ 11/16
```

### betaRegularized

MathJSON `BetaRegularized` · `(complex | infinity, complex | infinity, complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The point x, in [0, 1] for a value in [0, 1]; with four arguments, the lower point z0. Sample: `1/2`.
- argument 2 — The parameter a, positive; with four arguments, the upper point z1. Sample: `2`.
- argument 3 — The parameter b, positive; with four arguments, the parameter a. Sample: `3`.
- argument 4 — With four arguments, the parameter b: the result is I_z1(a, b) − I_z0(a, b). Sample: `3`.

Regularized incomplete beta function I_x(a, b); with four arguments, I_z1(a, b) − I_z0(a, b)

```epsil
betaRegularized(1/2, 2, 3)
// ➔ 11/16
```

```epsil
betaRegularized(0.3, 2, 3)
// ➔ 0.3483
```

### binCounts

MathJSON `BinCounts` · `(xs: collection<number>, bins: list<number> | number) -> list<number>`

- `xs` — The data, finite real numbers; an empty collection stays unevaluated. Sample: `[1, 2, 2, 3]`.
- `bins` — A positive integer number of bins of equal width from the least to the greatest value, or a list of bin edges; a bin holds its lower edge, the last bin also its upper edge, and a value outside the edges is not counted. A number that is not a positive integer stays unevaluated. Sample: `3`.

Count the number of elements falling into each bin.

```epsil
binCounts([1, 2, 2, 3], 3)
// ➔ [1,2,1]
```

### binomialDistribution

MathJSON `BinomialDistribution` · `(n: integer<0..>, p: real<0..1>) -> expression<BinomialDistribution>`

- `n` — The number of trials. Sample: `10`.
- `p` — The probability of success of each trial. Sample: `1/2`.

Binomial distribution: number of successes in n independent trials, each with success probability p.

```epsil
pdf(binomialDistribution(10, 1/2), 5)
// ➔ 63/256
```

```epsil
mean(binomialDistribution(10, 0.3))
// ➔ 3
```

### cdf

MathJSON `CDF` · `(distribution, real | signed_infinity) -> nan | real<0..1>`

- argument 1 — The distribution. Sample: `normalDistribution(0, 1)`.
- argument 2 — The point x; for a discrete distribution, a point that is not an integer is read as its floor. Sample: `1`.

Cumulative distribution function P(X ≤ x) of a distribution.

```epsil
cdf(normalDistribution(0, 1), 0)
// ➔ 1/2
```

```epsil
cdf(binomialDistribution(10, 1/2), 5)
// ➔ 319/512
```

### chiSquareDistribution

MathJSON `ChiSquareDistribution` · `(real<0<..>) -> expression<ChiSquareDistribution>`

- argument 1 — The number of degrees of freedom k, positive. Sample: `4`.

Chi-square distribution with k degrees of freedom (k &gt; 0, not necessarily an integer).

```epsil
cdf(chiSquareDistribution(2), 1)
// ➔ 1 - sqrt(1 / e)
```

```epsil
mean(chiSquareDistribution(4))
// ➔ 4
```

### correlation

MathJSON `Correlation` · `(xs: collection<number | tuple>, ys: collection<number>?) -> nan | real<-1..1>`

- `xs` — The x values, or the (x, y) pairs when `ys` is omitted; at least two points are needed, and data with no variance is an error. Sample: `[1, 2, 3]`.
- `ys` — The y values, as many as the x values. Sample: `[2, 4, 7]`.

Pearson's correlation coefficient of paired data, given as two equal-length collections or one collection of (x, y) pairs.

```epsil
correlation([1, 2, 3], [2, 4, 7])
// ➔ 5/38 * sqrt(57)
```

```epsil
correlation([1, 2, 3], [3, 2, 1])
// ➔ -1
```

### covariance

MathJSON `Covariance` · `(xs: collection<number | tuple>, ys: collection<number>?) -> nan | real`

- `xs` — The x values, or the (x, y) pairs when `ys` is omitted; at least two points are needed. Sample: `[1, 2, 3]`.
- `ys` — The y values, as many as the x values. Sample: `[2, 4, 7]`.

Sample covariance (n − 1 denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs.

```epsil
covariance([1, 2, 3], [2, 4, 7])
// ➔ 5/2
```

```epsil
covariance([(1, 2), (2, 4), (3, 7)])
// ➔ 5/2
```

### erf

MathJSON `Erf` · `(complex | signed_infinity, (complex | signed_infinity)?) -> complex`

- argument 1 — The point z; with two arguments, the lower point z0. Sample: `1/2`.
- argument 2 — The upper point z1: the result is Erf(z1) − Erf(z0). Sample: `1`.

Gauss error function; with two arguments, Erf(z1) − Erf(z0)

```epsil
erf(0.5)
// ➔ 0.520499877813046537683
```

```epsil
erf(0, 1.0)
// ➔ 0.842700792949714869341
```

### erfInv

MathJSON `ErfInv` · `(complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The value z, in [−1, 1] for a real result (±1 give ±∞); with two arguments, the point z0. Sample: `1/2`.
- argument 2 — The value z: the result is the x with Erf(z0, x) = z. Sample: `1/2`.

Inverse of the error function; with two arguments, the x with Erf(z0, x) = z, that is ErfInv(z + Erf(z0))

```epsil
erfInv(0.5)
// ➔ 0.476936276204469873381
```

```epsil
erfInv(1)
// ➔ +oo
```

### erfc

MathJSON `Erfc` · `(complex | signed_infinity) -> complex`

- argument 1 — The point x. Sample: `1/2`.

Complementary error function: 1 - Erf(x)

```epsil
erfc(0.5)
// ➔ 0.479500122186953462317
```

```epsil
erfc(-oo)
// ➔ 2
```

### erfi

MathJSON `Erfi` · `(complex | signed_infinity) -> complex | signed_infinity`

- argument 1 — The point x. Sample: `1/2`.

Imaginary error function: -i·Erf(i·x)

```epsil
erfi(0.5)
// ➔ 0.61495209469651098084
```

### exponentialDistribution

MathJSON `ExponentialDistribution` · `(real<0<..>) -> expression<ExponentialDistribution>`

- argument 1 — The rate λ, positive: the mean of the distribution is 1/λ. Sample: `2`.

Exponential distribution with rate parameter λ.

```epsil
cdf(exponentialDistribution(2), 1)
// ➔ 1 - e^(-2)
```

```epsil
variance(exponentialDistribution(2))
// ➔ 1/4
```

### fRatioDistribution

MathJSON `FRatioDistribution` · `(real<0<..>, real<0<..>) -> expression<FRatioDistribution>`

- argument 1 — The degrees of freedom d₁ of the numerator, positive. Sample: `2`.
- argument 2 — The degrees of freedom d₂ of the denominator, positive. Sample: `5`.

Snedecor's F distribution with d₁ degrees of freedom in the numerator and d₂ in the denominator.

```epsil
mean(fRatioDistribution(2, 5))
// ➔ 5/3
```

```epsil
cdf(fRatioDistribution(2, 3), 1.0)
// ➔ 0.535241998455109973778
```

### findFit

MathJSON `FindFit` · `(data: any, model: any, params: any, vars: any, options: dictionary?) -> dictionary`

- `data` — The data: a list of (x…, y) tuples, or a plain list of y values at x = 1, 2, 3, …; a list of datasets for a list of models. Sample: `[(0, 1), (1, 3), (2, 5)]`.
- `model` — The model, an expression in the variables and the parameters, or a list of models that share parameters. Sample: `a * x + b`.
- `params` — The parameters, each a symbol, (a, a0) with the start value a0, or (a, a0, lo, hi) with bounds. Sample: `[a, b]`.
- `vars` — The variables, a symbol or a list of symbols. Sample: `[x]`.
- `options` — The options of the fit. Sample: `{global -> {a -> [0, 5]}}`.
  - `global` (`dictionary<list<real>>`) — The parameters (at most two) searched over a range [lo, hi] or [lo, hi, step] for the lowest sum of squared residuals, instead of the local minimum nearest the start. Sample: `{a -> [0, 5]}`.

Nonlinear least-squares fit of a model to data. FindFit(data, model, params, vars): fit `model` (an expression in `vars` and the parameters) to `data`, a list of (x…, y) tuples or a plain list of y values. Each parameter spec is a bare symbol, (a, a0), or (a, a0, lo, hi) with box constraints. Returns a record &#123;parameters, converged, residualNorm, iterations&#125;. `converged` is true at a stationary point of the sum of squared residuals (a minimum of the misfit, which is not zero for noisy data), and at an exact fit: every residual within the engine's tolerance of the terms its own row computes. The joint form takes a list of models and matching datasets sharing parameters. An optional fifth argument is a dictionary of options: `{global: {b: [lo, hi]}}` searches the named parameters (at most two) over the given range for the lowest sum of squared residuals instead of returning the local minimum nearest the start; `iterations` is then the total over every solver run. The search samples each parameter on a grid: a parameter that scales the phase of a periodic function of a variable (`b` in `cos(b x + c)`) gets a point in every basin of the residual, about `π / (span of x)` apart; `{global: {b: [lo, hi, step]}}` sets the step of the grid instead (when the model is linear in the other parameters; otherwise the solver runs from each point of a coarse grid of 24 points, or 6 × 6). A step on the phase `c` of `a cos(b x + c)` keeps it on the grid; without a step the phase is solved by least squares. With more than 300 data rows the grid is scanned on a stratified sample of 300 rows, and the best grid points are then solved again and refined on every row. With a kernel pool on the engine (`ce.workers`), `evaluateAsync()` scans the grid on the workers and gives the record of `evaluate()`; the solver runs stay on the calling thread. The record of `evaluateAsync()` also has `route`: "pool" when the workers scanned the grid, or "calling-thread" with a `reason` ("no-pool", "pool-unusable", "no-global-search", "not-separable", "not-compilable", "pool-declined", "no-points-to-ship", "step-budget", "setup-timeout"). On the calling thread `evaluateAsync()` gives the event loop a turn about every 8 ms, and it keeps the limit of a `withTimeLimit` span that encloses the call.

```epsil
findFit([(0, 1), (1, 3), (2, 5)], a * x + b, [a, b], [x])
// ➔ {"parameters" -> {"a" -> 1.9999999983899441, "b" -> 1.0000000020700244}, "converged" -> true, "residualNorm" -> 2.4123168032968065e-9, "iterations" -> 3}
```

```epsil
findFit([1, 3, 5], a * x + b, [(a, 1), b], [x])
// ➔ {"parameters" -> {"a" -> 1.9999999999572358, "b" -> -0.9999999999076185}, "converged" -> true, "residualNorm" -> 6.163184317732835e-11, "iterations" -> 4}
```

### gammaDistribution

MathJSON `GammaDistribution` · `(shape: real<0<..>, scale: real<0<..>) -> expression<GammaDistribution>`

- `shape` — The shape α, positive. Sample: `2`.
- `scale` — The scale θ, positive: the mean of the distribution is α·θ. Sample: `3`.

Gamma distribution with shape α and scale θ: the density is x^(α−1)·e^(−x/θ)/(Γ(α)·θ^α) for x &gt; 0.

```epsil
mean(gammaDistribution(2, 3))
// ➔ 6
```

```epsil
cdf(gammaDistribution(2, 1), 1)
// ➔ 1 - 2 / e
```

### gammaRegularized

MathJSON `GammaRegularized` · `(complex | infinity, complex | infinity, (complex | infinity)?) -> number`

- argument 1 — The parameter a; for a &gt; 0 and z ≥ 0 the value is in [0, 1]. Sample: `2`.
- argument 2 — The lower limit z of the integral; with three arguments, the first limit z0. Sample: `1`.
- argument 3 — The second limit z1: the result is Q(a, z0) − Q(a, z1). Sample: `3`.

Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a); with three arguments, Q(a, z0) − Q(a, z1)

```epsil
gammaRegularized(2, 1)
// ➔ 2 / e
```

```epsil
gammaRegularized(2, 1.0)
// ➔ 0.735758882342884643192
```

### geometricDistribution

MathJSON `GeometricDistribution` · `(real<0..1>) -> expression<GeometricDistribution>`

- argument 1 — The probability p of success of each trial; p = 0 is refused. Sample: `1/4`.

Geometric distribution: the number of failures before the first success, each trial a success with probability p (0 &lt; p ≤ 1). The support is &#123;0, 1, 2, …&#125;.

```epsil
pdf(geometricDistribution(1/2), 2)
// ➔ 1/8
```

```epsil
mean(geometricDistribution(1/4))
// ➔ 3
```

### histogram

MathJSON `Histogram` · `(xs: collection<number>, bins: list<number> | number) -> list<tuple<number, integer>>`

- `xs` — The data, finite real numbers; an empty collection stays unevaluated. Sample: `[1, 2, 2, 3]`.
- `bins` — A positive integer number of bins of equal width from the least to the greatest value, or a list of bin edges; a bin holds its lower edge, the last bin also its upper edge, and a value outside the edges is not counted. A number that is not a positive integer stays unevaluated. Sample: `3`.

Compute a histogram of the values in a collection. Returns a list of (bin start, count) tuples.

```epsil
histogram([1, 2, 2, 3], 3)
// ➔ [(1, 1),(1.6666666666666665, 2),(2.333333333333333, 1)]
```

### hypergeometricDistribution

MathJSON `HypergeometricDistribution` · `(draws: integer<0..>, successes: integer<0..>, population: integer<0..>) -> expression<HypergeometricDistribution>`

- `draws` — The number n of draws, at most the population. Sample: `5`.
- `successes` — The number K of successes in the population, at most the population. Sample: `10`.
- `population` — The size N of the population. Sample: `20`.

Hypergeometric distribution: the number of successes in n draws without replacement from a population of N items of which K are successes (0 ≤ n ≤ N, 0 ≤ K ≤ N).

```epsil
pdf(hypergeometricDistribution(5, 10, 20), 2)
// ➔ 225/646
```

```epsil
mean(hypergeometricDistribution(5, 10, 20))
// ➔ 5/2
```

### interquartileRange

MathJSON `InterquartileRange` · `((collection<number> | number)+) -> +oo | nan | real<0..>`

- arguments 1, … — The data, as collections or single numbers that form one sample; Q1 and Q3 are the medians of the lower and upper halves, without the median of an odd count, and an empty collection gives `NaN`. Sample: `[1, 2, 3, 4, 5, 6, 7, 8]`.

Interquartile range (Q3 - Q1) of a collection.

```epsil
interquartileRange([1, 2, 3, 4, 5, 6, 7, 8])
// ➔ 4
```

### kurtosis

MathJSON `Kurtosis` · `((collection<number> | number)+) -> nan | real`

- arguments 1, … — The data, as collections or single numbers that form one sample; the result is the population kurtosis m₄/m₂² (3 for a normal distribution, not the excess), and `NaN` when every value is the same. Sample: `[1, 2, 3, 4, 10]`.

Kurtosis of a collection of numbers.

```epsil
kurtosis([1, 2, 3, 4, 10])
// ➔ 697/250
```

### linearRegression

MathJSON `LinearRegression` · `(any+) -> tuple<number, number>`

- arguments 1, … — The data, as two collections of x and y values or one collection of (x, y) pairs with at least two points, then optionally the variable of the fitted line. Sample: `[1, 2, 3]`.

Least-squares linear fit b0 + b1·x. Returns Tuple(b0, b1), or the fitted expression if a trailing variable symbol is given.

```epsil
linearRegression([1, 2, 3], [2, 4, 7])
// ➔ (-2/3, 5/2)
```

```epsil
linearRegression([1, 2, 3], [2, 4, 7], x)
// ➔ 5/2 * x - 2/3
```

### mean

MathJSON `Mean` · `((collection<number> | distribution | number)+) -> number`

- arguments 1, … — The data, as collections or single numbers that form one sample, or a single distribution, whose mean is returned; no data gives `NaN`. Sample: `[1, 2, 3, 4]`.

Arithmetic mean (average) of a collection of numbers.

```epsil
mean([1, 2, 3, 4])
// ➔ 5/2
```

```epsil
mean(normalDistribution(3, 2))
// ➔ 3
```

### median

MathJSON `Median` · `((collection<number> | number)+) -> nan | real | signed_infinity`

- arguments 1, … — The data, as collections or single numbers that form one sample; an even count gives the mean of the two middle values, and no data gives `NaN`. Sample: `[3, 1, 4, 2]`.

Median of a collection of numbers.

```epsil
median([3, 1, 4, 2])
// ➔ 5/2
```

### mode

MathJSON `Mode` · `((collection<number> | number)+) -> nan | real | signed_infinity`

- arguments 1, … — The data, as collections or single numbers that form one sample; a tie gives the smallest of the most frequent values, and no data gives `NaN`. Sample: `[1, 2, 2, 3]`.

Most frequently occurring value in a collection.

```epsil
mode([1, 2, 2, 3])
// ➔ 2
```

### negativeBinomialDistribution

MathJSON `NegativeBinomialDistribution` · `(n: integer<1..>, p: real<0..1>) -> expression<NegativeBinomialDistribution>`

- `n` — The number of successes to reach, at least 1. Sample: `3`.
- `p` — The probability of success of each trial, greater than 0 and at most 1. Sample: `1/2`.

Negative binomial distribution: the number of failures before the n-th success (n a positive integer), each trial a success with probability p (0 &lt; p ≤ 1). The support is &#123;0, 1, 2, …&#125;.

```epsil
pdf(negativeBinomialDistribution(3, 1/2), 2)
// ➔ 3/16
```

```epsil
mean(negativeBinomialDistribution(3, 1/2))
// ➔ 3
```

### normalDistribution

MathJSON `NormalDistribution` · `(mu: real, sigma: real<0<..>) -> expression<NormalDistribution>`

- `mu` — The mean, the center of the bell curve. Sample: `0`.
- `sigma` — The standard deviation, greater than 0. Sample: `1`.

Normal (Gaussian) distribution with mean μ and standard deviation σ.

```epsil
pdf(normalDistribution(0, 1), 0)
// ➔ sqrt(1 / (2pi))
```

```epsil
cdf(normalDistribution(0, 1), 1.96)
// ➔ 0.975002104851779565864
```

### pdf

MathJSON `PDF` · `(distribution, real | signed_infinity) -> nan | real<0..>`

- argument 1 — The distribution. Sample: `normalDistribution(0, 1)`.
- argument 2 — The point x; outside the support, and off the integers for a discrete distribution, the value is 0. Sample: `1`.

Probability density (continuous) or mass (discrete) function of a distribution, evaluated at x.

```epsil
pdf(normalDistribution(0, 1), 0)
// ➔ sqrt(1 / (2pi))
```

```epsil
pdf(poissonDistribution(2), 3)
// ➔ 4 / (3e^2)
```

### poissonDistribution

MathJSON `PoissonDistribution` · `(real<0<..>) -> expression<PoissonDistribution>`

- argument 1 — The rate λ, the mean number of events, greater than 0. Sample: `3`.

Poisson distribution with rate parameter λ.

```epsil
pdf(poissonDistribution(2), 3)
// ➔ 4 / (3e^2)
```

```epsil
variance(poissonDistribution(3))
// ➔ 3
```

### polynomialFit

MathJSON `PolynomialFit` · `(any+) -> list<number>`

- arguments 1, … — The data, as two collections of x and y values or one collection of (x, y) pairs, then the degree, an integer from 0 to 12 and less than the number of points, then optionally the variable of the fitted polynomial. Sample: `[0, 1, 2, 3]`.

Least-squares polynomial fit of the given degree. Returns the ascending coefficient List(c0, …, c_deg), or the fitted expression if a trailing variable symbol is given.

```epsil
polynomialFit([0, 1, 2, 3], [1, 2, 5, 10], 2)
// ➔ [1,0,1]
```

```epsil
polynomialFit([0, 1, 2, 3], [1, 2, 5, 10], 2, x)
// ➔ x^2 + 1
```

### populationCovariance

MathJSON `PopulationCovariance` · `(xs: collection<number | tuple>, ys: collection<number>?) -> nan | real`

- `xs` — The x values, or the (x, y) pairs when `ys` is omitted; at least two points are needed. Sample: `[1, 2, 3]`.
- `ys` — The y values, as many as the x values. Sample: `[2, 4, 7]`.

Population covariance (n denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs.

```epsil
populationCovariance([1, 2, 3], [2, 4, 7])
// ➔ 5/3
```

```epsil
populationCovariance([(1, 2), (2, 4), (3, 7)])
// ➔ 5/3
```

### populationStandardDeviation

MathJSON `PopulationStandardDeviation` · `((collection<number> | number)+) -> nan | real<0..>`

- arguments 1, … — The data, as collections or single numbers that form one sample; the divisor is n, so one value gives 0 and no data gives `NaN`. Sample: `[2, 4, 4, 4, 5, 5, 7, 9]`.

Population Standard Deviation of a collection of numbers.

```epsil
populationStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])
// ➔ 2
```

### populationVariance

MathJSON `PopulationVariance` · `((collection<number> | number)+) -> nan | real<0..>`

- arguments 1, … — The data, as collections or single numbers that form one sample; the divisor is n, so one value gives 0 and no data gives `NaN`. Sample: `[1, 2, 3, 4]`.

Population variance of a collection of numbers.

```epsil
populationVariance([1, 2, 3, 4])
// ➔ 5/4
```

### quantile

MathJSON `Quantile` · `(collection<any> | distribution, real<0..1>) -> nan | real | signed_infinity`

- argument 1 — The distribution, or a collection of numbers whose empirical quantile agrees with `Quartiles` at 1/4, 1/2 and 3/4. Sample: `normalDistribution(0, 1)`.
- argument 2 — The probability p, from 0 to 1; 0 and 1 give the ends of the support, or the least and the greatest datum. Sample: `0.975`.

Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1]. The first argument may also be a data collection, in which case the empirical quantile is returned.

```epsil
quantile(normalDistribution(0, 1), 0.975)
// ➔ 1.95996398454005423553
```

```epsil
quantile([1, 2, 3, 4, 5], 1/4)
// ➔ 3/2
```

### quartiles

MathJSON `Quartiles` · `((collection<number> | number)+) -> tuple<lower: nan | real | signed_infinity, mid: nan | real | signed_infinity, upper: nan | real | signed_infinity>`

- arguments 1, … — The data, as collections or single numbers that form one sample; no data gives a triple of `NaN`. Sample: `[1, 2, 3, 4, 5]`.

Lower quartile, median, and upper quartile of a collection. Uses the Moore–McCabe (exclusive-hinges) convention: the sample is split at its median, and Q1/Q3 are the medians of the lower/upper halves with the overall median excluded from both halves when the sample size is odd.

```epsil
quartiles([1, 2, 3, 4, 5])
// ➔ (3/2, 3, 9/2)
```

### randomSample

MathJSON `RandomSample` · `((xs: T, count: number) random -> T where T: string) & ((xs: indexed_collection, count: number) random -> list)`

- `xs` — The collection to draw from; a string gives a string of its characters. Sample: `[1, 2, 3, 4, 5]`.
- `count` — The number of elements to draw, from 0 to the length of the collection; it is rounded to an integer. Sample: `2`.

RandomSample(xs, count): a list of count elements drawn from the indexed collection `xs`, without replacement. "Without replacement" is over POSITIONS, not values: on a multiset, repeats are expected — RandomSample([1, 1, 2], 2) can return [1, 1]. Sampling a string yields a string. Wrap the call in `WithRandomSeed(seed, ...)` to make it deterministic.

```epsil
withRandomSeed(42, randomSample([1, 2, 3, 4, 5], 2))
// ➔ [4,3]
```

### skewness

MathJSON `Skewness` · `((collection<number> | number)+) -> nan | real`

- arguments 1, … — The data, as collections or single numbers that form one sample; the skewness is the third central moment over the cube of the population standard deviation, and constant data or no data gives `NaN`. Sample: `[1, 2, 3, 10]`.

Skewness of a collection of numbers.

```epsil
skewness([1, 2, 3, 10])
// ➔ 18/25 * sqrt(2)
```

### slidingWindow

MathJSON `SlidingWindow` · `((xs: S, count: integer, step: integer?) -> list<string> where S: string) & ((xs: collection, count: integer, step: integer?) -> list<list>)`

- `xs` — The collection to read; a string gives windows that are strings. Sample: `[1, 2, 3, 4]`.
- `count` — The number of elements in each window, at least 1; a count larger than the collection gives no window. Sample: `2`.
- `step` — The distance between the starts of two windows, at least 1, by default 1; only complete windows are kept. Sample: `2`.

Return overlapping sliding windows of fixed size over the collection.

```epsil
slidingWindow([1, 2, 3, 4], 2)
// ➔ [[1,2],[2,3],[3,4]]
```

```epsil
slidingWindow("abcd", 2)
// ➔ ["ab","bc","cd"]
```

### standardDeviation

MathJSON `StandardDeviation` · `((collection<number> | distribution | number)+) -> nan | real<0..>`

- arguments 1, … — The data, as collections or single numbers that form one sample, or a single distribution, whose standard deviation is returned; the divisor is n − 1, so fewer than two values give `NaN`. Sample: `[1, 3, 5]`.

Sample Standard Deviation of a collection of numbers.

```epsil
standardDeviation([1, 3, 5])
// ➔ 2
```

```epsil
standardDeviation(normalDistribution(0, 3))
// ➔ 3
```

### studentTDistribution

MathJSON `StudentTDistribution` · `(real<0<..>) -> expression<StudentTDistribution>`

- argument 1 — The degrees of freedom ν, greater than 0 and not necessarily an integer. Sample: `5`.

Student's t distribution with ν degrees of freedom (ν &gt; 0, not necessarily an integer).

```epsil
pdf(studentTDistribution(1), 0)
// ➔ 1 / pi
```

```epsil
variance(studentTDistribution(5))
// ➔ 5/3
```

### uniformDistribution

MathJSON `UniformDistribution` · `(lower: real, upper: real) -> expression<UniformDistribution>`

- `lower` — The lower end a of the interval. Sample: `0`.
- `upper` — The upper end b of the interval, greater than `lower`. Sample: `4`.

Continuous uniform distribution on the interval [a, b]. `uniformDistribution([a, b])` is the same, and `uniformDistribution()` is on [0, 1].

```epsil
pdf(uniformDistribution(0, 4), 1)
// ➔ 1/4
```

```epsil
mean(uniformDistribution(2, 6))
// ➔ 4
```

### variance

MathJSON `Variance` · `((collection<number> | distribution | number)+) -> nan | real<0..>`

- arguments 1, … — The data, as collections or single numbers that form one sample, or a single distribution, whose variance is returned; the divisor is n − 1, so fewer than two values give `NaN`. Sample: `[1, 2, 3, 4]`.

Sample variance of a collection of numbers.

```epsil
variance([1, 2, 3, 4])
// ➔ 5/3
```

```epsil
variance(poissonDistribution(3))
// ➔ 3
```
