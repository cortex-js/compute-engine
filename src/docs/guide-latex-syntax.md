---
title: Parsing and Serializing LaTeX
permalink: /compute-engine/guides/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
render_math_in_document: true
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

**To create a new instance of the Compute Engine**, use the
`new ComputeEngine()` constructor.

```javascript
const ce = new ComputeEngine();
```

<hr>

**To input math using an interactive mathfield**, use [MathLive](/mathlive/).

A MathLive `<math-field>` DOM element works like a `<textarea>` in HTML, but for
math. It provides its content as a LaTeX string or a MathJSON expression, ready
to be used with the Compute Engine.

{% readmore "/mathlive/" %} Read more about the MathLive <strong>mathfield
element</strong> {% endreadmore %}

All the mathfields on the page share a Compute Engine instance, which is
available as `MathfieldElement.computeEngine`.

```javascript
const ce = MathfieldElement.computeEngine;
```

You can associate a customized compute engine with the mathfields in the
document:

```js
const ce = new ComputeEngine();
MathfieldElement.computeEngine = ce;
console.log(mfe.expression.json);
```

<hr>

**To parse a LaTeX string as a MathJSON expression**, call the `ce.parse()`
function.

```javascript
console.log(ce.parse('5x + 1').json);
// ➔  ["Add", ["Multiply", 5, "x"], 1]
```

By default, `ce.parse()` return a
[canonical expression](/compute-engine/guides/canonical-form/). To get a
non-canonical expression instead, use the `{canonical: false}` option: The
non-canonical form is closer to the literal LaTeX input.

```js
ce.parse('\\frac{7}{-4}').json;
// ➔  ["Rational", -7, 4]

ce.parse('\\frac{7}{-4}', { canonical: false }).json;
// ➔  ["Divide", 7, -4]
```

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
console.log(ce.box(['Add', ['Power', 'x', 3], 2]).latex);
// ➔  "x^3 + 2"
```

Alternatively, you can use the `ce.serialize()` function.

```javascript
console.log(ce.serialize(['Add', ['Power', 'x', 3], 2]));
// ➔  "x^3 + 2"
```

The `ce.serialize()` function takes an optional `canonical` argument. Set it to
`false` to prevent some transformations that are done by default to produce more
readable LaTeX, but that may not match exactly the MathJSON.

For example:

```javascript
console.log(ce.serialize(['Power', 'x', -1]));
// ➔  "\\frac{1}{x}"

console.log(ce.serialize(['Power', 'x', -1], { canonical: false }));
// ➔  "x^{-1}"
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
  Other values could include `"\operatorname{E}{"` and `"}"`.
- `truncationMarker`: a LaTeX string used to indicate that a number has more
  precision than what is displayed. Default is `"\ldots"`
- `beginRepeatingDigits` and `endRepeatingDigits`: LaTeX strings used a template
  to format repeating digits, as in `1.333333333...`. Default is `"\overline{"`
  and `"}"`. Other popular values are `"("` and `")"`.
- `imaginaryUnit`: the LaTeX string used to represent the imaginary unit symbol.
  Default is `"\imaginaryI"`. Other popular values are `"\operatorname{i}"`.
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

### Customizing the Serialization Style

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

The style option handler has two arguments:

- the expression fragment being styled
- the depth/level of the expression in the overall expression

For example, to serialize rational numbers and division deeper than level 2 as
an inline solidus:

```ts
ce.latexSyntax.options.fractionStyle = (expr, level) =>
  head(expr) === 'Rational' || level > 2 ? 'inline-solidus' : 'quotient';
```

#### Function Application

`["Sin", "x"]`

|               |                      |                        |
| :------------ | :------------------- | :--------------------- |
| `"paren"`     | `\sin(x)`            | $$\sin(x)$$            |
| `"leftright"` | `\sin\left(x\right)` | $$\sin\left(x\right)$$ |
| `"big"`       | `\sin\bigl(x\bigr)`  | $$\sin\bigl(x\bigr)$$  |
| `"none"`      | `\sin x`             | $$\sin x$$             |

