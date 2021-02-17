---
title: MathJSON Core
permalink: /guides/math-json-domains/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

# Domains

A domain such as `"Number"` or `"Boolean"` represents a set of values.

Domains are analogous to types in programming languages and are used to ensure
that the arguments of functions are compatible.

Domains can be defined as a union or intersection of domains:

- `["Union", "Number", "Boolean"]`: A number or a boolean.
- `["SetMinus", "Number", 1]`: Any number except "1".

Parametric domains can be used as functions:

```json
["Number", 0, "+Infinity"]
```

Not all domains are parametric, and the precise semantic of the parametric form
depends on the domain. For example, the `"Number"` parametric domain implies a
result in `"ExtendedRealNumber"`, not `"ExtendedComplexNumber"`. The `"String"`
parametric domain restrict the length of the string.

Domains are defined in a hierarchy (a lattice). The upper bound of the domain
lattice is `"Anything"` and the lower bound is `"Nothing"`. The 'parent' of a
domain represent a 'is-a' relationship, for example, a `"List"` "is-a"
`"Collection"`.

Domains can be converted to a canonical form using the `'canonical-domain'`
form.

```js
format(['SetMinus', 'RealNumber', 'IrrationalNumber'], 'canonical-domain');
// -> "RationalNumber"
format(
  ['Union', ['Number', 0, '+Infinity'], ['Number', '-Infinity', 5]],
  'canonical-domain'
);
// -> "ExtendedRealNumber"
```

![Anything domains](./domains.001.jpeg 'The Anything Domains')
![Tensor domains](./domains.002.jpeg 'The Tensor Domains')
![Function domains](./domains.003.jpeg 'The Function Domains')
![Number domains](./domains.004.jpeg 'The Number Domains')

The implementation of the CortexJS domains is based on
[Weibel, Trudy & Gonnet, Gaston. (1991). An Algebra of Properties.. 352-359. 10.1145/120694.120749. ](https://www.researchgate.net/publication/.221564157_An_Algebra_of_Properties)

## `"Domain"` and `"ParametricDomain"`

The domain of all the domains is `"Domain"`.

`"ParametricDomain"` is the domain of all the parametric domains, that is the
domains that can accept one or more parameters to define a more precise domain,
for example `["Matrix", 5]` to define the domain of 5x5 matrices.

## `"String"` and `"Symbol"`

`"String"` is the domain of all the strings.

A `"Symbol"` is a string used to represent the name of a constant, variable or
function.

`["String", `_`len`_`]` is the set of all the string of exactly length `len`.

`["String", `_`min`_`, `_`max`_`]` is the set of all the string of length at
least _min_ and at most _max_. _max_ can be equal to "+Infinity".

## `"Boolean"` and `"MaybeBoolean"`

`"Boolean"` is the set of the values `"True"`, `"False"`.

`"MaybeBoolean"` is the set of the values `"True"`, `"False"` and `"Maybe"`.

## `"Function"`

A function is an expression that maps some expressions, its arguments, to
another expression.

`["Function", ...`_`arg-domain`_`, `_`co-domain`_`]` is the parametric version
of the `"Function"` domain. For example, `["Function", "Number", "Boolean"]` is
the domain of the functions that have a single argument, a number, and return a
boolean.

## `"ContinuousFunction"`

A [continuous function](https://en.wikipedia.org/wiki/Continuous_function) is a
function that has no abrupt change in value (no discontinuity).

The [Weirestrass function](https://en.wikipedia.org/wiki/Weierstrass_function)
is continuous, but not differentiable.

## `"TranscendentalFunction"`

A function not expressible as a finite combination of the algebraic operations
of addition, subtraction, multiplication, division, raising to a power, and
extracting a root.

Example: "Log", "Sin"...

## `"AlgebraicFunction"`

A function that can be defined as the root of a polynomial equation.

## `"PeriodicFunction"`

A function that repeats its values at regular intervals.

## `"TrigonometricFunction"`

Real functions which relate an angle of a right-angled triangle to ratios of two
side lengths

## `"HyperbolicFunction"`

## `"MonotonicFunction"`

A function that is either entirely non-increasing, or entirely non-decreasing.

## `"StrictMonotonicFunction"`

## `"DifferentiableFunction"`

A function whose derivative exists at each point in its domain.

## `"InfinitelyDifferentiableFunction"`

## `"RationalFunction"`

A function that can be expressed as the ratio of two polynomials.

## `"PolynomialFunction"`

A function expressed only with the operations of addition, subtraction,
multiplication, and non-negative integer exponentiation.

## `"QuadraticFunction"`

A function that is of the form `f(x) = ax^2+ bx + c`

## `"LinearFunction"`

A function that is the product of an argument plus a constant, `f(x) = ax+ b`

## `"ConstantFunction"`

A function that always return the same value

## `"MonotonicFunction"`

## `"StrictMonotonicFunction"`

## `"Predicate"` and `"LogicalFunction"`

A predicate is a function with a codomain of `MaybeBoolean`.

It may have one, two or more arguments of any domain.

A `LogicalFunction` is a predicate whose arguments are in the `MaybeBoolean`
domain, for example the domain of `And` is `"LogicalFunction"`.

## `"Number"`

Any numerical value

- `"PrimeNumber"` - An integer that cannot be produced as the product of 2 or
  more integers.
- `"CompositeNumber"` - An integer that can be produced by the product of 2 or
  more integers.
- `"Integer"` - The set of whole numbers: 0, 1, 2, 3... and their additive
  inverse: -1, -2, -3, etc... The set ℤ.
- `"NumberZero"` - The number 0: a composite number and an imaginary number.
- `"RationalNumber"` - A number which can be expressed as the quotient `p/q` of
  two integers. The set ℚ.
- `"RealNumber"` - The set ℝ
- `"NaturalNumber"` - The set ℕ of counting numbers, 0, 1, 2, 3... Note that 0
  is included, following the convention from
  [ISO/IEC 80000](https://en.wikipedia.org/wiki/ISO_80000-2).
- `"IrrationalNumber"` - Numbers such as √5, π, e... that cannot be written as a
  quotient of two integers. The set ℚ'
- `"ImaginaryNumber"` - Any purely imaginary value (including zero).
- `"ComplexNumber"` - A real or imaginary number. Set set ℂ.

## `"Tensor"`

- `"Scalar"` A tensor of rank 0.
- `"Vector"`, `"Row"`, `"Column"` A tensor of rank 1. The argument of the
  parametric version specifies the number of elements in the vector.
- `"Matrix"` A tensor of rank 2. The argument of the parametric version
  specifies the number of rows and columns in the matrix.
- `"ComplexTensor"` a tensor whose elements are complex numbers.
- `"RealTensot"` a tensor whose elements are real numbers.
- `"IntegerTensor"` a tensor whose elements are integers.
- `"LogicalTensor"` a tensor whose elements are 0 or 1.
- `"SquareMatrix"` a tensor with the same number of rows and columns.
- `"MonomialMatrix"` a square matrix with exactly one non-zero entry in each row
  and column.
- `"PermutationMatrix"` a square matrix with with exactly one non-zero entry in
  each row and column.
- `"DiagonalMatrix"` a matrix in which the elements outside the main diagonal
  are zero.
- `"IdentityMatrix"` a diagonal matrix whose diagonal elements are 1.
- `"ZeroMatrix"` a matrix whose elements are 0.
- `"SymmetricMatrix"` a real matrix that is equal to its transpose.
- `"HermitianMatrix"` a complex matrix that is equal to its conjugate transpose.
