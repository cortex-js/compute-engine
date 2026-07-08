---
title: Cortex Control Flow
permalink: /cortex/control-flow/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Control Flow

## Functions

A function can be defined in two forms, both lowering to the same shape:
`["Assign", name, ["Function", body, …params]]`.

The **math style** is a single expression:

```cortex
f(x) = x + 1
```

```json
["Assign", "f", ["Function", ["Add", "x", 1], "x"]]
```

```cortex
f(x, y) = x + y
```

```json
["Assign", "f", ["Function", ["Add", "x", "y"], "x", "y"]]
```

The **block style** wraps the body in a statement block, whose value is its
last expression:

```cortex
function f(x) { x + 1 }
```

```json
["Assign", "f", ["Function", ["Block", ["Add", "x", 1]], "x"]]
```

Parameters can carry a type annotation (`f(x: real) = …`), and the block
form accepts a return-type annotation in the unambiguous post-parameter-list
position (`function f(x) -> real { … }`). **v0 limitation**: both are parsed
but not enforced — the type is currently dropped rather than compiled into
the `Function` or checked at call time:

```cortex
f(x: real) = x + 1
```

```json
["Assign", "f", ["Function", ["Add", "x", 1], "x"]]
```

### Anonymous functions

An anonymous function uses the ASCII mapsto arrow `|->` (the engine's `↦`);
`->` itself is taken by `KeyValuePair`, so this is a collision-free choice:

```cortex
x |-> x + 1
```

```json
["Function", ["Add", "x", 1], "x"]
```

```cortex
(x, y) |-> x + y
```

```json
["Function", ["Add", "x", "y"], "x", "y"]
```

A mapsto binds loosely enough to sit on the right-hand side of an
assignment:

```cortex
f = x |-> x + 1
```

```json
["Assign", "f", ["Function", ["Add", "x", 1], "x"]]
```

## `if` / `else`

`if`/`else` is an **expression**, not a statement — it evaluates to a value:

```cortex
if x > 0 { 1 } else { 2 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1], ["Block", 2]]
```

The `else` branch is optional:

```cortex
if x > 0 { 1 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1]]
```

`else if` chains nest into an `If` in `else` position:

```cortex
if x > 0 { 1 } else if x < 0 { 2 } else { 3 }
```

```json
[
  "If",
  ["Greater", "x", 0],
  ["Block", 1],
  ["If", ["Less", "x", 0], ["Block", 2], ["Block", 3]]
]
```

A `{ }` block's value is its last expression — the same `Block` semantics
as a multi-statement program (see [Blocks](#blocks) below).

## Loops

There is one loop keyword form for each of the two common shapes, and both
lower to the engine's imperative `Loop` — evaluated **for effect**, not for
its value (a `Loop`'s value is `Nothing`). Value-producing iteration over a
collection belongs to the library functions `map`/`filter`/`reduce`, not to
a loop statement.

`while cond { … }` lowers to a `Loop` over a `Block` whose first statement
breaks out when the condition becomes false:

```cortex
while x > 0 { x }
```

```json
[
  "Loop",
  ["Block", ["If", ["Not", ["Greater", "x", 0]], ["Break"]], ["Block", "x"]]
]
```

`for x in xs { … }` lowers to `["Loop", body, ["Element", "x", "xs"]]` — the
loop variable's `in` is the engine's `Element` operator, doubling as the
iterator clause:

```cortex
for x in xs { x }
```

```json
["Loop", ["Block", "x"], ["Element", "x", "xs"]]
```

`in` is contextual: only the loop-variable `in` introduces the iterator
clause. A second, later `in` in the collection expression is still the
ordinary `Element` infix operator:

```cortex
for x in a in b { x }
```

```json
["Loop", ["Block", "x"], ["Element", "x", ["Element", "a", "b"]]]
```

## Blocks

A `{ … }` that immediately follows a keyword (`function`/`if`/`else`/
`while`/`for`) is a **statement block** — the engine's `Block` — and is
distinct from the Phase 2 `{ … }` **collection** grammar (set/dictionary
literals). A bare `{ … }` with no introducing keyword is always the
collection grammar:

```cortex
{ 1, 2 }
```

```json
["Set", 1, 2]
```

Each block pushes its own lexical scope. A block's value is its last
expression; an empty block's value is `Nothing`:

```cortex
if a { }
```

```json
["If", "a", ["Block"]]
```

Statements inside a block are separated the same way as top-level
statements — a linebreak or a `;`:

```cortex
if a { 1; 2; 3 }
```

```json
["If", "a", ["Block", 1, 2, 3]]
```

Blocks nest freely:

```cortex
if a { if b { 1 } }
```

```json
["If", "a", ["Block", ["If", "b", ["Block", 1]]]]
```

## `return` / `break` / `continue`

These three words are reserved but **not implemented** in v0: Cortex's
expression-oriented style (an `if` is a value, a block's value is its last
expression) doesn't need an explicit `return` yet, and loops are for-effect
only. Using them produces a `reserved-word` diagnostic rather than the
control-transfer behavior their names suggest.
