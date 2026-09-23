# Compute Engine vs SymPy vs Mathematica — operation audit

_Issue-finder: CE (current build) vs SymPy and **Mathematica** (the reference baseline) across 6 operations, 28 cases. All three graded identically — value-equivalence (factor/expand/simplify → result equals input; gcd → equals the true gcd), derivative-check (integration), or known value (limits). Each cell is the **median time per call in µs**; a mark appears **only when a result is not correct**: 🟡 value-correct but poor form · ❌ wrong · ∅ not solved · ⚠️ error._

_Runner: **minified production bundle** (`dist/esm-min/compute-engine.js`, `console.assert` stripped) — CE times reflect shipped code, not the ~2×-slower from-source build. Rebuild with `npm run build production` before running._

## Summary

- **CE 28/28** fully correct vs **SymPy 28/28** and the **Mathematica 28/28** baseline. Against Mathematica, CE trails on **0** cases (below).
- **CE issues found:** none on correctness. Previously-flagged gaps are now fixed: **limits** return exact symbolic closed forms (e.g. $\tfrac12$, $e$), not just numeric values (ROADMAP B8); polynomial **GCD** (B5); `Factor` of $x^n-1$ returns polynomial factors (B4); and indefinite integration of fractional-power / erf / Fresnel / Si–Ci / radical integrands (B2).
- **Performance gap:** dense **multivariate expansion** — $(x+y+z+1)^{32}$ (6,545 terms, case E5) is correct but ~1.3× slower than SymPy and two orders of magnitude slower than Mathematica. Binomial powers ($(a+b)^{80}$, E7, ~1.4× faster than SymPy) and the Gaussian-integer power (E8, ~7×) are ahead; the Gaussian-*rational* power (E9, exact components over $4^{1000}$) runs ~2× behind SymPy.
- **Where CE leads:** it solves GCD, expansion, simplification and limits, and is **markedly faster** than SymPy on most of them — e.g. rational simplification ~20× faster, low-degree expansion ~2.5× faster.
- **Scope:** hand-authored cases across operations. The **Wester** suite is wired in separately (`wester.ts` → `REPORT-wester.md`, via the Mathematica files + `wl-parser`); the **Bondarenko** integration set (35, local) is wired in too (`bondarenko.ts` → `REPORT-bondarenko.md`).

## Where CE trails Mathematica (baseline)

_None on this suite._

## By operation

### Factoring — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $x^2 - 1$ | 306 | 356 | 5.4 |
| $x^3 - 1$ | 176 | 350 | 5.6 |
| $x^4 - 1$ | 307 | 374 | 13 |
| $x^6 - 1$ | 431 | 396 | 21 |
| $x^7 - 1$ | 172 | 381 | 17 |

### Polynomial GCD — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\gcd\bigl((x+1)(x+2),\ (x+1)(x+3)\bigr)$ | 576 | 844 | 13 |
| $\gcd(x^2-1,\ x^2+2x+1)$ | 372 | 607 | 7.1 |
| $\gcd(x^3-1,\ x^2-1)$ | 111 | 529 | 6.1 |

### Expansion — CE 9/9, SymPy 9/9, Mathematica 9/9

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $(x+1)^5$ | 214 | 511 | 4.1 |
| $(x+2)^4$ | 177 | 479 | 4.0 |
| $(x-1)^6$ | 295 | 671 | 4.3 |
| $3x^2yz^7 + 7xyz^2 + 4x + xy^4$ | 264 | 577 | 7.2 |
| $(x+y+z+1)^{32}$ | 664653 | 474833 | 3558 |
| $(a+b)^{20}$ | 1064 | 2030 | 11 |
| $(a+b)^{80}$ | 6406 | 7664 | 37 |
| $(2+3i)^{1000}$ | 37 | 304 | 5.0 |
| $\left(2+\tfrac34 i\right)^{1000}$ | 975 | 465 | 14 |

### Simplification — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\frac{x^2-1}{x-1}$ | 150 | 2925 | 92 |
| $\frac{x^3-1}{x-1}$ | 130 | 3368 | 655 |
| $x^{-1/2} - \frac{1}{\sqrt{x}}$ | 106 | 149 | 6.3 |

### Integration — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\int x^2\,dx$ | 218 | 327 | 15 |
| $\int \frac{1}{1+x^2}\,dx$ | 169 | 6557 | 641 |
| $\int \frac{1}{\sqrt{x}}\,dx$ | 165 | 551 | 215 |
| $\int e^{-x^2}\,dx$ | 352 | 17771 | 287 |
| $\int \frac{1}{x^3+1}\,dx$ | 2846 | 16745 | 6081 |

### Limits — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\lim_{x \to 0} \frac{\sin x}{x}$ | 116 | 410 | 1477 |
| $\lim_{x \to 0} \frac{1-\cos x}{x^2}$ | 582 | 6516 | 1559 |
| $\lim_{x \to 1} \frac{x^2-1}{x-1}$ | 169 | 3736 | 194 |

---
_Context: CE now computes **multivariate** polynomial GCDs (any number of variables) via Brown's dense modular algorithm over ℤ_p, verified by exact division (ROADMAP B11). The 7-variable Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) is still out of reach: it exceeds the dense algorithm's complexity cap and defers (the benchmark uses degree-7 forms in 7 variables). Closing it needs sparse interpolation (Zippel) + multi-prime CRT. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
