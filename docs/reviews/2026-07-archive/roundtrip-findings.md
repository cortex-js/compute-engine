# Representation Round-Trip Review — Findings

Reviewer area: `.json` / `toJSON()` / `toMathJson(options)` / `.latex` / `.toString()` /
`ce.expr(expr.json)` reconstruction / `ce.parse(expr.latex)` meaning preservation.
Branch `main` @ 9b818ec8. All findings empirically reproduced with `npx tsx` scripts in
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/roundtrip/`
(b1…b8) unless marked "static analysis only".

Contract document: `docs/NUMERIC-SERIALIZATION.md` — claims `.json` is "No rounding …
lossless … Round-tripping (`ce.expr(expr.json)`) preserves the exact internal state …
No information is silently discarded", and `.latex` "Rounds to `ce.precision`".
Several findings below are direct violations of those exact sentences.

---

## P0 findings

### RT-P0-1. `.json` emits a JSON float for exact big integers → reconstruction changes the value

**Repro (executed):**
```ts
const ce = new ComputeEngine();
const e = ce.parse('10^{23}').evaluate();      // ExactNumericValue, exactly 10^23
e.json                                          // → 1e+23  (JSON *number*, i.e. float64)
ce.expr(e.json).sub(e).evaluate().toString();   // → -8388608   (!!)

const w = ce.parse('10^{300}').evaluate();
JSON.stringify(w)                               // → "1e+300"
ce.expr(JSON.parse(JSON.stringify(w))).sub(w).evaluate()
// → 5.25047602552044202487…e+283 difference
```
Also corrupts rational components: `["Rational", 1, 1e+300]` is emitted for 1/10^300
(`ce.box(['Rational',1,{num:'1e300'}]).evaluate().json`), and
`["Multiply",["Rational",1e+300,7],["Sqrt",3]]` — reconstruction `isEqual === false`.

**Expected:** `{num: "1e+300"}` (string form), reconstructing to exactly 10^300.
**Actual:** JSON number `1e+300`; MathJSON JSON numbers are machine floats, and reconstruction
(`bigintValue`/boxing treats the float as an exact integer) yields the float64 expansion
`1000000000000000052504760255204420248704…` ≠ 10^300. Silent value corruption through the
documented interchange path (`.json`, `toJSON()`, `JSON.stringify`).

**Root cause:** `numberToExpression` in
`src/compute-engine/numerics/expression.ts:52-54`:
```ts
const numStr = numberToString(num);              // "1e+300" (compact form for bigint w/ >5 trailing zeros)
if (Number(num).toString() === numStr) return Number(num);   // ← string-display comparison
```
`Number(10n**300n).toString() === '1e+300'` is true because float `toString()` returns the
*shortest uniquely-identifying* representation — string equality does NOT imply the float
equals the bigint. Every exact integer `d·10^k` with >5 trailing zeros (compact form produced by
`numberToString`, `src/compute-engine/numerics/strings.ts:160-166`) whose compact string is the
shortest repr of some float is corrupted: 10^23, 10^24, 10^25, 10^100, 10^300, 2·10^300, 7·10^25 …
(all verified failing; `123e21` and non-compacted bigints like `{num:"123456789012345678901234"}` are safe).

**Affected files:**
- `src/compute-engine/numerics/expression.ts:52-54` (the unsound check)
- callers: `src/compute-engine/numeric-value/exact-numeric-value.ts:135-141` (toJSON),
  `src/compute-engine/boxed-expression/serialize.ts:851-867` (BigInt branch)

**Fix direction:** replace the string comparison with an exact value check:
```ts
const n = Number(num);
if (Number.isFinite(n) && BigInt(n) === num) return n;
```
(`BigInt(n)` of an integral float is its exact value; equality then guarantees losslessness.)

**Suggested test:** for `num` in `[10n**23n, 10n**300n, 2n*10n**300n]`:
`ce.expr(ce.box({num: num.toString()}).json).isSame(ce.box({num: num.toString()}))` and
`…sub(…).evaluate().isSame(0)`.

---

### RT-P0-2. `isInMachineRange` ≤17-digit heuristic makes `.json` change 16–17-digit BigDecimal values

**Repro (executed):**
```ts
ce.box({num: '0.12345678901234567'}).json   // → 0.12345678901234566   (last digit CHANGED)
ce.expr(ce.box({num:'0.12345678901234567'}).json)
  .isSame(ce.box({num:'0.12345678901234567'}))   // → false

