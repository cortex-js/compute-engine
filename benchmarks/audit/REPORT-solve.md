# Univariate Equation-Solving Benchmark

_Runner: **minified production bundles** (`dist/esm-min/*.js`, `console.assert` stripped) — CE times reflect shipped code. Rebuild with `npm run build production` before running._

Adapted from SymPy’s `test_solveset.py` (univariate cases). Each returned root is graded **sound** by substitution (`|residual| < 1e-6`); `finite` solution sets must also be **complete** (cover the reference set), while `infinite` (periodic trig) sets ask only for one sound root. SymPy’s column is its `solve()` outcome; **Mathematica** (the reference baseline) runs `Solve[expr == 0, x]` live via `wolframscript`, graded by the same oracle.

**✅ correct · 🟡 partial (sound but incomplete) · ❌ wrong · ∅ not solved · ⚠️ runtime error**

| Category | n | CE | CE+Fungrim | SymPy | Mathematica |
|---|--:|--:|--:|--:|--:|
| poly | 7 | 7 | 7 | 7 | 7 |
| rational | 3 | 3 | 3 | 3 | 3 |
| radical | 5 | 5 | 5 | 5 | 5 |
| abs | 4 | 4 | 4 | 4 | 4 |
| exp | 4 | 4 | 4 | 4 | 4 |
| log | 3 | 3 | 3 | 3 | 3 |
| lambert | 4 | 0 | 4 | 4 | 4 |
| trig | 4 | 4 | 4 | 4 | 4 |
| hyperbolic | 3 | 3 | 3 | 3 | 3 |
| frontier | 3 | 0 | 0 | 1 | 1 |
| **all** | **40** | **33** | **37** | **38** | **38** |

## Cases

| id | equation | set | CE | CE+F | SymPy | Mathematica |
|---|---|---|:-:|:-:|:-:|:-:|
| P1 | 3x − 2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P2 | x² − 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P3 | x² − 5x + 6 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P4 | x³ − 6x² + 11x − 6 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P5 | x³ − 15x − 4 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P6 | x⁴ − 5x² + 4 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| P7 | x⁵ + x³ + 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| R1 | 1/x + 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| R2 | 2x/(x+2) − 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| R3 | 3/(x−2) − 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| S1 | √x − 2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| S2 | √(5x+6) − 2 − x = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| S3 | √(x−1) − x + 7 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| S4 | √(x−2) − 5 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| S5 | ∛x − 3 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| A1 | |x| − 2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| A2 | |x+3| − 2|x−3| = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| A3 | 2|x| − |x−1| = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| A4 | |2x+1| − 3 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| E1 | 2ˣ − 8 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| E2 | eˣ − 5 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| E3 | eˣ + e⁻ˣ − 4 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| E4 | 3·2ˣ − 24 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| L1 | ln x − 2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| L2 | ln((x−1)(x+1)) = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| L3 | log₂ x − 3 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| W1 | x·eˣ − 1 = 0 | finite | ∅ | ✅ | ✅ | ✅ |
| W2 | eˣ + x = 0 | finite | ∅ | ✅ | ✅ | ✅ |
| W3 | x + 2ˣ = 0 | finite | ∅ | ✅ | ✅ | ✅ |
| W4 | x·eˣ − 3 = 0 | finite | ∅ | ✅ | ✅ | ✅ |
| T1 | arctan x − 1/2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| T2 | arcsin x − 1/3 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| T3 | sin x − 1/2 = 0 (infinite) | infinite | ✅ | ✅ | ✅ | ✅ |
| T4 | 2cos x − 1 = 0 (infinite) | infinite | ✅ | ✅ | ✅ | ✅ |
| H1 | sinh x − 1 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| H2 | cosh x − 2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| H3 | tanh x − 1/2 = 0 | finite | ✅ | ✅ | ✅ | ✅ |
| FR1 | x − cos x = 0 (Dottie) | finite | ∅ | ∅ | ∅ | ∅ |
| FR2 | eˣ − x − 2 = 0 | finite | ∅ | 🟡 _(1/2 roots)_ | ✅ | ✅ |
| FR3 | x² − cos x = 0 | finite | ∅ | ∅ | ∅ | ∅ |
