---
title: Combinatorics Reference
sidebar_label: Combinatorics
slug: /epsil/reference/combinatorics/
description: "The combinatorics library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from combinatorics.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Combinatorics

The 12 definitions of the combinatorics library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### bellNumber

MathJSON `BellNumber` · `(n: integer, x: number?) -> number`

- `n` — The number of elements of the set; `BellNumber(0)` is 1, and a negative integer stays unevaluated. Sample: `5`.
- `x` — The variable of the Bell polynomial; without it the result is the Bell number. Sample: `2`.

Compute the Bell number B(n), the number of partitions of a set of n elements. With a second operand, `bellNumber(n, x)` is the Bell (Touchard) polynomial `B_n(x)`, with `B_n(1) = bellNumber(n)`.

```epsil
bellNumber(5)
// ➔ 52
```

```epsil
bellNumber(3, x)
// ➔ x^3 + 3x^2 + x
```

### binomial

MathJSON `Binomial` · `(n: complex | infinity, k: complex | infinity) -> number`

- `n` — The size of the pool; a negative or non-integer value extends the coefficient through the Gamma function. Sample: `10`.
- `k` — The number of items chosen; with a non-negative integer `n`, the result is 0 for a negative integer or an integer greater than `n`. Sample: `3`.

Compute the binomial coefficient C(n, k) = n! / (k! (n-k)!). Agrees with Choose for all defined values.

```epsil
binomial(10, 3)
// ➔ 120
```

```epsil
binomial(n, 2)
// ➔ (n * (n - 1)) / 2
```

### cartesianProduct

MathJSON `CartesianProduct` · `(set<any>+) -> set`

- arguments 1, … — A factor of the product; each element of the result is a tuple with one component from each factor. Sample: `{1, 2}`.

Return the Cartesian product of input sets.

```epsil
count(cartesianProduct({1, 2}, {"a", "b", "c"}))
// ➔ 6
```

### choose

MathJSON `Choose` · `(n: complex | infinity, m: complex | infinity) -> number`

- `n` — The size of the pool; a negative or non-integer value extends the coefficient through the Gamma function. Sample: `5`.
- `m` — The number of items chosen; with a non-negative integer `n`, the result is 0 for a negative integer or an integer greater than `n`. Sample: `2`.

Binomial coefficient: number of ways to choose k items from n. Agrees with Binomial for all defined values.

```epsil
choose(5, 2)
// ➔ 10
```

```epsil
choose(-3, 2)
// ➔ 6
```

### combinations

MathJSON `Combinations` · `((xs: S, k: integer) -> list<string> where S: string) & ((xs: collection, k: integer) -> list<list>)`

- `xs` — The collection to choose from, in its order; the elements of a string are its characters, and each combination is a string. Sample: `[1, 2, 3, 4]`.
- `k` — The number of elements of each combination; 0 gives one empty combination, and a number past the size of the collection none. Sample: `2`.

Return all k-element combinations of a collection.

```epsil
combinations([1, 2, 3, 4], 2)
// ➔ [[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]]
```

```epsil
combinations("abc", 2)
// ➔ ["ab","ac","bc"]
```

### fibonacci

MathJSON `Fibonacci` · `(n: integer, x: number?) -> number`

- `n` — The index; `Fibonacci(0)` is 0, and a negative index follows `F_{-n} = (-1)^{n+1} F_n`. Sample: `10`.
- `x` — The variable of the Fibonacci polynomial; without it the result is the Fibonacci number. Sample: `2`.

Compute the nth Fibonacci number. With a second operand, `fibonacci(n, x)` is the Fibonacci polynomial `F_n(x)`, with `F_n(1) = fibonacci(n)`.

```epsil
fibonacci(10)
// ➔ 55
```

```epsil
fibonacci(5, x)
// ➔ x^4 + 3x^2 + 1
```

### integerPartitions

MathJSON `IntegerPartitions` · `(n: integer, k: any?, parts: list<integer>?, count: integer?) -> list<list<integer>>`

