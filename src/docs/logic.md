---
title: Logic
permalink: /guides/compute-engine-logic/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({ 
      renderAccessibleContent: false,
      TeX: { 
        delimiters: { display: [ ['$$', '$$'] ] },
        processEnvironments : false 
      },
      asciiMath: null,
    });
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

`Equal` - Mathematical relationship asserting that two quantities have the same
value.

`["NotEqual, "x"]` is equivalent to `["Not", ["Equal", "x"])`. Q28113351

`Equal` and `NotEqual` are multivariates.

Compare with `Same` which returns true only when two expressions are structural
identical.

```json
["Same", ["Add", 2, 3], 5]]
// ➔ False

["Equal", ["Add", 2, 3], 5]
// ➔ True
```

## Inequalities

Compare two numerical expressions.

- `Less`
- `LessEqual`
- `Greater`
- `GreaterEqual`

## `Equivalent`, `Implies`

Logical equivalence and logical implication between two expressions.
