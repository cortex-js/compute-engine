---
title: Control Structures
permalink: /compute-engine/reference/control-structures/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---

Control Structures define how a sequence of expressions is evaluated.{.xl}

- A `["Block"]` expression defines a **sequential** control structure
- An `["If"]` expression defines a **conditional** control structure.
- A `["FixedPoint"]`, `["Loop"]`, `["Sum"]` or `["Product"]` expression 
  defines an **iterative** control structure.


## Block and If


{% defs "Function" "Operation" %} 

{% def "Block" %}
<code>["Block", _expr-1_, ..._expr-n_]</code><br>
<code>["Block", _dictionary_, _expr1_, ..._expr-n_]</code>

The evaluation of a `["Block"]` expression follows these steps:

1) Create a new scope
2) Set the value of the symbols in `_dictionary_` in this scope.

    The _dictionary_ argument can be a `["Dictionary"]` expression, a 
`["KeyValuePair"]` expression, a `["Pair"]` expression or a `["Tuple"]` expression.

3) Evaluate each _expr_ sequentially.

    If the value of an expression is a `["Return"]` expression, a `["Break"]` 
    expression or a `["Continue"]` expression, no more expressions are 
    evaluated and the value of the `["Block"]` is this expression.
    
    Otherwise, the value of the `["Block"]` expression is the value of the last 
    expression

```json
["Block", ["Tuple", "c", 5], ["Multiply", "c", 2]]
// ➔ 10
```

{% enddef %} 


{% def "If" %}
<code>["If", _condition_, _expr-1_]</code>

- If the value of `_condition_` is the symbol `True`, the value of the `["If"]` 
expression is `_expr-1_`, otherwise `Nothing`.

<code>["If", _condition_, _expr-1_, _expr-2_]</code>

- If the value of `_condition_` is the symbol `True`, the value of the `["If"]` 
expression is `_expr-1_`, otherwise `_expr-2_`.


```json
["Value", "n", -10]
["If", ["Greater", "n", 0], "n", ["Negate", "n"]]
// ➔ 10
```
{% enddef %} 

{% enddefs %}



## Loops

The `Fold`, `Loop`, `Sum` and `Product` functions are iteration control 
structures that share a similar form. 

Their first argument, `body` is an expression that gets evaluated repeatedly.
The `body` expression is evaluated with an implicit argument `_` whose value is
the current iteration element.

Their second argument, `iterator` can take the following shapes:

- `["List", _expr-1_, ..._expr-n]`: the `_` implicit argument takes in turn each
element
- `["Range", _upper_]`: the `_` implicit argument is assigned 
  the value 1, then incremented by 1 until it reaches at least _upper_.
- `["Range", _lower_, _upper_]`: the `_` implicit argument is assigned 
  the values from the lower bound to the upper bound of the range, with a step of 1.
- `["Range", _lower_, _upper_, _step_]`: the `_` implicit argument is assigned 
  the value _lower_ then incremented by _step_ until it reaches at least _upper_.

To use a named argument, use a `["Function"]` expression for the `body`.

```json
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", "x", ["Print", ["Square", "x"]]], ["Range", 5]]
// ➔ 1 4 9 16 25
```

{% defs "Function" "Operation" %} 

{% def "FixedPoint" %}
<code>["FixedPoint", _body_, _initial-value_]</code><br>
<code>["FixedPoint", _body_, _initial-value_, _max-iterations_]</code>

Assumes `_body_` is an expression using an implicit argument `_`.

Apply `_body_` to `_initial-value_`, then apply `_body_` to the result until
the result no longer changes.

To determine if a fixed point has been reached and the loop should terminate, 
the previous and current values are compared with `Same`.


Inside `_body_`, use `["Break"]` to exit the loop immediately or `["Continue"]` 
to skip to the next iteration.



{% enddef %} 

{% def "Fold" %}
<code>["Fold", _body_, _iterator_]</code><br>
<code>["Fold", _body_, _initial-value_, _iterator_]</code>

Evaluate to `[_body_, [_body_, _initial-value_, _elem-1_], _elem-2]]...` where
_elem-1_ and _elem-2_ are the first two elements from the iterator.

```json
["Fold", "Multiply", ["List", 5, 7, 11]]
// ➔ 385
```

See above for the definition of _iterator_.

{% enddef %} 



{% def "Loop" %}
<code>["Loop", _body_]</code><br>
<code>["Loop", _body_, _iterator_]</code><br>

Repeatedly evaluate `_body_` until the last element of the iterator is reached.

See above for the definition of _iterator_.

To exit the loop early, _body_ should evaluate to a `["Break"]` expression, 
a `["Continue"]` expression or a `["Return"]` expression.

```json
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", "x", ["Print", ["Square", "x"]]], ["Range", 5]]
// ➔ 1 4 9 16 25
```


{% enddef %} 

{% def "Product" %}
<code>["Product", _iterator_]</code>

Evaluate to a product of all the elements in `_iterator_`. If all the
elements are numbers, the result is a number. Otherwise it is a simplified list.

Equivalent to `["Fold", "Multiply", _iterator_]`.

```json
["Product", ["List", 5, 7, 11]]
// ➔ 385
["Product", ["List", 5, "x", 11]]
// ➔ ["List", 55, "x"]
```

<code>["Product", _body_, _iterator_]</code>

Evaluate `_body_` and make a product of the result.

Equivalent to `["Fold", ["Multiply", _1, [_body_, _2]], _iterator_]`.

See above for the definition of _iterator_.

{% enddef %} 


{% def "Sum" %}
<code>["Sum", _iterator_]</code>

Evaluate to a sum of all the elements in `_iterator_`. If all the
elements are numbers, the result is a number. Otherwise it is a simplified list.


Equivalent to `["Fold", "Add", _iterator_]`.

```json
["Sum", ["List", 5, 7, 11]]
// ➔ 23
["Sum", ["List", 5, "x", 11]]
// ➔ ["List", 16, "x"]
```

<code>["Sum", _body_, _iterator_]</code>

Evaluate `_body_` and make a sum of the result.

Equivalent to `["Fold", ["Add", _1, [_body_, _2]], _iterator_]`.

{% enddef %} 

{% enddefs %}


## Break and Continue

**To control the flow of a loop expression**, use `["Break"]` and `["Continue"]`.


{% defs "Function" "Operation" %} 

{% def "Break" %}
<code>["Break"]</code><br>
<code>["Break", _expr_]</code><br>

When in a block, exit the block immediately. The value of the `["Block"]` 
expression is the `["Break"]` expression.

When  in a loop exit the loop immediately. The final value of the loop is 
`_expr_` or `Nothing` if not provided.


{% enddef %} 

{% def "Continue" %}
<code>["Continue"]</code><br>
<code>["Continue", _expr_]</code><br>

When in a loop, skip to the next iteration of the loop. The value of the 
iteration is `_expr_` or `Nothing` if not provided.

When in a block, exit the block immediately, and return the `["Continue"]`
expression as the value of the block.

{% enddef %} 

{% enddefs %}


