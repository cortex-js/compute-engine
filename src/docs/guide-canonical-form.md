---
title: Canonical Forms
permalink: /compute-engine/guides/canonical-form/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Canonical Form

Some mathematical objects can be represented by several equivalent expressions.

For example, the expressions in each row below represent the same mathematical
object:

<div class="equal-width-columns">

|                  |                            |                            |
| --------------- | ------------------------- | ------------------------- |
| \\[ 215.3465 \\] | \\[ 2.15346\mathrm{e}2 \\] | \\[ 2.15346 \times 10^2\\] |
| \\[ 1 - x \\]    | \\[-x + 1 \\]              | \\[ 1 + (-x)\\]            |
| \\[ -2x^{-1}\\]  | \\[ -\frac{2}{x} \\]       | \\[ \frac{-2}{x} \\]       |

</div>

By applying some conventions &mdash; for example sorting variables and functions
operands in a commutative function or flattening associative functions &mdash; 
we define a **canonical** representation.

A canonical representation is somewhat arbitrary, but using it consistently make
some operations easier, for example, comparing two expressions for equality.

The canonical form used by the Compute Engine follows common (but certainly not
universal) conventions in writing mathematical expressions, and expresses them
in a way that optimize their computation.

**To obtain the canonical representation of an expression**, use the
`expr.canonical` property.

Calculating the canonical form of an expression is applying some rewriting rules
to an expression. In that sense, it is similar to simplifying an expression with
`expr.simplify()`, but it is more conservative in the transformations it
applies, and it will not take into account any assumptions about symbols.

The default canonical representation applies a series of transformation to put
sums, products, numbers, roots, etc... in canonical form.

The transformations applied is listed below.

<div class=symbols-table>

| Form                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canonical`          | Apply the following transformations, in order: <ul><li> `canonical-number`</li><li>`canonical-exp`</li><li>`canonical-root`</li><li>`canonical-subtract`</li><li>`canonical-divide`</li><li>`canonical-power`</li><li>`canonical-multiply`</li><li>`canonical-negate`</li><li>`canonical-add`</li><li>`flatten`</li><li>`canonical-list`</li><li>`canonical-set`</li><li>`canonical-domain`</li><li>`canonical-rational`</li><li>`sorted`</li><li>`json`</li></ul>                                                                                           |
| `canonical-add`      | Addition of 0 is simplified, associativity rules are applied, unnecessary groups are removed, single argument `Add` are simplified                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `canonical-boolean`  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `canonical-divide`   | Division by 1 is simplified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `canonical-domain`   | Simplify some `Range` and `Interval` expressions to corresponding constants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `canonical-multiply` | Multiplication by \\( 1 \\) or \\( -1 \\) is simplified. Square roots are grouped. Negative constant is pulled first.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `canonical-list`     | In `List`, `Sequence`, simplify `Identity`. Flattens `Sequence` .                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `canonical-number`   | Complex numbers with no imaginary components are simplified to a real number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `canonical-power`    | <ul><li>\\[x^{\tilde\infty} \longrightarrow \operatorname{NaN}\\]</li><li>\\[x^0 \longrightarrow 1\\]</li><li>\\[x^1 \longrightarrow x\\]</li><li>\\[(\pm 1)^{-1} \longrightarrow -1\\]</li><li>\\[(\pm\infty)^{-1} \longrightarrow 0\\]</li><li>\\[0^{\infty} \longrightarrow \tilde\infty\\]</li><li>\\[(\pm 1)^{\pm \infty} \longrightarrow \operatorname{NaN}\\]</li><li>\\[\infty^{\infty} \longrightarrow \infty\\]</li><li>\\[\infty^{-\infty} \longrightarrow 0\\]</li><li>\\[(-\infty)^{\pm \infty} \longrightarrow \operatorname{NaN}\\]</li></ul> |
| `canonical-root`     | `Power` \\( \longrightarrow \\) `Root` and `Sqrt` or simplified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `canonical-set`      | Simplify set expressions by sorting arguments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `canonical-subtract` | `Subtract` \\( \longrightarrow \\) `Add` and `Negate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `flatten`            | Associative functions are combined, e.g. \\( f(f(a, b), c) \longrightarrow f(a, b, c) \\)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `json`               | Only transformations necessary to make the expression valid JSON, for example making sure that `Infinity` and `NaN` are represented as strings                                                                                                                                                                                                                                                                                                                                                                                                               |
| `object-literal`     | Each term of the expression is expressed as an object literal: no shorthand representation is used. For example, the number \\( 4\\) is represented as `{ num: "4" }` not as `4`.                                                                                                                                                                                                                                                                                                                                                                            |
| `sorted`             | The arguments of commutative functions are sorted such that: <ul><li> numbers are first, sorted numerically </li><li> complex numbers are next, sorted numerically by imaginary value </li><li> symbols are next, sorted lexicographically </li><li> `add` functions are next </li><li> `multiply` functions are next </li><li> `power` functions are next, sorted by their first argument, then by their second argument </li><li> other functions follow, sorted lexicographically</li></ul>                                                               |
| `stripped-metadata`  | Any metadata associated with elements of the expression is removed, for example associated `wikidata`, `comment` or `latex` properties                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sum-product`        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

</div>

## Applying Custom Rules

To define and apply your own custom rewriting rules use patterns, rules and the
`ce.replace()` function.

{% readmore "/compute-engine/guides/patterns-and-rules/" %} Read more about
<strong>Patterns and Rules</strong> {% endreadmore %}
