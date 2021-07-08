---
title: Assumptions
permalink: /compute-engine/guides/assumptions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Assumptions

The Cortex Compute Engine has a robust system to specify properties and
relationships between symbols.

These assumptions are used to select algorithms, to validate some 
simplifications and to optimize computations.

<section id='defining-new-assumptions'>

## Defining New Assumptions

**To make an assumption about a symbol**, use the `ce.assume()` function.

For example, to indicate \\(\\beta \in \R\\):

```js
ce.assume(parse('\\beta \\in \\R'));

// or:

ce.assume(["Element", "Beta", "RealNumber"]);
```
The head of the proposition can be one of the following:

<div class=symbols-table>

| Head                 |      |
| :--------------------- | :--- |
| `Element`<br>`NotElement` | Indicate the domain of a symbol |
| `Less`<br>`LessEqual`<br>`Greater`<br>`GreaterEqual` | Inequality. Both sides are assumed to be `RealNumber` |
| `Equal`<br>`NotEqual` | Equality |
| `And`<br>`Or`<br>`Not` | Boolean expression. Using `And` is equivalent to using multiple `assume()` for each term of the boolean expression. |
</div>


If the `assume()` function is invoked with two arguments, it is
equivalent to `ce.assume(["Element", <arg1>, <arg2>])`.

```js
ce.assume("x", "RealNumber"); // same as ce.assume(["Element", "x", "RealNumber"])
```


The argument to the `assume()` function is a **proposition**. That proposition
is analyzed and the fact it describes are recorded in the Compute Engine 
assumptions knowledge base. Some propositions can be described in several 
different but equivalent ways. You can use whichever form you prefer. Similarly,
when querying the knowledge base later, you can use any form you'd like.

```js
ce.assume("x", "PositiveNumber")
// Equivalent to...
ce.assume(["Greater", "x", 0]);
// ... or ...
ce.assume(["Element", "x", ["Interval", ["Open", 0], "Infinity"]]);
```
<section id='multivariate-assumptions'>

### Multivariate Assumptions

Assumptions are frequently describing the property of a symbol. However, it
is also possible to describe relationships betwen multiple symbols.

```js
ce.assume(parse('xy + 1 = 0'))'
```
</section>

<section id='using-assumptions-to-declare-symbols'>

### Using Assumptions to Declare Symbols

Before a symbol can be used in an expression, the symbol must be known by the 
Compute Engine. A dictionary definition of a symbol can be used for this 
purpose, but an assumption that defines a domain for the symbol is sufficient.

</section>

<section id='default-assumptions'>

### Default Assumptions

When creating an instance of a Compute Engine, the following assumptions 
are made:

<div class=symbols-table>

| Symbol                 | Domain     |
| :--------------------- | :--- |
| `a` `b` `c` `d`<br>`i` `j` `k`<br>`r` `t`<br>`x` `y` | `RealNumber` |
| `f` `g` `h` | `Function` |
| `m` `n`<br>`p` `q` | `Integer` |
| `w` `z` | `ComplexNumber` |

</div>

This list of assumptions make it possible to immediately use common symbols
such as `x` or `y` without having to declare them explicitly.

**To specify a different list of assumptions**, use the `assumptions` option
when creating a Compute Engine instance:

```js
const ce = new ComputeEngine({ 
  assumptions: [['Element', 'x', 'Integer'], ['Element', 'y', 'Integer']]
});
```

To have no assumptions at all, set the `assumptions` option to `null`:
```js
const ce = new ComputeEngine({assumptions: null});
```
</section>
</section>

<section id='testing-assumptions'>

## Testing Assumptions

**To test if a particular assumption is valid**, use the `ce.is()` function.

```js
ce.is(['Element', 'x', 'RealNumber']);
```


As a shorthand, you can pass a symbol as a first argument and a domain as a 
second.

```js
ce.is('x', 'RealNumber');   // same as ce.is(['Element', 'x', 'RealNumber])
ce.is('x', ['Range', 1, 5]);
```


The function `ce.is()` return `true` if the assumption is true, `false` if it is
not, and `undefined` if it cannot be determined.

While `ce.is()` is appropriate to get boolean answers, more complex queries
can also be made.

**To query the assumptions knowledge base** use the `ce.ask()` function.

The argument of `ask()` can be a pattern, and it returns an array of matches
as `Substitution` objects.

```js

// "x is a positive integer"
ce.assume('x', 'PositiveInteger');

// "What is x greater than?"
ce.ask(['Greater', 'x', '_val'])

//  -> [{'val': 0}] "It is greater than 0"
```

{% readmore "/compute-engine/guides/patterns-and-rules/" %}
Read more about <strong>Patterns and Rules</strong>
{% endreadmore %}

</section>

<section id='forgetting-assumptions'>

## Forgetting Assumptions

Each call to `ce.assume()` is additive: the previous assumptions are preserved.

**To remove previous assumptions**, use `ce.forget()`. 

- Calling `ce.forget()` with no arguments will remove all assumptions. 
- Passing an array of symbol names will remove assumptions about each of the symbols. 
- Passing a symbol name will only remove assumptions about that particular symbol.


```js
ce.assume("\\alpha", "RealNumber");
ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  true

ce.forget("\\alpha");

ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  undefined
```

</section>

<section id='scoped-assumptions'>

## Scoped Assumptions

When an assumption is made, it is only valid in the current scope.

**To temporarily define a series of assumptions**, create a new scope.

```js

ce.is(["Element", "\\alpha", "RealNumber"]);
// -> undefined

ce.pushScope();

ce.assume("\\alpha", "RealNumber");
ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  true

ce.popScope();  // all assumptions made in the current scope are forgotten

ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  undefined
```

You can also specify a series of assumptions when creating the scope:


```js

ce.pushScope({
    assumptions: [
      ["Element", "\\alpha", "RealNumber"],
      ["Element", "\\beta", "RealNumber"]
    ]
})

ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  true

ce.popScope();

ce.is(["Element", "\\alpha", "RealNumber"]);
// ->  undefined
```

</section>
