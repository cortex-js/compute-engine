---
title: Core
permalink: /compute-engine/reference/core/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
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

{% latex "\\lbrack 2, ,3 \\rbrack " %}

```json example
["List", 2, "Nothing", 3]
```

</section>

## Declaring, Assigning and Assuming

Before an identifier can be used it has to be declared. The `Declare` function
is used to declare a new identifier in the current scope.

Once an identifier has been declared, its value can be changed using the
`Assign` function.

The `Assume` function is used to assert a predicate about an expression. It is
used to provide additional information to the system, for example to indicate
that a variable is positive, or that a function is continuous.

{% def "Declare" %}

[&quot;**Declare**&quot;, _identifier_, _domain_]{.signature}

[&quot;**Declare**&quot;, _identifier_, _domain_, _value_]{.signature}

Declare a new identifier in the current scope, and set its value and domain.

If the identifier already has a definition in the current scope, evaluate to an
error, otherwise evaluate to `value`.

This is equivalent to `let` in JavaScript or `var` in Python.

**To change the value of an existing identifier**, use an `["Assign"]`
expression.

`Declare` is not a [pure function](/compute-engine/guides/expressions#pure-expressions).


{% readmore "/compute-engine/guides/augmenting/" %}Read more about using
`ce.declare()` to declare a new symbol or function. {% endreadmore %}

{% enddef %}

{% def "Assign" %}

[&quot;**Assign**&quot;, _identifier_, _value_]{.signature}

Set the value of `identifier` to `value`.

If `identifier` has not been declared in the current scope, consider parent
scopes until a definition for the identifier is found.

If a definition is found, change the value of the identifier to `value` if the
value is compatible with the domain of the identifier: once set, the domain of
an identifier cannot be changed.

If there is no definition for the identifier, add a new definition in the
current scope, and use the `value` to infer the domain of the identifier.

This is equivalent to `=` in may programming languages.

`Assign` is not a [pure function](/compute-engine/guides/expressions#pure-expressions).

{% readmore "/compute-engine/guides/augmenting/" %}Read more about using
`Assign` to change the value of a symbol or function. {% endreadmore %}

{% enddef %}

{% def "Assume" %}

[&quot;**Assume**&quot;, _predicate_]{.signature}

The predicate is an expression that evaluates to `True` or `False`.

The identifiers in the predicate expression may be free, i.e. they may not have
have been declared yet. Asserting an assumption does not declare the identifiers
in the predicate.

The predicate can take the form of:

- an equality: `["Assume", ["Equal", "x", 3]]`
- an inequality: `["Assume", ["Greater", "x", 0]]`
- a membership expression: `["Assume", ["Element", "x", "Integers"]]`

`Assign` is not a [pure function](/compute-engine/guides/expressions#pure-expressions).


{% enddef %}


## Structural Operations

The following functions can be applied to non-canonical expressions.
The do not depend on the canonical form, but reflect the structure of the
expression.

{% def "About" %}

[&quot;**About**&quot;, _identifier_]{.signature}

Evaluate to a dictionary expression containing information about an identifier
such as its domain, its attributes, its value, etc...

{% enddef %}


{% def "Head" %}

[&quot;**Head**&quot;, _expression_]{.signature}

Evaluate to the head of _expression_

```json example
["Head", ["Add", 2, 3]]

// ➔ "Add"
```

{% enddef %}

{% def "Tail" %}

[&quot;**Tail**&quot;, _expression_]{.signature}

Evaluate to a sequence of the arguments of _expression_.

```json example
["Tail", ["Add", 2, 3]]
// ➔ ["Sequence", 2, 3]
```

`Tail` can be used to change the head of an expression, for example:

```json example
["Multiply", ["Tail", ["Add", 2, 3]]]
// ➔ ["Multiply", 2, 3]
```


{% enddef %}



{% def "Hold" %}

[&quot;**Hold**&quot;, _expression_]{.signature}

Tag an expression that should be kept in an unevaluated form

{% enddef %}

{% def "Identity" %}

[&quot;**Identity**&quot;, _expression_]{.signature}

Evaluate to its argument

In the mathematical sense, this is an operator (a function that takes a function
as an argument and returns a function).

{% enddef %}



## Inspecting an Expression

The following functions can be used to obtain information about an expression.


{% def "Domain" %}

[&quot;**Domain**&quot;, _expression_]{.signature}

Evaluate to the domain of _expression_

```json example
["Domain", 2.4531]

// ➔ "RealNumbers"
```

{% enddef %}


{% def "IsSame" %}

[&quot;**IsSame**&quot;, _expression1_, _expression2_]{.signature}

Evaluate to `True` if the two expressions are structurally identical, otherwise
evaluate to `False`.

```json example
["IsSame", ["Add", 2, 3], ["Add", 2, 3]]
// ➔ True
```

{% enddef %}


{%enddef %}


## Transforming an Expression

{% def "Evaluate" %}

[&quot;**Evaluate**&quot;, _expression_]{.signature}

Apply a sequence of definitions to an expression in order to reduce, simplify
and calculate its value. Overrides `Hold` and hold attributes of a function.

{% enddef %}

{% def "Simplify" %}

[&quot;**Simplify**&quot;, _expression_]{.signature}

The `Simplify` function applies a sequence of transformations to an expression
in order to reduce, simplify and calculate its value.

{% enddef %}


{% def "CanonicalOrder" %}

[&quot;**CanonicalOrder**&quot;, _expression_]{.signature}

If _expression_ is a commutative function, sort the
arguments according to the canonical order of the arguments of the function.

If _expression_ is canonical, this function has no effect.

```json
["CanonicalOrder", ["Add", 3, 2, 1]]
// -> ["Add", 1, 2, 3]
```

This can be useful to compare two non-canonical expressions for equality, for example:

```json
["IsSame",
  ["Add", 1, "x"], 
  ["Add", "x", 1]
]
// -> False

["IsSame", 
  ["CanonicalOrder", ["Add", 1, "x"]], 
  ["CanonicalOrder", ["Add", "x", 1]]
]
// -> True
```

To compare the input from a mathfield with an expected 
answer, you could use:

```js
const correct = ce..box(
    ['CanonicalOrder', ce.parse(mf.value, {canonical: false})])
    .isSame(ce.box(ce.parse("1+x"))
```

Both `1+x` and `x+1` will return **true**, but `2-1+x` will return **false**.


{% enddef %}



{% def "N" %}

[&quot;**N**&quot;, _expression_]{.signature}

Evaluate to a numerical approximation of the expression.

```json example
["N", ["Pi"]]

// ➔ 3.141592653589793
```

{% enddef %}

<section id='core-functions'>

## Core Functions

{% def "Error" %}

[&quot;**Error**&quot;, _error-code_, _context_]{.signature}

Tag an expression that could not be interpreted correctly. It may have a syntax
error, a reference to an unknown identifier or some other problem.

The first argument, `error-code` is either a string, or an `["ErrorCode"]`
expression.

The _context_ is an optional expression that provides additional information
about the error.

{% enddef %}

{% def "InverseFunction" %}

[&quot;**InverseFunction**&quot;, _symbol_]{.signature}

Evaluate to the inverse function of its argument for example `Arcsin` for `Sin`.

{% latex "\\sin^{-1}(x)" %}

```json example
[["InverseFunction", "Sin"], "x"]]
```

In the mathematical sense, this is an operator (a function that takes a function
as an argument and returns a function).

{% enddef %}

{% def "String" %}

[&quot;**String**&quot;, _expression_]{.signature}

Evaluate to a string made from the concatenation of the arguments converted to
strings

```json example
["String", "x", 2]

// ➔ "'x2'"
```

{% enddef %}

{% def "Symbol" %}

[&quot;**Symbol**&quot;, _expression_]{.signature}

Evaluate to a new symbol made of a concatenation of the arguments.

```json example
["Symbol", "x", 2]

// ➔ "x2"
```

The symbol is not declared, it remains a free variable. To declare the symbol
use `Declare`.

```json example
["Declare", ["Symbol", "x", 2], "RealNumbers"]
```

{% enddef %}

</section>

## Parsing and Serializing Latex

{% def "Parse" %}

[&quot;**Parse**&quot;, _string_]{.signature}

If _expr_ is a `["LatexString"]` expression, evaluate to a MathJSON expression
corresponding to the LaTeX string.

```json example
["Parse", ["LatexString", "'\\frac{\\pi}{2}'"]]

// ➔ ["Divide", "Pi", 2]
```

{% enddef %}

{% def "Latex" %}

[&quot;**Latex**&quot;, _expression_]{.signature}

Evaluate to a `LatexString` which is the expression serialized to LaTeX
{% enddef %}

{% def "LatexString" %}

[&quot;**LatexString**&quot;, _string_]{.signature}

Tag a string as a LaTeX string

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
