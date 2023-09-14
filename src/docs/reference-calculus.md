---
title: Calculus
permalink: /compute-engine/reference/calculus/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

### Functions

{% defs "Function" "Operation" %} {% def "Integrate" %} <code>["Integrate",
_expression_]</code>

<code>["Integrate", _expression_, _symbol_]</code>

Indefinite integral

`["Integrate", ["Sin", "x"], "x"]`

$$ \int \sin x \\,\operatorname{d}x $$

---

<code>["Integrate", _expression_, _predicate_]</code>

Definite integral.

`["Integrate", ["Sin", "x"], ["Element", "x", ["Interval", 0, +Infinity]]]`

$$ \int_0^\infty \sin x \\,\operatorname{d}x $$

---

<code>["Integrate", _expression_, _predicate1_, _predicate2_...]</code>

Multiple integral.

`["Integrate", ['"Multiply", "x", ["Sin", "y"]], ["Element", "x", ["Interval", 0, 2]], ["Element", "y", ["Interval", 0, 1]]]`

$$ \int_0^1 \int_0^2 x\sin y \\,\operatorname{d}x\\,\operatorname{d}y $$

{% enddef %}

{% def "D" %}

<code>["D", _f_, _x_]</code>

Evaluate to the partial derivative \\( \frac{\partial f}{\partial x} \\) or \\(
f^{\prime}(x) \\)

---

<code>["D", _f_, ["Tuple", _x_, _n_]]</code>

Evaluate to the multiple derivative \\( \frac{\partial^n f}{\partial x^n} \\)
(Leibniz notation) or \\( f^{(n)}(x) \\) (Lagrange notation)

{% enddef %}

{% enddefs %}

### Lagrange Notation

| LaTeX                 | MathJSON          |
| :-------------------- | :---------------- |
| `f'(x)`               | `["D", "f", "x"]` |
| `f''(x)`              |                   |
| `f\prime(x)`          |                   |
| `f\prime\prime(x)`    |                   |
| `f\doubleprime(x)`    |                   |
| `f^{\prime}(x)`       |                   |
| `f^{\prime\prime}(x)` |                   |
| `f^{\doubleprime}(x)` |                   |

@todo: `f^{(4)}`

## Leibniz Notation

| LaTeX                                       | MathJSON |
| :------------------------------------------ | :------- |
| `\frac{\partial f}{\partial x}`             |          |
| `\frac{\partial^2 f}{\partial x\partial y}` |

## Euler Modified Notation

This notation is used by Mathematica. The Euler notation uses `D` instead of
`\partial`

| LaTeX              | MathJSON |
| :----------------- | :------- |
| `\partial_{x} f`   |          |
| `\partial_{x,y} f` |          |

## Newton Notation (@todo)

`\dot{v}` -> first derivative relative to time t `\ddot{v}` -> second derivative
relative to time t

### Integral

## Indefinite Integral

`\int f dx` -> ["Integrate", "f", "x"]

`\int\int f dxdy` -> ["Integrate", "f", "x", "y"]

Note: `["Integrate", ["Integrate", "f" , "x"], "y"]` is equivalent to
`["Integrate", "f" , "x", "y"]`

## Definite Integral

`\int_{a}^{b} f dx` -> ["Integrate", f, [x, a, b]]
`\int_{c}^{d} \int_{a}^{b} f dxdy` -> ["Integrate", "f", ["Triple", "x", "a",
"b"], ["Triple", "y", "c", "d"]]

`\int_{a}^{b}\frac{dx}{f}` -> ["Integrate", ["Power", "f", -1], ["Triple", "x",
"a", "b"]]

`\int_{a}^{b}dx f` -> ["Integrate", "f", ["Triple", "x", "a", "b"]]

If `[a, b]` are numeric, numeric methods are used to approximate the integral.

## Domain Integral

`\int_{x\in D}` -> ["Integrate", f, ["In", x, D]]

### Contour Integral

`\oint f dx` -> `["ContourIntegral", "f", "x"]`

`\varointclockwise f dx` -> `["ClockwiseContourIntegral", "f", "x"]`

`\ointctrclockwise f dx` -> `["CounterclockwiseContourIntegral", "f", "x"]`

`\oiint f ds` -> `["DoubleCountourIntegral", "f", "s"]` : integral over closed
surfaces

`\oiiint` f dv -> `["TripleCountourIntegral", "f", "v"]` : integral over closed
volumes

`\intclockwise`

`\intctrclockwise`

`\iint`

`\iiint`
