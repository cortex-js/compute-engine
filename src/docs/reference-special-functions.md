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

{% defs "Function" %}

{% def "Real" %}

[&quot;**Factorial**&quot;, _n_]{.signature}

{% latex "n!" %}

The products of all positive integers less than or equal to \\( n\\)

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

{% def "LogGamma" %}

[&quot;**LogGamma**&quot;, _z_]{.signature}

{% latex "\\ln(\\gamma(z))" %}

{% enddef %}

{% def "SignGamma" %}

[&quot;**SignGamma**&quot;, _z_]{.signature}

{% latex "\\operatorname{sgn}(\\gamma(z))" %}

{% enddef %}

{% enddefs %}

{% readmore "/compute-engine/reference/statistics/" %} See also
<strong>Statistics</strong> for Error Function {% endreadmore %}
