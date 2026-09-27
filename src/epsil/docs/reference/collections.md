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

The 124 definitions of the collections library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

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

### all

MathJSON `All` · `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given).

### any

MathJSON `Any` · `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T`

Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given).

To test membership of a specific value, use `Contains(xs, v)` — the structural-identity specialization `Any(xs, (e) => e === v)`.

### append

MathJSON `Append` · `(collection<any>, (missing | value)+) -> collection`

Add one or more elements to the end of a collection.

### argMax

MathJSON `ArgMax` · `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

Return the 1-based index of the element that maximizes the given key function (or the element itself when no key is given).

### argMin

MathJSON `ArgMin` · `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T`

Return the 1-based index of the element that minimizes the given key function (or the element itself when no key is given).

### At

`(value: any, index: (boolean | indexed_collection<any> | number | string)+) -> unknown`

Access an element of an indexed collection.

If the index is negative, it is counted from the end.

Multiple indices can be provided to access nested collections (e.g., matrices).

If the index is a finite collection of booleans, returns the elements where the mask is True (a mask is a filter, and its length must match the collection length; otherwise it is an error).

If the index is a finite collection of integers, returns the elements at those indices, preserving position: an out-of-range index yields the absence marker, it is not dropped.

Out-of-band access (an out-of-range index, or a dictionary key that is not present) yields a POSITION-PRESERVING marker: `NaN` when the collection’s elements are numeric, `Missing` otherwise. It never yields `Nothing`, which would erase the position.

An index that is provably not an integer (`2.5`, `3/2`, `5 + √17`), as a scalar or as an entry of an index list, selects no element and yields the same marker. An index that cannot be decided (an unknown, an exact constant within rounding of an integer) leaves `At` unevaluated.

### chunk

MathJSON `Chunk` · `((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)`

Split the collection into `k` nearly equal-sized groups. See `Partition` for splitting into fixed-size chunks.

### chunkBy

MathJSON `ChunkBy` · `((S, key: (character) any -> unknown) -> list<string> where S: string) & ((collection<T>, key: (T) any -> unknown) -> list<list<T>> where T)`

Split the collection into maximal runs of consecutive elements over which the key function yields the same value.

Returns a list of lists. Unlike `GroupBy`, only adjacent elements are grouped, so a key value that recurs after a different run starts a new chunk.

### closed

MathJSON `Closed` · `(number) -> number`

Closed(x): the endpoint x of an Interval, marked as included. A marker with no value of its own; Interval normalizes it away.

### complement

MathJSON `Complement` · `(set<any>+) -> set`

Return the elements of the first set that are not in any of the subsequent sets.

### complexNumbers

MathJSON `ComplexNumbers` · constant `set<complex>`

The set of all finite complex numbers.

### contains

MathJSON `Contains` · `(collection<any>, element: any) -> boolean`

Return True if the collection contains the given element (structural identity, like `===`), False otherwise. An absent element is found where the same marker sits: `Contains([1, NaN], NaN)` is True.

Equivalent to `Any(xs, (e) => e === v)`; use `Any` to test an arbitrary predicate instead of a specific value.

### containsSequence

MathJSON `ContainsSequence` · `(indexed_collection<T>, indexed_collection<T>) -> boolean where T`

Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection.

Unlike `Contains`, which tests membership of a single element, the needle is read as a sequence: `ContainsSequence("abc", "ab")` is `True` while `Contains("abc", "ab")` is `False`.

### count

MathJSON `Count` · `(collection<any>, any?) -> infinity | integer`

`Count(xs)`: the number of elements in the collection.

`Count(xs, v)`: how many elements are structurally the same as `v`.

`Count(xs, p)`: how many elements satisfy the predicate `p`.

### countIf

MathJSON `CountIf` · `(collection<T>, predicate: (T) any -> boolean) -> integer where T`

Return the number of elements in the collection satisfying the predicate.

### cycle

MathJSON `Cycle` · `(list<any>) -> list`

Produce an infinite sequence by cycling through the elements of a finite collection.

### dedup

MathJSON `Dedup` · `(collection<any>) -> collection`

Return the collection with consecutive duplicate elements collapsed to a single element.

Only immediately-adjacent equal elements are removed; unlike `Unique`, a value that recurs after a different element is kept.

### deleteAt

MathJSON `DeleteAt` · `((T, integer) -> T where T: string) & ((indexed_collection<T>, integer) -> list<T> where T)`

