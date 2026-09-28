# A big-decimal imaginary part: one representation for complex numeric values

**Status:** Decided 2026-09-27. The user took the recommended option of every
decision in §7 (D2 to D6 as recommended; D1 as option (a) PLUS a public
`ce.number({ re, im })` overload that accepts big-decimal parts, additive and
breaking nothing, landing with Phase 2). Revised the same day after a dual
spec review (Claude and Codex, 18 findings, all folded in). Phase 1 started
2026-09-27. Every fact in §2 was read
from the code at commit `865085ef` (all paths under `src/compute-engine/`
unless stated).

## 1. The problem

Three defects that a user sees have one cause.

| Input (default precision, 21 digits) | Today | Correct |
| --- | --- | --- |
| `i\cdot10^{-800}` `.evaluate()` | `0` | `i·10^{-800}` (exact) |
| `(1+i)10^{-800}` `.evaluate()` | `1/1e+800` (imaginary part lost) | `(1+i)·10^{-800}` |
| `(1+i)10^{800}` `.N()` | `~oo` | `1e+800 + 1e+800i` |
| `(10^{-200}(1+i))^2` `.N()` | `0` | `2e-400i` |
| `\sqrt{i\cdot10^{-600}}` `.N()` | `0` | `(1+i)·10^{-300}/√2`, both parts `7.0710678118654752440e-301` |
| `e^{i\,10^{-800}}` `.N()` | `1` | `1 + 1e-800i` |
| `\sqrt2+\sqrt2 i` `.N()` | `1.4142135623730950488 + 1.4142135623730951i` | 21 digits on both parts |

The cause: every numeric value stores its imaginary part as a machine double
(`NumericValue.im: number`, `numeric-value/types.ts:94`), and the question "is
this value complex?" is answered by `im !== 0`. A double cannot hold `10^{-800}`
(it underflows to `0`) or `10^{800}` (it overflows to `Infinity`), and it holds
only 16 digits where the real part holds 21.

- `ExactNumericValue` stores the imaginary part EXACTLY as `imRational` times
  `√imRadical` (`exact-numeric-value.ts:121-122`). But it also caches the
  double in `im` (`:114-116`, written by `_normalizeIm()` at `:550-552`), and
  `isZero` (`:572`), `sgn` (`:589`), the real fast paths of `add`/`mul`
  (`:725`, `:842`), `root`/`ln`/`exp` (`:1144`, `:1385`, `:1397`) and `.N()`
  through `_toFloat()` (`:417`) all read the cached double. So `i·10^{-800}` IS
  stored exactly and reads as zero.
- `BigNumericValue` stores the real part as a `BigDecimal` (`decimal`,
  `big-numeric-value.ts:18`) and the imaginary part as the inherited double
  `im` (`:36`). Every complex branch of its arithmetic computes the imaginary
  part in doubles (`add` `:285`, `mul` `:341-443`, `div` `:454-503`, `inv`
  `:259`), or seeds a `BigDecimal` computation from the double
  (`const b = this.im` in `pow` `:611`, `root` `:672`, `sqrt` `:711`, `ln`
  `:792`, `exp` `:823`, `abs` `:761`) and calls `.toNumber()` at the end.
  `toString()` prints `${this.im}i` in plain `Number` format (`:132-146`).
- `MachineNumericValue` is doubles throughout, by design.

A fix tried on 2026-09-26 kept `im = ±Number.MIN_VALUE` as a "nonzero marker"
in the double. It leaked: the function kernels computed with the fake value
(`Ln(i·10^{-800}).N()` gave `-744.44 + 1.5708i`), `isSame` compared it, and
compiled code emitted it. It was reverted before commit; only the ROADMAP
records it. The lesson is that the double must never carry a value it cannot
represent: the truth has to live in a representation that can hold it, and the
double stays a projection of that truth.

Not in scope: the compiled targets. They represent a complex number as
`{re, im}` doubles by contract (`compilation/javascript-target.ts:664`,
`:845-852`), and the run-time never touches `NumericValue`. Only the
compile-time boundary (constant folding, `constant-folding.ts:127`, `:345-351`)
reads a boxed number's `.re`/`.im`; §5 says what happens there.

