---
title: Special Functions
permalink: /compute-engine/reference/special-functions/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: false
render_math_in_document: true
---

# Special Functions

<div class=symbols-table>

| Function    | Notation                    |                                                                                                                                                                                                                                           |
| :---------- | :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Erf`       | \\(\operatorname{Erf}\\)    | \\[ z={\frac{2}{\sqrt {\pi }}}\int_{0}^{z}e^{-t^2}\\,dt\\]<br>The [Error function](https://en.wikipedia.org/wiki/Error_function) is the integral of the Gaussian distribution {% tags "numeric" "float-right"%}                           |
| `Erfc`      | \\(\operatorname {Erfc} \\) | \\(z=1-\operatorname {Erf} z\\)<br> The Complementary Error Function {% tags "numeric" "float-right"%}                                                                                                                                    |
| `Factorial` | \\(n!\\)                    | The products of all positive integers less than or equal to \\( n\\) {% tags "numeric" "float-right"%}                                                                                                                                    |
| `Gamma`     | \\(\gamma(n)\\)             | \\((n-1)!\\)<br>The [Gamma Function](https://en.wikipedia.org/wiki/Gamma_function), an extension of the factorial function to real and complex numbers [Q190573](https://www.wikidata.org/wiki/Q190573) {% tags "numeric" "float-right"%} |
| `LogGamma`  |                             | \\( \ln(\gamma(n)) \\) {% tags "numeric" "float-right"%}                                                                                                                                                                                  |
| `SignGamma` |                             | {% tags "numeric" "float-right"%}                                                                                                                                                                                                         |

</div>
