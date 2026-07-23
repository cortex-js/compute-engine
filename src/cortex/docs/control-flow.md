---
title: Cortex Control Flow
sidebar_label: Control Flow
slug: /cortex/control-flow/
description: "Cortex Control Flow"
hide_title: true
date: Last Modified
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
position (`function f(x) -> real { … }`). Parameter types are enforced when
the function is called. Return types are retained in the function signature;
the current runtime does not validate the inferred type of every returned
value against that annotation.

```cortex
f(x: real) = x + 1
```

```json
["Assign", "f",
  ["Function", ["Add", "x", 1], ["Typed", "x", {"str": "real"}]]]
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

A lambda can take **no** parameters — an empty parameter list `()` before the
arrow:

```cortex
() |-> 42
```

```json
["Function", 42]
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

## `match`

`match` is an **expression** that inspects the structure of a subject against
a sequence of `pattern => body` cases and evaluates to the body of the first
matching case:

```cortex
match x {
  0 => "zero"
  _ => "other"
}
```

```json
[
  "Match",
  "x",
  ["MatchCase", 0, {"str": "zero"}],
  ["MatchCase", "_", {"str": "other"}]
]
```

Unlike `if`/`Which`, `match` is **structural** and **total**: it always
selects a case, it never stays inert. A literal pattern (`0`) matches
structurally, and `_` is the anonymous wildcard, matching anything — with a
symbolic (unbound) `x` as the subject above, `match` selects the `_` case: `x`
is structurally not `0`, even though it *could* be zero semantically. Use
`if`/`Which` when you want that kind of semantic case-split instead.

### Bindings

A bare identifier in pattern position **binds** a new variable to the value
at that position — for *any* name, including ones that happen to name an
engine constant (`e`, `i`, `Pi`). A pattern is parsed as an ordinary
expression first, so this applies inside nested patterns too:

```cortex
match p {
  (x, e) => x + e
}
```

```json
["Match", "p", ["MatchCase", ["Tuple", "_x", "_e"], ["Add", "x", "e"]]]
```

Matching `(2, 7)` against this case binds `x` to `2` and `e` to `7` — the
body's `e` is the captured value, not `ExponentialE`. Because a bare binding
matches unconditionally, a *non-final* case consisting of just a binding (or
`_`) makes every case after it unreachable; this is flagged as a
`match-irrefutable-case` diagnostic (a final catch-all is expected and not
flagged):

```cortex
match x {
  Pi => 1
  0 => 2
}
```

This does **not** match the constant π — `Pi` in pattern position binds a new
variable named `Pi`, shadowing the constant, and the diagnostic is the safety
net for that: it fires because the `Pi => 1` case is non-final and matches
anything, not because `Pi` is a reserved name. To test against the value of
the constant, use a pin.

### Pins

`== expr` matches the subject against the **value** of `expr`, evaluated in
the enclosing scope — this is how to test a symbolic constant or a runtime
variable, since a bare identifier always binds instead:

```cortex
match x {
  == Pi => "is-pi"
  _ => "no"
}
```

```json
[
  "Match",
  "x",
  ["MatchCase", ["Pin", "Pi"], {"str": "is-pi"}],
  ["MatchCase", "_", {"str": "no"}]
]
```

```cortex
match x {
  == limit => 1
  _ => 0
}
```

```json
["Match", "x", ["MatchCase", ["Pin", "limit"], 1], ["MatchCase", "_", 0]]
```

The Cortex parser lowers **every** non-literal pinned expression to `Pin`,
whether it names a constant or a runtime variable — it cannot tell the two
apart lexically, and only `Pin` resolution looks up the value at match time.
A pin of a literal (`== 5`) drops the `Pin` head and matches structurally,
same as writing the literal directly; `Infinity`/`NaN` are numeric literals in
Cortex, so `== Infinity` is a literal pin too, with no binding trap to avoid.

### Or-alternatives

`p₁ | p₂ | …` at the **top level** of a case pattern matches if any
alternative matches; a guard, if present, applies after whichever alternative
matched:

```cortex
match x {
  1 | 2 | == Pi => "small"
  _ => "big"
}
```

```json
[
  "Match",
  "x",
  ["MatchCase", ["Alternatives", 1, 2, ["Pin", "Pi"]], {"str": "small"}],
  ["MatchCase", "_", {"str": "big"}]
]
```

Alternatives must be **binding-free** — `_` is fine (`[0, _] | [_, 0]`), but a
named binding inside an alternative (`a | 2 => …`) is a
`match-alternative-binding` diagnostic, since there is no single value for
the body to bind `a` to when the alternatives disagree on shape.

### Guards

`pattern if guard => body` adds a boolean condition, checked after the
pattern matches and after its bindings are in scope:

```cortex
match n {
  n if n > 3 => "big"
  _ => "small"
}
```

```json
[
  "Match",
  "n",
  ["MatchCase", "_n", ["Greater", "n", 3], {"str": "big"}],
  ["MatchCase", "_", {"str": "small"}]
]
```

