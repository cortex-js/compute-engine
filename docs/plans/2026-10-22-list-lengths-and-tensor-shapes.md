# Lengths on lists, shapes on tensors

Status: DECIDED 2026-10-22: the user adopted option U, with the old
spelling `list<U^(AxB…)>` refused (section 5). Implementation in progress.
The sections below record the measurements that led to the decision. Nothing in this document is implemented. The
measurement patches are in the session scratchpad and are not applied to any
tree.

## 1. The problem

Since commit `4e66aed34` (2026-10-22), `list<E>` is read by its
**elements** and `tensor<U>`, `matrix<U>`, `vector<U>` are read by their
**cells**. One spelling breaks this rule: a list with two or more axes.

| Spelling today            | What `integer` is | Element type                |
| ------------------------- | ----------------- | --------------------------- |
| `list<integer>`           | the element       | `integer`                   |
| `list<integer^3>`         | the element       | `integer`                   |
| `list<integer^(2x3)>`     | the **cell**      | `vector<integer^3>`         |
| `list<boolean^(2x2)>`     | the **cell**      | `list<boolean^2>`           |

So a developer must learn two readings of `list<…>`: by elements when there
is zero or one axis, by cells when there are two or more. The goals for the
type system are:

1. rules that are simple to explain;
2. an implementation with no defects, which tests can check;
3. an expressive type system;
4. room to add dependent types later (lengths that are values, such as
   `(xs: list<T^N>) -> list<T^(N+1)>`).

## 2. What other languages do

A survey of 16 languages (Rust, C++, Swift, Julia, Haskell, Idris, Agda,
Lean, Dex, Futhark, TypeScript, Python typing and NumPy, TensorFlow, JAX
and jaxtyping, MATLAB, Wolfram Language) gives four results.

- **A separate fixed-size array type exists for storage reasons.** Rust
  `[T; N]`, C++ `std::array`, Swift `InlineArray` and Julia `SArray` have a
  different memory layout from the growable list. Languages built for type
  checking (Lean `Vector α n`, Dex, Futhark, TypeScript tuples) keep one
  sequence type and make the sized form a more precise subtype of the
  unsized form. In the engine a list and a vector are the same boxed value,
  so the storage reason does not apply. (The GPU target needs a known length
  to declare a shader array, but that is a known length, not a different
  type.)
- **"Rank in the type, sizes optional" is common** (Julia `Array{T,N}`,
  Rust `ndarray`, NumPy typing, C++ `mdspan`). It catches a vector given
  where a matrix is expected, with no arithmetic on sizes.
- **Arithmetic on lengths is the hard part everywhere.** Rust's
  `generic_const_exprs` has been unstable since 2021. Futhark compares
  sizes syntactically. JAX reports an error for an inequality it cannot
  decide. Idris, Agda and Lean need a proof for `n + m = m + n`. The
  languages that added length arithmetic late (Rust, Swift, Futhark) say it
  was the difficult step.
- **"Unknown length" has two meanings.** (a) "Any length": `list<T^?>` is a
  supertype of `list<T^3>` (the engine today, TensorFlow `None`). (b) "One
  fixed length that is not known": two such lists may have different
  lengths, so they cannot be zipped without a check (Futhark `?[k]`, Dex
  `List`). Dependent types need meaning (b) to check "these two lists have
  the same length". A named length variable expresses (b): in
  `(xs: list<T^N>, ys: list<T^N>) -> …` both lists have the same `N`.

The full survey with sources:
`docs/plans/2026-10-22-list-lengths-survey.md`. The survey numbers the options differently: its option 1 is A and B below, its option 2 is D, its option 3 is E.

## 3. Is a length on a list useful?

Yes. A length is used, and removing it was measured once already.

- Tycho writes 57 shaped list types, all with one axis
  (`list<number^N>`, `list<number^2>`, `list<color^2>`, template strings
  such as `` `list<number^${n}>` ``).
- The GPU target reads list lengths to declare fixed-size arrays
  (`list<number^1600>` in `at-gpu-sampler-storage.test.ts`).
- Length variables in signatures, `(x: list<T^N>) -> T where T, N`, are the
  start of dependent types.
- `[True, False]` is a `list<boolean^2>`, and a list of points carries its
  length. A measurement on 2026-10-21 (decision D3 of
  `docs/plans/2026-10-21-list-element-tensor-cell.md`) removed the length
  from lists of non-numbers: about 70 expected types lost a length, and the
  GPU target refused a minimum-distance field over a list of points (four
  tests).

A shape with two or more axes on a list of non-numbers is also used: it is
the type of a broadcast over a matrix. `M < 2` over a 2×2 matrix is a
2×2 array of booleans, and a point times a matrix is a 2×2 array of points.

