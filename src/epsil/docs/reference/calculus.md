---
title: Calculus Reference
sidebar_label: Calculus
slug: /epsil/reference/calculus/
description: "The calculus library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from calculus.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Calculus

The 24 definitions of the calculus library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### bigO

MathJSON `BigO` · `(value) -> number`

- argument 1 — The order of the remainder, usually a power of the variable. Sample: `x^3`.

Landau big-O remainder term. Inert; a numeric approximation (.N()) keeps the term and approximates its operand. Strip it with Normal.

```epsil
N(x / 3 + bigO(x^2))
// ➔ 0.333333333333333333333 * x + BigO(x^2)
```

```epsil
normal(1 + x + bigO(x^2))
// ➔ x + 1
```

### circleContour

MathJSON `CircleContour` · `(center: complex, radius: real, orientation: integer?) -> expression`

- `center` — The center of the circle. Sample: `0`.
- `radius` — The radius of the circle; a radius that is not positive leaves the integral unevaluated. Sample: `1`.
- `orientation` — 1 for counterclockwise, -1 for clockwise; by default, 1. Sample: `-1`.

Closed circle: center, positive radius, optional orientation (+1 or -1).

```epsil
contourIntegrate(1/z, z, circleContour(0, 1))
// ➔ 2i * pi
```

```epsil
contourIntegrate(1/z, z, circleContour(0, 1, -1))
// ➔ -2i * pi
```

### circularIntegrate

MathJSON `CircularIntegrate` · `(function, limits+) -> number`

- argument 1 — The integrand. Sample: `z => 1 / z`.
- arguments 2, … — The variable and the contour, as `(z, contour, Nothing)`; other limits leave the integral unevaluated.

Closed-path integral. Evaluates supported explicit contours by the residue theorem.

```epsil
circularIntegrate(1/z, (z, circleContour(0, 1), nothing))
// ➔ 2i * pi
```

### contourIntegrate

MathJSON `ContourIntegrate` · `(expression, variable: symbol, contour: expression) -> number`

- argument 1 — The integrand. Sample: `1 / z`.
- `variable` — The variable of integration. Sample: `z`.
- `contour` — The path: `CircleContour`, `RectangleContour`, `PolygonContour` or `RealLineContour`. Sample: `circleContour(0, 1)`.

Symbolic integral over an explicit closed contour or the real line (`realLineContour`), using the residue theorem.

```epsil
contourIntegrate(exp(z)/z, z, circleContour(0, 1))
// ➔ 2i * pi
```

```epsil
contourIntegrate(1/(x^2 + 1), x, realLineContour())
// ➔ pi
```

### D

`(expression, variables: symbol*) -> expression`

Symbolic partial derivative with respect to one or more variables.

### dSolve

MathJSON `DSolve` · `(equation: expression, dependent: symbol, variable: symbol) -> expression`

- `equation` — The differential equation, or a list of the equation and its initial conditions; without initial conditions the solution has arbitrary constants. Sample: `[D(y(x), x) == y(x), y(0) == 2]`.
- `dependent` — The unknown function, or a list of them for a system. Sample: `y`.
- `variable` — The independent variable. Sample: `x`.

Symbolic differential equation solver.

```epsil
dSolve([D(y(x), x) == y(x), y(0) == 2], y, x)
```

```epsil
dSolve(D(y(x), x, x) == -y(x), y, x)
```

### derivative

MathJSON `Derivative` · `(function, order: number*) -> function`

- argument 1 — The function to differentiate. Sample: `sin`.
- `order` — The order of the derivative; with several orders, one for each argument of the function (`1, 0` is the partial derivative in the first argument); by default, 1. Sample: `2`.

Derivative operator that returns a derivative function.

```epsil
derivative(sin)
// ➔ (x) => cos(x)
```

```epsil
apply(derivative(x => x^3, 2), 1)
// ➔ 6
```

### integrate

MathJSON `Integrate` · `(function, limits+) -> list<tuple> | number | tensor | tuple`

