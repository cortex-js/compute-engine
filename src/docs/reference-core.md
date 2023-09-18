---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

The functions described in this section are part of the **core** of the Compute
Engine.

<section id="constants">

## Constants

The symbols below are **inert constants**. They are used as tags and have no
value other than themselves.

| Symbol      | Description                                                                                                                                                                        |
| :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `All`       | All the possible values apply                                                                                                                                                      |
| `None`      | None of the possible values apply                                                                                                                                                  |
| `Nothing`   | An **optional** expression is not present. Used in sparse list to indicate skipped elements.                                                                                       |
| `Undefined` | The result is not defined. For example, the domain of an unknown symbol is `Undefined`.<br>Note that for numbers, the equivalent is `NaN` (Not a Number) and for booleans, `Maybe` |

{% latex "\\[\lbrack 2, ,3 \rbrack\\] " %}

```json example
["List", 2, "Nothing", 3]
```

</section>

## Assignment, Declaration and Assumptions

{% def "Assume" %}

[&quot;**Assume**&quot;, _predicate_]{.signature}

The predicate is an expression that evaluates to `True` or `False. The symbols
or functions in the predicate expression may be free (i.e. not have a
definition).

The predicate can take the form of an equality, an inequality or a membership
expression:

- `["Assume", ["Equal", "x", 3]]`
- `["Assume", ["Greater", "x", 0]]`
- `["Assume", ["Element", "x", "Integer"]]`

{% enddef %}

{% def "Declare" %}

[&quot;**Declare**&quot;, _symbol_, _domain_]{.signature}

[&quot;**Declare**&quot;, _symbol_, _domain_, _value_]{.signature}

Declare a new symbol in the current scope, and set its value and domain. If
_<kbd>domain</kbd>_ is not provided, the domain is inferred based on the value.

If the symbol already has a definition in the current scope, evaluate to an
error, otherwise evaluate to _<kbd>value</kbd>_. To change the value of an
existing symbol, use a `["Set"]` expression.

<code>["Declare", _function-expression_, _value_]</code>

Define a new function in the current scope. The name of the function and its
arguments are provided by the function expression. The value is an expression
using the arguments from _<kbd>function-expression</kbd>_.

```
// Declare f(x) := x + 1
["Declare", ["f", "x"], ["Add", "x", 1]]
```

The arguments of the function expression should be either

- symbols
- pairs of symbol and domain.

```
// Declare f(n) := 2n, where n is an integer
["Declare", ["f", ["Tuple", "n", "Integer]], ["Multiply", "n", 2]]
```

{% readmore "/compute-engine/guides/augmenting/" %}Read more about using
`ce.declare()` to declare a new symbol or function. {% endreadmore %}

{% enddef %}

{% def "Assign" %}

[&quot;**Assign**&quot;, _symbol_, _value_]{.signature}

Set the value of _<kbd>symbol</kbd>_ to _<kbd>value</kbd>_.

If _<kbd>symbol</kbd>_ does not exist in the current context, consider parent
scopes until a definition for the symbol is found.

If there is no definition for the symbol, evaluate to an error, otherwise
evaluate to _<kbd>value</kbd>_. To define a new symbol, use a `["Declare"]`
expression.

{% readmore "/compute-engine/guides/augmenting/" %}Read more about using `Set`
to change the value of a symbol or function. {% endreadmore %}

{% enddef %}

<section id='core-functions'>

## Core Functions

{% def "About" %}

[&quot;**About**&quot;, _symbol_, _value_]{.signature}

Evaluate to a dictionary containing information about a symbol such as its
domain, its attributes, its value, etc...

{% enddef %}

{% def "Domain" %}

[&quot;**Domain**&quot;, _expression_]{.signature}

Evaluate to the domain of _expression_

```json example
["Domain", 2.4531]
// -> "RealNumber"
```

{% enddef %}

{% def "Head" %}

[&quot;**Head**&quot;, _expression_]{.signature}

Evaluate to the head of _expression_

```json example
["Head", ["Add", 2, 3]]
// -> "Add"
```

{% enddef %}

{% def "Evaluate" %}

[&quot;**Evaluate**&quot;, _expression_]{.signature}

Apply a sequence of definitions to an expression in order to reduce, simplify
and calculate its value. Overrides `Hold` and hold attributes of a function.

{% enddef %}

{% def "Error" %}

[&quot;**Error**&quot;, _expression_, _string_, _rest_]{.signature}

Tag an expression that could not be interpreted correctly. It may have a syntax
error, a reference to an unknown symbol or function or some other problem.

Note that an `Error` expression can be a sub-expression.

The second argument is a string indicating the problem.

The third argument, if present, is an expression describing what could not be
parsed. {% enddef %}

{% def "Hold" %}

[&quot;**Hold**&quot;, _expression_]{.signature}

Tag an expression that should be kept in an unevaluated form {% enddef %}

{% def "Html" %}

[&quot;**Html**&quot;, _expression_]{.signature}

Evaluate to a string which is the HTML markup corresponding to the expression.
If the head of _expr_ is `LatexString`, `Latex` or `LatexTokens`, renders the
LaTeX to HTML markup {% enddef %} {% def "Identity" %} <code>["Identity",
_expression_]</code>

Evaluate to its argument

{% enddef %}

{% def "Identity" %}

[&quot;**Identity**&quot;, _expression_]{.signature}

Evaluate to its argument

{% enddef %}

{% def "InverseFunction" %}

[&quot;**InverseFunction**&quot;, _expression_]{.signature}

Evaluate to the inverse function of its argument for example `Arcsin` for `Sin`

{% latex "\\[\\sin^{-1}(x)\\]" %}

```json example
[["InverseFunction", "Sin"], "x"]\
```

{% enddef %}

{% enddef %}

{% def "Latex" %}

[&quot;**Latex**&quot;, _expression_]{.signature}

Evaluate to a `LatexString` which is the expression serialized to LaTeX
{% enddef %}

{% def "LatexString" %}

[&quot;**LatexString**&quot;, _string_]{.signature}

Tag a string as a LaTeX string

{% enddef %}

{% def "Parse" %}

[&quot;**Parse**&quot;, _string_]{.signature}

If _expr_ is a `["LatexString"]` expression, evaluate to a MathJSON expression
corresponding to the LaTeX string.

```json example
["Parse", ["LatexString", "'\\frac{\\pi}{2}'"]]
// -> ["Divide", "Pi", 2]
```

{% enddef %}

{% def "String" %}

[&quot;**String**&quot;, _expression_]{.signature}

Evaluate to a string made from the concatenation of the arguments converted to
strings {% enddef %}

```json example
["String", "x", 2]
// -> "'x2'"
```

{% enddef %}

{% def "Symbol" %}

[&quot;**Symbol**&quot;, _expression_]{.signature}

Evaluate to a new symbol made of a concatenation of the arguments.

```json example
["Symbol", "x", 2]
// -> "x2"
```

The symbol is not declared, it remains a free variable. To declare the symbol
use `Declare`.

```json example
["Declare", ["Symbol", "x", 2], "RealNumber"]
```

{% enddef %}

</section>

## `Parse`, `Latex`, `LatexTokens` and `LatexString`

{% def "Parse" %}

[&quot;**Parse**&quot;, _expression_]{.signature}

- `expr`: a MathJSON expression
- Returns a LaTeX string representing the expression.

```json example
["Latex", ["Divide", "Pi", 2]]
// ➔ "'\frac{\pi}{2}'"
```

{% enddef %}

<section id="supsub">

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
