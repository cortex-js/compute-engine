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

These assumptions are used to select appropriate algorithms, to validate some
simplifications and to optimize computation.

## Defining New Assumptions: `assume()`

**To specify a predicate about a symbol**, use the `ce.assume()` function.

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

## Forgetting Assumptions: `forget()`

Each call to `ce.assume()` is additive: the previous assumptions are preserved.

**To remove previous assumptions**, use `ce.forget()`.


```js
ce.assume("x", "RealNumber");
ce.is(["Element", "x", "RealNumber"]);
// ->  true

ce.forget("x");

ce.is(["Element", "x", "RealNumber"]);
// ->  undefined
```


## Scopes

When an assumption is made, it is only valid in the current scope.

**To temporarily define define a series of assumptions**, create a new scope.

```js

ce.pushScope();

ce.assume("x", "RealNumber");
ce.is(["Element", "x", "RealNumber"]);
// ->  true

ce.popScope();  // all assumptions made in the current scope are forgotten

ce.is(["Element", "x", "RealNumber"]);
// ->  undefined

```

## Testing Assumptions: `is()` and `ask()`

**To test if a particular assumption is valid**, use the `ce.is()` function.

The first argument of `ce.is()` is a symbol, and the second argument is a domain.

```js
ce.is('x', 'RealNumber');
ce.is('x', ['Range', 1, 5]);
```

Alternatively, the `ce.is()` function can be invoked with a single argument, a
proposition:

```js
ce.is(['Element', 'x', 'RealNumber']);
```

The function `ce.is()` return `true` if the assumption is true, `false` if it is
not, and `undefined` if it cannot be determined.

While `ce.is()` is appropriate to get boolean answers, more complex queries
can also be made.

**To query the assumptions knowledge base** use the `ce.ask()` function.



<div class='read-more'><a href="/guides/compute-engine/patterns/">Read more about using <strong>Patterns</strong><svg class="svg-chevron" ><use xlink:href="#svg-chevron"></use></svg></a></div>

## Domain

**To query the domain of an expression**, use the `domain()` function.

```js
ce.domain('Pi');
// -> "IrrationalNumber"
```
