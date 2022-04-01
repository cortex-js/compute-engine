---
title: MathJSON Format
permalink: /math-json/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<img src='/assets/MathJSON-1.jpg' class='full-width' style='border-radius:8px 8px 0 0; border:1px solid #203346; margin-bottom: 2em'>

The MathJSON format is a lightweight data interchange format for mathematical
notation.

<div class=symbols-table>

| Math                           | MathJSON                                                                 |
| :----------------------------- | :----------------------------------------------------------------------- |
| \\[\frac{n}{1+n}\\]            | `["Divide", "n", ["Add", 1, "n"]]`                                       |
| \\[e^{\imaginaryI \pi }+1=0\\] | `["Equal", ["Add", ["Exp", ["Multiply", "Pi", "ImaginaryUnit"], 1]], 0]` |
| \\[\sin^{-1}^\prime(x)\\]      | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`                   |

</div>

MathJSON is built on the [JSON format](https://www.json.org/). Its focus is on
interoperability between software programs to facilitate the exchange of
mathematical data and the building of scientific software through the
integration of software components communicating with a common format.

It is human-readable, while being easy for machines to generate and parse. It is
simple enough that it can be generated, consumed and manipulated using any
programming languages.

MathJSON can be transformed from (parsing) and to (serialization) other formats,
using a syntax specific to those formats.

The **Cortex Compute Engine** library provides an implementation in
JavaScript/TypeScript of utilities that parse LaTeX to MathJSON, serialize
MathJSON to LaTeX, and provide a collection of functions for symbolic
manipulation and numeric evaluations of MathJSON expressions.

{% readmore "/compute-engine/guides/dictionaries/" %} Read more about
<strong>MathJSON for LaTeX</strong> {% endreadmore %}

{% readmore "/compute-engine/" %} Read more about the <strong>Compute
Engine</strong> {% endreadmore %}

Mathematical notation is used in a broad array of fields, from elementary school
arithmetic, engineering, applied mathematics to physics and more. New notations
are invented regularly and need to be represented with MathJSON. To address
those needs MathJSON is flexible, extensible and customizable. Extensible
dictionaries can be used to define new syntax and new semantic.

MathJSON is not intended to be suitable as a visual representation of arbitrary
mathematical notations, and as such is not a replacement for LaTeX or MathML.

## Structure of a MathJSON Expression

A MathJSON expression is a combination of **numbers**, **symbols**, **strings**,
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
as an object literal with a `"num"` `"str"` `"sym"` or `"fn"` key, respectively,
or as a shorthand notation using a JSON number, string or array.

**Dictionaries** do not have a shorthand notation and are always expressed as an
object literal with a `"dict"` key.

The shorthand notation is more concise and easier to read, but cannot include
metadata properties.

## Numbers

A MathJSON **number** is either:

- an object literal with a `"num"` key
- a JSON number

### Numbers as Object Literals

**Numbers** can be represented as an object literal with a `"num"` key. The
value of the key is a **string** representation of the number.

```typescript
{
    "num": string
}
```

The string representing a number follows the
[JSON syntax for number](https://tools.ietf.org/html/rfc7159#section-6), with
the following differences:

- The range or precision of MathJSON numbers may be greater than the range and
  precision supported by [IEEE 754](https://en.wikipedia.org/wiki/IEEE_754)
  64-bit float.

- The values `NaN` `+Infinity` and `-Infinity` are used to represent an
  undefined result, as per [IEEE 754](https://en.wikipedia.org/wiki/IEEE_754),
  positive infinity and negative infinity, respectively.

- If the string ends with the pattern `/\([0-9]+\)/` (that is a series of one or
  more digits enclosed in parentheses), that pattern should be interpreted as
  repeating digits.

```json
{  "num": "1.(3)" }
{  "num": "0.(142857)" }
```

- The following characters in the string are ignored:

<div class=symbols-table>

|            |                       |
| :--------- | :-------------------- |
| **U+0009** | **TAB**               |
| **U+000A** | **LINE FEED**         |
| **U+000B** | **VERTICAL TAB**      |
| **U+000C** | **FORM FEED**         |
| **U+000D** | **CARRIAGE RETURN**   |
| **U+0020** | **SPACE**             |
| **U+00A0** | **UNBREAKABLE SPACE** |

</div>

### JSON numbers

When a **number** has no extra metadata and is compatible with the JSON
representation of numbers, a JSON number can be used.

Specifically:

- the number is in the range \\([-(2^{53})+1, (2^{53})-1]\\) to fit in a 64-bit
  float (**IEEE 754-2008**, 52-bit, about 15 digits of precision).
- the number is finite: it cannot be `+Infinity` `-Infinity` or `NaN`.

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
  ends with **U+0027 APOSTROPHE** `'`.

