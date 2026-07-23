---
title: Cortex Examples
sidebar_label: Examples
slug: /cortex/examples/
description: "Cortex Examples"
hide_title: true
date: Last Modified
---
# Examples

Complete Cortex programs, from simple iteration to symbolic computation.
Every example on this page is executable as written. The documentation test
executes each code fence directly through `executeCortex`, while
`test/cortex/programs.test.ts` provides deeper assertions for representative
results and runtime behavior.

A few idioms these programs rely on:

- Loops (`for`, `while`) are evaluated **for effect** — accumulate into a
  variable (a number, or a list built up with `Join`/`Append`), or use
  `Map`/`Filter`/`Reduce` for value-producing iteration.
- Collection **literals** evaluate their elements; lazy **operators**
  (`Range`, `Map`, `Filter`) are generators that enumerate on demand (see
  [Evaluation](/cortex/evaluation/)).
- `a % b` is the remainder (`Mod`), and a postfix `!` is the factorial. The
  `!` must directly follow its operand (`n!`; `x != y` is still ≠).

## Iteration and Accumulation

**Sum of the multiples of 3 or 5 below 100.** A `for` loop over a `Range`,
accumulating into a variable:

```cortex
let total = 0
for k in Range(1, 99) {
  if k % 3 == 0 || k % 5 == 0 { total = total + k }
}
total
// ➔ 2318
```

**FizzBuzz, as a value.** `if`/`else` is an expression, so the whole program
is a single `Map` — no printing, no mutation:

```cortex
Map(Range(1, 15), k |->
  if k % 15 == 0 { "FizzBuzz" }
  else if k % 3 == 0 { "Fizz" }
  else if k % 5 == 0 { "Buzz" }
  else { k })
// ➔ [1, 2, "Fizz", 4, "Buzz", "Fizz", 7, 8, "Fizz", "Buzz", 11, "Fizz", 13, 14, "FizzBuzz"]
```

**Collatz stopping time.** A `while` loop whose body chooses the next value
with an `if` expression:

```cortex
let n = 27
let steps = 0
while n != 1 {
  n = if n % 2 == 0 { n / 2 } else { 3n + 1 }
  steps = steps + 1
}
steps
// ➔ 111
```

**Euclid's algorithm.** The classic three-line GCD, with a block-scoped
temporary:

```cortex
let a = 1071
let b = 462
while b != 0 {
  let t = a % b
  a = b
  b = t
}
a
// ➔ 21
```

**Collecting values in a loop.** A list accumulates through `Join`; each
appended literal snapshots the loop variable's current value:

```cortex
let xs = []
for k in Range(1, 3) { xs = Join(xs, [k]) }
xs
// ➔ [1, 2, 3]
```

**Iterative Fibonacci.**

```cortex
let a = 0
let b = 1
for k in Range(1, 20) {
  let t = a + b
  a = b
  b = t
}
a
// ➔ 6765
```

**A trial-division primality test.** A function with a block body, used to
count the primes below 100:

```cortex
isPrime(n) = if n < 2 { False } else {
  let d = 2
  let prime = True
  while d * d <= n {
    if n % d == 0 { prime = False; d = n } else { d = d + 1 }
  }
  prime
}
let count = 0
for k in Range(2, 99) { if isPrime(k) { count = count + 1 } }
count
// ➔ 25
```

## Control Flow and Predicates

**Nested loops.** Each `while` owns its own block-scoped counter; the inner
loop re-runs in full for every pass of the outer one. Here Σ i·j over
1 ≤ i, j ≤ 3 is (1+2+3)² = 36:

```cortex
let i = 1
let total = 0
while i <= 3 {
  let j = 1
  while j <= 3 { total = total + i * j; j = j + 1 }
  i = i + 1
}
total
// ➔ 36
```

**Chained comparisons.** A chain like `1 < x <= 4` reads as the conjunction
`1 < x && x <= 4`:

```cortex
let x = 4
let y = 5
(1 < x <= 4, 1 < y <= 4)
// ➔ (True, False)
```

**A truth table**, as a `Map` over the four boolean pairs:

```cortex
Map([(True, True), (True, False), (False, True), (False, False)],
    p |-> p[1] && p[2])
// ➔ [True, False, False, False]
```

## Integers and Number Theory

**Modular exponentiation.** `a^b % m` is computed exactly, then reduced. By
Fermat's little theorem 7¹² ≡ 1 (mod 13), and 222 = 18·12 + 6, so:

```cortex
(7^222) % 13
// ➔ 12
```

**gcd/lcm, factorization and divisors** of a number:

