---
title: Styling
permalink: /compute-engine/reference/styling/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
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

Display _expr_ wrapped in a delimiter.

{% enddef %}

{% def "Spacing" %} 
{% tags "inert" "float-right" %}<code>["Spacing", _width_]</code>

- `_width_` dimension of the spacing, in 1/18 em

{% enddef %}



{% def "Style" %} 
{% tags "inert" "float-right" %}<code>["Style", _expr_, _dictionary_]</code><br>


- `_expr_` an expression
- `_dictionary_` a dictionary with one or more of the following keys:
  - _`"display"`_:
    - `"inline"` for `\textstyle`
    - `"block"` for `\displaystyle`
    - `"script"` for `\scriptstyle`
    - `"scriptscript"` for `\scriptscriptstyle`
  - `_"size"_`: `1`...`10`. Size `5` is normal, size `1` is smallest
  - `_"color"_`
{% enddef %}



{% enddefs %}

</section>




