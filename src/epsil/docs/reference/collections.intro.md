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
