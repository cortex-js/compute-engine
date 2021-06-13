---
title: Patterns
permalink: /guides/compute-engine/patterns/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Patterns

Patterns are a powerful tool to identify the structure of expressions.

Patterns in the Cortex Compute Engine are similar to Regular Expressions but
they can be used to describe MathJSON expressions instead of strings.

## Capture Variables

A pattern is an expression which can include special symbols called capture
variables. These symbols start with a `_`. In fact, they can be just `_`. A `_`
capture variable matches anything that is in the corresponding position in the
target expression.

The `__` (two `_`) capture variable matches any sequence of 1 or more
expressions in its corresponding position. It is useful to capture the arguments
of a function.

The `___` (three `_`) capture variables matches any sequence of 0 or more
expressions in its corresponding position.

## Matching an Expressin to a Pattern

**To check if an expression matches a pattern**, use the `match()` function.

If there is a match, it returns an object literal with keys corresponding to the
captured variables.

```js
import { match } from 'compute-engine';

const pattern = ['Add', 'x', '_'];

console.log(match(['Add', 'x', '1'], pattern));
// -> { "_": "1" } : one match
```

The `match()` function returns `null` if the expression does not match the
pattern.

```js
console.log(match(['Multiply', 'x', '1'], pattern));
// -> null : no match
```

The commutativity of operations such as Addition is taken into account:

```js
console.log(match(['Add', '1', 'x'], pattern));
// -> { "_": "1" } : one match (commutative operation)
```

If the same capture variable is used multiple times, all its values must match.

```js
console.log(match(['Add', '1', 'x'], ['Add', '_', '_']));
// -> null

console.log(match(['Add', 'x', 'x'], ['Add', '_', '_']));
// -> { "_": "x" }
```

Capture variables can be used to capture the head of functions:

```js
console.log(match(['Add', '1', 'x'], ['_', '1', 'x']));
// -> { "_": "Add" }
```

More descriptive names can beused for capture variables, which is particularly
useful if you need to use multiple capture variables:

```js
console.log(match(['Add', '1', 'x'], ['Add', '_a', '_b']));
// -> { "_a": "x", "_b": "1" }
```

## `count()`

## `matchList()`
