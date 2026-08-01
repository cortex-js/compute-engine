# `At` on GLSL/WGSL — design

**Date:** 2026-08-01 · **Status:** revised after the dual-reviewer pass
(24 findings, dispositions in
`docs/scratch/2026-08-01-at-gpu-compile-design_SPEC_REVIEW.md`) and the
§3.F ruling; pre-implementation ·
**Ledger entry:** ROADMAP § Compile-target coverage, group A rank 1 (`At`
on glsl — 26 st, largest GPU gap). Sibling design (machinery + as-built
rules this reuses): `2026-07-31-pointlist-compile-design.md`.

**Terminology:** a base's *length* N is its element count; a gather's *K*
is its index-list length. The CE index contract is **1-based**; emitted
GLSL indices are 0-based.

## Problem

`At` has no GPU lowering — every form throws the generic "no lowering"
(probed). The census makes it the largest GPU-only gap (26 states); the
witness shape is `p_0[i]` — a **document list with a statically declared
length** indexed by a loop/instance variable inside a shader body. (A
runtime-length list has no GPU value at all and is out of scope
everywhere; what the consumer binds is declared-length data.)

**The contract, stated precisely** (probed; the two layers are distinct
and the repo pins the distinction —
`at-collection-index-compile.test.ts` header):

- **Interpreter:** 1-based; negative counts from the end; `0`/out-of-range
  yields the position-preserving absence marker (`NaN` for numeric
  elements, `Missing` otherwise); a **non-integer or non-numeric index
  leaves `At` unevaluated** (no value — NOT a marker); an integer-list
  index gathers (result length = K, out-of-range slots → marker); a
  boolean-list index masks (filter; length must equal N, else error).
- **Numeric-target projection:** `_SYS.at` projects "no value" and the
  numeric marker alike to `NaN`. The GPU lowering targets this
  *projection*, not raw interpreter output — parity tests must compare
  against the projected value.

**Stale premise, corrected:** the ledger assumed a dynamic index needs a
ternary/switch chain. GLSL ES 3.00 (the target emits `#version 300 es`)
permits dynamic indexing of vectors and arrays by any integer expression;
WGSL likewise permits runtime indexing of a value-typed `vecN`/array
parameter (WGSL spec § expression evaluation; out-of-bounds yields an
*indeterminate value* for value-typed access — "clamping" is the rule for
memory accesses only). Both languages' out-of-bounds behavior (GLSL: UB;
WGSL: indeterminate) is unreachable by design: an explicit bounds guard
decides first, which is also what preserves the NaN contract.

## Rulings

1. ~~Point-list bases in v1~~ — **superseded 2026-08-01.** `At(PL, k)`
   types `missing | tuple` (honest: a runtime OOB index yields `Missing`),
   and the §3.F object-domain-absence gate (`base-compiler.ts`, from
   `2026-07-22-missing-value-typing-design.md`) intercepts that type
   before any target function table — a GPU `At` entry is unreachable for
   the shape. **User ruling: defer point-list bases** (filed as
   blocked-on-§3.F in the ROADMAP residual; candidate resolutions —
   per-operator absence projection, or in-range type narrowing — need
   their own pass) **and instead admit any statically-declared-length
   numeric base**, which is what the census witness actually is.
2. **Gather tier** (approved 2026-08-01): literal integer gather folds at
   compile time; static-count *dynamic* gather declines, demand-gated
   (witness count requested from the consumer; the marginal cost is
   near-zero — the same helpers in a constructor — so the gate is cheap
   to flip); a **runtime-valued boolean mask declines permanently** — its
   result length is not static, no shader value shape exists, and the
   diagnostic must say so (not a TODO); unknown-length index list
   declines (the `Sin(L)` rule).
3. **Out-of-range → the target's NaN spelling** — `_gpu_nan()` on GLSL,
   the inline `bitcast<f32>(0x7fc00000u)` pattern on WGSL
   (`gpuNonFiniteLiteral`; there is **no** `_gpu_nan` on WGSL) — never
   clamp. Interpreter-projection parity.

## Design

