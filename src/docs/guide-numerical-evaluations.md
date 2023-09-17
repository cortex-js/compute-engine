---
title: Numeric Evaluation
permalink: /compute-engine/guides/numeric-evaluation/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
preamble:
  '<h1>Numeric Evaluation</h1><p class="xl">To obtain an exact numeric
  evaluation of an expression use <kbd>expr.evaluate()</kbd>. To obtain a
  numeric approximation use <kbd>expr.N()</kbd>.</p>'
---

An evaluation with `expr.evaluate()` preserves **exact values**.

Exact values are:

- integers and rationals
- square roots of integers and rationals
- constants such as `ExponentialE` and `Pi`

If one of the arguments is not an exact value the expression is evaluated as a
**numeric approximation**.

**To obtain a numeric approximation, use `expr.N()`**. If `expr.N()` cannot
provide a numeric evaluation, a symbolic representation of the partially
evaluated expression is returned.

The value of `N()` is a boxed expression. The `numericValue` property is either
a machine number, a `Decimal` object or a `Complex` object, depending on the
`numericMode` of the compute engine, or `null` if the result is not a number.

**To check if the `numericValue` is a `Decimal`** use
`ce.isBignum(expr.N().numericValue)`.

**To check if the `numericValue` is a `Complex`** use
`ce.isComplex(expr.N().numericValue)`.

**To access a JavaScript machine number approximation of the result** use
`valueOf()`. If `numericValue` is a machine number, a `Decimal` object, or a
rational, `valueOf()` will return a machine number approximation. Otherwise it
returns a string serialization of the MathJSON representation of the expression.

```js
console.log(ce.parse('11 + \\sqrt{x}').N().valueOf());
// ➔ "["Add",11,["Sqrt","x"]]"
// Note: if the result is not a number, valueOf() returns a string
// representation of the expression

const expr = ce.parse('\\sqrt{5} + 7^3').N();

console.log(expr.valueOf());
// ➔ 345.2360679774998
// If the result is a number, valueOf() returns a machine number approximation

console.log(expr.latex);
// ➔ "345.236\,067\,977\,499\,8,"
// Note: the LaTeX representation of the numeric value is rounded to the
// display precision

console.log(expr.numericValue);
// ➔ [Decimal]
// Note: depending on the numeric mode, this may be a machine number,
// a Decimal object or a Complex object

if (ce.isBignum(expr.numericValue)) {
  console.log(
    'The numeric value is a Decimal object',
    expr.numericValue.toNumber()
  );
} else if (ce.isComplex(expr.numericValue)) {
  console.log(
    'The numeric value is a Complex object',
    expr.numericValue.re,
    expr.numericValue.im
  );
} else if (Array.isArray(expr.numericValue)) {
  console.log(
    'The numeric value is a rational',
    expr.numericValue[0],
    expr.numericValue[1]
  );
} else {
  console.log('The numeric value is a machine number', expr.numericValue);
}
```

{% readmore "/compute-engine/guides/symbolic-computing/" %} Read more about
<strong>Symbolic Computing</strong> {% endreadmore %}

## Repeated Evaluation

**To repeatedly evaluate an expression** use `ce.set()` to change the value of
variables. `ce.set()` changes the value associated with one or more variables in
the current scope.

```js
const expr = ce.parse('3x^2+4x+2');

for (const x = 0; x < 1; x += 0.01) {
  ce.set({ x: x });
  console.log(`f(${x}) = ${expr.N().valueOf()}`);
}
```

You can also use `expr.subs()`, but this will create a brand new expression on
each iteration, and will be much slower.

```js
const expr = ce.parse('3x^2+4x+2');

for (const x = 0; x < 1; x += 0.01) {
  console.log(`f(${x}) = ${expr.subs({ x: x }).N().valueOf()}`);
}
```

**To reset a variable to be unbound to a value** use `ce.set()`

```js
ce.set({ x: null });

console.log(expr.N().latex);
// ➔ "3x^2+4x+c"
```

You can change the value of a variable by setting its `value` property:

```ts
ce.symbol("x").value = 5;

ce.symbol("x").value = undefined;
```

If performance is important, you can compile the expression to a JavaScript
function.

## Compiling

**To get a compiled version of an expression** use the `expr.compile()` method:

```js
const expr = ce.parse('3x^2+4x+2');
const fn = expr.compile();
for (const x = 0; x < 1; x += 0.01) console.log(fn({ x }));
```

The syntax `{x}` is a shortcut for `{"x": x}`, in other words it defines an
argument named `"x"` (which is used the expression `expr`) as having the value
of the JavaScript variable `x` (which is used in the for loop).{.notice--info}

This will usually result in a much faster evaluation than using `expr.N()` but
this approach has some limitations.

