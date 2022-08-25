---
title: Parsing and Serializing LaTeX
permalink: /compute-engine/guides/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
---


The CortexJS Compute Engine manipulates MathJSON expressions. It can also
convert LaTeX strings to MathJSON expressions (**parsing**) and output MathJSON
expressions as LaTeX string (**serializing**).{.xl}

**To parse a LaTeX string to MathJSON**, call the `ce.parse()` function.

**To serialize an expression to a LaTeX string**, read the `expr.latex`
property.

```javascript
const ce = new ComputeEngine();

console.log(ce.parse('5x + 1').json);
// ➔  ["Add", ["Multiply", 5, "x"], 1]

console.log(ce.serialize(['Add', ['Power', 'x', 3], 2]));
// ➔  "x^3 + 2"
```

**To input math using an interactive mathfield**, use [MathLive](/mathlive/).

A MathLive mathfield works like a textarea in HTML, but for math. It provides
its content as a LaTeX string or a MathJSON expression, ready to be used with
the Compute Engine.

{% readmore "/mathlive/" %} Read more about the MathLive <strong>mathfield element</strong>
{% endreadmore %}

The behavior of `expr.parse()` and `expr.latex` can be customized by setting
`ce.latexOptions`.

```javascript
const ce = new ComputeEngine();
ce.latexOptions = {
  precision: 3,
  decimalMarker: '{,}',
};

console.log(ce.parse('\\frac{1}{7}').N().latex);
// ➔ "0{,}14\\ldots"
```

## Customizing the Decimal Marker

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

A **LaTeX dictionary** defines how a MathJSON expression can be expressed into
a LaTeX (**serialization**) or constructed LaTeX (**parsing**).

It includes definitions such as:

- "_The `Power` function is represented as "`x^{n}`"_"
- "_The `Divide` function is represented as "`\frac{x}{y}`"_".


The Compute Engine includes a default LaTeX dictionary to parse a number of common
math expressions.

**To extend the LaTeX syntax** pass a `latexDictionary` option to the Compute
Engine constructor.

To extend the default dictionary, call `ComputeEngine.getLatexDictionary()`.

```javascript
const ce = new ComputeEngine({
  latexDictionary: [
    ...ComputeEngine.getLatexDictionary(),
    {
      trigger: ['\\smoll'],
      requiredLatexArg: 2,
      parse: (parser: Parser): Expression => {
        return [
          'Divide',
          parser.matchRequiredLatexArgument() ?? 'Missing',
          parser.matchRequiredLatexArgument() ?? 'Missing',
        ];
      },
    },
  ],
});

console.log(ce.parse('\\smoll{1}{5}').json);
// ➔ ["Rational", 1, 5]
```
