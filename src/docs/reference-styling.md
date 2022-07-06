---
title: Styling
permalink: /compute-engine/reference/styling/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
toc: false
---

# Styling

The functions in this section represent a visual difference that is not usually
material to the interpretation of an expression such as text color and size or
other typographic variations.

{% defs "Function" "Operation" %} 

{% def "Delimiter" %} 
{% tags "inert" "float-right" %}<code>["Delimiter", _expr_]</code><br>
<code>["Delimiter", _expr_, _sep_]</code><br>
<code>["Delimiter", _expr_, _open_, _close_]</code><br>
<code>["Delimiter", _expr_, _open_, _sep_, _close_]</code>

May be used to group arithmetic expressions.

When serializing to LaTeX, render _expr_ wrapped in a delimiter. 

If _expr_ is a `["List"]` expression, serialize each element of the list, separated by _sep_.

If no _sep_ is provided, use a comma `,` as a separator.

If no _open_ and _close_ strings are provided, use parentheses `(` and `)`.

The `Delimiter` function is **inert** and the value of a `["Delimiter", _expr_]` expression is `_expr_`.

{% enddef %}

{% def "Spacing" %} 
{% tags "inert" "float-right" %}<code>["Spacing", _width_]</code>

When serializing to LaTeX,  `_width_` is the dimension of the spacing, in 1/18 em.

The `Spacing` function is **inert** and the value of a `["Spacing", _expr_]` expression is `_expr_`.

{% enddef %}



{% def "Style" %} 
{% tags "inert" "float-right" %}<code>["Style", _expr_, _dictionary_]</code><br>


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




