---
title: Cortex Evaluation
permalink: /cortex/evaluation/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
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

## Pragma security

`#env(...)` and `#navigator(...)` read state from the host process (or the
browser) at parse time. Because a notebook document can be shared or opened
in an unfamiliar environment, both are **gated off by default**:

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

A long-running evaluation respects the engine's existing deadline mechanism
(`ce.timeLimit`/`ce.deadline`) — the same cancellation path any other engine
evaluation uses. This is what lets a host notebook offer a stop button on a
runaway cell.