If the guard is undecidable for a symbolic subject, the case falls through to
the next one — consistent with `match`'s totality, a guard never leaves the
whole expression inert.

### Destructuring

List, tuple, and dictionary patterns decompose the subject and bind their
elements:

```cortex
match xs {
  [first, ...rest] => first
}
```

```json
["Match", "xs", ["MatchCase", ["List", "_first", "___rest"], "first"]]
```

```cortex
match p {
  (x, y) => x
}
```

```json
["Match", "p", ["MatchCase", ["Tuple", "_x", "_y"], "x"]]
```

```cortex
match p {
  {x -> px, y -> py} => px + py
}
```

```json
[
  "Match",
  "p",
  [
    "MatchCase",
    [
      "Dictionary",
      ["KeyValuePair", {"str": "x"}, "_px"],
      ["KeyValuePair", {"str": "y"}, "_py"]
    ],
    ["Add", "px", "py"]
  ]
]
```

`...rest` (or bare `...`) captures the remaining elements of a list pattern;
at most one rest is allowed per pattern — a second one is a
`match-multiple-rest` diagnostic.

Dictionary pattern keys are literal (not patternized); the values are full
patterns — bindings, literals, pins, or nested shapes. Dictionary matching is
**open**: a case matches when the subject is a dictionary that has *at least*
the named keys, each with a matching value; extra subject keys are ignored. A
subject missing any named key falls through to the next case. So

```cortex
match {x -> 3, y -> 4, z -> 5} {
  {x -> px, y -> py} => px + py
  _ => 0
}
```

binds `px = 3` and `py = 4` (the extra `z` key is ignored) and evaluates to
`7`.

### Typed bindings

`name: type` binds like a bare identifier, plus an implicit type guard,
conjoined with any explicit guard:

```cortex
match n {
  n: integer if n > 0 => "positive integer"
  _ => "other"
}
```

```json
[
  "Match",
  "n",
  [
    "MatchCase",
    "_n",
    ["And", ["Element", "n", "integer"], ["Greater", "n", 0]],
    {"str": "positive integer"}
  ],
  ["MatchCase", "_", {"str": "other"}]
]
```

### Algebraic patterns

Because a pattern is parsed as an ordinary expression, matching on operator
structure comes for free — a pattern like `a + b` dispatches on the `Add`
operator and captures its operands, with the same commutative matching the
rule system already uses for `Add`/`Multiply`:

```cortex
match z {
  a + b if a > 0 => a
  _ => 0
}
```

```json
[
  "Match",
  "z",
  ["MatchCase", ["Add", "_a", "_b"], ["Greater", "a", 0], "a"],
  ["MatchCase", "_", 0]
]
```

This is symbolic destructuring, evaluated by the engine's general pattern
matcher — it works when evaluating a `match` expression, but such patterns
are not supported by `compile()`; compiling a `match` with an operator
pattern fails closed, naming the offending pattern in the error.

### No match

If no case matches, `match` evaluates to an `Error` value tagged
`'match-no-case'` carrying the subject, rather than throwing or silently
producing `Nothing` — errors are ordinary values in Cortex (see
[Evaluation](/cortex/evaluation/)):

```cortex
match 3 {
  0 => "zero"
}
```

```json
["Match", 3, ["MatchCase", 0, {"str": "zero"}]]
```

Evaluating this expression yields `Error("match-no-case", 3)`.

## Loops

There is one loop keyword form for each of the two common shapes, and both
lower to the engine's imperative `Loop` — evaluated **for effect**, not for
its value (a `Loop`'s value is `Nothing`). Value-producing iteration over a
collection belongs to the library functions `Map`/`Filter`/`Reduce`, not to
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
distinct from the `{ … }` **collection** grammar (set/dictionary literals).
A bare `{ … }` with no introducing keyword is always the
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

### `do { … }` block expressions

To use a statement block **in expression position** — where a bare `{ … }`
would be the collection grammar — prefix it with `do`. `do { … }` opens a
statement block usable anywhere an expression can appear: a lambda body, an
assignment right-hand side, a function argument. Its value is its last
statement, and it pushes its own lexical scope, exactly like a keyword-led
block:

```cortex
let y = do { let t = 3; t + 1 }
```

```json
["Declare", "y", ["Dictionary", ["KeyValuePair", "value",
  ["Block", ["Declare", "t", ["Dictionary", ["KeyValuePair", "value", 3]]],
    ["Add", "t", 1]]]]]
```

Because a lambda body is an ordinary expression, `x |-> do { … }` produces the
same `Function(Block(…), x)` shape a named `function` body does — so a closure
whose body runs several statements is written with `do`:

```cortex
counter |-> do { counter = counter + 1; counter }
```

A `do` **not** followed by `{` is an `opening-bracket-expected` diagnostic.

## `return` / `break` / `continue`

These three words are reserved but **not implemented**: Cortex's
expression-oriented style (an `if` is a value, a block's value is its last
expression) doesn't need an explicit `return` yet, and loops are for-effect
only. Using them produces a `reserved-word` diagnostic rather than the
control-transfer behavior their names suggest.

