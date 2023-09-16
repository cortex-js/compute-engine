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

## Collection Types

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

{% def "Set" %}

[&quot;**Set**&quot;, _expr-1_, ..._expr-2_]{.signature}

An **unordered** collection of unique elements.

| MathJSON            | LaTeX                       |
| :------------------ | :-------------------------- |
| `["Set", "x", "y"]` | \\( \lbrace x, y\rbrace \\) |

{% enddef %}

{% enddefs %}

## Collection Operations

{% defs "Function" %}

{% def "Length" %}

[&quot;**Length**&quot;, _collection_]{.signature}

Returns the number of elements in the collection.

Note this can also be used to get the length of a string.

```json example example
["Length", ["List", 5, 2, 10, 18]]
// -> 4

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

{% def "Take" %}

[&quot;**Take**&quot;, _collection_, _index_]{.signature} [&quot;**Take**&quot;,
_collection_, _index1_, _index2_]{.signature}

Returns a list of the elements at the specified indexes.

```json example
["Take", ["List", 5, 2, 10, 18], 2]
// -> ["List", 10]

["Take", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 10, 5]
```

[&quot;**Take**&quot;, _collection_, _range_]{.signature}

Returns a list of the elements at the specified ranges.

Each range is specified as a tuple with the following elements:

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

{% enddef %}

{% def "Drop" %}

[&quot;**Drop**&quot;, _collection_, _index_]{.signature}

Drop is the opposite of `Take`. It returns a list of the elements that are not
at the specified indexes.

```json example
["Drop", ["List", 5, 2, 10, 18], 2]
// -> ["List", 5, 10, 18]

["Drop", ["List", 5, 2, 10, 18], -2, 1]
// -> ["List", 2, 18]
```

[&quot;**Drop**&quot;, _collection_, _range_]{.signature}

It also accepts a list of ranges.

```json example
["Drop", ["List", 5, 2, 10, 18], ["Tuple", 2, 3]]
// -> ["List", 5, 2]
["Drop", ["List", 5, 2, 10, 18], ["Tuple", 1, -1, 2]]

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

Return the first element of the collection.

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

{% def "Reverse" %}

[&quot;**Reverse**&quot;, _collection_]{.signature}

Return the collection in reverse order.

It's equivalent to `["Take", _collection_, ["Tuple", -1, 1]]`.

```json example
["Reverse", ["List", 5, 2, 10, 18]]
// -> ["List", 18, 10, 2, 5]
```

{% enddef %}

{% enddefs %}