{% readmore "/compute-engine/guides/compiling/" %} Read more about **Compiling
Expressions to JavaScript** {% endreadmore %}

## Numeric Modes

Four numeric modes may be used to perform numeric evaluations with the Compute
Engine: `"machine"` `"bignum"` `"complex"` and `"auto"`. The default mode is
`"auto"`.

Numbers are represented internally in one of the following format:

- `number`: a 64-bit float
- `complex`: a pair of 64-bit float for the real and imaginary part
- `bignum`: an arbitrary precision floating point number
- `rational`: a pair of 64-bit float for the numerator and denominator
- `big rational`: a pair of arbitrary precision floating point numbers for the
  numerator and denominator

Depending on the current numeric mode, this is what happens to calculations
involving the specified number types:

- {% icon "circle-check" "green-700" %} indicate that no transformation is done
- `upgraded` indicate that a transformation is done without loss of precision
- `downgraded` indicate that a transformation is done with may result in a loss
  of precision, a rounding towards 0 if underflow occurs, or a rounding towards
  \\( \\pm\\infty \\) if overflow occurs.

<div class="symbols-table first-column-header">

|                | `auto`                                | `machine`                             | `bignum`                              | `complex`                             |
| :------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| `number`       | upgraded to `bignum`                  | {% icon "circle-check" "green-700" %} | upgraded to `bignum`                  | {% icon "circle-check" "green-700" %} |
| `complex`      | {% icon "circle-check" "green-700" %} | `NaN`                                 | `NaN`                                 | {% icon "circle-check" "green-700" %} |
| `bignum`       | {% icon "circle-check" "green-700" %} | downgraded to `number`                | {% icon "circle-check" "green-700" %} | downgraded to `number`                |
| `rational`     | {% icon "circle-check" "green-700" %} | {% icon "circle-check" "green-700" %} | upgraded to `big rational`            | {% icon "circle-check" "green-700" %} |
| `big rational` | {% icon "circle-check" "green-700" %} | downgraded to `rational`              | {% icon "circle-check" "green-700" %} | downgraded to `rational`              |

</div>

### Machine Numeric Mode

