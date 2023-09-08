---
title: Adding New Definitions
permalink: /compute-engine/guides/augmenting/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
---


{% readmore "/compute-engine/guides/latex-syntax/#customizing-the-latex-dictionary" %} In this guide we are discussing how to enhance the MathJSON dictionary used by the Compute Engine. You may also be interested in **augmenting the LaTeX dictionary**, for example if you've defined custom LaTeX macros that you'd like to parse to MathJSON. {% endreadmore %}

## Defining a Symbol

**To define a new symbol** use the `ce.defineSymbol()` method.

```js
ce.defineSymbol('m', {domain: 'Number', value: 5});
ce.defineSymbol('n', {domain: 'Integer'});
ce.defineSymbol('f', {domain: 'Function'});
ce.defineSymbol('g', {domain: 'Function'});
```

`defineSymbol()` will add a definition in the current scope. Use `ce.pushScope()` if you want to create a new scope.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}


The `domain` property is optional when a value is provided.

See the `SymbolDefinition` type for more details on the properties associated with a symbol.

You can change the value of one or more symbols using `ce.set()`.

```js
ce.set({m: 10});
```

If the symbol was not previously defined, a new definition will be created.

You can also change the value of a symbol with
`ce.box('m').value = 10`.{.--notice-info}

To remove a symbol definition, use `ce.forget()`.

```js
ce.forget('m');
console.log(ce.box('m').value); // -> undefined

```

## Defining a Function

Let's say you want to define a new `Smallfrac` function for use with 
the Compute Engine.

You can define new functions using `ce.defineFunction()`.


```js
ce.defineFunction('Smallfrac', {
  signature: {
    domain: 'NumericFunction',
    evaluate: (ce, args) => ce.box(ce.div(args[0].evaluate(), args[1].evaluate())),
    N: (ce, args) => ce.box(args[0].N() / args[1].N()),
  },
});
```

**Note:** The first argument to `defineFunction()`, `Smallfrac`, is the name of the function as a MathJSON identifier. It is not the name of a LaTeX command.{.notice--info}

`defineFunction()` will add a definition in the current scope. Use `ce.pushScope()` if you want to create a new scope.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}


The `signature` property defines how the function can be used. It is an object with the following properties (all are optional):
- `canonical(ce, args)` returns a canonical representation of the function. This is an opportunity to check that the arguments are valid, and to return a canonical representation of the function.
- `simplify(ce, args)` returns a simplified representation of the function. This is an opportunity to simplify the function, for example if the arguments are known to be numeric and exact.
- `evaluate(ce, args)` returns a symbolic evaluation of the function. The arguments may be evaluated symbolically.
- `N(ce, args)` returns a numeric evaluation of the function. 

See `FunctionDefinition` for more details on these properties and others associated with a function definition.

```js
console.log(ce.box(["Smallfra", 1, 2]).N());
// -> 0.5
```

## Defining Multiple Functions and Symbols

You can define multiple functions and symbols at once using `ce.let()`.

```js
ce.let({
  m: {domain: 'Number', value: 5},
  f: {domain: 'Function'},
  g: {domain: 'Function'},
  Smallfrac: {
    signature: {
      domain: 'NumericFunction',
      evaluate: (ce, args) => ce.box(args[0].N() / args[1].N()),
    },
  },
});
```

