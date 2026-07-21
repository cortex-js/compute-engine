# Tensor Unification — One List Representation, Lazy Tensor View

**Date**: 2026-07-20 (revision 4 — resolves all three review rounds in
`docs/scratch/2026-07-20-tensor-unification-design_SPEC_REVIEW.md`)
**Status**: APPROVED (ratified 2026-07-20); Phase A in progress.
**Roadmap**: Strategic item 9 in `ROADMAP.md`.
**Supersedes**: the "Facet 2 — Detection (DEFERRED)" section of
[`2026-06-28-tensor-value-representation-design.md`](./2026-06-28-tensor-value-representation-design.md).
That doc's failure analysis of the four attempted point fixes remains
authoritative; this doc is the representation-level design it called for.
**Related**:
[`2026-07-07-honest-list-broadcast-typing.md`](./2026-07-07-honest-list-broadcast-typing.md)
(landed — §D6 extends its wrapper soundly and leaves its no-length-propagation
rationale intact where lengths are genuinely unknowable),
[`2026-07-07-tuple-point-semantics.md`](./2026-07-07-tuple-point-semantics.md)
(planned — orthogonal; this design only guarantees tuples never form axes).

## Motivation — three converging symptoms

1. **Mistyping (Tycho item 69).** `['List', Rgb(…), Rgb(…)]` types as
   `vector<2>`. Not color-specific: any shape-regular list becomes a
   `BoxedTensor`, whose `type` getter is purely shape-derived
   (`list<number^dims>` hardcoded), discarding element types. The same
   conflation admits non-numeric tensors into numeric signature positions.
2. **Detection gap — signature-gated operations.** Broadcast/map results are
   plain `List` `BoxedFunction`s; `isTensor` only recognizes `BoxedTensor`
   instances. *Elementwise* arithmetic over such lists was closed by
   `broadcastOverIndexedCollections` (2026-07-11, `cd593ae2`): `Sqrt(M) −
   Sqrt(M)` already evaluates to `[[0,0],[0,0]]` on main. What remains broken
   is **signature-gated and tensor-only** operations: `Determinant(Sqrt(M))`
   errors `incompatible-type` — and, critically, it errors **at
   canonicalization**, because the unevaluated `Sqrt(M)` statically types
   `list<finite_number>` (flat — a rank soundness gap in the broadcast type
   wrapper, §D6.1) which provably mismatches `matrix`. No evaluate-time
   mechanism can reach this case; §D6 addresses it at the typing/validation
   layer.
3. **Architecture smell.** `CONTAINER_OPERATORS` (`boxed-tensor.ts`) is a
   hardcoded operator blocklist approximating a type-level property
   syntactically — needed only because tensor classification runs on raw,
   pre-binding operands. That early classification is forced by the eager
   `BoxedTensor` construction path. Same root cause as symptom 2.

## The model: cells and axes

Every value is either an **axis-former** or a **cell** (APL rank calculus,
NumPy structured dtypes).

- **Axis-former**: a **literal `List` node** — and only that. Axis-formation
  is *operator-structural*: shape derives from the nesting of literal `List`
  nodes in `ops`, exclusively. A symbol or application merely *typed*
  `list<…>` never contributes an axis — not to the shape walk (§D2), not as
  a nested-axis element (§D3). As a List element it is a **non-atomic
  element** (blocks any shape claim); as a standalone value it participates
  through the collection protocols, not the tensor view. *(One invariant,
  applied uniformly — the two-rule ambiguity flagged in review R2-2 is
  resolved in favor of operator-structural.)*
- **Cell**: an element whose type is **atomic** (§D5) — numbers, symbols,
  strings, colors, and all product/aggregate values (tuples, sets,
  dictionaries, records). Cells are opaque to elementwise broadcasting: a
  list of points is rank-1 with point cells, never a 2×2 tensor.

"Tensor" conflates two independent properties, which this design separates:

1. **Shape-regularity** — uniform nesting of literal Lists over atomic
   cells. Applies to any cell type; what typing and structural ops need.
2. **Kernel admissibility** — cells that numeric/boolean packed kernels may
   operate on (§D2.3). A strict subset of shape-regular.

## Design

### D1 — Single representation

