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

- argument 1 — The proposition; one that is neither `True` nor `False` leaves the result unevaluated. Sample: `x > 0`.

Return 1 if the argument is true, 0 otherwise. Also known as the Iverson bracket

```epsil
boole(3 > 2)
// ➔ 1
```

```epsil
boole([True, False, True])
// ➔ [1,0,1]
```

### equivalent

MathJSON `Equivalent` · `(boolean, boolean) -> boolean`

- argument 1 — The first proposition. Sample: `x > 0`.
- argument 2 — The second proposition. Sample: `x >= 1`.

Logical equivalence (if and only if): true when both operands have the same truth value.

```epsil
equivalent(True, False)
// ➔ false
```

```epsil
equivalent(p, p)
// ➔ true
```

### exists

MathJSON `Exists` · `(value, boolean) -> boolean`

- argument 1 — The bound variable, or an `Element` clause that gives it a domain; over a finite domain the quantifier tests each value, otherwise it stays unevaluated unless the predicate decides it. Sample: `x in [1, 2, 3]`.
- argument 2 — The predicate on the bound variable. Sample: `x > 0`.

Existential quantifier (there exists): true when the predicate holds for at least one value.

```epsil
exists(Element(x, [1, 2, 3]), x > 2)
// ➔ true
```

### existsUnique

MathJSON `ExistsUnique` · `(value, boolean) -> boolean`

- argument 1 — The bound variable, or an `Element` clause that gives it a domain; over a finite domain the quantifier tests each value, otherwise it stays unevaluated unless the predicate decides it. Sample: `x in [1, 2, 3]`.
- argument 2 — The predicate on the bound variable. Sample: `x > 0`.

Unique existential quantifier (there exists exactly one value satisfying the predicate).

```epsil
existsUnique(Element(x, [1, 2, 3]), x > 2)
// ➔ true
```

```epsil
existsUnique(Element(x, [1, 2, 3]), x > 1)
// ➔ false
```

### False

constant `boolean`

The boolean truth value false.

### forAll

MathJSON `ForAll` · `(value, boolean) -> boolean`

- argument 1 — The bound variable, or an `Element` clause that gives it a domain; over a finite domain the quantifier tests each value, otherwise it stays unevaluated unless the predicate decides it. Sample: `x in [1, 2, 3]`.
- argument 2 — The predicate on the bound variable. Sample: `x > 0`.

Universal quantifier (for all): true when the predicate holds for every value.

```epsil
forAll(Element(x, [1, 2, 3]), x > 0)
// ➔ true
```

```epsil
forAll(Element(n, Range(1, 10)), n^2 >= n)
// ➔ true
```

### implies

MathJSON `Implies` · `(antecedent: boolean, consequent: boolean) -> boolean`

- `antecedent` — The condition; when it is `False`, the result is `True` and the consequent is not evaluated. Sample: `x > 1`.
- `consequent` — The proposition that must hold when the antecedent does. Sample: `x > 0`.

Logical implication: false only when the antecedent is true and the consequent is false. Short-circuits: a `False` antecedent decides (`True`) without evaluating the consequent.

```epsil
implies(True, False)
// ➔ false
```

```epsil
implies(False, x)
// ➔ true
```

### isSatisfiable

MathJSON `IsSatisfiable` · `(boolean) -> boolean`

- argument 1 — The boolean expression; with more than 20 variables the result stays unevaluated. Sample: `p && !q`.

Return `True` when some assignment of truth values to the variables of a boolean expression makes it true, `False` otherwise.

The search tries every assignment: O(2^n) for n variables, at most 20 variables.

```epsil
isSatisfiable(And(p, Not(p)))
// ➔ false
```

```epsil
isSatisfiable(And(p, Or(q, Not(p))))
// ➔ true
```

### isTautology

MathJSON `IsTautology` · `(boolean) -> boolean`

- argument 1 — The boolean expression; with more than 20 variables the result stays unevaluated. Sample: `p || !p`.

Return `True` when a boolean expression is true for every assignment of truth values to its variables, `False` otherwise.

The search tries every assignment: O(2^n) for n variables, at most 20 variables.

```epsil
isTautology(Or(p, Not(p)))
// ➔ true
```

```epsil
isTautology(Or(p, q))
// ➔ false
```

### kroneckerDelta

MathJSON `KroneckerDelta` · `(value+) -> integer`

- arguments 1, … — A value compared with the others; the result stays unevaluated when the difference of two values is not a constant. Sample: `2`.

Return 1 if the arguments are equal, 0 otherwise. With a single argument n, this is δ_&#123;n,0&#125;: 1 if n = 0, 0 otherwise.

```epsil
kroneckerDelta(2, 2)
// ➔ 1
```

```epsil
kroneckerDelta(2, 3)
// ➔ 0
```

### minimalCNF

MathJSON `MinimalCNF` · `(boolean) -> boolean`

- argument 1 — The boolean expression to minimize; with more than 12 variables the result stays unevaluated. Sample: `(a || b) && (a || !b)`.

Return a conjunctive normal form (CNF) of a boolean expression built from its prime implicates: an AND of ORs, usually with few clauses.

Uses the Quine-McCluskey algorithm, at most 12 variables.

```epsil
minimalCNF(And(Or(a, b), Or(a, Not(b))))
// ➔ a
```

### minimalDNF

MathJSON `MinimalDNF` · `(boolean) -> boolean`

