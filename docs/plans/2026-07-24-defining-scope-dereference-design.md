# Defining-Scope Dereference of Symbol Values

**Status**: DESIGN — approved direction ("re-evaluate on reference is the
right path", 2026-07-24); revised 2026-07-24 after a design review that
corrected the root-cause analysis of Symptom 2 (see §Mechanism and §Design
sketch step 3). Implementation pending.
**Executable spec**: `test/compute-engine/symbol-value-scoping.test.ts`
(characterization tests; the `@fixme` assertions flip to their documented
intended values when this lands).

## Problem

Two user-visible defects share a theme — **dereferencing a symbol's stored
value has no notion of the value's defining scope** — but they have *two
distinct mechanisms*, and only one of them lives in the dereference path.
Fixing dereference alone fixes Symptom 1; Symptom 2 additionally requires a
change in the function-application path (§Design sketch step 3).

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

The **constant** branch one level up (`boxed-symbol.ts` ~820) already does the
right thing structurally — it returns `def.value?.evaluate(options)`, i.e. it
re-evaluates the stored value on every dereference. A constant declared with
value `3x^2 + 1` evaluates to `13` once `x = 2`. The non-constant path is the
outlier. (But see Symptom 2: the constant path re-evaluates in the *current*
context, which is the semantics this design disqualifies.)

The compiled path also already resolves deeply:
`compile(ce.box('d'))?.code` → `(3 * (2 * 2) + 1)`, via
`BaseCompiler.tryFoldKnownSymbol` (`base-compiler.ts` ~3232). So among
interpret / `N` / compile, plain `evaluate()` is the only route that reports
`3x^2 + 1`. Landing this closes a live interpret-vs-compile divergence.

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

### Mechanism (corrected 2026-07-24)

There are **two independent capture channels**. An earlier revision of this
doc attributed the capture to "the applied body's result is evaluated once
more while the call frame is still pushed"; that is not the mechanism for the
non-constant case.

**Channel A — post-evaluation parameter substitution (non-constant values).**
`function-utils.ts:1158`, the Tycho item 26 block: after the body evaluates,
any parameter name still present in the *result* is rewritten to that
parameter's value via `captureAvoidingSubs`. It cannot tell an unevaluated
reference to the parameter (what item 26 exists to fix) from a free symbol
that arrived inside a dereferenced stored value — they are the same name.

The decisive evidence is a capture in a frame where **no dereference happens
at all**:

```
let a = x + 1
g(z) = a        // z parameter: the deref of `a` is clean, returns x + 1
h(x) = g(1)
h(5)            // → 6   ← h's frame captured g's already-returned x + 1
```

Measured: gating off that one block flips all three `@fixme` capture
assertions with the dereference path untouched. Therefore **step 2 alone does
not fix Symptom 2**.

**Channel B — in-frame re-evaluation (constants).** The constant branch
evaluates its stored value while the call frame is pushed, so its free symbols
resolve against the runtime chain directly. Measured with Channel A disabled:
a constant `kk = x + 1` with `g(x) = kk` still yields `g(5) → 6`. This channel
*is* in the dereference path and step 2 does fix it — which is why "no change
to constants" is no longer a non-goal.

A third site, the `numericApproximation` re-evaluation at
`function-utils.ts:1180`, is in the same frame and must be audited alongside
Channel A.

## Evidence base (2026-07-24 experiments)

A naive prototype (re-evaluate the stored value in the *current* context at
dereference, mirroring `N()`'s Tycho-46 self-reference guard — patch preserved
in the session record, ~10 lines in `BoxedSymbol.evaluate`) established:

- **Full suite: zero churn.** 18,684 tests, 4,176 snapshots, all green with
  the naive patch applied. Nothing in the corpus depends on one-evaluate-late
  staleness — and nothing covers the capture bug either (coverage gap now
  closed by the executable spec).
- **Perf: neutral on the number-literal fast path only.** Symbol-deref
  microloop ~5–6 µs/iter with and without the patch (an initial 25 µs baseline
  reading was machine-contention noise; caught by control reruns). A 20k-
  iteration Cortex loop: 13–15 ms both ways. Both of these measure values that
  are *number literals*; see §Risks for the symbolic-value cost, which is the
  case this change actually affects.
- **But the naive patch is semantically disqualified**: evaluating in the
  *current* frame makes block-locals capture too (`do { let x = 99; a + y }`
  returned 105 instead of the lexical `x + 6`), and mutual references drift
  (`a = b+1; b = a+1; a` → `b + 3` instead of `b + 1`). Note this is exactly
  what the constant path does today (Channel B).

A second experiment gated off the Tycho item 26 substitution
(`function-utils.ts:1158`) and ran the full suite:

- **Flips all three capture `@fixme`s** — with no change to the deref path.
- **Breaks 8 genuine tests**, zero snapshot churn (`11 failed, 18796 passed,
  4176 snapshots passed`):
  - `collections.test.ts` — Map `each()`, Map `evaluate()`, Tabulate, direct
    `Apply` ("substitutes the element into an undetermined body")
  - `functions.test.ts` — "held conditional branch is substituted when
    argument shares the symbol"
  - `differential-equations.test.ts` — NDSolveFunction ×2 (compile
    composition; MathJSON round-trip via `N()`)
  - `cortex/documentation.test.ts` — live doc blocks

So the item 26 substitution cannot simply be deleted: step 3 needs
*provenance*, not removal.

## Proposed semantics

> **A stored value's free symbols mean their bindings in the scope where the
> value was stored.** At dereference, the value is re-evaluated **against the
> def's own scope chain** — never against the caller's frame.

Outcomes (these are the spec-test flips):

| Case | Today | Proposed | Needs |
|:--|:--|:--|:--|
| `let d = 3x²+1; let x = 2; d` | `3x²+1` | **13** (agrees with `N` and with compile) | step 2 |
| `let a = x+1; g(x) = a; g(5)` | `6` | **`x + 1`** (global x unbound; frame never intercepts) | step 3 |
| … with `let x = 100` global | `6` | **`101`** | steps 2 **and** 3 |
| `const kk = x+1; g(x) = kk; g(5)` | `6` | **`x + 1`** / `101` with a global | step 2 (Channel B) |
| `let a = x+1; g(z) = a; h(x) = g(1); h(5)` | `6` | **`x + 1`** | step 3 |
| `let a = x+1; g(z) = a; g(5)` | `x + 1` | `x + 1` (unchanged) | — |
| `do { let x = 99; a }` | clean | clean (unchanged) | — |
| `a = b+1; b = a+1; a` | `b + 1` | `b + 1` (unchanged — see step 2's cycle guard) | step 2 |

The rule that keeps this coherent with function application: **the evaluation
context for body *source* is the frame (parameters must resolve); the
evaluation context for a dereferenced stored *value* is the def's scope.**
The N-threading lesson (2026-07-11) already established the body-source half:
approximate inside the closure's frame, never re-evaluate a lambda result
after the frame pops. This design adds the missing value half.

### Ruling: free symbols are late-bound, assigned symbols stay early-bound

Assignment-time evaluation is unchanged (§Non-goals), so a stored value
snapshots whatever was *already bound* when it was written and stays live only
for what was *free*. That is observable as order-dependence — measured today,
and unchanged by this design:

```
let x = 2;  let d = 3x^2 + 1;  x = 3;  N(d)   // → 13   (x was bound: snapshot)
let d = 3x^2 + 1;  let x = 2;  x = 3;  N(d)   // → 28   (x was free: live)
```

Same three statements, different answers by declaration order. This is an
**accepted ruling**, not a defect — it is the direct consequence of keeping
assignment eager — but it is the first thing a user will report as a bug, so
it is pinned by the spec and must be documented in the user-facing docs when
this lands.

## Design sketch

1. **Defs remember their scope.** A `_BoxedValueDefinition` lives in exactly
   one `scope.bindings`; give it a back-reference to that scope.
   - Record it **where the value is stored** (the value setter,
     `engine-declarations.ts` ~405 / `setSymbolValue`), not only at
     declaration: `let a; do { a = u + 1 }` declares in the global scope but
     writes from the block, and the prose above says "the scope where the
     value was stored". If the two are ever meant to differ, say so
     explicitly; otherwise the setter is the single source of truth.
   - `updateDef` can replace the inner `_BoxedValueDefinition`, so both the
     back-reference and the cycle key (below) must survive that. Key on the
     `BoxedDefinition` wrapper held in `scope.bindings`
     (`engine-declarations.ts:350`), which is the stable identity.
   - Watch the interaction with the async-scope-lifetime machinery
     (identity-based frame removal, 0.92.1): a def's scope back-reference must
     not extend a popped frame's lifetime beyond what closures already do.
   - **Invariant this rests on**: call-frame parameter bindings are defs whose
     declaring scope is the *frame*, and that is the correct scope only
     because arguments are pre-evaluated in the caller (verified:
     `f(x,y) = x; let y = 7; f(y,2)` → `7`, not `2`). If any path ever binds
     an unevaluated argument, defining-scope dereference would capture it.
     State and test this invariant.

2. **Dereference evaluates in that scope.** In `BoxedSymbol.evaluate()`,
   replace "return stored value verbatim" (non-constant path) and "evaluate in
   the current context" (constant path — Channel B) with:
   - number-literal fast path (unchanged, O(1), keeps loop indices hot);
   - **memoized result** — cache the resolved value on the def, keyed by
     `ce._generation` (+ `_mutationGeneration`). This is not an optimization
     to add later: without it, every dereference of a symbolic value pays a
     full `evaluate()` (see §Risks for measured costs);
   - self-reference guard (unchanged — Tycho item 46: substitute once when
     the value mentions the symbol itself; keeps `f(t) = t + 1; f(t + 1)` at
     `t + 2`);
   - **cycle guard — abort, do not return locally.** A per-engine
     "dereference in progress" set keyed by def identity; on re-entry, throw a
     sentinel caught by the *outermost* dereference, which then returns its
     stored value verbatim. Returning the stored value at the re-entry point
     instead is wrong: for `a = b+1; b = a+1; a` it yields `b + 3` (eval `a`
     → `b+1` → eval `b` → `a+1` → re-entry returns `b+1` → `b` ⇒ `b+2` → `a`
     ⇒ `b+3`), which is precisely the naive-patch drift this design rejects.
     Returning the bare symbol instead yields `a + 2`. Only abort-and-unwind
     preserves today's `b + 1`;
   - otherwise evaluate the stored value with the engine's lexical context
     temporarily switched to the def's scope, via the **existing**
     `ce._inScope(scope, fn)` (`index.ts:1615`, `engine-scope.ts:106`) — no
     new mechanism needed. Note `_inScope` pushes a context whose
     *assumptions* are copied from the current context, so a dereference under
     `assume(x > 0)` re-evaluates with the def's bindings and the caller's
     assumptions. That hybrid is intended (assumptions are ambient, bindings
     are lexical); document it rather than leaving it implicit.

3. **Give the item 26 substitution provenance.** *(Load-bearing for Symptom 2
   — this is the fix, not cleanup.)* The parameter-value substitution at
   `function-utils.ts:1158` must stop rewriting occurrences that arrived
   inside a dereferenced stored value, while still rewriting genuine
   unevaluated parameter references (the Map/Tabulate/Apply/held-conditional
   cases listed in §Evidence base, which regress the moment it is disabled).
   Name-based `result.has(name)` cannot make that distinction; the design must
   carry provenance across the boundary. Candidate approaches, to be settled
   before implementation:
   - have step 2's dereference **tag** what it returns (a marker the
     substitution walk treats as opaque), then strip the tags at the end of
     the invoke;
   - **diff against the pre-substitution body**: substitute only at positions
     where the parameter symbol was present in the body *source*, computed
     once per invoke;
   - restrict substitution to the held-conditional / undetermined-body cases
     it was written for, and prove by test that nothing else depends on it
     (the measured 8 failures are the bar).

   Audit the sibling `numericApproximation` re-evaluation at
   `function-utils.ts:1180` under whichever approach is chosen. Do NOT reopen
   the shared-canon-scope model (the failed 2026-07-07 redesign;
   block-scope-capture notes) — this design deliberately leaves how bodies
   bind untouched.

4. **`N()` unification.** Once `evaluate()` resolves in the defining scope,
   `N()`'s non-constant path should route through the same resolution (its
   current context-value walk is the same name-based mechanism and has the
   same capture exposure — the spec now covers the capture cases under `N`).

