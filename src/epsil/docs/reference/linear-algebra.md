---
title: Linear algebra Reference
sidebar_label: Linear algebra
slug: /epsil/reference/linear-algebra/
description: "The linear algebra library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from linear-algebra.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Linear algebra

The **linear-algebra** library holds the operations on vectors, matrices and
tensors: their shape, products, inverses, linear systems, eigenvalues and
matrix decompositions. This introduction gives the concepts you need before
you read the entries.

## Vectors, matrices and tensors

There is no separate matrix value. A vector is a list, a matrix is a list of
rows, and a tensor is a list nested more deeply. Every row of a matrix must
have the same length.

```epsil
[[1, 3], [5, 0]]
// ➔ [[1,3],[5,0]]
```

A list of ranges of the same length keeps its ranges, but the functions of
this library read each range as a row:

```epsil
determinant([1..2, 3..4])
// ➔ -2
```

The operator `*` chooses from the type of its operands, and a list of ranges is
not typed as a matrix, so `*` multiplies element by element. Use
`matrixMultiply` for the matrix product:

```epsil
[1..2, 3..4] * [1..2, 3..4]
// ➔ [[1,4],[9,16]]
```

Matrices are stored in **row-major** order: the first element of the outer
list is the first row. An index reads an element. Indexes start at 1. The
first index selects the row and the second index selects the column.

```epsil
let A = [[1, 2, 3], [4, 5, 6]]
A[2, 3]
// ➔ 6
```

With one index, you get a complete row:

```epsil
let A = [[1, 2], [3, 4]]
A[2]
// ➔ [3,4]
```

Because vectors and matrices are lists, the collection operations (`map`,
`reduce`, `at`, `length`) also apply to them.

A plain list is a row of values. `vector` makes a **column vector**, that is a
matrix with one column:

```epsil
vector(1, 2, 3)
// ➔ [[1],[2],[3]]
```

`matrix` does not change the value of its argument. It only records how the
matrix is displayed, for example its delimiters.

## Shape and rank

An **axis** is one level of nesting. A vector has one axis, a matrix has two,
and a tensor has more than two.

The **shape** is the length along each axis. A matrix with 2 rows and 3
columns has the shape `(2, 3)`. A scalar has the empty shape `()`.

```epsil
shape([[1, 2, 3], [4, 5, 6]])
// ➔ (2, 3)
```

A list whose items have different shapes (a ragged list) has the axes that its
items have in common. Rows of different lengths give a shape with one axis:

```epsil
shape([[5, 2, 10, 18], [1, 2, 3]])
// ➔ (2)
```

The **rank** is the number of axes, that is the length of the shape. In this
library, `rank` always has this meaning:

```epsil
rank([[[1, 2], [3, 4]], [[5, 6], [7, 8]]])
// ➔ 3
```

The number of linearly independent rows of a matrix is a different quantity.
Use `matrixRank` for it:

```epsil
matrixRank([[1, 2], [2, 4]])
// ➔ 1
```

`reshape` puts the same elements into a new shape, and `flatten` puts them
into one list, in row-major order:

```epsil
reshape(1..6, (2, 3))
// ➔ [[1,2,3],[4,5,6]]
```

## Element types

The type of a vector or matrix includes the type of its elements and its
shape. The element type is the narrowest type that includes every element.

```epsil
type([[1/2, 1], [3, 4]])
// ➔ TypeFrom("matrix<rational^(2x2)>")
```

```epsil
type([1, 2, 3])
// ➔ TypeFrom("vector<integer^3>")
```

A tensor with more than two axes has a `list` type with its full shape. An
operation that needs a matrix, such as `determinant` or `inverse`, reports an
`incompatible-type` error when its argument is not a matrix.

Elements can be symbolic. The operations then give a symbolic result:

```epsil
determinant([[a, b], [c, d]])
// ➔ -b * c + a * d
```

## Arithmetic and broadcasting

`+` and `-` operate element by element. The two operands must have the same
shape.

```epsil
[1, 2, 3] + [10, 20, 30]
// ➔ [11,22,33]
```

A scalar is **broadcast**: it combines with every element.

```epsil
10 * [[1, 2], [3, 4]]
// ➔ [[10,20],[30,40]]
```

