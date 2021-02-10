# MathJSON for Latex

The MathJSON format is independent of any particular syntactic representation.

This document describes the default parser that transforms a Latex formula into
a MathJSON expression.

### Sequence

A sequence is a collection of expressions separated by a `,` or a `;`.

| Latex        | MathJSON                                                     |
| :----------- | :----------------------------------------------------------- |
| `a, b, c`    | `["Sequence", "a", "b", "c"]`                                |
| `a, b; x`    | `["Sequence", ["Sequence", "a", "b"], "x"]`                  |
| `a; b`       | `["Sequence", ["Sequence", "a"], ["Sequence", "b"]]`         |
| `a, b; c, d` | `["Sequence", ["Sequence["a", "b"], ["Sequence", "c", "d"]]` |

### Group

| Latex          | MathJSON                                                    |
| :------------- | :---------------------------------------------------------- |
| `()`           | `["Group"]`                                                 |
| `(a, b, c)`    | `["Group", "a", "b", "c"]`                                  |
| `(a, b; c, d)` | `["Group", ["Sequence", "a", "b"], ["Sequence", "c", "d"]]` |
| `a, (b, c)`    | `["Sequence", "a", ["Group", "b", "c"]]`                    |

### List

`[a, b, c]`

List with missing element: `[a, , c]` -> ["a", "Nothing", "c"]

### Set

`\lbrack a, b, c\rbrack`

### Derivative

### Lagrange Notation

| Latex                 | MathJSON           |
| :-------------------- | :----------------- |
| `f'(x)`               | `["Derive", f, x]` |
| `f''(x)`              |                    |
| `f\prime(x)`          |                    |
| `f\prime\prime(x)`    |                    |
| `f\doubleprime(x)`    |                    |
| `f^{\prime}(x)`       |                    |
| `f^{\prime\prime}(x)` |                    |
| `f^{\doubleprime}(x)` |                    |

@todo: `f^{(4)}`

#### Leibniz Notation

| Latex                                       | MathJSON |
| :------------------------------------------ | :------- |
| `\frac{\partial f}{\partial x}`             |          |
| `\frac{\partial^2 f}{\partial x\partial y}` |

#### Euler Modified Notation

This notation is used by Mathematica. The Euler notation uses `D` instead of
`\partial`

| Latex              | MathJSON |
| :----------------- | :------- |
| `\partial_{x} f`   |          |
| `\partial_{x,y} f` |          |

#### Newton Notation (@todo)

`\dot{v}` -> first derivative relative to time t `\ddot{v}` -> second derivative
relative to time t

### Integral

#### Indefinite Integral

`\int f dx` -> ["Integrate", f, x,] `\int\int f dxdy` -> ["Integrate", f, x, y]

Note: `["Integrate", ["Integrate", f , x], y]` is equivalent to
`["Integrate", f , x, y]`

#### Definite Integral

`\int_{a}^{b} f dx` -> ["Integrate", f, [x, a, b]]
`\int_{c}^{d} \int_{a}^{b} f dxdy` -> ["Integrate", f, [x, a, b], [y, c, d]]

`\int_{a}^{b}\frac{dx}{f}` -> ["Integrate", ["Power", f, -1], [x, a, b]]

`\int_{a}^{b}dx f` -> ["Integrate", f, [x, a, b]]

If `[a, b]` are numeric, numeric methods are used to approximate the integral.

#### Domain Integral

`\int_{x\in D}` -> ["Integrate", f, ["In", x, D]]

### Contour Integral

`\oint f dx` -> ["ContourIntegral", f, x,] `\varointclockwise f dx` ->
["ClockwiseContourIntegral", f, x] `\ointctrclockwise f dx` ->
["CounterclockwiseContourIntegral", f, x,]

`\oiint f ds` -> ["DoubleCountourIntegral", f, s] : integral over closed
surfaces

`\oiiint` f dv -> ["TripleCountourIntegral", f, v] : integral over closed
volumes

`\intclockwise` `\intctrclockwise`

`\iint` `\iiint`
