---
title: Epsil Examples
sidebar_label: Examples
slug: /epsil/examples/
description: "Complete, executable Epsil programs — from simple iteration to symbolic computation — each one verified by the documentation test suite."
hide_title: true
date: Last Modified
---
# Examples

Complete Epsil programs, from simple iteration to symbolic computation.
Every example on this page is executable as written. The documentation test
executes each code fence directly through `executeEpsil`, while
`test/epsil/programs.test.ts` provides deeper assertions for representative
results and runtime behavior.

A few idioms these programs rely on:

- Loops (`for`, `while`) are evaluated **for effect** — accumulate into a
  variable (a number, or a list built up with `Join`/`Append`), or use
  `Map`/`Filter`/`Reduce` for value-producing iteration.
- `1..n` is the **inclusive** range from 1 to n, and `x |> f` pipes a value
  into a function — when the function takes several arguments, `_` marks the
  piped value's slot (`xs |> Map(_, f)`).
- `a if c else b` is the conditional expression — the same `If` as
  `if c { a } else { b }`, without the braces.
- Collection **literals** evaluate their elements; lazy **operators**
  (`Range`, `Map`, `Filter`) are generators that enumerate on demand (see
  [Evaluation](/epsil/evaluation/)).
- `a % b` is the remainder (`Mod`), and a postfix `!` is the factorial. The
  `!` must directly follow its operand (`n!`; `x != y` is still ≠).
- A tuple pattern binds several names at once — `let (q, r) = …` declares
  them, `(a, b) := …` writes ones that already exist. The right side is
  evaluated before anything is written, so `(a, b) := (b, a)` swaps. It must
  be spelled `:=` (see [declarations](/epsil/declarations/)).

## Iteration and Accumulation

**Sum of the multiples of 3 or 5 below 100.** A `for` loop over a range,
accumulating into a variable:

```epsil
let total = 0
for k in 1..99 {
  if k % 3 == 0 || k % 5 == 0 { total = total + k }
}
total
// ➔ 2318
```

**FizzBuzz, as a value.** `if`/`else` is an expression, so the whole program
is a single `Map` — no printing, no mutation:

```epsil
Map(1..15, k |->
  if k % 15 == 0 { "FizzBuzz" }
  else if k % 3 == 0 { "Fizz" }
  else if k % 5 == 0 { "Buzz" }
  else { k })
// ➔ [1, 2, "Fizz", 4, "Buzz", "Fizz", 7, 8, "Fizz", "Buzz", 11, "Fizz", 13, 14, "FizzBuzz"]
```

**Collatz stopping time.** A `while` loop whose body chooses the next value
with a conditional expression:

```epsil
let n = 27
let steps = 0
while n != 1 {
  n = n / 2 if n % 2 == 0 else 3n + 1
  steps = steps + 1
}
steps
// ➔ 111
```

**Euclid's algorithm.** The classic GCD. The loop step rewrites the pair at
once with a destructuring assignment, so no temporary is needed — the right
side is fully evaluated before either name is written:

```epsil
let a = 1071
let b = 462
while b != 0 {
  (a, b) := (b, a % b)
}
a
// ➔ 21
```

**Collecting values in a loop.** A list accumulates through `Join`; each
appended literal snapshots the loop variable's current value:

```epsil
let xs = []
for k in 1..3 { xs = Join(xs, [k]) }
xs
// ➔ [1, 2, 3]
```

**Iterative Fibonacci.** The same pair-carrying step — `(a, b) := (b, a + b)`
is the whole loop body:

```epsil
let a = 0
let b = 1
for k in 1..20 {
  (a, b) := (b, a + b)
}
a
// ➔ 6765
```

**A trial-division primality test.** A function with a typed parameter and a
block body, used to count the primes below 100:

```epsil
isPrime(n: integer) = if n < 2 { False } else {
  let d = 2
  let prime = True
  while d * d <= n {
    if n % d == 0 { prime = False; d = n } else { d = d + 1 }
  }
  prime
}
let count = 0
for k in 2..99 { if isPrime(k) { count = count + 1 } }
count
// ➔ 25
```

## Control Flow and Predicates

**Nested loops.** Each `while` owns its own block-scoped counter; the inner
loop re-runs in full for every pass of the outer one. Here Σ i·j over
1 ≤ i, j ≤ 3 is (1+2+3)² = 36:

```epsil
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

```epsil
let x = 4
let y = 5
(1 < x <= 4, 1 < y <= 4)
// ➔ (True, False)
```

**A truth table**, as a `Map` over the four boolean pairs:

```epsil
Map([(True, True), (True, False), (False, True), (False, False)],
    p |-> p[1] && p[2])
