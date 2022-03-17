---
title: LaTeX Syntax
permalink: /compute-engine/guides/latex-syntax/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Parsing and Serializing LaTeX

The CortexJS Compute Engine manipulates MathJSON expressions. It can also
convert LaTeX strings to MathJSON expressions (**parsing**) and output MathJSON
expressions as LaTeX string (**serializing**).

**To transform LaTeX to MathJSON**, call the `ce.parse()` function.

**To transform MathJSON to LaTeX**, read the `expr.latex` property.

```javascript
import { parse, serialize } from '@cortex-js/compute-engine';

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

{% readmore "/docs/compute-engine/#(NumberFormattingOptions%3Atype)" %} Read
more about <strong><kbd>NumberFormattingOptions</kbd></strong> which apply to
both <kbd>parse()</kbd> and <kbd>serialize()</kbd> {% endreadmore %}

{% readmore "/docs/compute-engine/#(ParseLatexOptions%3Atype)" %} Read more
about <strong><kbd>ParseLatexOptions</kbd></strong> which apply to
<kbd>parse()</kbd> {% endreadmore %}

{% readmore "/docs/compute-engine/#(SerializeLatexOptions%3Atype)" %} Read more
about <strong><kbd>SerializeLatexOptions</kbd></strong> which apply to
<kbd>serialize()</kbd> {% endreadmore %}

## Advanced Usage

**To customize the LaTeX syntax**, including defining the vocabulary and syntax,
create an instance of `LatexSyntax`.

```javascript
import { LatexSyntax } from '@cortex-js/compute-engine';
const latexSyntax = new LatexSyntax();
const expr = latexSyntax.parse('\\frac{\\pi}{2}');
console.log(expr);
const latex = latexSyntax.serialize(expr);
console.log(latex);
```

The `LatexSyntax` constructor can be passed some options to customize the
parsing and serializing, as well as dictionaries defining the syntax and
vocabulary.

{% readmore "/compute-engine/guides/dictionaries/" %} Read more about
**Dictionaries** {% endreadmore %}

**To change the LaTeX syntax options after a `LatexSyntax` instance has been
created**, change the `options` property.

The `LatexSyntax` class has an `options` property with the following keys.

### Number Formatting Options

<div class=symbols-table>

| Option                 |                                                                                                            |
| :--------------------- | :--------------------------------------------------------------------------------------------------------- |
| `precision`            |                                                                                                            |
| `positiveInfinity`     |                                                                                                            |
| `negativeInfinity`     |                                                                                                            |
| `notANumber`           |                                                                                                            |
| `decimalMarker`        | The string separating the whole portion of a number from the fractional portion, i.e. the '.' in `3.1415`. |
| `groupSeparator`       | The separator between groups of digits, used to improve readability of numbers with many digits            |
| `exponentProduct`      |                                                                                                            |
| `beginExponentMarker`  |                                                                                                            |
| `endExponentMarker`    |                                                                                                            |
| `notation`             | `engineering` `auto` `scientific`                                                                          |
| `truncationMarker`     |                                                                                                            |
| `beginRepeatingDigits` |                                                                                                            |
| `endRepeatingDigits`   |                                                                                                            |
| `imaginaryNumber`      |                                                                                                            |

</div>

### Serialization Options

<div class=symbols-table>

| Option              |                                                                                                                                                                                                                             |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invisibleMultiply` | LaTeX string used to render an invisible multiply, e.g. in `2x`. Leave it empty to join the adjacent terms, or use `\cdot` to insert a `\cdot` operator between them, i.e. `2\cdot x`                                       |
| `invisiblePlus`     | LaTeX string used for an invisible plus, e.g. in '1 3/4'. Leave it empty to join the main number and the fraction, i.e. render it as `1\frac{3}{4}`, or use `+` to insert a `+` operator between them, i.e. `1+\frac{3}{4}` |
| `multiply`          | LaTeX string used for an explicit multiply operator: for example `\times` or `\cdot`                                                                                                                                        |

</div>

### Parsing Options

<div class=symbols-table>

| Option                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invisibleOperator`                    | If a symbol follows a number, consider them separated by this invisible operator. Default: `Multiply`                                                                                                                                                                                                                                                                                                                          |
| `skipSpace`                            | If true, ignore space characters                                                                                                                                                                                                                                                                                                                                                                                               |
| `parseArgumentsOfUnknownLatexCommands` | When an unknown latex command is encountered, attempt to parse any arguments it may have.<br> For example, `\foo{x+1}` would produce `["\foo", ["Add", "x", 1]]` if this property is true, `["LatexSymbols", "\foo", "<{>", "x", "+", 1, "<{>"]` otherwise.                                                                                                                                                                    |
| `parseNumbers`                         | When a number is encountered, parse it.<br> Otherwise, return each token making up the number (minus sign, digits, decimal separator, etc...)                                                                                                                                                                                                                                                                                  |
| `invisiblePlusOperator`                | If this setting is not empty, when a number is immediately followed by a fraction, assume that the fraction should be added to the number, that is that there is an invisible plus operator between the two.<br> For example with `2\frac{3}{4}`<ul><li> when `invisiblePlusOperator` is `"Add"` : `["Add", 2, ["Divide", 3, 4]]`</li><li> when `invisiblePlusOperator` is `""`: `["Multiply", 2, ["Divide", 3, 4]]`</li></ul> |
| `preserveLatex`                        | If true, the expression will be decorated with the LaTeX fragments corresponding to each elements of the expression                                                                                                                                                                                                                                                                                                            |

</div>

### Example: Parsing Raw LaTeX

The configuration below will result in parsing a LaTeX string as a sequence of
LaTeX tokens, without any interpration. It uses no dictionary (since only tokens
are returned) and set the options to avoid modifying the raw stream of LaTeX
tokens.

```js
const rawLatex = new LatexSyntax({
  parseArgumentsOfUnknownLatexCommands: false,
  parseUnknownToken: () => 'symbol',
  invisibleOperator: '',
  invisiblePlusOperator: '',
  missingSymbol: '',
  dictionary: [],
  skipSpace: false,
});
const expr = rawLatex.parse('\\frac{\\pi}{2}');
console.log(expr);
// ➔ ["LatexTokens", "'\frac'", "'<{>'", "'\pi'", "'<}>'", "'<{>'",  2, "'<}>'"]
```