```cortex
(GCD(48, 36), LCM(48, 36), FactorInteger(360), Divisors(28))
// ➔ (12, 144, [(2, 3), (3, 2), (5, 1)], [1, 2, 4, 7, 14, 28])
```

**Arbitrary-precision integers.** The iterative Fibonacci, with the running
pair carried in a two-element list literal, stays exact all the way to F(200)
— far past the 2⁵³ limit of floating point:

```cortex
Fold((p, _) |-> [p[2], p[1] + p[2]], [0, 1], Range(1, 200))[1]
// ➔ 280571172992510140037611932413038677189525
```

## Recursion

A recursive function refers to itself by name — a one-step definition just
works, because the name is declared before the body is processed:

```cortex
fact(n) = if n <= 1 { 1 } else { n * fact(n - 1) }
fact(10)
// ➔ 3628800
```

The two-step form — declare with `let`, then assign a `|->` lambda — is
equivalent (`let fact` followed by
`fact = n |-> if n <= 1 { 1 } else { n * fact(n - 1) }`). Note that
*mutually* recursive functions still require declaring all the names with
`let` before defining any of them.

## Higher-Order Functions

Functions are values: they can be passed as arguments and returned from other
functions. A `|->` lambda captures the variables in scope where it is created.

**A numeric-derivative factory.** `deriv` returns a lambda that closes over
both the function `f` and the step `h`. The central-difference estimate is
computed *exactly* (as a rational):

```cortex
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
dg(2)
// ➔ 12000001/1000000
```

Wrap the call in `N(…)` for a floating-point value — numericization reaches
through the user-function/closure call:

```cortex
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
N(dg(2))
// ➔ 12.000001
```

**Function composition.** `compose` returns `f ∘ g`; the two orders give
different results, confirming each lambda captures the right binding:

```cortex
compose(f, g) = x |-> f(g(x))
inc(x) = x + 1
sq(x) = x^2
let h = compose(sq, inc)
(h(4), compose(inc, sq)(4))
// ➔ (25, 17)
```

**A counter factory.** `makeCounter` returns a zero-parameter lambda
(`() |-> …`) whose **block body** (`do { … }`) runs several statements and
yields the last one. The lambda closes over `count` and mutates it on each
call:

```cortex
function makeCounter() {
  let count = 0
  () |-> do { count = count + 1; count }
}
let c = makeCounter()
c()
c()
c()
// ➔ 3
```

`do { … }` opens a statement block in expression position: it evaluates its
statements in order and its value is the final one (a bare `{ … }` there is a
set/dictionary literal instead). `() |-> …` is a lambda that takes no
parameters.

Each `makeCounter()` call captures its own `count`, so counters are
independent:

```cortex
function makeCounter() {
  let count = 0
  () |-> do { count = count + 1; count }
}
let a = makeCounter()
let b = makeCounter()
[a(), a(), b(), a()]
// ➔ [1, 2, 1, 3]
```

## Numeric Methods

**Newton's method for √2.** The iteration runs exactly (each `x` is a
rational number); `N(…)` converts the final result to a float:

```cortex
let x = 1
for k in Range(1, 6) { x = (x + 2/x) / 2 }
N(x)
// ➔ 1.4142135623730950488
```

**Trapezoidal integration** of x² over [0, 1]:

```cortex
g(x) = x^2
let n = 100
let h = 1/n
let area = (g(0) + g(1)) / 2
for k in Range(1, n - 1) { area = area + g(k * h) }
N(area * h)
// ➔ 0.33335
```

**Monte Carlo estimate of π.** `Random()` returns a uniform value in [0, 1):

```cortex
let inside = 0
let total = 500
for k in Range(1, total) {
  let px = Random()
  let py = Random()
  if px^2 + py^2 < 1 { inside = inside + 1 }
}
N(4 * inside / total)
// ➔ ≈ 3.14 (varies by run)
```

**Reproducible simulations.** `RandomSeed(n)` seeds the random stream, so a
simulation can be replayed exactly; seeding again with the same value rewinds
the stream (`RandomSeed()` returns to a non-deterministic stream):

```cortex
RandomSeed(7)
let a = [RandomInteger(1, 100), RandomInteger(1, 100), RandomInteger(1, 100)]
RandomSeed(7)
let b = [RandomInteger(1, 100), RandomInteger(1, 100), RandomInteger(1, 100)]
a == b
// ➔ True
```

## Calculus

The calculus operators work symbolically, keeping parameters exact.

**Integration.** The work to stretch an ideal spring (force `F = kx`) from 0 to
a displacement `d` is `∫₀ᵈ kx dx`:

```cortex
Integrate(k*x, (x, 0, d))
// ➔ 1/2 * k * d^2
```

A definite integral with numeric bounds evaluates exactly:

```cortex
Integrate(Sin(x), (x, 0, Pi))
// ➔ 2
```

**Limits.** The leading relative error of the small-angle approximation
`sin x ≈ x` is governed by a limit at 0:

```cortex
Limit((Sin(x) - x)/x^3, x, 0)
// ➔ -1/6
```

**Series.** The Maclaurin expansion of sine, with a `BigO` tail marking the
first dropped term:

```cortex
Series(Sin(x), x, 0)
// ➔ x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)
```

## Units and Measurements

Units and measured quantities enter through `$…$` LaTeX islands and carry
through the computation.

**Unit conversion.** Convert a posted 30 km/h speed limit to SI m/s:

```cortex
N(UnitConvert($30\,\mathrm{km/h}$, $\mathrm{m/s}$))
// ➔ 8.333333333333334 m/s
```

**Uncertainty propagation.** `Measurement(value, error)` carries an absolute
uncertainty that `*` propagates in quadrature. For a plot measured
L = 10 ± 0.1 m by W = 20 ± 0.2 m, the area error is
√(20²·0.1² + 10²·0.2²) = √8 ≈ 2.83:

```cortex
let L = Measurement(10, 0.1)
let W = Measurement(20, 0.2)
N(L * W)
// ➔ 200.0 ± 2.8
```

## Complex Numbers

The imaginary unit is `i`; complex arithmetic, `Conjugate` and `Abs` (the
modulus) all work:

```cortex
((2 + 3i) * (1 - i), Conjugate(2 + 3i), Abs(3 + 4i))
// ➔ ((5 + i), (2 - 3i), 5)
```

**Euler's formula stays exact.** `e^{iπ/3}` is assembled from the exact
cos(π/3) = 1/2 and sin(π/3) = √3/2, without ever numericizing:

```cortex
$e^{i\pi/3}$
// ➔ 1/2 + sqrt(3)/2i
```

**A product of complex numbers** taken over a mapped `Range` keeps its
imaginary part: (1+i)(2+i)(3+i) = 10i:

```cortex
Product(Map(Range(1, 3), k |-> k + i))
// ➔ 10i
```

## Exact and Symbolic Computation

These examples show what sets Cortex apart from a conventional language: the
values flowing through a program are Compute Engine expressions, so
arithmetic is exact and results can be symbolic.

**Exact rationals.** The 20th harmonic number, accumulated in a loop, stays
an exact rational — no floating-point drift:

```cortex
let h = 0
for k in Range(1, 20) { h = h + 1/k }
h
// ➔ 55835135/15519504
```

**The Basel problem.** An exact partial sum compared against the limit
π²/6 — the difference is the tail of the series, ≈ 1/100:

```cortex
let s = Sum(1/k^2, (k, 1, 100))
N(Pi^2 / 6 - s)
// ➔ 0.00995016666333…
```

**Symbolic differentiation** of a user-defined function:

```cortex
f(x) = (x^2 + 1) / x
D(f(t), t)
// ➔ (t^2 - 1)/t^2
```

**Solve, then verify.** Solve a quadratic and substitute the roots back into
the polynomial:

```cortex
let roots = Solve(x^2 - 5x + 6 == 0, x)
Map(roots, r |-> r^2 - 5r + 6)
// ➔ [0, 0]
```

**A binomial coefficient**, with postfix factorials:

```cortex
10! / (3! * 7!)
// ➔ 120
```

**LaTeX islands.** A `$…$` span is parsed as LaTeX and spliced in as an
expression. Here, forty steps of the continued fraction 1 + 1/x against the
closed form of the golden ratio:

```cortex
let x = 2
for k in Range(1, 40) { x = 1 + 1/x }
let phi = $\frac{1 + \sqrt{5}}{2}$
N(Abs(x - phi))
// ➔ ≈ 6.24e-18
```

**Trailing zeros of 100!, two ways.** Legendre's formula counts the factors of
5 in the factorial:

```cortex
let n = 100
let p = 5
let z = 0
while p <= n { z = z + Floor(n / p); p = p * 5 }
z
// ➔ 24
```

Cross-check by stripping factors of 10 off the *exact* 158-digit integer `100!`:

```cortex
let f = 100!
let count = 0
while f % 10 == 0 { f = f / 10; count = count + 1 }
count
// ➔ 24
```

