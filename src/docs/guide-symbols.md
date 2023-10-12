---
title: Symbols
permalink: /compute-engine/guides/symbols/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
toc: true
preamble:
  '<h1>Symbols</h1><p class="xl">A <b>symbol</b> is an identifier representing a
  named mathematical object. It belongs to a domain and it may hold a value. A
  symbol without a value represents a mathematical unknown in an expression.</p>'
head:
  modules:
    - /assets/js/code-playground.min.js
    - //unpkg.com/@cortex-js/compute-engine?module
  moduleMap: |
    window.moduleMap = {
    "mathlive": "//unpkg.com/mathlive?module",
    // "mathlive": "/js/mathlive.mjs",
    "html-to-image": "///assets/js/html-to-image.js",
    "compute-engine": "//unpkg.com/@cortex-js/compute-engine?module"
    };
---

<script type="module">
  window.addEventListener("DOMContentLoaded", () => 
    import("//unpkg.com/@cortex-js/compute-engine?module").then((ComputeEngine) => {
      globalThis.ce = new ComputeEngine.ComputeEngine();
      const playgrounds = [...document.querySelectorAll("code-playground")];
      for (const playground of playgrounds) {
        playground.autorun = 1000; // delay in ms
        playground.run();
      }
    })
);
</script>

**To change the value or domain of a symbol**, use the `value` and `domain`
properties of the symbol.

A symbol does not have to be declared before it can be used. The domain of a
symbol will be inferred based on its usage or its value.

<code-playground layout="stack" show-line-numbers autorun="never">
<pre slot="javascript">
const n = ce.box("n");
n.value = 5;
console.log("n =", n.value.json);</pre></code-playground>

**To get a list of all the symbols in an expression** use `expr.symbols`.

{% readmore "/compute-engine/guides/augmenting/" %} Read more about
<strong>adding definitions</strong> for symbols and functions {% endreadmore %}

## Scope

Symbols are defined within a **scope**.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}

## Unknowns and Constants

A symbol that has been declared, but has no values associated with it, is said
to be an **unknown**.

A symbol whose value cannot be changed is a **constant**. Constants are
identified by a special flag in their definition.

**To check if a symbol is a constant**, use the `expr.isConstant` property.

```js
console.log(ce.box("x").isConstant);
// ➔ false

console.log(ce.box("Pi").isConstant);
// ➔ true
```

The value of constants may depend on settings of the Compute Engine. For
example, the value of `Pi` is determined based on the value of the `precision`
property. The values of constants in scope when the `precision` setting is
changed will be updated. {.notice-warning}

```js
ce.precision = 4;
const smallPi = ce.box("Pi"); // π with 4 digits
console.log(smallPi.latex);
// ➔ 3.1415

ce.precision = 10;
const bigPi = ce.box("Pi"); // π with 10 digits
console.log(bigPi.latex);
// ➔ 3.1415926535

ce.precision = 100; // Future computations will be done with 100 digits

console.log("pi = ", smallPi.numericValue, "=", bigPi.numericValue);
// ➔ pi  = 3.1415 = 3.1415926535
```

## Automatic Declaration of Symbols

An unknown symbol is automatically declared when it is first used in an
expression.

The new definition has a domain of `undefined` and no value associated with it,
so the symbol will be an **unknwon**.

```js
const symbol = ce.box("m"); // m for mystery
console.log(symbol.domain);
// ➔ undefined

symbol.value = 5;
console.log(symbol.numericValue);
// ➔ 5
```

## Forgetting a Symbol

**To _reset_ what is known about a symbol** use the `ce.forget()` function.

The `ce.forget()` function will remove any
[assumptions](/compute-engine/guides/assumptions) associated with a symbol, and
remove its value. Howeve, the symbol will remained declared, since other
expressions may depend on it.

**To forget about a specific symbol**, pass the name of the symbol as an
argument to `ce.forget()`.

**To forget about all the symbols in the current scope**, use `ce.forget()`
without any arguments.

Note that only symbols in the current scope are forgotten. If assumptions about
the symbol existed in a previous scope, those assumptions will be in effect when
returning to the previous scope.{.notice--info}