Strings can contain any character represented by a Unicode scalar value (a
codepoint in the `[0...0x10FFFF]` range, except for `[0xD800...0xDFFF]`), but
the following characters must be escaped as indicated:

<div class=symbols-table>

| Codepoint                | Name                            | Escape Sequence      |
| :----------------------- | :------------------------------ | :------------------- |
| **U+0000** to **U+001F** |                                 | `\u0000` to `\u001f` |
| **U+0008**               | **BACKSPACE**                   | `\b` or `\u0008`     |
| **U+0009**               | **TAB**                         | `\t` or `\u0009`     |
| **U+000A**               | **LINE FEED**                   | `\n` or `\u000a`     |
| **U+000C**               | **FORM FEED**                   | `\f` or `\u000c`     |
| **U+000D**               | **CARRIAGE RETURN**             | `\r` or `\u000d`     |
| **U+005C**               | **REVERSE SOLIDUS** (backslash) | `\\` or `\u005c`     |
| **U+0022**               | **QUOTATION MARK**              | `\"` or `\u0022`     |

</div>

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

Symbols are strings of valid Unicode characters, including Greek, Cyrillic,
Hebrew, Arabic, mathematical symbols, ideographic and CJK symbols and emojis,
except:

<div class=symbols-table>

| Codepoint                | Name                         |         |
| :----------------------- | :--------------------------- | :------ |
| **U+0000** to **U+0020** |                              |         |
| **U+0022**               | **QUOTATION MARK**           | `"`     |
| **U+0060**               | **GRAVE ACCENT**<br>backtick | `` ` `` |
| **U+FFFE**               | **BYTE ORDER MARK**          |         |
| **U+FFFF**               | **INVALID BYTE ORDER MARK**  |         |

</div>

In addition, the first character of a symbol must not be:

<div class=symbols-table>

| Codepoint  | Name                     |     |
| :--------- | :----------------------- | :-- |
| **U+0021** | **EXCLAMATION MARK**     | `!` |
| **U+0022** | **QUOTATION MARK**       | `"` |
| **U+0024** | **DOLLAR SIGN**          | `$` |
| **U+0025** | **PERCENT**              | `%` |
| **U+0026** | **AMPERSAND**            | `&` |
| **U+0027** | **APOSTROPHE**           | `'` |
| **U+0028** | **LEFT PARENTHESIS**     | `(` |
| **U+0029** | **RIGHT PARENTHESIS**    | `)` |
| **U+002E** | **FULL STOP**            | `.` |
| **U+003A** | **COLON**                | `:` |
| **U+003F** | **QUESTION MARK**        | `?` |
| **U+0040** | **COMMERCIAL AT**        | `@` |
| **U+005B** | **LEFT SQUARE BRACKET**  | `[` |
| **U+005D** | **RIGHT SQUARE BRACKET** | `]` |
| **U+005E** | **CIRCUMFLEX ACCENT**    | `^` |
| **U+007B** | **LEFT CURLY BRACKET**   | `{` |
| **U+007D** | **RIGHT CURLY BRACKET**  | `}` |
| **U+007E** | **TILDE**                | `~` |

</div>

