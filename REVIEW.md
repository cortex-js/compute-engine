# Codebase Review

**Date:** 2026-06-09
**Scope:** `src/` — boxed-expression core, LaTeX syntax + MathJSON, function library,
numerics/numeric-value/big-decimal, compilation/symbolic/interval, type system + tensor.
**Method:** Six parallel review passes, one per subsystem. Findings marked **✓ verified**
were reproduced at runtime against the live engine, not just inferred from reading.

**Progress:**
- B3–B8 (collection handlers) fixed + regression-tested
  (`test/compute-engine/collections.test.ts` → "Collection handler regressions").
  Two adjacent bugs in the same handlers were also corrected: the `Cycle`
  iterator was off-by-one (started at index 0), and the `Drop`/`Rest` iterators
  emitted trailing `Error` elements past the end of a finite collection.
- D1–D5, D7 (numeric correctness) fixed + regression-tested
  (`internals/numeric-value.test.ts`, `internals/statistics.test.ts`,
  `big-decimal/big-decimal.test.ts`). The adjacent D10 (complex negative-power
  dropped the imaginary part) was fixed alongside D1. **D6 (transcendental
  fixed-point bridge — `exp` underflow, `ln` hang on tiny inputs) is NOT done:**
  it needs the decimal exponent factored out of `exp`/`ln`/`sqrt` before the
  fixed-point kernel — a precision-architecture change, not a formula fix, best
  done as its own carefully-tested task.
- F1–F4 (tensor linear algebra) fixed + regression-tested
  (`test/compute-engine/linear-algebra.test.ts` → "Tensor linear algebra
  regressions"). Determinant/inverse for n≥3 were rewritten (Bareiss /
  Gauss-Jordan on the flat data). Three adjacent bugs were also fixed: the 3×3
  determinant string-concatenated its terms (`addn([...])`), the `Determinant`
  operator returned the raw field value unboxed (→ `undefined` for numeric
  matrices), and the matrix iterator's `slice(i-1)` compensation had to be
  undone once `slice` itself was made 1-based.
- A1, A3, E6 (core comparison + a meaning-changing simplify rule) fixed +
  regression-tested (`comparisons.test.ts` → "Comparison correctness";
  `simplify-noskip.test.ts` for E6). A1: an eq-handler `false` was treated as
  equality; A3: strict predicates returned `false` for the indeterminate
  `<=`/`>=` from assumptions (now `undefined`); E6: deleted the
  `(-x)^{odd/even} → x^{odd/even}` rule (the two are not equal — even root of a
  negative base is complex). The existing `comparisons.test.ts` was entirely
  `describe.skip`, which is why A1/A3 went uncaught.
- E1–E5 (compilation / symbolic / interval) fixed + regression-tested
  (`compile.test.ts`, `derivatives.test.ts`, `compile-glsl.test.ts`,
  `compile-interval-js.test.ts`). E1: symbolic `Range` compiled to
  `Array.from({length: NaN})` (`parseFloat` returns NaN, not null) → always
  `[]`; guard switched to `!isNaN`, plus a fix for the map-callback param `_`
  shadowing the argument object on a symbolic start. E2: `Arcsec`/`Arccsc`
  derivatives were wrong and identical (`−x²/√(1−x²)`); now `±1/(|x|·√(x²−1))`.
  E3: GPU `Degrees` mapped to GLSL `degrees()` (the inverse); now `radians()`.
  E4: a compound additive real factor in a GPU complex multiply lost its parens
  (`(x+1)·z·w` → `x + 1.0·cmul`); added `parenthesizeFactor()`. E5: interval
  Sum/Product with a compound symbolic bound read `.hi` off an `IntervalResult`
  wrapper (→ NaN → empty loop); now unwraps either shape.
- E8–E15 (rest of the E-cluster: interval enclosures + compilation) fixed +
  regression-tested (`interval-arithmetic.test.ts`, `compile-python.test.ts`,
  `compile-wgsl.test.ts`, `compile-glsl.test.ts`). Interval conservative-
  enclosure fixes: E9 (`0·∞`=0 in `_mul`), E12 (`clamp` = min(max(x,lo),hi), no
  longer empty), E11 (binomial/gcd/lcm enumerate the integer grid instead of
  corner-sampling), E10 (sinc `±1/|x|` tail bound; Fresnel `0.5±A` convergence
  band), E8 (gamma/gammaln tabulate the per-strip interior extremum). Compile
  fixes: E13 (Python `Power` right-assoc — left base parenthesized,
  `(a^b)^c`→`(a ** b) ** c`), E14 (added WGSL `fn` Gamma/Erf preambles), E15
  (GPU `If`/`Which`/`When` → `select` for WGSL, ternary for GLSL, valid NaN
  instead of a bare `NaN`).
