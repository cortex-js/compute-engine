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

The 42 definitions of the linear algebra library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### adjugateMatrix

MathJSON `AdjugateMatrix` · `(matrix) -> matrix`

Adjugate (classical adjoint) of a square matrix.

### characteristicPolynomial

MathJSON `CharacteristicPolynomial` · `(matrix, any?) -> expression`

Characteristic polynomial det(x·I − A) of a square matrix (monic).

### choleskyDecomposition

MathJSON `CholeskyDecomposition` · `(matrix) -> matrix`

Cholesky decomposition of a positive-definite matrix.

### conjugateTranspose

MathJSON `ConjugateTranspose` · `(value, axis1: integer?, axis2: integer?) -> value`

Conjugate transpose (Hermitian adjoint) of a matrix or tensor.

### cross

MathJSON `Cross` · `(tuple | vector, tuple | vector) -> tuple | vector`

Cross product of two 3-vectors.

### degree

MathJSON `Degree` · `(value) -> integer`

Degree of an object

### determinant

MathJSON `Determinant` · `(matrix) -> number`

Determinant of a square matrix.

### diagonal

MathJSON `Diagonal` · `(value) -> value`

Extract a matrix diagonal or build a diagonal matrix.

### dimension

MathJSON `Dimension` · `(value) -> integer`

Dimension of an object

### dot

MathJSON `Dot` · `(list<tuple> | matrix | tuple | vector, list<tuple> | matrix | tuple | vector) -> value`

Dot product (vector inner product) or matrix product.

### eigen

MathJSON `Eigen` · `(matrix) -> tuple`

Eigenvalue-eigenvector decomposition of a square matrix.

### eigenvalues

MathJSON `Eigenvalues` · `(matrix) -> list`

Eigenvalues of a square matrix.

### eigenvectors

MathJSON `Eigenvectors` · `(matrix) -> list`

Eigenvectors of a square matrix.

### flatten

MathJSON `Flatten` · `(value, integer?) -> list`

Flatten a tensor or collection into a list.

### hadamardProduct

MathJSON `HadamardProduct` · `(matrix | vector, matrix | vector) -> matrix | vector`

Hadamard (element-wise) product of two vectors or matrices of the same shape.

### hom

MathJSON `Hom` · `(value*) -> value`

Hom-set of morphisms between objects

### identityMatrix

MathJSON `IdentityMatrix` · `(integer) -> matrix`

n-by-n identity matrix.

### inverse

MathJSON `Inverse` · `(T) -> T where T: matrix`

Multiplicative inverse of a square matrix.

### isDiagonal

MathJSON `IsDiagonal` · `(value) -> boolean`

Whether the matrix is diagonal (all off-diagonal entries are zero).

### isSquareMatrix

MathJSON `IsSquareMatrix` · `(value) -> boolean`

Whether the value is a square matrix.

### isSymmetric

MathJSON `IsSymmetric` · `(value) -> boolean`

Whether the matrix is symmetric (A equals its transpose).

### kernel

MathJSON `Kernel` · `(value) -> list`

Kernel (null space) of a linear map

### luDecomposition

MathJSON `LUDecomposition` · `(matrix) -> tuple`

LU decomposition of a square matrix.

### linearSolve

MathJSON `LinearSolve` · `(matrix, matrix | vector) -> value`

Solve the linear system A·x = b for x.

### matrix

MathJSON `Matrix` · `(matrix, string?, string?) -> matrix`

Matrix constructor and canonicalizer.

### matrixMultiply

MathJSON `MatrixMultiply` · `(matrix | vector, matrix | vector) -> matrix | vector`

Matrix and vector multiplication.

### matrixPower

MathJSON `MatrixPower` · `(matrix, real) -> matrix`

Square matrix raised to a power. Integer powers are the repeated matrix product; a half-integer power (e.g. 1/2) of an exact 2×2 positive-semidefinite matrix is the principal matrix square root.

### matrixRank

MathJSON `MatrixRank` · `(value) -> integer`

Rank of a matrix (number of linearly independent rows/columns).

### norm

MathJSON `Norm` · `(list<number> | list<tuple> | number | tuple, (+oo | real | string)?) -> +oo | nan | real`

Vector or matrix norm.

### onesMatrix

MathJSON `OnesMatrix` · `(integer, integer?) -> matrix`

Matrix filled with ones.

### pseudoInverse

MathJSON `PseudoInverse` · `(matrix) -> matrix`

Moore-Penrose pseudoinverse of a matrix.

### qrDecomposition

MathJSON `QRDecomposition` · `(matrix) -> tuple`

QR decomposition of a matrix.

### rank

MathJSON `Rank` · `(value) -> integer`

The length of the shape of the expression. Note this is not the matrix rank (the number of linearly independent rows or columns in the matrix)

### reshape

MathJSON `Reshape` · `(value, tuple) -> value`

Reshape a tensor or collection to a target shape.

### rowReduce

MathJSON `RowReduce` · `(matrix) -> matrix`

Reduced row echelon form (RREF) of a matrix.

### svd

MathJSON `SVD` · `(matrix) -> tuple`

Singular value decomposition of a matrix.

### shape

MathJSON `Shape` · `(value) -> tuple`

Return the shape tuple of an expression.

### singularValues

MathJSON `SingularValues` · `(matrix) -> list`

The singular values of a matrix, sorted in descending order (including any zero values). Exact for a matrix whose Gram matrix A^T·A (or A·A^T) is at most 2×2 with exact rational entries; numeric otherwise.

### trace

MathJSON `Trace` · `(list<number> | number, axis1: integer?, axis2: integer?) -> list<number> | number`

Trace of a matrix or pair of tensor axes.

### transpose

MathJSON `Transpose` · `(value, axis1: integer?, axis2: integer?) -> value`

Transpose a matrix or swap two tensor axes.

### vector

MathJSON `Vector` · `(any+) -> vector`

Construct a column vector.

### zeroMatrix

MathJSON `ZeroMatrix` · `(integer, integer?) -> matrix`

Matrix filled with zeros.
