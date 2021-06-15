---
title: MathJSON Format
permalink: /guides/math-json/format/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import { renderMathInDocument } from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({ 
      renderAccessibleContent: false,
      TeX: { 
        delimiters: {
          inline: [['\\(', '\\)']],
          display: [ ['$$', '$$'], ['\\[', '\\]']],
        },
        processEnvironments : false 
      },
      asciiMath: null,
    });
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
[MathJSON for Latex](/guides/compute-engine/dictionaries/) and the
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

A MathJSON expression is a combination of **numbers**, **strings**, **symbols**,
**functions** and **dictionaries**.

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

**String**

```json
"'Diameter of a circle'"
{"str": "Radius" }
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

**Numbers**, **symbols**, **strings** and **functions** can be expressed either
as an object literal with a `"num"`, `"str"`, `"sym"` or `"fn"` key,
respectively, or as a short-hand notation using a JSON number, string or array.

The short-hand notation is more concise and easier to read, but cannot include
metadata properties.

## Numbers

A MathJSON **number** is either:

- an object literal with a `"num"` key
- a JSON number

### Numbers as Object Literals

**Numbers** can be represented as an object literal with a `"num"` key. The
value of the key is a string representation of the number.

```typescript
{
    "num": string
}
```

The string representing a number follows the
[JSON syntax for number](https://tools.ietf.org/html/rfc7159#section-6).

### JSON numbers

When a **number** has no extra metadata and is compatible with the JSON
representation of numbers, a JSON number can be used.

Specifically:

- the number has to be in the range $$[-(2^{53})+1, (2^{53})-1]$$ to fit in a
  64-bit float (**IEEE 754-2008**, 52-bit, about 15 digits of precision).
- the number has to be finite: it cannot be `Infinity`, `-Infinity` or `NaN`.

### Examples

```json
0

-234.534e-46

{ "num": "-234.534e-46" }

{
  "num":
    "3.141592653589793238462643383279502884197169399375105"
}

{ "num": "-Infinity" }

```

## Strings

A MathJSON **string** is either

- an object literal with a `"str"` key
- a [JSON string](https://tools.ietf.org/html/rfc7159#section-7) that starts and
  ends with **U+0027 APOSTROPHE** : **`'`**.

Strings can contain any character represented by a Unicode scalar value (in the
\[0...0x10FFFF\] range, except for \[0xD800...0xDFFF\]), but the following
characters must be escaped as indicated:

- **U+0000** to **U+001F**: `\u0000` to `\u001f`
- **U+0008**, Backspace: `\b` or `\u0008`
- **U+0009**, Tab : `\t` or `\u0009`
- **U+000a**, Line feed: `\n` or `\u000a`
- **U+000c**, Form Feed: `\f` or `\u000c`
- **U+000d**, Carriage Return: `\r` or `\u000d`
- **U+005c**, Backslash/Reverse Solidus: `\\` or `\u005c`
- **U+0022**, Quotation mark: `\"` or `\u0022`

The encoding of the string follows the encoding of the JSON payload: UTF-8,
UTF-16LE, UTF-16BE, etc...

```json
"'Hello world'"
```

## Symbols

A MathJSON **symbol** is either:

- an object literal with a `"sym"` key
- a JSON string

**Symbols** are identifiers that represent the name of constants, variables and
functions.

Symbols are strings of valid Unicode characters, except:

- **U+0000** to **U+0020**
- **U+0022 DOUBLE QUOTE**: **`"`**
- **U+005C REVERSE SOLIDUS** : **`\`**
- **U+0060 GRAVE ACCENT** backtick : **`` ` ``**
- **U+FFFE**
- **U+FFFF**

In addition, the first character of a symbol should not be:

- **U+0021 EXCLAMATION MARK** : **`!`**
- **U+0022 QUOTATION MARK** : **`"`**
- **U+0023 NUMBER SIGN** : **`#`**
- **U+0024 DOLLAR SIGN** : **`$`**
- **U+0025 PERCENT** : **`%`**
- **U+0026 AMPERSAND** : **`&`**
- **U+0027 APOSTROPHE** : **`'`**
- **U+0028 LEFT PARENTHESIS** : **`(`**
- **U+0029 RIGHT PARENTHESIS** : **`)`**
- **U+002E FULL STOP** : **`'`**
- **U+003A COLON** : **`:`**
- **U+003C LESS THAN SIGN** : **`:`**
- **U+003F QUESTION MARK** : **`?`**
- **U+0040 COMMERCIAL AT** : **`@`**
- **U+005B LEFT SQUARE BRACKET** : **`[`**
- **U+005D RIGHT SQUARE BRACKET** : **`]`**
- **U+005E CIRCUMFLEX ACCENT** : **`^`**
- **U+007B LEFT CURLY BRACKET** : **`{`**
- **U+007D RIGHT CURLY BRACKET** : **`}`**
- **U+007E TILDE** : **`~`**

