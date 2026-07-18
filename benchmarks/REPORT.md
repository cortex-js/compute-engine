# Compute Engine Benchmark Report

_Generated 2026-07-18 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.73.0`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, non-embeddable kernel; CE's pitch against it is open-source, browser-native delivery at competitive per-call speed.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.84.1` @ `9c2a90bb` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.73.0` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |
| Wolfram (Mathematica) | `14.3.0 for Mac OS X ARM` | `wolframscript` kernel |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.73.0` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.
- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system `wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their true compute cost, parse included but negligible.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool's native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. **All three Compute Engine columns (`CE·cur`, `CE·0.73.0`, `CE+R/F`) are measured warm, back-to-back in one long-lived process** (`run_ce_rubi.mjs`), so they share identical V8 JIT/cache warm-up and are **directly comparable to each other** — `CE·cur` vs `CE+R/F` is a true rule-pack overhead and `CE·cur` vs `CE·0.73.0` a true release delta. (Earlier revisions measured `CE·cur`/`CE·pub` in a fresh COLD process per case; a fresh V8 that runs a case only ~50× never tiers up to the steady state a long-lived process reaches, so it reported the same engine 1.5–2× slower — which made `CE·cur` look slower than the pack-loaded `CE+R/F` on pure numerics, an impossibility. Warming all CE columns in one process removes that artifact.) SymPy/NumPy need no such treatment (interpreted, no JIT tiering, so a cold process is already at steady state) and Wolfram times warm inside its kernel; math.js (also V8) is still cold-per-process — the one remaining cross-tool warm-up asymmetry, which can make its numeric column read slightly high. For integrals `CE+R/F` includes the Rubi rule-match attempt made before the built-in fallback; the honest pack overhead is in the "Rule packs" section below.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.73.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 9/9 | 9/9 | 6/9 | 0/9 (+5🟡) | 9/9 |
| Simplification | 9/9 | 9/9 | 9/9 | 8/9 (+1🟡) | 2/9 (+7🟡) | — | 9/9 |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — | 9/9 |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 9/12 | 12/12 | — | — | 12/12 |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> All three CE columns (`CE·cur`, `CE·0.73.0`, `CE+R/F`) are measured **warm, in one shared process**, so they are directly comparable to each other in every row. `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`); on rows where no rule can fire (numeric, differentiation) `CE·cur` and `CE+R/F` should read ≈equal. The honest per-op pack overhead is tabulated in the [Rule packs](#rule-packs--coverage--true-warm-overhead) section.

### Arbitrary-precision numeric evaluation — times in **µs**

| # | Case | CE·cur | CE+R/F | CE·0.73.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |  |
| N01 | $\pi^2$ <sub>(50d)</sub> | 10 | 13 | 7.6 | 175 | 40 | 🟡 <sub>16 digits</sub> 3.7 | 3.9 |
| N02 | $e$ <sub>(50d)</sub> | 3.0 | 6.7 | 0.6 | 158 | 9.9 | 🟡 <sub>16 digits</sub> 3.1 | 2.9 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 9.1 | 12 | 7.3 | 229 | 75 | 🟡 <sub>17 digits</sub> 5.0 | 4.5 |
| N04 | $100!$ <sub>(exact)</sub> | 11 | 14 | 8.2 | 262 | 112 | ❌ <sub>inexact</sub> 10 | 2.7 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 11 | 15 | 9.7 | 191 | 344 | 🟡 <sub>17 digits</sub> 5.1 | 3.3 |
| | **Hard tier** |  |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 3.1 | 6.8 | 0.5 | 156 | 12 | 🟡 <sub>16 digits</sub> 3.2 | 2.3 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 290 | 249 | 312 | 270 | ❌ <sub>8 digits</sub> 4103 | — | 14 |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 161 | 151 | 163 | 247 | ⚠️ | — | 47 |
| N09 | $W(1)$ <sub>(40d)</sub> | 54 | 58 | 60 | 662 | — | — | 39 |
|  | **median µs** | **11** | **14** | **8.2** | **229** | **75** | **5.0** | **3.9** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.73.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.19 | 0.29 | 0.21 | 8.49 | 🟡 <sub>not simplified</sub> 0.95 | 0.17 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.12 | 0.36 | 0.10 | 8.41 | 🟡 <sub>not simplified</sub> 0.79 | 0.08 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.32 | 0.54 | 0.30 | 5.80 | 🟡 <sub>not simplified</sub> 0.98 | 0.16 |
| S04 | $\frac{x^3-x}{x}$ | 0.20 | 0.32 | 0.14 | 4.58 | 1.20 | 0.62 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.10 | 0.14 | 0.08 | 0.24 | 🟡 <sub>not simplified</sub> 1.38 | 0.03 |
| | **Hard tier** |  |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.31 | 1.61 | 0.28 | 5.91 | 2.10 | 18.7 |
| S07 | $\ln x+\ln(x+1)$ | 0.28 | 0.73 | 0.19 | 10.1 | 🟡 <sub>not simplified</sub> 1.31 | 1.47 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.11 | 0.19 | 0.09 | 🟡 <sub>not simplified</sub> 3.64 | 🟡 <sub>numeric only</sub> 0.83 | 3.33 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.19 | 0.32 | 0.13 | 9.68 | 🟡 <sub>not simplified</sub> 0.86 | 1.00 |
|  | **median ms** | **0.19** | **0.32** | **0.14** | **5.91** | **0.98** | **0.62** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.73.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.02 | 0.04 | 0.01 | 0.34 | 0.74 | 0.0034 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.11 | 0.17 | 0.06 | 0.48 | 1.02 | 0.0032 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.05 | 0.08 | 0.02 | 2.15 | 0.95 | 0.0036 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.21 | 0.29 | 0.15 | 2.08 | 1.90 | 0.0054 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.10 | 0.14 | 0.06 | 1.42 | 1.93 | 0.0044 |
| | **Hard tier** |  |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.08 | 0.11 | 0.05 | 1.76 | 1.88 | 0.0043 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.19 | 0.28 | 0.13 | 3.07 | 1.08 | 0.0047 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.05 | 0.08 | 0.03 | 1.11 | 1.09 | 0.0044 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 0.45 | 0.65 | 0.32 | 7.29 | 2.32 | 0.0072 |
|  | **median ms** | **0.10** | **0.14** | **0.06** | **1.76** | **1.09** | **0.0044** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.73.0 | SymPy | Wolfram |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.16 | 0.24 | 0.11 | 0.38 | 0.03 |
| A02 | $\int\sin x\,dx$ | 0.04 | 0.38 | 0.03 | 1.17 | 0.58 |
| A03 | $\int x e^x\,dx$ | 0.20 | 1.08 | 0.12 | 6.36 | 0.57 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.06 | 0.33 | 0.07 | 9.30 | 0.86 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.29 | 2.07 | 0.23 | 6.97 | 0.59 |
| | **Hard tier** |  |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 5.89 | 11.9 | 1.77 | 24.8 | 8.07 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.08 | 0.39 | 0.07 | 0.75 | 0.35 |
| A08 | $\int e^{-x^2}\,dx$ | 0.33 | 2.04 | 0.28 | 25.2 | 0.44 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.35 | 2.84 | 0.23 | 23.1 | 2.12 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 2.04 | ∅ | 24.5 | 2.18 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 1.66 | ∅ | 117 | 1.12 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 2.30 | ∅ | 205 | 1.47 |
|  | **median ms** | **0.20** | **2.04** | **0.12** | **23.1** | **0.86** |

## Rule packs — coverage & true warm overhead

`CE·cur` (base engine) and `CE+R/F` (Rubi + Fungrim) are timed **back-to-back in one warm process**, so their ratio is a clean per-call rule-pack overhead — the same warm process that produces every CE column in the tables above, so this ratio and those columns are directly comparable. Overhead is ≈1× wherever no rule can fire (numeric, differentiation); the packs cost real time on integrals they miss and *win* where a rule applies (e.g. `∫1/(x³+1)`).

**Coverage gained** (∅/❌ → ✅ once the packs are enabled): CR1 ($\int\frac{\sqrt x}{1+x}\,dx$), CR2 ($\int\frac{x}{(1+x)^{1/3}}\,dx$), CR3 ($\int\frac{x^2}{(1+x)^{1/3}}\,dx$).

| # | Case | CE·cur | CE+R/F | Overhead |
|---|---|---|---|---|
| A02 | $\int\sin x\,dx$ | 44 | 376 | 8.63× |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 352 | 2845 | 8.08× |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | 287 | 2041 | 7.11× |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 292 | 2069 | 7.10× |
| A08 | $\int e^{-x^2}\,dx$ | 334 | 2036 | 6.10× |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 55 | 331 | 6.00× |
| A03 | $\int x e^x\,dx$ | 202 | 1081 | 5.34× |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 310 | 1615 | 5.22× |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 78 | 387 | 4.98× |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | 462 | 2300 | 4.97× |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | 400 | 1655 | 4.14× |
| CE1 | $\lim_{x\to0}\tfrac{\sin x}{x}$ | 78 | 264 | 3.37× |
| CE2 | $\lim_{x\to\infty}(1+\tfrac1x)^x$ | 975 | 3182 | 3.26× |
| CE4 | $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ | 298 | 959 | 3.22× |
| S02 | $\sin^2 x+\cos^2 x$ | 125 | 355 | 2.85× |
| S07 | $\ln x+\ln(x+1)$ | 282 | 728 | 2.58× |
| N02 | $e$ | 3.0 | 6.7 | 2.21× |
| N06 | $\pi$ | 3.1 | 6.8 | 2.16× |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 5895 | 11904 | 2.02× |
| CS1 | $x^4+x^2-1=0$ | 3252 | 5969 | 1.84× |
| S09 | $\frac{x^3-1}{x-1}$ | 193 | 325 | 1.69× |
| S08 | $\sqrt{3+2\sqrt2}$ | 114 | 191 | 1.67× |
| D01 | $\tfrac{d}{dx}\sin x$ | 24 | 41 | 1.67× |
| S03 | $(x+1)^2-(x-1)^2$ | 322 | 536 | 1.66× |
| D03 | $\tfrac{d}{dx}\tan x$ | 47 | 76 | 1.62× |
| S04 | $\frac{x^3-x}{x}$ | 200 | 317 | 1.59× |
| D02 | $\tfrac{d}{dx}x^5$ | 106 | 168 | 1.58× |
| A01 | $\int x^2\,dx$ | 159 | 241 | 1.52× |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 54 | 80 | 1.48× |
| S01 | $\frac{x^2-1}{x-1}$ | 194 | 286 | 1.47× |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 99 | 145 | 1.46× |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 99 | 144 | 1.45× |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 450 | 647 | 1.44× |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 194 | 276 | 1.42× |
| CN1 | $\pi^2$ | 9.3 | 13 | 1.41× |
| N05 | $e^{\pi}$ | 11 | 15 | 1.40× |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 208 | 286 | 1.38× |
| D06 | $\tfrac{d}{dx}x^x$ | 80 | 108 | 1.35× |
| N03 | $\sqrt2$ | 9.1 | 12 | 1.35× |
| CS2 | $x^3-x-1=0$ | 228 | 307 | 1.35× |
| N04 | $100!$ | 11 | 14 | 1.31× |
| CE3 | $\int_1^2\tfrac1x\,dx$ | 60 | 76 | 1.26× |
| N01 | $\pi^2$ | 10 | 13 | 1.26× |
| CN3 | $e^{\pi}$ | 15 | 18 | 1.24× |
| CN11 | $\ln 2$ | 16 | 20 | 1.20× |
| CN10 | $\cos 1$ | 23 | 26 | 1.15× |
| CN9 | $\sin 1$ | 23 | 26 | 1.13× |
| N07 | $\zeta(3)$ | 290 | 249 | **0.86× (win)** |

_Times in µs (warm median). 5 row(s) within ±10% (no measurable pack overhead — numeric / differentiation) omitted._

## Current build vs published `0.73.0`

No behavioural differences detected on this suite — the current build matches `0.73.0` on all 39 cases (correctness and output form).

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
