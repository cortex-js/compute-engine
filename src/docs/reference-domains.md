---
title: Domains
permalink: /compute-engine/reference/domains/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

### Numeric Domains

<div class=symbols-table>

| Domain                 | Notation           | Description                                                                                                 |
| :--------------------- | :----------------- | :---------------------------------------------------------------------------------------------------------- |
| `AlgebraicNumber`      | \\[ \mathbb{A} \\] | Elements are the root of a polynomial                                                                       |
| `ComplexNumber`        | \\[ \mathbb{C} \\]   | A real or imaginary number                                                                                  |
| `Integer`              | \\[ \mathbb{Z}\\]  | The set of whole numbers and their additive inverse \\(\lbrace \ldots -3, -2, -1,0, 1, 2, 3\ldots\rbrace\\) |
| `NegativeInteger`      | \\[ \Z^- \\]       | Integers \\( \lt 0\\), \\(\lbrace \ldots -3, -2, -1\rbrace\\)                                                                                      |
| `NegativeNumber`       | \\[ \R^- \\]       | Real numbers \\( \lt 0 \\)                                                                                  |
| `NonNegativeInteger`   | \\[ \Z^{0+} \\]    | Integers \\( \geq 0 \\), \\(\lbrace 0, 1, 2, 3\ldots\rbrace\\)                                                                                     |
| `NonNegativeNumber`    | \\[ \R^{0+} \\]    | Real numbers \\( \geq 0 \\)                                                                                 |
| `NonPositiveInteger`   | \\[ \Z^{0-} \\]    | Integers \\( \leq 0 \\), \\(\lbrace \ldots -3, -2, -1, 0\rbrace\\)                                                                                     |
| `NonPositiveNumber`    | \\[ \R^{0-} \\]    | Real numbers \\( \leq 0 \\)                                                                                 |
| `Number`               |                    | Any number, real or complex                                                                                 |
| `PositiveInteger`      | \\[ \Z^{+} \\]     | Integers \\( \gt 0 \\), \\(\lbrace 1, 2, 3\ldots\rbrace\\)                                                                                      |
| `PositiveNumber`       | \\[ \R^{+} \\]     | Real numbers \\( \gt 0 \\)                                                                                  |
| `RationalNumber`       | \\[ \mathbb{Q}\\]  | A number which can be expressed as the quotient \\(p / q\\) of two integers \\(p, q \in \mathbb{Z}\\).      |
| `RealNumber`           | \\[ \mathbb{R} \\] | Numbers that form the unique Dedekind-complete ordered field (\\( \mathbb {R}  ; + ; · ; <\\)), up to an isomorphism                                                                                                            |
| `TranscendentalNumber` | \\[ \mathbb{T} \\] | Real numbers that are not algebraic                                                                         |

</div>

### Function Domains

<div class=symbols-table>