## 4. The options

### Option A: keep today's spelling

`list<U^(2x3)>` stays valid for any cell type `U` that is not a list.

- Example: `M < 2` over a 2×2 matrix is printed `list<boolean^(2x2)>`.
- Cost: none.
- The two readings of `list<…>` in section 1 stay.

### Option B: a length on `list`, a shape on `tensor` (replaced by option U)

`list<E^n>` means "exactly `n` elements, each of type `E`". A shape with two
or more axes is written only on `matrix` (numeric cells) or on
`tensor<U^(…)>`, which takes any cell type that is not a list.

| Value                           | Today                              | Option B                             |
| ------------------------------- | ---------------------------------- | ------------------------------------ |
| `[True, False]`                 | `list<boolean^2>`                  | `list<boolean^2>` (same)             |
| `[1, 2, 3]`                     | `vector<integer^3>`                | `vector<integer^3>` (same)           |
| `[[1, 2, 3], [4, 5, 6]]`        | `matrix<integer^(2x3)>`            | `matrix<integer^(2x3)>` (same)       |
| a 2×3×4 array of integers       | `list<integer^(2x3x4)>`            | `tensor<integer^(2x3x4)>`            |
| `M < 2`, `M` a 2×2 matrix       | `list<boolean^(2x2)>`              | `tensor<boolean^(2x2)>`              |
| `(1, 2) * M`                    | `list<tuple<integer, integer>^(2x2)>` | `tensor<tuple<integer, integer>^(2x2)>` |

The rule to explain becomes: **a list has elements and may have a length; a
tensor has cells and may have a shape.** For one axis the two readings agree
(the cells of a vector are its elements), so `list<number^3>`,
`vector<number^3>` and `tensor<number^3>` are one type, printed `vector`.

Measured cost (full suite in a worktree at `4e66aed34`, the 59 tests that
fail at HEAD excluded, the old spelling still accepted as input):

- 56 tests in 19 files change, all of them a printed type
  (`list<…^(2x2)>` becomes `tensor<…^(2x2)>`), 6 of them inline snapshots
  in `linear-algebra.test.ts`. No value or behavior changes.
- If the old spelling is refused as input: about 95 more test expectations
  in 15 test files, 16 lines in the Markdown documentation, and the
  `Reshape` type handler (`library/linear-algebra.ts`, two
  `` parseType(`list<number^${dims}>`) `` calls). Tycho: 0 of its 57
  strings.
- The internal form does not change: a `ListType` with `dimensions`. The
  change is in the parser, the serializer and the type builder (four files,
  about 35 changed lines).

### Option D: no `^` on `list` at all

Lengths and shapes are written only on `vector`, `matrix` and `tensor`.

- Example: `[True, False]` is printed `tensor<boolean^2>`.
- Measured cost: 215 tests in 77 files change their printed type; if the
  old spelling is refused, 342 test failures in 51 files (13 files fail to
  load), all 57 Tycho strings, and about 140 documentation lines.
- A `tensor<boolean^2>` is a list of two booleans under a second name. The
  survey's finding applies: without a storage reason, a second name for the
  same values adds conversions and does not simplify the rules.

### Option E: no lengths on lists

Not measured as a spelling change: it removes information. Section 3 lists
what it loses, and dependent types would need to add lengths again.

### Option B2: numeric `tensor`, nested lists for everything else (measured, not recommended)

B2 was proposed in review: `vector`, `matrix` and `tensor` take only cells
that can hold a number; an array of non-numbers with two or more axes is
written as nested lists (`M < 2` is `list<list<boolean^2>^2>`); and the type
builder converts a nested spelling to the one internal form
(`list<list<integer^3>^2>` becomes `matrix<integer^(2x3)>`, and
`list<vector<integer^2>>` becomes `matrix<integer^(?x2)>`).

Measured on `cc468eb4f` (full suite, then the failing files again at HEAD):
102 tests change in 26 files with the old spellings accepted, 199 when they
are refused. The size of the change is close to B. The problems are not in
the counts:

- **Three kinds of type have no spelling.**
  - An array of non-numbers of unknown rank (`T < 3` with
    `T: tensor<integer>`, today `tensor<boolean>`). The stand-in
    `list<broadcastable<boolean>>` is a different, wider type.
  - An array of non-numbers whose rows share one length that is not known
    (`list<string^(2x?)>` today). Its nested form `list<list<string>^2>` is
    the uneven list, a wider type, which the parser refuses.
  - A list of fixed-length rows with no length, built by the engine
    (`Map(x ↦ [x, x], L)`), prints `list<vector<integer^2>>`, which the
    builder now reads as the narrower `matrix<integer^(?x2)>`.
