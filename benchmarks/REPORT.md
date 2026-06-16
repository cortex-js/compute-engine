# Compute Engine Benchmark Report

_Generated 2026-06-16 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.59.0`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **7 improvements over `0.59.0`** (the unpublished fixes surface on the hard tier): N07 ($\zeta(3)$), S05 ($x^{-1/2}-\frac{1}{\sqrt x}$), S08 ($\sqrt{3+2\sqrt2}$), A06 ($\int\frac{1}{x^3+1}\,dx$), A07 ($\int\frac{1}{\sqrt x}\,dx$), A08 ($\int e^{-x^2}\,dx$), A09 ($\int\frac{x}{\sqrt{1-x^2}}\,dx$) now produce a fully-evaluated result where the published build did not.
- **3 more cases** changed *output form* vs `0.59.0` (value unchanged) — the coefficient-extraction fixes, e.g. N05 ($e^{\pi}$), N08 ($\Gamma(\tfrac13)$).
- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, non-embeddable kernel; CE's pitch against it is open-source, browser-native delivery at competitive per-call speed.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.59.0` @ `80be960f` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.59.0` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |
| Wolfram (Mathematica) | `14.3.0 for Mac OS X ARM` | `wolframscript` kernel |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.59.0` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.
- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system `wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their true compute cost, parse included but negligible.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool's native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. `CE+R/F` runs on the same minified bundle as `CE·cur` (plus the Rubi + Fungrim rule packs), so its times are directly comparable; for integrals they include the Rubi rule-match attempt made before the built-in fallback.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 8/9 (+1🟡) | 9/9 | 6/9 | 0/9 (+5🟡) | 9/9 |
| Simplification | 9/9 | 9/9 | 7/9 (+2🟡) | 8/9 (+1🟡) | 2/9 (+7🟡) | — | 9/9 |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — | 9/9 |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 5/12 | 12/12 | — | — | 12/12 |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`). Times are comparable to the other columns.

### Arbitrary-precision numeric evaluation — times in **µs**

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |  |
| N01 | $\pi^2$ <sub>(50d)</sub> | 13 | 8.6 | 16 | 182 | 90 | 🟡 <sub>16 digits</sub> 3.7 | 3.2 |
| N02 | $e$ <sub>(50d)</sub> | 0.83 | 0.33 | 0.67 | 155 | 12 | 🟡 <sub>16 digits</sub> 3.2 | 2.9 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 9.8 | 7.4 | 11 | 236 | 77 | 🟡 <sub>17 digits</sub> 5.2 | 4.4 |
| N04 | $100!$ <sub>(exact)</sub> | 8.5 | 7.5 | 10.0 | 246 | 128 | ❌ <sub>inexact</sub> 11 | 2.2 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 15 | 11 | 76 | 196 | 350 | 🟡 <sub>17 digits</sub> 4.9 | 4.0 |
| | **Hard tier** |  |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.87 | 0.29 | 0.67 | 157 | 12 | 🟡 <sub>16 digits</sub> 3.3 | 2.9 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 509 | 481 | 🟡 <sub>17 digits</sub> 222 | 270 | ❌ <sub>8 digits</sub> 3374 | — | 13 |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 339 | 302 | 2237 | 246 | ⚠️ | — | 47 |
| N09 | $W(1)$ <sub>(40d)</sub> | 118 | 85 | 219 | 673 | — | — | 39 |
|  | **median µs** | **13** | **8.6** | **16** | **236** | **90** | **4.9** | **4.0** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.34 | 0.21 | 0.28 | 8.59 | 🟡 <sub>not simplified</sub> 0.97 | 0.17 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.21 | 0.23 | 0.22 | 9.35 | 🟡 <sub>not simplified</sub> 0.83 | 0.08 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.49 | 0.33 | 0.52 | 6.43 | 🟡 <sub>not simplified</sub> 1.83 | 0.16 |
| S04 | $\frac{x^3-x}{x}$ | 0.29 | 0.12 | 0.30 | 4.18 | 1.26 | 0.63 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.24 | 0.08 | 🟡 <sub>not simplified</sub> 0.22 | 0.24 | 🟡 <sub>not simplified</sub> 1.32 | 0.03 |
| | **Hard tier** |  |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.58 | 0.38 | 0.62 | 5.58 | 0.89 | 18.6 |
| S07 | $\ln x+\ln(x+1)$ | 0.45 | 0.33 | 0.37 | 6.07 | 🟡 <sub>not simplified</sub> 0.75 | 1.39 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.30 | 0.15 | 🟡 <sub>not simplified</sub> 0.19 | 🟡 <sub>not simplified</sub> 3.65 | 🟡 <sub>numeric only</sub> 0.83 | 3.40 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.34 | 0.10 | 0.36 | 8.76 | 🟡 <sub>not simplified</sub> 0.92 | 1.05 |
|  | **median ms** | **0.34** | **0.21** | **0.30** | **6.07** | **0.92** | **0.63** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.04 | 0.24 | 0.04 | 0.34 | 0.75 | 0.0035 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.15 | 0.05 | 0.20 | 0.52 | 0.87 | 0.0039 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.08 | 0.26 | 0.09 | 2.76 | 1.24 | 0.0039 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.56 | 0.36 | 0.56 | 2.39 | 2.84 | 0.0054 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.18 | 0.31 | 0.19 | 1.42 | 1.21 | 0.0044 |
| | **Hard tier** |  |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.13 | 0.05 | 0.14 | 2.02 | 4.56 | 0.0048 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.40 | 0.37 | 0.18 | 2.95 | 1.08 | 0.0047 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.15 | 0.30 | 0.12 | 1.11 | 1.07 | 0.0044 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 1.15 | 0.54 | 1.17 | 7.93 | 2.37 | 0.0079 |
|  | **median ms** | **0.15** | **0.30** | **0.18** | **2.02** | **1.21** | **0.0044** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.59.0 | SymPy | Wolfram |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.33 | 0.37 | 0.24 | 0.38 | 0.03 |
| A02 | $\int\sin x\,dx$ | 0.10 | 0.34 | 0.13 | 1.22 | 0.60 |
| A03 | $\int x e^x\,dx$ | 0.42 | 0.45 | 0.34 | 8.43 | 0.58 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.27 | 0.35 | 0.25 | 9.96 | 0.86 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.64 | 0.54 | 0.64 | 7.68 | 0.60 |
| | **Hard tier** |  |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 4.15 | 1.04 | ∅ | 24.8 | 8.80 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.28 | 0.40 | ∅ | 0.73 | 0.37 |
| A08 | $\int e^{-x^2}\,dx$ | 0.74 | 0.70 | ∅ | 25.2 | 0.44 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.94 | 1.03 | ∅ | 25.8 | 2.09 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 0.66 | ∅ | 22.1 | 2.30 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 0.62 | ∅ | 116 | 1.12 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 0.66 | ∅ | 213 | 1.47 |
|  | **median ms** | **0.42** | **0.62** | **0.25** | **22.1** | **0.86** |

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

