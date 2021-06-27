---
title: Domains
permalink: /guides/compute-engine/domains/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script defer type='module'>
    import {  renderMathInDocument } 
      from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({
      TeX: {
        delimiters: {
          inline: [ ['$', '$'], ['\\(', '\\)']],
          display: [['$$', '$$'],['\\[', '\\]']],
        },
      },
      asciiMath: null,
      processEnvironments : false,
      renderAccessibleContent: false,
    });
</script>

# Domains

A **domain**, such as `Integer` `Boolean`, is a **set** used to represent the
possible values of an expression.

**Domains are similar to _types_ in programming languages.** They are used to
select the correct function definition. For example a function `Add` could
operate either on numbers or matrixes. The domain of the arguments is used to
select the appropriate function definition. Domains are also used in symbolic
manipulation algorithm to decide when certain manipulations are possible.

The list below includes the domains that are included in the standard dictionary
of the Compute Engine.

## Domains Lattice

**Domains are defined in a hierarchy (a lattice).** The upper bound of the
lattice is `Anything` and the lower bound is `Nothing`.

The _parent_ of a domain represents a _is-a_/_subset-of_ relationship, for
example, a `List` _is-a_ `Collection`.

![Anything domains](/assets/domains.001.jpeg 'The top-level domains')
![Tensor domains](/assets/domains.002.jpeg 'The Tensor sub-domains')
![Function domains](/assets/domains.003.jpeg 'The Function sub-domains')
![Number domains](/assets/domains.004.jpeg 'The Number sub-domains')

The implementation of the CortexJS domains is based on
[Weibel, Trudy & Gonnet, Gaston. (1991). An Algebra of Properties.. 352-359. 10.1145/120694.120749. ](https://www.researchgate.net/publication/.221564157_An_Algebra_of_Properties).{.notice--info}

## Obtaining the Domain of an Expression

**To obtain the domain of an expression**, use the `ce.domain()` function.

```js
const ce = new ComputeEngine();

ce.domain('Pi');
// ➔ "TranscendentalNumber"

ce.domain('Add');
// ➔ "Function": domain of the symbol "Add"

ce.domain(['Add', 5, 2]);
// ➔ "Number": the result of the "Add" function
// (its codomain) in general is a "Number"

ce.domain(ce.evaluate(['Add', 5, 2]));
// ➔ "Integer": once evaluated, the domain of the result may be more specific
```

## Defining New Domains

A new domain can be defined using a **domain expression**, that is a set
expression using any of the any of the **set functions**: `Union` `Intersection`
`SetMinus`..., combined with domains and **parametric domain** functions.

```json
//  A number or a boolean.
["Union", "Number", "Boolean"]

// Any number except "1".
["SetMinus", "Number", 1]
```

<div class='read-more'><a href="/guides/compute-engine/sets/">Learn more about <strong>Sets</strong> and the set functions<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

**Parametric domains** are functions that define a domain:

```json
// Range of non-negative integers
["Range", 0, "+Infinity"]
```

The `["Range", <min>, <max>]` parametric domain defines a set of integers such
that \\( \mathord{min} \le n \le \mathord{max}, n \in \N \\).

The `["Interval", <min>, <max>]` parametric domain defines a set of real numbers
such that \\( \mathord{min} \le x \le \mathord{max}, n \in \R \\).

**To represent an open interval**, use the `Open` function:
`["Interval", ["Open", <min>], <max>]` \\( \operatorname{min} \lt x \le
\operatorname{max}, n \in \R \\) or \\(x \in \rbrack \operatorname{min},
\operatorname{max} \rbrack \\).

<div class=symbols-table>

| Parametric Domain | Description                                                                                                                                                                                                             |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Function`        | `["Function", ...<arg-domain>, <co-domain>]` <br> For example, `["Function", "Number", "Boolean"]` is the domain of the functions that have a single argument, a number, and return a boolean (has a boolean codomain). |
| `Interval`        | `["Interval", <min>, <max>]` <br> The set of real numbers between `<min>` and `<max>`. Use `["Interval", ["Open", <min>], <max>]` to indicate an open interval.                                                         |
| `Multiple`        | `["Multiple", <factor>, <domain>, <offset>]` <br> The set of numbers that satisfy `<factor> * x + <offset>` with `x` in `domain`. For example, the set of odd numbers is `["Multiple", 2, "Integer", 1]`                |
| `Range`           | `["Range", <min>, <max>]` <br> The set of integers from `<min>` to `<max>` (inclusive).                                                                                                                                 |

</div>

## Simplifying Domains

**To simplify a domain expression**, use `ce.simplify(<domain>)`.

```js
ce.simplify(['SetMinus', 'Integer', ['Range', '-Infinity', 0]]);
// ➔ ["Range", 1, "+Infinity]]

ce.simplify(['Union', ['Number', 0, '+Infinity'], ['Number', '-Infinity', 5]]);
// ➔ "ExtendedRealNumber"
```

## List of Domains

### Numeric Domains

<div class=symbols-table>

| Domain            | Notation           | Description                                                                                                                       |
| :---------------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `AlgebraicNumber` | \\[ \mathbb{A} \\] | Elements are the root of a polynomial                                                                                             |
| `ComplexNumber`   | \\(\mathbb{C}\\)   | A real or imaginary number                                                                                                        |
| `Integer`         | \\(\mathbb{Z}\\)   | The set of whole numbers: \\(\lbrace 0, 1, 2, 3\ldots\rbrace\\) and their additive inverse: \\(\lbrace -1, -2, -3\ldots\rbrace\\) |
| `Number`          |                    | Any number, real or complex                                                                                                       |
| `RationalNumber`  | \\(\mathbb{Q}\\)   | A number which can be expressed as the quotient \\(p / q\\) of two integers \\(p, q \in \mathbb{Z}\\).                            |
| `RealNumber`      | \\(\mathbb{R}\\)   |                                                                                                                                   |

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
| `Boolean`          | `True` or `False`                                                                                |
| `Domain`           | The domain of all the domains                                                                    |
| `MaybeBoolean`     | `True` `False` or `Maybe`                                                                        |
| `ParametricDomain` | The domain of all the parametric domains, that is the functions that can define a domain         |
| `String`           | A string of Unicode characters                                                                   |
| `Symbol`           | A string used to represent the name of a constant, variable or function in a MathJSON expression |

</div>
