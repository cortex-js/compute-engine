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

# Numerical Evaluation

**To obtain a numerical approximation of the value of an expression**, use the
`ce.N()` function.

If `ce.N()` cannot provide a numerical evaluation, a [canonical](/guides/compute-engine/forms/) symbolic representation
of the partially evaluated expression is returned.

```ts
console.log(ce.N(parse('\\sqrt{5} + 7^3'))
// -> 345.2360679774998

console.log(ce.N(parse('\\sqrt{x} + 7^3'));
// -> ["Add", ["Sqrt", "x"], 343]
```
<div class='read-more'><a href="/guides/compute-engine/symbolic-computing/">Read more about <strong>Symbolic Computing</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>


## Numeric Formats

Three numeric formats may be used to perform numerical evaluations with the Compute Engine: `machine` `decimal` and `complex`.
### Machine Numbers

The `machine` format uses a common representation of numbers in computers: a [64-bit binary floating point format](https://en.wikipedia.org/wiki/IEEE_754). It is well suited for the CPU to do fast computations. It uses a fixed amount of memory and represent significant digits in base-2. This numeric format has about 15 signficant digits.

**Using the `machine` numeric format some numerical evaluations cannot produce exact results.**

For example: \\(0.1 + 0.2 = 0.30000000000000004 \\).

Indeed, while \\(0.1\\) and \\(0.2\\) look like "round numbers" in base-10, they are only represented approximately in base-2.

### Decimal Numbers

The `decimal` numeric format is an arbitrary-precision representation of floating points. In this format, floating point numbers are represented in base-10, and use a variable amount of memory depending on the number of significant digits (**precision**) desired.

When using Decimal numbers, the return value of `ce.N()` may be a MathJSON number that looks like this: 

```json
{
  num: "3.141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647093844609550582231725359408128481117450284102701938521105559644622948954930381964428810975665933446128475648233786783165271201909145648566923460348610454326648213393607260249141273724587006606315588174881520920962829254091715364367892590360011330530548820466521384146951941511609433057270365759591953092186117381932611793105118548074462379962749567351885752724891227938183011949129833673362440656643086021394946395224737190702179860943702770539217176293176752384674818467669405132000568127145263560827785771342757789609173637178721468440901224953430146549585371050792279689258923542019956112129021960864034418159813629774771309960518707211349999998372978049951059731732816096318595024459455346908302642522308253344685035261931188171010003137838752886587533208381420617177669147303598253490428755468731159562863882353787593751957781857780532171226806613001927876611195909216420199d"
}
```

Note that the string of digits ends with a `d` indicating this is a `decimal` number.

### Complex Numbers

The `complex` numeric format can represent complex numbers as a pair of real and imaginary components. The real and imaginary components are stored as 64-bit floating point numbers and have thus the same limitations as the `machine` format.

The complex number \\(1 + 2\imaginaryI\\) is represented as `["Complex", 1, 2]`. This is a convenient shorthand for `["Add", 1, ["Multiply", 2, "ImaginaryUnit"]]`.

## Choosing the Numeric Format and Precision

**To change the numeric format for numeric evaluations**, set the `numericFormat`
property of a `ComputeEngine` instance to one of these values:

<div class=symbols-table>

| Numeric Format | | 
| :--- | :--- | 
| `machine` | 64-bit IEEE floating point number with about 15 digits of precision. Fastest. |
| `complex` | Two 64-bit floating point numbers. Support provided by the "complex.js" library. | 
| `decimal` | Arbitrary precision floating point. Slower, but more precise, however computations with complex numbers cannot be performed. Support provided by the "decimal.js" library | 
| `auto` | Use `number` `machine` or `auto` based on the desired precision and the content of the expression  | 

</div>

**To change the number of significant digits for numerical evaluations**, set the `precision` property of a `ComputeEngine` instance.

A value of 15 or less will automatically be set to 15 and use the `machine` 
numeric format. 

A value over 1,000 will result in inaccurate results for trigonometric functions. Other arithmetic operations are not affected.

The default numeric format is `auto`: if the precision is 15 or less
the `machine` numeric format is used, unless the computations requires some
calculations with complex numbers. If the precision is greater than 15,
the `decimal` numeric format is used.

## Simplifying Before Evaluating

**When using `ce.N()`, no rewriting of the expression is done before it is evaluated.**

Because of the limitations of machine numbers, this may produce surprising
results.

For example:

```js
const x = ce.N(parse('0.1 + 0.2'));
console.log(N(['Subtract', x, x]));
// -> 2.7755575615628914e-17
```


However, the result of \\( x - x \\) from `ce.simplify()` is \\( 0 \\) since the simplification is done symbolically, before any floating point calculations are made.

```js
const x = ce.N(parse('0.1 + 0.2'));
console.log(simplify(['Subtract', x, x]));
// -> 0
```

In some cases, it may be advantageous to invoke `ce.simplify()` before using `ce.N()`.


## Tolerance

Two numbers that are sufficiently close to each other are considered equal.

**To control how close two numbers have to be before they are considered equal**,
set the `tolerance` property of a `ComputeEngine` instance.

By default, the tolerance is \\( 10^{-10} \\).

The tolerance is accounted for by the `Chop` function to determine when to 
replace a number of a small magnitude with the exact integer 0. 

It is also used when doing some comparison to zero: a number whose absolute value is smaller than the tolerance
will be considered equal to 0.

## Numeric Functions

The dictionaries below can provide numerical evaluations for their numeric functions:

<div class=symbols-table>

|  | | 
| :--- | :--- | 
| [Arithmetic](/guides/compute-engine/arithmetic/)  | `Add` `Multiply` `Sqrt` `Log` `Abs` `Round`... |
| [Trigonometry](/guides/compute-engine/trigonometry/)  | `Sin` `Cos` `Tan` `Sinh` `Arcsin`...|
| [Special Functions](/guides/compute-engine/special-functions/)  | `Erf` `Gamma` `Factorial`...|

</div>
