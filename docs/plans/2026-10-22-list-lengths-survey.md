# Lists, fixed-length sequences, tuples and arrays: a survey of other languages

Date: 2026-10-22. Research for the Compute Engine decision on where lengths and
shapes go in collection types. All facts below were checked against a web
source in this session. The source for each language is in the "Sources"
section. A statement that the sources did not confirm says "not verified".

## 1. The question

The Compute Engine has these collection types today:

- `list<E>`: elements of type `E`, any length.
- `list<U^N>`, `list<U^(2x3)>`: a list with a shape, read by its cells.
  `vector<U^N>` and `matrix<U^(MxN)>` require numeric cells. `tensor<U>` is an
  array of any rank. An axis of `-1` or `?` has an unknown length. A signature
  can name a length (`(list<T^N>) -> N where T, N`), and a nominal type can
  take a length (`type permutation<N> = list<integer^N>`). Arithmetic between
  lengths (`^(M+N)`) is not supported.
- `tuple<A, B, ...>`: fixed arity, one type per slot. A tuple is atomic for
  broadcasting (a point).
- `broadcastable<T>` = `T | tensor<T>`.

The three options under study:

1. Keep lengths and shapes on lists (the design today).
2. Put lengths and shapes only on array types (`vector`, `matrix`, `tensor`).
   A list never has a length in its type.
3. No fixed lengths at all, except the arity of a tuple.

## 2. Summary table

Columns: (a) variable-length homogeneous sequence; (b) fixed-length
homogeneous sequence; (c) fixed-arity heterogeneous tuple; (d) multi-dimensional
arrays: rank in the type, sizes in the type, unknown sizes; (e) length
variables in generic signatures and arithmetic on them; (f) relation between
fixed-size array and list, and between tuple and array.