## Non-goals

- No change to `holdUntil` or to assignment-time evaluation (see the ruling
  above for the order-dependence this implies).
- No change to collection laziness ("literals are values, pipelines are
  generators") — this is about symbol dereference, not materialization.
- No change to `.simplify()`, which is deliberately value-blind: dereference-
  time resolution is an `evaluate`/`N` behavior only.
- No reopening of canonicalization scope-capture for function bodies.

(Previously listed here: "no change to constants". Removed — the constant path
is Channel B of Symptom 2 and is brought under step 2.)

## Risks / open questions

- **Perf: the measured neutrality does not cover the affected shape.** Today a
  dereference of a symbolic value is a verbatim return (~free). Measured cost
  of the `evaluate()` this design would add per dereference:

  | stored value | `evaluate()` |
  |:--|--:|
  | `3x² + 2x + 1 + sin x + cos y` | **285 µs** |
  | `\sum_{k=1}^{5}(3x² + 2x + 1)` | **3.5 ms** |

  A 20k-iteration loop referencing a symbolic-valued variable would go from
  ~0.1 s to ~5.7 s. Hence the memo in step 2. The perf gate must include a
  **symbolic**-value loop; the existing numeric canary passes this regression
  silently.
- **Observable-API consistency**: after the fix `d.evaluate()` is a number
  while `d.freeVariables` still reports `x`. Consumers gate on
  `freeVariables`/`symbols` (and it is already dynamic-context-sensitive).
  Decide whether that pair needs to agree, or document that it does not.
- **Scope lifetime**: def→scope back-references may retain popped frames in
  long sessions (REPL/notebook engines live long). Mitigation: the back-ref
  points at the *lexical* scope object already retained by the binding
  itself; measure heap on the notebook-sized session before/after.
- **Concurrent async evaluations** share one engine context (deliberately
  unfixed, needs task-local propagation): switching context to a def's scope
  during dereference must use the same discipline as the async frame
  machinery to avoid cross-talk.
- **Cycle-guard residual forms**: the spec pins `b + 1` exactly (it is
  today's output and the abort-and-unwind guard preserves it). If
  implementation experience forces a different residual, the spec assertion —
  not this paragraph — is the thing to renegotiate.

## Test plan

- Flip the `@fixme` assertions in
  `test/compute-engine/symbol-value-scoping.test.ts` to their documented
  intended values. Note the split: the staleness and constant `@fixme`s flip
  on step 2; the capture `@fixme`s flip only once step 3 lands (a partial
  landing leaves them red, which is the intended acceptance gate). The
  non-`@fixme` tests (name-sensitivity, block-local cleanliness, cycle
  termination, order-dependence ruling, Tycho-46 self-referential argument,
  loop hot path) must pass unchanged throughout.
- Interpret/compile parity: `compile(ce.box('d'))?.code` already folds to
  `(3 * (2 * 2) + 1)`; pin that `evaluate()` agrees after the fix.
- Full suite + snapshot-churn measure (expect near-zero: both experiments had
  zero snapshot churn).
- Perf canary + 20k-loop A/B with control reruns, **including a symbolic
  (non-literal) stored value**, not only the numeric fast path.
- Cortex route parity (the spec exercises `ce.box`, `executeCortex`, and `N`
  routes).

## Appendix: the naive prototype (measured, then reverted)

For reference — the current-context variant that produced the evidence base.
It is NOT the proposed implementation (it evaluates in the caller's context,
which is what makes block-locals capture — and is what the constant path does
today):

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