```epsil
[[1, 2], [3, 4]] + 1
// ➔ [[2,3],[4,5]]
```

A vector is not broadcast along the rows of a matrix. Operands whose shapes
do not agree give an `incompatible-dimensions` error:

```epsil
[[1, 2], [3, 4]] + [[1, 2, 3], [4, 5, 6]]
// ➔ Error("incompatible-dimensions", "2x2 vs 2x3")
```

Functions of one number, such as `sqrt` or `cos`, apply to each element:

```epsil
sqrt([1, 4, 9])
// ➔ [1,2,3]
```

## Products and powers

When one operand of `*` is a matrix, `*` is the **matrix product**. The
order of the operands is kept, because the matrix product is not
commutative.

```epsil
[[1, 2], [3, 4]] * [[5, 6], [7, 8]]
// ➔ [[19,22],[43,50]]
```

A matrix times a vector is a vector:

```epsil
[[1, 2], [3, 4]] * [1, 1]
// ➔ [3,7]
```

The product of two vectors with `*` is element by element. Use `dot` for the
scalar (inner) product:

```epsil
[1, 2, 3] * [4, 5, 6]
// ➔ [4,10,18]
```

```epsil
dot([1, 2, 3], [4, 5, 6])
// ➔ 32
```

`hadamardProduct` multiplies two matrices element by element. `cross` is the
cross product of two vectors of length 3.

For a square matrix and an integer exponent, `^` is the **matrix power**. A
power of `0` gives the identity matrix and a negative power uses the inverse.

```epsil
[[1, 2], [3, 4]] ^ 2
// ➔ [[7,10],[15,22]]
```

```epsil
[[1, 2], [3, 4]] ^ -1
// ➔ [[-2,1],[3/2,-1/2]]
```

## Exact and numeric results

When all the elements are exact (integers and rationals), `determinant`,
`inverse`, `linearSolve`, `rowReduce` and `kernel` give an exact result. Use
`N` to get a decimal result:

```epsil
inverse([[1, 2], [3, 4]])
// ➔ [[-2,1],[3/2,-1/2]]
```

```epsil
N(inverse([[1, 2], [3, 4]]))
// ➔ [[-2,1],[1.5,-0.5]]
```

A matrix with a decimal element gives a decimal result.

`eigenvalues` and `eigenvectors` give exact values for a triangular matrix
and for a 2×2 matrix whose eigenvalues are rational or complex rational.
Otherwise they can give decimal values.

```epsil
eigenvalues([[0, -1], [1, 0]])
// ➔ [i,-i]
```

```epsil
eigenvalues([[2, 1], [1, 2]])
// ➔ [3,1]
```

The decompositions `luDecomposition`, `qrDecomposition` and
`choleskyDecomposition` of a matrix of exact rational entries give exact
factors: rationals for `luDecomposition`, and rationals times square roots
for `qrDecomposition` and `choleskyDecomposition`. The diagonal of the `R`
factor of `qrDecomposition` is not negative. `svd`, and these decompositions
of a matrix with a decimal entry or under `N`, use numeric algorithms, so
their factors contain decimal values. Multiply the factors to check a
decomposition:

```epsil
let (P, L, U) = luDecomposition([[4, 3], [2, 1]])
L * U
// ➔ [[4,3],[2,1]]
```

An operation that has no result for its argument stays unevaluated. For
example, a singular matrix has no inverse:

```epsil
inverse([[1, 2], [2, 4]])
// ➔ Inverse([[1,2],[2,4]])
```

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### adjugateMatrix

MathJSON `AdjugateMatrix` · `(matrix) -> matrix`

- argument 1 — The square matrix; a matrix that is not square leaves the call unevaluated. Sample: `[[1, 2], [3, 4]]`.

Adjugate (classical adjoint) of a square matrix.

```epsil
adjugateMatrix([[1, 2], [3, 4]])
// ➔ [[4,-2],[-3,1]]
```

### characteristicPolynomial

MathJSON `CharacteristicPolynomial` · `(matrix, variable: any?) -> expression`

- argument 1 — The square matrix. Sample: `[[2, 1], [1, 2]]`.
- `variable` — The variable of the polynomial; by default, `x`. Sample: `t`.

