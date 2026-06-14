# Wester suite — Compute Engine vs SymPy

_Michael Wester's CAS-review test suite (Mathematica form, GPL — `benchmarks/wester/`), parsed with the project `wl-parser` and graded by operation invariant (no reference answers needed). 26 runnable cases of 431 statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._

## Summary

Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = reference.

Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives (≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.

- **CE 9/26** · **CE+R/F 10/26** · **SymPy 18/26** correct.
- Base CE trails SymPy on **9** cases; **1** of those recovered by Rubi/Fungrim.

| Operation | CE | CE+R/F | SymPy |
|---|--:|--:|--:|
| Indefinite ∫ | 0/8 | 1/8 | 7/8 |
| Definite ∫ | 0/5 | 0/5 | 0/5 |
| Derivative | 1/1 | 1/1 | 1/1 |
| Limit | 2/6 | 2/6 | 4/6 |
| Factoring | 4/4 | 4/4 | 4/4 |
| Simplification | 2/2 | 2/2 | 2/2 |

## Where CE trails SymPy (9)

| File | Op | Input | CE | CE+R/F | CE result |
|---|---|---|---|---|---|
| indefinite_integrals | integrate | `|x|` | ∅ | ∅ | `int(|x| dx)` |
| indefinite_integrals | integrate | `2^x / sqrt(4^x + 1)` | ∅ | ∅ | `int(2^x / sqrt(4^x + 1) dx` |
| indefinite_integrals | integrate | `(3x - 5)^2 / (2x - 1)^(7/2)` | ∅ | ✅ | `int((3x - 5)^2 / (2x - 1)^` |
| indefinite_integrals | integrate | `sinh(x)^4 / cosh(x)^2` | ∅ | ∅ | `int(sinh(x)^4 / cosh(x)^2 ` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 3)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 4)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 5)` | ∅ | ∅ | `int(1 / (3cos(x) + 4sin(x)` |
| limits | limit | `(3^x + 5^x)^(1 / x)` | ∅ | ∅ | `lim_(+oo) {(3^x + 5^x)^(1 ` |
| limits | limit | `ln(x) / (sin(x) + ln(x))` | ∅ | ∅ | `lim_(+oo) {ln(x) / (sin(x)` |

## CE ≠ SymPy disagreements (2)

_Both produced a value but they differ — at least one is wrong; worth investigating._

| File | Op | Input | CE value | SymPy value |
|---|---|---|---|---|
| limits | limit | `(-e^x + e^(x * e^(-x)) / (` | 0 | -7.38905609893065 |
| limits | limit | `(x * ln(x) * ln(-x^2 + x *` | 0 | 0.3333333333333333 |

---
_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._
