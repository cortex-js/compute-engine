# Implementation plan: `interval-glsl` compilation target

**Status:** scoping / design (no code yet). Response to Related ask **C** in
`TYCHO_ISSUE.md` (Graph Paper / Tycho).

**Goal:** a GPU compilation target that performs **interval arithmetic** in a
GLSL fragment shader, so Tycho's implicit-curve renderer can run its robust
interval evaluation on the GPU instead of CPU-side via `interval-js`. For each
screen cell (a box in domain space) the shader evaluates `f` over the box's
interval and decides whether the curve can pass through it (`lo ≤ 0 ≤ hi`).

**Feasibility verdict: feasible, medium effort.** It is essentially the **cross
product of two subsystems that already exist** in the codebase:

- the **interval semantics** of the `interval-js` target
  (`src/compute-engine/interval/*` +
  `compilation/interval-javascript-target.ts`): the `_IA.*` operation set and
  the "operators route through functions, never native `+`" dispatch model; and
- the **GPU codegen** of `GPUShaderTarget` (`compilation/gpu-target.ts`), which
  `GLSLTarget`/`WGSLTarget` already extend: per-language function tables, the
  `code.includes('_gpu_x') → append GLSL preamble` mechanism, the `vars` uniform
  hook, and shader assembly (`compileShader`/`compileFunction`).

The new target is "interval semantics expressed in GLSL preamble functions." No
new compiler architecture is required.

---

## 1. The two foundations (what we reuse)

### interval-js (`compilation/interval-javascript-target.ts`)

- Operators map to **function calls**, not infix operators:
  `INTERVAL_JAVASCRIPT_OPERATORS` maps `Add → ['_IA.add', …]`, etc., and the
  target sets `operators: () => undefined` so arithmetic _cannot_ fall through
  to native `+` (which would be wrong for intervals). The `interval-glsl` target
  must do the same: every arithmetic op becomes an `_iv_*` GLSL function call.
- Runtime representation (`interval/types.ts`):
  - `Interval = { lo: number; hi: number }` (closed, `lo ≤ hi`).
  - `IntervalResult` is a **tagged union**:
    `interval | empty | entire | singular{at,continuity} | partial{value,domainClipped}`
    — rich tags that track discontinuities and domain clipping for CPU plotting.
- Operation surface to port (counts from the source): `arithmetic.ts` (6:
  add/sub/mul/div/negate), `elementary.ts` (32:
  sqrt/square/exp/ln/log/pow/abs/sign/floor/ceil/round/heaviside/…),
  `trigonometric.ts` (28: sin/cos/tan/cot/sec/csc + inverses + hyperbolics),
  `comparison.ts` (three-valued `BoolInterval`).

### GPUShaderTarget (`compilation/gpu-target.ts`)

- `abstract` base; subclasses provide `languageId`,
  `getLanguageSpecificFunctions()`, `compileFunction()`, `compileShader()`.
- `getFunctions()` = `{ ...GPU_FUNCTIONS, ...languageSpecific }`;
  `getOperators()` = `GPU_OPERATORS` (native infix — we will **override to
  none**).
- Preamble injection: after codegen, `compile()` appends a GLSL helper block for
  each `code.includes('_gpu_erf')`-style marker. This is exactly the hook we use
  to inject the interval-arithmetic GLSL library on demand.
- `var` hook already resolves `vars` mappings → uniforms, constants, else
  `undefined` (folded). The interval-glsl `var` wraps a scalar input as a
  **point interval** `vec2(x, x)` (the GPU analogue of interval-js's
  `_IA.point(x)` / `number: (n) => '_IA.point(n)'`).
- Registered in `engine-compilation-targets.ts → registerDefaults()` alongside
  `glsl`, `wgsl`, `interval-js`.

---

## 2. Key design decision: GPU value representation

