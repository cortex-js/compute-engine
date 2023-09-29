---
title: Adding New Definitions
permalink: /compute-engine/guides/augmenting/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
---

The [MathJSON Standard Library](/compute-engine/guides/standard-library/) is a
collection of definitions for **symbols** and **functions** such as `Pi`, `Add`,
`Sin`, `Power`, `List`, etc...

In this guide we discuss how to augment the MathJSON Standard Library with your
own definitions.

{% readmore "/compute-engine/guides/latex-syntax/#customizing-the-latex-dictionary" %}
You may also be interested in **augmenting the LaTeX dictionary** which defines
how LaTeX is parsed from and serialized to MathJSON. This is useful if you want
to add support for new LaTeX commands, or if you've defined custom LaTeX macros
that you'd like to parse to MathJSON. {% endreadmore %}

## Introduction

### Declaring an Identifier

Before it can be used, an identifier must be **declared** as a symbol or a
function.

Declaring it indicates to the Compute Engine the "kind" of object it is (a
string, a real number, a function...), and allows it to be used in expressions.
The "kind" of an object is called its **domain**.

{% readmore "/compute-engine/guides/domains" %} Learn more about **domains**.
{% endreadmore %}

**To declare an identifier** use the `ce.declare()` method:

```js
ce.declare("m_e", {
  domain: "RealNumber",
  constant: true,
  value: 9.1e-31,
});
```

After an identifier has been declared, its domain cannot be changed: other
expressions may depend on it, and changing its domain would invalidate them.

You can also declare an identifier without providing a value:

```js
ce.declare("f", "Functions");

// Shortcut for:
ce.declare("f", { signature: { domain: "Functions" } });
```

By default, when a new identifier is encountered in an expression, it is
declared automatically with a domain of `ce.defaultDomain` and no value. To
prevent this behavior, set `ce.defaultDomain` to `null`. An error will be
produced instead when an unknown identifier is encountered.

{% readmore "/compute-engine/guides/evaluate/#default-domain" %} Read more about
the **default domain**. {% endreadmore %}

We will discuss in more details below how to declare and define symbols and
functions.

### Declarations are Scoped

The declaration of an identifier is done within a **scope**. A scope is a
hierarchical collection of definitions.

`ce.declare()` will add a definition in the current scope.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}

## Defining a Symbol

A symbol is a named value, such as `Pi` or `x`.

{% readmore "/compute-engine/guides/symbols" %} Learn more about **symbols**.
{% endreadmore %}

**To declare a new symbol** use the `ce.declare()` method.

```js
ce.declare("m", { domain: "Numbers", value: 5 });
ce.declare("n", { domain: "Integers" });
```

The `domain` property is optional when a value is provided: a compatible domain
is inferred from the value.

See the `SymbolDefinition` type for more details on the properties associated
with a symbol.

As a shortcut, if the symbol was not previously defined, a new definition will
be created. The domain of the symbol will be set to inferred from the value.

### Assigning a Value

Once declared an identifier can be used in expressions, and it can be assigned a
value.

**To change the value of a symbol**, use the `value` property of the symbol or
the `ce.assign()` method.

```js
const n = ce.box("n");
n.value = 5;
console.log(`${n.latex} = ${n.value.json}`);
// ➔ n = 5

ce.assign("n", 18);
// ➔ n = 18
```

You can also evaluate a MathJSON expression that contains an `["Assign"]`
expression:

```js
ce.box(["Assign", "n", 42]).evaluate();
// ➔ n = 42
```

or parse a LaTeX expression that contains an assignment:

```js
ce.parse("n := 31").evaluate();
// ➔ n = 31
```

In LaTeX, assignments are indicated by the `:=` or `\coloneqq` operator (note
the two `qq`s). The `=` operator is used for equality.

The right hand side argument of an assignment (with a `ce.assign()`,
`expr.value` or `["Assign"]` expression) can be one of the following:

- a JavaScript boolean: interpreted as `True` or `False`
- a JavaScript number
- a tuple of two numbers, for a rational
- a `bignum`, for a large number
- a `complex`, for a complex number
- a JavaScript string: interpreted as string, unless it starts and ends with a
  `$` in which case it is interpreted as a LaTeX expression that defines a
  function.
- a MathJSON expression, which defines a function
- a JavaScript function, which also defines a functon

```js example
ce.assign("b", true);
ce.assign("n", 5);
ce.assign("q", [1, 2]);
ce.assign(
  "d",
  ce.bignum("123456789012345678901234567890.123456789012345678901234567890e512")
);
ce.assign("z", ce.complex(1, 2));
ce.assign("s", "Hello");

// Functions
ce.assign("f", "$$ 2x + 3 $$");
ce.assign("double", ["Function", ["Multiply", "x", 2], "x"]);
ce.assign("halve", (ce, args) => ce.number(args[0].valueOf() / 2));
```

Note that when assigning an expression to a symbol, the expression is not
evaluated. It is used to define a function

## Declaring a Function

A function is a named operation, such as `Add`, `Sin` or `f`.

{% readmore "/compute-engine/guides/functions" %} Learn more about
**functions**. {% endreadmore %}

Let's say you want to parse the following expression:

```js example
const expr = ce.parse("\\operatorname{double}(3)");
console.log(expr.json);
// ➔ ["Multiply", "double", "3"]
```

🤔 Hmmm... That's probably not what you want.

You probably want to get `["double", 3]` instead.

The problem is that the Compute Engine doesn't know what `double` is, so it
assumes it's a symbol.

