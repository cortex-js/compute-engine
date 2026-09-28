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

The decompositions `luDecomposition`, `qrDecomposition`,
`choleskyDecomposition` and `svd` use numeric algorithms. Their factors can
contain decimal values even when the argument is exact. Multiply the factors
to check a decomposition:

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

Adjugate (classical adjoint) of a square matrix.

```epsil
adjugateMatrix([[1, 2], [3, 4]])
// ➔ [[4,-2],[-3,1]]
```

### characteristicPolynomial

MathJSON `CharacteristicPolynomial` · `(matrix, any?) -> expression`

Characteristic polynomial det(x·I − A) of a square matrix (monic).

```epsil
characteristicPolynomial([[2, 1], [1, 2]], x)
// ➔ x^2 - 4x + 3
```

### choleskyDecomposition

MathJSON `CholeskyDecomposition` · `(matrix) -> matrix`

Cholesky decomposition of a positive-definite matrix.

```epsil
choleskyDecomposition([[4, 2], [2, 5]])
// ➔ [[2,0],[1,2]]
```

### conjugateTranspose

MathJSON `ConjugateTranspose` · `(value, axis1: integer?, axis2: integer?) -> value`

Conjugate transpose (Hermitian adjoint) of a matrix or tensor.

```epsil
conjugateTranspose([[1, 2 + i], [3 - i, 4]])
// ➔ [[1,(3 + i)],[(2 - i),4]]
```

### cross

MathJSON `Cross` · `(tuple | vector, tuple | vector) -> tuple | vector`

Cross product of two 3-vectors.

```epsil
cross([1, 0, 0], [0, 1, 0])
// ➔ [0,0,1]
```

### degree

MathJSON `Degree` · `(value) -> integer`

Degree of an object

```epsil
degree(x^3 + 2 * x + 1)
// ➔ 3
```

### determinant

MathJSON `Determinant` · `(matrix) -> number`

Determinant of a square matrix.

```epsil
determinant([[1, 2], [3, 4]])
// ➔ -2
```

### diagonal

MathJSON `Diagonal` · `(value) -> value`

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

Dimension of an object

```epsil
dimension([[1, 2, 3], [4, 5, 6]])
// ➔ 6
```

### dot

MathJSON `Dot` · `(list<tuple> | matrix | tuple | vector, list<tuple> | matrix | tuple | vector) -> value`

Dot product (vector inner product) or matrix product.

```epsil
dot([1, 2, 3], [4, 5, 6])
// ➔ 32
```

### eigen

MathJSON `Eigen` · `(matrix) -> tuple`

Eigenvalue-eigenvector decomposition of a square matrix.

```epsil
eigen([[2, 1], [1, 2]])
// ➔ ([3,1], [[1,1],[-1,1]])
```

### eigenvalues

MathJSON `Eigenvalues` · `(matrix) -> list`

Eigenvalues of a square matrix.

```epsil
eigenvalues([[2, 1], [1, 2]])
// ➔ [3,1]
```

### eigenvectors

MathJSON `Eigenvectors` · `(matrix) -> list`

Eigenvectors of a square matrix.

```epsil
eigenvectors([[2, 1], [1, 2]])
// ➔ [[1,1],[-1,1]]
```

### flatten

MathJSON `Flatten` · `(value, integer?) -> list`

Flatten a tensor or collection into a list.

```epsil
flatten([[1, 2], [3, 4]])
// ➔ [1,2,3,4]
```

### hadamardProduct

MathJSON `HadamardProduct` · `(matrix | vector, matrix | vector) -> matrix | vector`

Hadamard (element-wise) product of two vectors or matrices of the same shape.

```epsil
hadamardProduct([[1, 2], [3, 4]], [[5, 6], [7, 8]])
// ➔ [[5,12],[21,32]]
```

### hom

MathJSON `Hom` · `(value*) -> value`

Hom-set of morphisms between objects

```epsil
dimension(hom([1, 2], [3, 4, 5]))
// ➔ 6
```

### identityMatrix

MathJSON `IdentityMatrix` · `(integer) -> matrix`

n-by-n identity matrix.

```epsil
identityMatrix(3)
// ➔ [[1,0,0],[0,1,0],[0,0,1]]
```

### inverse

MathJSON `Inverse` · `(T) -> T where T: matrix`

Multiplicative inverse of a square matrix.

```epsil
inverse([[1, 2], [3, 4]])
// ➔ [[-2,1],[3/2,-1/2]]
```

### isDiagonal

MathJSON `IsDiagonal` · `(value) -> boolean`

Whether the matrix is diagonal (all off-diagonal entries are zero).

```epsil
isDiagonal([[1, 0], [0, 5]])
// ➔ "True"
```

### isSquareMatrix

MathJSON `IsSquareMatrix` · `(value) -> boolean`

Whether the value is a square matrix.

```epsil
isSquareMatrix([[1, 2], [3, 4]])
// ➔ "True"
```

### isSymmetric

MathJSON `IsSymmetric` · `(value) -> boolean`

Whether the matrix is symmetric (A equals its transpose).

```epsil
isSymmetric([[1, 2], [2, 3]])
// ➔ "True"
```

### kernel

MathJSON `Kernel` · `(value) -> list`

Kernel (null space) of a linear map

```epsil
kernel([[1, 2], [2, 4]])
// ➔ [[-2,1]]
```

### luDecomposition

MathJSON `LUDecomposition` · `(matrix) -> tuple`

