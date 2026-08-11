---
title: Inside Epsil
sidebar_label: Implementation
slug: /epsil/implementation/
description: "How Epsil is implemented: the parse/execute/serialize API, the MathJSON each language form lowers to, round-trip normalizations, and how Epsil differs from the loose math parser."
hide_title: true
date: Last Modified
---
# Inside Epsil

This page is about **how Epsil is implemented**. Nothing here is needed to
write Epsil — the rest of the documentation describes the language on its own
terms. Read this page if you are embedding Epsil in a host application,
building tooling over it, or curious about what a construct actually does
underneath.

Epsil is a surface syntax over [MathJSON](/math-json/), and its runtime is the
[Compute Engine](/compute-engine/). A program is parsed into a MathJSON
expression, and that expression is evaluated by the engine. There is no
separate Epsil interpreter, no Epsil-specific declaration logic, and no
Epsil-side type checker — each language form maps onto a primitive the engine
already has.

## The JavaScript API

The public language entry point exposes the three stages directly:

```js
import {
  ComputeEngine,
  executeEpsil,
  parseEpsil,
  serializeEpsil,
} from "@cortex-js/compute-engine/epsil";
```

### Parsing

`parseEpsil(source, url?, options?)` returns a MathJSON expression and an
array of diagnostics:

```js
const [expression, diagnostics] = parseEpsil("2x + 1");
```

Ignoring source-location metadata, the expression is:

```json
["Add", ["Multiply", 2, "x"], 1]
```

The parser recovers from most syntax errors and returns a partial expression
alongside its diagnostics. Every parsed node also carries source offsets so a
host can associate a diagnostic or expression with the original text.

### Execution

`executeEpsil(ce, source, options?)` parses a program and evaluates its
top-level statements sequentially in the current scope of `ce`:

```js
const ce = new ComputeEngine();

const first = executeEpsil(ce, "let x = 5");
const second = executeEpsil(ce, "x = x + 1\nx");
// second.value.re === 6
```

Reusing the engine preserves declarations between calls, which is the
notebook/REPL execution model. A fresh `ComputeEngine` starts a fresh session.
The returned object contains the last statement's boxed value and all
diagnostics. Runtime failures are represented as error values rather than
escaping to the host as ordinary exceptions.

To enable `$…$` LaTeX islands, inject the engine's LaTeX parser:

```js
const parseLatex = (latex) => ce.parse(latex).json;
const result = executeEpsil(ce, "2 * $\\frac{1}{2}$", { parseLatex });
```

Host-state pragmas remain disabled unless
`allowHostPragmas: true` is explicitly supplied. Pragma values are computed by
the parser and inserted into the produced MathJSON before execution begins.

A host can give an evaluation an explicit time budget by wrapping it in the
engine's `withTimeLimit()` span:

```ts
const result = ce.withTimeLimit(
  { ms: 500, label: "epsil-cell" },
  () => executeEpsil(ce, source, { parseLatex })
);
```

