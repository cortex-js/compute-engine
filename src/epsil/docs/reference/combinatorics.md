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

MathJSON `BellNumber` · `(integer) -> integer`

Compute the Bell number B(n), the number of partitions of a set of n elements.

### binomial

MathJSON `Binomial` · `(complex | infinity, complex | infinity) -> number`

Compute the binomial coefficient C(n, k) = n! / (k! (n-k)!). Agrees with Choose for all defined values.

### cartesianProduct

MathJSON `CartesianProduct` · `(set<any>+) -> set`

Return the Cartesian product of input sets.

### choose

MathJSON `Choose` · `(n: complex | infinity, m: complex | infinity) -> number`

Binomial coefficient: number of ways to choose k items from n. Agrees with Binomial for all defined values.

### combinations

MathJSON `Combinations` · `((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)`

Return all k-element combinations of a collection.

### fibonacci

MathJSON `Fibonacci` · `(integer) -> integer`

Compute the nth Fibonacci number.

### integerPartitions

MathJSON `IntegerPartitions` · `(integer, any?, list<integer>?, integer?) -> list<list<integer>>`

Return the partitions of n, each a list of its positive parts in non-increasing order, in reverse lexicographic order. The second operand limits the number of parts: `IntegerPartitions(n, k)` keeps those of at most k parts, a list `[k]` exactly k parts, and `[kmin, kmax]` or `[kmin, kmax, step]` a range of numbers of parts (kmax may be `Infinity`, and `All` is no limit). `IntegerPartitions(n, kspec, [s1, s2, ...])` draws the parts from the given positive integers, and a fourth operand m keeps the first m partitions. There is no partition of a negative n, and the only one of 0 is the empty list.

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

Compute the multinomial coefficient for multiple integers.

### permutations

MathJSON `Permutations` · `((S, integer?) -> list<string> where S: string) & ((collection, integer?) -> list<list>)`

Return all permutations of length k (default full length) of a collection.

### pochhammer

MathJSON `Pochhammer` · `(complex | infinity, complex | infinity) -> number`

Rising factorial (Pochhammer symbol) (a)_k = a(a+1)…(a+k-1).

### powerSet

MathJSON `PowerSet` · `(set<any>) -> set`

Return the power set of a set (set of all subsets).

### subfactorial

MathJSON `Subfactorial` · `(integer) -> integer`

Compute the number of derangements (subfactorial) of n items.
