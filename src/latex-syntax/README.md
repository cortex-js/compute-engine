# MathJSON for Latex

## Translation Dictionary

A **translation dictionary** specifies how a MathJSON expression can be
expressed into a target language (serialization) or constructed from a source
language (parsing).

## Function/Symbol Dictionary

The **vocabulary** used by a MathJSON expression is defined in a dictionary.

A dictionary entry specifies the name of the symbol along with additional
information in order to correctly interpret it: are they associative or
commutative, are they a constant or a variable, is there a wikidata entry that
further defines them, etc...

When manipulating a MathJSON expression, a dictionary can be provided to
correctly interpret that expression. This is an opportunity to define
specialized vocabularies for different scientific fields, for example a
dictionary that would include advanced statistical functions, or physical
constants.

## Default Dictionary

If no custom dictionary is provided, the following default dictionary should be
used.

## Domains

A domain is roughly a combination of a type in traditional programming language
and an "assumption" in some CAS software.

### Core

#### `BaseForm`

`["BaseForm", _value_, _base_]`

Format a _value_ in a specific _base_, such as hexadecimal or binary.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

| MathJSON               | Latex                |
| :--------------------- | :------------------- |
| `["BaseForm", 42, 16]` | `(\mathtt(2a))_{16}` |

#### `Derivative`

`["Latex", _expression_, _order_]`

- _order_: default value is 1.

| MathJSON                   | Latex            |
| :------------------------- | :--------------- |
| `["Derivative", "f"]`      | `f^\prime`       |
| `["Derivative", "f", 2]`   | `f^\doubleprime` |
| `["Derivative", "f", "n"]` | `f^{(n)}`        |

#### `Latex`

`["Latex", _token-1_, _token-2_, ..._token-n_]`

- _token-n_: one or more expressions that are serialized and concatenated as  
  Latex tokens. A Latex token is one of:
  - `<{>`: begin group
  - `<}>`: end group
  - `<space>`: blank space
  - `<$$>`: display mode shift
  - `<$>`: inline mode shift
  - `#0`-`#9`: argument
  - `#?`: placeholder
  - `\` + string: a command
  - other: literal

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

| MathJSON                                                    | Latex           |
| :---------------------------------------------------------- | :-------------- |
| `["Latex", "\frac", "<{>", "\pi","<}>", "<{>", "2", "<}>"]` | `\frac{\pi}{2}` |

#### `List`

An ordered collection of elements.

Use to represent a data structure, as opposed to `Group` or `Sequence`.

| MathJSON                        | Latex           |
| :------------------------------ | :-------------- |
| `["List", "x", "y", "7", "11"]` | `[x, y, 7, 11]` |

#### `Piecewise`

#### `Group`

One or more expressions in a sequence.

Use to represent function arguments, or to group arithmetic expressions.

| MathJSON                         | Latex           |
| :------------------------------- | :-------------- |
| `["Group", "x", "y", "7", "11"]` | `(x, y, 7, 11)` |

#### `Identity`

The identity function, i.e. its value is its argument.

| MathJSON            | Latex                  |
| :------------------ | :--------------------- |
| `["Identity", "x"]` | `\operatorname{id}(x)` |
| `"Identity"`        | `\operatorname{id}`    |

#### `InverseFunction`

The inverse function.

| MathJSON                     | Latex       |
| :--------------------------- | :---------- |
| `["InverseFunction", "Sin"]` | `\sin^{-1}` |

#### `Missing`

#### `Nothing`

#### `Prime`

| MathJSON            | Latex            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |

#### `Sequence`

| MathJSON                                    | Latex     |
| :------------------------------------------ | :-------- |
| `["Sequence", "x", "y"]`                    | `x, y`    |
| `["Sequence", ["Sequence", "a", "b"], "y"]` | `a, b; y` |

#### `Set`

| MathJSON            | Latex                 |
| :------------------ | :-------------------- |
| `["Set", "x", "y"]` | `\lbrace x, y\rbrace` |

#### `Subscript`

#### `Subplus`

| MathJSON           | Latex |
| :----------------- | :---- |
| `["Subplus", "x"]` | `x_+` |

#### `Subminus`

| MathJSON            | Latex |
| :------------------ | :---- |
| `["Subminus", "x"]` | `x_-` |

#### `Substar`

| MathJSON           | Latex |
| :----------------- | :---- |
| `["Substar", "x"]` | `x_*` |

#### `Superdagger`

| MathJSON               | Latex       |
| :--------------------- | :---------- |
| `["Superdagger", "x"]` | `x^\dagger` |

#### `Superminus`

| MathJSON              | Latex |
| :-------------------- | :---- |
| `["Superminus", "x"]` | `x^-` |

#### `Superplus`

| MathJSON             | Latex |
| :------------------- | :---- |
| `["Superplus", "x"]` | `x^+` |

#### `Superstar`

When the first argument is a complex number, indicate the conjugate.

| MathJSON             | Latex |
| :------------------- | :---- |
| `["Superplus", "x"]` | `x^*` |

### Categories

The dictionaries are organized in categories:

- algebra
- arithmetic
- calculus
- core
- inequalities
- other
- symbols
- trigonometry
- sets

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
