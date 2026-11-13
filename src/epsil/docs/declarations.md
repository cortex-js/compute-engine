---
title: Epsil Declarations
sidebar_label: Declarations
slug: /epsil/declarations/
description: "Declare symbols in Epsil: let for mutable bindings, const for immutable ones, with optional type annotations and lexical scoping rules."
hide_title: true
date: Last Modified
---
# Declarations

A declaration introduces a symbol into the current scope. Epsil has two
declaration keywords:

- **`let`** declares a **mutable** symbol.
- **`const`** declares an **immutable** symbol.

```epsil
let x = 5
const c = 6.28
```

Reach for `const` when the name stands for something fixed — a physical
constant, a conversion factor, a lookup table — so that an accidental write is
reported. Use `let` for anything that varies: accumulators, loop state, 
values you refine as you go.

A type annotation also **implies** a declaration, even without a keyword:

```epsil
x: real = 5
```

is a declaration of `x` with type `real`, exactly as if it had been written
`let x: real = 5`. The keyword is only mandatory for an **untyped**
declaration — that's what distinguishes a declaration from a plain
reassignment (see below).

## Destructuring declarations

A `let` or `const` may bind the components of a **tuple** in one statement:

```epsil
divmod(a, b) = (floor(a / b), a % b)
let (q, r) = divmod(17, 5)
(q, r)
// ➔ (3, 2)
```

The pattern is a parenthesized list of **at least two** elements, each a bare
symbol, a `_` (which skips that position), or a nested tuple pattern:

```epsil
let ((a, b), _, c) = ((1, 2), 99, 5)
a + b + c
// ➔ 8
```

The pattern is **irrefutable in form** — no literals, pins, or guards (use
[`match`](/epsil/control-flow/) for conditional destructuring). The value is
evaluated once; it must be a tuple of the same shape, otherwise the
declaration yields an `incompatible-type` **error value** and binds nothing.
With `const`, every bound name is a constant. An initializer is required, and
a type annotation is not accepted on a pattern. Duplicate names anywhere in
one pattern are a diagnostic.

## Destructuring assignment

The same pattern may appear on the left of an assignment, to write bindings
that already exist instead of declaring new ones:

```epsil
let a = 1
let b = 2
(a, b) := (b, a)
(a, b)
// ➔ (2, 1)
```

The right side is evaluated **once, in full, before any target is written**,
so a swap means what it reads — `(a, b) := (b, a)` exchanges the two values
rather than assigning `b` to both. The same holds for a rotation
(`(a, b, c) := (c, a, b)`) and for the pair-carrying loop step that is the
usual reason to want this:

```epsil
let a = 0
let b = 1
for k in 1..10 {
  (a, b) := (b, a + b)
}
a
// ➔ 55
```

The pattern grammar is exactly the one above — at least two elements, each a
bare symbol, a `_` skipping that position, or a nested tuple pattern — and a
shape mismatch is the same `incompatible-type` error value, which writes
**nothing**: the whole pattern is matched before any target is written, so a
mismatch nested under a position that would have bound leaves that one alone
too.

