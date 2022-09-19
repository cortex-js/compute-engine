---
title: Symbolic Computing
permalink: /compute-engine/guides/symbolic-computing/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
head:
  stylesheets:
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.8/codemirror.min.css
  scripts:
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.8/codemirror.min.js
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.8/mode/javascript/javascript.min.js
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.8/mode/xml/xml.min.js
  modules:
    - /assets/js/code-playground.min.js
    - //unpkg.com/@cortex-js/compute-engine?module
---
<script>
moduleMap = {
  "compute-engine": "//unpkg.com/@cortex-js/compute-engine?module",
};
// const ce = 
</script>

The CortexJS Compute Engine essentially performs computation by applying
rewriting rules to a MathJSON expression.

In this documentation, functions such as `ce.box()` and `ce.parse()` require 
a `ComputeEngine` instance which is denoted by a `ce.` prefix.<br>Functions 
that apply to a boxed expression, such as `expr.simplify()` are denoted with a 
`expr.` prefix.{.notice--info}

There are four common transformations that can be applied to an expression:

<div class=symbols-table>

| Transformation    |                                                                                                                                                                        |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expr.canonical`  | Put an expression in canonical ("standard") form, for easier sorting, comparing and computing.                                                                         |
| `expr.simplify()` | Eliminate constants and common sub-expressions. Use available assumptions to determine which rules are applicable. Limit calculations to exact results using integers. |
| `expr.evaluate()` | Calculate the value of an expression. Replace symbols with their value. Perform exact calculations using integers.                                                     |
| `expr.N()`        | Calculate a numeric approximation of an expression using floating point numbers.                                                                                       |

</div>



<div class="">

|                               | `expr.canonical` | `expr.simplify()` | `expr.evaluate()` |  `expr.N()`  |
| :---------------------------- | :----------: | :------: | :------: | :-: |
| Exact calculations            | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} |   |
| Use assumptions on symbols    |              |    {% icon "circle-check" "green-700" %}    |    {% icon "circle-check" "green-700" %}    | {% icon "circle-check" "green-700" %}  |
| Floating-point approximations |              |          |          | {% icon "circle-check" "green-700" %}  |

</div>

For example, if `f` is \\( 2 + (\sqrt{x^2 \times 4} + 1) \\) and `x` is 3:

<div class=symbols-table>

|                |                             |                                                              |
| :------------- | :-------------------------- | :----------------------------------------------------------- |
| `f.canonical`  | \\[ 1 + 2 + \sqrt{4x^2} \\] | Arguments sorted, distributed                                |
| `f.simplify()` | \\[ 2 + 2x \\]              | Exact calculations of some integer constants, simplification |
| `f.evaluate()` | \\[ 8 \\]                   | Evaluation of symbols                                        |

</div>

When `ce.numericFormat` is `"machine"`, `expr.evaluate()` behaves
as `expr.simplify()`: only calculations on "small integers" are performed.
What is a small integer, it's an integer less than 10<sup>6</sup>. This is 
to ensure that the product of two of those integers would not cause any loss
in precision, since a machine number has about 15 digits of precision.

To ensure that all integer calculations are performed when using `expr.evaluate()`
make sure that `ce.numericFormat` is `auto` or `decimal`.


{% readmore "/compute-engine/guides/canonical-form/" %} Read more about the
<strong>Canonical Form</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/simplify/" %} Read more about
<strong>Simplify</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/evaluate/" %} Read more about
<strong>Evaluate</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/numeric-evaluation/" %} Read more about
<strong>Numerical Evaluation</strong> {% endreadmore %}

Other operations can be performed on an expression: comparing it to a pattern,
replacing part of it, and applying conditional rewrite rules.


<code-playground layout="stack" show-line-numbers>
<div slot="javascript">import { ComputeEngine } from 'compute-engine';
const ce = new ComputeEngine();
console.log(ce.parse('3x^2 + 2x^2 + x + 5').simplify().latex);</div>
</code-playground>


## Comparing Expressions

There are two useful ways to compare symbolic expressions:

- structural equality
- mathematical equality

### Structural Equality: `isSame()`

Structural equality (or syntactic equality) consider the symbolic structure used
to represent an expression. If a symbol, is it the same symbol, if a function,
does it have the same head, and are each arguments structurally equal, etc...

The `lhs.isSame(rhs)` function return true if `lhs` and `rhs` are structurally
exactly identical, that is each sub-expression is recursively identical in `lhs`
and `rhs`.

- \\(1 + 1 \\) and \\( 2 \\) are not structurally equal, one is a sum of two
  integers, the other is an integer
- \\(x + 1 \\) and \\( 1 + x \\) are not structurally equal, the order of the
  arguments is different
- \\( (x + 1)^2 \\) and \\( x^2 + 2x + 1 \\) are not structural equal, one is a
  power of a sum, the other a sum of terms.

For a less strict version of `isSame()`, you can use the canonical version of
both expressions, that is `lhs.canonical.isSame(rhs.canonical)`. In this case,
because the arguments are ordered in a standard way, the canonical form of \\(
x + 1 \\) and the canonical form of \\(1 + x \\) would be the same. However, \\(
(x + 1)^2 \\) and \\( x^2 + 2x + 1 \\) would still be considered different.

### Mathematical Equality: `isEqual()`

It turns out that comparing two arbitrary mathematical expressions is a complex
problem. In fact,
[Richardson's Theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)
proves that it is impossible to determine if two symbolic expressions are
identical in general.

However, there are many cases where it is possible to make a comparison between
two expressions to check if they represent the same mathematical object.

The `lhs.isEqual(rhs)` function return true if `lhs` and `rhs` represent the
same mathematical object. If `lhs` and `rhs` are numeric expressions, they are
evaluated before being compared. They are considered equal if the absolute value
of the difference between them is less than `ce.tolerance`.

Note that unlike `expr.isSame()`, `expr.isEqual()` can return `true`, `false` or
`undefined`. The latter value indicates that there is not enough information to
determine if the two expressions are mathematically equal. Adding some
assumptions may result in a different answer.

### Other Comparisons

<div class=symbols-table>

|                                          |                                        |
| :--------------------------------------- | :------------------------------------- |
| `lhs === rhs`                            | If true, same box expression instances |
| `lhs.isSame(rhs)`                        | Structural equality                    |
| `lhs.isEqual(rhs)`                       | Mathematical equality                  |
| `lhs.match(rhs) !== null`                | Pattern match                          |
| `lhs.is(rhs)`                            | Synonym for `isSame()`                 |
| `ce.box(['Equal', lhs, rhs]).evaluate()` | Synonym for `isEqual()`                |
| `ce.box(['Same', lhs, rhs]).evaluate()`  | Synonym for `isSame()`                 |

</div>


## Replacing a Symbol in an Expresssion

**To replace a symbol in an expression** use the `subs()` function.

The argument of the `subs()` function is an object literal. Each key value
pairs represent the name of a symbol and the value (as an expression) to be
substituted with.



<code-playground layout="stack" show-line-numbers mark-line="7">
<div slot="javascript">import { ComputeEngine } from 'compute-engine';
const ce = new ComputeEngine();
//
let expr = ce.parse('\\sqrt{\\frac{1}{x+1}}');
console.log(expr.json);
//
expr = expr.subs({x: ce.box(3)});
//
console.log("Substitute x -> 3\t", expr.json);
console.log("Numerical Evaluation\t", expr.N().latex);</div>
</code-playground>




## Other Symbolic Manipulation

An expression can be created from MathJSON or LaTeX, simplified, or evaluated.
An expression has many properties, such as `isZero`, `domain` or `symbol`.

{% readmore "/compute-engine/guides/expressions/" %} Read more about
<strong>Expressions</strong>, their properties and methods {% endreadmore %}

You can check if an expression match a pattern, apply a substitution to some
elements in an expression or apply conditional rewriting rules to an expression.

{% readmore "/compute-engine/guides/patterns-and-rules/" %} Read more about
<strong>Patterns and Rules</strong> for these operations {% endreadmore %}
