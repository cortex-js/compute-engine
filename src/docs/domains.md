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

A domain represents a set of values. For example `Number` and `Boolean` are
domains.

Domains are similar to _types_ in programming languages. They are used to ensure
that the arguments of functions are compatible. This information is also useful
to select appropriate algorithms and to optimize compiled expressions.

See list below of the domains built-in the standard dictionary of the Comptue Engine.



## Domains Lattice

Domains are defined in a hierarchy (a lattice). The upper bound of the domain
lattice is `Anything` and the lower bound is `Nothing`. 

The _parent_ of a domain represent a _is-a_/_subset-of_ relationship, for example, a `List` _is-a_ `Collection`.

![Anything domains](/assets/domains.001.jpeg 'The top-level domains')
![Tensor domains](/assets/domains.002.jpeg 'The Tensor sub-domains')
![Function domains](/assets/domains.003.jpeg 'The Function sub-domains')
![Number domains](/assets/domains.004.jpeg 'The Number sub-domains')

The implementation of the CortexJS domains is based on
[Weibel, Trudy & Gonnet, Gaston. (1991). An Algebra of Properties.. 352-359. 10.1145/120694.120749. ](https://www.researchgate.net/publication/.221564157_An_Algebra_of_Properties).{.notice--info}

## Obtaining the Domain of an Expression

**To obtain the domain of an expression**, use the `ce.domain()`
function.

```js
const engine = new ComputeEngine();

engine.domain('Pi');
// ➔ "TranscendentalNumber"

engine.domain('Add');
// ➔ "Function": domain of the symbol "Add"

engine.domain(['Add', 5, 2]);
// ➔ "Number": the result of the "Add" function
// (its codomain) in general is a "Number"

engine.domain(engine.evaluate(['Add', 5, 2]));
// ➔ "PrimeNumber"
```

## Converting Domains to a Canonical Form

**To convert a domain to a canonical form**, use `ce.format(<domain>, 'canonical-domain')`.

```js
format(['SetMinus', 'RealNumber', 'IrrationalNumber'], 'canonical-domain');
// ➔ "RationalNumber"

format(
  ['Union', ['Number', 0, '+Infinity'], ['Number', '-Infinity', 5]],
  'canonical-domain'
);
// ➔ "ExtendedRealNumber"
```

## List of Domains

<div class=symbols-table>

| Domain | Description |
| :--- | :--- |
| `Boolean` | `True` or `False` |
| `MaybeBoolean` | `True` `False` or `Maybe` |
| `String` | A string of Unicode characters |
| `Symbol` | A string used to represent the name of a constant, variable or function in a MathJSON expression |
| `PrimeNumber` | An integer that cannot be produced as the product of 2 or more integers |
| `CompositeNumber` | An integer that can be produced by the product of 2 or more integers |
| `Integer` | \\(= \mathbb{Z}\\). The set of whole numbers: \\(0, 1, 2, 3\ldots\\) and their additive inverse: \\(-1, -2, -3, \ldots\\) |
| `NumberZero` | The number \\(0\\): a composite number and an imaginary number |
| `RationalNumber` | \\(= \mathbb{Q}\\). A number which can be expressed as the quotient \\(\frac{p}{q}\\) of two integers \\(p, q \in \mathbb{Z}\\). |
| `RealNumber` |\\(= \mathbb{R}\\) | 
| `NaturalNumber` | \\(= \mathbb{N}\\). Counting numbers, \\(0, 1, 2, 3\ldots\\)<br>Note that \\(0\\) is included, following the convention from [ISO/IEC 80000](https://en.wikipedia.org/wiki/ISO_80000-2) |
| `IrrationalNumber` | \\(= \mathbb{Q^{\prime}}\\). Numbers such as \\(\sqrt{5}, \pi, \exponentialE\\) that cannot be written as a quotient of two integers |
| `ImaginaryNumber` | Any purely imaginary value (including zero) | 
| `ComplexNumber` | \\(= \mathbb{C}\\). A real or imaginary number |
| `ComplexTensor` | A tensor whose elements are complex numbers |
| `RealTensor` | A tensor whose elements are real numbers |
| `IntegerTensor` | A tensor whose elements are integers |
| `LogicalTensor` | A tensor whose elements are 0 or 1   |
| `Scalar` | A tensor of rank 0 |
| `Vector`<br>`Row`<br>`Column` | A tensor of rank 1. The argument of the parametric version specifies the number of elements in the vector. |
| `Matrix` | A tensor of rank 2. The argument of the parametric version specifies the number of rows and columns in the matrix.|
| `Quaternion` | A \\(2\times2\\) matrix of complex elements. [Quaternions](https://en.wikipedia.org/wiki/Quaternion) are commonly used to represent vectors in 3D space (\\(\mathbb{R}^3\\)) |
| `SquareMatrix` | A tensor with the same number of rows and columns |
| `MonomialMatrix` | A square matrix with exactly one non-zero entry in each row and column |
| `OrthogonalMatrix` | A real square matrix whose transpose is equal to its inverse: \\(Q^{\mathrm{T}}=Q^{-1}\\) |
| `PermutationMatrix` | A square matrix with with exactly one non-zero entry in each row and column |
| `DiagonalMatrix` | A matrix in which the elements outside the main diagonal are zero|
| `IdentityMatrix` | A diagonal matrix whose diagonal elements are 1 |
| `ZeroMatrix` |  A matrix whose elements are 0 |
| `SymmetricMatrix` | A real matrix that is equal to its transpose |
| `HermitianMatrix` | A complex matrix that is equal to its conjugate transpose |
| `ContinuousFunction` | A [continuous function](https://en.wikipedia.org/wiki/Continuous_function) is a function that has no abrupt change in value (no discontinuity). The [Weirestrass function](https://en.wikipedia.org/wiki/Weierstrass_function) is continuous, but not differentiable |
| `TranscendentalFunction` | A function not expressible as a finite combination of the algebraic operations of addition, subtraction, multiplication, division, raising to a power, and extracting a root. Example: "Log", "Sin"... |
| `AlgebraicFunction` | A function that can be defined as the root of a polynomial equation |
| `PeriodicFunction` | A function that repeats its values at regular intervals |
| `TrigonometricFunction` | Real functions which relate an angle of a right-angled triangle to ratios of two side lengths |
| `HyperbolicFunction` | | 
| `MonotonicFunction` | A function that is either entirely non-increasing, or entirely non-decreasing |
| `StrictMonotonicFunction` | | 
| `DifferentiableFunction` | A function whose derivative exists at each point in its domain | 
| `InfinitelyDifferentiableFunction` | | 
| `RationalFunction` | A function that can be expressed as the ratio of two polynomials |
| `PolynomialFunction` | A function expressed only with the operations of addition, subtraction, multiplication, and non-negative integer exponentiation | 
| `QuadraticFunction` |  A function of the form \\(f(x) = ax^2+ bx + c\\) | 
| `LinearFunction` | \\(f(x) = ax+ b\\) A function that is the product of an argument plus a constant | 
| `ConstantFunction` | A function that always return the same value |
| `MonotonicFunction` | | 
| `StrictMonotonicFunction`  | | 
| `Predicate`  | A function with a codomain (range) of `MaybeBoolean` | 
| `LogicalFunction`  | A predicate whose arguments are in the `MaybeBoolean` domain, for example the domain of `And` is `LogicalFunction` | 
| `Domain` | The domain of all the domains |
| `ParametricDomain` | The domain of all the parametric domains, that is the functions that can define a domain |

</div>

## Parametric Domains

Parametric domains are functions that define a domain:

```json
// Range of non-negative integers
["Range", 0, "+Infinity"]
```

The `["Range", <min>, <max>]` parametric domain defines a set of integers such
that \\( \mathord{min} \le n \le \mathord{max}, n \in \N \\).

The `["Interval", <min>, <max>]` parametric domain defines a set of real numbers
such that \\( \mathord{min} \le x \le \mathord{max}, n \in \R \\).

**To represent an open interval**, use the `Open` function:
`["Interval", ["Open", <min>], <max>]` \\( \operatorname{min} \lt x \le \operatorname{max},
n \in \R \\) or \\(x \in \rbrack \operatorname{min}, \operatorname{max} \rbrack \\).


<div class=symbols-table>

| Parametric Domain | Description |
| :--- | :--- |
| `Function` | `["Function", ...<arg-domain>, <co-domain>]` <br> For example, `["Function", "Number", "Boolean"]` is the domain of the functions that have a single argument, a number, and return a boolean (has a boolean codomain). |
| `Interval` | `["Interval", <min>, <max>]` <br> The set of real numbers between `<min>` and `<max>`. Use `["Interval", ["Open", <min>], <max>]` to indicate an  open interval. |
| `Range` | `["Range", <min>, <max>]` <br> The set of integers from `<min>` to `<max>` (inclusive). |

</div>

## Defining New Domains

New domains can be defined as a union or intersection of other domains:

```json
//  A number or a boolean.
["Union", "Number", "Boolean"]

// Any number except "1".
[("SetMinus", "Number", 1)]
```