- argument 1 — The integrand. Sample: `x => x^2`.
- arguments 2, … — The variable of integration, alone for an antiderivative or with its bounds as `(x, a, b)`; several limits give a multiple integral.

Symbolic integral with optional bounds.

```epsil
integrate(x^2, x)
// ➔ 1/3 * x^3
```

```epsil
integrate(sin(x), (x, 0, pi))
// ➔ 2
```

### interpolatingFunction

MathJSON `InterpolatingFunction` · `(list<any>, number?) -> number`

- argument 1 — The coefficient table, one row `[x0, h, r1, r2, r3, r4, r5]` per step: its start, its width and the five coefficients of its interpolant. Sample: `[[0, 1, 1, 2, 0, 0, 0]]`.
- argument 2 — The point where the solution is evaluated; a point outside the covered interval is clamped to it. Sample: `0.5`.

Piecewise-quartic dense-output interpolant of a numeric ODE solution (produced by `ndSolveFunction`). The first operand is the per-step coefficient table; applied to a number, it evaluates the solution there (clamping to the covered interval outside it). Stays symbolic for a non-numeric argument.

```epsil
interpolatingFunction([[0, 1, 1, 2, 0, 0, 0]], 0.5)
// ➔ 2
```

### jacobianMatrix

MathJSON `JacobianMatrix` · `(fs: any, variables: any?) -> value`

- `fs` — The list of expressions to differentiate, one row each, or a single expression for its gradient. Sample: `[x * y, x + y]`.
- `variables` — The list of the variables, one column each; by default, the parameters of a function `fs`, or else the free variables of `fs` in lexicographic order. Sample: `[x, y]`.

JacobianMatrix(fs, variables): the matrix of partial derivatives ∂fᵢ/∂xⱼ, one row per function and one column per variable.

`fs` is a list of expressions. A single (non-list) expression is the gradient case: the result is the flat vector [∂f/∂x₁, …, ∂f/∂xₙ].

`variables` is a list of symbols and may be omitted, in which case the free variables of `fs` are used, in lexicographic order.

```epsil
jacobianMatrix([x^2 * y, x + z], [x, y, z])
// ➔ [[2x * y,x^2,0],[1,0,1]]
```

```epsil
jacobianMatrix(x^2 * y, [x, y])
// ➔ [2x * y,x^2]
```

### limit

MathJSON `Limit` · `(function, point: number, direction: number?) -> number`

- argument 1 — The expression, function literal or function name whose limit is taken. Sample: `x => sin(x) / x`.
- `point` — The point that the variable approaches, possibly `Infinity` or `-Infinity`; in the form `Limit(f, x, a)`, the variable. Sample: `0`.
- `direction` — 1 for the limit from above, -1 for the limit from below; by default, the two-sided limit, which stays unevaluated when the one-sided limits differ (its numeric value is `NaN`); in the form `Limit(f, x, a)`, the point, and the direction is a fourth argument. Sample: `1`.

Limit of a function.

Limit(f, x, a) is the limit of f as x approaches a.

Limit(f, a) does not write the variable: it is the first, in sorted order (an uppercase letter before a lowercase one), of the symbols that the expression f reads from outside: not a constant, a library name, a function, or a symbol bound inside f such as the index of a Sum. A symbol with an assigned value is a candidate too, so an assignment does not change the variable. A bare symbol f names a function: Limit(Sin, a) is the limit of sin(t) as t approaches a.

A bare symbol f that holds a formula is read as that formula, and the variable is chosen from it: with G := sin(x), Limit(G, 0) is 0.

The variable is bound: it never takes the value assigned to a symbol of the same name.

```epsil
limit(sqrt(x), 3)
// ➔ sqrt(3)
```

```epsil
limit(sin(x)/x, x, 0)
// ➔ 1
```

```epsil
limit(1/x, 0, -1)
// ➔ -oo
```

### Limits

`(index: symbol, lower: value, upper: value, step: value?) -> tuple`

Limits of a function

### nd

MathJSON `ND` · `(function, at: number) -> list<number> | number | tuple`

