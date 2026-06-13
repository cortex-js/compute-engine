# Compute Engine Benchmark Report

_Generated 2026-06-13 · 36 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.59.0`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy), along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **2 improvements over `0.59.0`** (the unpublished fixes surface on the hard tier): S05 ($x^{-1/2}-\frac{1}{\sqrt x}$), A06 ($\int\frac{1}{x^3+1}\,dx$) now produce a fully-evaluated result where the published build did not.
- **1 more case** changed *output form* vs `0.59.0` (value unchanged) — the coefficient-extraction fixes, e.g. S06 ($\sqrt6\,x+\sqrt2\,x$).
- **No regressions** vs the published build across all 36 cases.
- **Compute Engine answers 31/36** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 33/36** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.59.0` @ `770cb117` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same `src/` + experimental Rubi rules + Fungrim corpus | Node v22.13.1 via `tsx` |
| Compute Engine — published | `0.59.0` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |

## Methodology

- **Suite**: 9 cases in each of 4 categories (36 total), split into a **core** tier (5, textbook) and a **hard** tier (4, boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.59.0` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js and NumPy are the competitors.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built from its source representation and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The `CE+R/F` times come from a from-source (`tsx`) run and read a few× high — comparable within that column, not against the minified `CE·cur`.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results out of 9 per category. Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy |
|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 8/9 (+1🟡) | 8/9 (+1🟡) | 8/9 (+1🟡) | 9/9 | 6/9 | 0/9 (+5🟡) |
| Simplification | 8/9 (+1🟡) | 8/9 (+1🟡) | 7/9 (+2🟡) | 8/9 (+1🟡) | 2/9 (+7🟡) | — |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — |
| Antiderivation (symbolic integration) | 6/9 | 8/9 | 5/9 | 9/9 | — | — |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (in **ms**, warm). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> `CE+R/F` (current build + experimental Rubi + Fungrim) builds from source via `tsx`, and for integrals it **tries matching ~2,647 Rubi rules** (compiled once, ~0.5 s) before falling back to the built-in integrator — so its times include that match attempt even when no rule applies (e.g. `∫xeˣ`). Read this column for *coverage*, not head-to-head speed.

### Arbitrary-precision numeric evaluation

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| N01 | $\pi$ <sub>(50d)</sub> | 0.00 | 0.00 | 0.00 | 0.33 | 0.05 | 🟡 <sub>16 digits</sub> 0.00 |
| N02 | $e$ <sub>(50d)</sub> | 0.00 | 0.00 | 0.00 | 0.28 | 0.02 | 🟡 <sub>16 digits</sub> 0.00 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 0.02 | 0.01 | 0.03 | 0.39 | 0.27 | 🟡 <sub>17 digits</sub> 0.00 |
| N04 | $100!$ <sub>(exact)</sub> | 0.02 | 0.01 | 0.02 | 0.46 | 0.23 | ❌ <sub>inexact</sub> 0.02 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 0.15 | 0.14 | 0.15 | 0.34 | 0.76 | 🟡 <sub>17 digits</sub> 0.00 |
| | **Hard tier** |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.00 | 0.00 | 0.00 | 0.28 | 0.02 | 🟡 <sub>16 digits</sub> 0.00 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | **🟡 <sub>17 digits</sub> 0.44** | 🟡 <sub>17 digits</sub> 0.44 | 🟡 <sub>17 digits</sub> 0.45 | 0.53 | ❌ <sub>8 digits</sub> 10.7 | — |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | **4.87** | 4.32 | 4.42 | 0.42 | ⚠️ | — |
| N09 | $W(1)$ <sub>(40d)</sub> | 0.63 | 0.35 | 0.37 | 1.24 | — | — |
|  | **median ms** | **0.02** | **0.01** | **0.03** | **0.39** | **0.23** | **0.00** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.62 | 1.02 | 0.60 | 15.6 | 🟡 <sub>not simplified</sub> 3.25 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.41 | 1.03 | 0.36 | 16.4 | 🟡 <sub>not simplified</sub> 2.31 |
| S03 | $(x+1)^2-(x-1)^2$ | 1.01 | 1.44 | 1.09 | 10.7 | 🟡 <sub>not simplified</sub> 3.43 |
| S04 | $\frac{x^3-x}{x}$ | 0.64 | 0.62 | 0.55 | 9.71 | 3.77 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.68 | 0.25 | 🟡 <sub>not simplified</sub> 0.47 | 0.46 | 🟡 <sub>not simplified</sub> 5.94 |
| | **Hard tier** |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 1.48 | 1.81 | 1.82 | 11.6 | 3.26 |
| S07 | $\ln x+\ln(x+1)$ | 1.08 | 1.64 | 1.01 | 12.9 | 🟡 <sub>not simplified</sub> 2.46 |
| S08 | $\sqrt{3+2\sqrt2}$ | **🟡 <sub>not simplified</sub> 0.50** | 🟡 <sub>not simplified</sub> 0.86 | 🟡 <sub>not simplified</sub> 0.46 | 🟡 <sub>not simplified</sub> 6.87 | 🟡 <sub>numeric only</sub> 2.40 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.82 | 0.87 | 1.14 | 28.9 | 🟡 <sub>not simplified</sub> 7.12 |
|  | **median ms** | **0.68** | **1.02** | **0.60** | **11.6** | **3.26** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.12 | 0.48 | 0.12 | 0.82 | 2.78 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.34 | 0.18 | 0.33 | 2.48 | 4.26 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.18 | 0.47 | 0.15 | 4.26 | 2.41 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.78 | 0.98 | 1.00 | 4.01 | 5.04 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.44 | 0.64 | 0.48 | 2.68 | 3.27 |
| | **Hard tier** |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.24 | 0.18 | 0.29 | 3.35 | 3.89 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.67 | 1.00 | 0.34 | 5.41 | 4.06 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.22 | 0.81 | 0.21 | 2.01 | 3.67 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 1.98 | 1.51 | 2.22 | 13.0 | 12.0 |
|  | **median ms** | **0.34** | **0.64** | **0.33** | **3.35** | **3.89** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy |
|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |
| A01 | $\int x^2\,dx$ | 1.41 | 2.86 | 1.00 | 0.96 |
| A02 | $\int\sin x\,dx$ | 0.39 | 3.66 | 0.45 | 2.56 |
| A03 | $\int x e^x\,dx$ | 1.08 | 35.9 | 0.78 | 12.1 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.50 | 1.52 | 0.45 | 19.8 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 1.30 | 4.48 | 1.19 | 12.0 |
| | **Hard tier** |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 8.49 | 53.4 | ∅ | 54.1 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | **∅** | 0.31 | ∅ | 1.34 |
| A08 | $\int e^{-x^2}\,dx$ | **∅** | ∅ | ∅ | 48.1 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | **∅** | 5.46 | ∅ | 63.7 |
|  | **median ms** | **1.30** | **4.48** | **0.78** | **12.1** |

## Current build vs published `0.59.0`

4 case(s) differ between the current build and `0.59.0`:

| # | Case | Current build | Published `0.59.0` | Change |
|---|---|---|---|---|
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | ✅ `0` | 🟡 `-sqrt(1 / x) + 1 / sqrt(x)` | 🟢 improved |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | ✅ `sqrt(2) * x * (1 + sqrt(3))` | ✅ `x * (sqrt(2) + sqrt(6))` | ↔︎ different output form |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | ✅ `0.3333333333333333 * ln(|x +` | ∅ `int(1 / (x^3 + 1) dx)` | 🟢 improved |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | ∅ `int(1 / sqrt(x) dx)` | ∅ `int(sqrt(1 / x) dx)` | ↔︎ different output form |

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
| Runtime | JS / browser + Node | JS (experimental, from source) | Python | JS / browser + Node | Python |

### Observations

- **Compute Engine (current build)**: 31/36 fully correct across applicable cases. The only browser-native engine here that does symbolic integration and arbitrary-precision numerics (incl. ζ, Γ, Lambert W) in one library. Its main gap is integration coverage — fractional-power and several radical integrands return unevaluated.
- **CE + Rubi + Fungrim (experimental)**: 33/36 correct — enabling the Rubi algebraic-integration rules closes most of that gap (`∫1/√x`, `∫x/√(1−x²)` now solve; `∫1/(x³+1)` returns *exact* coefficients), but it still can't do non-elementary integrals like `∫e^(−x²)` (no exp/trig rule sections loaded), and it currently runs only from source.
- **SymPy**: 35/36 correct — the broadest symbolic coverage (integrates `1/√x` and `e^(−x²)`→erf, denests radicals), at the cost of a Python runtime and higher per-call latency.
- **math.js**: 17/27 correct across the categories it supports. Strong at numeric (BigNumber) and differentiation, and has a few special functions (ζ, Γ, erf); its `simplify()` frequently returns the input essentially unchanged (🟡), and it has no symbolic integration.
- **NumPy**: 0/9 correct — numeric only and limited to ~15–16 significant digits (IEEE double); it cannot represent the high-precision results, overflows on `100!`, and has no ζ/Γ/W. The baseline for "numeric, but not arbitrary precision".

---

_Reproduce: `python benchmarks/gen_cases.py && node benchmarks/report.mjs`. Raw data in [`results.json`](./results.json)._