// ➔ [True, False, False, False]
```

## Integers and Number Theory

**Modular exponentiation.** `a^b % m` is computed exactly, then reduced. By
Fermat's little theorem 7¹² ≡ 1 (mod 13), and 222 = 18·12 + 6, so:

```epsil
(7^222) % 13
// ➔ 12
```

**gcd/lcm, factorization and divisors** of a number:

```epsil
(GCD(48, 36), LCM(48, 36), FactorInteger(360), Divisors(28))
// ➔ (12, 144, [(2, 3), (3, 2), (5, 1)], [1, 2, 4, 7, 14, 28])
```

**Returning several values.** A function returns a tuple, and a destructuring
declaration unpacks it into names in one statement:

```epsil
divmod(a: integer, b: integer) = (Floor(a / b), a % b)
let (q, r) = divmod(2026, 7)
(q, r)
// ➔ (289, 3)
```

**Arbitrary-precision integers.** The iterative Fibonacci, with the running
pair carried in a two-element list literal, stays exact all the way to F(200)
— far past the 2⁵³ limit of floating point:

```epsil
Fold((p, _) |-> [p[2], p[1] + p[2]], [0, 1], 1..200)[1]
// ➔ 280571172992510140037611932413038677189525
```

## Recursion

A recursive function refers to itself by name — a one-step definition just
works, because the name is declared before the body is processed. Definition
statements **accumulate**: repeating a name with a different parameter list
adds a *clause*, and a call dispatches to the most specific clause that
matches — so a base case is a literal-parameter clause rather than an `if`
(see [Multiple clauses](/epsil/control-flow/#multiple-clauses-literal-parameters)):

```epsil
fact(0) = 1
fact(n: integer) = n * fact(n - 1)
fact(10)
// ➔ 3628800
```

**Multi-clause Fibonacci**, with two base clauses:

```epsil
fib(0) = 0
fib(1) = 1
fib(n: integer) = fib(n - 1) + fib(n - 2)
Map(1..10, fib)
// ➔ [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
```

A single-clause spelling with a conditional is equivalent
(`fact(n) = 1 if n <= 1 else n * fact(n - 1)`), as is the two-step form —
declare with `let`, then assign a `|->` lambda. Note that *mutually*
recursive functions still require declaring all the names with `let` before
defining any of them.

## Higher-Order Functions

Functions are values: they can be passed as arguments and returned from other
functions. A `|->` lambda captures the variables in scope where it is created.

**A numeric-derivative factory.** `deriv` returns a lambda that closes over
both the function `f` and the step `h`. The central-difference estimate is
computed *exactly* (as a rational):

```epsil
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
dg(2)
// ➔ 12000001/1000000
```

Pipe the call into `N` for a floating-point value — numericization reaches
through the user-function/closure call:

```epsil
deriv(f, h) = x |-> (f(x + h) - f(x - h)) / (2h)
g(x) = x^3
let dg = deriv(g, 1/1000)
dg(2) |> N
// ➔ 12.000001
```

**Function composition.** `compose` returns `f ∘ g`; the two orders give
different results, confirming each lambda captures the right binding:

```epsil
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

```epsil
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

```epsil
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

```epsil
let x = 1
for k in 1..6 { x = (x + 2/x) / 2 }
N(x)
// ➔ 1.4142135623730950488
```

**Trapezoidal integration** of x² over [0, 1]:

```epsil
g(x) = x^2
let n = 100
let h = 1/n
let area = (g(0) + g(1)) / 2
for k in 1..n - 1 { area = area + g(k * h) }
N(area * h)
// ➔ 0.33335
```

**Monte Carlo estimate of π.** `Random()` returns a uniform value in [0, 1):

```epsil
let inside = 0
let total = 500
for k in 1..total {
  let px = Random()
  let py = Random()
  if px^2 + py^2 < 1 { inside = inside + 1 }
}
N(4 * inside / total)
// ➔ ≈ 3.14 (varies by run)
```

**Reproducible simulations.** `WithRandomSeed(seed, body)` evaluates `body`
with a seeded random frame. The block replays exactly, while repeated draws
*inside* it still differ (the n-th draw of a frame is `hash(seed, n)`). Frames
nest, and the innermost one wins. Outside any frame, draws are live:

```epsil
let a = WithRandomSeed(7, [Random(1..100), Random(1..100)])
let b = WithRandomSeed(7, [Random(1..100), Random(1..100)])
a == b
// ➔ True
```

## Calculus

