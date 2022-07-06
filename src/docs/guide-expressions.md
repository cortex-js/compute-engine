---
title: Expressions
permalink: /compute-engine/guides/expressions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: true
---

The CortexJS Compute Engine produces and manipulates
[symbolic expressions](<https://en.wikipedia.org/wiki/Expression_(mathematics)>)
such as numbers, constants, variables and functions.{.xl}

Expressions are represented using the [MathJSON format](/math-json/).

In the CortexJS Compute Engine, MathJSON expressions are wrapped in a JavaScript
object, a processed called **boxing**, and the resulting expressions are **Boxed
Expressions**.

Unlike the plain data types used by JSON, Boxed Expressions allow an IDE, such
as VSCode Studio, to provide suitable hints in the editor, and to check that the
correct functions and properties are used, particularly when using TypeScript.

Boxed Expressions also improve performance by implementing caching and avoiding
repetitive calculations.

## Boxing

**To create a Boxed Expression from a MathJSON expression**, use the `ce.box()`
function.

The result is an instance of a subclass of `BoxedExpression`, such as
`BoxedNumber` `BoxedFunction` etc...

```js
let expr = ce.box(1.729e3);
console.log(expr.machineNumber);
// ➔ 1729

console.log(expr.isPositive);
// ➔ true

expr = ce.box({ num: '+Infinity' });
console.log(expr.latex);
// ➔ +\infty

expr = ce.box(['Add', 3, 'x']);
console.log(expr.head);
// ➔ "Add"

console.log(expr.isPositive);
// undefined
```

**To create a Boxed Expression from a LaTeX string**, call the `ce.parse()`
function.

```js
const expr = ce.parse('3 + x + y');
console.log(expr.head);
// ➔ "Add"

console.log(expr.json);
// ➔ ["Add", 3, "x", "y"]
```

If using MathLive, you can directly obtain an expression representing the
content of a mathfield using the `expression` property:

```js
const mf = document.getElementById('input');
mf.value = '\\frac{10}{5}';
const expr = mf.expression;
console.log(expr.evaluate().latex);
// ➔ 2
```

## Unboxing

**To access the MathJSON expression of a boxed expression**, use the `expr.json`
property. Use this property to "look inside the box".

```js
const expr = ce.box(['Add', 3, 'x']);
console.log(expr.json);
// ➔ ['Add', 3, 'x']
```

**To customize the format of the MathJSON expression** use the
`ce.jsonSerializationOptions` property.

You can use this option to control which metadata, if any, should be included,
whether to use shorthand notation, and to exclude some functions.

```ts
const expr = ce.parse('2 + \\frac{q}{p}');
console.log(expr.canonical.json);
// ➔ ["Add", 2, ["Divide", "q", "p"]]

ce.jsonSerializationOptions = {
  exclude: ['Divide'], // Don't use `Divide` functions,
  // use `Multiply`/`Power` instead
  shorthands: [], // Don't use any shorthands
};

console.log(expr.canonical.json);
// ➔ ["fn": ["Add", ["num": "2"],
//      ["fn": ["Multiply",
//        ["sym": "q"],
//        ["fn": ["Power", ["sym": "p"], ["num": "-1"]]]]
//      ]
//    ]]
```

<section id='pure'>

## Immutability

**Boxed expressions are immutable**. Once a Boxed Expression has been created it
cannot be changed to represent a different mathematical object.

The functions that manipulate Boxed Expressions, such as `expr.simplify()`,
return a new Boxed Expression, without modifying `expr`.

However, the properties of the expression may change, since some of them may
depend on contextual information which can change over time.

For example, `expr.isPositive` may return `undefined` if nothing is known about
a symbol. But if an assumption about the symbol is made later, or a value
assigned to it, then `expr.isPositive` may take a different value.

```js
const expr = ce.box('x');
console.log(expr.isPositive);
// ➔ undefined

ce.assume('x > 0');
console.log(expr.isPositive);
// ➔ true
```

What doesn't change is the fact that `expr` represents the symbol `"x"`.

## Pure Expressions

A pure expression is an expression whose value is fixed. Evaluating it produces
no side effect (doesn't change something outside its arguments to do something).

The \\( \sin() \\) function is pure: if you invoke it with the same arguments,
it will have the same value.

On the other hand, \\( \mathrm{random}() \\) is not pure: by its nature it
returns a different result on every call.

Numbers, symbols and strings are pure. A function expression is pure if the
function itself is pure, and all its arguments are pure as well.

**To check if an expression is pure**, use `expr.isPure`.

</section>

<section id='literal'>

## Literal Expressions

A literal expression is one that has a fixed value that was provided directly
when the expression was defined. Numbers and strings are literal. Symbols and
functions are not. They may have a value, but their value is calculated
indirectly.

**To check if an expression is a literal**, use `expr.isLiteral`.

</section>

<section id='canonical'>

## Canonical Expressions

The canonical form of an expression is a "standard" way of writing an
expression.

**To check if an expression is in canonical form**, use `expr.isCanonical`.

**To obtain the canonical representation of an expression**, use
`expr.canonical`.

{% readmore "/compute-engine/guides/canonical-form/" %} Read more about the
<strong>Canonical Form</strong> {% endreadmore %}

</section>

## Checking the Kind of Expression

To identify if an expression is a number, symbol, function, string or
dictionary, use the following boolean expressions:

<div class=symbols-table>

| Kind       | Boolean Expression                                     |
| :--------- | :----------------------------------------------------- |
| Number     | `expr.isLiteral && expr.isNumber`                      |
| Symbol     | `expr.symbol !== null` <br> `expr.head === 'Symbol'`   |
| Function   | `expr.tail !== null`                                   |
| String     | `expr.string !== null` <br> `expr.head === 'String'`   |
| Dictionary | `expr.keys !== null` <br> `expr.head === 'Dictionary'` |

</div>

Note that symbols or functions can return `true` for `isNumber`, if their value
is a number. Use `isLiteral` to distinguish literal numbers from other
expressions that may have a numeric value.

<section id='incomplete-expressions'>

## Incomplete Expressions

When parsing a LaTeX expression, the Compute Engine uses the **maximum effort**
doctrine. That is, even partially complete expressions are parsed, and as much
of the input as possible is reflected in the MathJSON result.

If required operands are missing (the denominator of a fraction, for example), a
`Missing` symbol is inserted where the missing operand should have been.

```ts
console.log(ce.parse('\\frac{1}').json);
// ➔ ["Divide", 1, "Missing"]

console.log(ce.parse('\\sqrt{}').json);
// ➔  ["Sqrt", "Missing"]

console.log(ce.parse('\\sqrt').json);
// ➔ ["Sqrt", "Missing"]

console.log(ce.parse('\\sqrt{').json);
// ➔  ["Error", ["Sqrt", "Missing"], "'syntax-error'", ["LatexForm", "'{'"]]

console.log(ce.parse('2 \\times').json);
// ➔ ["Multiply", 2, "Missing"]
```

The `Missing` symbol can then be replaced with another expression. To remove it
altogether, repace it with the `Nothing` symbol, then get the canonical form of
the resulting expression.

</section>

## Errors

If an expression can only be partially parsed, a function with a `Error` head is
returned.

The `Error` function has the following arguments:

- A partial result, i.e. the part that was successfully parsed. When an error
  expression is evaluated, its value is its first argument
- A error code, as a string
- An expression representing where the error occurred, for example a LaTeX string
  representing where the LaTeX parsing failed.

## Return Value Conventions

The Compute Engine API uses the following conventions for the return values of a
function and the values of an object property:

- **`null`**: this property/function does not apply, and will never apply. You
  can think of this as an answer of "never". Example: `expr.isPositive` on a
  Boxed String.
- **`undefined`**: at the moment, the result is not available, but it may be
  available later. You can think of this as an answer of "maybe". For example,
  `expr.sgn` for a symbol with no assigned value and no assumptions.
- **`this`**: this function was not applicable, or there was nothing to do. For
  example, invoking `expr.simplify()` on a boxed string.

{% readmore "/compute-engine/guides/symbols/" %} See also
<strong>symbols</strong> to read about defining and changing the value of
symbols{% endreadmore %}
