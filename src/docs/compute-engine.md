---
title: MathJSON Core
permalink: /guides/math-json-compute-engine-api/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

# Compute Engine API

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
// -> ["Add", 2, 3, "x"]
```

## Evaluating

```js
import { evaluate } from 'math-json';

console.log(evaluate(["Add", 2, 3]);
// -> 5
console.log(evaluate(["Add", 2, "x", 3]);
// -> ["Add", 5, x]
```

## Advanced Usage

To improve performance, particularly when calling `format()`/`evaluate()`
repeatedly, use an instance of the `ComputeEngine` class. When the instance is
constructed, the dictionaries defining the symbols are compiled, and subsequent
invocations of the `format()` and `evaluate()` methods can skip that step.

Using a compute engine instance, it is possible to customize which symbol
dictionaries are used.

```js
const engine = new ComputeEngine(ComputeEngine.getDictionary('arithmetic'));
engine.evalue(['Add', 5, 2]);
```

## Comparing

Use the `compare()` function to compare two expressions, or the shorthands
`equal()`, `less()`, `lessEqual()`, `greater()`, `greaterEqual()`.

The comparison between expressions is structural so that $$x + 1$$ is not equal
to $$1 + x$$. To obtain the desired result, you may need to apply a canonical
form to the expressions, or evaluate them.

```js
const engine = new ComputeEngine();

console.log(engine.equal(['Add', 'x', 1], ['Add', 'x', 1]));
// -> true: the two expressions are equal

console.log(engine.equal(['Add', 'x', 1], ['Add', 1, 'x']));
// -> false: the two expressions are **not** equal

console.log(engine.equal(
  engine.canonical(['Add', 'x', 1]),
  engine.canonical(['Add', 1, 'x'])
);
// -> true: the two expressions are equal

console.log(engine.equal(
  ['Add', 2, 2],
  ['Add', 3, 1]
);
// -> false: the two expressions are **not** equal

console.log(engine.equal(
  engine.evaluate(['Add', 2, 2]),
  engine.evaluate(['Add', 3, 1])
);
// -> true: the two expressions are equal
```

## Domains

To obtain the domain of an expression, use the `domain()` function.

```js
const engine = new ComputeEngine();

engine.domain('Pi');
// -> "TranscendentalNumber"

engine.domain(['Add', 5, 2]);
// -> "Number"

engine.domain(engine.evaluate(['Add', 5, 2]));
// -> "PrimeNumber"
```