LU decomposition of a square matrix.

```epsil
luDecomposition([[4, 3], [2, 1]])
// ➔ ([[1,0],[0,1]], [[1,0],[0.5,1]], [[4,3],[0,-0.5]])
```

### linearSolve

MathJSON `LinearSolve` · `(matrix, matrix | vector) -> value`

Solve the linear system A·x = b for x.

```epsil
linearSolve([[2, 1], [1, 3]], [3, 5])
// ➔ [4/5,7/5]
```

### matrix

MathJSON `Matrix` · `(matrix, string?, string?) -> matrix`

Matrix constructor and canonicalizer.

```epsil
matrix([[1, 2], [3, 4]])
// ➔ [[1,2],[3,4]]
```

### matrixMultiply

MathJSON `MatrixMultiply` · `(matrix | vector, matrix | vector) -> matrix | vector`

Matrix and vector multiplication.

```epsil
matrixMultiply([[1, 2], [3, 4]], [[5, 6], [7, 8]])
// ➔ [[19,22],[43,50]]
```

### matrixPower

MathJSON `MatrixPower` · `(matrix, real) -> matrix`

Square matrix raised to a power. Integer powers are the repeated matrix product; a half-integer power (e.g. 1/2) of an exact 2×2 positive-semidefinite matrix is the principal matrix square root.

```epsil
matrixPower([[1, 1], [1, 0]], 10)
// ➔ [[89,55],[55,34]]
```

### matrixRank

MathJSON `MatrixRank` · `(value) -> integer`

Rank of a matrix (number of linearly independent rows/columns).

```epsil
matrixRank([[1, 2], [2, 4]])
// ➔ 1
```

### norm

MathJSON `Norm` · `(list<number> | list<tuple> | number | tuple, (+oo | real | string)?) -> +oo | nan | real`

Vector or matrix norm.

```epsil
norm([3, 4])
// ➔ 5
```

```epsil
norm([3, 4], 1)
// ➔ 7
```

### onesMatrix

MathJSON `OnesMatrix` · `(integer, integer?) -> matrix`

Matrix filled with ones.

```epsil
onesMatrix(2, 3)
// ➔ [[1,1,1],[1,1,1]]
```

### pseudoInverse

MathJSON `PseudoInverse` · `(matrix) -> matrix`

Moore-Penrose pseudoinverse of a matrix.

```epsil
pseudoInverse([[1, 2], [3, 4], [5, 6]])
// ➔ [[-4/3,-1/3,2/3],[13/12,1/3,-5/12]]
```

### qrDecomposition

MathJSON `QRDecomposition` · `(matrix) -> tuple`

QR decomposition of a matrix.

```epsil
qrDecomposition([[0, 1], [1, 1]])
// ➔ ([[0,1],[-1,0]], [[-1,-1],[0,1]])
```

### rank

MathJSON `Rank` · `(value) -> integer`

The length of the shape of the expression. Note this is not the matrix rank (the number of linearly independent rows or columns in the matrix)

```epsil
rank([[1, 2, 3], [4, 5, 6]])
// ➔ 2
```

### reshape

MathJSON `Reshape` · `(value, tuple) -> value`

Reshape a tensor or collection to a target shape.

```epsil
reshape([1, 2, 3, 4, 5, 6], (2, 3))
// ➔ [[1,2,3],[4,5,6]]
```

### rowReduce

MathJSON `RowReduce` · `(matrix) -> matrix`

Reduced row echelon form (RREF) of a matrix.

```epsil
rowReduce([[1, 2, 3], [4, 5, 6]])
// ➔ [[1,0,-1],[0,1,2]]
```

### svd

MathJSON `SVD` · `(matrix) -> tuple`

Singular value decomposition of a matrix.

```epsil
svd([[3, 0], [0, 4]])
// ➔ ([[0,1],[1,0]], [[4,0],[0,3]], [[0,1],[1,0]])
```

### shape

MathJSON `Shape` · `(value) -> tuple`

Return the shape tuple of an expression.

```epsil
shape([[1, 2, 3], [4, 5, 6]])
// ➔ (2, 3)
```

### singularValues

MathJSON `SingularValues` · `(matrix) -> list`

The singular values of a matrix, sorted in descending order (including any zero values). Exact for a matrix whose Gram matrix A^T·A (or A·A^T) is at most 2×2 with exact rational entries; numeric otherwise.

```epsil
singularValues([[3, 0], [0, 4]])
// ➔ [4,3]
```

### trace

MathJSON `Trace` · `(list<number> | number, axis1: integer?, axis2: integer?) -> list<number> | number`

Trace of a matrix or pair of tensor axes.

```epsil
trace([[1, 2], [3, 4]])
// ➔ 5
```

### transpose

MathJSON `Transpose` · `(value, axis1: integer?, axis2: integer?) -> value`

Transpose a matrix or swap two tensor axes.

```epsil
transpose([[1, 2, 3], [4, 5, 6]])
// ➔ [[1,4],[2,5],[3,6]]
```

### vector

MathJSON `Vector` · `(any+) -> vector`

Construct a column vector.

```epsil
vector(1, 2, 3)
// ➔ [[1],[2],[3]]
```

### zeroMatrix

MathJSON `ZeroMatrix` · `(integer, integer?) -> matrix`

Matrix filled with zeros.

```epsil
zeroMatrix(2, 3)
// ➔ [[0,0,0],[0,0,0]]
```
