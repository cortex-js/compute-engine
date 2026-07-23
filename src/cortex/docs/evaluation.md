---
title: Cortex Evaluation
sidebar_label: Evaluation
slug: /cortex/evaluation/
description: "Cortex Evaluation"
hide_title: true
date: Last Modified
---
# Evaluation

`executeCortex(ce, source, options?)` parses a Cortex program and evaluates
each top-level statement **sequentially**, in the engine's current scope —
a notebook cell, or a chain of cells sharing one scope. The result is the
**last statement's** value:

```ts
const { value, diagnostics } = executeCortex(ce, 'let x = 5\nx = x + 3\nx');
// value.re === 8
```

No scope is pushed around the whole program: declarations persist across
statements (and across cells, in a notebook that chains calls to
`executeCortex` against the same engine), the same way variables persist
across cells in a REPL. Blocks and function bodies still push their own
lexical scopes (see [Control Flow](/cortex/control-flow/)).

## Symbolic by default

Evaluation follows the engine's ordinary exactness contract: a top-level
expression evaluates the same way `ce.parse(latex).evaluate()` does. A
transcendental of an exact argument stays symbolic —

```cortex
Ln(2)
```

evaluates to the symbolic `Ln(2)` (`ln(2)`), not a decimal approximation.

**Numeric approximation is explicit**, via `N(expr)` — it is a function
call, not a language mode:

```cortex
N(Ln(2))
```

evaluates to `0.6931471805599453…`.

## Collections: literals are values, pipelines are generators

A collection **literal** — a list `[…]`, set `{…}`, tuple `(…)`, or
dictionary — evaluates its elements when the statement executes. Assigning
one to a variable stores a snapshot of the element *values*:

```cortex
let xs = []
for k in Range(1, 3) { xs = Join(xs, [k]) }
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

Per [Principles](/cortex/principles/), "errors are values": a *runtime*
problem — a type error, an out-of-domain argument, reassigning a `const` —
flows as an embedded `["Error", …]` MathJSON value, not as a thrown
exception. `executeCortex` never throws for a runtime problem; it catches
the underlying engine exception (for the handful of paths, like a `const`
reassignment, that still throw internally) and returns an `Error` value in
its place.

*Parse*-time problems are different: a malformed program surfaces through
the `diagnostics` array, not through `value`. So are the few execution-time
problems that are really about the source, not the computation — a gated
host pragma, or a `#error` directive (see below) — which also go to
`diagnostics` rather than becoming an `Error` value.

Because only the **last** statement's value is returned, an error value
produced by an earlier statement would otherwise vanish silently. Each
*non-final* statement that evaluates to an error value therefore also emits
a `runtime-error` diagnostic — for example an indexed assignment
(`xs[2] = 9`, which the engine rejects: element assignment is not
supported), or reassigning a `const` in the middle of a program.

## Pragma security

`#env(...)` and `#navigator(...)` read state from the host process (or the
browser) at parse time. Because a notebook document can be shared or opened
in an unfamiliar environment, both are **gated off by default**:

<!-- cortex-test: expect-diagnostics -->

```cortex
#env("HOME")
```

with the default options produces a `host-pragma-disabled` diagnostic and no
host read — the pragma evaluates to `Nothing`. Passing
`{ allowHostPragmas: true }` to `executeCortex` opts back in and lets `#env`/
`#navigator` read the host as documented in [Pragmas](/cortex/pragmas/).

The benign pragmas — `#line`, `#column`, `#url`, `#filename`, `#date`,
`#time` — always work; they don't read anything sensitive from the host.

`#error(...)` never throws a `FatalParsingError` out of `executeCortex`: it
is converted to an `error-directive` diagnostic, so a single bad cell can't
crash the host embedding it.

## Interruptibility

A host can give a Cortex evaluation an explicit time budget by wrapping it in
the Compute Engine's `withTimeLimit()` span:

```ts
const result = ce.withTimeLimit(
  { ms: 500, label: "cortex-cell" },
  () => executeCortex(ce, source, { parseLatex })
);
```

The engine's `iterationLimit` and `recursionLimit` provide independent
count-based bounds. `executeCortex()` converts a limit breach during execution
into an error value (or an `evaluation-canceled` diagnostic when it occurs in a
non-final statement).

These limits are cooperative. A browser that evaluates untrusted or potentially
unbounded programs should run Cortex in a Web Worker that the host can terminate
from the outside. See
[Execution Constraints](/compute-engine/guides/execution-constraints/) for the
complete cancellation model.
