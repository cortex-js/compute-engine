---
title: Logic Reference
sidebar_label: Logic
slug: /epsil/reference/logic/
description: "The logic library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from logic.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Logic

The 27 definitions of the logic library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### And

`(boolean+) -> boolean`

Logical conjunction (AND): true when all operands are true. Short-circuits: operands are evaluated left to right and evaluation stops at the first `False`.

### boole

MathJSON `Boole` · `(boolean) -> integer`

Return 1 if the argument is true, 0 otherwise. Also known as the Iverson bracket

### equivalent

MathJSON `Equivalent` · `(boolean, boolean) -> boolean`

Logical equivalence (if and only if): true when both operands have the same truth value.

### exists

MathJSON `Exists` · `(value, boolean) -> boolean`

Existential quantifier (there exists): true when the predicate holds for at least one value.

### existsUnique

MathJSON `ExistsUnique` · `(value, boolean) -> boolean`

Unique existential quantifier (there exists exactly one value satisfying the predicate).

### False

constant `boolean`

The boolean truth value false.

### forAll

MathJSON `ForAll` · `(value, boolean) -> boolean`

Universal quantifier (for all): true when the predicate holds for every value.

### implies

MathJSON `Implies` · `(boolean, boolean) -> boolean`

Logical implication: false only when the antecedent is true and the consequent is false. Short-circuits: a `False` antecedent decides (`True`) without evaluating the consequent.

### isSatisfiable

MathJSON `IsSatisfiable` · `(boolean) -> boolean`

Check satisfiability using brute-force enumeration. O(2^n) complexity, max 20 variables.

### isTautology

MathJSON `IsTautology` · `(boolean) -> boolean`

Check if expression is a tautology using brute-force enumeration. O(2^n) complexity, max 20 variables.

### kroneckerDelta

MathJSON `KroneckerDelta` · `(value+) -> integer`

Return 1 if the arguments are equal, 0 otherwise. With a single argument n, this is δ_&#123;n,0&#125;: 1 if n = 0, 0 otherwise.

### minimalCNF

MathJSON `MinimalCNF` · `(boolean) -> boolean`

Convert to minimal CNF using Quine-McCluskey. Max 12 variables.

### minimalDNF

MathJSON `MinimalDNF` · `(boolean) -> boolean`

Convert to minimal DNF using Quine-McCluskey. Max 12 variables.

### nand

MathJSON `Nand` · `(boolean+) -> boolean`

Logical NAND: the negation of AND (n-ary). Short-circuits: operands are evaluated left to right and evaluation stops at the first `False`.

### nor

MathJSON `Nor` · `(boolean+) -> boolean`

Logical NOR: the negation of OR (n-ary). Short-circuits: operands are evaluated left to right and evaluation stops at the first `True`.

### Not

`(boolean) -> boolean`

Logical negation (NOT).

### notExists

MathJSON `NotExists` · `(value, boolean) -> boolean`

Negated existential quantifier (there does not exist): true when the predicate holds for no value.

### notForAll

MathJSON `NotForAll` · `(value, boolean) -> boolean`

Negated universal quantifier (not for all): true when the predicate fails for at least one value.

### Or

`(boolean+) -> boolean`

Logical disjunction (OR): true when at least one operand is true. Short-circuits: operands are evaluated left to right and evaluation stops at the first `True`.

### Predicate

`(symbol, value+) -> boolean`

Apply a predicate to arguments, returning a boolean

### primeImplicants

MathJSON `PrimeImplicants` · `(boolean) -> list`

Find all prime implicants using Quine-McCluskey. Max 12 variables.

### primeImplicates

MathJSON `PrimeImplicates` · `(boolean) -> list`

Find all prime implicates using Quine-McCluskey. Max 12 variables.

### toCNF

MathJSON `ToCNF` · `(boolean) -> boolean`

Convert a boolean expression to conjunctive normal form (CNF), an AND of ORs.

### toDNF

MathJSON `ToDNF` · `(boolean) -> boolean`

Convert a boolean expression to disjunctive normal form (DNF), an OR of ANDs.

### True

constant `boolean`

The boolean truth value true.

### truthTable

MathJSON `TruthTable` · `(boolean) -> list`

Generate truth table for expression. O(2^n) complexity, max 10 variables.

### xor

MathJSON `Xor` · `(boolean+) -> boolean`

Exclusive or: true when an odd number of operands are true
