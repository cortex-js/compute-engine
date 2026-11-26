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

- argument 1 — The rational coefficients of an irreducible polynomial, from the constant term to the leading coefficient; a reducible polynomial is an error. Sample: `[-2, 0, 1]`.

Deprecated: `AlgebraicGenerator(List(c₀, …, cₙ))` is `PolynomialRoot(c₀ + c₁t + … + cₙtⁿ, t)`, the abstract root of an irreducible polynomial with no complex embedding selected.

```epsil
algebraicGenerator([-2, 0, 1])
// ➔ PolynomialRoot(t^2 - 2, t)
```

### apart

MathJSON `Apart` · `(expr: value, variable: symbol?) -> value`

- `expr` — The rational expression. Sample: `1 / ((x + 1) * (x + 2))`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Alias for PartialFraction. Decompose a rational expression into partial fractions.

```epsil
apart((x + 3) / ((x + 1) * (x + 2)), x)
// ➔ -1 / (x + 2) + 2 / (x + 1)
```

### cancel

MathJSON `Cancel` · `(expr: value, variable: symbol?) -> value`

- `expr` — The rational expression. Sample: `(x^2 - 1) / (x - 1)`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Cancel common polynomial factors in the numerator and denominator of a rational expression.

```epsil
cancel((x^2 - 1) / (x - 1), x)
// ➔ x + 1
```

### coefficientList

MathJSON `CoefficientList` · `(polynomial: value, variable: symbol?) -> list<value>`

- `polynomial` — The polynomial. Sample: `x^3 + 2x + 1`.
- `variable` — The variable of the polynomial; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the list of coefficients of a polynomial, from highest to lowest degree. A missing power has the coefficient 0, and the other unknowns go into the coefficients.

```epsil
coefficientList(x^3 + 2x + 1, x)
// ➔ [1,0,2,1]
```

```epsil
coefficientList(x^2 * y + y, y)
// ➔ [x^2 + 1,0]
```

### discriminant

MathJSON `Discriminant` · `(polynomial: value, variable: symbol?) -> value`

- `polynomial` — The polynomial. Sample: `x^2 - 5x + 6`.
- `variable` — The variable of the polynomial; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the discriminant of a polynomial of degree 2, 3 or 4; another degree stays unevaluated.

```epsil
discriminant(x^2 - 5x + 6, x)
// ➔ 1
```

```epsil
discriminant(a * x^2 + b * x + c, x)
// ➔ b^2 - 4a * c
```

### distribute

MathJSON `Distribute` · `(value) -> value`

- argument 1 — The product to distribute. Sample: `x * (y + z)`.

Distribute multiplication over addition.

Powers of sums are not expanded: `expand` does that.

```epsil
distribute((a + b) * (c + d))
// ➔ a * c + b * c + a * d + b * d
```

### expand

MathJSON `Expand` · `(value) -> value`

- argument 1 — The expression to expand. Sample: `(x + 1)^2`.

Expand out products and positive integer powers.

The arguments of other functions are left as they are: `expandAll` expands them too.

```epsil
expand((x + 1) * (x - 2))
// ➔ x^2 - x - 2
```

```epsil
expand((a + b)^3)
// ➔ a^3 + b^3 + 3b * a^2 + 3a * b^2
```

### expandAll

MathJSON `ExpandAll` · `(value) -> value`

- argument 1 — The expression to expand. Sample: `sin((x + 1)^2)`.

Recursively expand out products and positive integer powers, including those in the arguments of other functions.

```epsil
expandAll(sin((x + 1)^2))
// ➔ sin(x^2 + 2x + 1)
```

### factor

MathJSON `Factor` · `(expr: value, variable: symbol?, generator: value?) -> value`

- `expr` — The expression to factor. Sample: `x^2 + 5x + 6`.
- `variable` — The variable of the polynomial; without it, the expression is factored in all its unknowns. Sample: `x`.
- `generator` — An algebraic number whose field the factors may use, such as `sqrt(2)` or `i`; it requires a variable, and without it the factors are over the rationals. Sample: `sqrt(2)`.

Factor a polynomial expression into a product of irreducible factors. Uses exact modular factorization for univariate rational polynomials within its work limits, with structural methods for other expressions. Without a variable, a factor common to every term of a sum is taken out, a term that is not a polynomial (such as sin(t)) is treated as a variable, and like terms are collected. An optional third argument selects the generator of an exact number field.

```epsil
factor(x^2 + 5x + 6)
// ➔ (x + 2) * (x + 3)
```

```epsil
factor(x^4 - 1, x)
// ➔ (x - 1) * (x + 1) * (x^2 + 1)
```

```epsil
factor(x^2 - 2, x, sqrt(2))
// ➔ (x - sqrt(2)) * (x + sqrt(2))
```

### partialFraction

MathJSON `PartialFraction` · `(expr: value, variable: symbol?) -> value`

- `expr` — The rational expression. Sample: `1 / ((x + 1) * (x + 2))`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Decompose a rational expression into partial fractions. A denominator that does not factor over the rationals stays as it is.

```epsil
partialFraction(1 / ((x + 1) * (x + 2)), x)
// ➔ -1 / (x + 2) + 1 / (x + 1)
```

```epsil
partialFraction((x^3 + 1) / (x^2 - 1), x)
// ➔ x + 1 / (x - 1)
```