Calculations in the `machine` numeric mode use a
[64-bit binary floating point format](https://en.wikipedia.org/wiki/IEEE_754).

This format is implemented in hardware and well suited to do fast computations.
It uses a fixed amount of memory and represent significant digits in base-2 with
about 15 digits of precision and with a minimum value of \\( \pm5\times
10^{-324} \\) and a maximum value of \\( \pm1.7976931348623157\times 10^{+308}
\\)

**To change the numeric mode to the `machine` mode**, use
`engine.numericMode = "machine"`.

Changing the numeric mode to `machine` automatically sets the precision to 15.

Calculations that have a complex value, for example \\( \sqrt{-1} \\) will
return `NaN`. Some calculations that have a value very close to 0 may return 0.
Some calculations that have a value greater than the maximum value representable
by a machine number may return \\( \pm\infty \\).

**Warning** Some numeric evaluations using machine numbers cannot produce exact
results..{notice--warning}

```ts
ce.numericMode = "machine";
console.log(ce.parse('0.1 + 0.2').N().latex);
// ➔ "0.30000000000000004"
```

While \\(0.1\\) and \\(0.2\\) look like "round numbers" in base-10, they can
only be represented by an approximation in base-2, which introduces cascading
errors when manipulating them.

{% readmore "https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html" %}
Read <strong>"What Every Computer Scientist Should Know About Floating-Point
Arithmetic"</strong> {% endreadmore %}

### Bignum Numeric Mode

In the `bignum` numeric mode, numbers are represented as a string of base-10
digits and an exponent.

Bignum numbers have a minimum value of \\( \\pm
10^{-9\\,000\\,000\\,000\\,000\\,000} \\) and a maximum value of \\(
\\pm9.99999\\ldots \\times 10^{+9\\,000\\,000\\,000\\,000\\,000} \\).

**To change the numeric mode to the `bignum` mode**, use
`engine.numericMode = "bignum"`.

```ts
ce.numericMode = "bignum";
console.log(ce.parse('0.1 + 0.2').N().latex);
// ➔ "0.3"
```

When using the `bignum` mode, the precision of computation (number of
significant digits used) can be changed. By default, the precision is 100.

Trigonometric operations are accurate for precision up to 1,000.

**To change the precision of calculations in `bignum` mode**, set the
`engine.precision` property.

The `precision` property affects how the computations are performed, but not how
they are serialized. To change how numbers are serialized to LaTeX, use
`engine.latexOptions = { precision: 6 }` to set it to 6 significant digits, for
example.

The LaTeX precision is adjusted automatically when the `precision` is changed so
that the display precision is never greater than the computation precision.

When using the `bignum` mode, the return value of `expr.N().json` may be a
MathJSON number that looks like this:

```json example
{
  "num": "3.141592653589793238462643383279502884197169399375105820974944592307
  8164062862089986280348253421170679821480865132823066470938446095505822317253
  5940812848111745028410270193852110555964462294895493038196442881097566593344
  6128475648233786783165271201909145648566923460348610454326648213393607260249
  1412737245870066063155881748815209209628292540917153643678925903600113305305
  4882046652138414695194151160943305727036575959195309218611738193261179310511
  8548074462379962749567351885752724891227938183011949129833673362440656643086
  0213949463952247371907021798609437027705392171762931767523846748184676694051
  3200056812714526356082778577134275778960917363717872146844090122495343014654
  9585371050792279689258923542019956112129021960864034418159813629774771309960
  5187072113499999983729780499510597317328160963185950244594553469083026425223
  0825334468503526193118817101000313783875288658753320838142061717766914730359
  8253490428755468731159562863882353787593751957781857780532171226806613001927
  876611195909216420199"
}
```

{% readmore "https://mikemcl.github.io/decimal.js/" %} Support for the `bignum`
mode is implemented using the <strong>decimal.js</strong> library. This library
is built-in with the Compute Engine. {% endreadmore %}

### Complex Numeric Mode

The `complex` numeric mode can represent complex numbers as a pair of real and
imaginary components. The real and imaginary components are stored as 64-bit
floating point numbers and have thus the same limitations as the `machine`
format.

The complex number \\(1 + 2\imaginaryI\\) is represented as `["Complex", 1, 2]`.
This is a convenient shorthand for
`["Add", 1, ["Multiply", 2, "ImaginaryUnit"]]`.

**To change the numeric mode to the `complex` mode**, use
`engine.numericMode = "complex"`.

Changing the numeric mode to `complex` automatically sets the precision to 15.

{% readmore "https://github.com/infusion/Complex.js" %} Support for the
`complex` mode is implemented using the <strong>Complex.js</strong> library.
This library is built-in with the Compute Engine. {% endreadmore %}

### `Auto` Numeric Mode

When using the `auto` numeric mode, calculations are performed using bignum
numbers.

Computations which result in a complex number will return a complex number as a
`Complex` object.

To check the type of the result, use `ce.isComplex(expr.N().numericValue)` and
`ce.isBignum(expr.N().numericValue)`.

## Simplifying Before Evaluating

**When using `expr.N()`, no rewriting of the expression is done before it is
evaluated.**

Because of the limitations of machine numbers, this may produce surprising
results.

For example, when `numericMode = "machine"`:

```js
const x = ce.parse('0.1 + 0.2').N();
console.log(ce.box(["Subtract", x, x]).N());
// ➔ 2.7755575615628914e-17
```

However, the result of \\( x - x \\) from `ce.simplify()` is \\( 0 \\) since the
simplification is done symbolically, before any floating point calculations are
made.

```js
const x = ce.parse('0.1 + 0.2').N();
console.log(ce.parse('x - x').simplify());
// ➔ 0
```

In some cases, it may be advantageous to invoke `expr.simplify()` before using
`expr.N()`.

## Tolerance

Two numbers that are sufficiently close to each other are considered equal.

**To control how close two numbers have to be before they are considered
equal**, set the `tolerance` property of a `ComputeEngine` instance.

By default, the tolerance is \\( 10^{-10} \\).

The tolerance is accounted for by the `Chop` function to determine when to
replace a number of a small magnitude with the exact integer 0.

It is also used when doing some comparison to zero: a number whose absolute
value is smaller than the tolerance will be considered equal to 0.

## Numeric Functions

The topics below from the
[Standard Library](/compute-engine/guides/standard-library/) can provide numeric
evaluations for their numeric functions:

<div class=symbols-table>

| Topic                                                             | Symbols/Functions                                                      |
| :---------------------------------------------------------------- | :--------------------------------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)               | `Add` `Multiply` `Power` `Exp` `Log` `ExponentialE` `ImaginaryUnit`... |
| [Calculus](/compute-engine/reference/calculus/)                   | `Derive` `Integrate`...                                                |
| [Complex](/compute-engine/reference/complex/)                     | `Real` `Conjugate`, `ComplexRoots`...                                  |
| [Special Functions](/compute-engine/reference/special-functions/) | `Gamma` `Factorial`...                                                 |
| [Statistics](/compute-engine/reference/statistics/)               | `StandardDeviation` `Mean` `Erf`...                                    |
| [Trigonometry](/compute-engine/reference/trigonometry/)           | `Pi` `Cos` `Sin` `Tan`...                                              |

</div>