The calculus operators work symbolically, keeping parameters exact.

**Integration.** The work to stretch an ideal spring (force `F = kx`) from 0 to
a displacement `d` is `∫₀ᵈ kx dx`:

```epsil
Integrate(k*x, (x, 0, d))
// ➔ 1/2 * k * d^2
```

A definite integral with numeric bounds evaluates exactly:

```epsil
Integrate(Sin(x), (x, 0, Pi))
// ➔ 2
```

**Limits.** The leading relative error of the small-angle approximation
`sin x ≈ x` is governed by a limit at 0:

```epsil
Limit((Sin(x) - x)/x^3, x, 0)
// ➔ -1/6
```

**Series.** The Maclaurin expansion of sine, with a `BigO` tail marking the
first dropped term:

```epsil
Series(Sin(x), x, 0)
// ➔ x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)
```

## Units and Measurements

Units and measured quantities enter through `$…$` LaTeX islands and carry
through the computation.

**Unit conversion.** Convert a posted 30 km/h speed limit to SI m/s:

```epsil
N(UnitConvert($30\,\mathrm{km/h}$, $\mathrm{m/s}$))
// ➔ 8.333333333333334 m/s
```

**Uncertainty propagation.** `Measurement(value, error)` carries an absolute
uncertainty that `*` propagates in quadrature. For a plot measured
L = 10 ± 0.1 m by W = 20 ± 0.2 m, the area error is
√(20²·0.1² + 10²·0.2²) = √8 ≈ 2.83:

```epsil
let L = Measurement(10, 0.1)
let W = Measurement(20, 0.2)
N(L * W)
// ➔ 200.0 ± 2.8
```

## Complex Numbers

The imaginary unit is `i`; complex arithmetic, `Conjugate` and `Abs` (the
modulus) all work:

```epsil
((2 + 3i) * (1 - i), Conjugate(2 + 3i), Abs(3 + 4i))
// ➔ ((5 + i), (2 - 3i), 5)
```

**Euler's formula stays exact.** `e^{iπ/3}` is assembled from the exact
cos(π/3) = 1/2 and sin(π/3) = √3/2, without ever numericizing:

```epsil
$e^{i\pi/3}$
// ➔ 1/2 + sqrt(3)/2i
```

**A product of complex numbers** taken over a mapped `Range` keeps its
imaginary part: (1+i)(2+i)(3+i) = 10i:

```epsil
Product(Map(Range(1, 3), k |-> k + i))
// ➔ 10i
```

## Exact and Symbolic Computation

These examples show what sets Epsil apart from a conventional language: the
values flowing through a program are Compute Engine expressions, so
arithmetic is exact and results can be symbolic.

**Exact rationals.** The 20th harmonic number, accumulated in a loop, stays
an exact rational — no floating-point drift:

```epsil
let h = 0
for k in 1..20 { h = h + 1/k }
h
// ➔ 55835135/15519504
```

**The Basel problem.** An exact partial sum compared against the limit
π²/6 — the difference is the tail of the series, ≈ 1/100:

```epsil
let s = Sum(1/k^2, (k, 1, 100))
N(Pi^2 / 6 - s)
// ➔ 0.00995016666333…
```

**Symbolic differentiation** of a user-defined function:

```epsil
f(x) = (x^2 + 1) / x
D(f(t), t)
// ➔ (t^2 - 1)/t^2
```

**Solve, then verify.** Solve a quadratic and substitute the roots back into
the polynomial:

```epsil
let roots = Solve(x^2 - 5x + 6 == 0, x)
Map(roots, r |-> r^2 - 5r + 6)
// ➔ [0, 0]
```

**A binomial coefficient**, with postfix factorials:

```epsil
10! / (3! * 7!)
// ➔ 120
```

**LaTeX islands.** A `$…$` span is parsed as LaTeX and spliced in as an
expression. Here, forty steps of the continued fraction 1 + 1/x against the
closed form of the golden ratio:

```epsil
let x = 2
for k in 1..40 { x = 1 + 1/x }
let phi = $\frac{1 + \sqrt{5}}{2}$
N(Abs(x - phi))
// ➔ ≈ 6.24e-18
```

**Trailing zeros of 100!, two ways.** Legendre's formula counts the factors of
5 in the factorial:

```epsil
let n = 100
let p = 5
let z = 0
while p <= n { z = z + Floor(n / p); p = p * 5 }
z
// ➔ 24
```

Cross-check by stripping factors of 10 off the *exact* 158-digit integer `100!`:

```epsil
let f = 100!
let count = 0
while f % 10 == 0 { f = f / 10; count = count + 1 }
count
// ➔ 24
```

