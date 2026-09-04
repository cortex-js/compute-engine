---
title: Epsil Evaluation
sidebar_label: Evaluation
slug: /epsil/evaluation/
description: "How an Epsil program evaluates: top-level statements run sequentially in one session scope, values stay exact, and errors are ordinary values."
hide_title: true
date: Last Modified
---
# Evaluation

A program's top-level statements are evaluated **sequentially**, and the
program's value is the **last statement's** value:

```epsil
let x = 5
x = x + 3
x
// ➔ 8
```

No scope is pushed around the whole program: declarations persist across
statements, and across cells in a notebook or inputs in a REPL that share one
session. Blocks and function bodies still push their own lexical scopes (see
[Control Flow](/epsil/control-flow/)).

## Symbolic by default

Values stay **exact** unless you ask otherwise. A transcendental of an exact
argument stays symbolic —

```epsil
Ln(2)
```

evaluates to the symbolic `Ln(2)` (`ln(2)`), not a decimal approximation.

**Numeric approximation is explicit**, via `N(expr)` — it is a function
call, not a language mode:

```epsil
N(Ln(2))
```

evaluates to `0.6931471805599453…`.

## Values and bindings

Epsil keeps apart two things many languages blur together:

- A **value** — a number, a string, a list, a dictionary, a function — is
  **immutable**. Once it exists, nothing anywhere can change it.
- A **binding** — the association between a name and a value — is the part
  that changes. `let` introduces a binding you may reassign; `const` one you
  may not. See [Declarations](/epsil/declarations/).

Everything below follows from those two sentences.

**There is no in-place modification.** A collection cannot be updated
element by element:

```epsil
let xs = [1, 2, 3]
xs[2] = 9
// ➔ Error(ErrorCode("incompatible-type", "symbol", "integer | nan"), At("xs", 2))
```

Build the value you want and rebind the name:

```epsil
let xs = [1, 2, 3]
xs = Join([xs[1]], [9], [xs[3]])
xs
// ➔ [1, 9, 3]
```

Operators never modify what you hand them — `Append`, `Sort`, `Join`,
`Map`, `Filter` all return a **new** collection:

```epsil
let xs = [3, 1, 2]
let ys = Sort(xs)
(xs, ys)
// ➔ ([3, 1, 2], [1, 2, 3])
```

**Reassigning one name never disturbs another.** Two names holding the same
value are independent, because there is no way to reach a value *through* a
name and alter it:

```epsil
let a = [1, 2, 3]
let b = a
a = [9, 9, 9]
b
// ➔ [1, 2, 3]
```

This is what makes a value safe to pass around: no function you call, and no
name you assign to, can change a collection out from under you. There are no
references, no aliasing and no object identity — two collections are the same
when they have the same contents, and that is all `==` ever asks:

```epsil
[1, 2, 3] == [1, 2, 3]
// ➔ True
```

**A parameter is a binding of its own.** A function may reassign its
parameter; the caller's binding is untouched:

```epsil
function reset(v) {
  v = 0
  v
}
let n = 7
let r = reset(n)
(n, r)
// ➔ (7, 0)
```

**A closure captures the binding, not a snapshot of its value.** This is the
one place where the distinction is directly visible. A function that refers
to an outer name reads that name's *current* value each time it runs:

```epsil
let x = 1
f() = x
x = 2
f()
// ➔ 2
```

Each call of an enclosing function creates fresh bindings, so closures made
by separate calls have separate state, while closures made by the same call
share it:

```epsil
function counter() {
  let n = 0
  function bump() scope { n = n + 1; n }
  bump
}
let c1 = counter()
let c2 = counter()
(c1(), c1(), c2())
// ➔ (1, 2, 1)
```

`c1` and `c2` count independently.

