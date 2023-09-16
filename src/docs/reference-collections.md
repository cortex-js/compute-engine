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

Collections are used to represent data structures.

A frequently used collection is the `List` which is used to represent an ordered
sequence of elements.

```json example
["List", 42, 3.14, "x", "y"]
```

{% latex "\\lbrack 42, 3.14, x, y \\rbrack" %}

Lists can be used to represent **vectors**.

```json example
["List", 1, 2, 3]
```

{% latex "\\lbrack 1, 2, 3 \\rbrack" %}

A list of lists can be used to represent a **matrix**.

```json example
["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

{% latex "\\lbrack \\lbrack 1, 2, 3 \\rbrack, \\lbrack 4, 5, 6 \\rbrack, \\lbrack 7, 8, 9 \\rbrack \\rbrack" %}

Lists of lists can also be represented using a `;` separator:

{% latex "\\lbrack 1, 2, 3 ; 4, 5, 6 ; 7, 8, 9 \\rbrack" %}

And matrixes can be represented using LaTeX environments:

{% latex "\\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}" %}

Another common collection is the `Range` which is used to represent a sequence
of numbers.

```json example
["Range", 1, 10]
```

{% latex "\\lbrack 1..10 \\rbrack" %}

Collection operations such as `IsEmpty`, `Take`, `IndexOf` can be applied to any
collection types.

```json example
["Take", ["List", 2, 5, 7], 2]
// -> 5
```

{% latex "\\lbrack 2, 5, 7 \\rbrack_{2}" %}

```json example
["Take", ["Range", 2, 10], 5]
// -> 7
```

{% latex "(2..10)_5" %}

## Finite Collections

{% defs "Function" %}

{% def "List" %}

[&quot;**List**&quot;, _expr-1_, ..._expr-2_]{.signature}

An **ordered** collection of elements.

Use to represent a data structure, unlike `Delimiter` which is just a visual
styling.

| MathJSON                        | LaTeX                              |
| :------------------------------ | :--------------------------------- |
| `["List", "x", "y", "7", "11"]` | \\( \lbrack x, y, 7, 11\rbrack \\) |
| `["List", "x", "Nothing", "y"]` | \\( \lbrack x,,y\rbrack \\)        |

{% enddef %}

{% def "Range" %}

[&quot;**Range**&quot;, _lower_, _upper_, _step_]{.signature}

[&quot;**Range**&quot;, _lower_, _upper_]{.signature}

[&quot;**Range**&quot;, _upper_]{.signature}

A sequence of numbers.

If the `step` is not specified, it is assumed to be `1`.

If there is a single argument, it is assumed to be the `upper` bound, and the
`lower` bound is assumed to be `1`.

{% enddef %}

{% def "Linspace" %}

[&quot;**Linspace**&quot;, _lower_, _upper_, _count_]{.signature}

[&quot;**Linspace**&quot;, _lower_, _upper_]{.signature}

[&quot;**Linspace**&quot;, _upper_]{.signature}

A sequence of numbers. Similar to `Range` but the `count` is specified instead
of the `step`.

If the `count` is not specified, it is assumed to be `50`.

If there is a single argument, it is assumed to be the `upper` bound, and the
`lower` bound is assumed to be `1`.

{% enddef %}

{%def "Fill" %}

[&quot;**Fill**&quot;, _dimensions_, _function_]{.signature}

Create a list of the specified dimensions. The value of the elements is computed
by applying the function to the index of the element.

If dimension is a number, a list of that length is created.

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
["Fill", ["Tuple", 2, 3], ["Function", ["Tuple", "i", "j"], ["Plus", "i", "j"]]]
// -> ["List", ["List", 0, 1, 2], ["List", 1, 2, 3]]
```

{% enddef %}

{% def "Set" %}

[&quot;**Set**&quot;, _expr-1_, ..._expr-2_]{.signature}

An **unordered** collection of unique elements.

