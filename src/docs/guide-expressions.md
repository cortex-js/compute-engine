---
title: Expressions
permalink: /compute-engine/guides/expressions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Expressions

The CortexJS Compute Engine produces and manipulates
[symbolic expressions](<https://en.wikipedia.org/wiki/Expression_(mathematics)>),
such as numbers, constants, variables and functions.

Expressions are represented using the [MathJSON format](/math-json/).

In the CortexJS Compute Engine, MathJSON expressions are wrapped in a JavaScript
object, a processed called **boxing**, and the resulting expressions are **Boxed
Expressions**.

Unlike the plain data types used by JSON, Boxed Expressions allow an IDE, such
as VSCode Studio, to provide suitable hints in the editor, and to check that the
correct functions and properties are used, particularly when using TypeScript.

Boxed Expressions are also used to implement caching and avoid repetitive
calculations.

For example, the expression \\( x + 1\\) can be represented in MathJSON as
`["Add", "x", 1]` or `{"fn": ["Add", "x", 1]}` or `["Add", "x", {"num": "1"}]`.
But \\(1729\\) has a single representation as a `BoxedExpression`.

## Boxing

**To create a boxed expression from a MathJSON expression**, use the `ce.box()`
function.

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

**To create a boxed expression from a LaTeX string**, call the `ce.parse()`
function.

```js
const expr = ce.parse('3 + x + y');
console.log(expr.head);
// ➔ "Add"

console.log(expr.json);
// ➔ ["Add", 3, "x", "y"]
```

## Immutability

**Boxed expressions are immutable**. Once a Boxed Expression has been created it
cannot be changed to represent a different mathematical object.

The functions that manipulate Boxed Expressions, such as `expr.simplify()`,
return a new Boxed Expression, without modifying `expr`.

However, this doesn't imply that the properties of the expression will not
change, since some of them may depend on contextual information which can change
over time.

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

## Unboxing

**To access the MathJSON expression of a boxed expression**, use the `expr.json`
property. Use this property to "look inside the box".

```js
const expr = ce.box(['Add', 3, 'x']);
console.log(expr.json);
// ➔ ['Add', 3, 'x']
```

There are other properties on a Boxed Expression that allows you to access the
content of the expression or part of it, in a convenient way. For example:

- **expr.symbol** the name of a symbol
- **expr.head** the head of an expression, that is, when then expression is a
  function, the name of the function, `Symbol` for a boxed symbol, `String` for
  a boxed string, etc...
- **expr.tail** the arguments of a function
- **expr.machinevalue** the value of the expression when stored as a machine
  number.

<section id='pure'>

## Pure Expressions

A pure expression is one whose value is fixed. Evaluating it produces no side
effect (doesn't change something outside its arguments to do something).

The \\( \sin \\) function is pure: if you invoke it with the same arguments, it
will have the same value. On the other hand, \\( \mathrm{random} \\) is not
pure: by it's nature it returns a different result on every call.

Numbers, symbols and strings are pure. A function expression is pure if the
function itself is pure, and all its arguments are pure as well.

**To check if an expression is pure**, use `expr.isPure`.

</section>

<section id='literal'>

## Literal Expressions

A literal expression is one that has a fixed value that was provided directly.
Numbers and strings are literal. Symbols and functions are not. They may have a
value, but their value is calculated indirectly.

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
expressions that may have a number as their value.

## Name Binding

**Name Binding is the process of associating the name of a function or symbol
with a definition.**

The definition of symbols and functions is set when an instance of a Compute
Engine is created. It is also possible to provide dictionaries that contain
additional definitions, when the Compute Engine is first created, or later at
runtime.

The definition records contain information such as the domain or value of a
symbol, or how to simplify or evaluate functions.

### Symbol Binding

When a symbol is boxed, that is when `ce.box()` is called on an expression that
contains the symbol, a definition matching the name of the symbol is searched in
the dictionary of the current scope (`ce.context`). If none is found, the parent
scope is searched recursively until one is found or the root scope is reached.

If a definition is found, the symbol is associated with (bound to) the
definition.

### Auto-binding

If no definition is found for the symbol, a new one is created automatically.

The new definition will have no value associated with it, so the symbol will be
a **free variable**. It will have a domain of `ce.defaultDomain'.

If `ce.defaultDomain` is `null`, no definition is created, and the symbol is not
bound to any definition. This will severely limit the usefulness of the symbol.

By default, `defaultDomain` is `RealNumber`.

```js
const symbol = ce.box('m'); // m for mystery
symbol.value = 5;
console.log(symbol.numericValue);
// ➔ 5
```

### Symbol Binding: Bound Variables, Free Variables and Constants

If the definition of a symbol has a value, the symbol is said to be a **bound
variable**.

This is in opposition to **free variables** which are symbols that have a
definition, but no values, and **constants** which are symbols that have a value
that cannot be altered.

The property `expr.isBound` indicate if a symbol is a bound variable (if it has
a value), and `expr.isConstant` if it is a constant.

Assigning a value to a free variable makes it a bound variable.

The value of constants is determined at the time of name binding. The value of
some symbols — `Pi`, for example — may be determined based on settings of the
compute engine, for example the value of the `precision` property. So the same
symbol could have different values depending on when the binding occurs.

```js
ce.precision = 4;
const smallPi = ce.box('Pi'); // π with 4 digits
console.log(smallPi.latex);
// ➔ 3.1415

ce.prevision = 10;
const bigPi = ce.box('Pi'); // π with 10 digits
console.log(bigPi.latex);
// ➔ 3.1415926535

ce.precision = 100; // Future computations will be done with 100 digits

console.log('pi = ', smallPi.numericValue, '=', bigPi.numericValue);
// ➔ pi  = 3.1415 = 3.1415926535
```

When discussing **binding** and symbols, this can either relate to
[**name binding**](https://en.wikipedia.org/wiki/Name_binding) (associating a
definition with the name of a symbol) or
[**value binding**](https://en.wikipedia.org/wiki/Free_variables_and_bound_variables)
(associating a value with the definition of a symbol).

### Declaring a Symbol

Declaring a symbol is providing some information about this symbol, such as its
domain or whether it is positive, without providing a value for the symbol.

If the symbol had not been used before, a new definition record for this symbol
is created, and the symbol is bound to it.

**To declare a symbol** use `ce.assume()`.

For example:

```ts
ce.assume('n', 'Integer');
ce.assume('n > 0');

const symbol = ce.box('n');
console.log(n.isPositive);
// ➔ true
console.log(n.domain);
// ➔ Integer
```

### Function Binding

The definition of a function determines how it is put in canonical form,
simplified and evaluated.

When a function is boxed, that is when `ce.box()` is called on an expression
that includes the name of the function, the domain of the arguments of the
function are used to determine which definition applies. If the domain of the
arguments cannot be determined, binding (and boxing) will fail and an exception
will get thrown. This can happen for example if one of the arguments is a symbol
that has no definition and no assumptions. @todo

```js
console.log(ce.parse('m + 3').json);
// ➔ Error: Function Add is not defined for those arguments
```

```js
// Assume that the domain of the symbol 'm' is 'Integer'
ce.assume('m', 'Integer');
console.log(ce.parse('m + 3').json);
// ➔ ['Add', 'm', 3']
```

### Scoping

To locate the definition of a symbol or function, the dictionary associated with
the current scope is used first.

If no matching definition is found, the parent scope is searched, and so on
until a definition is found.

## Comparing Expressions

- `lhs.isSame(rhs)`
- `lhs.isEqual(rhs)`
- `lhs.match(rhs) !== null`
- `lhs.is(rhs)`
- `ce.ask(['Equal', lhs, rhs])`
- `ce.ask(['Same', lhs, rhs])`
- `lhs === rhs`

<section id='incomplete-expressions'>

## Incomplete Expressions

When parsing a LaTeX expression, the Compute Engine uses the **maximum effort**
doctrine. That is, even partially complete expressions are parsed, and as much
of the input as possible is reflected in the MathJSON result.

If required operands are missing (the denominator of a fraction, for example), a
`Missing` symbol is inserted where the missing operand should have been.

```ts
ce.parse('\\frac{1}').json;
// ➔

ce.parse('\\sqrt{}').json;
// ➔

ce.parse('\\sqrt').json;
// ➔

ce.parse('\\sqrt{').json;
// ➔

ce.parse('2 \\times').json;
// ➔ ["Multiply", 2, "Missing"]
```

The `Missing` symbol can then be replaced with another expression. To remove it
altogether, repace it with the `Nothing` symbol, then get the canonical form of
the resulting expression.

</section>

## `BoxedExpression` Methods and Properties

<div class=symbols-table>

| Symbol          | Description |
| :-------------- | :---------- |
| `json`          |             |
| `latex`         |             |
| `complexity`    |             |
| `domain`        |             |
| `head`          |             |
| `tail`          |             |
| `nops`          |             |
| `op(n: number)` |             |
| `canonical`     |             |
| `simplify()`    |             |
| `evalutate()`   |             |
| `N()`           |             |
| `solve()`       |             |
| `apply()`       |             |
| `replace()`     |             |
| `value`         |             |
| `numericValue`  |             |

</div>

### Number

<div class=symbols-table>

| Symbol          | Description |
| :-------------- | :---------- |
| `machineValue`  |             |
| `rationalValue` |             |
| `decimalValue`  |             |
| `complexValue`  |             |
| `sgn`           |             |

</div>

### Symbol

<div class=symbols-table>

| Symbol          | Description |
| :-------------- | :---------- |
| `symbol`        |             |
| `def`           |             |
| `value`         |             |
| `machineValue`  |             |
| `rationalValue` |             |
| `decimalValue`  |             |
| `complexValue`  |             |
| `numericValue`  |             |
| `sgn`           |             |

</div>

### Functions

<div class=symbols-table>

| Symbol          | Description |
| :-------------- | :---------- |
| `tail`          |             |
| `nops`          |             |
| `op(n: number)` |             |
| `def`           |             |

</div>

### Dictionary

<div class=symbols-table>

| Symbol            | Description |
| :---------------- | :---------- |
| `keys`            |             |
| `keysCount`       |             |
| `get(key:string)` |             |
| `has(key:string)` |             |

</div>

### String

<div class=symbols-table>

| Symbol   | Description |
| :------- | :---------- |
| `string` |             |

</div>

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
