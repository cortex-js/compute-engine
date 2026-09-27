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

The 35 definitions of the statistics library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### betaRegularized

MathJSON `BetaRegularized` · `(complex | infinity, complex | infinity, complex | infinity) -> number`

Regularized incomplete beta function I_x(a, b)

### binCounts

MathJSON `BinCounts` · `(collection<any>, list<number> | number) -> list<number>`

Count the number of elements falling into each bin.

```epsil
binCounts([1, 2, 2, 3], 3)
// ➔ [1,2,1]
```

### binomialDistribution

MathJSON `BinomialDistribution` · `(integer<0..>, real<0..1>) -> expression<BinomialDistribution>`

Binomial distribution: number of successes in n independent trials, each with success probability p.

### cdf

MathJSON `CDF` · `(distribution, real | signed_infinity) -> nan | real<0..1>`

Cumulative distribution function P(X ≤ x) of a distribution.

### correlation

MathJSON `Correlation` · `(collection<any>, collection<any>?) -> nan | real<-1..1>`

Pearson's correlation coefficient of paired data, given as two equal-length collections or one collection of (x, y) pairs.

### covariance

MathJSON `Covariance` · `(collection<any>, collection<any>?) -> nan | real`

Sample covariance (n − 1 denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs.

### erf

MathJSON `Erf` · `(complex | signed_infinity) -> complex`

Gauss error function

### erfInv

MathJSON `ErfInv` · `(complex | infinity) -> number`

Inverse of the error function

### erfc

MathJSON `Erfc` · `(complex | signed_infinity) -> complex`

Complementary error function: 1 - Erf(x)

### erfi

MathJSON `Erfi` · `(complex | signed_infinity) -> complex | signed_infinity`

Imaginary error function: -i·Erf(i·x)

### exponentialDistribution

MathJSON `ExponentialDistribution` · `(real<0<..>) -> expression<ExponentialDistribution>`

Exponential distribution with rate parameter λ.

### findFit

MathJSON `FindFit` · `(any, any, any, any) -> dictionary`

Nonlinear least-squares fit of a model to data. FindFit(data, model, params, vars): fit `model` (an expression in `vars` and the parameters) to `data`, a list of (x…, y) tuples or a plain list of y values. Each parameter spec is a bare symbol, (a, a0), or (a, a0, lo, hi) with box constraints. Returns a record &#123;parameters, converged, residualNorm, iterations&#125;. The joint form takes a list of models and matching datasets sharing parameters.

### gammaRegularized

MathJSON `GammaRegularized` · `(complex | infinity, complex | infinity) -> number`

Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a)

### histogram

MathJSON `Histogram` · `(collection<any>, list<number> | number) -> list<tuple<number, integer>>`

Compute a histogram of the values in a collection. Returns a list of (bin start, count) tuples.

```epsil
histogram([1, 2, 2, 3], 3)
// ➔ [(1, 1),(1.6666666666666665, 2),(2.333333333333333, 1)]
```

### interquartileRange

MathJSON `InterquartileRange` · `((collection<any> | number)+) -> +oo | nan | real<0..>`

Interquartile range (Q3 - Q1) of a collection.

### kurtosis

MathJSON `Kurtosis` · `((collection<any> | number)+) -> nan | real`

Kurtosis of a collection of numbers.

### linearRegression

MathJSON `LinearRegression` · `(any+) -> tuple<number, number>`

Least-squares linear fit b0 + b1·x. Returns Tuple(b0, b1), or the fitted expression if a trailing variable symbol is given.

### mean

MathJSON `Mean` · `((collection<any> | distribution | number)+) -> number`

Arithmetic mean (average) of a collection of numbers.

### median

MathJSON `Median` · `((collection<any> | number)+) -> nan | real | signed_infinity`

Median of a collection of numbers.

```epsil
median([3, 1, 4, 2])
// ➔ 5/2
```

### mode

MathJSON `Mode` · `((collection<any> | number)+) -> nan | real | signed_infinity`

Most frequently occurring value in a collection.

```epsil
mode([1, 2, 2, 3])
// ➔ 2
```

### normalDistribution

MathJSON `NormalDistribution` · `(real, real<0<..>) -> expression<NormalDistribution>`

Normal (Gaussian) distribution with mean μ and standard deviation σ.

### pdf

MathJSON `PDF` · `(distribution, real | signed_infinity) -> nan | real<0..>`

Probability density (continuous) or mass (discrete) function of a distribution, evaluated at x.

### poissonDistribution

MathJSON `PoissonDistribution` · `(real<0<..>) -> expression<PoissonDistribution>`

Poisson distribution with rate parameter λ.

### polynomialFit

MathJSON `PolynomialFit` · `(any+) -> list<number>`

Least-squares polynomial fit of the given degree. Returns the ascending coefficient List(c0, …, c_deg), or the fitted expression if a trailing variable symbol is given.

### populationCovariance

MathJSON `PopulationCovariance` · `(collection<any>, collection<any>?) -> nan | real`

Population covariance (n denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs.

### populationStandardDeviation

MathJSON `PopulationStandardDeviation` · `((collection<any> | number)+) -> nan | real<0..>`

Population Standard Deviation of a collection of numbers.

### populationVariance

MathJSON `PopulationVariance` · `((collection<any> | number)+) -> nan | real<0..>`

Population variance of a collection of numbers.

### quantile

MathJSON `Quantile` · `(collection<any> | distribution, real<0..1>) -> nan | real | signed_infinity`

Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1]. The first argument may also be a data collection, in which case the empirical quantile is returned.

### quartiles

MathJSON `Quartiles` · `((collection<any> | number)+) -> tuple<lower: nan | real | signed_infinity, mid: nan | real | signed_infinity, upper: nan | real | signed_infinity>`

Lower quartile, median, and upper quartile of a collection. Uses the Moore–McCabe (exclusive-hinges) convention: the sample is split at its median, and Q1/Q3 are the medians of the lower/upper halves with the overall median excluded from both halves when the sample size is odd.

```epsil
quartiles([1, 2, 3, 4, 5])
// ➔ (3/2, 3, 9/2)
```

### randomSample

MathJSON `RandomSample` · `((T, number) random -> T where T: string) & ((indexed_collection, number) random -> list)`

RandomSample(xs, k): a list of k elements drawn from the indexed collection `xs`, without replacement. "Without replacement" is over POSITIONS, not values: on a multiset, repeats are expected — RandomSample([1, 1, 2], 2) can return [1, 1]. Sampling a string yields a string. Wrap the call in `WithRandomSeed(seed, ...)` to make it deterministic.

### skewness

MathJSON `Skewness` · `((collection<any> | number)+) -> nan | real`

Skewness of a collection of numbers.

### slidingWindow

MathJSON `SlidingWindow` · `((S, integer, integer?) -> list<string> where S: string) & ((collection, integer, integer?) -> list<list>)`

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

MathJSON `StandardDeviation` · `((collection<any> | distribution | number)+) -> nan | real<0..>`

Sample Standard Deviation of a collection of numbers.

### uniformDistribution

MathJSON `UniformDistribution` · `(real, real) -> expression<UniformDistribution>`

Continuous uniform distribution on the interval [a, b].

### variance

MathJSON `Variance` · `((collection<any> | distribution | number)+) -> nan | real<0..>`

Sample variance of a collection of numbers.