### D1. Scalar index

New `GPU_FUNCTIONS.At` entry in `gpu-target.ts` (both languages; `target`
required — sibling as-built rule).

**Admissible bases** — one predicate, stated once and total: the base's
static element count (`BaseCompiler.aggregateComponentCount`-equivalent /
type-level count) is a known N ≥ 2 **and** every element is provably
scalar numeric. Concretely: declared `vector<N>` (any N ≥ 2),
parameterized `tuple<…>` of 2+ numeric slots, a literal `List` of 2+
provably-numeric elements. Everything else declines, **each with its own
discriminated reason** (109a): unknown-length `list<number>`; length 0
or 1 (no `vec1`, and the existing `assertGPUScalarComponents` treats 1/5+
as its own error class); bare unparameterized `'tuple'` (no arity — the
`compilePointSwizzle` precedent); non-numeric elements; a dictionary base
or string key; multi-index `At(m, i, j)`; a `Missing` base. Bases whose
elements are object-domain (`list<string>`) never reach the entry — the
§3.F gate pre-empts them with its own message; the discriminated-reason
obligation covers only shapes that survive it (stated, so nobody hunts
for a missing reason).

**Admissible indices:** provably numeric scalar, or `unknown`/`value`
(the compile model's unknown-as-numeric-parameter rule — the witness's
`i` may well type `unknown`; the load-bearing sibling precedent), or a
statically countable literal `List` (→ D2). An index typed
`Missing`/`T | missing` folds to the NaN spelling (the interpreter's
`missingStrip` result is the marker). Provably non-numeric (string,
boolean, non-literal collection-typed) declines with a reason naming the
type.

**Static fold (literal integer index, zero runtime cost):** resolved at
compile time against N — in-range positive → 0-based access: a component
swizzle for a vec-shaped base (`At(v3, 2)` → `v.y`, using the sibling's
atomic-emission rule: `gpuIsAtomicEmission(code) ? code.y : (code).y`),
a direct `base[j]` for an array-shaped base (constant, provably
in-range); in-range negative resolved from the end; a **literal base**
with a literal index constant-folds to the element's compiled literal
(`At([10,20,30], 2)` → `20.0` — not `vec3(…).y`); `0`, out-of-range, or
non-integer literal → the NaN spelling folded directly.

**Dynamic index — helpers.** For N ≤ 4, three static preamble helpers
`_gpu_at2/3/4`; for N > 4, a per-N helper `_gpu_atN` over `float[N]`
(same body shape), generated on demand. Guard entirely in float space —
the `int()` cast is undefined for |i| > 2³¹, so nothing may be cast
before the range test; the negated compound also swallows NaN and ±∞
without relying on `floor` alone:

```glsl
float _gpu_at3(vec3 v, float i) {
  // 1-based; negative counts from the end; anything else → NaN.
  // The guard runs entirely in float space: it rejects NaN, ±∞, huge
  // finite values, non-integers and 0 BEFORE the int cast (undefined
  // outside int range), and makes both languages' out-of-bounds rules
  // (GLSL UB / WGSL indeterminate) unreachable.
  if (!(i >= -3.0 && i <= 3.0) || i != floor(i) || i == 0.0)
    return _gpu_nan();
  int k = int(i);
  return v[(k > 0) ? k - 1 : 3 + k];
}
```

WGSL: `fn _gpu_at3(v: vec3f, i: f32) -> f32` with the inline NaN bitcast
(no `_gpu_nan` dependency on WGSL). Helper parameters bind base and index
**once** — evaluate-once holds for every single-reference emission.

**Preamble mechanism (there is no `GPU_HELPERS`):** the target has two
mechanisms — `GPU_COMPLEX_FUNCTIONS` (deps-resolved, complex only) and
ad-hoc `preambleFor` branches. The `_gpu_at*` helpers are `preambleFor`
branches, placed **after** the `_gpu_nan`/`_gpu_inf` branches, and the
`_gpu_at` branch **forces** the GLSL NaN helper (the scan reads emitted
code, never helper bodies — a compilation whose code contains only
`_gpu_at3(…)` must still get `_gpu_nan`). Per-N generation scans the
emitted code for `_gpu_at(\d+)`. Tests assert declaration **order**
(NaN helper precedes `_gpu_atN`), not just presence.

