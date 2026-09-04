---
title: Epsil Style Guide
sidebar_label: Style Guide
slug: /epsil/style/
description: "How to write idiomatic Epsil: declarations, functions and recursion, collection pipelines, building values in loops, indexing, errors as values, inferred and declared effects, and pattern matching."
hide_title: true
date: Last Modified
---
# Style Guide

The idioms of well-written Epsil, in one place. Each rule says what to write,
why, and where the full reference is. Every example on this page is executed
by the documentation test, so the code is current.

## Declarations

**`const` for what is fixed, `let` for what varies.** A `const` reports an
accidental write; a `let` is the honest choice for an accumulator, loop
state, or a value refined as you go.

```epsil
const g = 9.81
let total = 0
for step in 1..3 { total = total + g * step }
total
// ➔ 58.86
```

**Annotate a contract, not a fact the engine already knows.** A parameter
type on a function others call is a contract worth writing; a local whose
value is `5` is already an integer. Inference types locals and infers a
parameter's type from its use, so an annotation should say something the
code does not.

```epsil
function area(r: real) -> real { Pi * r^2 }
let side = 3
N(area(side), 8)
// ➔ 28.274334
```

**Destructure with a tuple pattern.** `let (q, r) = …` declares several names
at once; `(a, b) := (b, a)` writes names that exist, and evaluates the whole
right side first, so it swaps. A bare `=` at statement level assigns only to
a plain name; anywhere else it compares.

```epsil
let (q, r) = (Floor(17 / 5), 17 % 5)
(q, r) := (r, q)
(q, r)
// ➔ (2, 3)
```

