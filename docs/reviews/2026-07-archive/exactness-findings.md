# Exactness Review — evaluate() vs .N() across library evaluate handlers

Reviewer area: the exactness contract (CLAUDE.md "Evaluate vs. N"): `evaluate()` returns the most
exact form (exact args → exact result or stay symbolic; only inexact args numericize); `.N()`
produces the float; the two must agree numerically.

Repo: /Users/arno/dev/compute-engine @ main 9b818ec8 (read-only review; no files modified).
All repros executed via `npx tsx` from repo root; scripts in
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/exactness/`
(`grid.ts`, `special-values.ts`, `precision.ts`, `aggregates.ts`, `hang-case.ts`,
`isprime-check.ts`, `argument-check.ts`; full grid output in `grid-out.txt`).

Grid: 104 operators (77 unary × 20 argument classes, 27 binary × 18 argument pairs) = 2026 cells,
597 raw flags, triaged below. Argument classes: exact int (2,−2,0,1), rationals (1/2, −3/2),
radical (√2), constants (π, π/4, e), symbolic exact (ln 2), exact complex (i, 1+i), machine floats
(0.5, −0.5, 5.1), complex float, ±∞, NaN; plus targeted huge/tiny/high-precision batteries.

Legend: severity per brief (P0 float-from-exact / evaluate-N disagreement / wrong value / hang;
P1 wrongly-symbolic inexact, precision loss, NaN-for-unproven, crash; P2 missing special values,
sibling inconsistency; P3 docs/conventions).

---

## P0 — wrong values

### EX-01 [P0] Big integers silently corrupted by `asBigint` → wrong results across number theory
- Repro (all executed):
  - `IsPrime(2^127−1)` → `False` (M127 **is** prime; also M89 → False; 2^61−1 → True works)
  - `IsOdd('170141183460469231731687303715884105727')` → `False` (it is odd); `IsEven` → True
  - `FactorInteger(10^21+3)` → `[(2,21),(5,21)]` — it factored 10^21, not 10^21+3
  - `FactorInteger(...45-digit odd number ending 01)` → factors include `(2,28),(5,25)`
  - `DigitSum(m127)` → 73 (true 154); `Mod(10^21+3, 10)` → 0 (expected 3)
- Why: the value IS stored exactly (`x.sub(m127-7) = 7` works; json round-trips). The corruption is
  in `asBigint` (`src/compute-engine/boxed-expression/numerics.ts:53-79`): for an exact NumericValue
  it goes through `num.bignumRe` — a BigDecimal rendered at **engine precision** (21 digits default)
  — then converts that to bigint: `170141183460469231731687303715884105727` →
  `170141183460469231732000000000000000000n`. Every integer with more digits than `ce.precision`
  is silently rounded before use.
- Affected consumers (via `asBigint`/`toBigint`): IsPrime (boxed-expression/predicates.ts:6-20 —
  which explicitly comments it uses bigint "to avoid silent rounding", defeated by asBigint),
  IsOdd/IsEven (library/arithmetic.ts:1732-1756), FactorInteger/Divisors/Totient/MoebiusMu/
  DigitSum/IntegerDigits/... (library/number-theory.ts), Mod of big ints.
- Fix direction: in `asBigint`, when the NumericValue is exact (ExactNumericValue with integer
  rational), return the exact bigint numerator directly instead of round-tripping through
  `bignumRe`; audit `toBigint` for the same hole.
- Tests: `test/compute-engine/number-theory.test.ts:445-483` ("IsPrime is reliable for large n")
  only goes to 2^61−1 (19 digits) — passes misleadingly; no test crosses the 21-digit cliff.
  No test locks the wrong behavior; it's a coverage hole.

### EX-02 [P0] `Log(z, b)` complex branch drops the base division on the imaginary part → wrong value
- Repro: `Lb(i).evaluate()` → `1.5707963267948966i` (= ln i); `.N()` → `2.266180070913597i`
  (= (π/2)/ln 2, correct). Also `Lg(i)`: evaluate `1.5707i` vs N `0.6821i`; `Log(i,2)` same.
  evaluate() and N() disagree AND evaluate is numerically wrong.
- Why: `BigNumericValue.ln(base)` (src/compute-engine/numeric-value/big-numeric-value.ts:601-613)
  and `MachineNumericValue.ln(base)` (machine-numeric-value.ts:511-…): for complex z it computes
  `re: modulus.log(base), im: argument` — log_b(z) = (ln|z| + i·arg z)/ln b, so the **imaginary part
  must also be divided by ln(base)**; it isn't.
- Also: in the bignum version `argument` is truncated to machine via `.toNumber()` (precision loss,
  see EX-24).
- Fix: divide both parts by ln(base).
- Reached from `Log`/`Lb`/`Log2` evaluate → `BoxedNumber.ln(base)` (boxed-number.ts:413-416).

### EX-03 [P0] `Mod` returns different answers at machine vs bignum precision (two numeric paths disagree)
- Repro: default engine (bignum-preferred, precision 21): `Mod(-7,3).evaluate()` → **−1**;
  after `ce.precision = 'machine'`: → **2**. Also `Mod(-7.5,3).N()` → −1.5 (bignum) vs 1.5 (machine).
- Why: evaluate handler (src/compute-engine/library/arithmetic.ts:1000-1008) machine lane computes
  true modulo `((a%b)+b)%b`, but the bignum lane calls `a.mod(b)` — BigDecimal `mod` is a
  truncated-division remainder (JS `%` semantics). The `sgn` handler (same file :983-998) uses the
  same divergent pair. Mathematica-style `Mod` (sign of divisor) is clearly the intent of the
  machine lane and the description.
- Fix: bignum lane `((a mod b) + b) mod b`, e.g. `a.mod(b).add(b).mod(b)`.
- Same handler shape in `Remainder` (arithmetic.ts:1330-1345) — audit its two lanes too.

### EX-04 [P0] `Argument` of a complex number is permanently broken: calls unknown operator `ArcTan2`
- Repro: `Argument(Complex(1,1)).evaluate()` → `ArcTan2(1, 1)` (unevaluated, unknown symbol);
  `.N()` → `ArcTan2(1, 1)` too. `AbsArg(1+i)` → `(1.414..., ArcTan2(1,1))`. The engine's real
  operator is `Arctan2` (lowercase t): `Arctan2(1,1).evaluate()` → `1/4 * pi` works.
- Why: src/compute-engine/library/complex.ts:100 —
  `ce.function('ArcTan2', [op.im, op.re]).evaluate()` — wrong operator name (casing).
- Fix: `'Arctan2'`; add a test for `Argument(1+i) = π/4`. Both evaluate() and N() are unusable
  for any complex argument today (real arguments work via the Zero/Pi shortcuts at :98-99).

### EX-05 [P0] `Arctan2` with NaN argument returns −π/2 / π instead of NaN
- Repro: `Arctan2(NaN, 2).evaluate()` → `-1/2 * pi`; `Arctan2(2, NaN).evaluate()` → `pi`.
  (`.N()` correctly gives NaN → evaluate/N disagreement as well.)
- Why: src/compute-engine/library/trigonometry.ts:194-198 — `x.isFinite === false` is true for NaN
  (NaN is not finite), and `x.isPositive`/`y.isPositive` are undefined for NaN, so the
  `x.isPositive ? Zero : Pi` ternaries fall through to the wrong branch. Only the both-infinite
  case returns NaN.
- Fix: early `if (y.isNaN || x.isNaN) return ce.NaN;`.

### EX-06 [P0] `Choose` wrong values + crash; disagrees with sibling `Binomial`
- Repro: `Choose(2,3).evaluate()` → `NaN` (expected 0; `Binomial(2,3)` → 0 correctly);
  `Choose(-2,3)` → NaN; `Choose(1/2,1/3).evaluate()` → **throws**
  `TypeError: Cannot read properties of undefined (reading '0.3333...')`; `Choose(π,2)` throws too.
- Why: src/compute-engine/library/combinatorics.ts:15-21 — `k > n → ce.NaN` (should be 0 per
  binomial convention), `n < 0 → ce.NaN` (generalized binomial is defined), and non-integer
  n/k are passed straight into `choose(n,k)` (boxed-expression/expand.ts) which indexes a memo
  table by non-integer → crash.
- Related: `Binomial(-2,3)` → 0 (combinatorics.ts:68 `k > n` test with negative n) — the standard
  generalization gives C(−2,3) = −4 (Mathematica agrees). Either implement negative-n or stay
  symbolic; silently returning 0 is a wrong value (P1 if considered unsupported domain).
- Fix: make Choose delegate to the same logic as Binomial (0 for k>n≥0, k<0), handle or stay
  symbolic for non-integers instead of NaN/crash.

### EX-07 [P0] `evaluate()` numericizes exact args across a broad operator set (float from exact args)
The documented seeds `Power(2,-2)` → 0.25 and `Factorial(1/2)` → 0.886… are instances of several
distinct classes, each with its own root cause:

- **7a. Power: machine-integer base, negative integer exponent** —
  `Power(2,-2).evaluate()` → `0.25` (float); `Power(3,-2)` → `0.111…` (bignum float);
  but `Power(2,-1)` → `1/2`, `Power(2/3,-2)` → `9/4` (exact — the ExactNumericValue lane).
  Root: src/compute-engine/boxed-expression/arithmetic-power.ts:683-698 — when
  `typeof n === 'number'` it computes `Math.pow(x, e)` / decimal `pow` (float lane) instead of
  building the exact rational `1/n^{|e|}`; the `else` branch (`n.pow(e)` on NumericValue) is exact.
  Fix: for integer machine base and negative integer exponent, produce the exact rational.
- **7b. Sqrt of negative / large / nested-radical exact numbers** —
  `Sqrt(-2).evaluate()` → `1.4142135623730951i` (float; expected `i√2` — note `Sqrt(-4)` → `2i`
  exact, and `simplify()` keeps `sqrt(-2)` symbolic → evaluate is the odd one out);
  `Sqrt(-3/2)` → `1.2247…i`; `Sqrt(Sqrt(2))` → `1.1892…` (expected `2^(1/4)` or symbolic);
  `Sqrt(1000003).evaluate()` → `1000.0015…` float while `Sqrt(999999)` → `3sqrt(111111)` exact —
  arbitrary cliff at `SMALL_INTEGER` (10^6).
  Root: `BoxedNumber.sqrt()` (src/compute-engine/boxed-expression/boxed-number.ts:345-365): the
  exact-radical fastpath requires `0 < n < SMALL_INTEGER`; negative integers (except −1) and
  big integers fall to `_numericValue(value).sqrt()` (float); ExactNumericValue radicals
  (√2) can't nest so `.sqrt()` numericizes.
  Fix: negative integer → `i·sqrt(|n|)` exact; big integer → factor out square part or stay
  symbolic; nested radical → stay symbolic (`Power(2,1/4)`).
- **7c. Fract of exact non-integers** — `Fract(1/2).evaluate()` → `0.5` float (expected `1/2`);
  `Fract(-3/2)` → `0.5` float; `Fract(√2)` → float (expected `√2 − 1` or symbolic).
  Root: library/arithmetic.ts:574-580 — unconditional numeric `apply`, ignores exactness
  (compare Floor at :555-561, which is exact-safe because results are integers).
  Fix: for exact args compute `x − floor(x)` exactly (rational arithmetic), or stay symbolic.
- **7d. Mod/Remainder of exact rationals/radicals** — `Mod(1/2,1/3).evaluate()` → `0.1666…` float
  (expected `1/6`); `Mod(√2,2)` → float 1.414… (expected symbolic/√2); `Remainder(1/2,1/3)` →
  `−0.1666…` float. Root: arithmetic.ts:1000-1008 / :1330-1345 — unconditional `apply2`,
  `numericApproximation` never consulted. Fix: exact rational mod for exact rational args; stay
  symbolic for irrational exact args.
- **7e. Factorial of exact non-integers/complex** — `Factorial(1/2).evaluate()` → `0.886…`
  machine float (expected `√π/2` exact or symbolic); `Factorial(-3/2)` → float; `Factorial(√2)` →
  float (no closed form → must stay symbolic); `Factorial(i)` → machine complex float.
  Root: library/arithmetic.ts:432-466 — every non-integer real hits machine `gamma(1 + x.re)`
  (:449,453) and complex hits `gammaComplex` (:440) regardless of exactness or
  `numericApproximation`. Note this also loses precision under `.N()` at precision 30 (EX-24).
  Contrast: Gamma itself stays symbolic for `Gamma(1/2)` (missing the special value, EX-30, but
  at least not inexact). Fix: half-integers → exact `√π` multiples; other exact args → symbolic;
  floats → numericize (that part is right).
- **7f. Log with an exact symbolic base** — `Log(2, Pi).evaluate()` → `0.6055115613982801` float
  (both args exact; expected symbolic `log_π 2`). Root:
  src/compute-engine/boxed-expression/boxed-number.ts:402-405 — `baseExact` requires
  `isNumber(base) && base.isExact`, so a *symbol* base (π, e is special-cased) counts as inexact
  and drops to the numericize branch (:413-416) using `base.re`. Fix: symbolic base → stay
  symbolic (`ce._fn('Log', [this, base])`).
- **7g. Real of exact non-machine reals** — `Real(1/2).evaluate()` → `0.5` float;
  `Real(√2)` → `1.414…` float. Root: src/compute-engine/library/complex.ts:58-63 — for a
  non-machine NumericValue it returns `ce.number(op.bignumRe ?? op.re)` (precision-rounded float)
  even when `im === 0` and the value is exact. Fix: `if (op.im === 0) return ops[0];` and for
  exact complex return the exact real part. (`Imaginary` returns machine `op.im` — fine for
  exact Gaussian integers, but truncates bignum-complex — P2 note.)
- **7h. Statistics of exact lists** — `Mean([1,2,3,4]).evaluate()` → `2.5` float (expected `5/2`);
  `Mean([1/2,1/3,1/6])` → `0.333…` float (expected `1/3`); `Median([1,2,3,4])` → 2.5 float;
  `Variance([1,2,3,4])` → 1.666… float (expected 5/3); `PopulationVariance` → 1.25;
  `Kurtosis` → 1.64; `Quartiles` → floats; `Mean([√2,√2])` → float (expected √2).
  Root: src/compute-engine/library/statistics.ts:198-205 (Mean) and identically Median :215-222,
  Variance :231-238, PopulationVariance, StandardDeviation, Kurtosis, Skewness, Quartiles,
  InterquartileRange — every handler lowers to machine/bignum scalars
  (`flattenBigScalars`/`bigMean`) and returns `engine.number(float)` regardless of
  `numericApproximation`. Fix: exact rational accumulation for exact inputs (Mean/Variance of
  rationals is rational), or stay symbolic; keep the float path under `numericApproximation`.
- **7i. Sum folds exact radicals to floats (Product doesn't)** —
  `Sum(√k, k=1..5).evaluate()` → `8.38233…` float; expected `3 + √2 + √3 + √5` (symbolic Add).
  Contrast `Product(√k, k=1..4).evaluate()` → `2sqrt(6)` exact; `Sum(1/k, k=1..10)` → `7381/2520`
  exact. Root: Sum's accumulator uses the `.add()` **method** (library/arithmetic.ts:2083,2096
  `acc.add(x.evaluate(...))`), and `.add()` on two exact number literals that don't combine
  exactly (int + √2) folds to a float — the documented `.add()`/`.mul()` folding pitfall
  (cited as root cause per SYMBOLIC_FINDINGS; this is a NEW instance in the Sum evaluate path).
  Fix: accumulate exact-but-uncombinable terms symbolically (build an `Add` expression), fold
  only when the NumericValue addition is exact.
- **7j. Distance** — `Distance((0,0),(1,1)).evaluate()` → `1.4142135623730951` machine float
  (expected `√2`; `Distance((0,0),(3,4))` → 5 exact only because it's a perfect square; sibling
  `Hypot(1,1).evaluate()` → `sqrt(2)` exact). library/arithmetic.ts:1971-…
- **7k. Abs of exact Gaussian integers** — `Abs(Complex(1,1)).evaluate()` → `1.41421…` float;
  expected `√2` exact (representable: `Abs(3+4i)` → `5` exact). Root: Abs lowers |a+bi| through
  the NumericValue float hypot instead of building `Sqrt(a²+b²)` exactly (processAbs; complex.ts
  comment points to library/processAbs). Same class: `Conjugate(1/2 + i/2)` → `(0.5 - 0.5i)`
  float — CE has no exact complex rationals, so this may be a representation limitation; Abs is
  fixable because its result is real.

Note (scope cut): pure complex arguments (i, 1+i) numericizing in Sin/Cos/…/Arcsin (grid rows
`Sin(i) → 1.175i` float etc.) reflect CE's model where complex NumericValues are never exact;
this is a representation-level design limit (P3 observation), not per-operator bugs — except
where the result is real/Gaussian-exact (EX-07k, EX-08).

### EX-08 [P0] Integer powers of exact complex numbers computed via exp/log → garbage residue
- Repro: `Square(Complex(1,1)).evaluate()` → `(-1.35661672049711548047e-21 + 2i)`;
  `Power(1+i, 2)` identical. Expected exactly `2i`.
- Why: the complex power goes through the transcendental pow (exp(e·ln z)) in the bignum
  NumericValue lane instead of repeated exact complex multiplication for small integer exponents.
- Files: src/compute-engine/boxed-expression/arithmetic-power.ts (numericApproximation apply2 path
  :515-533 → NumericValue.pow), numeric-value/big-numeric-value.ts pow complex branch.
- Fix: integer exponent + complex literal → exact Gaussian multiplication (or at least machine
  complex multiply); kills the residue class. Related: `ComplexRoots(1,2)` →
  `[1, (-1 + 1.2246e-16i)]` (expected [1,-1]) — same trig/phase residue class (library/complex.ts
  ComplexRoots).

### EX-09 [P0] Trig N() at exact poles returns finite garbage instead of the pole
- Repro: `Cot(Pi).N()` → `-2609062035603132076970000`; `Csc(Pi).N()` → `+2.6e24`;
  `Sec(Pi/2).N()` → `5.2e24`. But `Cot(Pi).evaluate()` → `~oo` (correct) and `Tan(Pi/2).N()` →
  `~oo` (Tan gets it right) → evaluate/N numeric disagreement and sibling inconsistency.
- Why: N substitutes the 21-digit π approximation and computes cos/sin quotients; sin(π̃) ≈ 4e-22
  → 2.6e24. Tan's kernel special-cases the pole; Cot/Csc/Sec kernels don't (evalTrig path,
  src/compute-engine/boxed-expression/trigonometry.ts).
- Fix: under numericApproximation, run the same constructible/pole detection used by evaluate
  before numericizing (or detect exact multiples of π/2 symbolically).

### EX-10 [P0] `.N()` returns unevaluated symbolic expressions for Haversine/InverseHaversine/Hypot
- Repro: `Haversine(0.5).N()` → `1/2 * (1 - cos(0.5))` (not a number; `.evaluate().N()` → 0.0612);
  `InverseHaversine(1/2).N()` → `2arcsin(sqrt(0.5))`; `Hypot(1/2,1/3).N()` →
  `sqrt(0.333...^2 + 0.5^2)` — while `Hypot(1/2,1/3).evaluate()` → `sqrt(13)/6` (exact, good!).
  N() is *less* evaluated than evaluate() — a direct evaluate/N contract inversion.
- Why: the evaluate handlers return a freshly built expression without evaluating it —
  trigonometry.ts:270-272 (Haversine), :281-283 (InverseHaversine), :143-145 (Hypot) — and the
  evaluation loop does not re-evaluate handler results. Under N() the operands get numericized
  first, so the exact rewrites (cos of float) no longer fold.
- Also: `Haversine(2).evaluate()` → `1/2 * (1 - cos(2))` unevaluated (should stay `Haversine(2)`
  or a *evaluated* exact form); `InverseHaversine(1/2).evaluate()` → `2arcsin(sqrt(2)/2)` — misses
  the arcsin(√2/2) = π/4 fold → expected `pi/2` (its ev.N() = 1.5707 proves the value).
- Fix: `return engine.expr([...]).evaluate({ numericApproximation })` (mind recursion), or
  compute numerically under numericApproximation.

### EX-11 [P0] `Max`/`Min` with non-comparable operands: first operand silently wins (order-dependent)
- Repro: `Max(i, 2).evaluate()` → `i`; `Max(2, i).evaluate()` → `2`; `Min(i,2)` → `i`;
  `Min(2,i)` → `2`. Complex numbers are unordered — Max(i,2)=i and Min(i,2)=i simultaneously,
  and the answer depends on argument order.
- Why: `evaluateMinMax` (library/arithmetic.ts:2243-2261): first numeric operand seeds `result`;
  `val.isGreater(result)` is `undefined` for non-comparable pairs, so the seed is never displaced
  and non-comparable operands are silently dropped from `rest`.
- Fix: operands with undefined comparison should go to `rest` (stay symbolic
  `Max(2, i)`), not be absorbed.

### EX-12 [P0] One-arg Log vs two-arg Log(x,10) N() disagree for negative arguments
- Repro: `Lg(-2)` (canonicalizes to one-arg `Log(-2)`): `.N()` → `(0.301 + 1.364i)` (complex);
  explicit `Log(-2, 10).N()` → `NaN`. Same mathematical object, opposite N behavior. evaluate()
  for both stays symbolic `log(-2, 10)`-ish, so `x.evaluate().N() ≠ x.N()` for the one-arg form
  as well (grid: `Lg(int-2)`: ev.N()=NaN vs N()=complex).
- Why: Log's N handler (library/arithmetic.ts:906-933): the one-arg path (:910-925) has a complex
  fallback `ce.complex(x).log().div(Math.LN10)`; the two-arg path (:926-932) uses
  `Math.log(z)/Math.log(b)` with no complex fallback → NaN.
- Fix: give apply2 lanes the same negative-argument complex fallback; decide one convention for
  evaluate (see EX-13) so ev.N() matches N().

### EX-13 [P0→P1] Ln/Log of negative floats: evaluate→NaN vs N→complex; inconsistent with ln(−1)
(Expansion of the documented `Ln(-0.5)` seed to its class.)
- Repro: `Ln(-0.5).evaluate()` → `NaN`, `Ln(-0.5).N()` → `-0.693+3.142i` (seed, confirmed at both
  machine and precision-30). But `Ln(-1).evaluate()` → `iπ`-form? (numeric-value gives im: π) and
  exact `Ln(-2).evaluate()` stays symbolic `ln(-2)` (good). So: exact negative → symbolic,
  −1 → complex, negative float → NaN, N() → complex. Three different conventions in one function.
- Why: `MachineNumericValue.ln` (machine-numeric-value.ts:503-505) and `BigNumericValue.ln`
  (big-numeric-value.ts:593-595): `decimal < 0 → NaN` **except** `isNegativeOne → {im: π}`.
  The N-path in the Ln library handler (arithmetic.ts:866-881) has the complex fallback.
- Fix: negative real float in `ln()` → complex result (match the N lane), or NaN in both.
- Same family, N-side NaN where complex value exists (sibling inconsistency with Ln):
  `Arcsin(2).N()` → NaN (evaluate stays symbolic — fine), `Arcosh(0.3).N()` → NaN,
  `Artanh(2).N()` → NaN, and float-arg evaluate: `Arcsin(2.5).evaluate()` → NaN,
  `Arcosh(0.3).evaluate()` → NaN. Per severity guide: NaN where the domain is merely
  out-of-real-range = P1; the Ln-vs-Arcsin N() inconsistency is the sibling-class part.

### EX-14 [P0] New hangs: unbounded loops / kernels that ignore the evaluation deadline
(Documented `Gamma(1e300).N()` NOT re-reported; these are its siblings, each individually
confirmed with 20s external timeout; engine default time limit is ~2s and correctly cancels
Factorial/LucasL/CatalanNumber/Totient/NthPrime/PrimePi — the ops below never cancel.)
- `GammaLn(1e300).N()` — HANG (bignum lngamma; no deadline check)
- `Zeta(1e300).N()` and `Zeta(-1e300).N()` — HANG (bignum zeta; no deadline check)
- `Gamma(1e7).N()` at `ce.precision = 500` — HANG (bignum gamma, moderate arg + high precision)
- `Fibonacci(1e9).evaluate()` / `Fibonacci(1e300).evaluate()` — HANG: O(n) bigint loop with no
  cancellation check, src/compute-engine/library/combinatorics.ts:41-47 (sibling `LucasL` cancels
  properly at ~2s — number-theory.ts:319 — proving the fix pattern exists)
- `Binomial(2e9, 1e9).evaluate()` — HANG: O(k) bigint loop, combinatorics.ts:71-75, no deadline
- `BellNumber(20000).evaluate()` — HANG: O(n²) triangle, combinatorics.ts:~245+, no deadline
  (sibling `CatalanNumber(1e9)` cancels fine)
- `Subfactorial(1e6).evaluate()` — HANG, combinatorics.ts:~220+
- `DigitSum(Power(2,1e6)).evaluate()` — 20s+ (bigint→decimal conversion loop; borderline P1)
- Fix: thread `run(..., ce._timeRemaining)`/CancellationError checks through these loops and the
  bignum gamma/lngamma/zeta kernels (same mechanism Factorial already uses,
  library/arithmetic.ts:454-460).

### EX-15 [P1] ±∞ integer args throw uncaught RangeError from evaluate() (crash class)
- Repro (each `THREW RangeError: The number Infinity cannot be converted to a BigInt`):
  `Fibonacci(+oo)`, `CatalanNumber(±oo)`, `LucasL(±oo)`, `BernoulliB(±oo)`, `Totient(±oo)`,
  `MoebiusMu(±oo)`, `Binomial(oo,2)`, `JacobiSymbol(oo,2)`, `LegendreSymbol(oo,2)`,
  `Stirling(oo,2)`, `Eulerian(oo,2)`, `DivisorSigma(oo,2)`.
- Why: `toBigint(n)`/`BigInt(n.re)` on non-finite values without an `isFinite` guard
  (combinatorics.ts:32 `toBigint`, number-theory.ts various).
- Fix: guard `!x.isFinite → return undefined` (or NaN) before bigint conversion; a shared helper
  would fix all twelve.
- Also crash-class: `Power(2, 1e15).evaluate()` produces a BoxedNumber whose `.json` (and
  serialization generally) throws `RangeError: Maximum BigInt size exceeded`
  (big-decimal/utils.ts:43 `pow10` ← BigDecimal.toFixed ← BigNumericValue.toJSON,
  big-numeric-value.ts:694/77). The number is representable (exponent 3e14 < BigDecimal cap);
  only serialization explodes. Fix: exponent-notation serialization for huge exponents instead
  of toFixed. (`Power(10,1e300).evaluate()` → `+oo` — overflow-to-infinity, defensible.)

---

## P1 — contract violations / precision loss

### EX-16 [P1] Float (inexact) args stay symbolic under evaluate() for ~30 special functions
- Contract (CLAUDE.md): "only an inexact (float) argument numericizes (cos(5.1) → 0.377)".
  Trig obeys: `Cos(5.1).evaluate()` → `0.3779…`. But:
- Repro: `Gamma(5.1).evaluate()` → `Gamma(5.1)` (`.N()` → 27.93 exists);
  `Exp(5.1).evaluate()` → `e^(5.1)`; `Power(2,5.1).evaluate()` → `2^(5.1)`;
  same for Zeta, Erf, Erfc, Erfi, ErfInv, LambertW, Sinc, EllipticK/E, AiryAi/Bi, FresnelS/C,
  SinIntegral, CosIntegral, ExpIntegralEi, LogIntegral, Digamma, Trigamma, GammaLn, Bessel[JYIK],
  Beta, PolyGamma, Factorial2, Subfactorial(float)… (grid: 174 FLOAT-ARG-STAYED-SYMBOLIC flags,
  4 arg classes × ~30 operators, full list in grid-out.txt).
- BUT: trigonometry.ts:310-318 (REVIEW.md B23 note) documents this as the *intended* pattern
  ("anything else stays symbolic unless numericApproximation is set") for Sinc/Fresnel "same as
  Gamma/Zeta". So the codebase contains two contradictory documented contracts; CLAUDE.md's
  version is the canonical one and the trig family follows it, the special-function family
  follows B23. Either the handlers or the docs are wrong — flagging the CONFLICT as the finding.
  If CLAUDE.md wins: add "inexact arg → applyN" to each handler (cheap, mirrors Arctan
  trigonometry.ts:164-179). If B23 wins: fix CLAUDE.md and accept `Gamma(5.1)` staying symbolic.
- Also in this class: `Add(0.5, Pi).evaluate()` → `0.5 + pi` and `Multiply(0.5, Pi).evaluate()` →
  `0.5 * pi` stay partially evaluated (float + exact-symbol), while `Add(√2, 0.3)` → `1.714…`
  numericizes (float + exact-literal). Sibling inconsistency inside Add/Multiply folding.

### EX-17 [P1] Machine-only kernels inside a precision-30 engine (precision loss under .N())
- Repro at `ce.precision = 30` (expected 30 significant digits, got machine 16):
  - `Factorial(1/2).N()` → `0.8862269254527586` (evaluate() also machine — see EX-07e)
  - `Factorial(i).N()` → machine complex
  - `BesselJ(0,1).N()` → `0.7651976865579666`
  - `AiryAi(1).N()` → `0.1352924163128818`
  - `SinIntegral(1).N()` → `0.946083070367183`
  - `ExpIntegralEi(1).N()` → `1.895117816355937`
  - `LogIntegral(2).N()` → `1.0451637801174927`
  (For contrast, done right at 30 digits: Gamma(1/3), Zeta(3), Erf/Erfi/ErfInv, LambertW,
  EllipticK, Digamma, FresnelS, Sinc, Hypergeometric2F1.)
- Why: these handlers' applyN paths call the machine kernels (numerics/special-functions.ts
  gamma/besselj/airy/si/ei/li) with no bignum lane.
- Fix: add bignum kernels or at least document; the Tier-2 kernel work (memory: ROADMAP items)
  added bignum for the "done right" list — extend to these six.
- Related smaller: complex results are always machine (`Sqrt(-2)`, `Ln(-0.5).N()` at precision
  30 give 16-digit im parts; `BigNumericValue.ln` truncates `argument` via `.toNumber()`,
  big-numeric-value.ts:608) — complex bignum unsupported engine-wide (P2 as a known limit, but
  the ln() one is avoidable: BigDecimal.atan2 already computed it at full precision before
  truncation).

### EX-18 [P1] `ErfInv` out-of-domain exact args → NaN instead of staying symbolic
- Repro: `ErfInv(2).evaluate()` → `NaN`; `ErfInv(√2)`, `ErfInv(-3/2)` → NaN (exact args, complex
  value exists / domain merely unproven — per severity guide this is the NaN-cascade class).
  Sibling `Arcsin(2).evaluate()` stays symbolic (correct pattern).
- File: library/statistics.ts:145-166 (ErfInv evaluate → erfInv machine path returns NaN).
- Also: `Factorial2(-2).evaluate()` → NaN (undefined by convention — acceptable-ish but sibling
  `Factorial(-2)` → `~oo`; conventions differ; `Factorial2(-1)` → NaN is a WRONG value, = 1 by
  the standard convention, see EX-30).
- Also NaN-conventions cluster (P2/P3, listed for completeness, all executed): `Power(0,0)` → NaN
  (documented choice? Mathematica: Indeterminate, SymPy: 1), `Root(2,0)` → NaN, `Divide(0,0)` →
  NaN (fine), `Mod(2,0)` → NaN (Mathematica: Indeterminate — fine), `LCM(0,0)` → NaN (standard
  lcm(0,0)=0), `Log(0,0).evaluate()` → `-oo` but `.N()` → NaN (disagreement).

### EX-19 [P1] `Arctan2` complex first arg: evaluate computes a complex angle, N silently truncates to real
- Repro: `Arctan2(i, 2).evaluate()` → `0.5493061443340548i` (= i·artanh(1/2), the analytic
  continuation via Arctan) vs `Arctan2(i, 2).N()` → `0` (apply2 machine atan2 reads `.re` of i = 0).
  evaluate/N disagreement; signature says `(y:number, x:number) -> real`.
- File: trigonometry.ts:189-223 (evaluate general case delegates to Arctan of complex; N path
  :190-191 apply2/atan2).
- Fix: reject/stay-symbolic for non-real args in both paths (atan2 is a real-plane function), or
  continue analytically in both.

---

## P2 — missing special values / sibling inconsistencies (all executed)

### EX-30 [P2] Missing exact special values (evaluate() stays symbolic where a well-known exact value exists)
- `Gamma(5)` → `Gamma(5)` (expected 24! — Gamma folds NOTHING, not even positive integers, while
  sibling Factorial eagerly numericizes everything; the pair behaves oppositely-wrong;
  arithmetic.ts:583-635)
- `Gamma(1/2)` → symbolic (expected `√π`); `Gamma(3/2)`, `Gamma(-1/2)` — half-integer Γ family
- `GammaLn(2)` → symbolic (expected 0; `GammaLn(2).N()` → 0 confirms); `GammaLn(1/2)` → (ln π)/2
- `Beta(2,3)` → symbolic (expected `1/12`; `.N()` → 0.0833 exists; positive-integer Beta is
  always rational; arithmetic.ts:747-761)
- `EllipticK(0)`, `EllipticE(0)` → symbolic (expected `π/2`; special-functions.ts:58-119)
- `BesselJ(0,0)` → symbolic (expected 1)
- `LambertW(0)` → symbolic (expected 0; `.N()` → 0)
- `Factorial2(-1)` → NaN (expected 1; (−1)!! = 1 standard; arithmetic.ts:520-535)
- `Floor(Pi)`/`Ceil(Pi)`/`Round(Pi)`, `Floor(E)`, `Floor(Ln(2))` → stay symbolic (expected 3/4/3/2/0
  — `Floor(√2)` → 1 works, so the radical class folds but transcendental constants don't;
  arithmetic.ts:538-562)
- `GCD(1/2,1/3)` / `LCM(1/2,1/3)` → stay symbolic (Mathematica: 1/6 and 1; evaluateGcdLcm only
  handles integers, arithmetic.ts:2264-2309)
- `Digamma(1)` → symbolic (= −γ = EulerGamma symbol exists; defensible either way)
- `Zeta(i)`, `Erf(i)`, `LambertW(i)`, `Sinc(i)`, `LogIntegral(-2)` etc.: `.N()` stays symbolic —
  no complex kernels (documented in B23 note as intentional; P2/P3).

### EX-31 [P2] `Sign(3+4i)` stays symbolic (Mathematica: (3+4i)/5); low priority.

### EX-32 [P3] `Zeta(1).evaluate()` → `~oo` (ComplexInfinity) but `.N()` → `+oo` (pole is one-sided
only from the right; ~oo is the better answer; make N agree). Compare `Gamma(0)`: both `~oo` (good).

### EX-33 [P3] Float→exact promotions at canonicalization: `Power(2, 0.5)` → `sqrt(2)`,
`Divide(Pi, 2.0)` → `1/2 * pi`, `Exp(0.5).evaluate()` → `sqrt(e)` — an INEXACT arg became an exact
result (inverse-direction contract bend, presumably the documented small-float-to-rational
canonicalization). Consistency with EX-16 should be decided together (0.5 exactifies but 5.1
doesn't).

---

## Tests locking wrong expectations
- None found that directly lock the P0s. Notables:
  - `test/compute-engine/number-theory.test.ts:445-483` — "IsPrime is reliable for large n
    (shared Miller-Rabin)" tops out at 2^61−1 (19 digits), just below the 21-digit corruption
    cliff (EX-01): misleading green suite; extend with M89/M127 and a >10^21 composite.
  - `test/compute-engine/arithmetic.test.ts:495-509` uses `.N()` + toBeCloseTo for negative-base
    powers — fine, does not lock EX-07a.
  - trigonometry.ts:310-318 in-code note (REVIEW.md B23) *documents* the EX-16 behavior as
    intended — doc/contract conflict with CLAUDE.md, needs an explicit decision.

## Grid stats
- Operators enumerated from library files: 104 tested in the main grid (77 unary, 27 binary)
  + Sum/Product/Mean/Median/Variance/…/Quartiles/Distance/Degrees/AbsArg/ComplexRoots/IsPrime/
  IsOdd/IsEven/FactorInteger/DigitSum/NextPrime/Hypergeometric2F1/PowerMod in targeted batteries
  (≈130 operators total).
- Main grid: 2026 cells → 597 raw flags → triaged: 99 EXACT→FLOAT (all accounted in EX-07/EX-08
  or the complex-model P3 note), 64 N-disagreements (EX-02/05/09/10/12/13/19/32), 23 EXACT→NaN
  (EX-06/18), 174 float-arg-stayed-symbolic (EX-16), 21 crashes (EX-06/15), 308 N-stayed-symbolic
  (mostly benign: invalid-type args and missing complex kernels; the non-benign ones are in
  EX-10/EX-30).
- Hang hunt: 40 risky cases, one subprocess each, 20s cap: 9 hangs (EX-14) + 1 borderline
  (DigitSum), all others complete or cancel via CancellationError ≤2s.
