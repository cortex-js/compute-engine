---
title: Control Structures
permalink: /compute-engine/reference/control-structures/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
preamble:
  "<h1>Control Structures</h1><p class=xl>Control Structures define how a
  sequence of expressions is evaluated</p>"
---

## Overview

The flow of a program is controlled by control structures. Control structures
are expressions that define how a sequence of expressions is evaluated.

There are three kind of control structures:

- **Sequential**: `Block`, the most common where expressions are evaluated one
  after the other
- **Conditional** `If` or `Which`, where expressions are evaluated depending on
  the value of a condition
- **Iterative** `Loop` or `FixedPoint`, where expressions are evaluated
  repeatedly

## Sequential Control Structure

{% def "Block" %}

[&quot;**Block**&quot;, _expr-1_, ..._expr-n_]{.signature}

A `["Block"]` expression is a sequence of expressions that are evaluated
sequentially.

A new scope is created for the `["Block"]` expression. The scope is destroyed
when the `["Block"]` expression is finished evaluating. This means that
variables defined in the `["Block"]` expression are not accessible outside of
the `["Block"]` expression.

The value of the `["Block"]` expression is the value of the last expression
`expr-n`.

If one of the expression in the block is a `["Return"]` expression, a
`["Break"]` expression or a `["Continue"]` expression, no more expressions are
evaluated and the value of the `["Block"]` is this expression.

`["Block"]` expressions can be nested as necessary.

```json example
["Block", ["Assign", "c", 5], ["Multiply", "c", 2]]


// ➔ 10
```

{% enddef %}

## Conditional Control Structure

{% def "If" %}

[&quot;**If**&quot;, _condition_, _expr-1_]{.signature}

If the value of `condition`is the symbol `True`, the value of the `["If"]`
expression is `expr-1`, otherwise `Nothing`.

[&quot;**If**&quot;, _condition_, _expr-1_, _expr-2_]{.signature}

If the value of `condition`is the symbol `True`, the value of the `["If"]`
expression is `expr-1`, otherwise `expr-2`.

Here's an example of a function that returns the absoluve value of a number:

```json example
["Function", ["If", ["Greater", "n", 0], "n", ["Negate", "n"]], "n"]
```

`["If"]` expressions can be nested as necessary.

{% enddef %}

{% def "Which" %}

[&quot;**Which**&quot;, _condition-1_, _expr-1_, ..._condition-n_,
_expr-n_]{.signature}

The value of the `["Which"]` expression is the value of the first expression
`expr-n` for which the corresponding condition `condition-n` is `True`.

{% latex "\\begin{cases} x &amp; \\text{if } x &gt; 0 \\\\ -x &amp; \\text{if } x &lt; 0 \\\\ 0 &amp; \\text{otherwise} \\end{cases}" %}

```json example
["Block",
  ["Assign", "n", -10]
  ["Which", ["Greater", "n", 0], "n", ["Negate", "n"], "n"]
]
// ➔ 10
```

A `["Which"]` expression is equivalent to the following `["If"]` expression:

```json example
["If", ["Equal", condition-1, "True"], expr-1,
    ["If", ["Equal", condition-2, "True"], _expr-2,
    ... ["If", ["Equal", condition-n, "True"],
          expr-n,
          "Nothing"
    ]
  ]
]
```

A `["Which"]` expression is equivalent to a `switch` statement in JavaScript or
the `Which[]` function in Mathematica.

{% enddef %}

## Loops

{% defs "Function" "Description" %}

{% def "Loop" %}

[&quot;**Loop**&quot;, _body_]{.signature}

Repeatedly evaluate `body`until the value of `body`is a `["Break"]` expression,
or a `["Return"]` expression.

- `["Break"]` exits the loop immediately. The value of the `["Loop"]` expression
  is the value of the `["Break"]` expression.
- `["Return"]` exits the loop and returns the value of the `["Return"]`
  expression.

To exit the loop, a `["Break"]` or `["Return"]` expression must be evaluated.

`Loop` with only a _body_ argument is equivalent to a `while(true)` in
JavaScript or a `While[True, ...]` in Mathematica.

[&quot;**Loop**&quot;, _body_, _collection_]{.signature}

Iterates over the elements of `collection` and evaluates `body` with an implicit
argument `_` whose value is the current element. The value of the `["Loop"]`
expression is the value of the last iteration of the loop, or the value of the
`["Break"]` expression if the loop was exited with a `["Break"]` expression.

```json example
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", ["Print", ["Square", "x"], "x"]], ["Range", 5]]
// ➔ 1 4 9 16 25
```

`Loop` with a `body` and `collection` to iterate is equivalent to a `forEach()`
in JavaScript. It is somewhat similar to a `Do[...]` in Mathematica.

{% enddef %}

{% def "FixedPoint" %}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_]{.signature}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_,
_max-iterations_]{.signature}

Assumes `body`is an expression using an implicit argument `_`.

Apply `body`to `initial-value`, then apply `body`to the result until the result
no longer changes.

To determine if a fixed point has been reached and the loop should terminate,
the previous and current values are compared with `Equal`.

Inside `body`, use a `["Break"]` expression to exit the loop immediately or
`Return` to exit the enclosing `["Function"]` expression.

{% readmore "/compute-engine/reference/collections/#Fold" %}See also the
**`Fold` function** which operates on a collection {% endreadmore %}

{% enddef %}

{%readmore "/compute-engine/reference/statistics/" %}Read more about the
`Product` and `Sum` functions which are specialized version of loops.
{% endreadmore %}

{% readmore "/compute-engine/reference/collections/" %}Read more about
operations on collection such as `Map` and `Fold` which are functional
programming constructs that can be used to replace loops. {% endreadmore %}

{% enddefs %}

## Controlling the Flow of Execution

**To exit a function**, use `Return`.

**To control the flow of a loop expression**, use `Break` and `Continue`.

{% defs "Function" "Description" %}

{% def "Return" %}

[&quot;**Return**&quot;, _value_]{.signature}

Interupts the evaluation of a `["Function"]` expression. The value of the
`["Function"]` expression is `value`.

The `["Return"]` expression is useful when used with functions that have
multiple exit points, conditional logic, loops, etc...

Here's a contrived example of a function that returns the sign of a number:

```json example
[
  "Function",
  [
    "Block",
    ["If", ["Greater", "x", 0], ["Return", 1]],
    ["If", ["Less", "x", 0], ["Return", -1]],
    0
  ],
  "x"
]
```

{% readmore "/compute-engine/reference/functions/" %}Read more about
**functions**. {% endreadmore %}

{% enddef %}

{% def "Break" %}

[&quot;**Break**&quot; ]{.signature}

[&quot;**Break**&quot;, _value_]{.signature}

When in a loop exit the loop immediately. The final value of the loop is
`value`or `Nothing` if not provided.

{% enddef %}

{% def "Continue" %}

[&quot;**Continue**&quot; ]{.signature}

[&quot;**Continue**&quot;, _value_]{.signature}

When in a loop, skip to the next iteration of the loop. The value of the
iteration is `value` or `Nothing` if not provided.

{% enddef %}

{% enddefs %}
