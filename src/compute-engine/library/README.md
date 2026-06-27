# Standard Library

## To Do

- Add Physical Constants from NIST:
  - https://physics.nist.gov/cuu/Constants/Table/allascii.txt

- See Scala/Breeze "universal functions":
  https://github.com/scalanlp/breeze/wiki/Universal-Functions

- LogOnePlus: { domain: 'Numbers' },
  - See https://numerics.diploid.ca/floating-point-part-4.html, regarding
    'remainder' and 'truncatingRemainder'

- Hash

### Number Theory:

Primes:

- NthPrime: gives the nth prime number (the name `Prime` is reserved for
  derivative notation; `PrimeNumber` is an alias for `NthPrime`)
- NextPrime: the smallest prime larger than `n` (with an optional `k` for the
  kth prime after `n`, or before it when `k < 0`)
- PrimePi: the prime-counting function π(n)
- RandomPrime: a random prime in a range
  (primality: trial division for small `n`, Miller–Rabin above 2³²)

Factorization & divisors:

- FactorInteger: the prime factorization of `n` as a list of `[prime, exponent]`
  tuples
- PrimeFactors: the sorted distinct prime factors of `n`
- Divisors: the sorted list of positive divisors of `n`
- DivisorSigma: the divisor function σ_k(n) (generalizes Sigma0/Sigma1)
- Radical: the square-free kernel (product of distinct primes)
- PrimeNu / PrimeOmega: count of prime factors without / with multiplicity
- MoebiusMu: the Möbius function μ(n)
- IsSquareFree, IsPerfectPower: predicates

Modular arithmetic & GCD:

- PowerMod: modular exponentiation (negative exponent → modular inverse)
- ExtendedGCD: GCD with Bézout coefficients
- ChineseRemainder: solve simultaneous congruences
- MultiplicativeOrder, PrimitiveRoot
- JacobiSymbol, LegendreSymbol

Other primitives:

- IntegerSqrt, CarmichaelLambda, LucasL, CatalanNumber, BernoulliB
- ContinuedFraction / FromContinuedFraction
- IntegerDigits / FromDigits, DigitCount, DigitSum

### Combinatorials

- Binomial
- Fibonacci