| Language | (a) variable length | (b) fixed length | (c) tuple | (d) multi-dimensional arrays | (e) length variables, arithmetic | (f) relations |
| --- | --- | --- | --- | --- | --- | --- |
| TypeScript | `T[]` | A tuple `[T, T, T]`: an array type with `length: 3` | `[A, B]`, optional `[A, B?]`, rest `[A, ...B[]]` | No array type with rank. Nested arrays only | Variadic tuple types (`[...T, ...U]`, TS 4.0, 2020). No numeric length variables; a length-N tuple is built with recursive conditional types | A tuple is a subtype of an array (`[number, number]` is a `number[]`). Tuples and fixed-length arrays are the same thing |
| Python typing | `list[T]` (invariant), `tuple[T, ...]` | No form for "N elements of T", except writing `tuple[T, T, T]` | `tuple[A, B]` | NumPy: `ndarray[tuple[int, int], dtype]` gives the rank only; `Literal` sizes "not supported". PEP 646 (Python 3.11, 2022) adds `TypeVarTuple` for shapes | PEP 646: variadic shape variables, no arithmetic. Pyre had experimental `Add`/`Multiply`; Pyrefly (2026) has tracked `Int` arithmetic with known gaps | `tuple[T, ...]` is the union of all fixed-length `tuple[T, ...]` forms (mypy). `list` and `tuple` are unrelated |
| jaxtyping / torchtyping | n/a | n/a | n/a | `Float[Array, "batch channels"]`: rank and named sizes, checked at run time; `...` for any number of axes | Named axes are unified across a call; simple expressions such as `"dim-1"` (not verified in the docs) | Runtime check only, no static type |
| Julia | `Vector{T}` = `Array{T,1}` | `NTuple{N,T}`; `SVector{N,T}` (StaticArrays package) | `Tuple{A,B}` (covariant) | `Array{T,N}`: rank in the type, sizes at run time. StaticArrays: sizes in the type | `N` is a type parameter, used in dispatch. No type-level arithmetic constraints | `SArray` is a subtype of `AbstractArray`; conversion to `Array` by copy. `Array` is invariant in `T`, `Tuple` is covariant |
| Rust | `Vec<T>`, slice `[T]` | `[T; N]` (length in the type) | `(A, B)` | `ndarray`: rank in the type (`Ix1`, `Ix2`, `IxDyn` for any rank), sizes at run time. `nalgebra`: each axis is `Const<N>` or `Dyn` | Const generics `const N: usize` (Rust 1.51, 2021). No arithmetic on stable; `generic_const_exprs` is incomplete | `[T; N]` coerces to `[T]`; `[T]` and `Vec<T>` convert to `[T; N]` only with `try_from` (run-time check). A homogeneous tuple of length 1 to 12 converts to an array |
| C++ | `std::vector<T>`, `std::span<T>` | `std::array<T, N>`; `std::span<T, N>`; `std::inplace_vector<T, N>` (C++26, a capacity, not a length) | `std::tuple<A, B>` | `std::mdspan` (C++23): rank always in the type; each extent is a constant or `dynamic_extent`; `dextents<I, R>` is all-dynamic; `std::dims<R>` (C++26) | Non-type template parameters with full compile-time arithmetic | `std::array` is tuple-like (`std::get`, `tuple_size`). No implicit conversion between `vector` and `array` |
| Swift | `Array<T>` | `InlineArray<N, T>`, sugar `[N of T]` (SE-0453 and SE-0452, shipped in Swift 6.2, 2025; sugar SE-0483 accepted 2025, release not verified) | `(A, B)` | No standard multi-dimensional array | Integer generic parameters (SE-0452). Arithmetic such as `n + m` is a "future direction" | `InlineArray` does not conform to `Sequence` or `Collection`. C arrays import as homogeneous tuples |
| Haskell | `[a]`; `Data.Vector` | `Data.Vector.Sized` (vector-sized package) with `KnownNat n` | `(a, b)` | Libraries only | `GHC.TypeLits` naturals; `+` is a type family, not injective; the `ghc-typelits-natnormalise` plugin solves equalities by normal form | `toSized`/`withSized` convert with a run-time check |
| Idris / Agda | `List a` | `Vect n a` (Idris), `Vec A n` (Agda): length is a value index | Pairs, dependent pairs | Nested `Vect` | Full arithmetic on `Nat`; `++ : Vect n a -> Vect m a -> Vect (n + m) a`; proofs needed when the normal forms differ | `toList`/`fromList`; `fromList (toList v)` has a type only provably (not definitionally) equal to the type of `v` |
| Lean 4 | `List α`, `Array α` | `Vector α n`: "an `Array α` with size `n`" (an array plus a proof of its size) | `α × β` | Nested vectors | Full arithmetic; `Vector.append : Vector α n → Vector α m → Vector α (n + m)`; `Vector.cast (h : n = m)` changes the index with a proof | `Array.toVector`; `Vector.toArray`. Mathlib also has `List.Vector` (list plus proof); its API is "incomplete" and its use is being reduced |
| Futhark | All arrays carry a size; `[]t` is an anonymous size that the checker names | `[n]t`, `[3]t` | Tuples and records | Rank and every size in the type: `[n][m]f64` | Size parameters `[n]`; size expressions such as `[n+m]t` since 0.25.1 (2023); equality of sizes is syntactic | Existential sizes `?[k].[k]a` for `filter`; size coercion `:>` with a run-time check |
| Dex | `List a`: a table with its length hidden | Table `n => a` where `n` is an index set such as `Fin 3` | Pairs, records | `Fin 3 => Fin 8 => Float`: rank and sizes in the type; a 2-D table is a table of tables | Index sets are types; sizes come from the index type | `to_list` hides the size; `AsList(n, xs)` unpacks it |
| Wolfram Language | `List` (no static types) | None (run time: `Length`) | None (a `List` of mixed values) | `Dimensions`, `ArrayDepth`, `ArrayQ` compute rank and sizes at run time; packed arrays only for rectangular numeric data | None | A matrix is a list of lists. A ragged list cannot be packed |
| MATLAB | Every value is an array | Run time only; `arguments` blocks can state `(1,3)` or `(1,:)` | Cell arrays, structs | Every array has at least 2 dimensions; trailing singleton dimensions are not counted | None | Size validation applies implicit conversions (row to column, scalar expansion) |
| APL / J | Every value is an array | Run time only | Nested (boxed) arrays | Rank and shape are run-time properties; functions have a rank too (J verb rank, "leading axis" model) | None | n/a |
| TensorFlow / PyTorch / JAX | Python lists | n/a | Python tuples | TF `TensorShape`: known, partially known (`[None, 256]`), or unknown rank (`TensorShape(None)`). PyTorch named tensors: removed in PyTorch 2.13 (2026). JAX export: symbolic shapes `"a, 2*b"` | JAX: `+ - * floordiv mod max min` on dimension variables; equality decided "under all valuations", partly unsound; inequality partly supported | Shapes merge axis by axis; `None` is compatible with any size |

