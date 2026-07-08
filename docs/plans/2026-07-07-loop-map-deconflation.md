# De-conflate `Loop` (imperative) from `Map` (comprehension)

**Status:** implemented 2026-07-07 · **Date:** 2026-07-07 · **Scope:** engine-only
(`src/compute-engine/`), independent of the Cortex work that surfaced it.

> **Resolution of the open questions** (see bottom): (1) `Loop(…, Element…)`
> evaluates to `Nothing` — codegen compiles for-effect bodies as bare
> statements, so last-value can't be honored in compiled code; `Nothing` keeps
> interpreter/compiler parity (`Break v`/`Return` values still win). (2) The
> comprehension role moved to a NEW dedicated operator
> `Comprehension(body, Element…)` (single- and multi-clause, flat Cartesian /
> dependent bindings — a 1:1 head rename of the old collecting `Loop`), not to
> nested `Map`: multi-clause is actively used by the Desmos trailing-`for`
> surface and nested `Map` can't produce the flat result without new `Flatten`
> plumbing. `Map` is unchanged. (3) `Break`/`Continue` are registered inert
> operators (eager, not lazy, so a `Break(v)` value referencing the loop
> variable is concrete at interception time); outside a loop they evaluate to
> themselves.

## Problem

`Loop` currently tries to be two different things at once — a **value-producing
comprehension** and an **imperative control-flow loop** — and the code has to
guess which at runtime. Three symptoms:

1. **Runtime cost / wrong value for imperative loops.** The interpreter
   unconditionally accumulates every body evaluation into `List(results)`
   (`library/control-structures.ts:381`). A side-effecting loop
   (`Loop(Print(...), Element(x, xs))`) therefore builds an O(n) list and
   evaluates *to that list* instead of `Nothing` — memory and semantics both
   wrong for a for-effect loop.
2. **Intent is recovered by heuristic.** The compiler needs
   `isCollectibleLoopValue` (`compilation/base-compiler.ts:823`) to *guess*
   whether a given `Loop` is a comprehension (collect) or a statement
   (discard). A heuristic recovering intent the operator failed to encode is a
   design smell.
3. **`Break` means two things.** Normal completion → `List(results)`; a `Break`
   abandons the accumulated list and returns a scalar
   (`control-structures.ts:373–378`). `Break`-in-a-comprehension is a category
   error hiding inside one operator.

Meanwhile **`Map` already is the typed comprehension primitive**
(`library/collections.ts:812`): `(collection, function) -> collection`, indexed
in → indexed out, docstring *"Equivalent to `[f(x) for x in xs]`."* So `Loop`'s
comprehension role is redundant with `Map`.

Independently, the published reference (`Loop(body)` = infinite `while(true)`)
matches **neither** layer today: the interpreter evaluates `Loop(body)` **once**
(`runLoop`, `control-structures.ts:324`), and the compiler **throws**
`"Loop: no indexing set"` (`base-compiler.ts:643`). The only way to reach an
infinite loop today is the undocumented legacy fall-through `Loop(body, X)`
where `X` evaluates to a non-collection (`runLoopLegacy`, lines 483–494).
`Break`/`Continue` are referenced by the docs and handled structurally, but are
**not registered operators**.

## Proposed design

**`Loop` becomes imperative control flow only. Comprehensions live on `Map`.**

### `Loop` — imperative
- `Loop(body)` → infinite loop; repeatedly evaluate `body` until it yields
  `["Break", value?]` or `["Return", value?]`. Value = the break/return value,
  else `Nothing`. Guarded by `iterationLimit` + the evaluation deadline.
- `Loop(body, Element(x, coll), …)` → nested for-each **for effect**. No
  accumulation. Value = `Nothing` (or the value of the last iteration — pick
  one; see Open questions). `Break`/`Continue`/`Return` behave as expected.
- **Remove** the results-list accumulation and `isCollectibleLoopValue`; the
  legacy non-`Element` arity-2 "collection" form is dropped (superseded by
  `Map`).
- Type: `Loop` is `nothing` (or the body/last-iteration type), never
  `indexed_collection<…>`.

### `Map` — comprehension (already exists)
- `[f(x) for x in xs]` → `Map(xs, f)` → collection (unchanged).
- **Cartesian / multi-clause comprehension** — the one thing `Loop`'s Element
  form did that `Map` doesn't. Options: nested `Map`, or a dedicated
  comprehension operator. Decide during migration (see Open questions).

### `Break` / `Continue`
- Register both as real operators so `["Break", v?]` / `["Continue"]`
  canonicalize cleanly. `Break` carries an optional value; `Continue` takes
  none. Semantics as the interpreter/compiler already assume
  (`base-compiler.ts:346–347`).

## Changes by file (sketch)

- `library/control-structures.ts` — rewrite `runLoop`: `Loop(body)` infinite;
  Element form non-collecting; drop `runLoopLegacy` and the `results` list;
  update the `Loop` `type` handler. Add `Break`/`Continue` definitions.
- `compilation/base-compiler.ts` — support bare `Loop(body)` (`while(true){…}`
  with `break`); remove `isCollectibleLoopValue` and the collecting codegen;
  keep the `Element(i, Range)` counted-loop and collection-iteration codegen as
  **for-effect** (no result array).
- **Consumers that emit `Loop` for comprehensions must move to `Map`** — the
  Desmos parser paths behind `parser-for-comprehension.test.ts` and
  `parser-desmos-composition.test.ts`. This is the main consumer-visible
  migration and the reason this is a deliberate, standalone change.

## Compatibility / blast radius

- **Behavior change:** any caller relying on `Loop(…, Element…)` returning a
  `List` breaks. Audit: Desmos comprehension producers (above) + their tests;
  `compile-wgsl.test.ts` Loop cases; anything consuming a `Loop`'s value as a
  collection. Measure before landing.
- **Docs:** update the control-structures reference — `Loop` is control flow;
  point comprehensions at `Map`. Fix the `Loop(body)` = `while(true)` claim to
  match the new (correct) implementation.
- Backwards-incompatible on the comprehension surface; justified as a
  docs-vs-impl bug fix plus a de-conflation. Land as one engine PR.

## Cortex consumption (context, not part of this PR)

Once landed, Cortex lowers with no custom runtime operators (so it compiles to
JS/Python via the existing `base-compiler`):
- `while cond { body }` → `Loop(Block(If(Not(cond), Break), …body))`
- `for x in xs { body }` → `Loop(…body, Element(x, xs))`
- a Cortex list-comprehension (if/when added) → `Map`

## Open questions

1. `Loop(body, Element…)` value: strictly `Nothing`, or the last iteration's
   value? (Prefer last-value for parity with `Block`; confirm against compiler
   codegen.)
2. Cartesian comprehension: nested `Map` vs a dedicated operator (e.g.
   `Table`/`Comprehension`). Only needed if a consumer actually uses
   multi-clause comprehensions.
3. `Break`/`Continue` outside a `Loop`: diagnostic vs. no-op vs. propagate.

## Out of scope

- Cortex parser/executor wiring (tracked in the Cortex roadmap, Phase 4).
- `Return` semantics for function bodies (separate from loop control).
