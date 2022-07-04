---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---

<section id='constants'>

## Constants

The constants below are **inert**. They are used as tokens and have no 
value other than themselves.

| Symbol      | Description                                                                                                                                                                            |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `All`       | {% tags "inert" "float-right" %} All the possible values apply                                                                                                                                                          |
| `Missing`   | {% tags "inert" "float-right" %}A **required** expression is not present                                                                                                                                               |
| `None`      | {% tags "inert" "float-right" %}None of the possible values apply                                                                                                                                                      |
| `Nothing`   | {% tags "inert" "float-right" %}An **optional** expression is not present                                                                                                                                              |
| `Undefined` | {% tags "inert" "float-right" %}The result is not defined. For example, the domain of an unknown symbol is `Undefined`.<br>Note that for numbers, the equivalent is `NaN` (Not a Number) and for booleans, `Maybe` |


| MathJSON                     | LaTeX                                |
| :-------------------------- | :------------------------------ |
| `["Divide", 2, "Missing"]`  | \\[\frac{2}{\unicode{"2B1A}}\\] |
| `["List", 2, "Nothing", 3]` | \\[\lbrack 2, ,3 \rbrack\\]     |

</section>




<section id='variables'>

## Variables

{% defs "Function" "Operation" %} 

{% def "Let" %}
<code>["Let", _symbol_, _value_]</code><br>
<code>["Let", _symbol_, _value_, _domain_]</code>

Define a new symbol in the current scope, and set its value and domain.
If `domain` is not provided, the domain is inferred based on the value.

If the symbol already had a definition in the current scope, replace it.

{% enddef %} 

{% def "Value" %}
<code>["Value", _symbol_]</code>

Evaluate to the value of `_symbol_`.


<code>["Value", _symbol_, _value_]</code>

Set the value of `_symbol_` to `_value_`.

If `_symbol_` does not exist in the current context, consider parent scopes until
a definition for the symbol is found.

If no definition for the symbol is found add one in the current scope.

{% enddef %} 

{% enddefs %}

</section>




<section id='core-functions'>

## Core Functions

{% defs "Function" "Operation" %} 

{% def "About" %} `["About", _symbol_]`

Evaluate to a dictionary containing information about a symbol such as its
domain, its attributes, its value, etc... 

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
{% tags "inert" "float-right" %}
<code>["Error", _expression_, _string_, _rest_]</code>


Tag an expression that could not be interpreted correctly. It may have a syntax
error, a reference to an unknown symbol or function or some other problem.

Note that an `Error` expression can be a sub-expression.

The second argument is a string indicating the problem.

The third argument, if present, is an expression describing what could not be parsed.
{% enddef %} 


{% def "Hold" %} <code>["Hold",
_expression_]</code>{% tags "inert" "float-right" %}

Tag an expression that should be kept in an unevaluated form {% enddef %}
{% def "Html" %} <code>["Html", _expr_]</code>

Evaluate to a string which is the HTML markup corresponding to the expression.
If the head of _expr_ is `LatexString`, `Latex` or `LatexTokens`, renders the
LaTeX to HTML markup {% enddef %} {% def "Identity" %} <code>["Identity",
_expression_]</code>

Evaluate to its argument {% enddef %} {% def "InverseFunction" %}
<code>["InverseFunction", _expression_]</code>

Evaluate to the inverse function of its argument for example `Arcsin` for `Sin`
{% enddef %} 

{% def "Latex" %} <code>["Latex", _expr_]</code>

Evaluate to a `LatexString` which is the expression serialized to LaTeX
{% enddef %} 

{% def "LatexString" %} 
{% tags "inert" "float-right" %}<code>["LatexString", _string_]</code>

Tag a string as a LaTeX string 

{% enddef %} 


{% def "LatexTokens" %}
<code>["LatexTokens", ..._token_\[\]]</code>

Evaluate to a `LatexString` made of the concatenation of the token arguments
{% enddef %} 


{% def "Parse" %} <code>["Parse", _expr_]</code>

If _expr_ is a `LatexString` or `LatexTokens`, evaluate to a MathJSON expression
corresponding to the LaTeX string. 
{% enddef %} 


{% def "String" %}
<code>["String", ..._expr_]</code>{% tags "constructor" "float-right"%}

Evaluate to a string made from the concatenation of the arguments converted to
string 
{% enddef %} 

{% def "Symbol" %}
<code>["Symbol", ..._expr_]</code>{% tags "constructor" "float-right"%}

Evaluate to a new symbol made of a concatenation of the arguments.

For example `["Symbol", "x", 2] -> "x2"`

{% enddef %}

{% enddefs %}


</section>







## `Parse`, `Latex`, `LatexTokens` and `LatexString`

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
| string that starts with `\` | a LaTeX command    |
| other strings               | ordinary symbols   |

</div>

```json
["LatexTokens", "'\\frac'", "'<{>'", "'pi'", "'<}>'", "'<{>'", 2, "'<}>'"]
// ➔ "'\frac{\pi}{2}'"
```

See: [TeX:289](http://tug.org/texlive/devsrc/Build/source/texk/web2c/tex.web)

This function can be returned when the parser fails to parse a sequence of LaTeX
tokens.

## `Piecewise`

## `Prime`

| MathJSON            | LaTeX            |
| :------------------ | :--------------- |
| `["Prime", "f"]`    | `f^\prime`       |
| `["Prime", "f", 2]` | `f^\doubleprime` |


<section id='supsub'>

## Superscripts and Subscripts

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
