# Deep-tree boxing without a stack cliff (option (b) of the ROADMAP ruling)

Status: PLAN, 2026-08-15. Ruling: ROADMAP "Boxing a long `1-2-3-…` chain
overflows the stack" — option (b), make boxing tolerate depth, chosen over
(a), folding subtraction runs flat at the parser (which changes raw parse
output and its serialization).

## Problem

Boxing a MathJSON tree recurses once per nesting level: `boxInternal →
boxFunctionInternal → makeCanonicalFunction → makeCanonicalFunctionCore →
applyOperatorDefinition → (operand loop) → boxInternal …` (5 frames, ~1 570
bytes of stack per canonical level after the two 2026-08-15 trims; 2 frames
/ ~630 bytes for a raw box; 8 frames for canonicalizing an already raw-boxed
tree through `BoxedFunction.canonical → ce.function → …`). On Node's default
~984 KB stack that is a hard ceiling of ~580 canonical levels: `ce.parse
('1-2-…-N')` (a left-nested `Subtract` chain, ~13 frames/level once the
`Subtract`→`Add`/`Negate` canonicalization is counted) throws `RangeError`
past ~790 terms, `Sin(Sin(…))` past ~580, `(((…)))` past ~1 400. Frame trims
only move the wall.

## Design: bounded recursion + bottom-up boxing of the deep remainder

Two pieces.

**1. A recursion-depth counter on the boxing state.** `_boxingState.depth`
is incremented on entry to `makeCanonicalFunction` (which already has a
`try/finally`, for `_inferenceCause`) and around the operand loop of
`boxFunctionInternal`'s non-canonical tail, decremented in `finally`. Cost:
one increment/decrement per node; no new frames.

**2. When the counter exceeds a threshold `D`, an operand that is a raw
MathJSON array (or a raw `BoxedFunction`, on the `.canonical` route) is boxed
by an ITERATIVE driver instead of the recursive call.** The driver walks the
operand's subtree with an explicit stack, post-order, and boxes bottom-up:
each node is boxed by the NORMAL path (`boxInternal`) but with its
pre-boxable children already replaced by their boxed forms, so the normal
path never recurses more than one level below the driver. The recursion
depth of the whole construction is therefore bounded by `D` plus a small
constant regardless of tree depth.

The driver is invoked from the two operand loops (`applyOperatorDefinition`'s
canonical operands and `boxFunctionInternal`'s non-canonical tail), i.e. at
exactly the sites that recurse. Because it is invoked from INSIDE the
enclosing construction — same root repair, same inference transaction, same
current lexical scope, same `_deadlineFrame` — everything a nested `box()`
would have seen is already in place. That is what lets scoped and lazy
operators compose: a `Sum` body deep in a tree is reached only after `Sum`'s
own (recursive, opaque — see below) canonicalization has installed the index
scope; the counter keeps counting inside; if the body itself is deep, the
driver kicks in there, in the right scope.

### Equivalence condition — "transparent" nodes

The result must be byte-identical to the recursive path. Pre-boxing a child
before its parent is exactly what the recursive path does for a parent that
boxes that child with a plain `box(ce, x)` (canonical route) or `box(ce, x,
sameOptions)` (raw route) and inspects nothing about it beforehand. So a
node may be pre-boxed iff (i) its PARENT is transparent (boxes it that way)
and (ii) the node's own head is transparent (so the driver may in turn
pre-box ITS children — otherwise the node is boxed normally, and its
children by the recursive path inside it).

A head is transparent when, in the current scope, ALL of:

- `lookupApplicable(name, scope)` finds an OPERATOR definition (a value
  definition routes to `Apply`; a missing definition auto-declares — both
  stay recursive; a deep nest of an UNDECLARED function still hits the
  cliff, which is acceptable and documented);
- the definition is not `lazy`, not `scoped`, has no `bindingSites` (their
  operands are boxed raw / in a local scope);
- the head is not one of the heads special-cased BEFORE the operand loop
  in `boxFunctionInternal` / `makeCanonicalFunctionCore`, which read raw
  operand shape: `Hold`, `Error`, `ErrorCode`, `Number`, `Divide`,
  `Rational`, `Complex`, `List`, `Dictionary` (the short paths),
  `NamedArgument` and `Spread` carriers, `Function`/lambda heads (annotated
  in place by `annotateCallbacksFromSignature` before boxing);