### piecewiseExpand

MathJSON `PiecewiseExpand` · `(value) -> value`

- argument 1 — The expression whose absolute values, signs, minimums, maximums and Heaviside steps are rewritten. Sample: `max(x, 0)`.

`piecewiseExpand(expr)` rewrites `abs`, `sign`, `min`, `max` and `heaviside`, wherever they occur in `expr`, into a conditional value `Which(c1, v1, …, True, vd)`. `abs` and `sign` split only for an argument known to be real. Nested occurrences combine their conditions, and the assumptions set by `ce.assume()` decide what they can: with `x > 0` assumed, `abs(x)` is `x`. An expression with none of these functions is returned unchanged.

```epsil
piecewiseExpand(max(x, y))
// ➔ Which(0 <= x - y, x, true, y)
```

```epsil
piecewiseExpand(heaviside(x) + max(x, 1))
// ➔ Which(0 <= x - 1 && x < 0, x, 0 <= x - 1 && 0 < x, x + 1, 0 <= x - 1, x + 1/2, x < 0, 1, 0 < x, 2, true, 3/2)
```

### polynomial

MathJSON `Polynomial` · `(coefficients: list<value>, variable: symbol) -> value`

- `coefficients` — The coefficients, from the highest degree to the constant term; an empty list leaves the call unevaluated. Sample: `[1, 0, 2, 1]`.
- `variable` — The variable of the polynomial. Sample: `x`.

Construct a polynomial from a list of coefficients (highest to lowest degree) and a variable.

```epsil
polynomial([1, 0, 2, 1], x)
// ➔ x^3 + 2x + 1
```

```epsil
polynomial([a, b, c], t)
// ➔ a * t^2 + b * t + c
```

### polynomialDegree

MathJSON `PolynomialDegree` · `(polynomial: value, variable: symbol?) -> integer`

- `polynomial` — The polynomial. Sample: `x^3 + 2x + 1`.
- `variable` — The variable of the polynomial; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the degree of a polynomial with respect to a variable. A constant, `0` included, has degree 0; an expression that is not a polynomial in the variable stays unevaluated.

```epsil
polynomialDegree(x^3 + 2x + 1, x)
// ➔ 3
```

```epsil
polynomialDegree(x^2 * y^3, y)
// ➔ 3
```

### polynomialGCD

MathJSON `PolynomialGCD` · `(a: value, b: value, variable: symbol?) -> value`

- `a` — The first polynomial. Sample: `x^2 - 1`.
- `b` — The second polynomial. Sample: `x^2 + 2x + 1`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the greatest common divisor of two polynomials, with leading coefficient 1.

```epsil
polynomialGCD(x^2 - 1, x^2 + 2x + 1, x)
// ➔ x + 1
```

### polynomialQuotient

MathJSON `PolynomialQuotient` · `(dividend: value, divisor: value, variable: symbol?) -> value`

- `dividend` — The polynomial to divide. Sample: `x^3 - 1`.
- `divisor` — The polynomial to divide by; a zero divisor leaves the call unevaluated. Sample: `x - 1`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the quotient of polynomial division of dividend by divisor.

```epsil
polynomialQuotient(x^3 - 1, x - 1, x)
// ➔ x^2 + x + 1
```

### polynomialRemainder

MathJSON `PolynomialRemainder` · `(dividend: value, divisor: value, variable: symbol?) -> value`

- `dividend` — The polynomial to divide. Sample: `x^3 + 2x + 1`.
- `divisor` — The polynomial to divide by; a zero divisor leaves the call unevaluated. Sample: `x + 1`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the remainder of polynomial division of dividend by divisor.

```epsil
polynomialRemainder(x^3 + 2x + 1, x + 1, x)
// ➔ -2
```

### polynomialRoots

MathJSON `PolynomialRoots` · `(polynomial: value, variable: symbol?) -> set<value>`

- `polynomial` — The polynomial. Sample: `x^2 - 5x + 6`.
- `variable` — The variable of the polynomial; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the set of the roots of a polynomial expression. A repeated root appears once, a root with no exact form found is a numeric approximation, and a polynomial with no root stays unevaluated.

```epsil
polynomialRoots(x^2 - 5x + 6, x)
// ➔ Set(2, 3)
```

```epsil
polynomialRoots(x^2 + 1, x)
// ➔ Set(-i, i)
```

### resultant

MathJSON `Resultant` · `(a: value, b: value, variable: symbol?) -> value`

- `a` — The first polynomial. Sample: `x^2 - 1`.
- `b` — The second polynomial. Sample: `x - 2`.
- `variable` — The variable of the polynomials; without it, the variable is the only unknown, or `x` among several. Sample: `x`.

Return the resultant of two polynomials with respect to a variable. It is zero iff the polynomials share a common factor.

```epsil
resultant(x^2 - 1, x - 1, x)
// ➔ 0
```

```epsil
resultant(x^2 + y, x - y, x)
// ➔ y^2 + y
```

### together

MathJSON `Together` · `(value) -> value`

- argument 1 — The sum of fractions to combine. Sample: `1 / x + 1 / y`.

Combine rational expressions into a single fraction over a common denominator.

```epsil
together(1 / x + 1 / (x + 1))
// ➔ (2x + 1) / (x * (x + 1))
```
