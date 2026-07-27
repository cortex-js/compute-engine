# Compute Engine Benchmark Report

_Generated 2026-07-27 · 39 cases across 4 capabilities._

This report compares the **current Compute Engine build** against the **last published release** (`0.95.1`) — plus an experimental **current + Rubi + Fungrim** configuration — and against three widely-used open-source tools (SymPy, math.js, NumPy) and the commercial **Wolfram** (Mathematica) kernel, along two axes: **correctness / usefulness** of the result and **performance**.

## Highlights

- **No regressions** vs the published build across all 39 cases.
- **Compute Engine answers 36/39** out of the box — the only library here delivering arbitrary-precision numerics (incl. ζ, Γ, Lambert W) *and* symbolic integration in one browser-native package. Its weak spot is integration coverage; **enabling the experimental Rubi + Fungrim rules lifts it to 39/39** (`∫1/√x`, `∫x/√(1−x²)` solve; `∫1/(x³+1)` gains exact coefficients).
- **vs competitors**: matches SymPy on numerics, simplification and differentiation; trails it on integration breadth (SymPy does `∫e^(−x²)`→erf and radical denesting that CE doesn't). Beats **math.js** on simplification and integration, and beats **NumPy** on anything needing >16 digits, exact integers, or special functions. **Wolfram** is the capability ceiling here — it answers every category, including the integrals CE needs Rubi for — but ships as a proprietary, non-embeddable kernel; CE's pitch against it is open-source, browser-native delivery at competitive per-call speed.

## Environment

| Tool | Version | Runtime |
|---|---|---|
| Compute Engine — current build | `0.95.1` @ `eb20b9ef` (freshly built from `src/`) | Node v22.13.1 |
| Compute Engine — current + Rubi + Fungrim | same minified bundle + published `integration-rules` (Rubi) + `identities` (Fungrim) packs | Node v22.13.1 |
| Compute Engine — published | `0.95.1` (npm) | Node v22.13.1 |
| SymPy | `1.14.0` | Python 3.14.2 |
| math.js | `15.2.0` | Node v22.13.1 |
| NumPy | `2.4.2` | Python 3.14.2 |
| Wolfram (Mathematica) | `14.3.0 for Mac OS X ARM` | `wolframscript` kernel |

## Methodology

- **Suite**: 39 cases across 4 categories, split into a **core** tier (textbook) and a **hard** tier (boundary-pushing), defined once in [`cases.json`](./cases.json) with a per-tool input expression for each tool.
- **Columns**: the current build and published `0.95.1` are compared as base engines; a third CE column (`CE+R/F`) is the current build with the experimental **Rubi** integrator and **Fungrim** identities enabled. SymPy, math.js, NumPy and Wolfram are the competitors.
- **Wolfram** has no source dialect in `cases.json`; its runner translates the structural `ce` MathJSON into a Wolfram Language string (`["Power","x",2]`→`x^2`, `["Ln",2]`→`Log[2]`), which it **parses each call** (`ToExpression`) before driving the system `wolframscript` kernel (`N`, `FullSimplify`, `D`, `Integrate`, `Limit`, `Solve`) — so, like the other string-based tools, the per-call parse is included (see the Performance note). Timing is measured **inside** the kernel (warm median, same protocol as the other tools), so the multi-second kernel start-up is excluded. Wolfram memoizes the result of every evaluation, which would otherwise make a repeat-loop measure ~25ns cache hits; the runner **disables the result caches** (`SetSystemOptions`) so each call does real work. Fundamental constants (π, e, factorials) are *stored* by the kernel — their lookup is ~0.1µs even uncached (genuinely how fast Wolfram is on them), so their reported time (~3µs) is dominated by parsing the source; Γ/ζ and the symbolic ops show their true compute cost, parse included but negligible.
- **Correctness is verified numerically against an independent reference.** Reference values are computed with `mpmath` at high precision ([`gen_cases.py`](./gen_cases.py)) — *not* taken from any tool under test:
  - *Numeric*: the tool's decimal output is compared digit-by-digit; we report how many leading significant digits match.
  - *Simplify*: the result is sampled at 3 points (chosen in the expression's domain) and compared to the original expression's value; a result is **correct** only if it both matches numerically **and** actually changed the expression, otherwise **partial** ("value ok, not simplified").
  - *Derivative*: the result is sampled and compared to `f'(x)` (computed by `mpmath`).
  - *Antiderivative*: verified by the definite difference `F(b)−F(a)` over a per-case interval (inside the integrand's domain), which cancels the constant of integration and is compared to `∫f` (`mpmath` quadrature).
- **Performance**: each operation is built **from its own source representation each call** and run repeatedly; we report the **median** wall-clock time per call (warm/steady-state, after warm-up), shown alongside the quality mark in each cell. Process start-up is excluded. The source form differs per tool — CE re-boxes its **MathJSON**, SymPy/NumPy re-parse a **Python** string (`sympify`/`eval`), math.js and Wolfram re-parse their own **language string** — so the per-call cost includes each tool's native build/parse. That structured-vs-text gap is real (boxing MathJSON or compiling a NumPy expression is cheaper than a full CAS text-parse) and is why the µs-scale numeric column should be read as *end-to-end per-call from source*, not pure kernel compute; at the fastest end (a stored constant) the number is parse-dominated. **All three Compute Engine columns (`CE·cur`, `CE·0.95.1`, `CE+R/F`) are measured warm, back-to-back in one long-lived process** (`run_ce_rubi.mjs`), so they share identical V8 JIT/cache warm-up and are **directly comparable to each other** — `CE·cur` vs `CE+R/F` is a true rule-pack overhead and `CE·cur` vs `CE·0.95.1` a true release delta. (Earlier revisions measured `CE·cur`/`CE·pub` in a fresh COLD process per case; a fresh V8 that runs a case only ~50× never tiers up to the steady state a long-lived process reaches, so it reported the same engine 1.5–2× slower — which made `CE·cur` look slower than the pack-loaded `CE+R/F` on pure numerics, an impossibility. Warming all CE columns in one process removes that artifact.) SymPy/NumPy need no such treatment (interpreted, no JIT tiering, so a cold process is already at steady state) and Wolfram times warm inside its kernel; math.js (also V8) is still cold-per-process — the one remaining cross-tool warm-up asymmetry, which can make its numeric column read slightly high. For integrals `CE+R/F` includes the Rubi rule-match attempt made before the built-in fallback; the honest pack overhead is in the "Rule packs" section below.
- Each `(tool, case)` runs in its own subprocess with a 20s timeout, so a hang or crash is isolated to one cell.

## Summary scoreboard

Correct (✅) results per category (count varies by category). Cells in parentheses count 🟡 partials.

| Category | CE·cur | CE+R/F | CE·0.95.1 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|
| Arbitrary-precision numeric evaluation | 9/9 | 9/9 | 9/9 | 9/9 | 6/9 | 0/9 (+5🟡) | 9/9 |
| Simplification | 9/9 | 9/9 | 9/9 | 8/9 (+1🟡) | 2/9 (+7🟡) | — | 9/9 |
| Differentiation | 9/9 | 9/9 | 9/9 | 9/9 | 9/9 | — | 9/9 |
| Antiderivation (symbolic integration) | 9/12 | 12/12 | 9/12 | 12/12 | — | — | 12/12 |

## Results — quality & speed

**Correctness is assumed:** a correct result shows only its **median time per call** (warm) — in **ms**, except the numeric table which is in **µs** (its per-call times run from ~0.1µs for a stored constant to a few hundred µs). A mark appears *only when a result is not fully correct*: 🟡 partial (limited precision, or value-correct but not simplified) · ❌ incorrect · ∅ returned unevaluated · — not supported · ⏱ timeout. **Bold** flags a Compute Engine outlier — the shipping `CE·cur` build being incorrect, or markedly slower than the fastest competitor on that row. Cases split into a **core** tier (textbook) and a **hard** tier (boundary-pushers).

> All three CE columns (`CE·cur`, `CE·0.95.1`, `CE+R/F`) are measured **warm, in one shared process**, so they are directly comparable to each other in every row. `CE+R/F` (current minified bundle + the opt-in Rubi + Fungrim rule packs, loaded once via `loadIntegrationRules` / `loadIdentities`) **tries matching ~2,647 Rubi rules** before falling back to the built-in integrator — so its integral times include that match attempt even when no rule applies (e.g. `∫xeˣ`); on rows where no rule can fire (numeric, differentiation) `CE·cur` and `CE+R/F` should read ≈equal. The honest per-op pack overhead is tabulated in the [Rule packs](#rule-packs--coverage--true-warm-overhead) section.

### Arbitrary-precision numeric evaluation — times in **µs**

| # | Case | CE·cur | CE+R/F | CE·0.95.1 | SymPy | math.js | NumPy | Wolfram |
|---|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |  |
| N01 | $\pi^2$ <sub>(50d)</sub> | 8.4 | 8.1 | 9.5 | 175 | 106 | 🟡 <sub>16 digits</sub> 3.6 | 3.8 |
| N02 | $e$ <sub>(50d)</sub> | 0.5 | 0.5 | 0.67 | 156 | 16 | 🟡 <sub>16 digits</sub> 3.1 | 2.9 |
| N03 | $\sqrt2$ <sub>(50d)</sub> | 5.9 | 6.0 | 7.6 | 225 | 73 | 🟡 <sub>17 digits</sub> 5.0 | 4.4 |
| N04 | $100!$ <sub>(exact)</sub> | 8.6 | 8.6 | 9.2 | 246 | 108 | ❌ <sub>inexact</sub> 10 | 2.7 |
| N05 | $e^{\pi}$ <sub>(40d)</sub> | 9.3 | 8.9 | 11 | 192 | 368 | 🟡 <sub>17 digits</sub> 4.7 | 3.9 |
| | **Hard tier** |  |  |  |  |  |  |  |
| N06 | $\pi$ <sub>(200d)</sub> | 0.48 | 0.46 | 0.63 | 161 | 11 | 🟡 <sub>16 digits</sub> 3.2 | 3.0 |
| N07 | $\zeta(3)$ <sub>(40d)</sub> | 275 | 244 | 296 | 278 | ❌ <sub>8 digits</sub> 3329 | — | 13 |
| N08 | $\Gamma(\tfrac13)$ <sub>(40d)</sub> | 155 | 143 | 163 | 240 | ⚠️ | — | 46 |
| N09 | $W(1)$ <sub>(40d)</sub> | 51 | 50 | 59 | 661 | — | — | 39 |
|  | **median µs** | **8.6** | **8.6** | **9.5** | **225** | **106** | **4.7** | **3.9** |

### Simplification

| # | Case | CE·cur | CE+R/F | CE·0.95.1 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| S01 | $\frac{x^2-1}{x-1}$ | 0.13 | 0.13 | 0.25 | 8.10 | 🟡 <sub>not simplified</sub> 0.90 | 0.17 |
| S02 | $\sin^2 x+\cos^2 x$ | 0.08 | 0.19 | 0.10 | 8.28 | 🟡 <sub>not simplified</sub> 0.89 | 0.08 |
| S03 | $(x+1)^2-(x-1)^2$ | 0.22 | 0.26 | 0.36 | 5.73 | 🟡 <sub>not simplified</sub> 1.26 | 0.16 |
| S04 | $\frac{x^3-x}{x}$ | 0.11 | 0.12 | 0.18 | 4.07 | 1.47 | 0.61 |
| S05 | $x^{-1/2}-\frac{1}{\sqrt x}$ | 0.07 | 0.07 | 0.11 | 0.23 | 🟡 <sub>not simplified</sub> 1.22 | 0.03 |
| | **Hard tier** |  |  |  |  |  |  |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 0.22 | 0.41 | 0.39 | 5.55 | 1.01 | 17.5 |
| S07 | $\ln x+\ln(x+1)$ | 0.16 | 0.31 | 0.23 | 6.16 | 🟡 <sub>not simplified</sub> 1.08 | 1.37 |
| S08 | $\sqrt{3+2\sqrt2}$ | 0.08 | 0.12 | 0.12 | 🟡 <sub>not simplified</sub> 3.36 | 🟡 <sub>numeric only</sub> 0.80 | 3.29 |
| S09 | $\frac{x^3-1}{x-1}$ | 0.11 | 0.12 | 0.19 | 8.69 | 🟡 <sub>not simplified</sub> 0.92 | 1.00 |
|  | **median ms** | **0.11** | **0.13** | **0.19** | **5.73** | **1.01** | **0.61** |

### Differentiation

| # | Case | CE·cur | CE+R/F | CE·0.95.1 | SymPy | math.js | Wolfram |
|---|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |  |
| D01 | $\tfrac{d}{dx}\sin x$ | 0.02 | 0.02 | 0.01 | 0.33 | 0.58 | 0.0028 |
| D02 | $\tfrac{d}{dx}x^5$ | 0.07 | 0.07 | 0.08 | 0.50 | 1.04 | 0.0037 |
| D03 | $\tfrac{d}{dx}\tan x$ | 0.03 | 0.03 | 0.03 | 2.12 | 0.72 | 0.0036 |
| D04 | $\tfrac{d}{dx}x^2\sin x$ | 0.18 | 0.19 | 0.20 | 2.01 | 1.73 | 0.0055 |
| D05 | $\tfrac{d}{dx}\sin(x^2)$ | 0.08 | 0.08 | 0.07 | 1.40 | 1.29 | 0.0045 |
| | **Hard tier** |  |  |  |  |  |  |
| D06 | $\tfrac{d}{dx}x^x$ | 0.08 | 0.08 | 0.07 | 1.71 | 1.66 | 0.0049 |
| D07 | $\tfrac{d}{dx}\arcsin x$ | 0.11 | 0.11 | 0.12 | 2.87 | 1.06 | 0.0047 |
| D08 | $\tfrac{d}{dx}\ln(\sin x)$ | 0.05 | 0.05 | 0.05 | 1.09 | 1.11 | 0.0043 |
| D09 | $\tfrac{d}{dx}\sqrt{1-x^2}$ | 0.23 | 0.23 | 0.24 | 6.36 | 2.07 | 0.0079 |
|  | **median ms** | **0.08** | **0.08** | **0.07** | **1.71** | **1.11** | **0.0045** |

### Antiderivation (symbolic integration)

| # | Case | CE·cur | CE+R/F | CE·0.95.1 | SymPy | Wolfram |
|---|---|---|---|---|---|---|
| | **Core tier** |  |  |  |  |  |
| A01 | $\int x^2\,dx$ | 0.11 | 0.14 | 0.14 | 0.38 | 0.03 |
| A02 | $\int\sin x\,dx$ | 0.04 | 0.20 | 0.04 | 1.19 | 0.58 |
| A03 | $\int x e^x\,dx$ | 0.17 | 0.85 | 0.20 | 6.23 | 0.57 |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 0.08 | 0.18 | 0.06 | 9.06 | 0.86 |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 0.25 | 1.06 | 0.27 | 6.81 | 0.58 |
| | **Hard tier** |  |  |  |  |  |
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 1.52 | 9.35 | 1.81 | 23.6 | 8.02 |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 0.07 | 0.14 | 0.08 | 0.70 | 0.36 |
| A08 | $\int e^{-x^2}\,dx$ | 0.28 | 0.54 | 0.34 | 24.4 | 0.43 |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 0.25 | 1.38 | 0.27 | 24.1 | 2.08 |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | **∅** | 1.15 | ∅ | 20.9 | 2.20 |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | **∅** | 1.02 | ∅ | 119 | 1.10 |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | **∅** | 1.33 | ∅ | 205 | 1.47 |
|  | **median ms** | **0.17** | **1.02** | **0.20** | **20.9** | **0.86** |

## Rule packs — coverage & true warm overhead

`CE·cur` (base engine) and `CE+R/F` (Rubi + Fungrim) are timed **back-to-back in one warm process**, so their ratio is a clean per-call rule-pack overhead — the same warm process that produces every CE column in the tables above, so this ratio and those columns are directly comparable. Overhead is ≈1× wherever no rule can fire (numeric, differentiation); the packs cost real time on integrals they miss and *win* where a rule applies (e.g. `∫1/(x³+1)`).

**Coverage gained** (∅/❌ → ✅ once the packs are enabled): CR1 ($\int\frac{\sqrt x}{1+x}\,dx$), CR2 ($\int\frac{x}{(1+x)^{1/3}}\,dx$), CR3 ($\int\frac{x^2}{(1+x)^{1/3}}\,dx$).

| # | Case | CE·cur | CE+R/F | Overhead |
|---|---|---|---|---|
| A06 | $\int\frac{1}{x^3+1}\,dx$ | 1517 | 9350 | 6.16× |
| A09 | $\int\frac{x}{\sqrt{1-x^2}}\,dx$ | 248 | 1377 | 5.55× |
| A02 | $\int\sin x\,dx$ | 39 | 197 | 5.12× |
| A03 | $\int x e^x\,dx$ | 168 | 852 | 5.06× |
| CR1 | $\int\frac{\sqrt x}{1+x}\,dx$ | 250 | 1153 | 4.61× |
| A05 | $\int\frac{x}{x^2+1}\,dx$ | 250 | 1058 | 4.23× |
| CR3 | $\int\frac{x^2}{(1+x)^{1/3}}\,dx$ | 358 | 1333 | 3.72× |
| CR2 | $\int\frac{x}{(1+x)^{1/3}}\,dx$ | 315 | 1025 | 3.25× |
| S02 | $\sin^2 x+\cos^2 x$ | 77 | 187 | 2.45× |
| CE4 | $\int_{-\infty}^{\infty} e^{-x^2}\,dx$ | 179 | 430 | 2.41× |
| CE1 | $\lim_{x\to0}\tfrac{\sin x}{x}$ | 51 | 119 | 2.32× |
| A04 | $\int\frac{1}{1+x^2}\,dx$ | 80 | 176 | 2.22× |
| S07 | $\ln x+\ln(x+1)$ | 157 | 308 | 1.97× |
| A08 | $\int e^{-x^2}\,dx$ | 281 | 542 | 1.93× |
| A07 | $\int\frac{1}{\sqrt x}\,dx$ | 74 | 142 | 1.91× |
| S06 | $\sqrt6\,x+\sqrt2\,x$ | 224 | 410 | 1.83× |
| CE2 | $\lim_{x\to\infty}(1+\tfrac1x)^x$ | 766 | 1182 | 1.54× |
| S08 | $\sqrt{3+2\sqrt2}$ | 79 | 117 | 1.47× |
| A01 | $\int x^2\,dx$ | 113 | 136 | 1.21× |
| S03 | $(x+1)^2-(x-1)^2$ | 216 | 255 | 1.18× |
| CS1 | $x^4+x^2-1=0$ | 1719 | 1936 | 1.13× |
| N07 | $\zeta(3)$ | 275 | 244 | **0.89× (win)** |

_Times in µs (warm median). 31 row(s) within ±10% (no measurable pack overhead — numeric / differentiation) omitted._

## Current build vs published `0.95.1`

No behavioural differences detected on this suite — the current build matches `0.95.1` on all 39 cases (correctness and output form).

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
