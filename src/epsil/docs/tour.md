---
title: A Tour of Epsil
sidebar_label: A Tour of Epsil
slug: /epsil/tour/
description: "A fast, example-led introduction to Epsil: exact symbolic computation, bindings, functions, collections, conditionals, and types."
hide_title: true
date: Last Modified
---
# A Tour of Epsil

<Intro>
In one page, write and read the Epsil programs you will use most often.
</Intro>

Epsil is a language for scientific computing built on the Compute Engine. Its
most useful starting idea is that mathematical expressions retain their meaning:
they stay exact and symbolic until you explicitly ask for an approximation.

This tour is deliberately quick. It introduces the language through complete,
executable snippets and points to the guide when a feature deserves a deeper
explanation.

## Exact mathematics, when it matters

Ordinary arithmetic is exact. `1 / 3` is the rational number one third, not a
rounded floating-point value; symbolic expressions also remain available for
later manipulation:

```epsil
let share = 1 / 3
Simplify(share + share + share)
// ➔ 1
```

This is valuable when a formula needs to be transformed, compared, or carried
through several steps without accumulating rounding error. Use `N()` at the
point where a decimal is actually useful — for presentation, plotting, or a
numerical algorithm:

```epsil
N(Sqrt(2))
// ➔ 1.4142135623730951
```

Capitalized names such as `Simplify`, `Sqrt`, and `N` are Compute Engine
operators. Lowercase names are normally the names you introduce.

## Names describe values

Use `let` for a name whose value will change, and `const` for one that should
not. Values themselves are immutable; `let` makes the *binding* movable.

```epsil
const secondsPerMinute = 60
let elapsed = 2
elapsed = elapsed + 1
elapsed * secondsPerMinute
// ➔ 180
```

That distinction makes it clear which programs are stateful. A collection is
never changed in place: an operation creates a new value, and you can choose
whether to bind it to a new name or replace an old binding.

```epsil
let readings = [3, 1, 2]
let sorted = Sort(readings)
(readings, sorted)
// ➔ ([3, 1, 2], [1, 2, 3])
```

Read [Declarations](/epsil/declarations/) for scopes, destructuring, and type
annotations; [Evaluation](/epsil/evaluation/) explains the value-and-binding
model in depth.

## Functions read like formulas

For a one-line mathematical definition, put parameters in parentheses and the
formula after `=`:

```epsil
circleArea(r) = Pi * r^2
circleArea(3)
// ➔ 9π
```

For a function with local names or several steps, use a block. The last
expression is the result, so there is no `return` ceremony:

```epsil
function hypotenuse(a, b) {
  let squared = a^2 + b^2
  Sqrt(squared)
}
hypotenuse(3, 4)
// ➔ 5
```

Anonymous functions use `=>`. They are especially useful for a small
transformation passed to a collection operator:

```epsil
Map(n => n^2, 1..5)
// ➔ [1, 4, 9, 16, 25]
```

Use a named function when its name explains the operation or the body needs
room to grow; use a lambda when the transformation is local and obvious. More
forms, including recursion and multiple clauses, are in
[Control Flow](/epsil/control-flow/#functions).

## Branches produce values

`if` is an expression, not merely a way to choose which statements run. That
means it naturally fits in a definition or assignment:

```epsil
sign(n) = "positive" if n > 0 else "not positive"
sign(-7)
// ➔ "not positive"
```

Choose the compact conditional when both outcomes are simple expressions. Use
the block form when either branch needs local work:

```epsil
function describe(n) {
  if n % 2 == 0 { "even" } else { "odd" }
}
describe(42)
// ➔ "even"
```

The same expression-oriented style applies to `match` and blocks. It lets the
shape of a computation stay close to the shape of the value it produces.

## Transform collections in their natural order

Lists are ordered and indexed from 1. Ranges such as `1..10` include both
endpoints. Use a pipeline when data goes through several transformations:

```epsil
1..10
  |> Filter(n => n % 2 == 0)
  |> n => n^2                         // Map(n => n^2, _)
  |> Sum
// ➔ 220
```

Pipelines read from input to result, rather than inside out. The `_` marks the
argument position filled by the piped value, which matters when `Map` or
`Filter` has another argument as well.

For work whose purpose is changing a binding — an accumulator, for example —
use a loop:

```epsil
let total = 0
for n in 1..100 { total = total + n }
total
// ➔ 5050
```

Use `Map`, `Filter`, and `Reduce` for value-producing iteration; use `for` and
`while` when performing a sequence of updates is the clearest model.

## Types document important boundaries

Epsil infers types for ordinary code, so annotations are optional. Write one
where it communicates an assumption that callers must meet:

```epsil
meanOfPair(a: real, b: real) -> real = (a + b) / 2
meanOfPair(2, 7)
// ➔ 9/2
```

Here the annotation is useful because the function models a numerical
operation, not because every local calculation requires paperwork. It lets
Epsil reject an unsuitable argument at the call boundary instead of leaving a
surprising expression downstream.

## Keep going

The [Getting Started](/epsil/getting-started/) guide shows how to run Epsil in
the REPL, from a file, and from JavaScript. Then choose a guide based on the
problem in front of you:

<ReadMore path="/epsil/examples/">
Browse **complete programs** for calculus, statistics, linear algebra,
strings, collections, and more.
</ReadMore>

<ReadMore path="/epsil/control-flow/">
Learn **functions, pattern matching, loops, blocks, and pipelines** in depth.
</ReadMore>

<ReadMore path="/epsil/from-python/">
Translate familiar **Python idioms**, including the differences that matter for
exact arithmetic and 1-based indexing.
</ReadMore>

When you need a precise rule rather than a guided explanation, use the
[Language Reference](/epsil/#language-reference).
