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

{% readmore "/compute-engine/reference/collections/" %}Since vectors,
matrixes and tensors are `List` collections, some **collection operations**
can also be applied to them such as `At`, `Fold` and `Map`. {% endreadmore %}


The Compute Engine provides a number of functions for working with matrices.





{% def "Vector" %}

[&quot;**Vector**&quot;, _x-1_, ..._x-2_]{.signature}

`Vector` interprets the elements _x-1_... as a column vector

This is essentially a shortcut for `["Matrix", ["List", ["List", _x-1_], ["List, _x-2_], ...]]]`.

```json
["Vector", 1, 3, 5, 0]
```

{% latex "\\begin{pmatrix} 1 \\\\ 3 \\\\ 5 \\\\ 0 \\end{pmatrix}" %}


{% enddef %}


## Information About Tensors

{% def "Shape" %}

[&quot;**Shape**&quot;, _tensor_]{.signature}

Returns the shape of a tensor, a tuple of the lengths of the
tensor along each of its axis.

A list (or vector) has a single axis. A matrix has two axes. A tensor has more
than two axes.

A scalar has no dimension and `Shape` returns an empty tuple.

```json example
["Shape", 5]
// ➔ []

["Shape", ["List", 5, 2, 10, 18]]
// ➔ [4]

["Shape", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// ➔ [2, 4]
```

{% enddef %}

{% def "Rank" %}

[&quot;**Rank**&quot;, _collection_]{.signature}

Returns the number of dimensions of the collection, that is the number of its
axes.

A scalar (number) has rank 0, a vector or list has rank 1, a matrix has rank 2,
a tensor has rank 3, etc.

```json example
["Rank", 5]
// ➔ 0

["Rank", ["List", 5, 2, 10, 18]]
// ➔ 1

["Rank", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// ➔ 2
```

{% enddef %}




## Transforming Tensors

{% def "Flatten" %}

[&quot;**Flatten**&quot;, _collection_]{.signature}

Returns a list of all the elements of the collection, recursively.

Only elements with the same head as the collection are flattened.

For a matrix, it returns a list of all the elements in the matrix, in row-major
order.

```json example
["Flatten", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// ➔ ["List", 5, 2, 10, 18, 1, 2, 3]
```

This is similar to the APL `,` Ravel operator or `numpy.ravel`
[Numpy](https://numpy.org/doc/stable/reference/generated/numpy.ravel.html).

{% enddef %}

{% def "Reshape" %}

[&quot;**Reshape**&quot;, _collection_, _dimensions_]{.signature}

Returns a collection with the specified dimensions.

`Reshape` can be used to convert a list into a matrix.

```json example
["Reshape", ["Range", 9], ["Tuple", 3, 3]]
// ➔ ["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

This is similar to the APL `⍴` Reshape operator or `numpy.reshape`
[Numpy](https://numpy.org/doc/stable/reference/generated/numpy.reshape.html).

{% enddef %}

{% def "Transpose" %}

[&quot;**Transpose**&quot;, _matrix_]{.signature}

Returns the transpose of the matrix.

```json example
["Transpose", ["List", ["List", 1, 2, 3], ["List", 4, 5, 6]]]
// ➔ ["List", ["List", 1, 4], ["List", 2, 5], ["List", 3, 6]]
```

{% enddef %}




## Formatting

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