- **Two types share one key.** `typeToString()` is also the intern key and
  the dedup key, so a printed form that two types share merges them:
  `tensor<boolean>` and `list<broadcastable<boolean>>`, and the plain
  `list<list<boolean^2>>` and its normalized form. A union of the two keeps
  whichever comes first and can lose the wider one.
- **The conversion is not an equality for an open outer length.** The empty
  list is a `list<vector<integer^2>>` and is not a `matrix<integer^(?x2)>`
  (its shape has one axis), so the conversion changed a meet from
  `list<never>` to `never`, made a compiled `Product` over
  `P: list<matrix<real^2x2>>` fail ("the shape of the result is not known",
  4 tests), and reversed 5 tests that state "a list of rows is not a
  matrix". With a fixed outer length n ≥ 1 the conversion is an equality.
- **The engine has no central constructor for list types.** About 30 places
  build them directly, so a conversion in the type builder leaves the
  nested form in types the engine builds. The rule "one internal form" would
  need every one of those places to go through one constructor first.

So B2 meets goal 1 (one reading of `list`) but not goal 2: it adds forms
that print the same and forms that cannot be printed. The patch is
`option-B2.patch` in the session scratchpad.

### Option U: one cell rule for every array name (measured, recommended)

Proposed in review: `vector<U>`, `matrix<U>`, `tensor<U>` and `list<U^n>`
all accept every cell type `U` that cannot hold a list. Today a `vector` or
`matrix` cell must be able to hold a number, which makes `matrix<any>` and
`matrix<integer | missing>` valid but `matrix<boolean>` a parse error,
although `any` includes the booleans. Under U:

| Value                       | Today                                 | Option U                                |
| --------------------------- | ------------------------------------- | --------------------------------------- |
| `[True, False]`             | `list<boolean^2>`                     | `list<boolean^2>` (same)                |
| `[[1, 2], [3, 4]]`          | `matrix<integer^(2x2)>`               | `matrix<integer^(2x2)>` (same)          |
| `M < 2`                     | `list<boolean^(2x2)>`                 | `matrix<boolean^(2x2)>`                 |
| `(1, 2) * M`                | `list<tuple<integer, integer>^(2x2)>` | `matrix<tuple<integer, integer>^(2x2)>` |
| `[["a", "b"], ["c", "d"]]`  | `list<string^(2x2)>`                  | `matrix<string^(2x2)>`                  |
| a 2×3×4 array of integers   | `list<integer^(2x3x4)>`               | `tensor<integer^(2x3x4)>`               |
| `matrix<boolean>` as input  | parse error                           | valid                                   |
| `Determinant` of a matrix of booleans | refused                     | refused (same)                          |

The internal types do not change: `list<boolean^(2x2)>` is already a list
type with dimensions `[2, 2]` and boolean cells. Linear algebra stays
numeric because the bare names keep number cells (`matrix` is
`matrix<number>`), and every linear-algebra signature uses the bare names (35
`matrix`, 11 `vector`). A grep of `src/` found no gate that spells a `matrix`
or `vector` with an explicit cell, so no gate changes its answer. Rank 1
prints as today: `vector<…>` for cells that can hold a number, `list<E^n>`
otherwise (`vector<string^2>` is accepted as input and prints
`list<string^2>`).

Measured on `cc468eb4f` (full suite, then the failing files at HEAD; the old
spellings still accepted): 66 tests beyond the baseline.

- 56 printed types (`list<U^(…)>` becomes `matrix<…>` at rank 2 or
  `tensor<…>` at rank 3 or more), 6 of them inline snapshots of the
  `Determinant`, `Inverse` and `PseudoInverse` error messages. By cell: 30
  points (8 with `missing`), 16 integers or numbers at rank 3 or more, 3
  `nan | real`, 3 `never`, 2 `any`, 1 boolean, 1 string.
- 9 tests that pin the old refusal (`vector<string>`, `matrix<string^(2x2)>`
  and similar are parse errors), which is the change itself.
- 1 cost pin slowed by the round-trip probe; it passes without the probe.
- No two types share a printed form, and every printed form parses back to
  its type (the round-trip probe over every type the suite printed), except
  the empty tuple, a defect that is at HEAD (section 6).
- The patch is 4 files, 32 lines added and 17 removed (`option-U.patch`).

A narrower rule, cells within `number | boolean` (with `missing`), would
change only 20 of the 56 printed types. The other 33 (the 30 arrays of
points, the array of strings, the 2 `any`) would keep `list<U^(…)>`, so the
two readings of `list` would stay for them.

## 5. Recommendation

Option U, with two details:

