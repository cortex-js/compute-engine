---
title: Collections
permalink: /compute-engine/reference/collections/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
render_math_in_document: true
---


{% defs "Function" "Operation" %} 

{% def "List" %} 
<code>["List", _expr-1_, ..._expr-2_]</code>

An **ordered** collection of elements.

Use to represent a data structure, unlike `Delimiter` which is just a visual styling.

| MathJSON                        | LaTeX               |
| :------------------------------ | :------------------ |
| `["List", "x", "y", "7", "11"]` | \\( \lbrack x, y, 7, 11\rbrack \\) |
| `["List", "x", "Nothing", "y"]` | \\( \lbrack x,,y\rbrack \\)        |

{% enddef %}


{% def "Set" %} 
<code>["Set", _expr-1_, ..._expr-2_]</code>

An **unordered** collection of unique elements.

| MathJSON            | LaTeX                       |
| :------------------ | :-------------------------- |
| `["Set", "x", "y"]` | \\( \lbrace x, y\rbrace \\) |

{% enddef %}


{% enddefs %}

