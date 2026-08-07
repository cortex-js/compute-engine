---
title: Epsil Control Flow
sidebar_label: Control Flow
slug: /epsil/control-flow/
description: "Control flow in Epsil: function definitions in math and block style, conditionals, pattern matching and loops, and the MathJSON each form lowers to."
hide_title: true
date: Last Modified
---
# Control Flow

## Functions

A function can be defined in two forms, both lowering to the same shape:
`["DefineFunction", name, ["Function", body, …params]]`.

The **math style** is a single expression:

```epsil
f(x) = x + 1
```

```json
["DefineFunction", "f", ["Function", ["Add", "x", 1], "x"]]
```

```epsil
f(x, y) = x + y
```

```json
["DefineFunction", "f", ["Function", ["Add", "x", "y"], "x", "y"]]
```

The **block style** wraps the body in a statement block, whose value is its
last expression:

```epsil
function f(x) { x + 1 }
```

```json
["DefineFunction", "f", ["Function", ["Block", ["Add", "x", 1]], "x"]]
```

Parameters can carry a type annotation (`f(x: real) = …`), and the block
form accepts a return-type annotation in the unambiguous post-parameter-list
position (`function f(x) -> real { … }`). Parameter types are enforced when
the function is called. Return types are retained in the function signature;
the current runtime does not validate the inferred type of every returned
value against that annotation.

```epsil
f(x: real) = x + 1
```

```json
["DefineFunction", "f",
  ["Function", ["Add", "x", 1], ["Typed", "x", {"str": "real"}]]]
```

### Effect specifiers

A definition can state the effects that calling it may perform. The specifier
sits after the parameter list and before the return arrow:

```epsil
function roll(n) random -> integer { Random(n) }
```

```json
["DefineFunction", "roll",
  ["Function",
    ["Typed", ["Block", ["Random", "n"]],
      {"str": "(n: unknown) random -> integer"}],
    "n"]]
```

The nine effect labels are `console`, `entropy`, `environment`, `fs_read`,
`fs_write`, `network`, `random`, `scope`, and `time`. Several labels may be
listed with spaces. `pure` explicitly promises no effects; `any` means the
effects are unknown. `pure` and `any` must appear alone.

Without a specifier, effects are inferred from the body and may change when
the definition is replaced. A written specifier is a contract: the body's
inferred effects must be a subset of it. A pure body may satisfy a broader
contract, but a body that performs an undeclared effect is rejected.

The block form may omit the return annotation (`function f() random { … }`),
in which case its declared result is `unknown`. In the math form, a written
effect specifier must be followed by a return arrow:

```epsil
roll(n) random -> integer = Random(n)
```

