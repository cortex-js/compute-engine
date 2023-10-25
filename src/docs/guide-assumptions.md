---
title: Assumptions
permalink: /compute-engine/guides/assumptions/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
---

Assumptions are statements about symbols that are assumed to be true. For
example, the assumption that \\(x\\) is a positive real number is used to simplify
\\|x|\\) to \\(x\\).

When declaring a symbol, it is possible to specify its domain. For example, the
symbol \\(x\\) can be declared to be a real number:

```js
ce.declare("x", "RealNumbers");
```

However, assumptions can be used to describe more complex properties of symbols.
For example, the assumption that \\(x\\) is positive is used to simplify
\\(\\sqrt{x^2}\\) to \\(x\\).

```js
ce.assume(["Greater", "x", 2]);
```

Assumptions can also describe the relationship between two symbols, for example
that \\(x\\) is greater than \\(y\\):

```js
ce.assume(["Greater", "x", "y"]);
```

This knowledge base is used by the Compute Engine to simplify
expressions.

{% readmore "/compute-engine/guides/simplify/" %} Read more about
<strong>Simplifying Expressions</strong> {% endreadmore %}


In general, assumptions are not used when evaluating expressions.


<section id='defining-new-assumptions'>

## Defining New Assumptions

**To make an assumption about a symbol**, use the `ce.assume()` function.

For example, to indicate \\(\beta \in \R\\):

```js
ce.assume(ce.parse("\\beta \\in \\R"));

// or:

ce.assume(["Element", "Beta", "RealNumbers"]);
```

In this case, this would be equivalent to declaring a domain for the symbol
\\(\beta\\):

```js
ce.declare("Beta", "RealNumbers");
```

The head of the proposition can be one of the following:

<div class=symbols-table>

| Head                                                 |                                                                                                                     |
| :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `Element`<br>`NotElement`                            | Indicate the domain of a symbol                                                                                     |
| `Less`<br>`LessEqual`<br>`Greater`<br>`GreaterEqual` | Inequality. Both sides are assumed to be `RealNumbers`                                                               |
| `Equal`<br>`NotEqual`                                | Equality                                                                                                            |
| `And`<br>`Or`<br>`Not`                               | Boolean expression. Using `And` is equivalent to using multiple `assume()` for each term of the boolean expression. |

</div>

If the `assume()` function is invoked with two arguments, it is equivalent to
`ce.assume(["Element", <arg1>, <arg2>])`.

```js example
ce.assume(["Element", "x", "RealNumbers"); // same as ce.assume(["Element", "x", "RealNumbers"])
```

The argument to the `assume()` function is a **proposition**. That proposition
is analyzed and the fact it describes are recorded in the Compute Engine
assumptions knowledge base. Some propositions can be described in several
different but equivalent ways. You can use whichever form you prefer. Similarly,
when querying the knowledge base later, you can use any form you'd like.

```js example
ce.assume(["Element", "x", "PositiveNumbers"]);

// Equivalent to...
ce.assume(["Greater", "x", 0]);

// ... or ...
ce.assume(["Element", "x", ["Interval", ["Open", 0], "Infinity"]]);
```

<section id='multivariate-assumptions'>

### Multivariate Assumptions

Assumptions frequently describe the property of a symbol. However, it is
also possible to describe relationships betwen symbols.

```js
ce.assume(ce.parse('xy + 1 = 0'))'
```

</section>

<section id='default-assumptions'>

### Default Assumptions

When creating an instance of a Compute Engine, the following assumptions are
made:

<div class=symbols-table>

| Symbol                                               | Domain          |
| :--------------------------------------------------- | :-------------- |
| `a` `b` `c` `d`<br>`i` `j` `k`<br>`r` `t`<br>`x` `y` | `RealNumbers`    |
| `f` `g` `h`                                          | `Functions`      |
| `m` `n`<br>`p` `q`                                   | `Integers`       |
| `w` `z`                                              | `ComplexNumbers` |

</div>

This list of assumptions make it possible to immediately use common symbols such
as `x` or `y` without having to declare them explicitly.

**To specify a different list of assumptions**, use the `assumptions` option
when creating a Compute Engine instance:

```js
const ce = new ComputeEngine({
  assumptions: [
    ["Element", "x", "Integers"],
    ["Element", "y", "Integers"],
  ],
});
```

To have no assumptions at all, set the `assumptions` option to `null`:

```js
const ce = new ComputeEngine({ assumptions: null });
```

</section>

<section id='testing-assumptions'>

## Verifyinf Assumptions

**To test if a particular assumption is valid**, call the `ce.verify()` function.

```js
ce.verify(["Element", "x", "RealNumbers"]);
```


The function `ce.verify()` return `true` if the assumption is true, `false` if it is
not, and `undefined` if it cannot be determined.

While `ce.verify()` is appropriate to get boolean answers, more complex queries can
also be made.

**To query the assumptions knowledge base** call the `ce.ask()` function.

The argument of `ask()` can be a pattern, and it returns an array of matches as
`Substitution` objects.

```js
// "x is a positive integer"
ce.assume(["Element", "x", "PositiveIntegers"]);

// "What is x greater than?"
ce.ask(["Greater", "x", "_val"]);

//  -> [{"val": 0}] "It is greater than 0"
```

{% readmore "/compute-engine/guides/patterns-and-rules/" %} Read more about
<strong>Patterns and Rules</strong> {% endreadmore %}

</section>

<section id='forgetting-assumptions'>

## Forgetting Assumptions

Each call to `ce.assume()` is additive: the previous assumptions are preserved.

**To remove previous assumptions**, use `ce.forget()`.

- Calling `ce.forget()` with no arguments will remove all assumptions.
- Passing an array of symbol names will remove assumptions about each of the
  symbols.
- Passing a symbol name will only remove assumptions about that particular
  symbol.

```js
ce.assume(["Element", "\\alpha", "RealNumbers"]);
ce.is(["Element", "\\alpha", "RealNumbers"]);
// ➔  true

ce.forget("\\alpha");

ce.is(["Element", "\\alpha", "RealNumbers"]);
// ➔  undefined
```

</section>

<section id='scoped-assumptions'>

## Scoped Assumptions

When an assumption is made, it is applicable to the current scope and all
subsequent scopes. Scopes "inherit" assumptions from their parent scopes.

When exiting a scope, with `ce.popScope()`, all assumptions made in that scope
are forgotten.

**To temporarily define a series of assumptions**, create a new scope.

```js
ce.is(["Element", "\\alpha", "RealNumbers"]);
// ➔ undefined

ce.pushScope();

ce.assume(["Element", "\\alpha", "RealNumbers"]);
ce.is(["Element", "\\alpha", "RealNumbers"]);
// ➔  true

ce.popScope(); // all assumptions made in the current scope are forgotten

ce.is(["Element", "\\alpha", "RealNumbers"]);
// ➔  undefined
```

</section>