`makeCanonicalFunction` (`box.ts`) stops constructing `BoxedTensor`. Every
list is a plain canonical `List` `BoxedFunction`; the plain-List construction
path **must forward `metadata`** (today only the tensor branch does — a
silent metadata loss if the branch were merely deleted). The `BoxedTensor`
Expression subclass is **deleted**; `AbstractTensor`/`TensorData` remain as
the internal kernel carrier. `expressionTensorInfo` and `CONTAINER_OPERATORS`
lose their only caller when the construction branch goes and are **removed in
the same phase** (Phase C) — no dead-code interregnum.

**Public API impact (authorized breaking change).** `BoxedTensor` is
publicly exported as a type (`src/core.ts`, `src/compute-engine.ts`);
`isTensor`/`TensorInterface` are documented API. The user ruled (2026-07-20)
that `BoxedTensor` has no external consumers; removal is an **authorized
breaking change** with a `CHANGELOG.md` callout. Dispositions:

| Surface | Disposition |
| --- | --- |
| `export type { BoxedTensor }` | Removed. CHANGELOG callout. |
| `isTensor(x)` (public guard) | Kept, re-implemented (§D4.1); narrows to `Expression & TensorInterface`. |
| `TensorInterface.shape` / `.rank` | Kept — base-Expression API. Under §D4.1 a *qualifying* `List` reports its shape; non-qualifying expressions keep `[]`/`0`. Behavior fix: broadcast-produced matrices currently report `[]`. |
| `TensorInterface.tensor` | Removed from the public surface; internal consumers migrate to `packTensor` (§D2.3). CHANGELOG callout. |

### D2 — Tensor-ness as a lazy view

View state lives on `BoxedFunction`, in-idiom with its existing lazy caches
(`_value`, `_valueN`, `_sgn`, `_type`, `_hash`), populated only on
`List`-operator nodes on first demand. Four levels, each with an explicit
cost, dependency, and caching contract:

| Level | Computes | Cost | Depends on | Caching |
| --- | --- | --- | --- | --- |
| **D2.1 `candidateShape`** | first-child-chain descent of nested literal `List` nodes; no row validation, no cell inspection | O(rank) | `ops` structure (immutable) | cached, generation-free |
| **D2.2 `structuralShape`** | full regularity walk: every row length at every axis; mixed leaf/nested, ragged, or empty level → `null` | O(cells) | `ops` structure (immutable) | cached, generation-free |
| **D2.3a `shapeQualified`** | every element classifies as a **cell** under the shared element classification (§D3 rule 1 — atomic type, or folded bare symbol; applications with `unknown`/`any` return block) AND the global widened cell type is union-free (§D3 rule 2) | O(cells) type reads | element `.type`s (**mutable under inference**) | cached **with generation tracking** — rides the same `CachedValue` invalidation as `_type` |
| **D2.3b `kernelDtype` / `packTensor`** | per-operation admissibility + packed `AbstractTensor` | O(cells) | cell types *and* values *and* operation context | **never cached on the node** — operation-local |

