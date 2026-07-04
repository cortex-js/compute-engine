# Independent P0 Verification Report

Verifier pass over the six review-agent findings files. Every finding classified P0 (incl. the
hybrid EX-13 "P0→P1") was re-verified in fresh processes with newly written repro scripts in
`scratchpad/verify/` (none of the original agents' scripts reused). Environment: main @ 9b818ec8
**with** the user's uncommitted perf WIP present (big-decimal, solve.ts, polynomials.ts,
benchmarks — untouched). Engine imported from the full entry point `src/compute-engine.ts`
(the core `src/compute-engine/index.ts` entry has no LatexSyntax). Hang cases run one per
subprocess with `timeout 15`. Python emissions executed with `./venv/bin/python3`.

**Counts: 40 P0 findings — 39 CONFIRMED, 1 CONFIRMED-VARIANT (EX-05), 0 NOT-REPRODUCED, 0 BLOCKED, 0 MISJUDGED.**

| # | Source | ID | Claim (one line) | Verdict | Observed |
|---|--------|----|------------------|---------|----------|
| 1 | roundtrip | RT-P0-1 | `.json` emits JSON float for exact big integers; reconstruction changes value | **CONFIRMED** | `10^23`.json = `1e+23` (typeof number); reconstruct−orig = `-8388608`; 10^300 diff ≈ 5.2504…e283; `["Rational",1,1e+300]` emitted |
| 2 | roundtrip | RT-P0-2 | ≤17-digit heuristic makes `.json` change 16–17-digit BigDecimal values | **CONFIRMED** | `{num:'0.12345678901234567'}`.json = `0.12345678901234566`, isSame false; `9007199254740993.5` → `9007199254740994`; prec-17 `(2/3).N()` round-trip isSame false |
| 3 | roundtrip | RT-P0-3 | High-precision complex: `.json` emits bignum re, re-boxing truncates to machine | **CONFIRMED** | emitted `{"num":"1.41421356237309504880…3769"}`; reboxed `.json` = `["Complex",1.4142135623730951,1]`; isSame false |
| 4 | roundtrip | RT-P0-4 | Default `toMathJson()` emits `"0.(3)"` which re-boxes as a *string* | **CONFIRMED** | `(1/3).N().toMathJson()` = `"0.(3)"`; `ce.expr(...)` type = `string` |
| 5 | roundtrip | RT-P0-5 | `.latex` truncates repeating decimals to 6 repetend copies, no marker | **CONFIRMED** | `(1/3).N().latex` = `0.333\,333`; `(1/6)` = `0.166\,666\,6`; `(1/7)` = `0.\overline{142857}` (control ok); reparse diff `-3.33e-7` |
| 6 | roundtrip | RT-P0-6 | `f''(x)` → LaTeX → reparses as product of `d_upright` symbols | **CONFIRMED** | `\frac{\mathrm{d}^{2}}{\mathrm{d}x^{2}}f(x)` reparses to `["Multiply",["Divide",["Power","d_upright",2],…],["f","x"]]` |
| 7 | parse | P0-A | Mixed-direction relational chains silently misparse (wrong truth values) | **CONFIRMED** | `1 \le 2 > 0` → `And(1≤0, 0<2)` → **False**; `3 \ge 2 < 4` → False; `a > b < c` → `Less(b,c,a)`; `1 = 2 > 0` → `And(0<2, 1=0)`; all valid:true |
| 8 | parse | P0-B | `--` parses as C-style Decrement; raw serializer itself emits `--` | **CONFIRMED** | `x--y` → `Multiply(y,Decrement(x))`; raw `Subtract(x,Negate(y))`.latex = `x--y` → reparses to Decrement; `--x` → PreDecrement |
| 9 | parse | P0-C | `\log_2^2 x` silently parses as `x·(log 2)²` | **CONFIRMED** | → `["Multiply","x",["Power",["Log",2],2]]` valid:true; `\log_2^2 8` evals to `8·log(2,10)²` not 9; `\sin^2 x` control fine |
| 10 | canonical | CN-P0-1 | Exact-integer overflow folds to NaN at canonicalization (`rationals.ts mul`) | **CONFIRMED** | `Multiply(1e200,x,1e200)` → `NaN * x` canonical; Add control folds exact bigint; `Add(1.7e308x,1.7e308x)`: evaluate exact 3.4e308·x vs `.N()` NaN |
| 11 | canonical | CN-P0-2 | Canonical sort commutes declared-matrix symbol products; commutator = 0 | **CONFIRMED** | `Multiply(P,M).json` = `["Multiply","M","P"]`; isSame true; `MP−PM` evaluates to `0` |
| 12 | exactness | EX-01 | `asBigint` rounds >21-digit exact integers → number theory wrong across the board | **CONFIRMED** | IsPrime(M127)=False (is prime; 2^61−1 control True); IsOdd(M127)=False/IsEven=True; FactorInteger(10^21+3)=[(2,21),(5,21)]; Mod(10^21+3,10)=0 (exp 3); DigitSum(M127)=73 (true 154, verified independently) |
| 13 | exactness | EX-02 | `Log(z,b)` complex: evaluate drops ÷ln(b) on the imaginary part | **CONFIRMED** | `Lb(i).evaluate()` = `1.5707963267948966i` (=ln i) vs `.N()` = `2.266180070913597i` (correct); same for `Log(i,2)` |
| 14 | exactness | EX-03 | `Mod` machine vs bignum lanes disagree on negatives | **CONFIRMED** | default (bignum) `Mod(-7,3)` = **−1**, machine-precision engine = **2**; `Mod(-7.5,3).N()`: −1.5 vs 1.5 |
| 15 | exactness | EX-04 | `Argument` of complex calls unknown operator `ArcTan2` (casing) → inert | **CONFIRMED** | `Argument(1+i)`: evaluate and N both return unevaluated `ArcTan2(1, 1)`; control `Arctan2(1,1)` = π/4 |
| 16 | exactness | EX-05 | `Arctan2` with NaN arg returns −π/2 / π instead of NaN | **CONFIRMED-VARIANT** | evaluate: `Arctan2(NaN,2)` = `-1/2 * pi`, `Arctan2(2,NaN)` = `pi` — exactly as claimed. Delta: finding says `.N()` "correctly gives NaN"; observed `.N()` stays **symbolic** `Arctan2(NaN, 2)` (both `'NaN'`-symbol and raw-NaN encodings). Core wrong-value bug + evaluate/N disagreement real |
| 17 | exactness | EX-06 | `Choose` wrong values + crash on non-integer args | **CONFIRMED** | `Choose(2,3)` = NaN (exp 0; `Binomial(2,3)`=0); `Choose(1/2,1/3)` throws `TypeError: Cannot read properties of undefined (reading '0.333…')`; `Choose(Pi,2)` throws; `Binomial(-2,3)`=0 (generalized −4) |
| 18 | exactness | EX-07 (a–k) | `evaluate()` numericizes exact args across 11 operator classes | **CONFIRMED** (all 11 subclasses) | a: `Power(2,-2)`→0.25 float (`2^-1`→1/2 control exact); b: `Sqrt(-2)`→1.414i float, `Sqrt(√2)`→float, `Sqrt(1000003)`→float / `Sqrt(999999)`→`3√111111` exact; c: `Fract(1/2)`→0.5; d: `Mod(1/2,1/3)`→0.1667 float; e: `Factorial(1/2)`→0.886 machine; f: `Log(2,Pi)`→0.6055; g: `Real(1/2)`→0.5; h: `Mean([1,2,3,4])`→2.5, `Variance`→1.667 float; i: `Sum(√k,1..5)`→8.382 float (Product control exact `2√6`); j: `Distance`→1.414 float (`Hypot(1,1)`→`√2` control); k: `Abs(1+i)`→1.414 float (`Abs(3+4i)`→5 control) |
| 19 | exactness | EX-08 | Integer powers of exact complex via exp/log → garbage residue | **CONFIRMED** | `Square(1+i).evaluate()` = `(-1.35661672049711548047e-21 + 2i)` (expected exactly 2i); `Power(1+i,2)` identical |
| 20 | exactness | EX-09 | Trig `.N()` at exact poles returns finite garbage | **CONFIRMED** | `Cot(Pi).N()` = `-2609062035603132076970000`; `Csc(Pi).N()` = +2.609e24; `Sec(Pi/2).N()` = 5.218e24; `Cot(Pi).evaluate()` = `~oo`, `Tan(Pi/2).N()` = `~oo` (controls) |
| 21 | exactness | EX-10 | `.N()` returns unevaluated symbolic for Haversine/InverseHaversine/Hypot | **CONFIRMED** | `Haversine(0.5).N()` = `1/2 * (1 - cos(0.5))` (not a number; `.evaluate().N()` = 0.0612); `Hypot(1/2,1/3).N()` symbolic while `.evaluate()` = `sqrt(13)/6`; `InverseHaversine(1/2).evaluate()` = `2arcsin(sqrt(2)/2)` (misses π/2 fold) |
| 22 | exactness | EX-11 | `Max`/`Min` with non-comparable operands: first operand silently wins | **CONFIRMED** | `Max(i,2)`=i, `Max(2,i)`=2, `Min(i,2)`=i, `Min(2,i)`=2 — order-dependent, complex absorbed |
| 23 | exactness | EX-12 | One-arg vs two-arg Log `.N()` disagree for negative args | **CONFIRMED** | `Lg(-2).N()` = `(0.301 + 1.364i)`; `Log(-2,10).N()` = `NaN`; both evaluate() stay symbolic `log(-2,10)` |
| 24 | exactness | EX-13 (P0→P1) | `Ln(-0.5)`: evaluate → NaN vs N → complex | **CONFIRMED** | evaluate = `NaN`, `.N()` = `(-0.6931… + 3.1416…i)`; `Ln(-2)` stays symbolic (control). (`Ln(-1).evaluate()` observed symbolic `ln(-1)` — finding hedged on this, consistent) |
| 25 | exactness | EX-14 | 8 hang cases + 1 borderline ignore the evaluation deadline | **CONFIRMED** (9/9) | Each in own subprocess, `timeout 15` expired for: `GammaLn(1e300).N()`, `Zeta(1e300).N()`, `Zeta(-1e300).N()`, `Gamma(1e7).N()`@prec500, `Fibonacci(1e9)`, `Binomial(2e9,1e9)`, `BellNumber(20000)`, `Subfactorial(1e6)`, `DigitSum(2^1e6)`. Control `LucasL(1e9)` throws `CancellationError: Timeout exceeded` at 2022 ms — the fix pattern exists |
| 26 | compare | C1 | `assume(a=b)` between free symbols silently dropped (value wiped, no DB entry) | **CONFIRMED** | `assume('a=b')` → `'ok'` but `a.value` = undefined, `ask(Equal(a,b))` = [], `a.isEqual(b)` = **false**; contrast `assume('m=n')`: `m.value` = n, `m.isEqual(n)` = true (scope accident, as claimed) |
| 27 | compare | C2 | `eq()` returns definitive false for symbol pairs before consulting assumptions DB | **CONFIRMED** | `x.isEqual(y)` = false (should be undefined; `x.isEqual(2)` = undefined control); with `Equal(a,b)` manually stored (`ask` finds it, length 1) `a.isEqual(b)` still **false** — DB consult unreachable |
| 28 | compare | C3 | Non-machine reals ordered against complex numbers (definitive true) | **CONFIRMED** | `1.5 < (2+3i)` = true; `(1/3) < (2+3i)` = true; `√2 < (2+3i)` = true; `parse('0.5') < (2+3i)` = true; machine-int control `2 < (1+i)` = undefined |
| 29 | compare | C4 | `cmp()` `.re` fallbacks ignore imaginary parts (symbols/literals with complex values) | **CONFIRMED** | `i.isLess(2)` = true / `isGreater` = false; `z:=1+i`: `z.isLess(2)` = true, `z.isGreater(0)` = true, `2.isGreater(z)` = true; `(1+i).isLess(w)` with `w>4` assumed = true |
| 30 | compare | C5 | NaN comparator makes canonical sort input-order dependent | **CONFIRMED** | `Add(NaN,0.5,x,3.7).json` = `["Add","x","NaN",0.5,3.7]` vs permuted input → `["Add","x",0.5,3.7,"NaN"]`; isSame **false**; Multiply likewise |
| 31 | compare | C6 | Documented `.is()` symmetry broken for expression-valued bindings | **CONFIRMED** | `g := x²+1`: `g.is(x²+1)` = true, `(x²+1).is(g)` = **false** |
| 32 | compile | CO-P0-1 | `Mod` negative operands: every target disagrees with interpreter | **CONFIRMED** | interp `Mod(-1,3).N()` = **−1**, compiled JS `((_.x % 3)+3)%3` = **2**; `Mod(7,-3)`: interp 1 vs JS −2; Python `np.mod(-1,3)` = 2.0 |
| 33 | compile | CO-P0-2 | `Round` halves: 3 conventions (interp half-away, JS Math.round, np banker's) | **CONFIRMED** | interp `Round(-2.5)` = −3, JS = −2; `Round(-0.5)`: interp −1, JS −0; Python `np.round(2.5)` = 2.0 vs interp 3 |
| 34 | compile | CO-P0-3 | `Arccot` negative args: wrong branch in compiled targets | **CONFIRMED** | interp `Arccot(-2).N()` = 2.6779 (range (0,π)); compiled JS `Math.atan(1/x)` = −0.4636; Python emits same formula |
| 35 | compile | CO-P0-4 | Negative-base roots: compiled NaN incl. constant folds emitting literal `NaN` | **CONFIRMED** | `Root(x,5)`(−2): interp −1.1487 vs JS NaN; `Power(x,2/3)`(−1): interp 1 vs NaN; `Sqrt(-4)` compiles to code `NaN` with success:true (interp 2i); `Power(-8,1/3)` → code `NaN` (interp −2) |
| 36 | compile | CO-P0-5 | Multi-index Sum drops all but first Limits; freeSymbols lies | **CONFIRMED** | interp = 36; compiled code `((1 * _.j) + (2 * _.j) + (3 * _.j))`, success:true, `freeSymbols: []`, `run({})` = NaN |
| 37 | compile | CO-P0-6 | Python `Power(-2,x)` emits `-2 ** x` → sign-flipped | **CONFIRMED** | emitted `-2 ** x`; Python at x=2 → **−4.0**; interp = 4 |
| 38 | compile | CO-P0-7 | Python `Remainder` emits `np.remainder` (floored mod, not IEEE) | **CONFIRMED** | emitted `np.remainder(x, 4)`; Python at x=7 → **3.0**; interp `Remainder(7,4).N()` = **−1** |
| 39 | compile | CO-P0-8 | Interpretation-fallback `run()` permanently corrupts engine state | **CONFIRMED** | after fallback `run({x:5})`, `ce.box('x').evaluate()` = **5** engine-wide; minimal `pushScope(); assign(q,42); popScope()` → q stays 42 |
| 40 | compile | CO-P0-9 | Non-canonical compile: missing associativity parens → wrong grouping | **CONFIRMED** | `a/(b/c)` → `_.a / _.b / _.c`, run(12,6,2) = 1 (exp 4); `a-(b-c)` → `_.a - _.b - _.c`, run(10,6,3) = 1 (exp 7); both success:true |

## Notes

- **Expected-value sanity checks** all passed: M127 primality/digit-sum (154, recomputed
  independently), log-base identities (lb i = iπ/(2 ln 2) ≈ 2.2662i), arccot range convention,
  hav(0.5) = (1−cos 0.5)/2 ≈ 0.06121, binomial C(2,3)=0 / C(−2,3)=−4, IEEE remainder(7,4)=−1,
  1 ≤ 2 > 0 = True, (1+i)² = 2i, commutator ≠ 0. No MISJUDGED findings.
- **EX-05 variant delta**: the only deviation found anywhere. The wrong definitive values from
  `evaluate()` reproduce exactly; only the finding's parenthetical about `.N()` returning NaN is
  off — `.N()` actually stays symbolic (`Arctan2(NaN, 2)`), which still constitutes an
  evaluate/N disagreement, arguably a second bug.
- **Cross-corroborations**: EX-03 (interpreter bignum truncated Mod) and CO-P0-1 (compiled Mod
  divergence) are two views of the same root cause and both reproduce; CN-P0-2's `isTensorOperand`
  gap and the `Power(M,2)→MatrixPower` contrast behave exactly as described.
- **WIP interference**: none observed. All 40 findings reproduced with the user's uncommitted
  big-decimal/solve.ts/polynomials.ts changes in the tree, so no git-diff attribution pass was
  needed (that step only applies to NOT-REPRODUCED findings, of which there were none).
- Repro scripts: `scratchpad/verify/verify-{roundtrip,parse,canonical,ex1,ex2,ex3,compare,compile,compile-py}.ts`,
  `hang.ts` (case-per-subprocess), emitted `parity.py`.
