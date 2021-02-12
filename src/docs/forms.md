---
title: MathJSON Forms
permalink: /guides/math-json-forms/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

## `BaseForm`

`["BaseForm", _value_, _base_]`

Format a _value_ in a specific _base_, such as hexadecimal or binary.

- _value_ should be an integer.
- _base_ should be an integer from 2 to 36.

| MathJSON               | Latex                |
| :--------------------- | :------------------- |
| `["BaseForm", 42, 16]` | `(\mathtt(2a))_{16}` |

## `Derivative`

`["Latex", _expression_, _order_]`

- _order_: default value is 1.

| MathJSON                   | Latex            |
| :------------------------- | :--------------- |
| `["Derivative", "f"]`      | `f^\prime`       |
| `["Derivative", "f", 2]`   | `f^\doubleprime` |
| `["Derivative", "f", "n"]` | `f^{(n)}`        |
