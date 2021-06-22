---
title: Canonical Forms
permalink: /guides/compute-engine/forms/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {  renderMathInDocument } 
      from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({
      TeX: {
        delimiters: {
          inline: [ ['$', '$'], ['\\(', '\\)']],
          display: [['$$', '$$'],['\\[', '\\]']],
        },
      },
      asciiMath: null,
      processEnvironments : false,
      renderAccessibleContent: false,
    });
</script>

# Canonical Forms

A mathematical expression has many equivalent representations. 

For example, the expressions in each row below represent the same mathematical 
object:

| | | | 
| :-- | :-- | :-- |
| \\[ 215.3465 \\]  | \\[ 2.15346\\mathrm{e}2 \\]    | \\[  2.15346 \\times 10^2\\]|
| \\[ 1 - x \\]     | \\[-x + 1 \\]        | \\[  1 + (-x)\\]|
| \\[ -2x^{-1}\\]   | \\[ -\frac{2}{x} \\] |  \\[ \frac{-2}{x} \\]| 

By applying some conventions &mdash; for example wether to write constants before 
or after variables in a sum, how to sort variables and functions when they are an argument in a commutative function &mdash; we define a **canonical**
representation. 

A canonical representation is somewhat arbitrary, but using it consistently
can make some operations easier, for example, comparing two expressions for
equality.

The canonical form used by the Compute Engine has been selected to follow 
common (but by no mean universal) conventions in writing mathematical 
expressions, as well as expressing them in a way that can optimize their computation.

**To obtain the canonical representation of an expression**, use the 
`ce.canonical()` function.

Applying a canonical form is applying some rewriting rules to an expression.
In that sense, it is similar to simplifying an expression with 
`ce.simplify()`, but it is more conservative in which transformations
it will consider, and it will not take into account any assumptions about 
symbols.


The default canonical representation applies a series of transformation to 
put sums, products, numbers, roots, etc... in canonical form. Each of
these steps/format can also be applied separately for more control over the result.

The list of available formats is listed below.


<div class=symbols-table>

| Form | Description |
| :--- | :--- |
| `canonical` | Apply the following transformations, in order: <ul><li> `canonical-number`</li><li>`canonical-exp`</li><li>`canonical-root`</li><li>`canonical-subtract`</li><li>`canonical-divide`</li><li>`canonical-power`</li><li>`canonical-multiply`</li><li>`canonical-negate`</li><li>`canonical-add`</li><li>`flatten`</li><li>`canonical-list`</li><li>`canonical-domain`</li><li>`canonical-rational`</li><li>`canonical-constants`</li><li>`sorted`</li><li>`json`</li></ul>|
| `canonical-add` | Addition of 0 is simplified, associativity rules are applied, unnecessary groups are removed, single argument `Add` are simplified |
| `canonical-boolean` ||
| `canonical-constants` | Simplify some arithmetic and trigonometric constants: \\( \frac{1}{2}, \frac{\pi}{4}, \ldots \\) |
| `canonical-divide` | Division by 1 is simplified |
| `canonical-domain` | |
| `canonical-exp` | `["Power", "ExponentialE", "x"]` \\( \longrightarrow \\) `["Exp", "x"` |
| `canonical-multiply` | Multiplication by \\( 1 \\)  or \\( -1 \\) is simplified. Square roots are grouped. Negative constant is pulled first. |
| `canonical-negate` | `Negate` of a number \\( \longrightarrow \\) the negative of the number. Negation of negation is simplified |
| `canonical-list` | In `List`, `Sequence` and `Sequence2`, simplify `Identity`. Flattens `Sequence` and `Sequence2`. | 
| `canonical-number` | Complex numbers with no imaginary components are simplified |
| `canonical-power` | <ul><li>\\[x^{\tilde\infty} \longrightarrow \operatorname{NaN}\\]</li><li>\\[x^0 \longrightarrow 1\\]</li><li>\\[x^1 \longrightarrow x\\]</li><li>\\[(\pm 1)^{-1} \longrightarrow -1\\]</li><li>\\[(\pm\infty)^{-1} \longrightarrow 0\\]</li><li>\\[0^{\infty} \longrightarrow \tilde\infty\\]</li><li>\\[(\pm 1)^{\pm \infty} \longrightarrow \operatorname{NaN}\\]</li><li>\\[\infty^{\infty} \longrightarrow \infty\\]</li><li>\\[\infty^{-\infty} \longrightarrow 0\\]</li><li>\\[(-\infty)^{\pm \infty} \longrightarrow \operatorname{NaN}\\]</li></ul> |
| `canonical-root` | `Power` \\( \longrightarrow \\) `Root` and `Sqrt` or simplified|
| `canonical-subtract` | `Subtract` \\( \longrightarrow \\) `Add` and `Negate` |
| `flatten` | Associative functions are combined, e.g. \\( f(f(a, b), c) \longrightarrow f(a, b, c) \\) |
| `json` | Only transformations necessary to make the expression valid JSON, for example making sure that `Infinity` and `NaN` are represented as strings|
| `object-literal` | Each term of the expression is expressed as an object literal: no shorthand representation is used. For example, the number \\( 4\\) is represented as `{ num: "4" }` not as `4`.|
| `sorted` | The arguments of commutative functions are sorted such that: <ul><li> numbers are first, sorted numerically </li><li> complex numbers are next, sorted numerically by imaginary value </li><li> symbols are next, sorted lexicographically </li><li> `add` functions are next </li><li> `multiply` functions are next </li><li> `power` functions are next, sorted by their first argument, then by their second argument </li><li> other functions follow, sorted lexicographically</li></ul>|
| `stripped-metadata` | Any metadata associated with elements of the expression is removed, for example associated `wikidata`, `comment` or `latex` properties |
| `sum-product` | | 

</div>





**To transform an expression using the rules for a particular form**, use the
`format()` function.

```js
import { format } from '@cortex-js/compute-engine'

console.log(format(["Add", 2, "x", 3], 'canonical');
// ➔ ["Add", 2, 3, "x"]
```

## `BaseForm`

`["BaseForm", _value_, _base_]`

Format a _value_ in a specific _base_, such as hexadecimal or binary.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

```json
["Latex", ["BaseForm", 42, 16]]
// ➔ (\mathtt(2a))_{16}
```

```cortex
Latex(BaseForm(42, 16))
// ➔ (\mathtt(2a))_{16}
String(BaseForm(42, 16))
// ➔ "'0x2a'"
```


## Applying Custom  Rules

You can define and apply your own custom rewriting rules using patterns,
rules and the `ce.replace()` function.

<div class='read-more'><a href="/guides/compute-engine/patterns-and-rules/">Read more about <strong>Patterns and Rules</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>