## 2. The design in one sentence

Every numeric value answers `isComplex` from a representation that can hold
its imaginary part (the exact Gaussian form, or a `BigDecimal`), and `im`
becomes a read-only double PROJECTION that callers use only when they are about
to compute in doubles.

### 2.1 `NumericValue` (abstract)

- New abstract getter `isComplex: boolean`. It replaces `im !== 0` as the
  test for "has an imaginary part".
- `im: number` stays a plain field on `ExactNumericValue` and
  `MachineNumericValue`, exactly as today. On `BigNumericValue` it is computed
  ONCE, in the constructor, from the big decimal (the class is immutable, so a
  field computed at construction has the same cost as today's field on every
  read; there is no per-read conversion). Its contract becomes: "the double
  nearest the true imaginary part: `0` on underflow, `±Infinity` on overflow;
  a projection for double arithmetic, never a test for complexness or
  finiteness".
- `bignumIm: BigDecimal | undefined` stays as the lossless read on every class
  that has one. On `ExactNumericValue` it is exact for an integer or a
  rational with a terminating expansion, and rounded to the working precision
  for other rationals and for radicals (`_bignumComponent`, `:338-392`); the
  design never uses it where exactness is required (§2.2 `eq`).
- `NumericValueData.im` widens from `number` to `number | BigDecimal`
  (`types.ts:52-55`), so a value with a big-decimal imaginary part can be
  constructed through the factory. The factory dispatch in `ce._numericValue()`
  (`index.ts:2235-2310`) compares `value.im !== 0` today; with a `BigDecimal`
  in `im` that comparison is always true, so the dispatch tests
  `isZeroLike(value.im)` (a helper that reads a number or a `BigDecimal`) and
  routes a zero big-decimal part to the real constructor.
- The exact-to-double projection of a rational uses an overflow-safe
  conversion. `rationalAsFloat` divides `Number(numerator)` by
  `Number(denominator)` and gives `NaN` for `(10^400 + 1)/10^400`, whose
  nearest double is `1`; the projection instead scales both parts by a common
  power of two (or converts through a `BigDecimal` at 20 digits) so that a
  finite rational always projects to a finite double or to `±Infinity`/`0`
  when it is out of range. This applies to `_normalizeIm()` and to the real
  part's projection alike.

### 2.2 `ExactNumericValue`

- `isComplex` is `!isZero(this.imRational)`, read from the exact field, not
  from the cached double.
- Every test inside the class that asks "is complex?" uses `isComplex`:
  `isZero`, `isOne`, `isNegativeOne`, `sgn`, `type`, the real fast paths of
  `add`/`mul`, the `root`/`ln`/`exp` dispatch, and `_liftComplex`
  (`:424-431`), which tests `Number.isSafeInteger(other.im)` today and must
  not lift an inexact `10^{-800}i` (projection `0`) to an exact zero: it lifts
  only when `other.bignumIm` is an integer. The "same radical" assertion in
  `normalize()` (`:502-506`) is gated on `isComplex` so it is no longer skipped
  when the double underflows.
- `eq` keeps its two rules and both parts follow the same one. Exact against
  exact compares the four exact fields (`:1464-1472`, unchanged, an
  equivalence relation). Exact against inexact compares the projections at the
  working precision, as the real part already does today (`:1483`), extended
  to the imaginary part through `bignumIm`; this is a comparison of an exact
  value with an approximation and is not transitive across precisions, which
  is today's behaviour for the real part and is not changed here.
  `.isSame()` on two exact values, the case CLAUDE.md's equivalence-relation
  rule covers, is unaffected.
- `_toFloat()` (`:417`) passes `{ re: this.bignumRe, im: this.bignumIm }` to
  the factory once `NumericValueData.im` is widened (Phase 2); in Phase 1 it
  keeps passing the double.

With the predicates alone (Phase 1 in §6), `i·10^{-800}` and `(1+i)10^{-800}`
evaluate correctly, because the exact route never loses the value; it only
misread it.

### 2.3 `BigNumericValue`