1. **Refuse the old spelling `list<U^(AxB…)>`, with an error that names the
   new one** (`matrix<U^(AxB)>` for two axes, `tensor<U^(AxB…)>` for more).
   The B2 measurement counted about 100 tests that write this spelling.
   Commit `4e66aed34` already changes these types and is not published, so
   both breaking changes ship in one release. One spelling per type is what
   makes a round-trip test complete (point 2 of section 6).
2. **Keep the refusal of a list with a length whose elements are lists**
   (`list<list<integer^3>^2>`). Its message points to
   `matrix<integer^(2x3)>`. Accepting it would give one set of values two
   internal forms, and every comparison of types would need to normalize
   them first. The B2 measurement confirms this: with a fixed outer length
   the conversion is an equality, but the engine builds list types in about
   30 places, so the nested form would still appear. Accepting the nested
   spelling can come later, after list types have one constructor.

The rules to explain under U are two sentences: **a list has elements and
may have a length; `vector`, `matrix` and `tensor` have cells, of any type
that is not a list, and may have a shape. The bare names `vector`, `matrix`
and `tensor` mean number cells.**

U keeps `tensor<U>` for every cell type that cannot hold a list
(`tensor<boolean>`, `tensor<boolean^(2x?)>`), which is what gives each of
the three kinds of type in the B2 section a spelling of its own. The cost of
B2 shows that `tensor` limited to numbers is not simpler: the non-numeric
arrays still exist (a comparison over a matrix makes one), and they need a
name. U costs the same as B (56 printed types) and gives `matrix` and
`tensor` the same cell rule, where B had `matrix` numeric and `tensor` not.

If the answer is no (option A), the two readings of `list<…>` in section 1
stay, and the documentation must teach both. If nothing is decided, option A
is what ships in the next release, together with the change of
`4e66aed34`. Moving to U after that release is a second breaking change.

A change to U must also rewrite the comments and documents that state the
number-cell rule for `vector` and `matrix`: `type-builder.ts`,
`serialize.ts`, `primitive.ts`, `types.ts`, `docs/TYPE-SYSTEM.md`, and the
`list<T>`/`tensor<U>` trap in `ARCHITECTURE.md`.

## 6. What makes the rules checkable

These do not depend on the option chosen, and none is implemented yet.

1. **One printed form per type.** The serializer is the only function that
   chooses between `list`, `vector`, `matrix` and `tensor`.
2. **A round-trip property test** over generated types: for every type `t`,
   `parseType(typeToString(t))` equals `t`, and the printed form is the
   canonical one (it does not contain a refused spelling).
3. **An element test** over generated types: for every `list<E^n>`,
   `collectionElementType()` returns `E`; for every `tensor<U^(d1x…xdk)>`
   with `k ≥ 2`, it returns `tensor<U^(d2x…xdk)>` (printed `vector` or
   `matrix` where that applies).
4. **A soundness test** over the library: for each collection operator and
   sample inputs, the type of the evaluated value is a subtype of the static
   type. A length that is wrong fails it (and so does any other wrong type),
   which enforces the rule of section 7 that a length the handler does not
   compute becomes `?`. A sample on 2026-10-22 found no wrong length:
   `Join`, `Append`, `Take`, `Drop`, `Rest`, `Filter`, `Sort`, `Unique` and
   `Zip` drop the length, `Reverse` and `Transpose` keep the right one.

The round-trip probe of the B2 measurement (test 2, run over every type the
suite printed) found three defects that are at HEAD, now in `ROADMAP.md`: the
empty tuple prints as the bare `tuple`, which parses back as a tuple of any
arity; a list with dimensions accepts cells that are an alias of a list
(`list<Row^2>` with `Row` an alias of `vector<integer^3>`); and the meet of
`list<unknown^2>` and `list<list<any^2>>` builds `list<list<any^2>^2>`, a
list with dimensions whose cells are lists, which the parser refuses.

## 7. Dependent types: what to keep in mind now

- Option U (like B) keeps the two forms that dependent types use: a sequence
  with a length (`Vect n E`, here `list<E^n>`) and an array with a shape
  (`Tensor [m, n] U`, here `matrix<U^(mxn)>` and `tensor<U^(…)>`).
- For one list, `list<T^?>` and `list<T>` are the same set, so the two
  meanings of `?` agree. As an axis of a shape, `?` already has meaning (b)
  inside one value: every row has the same length, not known
  (`matrix<integer^(2x?)>` refuses `[[1], [1, 2]]`). Meaning (b) across two
  values, "the same length as another value", is written with a named
  length variable (`N`), which the engine already parses
  (`(x: list<T^N>) -> T where T, N`).
- Length arithmetic (`N+1`, `N*M`) is out of scope. The policy to adopt
  before it is added: when the checker cannot compute or prove a length, the
  length becomes `?`, and a program is never rejected for that reason alone.
  Futhark and JAX show that the policy must be fixed before the arithmetic
  is written.