**Evaluate-once / effect order:** any emission that references the base
more than once (mixed gather constructors) requires the base `.isPure`;
if base **and** index are both impure, decline (GLSL does not specify
argument evaluation order, so two draws could commute). Single-reference
helper calls carry no such restriction.

### D2. Literal integer gather (ruling 2)

`At(base, [i₁…i_K])`, every index a literal integer, K = the literal
list's length:

- **K 2–4:** fold each slot as the D1 static fold. All slots in-range on
  a vec base → swizzle (`v.xz`, `v.zxz`; atomic-emission rule); any OOB
  slot or an array base → constructor `vecK(...)` with folded components
  (`vec2(v.x, <NaN spelling>)`); a literal base folds per element. Base
  referenced more than once → the D1 purity rule.
- **K = 0 or 1: decline**, each with its own reason. The interpreter/JS
  contract pins `At(L, [2])` → `[20]`, a 1-element **list** (pinned at
  `at-collection-index-compile.test.ts:59`), and no shader value has
  that shape (no `vec1`, no empty value) — honest fail-closed beats a
  scalar that contradicts a pinned contract.
- **K > 4: decline** — here the round-21 width ceiling genuinely binds
  (the *result* is a vecK).
- A literal list mixing non-integers (`[1, 1.5]`) or mixing integers with
  booleans declines with its own reason (not the "dynamic gather" text,
  which would be misleading).
- **Literal boolean mask** (all slots literal `True`/`False`): statically
  a gather — matching length folds through this tier (selected count = K,
  same K rules); statically mismatched length declines with the
  mask-length reason (the interpreter errors there). Only the
  **runtime-valued** mask is the permanent decline of ruling 2.

Composability: a gather result types `list<…>` without static dimension,
so composed uses gate exactly like the sibling's projections
(root-effective; the dimensioned-type follow-up covers both).

### D3. Deferred: point-list bases (§3.F)

Not in v1 — see ruling 1. The filing (ROADMAP residual + consumer item)
records the two candidate resolutions and that the blocker is the
type-driven absence gate, not the emission (which is straightforward once
a shape is sanctioned).

### D4. Dispositions

| shape | disposition | reason must convey |
| --- | --- | --- |
| runtime-valued boolean mask | **permanent** | result length depends on runtime truth values — no static value shape exists |
| unknown-length base or index list | **permanent** (`Sin(L)` rule) | no static count to emit against |
| static-count dynamic gather | demand-gated | witness requested; near-zero cost to flip |
| gather K > 4 | demand-gated | width ceiling (round-21) — the result is a vecK |
| gather K 0/1 | demand-gated | pinned 1-element-list contract has no shader shape |
| point-list base | **blocked on §3.F** | filed; needs an absence-projection or type-narrowing ruling |
| dictionary / string key / multi-index / length 0–1 / bare `tuple` / non-numeric elements or index | demand-gated v1 scope | each its own reason |

### D5. What does NOT change

- Interpreter and JS target (`_SYS.at`) untouched — the parity oracle
  (compare against the *projection*, per § Problem).
- `At`'s type handler untouched. For D1 shapes it answers a scalar
  numeric type, so `At(v, k) * 2` and `Sin(At(v, k))` compose through
  the GPU shape gates **today** — this composability claim is scoped to
  D1 (gathers are root-effective, see D2).
- No library-definition compile handler (so CSE G1b does not arise).

## Test plan

New file `test/compute-engine/at-gpu-compile.test.ts`; route-parity
spot-pins extend `test/compute-engine/at-collection-index-compile.test.ts`.

1. **Static folds** (glsl + wgsl spellings): `At(v3, 2)` → `v.y`;
   `At(v3, -1)` → `v.z`; `At(v3, 0)`/`At(v3, 5)`/`At(v3, 1.5)` → NaN
   spelling; literal base + literal index → the element literal (`20.0`);
   declared `vector<7>` + literal index → direct `v[j]`; swizzle
   parenthesization pinned via a non-atomic base emission.
