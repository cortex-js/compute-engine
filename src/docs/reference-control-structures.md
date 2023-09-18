---
title: Control Structures
permalink: /compute-engine/reference/control-structures/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
preamble:
  '<h1>Control Structures</h1><p class=xl>Control Structures define how a
  sequence of expressions is evaluated</p>'
---

- A `["Block"]` expression defines a **sequential** control structure
- An `["If"]` expression defines a **conditional** control structure.
- A `["FixedPoint"]`, `["Loop"]`, `["Sum"]` or `["Product"]` expression defines
  an **iterative** control structure.

## Sequential Control Structure

{% def "Block" %}

[&quot;**Block**&quot;, _expr-1_, ..._expr-n_]{.signature}

[&quot;**Block**&quot;, _dictionary_, _expr1_, ..._expr-n_]{.signature}

The evaluation of a `["Block"]` expression follows these steps:

1.  Create a new scope
2.  Set the value of the symbols in `_dictionary_` in this scope.

        The _dictionary_ argument can be a `["Dictionary"]` expression, a

    `["KeyValuePair"]` expression, a `["Pair"]` expression or a `["Tuple"]`
    expression.

3.  Evaluate each _expr_ sequentially.

    If the value of an expression is a `["Return"]` expression, a `["Break"]`
    expression or a `["Continue"]` expression, no more expressions are evaluated
    and the value of the `["Block"]` is this expression.

    Otherwise, the value of the `["Block"]` expression is the value of the last
    expression

```json example
["Block", ["Tuple", "c", 5], ["Multiply", "c", 2]]
// ➔ 10
```

{% enddef %}

{% def "Return" %}

[&quot;**Return**&quot;, _value_]{.signature}

If in a `["Function"]` expression, interupts the evaluation of the function. The
value of the `["Function"]` expression is _value_

The `["Return"]` expression is useful when used with more complex functions that
have multiple exit points, conditional logic, loops, etc...

{% readmore "/compute-engine/reference/functions/" %}Read more about
**functions**. {% endreadmore %}

{% enddef %}

## Conditional Control Structure

{% def "If" %}

[&quot;**If**&quot;, _condition_, _expr-1_]{.signature}

- If the value of `_condition_` is the symbol `True`, the value of the `["If"]`
  expression is `_expr-1_`, otherwise `Nothing`.

[&quot;**If**&quot;, _condition_, _expr-1_, _expr-2_]{.signature}

- If the value of `_condition_` is the symbol `True`, the value of the `["If"]`
  expression is `_expr-1_`, otherwise `_expr-2_`.

```json example
["Value", "n", -10]
["If", ["Greater", "n", 0], "n", ["Negate", "n"]]
// ➔ 10
```

{% enddef %}

{% def "Which" %}

[&quot;**Which**&quot;, _condition-1_, _expr-1_, ..._condition-n_,
_expr-n_]{.signature}

The value of the `["Which"]` expression is the value of the first expression
`_expr-n_` for which the corresponding condition `_condition-n_` is `True`.

This is equivalent to the following `["If"]` expression:

```json example
["If", ["Equal", "_condition-1_", "True"], "_expr-1_", ["If", ["Equal", "_condition-2_", "True"], "_expr-2_", ... ["If", ["Equal", "_condition-n_", "True"], "_expr-n_", "Nothing"]]]
```

A `["Which"]` expression is equivalent to a `switch` statement in JavaScript.

{% latex "\\begin{cases} x &amp; \\text{if } x &gt; 0 \\\\ -x &amp; \\text{if } x &lt; 0 \\\\ 0 &amp; \\text{otherwise} \\end{cases}" %}

```json example
["Assign", "n", -10]
["Which", ["Greater", "n", 0], "n", ["Negate", "n"], "n"]
// ➔ 10
```

{% enddef %}

## Loops

{% defs "Function" "Description" %}

{% def "FixedPoint" %}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_]{.signature}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_,
_max-iterations_]{.signature}

Assumes `_body_` is an expression using an implicit argument `_`.

Apply `_body_` to `_initial-value_`, then apply `_body_` to the result until the
result no longer changes.

To determine if a fixed point has been reached and the loop should terminate,
the previous and current values are compared with `Same`.

Inside `_body_`, use `["Break"]` to exit the loop immediately or `["Continue"]`
to skip to the next iteration.

{% readmore "/compute-engine/reference/collections/#Fold" %}See also the
**`Fold` function** which operates on a collection {% endreadmore %}

{% enddef %}

{% def "Loop" %}

[&quot;**Loop**&quot;, _body_]{.signature}

Repeatedly evaluate `_body_` until the value of `_body_` is a `["Break"]`
expression, a `["Continue"]` expression or a `["Return"]` expression.

- `["Break"]` exits the loop immediately.
- `["Continue"]` skips to the next iteration of the loop.
- `["Return"]` exits the loop and returns the value of the `["Return"]`
  expression.

`Loop` with only a _body_ argument is equivalent to a `while(true)` in
JavaScript.

[&quot;**Loop**&quot;, _body_, _collection_]{.signature}

[&quot;**Loop**&quot;, _body_, _collection_, _index_]{.signature}

Iterates over the elements of _collection_ and evaluates _body_ with an implicit
argument `_` whose value is the current element. The value of the `["Loop"]`
expression is the value of the last iteration of the loop, or the value of the
`["Break"]` expression if the loop was exited with a `["Break"]` expression.

If `_index_` is provided, the corresponding symbol is assigned the value of the
current element.

`Loop` with a _body_ and _collection_ to iterate is equivalent to a `forEach()`
in JavaScript.

```json example
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", ["Print", ["Square", "x"], "x"]], ["Range", 5]]
// ➔ 1 4 9 16 25
```

{% enddef %}

{%readmore "/compute-engine/reference/statistics/" %}Read more about the
`Product` and `Sum` functions which are specialized version of loops.
{% endreadmore %}

{% readmore "/compute-engine/reference/collections/" %}Read more about
operations on collection such as `Map` and `Reduce` which are functional
programming constructs that can be used to replace loops. {% endreadmore %}

{% enddefs %}

## Break and Continue

**To control the flow of a loop expression**, use `["Break"]` and
`["Continue"]`.

{% defs "Function" "Description" %}

{% def "Break" %}

[&quot;**Break**&quot; ]{.signature}

[&quot;**Break**&quot;, _expr_]{.signature}

When in a block, exit the block immediately. The value of the `["Block"]`
expression is the `["Break"]` expression.

When in a loop exit the loop immediately. The final value of the loop is
`_expr_` or `Nothing` if not provided.

{% enddef %}

{% def "Continue" %}

[&quot;**Continue**&quot; ]{.signature}

[&quot;**Continue**&quot;, _expr_]{.signature}

When in a loop, skip to the next iteration of the loop. The value of the
iteration is `_expr_` or `Nothing` if not provided.

When in a block, exit the block immediately, and return the `["Continue"]`
expression as the value of the block.

{% enddef %}

{% enddefs %}
