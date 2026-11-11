# Structured representation: complex arithmetic

**Status: design for item 2 of "Next work, in order" of the
[JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md). Not
approved by the user. The recommended option of each open choice was taken on
2026-11-10 for the implementation; each can be reversed ("Open choices").**

At `5f5acea425bb8347bf401aa476b7fc23c0a94991` the full suite with
`CE_JS_PROFILE=numeric-kernel` counts these declines of the profile: 46 for a
product with a complex operand, 41 for `Power` of a complex base with a float
exponent, 18 for `Divide` with a complex operand, about 30 for `Sin`, `Cos`
and `Tan` of a complex operand that is not a name or in the `complex` mode.
The complex retry of an integrand (`integrand-complex`, `withComplexAtNaN()`
in `library/calculus.ts`) is admitted about 10 times in 135.

## The witnesses

Found by running test files under the switch with a Jest setup file that
wraps `_compile()` and writes each declined program (no source change). Each
is a compilation of the engine itself: a `corpus` witness.

| Consumer, mode | Programs (test file) |
| --- | --- |
| stochastic equality, `strict` | `soak_w1 + i·soak_w2`, `soak_w0 + i·soak_w1` (`fungrim-loops`, 20 attempts); `-a + cos(arccos(a))`, `-a + cos(-arccos(a))`, `a + sin(arcsin(a) + π)`, `-a + tan(arctan(a))` (`solve`, 28) |
| integrand, `strict` | `e^(i·x)`, `y·e^(i·x)` (`measurement`, `nintegrate-quadrature`), `e^(i·x²)` (`condition-nan-undecided`), `i / (t·(-ln t)^1.1)` (`integrate-singular-nonzero-bound`) |
| integrand, `complex` | `1/(t·(-ln t)^1.1)` and its variants with 1.001, 1.05, 1.2 and `1 - t` (`integrate-singular-nonzero-bound`, `quadrature-endpoint-singularity`); `-1/(t·ln t)`, `1/(t·ln(t)^2)`, `1/(x·(-ln x)^3)`; `sin(x)/x`, `sin(x)/x^1.5`, `sin(ln x)/x`, `sin(x)·cos(3x)/x`; `x^20·e^(-x)` to `x^170·e^(-x)` (`integrate-log-space-product`); `(e^(-y/2)·y^(k/2-1)) / (Γ(k/2)·2^(k/2))` (`tycho-row-422`); `sinh(x)/cosh(x)^2`; `NaN·t` |

In the `complex` mode a parameter with no declared type is complex on both
routes, so `t·ln t` there is a product of two complex values, and `1/(…)` a
real divided by a complex value.

## The forms, most frequent first

