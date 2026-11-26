# A matrix of run-time size as a shape of the IR

Status: design, not approved. Scope: the `javascript` target of the IR
compiler (`src/compute-engine/compilation/ir/`), outside the interval and
`bigint` modes. GLSL keeps stated sizes. Issues it resolves: CE-1834.
Related: CE-1837 (an untyped parameter inferred `unknown`).

## 1. The question

A program that reads a matrix whose size the host knows only at run time
compiles for the matrix operators and declines for element-wise arithmetic,
so it runs in the interpreter. A user sees a slow program, not an error, and
does not report it. This note proposes one shape for such a matrix, so that
every operation that compiles on a matrix of stated size compiles on it too.

## 2. What the code does today

Measured at `0c5858f1ae20f8abbd9de27ffc2795ada8370a7f`, `javascript`,
`fallback: false`.

| Program | `A: matrix<real>` | `T = Tabulate(f, n, m)` | `C: matrix<real^2x2>` |
| --- | --- | --- | --- |
| `Transpose`, `Determinant`, `MatrixMultiply`, `Map(r ↦ Sum(r), ·)` | compiles | compiles | compiles |
| `A + B`, `2·A`, `A + 1`, `Sin(A)` | declines | declines | compiles |
| `Sum(·)` (the sum of the rows) | declines | declines | declines |

The declines read "A of type matrix<real> other than in an element read
A[i][j] or as an argument of a parameter of that type" for an input, and "a
list of lists of run-time length" for a build.

The cause is the carrier, not the IR type:

- `IRType.shape` admits a run-time length on every axis
  (`Length = number | { v: V }`, `ir.ts`). A rank-2 value of a stated row
  length and a run-time number of rows, shape `[{v: n}, 3]`, exists and
  threads element-wise.
- A value whose rows have a run-time length is typed on the lane `rows`,
  shape `[]`: an input of a matrix type (`rowsInput()`, `lower.ts`) and a
  build whose element is such a row (`over()`, `lower-lists.ts`). The lane
  was made for the groups of `Chunk` and `Partition`, whose rows can have
  different lengths (README, "The rows lane").
- When every row has one length, `over()` proves it (the width is a value
  made before the region, `before()`; CE-1736) and records it beside the
  value in `cx.rowWidths`, with the number of rows in `cx.rowCounts`. The
  matrix operators of `lower-matrices.ts` read these tables (27 reads in 5
  files), each through an operation of the lane (`rows.get`, `rows.flat`,
  `rows.order`, `rows.inverse`, `rows.power`, `rows.agree`, `rows.square`,
  …). Element-wise threading reads the shape, which is `[]`, so it declines.

So a matrix is held as if its rows could differ, and its two lengths are
kept outside its type.

## 3. Design

**3.1 The shape.** A matrix of run-time size is a value of the lane `real`
or `integer` and the shape `[{v: r}, {v: c}]`, where `r` and `c` are integer
values visible where the type is (the verifier's rule for every length
value). Its run-time form is the host's array of arrays, as today. It is
made by:

- an input or a typed parameter of type `matrix<real>`, `matrix<integer>`,
  `matrix` (strict mode: real) or `tensor<real^(?x?)>`. Two length
  parameters come before it: `r` is `A.length` and `c` is `A[0].length`, the
  rule that the input of a matrix type already follows ("the compiled code
  takes the length of the first row as the length of every row", the
  unreleased section of `CHANGELOG.md`). A matrix with no row is outside the type, as today (a known
  limitation of `docs/COMPILATION-MODEL.md`);
- a build whose element is a flat list of a length that `before()` proves the
  same for every row (`Tabulate(f, n, m)`, `Map(i ↦ Map(j ↦ …, K), L)`),
  where `over()` records `rowWidths` today;
- the matrix operators, whose result shape they settle from their operands
  (`Transpose` gives `[c, r]`, `MatrixMultiply` gives `[r1, c2]`, `Inverse`
  gives `[r, r]`).

`list<list<real>>` keeps the lane `rows`: its rows can have different
lengths, and the readers of "Lists of two run-time lengths" stay as they are.

**3.2 Element-wise operations.** An operation that threads over its list
operands threads over two run-time lengths as over one: a build of builds.
Two operands of shapes that `same()` does not prove equal are compared once
at run time by `agree()` of `lower-matrices.ts` (the check that
`MatrixMultiply` makes for its inner lengths, a `RangeError`
`incompatible-dimensions` where they differ; the interpreter gives that
error). A scalar operand broadcasts as it does over a list. The passes
`forward` and `filters` read such a build where it is (CE-1806); the target is that
`Sum(Map(r ↦ Sum(r), 2·A + 1))` is two loops and no array.

