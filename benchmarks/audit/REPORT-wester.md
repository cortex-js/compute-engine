# Wester suite — Compute Engine vs SymPy vs Mathematica

_Runner: **minified production bundles** (`dist/esm-min/*.js`, `console.assert` stripped) — CE times reflect shipped code. Rebuild with `npm run build production` before running._

_Michael Wester's CAS-review test suite (Mathematica form, GPL — `benchmarks/wester/`), parsed with the project `wl-parser` and graded by operation invariant (no reference answers needed). 48 runnable cases of 533 statements; the rest are multivariate, improper, other heads, or stateful (skip counts in stderr). ✅ correct · 🟡 value-correct, poor form · ❌ wrong · ∅ not solved · · inconclusive (domain)._

## Summary

Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = the open-source comparator; **Mathematica** = the reference baseline (the CAS these test files are written in).

Grading: factor/expand/simplify (value-equal to input), indefinite ∫ (`d/dx` ≈ integrand), and derivatives (≈ central difference) are **invariant-verified**. Limits and definite ∫ have no cheap reliable numeric oracle, so for those **correct = the tool returned a finite value**, with CE-vs-SymPy disagreements flagged (`≠`) separately.

- **CE 26/48** · **CE+R/F 33/48** · **SymPy 36/48** · **Mathematica 44/48** correct.
- Against the **Mathematica** baseline, base CE trails on **18** cases; **7** of those recovered by Rubi/Fungrim.

| Operation | CE | CE+R/F | SymPy | Mathematica |
|---|--:|--:|--:|--:|
| Indefinite ∫ | 1/8 | 8/8 | 7/8 | 8/8 |
| Definite ∫ | 0/5 | 0/5 | 0/5 | 4/5 |
| Derivative | 1/1 | 1/1 | 1/1 | 1/1 |
| Limit | 4/6 | 4/6 | 6/6 | 6/6 |
| Solve | 13/21 | 13/21 | 15/21 | 18/21 |
| Resultant | 1/1 | 1/1 | 1/1 | 1/1 |
| Factoring | 4/4 | 4/4 | 4/4 | 4/4 |
| Simplification | 2/2 | 2/2 | 2/2 | 2/2 |

## Where CE trails Mathematica (18)

| File | Op | Input | CE | CE+R/F | SymPy | Mathematica | CE result |
|---|---|---|---|---|---|---|---|
| indefinite_integrals | integrate | `2^x / sqrt(4^x + 1)` | ∅ | ✅ | ✅ | ✅ | `int(2^x / sqrt(4^x + 1) dx` |
| indefinite_integrals | integrate | `(3x - 5)^2 / (2x - 1)^(7/2)` | ∅ | ✅ | ✅ | ✅ | `int((3x - 5)^2 / (2x - 1)^` |
| indefinite_integrals | integrate | `sinh(x)^4 / cosh(x)^2` | ∅ | ✅ | ✅ | ✅ | `int(sinh(x)^4 / cosh(x)^2 ` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 3)` | ∅ | ✅ | ✅ | ✅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 4)` | ∅ | ✅ | ✅ | ✅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 5)` | ∅ | ✅ | ✅ | ✅ | `int(1 / (3cos(x) + 4sin(x)` |
| indefinite_integrals | integrate | `1 / (3cos(x) + 4sin(x) + 6)` | ∅ | ✅ | · | ✅ | `int(1 / (3cos(x) + 4sin(x)` |
| definite_integrals | defint | `sqrt(x + 1 / x - 2)` | ∅ | ∅ | ∅ | ✅ | `int_(0)^(1)(sqrt(x + 1 / x` |
| definite_integrals | defint | `sqrt(x + 1 / x - 2)` | ∅ | ∅ | ∅ | ✅ | `int_(1)^(2)(sqrt(x + 1 / x` |
| definite_integrals | defint | `sqrt(x + 1 / x - 2)` | ∅ | ∅ | ∅ | ✅ | `int_(0)^(2)(sqrt(x + 1 / x` |
| definite_integrals | defint | `sqrt(1 - x^2) / (x^2 + 1)` | ∅ | ∅ | ∅ | ✅ | `int_(-1)^(1)(sqrt(1 - x^2)` |
| limits | limit | `(-e^x + e^(x * e^(-x)) / (e^` | ∅ | ∅ | ✅ | ✅ | `lim_(+oo) {(-e^x + e^(x * ` |
| limits | limit | `(x * ln(x) * ln(-x^2 + x * e` | ∅ | ∅ | ✅ | ✅ | `lim_(+oo) {(x * ln(x) * ln` |
| equations | solve | `-x + x^x` | ∅ | ∅ | ✅ | ✅ | `[]` |
| equations | solve | `-cos(x) + sin(x)` | 🟡 1/2 roots | 🟡 | 🟡 | ✅ | `1/4 * pi` |
| equations | solve | `-tan(x) + sin(x)` | ∅ | ∅ | ✅ | ✅ | `[]` |
| equations | solve | `-arctan(x) + arcsin(x)` | ∅ | ∅ | ⚠️ | ✅ | `[]` |
| equations | solve | `-arctan(x) + arccos(x)` | ∅ | ∅ | ⚠️ | ✅ | `[]` |

---
_Reproduce: `npx tsx benchmarks/audit/wester.ts`. Heads covered: indefinite & definite integration, derivatives, limits, factor/expand/simplify. Next: `Solve`, `PolynomialGCD`, `Resultant`, and improper/multivariate cases._