The code below is the existing compiler's, with `cse: false,
constantFold: false`, from the probes. Names: `x`, `y` real, `z`, `w`
complex. Each claim about a handler is from `javascript-target.ts`.

### 1. A product with a complex operand (46)

| Form | Existing code (`Multiply` handler) |
| --- | --- |
| complex literal × real, two operands | `i·x`: `({ re: 0, im: _.x })`; `-i·y`: `({ re: 0, im: -1 * _.y })`; `(1+2i)·y`: `const t = _.y; { re: t, im: 2 * t }` (`literalScale`: a part 0 writes `0`, a part 1 writes the operand) |
| real × complex, two operands | `const a = _.x; const b = _.z; { re: a * b.re, im: a * b.im }`; the complex operand first: `{ re: a.re * b, im: a.im * b }` |
| a rational factor | `-1/2·t` (`complex`): `const a = -0.5; … { re: a * b.re, im: a * b.im }`: the double of the rational, not the division by `q` that the real rule writes (`multiplyByRational()`) |
| three operands or more | a chain in the order of the operands: real while no complex factor was met, then `re = re * t; im = im * t` for a real factor and the complex product for a complex one. A complex literal is an ordinary factor there: `2i·x·y` is `let r = t1.re; let m = t1.im; r = r * x; m = m * x; …` |

**Operations.** No new operation kind for the arithmetic:

- `multiply` with a complex result gets the rule that `add` has: two
  operands, at least one complex, and a real operand is not converted. The
  value is `(a·b.re, a·b.im)` for a real `a`, and the product of the parts
  for two complex operands. Converting the real operand would change
  doubles: `(x + 0i)·z` has the real part `x·z.re - 0·z.im`, which is `NaN`
  for an infinite `z.im`.
- A product of three or more operands is a left fold of binary `multiply`
  operations in the order of the prepared operands; a run of real factors
  before the first complex one is one real `multiply`.
- New binary function name **`complex(re, im)`**: two real operands, a
  complex result. The two-operand product of a complex literal and a real
  `v` lowers to `complex(p, q)`, where each part is the literal `0` for a
  part 0, `v` for a part 1, and `multiply(k, v)` otherwise. Only for two
  operands: in a longer product the literal is a factor of the fold.
- A rational factor of a complex product lowers to its double, a real
  literal.

A probe compared the existing code with these decompositions on 0, -0, 1,
-2.5, ±∞, `NaN`, 1e300, -1e-300, 5e-324 for each real and each part: no
double differs for `x·z`, `x·y·z`, `w·x·z`, `i·x`, `-i·x`, `(1+2i)·x`,
`2i·x·y` and `x + i·y` (up to 49,000 inputs each). The fold must follow the
canonical order: `x·z·w` is boxed as `w·x·z`.

`x + i·y` is then `add(x, complex(0, y))`, which the emitter writes as the
existing emitter does: `const t = ({ re: 0, im: _.y }); ({ re: _.x + t.re,
im: t.im })`.

### 2. `Power` of a complex base (41, plus 9 with an integer exponent)

| Form | Existing code |
| --- | --- |
| an integer literal exponent 2 to 8 | a chain on the bound base: square `{ re: t.re * t.re - t.im * t.im, im: 2 * (t.re * t.im) }`, product with the base `{ re: a.re * t.re - a.im * t.im, im: a.re * t.im + a.im * t.re }`; `k` even is the square of `k/2`, `k` odd the product of `k-1` and the base |
| every other number literal exponent | `_SYS.cpow(_.z, 1.1)`, `_SYS.cpow(_.z, 20)` |
| a complex exponent, a real base and a complex exponent | `_SYS.cpow(_.z, _.w)`, `_SYS.cpow(_.x, _.z)` |

**Operations.**

- The chain is complex `multiply` operations: the square formula gives the
  doubles of the product of the base with itself, because `p + p` and
  `2·p` are the same double, also for an infinity and `NaN`. The probe found
  no difference for the exponents 2, 3, 6, 7 and 8. The route already
  admits 2 (`square`); 3 to 8 are the same branch of the handler.
- **`pow` on complex operands**: the function `pow` gets a complex result
  for complex operands. Its definition is the continuation of the real one:
  `_SYS.cpow` (`javascript-runtime.ts`) gives `0` for `0^w` with `Re w > 0`,
  the pole for a negative real `w`, `NaN` otherwise, the real root of
  `negativeBaseRealPow()` when both imaginary parts are zero (the convention
  of the real `pow`), and the principal value otherwise. The real exponent
  `1.1` is converted (`real-to-complex`): `cpow` reads a number `w` as
  `w + 0i`, and the probe found no difference for `z^1.1`, `z^20` and `x^z`.
- Admitted: a complex base with a number literal exponent. Declined: an
  exponent that is not a number literal (no witness), and every complex
  exponent of `ExponentialE` that reads `Pi` (below).

### 3. A function of a complex operand that is not a name (about 30)

The handlers of `Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Arctan`,
`Arsinh`, `Arcsin`, `Arccos`, `Sign`, `Ln` and `Gamma` (one operand) test
`isComplexValued()` of the operand first and then write the helper of its
value, with no other form: `Sin(Ln(z))` is `_SYS.csin(_SYS.cln(_.z))`,
`Cos(z + 1)` is `_SYS.ccos(({ re: (_.z).re + 1, im: (_.z).im }))`,
`-a + cos(arccos(a))` with `a: real` is `const t =
_SYS.ccos(_SYS.cacos(({ re: _.a, im: 0 }))); ({ re: -_.a + t.re, im: t.im })`.
The test of `Pi` (`piMultiple()`) comes after, so `sin(arcsin(a) + π)` is
`_SYS.csin(…)` of the complex sum. Three handlers have another form:

- `Sinh`, `Cosh`, `Tanh`: `_SYS.csinhipi(u)` and the others for `i·π·u`
  (`imaginaryPiMultiple()`, `compile-real-analysis.ts`).
- `Exp` (`Power(ExponentialE, e)`): `_SYS.cexppi(u, a)` for `a + iπu`
  (`eulerPiSplit()`); otherwise `_SYS.cexp(e)`: `e^(i·x)` is
  `_SYS.cexp(({ re: 0, im: x }))`.
- `Abs`: `Math.hypot(re, im)` of the parts that `tryGetJSComplexParts()`
  reads (a literal, `ImaginaryUnit`, a product with an imaginary factor, a
  sum of such parts, their square and cube): `|x + i|` is
  `Math.hypot(_.x, 1)`.

**Rule.** The existing `unary` functions, no new name: any complex operand
for the heads of the first list; for `Sinh`, `Cosh`, `Tanh` and `Exp`, a
complex operand that does not read `Pi` (wider than the two predicates);
`Abs` unchanged (a name only). `Conjugate` of a complex operand,
`_SYS.cconj(z)`, gets the new unary name **`conjugate`** with the rule of
`exp` (2 witnesses, `map-auto-compile`).

### 4. `Divide` with a complex operand (18)

| Form | Existing code (`Divide` handler) |
| --- | --- |
| complex ÷ real | `const a = _.z; const b = _.x; { re: a.re / b, im: a.im / b }`; a literal dividend is bound the same way: `i / x` is `{ re: 0 / x, im: 1 / x }` in value |
| real ÷ complex | `const d = b.re * b.re + b.im * b.im; const nr = a * b.re; const ni = -a * b.im;` then `(d < 2.2250738585072014e-308 \|\| d === Infinity \|\| nr - nr !== 0 \|\| ni - ni !== 0 \|\| (nr !== 0 && Math.abs(nr) < 2.2250738585072014e-308) \|\| (ni !== 0 && …) \|\| !_SYS.cprodok(a, b.re) \|\| !_SYS.cprodok(a, b.im) ? _SYS.cdivedge(a, 0, b.re, b.im) : { re: nr / d, im: ni / d })` |
| complex ÷ complex | the same, with `nr = a.re * b.re + a.im * b.im`, `ni = a.im * b.re - a.re * b.im`, four `cprodok` tests of the parts, and `_SYS.cdivedge(a.re, a.im, b.re, b.im)` |

The guard is the test of `complexQuotient()` in
`numerics/numeric-complex.ts` (`textbookQuotientIsAccurate()`), and
`_SYS.cdivedge` (`javascript-runtime.ts`) gives the interpreter's values
where the formula fails: `NaN` for a `NaN` part, the pole for a zero divisor
and a dividend that is not zero, `0` for an infinite divisor and a finite
dividend, otherwise the scaled quotient.

**Operation.** `divide` with a complex result, with the rule of `add`: two
operands, at least one complex, a real operand not converted. Its
definition: for a real divisor, the quotient of each part by the divisor;
for a complex divisor, the quotient of the interpreter (`complexQuotient()`),
with the real dividend `a` read as the parts `a` and `0` of the guard, and
with the products `a·b.re` and `-a·b.im` (converting `a` would add the terms
`0·b.im` and `0·b.re`, `NaN` for an infinite part). The JavaScript emitter
writes the same guarded text as one operation: three `const` statements
before it, and the conditional as the value, bound to a `const`. It is
`pure`; both operands are bound to names, because the text reads each part
several times.

## The `complex` mode

`_SYS.cplx(x)` (`javascript-runtime.ts`) returns a number `x` as
`{ re: x, im: 0 }` and any other value as it is. The existing emitter writes
it in two places (`compile-lanes.ts`, `compile-inner.ts`):

- `liftWideReference()`: a read of a symbol that is complex only because
  its type is wide. The route does the same already: a lifted input is
  converted at each read (`IRInput.lifted`).
- `liftWideResult()`: a function node of a wide numeric type that the
  compiler reads as complex, unless its head is in
  `COMPLEX_PROPAGATING_HEADS`, `Sqrt`, `Ln`, `Log` or `Power`. So `sin(t)`
  is `_SYS.cplx(_SYS.csin(_SYS.cplx(t)))`, and `Cot(x)` with `x: real` is
  `_SYS.cplx(_SYS.cot(_.x))`.

Every complex helper returns an object (`kernelResult()`), so the wrapper
of a helper is the identity. **Rule:** a node that the route lowers to a
complex helper of a complex operand has no operation for the wrapper (the
values are the same). A node whose real call the existing emitter wraps
(`Cot(x)`, `Csc(x)` of a real `x` in the `complex` mode) stays declined: the
wrapper is a `real-to-complex` conversion of the real result there, and no
witness of the measure has it. In the 45 integral test files that were run,
14 attempts of the complex retry name the wrapper as their first refusal
(`sin(x)/x`, `sin(x)·cos(3x)/x`, `sinh(x)/cosh(x)^2`, …). With every
decline of the wrapper kept, these 14 stay declined whatever the other
slices admit; with the rule, they compile when their other forms do, and 0
declines of the measure remain on the wrapper.

## What stays declined

| Form | Example | Reason |
| --- | --- | --- |
| an operand of `Sinh`, `Cosh`, `Tanh` or a complex exponent of `e` that reads `Pi` | `sinh(i·π·x)`: `_SYS.csinhipi(_.x)`; `e^(x + iπy)`: `_SYS.cexppi(_.y, _.x)` | other helpers; no witness |
| `Abs` of a complex operand that is not a name | `\|x + i\|`: `Math.hypot(_.x, 1)` | the parts are read without an object; 1 witness |
| `Power` of a complex value with an exponent that is not a number literal | `z^k`, `z^w`, `x^z` | no witness |
| a real call wrapped in the `complex` mode | `Cot(x) + 1`: `_SYS.cplx(_SYS.cot(_.x))` | no witness (above) |
| a real-only head of a complex operand | `sin(x - Round(x))` in the `complex` mode | the existing code tests the value at run time (`_SYS.cisreal`) |
| `Real`, `Imaginary`, `Argument` | `(_.z).re`, `_SYS.carg(_.z)` | no witness; they would be the unary names `re`, `im`, `arg` |
| a comparison with a complex operand | `Equal(z, w)` | unchanged |

## Each part

| Part | Change |
| --- | --- |
| Core (`structured-ir.ts`) | The comments of `multiply` and `divide`; `complex` in `BinaryFunctionName`, `conjugate` in `UnaryFunctionName`; `pow` defined on complex operands. All `pure`. |
| Verifier (`structured-verify.ts`) | A complex `multiply` has two operands, at least one complex; a `divide` is complex exactly when an operand is; `complex` has two real or integer operands and a complex result; `pow` has a complex result exactly when its operands are complex, and both then have the complex representation; `conjugate` as `exp`. |
| JavaScript policy | `multiply` and `divide`: results `number`, `complex`, operands `number`, `complex`; `complex`: result `complex`, operands `number`; `pow`: `same`; `conjugate`: `complex`. |
| Admission (`javascript-fragment-target.ts`) | `multiplyRule`, `divideRule`, the complex branch of `structuredScalarFunctionRule()` and `structuredFunctionRule()`, `constantPowerForm()` for a complex base, the `complex`-mode refusals of the wrapper. The real operand of a mixed product keeps its fact. |
| Lowering | The fold, the literal scale, the rational double, the chain of the integer powers, the conversions of the operands of a complex `pow`. |
| Emitter | The texts of the tables above; `usesOf()` counts two reads for each operand of a mixed product and the reads of the guarded quotient; runtime names `cpow`, `cprodok`, `cdivedge`, `cconj`. |

**The three objectives.** No target in the core: `complex(re, im)`, the
mixed product and quotient and the complex `pow` are defined on complex
numbers and the interpreter's conventions; a GLSL policy would write
`vec2(a, b)`, `x * z` and helpers for the quotient and the power. One
definition per value: each operation defines one value; the fold and the
chain add values defined once; the three names of the guarded quotient are
the emission of one operation, not values of the program. Effects: every new
case is `pure` and reads no capture.

## Order of implementation

1. **Products and quotients**: `multiply` and `divide` with a complex
   result, `complex(re, im)`, the fold, the rational double. Admits the 20
   Fungrim sums of stochastic equality and the `complex`-mode divisions
   whose other forms are already in the route (`-1/(t·ln t)`,
   `1/(t·ln(t)^2)`).
2. **Functions**: any complex operand of the heads of form 3, the identity
   rule of the wrapper, `conjugate`. Admits `e^(i·x)`, `y·e^(i·x)`, the
   inverse-trigonometric probes of stochastic equality, `sin(x)/x` and
   `sin(ln x)/x` in the `complex` mode.
3. **Powers**: the chain for 3 to 8, `pow` on complex operands. Admits
   `1/(t·(-ln t)^1.1)` and its variants, `1/(x·(-ln x)^3)` and
   `x^20·e^(-x)`.

Each slice is committed and measured on its own: the full suite with the
switch on and off, `node scripts/js-profile-stats.mjs`, and the two numbers
of the plan. Tests of each slice:

- Differential against the existing compiler (`cse: false,
  constantFold: false`, `Object.is` on both parts) and the interpreter, both
  modes; a real input in 0, -0, 1, -2.5, ±∞, `NaN`, 1e300, -1e-300,
  5e-324, a complex input with parts from that set, purely real `{x, 0}` and
  purely imaginary `{0, y}`; in the `complex` mode each lifted input as a
  number and as `{re, im}`.
- Slice 1: the orders real-first, complex-first and a complex literal in a
  product of three; `1/3`, `-1/2` and `NaN` factors. For the quotient both
  branches of the guard: a zero divisor `{0, 0}` and `{-0, 0}`, an infinite
  part, a divisor whose modulus underflows (`1e-160` parts), a numerator
  that overflows (`(1e308 + 1e308i)/(1 + i)`), a product that underflows to
  a subnormal.
- Slice 3: each exponent 2 to 8; 20, -2, 1.1, 0.5; a zero base.
- The verifier refuses each malformed form with its own test: a complex
  `multiply` of three operands, `complex` of a complex operand, a `pow` with
  one complex operand, a complex `divide` with no complex operand.

## Open choices

1. **Mixed product and quotient.** Recommended: `multiply` and `divide`
   with a real operand that is not converted, as `add`. Alternative: unary
   names `re` and `im` and the binary `complex`, and the mixed product
   written as `complex(x·re(z), x·im(z))`: no change of `multiply`, three
   operations per product, and `Real` and `Imaginary` would come with them.
2. **The literal scale.** Recommended: the lowering writes `complex(p, q)`.
   Alternative: the emitter writes the parts of a complex literal operand,
   as it does for `add`; the value of `multiply` would then depend on the
   emitter.
3. **The guarded quotient.** Recommended: one `divide` operation that the
   emitter writes as the existing guarded text. Alternatives: the guard
   spelled out in operations (parts, comparisons, an `or` with regions, a
   call of `cdivedge`), or a decline of a complex divisor, which leaves most
   of the 18 `Divide` declines and every `complex`-mode quotient.
4. **The real exponent of a complex `pow`.** Recommended: converted, the
   rule `same`. Alternative: a real operand unconverted, which gives the
   existing text `_SYS.cpow(z, 1.1)`; the values are the same.
5. **The wrapper of the `complex` mode.** Recommended: no operation for a
   complex helper, the decline kept for a wrapped real call. Alternative:
   keep every decline of the `complex` mode (14 or more stay).
6. **`Conjugate`.** Recommended: in slice 2 (2 witnesses). Alternative:
   leave it declined.

## Not determined

- The counts per consumer after each slice: they need the implementation.
  Which programs need which slice is read from the programs above.
- The 10 complex retries that the profile admits today: the runs did not
  record one.
- Whether the facts of the route give the lane of `isComplexValued()` for
  every compound complex operand: the differential tests must show it.

## Result (2026-11-10, base `4422cd7bf`)

The three slices are implemented in the order above, with the recommended
option of each open choice. The tests are
`test/compute-engine/compile-javascript-structured-complex.test.ts` (172
tests) and the verifier tests of `compile-javascript-structured-ir.test.ts`.
Each program is compared with the existing compiler (`cse: false,
constantFold: false`, `Object.is` on both parts) on every input of its grid,
in both modes, and with the interpreter on the inputs that the interpreter
holds. No double differs from the existing compiler on any input; a
mutation of the mixed product (`+ 0` on the real part) is detected.

**Slice 1.** Admitted: `multiply` with a complex result of two operands, a
real operand not converted; the fold of three or more factors; the literal
scale as `complex(p, q)`; the rational factor as its double; a complex
`divide`, written as the guarded text. Every claim of "a probe found no
difference" in "1." and "4." holds on the grids of the test (`x·z`, `w·x`,
`z·w`, `x·y·z`, `w·x·z`, `w·x·y`, `2i·x·y`, `x·y·z·w`, `i·x`, `-i·x`,
`(1+2i)·x`, `i·k`, `1/3·z`, `-1/2·z`, `NaN·z`, `x + i·y`, `z/x`, `x/z`, `z/w`,
`i/x`, and the two branches of the guard: a zero divisor `{0, 0}`, `{-0, 0}`,
`{0, -0}`, an infinite part, `1e-160` parts, `(1e308 + 1e308i)/(1 + i)`).

**Slice 2.** Admitted: any complex operand, in both modes, for `Sin`,
`Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Arctan`, `Arsinh`, `Arcsin`, `Arccos`,
`Sign`, `Gamma` (and `Ln`, already admitted); a complex operand that does not
read `Pi` for `Sinh`, `Cosh`, `Tanh` and the exponent of `Exp`; `Conjugate`
of a complex operand (`conjugate`). The `complex` mode writes the helper
with no `_SYS.cplx()`.

**Slice 3.** Admitted: a complex base with an integer exponent 3 to 8
(the chain, `complex-chain`), and with every other number literal exponent
(`pow` of complex operands, the exponent converted, `complex-pow`). The
exponents 2 to 8, 20, -2, 1.1, 0.5 and 5/2 are tested, with the zero base
in the grid.

**Where the implementation differs from the note.**

- `Arcosh` and `Artanh` are not in the list of the note, though their
  handlers test the operand first as `Arcsin` does: they keep the rule of a
  complex name in the `strict` mode (no witness). Changing it is one entry
  of `SCALAR_FUNCTION_HEADS`.
- `Conjugate` admits every complex operand, not only one that does not read
  `Pi`: its handler has no other form.
- `Sin` and `Cos` of a complex operand that reads as a multiple of `Pi`
  (`readsAsPiMultiple()`: `Sin(π·z)`) still decline: the rule of the route
  tests the multiple of `Pi` before the complex operand. The existing
  handler writes `_SYS.csin` there; the decline is wider, not another value.
- The JavaScript policy refuses `complex` of a complex operand and `pow` of
  one complex operand by the representation of the operand before the rule
  of the core reads the types; the verifier tests check both, the rule of
  the core with a policy that admits both representations.
- The square of the chain is written as a product of the value with
  itself, `t.re * t.im + t.im * t.re`, where the existing emitter writes
  `2 * (t.re * t.im)`: the same double on every input of the grid.
- The emission of a mixed product writes the input reads of a real run
  inside the bound product (`const t = _.x * _.y`) after the read of a
  complex operand: the order of pure reads is unspecified by the emitter's
  rules, and the values are the same.

**Differences between the existing compiler and the interpreter** that the
route keeps (it gives the doubles of the existing compiler; `KNOWN` in the
test file lists them by class):

- An infinite real factor of a zero part: `x·z` at `x = ∞`, `z = 1` is
  `{∞, NaN}`, the interpreter `∞`; with doubles that overflow,
  `x·y·z` at `x = y = 1e300`, `z = -2.5i` is `{NaN, -∞}`, the interpreter
  `-∞i`.
- `-1/(t·ln t)`, `1/(t·ln(t)^2)` and `sin(ln t)/t` (`complex` mode) at
  `t = ±∞`: `NaN`, the interpreter `0`.
- `ln(t)^1.6` (`complex` mode) at `t = 0`: `NaN` (`_SYS.cpow` of `{-∞, 0}`),
  the interpreter `∞`.
- In the `strict` mode, `i/(t·(-ln t)^1.1)` at `t = -2.5`: `NaN` (the real
  `ln` of a negative number), the interpreter a complex value.
- Inputs of magnitude 1e300 or 1e-300, where the precision of the target
  decides (`sin(1e300 + 1)`, `1 - 1e-300`).

The interpreter cannot hold a complex input with an infinite, a `NaN` or a
`-0` part, and reads `5e-324` as the decimal: those inputs are compared with
the existing compiler only.

**What stays declined** is the table "What stays declined" above, and:
`Arcosh`, `Artanh` of a complex operand that is not a name (or in the
`complex` mode); `Sin`, `Cos` of a complex multiple of `Pi`; a complex
literal exponent (`z^(2i)`).

**Counts.** The 13 consumer test files of the task (`fungrim-loops`,
`solve`, `equal`, `identically-equal`, `measurement`,
`nintegrate-quadrature`, `integrate-singular-nonzero-bound`,
`quadrature-endpoint-singularity`, `integrate-log-space-product`,
`condition-nan-undecided`, `tycho-row-422-nan-integrand-integral`,
`map-auto-compile`, `map-auto-compile-named-function`), with
`CE_JS_PROFILE=numeric-kernel`, admitted of attempts per consumer:

| Consumer | Attempts | Before | Slice 1 | Slice 2 | Slice 3 |
| --- | --- | --- | --- | --- | --- |
| `integrand` | 282 | 173 | 176 | 186 | 186 |
| `stochastic-equal` | 220 | 172 | 192 | 220 | 220 |
| `integrand-complex` | 90 | 0 | 10 | 32 | 83 |
| `map` | 64 | 38 | 38 | 40 | 40 |
| `integrand-log` | 13 | 10 | 10 | 10 | 10 |
| `multiple-integral` | 13 | 9 | 9 | 10 | 10 |
| total | 682 | 402 | 435 | 498 | 549 |

The seven declines of the complex retry that remain: an exponent that is
not a number literal (3), a helper with no ground signature (2), `Round` of
a complex operand (1), `Power` of the number literal 2 (1). The full suite
with the switch was not run for this change.
