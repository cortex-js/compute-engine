# Wester suite — Compute Engine vs SymPy

_Michael Wester's CAS-review test suite (Mathematica form, GPL — `benchmarks/wester/`), parsed with the project `wl-parser` and graded by operation invariant (no reference answers needed). 48 runnable cases of 533 statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._

## Summary

Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = reference.

Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives (≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.

- **CE 26/48** · **CE+R/F 27/48** · **SymPy 37/48** correct.
- Base CE trails SymPy on **11** cases; **1** of those recovered by Rubi/Fungrim.

| Operation | CE | CE+R/F | SymPy |
|---|--:|--:|--:|
| Indefinite ∫ | 0/8 | 1/8 | 7/8 |
| Definite ∫ | 0/5 | 0/5 | 0/5 |
| Derivative | 1/1 | 1/1 | 1/1 |
| Limit | 4/6 | 4/6 | 6/6 |
| Solve | 14/21 | 14/21 | 16/21 |
| Resultant | 1/1 | 1/1 | 1/1 |
| Factoring | 4/4 | 4/4 | 4/4 |
| Simplification | 2/2 | 2/2 | 2/2 |

## Where CE trails SymPy (11)

| File | Op | Input | CE | CE+R/F | CE result |
|---|---|---|---|---|---|
| indefinite_integrals | integrate | `|x|` | ∅ | ∅ | `int(|x| dx)` |
| indefinite_integrals | integrate | `2^x / sqrt(4^x + 1)` | ∅ | ∅ | `int(2^x / sqrt(4^x + 1) dx` |
| indefinite_integrals | integrate | `(3x - 5)^2 / (2x - 1)^(7/2)` | ∅ | ✅ | `int((3x - 5)^2 / (2x - 1)^` |
| indefinite_integrals | integrate | `sinh(x)^4 / cosh(x)^2` | ∅ | ∅ | `int(sinh(x)^4 / cosh(x)^2 ` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 3)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 4)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 5)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| limits | limit | `(-e^x + e^(x * e^(-x)) / (e^` | ∅ | ∅ | `lim_(+oo) {(-e^x + e^(x * ` |
| limits | limit | `(x * ln(x) * ln(-x^2 + x * e` | ∅ | ∅ | `lim_(+oo) {(x * ln(x) * ln` |
| equations | solve | `-x + x^x` | ∅ | ∅ | `[]` |
| equations | solve | `-tan(x) + sin(x)` | ∅ | ∅ | `[]` |

---
_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._