- New field `imDecimal: BigDecimal` beside `decimal`; the constructor accepts
  `im` as a number or a `BigDecimal` and stores a `BigDecimal` (a double is
  converted exactly; a `NaN` or infinite part keeps today's coherence rules,
  `:42-43`, read from the big decimal's own `isNaN()`/`isFinite()`).
- `isComplex` is `!this.imDecimal.isZero()`; `bignumIm` is `imDecimal`; `im`
  is `imDecimal.toNumber()` computed once in the constructor (§2.1).
- Every predicate that reads `this.im` today reads the big decimal instead:
  `isZero`, `isOne`, `isNegativeOne`, `sgn`, `lt`, `lte` (`:200-224`) gate on
  `isComplex`; `isPositiveInfinity`, `isNegativeInfinity` and
  `isComplexInfinity` (`:179-199`) test `imDecimal.isFinite()`, never
  `Number.isFinite(this.im)`, because `BigDecimal.toNumber()` returns
  `Infinity` for a FINITE value beyond the double range
  (`src/big-decimal/big-decimal.ts:1077-1103`, `Number('1e800')`), so a finite
  `10^{800}i` would read as complex infinity, `toString()` would print `~oo`
  (`:140`) and `mul` would short-circuit to an infinite product (`:404-412`).
  `eq` migrates all three of its branches (`:854-862`: the `number` operand,
  the non-finite case, the general case) to the big decimals, and
  `isZeroWithTolerance` (`:211`) too.
- Every complex branch computes both parts in `BigDecimal`, and every
  computational INPUT that reads `this.im`/`other.im` today (the recurring
  `const b = this.im` in `pow`, `root`, `sqrt`, `ln`, `exp`, `abs`, and the
  double arithmetic in `add`, `mul`, `div`, `inv`) reads
  `this.imDecimal`/`other.bignumIm ?? other.im` instead; dropping the
  `.toNumber()` at the end is necessary but not sufficient. The kernels
  `src/big-decimal/` already has for real numbers are enough (`atan2` accepts
  a `BigDecimal` `y`, `transcendentals.ts:83`; `cos`, `sin`, `exp`, `ln`,
  `sqrt`, `nthRoot`); no complex big-decimal type is needed:
  - `add`, `sub`: componentwise.
  - `mul`: the four products at the working precision.
  - `div`, `inv`: the textbook formula `a·conj(b)/|b|²` in `BigDecimal`. The
    scaled double division of 2026-09-27 (`numerics/numeric-complex.ts`) exists
    for the double's exponent range and has no meaning here; the big decimal
    cannot overflow.
  - `sqrt`: the CURRENT Cartesian algorithm (`:709-727`), which takes the
    larger component from `√((|z| + |a|)/2)` and the smaller from `b/(2·larger)`
    and so never cancels, kept with `BigDecimal` components. A polar form
    would lose a tiny component near the negative real axis: at 21 digits
    `atan2` rounds the angle of `-1 + 10^{-800}i` to π and the real part of
    the root comes out about `1.3e-21` instead of `5e-801`.
  - `pow`, `root`: polar form in `BigDecimal`, except in the small-component
    regime below.
  - `ln`, `exp`, `abs`: `BigDecimal` end to end (`exp` currently uses machine
    `Math.cos`/`Math.sin`, `:822-830`; `abs` is a double, `:762`).
- **Rounding noise versus a legitimate small component.** The current
  `pow`/`root` chop a component below `10^{-14}` times the modulus
  (`isComplexDust`) and `exp` chops its sine factor, and `ARCHITECTURE.md`
  requires this cleanup at the kernel boundary, because a polar computation
  at a multiple of π/2 leaves a component of size about `10^{-precision}`
  relative that is only rounding. Magnitude alone cannot tell that noise from
  `e^{i·10^{-800}} = 1 + i·10^{-800}`, whose imaginary part is smaller still.
  The rule is therefore split by regime, so that noise is never produced where
  a legitimate small component exists:
  - **Small-component regime.** When one part is below `10^{2−precision}`
    times the other in magnitude, the kernel uses the first-order expansion,
    which is exact to the working precision and involves no cancellation:
    `exp(a + ib) = e^a·(1 + ib)` for tiny `b`; `ln(a + ib) = ln a + i·b/a`;
    `(a + ib)^n = a^n·(1 + i·n·b/a)`; the Cartesian `sqrt` above already
    covers the root. No chop is applied in this regime.
  - **Normal regime.** The polar computation runs at the working precision
    and a component below `10^{2−precision}` times the modulus is chopped, the
    precision-relative form of today's `10^{-14}` (which was written for
    doubles). `ARCHITECTURE.md`'s kernel-cleanup invariant is reworded to name
    this rule.
  - Acceptance tests: `e^{i·10^{-800}}`, `\sqrt{-1 + i·10^{-800}}` (both signs
    of the imaginary part, the branch side), `(1 + i·10^{-30})^3`,
    `\ln(1 + i·10^{-30})`, and the mathematically-zero cases `e^{iπ}`,
    `(−1)^{1/2}` squared, `\sqrt{-4}` where the noise component must be `0`.
