# Compute Engine vs SymPy vs Mathematica — operation audit

_Issue-finder: CE (current build) vs SymPy and **Mathematica** (the reference baseline) across 6 operations, 22 cases. All three graded identically — value-equivalence (factor/expand/simplify → result equals input; gcd → equals the true gcd), derivative-check (integration), or known value (limits). Each cell is the **median time per call in µs**; a mark appears **only when a result is not correct**: 🟡 value-correct but poor form · ❌ wrong · ∅ not solved · ⚠️ error._

## Summary

- **CE 22/22** fully correct vs **SymPy 22/22** and the **Mathematica 22/22** baseline. Against Mathematica, CE trails on **0** cases (below).
- **CE issues found:** none on this suite. Previously-flagged gaps are now fixed: **limits** return exact symbolic closed forms (e.g. $\tfrac12$, $e$), not just numeric values (ROADMAP B8); polynomial **GCD** (B5); `Factor` of $x^n-1$ returns polynomial factors (B4); and indefinite integration of fractional-power / erf / Fresnel / Si–Ci / radical integrands (B2).
- **Where CE leads:** it solves GCD, expansion, simplification and limits, and is **markedly faster** than SymPy there — e.g. simplification ~0.2 ms vs ~4 ms.
- **Scope:** hand-authored cases across operations. The **Wester** suite is wired in separately (`wester.ts` → `REPORT-wester.md`, via the Mathematica files + `wl-parser`); the **Bondarenko** integration set (35, local) is the next integration-depth source.

## Where CE trails Mathematica (baseline)

_None on this suite._

## By operation

### Factoring — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $x^2 - 1$ | 604 | 645 | 8.1 |
| $x^3 - 1$ | 703 | 527 | 8.7 |
| $x^4 - 1$ | 846 | 582 | 19 |
| $x^6 - 1$ | 1386 | 596 | 31 |
| $x^7 - 1$ | 653 | 555 | 25 |

### Polynomial GCD — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\gcd\bigl((x+1)(x+2),\ (x+1)(x+3)\bigr)$ | 591 | 1223 | 20 |
| $\gcd(x^2-1,\ x^2+2x+1)$ | 479 | 885 | 10 |
| $\gcd(x^3-1,\ x^2-1)$ | 114 | 765 | 9.2 |

### Expansion — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $(x+1)^5$ | 266 | 796 | 6.3 |
| $(x+2)^4$ | 201 | 716 | 6.0 |
| $(x-1)^6$ | 337 | 1010 | 6.9 |

### Simplification — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\frac{x^2-1}{x-1}$ | 255 | 4217 | 135 |
| $\frac{x^3-1}{x-1}$ | 190 | 4599 | 970 |
| $x^{-1/2} - \frac{1}{\sqrt{x}}$ | 137 | 219 | 9.7 |

### Integration — CE 5/5, SymPy 5/5, Mathematica 5/5

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\int x^2\,dx$ | 194 | 484 | 23 |
| $\int \frac{1}{1+x^2}\,dx$ | 132 | 9267 | 830 |
| $\int \frac{1}{\sqrt{x}}\,dx$ | 155 | 832 | 269 |
| $\int e^{-x^2}\,dx$ | 472 | 25968 | 362 |
| $\int \frac{1}{x^3+1}\,dx$ | 3888 | 22559 | 8797 |

### Limits — CE 3/3, SymPy 3/3, Mathematica 3/3

| Case | CE | SymPy | Mathematica |
|---|---|---|---|
| $\lim_{x \to 0} \frac{\sin x}{x}$ | 115 | 586 | 2011 |
| $\lim_{x \to 0} \frac{1-\cos x}{x^2}$ | 847 | 9072 | 2408 |
| $\lim_{x \to 1} \frac{x^2-1}{x-1}$ | 233 | 5254 | 290 |

---
_Context: CE now computes **multivariate** polynomial GCDs (any number of variables) via Brown's dense modular algorithm over ℤ_p, verified by exact division (ROADMAP B11). The 7-variable Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) is still out of reach: it exceeds the dense algorithm's complexity cap and defers (the benchmark uses degree-7 forms in 7 variables). Closing it needs sparse interpolation (Zippel) + multi-prime CRT. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
