---
title: Domains
permalink: /compute-engine/guides/domains/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---

A **domain** is the set of the possible values of an expression.{.xl}

A domain is represented by a **domain expression**, such as `Integer`, `Boolean`
or `["Range", ["Literal", -1], ["Literal", +1]]`. `Integer` and `Boolean` are
**domain literals**, while `["Range", ["Literal", -1], ["Literal", +1]]` is a
**parametric domain expression**.

Domains are similar to _types_ in programming languages. Amongst other things,
they are used to select the correct function definition.

For example a function `Add` could operate either on numbers or matrixes. The
domain of the arguments is used to select the appropriate function definition.

Symbolic manipulation algorithms also use domains to decide when certain
transformations are applicable.

For example, \\( \sqrt{x^2} = x\\) only if \\(x \geq 0\\)

{% readmore "/compute-engine/reference/domains/" %} Read more about the
<strong>Domain Literals</strong> included in the standard dictionary of the
Compute Engine {% endreadmore %}

<section id='obtaining-the-domain-of-an-expression'>

## Obtaining the Domain of an Expression

**To query the domain of an expression**, read the `domain` property of the
expression.

```js
const ce = new ComputeEngine();

ce.box('Pi').domain;
// ➔ "TranscendentalNumber"

ce.box('Divide').domain;
// ➔ '["Function",  "Number", "Number", "Number]': domain of the function "Divide"

ce.box(['Add', 5, 2]).domain;
// ➔ "Number": the result of the "Add" function
// (its codomain) in general is a "Number"

ce.box(['Add', 5, 2]).evaluate().domain;
// ➔ "Integer": once evaluated, the domain of the result may be more specific
```

</section>

<section id='domain-lattice'>

## Domain Lattice

**Domains are defined in a hierarchy (a lattice).** The upper bound of the
domain lattice is the `Anything` domain (the top domain) and its lower bound is
the `Void` domain (the bottom domain).

- The **`Anything`** domain contains all possible values and all possible
  domains. It is used when not much is known about the possible value of an
  expression. In some languages, this is called the _universal_ type.
- The **`Void`** domain contains no value. It is the subdomain of all domains.
  Also called the zero or empty domain. It is rarely used, but it could indicate
  the return domain of a function that never returns.

There are a few other important domains:

- The **`Domain`** domain contains all the domain literals and all the
  parametric domains.
- The **`Value`** domain contains all the objects which are not domains, such as
  `Number`, `String`, `Symbol`, `Tuple`, etc...
- The **`Nothing`** domain has exactly one value, the symbol `Nothing`. It is
  used when an expression has no other meaningful value. In some languages, this
  is called the _unit_ type and the _unit_ value. For example a function that
  returns nothing would have a return domain of `Nothing` and would return the
  `Nothing` symbol.

The _parent_ of a domain represents a _is-a_/_subset-of_ relationship, for
example, a `List` _is-a_ `Collection`.

![Anything domains](/assets/domains.001.jpeg 'The top-level domains')

![Value domains](/assets/domains.002.jpeg 'The Value sub-domains')

![Tensor domains](/assets/domains.003.jpeg 'The Tensor sub-domains')

![Function domains](/assets/domains.004.jpeg 'The Function sub-domains')

![Number domains](/assets/domains.005.jpeg 'The Number sub-domains')