Return a copy of the indexed collection with the element at the 1-based `index` removed.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

Deleting from a string yields a string.

### Dictionary

`(tuple<string, unknown>*) -> dictionary`

A collection of key -&gt; value entries with string keys (`{x -> 1, y -> 2}` in Epsil).

### dictionaryFrom

MathJSON `DictionaryFrom` · `(collection<any>) -> dictionary`

Create a dictionary from the elements of a collection of (key, value) pairs.

### differences

MathJSON `Differences` · `(collection<any>) -> indexed_collection`

Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input.

### drop

MathJSON `Drop` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)`

Return the collection without the first n elements.

### dropWhile

MathJSON `DropWhile` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered.

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

### emptySet

MathJSON `EmptySet` · constant `set`

The empty set, a set containing no elements.

### endsWith

MathJSON `EndsWith` · `(indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T`

Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence.

On a string the suffix is matched character by character, so a suffix that would begin inside a grapheme cluster does not match. An empty suffix matches everything.

### extendedComplexNumbers

MathJSON `ExtendedComplexNumbers` · constant `set<complex | infinity>`

The set of all complex numbers, including infinities.

### extendedIntegers

MathJSON `ExtendedIntegers` · constant `set<integer | signed_infinity>`

The set of all integers, including infinities.

### extendedRationalNumbers

MathJSON `ExtendedRationalNumbers` · constant `set<rational | signed_infinity>`

The set of all rational numbers, including infinities.

### extendedRealNumbers

MathJSON `ExtendedRealNumbers` · constant `set<real | signed_infinity>`

The set of all real numbers, including infinities.

### field

MathJSON `Field` · `(value: any, field: string) -> unknown`

Access a named field of a value: `p.x` in Epsil.

On a record or dictionary value, `Field(d, "x")` behaves exactly as `d["x"]` (`At` semantics, including the absence marker for a key a dictionary may not have).

On a value of a NOMINAL type whose definition body has named fields (a record body, or a named-tuple body), the field is resolved through the type definition — the sanctioned accessor window of the nominal-types design (D6/§4.5b D16). This does not make the value a collection: `First(p)` and `p["x"]` keep rejecting.

A field name that is not in a record/named-tuple definition is a static defect (the result type is `error`); on an unknown-typed operand the expression stays symbolic.

### fill

MathJSON `Fill` · `(function, tuple) -> list`

Produce a 2D list (matrix) by applying a function to each pair of row and column indexes.

### filter

MathJSON `Filter` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

Return the elements of the collection for which the predicate function returns True.

Equivalent to `[x for x in xs if p(x)]`.

### find

MathJSON `Find` · `(collection<T>, predicate: (T) any -> boolean) -> any where T`

Return the first element of the collection satisfying the predicate, or Nothing if none found.

### first

MathJSON `First` · `(xs: indexed_collection<any>) -> any`

The first element of a collection.

### flatMap

MathJSON `FlatMap` · `(collection<T>, mapping: (T) any -> U) -> list where T, U`

Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements.

### fold

MathJSON `Fold` · `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T`

Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value.

### groupBy

MathJSON `GroupBy` · `(collection<T>, key: (T) any -> unknown) -> dictionary<list> where T`

Partition the collection into a dictionary of lists based on the key returned by the function.

### imaginaryNumbers

MathJSON `ImaginaryNumbers` · constant `set<imaginary>`

The set of all imaginary numbers.

### indexOf

MathJSON `IndexOf` · `(collection<any>, any) -> integer`

Return the 1-based index of the first occurrence of value in collection, or 0 if not found. The comparison is structural, so an absent value is found where the same marker sits: `IndexOf([1, NaN], NaN)` is 2.

### indexWhere

MathJSON `IndexWhere` · `(collection<T>, predicate: (T) any -> boolean) -> integer where T`

Return the 1-based index of the first element satisfying the predicate, or 0 if not found.

### insert

MathJSON `Insert` · `(indexed_collection<T>, integer, T) -> list<T> where T`

Return a copy of the indexed collection with `value` inserted before the 1-based `index`.

`index` may range from 1 to n+1 (n+1 appends). A negative index counts from the end, with -1 appending at the end (Elixir semantics).

An out-of-range, zero, or non-integer index leaves the expression unevaluated.

### integers

MathJSON `Integers` · constant `set<integer>`

The set of all finite integers.

### intersection

MathJSON `Intersection` · `(any+) -> set`

Return the intersection of one or more collections as a set.

### interval

MathJSON `Interval` · `(number, number) -> set<real>`

A set of real numbers between two endpoints. The endpoints may or may not be included.

### isEmpty

MathJSON `IsEmpty` · `(collection<any>) -> boolean`

Return True if the collection is empty, False otherwise.

### iterate

MathJSON `Iterate` · `(function, initial: any?) -> list`

Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.

The function is invoked as `f(index, acc)`: `index` is the 1-based position of the element being produced, and `acc` is the previous element — the `initial` value when producing element 1. Element `k` is therefore `f(k, element(k-1))`.

A function whose type says it is UNARY is applied to the accumulator alone (`Iterate(2 * _, 1)` produces `[2, 4, 8, 16, …]`); a statically-unknown arity keeps the two-argument form.

### join

MathJSON `Join` · `((T+) -> T where T: string) & ((collection<any>*) -> collection)`

Join the elements of some collections into a flat collection.

A tuple operand is appended as a single element, not spliced.

A scalar operand is appended as a single element too: `Join([1, 2], 3)` is `[1, 2, 3]`.

When every operand is a string, the result is their concatenation as a string: `Join` is the variadic string concatenation.

### KeyValuePair

`(key: string, value: T) -> tuple<string, T> where T`

A key/value pair

### keys

MathJSON `Keys` · `(dictionary<any>) -> list<string>`

Return a list of the keys of a dictionary.

### last

MathJSON `Last` · `(xs: indexed_collection<any>) -> any`

The last element of a collection.

### length

MathJSON `Length` · `(any) -> infinity | integer`

Number of elements in a collection. Returns +oo for an unbounded Range, an `incompatible-type` error for an operand that is decidably not a collection, `NaN` for an absent operand (`Missing`), and stays unevaluated for an infinite collection whose length is not decided.

### linspace

MathJSON `Linspace` · `(start: number, end: number?, count: number?) -> indexed_collection`

A sequence of evenly spaced numbers between a start and end value, both endpoints included.

### List

`(any*) -> list`

An ordered collection of elements (a list).

### listFrom

MathJSON `ListFrom` · `(value*) -> list`

Create a list from the elements of a collection.

### map

MathJSON `Map` · `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U`

Return the collection where each element has been transformed by the mapping function.

With a single collection, equivalent to `[f(x) for x in xs]`. With

multiple collections, combines them element-wise (like `zipWith`): 

`Map(f, xs, ys) = [f(x1, y1), f(x2, y2), …]`, with the length of the

shortest input. The mapping function is always the FIRST argument.

### maxBy

MathJSON `MaxBy` · `(collection<T>, key: (T) any -> unknown) -> value where T`

Return the element of the collection that maximizes the given key function.

### MemberCall

`(receiver: any, member: string, arguments: any*) -> unknown`

Call the member `name` of a value with the value as its first argument: `c.area(2)` in Epsil.

A parse-level node. Canonicalization rewrites it to `Apply(Field(c, "area"), 2)` when the receiver's type declares a field `area` (a stored function is called), or to the bare protocol call `area(c, 2)` when `area` is a protocol function member; a canonical expression never contains it.

### minBy

MathJSON `MinBy` · `(collection<T>, key: (T) any -> unknown) -> value where T`

Return the element of the collection that minimizes the given key function.

### most

MathJSON `Most` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)`

Return the collection without the last element.

If the collection has only one element, return an empty collection.

### negativeIntegers

MathJSON `NegativeIntegers` · constant `set<integer>`

The set of all negative integers.

### negativeNumbers

MathJSON `NegativeNumbers` · constant `set<real>`

The set of all negative real numbers.

### nonNegativeIntegers

MathJSON `NonNegativeIntegers` · constant `set<integer>`

The set of all non-negative integers.

### nonNegativeNumbers

MathJSON `NonNegativeNumbers` · constant `set<real>`

The set of all non-negative real numbers.

### nonPositiveIntegers

MathJSON `NonPositiveIntegers` · constant `set<integer>`

The set of all non-positive integers.

### nonPositiveNumbers

MathJSON `NonPositiveNumbers` · constant `set<real>`

The set of all non-positive real numbers.

### NotElement

`(any, any) -> boolean`

Test whether a value is not an element of a collection.

### NotSubset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict subset of the second.

### NotSuperset

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a strict superset of the second.

### NotSupersetEqual

`(lhs: any, rhs: any) -> boolean`

Test whether the first collection is not a superset (possibly equal) of the second.

### numbers

MathJSON `Numbers` · constant `set<number>`

The set of all numbers.

### open

MathJSON `Open` · `(number) -> number`

Open(x): the endpoint x of an Interval, marked as excluded. A marker with no value of its own.

### ordering

MathJSON `Ordering` · `(indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<integer> where T`

Return the indexes that would sort the collection.

### Pair

`(first: T, second: U) -> tuple<T, U> where T, U`

A tuple of two elements

### partition

MathJSON `Partition` · `(collection<T>, ((T) any -> boolean) | integer, integer?) -> list<list<T>> where T`

Partition a collection into consecutive chunks each of size `n`; the trailing chunk may be shorter when `n` does not divide the length.

With a third argument `step`, produce sliding windows of length `n` whose starts are `step` apart, keeping only complete windows.

With a predicate function instead of an integer, split into two groups: elements for which the predicate is true, and those for which it is false.

Asymmetry: with no `step`, the trailing partial chunk is included; with an explicit `step`, only complete windows are returned.

See `Chunk` for splitting into a given number of nearly-equal groups.

### pointList

MathJSON `PointList` · `(any+) -> any`

A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection.

### pointX

MathJSON `PointX` · `(xs: collection<any> | tuple) -> any`

The x-coordinate of a point, broadcasting over a list of points.

### pointY

MathJSON `PointY` · `(xs: collection<any> | tuple) -> any`

The y-coordinate of a point, broadcasting over a list of points.

### pointZ

MathJSON `PointZ` · `(xs: collection<any> | tuple) -> any`

The z-coordinate of a point, broadcasting over a list of points.

### position

MathJSON `Position` · `(collection<T>, predicate: (T) any -> boolean) -> list<integer> where T`

Return a list of indexes of elements in the collection satisfying the predicate.

### positiveIntegers

MathJSON `PositiveIntegers` · constant `set<integer>`

The set of all positive integers.

### positiveNumbers

MathJSON `PositiveNumbers` · constant `set<real>`

The set of all positive real numbers.

### primes

MathJSON `Primes` · constant `set<integer>`

The set of all prime numbers.

### quotientRing

MathJSON `QuotientRing` · `(set<any>, any) -> set`

The quotient of a ring by the ideal generated by the second argument.

`QuotientRing(Integers, n)` is ℤ/nℤ, the integers modulo `n`.

Inert: the residues are not enumerated, and membership is not decided.

### randomShuffle

MathJSON `RandomShuffle` · `((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T)`

Randomize the order of the elements in the collection. Shuffling a string yields a string. Wrap the call in `WithRandomSeed(seed, ...)` to make it deterministic.

### Range

`(number, number?, step: number?) -> indexed_collection<number>`

A sequence of numbers from a start to an end value with an optional step.

### rangeOf

MathJSON `RangeOf` · `(indexed_collection<T>, indexed_collection<T>, from: integer?) -> nothing | range where T`

Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `Nothing` when it does not occur.

The search starts at index `from` (1 by default) and the span is always expressed in the original collection's indices, so `RangeOf(xs, needle, Last(r) + 1)` finds the next non-overlapping occurrence and the loop ends at `Nothing`.

On a string the needle is matched character by character, so a match never begins or ends inside a grapheme cluster.

### rationalNumbers

MathJSON `RationalNumbers` · constant `set<rational>`

The set of all finite rational numbers.

### realNumbers

MathJSON `RealNumbers` · constant `set<real>`

The set of all finite real numbers.

### reduce

MathJSON `Reduce` · `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T`

Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value.

### repeat

MathJSON `Repeat` · `(value: any, count: integer?) -> list`

Produce a sequence by repeating a single value. With 1 argument, returns an infinite sequence; with 2 arguments (value, count), returns a finite list of `count` copies.

### replaceAt

MathJSON `ReplaceAt` · `(indexed_collection<T>, integer, T) -> list<T> where T`

Return a copy of the indexed collection with the element at the 1-based `index` replaced by `value`.

A negative index counts from the end. An out-of-range, zero, or non-integer index leaves the expression unevaluated.

### rest

MathJSON `Rest` · `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)`

Return the collection without the first element.

If the collection has only one element, return an empty collection.

### reverse

MathJSON `Reverse` · `((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T)`

Reverse the order of the elements of an indexed collection.

### rotateLeft

MathJSON `RotateLeft` · `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)`

Rotate the elements of the collection to the left by n positions.

### rotateRight

MathJSON `RotateRight` · `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)`

Rotate the elements of the collection to the right by n positions.

### scan

MathJSON `Scan` · `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T`

Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value).

