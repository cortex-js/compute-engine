# Corpora-as-Oracles Correctness Review — Findings

Executed 2026-07-01 against `main` @ `9b818ec8`. Reviewer area: the benchmark/audit corpora as
correctness oracles (run harnesses, mine wrong answers, audit test expectations).

**Method.** All four harness families re-run at HEAD (audit / Wester / solve / capability, all with
live SymPy + Mathematica legs). Harness verdicts matched the committed baselines, so the yield came
from **independent re-grading**: a scratch dumper re-ran the Wester defint/limit/solve legs and
compared CE's *concrete* outputs (not just solved-status) against mpmath references; the delegated
test-suite sweep audited asserted expectations; every headline finding was **re-verified on the
pristine published 0.59.0 bundle** to rule out contamination from other reviewers' concurrent WIP
(the working tree gained uncommitted edits to `src/big-decimal/*`, `boxed-expression/solve.ts`, and
the audit harness scripts *during* this session — none of these files are cited by any finding
below, and every P0 that predates the session reproduces on the untouched 0.59.0 bundle).

Cross-reference: nothing below duplicates SYMBOLIC_FINDINGS.md (checked against its P0-1…P0-16 and
P1/P2 lists); overlaps are cited explicitly (C7→P0-1 class, C17→P0-8).

---

## Harness-run summary

| Harness | Invocation | Result at HEAD | vs committed baseline |
|---|---|---|---|
| Operation audit (22 cases) | `venv python benchmarks/audit/gen.py && npx tsx benchmarks/audit/audit.ts` | CE 22/22, SymPy 22/22, MMA 22/22 | identical verdicts (timing-only diffs) |
| Wester (48 of 533 stmts) | `npx tsx benchmarks/audit/wester.ts` (~28 min; see C12) | CE 26/48 · CE+R/F 32/48 · SymPy 36/48 · MMA 44/48 | byte-identical report |
| Solving (40 cases) | `venv python benchmarks/audit/gen_solve.py && npx tsx benchmarks/audit/solve.ts` | CE 24/40 · CE+F 26/40 · SymPy 38 · MMA 38 | identical verdicts |
| Capability (53 cases incl. changelog-only) | `npm run build production; venv python benchmarks/gen_cases.py; node benchmarks/report.mjs` | CE·cur: 0 wrong, 3 unevaluated (CR1–3, Rubi-only by design) | no regressions |

Skipped: `report_marketing.mjs`/`report_changelog.mjs` (pure re-rendering of results.json — no new
verdicts), `big-decimal/*` microbench and `python-performance.py` (perf-only, out of scope).
Mathematica legs ran live (`wolframscript` 14.3 licensed, on PATH); SymPy/NumPy from `./venv`;
math.js and CE-0.59.0 from `benchmarks/.competitors/`. All regenerated tracked report/case files
were **restored to their committed state** afterwards (fresh copies preserved in this scratch dir
under `fresh/`); the only working-tree modifications remaining are other reviewers' WIP.

**Classification tallies (CE non-passes, all harnesses):**
- (a) WRONG ANSWER: **0 as graded by the harnesses** — but **2 hidden wrongs** exposed by
  independent re-grading of the Wester definite integrals (evaluate() returns `0` / `NaN` for
  convergent integrals — finding C1), plus 2 wrong-limit values (`0` for Gruntz limits) that exist
  **only on published 0.59.0** (fixed-by-unsolved at HEAD — C12), plus 4 systematic wrong limits at
  HEAD found by one-hop extension probes of the Wester limit family (C3).
- (b) wrong-by-convention: 0 in the corpora.
- (c) capability gaps: Wester 20 (7 indefinite ∫, 6 recovered by Rubi; 3 defint stay-symbolic;
  2 Gruntz limits; 8 solve incl. one 🟡 partial root set) · solve.ts 16 (14 with Fungrim: Lambert
  W1/W4 recovered) · capability 3 (CR1–3). All previously known; none re-reported as findings.
