# Wester suite — Compute Engine vs SymPy

_Michael Wester's CAS-review test suite (Mathematica form, GPL — `benchmarks/wester/`), parsed with the project `wl-parser` and graded by operation invariant (no reference answers needed). 21 runnable cases of 533 statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._

## Summary

Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = reference.

Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives (≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.

- **CE 9/21** · **CE+R/F 9/21** · **SymPy 16/21** correct.
- Base CE trails SymPy on **7** cases; **0** of those recovered by Rubi/Fungrim.

| Operation | CE | CE+R/F | SymPy |
|---|--:|--:|--:|
| Solve | 9/21 | 9/21 | 16/21 |

## Where CE trails SymPy (7)

| File | Op | Input | CE | CE+R/F | CE result |
|---|---|---|---|---|---|
| equations | solve | `-e^(-x) + e^(2 - x^2)` | ∅ | ∅ | `[]` |
| equations | solve | `-x + x^x` | ∅ | ∅ | `[]` |
| equations | solve | `-cos(x) + sin(x)` | ∅ | ∅ | `[]` |
| equations | solve | `-tan(x) + sin(x)` | ∅ | ∅ | `[]` |
| equations | solve | `2sqrt(x) + 3root(4)(x) - 2` | ∅ | ∅ | `[]` |
| equations | solve | `x - 1 / sqrt(x^2 + 1)` | ∅ | ∅ | `[]` |
| equations | solve | `-ln(sqrt(x)) + sqrt(ln(x))` | ∅ | ∅ | `[]` |

---
_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._