Before they are used, symbols are normalized to the
[Unicode Normalization Form C (NFC)](https://unicode.org/reports/tr15/). They
must be stored internally and compared using the NFC.

JSON escape sequences are applied before Unicode normalization.

These four strings represent the same symbol:

- `"Å"`
- `"A\u030a"`
- `"\u00c5"` **LATIN CAPITAL LETTER A WITH RING ABOVE** `Å` and
- `"\u0041\u030a"` **LATIN CAPITAL LETTER A** + **COMBINING RING ABOVE** `A‌` +
  ` ̊`

The following naming convention for wildcards, variables, constants and
functions are recommendations.

### Wildcards

Symbols that begin with **U+005F LOW LINE** `_` (underscore) should be used to
denote wildcards and other placeholders:

<div class=symbols-table>

| Wildcard |                                              |
| :------- | :------------------------------------------- |
| `_`      | Wildcard for a single symbol                 |
| `__`     | Wildcard for a sequence of 1 or more symbols |
| `___`    | Wildcard for a sequence of 0 or more symbols |
| `_a`     | Capturing wildcard named `a`                 |

</div>

### Variables

- The first character of a variable should be a lowercase or uppercase letter
  (`a`-`z` or `A`-`Z`)
- Subsequent characters should be a letter, digit (`0`-`9`) or underscore (`_`).

  For example, it is recommended to use `gamma` rather than `ɣ` and `Total`
  rather than **U+2211 N-ARY SUMMATION** `∑`, which can be confused with
  **U+03A3 GREEK CAPITAL LETTER SIGMA** `Σ`.

  Using a more limited set of common characters avoids visual ambiguity issues
  that might otherwise arise with some Unicode symbols.

- If a variable is made of several words, use camelCase, i.e. `newDeterminant`

- Prefer clarity over brevity and avoid obscure abbreviations.

  Use `newDeterminant` rather than `newDet` or `nDet`

### Constants

- The first character of a constant should be an uppercase letter `A`-`Z`
- Subsequent characters should be a letter, digit `0`-`9` or underscore `_`.
- If a constant is made up of several words, use camelCase, e.g. `SpeedOfLight`

### Rendering Conventions

The following recommendations may be followed by clients displaying MathJSON
symbols. They do not affect computation or manipulation of expressions following
these conventions.

- Multi-letter variables, that is symbols with more than one character, may be
  rendered in LaTeX with a `\mathit{}` or `\mathrm{}` command.
- Symbol names containing a `_` may be split in a suffix (part before the `_`)
  and a prefix (part after the `_`) and the prefix may be displayed as a
  subscript of the suffix. A symbol fragment is either the entire symbol, or a
  suffix or a prefix of a symbol.
- The following common names, when they appear as a fragment, may be replaced
  with a corresponding LaTeX command: `alpha`, `beta`, `gamma`, `Gamma`,
  `delta`, `Delta`, `epsilon`, `zeta`, `eta`, `theta`, `Theta`, `iota`, `kappa`,
  `lambda`, `Lambda`, `mu`, `nu`, `xi`, `Xi`, `pi`, `Pi`, `rho`, `sigma`,
  `Sigma`, `tau`, `upsilon`, `phi`, `Phi`, `varphi`, `chi`, `psi`, `Psi`,
  `omega`, `Omega`, `aleph`, `ast`, `blacksquare`, `bot`, `bullet`, `circ`,
  `diamond`, `times`, `top`, `square`, `star`.
- Symbol fragments ending in digits may be displayed with a corresponding
  subscript

<div class=symbols-table>

| Symbol    | LaTeX                  |                               |
| :-------- | :--------------------- | ----------------------------- |
| `time`    | `\mathit{time}`        | \\( \mathit{time} \\)         |
| `alpha`   | `\alpha`               | \\( \alpha \\)                |
| `m56`     | `m_{56}`               | \\( m\_{56} \\)               |
| `alpha0`  | `\alpha_0`             | \\( \alpha_0 \\)              |
| `m56_max` | `m_{56_{\mathit{max}}` | \\( m*{56*{\mathit{max}}} \\) |
| `c_max`   | `c_{\mathit{max}}`     | \\( c\_{\mathit{max}} \\)     |

</div>

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
    "fn": [Expression, ...Expression[]]
}
```

The **head** of the function is the first element in the array. Its presence is
required. It indicates the "function name" or "what" the function is about.

The head is frequently a string, but it can be another expression. If it is a
string, it should follow the conventions for constants in the section above on
Symbols.

Following the head are zero or more **arguments**, which are expressions as
well. The arguments, or **operands**, form the **tail** of the function.

The expression corresponding to \\(\sin^{-1}(x)\\) is:

```json
[["InverseFunction", "Sin"], "x"]
```

The head of this expression is `["InverseFunction", "Sin"]` and the argument is
`"x"`.

### JSON array

If a **function** has no extra metadata it can be represented as a JSON array.

For example these two expressions are equivalent:

```json
{ "fn": ["Cos", ["Add", "x", 1]] }

["Cos", ["Add", "x", 1]]
```

Note that an array representing a function must have at least one element, the
head of the function. Therefore `[]` is not a valid expression.

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
| `sourceContent` | The source from which this expression was generated.<br> It could be a LaTeX expression, or some other source language.                                                      |
| `sourceOffsets` | A pair of character offsets in `sourceContent` or `sourceUrl` from which this expression was produced                                                                        |
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
