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
          inline: [['\\(', '\\)']],
          display: [ ['$$', '$$'], ['\\[', '\\]']],
        },
        processEnvironments : false 
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

For example, to indicate that \\(x\\) is a real number:

```js
ce.assume('x', 'RealNumber');
```

If the `assume(_arg1_, _arg2_)` function is invoked with two arguments, it is
equivalent to `ce.assume(["Element", _arg1_, _arg2_]`.

When there is a single argument, the head of the argument can be one of the
following:

- `Element`: indicate the domain of a symbol
- Inequality such as `Less`, `LessEqual`, `Greater`, `GreaterEqual`. When an
  inequality is used, both sides are assumed to be `RealNumber`.
- Equality: `Equal`
- Boolean expression: `And`, `Or`, `Not`

## `forget()`

Each call to `assume()` is additive: the previous assumptions are preserved.

**To remove previous assumptions**, use `forget()`.

## Testing Assumptions: `is()`

**To test if a particular assumption is valid**, use the `is()` function.

The first argument of `is()` is a symbol, and the second argument is a domain.

```js
ce.is('x', 'RealNumber');
ce.is('x', ['Range', 1, 5]);
```

Alternatively, the `is()` function can be invoked with a single argument, a
predicate:

```js
ce.is(['Element', 'x', 'RealNumber']);
```

The function `is()` return `true` if the assumption is true, `false` if it is
not, and `undefined` if it cannot be determined.

## Domain

**To query the domain of an expressio**, use the `domain()` function.

```js
ce.domain('Pi');
// -> IrrationallNumber
```
