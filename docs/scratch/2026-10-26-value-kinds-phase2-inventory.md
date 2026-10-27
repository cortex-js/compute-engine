# Value kinds, phase 2: the inventory

Session `compute-engine-df`, 2026-10-26. Plan:
`docs/plans/2026-10-26-value-kinds.md`, section 8 ("The phase-2 inventory").
ROADMAP CE-507 (value kinds) and CE-508 (`Quantity` and `Measurement`
defects).

## How this document was produced

- The tables in the appendix are the output of
  `npx tsx scripts/probe-value-kinds-inventory.ts`, run on commit
  `140ad66f5b5734556ce10f5f6c0d9408168850df`. Phase 1 is commit
  `0be912cef`; the one commit after it changes only the GPU compile targets
  and their tests, so no probed code differs from the phase-1 commit.
- The script only reads the source and evaluates expressions in fresh
  engines (one per operator and probe). It runs in about 15 seconds.
  `--part N` prints one part.
- The appendix is the script output with every heading moved one level
  down. To check that it is current, run the script and compare (the
  command is at the top of the appendix).
- The sections before the appendix are written by hand from the tables:
  the counts, the defects found, the corrections to the plan, the decisions
  needed, the operators that must name `quantity`, and the sites that
  phase 2 removes.

The "planned" columns apply plan sections 4.2 to 4.7. Two sources decide
them:

1. The rules of the plan, applied by the script: group 1 (the `add`,
   `multiply`, `negate`, `divide`, `power` hooks), the comparisons
   (`compare`), the lazy operators and the operators without a handler,
   the `Floor` family, `Factorial` as `Gamma(a + 1)`, the Lipschitz
   operators (`Real`, `Imaginary`, `Conjugate`, `Abs`), the statistics
   over a collection, and first-order propagation
   `σ_f = |f′(a)|·σ` through `unaryDerivativeFormula()`
   (`symbolic/derivative.ts`), computed at the nominal.
2. The phase-1 machinery itself, through the test kind `UserMeasurement`
   (`admittedAs: 'number'`, `test/compute-engine/value-kinds-helpers.ts`):
   for each operator, the same call with a `UserMeasurement` operand says
   whether phase 2 admits a measurement at boxing, and whether the call is
   an apply site. A call that is admitted and is not an apply site runs the
   operator's own handler, as today.

## Counts

| Item | Count |
| --- | --- |
| Lines that the pattern of plan section 8 finds in `src/compute-engine/` (plus `measurementType`, which the pattern misses) | 637 in 38 files |
| Code lines / code sites (a site is the enclosing function or definition) | 379 / 193 |
| Comment lines / comment sites | 258 / 139 |
| Code sites that phase 2 removes or replaces by a hook | 142 sites, 289 lines, in 19 files |
| Code sites that stay (constructors, LaTeX, serialization, unit operators, constants) | 51 |
| Library operators in `OPERATORS.json` / with a function signature | 657 / 654 |
| Operators with a parameter that admits `real` (or a collection of reals) / probed | 220 / 215 |
| Probed operators with a planned answer that the plan decides | 101 |
| Probed operators that need a decision (real measurement) | 38 (24 admission gaps, 7 zero slope, 4 non-real value, 2 element extrema, 1 unit slope) |
| Probed operators that compute a value today and that `apply` would leave unevaluated | 21 |
| Probed operators that stay unevaluated (or answer an error) today and after | 55 |
| Complex measurement: operators where the uncertainty rule needs a decision | 45 (plus 1 domain edge) |
| Complex measurement admitted at boxing today at a real-only parameter (an `incompatible-type` at evaluation after phase 2, decision D) | 18 |
| Refusals: parameters that admit a measurement today and refuse it after phase 2 | 108 parameters of 86 operators |
| Quantity `2 m` admitted at boxing today (typed `value`) | at 197 of the 215 probed operators |
| `test/compute-engine/*.test.ts` files that name `Measurement` or `Quantity` / all `.test.ts` files under `test/` | 36 / 43 |
| `.snap` files in the repository / those that name a head | 4 / 0 (the snapshots are inline) |
| In those test files: inline snapshots / type reads / `.re` and `.im` reads | 369 / 147 / 544 |

## Defects found today (wrong values)

Each one is reproducible from the appendix. None is fixed by this
inventory; each one is either fixed by phase 2 as planned or listed under
"Decisions needed".

1. **An undecided comparison drops the uncertainty.**
   `Less(Measurement(2, 0.1), x)` evaluates to `Less(2, x)`,
   `Equal(Measurement(2, 0.1), x)` to `Equal(2, x)`, and
   `Less(Measurement(2, 0.1), Quantity(2, m))` to `Less(2, 2 m)`.
   `evaluateChainOperands()` (`library/relational-operator.ts`) replaces a
   measurement by its nominal before it decides, and the unevaluated
   result keeps the nominal. Phase 2 fixes it (the comparison dispatch of
   plan 4.4 keeps the operands).
2. **A complex measurement reaches a real-only kernel.**
   `ContinuedFraction(Measurement(Complex(2, 3), 0.1))` is `[2]`: the
   measurement is typed `complex` today, which a `real` parameter does not
   refuse for a non-literal, and the kernel reads `.re` (the nominal
   projection of `BoxedFunction._measurementNominal`). The 18 operators in
   the last row of table 2f admit it at boxing today. Phase 2 fixes it
   (decision D: `incompatible-type` at evaluation).
3. **A unit leaks out as a free symbol.**
   `InverseHaversine(Quantity(2, m))` evaluates to
   `2arcsin(sqrt(2) sqrt(m))`: the canonical form splits the quantity and
   `m` becomes a symbol. Phase 2 refuses a quantity at `InverseHaversine`
   at boxing unless the operator names `quantity` (decision 15).
4. **The order of two quantities depends on the units.** Two quantities
   whose difference is below the engine tolerance:
   `Equal(Quantity(1, m), Quantity(1.000000000001, m))` is `True`, but
   `Equal(Quantity(1, m), Quantity(100.0000000001, cm))` is `False` and the
   `Less` of that pair is `True`. Phase 2 fixes it (one `compare` after
   conversion, with the engine tolerance).
5. **The comparison methods do not decide a measurement.**
   `Measurement(2, 0.1).isLess(3)` and `.isEqual(2)` answer `undefined`,
   while `Less(Measurement(2, 0.1), 3)` and `Equal(Measurement(2, 0.1), 2)`
   are `True`. Phase 2 fixes it (one dispatch for the operators and the
   methods).
6. **The uncertainty of a complex nominal depends on how the derivative
   prints.** `Cos(Measurement(Complex(2, 3), 0.1))` keeps an uncertainty
   (`cos(2 + 3i) ± 1.006`), `Arctan(Measurement(Complex(2, 3), 0.1))` drops
   it (`arctan(2 + 3i)`): `measurementUnaryByHead()` drops the uncertainty
   when the derivative evaluates to a complex number literal, and keeps it
   when the derivative stays symbolic. Decision 6.

Two results today are not wrong values but are not answers either:
`Binomial(Measurement(2.5, 0.1), 3)` evaluates to the unevaluated product
`(M·(M − 1)·(M − 2))/6`, and `HurwitzZeta(Measurement(2.5, 0.1), 3)` to a
sum that holds `Zeta(M)` beside a measurement. If such a product were
evaluated through the measurement hooks, the result would be wrong: the
three factors would be treated as independent, although they are one
measurement (decision 7).

## Corrections to the plan

- Plan section 3, row `Floor(Measurement(2.5, 0.1))`: today is `2` (a bare
  integer, typed `integer`), not `Measurement(2, 0.1)`. The expected
  column "the same, typed `measurement`" therefore is not "the same";
  decision 1.
- Plan section 3, row `Floor(Measurement(2 + 3i, 0.1))`: today the call is
  valid at boxing (typed `integer | nan | signed_infinity`) and stays
  unevaluated; it is not an `incompatible-type` error at boxing. The
  planned answer (`incompatible-type` at evaluation, decision D) does not
  change.
- Plan section 4.7 names `Convert`. No operator has that name; the unit
  operators are `UnitConvert`, `UnitSimplify`, `QuantityMagnitude`,
  `QuantityUnit`, `IsCompatibleUnit` and `UnitDimension`. All six have
  `value` parameters, so they admit a quantity through group 2 with no
  change.
- Plan section 8 pattern: the measurement type handler
  (`measurementType()` in `library/type-handlers.ts`, imported as
  `measurementTypeOnTypes` in `library/arithmetic.ts`) does not match the
  pattern. The script adds it.
- Plan section 6 says every measurement hook returns a measurement
  (`Cos(0 ± 0.1)` is `1 ± 0`). The `Measurement` constructor collapses a
  zero uncertainty to the bare value (decision of 2026-07-07), so
  `Measurement(1, 0)` cannot exist as a canonical expression; decision 3.

## Decisions needed

Each decision states the situation, an example (input, today, under each
option), the options with their consequences, and a proposal. "If nothing is
decided" says what the implementation would do by default.

### 1. The uncertainty of a step function (slope 0)

Operators: `Floor`, `Ceil`, `Round`, `Truncate`, `Sign`, `Heaviside`,
`PrimePi` (and `Arg`/`Argument` of a positive real, which is the constant
0).

- Today: the bare value. `Floor(2.5 ± 0.1)` is `2`, `Sign(5 ± 0.1)` is `1`,
  `Round(2.5 ± 0.1)` is `3`. `Sign(0 ± 0.1)` stays unevaluated.
- (a) Keep the bare value. The static type `measurement` is then wrong for
  these results, so the measurement kind must declare `resultType`
  (`integer | measurement`).
- (b) Keep the uncertainty: `Floor(2.5 ± 0.1)` is `Measurement(2, 0.1)`.
  This is the expected row of plan section 3. It is not first-order
  propagation (the slope is 0), and an uncertainty of 0.1 on an integer has
  no clear meaning.
- (c) First order: `Measurement(2, 0)`, which is `2` when the zero-error
  collapse stays (decision 3, option a). This is the same rule as every
  other `apply` answer.
- Sub-question for (a) and (c): a jump inside the error bar.
  `Floor(2.95 ± 0.1)` is `2` by first order, although the true value can be
  2 or 3. Option: leave the call unevaluated when a jump of the function
  lies within one σ of the nominal (`Floor(2.95 ± 0.1)`, `Sign(0 ± 0.1)`).
- Proposal: (c) with the sub-option (unevaluated when a jump lies within
  one σ). With decision 3 (a) the visible result is the same as today
  except for the near-jump case.
- If nothing is decided: the implementation follows plan section 3 (b),
  which differs from today and from first-order propagation.

### 2. The uncertainty of a function with slope 1 between its jumps

Operators: `Mod` (first operand), `Fract`.

- Today: `Fract(2.5 ± 0.01)` is `0.5 ± 0.01` (uncertainty kept), but
  `Mod(5 ± 0.1, 3)` is `2` (uncertainty dropped). The second operand of
  `Mod` has slope `−⌊a/b⌋`: `Mod(7, 3 ± 0.1)` is `1` today.
- Proposal: first order for both: `Mod(5 ± 0.1, 3)` is `2 ± 0.1`,
  `Mod(7, 3 ± 0.1)` is `1 ± 0.2`, `Fract` unchanged; and the same near-jump
  sub-option as decision 1.
- If nothing is decided: `apply` does not know `Mod` and leaves it
  unevaluated (a regression from `2`).

### 3. A measurement with zero uncertainty

- Today: `Measurement(1, 0)` canonicalizes to `1` (decision of 2026-07-07:
  a zero error is an exact value). `Cos(0 ± 0.1)` is `1` and
  `1 ^ (2 ± 0.1)` is `1`.
- Plan section 6 says the hooks always return a measurement (`1 ± 0`), so
  that no `resultType` is needed. The two decisions conflict.
- (a) Keep the collapse. A hook result can be a number; the measurement
  kind declares `resultType` (`number | measurement`) for the operators
  where that can happen (the apply sites, `Power`, `Multiply`), and the
  section 6 change "`Cos(0 ± 0.1)` is `1 ± 0`" is withdrawn.
- (b) Remove the collapse in the constructor: `Measurement(5, 0)` stays a
  measurement everywhere, including user input. This reverses the
  2026-07-07 decision; the tests that pin it change.
- Proposal: (a). It keeps the earlier decision, and an exact result is more
  useful than a measurement with no uncertainty.
- If nothing is decided: the implementer cannot satisfy plan section 6
  without (b).

### 4. A derivative that is infinite, or a value that is infinite

Calls: `Sqrt(0 ± 0.1)`, `Arcsin(1 ± 0.1)`, `Ln(0 ± 0.1)`, `Gamma(0 ± 0.1)`,
`Tan(π/2 ± 0.1)`, `Factorial(−1 ± 0.1)`, `LogIntegral` of a complex nominal
at its edge.

- Today: the bare value. `Sqrt(0 ± 0.1)` is `0`, `Arcsin(1 ± 0.1)` is
  `π/2`, `Ln(0 ± 0.1)` is `−∞`, `Gamma(0 ± 0.1)` is `~∞`. The bare value
  claims an exact result and drops the uncertainty.
- Options: (a) the bare value (today); (b) unevaluated (the hook or `apply`
  declines); (c) a measurement with an infinite uncertainty; (d) `NaN`.
- Proposal: (b). The result keeps the information, and `.N()` does not
  invent a precision.
- If nothing is decided: the code moved from `measurementUnary()` keeps (a).

### 5. A real measurement whose value is not real

Calls: `Arccos(2.5 ± 0.1)`, `Arcsin(2.5 ± 0.1)`, `Arsech(2.5 ± 0.1)`,
`Artanh(2.5 ± 0.1)`, `Ln(−1 ± 0.1)`.

- Today: the bare complex value. `Arccos(2.5 ± 0.1)` is `1.5668i`.
- Proposal: `f(a) ± |f′(a)|·σ`: `Arccos(2.5 ± 0.1)` is `1.5668i ± 0.0436`,
  `Ln(−1 ± 0.1)` is `iπ ± 0.1`. A complex nominal is a valid measurement
  (decision D), and `|f′(a)|·σ` bounds the modulus of the first-order
  change.
- Alternative: unevaluated, as in decision 4.

### 6. A complex nominal at an operator that admits complex numbers

45 operators (table 2f, "Class (complex measurement)").

- Today: inconsistent (defect 6). `Cos((2 + 3i) ± 0.1)` is
  `cos(2 + 3i) ± 1.006`; `Arctan((2 + 3i) ± 0.1)` is `arctan(2 + 3i)`.
- Proposal: `f(a) ± |f′(a)|·σ` for every operator with a derivative, the
  rule of decision 5.

### 7. Operators that compute a value today and that `apply` would not know

21 operators (table 2f, "REGRESSION"): `Arg`, `Argument`, `Binomial`,
`Choose`, `ComplexRoots`, `ContinuedFraction`, `Cross`, `Degrees`,
`Distance`, `Dot`, `HadamardProduct`, `Haversine`, `HurwitzZeta`, `Hypot`,
`InverseHaversine`, `MatrixMultiply`, `Norm`, `Pochhammer`,
`PreDecrement`, `PreIncrement`, `Trace`. Plus the matrix operators of
decision 9 once they are admitted (`Determinant`, `Inverse`, `Eigen`, …).

- Today: the handler runs and computes with the measurement through the
  arithmetic hooks: `Hypot(2.5 ± 0.1, 3)` is `3.905 ± 0.064`,
  `Degrees(2.5 ± 0.1)` is `0.0436 ± 0.0017`,
  `Dot([2.5 ± 0.1, 2, 3], [1, 2, 3])` is `15.5 ± 0.1`.
- Plan section 6: after phase 2 the measurement `apply` runs in place of
  the handler and leaves an operator it does not know unevaluated.
- The handler's answer is correct to first order only when the measurement
  appears ONCE in each result cell: `Hypot`, `Degrees`, `Dot`, `Cross`,
  `MatrixMultiply`, `HadamardProduct`, `Trace`, `Norm` of a vector,
  `Distance`, `PreIncrement`, `PreDecrement`, `Haversine`. It is wrong when
  the measurement appears several times, because the hooks treat each
  occurrence as independent: `Binomial(M, 3)` is `M(M − 1)(M − 2)/6`,
  `Pochhammer`, `Choose`, a 3×3 `Determinant` (cofactor expansion),
  `Inverse`, `Eigenvalues`.
- Options:
  (a) unevaluated for all of them (plan section 6 as written);
  (b) the operators in the first group name `measurement` in their
  parameter (group 2), so their handler runs as today; the second group
  stays unevaluated;
  (c) `apply` uses the symbolic derivative `D` when the engine has one
  (it has one for `Haversine`, `Degrees`, `InverseHaversine`, `Mod`,
  `Sign`, `PolyGamma(n, x)`; it has none for the partial derivatives of
  `Hypot`, `Binomial`, `BesselJ`, `Beta`, `AGM`, `Zeta`, `Sinc`);
  (d) `apply` declines and the handler runs (today's results, including the
  wrong uncertainties of the second group).
- Proposal: (b) and (c) together; never (d). `ContinuedFraction`,
  `ComplexRoots`, `Arg` and `Argument` have no meaningful answer with an
  uncertainty: unevaluated.

### 8. `ElementMax` and `ElementMin`

- Today: `ElementMax(2.5 ± 0.1, 3)` is `3`, `ElementMin(2.5 ± 0.1, 3)` is
  `2.5 ± 0.1`, and `ElementMin(Quantity(2, deg), 3)` is `2 deg`.
- These are extrema, decided by an order. Plan 4.3 lists only `Max`, `Min`,
  `Sort`, `Clamp` as comparison sites; as written, `ElementMax` would be an
  apply site and stay unevaluated.
- Proposal: add `ElementMax` and `ElementMin` to the comparison sites (the
  same `compare` dispatch as `Max`/`Min`, element-wise).

### 9. Phase-1 admission gaps (a defect to fix in phase 2, and one question)

24 operators admit a measurement today, and phase 1 refuses the
`'number'` test kind there although the parameter admits `real` (table
2e):

- a parameter typed by a type variable, `(T) -> T where T: number`:
  `Conjugate`, `Chop`, `Remainder`, `BaseForm`;
- an overload: `Rational`;
- a `number` parameter of an operator that checks its operands itself:
  `Exp2`, `ND`, `NIntegrate`;
- a `matrix` parameter: a literal matrix of kind values is typed
  `list<list<integer | umeasurement>>`, which `matrix` refuses
  (`Determinant`, `Det`, `Inverse`, `PseudoInverse`, `AdjugateMatrix`,
  `CharacteristicPolynomial`, `CholeskyDecomposition`, `LUDecomposition`,
  `QRDecomposition`, `SVD`, `SingularValues`, `Eigen`, `Eigenvalues`,
  `Eigenvectors`, `RowReduce`, `LinearSolve`).

The first three groups contradict plan 4.2 and are defects of the phase-1
admission. The question is the fourth group: should a matrix of
measurements be admitted at the matrix operators? If yes, decision 7 says
what they do; if no, `Determinant([[2.5 ± 0.1, 2], [3, 4]])` (today
`4 ± 0.4`) becomes an `incompatible-type` error at boxing. Proposal: admit
(element-wise carrier, as for `list<real>`), and apply decision 7.

### 10. `Clamp` when the value equals a bound

- Today: `Clamp(3 ± 0.1, 0, 3)` is `3`, the bound.
- Plan 4.4 says `Clamp` returns `x` or the bound as written, and does not
  say which on a tie.
- Proposal: `x` (`3 ± 0.1`): a value inside the closed interval is
  returned unchanged.

### 11. The order of a complex measurement

- Today: `Less((2 + 3i) ± 0.1, 3)` is `False`, as `Less(2 + 3i, 3)` is.
- Plan 4.4: `compare` answers `undefined` for a complex nominal, so the
  comparison stays unevaluated.
- Options: (a) unevaluated (the plan); (b) `False`, as for the nominal.
- Proposal: (b): a measurement compares as its nominal, which is the
  principle of plan 4.7. The relational operator then needs the rule it
  applies to a complex number literal when `compare` declines.

### 12. A tie between a measurement and a number in `Max`/`Min`

- Today: `Max(2 ± 0.1, 2)` is `2`: `extremumOrder()` keeps the first
  operand of a tie, unless the second is a number literal and the first is
  not.
- Plan 4.4: a tie keeps the first, so `Max(2 ± 0.1, 2)` is `2 ± 0.1`.
- Proposal: the plan's rule (the first operand), which is also the answer
  for `Max(1 ± 0.1, 1 ± 0.5)`. Confirm.

### 13. The `NaN` and `Indeterminate` rule for a kind value