ce.box({num: '9007199254740993.5'}).json    // → 9007199254740994      (value changed by 0.5)

ce.precision = 17;
const x = ce.parse('2/3').N();              // BigDecimal 0.66666666666666667
x.json                                       // → 0.6666666666666666  (16 digits, JSON float)
ce.expr(x.json).isSame(x)                    // → false
```
So at any working precision ≤ 17 — a legal `ce.precision` setting — plain `.N()` results
fail the `.json` round-trip that `docs/NUMERIC-SERIALIZATION.md` promises.

**Root cause:** `src/compute-engine/numerics/numeric-bignum.ts:34-52` — comment says
"If the BigDecimal can be **faithfully** represented as a machine number", but the test is
`digits <= 17 && -308 < orderOfMagnitude < 309`. Decimal strings of 16–17 significant digits are
NOT guaranteed to round-trip through float64 (only ≤15 are). Consumers:
`src/compute-engine/numeric-value/big-numeric-value.ts:76,79` (toJSON) and
`src/compute-engine/boxed-expression/serialize.ts:748`.

**Fix direction:** make the check exact — `d.eq(new BigDecimal(d.toNumber()))` (or compare
`decimalToString(d)` with the parsed-back value), or conservatively use `digits <= 15`.

**Suggested test:** `{num}` inputs `'0.12345678901234567'`, `'9007199254740993.5'` round-trip
bit-for-bit; `ce.precision = 17; ce.expr(ce.parse('2/3').N().json).isSame(ce.parse('2/3').N())`
(restore precision afterwards — BigDecimal.precision is process-global).

---

### RT-P0-3. High-precision complex numbers: `.json` emits full bignum re, but re-boxing truncates to machine floats

**Repro (executed):**
```ts
ce.precision = 50;
const z = ce.parse('\\sqrt{2}').N().add(ce.I).evaluate();  // BigNumericValue, 50-digit re
z.json  // → ["Complex",{"num":"1.4142135623730950488016887242096980785696718753769"},1]
ce.expr(z.json).json  // → ["Complex",1.4142135623730951,1]      ← 33 digits silently gone
ce.expr(z.json).isSame(z)  // → false
```
Also: any MathJSON input `['Complex', {num: <30 digits>}, 1]` is truncated at boxing, so
high-precision complex values cannot enter the engine through MathJSON at all.

**Root cause:** `Complex` canonicalization in
`src/compute-engine/boxed-expression/box.ts:276-288` reads `ops[0].re` / `machineValue(...)`
(machine floats) for both components, then `ce.number(ce._numericValue({re, im}))`. The
serializer half is fine (`serialize.ts:725-734`, `big-numeric-value.ts:85-89` emit
`{num: bignumRe}`); the parse/box half throws the digits away — a serializer/boxer asymmetry.

**Fix direction:** in the 2-arg `Complex` branch, keep the boxed operands' bignum values
(e.g. `ops[0].bignumRe ?? ops[0].re`) and construct the `NumericValue` from the BigDecimal
when the operand is a bignum literal.

**Suggested test:** round-trip `["Complex",{num:'1.'+'4'.repeat(40)},1]` through
`ce.expr(...).json` bit-for-bit at `ce.precision = 50`.

---

### RT-P0-4. Default `toMathJson()` emits repeating-decimal strings (`"0.(3)"`) that re-box as *strings*, not numbers

**Repro (executed):**
```ts
const third = ce.parse('1/3').N();
const j = third.toMathJson();          // → "0.(3)"   (default options!)
const r = ce.expr(j);                  // → BoxedString "'0.(3)'"  — a STRING
r.type.toString()                       // → 'string'
```
Same for `(4/3).N()` → `"1.(3)"`. Note `"0.12(3)"` (repetend with a digit prefix) re-boxes
fine, and the object form `{num: "0.(3)"}` also boxes fine — only the bare-string shorthand
with *zero* digits between `.` and `(` is rejected.

**Root cause (two halves):**
1. Emission: `serializeRepeatingDecimals` (`src/compute-engine/boxed-expression/serialize.ts:566-628`)
   runs by default (`repeatingDecimal: true` in `abstract-boxed-expression.ts:318`) and, with the
   `number` shorthand enabled, the result is returned as a bare JSON string (`serialize.ts:791`).
2. Recognition: `matchesNumber` (`src/math-json/utils.ts:501-506`) regex
   `^[+-]?(0|[1-9][0-9]*)(\.[0-9]+)?(\([0-9]+\))?([eE][+-]?[0-9]+)?$` requires ≥1 digit after the
   decimal point before `(…)`, so `0.(3)` fails and falls through to string boxing.

**Additionally (contract ambiguity):** the default is `fractionalDigits: 'max'`, documented as
"All available digits (default) / no rounding" — yet `repeatingDecimal: true` *idealizes*
`0.333333333333333333333` (21 stored digits) into `0.(3)` ≡ 1/3, a different number
(≈1.1e-22 off), and claims infinite repetition the engine never verified. This
interaction is undocumented (`docs/NUMERIC-SERIALIZATION.md` never mentions `repeatingDecimal`).

**Fix direction:** make `matchesNumber` accept `x.(y)` (e.g. `(\.[0-9]*)?` combined with a
guard that at least one of fraction/repetend is present), or have the serializer keep at least
one fractional digit before `(`/use the `{num:…}` object form; and document (or default off)
`repeatingDecimal` in `toMathJson`.

**Suggested test:** `ce.expr(ce.parse('1/3').N().toMathJson())` is a number literal equal to the
original within 1 ulp of working precision; `matchesNumber('0.(3)') === true`.

---

### RT-P0-5. `.latex` silently truncates repeating decimals to 6 repetend copies — `(1/3).N().latex === "0.333\,333"`

**Repro (executed, default precision 21):**
```ts
ce.parse('1/3').N().latex     // → "0.333\,333"            (6 digits!)
ce.parse('2/3').N().latex     // → "0.666\,666"
ce.parse('1/6').N().latex     // → "0.166\,666\,6"
ce.parse('37/300').N().latex  // → "0.123\,333\,33"        (even at ce.precision = 50)
ce.parse('1/11').N().latex    // → "0.090\,909\,090\,909"
ce.parse('1/7').N().latex     // → "0.\overline{142857}"   (correct — repetend ≥ 3 digits)
// meaning change on re-parse:
ce.parse(ce.parse('1/3').N().latex).sub(ce.parse('1/3').N()).N()  // → -3.3e-7
```
`docs/NUMERIC-SERIALIZATION.md` says `.latex` "Rounds to `ce.precision` significant digits"
(21 by default; 50 in the 37/300 case) — actual output has 6–12 digits, **no truncation
marker, no overline**, so it reads as an exact terminating decimal. Re-parsing changes the
value by up to 3.3e-7. This hits the most common numeric results there are (thirds, sixths).

**Root cause (chain):**
1. `.latex` → `toMathJson({fractionalDigits:'auto'})` applies `serializeRepeatingDecimals`
   → `"0.(3)"` (`abstract-boxed-expression.ts:236`, `serialize.ts:566-628`).
2. The LaTeX number serializer "unrepeats" with a **fixed 6 copies**:
   `num = body + repeat.repeat(6) + trail` —
   `src/compute-engine/latex-syntax/serialize-number.ts:161-164`.
3. `formatFractionalPart` (`serialize-number.ts:26-65`) can only re-detect a repeating pattern
   when the fractional part has > 17 digits (`i < digits.length - 16`), so repetends of length
   1–2 (6–12 digits after expansion) come out as plain terminating decimals.

**Fix direction:** expand `max(6, ceil(18/len)+1)` copies at `serialize-number.ts:163`, or
better, pass the repetend structurally to `formatFractionalPart` instead of expand-and-redetect.

**Suggested test:** `ce.parse('1/3').N().latex` contains `\overline{3}` (or ≥ 21 significant
digits); re-parse differs from original by < 10^(1-ce.precision).

---

### RT-P0-6. Second-order Leibniz serialization is unparseable: `f''(x)` → LaTeX → `Multiply(d_upright², …)`

**Repro (executed):**
```ts
const d2 = ce.parse("f''(x)");     // ["D",["D",["f","x"],"x"],"x"]
d2.latex                            // → "\frac{\mathrm{d}^{2}}{\mathrm{d}x^{2}}f(x)"
ce.parse(d2.latex).json
// → ["Multiply",["Divide",["Power","d_upright",2],["Multiply","d_upright",["Power","x",2]]],["f","x"]]
```
The derivative becomes a *product of symbols* (`d_upright²·f(x)/(d_upright·x²)`) — silent
meaning change. Same for `f'''(x)` (order 3). First-order round-trips correctly
(`\frac{\mathrm{d}}{\mathrm{d}x}f(x)` → `["D",["f","x"],"x"]`). Latex re-serialization is also
unstable (`\frac{\mathrm{d}f(x)}{x^2}` → error markup on the next round).

**Root cause:** serializer `src/compute-engine/latex-syntax/dictionary/definitions-core.ts:1774`
emits `\frac{\mathrm{d}^{n}}{\mathrm{d}x^{n}}…` for order ≥ 2, but the ordinary-Leibniz parse
branch `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts:483-527` only
matches when the *numerator is a bare `d`/`d_upright` symbol* (`symbol(numer)`); a
`['Power','d_upright',2]` numerator falls through to `['Divide', …]`. (The ∂ branch just above,
lines 473-478, already handles numerator degree — the `d` branch never got the same treatment,
despite recent Leibniz work in commits 67ea0451/1e554807.)

**Fix direction:** in the `isDifferential` branch accept `numer = ['Power', d, n]`, extract the
degree, and strip `['Power', x, n]` in the denominator's `collectVars` (mirroring lines 473-478).

**Suggested test:** `ce.parse(ce.parse("f''(x)").latex).isSame(ce.parse("f''(x)"))`, and the
same for order 3 and for `\frac{d^2}{dx^2}\sin(x)`.

---

## P1 findings

### RT-P1-1. `ce.expr(e.json)` does not restore number-literal state for `["Divide",["Sqrt",n],d]` forms

**Repro (executed):**
```ts
const a = ce.parse('\\frac{\\sqrt{3}}{2}').evaluate();  // BoxedNumber (ExactNumericValue √3·(1/2))
a.json                       // → ["Divide",["Sqrt",3],2]
const r = ce.expr(a.json);   // BoxedFunction 'Divide' — NOT a number literal
r.isSame(a)                  // → false      (isEqual → true)
```
Same via the golden ratio `(1+√5)/2` (its `√5/2` operand). By contrast
`["Multiply",["Rational",3,5],["Sqrt",2]]` and `["Negate",["Sqrt",2]]` DO re-fold into
number literals. Violates the doc's "Round-tripping preserves the exact internal state";
consequences: `isSame`-based dedup/matching treats the reconstruction as a different
expression, and canonical form is non-unique (two canonical expressions, equal value,
different structure).

**Files:** emission `src/compute-engine/numeric-value/exact-numeric-value.ts:153-167` and
`src/compute-engine/boxed-expression/serialize.ts:692-706`; re-folding gap is in canonical
`Divide`/`Sqrt` handling.

**Fix direction:** serialize `(±1/d)·√r` as `['Multiply', ['Rational', ±1, d], ['Sqrt', r]]`
(the form that provably re-folds), or teach canonical `Divide(Sqrt(n), int)` to fold into an
ExactNumericValue.

**Suggested test:** `ce.expr(x.json).isSame(x)` for `x = ce.parse('\\frac{\\sqrt{3}}{2}').evaluate()`
and the golden ratio.

### RT-P1-2. Dictionaries: `isSame` is always `false` for equal-but-distinct dictionaries — round-trip unverifiable

**Repro (executed):**
```ts
ce.box({dict:{a:1,b:2}}).isSame(ce.box({dict:{a:1,b:2}}))   // → false
const d = ce.box(['Dictionary',['Tuple',{str:'a'},1],['Tuple',{str:'b'},2]]).evaluate();
ce.expr(d.json).isSame(d)                                    // → false (json is identical & idempotent)
```
**Root cause:** `same()` in `src/compute-engine/boxed-expression/compare.ts:25-84` has cases for
function/number/string/symbol/tensor only; dictionaries fall through to `return false`
(only the `a === b` identity fast-path can succeed). `BoxedDictionary`
(`boxed-dictionary.ts`) implements no override.

**Fix direction:** add a dictionary case to `same()`: equal key sets and pairwise-`same` values.
**Suggested test:** the two repro lines above must be `true`.

### RT-P1-3. Contract documents contradict each other about `.json` fidelity

`docs/NUMERIC-SERIALIZATION.md:31-53` ( "No rounding … lossless … No information is silently
discarded") vs `src/compute-engine/boxed-expression/boxed-number.ts:104-110`:
"the `.json` property outputs a 'default' serialization which does **not** attempt to capture
all the information … may output a **numeric approximation** … rather than the exact value."
Today the code comment is the accurate one (see RT-P0-1/2/3). Once the P0s are fixed, delete or
rewrite the comment; until then the doc is asserting a guarantee the implementation knowingly
doesn't provide. (Static analysis of the comment; behavior verified above.)

---

## P2 findings

### RT-P2-1. `exclude` serialization option is a no-op for number literals

**Repro (executed):** `ce.parse('\\sqrt{2}').toMathJson({exclude:['Sqrt']})` → `["Sqrt",2]`
(unchanged); `ce.parse('\\frac12').toMathJson({exclude:['Rational']})` → `["Rational",1,2]`.
The `ExactNumericValue` serialization paths hardcode `'Rational'`/`'Sqrt'`
(`serialize.ts:667-712`, `exact-numeric-value.ts:135-169`) and never consult `options.exclude`
(the `exclusions` local at `serialize.ts:646` is only used in the machine-`Rational` branch at
:828-841, which ExactNumericValue rationals never reach; ditto the `Half` shorthand at :520/:835 —
plain `1/2` serializes as `["Rational",1,2]`, so those branches are effectively dead).
Fix: honor `exclude` in the ExactNumericValue branch, or drop/deprecate the option and document it.

### RT-P2-2. `.latex` of exact 10^300 parses back as `Power`, not a literal

**Repro (executed):** `ce.box({num:'1e300'}).latex` → `10^{300}`; `ce.parse('10^{300}')` →
`["Power",10,300]`, `isSame === false` (value preserved after `evaluate()`; structure and
literal-ness lost). Same for `1e-999999` → `10^{-999999}`. Note `2.5e500` → `25\cdot10^{499}`
round-trips to a literal fine. Not a value corruption; worth documenting or emitting
`1\cdot10^{300}` for symmetry with the `2.5e500` path.

### RT-P2-3. Negative zero is unrepresentable

**Repro (executed):** `ce.box(-0).json` → `0`; `Object.is(ce.box(-0).re, -0)` → `false`;
`ce.box({num:'-0'})` and `ce.parse('-0.0')` likewise normalize to `+0` at boxing. IEEE-754
signed zero cannot round-trip through the engine at all. If intended, document it in
`docs/NUMERIC-SERIALIZATION.md`; if not, preserve the sign in `BoxedNumber`.

### RT-P2-4. `\binom` is not parseable (parser dictionary gap)

**Repro (executed):** `ce.parse('\\binom{n}{k}').json` →
`["Tuple",["Error","'unexpected-command'",["LatexString","'\\binom'"]],"n","k"]`.
`grep -rn binom src/compute-engine/latex-syntax/dictionary/` → no hits: the command simply has
no definition. CE's own serialization of `Binomial` (`\mathrm{Binomial}(n, k)`) does
round-trip, so this is an input gap, not an asymmetry — but `\binom`/`\choose`/`\tbinom`/
`\dbinom` are extremely common. (Parser-area finding, reported here because it surfaced in the
round-trip battery.)

### RT-P2-5. `isSame` masks P0-2-class corruption: value changed by 0.5 yet `isSame === true`

**Repro (executed):** `x = ce.box({num:'9007199254740993.5'})` (BigNumericValue 9007199254740993.5);
`y = ce.expr(x.json)` reconstructs as ExactNumericValue `9007199254740994` (wrong, RT-P0-2).
Then: `y.isSame(x)` → **true**, `x.isSame(y)` → **false** — asymmetric, and the values differ
by 0.5. Directly at the NumericValue level: `x.numericValue.eq(y.numericValue)` → `false` but
`y.numericValue.eq(x.numericValue)` → `true`, i.e. `ExactNumericValue.eq(BigNumericValue)`
compares at machine precision. `same()`'s number branch (`compare.ts:42-52`) delegates to
`av.eq(bv)` and inherits both the asymmetry and the false positive, so round-trip
*verification by isSame* can report success while the value silently changed.
This is the concrete cross-instance of SYMBOLIC_FINDINGS **P1-9** (isSame float-vs-exact
asymmetry) surfacing in the round-trip area — count it as additional evidence for P1-9, with
the extra twist that the lax direction returns a false *positive* on a corrupted value.
Fix direction: `same()`/`NumericValue.eq` must be exact and symmetric, leaving tolerance to
`isEqual`/`is`.

---

## P3 / notes

- **RT-P3-1.** `{num:'1.5d'}` (explicit bignum marker) → `.json` `1.5` (JSON float); the value
  survives but the bignum-ness does not (consistent with the `isInMachineRange` shorthand
  policy; becomes lossy only in the RT-P0-2 digit window). Executed.
- **RT-P3-2.** `toMathJson({metadata:['all']})` emits `latex` and `wikidata` but no
  `sourceOffsets` for a plain `ce.parse` result, although `'sourceOffsets'` is in the
  documented metadata set (`abstract-boxed-expression.ts:342`). Partially verified (may
  require a parse mode that records offsets; none found).
- **RT-P3-3.** `.toString()` (ASCIIMath) is documented display-only in
  NUMERIC-SERIALIZATION.md; nothing in docs suggests `parse(toString())` works, and it indeed
  does not (`"sqrt(3) / 2"` is not LaTeX). No action needed. Executed.
- **Note.** `docs/NUMERIC-SERIALIZATION.md` documents `toMathJson({fractionalDigits: n})` as
  "Exactly n digits after the decimal point"; verified `5 → "3.14159"`, `0 → "3"`, and
  negative n behaves as significant-digits (`-3 → "3.14"`), which is only documented in a code
  comment. Minor doc gap.

## Side observations (other reviewers' areas — cross-reference, do not double-count)

- `ce.parse('2^{100}').evaluate()` returns a **rounded** BigNumericValue
  (`{num:"1.2676506002282294015e+30"}`, 21 sig digits) instead of the exact 31-digit integer —
  evaluate-exactness contract, not serialization (round-trips faithfully as stored). Executed.
- Type-inference cross-talk: after `n` is used in `['Add','n',1]` (inferred `number`), a later
  `ce.box(['Factorial2','n'])` in the same engine produces an incompatible-type Error whose
  `.latex` is `\mathtip{\error…}` garbage that can't re-parse. Fresh engine: `n!!` round-trips
  fine. Relates to SYMBOLIC P1-15 (signature enforcement) / validation area. Executed.
- `\frac{d^2f}{dx^2}` (single-fraction second-derivative input form) parses to an
  `Error 'incompatible-type'` inside a Divide — same parser gap family as RT-P0-6. Executed.

## Existing tests asserting wrong expectations

- None found that lock in the P0 behaviors: no test asserts the float shorthand for large
  bigints (`numbers.test.ts:421` correctly expects `{num:'9007199254740993'}`), and the
  repeating-decimal LaTeX tests (`test/compute-engine/latex-syntax/numbers.test.ts:549-566`)
  only exercise a 6-digit repetend (`0.(142857)`), which happens to be long enough to evade
  RT-P0-5 — worth *adding* short-repetend cases (`0.(3)`, `0.12(3)`) rather than fixing
  existing ones.

## Verified working (summary)

- `.json` round-trip bit-for-bit at precision 21/50/300/default for: 40-digit literals,
  `π.N()`, `(2/3).N()`, `√2.N()`, `{num:1e-300|1.5e-320|2.5e500|1e-999999}` (idempotent too).
- ~40 reconstruction cases OK: NaN/±∞/ComplexInfinity, machine complex, `-√2`, `(3/5)√2`,
  machine & bigint rationals, repeating-decimal `{num}` inputs (incl. `0.\overline{142857}`),
  scientific notation, `d`/`n` suffixes, symbols, strings (incl. `'Add'`, `'123'`, embedded
  quote), `{fn}`/`{sym}`/`{str}` object forms, Hold, Nothing, List, Matrix (raw + evaluated
  tensor), Equal, LessEqual, Interval, Range, degrees, function literals, `D`, `Integrate`
  (incl. `Limits`), `Sum`, `Which`; non-canonical round-trips via `ce.box(json,{canonical:false})`
  for 6 forms incl. `Delimiter/Sequence`.
- ~50 LaTeX meaning round-trips OK: integrals (single/double/no bounds), first-order Leibniz,
  `f'(x)` prime forms, partial `∂f/∂x`, matrices, piecewise, sets, set-builder, `\binom`-free
  Binomial serialization, mixed numbers, `(n+1)!`, `(1/2)!`, `\operatorname`, invisible
  operators, `x^{-2}`, `2^{-1/3}`, subscripted/greek symbols, mod, gcd, floor, abs, logs,
  arctrig, tuples, booleans; `π` at precision 100 → LaTeX → parse loses only the documented
  rounding (1.79e-101).
- LaTeX idempotence: 20 assorted expressions stable by the second serialization round.
- `toMathJson` shorthands/full-object form reconstruct correctly; `fractionalDigits`
  5/0/'auto'/'max' behave as documented (except the repeating-decimal interactions above);
  metadata `latex` emission works.
