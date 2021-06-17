---
title: Special Functions
permalink: /guides/compute-engine/special-functions/
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


# Special Functions

<div class=symbols-table>

| Function | Operation | |
| :--- | :--- | :--- |
| `Erf` | \\(\operatorname{Erf}\\) | \\( z={\frac{2}{\sqrt {\pi }}}\int_{0}^{z}e^{-t^2}\\,dt\\), the [Error function](https://en.wikipedia.org/wiki/Error_function) is the integral of the Gaussian distribution |
| `Erfc` | \\(\operatorname {Erfc} \\) | \\(z=1-\operatorname {Erf} z\\), the Complementary Error Function |
| `Factorial` | \\(n!\\) | The products of all positive integers less than or equal to \\( n\\) |
| `Gamma` |  | \\((n-1)!\\) The [Gamma Function](https://en.wikipedia.org/wiki/Gamma_function), an extension of the factorial function to complex numbers [Q190573](https://www.wikidata.org/wiki/Q190573)|
| `LogGamma` | | |
| `SignGamma` | | |

</div>
