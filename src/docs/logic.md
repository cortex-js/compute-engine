---
title: MathJSON Logic
permalink: /guides/math-json-logic/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

## `True`, `False`, `Maybe`

Boolean constants.

Use `Maybe` when the boolean result is undetermined.

## `And`, `Or`, `Not`

Logical operators.

`And` and `Or` are multivariate:

```json
["And", "x", "y", "z"]
```

## `Equal`, `NotEqual`

Use to test if the arguments are the same expression (not the same value).

`Equal` and `NotEqual` are multivariates.

`["NotEqual, "x"]` is equivalent to `["Not", ["Equal", "x"])`

## `Equivalent`, `Implies`

Logical equivalence and logical implication between two expressions.