| | CE | CE + Rubi/Fungrim | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|
| Arbitrary-precision numerics | ✅ | ✅ | ✅ | ✅ (BigNumber) | ❌ double only | ✅ |
| Exact big-integer arithmetic | ✅ | ✅ | ✅ | ✅ (with precision) | ❌ overflow | ✅ |
| Special functions (ζ, Γ, W) | ✅ | ✅ | 🟡 some | 🟡 some | ❌ | ✅ |
| Symbolic simplification | ✅ | ✅ | ✅ | 🟡 limited | — | ✅ |
| Symbolic differentiation | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Symbolic integration | 🟡 elementary | ✅ +algebraic (Rubi) | ✅ broad | — | — | ✅ broadest |
| Runtime | JS / browser + Node | JS / browser + Node (opt-in rule packs) | Python | JS / browser + Node | Python | Proprietary kernel |
| License | MIT | MIT | BSD | Apache-2.0 | BSD | Commercial |

### Observations

- **Compute Engine (current build)**: 36/39 fully correct across applicable cases. The only browser-native engine here that does symbolic integration and arbitrary-precision numerics (incl. ζ, Γ, Lambert W) in one library. Its main gap is integration coverage — fractional-power and several radical integrands return unevaluated.
- **CE + Rubi + Fungrim**: 39/39 correct — loading the opt-in Rubi algebraic-integration rules closes most of that gap (fractional-power binomial products like `∫√x/(1+x)`, `∫x/(1+x)^⅓` now solve), but it still can't do non-elementary integrals like `∫e^(−x²)` (no exp/trig rule sections loaded). It runs on the minified bundle, so its times are comparable.
- **SymPy**: 38/39 correct — the broadest symbolic coverage (integrates `1/√x` and `e^(−x²)`→erf, denests radicals), at the cost of a Python runtime and higher per-call latency.
- **math.js**: 17/27 correct across the categories it supports. Strong at numeric (BigNumber) and differentiation, and has a few special functions (ζ, Γ, erf); its `simplify()` frequently returns the input essentially unchanged (🟡), and it has no symbolic integration.
- **NumPy**: 0/9 correct — numeric only and limited to ~15–16 significant digits (IEEE double); it cannot represent the high-precision results, overflows on `100!`, and has no ζ/Γ/W. The baseline for "numeric, but not arbitrary precision".
- **Wolfram (Mathematica)**: 39/39 correct — the broadest coverage in the field, and the reference point for "what a mature commercial CAS does". It is the one competitor that, like CE, spans *all* four capabilities: arbitrary-precision numerics (incl. ζ, Γ, W), simplification, differentiation, and the widest symbolic integration (denests radicals, does `∫e^(−x²)`→erf and the algebraic-radical integrands that need Rubi on the CE side). The trade-offs are non-technical: a proprietary kernel with a multi-second start-up per process (excluded from the warm per-call times here) and a commercial licence — versus CE's MIT-licensed, browser-native single package.

---

_Reproduce: `python benchmarks/gen_cases.py && node benchmarks/report.mjs`. Raw data in [`results.json`](./results.json)._
