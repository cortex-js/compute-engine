# Compute Engine vs SymPy — operation audit

_Issue-finder: CE (current build) vs SymPy across 6 operations, 22 cases. Both graded identically — value-equivalence (factor/expand/simplify → result equals input; gcd → equals the true gcd), derivative-check (integration), or known value (limits). Cell = mark + median ms; ✅ correct · 🟡 value-correct but poor form · ❌ wrong · ∅ not solved · ⚠️ error._

## Summary

- **CE 21/22** fully correct vs **SymPy 22/22**. CE trails on **1** cases (below); none where SymPy trails CE.
- **CE issues found:** `Factor` emits non-polynomial radical/abs forms for `xⁿ−1` (odd factors); integration misses fractional-power/erf integrands; limits are **numerical-only** (correct value, no symbolic form). (Polynomial **GCD** now works — ROADMAP B5 fixed.)
- **Where CE leads:** it solves GCD, expansion, simplification and (numeric) limits, and is **markedly faster** than SymPy there — e.g. simplification ~0.5 ms vs ~10 ms.
- **Scope:** hand-authored cases across operations. The **Wester** suite is wired in separately (`wester.ts` → `REPORT-wester.md`, via the Mathematica files + `wl-parser`); the **Bondarenko** integration set (35, local) is the next integration-depth source.

## Where CE trails SymPy

| Case | Operation | CE | SymPy | CE result |
|---|---|---|---|---|
| ∫ e^(−x²) dx | integrate | ∅ | ✅ | `int(e^(-(x^2)) dx)` |

## By operation

### Factoring — CE 5/5, SymPy 5/5

| Case | CE | SymPy |
|---|---|---|
| x² − 1 | ✅ 0.85 | ✅ 0.86 |
| x³ − 1 | ✅ 1.20 | ✅ 0.74 |
| x⁴ − 1 | ✅ 1.49 | ✅ 0.77 |
| x⁶ − 1 | ✅ 2.45 | ✅ 0.91 |
| x⁷ − 1 | ✅ 1.18 | ✅ 0.83 |

### Polynomial GCD — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| gcd((x+1)(x+2), (x+1)(x+3)) | ✅ 1.02 | ✅ 1.89 |
| gcd(x²−1, x²+2x+1) | ✅ 0.83 | ✅ 1.26 |
| gcd(x³−1, x²−1) | ✅ 0.20 | ✅ 1.15 |

### Expansion — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x+1)⁵ | ✅ 0.49 | ✅ 1.15 |
| (x+2)⁴ | ✅ 0.42 | ✅ 1.02 |
| (x−1)⁶ | ✅ 0.64 | ✅ 1.49 |

### Simplification — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| (x²−1)/(x−1) | ✅ 0.61 | ✅ 6.27 |
| (x³−1)/(x−1) | ✅ 0.37 | ✅ 7.03 |
| x^(−1/2) − 1/√x | ✅ 0.26 | ✅ 0.33 |

### Integration — CE 4/5, SymPy 5/5

| Case | CE | SymPy |
|---|---|---|
| ∫ x² dx | ✅ 0.31 | ✅ 0.62 |
| ∫ 1/(1+x²) dx | ✅ 0.24 | ✅ 15.1 |
| ∫ 1/√x dx | ✅ 0.31 | ✅ 1.13 |
| ∫ e^(−x²) dx | ∅ | ✅ 39.4 |
| ∫ 1/(x³+1) dx | ✅ 9.78 | ✅ 36.0 |

### Limits — CE 3/3, SymPy 3/3

| Case | CE | SymPy |
|---|---|---|
| lim_{x→0} sin x / x | ✅ <sub>numeric</sub> 0.15 | ✅ 0.86 |
| lim_{x→0} (1−cos x)/x² | ✅ <sub>numeric</sub> 0.18 | ✅ 14.1 |
| lim_{x→0} (x²−1)/(x−1)... @1 | ✅ <sub>numeric</sub> 0.19 | ✅ 8.71 |

---
_Context: CE has no public polynomial GCD, so the Fateman GCD benchmark (Symbolica 4 s / Mathematica 89 s / SymPy 61 min) can't run on CE today. Reproduce: `python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts`._
