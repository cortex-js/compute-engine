---
title: Domains
permalink: /compute-engine/reference/domains/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
---

### Numeric Domains

<div class=symbols-table>

| Domain                  | Notation           | Description                                                                                                                            |
| :---------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `AlgebraicNumbers`      | \\[ \mathbb{A} \\] | Numbers that are the root of a polynomial                                                                                              |
| `ComplexNumbers`        | \\[ \mathbb{C} \\] | Real or imaginary numbers                                                                                                              |
| `Integers`              | \\[ \mathbb{Z}\\]  | Whole numbers and their additive inverse \\(\lbrace \ldots -3, -2, -1,0, 1, 2, 3\ldots\rbrace\\)                                       |
| `NegativeIntegers`      | \\[ \Z^- \\]       | Integers \\( \lt 0\\), \\(\lbrace \ldots -3, -2, -1\rbrace\\)                                                                          |
| `NegativeNumbers`       | \\[ \R^- \\]       | Real numbers \\( \lt 0 \\)                                                                                                             |
| `NonNegativeIntegers`   | \\[ \Z^{0+} \\]    | Integers \\( \geq 0 \\), \\(\lbrace 0, 1, 2, 3\ldots\rbrace\\)                                                                         |
| `NonNegativeNumbers`    | \\[ \R^{0+} \\]    | Real numbers \\( \geq 0 \\)                                                                                                            |
| `NonPositiveIntegers`   | \\[ \Z^{0-} \\]    | Integers \\( \leq 0 \\), \\(\lbrace \ldots -3, -2, -1, 0\rbrace\\)                                                                     |
| `NonPositiveNumbers`    | \\[ \R^{0-} \\]    | Real numbers \\( \leq 0 \\)                                                                                                            |
| `Numbers`               |                    | Any number, real or complex                                                                                                            |
| `PositiveIntegers`      | \\[ \Z^{+} \\]     | Integers \\( \gt 0 \\), \\(\lbrace 1, 2, 3\ldots\rbrace\\)                                                                             |
| `PositiveNumbers`       | \\[ \R^{+} \\]     | Real numbers \\( \gt 0 \\)                                                                                                             |
| `RationalNumbers`       | \\[ \mathbb{Q}\\]  | Numbers which can be expressed as the quotient \\(p / q\\) of two integers \\(p, q \in \mathbb{Z}\\).                                  |
| `RealNumbers`           | \\[ \mathbb{R} \\] | Numbers that form the unique Dedekind-complete ordered field \\( \left( \mathbb{R} ; + ; \cdot ; \lt \right) \\), up to an isomorphism |
| `TranscendentalNumbers` | \\[ \mathbb{T} \\] | Real numbers that are not algebraic                                                                                                    |

</div>

### Function Domains

<div class=symbols-table>

| Domain            | Description                                                                                                        |
| :---------------- | :----------------------------------------------------------------------------------------------------------------- |
| `Predicates`      | A function with a codomain of `MaybeBoolean`                                                                       |
| `LogicalFunction` | A predicate whose arguments are in the `MaybeBoolean` domain, for example the domain of `And` is `LogicalFunction` |

</div>

### Other Domains

<div class=symbols-table>

| Domain          | Description                                                                                      |
| :-------------- | :----------------------------------------------------------------------------------------------- |
| `Anything`      | The universal domain, it contains all possible values                                            |
| `Booleans       | `True` or `False`                                                                                |
| `Domains`       | The domain of all the domains                                                                    |
| `MaybeBooleans` | `True` `False` or `Maybe`                                                                        |
| `Nothing`       | The domain whose only member is the symbol `Nothing`                                             |
| `Strings`       | A string of Unicode characters                                                                   |
| `Symbols`       | A string used to represent the name of a constant, variable or function in a MathJSON expression |

</div>
