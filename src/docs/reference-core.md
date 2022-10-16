---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
---

<section id='constants'>

## Constants

The constants below are **inert**. They are used as tokens and have no 
value other than themselves.

| Symbol      | Description                                                                                                                                                                            |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `All`       | {% tags "inert" "float-right" %} All the possible values apply                                                                                                                                                          |
| `None`      | {% tags "inert" "float-right" %}None of the possible values apply                                                                                                                                                      |
| `Nothing`   | {% tags "inert" "float-right" %}An **optional** expression is not present. Used in sparse list to indicate  skipped elements.                                                                                                                                              |
| `Undefined` | {% tags "inert" "float-right" %}The result is not defined. For example, the domain of an unknown symbol is `Undefined`.<br>Note that for numbers, the equivalent is `NaN` (Not a Number) and for booleans, `Maybe` |


| MathJSON                     | LaTeX                                |
| :-------------------------- | :------------------------------ |
| `["List", 2, "Nothing", 3]` | \\[\lbrack 2, ,3 \rbrack\\]     |

</section>





## Assignment, Declaration and Assumptions

{% defs "Function" "Operation" %} 

{% def "Assume" %}
<code>["Assume", _symbol_, _value_]</code><br>


<code>["Assume", _symbol_, _domain_]</code><br>


<code>["Assume", _predicate_]</code>

The predicate is an expression that evaluates to `True` or `False. The symbols
or functions in the predicate expression may be free (i.e. not have a definition).

The predicate can take the form of an equality, an inequality or a membership 
expression:
- `["Assume", ["Equal", "x", 3]]`
- `["Assume", ["Greater", "x", 0]]`
- `["Assume", ["Element", "x", "Integer"]]`

{% enddef %} 


{% def "Let" %}
<code>["Let", _symbol_, _value_]</code><br>
<code>["Let", _symbol_, _value_, _domain_]</code>

Define a new symbol in the current scope, and set its value and domain.
If _<kbd>domain</kbd>_ is not provided, the domain is inferred based on the value.

If the symbol already has a definition in the current scope, evaluate to 
an error, otherwise evaluate to _<kbd>value</kbd>_. To change the value of 
an existing symbol, use a `["Set"]` expression.

<code>["Let", _function-expression_, _value_]</code>

Define a new function in the current scope. The name of the function and its
arguments are provided by the function expression. The value is an expression
using the arguments from _<kbd>function-expression</kbd>_.

```
// Define f(x) := x + 1
["Let", ["f", "x"], ["Add", "x", 1]]
```

The arguments of the function expression should be either
- symbols
- pairs of symbol and domain.

```
// Define f(n) := 2n, where n is an integer
["Let", ["f", ["Tuple", "n", "Integer]], ["Multiply", "n", 2]]
```




{% enddef %} 



{% def "Set" %}

<code>["Set", _symbol_, _value_]</code>

Set the value of _<kbd>symbol</kbd>_ to _<kbd>value</kbd>_.

If _<kbd>symbol</kbd>_ does not exist in the current context, consider parent 
scopes until a definition for the symbol is found.

If there is no definition for the symbol, evaluate to an error, otherwise 
evaluate to _<kbd>value</kbd>_.  To define a new symbol, use a `["Let"]`
expression.

{% enddef %} 


{% enddefs %}



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
