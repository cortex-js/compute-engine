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
becomes an `Error` value embedded in the result, not a thrown exception. A
program never throws to its host for a runtime problem.

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

These limits are cooperative. A browser that evaluates untrusted or potentially
unbounded programs should run Epsil in a Web Worker it can terminate from the
outside. See
[Execution Constraints](/compute-engine/guides/execution-constraints/) for the
complete cancellation model.
