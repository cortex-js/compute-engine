---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---


# Core

## Constants

<div class=symbols-table>

| Symbol      | Description                                                                                                                                                             |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `All`       | All the possible values apply                                                                                                                                           |
| `Missing`   | A **required** expression is not present.                                                                                                                               |
| `None`      | None of the possible values apply                                                                                                                                       |
| `Nothing`   | An **optional** expression is not present                                                                                                                               |
| `Undefined` | The result is not defined. For example, the `domain()` of an unknown symbol is `Undefined`.<br>Note that for numbers, the equivalent is `NaN` and for booleans, `Maybe` |

</div>

<div class=symbols-table>

| Example                     |                                 |
| :-------------------------- | :------------------------------ |
| `["Divide", 2, "Missing"]`  | \\[\frac{2}{\unicode{"2B1A}}\\] |
| `["List", 2, "Nothing", 3]` | \\[\lbrack 2, ,3 \rbrack\\]     |

</div>

## Functions

<div class=symbols-table>

| Function          | Operation                                                                                                                                                                |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `About`           | <code>["About", _symbol_]</code><br> Return information about a symbol such as its domain, its attributes, its value, etc...                                                      |
| `Domain`          | <code>["Domain", _expression_]</code><br> Return the domain of the expression                                                                                                      |
| `Evaluate`        | <code>["Evaluate", _expression_]</code><br> Apply a sequence of definitions to an expression in order to reduce and simplify it. Overrides `Hold` and hold attributes of a function. |
| `Error` | <code>["Error", _expression_]</code><br>The expression could not be interpreted correctly. It may have a syntax error, a reference to an unknwon symbol or function or some other problem. |
| `Hold`            | <code>["Hold", _expression_]</code><br> Maintain an expression in an unevaluated form (inert function)                                                                                           |
| `Identity`        | <code>["Identity", _symbol_]</code><br> Always return its argument                                                                                                                   |
| `InverseFunction` | <code>["InverseFunction", _expression_]</code><br> Return the inverse function of its argument, for example \\( \arcsin \\) for \\(\sin\\)                                                  |
| `Latex`        | <code>["Latex", _expr_]</code><br> Return a string which is the expression serialized to LaTeX                                                                                                                   |
| `LatexString`        | <code>["LatexTokens", _string_]</code><br> A LaTeX string (inert function)                                                                                                                   |
| `LatexTokens`        | <code>["LatexTokens", ..._token_\[\]]</code><br> A sequence of LaTeX tokens. See below (inert function)                                                                                                                   |
| `Parse`        | <code>["Parse", _expr_]</code><br> `expr` should be a `LatexString` or `LatexTokens` and the result is an expression corresponding to the parsing of the LaTeX string                                                                                                                   |

</div>

| Example                      |             |
| :--------------------------- | :---------- |
| `["InverseFunction", "Sin"]` | \\[ \sin^{-1} \\] |

### `Lambda`

<code>["Lambda", _variables:List_, _expression_]</code>

Create a [Lambda-function](https://en.wikipedia.org/wiki/Anonymous_function),
also called **anonymous function**.

The first argument is a symbol or a list of symbols which are the bound
variables (parameters) of the Lambda-function.

The second argument is an expression expressed as a function of the bound
variables of the Lambda-function.

**To apply a Lambda-function to some arguments**, use:

```cortex
Lambda([x], x * x)(3)
// ➔ 9
```

You can avoid naming the parameters by using the following shorthands:

- `_` or `_1` : the first argument
- `_2` : the second argument
- `_3` : the third argument, etc...
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

### `Parse`, `Latex`, `LatexTokens` and `LatexString`

<code>["Latex", _expr_ ]</code>

- <code>_expr_</code>: a MathJSON expression
- Returns a LaTeX string representing the expression.

```json
["Latex", ["Divide", "Pi", 2]]
// ➔ "'\frac{\pi}{2}'"
```

<code>["LatexTokens", _token-1_, _token-2_, ..._token-n_]</code>

The arguments <code>_token-n_</code> are interpreted as LaTeX tokens:

<div class=symbols-table>

| Token                       |                    |
| :-------------------------- | :----------------- |
| `<{>`                       | begin group        |
| `<}>`                       | end group          |
| `<space>`                   | blank space        |
| `<$$>`                      | display mode shift |
| `<$>`                       | inline mode shift  |
| `#0`-`#9`                   | argument           |
| `#?`                        | placeholder        |
| string that starts with `/` | a LaTeX command    |
| other strings               | ordinary symbols   |

</div>

```json
["LatexTokens", "'\\frac'", "'<{>'", "'pi'", "'<}>'", "'<{>'", 2, "'<}>'"]
// ➔ "'\frac{\pi}{2}'"
```

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

This function can be returned when the parser fails to parse a sequence of
LaTeX tokens.

### `Piecewise`

### `Prime`

| MathJSON            | LaTeX            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |

### `Match`

_`expr1`_ `===` _`expr2`_

`Match(`_`expr1`_`, `_`expr2`_`)`

`Match(`_`expr1`_`, `_`expr2`_`, ...`_`expr-n`_`)`

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
match({ sym: 'Pi', wikidata: 'Q168' }, { sym: 'Pi', wikidata: 'Q167' });
// ➔ null (does not match)
```

Using a canonical format will result in more positive matches.

```js
match(parse('x + 1'), parse('1 + x')));
// ➔ null

match(ce.canonical(parse('x + 1'), parse('1 + x')));
// ➔ True
```

### Superscripts and Subscripts

<div class=symbols-table>

| Symbol        |                  | Description                                                    |
| :------------ | :--------------- | :------------------------------------------------------------- |
| `Subminus`    | \\[ x_- \\]      |                                                                |
| `Subplus`     | \\[ x_+\\]       |                                                                |
| `Subscript`   | \\[ x_{n} \\]    |                                                                |
| `Substar`     | \\[ x_*\\]       |                                                                |
| `Superdagger` | \\[ x^\dagger\\] |                                                                |
| `Superminus`  | \\[ x^-\\]       |                                                                |
| `Superplus`   | \\[ x^+\\]       |                                                                |
| `Superstar`   | \\[ x^*\\]       | When the argument is a complex number, indicate the conjugate. |

</div>

### `String`

### `Symbol`
