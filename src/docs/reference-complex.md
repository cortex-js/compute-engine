---
title: Complex
permalink: /compute-engine/reference/complex/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

<section id='constants'>

## Constants

| Symbol          | Description         |
| :-------------- | :------------------ | --------------------------------------------- |
| `ImaginaryUnit` | \\( \imaginaryI \\) | The imaginary unit, solution of \\(x^2+1=0\\) |

</section>

## Functions

{% defs "Function" "Description" %}

{% def "Real" %}

<div class="signature">["<strong>Real</strong>", <i>complex</i>]</div>

Evaluate to the real part of a complex number.


{% enddef %}

{% def "Imaginary" %}

<div class="signature">["<strong>Imaginary</strong>", <i>complex</i>]</div>

 Evaluate to the imaginary part of a complex number.


{% enddef %}

{% def "Conjugate" %}

<div class="signature">["<strong>Conjugate</strong>", <i>complex</i>]</div>

Evaluate to the complex conjugate of a complex number.


{% enddef %}

{% def "Abs" %}

<div class="signature">["<strong>Abs</strong>", <i>complex</i>]</div>

Evaluate to the magnitude of a complex number.

The magnitude of a complex number is the distance from the origin to the point representing the complex number in the complex plane.


{% enddef %}

{% def "Arg" %}

<div class="signature">["<strong>Conjugate</strong>", <i>complex</i>]</div>

Evaluate to the argument of a complex number.

The argument of a complex number is the angle between the positive real axis and the line joining the origin to the point representing the complex number in the complex plane.

{% enddef %}

{% def "AbsArg" %}
<div class="signature">["<strong>AbsArg</strong>", <i>complex</i>]</div>

Evaluate to the a tuple of the magnitude and argument of a complex number.

This corresponds to the polar representation of a complex number.


{% enddef %}

{% def "ComplexRoots" %}

<div class="signature">["<strong>ComplexRoots</strong>", <i>a=complex</i>, <i>n=integer</i>]</div>

Evaluate to a list of the n<sup>th</sup> roots of a number.

The complex roots of a number are the solutions of the equation \\(x^n = a\\).


```mathjson
// The three complex roots of unity (1)
["ComplexRoots", 1, 3]
// ➔ [1, -1/2 + sqrt(3)/2, -1/2 - sqrt(3)/2]
```

{% enddef %}


{% enddefs %}
