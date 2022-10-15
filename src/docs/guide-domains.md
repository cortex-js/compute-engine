---
title: Domains
permalink: /compute-engine/guides/domains/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
preamble:
  '<h1>Domains</h1><p class="xl">The <b>domain</b> of an expression is the set 
  of the possible values of that expression.</p>'
toc: true
---

A domain is represented by a **domain expression**. For example:

- `"Integer"`
- `"Boolean"`
- `["Range", -1, +1]`.

A domain expression is either a **domain literal** represented by an identifier
such as `"Integer"` and `"Boolean"` or a **constructed domain** represented by 
a function expression. 

Of course, it wouldn't make sense for it to be any function, so the
name of that function must be among a limited set of **domain constructor**. 

This effectively defines a specialized language to represent domains. In some 
cases the same function name can be used in a domain expression and a value
expression, but they will be interpreted differently. 

For example, the expression `["List", 5, 7, 11]` is a value representing a list 
of three integers. On the other hand, the domain expression `["List", "Integer"]`
represents the domain of all the lists that have integers as their element.

Domains are similar to _types_ in programming languages. Amongst other things,
they are used to select the correct function definition.

For example a function `Add` could operate either on numbers or matrixes. The
domain of the arguments would be used to select the appropriate function
definition.

Symbolic manipulation algorithms also use domains to decide when certain
transformations are applicable.

For example, \\( \sqrt{x^2} = x\\) only if \\(x \geq 0\\)

{% readmore "/compute-engine/reference/domains/" %} Read more about the
<strong>Domain Literals</strong> included in the standard library of the Compute
Engine {% endreadmore %}

<section id='obtaining-the-domain-of-an-expression'>

## Obtaining the Domain of an Expression

**To query the domain of an expression** read the `domain` property of the
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
  the return domain of a function that never returns. Not to be confused with
  `Nothing`, which is used when a function returns nothing.

There are a few other important domains:

- The **`Domain`** domain contains all the domain expressions.
- The **`Value`** domain contains all the expressions which are not domains,  
  for example the number `42`, the symbol `alpha`, the expression
  `["Add", "x", 1]`.
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

By default, `domain.isCompatible()` will check for covariant compatibility.

```ts
ce.domain('PositiveNumber').isCompatible('Integer');
// ➔ true

ce.domain('Number').isCompatible('RealNumber', 'contravariant');
// ➔ true
```

</section>

## Constructing New Domains

A domain constructor is a function expression with one of the identifiers below.

**To define a new domain** use a domain constructor.

```json
// Range of non-negative integers
["Range", 0, {num: "+Infinity"}]

// Functions with a single real number argument and that return an integer
["Function", "RealNumber", "Integer"]
```
When a domain expression is boxed, it is automatically put in canonical form.


<div class="symbols-table first-column-header">

| Domain Constructor | Description                                                                                                                                                                                                                                                                                                                                    |
| :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Function`         | `["Function", ...<arg-domain>, <co-domain>]` <br> For example, `["Function", "Number", "Boolean"]` is the domain of the functions that have a single argument, a number, and return a boolean (has a boolean codomain).<br>By default, compatibility is determined by using covariance for the arguments and contravariance for the co-domain. |
| `List`             | `["List", <element-domain>]` <br>                                                                                                                                                                                                                                                                                                              |
| `Record`           |                                                                                                                                                                                                                                                                                                                                                |
| `Tuple`            | `["Tuple", <element-1-domain>]`, `["Tuple", <element-1-domain>] ... <element-n-domain>]`                                                                                                                                                                                                                                                       |
| `Intersection`     | `["Intersection", <domain-1>, <domain-2>]` <br> All the values that are a member of `<domain-1>` and `<domain-2>`                                                                                                                                                                                                                              |
| `Union`            | `["Union", <domain-1>, <domain-2>]` <br>All the values that are a member of `<domain-1>` or `<domain-2>`                                                                                                                                                                                                                                       |
| `Maybe`            | `["Maybe", <domain>]`<br> A value of `<domain>` or `Nothing`                                                                                                                                                                                                                                                                                   |
| `Sequence`         | `["Sequence", <domain>]` <br>As a function argument one or more values of `<domain>`.                                                                                                                                                                                                                                                          |
| `Head`             |                                                                                                                                                                                                                                                                                                                                                |
| `Symbol`           |                                                                                                                                                                                                                                                                                                                                                |
| `Literal`          | This constructor defines a domain with a single value, the value of its argument. `                                                                                                                                                                                                                                                            |
| `Covariant`        |                                                                                                                                                                                                                                                                                                                                                |
| `Contravariant`    |                                                                                                                                                                                                                                                                                                                                                |
| `Invariant`        | `["Invariant", <domain>]`<br> This constructor indicate that a domain is compatible with this domain only if they are invariants with regard to each other.                                                                                                                                                                                    |
| `Interval`         | `["Interval", <min>, <max>]` <br> The set of real numbers between `<min>` and `<max>`.<br> Use `["Interval", ["Open", <min>], <max>]` to indicate an open-left interval.                                                                                                                                                                       |
| `Range`            | `["Range", <min>, <max>]` <br> The set of integers from `<min>` to `<max>` (inclusive).                                                                                                                                                                                                                                                        |
| `Multiple`         | `["Multiple", <factor>, <domain>, <offset>]` <br> The set of numbers that satisfy `<factor> * x + <offset>` with `x` in `domain`. For example, the set of odd numbers is `["Multiple", 2, "Integer", 1]`                                                                                                                                       |

</div>
