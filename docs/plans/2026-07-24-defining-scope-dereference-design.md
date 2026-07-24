# Defining-Scope Dereference of Symbol Values

**Status**: DESIGN — approved direction ("re-evaluate on reference is the
right path", 2026-07-24), implementation pending this design's review.
**Executable spec**: `test/compute-engine/symbol-value-scoping.test.ts`
(characterization tests; the `@fixme` assertions flip to their documented
intended values when this lands).

## Problem

Two user-visible defects are symptoms of one root cause: **dereferencing a
symbol's stored value has no notion of the value's defining scope.**

### Symptom 1 — staleness ("one-evaluate-late")

```
let d = 3x^2 + 1      // x free at this point
let x = 2
d                     // → 3x^2 + 1   (stale)
N(d)                  // → 13         (N resolves; evaluate does not)
```

`BoxedSymbol.evaluate()` (non-constant path, `boxed-symbol.ts` ~829) returns
`_getSymbolValue(id)` **verbatim** — the value was evaluated at assignment
time and free symbols inside it are never re-resolved. Each additional
`evaluate()` resolves one more layer; `N()` recurses fully. `evaluate()` and
`N()` therefore disagree about what `d` *is*.

### Symptom 2 — dynamic name capture through call frames

```
let a = x + 1
g(x) = a
g(5)                  // → 6    (the call frame's x = 5 captured a's free x!)
```

Worse, the frame wins **even over an existing, lexically-correct global**:

```
let a = x + 1
let x = 100
g(x) = a
g(5)                  // → 6, not 101
```

The capture is purely by name (a parameter named `z` doesn't capture), it
happens through lambda frames too (`x |-> a`), and it does **not** happen
through block-locals (`do { let x = 99; a }` stays clean) — so current
behavior is not even consistently dynamic; it is an artifact.

Mechanism: the applied body's result is evaluated once more while the call
frame is still pushed, and `_getSymbolValue` resolves names against the
**runtime** chain, where the frame's parameter shadows the defining-scope
binding.

## Evidence base (2026-07-24 experiment)

A naive prototype (re-evaluate the stored value in the *current* context at
dereference, mirroring `N()`'s Tycho-46 self-reference guard — patch preserved
in the session record, ~10 lines in `BoxedSymbol.evaluate`) established:

- **Full suite: zero churn.** 18,684 tests, 4,176 snapshots, all green with
  the naive patch applied. Nothing in the corpus depends on one-evaluate-late
  staleness — and nothing covers the capture bug either (coverage gap now
  closed by the executable spec).
- **Perf: neutral.** Symbol-deref microloop ~5–6 µs/iter both with and
  without the patch (an initial 25 µs baseline reading was machine-contention
  noise; caught by control reruns). A 20k-iteration Cortex loop: 13–15 ms
  both ways (number-literal fast path preserved).
- **But the naive patch is semantically disqualified**: evaluating in the
  *current* frame makes block-locals capture too (`do { let x = 99; a + y }`
  returned 105 instead of the lexical `x + 6`), and mutual references drift
  (`a = b+1; b = a+1; a` → `b + 3` instead of `b + 1`).

## Proposed semantics

> **A stored value's free symbols mean their bindings in the scope where the
> value was stored.** At dereference, the value is re-evaluated **against the
> def's own scope chain** — never against the caller's frame.

Outcomes (these are the spec-test flips):

| Case | Today | Proposed |
|:--|:--|:--|
| `let d = 3x²+1; let x = 2; d` | `3x²+1` | **13** (same-scope assignment resolves; agrees with `N`) |
| `let a = x+1; g(x) = a; g(5)` | `6` | **`x + 1`** (global x unbound; frame never intercepts) |
| … with `let x = 100` global | `6` | **`101`** |
| `let a = x+1; g(z) = a; g(5)` | `x + 1` | `x + 1` (unchanged) |
| `do { let x = 99; a }` | clean | clean (unchanged) |
| `a = b+1; b = a+1; a` | `b + 1` | terminates; residual form may change but must be cycle-safe |

The rule that keeps this coherent with function application: **the evaluation
context for body *source* is the frame (parameters must resolve); the
evaluation context for a dereferenced stored *value* is the def's scope.**
The N-threading lesson (2026-07-11) already established the body-source half:
approximate inside the closure's frame, never re-evaluate a lambda result
after the frame pops. This design adds the missing value half.

## Design sketch

1. **Defs remember their scope.** A `_BoxedValueDefinition` lives in exactly
   one `scope.bindings`; give it a back-reference to that scope (set at
   declaration; already implicitly available at every `declareSymbolValue`
   site). Watch the interaction with the async-scope-lifetime machinery
   (identity-based frame removal, 0.92.1): a def's scope back-reference must
   not extend a popped frame's lifetime beyond what closures already do.

2. **Dereference evaluates in that scope.** In `BoxedSymbol.evaluate()`'s
   non-constant path, replace "return stored value verbatim" with:
   - number-literal fast path (unchanged, O(1), keeps loop indices hot);
   - self-reference guard (unchanged — Tycho item 46: substitute once when
     the value mentions the symbol itself);
   - **new**: cycle guard — a per-engine "dereference in progress" set keyed
     by def identity; on re-entry, return the stored value unevaluated (this
     is what keeps `a = b+1; b = a+1` finite and stable, where the naive
     patch drifted);
   - otherwise evaluate the stored value with the engine's lexical context
     temporarily switched to the def's scope (an `inScope(scope, fn)`
     helper; the engine already swaps context frames for async evaluation —
     reuse that mechanism, not a new one).

3. **Re-examine the invoke-path extra evaluation.** The in-frame
   re-evaluation of the applied body's result (`function-utils`, the invoke /
   nullary paths) is what converts one-evaluate-late into name capture. Once
   dereference is scope-correct, that extra evaluation becomes harmless for
   stored values (they resolve in their own scope) — but audit whether it is
   still needed at all, and for what. Do NOT reopen the shared-canon-scope
   model (the failed 2026-07-07 redesign; block-scope-capture notes) — this
   design deliberately leaves how bodies bind untouched.