#### Group

`["Multiply", "x", ["Add", "a", "b"]]`

|               |                     |                       |
| :------------ | :------------------ | :-------------------- |
| `"paren"`     | `x(a+b)`            | $$x(a+b)$$            |
| `"leftright"` | `x\left(a+b\right)` | $$x\left(a+b\right)$$ |
| `"big"`       | `x\bigl(a+b\bigr)`  | $$x\bigl(a+b\bigr)$$  |
| `"none"`      | `x a+b`             | $$ x a+b$$            |

#### Root

|              |     |     |
| :----------- | :-- | :-- |
| `"radical"`  |     |     |
| `"quotient"` |     |     |
| `"solidus"`  |     |     |

#### Fraction

|                    |     |     |
| :----------------- | :-- | :-- |
| `"quotient"`       |     |     |
| `"inline-solidus"` |     |     |
| `"nice-solidus"`   |     |     |
| `"reciprocal"`     |     |     |
| `"factor"`         |     |     |

#### Logic

`["And", "p", "q"]`

|                    |                    |                      |
| :----------------- | :----------------- | :------------------- |
| `"word"`           | `a \text{ and } b` | $$a \text{ and } b$$ |
| `"boolean"`        |                    |                      |
| `"uppercase-word"` |                    |                      |
| `"punctuation"`    |                    |                      |

#### Power

|              |     |     |
| :----------- | :-- | :-- |
| `"root"`     |     |     |
| `"solidus"`  |     |     |
| `"quotient"` |     |     |

#### Numeric Sets

|                 |     |     |
| :-------------- | :-- | :-- |
| `"compact"`     |     |     |
| `"regular"`     |     |     |
| `"interval"`    |     |     |
| `"set-builder"` |     |     |

## Customizing the LaTeX Dictionary

The <a href ="/math-json/">MathJSON format</a> is independent of any source or
target language (LaTeX, MathASCII, Python, etc...) or of any specific
interpretation of the identifiers used in a MathJSON expression (`"Pi"`,
`"Sin"`, etc...).

A **LaTeX dictionary** defines how a MathJSON expression can be expressed as a
LaTeX string (**serialization**) or constructed from a LaTeX string
(**parsing**).

The Compute Engine includes a default LaTeX dictionary to parse and serialize
common math expressions.

It includes definitions such as:

- "_The `Power` function is represented as "`x^{n}`"_"
- "_The `Divide` function is represented as "`\frac{x}{y}`"_".

Note that the dictionary will include LaTeX commands as triggers. LaTeX commands
are usually prefixed with a backslash, such as `\frac` or `\pm`. It will also
reference MathJSON identifiers. MathJSON identifiers are usually capitalized,
such as `Divide` or `PlusMinus` and are not prefixed with a backslash.

The Compute Engine includes a default LaTeX dictionary to parse and serialize
common math expressions.

**To extend the LaTeX syntax** update the `latexDictionary` property of the
Compute Engine

```javascript
const ce = new ComputeEngine();
ce.latexDictionary = [
  // Include all the entries from the default dictionary...
  ...ce.latexDictionary,
  // ...and add the `\smoll{}{}` command
  {
    // The parse handler below will be invoked when this LaTeX command is encountered
    latexTrigger: '\\smoll',
    parse: (parser) => {
      // We're expecting two arguments, so we're calling
      // `parseGroup()` twice. If `parseGroup()` returns `null`,
      // we assume that the argument is missing.
      return [
        'Divide',
        parser.parseGroup() ?? ['Error', "'missing'"],
        parser.parseGroup() ?? ['Error', "'missing'"],
      ];
    },
  },
];

console.log(ce.parse('\\smoll{1}{5}').json);
// The "Divide" get represented as a "Rational" by default when
// both arguments are integers.
// ➔ ["Rational", 1, 5]
```

### LaTeX Dictionary Entries

Each entry in the LaTeX dictionary is an object with the following properties:

