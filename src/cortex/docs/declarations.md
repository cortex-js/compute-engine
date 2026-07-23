---
title: Cortex Declarations
permalink: /cortex/declarations/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Declarations

A declaration introduces a symbol into the current scope. Cortex has two
declaration keywords:

- **`let`** declares a **mutable** symbol.
- **`const`** declares an **immutable** symbol.

```cortex
let x = 5
const c = 6.28
```

A type annotation also **implies** a declaration, even without a keyword:

```cortex
x: real = 5
```

is a declaration of `x` with type `real`, exactly as if it had been written
`let x: real = 5`. The keyword is only mandatory for an **untyped**
declaration — that's what distinguishes a declaration from a plain
reassignment (see below).

## Reassignment vs. declaration

A bare `x = 5` — no `let`/`const` keyword, no type annotation — is not
declaration syntax: it is an **assignment** and lowers to `Assign`:

```cortex
x = 5
```

```json
["Assign", "x", 5]
```

The Compute Engine permits `Assign` to establish a value for a previously
unbound symbol, but `let` is the explicit and idiomatic way to introduce a
mutable binding.

Reassigning a symbol that was declared `const` produces an
[error value](/cortex/evaluation/#errors-are-values), not a parse error or a
thrown exception:

```cortex
const c = 1
c = 2
```

`c = 2` still parses and lowers to `["Assign", "c", 2]`; it's the engine,
at evaluation time, that rejects the assignment and produces an `["Error",
…]` value.

## Encoding

Declarations lower to the engine's `Declare` operator — not a
Cortex-specific `Let`/`Const` head. `Declare` takes the declared symbol, an
optional type (positional, when present), and a trailing attributes
`Dictionary` carrying `value` and, for `const`, `constant: True`. `const` is
a **binding attribute** (`constant: True` → the engine's `isConstant`), not a
type — the engine, not Cortex, enforces it.

```cortex
let x = 5
```

```json
["Declare", "x", ["Dictionary", ["KeyValuePair", "value", 5]]]
```

The type is inferred (`integer`, here) when no annotation is given. With an
annotation, the type appears as a positional argument before the attributes
dictionary:

```cortex
let x: real = 5
```

```json
["Declare", "x", {"str": "real"},
  ["Dictionary", ["KeyValuePair", "value", 5]]]
```

A declaration with no initializer omits the attributes dictionary entirely:

```cortex
let x: real
```

```json
["Declare", "x", {"str": "real"}]
```

```cortex
let x
```

```json
["Declare", "x"]
```

`const` adds a `constant` key alongside `value`:

```cortex
const c = 6.28
```

```json
["Declare", "c", ["Dictionary", ["KeyValuePair", "value", 6.28], ["KeyValuePair", "constant", "True"]]]
```

Because declarations lower directly to the engine's own `Declare`
primitive, there is no separate Cortex-side declaration logic at execution
time — the program evaluates the `Declare` expression exactly like any other
expression.

## Scoping

Declarations live in the current scope. A program (a notebook cell or a
chain of cells sharing one engine scope) declares at the top level; a block
introduced by `if`/`else`/`while`/`for`, or a function body, pushes its own
lexical scope, so a `let`/`const` inside a block does not leak into the
enclosing scope.

`let` and `const` are the binding keywords. There is currently no compound
assignment (`+=`) or destructuring declaration.