4. **`N()` unification.** Once `evaluate()` resolves in the defining scope,
   `N()`'s non-constant path should route through the same resolution (its
   current context-value walk is the same name-based mechanism and has the
   same capture exposure — verify with the spec's lambda case under `N`).

## Non-goals

- No change to constants, `holdUntil`, or assignment-time evaluation.
- No change to collection laziness ("literals are values, pipelines are
  generators") — this is about symbol dereference, not materialization.
- No reopening of canonicalization scope-capture for function bodies.

## Risks / open questions

- **Scope lifetime**: def→scope back-references may retain popped frames in
  long sessions (REPL/notebook engines live long). Mitigation: the back-ref
  points at the *lexical* scope object already retained by the binding
  itself; measure heap on the notebook-sized session before/after.
- **Concurrent async evaluations** share one engine context (deliberately
  unfixed, needs task-local propagation): switching context to a def's scope
  during dereference must use the same discipline as the async frame
  machinery to avoid cross-talk.
- **Cycle-guard residual forms**: on cycle hit we return the stored value
  unevaluated; mutual-reference residuals may print differently than today.
  The spec pins only termination, not the exact residual.
- **Perf**: measured neutral for the naive patch; the scope switch adds a
  context swap per non-literal deref. Gate on the box-microloop canary
  (~0.02 ms/iter) and the 20k-loop timing before landing.

## Test plan

- Flip the `@fixme` assertions in
  `test/compute-engine/symbol-value-scoping.test.ts` to their documented
  intended values; the non-`@fixme` tests (name-sensitivity, block-local
  cleanliness, cycle termination, loop hot path) must pass unchanged.
- Full suite + snapshot-churn measure (expect near-zero: the naive patch had
  zero).
- Perf canary + 20k-loop A/B with control reruns.
- Cortex route parity (the spec already exercises both `ce.box` and
  `executeCortex` routes).

## Appendix: the naive prototype (measured, then reverted)

For reference — the current-context variant that produced the evidence base.
It is NOT the proposed implementation (it evaluates in the caller's context,
which is what makes block-locals capture):

```diff
--- a/src/compute-engine/boxed-expression/boxed-symbol.ts
+++ b/src/compute-engine/boxed-expression/boxed-symbol.ts
@@ -829,6 +829,14 @@ export class BoxedSymbol extends _BoxedExpression
         let expr = this.engine._getSymbolValue(this._id) ?? this;
         if (expr.operator === 'Unevaluated')
           expr = expr.evaluate(options) ?? this;
+        // EXPERIMENT (#3, 2026-07-24): re-evaluate the stored value so free
+        // symbols assigned *after* it was stored resolve at dereference time
+        // (`let d = 3x^2+1; let x = 2; d` → 13, matching `N(d)`). Guards
+        // mirror `N()`: number literals take the O(1) fast path; a value
+        // mentioning this very symbol substitutes ONCE without recursing
+        // (Tycho item 46's self-reference guard).
+        else if (!isNumber(expr) && !expr.symbols.includes(this._id))
+          expr = expr.evaluate(options);
         return expr;
       }
     }
```
