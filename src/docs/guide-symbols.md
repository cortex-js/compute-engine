---
title: Symbols
permalink: /compute-engine/guides/symbols/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
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
<script>
 const ce = new ComputeEngine.ComputeEngine()
</script>

**To change the value or domain of a symbol**, use the `value` and `domain`
properties of the symbol.

```js
const n = ce.box('n');
n.domain = 'Integer';
n.value = 5;
console.log("n:", n.domain.json, "=", n.value.json);
// ➔ n: Integer = 5
```


A symbol does not have to be declared before it can be used. A previously unknown
symbol has a domain of `ce.defaultDomain` and no value.

<code-playground layout="stack" show-line-numbers>
<div slot="javascript">
const n = ce.box('n');
n.domain = 'Integer';
n.value = 5;
console.log("n:", n.domain.json, "=", n.value.json);</div></code-playground>

Symbols are defined within a **scope**.

{% readmore "/compute-engine/guides/evaluate/#scopes" %}Read more about
<strong>scopes</strong> {% endreadmore %}

{% readmore "/compute-engine/guides/augmenting/" %} Read more about
<strong>adding definitions</strong> for symbols and functions {% endreadmore %}


## Bound Variables, Free Variables and Constants

If the definition of a symbol has a value, the symbol is said to be a **bound
variable** (value binding).

This is in opposition to **free variables** which are symbols that have no
value, and **constants** which are symbols that have a value that cannot be
altered.

**To get a list of all the symbols in an expression** use `expr.symbols`.

The property `expr.isFree` is `true` if a symbol is a free variable.

Assigning a value to a free variable makes it a bound variable.

**To get a list of all the free variables in an expression** use
`expr.freeVars`.

The property `expr.isConstant` is `true` if a symbol is a constant.

The value of constants may depend on settings of the compute engine. For
example, the value of `Pi` is determined based on the value of the `precision`
property. The values of constants in scope when the `precision` setting is
changed will be updated. {.notice-warning}

The property `expr.symbolDefinition` is not `undefined` if a symbol has a
definition (name binding).

[**Value binding**](https://en.wikipedia.org/wiki/Free_variables_and_bound_variables)
(associating a value with the definition of a symbol) should not be confused
with [**name binding**](https://en.wikipedia.org/wiki/Name_binding) (associating
a definition with the name of a symbol).{.notice--info}

{% readmore "/compute-engine/guides/evaluate/#binding" %} Read more about
<strong>name binding</strong> {% endreadmore %}

```js
ce.precision = 4;
const smallPi = ce.box('Pi'); // π with 4 digits
console.log(smallPi.latex);
// ➔ 3.1415

ce.precision = 10;
const bigPi = ce.box('Pi'); // π with 10 digits
console.log(bigPi.latex);
// ➔ 3.1415926535

ce.precision = 100; // Future computations will be done with 100 digits

console.log('pi = ', smallPi.numericValue, '=', bigPi.numericValue);
// ➔ pi  = 3.1415 = 3.1415926535
```


## Symbol Auto-binding

If `ce.defaultDomain` is not`null` and no definition exist for the symbol, a new
one is created automatically.

The new definition has a domain of `ce.defaultDomain` and no value associated
with it, so the symbol will be a **free variable**.

By default, `defaultDomain` is `"ExtendedRealNumber"` so any unknown variable is
automatically assumed to be a real number.

```js
const symbol = ce.box('m'); // m for mystery
console.log(symbol.domain.symbol);
// ➔ "ExtendedRealNumber"
symbol.value = 5;
console.log(symbol.numericValue);
// ➔ 5
```

If `ce.defaultDomain` is `null`, and no definition exist for the symbol, the
symbol is **unbound** (no name binding). This will limit the usefulness of the
symbol and the symbol will evaluate to an `["Error"]` expression.

## Forgetting a Symbol

**To _reset_ what is known about a symbol** use the `ce.forget()` function.

The `ce.forget()` function will remove the definition associated with a symbol,
including its domain and value, and any
[assumptions](/compute-engine/guides/assumptions) about the symbol.

**To forget about a specific symbol**, pass the name of the symbol as an argument to
`ce.forget()`.

**To forget about all the symbols in the current scope**, use `ce.forget()` without
any arguments.

Note that only symbols in the current scope are forgotten. If a definition for
the symbol existed in a previous scope, that definition will now be in
effect.{.notice--info}
