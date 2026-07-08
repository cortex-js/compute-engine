# Investigation brief: nested `Block` scope capture (canonicalization scope vs runtime scope)

**Status:** open · **Date:** 2026-07-07 · **Priority:** blocks Cortex Phase 4
(`for x in xs { block }` and `while` lowerings evaluate loop bodies that are
`Block`s reading enclosing variables).

## The defect

A nested `Block` resolves symbols against the scope chain captured at
**canonicalization** time (its `_localScope`, whose parent chain holds
bindings that were declared with a type but **no value**), not against the
**runtime** evaluation context where `Declare`/`Assign` statements actually
put values. Consequence: a nested `Block` cannot see the runtime values of
its enclosing `Block`'s locals — unless the nested block itself assigns them
(a write-then-read within the same chain coheres by accident).

This is the same defect family that `evaluateStatements`'s JSDoc describes
for lambdas, and that `hideBodyScopeParams` / `captureClosures`
(`src/compute-engine/function-utils.ts`) patch around for function
application. It is a design-level canonicalization-scope-vs-runtime-scope
issue, not a local bug.

## Deterministic repros (fresh `ComputeEngine`, verified 2026-07-07)

```ts
// R1 — nested Block cannot read an outer Block-local (returns symbolic `k`,
// should be 7):
ce.expr(['Block', ['Declare','k','integer'], ['Assign','k',7],
  ['Block', 'k']]).evaluate()          // → k   (expected 7)

// R2 — same for any expression over the variable (all stay symbolic):
//   ['Block', ['Add','g',1]]      → g + 1
//   ['Block', ['Less','h',5]]     → h < 5
//   ['Block', ['Not',['Less','r',5]]] → !(r < 5)

// R3 — reads from inside an If BRANCH in a nested Block never resolve
// (throws 'Condition must evaluate to "True" or "False"'):
ce.expr(['Block', ['Declare','a','integer'], ['Assign','a',0],
  ['Loop', ['Block',
    ['If', ['Less','a',5], ['Assign','a',['Add','a',1]], ['Break']]]],
  'a']).evaluate()                     // throws (expected 5)

// R4 — WORKS (why matters): when the nested Block directly assigns the
// variable as a top-level statement, reads in the same block cohere:
ce.expr(['Block', ['Declare','m','integer'], ['Assign','m',0],
  ['Loop', ['Block',
    ['If', ['Not',['Less','m',5]], ['Break']],
    ['Assign','m',['Add','m',1]]]],
  'm']).evaluate()                     // → 5 on a FRESH engine
```

**State-dependence:** R4's exact shape *threw* in a warmed engine (same
process, after several prior evaluations incl. other Loop/Block
canonicalizations) and *works* on a fresh engine. Reproducing the warm-state
failure deterministically is part of the investigation — suspect stale
bindings or caches in a shared scope object reused across canonicalizations.

Also reported by the Loop/Comprehension implementation session (2026-07-07):
an Element-form loop whose body is a `Block` reading the **loop variable**
misevaluates (`Loop(Block(Assign(s, s+n)), Element(n, Range(1,5)))` →
`Multiply(5, n)` instead of accumulating), while the bare (non-Block) body is
correct — the Block captured the canonicalization-time loop scope (index
declared `unknown`, no value) instead of the runtime `freshScope`.

## Key code sites

