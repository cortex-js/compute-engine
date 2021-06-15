---
title: Symbolic Computing
permalink: /guides/compute-engine/symbolic-computing/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({ 
      renderAccessibleContent: false,
      TeX: { 
        delimiters: {
          inline: [['\\(', '\\)']],
          display: [ ['$$', '$$'], ['\\[', '\\]']],
        },
        processEnvironments : false 
      },
      asciiMath: null,
    });
</script>

# Symbolic Computing

The CortexJS Compute Engine essentially applies transformations to a MathJSON
expression that results in another MathJSON expression.

There are several ways to apply transformations, depending on the desired
result:

- Format
- Simplify
- Evaluate
- Compare, find patterns and substitute

## Format with a Canonical Form

The canonical form of an expression is obtained by rewriting an expression
without making assumptions about any variables in the expression.

For example:

- terms can be rearranged to be in a specific order
- some operations may be replaced with more elementary ones, for example
  substraction replaced by addition. \\(1 + 2 - 3 \longrightarrow Add(1, 2,
  -3)\\)
- some integer values may be replaced by their computed value, for example
  \\(1 + 2 \longrightarrow 3\\).

Canonical forms may be useful to compare some expressions, for example \\( 1 + x
\\) and \\(x + 1\\) are different expressions, but they have the same canonical
form.

Canonical forms are somewhat arbitrary, and not necessarily "the simplest" way
to represent an expression. But just like the order of the letters of the
alphabet is arbitrary, the canonical forms are nonetheless convenient to sort,
search and compare expressions.

**To obtain the canonical form of an expression**, use the
`ComputeEngine.canonical()` function.

```js
console.log(ce.canonical(["Add", 2, "x", 3]);
// ➔ ["Add", 2, 3, "x"]
```

Learn more about [Canonical Forms](/guides/compute-engine/forms/).

## Simplify

**To obtain a simpler form of a symbolic expression**, use the
`ComputeEngine.simplify()` function.

Assumptions are additional information available about some symbols, for example
\\( x > 0 \\) or \\(n \in \\N\\). To apply some transformations, available
assumptions may be used. For example, if no assumptions about \\(x \\) is
available the expression \\( \sqrt{x^2} \\) cannot be simplified. However, if an
assumption that \\( x > 0 \\) is available, then the expression can be
simplified to \\( x \\).

Read more about [assumptions](/guides/compute-engine/assumptions),
.{.notice--info}


## Evaluate

**To combine a symbolic simplification followed by a [numerical evaluation](/guides/compute-engine/numerical-evaluation)**, use
the `ComputeEngine.evaluate()`.

Invoking the `evaluate()` function is roughly equivalent to calling in sequence
`simplify()`, `N()` then `format()`.

Some functions may perform additional computations when `evaluate()` is 
invoked.

## Comparing, Pattern Matching and Substitution

