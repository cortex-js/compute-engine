---
title: Patterns
permalink: /guides/compute-engine/patterns/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Patterns

Pattern matching is a powerful symbolic computing tool to identify the structure of expressions.

Patterns in the Cortex Compute Engine are similar to Regular Expressions but
they can be used to describe MathJSON expressions instead of strings.

A pattern is an expression which can include one or more wildcard symbols.

Given a pattern and an expression, usually called the **subject**, the goal of pattern matching is to find a substitution for all the wildcards such that the pattern becomes the subject.

For example, the subject `["Add", 3, "x"]` can become the pattern `["Add", 3, "_"]` by
replacing `"_"` with `"x"`. The subject is then said to match the pattern.

On the other hand, the subject `["Divide", "x", 2]` does not match the pattern `["Add", 3, "_"]`: no substitution exist to transform the subject into the pattern by replacing terms.
## Wildcards

Wildcard symbols start with a `_`. 

The `"_"` wildcard matches anything that is in the corresponding position in the
target expression.

The `"__"` wildcard matches any sequence of 1 or more expressions in its 
corresponding position. It is useful to capture the arguments
of a function.

The `"___"` wildcard matches any sequence of 0 or more expressions in its 
corresponding position.

A wildcard symbol may include a name which will be used to "capture" the 
matching expression. When using a named wildcard, all instances of the named
wildcard must match. In contrast, an un-named wildcard (a universal wildcard)
can be used multiple times to match different values.

## Matching an Expression to a Pattern

**To check if an expression matches a pattern**, use the `match()` function.

If there is a match, it returns an object literal with keys corresponding to the
matchign named wildcards. If no named wildcards are used and there is a match
it returns an empty object literal

```js
import { match } from 'compute-engine';

const pattern = ['Add', 'x', '_'];

console.log(match(['Add', 'x', '1'], pattern));
// -> { } : matched
```

The `match()` function returns `null` if the expression does not match the
pattern.

```js
console.log(match(['Multiply', 'x', '1'], pattern));
// -> null : no match
```

The commutativity and associativity of operations such as `Add` is taken into 
account:

```js
console.log(match(['Add', '1', 'x'], pattern));
// -> { } : one match (commutative operation)
```

If the same named wildcard is used multiple times, all its values must match.

```js
console.log(match(['Add', '1', 'x'], ['Add', '_a', '_a']));
// -> null

console.log(match(['Add', 'x', 'x'], ['Add', '_a', '_a']));
// -> { "a": "x" }
```

Wildcards can be used to capture the head of functions:

```js
console.log(match(['Add', '1', 'x'], ['_f', '1', 'x']));
// -> { "f": "Add" }
```


## `count()`

## `matchList()`
