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

The 11 definitions of the combinatorics library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

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
