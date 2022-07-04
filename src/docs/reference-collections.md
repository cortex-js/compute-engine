---
title: Collections
permalink: /compute-engine/reference/collections/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---
## `Sequence`

The most primitive collection: a series of expressions.

| MathJSON                             | LaTeX            |
| :----------------------------------- | :--------------- |
| `["Sequence", 1, 2]`             | \\( 1 2 \\)     |
| `["Sequence", ["Add", "x", 1], "y"]` | \\( x + 1 y \\) |


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

## `Delimiter`

One or more expressions in a sequence, enclosed with some delimiters and
separated by a separator

Use to represent function arguments and to group arithmetic expressions.

| MathJSON                                                         | LaTeX           |
| :--------------------------------------------------------------- | :-------------- |
| `["Parentheses", ["Sequence", "x", "y", "7", "11"]`              | `(x, y, 7, 11)` |
| `["Delimiter"]`                                                  | `()`            |
| `["Delimiter", "a", "b", "c"]`                                 | `(a, b, c)`     |
