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
declaration syntax: it is an **assignment**:

```epsil
x = 5
```

Assigning to a name that was never declared does establish it, but `let` is
the explicit and idiomatic way to introduce a mutable binding.

In a function body, an assignment to a name that no enclosing scope
declares makes a local of the function body, as a `let` does. This is also
true when the assignment is in a nested block of the body — a branch of an
`if`, the body of a loop, a `do` block —, as in Python. A function literal
written in the body owns the names that its own body assigns, and a `let` in
a nested block declares a local of that block only. The rule is the same
for every function body that the engine makes from an expression: the term
of a `Table` is applied as a function at each index, so it owns the names
that its branches assign, while the term of a `Sum` or a `Product` is
evaluated again at each index, as a loop body is. Which scope a name
belongs to is decided where
the function is **defined**, not where it is called: each call of the
function gets its own local, and a declaration of the same name made later
does not change what the function writes. Such an assignment does not write
a variable outside the function, so it is not the `scope` effect, and the
function needs no effect specifier:

```epsil
function g(k) { t = k + 1; t }
let t = 0
[g(1), g(2), t]
// ➔ [2, 3, 0]
```

Each call starts with no value for such a local. A read of the local before
its first assignment in the call is the `read-before-declaration` error, as a
read of a `let` local before its `let`. The read is not the bare symbol `t`,
and it does not read a `t` outside the function:

```epsil
function g(k) { u = t; t = k; u }
g(1)
// ➔ Error(ErrorCode("read-before-declaration", "t", "assignment"))
```

The same holds for a read in the value of the first assignment
(`t = t + 1` as the first statement), and for a read that runs when no
assignment ran before it, such as a read after an `if` that assigns the
local in one branch only:

```epsil
function g(c) { if c { t = 1 }; t }
[g(true), g(false)]
// ➔ [1, Error(ErrorCode("read-before-declaration", "t", "assignment"))]
```

The same holds for `if c { t = 1 }; t = t + 1` with `c` false. A call of the function that the local holds (`h(1)` before
`h = (x) => x`) and the collection of a `for` loop (`for i in t { … }`
before `t = [1, 2]`) use the local too, and give the same error; the loop
then runs no iteration, and the error is its value. A closure that reads
the local reads it when it is called, so
`f = () => t; t = 1; f()` gives `1`. The body of a loop keeps its locals
from one iteration to the next in one call, so the second iteration can read
the value that the first one assigned.

`epsil check` reports the read before the program runs when the order is
certain from the source: the read is in a statement before every statement
that assigns the local, or it runs before the first assignment in the
statement that holds it (in the value of the assignment, in the condition
of an `if` or in a branch before the assignment of that branch, in the body
of a loop before the assignment of the first iteration). It reports
a read of a `let` local before its `let` in the same way. The run then does
not report the same read a second time. A read that
comes before the first assignment only on some paths (after an `if` that
assigns the local in one branch) is reported when it happens, by the run.

A block outside every function — a `do` block, an `if` or a loop body at the
top level of a program — owns the names that its own statements assign, but
not the names that its nested blocks assign: each nested block owns its
own. There, a read before the first assignment stays the bare symbol, as a
read of an undeclared name at the top level does.

An assignment to a name that an enclosing scope declares when the function
is defined — a top-level `let` or assignment written before the function, a
parameter or a local of an enclosing function — writes that binding. In a
function body, this is the `scope` effect, which must be declared (see
[Effect specifiers](/epsil/control-flow#effect-specifiers)):

```epsil
let n = 0
function bump() scope { n = n + 1; n }
[bump(), bump(), n]
// ➔ [1, 2, 2]
```

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
call comes after the `const`. A function defined before a top-level `const`
does not write it: the assignment makes a local of the function body (see
above). An assignment to a `let` or a parameter that shadows
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

`let` and `const` are the binding keywords. There is currently no compound
assignment (`+=`); destructuring declarations (`let (x, y) = t`) and
destructuring assignments (`(x, y) := t`) are described above.

