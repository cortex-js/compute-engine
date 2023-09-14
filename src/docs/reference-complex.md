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

{% defs "Function" "Operation" %}

{% def "Real" %}

Evaluate to the real part of a complex number.

```mathjson
["Real", _complex_]
```

{% enddef %}

{% def "Imaginary" %} Evaluate to the imaginary part of a complex number.

```mathjson
["Imaginary", _complex_]
```

{% enddef %}

{% def "Conjugate" %}

Evaluate to the complex conjugate of a complex number.

```mathjson
["Conjugate", _complex_]
```

{% enddef %}

{% def "Abs" %}

Evaluate to the magnitude of a complex number.

```mathjson
["Abs", _complex_]
```

{% enddef %}

{% def "Arg" %}

Evaluate to the argument of a complex number.

```mathjson
["Arg", _complex_]
```

{% enddef %}

{% def "AbsArg" %}

Evaluate to the a tuple of the magnitude and argument of a complex number.

This corresponds to the polar representation of a complex number.

```mathjson
["AbsArg", _complex_]
```

{% enddef %}

{% def "ComplexRoots" %}

Evaluate to a list of the nth roots of a number.

```mathjson
["ComplexRoots", _number_, _n_]
```

```mathjson
// The three complex roots of unity (1)
["ComplexRoots", 1, 3]
// ➔ [1, -1/2 + sqrt(3)/2, -1/2 - sqrt(3)/2]
```

{% enddef %}

{% def "Complex" %}

{% enddef %}

{% enddefs %}
