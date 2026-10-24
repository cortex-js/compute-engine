---
title: Control structures Reference
sidebar_label: Control structures
slug: /epsil/reference/control-structures/
description: "The control structures library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from control-structures.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Control structures

The 13 definitions of the control structures library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### Alternatives

`(expression+) -> nothing`

Inside a `Match` pattern, `Alternatives(p1, p2, …)` matches if any alternative matches. Alternatives must be binding-free.

### Break

`(value: any?) -> nothing`

Exit the enclosing loop immediately, optionally with a value (`Break(v)`) that becomes the loop value.

### Comprehension

`(body: expression, iterators: expression+) -> list`

Value-producing comprehension: evaluate `body` in nested iteration over one or more `Element` clauses and collect the results into a list. Later clauses see earlier bindings; independent clauses produce a Cartesian product. A clause with a third operand, `Element(x, xs, cond)`, is a guard: only the elements for which `cond` evaluates to `True` are visited.

### Condition

`(expression, symbol?) -> boolean`

Test whether a value satisfies one or more conditions.

### Continue

`() -> nothing`

Skip to the next iteration of the enclosing loop.

### fixedPoint

MathJSON `FixedPoint` · `(function, initial: any, maxIterations: integer?) -> unknown`

Apply a function repeatedly, starting from an initial value, until two successive values are the same: `FixedPoint(f, x)` is the first of `f(x)`, `f(f(x))`, … that `f` maps to itself.

Two values are the same when they are structurally identical, or when they are numbers, one of them a float, that agree to the working precision (their difference is at most a few units of the last digit, relative to their size), or when they are lists or tuples of the same length whose elements are the same. A sequence of exact values stops only when two of them are identical.

Without a maximum, the call stays unevaluated when the iteration cannot converge: when a value contains the previous one (`FixedPoint(Cos, 1)`: `Cos(1)` is exact, and `Cos(Cos(1))` nests it), or when an exact number gains digits at each step. Start from a float (`FixedPoint(Cos, 1.0)`), or evaluate with `N`, for a numeric fixed point.

The optional third argument is the maximum number of applications, a positive integer. It defaults to the engine iteration limit, and then the call stays unevaluated if the iteration has not converged by that limit (raise `ce.iterationLimit` for a slower one). When an explicit maximum is reached, the last value is returned.

```epsil
fixedPoint(x => (x + 2 / x) / 2, 1.0)
// ➔ 1.4142135623730950488
```

```epsil
fixedPoint(cos, 1.0)
// ➔ 0.739085133215160641631
```

### If

`(expression, expression, expression?) -> any`

`If(c, e1, e2)` evaluates to `e1` when `c` is `True` and to `e2` otherwise; without `e2` it is `Missing` when `c` is `False`. Only the selected expression is evaluated.
When `c` is a list of booleans (`L < 3` with `L` a list), the selection is made at each position and the value is a list: `If([True, False, True], 1, 0)` is `[1, 0, 1]`, and with `L = [1, 3, 5]`, `If(L < 3, L, 0)` is `[1, 0, 0]`. `If(c, e1, e2)` is then `Which(c, e1, True, e2)`: see `Which` for the rules of element-wise selection.

### Loop

`(body: expression, iterators: expression*) -> any`

Imperative loop, evaluated **for effect**. `Loop(body)` repeatedly evaluates `body` until it yields a `Break` or `Return`. `Loop(body, Element(x, coll), …)` iterates `body` in nested iteration over the Element clauses (later clauses see earlier bindings; independent clauses produce a Cartesian product). The loop value is `Nothing`, or the value carried by a `Break`/`Return`. For a value-producing comprehension use `Comprehension` or `Map`.

### Match

`(expression, expression+) -> unknown`

Structural pattern match. `Match(subject, MatchCase(pattern, body), …)` evaluates `subject` once, then selects the first case whose pattern matches (structurally, `isSame`-like) and whose guard holds, applying its body to the captured values. Unlike `Which`, `Match` always decides: a symbolic subject that is not structurally a case still falls through to a wildcard case. No matching case yields `Error("match-no-case", subject)`.

### MatchCase

`(expression, expression, expression?) -> nothing`

A case of a `Match`: `MatchCase(pattern, body)` or `MatchCase(pattern, guard, body)`. The pattern holds engine wildcards; the body references the bound capture names.

### Pin

`(expression) -> nothing`

Inside a `Match` pattern, `Pin(expr)` matches the value of `expr` (evaluated at match time) rather than its structure.

### when

MathJSON `When` · `(expression, boolean) -> any`

Conditional/restriction value. `When(e, cond)` evaluates to:
  - `e` when `cond` evaluates to `True`
  - the absence marker of the type of `e` when `cond` evaluates to `False` (the "masking rule"): `NaN` for a number, `Missing` — the position-preserving absent datum, the answer a selection with no selected branch gives — for a point, a list, a string or a value not provably numeric; consumers like 2D plotters skip masked points
  - `When(e, cond_simplified)` when `cond` is indeterminate (holds)
Stacked restrictions canonicalize: `When(When(e, c1), c2)` → `When(e, And(c1, c2))`.
Compiles to ternary `(cond) ? (e) : NaN` in JS and GLSL.

### Which

`(expression+) -> unknown`

`Which(c1, e1, c2, e2, …)` evaluates to the value of the first `e` whose condition `c` is `True`, and to `Missing` when no condition is `True`. A last clause with the condition `True` is the default. Only the selected expression is evaluated.
Element-wise selection: when a condition is a list of booleans (`L < 3` with `L` a list), the selection is made at each position, as `numpy.select` does, and the value is a list. At each position, the first clause whose condition is `True` there gives the value: an expression that is a list gives its element at that position, any other expression gives its own value. With `L = [1, 3, 5]`, `Which(L < 2, 10, L < 4, L, True, 0)` is `[10, 3, 0]`.
  - A condition that is not a list applies to every position.
  - Every list must have the length of the condition, else the value is an `incompatible-dimensions` error.
  - A position that no clause selects holds `NaN` when every expression is a number, `Missing` otherwise.
  - A condition that is a list of lists (a comparison of a matrix) selects at every level; an expression with fewer levels than the condition is an `incompatible-dimensions` error, one with more levels is taken whole at each position.
