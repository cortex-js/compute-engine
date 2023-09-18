---
title: Standard Library
permalink: /compute-engine/guides/standard-library/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Standard Library

The **standard library** defines the **vocabulary** used by a MathJSON
expression.

This library defines the meaning of the identifiers used in a MathJSON
expression. It is independent of the syntax used to parse/serialize from another
language such as LaTeX.

A library contains definitions for symbols and functions, for example:

For example:

- "_`Pi` is a transcendental number whose value is approximately 3.14159265..._"
- "_The `Add` function is associative, commutative, pure, idempotent and can be
  applied to arbitrary number of Real or Complex numbers_".

## Domains

A domain is similar to a type in a traditional programming language.

The domain of a symbol provides some contextual information about this symbol,
for example: _"x is a positive integer"_.

The codomain of a function indicates the set of values that a function maps to,
or the domain of the "result" of the function.

Each entry in the symbol dictionary indicate the domain of the symbol, and for
functions its codomain (the domain of the result of evaluating the function).

## Topics

The standard library is organized by topics, each topic is a separate page in
the documentation.

<div class=symbols-table>

| Topic                                                               |                                                       |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)                 | `Add` `Multiply` `Power` `Exp` `Log` `ExponentialE` `ImaginaryUnit`... |
| [Calculus](/compute-engine/reference/calculus/)                     | `Derivative` `Integrate`...                                                |
| [Collections](/compute-engine/reference/collections/)               | `List` `Reverse` `Filter`...                                           |
| [Complex](/compute-engine/reference/complex/)                       | `Real` `Conjugate`, `ComplexRoots`...                                  |
| [Control Structures](/compute-engine/reference/control-structures/) | `If` `Block` `Loop` ...                                          |
| [Core](/compute-engine/reference/core/)                             | `Declare`, `Assign`, `Error` `LatexString`...                       |
| [Domains](/compute-engine/reference/domains/)                       | `Anything` `Nothing` `Number` `Integer` ...                            |
| [Functions](/compute-engine/reference/functions/)                   | `Function` `Apply` `Return` ...                                        |
| [Logic](/compute-engine/reference/logic/)                           | `And` `Or` `Not` `True` `False` `Maybe` ...                            |
| [Sets](/compute-engine/reference/sets/)                             | `Union` `Intersection` `EmptySet` ...                                  |
| [Special Functions](/compute-engine/reference/special-functions/)   | `Gamma` `Factorial`...                                                 |
| [Statistics](/compute-engine/reference/statistics/)                 | `StandardDeviation` `Mean` `Erf`...                                    |
| [Styling](/compute-engine/reference/styling/)                       | `Delimiter` `Style`...                                                 |
| [Trigonometry](/compute-engine/reference/trigonometry/)             | `Pi` `Cos` `Sin` `Tan`...                                              |

</div>


## Custom Library

{% readmore %} Read more about
[Adding New Definitions](/compute-compute-engine/guides/augmenting/).
{% endreadmore %}
