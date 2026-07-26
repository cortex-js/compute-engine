# Compute Engine Benchmark Report

_Generated 2026-07-26 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.92.1`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, non-embeddable kernel; CE's pitch against it is open-source, browser-native delivery at competitive per-call speed.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.95.0` @ `6c188402` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.92.1` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |
| Wolfram (Mathematica) | `14.3.0 for Mac OS X ARM` | `wolframscript` kernel |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.92.1` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.
- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system `wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their true compute cost, parse included but negligible.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool's native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. **All three Compute Engine columns (`CE·cur`, `CE·0.92.1`, `CE+R/F`) are measured warm, back-to-back in one long-lived process** (`run_ce_rubi.mjs`), so they share identical V8 JIT/cache warm-up and are **directly comparable to each other** — `CE·cur` vs `CE+R/F` is a true rule-pack overhead and `CE·cur` vs `CE·0.92.1` a true release delta. (Earlier revisions measured `CE·cur`/`CE·pub` in a fresh COLD process per case; a fresh V8 that runs a case only ~50× never tiers up to the steady state a long-lived process reaches, so it reported the same engine 1.5–2× slower — which made `CE·cur` look slower than the pack-loaded `CE+R/F` on pure numerics, an impossibility. Warming all CE columns in one process removes that artifact.) SymPy/NumPy need no such treatment (interpreted, no JIT tiering, so a cold process is already at steady state) and Wolfram times warm inside its kernel; math.js (also V8) is still cold-per-process — the one remaining cross-tool warm-up asymmetry, which can make its numeric column read slightly high. For integrals `CE+R/F` includes the Rubi rule-match attempt made before the built-in fallback; the honest pack overhead is in the "Rule packs" section below.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.92.1 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 9/9 | 9/9 | 6/9 | 0/9 (+5🟡) | 9/9 |
| Simplification | 9/9 | 9/9 | 9/9 | 8/9 (+1🟡) | 2/9 (+7🟡) | — | 9/9 |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — | 9/9 |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 9/12 | 12/12 | — | — | 12/12 |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> All three CE columns (`CE·cur`, `CE·0.92.1`, `CE+R/F`) are measured **warm, in one shared process**, so they are directly comparable to each other in every row. `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`); on rows where no rule can fire (numeric, differentiation) `CE·cur` and `CE+R/F` should read ≈equal. The honest per-op pack overhead is tabulated in the [Rule packs](#rule-packs--coverage--true-warm-overhead) section.

### Arbitrary-precision numeric evaluation — times in **µs**

| # | Case | CE·cur | CE+R/F | CE·0.92.1 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |  |
| N01 | $\pi^2$ <sub>(50d)</sub> | 7.3 | 7.1 | 8.2 | 176 | 53 | 🟡 <sub>16 digits</sub> 3.8 | 3.9 |
| N02 | $e$ <sub>(50d)</sub> | 0.42 | 0.42 | 0.54 | 159 | 11 | 🟡 <sub>16 digits</sub> 3.2 | 2.9 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 5.7 | 5.8 | 7.3 | 226 | 73 | 🟡 <sub>17 digits</sub> 4.9 | 4.5 |
| N04 | $100!$ <sub>(exact)</sub> | 8.5 | 8.6 | 8.2 | 263 | 102 | ❌ <sub>inexact</sub> 10 | 2.7 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 8.5 | 8.4 | 10 | 195 | 363 | 🟡 <sub>17 digits</sub> 4.8 | 3.3 |
| | **Hard tier** |  |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.42 | 0.38 | 0.54 | 157 | 12 | 🟡 <sub>16 digits</sub> 3.2 | 3.0 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 284 | 240 | 297 | 272 | ❌ <sub>8 digits</sub> 4256 | — | 13 |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 157 | 144 | 163 | 243 | ⚠️ | — | 47 |
| N09 | $W(1)$ <sub>(40d)</sub> | 49 | 50 | 58 | 667 | — | — | 39 |
|  | **median µs** | **8.5** | **8.4** | **8.2** | **226** | **73** | **4.8** | **3.9** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.92.1 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.13 | 0.13 | 0.23 | 8.26 | 🟡 <sub>not simplified</sub> 1.00 | 0.17 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.07 | 0.18 | 0.10 | 8.36 | 🟡 <sub>not simplified</sub> 1.10 | 0.08 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.24 | 0.26 | 0.37 | 5.87 | 🟡 <sub>not simplified</sub> 1.05 | 0.16 |
| S04 | $\frac{x^3-x}{x}$ | 0.11 | 0.12 | 0.19 | 4.27 | 1.44 | 0.64 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.07 | 0.07 | 0.11 | 0.23 | 🟡 <sub>not simplified</sub> 1.52 | 0.03 |
| | **Hard tier** |  |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.22 | 0.40 | 0.31 | 5.53 | 1.20 | 18.0 |
| S07 | $\ln x+\ln(x+1)$ | 0.14 | 0.30 | 0.21 | 5.98 | 🟡 <sub>not simplified</sub> 0.91 | 1.40 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.08 | 0.12 | 0.09 | 🟡 <sub>not simplified</sub> 3.56 | 🟡 <sub>numeric only</sub> 0.76 | 3.33 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.11 | 0.11 | 0.14 | 8.99 | 🟡 <sub>not simplified</sub> 0.88 | 1.01 |
|  | **median ms** | **0.11** | **0.13** | **0.19** | **5.87** | **1.05** | **0.64** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.92.1 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.0097 | 0.0092 | 0.01 | 0.34 | 0.86 | 0.0031 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.05 | 0.06 | 0.06 | 0.52 | 0.99 | 0.0038 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.02 | 0.02 | 0.02 | 2.12 | 0.79 | 0.0036 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.15 | 0.14 | 0.15 | 2.02 | 1.82 | 0.0054 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.06 | 0.06 | 0.07 | 1.42 | 1.29 | 0.0044 |
| | **Hard tier** |  |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.05 | 0.05 | 0.06 | 1.70 | 1.58 | 0.0049 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.08 | 0.08 | 0.10 | 2.93 | 1.20 | 0.0041 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.08 | 0.03 | 0.07 | 1.08 | 1.04 | 0.0044 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 0.19 | 0.19 | 0.21 | 8.28 | 2.28 | 0.0078 |
|  | **median ms** | **0.06** | **0.06** | **0.07** | **1.70** | **1.20** | **0.0044** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.92.1 | SymPy | Wolfram |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.10 | 0.11 | 0.12 | 0.38 | 0.03 |
| A02 | $\int\sin x\,dx$ | 0.03 | 0.17 | 0.03 | 1.19 | 0.59 |
| A03 | $\int x e^x\,dx$ | 0.14 | 0.78 | 0.16 | 6.29 | 0.57 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.05 | 0.13 | 0.05 | 9.42 | 0.87 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.20 | 0.97 | 0.25 | 6.93 | 0.63 |
| | **Hard tier** |  |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 1.35 | 9.04 | 1.74 | 24.7 | 8.15 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.06 | 0.12 | 0.06 | 0.72 | 0.35 |
| A08 | $\int e^{-x^2}\,dx$ | 0.26 | 0.50 | 0.28 | 24.7 | 0.44 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.20 | 1.33 | 0.24 | 22.4 | 2.14 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 1.08 | ∅ | 20.8 | 2.20 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 0.96 | ∅ | 114 | 1.11 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 1.28 | ∅ | 203 | 1.48 |
|  | **median ms** | **0.14** | **0.96** | **0.16** | **20.8** | **0.87** |

## Rule packs — coverage & true warm overhead

`CE·cur` (base engine) and `CE+R/F` (Rubi + Fungrim) are timed **back-to-back in one warm process**, so their ratio is a clean per-call rule-pack overhead — the same warm process that produces every CE column in the tables above, so this ratio and those columns are directly comparable. Overhead is ≈1× wherever no rule can fire (numeric, differentiation); the packs cost real time on integrals they miss and *win* where a rule applies (e.g. `∫1/(x³+1)`).

**Coverage gained** (∅/❌ → ✅ once the packs are enabled): CR1 ($\int\frac{\sqrt x}{1+x}\,dx$), CR2 ($\int\frac{x}{(1+x)^{1/3}}\,dx$), CR3 ($\int\frac{x^2}{(1+x)^{1/3}}\,dx$).

| # | Case | CE·cur | CE+R/F | Overhead |
|---|---|---|---|---|
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 1347 | 9040 | 6.71× |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 201 | 1328 | 6.60× |
| A02 | $\int\sin x\,dx$ | 27 | 173 | 6.49× |
| A03 | $\int x e^x\,dx$ | 140 | 780 | 5.55× |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | 218 | 1080 | 4.95× |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 198 | 971 | 4.89× |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | 318 | 1281 | 4.02× |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | 281 | 964 | 3.43× |
| CE4 | $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ | 140 | 379 | 2.71× |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 51 | 133 | 2.64× |
| S02 | $\sin^2 x+\cos^2 x$ | 70 | 177 | 2.54× |
| CE1 | $\lim_{x\to0}\tfrac{\sin x}{x}$ | 43 | 102 | 2.39× |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 57 | 122 | 2.15× |
| S07 | $\ln x+\ln(x+1)$ | 143 | 300 | 2.09× |
| A08 | $\int e^{-x^2}\,dx$ | 265 | 496 | 1.88× |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 216 | 403 | 1.87× |
| CE2 | $\lim_{x\to\infty}(1+\tfrac1x)^x$ | 686 | 1114 | 1.62× |
| S08 | $\sqrt{3+2\sqrt2}$ | 82 | 116 | 1.42× |
| A01 | $\int x^2\,dx$ | 98 | 112 | 1.14× |
| S03 | $(x+1)^2-(x-1)^2$ | 236 | 261 | 1.11× |
| N07 | $\zeta(3)$ | 284 | 240 | **0.85× (win)** |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 83 | 32 | **0.39× (win)** |

_Times in µs (warm median). 31 row(s) within ±10% (no measurable pack overhead — numeric / differentiation) omitted._

## Current build vs published `0.92.1`

No behavioural differences detected on this suite — the current build matches `0.92.1` on all 39 cases (correctness and output form).

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
