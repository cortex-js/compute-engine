# Univariate Equation-Solving Benchmark

Adapted from SymPy’s `test_solveset.py` (univariate cases). Each returned root is graded **sound** by substitution (`|residual| < 1e-6`); `finite` solution sets must also be **complete** (cover the reference set), while `infinite` (periodic trig) sets ask only for one sound root. SymPy’s column is its `solve()` outcome.

**✅ correct · 🟡 partial (sound but incomplete) · ❌ wrong · ∅ not solved · ⚠️ runtime error**

| Category | n | CE | CE+Fungrim | SymPy |
|---|--:|--:|--:|--:|
| poly | 7 | 3 | 3 | 7 |
| rational | 3 | 2 | 2 | 3 |
| radical | 5 | 5 | 5 | 5 |
| abs | 4 | 2 | 2 | 4 |
| exp | 4 | 2 | 2 | 4 |
| log | 3 | 2 | 2 | 3 |
| lambert | 4 | 0 | 2 | 4 |
| trig | 4 | 2 | 2 | 4 |
| hyperbolic | 3 | 0 | 0 | 3 |
| frontier | 3 | 0 | 0 | 1 |
| **all** | **40** | **18** | **20** | **38** |

## Cases

| id | equation | set | CE | CE+F | SymPy |
|---|---|---|:-:|:-:|:-:|
| P1 | 3x − 2 = 0 | finite | ✅ | ✅ | ✅ |
| P2 | x² − 1 = 0 | finite | ✅ | ✅ | ✅ |
| P3 | x² − 5x + 6 = 0 | finite | ✅ | ✅ | ✅ |
| P4 | x³ − 6x² + 11x − 6 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| P5 | x³ − 15x − 4 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| P6 | x⁴ − 5x² + 4 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| P7 | x⁵ + x³ + 1 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| R1 | 1/x + 1 = 0 | finite | ✅ | ✅ | ✅ |
| R2 | 2x/(x+2) − 1 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| R3 | 3/(x−2) − 1 = 0 | finite | ✅ | ✅ | ✅ |
| S1 | √x − 2 = 0 | finite | ✅ | ✅ | ✅ |
| S2 | √(5x+6) − 2 − x = 0 | finite | ✅ | ✅ | ✅ |
| S3 | √(x−1) − x + 7 = 0 | finite | ✅ | ✅ | ✅ |
| S4 | √(x−2) − 5 = 0 | finite | ✅ | ✅ | ✅ |
| S5 | ∛x − 3 = 0 | finite | ✅ | ✅ | ✅ |
| A1 | |x| − 2 = 0 | finite | ✅ | ✅ | ✅ |
| A2 | |x+3| − 2|x−3| = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| A3 | 2|x| − |x−1| = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| A4 | |2x+1| − 3 = 0 | finite | ✅ | ✅ | ✅ |
| E1 | 2ˣ − 8 = 0 | finite | ✅ | ✅ | ✅ |
| E2 | eˣ − 5 = 0 | finite | ✅ | ✅ | ✅ |
| E3 | eˣ + e⁻ˣ − 4 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| E4 | 3·2ˣ − 24 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| L1 | ln x − 2 = 0 | finite | ✅ | ✅ | ✅ |
| L2 | ln((x−1)(x+1)) = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| L3 | log₂ x − 3 = 0 | finite | ✅ | ✅ | ✅ |
| W1 | x·eˣ − 1 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ | ✅ |
| W2 | eˣ + x = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| W3 | x + 2ˣ = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| W4 | x·eˣ − 3 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ | ✅ |
| T1 | arctan x − 1/2 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| T2 | arcsin x − 1/3 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| T3 | sin x − 1/2 = 0 (infinite) | infinite | ✅ | ✅ | ✅ |
| T4 | 2cos x − 1 = 0 (infinite) | infinite | ✅ | ✅ | ✅ |
| H1 | sinh x − 1 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| H2 | cosh x − 2 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| H3 | tanh x − 1/2 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| FR1 | x − cos x = 0 (Dottie) | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ∅ |
| FR2 | eˣ − x − 2 = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ✅ |
| FR3 | x² − cos x = 0 | finite | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ⚠️ _(Cannot read properties of undefined (reading 'rules'))_ | ∅ |
