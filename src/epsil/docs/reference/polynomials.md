---
title: Polynomials Reference
sidebar_label: Polynomials
slug: /epsil/reference/polynomials/
description: "The polynomials library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from polynomials.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Polynomials

The 19 definitions of the polynomials library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### algebraicGenerator

MathJSON `AlgebraicGenerator` · `(list<number>) -> number`

Deprecated: `AlgebraicGenerator(List(c₀, …, cₙ))` is `PolynomialRoot(c₀ + c₁t + … + cₙtⁿ, t)`, the abstract root of an irreducible polynomial with no complex embedding selected.

### apart

MathJSON `Apart` · `(value, symbol?) -> value`

Alias for PartialFraction. Decompose a rational expression into partial fractions.

### cancel

MathJSON `Cancel` · `(value, symbol?) -> value`

Cancel common polynomial factors in the numerator and denominator of a rational expression. Example: Cancel((x² - 1)/(x - 1), x) → x + 1

### coefficientList

MathJSON `CoefficientList` · `(value, symbol?) -> list<value>`

Return the list of coefficients of a polynomial, from highest to lowest degree. Example: CoefficientList(x³ + 2x + 1, x) → [1, 0, 2, 1]

### discriminant

MathJSON `Discriminant` · `(value, symbol?) -> value`

Return the discriminant of a polynomial. Example: Discriminant(x² - 5x + 6, x) → 1

### distribute

MathJSON `Distribute` · `(value) -> value`

Distribute multiplication over addition

### expand

MathJSON `Expand` · `(value) -> value`

Expand out products and positive integer powers

### expandAll

MathJSON `ExpandAll` · `(value) -> value`

Recursively expand out products and positive integer powers

### factor

MathJSON `Factor` · `(value, symbol?, value?) -> value`

Factor a polynomial expression into a product of irreducible factors. Uses exact modular factorization for univariate rational polynomials within its work limits, with structural methods for other expressions. Without a variable, a factor common to every term of a sum is taken out, a term that is not a polynomial (such as sin(t)) is treated as a variable, and like terms are collected. An optional third argument selects the generator of an exact number field. Example: Factor(x² + 5x + 6) → (x+2)(x+3), Factor(x² + 2x + 1) → (x+1)²

### partialFraction

MathJSON `PartialFraction` · `(value, symbol?) -> value`

Decompose a rational expression into partial fractions. Example: PartialFraction(1/((x+1)(x+2)), x) → 1/(x+1) - 1/(x+2)

### piecewiseExpand

MathJSON `PiecewiseExpand` · `(value) -> value`

`PiecewiseExpand(expr)` rewrites `Abs`, `Sign`, `Min`, `Max` and `Heaviside`, wherever they occur in `expr`, into a conditional value `Which(c1, v1, …, True, vd)`. `Abs` and `Sign` split only for an argument known to be real. Nested occurrences combine their conditions, and the assumptions set by `ce.assume()` decide what they can: with `x > 0` assumed, `Abs(x)` is `x`. An expression with none of these functions is returned unchanged.

```epsil
piecewiseExpand(max(x, y))
// ➔ Which(0 <= x - y, x, true, y)
```

```epsil
piecewiseExpand(heaviside(x) + max(x, 1))
// ➔ Which(0 <= x - 1 && x < 0, x, 0 <= x - 1 && 0 < x, x + 1, 0 <= x - 1, x + 1/2, x < 0, 1, 0 < x, 2, true, 3/2)
```

### polynomial

MathJSON `Polynomial` · `(list<value>, symbol) -> value`

Construct a polynomial from a list of coefficients (highest to lowest degree) and a variable. Example: Polynomial([1, 0, 2, 1], x) → x³ + 2x + 1

### polynomialDegree

MathJSON `PolynomialDegree` · `(value, symbol?) -> integer`

Return the degree of a polynomial with respect to a variable. Example: PolynomialDegree(x³ + 2x + 1, x) → 3

### polynomialGCD

MathJSON `PolynomialGCD` · `(a: value, b: value, variable: symbol?) -> value`

Return the greatest common divisor of two polynomials. Example: PolynomialGCD(x² - 1, x - 1, x) → x - 1

### polynomialQuotient

MathJSON `PolynomialQuotient` · `(dividend: value, divisor: value, variable: symbol?) -> value`

Return the quotient of polynomial division of dividend by divisor. Example: PolynomialQuotient(x³ - 1, x - 1, x) → x² + x + 1

### polynomialRemainder

MathJSON `PolynomialRemainder` · `(dividend: value, divisor: value, variable: symbol?) -> value`

Return the remainder of polynomial division of dividend by divisor. Example: PolynomialRemainder(x³ + 2x + 1, x + 1, x) → -2

### polynomialRoots

MathJSON `PolynomialRoots` · `(value, symbol?) -> set<value>`

Return the roots of a polynomial expression. Example: PolynomialRoots(x² - 5x + 6, x) → &#123;2, 3&#125;

### resultant

MathJSON `Resultant` · `(a: value, b: value, variable: symbol?) -> value`

Return the resultant of two polynomials with respect to a variable. It is zero iff the polynomials share a common factor. Example: Resultant(x² - 1, x - 1, x) → 0

### together

MathJSON `Together` · `(value) -> value`

Combine rational expressions into a single fraction
