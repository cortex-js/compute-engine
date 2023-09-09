---
title: Compiling Expressions
permalink: /compute-engine/guides/compiling/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
render_math_in_document: true
---

## Introduction

With the Compute Engine you can compile LaTeX expressions to JavaScript functions!

Some expressions can take a long time to numerically evaluate, for example 
if they contain a large number of terms or involve a loop \\((\sum\\) or \\(\prod\\)). 

In this case, it is useful to compile the expression into a JavaScript function that
can be evaluated much faster.

For example this approximation of \\(\pi\\): \\( \sqrt{6\sum^{10^6}_{n=1}\frac{1}{n^2}} \\)


```javascript
const expr = ce.parse("\\sqrt{6\\sum^{10^6}_{n=1}\\frac{1}{n^2}}");

// Numerical evulation using the Compute Engine
console.log(expr.evaluate().latex);
// 3.14159169866146
// Timing: 1,531ms

// Compilation to a JavaScript function and execution
const fn = expr.compile();
console.log(fn());
// 3.1415916986605086
// Timing: 6.2ms (247x faster)
```


## Compiling

**To get a compiled version of an expression** use the `expr.compile()` method:

```javascript
const expr = ce.parse("2\\prod_{n=1}^{\\infty} \\frac{4n^2}{4n^2-1}");
const fn = expr.compile();
```

**To evaluate the compiled expression** call the function returned by `expr.compile()`:

```javascript
console.log(fn());
// 3.141592653589793
```

## Arguments

The function returned by `expr.compile()` can be called with an object literal
containing the value of some variables:

```javascript
const expr = ce.parse("n^2");
const fn = expr.compile();
for (const i = 1; i < 10; i++) 
  console.log(fn({n: i}));
// 1, 4, 9, 16, 25, 36, 49, 64, 81
```


## Limitations

Complex numbers, arbitrary precision numbers, and symbolic calculations
are not supported.

The calculations are only performed using machine precision numbers.

Some functions are not supported, for example `Factorial`.

If the expression cannot be compiled, the `compile()` method will return 
`undefined`. The expression can be numerically evaluated as a fallback:

```javascript
const expr = ce.parse("5!");
console.log(expr.compile() ?? expr.N().numericValue);
// 120
```