- `toString()` prints both parts at the working precision, in the same format
  the real-only branch uses (the 2026-09-27 rounding fix for the real part
  extends to the imaginary part).
- Trigonometric and special functions of a complex argument are NOT in this
  class; they reach machine `complex-esm` kernels through
  `boxed-expression/apply.ts:144`. They stay machine precision (§5, D4).

### 2.4 `MachineNumericValue`

Unchanged in representation: doubles are its nature. `isComplex` is
`im !== 0`. At `precision: 'machine'` the defects of §1 that need more than a
double stay (correctly rounded `0` for `i·10^{-800}` under `.N()`); the exact
route (§2.2) is right at every precision.

### 2.5 The boundaries that create or read a complex value

Each of these sites drops the big-decimal imaginary part today; each moves to
the lossless form.

| Site | Today | After |
| --- | --- | --- |
| `box.ts:592` (`Complex` operator with an inexact operand) | `const im = imOp.re` (double) | `imOp.bignumRe ?? imOp.re` |
| `canonicalMultiply`, coefficient beside `i` (`arithmetic-mul-div.ts:1975`) | `ce.number(ce.complex(0, nv.re))` | `ce._numericValue({ re: 0, im: nv.bignumRe ?? nv.re })` |
| `imaginaryNumber` (`canonical-utils.ts:122`) | `ce.complex(0, coefficient.re)` | same change |
| `fromNumericValue` (`box.ts:3744-3807`) | rebuilds through `ce.complex` (doubles) | boxes the numeric value as is |
| `ce._numericValue()` dispatch (`index.ts:2300`) | `value.im !== 0` | `!isZeroLike(value.im)` (§2.1) |
| `canonicalNumber` for a `Complex` (`boxed-number.ts:1657`) | `_numericValue({re, im})` doubles | unchanged (a `complex-esm` value IS doubles) |
| `BoxedNumber.hash` (`boxed-number.ts:317`) | `${re}:${im}` doubles | unchanged: a hash may collide, and the double string is independent of the working precision; hashing `bignumIm`, which is rounded to the working precision for a radical, would give two equal `√2i` literals different hashes when hashed at different precisions and break the documented `isSame ⇒ equal hash` invariant (`exact-numeric-value.ts:145-170`) |
| `BoxedNumber.is()` (`:1359-1409`) | `d.im` double, `bignumIm` only when non-finite | `bignumIm` whenever `isComplex` |
| `serialize.ts:982-1007` (MathJSON) | `Number.isFinite(value.im)`, then `ce.number(value.im)` | finiteness from `bignumIm`, then `ce.number(value.bignumIm ?? value.im)`; LaTeX follows, because the LaTeX serializer reads the `Complex` MathJSON node and the ordinary number printer, and `test/compute-engine/latex-syntax/numbers.test.ts` gains a round trip of `10^{-800}i` and `10^{800}i` |
| `library/logarithm.ts:17` and every other `Number.isFinite(x.im)` (grep `isFinite(.*\.im`) | finiteness from the projection | `bignumIm` finiteness |
| `ce.complex(a, b)` (`index.ts:2223`) | converts a `BigDecimal` argument with `.toNumber()` | see D1 |

## 3. The read-site migration

