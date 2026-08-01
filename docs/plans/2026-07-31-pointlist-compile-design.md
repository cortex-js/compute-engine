# PointList as a compiled value — design

**Date:** 2026-07-31 · **Status:** rulings ratified; spec revised after the
dual-reviewer pass (`docs/scratch/2026-07-31-pointlist-compile-design_SPEC_REVIEW.md`) ·
**Ledger entry:** ROADMAP § Compile-target coverage, group A rank 1
(`PointList` w/ collection-valued component + `PointZ` over a point list —
11 st / 36 mem JS + 2 st GPU).

**Terminology.** A `PointList`'s *sources* are its zip participants; the
*source length* is the number of points a source contributes. The number of
components per point (`PointList(a, b)` → 2) is the *point arity*. These are
orthogonal axes — "width" is not used below.

## Problem

The v1 `PointList` compile handler (`library/collections.ts` ~1238) lowers a
`PointList` byte-identically to `Tuple` when every component is a scalar
slot, and fails closed on any provably-collection component. But on the
JavaScript target a *list of points is already an expression-level value*
when reached the other way: an evaluated `PointList` (a `List` of `Tuple`s)
compiles to nested arrays, and `PointX`/`PointY`/`PointZ` broadcast over it
(`compilePointComponent`, `javascript-target.ts` ~587). Same mathematical
value, two routes, one refused — the A″ inconsistency class. The decline
also blocks the projection route its own error message recommends
(`PointX(PointList(-6, n))` dies compiling the argument).

**CSE relationship, stated precisely:** the decline fails the *whole
artifact*, so today no compile-target optimization reaches a
PointList-bearing document at all. Removing it opens the artifact — every
*other* repeated subtree becomes CSE-bindable. The PointList subtrees
themselves remain CSE-ineligible under gate G1b
(`2026-07-28-compile-cse-design.md` §5.2: a subtree containing a node whose
operator definition carries a `compile` handler is excluded, built-in or
not). Exempting attested built-in handlers from G1b is a **follow-up to the
CSE design**, filed in the ROADMAP residual row — not claimed here.

## Rulings (user, 2026-07-31 — settled, do not re-litigate)

1. **JS constructs the point list via a map/zip lowering** — no decline.
2. **Unknown-length sources: cap (truncate) the zip**, hung on the existing
   `CompileTarget.iterationBudget`.
3. **JS and GPU deliberately diverge.** GLSL/WGSL have no runtime-length
   expression values (const-size arrays, `vec` ≤ 4; WGSL runtime arrays are
   storage-buffer-only), so the GPU keeps fail-closed *construction* and
   gains the *projection* route only. The point-list dimension remains the
   consumer's instancing axis (round-21 width ruling analog).

## Shared predicate

One **source predicate**, used identically by the type handler (already),
the JS lowering, and the GPU projection: a component is a source iff its
type is an `indexed_collection` that is not a tuple (`isListType`,
`collections.ts` ~1189). Components are then classified:

| class | predicate | JS zip | GPU projection |
| --- | --- | --- | --- |
| source | `isListType` | zip participant | project/truncate |
| provably scalar | type ⊆ `number` (or other numeric scalar) | slot, verbatim | slot, `vecW(slot)` broadcast |
| opaque scalar | `unknown`/`value`/other non-collection | slot, **runtime-guarded** (D1) | **decline** |
| other non-scalar | tuple, set, map, union-with-collection-member | **decline** (D1) | **decline** |

The retained declines are **deliberately narrower than typing**: the type
handler types the result `list<tuple>` whenever ≥1 source exists, regardless
of the other components — but a non-source, non-scalar slot has no
statically known *per-point* representation (its whole value would be
spliced into every point, the exact garbage-in-a-point hazard the guard
class exists to prevent). Lowering narrower than typing is intentional;
record it in the handler comment.

## Design

### D1. JS construction lowering — in the target's function table

