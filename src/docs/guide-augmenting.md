---
title: Adding New Definitions
permalink: /compute-engine/guides/augmenting/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
---

The MathJSON library is a collection of definitions for **symbols** and
**functions** that are used by the Compute Engine, such as `Pi`, `Add`, `Sin`,
`Power`, etc...

In this guide we discuss how to augment the MathJSON library with your own
definitions.

{% readmore "/compute-engine/guides/standard-library/" %} The **standard library
reference** describes the content of the Compute Engine standard library.
{% endreadmore %}

{% readmore "/compute-engine/guides/latex-syntax/#customizing-the-latex-dictionary" %}
You may also be interested in **augmenting the LaTeX dictionary** which defines
how LaTeX is parsed from and serialized to MathJSON. This is useful if you want
to add support for new LaTeX commands, or if you've defined custom LaTeX macros
that you'd like to parse to MathJSON. {% endreadmore %}

## Introduction

Before it can be used, an identifier must be **declared** as a symbol or a
function. This is done by adding a definition to the MathJSON library.

Once declared a symbol or function can be used in expressions, and it can be
assigned a value.

To change the value of a symbol, use the `value` property of the symbol.

```js
const n = ce.box('n');
n.value = 5;
console.log(`${n.latex} = ${n.value.json}`);
// ➔ n = 5
```

Alternatively, you can use `ce.assign()`.

```js
ce.assign(n, 5);
```

The declaration of a symbol or function is done within a **scope**. A scope is a
collection of definitions.

After a symbol or function is declared, its domain cannot be changed: other
expressions may depend on it, and changing its domain would invalidate them.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about

## Declaring a Symbol

A symbol is a named value, such as `Pi` or `x`.

{% readmore "/compute-engine/guides/symbols" %} Learn more about **symbols**.
{% endreadmore %}

Before it can be used, a symbol must be declared. This is done by adding a
definition to the MathJSON library.

**To declare a new symbol** use the `ce.declare()` method.

```js
ce.declare('m', { domain: 'Number', value: 5 });
ce.declare('n', { domain: 'Integer' });
```

`ce.declare()` will add a definition in the current scope. Use `ce.pushScope()`
if you want to create a new scope.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}

The `domain` property is optional when a value is provided.

See the `SymbolDefinition` type for more details on the properties associated
with a symbol.

You can change the value of one or more symbols using `ce.assign()`.

```js
ce.assign('m', 10);
```

As a shortcut, if the symbol was not previously defined, a new definition will
be created. The domain of the symbol will be set to inferred from the value.

You can also change the value of a symbol with
`ce.box('m').value = 10`.{.--notice-info}

## Declaring a Function

A function is a named operation, such as `Add`, `Sin` or `f`.

{% readmore "/compute-engine/guides/functions" %} Learn more about
**functions**. {% endreadmore %}

Let's say you want to parse the following expression:

```js example
const expr = ce.parse('\\operatorname{double}(3)');
console.log(expr.json);
// -> ["Multiply", "double", "3"]
```

🤔 Hmmm... That's probably not what you want.

You probably want to get `["double", 3]` instead. The problem is that the
Compute Engine doesn't know what `double` is, so it assumes it's a symbol.

You can control how unknown identifiers are handled by setting the
`ce.latexOptions.parseUnknownIdentifier` property to a function that returns
`function` if the argument string is a function, `symbol` if it's a symbol or
`unknown` otherwise. For example, you set it up so that identifiers that start
with an upper case letter are always assume to be functions, or any other
convention you want. This only affects what happens when parsing LaTeX, though,
and has no effect when using MathJSON expressions. {.notice--info}

To tell the Compute Engine that `double` is a function, you need to declare it.

**To declare a function**, use the `ce.declare()` function.

```js example
ce.declare('double', { signature: { domain: 'Function' } });
```

The `signature` property defines how the function can be used. It is a
`FunctionDefinition` object with the following properties (all are optional):

- `domain`: the domain of the function. The `Function` domain represents any
  function. 'NumericFunction' represents a function whose arguments are number
  and that returns a numeric value. More complex domains can be specified to
  described the domain of the arguments of the function and the domain of its
  return v