Characteristic polynomial det(x·I − A) of a square matrix (monic).

```epsil
characteristicPolynomial([[2, 1], [1, 2]], x)
// ➔ x^2 - 4x + 3
```

### choleskyDecomposition

MathJSON `CholeskyDecomposition` · `(matrix) -> matrix`

- argument 1 — The symmetric positive-definite matrix; another matrix gives an error. Sample: `[[4, 2], [2, 5]]`.

Cholesky decomposition of a positive-definite matrix.

```epsil
choleskyDecomposition([[4, 2], [2, 5]])
// ➔ [[2,0],[1,2]]
```

### conjugateTranspose

MathJSON `ConjugateTranspose` · `(value, axis1: integer?, axis2: integer?) -> value`

- argument 1 — The matrix or tensor; a vector gives the conjugate of each element, and a number its conjugate. Sample: `[[1, 2 + i], [3 - i, 4]]`.
- `axis1` — The first of the two axes to swap, counted from 1; the axes apply only when both are given, and by default they are the last two. Sample: `1`.
- `axis2` — The second of the two axes to swap, counted from 1. Sample: `2`.

Conjugate transpose (Hermitian adjoint) of a matrix or tensor.

```epsil
conjugateTranspose([[1, 2 + i], [3 - i, 4]])
// ➔ [[1,(3 + i)],[(2 - i),4]]
```

### cross

MathJSON `Cross` · `(tuple | vector, tuple | vector) -> tuple | vector`

- argument 1 — The first vector, of three elements. Sample: `[1, 0, 0]`.
- argument 2 — The second vector, of three elements. Sample: `[0, 1, 0]`.

Cross product of two 3-vectors.

```epsil
cross([1, 0, 0], [0, 1, 0])
// ➔ [0,0,1]
```

### degree

MathJSON `Degree` · `(value) -> integer`

- argument 1 — The polynomial, whose total degree is returned; a constant gives 0, and a lone symbol leaves the call unevaluated. Sample: `x^2 + 1`.

Degree of an object

```epsil
degree(x^3 + 2 * x + 1)
// ➔ 3
```

### det

MathJSON `Det` · `(matrix) -> number`

- argument 1 — The square matrix; a matrix that is not square gives an error. Sample: `[[1, 2], [3, 4]]`.

`det` is an alias for `determinant`, which is the preferred name. Determinant of a square matrix.

```epsil
det([[1, 2], [3, 4]])
// ➔ -2
```

### determinant

MathJSON `Determinant` · `(matrix) -> number`

- argument 1 — The square matrix; a matrix that is not square gives an error. Sample: `[[1, 2], [3, 4]]`.

Determinant of a square matrix.

```epsil
determinant([[1, 2], [3, 4]])
// ➔ -2
```

### diagonal

MathJSON `Diagonal` · `(value) -> value`

- argument 1 — A matrix, whose diagonal is returned, or a vector, which gives the diagonal matrix of its elements; a number is returned as is. Sample: `[1, 2, 3]`.

Extract a matrix diagonal or build a diagonal matrix.

```epsil
diagonal([[1, 2], [3, 4]])
// ➔ [1,4]
```

```epsil
diagonal([1, 2, 3])
// ➔ [[1,0,0],[0,2,0],[0,0,3]]
```

### dimension

MathJSON `Dimension` · `(value) -> integer`

- argument 1 — The vector, matrix or tensor whose number of elements is returned, or a `Hom(V, W)`, whose dimension is the product of the dimensions of V and W; a scalar gives 1. Sample: `[[1, 2, 3], [4, 5, 6]]`.

Return the dimension of a vector space: the number of elements of a vector, matrix or tensor, or the product of the dimensions of the two objects of a `hom`.

```epsil
dimension([[1, 2, 3], [4, 5, 6]])
// ➔ 6
```

### dot

MathJSON `Dot` · `(list<tuple> | matrix | tuple | vector, list<tuple> | matrix | tuple | vector) -> value`

- argument 1 — The first vector, point or matrix. Sample: `[1, 2, 3]`.
- argument 2 — The second vector, point or matrix, whose length matches the inner extent of the first. Sample: `[4, 5, 6]`.

Dot product (vector inner product) or matrix product.

