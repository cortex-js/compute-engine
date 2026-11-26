# Mutable arrays (`array<T>`): specification

Status: APPROVED. The user approved decisions U1 to U6 on 2026-11-25, and
reversed none of C1 to C10. Written by session `compute-engine-57` on
2026-11-25 at `30397d7e6c43bf3d4698e393e7725f8b554babd6`. It replaces the
ruling list of 2026-11-24 (`docs/plans/2026-11-24-mutable-arrays-ruling-list.md`,
deleted; in the history at `84e29ad76563b13ae20a4a3510e0063da79b2412`):
decision C9 says what became of each ruling AR1 to AR9. The implementation plan is
`docs/plans/2026-11-25-mutable-arrays-implementation-plan.md`.

Revision 2 (2026-11-25) applies a review by two reviewers (Claude and Codex,
32 findings). Revision 3 (2026-11-25) adds tuple cells (decision U5), after
the user's question about a `color` cell and the answer of Tycho's session to
decision C7. Revision 4 (2026-11-25) limits a tuple cell to four bytes, at
the user's word, and defines a read with a range as the index (section 5).
Revision 5 (2026-11-25) adds `Swap` (section 6), so that a program with two
buffers compiles. Revision 6 (2026-11-25) lets a function that assigns a
variable of the engine call a host function (section 10.7, decision U6), and
reads a name that holds an array at each call. Revision 7 (2026-11-25)
applies a second review by the two reviewers, of revisions 3 to 6 (17
findings); it narrows section 10.7 to numbers, booleans and arrays.

Section 15 lists the decisions. Six of them change a ratified text or
needed the user's word (U1 to U6). The others are choices of this spec, each
with its alternative.

## 1. Purpose

An `array<T>` is a sequence of cells that a program reads and writes in
place. It has identity: two names can hold one array, and a store through one
shows through the other. A store costs O(1) in time and in stack, in the
interpreter and in compiled code, whatever the length. `list` stays an
immutable value.

