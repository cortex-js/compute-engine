---
title: Symbolic Computing
permalink: /compute-engine/guides/symbolic-computing/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
preamble:
  '<h1>Symbolic Computing</h1><p class="xl">The CortexJS Compute Engine essentially performs computation by applying
rewriting rules to a MathJSON expression.</p>'
head:
  stylesheets:
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.11/codemirror.min.css
  scripts:
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.11/codemirror.min.js
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.11/mode/javascript/javascript.min.js
    - https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.11/mode/xml/xml.min.js
  modules:
    - /assets/js/code-playground.min.js
    - //unpkg.com/@cortex-js/compute-engine?module
  moduleMap: |
    window.moduleMap = {
    "mathlive": "//unpkg.com/mathlive?module",
    // "mathlive": "/js/mathlive.mjs",
    "html-to-image": "///assets/js/html-to-image.js",
    "compute-engine": "//unpkg.com/@cortex-js/compute-engine?module"
    };
---

**Note:** To use the Compute Engine you must write JavaScript or TypeScript
code. This guide assumes you are familiar with one of these programming
languages.{.notice--info}

**Note:** In this guide, functions such as `ce.box()` and `ce.parse()` require a
`ComputeEngine` instance which is denoted by a `ce.` prefix.<br>Functions that
apply to a boxed expression, such as `expr.simplify()` are denoted with a
`expr.` prefix.{.notice--info}

<script type="module">
  window.addEventListener("DOMContentLoaded", () => 
    import("//unpkg.com/@cortex-js/compute-engine?module").then((ComputeEngine) => {
      globalThis.ce = new ComputeEngine.ComputeEngine();
      const playgrounds = [...document.querySelectorAll("code-playground")];
      for (const playground of playgrounds) {
        playground.autorun = 1000; // delay in ms
        playground.run();
      }
    })
);
</script>


There are three common transformations that can be applied to an expression:

<div class=symbols-table>

