---
title: Styling
permalink: /compute-engine/reference/styling/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

# Styling

## `Style(`_`expr`_`, `_`dictionary`_`)`

{% tags "inert" %}

- _`expr`_ an expression
- _`dictionary`_ a dictionary with one or more of the following keys:
  - _`"display"`_:
    - `"inline"` for `\textstyle`
    - `"block"` for `\displaystyle`
    - `"script"` for `\scriptstyle`
    - `"scriptscript"` for `\scriptscriptstyle`
  - _`"size"`_: `1`...`10`. Size `5` is normal, size `1` is smallest
  - _`"color"`_

## `Spacing(`_`width`_`)`

- _`width`_ dimension of the spacing, in 1/18 em.