```epsil
dot([1, 2, 3], [4, 5, 6])
// ➔ 32
```

### eigen

MathJSON `Eigen` · `(matrix) -> tuple`

- argument 1 — The square matrix. Sample: `[[2, 1], [1, 2]]`.

Eigenvalue-eigenvector decomposition of a square matrix.

```epsil
eigen([[2, 1], [1, 2]])
// ➔ ([3,1], [[1,1],[-1,1]])
```

### eigenvalues

MathJSON `Eigenvalues` · `(matrix) -> list`

- argument 1 — The square matrix. Sample: `[[2, 1], [1, 2]]`.

Eigenvalues of a square matrix.

```epsil
eigenvalues([[2, 1], [1, 2]])
// ➔ [3,1]
```

### eigenvectors

MathJSON `Eigenvectors` · `(matrix) -> list`

- argument 1 — The square matrix. Sample: `[[2, 1], [1, 2]]`.

Eigenvectors of a square matrix.

```epsil
eigenvectors([[2, 1], [1, 2]])
// ➔ [[1,1],[-1,1]]
```

### fill

MathJSON `Fill` · `(value: any, integer+) -> list`

- `value` — The value of each element. Sample: `7`.
- arguments 2, … — The length of one axis: one length gives a list, two give a matrix, and a length of 0 gives an empty list. Sample: `3`.

List or tensor with each element equal to a value. Each operand after the value is the length of one axis.

```epsil
fill(7, 3)
// ➔ [7,7,7]
```

```epsil
fill(7, 2, 3)
// ➔ [[7,7,7],[7,7,7]]
```

### flatten

MathJSON `Flatten` · `(value, depth: (+oo | integer)?) -> list`

- argument 1 — The tensor or collection to flatten; a scalar gives a list of one element. Sample: `[[1, 2], [3, 4]]`.
- `depth` — The number of levels to flatten, a non-negative integer or `oo`; by default, all levels. Sample: `1`.

Flatten a tensor or collection into a list.

```epsil
flatten([[1, 2], [3, 4]])
// ➔ [1,2,3,4]
```

### hadamardProduct

MathJSON `HadamardProduct` · `(matrix | vector, matrix | vector) -> matrix | vector`

- argument 1 — The first vector or matrix. Sample: `[1, 2]`.
- argument 2 — The second vector or matrix, of the same shape as the first. Sample: `[3, 4]`.

Hadamard (element-wise) product of two vectors or matrices of the same shape.

```epsil
hadamardProduct([[1, 2], [3, 4]], [[5, 6], [7, 8]])
// ➔ [[5,12],[21,32]]
```

### hom

MathJSON `Hom` · `(value*) -> value`

- arguments 1, … — An object: the first argument is the domain and the second the codomain. Sample: `[1, 2]`.

Hom-set of morphisms between objects

```epsil
dimension(hom([1, 2], [3, 4, 5]))
// ➔ 6
```

### identityMatrix

MathJSON `IdentityMatrix` · `(integer) -> matrix`

- argument 1 — The number of rows and columns, at least 1. Sample: `3`.

n-by-n identity matrix.

```epsil
identityMatrix(3)
// ➔ [[1,0,0],[0,1,0],[0,0,1]]
```

### inverse

MathJSON `Inverse` · `(matrix) -> matrix`

- argument 1 — The square matrix; a matrix that is not square gives an error, and a singular matrix leaves the call unevaluated. Sample: `[[1, 2], [3, 4]]`.

Multiplicative inverse of a square matrix.

```epsil
inverse([[1, 2], [3, 4]])
// ➔ [[-2,1],[3/2,-1/2]]
```

### isDiagonal

MathJSON `IsDiagonal` · `(value) -> boolean`

- argument 1 — The value to test; a value that is not a square matrix gives `False`. Sample: `[[1, 0], [0, 5]]`.

Whether the matrix is diagonal (all off-diagonal entries are zero).

```epsil
isDiagonal([[1, 0], [0, 5]])
// ➔ true
```

### isSquareMatrix

MathJSON `IsSquareMatrix` · `(value) -> boolean`

- argument 1 — The value to test; a value that is not a matrix gives `False`. Sample: `[[1, 2], [3, 4]]`.

Whether the value is a square matrix.

