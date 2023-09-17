---
title: Functions
permalink: /compute-engine/reference/functions/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
---

The Compute Engine Standard Library includes many built-in functions such as
`Add`, `Sin`, `Power`, etc...

The standard library can be extended with your own functions.

{% readmore "/compute-engine/guides/augmenting/" %}Read more about adding new
definitions to the Compute Engine.{% endreadmore %}

## Anonymous Functions and Anonymous Parameters

A function that is not bound to an identifier is called an **anonymous
function**.

Anonymous functions are frequently used as arguments to other functions.

In the example below, the `["Function"]` expression is an anonymous function
that is passed as an argument to the `["Sum"]` function.

```json example
["Sum", ["Function", ["Multiply", "x", 2], "x"]]
```

The parameters of a function can also be anonymous. In this case, the arguments
are bound to the wildcards `_`, `_1`, `_2`, etc... in the body of the function.
The wildcard `_` is a shorthand for `_1`, the first parameter.

In the example below, both the function and its parameters are anonymous.

```json example
["Sum", ["Multiply", "_", 2]]
```

## Evaluating an Anonymous Function

To apply a function to some arguments, use an `["Apply"]` expression.

```json example
["Apply", ["Add", 2, "_"], 4]
// ➔ 6
["Apply", "Power", 2, 3]
// ➔ 8
```

The first argument of `Apply` is a an anonymous function, either as an
identifier, or as a `["Function"]` expression. The rest of the arguments are the
arguments of the anonymous function.

## Operating on Functions

{% defs "Function" "Description" %}

{% def "Function" %}

[&quot;**Function**&quot;, _body_]{.signature}

[&quot;**Function**&quot;, _body_, _arg-1_, _arg-2_, ...]{.signature}

Create an
[anonymous function](https://en.wikipedia.org/wiki/Anonymous_function), also
called **lambda expression**.

The `arg-n` arguments are identifiers of the bound variables (parameters) of the
anonymous function.

All the arguments have the `Hold` attribute set, so they are not evaluated when
the function is created.{.notice--info}

The _body_ is a `MathJSON` expression that is evaluated when the function is
applied to some arguments.

**To apply some arguments to a function expression**, use `["Apply"]`.

{% latex " x \\mapsto 2x" %}

```json example
["Function", ["Multiply", "x", 2], "x"]
```

{% latex " (x, y) \\mapsto 2x + y" %}

```json example
["Function", ["Add", ["Multiply", "x", 2], "y"], "x", "y"]
```

{% enddef %}

{% def "Assign" %}

[&quot;**Assign**&quot;, _id_, _fn_]{.signature}

Assign the anonymous function _fn_ to the identifier _id_.

The identifier _id_ should either not have been declared yet, or been declared
as a function. If _id_ is already defined as a `Number` for example, it is an
error to assign a function to it.

{% latex "\\operatorname{double} = x \\mapsto 2x" %}

```json example
["Assign", "double", ["Function", ["Multiply", "x", 2], "x"]]
```

{% enddef %}

{% def "Apply" %}

[&quot;**Apply**&quot;, _function_, _expr-1_, ..._expr-n_]{.signature}

[Apply](https://en.wikipedia.org/wiki/Apply) a list of arguments to a function.
The _function_ is either an identifier of a function, or a `["Function"]`
expression.

The following wildcards in _body_ are replaced as indicated

- `_` or `_1` : the first argument
- `_2` : the second argument
- `_3` : the third argument, etc...
- `__`: the sequence of arguments, so `["Length", "__"]` is the number of
  arguments

If _body_ is a `["Function"]` expression, the named arguments of `["Function"]`
are replaced by the wildcards.

```json example
["Apply", ["Multiply", "_", "_"], 3]
// ➔ 9
["Apply", ["Function", ["Multiply", "x", "x"], "x"], 3]
// ➔ 9
```

{% enddef %}

{% def "Return" %}

[&quot;**Return**&quot;, _value_]{.signature}

If in a `["Function"]` expression, interupts the evaluation of the function. The
value of the `["Function"]` expression is _value_

The `["Return"]` expression is useful when used with more complex functions that
have multiple exit points, conditional logic, loops, etc...

{% enddef %}

{% enddefs %}