The differences from a destructuring `let` are the ones assignment always has:
the targets keep their identity and their declared type (a value that does not
fit a target's type is an error value), and assigning to a `const` fails.
Those two failures are found only by attempting the write, so unlike a shape
mismatch they are **not** atomic — targets earlier in the pattern have already
been written and stay written.

The assignment operator must be spelled `:=`. A statement-leading `(a, b) = …`
is a **comparison**, not an assignment — a parenthesized left side is not a
binding target, so the bare `=` reads as `Equal`. Because that is almost
always a typo for the destructuring assignment, it is
[diagnosed](/epsil/operators/).

## Declaring a type

A third declaration keyword, `type`, introduces a **type** name rather than a
symbol — and, with it, a constructor of the same name:

```epsil
type point = tuple<x: number, y: number>
type alias pair = tuple<number, number>
let p = point(1, 2)
let a: pair = (1, 2)
```

`type` declares a new, distinct type; `type alias` declares another name for
an existing one, and takes a type-parameter clause if it needs one
(`type alias Pair<T> = tuple<T, T>`). Unlike `let` and `const`, `type` is not
a reserved word — only these statement shapes claim it. See
[Declaring a type](/epsil/types/#declaring-a-type) for the whole story.

## Function-type annotations bind their parameter names

A parameter name **binds wherever it appears**. When a declaration's
annotation is a function type written out at the declaration site with named
parameters, those names become the parameters of the declared function — the
initializer is its **body**:

```epsil
const f : (x: number) -> number = x^2 + 2x + 1
f(3)
// ➔ 16
```

This is the same function as `= (x) => x^2 + 2x + 1`, and the same as the
definition form `f(x: number) -> number = x^2 + 2x + 1`. The initializer may
instead be an explicit lambda; the annotation's names must then agree with the
lambda's (a disagreement is a diagnostic, with a fixit) — or leave the
annotation's parameters unnamed, and let the lambda name them:

```epsil
const g : (number) -> number = (x) => x + 1
```

So a name appears in **one** place (or in both, agreeing) — never with two
meanings. These declared names are also what callers use to pass
[named arguments](/epsil/syntax/#named-arguments) — `f(x: 3)` — so
renaming a parameter is a visible change to the function's interface. When the annotation is named, the initializer is read as a pointwise
*body*; when it is unnamed, the initializer must *be* a function value, as in
`const h : (number) -> number = g`.

The names bind only where they are **written**: an annotation through a
`type alias` never binds (its names are documentation), a zero-parameter
signature has nothing to bind (`const t : () -> number = makeCounter()` keeps
meaning what it says), and for a curried signature only the **outermost**
arrow binds — `const add : (x: number) -> (y: number) -> number = (y) => x + y`
binds `x` around an explicit inner lambda. Generic (a `where` clause), effectful,
optional/variadic, and partially named signatures do not bind either; give
those an explicit lambda.

## Reassignment vs. declaration

A bare `x = 5` — no `let`/`const` keyword, no type annotation — is not
declaration syntax: it is an **assignment**, and it writes a variable that is
already declared:

```epsil
let x = 0
x = 5
```

An assignment never declares a name. An assignment to a name that no `let`,
`const` or parameter declares, and that no earlier program or the host
declared, is an error (`assignment-to-undeclared-variable`), at the top level
of a program as in a block or a function body. `let` introduces a mutable
binding.

## The rules of block locals

Two rules make sure that a local always has a value when it is read:

1. **A declaration has a value.** `let x = v` or `let x: integer = v`
   declares `x` with its value. `let x: integer` with no value is an error
   (`declaration-without-value`). One declaration needs no value: at the
   top level of a program, a function type, when a `function` statement (or
   a definition `f(x) = …`) of the same name is in the program. The
   definition gives the name its value from the start of the program, so
   the declaration only gives the signature of the function:
   `let f: (integer) -> integer; function f(x) { x + 1 }; f(2)` is `3`. In
   a function body or a block, a function statement declares a local
   ([local functions](/epsil/control-flow#local-functions)), so the two
   statements are two declarations of `f` (`variable-redeclaration`): give
   the type with the value, `let f: (integer) -> integer = (x) => x + 1`.
   An assignment to
   a name that is not declared is an error
   (`assignment-to-undeclared-variable`), also in a branch of an `if` or a
   `match` and in the body of a loop: declare the name with a value before
   the branch. A `let` in a branch declares a local of the block of that
   branch. A use of a local in a statement before the statement that
   declares it is an error (`read-before-declaration`). A use of the local
   in the body of a function literal is not checked, because the body runs
   when the function is called, and the check does not follow calls: in
   `function g() { let f = () => t; let v = f(); let t = 1; v }`, the call
   `f()` reads `t` before its declaration.
2. **An assignment is a statement, not a value.** `f(a := 2)` is an error
   (`assignment-in-operand`), and `a := b := 5` is a syntax error
   (`chained-assignment`): write two statements. A block whose last statement
   is an assignment or a declaration has the value `Nothing`; end the block
   with the name to give its value.

A local can be assigned again after its declaration, also in a branch, a
loop body or a nested block. The type of the new value must be able to be
the type of the local: its declared type, or else the type of its first
value, widened. A number
widens to `number`, a string or a character to `string`, a boolean to
`boolean`, and the elements of a list, a set or a tuple widen the same way.
So `let s = 0` then `s = s + 0.5` is valid, and `let s = 0` then `s = "x"`
is an error (`assignment-type-mismatch`). A local whose first value has no known
type (an untyped parameter) accepts a value of any type.

All these errors are found before the program runs: `epsil check` reports
them, and a statement that holds one gives the error as its value.

The top level of a program declares its names as a block does: a name is
introduced there by `let` or `const`, and is then a name of the session. Its
statements run one at a time. An assignment to a name of the session
(declared by an earlier statement, an earlier program, or the host) writes
it: `let a = 1; if c { a = 2 }; a` is valid. The rules of a use before the
declaration and of the type of a new value apply only in a block
(`do { … }`) and in a function body: at the top level,
`let a = 1; a = "x"; a` is valid and gives `"x"`.

| Program                                    | Result                                 |
| ------------------------------------------ | -------------------------------------- |
| `let a = 1; let b = a + 1; b`              | `2`                                    |
| `let a = 1; b = a + 1; b`                  | error: `assignment-to-undeclared-variable` |
| `let s = 0; for i in 1..3 { s = s + i }; s` | `6`                                   |
| `let a = 1; if c { a = 2 }; a`             | `2` when `c` is true, else `1`         |
| `let a: integer; if c { a = 1 }; a`        | error: `declaration-without-value`     |
| `let f: (integer) -> integer; function f(x) { x + 1 }; f(2)` | `3` |
| `let f: (integer) -> integer; f(2)`        | error: `declaration-without-value`     |
| `if c { a = 1 }; a`                        | error: `assignment-to-undeclared-variable` |
| `do { if c { a = 1 }; a }`                 | error: `assignment-to-undeclared-variable` |
| `do { let a = 1; a = "x"; a }`             | error: `assignment-type-mismatch`      |
| `let a = 0; f(a := 2) + a`                 | error: `assignment-in-operand`         |
| `do { let b = 2 }`                         | `Nothing`                              |

An assignment in a function body writes the variable that is in scope where
the function is **defined**: a parameter, a local of the body, a local of an
enclosing function, or a name of the program. A local of a function body is
declared with `let` or `const`, and each call of the function gets its own
local. Such a local is not a variable outside the function, so a write to it
is not the `scope` effect, and the function needs no effect specifier:

```epsil
function g(k) { let t = k + 1; t }
let t = 0
[g(1), g(2), t]
// ➔ [2, 3, 0]
```

A use of such a local before its declaration is an error that is found
before the program runs:

```epsil
function g(k) { let u = t; let t = k; u }
```

A closure that reads a local reads it when it is called, so
`do { let f = () => t; let t = 1; f() }` gives `1`. The body of a loop keeps
the locals of an enclosing block from one iteration to the next, so the
second iteration reads the value that the first one assigned.

An assignment to a name that an enclosing scope declares when the function
is defined — a top-level `let` written before the function, a parameter or a
local of an enclosing function — writes that binding. In a
function body, this is the `scope` effect, which must be declared (see
[Effect specifiers](/epsil/control-flow#effect-specifiers)):

```epsil
let n = 0
function bump() scope { n = n + 1; n }
[bump(), bump(), n]
// ➔ [1, 2, 2]
```

In a program, a function can assign a variable only if the `let` of the
variable comes before the function is defined. The statements of a program
are read one at a time, so an assignment in a function written before the
`let` is an error (`assignment-to-undeclared-variable`), even when the
function is called after the `let`. This holds for a `function` statement
too, although it can be called from anywhere in the program:

```epsil
function g(k) scope { t = k + 1; t }   // error: t is not declared yet
let t = 0
[g(1), t]
```

A MathJSON `Block` that a host evaluates is read as a whole: a `Declare` in
it declares its local for the whole block, so the same statements as a
`Block` give `[2, 2]`.

The same rule holds for an anonymous function that a top-level `let` or
`const` names: the type states the effect. Without `scope` in the type, the
statement gives an `incompatible-type` error and declares nothing:

```epsil
let n = 0
let bump: () scope -> number = () => do { n = n + 1; n }
[bump(), bump(), n]
// ➔ [1, 2, 2]
```

A `let` in a block does not need the specifier, and neither does a `let` whose
value is computed, such as the closure that a call returns
(`let c1 = counter()`).

Reassigning a symbol that was declared `const` produces an
[error value](/epsil/evaluation/#errors-are-values), not a parse error or a
thrown exception:

```epsil
const c = 1
c = 2
```

`c = 2` still parses as a perfectly ordinary assignment; the failure happens at
evaluation time, and its result is an error value. Because the `const` is in the
same program, `epsil check` also reports the assignment before anything runs
(`constant-assignment`), wherever it is: at the top level, in a block, a loop
body or a function body. This holds for a `const` at any depth, and for each
name of a destructuring `const`. A function defined before a `const` of the
same block is included, because the `const` of a block is declared when the
block starts: an assignment in the function writes the constant when the
call comes after the `const`. An assignment to a `let` or a parameter that shadows
the constant is not reported.

A declaration with no initializer declares the name without giving it a value:

```epsil
let x: real
let y
```

Without an annotation, the type is inferred from the initializer — `let x = 5`
declares `x` as an `integer`.

Constness is a property of the **binding**, not of the type: `const` says that
*this name* will not be written again, and says nothing about the value it
holds — there is no such thing as a constant type. See
[Declarations](/epsil/implementation/#declarations) for the underlying
representation.

## Scoping

Declarations live in the current scope. A program (a notebook cell or a
chain of cells sharing one engine scope) declares at the top level; a block
introduced by `if`/`else`/`while`/`for`, or a function body, pushes its own
lexical scope, so a `let`/`const` inside a block does not leak into the
enclosing scope.

A `function` statement defines its name for the **whole** program or block
it is written in, including the statements before it: a call written before
the definition runs the function.

```epsil
let a = g(3)
function g(k) { k^2 }
a
// ➔ 9
```

An assignment of a function literal (`g = (k) => k^2`, `let g = (k) => k^2`)
takes effect when it runs. A call before it stays the symbolic `g(3)`. A
value that holds such a call is resolved again when a later statement reads
it, so the same program with `g = (k) => k^2` in place of the `function`
statement also answers `9`. Within one statement, the result is not resolved
again: `do { u = h(1); h = (x) => x; u }` answers `h(1)`, because the
assignment of `h` runs in the same evaluation as the call.

A call reads the function that its name denotes **where the call is
written**. A function of the same name defined in another scope does not
change which function the call runs; assigning another function to that same
name does.

A name is declared **once per scope**. A `let`/`const` of a name that the same
scope already declares — an earlier `let`/`const` of the same block or
program, a parameter of the function whose body this is, or the index of the
loop whose body this is — is the `variable-redeclaration` error, reported
before the program runs:

```epsil
function f(x) {
  let x = x + 1   // error: x is a parameter of f
  x
}
```

To update a binding, assign to it (`x = x + 1`); to hold a second value,
choose another name. A `let` in a **nested** block is not a re-declaration:
it shadows the outer name for that block, and its initializer reads the outer
value.

```epsil
let t = 1
for k in 1..3 {
  if k > 1 {
    let t = t * 2   // shadows the outer t; reads 1, so t is 2 here
    t
  }
}
```

Across programs — a re-run notebook cell, a later REPL line — a top-level
`let` re-declares legally; only a repeat within one program is reported.

[Type declarations](/epsil/types/) are the exception: types (and their
constructors) are **global** — a `type` statement is only allowed at the top
level of a program, and the declared name means the same thing everywhere on
the engine.

`let` and `const` are the binding keywords. Destructuring declarations
(`let (x, y) = t`) and destructuring assignments (`(x, y) := t`) are described
above.

## Compound assignment {#compound-assignment}

`s += e` adds `e` to the variable `s`: it is `s = s + e`. `L[i] += e` adds `e`
to an element of a list: it is `L[i] = L[i] + e`, with the positions that
`L[i] = v` accepts (`m[j, i] += e`, `m[j][i] += e`). Each position is
evaluated once, before `e`.

```epsil-live
let L = [1, 2, 3]
L[2] += 10
L
// ➔ [1, 12, 3]
```

Any other target (a field `p.x`, a call, a string position) is the error
`add-to-target`. `+=` is the only compound assignment. In the body of a
[`parallel for` loop](/epsil/control-flow/#parallel-loops), it adds a
contribution to a variable declared outside the loop. The MathJSON form is
`["AddTo", target, e]`.

