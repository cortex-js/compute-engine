# Tensor Unification — One List Representation, Lazy Tensor View

**Date**: 2026-07-20
**Status**: APPROVED (design ratified 2026-07-20) — implementation not started.
**Roadmap**: Strategic item 9 in `ROADMAP.md`.
**Supersedes**: the "Facet 2 — Detection (DEFERRED)" section of
[`2026-06-28-tensor-value-representation-design.md`](./2026-06-28-tensor-value-representation-design.md).
That doc's failure analysis of the four attempted point fixes remains
authoritative; this doc is the representation-level design it called for.

## Motivation — three converging symptoms

1. **Mistyping (Tycho item 69).** `['List', Rgb(…), Rgb(…)]` types as
   `vector<2>`. Not color-specific: `[x, y]` and any shape-regular list
   becomes a `BoxedTensor`, whose `type` getter is purely shape-derived
   (`list<number^dims>` hardcoded, `boxed-tensor.ts` `get type()`), discarding
   the element types the `List` type handler would have computed.
2. **Detection gap.** Broadcast/map results are plain `List`
   `BoxedFunction`s (`ce._fn('List', …)`); `isTensor` only recognizes
   `BoxedTensor` instances, so `Sqrt(M) − Sqrt(M)` stays symbolic instead of
   collapsing element-wise. Four point fixes were attempted and measured; all
   regressed (see superseded doc).
3. **Architecture smell.** `CONTAINER_OPERATORS` (`boxed-tensor.ts`) is a
   hardcoded operator blocklist approximating a *type-level* property
   ("this value is atomic, not an axis") syntactically — needed only because
   tensor classification runs on **raw, pre-binding operands** where `.type`
   is still `unknown`. That early classification is forced by the eager
   `BoxedTensor` construction path. Same root cause as symptom 2.

## The model: cells and axes

Borrowed from array languages (APL rank calculus, NumPy structured dtypes):
every value is either an **axis-former** or a **cell**.

- **Axis-former**: `List` — and only `List`. Homogeneous, indexable,
  transparent to broadcasting. Nesting lists is what builds rank.
- **Cell**: everything else — numbers, symbols, strings, colors, and all
  product/aggregate values (tuples, sets, dictionaries, records). A point
  `(2, 3)` is one value with two components, not a collection of two numbers.
  Cells are opaque to elementwise broadcasting: a list of points is rank-1
  with point cells, never a 2×2 tensor.

The type system already encodes this in its kinds: `list`/`collection` are
structural; `tuple`/`set`/`dictionary`/`record`/`string` are value kinds. The
type grammar is ahead of the runtime: `list<color^2>` and
`list<tuple<number,number>^3>` parse today; the runtime just never produces
them.

"Tensor" today conflates two independent properties:

1. **Shape-regularity** — uniform nesting depth/lengths. Applies to any cell
   type; this is what typing and structural ops (Transpose, Reshape) need.
2. **Numeric-kernel eligibility** — cells packable as
   `float64`/`complex128`/int/bool so the fast kernels
   (`addTensors`/`mulTensors`, `MatrixMultiply`) apply. A subset of
   shape-regular; the only place dtype belongs.

Tuples are **cells with component structure**: they never contribute an axis,
but have their own component-accessor broadcasting (`PointX` over a list of
points) and their own arithmetic (see
[`2026-07-07-tuple-point-semantics.md`](./2026-07-07-tuple-point-semantics.md),
still planned — independent of, and compatible with, this design). None of
that is tensor machinery.

## Design

### D1 — Single representation

`makeCanonicalFunction` (`box.ts`) stops constructing `BoxedTensor`. Every
list is a plain canonical `List` `BoxedFunction`. The `BoxedTensor`
Expression subclass is **deleted** (confirmed 2026-07-20: never used
externally); `AbstractTensor`/`TensorData` remain as the internal kernel
carrier.

### D2 — Tensor-ness as a two-tier lazy view

A `_tensorView` slot on `BoxedFunction`, in-idiom with its existing lazy
caches (`_value`, `_valueN`, `_sgn`, `_type`, `_hash`). Only ever populated
on `List`-operator nodes when a tensor consumer first asks.

- **Tier 1 — structural view** `{shape, dtype-eligibility}`: a cheap O(n)
  walk; what `isTensor` and structural consumers consult. Sentinels:
  `undefined` = not yet computed, `null` = computed-and-not-shape-regular.
- **Tier 2 — packed `AbstractTensor`**: built only when a numeric kernel
  actually runs (today's `BoxedTensor` constructor builds it eagerly; that
  eagerness goes away). Kernel results materialize as plain `List`s and may
  pre-populate the cache, since the kernel already knows the shape.

**Cache-immutability split**: shape derives from `ops` structure alone, which
never changes → tier 1 needs no generation tracking. The **cell type**
derives from element `.type`s, which can shift under inference — so the view
does not cache cell type at all; the shaped type stays the job of the `List`
type handler riding the existing generation-tracked `_type` `CachedValue`
machinery.

**Layering**: all view computation lives in the tensor module (which already
imports from the boxed-expression world, one direction); the slot on
`BoxedFunction` is typed inline (not `import type`) per the established
cycle-breaking pattern. Zero-cycle budget applies; re-run madge after wiring.

**Packing is a per-operation decision, not a storage commitment.** The List
ops remain authoritative, so packing bignums to `float64` for a fast kernel
is never lossy — when precision demands it, the consumer takes the
elementwise `expression` path over the same List. This dissolves the
dtype-ambiguity dilemma (machine floats and bignums both being
`BigNumericValue`/`isExact === false` at default precision): no single global
answer is needed anymore.

