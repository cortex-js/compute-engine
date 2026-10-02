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

The 19 definitions of the calculus library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### bigO

MathJSON `BigO` · `(value) -> number`

Landau big-O remainder term. Inert; any numeric approximation (.N()) of an expression containing it is NaN.

### circularIntegrate

MathJSON `CircularIntegrate` · `(function, limits+) -> number`

Contour (closed-path) integral. Inert: never evaluated.

### D

`(expression, variables: symbol*) -> expression`

Symbolic partial derivative with respect to one or more variables.

### dSolve

MathJSON `DSolve` · `(expression, symbol, symbol) -> expression`

Symbolic differential equation solver.

### derivative

MathJSON `Derivative` · `(function, order: number*) -> function`

Derivative operator that returns a derivative function.

### integrate

MathJSON `Integrate` · `(function, limits+) -> list<number> | list<tuple> | number | tuple`

Symbolic integral with optional bounds.

### interpolatingFunction

MathJSON `InterpolatingFunction` · `(list<any>, number?) -> number`

Piecewise-quartic dense-output interpolant of a numeric ODE solution (produced by `NDSolveFunction`). The first operand is the per-step coefficient table; applied to a number, it evaluates the solution there (clamping to the covered interval outside it). Stays symbolic for a non-numeric argument.

### jacobianMatrix

MathJSON `JacobianMatrix` · `(any, any?) -> value`

JacobianMatrix(fs, vars): the matrix of partial derivatives

∂fᵢ/∂xⱼ, one row per function and one column per variable.

`fs` is a list of expressions. A single (non-list) expression is the

gradient case: the result is the flat vector [∂f/∂x₁, …, ∂f/∂xₙ].

`vars` is a list of symbols and may be omitted, in which case the

free variables of `fs` are used, in lexicographic order.

Example: JacobianMatrix([x^2 y, x + z], [x, y, z]).

### limit

MathJSON `Limit` · `(function, point: number, direction: number?) -> number`

Limit of a function

### Limits

`(index: symbol, lower: value, upper: value) -> tuple`

Limits of a function

### nd

MathJSON `ND` · `(function, at: number) -> list<number> | number | tuple`

Numerical derivative evaluated at a point.

### ndSolve

MathJSON `NDSolve` · `(expression, symbol, limits: symbol | tuple, number, number?) -> list`

Numerical differential equation solver.

### ndSolveFunction

MathJSON `NDSolveFunction` · `(expression, symbol, limits: symbol | tuple, number) -> function`

Numerically solve an ordinary differential equation and return the solution as an applicable function (a `Function` literal wrapping an `InterpolatingFunction`), usable at any point of the integration interval. Same arguments as `NDSolve`, without the sample count.

### nIntegrate

MathJSON `NIntegrate` · `(function, lower: number, upper: number) -> number`

Numerical approximation of a definite integral.

### nLimit

MathJSON `NLimit` · `(function, point: number, direction: number?) -> number`

Numerical approximation of the limit of a function

### normal

MathJSON `Normal` · `(value) -> value`

Strip Big-O remainder terms from a series, yielding the truncated polynomial. Example: Normal(Series(\sin x, x)) → x - x^3/6 + x^5/120

### rSolve

MathJSON `RSolve` · `(expression, symbol, symbol) -> expression`

Symbolic recurrence equation solver.

### residue

MathJSON `Residue` · `(expression, variable: symbol, point: value) -> number`

Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion)

### series

MathJSON `Series` · `(expression, variable: symbol?, point: value?, order: number?) -> number`

Taylor series expansion of an expression about a point (or an asymptotic expansion at ±∞), including Laurent, Puiseux (fractional-power), and log-aware expansions at poles and branch points. Only essential singularities, irrational exponents, and nested/reciprocal logarithms are left unevaluated. Example: Series(\sin x, x) → x - x^3/6 + x^5/120 + O(x^7)