- `n` — The integer to partition; a negative one has no partition, and 0 has one, the empty list. Sample: `4`.
- `k` — The number of parts: `k` keeps the partitions of at most k parts, `[k]` exactly k, `[kmin, kmax]` or `[kmin, kmax, step]` a range, and `All` sets no limit. Sample: `2`.
- `parts` — The positive integers that the parts are drawn from. Sample: `[1, 5, 10]`.
- `count` — The number of partitions kept, the first ones. Sample: `3`.

Return the partitions of n, each a list of its positive parts in non-increasing order, in reverse lexicographic order. The second operand limits the number of parts: `integerPartitions(n, k)` keeps those of at most k parts, a list `[k]` exactly k parts, and `[kmin, kmax]` or `[kmin, kmax, step]` a range of numbers of parts (kmax may be `Infinity`, and `all` is no limit). `IntegerPartitions(n, kspec, [s1, s2, ...])` draws the parts from the given positive integers, and a fourth operand m keeps the first m partitions. There is no partition of a negative n, and the only one of 0 is the empty list.

```epsil
integerPartitions(4)
// ➔ [[4],[3,1],[2,2],[2,1,1],[1,1,1,1]]
```

```epsil
integerPartitions(8, [3])
// ➔ [[6,1,1],[5,2,1],[4,3,1],[4,2,2],[3,3,2]]
```

```epsil
count(integerPartitions(100, 100, [1, 5, 10, 25, 50]))
// ➔ 292
```

### multinomial

MathJSON `Multinomial` · `(integer+) -> integer`

- arguments 1, … — The size of one group; the result is `(k1 + k2 + ...)! / (k1! k2! ...)`, and it stays unevaluated when a size is negative. Sample: `2`.

Compute the multinomial coefficient for multiple integers.

```epsil
multinomial(2, 1, 1)
// ➔ 12
```

### permutations

MathJSON `Permutations` · `((xs: S, k: integer?) -> list<string> where S: string) & ((n: integer<0..>, k: integer?) -> list<list<integer>>) & ((xs: collection, k: integer?) -> list<list>)`

- `xs` — The collection to arrange; the elements of a string are its characters, and each arrangement is a string. Sample: `[1, 2, 3]`.
- `k` — The length of each arrangement, the whole length by default; 0 gives one empty arrangement, and a length past the size of the collection none. Sample: `2`.
- `n` — A non-negative integer that stands for the collection `Range(1, n)`. Sample: `3`.

Return all permutations of length k (default full length) of a collection. `permutations(n)` for a non-negative integer n is the permutations of `Range(1, n)`, as lists, and `permutations(n, k)` its arrangements of length k.

```epsil
permutations([1, 2, 3])
// ➔ [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]
```

```epsil
permutations(3, 2)
// ➔ [[1,2],[1,3],[2,1],[2,3],[3,1],[3,2]]
```

### pochhammer

MathJSON `Pochhammer` · `(x: complex | infinity, n: complex | infinity) -> number`

- `x` — The first factor of the product. Sample: `3`.
- `n` — The number of factors; 0 gives 1, and a negative or non-integer value extends the product through the Gamma function. Sample: `4`.

Rising factorial (Pochhammer symbol) (x)_n = x(x+1)…(x+n-1).

```epsil
pochhammer(3, 4)
// ➔ 360
```

```epsil
pochhammer(x, 3)
// ➔ x * (x + 1) * (x + 2)
```

### powerSet

MathJSON `PowerSet` · `(set<any>) -> set`

- argument 1 — The set whose subsets are listed; the power set of the empty set holds the empty set alone. Sample: `{1, 2, 3}`.

Return the power set of a set (set of all subsets).

```epsil
count(powerSet({1, 2, 3}))
// ➔ 8
```

### subfactorial

MathJSON `Subfactorial` · `(integer) -> integer`

- argument 1 — The number of items; `Subfactorial(0)` is 1, and a negative integer stays unevaluated. Sample: `4`.

Compute the number of derangements (subfactorial) of n items.

```epsil
subfactorial(4)
// ➔ 9
```