## 3. Notes per language, with pain points and changes over time (g)

**TypeScript.** A tuple is an array type that also declares a numeric literal
`length` and a type per index. Optional elements make `length` a union
(`2 | 3`). A rest element makes `length` plain `number`. An array literal is
inferred as `T[]`, not as a tuple; `as const` gives a `readonly` tuple, which is
not assignable to a mutable tuple. Variadic tuple types came in TypeScript 4.0
(2020) to type `concat`, which before needed a series of overloads. There are
no length variables: a "tuple of length N" is built by a recursive conditional
type, which hits the instantiation depth limit (50 in TS 4.1; the limit is an
implementation detail).

**Python typing.** `tuple[int, ...]` is a homogeneous tuple of any length and
is read as the union `tuple[()] | tuple[int] | tuple[int, int] | ...`.
Subtyping for it was not fully specified until the typing spec chapter on
tuples. There is no spelling for "a sequence of exactly N items of type T":
users write the element type N times. The feature request (python/typing issue
786, mypy issue 7509) is open. PEP 646 (accepted for Python 3.11) added
`TypeVarTuple` to type array shapes, with no arithmetic. NumPy's `ndarray`
takes a shape type, but only `tuple[int, int]` style (rank only): "`Literal`
ints or other more specific types are not supported". Third-party tools fill
the gap (nptyping, numdantic, jaxtyping, Pyrefly tensor shapes). Pyrefly
tracks arithmetic on dimensions and documents gaps: `N * (X // N)` does not
simplify to `X`, and a symbolic exponent gives an unknown.

**jaxtyping, torchtyping.** Shapes are strings of axis names, numbers, `-1` (any
size) and `...` (any number of axes). Sizes are checked at run time and named
axes must agree across the arguments of one call. The torchtyping README now
says: "For new projects I now strongly recommend using my newer jaxtyping
project instead."

**Julia.** `Array{T,N}` carries the rank `N`, not the sizes. `Vector{T}` is
`Array{T,1}`. `NTuple{N,T}` is `Tuple{Vararg{T,N}}`. StaticArrays puts sizes in
the type to unroll loops for small arrays. Its documentation targets arrays of
about 100 elements or fewer; for much larger arrays compile time grows sharply
(forum reports of 10 to 47 seconds to compile `sum` over a 5000-element static
vector). The reason for the separate type is code generation, not type
checking.

**Rust.** `Vec<T>` and `[T; N]` are separate types. `[T; N]` coerces to a slice
`[T]`; the reverse needs `try_from` and a run-time check. Before const generics
(Rust 1.51, March 2021), trait implementations were generated for sizes 0 to 32
only, and `Default` is still limited to sizes 0 to 32. Arithmetic in const
arguments (`generic_const_exprs`) is still unstable. The 2025 project goal says
its design "is fundamentally flawed and introduces significant complexity to
the compiler"; a smaller replacement (`min_generic_const_args`) is a prototype
in the 2026 goals. `ndarray` puts the rank in the type and the sizes at run
time; `IxDyn` is for any rank, and indexing with the wrong number of indices
panics at run time. `nalgebra` lets each axis be a type-level constant or `Dyn`.

