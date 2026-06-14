# Compute Engine vs SymPy — operation audit

_Issue-finder: CE (current build) vs SymPy across 6 operations, 22 cases. Both graded identically — value-equivalence (factor/expand/simplify → result equals input; gcd → equals the true gcd), derivative-check (integration), or known value (limits). Cell = mark + median ms; ✅ correct · 🟡 value-correct but poor form · ❌ wrong · ∅ not solved · ⚠️ error._

## Summary

- **CE 22/22** fully correct vs **SymPy 22/22**. CE trails on **0** cases (below); none where SymPy trails CE.
- **CE issues found:** limits are **numerical-only** (correct value, no symbolic closed form — ROADMAP B8). Previously-flagged gaps are now fixed: polynomial **GCD** (B5), `Factor` of `xⁿ−1` returns polynomial factors (B4), and indefinite integration of fractional-power / erf / Fresnel / Si–Ci / radical integrands (B2).
- **Where CE leads:** it solves GCD, expansion, simplification and (numeric) limits, and is **markedly faster** than SymPy there — e.g. simplification ~0.5 ms vs ~10 ms.
- **Scope:** hand-authored cases across operations. The **Wester** suite is wired in separately (`wester.ts` → `REPORT-wester.md`, via the Mathematica files + `wl-parser`); the **Bondarenko** integration set (35, local) is the next integration-depth source.

## Where CE trails SymPy

_None on this suite._

## By operation

### Factoring — CE 5/5, SymPy 5/5

| Case | CE | SymPy |
|---|---|---|
| x² − 1 | ✅ 0.59 | ✅ 0.53 |
| x³ − 1 | ✅ 0.76 | ✅ 0.53 |
| x⁴ − 1 | ✅ 0.97 | ✅ 0.56 |
| x⁶ − 1 | ✅ 1.46 | ✅ 0.62 |
| x⁷ − 1 | ✅ 0.70 | ✅ 0.58 |

### Polynomial GCD — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| gcd((x+1)(x+2), (x+1)(x+3)) | ✅ 0.64 | ✅ 1.24 |
| gcd(x²−1, x²+2x+1) | ✅ 0.50 | ✅ 0.91 |
| gcd(x³−1, x²−1) | ✅ 0.12 | ✅ 0.76 |

### Expansion — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x+1)⁵ | ✅ 0.30 | ✅ 0.78 |
| (x+2)⁴ | ✅ 0.23 | ✅ 0.71 |
| (x−1)⁶ | ✅ 0.39 | ✅ 1.00 |

### Simplification — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x²−1)/(x−1) | ✅ 0.19 | ✅ 4.42 |
| (x³−1)/(x−1) | ✅ 0.20 | ✅ 4.81 |
| x^(−1/2) − 1/√x | ✅ 0.14 | ✅ 0.22 |

### Integration — CE 5/5, SymPy 5/5

| Case | CE | SymPy |
|---|---|---|
| ∫ x² dx | ✅ 0.18 | ✅ 0.49 |
| ∫ 1/(1+x²) dx | ✅ 0.15 | ✅ 9.85 |
| ∫ 1/√x dx | ✅ 0.18 | ✅ 0.86 |
| ∫ e^(−x²) dx | ✅ 0.57 | ✅ 26.5 |
| ∫ 1/(x³+1) dx | ✅ 4.76 | ✅ 25.2 |

### Limits — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| lim_{x→0} sin x / x | ✅ <sub>numeric</sub> 0.43 | ✅ 0.61 |
| lim_{x→0} (1−cos x)/x² | ✅ <sub>numeric</sub> 0.94 | ✅ 10.1 |
| lim_{x→0} (x²−1)/(x−1)... @1 | ✅ <sub>numeric</sub> 0.31 | ✅ 6.24 |

---
_Context: CE now computes **multivariate** polynomial GCDs (any number of variables) via Brown's dense modular algorithm over ℤ_p, verified by exact division (ROADMAP B11). The 7-variable Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) is still out of reach: it exceeds the dense algorithm's complexity cap and defers (the benchmark uses degree-7 forms in 7 variables). Closing it needs sparse interpolation (Zippel) + multi-prime CRT. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
