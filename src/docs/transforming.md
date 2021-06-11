---
title: Transforming
permalink: /guides/compute-engine/transforming/
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

# Transforming an Expression

The CortexJS Compute Engine essentially applies transformations to a MathJSON
expression that results in another MathJSON expression.

There are several ways to apply transformations, depending on the desired
result:

## Canonical Forms

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
`ComputeEngine.format()` function.

```js
ComputeEngine.format(expr);
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

The result of `ComputeEngine.simplify()` may be further simplified by calling `

Read more about [assumptions](/guides/compute-engine/assumptions),
.{.notice--info}

## Numerical Evaluation

**To obtain a numerical approximation of the value of an expression**, use the
`ComputeEngine.N()` function.

- Due to limitations in the representation of numbers, some arithmetic
  operations cannot produce exact results. For example, \\(\frac{1}{3} \approx
  1.333333333\\). Because the machine representation of floating points is using
  a binary format (and not the base-10 we are used to), the results may
  sometimes be surprising. For example, \\(0.1 + 0.2 = 0.30000000000000004 \\).
- No rewriting of the expression is done before attempting to evaluate it.
  Because of the limitations on the representation of numbers, the result may
  again be surprising, for example \\( x - x = 2.7755575615628914\cdot 10^{-17}\\)
   when \\( x = 0.1 + 0.2\\). The result from `ComputeEngine.simplify()` would
  be \\( 0 \\).

## Evaluation

**To combine a symbolic simplification followed by a numeric evaluation**, use
the `ComputeEngine.evaluate()`.

Invoking the `evaluate()` function is roughly equivalent to calling in sequence
`simplify()`, `N()` then `format()`.

Some functions may perform additional computations when `evaluate()` is 
invoked.