- Today: `isInexactOperand()` and `nanOperandAnswer()`
  (`boxed-expression/type-guards.ts`) read the nominal of a measurement and
  the magnitude of a quantity: `Max(Measurement(1.5, 0.1), Indeterminate)`
  is `NaN`, because the nominal `1.5` is a float.
- The plan has no hook for "this kind value is inexact".
- Options: (a) read the value through a new optional field of
  `ArithmeticDefinition` (`isExact(value)`); (b) a kind value is always
  inexact; (c) a kind value is always exact.
- Proposal: (a); without it, (b) for a measurement (a measurement is an
  approximate value) and the magnitude for a quantity, both read by name,
  which keeps two name-based sites.

### 14. `.re` and `.im` of a measurement

- Today: `Measurement(2.5, 0.1).re` is `2.5`
  (`BoxedFunction._measurementNominal`). Numeric kernels use it, which is
  how defect 2 happens.
- Plan 4.3: the numeric queries of a kind value answer `undefined` (`NaN`
  for `re`, `im`). Plan section 6 does not list this change; the test
  files that name a head contain 544 `.re`/`.im` reads (not all on a
  measurement).
- Proposal: follow 4.3 (`NaN`), and add the change to section 6.

### 15. Which operators name `quantity`

- Today: a quantity is typed `value`, and 197 of the 215 probed operators
  admit `Quantity(2, m)` at a numeric parameter. Most leave it unevaluated
  (`Sin(2 m)`); some compute a dimension-mixing expression
  (`Hypot(2 m, 3)` is `sqrt((2 m)^2 + 9)`, `Exp(2 m)` is `e^(2 m)`) or a
  wrong one (defect 3).
- After phase 2 a quantity (`admittedAs: 'none'`) is refused at boxing at
  every operator that does not name `quantity`.
- The angle fold (`2 deg` to `π/90` at canonicalization) applies today to
  23 heads: the six circular functions, the six hyperbolic functions, and
  eleven of their twelve inverses (table 2d). `Arctan` has its own
  definition and does not fold: `Arctan(2 deg)` stays `arctan(2 deg)`,
  while `Arcsin(2 deg)` is `arcsin(π/90)`. This difference looks
  accidental.
- Options for the trigonometric family: (a) all 24 heads name `quantity`,
  `Arctan` included (it then folds like the others)
  (today's results are kept: `Arcsin(2 deg)` is `arcsin(π/90)`,
  `Cosh(2 deg)` is `cosh(π/90)`); (b) only the six circular functions (an
  inverse function takes a ratio, a hyperbolic function a hyperbolic
  angle; `Arcsin(2 deg)` becomes an error at boxing).
- Proposal: (a), which changes nothing visible for these heads. `Hypot` of
  two quantities of one dimension is meaningful (`Hypot(3 m, 4 m)` is
  `5 m`) but works today only by accident; do not name `quantity` at
  `Hypot` in phase 2 (a feature, not part of this change).

### 16. A ranged parameter refuses a measurement

- `NormalDistribution(0, 5 ± 0.1)`, `Quantile(L, 1 ± 0.1)`,
  `BinomialDistribution(n, 1 ± 0.1)` and `PoissonDistribution(5 ± 0.1)` are
  valid today (the nominal fits the range) and are refused at boxing after
  phase 2: a ranged type does not admit `real` (plan 4.2). They all stay
  unevaluated today, so nothing is lost. Proposal: accept (the plan's
  rule). Confirm only.

## Visible changes that the plan implies and section 6 does not list

- The comparison methods decide a measurement (defect 5):
  `Measurement(2, 0.1).isLess(3)` is `true` (was `undefined`), and
  `Measurement(2, 0.1).is(2)` is `true` (was `false`).
- `Max`, `Min` and `Sort` of two quantities whose magnitudes are
  measurements with equal nominals decide (`Max((1 ± 0.1) m, (1 ± 0.5) m)`
  is the first; it stayed unevaluated).
- An undecided comparison keeps the measurement (defect 1).
- The 18 operators of table 2f that admit a complex measurement at a
  real-only parameter today answer `incompatible-type` at evaluation
  (only `Floor` is listed in section 3).
- The 108 refusals of Part 3 (86 operators). Two of them compute a value
  today: `IntegerString(5 ± 0.1)` is `"5"` and `ComplexRoots(3, 5 ± 0.1)`
  gives five roots.
- `.re`/`.im` of a measurement (decision 14).

## Operators that must name `quantity`

The group-2 list for `Quantity` under plan 4.7: the operators that
special-case a quantity today beyond the arithmetic operators of group 1
and the comparisons (`Max`, `Min`, `Sort`, `Clamp` and the relational
operators admit it through their `value`/`any` parameters).

