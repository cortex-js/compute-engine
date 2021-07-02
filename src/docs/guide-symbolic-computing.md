---
title: Symbolic Computing
permalink: /compute-engine/guides/symbolic-computing/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Symbolic Computing

The CortexJS Compute Engine essentially applies transformations to a MathJSON
expression by applying rewriting rules.

There are several kind of transformations, depending on the desired
result:

<div class=symbols-table>

| Transformation |  |
| :--- | :--- |
| **Format** | Put an expression in canonical ("standard") form, for easier sorting, comparing and computing. Typically limited to accounting for the flags `associative` `idempotent` `involution` and for sorting the arguments if `commutative`. Independent of the assumptions. | 
| **Simplify** | Apply rewriting rules specific to each function, eliminating constants and common sub-expressions. Use available assumptions to determine which rules are applicable. Limit calculations to exact results using integers. The result is in canonical format. | 
| **Evaluate** | Calculate the value of an expression and all its terms. Replace symbols with their value. Can perform approximate calculations using floating point numbers. The result is simplified and canonical. | 

</div>


Example, given `f` is \\( 2 + (\sqrt{x^2 \times 4} + 1) \\) and `x` is 3:

<div class=symbols-table>

|  |  | |
| :--- | :--- | :--- |
| `ce.format(f)` | `1 + 2 + \sqrt{4x^2}` | Arguments sorted, distributed |
| `ce.simplify(f)`| `2 + 2x` | Exact calculations of numeric constants,  simplification |
| `ce.evaluate(f)` | `8` | Evaluation of symbols |

</div>


Other operations can be performed on an expression: comparing it to a pattern, replacing part of it, and applying conditional rewrite rules.


The `evaluate()` function is a convenient shorthand to evaluate an expression
with a single call. Other functions such as `ce.simplify()`, `ce.is()`, `ce.N()`, `ce.canonical()`, etc... require a `ComputeEngine` instance which is denoted by the `ce.` prefix.{.notice--info}

```ts
import { ComputeEngine, parse } from '@cortex-js/compute-engine';
const ce = new ComputeEngine();
ce.simplify(parse('3x^2 + 2x^2 + x + 5'));
```

## Format with a Canonical Form

The canonical form of an expression is obtained by rewriting an expression
without making assumptions about any variables in the expression.

For example:

- terms can be sorted in a specific order
- some operations may be substituted with others, for example
  substraction replaced by addition. \\(1 + 2 - 3 \longrightarrow Add(1, 2,
  -3)\\)

Canonical forms are somewhat arbitrary, and not necessarily "the simplest" way
to represent an expression. But just like the order of the letters of the
alphabet is arbitrary, the canonical forms are nonetheless convenient to sort,
search and compare expressions.

For example \\( 1 + x\\) and \\(x + 1\\) are two expressions with the same canonical form.


**To obtain the canonical form of an expression**, use the `ce.canonical()` function.

```js
console.log(ce.canonical(["Add", 2, "x", 3]);
// ➔ ["Add", 2, 3, "x"]
```


<div class='read-more'><a href="/compute-engine/guides/forms/">Read more about <strong>Canonical Forms</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


## Simplify

**To obtain a simpler expression of a symbolic expression**, use the
`ce.simplify()` function.

Assumptions are additional information available about some symbols, for example
\\( x > 0 \\) or \\(n \in \\N\\). To apply some transformations, available
assumptions may be used. For example, if no assumptions about \\(x \\) is
available the expression \\( \sqrt{x^2} \\) cannot be simplified. However, if an
assumption that \\( x > 0 \\) is available, then the expression can be
simplified to \\( x \\).


<div class='read-more'><a href="/compute-engine/guides/assumptions/">Read more about <strong>Assumptions</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


## Evaluate

**To combine a symbolic simplification followed by a [numerical evaluation](/compute-engine/guides/numerical-evaluation)**, use
the `ce.evaluate()` function.

Invoking the `ce.evaluate()` function is roughly equivalent to calling in sequence
`ce.simplify()`, `ce.N()` then `ce.canonical()`.

Some functions may perform additional computations when `ce.evaluate()` is 
invoked.

## Other Symbolic Manipulation

You can compare two expressions, check if an expression match a pattern, 
apply a substitution to some elements in an expression or apply a conditional rewriting rule to an expression.


<div class='read-more'><a href="/compute-engine/guides/patterns-and-rules/">Read more about <strong>Patterns and Rules</strong> for these operations<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>
