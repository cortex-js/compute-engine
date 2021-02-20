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

### `Evaluate`

### `Group`

### `Identity`

The identity function, i.e. its value is its argument.

| MathJSON            | Latex                  |
| :------------------ | :--------------------- |
| `["Identity", "x"]` | `\operatorname{id}(x)` |
| `"Identity"`        | `\operatorname{id}`    |

### `InverseFunction`

The inverse function.

| MathJSON                     | Latex       |
| :--------------------------- | :---------- |
| `["InverseFunction", "Sin"]` | `\sin^{-1}` |

### `Lambda`

- `["Lambda", `_`variables`_`, `_`expression`_`]`

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

- `["Latex", `_`token-1`_`, `_`token-2`_`, ...`_`token-n`_`]`

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

The `Pattern` function is used with the `match()` function to pattern-match an
expresion. The pattern expression can include one or more `Pattern` function
calls.

- `["Pattern"]`

Indicate that any sub-expression at this position will match.

- `["Pattern", `_`name`_`]`

Match and capture any subexpression at this position as the _`name`_ capture
group.

- `["Pattern", `_`name`_`, `_`pattern`_`]`

Match and capture any subexpression at this position as the `_`name`_` capture
group **if** the subexpression matches the _`pattern`_.

- `["Pattern", `_`name`_`, `_`pattern-1`_`, `_`pattern-2`_`, `_`...`_`]`

Match and capture any subexpression at this position as the `_`name`_` capture
group **if** the subexpression matches any of the _`pattern-n`_.

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

### Superscript/subscript

- `Subminus` $$x_-$$
- `Subplus` $$x_+$$
- `Subscript`
- `Substar` - $$x_*$$
- `Superdagger` - $$x^\dagger$$
- `Superminus` - $$x^-$$
- `Superplus` - $$x^+$$
- `Superstar` - $$x^*$$ When the argument is a complex number, indicate the
  conjugate.

### `String`

### `Symbol`