A grep of `\.im\b` under `src/compute-engine` finds 966 reads, 521 of them the
test `im ==/!= 0`; `javascript-target.ts` (139) and `numeric-complex.ts` (73)
are mostly reads on `complex-esm` or run-time `{re, im}` objects and are not
`NumericValue` reads.

| directory | `.im` reads | `im ==/!= 0` tests |
| --- | --- | --- |
| numeric-value/ | 241 | 138 |
| compilation/ | 244 | 94 |
| boxed-expression/ | 182 | 119 |
| library/ | 151 | 106 |
| numerics/ | 74 | 24 |
| other (symbolic/, rubi/, tensor/, index.ts) | 74 | — |

The surface: `isComplex` is added to `NumericValue` (§2.1) and to
`BoxedNumber` (delegating to its value); it is NOT added to the general
`BoxedExpression` interface, whose `im` returns `NaN` for a non-number. A
migrated site must therefore be number-narrowed (`isNumber(x) && x.isComplex`)
or keep its existing guard; a site that today reads `expr.im === 0` on an
unnarrowed expression keeps the `NaN`-for-non-number behaviour it relies on.

The rule for each `NumericValue`/`BoxedNumber` read site:

- A test of the form `x.im !== 0` / `x.im === 0` asks "is complex?" and
  becomes `x.isComplex` / `!x.isComplex`. This is mechanical and covers most
  of the 521 tests. It is safe to do by script with the typecheck as the
  guard: `isComplex` exists only on `NumericValue` and `BoxedNumber`, so a
  rewrite on a `complex-esm` value or a run-time object fails to compile and
  is reverted by hand.
- A test of finiteness (`Number.isFinite(x.im)`, `isNaN(x.im)`) or of
  integrality (`Number.isSafeInteger(x.im)`) reads `bignumIm` when the value
  has one; the typecheck does NOT catch these, so they are found by grep
  (`isFinite(.*\.im`, `isSafeInteger(.*\.im`, `isNaN(.*\.im`) and listed in
  the implementation's report.
- A read that feeds a double kernel (`apply.ts:144` `ce.complex(expr.re,
  expr.im)`; `complexPowN` at `arithmetic-power.ts:1118`) keeps `.im` where
  the kernel is double by nature, and takes the `BigDecimal` route where §2.3
  provides one (`Sqrt`, `Power`, `Ln`, `Exp`, `Root`, the arithmetic).
- A read that prints or serializes uses `bignumIm ?? im`.

## 4. What each defect needs

| Defect (§1) | Fixed by |
| --- | --- |
| `i·10^{-800}` `.evaluate()` is `0` | §2.2 (`isZero` on the exact field) |
| `(1+i)10^{-800}` loses its imaginary part | §2.2 + §2.5 (`fromNumericValue`, `canonicalMultiply`) |
| `(1+i)10^{800}` `.N()` is `~oo` | §2.2 `_toFloat` + §2.3 (`imDecimal`, and finiteness read from it) |
| `(10^{-200}(1+i))^2` `.N()` is `0` | §2.3 `mul` |
| `√(i·10^{-600})` `.N()` is `0` | §2.3 Cartesian `sqrt` on big decimals |
| `e^{i·10^{-800}}` `.N()` drops the part | §2.3 `exp`, small-component regime |
| 16 vs 21 digits in print | §2.3 `toString` |
| ROADMAP item 9 (`c·i` fold loses parity at precision 50) | §2.5 `canonicalMultiply` |

## 5. What stays double, on purpose

- **Machine-precision engines** (D4): every part is a double; the exact route
  is still right there.
- **Complex arguments of trigonometric and special functions** (`Sin(1+i)`,
  `Gamma(2+3i)`, `Zeta(s)`): the kernels are `complex-esm` doubles
  (`numerics/numeric-complex.ts`) and stay so; a value that underflows in the
  projection reaches them as real. This is the same limit as today, now
  documented at the bridge (`apply.ts`), and it is a separate capability item
  (big-decimal complex transcendental kernels).
- **Compile-time constant folding** reads `.re`/`.im` doubles because compiled
  code is doubles; a folded value whose imaginary part underflows is folded
  as `{re, im: 0}` (D2), which is what the compiled code would compute from
  the same doubles.

