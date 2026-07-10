# Exact pole asymptotics for limits and residues (Strategic 7c / Series Phase 3)

**Status:** implemented 2026-07-10.
**Scope:** wire the limit engine's pole-deferral slot (`symbolic/limit.ts`) and
`Residue` (`symbolic/residue.ts`) to the Laurent kernel that already lives in
`symbolic/series.ts`, so limits and residues involving the meromorphic special
functions (`Gamma`, `Digamma`, `Zeta`, …) evaluate exactly instead of
deferring.

## Problem

Three engines each hold a piece of the answer, but they are not connected:

- **`symbolic/limit.ts`** has a *soundness guard*: when any special function in
  the body provably blows up at the limit point, it defers (returns
  `undefined`) rather than let direct substitution treat `Digamma(-1)` as a
  finite symbol and return a wrong `0`. Sound, but it leaves
  `lim_{x→−1}(x+1)ψ(x)` (= −1), `lim_{x→0} Γ(x) − 1/x` (= −γ) and
  `lim_{s→1}(s−1)ζ(s)` (= 1) inert. A leading-term-only rewrite is unsound
  here — the constant term of the Laurent expansion is the answer.
- **`symbolic/residue.ts`** has a closed-form table for `h·Op(x)` with `h`
  analytic and a limit-based order-probing loop. It cannot reach a cofactor
  that is itself a special function (`Res_{s=1} Γ(s)ζ(s)`) or a higher-order
  special pole (`Res_{x=0} Γ(x)²`).
