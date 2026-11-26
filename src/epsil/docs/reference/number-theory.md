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

The 70 definitions of the number theory library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### algebraicNumberNorm

MathJSON `AlgebraicNumberNorm` · `(number) -> number`

- argument 1 — The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `1 + sqrt(2)`.

The norm of a over ℚ in the field ℚ(a): (−1)ᵈ times its minimal polynomial’s constant term over its leading one.

```epsil
algebraicNumberNorm(1 + sqrt(2))
// ➔ -1
```

```epsil
algebraicNumberNorm(3 + sqrt(2))
// ➔ 7
```

### algebraicNumberTrace

MathJSON `AlgebraicNumberTrace` · `(number) -> number`

- argument 1 — The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `1 + sqrt(2)`.

The trace of a over ℚ in the field ℚ(a): minus its minimal polynomial’s second coefficient over its leading one.

```epsil
algebraicNumberTrace(1 + sqrt(2))
// ➔ 2
```

```epsil
algebraicNumberTrace(1 + sqrt(3) / 2)
// ➔ 2
```

### bernoulliB

MathJSON `BernoulliB` · `(integer) -> rational`

- argument 1 — The index, at least 0; a negative one stays unevaluated. Sample: `2`.

Return the nth Bernoulli number Bₙ as an exact rational, using the convention B₁ = -1/2. Odd `n > 1` give 0.

```epsil
bernoulliB(2)
// ➔ 1/6
```

### carmichaelLambda

MathJSON `CarmichaelLambda` · `(integer) -> integer`

- argument 1 — The modulus, at least 1; a smaller one stays unevaluated. Sample: `15`.

Return the Carmichael function λ(n) (the reduced totient): the smallest positive integer `m` such that `a^m ≡ 1 (mod n)` for every `a` coprime to `n`. Defined for `n ≥ 1`.

```epsil
carmichaelLambda(15)
// ➔ 4
```

### catalanNumber

MathJSON `CatalanNumber` · `(real) -> number`

- argument 1 — The index, an integer at least 0 or a positive rational; a negative value stays unevaluated. Sample: `5`.

Return the nth Catalan number `C(n) = (2n)! / ((n+1)! · n!)`: 1, 1, 2, 5, 14, 42, … Defined for `n ≥ 0`. A positive rational `n` is taken through the Gamma function, `C(n) = Γ(2n+1) / (Γ(n+1) Γ(n+2))`: `catalanNumber(1/2)` is `8/(3π)`.

```epsil
catalanNumber(5)
// ➔ 42
```

```epsil
catalanNumber(1/2)
// ➔ 8 / (3pi)
```

### chineseRemainder

MathJSON `ChineseRemainder` · `(residues: collection<any>, moduli: collection<any>, lower: integer?) -> integer`

- `residues` — The integer residues, one for each modulus. Sample: `[2, 3, 2]`.
- `moduli` — The integer moduli, as many as residues; they need not be coprime, and an inconsistent system stays unevaluated. Sample: `[3, 5, 7]`.
- `lower` — The least value of the solution; without it the solution is the smallest non-negative one. Sample: `100`.

Solve a system of simultaneous congruences: return the smallest non-negative integer `x` such that `x ≡ residues[i] (mod moduli[i])` for every `i`. With a third argument `lower`, return the smallest solution `x ≥ lower`. Undefined if the system is inconsistent or the two lists differ in length.

```epsil
chineseRemainder([2, 3, 2], [3, 5, 7])
// ➔ 23
```

```epsil
chineseRemainder([2, 3, 2], [3, 5, 7], 100)
// ➔ 128
```

### continuedFraction

MathJSON `ContinuedFraction` · `(x: real, count: integer?) -> list<integer | list<integer>>`

- `x` — The finite real number to expand. Sample: `sqrt(2)`.
- `count` — The largest number of terms, at least 1; a periodic expansion is then written out term by term. Sample: `5`.

Return the continued-fraction expansion of `x` as a list of integer terms `[a0, a1, …]`. An exact rational is expanded fully. An exact quadratic irrational (`sqrt(2)`) is expanded to its periodic form `[a0, …, [period]]` (`[1, [2]]`), or to the optional `count` terms. Another exact real (`exponentialE`) is expanded to `count` terms (default 20), each computed at a precision that vouches for it. An inexact value is expanded as its best rational approximation at working precision (see `rationalize`), truncated to `count` terms (default 20).

```epsil
continuedFraction(43/19)
// ➔ [2,3,1,4]
```

```epsil
continuedFraction(sqrt(2))
// ➔ [1,[2]]
```

### digitCount

MathJSON `DigitCount` · `(n: integer, base: integer?, digit: integer?, length: integer?) -> integer | list<integer>`