**Roots of unity.** The five 5th-roots of unity are the vertices of a regular
pentagon on the unit circle; their vector sum is exactly zero:

```epsil
Sum(Exp(2*Pi*i*k/5), (k, 0, 4))
// ➔ 0
```

(`N(…)` of the same sum returns zero to floating-point roundoff, ≈ 1e-16.)

**An exact rational Fold.** Folding `1/k` over a range keeps the accumulator
an exact rational — the 10th harmonic number:

```epsil
Fold((a, k) |-> a + 1/k, 0, 1..10)
// ➔ 7381/2520
```

**Closed-form sums.** A telescoping sum and a finite geometric sum, both exact:

```epsil
($\sum_{k=1}^{100}(1/k - 1/(k+1))$, $\sum_{k=0}^{10}(1/2)^k$)
// ➔ (100/101, 2047/1024)
```

**Exact trigonometric values.** Constructible angles evaluate to exact
symbolic values, never floats:

```epsil
($\sin(\pi/3)$, $\arctan(1)$, $\arcsin(1/2)$, $\tan(\pi/4)$)
// ➔ (sqrt(3)/2, 1/4 * pi, 1/6 * pi, 1)
```

**Solving equations exactly.** `Solve` returns the exact solution set — for a
cubic, an absolute-value equation and an exponential equation:

```epsil
(Solve($x^3 - 6x^2 + 11x - 6 = 0$, x), Solve($|x-3| = 5$, x), Solve($2^x = 8$, x))
// ➔ ([1, 2, 3], [-2, 8], [3])
```

## Strings

**String interpolation.** A `\( … )` escape splices any expression's value
into a string:

```epsil
let x = 2^11 - 1
"\(x) has type \(Type(x))"
// ➔ "2047 has type integer"
```

**A formatted table.** `\t` and `\n` escapes in a string literal are real
control characters. Build a table of `n`, `n²`, `n³` — one interpolated row
per value, folded onto the header with `StringJoin` in a pipeline:

```epsil
let header = "n\tn^2\tn^3\n"
1..5 |> Map(_, n |-> "\(n)\t\(n^2)\t\(n^3)\n") |> Fold(StringJoin, header, _)
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

```epsil
let freq = "mississippi" |> Characters |> Tally
let d = DictionaryFrom(Zip(freq[1], freq[2]))
(d["m"], d["i"], d["s"], d["p"])
// ➔ (1, 4, 4, 2)
```

**Word counts.** `StringSplit` with no separator splits on runs of
whitespace (with a separator string, it splits on each occurrence):

```epsil
let words = StringSplit("the quick brown fox the lazy dog the")
(Length(words), Tally(words)[2])
// ➔ (8, [3, 1, 1, 1, 1, 1])
```

**A Caesar cipher.** A three-stage pipeline: `UnicodeScalars` turns a string
into its code points, `Map` shifts each, and `StringFrom(…, "unicode-scalars")`
rebuilds the string. Shifting back decodes, so the cipher round-trips:

```epsil
shift(s, k) = s |> UnicodeScalars |> Map(_, c |-> c + k) |> StringFrom(_, "unicode-scalars")
(shift("hello", 3), shift(shift("hello", 3), -3))
// ➔ ("khoor", "hello")
```

**Anagrams and palindromes.** Two words are anagrams when their sorted
characters agree; a word is a palindrome when its characters equal their
reverse:

```epsil
let anagram = Sort(Characters("listen")) == Sort(Characters("silent"))
let s = "racecar"
let palindrome = Characters(s) == Reverse(Characters(s))
(anagram, palindrome)
// ➔ (True, True)
```

## Collections

**Matrices.** Lists of lists are matrices; index with `m[i, j]` (chained
`m[i][j]` also works):

```epsil
let m = [[2, 1], [1, 3]]
let d = Determinant(m)
let t = Transpose(m)
(d, t[1, 2], t[2, 1])
// ➔ (5, 1, 1)
```

**Descriptive statistics**, exact:

```epsil
let xs = [4, 8, 15, 16, 23, 42]
(Mean(xs), Median(xs), Max(xs), Variance(xs))
// ➔ (18, 31/2, 42, 182)
```

**Filter and reduce** with anonymous functions, chained into a pipeline —
`_` is the piped value:

```epsil
1..10 |> Filter(_, n |-> n % 2 == 0) |> Reduce(_, (acc, n) |-> acc + n)
// ➔ 30
```

**Chained indexing** into a nested list — both index forms agree:

```epsil
let m = [[1, 2], [3, 4]]
(m[2][1], m[2, 1])
// ➔ (3, 3)
```

**Pipelines.** `x |> f` applies `f` to `x`:

```epsil
[4, 8, 15, 16, 23, 42] |> Mean
// ➔ 18
```

When a stage takes several arguments, `_` marks the slot the piped value
fills. The primes below 100, counted:

```epsil
1..100 |> Filter(_, IsPrime) |> Length
// ➔ 25
```

**Spread arguments.** In a call argument list, `...t` splices the elements of
the tuple `t` in as positional arguments; several spreads splice in order:

```epsil
dot(x1, y1, x2, y2) = x1*x2 + y1*y2
let p = (1, 2)
let q = (3, 4)
dot(...p, ...q)
// ➔ 11
```

**Fold** threads an accumulator through a collection, starting from an
explicit initial value:

```epsil
Fold((acc, n) |-> acc + n^2, 0, 1..5)
// ➔ 55
```

**Solve a linear system.** `LinearSolve(A, b)` solves `A·x = b`, exactly for
exact input. Here `2x + y = 5`, `x + 3y = 10`:

```epsil
let A = [[2, 1], [1, 3]]
let b = [5, 10]
LinearSolve(A, b)
// ➔ [1, 3]
```

**Solve a system of equations.** `Solve([eq1, eq2, …], [x, y, …])` returns
each solution as a tuple of values in the order of the variable list —
nonlinear systems may return several tuples:

```epsil
Solve([x^2 + y^2 == 25, x + y == 7], [x, y])
// ➔ [(3, 4), (4, 3)]
```

**Errors are values.** A type-incompatible element does not abort the
computation — it surfaces as `NaN` while the valid inputs still compute. Here
`Sqrt` is mapped over a list containing a string:

```epsil
let inputs = [16, -4, "banana", 81]
Map(inputs, x |-> Sqrt(x))
// ➔ [4, 2i, NaN, 9]
```

## Linear Algebra

**Eigenvalues.** A symmetric matrix has real eigenvalues; a rotation matrix
has complex ones:

```epsil
let A = [[2, 1], [1, 2]]
let B = [[0, -1], [1, 0]]
(Eigenvalues(A), Eigenvalues(B))
// ➔ ([3, 1], [i, -i])
```

**Vector products.** `Cross` is the 3-D cross product; `Dot` the inner
product:

```epsil
(Cross([1, 0, 0], [0, 1, 0]), Dot([1, 2, 3], [4, 5, 6]))
// ➔ ([0, 0, 1], 32)
```

## Dictionaries

A dictionary maps keys to values; index it with `d[key]`.

**A lookup table.** Decode the Roman numeral MCMXCIV, using a dictionary as a
symbol-value table and the subtractive rule:

```epsil
let value = {"I" -> 1, "V" -> 5, "X" -> 10, "L" -> 50, "C" -> 100, "D" -> 500, "M" -> 1000}
let s = ["M","C","M","X","C","I","V"]
let n = Length(s)
let total = 0
for i in 1..n {
  let cur = value[s[i]]
  total = total - cur if i < n && cur < value[s[i + 1]] else total + cur
}
total
// ➔ 1994
```

**A frequency table.** `Tally` returns `(values, counts)`; `Zip` pairs them and
`DictionaryFrom` builds the dictionary. This is the idiomatic build-then-read
pattern (there is no in-place `d[k] = v` update):

```epsil
let words = ["red","blue","red","green","blue","red","blue"]
let t = Tally(words)
let freq = DictionaryFrom(Zip(t[1], t[2]))
(freq["red"], freq["blue"], freq["green"])
// ➔ (3, 3, 1)
```

**Enumerating a dictionary** with `Keys` and `Values`:

```epsil
let scores = {"alice" -> 90, "bob" -> 85, "carol" -> 95}
(Keys(scores), Max(Values(scores)))
// ➔ (["alice", "bob", "carol"], 95)
```

**A lookup in arithmetic.** A value read with `d[key]` is an ordinary number,
usable directly in an expression — here summing the values over the keys:

```epsil
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

```epsil
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36)
// ➔ Set(1, 2, 3, 4, 6, 12)
```

Set equality compares by membership, not by how the set was produced: a
computed set (an `Intersection` result, a filtered set…) equals a set literal
with the same elements.

```epsil
let d48 = [1, 2, 3, 4, 6, 8, 12, 16, 24, 48]
let d36 = [1, 2, 3, 4, 6, 9, 12, 18, 36]
Intersection(d48, d36) == {1, 2, 3, 4, 6, 12}
// ➔ True
```
