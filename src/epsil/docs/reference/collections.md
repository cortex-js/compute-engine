---
title: Collections Reference
sidebar_label: Collections
slug: /epsil/reference/collections/
description: "The collections library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from collections.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Collections

A **collection** groups several elements into one value. This page lists
every operation on collections. This introduction gives the concepts you need
before you read the entries: the kinds of collection, indexed and non-indexed
collections, finite and infinite collections, lazy and eager collections, and
element types.

## Kinds of collection

| Kind         | Epsil literal          | Description                                                 |
| :----------- | :--------------------- | :---------------------------------------------------------- |
| list         | `[1, 2, 3]`            | Elements in order, read by index. Duplicates are allowed.  |
| set          | `{1, 2, 3}`            | Unique elements, not in order.                              |
| tuple        | `(1, "a")`             | A fixed number of elements, each with its own type.         |
| dictionary   | `{"a" -> 1, "b" -> 2}` | Key-value pairs. The keys are strings.                      |
| range        | `1..10`                | Numbers from a start to an end, with an optional step.      |
| string       | `"hello"`              | The characters of the text, in order.                       |

A set literal removes duplicates and stores its elements in the canonical
order, so two sets with the same elements are written, printed and walked
alike. The empty set is `{}`, and the empty dictionary is `{->}`:

```epsil
{3, 1, 3, 2}
// ➔ Set(1, 2, 3)
```

Collections are **immutable**. An operation never changes a collection: it
returns a new one.

```epsil
let xs = [1, 2, 3]
let ys = append(xs, 4)
xs
// ➔ [1, 2, 3]
```

A string is a collection of its characters, so `length`, `reverse`, `sort`,
`filter` and most other operations apply to it. An operation that selects or
reorders the characters of a string (`reverse`, `take`, `sort`, `unique`,
`filter`) returns a string. An operation that transforms the elements (`map`,
`flatMap`, `scan`, `zip`) returns a list.

```epsil
reverse("stressed")
// ➔ "desserts"
```

```epsil
filter("banana", c => c != "a")
// ➔ "bnn"
```

## Indexed and non-indexed collections

An **indexed** collection has its elements in a fixed order, and you can read
an element by its position. Lists, tuples, ranges and strings are indexed.

A **non-indexed** collection has no positions. You can enumerate its elements
and test membership, but you cannot read an element by index. Sets and
dictionaries are non-indexed. You read a dictionary value by its key.

The first element has index `1`. A negative index counts from the end of a
finite collection: `-1` is the last element, `-2` the element before it.

```epsil
[2, 5, 7, 11][3]
// ➔ 7
```

```epsil
[2, 5, 7, 11][-3]
// ➔ 5
```

```epsil
{a -> 1, b -> 2}["b"]
// ➔ 2
```