- `n` — The integer whose digits are counted; its sign is ignored. Sample: `122`.
- `base` — The base, at least 2; 10 by default. Sample: `10`.
- `digit` — The digit to count, from 0 to `base - 1`; without it the result lists the count of every digit. Sample: `2`.
- `length` — The number of digits counted, at least 0: zeros pad the digits on the left, or their most-significant ones are dropped. Sample: `8`.

Count digits of `n` in the given `base` (default 10); the sign of `n` is ignored. With a third argument `digit`, return how many times that digit occurs. Otherwise return a list `[count of 1, count of 2, …, count of base-1, count of 0]`. With a fourth argument `length`, the digits are first zero-padded on the left (or cut to their last `length`), so `digitCount(5, 2, 0, 8)` is 6.

```epsil
digitCount(122, 10, 2)
// ➔ 2
```

```epsil
digitCount(5, 2, 0, 8)
// ➔ 6
```

### digitSum

MathJSON `DigitSum` · `(n: integer, base: integer?, count: integer?) -> integer`

- `n` — The integer whose digits are summed; its sign is ignored. Sample: `1234`.
- `base` — The base, at least 2; 10 by default. Sample: `10`.
- `count` — The number of digits summed, the first ones, or the last ones when it is negative. Sample: `2`.

Return the sum of the digits of `n` in the given `base` (default 10). The sign of `n` is ignored. With a third argument `count`, sum only the first `count` digits (most-significant first), or the last `|count|` when `count` is negative; a `count` past the digit count sums them all.

```epsil
digitSum(1234)
// ➔ 10
```

```epsil
digitSum(1234, 10, 2)
// ➔ 3
```

### dirichletCharacter

MathJSON `DirichletCharacter` · `(k: integer, j: integer, n: integer) -> number`

- `k` — The modulus of the character, at least 1. Sample: `5`.
- `j` — The index of the character, from 1 (the principal character) to φ(k); another one stays unevaluated. Sample: `2`.
- `n` — The integer at which the character is evaluated. Sample: `2`.

