---
title: MathJSON Forms
permalink: /guides/compute-engine-forms/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument();
</script>

# Compute Engine Forms

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
  - `'canonical-number'`, -> simplify number
  - `'canonical-exp'`, -> power
  - `'canonical-root'`, -> power, divide
  - `'canonical-subtract'`, -> add, negate, multiply,
  - `'canonical-divide'`, -> multiply, power
  - `'canonical-power'`, -> simplify power
  - `'canonical-multiply'`, -> multiply, power
  - `'canonical-negate'`, -> simplify negate
  - `'canonical-add'`, -> simplify add
  - `'flatten'`, simplify associative, idempotent, involution and groups
  - `'sorted'`,
  - `'full'`,

To transform an expression using the rules for a particular form, use the
`format()` function.

```js
import { format } from 'math-json';

console.log(format(["Add", 2, "x", 3], 'canonical');
// ➔ ["Add", 2, 3, "x"]
```

## `BaseForm`

`["BaseForm", _value_, _base_]`

Format a _value_ in a specific _base_, such as hexadecimal or binary.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

```json
["Latex", ["BaseForm", 42, 16]]
// ➔ (\mathtt(2a))_{16}
```

```cortex
Latex(BaseForm(42, 16))
// ➔ (\mathtt(2a))_{16}
BaseForm(42, 16)
// ➔ 0x2a
```

## `Derivative`

`["Derivative", _expression_, _order_]`

- _order_: default value is 1.

| MathJSON                   | Latex            |
| :------------------------- | :--------------- |
| `["Derivative", "f"]`      | `f^\prime`       |
| `["Derivative", "f", 2]`   | `f^\doubleprime` |
| `["Derivative", "f", "n"]` | `f^{(n)}`        |
