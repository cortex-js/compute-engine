---
title: Patterns
permalink: /guides/compute-engine/patterns-and-rules/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Patterns and Rules

Recognizing patterns and applying rules is a powerful symbolic computing tool 
to identify and manipulate the structure of expressions.

## Patterns

A pattern is an expression which can include one or more placeholders in the 
form of wildcard symbols.

Patterns are similar to Regular Expressions in traditional programming languages
but they are tailored to deal with MathJSON expressions instead of strings.

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

Wildcard symbols are placeholders in a pattern expression. They start with a `_`.

The `"_"` wildcard matches anything that is in the corresponding position in the
subject expression.

The `"__"` wildcard matches any sequence of 1 or more expressions in its
corresponding position. It is useful to capture the arguments of a function.

The `"___"` wildcard matches any sequence of 0 or more expressions in its
corresponding position.

A wildcard symbol may include a name which will be used to _capture_ the
matching expression. When using a named wildcard, all instances of the named
wildcard must match. In contrast, an un-named wildcard (a universal wildcard)
can be used multiple times to match different values.

## Matching an Expression to a Pattern

**To check if an expression matches a pattern**, use the `match()` function.

The functions `match()` and `substitute()` do not require a `ComputeEngine` 
instance. They are plain functions that can be called directly. The `ce.match()`
function on a `ComputeEngine` instance will take into account information 
about the functions, such as which are commutative and associative {.notice--info}

If there is a match, `match()` returns a `Substitution` object literal with 
keys corresponding to the matching named wildcards. If no named wildcards are 
used and there is a match it returns an empty object literal. If there is no 
match, it returns `null`.

```js
import { match } from '@cortex-js/compute-engine';

const pattern = ['Add', 'x', '_'];

console.log(match(['Add', 'x', '1'], pattern));
// -> { } : the subject matched the pattern

console.log(match(['Multiply', 'x', '1'], pattern));
// -> null : the subject does not match the pattern
```

To take into account the commutativity and associativity of operations such as `Add` apply a `ce.canonical()` on both the subject and the pattern:

```js
const ce = new ComputeEngine();
console.log(match(ce.canonical(['Add', '1', 'x'](, ce.canonical(pattern)));
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

**To compare two expressions**, use the `match()` function. 

The function returns `null` if the two expressions do not match. It returns an 
object literal if the expressions do match. 

If the first argument included wildcards the resulting object literal indicate
the substitutions for those wildcards. If no wildscards were used and the\
expressions matched, an empty object literal, `{}` is returned. 
To check if the expressions simply match or not, check if the return value is
 `null` (indicating not a match) or not (indicating a match).

The comparison between expressions is structural so that \\(x + 1\\) is not
equal to \\(1 + x\\). To obtain the desired result, you may need to apply a
canonical form to the expressions using `ce.canonical()`, or evaluate
them using `ce.evaluate()`.

```js
const ce = new ComputeEngine();

const variable = 'x';
console.log(match(['Add', 'x', 1], ['Add', variable, 1]));
// ➔ {}: the two expressions are the same

console.log(match(['Add', 'x', 1], ['Add', 1, 'x']));
// ➔ null: the two expressions are **not** the same

console.log(
  match(ce.canonical(['Add', 'x', 1]), ce.canonical(['Add', 1, 'x']))
);
// ➔ true: the two expressions are the same in canonical form

console.log(ce.match(parse('2 + 2'), parse('3 + 1')));
// ➔ null: the two expressions are **not** the same

console.log(
  match(
    ce.evaluate(parse('2 + 2 + x')),
    ce.evaluate(parse('3 + 1 + x'))
  )
);
// ➔ {}: the two expressions are the same once evaluated
```

## Applying Rewrite Rules

A rewrite rule is a triplet of:

- a left-hand-side pattern,  `lhs`
- a right-hand-side pattern, `rhs`
- an optional `condition`

When a rule is applied to an expression `expr`, if `expr` matches `lhs` and
the `condition` applies to the resulting substitution, the result of the 
rule is the substitution applied to the `rhs`.

**To apply a set of rules to an expression**, use the `ce.replace()` function.

```ts
const squareRule = [['Multiply', '_x', '_x'], ['Square', '_x']];

ce.replace([squareRule], ['Multiply', 4, 4]);
// -> ['Square', 4]

const sqrtRule =   [
  ['Sqrt', ['Square',  '_x']], 
  '_x',
  (ce, sub) => ce.isPositive(sub._x)
];
ce.replace([sqrtRule], ['Sqrt', ['Square', 17]]);
// -> 17
```

The `ce.replace()` function continues applying all the rules in the ruleset until no rules are applicable.

The `ce.simplify()` method applies a collection of built-in rewrite rules. You can define your own rules and apply them 
using `ce.replace()`.



## `count()`