- argument 1 — The boolean expression to minimize; with more than 12 variables the result stays unevaluated. Sample: `(a && b) || (a && !b) || (!a && b)`.

Return a disjunctive normal form (DNF) of a boolean expression built from its prime implicants: an OR of ANDs, usually with few terms.

Uses the Quine-McCluskey algorithm, at most 12 variables.

```epsil
minimalDNF(Or(And(a, b), And(a, Not(b)), And(Not(a), b)))
// ➔ b || a
```

### nand

MathJSON `Nand` · `(boolean+) -> boolean`

- arguments 1, … — A proposition; the operands after the first one that is `False` are not evaluated. Sample: `x > 0`.

Logical NAND: the negation of AND (n-ary). Short-circuits: operands are evaluated left to right and evaluation stops at the first `False`.

```epsil
nand(True, True)
// ➔ false
```

```epsil
nand(True, False)
// ➔ true
```

### nor

MathJSON `Nor` · `(boolean+) -> boolean`

- arguments 1, … — A proposition; the operands after the first one that is `True` are not evaluated. Sample: `x > 0`.

Logical NOR: the negation of OR (n-ary). Short-circuits: operands are evaluated left to right and evaluation stops at the first `True`.

```epsil
nor(False, False)
// ➔ true
```

```epsil
nor(False, True)
// ➔ false
```

### Not

`(boolean) -> boolean`

Logical negation (NOT).

### notExists

MathJSON `NotExists` · `(value, boolean) -> boolean`

- argument 1 — The bound variable, or an `Element` clause that gives it a domain; over a finite domain the quantifier tests each value, otherwise it stays unevaluated unless the predicate decides it. Sample: `x in [1, 2, 3]`.
- argument 2 — The predicate on the bound variable. Sample: `x > 0`.

Negated existential quantifier (there does not exist): true when the predicate holds for no value.

```epsil
notExists(Element(x, [1, 2, 3]), x > 5)
// ➔ true
```

### notForAll

MathJSON `NotForAll` · `(value, boolean) -> boolean`

- argument 1 — The bound variable, or an `Element` clause that gives it a domain; over a finite domain the quantifier tests each value, otherwise it stays unevaluated unless the predicate decides it. Sample: `x in [1, 2, 3]`.
- argument 2 — The predicate on the bound variable. Sample: `x > 0`.

Negated universal quantifier (not for all): true when the predicate fails for at least one value.

```epsil
notForAll(Element(x, [1, 2, 3]), x > 1)
// ➔ true
```

### Or

`(boolean+) -> boolean`

Logical disjunction (OR): true when at least one operand is true. Short-circuits: operands are evaluated left to right and evaluation stops at the first `True`.

### Predicate

`(symbol, value+) -> boolean`

Apply a predicate to arguments, returning a boolean

### primeImplicants

MathJSON `PrimeImplicants` · `(boolean) -> list`

- argument 1 — The boolean expression; with more than 12 variables the result stays unevaluated. Sample: `(a && b) || (a && !b)`.

Return the list of the prime implicants of a boolean expression: the minimal conjunctions of literals that imply it.

Uses the Quine-McCluskey algorithm, at most 12 variables.

```epsil
primeImplicants(Or(And(a, b), And(Not(a), c), And(b, c)))
// ➔ [!a && c,b && c,a && b]
```

### primeImplicates

MathJSON `PrimeImplicates` · `(boolean) -> list`

- argument 1 — The boolean expression; with more than 12 variables the result stays unevaluated. Sample: `a && b`.

Return the list of the prime implicates of a boolean expression: the minimal disjunctions of literals that it implies.

Uses the Quine-McCluskey algorithm, at most 12 variables.

```epsil
primeImplicates(And(Or(a, b), Or(Not(a), c)))
// ➔ [a || b,b || c,!a || c]
```

### toCNF

MathJSON `ToCNF` · `(boolean) -> boolean`

- argument 1 — The boolean expression to convert. Sample: `(a && b) || c`.

Convert a boolean expression to conjunctive normal form (CNF), an AND of ORs.

```epsil
toCNF(Or(And(a, b), c))
// ➔ (a || c) && (b || c)
```

```epsil
toCNF(implies(p, q))
// ➔ !p || q
```

### toDNF

MathJSON `ToDNF` · `(boolean) -> boolean`

- argument 1 — The boolean expression to convert. Sample: `(a || b) && c`.

Convert a boolean expression to disjunctive normal form (DNF), an OR of ANDs.

```epsil
toDNF(And(Or(a, b), c))
// ➔ a && c || b && c
```

### True

constant `boolean`

The boolean truth value true.

### truthTable

MathJSON `TruthTable` · `(boolean) -> list`

- argument 1 — The boolean expression; with more than 10 variables the result stays unevaluated. Sample: `p && q`.

Return the truth table of a boolean expression, as a list of rows.

The first row holds the names of the variables and `"Result"`; each other row holds one assignment of truth values and the value of the expression.

O(2^n) rows for n variables, at most 10 variables.

```epsil
truthTable(And(p, q))
// ➔ [["p","q","Result"],[false,false,false],[false,true,false],[true,false,false],[true,true,true]]
```

### xor

MathJSON `Xor` · `(boolean+) -> boolean`

- arguments 1, … — A proposition; an absent operand reads as `False`. Sample: `x > 0`.

Exclusive or: true when an odd number of operands are true

```epsil
xor(True, False)
// ➔ true
```

```epsil
xor(True, False, True)
// ➔ false
```