**C++.** `std::array<T, N>` (fixed) and `std::vector<T>` (growable) are
unrelated types. `std::span<T, N>` has a static or dynamic extent. `std::mdspan`
(C++23) always has the rank in the type; each extent is a constant or
`dynamic_extent`. `std::dims<R>` (C++26) is a short name for an all-dynamic
extent of rank `R`. `std::inplace_vector<T, N>` (C++26) fixes the capacity,
not the length. Template arguments allow any compile-time arithmetic.

**Swift.** Before Swift 6.2, the only fixed-size sequence was a homogeneous
tuple, which has no dynamic indexing and no iteration; C arrays still import as
tuples (changing this would break source code). `InlineArray<N, T>` (SE-0453,
shipped in Swift 6.2, first named `Vector`) has the count in the type. It does
not conform to `Sequence` or `Collection`, because it is copied eagerly and
generic algorithms would make many implicit copies. Arithmetic on integer
generic parameters (`Vector<n + m, T>` for `concat`) is listed as a future
direction of SE-0452. The reason for the separate type is storage (no heap
allocation).

**Haskell.** Lists, `Data.Vector` and tuples are unrelated. `vector-sized` adds
a length index from `GHC.TypeLits`. Type-level `+` is a type family, so `n + 1`
cannot be a pattern, and a match on `natVal` does not refine the type. Proofs
need singleton libraries or the `ghc-typelits-natnormalise` plugin, which puts
both sides in sum-of-products form and compares them. Peano naturals make
proofs easy but are slow for large numbers.

**Idris, Agda.** `Vect n a` and `Vec A n` index a list by its length. `append`
has the type `Vect (n + m) a` with no proof because `+` recurses on its first
argument. Functions whose length expression has a different normal form
(`reverse` with an accumulator, `snoc` as `n + 1` instead of `S n`) need a
rewrite with `plusCommutative` or similar. The Idris docs recommend the type
`Vect (S n) a` over `Vect (n + 1) a` for this reason. In Agda, `fromList (toList
v)` has the type `Vec A (length (toList v))`, which is only provably equal to
`Vec A n`; a mailing-list thread shows the workaround with a dependent pair.

**Lean 4.** `List α` (linked), `Array α` (contiguous) and `Vector α n` (an array
plus a proof that its size is `n`) are all in the core library. The length is
a refinement of an ordinary array: the run-time value is the same.
`Vector.append` has the type `Vector α (n + m)`; when an index has a different
form, `Vector.cast (h : n = m)` needs a proof. Mathlib's older list-based
`List.Vector` has an "incomplete" API and its use "is being reduced"; Mathlib
recommends `Vector α n` for programs and verification. The date when `Vector`
moved into the core library was not verified.

**Futhark.** Every array has a size in its type. Size types arrived in 2020
with sizes limited to constants and variables, so `concat` could not have the
type `[n+m]t` and returned an existential size. Version 0.25.1 (July 2023)
added size expressions. Size equality is syntactic: `n+m` and `m+n` are
different. The authors report: two `concat` results get distinct unknown
sizes, so `zip (concat A B) (concat A C)` is ill-typed; "ambiguous size"
errors; loss of expressive power for functions that return functions over
unknown sizes; and a worry that the rules feel "unpredictable and magical".
They plan to move to a solver for size arithmetic. The escape is `:>`, a size
coercion checked at run time.

**Dex.** An array is a table `n => a` indexed by a finite type, for example
`Fin 3 => Fin 8 => Float32`. The type checker rejects an argument whose axes
are swapped. A list of unknown length is a separate type, `List a`, that hides
one dimension; to use the length, the program unpacks it with
`AsList(n, xs)`. Dex is described as an experimental research project.

**Wolfram Language.** There are no static types. A matrix is a list of lists.
`Dimensions` and `ArrayDepth` compute the rectangular shape at run time; a
ragged list has a smaller array depth. Packed arrays (an internal
representation for rectangular numeric data) unpack silently when an
operation produces non-numeric or ragged data, which is a known performance
trap.

