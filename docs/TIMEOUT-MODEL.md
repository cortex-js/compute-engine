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

Only a timeout can become a fallback. A `CancellationError` that is not a
timeout — an abort signal, an iteration limit (`iteration-limit-exceeded`), or
the recursion-depth limit of user functions (`recursion-depth-exceeded`) —
always propagates to the caller. The catch blocks that change an error into a
fallback call `throwIfCallerCancellation()` (`src/common/interruptible.ts`)
first. So:

- `compile()` throws such a cancellation. It does not change it into
  quadrature code (for the antiderivative attempt of `Integrate`) or into the
  interpreter fallback, also when `fallback: true` (the default).
- `Integrate` throws such a cancellation when it comes from the Rubi rule
  driver (`RubiDriver.int()`, and `safeSimplify()` in the rule helpers). Rubi
  does not change it into "no closed form".
- Numeric integration (`Integrate(...).N()`, `NIntegrate`, and the compiled
  `_SYS.integrate`) throws the timeout when the deadline expires during
  adaptive quadrature or Monte Carlo sampling. It does not return the partial
  sum of the panels or samples computed so far, because that number has no
  mark that it is incomplete (user decision 2026-09-23).

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

### 7.4 Step budgets

A wall-clock sub-budget makes a RESULT depend on the machine: an internal
search that gives up after 2 s closes an integral on a fast machine and leaves
it unevaluated on a slow or loaded one. An internal search whose result
changes when it gives up therefore uses a step budget
(`engine._withBudget({ steps, ms, label }, fn)`, internal):

- A step is one call of `checkDeadline` with the engine frame. The frame
  holds the step budgets of the active spans (`DeadlineFrame.budgets`), and
  each call counts one step against each of them.
- A spent budget throws the same error as an expired labelled span: a timeout
  `CancellationError` with the span's label as its attribution (message "Step
  budget exhausted"). So the rules of §2 apply unchanged: the code that armed
  the budget falls back, and every catch block inside the span throws the
  error again, because the frame it sees is spent. A spent budget stays
  spent, so a catch block that ignores the error meets it again at the next
  step.
- Stride counters that amortize the check (`checkDeadlineEvery`) keep their
  count on the frame, not in a module-level variable. So the steps of a span
  do not depend on the work that ran before it.
- A large `ms` stays beside the steps, only as a guard against a hang in code
  that does not count steps. Such code existed: a polynomial GCD whose
  big-decimal coefficients grew to thousands of digits spent seconds between
  two steps (`∫ 1/(2+3x⁴)² dx` hit the guard). Since 2026-09-24 the GCD refuses
  inexact coefficients and the coefficients of that integral stay exact, so it
  takes 0.1 s; one problem of a 200-problem chapter-1 sample
  (1.2.2.4 #214, time spent in the rule matcher) still reaches the guard,
  which therefore still decides there.

The Rubi integration driver (300,000 steps per integral, 30 s guard) and the
compiler's closed-form attempt of `Integrate` (300,000 steps per attempt,
600,000 per compilation, 30 s guard) use step budgets.

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
program continues. A fallback for a timeout (§2) does not catch such a breach:
the `compile()` fallback and the "no closed form" result of Rubi let it
propagate.

Do not infer deadline semantics from a count-based cap:

- a timeout is attributed to a dynamic span and normally propagates;
- an iteration/recursion breach is attributed to the guarded construct;
- increasing a count cap does not extend an enclosing time budget;
- exhausting a local count cap does not imply that the enclosing deadline has
  expired.