| MathJSON            | LaTeX                       |
| :------------------ | :-------------------------- |
| `["Set", "x", "y"]` | \\( \lbrace x, y\rbrace \\) |

{% enddef %}

{% enddefs %}

## Infinite Collections

The functions in this section create collections with an infinite number of
elements.

Negative indexes relative to the "last" element are not allowed.

The `Length` of infinite collection is `+Infinity`.

{% defs "Function" %}

{% def "Repeat" %}

[&quot;**Repeat**&quot;, _expr_]{.signature}

A infinite collection of the same element.

```json example
["Repeat", 0]
// -> ["List", 0, 0, 0, ...]
```

Use `Take` to get a finite number of elements.

```json example
["Take", ["Repeat", 0], 3]
// -> ["List", 0, 0, 0]
```

{% enddef %}

{% def "Cycle" %}

[&quot;**Cycle**&quot;, _collection_]{.signature}

A collection that repeats the elements of the input collection. The input
collection must be finite.

```json example
["Cycle", 1, 2, 3]

// -> ["List", 1, 2, 3, 1, 2, 3]
```

Use `Take` to get a finite number of elements.

```json example
["Take", ["Cycle", 1, 2, 3], 5]
// -> ["List", 1, 2, 3, 1, 2]
```

{% enddef %}

{%def "Iterate" %}

[&quot;**Iterate**&quot;, _function_]{.signature}

[&quot;**Iterate**&quot;, _function_, _initial_]{.signature}

An infinite collection of the results of applying the function to the initial
value.

If the `initial` value is not specified, it is assumed to be `0`

```json example
["Iterate", ["Function", ["Tuple", "x", "acc"] ["Multiply", "x", "acc"]], 1]

// -> ["List", 1, 1, 2, 6, 24, 120, ...]
```

Use `Take` to get a finite number of elements.

```json example
["Take", ["Iterate", ["Plus", "_", 1], 0], 5]

// -> ["List", 0, 1, 2, 3, 4]
```

{% enddef %}

## Iterable Collection Operations

The elements of an **iterable collection** can be enumerated one at a time.

They may contain an infinite number of elements. The elements are not ordered.

Examples include `Set`.

{% def "Length" %}

[&quot;**Length**&quot;, _collection_]{.signature}

Returns the number of elements in the collection.

If the collection is a matrix (list of lists), `Length` returns the number of
rows.

```json example example
["Length", ["List", 5, 2, 10, 18]]
// -> 4

`Length` can also be used to get the length of a string.

["Length", "Hello"]
// -> 5
```

{% enddef %}

{% def "IsEmpty" %}

[&quot;**IsEmpty**&quot;, _collection_]{.signature}

Returns the symbol `True` if the collection is empty.

