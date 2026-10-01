---
title: Number theory Reference
sidebar_label: Number theory
slug: /epsil/reference/number-theory/
description: "The number theory library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from number-theory.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Number theory

The 54 definitions of the number theory library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### bernoulliB

MathJSON `BernoulliB` · `(integer) -> rational`

Return the nth Bernoulli number Bₙ as an exact rational, using the convention B₁ = -1/2. Odd `n > 1` give 0.

```epsil
bernoulliB(2)
// ➔ 1/6
```

### carmichaelLambda

MathJSON `CarmichaelLambda` · `(integer) -> integer`

Return the Carmichael function λ(n) (the reduced totient): the smallest positive integer `m` such that `a^m ≡ 1 (mod n)` for every `a` coprime to `n`. Defined for `n ≥ 1`.

```epsil
carmichaelLambda(15)
// ➔ 4
```

### catalanNumber

MathJSON `CatalanNumber` · `(integer) -> integer`

Return the nth Catalan number `C(n) = (2n)! / ((n+1)! · n!)`: 1, 1, 2, 5, 14, 42, … Defined for `n ≥ 0`.

```epsil
catalanNumber(5)
// ➔ 42
```

### chineseRemainder

MathJSON `ChineseRemainder` · `(collection<any>, collection<any>) -> integer`

Solve a system of simultaneous congruences: return the smallest non-negative integer `x` such that `x ≡ residues[i] (mod moduli[i])` for every `i`. Undefined if the system is inconsistent or the two lists differ in length.

```epsil
chineseRemainder([2, 3, 2], [3, 5, 7])
// ➔ 23
```

### continuedFraction

MathJSON `ContinuedFraction` · `(real, integer?) -> list<integer>`

Return the continued-fraction expansion of `x` as a list of integer terms `[a0, a1, …]`. An exact rational is expanded fully; an inexact value is expanded as its best rational approximation at working precision (see `Rationalize`), truncated to the optional `n` terms (default 20).

```epsil
continuedFraction(43/19)
// ➔ [2,3,1,4]
```

### digitCount

MathJSON `DigitCount` · `(integer, integer?, integer?) -> integer | list<integer>`

Count digits of `n` in the given `base` (default 10); the sign of `n` is ignored. With a third argument `digit`, return how many times that digit occurs. Otherwise return a list `[count of 1, count of 2, …, count of base-1, count of 0]`.

```epsil
digitCount(122, 10, 2)
// ➔ 2
```

### digitSum

MathJSON `DigitSum` · `(integer, integer?) -> integer`

Return the sum of the digits of `n` in the given `base` (default 10). The sign of `n` is ignored.

```epsil
digitSum(1234)
// ➔ 10
```

### dirichletCharacter

MathJSON `DirichletCharacter` · `(integer, integer, integer) -> number`