The Dirichlet character χ_j(n) modulo `k`, the `j`-th of the φ(k) characters (Wolfram's indexing, `j = 1` the principal character). Zero where gcd(n, k) &gt; 1; otherwise a root of unity.

```epsil
dirichletCharacter(5, 2, 2)
// ➔ i
```

```epsil
dirichletCharacter(7, 3, 3)
// ➔ e^(2/3 * i * pi)
```

### dirichletL

MathJSON `DirichletL` · `(k: integer, j: integer, s: number) -> number`

- `k` — The modulus of the character, at least 1. Sample: `4`.
- `j` — The index of the character, from 1 (the principal character) to φ(k). Sample: `2`.
- `s` — The point at which the L-function is evaluated. Sample: `2`.

The Dirichlet L-function L(s, χ) = Σ χ(n)/nˢ (n ≥ 1) of the character χ_j modulo `k` (`dirichletCharacter(k, j, ·)`): `k^(−s) Σ_{r=1}^{k} χ(r) ζ(s, r/k)`. Entire for a non-principal character; the principal one is `ζ(s) Π_{p|k} (1 − p^(−s))`.

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
// ➔ (3/5 + 1/5 * i)
```

### divides

MathJSON `Divides` · `(integer, integer) -> boolean`

- argument 1 — The divisor; 0 divides only 0. Sample: `3`.
- argument 2 — The integer to test for divisibility. Sample: `12`.

`divides(a, b)` returns `True` if `a` divides `b` (i.e. `b` is an integer multiple of `a`), corresponding to the notation `a ∣ b`. Both operands are integers; a symbolic operand keeps the relation unevaluated.

```epsil
divides(3, 12)
// ➔ true
```

### divisorSigma

MathJSON `DivisorSigma` · `(k: integer, n: integer) -> rational`

- `k` — The power of each divisor; 0 counts the divisors, and a negative one sums reciprocal powers. Sample: `2`.
- `n` — The integer whose positive divisors are summed; its sign is ignored, and 0 stays unevaluated. Sample: `6`.

The divisor function σ_k(n) = Σ_&#123;d | n&#125; dᵏ over the positive divisors of `n`. σ₀ counts divisors, σ₁ sums them. A negative `k` sums reciprocal powers, a rational: `divisorSigma(-1, 12)` is 7/3. The sign of `n` is ignored, as for `divisors` and `primeOmega`; `divisorSigma(k, 0)` is undefined.

```epsil
divisorSigma(2, 6)
// ➔ 50
```

```epsil
divisorSigma(-1, 12)
// ➔ 7/3
```

### divisors

MathJSON `Divisors` · `(integer) -> list<integer>`

- argument 1 — The integer whose divisors are listed; its sign is ignored, and 0 stays unevaluated. Sample: `12`.

Return the sorted list of positive divisors of an integer `n`. The sign of `n` is ignored.

```epsil
divisors(12)
// ➔ [1,2,3,4,6,12]
```

### eulerE

MathJSON `EulerE` · `(n: integer, x: number?) -> number`

- `n` — The index, at least 0; a negative one stays unevaluated. Sample: `4`.
- `x` — The point at which the Euler polynomial is evaluated, a number or a symbol; without it the result is the Euler number. Sample: `1/2`.

Return the nth Euler number Eₙ (1, 0, -1, 0, 5, 0, -61, …) for `eulerE(n)`, or the Euler polynomial Eₙ(x) for `eulerE(n, x)`. Odd-index Euler numbers are 0. Eₙ = 2ⁿ·Eₙ(1/2). A negative or non-integer `n` stays symbolic.

```epsil
eulerE(4)
// ➔ 5
```

```epsil
eulerE(2, x)
// ➔ x^2 - x
```

### eulerPhi

MathJSON `EulerPhi` · `(integer) -> integer`

- argument 1 — The integer whose totient is computed; its sign is ignored, and φ(0) is 0. Sample: `12`.

`eulerPhi` is an alias for `totient`, which is the preferred name. Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n, for n ≥ 1; φ(0) = 0 and φ(−n) = φ(n).

```epsil
eulerPhi(12)
// ➔ 4
```

### eulerian

MathJSON `Eulerian` · `(n: integer, m: integer) -> integer`

- `n` — The number of elements permuted, at least 0. Sample: `4`.
- `m` — The number of ascents, at least 0; the value is 0 from `m = n` on (for `n ≥ 1`). Sample: `1`.

Eulerian number A(n, m): number of permutations of &#123;1..n&#125; with exactly m ascents.

```epsil
eulerian(4, 1)
// ➔ 11
```

```epsil
eulerian(5, 2)
// ➔ 66
```

### extendedGCD

MathJSON `ExtendedGCD` · `(integer, integer, integer*) -> tuple`

- argument 1 — The first integer; its Bézout coefficient is the second entry of the result. Sample: `12`.
- argument 2 — The second integer; its Bézout coefficient is the third entry of the result. Sample: `18`.
- arguments 3, … — A further integer; its Bézout coefficient follows those of the integers before it. Sample: `27`.

Return the extended GCD of `a` and `b` as a tuple `(g, x, y)` where `g = gcd(a, b)` is non-negative and `a·x + b·y = g` (Bézout coefficients). With more operands, `ExtendedGCD(a₁, …, aₙ)` is the tuple `(g, x₁, …, xₙ)` with `g = gcd(a₁, …, aₙ)` and `Σ aᵢ·xᵢ = g`.

```epsil
extendedGCD(12, 18)
// ➔ (6, -1, 1)
```

```epsil
extendedGCD(12, 18, 27)
// ➔ (3, 4, -4, 1)
```

### factorInteger

MathJSON `FactorInteger` · `(rational) -> list<tuple<integer, integer>>`

- argument 1 — The integer or rational to factor; 0 and ±1 give `[(0, 1)]`, `[(1, 1)]` and `[(-1, 1)]`. Sample: `360`.

Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. For a negative `n`, a leading `[-1, 1]` tuple carries the sign. A rational `p/q` is factored as `p` and `q`, the exponents of the primes of `q` being negative.

```epsil
factorInteger(360)
// ➔ [(2, 3),(3, 2),(5, 1)]
```

```epsil
factorInteger(12/35)
// ➔ [(2, 2),(3, 1),(5, -1),(7, -1)]
```

### fromContinuedFraction

MathJSON `FromContinuedFraction` · `(collection<any>) -> number`

- argument 1 — The integer terms, from the integer part on; a last element that is a list is the period, and an empty list stays unevaluated. Sample: `[1, [2]]`.

Reconstruct the value of a continued fraction given its list of integer terms `[a0, a1, …]`. A last element that is a list is the repeating period, `[1, [2]]`: the quadratic irrational `sqrt(2)`.

```epsil
fromContinuedFraction([2, 3, 1, 4])
// ➔ 43/19
```

```epsil
fromContinuedFraction([1, [2]])
// ➔ sqrt(2)
```

### fromDigits

MathJSON `FromDigits` · `(digits: collection<any>, base: number?) -> number`

- `digits` — The digits, most-significant first; an empty list gives 0. Sample: `[1, 2, 3, 4]`.
- `base` — The base, 10 by default; any number or symbol. Sample: `2`.

Reconstruct a number from its digits (most-significant first) in the given `base` (default 10). The inverse of `integerDigits`. Digits outside `[0, base)` are combined positionally, and the base may be any number or symbol: `fromDigits([1, 1, 0], -2)` is 2 and `fromDigits([a, b, c], x)` is `a x^2 + b x + c`.

```epsil
fromDigits([1, 2, 3, 4])
// ➔ 1234
```

```epsil
fromDigits([1, 1, 0], -2)
// ➔ 2
```

```epsil
fromDigits([a, b, c], x)
// ➔ a * x^2 + b * x + c
```

### integerDigits

MathJSON `IntegerDigits` · `(n: integer, base: integer?, length: integer?) -> list<integer>`

- `n` — The integer whose digits are listed; its sign is ignored. Sample: `255`.
- `base` — The base, at least 2; 10 by default. Sample: `16`.
- `length` — The length of the result, at least 0: zeros pad it on the left, or its most-significant digits are dropped. Sample: `8`.

Return the digits of `n` in the given `base` (default 10), most-significant first. The sign of `n` is ignored. With a third argument `length`, the result is zero-padded on the left (or truncated to its least-significant digits) to that length.

```epsil
integerDigits(255, 16)
// ➔ [15,15]
```

### integerSqrt

MathJSON `IntegerSqrt` · `(integer) -> integer`

- argument 1 — The integer whose square root is rounded down; a negative one stays unevaluated. Sample: `17`.

Return the integer square root of `n`, i.e. the largest integer `m` such that `m² ≤ n`. Undefined for negative `n`.

```epsil
integerSqrt(17)
// ➔ 4
```

### isAbundant

MathJSON `IsAbundant` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not abundant. Sample: `12`.

True if n is an abundant number (sum of divisors &gt; 2n).

```epsil
isAbundant(12)
// ➔ true
```

### isAlgebraicInteger

MathJSON `IsAlgebraicInteger` · `(number) -> boolean`

- argument 1 — The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `(1 + sqrt(5)) / 2`.

Whether a is an algebraic integer: a root of a monic polynomial over ℤ.

```epsil
isAlgebraicInteger((1 + sqrt(5)) / 2)
// ➔ true
```

```epsil
isAlgebraicInteger(sqrt(2) / 2)
// ➔ false
```

### isCenteredSquare

MathJSON `IsCenteredSquare` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not a centered square. Sample: `25`.

True if n is a centered square number, n = t² + (t + 1)² for an integer t ≥ 0: 1, 5, 13, 25, 41, ...

```epsil
isCenteredSquare(25)
// ➔ true
```

### isHappy

MathJSON `IsHappy` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not happy. Sample: `19`.

True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit

```epsil
isHappy(19)
// ➔ true
```

```epsil
isHappy(4)
// ➔ false
```

### isOctahedral

MathJSON `IsOctahedral` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not octahedral. Sample: `19`.

True if n is an octahedral number.

```epsil
isOctahedral(19)
// ➔ true
```

### isPerfect

MathJSON `IsPerfect` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not perfect. Sample: `28`.

Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors.

```epsil
isPerfect(28)
// ➔ true
```

### isPerfectPower

MathJSON `IsPerfectPower` · `(integer) -> boolean`

- argument 1 — The integer to test; 0 and ±1 are not perfect powers, and a negative one is a perfect power when it is an odd power. Sample: `64`.

Return `"True"` if `n` is a perfect power `a^b` for integers `a` and `b ≥ 2` (a negative `n` requires an odd exponent). The smallest perfect power is 4.

```epsil
isPerfectPower(64)
// ➔ true
```

### isSquare

MathJSON `IsSquare` · `(integer) -> boolean`

- argument 1 — The integer to test; 0 is a square, a negative integer is not. Sample: `49`.

True if n is a perfect square.

```epsil
isSquare(49)
// ➔ true
```

### isSquareFree

MathJSON `IsSquareFree` · `(rational) -> boolean`

- argument 1 — The integer or rational to test; its sign is ignored, and 0 is not square-free. Sample: `30`.

Return `"True"` if `n` is square-free (not divisible by any perfect square &gt; 1). The sign of `n` is ignored. A rational is square-free when its numerator and denominator are.

```epsil
isSquareFree(30)
// ➔ true
```

```epsil
isSquareFree(6/35)
// ➔ true
```

### isTriangular

MathJSON `IsTriangular` · `(integer) -> boolean`

- argument 1 — The integer to test; one below 1 is not triangular. Sample: `10`.

True if n is a triangular number.

```epsil
isTriangular(10)
// ➔ true
```

### jacobiSymbol

MathJSON `JacobiSymbol` · `(a: integer, n: integer) -> integer`

- `a` — The integer on top of the symbol. Sample: `5`.
- `n` — The odd positive integer at the bottom of the symbol; another one stays unevaluated. Sample: `21`.

The Jacobi symbol (a/n) for an odd `n > 0`. Returns -1, 0, or 1. Undefined when `n` is even or non-positive.

```epsil
jacobiSymbol(5, 21)
// ➔ 1
```

### legendreSymbol

MathJSON `LegendreSymbol` · `(a: integer, p: integer) -> integer`

- `a` — The integer on top of the symbol; 0 when `p` divides it. Sample: `3`.
- `p` — The odd prime at the bottom of the symbol; another integer stays unevaluated. Sample: `7`.

The Legendre symbol (a/p) for an odd prime `p`. Returns -1, 0, or 1. Undefined when `p` is not an odd prime.

```epsil
legendreSymbol(3, 7)
// ➔ -1
```

### lucas

MathJSON `Lucas` · `(integer) -> integer`

- argument 1 — The index of the Lucas number, which may be negative. Sample: `10`.

`lucas` is an alias for `lucasL`, which is the preferred name. Returns the nth Lucas number.

```epsil
lucas(10)
// ➔ 123
```

### lucasL

MathJSON `LucasL` · `(integer) -> integer`

- argument 1 — The index of the Lucas number, which may be negative. Sample: `10`.

Return the nth Lucas number: `lucasL(0)` is 2, `lucasL(1)` is 1, and `LucasL(n) = LucasL(n-1) + LucasL(n-2)`. Negative indices follow `LucasL(-n) = (-1)^n · LucasL(n)`.

```epsil
lucasL(10)
// ➔ 123
```

### minimalPolynomial

MathJSON `MinimalPolynomial` · `(a: number, variable: any) -> expression`

- `a` — The algebraic number, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `sqrt(2)`.
- `variable` — The variable of the polynomial. Sample: `x`.

The minimal polynomial of the algebraic number a in x: primitive over ℤ, positive leading coefficient.

```epsil
minimalPolynomial(sqrt(2), x)
// ➔ x^2 - 2
```

```epsil
minimalPolynomial(1 + root(2, 3), x)
// ➔ x^3 - 3x^2 + 3x - 3
```

### modularInverse

MathJSON `ModularInverse` · `(a: integer, modulus: integer) -> integer`

- `a` — The integer to invert; it must be coprime to the modulus. Sample: `3`.
- `modulus` — The modulus `m`, not 0; a negative modulus gives a result in (m, 0]. Sample: `7`.

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

- argument 1 — The argument of μ. Its sign is ignored; it stays unevaluated at 0. Sample: `30`.

Return the Möbius function μ(n): 0 if `n` is divisible by a perfect square &gt; 1, otherwise (-1) raised to the number of distinct prime factors. The sign of `n` is ignored.

```epsil
moebiusMu(30)
// ➔ -1
```

### multiplicativeOrder

MathJSON `MultiplicativeOrder` · `(a: integer, modulus: integer, residues: list<integer>?) -> integer`

- `a` — The base whose powers are taken. Sample: `2`.
- `modulus` — The modulus; its sign is ignored, and 0 stays unevaluated. Sample: `7`.
- `residues` — The target residues: the result is the least `k > 0` with `a^k` congruent to one of them; by default, 1. Sample: `[3, 11]`.

The multiplicative order of `a` modulo `n`: the smallest `k > 0` such that `a^k ≡ 1 (mod n)`. Undefined unless `a` and `n` are coprime. With a list of residues, `MultiplicativeOrder(a, n, [r1, r2, …])` is the smallest `k > 0` such that `a^k ≡ r_i (mod n)` for some `i` (a discrete logarithm), and is undefined when no `r_i` is a power of `a`. The sign of `n` is ignored. Undefined for `n = 0`.

```epsil
multiplicativeOrder(2, 7)
// ➔ 3
```

```epsil
multiplicativeOrder(5, 7, [3, 11])
// ➔ 2
```

### nPartition

MathJSON `NPartition` · `(integer) -> integer`

- argument 1 — The integer to partition; a negative one gives 0. Sample: `5`.

Number of integer partitions of n, for n ≥ 0; it is 0 for n &lt; 0.

```epsil
nPartition(5)
// ➔ 7
```

```epsil
nPartition(10)
// ➔ 42
```

### nextPrime

MathJSON `NextPrime` · `(n: real, k: integer?) -> integer`

- `n` — The starting point, which is not counted even when it is prime. Sample: `10`.
- `k` — Which prime after `n` to return, 1 by default; a negative `k` counts the primes before `n`, and 0 stays unevaluated. Sample: `2`.

Return the smallest prime greater than `n`. With a second argument `k`, return the kth prime after `n` (`k < 0` returns the |k|th prime before `n`). A non-integer real or rational `n` is allowed: `nextPrime(7/2)` is 5.

```epsil
nextPrime(10)
// ➔ 11
```

```epsil
nextPrime(10, -1)
// ➔ 7
```

```epsil
nextPrime(7/2)
// ➔ 5
```

### notDivides

MathJSON `NotDivides` · `(integer, integer) -> boolean`

- argument 1 — The divisor `a`; 0 divides only 0. Sample: `3`.
- argument 2 — The integer `b` to divide. Sample: `10`.

`notDivides(a, b)` returns `True` if `a` does not divide `b`, corresponding to the notation `a ∤ b`.

```epsil
notDivides(3, 10)
// ➔ true
```

### nthPrime

MathJSON `NthPrime` · `(integer) -> integer`

- argument 1 — The rank of the prime, from 1; it stays unevaluated below 1. Sample: `10`.

Return the nth prime number (1-based): `nthPrime(1)` is 2, `nthPrime(2)` is 3, …

```epsil
nthPrime(10)
// ➔ 29
```

### numberFieldDiscriminant

MathJSON `NumberFieldDiscriminant` · `(number) -> integer`

- argument 1 — The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `sqrt(2)`.

The discriminant of the field ℚ(a): of its ring of integers.

```epsil
numberFieldDiscriminant(sqrt(2))
// ➔ 8
```

```epsil
numberFieldDiscriminant(sqrt(5))
// ➔ 5
```

### numberFieldIntegralBasis

MathJSON `NumberFieldIntegralBasis` · `(number) -> list<number>`

- argument 1 — The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `sqrt(2)`.

A ℤ-basis of the ring of integers of ℚ(a), written on the powers of the generator read (the radical or root a is written in), as Wolfram writes it.

```epsil
numberFieldIntegralBasis(sqrt(5))
// ➔ [1,1/2 + sqrt(5)/2]
```

### numberFieldSignature

MathJSON `NumberFieldSignature` · `(number) -> list<integer>`

- argument 1 — The algebraic number that generates the field, a polynomial in one generator (a radical of a rational, `i`, the golden ratio or a `PolynomialRoot`); another value stays unevaluated. Sample: `sqrt(2)`.

The signature (r₁, r₂) of ℚ(a): its real embeddings and its pairs of complex ones.

```epsil
numberFieldSignature(root(2, 3))
// ➔ [1,1]
```

### partitionsP

MathJSON `PartitionsP` · `(integer) -> integer`

- argument 1 — The integer to partition; a negative one gives 0. Sample: `5`.

`partitionsP` is an alias for `nPartition`, which is the preferred name. Number of integer partitions of n, for n ≥ 0; it is 0 for n &lt; 0.

```epsil
partitionsP(5)
// ➔ 7
```

### partitionsQ

MathJSON `PartitionsQ` · `(integer) -> integer`

- argument 1 — The integer to partition; a negative one gives 0. Sample: `10`.

Number of partitions of n into distinct parts (equivalently, into odd parts), q(n); it is 0 for n &lt; 0. The Wolfram Language `partitionsQ`.

```epsil
partitionsQ(10)
// ➔ 10
```

### polynomialRoot

MathJSON `PolynomialRoot` · `(polynomial: any, variable: any, index: integer?) -> number`

- `polynomial` — The polynomial, with rational coefficients. Sample: `x^3 - x - 1`.
- `variable` — The variable of the polynomial, bound by the call. Sample: `x`.
- `index` — Which root, from 1 to the degree; without it, the abstract root of an irreducible polynomial. Sample: `1`.

The root of the polynomial p in the variable x (bound, as in Wolfram's Root[Function[x, p], k]). With an index, `polynomialRoot(p, x, k)` is the k-th root: real roots first in increasing order, then complex roots by increasing real part, each conjugate pair together with the lower one first, and the pairs that share a real part by increasing |imaginary part|, as Mathematica does. It is a numbered embedding, a particular complex number, the one `N()` gives, and its other roots are other numbers; a root that cannot be numbered with certainty stays unevaluated. The root of a polynomial of degree 1 or 2 is a rational or a radical; past that it stays `polynomialRoot` until `N()`. Without an index, `polynomialRoot(p, x)` is the abstract root of the irreducible polynomial p, with no complex embedding selected: it has no numeric value, and its other roots are indistinguishable from it. Example: PolynomialRoot(x² + x + 1, x, 1) → (−1 − i√3)/2

```epsil
polynomialRoot(x^2 - 2, x, 2)
// ➔ sqrt(2)
```

```epsil
N(polynomialRoot(x^3 - x - 1, x, 1))
// ➔ 1.32471795724474602596
```

### powerMod

MathJSON `PowerMod` · `(base: list<rational> | rational, exponent: list<rational> | rational, modulus: integer | list<integer>) -> integer | list<integer>`

- `base` — The base `a`; a rational `p/q` is `p` times the modular inverse of `q`. Sample: `2`.
- `exponent` — The exponent `b`; a negative one uses the inverse of the base, and a rational `s/r` asks for an `r`-th root of `a^s`. Sample: `10`.
- `modulus` — The modulus `m`, at least 1; the result is in [0, m). Sample: `1000`.

Return `a^b mod m` (modular exponentiation). A negative `b` uses the modular inverse of `a`; the result is undefined when that inverse does not exist (i.e. when `a` and `m` are not coprime). The result is in the range [0, m). A rational base `p/q` is `p` times the modular inverse of `q`, so `powerMod(1/2, 2, 7)` is 2. A rational exponent `s/r` gives the least `x` with `x^r ≡ a^s (mod m)`, the first entry of `powerModList(a, s/r, m)`. It is undefined when there is none, when `m` cannot be factored, or when there are too many roots to list and none of them is less than 100000. A list operand threads: `powerMod([2, 3], 2, 7)` is `[4, 2]`.

```epsil
powerMod(2, 10, 1000)
// ➔ 24
```

```epsil
powerMod(4, 1/2, 7)
// ➔ 2
```

```epsil
powerMod(1/2, 2, 7)
// ➔ 2
```

### powerModList

MathJSON `PowerModList` · `(base: list<rational> | rational, exponent: list<rational> | rational, modulus: integer | list<integer>) -> list<integer> | list<list<integer>>`

- `base` — The base `a`; a rational `p/q` is `p` times the modular inverse of `q`. Sample: `3`.
- `exponent` — The exponent `s/r`: the result lists the `x` with `x^r` congruent to `a^s`; an integer exponent gives one value. Sample: `1/2`.
- `modulus` — The modulus `m`, at least 1; the roots are in [0, m). Sample: `11`.

Return the sorted list of every `x` in [0, m) with `x^r ≡ a^s (mod m)`, for the exponent `s/r`. An integer exponent gives the single value `a^s mod m`, a negative one using the modular inverse of `a`. A rational base is read as `p` times the inverse of `q`. A list operand threads: `powerModList([2, 3], 2, 7)` is `[[4], [2]]`. The list is empty when `a^s` is not an `r`-th power mod `m`. Undefined for a modulus `m < 1`, when the inverse of `a` does not exist, or when `m` cannot be factored or there are too many roots to list.

```epsil
powerModList(3, 1/2, 11)
// ➔ [5,6]
```

```epsil
powerModList(1, 1/3, 7)
// ➔ [1,2,4]
```

### primeFactors

MathJSON `PrimeFactors` · `(integer) -> list<integer>`

- argument 1 — The integer to factor. Its sign is ignored; it stays unevaluated at 0. Sample: `360`.

Return the sorted list of distinct prime factors of an integer `n`. The sign of `n` is ignored; `primeFactors(1)` is the empty list.

```epsil
primeFactors(360)
// ➔ [2,3,5]
```

### primeNu

MathJSON `PrimeNu` · `(integer) -> integer`

- argument 1 — The integer whose distinct prime factors are counted. Its sign is ignored; it stays unevaluated at 0. Sample: `360`.

Return ω(n), the number of distinct prime factors of `n`. The sign of `n` is ignored; `primeNu(1)` is 0.

```epsil
primeNu(360)
// ➔ 3
```

### primeNumber

MathJSON `PrimeNumber` · `(integer) -> integer`

- argument 1 — The rank of the prime, from 1; it stays unevaluated below 1. Sample: `10`.

The nth prime number. `primeNumber` is an alias for `nthPrime`, which is the preferred name.

```epsil
primeNumber(10)
// ➔ 29
```

### primeOmega

MathJSON `PrimeOmega` · `(integer) -> integer`

- argument 1 — The integer whose prime factors are counted. Its sign is ignored; it stays unevaluated at 0. Sample: `360`.

Return Ω(n), the number of prime factors of `n` counted with multiplicity. The sign of `n` is ignored; `primeOmega(1)` is 0.

```epsil
primeOmega(360)
// ➔ 6
```

### primePi

MathJSON `PrimePi` · `(real) -> integer`

- argument 1 — The upper bound, which need not be an integer; below 2 the count is 0. Sample: `10`.

Return π(n), the prime-counting function: the number of primes less than or equal to `n`.

```epsil
primePi(10)
// ➔ 4
```

### primitiveRoot

MathJSON `PrimitiveRoot` · `(integer) -> integer`

- argument 1 — The modulus. Its sign is ignored; it stays unevaluated at 0. Sample: `7`.

The smallest primitive root modulo `n` (a generator of the multiplicative group of integers mod `n`), or undefined if none exists (which happens unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p). The sign of `n` is ignored, and `primitiveRoot(1)` is 0. Undefined for `n = 0`.

```epsil
primitiveRoot(7)
// ➔ 3
```

### primitiveRootList

MathJSON `PrimitiveRootList` · `(integer) -> list<integer>`

- argument 1 — The modulus. Its sign is ignored; 0 gives the empty list. Sample: `7`.

The sorted list of all primitive roots modulo `n`: the generators of the multiplicative group of integers mod `n`. The list is empty when there is none (unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p), and for `n = 0`. `primitiveRootList(1)` is `[0]`, as `primitiveRoot(1)` is 0. The sign of `n` is ignored. Undefined when `n` cannot be factored or there are too many roots to list.

```epsil
primitiveRootList(7)
// ➔ [3,5]
```

```epsil
primitiveRootList(8)
// ➔ []
```

### radical

MathJSON `Radical` · `(integer) -> integer`

- argument 1 — The integer whose radical is returned. Its sign is ignored; it stays unevaluated at 0. Sample: `360`.

Return the radical of `n` (its square-free kernel): the product of its distinct prime factors. The sign of `n` is ignored; `radical(1)` is 1.

```epsil
radical(360)
// ➔ 30
```

### randomPrime

MathJSON `RandomPrime` · `(integer, integer?) random -> integer`

- argument 1 — Alone, the upper bound `n` of the range; with a second argument, its lower bound `m` (a lower bound below 2 is read as 2). Sample: `100`.
- argument 2 — The upper bound `n` of the range. Sample: `200`.

Return a random prime. `randomPrime(n)` draws a prime in [2, n]; `randomPrime(m, n)` draws a prime in [m, n]. Undefined if the range contains no prime.

```epsil
randomPrime(100)
```

### rationalReconstruction

MathJSON `RationalReconstruction` · `(a: integer, modulus: integer) -> rational`

- `a` — The residue to reconstruct. Sample: `6`.
- `modulus` — The modulus `m`, at least 1; it bounds the numerator and the denominator by the square root of `(m - 1)/2`. Sample: `11`.

The rational `p/q` with `p ≡ a·q (mod m)` and `|p|, q ≤ ⌊√((m − 1)/2)⌋`, the unique such fraction in lowest terms when it exists (Wang's algorithm). Undefined for `m < 1` or when there is none.

```epsil
rationalReconstruction(6, 11)
// ➔ 1/2
```

### sigma0

MathJSON `Sigma0` · `(integer) -> integer`

- argument 1 — The integer whose divisors are taken; it stays unevaluated below 1. Sample: `12`.

Number of positive divisors of n.

```epsil
sigma0(12)
// ➔ 6
```

### sigma1

MathJSON `Sigma1` · `(integer) -> integer`

- argument 1 — The integer whose divisors are taken; it stays unevaluated below 1. Sample: `12`.

Sum of positive divisors of n.

```epsil
sigma1(12)
// ➔ 28
```

```epsil
sigma1(6)
// ➔ 12
```

### sigmaMinus1

MathJSON `SigmaMinus1` · `(integer) -> rational`

- argument 1 — The integer whose divisors are taken; it stays unevaluated below 1. Sample: `12`.

Sum of reciprocals of positive divisors of n.

```epsil
sigmaMinus1(12)
// ➔ 7/3
```

```epsil
sigmaMinus1(6)
// ➔ 2
```

### stirling

MathJSON `Stirling` · `(n: integer, m: integer) -> integer`

- `n` — The number of elements, at least 0. Sample: `5`.
- `m` — The number of subsets, at least 0; past `n` the value is 0. Sample: `2`.

Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets.

```epsil
stirling(5, 2)
// ➔ 15
```

### stirlingS1

MathJSON `StirlingS1` · `(n: integer, m: integer) -> integer`

- `n` — The number of elements, at least 0. Sample: `5`.
- `m` — The number of cycles, at least 0; past `n` the value is 0. Sample: `2`.

Signed Stirling number of the first kind s(n, m): the coefficient of x^m in the falling factorial x(x−1)…(x−n+1). Its absolute value counts the permutations of n elements with exactly m disjoint cycles.

```epsil
stirlingS1(5, 2)
// ➔ -50
```

### stirlingS2

MathJSON `StirlingS2` · `(n: integer, m: integer) -> integer`

- `n` — The number of elements, at least 0. Sample: `5`.
- `m` — The number of subsets, at least 0; past `n` the value is 0. Sample: `2`.

`stirlingS2` is an alias for `stirling`, which is the preferred name. Returns the Stirling number of the second kind S(n, m).

```epsil
stirlingS2(6, 3)
// ➔ 90
```

### totient

MathJSON `Totient` · `(integer) -> integer`

- argument 1 — The integer `n`; φ(0) is 0, and the sign of `n` is ignored. Sample: `12`.

Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n, for n ≥ 1; φ(0) = 0 and φ(−n) = φ(n).

```epsil
totient(12)
// ➔ 4
```

```epsil
totient(36)
// ➔ 12
```
