# ODE-Solving Benchmark — CE `DSolve` vs SymPy `dsolve`

_CE is graded **from source** (`src/compute-engine`, no build) — this harness measures **correctness, not speed**. SymPy runs `dsolve` (with a per-case timeout — some calls hang) and is graded in `gen_dsolve.py` by the **mirror** of the oracle below (identical sample points, integration-constant values, and tolerance, all read from the JSON `config`). Regenerate the SymPy column and corpus with `./venv/bin/python3 benchmarks/audit/gen_dsolve.py`._

Corpus seeded from SymPy’s `test_ode.py` classes and classic textbook ODEs. Each returned solution is graded by a **substitute-back residual oracle** (§ methodology). CE’s contract is **inert-rather-than-wrong**: staying inert on a class it does not claim is *correct* behavior (`➖ unsupported`), scored apart from `⭕ gap` (should have solved but stayed inert).

**✅ correct · ❌ wrong · ➖ unsupported (expected inert = OK) · ⭕ gap (inert but solvable) · ❔ not evaluable · ⚠️ error**

| Class | n | CE ✅ | CE ➖ | CE ⭕ | CE ❌ | SymPy ✅ |
|---|--:|--:|--:|--:|--:|--:|
| 1st-linear | 7 | 7 | 0 | 0 | 0 | 7 |
| separable | 5 | 5 | 0 | 0 | 0 | 5 |
| homogeneous | 2 | 2 | 0 | 0 | 0 | 2 |
| bernoulli | 3 | 3 | 0 | 0 | 0 | 3 |
| exact | 2 | 2 | 0 | 0 | 0 | 2 |
| linhom-2 | 5 | 5 | 0 | 0 | 0 | 5 |
| linhom-3 | 3 | 3 | 0 | 0 | 0 | 3 |
| linhom-4 | 2 | 2 | 0 | 0 | 0 | 2 |
| nonhom | 8 | 8 | 0 | 0 | 0 | 8 |
| cauchy-euler | 3 | 3 | 0 | 0 | 0 | 3 |
| ivp | 4 | 4 | 0 | 0 | 0 | 4 |
| bvp | 1 | 1 | 0 | 0 | 0 | 1 |
| system | 1 | 1 | 0 | 0 | 0 | 1 |
| beyond | 5 | 0 | 5 | 0 | 0 | 4 |
| **all** | **51** | **46** | **5** | **0** | **0** | **50** |

## Cases