See [Evaluation](/epsil/evaluation/#interruptibility) for the rest of the
cancellation model.

### Serialization

`serializeEpsil(expression, options?)` converts MathJSON back to Epsil:

```js
serializeEpsil(["Add", ["Multiply", 2, "x"], 1]);
// ➔ "2 * x + 1"
```

The serializer formats an expression; it does not execute it. Comments are
currently lossy on the parse side, so parsing and then serializing source code
does not preserve comments or the author's original whitespace. The serializer
can still *emit* a `/* … */` comment when an expression carries a `comment`
metadata field, but nothing on the parse side populates that field.

## How Epsil lowers to MathJSON

The examples in this section omit the `sourceOffsets` metadata that every
parsed node carries.

### Heads at a glance

| Epsil form | MathJSON |
| :--------- | :------- |
| `let x = 5`, `const c = 1`, `x: real = 5` | `Declare` |
| `x = 5`, `(a, b) := t` | `Assign` |
| `type p = …`, `type alias q = …` | `DeclareType` |
| `f(x) = …`, `function f(x) { … }` | `DefineFunction` + `Function` |
| `x \|-> …` | `Function` |
| `x: real` (annotation on a parameter or body) | `Typed` |
| `if c { … } else { … }`, `a if c else b` | `If` |
| `match s { p => b }` | `Match` + `MatchCase` |
| `== e` in a pattern | `Pin` |
| `p₁ \| p₂` in a pattern | `Alternatives` |
| `while`, `for … in …` | `Loop` |
| `break`, `continue` | `Break()`, `Continue()` |
| `{ … }` after a keyword, `do { … }`, a multi-statement program | `Block` |
| `[a, b]` | `List` |
| `{a, b}` | `Set` |
| `(a, b)` | `Tuple` |
| `{k -> v}` | `Dictionary` + `KeyValuePair` |
| `a -> b` | `KeyValuePair` |
| `a..b` | `Range` |
| `f(x)` (bare symbol callee) | `["f", "x"]` |
| `(expr)(x)` (computed callee) | `Apply` |
| `xs[i]` | `At` |
| `p.x` | `Field` |
| `...p` | `Spread` |
| `a \|> b` | `Pipe` |
| `x in xs`, `x is real` | `Element` |
| `"a\(b)c"` | `String` |
| `Sequence(1, 2, 3)` | `Sequence` |

Note that `MapsTo` — the name the operator table uses for `|->` — is internal
to parsing. The resulting expression uses `Function`, not a `MapsTo` head.
Likewise, `is` and `in` produce the same `Element` expression, which is why a
serialized program spells both of them `in`.

### Declarations

Declarations lower to the engine's `Declare` operator — not an Epsil-specific
`Let`/`Const` head. `Declare` takes the declared symbol, an optional type
(positional, when present), and a trailing attributes `Dictionary` carrying
`value` and, for `const`, `constant: True`. `const` is a **binding attribute**
(`constant: True` → the engine's `isConstant`), not a type — the engine, not
Epsil, enforces it.

```epsil
let x = 5
```

```json
["Declare", "x", ["Dictionary", ["KeyValuePair", "value", 5]]]
```

The type is inferred (`integer`, here) when no annotation is given. With an
annotation, the type appears as a positional argument before the attributes
dictionary:

```epsil
let x: real = 5
```

```json
["Declare", "x", {"str": "real"},
  ["Dictionary", ["KeyValuePair", "value", 5]]]
```

A declaration with no initializer omits the attributes dictionary entirely:

```epsil
let x: real
```

```json
["Declare", "x", {"str": "real"}]
```

```epsil
let x
```

```json
["Declare", "x"]
```

`const` adds a `constant` key alongside `value`:

```epsil
const c = 6.28
```

```json
["Declare", "c",
  ["Dictionary", ["KeyValuePair", "value", 6.28],
    ["KeyValuePair", "constant", "True"]]]
```

A **named literal function-type annotation binds the initializer's
parameters** (the "lambda lift" — see
[Declarations](/epsil/declarations/#function-type-annotations-bind-their-parameter-names)):
before lowering, the parser wraps a non-lambda initializer in a `Function`
whose parameters come from the annotation, so the declared value is exactly
what the explicit `|->` spelling produces:

```epsil
const f : (x: number) -> number = x + 1
```

```json
["Declare", "f", {"str": "(x: number) -> number"},
  ["Dictionary",
    ["KeyValuePair", "value", ["Function", ["Add", "x", 1], "x"]],
    ["KeyValuePair", "constant", "True"]]]
```

Because declarations lower directly to the engine's own `Declare` primitive,
there is no separate Epsil-side declaration logic at execution time — the
program evaluates the `Declare` expression exactly like any other expression.

A destructuring declaration uses the same primitive with the pattern in the
name position:

```epsil
let (q, r) = divmod(17, 5)
```

```json
["Declare", ["Tuple", "q", "r"],
  ["Dictionary", ["KeyValuePair", "value", ["divmod", 17, 5]]]]
```

### Assignment

A bare `x = 5` — no `let`/`const` keyword, no type annotation — lowers to
`Assign`:

```epsil
x = 5
```

```json
["Assign", "x", 5]
```

The Compute Engine permits `Assign` to establish a value for a previously
unbound symbol, which is why a bare assignment to an undeclared name works at
all; `let` is nevertheless the explicit and idiomatic way to introduce a
mutable binding.

Reassigning a `const` still parses and lowers to `["Assign", "c", 2]`; it is
the engine, at evaluation time, that rejects the assignment and produces an
`["Error", …]` value.

Destructuring assignment puts the pattern in the target position:

```epsil
(a, b) := (b, a)
```

```json
["Assign", ["Tuple", "a", "b"], ["Tuple", "b", "a"]]
```

### Type annotations

The parser holds a type annotation as a MathJSON string, which the engine
parses with its own type language. Type checking is not a separate Epsil-side
pass — it happens at canonicalization/evaluation time, the same way it does for
any other declared symbol.

```epsil
xs: list<integer>
```

```json
["Declare", "xs", {"str": "list<integer>"}]
```

```epsil
f: (real) -> real
```

```json
["Declare", "f", {"str": "(real) -> real"}]
```

`<`, `>`, `|`, `&`, and `->` inside the annotation are consumed entirely by the
type subparser — `u: integer | boolean` holds the whole `"integer | boolean"`
string, and none of those tokens are visible to (or reinterpreted by) the
surrounding expression grammar.

Typed parameters and typed bodies are represented with `Typed` nodes:

```epsil
f(x: integer) -> real = x + 1
```

```json
["DefineFunction", "f",
  ["Function",
    ["Typed", ["Add", "x", 1], {"str": "real"}],
    ["Typed", "x", {"str": "integer"}]]]
```

### Type declarations

A `type` statement lowers to the engine's `DeclareType` operator — the
MathJSON mirror of `ce.declareType()`. Types are global, so the statement is
only legal at the top level of a program: the parser rejects a nested one
(`type-declaration-not-top-level`), and the engine's `DeclareType` handler
enforces the same rule for MathJSON built directly. The body is carried as
the source text of the type. The bare form has no attributes; the `alias`
form adds an attributes dictionary with `alias -> True`:

```epsil
type point = tuple<x: number, y: number>
```

```json
["DeclareType", "point", {"str": "tuple<x: number, y: number>"}]
```

```epsil
type alias pair = tuple<number, number>
```

```json
["DeclareType", "pair", {"str": "tuple<number, number>"},
  ["Dictionary", ["KeyValuePair", "alias", "True"]]]
```

A type-parameter clause rides the same dictionary, as the text of the
clause:

```epsil
type alias Pair<T> = tuple<T, T>
```

```json
["DeclareType", "Pair", {"str": "tuple<T, T>"},
  ["Dictionary", ["KeyValuePair", "alias", "True"],
    ["KeyValuePair", "typeParams", {"str": "T"}]]]
```

The clause is carried **without** its enclosing `<`/`>`, and a variance
marker is simply part of that text — the bare form needs no other change:

```epsil
type tree<out T> = tuple<value: T, children: list<tree<T>>>
```

```json
["DeclareType", "tree", {"str": "tuple<value: T, children: list<tree<T>>>"},
  ["Dictionary", ["KeyValuePair", "typeParams", {"str": "out T"}]]]
```

A type is registered when its statement is canonicalized, which is why the
statements after it — in the same program or in a later cell — can annotate
with it. A type declared by the host with `ce.declareType()` is visible to a
program the same way, constructor and all.

### Functions

Both definition forms lower to the same shape,
`["DefineFunction", name, ["Function", body, …params]]`. The math style has a
bare expression body:

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

The block style wraps the body in a `Block`:

```epsil
function f(x) { x + 1 }
```

```json
["DefineFunction", "f", ["Function", ["Block", ["Add", "x", 1]], "x"]]
```

A parameter annotation becomes a `Typed` parameter:

```epsil
f(x: real) = x + 1
```

```json
["DefineFunction", "f",
  ["Function", ["Add", "x", 1], ["Typed", "x", {"str": "real"}]]]
```

An effect specifier is folded into a full function-type string carried by a
`Typed` node around the body:

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

A [literal parameter](/epsil/control-flow/#multiple-clauses-literal-parameters)
becomes an anonymous parameter constrained to that exact value (a *value
type*):

```epsil
fib(0) = 0
```

```json
["DefineFunction", "fib",
  ["Function", 0, ["Typed", "literalParam_1", {"str": "0"}]]]
```

### Anonymous functions

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

Because a mapsto binds loosely enough to sit on the right-hand side of an
assignment, `f = x |-> x + 1` is an `Assign` of a `Function`, not a
`DefineFunction`:

```epsil
f = x |-> x + 1
```

```json
["Assign", "f", ["Function", ["Add", "x", 1], "x"]]
```

A zero-parameter lambda is a `Function` with only a body:

```epsil
() |-> 42
```

```json
["Function", 42]
```

### Conditionals

Both conditional spellings produce the same `If`. The block form wraps each
branch in a `Block`; the `a if c else b` form uses plain expressions, which is
exactly why it introduces no scope:

```epsil
if x > 0 { 1 } else { 2 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1], ["Block", 2]]
```

```epsil
if x > 0 { 1 }
```

```json
["If", ["Greater", "x", 0], ["Block", 1]]
```

```epsil
10 if x > 3 else 20
```

```json
["If", ["Greater", "x", 3], 10, 20]
```

An `else if` chain — and, identically, a chained conditional expression —
nests into an `If` in `else` position:

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

### `match`

A `match` is a `Match` head over the subject followed by one `MatchCase` per
case. A `MatchCase` holds a pattern, an optional guard, and a body:

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

A binding is written as a wildcard-prefixed symbol (`_x`), which is the
engine's pattern-matcher spelling for a capture; a rest binding uses the
triple prefix (`___rest`):

```epsil
match p {
  (x, e) => x + e
}
```

```json
["Match", "p", ["MatchCase", ["Tuple", "_x", "_e"], ["Add", "x", "e"]]]
```

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

A pin becomes a `Pin` node. The parser lowers **every** non-literal pinned
expression to `Pin`, whether it names a constant or a runtime variable — it
cannot tell the two apart lexically, and only `Pin` resolution looks up the
value at match time. A pin of a literal drops the `Pin` head and matches
structurally:

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

Or-alternatives become `Alternatives`, and a range pattern reuses the ordinary
`Range` head — the pattern form keys on the operator, not on how it was
written, which is why `Range(lo, hi)` and `lo..hi` mean the same thing in
pattern position:

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

`Infinity` and `-Infinity` bounds lower to the engine's infinity symbols:

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

A guard occupies the optional middle slot of a `MatchCase`:

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

A typed binding compiles its type test into that same guard slot, conjoined
with any explicit guard:

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

Because a pattern is parsed as an ordinary expression, an algebraic pattern is
just the corresponding operator with captures as operands, matched by the
engine's general pattern matcher (with the commutative matching it already uses
for `Add`/`Multiply`):

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

Such patterns work when evaluating a `match`, but are not supported by
`compile()`; compiling a `match` with an operator pattern fails closed, naming
the offending pattern in the error.

When no case matches, evaluation produces `Error("match-no-case", subject)`.

### Loops and control transfer

Both loop forms lower to the engine's imperative `Loop`. `while` becomes a
`Loop` over a `Block` whose first statement breaks out when the condition
becomes false:

```epsil
while x > 0 { x }
```

```json
[
  "Loop",
  ["Block", ["If", ["Not", ["Greater", "x", 0]], ["Break"]], ["Block", "x"]]
]
```

`for x in xs { … }` puts the iteration clause in a second operand, using the
engine's `Element` operator as the iterator clause:

```epsil
for x in xs { x }
```

```json
["Loop", ["Block", "x"], ["Element", "x", "xs"]]
```

Only the loop-variable `in` introduces that clause. A second, later `in` in the
collection expression is still the ordinary `Element` infix operator:

```epsil
for x in a in b { x }
```

```json
["Loop", ["Block", "x"], ["Element", "x", ["Element", "a", "b"]]]
```

`break` and `continue` lower to the engine's `Break()` / `Continue()`
primitives, and serialize back in that call form. The rule that a `break` may
not cross a function or lambda boundary is not a style choice: the engine's
`Block` short-circuits on `Break`/`Continue` structurally, so a `Break`
returned out of a lambda body would otherwise transfer control to whatever loop
happened to be running. The engine's `Break(v)` — which makes the loop evaluate
to `v` — has no Epsil spelling yet.

### Blocks and programs

A statement block is the engine's `Block`. A multi-statement program is wrapped
in one; a program consisting of a single statement is returned unwrapped:

```epsil
a
2
```

```json
["Block", "a", 2]
```

```epsil
a; 2
```

```json
["Block", "a", 2]
```

A `{ … }` that follows a keyword is a `Block`, while a bare `{ … }` is the
collection grammar:

```epsil
{ 1, 2 }
```

```json
["Set", 1, 2]
```

```epsil
if a { }
```

```json
["If", "a", ["Block"]]
```

```epsil
if a { if b { 1 } }
```

```json
["If", "a", ["Block", ["If", "b", ["Block", 1]]]]
```

`do { … }` produces the same `Block` in expression position, so a `let` bound
to a `do` block nests a `Block` inside the declaration's `value`:

```epsil
let y = do { let t = 3; t + 1 }
```

```json
["Declare", "y", ["Dictionary", ["KeyValuePair", "value",
  ["Block", ["Declare", "t", ["Dictionary", ["KeyValuePair", "value", 3]]],
    ["Add", "t", 1]]]]]
```

### Collections, calls, indexing and field access

```epsil
[a, b]          // ["List", "a", "b"]      — [] → ["List"]
{a, b}          // ["Set", "a", "b"]       — {} → ["Set"]
(a, b)          // ["Tuple", "a", "b"]
a..b            // ["Range", "a", "b"]
```

A dictionary is a `Dictionary` of `KeyValuePair`s, and an unquoted key becomes
a string key. The empty dictionary, `{->}`, lowers to `["Dictionary"]`:

```epsil
{ one -> 1, two -> 2 }
```

```json
["Dictionary",
  ["KeyValuePair", {"str": "one"}, 1],
  ["KeyValuePair", {"str": "two"}, 2]]
```

A call whose callee is a bare symbol uses that symbol as the head; any other
callee goes through `Apply`. Indexing lowers to `At`, field access to `Field`,
and a spread argument to `Spread`:

```epsil
f(x, y)       // ["f", "x", "y"]
f()           // ["f"]
f(1, ...p)    // ["f", 1, ["Spread", "p"]]
(getF())(x)   // ["Apply", ["getF"], "x"]
(a + b)(2+1)  // ["Apply", ["Add", "a", "b"], ["Add", 2, 1]]
xs[i]         // ["At", "xs", "i"]
f(x)[0]       // ["At", ["f", "x"], 0]
p.x           // ["Field", "p", "x"]
a.b.c         // ["Field", ["Field", "a", "b"], "c"]
p.x(2)        // ["Apply", ["Field", "p", "x"], 2]
```

A bare, top-level comma-separated sequence with no enclosing delimiter is a
diagnostic, not a `Sequence` literal. `Sequence` is available only as an
explicit call: `Sequence(1, 2, 3)` → `["Sequence", 1, 2, 3]`.

### Strings and LaTeX islands

An interpolated string is a `String` whose operands alternate between literal
text and the interpolated expressions:

```epsil
"The solution is \(x)"
```

```json
["String", {"str": "The solution is "}, "x"]
```

The text between `$…$` delimiters is handed to an **injected** LaTeX parser,
and the expression it returns is spliced into the Epsil syntax tree at that
point, composing with its surroundings like any other primary:

```epsil
2 * $\frac{1}{2}$
```

```json
["Multiply", 2, ["Divide", 1, 2]]
```

Epsil's parser has no static dependency on the LaTeX parser: it is passed in by
the caller, the same way the engine itself injects `LatexSyntax` rather than
importing it directly. Without an injected parser, an island produces a
`latex-parsing-unavailable` diagnostic instead of a spliced expression.

### Symbol names and normalization

A symbol name must be a valid [MathJSON symbol](/math-json/#symbols). When
expressions are boxed for execution, symbol bindings are normalized to
[Unicode Normalization Form Canonical Composition (NFC)](http://www.macchiato.com/unicode/nfc-faq)
and stored and compared in that form. So `Å` written as **U+00C5 LATIN CAPITAL
LETTER A WITH RING ABOVE** and as **U+0041 LATIN CAPITAL LETTER A** followed by
**U+030A COMBINING RING ABOVE** are the same symbol.

The glyph aliases listed in [Naming](/epsil/naming/#glyph-aliases) are
canonicalized at the lexer, so `π` and `Pi` are indistinguishable by the time
an expression exists.

### Comparison chains

A run of the *same* relational operator lowers to a single n-ary node:

```epsil
a < b < c     // ["Less", "a", "b", "c"]
```

A *mix* of relational operators initially lowers as a left-associated tree:

```epsil
a < b <= c    // ["LessEqual", ["Less", "a", "b"], "c"]
```

When that tree is boxed by the engine, it is canonicalized to the pairwise
conjunction `a < b && b <= c`, which is why evaluating a mixed chain has the
usual mathematical chained-comparison semantics.

### Errors

A runtime problem — a type error, an out-of-domain argument, reassigning a
`const` — flows as an embedded `["Error", …]` value rather than a thrown
exception. `executeEpsil` never throws for a runtime problem; it catches the
underlying engine exception (for the handful of paths, like a `const`
reassignment, that still throw internally) and returns an `Error` value in its
place. See [Errors are values](/epsil/evaluation/#errors-are-values).

## Round-trip and serialization normalizations

`serializeEpsil` and `parseEpsil` are inverses over the MathJSON the grammar
can produce, up to a small set of documented normalizations.
`parseEpsil(serializeEpsil(e))` is **structurally** equal to `e` after
applying:

- **Number formatting** — `2`, `{num: "2"}` and `"2"` are the same number;
  the serializer emits a single canonical spelling (with `_` digit grouping),
  which re-parses to a `{num}` object.
- **`Negate` of a literal** — `["Negate", 3]` serializes to `-3` and
  `["Negate", -1]` to `1`; both re-parse as a signed `num` literal rather than
  a `Negate` node (the sign is folded into the number).
- **`Rational` → `Divide`** — `["Rational", 1, 2]` serializes to `1 / 2`.
  There is no rational literal in the grammar, so it re-parses as
  `["Divide", 1, 2]`.
- **Invisible multiply** — a binary `["Multiply", {num}, {sym}]` serializes to
  the juxtaposed form `2x` (only when the two abut and re-lex unambiguously as
  a number followed by a symbol). All other products — n-ary, number×group
  (`2(x+1)`), group×group — stay explicit `*`, because `(x+y)(3+4)` would
  otherwise re-parse as `Apply`, not `Multiply`.
- **Associativity** — the left-associative operators
  (`Add`/`Subtract`/`Multiply`/`Divide`/`And`/`Or`) re-parse into
  left-nested binary trees; a flat n-ary form and its left-nested spelling are
  the same expression.
- **`Element` spellings** — `is` and `in` produce the same `Element`
  expression, so a serialized program spells both of them `in`.

Comments are **not** preserved by a round-trip — see
[Comments](/epsil/comments/).

`If` and `Match` have dedicated expression spellings. Other MathJSON heads that
do not have a special surface form serialize as ordinary function calls.

## Relationship to the loose math parser

Epsil is a **programming-language** syntax. The Compute Engine also ships a
*loose math parser* (`ce.parse(src, { canonical: false })`) that reads
LaTeX/ASCII-math notation. The two share a few surface forms but are **not** the
same language, and they overlap only partially:

| Source     | Epsil `parseEpsil`                | Loose `ce.parse` (non-canonical)              | Agree? |
| ---------- | ----------------------------------- | --------------------------------------------- | ------ |
| `[1, 2, 3]` | `["List", 1, 2, 3]`                | `["List", 1, 2, 3]`                           | ✅ same |
| `x^2`      | `["Power", "x", 2]`                  | `["Power", "x", 2]`                            | ✅ same |
| `2**3`     | `["Power", 2, 3]`                   | math-parser artifact (`**` is not an operator) | ❌ diverge |
| `a \|> b`   | `["Pipe", "a", "b"]`               | `["Pipe", "a", "b"]`                           | ✅ same |
| `f(x, y)`  | `["f", "x", "y"]` (call)            | `["InvisibleOperator", "f", ["Delimiter", …]]` | ❌ diverge |
| `sin`      | `"sin"` (a symbol)                  | `["InvisibleOperator", "s", "i", "n"]`         | ❌ diverge |
| `2x`       | `["Multiply", 2, "x"]`             | `["InvisibleOperator", 2, "x"]`               | ❌ diverge |

The remaining divergences are intentional: in Epsil a juxtaposed name is a
single identifier (`sin` is one symbol, not `s·i·n`), `f(x, y)` is a function
call, and `**` is exponentiation. The two parsers do agree that `|>` produces
`Pipe`. Do not rely on them agreeing except on the rows marked *same*.
