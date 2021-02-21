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

## Functions

### `About`

`["About", `_`symbol`_`]`

Return information about a symbol such as its domain, its attributes, its value,
etc...

### `Domain`

`["Domain", `_`expression`_`]`

Return the domain of the expression.

### `Evaluate`

`["Evaluate", `_`expression`_`]`

Apply a sequence of definitions to an expression in order to reduce and simplify
it.

An evaluation can consist of:

- a computation

```json
["Evaluate", ["Add", 2, 3]]
// ➔ 5
```

- an execution

```json
["Evaluate", ["Length", ["List", 5, 7]]]
// ➔ 2
```

- a simplification

```json
["Evaluate", ["Add", 2, ["Add", "x", 3]]]
// ➔ ["Add", 5, "x"]
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

`["Lambda", `_`variables`_`, `_`expression`_`]`

Create a [Lambda-function](https://en.wikipedia.org/wiki/Anonymous_function),
also called anonymous function.

The first argument is a symbol or a list of symbols which are the bound
variables of the Lambda-function.

The second argument is an expression expressed as a function of the bound
variables of the Lambda-function.

To apply a Lambda-function to some arguments, use:

```json
[["Lambda", ["List", "x"], ["Multiply", "x", "x"]], "3"]
// ➔ 9
```

### `Latex`

`["Latex", `_`token-1`_`, `_`token-2`_`, ...`_`token-n`_`]`

- _token-n_: one or more expressions that are serialized and concatenated as  
  Latex tokens. A Latex token is one of:
  - `<{>`: begin group
  - `<}>`: end group
  - `<space>`: blank space
  - `<$$>`: display mode shift
  - `<$>`: inline mode shift
  - `#0`-`#9`: argument
  - `#?`: placeholder
  - `\` + string: a command
  - other: literal

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

| MathJSON                                                    | Latex           |
| :---------------------------------------------------------- | :-------------- |
| `["Latex", "\frac", "<{>", "\pi","<}>", "<{>", "2", "<}>"]` | `\frac{\pi}{2}` |

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

Indicate if two expressions are structurally identical, using a literal symbolic
identity.

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
same(['Add', 'x', 1], ['Add', 1, 'x']);
// ➔ false

same(canonical(['Add', 'x', 1]), canonical(['Add', 1, 'x']));
// ➔ true
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