- `canonical(ce, args)` returns a canonical representation of the function. This
  is an opportunity to check that the arguments are valid, and to return a
  canonical representation of the function.
- `simplify(ce, args)` returns a simplified representation of the function. This
  is an opportunity to simplify the function, for example if the arguments are
  known to be numeric and exact.
- `evaluate(ce, args)` returns a symbolic evaluation of the function. The
  arguments may be evaluated symbolically.
- `N(ce, args)` returns a numeric evaluation of the function.

See `FunctionDefinition` for more details on these properties and others
associated with a function definition.

Now, when you parse the expression, you get the expected result:

```js example
const expr = ce.parse('\\operatorname{double}(3)');
console.log(expr.json);
// -> ["double", 2] 🎉
```

### Defining a Function

However, you still can't evaluate the expression, because the Compute Engine
doesn't know how to evaluate `double` yet, it just knows that `double` is a
function.

```js example
console.log(ce.evaluate(expr).json);
// -> ["double", 3]
```

For the Compute Engine to evaluate `double`, you need to define provide a
definition for it.

```js example
ce.declare('double', {
  signature: {
    domain: 'Function',
    evaluate: (ce, args) => ce.number(args[0].valueOf() * 2),
  },
});
```

By adding an `evaluate` handler to the definition of `double`, you've told the
Compute Engine how to evaluate it. The `evaluate` handler is called when the
corresponding function is evaluated. It receives two arguments:

- `ce`: the Compute Engine instance
- `args`: an array of the arguments that have been applied to the function. Each
  argument is a `MathJSON` expression. The array may be empty if there are no
  arguments.

If you evaluate the expression now, you get the expected result:

```js example
console.log(ce.evaluate(expr).json);
// -> 6 🎉
```

### Changing the Definition of a Function

**To change the definition of a function**, use `ce.assign()`.

```js example
ce.assign("f", (ce, args) => ce.number(args[0].valueOf() * 5)};
```

When using `ce.assign()`, you can only change the implementation of a function.
If the identifier `f` was previously declared as a `Number` you cannot change
its domain to a `Function`. {.notice--info}

As a shortcut, if you assign a value to an identifier that was not previously
declared, a new function definition will be created.

```js example
ce.assign("g", (ce, args) => ce.number(args[0].valueOf() * 5)};
```

You can provide the value of a function as a `MathJSON` expression from LaTeX:

```js example
ce.assign('f(x)', ['Multiply', 'x', 5]);
```

Note in this case we added `(x)` to the first argument of `ce.assign()` to
indicate that `f` is a function. This is equivalent to the more verbose:

```js example
ce.assign('f', ['Function', ['Multiply', 'x', 5], 'x']);
```

You can also use a definition from a LaTeX expression:

```js example
ce.assign('f(x)', ce.parse('5x'));
```

You can also evaluate an `["Assign"]` expression to define a function.

```js example
ce.evaluate(['Assign', 'f', ['Function', ['Multiply', 'x', 2], 'x']]);
```

### Summary

Before a function can be used in an expression, it must be declared. This is
done by adding a definition to the MathJSON library.

The quickest way to declare and define a function is to use `ce.assign()`:

```js example
ce.assign('f(x)', ce.parse('5x'));
```

## Declaring Multiple Functions and Symbols

**To define multiple functions and symbols**, use the `ce.declare()` method.

**Note:** The keys to `ce.declare()` (`m`, `f`, etc...) are MathJSOn
identifiers, not LaTeX commands. For example, if you have a symbol `α`, use
`alpha`, not `\alpha` {.notice--info}

is the name of the function as a MathJSON identifier. It is not the name of a
LaTeX command.{.notice--info}

```js
ce.declare({
  m: { domain: 'Number', value: 5 },
  f: { domain: 'Function' },
  g: { domain: 'Function' },
  Smallfrac: {
    signature: {
      domain: 'NumericFunction',
      evaluate: (ce, args) => ce.box(args[0].valueOf() / args[1].valueOf()),
    },
  },
});
```