Levels D2.1/D2.2 are purely structural and honestly generation-free. Level
D2.3a is type-dependent and therefore generation-tracked — *nothing
type-dependent is ever cached generation-free* (this resolves review
findings 11/12 and R2-2's caching ripple). Level D2.3b is never stored, so a
lossy pack made for one consumer can never leak into another; kernel results
may pre-populate the **structural** levels of the result List only.

**Hot-path contract**: dispatch sites on the broadcast hot path (§D4.2)
consult **`candidateShape` only** (O(rank)). The O(cells) levels run at
kernel entry, where the kernel is about to do O(cells) work anyway. This is
the structural guarantee that the measured "smart producer" deadline blowups
cannot recur.

**Packing policy** — complete matrix over operation mode × working precision
× cell population (eligibility computed once per whole List per operation; a
single inadmissible cell demotes the entire operation to its fallback — no
per-cell mixed packing):

| Mode | Working precision | Cell population | Packing |
| --- | --- | --- | --- |
| any | any | any cell non-numeric/non-boolean by type kind (string, color, tuple, set, dictionary, record, list-kind, union w/ such an arm) | **none** — inadmissible; arithmetic falls back to generic elementwise broadcast; signature-gated ops decline via honest types (§D3) |
| exact `evaluate()` | — | numeric cells (exact, symbolic, machine, bignum) | `expression` dtype for non-elementwise ops (Determinant/Inverse/MatrixMultiply/decompositions — today's `dtype === 'expression'` branches keep their semantics); elementwise ops use the generic broadcast path, no packing |
| `.N()` | ≤ machine (`precision === 'machine'` or ≤ 15 digits) | all cells numeric (any representation; exact cells numericize to machine) | `float64` / `complex128` |
| `.N()` | > machine | all cells numeric — whether exact (integers/rationals/radicals), machine, or high-precision bignum | **no `float64`** — elementwise high-precision evaluation over the List (each cell evaluated at engine precision); non-elementwise ops pack `expression` dtype over the numericized cells |
| boolean kernels | — | all cells boolean | `bool` |

The rule is precision-driven, not representation-driven: `float64` is chosen
iff the operation's working precision is machine — never because a cell
*happens* to be a machine float while the engine is at 100 digits. Facet 1's
invariant (exact cells never floatify under exact `evaluate()`) holds by
construction. Acceptance fixture (the historical "Producer" regression):
`ce.precision = 100; ce.box(['Sqrt', ['List', 2, 3]]).N()` — each element
must agree with an independently computed 100-digit `BigDecimal` square root
to ≤ 1 ulp at that precision.

> Note on `Add` over color lists: `[Rgb,Rgb] + [Rgb,Rgb]` yields
> `[2Rgb(…), …]` today via `addTensors`; scalar `Rgb + Rgb` exhibits the
> same coefficient folding via generic like-term collection. Whether linear
> color arithmetic is *meaningful* is a colors-library question, out of
> scope (2026-07-20 color ruling: color values propagate mathematically).
> This design's obligation is narrower: non-numeric-cell lists must not
> type `vector<n>` (D3) and must never enter *packed numeric* kernels
> (D2.3).

### D3 — Typing rule for `List`

The `List` type handler emits, for a **literal `List` node**:

1. **Classify each element**:
   - atomic type (§D5) → cell, with that cell type;
   - **inference-pending bare symbol** (symbol typed `unknown`) → cell of
     type `number` (the generic-symbol convention, exactly as
     `pointComponentType` applies it). The fold is restricted to **bare
     symbols**; an *application* with `unknown`/`any` return type is NOT
     folded (it may return a collection) and **blocks**;
   - **literal `List` child** → nested-axis candidate (only literal Lists —
     a symbol typed `vector<2>` is NOT an axis, per The model);
   - anything else (list/collection/`indexed_collection`-kind type,
     non-foldable `unknown`/`any`, non-atomic union, `broadcastable<…>`) →
     **blocks**.
2. **Shape claim** — emitted only when ALL of:
   - no element blocks; no mixed cell/axis level; no ragged rows; no empty
     level (zero-length axes are never claimed);
   - for rank ≥ 2: every child is a literal `List` with **identical
     dimensions** (cell types need NOT match row-by-row — review R2-3);
   - the **global widened cell type** — widen over *all leaves*, across all
     rows — is **union-free**. `widen(finite_integer, finite_real) =
     finite_real` → claim; `widen(number, color) = number | color` → no
     claim (a heterogeneous cell population makes no kernel or signature
     sense — this is the formerly-implicit `[x, Rgb]` exclusion, now a
     normative clause; review R2-4).
3. **Type** = `list<C^dims>` when the claim holds — C the global widened
   cell type, **reported honestly with no numeric lift** — otherwise plain
   `list<widen(...)>` exactly as today. *(A numeric-lift-to-`number` clause
   was tried in revision 4 to keep `vector<n>` strings byte-stable and was
   **measured wrong in Phase A**: the landed broadcast-typing contract
   requires an evaluated value's type to be a SUBTYPE of the statically
   declared `list<R>` — `evaluated.matches(declared)`,
   `list-broadcast-typing.test.ts` — and lifting `finite_real` cells to
   `number` widens past `R`, breaking the contract for every wrapper-lifted
   family. Honest widening satisfies it by construction. Consequence,
   owned: literal numeric lists' type strings narrow —
   `[1,2,3]: list<finite_integer^3>`, not `vector<3>`; still `matches
   'vector<3>'` for every consumer, since `finite_integer ⊂ number` and
   dimensioned lists subtype their unbounded forms.)*

Normative examples:

| Expression | Type | Note |
| --- | --- | --- |
| `[1, 2, 3]` | `list<finite_integer^3>` | honest; `matches('vector<3>')` holds |
| `[x, y]` (bare symbols) | `vector<2>` | unchanged (fold gives exactly `number`) |
| `[Rgb, Rgb]` | `list<color^2>` | fixed (was `vector<2>`) — closes Tycho 69 |
| `[[1,2],[3.5,4.5]]` | `list<finite_real^2x2>` | rows widen differently; global widening governs (R2-3); `matches('matrix<2x2>')` holds. *Phase A interim: as a boxed literal this takes the packed-dtype fast path and types `matrix<2x2>` — see the Phase A note; the honest form applies to plain Lists and from Phase C on.* |
| `[x, Rgb]` | `list<(number\|color)>` — no shape | union-free clause (R2-4) |
| `[h(x)]`, `h: → unknown` | `list<unknown>` — no shape, no fold | applications never folded |
| `[L, L]`, `L: list<number>` | `list<list<number>>` — no shape | list-typed symbol blocks; also `isTensor` false, `shape []` (§D4.1 — type and guard agree) |
| `[SpeedOfLight, PlanckConstant]` (`value`-typed) | `list<value>` — no shape | `value` = scalar ∪ collection → non-atomic (§D5); fixes a live mistyping |
| `[[x,y],[z,w]]` (undeclared symbols) | `list<number^2x2>` (= `matrix<2x2>`) | bare-symbol fold at every leaf; keeps the `expression`-dtype kernel path |
| `[V, V]`, `V: vector<2>` | `list<vector<2>>` — no shape | typed-vector elements are not axes (The model) |
| `[1,[2]]`, ragged, `[]`, `[[],[]]` | no shape (`[]` → `list<nothing>`) | unchanged |

**Reconciliation with `2026-07-07-honest-list-broadcast-typing.md`**: that
decision governs the **static type of an unevaluated broadcast
application** (extended, soundly, by §D6.1); this rule governs the type of a
**literal `List` value**. Consequence, owned explicitly: an *evaluated*
broadcast result is a literal List and **gains a shape**
(`Sin([0,1]).evaluate()` → `vector<2>`, was unbounded `list<finite_real>`).
Strictly narrowing, and in the Phase A audit scope — the churn class is
"every shape-regular evaluated List", not only non-numeric-element lists.

### D4 — Guards and dispatch

**D4.1 — One `isTensor`, agreeing with `.type`.** Both existing
implementations (`boxed-tensor.ts`'s `instanceof`; `type-guards.ts`'s
`_kind === 'tensor'`) are replaced by a single implementation in
`type-guards.ts`:

```
isTensor(x) ⇔ x is a List BoxedFunction
              ∧ structuralShape(x) !== null     (D2.2)
              ∧ shapeQualified(x)               (D2.3a)
```

**One shared predicate** (review R3-1): `shapeQualified` is the *same*
element-classification + union-free test that D3 rule 1–2 uses for the type
handler's shape claim, and the same effective-cell classifier feeds
`kernelDtype` (§D2.3b). Consequence: `isTensor`, `.shape`, `.rank`, and
`.type`'s shape claim can never disagree on any value — `[L,L]` (list-typed
elements), `[x,Rgb]` (union widening), `[h(x)]` (unblocked-unknown
application), and `[SpeedOfLight, PlanckConstant]` (`value`-typed cells,
§D5) are all uniformly `isTensor === false`, `shape []`, and unshaped-typed.
`.shape`/`.rank` report `structuralShape` iff `isTensor` holds, else
`[]`/`0`. `[Rgb,Rgb]` IS a tensor (shape-regular, homogeneous atomic
cells) — structural ops apply; packed numeric kernels additionally require
`kernelDtype`. The classifier applies the bare-symbol fold everywhere it
runs: `[[x,y],[z,w]]` (undeclared symbols) is a tensor and keeps the
`expression`-dtype kernel path (review R3-7).

**D4.2 — Hot-path dispatch uses `candidateShape` only.**
`boxed-function.ts:1454/1747/2283` runs `ops.some(isTensor)` on every
broadcastable-operator evaluation over freshly-constructed operands; any
O(cells) work there reproduces the measured deadline blowups. Sites needing
only "could this be a tensor?" (`hasTensors` → `skipBroadcastForVectorOps`,
kernel entry gates) consult `candidateShape` (O(rank), cached). Full
validation (D2.2/D2.3) runs once at kernel entry; a non-qualifying candidate
falls back to the generic broadcast path there.

**D4.3 — Consumer migration table** (grep-verified surface):

| File | Sites | Migration |
| --- | --- | --- |
| `type-guards.ts` | the guard | becomes the single implementation (D4.1) |
| `boxed-tensor.ts` | class, `instanceof` guard, `expressionTensorInfo`, `CONTAINER_OPERATORS` | class + guard deleted; walk logic becomes `structuralShape`; detector + blocklist removed with the construction branch (D1) |
| `boxed-function.ts` | 1454/1747/2283 | `candidateShape` (D4.2) |
| `arithmetic-add.ts` | 298/400/454/457/506/587 | gates: `candidateShape`; kernel entry: full check + `kernelDtype` + `packTensor` |
| `arithmetic-mul-div.ts` | 1505/1558/1589/1682/1703/1736 | same as add |
| `compare.ts` | 96/671 | `isTensor` (D4.1) + elementwise walk over ops — no packing |
| `validate.ts` | 284 | **stays deliberately lenient**: accepts `candidateShape`-level operands into numeric validation. Rationale: the downstream `kernelDtype` demotion makes a false admit harmless (`Add([L,L],[1,2])` stays symbolic — inert, not wrong); tightening here would need the type-dependent D2.3a on a validation path. Explicit ruling per review R2-9. |
| `order.ts` | `isTensorProductOperand` | already type-based; verify unchanged |
| `library/arithmetic.ts` | 1496/1521 | `isTensor` for typing branches; honest type from D3 |
| `library/linear-algebra.ts` | ~60 sites, **split two ways** (R2-6): | |
| — structural ops | `Transpose`, `ConjugateTranspose` (structure part), `Reshape`, `Flatten`, `Shape`, `Rank`, predicates (`IsSquareMatrix` …) | `isTensor` + ops-structure implementations; **cell type preserved in result types** (`Transpose: list<color^2x3> → list<color^3x2>`); `Reshape`'s numeric-only type handler is fixed as part of this |
| — packed kernels | `Determinant`, `Inverse`, `MatrixMultiply`, `PseudoInverse`, decompositions, norms | `isTensor` gate + `packTensor` per D2.3 policy (`expression` dtype for exact/symbolic preserved) |
| `library/collections.ts` | comment | update |
| `function-utils.ts` | 695 (subs traversal) | plain-List subs already traverses ops — special case likely deletable; verify |
| `compilation/base-compiler.ts` | 1078/1107/1112 (GLSL) | `isTensor` + honest type; explicit compile/GLSL regression test in the Phase C gate |
| `core.ts` / `compute-engine.ts` | re-exports | per D1 table |

### D5 — Atomicity predicate

`isAtomicValueType(t)`, over the **full** Type AST, branching on the
bare-string form first (the codebase's `typeof t === 'string'` pattern).
Conservative principle: **when in doubt, not atomic** — blocking only
withholds a shape claim (safe); over-claiming creates false tensors.

```
isAtomicValueType(t):
  if t is a string (bare PrimitiveType):
    return t ∉ {'list', 'collection', 'indexed_collection', 'value'}
    // 'value' is documented as scalar ∪ collection — a value-typed element
    // COULD be a list at runtime. Live class: ~12 physics constants
    // (SpeedOfLight, PlanckConstant, Mu0, …) are typed 'value', and
    // [SpeedOfLight, PlanckConstant] mistypes vector<2> on main today
    // (same class as [Rgb,Rgb]). Review R3-4.
  switch t.kind:
    'list' | 'collection' | 'indexed_collection'  → false
    'union' | 'intersection'                       → every arm atomic
        // union: value MIGHT be a collection arm → block unless all atomic
        // intersection: value IS every arm → any collection arm makes it one
    'broadcastable'                                → false  (lift marker)
    'negation'                                     → false  (can't bound; conservative)
    'reference'                                    → t.def resolved ? recurse(t.def)
                                                     : false (unresolved; conservative)
    'value'                                        → recurse on the literal's type
    'signature'                                    → true   (functions are cells)
    'tuple' | 'set' | 'dictionary' | 'record'      → true   (product/aggregate cells)
    default (numeric kinds, boolean, string, color,
             symbol, expression, function, unknown, any) → true
```

(`unknown`/`any` atomicity governs cell *classification* only; whether such
an element supports a *shape claim* is D3's stricter rule — bare symbols
yes, applications no.) Once D1 removes pre-binding classification, this
predicate is the sole atomicity authority — `CONTAINER_OPERATORS` and the
string-element special case retire into it.

### D6 — Broadcast result typing and deferred validation (resolves R2-1)

The headline acceptance case fails **at canonicalization**: `Determinant`
validates its operand against `matrix` when the expression is constructed,
and unevaluated `Sqrt(M)` statically types flat `list<finite_number>` — a
provable mismatch — so the operand is replaced by an `incompatible-type`
Error before any evaluate-time machinery can run. Two layered fixes, both in
shared machinery (per-operator type handlers stay untouched):

**D6.1 — Rank/shape-aware broadcast lift.** The T1 wrapper
(`boxed-function.ts:2358`) lifts the handler's scalar result with a
**single-level** `broadcastResultType` → `list<E>` regardless of operand
rank, while the value machinery recurses — a rank soundness gap (`Sqrt(M)`
claims number elements; the value's elements are rows). Fix, in
`broadcastResultType`/the wrapper: **structure-map the operand's static
collection type** — mirror its list-nesting, replacing scalar leaves with
the handler's scalar result, and copy **dimensions where the operand type
carries them**:

| Operand static type | Result static type (scalar result R) |
| --- | --- |
| `list<number>` (unknown length) | `list<R>` (unchanged — no invented lengths) |
| `matrix<2x2>` | `list<R^2x2>` (matches `matrix` — statically valid) |
| `list<list<number>>` (rank 2, no dims) | rank-2 result with open lengths |
| `broadcastable<…>` operand arm (line 2369) | `broadcastable<R>` (unchanged — rank unknowable) |

**Encoding**: shaped results are emitted in the **dimensioned** form
(`list<R^2x2>` — `{kind:'list', elements:R, dimensions:[2,2]}`), never as
nested `list<list<R>>`: the dimensioned form is what the verified subtype
rule relates to `matrix`/`vector` (whose declared dims parse to `[-1,-1]`
wildcards). Review R3-3.

**Multiple shape-bearing operands** (review R3-2 — binary/n-ary
broadcastables such as `Greater`/`Less`/`Equal` hit this same wrapper arm
and are NOT in the handler-owned allowlist): dimensions are copied **only
when every shape-bearing collection operand's static shape is provably
identical**. When shapes are known and disagree, or ranks disagree, or any
shape is open, the lift degrades gracefully: common provable rank →
rank-preserving with open lengths; otherwise plain `list<R>`. (The value
machinery zips to the shortest participating length, so any stronger claim
would be unsound. Fixture: `Greater(matrix<2x2>, vector<3>)` →
`list<boolean>`.) Two-tensor `Add`/`Multiply` *result* typing
(matrix-product shapes, dot products) remains explicitly out of scope, as
honest-broadcast-typing T2 already ruled.

This *extends* the 2026-07-07 no-length-propagation decision rather than
reversing it: lengths are propagated **only where the operand types already
prove them**, which is exactly where propagation is sound; the unbounded
upper bound remains for unknowable sources. The three
`handlerOwnsCollectionTyping` operators (`Add`/`Multiply`/`Negate`,
`arithmetic.ts:1500`) call the same helper for their *elementwise* cases
and get the same treatment. Consequence: `Determinant(Sqrt(M))` with
`M: matrix<2x2>` becomes **statically valid — no deferral involved** — for
all fixed-shape sources, which is the common case.

**D6.2 — Overlap-deferred validation.** For the residue where the operand's
static type genuinely underdetermines conformance (e.g. `Determinant(xs)`
with `xs: list<number>` of unknown length — could be a flat vector or,
post-evaluation, never a matrix), signature validation gains a three-way
outcome:

- **provably incompatible** (empty meet with the parameter type) → Error at
  canonicalization, exactly as today (`Determinant("abc")`,
  `Determinant(5)` unchanged);
- **provably compatible** → accepted, as today;
- **overlapping** (non-empty meet; collection-kind parameter and
  collection-kind operand only) → accepted provisionally; the operand is
  re-validated against its **evaluated** value at evaluate entry, failing
  with the same `incompatible-type` error there.

**Mechanization** (review R3-3/R3-5/R3-6 — the machinery this must actually
land in):

- **Overlap primitive**: `common/type/reduce.ts`'s `meet2` is
  module-private and partial. Export a specified `overlaps(a, b)` (or a
  completed, exported meet) covering: primitives, lists in **both** the
  dimensioned and nested encodings (related to `matrix`/`vector` wildcard
  dims), unions/intersections (arm-wise), references (dereferenced), and
  `broadcastable<T>` — whose collection alternative **does** participate in
  deferral (it is precisely the rank-unknowable case D6.1 identifies; the
  "collection-kind only" restriction is on the *parameter*, not the
  operand).
- **Scope**: the three-way outcome lands in the fixed-arity
  `.matches(param)` gates of `validate.ts` (required/optional/variadic
  param blocks) used by the `Determinant`/`Inverse`/`MatrixMultiply`-class
  signatures. `checkNumericArgs` is **out of scope** — its operator class
  (variadic threadable arithmetic) is covered by generic broadcast and the
  deliberately-lenient gate ruling (§D4.3, validate row).
- **Marking + re-check point**: a provisionally-accepted operand is
  recorded on the canonical `BoxedFunction` (the unmet parameter type,
  alongside the existing validation state); the re-check runs at
  **evaluate entry** in `_computeValue` (the single choke point through
  which `evaluate()`/`evaluateAsync()`/`.N()` all pass — behavior is
  identical across all three), against the **once-evaluated** operand,
  which is then reused by the handler (never re-evaluated).
- **Still-undetermined outcome**: if the evaluated operand is *still* only
  overlap-compatible (an unassigned symbol evaluating to itself, a lazy
  collection), the expression stays **inert** — unevaluated, no error;
  same posture as any symbolic operand today.
- **Handler precedence** (review R3-6): operators with their own runtime
  shape guards (`Determinant`/`Inverse` already emit
  `expected-square-matrix` for the non-square case) keep them, and they
  take precedence — the generic re-check covers conformance the handler
  doesn't itself check, so the error identifier for an evaluated non-square
  operand remains the more specific `expected-square-matrix`, not
  order-dependent.

**Diagnostics timing note** (CHANGELOG + Tycho callout): expressions in the
overlap zone stop erroring at parse time and error (or succeed) at evaluate
time; `parseDiagnostics` consumers see fewer parse-time
`incompatible-type` reports for collection-typed operands.

## Why the four measured failures don't recur

| 2026-06-28 failure | What dissolves it |
| --- | --- |
| **Producer** truncated bignums (forced `float64` storage) | No storage commitment; packing is per-operation and `float64` requires machine working precision (D2.3 policy is precision-driven) |
| **All-`expression` dtype** slow (calculus timeouts) | `expression` packing chosen per-operation only where needed (non-elementwise exact ops); elementwise numeric hot paths take `float64` or the generic broadcast path |
| **Detector** gate too broad + re-box too slow | No re-box: views read ops in place; dispatch gate is `candidateShape` at O(rank), full check only at kernel entry (D4.2) |
| **Smart producer** per-broadcast classification blew deadlines | Hot dispatch is capped at O(rank) by contract (D2 hot-path contract); O(cells) levels run only where O(cells) kernel work is already committed |

## Phasing — each independently landable, each with a measurement gate

**Phase A — honest List typing (closes Tycho item 69).** D3 in the `List`
type handler; `BoxedTensor.type` delegates to it (interim) **for
`expression`-dtype tensors**; packed numeric/bool dtypes keep
`number`/`boolean` cells (their leaves are raw JS primitives, not boxed
ops), preserving `vector<n>`/`matrix<…>` strings for boxed literals. This
is a transitional dual typing — literal `[1,2,3]` types `vector<3>` while a
plain-List `[1,2,3]` (broadcast result) types `list<finite_integer^3>` —
consistent under subtyping (the honest form ⊆ the packed form) and resolved
by Phase C's single representation.
*Gate*: full suite; snapshot-churn count reported (no `@fixme` updates);
`matches()` audit over (a) `addType`/`Multiply.type` single-tensor branches,
(b) compile/GLSL `vars` typing, (c) the evaluated shape-regular List class
(`Sin([0,1]).evaluate()` gaining `vector<2>`); timing-flake suites
(calculus/timeout/fungrim-loader/rubi-utils) re-run isolated before
attributing failures.

**Phase B — broadcast result typing + deferred validation (D6).** The
structure-mapping lift in `broadcastResultType`/wrapper + the three
handler-owned call sites; the three-way validation outcome + evaluate-entry
re-validation.
*Gate*: `Determinant(Sqrt(M))` and `MatrixMultiply(Sqrt(M), Sqrt(M))`
(`M = [[2,3],[5,7]]`) **canonicalize without `incompatible-type`** and their
static types are asserted (`Sqrt(M): list<finite_number^2x2>`); deferral
case `Determinant(xs)`, `xs: list<number>` undeclared length, canonicalizes
provisionally and errors at evaluate when `xs` evaluates non-square;
provably-wrong operands still error at canonicalization (the R2-1 table);
mixed-shape n-ary fixture `Greater(matrix<2x2>, vector<3>)` types
`list<boolean>` (no dims invented); static-type churn audit over broadcast
applications with fixed-shape operands; full suite. *(Note: `Determinant(Sqrt(M))` does not fully
**evaluate** until Phase C lands — Phase B's gate is canonical validity and
types, Phase C's is the value.)*

**Phase C — lazy view + representation unification.** D2 caches/levels;
D4.1 single `isTensor`; migrate every D4.3 row; metadata forwarding (D1);
stop constructing `BoxedTensor`; delete the class; remove
`expressionTensorInfo` + `CONTAINER_OPERATORS`; update `ARCHITECTURE.md`
(Expression Types row) and `CHANGELOG.md` (D1 + D6.2 callouts).
*Gate — acceptance matrix* (`M = [[2,3],[5,7]]`, `Ms = [[x,y],[z,w]]` with
undeclared symbols — the bare-symbol fold makes it a tensor on the
`expression`-dtype path, §D4.1 — and `Mq` exact rational):

| Case | Required behavior |
| --- | --- |
| `Determinant(Sqrt(M))` | **evaluates** (the headline case, now reachable via D6 + D4) |
| `MatrixMultiply(Sqrt(M), Sqrt(M))` | evaluates on broadcast-produced operands |
| `Determinant(Ms)`, `Inverse(Ms)`, `MatrixMultiply(Ms, Ms)` | unchanged (`expression`-dtype path preserved) |
| `Determinant(Mq)` exact / `.N()` | exact rational / float; no floatification under exact `evaluate()` |
| `ce.precision = 100; Sqrt([2,3]).N()` | ≤ 1 ulp vs independent 100-digit computation (D2.3 fixture) |
| `[Rgb,Rgb]` | typed `list<color^2>`; `isTensor` true; `Transpose`/`Reshape` work, cell type preserved; never enters a numeric `packTensor` |
| `[L,L]`, `L: list<number>` | `isTensor` false, `shape []`, typed `list<list<number>>` (guard/type agreement) |
| `[SpeedOfLight, PlanckConstant]` | `isTensor` false, typed `list<value>` — no shape (`value` non-atomic, §D5) |
| `Add([L,L],[1,2])` | validates (lenient gate), stays symbolic — inert, not wrong |
| `shape`/`rank` on a broadcast-produced matrix | `[2,2]`/`2` (today `[]`/`0`) |
| metadata-bearing numeric matrix | metadata survives boxing and JSON round-trip |
| equality/compare, `subs`, compile (JS + GLSL matrix/vector detection) | parity on rank-1/rank-2 numeric, exact, symbolic fixtures |
| detection parity | tuples/sets/dictionaries/records/strings/`Hold`-wrapped elements classify identically pre/post `CONTAINER_OPERATORS` removal |

*Gate — perf*: box-microloop canary ≈ 0.02 ms/iter unchanged; calculus
doubly-infinite-sum + simplify deadline suites green (`sin(∞)` simplifies);
full-suite wall time within noise of a recorded baseline; broadcast-heavy
microbench on the D4.2 sites (`Sqrt(M) − Sqrt(M)` in a loop). Madge clean.

## Out of scope (explicit)

- **Color arithmetic semantics** (`Rgb + Rgb` folding) — colors-library
  question, independent of representation (D2.3 note); raised separately.
- **Tuple/point arithmetic** — `2026-07-07-tuple-point-semantics.md`;
  this design only preserves "tuples never form axes".
- **Two-tensor static result typing** (matrix-multiply/dot-product static
  types) — explicitly left as-is by honest-broadcast-typing T2.

## Do not re-attempt (carried over)

The broadcast-promotion and `operator === 'List'`-gate point fixes from the
2026-06-28 doc were measured and regress on precision, performance, or
correctness. Any implementation that adds a per-broadcast O(cells)
classification step (see the D2 hot-path contract), a storage dtype
decision, or a cached packed tensor on an expression node has left the
design.
