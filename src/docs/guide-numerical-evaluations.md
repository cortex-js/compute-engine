---
title: Numerical Evaluation
permalink: /compute-engine/guides/numerical-evaluation/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Numerical Evaluation

**To obtain a numerical approximation of the value of an expression**, call the
`expr.N()` function.

If `expr.N()` cannot provide a numerical evaluation, a symbolic representation
of the partially evaluated expression is returned.

```ts
console.log(ce.parse('3 + 5 + x').N().latex);
// ➔ "8 + x"
```

If the expression is [pure](/compute-engine/guides/expressions#pure/), the value
of the expression can be obtained with `expr.numericValue`.

```ts
console.log(ce.parse('\\sqrt{5} + 7^3').N().latex);
// ➔ "345.2360679774998"

console.log(ce.parse('\\sqrt{5} + 7^3').numericValue?.latex);
// ➔ "345.2360679774998"

console.log(ce.parse('\\sqrt{x} + 7^3').N().latex);
// ➔ "\sqrt{x} + 343"

console.log(ce.parse('\\sqrt{x} + 7^3').numericValue?.latex);
// ➔ undefined
```

{% readmore "/compute-engine/guides/symbolic-computing/" %} Read more about
<strong>Symbolic Computing</strong> {% endreadmore %}

## Numeric Modes

Four numeric modes may be used to perform numerical evaluations with the Compute
Engine: `machine` `decimal` `complex` and `auto`. The default mode is `auto`.

<section id='machine-numeric-mode'>

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

**Warning** Some numerical evaluations using machine numbers cannot produce
exact results..{notice--warning}

```ts
ce.numericMode = 'machine';
console.log(ce.parse('0.1 + 0.2').N().latex);
// ➔ "0.30000000000000004"
```

While \\(0.1\\) and \\(0.2\\) look like "round numbers" in base-10, they can
only be represented by an approximation in base-2, which introduces cascading
errors when manipulating them.

{% readmore "https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html" %}
Read <strong>"What Every Computer Scientist Should Know About Floating-Point
Arithmetic"</strong> {% endreadmore %}

</section>

<section id='decimal-numeric-mode'>

### Decimal Numeric Mode

In the `decimal` numeric mode, numbers are represented in Decimal format, using
base-10 and a variable amount of memory depending on the number of significant
digits (**precision**) desired.

Numbers in the Decimal format have a minimum value of \\( \pm
10^{-9000000000000000} \\) and a maximum value of \\( \pm9.99999\ldot\times
10^{+9000000000000000} \\).

**To change the numeric mode to the `decimal` mode**, use
`engine.numericMode = "decimal"`.

```ts
ce.numericMode = 'decimal';
console.log(ce.parse('0.1 + 0.2').N().latex);
// ➔ "0.3"
```

When using the `decimal` mode, the precision of computation (number of
significant digits used) can be changed. By default, the precision is 100.

Trigonometric operations are accurate for precision up to 1,000.

**To change the precision of calculations in `decimal` mode**, set the
`engine.precision` property.

The `precision` property affects how the computations are performed. To change
how numbers are displayed when serialized to LaTeX, use
`engine.latexOptions = { precision: 6 }` to set it to 6 significant digits, for
example.

The LaTeX precision is adjusted automatically when the `precision` is changed so
that the display precision is never greater than the computation precision.

When using the `decimal` mode, the return value of `expr.N().json` may be a
MathJSON number that looks like this:

```json
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

{% readmore "https://mikemcl.github.io/decimal.js/" %} Support for the `decimal`
mode is implemented using the <strong>decimal.js</strong> library.
{% endreadmore %}

</section>

<section id='complex-numeric-mode'>

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
{% endreadmore %}

</section>

<section id='auto-numeric-mode'>

### `Auto` Numeric Mode

When using the `auto` numeric mode, calculations are performed using machine
numbers if the precision is 15 or less. If the precision is more than 15,
Decimal numbers are used.

Computations with a result in the Complex domain will return a Complex number.

</section>

## Simplifying Before Evaluating

**When using `expr.N()`, no rewriting of the expression is done before it is
evaluated.**

Because of the limitations of machine numbers, this may produce surprising
results.

For example:

```js
const x = ce.parse('0.1 + 0.2').N();
console.log(ce.box(['Subtract', x, x]).N());
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

The dictionaries below can provide numerical evaluations for their numeric
functions:

<div class=symbols-table>

|                                                                   |                                                |
| :---------------------------------------------------------------- | :--------------------------------------------- |
| [Arithmetic](/compute-engine/reference/arithmetic/)               | `Add` `Multiply` `Sqrt` `Log` `Abs` `Round`... |
| [Trigonometry](/compute-engine/reference/trigonometry/)           | `Sin` `Cos` `Tan` `Sinh` `Arcsin`...           |
| [Special Functions](/compute-engine/reference/special-functions/) | `Erf` `Gamma` `Factorial`...                   |

</div>
