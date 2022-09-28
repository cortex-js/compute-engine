---
title: Evaluation of Expressions
permalink: /compute-engine/guides/evaluate/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
---

# Evaluation of Expressions

**To apply a sequence of definitions to an expression in order to simplify it,
calculate its value or get a numerical approximation of its value**, call the
`expr.simplify()`, `expr.evaluate()` or `expr.N()` function.

Each identifier (name of symbol or function) is **bound** to a definition within
a **scope**.

When a Boxed Expression is created with `ce.box()` or `ce.parse()`, its
identifiers are not bound immediately. The name binding occurs lazily the first
time it is required. This could be when a function such as `expr.evaluate()` is
invoked, or when a property such as `expr.domain` is accessed.

## Scopes

The Compute Engine supports
[lexical scoping](<https://en.wikipedia.org/wiki/Scope_(computer_science)>).

The **context** of the Compute Engine is a stack of scopes that provide the
current symbol and function definitions.

To locate the definition of a symbol or function, the symbol table associated
with the current (top-most) scope is used first.

If no matching definition is found, the parent scope is searched, and so on
until a definition is found.

**To add a new scope to the context** use `ce.pushScope()`.

```ts
ce.pushScope({
  symbolTable: {
    symbols: [{ name: 'd', value: 500 }],
  },
});
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
<strong>symbols</strong> and value binding.{% endreadmore %}

The symbol tables are initially set when an instance of a Compute Engine is
created. Additional symbol tables can be provided later using the
`ce.pushScope()` function.

For symbols, the definition records contain information such as the domain of
the symbol and its value. For functions, the definition record include the
signature of the function (the domain of the argument it expects), and how to
simplify or evaluate function expressions that have this function as their head.

Because name binding is done lazily, it is possible to have a boxed expression
which cannot be evaluate or processed.

For example, the boxed expression for `ce.box(["Divide", 2, 'True'])` cannot be
evaluated because a number cannot be divided by a boolean. More accurately,
evaluating this boxed expression will result in an `["Error"]` expression:
`["Divide", 2, ["Error", ["ErrorCode", "'incompatible-domain'", "Number", "Boolean"]], "True"]]`.

**To check if an expression can be evaluated** check that
`expr.canonical.isValid` is `true`.

{% readmore "/compute-engine/guides/expressions/#errors" %} Read more about the
<strong>errors</strong> {% endreadmore %}

## Evaluation Loop

When a function is evaluated, the following steps are followed:

1. If the expression is not canonical, put it in canonical form

2. Evaluate each argument of the function, left to right.

   1. An argument can be **held**, in which case it is not evaluated. Held
      arguments can be useful when you need to pass a symbolic expression to a
      function. If it wasn't held, the result of evaluating the expression would
      be used, not the symbolic expression.

      A function definition can indicate that one or more of its arguments
      should be held.

      Alternatively, using the `Hold` function will prevent its argument from
      being evaluated. Conversely, the `ReleaseHold` function will force an
      evaluation.

   2. If an argument is the `Nothing` symbol, remove it

   3. If an argument is a `["Sequence"]` expression, treat each argument of the
      sequence expression as if it was an argument of the function

3. If the function is associative, flatten its arguments as necessary. \\[
   f(f(a, b), c) \to f(a, b, c) \\]

4. Apply the function to the arguments

5. Return the canonical form of the result

The same evaluation loop is used for `expr.simplify()` and `expr.N()`.
