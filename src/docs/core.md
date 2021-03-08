---
title: Core
permalink: /guides/compute-engine-core/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.mjs';
    renderMathInDocument();
</script>

# Core

## Constants

### `Missing`

This symbol is used when a required expression is not present.

| MathJSON                   | Latex                      |
| :------------------------- | :------------------------- |
| `["Divide", 2, "Missing"]` | `\frac{2}{\placeholder{}}` |

### `Nothing`

This symbol is used when an optional expression is not present.

| MathJSON                    | Latex                  |
| :-------------------------- | :--------------------- |
| `["List", 2, "Nothing", 3]` | `\lrback 2,,3 \rbrack` |

### `None`

This symbol is used to indicate that out of multiple possible values, none
apply.

### `All`

This symbol is used to indicate that out of multiple possible values, all apply.

## Functions

### `About`

`About(`_`symbol`_`)`

Return information about a symbol such as its domain, its attributes, its value,
etc...

### `Domain`

`Domain(`_`expression`_`)`

Return the domain of the expression.

### `Evaluate`

`Evaluate(`_`expression`_`)` `Evaluate(`_`expr1`_`, `_`expr2`_`)`

Apply a sequence of definitions to an expression in order to reduce and simplify
it.

An evaluation can consist of:

- a computation

```cortex
Evaluate(2 + 3)
// ➔ 5
```

- an execution

```cortex
Evaluate(Length([5, 7]))
// ➔ 2
```

- a simplification

```cortex
Evaluate(2 + x + 3)
// ➔ 5 + x
```

### `Identity`

Always return its argument.

| MathJSON            | Latex                  |
| :------------------ | :--------------------- |
| `["Identity", "x"]` | `\operatorname{id}(x)` |
| `"Identity"`        | `\operatorname{id}`    |

### `InverseFunction`

Return the inverse function of its argument.

| MathJSON                     | Latex       |
| :--------------------------- | :---------- |
| `["InverseFunction", "Sin"]` | `\sin^{-1}` |

### `Lambda`

`Lambda"(`_`variables:List`_`, `_`expression`_`)`

Create a [Lambda-function](https://en.wikipedia.org/wiki/Anonymous_function),
also called **anonymous function**.

The first argument is a symbol or a list of symbols which are the bound
variables (parameters) of the Lambda-function.

The second argument is an expression expressed as a function of the bound
variables of the Lambda-function.

To apply a Lambda-function to some arguments, use:

```cortex
Lambda([x], x * x)(3)
// ➔ 9
```

You can avoid naming the parameters by using the following shorthands:

- `_` or `_0` : the first argument
- `_1` : the second argument
- `_2` : the third argument, etc...
- `__`: the sequence of arguments, so `Length(__)` is the number of arguments

```cortex
Lambda(_ * _)(4)
// ➔ 16
```

You can assign a Lambda expression to a symbol for later use:

```cortex
cube = Lambda(_ * _ * _)
cube(5)
// ➔ 125
```

### `Latex`

`["Latex", `_`expr-1`_`, `_`expr-2`_`, ...`_`expr-n`_`]`

- _`expr-n`_: one or more expressions
- Returns a string, a Latex string corresponding to the input expressions.

```json
["Latex", ["Divide", "Pi", 2]]
// ➔ "'\frac{\pi}{2}'"
```

If the argument is a string, it is interpreted as a Latex token or fragment:

- `<{>`: begin group
- `<}>`: end group
- `<space>`: blank space
- `<$$>`: display mode shift
- `<$>`: inline mode shift
- `#0`-`#9`: argument
- `#?`: placeholder
- string that starts with `/`: a Latex command
- other strings: ordinary symbols

```json
["Latex", "'\\frac'", "'<{>'", "'pi'", "'<}>'", "'<{>'", 2, "'<}>'"]
// ➔ "'\frac{\pi}{2}'"
```

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

### `Pattern`

Work in progress{.notice--info}

The `Pattern` function is used with the `match()` function to pattern-match an
expression. The pattern expression can include one or more `Pattern` function
calls.

- `["Pattern"]` - Any sub-expression at this position will match.
- `["Pattern", `_`name`_`]` - Match and capture any subexpression at this
  position as the capture group _`name`_.
- `["Pattern", `_`name`_`, `_`pattern`_`]` - Match and capture any subexpression
  at this position as the `_`name`_` capture group **if** the subexpression
  matches the _`pattern`_.
- `["Pattern", `_`name`_`, `_`pattern-1`_`, `_`pattern-2`_`, `_`...`_`]` - Match
  and capture any subexpression at this position as the `_`name`_` capture group
  **if** the subexpression matches any of the _`pattern-n`_.

```js
match(["Add", ["Pattern"], ["Pattern"]], ["Add", 3, 5]))
// ➔ {}
```

### `Piecewise`

### `Prime`

| MathJSON            | Latex            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |

### `Same`

_`expr1`_ `===` _`expr2`_

`Same(`_`expr1`_`, `_`expr2`_`)`

`Same(`_`expr1`_`, `_`expr2`_`, ...`_`expr-n`_`)`

Indicate if two (or more) expressions are structurally identical, using a
literal symbolic identity.

Two expressions are the same if:

- they have the same domain.
- if they are numbers, if their value and domain are identical.
- if they are symbols, if their names are identical.
- if they are functions, if the head of the functions are identical, and if all
  the arguments are identical.

Two expressions that have a different `wikidata` metadata will not be the same,
even if they are otherwise identical. Other metadata does not affect the
comparison.

```js
// Greek letter vs. ratio of the circumference of a circle to its diameter
same({ sym: 'Pi', wikidata: 'Q168' }, { sym: 'Pi', wikidata: 'Q167' });
// ➔ false
```

Using a canonical format will result in more positive matches.

```js
Same(x + 1, 1 + x);
// ➔ False

Same(Canonical(x + 1, 1 + x));
// ➔ True
```

### Superscript/subscript

- `Subminus` - $$x_-$$
- `Subplus` - $$x_+$$
- `Subscript`
- `Substar` - $$x_*$$
- `Superdagger` - $$x^\dagger$$
- `Superminus` - $$x^-$$
- `Superplus` - $$x^+$$
- `Superstar` - $$x^*$$. When the argument is a complex number, indicate the
  conjugate.

### `String`

### `Symbol`
