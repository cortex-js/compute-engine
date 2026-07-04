# Numeric-value / BigDecimal / special-function numerics — correctness review findings

Reviewer area: `src/compute-engine/numeric-value/`, `src/compute-engine/numerics/`, `src/big-decimal/`.
Branch `main` @ 9b818ec8. Oracle: mpmath 1.3.0 (`./venv/bin/python3`), 25–40 guard digits, digit-for-digit ulp comparison.
All findings have executed repros (scratch scripts in `scratchpad/numerics/`).

Battery stats:
- **BigDecimal transcendentals**: 568 cases (exp, ln, log10/2, sqrt, cbrt, pow, sin/cos/tan, asin/acos/atan/atan2, sinh/cosh/tanh, asinh/acosh/atanh, expm1, log1p, nthRoot, div) × precisions {15, 34, 50, 200}. 541/568 within 2 ulp. Failures cluster into 5 root causes below.
- **Machine special functions**: 229 cases across ~40 kernels. 39 cases < 13 correct digits (worst: besselK(2,20) −1.3 digits).
- **Bignum special functions**: 206 cases across 20 `big*` kernels at 34/50/100 digits. 197/206 within 2 ulp (failures: polygamma, 2F1 gaps, zeta trivial zeros, LambertW@100).
- **Complex machine kernels**: 18 cases — all ≥ 14 digits except the 2F1 coverage-gap paths (7–10 digits).
- **BigDecimal core** (rounding, cancellation, mod, cmp, round-trip at ±9e15 exponents, directed rounding, negative zero): all pass.
- **Exact layer**: radical/rational arithmetic (√2·√3=√6, √8→2√2, √(50/49)=5/7·√2, φ identities, bigint rationals) all exact; conversions to 100 digits verified against mpmath.
- **Argument reduction**: sin/cos/tan verified at 1e10, 1e100 (≤2 ulp @ all precisions) and sin(1e500000) @21 — matches mpmath digit-for-digit (on-demand Chudnovsky π path is correct).
- Worst ulp errors observed: bigPolygamma 4.5e41 ulp @50; acos(1−ε) 3.1e9 ulp @200; BigDecimal.pow(0.999999999999, 1e6) 1.2e5 ulp @34; tan(π/2±1e-17) 3.7e4 ulp @200.

---

## P0 — wrong digits from kernels

### P0-1. polygamma (machine AND bignum): Bernoulli asymptotic terms missing a factor (n−1)! — wrong from digit ~5–9 for n ≥ 3 at every precision
- **Repro**:
  - machine: `polygamma(3, 2.5)` → `0.22386407493324287` (3.7 correct digits); `polygamma(5, 10)` → `3.0024771508789332e-4` (1.7 digits).
  - bignum: `bigPolygamma(ce, 3, 2.5)` @50 → `0.22390584838156011711…` — wrong from digit 9 (4.4e41 ulp).
  - CE level: `ce.precision = 50; ce.box(['PolyGamma', 3, 2.5]).N()` → `0.22390584838156011711075350184323197874142589881697`.
- **Expected (mpmath)**: ψ⁽³⁾(2.5) = `0.22390584881725205125514750351992606454240048750024`; ψ⁽⁵⁾(10) = `3.0594516211726820905e-4`.
- **Why wrong**: DLMF 5.15.9 asymptotic tail is Σ B₂ₖ·(2k+n−1)!/((2k)!·z^{2k+n}). Both implementations build the coefficient as the rising factorial n(n+1)···(n+2k−1) = (2k+n−1)!/(n−1)! and then divide by (2k)! — i.e. every Bernoulli term is a factor **(n−1)! too small**. n=2 is unaffected (1!=1), which is why Digamma/Trigamma and PolyGamma(2,·) pass; error grows with n and shrinks only polynomially with the shift.
- **Files**: `src/compute-engine/numerics/special-functions.ts:1080-1084` (machine: `for (let j = 0; j < m; j++) coeff *= n + j;`), `:786-800` (bignum polygammaCore, same pattern `coeff *= BigInt(nNum + j)`).
- **Fix**: multiply the coefficient by (n−1)! (or accumulate Π_{j=1}^{2k+n−1} j / (2k)! directly).
- **Test**: ψ⁽³⁾(2.5), ψ⁽⁵⁾(10.5) @34/50 vs mpmath (≤2 ulp); machine ≥ 13 digits.

