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

MathJSON `FixedPoint` · `(any) -> unknown`

Iterate a function until a fixed point is reached.

### If

`(expression, expression, expression?) -> any`

Conditional branch: evaluate one of two expressions.

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

Return the value for the first condition that is true.