### second

MathJSON `Second` · `(xs: indexed_collection<any>) -> any`

The second element of a collection.

### Set

`(any*) -> set`

An unordered collection of distinct elements (a set).

### setFrom

MathJSON `SetFrom` · `(value*) -> set`

Create a set from the elements of a collection.

### setMinus

MathJSON `SetMinus` · `(set<any>, value*) -> set`

Return the set difference between the first set and subsequent values.

### Single

`(value: T) -> tuple<T> where T`

A tuple with a single element

### slice

MathJSON `Slice` · `((value: T, span: range) -> T where T: string) & ((value: T, span: nothing | range) -> T | nothing where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T) & ((value: indexed_collection<T>, span: nothing | range) -> list<T> | nothing where T) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T)`

Return a contiguous run of elements from an indexed collection.

Given `start` and `end` (1-based, inclusive), a negative index is counted from the end and out-of-bounds indices are clamped.

Given a `range` (an ascending index span such as `2..4`), returns the elements at those indices: `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`.

### sort

MathJSON `Sort` · `((T, order: (((character) any -> unknown) | ((character, character) any -> boolean | number))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) | ((any, any) any -> boolean | number))?) -> list<T> where T)`

Return the elements of the collection sorted according to the given comparison function.

### startsWith

MathJSON `StartsWith` · `(indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T`

Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence.