`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Ref cells and mutable
collections", is the ratified design of the type. This spec keeps what that
section says about identity, the `state` effect, the version counter,
invariance in `T`, cache exclusion, lifetime and cycles, and does not restate
it. Section 17 quotes the sentences of Appendix B that this spec replaces.

The first consumer is Tycho's raster
(`~/dev/tycho/requirements/todo/EPSIL_RASTER_IMAGE.md`, not approved): the
pixels of a bitmap are an array that a compiled timer callback writes, that an
interpreted event handler writes, that a host function shows through a 2D
canvas context, and that a shader reads as a texture. Its section "Requests to
CE" lists ten needs, named T1 to T10 below. Section 16 gives the disposition
of each.

## 2. The type

- `array<T>` is the type of an array whose cells hold values of type `T`.
  Bare `array` is the type of an array of any cell type. `array<any>` is not
  bare `array`: it is the type of an array whose cells accept every value.
- `array<T>` is invariant in `T`: `array<S>` is a subtype of `array<T>` only
  when `S` and `T` are the same type. Every `array<T>` is a subtype of bare
  `array`. A type parameter used as a cell type is an `inout` position.
- An array type is disjoint from `list`, `tuple`, `record`, `dictionary`,
  `object`, `collection` and `indexed_collection`. An array is not a
  collection in this version (decision U4): the operators of sections 4 to 6
  read and write it. Every other operator gives no value for it: it refuses
  it with `incompatible-type` where its signature states a collection or a
  number, and otherwise leaves the expression unevaluated. A program that
  needs a collection takes `ListFrom(a)`.
- An array is never broadcast over: `a + 1` is `incompatible-type`.
- An array has one dimension and its type states no length. A grid is
  arithmetic on the index, written by the program (`(y - 1) * w + x`).
- A read through bare `array` has the type `any`. A store through bare `array`
  is checked against the cell type of the array when it runs.
- Every valid type is a cell type.

## 3. Cells and storage

The cell type selects the storage. The storage is a function of the cell type
alone, so the interpreter, compiled code and the host find it from the type.

| Cell type                                             | Storage            |
| ----------------------------------------------------- | ------------------ |
| An integer type whose range is within 0 to 255        | `Uint8Array`       |
| within −128 to 127                                    | `Int8Array`        |
| within 0 to 65,535                                    | `Uint16Array`      |
| within −32,768 to 32,767                              | `Int16Array`       |
| within 0 to 4,294,967,295                             | `Uint32Array`      |
| within −2,147,483,648 to 2,147,483,647                | `Int32Array`       |
| `real`, with or without a range                       | `Float64Array`     |
| A tuple of four elements, each an integer type within 0 to 255 (decision U5) | `Uint8Array`, four bytes for each cell |
| Every other type                                      | Expression cells   |

The first row that holds the range applies. The cells of the first eight rows
are *machine cells*. *Expression cells* hold evaluated expressions, as the
slots of an object do: `integer` with no bound or with a wider range,
`rational`, `number`, `boolean`, `string`, a union, a tuple, a list, an
object type, another array.

Every value of a bounded integer type is exact in its cell. A `real` cell
holds the machine number of the value (decision U2): `a[1] = 1/3` then `a[1]`
gives `0.3333333333333333`, where a list keeps `1/3`. A program that needs
exact cells declares `array<rational>` or `array<number>`. The type `real`
has no infinity and no `NaN` (`docs/TYPE-SYSTEM.md`), so a table of depths
starts from a large finite number, not from `+∞`.

**Tuple cells (decision U5).** One tuple type is a machine cell: a tuple of
four elements, named or not, each an integer type whose range is within 0 to
255, such as `type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>` with
`type alias Byte = integer<0..255>`. It is
stored flat: cell `i` holds its four bytes at the positions `4(i − 1)` to
`4(i − 1) + 3` of one `Uint8Array`. An `array<Pixel>` of `n` cells is a
`Uint8Array` of `4n` bytes, the bytes of an `ImageData` and of an RGBA
texture. A read gives the
tuple, a value: `a[i].r` reads one byte, and `a[i] == live` compares two
tuples. A store writes a whole tuple, each element checked as a store of its
type is. A tuple is immutable, so `a[i].r = v` is
`immutable-value-assignment`; the program writes `a[i] = Pixel(v, p.g, p.b,
p.a)`. A read at an index out of range gives a tuple of four `NaN`, a plain
tuple also when the cell type is named (a list of points gives a point of
`NaN` there; a list of values of a named tuple type gives `Missing`, and a
tuple cell does not follow it). A cell of a named tuple type takes a value of
that type: `Pixel(1, 2, 3, 4)`, not `(1, 2, 3, 4)`. Every other tuple type has expression cells (an
array of points, `array<tuple<real, real>>`, for example), and compiled code
declines it.

**Aliases and declared types.** A cell type is read through a type alias
(`type alias Byte = integer<0..255>` is the type `integer<0..255>`). A type
declared with `type` is a distinct type whose values carry its name
(`type Byte = integer<0..255>` makes `Byte(1)`, which is not a number, and
`1` is not a `Byte`): as a cell type, or as an element of a tuple cell, it
has expression cells. The one declared type that is a machine cell is the
tuple of four bytes above: a read of an `array<Pixel>` gives `Pixel(r, g, b,
a)`. The array keeps the definition of its cell type as it is at the
construction: a later declaration of the same name does not change the
storage or the checks of an array that exists.

**The value of a store, in the interpreter.** A store evaluates the value,
then:

- Integer machine cells: the value is an integer of the cell type. Any other
  value is the error `incompatible-type`, the error of a field store of a
  value outside the declared type (`expected integer<0..10>, got 50`). The
  test is against the cell type, not against the storage: 200 is refused by
  an `array<integer<0..100>>`.
- `real` cells: the value is a real number of the cell type (an integer, a
  rational, an exact constant such as `Pi`, a machine number). The cell holds
  its machine number. A value that is not a finite real number (a symbol with
  no value, a complex number, `NaN`, an infinity) is `incompatible-type`.
- Expression cells: the check is that of a field store (`storeObjectField()`
  of `library/collections.ts`: the type of the value matches the cell type),
  and the cell holds the evaluated value (Appendix B, "A store writes the
  evaluated value"). A value that is an object or an array is held by
  reference.

The value of the store expression is the value given, as for a field store. A
read of a machine cell gives the integer, or the machine number.

## 4. Construction

`ArrayFrom(xs)` and `ArrayFrom(xs, type)` make a new array. In Epsil:
`arrayFrom(xs)`, `arrayFrom(xs, "integer<0..255>")`. There is no array
literal and no variadic constructor (Appendix B, "Construction").

- `xs` is a finite collection or an array. The new array has the elements of
  `xs` in order, in storage of its own. An element that is an object or an
  array is held by reference, as a cell holds it: the construction makes new
  cells, not new elements. A source whose length is not finite or not known
  leaves `ArrayFrom` unevaluated. A source with no element gives an array of
  no cell. The count of `Repeat(v, n)` is the count that `ListFrom` reads.
- `type` is a string literal that names the cell type. An operand that is
  not a string literal, or a string that is not a type, is the error
  `invalid-type-declaration`, as for `Declare` (`Typed` gives no error for
  such a string).
- Without `type`, the cell type comes from the static type of `xs`, not
  from its value, so that the type of the expression is the type of the
  array: it is the element type of the type that `let L = xs` gives `L`
  (`docs/TYPE-SYSTEM.md`, "Initialization-defined Program and Block
  contracts"), and `any` when that type states no element type (an empty
  list, a list of two kinds of elements with no common type, an untyped
  parameter).
  A list of numbers gives `number`, so `ArrayFrom([0, 0])` is an
  `array<number>` of expression cells: a program gets machine cells only
  where it names them (`arrayFrom(repeat(0, n), "integer<0..255>")`). With
  `xs` of an array type and no `type`, the cell type is that of `xs`.
- A source that is a name of an array type with no value yet leaves
  `ArrayFrom` unevaluated, and so does `ListFrom`.
- Each element is checked and converted as the value of a store is. One
  element that fails makes the construction an error, and no array is made.
- `ArrayFrom(Repeat(v, n), type)` with `n` above `ce.maxCollectionSize`
  (10,000 by default) fills the storage and builds no list: `Repeat` stays
  unevaluated above that count, and the construction reads `v` and `n` from
  it. Up to that count, `Repeat` gives its list first, as for every other
  operator. The source is an ordinary operand: it is evaluated before the
  construction, also under `evaluateAsync`.
- Each evaluation makes a new array. The construction has the effect `state`.
- When the count is known and before the storage is allocated, the
  allocation function of the host (section 9) is called once. When it
  refuses or throws, and when JavaScript cannot allocate the storage, the
  construction is the error `array-allocation-refused`. With no allocation
  function, the engine sets no limit of its own.

A declaration with a type does not give the cell type to its initializer
(decision C3): `let px: array<integer<0..255>> = arrayFrom(repeat(0, n))` is
`incompatible-type` (an `array<number>` for an `array<integer<0..255>>`), and
its message names the second operand of `arrayFrom`. A prelude names a cell
type once with a type alias (`type alias Byte = integer<0..255>`).

## 5. Reads

| Form                  | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| `At(a, i)`, `a[i]`    | The cell at `i`.                                         |
| `At(a, m..n)`, `a[m..n]`, `a[[i, j]]` | A list of those cells now (below).       |
| `Length(a)`           | The number of cells.                                     |
| `ListFrom(a)`         | A list of the cells now. Later stores do not change it.  |

The index is that of a list: from 1, and a negative index counts from the
end. An index that is 0, not an integer or out of range gives what `At` gives
for a list of that element type (`NaN` for a number cell). A list read out of
range is `NaN` today, not an error (probed at the commit above). The static
type of a read is that of the same read of a list of the cell type: it
carries the absence value where a list read does. `Length` and every read
record a dependency on the version of the array, also a read of no cell.

`At(a, p1, …, pk)` is `At(…At(a, p1)…, pk)`: one index at each step, each
step by the rule of its base (an array, a list, a tuple).

**A range or a list as the index.** `a[m..n]` (`At(a, Range(m, n, 1))`),
`a[[i, j, k]]` and a list of booleans as the index are what they are for a
list (probed at the commit above: `L[2..4]` of `[10, 20, 30, 40, 50]` is
`[20, 30, 40]`): a `list<T>` of the cells at those indexes, in the order of
the indexes, and the empty list for an empty range. An index out of range
gives the element that a read of one cell gives there: `NaN` for a number
cell, the tuple of `NaN` for a tuple cell. `At(a, Range(m, n))` with no step
follows the step of the `Range`, as for a list: `At(a, Range(4, 2))` is
`[40, 30, 20]`, and `a[4..2]` is `[]`. The list is built when
`At` is evaluated, so a later store does not change it. It is a copy, not a
part of the array: no value shares the storage of an array (section 9, "What
the host guarantees"), and a result of an operator over an array is
immutable (Appendix B). A program that needs an array of those cells writes
`arrayFrom(a[m..n], type)`. A store to a range (`a[m..n] = xs`) is the error
that it is for a list today (`incompatible-type`, a range for an integer
index).

`ListFrom(a)` copies the cells: O(n). For an array whose cell type can hold
an object or an array, Appendix B requires a deep walk that detaches each
element (the rule of `DictionaryFrom` of an object, Phase 3 of
`docs/plans/2026-08-13-mutable-objects-implementation-plan.md`, not
implemented). Until that phase, `ListFrom` of such an array is the error
`incompatible-type`, and a program lists the references with a
comprehension (`[a[k] for k in 1..length(a)]`). `ReplaceAt` is not defined on
an array: `ReplaceAt(a, i, v)` as a value is `incompatible-type`, and
`ReplaceAt(ListFrom(a), i, v)` is the list with one cell replaced.

Each read records a dependency on the version of the array, as a field read
does on its object (`boxed-expression/object-deps.ts`).

## 6. The store

`Assign(At(base, i), v)` is the store when `base` evaluates to an array.
`AddTo(At(base, i), e)` reads the cell, adds and stores. The base, the index
and the value are evaluated once each, in that order.

| Source             | MathJSON from the parser                 | Change to the parser |
| ------------------ | ---------------------------------------- | -------------------- |
| `p.pixels[i] = v`  | `Assign(At(Field(p, "pixels"), i), v)`   | None.                |
| `a[i] = v`         | `Assign(a, ReplaceAt(a, i, v))`          | None.                |
| `m[i][j] = v`      | `Assign(m, ReplaceAt(m, i, j, v))`       | None.                |
| `a[i] += v`        | `AddTo(At(a, i), v)`                     | None.                |
| `p.pixels[i] += v` | `AddTo(At(Field(p, "pixels"), i), v)`    | New: today the static error `add-to-target`. |

The parser accepts a compound assignment whose target is an index of any
expression. `add-to-target` stays for every other target (`p.x += 1`).

**A name as the target (decision C1).** The parser cannot know that `a` holds
an array, and its form for `a[i] = v` does not change. The form
`Assign(a, ReplaceAt(a, p1, …, pk, v))`, with the same name on both sides, is
already read as "the element write of `a`" by the interpreter
(`isElementRebinding()` of `library/core.ts`) and by the compiler
(`docs/COMPILATION-MODEL.md`, "List updates"). Its canonical form depends on
the static type of `a`, and of `At(a, p1, …, p(k−1))` when `k` is 2 or more:

- The types prove that every base on the path is an indexed collection (a
  list, and also a tuple or a string, which keep the write that they have
  today): the canonical form is the element-write form, as today.
- Otherwise (a base is an array, or its type does not decide: an untyped
  parameter, `any`, a union): the canonical form is
  `Assign(At(a, p1, …, pk), v)`.

So no rule of `ReplaceAt` gives a list type to a name that can hold an array,
and the static checks, the effects and the compiler see one form of a store.
The nested form `ReplaceAt(ReplaceAt(a, 1, x), 2, y)` is not an element write
of an array.

**The base of a store.** For a target `At(x, p1, …, pk)`, the base is `x`
when `k` is 1 and `At(x, p1, …, p(k−1))` otherwise.

- The base evaluates to an array: the store, at `pk`. With `m` a list of
  arrays, `m[i][j] = v` stores to the array `m[i]`, and `m` is not rebound.
- Otherwise, `x` is a name that holds a list and every base on the path is a
  list: the element write of a list variable, as today.
- Otherwise: the error `immutable-value-assignment`, with the two remedies
  (store a new value in the field or the cell, or declare it an array). So
  `s.px[2] = 9` with `px` a list field, and `a[i][j] = v` with `a` an
  `array<list<T>>`, are this error. CE-1797 is this case for a list field.

**Rules.**

- The index is that of a read. An index that is 0, not an integer or out of
  range is the run error `out-of-range`, as for a list variable. A store never
  grows the array.
- A binding declared `const` that holds an array accepts a store: the binding
  does not change. The static check `constant-assignment` applies to an
  element write only when the types prove a list (the first case above). An
  element write of a constant that holds a list, found when it runs, is the
  run error of an assignment to a constant.
- A store has the effect `state` and not `scope`. An element write whose
  types do not decide between a list and an array has both labels.
- A store does what `BoxedObject._store()` does for a field: it drops a
  store of the value that the cell holds; otherwise it writes the cell,
  increments the version of the array, advances the store epoch of the engine
  (`_objectStoreEpoch`, which the memo of pure applications reads) and
  registers one state event. It changes no field and no version of an object
  or a tuple that holds the array.
- A store costs O(1) time and stack for every storage.

### The exchange of two arrays

`Swap(a, b)`, in Epsil `swap(a, b)`, exchanges the cells of two arrays of one
cell type, in O(1): after it, `a` has the cells and the count that `b` had,
and `b` those that `a` had. No cell is copied. Neither array changes
identity, so every name, field and tuple that held `a` still holds `a`. Its
value is `Nothing`. It has the effect `state`, and does what a store does
after its write: it increments the version of both arrays, advances the
store epoch and registers one state event. `Swap(a, a)` does nothing. Two
arrays of two cell types are `incompatible-type`.

This is the exchange of a program that computes into a second buffer (a
cellular automaton, a blur): it writes `next` from `cur`, then
`swap(cur, next)`, and `cur` names the current cells at every step. The same
exchange by assignment, `(cur, next) = (next, cur)`, assigns two variables
and changes which array each name holds. `Swap` assigns none: it also
exchanges two arrays that no name holds (`swap(r.pixels, scratch)` for a
raster that is a tuple, whose field cannot be assigned).

## 7. Identity and the rest of the object rules

An array follows the object rules of Appendix B, with "array" for "object":

- `==` and `!=` compare identity. Two arrays with the same cells are not
  equal. Two tuples that hold arrays are equal only when they hold the same
  arrays.
- The hash comes from the identity alone, as for an object: a store does not
  change it. The digest is the content digest of an object (it reads every
  cell, and it is not memoized).
- A value that holds an array is not cached (rule B3): `containsObject()`
  answers true for it.
- An array belongs to one engine: the rule `object-foreign-engine` applies.
- Lifetime is the host's garbage collection (B12). The engine keeps no list
  of the arrays that are alive.
- An array of expression cells can hold itself. The display and the
  serialization mark a cycle as they do for objects.
- The display, the hash, equality and the cache rules read no cell of an
  array of more than 16 cells.

The version is a change signal. Two reads of the same version saw the same
cells. A larger version does not prove that a cell changed: compiled code
increments it at each store (section 10.5).

## 8. Serialization and display (T5)

- `.json` and `toMathJSON()` write `["Object", ["List", …cells], "'array<T>'"]`:
  the snapshot of the cells under the provenance head (B5), with the walk and
  the cycle markers of `objectJson()` for a cell that holds an object or an
  array. Evaluating it gives the list. This is O(n).
- `toMathJSON()` takes an option `objects`, a function from an object or an
  array to the MathJSON written in its place, or `undefined` for the default.
  A host that sends a figure to another thread writes a reference of its own
  there and sends the storage beside it. The values `'record'` and `'reject'`
  of Phase 3 of the objects plan are not part of this spec.
- A display (`print`, the Epsil form of a value, the text of a result,
  `toString()`, and `.latex`, also for a value that holds the array) writes
  an array of 16 cells or fewer as its constructor
  (`arrayFrom([1, 2, 3], "integer<0..255>")`) and a longer one as its type and
  count: `array<integer<0..255>> of 64000`.

## 9. The host interface (T1, T2, T7, T8, T9)

Public members, none with a name that starts with an underscore. The names
are this spec's choice.

- `isMutableArray(x)`: the guard. `BoxedArray`: the type of the value.
- On an array value, each in O(1):
  - `cells`: the storage, by reference. A typed array for machine cells
    (with four bytes for each tuple cell, so its length is `4 × count`), a
    read-only array of expressions for expression cells.
  - `version`: the change signal of section 7.
  - `count`: the number of cells.
  - `cellType`: the cell type.
  - `noteStore()`: a host that wrote cells through `cells` calls it once after
    its writes. It does what a store does after its write: the version, the
    store epoch and one state event.
  - `swapCells(storage)`: the array takes the typed array `storage`, of the
    same kind and length, as its cells, and gives back the cells it had. It
    counts as a store. A host that computes a frame in a second buffer
    exchanges the two with no copy (T7).
- `ce.array(storage, cellType?)`: a new array that adopts the typed array
  `storage` as its cells, with no pass over them (a decoded photo, the bytes of
  a file). Without `cellType`, the cell type is the full range of the storage
  kind (`integer<0..255>` for a `Uint8Array`, `real` for a `Float64Array`). It
  throws for a `cellType` that selects another storage kind, for a typed
  array of a kind that section 3 does not list (`Float32Array`,
  `BigInt64Array`, `Uint8ClampedArray`), and for a view of a
  `SharedArrayBuffer`. With a tuple cell type, the count is
  `storage.length / 4`, and it throws for a length that is not a multiple of
  4. For the bytes of an `ImageData`, the host passes
  `ce.array(new Uint8Array(data.buffer), 'Pixel')`, which shares them.
- `ce.arrayAllocation`: `undefined`, or a function
  `(count, bytesPerCell) => boolean` called before the engine allocates
  storage (`ArrayFrom`, and growth later). `bytesPerCell` is 4 for a tuple
  cell and 8 for expression cells. It is a permission, not a count of what is alive: a construction can
  fail after it accepted, and the engine reports no release. A host that
  limits a total counts the arrays that it holds (T9). `ce.array()` and
  `swapCells()` do not call it.
- `ce.arrayCreated`: `undefined`, or a function called with each array that
  `ArrayFrom` made, after the construction, from the interpreter and from
  compiled code. A host that limits the bytes alive holds a weak reference to
  each array: the prelude code that makes a raster gives the host no other
  reference. The engine does not catch an exception that this function
  throws.

**What the host guarantees.** The engine does not check these, and the result
is unspecified when one does not hold:

- One typed array, or two views that overlap, are the cells of one array
  only.
- Every cell of a storage that the host adopted or wrote holds a value of
  the cell type.
- The host calls `noteStore()` after it writes through `cells`, before any
  code of the engine reads the array.

The storage that `cells` gives is valid until the array changes its length
(section 13), or `swapCells()` or `Swap` runs. A host reads `cells` at each use and
keeps no copy of the reference between two calls.

A host function receives an array argument as the engine's value, in the
interpreter and from compiled code. In the interpreter, a host function can
return an array.

## 10. Compiled JavaScript (extends B9; T3, T4, T6)

Arrays of machine cells compile on the `javascript` target, in the default
mode.

### 10.1 One storage

The cells exist once. The interpreter, compiled code and the host read and
write the same typed array. `run()` copies no cell when it starts or when it
returns. A compiled unit keeps no array of its own between two calls: in one
run of a Tycho cell a timer tick is compiled, an event handler is interpreted
and a debug tick is interpreted, and the three write the same cells.

### 10.2 How an array reaches the code

- A parameter of the root function literal declared `array<T>`: the host
  passes the engine's array value to `run()`. The entry refuses a value that
  is not an array of that cell type with a `TypeError`.
- A name whose value is an array: `run()` reads the array that the name
  holds at each call, from the definition of the name at the compilation,
  and refuses with a `TypeError` a value that is not an array of the cell
  type of the compilation. The name is not in `symbolDeps`. So an assignment of the name
  between two calls, by the interpreter or by another compiled function,
  needs no new compilation. A number variable is held as a literal because
  the code can fold it; an array has nothing to fold.
- A name whose value holds an array (a named tuple with an array field): the
  code holds the reference that the value has when it is compiled, as it
  holds the fields of a record today. The name is in `symbolDeps`, and the
  host compiles again when the name is rebound.
- A parameter declared `array<T>` of a user function that the code calls by
  its name, a field of a record (`r.pixels`), a block local
  (`let px = r.pixels`, also one that the block assigns another array of the
  same cell type), and the two arms of an `If` that are arrays of one cell
  type: an array is one shape whatever its length.
- `ArrayFrom(xs, type)` with `xs` a list of numbers that the code holds, a
  `Repeat(v, n)` or an array: one call into the engine, which makes the
  engine's array value. Every array that compiled code holds is an array of
  the engine.

### 10.3 What compiles

`At(a, i)`, the store, `AddTo` of a cell, `Swap(a, b)`, `Length(a)`,
`ArrayFrom` as above,
`ListFrom(a)` (a copy to the list carrier), `At(a, I)` with `I` a range, a
list of indexes or a list of booleans, of cells of one number, where the
same read of a list compiles (the list is built where the read stands; of
tuple cells it declines), and an array, or a record or a
list literal that holds one (a Tycho `Figure` that the program builds), as an
argument of a host function: the host receives the engine's value, the same
reference as in the interpreter.

A tuple cell compiles: a read is a tuple of the code (an array of four
numbers), a read of one element (`a[i].r`, `a[i][2]`) is one read of the
typed array with no tuple built, and a store of a tuple writes its four
bytes. A tuple that the code builds and stores (`a[i] = Pixel(r, g, b, 255)`)
allocates nothing.

A user function called by its name reads and writes an array that it takes
as a parameter or that a name holds, whatever the form of its definition
(`function set(r, x, y, p) { … }`, `let at = (x, y) => …` called as
`at(…)`): the helpers `get` and `set` of a prelude compile.

### 10.4 The values

- A read gives the interpreter's value for every index, `NaN` included.
- A store maps a negative index from the end, as the interpreter does, and
  makes no other test of the index and no test of the value (decision C2). An
  index that is 0, not an integer or out of range stores nothing, where the
  interpreter gives `out-of-range`. A value outside the cell type is stored
  as JavaScript stores it in the typed array (a `Uint8Array` cell keeps the
  low 8 bits of 300), where the interpreter gives `incompatible-type`. Both
  are errors that the static type does not show, which the caveats of
  compiled code leave unspecified. `docs/COMPILATION-MODEL.md` gets one line
  for each under "Caveats of compiled code".
- A value of another lane declines with `lane-mismatch`: a real for integer
  cells, a boolean or a complex number for any cell. An integer for `real`
  cells compiles.
- `AddTo(At(a, i), e)` evaluates `i` once, before `e`.
- The code reads the storage and the length from the array at each use, not
  once for the unit. An exchange of two storages between two uses needs no
  alias analysis.

### 10.5 The version and the state event (T2)

Compiled code increments the version of an array at each store, with no
comparison with the cell (decision C4), and of both arrays at a `Swap`. A
unit that holds a store or a `Swap` advances the store epoch and registers
one state event before each host call that it makes and when `run()` returns
or throws, not at each store.

### 10.6 What declines

- An array of expression cells, and a value typed bare `array`.
- An array as the result of the unit, alone or in a record or a list (B9).
- A host call whose static result type is an array type or a type that
  holds one: a program loads a photo in an interpreted statement (T8). A
  host call returns a real, an integer, a boolean or nothing today
  (`docs/COMPILATION-MODEL.md`, "Functions of the host"), and this spec does
  not change that.
- A read or a store of an array in the body of a function literal that is an
  operand or a value (`map(k => a[k], 1..n)`, `let f = k => a[k]` given to
  `reduce`): the interpreter can keep the collection as a view and compute an
  element after a later store, where compiled code builds the list at once
  (`docs/COMPILATION-MODEL.md`, "Variables that a function assigns", has the
  same decline for a variable). The program writes a loop or takes
  `listFrom(a)`.
- A list of arrays, and an array in a `parallel for` or in `runAsync()`.
- `interval-js` and the `bigint` mode.

The code is not `shippable`, and `load()` refuses it: it holds values of the
engine. The engine's own compilations (`Map`, the quadrature) interpret a
function that reads or writes an array.

### 10.7 A function that assigns a variable and calls the host (decision U6)

Today a host call declines "in a function that assigns a variable of the
engine" (`docs/COMPILATION-MODEL.md`, "Functions of the host"): the code
holds the new value of the variable until `run()` returns, and the host
function would read the old one. This spec lifts that rule for a variable
that is a number, a boolean or an array:

- A host call reads and writes each variable of `assigns`. Before the call,
  the code writes the value of each one to the engine, as `run()` does when
  it returns. After the call it reads each one again: a host function can
  assign a variable. A variable that then holds no value of its lane throws
  the `TypeError` of the entry.
- So a `Loop` around a host call carries each variable of `assigns`, the two
  arms of an `If` give each one, and a user function that reaches a host
  call, itself or through its calls, takes and returns each one.
- A variable of an array type is in `assigns` like a variable of a number:
  `board = next` and `(cur, next) = (next, cur)` compile, in the root
  function and in a user function where the same assignment of a number
  compiles. Its write and its read are one reference.
- A call that throws keeps the values written at the last host call before
  the throw, and the values that a host function assigned. With no host call
  before the throw it writes nothing, as today.

So `t => do { step(); (cur, next) = (next, cur); draw(cur) }` and
`t => do { s = s + t; hostDraw(s) }` compile. These decline:

- a list variable, or a variable that is a list of lists, in `assigns` of a
  function that makes a host call, as today: a list is not carried as a
  number is, and it would be written whole at each call. Tycho's
  `do { g = step(g); draw(bitmap(g)) }` with `g` a list declines; with `g` an
  array it compiles;
- a host call, or a call of a user function that reaches one, in the body of
  a `Sum`, in a callback of `Map` or `Filter`, or in another body that is
  evaluated several times, in a function that assigns a variable: that body
  carries no variable (`docs/COMPILATION-MODEL.md`, "Variables that a
  function assigns");
- a user function that reaches a host call and is given by its name to an
  operator (`map(f, L)`) or mapped over a list, and a recursive function or
  a cycle of functions that reaches a host call, in a function that assigns
  a variable.

### 10.8 Objects

A field read or a field store of an object (`type T = object{…}`) does not
compile today, and this spec does not change that. It is Phase 4 of
`docs/plans/2026-08-13-mutable-objects-implementation-plan.md`. A raster that
is a named tuple, `tuple<width: integer, height: integer, pixels: array<…>>`,
compiles with section 10 alone (decision C5): records compile on JavaScript
(CE-1652), the width and the height never change, two such tuples are equal
only when they hold the same array (section 7), and the host exchanges two
buffers with `swapCells()`. The index test of an array does not give the
rule of a raster for a position outside it: an `x` outside the width with an
index inside the array is a pixel of another row. The helpers `get` and `set`
of the prelude test `x` and `y`.

## 11. Compiled GLSL (T10, in part)

A GLSL program reads an array. This reverses, for arrays, the ratified ruling
B9 of Appendix B, "the GPU target has no references and declines" (decision
U1, the user's direction of 2026-11-25).

A fragment shader has no store to a cell at a computed index: its one write
is its result. So on GLSL:

- **A read compiles**: `At(A, i)` and `Length(A)`, where `A` is an input of
  the program: a free name declared with an array type that has no value, or
  a name of the `inputs` option. This is how every input reaches a GLSL
  program today; the target has no root function literal
  (`adapter-glsl.ts`). An array given to a user function as an argument
  compiles.
- **Everything else declines:** a name that holds an array value and is not
  in `inputs`, a read with a range or a list as the index, a store, `Swap`, `AddTo` of a cell, `ArrayFrom`, `ListFrom`, an array
  result, an array in a record (GLSL declines every record).
- **The cells must be exact on the target.** On GLSL an integer is exact
  within 2^24 (`compilation/ir/README.md`, "The contracts"). Integer machine
  cells whose declared range is within −16,777,216 to 16,777,216 compile:
  every 8-bit and 16-bit storage, and a 32-bit storage of such a range. A
  wider range declines, so a pixel packed as `0xRRGGBBAA` in one cell does
  not compile on GLSL; a tuple cell of four `integer<0..255>` does, and its
  read is a `vec4`. `real` cells are read as 32-bit floats, the precision of
  the target.
- **The count is at most 16,777,216 cells.** The index is a float on this
  target, so it is exact only to that count. The host guarantees it, and
  uses JavaScript for a longer array. This is one line of the known
  limitations.

**The binding.** For an array input `A`, the host declares and binds two
uniforms:

- A sampler named `A`: `highp usampler2D` for `Uint8Array`, `Uint16Array`
  and `Uint32Array` cells, `highp isampler2D` for the signed ones,
  `sampler2D` for `real` cells. The texture holds one cell in each texel,
  row-major from texel (0, 0), with nearest filtering: the red channel for a
  cell of one value (`R8UI`, `R16UI`, `R32UI`, `R8I`, `R16I`, `R32I`,
  `R32F`), and the four channels for a tuple cell (`RGBA8UI`), so a read of
  a tuple cell is one fetch and one index test. Its width is read in the
  shader, so the host chooses it. It holds at least as many texels as the
  array has cells: the host pads the last row. The host uploads the storage
  of section 9 (with `UNPACK_ALIGNMENT` 1 for 8-bit and 16-bit cells), except
  `real` cells, which it converts to a `Float32Array`. It uploads again when
  `version` changed.
- An `int` uniform named `A_count`, with the count of the cells. A program
  that has another input of that name declines.

The result lists `A` in `freeSymbols`, and `freeSymbolTypes.A` has the
sampler type in `lowered` and the new field `count: 'A_count'`. The check of
the `storage` and `inputs` options admits a name of an array type that has a
value. A user function that takes an array takes the sampler and the count as
two arguments.

This is the texel read of
`docs/plans/2026-09-05-sampler-backed-positional-access.md`, with a sampler
type from the cell type, a helper for each sampler type beside
`_gpu_ir_texel`, and a length that is a uniform, not a length stated in the
type.

**The index.** As for a list on GLSL (`docs/COMPILATION-MODEL.md`, "GPU
`At`"): from 1, from the end when negative, and `NaN` for an index that is 0,
not an integer or out of range. The test runs in floats before the conversion
to `int`, against the count uniform. A constant index that is 0 or not an
integer declines; every other constant index gets the run-time test.

**How the first consumer reaches it.** A raster is a record, and GLSL
declines records. Tycho's host compiles the pixel function of `compute` or
`adjust` for GLSL itself. Its operator for a read of a pixel has a `compile`
handler (`compilation/ir/README.md`, "Layers"), which on GLSL answers
`At(A, index)` with `A` an array input that the host declares for the pixels
of that raster, and the width as a number. Tycho's session confirmed this
path on 2026-11-25 (decision C7), for a pixel that is a tuple of four
channels: a pixel packed in one number has no exact form in a shader, and a
pixel that the function holds as a number (a captured `live`) cannot be
changed to channels by a handler.

**A normalized texture.** With `storage: { A: 'sampler2D' }`, an array of
`Uint8Array` cells (of one value or of a tuple) is read from a normalized
texture (`R8`, `RGBA8`): the value of a cell is
`floor(255 × channel + 0.5)`, which is exact. A framebuffer of that format is
read back as the bytes of the cells (`RGBA`, `UNSIGNED_BYTE`), which an
unsigned integer framebuffer does not guarantee in OpenGL ES 3.0. The result
of a pixel function is a tuple of values from 0 to 255: the shader of the
host divides it by 255 before it writes a normalized framebuffer. The host
chooses between the two. Tycho's session asked for this choice on 2026-11-25
and did not check it in a browser; stage 5 checks it.

## 12. Other targets and modes

`interval-js` and the `bigint` mode decline an array. An option `storage` for
an array input is ignored on JavaScript, as for a list.

## 13. Growth (a later stage)

`Push(a, v)`, `Pop(a)`, `Insert(a, i, v)` and `RemoveAt(a, i)` change the
length in place, each with the effect `state` (Appendix B, "Growth and
mutation API"). The raster does not need them. The earlier stages keep two
rules so that growth adds no change to them: the storage and the count are
read from the array at each use, and `cells` has exactly `count` cells.
`Push` is O(1) amortized. Compiled code declines the four operators until a
witness asks for them.

## 14. Collection integration (a later stage)

An array becomes a `collection` with the traversal rule of Appendix B
("Effect-directed traversal"): an operator over an array reads a snapshot of
its membership when its callback can store, and reads the cells in place when
it cannot, and its result is immutable. Until then the type refuses the
operators (section 2), which is sound: a later version turns an error into a
value.

## 15. Decisions

### Decisions that the user approved on 2026-11-25

**U1. A GLSL program reads an array.** Ruling B9 says that the GPU target
declines objects, and Appendix B puts arrays under the object rules. Section
11 lets a shader read an array input and declines every write. The user asked
for GLSL support "with some limitations if necessary" on 2026-11-25. B9 is
amended for arrays.

**U2. `array<real>` holds doubles** (Q1 of the ruling list). The witness is a
table of reals that a compiled loop writes: the depth of each column of a
raycaster, a table of a dynamic program.

- (a) Taken: a `Float64Array`. The interpreter gives `0.3333333333333333` for
  `a[1] = 1/3; a[1]`. A cell holds no infinity and no `NaN`. A shader reads
  the cells as 32-bit floats after a conversion by the host.
- (b) Expression cells: the values are those of a list, and compiled code
  declines the array.

**U3. Flat storage replaces the persistent interior of Appendix B.** The
appendix says that an implementation "may" hold an array as
`object{items: list<T>}`, and states costs that follow from it: `ArrayFrom`
of a list in O(1) with a copy at the first store, `ListFrom` in O(1) for
cells with no mutable type. With the storage of section 3 both are O(n)
copies, and a store never copies. The host reads a typed array by reference
(T1), which a persistent list cannot give.

**U4. An array is not a collection in this version.** Appendix B says that
`array` "should be a `collection`" with the traversal rule. Section 14 keeps
that as a later stage. Alternative: make it a collection now, with every
collection operator reading the `ListFrom` snapshot; each operator over a
raster would then copy its cells.

**U5. A pixel is a tuple cell, not a `color` cell.** The user asked on
2026-11-25 whether a cell could be a `color`. The need behind the question is
real: a pixel must be one value with one form in the interpreter, in compiled
JavaScript and in a shader, and one cell must be one pixel and one texel. A
number `0xRRGGBBAA` is not that value: it has no exact form in a 32-bit
float.

- (a) Taken: the tuple cell of section 3, for a tuple of four bytes only
  (the user, 2026-11-25). The pixel is the one witness, so no other tuple
  gets flat storage: one storage, one texture format, one stride. A flat
  cell for another tuple (a point of two reals) is a later item with its own
  witness; it would change what `cells` gives for that type, from
  expressions to a typed array. The cell is exact, it is the bytes that
  `ImageData` and an RGBA texture take, and a tuple of four numbers already
  compiles (an array on JavaScript, a `vec4` on GLSL; probed at the commit
  above). A color becomes a pixel by a function of the prelude
  (`pixel(color)`). Tycho's session reached the same form for its pixel on
  2026-11-25, and measured a frame of 320 × 200 at 1.0 ms for four byte
  writes for each pixel, against 0.21 ms for one packed cell and 4.9 ms for
  a packed number unpacked with `floor` and `%`.
- (b) A `color` cell. Not taken, for three facts probed at the commit above.
  A `color` is not 8 bits: it has five spaces, real channels outside 0 to 1
  and an optional alpha, so an 8-bit cell does not hold every value of its
  type, and `a[i] = c` then `a[i] == c` is false for most colors. Compiled
  code declines a color with alpha on both targets (`Rgb` with four
  operands). Compiled code holds a color in OKLCh (an object on JavaScript,
  a `vec3` with no tag on GLSL), so each read and each store of a cell would
  convert between sRGB and OKLCh, and a copy of a pixel would not give the
  same bytes (`AsRgb(AsOklch(Rgb(0.2, 0.4, 0.6)))` is
  `Rgb(0.20000000000000273, …)`). A `color` cell can come later, defined on
  the tuple cell, when the color lane has alpha and keeps an sRGB color as
  it is.
- (c) Four cells of `integer<0..255>` for each pixel, with a storage kind
  that puts four cells in one texel (revision 2 of this spec). The program
  writes the index arithmetic of the channels, and a read of a pixel in a
  shader is four reads that a pass must merge.

**U6. A function that assigns a variable of the engine can call the host.**
Section 10.7. The rule that it lifts is a decision of the user, who said on
2026-11-25 that it was made to keep the implementation simple and can be
lifted at a reasonable cost. The cost, estimated from a read of `hostCall()`
and `stateWrite()` of `compilation/ir/lower.ts` and of `assigningRun()` of
`adapter.ts`, and revised after the second review, not measured: 500 to 800
lines with tests. The code already
carries each assigned variable as a local, through user functions and
`Loop`s (CE-1776), and writes it back in one place; the change gives a host
call those values as operands and results, and moves the write-back code
where the host caller can use it. Stage 4 of the plan already adds a step
before each host call (the state event), at the same place.

- (a) Approved by the user: lift it for numbers, booleans, arrays and
  lists. Revision 7 leaves lists out: a list is not carried as a number is
  (it is a local written whole, with its length), a list of lists is written
  only by a statement of the body, and the one program that would use it
  (Tycho's `do { g = step(g); draw(bitmap(g)) }`) declines in any case,
  because `draw` is a user function. A list variable with a host call stays
  the decline that it is today, and is a later item with its own witness.
- (b) Lift it for arrays only. The same mechanism, and a rule with an
  exception.
- (c) Keep the rule. A program with two buffers then uses `swap`, which
  assigns no variable.

### Choices of this spec

**C1. `a[i] = v` keeps its parser form** (Q2 of the ruling list). Taken:
section 6. The MathJSON that the parser writes for a list write does not
change, and the user's decision of 2026-11-06 on that form stands. The
canonical form changes for one case: an element write of a name whose type
does not prove a list (an untyped parameter) becomes `Assign(At(…), v)`.
Measured in stage 2b with the full suite: 4 tests changed (they pinned the
canonical form or the refusal of an `At` target) and no snapshot. Alternative (a) of the ruling list: the parser gives
`Assign(At(a, i), v)` for every target; the element-write form is read in 19
source files and named in 19 test files (counted with `grep` at the commit
above). Alternative (b): a store only through a field or a method.

**C2. A compiled store makes no range test.** Taken: section 10.4, by the
cost rule of `AGENTS.md` (a check would be most of the cost of a store). A
compiled read gives `NaN` with no range test: a read outside the cells of a
typed array is `undefined`, and the code converts it to a number.
Alternative: the store throws `out-of-range`, as the write of a list local
does today (`_wix`). A run in the interpreter reports the error in both
cases.

**C3. `ArrayFrom` takes the cell type as an operand.** Taken: section 4.
Alternative of the ruling list: the declared type of the binding, the field
or the parameter gives the cell type. The type system has no flow of an
expected type into a call, and invariance refuses the conversion afterwards.

**C4. Compiled code increments the version at each store.** One addition.
The interpreter drops a store that changes nothing, as a field store does;
compiled code does not compare. Alternative: once for each array when the
unit returns; it needs the set of the arrays stored to, which the code does
not know statically. Measured in stage 4.

**C5. Phase 4 of the objects plan is not on the path.** Taken: section 10.8.
Alternative of the ruling list: compile object fields on JavaScript with the
arrays.

**C6. A read of a cell, of the count and of the storage of an array is an
effectful instruction of the IR.** It keeps its place, its count and its
order, so no pass moves it across a store, a `Swap` or a host call
(`swapCells()`). A finer
effect class is an optimization for later.

**C7. The GLSL path of Tycho is confirmed** by its session (2026-11-25),
not by the user: section 11. Its other requests are in this revision: one
fetch for one pixel (the tuple cell), the normalized texture, and
`ce.arrayCreated`.

**C8. `ListFrom` of an array of objects or arrays is an error** until
Phase 3 of the objects plan. Section 5. Alternative: a list of the
references; Appendix B rules it out ("deep detachment is the serialization
walk's job").

**C9. What became of the ruling list.** Kept: AR1 (the storage, with the
cell type as an operand), AR2 (with the canonical form of C1), AR4, AR7,
AR8, AR9. Changed: AR3 (a read out of range is `NaN`; a compiled store makes
no range test), AR5 (the interpreter registers one event for each store that
changes a cell, with no coalescing planned), AR6 (GLSL reads; a host call
keeps its result types). Dropped: section 1 of the list, whose interpreter
measurements predate the fix of CE-1796 (`eb2819bdb`).

**C10. `Swap` exchanges two buffers.** Taken: section 6. The user asked on
2026-11-25 whether a Game of Life can keep its cells in an array and write a
second array that it exchanges at each generation. With decision U6 the
exchange by assignment compiles too. `Swap` stays for two reasons: it
exchanges arrays that no name holds (the `pixels` of a raster that is a
tuple), and a value that holds the array (a tuple, a figure) shows the new
cells with no new value. Alternative: no `Swap`; a raster that is a tuple
then exchanges its buffers only through the host (`swapCells()`).

## 16. The ten needs of Tycho, and what is not in this spec

| Need | Disposition |
| ---- | ----------- |
| T1 The cells as a typed array, by reference | Sections 3 and 9. |
| T2 A count of the writes | `version`, sections 7 and 10.5. |
| T3 One store for the interpreter and compiled code | Section 10.1. |
| T4 A write in constant time and stack | Section 6. |
| T5 An output that does not write the cells | Section 8. |
| T6 A figure that holds the array passes through a compiled `draw` | Section 10.3, for a figure that the program builds. |
| T7 A function parameter called in a compiled loop; an exchange of two arrays | The first is not in this spec (below). The second is `Swap` and `swapCells()`. |
| T8 A host function that returns an array | In the interpreter. Compiled code declines (section 10.6). |
| T9 The size of an array with no read of its cells | `count`, `cellType`, `ce.arrayAllocation`, `ce.arrayCreated`. |
| T10 The texture backend | A read of an array, section 11. The rest is below. |

Not in this spec, each a separate item:

- A function literal passed to a user function that calls it in a loop
  (`docs/COMPILATION-MODEL.md`, "Function values"). Tycho's `compute` and
  `adjust` are host functions that compile the pixel function themselves.
- Bitwise operators on integers and a `uint` lane on GLSL. They make a
  packed pixel exact on GLSL; a tuple cell needs neither.
- A `color` cell (decision U5).
- A filtered `sample`, and a color result with alpha. A pixel function can
  return a tuple of four numbers, a `vec4`, today.
- A direct call of a host function from compiled code, with no boxing.
- Compound assignment to a field (`p.x += 1`), and subscript accessors on
  object types (Appendix B, "Deferred").

## 17. Documents that change when this lands

`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B. These sentences are replaced:

- "An implementation may even represent an array internally as
  `object{items: list<T>}` with indexing sugar, composing with
  copy-elision-when-unique so the persistent interior updates in place when
  unshared." Replaced by the storage of section 3.
- "a **materialized `list`** wraps in O(1) as the interior, the copy paid
  lazily at the first store", and "`ListFrom(a)` is O(1) whenever the element
  type contains no mutable types". Both are O(n) copies.
- "the one constructor is **`ArrayFrom(xs)`**": it takes the cell type as a
  second operand.
- "`array` should be a `collection`": a later stage (section 14).
- "The GPU target has no references and declines" and the entry B9 of the
  decision record: a shader reads an array input.

The other documents:

- `docs/TYPE-SYSTEM.md`: the type, its place in the lattice, invariance.
- `docs/COLLECTIONS-MODEL.md`: the `…From` family; an array is not a
  collection.
- `docs/EFFECTS-MODEL.md`: three more emitters of `state` (`ArrayFrom`, the
  store of a cell, `Swap`).
- `docs/ERROR-MODEL.md`: `array-allocation-refused`.
- `docs/COMPILATION-MODEL.md`: "Sums and objects", a section "Arrays", the
  caveats of section 10.4, "GPU `At`", the known limitations of sections
  10.6 and 11, and "Functions of the host" and "Variables that a function
  assigns" for section 10.7 (the rule that is lifted, and what a call that
  throws writes).
