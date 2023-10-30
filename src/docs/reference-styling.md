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

The functions in this section produce a visual difference that is not
material to the interpretation of an expression such as text color and size or
other typographic variations.

They are **inert** and the value of a `["Function", _expr_]` expression is `expr`.

{% defs "Function" "Operation" %} 

{% def "Delimiter" %} 

[&quot;**Delimiter**&quot;, _expr_]{.signature}

[&quot;**Delimiter**&quot;, _expr_, _delim_]{.signature}


Visually group expressions with an open delimiter, a close delimiter
and separators between elements of the expression.

When serializing to LaTeX, render _expr_ wrapped in delimiters.

The `Delimiter` function is **inert** and the value of a `["Delimiter", _expr_]` expression is `expr`.

_expr_ is a function expression, usually a `["Sequence"]`. It should
not be a symbol or a number.

_delim_ is an optional string:
- when it is a single character it is a separator
- when it is two characters, the first is the opening delimiter and the second is the closing delimiter
- when it is three characters, the first is the opening delimiter, the second is the separator, and the third is the closing delimiter

The delimiters are rendered to LaTeX. 

The open and close delimiters are a single character, one of: `()[]{}<>|‖⌈⌉⌊⌋⌜⌝⌞⌟⎰⎱"`. The open and close delimiters do not have to match.
For example, `"')]'"` is a valid delimiter.

If an open or close delimiter is `.`, it is ignored.

The separator delimiter is also a single character, one of `,;.&:|-` or `U+00B7` (middle dot), `U+2022` (bullet) or `U+2026` (ellipsis).

If no _delim_ is provided, a default delimiter is used based on 
the type of _expr_:
- `["Sequence"]` -> `(,)`
- `["Tuple"]`, `["Single"]`, `["Pair"]`, `["Triple"]` -> `(,)`
- `["List"]` -> `[,]`
- `["Set"]` -> `{,}`




{% enddef %}



{% def "Matrix" %} 

[&quot;**Matrix**&quot;, _matrix_]{.signature}

[&quot;**Matrix**&quot;, _matrix_, _delim_, _format_]{.signature}

The `Matrix` function is **inert** and the value of a `["Matrix", _matrix_]` expression is `matrix`.

_matrix_ is a `["List"]` of `["List"]`s of expressions.

_delim_ is an optional string indicating the delimiters to use. It can be 
any of the delimiters allowed by the `Delimiter` function. Note there is 
no separator delimiter for matrixes.

If _delim_ is not provided, the default is `"()"`.

_format_ is an optional string indicating how to format the columns of the
matrix. It can be any of the following:
- `"<"`: left aligned
- `"="`: centered
- `">"`: right aligned
- `"|"`: a solid vertial line
- `":"`: a dashed vertial line

If _format_ is not provided, the default is `"<<<<<<<<<<"`. 

{% enddef %}


{% def "Spacing" %} 

[&quot;**Spacing**&quot;, _width_]{.signature}


When serializing to LaTeX,  `width`is the dimension of the spacing, in 1/18 em.

The `Spacing` function is **inert** and the value of a `["Spacing", _expr_]` expression is `expr`.

{% enddef %}



{% def "Style" %} 

[&quot;**Style**&quot;, _expr_, _dictionary_]{.signature}



- `expr`an expression
- `dictionary`a dictionary with one or more of the following keys:
  - `_"display"_`:
    - `"inline"` for `\textstyle`
    - `"block"` for `\displaystyle`
    - `"script"` for `\scriptstyle`
    - `"scriptscript"` for `\scriptscriptstyle`
  - `_"size"_`: `1`...`10`. Size `5` is normal, size `1` is smallest
  - `_"color"_`


The `Style` function is **inert** and the value of a `["Style", _expr_]` expression is `expr`.

{% enddef %}



{% enddefs %}

</section>




