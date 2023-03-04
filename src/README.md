---
title: MathJSON Format
permalink: /math-json/
layout: single
date: Last Modified
seo_description: MathJSON is a lightweight data interchange format for mathematical notation
sidebar:
  - nav: "universal"
chapter: compute-engine
toc: true
toc-options: '{"tags":["h2"]}'
preamble: "<picture class=full-width style='aspect-ratio:1.775;clip-path: inset(0 0 0 0 round 8px 8px 0 0); margin-bottom: 2em'>
  <source srcset=/assets/MathJSON@1x.webp type=image/webp>
  <source srcset=/assets/MathJSON@1x.jpg type=image/jpeg> 
  <img src=/assets/MathJSON@1x.jpg alt='MathJSON'>
</picture>
<p class=xl>MathJSON is a lightweight data interchange format for mathematical notation."
render_math_in_document: true
---

<style>
  .math-json {
    background: var(--console-background);
    color: var(--base-0a);
    padding: 4px;
  }
  .mathfield {
    border: var(--ui-border);
    padding: 5px;
    margin: 10px 0 10px 0;
    border-radius: 5px;
  }
  .output {
    font-family: var(--monospace-font-family);
    color: var(--base-0a); /* #f0c674; */

    background: var(--console-background);

    padding: 5px;
    margin: 10px 0 10px 0;
    border-radius: 5px;
    border: var(--ui-border);

    min-height: 1em;
    padding-top: 0.5em;
    padding-bottom: 0.5em;

    word-break: break-word;
    white-space: pre-wrap;
  }

</style>

<div class=symbols-table>

| Math                      | MathJSON                                                           |
| :------------------------ | :----------------------------------------------------------------- |
| \\[\frac{n}{1+n}\\]       | `["Divide", "n", ["Add", 1, "n"]]`{.math-json}                     |
| \\[\sin^{-1}^\prime(x)\\] | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`{.math-json} |

</div>

<math-field id="mf" class="mathfield" virtual-keyboard-mode="manual">e^{i\pi}+1=0</math-field>

<div id="mathfield-json" class="output"></div>

<script type="module">
    // import 'https://unpkg.com/mathlive?module';
    import 'https://unpkg.com/@cortex-js/compute-engine@latest/dist/compute-engine.min.esm.js';
    const mf = document.getElementById('mf');

    window.customElements.whenDefined("math-field").then(() => {
      document.getElementById('mathfield-json').innerHTML = exprToString(mf.expression.json);
      mf.addEventListener('input', (ev) => {
        document.getElementById('mathfield-json').innerHTML = exprToString(mf.expression.json);
      });
    });

    const MAX_LINE_LENGTH = 64;
    function exprToStringRecursive(expr, start) {
      let indent = ' '.repeat(start);
      if (Array.isArray(expr)) {
        const elements = expr.map(x => exprToStringRecursive(x, start + 2));
        let result = `[${elements.join(', ')}]`;
        if (start + result.length < MAX_LINE_LENGTH) return result;
        return `[\n${indent}  ${elements.join(`,\n${indent}  `)}\n${indent}]`;
      }
      if (expr === null) return 'null';
      if (typeof expr === 'object') {
        const elements = {};
        Object.keys(expr).forEach(x => 
           elements[x] = exprToStringRecursive(expr[x], start + 2)
        );
        let result = `\n${indent}{${Object.keys(expr).map(key => {return `${key}: ${elements[key]}`}).join('; ')}}`;
        if (start + result.length < MAX_LINE_LENGTH) return result;
        return  `\n${indent}{\n` + Object.keys(expr).map(key => 
            { return `${indent}  ${key}: ${elements[key]}` }
          ).join(`;\n${indent}`) + '\n' + indent + '}';
      }
      return JSON.stringify(expr, null, 2);
    }

    function escapeHtml(string) {
      return String(string).replace(/[&<>"'`=/\u200b]/g, function (s) {
        return (
          {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;',
            '`': '&#x60;',
            '=': '&#x3D;',
            '\u200b': '&amp;#zws;',
          }[s] || s
        );
      });
    }

    function exprToString(expr) {
      return escapeHtml(exprToStringRecursive(expr, 0));
    }
</script>

<br>

{% readmore "/compute-engine/demo/" %} Try a demo of the **Compute Engine**.
{% endreadmore %}