- `src/compute-engine/compilation/ir/README.md` and the header of
  `compilation/storage-hints.ts`: the array lane, the storage of an array
  input.
- `src/math-json/OPERATORS.json`: `ArrayFrom`, `Swap`.
- `src/epsil/docs/` (the language reference, with the compound assignment to
  an index of a field, and the library reference) and the guides of
  `~/dev/cortexjs.io/docs/compute-engine/` that list the types, the
  collection operators and the compile targets. `CHANGELOG.md`. `src/api.md`
  is generated.
- `issues/CE-1797.md` closes with the diagnostic of section 6.

## 18. Acceptance

Each case is a test unless it says "measured". "Both runs" means the
interpreter and compiled JavaScript.

1. **Type.** `array<integer<0..255>>` parses and prints. An `array<integer>`
   is refused where an `array<number>` is declared. `array<any>` is not bare
   `array`. `Sum(a)`, `Map(a, f)`, `ReplaceAt(a, 1, 0)` and `a + 1` are
   `incompatible-type`.
2. **Identity.** After `let b = a` and `a[1] = 7`, `b[1]` is 7. `a == b` is
   true, and `a == arrayFrom(a)` is false. A `const` array accepts a store,
   with no `constant-assignment`. The hash of an array is the same before and
   after a store.