You can control how unknown identifiers are handled by setting the
`ce.latexOptions.parseUnknownIdentifier` property to a function that returns
`function` if the parameter string is a function, `symbol` if it's a symbol or
`unknown` otherwise. For example, you set it up so that identifiers that start
with an upper case letter are always assume to be functions, or any other
convention you want. This only affects what happens when parsing LaTeX, though,
and has no effect when using MathJSON expressions. {.notice--info}

To tell the Compute Engine that `double` is a function, you need to declare it.

**To declare a function**, use the `ce.declare()` function.

`ce.declare()` can be used to declare symbols or functions depending on its
second parameter.

```js example
ce.declare("double", { signature: { domain: "Functions" } });
```

If the definition (the second parameter of `ce.declare()`) includes a
`signature` property, a function is being declared.

The `signature` property defines how the function can be used. It is a
`FunctionDefinition` object with the following properties (all are optional):

- `domain`: the domain of the function. The `Functions` domain represents any
  function. "NumericFunctions" represents a function whose parameters are number
  and that returns a numeric value. More complex domains can be specified to
  described the domain of the parameters of the function and the domain of its
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
const expr = ce.parse("\\operatorname{double}(3)");
console.log(expr.json);
// ➔ ["double", 2] 🎉
```

### Defining a Function

However, you still can't evaluate the expression, because the Compute Engine
knows that `double` is a function but it doesn't know how to evaluate it yet.

```js example
console.log(ce.evaluate(expr).json);
// ➔ ["double", 3]
```

For the Compute Engine to evaluate `double`, you need to provide a definition
for it. You can do this by adding a `evaluate` handler to the definition of
`double`:

```js example
ce.declare("double", {
  signature: {
    domain: "Functions",
    evaluate: (ce, args) => ce.number(args[0].valueOf() * 2),
  },
});
```

The `evaluate` handler is called when the corresponding function is evaluated.

It has two parameters:

- `ce`: the Compute Engine instance
- `args`: an array of the arguments that have been applied to the function. Each
  argument is a `MathJSON` expression. The array may be empty if there are no
  arguments.

If you evaluate the expression now, you get the expected result:

```js example
console.log(ce.evaluate(expr).json);
// ➔ 6 🎉
```

### Changing the Definition of a Function

**To change the definition of a function**, use `ce.assign()`.

If `"f"` was previously declared as something other than a function, a runtime
error will be thrown. The domain of a symbol cannot be changed after its
declaration.{.notice--info}

As a shortcut, if you assign a value to an identifier that was not previously
declared, a new function definition is created, if the value is a function.

Using `ce.assign()` gives you more flexibility than `ce.declare()`: the "value"
of the function can be a JavaScript function, a MathJSON expression or a LaTeX
expression.

```js example
ce.assign("f", (ce, args) => ce.number(args[0].valueOf() * 5)};
```

The value can also be a MathJSON expression:

```js example
ce.assign("f(x)", ["Multiply", "x", 5]);
```

Note in this case we added `(x)` to the first parameter of `ce.assign()` to
indicate that `f` is a function. This is equivalent to the more verbose:

```js example
ce.assign("f", ["Function", ["Multiply", "x", 5], "x"]);
```

The value can be a LaTeX expression:

```js example
ce.assign("f(x)", "$$ 5x $$"));
```

You can also use `ce.parse()` but you have to watch out and make sure you parse
a non-canonical expression, otherwise any unknowns (such as `x`) will be
automatically declared, instead of being interpreted as a parameter of the
function.

```js example
ce.assign("f(x)", ce.parse("5x", { canonical: false }));
```

You can also use a more explicit LaTeX syntax:

```js example
ce.assign("f", ce.parse("(x) \\mapsto 5x"));
```

The arguments on the left hand side of the `\\mapsto` operator are the
parameters of the function. The right hand side is the body of the function. The
parenthesis around the parameters is optional if there is only one parameter. If
there are multiple parameters, they must be enclosed in parenthesis and
separatated by commas. If there are _no_ parameters (rare, but possible), the
parenthesis are still required to indicate the parameter list is empty.

When using `\\mapsto` you don't have to worry about the canonical flag, because
the expression indicates what the parameters are, and so they are not intepreted
as unknowns in the body of the function.

Evaluating an `["Assign"]` expression is equivalent to calling `ce.assign()`:

```js example
ce.box(["Assign", "f", ["Function", ["Multiply", "x", 2], "x"]]).evaluate();
```

You can also evaluate a LaTeX assignment expression:

```js example
ce.parse("\\operatorname{double} := x \\mapsto 2x").evaluate();
```

## Acting on Multiple Functions and Symbols

**To declare multiple functions and symbols**, use the `ce.declare()` method
with a dictionary of definitions.

**Note:** The keys to `ce.declare()` (`m`, `f`, etc...) are MathJSON
identifiers, not LaTeX commands. For example, if you have a symbol `α`, use
`alpha`, not `\alpha` {.notice--info}

```js
ce.declare({
  m: { domain: "Number", value: 5 },
  f: { domain: "Functions" },
  g: { domain: "Functions" },
  Smallfrac: {
    signature: {
      domain: "NumericFunctions",
      evaluate: (ce, args) => ce.box(args[0].valueOf() / args[1].valueOf()),
    },
  },
});
```

**To assign multiple functions and symbols**, use the `ce.assign()` method with
a dictionary of values.

```js
ce.assign({
  "m": 10,
  "f(x)": ce.parse("2x^2 + 3x + 5"),
  "g(t)": ce.parse("t^3 + 4t + 1"),
});
```

## Summary

Before a function can be used in an expression, it must be declared. This is
done by adding a definition to the MathJSON library.

The quickest way to declare and define a function is to use `ce.assign()`:

```js example
// With LaTeX
ce.assign("f(x)", "$$ 5x $$");

// With MathJSON
ce.assign("g", ["Function", ["Multiply", "x", 2], "x"]);
```
