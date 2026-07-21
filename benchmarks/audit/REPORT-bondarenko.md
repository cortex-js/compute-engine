# Bondarenko integration set — Compute Engine vs SymPy vs Mathematica

_Runner: **minified production bundles** (`dist/esm-min/*.js`, `console.assert` stripped) — CE times reflect shipped code. Rebuild with `npm run build production` before running._

Vladimir Bondarenko's 35 integration problems — an independent test set from the Rubi [MathematicaSyntaxTestSuite](https://github.com/RuleBasedIntegration/MathematicaSyntaxTestSuite) (MIT), vendored under `benchmarks/bondarenko/`. These are hard nested-radical / log / transcendental integrands. Each indefinite integral is graded by the operation invariant **`d/dx(F) ≈ f`** sampled numerically (per-point relative tolerance 0.000001, ≥2 valid points required), so the suite's optimal antiderivatives aren't needed. ✅ correct · ❌ wrong · ∅ not solved · ⚠️ error · · inconclusive (domain).

## Summary

Configs: **CE** = base shipping engine (no Rubi/Fungrim); **CE+R/F** = with the experimental Rubi integrator + Fungrim; **SymPy** = the open-source comparator; **Mathematica** = the reference baseline (the CAS these problems are written in).

- **CE 0/35** · **CE+R/F 9/35** · **SymPy 7/35** · **Mathematica 32/35** correct.
- Against the **Mathematica** baseline, base CE trails on **32** cases; **8** of those recovered by Rubi/Fungrim.

| Operation | CE | CE+R/F | SymPy | Mathematica |
|---|--:|--:|--:|--:|
| Indefinite ∫ | 0/35 | 9/35 | 7/35 | 32/35 |

## Per-case results

