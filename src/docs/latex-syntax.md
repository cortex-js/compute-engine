---
title: Latex Syntax
permalink: /guides/math-json/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

## Parsing and Serializing Latex

The CortexJS Compute Engine manipulates MathJSON expressions. It can also
convert Latex strings to MathJSON expressions (**parsing**) and output MathJSON
expressions as Latex string (**serializing**).

**To transform Latex to MathJSON**, use the `parse()` function.

**To transform MathJSON to Latex**, use the `serialize()` function.

```javascript
import { parse, serialize } from 'math-json';

const expr = parse('\\frac{\\pi}{2}');
console.log(expr);
// ➔ ["Divide", "Pi", 2]

const latex = serialize(expr);
console.log(latex);
// ➔ \frac{\pi}{2}
```

The behavior of `parse()` and `serialize()` can be customized by passing an 
optional argument:

```javascript
import {  serialize } from 'math-json';

console.log(serialize(1/3, {
    precision: 3,
    decimalMarker: ","
}););
// ➔ 0,333
```
<div class='read-more'><a href="/docs/compute-engine/#(NumberFormattingOptions%3Atype)">Read more about <strong><kbd>NumberFormattingOptions</kbd></strong> which apply to both <kbd>parse()</kbd> and <kbd>serialize()</kbd><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

<div class='read-more'><a href="/docs/compute-engine/#(ParseLatexOptions%3Atype)">Read more about <strong><kbd>ParseLatexOptions</kbd></strong> which apply to <kbd>parse()</kbd><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

<div class='read-more'><a href="/docs/compute-engine/#(SerializeLatexOptions%3Atype)">Read more about <strong><kbd>SerializeLatexOptions</kbd></strong> which apply to <kbd>serialize()</kbd><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


## Advanced Usage

**To customize the Latex syntax**, including defining the vocabulary and syntax, create an instance of `LatexSyntax`.


```javascript
import { LatexSyntax } from 'math-json';
const latexSyntax = new LatexSyntax();
const expr = latexSyntax.parse('\\frac{\\pi}{2}');
console.log(expr);
const latex = latexSyntax.serialize(expr);
console.log(latex);
```
The `LatexSyntax` constructor can be passed options to customize the parsing, as well as dictionaries defining the syntax and vocabulary.

<div class='read-more'><a href="/guides/compute-engine/dictionaries/">Read more about <strong>Dictionaries</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


For example, the configuration below will result in parsing a Latex string as a
sequence of Latex tokens. It uses no dictionary (since only tokens are returned) and set the options to avoid modifying the raw stream of Latex tokens.

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
// ➔ ["LatexTokens", "'\frac'", "'<{>'", "'\pi'", "'<}>'", "'<{>'",  2, "'<}>'"]
```