MathJSON is built on the [JSON format](https://www.json.org/). Its focus is on
interoperability between software programs to facilitate the exchange of
mathematical data and the building of scientific software through the
integration of software components communicating with a common format.

It is human-readable, while being easy for machines to generate and parse. It is
simple enough that it can be generated, consumed and manipulated using any
programming languages.

MathJSON can be transformed from (parsing) and to (serialization) other formats.

The **Cortex Compute Engine** library provides an implementation in
JavaScript/TypeScript of utilities that parse LaTeX to MathJSON, serialize
MathJSON to LaTeX, and provide a collection of functions for symbolic
manipulation and numeric evaluations of MathJSON expressions.

{% readmore "/compute-engine/guides/latex-syntax/" %} Read more about the
<strong>Compute Engine</strong> LaTeX syntax parsing and
serializing.{% endreadmore %}

Mathematical notation is used in a broad array of fields, from elementary school
arithmetic, engineering, applied mathematics to physics and more. New notations
are invented regularly and MathJSON endeavors to be flexible and extensible to
account for those notations.

The Compute Engine includes a standard library of functions and symbols which
can be extended with custom libraries.

{% readmore "/compute-engine/guides/standard-library/" %} Read more about the
<strong>Cortex Compute Engine Standard Library</strong> {% endreadmore %}

MathJSON is not intended to be suitable as a visual representation of arbitrary
mathematical notations, and as such is not a replacement for LaTeX or MathML.

## Structure of a MathJSON Expression

A MathJSON expression is a combination of **numbers**, **symbols**, **strings**,
**functions** and **dictionaries**.

**Number**

```json
3.14
314e-2
{"num": "3.14159265358979323846264338327950288419716939937510"}
{"num": "-Infinity"}
```

**Symbol**

```json
"x"
"Pi"
{"sym": "Pi", "wikidata": "Q167"}
```

**String**

```json
"'Diameter of a circle'"
{"str": "Radius"}
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

**Numbers**, **symbols**, **strings** and **functions** are expressed either as
object literals with a `"num"` `"str"` `"sym"` or `"fn"` key, respectively, or
using a shorthand notation as a a JSON number, string or array.

**Dictionaries** do not have a shorthand notation and are always expressed as an
object literal with a `"dict"` key.

The shorthand notation is more concise and easier to read, but it cannot include
metadata properties.

## Numbers

A MathJSON **number** is either:

- an object literal with a `"num"` key
- a JSON number
- a JSON string starting with `+`, `-` or the digits `0`-`9`

### Numbers as Object Literals

**Numbers** may be represented as an object literal with a `"num"` key. The
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

- The string values `"NaN"` `"+Infinity"` and `"-Infinity"` are used to
  represent respectively an undefined result, as per
  [IEEE 754](https://en.wikipedia.org/wiki/IEEE_754), positive infinity and
  negative infinity.

- If the string includes the pattern `/\([0-9]+\)/` (that is a series of one or
  more digits enclosed in parentheses), that pattern should be interpreted as
  repeating digits.

```json
{  "num": "1.(3)" }
{  "num": "0.(142857)" }
{  "num": "0.(142857)e7" }
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

### Numbers as Number Literals

When a **number** has no extra metadata and is compatible with the JSON
representation of numbers, a JSON number literal may be used.

Specifically:

- the number is in the range \\([-(2^{53})+1, (2^{53})-1]\\) so it fits in a
  64-bit float (**IEEE 754-2008**, 52-bit, about 15 digits of precision).
- the number is finite: it is not `+Infinity` `-Infinity` or `NaN`.

```json
0

-234.534e-46

// The numbers below may not be represented as JSON number literals:

// Exponent out of bounds
{ "num": "5.78e309" }

// Too many digits
{ "num": "3.14159265358979323846264338327950288419716" }

// Non-finite number
{ "num": "-Infinity" }

```

### Numbers as String Literals

An alternate representation of a **number** with no extra metadata is as a
string following the format described above.

This allows for a shorthand representation of numbers with a higher precision or
greater range than JSON numbers.

```json
"3.14159265358979323846264338327950288419716"
"+Infinity"
```

## Strings

A MathJSON **string** is either

- an object literal with a `"str"` key
- a [JSON string](https://tools.ietf.org/html/rfc7159#section-7) that starts and
  ends with **U+0027 APOSTROPHE** `'`.

Strings may contain any character represented by a Unicode scalar value (a
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

**Symbols** are [identifiers](#identifiers) that represent the name of
variables, constants and wildcards.

## Functions

A MathJSON function expression is either:

- an object literal with a `"fn"` key.
- a JSON array

Function expressions in the context of MathJSON may be used to represent
mathematical functions but are more generally used to represent the application
of a function to some arguments.

The function expression `["Add", 2, 3]` applies the function named `Add` to the
arguments `2` and `3`.

The function `"f"` can be used as a symbol, or in a function expression:
`["f", "x"]`.

### Functions as Object Literal

The default representation of **function** expressions is an object literal with
a `"fn"` key. The value of the key is an array representing the function head
and its arguments.

```js
{
  "fn": [Expression, ...Expression[]]
}
```

### Functions as JSON Arrays

If a **function** has no extra metadata it may be represented as a JSON array.

For example these two expressions are equivalent:

```json
{ "fn": ["Cos", ["Add", "x", 1]] }

["Cos", ["Add", "x", 1]]
```

An array representing a function must have at least one element, the head of the
function. Therefore `[]` is not a valid expression.{.notice--info}

### Function Head

The **head** of the function expression is the first element in the array. Its
presence is required. It indicates the **name of the function** or "what" the
function is about.

The head is usually an identifier, but it may also be another expression.

- If the head is an identifier, it should follow the conventions for function
  names (see below).

  ```json
  // Apply the function "Sin" to the argument "x"
  ["Sin", "x"]
  // Apply "Cos" to a function expression
  ["Cos", ["Divide", "Pi", 2]]
  ```

- If the head is an expression, it may include the wildcard `_` or `_1` to
  represent the first argument, `_2` to represent the second argument, etc...
  The wildcard `__` represents the sequence of all the arguments.

  ```json
  [["Multiply", "_", "_"], 4]
  ```

Following the head are zero or more **arguments**, which are expressions as
well. The arguments, or **operands**, form the **tail** of the function.

**CAUTION** the arguments of a function are expressions. To represent an
argument which is a list, use a `["List"]` expression, do not use an array.
{.notice--warning}

The expression corresponding to \\(\sin^{-1}(x)\\) is:

```json
[["InverseFunction", "Sin"], "x"]
```

The head of this expression is `["InverseFunction", "Sin"]` and its argument is
`"x"`.

## Identifiers

Identifiers are strings of valid Unicode characters, including Greek, Cyrillic,
Hebrew, Arabic, ideographic and CJK symbols, mathematical symbols and emojis,
except:

<div class=symbols-table>

| Codepoint                | Name                         |                    |
| :----------------------- | :--------------------------- | :----------------- |
| **U+0000** to **U+0020** |                              |                    |
| **U+0022**               | **QUOTATION MARK**           | `"`                |
| **U+0060**               | **GRAVE ACCENT**<br>backtick | <code>&#96;</code> |
| **U+FFFE**               | **BYTE ORDER MARK**          |                    |
| **U+FFFF**               | **INVALID BYTE ORDER MARK**  |                    |

</div>

In addition, the first character of an identifier must not be:

<div class=symbols-table>

| Codepoint                | Name                      |         |
| :----------------------- | :------------------------ | :------ |
| **U+0021**               | **EXCLAMATION MARK**      | `!`     |
| **U+0022**               | **QUOTATION MARK**        | `"`     |
| **U+0024**               | **DOLLAR SIGN**           | `$`     |
| **U+0025**               | **PERCENT**               | `%`     |
| **U+0026**               | **AMPERSAND**             | `&`     |
| **U+0027**               | **APOSTROPHE**            | `'`     |
| **U+0028**               | **LEFT PARENTHESIS**      | `(`     |
| **U+0029**               | **RIGHT PARENTHESIS**     | `)`     |
| **U+002B**               | **PLUS SIGN**             | `+`     |
| **U+002D**               | **HYPHEN MINUS SIGN**     | `-`     |
| **U+002E**               | **FULL STOP**             | `.`     |
| **U+0030** to **U+0039** | **DIGIT 0** - **DIGIT 9** | `0`-`9` |
| **U+003A**               | **COLON**                 | `:`     |
| **U+003F**               | **QUESTION MARK**         | `?`     |
| **U+0040**               | **COMMERCIAL AT**         | `@`     |
| **U+005B**               | **LEFT SQUARE BRACKET**   | `[`     |
| **U+005D**               | **RIGHT SQUARE BRACKET**  | `]`     |
| **U+005E**               | **CIRCUMFLEX ACCENT**     | `^`     |
| **U+007B**               | **LEFT CURLY BRACKET**    | `{`     |
| **U+007D**               | **RIGHT CURLY BRACKET**   | `}`     |
| **U+007E**               | **TILDE**                 | `~`     |

</div>

Before they are used, identifiers are normalized to the
[Unicode Normalization Form C (NFC)](https://unicode.org/reports/tr15/). They
must be stored internally and compared using the NFC.

JSON escape sequences are applied before Unicode normalization.

These four strings represent the same identifier:

- `"Å"`
- `"A\u030a"` `A‌` + **COMBINING RING ABOVE**
- `"\u00c5"` **LATIN CAPITAL LETTER A WITH RING ABOVE** `Å`
- `"\u0041\u030a"` **LATIN CAPITAL LETTER A** + **COMBINING RING ABOVE** `A‌` +
  ` ̊`

The following naming convention for wildcards, variables, constants and function
names are recommendations.

### Variables Naming Convention

- Avoid mixing latin characters and non-latin characters.

  For example, use `"半径"`, `"🍕"` or `"🐕🐄"`, but avoid `"🍕slice"`

  Carefully consider when to use non-latin characters.

  For example:

  - prefer using `"gamma"` rather than `"ɣ"` (**LATIN SMALL LETTER GAMMA**) or
    `"γ"` (**GREEK SMALL LETTER GAMMA**)
  - prefer using `"Sum"` rather than `"∑"` **U+2211 N-ARY SUMMATION**, which can
    be visually confused with `"Σ"` **U+03A3 GREEK CAPITAL LETTER SIGMA**.

- If using latin characters, the first character of a variable should be a
  lowercase or uppercase letter: `a`-`z` or `A`-`Z`
- Subsequent characters should be a letter, digit (`0`-`9`) or underscore (`_`).

  Using a more limited set of common characters avoids visual ambiguity issues
  that might otherwise arise with some Unicode symbols.

- If a variable is made of several words, use camelCase, i.e. `"newDeterminant"`

- Prefer clarity over brevity and avoid obscure abbreviations.

  Use `"newDeterminant"` rather than `"newDet"` or `"nDet"`

### Wildcards Naming Convention

Symbols that begin with `_` **U+005F LOW LINE** (underscore) should be used to
denote wildcards and other placeholders.

For example, they may denote the positional arguments in a function expression.
They may also denote placeholders and captured expression in patterns.

<div class=symbols-table>

| Wildcard                    |                                                                       |
| :-------------------------- | :-------------------------------------------------------------------- |
| `"_"`                       | Wildcard for a single expression or for the first positional argument |
| `"_1"`                      | Wildcard for a positional argument                                    |
| <code>"\_&#x200A;\_"</code> | Wildcard for a sequence of 1 or more expression                       |
| `"___"`                     | Wildcard for a sequence of 0 or more expression                       |
| `"_a"`                      | Capturing an expression as a wildcard named `a`                       |

</div>

### Constants Naming Convention

- Avoid mixing latin characters and non-latin characters.
- If using latin characters, the first character of a constant should be an
  uppercase letter `A`-`Z`
- Subsequent characters should be a letter, digit `0`-`9` or underscore `_`.
- If a constant is made up of several words, use camelCase, e.g.
  `"SpeedOfLight"`

### Function Names Naming Convention

- Avoid mixing latin characters and non-latin characters.
- The names of the function in the standard library start with an uppercase
  letter `A`-`Z`, for example `"Sin"`, `"Fold"`.
- Subsequent characters should be a letter, digit `0`-`9` or underscore `_`.
- If a function name is made up of several words, use camelCase, e.g.
  `"InverseFunction"`

### Rendering Conventions

The following recommendations may be followed by clients displaying MathJSON
identifiers. They do not affect computation or manipulation of expressions
following these conventions.

- Multi-letter variables, that is identifiers with more than one character, may
  be rendered in LaTeX with a `\mathit{}` or `\mathrm{}` command.
- Identifiers containing a `_` may be split in a suffix (part before the `_`)
  and a prefix (part after the `_`) and the prefix may be displayed as a
  subscript of the suffix. An identifier fragment is either the entire
  identifier, or a suffix or a prefix of an identifier.
- The following common names, when they appear as a fragment, may be replaced
  with a corresponding LaTeX command: `alpha`, `beta`, `gamma`, `Gamma`,
  `delta`, `Delta`, `epsilon`, `zeta`, `eta`, `theta`, `Theta`, `iota`, `kappa`,
  `lambda`, `Lambda`, `mu`, `nu`, `xi`, `Xi`, `pi`, `Pi`, `rho`, `sigma`,
  `Sigma`, `tau`, `upsilon`, `phi`, `Phi`, `varphi`, `chi`, `psi`, `Psi`,
  `omega`, `Omega`, `aleph`, `ast`, `blacksquare`, `bot`, `bullet`, `circ`,
  `diamond`, `times`, `top`, `square`, `star`.
- Identifier fragments ending in digits may be displayed with a corresponding
  subscript

<div class=symbols-table>

| Identifier | LaTeX                  |                                 |
| :--------- | :--------------------- | ------------------------------- |
| `time`     | `\mathit{time}`        | \\( \mathit{time} \\)           |
| `alpha`    | `\alpha`               | \\( \alpha \\)                  |
| `alpha0`   | `\alpha_0`             | \\( \alpha_0 \\)                |
| `m56`      | `m_{56}`               | \\( m\_{56} \\)                 |
| `m56_max`  | `m_{56_{\mathit{max}}` | \\( m\_{56\_{\mathit{max}}} \\) |
| `c_max`    | `c_{\mathit{max}}`     | \\( c\_{\mathit{max}} \\)       |

</div>

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

An alternate representation of a dictionary is as a `["Dictionary"]` function
expression, but this is quite a bit more verbose:

```json
[
  "Dictionary",
  ["KeyValuePair", "'first'", 1],
  ["KeyValuePair", "'second'", 2],
  ["KeyValuePair", "'third'", ["Add", 1, 2]]
]
```

## Metadata

MathJSON object literals may be annotated with supplemental information.

A **number** represented as a JSON number literal, a **symbol** or **string**
represented as a JSON string literal, or a **function** represented as a JSON
array must be transformed into the equivalent object literal to be annotated.

The following metadata keys are recommended:

<div class=symbols-table>

| Key             | Note                                                                                                                                                                         |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wikidata`      | A short string indicating an entry in a wikibase.<br>This information can be used to disambiguate the meaning of an identifier                                               |
| `comment`       | A human readable plain string to annotate an expression, since JSON does not allow comments in its encoding                                                                  |
| `documentation` | A Markdown-encoded string providing documentation about this expression.                                                                                                     |
| `latex`         | A visual representation in LaTeX of the expression. <br> This can be useful to preserve non-semantic details, for example parentheses in an expression or styling attributes |
| `sourceUrl`     | A URL to the source of this expression                                                                                                                                       |
| `sourceContent` | The source from which this expression was generated.<br> It could be a LaTeX expression, or some other source language.                                                      |
| `sourceOffsets` | A pair of character offsets in `sourceContent` or `sourceUrl` from which this expression was produced                                                                        |
| `hash`          | A string representing a digest of this expression.                                                                                                                           |

</div>

```json
{
  "sym": "Pi",
  "comment": "The ratio of the circumference of a circle to its diameter",
  "wikidata": "Q167",
  "latex": "\\pi"
}

{
  "sym": "Pi",
  "comment": "The greek letter ∏",
  "wikidata": "Q168",
}
```

## Standard Library

This document defines the structure of MathJSON expression. The Standard Library
defines a recommended **vocabulary** to use in MathJSON expressions.

Before considering inventing your own vocabulary, check if the standard library
already provides relevant definitions.

The Standard Library includes definitions for:

<div class=symbols-table>

| Dictionary                                                          | Symbols/Functions                                                      |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)                 | `Add` `Multiply` `Power` `Exp` `Log` `ExponentialE` `ImaginaryUnit`... |
| [Calculus](/compute-engine/reference/calculus/)                     | `Derive` `Integrate`...                                                |
| [Collections](/compute-engine/reference/collections/)               | `Sequence` `List` `Dictionary` `Set`...                                |
| [Control Structures](/compute-engine/reference/control-structures/) | `If` `Block` `Loop` `Sum` ...                                          |
| [Core](/compute-engine/reference/core/)                             | `Let`, `Set`, `InverseFunction` `LatexTokens`...                       |
| [Domains](/compute-engine/reference/domains/)                       | `Anything` `Nothing` `Number` `Integer` ...                            |
| [Functions](/compute-engine/reference/functions/)                   | `Function` `Apply` `Return` ...                                        |
| [Logic](/compute-engine/reference/logic/)                           | `And` `Or` `Not` `True` `False` `Maybe` ...                            |
| [Sets](/compute-engine/reference/sets/)                             | `Union` `Intersection` `EmptySet` ...                                  |
| [Special Functions](/compute-engine/reference/special-functions/)   | `Erf` `Gamma` `Factorial`...                                           |
| [Styling](/compute-engine/reference/styling/)                       | `Delimiter` `Style`...                                                 |
| [Trigonometry](/compute-engine/reference/trigonometry/)             | `Pi` `Cos` `Sin` `Tan`...                                              |

</div>

If you need to define a new function, avoid using a name already defined in the
Standard Library.

{% readmore "/compute-engine/guides/standard-library/" %} Read more about the
<strong>MathJSON Standard Library</strong>.{% endreadmore %}
