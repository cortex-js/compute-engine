---
title: Linear Algebra
permalink: /compute-engine/reference/linear-algebra/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
---

[Linear algebra](https://en.wikipedia.org/wiki/Linear_algebra) is the branch of 
mathematics that studies vector spaces and linear transformations between them like adding and scaling. It uses matrixes to represent
linear maps. Linear algebra is
widely used in science and engineering. 

{% latex "\\begin{bmatrix} 1 & 3 \\\\ 5 & 0 \\end{bmatrix}" %}

In the Compute Engine, vectors are represented as lists and matrices are 
represented as lists of lists.


For example the matrix above is represented as the following list of lists:

```json
["List", ["List", 1, 3, ["List", 5, 0]]
```


The Compute Engine provides a number of functions for working with matrices.




## Constructing a Matrix


## Matrix Styling

{% def "Matrix" %}

[&quot;**Matrix**&quot;, _matrix_]{.signature}

[&quot;**Matrix**&quot;, _matrix_, _delimiters_, _columns-format_]{.signature}

`Matrix` is an inert function (its value is the value of its first argument) 
that is used to influence the visual representation of a matrix.

_matrix_ is a matrix represented by a list of rows. Each row is represented by a list of elements.

_delimiters_ is an optional string of two characters. 
The first character represent the opening delimiter and the second character represents the closing delimiter.

The delimiters can be any of the following characters: 
  - `(`, `)`, `[`, `]`, `{`, `}`, `<`, `>`
  - `⟦` (`U+27E6`), `⟧` (`U+27E7`)
  - `|`, `‖` (`U+2016`)
  - `\\`
  - `⌈` (`U+2308`), `⌉` (`U+2309`), `⌊` (`U+230A`), `⌋` (`U+230B`)
  - `⌜` (`U+231C`), `⌝` `(U+231D`), `⌞` (`U+231E`), `⌟` (`U+231F`)
  - `⎰` (`U+23B0`), `⎱` (`U+23B1`). 

In addition, the character `.` can be used to indicate no delimiter.

Some commom combinations may be represented using some 
standard LaTeX environments:

| Delimiters | LaTeX Environment | Example |
| :-- | :-- | :-- |
| `()` | `pmatrix` | \\[ \begin{pmatrix} a & b \\\\ c & d \end{pmatrix} \\] |
| `[]` | `bmatrix` | \\[ \begin{bmatrix} a & b \\\\ c & d \end{bmatrix} \\] |
| `{}` | `Bmatrix` | \\[ \begin{Bmatrix} a & b \\\\ c & d \end{Bmatrix} \\] |
| `||` | `vmatrix` | \\[ \begin{vmatrix} a & b \\\\ c & d \end{vmatrix} \\] |
| `‖‖` | `Vmatrix` | \\[ \begin{Vmatrix} a & b \\\\ c & d \end{Vmatrix} \\] |
| `{.` | `dcases` | \\[ \begin{dcases} a & b \\\\ c & d \end{dcases} \\] |
| `.}` | `rcases` | \\[ \begin{rcases} a & b \\\\ c & d \end{rcases} \\] |

_columns_format_ is an optional string indicating the format of each column. A character `=` indicates a centered column, `<` indicates a left-aligned column, and `>` indicates a right-aligned column. 

A character of `|` indicate a solid line between two
columns and `:` indicate a dashed lines between two columns.

{% enddef %}

