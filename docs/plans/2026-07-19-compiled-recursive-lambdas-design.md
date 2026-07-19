# Compiled Recursive Lambdas — Design (ratified: lenient recursion)

**Date**: 2026-07-19 (v2 — supersedes the same-day v1 unrolling-first draft)
**ROADMAP**: "Compiled recursive lambdas" — Product feature track, from the
Tycho item-59 secondary ask (c062d54000 iterated-map session).
**Status**: RATIFIED and implemented 2026-07-19. Decision: **lenient
true-recursion emission** on the registry-hosting targets (JavaScript,
interval-JS); GPU stays fail-closed; compile-time unrolling is demoted to a
GPU-gated follow-up; the previously sketched opt-in depth-guard rung
(`recursion: { maxDepth }`) is **dropped**.

## Problem

A self-recursive user lambda (`J(n,z) := n ≤ 0 ? z : J(n-1,z)² + z₀`)
evaluated correctly via `.N()` but `compile()` failed closed (D6) on the
`registry.compiling` re-entry check in `ensureUserFunctionEmitted`
(`compilation/base-compiler.ts`), on the theory that emitted code would lose
the engine's termination guarantees and a runaway inside a per-pixel render
loop would freeze the tab.

## Why lenient recursion (the evidence)

All measured 2026-07-19, tsx on source, Node 22 / V8:

1. **The "frozen tab" premise was wrong for JS recursion.** Runaway
   self-recursion throws a catchable `RangeError` after ~9,100 frames in
   **< 1 ms** — the stack self-terminates. V8 and SpiderMonkey have no
   tail-call optimization, and JSC's proper tail calls apply only in strict
   mode, which the emitted (sloppy-mode `Function` constructor) code never
   is. Frozen tabs come from infinite *loops* — and compiled code already
   emits a bare `while (true)` for an unbounded `Loop`
   (`base-compiler.ts`, `compileForLoop`), while GPU targets reject it at
   compile time. Lenient recursion follows exactly that established
   contract split, and recursion is the *safer* of the two constructs.
2. **Recursion is fast.** The emitted compact self-calling function is
   V8-friendly (inlining + escape analysis). Measured on the depth-10 Julia
   map (complex, per-point): recursive emission **0.180 µs/pt** vs the
   hand-unrolled closed-form emission **1.25 µs/pt** before this round
   (see the square fast path below — the closed form also improves).
3. **Compile-time unrolling alternatives were worse.** "Symbolically
   `evaluate()` then compile the closed form" is exponential in depth over a
   symbolic argument (depth 5 = 307 ms, depth 10 > 60 s; the
   `Add.evaluate → addN → ops.map(.N())` path re-walks the nested operand at
   every level — a latent interpreter perf issue in its own right, tracked
   separately). Codegen-level specialization (memoized per-literal-args
   emission with condition pruning) is sound and linear — the v1 draft
   specifies it — but it is machinery that lenient emission makes
   unnecessary on CPU targets. It remains the only possible **GPU** story
   (WGSL/GLSL cannot recurse) and is parked as a demand-gated follow-up.

## The design

### Emission

In `ensureUserFunctionEmitted`: a re-entrant name (present in
`registry.compiling`) is a (mutually) recursive reference — **return the
emitted local name** instead of throwing. The definition lands in
`registry.defs` when its body compile completes; all defs execute in the
preamble before any call runs, so every name (including a mutually
recursive forward reference) is bound by call time. No caps, no counters,
no new options. Non-recursive functions are emitted exactly as before.

- **JavaScript + interval-JS**: recursion compiles (they host the
  `userFunctions` registry).
- **GPU (GLSL/WGSL) and Python**: unchanged — no registry, user functions
  (and therefore recursion) stay fail-closed. If GPU recursion is ever
  needed, the v1 specialization design (memoized literal-argument
  unrolling, non-recursive by construction, hence expressible as shader
  `fn`s) is the route — gated on a real GPU consumer.

### Runtime contract (documented divergence)

Termination is the caller's responsibility, as it already is for compiled
unbounded `Loop`. On the `javascript` target, runaway recursion throws a
catchable `RangeError`. On `interval-js`, the runner's apply proxy converts
every runtime error — including stack exhaustion — to the *entire* interval
(`{ kind: 'entire' }`, "cannot bound"), consistent with that target's
existing error philosophy; there is no catchable error there. (Python
target n/a; would be `RecursionError` if Python ever grows user
functions.) Interpreter parity: the interpreter throws `CancellationError`
on `timeLimit` instead. Failure depth is engine- and stack-depth-dependent
(~9k frames at Node top level; less inside a deep caller stack) — callers
with plot-mask semantics should catch and mask themselves. Each overflow
costs ~0.33 ms, so an all-points-runaway per-pixel sweep is a performance
cliff, not a freeze, and is abortable on first error.

### Typing requirement for complex recursion (consumer-facing)

An untyped self-recursive lambda's application types as
`broadcastable<number>` (correct: a list argument would broadcast). Real
arithmetic over that routes through `_SYS.bcast` and compiles; **complex**
arithmetic hits the deliberate complex-element bcast deferral and fails
closed. The supported shape is a **`Typed` return ascription** on the body,
which pins the self-call scalar:

```json
["Function",
  ["Typed",
    ["Which", ["LessEqual", "n", 0], "z",
              "True", ["Add", ["Power", ["K", ["Subtract", "n", 1], "z"], 2],
                              ["Complex", 0.35, 0.4]]],
    {"str": "complex"}],
  ["Typed", "n", {"str": "integer"}],
  "z"]
```

(Param ascriptions alone don't suffice — the *return* type is what the
self-call's consumers see. A `complex`-ascribed *parameter* also rejects
`x + iy` arguments, which type as `number`; leave data params untyped or
`number`.)

### Complex literal-square fast path (shipped with this round)

`Power(base, 2)` with a complex-valued base emitted `_SYS.cpow(base, 2)` —
general polar-form power (hypot/atan2/exp/…) per call. Now inlined as the
direct complex multiply (temp-bound for compound bases, matching the
item-59 Add CSE convention) in the JS target. This is both ~10× faster in
iterated-map loops and **better parity** (the interpreter multiplies;
polar rounds differently). Cubes and higher literal powers still route
through `cpow` (pinned in tests; extend on demand).

Measured effect (depth-10 Julia, µs/pt): recursive 1.201 → **0.180**;
hand-unrolled closed form 1.250 → **0.142**. Both ~7–9× faster than the
pre-round emission class; digit parity with the interpreter at sample
points.

## Tests

`test/compute-engine/compile.test.ts` ("COMPILE user-defined function
calls"): direct recursion (`fact(5)` = 120), runtime (non-literal) depth
(`fact(m)`), digit parity vs interpreter (quadratic map), terminating
mutual recursion (even/odd), runaway → compiles `success: true` and throws
`RangeError` at run time. `test/compute-engine/compile-complex.test.ts`:
inline complex square (no `cpow`) + value check, cube still `cpow`
(fast-path scope pin), recursive typed-return Julia lambda digit parity.
The two prior fail-closed pins (direct + mutual recursion) were flipped —
that behavior change is the feature.

## Superseded material

The v1 draft's memoized literal-argument specialization design (subs +
condition-only pruning, `_fn_J__n_10` per-tuple emission, DAG memoization
— linear even for Fibonacci-style double recursion) is preserved in git
history and remains the reference design for a future GPU unrolling rung.
Its two load-bearing probe facts carry over: `subs` folds decremented
literal args in ~1 ms without touching the recursive call, and decidable
`Which`/`If` conditions are cheap to fold in isolation.
