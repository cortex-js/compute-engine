---
title: Cortex Declarations
sidebar_label: Declarations
slug: /cortex/declarations/
description: "Declare symbols in Cortex: let for mutable bindings, const for immutable ones, with optional type annotations and lexical scoping rules."
hide_title: true
date: Last Modified
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

## Destructuring declarations

A `let` or `const` may bind the components of a **tuple** in one statement:

```cortex
divmod(a, b) = (Floor(a / b), a % b)
let (q, r) = divmod(17, 5)
(q, r)
// ➔ (3, 2)
```

The pattern is a parenthesized list of **at least two** elements, each a bare
symbol, a `_` (which skips that position), or a nested tuple pattern:

```cortex
let ((a, b), _, c) = ((1, 2), 99, 5)
a + b + c
// ➔ 8
```

The pattern is **irrefutable in form** — no literals, pins, or guards (use
[`match`](/cortex/control-flow/) for conditional destructuring). The value is
evaluated once; it must be a tuple of the same shape, otherwise the
declaration yields an `incompatible-type` **error value** and binds nothing.
With `const`, every bound name is a constant. An initializer is required, and
a type annotation is not accepted on a pattern. Duplicate names anywhere in
one pattern are a diagnostic.

Destructuring lowers to the same `Declare` primitive with the pattern in the
name position: `["Declare", ["Tuple", "q", "r"], ["Dictionary",
["KeyValuePair", "value", …]]]`.

## Declaring a type

A third declaration keyword, `type`, introduces a **type** name rather than a
symbol — and, with it, a constructor of the same name:

```cortex
type point = tuple<x: number, y: number>
type alias pair = tuple<number, number>
let p = point(1, 2)
let a: pair = (1, 2)
```

`type` declares a new, distinct type; `type alias` declares another name for
an existing one, and takes a type-parameter clause if it needs one
(`type alias Pair<T> = tuple<T, T>`). Unlike `let` and `const`, `type` is not
a reserved word — only these statement shapes claim it. See
[Declaring a type](/cortex/types/#declaring-a-type) for the whole story.

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
assignment (`+=`); destructuring declarations (`let (x, y) = t`) are
described above.

