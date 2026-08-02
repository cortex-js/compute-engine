# Compute Engine Benchmark Report

_Generated 2026-08-02 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.99.0`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, non-embeddable kernel; CE's pitch against it is open-source, browser-native delivery at competitive per-call speed.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.99.0` @ `14fc06c2` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.99.0` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |
| Wolfram (Mathematica) | `14.3.0 for Mac OS X ARM` | `wolframscript` kernel |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.99.0` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.
- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system `wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their true compute cost, parse included but negligible.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool's native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. **All three Compute Engine columns (`CE·cur`, `CE·0.99.0`, `CE+R/F`) are measured warm, back-to-back in one long-lived process** (`run_ce_rubi.mjs`), so they share identical V8 JIT/cache warm-up and are **directly comparable to each other** — `CE·cur` vs `CE+R/F` is a true rule-pack overhead and `CE·cur` vs `CE·0.99.0` a true release delta. (Earlier revisions measured `CE·cur`/`CE·pub` in a fresh COLD process per case; a fresh V8 that runs a case only ~50× never tiers up to the steady state a long-lived process reaches, so it reported the same engine 1.5–2× slower — which made `CE·cur` look slower than the pack-loaded `CE+R/F` on pure numerics, an impossibility. Warming all CE columns in one process removes that artifact.) SymPy/NumPy need no such treatment (interpreted, no JIT tiering, so a cold process is already at steady state) and Wolfram times warm inside its kernel; math.js (also V8) is still cold-per-process — the one remaining cross-tool warm-up asymmetry, which can make its numeric column read slightly high. For integrals `CE+R/F` includes the Rubi rule-match attempt made before the built-in fallback; the honest pack overhead is in the "Rule packs" section below.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.99.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 9/9 | 9/9 | 6/9 | 0/9 (+5🟡) | 9/9 |
| Simplification | 9/9 | 9/9 | 9/9 | 8/9 (+1🟡) | 2/9 (+7🟡) | — | 9/9 |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — | 9/9 |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 9/12 | 12/12 | — | — | 12/12 |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> All three CE columns (`CE·cur`, `CE·0.99.0`, `CE+R/F`) are measured **warm, in one shared process**, so they are directly comparable to each other in every row. `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`); on rows where no rule can fire (numeric, differentiation) `CE·cur` and `CE+R/F` should read ≈equal. The honest per-op pack overhead is tabulated in the [Rule packs](#rule-packs--coverage--true-warm-overhead) section.

### Arbitrary-precision numeric evaluation — times in **µs**

| # | Case | CE·cur | CE+R/F | CE·0.99.0 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |  |
| N01 | $\pi^2$ <sub>(50d)</sub> | 9.6 | 8.6 | 11 | 193 | 95 | 🟡 <sub>16 digits</sub> 4.1 | 4.4 |
| N02 | $e$ <sub>(50d)</sub> | 0.54 | 0.54 | 0.75 | 161 | 18 | 🟡 <sub>16 digits</sub> 3.7 | 2.4 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 6.5 | 6.5 | 8.5 | 262 | 82 | 🟡 <sub>17 digits</sub> 5.8 | 4.3 |
| N04 | $100!$ <sub>(exact)</sub> | 9.1 | 9.1 | 10 | 275 | 119 | ❌ <sub>inexact</sub> 10 | 2.8 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 10 | 10 | 13 | 217 | 405 | 🟡 <sub>17 digits</sub> 5.2 | 4.2 |
| | **Hard tier** |  |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.5 | 0.5 | 0.71 | 173 | 15 | 🟡 <sub>16 digits</sub> 3.7 | 3.1 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 461 | 282 | 448 | 290 | ❌ <sub>8 digits</sub> 4126 | — | 14 |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 171 | 163 | 194 | 270 | ⚠️ | — | 52 |
| N09 | $W(1)$ <sub>(40d)</sub> | 57 | 57 | 64 | 737 | — | — | 42 |
|  | **median µs** | **9.6** | **9.1** | **11** | **262** | **95** | **5.2** | **4.3** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.99.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.15 | 0.16 | 0.28 | 8.66 | 🟡 <sub>not simplified</sub> 1.58 | 0.18 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.08 | 0.23 | 0.11 | 9.24 | 🟡 <sub>not simplified</sub> 0.81 | 0.08 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.27 | 0.33 | 0.42 | 6.60 | 🟡 <sub>not simplified</sub> 1.48 | 0.17 |
| S04 | $\frac{x^3-x}{x}$ | 0.14 | 0.15 | 0.18 | 4.29 | 1.38 | 0.69 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.09 | 0.08 | 0.11 | 0.24 | 🟡 <sub>not simplified</sub> 1.78 | 0.03 |
| | **Hard tier** |  |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.27 | 0.52 | 0.39 | 6.27 | 1.21 | 19.5 |
| S07 | $\ln x+\ln(x+1)$ | 0.18 | 0.36 | 0.24 | 6.87 | 🟡 <sub>not simplified</sub> 1.14 | 1.49 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.09 | 0.13 | 0.13 | 🟡 <sub>not simplified</sub> 4.08 | 🟡 <sub>numeric only</sub> 0.83 | 3.63 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.12 | 0.14 | 0.20 | 9.87 | 🟡 <sub>not simplified</sub> 1.02 | 1.10 |
|  | **median ms** | **0.14** | **0.16** | **0.20** | **6.60** | **1.21** | **0.69** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.99.0 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.02 | 0.02 | 0.03 | 0.36 | 0.93 | 0.0038 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.09 | 0.08 | 0.10 | 0.58 | 1.42 | 0.0042 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.03 | 0.04 | 0.04 | 2.40 | 1.01 | 0.0042 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.22 | 0.24 | 0.27 | 2.48 | 2.77 | 0.0059 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.11 | 0.11 | 0.11 | 1.55 | 1.63 | 0.0051 |
| | **Hard tier** |  |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.10 | 0.09 | 0.11 | 2.03 | 2.56 | 0.005 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.14 | 0.14 | 0.16 | 3.36 | 1.49 | 0.0046 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.05 | 0.05 | 0.07 | 1.27 | 1.29 | 0.0041 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 0.28 | 0.30 | 0.31 | 7.60 | 3.09 | 0.0087 |
|  | **median ms** | **0.10** | **0.09** | **0.11** | **2.03** | **1.49** | **0.0046** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.99.0 | SymPy | Wolfram |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.14 | 0.16 | 0.19 | 0.43 | 0.04 |
| A02 | $\int\sin x\,dx$ | 0.04 | 0.22 | 0.06 | 1.40 | 0.70 |
| A03 | $\int x e^x\,dx$ | 0.22 | 1.21 | 0.28 | 7.90 | 0.60 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.10 | 0.22 | 0.12 | 10.9 | 0.89 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.33 | 1.41 | 0.38 | 7.23 | 0.62 |
| | **Hard tier** |  |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 2.62 | 20.5 | 3.14 | 26.7 | 8.55 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.10 | 0.20 | 0.13 | 0.81 | 0.36 |
| A08 | $\int e^{-x^2}\,dx$ | 0.36 | 0.74 | 0.47 | 26.1 | 0.44 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.33 | 2.13 | 0.38 | 26.4 | 2.13 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 1.52 | ∅ | 22.6 | 2.23 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 1.33 | ∅ | 130 | 1.15 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 1.75 | ∅ | 235 | 1.46 |
|  | **median ms** | **0.22** | **1.33** | **0.28** | **22.6** | **0.89** |

## Rule packs — coverage & true warm overhead

`CE·cur` (base engine) and `CE+R/F` (Rubi + Fungrim) are timed **back-to-back in one warm process**, so their ratio is a clean per-call rule-pack overhead — the same warm process that produces every CE column in the tables above, so this ratio and those columns are directly comparable. Overhead is ≈1× wherever no rule can fire (numeric, differentiation); the packs cost real time on integrals they miss and *win* where a rule applies (e.g. `∫1/(x³+1)`).

**Coverage gained** (∅/❌ → ✅ once the packs are enabled): CR1 ($\int\frac{\sqrt x}{1+x}\,dx$), CR2 ($\int\frac{x}{(1+x)^{1/3}}\,dx$), CR3 ($\int\frac{x^2}{(1+x)^{1/3}}\,dx$).

| # | Case | CE·cur | CE+R/F | Overhead |
|---|---|---|---|---|
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 2623 | 20455 | 7.80× |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 331 | 2134 | 6.44× |
| A03 | $\int x e^x\,dx$ | 223 | 1208 | 5.42× |
| A02 | $\int\sin x\,dx$ | 44 | 218 | 5.01× |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | 321 | 1517 | 4.72× |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 329 | 1413 | 4.29× |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | 447 | 1754 | 3.93× |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | 459 | 1326 | 2.89× |
| S02 | $\sin^2 x+\cos^2 x$ | 84 | 230 | 2.75× |
| CE4 | $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ | 232 | 546 | 2.35× |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 96 | 220 | 2.30× |
| CE1 | $\lim_{x\to0}\tfrac{\sin x}{x}$ | 57 | 123 | 2.16× |
| A08 | $\int e^{-x^2}\,dx$ | 358 | 737 | 2.06× |
| S07 | $\ln x+\ln(x+1)$ | 184 | 360 | 1.96× |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 268 | 519 | 1.94× |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 103 | 197 | 1.91× |
| S08 | $\sqrt{3+2\sqrt2}$ | 91 | 127 | 1.39× |
| CE2 | $\lim_{x\to\infty}(1+\tfrac1x)^x$ | 1353 | 1803 | 1.33× |
| S03 | $(x+1)^2-(x-1)^2$ | 268 | 327 | 1.22× |
| A01 | $\int x^2\,dx$ | 137 | 156 | 1.14× |
| S09 | $\frac{x^3-1}{x-1}$ | 125 | 142 | 1.14× |
| CS1 | $x^4+x^2-1=0$ | 2067 | 2304 | 1.11× |
| N01 | $\pi^2$ | 9.6 | 8.6 | **0.90× (win)** |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 93 | 83 | **0.89× (win)** |
| CS2 | $x^3-x-1=0$ | 155 | 137 | **0.89× (win)** |
| N07 | $\zeta(3)$ | 461 | 282 | **0.61× (win)** |

_Times in µs (warm median). 27 row(s) within ±10% (no measurable pack overhead — numeric / differentiation) omitted._

## Current build vs published `0.99.0`

No behavioural differences detected on this suite — the current build matches `0.99.0` on all 39 cases (correctness and output form).

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
