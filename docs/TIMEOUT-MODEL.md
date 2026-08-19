# Execution Deadline Invariants

This document records the internal deadline and cancellation contracts. Public
API guidance is in
[`doc/_99-guide-execution-constraints.md`](../doc/_99-guide-execution-constraints.md).

## 1. Current contract

The engine has no ambient default deadline. Synchronous work is unbounded unless
the caller explicitly wraps it in `ce.withTimeLimit(limit, fn)`.

A deadline is cooperative: long-running engine loops poll the current deadline
between units of work. It cannot interrupt a blocking host call such as one
`RegExp.exec()`, a synchronous third-party function, or arbitrary user code.

Iteration and recursion limits are separate count-based safety mechanisms. They
are not timeouts and do not share deadline attribution.

## 2. Composition and attribution

Deadline spans compose by minimum: nested work receives the earliest deadline
of the active spans. A child may tighten its parent's budget but cannot extend
it.

`CancellationError` records which span expired. A handler may degrade
gracefully only when its own child span owns the expiration; it must propagate
an expiration attributed to an enclosing caller.

The useful rule is:

> Budgets compose; scoped configuration shadows.

This distinguishes deadline frames from random-seed frames, whose innermost
configuration wins outright.

## 3. API

`withTimeLimit()` accepts either a millisecond count or an object with `ms` and
an optional diagnostic `label`:

```ts
ce.withTimeLimit({ ms: 500, label: "preview" }, () => expr.evaluate());
```

The callback's result is returned unchanged. An expired deadline throws a
`CancellationError`; ordinary expression-domain failures remain `Error`
values.

The deadline stack is engine state. Entry pushes a frame and every exit path —
normal return, cancellation, or another exception — restores the exact prior
frame.

## 4. Cooperative checkpoints

Algorithms that may perform unbounded or input-proportional work must poll at a
natural loop boundary. Polling should be frequent enough to bound overrun but
not inserted into tiny leaf operations solely for uniformity.

Typical checkpoint sites include:

- collection iteration and materialization;
- `Sum`, `Product`, `Reduce`, and other big operators;
- search, factoring, root, limit, and numerical-integration loops;
- rewrite or solver loops whose progress is data-dependent;
- compilation passes that may traverse or expand an unbounded structure.

Nested helpers should use the current frame rather than creating a fresh
budget unless they intentionally define and attribute a smaller sub-budget.

## 5. No ambient `ce.timeLimit`

The former mutable `ce.timeLimit` property was removed. It made unrelated work
consume an implicit global budget, made nesting ambiguous, and caused expired
state to leak across calls.

Outside a `withTimeLimit()` span, synchronous work is deliberately unbounded.
Tests use their runner's watchdog to detect a hang; they do not rely on an
engine-wide default.

## 6. Synchronous and asynchronous cancellation

Deadline spans are synchronous dynamic scope. They remain installed only while
the `withTimeLimit()` callback is on the stack.

### 6.4 Async boundary

If the callback returns a promise, the synchronous span exits before later
promise continuations run. Work after the first asynchronous boundary is not
bounded by that span.

Asynchronous evaluation uses `evaluateAsync({ signal })` with an
`AbortSignal`. The signal is also cooperative: only handlers and loops that
consult it can stop. A plain promise or blocking host call cannot be forcibly
interrupted by the engine.

The engine is not designed for concurrent asynchronous evaluation sharing one
mutable instance. Deadlines, scopes, assumptions, inference, and random frames
all rely on engine-local dynamic state. Use isolated engine instances when
concurrent work needs independent state.

## 7. Nesting and restoration

Every scoped runtime mechanism must restore the frame it observed on entry,
not a reconstructed approximation. This includes cancellation and thrown host
exceptions.

A helper that installs a child deadline must not clear the parent deadline,
reset its start time, or replace its attribution when the child exits.

### 7.3 Internal sub-budgets

An operator may establish a labeled child span to bound an optional strategy
and fall back when that child expires. If the enclosing span expires first, the
operator must propagate the cancellation rather than treating it as permission
to continue with a fallback.

## 8. Migration result

The deadline-stack migration is complete:

- `ce.timeLimit` is gone;
- explicit spans are the only synchronous deadline source;
- timeout catches use `CancellationError` attribution;
- unguarded algorithmic loops are treated as local defects;
- asynchronous APIs use abort signals rather than synchronous spans.

Implementation chronology and the original loop census remain in Git history.

## 9. Non-time limits

Iteration and recursion limits are intentionally configuration values rather
than compositional deadlines. They protect a construct or call shape, and an
operator may turn a local limit breach into an ordinary error value before the
program continues.

Do not infer deadline semantics from a count-based cap:

- a timeout is attributed to a dynamic span and normally propagates;
- an iteration/recursion breach is attributed to the guarded construct;
- increasing a count cap does not extend an enclosing time budget;
- exhausting a local count cap does not imply that the enclosing deadline has
  expired.