See [Declarations](/epsil/declarations/) and
[When to write an annotation](/epsil/types/#when-to-write-an-annotation).

## Functions and recursion

**Math style for a formula, block style for a body with statements.**
`f(x) = …` reads as the equation it is; `function f(x) { … }` is for a body
with a local `let`, a loop, or a `match`.

```epsil
h(x) = x^2 + 1
function sumOfSquares(xs: list<number>) -> number {
  let s = 0
  for x in xs { s = s + h(x) }
  s
}
sumOfSquares([1, 2, 3])
// ➔ 17
```

**Base cases as clauses.** A literal parameter selects a clause by value, so
a recursive definition states its base cases without an `if`.

```epsil
fib(0) = 0
fib(1) = 1
fib(n: integer) = fib(n - 1) + fib(n - 2)
fib(20)
// ➔ 6765
```

**Recursion needs no ceremony.** A one-step definition may call itself, and
two definitions may call each other, in every form; nothing has to be
declared first.

```epsil
even(n) = true if n == 0 else odd(n - 1)
odd(n) = false if n == 0 else even(n - 1)
[even(10), odd(7)]
// ➔ [True, True]
```

**A lambda is for an argument.** Write `x => x^2` where a function is passed
along and a name would add nothing; name a function you call more than once.

See [Functions](/epsil/control-flow/#functions).

## Collections and pipelines

**Produce values with `Map`, `Filter`, `Fold`; loop for effect.** A `for`
loop evaluates to nothing and exists to update state. A value that is a
transformation of a collection is a pipeline.

```epsil
1..10 |> Filter(_, k => k % 3 == 0) |> Map(k => k^2, _)
// ➔ [9, 36, 81]
```

```epsil
Fold((acc, k) => acc + 1/k, 0, 1..10)
// ➔ 7381/2520
```

**Mark the piped slot with `_`.** `xs |> f` passes the value as the only
argument; when the function takes several, `_` says which.

**Pipelines are lazy; materialize where you stand.** `Range`, `Map`,
`Filter`, `Take`, `Drop`, and `Join` are generators that enumerate when they
are indexed, aggregated, or iterated, and a deferred mapping reads its
variables at that moment. A collection literal snapshots its elements at
once. When a later step will change a variable the pipeline reads, aggregate
or index first.

See [Pipelines](/epsil/control-flow/#pipelines) and
[Collections: literals are values, pipelines are generators](/epsil/evaluation/#collections-literals-are-values-pipelines-are-generators).

## Building a list one element at a time

**Prefer a pipeline when the list has a formula.** A list whose element `k`
depends only on `k` is a `Map`; a running value is a `Fold` whose accumulator
is a scalar; a filtered selection is a `Filter`. These build the list once,
and their cost does not grow with the length in any way that matters.

```epsil
Map(k => k^2, 1..5)
// ➔ [1, 4, 9, 16, 25]
```

```epsil
Fold((acc, k) => acc + 1/k, 0, 1..10)
// ➔ 7381/2520
```

**Growing a list in a loop is fine for lists of a few thousand elements.**
`Join(xs, [k])`, `Append(xs, k)` and the spread literal `[...xs, k]` all
produce a plain list literal when `xs` holds one: the engine folds a join of
list literals into one literal. Each turn copies the current list, so the
whole loop costs the square of its length — a thousand turns take under a
second on a typical machine, a hundred take a few milliseconds. Past a few
thousand elements, write the pipeline instead.

```epsil
let seen = []
for word in ["a", "b", "a"] {
  if !(word in seen) { seen = Join(seen, [word]) }
}
seen
// ➔ ["a", "b"]
```

The default `iterationLimit` stops a loop after 1024 turns, so a loop that
builds anything larger needs the engine's limit raised (see
[Interruptibility](/epsil/evaluation/#interruptibility)). The measurement
behind these figures is in the
[performance note](#loop-accumulation-measured) at the end of this page.

## Indexing

**Indexing is 1-based, and a slice is a range.** `xs[1]` is the first
element and `xs[n]` the n-th; `xs[2..3]` is a slice; `First`, `Last`,
`Take`, and `Drop` name the common cases.

```epsil
let xs = [10, 20, 30, 40]
(xs[1], xs[2..3], Last(xs), First(Drop(xs, 1)))
// ➔ (10, [20,30], 40, 20)
```

**A tuple is a unit, a list is a sequence.** Destructure a tuple; iterate a
list. A function that returns several values returns a tuple.

## Errors as values

**A failure is a value, not an exception.** A failing subexpression
evaluates to an error value that propagates outward; the program keeps
running. Construct one with `RuntimeError`, and let a caller decide what to
do with it.

```epsil
function reciprocal(x: number) {
  if x == 0 { RuntimeError("zero-has-no-reciprocal") } else { 1 / x }
}
[reciprocal(4), reciprocal(0) is error]
// ➔ [1/4, True]
```

**Handle an error where the value is used.** `if let v: !error = f(x)`
binds the successful value and falls to `else` otherwise; `while let`
drains a partial function; a `match` case typed `!error` does the same in
a case list. Do not test for an error with a comparison.

```epsil
function head(xs: list) { match xs { [h, ...] => h } }
if let h: !error = head([]) { h } else { "empty" }
// ➔ "empty"
```

See [Errors are values](/epsil/evaluation/#errors-are-values) and
[`if let`](/epsil/control-flow/#if-let).

## Effects

**Effects are inferred; a specifier is a contract.** A definition that
declares no effects gets them read from its body: a function that draws a
random value is `random` whether or not it says so. The engine tracks ten
effect labels (`random`, `console`, `state`, …); a function whose body
performs none is pure by inference.

```epsil
roll(n) = Random(1..n)
Type(roll)
// ➔ TypeFrom("(unknown) random -> number")
```

**Write the specifier where the effect is part of the interface.** A
written specifier — between the parameter list and the return arrow — is a
promise the engine checks: the body's inferred effects must fit it, and
`pure` promises none, so a body that draws a random value under a `pure`
contract is rejected. Declare the effect on a function others call, so a
later edit that adds an effect is caught at the definition instead of
surprising a caller; leave inference to the rest.

```epsil
function roll(n: integer) random -> integer { Random(1..n) }
let r = roll(6)
1 <= r <= 6
// ➔ True
```

**Keep effects at the edges.** A pure core is easy to test, easy to reuse
in a pipeline, and safe to evaluate lazily; put the randomness, the input,
and the printing in the function that needs them, not in a helper called
from everywhere. For a reproducible simulation, wrap the effectful part in
`WithRandomSeed`.

See [Effect specifiers](/epsil/control-flow/#effect-specifiers) for the
labels, subtyping, and callback checks.

## Pattern matching

**A bare name binds; pin a value with `==`.** `match x { Pi => … }` binds a
new variable named `Pi`. To compare against a value, pin it.

```epsil
classify(x) = match x {
  == Pi => "pi"
  0 => "zero"
  n if n > 0 => "positive"
  _ => "other"
}
[classify(Pi), classify(0), classify(3), classify(-1)]
// ➔ ["pi","zero","positive","other"]
```

**Cover every case of a closed type.** A `match` on a sum type or a
boolean that leaves a variant uncovered is reported by `epsil check`; a
final `_` case is the idiom when the remaining variants share a result.

```epsil
type light = red | green | yellow
function canGo(t: light) -> boolean {
  match t {
    green() => true
    _ => false
  }
}
canGo(red())
// ➔ False
```

See [`match`](/epsil/control-flow/#match).

## Strings

**Interpolate scalars.** `"\(expr)"` splices the value of `expr`; a
collection-valued `expr` maps the string over its elements and yields a
list of strings, which is rarely what was meant.

```epsil
let n = 3
"n = \(n), n² = \(n^2)"
// ➔ "n = 3, n² = 9"
```

See [Strings](/epsil/literals/#strings).

## Naming

A capitalized identifier is a library or engine operator (`Map`, `Pi`);
a lowercase one is a user-defined variable, function, or type (`total`,
`area`, `type point = …`), and a sum's variants are its constructors
(`red()`). Commands are lowercase too (`print`). See
[Naming](/epsil/naming/).

## Loop accumulation, measured {#loop-accumulation-measured}

The figures in [Building a list one element at a time](#building-a-list-one-element-at-a-time)
come from this measurement, taken on one machine with the interpreter
(a compiled program copies a native array per turn and is faster still):

| Turns / elements | `Map(k => k, 1..n)` | `xs = Join(xs, [k])` in a loop | `xs = [...xs, k]` in a loop | `xs = ListFrom(Join(xs, [k]))` in a loop |
|:-----------------|--------------------:|-------------------------------:|----------------------------:|-----------------------------------------:|
| 250 | 15 ms | 127 ms | 125 ms | 165 ms |
| 500 | 8 ms | 276 ms | 272 ms | 370 ms |
| 1000 | 12 ms | 857 ms | 859 ms | 1246 ms |

The pipeline does not grow with `n` in any way that matters; every
element-per-turn form grows by a factor of about three per doubling, the
cost of copying a list that is twice as long twice as often. Before the
engine folded a join of list literals into one literal (2026-09-04), the
same loop kept a lazy `Join` view with one operand per turn and re-checked
all of them on every turn: 4.7 s at 250 turns and 16.6 s at 500 on the same
kind of machine.
