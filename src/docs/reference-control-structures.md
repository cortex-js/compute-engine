---
title: Control Structures
permalink: /compute-engine/reference/control-structures/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
preamble: '<h1>Control Structures</h1><p class=xl>Control Structures define how a sequence of expressions is evaluated</p>'
---


- A `["Block"]` expression defines a **sequential** control structure
- An `["If"]` expression defines a **conditional** control structure.
- A `["FixedPoint"]`, `["Loop"]`, `["Sum"]` or `["Product"]` expression 
  defines an **iterative** control structure.


## Block and If


{% defs "Function" "Operation" %} 

{% def "Block" %}

[&quot;**Block**&quot;, _expr-1_, ..._expr-n_]{.signature}

[&quot;**Block**&quot;, _dictionary_, _expr1_, ..._expr-n_]{.signature}


The evaluation of a `["Block"]` expression follows these steps:

1) Create a new scope
2) Set the value of the symbols in `_dictionary_` in this scope.

    The _dictionary_ argument can be a `["Dictionary"]` expression, a 
`["KeyValuePair"]` expression, a `["Pair"]` expression or a `["Tuple"]` expression.

1) Evaluate each _expr_ sequentially.

    If the value of an expression is a `["Return"]` expression, a `["Break"]` 
    expression or a `["Continue"]` expression, no more expressions are 
    evaluated and the value of the `["Block"]` is this expression.
    
    Otherwise, the value of the `["Block"]` expression is the value of the last 
    expression

```json example
["Block", ["Tuple", "c", 5], ["Multiply", "c", 2]]
// ➔ 10
```

{% enddef %} 


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

```json example
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", ["Print", ["Square", "x"]], "x"], ["Range", 5]]
// ➔ 1 4 9 16 25
```

{% defs "Function" "Operation" %} 

{% def "FixedPoint" %}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_]{.signature}

[&quot;**FixedPoint**&quot;, _body_, _initial-value_, _max-iterations_]{.signature}


Assumes `_body_` is an expression using an implicit argument `_`.

Apply `_body_` to `_initial-value_`, then apply `_body_` to the result until
the result no longer changes.

To determine if a fixed point has been reached and the loop should terminate, 
the previous and current values are compared with `Same`.


Inside `_body_`, use `["Break"]` to exit the loop immediately or `["Continue"]` 
to skip to the next iteration.



{% enddef %} 

{% def "Fold" %}

[&quot;**Fold**&quot;, _body_, _iterator_]{.signature}

[&quot;**Fold**&quot;, _body_, _initial-value_, _iterator_]{.signature}


Evaluate to `[_body_, [_body_, _initial-value_, _elem-1_], _elem-2]]...` where
_elem-1_ and _elem-2_ are the first two elements from the iterator.

```json example
["Fold", "Multiply", ["List", 5, 7, 11]]
// ➔ 385
```

See above for the definition of _iterator_.

{% enddef %} 



{% def "Loop" %}

[&quot;**Loop**&quot;, _body_]{.signature}

Repeatedly evaluate `_body_` until the last element of the iterator is reached.

See above for the definition of _iterator_.

To exit the loop early, _body_ should evaluate to a `["Break"]` expression, 
a `["Continue"]` expression or a `["Return"]` expression.

```json example
["Loop", ["Print", ["Square", "_"]], ["Range", 5]]
// ➔ 1 4 9 16 25
["Loop", ["Function", ["Print", ["Square", "x"], "x"]], ["Range", 5]]
// ➔ 1 4 9 16 25
```


{% enddef %} 

{% def "Product" %}

[&quot;**Product**&quot;, _iterator_]{.signature}

Evaluate to a product of all the elements in `_iterator_`. If all the
elements are numbers, the result is a number. Otherwise it is a simplified list.

Equivalent to `["Fold", "Multiply", _iterator_]`.

```json example
["Product", ["List", 5, 7, 11]]
// ➔ 385
["Product", ["List", 5, "x", 11]]
// ➔ ["List", 55, "x"]
```

[&quot;**Product**&quot;, _body_, _iterator_]{.signature}

Evaluate `_body_` and make a product of the result.

Equivalent to `["Fold", ["Multiply", _1, [_body_, _2]], _iterator_]`.

See above for the definition of _iterator_.

{% enddef %} 


{% def "Sum" %}

[&quot;**Sum**&quot;, _body_]{.signature}

Evaluate to a sum of all the elements in `_iterator_`. If all the
elements are numbers, the result is a number. Otherwise it is a simplified list.


Equivalent to `["Fold", "Add", _iterator_]`.

```json example
["Sum", ["List", 5, 7, 11]]
// ➔ 23
["Sum", ["List", 5, "x", 11]]
// ➔ ["List", 16, "x"]
```

[&quot;**Sum**&quot;, _body_, _iterator_]{.signature}

Evaluate `_body_` and make a sum of the result.

Equivalent to `["Fold", ["Add", _1, [_body_, _2]], _iterator_]`.

{% enddef %} 

{% enddefs %}


## Break and Continue

**To control the flow of a loop expression**, use `["Break"]` and `["Continue"]`.


{% defs "Function" "Operation" %} 

{% def "Break" %}

[&quot;**Break**&quot; ]{.signature}

[&quot;**Break**&quot;, _expr_]{.signature}


When in a block, exit the block immediately. The value of the `["Block"]` 
expression is the `["Break"]` expression.

When  in a loop exit the loop immediately. The final value of the loop is 
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


