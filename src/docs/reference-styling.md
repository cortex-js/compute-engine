---
title: Styling
permalink: /compute-engine/reference/styling/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: false
render_math_in_document: true
---

# Styling

The functions in this section represent a visual difference that is not usually
material to the interpretation of an expression such as text color and size or
other typographic variations.

{% defs "Function" "Operation" %} 

{% def "Delimiter" %} 

[&quot;**Delimiter**&quot;, _expr_, _delim_]{.signature}


Visually group arithmetic expressions.

When serializing to LaTeX, render _expr_ wrapped in a delimiter. 

_delim_ is a string with the following format:
- `_"open"_` `_"close"_` e.g. `["Delimiter", "x", "'()'"]` renders as \\( (x) \\)
- `_"open"_` `_"close"_` `_"sep"_` e.g. `["Delimiter", ["List", 1, 2], "'{},'"]` renders as \\\lbrace (1, 2\rbrace \\)


If _expr_ is a `["List"]` expression, serialize each element of the list, separated by _sep_.

If no _sep_ is provided, use a comma `,` as a separator.

If no _open_ and _close_ strings are provided, use parentheses `(` and `)`.

The `Delimiter` function is **inert** and the value of a `["Delimiter", _expr_]` expression is `_expr_`.

{% enddef %}

{% def "Spacing" %} 

[&quot;**Spacing**&quot;, _width_]{.signature}


When serializing to LaTeX,  `_width_` is the dimension of the spacing, in 1/18 em.

The `Spacing` function is **inert** and the value of a `["Spacing", _expr_]` expression is `_expr_`.

{% enddef %}



{% def "Style" %} 

[&quot;**Style**&quot;, _expr_, _dictionary_]{.signature}



- `_expr_` an expression
- `_dictionary_` a dictionary with one or more of the following keys:
  - `_"display"_`:
    - `"inline"` for `\textstyle`
    - `"block"` for `\displaystyle`
    - `"script"` for `\scriptstyle`
    - `"scriptscript"` for `\scriptscriptstyle`
  - `_"size"_`: `1`...`10`. Size `5` is normal, size `1` is smallest
  - `_"color"_`


The `Style` function is **inert** and the value of a `["Style", _expr_]` expression is `_expr_`.

{% enddef %}



{% enddefs %}

</section>