## 6. Phases and size

**Phase 1, the exact route (small, no representation change, no type
change).** `isComplex` on the three classes and on `BoxedNumber`, the §2.2
predicates including `_liftComplex`, the overflow-safe projection of §2.1, and
the script-assisted migration of the `im ==/!= 0` tests in `numeric-value/`,
`boxed-expression/` and `library/` (about 360 sites, most mechanical) plus the
grep-found finiteness and integrality tests. `_toFloat` keeps passing the
double in this phase. Fixes the first two rows of §1. Acceptance:
`numbers-outside-float64-range.test.ts` gains the two exact-route rows and a
pair test (`10^{-800}i` and `2·10^{-800}i` are not `isSame`, `isZero` is false
for both, `(1+i)10^{-800}` keeps both parts); the exactness suites
(`exact-gaussian*.test.ts`, `exact-imaginary-literal.test.ts`,
`exact-ordering-and-complex-parts.test.ts`, `sign-complex.test.ts`) pin the
unchanged behaviour. Blast radius expected at zero snapshots. Phase 1 ships
alone.

**Phase 2, the big-decimal part (medium).** `NumericValueData.im` widened,
`imDecimal` in `BigNumericValue` with the predicates, kernels and regimes of
§2.3, `_toFloat` passing `bignumIm`, `toString` at the working precision, the
`ce._numericValue` dispatch. Fixes the remaining rows. Acceptance: the §1
table under `.N()` at 21 and at 50 digits, the §2.3 regime tests, the
finiteness test for a finite `10^{800}i` (not complex infinity, prints its
digits, multiplies correctly), `eq` symmetry across the three classes, and no
measurable regression on the numeric benchmarks that loop over
`BigNumericValue` arithmetic. Blast radius: every pinned complex print at the
default precision changes its imaginary digits
(`complex-print-precision.test.ts:43-60`,
`exact-complex-radical-products.test.ts:115`, 34 lines of
`__snapshots__/arithmetic.test.ts.snap`, `numeric-mode.test.ts:94-95`); each
new string has more correct digits than the old one, so the updates are
expected and measured, not absorbed silently.

**Phase 3, the bridges (small).** The rest of §2.5 (`box.ts`,
`canonicalMultiply`, `imaginaryNumber`, `fromNumericValue`, `is()`,
`serialize`, the `isFinite(.im)` sites), `apply.ts` taking the `BigDecimal`
route for the operators that have one, `ce.complex` per D1, the LaTeX round
trip.

Phases 2 and 3 land together; each phase is a separate diff with the usual
worktree and dual review.

## 7. Decisions for the user

**D1. `ce.complex(a, b)` with `BigDecimal` arguments.** Today it converts them
with `.toNumber()` and returns a `complex-esm` `Complex`, which is doubles by
definition. Options: (a) keep `ce.complex` as the double constructor and
document it; the lossless public route is the MathJSON `Complex` node
(`ce.box(["Complex", {num: "1e-800"}, {num: "2"}])`) and LaTeX, which reach
§2.5's `box.ts` fix, and internal code uses `ce._numericValue({re, im})`;
(b) change `ce.complex` to return a boxed number with big-decimal parts, which
changes its return type on the public API. Recommendation: (a). Saying no
means a public-API change that every host reading `ce.complex(...)` as a
`Complex` must follow. **Decided: (a), plus a public `ce.number({ re, im })`
overload whose parts may be `BigDecimal` values (Phase 2).** (The public `ce.number()` does not accept the
`{re, im}` data form, `types-engine.ts`; option (a) does not need it to.)

Evidence for D1 (read 2026-09-27). `ce.complex()` has 63 internal call sites
in `src/compute-engine` (excluding `index.ts`), in two groups:

- **A carrier into `ce.number()`, about 33 sites** of the shape
  `ce.number(ce.complex(re, im))`: quadrature estimates (`calculus.ts:369`,
  `:2913`), tensor and eigenvalue results (`linear-algebra.ts:5136`, `:5554`,
  `:5632`), integrals and special values (`trigonometry.ts:1340`, `:1533`,
  `arithmetic.ts:2038`, `:3920`, `:4177`), the compiled-value bridge
  (`base-compiler.ts:28252`, `:28384`), and the six boundary sites of §2.5.
  None of them calls a method on the result; each only needs a `{re, im}`
  pair to reach `ce.number`. Their operands are doubles produced by double
  kernels, so the precision they expect IS double, except at the §2.5 sites,
  where big-decimal digits exist and are truncated. After the widening these
  sites use `ce._numericValue({re, im})` and the `Complex` object disappears
  from them.
- **A value for a `complex-esm` kernel, about 29 sites**: `apply.ts` (six
  bridges to the machine complex functions), the complex logarithm family in
  `arithmetic.ts` (`:4194-4357`, `.log()`, `.div()`), `gammaComplex`
  (`:3117`, `:3167`), `dedekindEta`/`eisensteinE` (`special-functions.ts`),
  `cosIntegral`/`coshIntegral` (`trigonometry.ts:1230`, `:1351`), the complex
  power (`arithmetic-power.ts:1126`, `:1804`), `Log` on a boxed number
  (`boxed-number.ts:838`), and the complex tensor field
  (`tensor-fields.ts`, seven sites, which does matrix arithmetic on `Complex`
  values). These need the full method surface (`log`, `pow`, `div`, `add`,
  the trigonometric functions) and pass the value into code that is double by
  nature; they expect machine precision and get it.

No existing class implements the surface the jsdoc declares. `NumericValue`
has `re`/`im`, `add`/`sub`/`mul`/`div`/`pow`/`sqrt`/`exp`/`ln`/`abs`/`neg`/
`inv`/`eq`/`isNaN`/`isZero`/`sgn`, but none of `cos`/`sin`/`tanh`/`acos`/
`asin`/`atan`/`cosh`/`sinh`/`acosh`/`asinh`/`atanh`, `mod`/`ceil`/`floor`/
`round`/`arg`/`conjugate`/`equals`/`sign`, and it is not a `complex-esm`
`Complex` for an `instanceof` test; the compiled run-time's `ComplexResult`
is a plain `{re, im}`. A big-decimal-backed replacement would therefore be a
new class with that 30-method surface, whose transcendental methods would
have to be either big-decimal complex kernels (the capability D4 defers) or
double fallbacks wrapping `complex-esm`, in which case group B computes
exactly what it computes today through one more layer. So changing the
return type costs a new class and an `instanceof` break for hosts, and gains
nothing that the widened carrier does not already give group A.

**D2. Constant folding of a value whose imaginary part underflows the double
range.** Options: (a) fold as `{re, im: 0}`, which is what compiled double
arithmetic gives; (b) decline to fold and let the run-time compute the same
zero. Recommendation: (a); (b) only trades a compile-time zero for a run-time
zero and costs a decline.

**D3. Printed digits.** The imaginary part of a `.N()` result prints at the
working precision, so `√2+√2i` prints 21 digits on both parts and about 40
pinned strings change. Recommendation: yes; the alternative keeps a documented
precision mix.

**D4. Machine precision and the double kernels stay double.** `Sin(1+i)`,
`Gamma(z)` and every complex transcendental keep machine precision at every
engine precision, as today, with the limit documented at the bridge.
Recommendation: yes; big-decimal complex transcendental kernels are a
separate capability item for the ROADMAP.

**D5. The dust rule.** The precision-relative chop of §2.3 replaces the fixed
`10^{-14}`, and the small-component regime replaces cancellation-prone
computations with their first-order expansions. Recommendation: yes; the
alternative (a chop that keeps every component) would print rounding noise
such as `e^{iπ} = -1 + 1.2e-21i`.

**D6. Phasing.** Ship Phase 1 alone first (it is the correctness fix for the
exact route, needs no type change and has no print churn), then Phases 2 and 3
together. Recommendation: yes.

If nothing is decided, the §1 rows stay wrong and the ROADMAP entries "The
imaginary part of an inexact number is a machine double" and item 2 of "What
the second review of the 2026-09-23 to 2026-09-26 commits left open" stay
open.