**Where.** The zip lowering lives in `JAVASCRIPT_FUNCTIONS.PointList`
(`javascript-target.ts`), NOT in the library definition handler:
target-table handlers receive the full `CompileTarget`
(`compilation/types.ts:28`), which the lowering needs for
`BaseCompiler.tempVar(target)` (collision-safe temporaries — fixed names
like `_s1` can TDZ-collide with caller `vars` splices) and
`target.iterationBudget`. `OperatorCompileContext` is `{ language }` only
and is not widened. The library definition handler changes minimally: on
`javascript`, a shape it does not lower (≥1 source) **returns `undefined`**
(decline-by-fallthrough, which runs before `target.functions` — the 109a
mechanics) instead of throwing; every other language keeps its current
behavior. The all-scalar path stays in the library handler unchanged
(byte-identical to `Tuple` on every target).

**What.** With ≥1 source, emit an IIFE zip (all temp names via `tempVar`;
the sketch uses placeholders):

```js
(() => {
  const S1 = <compiled source 1>;              // sources hoisted, in
  const S2 = <compiled source 2>;              //   operand order
  const A3 = <compiled scalar slot 3>;         // provably scalar: verbatim
  const A4v = <compiled opaque slot 4>;
  const A4 = Array.isArray(A4v) ? NaN : A4v;   // opaque: runtime-guarded
  const N = Math.min(S1.length, S2.length /*, <floor(budget)>*/);
  const R = new Array(N);
  for (let I = 0; I < N; I++) R[I] = [S1[I], S2[I], A3, A4];
  return R;
})()
```

- **Shortest-zip falls out of `Math.min`** — the ratified PAIRING-family
  contract (`docs/BROADCAST-MODEL.md`; Tycho item 52), not the strict
  LIFTED-broadcast rule. That doc's "Where it lives" section gains this as
  a compiled pairing site.
- **Every component is hoisted and evaluated exactly once, in operand
  order** — sources and slots alike — matching the interpreter (a non-lazy
  handler receives evaluated operands) and avoiding the multi-splice ×
  impure-operand trap fixed 2026-07-31.
- **Opaque-scalar guard (new, deliberate):** an `unknown`-typed slot that
  holds an array at run time yields `NaN` components — self-describing
  absence at the ABI (the `Missing`→`NaN` convention) — instead of splicing
  an array into every point. Without the guard, D1 would *convert today's
  fail-closed decline into silently-wrong output* for
  `PointList(u, L)`, `u: unknown` bound to a list — a regression, not the
  pre-existing all-scalar gap. Divergence, documented: the interpreter
  would transpose that slot as a source; the compiled form cannot know to.
  The remaining `unknown` gap (all-scalar `PointList(u, v)` with `u` a
  runtime list — genuinely pre-existing) stays filed under the A″ sweep in
  the ROADMAP residual row, next to `Sin(L)`-on-GPU.
