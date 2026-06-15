# Compute Engine Benchmark Report

_Generated 2026-06-15 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.59.0`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy), along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **7 improvements over `0.59.0`** (the unpublished fixes surface on the hard tier): N07 ($\zeta(3)$), S05 ($x^{-1/2}-\frac{1}{\sqrt x}$), S08 ($\sqrt{3+2\sqrt2}$), A06 ($\int\frac{1}{x^3+1}\,dx$), A07 ($\int\frac{1}{\sqrt x}\,dx$), A08 ($\int e^{-x^2}\,dx$), A09 ($\int\frac{x}{\sqrt{1-x^2}}\,dx$) now produce a fully-evaluated result where the published build did not.
- **3 more cases** changed *output form* vs `0.59.0` (value unchanged) — the coefficient-extraction fixes, e.g. N05 ($e^{\pi}$), N08 ($\Gamma(\tfrac13)$).
- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.59.0` @ `cc27aea0` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.59.0` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.59.0` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js and NumPy are the competitors.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built from its source representation and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. `CE+R/F` now runs on the same minified bundle as `CE·cur` (plus the Rubi + Fungrim rule packs), so its times are directly comparable; for integrals they include the Rubi rule-match attempt made before the built-in fallback.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy |
|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 8/9 (+1🟡) | 9/9 | 6/9 | 0/9 (+5🟡) |
| Simplification | 9/9 | 9/9 | 7/9 (+2🟡) | 8/9 (+1🟡) | 2/9 (+7🟡) | — |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 5/12 | 12/12 | — | — |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (in **ms**, warm). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`). Times are comparable to the other columns.

### Arbitrary-precision numeric evaluation

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| N01 | $\pi$ <sub>(50d)</sub> | 0.00 | 0.00 | 0.00 | 0.17 | 0.04 | 🟡 <sub>16 digits</sub> 0.00 |
| N02 | $e$ <sub>(50d)</sub> | 0.00 | 0.00 | 0.00 | 0.16 | 0.01 | 🟡 <sub>16 digits</sub> 0.00 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 0.01 | 0.00 | 0.01 | 0.24 | 0.07 | 🟡 <sub>17 digits</sub> 0.00 |
| N04 | $100!$ <sub>(exact)</sub> | 0.00 | 0.00 | 0.00 | 0.26 | 0.15 | ❌ <sub>inexact</sub> 0.01 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 0.02 | 0.01 | 0.08 | 0.20 | 0.39 | 🟡 <sub>17 digits</sub> 0.00 |
| | **Hard tier** |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.00 | 0.00 | 0.00 | 0.16 | 0.01 | 🟡 <sub>16 digits</sub> 0.00 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 0.55 | 0.53 | 🟡 <sub>17 digits</sub> 0.22 | 0.28 | ❌ <sub>8 digits</sub> 5.73 | — |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 0.43 | 0.36 | 2.24 | 0.25 | ⚠️ | — |
| N09 | $W(1)$ <sub>(40d)</sub> | 0.12 | 0.09 | 0.22 | 0.71 | — | — |
|  | **median ms** | **0.01** | **0.00** | **0.01** | **0.24** | **0.07** | **0.00** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.28 | 0.33 | 0.29 | 8.34 | 🟡 <sub>not simplified</sub> 1.16 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.21 | 0.31 | 0.21 | 8.79 | 🟡 <sub>not simplified</sub> 1.07 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.50 | 0.35 | 0.51 | 6.00 | 🟡 <sub>not simplified</sub> 1.07 |
| S04 | $\frac{x^3-x}{x}$ | 0.28 | 0.14 | 0.28 | 4.17 | 1.22 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.25 | 0.08 | 🟡 <sub>not simplified</sub> 0.29 | 0.24 | 🟡 <sub>not simplified</sub> 1.48 |
| | **Hard tier** |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.61 | 0.42 | 0.64 | 6.36 | 1.18 |
| S07 | $\ln x+\ln(x+1)$ | 0.40 | 0.43 | 0.40 | 6.37 | 🟡 <sub>not simplified</sub> 1.64 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.40 | 0.21 | 🟡 <sub>not simplified</sub> 0.53 | 🟡 <sub>not simplified</sub> 4.08 | 🟡 <sub>numeric only</sub> 2.25 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.37 | 0.13 | 0.40 | 8.92 | 🟡 <sub>not simplified</sub> 0.91 |
|  | **median ms** | **0.37** | **0.31** | **0.40** | **6.36** | **1.18** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.04 | 0.26 | 0.04 | 0.34 | 0.64 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.15 | 0.05 | 0.15 | 0.51 | 1.56 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.09 | 0.28 | 0.09 | 2.39 | 1.05 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.50 | 0.36 | 0.40 | 2.22 | 2.93 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.20 | 0.32 | 0.19 | 1.45 | 1.49 |
| | **Hard tier** |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.14 | 0.04 | 0.18 | 1.86 | 1.89 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.49 | 0.38 | 0.20 | 3.29 | 1.67 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.13 | 0.30 | 0.12 | 1.20 | 1.22 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 0.97 | 0.54 | 0.70 | 6.97 | 2.57 |
|  | **median ms** | **0.15** | **0.30** | **0.18** | **1.86** | **1.56** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy |
|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.35 | 0.37 | 0.24 | 0.39 |
| A02 | $\int\sin x\,dx$ | 0.11 | 0.36 | 0.10 | 1.22 |
| A03 | $\int x e^x\,dx$ | 0.46 | 0.65 | 0.52 | 7.51 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.24 | 0.36 | 0.25 | 12.8 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.82 | 0.63 | 1.04 | 8.01 |
| | **Hard tier** |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 8.84 | 1.14 | ∅ | 26.4 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.41 | 0.43 | ∅ | 0.87 |
| A08 | $\int e^{-x^2}\,dx$ | 0.80 | 0.73 | ∅ | 29.7 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.87 | 1.24 | ∅ | 24.3 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 0.70 | ∅ | 22.4 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 0.59 | ∅ | 119 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 0.70 | ∅ | 215 |
|  | **median ms** | **0.46** | **0.65** | **0.25** | **22.4** |

## Current build vs published `0.59.0`

10 case(s) differ between the current build and `0.59.0`:

| # | Case | Current build | Published `0.59.0` | Change |
|---|---|---|---|---|
| N05 | $e^{\pi}$ | ✅ `23.1406926327792690057290863` | ✅ `23.1406926327792690057290863` | ↔︎ different output form |
| N07 | $\zeta(3)$ | ✅ `1.20205690315959428539973816` | 🟡 `1.20205690315959422353510460` | 🟢 improved |
| N08 | $\Gamma(\tfrac13)$ | ✅ `2.67893853470774763365569294` | ✅ `2.67893853470774763365569294` | ↔︎ different output form |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | ✅ `0` | 🟡 `-sqrt(1 / x) + 1 / sqrt(x)` | 🟢 improved |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | ✅ `sqrt(2) * x * (1 + sqrt(3))` | ✅ `x * (sqrt(2) + sqrt(6))` | ↔︎ different output form |
| S08 | $\sqrt{3+2\sqrt2}$ | ✅ `1 + sqrt(2)` | 🟡 `sqrt(3 + 2sqrt(2))` | 🟢 improved |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | ✅ `1/3 * ln(|x + 1|) + sqrt(3)/` | ∅ `int(1 / (x^3 + 1) dx)` | 🟢 improved |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | ✅ `2sqrt(x)` | ∅ `int(sqrt(1 / x) dx)` | 🟢 improved |
| A08 | $\int e^{-x^2}\,dx$ | ✅ `1/2 * Erf(x) * sqrt(pi)` | ∅ `int(e^(-(x^2)) dx)` | 🟢 improved |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | ✅ `-sqrt(1 - x^2)` | ∅ `int(x / sqrt(1 - x^2) dx)` | 🟢 improved |

## Competitive analysis

### Capability & precision matrix

| | CE | CE + Rubi/Fungrim | SymPy | math.js | NumPy |
|---|---|---|---|---|---|
| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ✅ (BigNumber) | ❌ double only |
| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ✅ (with precision) | ❌ overflow |
| Special functions (ζ, Γ, W) | ✅ | ✅ | 🟡 some | 🟡 some | ❌ |
| Symbolic simplification | ✅ | ✅ | ✅ | 🟡 limited | — |
| Symbolic differentiation | ✅ | ✅ | ✅ | ✅ | — |
| Symbolic integration | 🟡 elementary | ✅ +algebraic (Rubi) | ✅ broad | — | — |
| Runtime | JS / browser + Node | JS / browser + Node (opt-in rule packs) | Python | JS / browser + Node | Python |

### Observations

- **Compute Engine (current build)**: 36/39 fully correct across applicable cases. The only browser-native engine here that does symbolic integration and arbitrary-precision numerics (incl. ζ, Γ, Lambert W) in one library. Its main gap is integration coverage — fractional-power and several radical integrands return unevaluated.
- **CE + Rubi + Fungrim**: 39/39 correct — loading the opt-in Rubi algebraic-integration rules closes most of that gap (fractional-power binomial products like `∫√x/(1+x)`, `∫x/(1+x)^⅓` now solve), but it still can't do non-elementary integrals like `∫e^(−x²)` (no exp/trig rule sections loaded). It runs on the minified bundle, so its times are comparable.
- **SymPy**: 38/39 correct — the broadest symbolic coverage (integrates `1/√x` and `e^(−x²)`→erf, denests radicals), at the cost of a Python runtime and higher per-call latency.
- **math.js**: 17/27 correct across the categories it supports. Strong at numeric (BigNumber) and differentiation, and has a few special functions (ζ, Γ, erf); its `simplify()` frequently returns the input essentially unchanged (🟡), and it has no symbolic integration.
- **NumPy**: 0/9 correct — numeric only and limited to ~15–16 significant digits (IEEE double); it cannot represent the high-precision results, overflows on `100!`, and has no ζ/Γ/W. The baseline for "numeric, but not arbitrary precision".

---

_Reproduce: `python benchmarks/gen_cases.py && node benchmarks/report.mjs`. Raw data in [`results.json`](./results.json)._
