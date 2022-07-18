---
title: Evaluation of Expressions
permalink: /compute-engine/guides/evaluate/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Evaluation of Expressions

**To apply a sequence of definitions to an expression in order to reduce,
simplify and calculate its value**, call the `expr.evaluate()` function.


## Evaluation Loop

When a function is evaluated, the following steps are followed:

1. If the expression is not canonical, put it in canonical form

2. Evaluate each argument of the function, left to right.

   An argument can be **held**, in which case it is not evaluated.
   Held arguments can be useful when you need to pass a symbolic expression to
   a function. If it wasn't held, the result of evaluating the expression would
   be used, not the symbolic expression.

   A function definition can indicate that one or more of its arguments should
   be held.

   Alternatively, using the `Hold` function  will prevent its argument from
   being evaluated. Conversely, the `ReleaseHold` function will force
   an evaluation.

3. If any argument is the `Nothing` symbol, remove it.

4. If the function is associative, flatten its arguments as necessary.
   \\[ f(f(a), b, f( c )) \to f(a, b, c) \\]

5. Apply the function to the arguments

6. Return the canonical form of the result


The same evaluation loop is used for `expr.simplify()` and `expr.N()`.