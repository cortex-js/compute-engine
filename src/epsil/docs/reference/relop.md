---
title: Relations Reference
sidebar_label: Relations
slug: /epsil/reference/relop/
description: "The relations library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from relop.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Relations

The 30 definitions of the relations library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### Approx

`(any, any*) -> boolean`

Approximate-equality relation (approximately equal).

### ApproxEqual

`(any, any*) -> boolean`

Approximately-equal relation.

### ApproxNotEqual

`(any, any*) -> boolean`

Approximately-not-equal relation.

### congruent

MathJSON `Congruent` · `(number, number, modulo: number) -> boolean`

Indicate that two expressions are congruent modulo a number

### Equal

`(any, any) -> boolean`

Equality comparison (equal to).

### Greater

`(any, any*) -> boolean`

Greater-than comparison (strictly greater than).

### GreaterEqual

`(any, any*) -> boolean`

Greater-than-or-equal comparison (greater than or equal to).

### identicallyEqual

MathJSON `IdenticallyEqual` · `(any, any) -> boolean`

Identity comparison (`\equiv`).

True iff the operands are equal for every value of their free variables.

### isSame

MathJSON `IsSame` · `(any, any) -> boolean`

Compare two expressions for structural equality

### Less

`(any, any*) -> boolean`

Less-than comparison (strictly less than).

### LessEqual

`(any, any*) -> boolean`

Less-than-or-equal comparison (less than or equal to).

### NotApprox

`(any, any*) -> boolean`

Negated approximate-equality relation (not approximately equal).

### NotApproxEqual

`(any*) -> unknown`

Negated approximately-equal relation.

### NotApproxNotEqual

`(any, any*) -> boolean`

Negated approximately-not-equal relation.

### NotEqual

`(any, any) -> boolean`

Inequality comparison (not equal to).

### NotGreater

`(any, any*) -> boolean`

Negated greater-than relation (not greater than).

### NotGreaterNotEqual

`(any, any*) -> boolean`

Neither greater than nor equal to.

### NotLess

`(any, any*) -> boolean`

Negated less-than relation (not less than).

### NotLessNotEqual

`(any, any*) -> boolean`

Neither less than nor equal to.

### NotPrecedes

`(any, any*) -> boolean`

Negated precedes relation (does not precede).

### NotSucceeds

`(any, any*) -> boolean`

Negated succeeds relation (does not succeed).

### NotTilde

`(any, any*) -> boolean`

Negated similarity relation (not similar).

### NotTildeEqual

`(any, any*) -> boolean`

Negated approximately/asymptotically-equal relation (not approximately equal).

### NotTildeFullEqual

`(any, any*) -> boolean`

Negated isomorphism/congruence relation (not isomorphic or congruent).

### Precedes

`(any, any*) -> boolean`

Precedes relation in an ordering (comes before).

### Same

`(any, any*) -> boolean`

Structural identity comparison (Epsil `===`).

True iff every adjacent pair of operands is structurally identical.

### Succeeds

`(any, any*) -> boolean`

Succeeds relation in an ordering (comes after).

### Tilde

`(any, any*) -> boolean`

Generic similarity relation (`\sim`): similar geometric figures, asymptotic equivalence, or "is distributed as". Inert: stays symbolic.

### TildeEqual

`(any, any*) -> boolean`

Approximately or asymptotically equal

### TildeFullEqual

`(any, any*) -> boolean`

Indicate isomorphism, congruence and homotopic equivalence
