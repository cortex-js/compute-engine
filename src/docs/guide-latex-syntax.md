---
title: Parsing and Serializing LaTeX
permalink: /compute-engine/guides/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
preamble:
  '<h1>Parsing and Serializing LaTeX</h1><p class="xl">The CortexJS Compute
  Engine manipulates MathJSON expressions. It can also convert LaTeX strings to
  MathJSON expressions (<b>parsing</b>) and output MathJSON expressions as LaTeX
  string (<b>serializing</b>)</p>'
toc: true
---

In this documentation, functions such as `ce.box()` and `ce.parse()` require a
`ComputeEngine` instance which is denoted by a `ce.` prefix.<br>Functions that
apply to a boxed expression, such as `expr.simplify()` are denoted with a
`expr.` prefix.{.notice--info}

**To parse a LaTeX string as a MathJSON expression**, call the `ce.parse()`
function.

```javascript
const ce = new ComputeEngine();

console.log(ce.parse('5x + 1').json);
// ➔  ["Add", ["Multiply", 5, "x"], 1]
```

By default, `ce.parse()` return a
[canonical expression](/compute-engine/guides/canonical-form/). To get a
non-canonical expression instead, use the `{canonical: false}` option: The
non-canonical form is closer to the literal LaTeX input.

```js
ce.parse('\\frac{7}{-4}');
// ➔  ["Rational", -7, 4]

ce.parse('\\frac{7}{-4}', { canonical: false });
// ➔  ["Divide", 7, -4]
```

<hr>

**To input math using an interactive mathfield**, use [MathLive](/mathlive/).

A MathLive `<math-field>` DOM element works like a `<textarea>` in HTML, but for
math. It provides its content as a LaTeX string or a MathJSON expression, ready
to be used with the Compute Engine.

{% readmore "/mathlive/" %} Read more about the MathLive <strong>mathfield
element</strong> {% endreadmore %}

## The Compute Engine Natural Parser

Unlike a programming language, mathematical notation is surprisingly ambiguous
and full of idiosyncrasies. Mathematicians frequently invent new notations, or
have their own preferences to represent even common concepts.

The Compute Engine Natural Parser interprets expressions using the notation you
are already familiar with. Write as you would on a blackboard, and get back a
semantic representation as an expression ready to be processed.

| LaTeX                                                      | MathJSON                                                                |
| :--------------------------------------------------------- | :---------------------------------------------------------------------- | --- | --- | --- | ------------------------------------------ | --- | -------------------------------------- |
| <big>$$ \sin 3t + \cos 2t $$ </big>`\sin 3t + \cos 2t`     | `["Add", ["Sin", ["Multiply", 3, "t"]], ["Cos", ["Multiply", 2, "t"]]]` |
| <big>$$ \int \frac{dx}{x} $$ </big>`\int \frac{dx}{x}`     | `["Integrate", ["Divide", 1, "x"], "x"]`                                |
| <big>$$ 123.4(567) $$ </big>`123.4(567)`                   | `123.4(567)`                                                            |
| <big>$$ 123.4\overline{567} $$ </big>`123.4\overline{567}` | `123.4(567)`                                                            |
| <big>$$ \|a+\|b\|+c\| $$ </big>`                           | a+                                                                      | b   | +c  | `   | `["Abs", ["Add", "a", ["Abs", "b"], "c"]]` |
| <big>$$ \|\|a\|\|+\|b\| $$ </big>`                         |                                                                         | a   |     | +   | b                                          | `   | `["Add", ["Norm", "a"], ["Abs", "b"]]` |

The Compute Engine Natural Parser will apply maximum effort to parse the input
string as LaTeX, even if it includes errors. If errors are encountered, the
resulting expression will have its `expr.isValid` property set to `false`. An
`["Error"]` expression will be produced where a problem was encountered. To get
the list of all the errors in an expression, use `expr.errors` which will return
an array of `["Error"]` expressions.

{% readmore "/compute-engine/guides/expressions/#errors" %} Read more about the
**errors** that can be returned. {% endreadmore %}

## Serializing to LaTeX

**To serialize an expression to a LaTeX string**, read the `expr.latex`
property.

```javascript
const ce = new ComputeEngine();

console.log(ce.serialize(['Add', ['Power', 'x', 3], 2]));
// ➔  "x^3 + 2"
```

## Customizing Parsing and Serialization

**To customize the behavior of `ce.parse()` and `expr.latex`** set the
`ce.latexOptions` property.

Example of customization:

- whether to use an invisible multiply operator between expressions
- whether the input LaTeX should be preserved as metadata in the output
  expression
- how to handle encountering unknown identifiers while parsing
- whether to use a dot or a comma as a decimal marker
- how to display imaginary numbers and infinity
- whether to format numbers using engineering or scientific format
- what precision to use when formatting numbers
- how to serialize an explicit or implicit multiplication (using `\times`,
  `\cdot`, etc...)
- how to serialize functions, fractions, groups, logical operators, intervals,
  roots and powers.

The type of `ce.latexOptions` is
<kbd>[NumberFormattingOptions](/docs/compute-engine/?q=NumberFormattingOptions)
& [ParseLatexOptions](/docs/compute-engine/?q=ParseLatexOptions) &
[SerializeLatexOptions](/docs/compute-engine/?q=SerializeLatexOptions)</kbd>.
Refer to these interfaces for more details.

```javascript
const ce = new ComputeEngine();
ce.latexOptions = {
  precision: 3,
  decimalMarker: '{,}',
};

console.log(ce.parse('\\frac{1}{7}').N().latex);
// ➔ "0{,}14\\ldots"
```

### Customizing the Decimal Marker

The world is
[about evenly split](https://en.wikipedia.org/wiki/Decimal_separator#/media/File:DecimalSeparator.svg)
between using a dot or a comma as a decimal marker.

By default, the ComputeEngine is configured to use a dot.

**To use a comma as a decimal marker**, set the `decimalMarker` option:

```ts
ce.latexOptions.decimalMarker = '{,}';
```

Note that in LaTeX, in order to get the correct spacing around the comma, it
must be surrounded by curly brackets.

### Customizing the Number Formatting

There are several options that can be used to customize the formating of numbers
when using `expr.latex`. Note that the format of numbers in JSON serialization
is standardized and cannot be customized.

The options are members of `ce.latexOptions`.

- `notation`
  - `"auto"`: (**default**) the whole part may take any value
  - `"scientific"`: the whole part is a number between 1 and 9, there is an
    exponent, unless it is 0.
  - `"engineering"`: the whole part is a number between 1 and 999, the exponent
    is a multiple of 3.
- `avoidExponentsInRange`
  - if `null`, exponents are always used
  - otherwise, it is a tuple of two values representing a range of exponents. If
    the exponent for the number is within this range, a decimal notation is
    used. Otherwise, the number is displayed with an exponent. The default is
    `[-6, 20]`
- `exponentProduct`: a LaTeX string inserted before an exponent, if necessary.
  Default is `"\cdot"`. Another popular value is `"\times"`.
- `beginExponentMarker` and `endExponentMarker`: LaTeX strings used as template
  to format an exponent. Default values are `"10^{"` and `"}"` respectively.
  Other values could include `"\mathrm{E}{"` and `"}"`.
- `truncationMarker`: a LaTeX string used to indicate that a number has more
  precision than what is displayed. Default is `"\ldots"`
- `beginRepeatingDigits` and `endRepeatingDigits`: LaTeX strings used a template
  to format repeating digits, as in `1.333333333...`. Default is `"\overline{"`
  and `"}"`. Other popular values are `"("` and `")"`.
- `imaginaryUnit`: the LaTeX string used to represent the imaginary unit symbol.
  Default is `"\imaginaryI"`. Other popular values are `"\mathrm{i}"`.
- `positiveInfinity` and `negativeInfinity` the LaTeX strings used to represent
  positive and negative infinity, respectively. Defaults are `"\infty"` and
  `"-\infty"`.
- `notANumber`: the LaTeX string to represent the number NaN. Default value is
  `"\operatorname{NaN}"`.
- `groupSeparator`: the LaTeX string used to separate group of digits, for
  example thousands. Default is `"\,"`. To turn off group separators, set to
  `""`

```ts
console.log(ce.parse('700').latex);
// ➔ "700"
console.log(ce.parse('123456.789').latex);
// ➔ "123\,456.789"

// Always use the scientific notation
ce.latexOptions.notation = 'scientific';
ce.latexOptions.avoidExponentsInRange = null;
ce.latexOptions.exponentProduct = '\\times';

console.log(ce.parse('700').latex);
// ➔ "7\times10^{2}"
console.log(ce.parse('123456.789').latex);
// ➔ "1.234\,567\,89\times10^{5}"
```

## Customizing the Serialization Style

Some category of expressions can be serialized in different ways based on
conventions or personal preference. For example, a group can be indicate by
simple parentheses, or by a `\left...\right` command. A fraction can be
indicated by a `\frac{}{}` command or by a `{}{}^{-1}`.

The compute engine includes some built-in defaults, but they can be customized
as desired. For example to always represent fractions with a `\frac{}{}`
command:

```ts
ce.latexSyntax.options.fractionStyle = () => 'quotient';
```

If using a mathfield, the compute engine associated with the mathfield is
available as `mf.computeEngine`.{.notice--info}

The style option handler has two arguments:

- the expression fragment being styled
- the depth/level of the expression in the overall expression

For example, to serialize rational numbers and division deeper than level 2 as
an inline solidus:

```ts
ce.latexSyntax.options.fractionStyle = (expr, level) =>
  head(expr) === 'Rational' || level > 2 ? 'inline-solidus' : 'quotient';
```

### Function Application

`["Sin", "x"]`

|               |                      |                        |
| :------------ | :------------------- | :--------------------- |
| `"paren"`     | `\sin(x)`            | $$\sin(x)$$            |
| `"leftright"` | `\sin\left(x\right)` | $$\sin\left(x\right)$$ |
| `"big"`       | `\sin\bigl(x\bigr)`  | $$\sin\bigl(x\bigr)$$  |
| `"none"`      | `\sin x`             | $$\sin x$$             |

### Group

`["Multiply", "x", ["Add", "a", "b"]]`

|               |                     |                       |
| :------------ | :------------------ | :-------------------- |
| `"paren"`     | `x(a+b)`            | $$x(a+b)$$            |
| `"leftright"` | `x\left(a+b\right)` | $$x\left(a+b\right)$$ |
| `"big"`       | `x\bigl(a+b\bigr)`  | $$x\bigl(a+b\bigr)$$  |
| `"none"`      | `x a+b`             | $$ x a+b$$            |

### Root

|              |     |     |
| :----------- | :-- | :-- |
| `"radical"`  |     |     |
| `"quotient"` |     |     |
| `"solidus"`  |     |     |

### Fraction

|                    |     |     |
| :----------------- | :-- | :-- |
| `"quotient"`       |     |     |
| `"inline-solidus"` |     |     |
| `"nice-solidus"`   |     |     |
| `"reciprocal"`     |     |     |
| `"factor"`         |     |     |

### Logic

`["And", "p", "q"]`

|                    |                    |                      |
| :----------------- | :----------------- | :------------------- |
| `"word"`           | `a \text{ and } b` | $$a \text{ and } b$$ |
| `"boolean"`        |                    |                      |
| `"uppercase-word"` |                    |                      |
| `"punctuation"`    |                    |                      |

### Power

|              |     |     |
| :----------- | :-- | :-- |
| `"root"`     |     |     |
| `"solidus"`  |     |     |
| `"quotient"` |     |     |

### Numeric Sets

|                 |     |     |
| :-------------- | :-- | :-- |
| `"compact"`     |     |     |
| `"regular"`     |     |     |
| `"interval"`    |     |     |
| `"set-builder"` |     |     |

## Customizing the LaTeX Dictionary

The <a href ="/math-json/">MathJSON format</a> is independent of any source or
target language (LaTeX, MathASCII, etc...) or of any specific interpretation of
the identifiers used in a MathJSON expression (`"Pi"`, `"Sin"`, etc...).

A **LaTeX dictionary** defines how a MathJSON expression can be expressed as a
LaTeX string (**serialization**) or constructed from a LaTeX string
(**parsing**).

It includes definitions such as:

- "_The `Power` function is represented as "`x^{n}`"_"
- "_The `Divide` function is represented as "`\frac{x}{y}`"_".

The Compute Engine includes a default LaTeX dictionary to parse a number of
common math expressions.

**To extend the LaTeX syntax** pass a `latexDictionary` option to the Compute
Engine constructor.

To extend the default dictionary, call `ComputeEngine.getLatexDictionary()`.

To remove entries from the default dictionary, filter them.

```javascript
const ce = new ComputeEngine({
  latexDictionary: [
    // Remove the `PlusMinus` entry from the default dictionary...
    ...ComputeEngine.getLatexDictionary().filter((x) => x.name !== 'PlusMinus'),
    // ... and add one for the `\smoll` command
    {
      trigger: ['\\smoll'],
      parse: (parser: Parser): Expression => {
        return [
          'Divide',
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"],
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"],
        ];
      },
    },
  ],
});

console.log(ce.parse('\\smoll{1}{5}').json);
// ➔ ["Divide", 1, 5]
```