`bump` writes to `n`, which belongs to the enclosing call rather than to
`bump` itself. Writing to a binding outside the function is the `scope`
effect, and it must be declared — without the specifier the definition is
rejected and `counter()` never produces a callable. See
[Effect specifiers](/epsil/control-flow#effect-specifiers).

Reach for `const` when a name should not move at all. Constness is a property
of the *binding*, not of the value it holds — every value is immutable
already — and writing to one yields an `Error` value rather than quietly
taking effect:

```epsil
const c = 1
c = 2
```

## Arguments are values — unless the function holds them {#arguments-are-values-unless-the-function-holds-them}

A call evaluates its arguments first and hands the function their values:
with `let a = 3`, `f(a + 1)` receives `4`. A function declared with the
`hold` prefix instead receives each argument **as written** — canonicalized
and bound in the caller's scope, but not evaluated — and evaluates it only
where its body reads it, so it can inspect the expression (`Head(e)`),
transform it, or decide whether to evaluate it at all:

```epsil
let a = 3
hold f(e) = Head(e)
f(a + 1)
// ➔ Add
```

Every parameter of a `hold` function is held (there is no per-parameter
form), and a parameter read twice is evaluated twice — read it once into a
`let` when that matters. See
[Hold functions](/epsil/control-flow/#hold-functions).

## Collections: literals are values, pipelines are generators

A collection **literal** — a list `[…]`, set `{…}`, tuple `(…)`, or
dictionary — evaluates its elements when the statement executes. Assigning
one to a variable stores a snapshot of the element *values*:

```epsil
let xs = []
for k in 1..3 { xs = Join(xs, [k]) }
xs
// ➔ [1, 2, 3]
```

Lazy collection **operators** — `Range`, `Map`, `Filter`, `Take`, `Join` —
are *generators*: their operands (bounds, sources, functions) are evaluated
when the expression is, but enumeration is deferred until the collection is
materialized (displayed, indexed, aggregated, or iterated). A deferred
mapping function reads program state **at materialization time**, like a
generator in Python — if it captures a variable that later changes, the
materialized elements reflect the later value. To snapshot, force the work
to happen where you stand: accumulate through a loop, or apply an eager
operation (an aggregate, an index) at the point of definition.

## Errors are values

Per [Principles](/epsil/principles/), "errors are values": a *runtime*
problem — a type error, an out-of-domain argument, reassigning a `const` —
becomes an `Error` value that propagates outward through the enclosing
expressions and becomes their result, not a thrown exception. A program never
throws to its host for a runtime problem.

*Parse*-time problems are different: a malformed program surfaces as a
**diagnostic**, not as a value. So do the few execution-time problems that are
really about the source, not the computation — a gated host pragma, or an
`#error` directive (see below).

Because only the **last** statement's value is the program's result, an error
value produced by an earlier statement would otherwise vanish silently. Each
*non-final* statement that evaluates to an error value therefore also emits
a `runtime-error` diagnostic — for example an indexed assignment
(`xs[2] = 9`, which is rejected: element assignment is not supported), or
reassigning a `const` in the middle of a program.

A program constructs an error value of its own with `RuntimeError`:

```epsil-live
function reciprocal(x) {
  if x == 0 { RuntimeError("zero-has-no-reciprocal") } else { 1 / x }
}
[reciprocal(4), reciprocal(0)]
// ➔ [1/4, Error("zero-has-no-reciprocal")]
```

The call evaluates to `Error("zero-has-no-reciprocal")`, which a caller takes
apart with [`if let`](/epsil/control-flow/#if-let) or
[`match`](/epsil/control-flow/#match) like any other error value. The
argument is a code string, or an `ErrorCode("code", details…)` when the
error carries data.

Do not write `Error("…")` for this. A written `Error(…)` is a *static*
diagnostic — the node the engine itself inserts where a program is wrong,
such as a type mismatch — and it marks the whole expression around it as
invalid: a function whose body spells `Error("neg")` never gets defined. The
two spellings make the distinction explicit: `Error` is a problem *with the
program*, `RuntimeError` is a failure *produced by running it*.

## Console input and output

`print` writes its operands to the host console — the terminal for the
command-line tools, the developer console in a browser — separated by
spaces and followed by a newline. Strings print their content, without the
quotes; every other value prints its ordinary textual form. It evaluates to
`Nothing`:

```epsil
let x = 6
print("x is", x * 7)
// prints: x is 42
```

`input` reads one line of text and evaluates to it as a string, without the
trailing newline. An optional operand is a prompt, displayed before
reading. In a terminal it reads from the terminal (piped standard input
works too); in a browser it opens the `prompt()` dialog. At end-of-input —
or when the dialog is canceled — it evaluates to `Nothing`; on a host with
no interactive input at all, the call stays symbolic.

```text
> let name = input("Who? ")
Who? Arno
> print("Hello,", name)
Hello, Arno
```

`print` and `input` follow the lowercase command convention. They are
ordinary library aliases for the `Print` and `Input` operators — not
keywords — so a local declaration of `print` shadows the command like any
other library name.

## Pragma security

`#env(...)` and `#navigator(...)` read state from the host process (or the
browser) at parse time. Because a notebook document can be shared or opened
in an unfamiliar environment, both are **gated off by default**:

<!-- epsil-test: expect-diagnostics -->

```epsil
#env("HOME")
```

by default produces a `host-pragma-disabled` diagnostic and no host read — the
pragma evaluates to `Nothing`. A host can opt back in and let `#env`/
`#navigator` read as documented in [Pragmas](/epsil/pragmas/).

The benign pragmas — `#line`, `#column`, `#url`, `#filename`, `#date`,
`#time` — always work; they don't read anything sensitive from the host.

`#error(...)` never crashes the host embedding the program: it becomes an
`error-directive` diagnostic, so a single bad cell is contained.

## Interruptibility

A host can give an evaluation an explicit time budget, and independent
count-based bounds on iteration and recursion depth. A breached limit becomes
an error value (or an `evaluation-canceled` diagnostic when it happens in a
non-final statement) — see
[Execution](/epsil/implementation/#execution) for how a host sets one.

The two kinds of limit end differently:

- An expired **time budget ends the program**. The budget is one deadline for
  the whole run, so once it has passed no later statement could run either:
  the statement that hit it becomes the last one executed, the program's
  value is its `Error("Timeout exceeded", "timeout")`, and the statements
  after it are not evaluated. Statements that completed before the expiry keep
  their effects. The deadline is checked before every statement (and before
  every statement of the static pass), so a program of many cheap statements
  is bounded too, not only one whose single statement runs long.
- A breached **count-based cap** (`iterationLimit`, `recursionLimit`) is
  per-construct: the next statement gets a fresh allowance, so the program
  continues past it. The statement that breached evaluates to the error value,
  and — because a loop is imperative — whatever it assigned before the breach
  stays assigned. A program that reads such a variable afterwards therefore
  sees a *partial* result alongside the `evaluation-canceled` diagnostic:

  <!-- epsil-test: expect-diagnostics -->

  ```epsil
  total = 0
  for i in 1..5000 { total = total + i * 2 }   // stops at iterationLimit (1024)
  total                                        // ➔ 1051650, not 25005000
  ```

  A host that displays `value` must also surface `diagnostics` (the loop's
  breach is an `error`-severity `evaluation-canceled` there), or raise
  `ce.iterationLimit` for programs expected to loop longer.

These limits are cooperative. A browser that evaluates untrusted or potentially
unbounded programs should run Epsil in a Web Worker it can terminate from the
outside. See
[Execution Constraints](/compute-engine/guides/execution-constraints/) for the
complete cancellation model.
