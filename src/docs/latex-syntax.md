---
title: Latex Syntax
permalink: /guides/math-json/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Parsing and Serializing Latex

The CortexJS Compute Engine manipulates MathJSON expressions. It can also
convert Latex strings to MathJSON expressions (**parsing**) and output MathJSON
expressions as Latex string (**serializing**).

**To transform Latex to MathJSON**, use the `parse()` function.

**To transform MathJSON to Latex**, use the `serialize()` function.

```javascript
import { parse, serialize } from '@cortex-js/compute-engine'

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
import {  serialize } from '@cortex-js/compute-engine'

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
import { LatexSyntax } from '@cortex-js/compute-engine'
const latexSyntax = new LatexSyntax();
const expr = latexSyntax.parse('\\frac{\\pi}{2}');
console.log(expr);
const latex = latexSyntax.serialize(expr);
console.log(latex);
```
The `LatexSyntax` constructor can be passed some options to customize the 
parsing and serializing, as well as dictionaries defining the syntax and vocabulary.

<div class='read-more'><a href="/guides/compute-engine/dictionaries/">Read more about <strong>Dictionaries</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

**To change the Latex syntax options after a `LatexSyntax` instance has been
created**, change the `options` property.

The `LatexSyntax` class has an `options` property with the following keys.

### Number Formatting Options 

<div class=symbols-table>

| Option |  |
| :--- | :--- |
| `precision` | |
| `positiveInfinity` | |
| `negativeInfinity` | | 
| `notANumber` | |
| `decimalMarker` | The string separating the whole portion of a number from the fractional portion, i.e. the '.' in `3.1415`. |
| `groupSeparator` | The separator between groups of digits, used to improve readability of numbers with many digits |
| `exponentProduct` | |
| `beginExponentMarker` | |
| `endExponentMarker` | |
| `notation`| `engineering` `auto` `scientific` |
| `truncationMarker` | |
| `beginRepeatingDigits` | | 
| `endRepeatingDigits` | | 
| `imaginaryNumber`| |

</div>


### Serialization Options


<div class=symbols-table>

| Option |  |
| :--- | :--- |
| `invisibleMultiply` | Latex string used to render an invisible multiply, e.g. in `2x`. Leave it empty to join the adjacent terms, or use `\cdot` to insert a `\cdot` operator between them, i.e. `2\cdot x` | 
| `invisiblePlus` | Latex string used for an invisible plus, e.g. in '1 3/4'. Leave it empty to join the main number and the fraction, i.e. render it as `1\frac{3}{4}`, or use `+` to insert a `+` operator between them, i.e. `1+\frac{3}{4}` | 
| `multiply` | Latex string used for an explicit multiply operator: for example `\times` or `\cdot` |
</div>

### Parsing Options


<div class=symbols-table>

| Option |  |
| :--- | :--- |
| `invisibleOperator` | If a symbol follows a number, consider them separated by this invisible operator. Default: `Multiply` |
| `skipSpace` | If true, ignore space characters | 
| `parseArgumentsOfUnknownLatexCommands` | When an unknown latex command is encountered, attempt to parse any arguments it may have.<br> For example, `\foo{x+1}` would produce `["\foo", ["Add", "x", 1]]` if this property is true, `["LatexSymbols", "\foo", "<{>", "x", "+", 1, "<{>"]` otherwise. | 
| `parseNumbers` |  When a number is encountered, parse it.<br> Otherwise, return each token making up the number (minus sign, digits, decimal separator, etc...) |
|  `invisiblePlusOperator` | If this setting is not empty, when a number is immediately followed by a fraction, assume that the fraction should be added to the number, that is that there is an invisible plus operator between the two.<br> For example with `2\frac{3}{4}`<ul><li> when `invisiblePlusOperator` is `"Add"` : `["Add", 2, ["Divide", 3, 4]]`</li><li> when `invisiblePlusOperator` is `""`: `["Multiply", 2, ["Divide", 3, 4]]`</li></ul> |
| `promoteUnknownSymbols` | When a token is encountered at a position where a symbol could be parsed, if the token matches `promoteUnknownSymbols` it will be accepted as a symbol (an `unknown-symbol` error will still be triggered so that the caller can be notified). Otherwise, the symbol is rejected. |
| `ignoreCommands` | When one of these commands is encountered, it is skipped.<br> Useful for purely presentational commands such as `\displaystyle`| 
| `idempotentCommands` | When one these commands is encountered, its argument is parsed, as if the command was not present.<br> Useful for some presentational commands such as `\left`, `\bigl`, etc... |
| `promoteUnknownFunctions` | When a token is encountered at a position that could match a function call, and it is followed by an apply function operator (typically, parentheses), consider them to a be a function if the string of tokens match this regular expression.<br>While this is a convenient shortcut, it is recommended to more explicitly define custom functions by providing an entry for them in a function dictionary (providing additional information about their arguments, etc...) and in a Latex translation dictionary (indicating what Latex markup corresponds to the function).<br>Example:<br> By default, `f(x)` is parsed as `["Multiply", "f", "x"]`.<br>After `promoteUnknownFunctions = /^[fg]$/``` , `f(x)` is parsed as `["f", "x"]`|
| `preserveLatex` | If true, the expression will be decorated with the Latex fragments corresponding to each elements of the expression | 
</div>


### Example: Parsing Raw Latex

The configuration below will result in parsing a Latex string as a
sequence of Latex tokens, without any interpration. It uses no dictionary (since only tokens are returned) and set the options to avoid modifying the raw stream of Latex tokens.

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
