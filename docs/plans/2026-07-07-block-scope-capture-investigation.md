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