**Roots of unity.** The five 5th-roots of unity are the vertices of a regular
pentagon on the unit circle; their vector sum is exactly zero:

```cortex
Sum(Exp(2*Pi*ImaginaryUnit*k/5), (k, 0, 4))
// ➔ 0
```

(`N(…)` of the same sum returns zero to floating-point roundoff, ≈ 1e-16.)

**An exact rational Fold.** Folding `1/k` over a `Range` keeps the accumulator
an exact rational — the 10th harmonic number:

```cortex
Fold((a, k) |-> a + 1/k, 0, Range(1, 10))
// ➔ 7381/2520
```

**Closed-form sums.** A telescoping sum and a finite geometric sum, both exact:

```cortex
($\sum_{k=1}^{100}(1/k - 1/(k+1))$, $\sum_{k=0}^{10}(1/2)^k$)
// ➔ (100/101, 2047/1024)
```

**Exact trigonometric values.** Constructible angles evaluate to exact
symbolic values, never floats:

```cortex
($\sin(\pi/3)$, $\arctan(1)$, $\arcsin(1/2)$, $\tan(\pi/4)$)
// ➔ (sqrt(3)/2, 1/4 * pi, 1/6 * pi, 1)
```

**Solving equations exactly.** `Solve` returns the exact solution set — for a
cubic, an absolute-value equation and an exponential equation:

```cortex
(Solve($x^3 - 6x^2 + 11x - 6 = 0$, x), Solve($|x-3| = 5$, x), Solve($2^x = 8$, x))
// ➔ ([1, 2, 3], [-2, 8], [3])
```

## Strings

**String interpolation.** A `\( … )` escape splices any expression's value
into a string:

```cortex
let x = 2^11 - 1
"\(x) has type \(Type(x))"
// ➔ "2047 has type integer"
```

**A formatted table.** `\t` and `\n` escapes in a string literal are real
control characters. Build a table of `n`, `n²`, `n³` — a plain header string
plus one interpolated row per value, joined with `Fold`/`StringJoin`:

```cortex
let header = "n\tn^2\tn^3\n"
let lines = Map(Range(1, 5), n |-> "\(n)\t\(n^2)\t\(n^3)\n")
StringJoin(header, Fold((acc, line) |-> StringJoin(acc, line), "", lines))
```

produces (tabs aligned, newline-separated rows):

```
n	n^2	n^3
1	1	1
2	4	8
3	9	27
4	16	64
5	25	125
```

**Character frequencies.** `Characters` splits a string into user-perceived
characters (grapheme clusters); `Tally` counts them:

```cortex
let freq = Tally(Characters("mississippi"))
let d = DictionaryFrom(Zip(freq[1], freq[2]))
(d["m"], d["i"], d["s"], d["p"])
// ➔ (1, 4, 4, 2)
```

**Word counts.** `StringSplit` with no separator splits on runs of
whitespace (with a separator string, it splits on each occurrence):

```cortex
let words = StringSplit("the quick brown fox the lazy dog the")
(Length(words), Tally(words)[2])
// ➔ (8, [3, 1, 1, 1, 1, 1])
```

**A Caesar cipher.** `UnicodeScalars` turns a string into its code points;
shifting each and rebuilding with `StringFrom(…, "unicode-scalars")` is the
inverse operation, so encoding then decoding round-trips:

```cortex
function shift(s, k) {
  let out = []
  for c in UnicodeScalars(s) { out = Join(out, [c + k]) }
  StringFrom(out, "unicode-scalars")
}
(shift("hello", 3), shift(shift("hello", 3), -3))
// ➔ ("khoor", "hello")
```

**Anagrams and palindromes.** Two words are anagrams when their sorted
characters agree; a word is a palindrome when its characters equal their
reverse:

```cortex
let anagram = Sort(Characters("listen")) == Sort(Characters("silent"))
let s = "racecar"
let palindrome = Characters(s) == Reverse(Characters(s))
(anagram, palindrome)
// ➔ (True, True)
```

## Collections

**Matrices.** Lists of lists are matrices; index with `m[i, j]` (chained
`m[i][j]` also works):

```cortex
let m = [[2, 1], [1, 3]]
let d = Determinant(m)
let t = Transpose(m)
(d, t[1, 2], t[2, 1])
// ➔ (5, 1, 1)
```

**Descriptive statistics**, exact:

```cortex
let xs = [4, 8, 15, 16, 23, 42]
(Mean(xs), Median(xs), Max(xs), Variance(xs))
// ➔ (18, 31/2, 42, 182)
```

**Filter and reduce** with anonymous functions:

```cortex
let evens = Filter(Range(1, 10), n |-> n % 2 == 0)
Reduce(evens, (acc, n) |-> acc + n)
// ➔ 30
```

**Chained indexing** into a nested list — both index forms agree:

```cortex
let m = [[1, 2], [3, 4]]
(m[2][1], m[2, 1])
// ➔ (3, 3)
```

**Pipelines.** `x |> f` applies `f` to `x`:

```cortex
[4, 8, 15, 16, 23, 42] |> Mean
// ➔ 18
```

**Fold** threads an accumulator through a collection, starting from an
explicit initial value:

```cortex
Fold((acc, n) |-> acc + n^2, 0, Range(1, 5))
// ➔ 55
```

**Solve a linear system.** `LinearSolve(A, b)` solves `A·x = b`, exactly for
exact input. Here `2x + y = 5`, `x + 3y = 10`:

```cortex
let A = [[2, 1], [1, 3]]
let b = [5, 10]
LinearSolve(A, b)
// ➔ [1, 3]
```

**Solve a system of equations.** `Solve([eq1, eq2, …], [x, y, …])` returns
each solution as a tuple of values in the order of the variable list —
nonlinear systems may return several tuples:

```cortex
Solve([x^2 + y^2 == 25, x + y == 7], [x, y])
// ➔ [(3, 4), (4, 3)]
```

**Errors are values.** A type-incompatible element does not abort the
computation — it surfaces as `NaN` while the valid inputs still compute. Here
`Sqrt` is mapped over a list containing a string:

```cortex
let inputs = [16, -4, "banana", 81]
Map(inputs, x |-> Sqrt(x))
// ➔ [4, 2i, NaN, 9]
```

## Linear Algebra

**Eigenvalues.** A symmetric matrix has real eigenvalues; a rotation matrix
has complex ones:

```cortex
let A = [[2, 1], [1, 2]]
let B = [[0, -1], [1, 0]]
(Eigenvalues(A), Eigenvalues(B))
// ➔ ([3, 1], [i, -i])
```

**Vector products.** `Cross` is the 3-D cross product; `Dot` the inner
product:

```cortex
(Cross([1, 0, 0], [0, 1, 0]), Dot([1, 2, 3], [4, 5, 6]))
// ➔ ([0, 0, 1], 32)
```

## Dictionaries

A dictionary maps keys to values; index it with `d[key]`.

**A lookup table.** Decode the Roman numeral MCMXCIV, using a dictionary as a
symbol-value table and the subtractive rule:

```cortex
let value = {"I" -> 1, "V" -> 5, "X" -> 10, "L" -> 50, "C" -> 100, "D" -> 500, "M" -> 1000}
let s = ["M","C","M","X","C","I","V"]
let n = Length(s)
let total = 0
for i in Range(1, n) {
  let cur = value[s[i]]
  if i < n && cur < value[s[i + 1]] { total = total - cur } else { total = total + cur }
}
total
// ➔ 1994
```

**A frequency table.** `Tally` returns `(values, counts)`; `Zip` pairs them and
`DictionaryFrom` builds the dictionary. This is the idiomatic build-then-read
pattern (there is no in-place `d[k] = v` update):

```cortex
let words = ["red","blue","red","green","blue","red","blue"]
let t = Tally(words)
let freq = DictionaryFrom(Zip(t[1], t[2]))
(freq["red"], freq["blue"], freq["green"])
// ➔ (3, 3, 1)
```

**Enumerating a dictionary** with `Keys` and `Values`:

```cortex
let scores = {"alice" -> 90, "bob" -> 85, "carol" -> 95}
(Keys(scores), Max(Values(scores)))
// ➔ (["alice", "bob", "carol"], 95)
```

**A lookup in arithmetic.** A value read with `d[key]` is an ordinary number,
usable directly in an expression — here summing the values over the keys:

```cortex
let d = {"a" -> 1, "b" -> 2, "c" -> 3}
let s = 0
for k in Keys(d) { s = s + d[k] }
s
// ➔ 6
```

## Sets

`Intersection`, `Union` and set equality work on sets. Passing lists to
`Intersection` deduplicates and returns a `Set`. The common divisors of 48 and
36 are the intersection of their divisor lists (equivalently, the divisors of
gcd(48, 36) = 12):

```cortex
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36)
// ➔ Set(1, 2, 3, 4, 6, 12)
```

Set equality compares by membership, not by how the set was produced: a
computed set (an `Intersection` result, a filtered set…) equals a set literal
with the same elements.

```cortex
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36) == {1, 2, 3, 4, 6, 12}
// ➔ True
```
