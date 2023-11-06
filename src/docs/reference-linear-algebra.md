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
mathematics that studies vector spaces and linear transformations between them 
like adding and scaling. It uses matrixes to represent linear maps. 
Linear algebra is widely used in science and engineering. 

{% latex "\\begin{pmatrix} 1 & 3 \\\\ 5 & 0 \\end{pmatrix}" %}

In the Compute Engine matrices are represented as lists of lists.

For example the matrix above is represented as the following list of lists:

```json example
["List", ["List", 1, 3, ["List", 5, 0]]]
```

In the Compute Engine, matrices are stored in **row-major** order. This means that
the first element of the outer list is the first row of the matrix, the second element
of the list is the second row of the matrix, etc.


{% readmore "/compute-engine/reference/collections/" %}Since vectors,
matrixes and tensors are `List` collections, some **collection operations**
can also be applied to them such as `At`, `Fold` and `Map`. {% endreadmore %}


An extension of linear algebra is [tensor algebra](https://en.wikipedia.org/wiki/Tensor_algebra) 
which studies tensors, which are multidimensional arrays. 

For example, a grayscale image can be represented by a matrix of grayscale 
values. But a color image is represented by a rank 3 tensor, an array of RGB 
triplets. Tensors are represented as nested lists.


The Compute Engine provides a number of functions for working with matrices 
and tensors.

### Representing Vectors, Matrices and Tensors

Vectors, matrices and tensors are represented as lists of lists, that
is expressions with the head `List`.

`Vector` is a convenience function that interprets a list of elements as a
column vector.

`Matrix` is an optional "tag" inert function that is used to influence the visual
representation of a matrix. It has not impact on the value of the matrix.

In LaTeX notation, a matrix is represented with "environments" (with command
`\begin` and `\end`) such as  `pmatrix` or `bmatrix`.:

{% latex "\\begin{pmatrix} 1 & 3 \\\\ 5 & 0 \\end{pmatrix}" %}

{% latex "\\begin{bmatrix} 1 & 3 \\\\ 5 & 0 \\end{bmatrix}" %}

In LaTeX, each column is separated by an `&` and each row is separated by
`\\`.


{% def "Vector" %}

[&quot;**Vector**&quot;, _x-1_, ..._x-2_]{.signature}

`Vector` interprets the elements _x-1_... as a column vector

This is essentially a shortcut for `["Matrix", ["List", ["List", _x-1_], ["List, _x-2_], ...]]]`.

```json example
["Vector", 1, 3, 5, 0]
```

{% latex "\\begin{pmatrix} 1 \\\\ 3 \\\\ 5 \\\\ 0 \\end{pmatrix}" %}

A row vector can be represented with a simple list or a tuple.

```json example
["List", 1, 3, 5, 0]
```

{% latex "\\begin{bmatrix} 1 & 3 & 5 & 0 \\end{bmatrix}" %}


{% enddef %}



{% def "Matrix" %}

[&quot;**Matrix**&quot;, _matrix_]{.signature}

[&quot;**Matrix**&quot;, _matrix_, _delimiters_, _columns-format_]{.signature}

`Matrix` is an inert function: its value is the value of its first argument. 
It influences the visual representation of a matrix.

_matrix_ is a matrix represented by a list of rows. Each row is represented 
by a list of elements.

_delimiters_ is an optional string of two characters. 
The first character represent the opening delimiter and the second character 
represents the closing delimiter.

The delimiters can be any of the following characters: 
  - `(`, `)`, `[`, `]`, `{`, `}`, `<`, `>`
  - `⟦` (`U+27E6`), `⟧` (`U+27E7`)
  - `|`, `‖` (`U+2016`)
  - `\\`
  - `⌈` (`U+2308`), `⌉` (`U+2309`), `⌊` (`U+230A`), `⌋` (`U+230B`)
  - `⌜` (`U+231C`), `⌝` (`U+231D`), `⌞` (`U+231E`), `⌟` (`U+231F`)
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

_columns_format_ is an optional string indicating the format of each column. 
A character `=` indicates a centered column, `<` indicates a left-aligned 
column, and `>` indicates a right-aligned column. 

A character of `|` indicate a solid line between two
columns and `:` indicate a dashed lines between two columns.

{% enddef %}



## Tensor Properties


{% def "Shape" %}

[&quot;**Shape**&quot;, _tensor_]{.signature}

Returns the shape of a tensor, a tuple of the lengths of the
tensor along each of its axis.

A list (or vector) has a single axis. A matrix has two axes. A tensor has more
than two axes.

For a scalar, `Shape` returns an empty tuple.

```json example
["Shape", 5]
// ➔ ["Tuple"]

["Shape", ["List", 5, 2, 10, 18]]
// ➔ ["Tuple", 4]

["Shape", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// ➔ ["Tuple", 2, 4]
```

**Note:** The shape of a tensor is also sometimes called "dimensions".
However, this terminology is ambiguous because the word "dimension" is also
used to refer to the length of a tensor along a specific axis.

{% enddef %}

{% def "Rank" %}

[&quot;**Rank**&quot;, _tensor_]{.signature}

Returns the number of axes of a tensor.

A scalar (a number, for exmaple) has **rank 0**.

A vector or list has **rank 1**.

A matrix has **rank 2**, a tensor has **rank 3**, etc.

The rank is the length of the shape of the tensor.

```json example
["Rank", 5]
// ➔ 0

["Rank", ["List", 5, 2, 10, 18]]
// ➔ 1

["Rank", ["List", ["List", 5, 2, 10], ["List", 1, 2, 3]]]
// ➔ 2
```

{% enddef %}


## Accessing the content of Tensors

{% def "At" %}

[&quot;**At**&quot;, _tensor_, _index-1_, _index-2_, ...]{.signature}

Returns the element of the tensor at the specified indexes.

_index-1_, ... is a sequence of integers, one for each axis of the tensor.

Indexes start at 1. Negative indexes count elements from the end. A negative 
index is equivalent to adding the length of the axis to the index. So `-1` is
the last element of the axis, `-2` is the second to last element, etc.

```json example
["At", ["List", 5, 2, 10, 18], 3]
// ➔ 10

["At", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]], 2, 3]
// ➔ 3

["At", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]], 2, -1]
// ➔ 3
```


In a list (or vector), there is only one axis, so there is only one index.

In a matrix, the first index is the row, the second is the column.

In LaTeX, accessing the element of a matrix is done with a subscript or
square brackets following a matrix.

{% latex "\\mathbf{A}_{2,3}" %}

{% latex "\\mathbf{A}\lbrack2,3\rbrack" %}

{% enddef %}



{% def "Axis" %}

[&quot;**Axis**&quot;, _tensor_, _axis_]{.signature}

Returns the specified axis of the tensor.

_axis_ is an integer, starting at 1.

```json example
["Axis", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]], 2]
// ➔ ["List", 1, 2, 3]
```

{% enddef %}




## Transforming Matrixes and Tensors

{% def "Flatten" %}

[&quot;**Flatten**&quot;, _collection_]{.signature}

Returns a list of all the elements of the tensor or collection, recursively.

Only elements with the same head as the collection are flattened.
Tensors usually have a head of `List`, so only other `List` elements
are flattened.

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

[&quot;**Reshape**&quot;, _tensor_, _shape_]{.signature}

Returns a tensor with the specified shape.

_tensor_ can be a list, a matrix, a tensor or a collection.

_shape_ is a tuple of integers, one for each axis of the tensor.

`Reshape` can be used to convert a list into a matrix.

```json example
["Reshape", ["Range", 9], ["Tuple", 3, 3]]
// ➔ ["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

This is similar to the APL `⍴` Reshape operator or `numpy.reshape`
[Numpy](https://numpy.org/doc/stable/reference/generated/numpy.reshape.html).

The result may have fewer or more elements than the original tensor.

When reshaping, the elements are taken from the original tensor in row-major
order, that is the order of elements as returned by `Flatten`.

If the result has fewer elements, the elements are dropped from the end of the
element list. If the result has more elements, the lists of elements
is filled cyclically. 

This is a behavior to APL, but other environment may behave differently.
For example, by default Mathematic `ArrayReshape` will fill the missing elements
with zeros.


{% enddef %}

{% def "Transpose" %}

[&quot;**Transpose**&quot;, _matrix_]{.signature}

Returns the transpose of the matrix.

{% latex "\\mathbf{A}^T" %}

```json example
["Transpose", ["List", ["List", 1, 2, 3], ["List", 4, 5, 6]]]
// ➔ ["List", ["List", 1, 4], ["List", 2, 5], ["List", 3, 6]]
```

[&quot;**Transpose**&quot;, _tensor_, _axis-1_, _axis-2_]{.signature}

Swap the two specified axes of the tensor. Note that axis
indexes start at 1.

{% enddef %}


{% def "ConjugateTranspose" %}

[&quot;**ConjugateTranspose**&quot;, _matrix_]{.signature}

{% latex "A^\star" %}

Returns the [conjugate transpose](https://en.wikipedia.org/wiki/Conjugate_transpose) of the matrix, that is
the transpose of the matrix with all its (complex) elements conjugated. 
Also known as the Hermitian transpose.

```json example
["ConjugateTranspose", ["List", ["List", 1, 2, 3], ["List", 4, 5, 6]]]
// ➔ ["List", ["List", 1, 4], ["List", 2, 5], ["List", 3, 6]]
```

[&quot;**ConjugateTranspose**&quot;, _tensor_, _axis-1_, _axis-2_]{.signature}

Swap the two specified axes of the tensor. Note that axis
indexes start at 1. In addition, all the (complex) elements
of the tensor are conjugated.


{% enddef %}

{% def "Inverse" %}

[&quot;**Inverse**&quot;, _matrix_]{.signature}

Returns the inverse of the matrix.

{% latex "\\mathbf{A}^{-1}" %}

```json example
["Inverse", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ ["List", ["List", -2, 1], ["List", 1.5, -0.5]]
```

{% enddef %}

{% def "PseudoInverse" %}

[&quot;**PseudoInverse**&quot;, _matrix_]{.signature}

{% latex "\\mathbf{A}^+" %}

Returns the [Moore-Penrose pseudoinverse](https://en.wikipedia.org/wiki/Moore%E2%80%93Penrose_inverse) of the matrix.

```json example
["PseudoInverse", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ ["List", ["List", -2, 1], ["List", 1.5, -0.5]]
```

{% enddef %}
  
{% def "Diagonal" %}

[&quot;**Diagonal**&quot;, _matrix_]{.signature}

Returns the diagonal of the matrix.

```json example
["Diagonal", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ ["List", 1, 4]
```

{% enddef %}

## Calculating with Matrixes and Tensors


{% def "Determinant" %}

[&quot;**Determinant**&quot;, _matrix_]{.signature}

Returns the determinant of the matrix.

```json example
["Determinant", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ -2
```

{% enddef %}



{% def "AdjugateMatrix" %}

[&quot;**AdjugateMatrix**&quot;, _matrix_]{.signature}

{% latex "\\operatorname{adj}(\\mathbf{A})" %}

Returns the [adjugate matrix](https://en.wikipedia.org/wiki/Adjugate_matrix) of
the input matrix, that is the inverse of the cofactor matrix.

The cofactor matrix is a matrix of the determinants of the minors of the matrix
multiplied by \\( (-1)^{i+j} \\). That is, for each element of the matrix, 
the cofactor is the determinant of the matrix without the row and column of 
the element.


```json example
["AdjugateMatrix", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ ["List", ["List", 4, -2], ["List", -3, 1]]
```

{% enddef %}


{% def "Trace" %}

[&quot;**Trace**&quot;, _matrix_]{.signature}

{% latex "\\operatorname{tr}(\\mathbf{A})" %}

Returns the [trace](https://en.wikipedia.org/wiki/Trace_(linear_algebra)) of 
the matrix, the sum of the elements on the diagonal of the matrix. The trace 
is only defined for square matrices. The trace is also the sum of the 
eigenvalues of the matrix.

```json example
["Trace", ["List", ["List", 1, 2], ["List", 3, 4]]]
// ➔ 5
```

{% enddef %}

