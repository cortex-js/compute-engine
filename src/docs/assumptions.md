---
title: Assumptions
permalink: /guides/compute-engine/assumptions/
layout: single
date: Last Modified
sidebar:
  - nav: 'compute-engine'
---

<script type='module'>
    import {renderMathInDocument} from '//unpkg.com/mathlive/dist/mathlive.min.mjs';
    renderMathInDocument({ 
      renderAccessibleContent: false,
      TeX: {
        delimiters: {
          // Allow math formulas surround by $...$ or \(...\)
          // to be rendered as textstyle content.
          inline: [
            ['$', '$'],
            ['\\(', '\\)'],
          ],
          display: [],
        },
      asciiMath: null,
    });
</script>

# Assumptions

The Cortex Compute Engine has a robust system to specify properties and
relationship between symbols.

The assumptions are used to select appropriate algorithms, to validate some
simplifications and to optimize computation.

## Defining New Assumptions: `assume()`

**To specify a predicate about a symbol**, use the `assume()` function.

```js
ce.assume(['MemberOf', 'x', 'RealNumber']);
```

The head of the argument of `assume()` can be one of the following:

- `Member`: indicate the domain of a symbol
- Inequality: `Less`, `LessEqual`, `Greater`, `GreaterEqual`. When an inequality
  is used, both sides are assumed to be `RealNumber`.
- Equality: `Equal`
- Conjunction: `And`

## `forget()`

Each call to `assume()` is additive: the previous assumptions are preserved. To
remove previous assumptions, use `forget()`.

## Testing Assumptions: `is()`

**To test if a particular assumption is valid**, use the `is()` function.

The first argument of `is()` is a symbol, and the second argument is a domain.

```js
ce.is('x', 'RealNumber');
ce.is('x', ['Range', 1, 5]);
```

The function `is()` return `true` if the assumption is true, `false` if it is
not, and `undefined` if it cannot be determined.

```js
ce.domain('x');
```