**MATLAB.** Every value is an array with at least two dimensions; trailing
dimensions of size 1 are not counted, so code that expects a third axis fails
on a 2-D input. Function argument blocks can state sizes such as `(1,:)`, but
they apply implicit conversions: `(1,:)` also accepts an `n`-by-1 column, and a
scalar passes a `(5,3)` check by scalar expansion. The documentation recommends
validation functions when these conversions are not wanted.

**APL, J.** Shape and rank are properties of each value at run time. Functions
also have a rank, which decides which cells (sub-arrays) they apply to
("leading axis" model). This is the origin of broadcasting by rank.

**TensorFlow, PyTorch, JAX.** TensorFlow's `TensorShape` has three states:
fully known, partially known (`[None, 256]`) and unknown rank. PyTorch named
tensors stayed a prototype and were removed in PyTorch 2.13 (2026): "The named
tensor feature (a long-deprecated prototype) has been fully removed". JAX
export uses symbolic dimensions with arithmetic; equality is decided by
checking all valuations, is documented as unsound in some cases (`b == 1` is
`False`), and inequalities that cannot be decided raise
`InconclusiveDimensionOperation`. JAX can solve only linear constraints in one
variable.

## 4. Synthesis

### 4.1 Designs that keep "list" separate from "array of fixed size"

Rust (`Vec` / `[T; N]`), C++ (`vector` / `array`), Swift (`Array` /
`InlineArray`), Julia (`Array` / `SArray`), Haskell (`Vector` / sized
`Vector`), Idris and Agda (`List` / `Vect`), Lean (`List`, `Array` / `Vector`),
Dex (`List` / tables).

Two different reasons drive the separation:

- Storage and code generation (Rust, C++, Swift, Julia StaticArrays). The fixed
  type has a different memory layout (inline, no heap) or is unrolled by the
  compiler. The separation is a performance decision.
- Type checking (Dex, Idris, Agda, Lean). The list type hides the length, and
  the sized type exposes it. In Lean the sized type is the unsized type plus a
  proof: the value is the same, so `Vector α n` behaves like a subtype of
  `Array α`. In Dex, `List a` is a table with its size hidden (an existential),
  so the sized table is again the more precise form of the same data.

The Compute Engine has no storage reason: a list and a vector are the same
boxed expression. Only the type-checking reason applies, and the
type-checking languages make the sized form a refinement of the unsized form,
with a conversion in one direction that is free and in the other direction
that needs a check.

### 4.2 Designs with the rank in the type but not the sizes

Julia `Array{T,N}`, Rust `ndarray` (`Ix1`, `Ix2`, ..., `IxDyn`), NumPy typing
(`tuple[int, int]` shapes), C++ `dextents<I, R>`. These catch rank errors
(a vector where a matrix is expected) and need no size arithmetic. A
dynamic-rank form (`IxDyn`, `TensorShape(None)`, the Compute Engine's
`tensor<U>`) is always present as the fallback.

### 4.3 Designs with sizes in the type, and how they handle unknown sizes

- A marker per axis: C++ `dynamic_extent`, nalgebra `Dyn`, TensorFlow `None`,
  torchtyping `-1`, MATLAB `:`, the Compute Engine `-1`/`?`. In TensorFlow, an
  unknown axis is compatible with any size (it merges with a known size).
- An existential: Futhark `?[k]` and Dex `List`. An unknown size is "some
  fixed size, not known". Two unknown sizes are different from each other, so
  two results of `filter` cannot be zipped without a check.
- A run-time checked coercion to recover a known size: Futhark `:>`, Rust
  `try_from`, Lean `Array.toVector`/`Vector.cast`, Haskell `toSized`.

The two readings of "unknown" give different rules. Under the marker reading,
`list<T^-1>` is "any length" and is a supertype of `list<T^3>`. Under the
existential reading, it is "one length that is not known", and two such types
are not equal to each other. The Compute Engine uses the marker reading today
(each axis of `dims2` "is `-1` or equal to the axis of `dims`"). The
existential reading is the one a dependent type system needs when it checks
that two operands of `zip` have the same length.

