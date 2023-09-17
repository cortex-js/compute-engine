---
title: Collections
permalink: /compute-engine/reference/collections/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

In the Compute Engine, **collections** are used to represent data structures.
They group together multiple elements into one unit. Each element in a
collection is a
[**Boxed Expression**](https://cortexjs.io/compute-engine/guides/expressions/).

Collections are **immutable**. They cannot be modified. Operations on
collections return new collections.

Collections can be **finite** or **infinite**. Finite collections have a finite
number of elements. Infinite collections have an infinite number of elements.

Collections can be **ordered** or **unordered**. Ordered collections are finite
and have a well-defined order for their elements. Unordered collections do not
have a well-defined order for their elements.

Collections can be **indexable** or **iterable**. Indexable collections can be
accessed with a numeric index. Iterable collections can be enumerated one
element at a time. Indexable collections are iterable.

`List` is an example of a of finite, ordered, indexable collection.

{% latex "\\lbrack 42, 3.14, x, y \\rbrack" %}

```json example
["List", 42, 3.14, "x", "y"]
```

Lists can be used to represent **vectors**.

{% latex "\\lbrack 1, 2, 3 \\rbrack" %}

```json example
["List", 1, 2, 3]
```

A **matrix** is represented using a `List` of `List`s.

{% latex "\\lbrack \\lbrack 1, 2, 3 \\rbrack, \\lbrack 4, 5, 6 \\rbrack, \\lbrack 7, 8, 9 \\rbrack \\rbrack" %}

```json example
["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

Lists of lists can also be represented using a `;` separator:

{% latex "\\lbrack 1, 2, 3 ; 4, 5, 6 ; 7, 8, 9 \\rbrack" %}

And matrixes can be represented using LaTeX environments:

{% latex "\\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}" %}

Another common collection is the `Range` which is used to represent a sequence
of numbers.

{% latex "\\lbrack 1..10 \\rbrack" %}

```json example
["Range", 1, 10]
```

Collection operations such as `IsEmpty`, `Take`, `IndexOf` can be applied to any
collection types.

{% latex "\\lbrack 2, 5, 7 \\rbrack_{2}" %}

```json example
["Take", ["List", 2, 5, 7], 2]
// -> 5
```

{% latex "(2..10)_5" %}

```json example
["Take", ["Range", 2, 10], 5]
// -> 7
```

## Finite Collections

{% defs "Function" %}

{% def "List" %}

[&quot;**List**&quot;, _x-1_, ..._x-2_]{.signature}

A `List` is an **ordered**, **indexable** collection of elements. An element in
a list may be repeated.

The visual presentation of a `List` expression can be customized using the
`Delimiter` function.

```js example
ce.box(['List', 5, 2, 10, 18]).latex;
// -> "\\lbrack 5, 2, 10, 18 \\rbrack"

ce.box(['Delimiter', ['List', 5, 2, 10, 18], '<>;']).latex;
// -> "\\langle5; 2; 10; 18\\rangle"
```

| MathJSON                        | LaTeX                              |
| :------------------------------ | :--------------------------------- |
| `["List", "x", "y", 7, 11]`     | \\( \lbrack x, y, 7, 11\rbrack \\) |
| `["List", "x", "Nothing", "y"]` | \\( \lbrack x,,y\rbrack \\)        |

{% enddef %}

{% def "Range" %}

[&quot;**Range**&quot;, _upper_]{.signature}

[&quot;**Range**&quot;, _lower_, _upper_]{.signature}

[&quot;**Range**&quot;, _lower_, _upper_, _step_]{.signature}

A sequence of numbers, starting with `lower`, ending with `upper`, and
incrementing by `step`.

If the `step` is not specified, it is assumed to be `1`.

If there is a single argument, it is assumed to be the `upper` bound, and the
`lower` bound is assumed to be `1`.

```json example
["Range", 3, 9]
// -> ["List", 3, 4, 5, 6, 7, 8, 9]

["Range", 7]
// -> ["List", 1, 2, 3, 4, 5, 6, 7]

["Range", 1, 10, 2]
// -> ["List", 1, 3, 5, 7, 9]

["Range", 10, 1, -1]
// -> ["List", 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
```

{% enddef %}

{% def "Linspace" %}

[&quot;**Linspace**&quot;, _upper_]{.signature}

[&quot;**Linspace**&quot;, _lower_, _upper_]{.signature}

[&quot;**Linspace**&quot;, _lower_, _upper_, _count_]{.signature}

Short for "linearly spaced", from the (MATLAB function of the same
name)[https://www.mathworks.com/help/matlab/ref/linspace.html].

A sequence of numbers. Similar to `Range` but the number of elements in the
collection is specified with `count` instead of a `step` value.

If the `count` is not specified, it is assumed to be `50`.

If there is a single argument, it is assumed to be the `upper` bound, and the
`lower` bound is assumed to be `1`.

```json example
["Linspace", 3, 9]
// -> ["List", 3, 3.163265306122449, 3.326530612244898, 3.489795918367347, 3.653061224489796, 3.816326530612245, 3.979591836734694, 4.142857142857143, 4.3061224489795915, 4.469387755102041, 4.63265306122449, 4.795918367346939, 4.959183673469388, 5.122448979591837, 5.285714285714286, 5.448979591836735, 5.612244897959184, 5.775510204081633, 5.938775510204081, 6.1020408163265305, 6.26530612244898, 6.428571428571429, 6.591836734693878, 6.755102040816326, 6.918367346938775, 7.081632653061225, 7.244897959183673, 7.408163265306122, 7.571428571428571, 7.73469387755102, 7.8979591836734695, 8.061224489795919, 8.224489795918368, 8.387755102040817, 8.551020408163266, 8.714285714285714, 8.877551020408163, 9.040816326530612, 9.204081632653061, 9.36734693877551, 9.53061224489796, 9.693877551020408, 9.857142857142858, 10]

["Linspace", 7]
// -> ["List", 1, 1.1428571428571428, 1.2857142857142858, 1.4285714285714286, 1.5714285714285714, 1.7142857142857142, 1.8571428571428572, 2]

["Linspace", 1, 10, 5]
// -> ["List", 1, 3.25, 5.5, 7.75, 10]

["Linspace", 10, 1, 10]
// -> ["List", 10, 9.11111111111111, 8.222222222222221, 7.333333333333333, 6.444444444444445, 5.555555555555555, 4.666666666666666, 3.7777777777777777, 2.888888888888889, 2]
```

{% enddef %}

{%def "Fill" %}

[&quot;**Fill**&quot;, _dimensions_, _value_]{.signature}

[&quot;**Fill**&quot;, _dimensions_, _function_]{.signature}

Create a list of the specified dimensions.

If a _value_ is provided, the elements of the list are all set to that value.

If a _function_ is provided, the elements of the list are computed by applying
the function to the index of the element.

If _dimensions_ is a number, a list of that length is created.

```json example
["Fill", 3, 0]
// -> ["List", 0, 0, 0]
```

If dimension is a tuple, a matrix of the specified dimensions is created.

```json example
["Fill", ["Tuple", 2, 3], 0]
// -> ["List", ["List", 0, 0, 0], ["List", 0, 0, 0]]
```

If a function is specified, it is applied to the index of the element to compute
the value of the element.

```json example
["Fill", ["Tuple", 2, 3], ["Function", ["Add", "i", "j"], ["Tuple", "i", "j"]]]
// -> ["List", ["List", 0, 1, 2], ["List", 1, 2, 3]]
```

{% enddef %}

{% def "Set" %}

[&quot;**Set**&quot;, _expr-1_, ..._expr-2_]{.signature}

An **unordered** collection of unique elements.

{% latex "\\lbrace 12, 15, 17 \\rbrace" %}

```json example
["Set", 12, 15, 17]
```

{% enddef %}

{% enddefs %}

## Infinite Collections

The functions in this section create collections with an infinite number of
elements.

Negative indexes relative to the "last" element are not allowed when using
infinite collections.

The `Length` of infinite collection is `+Infinity`.

{% defs "Function" %}

{% def "Repeat" %}

[&quot;**Repeat**&quot;, _expr_]{.signature}

An infinite collection of the same element.

```json example
["Repeat", 0]
// -> ["List", 0, 0, 0, ...]
```

Use `Take` or `First` to get a finite number of elements.

```json example
["Take", ["Repeat", 42], ["Range", 3]]
// -> ["List", 42, 42, 42]

["First", ["Repeat", 42], 3]
// -> ["List", 42, 42, 42]
```

{% enddef %}

{% def "Cycle" %}

[&quot;**Cycle**&quot;, _seed_]{.signature}

A collection that repeats the elements of the _seed_ collection. The input
collection must be finite.

```json example
["Cycle", ["List", 5, 7, 2]]
// -> ["List", 5, 7, 2, 5, 7, 2, 5, 7, ...]

["Cycle", ["Range", 3]]
// -> ["List", 1, 2, 3, 1, 2, 3, 1, 2, ...]
```

Use `Take` or `First` to get a finite number of elements.

```json example
["Take", ["Cycle", ["List", 5, 7, 2]], ["Range", 5]]
// -> ["List", 5, 7, 2, 5, 7]

["First", ["Cycle", ["List", 5, 7, 2]], 5]
// -> ["List", 5, 7, 2, 5, 7]
```

{% enddef %}

{%def "Iterate" %}

[&quot;**Iterate**&quot;, _function_]{.signature}

[&quot;**Iterate**&quot;, _function_, _initial_]{.signature}

An infinite collection of the results of applying `function` to the initial
value.

If the `initial` value is not specified, it is assumed to be `0`

```json example
["Iterate", ["Function", ["Multiply", "_", 2]], 1]
// -> ["List", 1, 2, 4, 8, 16, ...]
```

Use `Take` to get a finite number of elements.

```json example
["Take", ["Iterate", ["Function", ["Add", "_", 2]], 7], ["Range", 5]]
// -> ["List", 7, 9, 11, 13, 15]
```

{% enddef %}

{% enddefs %}

## Iterable Collection Operations

The elements of an **iterable collection** can be enumerated one at a time.

They may contain an infinite number of elements. The elements may not be
ordered.

Examples include `List`, `Set`.

{% defs %}

{% def "Length" %}

[&quot;**Length**&quot;, _collection_]{.signature}

Returns the number of elements in the collection.

When the collection is a matrix (list of lists), `Length` returns the number of
rows.

````json example
["Length", ["List", 5, 2, 10, 18]]
// -> 4

When the collection is a string, `Length` returns the number of characters in
the string.


```json example
["Length", {str: "Hello"}]
// -> 5
````

{% enddef %}

{% def "IsEmpty" %}

[&quot;**IsEmpty**&quot;, _collection_]{.signature}

Returns the symbol `True` if the collection is empty.

```json example
["IsEmpty", ["List", 5, 2, 10, 18]]
// -> "False"

["IsEmpty", ["List"]]
// -> "True"

["IsEmpty", "x"]
// -> "True"


["IsEmpty", {str: "Hello"]
// -> "False"
```

{% enddef %}

{% def "Dimensions" %}

[&quot;**Dimensions**&quot;, _collection_]{.signature}

Returns the dimensions of the collection, a tuple of the lengths of the
collection along each of its axis.

A list (or vector) has a single axis. A matrix has two axes. A tensor has more
than two axes.

A scalar has no dimension and `Dimensions` returns an empty tuple.

```json example
["Dimension", 5]
// -> []

["Dimensions", ["List", 5, 2, 10, 18]]
// -> [4]

["Dimensions", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// -> [2, 4]
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
// -> 0

["Rank", ["List", 5, 2, 10, 18]]
// -> 1

["Rank", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// -> 2
```

{% enddef %}

{% def "Flatten" %}

[&quot;**Flatten**&quot;, _collection_]{.signature}

Returns a list of all the elements of the collection, recursively.

Only elements with the same head as the collection are flattened.

For a matrix, it returns a list of all the elements in the matrix, in row-major
order.

```json example
["Flatten", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// -> ["List", 5, 2, 10, 18, 1, 2, 3]
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
// -> ["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

This is similar to the APL `⍴` Reshape operator or `numpy.reshape`
[Numpy](https://numpy.org/doc/stable/reference/generated/numpy.reshape.html).

{% enddef %}

{% def "Reverse" %}

[&quot;**Reverse**&quot;, _collection_]{.signature}

Return the collection in reverse order.

```json example
["Reverse", ["List", 5, 2, 10, 18]]
// -> ["List", 18, 10, 2, 5]
```

It's equivalent to `["Take", _collection_, ["Tuple", -1, 1]]`.

{% enddef %}

{% def "Map" %}

[&quot;**Map**&quot;, _collection_, _function_]{.signature}

Returns a collection where _function_ is applied to each element of the input
collection.

```json example
["Map", ["Function", "x", ["Add", "x", 1]], ["List", 5, 2, 10, 18]]
// -> ["List", 6, 3, 11, 19]
```

```json example
["Map", ["List", 5, 2, 10, 18], ["Function", ["Add", "_", 1]]]
// -> ["List", 6, 3, 11, 19]
```

{% enddef %}

{% def "Filter" %}

[&quot;**Filter**&quot;, _collection_, _function_]{.signature}

Returns a collection where _function_ is applied to each element of the
collection. Only the elements for which the function returns `"True"` are kept.

```json example
["Filter", ["List", 5, 2, 10, 18], ["Function", ["Less", "_", 10]]]
// -> ["List", 5, 2]
```

{% enddef %}

{%def "Fold" %}

[&quot;**Fold**&quot;, _collection_, _fn_]{.signature}

[&quot;**Fold**&quot;, _collection_, _fn_, _initial_]{.signature}

Returns a collection where the reducing function _fn_ is applied to each element
of the collection.

`Fold` performs a _left fold_ operation: the reducing function is applied to the
first two elements, then to the result of the previous application and the next
element, etc...

When an `initial` value is provided, the reducing function is applied to the
initial value and the first element of the collection, then to the result of the
previous application and the next element, etc...

```json example
[
  "Fold",
  ["List", 5, 2, 10, 18]
  ["Function", ["Add", "_1", "_2"]],
]
// -> 35
```

The name of a function can be used as a shortcut for a function that takes two
arguments.

```json example
["Reduce", ["List", 5, 2, 10, 18], "Add"]
// -> 35
```

{% enddef %}

{%def "Zip" %}

[&quot;**Zip**&quot;, _collection-1_, _collection-2_, ...]{.signature}

Returns a collection of tuples where the first element of each tuple is the
first element of the first collection, the second element of each tuple is the
second element of the second collection, etc.

The length of the resulting collection is the length of the shortest collection.

```json example
["Zip", ["List", 1, 2, 3], ["List", 4, 5, 6]]
// -> ["List", ["Tuple", 1, 4], ["Tuple", 2, 5], ["Tuple", 3, 6]]
```

{% enddef %}

{%def "Transpose" %}

[&quot;**Transpose**&quot;, _matrix_]{.signature}

Returns the transpose of the matrix.

```json example
["Transpose", ["List", ["List", 1, 2, 3], ["List", 4, 5, 6]]]
// -> ["List", ["List", 1, 4], ["List", 2, 5], ["List", 3, 6]]
```

{% enddef %}

{% def "Join" %}

[&quot;**Join**&quot;, _collection-1_, _collection-2_, ...]{.signature}

Returns a collection that contains the elements of the first collection followed
by the elements of the second collection.

All the collections should have the same head.

````json example
["Join", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]

```json example
["Join", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]
// -> ["List", 5, 2, 10, 18, 1, 2, 3]
````

{% enddef %}

{% enddefs %}

## Indexable Collection Operations

An **indexable collection** is a collection where the elements can be accessed
with a numeric index from 1 to the length of the collection. The length of an
indexable is finite and can be computed.

Some `Set` are finite.

The elements of an **indexable collection** are finite and ordered. They can be
accessed with a numeric index from 1 to the length of the collection.

Indexable collections are **finite** and **iterable**.

Examples include `List`, `Range` and `String`.

{% defs %}

{% def "At" %}

[&quot;**At**&quot;, _collection_, _index_]{.signature}

[&quot;**At**&quot;, _collection_, _index1_, _index2_, ...]{.signature}

Returns the element at the specified index.

There can be multiple indexes, up to the rank of the collection.

```json example
["At", ["List", 5, 2, 10, 18], 2]
// -> 10

["At", ["List", 5, 2, 10, 18], -2]
// -> 10

["At", ["List", ["List", 1, 2], ["List", 3, 4]], 2, 1]
// -> 3
```

{% enddef %}

{% def "Take" %}

[&quot;**Take**&quot;, _collection_, _index_]{.signature}

[&quot;**Take**&quot;, _collection_, _index1_, _index2_]{.signature}

[&quot;**Take**&quot;, _collection_, _range_]{.signature}

Returns a list of the elements at the specified indexes.

`Take` is a flexible function that can be used to extract a single element, a
range of elements, or a list of elements.

`Take` always return a list, even if the result is a single element. If no
elements match, an empty list is returned.

```json example
["Take", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10]

["Take", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 10, 5]


["Take", ["List", 5, 2, 10, 18], 17]
// -> ["List"]
```

When using a range, it is specified as a [`Range`](/#Range) expression.

```json example
// Elements 2 to 3
["Take", ["List", 5, 2, 10, 18], ["Range", 2, 4]]
// -> ["List", 2, 10, 18]

// From start to end, every other element
["Take", ["List", 5, 2, 10, 18], ["Range", 1, -1, 2]]
// -> ["List", 5, 10]
```

The elements are returned in the order in which they're specified. Using
negative indexes (or ranges) reverses the order of the elements.

```json example
// From last to first = reverse
["Take", ["List", 5, 2, 10, 18], ["Range", -1, 1]]
// -> ["List", 18, 10, 2, 5]

// From last to first = reverse
["Take", "'desserts'", ["Range", -1, 1]]
// -> "'stressed'"
```

An index can be repeated to extract the same element multiple times.

```json example
["Take", ["List", 5, 2, 10, 18], 3, 3, 1]
// -> ["List", 10, 10, 5]
```

{% enddef %}

{% def "Drop" %}

[&quot;**Drop**&quot;, _collection_, _index_]{.signature}

[&quot;**Drop**&quot;, _collection_, _index1_, _index2_]{.signature}

[&quot;**Drop**&quot;, _collection_, _range_]{.signature}

Drop is the opposite of `Take`. It returns a list of the elements that are not
at the specified indexes.

The elements are returned in the same order as they appear in the collection.

```json example
["Drop", ["List", 5, 2, 10, 18], 2]
// -> ["List", 5, 10, 18]

["Drop", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 2, 18]

["Drop", ["List", 5, 2, 10, 18], ["Range", 2, 3]]
// -> ["List", 5, 2]

["Drop", ["List", 5, 2, 10, 18], ["Range", 1, -1, 2]]

// -> ["List", 2, 18]
```

An index may be repeated, but the corresponding element will only be dropped
once.

```json example
["Drop", ["List", 5, 2, 10, 18], 3, 3, 1]
// -> ["List", 2, 18]
```

{% enddef %}

{% def "First" %}

[&quot;**First**&quot;, _collection_]{.signature}

Return the first element of the collection.

It's equivalent to `["Take", _collection_, 1]`.

```json example
["First", ["List", 5, 2, 10, 18]]
// -> 5

["First", ["Tuple", "x", "y"]]
// -> "x"
```

[&quot;**First**&quot;, _collection_, _n_]{.signature}

Return the first _n_ elements of the collection.

It's equivalent to `["Take", _collection_, ["Tuple", 1, _n_]]`.

```json example
["First", ["List", 5, 2, 10, 18], 2]
// -> ["List", 5, 2]
```

{% enddef %}

{% def "Second" %}

[&quot;**Second**&quot;, _collection_]{.signature}

Return the second element of the collection.

It's equivalent to `["Take", _collection_, 2]`.

```json example
["Second", ["Tuple", "x", "y"]]
// -> "y"
```

{% enddef %}

{% def "Last" %}

[&quot;**Last**&quot;, _collection_]{.signature}

Return the last element of the collection.

It's equivalent to `["Take", _collection_, -1]`.

```json example
["Last", ["List", 5, 2, 10, 18]]
// -> 18
```

[&quot;**Last**&quot;, _collection_, _n_]{.signature}

Return the last _n_ elements of the collection.

```json example
["Last", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10, 18]
```

{% enddef %}

{% def "Rest" %}

[&quot;**Rest**&quot;, _collection_]{.signature}

Return everything but the first element of the collection.

It's equivalent to `["Drop", _collection_, 1]`.

```json example
["Rest", ["List", 5, 2, 10, 18]]
// -> ["List", 2, 10, 18]
```

{% enddef %}

{% def "Most" %}

[&quot;**Most**&quot;, _collection_]{.signature}

Return everything but the last element of the collection.

It's equivalent to `["Drop", _collection_, -1]`.

```json example
["Most", ["List", 5, 2, 10, 18]]
// -> ["List", 5, 2, 10]
```

{% enddef %}

{% def "Sort" %}

[&quot;**Sort**&quot;, _collection_]{.signature}

[&quot;**Sort**&quot;, _collection_, _order-function_]{.signature}

Return the collection in sorted order.

```json example
["Sort", ["List", 5, 2, 10, 18]]
// -> ["List", 2, 5, 10, 18]
```

{% enddef %}

{% def "Ordering" %}

[&quot;**Ordering**&quot;, _collection_]{.signature}

[&quot;**Ordering**&quot;, _collection_, _order-function_]{.signature}

Return the indexes of the collection in sorted order.

```json example
["Ordering", ["List", 5, 2, 10, 18]]
// -> ["List", 2, 1, 3, 4]
```

To get the values in sorted order, user `Take`:

```json example
["Set", "l", ["List", 5, 2, 10, 18]]
["Take", "l", ["Ordering", "l"]]
// -> ["List", 2, 5, 10, 18]

// Same as Sort:
["Sort", "l"]
// -> ["List", 2, 5, 10, 18]
```

{% enddef %}

{% def "Shuffle" %}

[&quot;**Shuffle**&quot;, _collection_]{.signature}

Return the collection in random order.

```json example
["Shuffle", ["List", 5, 2, 10, 18]]
// -> ["List", 10, 18, 5, 5]
```

{% enddef %}

{% def "RotateLeft" %}

[&quot;**RotateLeft**&quot;, _collection_, _count_]{.signature}

Returns a collection where the elements are rotated to the left by the specified
count.

```json example
["RotateLeft", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10, 18, 5, 2]
```

{% enddef %}

{% def "RotateRight" %}

[&quot;**RotateRight**&quot;, _collection_, _count_]{.signature}

Returns a collection where the elements are rotated to the right by the
specified count.

```json example
["RotateRight", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10, 18, 5, 2]
```

{% enddef %}

{% def "Tally" %}

[&quot;**Tally**&quot;, _collection_]{.signature}

Returns a tuples of two lists. The first list contains the unique elements of
the collection. The second list contains the number of times each element
appears in the collection.

```json example
["Tally", ["List", 5, 2, 10, 18, 5, 2, 5]]
// -> ["Tuple", ["List", 5, 2, 10, 18], ["List", 3, 2, 1, 1]]
```

{% enddef %}

{% def "Unique" %}

[&quot;**Unique**&quot;, _collection_]{.signature}

Returns a collection of the unique elements of the collection.

This is equivalent to the first element of the result of `Tally`:
`["First", ["Tally", _collection_]]`.

```json example
["Unique", ["List", 5, 2, 10, 18, 5, 2, 5]]
// -> ["List", 5, 2, 10, 18]
```

{% enddef %}

{% enddefs %}
