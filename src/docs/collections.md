---
title: Collections
permalink: /guides/compute-engine/collections/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script defer type='module'>
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

# Collections

## `Sequence`

The most primitive collection: a series of expressions. They can be optionally
separated by a separator such as `,` or `;`.

| MathJSON                             | LaTeX            |
| :----------------------------------- | :--------------- |
| `["Sequence", "x", "y"]`             | \\( x, y \\)     |
| `["Sequence", ["Add", "x", 1], "y"]` | \\( x + 1, y \\) |

## `Set`

An unordered collection of unique elements.

| MathJSON            | LaTeX                       |
| :------------------ | :-------------------------- |
| `["Set", "x", "y"]` | \\( \lbrack x, y\rbrack \\) |

## `List`

An ordered collection of elements.

Use to represent a data structure, as opposed to `Parentheses` or `Sequence`.

| MathJSON                        | LaTeX               |
| :------------------------------ | :------------------ |
| `["List", "x", "y", "7", "11"]` | \\([x, y, 7, 11]\\) |
| `["List", "x", "Nothing", "y"]` | \\([x,,y]\\)        |

## `Parentheses`

One or more expressions in a sequence, enclosed with parentheses.

Use to represent function arguments, or to group arithmetic expressions.

| MathJSON                                                         | LaTeX           |
| :--------------------------------------------------------------- | :-------------- |
| `["Parentheses", "x", "y", "7", "11"]`                           | `(x, y, 7, 11)` |
| `["Parentheses"]`                                                | `()`            |
| `["Parentheses", "a", "b", "c"]`                                 | `(a, b, c)`     |
| `["Parentheses", ["Sequence, "a", "b"], ["Sequence", "c", "d"]]` | `(a, b; c, d)`  |
| `["Sequence", "a", ["Parentheses", "b", "c"]]`                   | `a, (b, c)`     |