```epsil
isSquareMatrix([[1, 2], [3, 4]])
// ➔ true
```

### isSymmetric

MathJSON `IsSymmetric` · `(value) -> boolean`

- argument 1 — The value to test; a value that is not a square matrix gives `False`. Sample: `[[1, 2], [2, 3]]`.

Whether the matrix is symmetric (A equals its transpose).

```epsil
isSymmetric([[1, 2], [2, 3]])
// ➔ true
```

### kernel

MathJSON `Kernel` · `(value) -> list`

- argument 1 — The matrix of the linear map; a vector is read as a matrix of one row. Sample: `[[1, 2], [2, 4]]`.

Return a basis of the kernel (null space) of a matrix, as a list of vectors; the list is empty when the columns are independent.

```epsil
kernel([[1, 2], [2, 4]])
// ➔ [[-2,1]]
```

### luDecomposition

MathJSON `LUDecomposition` · `(matrix) -> tuple`

- argument 1 — The square matrix to decompose. Sample: `[[4, 3], [2, 1]]`.

Return the LU decomposition of a square matrix A: the tuple (P, L, U) with P·A = L·U, where P is a permutation matrix, L is lower triangular with ones on its diagonal and U is upper triangular.

```epsil
luDecomposition([[4, 3], [2, 1]])
// ➔ ([[1,0],[0,1]], [[1,0],[1/2,1]], [[4,3],[0,-1/2]])
```

### linearSolve

MathJSON `LinearSolve` · `(matrix, matrix | vector) -> value`

- argument 1 — The square matrix A of the coefficients; a singular matrix leaves the call unevaluated. Sample: `[[2, 1], [1, 3]]`.
- argument 2 — The right-hand side b: a vector with one element for each row of A, or a matrix with one row for each row of A. Sample: `[3, 5]`.

Return the solution x of the linear system A·x = b, of the shape of b.

```epsil
linearSolve([[2, 1], [1, 3]], [3, 5])
// ➔ [4/5,7/5]
```

### matrix

MathJSON `Matrix` · `(matrix, delimiters: string?, format: string?) -> matrix`

- argument 1 — The rows of the matrix. Sample: `[[1, 2], [3, 4]]`.
- `delimiters` — The opening and closing delimiters, `"()"` by default; `"[]"` and `"{}"` are the other common choices. Sample: `"[]"`.
- `format` — The alignment of each column: `<` left, `=` center, `>` right, with `|` or `:` for a vertical rule between columns. Sample: `"=="`.

Return the matrix whose rows are the elements of a list of lists.

The delimiters and the column format change only how the matrix is displayed in LaTeX.

```epsil
matrix([[1, 2], [3, 4]])
// ➔ [[1,2],[3,4]]
```

### matrixMultiply

MathJSON `MatrixMultiply` · `(matrix | vector, matrix | vector) -> matrix | number | vector`

- argument 1 — The left factor; its number of columns is the number of rows of the right factor. Sample: `[[1, 2], [3, 4]]`.
- argument 2 — The right factor; the product of two vectors is their inner product. Sample: `[[5, 6], [7, 8]]`.

Return the matrix product of two matrices, of a matrix and a vector, or of two vectors (their inner product).

```epsil
matrixMultiply([[1, 2], [3, 4]], [[5, 6], [7, 8]])
// ➔ [[19,22],[43,50]]
```

### matrixPower

MathJSON `MatrixPower` · `(matrix, real) -> matrix`

- argument 1 — The square matrix to raise to a power. Sample: `[[1, 1], [1, 0]]`.
- argument 2 — The exponent: 0 gives the identity matrix, and a negative integer a power of the inverse. Sample: `10`.

Square matrix raised to a power. Integer powers are the repeated matrix product; a half-integer power (e.g. 1/2) of an exact 2×2 positive-semidefinite matrix is the principal matrix square root.

```epsil
matrixPower([[1, 1], [1, 0]], 10)
// ➔ [[89,55],[55,34]]
```

### matrixRank

MathJSON `MatrixRank` · `(value) -> integer`

- argument 1 — The matrix whose independent rows are counted; a vector is read as a matrix of one row. Sample: `[[1, 2], [2, 4]]`.

Rank of a matrix (number of linearly independent rows/columns).

