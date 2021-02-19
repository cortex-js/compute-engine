---
title: Logic
permalink: /guides/compute-engine-logic/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.mjs';
    renderMathInDocument();
</script>

# Logic
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

`Equal` and `NotEqual` are multivariates.

`["NotEqual, "x"]` is equivalent to `["Not", ["Equal", "x"])`

## `Equivalent`, `Implies`

Logical equivalence and logical implication between two expressions.