- argument 1 — The function to differentiate: an expression in one variable, a function literal or the name of a function. Sample: `x => x^3`.
- `at` — The point where the derivative is evaluated; a symbol with no value leaves the call unevaluated. Sample: `2`.

Numerical derivative evaluated at a point.

The function is an expression (ND(Sin(x), 1)), a function literal or the name of a function (ND(Sin, 1)): each gives cos(1). A symbol that holds a formula is read as that formula: with G := sin(x), ND(G, 1) is cos(1).

```epsil
nd(sin(x), 1)
// ➔ 0.5403023058595877
```

```epsil
nd(x => x^3, 2)
// ➔ 12.000000000000004
```

### ndSolve

MathJSON `NDSolve` · `(equation: expression, dependent: symbol, limits: symbol | tuple, initial: number, steps: number?) -> list`

- `equation` — The differential equation, or a list of first-order equations for a system. Sample: `D(y(x), x) == y(x)`.
- `dependent` — The unknown function, or a list of them for a system. Sample: `y`.
- `limits` — The independent variable and the interval of integration, as `(x, start, end)`; `end` may be below `start`. Sample: `(x, 0, 1)`.
- `initial` — The value of the solution at the start of the interval, or a list of values for a system. Sample: `1`.
- `steps` — The number of intervals between the sample points of the result, a positive integer; by default, 100. Sample: `4`.

Numerical differential equation solver.

```epsil
ndSolve(D(y(x), x) == y(x), y, (x, 0, 1), 1, 4)
```

### ndSolveFunction

MathJSON `NDSolveFunction` · `(equation: expression, dependent: symbol, limits: symbol | tuple, initial: number) -> function`

- `equation` — The differential equation. Sample: `D(y(x), x) == y(x)`.
- `dependent` — The unknown function. Sample: `y`.
- `limits` — The independent variable and the interval of integration, as `(x, start, end)`. Sample: `(x, 0, 1)`.
- `initial` — The value of the solution at the start of the interval. Sample: `1`.

Numerically solve an ordinary differential equation and return the solution as an applicable function (a `Function` literal wrapping an `interpolatingFunction`), usable at any point of the integration interval. Same arguments as `ndSolve`, without the sample count.

```epsil
apply(ndSolveFunction(D(y(x), x) == y(x), y, (x, 0, 1), 1), 0.5)
```

### nIntegrate

MathJSON `NIntegrate` · `(function, lower: number, upper: number) -> number`

- argument 1 — The integrand: an expression in one variable, a function literal or the name of a function. Sample: `x => x^2`.
- `lower` — The lower bound, possibly `-Infinity`; a lower bound above the upper bound gives the negated integral. Sample: `0`.
- `upper` — The upper bound, possibly `Infinity`. Sample: `1`.

Numerical approximation of a definite integral.

```epsil
nIntegrate(exp(-x^2), 0, 1)
// ➔ 0.7468241328124271
```

### nLimit

MathJSON `NLimit` · `(function, point: number, direction: number?) -> number`

- argument 1 — The expression, function literal or function name whose limit is approximated. Sample: `x => sin(x) / x`.
- `point` — The point that the variable approaches, possibly `Infinity` or `-Infinity`. Sample: `0`.
- `direction` — A positive number for the limit from above, a negative number for the limit from below, 0 for both sides (`NaN` when they differ); by default, from above. Sample: `1`.

Numerical approximation of the limit of a function.

NLimit(f, a) finds its variable with the same rule as Limit(f, a): the first of the symbols written in the expression f, in sorted order, also when it has an assigned value. A bare symbol f names a function, or, when it holds a formula (G := sin(x)), is read as that formula, whose variable is chosen with the same rule.

```epsil
nLimit((1 + 1/x)^x, Infinity)
// ➔ 2.718281828459045
```

```epsil
nLimit(abs(x)/x, 0, -1)
// ➔ -1
```

### normal

MathJSON `Normal` · `(value) -> value`

- argument 1 — The series; a value with no `BigO` term is returned unchanged. Sample: `series(sin(x), x)`.

