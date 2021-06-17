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
`ComputeEngine.N()` function.

**Due to limitations in the machine representation of numbers, some arithmetic
operations cannot produce exact results.** 

For example, \\(\frac{1}{3} \approx 1.333333333\\). 

Because the machine representation of floating point numbers is using
a binary format (and not the base-10 we are used to), the results may
sometimes be surprising.

For example, \\(0.1 + 0.2 = 0.30000000000000004 \\).


**No rewriting of the expression is done before attempting to evaluate it.**

Because of the limitations on the representation of numbers, this may
again produce surprising results.
  
For example when \\( x = 0.1 + 0.2\\), \\( x - x = 2.7755575615628914\cdot 10^{-17}\\). 

The result from `ComputeEngine.simplify()` would  be \\( 0 \\).


## Complex Numbers

Many operations can be performed on Real or Complex numbers.

The imaginary unit is `ImaginaryI` (\\( \imaginaryI \\) ). 

Complex numbers can be represented as the sum and product of real numbers
and the imaginary unit, for example `["Add", 3, ["Multiply", 5, "ImaginaryI"]]` for \\( 3 + 5\imaginaryI \\).

The `Complex` function is a convenient shorthand: `["Complex", 3, 5]`.