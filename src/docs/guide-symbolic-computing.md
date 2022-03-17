---
title: Symbolic Computing
permalink: /compute-engine/guides/symbolic-computing/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Symbolic Computing

The CortexJS Compute Engine essentially transform a MathJSON expression by
applying rewriting rules.

There are several kind of transformations, depending on the desired result:

<div class=symbols-table>

| Transformation   |                                                                                                                                                                                                                                                                                         |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonicalize** | Put an expression in canonical ("standard") form, for easier sorting, comparing and computing.<br> Modify expressions according to the `associative` `idempotent` and `involution` function flags. Sort the arguments if the `commutative` flag is set. Independent of the assumptions. |
| **Simplify**     | Apply rewriting rules specific to each function, eliminating constants and common sub-expressions. Use available assumptions to determine which rules are applicable. Limit calculations to exact results using integers.                                                               |
| **Evaluate**     | Calculate the value of an expression. Replace symbols with their value. Perform exact calculations using integers.                                                                                                                                                                      |
| **N**            | Calculate a numerical approximation of an expression using floating point numbers.                                                                                                                                                                                                      |

<div class=symbols-table>

|                               | `canonicalize` | `simplify` | `evaluate` | `N` |
| :---------------------------- | :------------- | :--------- | :--------- | :-- |
| Exact calculations            | ✔︎             | ✔︎         | ✔︎         | ✔︎  |
| Use assumptions on symbols    |                | ✔︎         | ✔︎         | ✔︎  |
| Floating-point approximations |                |            |            | ✔︎  |

</div>

</div>

For example, given `f` is \\( 2 + (\sqrt{x^2 \times 4} + 1) \\) and `x` is 3:

<div class=symbols-table>

|                |                           |                                                              |
| :------------- | :------------------------ | :----------------------------------------------------------- |
| `f.canonical`  | \\(1 + 2 + \sqrt{4x^2}\\) | Arguments sorted, distributed                                |
| `f.simplify()` | \\(2 + 2x\\)              | Exact calculations of some integer constants, simplification |
| `f.evaluate()` | \\(8\\)                   | Evaluation of symbols                                        |

</div>

Other operations can be performed on an expression: comparing it to a pattern,
replacing part of it, and applying conditional rewrite rules.

Functions such as `ce.box()` and `ce.parse()` require a `ComputeEngine` instance
which is denoted by a `ce.` prefix.<br>Functions that apply to a boxed
expression, such as `expr.simplify()` are denoted with a `expr.` prefix.
{.notice--info}

```ts
import { ComputeEngine } from '@cortex-js/compute-engine';
const ce = new ComputeEngine();
ce.parse('3x^2 + 2x^2 + x + 5').simplify();
```

## Format with a Canonical Form

The canonical form of an expression is obtained by rewriting an expression
without making assumptions about any variables in the expression.

For example:

- if the function is commutative arguments of a function are sorted in a
  specific order
- some operations may be substituted with others, for example substraction
  replaced by addition. \\(1 + 2 - 3 \longrightarrow Add(1, 2, -3)\\)

The canonical form is somewhat arbitrary, and not necessarily "the simplest" way
to represent an expression. But just like the order of the letters of the
alphabet is arbitrary, the canonical form is nonetheless convenient to sort,
search and compare expressions efficiently.

For example \\( 1 + x\\) and \\(x + 1\\) are two expressions with the same
canonical form, making it easier to compare them.

**To obtain the canonical form of an expression**, use the `expr.canonical`
property.

```js
console.log(ce.box(['Add', 2, 'x', 3]).canonical);
// ➔ ["Add", 5, "x"]
```

{% readmore "/compute-engine/guides/forms/" %} Read more about <strong>Canonical
Forms</strong> {% endreadmore %}

## Simplify

**To obtain a simpler expression of a symbolic expression**, call the
`expr.simplify()` function.

The `expr.simplify()` function makes use of available assumptions about symbols
and return an exact result: there are no numerical evaluation done that could
result in a loss of precision.

{% readmore "/compute-engine/guides/simplify/" %} Read more about
<strong>Simplify</strong> {% endreadmore %}

## Evaluate

**To apply a sequence of definitions to an expression in order to reduce,
simplify and calculate its value**, call the `expr.evaluate()` function.

When a function is evaluated, its arguments are first evaluated left to right,
then the function is applied to the arguments.

However, a function definition can specify that some or all of its arguments
should not be evaluated. This can be useful for a function that needs to perform
symbolic manipulation of an expression: otherwise, the expression would be
evaluated without giving a chance to the function to access the symbolic
expression.

While a function definition will usually indicate which arguments should be
evaluated or not, it is possible to override this.

**To prevent an argument from being evaluated**, use the `Hold` function.

**To force an argument to be evaluated**, use the `ReleaseHold` function.

## `N`: Numerical Evaluation

```js
const expr = ce.parse('\\frac{2}{6}');

console.log(expr.evaluate().latex);
// ➔ "\frac{1}{3}"

console.log(expr.N().latex);
// ➔ "0.33333333333333"
```

## Comparing

There are two useful ways to compare symbolic expressions:

- structural equality
- mathematical equality

### Structural Equality

Structural equality (or syntactic) consider the symbolic structure used to
represent an expression. If a symbol, is it the same symbol, if a function, does
it have the same head, and are each arguments structurally equal, etc...

Structural equality is very precise. `x + 1` and `1 + x` are structurally
different, since the order of the arguments matter. \\( x^2 \\) and \\( x \times
x \\) are structurally different since one is a multiplication and the other a
power operation.

**To check if two expressions are structurally equal, use `expr.isSame()`**

```js
console.log(ce.parse('2 + 2').isSame('4'));
// ➔ false

console.log(ce.parse('x + 1').isSame('1 + x'));
// ➔ false
```

### Mathematical Equality

It turns out that comparing two arbitrary mathematical expressions is a complex
problem. In fact,
[Richardson's Theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)
proves that it is impossible to determine if two symbolic expressions are
identical in general.

However, there are many cases where it is possible to make a comparison between
two expressions to check if they represent the same mathematical object.

**To check if two expressions are mathematically equal, use `expr.isEqual()`**

```js
console.log(ce.parse('2 + 2').isEqual('4'));
// ➔ true

console.log(ce.parse('x + 1').isEqual('1 + x'));
// ➔ true
```

Note that unlike `expr.isSame()`, `expr.isEqual()` can return `true`, `false` or
`undefined`. The latter value indicates that there is not enough information to
determine if the two expressions are mathematically equal. Adding some
assumptions may result in a different answer.

## Other Symbolic Manipulation

An expression can be created from MathJSON or LaTeX, simplified, or evaluated.
An expression has many properties, such as `isZero`, `domain` or `symbol`.

{% readmore "/compute-engine/guides/expressions/" %} Read more about
<strong>Expressions</strong>, their properties and methods {% endreadmore %}

You can check if an expression match a pattern, apply a substitution to some
elements in an expression or apply conditional rewriting rules to an expression.

{% readmore "/compute-engine/guides/patterns-and-rules/" %} Read more about
<strong>Patterns and Rules</strong> for these operations {% endreadmore %}