| # | Steps | Integrand | CE | CE+R/F | SymPy | Mathematica | CE+R/F result |
|--:|--:|---|:-:|:-:|:-:|:-:|---|
| 1 | 1 | `1 / (sin(z) + cos(z) + sqrt(2))` | ∅ | ✅ | ✅ | ✅ | `-(-sqrt(2) * sin(z) + 1) / (-sin(z) + co` |
| 2 | 4 | `(sqrt(x + 1) + sqrt(1 - x))^(-2)` | ∅ | ∅ | ∅ | ✅ | `int((sqrt(x + 1) + sqrt(1 - x))^(-2) dx)` |
| 3 | 2 | `(cos(x) + 1)^(-2)` | ∅ | ✅ | ✅ | ✅ | `sin(x) / (3(cos(x) + 1)) + sin(x) / (3(c` |
| 4 | 5 | `sin(x) / sqrt(x + 1)` | ∅ | ✅ | ✅ | ✅ | `-2(0.353553390593273726845 - 0.353553390` |
| 5 | 3 | `(sin(x) + cos(x))^(-6)` | ∅ | ✅ | ✅ | ✅ | `(2sin(x)) / (15(sin(x) + cos(x))) - cos(` |
| 6 | 22 | `ln(x^4 + x^(-4))` | ∅ | ✅ | ❌ | ✅ | `-4x + x * ln(x^4 + x^(-4)) - 1.847759065` |
| 7 | -1 | `ln(x + 1) / (x * sqrt(sqrt(x + 1) + 1))` | ∅ | ∅ | ∅ | ✅ | `int(ln(x + 1) / (x * sqrt(sqrt(x + 1) + ` |
| 8 | -1 | `ln(x + 1) / x * sqrt(sqrt(x + 1) + 1)` | ∅ | ∅ | ∅ | ✅ | `int(ln(x + 1) / x * sqrt(sqrt(x + 1) + 1` |
| 9 | 4 | `1 / (sqrt(x + sqrt(x^2 + 1)) + 1)` | ∅ | ∅ | ∅ | ✅ | `int(1 / (sqrt(x + sqrt(x^2 + 1)) + 1) dx` |
| 10 | 6 | `sqrt(x + 1) / (x + sqrt(sqrt(x + 1) + 1)` | ∅ | ∅ | ✅ | ✅ | `int(sqrt(x + 1) / (x + sqrt(sqrt(x + 1) ` |
| 11 | 5 | `1 / (x - sqrt(sqrt(x + 1) + 1))` | ∅ | ∅ | ✅ | ✅ | `int(1 / (x - sqrt(sqrt(x + 1) + 1)) dx)` |
| 12 | 6 | `x / (x + sqrt(1 - sqrt(x + 1)))` | ∅ | ∅ | · | ✅ | `int(x / (x + sqrt(1 - sqrt(x + 1))) dx)` |
| 13 | 20 | `sqrt(x + sqrt(x + 1)) / (x^2 + 1) * sqrt` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(x + sqrt(x + 1)) / (x^2 + 1) * ` |
| 14 | 22 | `sqrt(x + sqrt(x + 1)) / (x^2 + 1)` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(x + sqrt(x + 1)) / (x^2 + 1) dx` |
| 15 | 2 | `sqrt(sqrt(x) + sqrt(2x + 2sqrt(x) + 1) +` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(sqrt(x) + sqrt(2x + 2sqrt(x) + ` |
| 16 | 3 | `sqrt(sqrt(x) + sqrt(2x + 2sqrt(2) * sqrt` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(sqrt(x) + sqrt(2x + 2sqrt(2) * ` |
| 17 | 7 | `sqrt(x + sqrt(x + 1)) / x^2` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(x + sqrt(x + 1)) / x^2 dx)` |
| 18 | 7 | `sqrt(1 / x + sqrt(1 / x + 1))` | ∅ | ∅ | ∅ | ✅ | `int(sqrt(1 / x + sqrt(1 / x + 1)) dx)` |
| 19 | 6 | `sqrt(e^(-x) + 1) / (-e^(-x) + e^x)` | ∅ | ✅ | ∅ | ✅ | `-sqrt(2) * artanh(sqrt(2)/2 * sqrt(e^(-x` |
| 20 | 7 | `sqrt(e^(-x) + 1) / sinh(x)` | ∅ | ✅ | ∅ | ✅ | `-2sqrt(2) * artanh(sqrt(2)/2 * sqrt(e^(-` |
| 21 | -45 | `(cos(x) + cos(3x))^(-5)` | ∅ | ∅ | ∅ | ✅ | `int((cos(x) + cos(3x))^(-5) dx)` |
| 22 | 3 | `(sin(x) + cos(x) + 1)^(-2)` | ∅ | ✅ | ✅ | ✅ | `-ln(2tan(1/2 * x) + 2) + (-cos(x) + sin(` |
| 23 | 2 | `sqrt(tanh(4x) + 1)` | ∅ | ✅ | ∅ | ❌ | `sqrt(2)/4 * artanh(sqrt(2)/2 * sqrt(tanh` |
| 24 | -11 | `tanh(x) / sqrt(e^(2x) + e^x)` | ∅ | ∅ | ∅ | ✅ | `int(tanh(x) / sqrt(e^(2x) + e^x) dx)` |
| 25 | 5 | `sqrt(sinh(2x) / cosh(x))` | ∅ | · | ∅ | ✅ | `(2(-e^(-1/2 * x) * sqrt(e^(4x) - 1) * sq` |
| 26 | -31 | `ln(x^2 + sqrt(1 - x^2))` | ∅ | ∅ | ∅ | ✅ | `int(ln(x^2 + sqrt(1 - x^2)) dx)` |
| 27 | 12 | `ln(e^x + 1) / (e^(2x) + 1)` | ∅ | ∅ | ∅ | ✅ | `int(ln(e^x + 1) / (e^(2x) + 1) dx)` |
| 28 | 13 | `cosh(x) * ln(cosh(x)^2 + 1)^2` | ∅ | ∅ | ∅ | ✅ | `int(cosh(x) * ln(cosh(x)^2 + 1)^2 dx)` |
| 29 | 28 | `cosh(x) * ln(sinh(x) + cosh(x)^2)^2` | ∅ | ∅ | ∅ | ✅ | `int(cosh(x) * ln(sinh(x) + cosh(x)^2)^2 ` |
| 30 | 44 | `ln(x + sqrt(x + 1)) / (x^2 + 1)` | ∅ | ∅ | ∅ | ∅ | `int(ln(x + sqrt(x + 1)) / (x^2 + 1) dx)` |
| 31 | 35 | `ln(x + sqrt(x + 1))^2 / (x + 1)^2` | ∅ | ∅ | ∅ | · | `int(ln(x + sqrt(x + 1))^2 / (x + 1)^2 dx` |
| 32 | 21 | `ln(x + sqrt(x + 1)) / x` | ∅ | ∅ | ∅ | ✅ | `int(ln(x + sqrt(x + 1)) / x dx)` |
| 33 | 7 | `arctan(2tan(x))` | ∅ | ∅ | ∅ | ✅ | `int(arctan(2tan(x)) dx)` |
| 34 | 5 | `(arctan(x) * ln(x)) / x` | ∅ | · | ∅ | ✅ | `-1/2i * PolyLog(3, -i * x) + 1/2i * Poly` |
| 35 | 10 | `sqrt(x^2 + 1) * arctan(x)^2` | ∅ | · | ∅ | ✅ | `1/2 * x * sqrt(x^2 + 1) * arctan(x)^2 - ` |

---
_Reproduce: `npx tsx benchmarks/audit/bondarenko.ts`. One op (indefinite integration), graded by the invariant `d/dx(F) ≈ f`. CE times are from the minified production bundles._
