# Tensor Value Representation — `List` vs `BoxedTensor`

**Date**: 2026-06-28
**Status**: Exactness facet shipped; detection facet deferred (design note).
**Roadmap**: Strategic item 9 in `ROADMAP.md`.
**Superseded (Facet 2)**: the representation-level design this doc called for
is now specified in
[`2026-07-20-tensor-unification-design.md`](./2026-07-20-tensor-unification-design.md)
(approved). The failure analysis below remains authoritative.

## Summary

A class of matrix/vector arithmetic bugs traces to **tensor values having two
representations**:

- a **`BoxedTensor`** instance, built via the canonical
  `ce.box`/`ce.function`/`makeCanonicalFunction` path
  (`boxed-expression/box.ts`, ~line 532), and
- a plain **`List` `BoxedFunction`**, built by the broadcast/map machinery via
  `ce._fn('List', …)` (`boxed-expression/boxed-function.ts`).

`isTensor(x)` is `x instanceof BoxedTensor`, so it only recognizes the first
form. A tensor-shaped *plain* list therefore slips past every tensor-arithmetic
path — `add`/`mul` → `addTensors`/`mulTensors`, `MatrixMultiply`, `MatrixPower`.

There are **two entangled facets**. One shipped; the other is deferred.

## Facet 1 — Exactness (SHIPPED)

`getExpressionDatatype` (`tensor/tensor-fields.ts`) mapped the numeric types
`rational` / `real` / `finite_rational` / `finite_real` to the `float64`
element type. A `BoxedTensor` of exact rationals or radicals was therefore
stored as machine floats and **silently floatified**:

```
Add(½-matrix, ½-matrix)  →  [1, 0.666…]   instead of  [1, ⅔]
```

**Fix (landed):** `return expr.isExact ? 'expression' : 'float64'`. Exact entries
use the `expression` dtype and stay exact; inexact (machine/decimal) entries keep
`float64`. Zero snapshot blast radius across the full suite.

## Facet 2 — Detection (DEFERRED)

Make `Sqrt(M) − Sqrt(M)` evaluate to `[[0,0]]` instead of staying symbolic. The
operands are broadcast-produced plain `List`s, so `add()` (gated on
`isTensor`) does not route them through `addTensors`.

**Three normalization approaches were tried; all regressed.** Each was measured
against the full test suite.

1. **Producer** — promote broadcast results to `BoxedTensor`
   (`ce._fn('List', …)` → `ce.function('List', …)`). Forcing every broadcast
   result through a tensor means `float64` **truncates bignums**: `√list.N()`
   lost its ~100-digit arbitrary-precision result. At the default (auto)
   precision a machine float and a high-precision bignum are *both*
   `BigNumericValue` with `isExact === false`, so the dtype can't be chosen to
   tell them apart.

2. **All-`expression` dtype** — to stop the bignum truncation, send all
   real/rational to `expression`. Tensor ops on `expression` dtype are slow →
   the calculus **doubly-infinite-sum tests time out** (Richardson
   `extrapolate`/`limit`).

3. **Detector** — gate `add`/`mul` on `x.operator === 'List'` and re-box plain
   lists to tensors in the bucketing. The gate is **too broad** (lists are
   pervasive, not only tensors) → broke non-tensor list usage; and the
   `ce.box(x.json)` re-box is **too slow** in hot loops → timeouts and ~17
   failures across 6 suites.

4. **Smart producer** — promote a broadcast result only when its dtype is
   exact-preserving (`expression`/integer/bool), leaving `float64`/`complex128`
   as a plain list. Correct in isolation, but `expressionTensorInfo` +
   `BoxedTensor` construction **per broadcast** added ~225 s suite-wide →
   blew simplify/rule **deadlines** (`sin(∞)` returned unsimplified) and the
   calculus timeouts returned.

### Why it's hard

- **The dtype is ambiguous at default precision.** Machine floats and bignums
  share the `BigNumericValue` / `isExact === false` shape, so you cannot cheaply
  pick `float64` (compact, fast, lossy for bignums) vs `expression` (exact,
  slow) per value.
- **Normalization is hot.** Broadcast/map run inside simplify, rule dispatch,
  and the calculus limit/extrapolation loops, all of which run under deadlines.
  Any per-broadcast `expressionTensorInfo`/re-box/`BoxedTensor` cost blows those
  budgets.

A real fix is a **representation rework**, not a patch — e.g. normalize the
representation at construction so there is only one form, or make
`isTensor`/tensor access work on a tensor-shaped plain `List` *without* per-call
re-boxing (a cheap shape/dtype cache on the `List`, or a lazy tensor view). Let
demand justify the investment.

### What already covers the common cases

The visible breakage in normal matrix algebra is handled by per-site fixes that
landed alongside the matrix-multiplication work:

- `Negate` distributes over an operand that becomes a tensor after evaluation
  (`library/arithmetic.ts`), so `A·B − A·B` and `AB − BA` evaluate correctly.
- `MatrixPower`'s negative branch (`A^{-n} = (A^n)^{-1}`).
- Matrix juxtaposition canonicalizes to a product (`Multiply`), not a `Tuple`.

The residual is `f(M) ± f(M)` where *both* operands are broadcast-produced plain
lists (e.g. `Sqrt(M) − Sqrt(M)`): it stays symbolic rather than collapsing
element-wise. No wrong answer — just unevaluated.

## Do not re-attempt

The broadcast-promotion and `operator === 'List'`-gate approaches above were
measured and each regresses on precision, performance, or correctness. Start
from a representation-level design, not another point patch.