### P0-2. Machine `zeta` returns only ~7 correct digits for every non-hardcoded argument (wrong acceleration coefficients)
- **Repro**: `zeta(3)` → `1.2020567979884007` (7.1 digits); `zeta(0.5)` → `-1.4603545015428792` (8.3); `zeta(15)` → 6.6 digits; `zeta(30)` → `0.99999976…` (< 1, qualitatively wrong side of 1); negative args inherit via functional equation: `zeta(-11)` 6.6 digits. User-visible: `ce.precision='machine'; ce.box(['Zeta',3]).N()` → `1.2020567979884007`.
- **Expected**: ζ(3) = `1.2020569031595942854…`, ζ(30) = `1.0000000009313274324…`.
- **Why wrong**: `zetaCoefficients` (special-functions.ts:1149-1160) claims Cohen–Rodríguez Villegas–Zagier acceleration but computes dₖ = Σ_{i≤k} C(n,i) (binomial partial sums). The genuine CVZ coefficients are dₖ = n·Σ_{i≤k} (n+i−1)!·4ⁱ/((n−i)!(2i)!), giving error (3+√8)^−n ≈ 5.8e-18 at n=22. Binomial partial sums give error ~2⁻ⁿ = 2.4e-7 at n=22 — exactly the observed ~7 digits.
- **Files**: `src/compute-engine/numerics/special-functions.ts:1136-1160`.
- **Fix**: use the CVZ Chebyshev coefficients (or Borwein's dₖ), and/or direct summation for s ≳ 15 (ζ(s)−1 ≈ 2^−s). Note bigZeta is correct — only the machine kernel is broken.
- **Test**: ζ(3), ζ(0.5), ζ(15), ζ(−11) at machine precision ≥ 14 digits.

### P0-3. Machine `besselK` catastrophically cancels for mid-range x (≈3 < x ≤ 40) — up to 100% error
- **Repro**: `besselK(2, 20)` → `1.3563577690421590e-8`; true `6.3295436122922281105e-10` — **factor 21 wrong**. `besselK(0, 10)` → 6.7 digits; `besselK(1, 5)` → 12 digits. User-visible: `ce.box(['BesselK', 2, 20]).N()` (any precision — there is no bignum kernel).
- **Why wrong**: `besselK` (special-functions.ts:1492-1519) switches to the asymptotic only at x > 40; below that it uses the ascending series `besselK0` (1520-1542): K₀ = −(ln(x/2)+γ)·I₀(x) + Σ… where the two parts are each ~e^x·… and cancel to ~e^−x — losing ~0.87·x digits (17+ digits gone by x=20, all 16 by x≈18). The series is only valid to x ≈ 2–3; the asymptotic (which is correct, DLMF 10.40.2) is fine from x ≈ 8–10.
- **Fix**: lower the asymptotic switch to x ≈ 9 (12 terms suffice) and/or use the Temme/Chebyshev route for 2 < x < 9.
- **Test**: K₀(10), K₂(20), K₁(5) ≥ 13 digits vs mpmath.

### P0-4. Machine `besselIAsymptotic` has the sign of every odd term flipped — only 2–4 correct digits for x > 40
- **Repro**: `besselI(0, 100)` → `1.0710705410356021e+42` vs true `1.0737517071310738235e+42` (2.6 digits); `besselI(0, 700)` → 3.4 digits.
- **Why wrong**: DLMF 10.40.1: I_ν(z) ~ e^z/√(2πz) Σ (−1)ᵏ aₖ(ν)/zᵏ, while K_ν uses Σ aₖ(ν)/zᵏ. `besselIAsymptotic` (special-functions.ts:1471-1483) reuses the K recurrence `term *= (μ−(2k−1)²)/(8kx)` without the (−1)ᵏ — the comment “no negation for I (vs J)” is exactly backwards. First-order error 2·(1/(8x)) ≈ 1/(4x) → 2.5e-3 at x=100 (matches).
- **Fix**: negate f each term (or `term *= -f/(k*8*x)`).
- **Test**: I₀(100), I₂(50), I₀(700) ≥ 13 digits.

### P0-5. Machine Airy Ai/Bi: negative-x asymptotic keeps only the leading term — 1.6–3.3 correct digits at x = −10
- **Repro**: `airyAi(-10)` → `0.039208692082373181` vs true `0.040241238486443190689` (1.6 digits); `airyBi(-10)` → 3.3 digits. Positive side truncation: `airyAi(10)` 7.6, `airyBi(10)` 7.5, `airyAi(5+ε)`→ switch at x=5 leaves only ~5 digits just past the cutoff. User-visible at all precisions (no bignum kernel): `ce.precision=50; ['AiryAi',-10].N()` → `0.03920869208237318` presented as a bignum.
- **Why wrong**: `airyAiNegAsymptotic`/`airyBiNegAsymptotic` (special-functions.ts:1631-1637, 1697-1701) implement only sin/cos(ξ+π/4)/(√π x^¼), dropping the DLMF 9.7.9/9.7.11 correction series (first dropped term ~5/(72ξ) ≈ 3e-3 at x=10, and relative error unbounded near the oscillation zeros). Positive side (1616-1630, 1683-1696) uses 5 fixed coefficients switched on at x=5, where the 5-term tail is ~1.9e-5.
- **Fix**: add both P and Q series (u_k pairs) on the negative side; extend the power series to |x| ≈ 8–9 before switching (the series is stable there in doubles), or add more u_k terms.
- **Test**: Ai(−10), Bi(−10), Ai(5.1), Ai(10) ≥ 12 digits.

---

## P1 — silent precision collapse / wrong fallbacks / deadline

### P1-1. `applyN`/`apply` silently return machine(or worse)-precision values at any requested precision, wrapped as bignum
- **Repro**: `ce.precision = 50`:
  - `['BesselJ', 0, 10].N()` → `[BigNumericValue] -0.2459357644513484` (16 digits presented at precision 50);
  - `['AiryAi', -10].N()` → `0.03920869208237318` (only **1.6** of those digits are correct — P0-5 compounds);
  - `['Hypergeometric2F1', 1, 1, 2, 0.999].N()` → `6.914669949794188` (9.9 digits, from the machine *complex* kernel); true `6.9146699489310672373`;
  - `['Hypergeometric2F1', 1, 2, 3, -100].N()` → `0.019076977626255598` (7.0 digits); true `0.01907697589663174811`.
- **Why**: `applyN` (boxed-expression/apply.ts:76-89) cascades bignum → machine → machine-complex whenever the preferred kernel returns NaN, by design (“a lower-precision answer is better than none”), and functions with no bignum kernel (BesselJ/Y/I/K, Airy, carlson, ellipticF/Pi, 1F1/2F1 complex…) always produce machine doubles. `ce.number(result)` then presents them indistinguishably from full-precision results. This is the “silent precision collapse producing wrong-looking high-precision output” class.
- **Fix direction**: mark results with their achieved precision (or round the printed digits to the kernel's known accuracy); at minimum document per-operator machine-only precision. For the 2F1 gaps see P1-2.
- **Test**: at ce.precision 50, .N() of the above either returns ≥50 correct digits or a value typed/flagged as machine precision.

### P1-2. 2F1 coverage gaps: NaN (→ low-precision fallback) for the logarithmic case z∈(0.95,1) and its Pfaff image z < −(≈19)
- **Repro (kernel level)**: `hypergeometric2F1(1,1,2,0.999)` → NaN; `hypergeometric2F1(1,2,3,-100)` → NaN (Pfaff maps to z′=0.990 with integer c−a−b); `bigHypergeometric2F1(…same…)` → NaN at any precision. Both values are finite and well-conditioned (6.9146…, 0.0190769…).
- **Why**: machine kernel (special-functions.ts:2934-2941): integer s = c−a−b uses the direct series only for z ≤ 0.95, else NaN. The bignum kernel has the same policy. mpmath handles integer-s via the limit form of DLMF 15.8.10.
- **Files**: special-functions.ts:2899-2951, 3078-3170.
- **Fix**: implement the integer-s connection formula (log case), or at least raise the direct-series budget (z=0.999 converges in ~40k terms — cheap in doubles).
- **Test**: 2F1(1,1,2,0.999) = −ln(1−z)/z to 14 digits machine / 2 ulp bignum.

### P1-3. Complex results silently drop to machine precision at any ce.precision
- **Repro**: `ce.precision = 50`:
  - `\ln(-1)` → im = machine `3.1415926535897931`;
  - `\ln(2+3i)` → both components machine;
  - `(1+i)^{0.5}` → re 50 digits, **im machine** (mixed!);
  - `['Power',-4,0.25].N()` → `1.00000000000000010691215709872552288 + i` (true value is exactly 1+i; re has 36 wrong-looking digits, im machine).
- **Why**: complex arithmetic routes through the machine `Complex` library (numerics/numeric-complex.ts, complex-esm); `BigNumericValue` stores a bignum re with a machine `im` (numeric-value/big-numeric-value.ts — e.g. `root()`:520-524 chops im to a machine number). There is no bignum complex type.
- **Severity**: P1 (silent drop; the brief explicitly grades this). Full bignum complex is a project; the minimal fix is honest presentation (don't print > 17 digits for components that came from machine ops).
- **Test**: ln(−1).N() @50 im to 50 digits, or typed as machine.

### P1-4. `BigDecimal.pow` integer-exponent path: error doubles every squaring — loses ~log10(n) digits at any precision
- **Repro**: `BigDecimal.precision=34; new BigDecimal('0.999999999999').pow(1e6)` → `0.9999990000004999993333338750115543`; true `0.99999900000049999933333387499940833…` — wrong from digit 28 (121,459 ulp). Error scales linearly with n (measured 25 ulp at n=1e3 → 2.5e7 ulp at n=1e9). User-visible: `ce.parse('0.999999999999^{1000000}').N()` @34 gives the same wrong digits. Also `pow(2,1000)`@15 = 3.3 ulp.
- **Why**: big-decimal.ts:876-896 rounds each squaring/multiply to the *target* precision; relative error doubles per squaring level (e_{k+1} = 2e_k + ½ulp), so total ≈ n/2 ulp.
- **Fix**: run the repeated-squaring loop at `prec + ceil(log10(n)) + guard` digits and round once at the end (same convention as the non-integer branch's `extra`).
- **Test**: 0.999999999999^1e6 @34/50 ≤ 2 ulp; 1.000000000001^1e9 @34 ≤ 2 ulp.

### P1-5. `acos` cancels near ±1: loses −log10(result) digits at every precision
- **Repro**: `acos(0.99999999999999999999)` @50 → `1.414213562373095048802867235511675657777e-10` — only 29–30 digits carried (92,676,308 ulp @50; 3.1e9 ulp @200); `acos(0.999999)` → ~650 ulp at every precision.
- **Why**: transcendentals.ts:687-707 computes acos(x) = π/2 − asin(x) with both operands at *user* precision; the subtraction cancels −log10(acos(x)) leading digits. asin itself is correctly compensated (verified: asin(0.99999999999999999999) @50 is 50-digit correct), only acos is broken.
- **Fix**: for x near 1 use acos(x) = 2·asin(√((1−x)/2)) (mirror of the acosh fix at :1029); or compute π/2−asin at raised precision like the small-x branches elsewhere in the file.
- **Test**: acos(1−1e-20), acos(1−5e-43), acos(0.999999) @50/200 ≤ 2 ulp.

### P1-6. `cos`/`tan` (and sin at multiples of π) near trig zeros: fixed 15-digit guard vs unbounded cancellation
- **Repro**: x = π/2 truncated to 40 digits (`1.570796326794896619231321691639751442099`), precision 50: `cos(x)` → `-4.1530031244708951252770383092665776…e-40` correct to only **25 digits** (true `-4.153003124470895125277038460917968…e-40`); `tan(x)` likewise; at precision 200, cos(1.5707963267948966) is 13,821 ulp off.
- **Why**: transcendentals.ts cos (:550-568) and tan (:572-602) use `workingPrec = targetPrec + 15`; when the result is ~10^−k (argument within 10^−k of a zero of cos/sin), k digits cancel in the absolute fixed-point grid, so only `targetPrec + 15 − k` digits survive. sin compensates small *arguments* (e<0) but not proximity to interior zeros.
- **Fix**: after computing sin/cos, if the result's decimal exponent is −k with k > guard/2, recompute with workingPrec += k (mpmath-style adaptive retry).
- **Test**: cos/tan at π/2-to-40-digits @50 ≤ 2 ulp; sin at π-to-40-digits @50.

### P1-7. `Root(x, n).N()` bignum path computes `a.pow(b.pow(-1))` — reciprocal rounding injects ~ln(a)·ulp error; perfect roots come out as 3.999…
- **Repro**: default precision 21: `ce.box(['Root', 64, 3]).N()` → `3.99999999999999999999` while `.evaluate()` → exact 4; `['Root',125,3].N()` → `4.99999999999999999999`; `['Power',125,['Rational',1,3]].N()` same. Machine precision: `Math.pow(64, 1/3)` = `3.9999999999999996`.
- **Why**: `root()` in boxed-expression/arithmetic-power.ts:768-777 (numericApproximation branch) uses `(a, b) => a.pow(b.pow(-1))`: 1/3 is rounded to p digits *first*, so the result has relative error ~ln(a)·10^−p (≈1–6 ulp), and exact-integer detection never fires. `BigDecimal.nthRoot` (transcendentals.ts:1081-1110) already handles this correctly (8 guard digits; `nthRoot(64,3)` = exactly 4 at all precisions) but is bypassed. `BigNumericValue.root` (:496-501, exp(ln/n) without guard digits) has the same last-ulp weakness.
- **Fix**: for integer b route the bigFn through `a.nthRoot(n)`; machine path use `Math.cbrt` for n=3 and round-and-verify for integer results.
- **Test**: Root(64,3).N(), Root(125,3).N(), Root(1e30,5).N() print exact integers; Root(10,3).N() @50 ≤ 2 ulp.

### P1-8. Even root of a negative: `evaluate()` yields a NaN literal while `.N()` yields the complex principal root
- **Repro**: `ce.box(['Root', -4, 4]).evaluate()` → `NaN`; `.N()` → `(1 + 0.9999999999999998i)` (true value is exactly 1+i). Same for `['Power', -4, ['Rational',1,4]]`.
- **Why**: exact path → `ExactNumericValue.root` (exact-numeric-value.ts:626-638) → `BigNumericValue.root` (big-numeric-value.ts:490-492) returns NaN for even roots of negative reals by design; `root()` in arithmetic-power.ts then boxes NaN as the *result of evaluate* instead of staying symbolic. Inconsistent with N() (which special-cases isNegative&&isEven at :742-755) and with `Sqrt(-4)` (stays exact `2i`).
- **Fix**: in the exact branch, return undefined (stay symbolic) or construct the exact complex `|a|^{1/n}·e^{iπ/n}` when representable.
- **Test**: Root(-4,4).evaluate() is symbolic or 1+i; never NaN.

### P1-9. Machine `erfInv` loses digits as x→±1 (Newton on erf cancels)
- **Repro**: `erfInv(0.999999999999)` → `5.0420130090022388` vs true `5.0420318985726961301` — **5.4 digits**; `erfInv(0.999999)` → 11.2 digits.
- **Why**: special-functions.ts:217-233 refines with y ← y − (erf(y)−x)·(√π/2)e^{y²}: erf(y)≈1 rounds to ~1e-16 absolute, amplified by e^{y²} (≈1e11 at x=1−1e-12). Digit loss ≈ log10(e^{y²}·1e-16).
- **Fix**: for ax > 0.5 iterate on erfc: y ← y + (erfc(y) − (1−ax))·(√π/2)e^{y²} (erfc is computed to full relative precision by the continued fraction; 1−ax is exact in doubles).
- **Test**: erfInv(1−1e-12), erfInv(1−1e-15) ≥ 13 digits. (bigErfInv passed at 34/50; only the machine kernel is affected.)

### P1-10. `bigLambertW`: convergence tolerance from `ce.precision` while arithmetic runs at `BigDecimal.precision`; result returned unrounded with garbage tail digits
- **Repro**: (a) `BigDecimal.precision=100` with a default engine (`ce.precision` 21): `bigLambertW(ce, 10)` correct to only ~76 digits (1.8e24 ulp @100). (b) Even with both set (ce.precision=50): result *prints 100 digits*, garbage from digit ~51: `1.74552800274069938307430126487538991153528812908093767165117682824…` (true continues `…0941331322206…`).
- **Why**: special-functions.ts:907 `const tol = new BigDecimal(10).pow(-ce.precision)` — the only kernel in the file keyed to engine precision instead of `BigDecimal.precision` (breaks under `withGuardDigits` and any direct-API use); and the returned `w` is never `toPrecision(p)`-rounded, so the exact `sub` leaves a ~2× precision significand whose tail is not correct.
- **Fix**: tol from `BigDecimal.precision`; `return w.toPrecision(BigDecimal.precision)`.
- **Test**: LambertW(10).N() @100 prints exactly 100 digits, all correct.

### P1-11. Deadline ignored: `Sin(10^999900).N()` runs 24–49 s with `ce.timeLimit = 2000`
- **Repro**: `ce.timeLimit=2000; ce.precision=21; ce.box(['Sin', ['Power', 10, 999900]]).N()` → returns (correct) value after **49.2 s**; at precision 500 → returns NaN after 48 s. Direct `new BigDecimal('1e999900').sin()` takes 845 ms — the engine path also redoes the ~1M-digit π reduction several times.
- **Why**: the mod-2π reduction (utils.ts `fpsincos`/`fppi`, Chudnovsky on demand up to MAX_PI_DIGITS=1e6) never calls the engine's `checkDeadline`; the evaluation pipeline appears to run the reduction multiple times (canonicalization/sgn + evaluate + N).
- **Fix**: thread a deadline check into the on-demand π computation loop (it's chunked — cheap to poll), and cache the reduced argument per (value, precision).
- **Test**: with timeLimit=2000, the call either finishes < ~4 s or throws Timeout; never 10× over.
- (Zeta @1000 digits *does* respect the deadline — threw at 2012 ms — so the interrupt plumbing exists; this is specifically the BigDecimal trig-reduction path.)

---

## P2 — edge inconsistencies, guard-digit gaps, latent bugs

### P2-1. `log()`/`log10`/`log2` have no guard digits — up to 3 ulp, and exact powers of 10/2 don't come out exact
- **Repro**: `log10(1e-7)` @15 → `-6.99999999999998`; @50 → 3.0 ulp; `log10(3.16227766016838)` ~2.1 ulp at every precision. (`log10(1e10)` = 10 exact only by luck of the ln cancellation direction.)
- **Why**: transcendentals.ts:488-492 `this.ln().div(b.ln())` both rounded at user precision.
- **Fix**: compute at precision+5 and round once; short-circuit exact powers of the base.

### P2-2. `bigZeta` at trivial zeros returns ~10^−(p+26) residue instead of 0
- **Repro**: `bigZeta(ce, -2)` @34 → `1.074027680978345…e-60` (should be exactly 0; relative error is infinite, and CE prints it as a plausible tiny number).
- **Why**: functional-equation branch multiplies by sin(πs/2) computed at finite precision (special-functions.ts zetaCore :830-899).
- **Fix**: return 0 for negative even integers before the functional equation.

### P2-3. Machine `gammaln` only ~10.5 digits
- **Repro**: `gammaln(0.5)` → 10.1 digits; `gammaln(3.7)` → 10.6; `gammaln(1e-8)` → 11.5.
- **Why**: special-functions.ts:22-50 shifts only to z ≥ 10 and keeps 3 Bernoulli terms; the first dropped term at z=10 is ~6e-11 relative. Also contaminates `beta` for large args (uses gammaln sums).
- **Fix**: shift to z ≥ 18 or add B₈/B₁₀ terms.

### P2-4. `fresnelS`/`fresnelC` drop the oscillating term at |x| ≥ 36974 — 8.6e-6 error cliff
- **Repro**: `fresnelS(40000)` → exactly 0.5; true `0.49999204225284540523` (4.8 digits).
- **Why**: special-functions.ts:1798-1812 keeps Cephes' 36974 cutoff with an incorrect justification (“phase not representable”): πx²/2 at x=36974 is 2.1e9, representable with ~6.4 fractional digits; the phase only degrades to 0 digits near x ≈ 7.6e7. The cutoff discards a term of size 1/(πx).
- **Fix**: raise the cutoff to ~1e7 (phase error then ~1e-9, well below the dropped-term size at the old cutoff). bigFresnel* are fine (verified @34/50).

### P2-5. `ExactNumericValue.root`: half-integer exponent decomposition is mathematically wrong (latent)
- **Repro (direct API)**: `ce._numericValue(16).root(2.5)` → exact 2. True 16^(1/2.5) = 16^0.4 = `3.0314331330207964`.
- **Why**: exact-numeric-value.ts:620 `if (exponent % 1 === 0.5) return this.root(Math.floor(exponent)).sqrt()` — computes x^(1/(2⌊e⌋)) instead of x^(1/e) (the composition identity doesn't exist). Not currently reachable from canonical `Root`/`Power` (verified: `Root(16,2.5).N()` = 3.0314… correct via the pow path), but any internal caller of `NumericValue.root` with a half-integer exponent gets a wrong exact value.
- **Fix**: delete the branch (fall through to the float path), or implement x^(2/(2e)) correctly.

### P2-6. `ExactNumericValue.root` integer-result detection misses perfect powers → exactness silently degrades
- **Repro (direct API)**: `ce._numericValue(64).root(3)` → BigNumericValue float (Math.pow(64,1/3)=3.9999999999999996 fails the `Number.isInteger` test), while `nv(27).root(3)` → exact 3. The CE library `Root` catches 64 via its own path, but the numeric-value layer leaks floats for exact roots.
- **Files**: exact-numeric-value.ts:629-634.
- **Fix**: `const r = Math.round(root); if (r**exponent === re) return this.clone(r)`.

### P2-7. Unrounded significands leak out of exact `mul`: printed digits beyond the precision are garbage
- **Repro**: `ce._numericValue({rational:[7,3], radical:3}).N()` @100 prints **200 digits**, correct to ~103 (`…0246676|75598…` vs true `…0246676|57646…`). Same family as the LambertW tail (P1-10): `ExactNumericValue.bignumRe` (:218-226) returns `rational.div × sqrt` where the final `mul` is exact and never rounded.
- **Fix**: `toPrecision(BigDecimal.precision)` before returning from `bignumRe`/`N()`.
- Note: `1.5·π @50` similarly prints 54 digits (those happen to be correct thanks to π's guard digits — but the contract "N() returns p digits" is not held).

### P2-8. `Power(2, Rational(-1,2))` / `Divide(1, Sqrt(2))` are 2.35 ulp off while `Power(2, -0.5)` is exact
- **Repro**: @50 `['Power',2,['Rational',-1,2]].N()` → `0.70710678118654752440084436210484903928483593768845` (true `…847`); `['Power',2,-0.5]` → `…847` ✓.
- **Why**: the rational path computes sqrt then inverts (or divides 1/√2) with two user-precision roundings; no guard digits.
- **Fix**: compute at +3 guard digits in the rational-exponent branch of pow/root, round once.

---

## P3 — notes

- `BigDecimal.round()` is half-away-from-zero while `toFixed`/`toPrecision` are half-even (documented in docstrings, but callers mixing them get inconsistent ties).
- `new BigDecimal('1e999999999999999999999')` → exponent stored as float 1e21, `toString()` = `'1e+1e+21'` (malformed but round-trips; consider clamping to ±MAX_SAFE or NaN).
- Machine `gamma(-172.5)` → `-0` (true ≈ 2.7e-311 subnormal): sign of the flushed underflow can be wrong; harmless magnitude.
- `sinh(300)/cosh(300)` @15 are 2.03 ulp (double rounding: exp then div 2); every other precision passes.
- Machine `gamma` for z>100 relies on `Math.exp(gammaln(z))` → inherits the 10-digit gammaln (P2-3): gamma(170.6) ~11 digits.

## Verified-good (no findings)
- BigDecimal add/sub/mul/div/mod/cmp/toPrecision/toFixed/round-trip/directed-rounding (`divToward`, `sqrtToward` brackets), negative-zero normalization, 1e50+1−1e50 exact, 1e60 mod 3 exact.
- Trig argument reduction at 1e10 / 1e100 / 1e500000 (≤ 2 ulp; 500k-digit π reduction digit-for-digit vs mpmath).
- exp/ln/sqrt/cbrt/asin/atan/atan2/sinh/cosh/tanh/asinh/acosh/atanh/expm1/log1p across 15/34/50/200 (≤2 ulp incl. near branch points: atanh(1−1e-20), acosh(1+1e-21), asin(1−1e-20)).
- bigGamma/bigGammaln/bigDigamma/bigTrigamma/bigBeta/bigZeta(s≠trivial zeros)/bigErf/bigErfc/bigErfi/bigErfInv/bigSinc/bigFresnelS/C/bigAgm/bigEllipticK/E/big2F1 (in-domain)/big1F1 at 34/50/100 — all ≤2 ulp vs mpmath, including erfc(100) @50 and zeta near s=1 (1±1e-21 → correct 1/ε±γ behavior, fast).
- Exact layer: radical normalization and closure under +,−,×,÷,pow (√2·√3=√6, √8=2√2, √(50/49)=5/7√2, φ arithmetic, (3/4)^−3=64/27, bigint rationals (1e30+1)/3±…), eq for bigint rationals incl. 2^53+1 vs 2^53 discrimination.
- Machine complex kernels (gamma, gammaln, agm, ellipticK/E, jacobiTheta [Fungrim πz convention], dedekindEta, 1F1, in-domain 2F1, incomplete gamma): 14–17 digits.
- Machine gamma overflow boundary (171.7, 172 → Infinity; 1e-320 → Infinity correct), lambertW near branch (−1/e+1e-10: 11 digits, conditioning-limited — acceptable).
- Engine deadline respected on the Bernoulli/zeta path (Zeta@1000 digits threw Timeout at 2012 ms).
- CE decimal-literal semantics: float literals like `-0.9999`, `170.3` are treated as exact decimals through the bignum path (Gamma(−0.9999)@50 matches mpmath's Γ of decimal −0.9999 to all 50 digits — initially misdiagnosed with a double-semantics reference; both `apply`'s conversion and bigGamma are correct).

## Tests masking wrong digits (tolerances loosened to fit the broken kernels)
`test/compute-engine/special-functions.test.ts` uses `expectApprox` with a default tolerance of **1e-10**, but the cases hitting the broken kernels carry explicitly loosened tolerances that let the bugs pass:
- `Zeta(3)` tested at `1e-6` (:188) — machine zeta's error is 1.05e-7, *just* inside; with the CVZ fix this can tighten to 1e-13.
- `AiryAi(10)` tested at `1e-4` (:369) — masks the 7.6-digit asymptotic; `AiryAi/Bi(−10)` (the 1.6-digit case) is not tested at all.
- `BesselK` tested only at x ≤ 5 with `1e-5`/`1e-6` (:335-347) — the broken 5 < x ≤ 40 zone has no coverage; K₀(5) itself already loses ~4.3 digits (passes 1e-6 with little margin).
- `PolyGamma(2, 1)` at `1e-6` (:82) — n=2 is the one order unaffected by the (n−1)! bug; no n ≥ 3 coverage.
These should be tightened to ≤1e-12 alongside the kernel fixes, and n≥3 polygamma / mid-range BesselK / negative Airy cases added.

Note on P2-2: at the CE expression level, `Zeta(-2)` for literal integers is intercepted by the exact-value path / `fungrim:zeta-trivial-zeros` rule (see `test/compute-engine/zeta-values.test.ts`), so the 1e-60 residue is reachable only via the kernel API or non-literal arguments that numericize.