| Operator | Today | Phase 2 |
| --- | --- | --- |
| `Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc` | angle fold at canonicalization (`Sin(2 deg)` is `Sin(π/90)`); `Sin(2 m)` admitted, unevaluated | name `quantity`; `resultType` `number` (plan 4.5) |
| `Sinh`, `Cosh`, `Tanh`, `Coth`, `Sech`, `Csch` | angle fold | name `quantity` (decision 15, option a) |
| `Arcsin`, `Arccos`, `Arccot`, `Arcsec`, `Arccsc`, `Arsinh`, `Arcosh`, `Artanh`, `Arcoth`, `Arsech`, `Arcsch` | angle fold | name `quantity` (decision 15, option a) |
| `Arctan` | no fold: `Arctan(2 deg)` stays as written | name `quantity` and fold like the other inverses (decision 15, option a) |
| `Abs` | `Abs(Quantity(-2, m))` admitted, unevaluated, typed `value` | name `quantity`; `Quantity(2, m)`, `resultType` `quantity` (plan section 6) |
| `ElementMax`, `ElementMin` | `ElementMin(2 deg, 3)` is `2 deg` (ordered through `exactOrder()`) | comparison sites (decision 8), admitted through `compare` |
| `UnitConvert`, `UnitSimplify`, `QuantityMagnitude`, `QuantityUnit`, `IsCompatibleUnit`, `UnitDimension` | `value` parameters | no change: group 2 admits the kind type (the plan's `Convert`) |

The other rows of table 2d (`Hypot`, `Degrees`, `Haversine`,
`InverseHaversine`, `Binomial`, `Choose`, `Pochhammer`, `PreIncrement`,
`PreDecrement`, `HurwitzZeta`, `Exp`, `Exp2`, `Lb`, `Lg`, `Log2`, `Log10`,
`Dot`, `Random`, `Limit`, …) compute a dimension-mixing or symbolic
expression today; the proposal is that they do not name `quantity`, so a
quantity there is refused at boxing after phase 2.

## Sites that the phase-2 implementation removes

From Part 1 (the full list, site by site, is in the appendix):

| File | Sites removed or replaced by a hook | Code lines |
| --- | --- | --- |
| `library/arithmetic.ts` | 32 | 67 |
| `library/relational-operator.ts` | 20 | 42 |
| `library/quantity-arithmetic.ts` | 18 | 53 |
| `library/measurement-arithmetic.ts` | 16 | 28 |
| `library/statistics.ts` | 14 | 19 |
| `boxed-expression/compare.ts` | 10 | 21 |
| `library/quantity-compare.ts` | 6 | 21 |
| `library/trigonometry.ts` | 6 | 8 |
| `boxed-expression/abstract-boxed-expression.ts` | 4 | 10 |
| `library/complex.ts` | 3 | 3 |
| `library/collections.ts` | 3 | 3 |
| `boxed-expression/type-guards.ts` | 2 | 3 |
| `index.ts` | 2 | 4 |
| `library/units.ts` | 1 | 1 |
| `library/special-functions.ts` | 1 | 1 |
| `boxed-expression/validate.ts` | 1 | 1 |
| `boxed-expression/boxed-number.ts` | 1 | 1 |
| `boxed-expression/boxed-function.ts` | 1 | 2 |
| `boxed-expression/boxed-symbol.ts` | 1 | 1 |
| **Total** | **142** | **289** |

By hook: `add` (`addEvaluatedOperands`, `quantityAdd`, `kelvinSum`,
`measurementAdd`), `multiply` (`mulEvaluatedOperands`,
`quantityMultiply`, `measurementMultiply`), `negate`, `divide`, `power`
(the `Negate`, `Divide`, `Power`, `Root`, `Sqrt` evaluate branches and
their helpers), `compare` and `eq` (all of `relational-operator.ts`,
`compare.ts`, `quantity-compare.ts`, the `.is()` methods, `Max`/`Min`),
`apply` (the `Floor` family, `Fract`, `Mod`, `Factorial`, `Gamma`,
`LogGamma`, `Ln`, `Log`, `Abs`, `Real`, `Imaginary`, `Conjugate`, the
trigonometric family, `Arctan`, `Arctan2`, `Erf`, `Erfc`, the six
statistics), `resultType` (`measurementType()`), the recognition by the
registry (`isMeasurement`, `isQuantity`), and the generic kind checks that
replace a head name (`numericOfFold`, `withExactFoldFallback`,
`machineStep`, `checkNumericArgs`). Two sites have no hook in the plan:
`isInexactOperand` and `nanOperandAnswer` (decision 13). The 51 sites that
stay are constructors (`Quantity`, `Measurement`, the physical constants,
numeric integration), the unit operators, the parse sugar of
`invisible-operator.ts`, and the LaTeX, ASCII-math and MathJSON
serialization.

## Appendix: script output

Regenerate and compare:

```sh
npx tsx scripts/probe-value-kinds-inventory.ts 2>/dev/null \
  | sed -e '1d' -e 's/^#/##/' > /tmp/inventory.md
sed -n '/^## Appendix: script output/,$p' \
  docs/scratch/2026-10-26-value-kinds-phase2-inventory.md \
  | sed '1,/^```$/d' | diff - /tmp/inventory.md
```

Produced by `npx tsx scripts/probe-value-kinds-inventory.ts` on commit `140ad66f5b5734556ce10f5f6c0d9408168850df`.

### Part 1. The name-based sites

The pattern finds 637 lines in 38 files: 379 lines of code in 193 sites (a site is the enclosing function or definition), and 258 comment lines in 139 sites. Unclassified code sites: 0.

| File | Site | Lines | What it does today | Phase 2 |
| --- | --- | --- | --- | --- |
| `boxed-expression/abstract-boxed-expression.ts` | `_BoxedExpression.is` | 1016, 1023, 1030 | `.is()`: a quantity against a number compares the comparable value | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/abstract-boxed-expression.ts` | `_BoxedExpression.is.otherQuantityOperand` | 1019 | `.is()`: a quantity against a number compares the comparable value | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/abstract-boxed-expression.ts` | `_BoxedExpression.is.oneQuantity` | 1031, 1032 | `.is()`: a quantity against a number compares the comparable value | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/abstract-boxed-expression.ts` | `_BoxedExpression.is.order` | 1034, 1035, 1036, 1037 | `.is()`: a quantity against a number compares the comparable value | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/ascii-math.ts` | `<import>` | 14 | ASCII-math and MathJSON serialization | LaTeX/serialization: stays |
| `boxed-expression/ascii-math.ts` | `FUNCTIONS.Quantity` | 568 | ASCII-math and MathJSON serialization | LaTeX/serialization: stays |
| `boxed-expression/ascii-math.ts` | `FUNCTIONS.Quantity.mag` | 574 | ASCII-math and MathJSON serialization | LaTeX/serialization: stays |
| `boxed-expression/ascii-math.ts` | `FUNCTIONS.Measurement` | 608, 623 | ASCII-math and MathJSON serialization | LaTeX/serialization: stays |
| `boxed-expression/boxed-function.ts` | `BoxedFunction._measurementNominal` | 2673, 2674 | `re`, `im`, `bignumRe`, `bignumIm` of a measurement read its nominal | removed: a kind value answers `NaN`/`undefined` to the numeric queries (4.3); see "Decisions needed" |
| `boxed-expression/boxed-number.ts` | `BoxedNumber.is` | 1664 | `.is()` delegates to the quantity side for symmetry | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/boxed-symbol.ts` | `BoxedSymbol.is` | 468 | `.is()` delegates to the quantity side for symmetry | `compare`: `.is()` through the `Equal` dispatch (4.4) |
| `boxed-expression/compare.ts` | `QuantityOrderFn` | 58 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `<top>` | 63, 74 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `_setQuantityOrder` | 65 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `QuantityDimensionsDifferFn` | 73 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `_setQuantityDimensionsDiffer` | 76 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `quantityOrder` | 104, 107 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `quantityComparableValue` | 134 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `quantityValue` | 153, 159, 163 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `cmp` | 1193 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/compare.ts` | `exactOrder` | 1767, 1777, 1778, 1779, 1780, 1801, 1806, 1807 | the comparison methods and `exactOrder()` order quantities (injected `compareQuantities`) and measurements (nominal; unequal σ at a tie: no order) | `compare` through `kind-compare.ts` (one order; a tie of two measurements is a tie, section 6) |
| `boxed-expression/invisible-operator.ts` | `canonicalJuxtaposition.isMagnitude` | 542 | a number (or a measurement) juxtaposed with a unit makes a `Quantity` | stays: parse sugar, not kind behavior |
| `boxed-expression/invisible-operator.ts` | `canonicalJuxtaposition` | 554, 556, 569 | a number (or a measurement) juxtaposed with a unit makes a `Quantity` | stays: parse sugar, not kind behavior |
| `boxed-expression/serialize.ts` | `serializeJsonFunction.argOptions` | 822 | ASCII-math and MathJSON serialization | LaTeX/serialization: stays |
| `boxed-expression/type-guards.ts` | `isInexactOperand` | 149, 152 | the NaN/Indeterminate rule reads the nominal of a measurement and the magnitude of a quantity | no hook in the plan: DECISION (see "Decisions needed") |
| `boxed-expression/type-guards.ts` | `nanOperandAnswer` | 178 | the NaN/Indeterminate rule reads the nominal of a measurement and the magnitude of a quantity | no hook in the plan: DECISION (see "Decisions needed") |
| `boxed-expression/validate.ts` | `checkNumericArgs` | 1163 | a `Quantity` operand is accepted at the arithmetic operators | removed: group-1 admission by rule (4.2) |
| `index.ts` | `<import>` | 166, 167 | injects `compareQuantities` and `quantityDimensionsDiffer` into `compare.ts` | removed: the hooks live on the head definitions |
| `index.ts` | `<top>` | 4894, 4895 | injects `compareQuantities` and `quantityDimensionsDiffer` into `compare.ts` | removed: the hooks live on the head definitions |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `<import>` | 63 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `serializeMeasurement` | 730, 749 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `parseDMS` | 2839, 2840, 2841 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `DEFINITIONS_ARITHMETIC.parse` | 3226, 3285, 4457, 4467, 4477, 4489, 4499 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `DEFINITIONS_ARITHMETIC.name` | 4443 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | `DEFINITIONS_ARITHMETIC.serialize` | 4448 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-units.ts` | `serializeQuantity` | 682, 693 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-units.ts` | `parseSiunitxQuantity` | 738, 746 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-units.ts` | `DEFINITIONS_UNITS` | 831, 832 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-units.ts` | `DEFINITIONS_UNITS.name` | 839 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/dictionary/definitions-units.ts` | `DEFINITIONS_UNITS.serialize` | 867, 892 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `latex-syntax/serializer.ts` | `Serializer.wrapShort.isRoundTripHazard` | 363, 367 | LaTeX parsing and serialization | LaTeX/serialization: stays |
| `library/arithmetic.ts` | `<import>` | 409, 410, 431, 432 | imports of `foldQuantityOperands`, `isQuantity`, `foldMeasurementOperands`, `isMeasurement` | removed with the branches |
| `library/arithmetic.ts` | `evaluateGamma` | 6737 | measurement branch of `Gamma` | `apply` at `Gamma` |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Ceil.evaluate` | 7016 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Ceil.evaluate.step` | 7018 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Ceil.evaluate.original` | 7023 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Divide.evaluate` | 7555, 7556, 7558, 7563, 7564 | quantity and measurement branches of `Divide` | `divide` of each kind |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Factorial.evaluate` | 7745 | measurement branch: `Gamma(a + 1)` propagation | `apply` at `Factorial` |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Floor.evaluate` | 8078 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Floor.evaluate.step` | 8080 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Floor.evaluate.original` | 8085 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Fract.evaluate` | 8165, 8166 | measurement branch: `Fract` of the nominal, σ kept | `apply` at `Fract` |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Ln.evaluate` | 9182 | measurement branch: `measurementLn`/`measurementLog` | `apply` at `Ln`, `Log` |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Log.evaluate` | 9300 | measurement branch: `measurementLn`/`measurementLog` | `apply` at `Ln`, `Log` |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Mod.evaluate` | 9596, 9597, 9600, 9606, 9607 | a measurement operand stands for its nominal; the result is a bare number | `apply` at `Mod`; the result is a DECISION (see "Decisions needed") |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Negate.evaluate` | 10920, 10927, 10933, 10938 | quantity and measurement branches of `Negate` | `negate` of each kind |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Measurement` | 10961 | the definition of the head `Measurement`, `(value, value) -> value`, typed by its nominal | the kind head: `arithmetic` with `admittedAs: 'number'`, result type `measurement` (section 6) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Measurement.examples` | 10967, 10968 | the definition of the head `Measurement`, `(value, value) -> value`, typed by its nominal | the kind head: `arithmetic` with `admittedAs: 'number'`, result type `measurement` (section 6) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Measurement.canonical` | 10993, 10994, 10998, 10999, 11004, 11008, 11009, 11014 | the constructor: σ = 0 collapses to the value, a unit on the error moves to the whole measurement | stays: constructor; the σ = 0 collapse here conflicts with "every hook returns a measurement" (DECISION) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Measurement.evaluate` | 11022 | the constructor: σ = 0 collapses to the value, a unit on the error moves to the whole measurement | stays: constructor; the σ = 0 collapse here conflicts with "every hook returns a measurement" (DECISION) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Power.evaluate` | 11531, 11532, 11538, 11539 | quantity and measurement branches of `Power` | `power` of each kind |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Root.evaluate` | 11881, 11886, 11894, 11898 | quantity and measurement branches of `Root`, `Sqrt` | `power` of each kind (exponent `1/n`, `1/2`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Round.evaluate` | 12111 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Round.evaluate.step` | 12113 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Round.evaluate.original` | 12126 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Sqrt.evaluate` | 12485, 12488, 12490, 12494 | quantity and measurement branches of `Root`, `Sqrt` | `power` of each kind (exponent `1/n`, `1/2`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Truncate.evaluate` | 12645 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Truncate.evaluate.step` | 12647 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `ARITHMETIC_LIBRARY.Truncate.evaluate.original` | 12652 | a measurement rounds as its nominal (and the written operand is read through its nominal) | `apply` at the `Floor` family, on the exact nominal (`ops.exact()`) |
| `library/arithmetic.ts` | `numericOfFold` | 15205 | a `Sum`/`Product` fold under `.N()` keeps a measurement, not the float of the exact value | generic: a kind value (by the registry) is kept; not a hook |
| `library/arithmetic.ts` | `evaluateAbs` | 15502 | measurement branch of `Abs` (Lipschitz) | `apply` at `Abs` (measurement); `Abs` names `quantity` (4.7) |
| `library/arithmetic.ts` | `processMinMaxItem` | 15862, 15880 | `Max`/`Min`: a measurement by its nominal, a quantity by its magnitude | `compare` (one dispatch, 4.4) |
| `library/arithmetic.ts` | `scalarExtremum` | 16119, 16120 | `Max`/`Min`: a measurement by its nominal, a quantity by its magnitude | `compare` (one dispatch, 4.4) |
| `library/arithmetic.ts` | `addEvaluatedOperands` | 16959, 16960, 16964, 17023, 17024 | `Add`: `quantityAdd`, then `measurementAdd`, then the `.N()` re-dispatch | `add` of each kind through `kindSumOrProduct()` |
| `library/arithmetic.ts` | `mulEvaluatedOperands` | 17171, 17172, 17176, 17216, 17217 | `Multiply`: `quantityMultiply`, then `measurementMultiply`, then the `.N()` re-dispatch | `multiply` of each kind through `kindSumOrProduct()` |
| `library/calculus.ts` | `measurementFromParts` | 1067, 1073 | numeric integration returns its result as a `Measurement` | stays: constructs a value, not kind behavior |
| `library/collections.ts` | `withExactFoldFallback` | 10258 | a fold under `.N()` keeps a measurement; a measurement is not machine-foldable | generic: a kind value (by the registry) is kept and not machine-folded; not a hook |
| `library/collections.ts` | `withExactFoldFallbackAsync` | 10273 | a fold under `.N()` keeps a measurement; a measurement is not machine-foldable | generic: a kind value (by the registry) is kept and not machine-folded; not a hook |
| `library/collections.ts` | `machineStep` | 10320 | a fold under `.N()` keeps a measurement; a measurement is not machine-foldable | generic: a kind value (by the registry) is kept and not machine-folded; not a hook |
| `library/complex.ts` | `COMPLEX_LIBRARY.Real.evaluate` | 555 | measurement branches (Lipschitz) | `apply` at `Real`, `Imaginary`, `Conjugate` |
| `library/complex.ts` | `COMPLEX_LIBRARY.Imaginary.evaluate` | 608 | measurement branches (Lipschitz) | `apply` at `Real`, `Imaginary`, `Conjugate` |
| `library/complex.ts` | `COMPLEX_LIBRARY.Conjugate.evaluate` | 884 | measurement branches (Lipschitz) | `apply` at `Real`, `Imaginary`, `Conjugate` |
| `library/library.ts` | `constantQuantity` | 68, 72 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.SpeedOfLight.value` | 181 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.PlanckConstant.value` | 192 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.Mu0.value` | 203 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.StandardGravity.value` | 217 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.ElementaryCharge.value` | 231 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.BoltzmannConstant.value` | 239 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.AvogadroConstant.value` | 250 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.VacuumPermittivity.value` | 261 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.GravitationalConstant.value` | 272 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.StefanBoltzmannConstant.value` | 289 | the physical constants are built as quantities | stays: constructs values |
| `library/library.ts` | `STANDARD_LIBRARIES.definitions.GasConstant.value` | 306 | the physical constants are built as quantities | stays: constructs values |
| `library/measurement-arithmetic.ts` | `MeasurementExpr` | 35 | type guard on the head name `Measurement` | recognition: the kind registry (`isKindOperand`, 4.6) |
| `library/measurement-arithmetic.ts` | `isMeasurement` | 41, 42 | type guard on the head name `Measurement` | recognition: the kind registry (`isKindOperand`, 4.6) |
| `library/measurement-arithmetic.ts` | `toPair` | 60 | internal helpers: (nominal, σ) pair; `makeMeasurement` collapses σ = 0 to the bare nominal | moves into the measurement hooks; the σ = 0 collapse is removed (4.7, section 6) |
| `library/measurement-arithmetic.ts` | `makeMeasurement` | 73, 85 | internal helpers: (nominal, σ) pair; `makeMeasurement` collapses σ = 0 to the bare nominal | moves into the measurement hooks; the σ = 0 collapse is removed (4.7, section 6) |
| `library/measurement-arithmetic.ts` | `measurementAdd` | 112 | quadrature sum of measurements and numbers | `add` of the measurement kind |
| `library/measurement-arithmetic.ts` | `measurementMultiply` | 139 | first-order product of measurements and numbers | `multiply` of the measurement kind |
| `library/measurement-arithmetic.ts` | `foldMeasurementOperands` | 161, 183 | re-dispatch after `addN`/`mulN` under `.N()` (a measurement that appears only once numericized), also per list cell | removed: the kind dispatch of `add`/`multiply` runs on the evaluated operands under `.N()` (4.4); the list-cell case needs a check in the broadcast |
| `library/measurement-arithmetic.ts` | `foldMeasurementOperands.cells` | 173 | re-dispatch after `addN`/`mulN` under `.N()` (a measurement that appears only once numericized), also per list cell | removed: the kind dispatch of `add`/`multiply` runs on the evaluated operands under `.N()` (4.4); the list-cell case needs a check in the broadcast |
| `library/measurement-arithmetic.ts` | `measurementDivide` | 209 | first-order quotient | `divide` of the measurement kind |
| `library/measurement-arithmetic.ts` | `measurementNegate` | 220 | negation, σ kept | `negate` of the measurement kind |
| `library/measurement-arithmetic.ts` | `measurementPower` | 272 | first-order power (measurement base, exponent, or both) | `power` of the measurement kind (also `Sqrt`, `Root`, `Square`, `Exp`) |
| `library/measurement-arithmetic.ts` | `measurementUnary` | 339 | generic `\|f′(a)\|·σ` propagation; drops σ where `f′` is undefined | `power` (`Sqrt`, `Root`) and `apply` (`Ln`, `Log`); the drop of σ at a domain edge is a DECISION (see "Decisions needed") |
| `library/measurement-arithmetic.ts` | `measurementNominal` | 430, 431 | the nominal of a measurement, for a comparison or a step function | `compare` (by nominal) and `apply` at the `Floor` family |
| `library/measurement-arithmetic.ts` | `measurementUnaryByHead` | 452, 457, 460, 464, 465 | propagation through any unary head with a known derivative; `Factorial` as `Gamma(a + 1)` | `apply` of the measurement kind (every unary operator with a derivative) |
| `library/measurement-arithmetic.ts` | `measurementArctan2` | 493, 498, 523 | two-operand propagation for `Arctan2` | `apply` at `Arctan2` |
| `library/measurement-arithmetic.ts` | `measurementLipschitzUnary` | 538, 543, 550 | `Real`, `Imaginary`, `Conjugate`, `Abs`: nominal mapped, σ kept | `apply` at `Real`, `Imaginary`, `Conjugate`, `Abs` |
| `library/quantity-arithmetic.ts` | `<import>` | 46 | imports of the measurement helpers | follows the helpers |
| `library/quantity-arithmetic.ts` | `QuantityExpr` | 58 | type guard on the head name `Quantity` | recognition: the kind registry (4.6) |
| `library/quantity-arithmetic.ts` | `isQuantity` | 65, 66 | type guard on the head name `Quantity` | recognition: the kind registry (4.6) |
| `library/quantity-arithmetic.ts` | `unitSymbol` | 73 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `convertMagnitude` | 102 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `addMagnitudes` | 164 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `multiplyMagnitudes` | 172 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `divideMagnitudes` | 181 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `quantityAdd` | 202, 210, 213, 266, 299 | sum of quantities: conversion to the first unit, offset temperatures | `add` of the quantity kind, one fold per dimension (CE-508.3) |
| `library/quantity-arithmetic.ts` | `kelvinSum` | 365, 407, 418 | sum of quantities: conversion to the first unit, offset temperatures | `add` of the quantity kind, one fold per dimension (CE-508.3) |
| `library/quantity-arithmetic.ts` | `quantityMultiply` | 426, 431, 434, 451, 455, 471, 487 | product of quantities and scalars; absorbs a measurement as magnitude | `multiply` of the quantity kind (absorbs a measurement operand, 4.3) |
| `library/quantity-arithmetic.ts` | `foldQuantityOperands` | 514, 522 | re-dispatch after `addN`/`mulN` under `.N()` | removed: the kind dispatch under `.N()` (4.4) |
| `library/quantity-arithmetic.ts` | `foldQuantityOperands.r` | 524 | re-dispatch after `addN`/`mulN` under `.N()` | removed: the kind dispatch under `.N()` (4.4) |
| `library/quantity-arithmetic.ts` | `quantityDivide` | 532, 537, 538, 549, 578, 587, 600 | quotient of quantities; a dimensionless result is a number | `divide` of the quantity kind; `resultType` `number \| quantity` |
| `library/quantity-arithmetic.ts` | `quantityDivideMeasurement` | 612, 616, 617, 643, 650, 661 | quotient of quantities; a dimensionless result is a number | `divide` of the quantity kind; `resultType` `number \| quantity` |
| `library/quantity-arithmetic.ts` | `simplifyQuantityUnit` | 748, 770, 796 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `simplifyQuantityUnitMeasurement` | 804, 823, 846 | internal helpers of the quantity arithmetic (magnitudes, units) | move with the quantity hooks |
| `library/quantity-arithmetic.ts` | `quantityPower` | 862, 867, 873, 878, 912, 915, 918 | power of a quantity (unit exponents) | `power` of the quantity kind (`Power`, `Sqrt`, `Root`, `Square`); `resultType` `number \| quantity` |
| `library/quantity-compare.ts` | `<import>` | 18, 19 | imports of `isMeasurement`, `measurementNominal`, `isQuantity` | follows the helpers |
| `library/quantity-compare.ts` | `QuantityCompareOptions` | 34 | order of two quantities after conversion (tolerance, exact and nominal options) | `compare` of the quantity kind (engine tolerance for floats; the zero tolerance of the extrema is dropped) |
| `library/quantity-compare.ts` | `compareQuantities` | 102, 105, 126, 128, 129 | order of two quantities after conversion (tolerance, exact and nominal options) | `compare` of the quantity kind (engine tolerance for floats; the zero tolerance of the extrema is dropped) |
| `library/quantity-compare.ts` | `quantityDimensionsDiffer` | 233, 234, 235, 236, 237 | two values of different dimensions (`2 m` and `2 s`, `2 m` and `2`) | `eq` of the quantity kind (4.4) |
| `library/quantity-compare.ts` | `quantityOperands` | 305, 306, 307, 313, 314, 315, 325 | internal helpers of the comparison | move with `compare` |
| `library/quantity-compare.ts` | `quantityDimension` | 334 | internal helpers of the comparison | move with `compare` |
| `library/relational-operator.ts` | `quantityCompare` | 89, 90 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `evaluateChainOperands` | 240 | the relational operators replace each measurement operand by its nominal | `compare` of the measurement kind (by nominal) |
| `library/relational-operator.ts` | `evaluateChainOperands.ops` | 243 | the relational operators replace each measurement operand by its nominal | `compare` of the measurement kind (by nominal) |
| `library/relational-operator.ts` | `evaluateChainOperands.stop` | 257 | the relational operators replace each measurement operand by its nominal | `compare` of the measurement kind (by nominal) |
| `library/relational-operator.ts` | `evaluateChainOperandsAsync` | 348, 362 | the relational operators replace each measurement operand by its nominal | `compare` of the measurement kind (by nominal) |
| `library/relational-operator.ts` | `exactPairAtNearTie` | 408, 409, 410, 411, 412, 413 | near a tie under `.N()`, the exact magnitudes of two quantities decide | `compare` of the quantity kind, reading `KindOperand.exact()` |
| `library/relational-operator.ts` | `exactQuantityPair` | 456, 462, 463, 467, 473, 475 | near a tie under `.N()`, the exact magnitudes of two quantities decide | `compare` of the quantity kind, reading `KindOperand.exact()` |
| `library/relational-operator.ts` | `exactQuantityNumberPair` | 495, 502, 503, 510, 516 | near a tie under `.N()`, the exact magnitudes of two quantities decide | `compare` of the quantity kind, reading `KindOperand.exact()` |
| `library/relational-operator.ts` | `exactQuantityOf` | 536, 541, 546, 550, 559 | near a tie under `.N()`, the exact magnitudes of two quantities decide | `compare` of the quantity kind, reading `KindOperand.exact()` |
| `library/relational-operator.ts` | `CHAIN_PAIR_IS_FALSE.Equal` | 668 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `CHAIN_PAIR_IS_FALSE.NotEqual` | 688 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `CHAIN_PAIR_IS_FALSE.Less` | 707 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `CHAIN_PAIR_IS_FALSE.LessEqual` | 729 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `nonRealKind` | 845 | decides whether a value is a pole or non-real, reading the nominal of a numericized measurement | `compare` (a kind value is not a non-real number; the kind decides) |
| `library/relational-operator.ts` | `decideEqual` | 1105 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `decideNotEqual` | 1197 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `decideLess` | 1271, 1295 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `decideLessEqual` | 1350, 1375 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `RELOP_LIBRARY.IdenticallyEqual.evaluate` | 1624 | the relational operators order two quantities, or a quantity and a number | `compare` and `eq` of the quantity kind (4.4) |
| `library/relational-operator.ts` | `undecidedCollectionComparison.unresolved` | 2553 | a quantity compared with a string is decided by dimensions, not kept as a possible collection | `eq` of the quantity kind and the disjoint-type rule (4.4) |
| `library/special-functions.ts` | `SPECIAL_FUNCTIONS_LIBRARY.LogGamma.evaluate` | 277 | measurement branch of `LogGamma` | `apply` at `LogGamma` |
| `library/statistics.ts` | `<import>` | 2 | imports of the measurement helpers | removed with the branches |
| `library/statistics.ts` | `STATISTICS_LIBRARY.Erf.evaluate` | 467 | measurement branches of `Erf`, `Erfc` | `apply` at `Erf`, `Erfc` |
| `library/statistics.ts` | `STATISTICS_LIBRARY.Erfc.evaluate` | 527 | measurement branches of `Erf`, `Erfc` | `apply` at `Erf`, `Erfc` |
| `library/statistics.ts` | `STATISTICS_LIBRARY.Mean.evaluate` | 761 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `STATISTICS_LIBRARY.Median.evaluate` | 863 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `STATISTICS_LIBRARY.Variance.evaluate` | 962 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `STATISTICS_LIBRARY.PopulationVariance.evaluate` | 1058 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `STATISTICS_LIBRARY.StandardDeviation.evaluate` | 1165 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `STATISTICS_LIBRARY.PopulationStandardDeviation.evaluate` | 1270 | a list with a measurement element goes to `measurementStatistic` | `apply` at a collection parameter (`ops.elements(i)`) |
| `library/statistics.ts` | `collectData` | 2177, 2184, 2230, 2246 | collection of the data and the measurement statistics (median by nominal) | move into the `apply` of the measurement kind |
| `library/statistics.ts` | `collectData.isMeasurementDatum` | 2185, 2186 | collection of the data and the measurement statistics (median by nominal) | move into the `apply` of the measurement kind |
| `library/statistics.ts` | `measurementStatistic` | 2594 | collection of the data and the measurement statistics (median by nominal) | move into the `apply` of the measurement kind |
| `library/statistics.ts` | `sortByNominal.sorted` | 2613 | collection of the data and the measurement statistics (median by nominal) | move into the `apply` of the measurement kind |
| `library/statistics.ts` | `measurementVariance` | 2660, 2682 | collection of the data and the measurement statistics (median by nominal) | move into the `apply` of the measurement kind |
| `library/trigonometry.ts` | `<import>` | 87 | imports of the measurement helpers | removed with the branches |
| `library/trigonometry.ts` | `TRIGONOMETRY_LIBRARY.Arctan.evaluate` | 783 | measurement branches of `Arctan`, `Arctan2` | `apply` at `Arctan`, `Arctan2` |
| `library/trigonometry.ts` | `TRIGONOMETRY_LIBRARY.Arctan2.evaluate` | 899 | measurement branches of `Arctan`, `Arctan2` | `apply` at `Arctan`, `Arctan2` |
| `library/trigonometry.ts` | `angularQuantityToRadians` | 1962, 1963 | an angle quantity (`2 deg`) folds to radians at canonicalization | `quantity` parameter of the trigonometric functions (4.7); the fold stays |
| `library/trigonometry.ts` | `trigFunction.common.canonical` | 2187 | an angle quantity (`2 deg`) folds to radians at canonicalization | `quantity` parameter of the trigonometric functions (4.7); the fold stays |
| `library/trigonometry.ts` | `trigFunction.common.evaluate` | 2248, 2249 | measurement branch of every trigonometric and hyperbolic head | `apply` at the trigonometric family |
| `library/units.ts` | `<import>` | 30 | import of `isMeasurement`, `measurementAffine` | follows the helpers |
| `library/units.ts` | `isSymbolicValue` | 450 | choose expression or machine arithmetic for a magnitude (a measurement magnitude goes by expression) | stays: helpers of the quantity hooks and of `UnitConvert` (a measurement magnitude is detected by the registry) |
| `library/units.ts` | `usesExpressionArithmetic` | 481 | choose expression or machine arithmetic for a magnitude (a measurement magnitude goes by expression) | stays: helpers of the quantity hooks and of `UnitConvert` (a measurement magnitude is detected by the registry) |
| `library/units.ts` | `affineMagnitude` | 519 | choose expression or machine arithmetic for a magnitude (a measurement magnitude goes by expression) | stays: helpers of the quantity hooks and of `UnitConvert` (a measurement magnitude is detected by the registry) |
| `library/units.ts` | `convertQuantity` | 530, 536, 549, 550, 552, 567, 576, 584, 599, 602, 609 | conversion of a quantity to another unit | stays: `UnitConvert` (group 2, `value` parameters); used by `compare` after conversion |
| `library/units.ts` | `UNITS_LIBRARY.Quantity` | 627 | the definition of the head `Quantity`, `(value, value) -> value` | the kind head: `arithmetic` with `admittedAs: 'none'`, result type `quantity` (section 6) |
| `library/units.ts` | `UNITS_LIBRARY.Quantity.canonical` | 653, 666, 677 | the constructor: canonical unit, evaluated magnitude | stays: constructor, not kind behavior |
| `library/units.ts` | `UNITS_LIBRARY.Quantity.evaluate` | 681 | the constructor: canonical unit, evaluated magnitude | stays: constructor, not kind behavior |
| `library/units.ts` | `UNITS_LIBRARY.Quantity.evaluateAsync` | 698 | the constructor: canonical unit, evaluated magnitude | stays: constructor, not kind behavior |
| `library/units.ts` | `UNITS_LIBRARY.QuantityMagnitude` | 702 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.QuantityMagnitude.evaluate` | 708 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.QuantityUnit` | 713 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.QuantityUnit.evaluate` | 719 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.UnitConvert.evaluate` | 743 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.UnitConvert.evaluateAsync` | 760 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.UnitSimplify.evaluate` | 773, 808 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `library/units.ts` | `UNITS_LIBRARY.UnitSimplify.evaluate.scaled` | 803 | unit operators over `value` parameters | stays: group 2 (a `value` parameter admits the kind type); the result type may name `quantity` |
| `numerics/strings.ts` | `roundMeasurementForDisplay` | 121 | rounds a measurement for display | LaTeX/serialization: stays |

#### Comment lines

Comment lines that name the heads. They are rewritten with the code they describe; a comment in a file that keeps its code (LaTeX, units) stays.

| File | Comment lines |
| --- | --- |
| `boxed-expression/ascii-math.ts` | 2 (570, 613) |
| `boxed-expression/boxed-function.ts` | 7 (2647, 2650, 2659, 2662, 2667, 2671, 3065) |
| `boxed-expression/compare.ts` | 17 (53, 55, 57, 81, 87, 130, 148, 149, 794, 1757, 1758, 1764, 1787, 1790, 1792, 1798, 1799) |
| `boxed-expression/invisible-operator.ts` | 1 (547) |
| `boxed-expression/kind-compare.ts` | 2 (203, 204) |
| `boxed-expression/overload.ts` | 1 (511) |
| `boxed-expression/serialize.ts` | 1 (815) |
| `boxed-expression/type-guards.ts` | 4 (146, 147, 150, 176) |
| `boxed-expression/validate.ts` | 2 (1164, 1393) |
| `index.ts` | 1 (4889) |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | 6 (723, 2822, 2874, 3218, 3277, 4071) |
| `latex-syntax/dictionary/definitions-units.ts` | 8 (5, 6, 13, 497, 597, 736, 837, 889) |
| `latex-syntax/latex-syntax.ts` | 3 (95, 176, 177) |
| `latex-syntax/serialize-dms.ts` | 1 (77) |
| `latex-syntax/serializer.ts` | 2 (357, 358) |
| `latex-syntax/types.ts` | 2 (1842, 1851) |
| `library/arithmetic.ts` | 36 (352, 6735, 7015, 7020, 7559, 7743, 8074, 8082, 8162, 8164, 9593, 10841, 10923, 10972, 10988, 10989, 10990, 11533, 12110, 12644, 12649, 15202, 15203, 15500, 15851, 15853, 15856, 15858, 15860, 15872, 16114, 16945, 16961, 17019, 17021, 17173) |
| `library/calculus.ts` | 4 (1050, 1061, 2387, 5913) |
| `library/collections.ts` | 4 (10255, 10272, 10316, 10317) |
| `library/complex.ts` | 4 (552, 554, 607, 883) |
| `library/core.ts` | 1 (10786) |
| `library/library.ts` | 2 (46, 63) |
| `library/measurement-arithmetic.ts` | 30 (2, 4, 7, 18, 34, 40, 56, 70, 71, 82, 89, 145, 147, 148, 150, 152, 153, 167, 168, 190, 277, 279, 317, 422, 445, 484, 491, 528, 535, 547) |
| `library/quantity-arithmetic.ts` | 50 (2, 5, 57, 64, 79, 80, 85, 154, 156, 157, 187, 191, 209, 244, 357, 358, 422, 423, 424, 440, 467, 493, 495, 497, 498, 499, 501, 503, 505, 530, 540, 554, 582, 591, 607, 608, 610, 647, 654, 800, 801, 811, 812, 817, 827, 849, 860, 869, 870, 876) |
| `library/quantity-compare.ts` | 7 (33, 44, 45, 60, 221, 225, 289) |
| `library/relational-operator.ts` | 14 (80, 84, 85, 86, 236, 445, 481, 483, 490, 491, 527, 833, 2546, 2550) |
| `library/special-functions.ts` | 1 (275) |
| `library/statistics.ts` | 15 (465, 525, 759, 858, 961, 1057, 1163, 1268, 2179, 2181, 2581, 2585, 2604, 2625, 2639) |
| `library/trigonometry.ts` | 6 (780, 896, 1947, 2242, 2244, 2246) |
| `library/type-handlers.ts` | 2 (1666, 1670) |
| `library/units.ts` | 14 (316, 445, 446, 460, 462, 465, 466, 505, 510, 539, 616, 648, 732, 795) |
| `numerics/strings.ts` | 3 (98, 114, 115) |
| `numerics/unit-data.ts` | 1 (1080) |
| `symbolic/derivative.ts` | 1 (458) |
| `types-kernel-serialization.ts` | 3 (63, 64, 71) |

#### Sites that the phase-2 implementation removes, by file

| File | Code sites removed or replaced by a hook | Code lines | Sites that stay |
| --- | --- | --- | --- |
| `library/arithmetic.ts` | 32 | 67 | 2 |
| `library/relational-operator.ts` | 20 | 42 | 0 |
| `library/quantity-arithmetic.ts` | 18 | 53 | 0 |
| `library/measurement-arithmetic.ts` | 16 | 28 | 0 |
| `library/statistics.ts` | 14 | 19 | 0 |
| `boxed-expression/compare.ts` | 10 | 21 | 0 |
| `library/quantity-compare.ts` | 6 | 21 | 0 |
| `library/trigonometry.ts` | 6 | 8 | 0 |
| `boxed-expression/abstract-boxed-expression.ts` | 4 | 10 | 0 |
| `library/complex.ts` | 3 | 3 | 0 |
| `library/collections.ts` | 3 | 3 | 0 |
| `boxed-expression/type-guards.ts` | 2 | 3 | 0 |
| `index.ts` | 2 | 4 | 0 |
| `library/units.ts` | 1 | 1 | 16 |
| `library/special-functions.ts` | 1 | 1 | 0 |
| `boxed-expression/validate.ts` | 1 | 1 | 0 |
| `boxed-expression/boxed-number.ts` | 1 | 1 | 0 |
| `boxed-expression/boxed-function.ts` | 1 | 2 | 0 |
| `boxed-expression/boxed-symbol.ts` | 1 | 1 | 0 |
| `library/calculus.ts` | 0 | 0 | 1 |
| `library/library.ts` | 0 | 0 | 12 |
| `numerics/strings.ts` | 0 | 0 | 1 |
| `boxed-expression/invisible-operator.ts` | 0 | 0 | 2 |
| `boxed-expression/ascii-math.ts` | 0 | 0 | 4 |
| `boxed-expression/serialize.ts` | 0 | 0 | 1 |
| `latex-syntax/serializer.ts` | 0 | 0 | 1 |
| `latex-syntax/dictionary/definitions-units.ts` | 0 | 0 | 5 |
| `latex-syntax/dictionary/definitions-arithmetic.ts` | 0 | 0 | 6 |
| **Total** | **142** | **289** | **51** |

### Part 2. The operators whose parameter admits `real`

Operators read from `src/math-json/OPERATORS.json`: 657; with a function signature in a fresh engine: 654; with a parameter that admits `real` (or a collection of reals): 220; probed: 215. Signatures in `OPERATORS.json` that spell `finite_real`: 0 (the type parser reads `finite_real` as `real`, so a live signature never carries it).

Not probed (no sample operand fits another required parameter): `CDF` (`(distribution, real | signed_infinity) -> nan | real<0..1>`), `NDSolve` (`(expression, symbol, limits: symbol | tuple, number, number?) -> list`), `NDSolveFunction` (`(expression, symbol, limits: symbol | tuple, number) -> function`), `PDF` (`(distribution, real | signed_infinity) -> nan | real<0..>`), `Polynomial` (`(list<value>, symbol) -> value`).

Probes: `M = Measurement(2.5, 0.1)` and `Mc = Measurement(Complex(2, 3), 0.1)` at the first parameter that admits `real` (as the first cell of a sample collection for a collection parameter); every other operand is the first of `3, 2, 1, 0, 1/2, 2.5, …` that fits its parameter. "Model" is the phase-1 test kind `UserMeasurement(2.5, 0.1)` (`admittedAs: 'number'`, `test/compute-engine/value-kinds-helpers.ts`): its admission is what phase 2 gives a measurement, and "apply" says the call is an apply site. "unchanged" means that `evaluate()` returned the canonical form. REGRESSION: today computes a value and the plan leaves the call unevaluated (`apply` does not know the operator). DECISION: the plan does not decide the answer (see "Decisions needed").

#### 2a. Real measurement `M = Measurement(2.5, 0.1)`

| Operator | Param | Type today | `evaluate()` today | `.N()` today | Model | Planned `evaluate()` | Planned type | Flag |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Abs` | 0: `complex \| infinity` | real<0..> | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | `2.5 ± 0.1` (Lipschitz: σ kept) | measurement |  |
| `AbsArg` | 0: `complex \| infinity` | tuple<+oo \| real, real> | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | tuple<+oo \| real, real> (declared, 4.5… |  |
| `AdjugateMatrix` | 0: `matrix` | matrix<real^(2x2)> | [[4,-2],[-3,2.50 ± 0.10]] | [[4,-2],[-3,2.50 ± 0.10]] | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | matrix (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `AGM` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `AiryAi` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `0.0157259 ± 0.00262509` (first order) | measurement |  |
| `AiryAiPrime` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `-0.0262509 ± 0.00393148` (first order) | measurement |  |
| `AiryBi` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `6.48166 ± 0.942142` (first order) | measurement |  |
| `AiryBiPrime` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `9.42142 ± 1.62042` (first order) | measurement |  |
| `AlgebraicGenerator` | 0: `list<number>` | number | Error("invalid-algebraic-generator") | Error("invalid-algebraic-generator") | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | measurement |  |
| `AppellF1` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Arccos` | 0: `complex` | complex | 1.56679923697241107866i | 1.56679923697241107866i | admitted, apply | `0 + 1.5668i ± 0.0436436` (\|f′(a)\|·σ; the value is not real) | measurement | DECISION (non-real) |
| `Arccot` | 0: `complex \| signed_infinity` | real | 0.381 ± 0.014 | 0.381 ± 0.014 | admitted, apply | `0.380506 ± 0.0137931` (first order) | measurement |  |
| `Arccsc` | 0: `complex \| infinity` | complex | 0.412 ± 0.017 | 0.412 ± 0.017 | admitted, apply | `0.411517 ± 0.0174574` (first order) | measurement |  |
| `Arcosh` | 0: `complex \| signed_infinity` | complex | 1.567 ± 0.044 | 1.567 ± 0.044 | admitted, apply | `1.5668 ± 0.0436436` (first order) | measurement |  |
| `Arcoth` | 0: `complex \| infinity` | complex \| signed_infinity | 0.424 ± 0.019 | 0.424 ± 0.019 | admitted, apply | `0.423649 ± 0.0190476` (first order) | measurement |  |
| `Arcsch` | 0: `complex \| infinity` | real | 0.390 ± 0.015 | 0.390 ± 0.015 | admitted, apply | `0.390035 ± 0.0148556` (first order) | measurement |  |
| `Arcsec` | 0: `complex \| infinity` | complex | 1.159 ± 0.017 | 1.159 ± 0.017 | admitted, apply | `1.15928 ± 0.0174574` (first order) | measurement |  |
| `Arcsin` | 0: `complex` | complex | (1.57079632679489661923 - 1.56679923697241107866i) | (1.57079632679489661923 - 1.56679923697… | admitted, apply | `1.5708 - 1.5668i ± 0.0436436` (\|f′(a)\|·σ; the value is not real) | measurement | DECISION (non-real) |
| `Arctan` | 0: `complex \| signed_infinity` | real | 1.190 ± 0.014 | 1.190 ± 0.014 | admitted, apply | `1.19029 ± 0.0137931` (first order) | measurement |  |
| `Arctan2` | 0: `real \| signed_infinity` | real | 0.695 ± 0.020 | 0.695 ± 0.020 | admitted, apply | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` | measurement |  |
| `Arg` | 0: `complex \| infinity` | real | 0 | 0 | admitted, apply | (canonical `Argument`) unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Argument` | 0: `complex \| infinity` | real | 0 | 0 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Arsech` | 0: `complex \| signed_infinity` | complex | 1.15927948072740859985i | 1.15927948072740859985i | admitted, apply | `0 + 1.15928i ± 0.0174574` (\|f′(a)\|·σ; the value is not real) | measurement | DECISION (non-real) |
| `Arsinh` | 0: `complex \| signed_infinity` | real | 1.647 ± 0.037 | 1.647 ± 0.037 | admitted, apply | `1.64723 ± 0.0371391` (first order) | measurement |  |
| `Artanh` | 0: `complex \| signed_infinity` | complex \| signed_infinity | (0.423648930193601806855 - 1.57079632679489661923i) ± … | (0.423648930193601806855 - 1.5707963267… | admitted, apply | `0.423649 - 1.5708i ± 0.0190476` (\|f′(a)\|·σ; the value is not real) | measurement | DECISION (non-real) |
| `Assign` | 0: `expression \| symbol` | — | refused at boxing: Error(ErrorCode("incompatible-type", "s… |  | REFUSED | admitted; the lazy handler sees the value (no `apply`, 4.2) | any (declared, 4.5 rule 4) |  |
| `At` | 1: `boolean \| character \| index…` | — | refused at boxing: Error(ErrorCode("incompatible-type", "d… |  | REFUSED, apply | unevaluated (`apply` does not know the operator) | unknown (declared, 4.5 rule 4) |  |
| `BarnesG` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BaseForm` | 0: `number` | real | 2.50 ± 0.10 | 2.50 ± 0.10 | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | measurement | DECISION (admission-gap) |
| `BesselI` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BesselJ` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BesselK` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BesselY` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Beta` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BetaRegularized` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `BinCounts` | 1: `list<number> \| number` | list<number> | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | list<number> (declared, 4.5 rule 4) |  |
| `Binomial` | 0: `complex \| infinity` | real | (2.50 ± 0.10 * (2.50 ± 0.10 - 1) * (2.50 ± 0.10 - 2)) … | Binomial(2.50 ± 0.10, 3) | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Ceil` | 0: `real \| signed_infinity \| ~oo` | integer | 3 | 3 | admitted, apply | first order: `3 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `CharacteristicPolynomial` | 0: `matrix` | number | x^2 - 6.5 * x + 4 ± \|sqrt(0.01 * \|sqrt(x^2)\|^2 + 0.… | x^2 - 6.5 * x + 4 ± \|sqrt(0.01 * \|sqr… | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | expression (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `CholeskyDecomposition` | 0: `matrix` | matrix<2x2> | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | matrix (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Choose` | 0: `complex \| infinity` | real | (2.50 ± 0.10 * (2.50 ± 0.10 - 1) * (2.50 ± 0.10 - 2)) … | Choose(2.50 ± 0.10, 3) | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Chop` | 0: `number` | real | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | measurement | DECISION (admission-gap) |
| `CircleContour` | 0: `complex` | expression | unchanged |  | admitted | admitted; unevaluated (no handler) | expression (declared, 4.5 rule 4) |  |
| `Clamp` | 0: `real \| signed_infinity` | real<3..3> | 3 | 3 | admitted | `compare` (Part 5) | measurement |  |
| `ClausenCl` | 1: `real` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Closed` | 0: `number` | number | unchanged |  | admitted | admitted; unevaluated (no handler) | measurement |  |
| `Complex` | 0: `number` | complex | unchanged |  | admitted | admitted; unevaluated (no handler) | measurement |  |
| `ComplexRoots` | 0: `complex` | list<number> | [1.3572088082974532,(-0.6786044041487262 + 1.175377306… | [1.3572088082974532,(-0.678604404148726… | admitted, apply | unevaluated (`apply` does not know the operator) | list<number> (declared, 4.5 rule 4) | REGRESSION |
| `Congruent` | 0: `number` | boolean | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | boolean (declared, 4.5 rule 4) |  |
| `Conjugate` | 0: `number` | real | 2.50 ± 0.10 | 2.50 ± 0.10 | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | measurement | DECISION (admission-gap) |
| `ContinuedFraction` | 0: `real` | list<integer> | [2,2] | [2,2] | admitted, apply | unevaluated (`apply` does not know the operator) | list<integer> (declared, 4.5 rule 4) | REGRESSION |
| `Correlation` | 0: `collection<nothing \| number …` | nan \| real<-1..1> | Error("unexpected-argument", "Correlation expects two … | Error("unexpected-argument", "Correlati… | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | measurement |  |
| `Cos` | 0: `complex` | real | -0.801 ± 0.060 | -0.801 ± 0.060 | admitted, apply | `-0.801144 ± 0.0598472` (first order) | measurement |  |
| `Cosh` | 0: `complex \| signed_infinity` | real | 6.13 ± 0.61 | 6.13 ± 0.61 | admitted, apply | `6.13229 ± 0.60502` (first order) | measurement |  |
| `CoshIntegral` | 0: `complex \| infinity` | real \| signed_infinity | unchanged |  | admitted, apply | `3.52443 ± 0.245292` (first order) | measurement |  |
| `CosIntegral` | 0: `complex \| infinity` | real \| signed_infinity | unchanged |  | admitted, apply | `0.285871 ± 0.0320457` (first order) | measurement |  |
| `Cot` | 0: `complex` | number | -1.34 ± 0.28 | -1.34 ± 0.28 | admitted, apply | `-1.33865 ± 0.279198` (first order) | measurement |  |
| `Coth` | 0: `complex \| signed_infinity` | real | 1.0136 ± 0.0027 | 1.0136 ± 0.0027 | admitted, apply | `1.01357 ± 0.00273187` (first order) | measurement |  |
| `Covariance` | 0: `collection<nothing \| number …` | nan \| real | Error("unexpected-argument", "Covariance expects two e… | Error("unexpected-argument", "Covarianc… | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | measurement |  |
| `Cross` | 0: `tuple \| vector` | vector | [0,-4.50 ± 0.30,3.00 ± 0.20] | [0,-4.50 ± 0.30,3.00 ± 0.20] | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | tuple \| vector (declared, 4.5 rule 4) | REGRESSION |
| `Csc` | 0: `complex` | number | 1.67 ± 0.22 | 1.67 ± 0.22 | admitted, apply | `1.67092 ± 0.223678` (first order) | measurement |  |
| `Csch` | 0: `complex \| signed_infinity` | real | 0.165 ± 0.017 | 0.165 ± 0.017 | admitted, apply | `0.165284 ± 0.0167526` (first order) | measurement |  |
| `DedekindEta` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Degrees` | 0: `real` | real | 0.0436 ± 0.0017 | 0.0436 ± 0.0017 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Denominator` | 0: `number` | nothing \| number | 1 | 1 | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | measurement |  |
| `Det` | 0: `matrix` | real | 4.00 ± 0.40 | 4.00 ± 0.40 | REFUSED | (canonical `Determinant`) REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integ… | measurement | DECISION (admission-gap) |
| `Determinant` | 0: `matrix` | real | 4.00 ± 0.40 | 4.00 ± 0.40 | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | measurement | DECISION (admission-gap) |
| `Digamma` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `0.703157 ± 0.0490358` (first order) | measurement |  |
| `DirichletBeta` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `DirichletEta` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `DirichletL` | 2: `number` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Distance` | 0: `list<list<number>> \| list<nu…` | real | 1.50 ± 0.10 | 1.50 ± 0.10 | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | measurement | REGRESSION |
| `Divide` | 0: `complex \| infinity` | real | 0.833 ± 0.033 | 0.833 ± 0.033 | admitted | (canonical `Multiply`) `multiply` hook (group 1) | measurement |  |
| `DMS` | 0: `number` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Dot` | 0: `list<tuple> \| matrix \| tupl…` | real | 15.50 ± 0.10 | 15.50 ± 0.10 | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | value (declared, 4.5 rule 4) | REGRESSION |
| `Drop` | 1: `number` | string | unchanged |  | admitted | admitted; unevaluated (no handler) | string (declared, 4.5 rule 4) |  |
| `Eigen` | 0: `matrix` | tuple<vector<2>, matrix<2x2… | ([5.812 ± 0.068,0.688 ± 0.068], [[0.5169562813224354,0… | ([5.812 ± 0.068,0.688 ± 0.068], [[0.516… | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | tuple (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Eigenvalues` | 0: `matrix` | vector<2> | [5.812 ± 0.068,0.688 ± 0.068] | [5.812 ± 0.068,0.688 ± 0.068] | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | list (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Eigenvectors` | 0: `matrix` | matrix<2x2> | [[0.5169562813224354,0.8560118008539828],[-0.741127495… | [[0.5169562813224354,0.8560118008539828… | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | list (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `EisensteinE` | 0: `number` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `ElementMax` | 0: `real \| signed_infinity` | real<3..> | 3 | 3 | admitted, apply | an extremum: `compare` would decide it, but the plan lists only `Max`, `Min`, `Sort`, `Clamp` | measurement | DECISION (element-extremum) |
| `ElementMin` | 0: `real \| signed_infinity` | real<..3> | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | an extremum: `compare` would decide it, but the plan lists only `Max`, `Min`, `Sort`, `Clamp` | measurement | DECISION (element-extremum) |
| `EllipticE` | 0: `complex \| infinity` | complex | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `EllipticF` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `EllipticK` | 0: `complex \| infinity` | complex \| signed_infinity | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `EllipticPi` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Erf` | 0: `complex \| signed_infinity` | real | 0.99959304798255504106 ± 0.000386090827245541848442 / … | 0.99959 ± 0.00022 | admitted, apply | `0.999593 ± 0.000217828` (first order) | measurement |  |
| `Erfc` | 0: `complex \| signed_infinity` | real | 0.000406952017444958939564 ± 0.00038609082724554184844… | 0.00041 ± 0.00022 | admitted, apply | `0.000406952 ± 0.000217828` (first order) | measurement |  |
| `Erfi` | 0: `complex \| signed_infinity` | real | unchanged |  | admitted, apply | `130.396 ± 58.4515` (first order) | measurement |  |
| `ErfInv` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Exp` | 0: `number` | real<0<..> | e^(2.5) ± 1.21824939607034734381 | 12.2 ± 1.2 | admitted | (canonical `Power`) `power` hook (group 1) | measurement |  |
| `Exp2` | 0: `number` | real<0<..> | 5.66 ± 0.39 | 5.66 ± 0.39 | REFUSED | (canonical `Power`) REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), altho… | measurement | DECISION (admission-gap) |
| `ExpIntegralEi` | 0: `complex \| infinity` | real \| signed_infinity | unchanged |  | admitted, apply | `7.07377 ± 0.4873` (first order) | measurement |  |
| `Factorial` | 0: `complex \| infinity` | real | 3.32 ± 0.37 | 3.32 ± 0.37 | admitted, apply | `3.32335 ± 0.366618` (first order, `Gamma(a + 1)`) | measurement |  |
| `Factorial2` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Floor` | 0: `real \| signed_infinity \| ~oo` | integer | 2 | 2 | admitted, apply | first order: `2 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `Fract` | 0: `real \| signed_infinity \| ~oo` | real<0..1> | 0.50 ± 0.10 | 0.50 ± 0.10 | admitted, apply | `0.5 ± 0.1` (today's branch: slope 1, σ kept) | measurement |  |
| `FresnelC` | 0: `complex \| signed_infinity` | real | unchanged |  | admitted, apply | `0.457413 ± 0.092388` (first order) | measurement |  |
| `FresnelS` | 0: `complex \| signed_infinity` | real | unchanged |  | admitted, apply | `0.619182 ± 0.0382683` (first order) | measurement |  |
| `Gamma` | 0: `complex \| infinity` | real | 1.329 ± 0.093 | 1.329 ± 0.093 | admitted, apply | `1.32934 ± 0.0934735` (first order) | measurement |  |
| `GammaLn` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `0.284683 ± 0.0703157` (first order) | measurement |  |
| `GammaRegularized` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `HadamardProduct` | 0: `matrix \| vector` | vector<real^3> | [2.50 ± 0.10,4,9] | [2.50 ± 0.10,4,9] | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | matrix \| vector (declared, 4.5 rule 4) | REGRESSION |
| `Haversine` | 0: `real` | real | 0.901 ± 0.030 | 0.901 ± 0.030 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Heaviside` | 0: `real \| signed_infinity` | rational<0..1> | 1 | 1 | admitted, apply | first order: `1 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `Histogram` | 1: `list<number> \| number` | list<tuple<number, integer>> | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | list<tuple<number, integer>> (declared,… |  |
| `HorizontalSpacing` | 0: `number` | nothing | unchanged |  | admitted | (canonical `Symbol`) not an apply site (phase-1 rule): the handler runs and sees the value, as today | nothing (declared, 4.5 rule 4) |  |
| `Hsl` | 0: `number` | color | unchanged |  | admitted | admitted; unevaluated (no handler) | color (declared, 4.5 rule 4) |  |
| `Hsv` | 0: `number` | color | unchanged |  | admitted | admitted; unevaluated (no handler) | color (declared, 4.5 rule 4) |  |
| `HurwitzZeta` | 0: `complex \| infinity` | real | -1.1767766952966368811 + Zeta(2.50 ± 0.10) ± 0.0122532… | HurwitzZeta(2.50 ± 0.10, 3) | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Hypergeometric1F1` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Hypergeometric2F1` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Hypot` | 0: `infinity \| real` | real | 3.905 ± 0.064 | 3.905 ± 0.064 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `Im` | 0: `complex \| infinity` | real | 0 | 0 | admitted, apply | (canonical `Imaginary`) `0` (σ on the real axis only; see the σ = 0 decision) | measurement |  |
| `Imaginary` | 0: `complex \| infinity` | real | 0 | 0 | admitted, apply | `0` (σ on the real axis only; see the σ = 0 decision) | measurement |  |
| `InterquartileRange` | 0: `collection<nothing \| number>…` | +oo \| nan \| real<0..> | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Interval` | 0: `number` | set<real> | unchanged |  | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | set<real> (declared, 4.5 rule 4) |  |
| `Inverse` | 0: `matrix` | matrix<2x2> | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 + 2 * 2.50 ± 0.1… | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 +… | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | matrix (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `InverseHaversine` | 0: `real` | complex | (3.14159265358979323846 - 2.06343706889556054672i) | (3.14159265358979323846 - 2.06343706889… | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `IsComposite` | 0: `number` | boolean | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | boolean (declared, 4.5 rule 4) |  |
| `IsEven` | 0: `number` | boolean | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | boolean (declared, 4.5 rule 4) |  |
| `IsOdd` | 0: `number` | boolean | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | boolean (declared, 4.5 rule 4) |  |
| `IsPrime` | 0: `number` | boolean | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | boolean (declared, 4.5 rule 4) |  |
| `JacobiTheta` | 0: `number` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Julia` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Kurtosis` | 0: `collection<nothing \| number>…` | nan \| real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `LambertW` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | `0.958586 ± 0.0195771` (first order) | measurement |  |
| `Lb` | 0: `number` | real | 1.322 ± 0.058 | 1.322 ± 0.058 | admitted, apply | (canonical `Log`) the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through … | measurement |  |
| `LerchPhi` | 0: `complex` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Lg` | 0: `number` | real | 0.398 ± 0.017 | 0.398 ± 0.017 | admitted, apply | (canonical `Log`) the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through … | measurement |  |
| `Limit` | 1: `number` | number | 5.00 ± 0.20 | 5.00 ± 0.20 | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | measurement |  |
| `LinearSolve` | 0: `matrix` | value | Error("incompatible-dimensions", "2 vs 3") | Error("incompatible-dimensions", "2 vs … | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | value (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Linspace` | 0: `number` | list<real> | unchanged |  | admitted | admitted; unevaluated (no handler) | list<number> (declared, 4.5 rule 4) |  |
| `Ln` | 0: `complex \| infinity` | real | 0.916 ± 0.040 | 0.916 ± 0.040 | admitted, apply | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` | measurement |  |
| `Log` | 0: `complex \| infinity` | real | 0.398 ± 0.017 | 0.398 ± 0.017 | admitted, apply | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` | measurement |  |
| `Log10` | 0: `number` | real | 0.398 ± 0.017 | 0.398 ± 0.017 | admitted, apply | (canonical `Log`) the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through … | measurement |  |
| `Log2` | 0: `number` | real | 1.322 ± 0.058 | 1.322 ± 0.058 | admitted, apply | (canonical `Log`) the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through … | measurement |  |
| `LogBarnesG` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `LogGamma` | 0: `complex \| infinity` | number | 0.285 ± 0.070 | 0.285 ± 0.070 | admitted, apply | `0.284683 ± 0.0703157` (first order) | measurement |  |
| `LogIntegral` | 0: `complex \| infinity` | real \| signed_infinity | unchanged |  | admitted, apply | `1.66729 ± 0.109136` (first order) | measurement |  |
| `LUDecomposition` | 0: `matrix` | tuple<matrix<integer^(2x2)>… | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | tuple (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Mandelbrot` | 0: `complex` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Matrix` | 0: `matrix` | matrix<real^(2x2)> | [[2.50 ± 0.10,2],[3,4]] | [[2.50 ± 0.10,2],[3,4]] | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | matrix (declared, 4.5 rule 4) |  |
| `MatrixMultiply` | 0: `matrix \| vector` | real | 15.50 ± 0.10 | 15.50 ± 0.10 | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | matrix \| number \| vector (declared, 4… | REGRESSION |
| `MatrixPower` | 1: `real` | matrix<2x2> | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | matrix (declared, 4.5 rule 4) |  |
| `Mean` | 0: `collection<nothing \| number>…` | real | 2.750 ± 0.050 | 2.750 ± 0.050 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `Median` | 0: `collection<nothing \| number>…` | nan \| real \| signed_infin… | 2.750 ± 0.050 | 2.750 ± 0.050 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `Mod` | 0: `real` | real | 2.5 | 2.5 | admitted, apply | `2.5 ± 0.1` by first order (slope 1); today the bare nominal | measurement | DECISION (unit-slope) |
| `Mode` | 0: `collection<nothing \| number>…` | nan \| real \| signed_infin… | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Multiply` | 0: `number` | real | 7.50 ± 0.30 | 7.50 ± 0.30 | admitted | `multiply` hook (group 1) | measurement |  |
| `ND` | 1: `number` | number | 1.9999999999999987 | 1.9999999999999987 | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | list<number> \| number \| tuple (declar… | DECISION (admission-gap) |
| `Negate` | 0: `complex \| infinity` | real | -2.50 ± 0.10 | -2.50 ± 0.10 | admitted | `negate` hook (group 1) | measurement |  |
| `NIntegrate` | 1: `number` | number | 2.75 | 2.75 | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | measurement | DECISION (admission-gap) |
| `NLimit` | 1: `number` | number | 5 | 5 | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | measurement |  |
| `Norm` | 0: `list<tuple> \| number \| tens…` | +oo \| nan \| real | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `NormalDistribution` | 0: `real` | expression<NormalDistributi… | unchanged |  | admitted | admitted; unevaluated (no handler) | expression<NormalDistribution> (declare… |  |
| `Numerator` | 0: `number` | nothing \| number | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | measurement |  |
| `NumeratorDenominator` | 0: `number` | nothing \| tuple<number, nu… | (2.50 ± 0.10, 1) | (2.50 ± 0.10, 1) | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | nothing \| tuple<number, number> (decla… |  |
| `Oklab` | 0: `number` | color | unchanged |  | admitted | admitted; unevaluated (no handler) | color (declared, 4.5 rule 4) |  |
| `Oklch` | 0: `number` | color | unchanged |  | admitted | admitted; unevaluated (no handler) | color (declared, 4.5 rule 4) |  |
| `Open` | 0: `number` | number | unchanged |  | admitted | admitted; unevaluated (no handler) | measurement |  |
| `Pochhammer` | 0: `complex \| infinity` | real | 2.50 ± 0.10 * (2.50 ± 0.10 + 1) * (2.50 ± 0.10 + 2) | 2.50 ± 0.10 * (2.50 ± 0.10 + 1) * (2.50… | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `PolyGamma` | 1: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `PolygonContour` | 0: `list<complex>` | expression | unchanged |  | admitted | admitted; unevaluated (no handler) | expression (declared, 4.5 rule 4) |  |
| `PolyLog` | 0: `complex \| infinity` | number | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `PopulationCovariance` | 0: `collection<nothing \| number …` | nan \| real | Error("unexpected-argument", "PopulationCovariance exp… | Error("unexpected-argument", "Populatio… | admitted, apply | collection parameter: `apply` with `ops.elements(i)`; unevaluated unless `apply` knows the operator | measurement |  |
| `PopulationStandardDeviation` | 0: `collection<nothing \| number>…` | nan \| real<0..> | 0.250 ± 0.050 | 0.250 ± 0.050 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `PopulationVariance` | 0: `collection<nothing \| number>…` | nan \| real<0..> | 0.063 ± 0.025 | 0.063 ± 0.025 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `Power` | 0: `complex \| infinity` | real<0<..> | 15.6 ± 1.9 | 15.6 ± 1.9 | admitted | `power` hook (group 1) | measurement |  |
| `PreDecrement` | 0: `number` | real | 1.50 ± 0.10 | 1.50 ± 0.10 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `PreIncrement` | 0: `number` | real | 3.50 ± 0.10 | 3.50 ± 0.10 | admitted, apply | unevaluated (`apply` does not know the operator) | measurement | REGRESSION |
| `PrimePi` | 0: `real` | integer | 1 | 1 | admitted, apply | first order: `1 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `PseudoInverse` | 0: `matrix` | matrix<2x2> | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 + 2 * 2.50 ± 0.1… | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 +… | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | matrix (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `QRDecomposition` | 0: `matrix` | tuple<matrix<2x2>, matrix<2… | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | tuple (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Quartiles` | 0: `collection<nothing \| number>…` | tuple<lower: nan \| real \|… | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | tuple<lower: nan \| real \| signed_infi… |  |
| `Random` | 0: `collection<any> \| set<real>` | real | (a random value) | (a random value) | admitted | not an apply site (phase-1 rule): the handler runs and sees the value, as today | any (declared, 4.5 rule 4) |  |
| `RandomChoice` | 1: `number` | string | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | string (declared, 4.5 rule 4) |  |
| `RandomSample` | 1: `number` | string | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | string (declared, 4.5 rule 4) |  |
| `Range` | 0: `number` | list<integer> | unchanged |  | admitted | admitted; unevaluated (no handler) | list<number> (declared, 4.5 rule 4) |  |
| `Rational` | 0: `real` | rational | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `real`, got `umeasurement`), although the parameter admi… | measurement | DECISION (admission-gap) |
| `Rationalize` | 0: `real` | rational | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Re` | 0: `complex \| infinity` | real | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | (canonical `Real`) `2.5 ± 0.1` (Lipschitz: σ kept) | measurement |  |
| `Real` | 0: `complex \| infinity` | real | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | `2.5 ± 0.1` (Lipschitz: σ kept) | measurement |  |
| `RectangleContour` | 0: `complex` | expression | unchanged |  | admitted | admitted; unevaluated (no handler) | expression (declared, 4.5 rule 4) |  |
| `Remainder` | 0: `number` | real | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `number`, got `umeasurement`), although the parameter ad… | measurement | DECISION (admission-gap) |
| `Rgb` | 0: `number` | color | unchanged |  | admitted | admitted; unevaluated (no handler) | color (declared, 4.5 rule 4) |  |
| `Root` | 0: `complex \| infinity` | real | root(3)(2.5) ± 0.0180961174439660438101 | 1.357 ± 0.018 | admitted | `power` hook (group 1) | measurement |  |
| `Round` | 0: `real \| signed_infinity \| ~oo` | integer | 3 | 3 | admitted, apply | first order: `3 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `RowReduce` | 0: `matrix` | matrix<2x2> | [[1,0],[0,1]] | [[1,0],[0,1]] | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | matrix (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Sec` | 0: `complex` | number | -1.248 ± 0.093 | -1.248 ± 0.093 | admitted, apply | `-1.24822 ± 0.0932445` (first order) | measurement |  |
| `Sech` | 0: `complex \| signed_infinity` | real | 0.163 ± 0.016 | 0.163 ± 0.016 | admitted, apply | `0.163071 ± 0.0160888` (first order) | measurement |  |
| `Sign` | 0: `complex \| signed_infinity \|…` | integer<-1..1> | 1 | 1 | admitted, apply | first order: `1 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `Sin` | 0: `complex` | real | 0.598 ± 0.080 | 0.598 ± 0.080 | admitted, apply | `0.598472 ± 0.0801144` (first order) | measurement |  |
| `Sinc` | 0: `complex \| signed_infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `SingularValues` | 0: `matrix` | vector<2> | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | list (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Sinh` | 0: `complex \| signed_infinity` | real | 6.05 ± 0.61 | 6.05 ± 0.61 | admitted, apply | `6.0502 ± 0.613229` (first order) | measurement |  |
| `SinhIntegral` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `3.54934 ± 0.242008` (first order) | measurement |  |
| `SinIntegral` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `1.77852 ± 0.0239389` (first order) | measurement |  |
| `Skewness` | 0: `collection<nothing \| number>…` | nan \| real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |
| `Slice` | 1: `number` | string | unchanged |  | admitted | admitted; unevaluated (no handler) | string (declared, 4.5 rule 4) |  |
| `Sqrt` | 0: `complex \| infinity` | real | 1.581 ± 0.032 | 1.581 ± 0.032 | admitted | `power` hook (group 1) | measurement |  |
| `Square` | 0: `number` | real<0<..> | 6.25 ± 0.50 | 6.25 ± 0.50 | admitted | (canonical `Power`) `power` hook (group 1) | measurement |  |
| `StandardDeviation` | 0: `collection<nothing \| number>…` | nan \| real<0..> | 0.354 ± 0.071 | 0.354 ± 0.071 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `Subtract` | 0: `number` | real | -0.50 ± 0.10 | -0.50 ± 0.10 | admitted | (canonical `Add`) `add` hook (group 1) | measurement |  |
| `SVD` | 0: `matrix` | tuple | unchanged |  | REFUSED | REFUSED at boxing by the phase-1 admission (expected `matrix`, got `list<list<integer \| umeasurement>>`), al… | tuple (declared, 4.5 rule 4) | DECISION (admission-gap) |
| `Take` | 1: `number` | string | unchanged |  | admitted | admitted; unevaluated (no handler) | string (declared, 4.5 rule 4) |  |
| `Tan` | 0: `complex` | number | -0.75 ± 0.16 | -0.75 ± 0.16 | admitted, apply | `-0.747022 ± 0.155804` (first order) | measurement |  |
| `Tanh` | 0: `complex \| signed_infinity` | real | 0.9866 ± 0.0027 | 0.9866 ± 0.0027 | admitted, apply | `0.986614 ± 0.00265922` (first order) | measurement |  |
| `Trace` | 0: `number \| tensor` | number | 2.50 ± 0.10 | 2.50 ± 0.10 | admitted, apply | unevaluated (`apply` does not know the operator) | number \| tensor (declared, 4.5 rule 4) | REGRESSION |
| `Trigamma` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | `0.490358 ± 0.0236204` (first order) | measurement |  |
| `Truncate` | 0: `real \| signed_infinity \| ~oo` | integer | 2 | 2 | admitted, apply | first order: `2 ± 0` (slope 0); plan section 3 keeps σ for `Floor` | measurement | DECISION (zero-slope) |
| `UniformDistribution` | 0: `real` | expression<UniformDistribut… | unchanged |  | admitted | admitted; unevaluated (no handler) | expression<UniformDistribution> (declar… |  |
| `Variance` | 0: `collection<nothing \| number>…` | nan \| real<0..> | 0.125 ± 0.050 | 0.125 ± 0.050 | admitted, apply | the measurement statistic of today, through `apply` with `ops.elements(0)` | measurement |  |
| `WithRandomSeed` | 0: `real \| string` | integer | unchanged |  | admitted | admitted; the lazy handler sees the value (no `apply`, 4.2) | expression (declared, 4.5 rule 4) |  |
| `Zeta` | 0: `complex \| infinity` | real | unchanged |  | admitted, apply | unevaluated (`apply` does not know the operator) | measurement |  |

#### 2b. Complex measurement `Mc = Measurement(Complex(2, 3), 0.1)`

| Operator | Param | `evaluate()` today | Planned | Flag |
| --- | --- | --- | --- | --- |
| `Abs` | `complex \| infinity` | sqrt(13) ± 0.1 | `3.60555 ± 0.1` (Lipschitz: σ kept) |  |
| `AbsArg` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `AdjugateMatrix` | `matrix` | [[4,-2],[-3,(2 + 3i) ± 0.1]] | as for a real nominal (collection parameter) |  |
| `AGM` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `AiryAi` | `complex \| infinity` | unchanged | `0.00810446 + 0.131178i ± 0.0251318` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `AiryAiPrime` | `complex \| infinity` | unchanged | `0.0966582 - 0.231987i ± 0.0473872` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `AiryBi` | `complex \| infinity` | unchanged | `-0.396368 - 0.569731i ± 0.115925` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `AiryBiPrime` | `complex \| infinity` | unchanged | `0.349458 - 1.10533i ± 0.250242` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `AlgebraicGenerator` | `list<number>` | Error("invalid-algebraic-generator") | as for a real nominal (collection parameter) |  |
| `AppellF1` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Arccos` | `complex` | arccos((2 + 3i)) ± 0.027301208627090667665 | `1.00014 - 1.98339i ± 0.0273012` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arccot` | `complex \| signed_infinity` | arccot((2 + 3i)) | `0.160875 - 0.229073i ± 0.00790569` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arccsc` | `complex \| infinity` | arccsc((2 + 3i)) ± 0.00757199289131655575633 | `0.150386 - 0.231335i ± 0.00757199` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arcosh` | `complex \| signed_infinity` | arcosh((2 + 3i)) ± 0.027301208627090667665 | `1.98339 + 1.00014i ± 0.0273012` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arcoth` | `complex \| infinity` | arcoth((2 + 3i)) | `0.146947 - 0.231824i ± 0.00745356` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arcsch` | `complex \| infinity` | arcsch((2 + 3i)) ± 0.00779827108571605037878 | `0.157355 - 0.229963i ± 0.00779827` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arcsec` | `complex \| infinity` | arcsec((2 + 3i)) ± 0.00757199289131655575633 | `1.42041 + 0.231335i ± 0.00757199` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arcsin` | `complex` | arcsin((2 + 3i)) ± 0.027301208627090667665 | `0.570653 + 1.98339i ± 0.0273012` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arctan` | `complex \| signed_infinity` | arctan((2 + 3i)) | `1.40992 + 0.229073i ± 0.00790569` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arctan2` | `real \| signed_infinity` | Error(ErrorCode("incompatible-type", "real \| signed_i… | `incompatible-type` at evaluation (decision D) |  |
| `Arg` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Argument` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Arsech` | `complex \| signed_infinity` | arsech((2 + 3i)) ± 0.00757199289131655575633 | `0.231335 - 1.42041i ± 0.00757199` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Arsinh` | `complex \| signed_infinity` | arsinh((2 + 3i)) ± 0.0281170662595174540198 | `1.96864 + 0.964659i ± 0.0281171` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Artanh` | `complex \| signed_infinity` | artanh((2 + 3i)) | `0.146947 + 1.33897i ± 0.00745356` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Assign` | `expression \| symbol` | refused at boxing: Error(ErrorCode("incompatible-type", "s… | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `At` | `boolean \| character \| index…` | refused at boxing: Error(ErrorCode("incompatible-type", "d… | unevaluated (`apply` does not know the operator) |  |
| `BarnesG` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BaseForm` | `number` | (2 + 3i) ± 0.1 | unevaluated (`apply` does not know the operator) |  |
| `BesselI` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BesselJ` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BesselK` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BesselY` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Beta` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BetaRegularized` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `BinCounts` | `list<number> \| number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Binomial` | `complex \| infinity` | ((2 + 3i) ± 0.1 * ((2 + 3i) ± 0.1 - 1) * ((2 + 3i) ± 0… | unevaluated (`apply` does not know the operator) |  |
| `Ceil` | `real \| signed_infinity \| ~oo` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `CharacteristicPolynomial` | `matrix` | x^2 + (-6 - 3i) * x + (2 + 12i) ± \|sqrt(0.01 * \|sqrt… | as for a real nominal (collection parameter) |  |
| `CholeskyDecomposition` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Choose` | `complex \| infinity` | ((2 + 3i) ± 0.1 * ((2 + 3i) ± 0.1 - 1) * ((2 + 3i) ± 0… | unevaluated (`apply` does not know the operator) |  |
| `Chop` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `CircleContour` | `complex` | unchanged | admitted; unevaluated (no handler) |  |
| `Clamp` | `real \| signed_infinity` | unchanged | `compare` (Part 5) |  |
| `ClausenCl` | `real` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Closed` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Complex` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `ComplexRoots` | `complex` | [(1.4518566183526649 + 0.49340353410400467i),(-1.15322… | unevaluated (`apply` does not know the operator) |  |
| `Congruent` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Conjugate` | `number` | (2 - 3i) ± 0.1 | `2 - 3i ± 0.1` (Lipschitz: σ kept) |  |
| `ContinuedFraction` | `real` | [2] | `incompatible-type` at evaluation (decision D) |  |
| `Correlation` | `collection<nothing \| number …` | Error("unexpected-argument", "Correlation expects two … | as for a real nominal (collection parameter) |  |
| `Cos` | `complex` | cos((2 + 3i)) ± 1.00590576035560988541 | `-4.18963 - 9.10923i ± 1.00591` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Cosh` | `complex \| signed_infinity` | cosh((2 + 3i)) ± 0.362960483726301264929 | `-3.72455 + 0.511823i ± 0.36296` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `CoshIntegral` | `complex \| infinity` | unchanged | `-0.168363 + 2.62512i ± 0.104271` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `CosIntegral` | `complex \| infinity` | unchanged | `1.40829 - 2.98362i ± 0.278085` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Cot` | `complex` | cot((2 + 3i)) ± 0.000988292295419914330973 | `-0.00373971 - 0.996758i ± 0.000988292` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Coth` | `complex \| signed_infinity` | coth((2 + 3i)) ± 0.00759069095214409162933 | `1.03575 + 0.0106048i ± 0.00759069` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Covariance` | `collection<nothing \| number …` | Error("unexpected-argument", "Covariance expects two e… | as for a real nominal (collection parameter) |  |
| `Cross` | `tuple \| vector` | [0,(-3 - 9i) ± 0.3,(2 + 6i) ± 0.2] | as for a real nominal (collection parameter) |  |
| `Csc` | `complex` | csc((2 + 3i)) ± 0.00990912718955598302008 | `0.0904732 + 0.041201i ± 0.00990913` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Csch` | `complex \| signed_infinity` | csch((2 + 3i)) ± 0.0285375673885612566781 | `-0.272549 - 0.0403006i ± 0.0285376` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `DedekindEta` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Degrees` | `real` | (1/90 + 1/60i) * pi ± 0.00174532925199432957692 | `incompatible-type` at evaluation (decision D) |  |
| `Denominator` | `number` | 1 | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Det` | `matrix` | (2 + 12i) ± 0.4 | as for a real nominal (collection parameter) |  |
| `Determinant` | `matrix` | (2 + 12i) ± 0.4 | as for a real nominal (collection parameter) |  |
| `Digamma` | `complex \| infinity` | unchanged | `1.20798 + 1.10413i ± 0.0299449` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `DirichletBeta` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `DirichletEta` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `DirichletL` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Distance` | `list<list<number>> \| list<nu…` | sqrt(10) ± 0.1 | as for a real nominal (collection parameter) |  |
| `Divide` | `complex \| infinity` | (2/3 + i) ± 0.0333333333333333333333 | `multiply` hook (group 1) |  |
| `DMS` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Dot` | `list<tuple> \| matrix \| tupl…` | (15 + 3i) ± 0.1 | as for a real nominal (collection parameter) |  |
| `Drop` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Eigen` | `matrix` | ([1/2 * ((6 + 3i) + sqrt((19 - 12i))) ± 0.05,1/2 * ((6… | as for a real nominal (collection parameter) |  |
| `Eigenvalues` | `matrix` | [1/2 * ((6 + 3i) + sqrt((19 - 12i))) ± 0.05,1/2 * ((6 … | as for a real nominal (collection parameter) |  |
| `Eigenvectors` | `matrix` | [[2,(1 - 3/2i) + 1/2 * sqrt((19 - 12i)) ± 0.1118033988… | as for a real nominal (collection parameter) |  |
| `EisensteinE` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `ElementMax` | `real \| signed_infinity` | unchanged | an extremum: `compare` would decide it, but the plan lists only `Max`, `Min`, `Sort`, `Clamp` | DECISION (element-extremum) |
| `ElementMin` | `real \| signed_infinity` | unchanged | an extremum: `compare` would decide it, but the plan lists only `Max`, `Min`, `Sort`, `Clamp` | DECISION (element-extremum) |
| `EllipticE` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `EllipticF` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `EllipticK` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `EllipticPi` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Erf` | `complex \| signed_infinity` | Erf((2 + 3i)) ± 16.7466316854179178147 | `-20.8295 + 8.68732i ± 16.7466` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Erfc` | `complex \| signed_infinity` | Erfc((2 + 3i)) ± 16.7466316854179178147 | `21.8295 - 8.68732i ± 16.7466` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Erfi` | `complex \| signed_infinity` | unchanged | `-0.0000115467 + 0.998963i ± 0.000760296` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `ErfInv` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Exp` | `number` | e^(2 + 3i) ± 0.738905609893065022723 | `power` hook (group 1) |  |
| `Exp2` | `number` | 2^(2 + 3i) ± 0.277258872223978123767 | `power` hook (group 1) |  |
| `ExpIntegralEi` | `complex \| infinity` | unchanged | `-0.361552 + 5.27055i ± 0.204936` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Factorial` | `complex \| infinity` | Gamma((3 + 3i)) ± 0.0719427481165360832281 | `-0.440113 - 0.0636372i ± 0.0719427` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Factorial2` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Floor` | `real \| signed_infinity \| ~oo` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Fract` | `real \| signed_infinity \| ~oo` | Error(ErrorCode("incompatible-type", "real \| signed_i… | `incompatible-type` at evaluation (decision D) |  |
| `FresnelC` | `complex \| signed_infinity` | unchanged | `-3788100 + 5815900i ± 7677650` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `FresnelS` | `complex \| signed_infinity` | unchanged | `-5815900 - 3788100i ± 7677650` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Gamma` | `complex \| infinity` | Gamma((2 + 3i)) ± 0.0201844650617454120963 | `-0.0823953 + 0.0917743i ± 0.0201845` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `GammaLn` | `complex \| infinity` | unchanged | `-2.09285 + 2.3024i ± 0.163656` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `GammaRegularized` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `HadamardProduct` | `matrix \| vector` | [(2 + 3i) ± 0.1,4,9] | as for a real nominal (collection parameter) |  |
| `Haversine` | `real` | 1/2 * (1 - cos((2 + 3i))) ± 0.502952880177804942705 | `incompatible-type` at evaluation (decision D) |  |
| `Heaviside` | `real \| signed_infinity` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Histogram` | `list<number> \| number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `HorizontalSpacing` | `number` | unchanged | unknown operator |  |
| `Hsl` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Hsv` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `HurwitzZeta` | `complex \| infinity` | -1 - 2^(-2 - 3i) + Zeta((2 + 3i) ± 0.1) ± 0.0173286795… | unevaluated (`apply` does not know the operator) |  |
| `Hypergeometric1F1` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Hypergeometric2F1` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Hypot` | `infinity \| real` | sqrt((4 + 12i)) | `incompatible-type` at evaluation (decision D) |  |
| `Im` | `complex \| infinity` | 3.00 ± 0.10 | `3 ± 0.1` (Lipschitz: σ kept) |  |
| `Imaginary` | `complex \| infinity` | 3.00 ± 0.10 | `3 ± 0.1` (Lipschitz: σ kept) |  |
| `InterquartileRange` | `collection<nothing \| number>…` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Interval` | `number` | unchanged | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Inverse` | `matrix` | [[2 / (-3 + 2(2 + 3i) ± 0.1),-1 / (-3 + 2(2 + 3i) ± 0.… | as for a real nominal (collection parameter) |  |
| `InverseHaversine` | `real` | 2arcsin(sqrt((2 + 3i))) | `incompatible-type` at evaluation (decision D) |  |
| `IsComposite` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `IsEven` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `IsOdd` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `IsPrime` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `JacobiTheta` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Julia` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Kurtosis` | `collection<nothing \| number>…` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `LambertW` | `complex \| infinity` | unchanged | `1.09008 + 0.53014i ± 0.0155914` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Lb` | `number` | 1 | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `LerchPhi` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Lg` | `number` | log((2 + 3i), 10) | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `Limit` | `number` | (4 + 6i) ± 0.2 | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `LinearSolve` | `matrix` | Error("incompatible-dimensions", "2 vs 3") | as for a real nominal (collection parameter) |  |
| `Linspace` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Ln` | `complex \| infinity` | ln((2 + 3i)) | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `Log` | `complex \| infinity` | log((2 + 3i), 10) | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `Log10` | `number` | log((2 + 3i), 10) | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `Log2` | `number` | 1 | the propagation of today (`measurementArctan2`, `measurementLn`, `measurementLog`) through `apply` |  |
| `LogBarnesG` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `LogGamma` | `complex \| infinity` | LogGamma((2 + 3i)) ± 0.163655728558526828621 | `-2.09285 + 2.3024i ± 0.163656` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `LogIntegral` | `complex \| infinity` | unchanged | no finite first-order answer: `f(a)` is LogIntegral((2 + 3i)), `f′(a)` is (0.491252008617301918053 … | DECISION (edge) |
| `LUDecomposition` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Mandelbrot` | `complex` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Matrix` | `matrix` | [[(2 + 3i) ± 0.1,2],[3,4]] | as for a real nominal (collection parameter) |  |
| `MatrixMultiply` | `matrix \| vector` | (15 + 3i) ± 0.1 | as for a real nominal (collection parameter) |  |
| `MatrixPower` | `real` | [[7,10],[15,22]] | `incompatible-type` at evaluation (decision D) |  |
| `Mean` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `Median` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `Mod` | `real` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Mode` | `collection<nothing \| number>…` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Multiply` | `number` | (6 + 9i) ± 0.3 | `multiply` hook (group 1) |  |
| `ND` | `number` | 1.9999999999999996 | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Negate` | `complex \| infinity` | (-2 - 3i) ± 0.1 | `negate` hook (group 1) |  |
| `NIntegrate` | `number` | 5 | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `NLimit` | `number` | unchanged | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Norm` | `list<tuple> \| number \| tens…` | sqrt(13) ± 0.1 | unevaluated (`apply` does not know the operator) |  |
| `NormalDistribution` | `real` | unchanged | admitted; unevaluated (no handler) |  |
| `Numerator` | `number` | (2 + 3i) ± 0.1 | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `NumeratorDenominator` | `number` | ((2 + 3i) ± 0.1, 1) | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Oklab` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Oklch` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Open` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Pochhammer` | `complex \| infinity` | (2 + 3i) ± 0.1 * ((2 + 3i) ± 0.1 + 1) * ((2 + 3i) ± 0.… | unevaluated (`apply` does not know the operator) |  |
| `PolyGamma` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `PolygonContour` | `list<complex>` | unchanged | as for a real nominal (collection parameter) |  |
| `PolyLog` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `PopulationCovariance` | `collection<nothing \| number …` | Error("unexpected-argument", "PopulationCovariance exp… | as for a real nominal (collection parameter) |  |
| `PopulationStandardDeviation` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `PopulationVariance` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `Power` | `complex \| infinity` | (-46 + 9i) ± 3.9 | `power` hook (group 1) |  |
| `PreDecrement` | `number` | (1 + 3i) ± 0.1 | unevaluated (`apply` does not know the operator) |  |
| `PreIncrement` | `number` | (3 + 3i) ± 0.1 | unevaluated (`apply` does not know the operator) |  |
| `PrimePi` | `real` | 1 | `incompatible-type` at evaluation (decision D) |  |
| `PseudoInverse` | `matrix` | [[2 / (-3 + 2(2 + 3i) ± 0.1),-1 / (-3 + 2(2 + 3i) ± 0.… | as for a real nominal (collection parameter) |  |
| `QRDecomposition` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Quartiles` | `collection<nothing \| number>…` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Random` | `collection<any> \| set<real>` | (a random value) | as for a real nominal (collection parameter) |  |
| `RandomChoice` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `RandomSample` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Range` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Rational` | `real` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Rationalize` | `real` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `Re` | `complex \| infinity` | 2.00 ± 0.10 | `2 ± 0.1` (Lipschitz: σ kept) |  |
| `Real` | `complex \| infinity` | 2.00 ± 0.10 | `2 ± 0.1` (Lipschitz: σ kept) |  |
| `RectangleContour` | `complex` | unchanged | admitted; unevaluated (no handler) |  |
| `Remainder` | `number` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Rgb` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Root` | `complex \| infinity` | root(3)(2 + 3i) | `power` hook (group 1) |  |
| `Round` | `real \| signed_infinity \| ~oo` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `RowReduce` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Sec` | `complex` | sec((2 + 3i)) ± 0.0100059265089362298909 | `-0.041675 + 0.0906111i ± 0.0100059` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Sech` | `complex \| signed_infinity` | sech((2 + 3i)) ± 0.0256795887727569250962 | `-0.263513 - 0.0362116i ± 0.0256796` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Sign` | `complex \| signed_infinity \|…` | unchanged | first order: `0.5547 + 0.83205i ± 0` (slope 0); plan section 3 keeps σ for `Floor` | DECISION (zero-slope) |
| `Sin` | `complex` | sin((2 + 3i)) ± 1.00265146611769409351 | `9.1545 - 4.16891i ± 1.00265` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Sinc` | `complex \| signed_infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `SingularValues` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Sinh` | `complex \| signed_infinity` | sinh((2 + 3i)) ± 0.375954805280281330296 | `-3.59056 + 0.530921i ± 0.375955` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `SinhIntegral` | `complex \| infinity` | unchanged | `-0.193189 + 2.64543i ± 0.100667` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `SinIntegral` | `complex \| infinity` | unchanged | `4.54751 + 1.3992i ± 0.278988` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Skewness` | `collection<nothing \| number>…` | unchanged | unevaluated (`apply` does not know the operator) |  |
| `Slice` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Sqrt` | `complex \| infinity` | sqrt((2 + 3i)) | `power` hook (group 1) |  |
| `Square` | `number` | (-5 + 12i) ± 0.721110255092797858624 | `power` hook (group 1) |  |
| `StandardDeviation` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `Subtract` | `number` | (-1 + 3i) ± 0.1 | `add` hook (group 1) |  |
| `SVD` | `matrix` | unchanged | as for a real nominal (collection parameter) |  |
| `Take` | `number` | unchanged | admitted; unevaluated (no handler) |  |
| `Tan` | `complex` | tan((2 + 3i)) ± 0.000994718084266553462597 | `-0.00376403 + 1.00324i ± 0.000994718` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Tanh` | `complex \| signed_infinity` | tanh((2 + 3i)) ± 0.00707503706990902582296 | `0.965386 - 0.00988438i ± 0.00707504` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Trace` | `number \| tensor` | (2 + 3i) ± 0.1 | unevaluated (`apply` does not know the operator) |  |
| `Trigamma` | `complex \| infinity` | unchanged | `0.135555 - 0.26701i ± 0.00900504` (\|f′(a)\|·σ) | DECISION (complex-nominal) |
| `Truncate` | `real \| signed_infinity \| ~oo` | unchanged | `incompatible-type` at evaluation (decision D) |  |
| `UniformDistribution` | `real` | unchanged | admitted; unevaluated (no handler) |  |
| `Variance` | `collection<nothing \| number>…` | unchanged | the measurement statistic of today, through `apply` with `ops.elements(0)` |  |
| `WithRandomSeed` | `real \| string` | unchanged | admitted; the lazy handler sees the value (no `apply`, 4.2) |  |
| `Zeta` | `complex \| infinity` | unchanged | unevaluated (`apply` does not know the operator) |  |

#### 2c. Edge cases

| Call | Valid | Type today | `evaluate()` today | `.N()` today | Proposed answer |
| --- | --- | --- | --- | --- | --- |
| `["Sqrt",["Measurement",0,0.1]]` | yes | real | 0 | 0 | f′ infinite at the nominal: DECISION (proposed: unevaluated, the `power` hook declines) |
| `["Arcsin",["Measurement",1,0.1]]` | yes | complex | 1/2 * pi | 1.57079632679489661923 | f′ infinite at the nominal: DECISION (proposed: unevaluated) |
| `["Ln",["Measurement",0,0.1]]` | yes | number | -oo | -oo | f(a) is −∞: DECISION (proposed: unevaluated) |
| `["Ln",["Measurement",-1,0.1]]` | yes | complex | ln(-1) | 3.14159265358979323846i | complex value `iπ`, f′ = −1: DECISION (proposed: `iπ ± 0.1`, |f′(a)|·σ) |
| `["Arccos",["Measurement",2.5,0.1]]` | yes | complex | 1.56679923697241107866i | 1.56679923697241107866i | complex value: DECISION (proposed: `1.5668i ± 0.0436`, |f′(a)|·σ) |
| `["Gamma",["Measurement",0,0.1]]` | yes | number | ~oo | ~oo | pole: DECISION (proposed: unevaluated) |
| `["Tan",["Measurement",["Divide","Pi",2],0.1]]` | yes | number | ~oo | ~oo | pole: DECISION (proposed: unevaluated) |
| `["Cos",["Measurement",0,0.1]]` | yes | real | 1 | 1 | plan section 6: `1 ± 0` (conflicts with the σ = 0 collapse of the constructor: DECISION) |
| `["Power",1,["Measurement",2,0.1]]` | yes | 1 | 1 | 1 | plan section 6: `1 ± 0` (same conflict) |
| `["Abs",["Measurement",0,0.1]]` | yes | integer<0..> | 0.00 ± 0.10 | 0.00 ± 0.10 | `0 ± 0.1` (Lipschitz; no change) |
| `["Sign",["Measurement",0,0.1]]` | yes | integer<-1..1> | Sign(0.00 ± 0.10) | Sign(0.00 ± 0.10) | jump at the nominal: DECISION (proposed: unevaluated) |
| `["Sign",["Measurement",5,0.1]]` | yes | integer<-1..1> | 1 | 1 | first order `1 ± 0`: DECISION (zero slope) |
| `["Round",["Measurement",2.5,0.1]]` | yes | integer | 3 | 3 | first order `3 ± 0`: DECISION (zero slope; `Round(2.5)` is 3 today) |
| `["Floor",["Measurement",2.95,0.1]]` | yes | integer | 2 | 2 | first order `2 ± 0`, although `2.95 ± 0.1` crosses 3: DECISION (zero slope) |
| `["Floor",["Measurement",2.5,0.1]]` | yes | integer | 2 | 2 | plan section 3: `Measurement(2, 0.1)`; first order `2 ± 0`: DECISION |
| `["Mod",["Measurement",5,0.1],3]` | yes | integer | 2 | 2 | plan section 6 lists it; first order `2 ± 0.1` (slope 1): DECISION |
| `["Mod",7,["Measurement",3,0.1]]` | yes | integer | 1 | 1 | second operand: slope −⌊a/b⌋ = −2, first order `1 ± 0.2`: DECISION |
| `["Fract",["Measurement",2.5,0.01]]` | yes | real<0..1> | 0.500 ± 0.010 | 0.500 ± 0.010 | `0.5 ± 0.01` (slope 1; no change) |
| `["Clamp",["Measurement",5,0.1],0,3]` | yes | integer<0..3> | 3 | 3 | `3`, the bound as written (4.4; no change) |
| `["Factorial",["Measurement",5,0.1]]` | yes | integer | 120 ± 20 | 120 ± 20 | `120 ± 20.47…` (`Gamma(a + 1)`; no change) |
| `["Factorial",["Measurement",-1,0.1]]` | yes | number | ~oo | ~oo | pole of `Gamma(a + 1)`: DECISION (proposed: unevaluated) |

#### 2d. Quantities at a parameter that admits `real`

`Quantity(2, m)` and `Quantity(2, deg)` at the same parameter, in the rows where today does something with them. A quantity is `admittedAs: 'none'`: after phase 2 every row of this table is refused at boxing unless the operator names `quantity` in its parameter (group 2). "folded" means that canonicalization removed the `Quantity` head (an angle converted to radians).

| Operator | `2 m` today | `2 deg` today | Kind of special case |
| --- | --- | --- | --- |
| `AlgebraicGenerator` | Error("invalid-algebraic-generator") | Error("invalid-algebraic-generator") | held operands (lazy operator) |
| `Arccos` | unchanged | folded: arccos(1/90 * pi) | angle fold at canonicalization |
| `Arccot` | unchanged | folded: arccot(1/90 * pi) | angle fold at canonicalization |
| `Arccsc` | unchanged | folded: arccsc(1/90 * pi) | angle fold at canonicalization |
| `Arcosh` | unchanged | folded: arcosh(1/90 * pi) | angle fold at canonicalization |
| `Arcoth` | unchanged | folded: arcoth(1/90 * pi) | angle fold at canonicalization |
| `Arcsch` | unchanged | folded: arcsch(1/90 * pi) | angle fold at canonicalization |
| `Arcsec` | unchanged | folded: arcsec(1/90 * pi) | angle fold at canonicalization |
| `Arcsin` | unchanged | folded: arcsin(1/90 * pi) | angle fold at canonicalization |
| `Arsech` | unchanged | folded: arsech(1/90 * pi) | angle fold at canonicalization |
| `Arsinh` | unchanged | folded: arsinh(1/90 * pi) | angle fold at canonicalization |
| `Artanh` | unchanged | folded: artanh(1/90 * pi) | angle fold at canonicalization |
| `Binomial` | (2 m * (2 m - 1) * (2 m - 2)) / 6 | (2 deg * (2 deg - 1) * (2 deg - 2)) / 6 | arithmetic in the handler or the canonical form |
| `Choose` | (2 m * (2 m - 1) * (2 m - 2)) / 6 | (2 deg * (2 deg - 1) * (2 deg - 2)) / 6 | arithmetic in the handler or the canonical form |
| `Cos` | unchanged | folded: cos(1/90 * pi) | angle fold at canonicalization |
| `Cosh` | unchanged | folded: cosh(1/90 * pi) | angle fold at canonicalization |
| `Cot` | unchanged | folded: cot(1/90 * pi) | angle fold at canonicalization |
| `Coth` | unchanged | folded: coth(1/90 * pi) | angle fold at canonicalization |
| `Csc` | unchanged | folded: csc(1/90 * pi) | angle fold at canonicalization |
| `Csch` | unchanged | folded: csch(1/90 * pi) | angle fold at canonicalization |
| `Degrees` | 1/90 * pi m | 1/90 * pi deg | arithmetic in the handler or the canonical form |
| `Denominator` | "Nothing" | "Nothing" | held operands (lazy operator) |
| `Distance` | Error("incompatible-type") | Error("incompatible-type") | error |
| `Dot` | MatrixMultiply([2 m,2,3], [1,2,3]) | MatrixMultiply([2 deg,2,3], [1,2,3]) | arithmetic in the handler or the canonical form |
| `ElementMax` | unchanged | 3 | comparison |
| `ElementMin` | unchanged | 2 deg | comparison |
| `Haversine` | 1/2 * (1 - cos(2 m)) | 1/2 * (1 - cos(1/90 * pi)) | arithmetic in the handler or the canonical form |
| `HorizontalSpacing` | folded: "Nothing" | folded: "Nothing" | arithmetic in the handler or the canonical form |
| `HurwitzZeta` | -1^(-2 m) - 2^(-2 m) + Zeta(2 m) | -1^(-2 deg) - 2^(-2 deg) + Zeta(2 deg) | arithmetic in the handler or the canonical form |
| `Hypot` | sqrt((2 m)^2 + 9) | sqrt((2 deg)^2 + 9) | arithmetic in the handler or the canonical form |
| `InverseHaversine` | 2arcsin(sqrt(2) sqrt(m)) | 2arcsin(sqrt(2) sqrt(deg)) | arithmetic in the handler or the canonical form |
| `Limit` | 4 m | 4 deg | held operands (lazy operator) |
| `Matrix` | [[2 m,2],[3,4]] | [[2 deg,2],[3,4]] | held operands (lazy operator) |
| `Numerator` | "Nothing" | "Nothing" | held operands (lazy operator) |
| `NumeratorDenominator` | ("Nothing", "Nothing") | ("Nothing", "Nothing") | held operands (lazy operator) |
| `Pochhammer` | 2 m * (2 m + 1) * (2 m + 2) | 2 deg * (2 deg + 1) * (2 deg + 2) | arithmetic in the handler or the canonical form |
| `PreDecrement` | 2 m - 1 | 2 deg - 1 | arithmetic in the handler or the canonical form |
| `PreIncrement` | 2 m + 1 | 2 deg + 1 | arithmetic in the handler or the canonical form |
| `Random` | (a random value) | (a random value) | arithmetic in the handler or the canonical form |
| `Sec` | unchanged | folded: sec(1/90 * pi) | angle fold at canonicalization |
| `Sech` | unchanged | folded: sech(1/90 * pi) | angle fold at canonicalization |
| `Sin` | unchanged | folded: sin(1/90 * pi) | angle fold at canonicalization |
| `Sinh` | unchanged | folded: sinh(1/90 * pi) | angle fold at canonicalization |
| `Tan` | unchanged | folded: tan(1/90 * pi) | angle fold at canonicalization |
| `Tanh` | unchanged | folded: tanh(1/90 * pi) | angle fold at canonicalization |

Quantity `2 m` admitted at boxing today at 197 of the 215 probed operators (a quantity is typed `value`, which the numeric parameters accept).

#### 2e. Phase-1 admission gaps

The calls that admit a measurement today and that the phase-1 admission refuses for the model kind (`admittedAs: 'number'`), although the parameter admits `real` (plan 4.2, group 3). Each one would be refused at boxing after phase 2.

| Operator | Signature | Refusal of the model kind | `evaluate()` today |
| --- | --- | --- | --- |
| `AdjugateMatrix` | `(matrix) -> matrix` | expected `matrix`, got `list<list<integer | umeasurement>>` | [[4,-2],[-3,2.50 ± 0.10]] |
| `BaseForm` | `(T, (number \| string)?) -> T where T: number` | expected `number`, got `umeasurement` | 2.50 ± 0.10 |
| `CharacteristicPolynomial` | `(matrix, any?) -> expression` | expected `matrix`, got `list<list<integer | umeasurement>>` | x^2 - 6.5 * x + 4 ± \|sqrt(0.01 * \|sqrt(x^2)\|^2 + 0.… |
| `CholeskyDecomposition` | `(matrix) -> matrix` | expected `matrix`, got `list<list<integer | umeasurement>>` | unchanged |
| `Chop` | `(T) -> T where T: number` | expected `number`, got `umeasurement` | unchanged |
| `Conjugate` | `(T) -> T where T: number` | expected `number`, got `umeasurement` | 2.50 ± 0.10 |
| `Det` | `(matrix) -> number` | expected `matrix`, got `list<list<integer | umeasurement>>` | 4.00 ± 0.40 |
| `Determinant` | `(matrix) -> number` | expected `matrix`, got `list<list<integer | umeasurement>>` | 4.00 ± 0.40 |
| `Eigen` | `(matrix) -> tuple` | expected `matrix`, got `list<list<integer | umeasurement>>` | ([5.812 ± 0.068,0.688 ± 0.068], [[0.5169562813224354,0… |
| `Eigenvalues` | `(matrix) -> list` | expected `matrix`, got `list<list<integer | umeasurement>>` | [5.812 ± 0.068,0.688 ± 0.068] |
| `Eigenvectors` | `(matrix) -> list` | expected `matrix`, got `list<list<integer | umeasurement>>` | [[0.5169562813224354,0.8560118008539828],[-0.741127495… |
| `Exp2` | `(number) -> number` | expected `number`, got `umeasurement` | 5.66 ± 0.39 |
| `Inverse` | `(matrix) -> matrix` | expected `matrix`, got `list<list<integer | umeasurement>>` | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 + 2 * 2.50 ± 0.1… |
| `LinearSolve` | `(matrix, matrix \| vector) -> value` | expected `matrix`, got `list<list<integer | umeasurement>>` | Error("incompatible-dimensions", "2 vs 3") |
| `LUDecomposition` | `(matrix) -> tuple` | expected `matrix`, got `list<list<integer | umeasurement>>` | unchanged |
| `ND` | `(function, at: number) -> list<number> \| number \| tuple` | expected `number`, got `umeasurement` | 1.9999999999999987 |
| `NIntegrate` | `(function, lower: number, upper: number) -> number` | expected `number`, got `umeasurement` | 2.75 |
| `PseudoInverse` | `(matrix) -> matrix` | expected `matrix`, got `list<list<integer | umeasurement>>` | [[2 / (-3 + 2 * 2.50 ± 0.10),-1 / (-3 + 2 * 2.50 ± 0.1… |
| `QRDecomposition` | `(matrix) -> tuple` | expected `matrix`, got `list<list<integer | umeasurement>>` | unchanged |
| `Rational` | `((integer, integer) -> rational) \| ((real) -> rational)` | expected `real`, got `umeasurement` | unchanged |
| `Remainder` | `(T, T) -> T where T: number` | expected `number`, got `umeasurement` | unchanged |
| `RowReduce` | `(matrix) -> matrix` | expected `matrix`, got `list<list<integer | umeasurement>>` | [[1,0],[0,1]] |
| `SingularValues` | `(matrix) -> list` | expected `matrix`, got `list<list<integer | umeasurement>>` | unchanged |
| `SVD` | `(matrix) -> tuple` | expected `matrix`, got `list<list<integer | umeasurement>>` | unchanged |

#### 2f. Summary of Part 2

| Class (real measurement) | Count | Operators |
| --- | --- | --- |
| decided by the plan | 101 | `Abs`, `AiryAi`, `AiryAiPrime`, `AiryBi`, `AiryBiPrime`, `AlgebraicGenerator`, `Arccot`, `Arccsc`, `Arcosh`, `Arcoth`, `Arcsch`, `Arcsec`, `Arctan`, `Arctan2`, `Arsinh`, `Assign`, `CircleContour`, `Clamp`, `Closed`, `Complex`, `Cos`, `Cosh`, `CoshIntegral`, `CosIntegral`, `Cot`, `Coth`, `Csc`, `Csch`, `Denominator`, `Digamma`, `Divide`, `Drop`, `Erf`, `Erfc`, `Erfi`, `Exp`, `ExpIntegralEi`, `Factorial`, `Fract`, `FresnelC`, `FresnelS`, `Gamma`, `GammaLn`, `HorizontalSpacing`, `Hsl`, `Hsv`, `Im`, `Imaginary`, `Interval`, `LambertW`, `Lb`, `Lg`, `Limit`, `Linspace`, `Ln`, `Log`, `Log10`, `Log2`, `LogGamma`, `LogIntegral`, `Matrix`, `Mean`, `Median`, `Multiply`, `Negate`, `NLimit`, `NormalDistribution`, `Numerator`, `NumeratorDenominator`, `Oklab`, `Oklch`, `Open`, `PolygonContour`, `PopulationStandardDeviation`, `PopulationVariance`, `Power`, `Random`, `Range`, `Re`, `Real`, `RectangleContour`, `Rgb`, `Root`, `Sec`, `Sech`, `Sin`, `Sinh`, `SinhIntegral`, `SinIntegral`, `Slice`, `Sqrt`, `Square`, `StandardDeviation`, `Subtract`, `Take`, `Tan`, `Tanh`, `Trigamma`, `UniformDistribution`, `Variance`, `WithRandomSeed` |
| DECISION (admission-gap) | 24 | `AdjugateMatrix`, `BaseForm`, `CharacteristicPolynomial`, `CholeskyDecomposition`, `Chop`, `Conjugate`, `Det`, `Determinant`, `Eigen`, `Eigenvalues`, `Eigenvectors`, `Exp2`, `Inverse`, `LinearSolve`, `LUDecomposition`, `ND`, `NIntegrate`, `PseudoInverse`, `QRDecomposition`, `Rational`, `Remainder`, `RowReduce`, `SingularValues`, `SVD` |
| DECISION (element-extremum) | 2 | `ElementMax`, `ElementMin` |
| DECISION (non-real) | 4 | `Arccos`, `Arcsin`, `Arsech`, `Artanh` |
| DECISION (unit-slope) | 1 | `Mod` |
| DECISION (zero-slope) | 7 | `Ceil`, `Floor`, `Heaviside`, `PrimePi`, `Round`, `Sign`, `Truncate` |
| REGRESSION: today computes a value, `apply` would not know the operator | 21 | `Arg`, `Argument`, `Binomial`, `Choose`, `ComplexRoots`, `ContinuedFraction`, `Cross`, `Degrees`, `Distance`, `Dot`, `HadamardProduct`, `Haversine`, `HurwitzZeta`, `Hypot`, `InverseHaversine`, `MatrixMultiply`, `Norm`, `Pochhammer`, `PreDecrement`, `PreIncrement`, `Trace` |
| unevaluated today and after (or an error today) | 55 | `AbsArg`, `AGM`, `AppellF1`, `At`, `BarnesG`, `BesselI`, `BesselJ`, `BesselK`, `BesselY`, `Beta`, `BetaRegularized`, `BinCounts`, `ClausenCl`, `Congruent`, `Correlation`, `Covariance`, `DedekindEta`, `DirichletBeta`, `DirichletEta`, `DirichletL`, `DMS`, `EisensteinE`, `EllipticE`, `EllipticF`, `EllipticK`, `EllipticPi`, `ErfInv`, `Factorial2`, `GammaRegularized`, `Histogram`, `Hypergeometric1F1`, `Hypergeometric2F1`, `InterquartileRange`, `IsComposite`, `IsEven`, `IsOdd`, `IsPrime`, `JacobiTheta`, `Julia`, `Kurtosis`, `LerchPhi`, `LogBarnesG`, `Mandelbrot`, `MatrixPower`, `Mode`, `PolyGamma`, `PolyLog`, `PopulationCovariance`, `Quartiles`, `RandomChoice`, `RandomSample`, `Rationalize`, `Sinc`, `Skewness`, `Zeta` |

| Class (complex measurement) | Count | Operators |
| --- | --- | --- |
| DECISION (complex-nominal) | 45 | `AiryAi`, `AiryAiPrime`, `AiryBi`, `AiryBiPrime`, `Arccos`, `Arccot`, `Arccsc`, `Arcosh`, `Arcoth`, `Arcsch`, `Arcsec`, `Arcsin`, `Arctan`, `Arsech`, `Arsinh`, `Artanh`, `Cos`, `Cosh`, `CoshIntegral`, `CosIntegral`, `Cot`, `Coth`, `Csc`, `Csch`, `Digamma`, `Erf`, `Erfc`, `Erfi`, `ExpIntegralEi`, `Factorial`, `FresnelC`, `FresnelS`, `Gamma`, `GammaLn`, `LambertW`, `LogGamma`, `Sec`, `Sech`, `Sin`, `Sinh`, `SinhIntegral`, `SinIntegral`, `Tan`, `Tanh`, `Trigamma` |
| DECISION (element-extremum) | 2 | `ElementMax`, `ElementMin` |
| DECISION (edge) | 1 | `LogIntegral` |
| DECISION (zero-slope) | 1 | `Sign` |
| `incompatible-type` at evaluation (decision D), admitted at boxing today | 18 | `Arctan2`, `Ceil`, `ClausenCl`, `ContinuedFraction`, `Degrees`, `Floor`, `Fract`, `Haversine`, `Heaviside`, `Hypot`, `InverseHaversine`, `MatrixPower`, `Mod`, `PrimePi`, `Rational`, `Rationalize`, `Round`, `Truncate` |

### Part 3. The parameters that refuse a measurement after phase 2

Every parameter that admits `real` in no arm (and is not `value`, `any`, `expression`, `unknown`), probed with a measurement whose nominal fits it (`Measurement(5, 0.1)` is typed `integer` today). Rows: 108 parameters of 86 operators that admit the measurement today. "Model" is the same probe with `UserMeasurement`: "refused" is the phase-2 answer.

| Operator | Param | Probe | Type today | `evaluate()` today | Model |
| --- | --- | --- | --- | --- | --- |
| `BellNumber` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `BernoulliB` | 0: `integer` | 5.00 ± 0.10 | rational | unchanged | refused |
| `BinomialDistribution` | 0: `integer<0..>` | 5.00 ± 0.10 | expression<BinomialDistr… | unchanged | refused |
| `BinomialDistribution` | 1: `real<0..1>` | 1.00 ± 0.10 | expression<BinomialDistr… | unchanged | refused |
| `CarmichaelLambda` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `CatalanNumber` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Chunk` | 1: `integer` | 5.00 ± 0.10 | list<string> | unchanged | refused |
| `ClausenCl` | 0: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `Combinations` | 1: `integer` | 5.00 ± 0.10 | list<string> | unchanged | refused |
| `ComplexRoots` | 1: `integer` | 5.00 ± 0.10 | list<number> | [root(5)(3),1/4 * (-1 + sqrt(5)) * root(5)(3) + sqrt(2… | refused |
| `DeleteAt` | 1: `integer` | 5.00 ± 0.10 | string | unchanged | refused |
| `DigitCount` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `DigitSum` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `DirichletCharacter` | 0: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `DirichletCharacter` | 1: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `DirichletCharacter` | 2: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `DirichletL` | 0: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `DirichletL` | 1: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `Divides` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `Divides` | 1: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `Divisors` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `DivisorSigma` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `DivisorSigma` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Eulerian` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Eulerian` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `EulerPhi` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `ExponentialDistribution` | 0: `real<0<..>` | 5.00 ± 0.10 | expression<ExponentialDi… | unchanged | refused |
| `ExtendedGCD` | 0: `integer` | 5.00 ± 0.10 | tuple<integer, integer, … | unchanged | refused |
| `ExtendedGCD` | 1: `integer` | 5.00 ± 0.10 | tuple<integer, integer, … | unchanged | refused |
| `FactorInteger` | 0: `integer` | 5.00 ± 0.10 | list<tuple<integer, inte… | unchanged | refused |
| `Fibonacci` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `IdentityMatrix` | 0: `integer` | 5.00 ± 0.10 | matrix | unchanged | refused |
| `Insert` | 1: `integer` | 5.00 ± 0.10 | list<character \| intege… | unchanged | refused |
| `IntegerDigits` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `IntegerSqrt` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `IntegerString` | 0: `integer` | 5.00 ± 0.10 | string | "5" | refused |
| `IsAbundant` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsCenteredSquare` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsHappy` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsOctahedral` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsPerfect` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsPerfectPower` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsSquare` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsSquareFree` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `IsTriangular` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `JacobiSymbol` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `JacobiSymbol` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Julia` | 2: `integer` | 5.00 ± 0.10 | real | unchanged | refused |
| `LegendreSymbol` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `LegendreSymbol` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Lucas` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `LucasL` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Mandelbrot` | 1: `integer` | 5.00 ± 0.10 | real | unchanged | refused |
| `ModularInverse` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `ModularInverse` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `MoebiusMu` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Multinomial` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Multinomial` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `MultiplicativeOrder` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `MultiplicativeOrder` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `NextPrime` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `NormalDistribution` | 1: `real<0<..>` | 5.00 ± 0.10 | expression<NormalDistrib… | unchanged | refused |
| `NotDivides` | 0: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `NotDivides` | 1: `integer` | 5.00 ± 0.10 | boolean | unchanged | refused |
| `NPartition` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `NthPrime` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `OnesMatrix` | 0: `integer` | 5.00 ± 0.10 | matrix | unchanged | refused |
| `PadEnd` | 1: `integer` | 5.00 ± 0.10 | string | Error("unexpected-argument", "PadEnd: n must be a non-… | refused |
| `PadStart` | 1: `integer` | 5.00 ± 0.10 | string | Error("unexpected-argument", "PadStart: n must be a no… | refused |
| `Partition` | 1: `((any) any -> boolean) \| integer` | 5.00 ± 0.10 | list<string> | unchanged | refused |
| `PartitionsP` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PoissonDistribution` | 0: `real<0<..>` | 5.00 ± 0.10 | expression<PoissonDistri… | unchanged | refused |
| `PolyGamma` | 0: `integer` | 5.00 ± 0.10 | real | unchanged | refused |
| `PowerMod` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PowerMod` | 1: `rational` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PowerMod` | 2: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PowerModList` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `PowerModList` | 1: `rational` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `PowerModList` | 2: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `PrimeFactors` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `PrimeNu` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PrimeNumber` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PrimeOmega` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PrimitiveRoot` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `PrimitiveRootList` | 0: `integer` | 5.00 ± 0.10 | list<integer> | unchanged | refused |
| `Quantile` | 1: `real<0..1>` | 1.00 ± 0.10 | nan \| real \| signed_in… | unchanged | refused |
| `Radical` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `RandomPrime` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `RationalReconstruction` | 0: `integer` | 5.00 ± 0.10 | rational | unchanged | refused |
| `RationalReconstruction` | 1: `integer` | 5.00 ± 0.10 | rational | unchanged | refused |
| `ReplaceAt` | 1: `integer` | 5.00 ± 0.10 | list<character \| intege… | unchanged | refused |
| `Sigma0` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Sigma1` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `SigmaMinus1` | 0: `integer` | 5.00 ± 0.10 | rational | unchanged | refused |
| `SlidingWindow` | 1: `integer` | 5.00 ± 0.10 | list<string> | unchanged | refused |
| `StieltjesGamma` | 0: `integer` | 5.00 ± 0.10 | number | unchanged | refused |
| `Stirling` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Stirling` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `StirlingS1` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `StirlingS1` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `StirlingS2` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `StirlingS2` | 1: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `StringRepeat` | 1: `integer` | 5.00 ± 0.10 | string | Error("unexpected-argument", "StringRepeat: n must be … | refused |
| `Subfactorial` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `Table` | 1: `integer` | 5.00 ± 0.10 | list<number> | unchanged | refused |
| `Tabulate` | 1: `integer` | 5.00 ± 0.10 | list<number> | unchanged | refused |
| `Totient` | 0: `integer` | 5.00 ± 0.10 | integer | unchanged | refused |
| `ZeroMatrix` | 0: `integer` | 5.00 ± 0.10 | matrix | unchanged | refused |

Of these, 2 compute a value today (the others stay unchanged or answer an error): `ComplexRoots`, `IntegerString`.

### Part 4. The snapshot risk

The repository keeps most snapshots INLINE (`toMatchInlineSnapshot`), so the risk is in the test files themselves; the `.snap` files hold none of the two heads.

| Count | Value |
| --- | --- |
| `test/compute-engine/*.test.ts` files that name `Measurement` or `Quantity` | 36 |
| All `.test.ts` files under `test/` that name them | 43 (all `.ts` files: 44) |
| `.snap` files in the repository / those that name a head | 4 / 0 |
| Occurrences of the two names in `test/compute-engine/*.test.ts` | 1146 |
| Type reads (`.type.toString()`, `.type.matches(`) in those files | 147 |
| Inline snapshots in those files | 369 |
| `.re`/`.im` reads in those files | 544 |
| Files under `src/epsil`, `doc/` and `docs/TYPE-SYSTEM.md` that name them | 7 |

Per file (a type read or an inline snapshot in a file that names a head is a candidate change; not every one is on a measurement or a quantity):

| File | Occurrences of a head | Type reads | Inline snapshots | `.re`/`.im` reads |
| --- | --- | --- | --- | --- |
| `test/compute-engine/units.test.ts` | 332 | 0 | 0 | 82 |
| `test/compute-engine/measurement.test.ts` | 162 | 2 | 0 | 43 |
| `test/compute-engine/quantity-exact-magnitude.test.ts` | 86 | 0 | 0 | 2 |
| `test/compute-engine/unit-arithmetic-no-renaming.test.ts` | 80 | 0 | 0 | 3 |
| `test/compute-engine/quantity-equality-methods.test.ts` | 77 | 0 | 0 | 0 |
| `test/compute-engine/measurement-operators.test.ts` | 52 | 0 | 0 | 20 |
| `test/compute-engine/temperature-sum-kelvin.test.ts` | 49 | 0 | 0 | 2 |
| `test/compute-engine/batch9-misc.test.ts` | 45 | 0 | 0 | 0 |
| `test/compute-engine/unit-canonical-form.test.ts` | 39 | 0 | 0 | 1 |
| `test/compute-engine/quantity-siunitx-exact-magnitude.test.ts` | 39 | 0 | 0 | 0 |
| `test/compute-engine/units-in-text.test.ts` | 21 | 0 | 0 | 0 |
| `test/compute-engine/library-bootstrap-no-leaked-symbols.test.ts` | 20 | 0 | 0 | 0 |
| `test/compute-engine/misc-batch8.test.ts` | 17 | 0 | 0 | 4 |
| `test/compute-engine/evaluate-async-evaluates-operands.test.ts` | 16 | 0 | 0 | 3 |
| `test/compute-engine/siunitx-dot-separator.test.ts` | 16 | 0 | 0 | 0 |
| `test/compute-engine/compile-integrate.test.ts` | 12 | 0 | 0 | 16 |
| `test/compute-engine/value-kinds-comparison-apply.test.ts` | 10 | 13 | 0 | 4 |
| `test/compute-engine/value-kinds-acceptance.test.ts` | 10 | 17 | 0 | 4 |
| `test/compute-engine/latex-syntax/serialize-dms.test.ts` | 10 | 0 | 0 | 3 |
| `test/compute-engine/core.test.ts` | 9 | 0 | 1 | 33 |
| `test/compute-engine/calculus.test.ts` | 9 | 4 | 161 | 86 |
| `test/compute-engine/quadrature-endpoint-singularity.test.ts` | 7 | 0 | 0 | 31 |
| `test/compute-engine/latex-syntax/parse-dms.test.ts` | 7 | 0 | 0 | 4 |
| `test/compute-engine/error-model.test.ts` | 6 | 72 | 0 | 27 |
| `test/compute-engine/value-kinds-admission.test.ts` | 6 | 7 | 0 | 0 |
| `test/compute-engine/tycho-325-integrate-list-limit-broadcast.test.ts` | 5 | 6 | 0 | 10 |
| `test/compute-engine/latex-syntax/quantity-constant-magnitude.test.ts` | 5 | 0 | 0 | 0 |
| `test/compute-engine/search-definitions.test.ts` | 3 | 0 | 0 | 0 |
| `test/compute-engine/value-kinds-compile.test.ts` | 2 | 0 | 0 | 3 |
| `test/compute-engine/quantity-compare-exact-value.test.ts` | 2 | 0 | 0 | 0 |
| `test/compute-engine/integrate-interpreted-quadrature.test.ts` | 2 | 0 | 0 | 12 |
| `test/compute-engine/value-kinds-arithmetic.test.ts` | 2 | 11 | 0 | 4 |
| `test/compute-engine/correctness-p2-roundtrips.test.ts` | 2 | 0 | 0 | 2 |
| `test/compute-engine/nintegrate-quadrature.test.ts` | 2 | 0 | 0 | 21 |
| `test/compute-engine/compile.test.ts` | 2 | 13 | 34 | 58 |
| `test/compute-engine/latex-syntax/lenient-ambiguity-c.test.ts` | 2 | 0 | 0 | 0 |
| `test/epsil/programs.test.ts` | 2 | 0 | 0 | 7 |
| `test/compute-engine/a6-polish.test.ts` | 1 | 2 | 0 | 0 |
| `test/compute-engine/ascii-math.test.ts` | 1 | 0 | 165 | 1 |
| `test/compute-engine/condition-nan-undecided.test.ts` | 1 | 0 | 0 | 54 |
| `test/compute-engine/integrate-divergent-infinite-bound.test.ts` | 1 | 0 | 0 | 0 |
| `test/compute-engine/latex-syntax/parse-where.test.ts` | 1 | 0 | 8 | 4 |
| `test/compute-engine/latex-syntax/structural-spacing.test.ts` | 1 | 0 | 0 | 0 |

### Part 5. Comparisons and extrema

Each pair `(a, b)` in a fresh engine. "Today" is `evaluate()` of the call (and the method result); "planned" follows plan section 4.4 with the `compare` value in the second column (`-1`, `0`, `1`, or none).

| Pair | compare | Operation | Today | Planned | Same |
| --- | --- | --- | --- | --- | --- |
| two measurements | -1 | `Equal` | "False" | False | yes |
| two measurements | -1 | `Less` | "True" | True | yes |
| two measurements | -1 | `LessEqual` | "True" | True | yes |
| two measurements | -1 | `Max` | 3.00 ± 0.20 | 3.00 ± 0.20 | yes |
| two measurements | -1 | `Min` | 2.00 ± 0.10 | 2.00 ± 0.10 | yes |
| two measurements | -1 | `Sort` | [2.00 ± 0.10,3.00 ± 0.20] | [2.00 ± 0.10, 3.00 ± 0.20] | yes |
| two measurements | -1 | `isEqual` | undefined | false | **no** |
| two measurements | -1 | `isLess` | undefined | true | **no** |
| two measurements | -1 | `is` | false | false | yes |
| measurement, number | -1 | `Equal` | "False" | False | yes |
| measurement, number | -1 | `Less` | "True" | True | yes |
| measurement, number | -1 | `LessEqual` | "True" | True | yes |
| measurement, number | -1 | `Max` | 3 | 3 | yes |
| measurement, number | -1 | `Min` | 2.00 ± 0.10 | 2.00 ± 0.10 | yes |
| measurement, number | -1 | `Sort` | [2.00 ± 0.10,3] | [2.00 ± 0.10, 3] | yes |
| measurement, number | -1 | `isEqual` | undefined | false | **no** |
| measurement, number | -1 | `isLess` | undefined | true | **no** |
| measurement, number | -1 | `is` | false | false | yes |
| measurement = its nominal | 0 | `Equal` | "True" | True | yes |
| measurement = its nominal | 0 | `Less` | "False" | False | yes |
| measurement = its nominal | 0 | `LessEqual` | "True" | True | yes |
| measurement = its nominal | 0 | `Max` | 2 | 2.00 ± 0.10 | **no** |
| measurement = its nominal | 0 | `Min` | 2 | 2.00 ± 0.10 | **no** |
| measurement = its nominal | 0 | `Sort` | [2.00 ± 0.10,2] | [2.00 ± 0.10, 2] | yes |
| measurement = its nominal | 0 | `isEqual` | undefined | true | **no** |
| measurement = its nominal | 0 | `isLess` | undefined | false | **no** |
| measurement = its nominal | 0 | `is` | false | true | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `Equal` | "True" | True | yes |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `Less` | "False" | False | yes |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `LessEqual` | "True" | True | yes |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `Max` | unevaluated: max(1.00 ± 0.10, 1.00 ± 0.50) | 1.00 ± 0.10 | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `Min` | unevaluated: min(1.00 ± 0.10, 1.00 ± 0.50) | 1.00 ± 0.10 | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `Sort` | unevaluated: Sort([1.00 ± 0.10,1.00 ± 0.50]) | [1.00 ± 0.10, 1.00 ± 0.50] | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `isEqual` | undefined | true | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `isLess` | undefined | false | **no** |
| equal nominals, other σ (section 6: `Max` is the first) | 0 | `is` | false | true | **no** |
| equal nominals, other σ, reversed | 0 | `Equal` | "True" | True | yes |
| equal nominals, other σ, reversed | 0 | `Less` | "False" | False | yes |
| equal nominals, other σ, reversed | 0 | `LessEqual` | "True" | True | yes |
| equal nominals, other σ, reversed | 0 | `Max` | unevaluated: max(1.00 ± 0.50, 1.00 ± 0.10) | 1.00 ± 0.50 | **no** |
| equal nominals, other σ, reversed | 0 | `Min` | unevaluated: min(1.00 ± 0.50, 1.00 ± 0.10) | 1.00 ± 0.50 | **no** |
| equal nominals, other σ, reversed | 0 | `Sort` | unevaluated: Sort([1.00 ± 0.50,1.00 ± 0.10]) | [1.00 ± 0.50, 1.00 ± 0.10] | **no** |
| equal nominals, other σ, reversed | 0 | `isEqual` | undefined | true | **no** |
| equal nominals, other σ, reversed | 0 | `isLess` | undefined | false | **no** |
| equal nominals, other σ, reversed | 0 | `is` | false | true | **no** |
| float nominals within tolerance | 0 | `Equal` | "True" | True | yes |
| float nominals within tolerance | 0 | `Less` | "False" | False | yes |
| float nominals within tolerance | 0 | `LessEqual` | "True" | True | yes |
| float nominals within tolerance | 0 | `Max` | 1.00 ± 0.10 | 1.00 ± 0.10 | yes |
| float nominals within tolerance | 0 | `Min` | 1.00 ± 0.10 | 1.00 ± 0.10 | yes |
| float nominals within tolerance | 0 | `Sort` | [1.00 ± 0.10,1.00 ± 0.10] | [1.00 ± 0.10, 1.00 ± 0.10] | yes |
| float nominals within tolerance | 0 | `isEqual` | undefined | true | **no** |
| float nominals within tolerance | 0 | `isLess` | undefined | false | **no** |
| float nominals within tolerance | 0 | `is` | false | true | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `Equal` | "False" | False | yes |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `Less` | "False" | unevaluated | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `LessEqual` | "False" | unevaluated | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `Max` | max(3, (2 + 3i) ± 0.1) | unevaluated | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `Min` | min(3, (2 + 3i) ± 0.1) | unevaluated | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `Sort` | unevaluated: Sort([(2 + 3i) ± 0.1,3]) | unevaluated | yes |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `isEqual` | undefined | false | **no** |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `isLess` | undefined | undefined | yes |
| complex measurement, number (a complex nominal has no order; `Equal` by the disjoint-type rule) | — | `is` | false | false | yes |
| quantities, one dimension | -1 | `Equal` | "False" | False | yes |
| quantities, one dimension | -1 | `Less` | "True" | True | yes |
| quantities, one dimension | -1 | `LessEqual` | "True" | True | yes |
| quantities, one dimension | -1 | `Max` | 300 cm | 300 cm | yes |
| quantities, one dimension | -1 | `Min` | 2 m | 2 m | yes |
| quantities, one dimension | -1 | `Sort` | [2 m,300 cm] | [2 m, 300 cm] | yes |
| quantities, one dimension | -1 | `isEqual` | false | false | yes |
| quantities, one dimension | -1 | `isLess` | true | true | yes |
| quantities, one dimension | -1 | `is` | false | false | yes |
| quantities, equal after conversion | 0 | `Equal` | "True" | True | yes |
| quantities, equal after conversion | 0 | `Less` | "False" | False | yes |
| quantities, equal after conversion | 0 | `LessEqual` | "True" | True | yes |
| quantities, equal after conversion | 0 | `Max` | 2 m | 2 m | yes |
| quantities, equal after conversion | 0 | `Min` | 2 m | 2 m | yes |
| quantities, equal after conversion | 0 | `Sort` | [2 m,200 cm] | [2 m, 200 cm] | yes |
| quantities, equal after conversion | 0 | `isEqual` | true | true | yes |
| quantities, equal after conversion | 0 | `isLess` | false | false | yes |
| quantities, equal after conversion | 0 | `is` | true | true | yes |
| quantities, two dimensions | — | `Equal` | "False" | False | yes |
| quantities, two dimensions | — | `Less` | unevaluated: 2 m < 2 s | unevaluated | yes |
| quantities, two dimensions | — | `LessEqual` | unevaluated: 2 m <= 2 s | unevaluated | yes |
| quantities, two dimensions | — | `Max` | unevaluated: max(2 m, 2 s) | unevaluated | yes |
| quantities, two dimensions | — | `Min` | unevaluated: min(2 m, 2 s) | unevaluated | yes |
| quantities, two dimensions | — | `Sort` | unevaluated: Sort([2 m,2 s]) | unevaluated | yes |
| quantities, two dimensions | — | `isEqual` | false | false | yes |
| quantities, two dimensions | — | `isLess` | undefined | undefined | yes |
| quantities, two dimensions | — | `is` | false | false | yes |
| quantity, number | — | `Equal` | "False" | False | yes |
| quantity, number | — | `Less` | unevaluated: 2 m < 2 | unevaluated | yes |
| quantity, number | — | `LessEqual` | unevaluated: 2 m <= 2 | unevaluated | yes |
| quantity, number | — | `Max` | unevaluated: max(2 m, 2) | unevaluated | yes |
| quantity, number | — | `Min` | unevaluated: min(2 m, 2) | unevaluated | yes |
| quantity, number | — | `Sort` | unevaluated: Sort([2 m,2]) | unevaluated | yes |
| quantity, number | — | `isEqual` | false | false | yes |
| quantity, number | — | `isLess` | undefined | undefined | yes |
| quantity, number | — | `is` | false | false | yes |
| dimensionless quantity, number | -1 | `Equal` | "False" | False | yes |
| dimensionless quantity, number | -1 | `Less` | "True" | True | yes |
| dimensionless quantity, number | -1 | `LessEqual` | "True" | True | yes |
| dimensionless quantity, number | -1 | `Max` | 0.07 | 0.07 | yes |
| dimensionless quantity, number | -1 | `Min` | 6 percent | 6 percent | yes |
| dimensionless quantity, number | -1 | `Sort` | [6 percent,0.07] | [6 percent, 0.07] | yes |
| dimensionless quantity, number | -1 | `isEqual` | false | false | yes |
| dimensionless quantity, number | -1 | `isLess` | true | true | yes |
| dimensionless quantity, number | -1 | `is` | false | false | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `Equal` | "True" | True | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `Less` | "False" | False | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `LessEqual` | "True" | True | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `Max` | 1.000000000001 m | 1 m | **no** |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `Min` | 1 m | 1 m | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `Sort` | [1 m,1.000000000001 m] | [1 m, 1.000000000001 m] | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `isEqual` | true | true | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `isLess` | false | false | yes |
| quantities closer than the tolerance (section 6: the extrema use the engine tolerance) | 0 | `is` | true | true | yes |
| quantities closer than the tolerance, two units | 0 | `Equal` | "False" | True | **no** |
| quantities closer than the tolerance, two units | 0 | `Less` | "True" | False | **no** |
| quantities closer than the tolerance, two units | 0 | `LessEqual` | "True" | True | yes |
| quantities closer than the tolerance, two units | 0 | `Max` | 100.0000000001 cm | 1 m | **no** |
| quantities closer than the tolerance, two units | 0 | `Min` | 1 m | 1 m | yes |
| quantities closer than the tolerance, two units | 0 | `Sort` | [1 m,100.0000000001 cm] | [1 m, 100.0000000001 cm] | yes |
| quantities closer than the tolerance, two units | 0 | `isEqual` | false | true | **no** |
| quantities closer than the tolerance, two units | 0 | `isLess` | true | false | **no** |
| quantities closer than the tolerance, two units | 0 | `is` | false | true | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `Equal` | "True" | True | yes |
| quantities with measurement magnitudes, equal nominals | 0 | `Less` | "False" | False | yes |
| quantities with measurement magnitudes, equal nominals | 0 | `LessEqual` | "True" | True | yes |
| quantities with measurement magnitudes, equal nominals | 0 | `Max` | unevaluated: max((1.00 ± 0.10) m, (1.00 ± 0.50) m) | (1.00 ± 0.10) m | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `Min` | unevaluated: min((1.00 ± 0.10) m, (1.00 ± 0.50) m) | (1.00 ± 0.10) m | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `Sort` | unevaluated: Sort([(1.00 ± 0.10) m,(1.00 ± 0.50) m]) | [(1.00 ± 0.10) m, (1.00 ± 0.50) m] | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `isEqual` | undefined | true | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `isLess` | undefined | false | **no** |
| quantities with measurement magnitudes, equal nominals | 0 | `is` | false | true | **no** |
| measurement, quantity (two kinds: neither compares) | — | `Equal` | "False" | False | yes |
| measurement, quantity (two kinds: neither compares) | — | `Less` | 2 < 2 m | unevaluated | **no** |
| measurement, quantity (two kinds: neither compares) | — | `LessEqual` | 2 <= 2 m | unevaluated | **no** |
| measurement, quantity (two kinds: neither compares) | — | `Max` | unevaluated: max(2.00 ± 0.10, 2 m) | unevaluated | yes |
| measurement, quantity (two kinds: neither compares) | — | `Min` | unevaluated: min(2.00 ± 0.10, 2 m) | unevaluated | yes |
| measurement, quantity (two kinds: neither compares) | — | `Sort` | unevaluated: Sort([2.00 ± 0.10,2 m]) | unevaluated | yes |
| measurement, quantity (two kinds: neither compares) | — | `isEqual` | undefined | false | **no** |
| measurement, quantity (two kinds: neither compares) | — | `isLess` | undefined | undefined | yes |
| measurement, quantity (two kinds: neither compares) | — | `is` | false | false | yes |

#### Undecided comparisons

A comparison that stays unevaluated must keep its operands. Today the relational operators replace a measurement by its nominal before they decide (`evaluateChainOperands()` in `library/relational-operator.ts`), and an undecided result keeps the bare nominal.

| Call | Today (MathJSON of `evaluate()`) | Planned |
| --- | --- | --- |
| `["Less",["Measurement",2,0.1],"x"]` | `["Less",2,"x"]` | unevaluated, the measurement kept (a wrong value today: the uncertainty is lost) |
| `["Equal",["Measurement",2,0.1],"x"]` | `["Equal",2,"x"]` | unevaluated, the measurement kept (a wrong value today: the uncertainty is lost) |
| `["Less",["Measurement",2,0.1],["Quantity",2,"m"]]` | `["Less",2,["Quantity",2,"m"]]` | unevaluated, the measurement kept (a wrong value today: the uncertainty is lost) |

#### Clamp

| Call | Today | Planned |
| --- | --- | --- |
| `["Clamp",["Measurement",5,0.1],0,3]` | 3 (type integer<0..3>) | 3 (the bound as written, 4.4) |
| `["Clamp",["Measurement",2,0.1],0,3]` | 2.00 ± 0.10 (type integer<0..3>) | 2 ± 0.1 |
| `["Clamp",["Measurement",3,0.1],0,3]` | 3 (type integer<0..3>) | DECISION: the plan does not say what a tie with a bound returns (`x` or the bound) |
| `["Clamp",["Quantity",5,"m"],["Quantity",0,"m"],["Quantity",3,"m"]]` | 3 m (type value) | 3 m (admitted by the group-1 rule: the quantity kind has `compare`) |
| `["Clamp",["Quantity",5,"m"],0,3]` | Clamp(5 m, 0, 3) (type value) | unevaluated (not comparable) |

