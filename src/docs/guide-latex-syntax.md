---
title: Parsing and Serializing LaTeX
permalink: /compute-engine/guides/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
---

The CortexJS Compute Engine manipulates MathJSON expressions. It can also
convert LaTeX strings to MathJSON expressions (**parsing**) and output MathJSON
expressions as LaTeX string (**serializing**).{.xl}

**To parse a LaTeX string as MathJSON expression**, call the `ce.parse()` function.

```javascript
const ce = new ComputeEngine();

console.log(ce.parse('5x + 1').json);
// ➔  ["Add", ["Multiply", 5, "x"], 1]
```


**To input math using an interactive mathfield**, use [MathLive](/mathlive/).

A MathLive `<math-field>` DOM element works like a `<textarea>` in HTML, but for
math. It provides its content as a LaTeX string or a MathJSON expression, ready
to be used with the Compute Engine.

{% readmore "/mathlive/" %} Read more about the MathLive <strong>mathfield
element</strong> {% endreadmore %}


## The Compute Engine Natural Parser

Unlike a programming language, mathematical notation is surprisingly ambiguous 
and full of idiosyncrasies. Mathematicians frequently invent new notations,
or have their own preferences to represent even common concepts.

The Compute Engine Natural Parser interprets expressions using the notation 
you are already familiar with. Write as you would on a blackboard, and 
get back a semantic representation as an expression ready to be processed.

| LaTeX| MathJSON |
| :--- | :--- |
| <big>$$ \sin 3t + \cos 2t $$ </big>`\sin 3t + \cos 2t`  |  `["Add", ["Sin", ["Multiply", 3, "t"]], ["Cos", ["Multiply", 2, "t"]]]` |
| <big>$$ \int \frac{dx}{x} $$ </big>`\int \frac{dx}{x}`  |  `["Integrate", ["Divide", 1,  "x"], "x"]` |
| <big>$$ 123.4(567) $$ </big>`123.4(567)`  |  `123.4(567)` |
| <big>$$ 123.4\overline{567} $$ </big>`123.4\overline{567}` |  `123.4(567)` |
| <big>$$ \|a+\|b\|+c\| $$ </big>`|a+|b|+c|`  |  `["Abs", ["Add", "a", ["Abs", "b"], "c"]]` |
| <big>$$ \|\|a\|\|+\|b\| $$ </big>`||a||+|b|`  |  `["Add", ["Norm", "a"], ["Abs", "b"]]` |


The Compute Engine Natural Parser will apply maximum effort to parse the input string as LaTeX,
even if it includes errors. If errors are encountered, the resulting expression
will have its `expr.isValid` property set to `false`. An `["Error"]` expression
will be produced where a problem was encountered. To get the list of all the
errors in an expression, use `expr.errors` which will return an array of
`["Error"]` expressions.

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


**To customize the behavior of `expr.parse()` and `expr.latex`** set the
`ce.latexOptions` property.

Example of customization:

- whether to use an invisible multiply operator between expressions
- whether the input LaTeX should be preserved as metadata in the output
  expression
- how to handle encountering unknown symbols while parsing
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

## Custom LaTeX Dictionary

The <a href ="/math-json/">MathJSON format</a> is independent of any source or
target language (LaTeX, MathASCII, etc...) or of any specific interpretation of
the symbols used in a MathJSON expression (`"Pi"`, `"Sin"`, etc...).

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
    ...ComputeEngine.getLatexDictionary().filter(x => x.name !== 'PlusMinus'),
    // ... and add one for the `\smoll` command
    {
      trigger: ['\\smoll'],
      parse: (parser: Parser): Expression => {
        return [
          'Divide',
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"],
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"]
        ];
      },
    },
  ],
});

console.log(ce.parse('\\smoll{1}{5}').json);
// ➔ ["Divide", 1, 5]
```
