---
title: Patterns and Rules
permalink: /compute-engine/guides/patterns-and-rules/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
---

Recognizing patterns and applying rules is a powerful symbolic computing tool to
identify and manipulate the structure of expressions.{.xl}

<section id="wildcards">

## Wildcards

Wildcard symbols are placeholders in an expression. They start with a `_`.

The `"_"` universal wildcard matches anything that is in the corresponding 
position in an expression.

The `"__"` wildcard matches any sequence of 1 or more expressions in its
corresponding position. It is useful to capture the arguments of a function.

The `"___"` wildcard matches any sequence of 0 or more expressions in its
corresponding position.

A wildcard symbol may include a name which is used to _capture_ the matching
expression. When using a named wildcard, all instances of the named wildcard
must match. In contrast, an un-named wildcard (a universal wildcard such as
`"_"` `"__"` or `"___"`) can be used multiple times to match different values.

</section>

<section id="patterns">

## Patterns

A pattern is an expression which can include one or more placeholders in the
form of wildcard symbols.

Patterns are similar to Regular Expressions in traditional programming languages
but they are tailored to deal with MathJSON expressions instead of strings.

Given a pattern and an expression the goal of pattern matching is to find a
substitution for all the wildcards such that the pattern becomes the expression.

An expression is said to match a pattern if there exists a set of values such
that replacing the wildcards with those values match the expression. This set of
values is called a **substitution**.

For example, the pattern `["Add", 3, "_c"]` becomes the expression
`["Add", 3, "x"]` by replacing the wildcard `"_c"` with `"x"`. The substitution
is `{"c" : "x"}`.

On the other hand, the expression `["Divide", "x", 2]` does not match the
pattern `["Add", 3, "_c"]`: no substitution exists to transform the expression
into the pattern by replacing the wildcards.

</section>

<section id='matching-an-expression-to-a-pattern'>

## Matching an Expression to a Pattern

**To check if an expression matches a pattern**, use the
`_pattern_.match(_expression_)` function.

If there is a match, `pattern.match()` returns a `Substitution` object literal with
keys corresponding to the matching named wildcards. If no named wildcards are
used and there is a match it returns an empty object literal. If there is no
match, it returns `null`.

```js example
const pattern = ce.box(["Add", "x", "_"]);

console.log(pattern.match(ce.box(["Add", "x", 1])));
// ➔ { } : the expression matches the pattern

console.log(pattern.match(ce.box(["Multiply", "x", 1])));
// ➔ null : the expression does not match the pattern
```


```js example
const pattern = ce.box(["Add", "x", "_"]);

console.log(patterm.match(ce.box(["Add", "x", 1])));
// ➔ { } : the expression matches the pattern

console.log(pattern.match(ce.box(["Add", 1, "x"])));
// ➔ { } : the expression matches the pattern by commutativity
```

The `pattern.match()` does not consider sub-expressions, it is not recursive.

```js example
const pattern = ce.box(["Add", "x", "_"]);

console.log(pattern.match(ce.box(["Multiply", 2, ["Add", "x", 1]])));
// ➔ null : the expression does not match the pattern
```

If the same named wildcard is used multiple times, all its values must match.

```js example
console.log(ce.box(["Add", '_a', '_a']).match(ce.box(["Add", 1, "x"])));
// ➔ null

console.log(ce.box(["Add", '_a', '_a']).match(ce.box(["Add", "x", "x"])));
// ➔ { "a": "x" }
```

Wildcards can be used to capture the head of functions:

```js example
console.log(ce.box(["_f", 1, "x"]).match(ce.box(["Add", 1, "x"])));
// ➔ { "f": "Add" }
```

</section>

<section id="substitution">

## Substitution

The return value of the `match()` function is a `Substitution` object: a mapping
from wildcard names to expressions.

If there is no match, `match()` returns `null`.

**To apply a substitution to a pattern**, and therefore recover the expression
it was derived from, use the `substitute()` function.

```js example
const expression = ce.box(["Add", 1, "x"]);
const pattern = ce.box(["Add", 1, "_a"]);

console.log(pattern.match(expression));
// ➔ { a: "x" }

expression.subs({ a: "x" }).print();
// ➔ ["Add", 1, "x"]
```

</section>

<section id="comparing">

## Comparing

**To check if an expression matches a pattern**, use the `pattern.match()`
function.

The function returns `null` if the two expressions do not match. It returns an
object literal if the expressions do match.

If the argument to `match()` included wildcards the resulting object literal
indicate the substitutions for those wildcards. If no wildcards were used and
the expressions matched, an empty object literal, `{}` is returned. To check if
the expressions simply match or not, check if the return value is `null`
(indicating not a match) or not (indicating a match).

```js example
const ce = new ComputeEngine();

const variable = "x";
console.log(ce.match(["Add", "x", 1], ["Add", variable, 1]));
// ➔ {}: the two expressions are the same

console.log(ce.match(["Add", "x", 1], ["Add", 1, "x"]));
// ➔ null: the two expressions are the same because `Add` is commutative

console.log(ce.match(parse('2 + 2 + x'), parse('3 + 1 + x')));
// ➔ null: the two expressions are **not** the same: they are not evaluated

console.log(
  match(ce.evaluate(parse('2 + 2 + x')), ce.evaluate(parse('3 + 1 + x')))
);
// ➔ {}: the two expressions are the same once evaluated
```

</section>

<section id='applying-rewrite-rules'>

## Applying Rewrite Rules

A rewrite rule is a `[_match_, _sub_]` tuple:

- `match`: a matching pattern
- `sub`: a substitution pattern, 

**To apply a set of rules to an expression**, call the `expr.replace()`
function.

When a rule is applied to an expression `expr` with `expr.replace()`, 
if `expr` matches the `match` pattern the result of `expr.replace()` is the 
substitution pattern `sub` applied to the expression.

```ts example
const squareRule = ce.rules([
  [
    ["Multiply", "_x", "_x"],   // match pattern
    ["Square", "_x"],           // substitution pattern
  ],
]);

ce.box(["Multiply", 4, 4], {canonical: false}).replace(squareRule);
// ➔ ["Square", 4]
```

The `expr.replace()` function continues applying all the rules in the ruleset
until no rules are applicable.

The `expr.simplify()` function applies a collection of built-in rewrite rules.
You can define your own rules and apply them using `expr.replace()`.

</section>