- `kind`: the kind of expression associated with this entry. Valid values are
  `prefix`, `postfix`, `infix`, `expression`, `function`, `symbol`,
  `environment` and `matchfix`. If not provided, the default is `expression`.
- `latexTrigger`: a sequence of LaTeX tokens that will trigger the entry. For
  example, `^{+}` or `\mathbb{D}`.
- `identifierTrigger`: a string, usually wrapped in a LaTeX command, that will
  trigger the entry. For example, if `identifierTrigger` is `floor`, the LaTeX
  command `\mathrm{floor}` or `\operatorname{floor}` will trigger the entry.
  Only one of `latexTrigger` or `identifierTrigger` should be provided. If kind
  is `environment`, only `identifierTrigger` is valid.
- `parse`: a function that will be invoked when the trigger is encountered in
  the LaTeX input. It will be passed a `parser` object that can be used to parse
  the input. The `parse` function should return a MathJSON expression. See below
  for more info about parsing.
- `serialize`: a function that will be invoked when the `expr.latex` property is
  read. It will be passed a `serializer` object that can be used to serialize
  the expression. The `serialize` function should return a LaTeX string. See
  below for more info about serialization.
- `name`: the name of the MathJSON identifier associated with this entry. If
  provided, a default `parse` handler will be used that is equivalent to:
  `parse: name`. The `name` property must be unique. However, multiple entries
  can have different triggers that produce the same expression. This is useful
  for synonyms, such as `\operatorname{floor{` and `\lfloor`...`\rfloor`.

The most general type of entry is one using `expression` as the `kind`, which is
also the default if no `kind` is provided. In this case, the `parse` handler
will be invoked when the trigger is encountered in the LaTeX input. The `parse`
handler will be passed a `parser` object that can be used to parse the input.
The `parse` handler should return a MathJSON expression.

The `function` kind is a special case of `expression` where the expression is a
function, possibly using mutly-character identifiers, as in
`\operatorname{concat}`. The `trigger` property defines the name of the
function, not a sequence of tokens. The parse handler should return the
idenfitier corresponding to the function, such as `Concatenate`. As a shortcut,
the `parse` handler can be provided as an Expression. For example:

```javascript
{
  kind: 'function',
  identifierTrigger: 'concat',
  parse: 'Concatenate'
}
```

The `infix` kind is used for binary operators. The `parse` handler will be
passed a `parser` object and the left-hand side of the operator. The `parser`
object can be used to parse the right-hand side of the expression. The `parse`
handler should return a MathJSON expression.

```javascript
{
  kind: 'infix',
  latexTrigger: '\\oplus',
  parse: (parser, lhs) => {
    return ['Concatenate', lhs, parser.parseExpression()];
  },
}
```

The `prefix` kind is used for unary operators. The `parse` handler will be
passed a `parser` object. The `parse` handler should return a MathJSON
expression.

```javascript
{
  kind: 'prefix',
  latexTrigger: '\\neg',
  parse: (parser, lhs) => {
    return ['Negate', lhs];
  },
}
```

The `postfix` kind is used for postfix operators. The `parse` handler will be
passed a `parser` object and the left-hand side of the operator. The `parse`
handler should return a MathJSON expression.

```javascript
{
  kind: 'postfix',
  latexTrigger: '\\!',
  parse: (parser, lhs) => {
    return ['Factorial', lhs];
  },
}
```

The `environment` kind is used for LaTeX environments. The `identifierTrigger`
property in that case is the name of the environment. The `parse` handler will
be passed a `parser` object. The `parseTabular()` method can be used to parse
the rows and columns of the environment. It returns a two dimensional array of
expressions. The `parse` handler should return a MathJSON expression.

```javascript
{
  kind: 'environment',
  identifierTrigger: 'matrix',
  parse: (parser) => {
    const content = parser.parseTabular();
    return ['Matrix', ['List', content.map(row => ['List', row.map(cell => cell)])]];
  },
}
```

