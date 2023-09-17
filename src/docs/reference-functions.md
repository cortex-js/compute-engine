---
title: Functions
permalink: /compute-engine/reference/functions/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

The standard library of the Compute Engine includes many built-in functions such
as `["Add"]`, `["Sin"]`, `["Power"]`, etc...

It is also possible to define your own functions.

## Declaring a Function

Let's say you want to parse the following expression:

```js example
const expr = ce.parse('f(2)');
console.log(expr.json);
// -> ["Multiply", "f", "2"]
```

🤔 Hmmm... That's probably not what you want. 


You probably want to get:

```json example
["f", 2]
```

Why is this happening? The Compute Engine doesn't know anything about `f`.
It just sees an identifier `f` and assume it's a symbol.

You can control how unknown identifiers are handled by setting the
`ce.latexOptions.parseUnknownIdentifier` property to a function that returns
`function` if the argument string is a function, `symbol` if it's a symbol or
`unknown` otherwise. For example, you set it up so that identifiers that start with an upper case letter are always assume to be functions, or any other convention you want. This only affects what happens when parsing LaTeX, though, and has no effect when using MathJSON expressions. {.notice--info}

To tell the Compute Engine that `f` is a function, you need to declare it.

**To declare a function**, use the `ce.let()` function.

```js example
ce.let("f", { signature: { domain: 'Function' } });
```

Note that you can use `ce.let()` to declare multiple functions (or symbols) at
once:

```js example
ce.let({
  f: { signature: { domain: 'Function' } },
  g: { signature: { domain: 'Function' } },
});
```

Now, when you parse the expression, you get the expected result:

```js example
const expr = ce.parse('f(2)');
console.log(expr.json);
// -> ["f", 2] 🎉
```

However, you still can't evaluate the expression, because the Compute Engine
doesn't know how to evaluate `f` yet, it just knows that `f` is a function.

```js example
console.log(ce.evaluate(expr).json);
// -> ["f", 2]
```

For the Compute Engine to evaluate `f`, you need to define provide a definition
for `f`.

## Defining a Function

**To define a function**, also use the `ce.let()` function.

```js example
ce.let("f", {
  signature: {
    domain: 'Function',
    evaluate: (ce, args) => ce.number(args[0].valueOf() * 2)
  }
});
```

This time we've added an `evaluate` handler to the definition of `f`. The
`evaluate` handler is called when the corresponding function is evaluated. 
It receives two arguments:

- `ce`: the Compute Engine instance
- `args`: an array of the arguments that have been applied to the function. Each argument is a `MathJSON` expression. The array may be empty if there are no
arguments.

Note there are other attributes you can set on a function definition,  See
`FunctionDefinition` for more details.

If you evaluate the expression now, you get the expected result:

```js example
console.log(ce.evaluate(expr).json);
// -> 4
```

**To change the definition of a function**, use `ce.set()`.

```js example
ce.set("f", (ce, args) => ce.number(args[0].valueOf() * 5)};
```

When using `ce.set()`, you can only change the implementation of a function. If
the identifier `f` was previously declared as a `Number` you cannot change its
type to a `Function`. {.notice--info}

The `ce.let()` and `ce.set()` functions will call the more primitive
`ce.defineFunction()` and `ce.defineSymbol()` functions depending on the value
of their arguments.

You can also evaluate an `["Assign"]` expression to define a function.

```js example
ce.evaluate(["Assign", "f", ["Function", ["Multiply", "x", 2], "x"]]);
```

The value of a function can be either a JavaScript function, as in the examples
above, or a `MathJSON` expression from LaTex:

```js example
ce.let("f(x)", ce.parse("2x"));
```

Or directly as a `MathJSON` expression:

```js example
ce.let("f(x)", ["Multiply", "x", 2]);
```

This is equivalent to the more verbose:

```js example
ce.let("f", ["Function", ["Multiply', "x", 2], "x"]);
```

You can also use anonymous parameters as a shorcut:

```js example
ce.let("f", ["Multiply", "_", 2]);
```

## Anonymous Functions and Anonymous Parameters

A function that is not bound to an identifier is called an **anonymous
function**. 

Anonymous functions are frequently used as arguments to other functions.

In the example below, the `["Function"]` expression is an anonymous function
that is passed as an argument to the `["Sum"]` function.

```json example
["Sum", ["Function", ["Multiply", "x", 2], "x"]]
```

The parameters of a function can also be anonymous. In this case, the arguments
are bound to the wildcards `_`, `_1`, `_2`, etc... in the body of the function.
The wildcard `_` is a shorthand for `_1`, the first parameter.

In the example below, both the function and its parameters are anonymous.

```json example
["Sum", ["Multiply", "_", 2]]
```

## Evaluating an Anonymous Function

To apply a function to some arguments, use an `["Apply"]` expression.

```json example
["Apply", ["Add", 2, "_"], 4]
// ➔ 6
["Apply", "Power", 2, 3]
// ➔ 8
```

## Operating on Functions

{% defs "Function" "Description" %}

{% def "Function" %}

[&quot;**Function**&quot;, _body_]{.signature}

[&quot;**Function**&quot;, _body_, _arg-1_, _arg-2_, ...]{.signature}

Create an
[anonymous function](https://en.wikipedia.org/wiki/Anonymous_function), also
called **lambda expression**.

The `arg-n` arguments are identifiers of the bound variables (parameters) of the
anonymous function.

All the arguments have the `Hold` attribute set, so they are not evaluated when
the function is created.{.notice--info}

The _body_ is a `MathJSON` expression that is evaluated when the function is
applied to some arguments.

**To apply some arguments to a function expression**, use `["Apply"]`.

{% latex " x \\mapsto 2x" %}

```json example
["Function", ["Multiply", "x", 2], "x"]
```

{% latex " (x, y) \\mapsto 2x + y" %}

```json example
["Function", ["Add", ["Multiply", "x", 2], "y"], "x", "y"]
```

{% enddef %}


{% def "Assign" %}

[&quot;**Assign**&quot;, _id_, _fn_]{.signature}

Assign the anonymous function _fn_ to the identifier _id_.

The identifier _id_ should either not have been declared yet, or been 
declared as a function. If _id_ is already defined as a `Number` for example,
it is an error to assign a function to it.

{% latex "\\operatorname{double} = x \\mapsto 2x" %}

```json example
["Assign", "double", ["Function", ["Multiply", "x", 2], "x"]]
```


{% enddef %}


{% def "Apply" %}

[&quot;**Apply**&quot;, _function_, _expr-1_, ..._expr-n_]{.signature}

[Apply](https://en.wikipedia.org/wiki/Apply) a list of arguments to a function.
The _function_ is either an identifier of a function, or a `["Function"]`
expression.

The following wildcards in _body_ are replaced as indicated

- `_` or `_1` : the first argument
- `_2` : the second argument
- `_3` : the third argument, etc...
- `__`: the sequence of arguments, so `["Length", "__"]` is the number of
  arguments

If _body_ is a `["Function"]` expression, the named arguments of `["Function"]`
are replaced by the wildcards.

```json example
["Apply", ["Multiply", "_", "_"], 3]
// ➔ 9
["Apply", ["Function", ["Multiply", "x", "x"], "x"], 3]
// ➔ 9
```

{% enddef %}

{% def "Return" %}

[&quot;**Return**&quot;, _value_]{.signature}

If in a `["Function"]` expression, interupts the evaluation of the function. The
value of the `["Function"]` expression is _value_

The `["Return"]` expression is useful when used with more complex functions that
have multiple exit points, conditional logic, loops, etc...

{% enddef %}

{% enddefs %}