On a string the prefix is matched character by character, so a prefix that would end inside a grapheme cluster does not match. An empty prefix matches everything.

### subset

MathJSON `Subset` · `(any, any*) -> boolean`

Test whether the first collection is a strict subset of the second.

### subsetEqual

MathJSON `SubsetEqual` · `(any, any*) -> boolean`

Test whether the first collection is a subset (possibly equal) of the second.

### superset

MathJSON `Superset` · `(any, any*) -> boolean`

Test whether the first collection is a strict superset of the second.

### supersetEqual

MathJSON `SupersetEqual` · `(any, any*) -> boolean`

Test whether the first collection is a superset (possibly equal) of the second.

### symmetricDifference

MathJSON `SymmetricDifference` · `(set<any>, set<any>) -> set`

Return the symmetric difference of two sets (elements in either set but not both).

### table

MathJSON `Table` · `(function, integer, integer?) -> collection`

An alias for `Tabulate` (the preferred name) that additionally accepts

Mathematica-style iterator specs, e.g. `Table(i^2, {i, 1, n})` or

`Table(i, {i, lo, hi, step})`, and the equivalent tuple spelling

`Table(i^2, (i, 1, n))`.

### tabulate

MathJSON `Tabulate` · `(generator: function, integer, integer?) -> indexed_collection`