The `matchfix` kind is used for LaTeX commands that are used to enclose an
expression. The `openTrigger` and `closeTrigger` indicate the LaTeX commands
that enclose the expression. The `parse` handler is passed a `parser` object and
the "body" (the expression between the open and close delimiters). The `parse`
handler should return a MathJSON expression.

```javascript
{
  kind: 'matchfix',
  openTrigger: '\\lvert',
  closeTrigger: '\\rvert',
  parse: (parser, body) => {
    return ['Abs', body];
  },
}
```

### Parsing

When parsing a LaTeX string, the first step is to tokenize the string according
to the LaTeX syntax. For example, the input string `\\frac{ab}{10}` will result
in the tokens `["\\frac", "{", "a", "b", "}", "{", "1", "0", "}"]`. Note that
each LaTeX command is a single token, but that digits and ordinary letters are
each separate tokens.

The `parse` handler is invoked when the trigger is encountered in the LaTeX
token strings.

A common case is to return from the parse handler a MathJSON identifier for a
symbol or function.

For example, let's say you wanted to map the LaTeX command `\div` to the
MathJSON `Divide` function. You would write:

```javascript
{
  latexTrigger: '\\div',
  parse: (parser) => {
    return 'Divide';
  },
}
```

As a shortcut, you can also write:

```javascript
{
  latexTrigger: '\\div',
  parse: () => 'Divide'
}
```

Or even more succintly:

```javascript
{
  latexTrigger: '\\div',
  parse: 'Divide'
}
```

The LaTeX `\div(1, 2)` would then produce the MathJSON expression
`["Divide", 1, 2]`. Note that the arguments are provided as comma-separated,
parenthesized expressions, not as LaTeX arguments in curly brackets.

If you need to parse some more complex LaTeX syntax, you can use the `parser`
argument of the `parse` handler. The `parser` object has numerous methods to
help you parse the LaTeX string:

- `parser.peek` is the current token.
- `parser.index` is the index of the current token. If backtracking is
  necessary, it is possible to set the index to a previous value.
- `parser.nextToken()` returns the next token and advances the index.
- `parser.skipSpace()` in LaTeX math mode, skip over "space" which includes
  space tokens, and empty groups `{}`. Whether space tokens are skipped or not
  depends on the `skipSpace` option.
- `parser.skipVisualSpace()` skip over "visual space" which includes space
  tokens, empty groups `{}`, and commands such as `\,` and `\!`.
- `parser.match(token: LatexToken)` return true if the next token matches the
  argument, or `null` otherwise.
- `parser.matchAll(tokens)` return true if the next tokens match the argument,
  an array of tokens, or `null` otherwise.
- `parser.matchAny(tokens: LatexToken[])` return the next token if it matches
  any of the token in the argument or `null` otherwise.
- `parser.matchChar()` return the next token if it is a plain character (e.g.
  'a', '+'...), or the character corresponding to a hex literal (^^ and ^^^^) or
  the `\char` and `\unicode` commands
- `parser.parseGroup()` return an expression if the next token is a group begin
  token `{` followed by a sequence of LaTeX tokens until a group end token `}`
  is encountered, or `null` otherwise.
- `parser.parseToken()` return an expression if the next token can be parsed as
  a MathJSON expression, or `null` otherwise. This is useful when the argument
  of a LaTeX command can be a single token, for example for `\sqrt5`. Some, but
  not all, LaTeX commands accept a single token as an argument.
- `parser.parseOptionalGroup()` return an expression if the next token is an
  optional group begin token `[` followed by a sequence of LaTeX tokens until an
  optional group end token `]` is encountered, or `null` otherwise.
- `parser.parseExpression()` return an expression if the next tokens can be
  parsed as a MathJSON expression, or `null` otherwise. After this call, there
  may be some tokens left to parse.
- `parser.parseArguments()` return an array of expressions if the next tokens
  can be parsed as a sequence of MathJSON expressions separated by a comma, or
  `null` otherwise. This is useful to parse the argument of a function. For
  example with `f(x, y, z)`, the arguments would be `[x, y, z]`.

