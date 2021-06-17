---
title: Symbolic Computing
permalink: /guides/compute-engine/numerical-evaluation/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {  renderMathInDocument } 
      from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({
      TeX: {
        delimiters: {
          inline: [ ['$', '$'], ['\\(', '\\)']],
          display: [['$$', '$$'],['\\[', '\\]']],
        },
      },
      asciiMath: null,
      processEnvironments : false,
      renderAccessibleContent: false,
    });
</script>

## Numerical Evaluation

**To obtain a numerical approximation of the value of an expression**, use the
`ce.N()` function.

**Due to limitations in the machine representation of numbers, some arithmetic
operations cannot produce exact results.**

For example, \\(\frac{1}{3} \approx 1.333333333\\).

The machine representation of floating point numbers is using
a [binary format](https://en.wikipedia.org/wiki/IEEE_754) and not the base-10 we are used to, the results may
sometimes be surprising.

For example, \\(0.1 + 0.2 = 0.30000000000000004 \\).

**No rewriting of the expression is done before attempting to evaluate it.**

Because of the limitations on the representation of numbers, this may again
produce surprising results.

For example when \\( x = 0.1 + 0.2\\), \\( x - x = 2.7755575615628914\cdot
10^{-17}\\).

The result from `ComputeEngine.simplify()` would be \\( 0 \\).

## Choosing the Numeric Format and Precision

Numerical computations can be performed using one of these formats:

<div class=symbols-table>

| Numeric Format | | 
| :--- | :--- | 
| `machine` | 64-bit IEEE floating point number with about 15 digits of precision. Fastest. |
| `complex` | Two 64-bit floating point numbers. Support provided by the "complex.js" library. | 
| `decimal` | Arbitrary precision floating point. Slower, but more precise, however computations with complex numbers cannot be performed. | 

</div>

**To change the number of significant digits of the numerical computations**, set the `precision` property of an instance of `ComputeEngine`. A value of 15 or 
less will automatically be set to 15 and use the `machine` numeric format. A value over 1,000 will result in inaccurate results for trigonometric 
functions.

By the default, the numeric format is `auto`: if the precision is 15 or less
the `machine` numeric format is used, unless the computations require some
calculations with complex numbers. If the precision is greater than 15,
the `decimal` numeric format is used.

## Complex Numbers

Many operations can be performed on Real or Complex numbers.

The imaginary unit \\( \imaginaryI \\) is represented by the symbol `ImaginaryUnit`. 

To use a complex number, add and multiply the imaginary unit: \\(5 + 3\imaginaryI = \\) `["Add", 5, ["Multiply", 3, "ImaginaryUnit"]]`.

Complex numbers can be represented as the sum and product of real numbers
and the imaginary unit, for example \\( 3 + 5\imaginaryI = \\) `["Add", 3, ["Multiply", 5, "ImaginaryI"]]`.

The `Complex` function is a convenient shorthand: `["Complex", 3, 5]`.

## Operations

The functions in the category below can provide a numerical evaluation.

<div class=symbols-table>

| Numeric Format | | 
| :--- | :--- | 
| [Arithmetic](/guides/compute-engine/arithmetic/)  | `Add` `Multiply` `Sqrt` `Log` `Abs` `Round`... |
| [Trigonometric](/guides/compute-engine/trigonometry/)  | `Sin` `Cos` `Tan` `Sinh` `Arcsin`...|
| [Special Functions](/guides/compute-engine/special-functions/)  | `Erf` `Gamma` `Factorial`...|

</div>