- (d) reference/harness bugs: 0 reference errors (all references I re-derived check out:
  π(√2−1), 2γ, solve root sets, Wester poly roots via `mpmath.polyroots`). Two harness *grading
  blind spots* (C13) that masked C1. No CE+SymPy-agree-vs-reference-disagree cases.

---

## P0 — wrong values/expressions (all independently verified; all reproduce on 0.59.0 unless noted)

### C1. Definite integral of an unintegrable integrand: `evaluate()` returns 0 / NaN / silently drops terms
**Corpus evidence:** Wester `test_definite_integrals` #11 and #12 (graded ∅ by the harness, actually wrong).
```
∫₋₁¹ √(1−x²)/(1+x²) dx           .evaluate() → 0      truth π(√2−1) = 1.30129… (mpmath; integrand > 0!)  .N() → 1.30129 ✓
∫₋₁¹ (√(1−x²)/(1+x²) + 5) dx     .evaluate() → 10     truth 11.30129… (the hard part silently dropped)
∫₀¹ (1/ln t + 1/(1−t) − ln ln(1/t)) dt  .evaluate() → NaN   truth 2γ = 1.15443… (mpmath)
```
Repro: `ce.expr(['Integrate', ['Divide',['Sqrt',['Subtract',1,['Power','x',2]]],['Add',1,['Power','x',2]]], ['Tuple','x',-1,1]]).evaluate()`.
**Root cause chain:**
1. `src/compute-engine/library/calculus.ts:423-431` — when `antiderivative()` fails (returns an
   inert `Integrate`), the code still wraps it: `EvaluateAt(Function(int f dx, x), a, b)` and (line
   441) evaluates it.
2. `src/compute-engine/library/core.ts:810-824` (`EvaluateAt.evaluate`) applies the function to
   each bound. Beta-reducing `Function(Integrate(f, x), x)` at `x=1` **captures the integration
   variable** (bound-variable capture): the integrand evaluates under `x:=1`, e.g. `√(1−1²)=0`, and
   the indefinite integral of the now-constant `0` evaluates to `0` — no `Integrate` node remains,
   so the `has('Integrate')` stall-guard (core.ts:800, 820-821) passes and `F(b)−F(a) = 0−0 = 0`.
   (Direct check: `Apply(Function(Integrate(f,x),x), 1).evaluate() → 0`.)
3. The trigger is any integrand whose unintegrable part evaluates to a *constant that erases the
   Integrate node* at both bounds — 0 at ±1 for #11; ∞→NaN at t=1 for #12; additive splits leak
   partial antiderivatives (the `+5` case → 10).
**Why the harness missed it:** `wester.ts` grades defint by `numOf(build())` (N-path, which is
correct via quadrature) and "finite value = correct" (see C13).
**Fix direction:** in calculus.ts, when the antiderivative is inert, return the inert *definite*
`Integrate` (keep the `Tuple` limits) instead of building `EvaluateAt`; independently, function
application must treat the integration variable of an inner inert `Integrate` as shadowed (the
known function-literal capture area). Belt-and-braces: check `f.has('Integrate')` **before** apply,
not only after.
**Test:** the three repros above (evaluate stays symbolic or exact; never 0/10/NaN); keep
`∫₋₁¹ x² dx = 2/3` (antiderivative-exists path).
**Status:** reproduces on published 0.59.0 (`evaluate → 0`) — long-standing, ships today.

