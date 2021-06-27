---
title: Special Functions
permalink: /compute-engine/reference/special-functions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---
<script defer type='module'>
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


# Special Functions

<div class=symbols-table>

| Function | Notation | |
| :--- | :--- | :--- |
| `Erf` | \\(\operatorname{Erf}\\) | \\( z={\frac{2}{\sqrt {\pi }}}\int_{0}^{z}e^{-t^2}\\,dt\\), the [Error function](https://en.wikipedia.org/wiki/Error_function) is the integral of the Gaussian distribution |
| `Erfc` | \\(\operatorname {Erfc} \\) | \\(z=1-\operatorname {Erf} z\\), the Complementary Error Function |
| `Factorial` | \\(n!\\) | The products of all positive integers less than or equal to \\( n\\) |
| `Gamma` |  | \\((n-1)!\\) The [Gamma Function](https://en.wikipedia.org/wiki/Gamma_function), an extension of the factorial function to real and complex numbers [Q190573](https://www.wikidata.org/wiki/Q190573)|
| `LogGamma` | | \\(( \ln(\gamma(n)) \\)|
| `SignGamma` | | |

</div>