- none of ITS operands is a `NamedArgument` or `Spread` carrier
  (`hasNamedArguments`, `isSpreadOperand` are head checks on the raw child
  and must keep seeing the raw child).

Whether `Negate` is transparent (its literal-distribution reads
`typeof op1 === 'number'` and otherwise boxes the child with the same
options) is decided by the torture run below, not by reading: start with it
transparent, keep it only if the run is clean.

The driver only handles the two option shapes that account for every deep
tree in practice: full canonical (`canonical === true`, no `structural`, no
`scope` option) and raw (`canonical === false`). Partial forms
(`canonical: ['Flatten', …]`), `structural: true`, or an explicit `scope`
option fall back to the recursive path unchanged.

### What the driver must replicate besides operand order

- **Inference cause.** `makeCanonicalFunction` sets `ce._inferenceCause =
  { operator: name, ops }` while an operator canonicalizes, so an inference
  write during a child's boxing records the PARENT as its cause. The driver
  sets the same cause (parent head, parent operands with the already-boxed
  replacements — shallow, so its lazy materialization cannot recurse deep)
  around boxing each child, and restores it after.
- **The `.canonical` route.** A raw-boxed deep tree canonicalizes through
  `BoxedFunction.canonical → ce.function(op, rawOps) → … → box(rawChild) →
  rawChild.canonical`. Same recursion, boxed operands instead of arrays. The
  driver's second entry point takes a raw `BoxedFunction`, applies the same
  transparency rule to its ops, and builds each transparent node with the
  getter's exact construction (`ce.function(op, ops, {metadata:
  {sourceOffsets}})`, extracted into a small exported helper next to the
  getter so the two cannot drift), children first.
- **Nothing else**: the deadline stride check, `adoptsForeignEngineObject`,
  the epoch/`_freshlyInferred` bracket, devolve/rebuild — all run per node
  inside the normal path the driver calls, or are root-level and untouched.

### Threshold

`D = 64`. Ordinary expressions (depth < 64) take exactly today's path with
one counter increment/decrement per node; the driver never runs. Deep trees
switch at level 64 and stay bounded there. `D` is a module constant, not an
option.

## Verification

1. **Torture equivalence run.** Build with `D = 1` (every transparent
   operand of every construction goes through the driver) and run the FULL
   suite (`npm test` — all ~4 000 snapshots). Any divergence between the
   pre-boxed and recursive paths shows up as a failure. Refine the
   transparent-head list until the run is clean; then set `D = 64`. This is
   the safety net for the equivalence argument above and is repeatable
   (a comment at the constant says so).
2. **Ceilings.** `1-2-…-N` at N = 5 000 (canonical AND raw, AND
   `.canonical` of the raw box), `Sin` nest at 5 000, `(((…)))` up to the
   parser's own limit — all box; results equal to the flat forms
   (`nops`, `evaluate()` values). Pinned in
   `test/compute-engine/boxing-depth-headroom.test.ts` as outcome tests (no
   timing).
3. **Composition.** Deep tree under a binder (`Sum(deep body, index)`)
   canonicalizes with the index bound; deep tree containing a `Hold` and a
   lazy operator; deep tree with a `NamedArgument` call and a `Spread`
   somewhere inside; deep tree of an undeclared function (documented cliff:
   asserts a clean `RangeError`, not corruption).
4. **Provenance.** Existing epoch/inference-provenance tests unchanged; add
   one asserting the inference cause recorded during a deep boxing names the
   immediate parent (the `_inferenceCause` replication).
5. **Perf.** `benchmarks/` parse/box harness before/after: the counter must
   cost < 2%; deep trees no longer O(depth) stack.

## Out of scope

- The parser's own recursion (`(((…)))` overflow at ~2 000 levels in
  `parseExpression`) — separate ROADMAP item.
- Deep nests whose EVERY level is opaque (`Hold(Hold(…))`,
  `f(f(f(…)))` undeclared) — the driver never gets a transparent parent to
  start from; documented as remaining recursion.
- Frame-size splitting of the fat `box.ts` functions — moot once depth is
  bounded.

## Files

`src/compute-engine/boxed-expression/box.ts` (counter, driver, the two
loop sites), `engine-boxing-state.ts` (the counter field),
`boxed-function.ts` (canonical-construction helper),
`test/compute-engine/boxing-depth-headroom.test.ts` (outcome + composition
pins), ROADMAP entry → FIXED with the residual documented, CHANGELOG.
