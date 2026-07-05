# Compute Engine vs SymPy vs Mathematica — operation audit

_Issue-finder: CE (current build) vs SymPy and **Mathematica** (the reference baseline) across 6 operations, 28 cases. All three graded identically — value-equivalence (factor/expand/simplify → result equals input; gcd → equals the true gcd), derivative-check (integration), or known value (limits). Each cell is the **median time per call in µs**; a mark appears **only when a result is not correct**: 🟡 value-correct but poor form · ❌ wrong · ∅ not solved · ⚠️ error._

_Runner: **minified production bundle** (`dist/compute-engine.min.esm.js`, `console.assert` stripped) — CE times reflect shipped code, not the ~2×-slower from-source build. Rebuild with `npm run build production` before running._

## Summary

- **CE 28/28** fully correct vs **SymPy 28/28** and the **Mathematica 28/28** baseline. Against Mathematica, CE trails on **0** cases (below).
- **CE issues found:** none on correctness. Previously-flagged gaps are now fixed: **limits** return exact symbolic closed forms (e.g. $\tfrac12$, $e$), not just numeric values (ROADMAP B8); polynomial **GCD** (B5); `Factor` of $x^n-1$ returns polynomial factors (B4); and indefinite integration of fractional-power / erf / Fresnel / Si–Ci / radical integrands (B2).
- **Performance gap:** dense **multivariate expansion** — $(x+y+z+1)^{32}$ (6,545 terms, case E5) is correct but ~2–4× slower than SymPy and two orders of magnitude slower than Mathematica. Binomial powers ($(a+b)^{80}$, E7, ~4× faster than SymPy) and the Gaussian-integer power (E8) are ahead; the Gaussian-*rational* power (E9, exact components over $4^{1000}$) runs ~2× behind SymPy.
- **Where CE leads:** it solves GCD, expansion, simplification and limits, and is **markedly faster** than SymPy on most of them — e.g. simplification ~0.2 ms vs ~4 ms, $(a+b)^{80}$ ~4 ms vs ~22 ms.
- **Scope:** hand-authored cases across operations. The **Wester** suite is wired in separately (`wester.ts` → `REPORT-wester.md`, via the Mathematica files + `wl-parser`); the **Bondarenko** integration set (35, local) is the next integration-depth source.

## Where CE trails Mathematica (baseline)

_None on this suite._

## By operation

### Factoring — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $x^2 - 1$ | 250 | 614 | 8.0 |
| $x^3 - 1$ | 239 | 520 | 8.1 |
| $x^4 - 1$ | 440 | 519 | 19 |
| $x^6 - 1$ | 554 | 589 | 31 |
| $x^7 - 1$ | 230 | 555 | 25 |

### Polynomial GCD — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\gcd\bigl((x+1)(x+2),\ (x+1)(x+3)\bigr)$ | 690 | 1234 | 22 |
| $\gcd(x^2-1,\ x^2+2x+1)$ | 563 | 913 | 11 |
| $\gcd(x^3-1,\ x^2-1)$ | 93 | 769 | 9.6 |

### Expansion — CE 9/9, SymPy 9/9, Mathematica 9/9

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $(x+1)^5$ | 205 | 768 | 6.3 |
| $(x+2)^4$ | 174 | 725 | 6.1 |
| $(x-1)^6$ | 235 | 1014 | 7.0 |
| $3x^2yz^7 + 7xyz^2 + 4x + xy^4$ | 198 | 868 | 11 |
| $(x+y+z+1)^{32}$ | 1296047 | 741851 | 5254 |
| $(a+b)^{20}$ | 691 | 3119 | 17 |
| $(a+b)^{80}$ | 3236 | 12116 | 58 |
| $(2+3i)^{1000}$ | 53 | 438 | 6.3 |
| $\left(2+\tfrac34 i\right)^{1000}$ | 1636 | 705 | 20 |

### Simplification — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\frac{x^2-1}{x-1}$ | 178 | 4002 | 135 |
| $\frac{x^3-1}{x-1}$ | 151 | 4584 | 1005 |
| $x^{-1/2} - \frac{1}{\sqrt{x}}$ | 111 | 217 | 9.7 |

### Integration — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\int x^2\,dx$ | 154 | 526 | 22 |
| $\int \frac{1}{1+x^2}\,dx$ | 102 | 8959 | 772 |
| $\int \frac{1}{\sqrt{x}}\,dx$ | 121 | 806 | 267 |
| $\int e^{-x^2}\,dx$ | 398 | 25286 | 352 |
| $\int \frac{1}{x^3+1}\,dx$ | 2958 | 23759 | 8848 |

### Limits — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\lim_{x \to 0} \frac{\sin x}{x}$ | 151 | 610 | 2104 |
| $\lim_{x \to 0} \frac{1-\cos x}{x^2}$ | 579 | 9255 | 2182 |
| $\lim_{x \to 1} \frac{x^2-1}{x-1}$ | 160 | 5226 | 278 |

---
_Context: CE now computes **multivariate** polynomial GCDs (any number of variables) via Brown's dense modular algorithm over ℤ_p, verified by exact division (ROADMAP B11). The 7-variable Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) is still out of reach: it exceeds the dense algorithm's complexity cap and defers (the benchmark uses degree-7 forms in 7 variables). Closing it needs sparse interpolation (Zippel) + multi-prime CRT. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