- D8, D9, G13 (remaining unblocked HIGH-severity bugs) fixed + regression-tested
  (`numeric.test.ts`, `big-decimal.test.ts`, `factor.test.ts`,
  `solve.test.ts`). D8: the small-integer radical table had `8→√8`/`20→√20`
  instead of `2√2`/`2√5`; corrected (solve's `±√8` snapshot updated to `±2√2`).
  D9: `BigDecimal.pow`'s overflow guard used the digit count as log10
  (overestimate ×up-to-10), falsely overflowing `1^1e16` (and the representable
  `2^1e16`); now uses an accurate leading-digit float log10. G13: `factor()`
  returned NaN for a Gaussian-integer sum (`gcd(1,i)`=NaN poisoned content
  extraction), destroying `(1+i)/2`; guarded against complex coefficients. (A5,
  the last open HIGH, stays deferred — it's in `index.ts`, part of the suspended
  Fungrim WIP.)

---

## Executive Summary

The core engine (boxed-expression, canonicalization, arithmetic) is in good shape; most
findings there are edge cases. The areas with the most serious problems are:

1. **Tensor linear algebra is broken.** `determinant()` crashes for n≥4, `inverse()`
   crashes for n≥3, `slice()` is off-by-one, and the triangular/diagonal predicates are
   logically inverted. This code appears to have never been exercised beyond 2×2.
2. **Collection lazy-evaluation handlers have many inverted/missing-return bugs**
   (`Rest`, `Slice`, `Drop`, `Position`, `SetFrom`, `TupleFrom`, `Cycle`, `Filter`, `Zip`).
3. **The new type-string parser regressed against its own grammar** — documented
   dimension syntaxes (`matrix<2x3>` with `?`, parens, spaces; `list<number^2>`) fail or
   silently drop dimensions, and `typeToString → parseType` does not round-trip.
4. **Numeric-value complex arithmetic has multiple wrong formulas** (`pow`, `inv`,
   negative exponents) and `BigDecimal.mod`/`exp`/`ln` fail outside a narrow range.
5. **Statistics formulas (skewness, kurtosis) are mathematically wrong** in both machine
   and bignum implementations.
6. **Several simplification rules call `.simplify()`** — the documented infinite-recursion
   hazard class — and one rule (`(-x)^{p/q}`) changes mathematical meaning.
7. **Parsing performance:** `peekDefinitions` scans all ~812 dictionary entries roughly 6×
   per token position, and the tokenizer is O(n²). The biggest wins in the codebase are here
   and in caching `parseType()`.

---

## (a) Correctness Issues

### Boxed-expression core

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ A1 | HIGH | `boxed-expression/compare.ts:381` | `cmp()` treats an eq-handler result of `false` as equality: `if (cmp !== undefined) return '='`. **✓ verified:** `["List",1,2].isLessEqual(["List",3,4])` → `true`. Fix: `if (cmp === true) return '='`. |
| ✅ A2 | HIGH | `boxed-expression/boxed-function.ts:853` | `ln()` of `Root(a,b)` computes the reciprocal: `b.div(a.ln(base))` instead of `a.ln(base).div(b)`. **✓ verified:** `Root(x,3).ln()` → `3/ln(x)`. Fixed: now `(1/3)·ln(x)`. Regression test in `arithmetic.test.ts` → "Ln of Root (REVIEW.md A2)". |
| ✅ A3 | HIGH | `boxed-expression/abstract-boxed-expression.ts:636-658` | `isLess`/`isGreater`/etc. return definitive `false` when `cmp()` returns the indeterminate `'<='`/`'>='`. **✓ verified:** after `assume(y >= 3)`, `y.isGreater(3)` → `false` (should be `undefined`). These predicates feed sign inference engine-wide. |
| ✅ A4 | HIGH | `boxed-expression/boxed-number.ts:786-791` | `canonicalNumber` returns **+∞** for a rational with −∞ numerator (inverted sign logic; denominator sign also ignored). **✓ verified:** `ce.number([-Infinity, 5])` → `+oo`. Fixed: result sign is now the product of numerator/denominator signs. Regression test in `numbers.test.ts` → "Rational with an infinite numerator/denominator (REVIEW.md A4)". |
| A5 | HIGH | `index.ts:1000-1003` | `costFunction` setter is missing an `else`: the guard assignment is always overwritten, so any non-function value is stored and later invoked, crashing `simplify()`. |
| A6 | MED | `boxed-expression/arithmetic-power.ts:577-605` | `root()` numeric path returns a positive real for even roots of negatives. **✓ verified:** `Root(-16, 4).N()` → `2` (should be NaN/complex). |
| A7 | MED | `boxed-number.ts:391-403`, `boxed-function.ts:866-872` | `ln(base)` silently drops non-integer bases (falls through to natural log). **✓ verified:** `ce.number(8).ln(2.5)` loses the base. `BoxedSymbol.ln` handles it correctly — the three implementations are inconsistent. |
| A8 | MED | `boxed-expression/boxed-symbol.ts:774-794` | Plain symbols report `isEmptyCollection: true`, `isFiniteCollection: true`, `count: 0` via `?? 0` fallbacks, contradicting the abstract-class contract (`undefined` for non-collections). **✓ verified.** |
| A9 | MED | `boxed-expression/compare.ts:387-399` | Function-difference comparison: machine path uses exact `=== 0` (no tolerance, unlike the NumericValue path), and NaN diff maps to `'>'` instead of `undefined`. |
| A10 | MED | `boxed-expression/arithmetic-mul-div.ts:461` | `commonTerms()` early-returns when the numeric gcd is 1, skipping symbolic common factors. **✓ verified:** `factor(x·y < x·z)` fails to cancel `x`. |
| A11 | MED | `boxed-expression/arithmetic-mul-div.ts:732,758` | `div()` inconsistent on a/0: JS-number denominator → `ComplexInfinity`, boxed zero denominator → `NaN`. |
| A12 | MED | `boxed-expression/negate.ts:95-117` | `negateProduct` pass-2 boolean condition is inverted (`!isNumber(arg) && !arg.isInteger` should be `!(isNumber(arg) && arg.isInteger)`); result still correct but the documented priority isn't implemented and pass 3 is dead. |
| A13 | LOW | `boxed-expression/boxed-symbol.ts:243` | `mul(0)` fastpath returns `Zero` even for infinite symbol values; the `Product.mul` slow path correctly returns NaN for ∞·0. |
| A14 | LOW | `boxed-expression/order.ts:357-372` | Operator and string tie-breaks sort descending while the symbol branch and the doc comment say ascending — inconsistent canonical ordering. |
| A15 | LOW | `boxed-expression/simplify.ts:410` | `simplifyNonCommutativeFunction` drops `options` when re-simplifying operands (custom rules/costFunction ignored in that pass). |
| A16 | LOW | `boxed-expression/compare.ts:131` | `eq()` calls `.simplify()` and is reachable from `isEqual`, which library evaluate handlers call — latent recursion risk per the project's documented hazard class. |

### Function library

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ B1 | HIGH | `library/trigonometry.ts:175` | `Arctan2` exact path ignores the quadrant: returns `Arctan(y/x)` with no ±π correction. **✓ verified:** `Arctan2(1,-1).evaluate()` → −π/4; `.N()` correctly gives 3π/4. Fixed: principal value shifted by ±π for `x<0`; ±π/2 on the y-axis; indeterminate-sign args left unevaluated. Regression test in `trigonometry.test.ts` → "Arctan2 quadrant correction (REVIEW.md B1)". |
| ✅ B2 | HIGH | `library/arithmetic.ts:2180-2191` | `GCD`/`LCM` machine-number path never seeds the accumulator (integers pushed to `rest` instead of `result = op.re`). **✓ verified:** with machine precision, `GCD(4,6)` stays unevaluated. Fixed: first integer seeds the accumulator, non-integers (incl. a leading one) are deferred. Regression test in `arithmetic.test.ts` → "GCD/LCM machine-precision path (REVIEW.md B2)". |
| ✅ B3 | HIGH | `library/collections.ts:1186-1193` | `Rest` iterator re-declares `let index = 1` inside `next()` — never advances, never terminates. **✓ verified:** yields `2,2,2,2,…`. |
| ✅ B4 | HIGH | `library/collections.ts:1288-1304` | `Slice` `at` handler computes bounds then falls off the end — no `return`, so `at()` is always `undefined`. The `count` handler's negative-start formula is also wrong. **✓ verified.** |
| ✅ B5 | HIGH | `library/collections.ts:2222-2249` | `SetFrom`/`TupleFrom` have the collection test inverted (exact inverse of the correct `ListFrom` above them). **✓ verified:** `SetFrom([1,2,2,3])` returns a set containing the list as one element. |
| ✅ B6 | HIGH | `library/collections.ts:1597-1604` | `Position` throws on every match: missing `else` before `if (pred !== 'False') throw`. **✓ verified.** |
| ✅ B7 | HIGH | `library/collections.ts:2080-2081` | `Cycle` `isEmpty`/`isFinite` handlers self-recurse → stack overflow on `isFiniteCollection`. Also `isFinite` is logically inverted. **✓ verified.** |
| ✅ B8 | HIGH | `library/collections.ts:1088-1100` | `Drop` `at`: negative indices return wrong elements (`Drop([1..5],2).at(-1)` → `1`, expected `5`); `n = 0` always returns `undefined`. **✓ verified.** |
| ✅ B9 | HIGH | `library/combinatorics.ts:216-224` | `Subfactorial` returns 0 for all n ≥ 1 (loop multiplies by `(i−1)` which is 0 at i=1). **✓ verified:** `Subfactorial(4)` → 0, expected 9. Fixed: exact bigint recurrence `!n = n·!(n−1) + (−1)ⁿ`. Regression test in `combinatorics.test.ts`. |
| ✅ B10 | HIGH | `library/combinatorics.ts:34` | `Fibonacci(−n)`: builds `Negate(Fibonacci, n)` — two separate operands — producing an Error expression; and the reflection formula `F(−n) = (−1)^{n+1}F(n)` is missing. **✓ verified.** Fixed: compute `F(|n|)`, apply reflection sign. Regression test in `combinatorics.test.ts`. |
| ✅ B11 | HIGH | `library/number-theory.ts:175-185` | `IsOctahedral` tests the wrong condition (perfect-square check on `3n+1` instead of solving m(2m²+1)/3 = n). **✓ verified:** `IsOctahedral(6)` → False, `IsOctahedral(5)` → True — both wrong. Fixed: solve `2m³+m=3n` via a cube-root estimate + exact bigint verification. Regression test in `number-theory.test.ts`. |
| ✅ B12 | HIGH | `library/arithmetic.ts:1052-1058` | `Power` type handler: `!exp.isFinite` is true for symbols (`isFinite` is `undefined`), so any symbolic exponent gets type `non_finite_number`. **✓ verified:** `2^x` has type `non_finite_number`. Also claims `finite_real` for possibly-complex `(−2)^{0.5}`. Use `=== false` like every other handler in the file. Fixed: `=== false` guard + `finite_real` now requires a non-negative base or integer exponent. Regression tests in `type-inference.test.ts`. |
| ✅ B13 | HIGH | `library/relational-operator.ts:145-177` | `Equal` eq-sampling substitutes the **same** value for every unknown, so inequivalent equations compare equal. **✓ verified:** `(x+y=0).isEqual(2x=0)` → `true`. Fixed: each unknown gets an independent value (sample pool rotated by the unknown's index). Regression tests in `equal.test.ts`. |
| B14 | MED | `library/relational-operator.ts:64-74,115-116` | `Congruent` uses JS remainder (wrong for negatives) and bails entirely under bignum-preferred default precision; the adjacent `Equal` eq handler calls `.simplify()` (recursion hazard). |
| B15 | MED | `library/statistics.ts:254-352` | `Histogram`/`BinCounts` last bin is half-open, so the dataset max never lands in it — contradicts the docstring's own example. **✓ verified:** `BinCounts([1,2,2,3],3)` → `[1,2,0]`, doc says `[1,2,1]`. ~40 lines of copy-paste between the two handlers. |
| B16 | MED | `library/arithmetic.ts:424-451` | `Factorial` silently rounds positive non-integer reals (`Factorial(2.5)` → `2` instead of Γ(3.5) ≈ 3.32); pattern duplicated in `evaluateAsync`. **✓ verified.** |
| B17 | MED | `library/collections.ts:824-861` | `Reduce` compiled fast path ignores the explicit initial value (overwritten by first element) and returns `undefined` on compile failure instead of falling through to the working interpreted path. |
| B18 | MED | `library/collections.ts:698,1903-1906` | `Filter.count` claims `Infinity` unconditionally → `Sum(Filter([1,2,3], _>1))` stays unevaluated; `Zip.isEmpty` uses `every` where Zip is empty if **any** input is empty. **✓ verified.** |
| B19 | MED | `library/logic.ts:206-229` | `KroneckerDelta`/`Boole` map *undetermined* comparisons to 0. **✓ verified:** `KroneckerDelta(x,y)` with free symbols evaluates to `0`. Should stay symbolic. |
| B20 | MED | `library/trigonometry.ts:63-91` | `Degrees` canonical handler reduces literals mod 360, but the evaluate handler doesn't — the same operator denotes different values depending on whether the arg was a literal at canonicalization. **✓ verified:** `Degrees(390)` → π/6 vs 13π/6. |
| B21 | MED | `library/number-theory.ts:200-216` | `IsHappy` throws on negative input (`BigInt('-')`). **✓ verified.** |
| B22 | MED | `library/combinatorics.ts:187-247` | `Multinomial`/`BellNumber` use machine floats: `Multinomial(20,20)` → `137846528820.00003`; overflow past n≈170/25. Siblings `Binomial`/`Fibonacci` already use bigint. |
| B23 | LOW | `library/statistics.ts:38-67`, `trigonometry.ts:269-298` | `Erf`/`Erfc`/`ErfInv`/`Sinc`/`Fresnel*` ignore `numericApproximation` — exact `evaluate()` returns machine floats, and high-precision engines silently get 64-bit accuracy. |

### LaTeX syntax & MathJSON

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ C1 | HIGH | `latex-syntax/serializer.ts:240,243` | `wrapString` emits a stray `}` for 'scaled' group style and a stray `)` for 'big' — invalid LaTeX. **✓ verified.** Fixed: removed the stray trailing characters. Regression test in `latex-syntax/delimiters.test.ts`. |
| ✅ C2 | HIGH | `latex-syntax/serializer.ts:450` | Spelled-out-digit lookup uses `startsWith` instead of whole-prefix equality: symbols are corrupted on serialization. **✓ verified:** `tensor` → `\mathrm{10sor}`, `onesie` → `\mathrm{1sie}`. Fixed: match against the whole prefix (`prefix === x`). Regression test in `latex-syntax/symbols.test.ts`. |
| ✅ C3 | HIGH | `latex-syntax/parse.ts:1175` | `parseStringGroupContent` crashes (TypeError on `undefined[0]`) on unbalanced brace at end of input instead of producing an Error expression. **✓ verified:** `\begin{ca{ses`. Fixed: loop also stops at end of input (`!this.atEnd`). Regression test in `latex-syntax/errors.test.ts`. |
| ✅ C4 | HIGH | `dictionary/definitions-core.ts:1972` | `parseTextRun` joins runs with `Array.join()` — default `,` separator. **✓ verified:** `\text{hello {world}}` → `'hello ,world'`. Use `.join('')`. Fixed. Regression test in `latex-syntax/parsing.test.ts`. |
| C5 | MED | `latex-syntax/parse-symbol.ts:253` | `body += parseSymbolBody(parser)` coerces `null` to the string `"null"`. **✓ verified:** `\mathrm{\vec}` parses as the symbol `"null"`. |
| C6 | MED | `latex-syntax/parse-number.ts:172` | Typo `'\\wideparent'` (extra `t`) breaks repeating-decimal detection after a leading decimal separator (`.\wideparen{3}` fails; `0.\wideparen{3}` works). **✓ verified.** |
| C7 | MED | `latex-syntax/serialize-number.ts:552` | `deserializeHexFloat`: tautological guard `value[index] !== '0' || value[index] !== 'x'` means it always returns NaN; the body has further bugs; no callers anywhere. Delete or rewrite with tests. |
| C8 | MED | `math-json/utils.ts:233` | `dictionaryFromExpression` skips `ops[0]` (loop starts at 1 over a 0-based, head-stripped array) and returns an unwrapped shape for the KeyValuePair branch. **✓ verified:** first dictionary entry silently dropped. |
| C9 | MED | `latex-syntax/parse.ts:227` | `addSymbol` (public `Parser` API) has an inverted type-conflict check — re-declaring with the *same* type throws; a different type silently overwrites. |
| C10 | LOW | `dictionary/definitions.ts:959` | `isValidEntry` matchfix check tests `'symbolTrigger' in isPrefixEntry` (a function) instead of `in entry` — always false. |
| C11 | LOW | `latex-syntax/tokenizer.ts:289-307` | `\csname` parameter expansion and space-skipping are dead code (`lex.peek()` returns one grapheme, can never equal multi-char tokens). |

### Numerics / numeric-value / big-decimal

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ D1 | HIGH | `numeric-value/machine-numeric-value.ts:385` | Complex `pow`: De Moivre argument computed as `argument ** exponent` instead of `argument * exponent`. **✓ verified:** `i^2` → `(-0.781 + 0.624i)` instead of `−1`. |
| ✅ D2 | HIGH | `machine-numeric-value.ts:182`, `big-numeric-value.ts:215-220` | Complex `inv()` divides the conjugate by \|z\| instead of \|z\|². **✓ verified:** `inv(2i)` → `−i` in both classes; correct is `−0.5i`. Also reached via `pow(-1)`. |
| ✅ D3 | HIGH | `numeric-value/exact-numeric-value.ts:502-503` | `pow` with exact 1/n exponent calls `root(rational[0])` — the numerator, just established to be 1 — so it always returns `this`. **✓ verified:** exact `8^(1/3)` → `8`. Should be `root(rational[1])`. |
| ✅ D4 | HIGH | `exact-numeric-value.ts:714-726` | `floor`/`ceil`/`round`: `this.type === 'integer'` never matches (getter returns `'finite_integer'`), so exact bigint rationals round-trip through floats and lose digits. **✓ verified** on 23-digit integers. |
| ✅ D5 | HIGH | `big-decimal/big-decimal.ts:632` | `mod()` uses precision-bounded `div`, wrong when \|this/other\| > 10^precision. **✓ verified:** `1e60 mod 3` → `10000000000` instead of `1`. Also corrupts the `mod`-based `BigNumericValue.gcd`. |
| ✅ D6 | HIGH | `big-decimal/transcendentals.ts:85-95`, `utils.ts:265-268` | Fixed-point bridge uses absolute precision: `exp(-200)` → `0` (true ≈1.4e-87), `exp(-80)` has ~17 correct digits of 50, and `ln(1e-100)` **hangs forever** (`fpsqrt(0)=0` infinite loop). **✓ verified.** Factor out the decimal exponent before the fixed-point kernel. **✓ fixed:** `BigDecimal.exp`/`ln` now range-reduce in exact bigint fixed-point — `exp(x)=exp(r)·10^k` (`r∈[0,ln10)`), `ln(x)=ln(m)+e·ln10` (`m∈[1,10)`) — so the kernel only sees O(1) values. Verified at the BigDecimal layer: `exp(-200)`=1.383896…e-87, `exp(-80)`=1.804851…e-35, `ln(1e-100)`=−230.2585… (terminates), `exp↔ln` round-trips to <1e-45. 624 BigDecimal tests pass; 3 regression tests in `transcendentals.test.ts`. **✓ CE-level follow-ups resolved (2026-06-09):** the `.N()` symptoms (`exp(-200)`→0, `ln(1e-100)`→−∞, `Power(10,-100)`→0) traced to a single root cause — the two-arg numeric apply path (`apply2`, apply.ts:83) chopped its *real* result to 0 below the engine tolerance, while one-arg `apply` did not. `Power(10,-100)` and `exp(-x)` both route through `apply2`, so their legitimately-small results were discarded (and `ln(10^-100)` then saw a 0 input). Removed the real-result chop in `apply2` (the complex re/im chop is kept for trig roundoff): `Power(10,-100).N()`→`1e-100`, `exp(-200).N()`→`1.38e-87`, `ln(10^-100).N()`→`−230.26`; full compute-engine suite green (only the 3 pre-existing `@fixme` matrix tests fail). **Dead end noted:** precision-scaling `ce.tolerance` (engine-numeric-configuration.ts:78) was tried and reverted — `stochasticEqual` relies on a *loose* fixed tolerance to absorb sampling/cancellation error, so tightening it at high precision broke equation-equivalence (`equal`/`stochastic-equal`). The `apply2` fix makes the tolerance change unnecessary. |
| ✅ D7 | HIGH | `numerics/statistics.ts:132-212` | Skewness and kurtosis formulas are mathematically wrong (missing central-moment terms, missing 1/n normalization) in **both** machine and bignum versions. **✓ verified:** `skewness([1..5])` → 8.49 (must be 0), `kurtosis([1..5])` → −13.8 (impossible). |
| ✅ D8 | HIGH | `numerics/numeric.ts:101,114` | `canonicalInteger` radical table has wrong entries: 8 → `[1,8]` (should be `[2,2]`) and 20 → `[1,20]` (should be `[2,5]`). **✓ verified + fixed:** corrected both entries (all others checked). `√8`→`2√2`, `√20`→`2√5`, `isSame(2√2)`→true; `solve(2x²−16=0)`→`±2√2` (inline snapshot updated — real improvement, was un-normalized). Tests in `numeric.test.ts` "NUMERIC radical normalization (D8)". |
| ✅ D9 | HIGH | `big-decimal/big-decimal.ts:703-711` | `pow` overflow estimate overestimates log10 by up to 1 order of magnitude: `BigDecimal(1).pow(1e16)` → `Infinity` (should be 1). **✓ verified + fixed:** the guard used `bigintDigits` (=`floor(log10)+1`) as log10; now estimates an accurate float log10 from the leading ~15 digits. `1^1e16`→1, `2^1e16`→finite (also fixed — was falsely Infinity); genuine overflows (`10^1e16`, `1e100^1e15`) still return Infinity. Tests in `big-decimal.test.ts`. |
| ✅ D10 | MED | `machine-numeric-value.ts:376` | Negative exponent path uses only `this.decimal`, dropping the imaginary part. **✓ verified:** `(1+i)^{-2}` → `1` (correct: `−0.5i`). |
| D11 | MED | `big-numeric-value.ts:456,470` | `root(n)` computed as `pow(1/n)` with a machine-precision reciprocal — only ~17 digits correct at precision 50. **✓ verified** for `root(2,7)`. |
| D12 | MED | `big-numeric-value.ts:256-263,294-301` | `NaN · 0` returns `0` (zero branches omit the `isNaN` check that ExactNumericValue has). **✓ verified.** |
| D13 | MED | `machine-numeric-value.ts:543-546` | `eq` uses subtraction, so `Infinity.eq(Infinity)` → false (Inf−Inf = NaN), inconsistent with BigNumericValue. **✓ verified.** |
| D14 | MED | `numerics/bigint.ts:13` | Fast-path guard reads `a >= MAX_SAFE_INTEGER && a <= MAX_SAFE_INTEGER` — only true at exactly that value. Every safe integer takes the slow path, and `bigint(2.46e100)` (the doc comment's own motivating case) returns `null`. **✓ verified.** |
| D15 | MED | `exact-numeric-value.ts:354-360` | `inv()` throws RangeError on ±Infinity/NaN (unguarded `BigInt(Infinity)`). **✓ verified.** |
| D16 | MED | `numerics/special-functions.ts:21-36` | `gammaln` applies bare Stirling asymptotics for all z — `gammaln(0.5)` off by 1.6e-2; inherited by `beta()` for large args. Shift z upward by recurrence first. |
| D17 | MED | `big-numeric-value.ts:326` | Division by zero always returns +Infinity, losing the sign (ExactNumericValue returns sign-aware infinity). |
| D18 | MED | `big-numeric-value.ts:389-395`, `machine-numeric-value.ts:344-349` | Complex-exponent pow uses ln of the real part only and drops the `exp(−d·arg z)` magnitude factor — correct only for positive real bases. |
| D19 | MED | `numerics/interval.ts:97-138` | `intervalContains` comparisons are inverted (rejects every interior point); `intervalSubset` open/open case wrong. Both functions are dead code — fix or delete. **✓ verified.** |
| D20 | LOW | `numerics/statistics.ts:273-281` | `interquartileRange` inconsistent with `quartiles` (`slice(mid+1)` vs `slice(mid)`); duplicated in the bignum version. **✓ verified.** |

### Compilation / symbolic / interval

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ E1 | HIGH | `compilation/javascript-target.ts:380-396` | `Range` with symbolic bounds: `parseFloat` returns `NaN`, never `null`, so the guard `fStop !== null` always takes the constant branch → `Array.from({length: NaN})` → always `[]`. **✓ verified + fixed:** guard is now `!isNaN(...)`, so symbolic bounds fall through to the runtime-length branch. Also fixed an exposed latent bug — the map callback's throwaway param `_` shadowed the argument object `_`, breaking a symbolic *start* like `_.a` (renamed to `_e`). `Range(1,n)`→[1..n], `Range(a,b)`→[a..b], `Range(a,n,2)` all run. Tests in `compile.test.ts` "COMPILE Range with symbolic bounds (E1)". |
| ✅ E2 | HIGH | `symbolic/derivative.ts:66-75` | `Arcsec`/`Arccsc` derivative table entries are wrong (and identical to each other): both give `−x²/√(1−x²)`, which is complex/0 on the actual domain \|x\|≥1. **✓ verified + fixed:** now `d/dx arcsec(x) = 1/(\|x\|·√(x²−1))` and `d/dx arccsc(x) = −1/(\|x\|·√(x²−1))`; at x=2 → ±0.2887. Tests in `derivatives.test.ts` "Inverse secant/cosecant derivatives (E2)". |
| ✅ E3 | HIGH | `compilation/gpu-target.ts:354` | GPU maps CE's `Degrees` (deg→rad) to GLSL `degrees()` (rad→deg) — the inverse of every other target. **✓ verified + fixed:** `Degrees` now maps to GLSL `radians()`. Test in `compile-glsl.test.ts` "should compile Degrees as radians() (E3)". |
| ✅ E4 | HIGH | `gpu-target.ts:274-282`, `constant-folding.ts:93,145-152` | Missing parentheses in GPU complex multiply: factors compiled at precedence 0 then joined with `*`. **✓ verified:** `(x+1)·z·w` compiles to `(x + 1.0 * _gpu_cmul(w, z))` — wrong arithmetic. **Fixed:** the operator path wraps operands by precedence, but complex operands skip operators and reach the Multiply *function handler*, which compiles factors at prec 0. Added `parenthesizeFactor()` (constant-folding.ts) wrapping `Add`/`Subtract` real factors; applied in the gpu complex-multiply (general + imaginary) and `tryGetComplexParts`. Now `((x + 1.0) * _gpu_cmul(w, z))`; numeric scalars stay unparenthesized. Tests in `compile-glsl.test.ts` (E4). |
| ✅ E5 | HIGH | `compilation/interval-javascript-target.ts:322-332` | Interval Sum/Product with compound symbolic bounds: `compileIntervalBound` takes `.hi` of an `IntervalResult` wrapper (not a bare `{lo,hi}`) → `Math.floor(undefined)` = NaN → loop never runs, silently returns the identity. **✓ verified:** `Sum(k,(k,1,n+2))`, n=3 → 0 instead of 15. **Fixed:** the bound now unwraps either shape (`(_b) => _b && _b.value ? _b.value.hi : _b.hi`) — a compound bound returns an `IntervalResult` while a simple symbol stays a bare interval. `Sum(k,1..n+2)` n=3 → 15, `Product(k,1..n+1)` n=3 → 24, simple `Sum(k,1..n)` still 15. Tests in `compile-interval-js.test.ts` (E5). |
| ✅ E6 | HIGH | `symbolic/simplify-power.ts:524-531` | Rule `(-x)^{odd/even} → x^{odd/even}` changes mathematical meaning — the two are real on disjoint half-lines. **✓ verified:** `(-x)^{3/4}` simplifies to `x^{3/4}`; at x=1 the original is complex, the "simplified" form is 1. Delete the branch. |
| ✅ E7 | MED | `symbolic/simplify-sum.ts`, `simplify-product.ts`, `simplify-rules.ts` (~20 sites) | Numerous `.simplify()` calls inside registered simplification rules — the documented recursion-hazard class that bypasses the dedup/step-limit guards. Worst: the Derivative rule (`simplify-rules.ts:614-630`) returns a RuleStep unconditionally, re-firing a nested full simplification every pass. **✓ verified + fixed the actionable core:** the two *always-firing* rules — Derivative (the named worst case) and `simplifySystemOfEquations` — now emit a step only on an actual change (`isSame` guard), and `Hypot` no longer calls `.simplify()` (the driver simplifies its `Sqrt` rewrite; verified output-neutral across `Hypot(3,4)→5`, `(x,y)→sqrt(x²+y²)`, `(x,0)→|x|`). Regression tests in `simplify-rules.test.ts` → "E7: no always-firing / redundant in-rule .simplify()". **Intentionally retained** (not unguarded hazards): the result-rewrite `.simplify()` in Congruent/Arctan2/Sqrt are *load-bearing for the cost gate* (their unsimplified rewrites are costlier than the input and would be rejected); the sum/product `.simplify()` are bounded closed-form/coefficient computations; the relational-operator helper already has an `isSame` guard. Removing those regresses output (e.g. dropping Congruent's `.simplify()` stops `Congruent(7,1,3)` collapsing) — they belong with the Fungrim `purpose: 'transform'` cost-exemption work, not a blanket removal. |
| ✅ E8 | MED | `interval/elementary.ts:596-609` | Interval gamma assumes monotonicity on negative strips — but each (−n−1,−n) has an interior extremum. **✓ verified:** γ over [−0.9,−0.1] → enclosure [−10.69,−10.57] but γ(−0.5) ≈ −3.55 is outside it. **Fixed:** added a table of the gamma extrema (digamma zeros) per negative strip; the extremum is now included in the enclosure (γ([−0.9,−0.1]) → [−10.69,−3.54]), with a conservative extend-toward-0 fallback for strips past the table. `gammaln` had the same bug (interior minimum) and is fixed analogously. Tests in `interval-arithmetic.test.ts` (E8–E12). |
| ✅ E9 | MED | `interval/arithmetic.ts:63-66` | `_mul`: `0 × ∞` products propagate NaN through min/max — breaks ordinary inputs like `x·ln(x)` on [0,1]. **✓ verified + fixed:** endpoint products now use the interval convention `0·±∞ = 0`. |
| ✅ E10 | MED | `interval/trigonometric.ts:616-708` | `sinc` widens only `lo` beyond its 10 tabulated extrema (true max escapes, e.g. on [38,40]); `fresnelS`/`fresnelC` have **no** fallback past their tables (x ≳ 6.2). **✓ verified + fixed:** `sinc` now bounds the beyond-table tail by `±1/m` (|sin x/x| ≤ 1/|x|, m = closest approach to 0); Fresnel integrals bound the tail by the `0.5 ± A` convergence band (A = deviation at the last extremum). |
| ✅ E11 | MED | `interval/elementary.ts:709-771` | `binomial`/`gcd`/`lcm` interval bounds use corner sampling on non-monotonic functions — e.g. C(10, [0,10]) corners are all 1, but C(10,5)=252. **✓ verified + fixed:** now enumerate the integer grid (`enumerateInteger2`, capped at 4096 points) for a true enclosure — `C(10,[0,10])`→[1,252], `gcd(6,[0,9])`→[1,6], `lcm(2,[1,6])`→[2,10] — with a conservative bound for very wide ranges. |
| ✅ E12 | MED | `interval/comparison.ts:210-227` | Interval `clamp` implemented as intersection: returns `empty` for disjoint inputs instead of the clamp image. **✓ verified + fixed:** reimplemented as `min(max(x,lo),hi)` — `clamp([5,6],[0,0],[2,3])` → [2,3]. |
| ✅ E13 | MED | `compilation/base-compiler.ts:149-163`, `python-target.ts:24` | Equal-precedence operands not parenthesized → wrong grouping for non-associative operators. Python `Power(Power(a,b),c)` emits `a ** b ** c`, which Python parses right-associatively. **✓ verified + fixed:** the operator-join now parenthesizes the left operand of the right-associative `Power` at equal precedence → `(a ** b) ** c`; the right-nested `a**(b**c)` stays `a ** b ** c`. Only `Power` (Python-only operator; JS/GPU use function calls) is affected. Tests in `compile-python.test.ts`. (`Divide` left-assoc doesn't manifest — canonicalization restructures nested division.) |
| ✅ E14 | MED | `gpu-target.ts:1227-1283,2897-2898` | GLSL-only Gamma/Erf preambles are emitted for WGSL too (no `_WGSL` variants, unlike every other preamble) — WGSL shaders using Gamma/Factorial/Beta/Erf won't compile. **✓ verified + fixed:** added `GPU_GAMMA_PREAMBLE_WGSL`/`GPU_ERF_PREAMBLE_WGSL` (`fn … -> f32`), renamed the GLSL ones `_GLSL`, and made the preamble selection branch on `languageId`. Tests in `compile-wgsl.test.ts` (E14). |
| ✅ E15 | MED | `base-compiler.ts:209-280`, `gpu-target.ts:459,715,724` | Default `If`/`Which`/`When` emit JS ternaries and bare `NaN` into GPU shaders; WGSL has no ternary and neither language has a `NaN` identifier. **✓ verified + fixed:** added GPU `If`/`Which`/`When` handlers — `select(...)` for WGSL, ternary for GLSL — with a language-appropriate NaN (`0.0/0.0` for GLSL, `bitcast<f32>(0x7fc00000u)` for WGSL). Tests in `compile-wgsl.test.ts`/`compile-glsl.test.ts` (E15). |
| E16 | LOW | `interval/elementary.ts:488-520` vs `javascript-target.ts:492-503` | Interval `mod` ([0,\|b\|) convention) doesn't enclose the compiled scalar mod (sign-of-b floored convention) for negative modulus. |

### Type system & tensor

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| ✅ F1 | HIGH | `tensor/tensors.ts:613-648` | `determinant()` crashes for n≥4: the Bareiss branch indexes a flat array as 2D, reads `rowIndices[k-1]` = index −1 on the first iteration, and mixes 0-based loops with the 1-based `at()`. **✓ verified:** det of 4×4 identity throws. Exposed via `Determinant`. |
| ✅ F2 | HIGH | `tensor/tensors.ts:681-745` | `inverse()` crashes for n≥3: same index-base bugs plus a comma-operator bug — `augmented[(rowIndices[k], k)]` evaluates to `augmented[k]` (a whole row as "pivot"). **✓ verified.** Only the hardcoded 2×2 path works. |
| ✅ F3 | HIGH | `tensor/tensors.ts:440-464` | `slice()` off-by-one for rank≥2: rank-1 path is 1-based, rank≥2 path computes `start = index * stride` (0-based). **✓ verified:** on a 2×3 matrix, `slice(1)` returns row 2; `slice(2)`/`slice(-1)` return `[]`. The iterator compensates with `slice(i-1)`, breaking negative indices. |
| ✅ F4 | HIGH | `tensor/tensors.ts:235-286` | `isUpperTriangular` is inverted (returns false exactly when the matrix *is* upper triangular), `isDiagonal` actually tests for the zero matrix, `isTriangular` tests diagonality. **✓ verified** on `[[1,2],[0,3]]` and `diag(5,7)`. |
| ✅ F5 | HIGH | `common/type/parser.ts:695-770`, `lexer.ts:281,351` | Documented dimension syntaxes fail: the lexer's `case 'x':` is unreachable (identifier rule consumes it), so `matrix<?x3>`, `matrix<2x?>`, `matrix<2 x 3>`, `matrix<integer^(2x3)>` all fail. Only the `x3x4`-as-identifier regex hack works. **✓ verified.** Fixed: rewrote `parseDimensions` to handle the various `x`-separator tokenizations (fused/standalone/`?`) and added `parseCaretDimensions` for the `^(…)` form. Regression tests in `common/types.test.ts`. |
| ✅ F6 | HIGH | `common/type/serialize.ts:115,126` | `typeToString → parseType` round-trip broken: the serializer emits `matrix<integer^(2x3)>`, which the parser rejects (see F5). **✓ verified.** Risky because the codebase routinely round-trips types through strings. Fixed via F5 (parser now accepts the serializer's output); round-trip regression test added. |
| ✅ F7 | HIGH | `common/type/parser.ts:727-770` | `list<number^2>` silently drops the dimension: `parseDimensionWithX` consumes the number token and returns `undefined` without restoring it. **✓ verified:** no error, wrong type. Fixed by removing the buggy `parseDimensionWithX`. **Note:** preserving dimensions corrected engine-wide tensor type inference — a fixed-size numeric list/matrix now infers `vector<N>`/`matrix<NxM>` (was the dimension-dropped `list<number>`); 5 tests that encoded the old types were updated (3 linear-algebra error messages, A3.4, 1 collection function-form). |
| ✅ F8 | HIGH | `common/type/subtype.ts:151-155` | Non-integer literal value types are not subtypes of `real`: falls back to `isPrimitiveSubtype('number', rhs)` and `number ⊄ real`. **✓ verified:** `value 3.5` is not a subtype of `real`. The symmetric path at 518-521 does it correctly. Fixed: non-integer literal maps to `real`. Regression test in `common/types.test.ts`. |
| F9 | MED | `tensor/tensors.ts:34-99` | `broadcast()`/`align()` perform no shape check despite the documented contract. **✓ verified:** [2,2] + [3] returns `[11,22,33,null]` with shape [2,2] — silent garbage. Affects all elementwise ops. |
| F10 | MED | `common/type/reduce.ts:111-122` | Union reduction is order-dependent: keeps the **first** of a subtype-related pair, so `integer \| number` reduces to `integer`. **✓ verified.** Keep the supertype. |
| F11 | MED | `common/type/reduce.ts:201-204` | `reduceListType` filters out −1 ("any size") dimensions and returns `'nothing'` — a bare `matrix` type annihilates any intersection. **✓ verified.** |
| F12 | MED | `common/type/primitive.ts:68-88` | `isValidType` is missing kinds `value`, `expression`, `symbol`, `numeric` (and lists a nonexistent `function` kind) — `parseType(TypeObject)` returns `undefined` for those, violating its overload. **✓ verified.** |
| F13 | MED | `common/type/subtype.ts:124-125` | `never` is not bottom: `isSubtype('never','never')` is false (reflexivity violated) and `never ⊄ list<integer>`. Add an early `if (lhs === 'never') return true`. |
| F14 | MED | `common/type/subtype.ts:610-628` | `narrow2` falls back to `superType` — a *narrowing* operation returning a **wider** type (`narrow('integer','string')` → `scalar`). Should be `never` for disjoint types. |
| F15 | MED | `tensor/tensors.ts:322-334` | `diagonal()` validates its axis arguments then ignores them — always computes `data[i*n+i]`, wrong for rank>2 or non-default axes. |
| F16 | LOW | `tensor/tensor-fields.ts:488-491` | `getSupertype('float64','complex64')` → `complex64` (32-bit components, precision loss); correct join is `complex128`. |
| F17 | LOW | `common/type/parser.ts:1001-1033` | New parser accepts `integer<10..0>` and `integer<nan..10>` without the old parser's bound validation. |

---

## (b) Simplification & Refactoring

### Dead code (delete)

- **`common/type/parse.ts:138-1274`** — ~1,250 lines of legacy `TypeParser` retained only
  "for benchmarking". It also hosts the authoritative BNF comment, masking that the new
  parser diverges from it (F5–F7). Move the BNF to `parser.ts` and delete.
- **`boxed-expression/polynomials.ts:32-127`** — `coefficients()` is a broken stub (always
  returns `[[]]`), `univariateCoefficients` unconditionally returns `null`, `_getDegree`
  has no callers. The real implementation is `getPolynomialCoefficients`.
- **`latex-syntax/serialize-number.ts:552`** — `deserializeHexFloat` (always NaN, no callers)
  plus the commented-out `serializeBaseNotation` block above it.
- **`boxed-expression/boxed-function.ts:790-808`** — `if (this.isNumberLiteral)` block in
  `BoxedFunction.root()` is unreachable (always false on BoxedFunction).
- **`boxed-expression/boxed-number.ts:287-297`** — dead branches in `mul()` (re-checks
  already-returned fastpath conditions).
- **`library/arithmetic.ts:941-949,1088`** — Multiply type handler's rational branch is
  unreachable (real check returns first); Power `sgn` has a dead `0^0` line.
- **`library/calculus.ts:317-336`** — Integrate evaluate: if/else branches are identical.
- **`compilation/interval-javascript-target.ts:31-48`** — `INTERVAL_JAVASCRIPT_OPERATORS`
  is dead and would mis-compile if ever wired (identifiers with dots).
- **`numeric-value/exact-numeric-value.ts:78-95`** — `decimal` is a constant `1`; both
  branches testing it (and the tautological assert) are dead.
- **`compilation/javascript-target.ts:366-399`** — Range handler: dead `stop === null`
  swap, unreachable runtime-length branch (E1), and 1-arg semantics that disagree with
  the runtime `Range(n)` canonicalization. Rewrite atop the already-correct
  `BaseCompiler.compileRangeIterable`.
- **Misc type-system micro-dead-code** — `serialize.ts:81-87` (unreachable `'tensor'`
  branch, so tensor types serialize as `list<number>`), `lexer.ts:351` (unreachable
  `case 'x'`), `type-builder.ts:275-284`, `subtype.ts:156-157` (duplicate boolean check).

### Duplication (factor out)

- **Three near-identical Sum/Product compilers** (`javascript-target.ts:1626-1770`,
  `interval-javascript-target.ts:275-395`, `gpu-target.ts:84-187`): `extractLimits`,
  bound compilation, and the unroll-vs-loop strategy (UNROLL_LIMIT=100) are copy-pasted.
  Bug fixes like E5 must currently be applied three times. Hoist a parameterized
  generic into base-compiler with target hooks.
- **Three delimiter-shorthand tables** (`parse.ts:68`, `dictionary/definitions.ts:61`,
  `definitions-core.ts:2297`) that can silently diverge; the third does reverse lookup
  by linear scan. One shared module with a precomputed reverse map.
- **Four near-identical inequality-bounds blocks** in `compare.ts` `cmp()`
  (227-284, 299-351, 416-462) — extract a `compareToBounds()` helper.
- **`Histogram`/`BinCounts`** (`library/statistics.ts`) — ~40 duplicated lines differing
  only in output shape, with inconsistent bins-argument checks (B15).
- **`chop()` and decimal-string formatting** duplicated between `big-numeric-value.ts`
  and `machine-numeric-value.ts` / `strings.ts` — move to a shared numerics utility.
- **`makeParseHandler` infix branches** (`dictionary/definitions.ts:792-820`) — the four
  associativity cases differ only in a precedence offset and a fold flag; one branch has
  `if (typeof h !== 'string') return [h,lhs,rhs]; return [h,lhs,rhs];` (identical arms).
- **`interquartileRange`** should be `q3 − q1` from `quartiles()` instead of reimplementing
  (and disagreeing with) the quartile logic, in both machine and bignum versions.
- **`reduceType`** (`common/type/reduce.ts:97-151`) round-trips members through
  `typeToString`/`parseType` for dedup, and contains an always-`acc.length === 0` `some()`
  that obscures intent — dedup structurally.

### Consistency

- The three `ln(base)` implementations (BoxedNumber / BoxedFunction / BoxedSymbol) behave
  differently for non-integer bases (A7) — unify on the BoxedSymbol behavior.
- `div()` by zero yields different results depending on entry path (A11); `eq` semantics
  differ between Machine and Big numeric values for infinities (D13); division-by-zero
  sign handling differs between Exact and Big (D17). Pick one convention per operation.

---

## (c) Performance Optimizations

### Highest impact

1. **`peekDefinitions` scans all ~812 dictionary defs per call** — and it's called ~6
   times per token position (`latex-syntax/parse.ts:593`). Parsing is O(tokens ×
   dictionary). Precompute per-kind lists of universal-trigger and symbolTrigger defs
   in `IndexedLatexDictionary` at indexing time (the dictionary is immutable once indexed).
   Related: `parseComplexId` (parse.ts:613) re-runs a full speculative `parseSymbol` once
   per symbolTrigger def (69 of them) at each position — parse the symbol once and look
   up in a `Map<symbolTrigger, defs>`.
2. **`parseType()` has no memoization** (`common/type/parse.ts:1393`) despite being called
   with identical literal strings in per-evaluation hot paths (`parseType('indexed_collection<integer>')`
   in collections.ts, template-string types in handlers, and `isSubtype` parsing string
   operands on every call). Add a Map/LRU cache keyed by string; freeze cached Types.
3. **Tokenizer is O(n²)** (`latex-syntax/tokenizer.ts:118-132`): `match` slices the entire
   remaining input per token, and `next()` calls it at least once per token. Use sticky
   regexes (`/y` with `lastIndex`) or index arithmetic. Also `tokensToString`
   (tokenizer.ts:409) accumulates with `flat = [...flat, ...item]` — O(n²); use `push(...)`.
4. **`Add` term accumulation is O(n²) with deep compares** (`arithmetic-add.ts:353-368`):
   every term does a linear `findIndex` with recursive `isSame`. Bucket by the
   already-cached `term.hash`, confirming with `isSame` only within a bucket.

### Worth doing

- **`lookAhead` rebuilds all 13 lookahead strings per kind per position**
  (`parse.ts:513-525`) and recomputes the identical result for each of the ~6
  `peekDefinitions` calls at the same index — build incrementally and cache by index.
- **`parseSupsub` does a full dictionary scan** to find the `_`/`^` infix defs
  (`parse.ts:2063,2085`) although `infixByTrigger` already indexes exactly this.
- **Subtype machinery linear scans** (`common/type/subtype.ts:102,110-119,722-775`):
  `PRIMITIVE_SUBTYPES[rhs].includes(lhs)` array scans, and `superType` probes ~22
  ancestors × 2 `isSubtype` calls per `widen`; `unionTypes` dedups with O(n²)
  `JSON.stringify`. Use `Set`s and a direct primitive-pair lookup table.
- **Add/Multiply rules evaluate every constant operand on every simplify pass**
  (`simplify-rules.ts:250-270,349-380`) — repeatedly across iterations. Cache, or
  restrict to a cheap arithmetic whitelist as `evaluateNumericSubexpressions` does.
- **Add/Multiply evaluate handlers eagerly `.evaluate()` all operands to detect Quantity,
  then discard the results in `N()` mode** (`library/arithmetic.ts:230-240,996-1004`) —
  doubling work on the hottest operators. Detect Quantity cheaply first.
- **`_typeResolver` getter allocates a new resolver per access** (`index.ts:359-361`),
  and it's read on essentially every `.type` computation. Create once in the constructor.
- **Simplify loop detection is O(n²) with allocation per step** (`simplify.ts:86-87,182`):
  `steps.slice(0,-1).some(isSame)` per iteration. Track a `Set` of hashes.
- **Number-theory loops are non-interruptible and exponential** (`library/number-theory.ts:7-121`):
  `Totient`/`Sigma*`/`IsPerfect` loop to k (not √k) without `run()`/yield, bypassing
  `_timeRemaining`; `Eulerian`/`Stirling` are unmemoized double recursion (exponential)
  while the adjacent `NPartition` memoizes.
- **`BigDecimal.toNumber()` stringifies the full significand** (`big-decimal.ts:779`) on
  the hot big→machine path — round to ~20 digits first.
- **`inlineExpression` calls `new Function` twice per Cot/Coth/Fract/Haversine compile**
  (`base-compiler.ts:885-903`) — a plain string substitution suffices (and avoids CSP
  `unsafe-eval` issues).
- **GPU Variance inlines the full mean subexpression 2n times** (`gpu-target.ts:996-1020`)
  → O(n²) shader code; bind mean once via a preamble or statement block.
- **Hot-path constants rebuilt per call**: `BARE_FUNCTION_MAP` (~50 entries) inside
  `tryParseBareFunction` (`parse.ts:1760`), the `excluding` array in `parseToken`, the
  visual-space command list in `skipVisualSpace`; `SYMBOLS.findIndex` linear scans in
  symbol parse/serialize (`parse-symbol.ts:98`, `serializer.ts:432,458`) — hoist to
  statics / lazy `Map`s (the `getSymbolToUnicode` pattern already exists).
- **Catch-all in the interval function proxy** (`interval-javascript-target.ts:411-421`)
  swallows TypeErrors as `{kind:'entire'}` — it hid E5. Not a perf item per se, but it
  masks the cost and correctness of everything behind it; narrow the catch.

---

## Suggested Priorities

1. **Fix the runtime-crash and silently-wrong-answer bugs first**: tensor linear algebra
   (F1–F4), collection handlers (B3–B8), complex arithmetic in numeric-value (D1–D4),
   `BigDecimal` `mod`/`exp`/`ln` (D5, D6), statistics formulas (D7), comparison predicates
   (A1, A3), and the meaning-changing simplify rule (E6).
2. **Restore the type-string round-trip** (F5–F7, F8) — silent type corruption propagates
   everywhere types pass through strings.
3. **Remove `.simplify()` from simplification rules** (E7, B14, A16) — the documented
   recursion class; the Derivative rule re-fires every pass.
4. **Then the two big perf wins**: dictionary-indexed `peekDefinitions` and a memoized
   `parseType`, followed by the O(n²) tokenizer fix.
5. **Dead-code deletion** (legacy TypeParser, polynomial stubs, hex-float deserializer)
   is low-risk and removes ~1,500 lines.

Most findings above were verified at runtime; the rest were confirmed by careful reading
of the surrounding code. Each table row cites the exact file and line for follow-up.

---

## Addendum (2026-06-09): Findings from Fungrim Phase-0 work

Discovered while spiking the Fungrim corpus translation and the solve-rules API — same
verification standard as above (all reproduced at runtime):

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| G1 | MED | `library/special-functions` (Erf kernel) | `Erf`/`Erfc` numeric kernel is only ~7-digit accurate (rel. err ≈1.2e-7 / 6.6e-7) and does **not** improve at precision 30 — the approximation, not roundoff, is the limit. Related to B23 (these handlers also ignore `numericApproximation`). |
| ⏸️ G2 | MED | `boxed-expression/solve.ts` (post-harmonization passes) | Harmonization is effectively inert: `matchAnyRules` binds `_x` to the *original* symbol while the harmonized expression contains the literal `_x` symbol, so no pattern root rule can match post-harmonization, and `captureWildcard` (`match.ts:63`) rejects `_x`-containing captures so built-in harmonization rules (e.g. `['Ln','_a']`) never fire. Emptying `ce.harmonizationRules` changes no solve outcome. **✓ confirmed** via `.solve()`: `e^x=5`→`[]`, `10^x=100`→`[]`, `ln(x)=ln(3)`→`e^(ln 3)` numeric. **⏸️ DEFERRED** (2026-06-09): the fix is in the wildcard matcher (`match.ts`) + `solve.ts`, which depends on `rules.ts`/`matchAnyRules` — the area the Fungrim `rule-dispatch`/`solve-rules` refactor is actively rewriting. Defer to that thread to avoid conflict. |
| ✅ G3 | MED | `library/sets.ts` (`Element` evaluation) | `Element(<untyped symbol>, <number set>)` evaluates to definitive `False` instead of staying unevaluated — same three-valued-logic bug class as A3, one level down (`contains` handlers return `false` for unknowns). **✓ verified:** `Element(a:unknown, RealNumbers)` → `False`. Fixed: added three-valued `typeMembership`/`signedMembership` helpers; the number-set `contains` handlers now return `undefined` for indeterminate-type values (concrete literals and sign assumptions stay decidable). Also fixed `ImaginaryNumbers.contains` (was matching `set<imaginary>` instead of `imaginary`). Regression tests in `set.test.ts` → "Element of a symbol of indeterminate type stays unevaluated" / "Element of concrete values remains decidable". |
| G4 | LOW | `boxed-expression/box.ts` (function-literal heads) | `ce.box([["Function", body, "x"], arg])` throws instead of boxing/beta-reducing; `["Apply", ["Function", ...], arg]` works. Inconsistent acceptance of function-literal heads. |
| G5 | LOW | `boxed-expression` (Subscript canonicalization) | `["Subscript", "a", "k"]` canonicalizes to the *fused symbol* `a_k`, silently severing the binding of `k` if it is a binder-bound index (verified: `Sum` over `k` of subscripted term gave `3*a_k`). Call-form `["a_", "k"]` preserves binding. |
| G6 | MED | `boxed-expression/boxed-string.ts` (`.json` serialization) | `BoxedString.json` omits the MathJSON `'...'` string delimiters, so re-boxing the serialized JSON yields a *symbol*, not a string — round-trip identity loss. Found by Fungrim corpus round-trip checks. |
| G7 | MED | `boxed-expression` (bound-variable identity) | Re-boxing the identical canonical JSON of a `Function` literal containing `Sum(..., Limits)` is not `isSame`-equal to the original — bound-variable identity is unstable across boxings. |
| G8 | MED | `symbolic/derivative` + evaluate | `Apply(Derivative(Function(AiryAi(z), z), 1), 0).evaluate()` → "Maximum call stack size exceeded" (boxing succeeds; evaluation recurses). Likely affects other shell-declared/no-derivative-table heads. |
| ✅ G9 | MED | `library/arithmetic.ts` (LCM) | `LCM(-2, 3)` evaluates to `-6` — LCM carries operand sign; lcm is non-negative by convention. (`GCD` of negatives is correct.) Found by Fungrim Stage-2 validation (entries 157c33, dc0823: LCM sign-invariance identities fail). **✓ verified:** `LCM(-2,3)→-6`, `LCM(-2,3,4)→-12`. Fixed: the low-level `lcm` (machine in `numeric.ts`, bignum in `numeric-bignum.ts`) now returns the magnitude; `evaluateGcdLcm` seeds the accumulator with `abs` (fixes single-operand `LCM(-7)`/`GCD(-8)`) and the bignum seed no longer mishandles a non-integer leading operand. Regression test in `arithmetic.test.ts` → "LCM is non-negative for negative operands (REVIEW.md G9)". |
| ⏸️ G10 | MED | `library/collections.ts` (Count over Set comprehension) | `Count(Set(k, Element(k, Range(1,n), cond)))` returns **2 for every n** — it counts the Set-builder's syntactic operands (body + indexing set), not the comprehension's elements. Verified for n=2..8. Found via Fungrim entry 7b27cd (Count/Totient identity). **✓ confirmed CE-native:** the LaTeX parser produces `Set(body, Condition(Element(var, domain)))` for `\{k \mid k\in…\}`, but `Set`'s collection handlers (`basicIndexedCollectionHandlers`) treat operands as literal elements (`.count=2`, `.each()`→`[k, Element(…)]`). **⏸️ DEFERRED** (2026-06-09): the fix is feature-level (comprehension-aware Set iterator/count/contains; finite-vs-infinite domains; builder-vs-literal disambiguation) and overlaps the Fungrim Count/comprehension work. Defer/coordinate with that thread. |
| ✅ G11 | HIGH | `library/arithmetic.ts` (Gamma N()) | `Gamma(i).N()` returns `i` — the argument passes through unchanged for complex inputs (no complex kernel dispatch on this path, despite `gammaComplex` existing). Verified: expected ≈ −0.1549 − 0.498i. Same pass-through for `Factorial(-2).N()` → `-2` (should be ComplexInfinity: Γ pole). **✓ verified:** root cause was `numeric-complex.ts` `gamma`/`gammaln` being `return c` stubs. Fixed: implemented Lanczos approximation (validated against Γ(i), Γ(1+i), Γ(½)=√π, Γ(5)=24). `Gamma` of a non-positive integer now returns `ComplexInfinity` (pole). `Factorial(-2)` no longer canonicalizes to `−(2!)` (the `-3!` precedence is handled by the parser); negative-integer factorial is now `ComplexInfinity`. Regression tests in `special-functions.test.ts` → "GAMMA FUNCTION" / "FACTORIAL". |
| ✅ G12 | MED | `library/sets.ts` (Subset) | `Subset(Integers, RationalNumbers)` evaluates to `False` (should be `True`) — even the basic primitive-set subset chain is wrong. Found by Fungrim Stage-2 (2 entries). **✓ verified:** the relation was *inverted* (`Subset(RationalNumbers, Integers)` → `True`). Per the documented `subsetOf(collection, other)` contract ("`other` ⊆ `collection`"), the `subset()` dispatcher was calling the handler on the subset candidate instead of the superset candidate. Fixed the dispatch direction, the empty-set-is-a-subset-of-everything case, the `EmptySet.subsetOf` handler (was `() => true`), and an `ExtendedComplexNumbers` strict-self-exclusion copy-paste bug. Regression tests in `set.test.ts` → "SUBSET". |
| ✅ G13 | HIGH | `boxed-expression/arithmetic-mul-div.ts:~685` (canonicalDivide) | `ce.box(['Divide', ['Add', 1, 'ImaginaryUnit'], 2])` canonicalizes to `Multiply(1/2, NaN)`. Dividing a Gaussian-integer sum by an integer destroys the value at boxing time. **✓ verified + fixed:** root cause is in `factor()` (not canonicalDivide) — its Add case takes the gcd of term coefficients, but `gcd(1, i)` = NaN (complex coeff), poisoning the result → `factor(1+i)`=NaN → `toNumericValue` returns `[1, NaN]` → `Multiply(1/2, NaN)`. Guarded `factor()` to leave sums with a complex coefficient (`coeff.im !== 0`) unfactored; `Divide((1+i),2)`→`Multiply(1/2, 1+i)` (=0.5+0.5i). Tests in `factor.test.ts` "Gaussian-integer sums (G13)". |
