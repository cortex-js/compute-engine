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

A set literal removes duplicates. The empty set is `{}`, and the empty
dictionary is `{->}`:

```epsil
{3, 1, 3, 2}
// ➔ Set(3, 1, 2)
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
// ➔ True
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

The pipe `|>` passes a collection to the next operation, so a sequence of
operations reads from left to right. The collection fills the argument slot
the operation is missing: `xs |> filter(isPrime)` is `filter(xs, isPrime)`,
and `xs |> map(f)` is `map(f, xs)`, because the function is `map`'s first
argument. A
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

The ring obtained by adjoining one or more elements to a base ring.

`Adjoin(Integers, Sqrt(2))` is ℤ[√2]; `Adjoin(Integers, ["Complex", 0, 1])` is the Gaussian integers ℤ[i]; `Adjoin(Integers, "x")` is the polynomial ring ℤ[x].

Inert: the adjunction is not expanded, and membership in it is not decided.

```epsil
adjoin(integers, sqrt(2))
// ➔ Adjoin("Integers", sqrt(2))
```

### all

MathJSON `All` · `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given).

```epsil
all([2, 4, 6], x => x % 2 == 0)
// ➔ "True"
```

### any

MathJSON `Any` · `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given).

To test membership of a specific value, use `Contains(xs, v)` — the structural-identity specialization `Any(xs, (e) => e === v)`.

```epsil
any([1, 3, 4], x => x % 2 == 0)
// ➔ "True"
```

### append

MathJSON `Append` · `(collection<any>, (missing | value)+) -> collection`

Add one or more elements to the end of a collection.

```epsil
append([1, 2], 3, 4)
// ➔ [1,2,3,4]
```

### argMax

MathJSON `ArgMax` · `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

Return the 1-based index of the element that maximizes the given key function (or the element itself when no key is given).

```epsil
argMax([3, 9, 2])
// ➔ 2
```

### argMin

