---
title: MathJSON Format
permalink: /guides/math-json-format/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import { renderMathInDocument } from '//unpkg.com/mathlive/dist/mathlive.mjs';
    renderMathInDocument();
</script>

# MathJSON Format

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
[MathJSON for Latex](/guides/math-json-dictionary/) and the
[Compute Engine](/guides/compute-engine/).

Mathematical notation is used in a broad array of fields, from elementary school
arithmetic, engineering, applied mathematics to physics and more. New notations
are invented regularly and need to be represented. To address those needs
MathJSON is flexible, extensible and customizable. Extensible dictionaries can
be used to define new syntax and new semantic.

MathJSON is not intended to be suitable as a visual representation of arbitrary
mathematical notations, and as such is not a replacement for LaTeX or MathML.

## Examples

| Latex                        | MathJSON                                                                  |
| :--------------------------- | :------------------------------------------------------------------------ |
| $$\frac{a}{1+x}$$            | `["Divide", "a", ["Add", 1, "x"]]`                                        |
| $$e^{\imaginaryI \pi }+1=0$$ | `["Eq", ["Add", ["Power", "E", ["Multiply", "Pi", "ImaginaryI"], 1]], 0]` |
| $$\sin^{-1}\prime(x)$$       | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`                    |

## Structure of a MathJSON Expression

A MathJSON expression is a combination of **numbers**, **symbols** and
**strings**, **functions**, **dictionaries**.

**Number**

```json
3.14
314e-2
{"num": "3.14"}
{"num": "-Infinity"}
```

**Symbol**

```json
"x"
"Pi"
{"sym": "Pi", "wikidata": "Q167" }
```

**Function**

```json
["Add", 1, "x"]
{"fn": [{sym: "Add"}, {num: "1"}, {sym: "x"}]}
```

**Dictionary**

```json
{
  "dict": {
    "hello": 3,
    "world": ["Add", 5, 7]
  }
}
```

**Numbers**, **symbols** and **functions** can be expressed either as an object
literal with a `"num"`, `"sym"` or `"fn"` property, respectively, or as a
short-hand notation using a JSON number, string or array.

The short-hand notation is more concise and easier to read, but cannot include
metadata properties.

## Numbers

A MathJSON **number** is either:

- an object literal
- a JSON number

### Numbers as Object Literals

**Numbers** can be represented as an object literal with a `"num"` key. The
value of the key is a string representation of the number.

```typescript
{
    "num": string
}
```

### JSON numbers

When a **number** has no extra metadata and is compatible with the JSON
representation of numbers, a JSON number can be used.

Specifically:

- the number has to fit in a 64-bit float (IEEE 754-2008, 52-bit, about 15
  digits of precision)
- the number has to be finite (it cannot be `Infinity`, `-Infinity` or `NaN`)

### Examples

```json
0

-234.534e-46

{ "num": "-234.534e-46" }

{ "num": "3.1415926535 8979323846 2643383279 5028841971 6939937510 5820974944" }

{ "num": "-Infinity" }

```

## Symbols and strings

**Strings** are represented by a JSON string that begins and ends with **U+0027
APOSTROPHE** : **`'`**.

```json
"'Hello world'"
```

**Symbols** represent constants and variables.

**Symbols** are arbitrary strings of Unicode characters, except the following:

- **U+0000-U+0020**
- **U+FFFE-U+FFFF**

In addition, the first character of a symbol cannot be:

- **U+0022 QUOTATION MARK** : **`"`**
- **U+0023 NUMBER SIGN** : **`#`**
- **U+0024 DOLLAR SIGN** : **`$`**
- **U+0025 PERCENT** : **`%`**
- **U+0027 APOSTROPHE** : **`'`**
- **U+0040 COMMERCIAL AT** : **`@`**
- **U+0060 GRAVE ACCENT** backtick : **`` ` ``**
- **U+007E TILDE** : **`~`**
- **U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK** : **`«`**
- **U+2018 LEFT SINGLE QUOTATION MARK** : **`‘`**
- **U+201A SINGLE LOW-9 QUOTATION MARK** : **`‚`**
- **U+201C LEFT DOUBLE QUOTATION MARK** : **`“`**
- **U+201E DOUBLE LOW-9 QUOTATION MARK** : **`„`**
- **U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK** : **`‹`**

For symbols, the following naming convention are recommended.

### Patterns

Symbols that begin with **`_`** (**U+005F LOW LINE**) are reserved to denote
pattern matches.

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

The default representations of **functions** is as an object literal with a
`"fn"` key. The value of the key is an array representing the function head and
its arguments.

```typescript
{
    "fn": Expression[]
}
```

The **head** of the function is the first element in the array. Its presence is
required. It indicates the 'function name' or 'what' the function is about.

It frequently is a string, but it can also be another expression.

Following the head are zero or more **arguments** to the function, which are
expressions as well. The **arguments** form the **tail** of the function.

The expression corresponding to $$\sin^{-1}(x)$$ is

```json
[["InverseFunction", "Sin"], "x"]
```

The head of this expression is `["InverseFunction", "Sin"]`, and the argument is
"x".

### JSON array

If a **function** has no extra metadata it can be represented as a JSON array.

For example these two expressions are equivalent:

```json
["Cos", ["Add", "x", 1]]

{ "fn": ["Cos", ["Add", "x", 1]] }
```

## Dictionary

A **dictionary** is a collection of key-value pairs. In some languages it is
called a map or associative array.

The keys are strings and the values are MathJSON expressions.

A **dictionary** is represented as an object literal with a `"dict"` key. The
value of the key is an object literal holding the content of the dictionary.

```json
{
  "dict": {
    "one": 1,
    "two": 2
    "three": ["Add", 1, 2]
  }
}
```

## Metadata

MathJSON object literals can be annotated with supplemental information.

A **number** represented as a JSON number, a **symbol** represented as a string,
or a **function** represented as a JSON array must be transformed into the
equivalent object literal before being annotated.

The following metadata properties are recommended:

| Property        | Note                                                                                                                                                                         |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wikidata`      | A short string indicating an entry in a wikibase.<br>This information can be used to disambiguate the meaning of a symbol                                                    |
| `comment`       | A human readable plain string to annotate an expression, since JSON does not allow comments in its encoding                                                                  |
| `documentation` | A Markdown-encoded string providing documentation about this expression.                                                                                                     |
| `latex`         | A visual representation in LaTeX of the expression. <br> This can be useful to preserve non-semantic details, for example parentheses in an expression or styling attributes |
| `origin-file`   | A file path to the source of this expression                                                                                                                                 |
| `origin-source` | The source from which this expression was generated.<br> It could be a Latex expression, or some other source language.                                                      |
| `origin-line`   | A line number (1-n) in the `origin-source` or `origin-file`                                                                                                                  |
| `origin-column` | A column number (1-n) in the `origin-line`                                                                                                                                   |
| `hash`          | A string representing a digest of this expression.                                                                                                                           |

```json
// The ratio of the circumference of a circle to its diameter
{
  "sym": "Pi",
  "wikidata": "Q167",
  "latex": "\pi"
}

// The greek letter ∏
{
  "sym": "Pi",
  "wikidata": "Q168",
  "comment": "The greek letter π"
}
```