- **Retained declines** (union/tuple/set/map components) throw from the JS
  table entry with a **revised** diagnostic — the v1 text ("a list of
  points is not an expression-level value here: project the components")
  is false on JS after D1. New shape:
  `PointList: cannot compile — component <i> (type '<t>') is neither a
  scalar slot nor a list source; its per-point value cannot be determined
  at compile time. Fail closed (D6).`
  GPU/python/interval-js diagnostics unchanged.

**Edge cases (normative):**

| case | result |
| --- | --- |
| empty source | `[]` (interpreter: empty `List`) |
| single component `PointList(L)` | list of 1-tuples `[[l1],[l2],…]` |
| all components sources | plain zip, no slots |
| source elements are lists (`list<list<number>>`) | zip verbatim (nested arrays; matches interpreter) |
| sources longer than `MAX_SIZE_EAGER_COLLECTION` | same emission; interpreter's lazy-`Map` form is a representation difference only — parity is checked on *materialized elements* |
| non-array value in a source position at run time | loud `RangeError` from an explicit emitted `Array.isArray` guard, naming the source index — a `vars`-splice type-contract breach fails fast, including string/array-like impostors that carry a numeric `.length` (staged-review hardening; the original `new Array(NaN)` route missed those) |

### D2. Cap / truncation convention

- A source that is **statically infinite** (`isCollection` and
  `isFiniteCollection === false`, e.g. `Range(1, ∞)`) **throws** at compile
  time (D6), mirroring `assertFiniteBound`:
  `PointList: source component <i> is an infinite collection — an infinite
  point list has no compiled value. Fail closed (D6).`
  Via `{ fallback: true }` this surfaces as `success: false` + interpreter
  fallback (which stays inert on that shape — "parity" here means both
  routes refuse to produce a value).
- When `target.iterationBudget` is defined, **`Math.floor(budget)`** joins
  the `Math.min` (the option validator admits fractional values; an
  unfloored budget would make `new Array(N)` throw). Both `iterationBudget`
  doc comments (`compilation/types.ts` ~466, ~855) gain the zip-cap
  sentence.
- **Scope of the cap, honestly:** it bounds the *zip length only*. Source
  materialization happens first and is the source lowering's own,
  pre-existing behavior class (`Range(1, n)` with huge runtime `n`
  allocates fully; runtime `Infinity` throws `RangeError` before the zip) —
  out of scope here, identical for every other collection consumer.
- **Default is uncapped** — `iterationBudget` is never set on user-facing
  `compile()` paths today (only the internal Richardson limit ladder sets
  it). Accepted risk, stated: the consumer that wants a bounded zip opts in
  via `CompilationOptions.iterationBudget`.
- **Deliberate three-way divergence, all intentional:** `Sum`/`Product`
  poison to `NaN` on budget overrun; the interpreter stays
  fail-closed-inert on an infinite source; the compiled point list
  **truncates** — a partial point list draws, `NaN` draws nothing.

### D3. GPU projection route

`compilePointSwizzle` (`gpu-target.ts` ~2185) currently throws on any
list-of-points operand. Add one case before the throw: when the operand is
a **symbolic `PointList` application** (that exact operator; literal
`List`-of-`Tuple`s and symbol-bound point lists stay declined in v1 —
demand-gated, documented) with ≥1 source, project the coordinate:

- Let `k` = 0/1/2 for x/y/z; `slot` = the k-th component. `k ≥` point arity
  → keep the fail-closed throw (e.g. `PointZ` on a 2-arity `PointList`).
- **Admissibility (all checked before emitting):**
  - every source has a statically known vec-emittable length 2–4 (a
    literal `List` of 2–4 elements, or a declared `vector<N>` type); a
    source of unknown length (bare `list<number>`) declines — extending
    the `Sin(L)` assert-a-shape hazard is exactly what we must not do;
  - every non-source slot is provably scalar numeric (no `unknown`, no
    aggregates — `vecW(<aggregate>)` is invalid or wrong);
  - every **non-selected** component is `.isPure` — projection never
    evaluates them, and discarding an effectful operand (`Random()`)
    breaks the evaluate-once contract; impure → decline.
- `w` = min source length. `slot` a source: emit it, swizzle-truncated to
  `w` when longer (`(v).xy`) — shortest-zip, statically. `slot` scalar:
  emit `vecW(slot)` (`vecWf` on WGSL).
- Sources longer than 4 (GLSL `float[N]`): decline in v1. Real reason: the
  operand-shape gates (below) already confine projections to the compile
  root, and a root-level `float[N]` point-projection has no witness;
  same-length array pass-through is possible if demand appears.
- **Shape-gate consequence (stated, not hidden):** `gpuOperandShape` reads
  the *expression type*, and `PointX(PointList(…))` types `list<number>`
  with no static dimension — so a projection **composed under arithmetic**
  (`PointX(…) * 2`, `Sin(PointX(…))`) still declines via the existing
  operand-shape diagnostic even though the emission would be a legal
  `vecN`. In v1 the projection is therefore effective at emission sites
  the shape gates admit — in practice the compile root, which is the
  plotted-point-list shape. Making the projection's *type* carry its
  dimension (so composed uses pass the gates) is an interpreter-visible
  type-handler change — filed as a follow-up, not attempted here.
- GPU **construction** (a `PointList`-with-source anywhere except under a
  coordinate accessor) keeps the v1 fail-closed decline and diagnostic.
  Python and interval-js: unchanged, for stated reasons — interval-js has
  no `Tuple` lowering at all (scalar interval domain); python has `Tuple`
  but no coordinate-accessor lowering, so construction alone serves no
  consumer and there is no corpus demand. Both demand-gated, neither
  covered by ruling 3's representation argument.

### D4. JS projection is compositional — plus the absence fix

With D1, `PointX(PointList(…))` on JS compiles the construction and then
the existing broadcast in `compilePointComponent`. One fix rides along:
the broadcast emission becomes `_pt[idx] ?? NaN` (and the single-point
out-of-range access likewise) — today `PointZ` over 2-arity points yields
`undefined` where the interpreter yields the `NaN` absence marker. Match
the interpreter empirically (verify its 2-arity `PointZ` answer first;
`NaN` expected per the Missing-marker convention).

An interpreter-style project-to-source shortcut (`projectLazyPointList`,
`collections.ts` ~752) is a pure optimization, sound only under its
same-known-count guard, deferred until a profile asks.

## Consequences for pinned tests

Per the `realOnly` precedent (rewrite, don't delete):

- `pointlist-compile.test.ts` § "non-scalar component fails closed": the two
  **javascript** list-component cases flip to compile-and-run assertions;
  the **union** case and the **glsl** case stay declines (union message =
  the revised D1 text).
- `compile-decline-diagnostics.test.ts` `PointList` block: the JS
  diagnostic assertions (names the component, never "unknown operator",
  all-scalar still compiles) **re-pin on the union component** — the JS
  shape that still declines — preserving the 109a guarantee; the glsl
  assertion stays as-is.

## Test plan

1. **JS construction:** `PointList(-6, n)` compiles; run against a bound
   list equals the interpreter's evaluated result element-wise (route
   parity). Ragged two-source zip → shortest. Empty source → `[]`.
   Single-component `PointList(L)` → 1-tuples. A >100-element source
   (past `MAX_SIZE_EAGER_COLLECTION`) — parity on materialized elements.
2. **Evaluation-once, observably:** a `vars`-spliced side-effecting source
   and slot (`(_ctr.n++, [1,2,3])`-style) each evaluate exactly once per
   call, in operand order — counted by effect, not by substring.
3. **Opaque-slot guard:** `PointList(u, L)` with `u: unknown` compiles;
   run with `u` a number → normal points; with `u` an array → `NaN`
   components (not nested arrays).
4. **Retained declines + diagnostics:** union component declines on JS with
   the revised message; `{ fallback: true }` → `success: false` +
   interpreter-parity result. Statically infinite source (`Range(1, ∞)`)
   declines at compile time with the D2 message.
5. **Cap:** with `iterationBudget` set (integer and fractional), the zip
   truncates to `floor(budget)`.
6. **JS projection:** `PointX`/`PointY(PointList(-6, n))` compile and match
   the interpreter, including a ragged case; `PointZ` over 2-arity points
   yields `NaN` elements (both routes). Downstream consumption: `Length`
   and `At` over a compiled construction.
7. **GPU projection:** `PointY(PointList(-6, v))` → `v`;
   `PointX(PointList(-6, v))` → `vec3(-6.0)`; mixed `vector<2>`/`vector<3>`
   sources → `.xy` truncation; `list<number>` source declines; `unknown`
   slot declines; impure non-selected component (`Random()`) declines;
   `PointZ` on a 2-arity `PointList` declines; composed use
   (`PointX(…) * 2`) declines via the shape gate; WGSL spelling (`vecNf`).
8. **GPU construction still declines** with the shape diagnostic; python
   and interval-js unchanged.
9. **CSE reach:** an artifact containing a repeated collection-bearing
   `PointList` now compiles, and a repeated **non-PointList** subtree in it
   gets a `_cse` binding (vs `cse: false`); the PointList subtree itself
   does not (G1b — pinned as the documented residual, so its later removal
   is a deliberate act).

## As-built notes (implementation, 2026-07-31)

Four deviations from the letter of the design, none from its substance:

- **The library handler's JS decline is wider than "≥1 source":** on
  `javascript` it falls through (`undefined`) for *every* non-all-scalar
  shape, because the retained declines (union/tuple/set) must carry the
  revised D1 diagnostic and only the target-table entry
  (`compileJSPointList`) can emit it. The JS table entry owns both the zip
  and the retained throws; all other languages and the all-scalar path are
  byte-identical to v1.
- **`isPointListOperand` needed widening for D4 to work at all:** it only
  recognized `{kind: 'tuple'}` element-type *nodes*, but the `PointList`
  type handler answers `list<tuple>` whose element type is the plain
  *string* `'tuple'` — so the accessor element-indexed instead of
  broadcasting. Widened; a symbol declared `list<tuple>` now (correctly)
  broadcasts too. No test pinned the old behavior.
- **GPU swizzle truncation emits unparenthesized for a bare identifier**
  (`v.xy`, not `(v).xy`): the operand-shape gate admits only atomic
  emissions (`gpuIsAtomicEmission`). A non-identifier source still gets
  parens and is then declined by that gate — a legitimate fail-closed v1
  decline, not silent garbage.
- The revised diagnostic quotes the type in backticks (house style), not
  single quotes; `a1-c1-compile-parity.test.ts` had three exact-string pins
  on the accessor emission, updated for `?? NaN` (plain expectations, not
  snapshots).

Staged-review round (Claude Opus + Codex, findings + dispositions in the
session record):

- **Source-predicate hardening:** both `isPointListSource` copies now also
  exclude the bare `'tuple'` type string and any union type (unions are
  never sources — statically ambiguous role, per the Shared-predicate
  table's decline row). The type handler's `isListType` shares the bare-
  `'tuple'`/all-collection-union hole but changing it is
  interpreter-visible — filed in the ROADMAP residual row, not fixed here.
- **Source guard:** each hoisted source gets an explicit emitted
  `Array.isArray` check throwing `RangeError` (see edge-case table).
- **GPU declines are now discriminated** (arity, unknown length, >4,
  non-scalar slot, impure discard) and interpolated into the D6 throw —
  the 109a convention.
- `iterationBudget < 1` floors to 0 → empty point list; documented as the
  truncation semantics' honest corner (`Sum`/`Product` answer `NaN` there).

## Landing notes

- Snapshot blast radius expected ≈ 0 (compile handlers only; the one
  interpreter-adjacent edit is the `?? NaN` accessor emission — verify
  with a full-suite snapshot count before staging).
- Doc touchpoints: the `PointList` definition comment block
  (`collections.ts` ~1160–1190, states the v1 decline contract);
  `docs/BROADCAST-MODEL.md` § "Where it lives" (new compiled pairing
  site); both `iterationBudget` doc comments; CHANGELOG under
  `## [Unreleased]`.
- ROADMAP: split the rank-1 row — closed part (JS construction +
  projection, GPU projection) and a residual row (GPU construction
  declined by ruling; non-`isListType` components; the `unknown`
  all-scalar A″ gap; composed-GPU-use typing follow-up; G1b built-in
  exemption follow-up). No "resolved" claim without a corpus re-measure —
  the counts are the consumer's to re-run.