The Dirichlet character χ_j(n) modulo `k`, the `j`-th of the φ(k) characters (Wolfram's indexing, `j = 1` the principal character). Zero where gcd(n, k) &gt; 1; otherwise a root of unity.

```epsil
dirichletCharacter(5, 2, 2)
// ➔ i
```

```epsil
dirichletCharacter(7, 3, 3)
// ➔ e^(2/3i * pi)
```

### dirichletL

MathJSON `DirichletL` · `(integer, integer, number) -> number`

The Dirichlet L-function L(s, χ) = Σ χ(n)/nˢ (n ≥ 1) of the character χ_j modulo `k` (`DirichletCharacter(k, j, ·)`): `k^(−s) Σ_{r=1}^{k} χ(r) ζ(s, r/k)`. Entire for a non-principal character; the principal one is `ζ(s) Π_{p|k} (1 − p^(−s))`.

```epsil
dirichletL(1, 1, 2)
// ➔ 1/6 * pi^2
```

```epsil
dirichletL(3, 2, -2)
// ➔ -2/9
```

```epsil
dirichletL(5, 2, 0)
// ➔ (3/5 + 1/5i)
```

### divides

MathJSON `Divides` · `(integer, integer) -> boolean`

`Divides(a, b)` returns `True` if `a` divides `b` (i.e. `b` is an integer multiple of `a`), corresponding to the notation `a ∣ b`. Both operands are integers; a symbolic operand keeps the relation unevaluated.

```epsil
divides(3, 12)
// ➔ "True"
```

### divisorSigma

MathJSON `DivisorSigma` · `(integer, integer) -> integer`

The divisor function σ_k(n) = Σ_&#123;d | n&#125; dᵏ over the positive divisors of `n`. σ₀ counts divisors, σ₁ sums them. Defined for `n ≥ 1`.

```epsil
divisorSigma(2, 6)
// ➔ 50
```

### divisors

MathJSON `Divisors` · `(integer) -> list<integer>`

Return the sorted list of positive divisors of an integer `n`. The sign of `n` is ignored.

```epsil
divisors(12)
// ➔ [1,2,3,4,6,12]
```

### eulerian

MathJSON `Eulerian` · `(integer, integer) -> integer`

Eulerian number A(n, m): number of permutations of &#123;1..n&#125; with exactly m ascents.

### extendedGCD

MathJSON `ExtendedGCD` · `(integer, integer) -> tuple<integer, integer, integer>`

Return the extended GCD of `a` and `b` as a tuple `(g, x, y)` where `g = gcd(a, b)` is non-negative and `a·x + b·y = g` (Bézout coefficients).

```epsil
extendedGCD(12, 18)
// ➔ (6, -1, 1)
```

### factorInteger

MathJSON `FactorInteger` · `(integer) -> list<tuple<integer, integer>>`

Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. For a negative `n`, a leading `[-1, 1]` tuple carries the sign.

```epsil
factorInteger(360)
// ➔ [(2, 3),(3, 2),(5, 1)]
```

### fromContinuedFraction

MathJSON `FromContinuedFraction` · `(collection<any>) -> number`

Reconstruct the (rational) value of a continued fraction given its list of integer terms `[a0, a1, …]`.

```epsil
fromContinuedFraction([2, 3, 1, 4])
// ➔ 43/19
```

### fromDigits

MathJSON `FromDigits` · `(collection<any>, integer?) -> integer`

Reconstruct an integer from its list of digits (most-significant first) in the given `base` (default 10). The inverse of `IntegerDigits`. Digits outside `[0, base)` are combined positionally (Horner evaluation).

```epsil
fromDigits([1, 2, 3, 4])
// ➔ 1234
```

### integerDigits

MathJSON `IntegerDigits` · `(integer, integer?, integer?) -> list<integer>`

Return the digits of `n` in the given `base` (default 10), most-significant first. The sign of `n` is ignored. With a third argument `length`, the result is zero-padded on the left (or truncated to its least-significant digits) to that length.

```epsil
integerDigits(255, 16)
// ➔ [15,15]
```

### integerSqrt

MathJSON `IntegerSqrt` · `(integer) -> integer`

Return the integer square root of `n`, i.e. the largest integer `m` such that `m² ≤ n`. Undefined for negative `n`.

```epsil
integerSqrt(17)
// ➔ 4
```

### isAbundant

MathJSON `IsAbundant` · `(integer) -> boolean`

True if n is an abundant number (sum of divisors &gt; 2n).

### isCenteredSquare

MathJSON `IsCenteredSquare` · `(integer) -> boolean`

True if n is a centered square number.

### isHappy

MathJSON `IsHappy` · `(integer) -> boolean`

True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit

### isOctahedral

MathJSON `IsOctahedral` · `(integer) -> boolean`

True if n is an octahedral number.

### isPerfect

MathJSON `IsPerfect` · `(integer) -> boolean`

Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors.

### isPerfectPower

MathJSON `IsPerfectPower` · `(integer) -> boolean`

Return `"True"` if `n` is a perfect power `a^b` for integers `a` and `b ≥ 2` (a negative `n` requires an odd exponent). The smallest perfect power is 4.

```epsil
isPerfectPower(64)
// ➔ "True"
```

### isSquare

MathJSON `IsSquare` · `(integer) -> boolean`

True if n is a perfect square.

### isSquareFree

MathJSON `IsSquareFree` · `(integer) -> boolean`

Return `"True"` if `n` is square-free (not divisible by any perfect square &gt; 1). The sign of `n` is ignored.

```epsil
isSquareFree(30)
// ➔ "True"
```

### isTriangular

MathJSON `IsTriangular` · `(integer) -> boolean`

True if n is a triangular number.

### jacobiSymbol

MathJSON `JacobiSymbol` · `(integer, integer) -> integer`

The Jacobi symbol (a/n) for an odd `n > 0`. Returns -1, 0, or 1. Undefined when `n` is even or non-positive.

```epsil
jacobiSymbol(5, 21)
// ➔ 1
```

### legendreSymbol

MathJSON `LegendreSymbol` · `(integer, integer) -> integer`

The Legendre symbol (a/p) for an odd prime `p`. Returns -1, 0, or 1. Undefined when `p` is not an odd prime.

```epsil
legendreSymbol(3, 7)
// ➔ -1
```

### lucas

MathJSON `Lucas` · `(integer) -> integer`

`Lucas` is an alias for `LucasL`, which is the preferred name. Returns the nth Lucas number.

### lucasL

MathJSON `LucasL` · `(integer) -> integer`

Return the nth Lucas number: `LucasL(0)` is 2, `LucasL(1)` is 1, and `LucasL(n) = LucasL(n-1) + LucasL(n-2)`. Negative indices follow `LucasL(-n) = (-1)^n · LucasL(n)`.

```epsil
lucasL(10)
// ➔ 123
```

### modularInverse

MathJSON `ModularInverse` · `(integer, integer) -> integer`

Return the modular multiplicative inverse of `a` modulo `m`: the integer `x` with `a·x ≡ 1 (mod m)`. The sign of `x` follows the sign of `m` (the same floored-division convention as `Mod`). Undefined when `a` and `m` are not coprime.

```epsil
modularInverse(3, 7)
// ➔ 5
```

```epsil
modularInverse(3, -7)
// ➔ -2
```

### moebiusMu

MathJSON `MoebiusMu` · `(integer) -> integer`

Return the Möbius function μ(n): 0 if `n` is divisible by a perfect square &gt; 1, otherwise (-1) raised to the number of distinct prime factors. The sign of `n` is ignored.

```epsil
moebiusMu(30)
// ➔ -1
```

### multiplicativeOrder

MathJSON `MultiplicativeOrder` · `(integer, integer) -> integer`

The multiplicative order of `a` modulo `n`: the smallest `k > 0` such that `a^k ≡ 1 (mod n)`. Undefined unless `a` and `n` are coprime.

```epsil
multiplicativeOrder(2, 7)
// ➔ 3
```

### nPartition

MathJSON `NPartition` · `(integer) -> integer`

Number of integer partitions of n.

### nextPrime

MathJSON `NextPrime` · `(integer, integer?) -> integer`

Return the smallest prime greater than `n`. With a second argument `k`, return the kth prime after `n` (`k < 0` returns the |k|th prime before `n`).

```epsil
nextPrime(10)
// ➔ 11
```

```epsil
nextPrime(10, -1)
// ➔ 7
```

### notDivides

MathJSON `NotDivides` · `(integer, integer) -> boolean`

`NotDivides(a, b)` returns `True` if `a` does not divide `b`, corresponding to the notation `a ∤ b`.

### nthPrime

MathJSON `NthPrime` · `(integer) -> integer`

Return the nth prime number (1-based): `NthPrime(1)` is 2, `NthPrime(2)` is 3, …

```epsil
nthPrime(10)
// ➔ 29
```

### powerMod

MathJSON `PowerMod` · `(integer, integer, integer) -> integer`

Return `a^b mod m` (modular exponentiation). A negative `b` uses the modular inverse of `a`; the result is undefined when that inverse does not exist (i.e. when `a` and `m` are not coprime). The result is in the range [0, m).

```epsil
powerMod(2, 10, 1000)
// ➔ 24
```

### primeFactors

MathJSON `PrimeFactors` · `(integer) -> list<integer>`

Return the sorted list of distinct prime factors of an integer `n`. The sign of `n` is ignored; `PrimeFactors(1)` is the empty list.

```epsil
primeFactors(360)
// ➔ [2,3,5]
```

### primeNu

MathJSON `PrimeNu` · `(integer) -> integer`

Return ω(n), the number of distinct prime factors of `n`. The sign of `n` is ignored; `PrimeNu(1)` is 0.

```epsil
primeNu(360)
// ➔ 3
```

### primeNumber

MathJSON `PrimeNumber` · `(integer) -> integer`

The nth prime number. `PrimeNumber` is an alias for `NthPrime`, which is the preferred name.

### primeOmega

MathJSON `PrimeOmega` · `(integer) -> integer`

Return Ω(n), the number of prime factors of `n` counted with multiplicity. The sign of `n` is ignored; `PrimeOmega(1)` is 0.

```epsil
primeOmega(360)
// ➔ 6
```

### primePi

MathJSON `PrimePi` · `(real) -> integer`

Return π(n), the prime-counting function: the number of primes less than or equal to `n`.

```epsil
primePi(10)
// ➔ 4
```

### primitiveRoot

MathJSON `PrimitiveRoot` · `(integer) -> integer`

The smallest primitive root modulo `n` (a generator of the multiplicative group of integers mod `n`), or undefined if none exists (which happens unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p).

```epsil
primitiveRoot(7)
// ➔ 3
```

### radical

MathJSON `Radical` · `(integer) -> integer`

Return the radical of `n` (its square-free kernel): the product of its distinct prime factors. The sign of `n` is ignored; `Radical(1)` is 1.

```epsil
radical(360)
// ➔ 30
```

### randomPrime

MathJSON `RandomPrime` · `(integer, integer?) random -> integer`

Return a random prime. `RandomPrime(n)` draws a prime in [2, n]; `RandomPrime(m, n)` draws a prime in [m, n]. Undefined if the range contains no prime.

```epsil
randomPrime(100)
```

### sigma0

MathJSON `Sigma0` · `(integer) -> integer`

Number of positive divisors of n.

### sigma1

MathJSON `Sigma1` · `(integer) -> integer`

Sum of positive divisors of n.

### sigmaMinus1

MathJSON `SigmaMinus1` · `(integer) -> rational`

Sum of reciprocals of positive divisors of n.

### stirling

MathJSON `Stirling` · `(integer, integer) -> integer`

Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets.

### stirlingS1

MathJSON `StirlingS1` · `(integer, integer) -> integer`

Signed Stirling number of the first kind s(n, m): the coefficient of x^m in the falling factorial x(x−1)…(x−n+1). Its absolute value counts the permutations of n elements with exactly m disjoint cycles.

```epsil
stirlingS1(5, 2)
// ➔ -50
```

### totient

MathJSON `Totient` · `(integer) -> integer`

Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n.