3. **Cells.** For each storage of section 3: a value in range keeps its
   value; a value out of range, and a real for integer cells, are
   `incompatible-type` in the interpreter. `a[1] = 1/3` in an `array<real>`
   reads `0.3333333333333333`, and in an `array<rational>` reads `1/3`. An
   infinity is refused by an `array<real>`.
3a. **Tuple cells.** An `array<Pixel>` of `n` cells, with `Pixel` a named
   tuple of four `integer<0..255>`, has a `Uint8Array` of `4n` bytes as its
   `cells`. `a[i] = Pixel(1, 2, 3, 4)` writes the four bytes of cell `i`;
   `a[i]` is that tuple, `a[i].g` is 2 and `a[i] == Pixel(1, 2, 3, 4)` is
   true, in both runs. A channel of 300 is `incompatible-type` in the
   interpreter. `a[i].r = 9` is `immutable-value-assignment`. `a[0]` is the
   tuple of four `NaN`.
4. **Construction.** `arrayFrom([])` is an `array<any>` of no cell.
   `arrayFrom([0, 0])` is an `array<number>`. `arrayFrom(repeat(0, 0),
   "real")` has no cell. A type operand that is not a type is an error. An
   array of objects holds the objects by reference (a field store through a
   cell shows through the name of the object). `listFrom` of that array is
   `incompatible-type`.