```json example
["IsEmpty", ["List", 5, 2, 10, 18]]
// -> False

["IsEmpty", ["List"]]
// -> True

["IsEmpty", "x"]
// -> True


["IsEmpty", "Hello"]
// -> 5
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

Returns the number of dimensions of the collection, that is the number of axes.

A vector or list has rank 1, a matrix has rank 2, a tensor has rank 3, etc.

Scalars (numbers, string, etc.) have rank 0.

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

Returns a list of the elements of the collection.

```json example
["Flatten", ["List", ["List", 5, 2, 10, 18], ["List", 1, 2, 3]]]
// -> ["List", 5, 2, 10, 18, 1, 2, 3]
```

{% enddef %}

{% def "Reshape" %}

[&quot;**Reshape**&quot;, _collection_, _dimensions_]{.signature}

Returns a collection with the specified dimensions.

```json example
["Reshape", ["Range", 9], ["Tuple", 3, 3]]
// -> ["List", ["List", 1, 2, 3], ["List", 4, 5, 6], ["List", 7, 8, 9]]
```

{% enddef %}

{% def "Reverse" %}

[&quot;**Reverse**&quot;, _collection_]{.signature}

Return the collection in reverse order.

It's equivalent to `["Take", _collection_, ["Tuple", -1, 1]]`.

```json example
["Reverse", ["List", 5, 2, 10, 18]]
// -> ["List", 18, 10, 2, 5]
```

{% enddef %}

{% def "Map" %}

[&quot;**Map**&quot;, _function_, _collection_]{.signature}

Returns a collection where the function is applied to each element of the input
collection.

```json example
["Map", ["Function", "x", ["Plus", "x", 1]], ["List", 5, 2, 10, 18]]
// -> ["List", 6, 3, 11, 19]
```

Note that functions can be provided as a lambda expression:

```json example
["Map", ["Plus", "_", 1], ["List", 5, 2, 10, 18]]
// -> ["List", 6, 3, 11, 19]
```

{% enddef %}

{% def "Filter" %}

[&quot;**Filter**&quot;, _function_, _collection_]{.signature}

Returns a collection where the function is applied to each element of the
collection. Only the elements for which the function returns `True` are kept.

```json example
["Filter", ["Function", "x", ["Less", "x", 10]], ["List", 5, 2, 10, 18]]
// -> ["List", 5, 2]
```

Note that functions can be provided as a lambda expression:

```json example
["Filter", ["Less", "_", 10], ["List", 5, 2, 10, 18]]
// -> ["List", 5, 2]
```

{% enddef %}

{%def "Reduce" %}

[&quot;**Reduce**&quot;, _function_, _collection_]{.signature}

[&quot;**Reduce**&quot;, _function_, _collection_, _initial_]{.signature}

Returns a collection where the function is applied to each element of the
collection. The function is applied to the first two elements, then to the
result of the previous application and the next element, etc.

If the `initial` value is not specified, it is assumed to be the first element
of the collection.

```json example
[
  "Reduce",
  ["Function", ["Tuple", "x", "y"], ["Plus", "x", "y"]],
  ["List", 5, 2, 10, 18]
]
// -> 35
```

Note that functions can be provided as a lambda expression:

```json example
["Reduce", ["Plus", "_1", "_2"], ["List", 5, 2, 10, 18]]
// -> 35
```

Or, if the function takes two arguments, as a function name:

```json example
["Reduce", "Plus", ["List", 5, 2, 10, 18]]
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

Return the transpose of the matrix.

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

{% def "Take" %}

[&quot;**Take**&quot;, _collection_, _index_]{.signature}

[&quot;**Take**&quot;, _collection_, _index1_, _index2_]{.signature}

[&quot;**Take**&quot;, _collection_, _range_]{.signature}

Returns a list of the elements at the specified indexes.

This is a flexible function that can be used to extract a single element, a
range of elements, or a list of elements.

```json example
["Take", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10]

["Take", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 10, 5]
```

When using a range, it is specified as a tuple with the following elements:

- `start`: the starting index of the range
- `end`: the ending index of the range
- `step`: the step of the range (1 if not omitted)

```json example
["Take", ["List", 5, 2, 10, 18], ["Tuple", 2, 3]]
// -> ["List", 10, 18]

["Take", ["List", 5, 2, 10, 18], ["Tuple", 1, -1, 2]]
// -> ["List", 5, 10]
```

The elements are returned in the order in which they're specified. Using
negative indexes (or ranges) reverses the order of the elements.

```json example
["Take", ["List", 5, 2, 10, 18], ["Tuple", -1, 1]]
// -> ["List", 18, 10, 2, 5]

["Take", "'desserts'", ["Tuple", -1, 1]]
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

[&quot;**Drop**&quot;, _collection_, _range_]{.signature}

Drop is the opposite of `Take`. It returns a list of the elements that are not
at the specified indexes.

The elements are returned in the same order as they appear in the collection.

```json example
["Drop", ["List", 5, 2, 10, 18], 2]
// -> ["List", 5, 10, 18]

["Drop", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 2, 18]

["Drop", ["List", 5, 2, 10, 18], ["Tuple", 2, 3]]
// -> ["List", 5, 2]

["Drop", ["List", 5, 2, 10, 18], ["Tuple", 1, -1, 2]]

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
