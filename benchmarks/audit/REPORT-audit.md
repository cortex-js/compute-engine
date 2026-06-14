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
| x² − 1 | ✅ 0.54 | ✅ 0.52 |
| x³ − 1 | ✅ 0.69 | ✅ 0.51 |
| x⁴ − 1 | ✅ 0.77 | ✅ 0.55 |
| x⁶ − 1 | ✅ 1.38 | ✅ 0.61 |
| x⁷ − 1 | ✅ 0.64 | ✅ 0.55 |

### Polynomial GCD — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| gcd((x+1)(x+2), (x+1)(x+3)) | ✅ 0.57 | ✅ 1.34 |
| gcd(x²−1, x²+2x+1) | ✅ 0.45 | ✅ 0.92 |
| gcd(x³−1, x²−1) | ✅ 0.11 | ✅ 0.79 |

### Expansion — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x+1)⁵ | ✅ 0.27 | ✅ 0.77 |
| (x+2)⁴ | ✅ 0.20 | ✅ 0.72 |
| (x−1)⁶ | ✅ 0.33 | ✅ 1.02 |

### Simplification — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x²−1)/(x−1) | ✅ 0.17 | ✅ 5.03 |
| (x³−1)/(x−1) | ✅ 0.19 | ✅ 4.73 |
| x^(−1/2) − 1/√x | ✅ 0.12 | ✅ 0.22 |

### Integration — CE 5/5, SymPy 5/5

| Case | CE | SymPy |
|---|---|---|
| ∫ x² dx | ✅ 0.17 | ✅ 0.50 |
| ∫ 1/(1+x²) dx | ✅ 0.14 | ✅ 9.53 |
| ∫ 1/√x dx | ✅ 0.18 | ✅ 0.82 |
| ∫ e^(−x²) dx | ✅ 0.51 | ✅ 25.7 |
| ∫ 1/(x³+1) dx | ✅ 4.26 | ✅ 23.0 |

### Limits — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| lim_{x→0} sin x / x | ✅ <sub>numeric</sub> 0.08 | ✅ 0.60 |
| lim_{x→0} (1−cos x)/x² | ✅ <sub>numeric</sub> 0.10 | ✅ 9.05 |
| lim_{x→0} (x²−1)/(x−1)... @1 | ✅ <sub>numeric</sub> 0.11 | ✅ 5.35 |

---
_Context: CE has no public polynomial GCD, so the Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) can't run on CE today. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