```epsil
matrixRank([[1, 2], [2, 4]])
// ➔ 1
```

### norm

MathJSON `Norm` · `(list<tuple> | number | tensor | tuple, (+oo | real | string)?) -> +oo | nan | real`

- argument 1 — The vector, matrix, point or number to measure; a list of points gives the norm of each point. Sample: `[3, 4]`.
- argument 2 — The order p, by default 2 for a vector and `"Frobenius"` for a matrix: a positive real or `+oo` for a vector; 1, 2, `+oo` (or `"Infinity"`) or `"Frobenius"` for a matrix, and another order leaves a matrix norm unevaluated. Sample: `1`.

Return the norm of a vector, a matrix or a point, or the absolute value of a number.

```epsil
norm([3, 4])
// ➔ 5
```

```epsil
norm([3, 4], 1)
// ➔ 7
```

### ones

MathJSON `Ones` · `(integer+) -> list`

- arguments 1, … — The length of one axis; 0 or a negative length gives an empty axis. Sample: `3`.

Return a list, or a tensor of any rank, whose every element is 1. Each argument is the length of one axis.

```epsil
ones(3)
// ➔ [1,1,1]
```

```epsil
ones(2, 3)
// ➔ [[1,1,1],[1,1,1]]
```

### onesMatrix

MathJSON `OnesMatrix` · `(rows: integer, columns: integer?) -> matrix`

- `rows` — The number of rows, at least 1; a symbol with no value leaves the call unevaluated. Sample: `2`.
- `columns` — The number of columns, at least 1; `rows` by default. Sample: `3`.

Return a matrix of the given size whose every element is 1.

```epsil
onesMatrix(2, 3)
// ➔ [[1,1,1],[1,1,1]]
```

### pseudoInverse

MathJSON `PseudoInverse` · `(matrix) -> matrix`

- argument 1 — The matrix to invert, of any shape; a rank-deficient matrix stays unevaluated. Sample: `[[1, 2], [3, 4], [5, 6]]`.

Return the Moore-Penrose pseudoinverse of a matrix: an n×m matrix for an m×n matrix.

```epsil
pseudoInverse([[1, 2], [3, 4], [5, 6]])
// ➔ [[-4/3,-1/3,2/3],[13/12,1/3,-5/12]]
```

### qrDecomposition

MathJSON `QRDecomposition` · `(matrix) -> tuple`

- argument 1 — The matrix to decompose, of any shape. Sample: `[[1, 2], [3, 4], [5, 6]]`.

Return the QR decomposition of an m×n matrix A: the tuple (Q, R) with A = Q·R, where Q is an m×m orthogonal matrix and R is an m×n upper triangular matrix.

```epsil
qrDecomposition([[0, 1], [1, 1]])
// ➔ ([[0,1],[1,0]], [[1,1],[0,1]])
```

### rank

MathJSON `Rank` · `(value) -> integer`

- argument 1 — The tensor, list or string whose number of axes is counted; a scalar has rank 0. Sample: `[[1, 2, 3], [4, 5, 6]]`.

The length of the shape of the expression. Note this is not the matrix rank (the number of linearly independent rows or columns in the matrix)

```epsil
rank([[1, 2, 3], [4, 5, 6]])
// ➔ 2
```

### reshape

MathJSON `Reshape` · `(value, tuple) -> value`

- argument 1 — The tensor, collection or scalar whose elements are arranged; a string stays unevaluated. Sample: `[1, 2, 3, 4, 5, 6]`.
- argument 2 — The extent of each axis of the result. Sample: `(2, 3)`.

Return the elements of a tensor or collection, in row-major order, arranged in a target shape.

Too few elements are repeated from the start, extra elements are dropped, and a scalar fills the whole shape.

```epsil
reshape([1, 2, 3, 4, 5, 6], (2, 3))
// ➔ [[1,2,3],[4,5,6]]
```

### rowReduce

MathJSON `RowReduce` · `(matrix) -> matrix`

- argument 1 — The matrix to reduce, of any shape; exact entries give an exact result. Sample: `[[1, 2, 3], [4, 5, 6]]`.

Return the reduced row echelon form (RREF) of a matrix.