MathJSON `ArgMin` · `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

Return the 1-based index of the element that minimizes the given key function (or the element itself when no key is given).

```epsil
argMin([3, 9, 2])
// ➔ 3
```

### At

`(value: any, index: (boolean | indexed_collection<any> | number | string)+) -> unknown`

Access an element of an indexed collection.

If the index is negative, it is counted from the end.

Multiple indices can be provided to access nested collections (e.g., matrices).

If the index is a finite collection of booleans, returns the elements where the mask is True (a mask is a filter, and its length must match the collection length; otherwise it is an error).

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

MathJSON `Chunk` · `((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)`

Split the collection into `k` nearly equal-sized groups. See `Partition` for splitting into fixed-size chunks.

```epsil
chunk([1, 2, 3, 4, 5, 6], 3)
// ➔ [[1,2],[3,4],[5,6]]
```

### chunkBy

MathJSON `ChunkBy` · `((S, key: (character) any -> unknown) -> list<string> where S: string) & ((collection<T>, key: (T) any -> unknown) -> list<list<T>> where T)`

Split the collection into maximal runs of consecutive elements over which the key function yields the same value.

Returns a list of lists. Unlike `GroupBy`, only adjacent elements are grouped, so a key value that recurs after a different run starts a new chunk.

```epsil
chunkBy([1, 3, 2, 4, 5], x => x % 2)
// ➔ [[1,3],[2,4],[5]]
```

### closed

MathJSON `Closed` · `(number) -> number`

Closed(x): the endpoint x of an Interval, marked as included. A marker with no value of its own; Interval normalizes it away.

```epsil
1 in interval(0, closed(1))
// ➔ "True"
```

### complement

MathJSON `Complement` · `(set<any>+) -> set`

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
// ➔ "True"
```

### contains

MathJSON `Contains` · `(collection<any>, element: any) -> boolean`

Return True if the collection contains the given element (structural identity, like `===`), False otherwise. An absent element is found where the same marker sits: `Contains([1, NaN], NaN)` is True.

Equivalent to `Any(xs, (e) => e === v)`; use `Any` to test an arbitrary predicate instead of a specific value.

```epsil
contains([1, 2, 3], 2)
// ➔ "True"
```

### containsSequence

MathJSON `ContainsSequence` · `(indexed_collection<T>, indexed_collection<T>) -> boolean where T`

Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection.

Unlike `Contains`, which tests membership of a single element, the needle is read as a sequence: `ContainsSequence("abc", "ab")` is `True` while `Contains("abc", "ab")` is `False`.

```epsil
containsSequence([1, 2, 3, 4], [2, 3])
// ➔ "True"
```

### count

MathJSON `Count` · `(collection<any>, any?) -> infinity | integer`

`Count(xs)`: the number of elements in the collection.

`Count(xs, v)`: how many elements are structurally the same as `v`.

`Count(xs, p)`: how many elements satisfy the predicate `p`.

```epsil
count([1, 2, 1, 3, 1], 1)
// ➔ 3
```

### countIf

MathJSON `CountIf` · `(collection<T>, predicate: (T) any -> boolean) -> integer where T`

Return the number of elements in the collection satisfying the predicate.

```epsil
countIf([1, 4, 9, 16], x => x > 5)
// ➔ 2
```

### cycle

MathJSON `Cycle` · `(list<any>) -> list`

Produce an infinite sequence by cycling through the elements of a finite collection.

```epsil
take(cycle([1, 2]), 5)
// ➔ [1,2,1,2,1]
```

### dedup

MathJSON `Dedup` · `(collection<any>) -> collection`

Return the collection with consecutive duplicate elements collapsed to a single element.

Only immediately-adjacent equal elements are removed; unlike `Unique`, a value that recurs after a different element is kept.

```epsil
dedup([1, 1, 2, 2, 1])
// ➔ [1,2,1]
```

### deleteAt

MathJSON `DeleteAt` · `((T, integer) -> T where T: string) & ((indexed_collection<T>, integer) -> list<T> where T)`

Return a copy of the indexed collection with the element at the 1-based `index` removed.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

Deleting from a string yields a string.

```epsil
deleteAt([1, 2, 3, 4], 2)
// ➔ [1,3,4]
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

Create a dictionary from the elements of a collection of (key, value) pairs.

```epsil
dictionaryFrom([("a", 1), ("b", 2)])
// ➔ {"a" -> 1, "b" -> 2}
```

### differences

MathJSON `Differences` · `(collection<any>) -> indexed_collection`

Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input.

```epsil
differences([1, 4, 9, 16])
// ➔ [3,5,7]
```

### drop

MathJSON `Drop` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)`

Return the collection without the first n elements.

```epsil
drop([1, 2, 3, 4, 5], 2)
// ➔ [3,4,5]
```

### dropWhile

MathJSON `DropWhile` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

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
// ➔ "True"
```

### emptySet

MathJSON `EmptySet` · constant `set`

The empty set, a set containing no elements.

```epsil
isEmpty(emptySet)
// ➔ "True"
```

### endsWith

MathJSON `EndsWith` · `(indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T`

Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence.

On a string the suffix is matched character by character, so a suffix that would begin inside a grapheme cluster does not match. An empty suffix matches everything.

```epsil
endsWith([1, 2, 3], [2, 3])
// ➔ "True"
```

### extendedComplexNumbers

MathJSON `ExtendedComplexNumbers` · constant `set<complex | infinity>`

The set of all complex numbers, including infinities.

```epsil
complexInfinity in extendedComplexNumbers
// ➔ "True"
```

### extendedIntegers

MathJSON `ExtendedIntegers` · constant `set<integer | signed_infinity>`

The set of all integers, including infinities.

```epsil
Infinity in extendedIntegers
// ➔ "True"
```

### extendedRationalNumbers

MathJSON `ExtendedRationalNumbers` · constant `set<rational | signed_infinity>`

The set of all rational numbers, including infinities.

```epsil
-Infinity in extendedRationalNumbers
// ➔ "True"
```

### extendedRealNumbers

MathJSON `ExtendedRealNumbers` · constant `set<real | signed_infinity>`

The set of all real numbers, including infinities.

```epsil
-Infinity in extendedRealNumbers
// ➔ "True"
```

### field

MathJSON `Field` · `(value: any, field: string) -> unknown`

Access a named field of a value: `p.x` in Epsil.

On a record or dictionary value, `Field(d, "x")` behaves exactly as `d["x"]` (`At` semantics, including the absence marker for a key a dictionary may not have).

On a value of a NOMINAL type whose definition body has named fields (a record body, or a named-tuple body), the field is resolved through the type definition — the sanctioned accessor window of the nominal-types design (D6/§4.5b D16). This does not make the value a collection: `First(p)` and `p["x"]` keep rejecting.

A field name that is not in a record/named-tuple definition is a static defect (the result type is `error`); on an unknown-typed operand the expression stays symbolic.

```epsil
{x -> 1, y -> 2}.y
// ➔ 2
```

### fill

MathJSON `Fill` · `(function, tuple) -> list`

Produce a 2D list (matrix) by applying a function to each pair of row and column indexes.

```epsil
fill((i, j) => 10i + j, (2, 3))
// ➔ [[11,12,13],[21,22,23]]
```

### filter

MathJSON `Filter` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

Return the elements of the collection for which the predicate function returns True.

Equivalent to `[x for x in xs if p(x)]`.

```epsil
filter([1, 2, 3, 4, 5, 6], x => x % 2 == 0)
// ➔ [2,4,6]
```

### find

MathJSON `Find` · `(collection<T>, predicate: (T) any -> boolean) -> any where T`

Return the first element of the collection satisfying the predicate, or Nothing if none found.

```epsil
find([1, 4, 9, 16], x => x > 5)
// ➔ 9
```

### first

MathJSON `First` · `(xs: indexed_collection<any>) -> any`

The first element of a collection.

```epsil
first([7, 8, 9])
// ➔ 7
```

### flatMap

MathJSON `FlatMap` · `(collection<T>, mapping: (T) any -> U) -> list where T, U`

Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements.

```epsil
flatMap([1, 2, 3], x => [x, x])
// ➔ [1,1,2,2,3,3]
```

### fold

MathJSON `Fold` · `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T`

Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value.

```epsil
fold((a, b) => a + b, 0, [1, 2, 3, 4])
// ➔ 10
```

### groupBy

MathJSON `GroupBy` · `(collection<T>, key: (T) any -> unknown) -> dictionary<list> where T`

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
// ➔ "True"
```

### indexOf

MathJSON `IndexOf` · `(indexed_collection<any>, any) -> integer`

Return the 1-based index of the first occurrence of value in collection, or 0 if not found. The comparison is structural, so an absent value is found where the same marker sits: `IndexOf([1, NaN], NaN)` is 2. Stays unevaluated when the collection cannot be searched (a symbol with no value, an unbounded source with no match).

```epsil
indexOf([10, 20, 30], 20)
// ➔ 2
```

### indexWhere

MathJSON `IndexWhere` · `(indexed_collection<T>, predicate: (T) any -> boolean) -> integer where T`

Return the 1-based index of the first element satisfying the predicate, or 0 if not found. Stays unevaluated when the collection cannot be searched (a symbol with no value, an unbounded source with no match).

```epsil
indexWhere([1, 4, 9, 16], x => x > 5)
// ➔ 3
```

### insert

MathJSON `Insert` · `(indexed_collection<T>, integer, T) -> list<T> where T`

Return a copy of the indexed collection with `value` inserted before the 1-based `index`.

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
// ➔ "True"
```

### intersection

MathJSON `Intersection` · `(any+) -> set`

Return the intersection of one or more collections as a set.

```epsil
intersection({1, 2, 3}, {2, 3, 4})
// ➔ Set(2, 3)
```

### interval

MathJSON `Interval` · `(number, number) -> set<real>`

A set of real numbers between two endpoints. The endpoints may or may not be included.

```epsil
0.5 in interval(0, 1)
// ➔ "True"
```

### isEmpty

MathJSON `IsEmpty` · `(collection<any>) -> boolean`

Return True if the collection is empty, False otherwise.

```epsil
isEmpty([])
// ➔ "True"
```

### iterate

MathJSON `Iterate` · `(function, initial: any?) -> list`

Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.

The function is invoked as `f(index, acc)`: `index` is the 1-based position of the element being produced, and `acc` is the previous element — the `initial` value when producing element 1. Element `k` is therefore `f(k, element(k-1))`.

A function whose type says it is UNARY is applied to the accumulator alone (`Iterate(2 * _, 1)` produces `[2, 4, 8, 16, …]`); a statically-unknown arity keeps the two-argument form.

```epsil
take(iterate(x => 2x, 1), 5)
// ➔ [2,4,8,16,32]
```

### join

MathJSON `Join` · `((T+) -> T where T: string) & ((collection<any>*) -> collection)`

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

Return a list of the keys of a dictionary.

```epsil
keys({"a" -> 1, "b" -> 2})
// ➔ ["a","b"]
```

### last

MathJSON `Last` · `(xs: indexed_collection<any>) -> any`

The last element of a collection.

```epsil
last([7, 8, 9])
// ➔ 9
```

### length

MathJSON `Length` · `(any) -> infinity | integer`

Number of elements in a collection. Returns +oo for an infinite collection (an unbounded Range, `Integers`, `Repeat(5)`, an interval), as `Count` does, an `incompatible-type` error for an operand that is decidably not a collection, `NaN` for an absent operand (`Missing`), and stays unevaluated for a collection whose size is not known (a `Filter` over an infinite source).

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
// ➔ [3,1,0]
```

### map

MathJSON `Map` · `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U`

Return the collection where each element has been transformed by the mapping function.

With a single collection, equivalent to `[f(x) for x in xs]`. With

multiple collections, combines them element-wise (like `zipWith`): 

`Map(f, xs, ys) = [f(x1, y1), f(x2, y2), …]`, with the length of the

shortest input. The mapping function is always the FIRST argument.

```epsil
map(x => x^2, [1, 2, 3])
// ➔ [1,4,9]
```

### maxBy

MathJSON `MaxBy` · `(collection<T>, key: (T) any -> unknown) -> value where T`

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

MathJSON `MinBy` · `(collection<T>, key: (T) any -> unknown) -> value where T`

Return the element of the collection that minimizes the given key function.

```epsil
minBy(["pear", "fig", "apple"], length)
// ➔ "fig"
```

### most

MathJSON `Most` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)`

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
// ➔ "True"
```

### negativeNumbers

MathJSON `NegativeNumbers` · constant `set<real>`

The set of all negative real numbers.

```epsil
-0.5 in negativeNumbers
// ➔ "True"
```

### nonNegativeIntegers

MathJSON `NonNegativeIntegers` · constant `set<integer>`

The set of all non-negative integers.

```epsil
0 in nonNegativeIntegers
// ➔ "True"
```

### nonNegativeNumbers

MathJSON `NonNegativeNumbers` · constant `set<real>`

The set of all non-negative real numbers.

```epsil
0 in nonNegativeNumbers
// ➔ "True"
```

### nonPositiveIntegers

MathJSON `NonPositiveIntegers` · constant `set<integer>`

The set of all non-positive integers.

```epsil
0 in nonPositiveIntegers
// ➔ "True"
```

### nonPositiveNumbers

MathJSON `NonPositiveNumbers` · constant `set<real>`

The set of all non-positive real numbers.

```epsil
0 in nonPositiveNumbers
// ➔ "True"
```

### NotElement

`(any, any) -> boolean`

Test whether a value is not an element of a collection.

```epsil
4 !in {1, 2, 3}
// ➔ "True"
```

### NotSubset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict subset of the second.

```epsil
NotSubset({1, 4}, {1, 2, 3})
// ➔ "True"
```

### NotSuperset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict superset of the second.

```epsil
NotSuperset({1, 2}, {1, 2, 3})
// ➔ "True"
```

### NotSupersetEqual

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a superset (possibly equal) of the second.

```epsil
NotSupersetEqual({1, 2}, {1, 2, 3})
// ➔ "True"
```

### numbers

MathJSON `Numbers` · constant `set<number>`

The set of all numbers.

```epsil
2 + 3i in numbers
// ➔ "True"
```

### open

MathJSON `Open` · `(number) -> number`

Open(x): the endpoint x of an Interval, marked as excluded. A marker with no value of its own.

```epsil
0 in interval(open(0), 1)
// ➔ "False"
```

### ordering

MathJSON `Ordering` · `(indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<integer> where T`

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

MathJSON `Partition` · `(collection<T>, ((T) any -> boolean) | integer, integer?) -> list<list<T>> where T`

Partition a collection into consecutive chunks each of size `n`; the trailing chunk may be shorter when `n` does not divide the length.

With a third argument `step`, produce sliding windows of length `n` whose starts are `step` apart, keeping only complete windows.

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

A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection.

```epsil
pointList([1, 2, 3], [4, 5, 6])
// ➔ [(1, 4),(2, 5),(3, 6)]
```

### pointX

MathJSON `PointX` · `(xs: collection<any> | tuple) -> any`

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

The y-coordinate of a point, broadcasting over a list of points.

```epsil
pointY((3, 4))
// ➔ 4
```

### pointZ

MathJSON `PointZ` · `(xs: collection<any> | tuple) -> any`

The z-coordinate of a point, broadcasting over a list of points.

```epsil
pointZ((3, 4, 5))
// ➔ 5
```

### position

MathJSON `Position` · `(collection<T>, predicate: (T) any -> boolean) -> list<integer> where T`

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
// ➔ "False"
```

### positiveNumbers

MathJSON `PositiveNumbers` · constant `set<real>`

The set of all positive real numbers.

```epsil
0 in positiveNumbers
// ➔ "False"
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

The quotient of a ring by the ideal generated by the second argument.

`QuotientRing(Integers, n)` is ℤ/nℤ, the integers modulo `n`.

Inert: the residues are not enumerated, and membership is not decided.

```epsil
quotientRing(integers, 5)
// ➔ QuotientRing("Integers", 5)
```

### randomShuffle

MathJSON `RandomShuffle` · `((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T)`

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

MathJSON `RangeOf` · `(indexed_collection<T>, indexed_collection<T>, from: integer?) -> nothing | range where T`

Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `Nothing` when it does not occur.

The search starts at index `from` (1 by default) and the span is always expressed in the original collection's indices, so `RangeOf(xs, needle, Last(r) + 1)` finds the next non-overlapping occurrence and the loop ends at `Nothing`.

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
// ➔ "False"
```

### realNumbers

MathJSON `RealNumbers` · constant `set<real>`

The set of all finite real numbers.

```epsil
i in realNumbers
// ➔ "False"
```

### reduce

MathJSON `Reduce` · `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T`

Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value.

```epsil
reduce([1, 2, 3, 4], (a, b) => a * b)
// ➔ 24
```

### repeat

MathJSON `Repeat` · `(value: any, count: integer?) -> list`

Produce a sequence by repeating a single value. With 1 argument, returns an infinite sequence; with 2 arguments (value, count), returns a finite list of `count` copies.

```epsil
repeat(0, 3)
// ➔ [0,0,0]
```

### replaceAt

MathJSON `ReplaceAt` · `(indexed_collection<T>, integer, T) -> list<T> where T`

Return a copy of the indexed collection with the element at the 1-based `index` replaced by `value`.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

```epsil
replaceAt([1, 2, 3], 2, 20)
// ➔ [1,20,3]
```

### rest

MathJSON `Rest` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)`

Return the collection without the first element.

If the collection has only one element, return an empty collection.

```epsil
rest([7, 8, 9])
// ➔ [8,9]
```

### reverse

MathJSON `Reverse` · `((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T)`

Reverse the order of the elements of an indexed collection.

```epsil
reverse([1, 2, 3])
// ➔ [3,2,1]
```

### rotateLeft

MathJSON `RotateLeft` · `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)`

Rotate the elements of the collection to the left by n positions.

```epsil
rotateLeft([1, 2, 3, 4])
// ➔ [2,3,4,1]
```

### rotateRight

MathJSON `RotateRight` · `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)`

Rotate the elements of the collection to the right by n positions.

```epsil
rotateRight([1, 2, 3, 4])
// ➔ [4,1,2,3]
```

### scan

MathJSON `Scan` · `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T`

Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value).

