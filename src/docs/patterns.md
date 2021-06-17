---
title: Patterns
permalink: /guides/compute-engine/patterns/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Patterns

Pattern matching is a powerful symbolic computing tool to identify the structure
of expressions.

A pattern is an expression which can include one or more wildcard symbols.

Patterns in the Cortex Compute Engine are similar to Regular Expressions but
they can be used to describe MathJSON expressions instead of strings.

Given a pattern and an expression, usually called the **subject**, the goal of
pattern matching is to find a substitution for all the wildcards such that the
pattern becomes the subject.

For example, the subject `["Add", 3, "x"]` can become the pattern
`["Add", 3, "_"]` by replacing the wildcard `"_"` with `"x"`. The subject is
then said to match the pattern.

On the other hand, the subject `["Divide", "x", 2]` does not match the pattern
`["Add", 3, "_"]`: no substitution exist to transform the subject into the
pattern by replacing wildcard symbols.

## Wildcards

Wildcard symbols start with a `_`.

The `"_"` wildcard matches anything that is in the corresponding position in the
subject expression.

The `"__"` wildcard matches any sequence of 1 or more expressions in its
corresponding position. It is useful to capture the arguments of a function.

The `"___"` wildcard matches any sequence of 0 or more expressions in its
corresponding position.

A wildcard symbol may include a name which will be used to "capture" the
matching expression. When using a named wildcard, all instances of the named
wildcard must match. In contrast, an un-named wildcard (a universal wildcard)
can be used multiple times to match different values.

## Matching an Expression to a Pattern

**To check if an expression matches a pattern**, use the `match()` function.

If there is a match, it returns an object literal with keys corresponding to the
matchign named wildcards. If no named wildcards are used and there is a match it
returns an empty object literal.

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

## Substitution

The return value of the `match()` function is a `Substitution` object, that is a
mapping from wildcard names to expressions.

**To apply a substitution to a pattern**, and therefore recover the subject it
was derived from, use the `substitute()` function.

```js
const subject = ['Add', 1, 'x'];
const pattern = ['Add', 1, '_a'];

console.log(match(subject, pattern));
// -> { a: "x" }

console.log(substitute(pattern, { a: 'x' }));
// -> ["Add", 1, "x"]
```

## Comparing

**To compare two expressions**, use the `match()` function. The function returns
`null` if the two expressions do not match. It returns an object literal if the
expressions do match. If the first argument included wildcards the resulting
object literal indicate the substitutions for those wildcards. If no wildscards
were used and the expressions matched, an empty object literal, `{}` is
returned. To check if the expressions simply match or not, check if the return
value is `null` (indicating not a match) or not (indicating a match).

The comparison between expressions is structural so that \\(x + 1\\) is not
equal to \\(1 + x\\). To obtain the desired result, you may need to apply a
canonical form to the expressions using `ComputeEngine.canonical()`, or evaluate
them using `ComputeEngine.evaluate()`.

```js
const engine = new ComputeEngine();

const variable = 'x';
console.log(match(['Add', 'x', 1], ['Add', variable, 1]));
// ➔ {}: the two expressions are the same

console.log(match(['Add', 'x', 1], ['Add', 1, 'x']));
// ➔ null: the two expressions are **not** the same

console.log(
  match(engine.canonical(['Add', 'x', 1]), engine.canonical(['Add', 1, 'x']))
);
// ➔ true: the two expressions are the same in canonical form

console.log(engine.match(parse('2 + 2'), parse('3 + 1')));
// ➔ null: the two expressions are **not** the same

console.log(
  match(
    engine.evaluate(parse('2 + 2 + x')),
    engine.evaluate(parse('3 + 1 + x'))
  )
);
// ➔ {}: the two expressions are the same once evaluated
```

## `count()`

## `matchList()`