Strip Big-O remainder terms from a series, yielding the truncated polynomial.

```epsil
normal(series(sin(x), x))
// ➔ 1/120 * x^5 - 1/6 * x^3 + x
```

### polygonContour

MathJSON `PolygonContour` · `(vertices: list<complex>, orientation: integer?) -> expression`

- `vertices` — The vertices of the polygon, in traversal order. Sample: `[1, i, -1, -i]`.
- `orientation` — 1 for counterclockwise, -1 for clockwise; by default, the orientation of the traversal order of the vertices. Sample: `-1`.

Simple closed polygon: a list of complex vertices in traversal order, with optional orientation override (+1 or -1).

```epsil
contourIntegrate(1/z, z, polygonContour([1, i, -1, -i]))
// ➔ 2i * pi
```

### rSolve

MathJSON `RSolve` · `(equation: expression, dependent: symbol, index: symbol) -> expression`

- `equation` — The recurrence, or a list of the recurrence and its initial values; without initial values the solution has arbitrary constants. Sample: `[a(n + 1) == 2 * a(n), a(0) == 3]`.
- `dependent` — The unknown sequence. Sample: `a`.
- `index` — The index of the sequence. Sample: `n`.

Symbolic recurrence equation solver.

```epsil
rSolve([a(n + 1) == 2 * a(n), a(0) == 3], a, n)
```

```epsil
rSolve(a(n + 2) == a(n + 1) + a(n), a, n)
```

### realLineContour

MathJSON `RealLineContour` · `(principalValue: boolean?) -> expression`

- `principalValue` — Whether the integral is a Cauchy principal value, which admits a simple pole on the real axis; by default, false. Sample: `true`.

The real axis from minus infinity to infinity. Pass True to explicitly request a Cauchy principal value.

```epsil
contourIntegrate(1/(x^2 + 1), x, realLineContour())
// ➔ pi
```

```epsil
contourIntegrate(1/x, x, realLineContour(True))
// ➔ 0
```

### rectangleContour

MathJSON `RectangleContour` · `(lowerLeft: complex, upperRight: complex, orientation: integer?) -> expression`

- `lowerLeft` — The lower-left corner of the rectangle. Sample: `-1 - i`.
- `upperRight` — The upper-right corner of the rectangle. Sample: `1 + i`.
- `orientation` — 1 for counterclockwise, -1 for clockwise; by default, 1. Sample: `-1`.

Closed rectangle: lower-left and upper-right complex corners, optional orientation (+1 or -1).

```epsil
contourIntegrate(1/z, z, rectangleContour(-1 - i, 1 + i))
// ➔ 2i * pi
```

### residue

MathJSON `Residue` · `(expression, variable: symbol, point: value) -> number`

- argument 1 — The function. Sample: `1 / (z^2 + 1)`.
- `variable` — The variable.
- `point` — The point; the residue is 0 at a point where the function has no pole. Sample: `i`.

Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion)

```epsil
residue(1/(z^2 + 1), z, i)
// ➔ -1/2 * i
```

```epsil
residue(exp(z)/z^2, z, 0)
// ➔ 1
```

### series

MathJSON `Series` · `(expression, variable: symbol?, point: value?, order: number?) -> number`

- argument 1 — The expression to expand. Sample: `sin(x)`.
- `variable` — The variable of the expansion; by default, the single symbol of the expression, or `x` among several; with several symbols and no `x`, the call stays unevaluated.
- `point` — The point of the expansion, possibly `Infinity`; by default, 0. Sample: `0`.
- `order` — The order of the last term kept, in powers of the distance to the point (of `1/x` at infinity), after which a `BigO` term stands; by default, 5. Sample: `3`.

Taylor series expansion of an expression about a point (or an asymptotic expansion at ±∞), including Laurent, Puiseux (fractional-power), and log-aware expansions at poles and branch points. Only essential singularities, irrational exponents, and nested/reciprocal logarithms are left unevaluated.

```epsil
series(sin(x), x)
// ➔ x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)
```