An index that is out of range does not stop the program. It gives an absence
marker: `NaN` when the elements are numbers, `Missing` otherwise. See
[at](#at) for the details.

Membership works on every collection:

```epsil
3 in {1, 2, 3}
// ➔ true
```

## Nested collections

The elements of a collection are its **top-level** elements. A matrix (a list
of lists) is a collection of rows. So `count` of a matrix is its number of
rows, and `first` is its first row:

```epsil
count([[2, 3, 4], [6, 7, 9]])
// ➔ 2
```

```epsil
first([[2, 3, 4], [6, 7, 9]])
// ➔ [2, 3, 4]
```

To read one entry of a nested collection, give one index per level:

```epsil
[[2, 3, 4], [6, 7, 9]][2, 3]
// ➔ 9
```

The [Linear Algebra](/epsil/reference/linear-algebra/) page has the
operations on vectors, matrices and tensors.

## Finite and infinite collections

A collection can be **finite** (it has a definite number of elements) or
**infinite**. `1..oo` is the positive integers, and the number sets such as
`integers`, `realNumbers` and `primes` are infinite sets.

```epsil
count(1..oo)
// ➔ +oo
```

## Lazy and eager collections

An **eager** collection has all its elements computed when it is made. The
list, set, tuple and dictionary literals are eager.

A **lazy** collection computes an element only when something reads it. A
range, `map`, `filter`, `take`, a comprehension, `cycle`, `iterate` and
`repeat` make lazy collections. Because of this, you can work with an
infinite collection when you read only a finite part of it:

```epsil
1..oo |> filter(isPrime) |> take(10) |> listFrom
// ➔ [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
```

Only the first ten primes are computed here. The elements of a lazy
collection are computed on the first read and kept, so a second read of the
same collection does not compute them again. The kept elements are computed
again when a value they depend on changes.

**To materialize** a lazy collection, that is to compute all its elements and
make an eager collection, use [listFrom](#listfrom) or [setFrom](#setfrom):

```epsil
listFrom(1..10)
// ➔ [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
```

When a lazy collection is printed, only its first elements are computed. An
ellipsis shows that more elements follow:

```epsil
map(x => x^2, 1..oo)
// ➔ [1, 4, 9, 16, 25, …]
```

### Use a range, not a number set, as an infinite indexed source

`integers` and the other number sets are **sets**. They have no order and no
indexes. The operations that need an indexed collection (`at`, `take`,
`drop`, `first`, `second`, `third`, `last`, `rest`, `most`) reject them with
an `incompatible-type` error. `filter` keeps the kind of its source, so
`filter(integers, x => x > 0)` is a set too.

For an infinite source that you can index and take from, use `1..oo`. To test
membership in a number set, use `in`:

```epsil
filter(1..30, x => x in primes)
// ➔ [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
```

### The materialization cap

The engine setting `maxCollectionSize` (default `10000`) limits how many
elements a lazy collection can have when the engine changes it into a list
by itself, for example to print or evaluate a result. Such an automatic
conversion keeps the lazy form when the list would be larger. You can still
read the elements one at a time, and operations such as `length` still work.
An explicit conversion with `listFrom` or `setFrom` does not check the
setting: `listFrom(1..20000)` makes the whole list.

```epsil
repeat(7, 3)
// ➔ [7, 7, 7]
```

```epsil
repeat(7, 20000)
// ➔ Repeat(7, 20000)
```

```epsil
length(repeat(7, 20000))
// ➔ 20000
```

The cap applies only to materialization. An operation applied to each element
of a lazy collection (such as `+` over a range) is not limited by it.

## Element types

The type of a collection includes the type of its elements: `list<integer>`,
`set<string>`, `tuple<integer, string>`, `dictionary<number>`. A dictionary
with a fixed set of known keys has a record type, such as
`record{x: integer}`. A list of numbers with a known length has a vector type,
such as `vector<integer^3>`.

```epsil
(type([1, 2, 3]), type({1, 2}), type((1, "a")), type({x -> 1}))
// ➔ (TypeFrom("vector<integer^3>"), TypeFrom("set<integer>"), TypeFrom("tuple<integer, string>"), TypeFrom("record{x: integer}"))
```

When the elements have different types, the element type is their union:

```epsil
type(["a", 1])
// ➔ TypeFrom("list<integer | string>")
```

In a signature, `collection` means any collection, indexed or not, finite or
infinite. `indexed_collection` means a collection that you can read by index,
such as a list, a tuple, a range or a string.

## Functions as arguments

Many operations take a function: a predicate for `filter`, `any` or
`countIf`, a key for `sort` or `groupBy`, a reducer for `reduce`. You can
write it as an anonymous function, `x => x > 5`, or as an expression with the
placeholder `_`, `_ > 5`:

```epsil
countIf([5, 2, 10, 18], _ > 5)
// ➔ 2
```

### Where the function goes

An operation that takes one collection and a function takes the collection
first and the function second: `filter(xs, p)`, `flatMap(xs, f)`,
`sort(xs, key)`, `reduce(xs, f, initial)`.

`map` is the exception: the function is its first argument, `map(f, xs)`.
`map` takes any number of collections and calls the function with one element
of each, so the function has the one fixed position and the collections
follow it:

```epsil
map((x, y) => x + y, [1, 2, 3], [10, 20, 30])
// ➔ [11, 22, 33]
```

`fold(f, initial, xs)` also takes its function first. It is `reduce` with the
arguments in another order.

An argument in the wrong position is an `incompatible-type` error:
`map([1, 2, 3], x => x^2)` reports that the list is not a function. When the
two arguments are in each other's place, the diagnostic says that they look
exchanged, and its fixit exchanges them.

The pipe `|>` passes a collection to the next operation, so a sequence of
operations reads from left to right. The collection fills the argument slot
the operation is missing, so the pipe is the same for both orders:
`xs |> filter(isPrime)` is `filter(xs, isPrime)`, and `xs |> map(f)` is
`map(f, xs)`. A
[comprehension](/epsil/syntax/#comprehensions) is another way to make a
filtered and transformed list:

```epsil
1..10 |> filter(isPrime) |> map(x => x^2)
// ➔ [4, 9, 25, 49]
```

```epsil
[x^2 for x in 1..10 if x % 2 == 1]
// ➔ [1, 9, 25, 49, 81]
```

See [Pipe](/epsil/operators/#pipe) for the complete rules of the pipe.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### adjoin

MathJSON `Adjoin` · `(set<any>, any+) -> set`

- argument 1 — The base ring. Sample: `integers`.
- arguments 2, … — An element adjoined to the ring: an algebraic number, or a symbol for an indeterminate. Sample: `sqrt(2)`.

The ring obtained by adjoining one or more elements to a base ring.

`Adjoin(Integers, Sqrt(2))` is ℤ[√2]; `Adjoin(Integers, ["Complex", 0, 1])` is the Gaussian integers ℤ[i]; `Adjoin(Integers, "x")` is the polynomial ring ℤ[x].

Inert: the adjunction is not expanded, and membership in it is not decided.

```epsil
adjoin(integers, sqrt(2))
// ➔ Adjoin(integers, sqrt(2))
```

### all

MathJSON `All` · `(xs: collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

- `xs` — The collection to test; for an empty collection the result is True. Sample: `[2, 4, 6]`.
- `predicate` — The test of each element; without it, each element must be True. Sample: `x => x > 1`.

Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given).

```epsil
all([2, 4, 6], x => x % 2 == 0)
// ➔ true
```

### any

MathJSON `Any` · `(xs: collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

- `xs` — The collection to test; for an empty collection the result is False. Sample: `[1, 3, 4]`.
- `predicate` — The test of each element; without it, an element must be True. Sample: `x => x > 1`.

Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given).

To test membership of a specific value, use `Contains(xs, v)` — the structural-identity specialization `Any(xs, (e) => e === v)`.

```epsil
any([1, 3, 4], x => x % 2 == 0)
// ➔ true
```

### append

MathJSON `Append` · `(collection<any>, any+) -> collection`

- argument 1 — The collection to extend. Sample: `[1, 2]`.
- arguments 2, … — An element to add, after the elements before it. Sample: `3`.

Return the collection with one or more elements added at its end.

```epsil
append([1, 2], 3, 4)
// ➔ [1,2,3,4]
```

### argMax

MathJSON `ArgMax` · `(xs: indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

- `xs` — The collection to search; an empty collection leaves the call unevaluated. Sample: `[3, 9, 2]`.
- `key` — The function whose values are compared; without it, the elements themselves are compared. Sample: `x => x^2`.

Return the 1-based index of the element that maximizes the given key function (or of the largest element when no key is given); of several such elements, the first.

```epsil
argMax([3, 9, 2])
// ➔ 2
```

### argMin

MathJSON `ArgMin` · `(xs: indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

- `xs` — The collection to search; an empty collection leaves the call unevaluated. Sample: `[3, 9, 2]`.
- `key` — The function whose values are compared; without it, the elements themselves are compared. Sample: `x => x^2`.

Return the 1-based index of the element that minimizes the given key function (or of the smallest element when no key is given); of several such elements, the first.

```epsil
argMin([3, 9, 2])
// ➔ 3
```

### At

`(value: any, index: (boolean | character | indexed_collection<any> | number | string)+) -> unknown`

Access an element of an indexed collection.

If the index is negative, it is counted from the end.

Multiple indices can be provided to access nested collections (e.g., matrices).

If the index is a finite collection of booleans, returns the elements where the mask is True (a mask is a filter over the positions up to the shorter of the mask and the collection; a `Missing` or `NaN` member keeps nothing).

If the index is a finite collection of integers, returns the elements at those indices, preserving position: an out-of-range index yields the absence marker, it is not dropped.

Out-of-band access (an out-of-range index, or a dictionary key that is not present) yields a POSITION-PRESERVING marker: `NaN` when the collection’s elements are numeric, `Missing` otherwise. It never yields `Nothing`, which would erase the position.

An index that is provably not an integer (`2.5`, `3/2`, `5 + √17`), as a scalar or as an entry of an index list, selects no element and yields the same marker. An index that cannot be decided (an unknown, an exact constant within rounding of an integer) leaves `At` unevaluated.

```epsil
[10, 20, 30][2]
// ➔ 20
```

```epsil
[10, 20, 30][-1]
// ➔ 30
```

### chunk

MathJSON `Chunk` · `((xs: S, count: integer) -> list<string> where S: string) & ((xs: indexed_collection, count: integer) -> list<list>)`

- `xs` — The list or string to split. Sample: `[1, 2, 3, 4, 5, 6]`.
- `count` — The number of groups, at least 1; each group has ⌈length / count⌉ elements except the last ones, which can be shorter or empty. Sample: `3`.

Return the collection split into `count` groups of consecutive elements. See `Partition` for splitting into fixed-size chunks.

```epsil
chunk([1, 2, 3, 4, 5, 6], 3)
// ➔ [[1,2],[3,4],[5,6]]
```

### chunkBy

MathJSON `ChunkBy` · `((xs: S, key: (character) any -> unknown) -> list<string> where S: string) & ((xs: indexed_collection<T>, key: (T) any -> unknown) -> list<list<T>> where T: any)`

- `xs` — The list or string to split. Sample: `[1, 3, 2, 4, 5]`.
- `key` — The function of each element; a new run starts where its value changes. Sample: `x => x % 2`.

Split the collection into maximal runs of consecutive elements over which the key function yields the same value.

Returns a list of lists. Unlike `GroupBy`, only adjacent elements are grouped, so a key value that recurs after a different run starts a new chunk.

```epsil
chunkBy([1, 3, 2, 4, 5], x => x % 2)
// ➔ [[1,3],[2,4],[5]]
```

### closed

MathJSON `Closed` · `(number) -> number`

- argument 1 — The endpoint to include in the interval. Sample: `1`.

Closed(x): the endpoint x of an Interval, marked as included. A marker with no value of its own; Interval normalizes it away.

```epsil
1 in interval(0, closed(1))
// ➔ true
```

### complement

MathJSON `Complement` · `(set<any>+) -> set`

- arguments 1, … — The sets: the first one, then the sets whose elements are removed from it. Sample: `{1, 2, 3, 4}`.

Return the elements of the first set that are not in any of the subsequent sets.

```epsil
listFrom(complement({1, 2, 3, 4}, {2, 4}))
// ➔ [1,3]
```

### complexNumbers

MathJSON `ComplexNumbers` · constant `set<complex>`

The set of all finite complex numbers.

```epsil
2 + 3i in complexNumbers
// ➔ true
```

### contains

MathJSON `Contains` · `(xs: collection<any>, element: any) -> boolean`

- `xs` — The collection to search; the elements of a string are its characters. Sample: `[1, 2, 3]`.
- `element` — The value to find, compared structurally. Sample: `2`.

Return True if the collection contains the given element (structural identity, like `===`), False otherwise. An absent element is found where the same marker sits: `Contains([1, NaN], NaN)` is True.

Equivalent to `Any(xs, (e) => e === v)`; use `Any` to test an arbitrary predicate instead of a specific value.

```epsil
contains([1, 2, 3], 2)
// ➔ true
```

### containsSequence

MathJSON `ContainsSequence` · `(xs: indexed_collection<T>, needle: indexed_collection<T>) -> boolean where T`

- `xs` — The list or string to search. Sample: `[1, 2, 3, 4]`.
- `needle` — The run of consecutive elements to find; an empty needle is always found. Sample: `[2, 3]`.

Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection.

Unlike `Contains`, which tests membership of a single element, the needle is read as a sequence: `ContainsSequence("abc", "ab")` is `True` while `Contains("abc", "ab")` is `False`.

```epsil
containsSequence([1, 2, 3, 4], [2, 3])
// ➔ true
```

### count

MathJSON `Count` · `(xs: collection<any>, element: any?, levels: any?) -> infinity | integer`

- `xs` — The collection; with no other argument, the result is its number of elements, `+oo` for an unbounded one. Sample: `[1, 2, 1, 3, 1]`.
- `element` — The value to count, compared structurally, or a predicate that each counted element satisfies. Sample: `1`.
- `levels` — The levels of a nested list to count in, with a value to count: `n` for the levels 1 to `n`, `[n]` for the level `n` only, `[from, to]` for a range. Sample: `2`.

`Count(xs)`: the number of elements in the collection.

`Count(xs, v)`: how many elements are structurally the same as `v`.

`Count(xs, p)`: how many elements satisfy the predicate `p`.

```epsil
count([1, 2, 1, 3, 1], 1)
// ➔ 3
```

### countIf

MathJSON `CountIf` · `(xs: collection<T>, predicate: (T) any -> boolean) -> integer where T`

- `xs` — The collection whose elements are counted. Sample: `[1, 4, 9, 16]`.
- `predicate` — The test that each counted element passes. Sample: `x => x > 5`.

Return the number of elements in the collection satisfying the predicate.

```epsil
countIf([1, 4, 9, 16], x => x > 5)
// ➔ 2
```

### cycle

MathJSON `Cycle` · `(list<any>) -> list`

- argument 1 — The list to repeat; an empty list gives an empty list. Sample: `[1, 2]`.

Produce an infinite sequence by cycling through the elements of a finite collection.

```epsil
take(cycle([1, 2]), 5)
// ➔ [1,2,1,2,1]
```

### dedup

MathJSON `Dedup` · `(collection<any>) -> collection`

- argument 1 — The collection or string to collapse. Sample: `[1, 1, 2, 2, 1]`.

Return the collection with consecutive duplicate elements collapsed to a single element.

Only immediately-adjacent equal elements are removed; unlike `Unique`, a value that recurs after a different element is kept.

```epsil
dedup([1, 1, 2, 2, 1])
// ➔ [1,2,1]
```

### deleteAt

MathJSON `DeleteAt` · `((xs: T, index: integer) -> T where T: string) & ((xs: indexed_collection<T>, index: integer) -> list<T> where T: any) & ((xs: dictionary<V>, key: string) -> dictionary<V> where V: any)`

- `xs` — The list, string, dictionary or record to copy without one element. Sample: `[1, 2, 3, 4]`.
- `index` — The 1-based position of the element to remove; a negative index counts from the end, and 0 or an index out of range leaves the call unevaluated. Sample: `2`.
- `key` — The key of the entry to remove; a key that is not there gives the value unchanged. Sample: `"b"`.

Return a copy of the indexed collection with the element at the 1-based `index` removed.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

Deleting from a string yields a string.

On a dictionary or a record, `DeleteAt(d, key)` returns a copy without the entry of the string `key`; `d` does not change. A key that is not there gives the value unchanged. The type of a record loses the field (`record{a: integer, b: string?}` gives `record{a: integer}`); with a key known only at evaluation, every field of the record becomes optional.

A value of a declared (nominal) record type is not a collection, so `DeleteAt` refuses it, as `At` does.

```epsil
deleteAt([1, 2, 3, 4], 2)
// ➔ [1,3,4]
```

```epsil
deleteAt({a -> 1, b -> "x"}, "b")
// ➔ {"a" -> 1}
```

### Dictionary

`(tuple<string, unknown>*) -> dictionary`

A collection of key -&gt; value entries with string keys (`{x -> 1, y -> 2}` in Epsil).

```epsil
{"a" -> 1, "b" -> 2}["b"]
// ➔ 2
```

### dictionaryFrom

MathJSON `DictionaryFrom` · `(collection<any>) -> dictionary`

- argument 1 — The (key, value) pairs; a later pair with the same key replaces an earlier one. Sample: `[("a", 1), ("b", 2)]`.

Create a dictionary from the elements of a collection of (key, value) pairs.

```epsil
dictionaryFrom([("a", 1), ("b", 2)])
// ➔ {"a" -> 1, "b" -> 2}
```

### differences

MathJSON `Differences` · `(indexed_collection<any>) -> indexed_collection`

- argument 1 — The list of numbers; a list of one element gives an empty list. Sample: `[1, 4, 9, 16]`.

Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input.

```epsil
differences([1, 4, 9, 16])
// ➔ [3,5,7]
```

### drop

MathJSON `Drop` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T: any)`

- `xs` — The list or string. Sample: `[1, 2, 3, 4, 5]`.
- `count` — The number of elements to drop; a negative count drops the last elements, and a count past the length gives an empty result. Sample: `2`.

Return the indexed collection without its first `count` elements.

A negative `count` counts from the end: `Drop(xs, -n)` is the collection without its last `n` elements.

A count past the length is clamped: the result is empty.

```epsil
drop([1, 2, 3, 4, 5], 2)
// ➔ [3,4,5]
```

```epsil
drop([1, 2, 3, 4, 5], -2)
// ➔ [1,2,3]
```

### dropWhile

MathJSON `DropWhile` · `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> indexed_collection where T`

- `xs` — The collection whose leading elements are dropped. Sample: `[1, 2, 3, 10, 4]`.
- `predicate` — The test of the leading elements; dropping stops at the first element that fails it. Sample: `x => x < 5`.

Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered.

```epsil
dropWhile([1, 2, 3, 10, 4], x => x < 5)
// ➔ [10,4]
```

### Element

`(any, any, boolean?) -> boolean`

Test whether a value is an element of a collection. Optional third argument is a boolean expression (condition) for filtered iteration in Sum/Product.

Element supports two modes of operation:
1. Set membership: Element(3, [List, 1, 2, 3]) checks if 3 is in the list
2. Type-style membership: Element(x, integer) checks if x has type integer

Type-style membership works with:
- Mathematical sets: Integers, RealNumbers, ComplexNumbers, etc.
- Type names: integer, rational, real, number, positive_integer, etc.
- Invalid type names remain unevaluated (e.g., Element(2, "Booleans"))

```epsil
3 in {1, 2, 3}
// ➔ true
```

### emptySet

MathJSON `EmptySet` · constant `set`

The empty set, a set containing no elements.

```epsil
isEmpty(emptySet)
// ➔ true
```

### endsWith

MathJSON `EndsWith` · `(xs: indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T`

- `xs` — The list or string to test. Sample: `[1, 2, 3]`.
- `suffix` — The run of elements that must end the collection. Sample: `[2, 3]`.

Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence.

On a string the suffix is matched character by character, so a suffix that would begin inside a grapheme cluster does not match. An empty suffix matches everything.

```epsil
endsWith([1, 2, 3], [2, 3])
// ➔ true
```

### extendedComplexNumbers

MathJSON `ExtendedComplexNumbers` · constant `set<complex | infinity>`

The set of all complex numbers, including infinities.

```epsil
complexInfinity in extendedComplexNumbers
// ➔ true
```

### extendedIntegers

MathJSON `ExtendedIntegers` · constant `set<integer | signed_infinity>`

The set of all integers, including infinities.

```epsil
Infinity in extendedIntegers
// ➔ true
```

### extendedRationalNumbers

MathJSON `ExtendedRationalNumbers` · constant `set<rational | signed_infinity>`

The set of all rational numbers, including infinities.

```epsil
-Infinity in extendedRationalNumbers
// ➔ true
```

### extendedRealNumbers

MathJSON `ExtendedRealNumbers` · constant `set<real | signed_infinity>`

The set of all real numbers, including infinities.

```epsil
-Infinity in extendedRealNumbers
// ➔ true
```

### field

MathJSON `Field` · `(value: any, field: string) -> unknown`

- `value` — The record, the dictionary, or the value of a nominal type with named fields. Sample: `{x -> 1, y -> 2}`.
- `field` — The name of the field. Sample: `"y"`.

Return the named field of a value: `p.x` in Epsil.

On a record or dictionary value, `Field(d, "x")` behaves exactly as `d["x"]` (`At` semantics, including the absence marker for a key a dictionary may not have).

On a value of a NOMINAL type whose definition body has named fields (a record body, or a named-tuple body), the field is resolved through the type definition — the sanctioned accessor window of the nominal-types design (D6/§4.5b D16). This does not make the value a collection: `First(p)` and `p["x"]` keep rejecting.

A field name that is not in a record/named-tuple definition is a static defect (the result type is `error`); on an unknown-typed operand the expression stays symbolic.

Record types are closed: on an operand of a record type, a field name that the type does not list is refused when the expression is boxed (`unknown-field`). An optional field (`b: string?`) that the value leaves out reads as the absent value of its type: `Missing`, or `NaN` for a numeric field.

```epsil
{x -> 1, y -> 2}.y
// ➔ 2
```

### filter

MathJSON `Filter` · `(xs: collection<T>, predicate: (T) any -> boolean) -> collection where T`

- `xs` — The collection to filter. Sample: `[1, 2, 3, 4, 5, 6]`.
- `predicate` — The test that each kept element passes. Sample: `x => x > 2`.

Return the elements of the collection for which the predicate function returns True.

Equivalent to `[x for x in xs if p(x)]`.

The collection is the first argument and the predicate the second. `Map` has the opposite order, `Map(f, xs)`, because it takes any number of collections after its function.

```epsil
filter([1, 2, 3, 4, 5, 6], x => x % 2 == 0)
// ➔ [2,4,6]
```

### find

MathJSON `Find` · `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> any where T: any`

- `xs` — The collection to search, from its first element. Sample: `[1, 4, 9, 16]`.
- `predicate` — The test that the element found passes. Sample: `x => x > 5`.

Return the first element of the collection satisfying the predicate. When no element satisfies it, return the absent value of the domain of the elements: `NaN` for numbers, a point whose coordinates are all `NaN` for points, and `Missing` otherwise.

```epsil
find([1, 4, 9, 16], x => x > 5)
// ➔ 9
```

### first

MathJSON `First` · `(xs: indexed_collection<any>, default: any?) -> any`

- `xs` — The list or string. Sample: `[7, 8, 9]`.
- `default` — The result for an empty collection; without it, an empty collection gives the absent value of its elements, `NaN` for numbers and `Missing` otherwise. Sample: `0`.

The first element of a collection.

```epsil
first([7, 8, 9])
// ➔ 7
```

### flatMap

MathJSON `FlatMap` · `(xs: collection<T>, mapping: (T) any -> U) -> list where T, U`

- `xs` — The collection to map over. Sample: `[1, 2, 3]`.
- `mapping` — The function applied to each element; a collection result other than a string is spliced into the result, and a string or any other value is kept as one element. Sample: `x => [x, x]`.

Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements.

The collection is the first argument, as for `Filter`. `Map` has the opposite order, `Map(f, xs)`, because it takes any number of collections after its function.

```epsil
flatMap([1, 2, 3], x => [x, x])
// ➔ [1,1,2,2,3,3]
```

### fold

MathJSON `Fold` · `(reducer: (unknown, T) any -> unknown, initial: value, xs: collection<T>) -> value where T`

- `reducer` — The function of the accumulator and the next element, which returns the new accumulator. Sample: `(acc, x) => acc + x`.
- `initial` — The accumulator before the first element, and the result for an empty collection. Sample: `0`.
- `xs` — The collection, read from its first element to its last. Sample: `[1, 2, 3, 4]`.

Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value.

The function is the first argument and the collection the last. `Reduce` does the same with the collection first: `Reduce(xs, f, initial)`.

```epsil
fold((a, b) => a + b, 0, [1, 2, 3, 4])
// ➔ 10
```

### groupBy

MathJSON `GroupBy` · `(xs: collection<T>, key: (T) any -> unknown) -> dictionary<list> where T`

- `xs` — The collection to group. Sample: `[1, 2, 3, 4, 5]`.
- `key` — The function whose value names the group of an element; the keys of the dictionary are its values as strings. Sample: `x => x % 2`.

Partition the collection into a dictionary of lists based on the key returned by the function.

```epsil
groupBy(["apple", "fig", "pear", "kiwi"], length)
// ➔ {"3" -> ["fig"], "4" -> ["pear","kiwi"], "5" -> ["apple"]}
```

### imaginaryNumbers

MathJSON `ImaginaryNumbers` · constant `set<imaginary>`

The set of all imaginary numbers.

```epsil
3i in imaginaryNumbers
// ➔ true
```

### indexOf

MathJSON `IndexOf` · `(xs: indexed_collection<any>, element: any) -> integer`

- `xs` — The list or string to search; the elements of a string are its characters. Sample: `[10, 20, 30]`.
- `element` — The value to find, compared structurally. Sample: `20`.

Return the 1-based index of the first occurrence of value in collection, or 0 if not found. The comparison is structural, so an absent value is found where the same marker sits: `IndexOf([1, NaN], NaN)` is 2. Stays unevaluated when the collection cannot be searched (a symbol with no value, an unbounded source with no match).

```epsil
indexOf([10, 20, 30], 20)
// ➔ 2
```

### indexWhere

MathJSON `IndexWhere` · `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> integer where T`

- `xs` — The collection to search. Sample: `[1, 4, 9, 16]`.
- `predicate` — The test applied to each element, in order. Sample: `x => x > 5`.

Return the 1-based index of the first element satisfying the predicate, or 0 if not found. Stays unevaluated when the collection cannot be searched (a symbol with no value, an unbounded source with no match).

```epsil
indexWhere([1, 4, 9, 16], x => x > 5)
// ➔ 3
```

### insert

MathJSON `Insert` · `(xs: indexed_collection<T>, index: integer, element: T) -> list<T> where T: any`

- `xs` — The collection; a string gives a list of its characters. Sample: `[1, 2, 4]`.
- `index` — The 1-based position of the inserted element, from 1 to n + 1; a negative index counts from the end, -1 appending. Sample: `3`.
- `element` — The value to insert. Sample: `3`.

Return a copy of the indexed collection with `element` inserted before the 1-based `index`.

`index` may range from 1 to n+1 (n+1 appends). A negative index counts from the end, with -1 appending at the end (Elixir semantics).

An out-of-range, zero, or non-integer index leaves the expression unevaluated.

```epsil
insert([1, 2, 4], 3, 3)
// ➔ [1,2,3,4]
```

### integers

MathJSON `Integers` · constant `set<integer>`

The set of all finite integers.

```epsil
-7 in integers
// ➔ true
```

### intersection

MathJSON `Intersection` · `(any+) -> set`

- arguments 1, … — A set or another finite collection, whose duplicate elements count once. Sample: `{1, 2, 3}`.

Return the intersection of one or more collections as a set.

```epsil
intersection({1, 2, 3}, {2, 3, 4})
// ➔ Set(2, 3)
```

### interval

MathJSON `Interval` · `(start: number, end: number) -> set<real>`

- `start` — The lower endpoint, included unless it is wrapped in `Open`; it may be `-oo`. Sample: `0`.
- `end` — The upper endpoint, included unless it is wrapped in `Open`; it may be `+oo`. Sample: `1`.

A set of real numbers between two endpoints. The endpoints may or may not be included.

```epsil
0.5 in interval(0, 1)
// ➔ true
```

### isEmpty

MathJSON `IsEmpty` · `(collection<any>) -> boolean`

- argument 1 — The collection or string to test. Sample: `[1, 2, 3]`.

Return True if the collection is empty, False otherwise.

```epsil
isEmpty([])
// ➔ true
```

### iterate

MathJSON `Iterate` · `(f: function, initial: any?) -> list`

- `f` — The function that computes each element from its 1-based index and the previous element, or from the previous element alone when it takes one argument. Sample: `x => 2x`.
- `initial` — The value before the first element, `Nothing` by default. Sample: `1`.

Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.

The function is invoked as `f(index, acc)`: `index` is the 1-based position of the element being produced, and `acc` is the previous element — the `initial` value when producing element 1. Element `k` is therefore `f(k, element(k-1))`.

A function whose type says it is UNARY is applied to the accumulator alone (`Iterate(2 * _, 1)` produces `[2, 4, 8, 16, …]`); a statically-unknown arity keeps the two-argument form.

```epsil
take(iterate(x => 2x, 1), 5)
// ➔ [2,4,8,16,32]
```

### join

MathJSON `Join` · `((T+) -> T where T: string) & ((collection<any>*) -> collection)`

- arguments 1, … — A collection or string whose elements are spliced into the result (strings alone give their concatenation), or another value, such as a tuple, added as one element. Sample: `"ab"`.

Join the elements of some collections into a flat collection.

A tuple operand is appended as a single element, not spliced.

A scalar operand is appended as a single element too: `Join([1, 2], 3)` is `[1, 2, 3]`.

When every operand is a string, the result is their concatenation as a string: `Join` is the variadic string concatenation.

```epsil
join([1, 2], [3, 4])
// ➔ [1,2,3,4]
```

```epsil
join("ab", "cd")
// ➔ "abcd"
```

### KeyValuePair

`(key: string, value: T) -> tuple<string, T> where T`

A key/value pair

```epsil
Dictionary(KeyValuePair("a", 1), KeyValuePair("b", 2))
// ➔ {"a" -> 1, "b" -> 2}
```

### keys

MathJSON `Keys` · `(dictionary<any>) -> list<string>`

- argument 1 — The dictionary whose keys are listed. Sample: `{"a" -> 1, "b" -> 2}`.

Return a list of the keys of a dictionary.

```epsil
keys({"a" -> 1, "b" -> 2})
// ➔ ["a","b"]
```

### last

MathJSON `Last` · `(xs: indexed_collection<any>, default: any?) -> any`

- `xs` — The collection or string. Sample: `[7, 8, 9]`.
- `default` — The value returned when the collection is empty; without it, an empty collection gives the absent value of its elements, `NaN` for numbers and `Missing` otherwise. Sample: `0`.

The last element of a collection.

```epsil
last([7, 8, 9])
// ➔ 9
```

### length

MathJSON `Length` · `(any) -> infinity | integer`

- argument 1 — The collection or string to measure. Sample: `[5, 6, 7]`.

Number of elements in a collection. Returns +oo for an infinite collection (an unbounded Range, `Integers`, `Repeat(5)`, an interval), as `Count` does, an `incompatible-type` error for an operand that is decidably not a collection, `Missing` for an absent operand, and stays unevaluated for a collection whose size is not known (a `Filter` over an infinite source).

```epsil
length([5, 6, 7])
// ➔ 3
```

```epsil
length("hello")
// ➔ 5
```

### linspace

MathJSON `Linspace` · `(start: number, end: number?, count: number?) -> list<number>`

- `start` — The first value; when it is the only argument, it is the last value and the sequence starts at 1. Sample: `0`.
- `end` — The last value. Sample: `1`.
- `count` — The number of values, 50 by default; 1 gives the start alone, and 0 or less an empty list. Sample: `5`.

A sequence of evenly spaced numbers between a start and end value, both endpoints included.

```epsil
linspace(0, 1, 5)
// ➔ [0,0.25,0.5,0.75,1]
```

### List

`(any*) -> list`

An ordered collection of elements (a list).

```epsil
List(1, 2, 3)
// ➔ [1,2,3]
```

### listFrom

MathJSON `ListFrom` · `(value*) -> list`

- arguments 1, … — A collection whose elements are added to the list in order, or another value that is added as one element. Sample: `[1, 2]`.

Create a list from the elements of a collection.

```epsil
listFrom({1, 2}, 3..4)
// ➔ [1,2,3,4]
```

### ListJoin

`(collection<any>*) -> list`

Join the elements of some collections into a list.

This is the canonical form of a list literal with a spread: `[...a, 0]` is `ListJoin(a, [0])`.

The result is a list whatever the kind of the operands: the elements of a set operand are included in the iteration order of the set, without deduplication.

A tuple operand is included as a single element, and so is a scalar operand.

```epsil
ListJoin(Set(3, 1), [0])
// ➔ [1,3,0]
```

### map

MathJSON `Map` · `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U`

- `mapping` — The function applied to each element, with one argument per collection. Sample: `x => x^2`.
- arguments 2, … — A collection; with several, the result has the length of the shortest. Sample: `[1, 2, 3]`.

Return the collection where each element has been transformed by the mapping function.

With a single collection, equivalent to `[f(x) for x in xs]`. With multiple collections, combines them element-wise (like `zipWith`): 

`Map(f, xs, ys) = [f(x1, y1), f(x2, y2), …]`, with the length of the shortest input.

The mapping function is the first argument, because `Map` takes any number of collections after it. Most other operations that take a function, such as `Filter`, `FlatMap` and `Reduce`, take one collection and put it first: `Filter(xs, p)`. `Map(xs, f)` is an `incompatible-type` error.

```epsil
map(x => x^2, [1, 2, 3])
// ➔ [1,4,9]
```

### maxBy

MathJSON `MaxBy` · `(xs: collection<T>, key: (T) any -> unknown) -> value where T`

- `xs` — The collection to search; the call stays unevaluated when it is empty or infinite. Sample: `["pear", "fig", "apple"]`.
- `key` — The function of one element whose largest value selects the element; the first such element wins a tie. Sample: `x => length(x)`.

Return the element of the collection that maximizes the given key function.

```epsil
maxBy(["pear", "fig", "apple"], length)
// ➔ "apple"
```

### MemberCall

`(receiver: any, member: string, arguments: any*) -> unknown`

Call the member `name` of a value with the value as its first argument: `c.area(2)` in Epsil.

A parse-level node. Canonicalization rewrites it to `Apply(Field(c, "area"), 2)` when the receiver's type declares a field `area` (a stored function is called), or to the bare protocol call `area(c, 2)` when `area` is a protocol function member; a canonical expression never contains it.

### minBy

MathJSON `MinBy` · `(xs: collection<T>, key: (T) any -> unknown) -> value where T`

- `xs` — The collection to search; the call stays unevaluated when it is empty or infinite. Sample: `["pear", "fig", "apple"]`.
- `key` — The function of one element whose smallest value selects the element; the first such element wins a tie. Sample: `x => length(x)`.

Return the element of the collection that minimizes the given key function.

```epsil
minBy(["pear", "fig", "apple"], length)
// ➔ "fig"
```

### most

MathJSON `Most` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T: any)`

- argument 1 — The collection; an empty collection gives an empty result, and a string gives a string. Sample: `[7, 8, 9]`.

Return the collection without the last element.

If the collection has only one element, return an empty collection.

```epsil
most([7, 8, 9])
// ➔ [7,8]
```

### negativeIntegers

MathJSON `NegativeIntegers` · constant `set<integer>`

The set of all negative integers.

```epsil
-3 in negativeIntegers
// ➔ true
```

### negativeNumbers

MathJSON `NegativeNumbers` · constant `set<real>`

The set of all negative real numbers.

```epsil
-0.5 in negativeNumbers
// ➔ true
```

### nonNegativeIntegers

MathJSON `NonNegativeIntegers` · constant `set<integer>`

The set of all non-negative integers.

```epsil
0 in nonNegativeIntegers
// ➔ true
```

### nonNegativeNumbers

MathJSON `NonNegativeNumbers` · constant `set<real>`

The set of all non-negative real numbers.

```epsil
0 in nonNegativeNumbers
// ➔ true
```

### nonPositiveIntegers

MathJSON `NonPositiveIntegers` · constant `set<integer>`

The set of all non-positive integers.

```epsil
0 in nonPositiveIntegers
// ➔ true
```

### nonPositiveNumbers

MathJSON `NonPositiveNumbers` · constant `set<real>`

The set of all non-positive real numbers.

```epsil
0 in nonPositiveNumbers
// ➔ true
```

### NotElement

`(any, any) -> boolean`

Test whether a value is not an element of a collection.

```epsil
4 !in {1, 2, 3}
// ➔ true
```

### NotSubset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict subset of the second.

```epsil
NotSubset({1, 4}, {1, 2, 3})
// ➔ true
```

### NotSuperset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict superset of the second.

```epsil
NotSuperset({1, 2}, {1, 2, 3})
// ➔ true
```

### NotSupersetEqual

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a superset (possibly equal) of the second.

```epsil
NotSupersetEqual({1, 2}, {1, 2, 3})
// ➔ true
```

### numbers

MathJSON `Numbers` · constant `set<number>`

The set of all numbers.

```epsil
2 + 3i in numbers
// ➔ true
```

### open

MathJSON `Open` · `(number) -> number`

- argument 1 — The endpoint to exclude. Sample: `0`.

Open(x): the endpoint x of an Interval, marked as excluded. A marker with no value of its own.

```epsil
0 in interval(open(0), 1)
// ➔ false
```

### ordering

MathJSON `Ordering` · `(xs: indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<integer> where T: any`

- `xs` — The collection to sort. Sample: `[30, 10, 20]`.
- `order` — A key function of one element, or a comparison of two elements (true or a negative number when the first comes first); by default the elements in ascending order. Sample: `x => -x`.

Return the indexes that would sort the collection.

```epsil
ordering([30, 10, 20])
// ➔ [2,3,1]
```

### Pair

`(first: T, second: U) -> tuple<T, U> where T, U`

A tuple of two elements

```epsil
Pair(1, 2)
// ➔ (1, 2)
```

### partition

MathJSON `Partition` · `(xs: indexed_collection<T>, count: ((T) any -> boolean) | integer, step: integer?) -> list<list<T>> where T: any`

- `xs` — The collection or string to split. Sample: `[1, 2, 3, 4, 5]`.
- `count` — The number of elements of each chunk, at least 1; or a predicate that splits the elements into those that pass it and those that do not. Sample: `2`.
- `step` — The distance between the starts of two windows of `count` elements, at least 1; only complete windows are kept. Sample: `1`.

Partition a collection into consecutive chunks each of size `count`; the trailing chunk may be shorter when `count` does not divide the length.

With a third argument `step`, produce sliding windows of length `count` whose starts are `step` apart, keeping only complete windows.

With a predicate function instead of an integer, split into two groups: elements for which the predicate is true, and those for which it is false.

Asymmetry: with no `step`, the trailing partial chunk is included; with an explicit `step`, only complete windows are returned.

See `Chunk` for splitting into a given number of nearly-equal groups.

```epsil
partition([1, 2, 3, 4, 5], 2)
// ➔ [[1,2],[3,4],[5]]
```

```epsil
partition([1, 2, 3, 4, 5], x => x % 2 == 0)
// ➔ [[2,4],[1,3,5]]
```

### pointList

MathJSON `PointList` · `(any+) -> any`

- arguments 1, … — A component of the points: a collection gives one coordinate per point, a single value the same coordinate for every point. Sample: `[1, 2, 3]`.

A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection.

```epsil
pointList([1, 2, 3], [4, 5, 6])
// ➔ [(1, 4),(2, 5),(3, 6)]
```

### pointX

MathJSON `PointX` · `(xs: collection<any> | tuple) -> any`

- `xs` — A point, or a collection of points whose x-coordinates are listed. Sample: `(3, 4)`.

The x-coordinate of a point, broadcasting over a list of points.

```epsil
pointX((3, 4))
// ➔ 3
```

```epsil
pointX([(1, 2), (3, 4)])
// ➔ [1,3]
```

### pointY

MathJSON `PointY` · `(xs: collection<any> | tuple) -> any`

- `xs` — A point, or a collection of points whose y-coordinates are listed. Sample: `(3, 4)`.

The y-coordinate of a point, broadcasting over a list of points.

```epsil
pointY((3, 4))
// ➔ 4
```

### pointZ

MathJSON `PointZ` · `(xs: collection<any> | tuple) -> any`

- `xs` — A point of at least three coordinates, or a collection of such points whose z-coordinates are listed. Sample: `(3, 4, 5)`.

The z-coordinate of a point, broadcasting over a list of points.

```epsil
pointZ((3, 4, 5))
// ➔ 5
```

### position

MathJSON `Position` · `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> list<integer> where T: any`

- `xs` — The collection to search. Sample: `[1, 4, 9, 16]`.
- `predicate` — The test applied to each element; the 1-based index of each element that passes it is in the result. Sample: `x => x > 5`.

Return a list of indexes of elements in the collection satisfying the predicate.

```epsil
position([1, 4, 9, 16], x => x > 5)
// ➔ [3,4]
```

### positiveIntegers

MathJSON `PositiveIntegers` · constant `set<integer>`

The set of all positive integers.

```epsil
0 in positiveIntegers
// ➔ false
```

### positiveNumbers

MathJSON `PositiveNumbers` · constant `set<real>`

The set of all positive real numbers.

```epsil
0 in positiveNumbers
// ➔ false
```

### primes

MathJSON `Primes` · constant `set<integer>`

The set of all prime numbers.

```epsil
filter(1..30, x => x in primes)
// ➔ [2,3,5,7,11,13,17,19,23,29]
```

### quotientRing

MathJSON `QuotientRing` · `(set<any>, any) -> set`

- argument 1 — The ring; only `Integers` gives a finite collection, another ring stays inert. Sample: `integers`.
- argument 2 — The generator of the ideal, the modulus `n` for `Integers`. Sample: `5`.

The quotient of a ring by the ideal generated by the second argument.

`QuotientRing(Integers, n)` is ℤ/nℤ, the integers modulo `n`.

For an integer literal `n` ≥ 1 it is a finite collection with `n` elements, and `Count` answers. A symbolic modulus, or a base other than `Integers`, stays inert.

The elements of ℤ/nℤ are `ResidueClass(0, n)` … `ResidueClass(n - 1, n)`, which it lists, and the element type is `value`. `Element(ResidueClass(k, n), ℤ/nℤ)` is `True`. An integer is not an element: `Element(7, ℤ/5ℤ)` is `False`, because 7 is a representative of a class, not the class.

```epsil
quotientRing(integers, 5)
// ➔ QuotientRing(integers, 5)
```

### randomShuffle

MathJSON `RandomShuffle` · `((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T: any)`

- argument 1 — The collection or string to shuffle. Sample: `"abcd"`.

Randomize the order of the elements in the collection. Shuffling a string yields a string. Wrap the call in `WithRandomSeed(seed, ...)` to make it deterministic.

```epsil
randomShuffle([1, 2, 3, 4])
```

### Range

`(number, number?, step: number?) -> list<number>`

A sequence of numbers from a start to an end value with an optional step.

```epsil
1..5
// ➔ [1,2,3,4,5]
```

```epsil
Range(1, 10, 3)
// ➔ [1,4,7,10]
```

### rangeOf

MathJSON `RangeOf` · `(xs: indexed_collection<T>, needle: indexed_collection<T>, from: integer?) -> missing | range where T`

- `xs` — The collection to search. Sample: `[10, 20, 30, 40]`.
- `needle` — The run of consecutive elements to find. Sample: `[30, 40]`.
- `from` — The 1-based index where the search starts, 1 by default. Sample: `2`.

Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `Missing` when it does not occur.

The search starts at index `from` (1 by default) and the span is always expressed in the original collection's indices, so `RangeOf(xs, needle, Last(r) + 1)` finds the next non-overlapping occurrence and the loop ends at `Missing`.

On a string the needle is matched character by character, so a match never begins or ends inside a grapheme cluster.

```epsil
rangeOf([10, 20, 30, 40], [30, 40])
// ➔ [3,4]
```

### rationalNumbers

MathJSON `RationalNumbers` · constant `set<rational>`

The set of all finite rational numbers.

```epsil
sqrt(2) in rationalNumbers
// ➔ false
```

### realNumbers

MathJSON `RealNumbers` · constant `set<real>`

The set of all finite real numbers.

```epsil
i in realNumbers
// ➔ false
```

### reduce

MathJSON `Reduce` · `(xs: collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T`

- `xs` — The collection to fold; an empty one gives `initial`, or `Nothing` without it. Sample: `[1, 2, 3, 4]`.
- `reducer` — The function of the accumulated value and the next element that gives the new accumulated value. Sample: `(a, b) => a * b`.
- `initial` — The accumulated value before the first element; without it, the first element. Sample: `1`.

Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value.

```epsil
reduce([1, 2, 3, 4], (a, b) => a * b)
// ➔ 24
```

### repeat

MathJSON `Repeat` · `(value: any, count: integer?) -> list`

- `value` — The value to repeat; a value that is not pure is evaluated again for each element. Sample: `0`.
- `count` — The number of copies, 0 or less for an empty list; without it the sequence is infinite. Sample: `3`.

Produce a sequence by repeating a single value. With 1 argument, returns an infinite sequence; with 2 arguments (value, count), returns a finite list of `count` copies. A value that is not pure (`Random()`) is evaluated once per element, in order, and each read of an element of a lazy `Repeat` evaluates it again.

```epsil
repeat(0, 3)
// ➔ [0,0,0]
```

### replaceAt

MathJSON `ReplaceAt` · `((xs: indexed_collection<T>, index: integer, element: T) -> list<T> where T: any) & ((xs: indexed_collection<any>, index: integer, integer, any+) -> list<any>)`

- `xs` — The collection; a string gives a list of its characters. Sample: `[1, 2, 3]`.
- `index` — The 1-based position of the element to replace; a negative index counts from the end. With more positions, the position in the outermost level. Sample: `2`.
- `element` — The new element. Sample: `20`.

Return a copy of the indexed collection with the element at the 1-based `index` replaced by `element`.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

With more than one position, as `At` takes them, the last operand is the value, and each position selects one level of a nested collection (e.g., a matrix).

```epsil
replaceAt([1, 2, 3], 2, 20)
// ➔ [1,20,3]
```

```epsil
replaceAt([[1, 2], [3, 4]], 2, 1, 9)
// ➔ [[1,2],[9,4]]
```

### residueClass

MathJSON `ResidueClass` · `(k: any, n: any) -> residue`

- `k` — The representative of the class, an exact integer or a rational whose denominator is a unit mod `n`. Sample: `7`.
- `n` — The modulus, an exact integer literal ≥ 1. Sample: `5`.

An element of ℤ/nℤ: the class of the integer `k` modulo `n`.

The canonical form reduces `k` into 0…n−1, so `ResidueClass(7, 5)` is `ResidueClass(2, 5)`, and two classes are equal when their canonical forms are. `n` must be an exact integer literal ≥ 1, and `k` an exact integer (or a rational with a denominator that is a unit mod `n`); any other call stays inert, a float `k` or `n` included.

Sums, differences, products and integer powers of classes of one modulus are classes. An exact integer or rational next to a class is read in its ring: `ResidueClass(5, 7) + 3` is `ResidueClass(1, 7)`. A float is not. Arithmetic on classes of different moduli stays unevaluated. The inverse, a division and a negative power need a unit: when `gcd(k, n) ≠ 1` they stay unevaluated.

Classes are not ordered, and `Mod` is not this: `Mod(7, 5)` is the integer remainder 2. The elements of `QuotientRing(Integers, n)` are the classes `ResidueClass(0, n)` … `ResidueClass(n - 1, n)`.

LaTeX: `\overline{k}_{n}`, for integer literals `k` and `n ≥ 1`.

```epsil
residueClass(7, 5)
// ➔ ResidueClass(2, 5)
```

```epsil
residueClass(5, 7) + residueClass(4, 7)
// ➔ ResidueClass(2, 7)
```

```epsil
1 / residueClass(3, 7)
// ➔ ResidueClass(5, 7)
```

### rest

MathJSON `Rest` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T: any)`

- argument 1 — The collection or string; an empty one gives an empty result. Sample: `"abc"`.

Return the collection without the first element.

If the collection has only one element, return an empty collection.

```epsil
rest([7, 8, 9])
// ➔ [8,9]
```

### reverse

MathJSON `Reverse` · `((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T: any)`

- argument 1 — The collection to reverse; a string gives the string of its characters in reverse order. Sample: `[1, 2, 3]`.

Reverse the order of the elements of an indexed collection.

```epsil
reverse([1, 2, 3])
// ➔ [3,2,1]
```

### rotateLeft

MathJSON `RotateLeft` · `((xs: T, n: integer?) -> T where T: string) & ((xs: T, n: integer?) -> T where T: list) & ((xs: indexed_collection<T>, n: integer?) -> list<T> where T: any)`

- `xs` — The collection to rotate; a string gives a string. Sample: `[1, 2, 3, 4]`.
- `n` — The number of positions, 1 by default; a negative `n` rotates to the right, and `n` is taken modulo the length. Sample: `2`.

Rotate the elements of the collection to the left by n positions.

```epsil
rotateLeft([1, 2, 3, 4])
// ➔ [2,3,4,1]
```

### rotateRight

MathJSON `RotateRight` · `((xs: T, n: integer?) -> T where T: string) & ((xs: T, n: integer?) -> T where T: list) & ((xs: indexed_collection<T>, n: integer?) -> list<T> where T: any)`

- `xs` — The collection to rotate; a string gives a string. Sample: `[1, 2, 3, 4]`.
- `n` — The number of positions, 1 by default; a negative `n` rotates to the left, and `n` is taken modulo the length. Sample: `2`.

Rotate the elements of the collection to the right by n positions.

```epsil
rotateRight([1, 2, 3, 4])
// ➔ [4,1,2,3]
```

### scan

MathJSON `Scan` · `(xs: indexed_collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T`

- `xs` — The collection to scan, in its order; an empty collection gives an empty result. Sample: `[1, 2, 3, 4]`.
- `reducer` — A function of the running result and the next element that returns the new running result. Sample: `(acc, x) => acc + x`.
- `initial` — The value the running result starts from; without it, the first element of the result is the first element of the collection. Sample: `0`.

Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value).

```epsil
scan([1, 2, 3, 4], (a, b) => a + b)
// ➔ [1,3,6,10]
```

### second

MathJSON `Second` · `(xs: indexed_collection<any>) -> any`

- `xs` — The collection; one with fewer than two elements gives `Missing`, or `NaN` when its elements are numbers. Sample: `[7, 8, 9]`.

The second element of a collection.

```epsil
second([7, 8, 9])
// ➔ 8
```

### Set

`(any*) -> set`

An unordered collection of distinct elements (a set).

```epsil
{3, 1, 2, 1}
// ➔ Set(1, 2, 3)
```

### setFrom

MathJSON `SetFrom` · `(value*) -> set`

- arguments 1, … — A collection whose elements go into the set, or a value that is not a collection, which goes into the set as an element. Sample: `[1, 2, 2, 3]`.

Create a set from the elements of a collection.

```epsil
setFrom([1, 2, 2, 3])
// ➔ Set(1, 2, 3)
```

### setMinus

MathJSON `SetMinus` · `(set<any>, value*) -> set`

- argument 1 — The set to remove elements from. Sample: `{1, 2, 3, 4}`.
- arguments 2, … — A value to remove, or a collection whose elements are removed; a string is removed as one value. Sample: `2`.

Return the set difference between the first set and subsequent values.

```epsil
setMinus({1, 2, 3, 4}, 2, 4)
// ➔ Set(1, 3)
```

### Single

`(value: T) -> tuple<T> where T`

A tuple with a single element

```epsil
Single(5)
// ➔ (5)
```

### slice

MathJSON `Slice` · `((value: T, span: range) -> T where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T: any) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T: any)`

- `value` — The collection to slice; a string gives a string. Sample: `[10, 20, 30, 40, 50]`.
- `span` — An ascending range of 1-based indices; the indices past the end are left out. Sample: `2..4`.
- `start` — The 1-based index of the first element; a negative index counts from the end (`-1` is the last element). Sample: `2`.
- `end` — The 1-based index of the last element, included; a negative index counts from the end, an index past the end is the end, and an `end` before `start` gives an empty result. Sample: `4`.

Return a contiguous run of elements from an indexed collection.

Given `start` and `end` (1-based, inclusive), a negative index is counted from the end and out-of-bounds indices are clamped.

Given a `range` (an ascending index span such as `2..4`), returns the elements at those indices: `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`.

```epsil
slice([10, 20, 30, 40, 50], 2, 4)
// ➔ [20,30,40]
```

### sort

MathJSON `Sort` · `((T, order: (((character) any -> unknown) | ((character, character) any -> boolean | number))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<T> where T: any)`

- argument 1 — The collection to sort; a string gives the string of its characters in order. Sample: `[3, 1, 2]`.
- `order` — A key function of one element, whose values are sorted in ascending order, or a comparison of two elements that returns `True` or a negative number when the first goes first; by default, ascending order. Sample: `x => -x`.

Return the elements of the collection sorted according to the given comparison function.

```epsil
sort([3, 1, 2])
// ➔ [1,2,3]
```

```epsil
sort(["pear", "fig", "apple"], length)
// ➔ ["fig","pear","apple"]
```

### startsWith

MathJSON `StartsWith` · `(xs: indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T`

- `xs` — The collection or string whose start is tested. Sample: `[1, 2, 3]`.
- `prefix` — The elements the collection must begin with, in order; an empty prefix matches every collection. Sample: `[1, 2]`.

Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence.

On a string the prefix is matched character by character, so a prefix that would end inside a grapheme cluster does not match. An empty prefix matches everything.

```epsil
startsWith([1, 2, 3], [1, 2])
// ➔ true
```

### subset

MathJSON `Subset` · `(any, any*) -> boolean`

- argument 1 — The collection tested as a strict subset. Sample: `{1, 2}`.
- arguments 2, … — A collection that strictly contains the collection before it; with more than two arguments, each argument is tested against the next. Sample: `{1, 2, 3}`.

Test whether the first collection is a strict subset of the second.

```epsil
subset({1, 2}, {1, 2, 3})
// ➔ true
```

### subsetEqual

MathJSON `SubsetEqual` · `(any, any*) -> boolean`

- argument 1 — The collection tested as a subset. Sample: `{1, 2}`.
- arguments 2, … — A collection that contains the collection before it; with more than two arguments, each argument is tested against the next. Sample: `{1, 2, 3}`.

Test whether the first collection is a subset (possibly equal) of the second.

```epsil
subsetEqual({1, 2, 3}, {1, 2, 3})
// ➔ true
```

### superset

MathJSON `Superset` · `(any, any*) -> boolean`

- argument 1 — The collection tested as a strict superset. Sample: `{1, 2, 3}`.
- arguments 2, … — A collection that the collection before it strictly contains; with more than two arguments, each argument is tested against the next. Sample: `{1, 2}`.

Test whether the first collection is a strict superset of the second.

```epsil
superset({1, 2, 3}, {1, 2})
// ➔ true
```

### supersetEqual

MathJSON `SupersetEqual` · `(any, any*) -> boolean`

- argument 1 — The collection tested as a superset. Sample: `{1, 2, 3}`.
- arguments 2, … — A collection that the collection before it contains; with more than two arguments, each argument is tested against the next. Sample: `{1, 2}`.

Test whether the first collection is a superset (possibly equal) of the second.

```epsil
supersetEqual({1, 2}, {1, 2})
// ➔ true
```

### symmetricDifference

MathJSON `SymmetricDifference` · `(set<any>, set<any>) -> set`

- argument 1 — The first set. Sample: `{1, 2, 3}`.
- argument 2 — The second set; the order of the two sets does not change the result. Sample: `{2, 3, 4}`.

Return the symmetric difference of two sets (elements in either set but not both).

```epsil
symmetricDifference({1, 2, 3}, {2, 3, 4})
// ➔ Set(1, 4)
```

### table

MathJSON `Table` · `(function, integer+) -> collection`

- argument 1 — The function of the indices, or an expression in the index variables of the iterator specs. Sample: `i => i^2`.
- arguments 2, … — The size of one dimension, or an iterator spec `(i, n)`, `(i, lo, hi)` or `(i, lo, hi, step)`. Sample: `5`.

Return the list of the values of a function at each index of the given dimensions, as `Tabulate` (the preferred name) does.

It also accepts Mathematica-style iterator specs, e.g. `Table(i^2, {i, n})` (`i` from 1 to `n`), `Table(i^2, {i, 1, n})` or `Table(i, {i, lo, hi, step})`, and the equivalent tuple spelling `Table(i^2, (i, 1, n))`.

```epsil
table(i^2, (i, 1, 5))
// ➔ [1,4,9,16,25]
```

### tabulate

MathJSON `Tabulate` · `(generator: function, integer+) -> list`

- `generator` — The function, called with one 1-based index for each dimension. Sample: `i => i^2`.
- arguments 2, … — The size of one dimension, one argument for each dimension; a size less than 1 gives no element in that dimension. Sample: `3`.

Create a collection by applying a function to each index in the specified dimensions.

```epsil
tabulate((i, j) => i * j, 2, 3)
// ➔ [[1,2,3],[2,4,6]]
```

### take

MathJSON `Take` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T: any)`

Return the first `n` elements of an indexed collection.

A negative `n` counts from the end: `Take(xs, -n)` is the last `n` elements.

A count past the length is clamped: the result is the whole collection.

```epsil
take([1, 2, 3, 4, 5], 2)
// ➔ [1,2]
```

```epsil
take([1, 2, 3, 4, 5], -2)
// ➔ [4,5]
```

### takeWhile

MathJSON `TakeWhile` · `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> indexed_collection where T`

- `xs` — The collection whose leading elements are taken; a string gives a string. Sample: `[1, 2, 3, 10, 4]`.
- `predicate` — A function of one element that returns `True` for an element to keep. Sample: `x => x < 5`.

Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not.

```epsil
takeWhile([1, 2, 3, 10, 4], x => x < 5)
// ➔ [1,2,3]
```

### tally

MathJSON `Tally` · `(collection<T>) -> tuple<list<T>, list<integer>> where T`

- argument 1 — The collection whose elements are counted; equal elements are counted together. Sample: `["a", "b", "a"]`.

Return a tuple with the unique elements of the collection and their respective counts.

```epsil
tally(["a", "b", "a", "c", "a"])
// ➔ (["a","b","c"], [3,1,1])
```

### third

MathJSON `Third` · `(xs: indexed_collection<any>) -> any`

- `xs` — The collection; one with fewer than three elements gives `Missing`, or `NaN` when its elements are numbers. Sample: `[7, 8, 9]`.

The third element of a collection.

```epsil
third([7, 8, 9])
// ➔ 9
```

### Triple

`(first: T, second: U, third: V) -> tuple<T, U, V> where T, U, V`

A tuple of three elements

```epsil
Triple(1, 2, 3)
// ➔ (1, 2, 3)
```

### Tuple

`(any*) -> tuple`

A fixed number of heterogeneous elements. Nothing retains its slot, and a tuple whose coordinates are all Missing remains a tuple.

```epsil
(1, "a", True)
// ➔ (1, "a", true)
```

### tupleFrom

MathJSON `TupleFrom` · `(value*) -> tuple`

- arguments 1, … — A collection whose elements go into the tuple in order, or a value that is not a collection, which goes into the tuple as an element. Sample: `[1, 2, 3]`.

Create a tuple from the elements of a collection.

```epsil
tupleFrom([1, 2, 3])
// ➔ (1, 2, 3)
```

### union

MathJSON `Union` · `(any+) -> set`

- arguments 1, … — A collection whose elements go into the union; an element in several collections appears once. Sample: `{1, 2}`.

Return the union of two or more collections as a set.

```epsil
union({1, 2}, {2, 3})
// ➔ Set(1, 2, 3)
```

### unique

MathJSON `Unique` · `((xs: T) -> T where T: string) & ((xs: T, test: (character, character) any -> boolean) -> T where T: string) & ((xs: collection<T>) -> list<T> where T: any) & ((xs: collection<T>, test: (T, T) any -> boolean) -> list<T> where T: any)`

- `xs` — The collection; the first occurrence of each element is kept, and a string gives a string. Sample: `[1, 2, 1, 3]`.
- `test` — A function of two elements that returns `True` when they count as the same; by default, two elements are the same when they are equal. Sample: `(a, b) => abs(a) == abs(b)`.

Return a list of the unique elements of the collection.

```epsil
unique([1, 2, 1, 3, 2])
// ➔ [1,2,3]
```

### values

MathJSON `Values` · `(dictionary<any>) -> list`

- argument 1 — The dictionary whose values are listed, in the order of its entries. Sample: `{"a" -> 1, "b" -> 2}`.

Return a list of the values of a dictionary.

```epsil
values({"a" -> 1, "b" -> 2})
// ➔ [1,2]
```

### zip

MathJSON `Zip` · `(indexed_collection<any>+) -> list`

- arguments 1, … — A collection, one for each coordinate of the tuples; the shortest collection sets the length of the result. Sample: `[1, 2, 3]`.

Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input. Nothing retains its coordinate and source position; a row whose coordinates are all Missing remains a tuple.

```epsil
zip([1, 2, 3], ["a", "b", "c"])
// ➔ [(1, "a"),(2, "b"),(3, "c")]
```