The implementation of the CortexJS domains is based on
[Weibel, Trudy & Gonnet, Gaston. (1991). An Algebra of Properties.. 352-359. 10.1145/120694.120749. ](https://www.researchgate.net/publication/.221564157_An_Algebra_of_Properties).{.notice--info}

</section>

<section id='domain-compatibility'>

## Domain Compatibility

Two domains can be evaluated for their **compatibility**.

There are three kinds of
[compatibility](<https://en.wikipedia.org/wiki/Covariance_and_contravariance_(computer_science)>)
that can be determined:

- **Invariance**: two domains are invariant if they represent exactly the same
  set of values
- **Covariance**: domain **A** is covariant with domain **B** if all the values
  in **A** are also in **B**. For example `Integer` is covariant with `Number`
- **Contravariant**: domain **A** is contravariant with domain **B** if all the
  values in **B** are in **A**. For example `Anything` is contravariant with
  every domain.

**To evaluate the compatibility of two domains** use `domain.isCompatible()`

```ts
ce.domain('Integer').isCompatible('PositiveNumber');
// ➔ true
```

</section>

<section id='parametric-domains'>

## Parametric Domains

A new domain can be defined using a parametric domain expression.

```json
// Range of non-negative integers
["Range", ["Literal", 0], ["Literal", "+Infinity"]]

// Functions with a single real number argument and that return an integer
["Function", "RealNumber", "Integer"]
```

Parametric domains are represented as special expressions: they are functions
with one of the domain constructors below and their arguments are domain
literals or other parametric domain expressions.

By default, compatibility is determined by using invariance of the arguments of
the parametric domain function.

<div class=symbols-table>

| Domain Constructor | Description                                                                                                                                                                                                                                                                                                                                                        |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Function`         | `["Function", ...<arg-domain>, <co-domain>]` <br> For example, `["Function", "Number", "Boolean"]` is the domain of the functions that have a single argument, a number, and return a boolean (has a boolean codomain).<br>By default, compatibility is determined by using covariance, excluding`Nothing, for the arguments and contravariance for the co-domain. |
| `List`             |                                                                                                                                                                                                                                                                                                                                                                    |
| `Record`           |                                                                                                                                                                                                                                                                                                                                                                    |
| `Tuple`            |                                                                                                                                                                                                                                                                                                                                                                    |
| `Intersection`     |                                                                                                                                                                                                                                                                                                                                                                    |
| `Union`            |                                                                                                                                                                                                                                                                                                                                                                    |
| `Optional`         |                                                                                                                                                                                                                                                                                                                                                                    |
| `Some`             |                                                                                                                                                                                                                                                                                                                                                                    |
| `Head`             |                                                                                                                                                                                                                                                                                                                                                                    |
| `Symbol`           |                                                                                                                                                                                                                                                                                                                                                                    |
| `Literal`          | This constructor defines a domain with a single value, the value of its argument. `                                                                                                                                                                                                                                                                                |
| `Covariant`        |                                                                                                                                                                                                                                                                                                                                                                    |
| `Contravariant`    |                                                                                                                                                                                                                                                                                                                                                                    |
| `Invariant`        | This constructor indicate that two domains are compatible only if they are invariants with regard to each other.                                                                                                                                                                                                                                                   |
| `Interval`         | `["Interval", <min>, <max>]` <br> The set of real numbers between `<min>` and `<max>`.<br> Use `["Interval", ["Open", <min>], <max>]` to indicate a open-left interval.                                                                                                                                                                                            |
| `Range`            | `["Range", <min>, <max>]` <br> The set of integers from `<min>` to `<max>` (inclusive).                                                                                                                                                                                                                                                                            |
| `Multiple`         | `["Multiple", <factor>, <domain>, <offset>]` <br> The set of numbers that satisfy `<factor> * x + <offset>` with `x` in `domain`. For example, the set of odd numbers is `["Multiple", 2, "Integer", 1]`                                                                                                                                                           |

</div>

</section>

<section id='simplifying-domains'>

## Simplifying Domains

**To simplify a domain expression**, call `domain.simplify()`.

```js
ce.box(['SetMinus', 'Integer', ['Range', '-Infinity', 0]]).simplify();
// ➔ ["Range", 1, "+Infinity]]

ce.box([
  'Union',
  ['Number', 0, '+Infinity'],
  ['Number', '-Infinity', 5],
]).simplify();
// ➔ "ExtendedRealNumber"
```

</section>