Before they are used, symbols are normalized to the Unicode Normalization Form C
(NFC). They must be stored internally and compared using the NFC.

JSON escape sequences are applied before Unicode normalization.

These four strings represent the same symbol:

- `"Å"`
- `"A\u030a"`
- `"\u00c5"` **LATIN CAPITAL LETTER A WITH RING ABOVE** ("Å") and
- `"\u0041\u030a"` **LATIN CAPITAL LETTER A** + **COMBINING RING ABOVE** ("A‌ ̊")

The following naming convention are recommended.

### Patterns

Symbols that begin with **`_`** (**U+005F LOW LINE**, underscore) are reserved
to denote wildcards and other placeholders.

### Variables

- The first character of a variable should be a lowercase or uppercase letter
  (`a`-`z` or `A`-`Z`)
- Subsequent characters should be a letter, digit (`0`-`9`) or underscore (`_`).

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

### Constants

- The first character of a constant should be an uppercase letter (`A`-`Z`)
- Subsequent characters should be a letter, digit (`0`-`9`) or underscore (`_`).
- If a constant is made up of several words, use camelCase, e.g. `SpeedOfLight`

## Functions

A MathJSON function is either:

- an object literal with a `"fn"` key.
- a JSON array

### Functions as Object Literal

The default representation of **functions** is as an object literal with a
`"fn"` key. The value of the key is an array representing the function head and
its arguments.

```typescript
{
    "fn": Expression[]
}
```

The **head** of the function is the first element in the array. Its presence is
required. It indicates the 'function name' or 'what' the function is about.

The head is frequently is a string, but it can also be another expression.

Following the head are zero or more **arguments**, which are expressions as 
well. The arguments form the **tail** of the function.

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
{ "fn": ["Cos", ["Add", "x", 1]] }

["Cos", ["Add", "x", 1]]
```

## Dictionary

A **dictionary** is a collection of key-value pairs. In some progamming 
languages it is called a map or associative array.

The keys are strings and the values are MathJSON expressions.

A **dictionary** is represented as an object literal with a `"dict"` key. The
value of the key is a JSON object literal holding the content of the dictionary.

```json
{
  "dict": {
    "first": 1,
    "second": 2,
    "third": ["Add", 1, 2]
  }
}
```

## Metadata

MathJSON object literals can be annotated with supplemental information.

A **number** represented as a JSON number, a **symbol** represented as a JSON
string, or a **function** represented as a JSON array must be transformed into
the equivalent object literal before being annotated.

The following metadata keys are recommended:

<div class=symbols-table>

| Key             | Note                                                                                                                                                                         |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wikidata`      | A short string indicating an entry in a wikibase.<br>This information can be used to disambiguate the meaning of a symbol                                                    |
| `comment`       | A human readable plain string to annotate an expression, since JSON does not allow comments in its encoding                                                                  |
| `documentation` | A Markdown-encoded string providing documentation about this expression.                                                                                                     |
| `latex`         | A visual representation in LaTeX of the expression. <br> This can be useful to preserve non-semantic details, for example parentheses in an expression or styling attributes |
| `sourceUrl`     | A URL to the source of this expression                                                                                                                                       |
| `sourceContent` | The source from which this expression was generated.<br> It could be a Latex expression, or some other source language.                                                      |
| `sourceOffsets` | A pair of character offsets in `sourceContent` or `sourceUrl` from which this expression was produced                                                                       |
| `hash`          | A string representing a digest of this expression.                                                                                                                           |
</div>

```json
// The ratio of the circumference of a circle to its diameter
{
  "sym": "Pi",
  "wikidata": "Q167",
  "latex": "\\pi"
}

// The greek letter ∏
{
  "sym": "Pi",
  "wikidata": "Q168",
  "comment": "The greek letter π"
}
```