**3.3 The matrix operators.** Each operator of `lower-matrices.ts` reads the
shape of its operand, the same code for a stated and a run-time size. The
`rows.*` operations that exist only to carry a matrix on the lane `rows`
(`rows.get`, `rows.order`, `rows.square`, `rows.agree`, and the `rowWidths`
and `rowCounts` tables for a matrix) go, where the shape gives the same
value. The kernels of `matrix-runtime.ts` stay: `mdet`, `minverse`,
`mpower` read a flat array and the order, made by one flattening operation
of a rank-2 value.

**3.4 Reductions of a matrix.** `Sum`, `Product`, `Max`, `Min` and `Mean`
of a rank-2 value give the interpreter's value, which reduces the rows
element-wise (`Sum(Tabulate((i, j) ↦ i·j, 3, 2))` is `[6, 12]`): a build
over the columns of a sum over the rows. This holds for a stated size too,
which declines today.

**3.5 An untyped parameter.** A positional parameter of no declared type
whose uses give it the type `matrix` (`A ↦ Determinant(A)`, `A ↦ Inverse(A)`)
is read as a matrix of run-time size, by the rule of an input with no
declared type ("the meet of the types that its occurrences require",
`docs/COMPILATION-MODEL.md`). Today it declines ("the parameter A of no
declared type, read as matrix"). A parameter inferred `unknown` declines
(CE-1837).

## 4. What it does not do

- `tensor<real>` of unknown rank still declines (R4: a union of shapes at an
  input). Reading it as a matrix where every use needs one would give wrong
  values for a value of another rank inside the type: the matrix code gives
  -2 for the 2×2×1 value `[[[1],[2]],[[3],[4]]]`, where the interpreter gives
  `expected-square-matrix`. Compiling it needs a rank check at the entry, a
  change of R1/R5; that is a separate decision.
- Rank 3 and above: unchanged (README, "Matrices": a rank above 2 declines).
- Complex and boolean matrices, `RowReduce` of a run-time size, GLSL, the
  interval and the `bigint` modes: unchanged.

## 5. Steps

Each step lands alone, with its tests, and keeps every existing value.

1. **The shape at the entry.** `rowsInput()` gives a matrix type the shape
   `[{v: r}, {v: c}]` with two length parameters; the matrix operators accept
   both carriers during the change. Acceptance: the existing matrix tests pass
   unchanged.
2. **Element-wise threading** over two run-time lengths, with `agree()` for
   lengths not proved equal. Acceptance: the witnesses of CE-1834 compile with
   the interpreter's values, and a mismatch throws `incompatible-dimensions`.
3. **Builds.** `over()` gives a build of rows of one proved width the shape,
   not the lane `rows`. Acceptance: `Tabulate(f, n, m) + 1` and
   `Sin(Map(i ↦ Map(j ↦ …, K), L))` compile.
4. **The operators on the shape**, and removal of the matrix uses of the
   lane `rows` (3.3). Acceptance: no test changes value; the count of `rows.*`
   operations and of `rowWidths` reads goes down (report both).
5. **Reductions of a matrix** (3.4), on both sizes.
6. **The untyped parameter** (3.5), after CE-1837.

Each step reports the emitted code of the witnesses before and after, and the
number of changed tests.

## 6. Choices for the user

- **Q1. The run-time form.** (a) The host's array of arrays, flattened only
  for a kernel, as today (recommended: no copy at the entry, the host's
  format, the existing tests). (b) A flat `Float64Array` with its two
  lengths: no flattening before a kernel, but a copy of every input and of
  every result given back to the host.
- **Q2. `tensor<real^(?x?)>`** read as a matrix (recommended: it is the same
  type spelled as a tensor, and the type system makes it a matrix).
- **Q3. Step 6** in this work, or as an issue of its own after CE-1837
  (recommended: in this work; it is a few lines once the shape exists).

## 7. Risks and cost

Size L (estimate): the lowering of element-wise operations, the verifier's
length rules for a second run-time axis, the JavaScript printer, and a port
of the matrix operators of `lower-matrices.ts`. The risk is the boundary with
the lane `rows`: a value that can be a matrix or a list of rows of different
lengths at one place (`If` of the two) must decline, as two shapes do (R3).
Measure the tests under `test/compute-engine/` that compile a matrix before
step 1, and report the counts at each step.