### 4.4 Dependent types: `Vect n a` and the cost of arithmetic on `n`

- A length that is a value index is simple when only constants and variables
  appear. All the cost is in arithmetic.
- With `+` defined by recursion (Idris, Agda, Lean), `Vect n a ++ Vect m a :
  Vect (n + m) a` checks without proof, but `n + m` and `m + n`, or `n + 1` and
  `S n`, are different normal forms. The program must give a rewrite with a
  proof (`plusCommutative`, `Vector.cast`). The libraries choose type
  signatures to avoid this (Idris: prefer `S n` over `n + 1`).
- Without proofs, a system needs a decision procedure: a normal form (sum of
  products in `ghc-typelits-natnormalise`; "equal under all valuations" in
  JAX), or syntactic equality (Futhark today). Each one leaves cases
  undecided. JAX raises an error for an undecided inequality; Futhark reports
  "ambiguous size" or makes a fresh unknown size; Pyrefly needs `type: ignore`.
- Several languages shipped length parameters without arithmetic and then
  struggled to add arithmetic: Rust (`generic_const_exprs` unstable since 2021,
  design called "fundamentally flawed" in 2025), Swift (arithmetic is a future
  direction), Futhark (constants and variables in 2020, expressions in 2023,
  solver planned), TypeScript (no numeric length at all; recursive tuple types
  with depth limits).

### 4.5 Lessons for the three options

**Option 1: keep lengths and shapes on lists** (one list type; the length is
optional; `list<T^3>` is a subtype of `list<T>`).

- Languages that do this: TypeScript (a tuple is an array with a literal
  `length`, and a subtype of `T[]`), Python for tuples (`tuple[int, int]` and
  `tuple[int, ...]` are one constructor with an optional length), Lean
  (`Vector α n` is an `Array α` plus a size proof), Futhark (every array has a
  size, possibly anonymous or existential), Dex (the sized table is the
  primary form), and every tensor-shape system (TensorFlow, jaxtyping, C++
  `mdspan`, nalgebra), where each axis is a number or "unknown".
- Problems they report: every operation that changes a length needs a length
  rule (`concat` → `n+m`, `filter` → unknown, `flatten` → `n*m`); equality of
  length expressions is undecidable in general, so a system needs a fixed
  policy for undecided cases (Futhark, JAX, Pyrefly); unknown sizes need a
  clear reading (marker or existential); type-level construction of a fixed
  length without a numeric parameter is fragile (TypeScript depth limits).
- What fits the Compute Engine: the engine is structural and has subtyping;
  the sized list and the unsized list are the same value, as in Lean and
  TypeScript. The cost is in arithmetic, which the engine does not support
  today. The lesson from Futhark and JAX is to state the policy for an
  undecided length before arithmetic is added. One sound policy is to widen to
  "length unknown" (the `-1` marker) when the checker cannot prove two lengths
  equal, and never reject a program for that reason alone.

**Option 2: lengths and shapes only on array types (`vector`, `matrix`,
`tensor`); lists never.**

- Languages that do this: Rust, C++, Swift, Julia (StaticArrays), Haskell
  (vector-sized), Idris and Agda (`List` / `Vect`), Lean (`List`, `Array` /
  `Vector`), Dex (`List` / tables), and in a run-time form jaxtyping and
  TensorFlow (shapes on tensors only, never on Python lists).
- Problems they report: a second type means a second API, and the second API
  is often incomplete (Swift `InlineArray` is not a `Collection`; Mathlib
  `List.Vector` has an incomplete API; Rust implemented array traits only up
  to size 32 for years). Conversions between the two types need a run-time
  check in one direction (`try_from`, `toSized`, `:>`, `AsList`). Fixed-size
  data that is not an array falls back to tuples (Swift imports C arrays as
  tuples).