4a. **A range as the index.** With `a` of the cells 10, 20, 30, 40, 50:
   `a[2..4]` is the list `[20, 30, 40]`, `a[[1, 3, 5]]` is `[10, 30, 50]`,
   `a[4..7]` is `[40, 50, NaN, NaN]` and `a[4..2]` is `[]`, in both runs.
   After `let s = a[2..4]` and `a[2] = 99`, `s` is `[20, 30, 40]`.
   `At(a, Range(4, 2))` is `[40, 30, 20]`. Of an `array<Pixel>`, `a[[0]]`
   is a list of one tuple of four `NaN` (the interpreter).
   `a[2..3] = [7, 8]` is `incompatible-type`.
5. **Index.** `a[-1]` is the last cell, and `a[-1] = v` stores to it, in
   both runs. `a[0]`, `a[n + 1]` and `a[1.5]` read `NaN` in both runs, also
   as the result of the compiled function. A store there is `out-of-range` in
   the interpreter.
6. **The forms of a store.** `a[i] = v` of a name declared an array has the
   canonical form `Assign(At(a, i), v)` and the effect `state`. In a function
   with an untyped parameter, `a[i] = v` stores for an array argument and has
   the effects `scope` and `state`; a list argument is mapped over, as it is
   today for every function with an untyped parameter. A local declared
   `any` that holds a list keeps its element write, and one that holds an
   array stores. `p.pixels[i] += v`
   parses and stores. `m[i][j] = v` with `m` a list of arrays stores to
   `m[i]`. `s.px[2] = 9` with `px` a list field, and `a[i][j] = v` with `a`
   an `array<list<integer>>`, are `immutable-value-assignment`.
