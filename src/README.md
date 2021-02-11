# MathJSON

The MathJSON format is a lightweight data interchange format for mathematical
notation.

MathJSON is built on the [JSON format](https://www.json.org/). Its focus is on
interoperability between software programs to facilitate the exchange of
mathematical data, as well as the building of scientific software through the
integration of software components communicating with a common format.

It is human-readable, while being easy for machines to generate and parse. It is
simple enough that it can be generated, consumed and manipulated using any
programming languages.

MathJSON can be transformed from (parsing) and to (serialization) other formats,
using a syntax specific to those formats.

The MathJSON library provides an implementation in Javascript/Typescript of
utilities that parse Latex to MathJSON, serialize MathJSON to Latex, and provide
a collection of functions for symbolic manipulation and numerical evaluations of
MathJSON expressions. Read more about
[MathJSON for Latex](./latex-syntax/README.md) and the
[Compute Engine](./compute-engine/README.md).

Mathematical notation is used in a broad array of fields, from elementary school
arithmetic, engineering, applied mathematics to physics and more. New notations
are invented regularly and need to be represented. To address those needs
MathJSON is flexible, extensible and customizable. Extensible dictionaries give

MathJSON is not intended to be suitable as a visual representation of arbitrary
mathematical notations, and as such is not a replacement for LaTeX or MathML.

## Examples

| Latex                      | mathJSON                                                                  |
| :------------------------- | :------------------------------------------------------------------------ |
| `\frac{a}{1+x}`            | `["Divide", "a", ["Add", 1, "x"]]`                                        |
| `e^{\imaginaryI \pi }+1=0` | `["Eq", ["Power", "E", ["Add", ["Multiply", "Pi", "ImaginaryI"], 1]], 0]` |
| `\sin^{-1}\prime(x)`       | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`                    |

## Structure of a MathJSON Expression

A MathJSON expression is a combination of

- numbers
- symbols and strings
- functions

| **Number**             |
| :--------------------- |
| `3.14`                 |
| `314.e-2`              |
| `{"num": "3.14"}`      |
| `{"num": "-Infinity"}` |

| **Symbol**                           |
| :----------------------------------- |
| `"x"`                                |
| `"Pi"`                               |
| `{"sym": "Pi", "wikidata": "Q167" }` |

| **Function**                                     |
| :----------------------------------------------- |
| `["Add", 1, "x"]`                                |
| `{"fn": [{sym: "Add"}, {num: "1"}, {sym: "x"}]}` |

Numbers, symbols and functions can be expressed either as an object literal with
a `"num"`, `"sym"` or `"fn"` property, respectively, or as a short-hand notation
using a number, string or array. The short-hand notation is more concise and
easier to read, but cannot include metadata properties.

## Numbers

A MathJSON number is either:

- an object literal
- a JSON number

### Numbers as Object Literals

Numbers can be represented as an object literal with a `"num"` key. The value of
the key is a string representation of the number.

```typescript
{
    "num": string
}
```

### JSON numbers

When a number has no extra metadata and is compatible with the JSON
representation of numbers, a `number` can be used.

Specifically:

- the number has to fit in a 64-bit float (IEEE 754-2008, about 15 digits of
  precision)
- the number has to be finite (it cannot be `Infinity`, `-Infinity` or `NaN`)

### Examples

```json
0

-234.534e-46

{ "num": "-234.534e-46" }

{ "num": "3.1415926535 8979323846 2643383279 5028841971 6939937510 5820974944 5923078164 0628620899 8628034825 3421170679 8214808651 3282306647 0938446095 5058223172 5359408128 4811174502 8410270193 8521105559 6446229489 5493038196 4428810975 6659334461 2847564823 3786783165 2712019091 4564856692 3460348610 4543266482 1339360726 0249141273 7245870066 0631558817 4881520920 9628292540 9171536436 7892590360 0113305305 4882046652 1384146951 9415116094 3305727036 5759591953 0921861173 8193261179 3105118548 0744623799 6274956735"
}

{ "num": "-Infinity" }

```

## Symbols and strings

Symbols represent constants and variables.

Symbols are represented as arbitrary strings of Unicode characters, except
**U+0020 (SPACE)**. However, the following naming convention are recommended.

### Naming Convention for Variables

- First character should match `/[a-zA-Z]/`
- Subsequent characters should match `/[a-zA-Z0-9_-]/`

  So for example use, `Gamma` rather than `ɣ` and `Total` rather than `∑`
  (**U+2211 N-ARY SUMMATION**), which looks like `Σ` (**U+03A3 GREEK CAPITAL
  LETTER SIGMA**). This visual ambiguity of some Unicode symbols frequently used
  in math is why we recommend a more restricted character set.

- If a variable is made of several words, use camelCase, i.e. `newDeterminant`
- Prefer clarity over brevity and avoid obscure abbreviations.

  Use `newDeterminant` rather than `newDet` or `nDet`

- The following variables are usually real numbers: `x`, `y`, `t`
- The following variables are usually integers: `i`, `n`, `p`, `q`
- The following variables are usually complex numbers: `z`, `w`
- The following variables are usually lists: `xs`, `ys`, `ns`

### Naming Convention for Constants

- First character of constants should match: `/[A-Z]/`
- Subsequent characters of constants should match: `/[a-zA-Z0-9_]/`
- If a constant is made up of several words, use camelCase, e.g. `SpeedOfLight`

## Functions

A MathJSON function is either:

- an object literal
- a JSON array

### Functions as Object Literal

The default representations of functions is as an object literal with a `"fn"`
key. The value of the key is an array representing the function head and its
arguments.

```typescript
{
    "fn": Expression[]
}
```

The **head** of the function is the first element in the array. Its presence is
required. It indicates the 'function name' or 'what' the function is about.

It frequently is a string, but it can also be another expression.

Following the head are zero or more **arguments** to the function, which are
expressions as well.

For example in `\sin^{-1}(x)`, the corresponding expression is
`[["InverseFunction", "Sin"], "x"]`, the head is `["InverseFunction", "Sin"]`,
and the argument is "x".

### JSON array

If a function has no extra metadata it can be represented as a JSON array.

For example these two expressions are equivalent:

```json
["Cos", ["Add", "x", 1]]

{ "fn": ["Cos", ["Add", "x", 1]] }
```

## Metadata

MathJSON object literals can be annotated with supplemental information. If a
number represented as a JSON number or a symbol represented as a string needs to
be annotated, they must be transformed into the equivalent object literal first.

The following properties are recommended to represent metadata:

| Property   | Example  | Note                                                                                                                                                                    |
| :--------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wikidata` | `"Q167"` | A short string indicating an entry in a wikibase. This information can be used to disambiguate the meaning of a symbol                                                  |
| `comment`  |          | A human readable string to annotate an expression, since JSON does not allow comments in its encoding                                                                   |
| `latex`    | `"\pi"`  | A visual representation in LaTeX of the expression. This can be useful to preserve non-semantic details, for example parentheses in an expression or styling attributes |

## Next

- The [MathJSON API documentation](API.md)
- The [Latex Syntax](./latex-syntax/README.md) (default dictionary)