- What fits the Compute Engine, and what does not: most of these languages
  separate the types for storage reasons, which the engine does not have. The
  engine also requires numeric cells for `vector` and `matrix`. So a fixed
  number of booleans, strings or points has no array type unless `tensor`
  keeps any cell type. Today `[True, False]` is typed `list<boolean^2>` and a
  list of points carries its length. The engine's own measurement of a
  stricter rule (2026-10-21, `docs/TYPE-SYSTEM.md`, decision D3 of
  `docs/plans/2026-10-21-list-element-tensor-cell.md`) found that a bound list
  of points then loses its length, the GPU target refuses a minimum-distance
  field over a list of points (four tests), and about 70 expected types lose a
  length. Option 2 has the same cost unless `tensor<U>` (or a new array type)
  takes any cell type, and then it is option 1 under a different name.
  Option 2 also needs a rule for which type a literal gets: `[1, 2, 3]` must
  be either a `list<integer>` (its length is lost) or a `vector<integer^3>`.

**Option 3: no fixed lengths at all, except tuples.**

- Languages that do this: Python (lists and `tuple[T, ...]`; NumPy typing has
  the rank only), Haskell base (lists and tuples), Julia Base (`Array{T,N}`
  has the rank only), and the languages without static types (Wolfram
  Language, MATLAB, APL, J). PyTorch removed its named-tensor prototype.
- Problems they report: shape errors appear only at run time; users ask for
  fixed-length homogeneous types (python/typing issue 786, mypy issue 7509)
  and build third-party tools to get them (nptyping, numdantic, jaxtyping,
  torchtyping, Pyrefly tensor shapes); where tuples are the only fixed-length
  form, programs use tuples as fixed-length arrays (TypeScript, Swift before
  `InlineArray`) and then need variadic tuple machinery or a new array type.
- What fits the Compute Engine, and what does not: in the engine a tuple is a
  point and is atomic for broadcasting, so a tuple cannot replace a
  fixed-length list without a change to arithmetic over it. Length variables
  (`(list<T^N>) -> N`, `permutation<N>`) and the lengths that compile targets
  use (GPU) would be lost. The future goal of dependent types needs lengths in
  types, so option 3 removes something that would be added again later.

### 4.6 Observations for the decision

- The languages whose purpose is checking (TypeScript, Lean, Futhark, Dex,
  TensorFlow, jaxtyping) make the sized type a more precise form of the same
  value, with the unsized type as its supertype. The languages that separate
  the types (Rust, C++, Swift, Julia StaticArrays) do it for storage. This
  argues against option 2 as a way to simplify the rules: it adds a
  conversion and a second API without a storage reason.
- No surveyed language that put sizes in types has a simple, complete answer
  for arithmetic on sizes. The languages that added arithmetic late (Rust,
  Swift, Futhark) report that it was the hard part. The rule set stays simple
  while lengths are constants, variables and "unknown", which is the engine's
  scope today.
- The reading of an unknown axis must be stated once: "any length" (a
  supertype, the engine's `-1` today, TensorFlow `None`) or "one length that
  is not known" (Futhark `?[k]`, Dex `List`). A dependent-type extension needs
  the second reading for checks such as "these two lists have the same
  length", and can keep the first reading for annotations.
- Julia, NumPy typing, ndarray and `mdspan` show that "rank in the type,
  sizes optional" is a common middle form that needs no arithmetic and still
  catches rank errors.

## 5. Sources

- TypeScript: https://www.typescriptlang.org/docs/handbook/2/objects.html (tuple
  types), https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html
  (variadic tuples), https://dev.to/susisu/how-to-create-deep-recursive-types-5fgg
  (depth limit)
- Python typing: https://typing.python.org/en/latest/spec/tuples.html,
  https://discuss.python.org/t/what-are-the-subtyping-rules-for-tuple-t/39837,
  https://discuss.python.org/t/how-to-type-homogenous-tuples-of-a-given-length/29431,
  https://github.com/python/typing/issues/786, https://peps.python.org/pep-0646/
- NumPy typing: https://numpy.org/doc/2.5/reference/typing.html
- Pyrefly tensor shapes: https://pyrefly.org/en/docs/tensor-shapes-reference/
- jaxtyping: https://pypi.org/project/jaxtyping/0.2.36 ; torchtyping:
  https://github.com/patrick-kidger/torchtyping