### C2. `.N()` silently drops square roots of symbolic arguments
**Corpus evidence:** found root-causing the `canonical-form.test.ts` snapshot flagged by the test sweep.
```
Sqrt(y).N()      → y        (truth y^0.5)
(y·√y).N()       → y^2      (truth y^1.5)   — test-LOCKED at test/compute-engine/canonical-form.test.ts:936-937
√(4y).N()        → 2y       (truth 2√y)
√(y³).N()        → y^3      (truth y^1.5)
y^(1/3)·√y .N()  → y^(4/3)  (truth y^(5/6))
```
**Root cause:** `src/compute-engine/library/arithmetic.ts:1472-1474` — Sqrt's evaluate handler under
`numericApproximation` does `const [c, rest] = x.toNumericValue(); return engine.number(c.sqrt().N()).mul(rest)`
— the root is applied **only to the numeric coefficient**; the symbolic `rest` is multiplied back
un-rooted.
**Fix:** `.mul(rest.sqrt())` (or return `x.sqrt()` when `rest` isn't 1). Fix the canonical-form
snapshot (its own eval-auto rows show the correct `y^(3/2)`).
**Test:** all five repros. **Status:** reproduces on 0.59.0.

### C3. Symbolic limit engine: products with difference factors `f(x+a)−f(x)` collapse to exact 0
**Corpus evidence:** one-hop probes of the Wester limit family (the two Gruntz cases are the same
shape). HEAD-only (the symbolic limit engine landed `af554761`, 2026-06-13 — **unreleased**, would
ship next release).
```
lim_{x→∞} x·(ln(x+1) − ln x)    evaluate AND N → 0   truth 1
lim_{x→∞} x·(ln(x+2) − ln x)    → 0                  truth 2
lim_{x→∞} x·(√(x+1) − √x)       → 0                  truth +∞
lim_{x→∞} x²·(ln(x+1) − ln x)   → 0                  truth +∞
lim_{x→∞} x·ln(1 + 1/x) → 1 ✓   x·(arctan(x+1)−arctan x) → 0 ✓ (correct: same form, true 0)
```
**Root cause:** `src/compute-engine/symbolic/limit.ts` — `limitProductAtPosInf` (:379-404) moves the
decaying difference into a denominator as its reciprocal, then `limitRatioAtPosInf` (:290-329):
`compareGrowth`/`leadingOrder` mis-rank `x` vs `1/(ln(x+1)−ln x)` as "numerator grows slower" and
return `ce.Zero` at :308. The `hasCancellation` guard (:298) catches `e^a − e^x` but not log/sqrt
differences (which cancel in the *leading order* computation, not numerically).
**Fix direction:** make `leadingOrder` of a sum whose leading terms cancel return the *next* order
(or bail to the numeric limit, as the cancellation guard intends); extend `hasCancellation` to
`Ln(x+a)−Ln(x)` / `√(x+a)−√x` shapes.
**Test:** the four wrong repros + the two correct controls above.

### C4. Canonical `Multiply` treats any complex literal `a+1i` as the imaginary unit — real part dropped
**Corpus evidence:** test-suite sweep item, root-caused and re-verified.
```
['Multiply', 2, ['Complex',1,1]]   → 2i     truth 2+2i    (test-LOCKED: arithmetic.test.ts:352 @fixme + :362; snapshots :637/:647)
['Multiply', 5, ['Complex',2,1]]   → 5i     truth 10+5i
['Multiply', 2, ['Complex',1.1,1]] → 2i     truth 2.2+2i
(2·Complex(1,2), 2·Complex(2,2), 2·Complex(1,-1) … all correct — only im === 1 literals affected)
```
**Root cause:** `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:1064` — the "is the next
factor the imaginary unit?" check is `nextNv.im === 1` **without `re === 0`**, so `n·(a+i)` is
rewritten to `Complex(0, n)`.
**Fix:** `else if (nextNv.im === 1 && nextNv.re === 0)`. Update the two locked snapshots (the
@fixme at :352 complains about NaN-mode, not this — it currently locks the wrong value as passing).
**Status:** reproduces on 0.59.0. Note `ce.parse('2(1+i)')` is correct (different path) — only the
`Complex`-literal product form is hit.

### C5. `log_b(z)` for complex z, evaluate path: imaginary part not divided by ln(base)
**Corpus evidence:** test-suite sweep item, root-caused and re-verified.
```
Log(1.1+1.1i, 2).evaluate() → 0.63750 + 0.78540i     (im = arg z, unscaled)
Log(1.1+1.1i, 2).N()        → 0.63750 + 1.13309i ✓   (mpmath: 0.637503… + 1.133090…i)
```
The N-rows in the same snapshots are correct, so evaluate and N assert different values for the
same expression (locked: `arithmetic.test.ts:779, 789, 801` + snapshot lines 382-390/439-447/537-544).
**Root cause:** `src/compute-engine/numeric-value/machine-numeric-value.ts:517-522` and
`src/compute-engine/numeric-value/big-numeric-value.ts:610-613` — with a base, the real part is
`ln|z|/ln b` but the imaginary part stays `arg z` instead of `arg z / ln b`.
**Related inconsistency (same functions):** `Log(-1.0, 2) → NaN` while `Ln(-1.0) → iπ` — the
negative-real-with-base path bails to NaN (machine-numeric-value.ts:503 vs :505).
**Fix:** divide the argument by `ln(base)`; route negative reals with base through the complex path.
**Status:** reproduces on 0.59.0.

### C6. `d/dx arcoth(x)` has the wrong sign
```
D(Arcoth(x), x) → −1/(1−x²)  (= +1/3 at x=2)      truth acoth′ = 1/(1−x²) (= −1/3 at x=2; mpmath diff)
```
**Root cause:** `src/compute-engine/symbolic/derivative.ts:119` —
`Arcoth: ['Negate', ['Power', ['Subtract', 1, ['Power','_',2]], -1]]`; the `Negate` is spurious
(artanh and arcoth have the *same* derivative expression, on disjoint domains; line for Arctanh is
correct). Test-LOCKED: `test/compute-engine/derivatives.test.ts:240-244`.
**Fix:** drop the Negate; fix the test. **Status:** reproduces on 0.59.0.

### C7. `|arccot(x)| → arccot(|x|)` unsound under CE's own Arccot convention
```
Abs(Arccot(x)).simplify() → arccot(|x|)
CE's Arccot(−2).N() = 2.6779 (range (0,π), atan2-based) ⇒ |arccot(−2)| = 2.6779 ≠ arccot(2) = 0.4636
```
**Root cause:** `src/compute-engine/symbolic/simplify-abs.ts:24` — `'Arccot'` is in `ODD_TRIG`, but
CE's Arccot (`boxed-expression/trigonometry.ts` atan2(1,x)) is **not odd** (not even sign-symmetric).
Same defect *class* as SYMBOLIC_FINDINGS P0-1 (Sin/Tan/Cot/Csc) but a distinct member P0-1 does not
flag (it verified the inverse functions OK — Arccot escaped because oddness depends on the chosen
range). Test-LOCKED: `simplify.test.ts:610`, `simplify-noskip.test.ts:700` — mutually inconsistent
with the same files asserting `arcctg(−∞) = π` (simplify.test.ts:730). Bonus inconsistency (from the
test sweep): the JS compile target uses `atan(1/x)` — the odd convention — so simplify and compile
disagree about what Arccot *is*.
**Fix:** remove Arccot from ODD_TRIG (fold into the P0-1 fix); pick one Arccot convention engine-wide.
**Status:** reproduces on 0.59.0.

---

## P1 — wrong under the stated domain / no justifying convention

### C8. `d/dx Mod(x, 5) → 0` (truth: 1 a.e.)
CE's `Mod` is the real sawtooth (`((a%b)+b)%b`, library/arithmetic.ts), so the derivative is 1
almost everywhere (2x a.e. for `Mod(x², y)`), not 0. Mathematica: `D[Mod[x,5],x] = 1`.
**Root cause:** `src/compute-engine/symbolic/derivative.ts:545-548` lumps `Mod` with `GCD`/`LCM`
(integer-only, defensibly 0) as "discrete → derivative 0". Test-LOCKED:
`derivatives.test.ts:658-668`. **Fix:** derivative of `Mod(f, c)` w.r.t. x is `f′` a.e.

### C9. `Quartiles` mixes exclusive/inclusive halves — asymmetric quartiles, matches no convention
```
Quartiles([1..9]) → (2.5, 5, 7); IQR → 4.5
Tukey hinges: (3, 5, 7) → IQR 4 · Moore–McCabe: (2.5, 5, 7.5) → IQR 5 · linear-interp (R-7): IQR 4
```
Q1 is computed median-exclusive, Q3 median-inclusive — asymmetric for symmetric data (Q1+Q3 ≠ 2·median).
**Root cause:** `src/compute-engine/numerics/statistics.ts:261-270` — `quartiles()` slices
`sorted.slice(0, mid)` (excludes median for odd n) but `sorted.slice(mid)` (includes it); same in
`bigQuartiles` (:272-283). Test-LOCKED: `arithmetic.test.ts:2167-2174` (asserts IQR 4.5).
**Fix:** `slice(mid + (n % 2))` for the upper half (Moore–McCabe) or `slice(0, mid+1)`/`slice(mid)`
(Tukey) — either is standard; today's mix is neither.

### C10. `KroneckerDelta(0) → 0` (standard: δ_j = δ_{j,0} ⇒ δ(0) = 1; Mathematica: 1)
2-arg form is fine (`KroneckerDelta(0,0) → 1`). **Root cause:** unary case treated as a Boole of
the argument, `src/compute-engine/library/logic.ts:206ff`. Test-LOCKED: `logic.test.ts:127`.

### C11. Alternating-binomial Sum closed forms applied outside their validity range
```
ce.declare('b','integer'); Sum((−1)^k·C(b,k), k=0..b).simplify() → 0    wrong at b=0 (sum = 1)
Sum((−1)^k·k·C(b,k), k=0..b).simplify() → 0                            wrong at b=1 (sum = −1)
```
**Root cause:** `src/compute-engine/symbolic/simplify-sum.ts:275-298` (comment says "for n > 0",
code never checks) and `:401-431` (comment says "for n >= 2", unchecked); `b` is declared only
`integer`. Test-LOCKED: `arithmetic.test.ts:1079-1090, 1279-1290`.
**Fix:** guard on `n.isPositive` / `n ≥ 2` (or return `Boole`-style piecewise).

---

## P2 — released-version wrongs now masked, harness blind spots, robustness

### C12. Published 0.59.0 returns **wrong 0** for the Gruntz/Wester limits; HEAD replaces it with a ~18-minute unsolved grind
- 0.59.0: `Limit[(Exp[x·e^{−x}/(e^{−x}+e^{−2x²/(x+1)})] − eˣ)/x, x→∞].N() → 0` (truth −e²) and the
  `x ln x ln(x eˣ−x²)²/ln ln(x²+2e^{e^{3x³ ln x}})` tower `.N() → 0` (truth 1/3) — both in 3 ms.
- HEAD: same cases return NaN/unevaluated (defensible "don't know") — but the tower case burns
  **~18 min CPU** in `Limit(...).N()` before giving up (measured twice; the wester.ts harness run
  takes ~28 min mostly on this one case, `timeit` calls it repeatedly). Files: the numeric-limit
  fallback under `src/compute-engine/numerics/` (richardson extrapolation) evaluating doubly
  exponential towers at huge probe points with BigDecimal.
- Ask: a time/size bound on numeric limit probing (the 2 s evaluation deadline evidently does not
  cover this path), plus a regression test asserting the Gruntz cases never return a finite value
  other than the truth. (Perf aspect may overlap PERFORMANCE_FINDINGS; the *wrong-0-on-release* and
  the missing-deadline aspects are correctness-adjacent and new.)

### C13. Harness grading blind spots that hid C1 (benchmarks/audit/wester.ts)
- defint/limit are graded "finite value = correct" on the **N-path only** (`wester.ts:361-366`,
  `numOf(build())`); a wrong *symbolic* `evaluate()` result (C1's `0`) is never seen. Suggest: also
  evaluate() each defint and flag evaluate-vs-N disagreement (that exact check found C1 and C5).
- `numOf` parses `N().toString()` — an uncertainty-annotated result (`1.30129 ± 0.0002`) parses to
  NaN → graded "unsolved" even though N is fine. (This is why Wester #11 showed ∅ rather than ✓/❌.)

### C14. Warm single-process benchmark column: 200-digit Γ(1/3)/ψ(1/3) come back with ~181 digits
`results.json` at HEAD: `CN7`/`CN8` are `partial ~181 digits` in the `ce-warm`/`ce-rubi` columns
(one warm process, precision reset per case) while the cold `ce-current` column is fully correct.
Indicates precision-dependent state (constant/function caches?) leaking across precision changes in
one engine/process. Worth an engine-side look (independent of the benchmark): compute at 21 digits,
raise precision to 230, recompute — do Γ/ψ return full precision?

### C15. Wester defint N error-bar slightly optimistic on endpoint-singular integrands
`∫₁² √(x+1/x−2) dx → 0.390424 ± 0.000064` vs truth `(4−2√2)/3 = 0.390524…` — true error 1.6× the
stated bound. Minor uncertainty-underestimate; not a wrong digit claim at display precision.

### C16. `evaluate()` can throw an uncaught `CancellationError` through the public API
`Sum((−1)^k·C(b,k), k=0..b).evaluate()` (b symbolic integer) throws
`CancellationError: Timeout exceeded (2000ms)` from `library/arithmetic.ts:2091` /
`common/interruptible.ts:125` instead of returning the unevaluated Sum. API-contract question:
callers (incl. the audit harnesses) expect evaluate() to return, not throw, on deadline.

### C17. Cross-references into SYMBOLIC_FINDINGS (no re-report, new test-lock info only)
- `verify.test.ts:60, 71` **test-locks** the P0-8 semantics (`verify(Equal(x,y)) → false` for
  satisfiable equalities); fixing P0-8 must update these two assertions.
- The log-expansion subdomain family (ln x + ln y → ln(xy) etc. on unconstrained symbols; locked at
  `branch-cut-safe.test.ts:84-88, 135-136` as documented-"optimistic") is the P0-2/P0-4 class —
  convention, deliberate, but the docs label lives only in a test comment.
- `e^{ln(x)/3} → x^{1/3}` (simplify.test.ts:503, 537): Root (real, sign-preserving) vs principal
  power mismatch at x=−8 (LHS = 1+1.732i principal, RHS = −2) — same real-only-rewrite class as P0-4.
- `calculus.test.ts:829-831`: ∫cot³x result contains `ln(sin|x|)` (≠ ln|sin x| outside (−π,π)) —
  |·|-placement cousin of P0-1; numeric in-test checks stay inside the valid interval.

### C18. Test-sweep results with no engine bug (for the record)
Delegated full-suite audit (independent, 4 sub-verifications) found the P0 items folded into
C2/C4/C5/C6/C8/C9/C10/C11 above, plus: solve.test.ts roots all sound (back-substituted at 60 dps);
special-functions reference constants wrong from the ~9th digit but inside test tolerances;
linear-algebra eigenvalue *comment* wrong ((7,5,3) vs true 5±√3, 5) with passing assertions;
`Zeta(1).N() → +oo` vs `~oo` for Γ-poles (convention inconsistency, documented). Areas swept clean:
expand/factor/partial-fraction, trigonometry/fu, number-theory/combinatorics, units, integration
(antiderivatives differentiated back), differential-equations, statistics beyond C9.

---

## What was verified where (traceability)

- mpmath (venv, dps 30-40): π(√2−1), 2γ, `polyroots` for Wester equations #25/#26, defint 0.390524,
  complex log values, acoth′(2).
- Pristine 0.59.0 bundle: C1, C2, C4, C5, C6, C7, C9, C10 reproduce; C3 does not (feature is newer);
  C12's wrong-0 is 0.59.0-only.
- Scratch artifacts in this directory: `wester-dump.jsonl` (CE concrete outputs for all Wester
  defint/limit/solve cases), `fresh/` (regenerated reports at HEAD), `backup/` (pristine copies used
  to restore the tree), `audit.log`/`wester.log`/`solve.log`/`report.log` (harness stdout/stderr).
