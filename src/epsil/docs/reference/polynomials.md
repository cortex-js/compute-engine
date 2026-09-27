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

The 17 definitions of the polynomials library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

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

MathJSON `Factor` · `(value, symbol?) -> value`

Factor a polynomial expression into a product of irreducible factors. Supports perfect square trinomials, difference of squares, and quadratic factoring with rational roots. Example: Factor(x² + 5x + 6) → (x+2)(x+3), Factor(x² + 2x + 1) → (x+1)²

### partialFraction

MathJSON `PartialFraction` · `(value, symbol?) -> value`

Decompose a rational expression into partial fractions. Example: PartialFraction(1/((x+1)(x+2)), x) → 1/(x+1) - 1/(x+2)

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
