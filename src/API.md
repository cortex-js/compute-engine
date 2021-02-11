# MathJSON API

## Parsing and Serializing

To transform Latex to MathJSON, use the `parse()` function.

To transform MathJSON to Latex, use the `serialize()` function.

```javascript
import { parse, serialize } from 'math-json';

const expr = parse('\\frac{\\pi}{2}');
console.log(expr);
// -> ["Divide", "Pi", 2]

const latex = serialize(expr);
console.log(latex);
// -> \frac{\pi}{2}
```

The behavior of parse and serialize can be customized by passing an optional
argument:

```javascript
import {  serialize } from 'math-json';

console.log(serialize(1/3, {
    precision: 3,
    decimalMarker: ","
}););
// -> 0,333
```

## Formating

A given mathematical expression can be represented in multiple equivalent ways
as a MathJSON expression. A **form** is used to specify a representation:

- **`'full'`**: only transformations applied are those necessary to make it
  valid JSON (for example making sure that `Infinity` and `NaN` are represented
  as strings)
- **`'flatten'`**: associative functions are combined, e.g. f(f(a, b), c) ->
  f(a, b, c)
- **`'sorted'`**: the arguments of commutative functions are sorted such that: -
  numbers are first, sorted numerically - complex numbers are next, sorted
  numerically by imaginary value - symbols are next, sorted lexicographically -
  `add` functions are next - `multiply` functions are next - `power` functions
  are next, sorted by their first argument, then by their second argument -
  other functions follow, sorted lexicographically
- **`'stripped-metadata'`**: any metadata associated with elements of the
  expression is removed.
- **`'object-literal'`**: each term of an expression is expressed as an object
  literal: no shorthand representation is used.
- **`'canonical-add'`**: `addition of 0 is simplified, associativity rules are
  applied, unnecessary groups are moved, single argument 'add' are simplified
- **`'canonical-divide'`**: `divide` is replaced with `multiply` and `power',
  division by 1 is simplified,
- **`'canonical-exp'`**: `exp` is replaced with `power`
- **`'canonical-multiply'`**: multiplication by 1 or -1 is simplified
- **`'canonical-power'`**: `power` with a first or second argument of 1 is
  simplified
- **`'canonical-negate'`**: real or complex number is replaced by the negative
  of that number. Negation of negation is simplified.
- **`'canonical-number'`**: complex numbers with no imaginary compnents are
  simplified
- **`'canonical-root'`**: `root` is replaced with `power`
- **`'canonical-subtract'`**: `subtract` is replaced with `add` and `negate`
- **`'canonical'`**: the following transformations are performed, in this order:
  - 'canonical-number', // -> simplify number
  - 'canonical-exp', // -> power
  - 'canonical-root', // -> power, divide
  - 'canonical-subtract', // -> add, negate, multiply,
  - 'canonical-divide', // -> multiply, power
  - 'canonical-power', // simplify power
  - 'canonical-multiply', // -> multiply, power
  - 'canonical-negate', // simplify negate
  - 'canonical-add', // simplify add
  - 'flatten', // simplify associative, idempotent and groups
  - 'sorted',
  - 'full',

To transform an expression using the rules for a particular form, use the
`format()` function.

```js
import { format } from 'math-json';

console.log(format(["Add", 2, "x", 3], ['canonical']);
// -> ["Add", 2, 3, "x"]
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
// -> ["Latex", "\frac", "<{>", "\pi", "<}>", "<{>",  2, "<}>"]
```

Similarly, create an instance of `ComputeEngine` for calls to `format()` and
`evaluate()`.