If the `parse` handler returns `null`, the parser will continue to look for
another handler that matches the current token.

Note there is a pattern in the names of the methods of the parser. The `match`
prefix means that the method will return the next token if it matches the
argument, or `null` otherwise. These methods are more primitive. The `parse`
prefix indicates that the method will return a MathJSON expression or `null`.

The most common usage is to call `parser.parseGroup()` to parse a group of
tokens as an argument to a LaTeX command.

For example:

```javascript
{
  latexTrigger: '\\div',
  parse: (parser) => {
    return ['Divide', parser.parseGroup(), parser.parseGroup()];
  },
}
```

In this case, the LaTeX input `\div{1}{2}` would produce the MathJSON expression
`["Divide", 1, 2]` (note the use of the curly brackets, rather than the
parentheses in the LaTeX input).

If we wanted instead to treat the `\div` command as a binary operator, we could
write:

```javascript
{
  latexTrigger: '\\div',
  kind: 'infix',
  parse: (parser, lhs) => {
    return ['Divide', lhs, parser.parseExpression()];
  },
}
```

By using the `kind: 'infix'` option, the parser will automatically insert the
left-hand side of the operator as the first argument to the `parse` handler.

### Serializing

When serializing a MathJSON expression to a LaTeX string, the `serialize`
handler is invoked. You must specify a `name` property to associate the
serialization handler with a MathJSON identifier.

```javascript
{
  name: "Concatenate",
  latexTrigger: "\\oplus",
  serialize: (serializer, expr) =>
    "\\oplus" + serializer.wrapArguments(expr),
  evaluate: (ce, args) => {
    let result = '';
    for (const arg of args) {
      val = arg.numericValue;
      if (val === null || ce.isComplex(val) || Array.isArray(val)) return null;
      if (ce.isBignum(val)) {
        if (!val.isInteger() || val.isNegative()) return null;
        result += val.toString();
      } else if (typeof val === 'number') {
        if (!Number.isInteger(val) || val < 0) return null;
        result += val.toString();
      }
    }
    return ce.parse(result);
  },
}
```

In the example above, the LaTeX command `\oplus` is associated with the
`Concatenate` function. The `serialize` handler will be invoked when the
`expr.latex` property is read.

Note that we did not provide a `parse` handler: if a `name` property is
provided, a default `parse` handler will be used that is equivalent to:
`parse: name`.

It is possible to have multiple definitions with the same triggers, but the
`name` property must be unique. The record with the `name` property will be used
to serialize the expression. A `serialize` handler is invalid if the `name`
property is not provided.

## Using a New Function with a Mathfield

You may also want to use your new function with a mathfield.

First you need to define a LaTeX macro so that the mathfield knows how to render
this command. Let's define the `\smallfrac` macro.

```js
const mfe = document.querySelector('math-field');

mfe.macros = {
  ...mfe.macros,
  smallfrac: {
    args: 2,
    def: '{}^{#1}\\!\\!/\\!{}_{#2}',
  },
};
```

The content of the `def` property is a LaTeX fragment that will be used to
render the `\\smallfrac` command.

The `#1` token in `def` is a reference to the first argument and `#2` to the
second one.

You may also want to define an inline shortcut to make it easier to input the
command.

With the code below, we define a shortcut "smallfrac".

When typed, the shortcut is replaced with the associated LaTeX.

The `#@` token represents the argument to the left of the shortcut, and the `#?`
token represents a placeholder to be filled by the user.

```js
mfe.inlineShortcuts = {
  ...mfe.inlineShortcuts,
  smallfrac: '\\smallfrac{#@}{#?}',
};
```

{% readmore "/mathlive/guides/shortcuts/" %} Learn more about <strong>Key
Bindings and Inline Shortcuts</strong> {% endreadmore %}

You can now parse the input from a mathfield using:

```js
console.log(ce.parse(mfe.value).json);
```

Alternatively, you can associate the customized compute engine with the
mathfields in the document:

```js
MathfieldElement.computeEngine = ce;
console.log(mfe.getValue('math-json'));
```
