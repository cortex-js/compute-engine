---
title: MathJSON Standard Library
permalink: /compute-engine/guides/standard-library/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# MathJSON Standard Library

The **MathJSON standard library** defines the **vocabulary** used by a MathJSON
expression.

This library defines the meaning of the identifiers used in a MathJSON
expression. It is independent of the syntax used to parse/serialize from another
language such as LaTeX.

It includes definitions such as:

- "_`Pi` is a transcendental number whose value is approximately 3.14159265..._"
- "_The `Add` function is associative, commutative, pure, idempotent and can be
  applied to arbitrary number of Real or Complex numbers_".

## Topics

The **MathJSON Standard Library** is organized by topics, each topic is a separate page in
the documentation.

<div class=symbols-table>

| Topic                                                               |                                                       |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)                 | `Add` `Multiply` `Power` `Exp` `Log` `ExponentialE` `ImaginaryUnit`... |
| [Calculus](/compute-engine/reference/calculus/)                     | `D` `Derivative` `Integrate`...                                                |
| [Collections](/compute-engine/reference/collections/)               | `List` `Reverse` `Filter`...                                           |
| [Complex](/compute-engine/reference/complex/)                       | `Real` `Conjugate`, `ComplexRoots`...                                  |
| [Control Structures](/compute-engine/reference/control-structures/) | `If` `Block` `Loop` ...                                          |
| [Core](/compute-engine/reference/core/)                             | `Declare`, `Assign`, `Error` `LatexString`...                       |
| [Domains](/compute-engine/reference/domains/)                       | `Anything` `Nothing` `Numbers` `Integers` ...                            |
| [Functions](/compute-engine/reference/functions/)                   | `Function` `Apply` `Return` ...                                        |
| [Logic](/compute-engine/reference/logic/)                           | `And` `Or` `Not` `True` `False` `Maybe` ...                            |
| [Sets](/compute-engine/reference/sets/)                             | `Union` `Intersection` `EmptySet` ...                                  |
| [Special Functions](/compute-engine/reference/special-functions/)   | `Gamma` `Factorial`...                                                 |
| [Statistics](/compute-engine/reference/statistics/)                 | `StandardDeviation` `Mean` `Erf`...                                    |
| [Styling](/compute-engine/reference/styling/)                       | `Delimiter` `Style`...                                                 |
| [Trigonometry](/compute-engine/reference/trigonometry/)             | `Pi` `Cos` `Sin` `Tan`...                                              |

</div>




### Extending the MathJSON Standard Library

The MathJSON Standard Library can be extended by defining new functions:

```js
// Declare that the identifier "f" is a function, 
// but without giving it a definition
ce.declare("f", "Function");

// Define a new function `double` that returns twice its input
ce.assign("double(x)", ["Multiply", "x", 2]);

// LaTeX can be used for the definition as well...
ce.assign("half(x)", ce.parse("\\frac{x}{2}"));
```



{% readmore "/compute-engine/guides/augmenting/" %}
Read more about <strong>Augmenting the Standard Library</strong>
{% endreadmore %}


You can also customize the LaTeX syntax, that is how to parse and serialize 
LaTeX to MathJSON.

{% readmore "/compute-engine/guides/latex-syntax/" %}
Read more about <strong>Parsing and Serializing LaTeX</strong>
{% endreadmore %}