2. **Dynamic index:** `At(v3, k)` → `_gpu_at3(v, _.k)`-shaped source;
   preamble contains the helper AND `_gpu_nan`, **in that order** (glsl);
   WGSL helper body pinned verbatim (inline bitcast, no `_gpu_nan`);
   `vec2`/`vec4` variants; `vector<7>` → generated `_gpu_at7` over
   `float[7]`; helper emitted once under repeated use; the float-space
   guard text pinned verbatim (runtime untestable in jest — the emitted
   guard is the artifact).
3. **Composability (D1 only):** `At(v3, k) * 2`, `Sin(At(v3, k))`
   compile on glsl — pinned with a comment contrasting the gather/
   projection gates.
4. **Evaluate-once, structurally:** base and index source each appear
   exactly once in the D1 emission; a mixed-OOB gather over an impure
   base declines; impure base + impure index declines.
5. **Gather:** `v.xz`, `v.zxz`; OOB slot constructor with the NaN
   spelling; K=1, K=0, K=5 decline with distinct reasons; dynamic gather
   `At(v3, [k, k+1])` declines with the demand-gated reason; mixed
   `[1, 1.5]` declines; literal mask `[T,F,T]` folds to `v.xz`;
   mismatched-length literal mask declines.
6. **Mask:** `At(v3, [Greater(x,0), True, False])` declines; assert the
   reason text conveys permanence (runtime-dependent length).
7. **Discriminated declines:** unknown-length base; unknown-length index
   symbol; dictionary base; string key; multi-index; `vector<1>`; literal
   boolean-element base; bare-`tuple` base; `Missing` base — each its own
   reason, no shared regex.
8. **Index typing:** `unknown`-typed index compiles (numeric-parameter
   rule); declared `string`-typed index declines naming the type;
   `Missing`-typed index folds to the NaN spelling.
9. **Route parity (projection):** for the D1/D2 shapes, js `_SYS.at`
   still compiles unchanged and agrees with the GPU *fold results* at
   literal inputs (e.g. the constant-folded `20.0` equals
   `_SYS.at([10,20,30], 2)`); non-integer index parity is against the
   NaN projection, not the unevaluated interpreter form.

## As-built notes (implementation, 2026-08-01)

Four deviations (reported, not silently redesigned) and two observations:

- **`markAggregateConsuming` on the `At` entry** (machinery addition):
  without it `gpuCheckOperandShapes` declines legitimate emissions (a
  `vector<7>` base's NaN fold is a non-atomic compound over an
  `array`-shaped operand). `At` indexes into its aggregate, so the operand
  shape is genuinely consumed — the `Max`/`Min` precedent's declared
  capability (`GPU_AGGREGATE_CONSUMING`).
- **The NaN forcing lives in the NaN branch's condition** (driven by an
  `_gpu_at` width scan hoisted above it) — the only way to satisfy both
  "the `_gpu_at` branch sits after the NaN branches" and "forces the GLSL
  NaN helper", since the scan reads emitted code, not helper bodies.
  Declaration order `_gpu_nan` → `_gpu_atN` is the pinned tripwire.
- **A `T | missing` index does NOT statically fold to NaN** — only a
  wholly-`missing` type does. An inhabited `number | missing` index can
  carry a number at run time; its absence-axis runtime value is NaN,
  which the helper guard already returns, so the readings agree
  operationally and the fold stays sound for the inhabited case.
- **Two declines beyond the spec's enumeration**, both fail-closed guards
  against invalid source: a complex index (lowers to `vec2` — a shader
  type error as a helper argument), and an **impure literal base in any
  folding path** (the fold discards sibling elements unevaluated — the
  discarded-component precedent; this is what makes the impure-gather
  test reachable).
- Observation: the "literal boolean-element base" decline is unreachable
  as an `At`-owned reason — the node types `boolean | missing` and §3.F
  intercepts first (as the spec states for `list<string>`); the test pins
  the §3.F message, and a complex element exercises the `At`-owned
  non-scalar-element reason instead.
