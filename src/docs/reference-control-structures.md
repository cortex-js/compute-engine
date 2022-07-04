---
title: Control Structures
permalink: /compute-engine/reference/control-structures/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---

Control Structures, along with Loops, define how a sequence of expressions
is evaluated.

- A `["Block"]` expression defines a **sequential** control structure
- An `["If"]` expression defines a **conditional** control structure.
- A `["Loop"]`, `["FixedPoint"]`, `["Sum"]`, `["Product"]` expression defines an **iterative** control structure.


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


Use `["Break"]` to exit the loop immediately or `["Continue"]` to skip to
the next iteration.



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
`_body_` is a `["Break"]` expression, a `["Continue"]` expression or a 
`["Return"]` expression.

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