Create a collection by applying a function to each index in the specified dimensions.

### take

MathJSON `Take` · `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)`

Return `n` elements from a collection.

### takeWhile

MathJSON `TakeWhile` · `(collection<T>, predicate: (T) any -> boolean) -> collection where T`

Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not.

### tally

MathJSON `Tally` · `(collection<T>) -> tuple<list<T>, list<integer>> where T`

Return a tuple with the unique elements of the collection and their respective counts.

### third

MathJSON `Third` · `(xs: indexed_collection<any>) -> any`

The third element of a collection.

### Triple

`(first: T, second: U, third: V) -> tuple<T, U, V> where T, U, V`

A tuple of three elements

### Tuple

`(any*) -> tuple`

A fixed number of heterogeneous elements

### tupleFrom

MathJSON `TupleFrom` · `(value*) -> tuple`

Create a tuple from the elements of a collection.

### union

MathJSON `Union` · `(any+) -> set`

Return the union of two or more collections as a set.

### unique

MathJSON `Unique` · `((T) -> T where T: string) & ((collection<T>) -> list<T> where T)`

Return a list of the unique elements of the collection.

### values

MathJSON `Values` · `(dictionary<any>) -> list`

Return a list of the values of a dictionary.

### zip

MathJSON `Zip` · `(indexed_collection<any>+) -> list`

Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input.