| Domain                             | Description                                                                                                                                                                                                                                                          |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContinuousFunction`               | A [continuous function](https://en.wikipedia.org/wiki/Continuous_function) is a function that has no abrupt change in value (no discontinuity). The [Weirestrass function](https://en.wikipedia.org/wiki/Weierstrass_function) is continuous, but not differentiable |
| `TranscendentalFunction`           | A function not expressible as a finite combination of the algebraic operations of addition, subtraction, multiplication, division, raising to a power, and extracting a root. Example: "Log", "Sin"...                                                               |
| `AlgebraicFunction`                | A function that can be defined as the root of a polynomial equation                                                                                                                                                                                                  |
| `PeriodicFunction`                 | A function that repeats its values at regular intervals                                                                                                                                                                                                              |
| `TrigonometricFunction`            | Real functions which relate an angle of a right-angled triangle to ratios of two side lengths                                                                                                                                                                        |
| `HyperbolicFunction`               |                                                                                                                                                                                                                                                                      |
| `MonotonicFunction`                | A function that is either entirely non-increasing, or entirely non-decreasing                                                                                                                                                                                        |
| `StrictMonotonicFunction`          |                                                                                                                                                                                                                                                                      |
| `DifferentiableFunction`           | A function whose derivative exists at each point in its domain                                                                                                                                                                                                       |
| `InfinitelyDifferentiableFunction` |                                                                                                                                                                                                                                                                      |
| `RationalFunction`                 | A function that can be expressed as the ratio of two polynomials                                                                                                                                                                                                     |
| `PolynomialFunction`               | A function expressed only with the operations of addition, subtraction, multiplication, and non-negative integer exponentiation                                                                                                                                      |
| `QuadraticFunction`                | A function of the form \\( x \mapsto \ ax^2+ bx + c\\)                                                                                                                                                                                                               |
| `LinearFunction`                   | A function that is the product of an argument plus a constant: \\(x \mapsto ax+ b\\)                                                                                                                                                                                 |
| `ConstantFunction`                 | A function that always return the same value \\(x \mapsto c\\)                                                                                                                                                                                                       |
| `MonotonicFunction`                |                                                                                                                                                                                                                                                                      |
| `StrictMonotonicFunction`          |                                                                                                                                                                                                                                                                      |
| `Predicate`                        | A function with a codomain of `MaybeBoolean`                                                                                                                                                                                                                         |
| `LogicalFunction`                  | A predicate whose arguments are in the `MaybeBoolean` domain, for example the domain of `And` is `LogicalFunction`                                                                                                                                                   |

</div>

### Tensor Domains

<div class=symbols-table>

| Domain                        | Description                                                                                                                                                                  |
| :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `ComplexTensor`               | A tensor whose elements are complex numbers                                                                                                                                  |
| `RealTensor`                  | A tensor whose elements are real numbers                                                                                                                                     |
| `IntegerTensor`               | A tensor whose elements are integers                                                                                                                                         |
| `LogicalTensor`               | A tensor whose elements are 0 or 1                                                                                                                                           |
| `Scalar`                      | A tensor of rank 0                                                                                                                                                           |
| `Vector`<br>`Row`<br>`Column` | A tensor of rank 1. The argument of the parametric version specifies the number of elements in the vector.                                                                   |
| `Matrix`                      | A tensor of rank 2. The argument of the parametric version specifies the number of rows and columns in the matrix.                                                           |
| `Quaternion`                  | A \\(2\times2\\) matrix of complex elements. [Quaternions](https://en.wikipedia.org/wiki/Quaternion) are commonly used to represent vectors in 3D space (\\(\mathbb{R}^3\\)) |
| `SquareMatrix`                | A tensor with the same number of rows and columns                                                                                                                            |
| `MonomialMatrix`              | A square matrix with exactly one non-zero entry in each row and column                                                                                                       |
| `OrthogonalMatrix`            | A real square matrix whose transpose is equal to its inverse: \\(Q^{\mathrm{T}}=Q^{-1}\\)                                                                                    |
| `PermutationMatrix`           | A square matrix with with exactly one non-zero entry in each row and column                                                                                                  |
| `DiagonalMatrix`              | A matrix in which the elements outside the main diagonal are zero                                                                                                            |
| `IdentityMatrix`              | A diagonal matrix whose diagonal elements are 1                                                                                                                              |
| `ZeroMatrix`                  | A matrix whose elements are 0                                                                                                                                                |
| `SymmetricMatrix`             | A real matrix that is equal to its transpose                                                                                                                                 |
| `HermitianMatrix`             | A complex matrix that is equal to its conjugate transpose                                                                                                                    | </div> |

### Other Domains

<div class=symbols-table>

| Domain             | Description                                                                                      |
| :----------------- | :----------------------------------------------------------------------------------------------- |
| `Anything`          | The universal domain, it conaints all possible values                                                                            |
| `Boolean`          | `True` or `False`                                                                                |
| `Domain`           | The domain of all the domains                                                                    |
| `MaybeBoolean`     | `True` `False` or `Maybe`                                                                        |
| `Nothing`          | The domain whose only member is the symbol `Nothing` |
| `ParametricDomain` | The domain of all the parametric domains, that is the functions that can define a domain         |
| `String`           | A string of Unicode characters                                                                   |
| `Symbol`           | A string used to represent the name of a constant, variable or function in a MathJSON expression |

</div>
