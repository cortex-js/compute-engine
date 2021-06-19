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

When using the `decimal` numeric format, a `Decimal` object may be returned. You can check this using `instanceof Decimal`. To get a `number` approximation, use the `toNumber()` function. To get
a string representation, use `toString()`.{.notice--info}

<div class='read-more'><a href="https://mikemcl.github.io/decimal.js/">Read more about <strong>decimal.js</strong> by @MikeMcl, the JavaScript library behind the <kbd>Decimal</kbd> class.<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

When using the `complex` numeric format, a `Complex` object may be returned. You can check this using `instanceof Complex`. To get the real or imaginary component, read the `re` or `im` property of the object, respectively.{.notice--info}


<div class='read-more'><a href="https://mikemcl.github.io/decimal.js/">Read more about <strong>complex.js</strong> by Robert Eisele, the JavaScript library behind the <kbd>Complex</kbd> class.<svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


**Due to limitations in the machine representation of numbers, some arithmetic
operations cannot produce exact results.**

For example, \\(\frac{1}{3} \approx 1.333333333\ldots \\).

When using the `machine` numeric format,floating point numbers are represented with a [binary format](https://en.wikipedia.org/wiki/IEEE_754) and not the base-10 we are used to. The results on apparently "round" numbers (in base-10) may occasionally be surprising.

For example: \\(0.1 + 0.2 = 0.30000000000000004 \\).

This problem can also happen when using the `complex` numeric format: complex numbers are represented with two machine numbers.
However, this problem **does not** occur when using the `decimal` numeric format: this format represents digits in base 10 and stores as many digits as is necessary (up to `precision` digits, which you can define: see below).

**When using `ce.N()`, no rewriting of the expression is done before it is evaluated.**

Because of the limitations of machine numbers, this may again
produce surprising results.

For example when \\( x = 0.1 + 0.2\\), \\( x - x = 2.7755575615628914\cdot
10^{-17}\\).

The result from `ComputeEngine.simplify()` would be \\( 0 \\) since the simplification is done symbolically, before any floating point calculation are made.

If `ce.N()` cannot provide a numerical evaluation, a symbolic representation
of the expression is returned. 

## Choosing the Numeric Format and Precision

**To change the numeric format for numeric computations**, set the `numericFormat`
property of a `ComputeEngine` instance to one of these values:

<div class=symbols-table>

| Numeric Format | | 
| :--- | :--- | 
| `machine` | 64-bit IEEE floating point number with about 15 digits of precision. Fastest. |
| `complex` | Two 64-bit floating point numbers. Support provided by the "complex.js" library. | 
| `decimal` | Arbitrary precision floating point. Slower, but more precise, however computations with complex numbers cannot be performed. | 
| `auto` | Determine the best numeric format based on the desired precision and the content of the expression: will automatically use `complex` if necessary, and will use `decimal` if the requested presition requires it | 

</div>

**To change the number of significant digits of numerical evaluations**, set the `precision` property of a `ComputeEngine` instance.

A value of 15 or less will automatically be set to 15 and use the `machine` 
numeric format. 

A value over 1,000 will result in inaccurate results for trigonometric functions. Other arithmetic operations are not affected.

By default, the numeric format is `auto`: if the precision is 15 or less
the `machine` numeric format is used, unless the computations require some
calculations with complex numbers. If the precision is greater than 15,
the `decimal` numeric format is used.

## Complex Numbers

Many operations can be performed on Real or Complex numbers.

The imaginary unit \\( \imaginaryI \\) is represented by the symbol `ImaginaryUnit`. 

**To use a complex number**, add and multiply the imaginary unit: \\(5 + 3\imaginaryI = \\) `["Add", 5, ["Multiply", 3, "ImaginaryUnit"]]`.

The `Complex` function is a convenient shorthand: \\(5 + 3\imaginaryI = \\)`["Complex", 5, 3]`.

## Operations

The functions in the dictionaries provide numerical evaluations.

<div class=symbols-table>

|  | | 
| :--- | :--- | 
| [Arithmetic](/guides/compute-engine/arithmetic/)  | `Add` `Multiply` `Sqrt` `Log` `Abs` `Round`... |
| [Trigonometry](/guides/compute-engine/trigonometry/)  | `Sin` `Cos` `Tan` `Sinh` `Arcsin`...|
| [Special Functions](/guides/compute-engine/special-functions/)  | `Erf` `Gamma` `Factorial`...|

</div>