7. **Cost.** A store to an array of 1,000,000 cells takes the time of a store
   to an array of 100 cells within a factor of 2, in the interpreter
   (measured), and a loop of 100,000 interpreted stores does not overflow the
   stack.
8. **Version and caches.** The version of an array increases at each store
   that changes a cell, and no field or version of an object or a tuple that
   holds the array changes. A pure user function that reads a cell
   (`f(a) = a[1]`) gives the new cell after a store by the interpreter, after
   a store by compiled code, and after a host write with `noteStore()`.
9. **One storage.** A compiled function stores to an array that a variable of
   the engine holds; an interpreted statement reads the new cell; the host
   reads it through `cells` with no call between. No cell is copied (the
   `cells` reference is the same before and after `run()`). A compiled unit
   that stores and then calls a host function has registered its state event
   when the host function runs.
10. **Host.** `ce.array(new Uint32Array(n))` adopts the storage (the
    reference is the same). `ce.array()` throws for a `Uint8ClampedArray`,
    for a `Float32Array` and for a `cellType` of another storage kind.
    `swapCells()` exchanges two storages and increases the version. The
    allocation function receives `(n, 4)` for an
    `arrayFrom(repeat(0, n), "integer<0..4294967295>")`, and its refusal is
    `array-allocation-refused`. With `image` a function of the program that
    builds a named tuple that holds the array of `r`, and `draw` a host
    function, a compiled `draw(image(r))` passes the array by reference.
