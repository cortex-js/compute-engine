---
title: Cortex Examples
permalink: /cortex/examples/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Examples

Complete Cortex programs, from simple iteration to symbolic computation.
Every example on this page is executable as written: each one is verified by
`test/cortex/programs.test.ts`, which runs it through `executeCortex` and
asserts the result shown here.

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
// ➔ 6.2e-18
```

## Strings

**String interpolation.** A `\( … )` escape splices any expression's value
into a string:

```cortex
let x = 2^11 - 1
"\(x) has type \(Type(x))"
// ➔ "2047 has type integer"
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
