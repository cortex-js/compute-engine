---
title: Special Functions
permalink: /compute-engine/reference/special-functions/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: false
render_math_in_document: true
---

# Special Functions

{% defs "Function" %}

{% def "Factorial" %}

[&quot;**Factorial**&quot;, _n_]{.signature}

{% latex "n!" %}

```json example
["Factorial", 5]
// -> 120
```

{% enddef %}

{% def "Factorial2" %}

[&quot;**Factorial2**&quot;, _n_]{.signature}

The double factorial of `n`: \\( n!! = n \cdot (n-2) \cdot (n-4) \times
\cdots\\), that is the product of all the positive integers up to `n` that have
the same parity (odd or even) as `n`.

{% latex "n!!" %}

```json example
["Factorial2", 5]
// -> 15
```

It can also be written in terms of the \\( \Gamma \\) function:

\\n!! = [ 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi
n)-1)}\Gamma\left(\frac{n}{2}+1\right) \\]

This is not the same as the factorial of the factorial of `n` (i.e.
\\((n!)!)\\)).

**Reference**

- WikiPedia: [Double Factorial](https://en.wikipedia.org/wiki/Double_factorial)

{% enddef %}

{% def "Gamma" %}

[&quot;**Gamma**&quot;, _z_]{.signature}

{% latex "\\Gamma(n) = (n-1)!" %}

The [Gamma Function](https://en.wikipedia.org/wiki/Gamma_function) is an
extension of the factorial function, with its argument shifted by 1, to real and
complex numbers.

\\[ \operatorname{\Gamma}\left(z\right) = \int\limits_{0}^{\infty} t^{z-1}
\mathrm{e}^{-t} \, \mathrm{d}t \\]

- Wikidata: [Q190573](https://www.wikidata.org/wiki/Q190573)
- NIST: http://dlmf.nist.gov/5.2.E1

```json example
["Gamma", 5]
// 24
```

{% enddef %}

{% def "GammaLn" %}

[&quot;**GammaLn**&quot;, _z_]{.signature}

{% latex "\\ln(\\gamma(z))" %}

This function is called `gammaln` in MatLab and SciPy and `LogGamma` in
Mathematica.

{% enddef %}

{% enddefs %}

{% readmore "/compute-engine/reference/statistics/" %} See also Statistics for
the <strong>Error Functions</strong> {% endreadmore %}