11. **Display and serialization.** `print` of an array of 64,000 cells
    writes `array<integer<0..255>> of 64000`, and of three cells writes its
    constructor. `.json` is the `Object` form of section 8.
    `toMathJSON({ objects })` writes the host's replacement and reads no
    cell.
12. **Compiled programs.** A prelude with a raster that is a named tuple and
    the helpers `get` and `set` compiles, and a frame loop that calls them
    gives the cells of the interpreter. So do a sieve, a sort by exchanges
    and a table of a dynamic program.
12a. **The Game of Life.** With `cur` and `next` two arrays of
    `integer<0..1>` that two names of the engine hold, a function `step()`
    that writes each cell of `next` from the eight neighbors in `cur` (with
    wrapped indexes) and ends with `swap(cur, next)`, and a callback
    `t => do { step(); draw(cur) }` with `draw` a host function: the callback
    compiles, a blinker turns by a quarter turn at each call, `draw` receives
    the array `cur` with the new cells, and 50 calls give the cells of 50
    interpreted calls. After `swap(a, b)`, `a` has the cells and the count
    that `b` had, the identity of both is the same, and both versions
    increased. With two arrays of two counts, `length(a)` read before and
    after `swap(a, b)` in one function gives the two counts, in both runs. A
    pure user function that reads a cell of `a` gives the new cell after a
    `swap`.
12b. **A variable and a host call.** `t => do { s = s + t; hostDraw(s) }`
    compiles, and the host function reads the new `s` in the engine when it
    runs. A host function that assigns `s` changes the value that the code
    reads after the call. The Game of Life of case 12a with
    `(cur, next) = (next, cur)` in the body of the callback, in place of the
    `swap` in `step()`, compiles and gives the same cells. A host call in a
    `Loop` that assigns `s` at each pass shows each value to the host. After
    a throw that follows a host call, the engine holds the values written at
    that call. An interpreted assignment of `cur` between two calls of a
    compiled function that reads `cur` is seen by the next call. Each
    decline of section 10.7 declines with its message.
13. **Compiled speed** (measured, the M5 Max). A compiled loop of 64,000
    stores to an array parameter takes less than 2 ms, and Tycho's instrument
    (`~/dev/tycho/scripts/repros/2026-11-24-epsil-raster-host-call-cost.mts`)
    gets the array route.
14. **Declines.** Each case of section 10.6 declines with a message that
    names the case, and runs on the interpreter with `fallback: true`.
15. **GLSL.** `At(A, i)` with `A` declared `array<integer<0..255>>` and `i`
    an integer input compiles to a texel read of a `usampler2D` with the
    index test against `A_count`; `freeSymbolTypes.A` has the sampler type
    and the count name. A name with an array value that is not in `inputs`,
    a store, an `array<integer<0..4294967295>>`, an `ArrayFrom`, and `At(A,
    0)` decline. In a WebGL2 context, the shader gives the cells of an
    uploaded array, for one unsigned, one signed and one `real` storage, for
    a tuple cell of four bytes (one fetch, a `vec4`) from an `RGBA8UI` and
    from a normalized `RGBA8` texture, and for a count that is not a multiple
    of the width (checked one time in a browser, then pinned as emitted
    text). A read of a framebuffer of each of the two formats gives the bytes
    of the cells, or the check reports which format does not; for the
    normalized one, a pixel `(1, 2, 128, 255)` written through a division by
    255 is read back as those four bytes.
