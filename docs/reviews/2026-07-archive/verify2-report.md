# Verification pass 2 — independent re-verification of P0 findings (+3 numerics P1s)

Verifier: second independent pass. Date 2026-07-01. Tree: main @ 9b818ec8 + user's uncommitted
perf WIP (`src/big-decimal/{big-decimal,transcendentals}.ts`, `boxed-expression/{solve,polynomials}.ts`,
`benchmarks/*`, `test/big-decimal/*` — untouched). All repros re-derived from the findings'
descriptions (not the original scripts), run fresh via `timeout N npx tsx` from the repo root;
scripts in this directory (`a-kernels.ts` … `g-misc.ts`, `refs.py`). All references computed
independently with mpmath 1.3.0 (`./venv/bin/python3`) at dps 60 (≥10 guard digits); C1 truths
verified by `mpmath.quad` AND closed forms; C3 truths by mpmath evaluation at x = 1e20…1e40.
Correct-digit counts = −log10(relative error) vs my own mpmath reference.

Note: the symbolic limit engine (`src/compute-engine/symbolic/limit.ts`, landed af554761) IS on
this tree (af554761 is an ancestor of HEAD; latest touch 1ea39439), so C3 was verified at HEAD.

## Verdict table

| Source | ID | Claim (one line) | Verdict | Observed (this pass) |
|---|---|---|---|---|
| numerics | P0-1 | polygamma machine+bignum: Bernoulli terms missing (n−1)! → wrong from digit ~4–9 for n≥3 | **CONFIRMED** | machine `polygamma(3,2.5)` = 0.22386407493324287 (3.7 digits; ref 0.22390584881725205); `polygamma(5,10)` = 3.002477e-4 (1.7 digits; ref 3.0594516e-4); CE @50 `PolyGamma(3,2.5).N()` = 0.22390584838156011711… (8.7 digits, then garbage) |
| numerics | P0-2 | machine `zeta` only ~7 digits everywhere (wrong acceleration coefficients); ζ(30) < 1 | **CONFIRMED** | `zeta(3)` = 1.2020567979884007 (7.1 digits; ref 1.2020569031595943); `zeta(0.5)` 8.3 d; `zeta(15)` 6.6 d; `zeta(-11)` 6.6 d; `zeta(30)` = 0.999999762512753 — wrong side of 1 (ref 1.0000000009313274); CE `precision='machine'` `Zeta(3).N()`/`Zeta(30).N()` return the same values |
| numerics | P0-3 | machine `besselK` catastrophic cancellation for 3 < x ≤ 40; K₂(20) factor ~21 wrong | **CONFIRMED** | `besselK(2,20)` = 1.356357769042159e-8 vs ref 6.3295436122922281e-10 → **20.4× too large** (−1.3 digits); `besselK(0,10)` 6.7 digits; `besselK(1,5)` 12.0 digits; CE @50 `BesselK(2,20).N()` = 1.356357769042159e-8 (same wrong value at any precision) |
| numerics | P0-4 | machine `besselIAsymptotic` sign of odd terms flipped → 2–4 digits for x > 40 | **CONFIRMED** | `besselI(0,100)` = 1.0710705410356021e42 vs ref 1.0737517071310738e42 (2.6 digits); `besselI(0,700)` 3.4 digits; CE @50 `BesselI(0,100).N()` returns the machine value dressed as a 43-digit integer |
| numerics | P0-5 | machine Airy: negative-x asymptotic leading-term-only (1.6–3.3 digits at −10); positive side ~7.5 digits | **CONFIRMED** | `airyAi(-10)` = 0.03920869208237318 vs ref 0.04024123848644319 (1.6 digits); `airyBi(-10)` = −0.31483504041666605 vs ref −0.31467982964383863 (3.3 digits); `airyAi(10)` 7.6 digits; CE @50 `AiryAi(-10).N()` = 0.03920869208237318 |
| numerics | P1-7 (#12) | `Root(64,3).N()` ≠ 4 (a.pow(b.pow(−1)) path) while evaluate() = 4 | **CONFIRMED** | @21: `Root(64,3).N()` = 3.99999999999999999999, `.evaluate()` = 4; `Root(125,3).N()` = 4.99999999999999999999; `Power(125,1/3).N()` same; `Math.pow(64,1/3)` = 3.9999999999999996 |
| numerics | P1-8 (#13) | `Root(-4,4).evaluate()` → literal NaN while `.N()` → complex principal root | **CONFIRMED** | `Root(-4,4).evaluate()` = NaN (json literal `"NaN"`); `.N()` = (1 + 0.9999999999999998i) [true 1+i]; identical for `Power(-4,['Rational',1,4])`; control `Sqrt(-4).evaluate()` = 2i stays exact |
| numerics | P1-11 (#16) | `Sin(10^999900).N()` runs ~49 s with `ce.timeLimit = 2000` (deadline never polled in π reduction) | **CONFIRMED** | timeLimit=2000, precision=21: returned after **49,291 ms** (~25× the deadline), no Timeout thrown; result −0.906956587838310306632 (value itself verified correct vs mpmath manual mod-2π reduction — see note below) |
| corpora | C1 | defint of unintegrable integrand: evaluate() → 0 / NaN / drops terms (bound-variable capture via EvaluateAt) | **CONFIRMED** | `∫₋₁¹ √(1−x²)/(1+x²) dx .evaluate()` = **0** (truth π(√2−1) = 1.3012902845685730…, verified by mpmath quad, integrand > 0); `+5` variant → **10** (truth 11.30129); `∫₀¹ (1/ln t + 1/(1−t) − ln ln(1/t)) dt .evaluate()` = **NaN** (truth 2γ = 1.1544313298030657, verified by quad); `.N()` paths fine (1.30103 ± 0.00018, 1.15376 ± 0.00039); control `∫₋₁¹ x² = 2/3` correct |
| corpora | C2 | `.N()` drops square roots of symbolic arguments (Sqrt evaluate handler roots only the numeric coefficient) | **CONFIRMED** | `Sqrt(y).N()` = y; `(y·√y).N()` = y²; `√(4y).N()` = 2y; `√(y³).N()` = y³; `y^(1/3)·√y .N()` = y^(4/3) — all five exactly as claimed |
| corpora | C3 | symbolic limit engine: x·(f(x+a)−f(x)) products collapse to exact 0 | **CONFIRMED** (at HEAD; limit.ts present) | `lim x(ln(x+1)−ln x)` → 0 (truth 1); `lim x(ln(x+2)−ln x)` → 0 (truth 2); `lim x(√(x+1)−√x)` → 0 (truth +∞); `lim x²(ln(x+1)−ln x)` → 0 (truth +∞) — evaluate AND N; controls correct: `x ln(1+1/x)` → 1, `x(arctan(x+1)−arctan x)` → 0. Truths re-verified with mpmath at x=1e20/1e30/1e40 |
| corpora | C4 | canonical Multiply treats any complex literal a+1i as the imaginary unit — real part dropped | **CONFIRMED** | `2·Complex(1,1)` = 2i (truth 2+2i); `5·Complex(2,1)` = 5i (truth 10+5i); `2·Complex(1.1,1)` = 2i; controls fine: `2·Complex(1,2)` = 2+4i, parsed `2(1+i)` = 2+2i |
| corpora | C5 | `log_b(z)` complex, evaluate path: imaginary part = arg z, not divided by ln b | **CONFIRMED** | `Log(1.1+1.1i, 2).evaluate()` = 0.637503523749934967941 + **0.7853981633974483i** (im = arg z = π/4, unscaled); `.N()` = 0.637503523749935 + **1.1330900354567985i** — matches my mpmath ref 0.63750352374993 + 1.13309003545680i; side-note also confirmed: `Log(-1.0,2).N()` = NaN while `Ln(-1.0).N()` = 3.141592653589793i |
| corpora | C6 | `d/dx arcoth(x)` has the wrong sign | **CONFIRMED** | `D(Arcoth(x),x).evaluate()` = −1/(1−x²); at x=2 → **+0.3333** ; truth (mpmath `diff(acoth, 2)`) = **−1/3** |
| corpora | C7 | `|arccot(x)| → arccot(|x|)` unsound under CE's own range-(0,π) Arccot | **CONFIRMED** | `Abs(Arccot(x)).simplify()` = arccot(\|x\|); CE `Arccot(-2).N()` = 2.67794504458898712225 (range (0,π) confirmed), so \|arccot(−2)\| = 2.6779, but `Abs(Arccot(-2)).simplify().N()` = **0.463647609000806** = arccot(2) — off by 2.214 |

**Counts: 14 verified → 14 CONFIRMED, 0 CONFIRMED-VARIANT, 0 NOT-REPRODUCED, 0 BLOCKED, 0 MISJUDGED.**

## Notes

- Every "expected" value in the findings was itself re-derived and checked out: mpmath refs at
  dps 60 for all kernels; C1 truths by quadrature ≡ π(√2−1) and 2γ to 50 digits; C3 truths
  numerically at huge x; C6 by `mpmath.diff`; C7 both arccot conventions computed.
- P1-11 value check: CE's −0.906956587838310306632 — mpmath manual reduction
  (dps 999950, x − ⌊x/2π⌋·2π, 13 s) gives sin(1e999900) = −0.9069565878383103066316838 → CE's
  21 digits are all correct; only the deadline (49.3 s vs 2 s) and the missing Timeout throw are
  the bug. (A direct `mp.dps=999940; sin(mpf('1e999900'))` exceeded a 300 s timeout — the manual
  reduction is the reference used. Aside: mpmath does the same job in 13 s vs CE's 49 s, which
  supports the finding's claim that CE redoes the ~1M-digit reduction multiple times.)
- Incidental corroboration of numerics P1-1 (not in scope, no verdict): at ce.precision=50,
  `BesselK(2,20).N()` / `AiryAi(-10).N()` / `BesselI(0,100).N()` all return machine-precision
  values presented as high-precision numbers (BesselI shows 43 integer digits of which ~2.6 are
  correct).
- WIP interaction: none needed — everything reproduced, so no finding required checking whether
  the user's uncommitted big-decimal/solve/polynomials WIP masked it.
- C1's `.N()` uncertainty bar looks slightly optimistic (1.30103 ± 0.00018 vs truth 1.30129,
  true error 2.6e-4) — consistent with the corpora reviewer's C15; not re-graded here.
