---
title: Expressions
permalink: /compute-engine/guides/expressions/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
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

**To get a Boxed Expression representing the content of a MathLive mathfield**
usethe `mf.expression` property:

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
`ce.jsonSerializationOptions` property )

Use this option to control which metadata, if any, should be included,
whether to use shorthand notation, and to exclude some functions. See 
[JsonSerializationOptions](/docs/compute-engine/?q=JsonSerializationOptions) 
for more info about what can be customized.

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


## Literal Expressions

A literal expression is one that has a fixed value that was provided directly
when the expression was defined. 

Numbers and strings are literals. Symbols and functions are not. They may have 
a value, but their value is calculated indirectly.

**To check if an expression is a literal**, use `expr.isLiteral`.



## Immutability

**Boxed expressions are immutable**. Once a Boxed Expression has been created it
will always represent the same mathematical object.

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
no side effect.

The \\( \sin() \\) function is pure: it evaluates to the same value when the 
same arguments are applied to it.

On the other hand, the \\( \mathrm{random}() \\) function is not pure: by its 
nature it evaluates to a different value on every evaluation.

Numbers, symbols and strings are pure. A function expression is pure if the
function itself is pure, and all its arguments are pure as well.

**To check if an expression is pure**, use `expr.isPure`.




<section id='canonical'>

## Canonical Expressions

The canonical form of an expression is a "standard" way of writing an
expression.

**To check if an expression is already in canonical form**, use `expr.isCanonical`.

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

A symbol may have a value if it represents a bound variable, but it may also
have no value if it represents a free variable. 



<section id=errors>

## Errors

Sometimes, things go wrong.

When something goes wrong an `["Error"]` expression is returned. 

The **first argument** of an `["Error"]` expression provides details about the 
nature of the problem. This can be either a string or an `["ErrorCode"]` 
expression if there are additional arguments to the error.

For example if the problem is that an argument of a function expression is not
of the expected domain, an expression such as 
`["Error", ["ErrorCode", "'expected-argument-domain'", ["Domain", "Number"]]]`
could be returned to indicate that a value of domain `"Number"` was expected.

The **second argument** of an `["Error"]` expression indicate the context of 
the error. This can be a `["Latex"]` expression when the problem occurred while
parsing a LaTeX string, or another expression if the problem was detected later.

### Parsing Errors

When parsing a LaTeX expression, the Compute Engine uses the **maximum effort**
doctrine. That is, even partially complete expressions are parsed, and as much
of the input as possible is reflected in the MathJSON result.

If required operands are missing (the denominator of a fraction, for example), a
`["Error", "'missing'"]` error expression is inserted where the missing operand 
should have been.

Problems that occur while parsing a LaTeX string will usually indicate a 
LaTeX syntax error or typo: missing `}`, mistyped command name, etc...



### Semantic Errors

Some errors are not caught until an expression is bound, that is until
an attempt is made to associate its symbol and function identifiers to 
definitions. This could include missing or mismatched arguments. 

Some errors that could be considered LaTeX syntax errors may not surface until 
binding occurs. 

For example `\frac{1}{2=x}` (instead of `\frac{1}{2}=x`) will be parsed as 
`["Divide", 1, ["Equal", 2, x]]`. The fact that the second argument of the `"Divide"` 
function is a boolean and not a number will not be detected until the definition
for `"Divide"` has been located.

Name binding is done lazily, not upon boxing. To force the binding to occur, 
request the canonical version of the expression.

**To check if an expression includes an `["Error"]` subexpression** check
the `expr.isValid` property.

**To get the list of all the `["Error"]` subexpression** use the 
`expr.errors` property.

<div class=symbols-table>

| Error Code       | Meaning                                     |
| :--------- | :----------------------------------------------------- |
| `syntax-error` | the parsing could not continue |
| `missing` | an expression was expected |
| `expected-expression` | an expression was expected inside an enclosure (parentheses) |
| `unexpected-command` | the command is unknown, or not applicable in the current parsing context |
| `unexpected-token` | the character does not apply to the current parsing context |
| `expected-argument-domain` | the argument provided does not match the expected domain |
| `expected-closing-delimiter` | a closing `}` was expected, but is missing |
| `unexpected-closing-delimiter` | a closing `}` was encountered, but not expected |
| `expected-environment-name` | the name of an environment should be provided with a `\begin` or `\end` command |
| `unknown-environment` | the environment name provided cannot be parsed |
| `unbalanced-environment` | the named used with the `\begin` and `\end` commands should match | 
| `unexpected-operator` | the operator does not apply to the current parsing context. Could be a infix or postfix operator without a rhs. |
| `unexpected-digit` | the string included some characters outside of the range of expected digits |
| `expected-string-argument` | the argument was expected to be a string |
| `unexpected-base` | the base is outside of the expected range (2..36) |
| `iteration-limit-exceeded` | a loop has reached the maximum iteration limit |
</div>


```ts
console.log(ce.parse('\\frac{1}').json);
// ➔ ["Divide", 1, ["Error", "'missing'"]]

console.log(ce.parse('\\sqrt{}').json);
// ➔  ["Sqrt", ["Error", "'missing'"]]

console.log(ce.parse('\\sqrt').json);
// ➔ ["Sqrt", ["Error", "'missing'"]]

console.log(ce.parse('\\sqrt{').json);
// ➔  ["Error", ["Sqrt", ["Error", "'missing'"]], "'syntax-error'", ["Latex", "'{'"]]

console.log(ce.parse('\\times 2').json);
// ➔ ["Error", "'unexpected-operator'"]
```


</section>

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

{% readmore "/compute-engine/guides/symbols/" %} Read more about defining and 
changing the value of <strong>symbols</strong> {% endreadmore %}