```epsil
scan([1, 2, 3, 4], (a, b) => a + b)
// ➔ [1,3,6,10]
```

### second

MathJSON `Second` · `(xs: indexed_collection<any>) -> any`

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
// ➔ Set(3, 1, 2)
```

### setFrom

MathJSON `SetFrom` · `(value*) -> set`

Create a set from the elements of a collection.

```epsil
setFrom([1, 2, 2, 3])
// ➔ Set(1, 2, 3)
```

### setMinus

MathJSON `SetMinus` · `(set<any>, value*) -> set`

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

MathJSON `Slice` · `((value: T, span: range) -> T where T: string) & ((value: T, span: nothing | range) -> T | nothing where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T) & ((value: indexed_collection<T>, span: nothing | range) -> list<T> | nothing where T) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T)`

Return a contiguous run of elements from an indexed collection.

Given `start` and `end` (1-based, inclusive), a negative index is counted from the end and out-of-bounds indices are clamped.

Given a `range` (an ascending index span such as `2..4`), returns the elements at those indices: `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`.

```epsil
slice([10, 20, 30, 40, 50], 2, 4)
// ➔ [20,30,40]
```

### sort

MathJSON `Sort` · `((T, order: (((character) any -> unknown) | ((character, character) any -> boolean | number))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<T> where T)`

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

MathJSON `StartsWith` · `(indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T`

Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence.

On a string the prefix is matched character by character, so a prefix that would end inside a grapheme cluster does not match. An empty prefix matches everything.

```epsil
startsWith([1, 2, 3], [1, 2])
// ➔ "True"
```

### subset

MathJSON `Subset` · `(any, any*) -> boolean`

Test whether the first collection is a strict subset of the second.

```epsil
subset({1, 2}, {1, 2, 3})
// ➔ "True"
```

### subsetEqual

MathJSON `SubsetEqual` · `(any, any*) -> boolean`

Test whether the first collection is a subset (possibly equal) of the second.

```epsil
subsetEqual({1, 2, 3}, {1, 2, 3})
// ➔ "True"
```

### superset

MathJSON `Superset` · `(any, any*) -> boolean`

Test whether the first collection is a strict superset of the second.

```epsil
superset({1, 2, 3}, {1, 2})
// ➔ "True"
```

### supersetEqual

MathJSON `SupersetEqual` · `(any, any*) -> boolean`

Test whether the first collection is a superset (possibly equal) of the second.

```epsil
supersetEqual({1, 2}, {1, 2})
// ➔ "True"
```

### symmetricDifference

MathJSON `SymmetricDifference` · `(set<any>, set<any>) -> set`

Return the symmetric difference of two sets (elements in either set but not both).

```epsil
symmetricDifference({1, 2, 3}, {2, 3, 4})
// ➔ Set(1, 4)
```

### table

MathJSON `Table` · `(function, integer, integer?) -> collection`

An alias for `Tabulate` (the preferred name) that additionally accepts

Mathematica-style iterator specs, e.g. `Table(i^2, {i, 1, n})` or

`Table(i, {i, lo, hi, step})`, and the equivalent tuple spelling

`Table(i^2, (i, 1, n))`.

```epsil
table(i^2, (i, 1, 5))
// ➔ [1,4,9,16,25]
```

### tabulate

MathJSON `Tabulate` · `(generator: function, integer, integer?) -> list`

Create a collection by applying a function to each index in the specified dimensions.

```epsil
tabulate((i, j) => i * j, 2, 3)
// ➔ [[1,2,3],[2,4,6]]
```

### take

MathJSON `Take` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)`

Return `n` elements from a collection.

```epsil
take([1, 2, 3, 4, 5], 2)
// ➔ [1,2]
```

### takeWhile

MathJSON `TakeWhile` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not.

```epsil
takeWhile([1, 2, 3, 10, 4], x => x < 5)
// ➔ [1,2,3]
```

### tally

MathJSON `Tally` · `(collection<T>) -> tuple<list<T>, list<integer>> where T`

Return a tuple with the unique elements of the collection and their respective counts.

```epsil
tally(["a", "b", "a", "c", "a"])
// ➔ (["a","b","c"], [3,1,1])
```

### third

MathJSON `Third` · `(xs: indexed_collection<any>) -> any`

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

A fixed number of heterogeneous elements

```epsil
(1, "a", True)
// ➔ (1, "a", "True")
```

### tupleFrom

MathJSON `TupleFrom` · `(value*) -> tuple`

Create a tuple from the elements of a collection.

```epsil
tupleFrom([1, 2, 3])
// ➔ (1, 2, 3)
```

### union

MathJSON `Union` · `(any+) -> set`

Return the union of two or more collections as a set.

```epsil
union({1, 2}, {2, 3})
// ➔ Set(1, 2, 3)
```

### unique

MathJSON `Unique` · `((T) -> T where T: string) & ((collection<T>) -> list<T> where T)`

Return a list of the unique elements of the collection.

```epsil
unique([1, 2, 1, 3, 2])
// ➔ [1,2,3]
```

### values

MathJSON `Values` · `(dictionary<any>) -> list`

Return a list of the values of a dictionary.

```epsil
values({"a" -> 1, "b" -> 2})
// ➔ [1,2]
```

### zip

MathJSON `Zip` · `(indexed_collection<any>+) -> list`

Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input.

```epsil
zip([1, 2, 3], ["a", "b", "c"])
// ➔ [(1, "a"),(2, "b"),(3, "c")]
```