### D3 — Typing rule for shape-regular lists

The `List` type handler emits: **widen the element types, folding `unknown`
to `number`; append the shape when regular.** The unknown→number fold is the
engine's existing generic-symbol convention (a bare symbol in numeric
position is a coordinate-to-be — same convention as `pointComponentType`,
`collections.ts`).

| Expression   | Type                     | vs today                   |
| ------------ | ------------------------ | -------------------------- |
| `[1, 2, 3]`  | `vector<3>`              | unchanged                  |
| `[x, y]`     | `vector<2>`              | unchanged                  |
| `[Rgb, Rgb]` | `list<color^2>`          | fixed (was `vector<2>`)    |
| `[x, Rgb]`   | `list<(number\|color)^2>`| honest union, rare         |

(`vector<n>` and `list<number^n>` are the same parsed type; the substantive
question is the element type, not the display name.)

This rule is what contains the blast radius: the dominant
`matches('vector<n>')` consumers — compile paths, Tycho's GLSL `vars`
mapping, numeric dispatch — see symbol and numeric lists unchanged. Only
lists with **known non-numeric** element types shift, which is precisely the
class mistyped today.

### D4 — `isTensor` semantics

`isTensor(x)` becomes "x is a `List` with a computable tier-1 view (and, for
kernel paths, an eligible dtype)". The entire consumer surface already goes
through `isTensor()`/`.tensor` — `instanceof BoxedTensor` occurs exactly once
in the codebase, inside `isTensor` itself — concentrated in
`arithmetic-add.ts`, `arithmetic-mul-div.ts`, `library/linear-algebra.ts`,
`compare.ts`, `boxed-tensor.ts`. Consumers migrate from `x.tensor` to a
`tensorView(x)` helper.

### D5 — Retire `CONTAINER_OPERATORS`

Once nothing forces classification before binding (D1), detection runs on
canonical, type-bound operands and the operator blocklist collapses into a
type-kind predicate — `isAtomicValueType(t)` ⇔ kind ∉ {`list`,
`collection`} — one concept, modeled once, where it already lives. The
string-element rejection also becomes moot (strings are simply non-numeric
cells; `['a','b']` types `list<string>` and never reaches a kernel).

## Why the four measured failures don't recur

| 2026-06-28 failure | What dissolves it |
| --- | --- |
| **Producer** promotion truncated bignums (forced `float64` storage) | No storage commitment: List ops stay authoritative; packing is per-kernel-call and skipped when precision demands (D2) |
| **All-`expression` dtype** was slow (calculus timeouts) | `expression`-dtype packing no longer needed as a storage compromise; slow path = plain elementwise List ops, taken only when packing is ineligible |
| **Detector** gate on `operator === 'List'` too broad + re-box too slow | No re-box: the view reads ops in place; the gate is "a tensor consumer asked", not "is a List" (D2, D4) |
| **Smart producer** paid `expressionTensorInfo` per broadcast → blew simplify/calculus deadlines | Laziness: broadcast hot loops never request the view; cost is on-demand, cached once per immutable instance, and kernel results pre-populate (D2) |

## Phasing — each independently landable, each with a measurement gate

- **Phase A — honest typing (closes Tycho item 69).** Implement D3 in the
  `List` type handler and fix `BoxedTensor.type` to delegate to it (interim,
  while `BoxedTensor` still exists). **Gate**: full-suite snapshot +
  behavior churn measured and reviewed; per the item-67 lesson
  (union matching is all-members), specifically audit `matches()` dispatch
  sites — including the `addType`/`Multiply.type` single-tensor branches from
  the honest-broadcast-typing T2 work — before landing.
- **Phase B — lazy view + representation unification.** `_tensorView` slot,
  `tensorView(x)` helper, migrate the five consumer files, stop constructing
  `BoxedTensor` in `makeCanonicalFunction`, delete the class. **Gate**:
  full suite green incl. calculus/simplify deadline suites (the historical
  regression detectors — doubly-infinite sums, `sin(∞)`); perf spot-check on
  broadcast-heavy paths; madge clean.
- **Phase C — retire `CONTAINER_OPERATORS`** (D5): move detection
  post-canonicalization, replace blocklist with the type-kind predicate.
  **Gate**: tensor-detection parity tests (tuples/sets/dicts/strings/Hold
  wrappers as list elements) + full suite.

## Interactions and risks

- **`matches()` blast radius (Phase A)** — the known unknown; the gate above
  is the mitigation. Timing-flake suites (calculus, timeout, fungrim-loader,
  rubi-utils) should be re-run isolated before attributing failures.
- **Compile/GLSL** — Tycho's `vars` mapping keys on `vector<n>`; D3
  deliberately keeps symbol/numeric lists typing `vector<n>` so this surface
  is unchanged.
- **`Sqrt(M) − Sqrt(M)`** — becomes the Phase B acceptance test (collapses to
  `[[0,0]]` once broadcast-produced Lists are first-class tensor operands).
- **Tuple/point semantics** — orthogonal, planned separately
  (2026-07-07 doc); this design only guarantees tuples never form axes,
  which is current behavior.
- **Exactness facet** — already shipped (2026-06-28, Facet 1); D2 preserves
  its invariant (exact cells never floatify) by construction, since packing
  only happens for eligible dtypes on kernel entry.

## Do not re-attempt (carried over)

The broadcast-promotion and `operator === 'List'`-gate point fixes from the
2026-06-28 doc were measured and regress on precision, performance, or
correctness. Any implementation of this design that finds itself adding a
per-broadcast classification step or a storage dtype decision has left the
design.
