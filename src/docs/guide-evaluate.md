---
title: Evaluation of Expressions
permalink: /compute-engine/guides/evaluate/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
render_math_in_document: true
preamble:
  '<h1>Evaluation</h1><p class="xl">To apply a sequence of definitions to an
  expression in order to simplify it, calculate its value or get a numerical
  approximation of its value, call the <kbd>expr.simplify()</kbd>,
  <kbd>expr.evaluate()</kbd> or <kbd>expr.N()</kbd> function.</p>'
---

## Scopes

The Compute Engine supports
[lexical scoping](<https://en.wikipedia.org/wiki/Scope_(computer_science)>).

A scope provides definitions of symbols and functions. Scopes are arranged in a
stack, with the current (top-most) scope available with `ce.context`.

To locate the definition of an identifier, the symbol table associated with the
current (top-most) scope is used first.

If no matching definition is found, the parent scope is searched, and so on
until a definition is found.

**To add a new scope to the context** use `ce.pushScope()`.

```ts
ce.pushScope({ x: 500 });
```

The `symbolTable` property of a scope contains definitions for symbols and
functions.

**To exit a scope** use `ce.popScope()`. This will invalidate any definition
associated with the scope, and restore the symbol table from previous scopes
that may have been shadowed by the current scope.

## Binding

**[Name Binding](https://en.wikipedia.org/wiki/Name_binding) is the process of
associating an identifier (the name of a function or symbol) with a
definition.**

Name Binding should not be confused with **value binding** with is the process
of associating a **value** to a symbol.

{% readmore "/compute-engine/guides/symbols/#scopes" %}Read more about
<strong>identifiers</strong> and value binding.{% endreadmore %}

For symbols, the definition records contain information such as the domain of
the symbol and its value. For functions, the definition record include the
signature of the function (the domain of the argument it expects), and how to
simplify or evaluate function expressions that have this function as their head.

Name binding is done during canonicalization. If name binding failed, the
`isValid` property of the expession is `false`.

**To get a list of the errors in an expression** use the `expr.errors` property.

{% readmore "/compute-engine/guides/expressions/#errors" %} Read more about the
<strong>errors</strong> {% endreadmore %}

## Evaluation Loop

This is an advanced topic. You don't need to know the details of how the
evaluation loop works, unless you're interested in extending the standard
library and providing your own function definitions.{notice--info}

Each identifier (name of symbol or function) is **bound** to a definition within
a **scope** during canonicalization. This usually happens when calling
`ce.box()` or `ce.parse()`, but could also happen during `expr.evaluate()` if
`expr` was not canonical.

When a function is evaluated, the following steps are followed:

1. If the expression is not canonical, it is put in canonical form

2. Each argument of the function are evaluated, left to right.

   1. An argument can be **held**, in which case it is not evaluated. Held
      arguments can be useful when you need to pass a symbolic expression to a
      function. If it wasn't held, the result of evaluating the expression would
      be used, not the symbolic expression.

      A function definition can indicate that one or more of its arguments
      should be held.

      Alternatively, using the `Hold` function will prevent its argument from
      being evaluated. Conversely, the `ReleaseHold` function will force an
      evaluation.

   2. If an argument is a `["Sequence"]` expression, treat each argument of the
      sequence expression as if it was an argument of the function. If the
      sequence is empty, ignore the argument.

3. If the function is associative, flatten its arguments as necessary. \\[
   f(f(a, b), c) \to f(a, b, c) \\]

4. Apply the function to the arguments

5. Return the canonical form of the result

The same evaluation loop is used for `expr.simplify()` and `expr.N()`.