```epsil
rowReduce([[1, 2, 3], [4, 5, 6]])
// ➔ [[1,0,-1],[0,1,2]]
```

### svd

MathJSON `SVD` · `(matrix) -> tuple`

- argument 1 — The matrix to decompose, of any shape; a matrix of exact entries stays unevaluated outside `N`. Sample: `[[3, 0], [0, 4]]`.

Return the singular value decomposition of an m×n matrix A, computed in machine precision: the tuple (U, S, V) with A = U·S·Vᵀ, where U and V are orthogonal and S is diagonal.

```epsil
N(svd([[3, 0], [0, 4]]))
// ➔ ([[0,1],[1,0]], [[4,0],[0,3]], [[0,1],[1,0]])
```

### shape

MathJSON `Shape` · `(value) -> tuple`

- argument 1 — The tensor, list or string to measure; a scalar has the empty shape `()`. Sample: `[[1, 2, 3], [4, 5, 6]]`.

Return the shape tuple of an expression. A ragged list has the axes that its items have in common: `shape([[1, 2], [3]])` is `(2)`.

```epsil
shape([[1, 2, 3], [4, 5, 6]])
// ➔ (2, 3)
```

### singularValues

MathJSON `SingularValues` · `(matrix) -> list`

- argument 1 — The matrix of any shape; an m×n matrix has min(m, n) singular values. Sample: `[[3, 0], [0, 4]]`.

The singular values of a matrix, sorted in descending order (including any zero values). Exact for a matrix whose Gram matrix A^T·A (or A·A^T) is at most 2×2 with exact rational entries; numeric otherwise.

```epsil
singularValues([[3, 0], [0, 4]])
// ➔ [4,3]
```

### trace

MathJSON `Trace` · `(number | tensor, axis1: integer?, axis2: integer?) -> number | tensor`

- argument 1 — The square matrix, or the tensor whose traces over two axes of equal extent are taken; a scalar is its own trace. Sample: `[[1, 2], [3, 4]]`.
- `axis1` — The first of the two axes of the trace, counted from 1; the axes apply only when both are given, and by default they are the last two. Sample: `1`.
- `axis2` — The second of the two axes of the trace, counted from 1 and different from the first. Sample: `2`.

Return the sum of the diagonal elements of a square matrix, or the tensor of the traces over two axes of a tensor.

```epsil
trace([[1, 2], [3, 4]])
// ➔ 5
```

### transpose

MathJSON `Transpose` · `(value, axis1: integer?, axis2: integer?) -> value`

- argument 1 — The matrix or tensor to transpose; a scalar, a vector or a string is returned as it is. Sample: `[[1, 2, 3], [4, 5, 6]]`.
- `axis1` — The first of the two axes to swap, counted from 1; the axes apply only when both are given, and by default they are the last two. Sample: `1`.
- `axis2` — The second of the two axes to swap, counted from 1. Sample: `2`.

Transpose a matrix or swap two tensor axes.

```epsil
transpose([[1, 2, 3], [4, 5, 6]])
// ➔ [[1,4],[2,5],[3,6]]
```

### vector

MathJSON `Vector` · `(any+) -> vector`

- arguments 1, … — An element of the vector. Sample: `1`.

Return the column vector of the arguments: an n×1 matrix with one argument in each row.

```epsil
vector(1, 2, 3)
// ➔ [[1],[2],[3]]
```

### zeroMatrix

MathJSON `ZeroMatrix` · `(rows: integer, columns: integer?) -> matrix`

- `rows` — The number of rows, at least 1; a symbol with no value leaves the call unevaluated. Sample: `2`.
- `columns` — The number of columns, at least 1; `rows` by default. Sample: `3`.

Return a matrix of the given size whose every element is 0.

```epsil
zeroMatrix(2, 3)
// ➔ [[0,0,0],[0,0,0]]
```

### zeros

MathJSON `Zeros` · `(integer+) -> list`

- arguments 1, … — The length of one axis; 0 or a negative length gives an empty axis. Sample: `3`.

Return a list, or a tensor of any rank, whose every element is 0. Each argument is the length of one axis.

```epsil
zeros(3)
// ➔ [0,0,0]
```

```epsil
zeros(2, 3)
// ➔ [[0,0,0],[0,0,0]]
```
