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
  <img src=/assets/MathJSON@1x.jpg alt=\"MathJSON\">
</picture>
<h2 style='font-size:3rem'>MathJSON: a lightweight data interchange format for mathematical notation.</h2>"
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
    width: 100%;
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

| Math                      | MathJSON                                                        |
| :------------------------ | :-------------------------------------------------------------- |
| \\[\frac{n}{1+n}\\]       | `["Divide", "n", ["Add", 1, "n"]]`{.math-json}                  |
| \\[\sin^{-1}^\prime(x)\\] | `[["Derivative", ["InverseFunction", "Sin"]], "x"]`{.math-json} |

</div>

<math-field id="mf" class="mathfield">e^{i\pi}+1=0</math-field>

<div id="mathfield-json" class="output"></div>

<script type="module">
    // import 'https://unpkg.com/mathlive?module';
    import 'https://unpkg.com/@cortex-js/compute-engine@latest/dist/compute-engine.min.esm.js';
    const mf = document.getElementById("mf");

    window.customElements.whenDefined("math-field").then(() => {
      document.getElementById('mathfield-json').innerHTML = exprToString(mf.expression.json);
      mf.addEventListener("input", (ev) => {
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
      if (expr === null) return "null";
      if (typeof expr === "object") {
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
<strong>MathJSON Standard Library</strong> {% endreadmore %}

MathJSON is not intended to be suitable as a visual representation of arbitrary
mathematical notations, and as such is not a replacement for LaTeX or MathML.

## Structure of a MathJSON Expression

A MathJSON expression is a combination of **numbers**, **symbols**, **strings**,
**functions** and **dictionaries**.

**Number**

```json example
3.14
314e-2
{"num": "3.14159265358979323846264338327950288419716939937510"}
{"num": "-Infinity"}
```

**Symbol**

```json example
"x"
"Pi"
"🍎"
"半径"
{"sym": "Pi", "wikidata": "Q167"}
```

**String**

```json example
"'Diameter of a circle'"
{"str": "Srinivasa Ramanujan"}
```

**Function**

```json example
["Add", 1, "x"]
{"fn": [{sym: "Add"}, {num: "1"}, {sym: "x"}]}
```

**Dictionary**

```json example
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

```json example
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

```json example
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

```json example
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

```json example
"'Alan Turing'"
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

```json example
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

  ```json example
  // Apply the function "Sin" to the argument "x"
  ["Sin", "x"]
  // Apply "Cos" to a function expression
  ["Cos", ["Divide", "Pi", 2]]
  ```

- If the head is an expression, it may include the wildcard `_` or `_1` to
  represent the first argument, `_2` to represent the second argument, etc...
  The wildcard `__` represents the sequence of all the arguments.

  ```json example
  [["Multiply", "_", "_"], 4]
  ```

Following the head are zero or more **arguments**, which are expressions as
well. The arguments, or **operands**, form the **tail** of the function.

**CAUTION** the arguments of a function are expressions. To represent an
argument which is a list, use a `["List"]` expression, do not use an array.
{.notice--warning}

The expression corresponding to \\(\sin^{-1}(x)\\) is:

```json example
[["InverseFunction", "Sin"], "x"]
```

The head of this expression is `["InverseFunction", "Sin"]` and its argument is
`"x"`.

## Identifiers

Identifiers are the names of symbols, variables, constants, wildcards and
functions.

They are represented as JSON strings.

Before they are used, JSON escape sequences (such as `\u` sequences, `\\`, etc.)
are decoded.

The identifiers are then normalized to the
[Unicode Normalization Form C (NFC)](https://unicode.org/reports/tr15/). They
are stored internally and compared using the Unicode NFC.

These four JSON strings represent the same identifier:

- `"Å"`
- `"A\u030a"` `A‌` **U+0041 LATIN CAPITAL LETTER** + **U+030A COMBINING RING
  ABOVE**
- `"\u00c5"` **U+00C5 LATIN CAPITAL LETTER A WITH RING ABOVE** `Å`
- `"\u0041\u030a"` **U+0041 LATIN CAPITAL LETTER A** + **U+030A COMBINING RING
  ABOVE** `A‌` + ` ̊`

Identifiers conforms to a profile of
[UAX31-R1-1](https://unicode.org/reports/tr31/) with the following
modifications:

- The character `_` **U+005F LOW LINE** is added to the `Start` character set
- The characters should belong to a
  [recommended script](https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts)
- An identifier can be a sequence of one or more emojis. Characters that have
  both the Emoji and XIDC proeprty are only considered emojis when they are
  preceeded with emoji modifiers. The definition below is based on
  [Unicode TR51](https://unicode.org/reports/tr51/#EBNF_and_Regex) but modified
  to exclude invalid identifiers.

Identifiers match either the `NON_EMOJI_IDENTIFIER` or the `EMOJI_IDENTIFIER`
patterns below:

```js
const NON_EMOJI_IDENTIFIER = /^[\p{XIDS}_]\p{XIDC}*$/u;
```

(from [Unicode TR51](https://unicode.org/reports/tr51/#EBNF_and_Regex))

or

```js
const VS16 = '\\u{FE0F}'; // Variation Selector-16, forces emoji presentation
const KEYCAP = '\\u{20E3}'; // Combining Enclosing Keycap
const ZWJ = '\\u{200D}'; // Zero Width Joiner

const FLAG_SEQUENCE = '\\p{RI}\\p{RI}';

const TAG_MOD = `(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})`;
const EMOJI_MOD = `(?:\\p{EMod}|${VS16}${KEYCAP}?|${TAG_MOD})`;
const EMOJI_NOT_IDENTIFIER = `(?:(?=\\P{XIDC})\\p{Emoji})`;
const ZWJ_ELEMENT = `(?:${EMOJI_NOT_IDENTIFIER}${EMOJI_MOD}*|\\p{Emoji}${EMOJI_MOD}+|${FLAG_SEQUENCE})`;
const POSSIBLE_EMOJI = `(?:${ZWJ_ELEMENT})(${ZWJ}${ZWJ_ELEMENT})*`;
const EMOJI_IDENTIFIER = new RegExp(`^(?:${POSSIBLE_EMOJI})+$`, "u");
```

In summary, when using Latin characters, identifiers can start with a letter or
an underscore, followed by zero or more letters, digits and underscores.

Carefully consider when to use non-latin characters. Use non-latin characters
for whole words, for example: `"半径"` (radius), "מְהִירוּת" (speed), "直徑"
(diameter) or "सतह" (surface).

Avoid mixing Unicode characters from different scripts in the same identifier.

Do not include bidi markers such as LTR **U+200E** or RTL **U+200F** in
identifiers. LTR and RTL marks should be added as needed by the client
displaying the identifier. They should be ignored when parsing identifiers.

Avoid visual ambiguity issues that might arise with some Unicode characters. For
example:

- prefer using `"gamma"` rather than `"ɣ"` **U+0194 LATIN SMALL LETTER GAMMA**
  or `"γ"` **U+03B3 GREEK SMALL LETTER GAMMA**
- prefer using `"Sum"` rather than `"∑"` **U+2211 N-ARY SUMMATION**, which can
  be visually confused with `"Σ"` **U+03A3 GREEK CAPITAL LETTER SIGMA**.

---

The following naming convention for wildcards, variables, constants and function
names are recommendations.

### Wildcards Naming Convention

Symbols that begin with `_` **U+005F LOW LINE** (underscore) should be used to
denote wildcards and other placeholders.

For example, they may be used to denote the positional arguments in a function
expression. They may also denote placeholders and captured expression in
patterns.

<div class=symbols-table>

| Wildcard                    |                                                                       |
| :-------------------------- | :-------------------------------------------------------------------- |
| `"_"`                       | Wildcard for a single expression or for the first positional argument |
| `"_1"`                      | Wildcard for a positional argument                                    |
| <code>"\_&#x200A;\_"</code> | Wildcard for a sequence of 1 or more expression                       |
| `"___"`                     | Wildcard for a sequence of 0 or more expression                       |
| `"_a"`                      | Capturing an expression as a wildcard named `a`                       |

</div>

### Variables Naming Convention

- If a variable is made of several words, use camelCase. For example
  `"newDeterminant"`

- Prefer clarity over brevity and avoid obscure abbreviations.

  Use `"newDeterminant"` rather than `"newDet"` or `"nDet"`

### Constants Naming Convention

- If using latin characters, the first character of a constant should be an
  uppercase letter `A`-`Z`
- If a constant name is made up of several words, use camelCase. For example
  `"SpeedOfLight"`

### Function Names Naming Convention

- The name of the functions in the MathJSON Standard Library starts with an uppercase
  letter `A`-`Z`. For example `"Sin"`, `"Fold"`.
- The name of your own functions can start with a lowercase or uppercase letter.
- If a function name is made up of several words, use camelCase. For example
  `"InverseFunction"`

### LaTeX Rendering Conventions

The following recommendations may be followed by clients displaying MathJSON
identifiers with LaTeX, or parsing LaTeX to MathJSON identifiers.

These recommendations do not affect computation or manipulation of expressions
following these conventions.

- An identifier may be composed of a main body, some modifiers, some style
  variants, some subscripts and subscripts. For example `"alpha_0__prime"` \\(
  \alpha_0\prime \\) or `"x_vec"` (\\ \vec{x} \\) or `"Re_fraktur"` \\(
  \mathfrak{Re} \\).
- Subscripts are indicated by an underscore `_` and superscripts by a
  double-underscore `__`. There may be more than one superscript or subscripts,
  but they get concatenated. For example `"a_b__c_q__p"` -> `a_{b, q}^{c, p}`
  \\( a\_{b, q}^{c, p} \\).
- Modifiers after a superscript or subscript apply to the closest preceding
  superscript or subscript. For example `"a_b_prime"` -> `a_{b^{\prime}}`

Modifiers include:

<div class=symbols-table>

| Modifier        | LaTeX             |                          |
| :-------------- | :---------------- | ------------------------ |
| `_deg`          | `\degree`         | \\( x\degree \\)         |
| `_prime`        | `{}^\prime`       | \\( x^{\prime} \\)       |
| `_dprime`       | `{}^\doubleprime` | \\( x^{\doubleprime} \\) |
| `_ring`         | `\mathring{}`     | \\( \mathring{x} \\)     |
| `_hat`          | `\hat{}`          | \\( \hat{x} \\)          |
| `_tilde`        | `\tilde{}`        | \\( \tilde{x} \\)        |
| `_vec`          | `\vec{}`          | \\( \vec{x} \\)          |
| `_bar`          | `\overline{}`     | \\( \overline{x} \\)     |
| `_underbar`     | `\underline{}`    | \\( \underline{x} \\)    |
| `_dot`          | `\dot{}`          | \\( \dot{x} \\)          |
| `_ddot`         | `\ddot{}`         | \\( \ddot{x} \\)         |
| `_tdot`         | `\dddot{}`        | \\( \dddot{x} \\)        |
| `_qdot`         | `\ddddot{}`       | \\( \dddodt{x} \\)       |
| `_operator`     | `\operatorname{}` | \\( \operatorname{x} \\) |
| `_upright`      | `\mathrm{}`       | \\( \mathrm{x} \\)       |
| `_italic`       | `\mathit{}`       | \\( \mathit{x} \\)       |
| `_bold`         | `\mathbf{}`       | \\( \mathbf{x} \\)       |
| `_doublestruck` | `\mathbb{}`       | \\( \mathbb{x} \\)       |
| `_fraktur`      | `\mathfrak{}`     | \\( \mathfrak{x} \\)     |
| `_script`       | `\mathsc{}`       | \\( \mathsc{x} \\)       |

</div>

- The following common names, when they appear as the body or in a
  subscript/superscript of an identifier, may be replaced with a corresponding
  LaTeX command:

<div class=symbols-table>

| Common Names     | LaTeX         |                     |
| :--------------- | :------------ | ------------------- |
| `alpha`          | `\alpha`      | \\( \alpha \\)      |
| `beta`           | `\beta`       | \\( \beta \\)       |
| `gamma`          | `\gamma`      | \\( \gamma \\)      |
| `delta`          | `\delta`      | \\( \delta \\)      |
| `epsilon`        | `\epsilon`    | \\( \epsilon \\)    |
| `epsilonSymbol`  | `\varepsilon` | \\( \varepsilon \\) |
| `zeta`           | `\zeta`       | \\( \zeta \\)       |
| `eta`            | `\eta`        | \\( \eta \\)        |
| `theta`          | `\theta`      | \\( \theta \\)      |
| `thetaSymbol`    | `\vartheta`   | \\( \vartheta \\)   |
| `iota`           | `\iota`       | \\( \iota \\)       |
| `kappa`          | `\kappa`      | \\( \kappa \\)      |
| `kappaSymbol`    | `\varkappa`   | \\( \varkappa \\)   |
| `mu`             | `\mu`         | \\( \mu \\)         |
| `nu`             | `\nu`         | \\( \nu \\)         |
| `xi`             | `\xi`         | \\( \xi \\)         |
| `omicron`        | `\omicron`    | \\( \omicron \\)    |
| `piSymbol`       | `\varpi`      | \\( \varpi \\)      |
| `rho`            | `\rho`        | \\( \rho \\)        |
| `rhoSymbol`      | `\varrho`     | \\( \varrho \\)     |
| `sigma`          | `\sigma`      | \\( \sigma \\)      |
| `finalSigma`     | `\varsigma`   | \\( \varsigma \\)   |
| `tau`            | `\tau`        | \\( \tau \\)        |
| `phi`            | `\phi`        | \\( \phi \\)        |
| `phiLetter`      | `\varphi`     | \\( \varphi \\)     |
| `upsilon`        | `\upsilon`    | \\( \upsilon \\)    |
| `chi`            | `\chi`        | \\( \chi \\)        |
| `psi`            | `\psi`        | \\( \psi \\)        |
| `omega`          | `\omega`      | \\( \omega \\)      |
| `Alpha`          | `\Alpha`      | \\( \Alpha \\)      |
| `Beta`           | `\Beta`       | \\( \Beta \\)       |
| `Gamma`          | `\Gamma`      | \\( \Gamma \\)      |
| `Delta`          | `\Delta`      | \\( \Delta \\)      |
| `Epsilon`        | `\Epsilon`    | \\( \Epsilon \\)    |
| `Zeta`           | `\Zeta`       | \\( \Zeta \\)       |
| `Eta`            | `\Eta`        | \\( \Eta \\)        |
| `Theta`          | `\Theta`      | \\( \Theta \\)      |
| `Iota`           | `\Iota`       | \\( \Iota \\)       |
| `Kappa`          | `\Kappa`      | \\( \Kappa \\)      |
| `Lambda`         | `\Lambda`     | \\( \Lambda \\)     |
| `Mu`             | `\Mu`         | \\( \Mu \\)         |
| `Nu`             | `\Nu`         | \\( \Nu \\)         |
| `Xi`             | `\Xi`         | \\( \Xi \\)         |
| `Omicron`        | `\Omicron`    | \\( \Omicron \\)    |
| `Pi`             | `\Pi`         | \\( \Pi \\)         |
| `Rho`            | `\Rho`        | \\( \Rho \\)        |
| `Sigma`          | `\Sigma`      | \\( \Sigma \\)      |
| `Tau`            | `\Tau`        | \\( \Tau \\)        |
| `Phi`            | `\Phi`        | \\( \Phi \\)        |
| `Upsilon`        | `\Upsilon`    | \\( \Upsilon \\)    |
| `Chi`            | `\Chi`        | \\( \Chi \\)        |
| `Psi`            | `\Psi`        | \\( \Psi \\)        |
| `Omega`          | `\Omega`      | \\( \Omega \\)      |
| `digamma`        | `\digamma`    | \\( \digamma \\)    |
| `aleph`          | `\aleph`      | \\( \aleph \\)      |
| `lambda`         | `\lambda`     | \\( \lambda \\)     |
| `bet`            | `\beth`       | \\( \beth \\)       |
| `gimel`          | `\gimel`      | \\( \gimel \\)      |
| `dalet`          | `\dalet`      | \\( \dalet \\)      |
| `ell`            | `\ell`        | \\( \ell \\)        |
| `turnedCapitalF` | `\Finv`       | \\( \Finv \\)       |
| `turnedCapitalG` | `\Game`       | \\( \Game \\)       |
| `weierstrass`    | `\wp`         | \\( \wp \\)         |
| `eth`            | `\eth`        | \\( \eth \\)        |
| `invertedOhm`    | `\mho`        | \\( \mho \\)        |
| `hBar`           | `\hbar`       | \\( \hbar \\)       |
| `hSlash`         | `\hslash`     | \\( \hslash \\)     |
| `blacksquare`    | `\hslash`     | \\( \hslash \\)     |
| `bottom`         | `\bot`        | \\( \bot \\)        |
| `bullet`         | `\bullet`     | \\( \bullet \\)     |
| `circle`         | `\circ`       | \\( \circ \\)       |
| `diamond`        | `\diamond`    | \\( \diamond \\)    |
| `times`          | `\times`      | \\( \times \\)      |
| `top`            | `\top`        | \\( \top \\)        |
| `square`         | `\square`     | \\( \square \\)     |
| `star`           | `\star`       | \\( \star \\)       |

</div>

- The following names, when used as a subscript or superscript, may be replaced
  with a corresponding LaTeX command:

<div class=symbols-table>

| Subscript/Supscript | LaTeX                 |                            |
| :------------------ | :-------------------- | -------------------------- |
| `plus`              | `{}_{+}` / `{}^{+}`   | \\( x\_{+} x^+\\)          |
| `minus`             | `{}_{-}` /`{}^{-}`    | \\( x\_{-} x^-\\)          |
| `pm`                | `{}_\pm` /`{}^\pm`    | \\( x\_{\pm} x^\pm \\)     |
| `ast`               | `{}_\ast` /`{}^\ast`  | \\( {x}\_\ast x^\ast \\)   |
| `dag`               | `{}_\dag` /`{}^\dag`  | \\( {x}\_\dag x^\dag \\)   |
| `ddag`              | `{}_\ddag` `{}^\ddag` | \\( {x}\_\ddag x^\ddag \\) |
| `hash`              | `{}_\#` `{}^\#`       | \\( {x}\_\# x^\#\\)        |

</div>

- Multi-letter identifiers may be rendered with a `\mathit{}`, `\mathrm{}` or
  `\operatorname{}` command.

- Identifier fragments ending in digits may be rendered with a corresponding
  subscript.

<div class=symbols-table>

| Identifier           | LaTeX              |                           |
| :------------------- | :----------------- | ------------------------- |
| `time`               | `\mathrm{time}`    | \\( \mathrm{time} \\)     |
| `speed_italic`       | `\mathit{speed}`   | \\( \mathit{speed} \\)    |
| `P_blackboard__plus` | `\mathbb{P}^{+}`   | \\( \mathbb{P^+} \\)      |
| `alpha`              | `\alpha`           | \\( \alpha \\)            |
| `mu0`                | `\mu_{0}`          | \\( \mu_0 \\)             |
| `m56`                | `m_{56}`           | \\( m\_{56} \\)           |
| `c_max`              | `\mathrm{c_{max}}` | \\( \mathrm{c\_{max}} \\) |

</div>

## Dictionary

A **dictionary** is a collection of key-value pairs. In some progamming
languages it is called a map or associative array.

The keys are strings and the values are MathJSON expressions.

A **dictionary** is represented as an object literal with a `"dict"` key. The
value of the key is a JSON object literal holding the content of the dictionary.

```json example
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

```json example
[
  "Dictionary",
  ["KeyValuePair", ""first"", 1],
  ["KeyValuePair", ""second"", 2],
  ["KeyValuePair", ""third"", ["Add", 1, 2]]
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

```json example
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

## MathJSON Standard Library

This document defines the structure of MathJSON expression. The MathJSON Standard Library
defines a recommended **vocabulary** to use in MathJSON expressions.

Before considering inventing your own vocabulary, check if the MathJSON Standard Library
already provides relevant definitions.

The MathJSON Standard Library includes definitions for:

<div class=symbols-table>

| Topic                                                               |                                                       |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)                 | `Add` `Multiply` `Power` `Exp` `Log` `ExponentialE` `ImaginaryUnit`... |
| [Calculus](/compute-engine/reference/calculus/)                     | `D` `Derivative` `Integrate`...                                                |
| [Collections](/compute-engine/reference/collections/)               | `List` `Reverse` `Filter`...                                           |
| [Complex](/compute-engine/reference/complex/)                       | `Real` `Conjugate`, `ComplexRoots`...                                  |
| [Control Structures](/compute-engine/reference/control-structures/) | `If` `Block` `Loop` ...                                          |
| [Core](/compute-engine/reference/core/)                             | `Declare`, `Assign`, `Error` `LatexString`...                       |
| [Domains](/compute-engine/reference/domains/)                       | `Anything` `Nothing` `Number` `Integer` ...                            |
| [Functions](/compute-engine/reference/functions/)                   | `Function` `Apply` `Return` ...                                        |
| [Logic](/compute-engine/reference/logic/)                           | `And` `Or` `Not` `True` `False` `Maybe` ...                            |
| [Sets](/compute-engine/reference/sets/)                             | `Union` `Intersection` `EmptySet` ...                                  |
| [Special Functions](/compute-engine/reference/special-functions/)   | `Gamma` `Factorial`...                                                 |
| [Statistics](/compute-engine/reference/statistics/)                 | `StandardDeviation` `Mean` `Erf`...                                    |
| [Styling](/compute-engine/reference/styling/)                       | `Delimiter` `Style`...                                                 |
| [Trigonometry](/compute-engine/reference/trigonometry/)             | `Pi` `Cos` `Sin` `Tan`...                                              |

</div>

When defining a new function, avoid using a name already defined in the Standard
Library.

{% readmore "/compute-engine/guides/standard-library/" %} Read more about the
<strong>MathJSON Standard Library</strong>.{% endreadmore %}

{% readmore "/compute-compute-engine/guides/augmenting/" %} Read more about
<strong>Adding New Definitions</strong>.
{% endreadmore %}