- Julia: https://docs.julialang.org/en/v1/manual/types/,
  https://docs.julialang.org/en/v1/base/arrays/,
  https://juliaarrays.github.io/StaticArrays.jl/stable/,
  https://discourse.julialang.org/t/compilation-times-for-long-static-vectors-are-increasing/
- Rust: https://doc.rust-lang.org/std/primitive.array.html,
  https://blog.rust-lang.org/2021/03/25/Rust-1.51.0/,
  https://rust-lang.github.io/goals/2025h1/min_generic_const_arguments.html,
  https://rust-lang.github.io/goals/2026/const-generics.html,
  https://doc.rust-lang.org/unstable-book/language-features/generic-const-exprs.html,
  https://docs.rs/ndarray/0.10.2 ,
  https://doc.qu1x.dev/nalgebra-spacetime/nalgebra/base/dimension/struct.Dyn.html
- C++: https://en.cppreference.com/w/cpp/container/mdspan/extents.html,
  https://www.cppreference.com/w/cpp/container/inplace_vector.html
- Swift: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0453-vector.md,
  https://github.com/swiftlang/swift-evolution/blob/main/proposals/0452-integer-generic-parameters.md,
  https://forums.swift.org/t/accepted-se-0483-inlinearray-type-sugar/81509
- Haskell: https://hackage.haskell.org/package/vector-sized (docs at
  https://hackage-content-origin.haskell.org/package/vector-sized-1.6.1/docs/src/Data.Vector.Sized.html),
  https://hackage.haskell.org/package/ghc-typelits-natnormalise,
  https://hackage-content.haskell.org/package/singleton-typelits,
  https://mail.haskell.org/pipermail/libraries/2018-April/028703.html
- Idris: https://idris2.readthedocs.io/en/latest/tutorial/introduction.html,
  https://idris2docs.sinyax.net/data/base/docs/Data.Vect.html,
  https://idris2.readthedocs.io/en/latest/proofs/patterns.html
- Agda: https://www.cse.chalmers.se/~nad/listings/lib/Data.Vec.html,
  https://lists.chalmers.se/pipermail/agda/2014/006889.html
- Lean 4: https://lean-lang.org/doc/api/Init/Data/Vector/Basic.html,
  https://florisvandoorn.com/LeanCourse25/docs/Mathlib/Data/Vector/Defs.html
- Futhark: https://futhark.readthedocs.io/en/latest/language-reference.html,
  https://futhark.readthedocs.io/en/latest/glossary.html,
  https://futhark-lang.org/blog/2023-05-12-size-type-challenges.html,
  https://futhark-lang.org/blog/2023-07-06-futhark-0.25.1-released.html,
  https://futhark-lang.org/publications/fhpnc23.pdf
- Dex: https://raw.githubusercontent.com/google-research/dex-lang/main/examples/tutorial.dx,
  https://arxiv.org/abs/2104.05372, https://github.com/google-research/dex-lang
- Wolfram Language: https://reference.wolfram.com/language/ref/ArrayDepth.html,
  https://reference.wolfram.com/language/ref/ArrayQ.html,
  https://reference.wolfram.com/language/Developer/ref/PackedArrayQ.html
- MATLAB: https://www.mathworks.com/help/matlab/ref/ndims.html,
  https://mathworks.com/help/matlab/matlab_prog/function-argument-validation-1.html
- APL / J: https://www.aplwiki.com/wiki/Leading_axis,
  https://aplwiki.com/wiki/Leading_axis_agreement
- TensorFlow: https://www.tensorflow.org/versions/r2.11/api_docs/python/tf/TensorShape
- PyTorch: https://newreleases.io/project/pypi/torch/release/2.13.0 (named
  tensors removed), https://discuss.pytorch.org/t/status-of-named-tensors/172278
- JAX: https://docs.jax.dev/en/latest/export/shape_poly.html