GLSL ES 3.00 (`#version 300 es`, the existing target's version) has **no `inf`
or `NaN` literals** — the codebase already relies on this (the 0.60.0 fix throws
on non-finite GPU literals). So we **cannot** port `IntervalResult`'s tagged
union verbatim (it leans on JS `Infinity`/`NaN` and object tags).

Three options, recommended first:

1. **`vec2` = `(lo, hi)` with a finite ±∞ proxy (recommended).** Use a large
   sentinel `IV_INF = 1e30` for unbounded ends; "entire / indeterminate" is
   `vec2(-IV_INF, IV_INF)`; domain violations (e.g. `sqrt` of a negative
   interval) widen toward entire. This is the minimum that supports the
   renderer's actual question ("can `f` be zero in this cell?" → `lo ≤ 0 ≤ hi`)
   and is the lightest to implement. It drops the fine-grained `singular` /
   `partial` / `domainClipped` tags — acceptable for a conservative
   (over-approximating) renderer, which is the safe direction (never misses the
   curve; may over-draw a cell).
2. **`vec4` = `(lo, hi, flag, aux)`** carrying a status flag (0 interval / 1
   empty / 2 entire / 3 singular). Higher fidelity, threads a flag through every
   op (more shader cost + complexity). Defer unless the renderer needs the tags.
3. NaN-sentinel encoding — **rejected**: no NaN literal in GLSL ES.

Tycho reports they already have a "degenerate-interval representation validated
CPU-side"; **Phase 0 below pins the representation to theirs** so the GPU and
CPU paths agree bit-for-bit on the contract. Recommendation: `vec2` + finite
proxy unless their representation requires the flag.

> **RESOLVED in §9 (Phase 0 closed).** `vec2 (lo, hi)` with `lo > hi` = `empty`,
> propagated **exactly** (branchless), and a **finite** `IV_INF = 1e18` with a
> per-op output clamp. Note the "widen domain violations toward entire" line
> below is superseded — `empty` must stay distinguishable (see §8 Q1 / §9).

---

## 3. Target architecture

New file `compilation/interval-glsl-target.ts`, class
`IntervalGLSLTarget extends GPUShaderTarget` with
`languageId = 'interval-glsl'`:

- `getOperators()` → `{}` (or override `createTarget().operators` to
  `() => undefined`), mirroring interval-js so no native infix leaks in.
- `getLanguageSpecificFunctions()` → an `INTERVAL_GLSL_FUNCTIONS` table mapping
  every supported head to an `_iv_*` call, e.g.
  `Add → (args,c) => reduce '_iv_add'`, `Sin → '_iv_sin'`, `Divide → '_iv_div'`,
  mirroring `INTERVAL_JAVASCRIPT_FUNCTIONS` one-to-one.
- `createTarget()` overrides:
  - `number: (n) => 'vec2(n, n)'` (point interval; the analogue of `_IA.point`).
  - `var`: `vars`-mapped → uniform (the value is expected to itself be a `vec2`
    interval or a scalar promoted to a point); constants (`Pi → vec2(PI, PI)`);
    else fold / free.
  - `complex` → unsupported (intervals are real-only; throw, like other
    GPU-unsupported constructs).
- Preamble: an `INTERVAL_GLSL_PREAMBLE` library of `_iv_*` GLSL functions,
  injected by `code.includes('_iv_')` (one combined block, or per-marker like
  the existing `_gpu_*` blocks to keep shaders small).
- `compileShader`/`compileFunction`: reuse the GLSL structure from `GLSLTarget`
  (they can likely share a helper; `IntervalGLSLTarget` may even subclass
  `GLSLTarget` to inherit shader assembly and only swap the function/operator
  tables + number/var hooks).
- Reference analysis (`freeSymbols` / `unsupported`, just added for ask B) comes
  **for free** via `BaseCompiler.withReferences` once wired into `compile()`.

---

## 4. The hard parts (where the effort and risk are)

1. **Control flow → branchless GLSL.** interval-js leans on JS `if`/object
   returns. GLSL wants branchless `min`/`max`/`step`/`mix`. Each op must be a
   pure `vec2 _iv_op(vec2 …)`:
   - `add`: `a + b` (componentwise).
   - `sub`: `vec2(a.x - b.y, a.y - b.x)`.
   - `mul`: `vec2(min4, max4)` over the four endpoint products — branchless via
     nested `min`/`max`.
   - `div`: must detect the denominator spanning 0 (`b.x ≤ 0 ≤ b.y`) → result is
     entire; branchless via `step`/`mix`. **Main correctness risk.**
2. **Monotonic vs non-monotonic elementary functions.** Monotonic (`exp`, `ln`
   on `x>0`, `sqrt` on `x≥0`, odd powers): apply to endpoints. Non-monotonic
   (`square`, `abs`, even powers): must include the extremum at 0.
3. **Trig range reduction.** `sin`/`cos` over an interval require detecting
   which critical points (`π/2 + kπ`) the interval covers to know if the range
   hits ±1. Branchless range reduction in `float32` is the **hardest**
   sub-problem and the least precise on GPU. Likely the last functions
   delivered; `tan` (poles) similarly hard. Mitigation: ship arithmetic +
   monotonic elementary first; gate trig behind a later milestone.
4. **`float32` precision.** Shaders are single-precision; interval bounds should
   be **outward-rounded** to stay conservative. True outward rounding is not
   available in GLSL ES, so widen by a small epsilon (`±ulp`) after each op.
   This keeps the renderer sound (no missed crossings) at the cost of slightly
   fatter intervals. (Cross-reference: the macOS WebGL2 fast-math note in
   project memory — do **not** rely on any error-term cancellation tricks; pure
   widening only.)
5. **No dynamic arrays / `Sum`/`Product` with symbolic bounds, comprehension
   `Loop`** — already unsupported on GPU (`BaseCompiler` throws for GLSL). The
   `unsupported` field (ask B) now reports these declaratively.

---

## 5. Phased delivery

- **Phase 0 — pin the contract (½ day). ✅ DONE (§8 + §9).** Decided: Option A
  (GPU = exclusion oracle, CPU keeps extraction); `vec2 (lo, hi)`, `lo > hi` =
  `empty` propagated branchlessly; finite `IV_INF = 1e18` + per-op clamp;
  exclusion predicate `lo > 0 || hi < 0` (covers `empty` for free).
- **Phase 1 — skeleton + arithmetic. ✅ DONE (§11).** `IntervalGLSLTarget`
  (subclassing `GLSLTarget`), operators→none, `number`/`var` hooks,
  `_iv_add/sub/mul/div/negate/square/powi` preamble, registration, `vars`
  uniform path. Soundness tests (interval contains true range) for
  polynomials/rationals; the "no spurious `empty` on a valid input" invariant
  (§10) asserted. Higher integer powers (`x^n`) and `Square` are included
  (polynomials need them).
- **Phase 2 — elementary functions. ✅ DONE (§12).** `Abs`, `Sqrt`, `Exp`,
  `Ln`/`Log`/`Lb`, positive rational `Power` (`_iv_powf`) on top of the Phase-1
  integer powers. Domain violations (`sqrt`/`ln`/rational-`pow` of a negative
  argument) → `empty`, matched to `interval-js`. Corpus parity harness added.
- **Phase 3 — trig / inverse-trig. ✅ DONE (§12).** `Sin`, `Cos`, `Tan`,
  `Arcsin`, `Arccos`, `Arctan` with interval range reduction, **mined from the
  dropped 0.52-era implementation** (`b541210b^`) and adapted to the vec2 /
  Option-A contract (poles → `entire`, no status-flag struct). Hyperbolic /
  reciprocal-trig heads remain `unsupported` (CPU fallback).
- **Phase 4 — end-to-end shader. ✅ CE side DONE (§14).**
  `IntervalGLSLTarget.compileExclusionShader(expr)` emits the full fragment
  shader. **Remaining (Tycho side):** validate on the WebGL2 renderer and
  benchmark vs the CPU `interval-js` path.

**Estimate: ~1.5–2.5 weeks** for Phases 0–2 (the high-value core: arithmetic +
algebraic functions, which covers polynomial/rational implicit curves) plus trig
as a follow-on. Phases 0–2 alone unblock a large class of implicit plots.

---

## 6. Testing strategy

- **Parity harness vs `interval-js`:** compile the same expression to both
  targets; for a grid of input boxes, the GLSL result (run via a headless WebGL2
  context or a CPU re-implementation of the `_iv_*` preamble) must **contain**
  the interval-js result (conservative over-approximation is OK;
  under-approximation is a bug — it could miss a curve crossing).
- **Soundness property test:** for random boxes and the exact range computed at
  high precision, assert `iv.lo ≤ trueMin` and `iv.hi ≥ trueMax` (outward).
- Reuse the existing `compile-glsl.test.ts` structure for codegen snapshots
  (`_iv_add(x, vec2(1.0,1.0))` etc.) and `compile-interval-js.test.ts` for the
  numeric oracle.

---

## 7. Open questions for Tycho (Phase 0)

1. Exact GPU representation — confirm `vec2 (lo, hi)` + `IV_INF = 1e30`, or do
   you need a status flag (`vec4`)?
2. Which functions does the implicit renderer actually use? (If it's
   polynomial/rational only, Phase 3 trig may be unnecessary.)
3. WGSL too, or GLSL only for now? (The same design extends to an
   `interval-wgsl` target via the shared base; scope permitting.)

---

## 8. Tycho response (Phase 0) — 2026-06-16

Thanks — the plan is solid and the "cross-product of two existing subsystems"
framing matches how we see it. The soundness stance (over-approximate OK,
under-approximate is the bug; `±ulp` outward widening; no fast-math cancellation
tricks) is exactly right and lines up with our macOS WebGL2 fast-math caveat.
Answers below; the representation question (Q1) has a wrinkle worth pinning.

### Q1 — GPU value representation: `vec2` is enough **only if** the GPU does cell-culling and the CPU keeps curve extraction

Our interval representation is the tagged union in
`src/plot-core/shared-types.ts` (mirrors CE's):
`interval | empty | entire | singular{at,continuity} | partial{value,domainClipped}`.
The important thing for you: **our implicit renderer consumes more than
`lo ≤ 0 ≤ hi`.** Concretely:

- `canExcludeByInterval` (`adaptive/implicit-oracle.ts`) **excludes a box on
  `empty`** (domain-undefined → no curve). The plan's "widen domain violations
  toward entire" silently drops this, so restricted-domain curves (`sqrt`, `ln`,
  `asin`, and rational powers like the astroid `x^(2/3)`) would stop being
  culled in their undefined regions.
- `adaptive/polyline-extractor.ts` (≈L441–494) uses `singular` + `continuity`
  (`'left'|'right'`) and `partial` + `domainClipped` to classify **asymptote vs.
  continuous breaks** and pick the closed side — this is our pole/discontinuity
  handling (`tan`, `1/x`-type implicit curves). Lose it → spurious connectors
  drawn across asymptotes.
- `adaptive/refinement-scheduler.ts` (L112) branches on `singular`.

So the answer depends on a division-of-labor decision the plan should pin in
Phase 0 — **what is interval-glsl responsible for?**

- **Option A (our recommendation): GPU does exclusion-culling only; the CPU
  keeps curve extraction + break classification.** This matches your "decides
  whether the curve can pass through it" framing, is the lightest/lowest-risk,
  and lets `vec2(lo, hi)` work. We keep full discontinuity quality from a CPU
  `interval-js` pass on the (few) cells the GPU flags as live. We lose nothing
  on curve quality; the only cost is that break-classification still runs
  CPU-side, which is fine.
  - **One thing we'd want even in Option A: keep `empty` distinguishable**, so
    restricted-domain culling survives. The cheapest way that needs no extra
    component: **encode `empty` as an inverted interval**
    `vec2(+IV_INF, -IV_INF)` (i.e. `lo > hi`, otherwise impossible). Bonus: our
    existing exclusion test `lo > 0 || hi < 0` already excludes it with zero
    special-casing (`lo = +IV_INF > 0` → excluded). If propagating `empty`
    branchlessly through the op chain is too costly, widening `empty → entire`
    is an acceptable fallback **for us** (it's a perf cost only — extra
    subdivision in undefined regions — and perf isn't our constraint). Your call
    on the cost trade; we'd prefer the inverted-interval encoding if it's cheap.
- **Option B: GPU result feeds our break classification (replaces `interval-js`
  wholesale).** Then `vec2` is insufficient and we'd need your option-2
  `vec4(lo, hi, flag, aux)` carrying at least
  `{interval, empty, entire, singular}`, with `aux` ideally encoding the
  continuity hint (sign = left/right) and `domainClipped`. Higher cost on both
  sides; we'd rather **not** do this for v1.

**Recommendation: Option A, `vec2` + `IV_INF`, with the `lo > hi` = empty
encoding.** Defer `vec4`/flags unless/until we move break classification onto
the GPU result. (Re `IV_INF = 1e30`: fine for the exclusion test; just ensure no
op _squares_ a sentinel into `float32` `inf` — `1e30² = inf` — i.e.
outward-widen should clamp at the sentinel rather than overflow.)

### Q2 — which functions: not polynomial/rational only; trig is real but can phase later

Implicit equations are arbitrary user math, so the set is open-ended. What we
actually ship / users author, by frequency:

- **Polynomial / rational** (most common): conics, lemniscates, astroid
  `(x²+y²−1)³+27x²y²`.
- **`abs` + integer/rational powers**: superellipse `|x|ⁿ+|y|ⁿ=1`, astroid
  `x^(2/3)+y^(2/3)=1`. Note rational powers with even denominators carry domain
  restrictions (`x^(2/3)` for `x<0`) — that's where Phase 2's domain-widening
  (and the `empty` encoding above) earns its keep.
- **Trig: yes, shipping** — e.g. our showcase's
  `sin(6x) + cos(7y) + 0.35·sin(4(x+y)) = 0`. So Phase 3 is **wanted, not
  unnecessary** — please keep it on the roadmap.

But the **phasing is right**: Phases 0–2 (arithmetic + `sqrt`/`square`/`abs`/
integer+rational `pow` + `exp`/`ln`) unblock the largest class of implicit
curves immediately, and trig curves keep working on our existing CPU
`interval-js` path until Phase 3 lands — so shipping 0–2 first **regresses
nothing**. Our priority within Phase 2: `abs`, integer + rational `pow`, `sqrt`,
`square`. The declarative `unsupported` field (ask B) is what makes the
per-function CPU fallback automatic — a curve using a not-yet-ported head just
routes to `interval-js` without a trial-compile.

### Q3 — GLSL only for now

Our 2D/implicit render path is **WebGL2/GLSL end-to-end**
(`plot/webgl/ glsl-renderer.ts`); nothing on the implicit path consumes WGSL
today. We do have nascent WebGPU infrastructure (`core/shared/webgpu-device.ts`)
and an emerging WGSL surface path in plot-3d, but it's not wired to 2D implicit.
So: **build `interval-glsl`; keep the shared base so `interval-wgsl` is cheap to
add later** if our WebGPU path matures — but no need to spend effort on WGSL
now.

### Misc. notes on the plan

- **`div` spanning zero → entire**: agreed, and it dovetails with Option A —
  that cell won't be excluded, we subdivide, and the CPU break-classifier turns
  the pole into a proper asymptote break. Just ensure the zero-spanning `div`
  yields a _wide_ result (entire), never a narrow one — a narrow result there
  would under-approximate and could miss a crossing.
- **Parity harness** ("GLSL result must _contain_ the `interval-js` result") is
  exactly our soundness requirement. Happy to contribute our implicit test
  corpus as parity fixtures: conics, the astroid, the superellipse family, and
  the trig showcase curve above.

**Net:** Option A + `vec2` (with `lo > hi` = empty) gets us a robust GPU
exclusion oracle for polynomial/rational/algebraic implicit curves with no
curve-quality regression, at minimal cross-team surface. That's the cut we'd
take first.

---

## 9. CE response (Phase 0 closed) — 2026-06-16

Agreeing with Option A across the board — it tightens scope and removes the
riskiest fidelity work. Two of your points (the `empty` encoding and `IV_INF`)
have concrete implementation answers; recording them so Phase 0 is settled.

### Decision: Option A — GPU exclusion oracle, CPU keeps extraction

Confirmed. `interval-glsl` computes the per-cell interval of `f` and nothing
else. `singular` / `partial` / `continuity` / `domainClipped`, the
`BoolInterval` three-valued logic, and `comparison.ts` **stay out of the GLSL
target entirely** — CPU `interval-js` keeps owning break classification on the
(few) cells the GPU flags live. That's a real scope cut vs. §1: the GLSL surface
is arithmetic + elementary functions only.

**Output contract per cell:** the final `f` interval as `vec2`. Your existing
`canExcludeByInterval` predicate `lo > 0 || hi < 0` then excludes both
"definitely non-zero" and `empty` with no special-casing
(`empty.lo = +IV_INF > 0`). Nice property — we'll treat that predicate as the
contract and parity-test against it.

### `empty`: adopt `lo > hi`, and propagate it **exactly** (still `vec2`)

Adopting `IV_EMPTY = vec2(+IV_INF, -IV_INF)`. But we can beat "degrade
`empty → entire` under nonlinear ops" — propagate it exactly and stay in `vec2`,
for a couple of ALU ops per call. Each `_iv_*` op computes its normal result,
then forces empty if any input is empty:

```glsl
bool iv_empty(vec2 a) { return a.x > a.y; }
// tail of every op (binary shown; unary uses one input):
res = (iv_empty(a) || iv_empty(b)) ? IV_EMPTY : r;
```

This keeps restricted-domain culling exact through the **whole** expression —
e.g. `x · sqrt(x)` for `x < 0` stays `empty`, which the inverted-interval
encoding _alone_ loses under `mul` (the four-product min/max un-inverts it back
to entire). Cost is ~2 compares + a select per op, negligible next to the
elementary functions. So you get your stated preference ("exact if it's cheap" —
it is); the `empty → entire` degrade you sanctioned remains the drop-in fallback
(same code minus the guard) if profiling ever disagrees.

Domain violations generate `empty` at the source op, clamping the
partially-valid case (correct for _exclusion_ — the valid sub-range is what can
host the curve; the clipped part is a CPU-extraction concern you keep):

- `sqrt(a)`: `a.y < 0` → `empty`; else `[sqrt(max(a.x, 0)), sqrt(a.y)]`.
- `ln`, `asin`/`acos`, even-denominator rational `pow`: same shape
  (fully-outside-domain → `empty`; straddling → clamp to the valid
  sub-interval).

Exact per-function semantics will be **parity-locked to interval-js's
`sqrt`/`pow`/`powInterval`/`square`** so the GPU and CPU domains agree
bit-for-bit (that's the soundness harness in §6, not guesswork).

### `IV_INF`: finite sentinel + per-op output clamp (your overflow point)

Two rules kill the `1e30² = inf` trap:

1. **Every op clamps its output to `[-IV_INF, IV_INF]`**, so a sentinel never
   grows across ops. `clamp` also turns any overflowed intermediate back into
   the sentinel (`min(inf, IV_INF) = IV_INF`) and preserves `IV_EMPTY` (both
   components already sit at the sentinels).
2. **Pick `IV_INF` small enough that one op's worst intermediate stays below
   `FLT_MAX` (≈3.4e38).** The binding case is `mul`/`square` (`IV_INF²`), so
   `IV_INF = 1e18` (`1e36 ≪ FLT_MAX`), **not** `1e30` (`1e60 → inf`).

Keeping the sentinel **finite** is also what avoids the NaN trap:
`0 · 1e18 = 0`, whereas `0 · inf = NaN` and `clamp(NaN, …)` is unspecified in
GLSL ES. So: finite `IV_INF = 1e18`, clamp every op output, never materialize a
real `inf`.

### Q2 — function priority accepted

Reordering Phase 2 to your priority: **`abs`, integer + rational `pow`, `sqrt`,
`square` first** (these + arithmetic cover conics, the astroid, the
superellipse), then `exp`/`ln`/`log`. Trig stays Phase 3 and is **kept on the
roadmap** (your `sin(6x) + cos(7y) + …` showcase). Until it lands, trig curves
keep running on CPU `interval-js`, routed automatically by the `unsupported`
field (ask B) — a curve with a not-yet-ported head falls back per-function with
no trial-compile and no regression. Rational-power domain restrictions are
handled by the `empty` path above.

### Q3 — GLSL only, base stays shared

Building `interval-glsl` only. The `GPUShaderTarget` base stays the seam so an
`interval-wgsl` is a thin add if/when your WebGPU 2D path matures — no WGSL
effort spent now.

### `div` spanning zero, and the test corpus

- `div` with the denominator spanning 0 → `entire` (wide, never narrow), as you
  note; with Option A that cell isn't excluded, gets subdivided, and your CPU
  break-classifier turns the pole into an asymptote break. Agreed.
- Yes please to the implicit corpus (conics, astroid, superellipse family, trig
  showcase) as parity fixtures — that's exactly the soundness oracle in §6 (GLSL
  result must _contain_ the interval-js result over a box grid).

### Updated scope

Option A + `vec2` (`lo > hi` = `empty`, propagated branchlessly) + finite
`IV_INF = 1e18` with per-op clamp. No tagged union, no comparison ops, no curve
classification on the GPU side — the GLSL target is strictly an interval
evaluator over arithmetic + elementary functions. Phases 0–2 keep their shape
but are lighter than originally scoped; the ~1.5–2.5-week estimate for 0–2
holds, with trig (Phase 3) as the wanted follow-on. Phase 0 is closed; Phase 1
can start against this contract.

---

## 10. Tycho ack (Phase 0 sign-off) — 2026-06-16

Signed off on the §9 contract: Option A (GPU = exclusion oracle, CPU keeps
extraction); `vec2 (lo, hi)` with `lo > hi` = `empty` propagated branchlessly
per-op; finite `IV_INF = 1e18` + per-op output clamp; exclusion predicate
`lo > 0 || hi < 0`. The empty-survives-`mul` guard and the `1e18` sentinel both
land where we'd want them — nothing further to resolve on the representation.
The catch that the inverted encoding alone un-inverts under `mul` is a good one;
your per-op `iv_empty` guard is the right fix.

**One note for Phase 1**, since the encoding now makes `lo > hi` semantically
load-bearing (empty → exclude): the **one unsound direction is a spurious
`empty` on a valid input** (false exclude → missed crossing). The §6 parity
harness already covers it _iff_ "contain" is evaluated with `empty = ∅` — i.e.
**a GPU-`empty` cell must imply an `interval-js`-`empty` cell.** GPU-`empty`
where the CPU interval is non-empty is a containment violation, not a benign
over-approximation. Worth an explicit assertion in the harness (it's the failure
mode the whole encoding now rides on).

**Parity fixtures: in progress.** We're assembling the implicit corpus — conics,
the astroid, the superellipse family, the trig showcase curve, plus targeted
cases that stress the new machinery: restricted-domain (`empty`:
`sqrt`/`ln`/`asin`/even-denominator rational `pow`), pole (`entire`:
`div`-spanning-zero), and product-heavy (the four-product `mul`). Each entry is
verified to compile on our CPU `interval-js` path and tagged by delivery phase
so you can run each subset as the matching functions land. Handoff shortly.

---

## 11. CE — Phase 1 landed — 2026-06-16

`interval-glsl` Phase 1 is implemented and registered:
`src/compute-engine/compilation/interval-glsl-target.ts`
(`IntervalGLSLTarget extends GLSLTarget`), wired into
`engine-compilation-targets.ts` and exported from the `/compile` entry. Tests:
`test/compute-engine/compile-interval-glsl.test.ts`.

**Scope shipped:** `Add`, `Subtract`, `Multiply`, `Divide`, `Negate`, `Square`,
and `Power` with non-negative integer exponents (covers polynomials / rationals
— conics, lemniscate, cubics). Numbers → point intervals `vec2(n, n)`; constants
→ point intervals; assigned values fold to point intervals; free symbols → bare
`vec2` uniforms (the cell box). `_iv_*` preamble injected on use.

**Contract as built (matches §9):** finite `IV_INF = 1e18`; `IV_EMPTY =
vec2(IV_INF, -IV_INF)`; per-op `_iv_clamp` to `[-IV_INF, IV_INF]`; exact
empty-propagation via per-op `_iv_guard1/2`; `div` with zero-spanning denominator
→ `IV_ENTIRE` (wide). `x²` uses a dedicated `_iv_square` (tight; avoids the
`mul(x, x)` dependency blow-up), and `xⁿ` a sign-correct `_iv_powi` (GLSL `pow`
rejects negative bases).

**On your §10 invariant (spurious-`empty` = the unsound direction):** agreed and
encoded. Every Phase-1 op is a total function, so the harness asserts a valid box
**never** yields `empty` (`lo > hi`) — which is exactly "no false exclude." (My
containment check already implies it: an `empty` result has `lo = IV_INF`, which
fails `lo ≤ trueMin`; the explicit non-`empty` assertion is in alongside it.)
When Phase 2 lands the domain-restricted ops (`sqrt`/`ln`/`asin`/rational `pow`)
— where `empty` legitimately arises — the parity harness gains the precise
**GPU-`empty` ⟹ `interval-js`-`empty`** assertion against your corpus, since
that's where a spurious `empty` first becomes possible.

**Soundness check today:** a faithful JS port of the `_iv_*` preamble executes
the generated code and asserts the interval **contains** a densely-sampled true
range over a grid of boxes (circle, lemniscate, cubic), plus `div`-spanning-zero
→ entire. A WebGL2-executed parity pass against your corpus will replace the JS
port once fixtures land — sending those whenever ready unblocks Phase 2.

---

## 12. CE — Phases 2 & 3 landed; prior implementation mined — 2026-06-16

**Corpus received** (`interval-glsl-parity-corpus.json`, 25 entries) and wired
into a parity harness (`test/compute-engine/compile-interval-glsl-parity.test.ts`):
each entry compiles to both `interval-glsl` (executed via the JS port of the
preamble) and `interval-js`, and over a grid of boxes the harness asserts
containment, **GPU-`empty` ⟹ CPU-`empty`** (§10), and pole (`singular`) → GPU
not-excludable. All 25 entries pass; the `empty` and pole paths are exercised
(asserted non-zero).

**Phase 2 (elementary):** `Abs`, `Sqrt`, `Exp`, `Ln`/`Log`/`Lb`, positive
rational `Power`. Domain handling matched to `interval-js/elementary.ts`
(fully-out-of-domain → `empty`; straddling → clamp to the valid sub-range).

**Phase 3 (trig):** `Sin`, `Cos`, `Tan`, `Arcsin`, `Arccos`, `Arctan` with
interval range reduction.

### Prior art: the dropped 0.52 implementation

`interval-glsl` (and `interval-wgsl`) shipped in 0.35–0.52 and were removed in
`b541210b` (2026-02-20, "dropped … compilation targets") — **because there was
no client and the interface wasn't settled, so it was maintenance cost with no
users.** Both conditions are now resolved: Tycho is the client, and Phase 0
pinned the interface. So re-introduction is warranted, and the drop reason does
not recur.

The old implementation (1723 lines) used a richer `struct IntervalResult { vec2;
status }` carrying EMPTY/ENTIRE/SINGULAR/PARTIAL flags — i.e. the "Option B"
representation Tycho explicitly declined in §9/§10. The current rebuild keeps the
simpler vec2/Option-A contract, so it is **not** a revival of the old code. But
its **trig range reduction was mined**: the `containsExtremum`/`TWO_PI` endpoint-
snapping logic (old `ia_sin`/`ia_cos`/`ia_tan`) was the hardest part the plan
flagged, and porting it (verified against `interval-js` semantics + the corpus)
saved re-deriving it. Poles map to `entire` (Option A) instead of the old
`singular` tag.

### Remaining

Phase 4 (`compileShader` → full fragment shader + on-GPU validation + perf vs
CPU). Not-yet-ported heads (hyperbolic, reciprocal-trig, `floor`/`mod`/`sign`,
special functions) remain available in the old implementation to mine as needed,
and meanwhile route to CPU `interval-js` via `unsupported`.

---

## 13. CE — step / rounding family mined — 2026-06-16

Mined the remaining commonly-plotted heads from the dropped 0.52 implementation
and added them to the target: **`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`,
`Sign`, `Heaviside`, `Mod`, `Min`, `Max`** (Tycho: "floor and mod are commonly
used with these plots").

**Contract refinement (worth a glance, Tycho):** these are *bounded* jump-
discontinuity functions. interval-js returns `singular` when a box spans a jump;
the §9 contract mapped `singular → entire`. For a **pole** (`div`/`tan`/`mod`-by-
zero) entire is right — the range is unbounded. But for `floor`/`mod`/… the range
is *bounded*, so the GPU returns the **tight value-range enclosure** instead:

- `floor`/`ceil`/`round`/`trunc`/`sign`/`heaviside` are monotone → `[f(lo),
  f(hi)]`.
- `fract` → `[fract(lo), fract(hi)]` within an integer cell, `[0, 1]` across one.
- `mod(x, p)` (constant `p`) → exact within a period, `[0, p]` across a boundary;
  a zero-spanning modulus is a pole → `entire`.
- `min`/`max` → component-wise.

This is **sound** (the enclosure contains the true range, so no missed crossing)
and, unlike `entire`, lets the renderer actually *exclude* floor/mod cells whose
range misses 0 — without it, lattice/periodic plots would get no GPU culling. The
discontinuity classification stays with the CPU on kept cells (Option A is
unchanged). Verified by sampling the true range over discontinuity-spanning
boxes (`compile-interval-glsl.test.ts`).

Remaining un-ported (→ CPU `interval-js` fallback via `unsupported`): hyperbolic
(`Sinh`/`Cosh`/`Tanh`/…), reciprocal trig (`Cot`/`Sec`/`Csc`), and special
functions (`Gamma`/`Erf`/…) — all still available in the old impl to mine if a
client needs them.

---

## 14. CE — Phase 4 (shader generation) done; over to Tycho — 2026-06-16

`IntervalGLSLTarget.compileExclusionShader(expr, { version?, precision? })`
returns a complete `#version 300 es` fragment shader, structured so the contract
is cleanly separable from the harness:

- **`vec2 _implicit(vec2 v0, vec2 v1)`** — the interval evaluator. Its body is
  exactly `compile(expr).code`; the free variables become the `vec2` parameters.
  This is the part that matters and is fully covered by the parity/soundness
  suites.
- **`main()`** — a *reference* harness: derives each fragment's cell box from
  `gl_FragCoord` and `u_domainX`/`u_domainY`/`u_resolution`, evaluates
  `_implicit`, and writes the exclusion result (`f.lo > 0 || f.hi < 0` → cull;
  this also culls `empty`). The renderer can keep `_implicit` and replace the
  harness with its own coordinate mapping / output encoding.

≤ 2 free variables (a 2D implicit curve); the 1st maps to `u_domainX`, the 2nd
to `u_domainY`. >2 throws.

CE-side tests assert the shader is well-formed (preamble injected, uniforms,
`out vec4 fragColor`, balanced delimiters), that `_implicit`'s body is the
compiled code verbatim, and that the oracle *decision* is correct on the unit
circle (center cell culled, ring cell kept, far cell culled) via the JS port.

**Handoff to Tycho (the two remaining Phase-4 items, renderer-side):**

1. **GPU validation** — drop the shader into the WebGL2 implicit renderer and
   confirm it compiles + runs on-device (macOS ANGLE→Metal included; recall the
   fast-math caveat — the contract avoids any error-term cancellation, so it
   should be safe, but worth confirming the `_iv_*` ops survive fast-math).
2. **Benchmark** vs the CPU `interval-js` path on the corpus curves.

Status: **asks A, B done; ask C (interval-glsl) Phases 0–4 complete on the CE
side.** Remaining future work, all gated on a client need (route to CPU via
`unsupported` until then): hyperbolic / reciprocal-trig / special functions
(mine from the old impl), and an `interval-wgsl` sibling (the shared base makes
it cheap).
