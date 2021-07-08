---
title: Simplify
permalink: /compute-engine/guides/simplify/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Simplify

A complicated mathematical expression can often be transformed into a form
that is easier to understand.

The `ce.simplify()` function tries expanding, factoring and applying many 
other transformations to find a simple a simpler form of a symbolic expression.

## Defining "Simplest"

In some cases there might be multiple equivalent forms for an expression. 
Deciding which is "the simplest" might depend on how the complexity is measured.

For example: \\( (x + 4)(x-5) \\) and \\(x^2 -x -20\\) represent the same expression.

By default, the complexity of an expression is measured by counting the number
of operations in the expression, and giving an increasing cost to:
- integers with fewer digits
- integers with more digits
- other numeric values
- add, multiply, divide
- subtract and negate
- square root and root
- exp
- power and log
- trigonometric function
- inverse trigonometric function
- hyperbolic functions
- inverse hyperbolic functions
- other functions

**To influence how the complexity of an expression is measured**, specify a 
cost function in the compute engine.



## Numeric Simplifications

The `ce.simplify()` function will apply some numeric simplifications, such 
as combining small integer and rational values, simplifying division by 1,
addition or subtraction of 0, etc...

It avoids making any simplification that could result in a loss of precision.
For example, \\( 10^{300} + 1\\) cannot be simplified without losing the
least significant digit, so `ce.simplify()` will return the experssion unmodified.


## Using Assumptions

Assumptions are additional information available about some symbols, for example
\\( x > 0 \\) or \\(n \in \N\\). 

Some transformations are only applicable if some assumptions can be verified.

For example, if no assumptions about \\(x \\) is available the expression 
\\( \sqrt{x^2} \\) cannot be simplified. However, if an assumption that 
\\( x \geq 0 \\) is available, then the expression can be simplified to 
\\( x \\).


{% readmore "/compute-engine/guides/assumptions/" %}
Read more about <strong>Assumptions</strong>
{% endreadmore %}