- **`symbolic/series.ts`** (Series Phase 2) contains a complete exact
  **Laurent kernel**: valuation-tagged coefficient arithmetic over
  Add/Multiply/Divide/Power/quotient-trig, plus closed-form Laurent data for
  `Gamma`/`Digamma`/`Zeta` at their poles (`specialLaurent`, gated on the
  analytic-property store's `Poles` records), with exact symbolic
  coefficients (`EulerGamma`, `Zeta(k)`, `Pi`). It is module-private,
  reachable only through the `Series` operator.

## Design

### The shared accessor: `laurentData`

`series.ts` exports one new function (the kernel itself stays private):

```ts
export interface LaurentData {
  /** True valuation: the lowest power with a (known-)nonzero coefficient. */
  v: number;
  /** Highest reliable power; coefficients beyond `hi` are truncation noise. */
  hi: number;
  /** Exact coefficient of `(x − x0)^p`, reliable for `v ≤ p ≤ hi`. */
  coeff(p: number): Expression;
}
export function laurentData(f, x, x0, ce, W = 6): LaurentData | null;
```

`laurentData` runs `expandLaurent` and **normalizes the valuation** via
`trueVal`. It returns `null` when the kernel declines (branch point, essential
singularity, unexpandable operator) **or when the reliable window is
exhausted** (every retained coefficient is zero — cancellation past `hi`
cannot be distinguished from an exact zero). This is the reliability
discipline: a caller may only consult coefficients in `[v, hi]`, and `null`
always means "defer", never "zero".

### Consumer 1 — the limit guard (`symbolic/limit.ts`)

Inside the existing special-function-pole soundness guard (the only place that
changes), when a blow-up is detected, try `laurentData(body, x, point)`:

- `v > 0` → the limit is **0** (exact; leading coefficient is nonzero by
  `trueVal`).
- `v = 0` → the limit is **`coeff(0)`** (the constant term — exactly the
  quantity a leading-term rewrite gets wrong).
- `v < 0` or `null` → **defer exactly as today.**

The `v < 0` case is deliberate: the engine-wide convention is that two-sided
pole limits stay inert (`lim_{x→0} 1/x²` is inert today, even though it
honestly diverges to `+∞`). Returning `±∞`/`~∞` for poles is a separate,
engine-wide behavior decision — out of scope (see non-goals). Because the
wiring lives *inside* the deferral branch, **no input that returns a value
today changes**; the only behavior change is that some of today's defers
become exact values.

Finite `v ≥ 0` results are direction-independent (the kernel produces
integer-power meromorphic expansions only), so the `dir` parameter needs no
handling.

### Consumer 2 — `residue` (`symbolic/residue.ts`)

The Laurent attempt runs **first** (it subsumes the closed-form table and most
of the order-probing loop):

- `null` → fall through to the existing paths unchanged (table, then
  order-probing).
- `v ≥ 0` → residue is **0** (analytic or removable).
- `v ≤ −1` → residue is **`coeff(−1)`** (`−1 ≤ hi` always holds when data is
  present).

This closes `Res_{s=1} Γ(s)ζ(s) = 1`, `Res_{x=0} Γ(x)² = −2γ`,
`Res_{s=1} ζ(s)² = 2γ`, and generally any meromorphic combination the kernel
can expand — including composed arguments (`Γ(2x)`), which the kernel handles
via inner-series composition.

### Consumer 3 — `Trigamma` / `PolyGamma` Laurent data (kernel extension)

`ψ⁽ᵐ⁾` is the m-th derivative of `ψ`, and Laurent series differentiate
termwise — so `specialLaurent` gains `Trigamma` (and integer-literal-order
`PolyGamma(m, x)`, which needs a small binary case in `expandLaurent`; the
kernel's default composition path is unary-only) by differentiating the
`Digamma` data `m` times via a `diffLaurent` helper. Each differentiation
consumes one order of reliability (`hi` drops by 1 per derivative), which the
window discipline accounts for automatically.

Two adjacent pieces landed with this: `DERIVATIVES_TABLE` gains
`Trigamma → PolyGamma(2, ·)` and a 2-arg `PolyGamma(m, u)` chain-rule block
(`d/du ψ⁽ᵐ⁾(u) = ψ⁽ᵐ⁺¹⁾(u)·u′`; ∂/∂m stays inert) — without the kernel data
this table entry alone would have turned the previously-inert
`Series(Trigamma(x))` at 0 into a *spurious regular expansion* with inert
pole values (`Trigamma(0)`, `PolyGamma(2, 0)`) as coefficients, so the two
must ship together.

### Perf: closed-form coefficients replace generic series composition

The original `Gamma`/`Digamma` pole data was computed by symbolically
expanding `exp(lnΓ-series)` quotients through the generic Taylor engine —
seconds per call (5.5 s at order 4, ~15 s at order 6), acceptable for a
user-invoked `Series` but far too slow inside a limit evaluation. Replaced
with exact closed forms, verified at 30 digits with mpmath:

- `Γ(1+u)` Taylor coefficients via the exp-of-log recurrence
  `k·gₖ = Σⱼ sⱼ·g₍ₖ₋ⱼ₎`, `s₁ = −γ`, `sⱼ = (−1)ʲζ(j)`; the regular part at
  `−n` follows by `n` exact synthetic divisions by `(u−j)`.
- `ψ(−n+u) = −1/u + (−γ + Hₙ) + Σ_{k≥1} ((−1)^{k+1}ζ(k+1) + Hₙ⁽ᵏ⁺¹⁾)·uᵏ`
  (from the recurrence `ψ(x) = ψ(1+x+n) − Σⱼ 1/(x+j)` and the `ψ(1+u)`
  Taylor series) — direct coefficients, no composition at all.

`Series(Digamma(x))` at a pole went from ~5.5 s to ~0.3 s; the polygamma
ladder is milliseconds. Consumers pass tight windows (`W = 3` for limits —
only the constant term is consulted — and `W = 4` for residues; the kernel
deepens internally where a denominator's pole order demands it), keeping
the exact symbolic γ/ζ(k) coefficient arithmetic small.

### Cycle-breaking: dependency injection, not extraction

`series.ts` imports `symbolicLimit` — but **only** in the `Series`-at-±∞ entry
point (`seriesAtInfinity`'s coefficient resolver). A `limit.ts → series.ts`
import would create a cycle (zero-cycle budget). Rather than extracting the
~900-line kernel into a new module, `computeSeries` gains an optional
`resolveLimit` parameter and `library/calculus.ts` (the single caller, one
layer up, which already imports `symbolicLimit`) injects it. `series.ts` then
imports nothing from `limit.ts`, and `limit.ts`/`residue.ts` import
`laurentData` from `series.ts` acyclically. Behavior is unchanged — the only
caller passes the same function that was statically imported before.

## Soundness rules (summary)

1. Any coefficient consulted must lie in the reliable window `[v, hi]`;
   an exhausted window returns `null` (defer), never `0`.
2. The kernel globally declines non-meromorphic points (branch points,
   essential singularities) — both consumers keep deferring there, so no
   wrong value is representable by construction.
3. All coefficients are exact/symbolic; no floats are introduced on any path.
4. The limit wiring is confined to the existing deferral branch: the
   only reachable behavior change is defer → exact value.

## Non-goals (recorded for the follow-up ladder)

- **Directional/`±∞` results for `v < 0`** — would change the engine-wide
  inert-pole-limit convention (`lim 1/x²` at 0); a deliberate decision to make
  separately.
- **Residue at infinity** — `Res_∞ f = −Res_{s=0} f(1/s)/s²`; a natural next
  rung on the same `laurentData` API.
- **Sum-of-residues-in-a-region helper** — needs a pole-enumeration API over
  the analytic-property store.
- **Laurent as a general fallback for all finite limits** — the structural
  strategies own the elementary cases; widening the entry condition is a
  perf/blast-radius decision for later.
- **`GammaLn`** (logarithmic branch point — not meromorphic) and **`Beta`**
  (binary; would need the `Γ`-quotient rewrite first). Both stay on the
  deferral list.

## Test plan

- `limit-special-functions.test.ts`: the two soundness regressions flip from
  "defers" to the exact values (−1 and −γ — the test text already anticipated
  this); add `(s−1)ζ(s) → 1`, `x·Γ(x) → 1`; the no-over-deferral block and
  elementary-limit assertions stay green unchanged.
- `residue.test.ts`: add `Γζ@1 → 1`, `Γ²@0 → −2γ`, `ζ²@1 → 2γ`; every
  existing case (rational, higher-order, trig, table-gated special functions)
  stays green — now mostly served by the Laurent path.
- `series.test.ts` and the `calculus` Series-operator tests stay green
  (kernel untouched except the export + `Trigamma`/`PolyGamma` data; the
  injection is behavior-neutral).
- Every new exact value is verified numerically (small-ε probes) before being
  pinned, per the repo's verify-math-empirically rule.
- `npx madge --circular` after the import changes (both directions of the
  broken cycle re-checked).