| Transformation    |                                                                                                                                                                        |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expr.simplify()` | Eliminate constants and common sub-expressions. Use available assumptions to determine which rules are applicable. Limit calculations to exact results using integers. |
| `expr.evaluate()` | Calculate the exact value of an expression. Replace symbols with their value. Perform exact calculations using integers.                                               |
| `expr.N()`        | Calculate a numeric approximation of an expression using floating point numbers.                                                                                       |

</div>

<div class="first-column-header">

|                               |           `expr.simplify()`           |           `expr.evaluate()`           |              `expr.N()`               |
| :---------------------------- | :-----------------------------------: | :-----------------------------------: | :-----------------------------------: |
| Exact calculations            | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} |                                       |
| Use assumptions on symbols    | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} |
| Floating-point approximations |                                       |                                       | {% icon "circle-check" "green-700" %} |

</div>

For example, if `f` is \\( 2 + (\sqrt{4x^2} + 1) \\) and `x` is \\( \pi \\):

```javascript
const f = ce.parse('2 + (\\sqrt{4x^2} + 1)');
ce.assign('x', 'Pi');
console.log(f.simplify().latex); // 2\sqrt{x}+3
console.log(f.evaluate().latex); // 2\sqrt{\pi}+3
console.log(f.N().latex); // 9.283\,185\,307\ldots
```

<div class="symbols-table first-column-header">

|                |                                |                                                              |
| :------------- | :----------------------------- | :----------------------------------------------------------- |
| `f.simplify()` | \\[ \sqrt{x}+3 \\]             | Exact calculations of some integer constants, simplification |
| `f.evaluate()` | \\[ \sqrt{\\pi}+3 \\]          | Evaluation of symbols                                        |
| `f.N()`        | \\[ 9.283\,185\,307 \ldots \\] | Evaluation of constants                                      |

</div>

{% readmore "/compute-engine/guides/simplify/" %} Read more about
<strong>Simplify</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/evaluate/" %} Read more about
<strong>Evaluate</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/numeric-evaluation/" %} Read more about
<strong>Numerical Evaluation</strong> {% endreadmore %}

Other operations can be performed on an expression: comparing it to a pattern,
replacing part of it, and applying conditional rewrite rules.

<code-playground layout="stack" show-line-numbers autorun="never">
<div slot="javascript">const expr = ce.parse('3x^2 + 2x^2 + x + 5');
console.log(expr.latex, '=', expr.simplify().latex);</div>
</code-playground>




## Comparing Expressions

There are two useful ways to compare symbolic expressions:

- structural equality
- mathematical equality

### Structural Equality: `isSame()`

Structural equality (or syntactic equality) considers the **symbolic structure** used
to represent an expression. 

The symbolic structure of an expression is the tree of symbols and functions
that make up the expression.

For example, the symbolic structure of \\(2 + 1\\) is a sum of two terms, 
the first term is the number `2` and the second term is the number `1`.

The symbolic structure of \\(3\\) is a number `3`.

The symbolic structure of \\(2 + 1\\) and \\(3\\) are different, even though
they represent the same mathematical object.

The `lhs.isSame(rhs)` function returns true if `lhs` and `rhs` are structurally
exactly identical, that is each sub-expression is recursively identical in `lhs`
and `rhs`.

- \\(1 + 1 \\) and \\( 2 \\) are not structurally equal, one is a sum of two
  integers, the other is an integer
- \\( (x + 1)^2 \\) and \\( x^2 + 2x + 1 \\) are not structural equal, one is a
  power of a sum, the other a sum of terms.


<code-playground layout="stack" show-line-numbers autorun="never">
<div slot="javascript">
const a = ce.parse('2 + 1');
const b = ce.parse('3');
console.log('isSame?', a.isSame(b));</div>
</code-playground>


By default, when parsing or boxing an expression, they are put in canonical
form. For example, fractions are automatically reduced to their simplest form,
and arguments are sorted in a standard way.

The expressions \\( \\frac{1}{10} \\) and \\( \\frac{2}{20} \\) are
structurally equal because they get put into a canonical form when parsed,
in which the fractions are reduced.

Similarly, \\( x^2 - 3x + 4 \\) and \\( 4 - 3x + x^2 \\) are structurally equal
(`isSame` returns true) because the arguments of the sum are sorted in a standard 
way.

**To compare two expressions without canonicalizing them**, parse or box 
them with the `canonical` option set to `false`.

<code-playground layout="stack" show-line-numbers autorun="never" mark-javascript-line="5-6">
<div slot="javascript">
const a = ce.parse('\\frac{1}{10}');
const b = ce.parse('\\frac{2}{20}');
console.log('Canonical isSame?', a.isSame(b));
//
const aPrime = ce.parse('\\frac{1}{10}', {canonical: false});
const bPrime = ce.parse('\\frac{2}{20}', {canonical: false});
console.log('Non-canonical isSame?', aPrime.isSame(bPrime));</div>
</code-playground>



### Mathematical Equality: `isEqual()`

It turns out that comparing two arbitrary mathematical expressions is a complex
problem. 

In fact, [Richardson's Theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)
proves that it is impossible to determine if two symbolic expressions are
identical in general.

However, there are many cases where it is possible to make a comparison between
two expressions to check if they represent the same mathematical object.

The `lhs.isEqual(rhs)` function return true if `lhs` and `rhs` represent the
same mathematical object. 

If `lhs` and `rhs` are numeric expressions, they are evaluated before being 
compared. They are considered equal if the absolute value of the difference 
between them is less than `ce.tolerance`.

The expressions \\( x^2 - 3x + 4 \\) and \\( 4 - 3x + x^2 \\) will be considered
equal (`isEqual` returns true) because the difference between them is zero, 
i.e. \\( (x^2 - 3x + 4) - (4 - 3x + x^2) \\) is zero once the expression has 
been simplified.

Note that unlike `expr.isSame()`, `expr.isEqual()` can return `true`, `false` or
`undefined`. The latter value indicates that there is not enough information to
determine if the two expressions are mathematically equal. Adding some
assumptions may result in a different answer.

<code-playground layout="stack" show-line-numbers autorun="never">
<div slot="javascript">
const a = ce.parse('1 + 2');
const b = ce.parse('3');
console.log('isEqual?', a.isEqual(b));</div>
</code-playground>



### Other Comparisons

<div class=symbols-table>

|                                          |                                        |
| :--------------------------------------- | :------------------------------------- |
| `lhs === rhs`                            | If true, same box expression instances |
| `lhs.isSame(rhs)`                        | Structural equality                    |
| `lhs.isEqual(rhs)`                       | Mathematical equality                  |
| `lhs.match(rhs) !== null`                | Pattern match                          |
| `lhs.is(rhs)`                            | Synonym for `isSame()`                 |
| `ce.box(["Equal", lhs, rhs]).evaluate()` | Synonym for `isEqual()`                |
| `ce.box(["Same", lhs, rhs]).evaluate()`  | Synonym for `isSame()`                 |

</div>

## Replacing a Symbol in an Expresssion

**To replace a symbol in an expression** use the `subs()` function.

The argument of the `subs()` function is an object literal. Each key value pairs
is an identifier and the value to be substituted with. The value can be either a
number or a boxed expression.

<code-playground layout="stack" show-line-numbers autorun="never" mark-javascript-line="4">
<div slot="javascript">
let expr = ce.parse('\\sqrt{\\frac{1}{x+1}}');
console.log(expr.json);
//
expr = expr.subs({x: 3});
//
console.log("Substitute x -> 3\n", expr.json);
console.log("Numerical Evaluation:", expr.N().latex);</div>
</code-playground>

## Other Symbolic Manipulation

There are a number of operations that can be performed on an expression:

- creating an expression from a raw MathJSON expression or from a LaTeX string
- simplifying an expression
- evaluating an expression
- applying a substitution to an expression
- applying conditional rewrite rules to an expression
- checking if an expression matches a pattern
- checking if an expression is a number, a symbol, a function, etc...
- checking if an expression is zero, positive, negative, etc...
- checking if an expression is an integer, a rational, etc...
- and more...

We've introduced some of these operations in this guide, but there are many more
that are available.

{% readmore "/compute-engine/guides/expressions/" %} Read more about
<strong>Expressions</strong>, their properties and methods {% endreadmore %}

You can check if an expression match a pattern, apply a substitution to some
elements in an expression or apply conditional rewriting rules to an expression.

{% readmore "/compute-engine/guides/patterns-and-rules/" %} Read more about
<strong>Patterns and Rules</strong> for these operations {% endreadmore %}