See [Effect Specifiers](/compute-engine/guides/types/#effect-specifiers) for
subtyping, callback checks, and the distinction between inferred and declared
effects.

### Multiple clauses (literal parameters)

A parameter can be a **literal** — a number, string, boolean, `Infinity`,
`-Infinity`, or `NaN` (the spellings that are literals in expression
position; `oo` is an input alias for `Infinity`. A constant *name* like
`Pi` is a symbol and stays a parameter name — writing `f(Pi) = …` binds a
parameter named `Pi` and draws an advisory `parameter-shadows-constant`
diagnostic). Definition statements **accumulate**: defining the same name again
with a different parameter list adds a *clause* rather than replacing the
function, and a call dispatches to the most specific clause that matches
its arguments (declaration order only breaks ties between equally specific
clauses). A non-finite literal clause matches only itself — `f(NaN) = 0`
handles exactly `NaN`; a `f(x: real)` clause never captures it:

```epsil
f(NaN) = 0
f(Infinity) = 1
f(x: number) = x + 1
f(Infinity) + f(NaN)
// ➔ 1
```

```epsil
fib(0) = 0
fib(1) = 1
fib(n: integer) = fib(n - 1) + fib(n - 2)
fib(10)
// ➔ 55
```

Redefining a clause with the *same* parameter list replaces just that
clause — so re-running an edited definition behaves as expected. A plain
assignment (`f = x |-> …`) still replaces the whole binding, clauses and
all.

A literal parameter lowers to an anonymous parameter constrained to that
exact value (a *value type*):

```json
["DefineFunction", "fib",
  ["Function", 0, ["Typed", "literalParam_1", {"str": "0"}]]]
```

If no clause matches the evaluated arguments, the call is a
`no-matching-clause` error. To inspect the clause set of a function, use
`About`:

```epsil
f(0) = 1
f(n: integer) = n + 1
About(f)
```

The listing shows one line per clause, in declaration order, and annotates
clauses that overlap an earlier one of equal specificity as well as clauses
made unreachable by more specific ones covering their whole (finite)
domain.

### Anonymous functions

An anonymous function uses the ASCII mapsto arrow `|->` (the engine's `↦`);
`->` itself is taken by `KeyValuePair`, so this is a collision-free choice:

```epsil
x |-> x + 1
```

```json
["Function", ["Add", "x", 1], "x"]
```

```epsil
(x, y) |-> x + y
```

```json
["Function", ["Add", "x", "y"], "x", "y"]
```

A mapsto binds loosely enough to sit on the right-hand side of an
assignment:

```epsil
f = x |-> x + 1
```

```json
["Assign", "f", ["Function", ["Add", "x", 1], "x"]]
```

A lambda can take **no** parameters — an empty parameter list `()` before the
arrow:

```epsil
() |-> 42
```

```json
["Function", 42]
```

## `if` / `else`

`if`/`else` is an **expression**, not a statement — it evaluates to a value:

```epsil
if x > 0 { 1 } else { 2 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1], ["Block", 2]]
```

The `else` branch is optional:

```epsil
if x > 0 { 1 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1]]
```

`else if` chains nest into an `If` in `else` position:

```epsil
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

### The conditional expression `a if c else b`

When both branches are single expressions, the braces are noise. The
conditional form spells the same `If` without them:

```epsil
let x = 5
10 if x > 3 else 20
// ➔ 10
```

```json
["If", ["Greater", "x", 3], 10, 20]
```

It is the *same* `If` — only the branches differ: plain expressions instead of
`Block`s, so the conditional introduces no scope and no statement can appear in
a branch.

Three rules follow from where it sits in the grammar:

**The `else` is required.** It is what ends the condition, and a missing branch
would leave the false case with no value to name. `1 if c` is an error; use the
block form (`if c { 1 }`) when there is nothing to return.

**It binds looser than every operator that computes, but tighter than the four
that bind or pair — `=`, `|->`, `|>` and `->`.** So the whole conditional is the
right-hand side of an assignment, the body of a function, or the value of a
dictionary entry, and no parentheses are needed around a comparison:

```epsil
let scale = 2
let tag = n |-> "big" if n * scale > 10 else "small"
tag(6)
// ➔ "big"
```

```epsil
let n = 7
{ "value" -> n, "parity" -> "odd" if n % 2 == 1 else "even" }
// ➔ {"value" -> 7, "parity" -> "odd"}
```

Going the other way — a conditional used as an operand — does need
parentheses, since `1 if c else 2 + 3` reads as `1 if c else (2 + 3)`:

```epsil
(10 if 3 > 0 else 20) + 5
// ➔ 15
```

**Chains nest to the right,** so there is no `else if` spelling to learn:

```epsil
let n = 0
"zero" if n == 0 else "negative" if n < 0 else "positive"
// ➔ "zero"
```

One layout rule: the `if` must be on the **same line** as the value before it.
A line break separates statements, so an `if` that starts a line always begins
a new `if`-statement, never a continuation of the line above.

## `match`

`match` is an **expression** that inspects the structure of a subject against
a sequence of `pattern => body` cases and evaluates to the body of the first
matching case:

```epsil
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

```epsil
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

<!-- epsil-test: expect-diagnostics -->

```epsil
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

```epsil
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

```epsil
match x {
  == limit => 1
  _ => 0
}
```

```json
["Match", "x", ["MatchCase", ["Pin", "limit"], 1], ["MatchCase", "_", 0]]
```

The Epsil parser lowers **every** non-literal pinned expression to `Pin`,
whether it names a constant or a runtime variable — it cannot tell the two
apart lexically, and only `Pin` resolution looks up the value at match time.
A pin of a literal (`== 5`) drops the `Pin` head and matches structurally,
same as writing the literal directly; `Infinity`/`NaN` are numeric literals in
Epsil, so `== Infinity` is a literal pin too, with no binding trap to avoid.

### Or-alternatives

`p₁ | p₂ | …` at the **top level** of a case pattern matches if any
alternative matches; a guard, if present, applies after whichever alternative
matched:

```epsil
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

### Range patterns

`lo..hi` in pattern position is an **inclusive numeric membership test**: the
case is selected when the subject is a real number and `lo ≤ subject ≤ hi`.
The call spelling `Range(lo, hi)` means exactly the same thing — the pattern
form keys on the operator, not on how it was written:

```epsil
match x {
  0..9 => "digit"
  10..99 => "two digits"
  _ => "big"
}
```

```json
[
  "Match",
  "x",
  ["MatchCase", ["Range", 0, 9], {"str": "digit"}],
  ["MatchCase", ["Range", 10, 99], {"str": "two digits"}],
  ["MatchCase", "_", {"str": "big"}]
]
```

Both endpoints are included, and they are compared with the same tolerance
`match` uses for every other number leaf, so a subject a hair outside an
endpoint still selects the case. Only a **number** matches: a symbol, a
collection, a string, a complex number and `NaN` all fall through to the next
case.

Bounds must be **numeric literals** — negated literals and `Infinity` /
`-Infinity` included, so `0..Infinity` reads as "any nonnegative number":

```epsil
match x {
  0..Infinity => "nonnegative"
  _ => "negative"
}
```

```json
[
  "Match",
  "x",
  ["MatchCase", ["Range", 0, "PositiveInfinity"], {"str": "nonnegative"}],
  ["MatchCase", "_", {"str": "negative"}]
]
```

A bound that is a bare identifier (which would otherwise *bind*, like any
identifier in pattern position), a computed expression, or `NaN` is a
`range-pattern-bounds` diagnostic; a stepped range is a `range-pattern-step`
diagnostic; and a range whose lower bound exceeds its upper bound is a
`range-pattern-empty` diagnostic (that case can never match). Use a guard when
a bound is not a literal:

<!-- epsil-test: expect-diagnostics -->

```epsil
match x {
  0..limit => "in"
  _ => "out"
}
```

Write instead:

```epsil
match x {
  n if n >= 0 && n <= limit => "in"
  _ => "out"
}
```

A range pattern binds nothing, so it is legal inside an or-alternative, and a
guard on a range case can only reference names from the enclosing scope:

```epsil
match x {
  0..9 | 100..109 => "in"
  _ => "out"
}
```

```json
[
  "Match",
  "x",
  [
    "MatchCase",
    ["Alternatives", ["Range", 0, 9], ["Range", 100, 109]],
    {"str": "in"}
  ],
  ["MatchCase", "_", {"str": "out"}]
]
```

Two consequences worth knowing. First, this is a **carve-out**: a `Range`
*value* can no longer be matched structurally in pattern position — write
`== Range(1, 10)` (a pin) to compare against the range value itself. Second,
a range nested inside a list, tuple or dictionary pattern keeps its ordinary
structural meaning; membership applies at the top level of a case pattern (or
of an or-alternative). A `Range` whose bounds are not literals is likewise
still an ordinary structural pattern.

Because a run of operator characters lexes as one token, a **negative upper
bound needs a space**: write `0 .. -1`, not `0..-1` (the same maximal-munch
rule that makes `3! ^ 2` require its space). The formatter always spaces `..`
in pattern position for this reason.

### Guards

`pattern if guard => body` adds a boolean condition, checked after the
pattern matches and after its bindings are in scope:

```epsil
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

```epsil
match xs {
  [first, ...rest] => first
}
```

```json
["Match", "xs", ["MatchCase", ["List", "_first", "___rest"], "first"]]
```

```epsil
match p {
  (x, y) => x
}
```

```json
["Match", "p", ["MatchCase", ["Tuple", "_x", "_y"], "x"]]
```

```epsil
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

```epsil
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

```epsil
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

```epsil
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
producing `Nothing` — errors are ordinary values in Epsil (see
[Evaluation](/epsil/evaluation/)):

```epsil
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

```epsil
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

```epsil
for x in xs { x }
```

```json
["Loop", ["Block", "x"], ["Element", "x", "xs"]]
```

`in` is contextual: only the loop-variable `in` introduces the iterator
clause. A second, later `in` in the collection expression is still the
ordinary `Element` infix operator:

```epsil
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

```epsil
{ 1, 2 }
```

```json
["Set", 1, 2]
```

Each block pushes its own lexical scope. A block's value is its last
expression; an empty block's value is `Nothing`:

```epsil
if a { }
```

```json
["If", "a", ["Block"]]
```

Statements inside a block are separated the same way as top-level
statements — a linebreak or a `;`:

```epsil
if a { 1; 2; 3 }
```

```json
["If", "a", ["Block", 1, 2, 3]]
```

Blocks nest freely:

```epsil
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

```epsil
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

```epsil
counter |-> do { counter = counter + 1; counter }
```

A `do` **not** followed by `{` is an `opening-bracket-expected` diagnostic.

## `break` and `continue`

`break` leaves the innermost enclosing loop; `continue` skips to its next
iteration. Both lower to the engine's `Break()` / `Continue()` primitives.

```epsil
for x in [1, 2, 3, 4] {
  if x > 3 { break }
  if x == 2 { continue }
  f(x)
}
```

They are valid anywhere inside a loop body — directly, or nested in an `if`, a
`match` case, or a `do` block:

```epsil
for x in xs {
  match x {
    0 => continue
    _ => f(x)
  }
}
```

Outside a loop they are a `control-outside-loop` diagnostic:

<!-- epsil-test: expect-diagnostics -->

```epsil
if x > 1 { break }
```

The loop context **resets at every function and lambda boundary**. A `break`
written inside a function or lambda defined in a loop body does not target
that loop — it is outside a loop, and diagnosed:

<!-- epsil-test: expect-diagnostics -->

```epsil
for x in xs {
  function h() { break }
}
```

This boundary is not a style rule. The engine's `Block` short-circuits on
`Break`/`Continue` structurally, so a `Break` returned out of a lambda body
would otherwise transfer control to whatever loop happened to be running.

Only the value-less forms are surface syntax. The engine's `Break(v)` — which
makes the loop evaluate to `v` — has no Epsil spelling yet; it is bundled with
the ruling on a general `return`.

Serialized back from MathJSON, they appear in their call form (`Break()`,
`Continue()`), like the `Loop` they belong to.

## `return`

`return` is **not implemented**: Epsil's expression-oriented style (an `if` is
a value, a block's value is its last expression) doesn't need an explicit
`return` yet. It is listed among the words the language reserves the right to
claim later, but nothing claims it today — so `return` is an ordinary
identifier and carries no control-flow meaning at all, rather than producing a
diagnostic. Prefer not to use it as a name.