- `src/compute-engine/library/control-structures.ts` — `canonicalBlock`
  (creates the Block's scope at canonicalization), `evaluateBlock`,
  `canonicalLoopLike` + `runNestedElements` (runtime `freshScope` for Element
  loops; pre-declares index vars).
- `src/compute-engine/function-utils.ts` — `evaluateStatements` (and its
  JSDoc explaining why makeLambda iterates `body.ops` instead of calling
  `body.evaluate()` — the same shadowing problem), `hideBodyScopeParams`,
  `captureClosures`, `makeLambda`'s freshScope/re-parenting dance.
- Scope/eval-context machinery: `ce.pushScope` / `ce._pushEvalContext` /
  lookup path (where a typed-but-valueless canonicalization binding shadows
  the runtime binding).
- Memory `function-literal-canonicalization.md` documents the adjacent
  closure-capture design and its dead ends — read before redesigning.

## What was already fixed (do not re-investigate)

Committed/staged 2026-07-07 in the Loop/Comprehension de-conflation session:

1. Two-argument `If` (`['If', cond, then]`) failed to canonicalize
   (`undefined.canonical`) — fixed; evaluates to `Nothing` on false.
2. `Block` swallowed control flow produced by statement *results*
   (`If(cond, Break)` etc.) — `evaluateStatements` now short-circuits on a
   control-flow **result** and propagates it wrapped; `Return` unwraps at the
   function boundary (`unwrapReturn`). Regression tests:
   `test/compute-engine/loop-imperative.test.ts`,
   `test/compute-engine/control-structures.test.ts`.

The `Condition must evaluate to "True"/"False"` failures that remain are
**scope resolution** failures (condition indeterminate because the variable
has no visible value), not control-flow propagation failures.

## Acceptance criteria

- R1–R3 evaluate correctly on fresh AND warmed engines.
- The Element-form `Loop(Block(...loop var...), Element(...))` accumulates
  correctly.
- No regression in: `loop-imperative`, `control-structures`, `scope`,
  `lambda-capture`, `blocks`(if any), `compile-scope`, full
  `test/compute-engine` suite (13k+ tests; zero-snapshot-churn policy —
  measure blast radius before landing).
- The lambda-parameter patches (`hideBodyScopeParams`, re-parenting) ideally
  become unnecessary or are unified with the general fix — but treat that as
  stretch, not required (high regression risk; see
  function-literal-canonicalization.md dead ends).

---

## RESOLUTION (2026-07-07, investigation session)

**Status: FIXED** — R1–R5 pass on fresh and warm engines, including
re-evaluating the *same expression object* and `Declare` inside a Loop body
Block (re-executed per iteration). Regression tests:
`test/compute-engine/block-scope-capture.test.ts` (11 tests).

### Root cause (three distinct mechanisms)

1. **Stale shadow bindings (R1/R2/R3).** `Declare`/`Assign` register their
   symbol only at *evaluation* time. So when a nested `Block` (or an `If`
   branch inside a `Loop` body) referencing an enclosing block-local is
   canonicalized, the symbol is not yet declared anywhere; auto-declaration
   puts a valueless inferred binding in the *innermost* scope. At evaluation,
   the nested Block pushes its canonicalization scope, and that stale binding
   shadows the enclosing block's runtime binding forever. (Verified by scope
   instrumentation: `S3{k: unknown, no value} → S1{k: integer, 7}`.)

2. **Runtime freshScope bypass (R5 / Element-loops).** `runNestedElements`
   pushed a *fresh* eval scope and assigned the index variables there — but a
   `Block` body pushes its own canonicalization scope, whose parent chain goes
   through the loop's *canonicalization* scope, bypassing the fresh scope.
   Bare (non-Block) bodies resolved by name against the current context and
   worked; Block bodies saw the valueless canonicalization binding.

3. **Re-entered scope conflicts (warm-state R4).** A Block pushes its
   *persistent* canonicalization scope as its runtime scope, so a first
   evaluation's runtime `Declare` binding (typed, with value) survives; the
   second evaluation of the same object threw
   `The symbol "…" is already declared in this scope`. Deterministic repro:
   evaluate the same Block object twice. This also broke `Declare` inside any
   Loop body Block (second iteration).

### The fix (three parts, matching the mechanisms)

1. **Hoisting in `canonicalBlock`** (`library/control-structures.ts`): before
   canonicalizing statements, declare each top-level `Declare` target — and
   each top-level `Assign` target *not visible in the scope chain* — into the
   block scope as an inferred, valueless binding (identical to an
   auto-declared one, so the `Declare` evaluate handler's existing upgrade
   path applies unchanged). References from nested scopes now bind to the
   right scope at canonicalization. Assign-without-declare stays block-local;
   assignment to a visible binding (incl. constants → runtime error) still
   binds upward.

