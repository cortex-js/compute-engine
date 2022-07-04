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

<section id='control-structures'>

## Control Structures

Control Structures, along with Loops, define how a sequence of expressions
is evaluated.

- A `["Block"]` expression defines a **sequential** control structure
- An `["If"]` expression defines a **conditional** control structure.
- A `["Loop"]`, `["FixedPoint"]`, `["Sum"]`, `["Product"]` expression defines an **iterative** control structure.

{% defs "Function" "Operation" %} 

{% def "Block" %}
<code>["Block", _expr-1_, ..._expr-n_]</code><br>
<code>["Block", _dictionary_, _expr1_, ..._expr-n_]</code>

When a `["Block"]` expression is evaluated, the following steps are followed:

1. Create a new scope
2. Set the value of the symbols in _dictionary_ in this scope
3. Evaluate each _expr_ sequentially

The _dictionary_ argument can be a `["Dictionary"]` expression, a 
`["KeyValuePair"]` expression, a `["Pair"]` expression or a `["Tuple"]` expression.

The value of the `["Block"]` expression is the value of the last expression, or the 
value of the first `["Break"]` expression.

```json
["Block", ["Tuple", "c", 5], ["Multiply", "c", 2]]
// ➔ 10
```

{% enddef %} 


{% def "If" %}
<code>["If", _condition_, _expr-1_, _expr-2_]</code><br>
<code>["If", _condition_, _expr-1_]</code>

- If the value of `_condition_` is the symbol `True`, the value of the `["If"]` 
expression is `_expr-1_`. 
- Otherwise, it is `_expr-2_` or `Nothing` if `_expr-2_`  is not provided.

```json
["Value", "n", -10]
["If", ["Greater", "n", 0], "n", ["Negate", "n"]]
// ➔ 10
```
{% enddef %} 

{% enddefs %}


</section>

<section id='loops'>

## Loops

The `Loop`, `Sum` and `Product` functions are iteration functions that share a
similar form. 

Their first argument, `body` is an expression that gets evaluated repeatedly.

In the case of `Sum`, each value of `body`  is summed, and the 
value of the loop function is the sum. Similarly for `Product`. 

For `["Loop"]` expressions, the value of the loop expression is the last value 
of `body` or the value of a `["Break"]` expression.

The other arguments indicate how the iteration should be performed:
- if no other argument is specified, the `body` expression is evaluated until
its value is a `["Break"]` expression.
- `max-iterations`: indicates how many times the _body_ expression will be evaluated
- `var`, `list-of-values`: the symbol `var` is assigned, in turn, the values in 
`_list-of-values_`
- `var`, `range`: the symbol `var` is assigned the values from the lower 
bound to the upper bound of the range, with a step of 1.
- `var`, `max`: the symbol `var` is assigned a value of 1, then incremented
by 1 until it reaches at least `max`
- `var`, `min`, `max`: the symbol `var` is assigned a value of `min`, then 
incremented by 1 until it reaches at least `max`
- `var`, `min`, `max`, `step`: the symbol `var` is assigned a value 
of `min`, then incremented by `step` until it reaches at least `max`

The `FixedPoint`, `Loop`, `Sum` and `Product` functions create a new scope. If
 `var` is specified, it is defined in this new scope.


{% defs "Function" "Operation" %} 

{% def "FixedPoint" %}
<code>["FixedPoint", _body_, _initial-value_]</code><br>
<code>["FixedPoint", _body_, _initial-value_, _max-iterations_]</code>


Apply `_body_` to `_initial-value_`, then apply `_body_` to the result until
the result no longer changes.

To determine if a fixed point has been reached and the loop should terminate, 
the previous and current values are compared with `Same`.


Use `["Break"]` to exit the loop immediately.



{% enddef %} 

{% def "Loop" %}
<code>["Loop", _body_]</code><br>
<code>["Loop", _body_, _max-iterations_]</code><br>
<code>["Loop", _body_, _var_, _list-of-values_]</code><br>
<code>["Loop", _body_, _var_, _range_]</code><br>
<code>["Loop", _body_, _var_, _max_]</code><br>
<code>["Loop", _body_, _var_, _min_, _max_]</code><br>
<code>["Loop", _body_, _var_, _min_, _max_, _step_]</code><br>

