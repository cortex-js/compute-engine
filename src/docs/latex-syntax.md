---
title: MathJSON Core
permalink: /guides/math-json-latex-syntax-api/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

# MathJSON Latex Syntax API

## Parsing and Serializing

To transform Latex to MathJSON, use the `parse()` function.

To transform MathJSON to Latex, use the `serialize()` function.

```javascript
import { parse, serialize } from 'math-json';

const expr = parse('\\frac{\\pi}{2}');
console.log(expr);
// ➔ ["Divide", "Pi", 2]

const latex = serialize(expr);
console.log(latex);
// ➔ \frac{\pi}{2}
```

The behavior of parse and serialize can be customized by passing an optional
argument:

```javascript
import {  serialize } from 'math-json';

console.log(serialize(1/3, {
    precision: 3,
    decimalMarker: ","
}););
// ➔ 0,333
```

## Advanced Usage

To improve performance, particularly when calling `parse()`/`serialize()`
repeatedly, use an instance of the `LatexSyntax` class. When the instance is
constructed, the dictionaries defining the syntax are compiled, and subsequent
invocations of the `parse()` and `serialize()` methods can skip that step.

```javascript
import { LatexSyntax } from 'math-json';
const latexSyntax = new LatexSyntax();
const expr = latexSyntax.parse('\\frac{\\pi}{2}');
console.log(expr);
const latex = latexSyntax.serialize(expr);
console.log(latex);
```

To customize the syntax, provide options to the constructor of `LatexSyntax`.

For example, the configuration below will result in parsing a Latex string as a
sequence of Latex tokens.

```js
const rawLatex = new LatexSyntax({
  parseArgumentsOfUnknownLatexCommands: false,
  promoteUnknownSymbols: /./,
  invisibleOperator: '',
  invisiblePlusOperator: '',
  dictionary: [],
  skipSpace: false,
});
const expr = rawLatex.parse('\\frac{\\pi}{2}');
console.log(expr);
// ➔ ["Latex", "'\frac'", "'<{>'", "'\pi'", "'<}>'", "'<{>'",  2, "'<}>'"]
```
