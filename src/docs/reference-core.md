---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Core

<section id='constants'>

## Constants

| Symbol      | Description                                                                                                                                                             |
| :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `All`       | All the possible values apply                                                                                                                                           |
| `Missing`   | A **required** expression is not present                                                                                                                               |
| `None`      | None of the possible values apply                                                                                                                                       |
| `Nothing`   | An **optional** expression is not present                                                                                                                               |
| `Undefined` | The result is not defined. For example, the `domain()` of an unknown symbol is `Undefined`.<br>Note that for numbers, the equivalent is `NaN` (Not a Number) and for booleans, `Maybe` |



| Example                     |                                 |
| :-------------------------- | :------------------------------ |
| `["Divide", 2, "Missing"]`  | \\[\frac{2}{\unicode{"2B1A}}\\] |
| `["List", 2, "Nothing", 3]` | \\[\lbrack 2, ,3 \rbrack\\]     |

</section>

<section id='core-functions'>

## Core Functions

{% defs "Function" "Operation" %}
{% def "About" %}
  <code>["About", _symbol_]</code>
  
  Evaluate to a dictionary containing information about a symbol such as its domain, its attributes, its value, etc...
{% enddef %}
{% def "Domain" %}
 <code>["Domain", _expression_]</code>
  
  Evaluate to the domain of _expression_
{% enddef %}
{% def "Evaluate" %}
 <code>["Evaluate", _expression_]</code>
  
  Apply a sequence of definitions to an expression in order to reduce, simplify
  and calculate its value. Overrides `Hold` and hold attributes of a function.
{% enddef %}
{% def "Error" %}
 <code>["Error", _expression_, _string_]</code>{% tags "inert" "float-right" %}
  
  Tag an expression that could not be interpreted correctly. It may have a syntax error, a reference to an unknown symbol or function or some other problem.
{% enddef %}
{% def "Hold" %}
 <code>["Hold", _expression_]</code>{% tags "inert" "float-right" %}
  
  Tag an expression that should be kept in an unevaluated form
{% enddef %}
{% def "Html" %}
 <code>["Html", _expr_]</code>
  
  Evaluate to a string which is the HTML markup corresponding to the expression. If the head of _expr_ is `LatexString`, `Latex` or `LatexTokens`, renders the LaTeX to HTML markup
{% enddef %}
{% def "Identity" %}
 <code>["Identity", _expression_]</code>
  
  Evaluate to its argument
{% enddef %}
{% def "InverseFunction" %}
 <code>["InverseFunction", _expression_]</code>
  
  Evaluate to the inverse function of its argument for example `Arcsin` for `Sin`
{% enddef %}
{% def "Latex" %}
 <code>["Latex", _expr_]</code>
  
  Evaluate to a `LatexString` which is the expression serialized to LaTeX
{% enddef %}
{% def "LatexString" %}
 <code>["LatexString", _string_]</code>{% tags "inert" "float-right" %}
  
  Tag a string as a LaTeX string
{% enddef %}
{% def "LatexTokens" %}
 <code>["LatexTokens", ..._token_\[\]]</code>
  
  Evaluate to a `LatexString` made of the concatenation of the token arguments
{% enddef %}
{% def "Parse" %}
 <code>["Parse", _expr_]</code>
  
  If _expr_ is a `LatexString` or `LatexTokens`, evaluate to a MathJSON expression 
  corresponding to the LaTeX string.
{% enddef %}
{% def "String" %}
 <code>["String", ..._expr_\[\]]</code>{% tags "constructor" "float-right"%}
  
  Evaluate to a string made from the concatenation of the arguments converted 
  to string
{% enddef %}
{% def "Symbol" %}
 <code>["Symbol", ..._expr_\[\]]</code>{% tags "constructor" "float-right"%}
  
  Evaluate to a new symbol made of a concatenation of the arguments. 
  
  For example `["Symbol", "x", 2] -> "x2"
{% enddef %}
{% enddefs %}



| Example                      |                   |
| :--------------------------- | :---------------- |
| `["InverseFunction", "Sin"]` | \\[ \sin^{-1} \\] |

<section id='core-functions'>

## Styling Functions

The functions in this section represent a visual difference that is not usually
material to the interpretation of an expression such as text color and size or
other typographic variations.


{% defs "Function" "Operation" %}
{% def "Style" %}
  <code>["Style", _expr_, _css_]</code>{% tags "inert" "float-right" %}
  
  Apply CSS styles to an expression

{% enddef %}
{% def "Delimiter" %}
  <code>["Delimiter", _expr_]</code>{% tags "inert" "float-right" %}

  <code>["Delimiter", _expr_, _sep_]</code>
  
  <code>["Delimiter", _expr_, _open_, _close_]</code>
  
  <code>["Delimiter", _expr_, _open_, _sep_, _close_]</code>
  
  Display _expr_ wrapped in a delimiter.

{% enddef %}
{% enddefs %}



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

This function can be returned when the parser fails to parse a sequence of LaTeX
tokens.

### `Piecewise`

### `Prime`

| MathJSON            | LaTeX            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |

### Superscripts and Subscripts

These functions are all inert functions, that is they evaluate to themselves.

<div class=symbols-table>

| Function      |                  | Description                                                    |
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
</section>