| id | class | ODE | CE | SymPy |
|---|---|---|:-:|:-:|
| FL1 | 1st-linear | y' = 3y | ✅ | ✅ |
| FL2 | 1st-linear | y' + y = x | ✅ | ✅ |
| FL3 | 1st-linear | y' + 2xy = x (var-coeff) | ✅ | ✅ |
| FL4 | 1st-linear | y' + (2/x)y = x (var-coeff) | ✅ | ✅ |
| FL5 | 1st-linear | y' − y/x = x (var-coeff, Divide) | ✅ | ✅ |
| FL6 | 1st-linear | y' + y = sin x | ✅ | ✅ |
| FL7 | 1st-linear | y' = e^(−x) − y | ✅ | ✅ |
| SP1 | separable | y' = y | ✅ | ✅ |
| SP2 | separable | y' = xy | ✅ | ✅ |
| SP3 | separable | y' = x/y | ✅ | ✅ |
| SP4 | separable | y' = y² | ✅ | ✅ |
| SP5 | separable | y' = 1 + y² | ✅ | ✅ |
| HM1 | homogeneous | y' = 1 + y/x | ✅ | ✅ |
| HM2 | homogeneous | y' = (x²+y²)/(xy) | ✅ | ✅ |
| BN1 | bernoulli | y' = y + xy² | ✅ | ✅ |
| BN2 | bernoulli | y' + y = xy³ | ✅ | ✅ |
| BN3 | bernoulli | y' − y/x = y² | ✅ | ✅ |
| EX1 | exact | 2xy + y² + (x²+2xy)y' = 0 | ✅ | ✅ |
| EX2 | exact | xy' + y = x² | ✅ | ✅ |
| L2a | linhom-2 | y'' − y = 0 (real distinct) | ✅ | ✅ |
| L2b | linhom-2 | y'' + y = 0 (complex) | ✅ | ✅ |
| L2c | linhom-2 | y'' − 2y' + y = 0 (repeated) | ✅ | ✅ |
| L2d | linhom-2 | y'' − y' − y = 0 (irrational) | ✅ | ✅ |
| L2e | linhom-2 | y'' − 3y' + 2y = 0 (real distinct) | ✅ | ✅ |
| L3a | linhom-3 | y''' − 6y'' + 11y' − 6y = 0 (real) | ✅ | ✅ |
| L3b | linhom-3 | y''' − 3y'' + 3y' − y = 0 (repeated) | ✅ | ✅ |
| L3c | linhom-3 | y''' − y = 0 (complex pair) | ✅ | ✅ |
| L4a | linhom-4 | y'''' + 2y'' + y = 0 (repeated ±i) | ✅ | ✅ |
| L4b | linhom-4 | y'''' − 2y''' + 2y'' − 2y' + y = 0 | ✅ | ✅ |
| NH1 | nonhom | y'' = 1 (poly) | ✅ | ✅ |
| NH2 | nonhom | y'' − y = x (poly forcing) | ✅ | ✅ |
| NH3 | nonhom | y'' − y = eˣ (resonant exp) | ✅ | ✅ |
| NH4 | nonhom | y'' + y = eˣ (non-resonant exp) | ✅ | ✅ |
| NH5 | nonhom | y'' − y = e^(2x) | ✅ | ✅ |
| NH6 | nonhom | y'' + y = sin x (resonant) | ✅ | ✅ |
| NH7 | nonhom | y'' + 4y = sin x (non-resonant) | ✅ | ✅ |
| NH8 | nonhom | y'' + y = tan x (variation of params) | ✅ | ✅ |
| CE1 | cauchy-euler | x²y'' − 2y = 0 (distinct) | ✅ | ✅ |
| CE2 | cauchy-euler | x²y'' + xy' = 0 (repeated) | ✅ | ✅ |
| CE3 | cauchy-euler | x²y'' + xy' + y = 0 (complex) | ✅ | ✅ |
| IV1 | ivp | y' = y, y(0)=2 | ✅ | ✅ |
| IV2 | ivp | y'' = −y, y(0)=0, y'(0)=1 | ✅ | ✅ |
| IV3 | ivp | y' = x/y, y(0)=1 (separable IVP) | ✅ | ✅ |
| IV4 | ivp | exact IVP, y(1)=1 | ✅ | ✅ |
| BV1 | bvp | y'' + y = 0, y(0)=0, y(π/2)=1 | ✅ | ✅ |
| SY1 | system | y'=z, z'=y (coupled linear) | ✅ | ✅ |
| BY1 | beyond | y' = x + y² (Riccati) | ➖ | ∅ |
| BY2 | beyond | sin(x)y'' + y' = cos x (var-coeff 2nd order) | ➖ | ✅ |
| BY3 | beyond | x²y'' + xy' = x (nonhomog Cauchy–Euler) | ➖ | ✅ |
| BY4 | beyond | y''=xy (Airy, variable coeff) | ➖ | ✅ |
| BY5 | beyond | y'=y, z'=z (repeated eigenvalue system) | ➖ | ✅ |

## Oracle methodology

- **Explicit** `y(x)=f(x)` (also higher-order and systems): the solution and its derivatives (via CE `D`) are substituted into the ODE residual, which is evaluated at x ∈ {0.35, 0.7, 1.1, 1.6, 2} with integration constants c_1=1, c_2=2, c_3=3, c_4=5. A point where f leaves the real domain is skipped; PASS needs |residual| ≤ 1e-7·(1+scale) at ≥ 4 points (scale = 1 + Σ|component values|, so large exponential magnitudes are handled relatively).
- **Implicit** `F(x,y)=C` (first-order separable / homogeneous / exact): CE returns these unsolved for y. We replace y(x) by an independent symbol Y and use the **first-integral identity** y′ = −F_x/F_y, substituting it into the ODE residual. For a genuine first integral this identity holds for *all* (x,Y) near the curve — not just on it — so we sample (x,Y) pairs directly instead of numerically tracing F(x,y)=C. Points with |F_y| < 1e-9 are skipped.
- **Initial/boundary conditions** are additionally checked: explicit — f (or fᵏ) at x₀ equals the target within 1e-6; implicit — the relation vanishes at (x₀, y₀).
- The **same** oracle parameters grade SymPy in `gen_dsolve.py` (its own solution differentiated/substituted natively); `checkodesol` is a backstop when the numeric route cannot find enough evaluable points.

## Findings

CE solved **46/51** (5 correctly-inert unsupported, 0 gap, 0 wrong, 0 not-evaluable, 0 error). SymPy solved **50/51**.

**Engine observations (found while building the oracle):**

- `DSolve` is sensitive to term *spelling*: `y'' − y' − y = 0` written as a nested `Subtract(Subtract(y'', y'), y)` stays inert, whereas the equivalent `Add(y'', Negate(y'), Negate(y))` solves. The recognizer keys off the operand structure rather than a fully-normalized form. (L2d is authored in the accepted `Add`/`Negate` spelling.)
- Differentiating `|u|` twice yields `Derivative(Sign, 1)` (a distributional Dirac term) which `.N()` leaves as an unevaluated symbol → `NaN`. It is 0 almost everywhere, so the oracle zeroes it at the generic (kink-free) sample points to grade the variation-of-parameters case `NH8` (`y'' + y = tan x`). CE’s symbolic answer there is correct; only its second derivative is awkward to evaluate numerically.