Repeatedly evaluate `_body_` until either `_max-iterations_` is reached (or 
`ce.iterationLimit` if `_max-iteration_` is not specified), or the value of 
`_body_` is a `["Break"]` expression.

{% enddef %} 

{% def "Product" %}
<code>["Product", _body_, _max-iterations_]</code><br>
<code>["Product", _body_, _var_, _list-of-values_]</code><br>
<code>["Product", _body_, _var_, _range_]</code><br>
<code>["Product", _body_, _var_, _max_]</code><br>
<code>["Product", _body_, _var_, _min_, _max_]</code><br>
<code>["Product", _body_, _var_, _min_, _max_, _step_]</code><br>

Evaluate `_body_` and make a product of the result.

{% enddef %} 


{% def "Sum" %}
<code>["Sum", _body_, _max_]</code><br>
<code>["Sum", _body_, _var_, _list-of-values_]</code><br>
<code>["Sum", _body_, _var_, _range_]</code><br>
<code>["Sum", _body_, _var_, _max_]</code><br>
<code>["Sum", _body_, _var_, _min_, _max_]</code><br>
<code>["Sum", _body_, _var_, _min_, _max_, _step_]</code><br>

Evaluate `_body_` and make a sum of the result.

{% enddef %} 

{% enddefs %}


**To control the flow of a loop function**, use `["Break"]` and `["Continue"]`.


{% defs "Function" "Operation" %} 

{% def "Break" %}
<code>["Break"]</code><br>
<code>["Break", _expr_]</code><br>

When in a loop, exit the loop immediately. The final value of the loop 
expression is `_expr_` or `Nothing` if not provided.

`["Break"]` expressions can also be used in a `["Block"]` expression.

{% enddef %} 

{% def "Continue" %}
<code>["Continue"]</code><br>
<code>["Continue", _expr_]</code><br>

When in a loop, skip to the next iteration of the loop. The value of the 
iteration is `_expr_` or `Nothing` if not provided.

{% enddef %} 

{% enddefs %}


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


<section id='functions'>

## Functions

{% defs "Function" "Operation" %} 

{% def "Function" %}

<code>["Function", list-of-variables_, _body_]</code><br>
<code>["Function", _variable_, _body_]</code>

Create a [Lambda-function](https://en.wikipedia.org/wiki/Anonymous_function),
also called **anonymous function**.

The first argument is a symbol or a list of symbols which are the bound
variables (parameters) of the Lambda-function.

The others arguments are expressions which are evaluated sequentially, or until
a `["Return"]` expression is encountered.

The `["Function"]` expression creates a new scope.

**To apply some arguments to a function expression**, use `["Apply"]`.

{% enddef %} 


{% def "Apply" %}
<code>["Apply", _body_, _expr-1_, ..._expr-n_]</code>

[Apply](https://en.wikipedia.org/wiki/Apply) a list of arguments to a lambda expression or function.

The following wildcards in _body_ are replaced as indicated

- `\_` or `\_1` : the first argument
- `\_2` : the second argument
- `\_3` : the third argument, etc...
- `\_`: the sequence of arguments, so `["Length", "&#95;"]` is the number of arguments

If _body_ is a `["Function"]` expression, the named arguments of `["Function"]`
are replaced by the wildcards.


```json
["Apply", ["Multiply", "\_", "\_"], 3]
// ➔ 9
["Apply", ["Function", "x", ["Multiply", "x", "x"]], 3]
// ➔ 9
```

You can assign a Lambda expression to a symbol for later use:

```cortex
cube = Lambda(_ * _ * _)
cube(5)
// ➔ 125
```

{% enddef %} 


{% def "Return" %}
<code>["Return", _expression_]</code>

If in an `["Function"]` expression, interupts the evaluation of the function. 
The value of the `["Function"]` expression is _expression_

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