2. **`runNestedElements` iterates in the loop's own lexical scope** (the
   pushed canonicalization scope) instead of a fresh child scope, so a Block
   body's lexical parent chain sees the index values. (Landed concurrently in
   the Loop/Comprehension session; same design.)

3. **Statement re-declaration resets** (`library/core.ts`, `Declare`
   evaluate): bindings created/upgraded by a `Declare` statement are marked
   (`_declaredByStatement`); on re-entry of the same scope the mark lets the
   statement replace its own earlier binding instead of conflicting. Genuine
   conflicts (function parameters, `ce.declare()` API double-declares) still
   throw — those bindings are unmarked.

### Why not the "fresh runtime scope" redesign

A prototype that evaluated every scoped expression in a fresh scope parented
to the current runtime context (never pushing the canonicalization scope)
fixed all repros *and* the warm-state hazard structurally — but broke two
contracts the suite locks in: nullary-function lexical capture
(`makeLambda`'s 0-arg shortcut calls `body.evaluate()` and relies on the
canonicalization-scope push for defining-scope resolution) and closures
defined inside a `Sum` body capturing the index variable from the Sum's
canonicalization scope (`scope.test.ts` "FUNCTION INSIDE BIGOP"). The
canonicalization scope *is* the runtime frame in this engine's design;
mixing models breaks whenever they nest. The hoisting fix works with the
existing model instead.

### Stretch goal: function-body blocks (CLOSED, follow-up same day)

The function-body variants of the defect were fixed in a follow-up on the
same day (originally documented here as residuals):

- `hideBodyScopeParams` (`function-utils.ts`) now hides, in addition to the
  parameters, **all inferred valueless bindings** of the body scope during a
  call — auto-declared free variables and hoisted block-locals are
  canonicalization bookkeeping that must not shadow the lambda's fresh
  scope. (Their runtime counterparts are re-created by the `Declare`
  statements; `captureClosures` already documented them as safe to drop.)
- `evaluateBlock` sweeps inferred valueless bindings from the Block's pushed
  scope on entry. This fixes the deepest shape: a function **parameter**
  referenced from a Block nested inside the body (e.g. a `while` lowering,
  `fn sumto(n) { … while … }`) auto-declared a stale shadow in the *nested*
  block's scope at canonicalization — unreachable from `makeLambda`. With
  the sweep, the read resolves by name up the runtime chain to the call's
  fresh scope. Bindings with a value or explicit type are kept (previous-run
  locals are reset by `Declare`'s statement-redeclare path instead).

Tests: "nested Blocks inside function bodies" describe-block in
`block-scope-capture.test.ts` (n-ary body-local, while-loop-reads-parameter,
curried-adder closure canary).

### Residual (documented, unchanged behavior)

- Block/loop canonicalization scopes still accumulate runtime values across
  evaluations (same as `Sum`); `Declare` resets its locals on re-entry, but a
  read-before-assign of a non-declared local could observe a previous run's
  value. Same-expression *recursive* re-entry (a loop inside a recursive
  function) shares the scope — pre-existing `Sum` behavior.
- An `Assign` that first introduces a variable only *inside* an `If` branch
  (no top-level `Declare`/`Assign` for it in the block) is not hoisted, so a
  nested-Block read of it stays symbolic. Cortex lowerings always emit
  explicit declarations, so this is theoretical; extend the hoist scan into
  control-flow operands if it ever matters.

### Validation

- `block-scope-capture` (11 new), `block-scope-shadowing`, `loop-imperative`,
  `control-structures`, `scope`, `scope-advanced`, `lambda-capture`,
  `function-parameter-shadowing`, `functions`, `compile-scope`,
  `compile-loop`: all pass.
- `npm run typecheck`: clean. Full `test/compute-engine` suite: see session
  report (run for snapshot blast radius).
