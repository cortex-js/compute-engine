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