- Observation (latent, out of scope, worth its own look):
  `BaseCompiler.isComplexValued` answers `true` for a literal `List`
  containing a complex element, which makes `aggregateComponentCount`
  answer 2 for a 4-element list; worked around locally by asking the
  complex question only of non-literal bases.

Staged-review round (Claude Opus + Codex; findings + dispositions in the
session record — 11 in-scope, 4 high, all applied; the dynamic-gather
re-open was refuted as a ratified ruling):

- **Type-based element checks now use `gpuIsVectorComponentType`**, not
  `isSubtype(t, 'number')` — `complex ⊆ number` but lowers as `vec2`, so
  `tuple<complex,…>` bases emitted invalid source behind `success: true`.
  Reason wording: "not a REAL scalar" (complex IS a number). Behavior
  delta that rode along: `tuple<unknown, unknown>` bases are now admitted
  (the predicate treats `unknown`/`any` as a shader float — the target's
  own convention for spelling the base's `vecN`); the literal-list branch
  deliberately keeps `isSubtype('number')`.
- **The frame routes work now** (`gpuAtFramedBaseElements` /
  `gpuAtFramedIndex`): a `compileShader({inputs})` / `compileFunction`
  base or index types `unknown` at the boxed level and is validated
  against the GPU declaration frame instead — the consumer's actual
  route, previously fail-closed for bases and **fail-open for
  `bool`/`i32` indices** (emitted a shader type error). Declared int
  indices wrap `float(...)`/`f32(...)`; declared bool/aggregate/typeless
  spellings decline naming the type.
- **No fold may discard an impure operand**: the OOB/non-integer-literal
  and wholly-`Missing`-index folds, and the zero-reference all-OOB
  gather, now require the omitted base pure (`requirePureFold`) — a
  dropped `Random()` draw would silently shift the shader's stream.
  Conversely `gpuAtIsSwizzleGather` is shared by the emitter and the
  purity guard, so an all-in-range gather over an impure base compiles
  (one reference — the guard previously counted slots, not references).
- **Unknown extent encodes as −1** (`list<number^?>` → `dimensions:[-1]`)
  — now hits the unknown-length decline instead of generating
  `_gpu_at-1(`.
- **The per-N scan is call-site-anchored** (`/(?<![\w$])_gpu_at(\d+)\s*\(/g`)
  — a user symbol named `_gpu_at5` no longer triggers a colliding
  generated definition.
- **WGSL N>4 helper copies its array parameter to a local `var`** before
  indexing — WGSL's historical restriction on dynamic indexing of array
  *values* is moot regardless of Tint/naga behavior.
- The multi-axis base branch is **unreachable** (probed: a
  `list<number^2x3>` base makes `At` answer a collection element, which
  §3.F always intercepts) — guard retained with a comment; no pin.
  `tuple<number, string>`, by contrast, is NOT pre-empted and pins the
  `At`-owned slot reason.
- Test-harness hardening: `glslFold` throws on unrecognized source (the
  NaN-parity assertions previously passed for arbitrary emissions).

## Landing notes

- Snapshot blast radius expected 0 (new GPU entry + preamble branches);
  verify with the full suite before staging.
- Docs: CHANGELOG under `## [Unreleased]`; ROADMAP — split the `At` row
  (closed: statically-shaped bases, scalar + literal-gather tiers;
  residual: D4's demand-gated tiers + the §3.F-blocked point-list base),
  **no retirement of the 26-state count without the consumer re-measure**
  (sibling discipline); consumer note in
  `~/dev/tycho/docs/COMPUTE_ENGINE.md` § Open Requests (the item-122
  pattern lives there, not in this repo): new CE-initiated item — the
  landing, the census re-measure ask, the dynamic-gather witness ask, and
  a note that driver-side shader validation is the consumer-side landing
  check jest cannot provide.
- Helper-mechanism drift: the `_gpu_at*` branches must stay after the
  NaN branches in `preambleFor` — the order test is the tripwire.
