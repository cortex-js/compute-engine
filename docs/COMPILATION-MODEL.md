# Compilation Model

**Status:** normative internal reference for implemented compilation behavior.

## Caveats of compiled code

Compiled code is a fast numeric approximation of the interpreter, not a
second implementation of it. A host that needs the interpreter's exact
result calls the interpreter. The host accepts the differences listed here
when it compiles. A difference that this list does not name is a defect.

**Allowed differences.**

- The precision of the target: `f32` arithmetic on `glsl`, a
  different order of summation, a different library routine for `Sin`,
  `Exp` or `Gamma`.
- A value where the interpreter stops at `ce.iterationLimit`. With no
  `iterationBudget`, a compiled `Loop` counts no passes and gives its value
  where the interpreter throws `iteration-limit-exceeded` (see "A limit on
  `Loop` passes").
- A value where the interpreter gives no number. Where `evaluate()` gives
  `Missing`, `Nothing`, an unevaluated form or an error,
  the compiled code can give `NaN`, `0`, `±Infinity`, `undefined` or
  `null`, can throw, or can decline. With `q` holding `Missing`, `Sqrt(q)`
  can give `0` on `javascript` where the interpreter gives `Missing`.
- **Everything computed from an absent value, except at a discharge.** An
  absent value is specified at three kinds of places only. Its producers: a
  read past the end (`At`, `First`, `Last`), a cell of an element-wise
  `If`, `Which` or `When` that no clause selects, a scalar selection that
  takes no arm, the written symbol `Missing`; the producer gives `NaN` for
  a numeric type, a point whose coordinates are all `NaN` for a point type
  (`At([(1, 2), (3, 4)], 5)` is `(NaN, NaN)` on every route), and the
  target's absent object (`undefined` on `javascript`) otherwise. A declared type cannot name `missing` (user
  decision of 2026-11-02, `docs/ERROR-MODEL.md`, "`Missing` is a result
  only"), so an input is never declared absent. The structure that moves it without computing on it:
  `At`, `First`, `Last`, `Rest`, `Length`, `Reverse`, and the binding of a
  callback parameter by `Map` and its relatives (`Length([1, Missing])` is 2
  on every route). Its discharge: `IsMissing`, `Coalesce` (`??`),
  `AssertPresent` (`?!`), which give the
  interpreter's value for an absent operand of any spelling (`Missing`,
  `NaN`, `undefined`). A parameter default is not a discharge: it
  fills only an argument that the call leaves out (see "Function values").
  The discharges compile on `javascript` (`AssertPresent` of an absent
  value throws an `Error` whose message starts with `expected-present`) and
  on `glsl`, except `AssertPresent` of a value that can be absent, which
  declines there; and on `interval-js`, where the test is a verdict over the
  box: `'maybe'` where the operand is absent over part of it, where
  `Coalesce` gives the hull of its operands, and `AssertPresent` of a value
  absent over the whole box throws, which `run()` answers with `entire`. A
  kernel gives the same `empty` at a pole (`1/x` at the box `[0, 0]`), so
  `empty` is surely absent only for an operand that no kernel makes `empty`
  where the interpreter has a value, and `'maybe'` for another:
  `IsMissing(1/x)` at `[0, 0]` is `'maybe'` (the interpreter gives
  `False`), `Coalesce(1/x, 0)` there is `entire` (the interpreter gives
  `~oo`), `IsMissing(At(L, k) + 1)` out of range is `'true'`. An enclosure
  of NaN is absent (`IsMissing(∞ - ∞)` is `True`), and `entire` can be. In
  `mode: 'bigint'` they decline. A discharge declines when
  its operand is computed on the real lane and its static type admits a
  complex value: `Coalesce(Sqrt(x), 0)` with `x: real` declines, because
  the `NaN` of `Sqrt(-4)` there (the caveat "`NaN` for a complex value on
  the real lane") is the interpreter's `2i`, not an absent value. An input
  is not checked (a `number` input must be real in `strict`). The written
  `Missing` is `NaN`; as a coordinate of a tuple it declines
  (`IsMissing(Tuple(Missing, Missing))` is `False` in the interpreter, and
  a point of `NaN` coordinates is absent). No compiled list is absent, nor
  a boolean on `glsl` (their producers decline): a discharge reads such a
  value as present. The one exception is the row `g[i]` of a
  `list<list<integer>>` or `list<list<real>>` input at an index known at run
  time, whose `Length` is `NaN` out of range, the absent value that the
  discharges test (see "Lists of two run-time lengths"). A colour read out
  of range refuses after the passes, so `IsMissing` of a colour declines,
  while `Coalesce` and `AssertPresent` keep the colour as their value. A
  string read out of range (`At` of a list of strings) is `undefined` on
  `javascript`, its test; it is read only by a discharge or as the result,
  and any other read of it refuses after the passes (CE-1556). A point (a
  tuple of numbers, `tuple<real,
  real>` included) is tested at a discharge with the point
  test, which also reads the point of `NaN` coordinates as absent: no point
  is proved present by its type, as no `real` is, because a read out of
  range gives that point whatever the type says. The test is chosen from
  the static type; the emitted code tests no type at run time. A false
  restriction of a point, `If(c, (1, 2))`, is the point of `NaN`
  coordinates (user decision of 2026-11-03) on `javascript` (`[NaN, NaN]`),
  the shader targets (a `vec2` of
  `NaN`) and `interval-js` (a point of `empty` coordinates).
  Every other operator over an absent operand
  (arithmetic, a point operation, a comparison, `Not`, `And`, `Or`, a branch
  condition, a reducer, a string operation, the body of a user function) is
  unspecified in compiled code: the value can be `NaN`, `false`,
  `undefined`, a throw or a decline, and everything computed from that
  value is unspecified too, `IsMissing` and `Coalesce` of it included. With
  `w` holding `Missing`, `If(IsMissing(w), 1, 0)` is 1 on
  every route; `If(w > 0, 1, 0)` is 0 in the interpreter (a comparison with
  an absent operand is `False`, user decision of 2026-11-02, two-valued
  comparisons) and `NaN` on `javascript` (the compiled condition takes no
  arm). The host discharges a possibly absent value before it computes on
  it. The interpreter keeps its own rules (`Missing + 1` is `Missing`,
  `Less(Missing, 1)` is `False`, `If(Missing, 1, 2)` is `2`) as a
  convenience, not as a guarantee that compiled code follows. The only
  absent object a host passes to compiled JavaScript is `undefined`; a
  `null` input is a value outside the declared type (JavaScript reads
  `null` as `0` in arithmetic). The decision record is
  `docs/plans/2026-11-01-absent-value-contract.md`.
- **`NaN` for a complex value on the real lane.** In the `strict` mode, the
  default of every target, the lane of a value follows its static type. An
  operation whose exact value is complex but whose operands are on the
  real lane gives the target's `NaN` on every target: `Sqrt(x)` with
  `x: real` at `x = -4` is `NaN`, where the interpreter gives `2i`. This
  is the model of the shader targets, applied to every target. The host
  gets the complex value with `mode: 'complex'` or by declaring the input
  `complex`. A complex value passed at an input or a parameter declared
  real is a value outside its declared type (next item). This also holds
  where the static type of the node is complex: `Arcsin(u)` with `u: real`
  at `u = 2` is `NaN`, where the interpreter gives `1.5708 − 1.3170i` (user
  decision of 2026-11-15).
- **In `strict`, a value of type `number` must be real.** The type
  `number` admits a complex value, but the `strict` mode compiles a binding
  typed `number` (an input, a parameter, a `number` element of a
  collection, a `number` component of a tuple) on the real lane. A complex
  value given there gives an unspecified result, as a value outside its
  type does. With `L: list<tuple<number, real>>` at `[(1 + i, 2)]` and
  `hr = (p: tuple<real, real>) ↦ p[1] + p[2]`, `hr(L[1])` gives the string
  `"[object Object]2"` on `javascript`, where the interpreter gives
  `3 + i`. The host that passes complex values compiles with
  `mode: 'complex'`, which gives `3 + i`, or declares the binding
  `complex`. The compiler does not test the value at run time (rule R5 of
  "Shapes are settled at compile time"), and it does not decline a
  `number` binding: measured on the Tycho corpus, a decline of every
  `number` binding adds 62 JavaScript declines, and the complex lane for
  every `number` adds 70 and changes 103 values, most of them at a point
  typed `tuple<number, number>` (user decision of 2026-11-04,
  CE-751; the measure is in
  `docs/plans/2026-11-02-compiler-contraction-plan.md`, "The result of
  step 4, row 6").
- A value for an input that holds a value outside its declared type, for an
  input left out, or for an error that the static type does not show.
  "Shapes are settled at compile time" (R5) and "Fail closed" below list
  these cases.

**Not allowed.** For a program with inputs of their declared types, a finite
number that differs from the interpreter's by more than the precision of the
target, or a result of another shape (a number for a list, a list of another
length, a real for a complex). A `Sum` that skips a term, or `[1, 2] + 1`
that gives `3`, is a defect on every target.

**A decline is always allowed.** A target that cannot give the value within
these caveats declines, and the host gets the interpreter (with fallback) or
the diagnostic. A decline is the preferred fix for a case that would need a
handler of its own: it costs the host speed on that expression and nothing
else. "The decline stays" is a valid resolution of a reported difference,
recorded with its witness in the known-limitations list below or as an issue
file in `issues/`.

**Witness.** A reported difference names the program that shows it and the
strength of that witness, `corpus`, `plausible` or `crafted`, as
`docs/ISSUE_TRACKING.md` defines them.
A `crafted` witness of an allowed difference is not a defect and is not
recorded. A `crafted` witness of a wrong finite value or shape is one line
in the known-limitations list below, not an issue: it is fixed,
by a decline or a handler, when a stronger witness appears. A `corpus` or
`plausible` witness of a wrong finite value or shape is a defect: fixed at
once, or an issue file.

### Known limitations

One line each: the target, the program, the compiled value, the
interpreter's value. A line is removed when the case declines or is fixed.

- `javascript`: `Take(Iterate(s, x), 3)` at `x = 1`, with `s` declared
  `(real, real = 5) -> real` and assigned `(u, v = 7) ↦ v - u`. The compiled
  code applies the declared default (`[4, 1, 4]`, as a call `s(x)`, `Map`
  and `Filter` do in the interpreter); the interpreter's `Iterate` applies
  the literal's (`[6, 1, 6]`). CE-1461.

- `plausible?` — `javascript`, `x: real`: the CDF of a gamma or chi-square
  distribution at a symbolic point compiles as `1 - GammaRegularized(α, x/θ)`,
  which cancels in the lower tail: `CDF(GammaDistribution(2, 1), x)` at
  `x = 10^-10` gives `0`; the interpreter gives `4.99999999966667e-21` from
  the lower-tail kernel. CE-1590.

- `javascript` (crafted): a `Match` case of a number that is not an integer
  compares the subject exactly; the interpreter compares with the tolerance of
  `isEqual`. `Match(x, MatchCase(0.3, 1), MatchCase(_, 0))` at
  `x = 0.1 + 0.2` gives `0`; the interpreter gives `1`. CE-1652.
- `javascript` (crafted): a structural tree that holds calls of one name
  boxed in two scopes. With `g(t) = t + 1` outside and `g(t) = 10t` in a
  pushed scope, `Add` (structural) of `g(x + 0.5)` boxed in each scope gives
  `17.5` at `x = 1`: each call keeps the binding it was boxed with, as in
  the canonical form. The interpreter of the same structural tree reads both
  calls as the outer `g` and gives `5`.
- `javascript` (crafted): a structural `Floor(Multiply(x, Power(49, -1)))`
  folds the constant `49^-1` to its double, so the product misses the exact
  quotient: at `x = 49` it gives `0`, where the interpreter gives `1` (the
  canonical form divides by 49 and gives `1`). `interval-js` gives a
  `singular` enclosure that holds the value.
- `javascript` and `glsl` (crafted): `z^m` with `z` and `m` two constants
  of value 0 (`ce.declare('z', { value: 0, isConstant: true })`) gives the
  complex `NaN` (`{ re: NaN, im: NaN }`, a `vec2` on GLSL), where the
  interpreter gives the real `NaN`; `x + z^m` is then a complex value. The
  power `z^0` is `NaN` in the canonical form and compiles to the real `NaN`.

- `javascript` and `interval-js` (crafted): an input declared again in a
  nested scope. With `x: real`, `k(v) := v + x`, then in a pushed scope
  `x: real` again and `g(v) := v + 1000x`, `k(0) + g(0)` with
  `inputs: { x: 'real' }` at `x = 10` gives `10010`; the interpreter gives
  `x + 10000` (the outer `x`, which `k` reads, has no value). The compiled
  code passes one input per name; so does a call inside a function whose
  parameter is `x` (`u(x) := k(0) + g(0) + 100x`, CE-1502).

- `plausible?` — `javascript` and `interval-js`, `x: real`,
  `y: real`: `D(x^y, x)` at `x = 0`, `y = 1`. The interpreter gives `1`. The
  compiled derivative is the general form `y·x^(y - 1)`, whose factor is
  `0^0` there: `javascript` gives `NaN` and `interval-js` gives `empty` at
  the point box (a box that holds other points is not affected).
- `interval-js` (crafted): `y^x` over `y = [-1, 0]`,
  `x = [-1.5, -0.5]` gives the interval `[-∞, +∞]` with no mark, where the
  base 0 is a pole (`0^-1` is `~oo` in the interpreter). The enclosure holds
  every value; the neighbouring boxes are marked (`y = [0, 2]` with
  `x = [-1, -0.5]` is `partial`).
- `interval-js` (crafted), an operand that is the point `∞` or `-∞`:
  `x + y`, `x - y`, `x / y`, `x^y`, `Remainder(x, y)` and `LCM(x, y)` can
  give an interval with one `NaN` end, where an operand box holds a point
  with no value (`∞ − ∞`): `x = [-∞, -∞]` with `y = [-∞, ∞]` gives
  `x + y = [-∞, NaN]`, and `Remainder(x, y)` at `x = [-∞, -∞]`,
  `y = [-2, 0]` gives `[-∞, NaN]`. `Remainder(x, y)` at `x = [1, 2]`,
  `y = [∞, ∞]` gives `[1, 2]`, where the interpreter gives `NaN`. From a
  finite box no sub-expression reaches these.
- `interval-js` (crafted), `x`, `y` of a box with an infinite end:
  `IsMissing(x*y)` at `x = [∞, ∞]`, `y = [0, 0]` gives `'false'` (the kernel
  of `mul` gives `[0, 0]`); the interpreter gives `True` (`∞·0` is `NaN`).
- every target (crafted), `x: real`: a derivative or an
  integral whose body is reached through a user function, with a `compile`
  handler of `Sin` that returns `Cos(args[0])` and `g(u) = Sin(u)`:
  `D(g(x), x)` gives `cos(x)`, the closed form of the library's `Sin`. The
  program the handler describes, `D(Cos(x), x)`, gives `-sin(x)`. Written
  without the function, `D(Sin(x), x)` declines.
- `javascript`, `z: complex`, both modes: an
  intermediate double overflows and the code gives `NaN`
  where the interpreter has a finite value:
  - `Tanh(z)` at `z = 1000` gives `NaN`; the interpreter gives `1`.
  - `Cot(z)`, `Sec(z)`, `Csc(z)` at `z = 0.5 + 1000i` give `NaN`; the
    interpreter gives `0`.
  - `Sech(z)`, `Csch(z)` at `z = 1000 + 0.5i` give `NaN`; the interpreter
    gives `0`.
- `javascript` (crafted), `z: complex`:
  the complex `Cot` kernel loses precision near 0, off the pole: `Cot(z)` at
  `z = 1e-8 + 2e-8i` gives `1.8014e7 − 3.6029e7i`; the interpreter gives
  `2e7 − 4e7i` (relative error 8e-8 at `|z|` about 1e-5, 5e-12 at 1e-3,
  below 2e-15 from 0.03 up).
- `javascript`, `x`, `s: real`: the closed form of a
  definite integral is the difference of the antiderivative at its bounds in
  doubles, so its error is absolute (about one ulp of the larger term):
  `(1/(s√(2π)))·Integrate(e^(−Z²/(2s²)), Limits(Z, −∞, x))` at `s = 1` gives
  `7.0866e-16` at `x = −8` and `0` at `x = −9`; the interpreter gives
  `6.2210e-16` and `1.1286e-19`.
- `glsl`, `x: real`: a definite integral is its closed form, the difference
  of the antiderivative at its bounds in single floats, so its error is
  absolute: `Integrate(sin(t), Limits(t, 0, x))` is `1 − cos(x)`, which
  gives `0.0312545` at `x = 0.25` in SwiftShader (whose `cos` is off by
  about 2e-4); the interpreter gives `0.0310876`. An integral with no
  closed form declines (CE-1467).
- `glsl` (plausible?), `a: real`: where the closed form of a definite
  integral is `NaN`, at a bound where the integrand has an integrable
  singularity, the compiled code gives `NaN`:
  `Integrate(ln(t), Limits(t, a, 2))` at `a = 0`. The interpreter (and
  `javascript`, which runs the quadrature there) gives `−0.6137`
  (CE-1467).
- `javascript` (crafted), `x: real`: `Zeta(x)` at
  `x = -171.5` gives `Infinity` (the machine kernel overflows below about
  `-171`); the interpreter at the default precision gives `4.739e172`.
- `javascript` (crafted), `x: real` or `z: complex`: `Zeta` near its pole
  loses relative precision, about the square root of the machine epsilon
  divided by the distance to 1: at `1 + 10⁻¹²` the relative error is
  `8.9e-5`, at `1 + 10⁻⁹` it is `8.3e-8`.
- `javascript`, `interval-js` (crafted): a sum that overflows the double
  range is `Infinity` (on `interval-js`, once one end is `∞` the interval
  `add` rounds the other end to `∞` too), also inside `Mean`, which sums
  before it divides: at `L = [1e308, 1e308, 1e308]`, `Sum(L)` gives
  `Infinity` (`[∞, ∞]`) and `Mean(L)` gives `Infinity` (`[∞, ∞]`); the
  interpreter gives `3e308` and `1e308`.
- `javascript` (crafted): an intermediate product overflows
  or underflows where the value is finite. With `p`, `q: tuple<real, real>`,
  `Abs(p)` and `Distance(p, q)` are `Math.sqrt(x*x + y*y)`, which squares
  the coordinates: at `p = (3e200, 4e200)`, `q = (0, 0)` both give
  `Infinity`, and at `p = (3e-200, 4e-200)` both give `0`; the interpreter
  gives `5e200` and `5e-200`. `Norm` of a list, a point or a list of points
  squares its elements the same way: `Norm(L)` at `L = [1e-200, 1e-200]` is
  `0` (the interpreter gives `1.414e-200`) and at `[3e160, 4e160]` is
  `Infinity` (`5e160`). `Variance`, `StandardDeviation` and their
  population forms square the deviations the same way: `StandardDeviation(L)`
  at `L = [1e200, -1e200]` is `Infinity` (the interpreter gives
  `1.414e200`) and at `[-1e-200, 3e-200]` is `0` (`2.828e-200`); on
  `interval-js` (crafted) the first is `[∞, ∞]`, and `Variance(L)` at
  `[1e300, -1e300, 1e300]` is empty (an overflow of both terms of the
  corrected sum); neither contains the interpreter's value. With
  `x: real`, `\frac{2x}{3}` is
  `(2 * x) / 3`: at `x = 1e308` it gives `Infinity`; the interpreter gives
  `6.666666666666666e307`.
- `javascript` (crafted): `Range(0, 9999999999999/10^12)`
  has 11 elements (the count of a bound that is not an integer is read
  with a tolerance, as a double); the interpreter gives 10 (`0` to `9`).
- `glsl` (crafted), `x: real`, `y: real`: `Power(x, y)` with a
  negative `x` and a `y` that is not an integer gives `NaN` (`pow()` is
  undefined there in GLSL ES 3.00), also where the interpreter has a real
  value: at `x = -8`, `y = 2/3` the interpreter gives `4`. A single-float
  exponent cannot be read as a rational of odd denominator.
- `glsl` (crafted), `x: real`, `y: real`: `Hypot(x, y)` is
  `length(vec2(x, y))`, which squares its operands: `Hypot(1e20, 1e20)` gives
  `Infinity` and `Hypot(1e-25, 1e-25)` gives `0`.
- `glsl`, `z: complex`: `Zeta(z)` for Re z >= 0, `HurwitzZeta(z, a)` and
  `PolyGamma(n, z)` of an order n >= 1 are an Euler-Maclaurin sum in single
  floats, exact to about 1e-5 of the sum of the sizes of its terms
  (CE-1600). The error is absolute at that scale, not relative to the
  value. Next to the zero `1/2 + 21.022039i` of ζ (at the single float
  `21.02203941`), `Zeta(z)` gives `-6.4e-7 + 2.0e-7i`, where the
  interpreter gives `-5.6e-8 - 2.5e-7i`; at `1/2 - 25i` the relative error
  is `2.7e-4` (a value of `0.0149`). For Re z < 0 the terms grow as
  |a + N|^(1 - Re z), with N about 1.1(|z| + 32)/(2π):
  `HurwitzZeta(z, 0.25 + 0.5i)` at `z = -4 - 5i` gives `0.01500 - 0.01917i`,
  where the interpreter gives `0.01606 - 0.01961i`. `Zeta(z)` for Re z < 0
  takes the functional equation: from Re z = -4 to 0 and |Im z| <= 40, its
  error is at most `2.2e-5` of the larger of the value and 1.
- `glsl` (crafted), `n: integer`, `z: complex`: `PolyGamma(n, z)` at the
  order `-1` gives `NaN` off the positive real axis (at `z = -2.5`, where
  the interpreter and the `javascript` target give `-0.0562 - 9.4248i`, the
  value of `LogGamma(z)`). On the real axis `PolyGamma(n, z)` and
  `HurwitzZeta(z, a)` give `NaN` where the real helper does (its terms
  cancel: `PolyGamma(2, -0.5)`), also under `mode: 'complex'` (CE-1600).
- `glsl`, `z: complex`: `LerchPhi(z, s, a)` gives `NaN` past the unit circle
  unless `a = 1` (`LerchPhi(1.5i, 2, 1/2)`), where `|ln z| < (|s| + 24)/1400`
  (`LerchPhi(0.999 + 0.001i, 2, 1/2)`), and where the sizes of its terms pass
  100 times the value, mostly for `Re s < 0`: `LerchPhi(z, -2, 1/2)` at
  `z = -0.9 + 0.3i`, a quarter of the unit disk for `s = -1`, `a = 1/2`, and
  half of it for `s = -5/2`
  (CE-1600). The interpreter gives a value at each of these points.
- `glsl`, `z: complex`: `PolyLog(s, z)` gives `NaN` where `|ln z| > 3.5` for
  an order `Re s > 1` that is not an integer, or an integer above 24
  (`PolyLog(5/2, -6 + 0.75i)`), where the sizes of its terms pass 100 times
  the value, and where a term overflows (`PolyLog(-20, -2 + 0.1i)`, where
  ζ(-20 - k) passes the largest float). The sizes count `1 + |Im s|` times
  in the expansion in `ln z`, so a large `|Im s|` gives `NaN` in more of the
  plane: 55 of the 289 points of a grid of step 0.75 on the square
  `-6 <= Re z, Im z <= 6` for `s = 4 + 10i`,
  none for `s = 1/2 + 3i`. An order next to an integer `m >= 1` gives `NaN`
  for `1/2 < |z|` and `|ln z| <= 3.5`, where the first term and the term
  `ζ(s - m + 1)` cancel: 158 of the 169 points of a grid of step 0.5 on
  the square `-3 <= Re z, Im z <= 3` for
  `s = 1.005`, 4 for `s = 1.02` (CE-1600). The interpreter gives a value at
  each of these points.
- `glsl` (plausible?), `x: real`: `HurwitzZeta(s, x)` of a negative order is
  off by more than single-float precision: `HurwitzZeta(-1.5, 1/2)` gives
  `0.0164797` where the interpreter gives `0.0164748` (`2.9e-4` relative),
  `HurwitzZeta(-1, 1/2)` gives `0.0416714` for `1/24`, and
  `HurwitzZeta(-2.5, 1/2)` gives `-0.0070074` for `-0.0070113`; `LerchPhi(1, s,
  a)` gives the same values (`_gpu_ir_hurwitz_zeta`, found by CE-1600).
- `glsl` (crafted), `x: real`: `PolyLog(-20, x)` is `1.9e-4` off at `x = -2`
  (`105957176` where the interpreter gives `105977187`), the real helper
  `_gpu_ir_poly_log` (found by CE-1600).
- `glsl` (crafted), `x: real`, `y: real`: `GCD(x, y)` and `LCM(x, y)` at
  two integers of which one is 2^31 or more give `NaN` (the shader computes
  the divisor of two integers on `int`s): at `x = 2^31`, `y = 3` the
  interpreter gives `1` and `6442450944`.
- `plausible?` — `glsl`, `x: real`, `y: real`: `GCD(x, y)` and `LCM(x, y)`
  of two operands with no common divisor above 1e-6 of the larger one. The
  interpreter's value is then the remainder at which its loop ends, and it
  changes with the last bit of an operand; the shader computes the
  remainders in single floats and can end on another one. At the single
  floats `x = 1.715306043624878`, `y = 8.980745315551758`, `GCD(x, y)` gives
  `5.6028e-5` and `LCM(x, y)` gives `274945.1` (SwiftShader); the
  interpreter gives `1.5497e-5` and `994032.4`. Operands that hold integers,
  and operands with a common divisor far above that bound (`GCD(7.5, 2)`),
  give the interpreter's value.
- `glsl` (crafted): a `Which` of 126 clauses or more compiles
  to a shader that WebGL 2 refuses ("Expression too complex"; 124 clauses
  pass), where the interpreter has the value.
- `glsl` (crafted): a user function with a list parameter of
  a stated length of 90,001 and no `storage` compiles to an array parameter
  that WebGL 2 refuses ("Size of declared private variable exceeds
  implementation-defined limit"). With `storage` the parameter is a
  `sampler2D` and the shader is valid.
- `javascript` (crafted), `x: real`, `k(v) := v + x` defined at the top
  level, compiled with `inputs: { x: 'real' }` in a user scope that declares
  `x` again (`ce.pushScope(); ce.declare('x', 'real')`): the code passes the
  input `x` to `k`, whose body reads the global `x`, which has no value.
  `Add(x, k(1))` gives 21 at x = 10, where the interpreter gives `x + 11`
  (and `Add(x, Sum(k(1), Limits(x, 1, 3)))` 43, where it gives `3x + 13`).
  Without `inputs`, the compilation declines.
- `plausible?` — `javascript`, `s: integer`, `r` a recursive function of
  depth `i` (`r(i) := Which(i <= 0, 0, True, r(i - 1) + s)`): a
  `Comprehension` computes every element, where the interpreter computes
  only the elements read. `At(Comprehension(r(i), Element(i, Range(0,
  100000))), 2)` at `s = 2` throws a `RangeError` (the recursion of the
  last elements overflows the stack); the interpreter gives `2`.
- `plausible?` — `glsl`, `mode: 'complex'`, `x: real`:
  `Power(x, 0.2)` at `x = -8` gives the principal value `1.226 + 0.891i`;
  the interpreter and the `javascript` target give the real root `-1.5157`.
- `plausible?` — `javascript` and `glsl`, `x: real`,
  `y: real`: `Floor(x/5 + y/10)` at `x = 24`, `y = -98` gives `-6`: each
  quotient is rounded, and their sum falls just under `-5`. The interpreter
  gives `-5`. A single quotient is exact (`Floor(x/49)`); a sum of two is
  wrong at about one integer point in 10,000, and
  `Floor(j/3 + n + 1/3)` at about one in 20 (`j = -46`, `n = -16` gives
  `-32`, the interpreter `-31`).
- `javascript` and `glsl` (crafted), `x: real`:
  `Sum(1, Limits(k, 1, Sqrt(x)^2))` at `x = 3` gives `2`: the bound is
  floored, and doubles compute `Sqrt(3)^2` just under 3. The interpreter
  gives `3`.
- `javascript` (crafted), `n: integer`: a jump function
  (`Floor`, `Ceil`, `Round`, `Sign`, a comparison) of an exact rational
  constant that no double holds takes the jump of the nearest double:
  `Floor(n + (25! − 1)/24!)` at `n = 1` gives `26`; the interpreter gives
  `25`.
- `plausible?` — `javascript`, `s: real`, `P: real`: a
  comparison of a computed value that is zero in exact arithmetic follows
  its rounding: `If(Sin(2πs/P) > 0, 1, 0)` at `s = 2`, `P = −2` gives `1`
  (the sine is `2.449e-16` in doubles); the interpreter gives `0`.
- `plausible?` — `javascript`, `L: list<real>`, `a: real`: an order of keys
  is the order of their doubles (`ArgMin`, `ArgMax`, `MinBy`, `MaxBy`,
  `Ordering` and `Sort` by a key). Keys that are equal in exact arithmetic
  can round to two doubles: `ArgMin(L, t ↦ |t − a|)` at `L = [0.5, 0.1]`,
  `a = 0.3` gives `2`, and `MinBy` gives `0.1` (the keys are `0.2` and
  `0.19999999999999998`); the interpreter computes with the decimals and
  gives the first of the two equal keys, `1` and `0.5`. Keys that differ can
  have one double: `ArgMax(L, Tanh)` at `L = [20, 30]` gives `1` (both keys
  are the double `1`); the interpreter gives `2`.
- `javascript` and `glsl` (crafted), `L: list<real>`: a value computed from
  the `0` of `ArgMax` and `ArgMin`, or from the `NaN` of `MaxBy` and `MinBy`,
  where the interpreter leaves them unevaluated (no element, a `NaN` key):
  `IsMissing(MaxBy(L, t ↦ −t) + 1)` at `L = []` gives `true`; the interpreter
  gives `False`. A discharge of `MaxBy` or `MinBy` itself declines.
- `glsl` (crafted), `x: real`, `y: real`: `Arctan2(y, x)` with
  an operand that is a zero computed as `-0` (`Arctan2(Negate(0·x), y)`) is
  off by π in the software renderer, and has the other sign on a GPU for
  `x = -0`. The complex lane compares its parts with 0 first.
- `javascript` (crafted): at the
  threshold of the sRGB transfer function, `AsRgb(Rgb(0.04045, 0.04, 0.05))`
  gives `c0 = 0.040449970408` (the round trip through OKLCh crosses to the
  other branch of the transfer); the interpreter gives `0.04045`.
- `javascript` and `glsl` (crafted), `x: real`: `Log(x, b)` with
  a base other than 2 and 10 is `Ln(x)/Ln(b)`: `Ceil(Log(x, 5))` at `x = 125`
  gives `4`; the interpreter gives `3`.
- `plausible?` — `javascript`, `k: integer`:
  `Comprehension(2k, Element(k, Range(1, k)))`, whose index shadows a name
  that its own range reads, gives `[2, 4, 6]` at `k = 3`; the interpreter
  leaves the form unevaluated.
- `javascript` (crafted), `D: list<real>`:
  `WithRandomSeed(1, Tuple(Length(Map(Function(Random(), z), D)), Random()))`
  at `D = [1, 2, 3]` gives `[3, 0.4613875814927787]`; the interpreter gives
  `(3, 0.9834569781146947)`. Its `Map` is a lazy view and `Length` draws
  nothing, where the compiled `Map` builds every element. The result carries
  the warning `seeded-draw-order`. A `Comprehension` with an effect declines.
- `javascript` (crafted), `t: real`, `hostSq` a function of the host:
  `First(Map(x ↦ hostSq(x t), [1, 2, 3]))` at `t = 2` gives `4`, as the
  interpreter does, and calls `hostSq` three times; the interpreter calls it
  once. Its `Map` is a lazy view that evaluates only the positions read,
  where the compiled `Map` builds every element ("Functions of the host").
- `javascript` (crafted), `D: list<real>`: the root `Tuple` is
  recognised by node identity, so one node `t = Tuple(D, a)`, made with
  `ce.function()`, that is both the root result and an operand in the block
  (`Block(Declare(a, real, 1), Assign(a, Length(t)), t)`) reads `Length(t)` as
  the length of its first element: at `D = [1, 2, 3]` it gives `[[1, 2, 3], 3]`
  where a tuple of two elements has length 2. `ce.box()` of JSON never shares
  nodes.
- `javascript` (crafted): `Add(Range(1, 2), List(1, 2, 3))`
  gives `[2, 4]`; the interpreter gives the error `incompatible-dimensions`.
  The length of a `Range` is a value for the compiler, and it does not
  compare a length value with a stated length.
- `javascript` and `interval-js` (crafted), `x: real`:
  `Block(Declare(s, 'unknown', x), Declare(t, 'real', Add(s, 1)))`, whose
  static type is `nothing`, gives `3` at `x = 2` (the point `[3, 3]` on
  `interval-js`); the interpreter gives `Nothing`.
- `interval-js` (crafted), `x: real`, `n: integer`:
  `Sum(If(x > 1, Ln(k + x), If(x > 1, Ln(x - 1), Arccos(x))), Limits(k, 1, n))`
  over `x = [0.5, 1.5]`, `n = 2` gives
  `{ kind: 'partial', value: [0, 2.2999605196919664], domainClipped: 'both' }`:
  the inner `If` is not narrowed to `x ≤ 1`, so `Ln(x - 1)` and `Arccos(x)`
  are each read over the whole box. Every point of the box has a value, so
  the exact answer is an `interval` result, not a `partial` one.
- `javascript`, `seven` and `tenth` assigned `7/10` and `1/10` with no
  declared type: `x + Mod(seven, tenth)` compiles to
  `_.x + 0.09999999999999992`, the remainder of the doubles `0.7` and `0.1`.
  The interpreter gives `x`.
- `javascript`, `complex` mode, `t` with no declared type: `-1/(t·ln t)`,
  `1/(t·ln(t)^2)` and `sin(ln t)/t` at `t = ±Infinity` give `NaN`. The
  interpreter gives `0`.
- `javascript`, `complex` mode, `t` with no declared type: `ln(t)^1.6` at
  `t = 0` gives `NaN` (the complex power of `-Infinity`). The interpreter
  gives `+Infinity`.
- `javascript`, `x: real`, `z: complex`: `x·z` at `x = +Infinity`, `z = 1`
  gives `{ re: Infinity, im: NaN }`. The interpreter gives `+Infinity`.
- `javascript`, `L: list<real>`: the simplified form of `Sqrt(L - L) + 1` at
  `L = [-1, 0, 2]` gives `[NaN, 1, 1]`. `simplify()` takes the zero out of the
  root and gives `0·Sqrt(L) + 1`, so the code computes `0 * Math.sqrt(-1)`. The
  interpreter, and the compiled form that is not simplified, give `[1, 1, 1]`.
- `plausible?` — `javascript`, `n: integer`: in
  `function g(n: integer) { sum(map((x) => sum([random() for j in 1..2]), 1..n)) }`,
  `WithRandomSeed(7, (g(m), random()))` at `m = 2` gives `[1.2722…, 0.2160…]`;
  the interpreter gives `(0.5609…, 0.2415…)`. The interpreter evaluates the
  comprehension in the function literal as one instance, so the two calls read
  one draw set (`docs/RANDOMNESS-MODEL.md` §6, "One instance, one draw set");
  the compiled code draws at each call.
- `plausible?` — `javascript`, `Z: complex`, `x: real`: the
  entry check copies the inputs object with its own properties when it
  converts a value, so an inherited input or a getter of a class instance is
  lost. `Z + x` with the inputs `Object.create({ Z: 1.5, x: 2 })` gives
  `NaN`; the interpreter gives `3.5`. `If(B, 2Z, 3)` with `B: true` on the
  prototype and `Z: 3` gives `3`, not `6`.
- `javascript`: in a loop with an outer `a = 100`, `function f() { a }` and
  `let (a, b) = (k, f())`, the compiled `b` is `k`; the interpreter gives
  `b = 100` (was CE-756).
- `javascript` (crafted): a node shared by both arms of an
  `If`, nested: `e_k = If(x > k, e_(k-1) + 1, 2·e_(k-1))` over `Sin(x)` is
  copied into each arm, so the code doubles with each level (930,611
  characters at depth 12); past 50,000 nodes the compilation declines
  (CE-1199).
- `javascript` (crafted): a root function literal whose
  untyped parameter is read as a number by its type (`unknown`) but whose
  body threads a list there: `w ↦ Sum(List(w))` applied to `[3, 1, 2]`
  gives the string `"03,1,2"`; the interpreter gives `[3, 1, 2]`.
- `javascript` (crafted): a `Range` whose exact rational
  bound is within about 10^-12 of an integer is counted on the double of the
  bound: `Length(Range(0, 9999999999999/1000000000000, 1))` gives 11, where
  `evaluate()` gives 10 (and `N()` 11); `Sum`, `Max`, `At(…, -1)` and the
  list operators (`Last`, `Mean`, `Reverse`, `Take`, ...) of it likewise.
- `plausible?` — `javascript`, `y: real`, `g(t) := t^{100} e^{-t}`:
  `\int_0^y g(x)\,dx` at `y = 1500` gives `NaN` (the quadrature meets
  `∞·0` in the integrand, and the log-space form of a sample is not
  taken through a call of a user function); the interpreter's
  `evaluate().N()` gives about `100!`, and its `.N()` also gives `NaN`.
  With the integrand written inline, the fallback gives the value.
- `plausible?` — `interval-js`, `x: real` over the interval `[-1, 1]`:
  `Block(Declare(t, real, 0), If(x > 0, Assign(t, 2x), Assign(t, -1)), t)`
  gives the interval `[-1, -1]` (where the condition is undecided the code
  evaluates both arms in turn, each arm writes the local, and the local
  keeps the value of the second arm); the interpreter gives `1` at
  `x = 0.5`.
- `interval-js` (crafted: a box of width 10⁻⁶ across the edge of the
  domain), `x: real` over `[-1.0000005, -0.9999995]`: `Arcsec(x)` gives a
  lower end of `3.1405926537980786`, and the interpreter gives
  `3.14059265379812650` at `x = -1.0000005`, below it by about 5·10⁻¹⁴.
  `Arccsc(x)` and `Arcoth(x)` miss the value at the same point in the same
  way. The kernels `_IA.asec`, `_IA.acsc` and `_IA.acoth` take one outward
  step for the rounding of `1/x`, and the derivative there is about 1,000.
- `interval-js` (crafted: a point box at `x = 10¹⁰` or beyond), `x: real`:
  `Power(x, Rational(5, 6))` over the point box at `x = 10¹⁰`. The exponent
  has two readings, which differ there by about 3·10⁻¹⁵ relative: the
  rational 5/6, which the interpreter takes at the default precision
  (`215443469.00318837`), and the double nearest to it, which the
  interpreter takes at machine precision (`215443469.003189`). The code
  encloses the root then the power and misses the second. The same holds for every exponent whose
  denominator is even and not a power of 2 (`7/6` at `x = 10¹⁰⁰`). An odd
  denominator (`_IA.powRational`) and a power of 2 (the double is exact)
  contain both.
- `javascript`, `interval-js` (crafted: a base near 10⁻²⁰⁰), `x: real`,
  `y: real`: `Power(x, y)` at `x = 10⁻²⁰⁰`, `y = 0.2`. The exponent is known
  at run time, as a double. At the default precision the interpreter reads
  it as the decimal `1/5` and gives `1e-40`; the code computes the power of
  the double (`9.999999999999948e-41`, about 5·10⁻¹⁵ below), and
  `interval-js` encloses that number (`[9.999999999999946e-41,
  9.99999999999995e-41]`). At machine
  precision the interpreter gives the code's number.
- `javascript` (crafted: a boolean mask over a base that draws), `A:
  list<real>`: a mask or a base of a mask with an effect declines, except
  through a parameter: with `sel(u, c) = At(u, u > c)`,
  `WithRandomSeed(3, sel(Map(k ↦ k + Random(), A), 2.5))` at
  `A = [1, 2, 3, 4, 5]` gives `[3.7936…, 4.0769…, 5.7640…]`, and the
  interpreter gives `[3.3489…, 4.6413…, 5.1639…]`: the interpreter reads the
  lazy `Map` at the kept positions only, and the code builds the whole list
  first.
- `glsl` (crafted: a negative operand beside a large one), `x: real`,
  `y: real`: `Beta(x, y)` takes the logarithm of Γ only when both operands
  are positive; otherwise it divides Γ values, which overflow single
  precision: `Beta(-0.5, 35.2)` is `-Infinity` and `Beta(-0.5, 40)` is
  `NaN`, where the interpreter gives `-20.8068` and `-22.2090`.
- `javascript` (crafted: a predicate that fails after the element that
  decides), `L`, `M: list<real>`: `Any`, `All`, `Contains` and `IndexOf`
  test every element, where the interpreter stops at the first element that
  decides: `Any(L, a ↦ AssertPresent(At(M, a)) > 0)` at `L = [1, 5]`,
  `M = [1]` throws `expected-present`; the interpreter gives `True`. A
  predicate or a list with an effect declines.
- `javascript` (crafted: compiled code run inside a random frame of the
  interpreter): a compiled `parallel for` (whose program has no draw)
  consumes no draw index of the frame, where the interpreted loop consumes
  one (`docs/RANDOMNESS-MODEL.md`, "Pass frames of a parallel loop"), so a
  later draw of the interpreter in that frame differs.
- `javascript` (crafted: a count that is NaN), `x: real`:
  `Linspace(0, 1, x)` at `x = NaN` (or `Linspace(0, 1, NaN)`) gives the 50
  elements of the default count; the interpreter leaves it unevaluated.
  CE-1531.
- `javascript` (crafted), `A: matrix<real^2x2>`: `RowReduce(A)` at
  `A = [[1e11, 1], [1, 0]]` gives `[[1, 0], [0, 0]]`: the second pivot,
  `-1e-11`, is under the tolerance `1e-10` of the numeric row reduction.
  The interpreter reduces an exact matrix in rationals and gives
  `[[1, 0], [0, 1]]`.
- `javascript` (crafted), `H: matrix<real^11x11>`: `Inverse(H)` of the
  Hilbert matrix of order 11 (`H[i][j] = 1/(i + j - 1)`) gives a matrix of
  NaN: its elimination in doubles is not told apart from that of a
  singular matrix. The interpreter gives the exact inverse (`121` at
  `(1, 1)`).
- `javascript` (crafted), `P: list<list<real^2>>`: `Diagonal(P)` at
  `P = []` gives `[]`; the interpreter leaves `Diagonal(List())`
  unevaluated.
- `glsl` (crafted: the hue of a grey or a near-grey), `x: real`: in single
  floats the chroma of a grey through OKLCh is rounding error, and its hue
  is arbitrary: `ColorToColorspace(Rgb(x, x, x), "oklch")` at `x = 0.5` has
  the hue 30.2, where the interpreter gives 89.876 (of a chroma of
  2.2·10⁻⁸). `AsHsv`, `AsHsl` and `ColorToColorspace` to `hsv` or `hsl` read
  a colour whose sRGB channels differ by at most 1e-6 as grey (the
  interpreter: 1e-9): `ColorToColorspace(Rgb(0.5, 0.5, 0.5000005), "hsv")`
  is `(0, 0, 0.5000006)`, where the interpreter gives `(240, 1.0·10⁻⁶, 0.5000005)`.
- `javascript`, `s: string`: the elements of a list of strings that is the
  result (`Characters(s)`, `Reverse(["a", s])`) are JavaScript strings,
  where the interpreter's are character or string values (CE-1548).
- `javascript` (plausible), `L: list<string>`, `i: integer`, `n: integer`:
  a read of a list of strings that can be out of range (`At`, `First`,
  `Last` of an index that is not a constant in range of a constant length)
  declines everywhere except as the result and in `IsMissing`, `Coalesce`
  and `AssertPresent`: `ToUpperCase(At(L, i))`, `At(L, i) == "a"`,
  `Length(First(L))`, `StringJoin([At(L, 1), "x"])`, `[First(L), Last(L)]`,
  `Map(k -> At(L, k), Range(1, n))`, and a user function that is not
  inlined whose value is such a read. The remedy is the discharge:
  `ToUpperCase(Coalesce(At(L, i), ""))`, inside the function for a call.
  CE-1556.
- `javascript` (plausible), `s: string`, `L: list<string>`: `Max(L)`
  declines; so do `Contains(L, "x")`, `IndexOf(L, "x")` and `Find` of a
  list of strings, and `Reduce` or `Fold` of `String` over `Characters(s)`
  (the reductions read real numbers only). `Sort(L)`, `Unique(L)` and
  `Less(s, "b")` compile (CE-1574); an order of a character and a string
  (`Map(c -> c < "b", Characters(s))`), a chain of three or more strings
  (`Less(s, t, "z")`) and `Sort` of a list of characters and strings
  decline, as the compiled code holds both as strings and the static type
  picks the order.
- `javascript` (crafted), `L: list<string>`, `i: integer`, `j: integer`:
  `Coalesce(At(L, i), At(L, j))` declines (its second read can be absent);
  `Equal(L, "a")` of an input or a list of run-time length declines (an
  element-wise operation on a list of strings), while `Equal(["a", s], "a")`
  compiles through the passes and declines with `constantFold: false`.
- `javascript` (crafted), `L: list<string>`, `b: boolean`: a list of strings
  in an `If`, a `Loop` or a user function that is not inlined declines
  (`If(b, L, ["x"])`), and so do a list of lists of strings (`Chunk(L, 2)`)
  and an input list of strings returned as the result (`L`).
- `javascript` (crafted), `f: string`: `ColorToString(c, f)` of a format that
  is not a string literal declines, as the other colour operators read a
  space, a gamut or a palette as a literal; so does `ColorToString` of a
  colour that is not a constructor, a name of one, a conversion of one to its
  own space or a tuple of three numbers (`ColorToString(AsRgb(Oklch(0.5, x,
  30)))`, `ColorToString(ColorMix(a, b))`): such a colour is held in OKLCh,
  and a rounding to a unit of its sRGB channels can differ from the
  interpreter's by one.

- `plausible?` — `javascript`, `x: real`, `y: real`, `z: real`:
  `List(List(x, y), List(z))` as the result declines ("elements of two
  types"); the interpreter gives `[[x, y], [z]]`.
- `plausible?` — `javascript`, `P: list<tuple<real, real>>`: `Chunk(P, 2)`
  declines ("Chunk of a list of other than numbers or booleans"); the
  interpreter gives the rows of points. Of a list of complex numbers or of
  colours it declines too (crafted).
- `plausible?` — `javascript`, a prepared Document revision with the row
  `g = Q + 1` or the function row `f(x) = x + Q`, and no declaration of `Q`:
  the interpreter fallback of a declined compilation substitutes a run
  argument for a free name into the expression only, so `run({ Q: 4 })` of
  `Expand(g)` or `Expand(f(2))` gives `null`, where the compiled `g` gives
  `5` and the compiled `f(2)` gives `6`. The remedy is to declare `Q` as an
  input of the imports (`input('Q', 'real')`): the fallback then gives `5`
  and `6` (CE-1666).

## `parallel for` and `runAsync()`

On `javascript` a `parallel for` (`ParallelLoop(body, Element(x, coll))`)
compiles as the `Loop` of the same operands: its passes run in order, on one
thread, as the interpreter runs them, so its values are the interpreter's,
also where a pass reads an accumulator (`parallel for k in 1..3 { s += k;
t += s }` gives `[6, 10]`). It declines when the body assigns a variable
declared outside the loop other than with `AddTo` (`s = s + k`:
`parallel-outer-write`), when the body has a `Break` or a `Continue` of the
loop itself (`parallel-exit`; those of an inner `Loop` compile), and when the
program draws or has a `WithRandomSeed` frame: inside a frame the
interpreter runs each pass in a random frame of its own, which compiled code
does not have. GLSL and the interval mode decline it.

A `javascript` result called with an object of variables
(`calling: 'expression'`) has `runAsync(inputs, options?)`, a promise of the
value of `run(inputs)` that sends a `parallel for` to the engine's worker
pool (`ce.workers`) when it can (design note
`docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`, section 6).
`run()` and its text do not change: `runAsync()` runs a second,
asynchronous text of the same IR, which awaits at such a loop.

- **Which loops.** The compiler reads the IR after its passes. A loop goes
  to the pool when each value that it carries is a number to which the
  passes only add (`s += e`, also under an `if`, in an inner `for`, or twice
  in a pass), each list that it writes is a list of numbers declared outside
  the loop to whose elements it only adds (`L[i] += e`, the in-place list
  local of "List updates"), and no pass reads an accumulator otherwise
  (`t += s`, `L[i] += L[j]`, `M = L`); when it has at least one
  accumulator; when the loop is at a statement of the program, or of a user
  function that the program calls outside a callback, a comprehension or
  another `parallel for`, also inside an `if` or the body of a `for` (not
  itself inside one of those); when its body reads no name of the `vars`
  option (a worker has no inputs object) and computes no numeric integral,
  which samples the engine's random stream (`isShippableCode()`); and in the
  default mode, with no `iterationBudget`.
  Every other loop runs in order, with the code of `run()`. No condition
  makes a compilation decline.
- **At run time.** The loop goes to the pool when the pool is usable, the
  call is not inside `ce.withStepBudget()` (a worker cannot charge the
  caller's steps), the count of passes is at least `minPasses` (default
  20 000), and the private lists of all workers (each list accumulator, and
  each list that the passes read, once per sub-range) hold at most 16 million
  numbers. Otherwise it runs in order, and `onLoop` reports the reason
  (`'no-pool'`, `'pool-unusable'`, `'step-budget'`, `'below-threshold'`,
  `'too-large'`).
- **The merge.** The passes are split into one sub-range of consecutive
  passes per worker. Each worker runs a program of the IR of the loop body
  from `-0` (the identity of `+`, so a cell that no pass writes adds
  nothing), and the calling thread adds the partial sums to the
  accumulators in the order of the sub-ranges. An integer accumulator whose
  values stay within 2^53 has the value of `run()`; a real one can differ
  from it by the grouping of the sum (a different order of summation, a
  caveat above), and for one pool size has the same bits at every run.
- **Errors.** An error of a pass on a worker, a failed worker or a pool that
  turns out unusable sends the sub-range back to the calling thread, which
  runs it again in the order of the sub-ranges, so the error is the one
  `run()` throws (`onLoop` reports `'pool-declined'`). A deadline frame
  current at the call (`ce.withTimeLimit()`) bounds the workers too: the
  promise then rejects with that frame's `CancellationError` (its
  attribution and spans), and no sub-range runs again. A `signal` already
  aborted rejects before any statement runs; an abort during a wait rejects
  at once (the queued sub-ranges are dropped, and a running worker is
  replaced after the pool's grace period); an abort while statements run is
  seen at the next pool loop.
- **State.** The program keeps its reconstruction digits and its deadline
  frame across each wait, and the caller's are current whenever the
  program does not run, also after the promise settles. `onLoop` runs with
  the caller's.
- **Inputs.** The host must not change `inputs`, or an array that it holds,
  until the promise settles: the program reads them after a wait, and the
  value is otherwise unspecified.

`willParallelize(passes?, minPasses?)` answers whether `runAsync()` would
send a loop of this program to the pool now: the program has a pool loop,
the pool is usable, no step budget is current, and `passes`, when given, is
at least `minPasses`. A stored result loaded with
`createJavaScriptRuntime()` has no asynchronous text: its `runAsync()` is
`run()`.

```js
const ce = new ComputeEngine({ workers: createKernelPool({ create }) });
executeEpsil(ce, `function f(n: integer) -> integer {
  let s: integer = 0
  parallel for k in 1..n { s += k * k }
  s
}`);
ce.declare('n', 'integer');
const code = compile(ce.box(['f', 'n']));
await code.runAsync({ n: 100000 }, { onLoop: (r) => console.log(r) });
// { passes: 100000, route: 'pool' }
// → 333338333350000, the value of code.run({ n: 100000 })
```

## The scope a compilation reads

A compilation reads each name from the scope the expression was boxed in,
as its evaluation does (`docs/SCOPING-MODEL.md`). It does not read the scope
that is current when `compile()` is called.

Before it compiles, `compileExpression()` chooses the scope
(`compilationScope()`, `compilation/compile-scope.ts`). It walks the
expression, the bodies of the user functions that the expression calls and
the values of the variables that it reads, and compares, for each
occurrence of a name, the definition that a lookup from a scope gives with
the definition that the occurrence is bound to:

- When the current scope gives each name its own definition, the
  compilation runs as it is called, and the emitted code is that of a
  compilation in the scope of the expression.
- Otherwise the whole compilation runs in the scope of an occurrence that
  does (`ce._inScope()`). A scope that was popped qualifies: it keeps its
  definitions.
- When no scope does, the compilation declines with the code
  `compile-error` and the name in `binding`.

```js
ce.declare('x', 'real');
ce.declare('a', 'real');
ce.assign('a', 10);
const expr = ce.parse('x + a');
ce.pushScope();
ce.declare('a', 'real');
ce.assign('a', 1);
compile(expr).code;               // '10 + _.x'
compile(ce.rebind(expr)).code;    // '1 + _.x'

// Operands boxed in two scopes that define `a` differently: a decline, and
// the interpreter gives 13 for x = 2 (10 for the first `a`, 1 for the
// second).
compile(ce.function('Add', [expr, ce.parse('a')])).success; // false
```

What the walk does not compare: a parameter, the variable of a binder and
the local of a block (they are bound inside the expression); a symbol bound
to a definition of the standard library; a name that the `vars` option
maps. Such a name is an input of the code wherever it is read by its name,
in the expression and in the bodies of the functions it calls, and its
stored value is not read: with `a := 2`, `f(x) := a x` and `f(x) + a` bound
in a scope that declares `a` again with no value,
`compile(expr, { vars: { a: '_.a' } })` reads `_.a` beside the call of `f`,
and the compiled function of `f` receives `_.a` as an argument. Without
`vars` the same compilation declines: the
interpreter reads 2 in the body of `f` and the `a` of the inner scope
beside it. A scope other than the current one is chosen only when it reads
each name of `vars` as the current scope does. For the time of the
compilation the stored value of a `vars` name with a declared type is
hidden on every definition that an occurrence of the name reads
(`withVarsValuesHidden()`, `compilation/vars-inputs.ts`), so no analysis of
the compiler reads it: `f(x) := |a| x` with `a: real` holding 4 compiles to
a function that computes `x * Math.abs(a)` of the `_.a` it receives, not
`x * a`. A held
(non-canonical) name is compared with the scope `compile()` is called in,
where an evaluation binds it. The interpreter fallback of a result
evaluates in the scope `compile()` was called in.

The option `symbolic` names inputs with no source text
(`compile(expr, { symbolic: ['a', 'x'] })`). A name in it is read as a name
of `vars` is: it is an input wherever the compilation reads its name, it
takes no part in the choice of the scope, and its stored value is hidden on
every definition that an occurrence reads. It is emitted as any plain input
of the target. Its type is the one that the scope of the compilation
declares for the name, so a host that declares an axis or a kernel
parameter in a scope pushed around the compilation names it in `symbolic`:
a function defined outside that scope, whose body reads the name as a free
name or as a library operator of the same name, then reads the input. A
name whose value cannot be hidden (a constant, a function, a type inferred
from an assigned value) makes the compilation decline
(`withSymbolicInputs()`, `compilation/vars-inputs.ts`). A name of the
option that the compilation does not read (in the expression, in the bodies
it calls, in the values it reads) has no effect: it is not refused, and it
takes no part in the choice of the scope. A host can list every name that
its scopes declare with no value.

The option `inputs` gives the type of an input at the call, with no scope:
`compile(expr, { inputs: { x: 'real', n: 'real' } })`. The compilation
pushes a scope of its own, as a child of the scope that the other names of
the expression are read from, declares each name there with its type and no
value, replaces the occurrences of the name in the expression by
occurrences bound to that declaration (`subs()`: an occurrence that a
binder, a block or a function literal of the expression binds is left), and
compiles with the names in `symbolic` (`withCompileInputs()`,
`compilation/compile-expression.ts`). So the given type wins over a
declaration and over a stored value, for that compilation only: with
`n := [1, 2, 3]`, `n x` compiles to a broadcast over the stored list, and
to `_.n * _.x` with `inputs: { n: 'real' }`. The other names keep the
definitions they were boxed with. A body that the expression calls reads
the input too; when the body was written with a declaration of the name, it
keeps the type of that declaration (a slider declared `real<-10..10>` and
given as `real` is typed with the range inside the body). When the body
reads a definition whose type was inferred from its value (a Document row
bound to a formula, `k = 2x_w`, typed `real`), that value is hidden for the
compilation and the type kept, if the given type is a subtype of it: with
`X(x, y) = kx/y`, `X(x, y)` with `inputs: { k: 'real' }` reads the input
`k`; with `inputs: { k: 'list<real>' }` it declines (CE-1706). A name of
`inputs` that such a body reads as a constant, or that is a function,
declines, as a name of `symbolic` does: a constant has no value to leave
out. The message names the option `inputs`, and `diagnostic.binding` is the
name; without the name in `inputs`, the compilation reads the constant.

The option does not make the expression canonical again. The canonical form
was chosen with the types that the names had when the expression was boxed,
and a rewrite that is right for those types stays. With `k` declared
`integer`, `(x^2)^k` is boxed as `x^(2k)`; compiled with
`inputs: { k: 'real' }` and run with `x = -3` and `k = 0.5`, it gives -3,
and `(x^2)^k` is 3. So the result is the interpreter's when the given type
is the type at boxing or a subtype of it (`list<real>` for a list, a range
for `real`). For a wider or another type it is the interpreter's only when
no rewrite used the type (`n x` above), which a host cannot tell in
general: box the expression in a scope that declares the name with that
type. A pushed scope with a second boxing of the canonical tree gives the
same code as `inputs`; only a second parse differs. The interpreter
fallback of the result evaluates the expression as it was given, in the
scope of the call, where a run gives each input its value: the bodies that
the expression calls read that value too (with `a` holding 4 and
`f(t) := a t`, the fallback of `f(2) + h(a)` run with `a = 3` gives `f` the
3). `canCompile()` takes the option, and gives `ok: false` for a type
string that is not a type, where `compile()` throws.

The value of a `Declare` that reads the name of its own local reads the
enclosing binding of that name, as in the interpreter: with an outer `k`,
`Block(Declare(k, 'real', k + 1), 2k)` gives 8 for `k = 3`. The value is
lowered against the enclosing binding: `3z with z = z + Z` compiles to
`3 * (_.Z + _.z)`, and such a `Declare` in the body of a `Loop` compiles
too.

## Shapes are settled at compile time

Compiled code settles the shape of every value at compile time, and emits no
run-time test of a type. The shape of a value is the form of its
representation: a number, a complex number, a string, a list, a point (a
tuple) or a matrix. It comes from the declared or inferred static type of the
value and from the literal structure of its operands. The compiler does not
follow the paths of control flow to find a shape. The rule has six parts.

**R1. Every input has a type.** An input is a free symbol of the compiled
code, as `freeSymbols` lists it. An input whose static type is `unknown` or
`any` declines on every target, with the diagnostic code `'untyped-input'`
and the name of the input in `unsupported`: with `m` undeclared,
`If(m < 3, m, 0)` declines, and `unsupported` is `["m"]`. When the program
declines for another reason, `unsupported` also names such inputs: with `u`
undeclared, `u := If(x < 0, u, 0)` gives `["Assign", "u"]`. An input with no
declared type has the type that the compiled expression requires of it
(below). A declared union of
shapes (`real | list<real>`) is a type, and declines (R4). "An input with no
type declines", under "Fail closed", gives the details.

**R2. The static type of an argument selects the code of a call.** The
static types of the arguments decide, at compile time, whether a call maps
over a list or binds it whole, as the interpreter decides for that
parameter (`compilation/ir/README.md`, "User functions"). With
`f := t ↦ 2t`:

- with `u: real`, `f(u)` is a call of the compiled function of `f`;
- with `L: list<real>`, `f(L)` maps the body over the list, as the
  interpreter maps it: a loop that fills an array, `[2, 4]` for
  `L = [1, 2]`;
- with `P: tuple<real, real>`, `f(P)` gives `[2·P[0], 2·P[1]]`.

No test of a shape runs in these calls. A parameter or an input that the
host declares with a union of shapes declines (R4): an input declared
`real | tuple<real, real>` or `real | list<real>` declines with
`outside-profile`. A union of tuples of one length is read as one tuple
(`compilation/ir/README.md`, "Tuples").

**R3. A value with no settled shape declines.** When the program makes a
value whose shape depends on a run-time value, the compilation declines with
the code `'unsettled-shape'`, and `unsupported` holds the node: with
`x: real`, `If(x > 0, [1, 2], 3) + 1` declines, and `unsupported` is
`["If", "If(Less(0, x), List(1, 2), 3)"]`. This is the simple, sound version: it can decline
where the interpreter has a value, but it never gives a different value. "A
value with no settled shape declines", under "Fail closed", gives the
details. A fold of the elements of a collection (a `Sum` or a `Product` of
one collection, a `Reduce` or a `Scan` by `Add` or `Multiply`) declines in
the same way when the type does not settle the shape of the elements: the
element type is `any`, `unknown`, `expression`, a `broadcastable<T>`, or a
union of a number and a collection, or the source is typed `any`,
`unknown` or `value`. Such a value can be a number or a list, and the interpreter adds
two lists element by element. With
`L: list<unknown>`, `Sum(L)` declines with `unsettled-shape`, and
`unsupported` is `["L"]`; the interpreter gives `[4, 6]` for
`L = [[1, 2], [3, 4]]`. A declared element type does not make this case
compile: `Sum(M)` of an input `M: list<list<real>>` declines with
`outside-profile` ("Lists of two run-time lengths"). When the type settles the shape of the
elements, the fold reads the array with no test of its shape, on
JavaScript and on `interval-js`: with `L: list<real>`, `Sum(L)` is a loop
that adds `_.L[i]`. The compiler emits no run-time test of a shape
anywhere, so a value that could be a number or a list declines where it is
read:

- an input declared with a union of a number and a list
  (`U: real | list<real>`) or with `broadcastable<real>` (`Max(2b)`);
- `Max` or `Min` of an operand that can be a number or a list: with
  `S: indexed_collection`, `Min(Distance(S, (1, 2)))` declines;
- an indexed `Sum` or `Product` whose term is a list, over bounds that can
  give no term, when the type of the sum states no length: at an empty
  range the interpreter gives the number `0` (or `1`), and a list
  otherwise. With `L: list<real>` and `n: integer`, `Sum(L·i, i, 1, n)`
  declines, and so does the corpus case
  `\sum_{i=1}^{\mathrm{Length}(U)} \begin{cases}i & C=U[i]\\0 &
  \top\end{cases}` with `C` and `U` lists. Over two integer constant bounds
  with at least one term, from a constant at most 0 to a length
  (`Sum(L·i, i, 0, Length(L))`, CE-1567), or with a term of a stated length (`L: list<real^2>`), the
  terms are added element by element and the sum compiles
  (`compilation/ir/README.md`, "Lists", CE-1470); so are terms that are
  tuples or lists of tuples (`Sum(P_k·k, k, 1, 4)` with
  `P: list<tuple<real, real>>`, CE-1568);
- a fold of a list of points (`Sum(L)` with `L: list<tuple<real, real>>`:
  "a term that is not a number");
- a recursive function whose list or tuple result has no stated element
  type (the point function `Q(i) = \operatorname{PointList}(1, 0)` for
  `i ≤ 0` and
  `\operatorname{PointList}(Q(i-1).x + Q(i-1).y, Q(i-1).x - Q(i-1).y)`
  otherwise, whose inferred result is a union). Declared
  `(real) -> tuple<real, real>`, `Q` compiles on JavaScript and `Q(3)` is
  `(2, 2)`; GLSL, which has no recursion, declines it.

`Max` or `Min` of one operand typed as a list compiles:
`Min(P·(1 − v) + Q·v)` with `P, Q: list<real>` gives `1` at `P = [1, 2]`,
`Q = [3, 0]`, `v = 0.5`.

**R4. A declared union of shapes at an input or a parameter declines.**
Compiled code has no test of a shape: with
`y: real | tuple<real, real>` and `f := t ↦ 2t`, `f(y)` declines with
`outside-profile` ("the input y of type real | tuple<real, real>"), and so
does `Sum(U)` with `U: real | list<real>`. The host compiles one function
for each shape.

**R5. The compiler assumes that every value holds its static type.** It
emits no test of it, for the values of the program and for the values of the
host.

- A value of the program: where the static type of an assigned value, or of
  the result of a call, does not prove the declared type, the compilation
  declines. With `x: real`, `Block(Declare(p, "real"); p ≔ (x, 2); p)`
  declines with `'unsettled-shape'`. With `h` declared `(number) -> number`
  and `h := t ↦ [t, t]`, every call of `h` declines; the interpreter gives
  an `incompatible-type` error for `h(3)`. An argument is not such a value:
  an argument value outside its parameter's type is unspecified (see
  "Caveats of compiled code"), so `Apply((t: integer) ↦ 2t, y)` with
  `y: real` compiles and gives 4 at `y = 2`. A call of a named function still
  declines an argument of another lane: with `g` declared
  `(integer) -> integer`, `g := t ↦ 2t` and `y: real`, `g(y)` declines with
  `outside-profile` ("an argument of g that is not integer"), since the
  compiled function has an integer parameter.
- A condition: compiled code does not test at run time that a condition
  of `If` or `Which` is a boolean. A condition whose static type admits
  another value declines: with `c: boolean | integer`, `If(c, 1, 2)`
  declines. The interpreter gives an unevaluated form for such a value. A
  predicate has no run-time check either: `Filter(L, t ↦ t)` is an error
  of the canonical form (`static-type-error`), and a predicate whose arms
  have two types (`t ↦ If(t > 0, True, 0)`) declines.
- A value that the host gives outside the declared type of an input: the
  result is undefined. It can equal the value of the interpreter, differ
  from it, throw or not end, and it can differ between targets. With
  `x: real`, `x + 1` gives `2` for `x = true` and `"ab1"` for `x = "ab"` on
  `javascript`. An `At` read of a list input with a run-time index is the
  helper `_at` of the code, which gives `NaN` for an index out of range and
  does not test the shape of the element it reads. With
  `h := v ↦ v[1] + 1` and `xs: list<real>`, `h(xs)` declines ("an argument
  of h that is not tuple<real>").
- An input that the host leaves out: the result is undefined in the same
  way. On `javascript`, `x > 0` compiles to `0 < _.x` and gives `false` for
  `run({})`, and `If(x > 0, 1, -1)` compiles to an `if` on `0 < _.x` and
  gives `-1`. With `L: list<real>`, `Sum(L)` compiles to a loop over
  `_.L.length`: `run({})` throws a `TypeError` on `javascript`, and gives
  `{ kind: 'entire' }` on `interval-js`.
- A non-finite value (`NaN`, `±Infinity`) for an input declared `real` is a
  value outside its type (`real` holds only finite values). Today the
  `javascript` target computes with the IEEE value (`x + 1` gives `Infinity`
  for `x = Infinity`), and a GPU target can assume a finite value (it can
  fold `a - a` to `0`). This is an observation of the current code, not a
  guarantee. A host that needs a defined result for such a value declares
  the input `real | signed_infinity | nan`, where `NaN` and `±Infinity` are
  values of the type.

**R6. The runner converts few values, and checks few.** The checks that R5
makes unnecessary are removed: compiled code does not test an input for
absence, an argument against the declared type of its parameter, or the
width of a point. On `javascript`, `run()` and `runtime.load()` keep these
entry steps, one constant-time step for each binding:

- a number given for a binding read as complex is lifted to `{re, im: 0}`;
- the unsigned pole `~oo` (a `{re, im}` value with a nonzero imaginary part
  and an infinite part) given for a binding read as real is projected to
  `Infinity`;
- any other `{re, im}` value given for a binding read as real is refused with
  a `TypeError` that names the binding;
- a string or a typed array (`Float64Array`, …) given for a binding that the
  code reads as an array is refused with a `TypeError` that names the
  binding.

The two refusals are kept because the refused values are values of some
declared types (`number`, `indexed_collection`) that compiled code cannot
read correctly: it would read a string as UTF-16 code units, not as
characters. Each other value outside its type gives an undefined result.
`broadcast()` does not refuse a boolean for a number binding, or any value
for a `string` binding. The entry check of a value kind (see "Value kinds")
and the integer checks of the `bigint` mode (see "Compile modes") are
separate, and stay. `compile(expr, { entryChecks: false })` turns the entry
steps off.

**Guidance to hosts.**

- Declare the type and the shape of each input that you will pass:
  `ce.declare("x", "real")`, `ce.declare("L", "list<real>")`,
  `ce.declare("P", "tuple<real, real>")`. An input with no type declines
  (R1). An undeclared input has only the type that the compiled expression
  requires of it; `ce.infer(exprs)` declares the types that several
  expressions require.
- When an input can have two shapes, compile one function for each shape.
  An input declared with the union (`real | tuple<real, real>`) declines
  (R4).
- Supply every input that `freeSymbols` lists, with a value of its declared
  type. `freeSymbolTypes` gives the type and the form that the code reads
  for each one. When a value can be missing, test it before the run: the
  compiled code does not test it, and the result for an input left out is
  undefined (R5).
- A value outside its type gives an undefined result. To get a defined
  result for `NaN` or `±Infinity`, declare the input
  `real | signed_infinity | nan`.

## Fail closed

Compilation is an optional acceleration route. A target emits code only when
it can give the interpreter's value within the caveats above, with the
interpreter's effects and evaluation count. Unsupported heads,
representations, guards, or numeric lanes decline with a structured
diagnostic. They never emit code that gives a wrong finite value or a wrong
shape for a program with inputs of their declared types.

With fallback enabled, a decline returns an interpreted runner. With fallback
disabled, the decline is visible to the caller. Runtime exceptions from
successfully compiled user code are not silently reinterpreted.

**What is guaranteed.** For a well-typed expression whose inputs are
supplied and hold values of their declared types (or, for an input with no
declaration, the type that the engine infers), the compiled value is the
interpreter's value within the caveats above. An expression that has a sub-expression that is invalid,
or whose static type is `error`, declines on every target: `"ab" + u` and,
with `ADD = (x, y) ↦ x + y`, `ADD("ab", u)` both decline. The result of the
decline has the token `ErrorCode` in `unsupported`, which a host reads to tell
an error in the expression from an operator that has no lowering; its
diagnostic has the code
`'static-type-error'` and the kind `'correctness'`. The check walks into every
operand, which includes every `If`/`Which` branch, the bodies of function
literals and the values of a dictionary: `If(u > 1, ADD("ab", u), 1)` declines,
also when the branch is not taken. It also walks into the body of each user
function, and into the stored value of each symbol, that the code reaches by
a name that is free where it occurs (the compiler emits that body and
inlines that value). A name bound where it occurs (a parameter, the index of
a `Sum`, a name that a `Block` statement assigns, after that statement, a
`vars` key, a function or an operator that the caller replaces) is not
followed to its global definition. Every node, a bound symbol and a call of
a bound name included, still declines when its own static type is `error`.
Type inference can read that type from the global definition of the name, so
this simple version can decline where the interpreter has a value: with a
global `G` whose body has the type `error`, `G() + u` declines; a symbol that a `Block` assigns, such as `v` in
`Block(v := 1, v + 1)`, declines in the same way when its stored value has
the type `error`. The value of an assignment reads the outer name:
`Block(G := Equal(G(), 1), G)` calls the global `G`. The check does not go
into a `Hold`.
Every other case is unspecified: the compiled code can give any value,
`NaN`, or throw, and the host validates its inputs if it needs to.

- An error that the static type does not show: `If(u > 1, "ab", 1) + 1` (its
  static type is `integer`) can give `"ab1"` on `javascript`;
  `Sum(p, k = 1..u)` with `p: boolean` can give `2`.
- An input value outside its declared type: `"ab"`, `true`, `[1, 2]` or
  `{re, im}` for an input declared `real`.
- An argument value outside the declared type of the parameter that it
  binds (user decision 2026-11-19, CE-1503). The interpreter checks the
  argument at the binding; the compiled code does not. With `E:
  list<nan | real>`, `((H: list<real>) ↦ Length(H))(E)` at `E = [NaN]`
  gives `1` on `javascript`, where the interpreter gives
  `Error(incompatible-type, list<real>, vector<nan^1>)`. The host keeps the
  arguments within the parameters' types if it needs the interpreter's
  value.
- A non-finite value for an input declared `real` (`real` holds only finite
  values). Today the `javascript` target computes with the IEEE value, as it
  would for an input declared `real | signed_infinity | nan`, and a GPU
  target can assume a finite value (`a - a` is `0`, `a/a` is `1`). This is
  an observation, not a guarantee. `NaN` and `±Infinity` keep their meaning
  in an input declared `real | signed_infinity | nan`.

  On GLSL a call of `sin`, `cos`, `max`, `min` or `clamp` is the built-in,
  whose value for a non-finite or `NaN` argument the GPU decides: the
  compiler has no NaN-safe helpers.
- A value outside a declared range (`7` or `-2` for `real<0..5>`): every
  target may use the range. `javascript` and GLSL drop `|x|` for `x` in
  `real<0..5>`
  (`Abs(x)` at `x = -2` gives -2), takes the real function of it in the
  complex mode, and GLSL drops the domain guard of a logarithm of an input
  declared `real<1..9>`.
- An input left out: with `x: real`, `x > 0` gives `false` on `javascript`
  for `run({})` (see R5 in "Shapes are settled at compile time", and
  `docs/ERROR-MODEL.md`, "An unsupplied variable").

**One exception: a `number` result of the `bigint` mode.** In the `bigint`
compile mode of the JavaScript target, a `bigint` or a `boolean` result is
the value of `evaluate()`. A `number` result (`NaN` or `Infinity`) means
that a sub-expression had no finite value, and it need not equal the value
of `evaluate()`: with `n: integer`, `n! > 5` at `n = −1` gives `Infinity`,
and the interpreter gives `False`. A `bigint` cannot hold a non-finite
value, and the one catch that returns the `number` skips every operator
between the pole and the result. See "Compile modes", "The `bigint` mode".

**An input with no type declines.** The compiled code reads each input (a
free symbol of the code, as `freeSymbols` lists it) in one shape, and the
shape comes from the type of the input. An input whose static type is
`unknown` or `any`, because nothing declares it and the compiled expression
requires no type of it, declines on every target: with `M` undeclared, `If(M < 3, M, 0)`
declines, where the code read `M` as a number and gave `0` for `M = [1, 5]`
(the interpreter gives `[1, 0]`). The `unsupported` list of the result has
the name of each such input (`["M"]`), and the diagnostic has the code
`'untyped-input'` and the kind `'correctness'`. A host declares the input
(`ce.declare("M", "real")`), or commits the types that its expressions
require with `ce.infer()`, before it compiles.

An input with no declared type has the meet of the types that its
occurrences require: the occurrences in the compiled expression, in the
assigned values that the code folds, and in the bodies of the functions that
the code calls. A type that only another expression requires is not used,
because boxing writes no definition: after `a = ce.parse('x + 1')`,
`compile(ce.parse('x > 1'))` declines with `'untyped-input'`, and compiles
with `x: number` after `ce.infer([a, b])`, where `b` is the second
expression. The result of an operation (`subs()`, `simplify()`, …) does not
carry the types that the operation required of a symbol that the host made
before it: with `q = ce.symbol('q0')`,
`compile(ce.parse('a \\cos(x)').subs({ a: q }))` declines, and
`ce.infer()` of that result does not type `q0`; the host declares `q0`. A
name of the library that an expression reads as a variable (`N` in `N + 1`)
has no type until it is declared, so `compile(ce.parse('N + 1'))` declines.

A declared union of shapes
(`real | list<real>`) is a type: it is not named in `unsupported`, and the
compilation declines (R4). A parameter of a
function literal, of a user function or of the root function is not an input
and is not refused: `t ↦ 2t` compiles, and a list passed to its untyped
parameter is a value outside the type that the body implies (`2t` reads a
number), so the result is unspecified. A transparent alias of `unknown` or
`any` (`ce.declareType("U", "unknown", { alias: true })`) is that type, so
an input declared `U` declines. A local of a block or of a function body
(a name that it declares, or assigns first at its own level) is not an
input. The variable of an indefinite integral (`\int x^2 dx`) is an input,
with the type of its declaration outside the integral. The compiled code
never writes an input: a write to a name that the code does not declare
declines (see "Block locals" below). The
check runs after the code was generated: when the expression also declines
for another reason (an operator with no lowering, a value with no settled
shape, a timeout), that reason is the `error` and the diagnostic, and
`unsupported` also has the names of the inputs with no type. In both cases
the compilation declines.

**A value with no settled shape declines.** The compiled code gives each
value one shape, which its static type settles. An `If`, a `Which` or a
`Match` whose branches have conflicting shapes (a number and a list, a point
and a list of points) declines on every target: `If(x > 0, [1, 2], 3) + 1`
declines, also when the conditional is in the
body of a user function that the code calls. The `unsupported` list has the
conditional as `toString()` writes it, and the diagnostic has the code
`'unsettled-shape'` and the kind `'capability'`. The values that a function
body or the root can give (the value of each `Return` that belongs to it,
also through a `Loop`, and its last value) are compared in the same way,
and a `Return` of a
nested function literal belongs to that literal: with `M: list<real>`,
`At(Apply(a ↦ Block(If(Length(a) > 1, Return(First(a))), Reverse(a)), M), 1)`
declines, because the body gives a number or a list. This simple version
compares only the branches whose type settles a shape: a branch of type
`unknown`, `any`, `broadcastable<T>` or a union of shapes is not compared,
and a
conditional over a collection condition, which selects element by element,
is not checked when its branches change nothing. When a branch of such a
conditional assigns a name or has a `Return`, a `Break` or a `Continue`, it
declines with the code `'unsettled-shape'`: the compiled code cannot run a
branch for some elements only. With `L: list<real>`,
`Block(p ≔ 0; If(L > 0, p ≔ 5); 2p)` declines. A condition of type `any`
can be a list, and the interpreter then selects element by element: with
`M: list<any>`, `Block(p ≔ 0; If(M[1], p ≔ 5); 2p)` declines. A condition
of type `unknown` (an untyped parameter of a function literal) declines on
JavaScript, which does not test at run time that it is a boolean (R5); on
the other targets it is read as a boolean, so the branches of its
conditional are compared as alternatives.
On the targets that are not shaders, a conditional whose
value the code discards is not checked: a statement of a `Block` that is not
its last one, the body of a `Loop`, and a branch of such a conditional:
`Block(Declare(n, "real", 0); If(x > 0, [1, 2], 3); n)` compiles on
JavaScript. A conditional whose condition is a list (an element-wise
selection) declines: with `F: list<boolean>`, `If(F, (1, 2), (0, 0))`
declines ("a list where a scalar is required"). An input whose type admits a
point and another shape declines (R4): `Abs(q)` with
`q: list<number> | tuple<number, number>`, and, with `p` undeclared,
`PointList(p.y, p.x)`, which infers `collection<any> | tuple` for `p`.

The compiled code gives each variable one representation, which its type
selects. So, in one scope, the values that the code assigns to a name, and
the type of the name (declared, or inferred from its uses), must have one
shape class: a number, a complex number, a string, a list, a point or a
matrix. The length of a list is not part of its shape, so a local assigned
`[1, 2]` and then `[1, 2, 3]` compiles. Otherwise the compilation declines
with the code `'unsettled-shape'`. A reassignment with a value of another
type is a static error of the language (`assignment-type-mismatch`), so
`Block(p ≔ 0; p ≔ [1, 2]; p)` and `Block(Declare(p, "real", 0); p ≔ (x, 2);
p)` decline as invalid expressions. A number and a complex number are both
of the type `number`, so the static error does not separate them, and
this check does: with `x: real`, `Block(p ≔ 1; If(x > 0, p ≔ √(-x)); p)`
declines in mode `strict` (see "Block locals" below). A type that a `Declare` states and that admits
several shapes (`real | list<real>`, `broadcastable<number>`) is not
checked, as a declared union of an input is not refused. The parameter of a
function literal has the type of the parameter (and, for a literal that
`Apply` applies where it is written, the type of each scalar argument), so
`p ↦ Block(Loop(p ≔ [i, i], i ∈ [1, 2, 3]); 2p)` declines. A name is a new
variable only where it is certainly one: a parameter of a function literal,
a name that a `Declare` of a `Block` declares (in that block), and the index
of a clause. Every other occurrence of a name is the same variable, so two
locals of the same name with no `Declare`, in two function bodies, are
compared as one. This is the simple, sound version of the rule (ROADMAP
CE-724 lists what a precise version would accept).

A local whose first value has the type `unknown` (an untyped parameter of
a function literal) keeps the type `unknown`: a later value does not narrow
it. Such a local selects no representation, and the compiled code reads
each use of it as a number. So when the code also gives it a value of
another shape (a list, a point, a matrix, a string), the compilation
declines with the code `'unsettled-shape'`: with `t` untyped,
`t ↦ Block(Declare(q, "unknown", t); If(t > 0, q ≔ [2, 3]); 2q)` declines.

Some assignments decline with the code `'unsettled-shape'` whatever their
shapes, because the interpreter and the compiled code do not agree on their
effect:

- In the body and in the clauses of a `Comprehension` (except the source of
  its first clause), in the clauses of a `Sum` or a `Product`, and in the
  integrand and the bounds of an `Integrate`, an assignment of a name of an
  enclosing scope, a `Return`, a `Break` or a `Continue`. The interpreter
  evaluates the body of a `Comprehension` in a scope of its own, so
  `Block(p ≔ 0; Comprehension(Block(p ≔ 5, i), i ∈ [1]); p)` is `0`; the
  compiled code of the integrand of an `Integrate` is a function of its own,
  where the interpreter changes the outer name. A name that the part binds
  (a name that a `Block` of the part declares, a parameter or a loop index of
  the part) is not a name of an enclosing scope. A local that a block of the
  part assigns with no `Declare` counts as one (ROADMAP CE-721). A `Return`, a
  `Break` or a `Continue` in the body of a `Sum` or a `Product` declines too:
  the compiled body is an expression, not a loop body (CE-721).
- In a function literal, an assignment of a name of an enclosing scope (or
  of an element of one), or a `Break` or a `Continue` that leaves it. In a
  callback (`Filter`, `Map`, `Tabulate`, `Limit`, …) the two do not agree:
  for `Filter` the interpreter does not run the callback when the result is
  not used, and for `Limit` the compiled code does not change the outer name
  (CE-720). A function can reach a callback operator in many ways (stored
  and passed by name, behind an `If`, returned by another function), so
  every such literal declines: a callback, the value of a `Declare` or an
  `Assign`, a function returned by another one, and the body of a user
  function that the code calls. Two are exempt: the root of the
  compilation, and a function that `Apply` applies where it is written,
  whose body runs once as inline code. That one still declines when a
  `Break` or a `Continue` leaves it, or when an argument is not known to be
  a scalar (it can then map over the argument and run its body zero or more
  times) and it assigns a name of an enclosing scope. A local of a function
  or of a block (a name that it declares or assigns first, with a binding
  of its own) is not a name of an enclosing scope: two user functions that
  each assign a local `t` compile.
- In a function literal, an assignment of the index of a `Loop`, a `Sum`, a
  `Product`, a `Comprehension` or an `Integrate` that encloses the literal
  (CE-723).
- In a branch of an `If` or a `Which` whose condition is or can be a
  collection, an assignment, a `Return`, a `Break` or a `Continue` (CE-722).
- A `Return` inside a `Loop`, unless that loop is the only loop around it, is
  the last statement of the function (or of the root), and has no indexing
  set: the compiled loop is a function of its own, so the `Return` ends only
  the loop, and the code after the loop would still run (CE-719). A loop
  with an indexing set declines also when it is the last statement, because
  it gives `Nothing` when it ends with no `Return` (see "`Nothing` in a
  value position declines" below).

**Block locals.** The rules of the language (`src/epsil/docs/declarations.md`)
make a local simple to compile, and compiled code adds three declines:

- A declaration has a value: `Declare(x, type, v)` at the block's own
  level. A `Declare` with no value, a `Declare` inside a branch, a loop body
  or a `Match` case, an `Assign` to a name that no scope declares, and a use
  of a local before its declaration are static errors
  (`declaration-without-value`, `declaration-below-statement`,
  `assignment-to-undeclared-variable`, `read-before-declaration`), so the
  compilation declines. No compiled code
  reads a local that has no value.
- A local can be assigned again anywhere after its declaration (a branch, a
  loop body, a nested block) with a value whose static type is a subtype of
  the type of the local (its declared type, or the type of its first value,
  where every numeric type widens to `number`). Another type is the static
  error `assignment-type-mismatch`.
- An assignment is a statement of a block, never an operand:
  `Assign(t, Assign(u, v))` and `f(a ≔ 2)` are the static error
  `assignment-in-operand`.
- A compiled block writes only the locals that it declares and the locals
  of an enclosing compiled block. A write to a symbol of the engine (a
  symbol declared with `ce.declare()` or `ce.assign()`, or a free symbol
  that the engine has already seen), an input or a `vars` name declines.
  The interpreter changes the binding of the engine, and compiled code has
  no binding of the engine to change. Return the value and let the host
  assign it, or declare a local and read the local.
- A `Block` with an assignment (or a loop) is a statement, or the body of
  a function literal, of the compiled expression or of a binder (the body
  of a `Sum`, a `Product`, an `Integrate` or a `Comprehension`), or the
  last value of one of these (the last statement of a block, a branch of a
  conditional). As any other operand it declines:
  `1 + Block(Assign(b, x), 2b)` declines. Assign the value to a local
  declared before the block.
- A block whose statements before the last are only declarations with a
  value is a value expression, and it compiles as an operand. The `where`
  clause and the `;` parse give such a block: `P + PointList(a - ⌊a⌋ where
  a ≔ 3.7x, 0)` is `P + PointList(Block(Declare(a, "unknown", 3.7x),
  a - Floor(a)), 0)`, and it compiles. Each declaration binds a new name,
  and no statement changes it after its declaration.
- A block whose last statement is an assignment or a declaration has the
  value `Nothing`, which compiled code has no form for: where its value is
  used, it declines. The JavaScript code of `[1, Block(b ≔ 2)]` gave
  `[1, 2]`, where the interpreter gives `[1, Nothing]`. A `Loop` or a
  `While` is a statement with no value: see "`Nothing` in a value position
  declines" below.
- A `vars` entry is a value, the same at each read. A string entry is
  source that the JavaScript code splices in at each read of the name
  (`x + 2x` with `vars: {x: 'q'}` is `q + 2 * q`), so it must be a plain
  read of a value (`'_.s'`, a name). An entry with an effect
  (`{W: 'nextValue()'}`) runs once for each read, or not at all; the result
  is then unspecified.

| Input                                                         | Compiled code                                      |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `Block(Declare(a, 1), Assign(b, a + 1), b)`                   | compiles                                           |
| `Block(Assign(s, 0), Loop(Assign(s, s + f(i)), i ∈ 1..n), s)` | compiles                                           |
| `Block(Assign(a, 1), If(c, Assign(a, 2)), a)`                 | compiles (JavaScript, GLSL)                        |
| `Block(Declare(a), If(c, Assign(a, 1)), a)`                   | static error: `a` has no value                     |
| `Block(Assign(a, 1), Assign(a, "x"), a)`                      | static error: `"x"` is not a `number`              |
| `f(a ≔ 2) + a`                                                | static error: an assignment is a statement         |
| `c ≔ n + 1` with `c` a symbol of the engine                   | declines                                           |
| `y ≔ Loop(…)`                                                 | declines: a loop has no value                      |
| `1 + Block(Assign(b, x), 2b)`                                 | declines: a block with an assignment is not an operand |
| `1 + (a - ⌊a⌋ where a ≔ 3.7x)`                                | compiles: a block of declarations is a value       |
| `[1, Block(b ≔ 2)]`                                           | declines: the value of the block is `Nothing`      |

The lane of a local follows its declaration: a local declared `real`,
`integer` or `boolean`, or with no stated type, holds that lane, and a local
declared with another type (`number`, `tuple<real, real>`, `function`)
declines (`compilation/ir/README.md`, "The contracts"). With `c: real` and
`x: real`, `Block(Declare(a, "unknown", 1); If(c > 0, a ≔ √(-x)); a)`
compiles in mode `strict` (the local is a real, NaN for `x > 0`), and
declines with `lane-mismatch` in mode `complex`, where `√(-x)` is complex.

**`Nothing` in a value position declines.** `Nothing` is the value of an
empty block or of a statement with no value, and the compiled result has no
form for it. So these decline on every
target where their value is used (the root, the last statement of a block
whose value is used, the body of a function, an operand): an empty block, a
block whose last statement is a declaration with no value
(`Block(Declare(t, "integer"))`), and a `Loop`. The value of a loop is
`Nothing` when it ends at the end of its indexing sets or with a `Break`
with no value, and the compiled loop does not carry the value of a
`Break(v)`, so every loop whose value is used declines:
`Loop(k + x, k ∈ 1..3)` declines, where the JavaScript code gave
`undefined`. Put the loop in a statement position and end the block with
its value: `Block(s ≔ 0; Loop(s ≔ s + k, k ∈ 1..3); s)` compiles. A loop
with no indexing set declines there too (`Loop(Return(x))`: "the value of a
Loop"), and `Return` has no compiled form, so a search loop that returns what
it finds declines: with `x: real`, `((p) ↦ Loop(If(k > p, Return(k)), k ∈
1..5))(x)` gives `3` for `x = 2` and `Nothing` for `x = 9` in the
interpreter. To compile a search loop, put the loop in a statement position,
store the value that it finds in a local, and end the block with that local:
`Block(r ≔ 0; Loop(If(k > x, Block(r ≔ k, Break())), k ∈ 1..5); r)` compiles
on JavaScript, and gives `3` for `x = 2` and `0` for `x = 9`, as
the interpreter does for this block. No compiled form gives `Nothing` when
no value is found: the initial value of the local (here `0`) takes its
place, and `r ≔ Nothing` declines. A loop in a case of a `Match` whose value
is used is checked in the same way.

**A possible `Nothing` element declines.** The interpreter keeps `Nothing`
as an element where it appears (`[1, Block()]` is `[1, Nothing]`), and
compiled code has no representation of it. A compilation declines with the
diagnostic code `'possible-nothing'` when the symbol `Nothing` is read as
an operand (`[1, Nothing]`, `If(c, Nothing, 7)`), and when a static type has
an explicit `nothing` arm: `nothing`, `real | nothing`,
`list<real | nothing>`. The types that the compiler reads are the type of a
coordinate of a `Tuple`, the element type of a source of a collection
operation that reads elements one by one (`Map`, `Tabulate`, `Scan`,
`Zip`, `Filter`, `Count` with a predicate, a `Reduce` by `Multiply`, the
aggregates such as `Sum`, `Mean` and `Max`, and the paired statistics),
the result type of the callback of `Map`, `Tabulate` and `Scan`, the type
of the operand of `IsMissing`, `Coalesce` or `AssertPresent`, and the type
of the value of a dictionary entry. `any` and `unknown` have no explicit
`nothing` arm, and do not decline here. The reason: compiled code produces
`Nothing` only from the symbol `Nothing` read as a value, or from a
statement read as a value (a loop, a block that ends in a declaration), and
both decline where they occur. A `Nothing` that the host supplies for a
value typed `any` is a value outside its type, and the result is
unspecified. A value typed `any` or `unknown` can still decline for another
rule: an input typed `any` (R1) or a value with no settled shape
(R3), such as `Sum(w)` with `w: collection<any>`. So
`Map(u ↦ If(c, Nothing, 7), [1, 2])` declines at the symbol `Nothing`.

The arms of a conditional are compared on every target, also where the
condition is known when the code is generated: the compiler keeps both arms
of `If(2 < 3, …)` (its code tests `true`). The one exception is a conditional
with an `else` arm whose arms all have a static type of one scalar kind
(integer, real or boolean): then the compiler lowers only the arm that is
taken, as the interpreter evaluates only that arm, and an arm that is not
taken does not decline the program
(`Which(1.2 <= 1, Which(x < -Sqrt(1 - 1.2^2), 1, True, 0), True, 1)` is `1`).
A name read only in the arm that is not taken is then not an input, and is
not in `freeSymbols` (`If(1 < 2, x, y)` with `x, y: real` reads `x` only).
So points of different sizes
(`If(x > 0, (1, 2), (3, 4, 5))`), a `NaN` arm beside a point
(`If(c, (x, y), NaN)`), `Which(2 < 3, [1, 2], True, 0)`,
`If(2 < 3, (1, 2), 0)` (on `glsl`) and `If(2 < 3, 0, If(x > 0, [1, 2], 3))`
(on `javascript`) decline, with the cause "arms of two types". A name read only in such
an arm is an input: with `z` undeclared, `If(2 < 3, 0, z)` declines with
`untyped-input`. These are rules R1 and R3 of "Shapes are settled at
compile time" above; the design record is
`docs/plans/2026-10-31-static-shape-compilation.md`.

A typed array for a `list` input and a string for a bare
`indexed_collection` input are values of their types. Compiled code cannot
read them correctly, so the JavaScript runner refuses them with a
`TypeError` that names the binding (see "Target boundaries"). The other
checks, which existed only for the unspecified cases, are removed (R6 in
"Shapes are settled at compile time"); the decision and the survey of these
checks are in `docs/plans/2026-10-31-compiled-code-contract-for-errors.md`.

One value carve-out is ruled (pole-encoding ruling): where the interpreter
answers the projective infinity `~oo` at run time — a division pole, a Gamma
or Factorial pole — a float-only target answers the IEEE `Infinity`. The
projection keeps the infinite magnitude and drops the direction `~oo` never
had. A pole that the compiler finds at compile time (an embedded `~oo`
constant, a constant `1/0`) declines: `x + 1/0`, `x = 1/0` and `x < 1/0`
decline. `NaN` remains reserved for the
genuinely indeterminate (`0/0`, `0 · ∞`) and for NaN propagation under
Contract B's `propagate` policy.

For a form with no value (`0/0`, `0 · ∞`, `0^0`, `Mod(x, 0)`) the
interpreter answers `NaN` on the exact route, with a float operand and
under `.N()`, and every compiled target answers the IEEE `NaN`: `NaN` in
JavaScript and `uintBitsToFloat(0x7fc00000u)` in GLSL. On `interval-js`, `0^0` and `0/0`
at a box that is that one point are `empty` (`y^x` and `x/y` at
`x = y = [0, 0]`), and a comparison with an `empty` operand is `'false'`,
except `NotEqual`, which is `'true'`; `Mod(x, 0)` is `singular`. A box that
holds such a point and others encloses the values at its other points
(`y^x` at `x = [0, 0]`, `y = [0, 1]` is `[1, 1]`). The input
spelling `Indeterminate` is `NaN` (user decision of 2026-11-02,
`docs/ERROR-MODEL.md`, "One static error, one dynamic non-value per
domain").

The projection is applied where the pole is spelled, not at the result
boundary, so a SIGNED cofactor can give the two routes different signs:
`-2 · (-1)!` folds as a whole to the interpreter's `~oo` and embeds
`+Infinity`, while the structural lowering computes `-2 · Infinity` and
answers `-Infinity`. Both agree on the infinite magnitude, which is the
promise; the sign is the direction `~oo` does not have, and a float lane
may report either. Code that must not see a signed answer at a pole should
test `Number.isFinite`, never the sign.

The carve-out also covers the ARGUMENT boundary (extension ruled
2026-08-30): a `~oo` value passed INTO compiled code projects to
`+Infinity` at entry (`isUnsignedPole`, `compilation/javascript-runtime.ts`), so one
pole has one spelling on both the produced and the boundary routes. A
genuine complex value with a nonzero imaginary part still rejects at a
real-lane entry; only the unsigned pole projects.

The projection does NOT make non-finite clause guards compilable. Float
arithmetic can degrade one non-finite class into another before a guard
runs — compiled `1/w - 1/w` at `w = 0` computes `Infinity - Infinity =
NaN` while the interpreter's operand stays `~oo` — so a parameter guard
typed `infinity` or `nan`, and a clause guarded on a non-finite VALUE
literal or their unions (`oo`, `-oo`, `NaN`, the signed pair
`+oo | -oo`), each decline the whole function. This was measured, not assumed: re-admitting the `infinity`
and `nan` guards under the boundary projection made each diverge from
the interpreter through the degradation route. Restoring compilability
here requires a tagged pole representation (a full pole lane), not a
cheaper encoding. The divergences that the projection itself causes are
accepted; the next section lists them.

### Divergences of the `Infinity` projection (user decision 2026-10-17)

Compiled code on a real target has no value for `~oo`, so it uses the IEEE
`Infinity` (above). A function of the SIGN of its operand then answers as if
the operand were `+∞`, where the interpreter has no sign to use. These
differences are accepted; they are not defects:

| Expression | Input | Compiled (JavaScript) | Interpreter |
|---|---|---|---|
| `Heaviside(x)` | `x = ~oo` | `1` | `Error(incompatible-type, "real \| signed_infinity", "~oo")` |
| `x > 0` | `x = ~oo` | `true` | `False` (`~oo` has no order, user decision 2026-10-21; before, `0 < ~oo`, not decided) |
| `\{1/x > 0: 1, 0\}` | `x = 0` | `1` | `0` (`~oo` has no order, user decision 2026-10-21) |
| `Sign(1/x)` | `x = 0` | `1` | `NaN` |
| `Floor(1/x)` | `x = 0` | `Infinity` | `~oo` |

In the first two rows, the argument `~oo` (`{re: Infinity, im: Infinity}`)
becomes `Infinity` at the entry of the compiled function. In the third
row and the last two rows, the pole is computed inside the compiled code:
`1/0` is the double `Infinity`, and the comparison, `Sign` and `Floor` read
it as `+∞`.

A CONSTANT pole in a comparison is not a divergence. A closed comparison is
evaluated by the interpreter when the code is generated, so `0 < 1/0` and
`1/0 = 1/0` are `false` on `javascript` and `glsl`, and `'false'` on
`interval-js`, as the interpreter answers (`~oo` has no order, user decision
2026-10-21). An operation of an input and an operand whose exact value is
`~oo` (`1/0`) declines, with the cause "a complex number with an infinite
part", so the interpreter gives its value: `x < 1/0` declines on the three
targets, and `x = 1/0` and `x + 1/0` on `javascript`.

A point (a tuple of numbers) divided by zero is the same case, coordinate by
coordinate. The interpreter gives `~oo` for each nonzero coordinate, and the
compiled code gives the IEEE infinity of each coordinate, with the sign of the
coordinate: with `t = 0`, `(3, 4)/t` is `[Infinity, Infinity]` compiled and
`(~oo, ~oo)` interpreted, and `(-3, 4)/t` is `[-Infinity, Infinity]`
compiled. A list of points is divided point by point:
`[(1, 2), (3, 4)]/t` is `[[Infinity, Infinity], [Infinity, Infinity]]`
compiled and `[(~oo, ~oo), (~oo, ~oo)]` interpreted. On a real target, this
is the spelling of the complex infinity, as for the scalar `1/0`. Code that
must not see a sign at a pole tests `Number.isFinite`, as above.

### A complex result with an infinite real part (user decision 2026-10-18)

The interpreter boxes a complex value with an infinite real part and a
finite imaginary part as the real infinity of the sign of its real part:
`∞ + i` is `+oo` and `-∞ + 2i` is `-oo`. Compiled code does not apply this
rule. The JavaScript complex lane adds and multiplies the two parts
separately, and returns them as they are:

| Expression | Input | Compiled (JavaScript) | Interpreter |
|---|---|---|---|
| `(1 + i) + x` | `x = Infinity` | `{re: Infinity, im: 1}` | `+oo` |

This difference is accepted; it is not a defect. The two answers have the
same real part, and the imaginary part of the compiled answer is finite, so
`Number.isFinite(result.re)` is `false` for both. Code that must treat such
a result as `+∞` tests the real part, not the imaginary part.

### Lists of two run-time lengths

The rows of an input of type `list<list<real>>` or `list<list<integer>>` can
have different lengths. On `javascript` (not in the bigint and interval modes)
such an input, a positional parameter of a root function literal or a
parameter of a user function of that type is the host's array of arrays. So
is such a list read by a user function as a free input, a part of a tuple
input (`G: tuple<integer, list<list<integer>>>`, `At(G, 2)`) and a typed
parameter of `Apply` (`Apply((m: list<list<integer>>) ↦ Length(m), L)`). It
is read in four ways: the element `g[i][j]` (`At(At(g, i), j)`), which is
`NaN` where an index is out of range of the list or of its row; row by row,
by a reader of a list that reads each row where it reads it (`Map` whose value
for a row is not a list, `Length`, `Count`, `IsEmpty`, `IndexWhere`, `Fold`,
`Reduce`; #638); the row `g[i]` at an index known at run time, negative from
the end, read by a reader of a list (#638, #639); and an argument of a call at
a parameter of that type, which takes it whole. Out of range the interpreter's
row is `Missing`: compiled, `Length(g[i])` is `NaN`, `First`, `Last` and an
element of the row are `NaN`, `IsMissing(g[i])` is `True` and
`Coalesce(Length(g[i]), -7)` is -7, as the interpreter's; a reducer of the
row (`Sum(g[i])` gives 0) and every other operator over it are unspecified.
`IsMissing` and `Length` of `If(c, g[i], g[j])` and of
`Coalesce(g[i], g[j])` give the interpreter's values: the value keeps the
absent value of the operand taken. `AssertPresent(g[i])`, the row as the
result of the program or of a user function, and the row carried by a loop (a
local that a `Loop` assigns it, the accumulator or the initial value of a
`Reduce` or a `Fold`) decline: `fr := (g, k) ↦ g[k]` declared
`(list<list<integer>>, integer) -> list<integer>` declines in
`IsMissing(fr(L, n))`, so the interpreter evaluates it. Every other read
declines with `outside-profile`, so the interpreter evaluates it:
with `g: list<list<integer>>`, `(g) ↦ g[2][1]` at `g = [[1, 2, 3], [4]]` gives
`4`, `g[2][3]` gives `NaN`, `Length(g)` gives 2, `Map(r ↦ Reduce(r, Add, 0), g)`
gives `[6, 4]`, `Sum(g[1])` gives 6 and `Length(g[3])` gives `NaN`, while
`Map(r ↦ 2r, g)` (a list of rows) declines. The size of a tree from its
adjacency list compiles as the recursive
`sz := (g, v) ↦ 1 + Reduce(Map(c ↦ sz(g, c), g[v]), Add, 0)` with `sz`
declared `(list<list<integer>>, integer) -> integer`: `sz(A, 1)` at
`A = [[2, 3], [4], [], []]` gives 4. A user function whose result
type is such a list compiles when its body is a list of rank 2 of lengths that
the body settles: with `n = 32`,
`step(g: list<list<integer>>) = map(i ↦ map(j ↦ f(g, i, j), Range(1, n)), Range(1, n))`
compiles as `(g: list<list<integer>>) ↦ step(g)` and as `step(G)` with `G`
declared `list<list<integer>>`, and `run()` returns an array of 32 arrays of
32 numbers. Its result is not such an input: `step(step(g))` declines. Two lists of
run-time lengths that differ under an element-wise operation give an
unspecified result: with
`L, M: list<real>`, `L + M` at `L = [1, 2]`, `M = [1, 2, 3]` gives
`[2, 4]` on `javascript`. The same holds for lists of points of run-time
lengths (`P, Q: list<tuple<real, real>>`): `P + Q` at lengths that differ
gives a list as long as `P` on `javascript`, or throws a `TypeError` when `Q`
is the shorter list.

Compiled `Equal` and `NotEqual` on numeric operands are the IEEE 754
comparison (`===` on JavaScript, `==` on the shader targets), with no
tolerance, as in the interpreter, which compares two numbers exactly at its
working precision (CE-1603). The values differ only by the precision of the
target: with `x, y: real`, `x + y = 0.3` evaluates to `True` at `x = 0.1`,
`y = 0.2`, because the interpreter adds the decimals at 21 digits, and the
compiled code gives `false`, because the double sum is
`0.30000000000000004` (a closed `0.1 + 0.2 = 0.3` is evaluated by the
interpreter when the code is generated, and gives `true`). The same rule
covers the element-wise `Equal`
of a list (`L = 1` with `L: list<real>` compares each element with
`===`), and the `Equal` of two lists or of two tuples of real numbers,
which is one boolean as in the interpreter (the same length, and each element equal to the
element at its index): with `L: list<real>` and `x: real`,
`x·L = [0.1, 0.2, 0.3]` at `x = 0.1`, `L = [1, 2, 3]` evaluates to `True`,
and the compiled code gives `false`, since `0.1 · 3` is
`0.30000000000000004`. `NotEqual` is the
negation of the `Equal` test, so it answers `true` on a `NaN` operand, as the
interpreter does. The value of a comparison over an absent operand is not
specified in compiled code (see "Caveats of compiled code"): with `x, y: real`,
`x = y` compiles to `(_.x === _.y)`, which is `true` when the caller
leaves out both, where the interpreter has no value.

A comparison whose value is the result (not a branch condition) is the plain
comparison, with no test for an input that the caller leaves out: with
`x: real`, `x > 0` compiles to `0 < _.x`, which gives `false` for `run({})`.
The interpreter has no value for `x > 0` while `x` has none, and the compiled
result for an input left out is undefined (R5 in "Shapes are settled at
compile time"). A `NaN` operand decides the comparison (`false`, or `true`
for `NotEqual`), as in the interpreter. See `docs/ERROR-MODEL.md`, the "An
unsupplied variable" item.

A compiled comparison is two-valued, also element-wise: each cell of a
compiled `Equal` or `NotEqual` of a list is a boolean. With
`Equal([1, Missing], 1)`, the compiled code gives `[true, false]` and the
interpreter gives `[True, False]`; the compiled cell is a value computed from
an absent operand, which the caveats of compiled code leave unspecified. A
branch condition compiles to the same code as the comparison. A condition
whose static type admits a value that is not a boolean declines (R5), and so
does a condition that is a list (an element-wise selection). `Boole` of a
boolean gives 1 or 0: with `x: real`, `Boole(x < 1)` compiles to
`((_.x < 1) ? 1 : 0)` on JavaScript and to `((x < 1.0) ? 1.0 : 0.0)` on GLSL,
and `Boole` of a list of booleans gives a list. `KroneckerDelta(a, b)` of two
scalars compiles as `Boole(Equal(a, b))`, and `KroneckerDelta(n)` as
`Boole(Equal(n, 0))`. A list operand of `KroneckerDelta`, three operands or
more, and both operators on `interval-js` decline. The rule is in
`src/compute-engine/compilation/ir/README.md`, "The contracts".

A consumer that needs tolerant equality evaluates through the interpreter, or
asks for a compile option; none exists today.

### Integer operations beyond the safe integer range

Compiled arithmetic is machine arithmetic. Every number is a double, so a
compiled `1/3` is `0.333…` and a compiled `2^1000` is `1.07e301`, where the
interpreter keeps exact values. A float result where the interpreter answers
an exact number is expected, and a sum that overflows the double range is
`Infinity`.

An operation that reads every digit of its operand is different. A double
beyond `±(2^53 − 1)` (`Number.MAX_SAFE_INTEGER`) is the rounding of the value
that produced it: `2^60 + 1` is held as `2^60`. The remainder or the common
divisor of that double is a different number, not a less precise one:
`Mod(2^60 + 1, 10)` on the double is `6`, and the interpreter answers `7`.
The compiled code has no guard of any kind for such an operand: the value
of `Mod`, `Remainder`, `GCD` or `LCM` of an integer of 2^53 or more is the
value of the double, an unspecified value. `Mod(n!, 7)` at `n = 25` gives
`6`, where the interpreter gives `0`. A closed node keeps the interpreter's
value (`Mod(2^60 + 1, 3)` is `2`). The remedy for the host is the `bigint`
mode.

`IsPrime`, `MoebiusMu`, `PrimeNu`, `PrimeOmega` and `Totient` read the
factors of their operand, so they throw a `RangeError` for an operand
beyond that range instead of answering for the double. `PrimePi` and
`NthPrime` throw past 20,000,768, where the interpreter gives an error (it
scans at most 10⁷ odd numbers, checked every 1,024). Where the interpreter
leaves the call unevaluated (`MoebiusMu(0)`, `NthPrime(0)`), the compiled
value is `NaN`. The `bigint` mode does not spell these operators.

The `bigint` mode of the JavaScript target (`compile(expr, { mode:
'bigint' })`, "Compile modes") is exact beyond this range. It computes every
integer value of an integer-typed expression as a `bigint`, so `Mod(n, 10)`
at `n = 2^60 + 1` gives `7n`, and `Mod`, `Remainder`, `GCD` and `LCM` do not
throw. It has a size limit: `Power`, `Factorial`, `Factorial2`, `Binomial`
and `Fibonacci` throw a `RangeError` when their result would have more than
1,000,000 decimal digits, where the interpreter leaves the expression
unevaluated. Both mean that there is no value, but the host receives a
different answer from each.

A closed node (no input, no local, no effect) is evaluated once with
`N()` and becomes a literal; a throw of `N()` means that the node is lowered
as written (`src/compute-engine/compilation/ir/README.md`).

## Running stored JavaScript

The code of a JavaScript compilation result reads only `_SYS` and `_`.
`@cortex-js/compute-engine/runtime` exports `createJavaScriptRuntime(options)`,
the `_SYS` that `run()` uses, with no engine behind it, so code compiled in one
place (a worker, a build) runs in another with only the numerics it calls. Its
type exposes `load`, `frame` (set with `setFrame`), `iterationLimit`, `deadline`
and `runtimeVersion`. The module also exports `sysHelpers`, the stateless
helpers that compiled code calls as `_SYS.<name>` (a runtime inherits them), so
that a host can lower its own operators the same way: the names and signatures
of its members follow the code of a compilation, and may change in any release
(compare `runtimeVersion`). `load()` evaluates
the definitions that read nothing per call (`preambleOnce`) once, as `run()`
does, and the rest (`preamblePerCall`) on every call, and applies the input
conversions of `run()` from `entryPlan`: a number given for a symbol read as
complex is lifted, the unsigned pole `~oo` given for a symbol read as real is
projected to `Infinity`, any other `{re, im}` value given for a symbol read
as real is refused, and a string or a typed array given for a symbol read as
an array is refused. Any other value outside the type of its symbol gives an
undefined result, as with `run()` (R6 in "Shapes are settled at compile
time"). The
engine-bound helpers take their state as options: `random` (draws outside a
`WithRandomSeed` frame and the integrals' Monte-Carlo samples; `null` denies),
`frame` (the enclosing frame, set with `setFrame()` and read back from
`runtime.frame.next`) and `deadline`. The option and the property
`iterationLimit` are deprecated and have no effect: `ce.iterationLimit` applies
to the interpreter only, and the passes of compiled code are bounded by the
compile option `iterationBudget` ("A limit on `Loop` passes"). A denied draw
throws a `CapabilityDeniedError`, a different class in each bundle: test
`e.name`, not `instanceof`. Tolerance, angular unit and the digits a negative
base's float exponent is read to (`reconstructionDigits`, 15 to 17 by the
engine's precision) are fixed at compile time, and compiled code always uses
machine floats.

The result and the runtime both carry `runtimeVersion`; a mismatch means the
code was compiled by another release, and `runtime.load()` refuses it, as it
refuses code with no `runtimeVersion`.

`runtime.load()` and `runtime.loadBroadcast()` also refuse code whose
`valueKinds` field names a kind type (see "Value kinds" below): such code
reads a host value for a symbol of a kind type through a check that is a
function of the host that compiled it, and stored code cannot carry a
function.

`compilation/javascript-runtime.ts` holds the helpers and imports no engine code
(`test/compute-engine/js-runtime.test.ts` bundles the entry point and checks
it). `run.SYS` is built from the same factory.

## Target boundaries

The JavaScript target supports the broadest dynamic representation. The
GLSL and interval targets expose narrower capabilities and must
decline outside them. A feature implemented for JavaScript is not implicitly a
cross-target promise.

Values crossing the compiled boundary use the target ABI. Complex values use
the documented scalar-or-`{re, im}` convention; nested collections retain
their shape. The entry steps of the JavaScript runner refuse only two kinds of
value, which compiled code cannot read correctly: a `{re, im}` value other
than `~oo` at a binding read as real, and a string or a typed array at a
binding read as an array. Every other value outside its type gives an
undefined result (R5 and R6 in "Shapes are settled at compile time").

The list carrier of the JavaScript target is the plain `Array`, in both
directions, and the contract of `run()` is: **inputs of the shape the
compiled code reads, results read-only** (decided by the user, 2026-10-13).
The runner does a constant amount of work per binding on each call — one
`typeof`, to refuse a `{re, im}` object in a real slot, lift a plain number
into a complex slot, project the unsigned pole, and refuse a string for a
binding the code reads as an array, and one brand check to refuse a numeric
typed array (`Float64Array`, `Int32Array`, …) there — and nothing whose cost
grows with an input. On a binding whose declared type proves a JS array, the
value passes as it is: its entries are never read, and a typed array is not
converted but refused with a `TypeError` that names the binding, so a host
converts it to a plain `Array` once, on its side (a typed array nested as a
row is an entry, and is not read). A
`{re, im}` object or a string at an entry of a list read on the real lane
computes with that value, as it would in plain JavaScript; the interpreter
is the route that validates. The `strict` mode, the default, reads the
entries of a `list<number>` on the real lane; the `complex` mode reads them on the complex lane (see "Complex
modes"). Any other value passes untouched, and the code reads it in the
shape of its declared type: a value of another shape (a number for a
binding declared `list<real>`) gives an undefined result. When the code then
throws, and a binding read as an array holds a number, the runner throws a
`TypeError` that names the binding and keeps the error of the code as its
`cause`: with `S: list<number>`, `Sum(S)` at `S = 5` throws
``"S" (type `list<number>`) received a number …``. A
collection, a `{re, im}` or a colour result comes back as the code built it,
with no copy: it may be a value the runner keeps for every later call (a
hoisted constant list literal, a bound symbol value, a colour of constants,
which is one object for every call), so a caller that writes to a
result changes what the next call answers. The result convention is kept —
a `{re, im: 0}` cell reads as a plain number — and a collection is copied
only when such a cell has to be rewritten, never in place. That walk, one
`typeof` per cell of a returned collection with no allocation, is the one
per-call cost at the boundary that grows with the data.

Before 2026-10-13 the runner walked every entry of a list input read on the
real lane on every call (to refuse a complex or non-numeric entry), copied a
typed-array input to a plain array on every call, and returned every
collection as a fresh array. For a kernel called 1.2 million times with a
9 801-element list input, the entry walk was the whole per-call cost (Tycho
ledger row 371, filed 2026-10-12); the typed-array copy and the result copy
were as long as the data. The engine-initiated compilations already ran with
`entryChecks: false`.

A string is the one value the entry refuses for a binding whose declared type
is a list, an indexed collection or a `collection`, bare (`indexed_collection`)
or with an element type (`list<number>`, `list<string>`). The engine reads a
string as an indexed collection of its grapheme clusters, so the bare
`indexed_collection` and `collection` types admit one, but the compiled code
reads such a binding as an array and would read the string as UTF-16 code
units: `Length(S)` of `"😀a"` would be 3, where the interpreter gives 2. The
entry throws a `TypeError` that names the binding and its declared type
instead (decided by the user, 2026-10-07). A string does not inhabit
`list<string>`, `list<character>` or `list<list<string>>`, and the
interpreter refuses it there too. A type alias is read as the type it names.
A declared type and an inferred one are checked alike: an annotated
parameter and a declared symbol, and also an unannotated parameter or an
undeclared symbol whose collection type the engine inferred from its uses,
because the compiled code reads the binding as an array in every one of
these cases. A type that a string inhabits through a text member is not
affected: `string` itself is compiled as text, and a union with a string
member (`string | list<number>`) does not compile and runs on the
interpreter. `indexed_collection<character>` and `collection<character>` are
an open case: a string inhabits them, the entry does not refuse it, and the
compiled code still reads it as UTF-16 code units. Typed arrays
are not used inside the artifact: a typed pipeline measured no faster than the
plain one on the witness that asked for it, so the container would add
per-helper result-kind rules for no gain. The measurements and the decision
are in
`docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.

### The compiler

`compile()` to `javascript`, `glsl` and `interval-js` uses the compiler of
`src/compute-engine/compilation/ir` (its `README.md` has the contracts and,
under "Options and results", the options it maps or declines). A program or
an option outside it declines with `outside-profile`, and `fallback` applies
as for any other decline: on `javascript` the result runs the interpreter,
on `glsl` the result has no code, and on `interval-js` it runs the interval
fallback ("Interval results"). An internal error is a `compile-error`. The
options `target`, `functions`, `operators`, `imports`, `preamble`,
`strictTypes` and `broadcast` throw an error that names the option;
`profile: 'ir'` and `callerLocals` are accepted and have no effect. An operator's
`compile` handler returns an `Expression`, which is lowered in place of the
node, or `undefined` to defer; a handler that returns code text declines.

An input of type `unknown` or `any` is refused, on `javascript`, `glsl` and
`interval-js`, with the `untyped-input` diagnostic (all such names in
`value`); an input of type `number` is a `real`, or a `complex` in
`mode: 'complex'`. There is no guard for an integer of 2^53 or more: `Mod`
of such an operand is the remainder of the double, an unspecified value
("Integer operations beyond the safe integer range"). The code reads the
runtime `_SYS`, and the result has the fields of stored code
(`runtimeVersion`, `preambleOnce`, `entryPlan`):
`createJavaScriptRuntime().load()` and a worker of the kernel pool load it,
and `run()` is built by the same loader. `shippable` is `false` for code
that draws or integrates.

An integral calls the quadrature of the runtime (`_SYS.irIntegrate`) and its
Monte-Carlo fallback. A sample that is not finite of a product with an exponential
factor of the variable is its value in log space when that is finite, as in
the interpreter: `∫₀^∞ x^100·e^−x dx` (its integrand is `∞·0` past about
x = 1,200) is 100!. The fallback's estimate changes between runs, as in the
interpreter (`∫₀^1000 Mod(t, 1) dt` is about 500). A product with a
rational constant `p/q` whose denominator is not a power of two is
`(p · factors) / q`, so a quotient that is an integer in exact arithmetic is
that integer (`Floor(x/49)` at 49 is 1); on GLSL the division is a helper
that gives an integer or a half-integer quotient exactly for a dividend
below 2^23. A product of a matrix (a list of rank 2 or more) with another
list, and a power of a matrix, decline: the interpreter's value is the
matrix product or power, or element by element for some operands. The
matrix operators (`MatrixMultiply`, `MatrixPower`, `Determinant`,
`Inverse`, `Transpose`, `Trace`, `RowReduce`, ...) compile on JavaScript
for a matrix whose rows have a stated length (`matrix<real^2x3>`,
`list<list<real^3>>`, a literal), and `Cross` also on GLSL and
`interval-js` (`ir/README.md`, "Matrices"): `A^2` of
`A: matrix<real^2x2>`, whose canonical form is `MatrixPower(A, 2)`,
compiles.
The result of an expression has `broadcast()`, `broadcastAsync()`,
`willUsePool()`, `runAsync()` and `willParallelize()`: each cell of a batch
is the value of `run()` at that cell, a batch has no batch body, and
`runAsync()` runs `run()` (no loop goes to the pool). With `mode: 'bigint'` it computes every integer as a `bigint`, with the
helpers, the inputs, the results and the pole of "The `bigint` mode"; a
program with a real or complex value anywhere (`n/2`, `Floor(n/3)`,
`n < 7/2`, a real input), and the option `vars`, decline with
`outside-profile`, not `bigint-lane`. A colour (`Rgb`, `Hsl`, `Hsv`,
`Oklab`, `Oklch` of three channels, and the five `As*` conversions of a
colour) is a `CompiledColor` object, and so is the value of the other
colour operators (`ColorMix`, `ColorContrast`, …: `compilation/ir/README.md`,
"The colour lane"). `ColorToString` of a constructor, a name of one, a
conversion of one to its own space or a tuple of three numbers, in a format
that is absent or a string literal, is the interpreter's string; an alpha, a
list of colours, a colour input or string, `ColorToString` of another colour
and `ColorFromColorspace` decline.

With `to: 'glsl'` the compiler takes a scalar
or a list result of stated length (a point `vec2(cos(t), sin(t))`; a list of
2 to 4 numbers is a `vecN`, another length a `float[n]`) of real, integer or
boolean inputs and of inputs that are tuples or lists of a stated length
(`At(L, k)` with a run-time index is NaN outside the list), to
a result with no `run`: `code` is an expression, or statements that
end in `return`, in which an input is its bare name, or its `vars` text (a
name, a member or an element of one, such as `u_x`, `u.P` or `u[0]`; the
name stays in `freeSymbols`); `preamble` holds the helpers (`_gpu_ir_…`) and
the user functions (`_fn_ir_…`); `freeSymbolTypes[name].lowered` is `float`,
`bool`, `vecN` or `float[n]`. A shader cannot throw, so the pass cap is
the option `iterationBudget` (10,000 by default), counted
by loop: a `Sum` or a `Product` of more passes is `NaN` (a list of `NaN`
of the term's length for a list term), and a program
whose loops can run more passes in all, bounded at compile time (a constant
count multiplied down the nesting, a run-time count as one pass), declines.
Loops of run-time counts, nested or one after the other, compile; when they
can run more passes in all than the cap, the code counts every pass in one
counter and gives `NaN` past the cap. It has no NaN-safe helpers and no
exact sine hash: an operand of `Mod` or `Fract` in which a constant of
magnitude 1000 or more amplifies a trigonometric value has the warning
`float32-unsafe-argument`.
A user function can return a point or a list of a stated length, and read
an input that is a point, a list in storage or a list of at most 4
elements; an element-wise operation over a list of more than 64 elements
declines. A list parameter declared with no length (`list<integer>`) takes
the stated length of the argument of the first call of its function; a call
whose argument has another length, or no stated length, declines. With `storage: { S: 'sampler2D' }` the list input `S`
is read from the host's texture (a single-channel float texture, one
element per texel, row-major from texel (0, 0), read at level 0 with no
filtering; `_gpu_ir_texel`), by `At`, by a reduction or an element-wise operation, and
in a user function, which takes a `sampler2D` parameter; `S` as a value
declines. A user function takes every input that its body reads as a
parameter.
A colour result (`Rgb`, `Hsl`, `Hsv`, `Oklab`, `Oklch`, `AsOklch`) is an
OKLCh `vec3`; `AsOklab`, `AsRgb`, `AsHsv` and `AsHsl` give the
`vec3` of their space and are admitted only as the result of the program;
an alpha declines. `AsHsv` and `AsHsl` of a colour of their own space (a
constructor, a name whose value is one) keep its channels; of a colour that
can be of that space at run time (an `If` of colours, a call of a user
function, `ContrastingColor` of three colours) they decline. `ColorMix`, `ColorContrast`, `ColorDelta`,
`ContrastingColor`, `GamutMap`, `ColorToColorspace` and `Color` of a string
literal compile (`compilation/ir/README.md`, "The colour lane"). A name whose value is a colour
constructor of three real numbers (`Hsv(270, 0.4, 0.95)`) is that
constructor of literals, on both targets, as a name that holds a number. A
user function may return a colour (declared `color` or inferred); a colour
parameter declines.
Anything else, and the options it does
not map (the README lists them), decline with `outside-profile`; with
`fallback`, the result has no code.

**The predicate.** `canCompile(expr, options)`, exported from
`@cortex-js/compute-engine/compile` beside `compile()`, tells whether
`compile(expr, options)` gives code, on each of the three targets. It runs the
whole compilation with `fallback: false`, emission included, so it costs as
much as `compile()`, and answers `{ ok: true, shippable }` when it gives
code, or `{ ok: false, diagnostic }` with the diagnostic of the decline. It
never throws: an invalid expression or an invalid option gives `ok: false`
with the message of the error. Its answer depends only on the expression,
the options and the declarations that the expression reaches (the types of
its free symbols, the definitions of the functions it calls), so a host can
keep it until one of those declarations changes.

### Interval results

The `run` of an `interval-js` compilation gives one shape for each kind of
value (decided by the user, 2026-10-18):

- A scalar value is always a kinded `IntervalResult`:
  `{ kind: 'interval', value: { lo, hi } }`, `{ kind: 'empty' }` (no value
  over the cell), `{ kind: 'entire' }` (no bound is known), a `singular`
  result (a pole, or a jump with its enclosure), or a `partial` result (a
  value over part of the cell only). The runner never gives a bare
  `{ lo, hi }`. A constant (`5`, `π`), a bare variable (`x`) and a block that
  returns a local gave one before 2026-10-18, while a computed value
  (`x + 1`) gave the kinded form; the runner now wraps such a value. An
  enclosure whose lower bound is `NaN` is the absent marker of the compiled
  code, bare or carried by an `interval` or `partial` result (an operation
  over an absent operand), and the runner gives `{ kind: 'empty' }` for it:
  `Min(L)` with `L = []` gives `empty`. A broadcast over lists whose lengths
  differ at run time is an error that the static type does not show, so its
  value is unspecified: with `L`, `M: list<real>`, `Sum(L + M)` at
  `L = [1, 2]`, `M = [1, 2, 3]` gives the point `6`. Lists of two lengths
  that the types state (`[1, 2, 3] + [1, 2]`) decline, and so does a
  conditional whose undecided arms are a number and a list
  (`unsettled-shape`).
- A collection value (a list, a range, a tuple, a point) is an array of these
  values, nested as the collection is. Each element is wrapped in the same
  way: `[x, 3]` over `x = [−1, 1]` gives
  `[{ kind: 'interval', value: { lo: −1, hi: 1 } }, { kind: 'interval', value: { lo: 3, hi: 3 } }]`.
- A relation is a tri-state verdict: the string `'true'`, `'false'` or
  `'maybe'`. An ordered comparison or an `Equal` with an `empty` operand
  (no value over the cell) is `'false'`, as the scalar targets answer
  `NaN > 0` with `false`; with a `partial` operand it is at most `'maybe'`.
  A `NotEqual` is the negation of `Equal`, so with an `empty` operand it is
  `'true'`, as the scalar targets answer `NaN ≠ 0` with `true` (user
  decision 2026-10-25, ROADMAP CE-396). With a `partial` operand it is
  `'true'` only when the enclosures do not overlap, since `≠` holds where
  the operand is undefined. An absent operand is an `empty` result, and the
  verdict of a relation over it is unspecified.

The interpreter fallback (`success: false`, with `fallback` not `false`)
gives the same shapes. It evaluates at the midpoint of each input, so it
gives a bound only when every input is a point: then a number is the
`interval` result of a point only when the interpreter's value is exactly
that double (an integer, `1/4`), and otherwise `entire` (`Gamma(0.3)`, a
quadrature, `1/3`: no double is the value); a boolean is `'true'` or
`'false'` only when every number it is computed from is exact (an input
counts as the double it was given), and otherwise `'maybe'`, since the
interpreter compares the values at its working precision, not their doubles
(`Gamma(0.3) < 2.991568987687591` is `True` at 21 digits); and an absent
value is `empty`. Over an input wider than a point,
and for an expression that draws a random number, a number is `entire` and
a boolean `'maybe'`.

A root whose value is a function (a `Function` literal, a block whose value
is one, a symbol whose value is one) is never given as a function value.
The result has `calling: 'lambda'`, as a root `Function` literal has on
the JavaScript target: `run` takes the arguments of the function, each converted as a variable of a vars object is (a number
is a point interval), and gives one of the shapes above. `x ↦ 2x` with
`run(3)` gives `{ kind: 'interval', value: { lo: 6, hi: 6 } }`, and with
`run({ lo: 1, hi: 2 })` the enclosure `[2, 4]`. There is no vars object, so
such a root declines when it reads a free symbol (`x ↦ a·x`), and the
result has no `broadcast()`. The root must be a literal, a symbol or a block
whose value is one of these: the interval lowering of an `If` takes the hull
of its arms and `When` wraps its value as an interval result, so neither
gives a function. A function-valued `If` or `When` at the root reads no free
symbol, so its condition is a constant: it is evaluated at compile time, and
the function it selects is the root (`If(1 > 0, x ↦ 2x, x ↦ 3x)` is
`x ↦ 2x`; a nested `If` is selected in the same way). The root declines when
the condition is not decided: it has an effect (`If(Random() > 2, x ↦ 2x,
x ↦ 3x)`, where the interpreter draws on each call), it does not evaluate to
`True` or `False`, or it is the `False` condition of a `When` (the
interpreter gives no function). The branch that is
not selected is still checked: when it is invalid or has a sub-expression of
static type `error`, the root declines for it. An `If` that is the last
statement of a block is not selected, since its condition can read a local
of the block, and declines. A function whose value is a function
(`x ↦ (y ↦ x + y)`) declines too: the runner converts the arguments of the
outer function only. The interpreter fallback of a declined function-valued
root has `calling: 'lambda'` as well: it evaluates `Apply(expr, …)` with
each argument boxed by the type of its parameter (an array for a `tuple`
parameter is a point; `'true'` and `'false'` are booleans for a boolean
parameter only), and a function value gives `{ kind: 'entire' }`. Before 2026-10-31 `run` gave the compiled
JavaScript function over enclosures, which a caller could not call with
numbers (ROADMAP CE-726).

A conditional whose condition is undecided over the cell gives the hull of
its arms. When one arm is `empty` — the missing default of a `Which`, or an
arm with no value, such as an `At` out of range — the other arm is present
over part of the cell only, and the hull is that arm clipped as an undecided
`When` clips it: an `interval` becomes `partial`, and a list is clipped
element by element. `Which(x < 0, 1)` over `x = [−1, 1]` gives
`{ kind: 'partial', value: { lo: 1, hi: 1 }, domainClipped: 'both' }`; before
2026-10-18 it gave an `interval` result, a value claimed over the whole cell
(`hullValues`, `interval/comparison.ts`).

## A limit on `Loop` passes

A compiled `Loop` has no count of its own. On JavaScript,
`Block(k := 0, Loop(k := k + 1), k)` (the loop in a statement position)
compiles to a loop of 2^53 passes, which in practice does not return: only a
deadline of the engine (`ce.withTimeLimit({ ms: 500 })`) stops it, and GLSL
and `interval-js` decline it. The interpreter stops the same loop at
`ce.iterationLimit`. A host that runs an imported document sets a limit when
it compiles the code:

```js
const { run } = compile(expr, { iterationBudget: 1e6 });
run({}); // throws a CancellationError with the cause `iteration-limit-exceeded`
```

**What counts.** Each iteration of a `Loop` adds one to one total for a call of
the compiled code. The three shapes of the loop count the same way: no indexing
set, a counted range and a for-each over a collection. The total covers nested
loops and the loops in the bodies of user functions, because a limit for each
loop would allow the budget squared for two nested loops. `Loop(body,
Element(i, I), Element(j, J))` counts as the two nested loops that it is equal
to: one for each element of `I`, and one for each element of `J` under it. A
guard counts its element also when it refuses it, and an outer clause counts
when its inner source is empty. Otherwise `Element(i, 1..4e9, i < m)` with `m` at
0 would run for all of its elements with no check. A budget that is not an
integer is floored.

**Over the limit.** The code throws a `CancellationError`, with the cause
`iteration-limit-exceeded`. A `Loop` has no value to replace, and the statements
after it would read partial state, so the `NaN` of an over-budget `Sum` does not
apply. No compiled `catch` takes the error, and it does not start the
interpreter fallback (see "Fail closed"). On `interval-js`, `run()` and `load()`
throw it too, and they do not answer `{ kind: 'entire' }`: the call stopped, and
that says nothing about the inputs.

**A batch.** `broadcast()` keeps its rule that a cell catches its own error: the
cell over the limit gives `NaN` (on `interval-js`, an `error` cell), and the next
cell starts at 0. The budget applies to each cell, so a batch costs up to the
number of cells times the budget. Only the slice form counts the failures
(`BroadcastSlice.failures`): a synchronous `broadcast()` gives the `NaN` with no
report.

**A function value.** The total is for one call, so the code needs a place to
start it in each call of a function. A `Function` literal at the root has one,
and so has a function-valued root on `interval-js`. Any other code whose value is
a function declines when it counts passes, with an error that names
`iterationBudget`: with `countTo` a user function, `compile(ce.symbol('countTo'),
{ iterationBudget: 5 })` and `Block(f := Function(…), f)` decline. Without this
rule the reset would run once, when the value is made, and later calls would
share one total, so a valid call would throw. A `Function` literal whose body
gives a function declines for the same reason.

**A count, not a time.** The limit is deterministic: a test and two machines
stop at the same pass, and the check reads no clock. A host that wants a time
limit measures the cost of a pass.

**With no limit, no check.** Without the option, the emitted code has no count.
With the option and no `Loop`, the code of a `Sum` or a `Product` keeps its
own rule and the code has no reset.

**The mechanism.** Each iteration starts with `_SYS.countLoopPass(n)`, or
`_IA.countLoopPass(n)` on `interval-js`, and the code resets the total first:
`_SYS.resetLoopPasses()` is the first statement of the body of each call of
the entry (`ir/print-js.ts`), and `_IA.resetLoopPasses()` runs at each call
on `interval-js` (`ir/print-interval.ts`). The total is on the runtime and
not in a local of the code, because the definition of a user function lives
outside the entry, and stored code reads only `_SYS` and `_` (see "Running
stored JavaScript"). The runtime of `createJavaScriptRuntime()` and the
interval runtime both carry the counter (`makeLoopPassCounter()`).

**Targets.** A shader cannot throw, so GLSL has a cap of its own, with a default
of 10,000 passes and `NaN` over it ("The compiler"); a `Loop` with no
indexing set declines there.

**Not covered.**

- A `Sum` or a `Product` keeps its own rule: the loop gives `NaN`, or the
  `entire` interval on `interval-js`, before its first pass.
- A `Comprehension` has no count, and a guard that keeps few elements can run
  over a long range: `Comprehension(1, Element(i, 1..m, i < 0))` with `m` at 3e7
  runs all of its elements.
- A helper of the runtime over a list that exists is finite, and one long call
  inside a pass is not interrupted.
- On the JavaScript target, a `Loop` over `Element(i, Range(lo, hi))` of more
  than 2^32 passes stops on the budget's `CancellationError` when the budget is
  below 2^32. With a larger budget, such a loop throws a `RangeError` before its
  first pass, or, for a loop with a `Break`, past 2^53 passes. A `Range` held as
  a list value of more than 2^32 elements throws the `RangeError` too, with or
  without the option. On `interval-js`, the count of a `Range` of 2^32 elements
  or more gives `entire` before the first pass, with or without the option: the
  mode computes no length of 2^32 or more (`_IA.rangeCount()`).
- A call that the compiler folds at compile time runs no pass: with
  `g(n) := Block(s := 0, Loop(s := s + 1, Element(i, 1..n)), s)`, the code of
  `g(3)` is `3`, whatever the budget.
- The expression of a decline runs in the interpreter, which applies
  `ce.iterationLimit` and not this option.
- The fill of a parameter default in the `run()` of a `Function` literal has a
  total of its own, before the total of the body.
- A host function that calls compiled code on the same runtime from inside a
  pass resets the total of the outer call.

The numeric ladder of `Limit` compiles its samples with this option
(`LIMIT_PROBE_ITERATION_BUDGET`), and the host has not set it. So a compiled
sample over that budget reads as `NaN`, the signal at which the ladder stops, as
for a `Sum`: the limit of `n ↦ Block(s := 0, Loop(s := s + k^(-3), Element(k,
1..n)), s)` at infinity gives about 1.2020569, and does not throw. A host that
compiles the same function with the option itself gets the throw.

## Compile modes

The `mode` option selects how the compiled code computes numeric values:
`strict`, `complex` or `bigint`. The `javascript` target offers the three
modes, and `interval-js` offers `strict` only. `glsl` offers `strict` and
`complex` (an input of type `number` is a `vec2`). A request for a mode that the target does not offer
declines with the code `'unsupported-mode'`. The default is `strict` on
every target. The first two modes select how the code handles complex
values (below). The `bigint` mode selects how it computes integers ("The
`bigint` mode", at the end of this section).

The mode `auto` was removed in the release after 0.177.0 (user decision of
2026-11-02, `docs/plans/2026-11-02-language-axes-options.md`, §6). A
request for it declines with `'unsupported-mode'` on every target, with a
message that names `complex` as its replacement. The result fields
`promoted` and `escalation` were removed with it.

| Input                                                            | 0.177.0 (default `auto`)            | Now (default `strict`)                         |
| ---------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `Sqrt(x)`, `x: real`, at `x = -4`                                | promoted; `{re: 0, im: 2}`           | `NaN`; `{re: 0, im: 2}` with `mode: 'complex'` |
| `x + 2i`, `x: real`                                              | complex, static                      | complex, static, unchanged                     |
| `h = (p) ↦ p[1] + 1`, `P: list<tuple<complex, real>>`, `h(P[1])` | lane recorded, restart               | `lane-mismatch` decline; compiles with `mode: 'complex'` or `(p: tuple<complex, real>)` |
| `f = (x) ↦ x^2` compiled real, called with `2i` by the host      | restart in complex mode              | outside the type, unspecified                  |
| `compile(e, {mode: 'complex'})`                                  | complex                              | complex, unchanged                             |
| `compile(e, {mode: 'auto'})`                                     | `strict` plus promotion and redo     | `unsupported-mode` decline                     |

`strict` is the only discipline that the default uses. The lane of a value
is complex when its static type is complex (a declared `complex` input or
parameter, a complex literal, an operation whose result type is complex),
and real otherwise. A binding typed `number` is real: the value given
there must be real (see "Caveats of compiled code"). An operation whose exact value is complex on a real lane
gives `NaN` (see "Caveats of compiled code"). A complex-shaped value that
reaches a binding the compilation shaped real declines with
`'lane-mismatch'`; the compilation is not redone in another mode.
`complex` compiles wide numeric scalar bindings through the complex
functions of the runtime (`_SYS.ir`, `COMPLEX_FUNCTIONS`;
`compilation/ir/README.md`, "The complex lane"). A list input whose cell
type admits a complex value (`list<number>`, `list<complex>`) declines in
the `complex` mode: a run-time test would be needed to tell a number cell
from a `{re, im}` cell.
In the `complex` mode an unknown-sign radical or logarithm (`Sqrt`, `Ln`,
`Log`, an even `Root`, a non-integer `Power`) is promoted to the complex
kernel. A kernel compiled in the `complex` mode returns a JavaScript
number when its value is real and a `{re, im}` object only when the
imaginary part is nonzero: `Sqrt(x)^2` at `x = -4` is the number `-4`,
`Sqrt(x)` at `x = -4` is `{re: 0, im: 2}`. The result records its mode and,
on a decline, its diagnostic.

So `Mean`, `Variance` and the other statistics of data that may hold a
complex entry run on the interpreter in the `complex` mode. In the `strict`
mode a `list<number>` input is read on the real lane: `Mean(L)` compiles,
and a complex cell is a value outside the type.

A `Power` or a product of a matrix declines ("The compiler"): an input of
type `list<list<real>>` (read only by `M[i][j]`) or `tensor<number>` is outside the profile
(`outside-profile`), and an input of the bare type `list` or `list<unknown>`
declines with `unsettled-shape` (R3). The interpreter gives the matrix power
or product.

A function declared with a real result type (`p: (real) -> real`) whose
body is complex on its lane declines with `outside-profile` ("a body of p
that is not real"). With `p := k ↦ sin(2.4k)·√((k − 0.5)/16)`, `p(x)`
declines in the `complex` mode, where `√` of an operand of unknown sign is
complex; in the `strict` mode the body is real, computes
`Math.sin(2.4 * k) * Math.sqrt(0.0625 * (k + -0.5))`, and is `NaN` at
`x = 0`. A body that is real in the `complex` mode keeps its complex
operations: with `p := k ↦ |√k|`, `p(x)` at `x = -4` is `2`, as the
interpreter computes it. An argument on the complex lane at a parameter
declared `real` declines with `lane-mismatch`: with `p` declared
`(real) -> real`, `p(√y)` declines in the `complex` mode.

A function whose result jumps at a point (`Floor`, `Ceil`, `Round`,
`Sign`, a comparison) of an exact rational constant that no double holds
takes the jump of the nearest double: `Floor(n + (25! − 1)/24!)` at `n = 1`
gives 26, where the interpreter gives 25 (see "Known limitations"). A
product with a rational constant `p/q` whose denominator is not a power of
two is `(p · factors) / q`, so a quotient that is an integer in exact
arithmetic is that integer ("The compiler").

A real-only head (an ordering comparison, `Floor`, `Mod`, `Max`, `Min`,
`Erf`, …) of an operand on the complex lane declines in the `complex` mode:
`Floor(Sqrt(x))` declines ("Floor of complex"), and so does
`Floor(Sqrt(L))` with `L: list<real>` ("Floor of list<complex>"). In
`strict` mode such an operand is real, and a real operation outside its
domain is `NaN`. The options `complexPromotion` and `realOnly` are not
options of `compile()` and have no effect: `Sqrt(x)` compiled with
`complexPromotion: true` is the `strict` code, `NaN` at `x = -4`. A compiled
value whose imaginary part is exactly zero is returned as a plain number, so
a consumer tests `typeof v === 'number'` per sample and maps a `{re, im}` at
its own value boundary.

The remaining quiet-machine performance measurement is tracked in
`plans/2026-08-16-compile-complex-mode.md`.

### The `bigint` mode

**What it is for.** In the other modes every number is a double, so an
integer past `2^53 − 1` is rounded, and `Mod`, `Remainder`, `GCD` and `LCM`
of such an operand give the value of the double ("Integer operations
beyond the safe integer range"). The `bigint` mode computes every integer
value as a JavaScript `bigint`, so a counting function (a binomial sum, a
ballot number, the unranking of a Dyck path) is exact at any size. With
`n: integer`, the Catalan form `Binomial(2n, n) − Binomial(2n, n + 1)` at
`n = 40n` gives `2622127042276492108820n`, and `Mod(n, 10)` at
`n = 2^60 + 1` gives `7n` (GitHub issue #503).

**How to request it.** `compile(expr, { mode: 'bigint' })`. Only the
`javascript` target offers it; another target declines with
`'unsupported-mode'`. The mode is used only when a host requests it: no
compilation detects an integer past `2^53` and changes to `bigint`, and a
request for `bigint` compiles once, with no retry in another mode. The
result reports `mode: 'bigint'`. The lowering is the one of the `strict`
mode, with a signature of each operation whose result is an integer, a
boolean or an element, and a printer that spells each operation exactly on
`bigint` values (`compilation/ir/README.md`, "The `bigint` mode", which
lists the operations).

**Which nodes compile.** Every value is an integer or a boolean. The
arithmetic of integers (`Add`, `Subtract`, `Negate`, `Multiply`, `Abs`,
`Mod`, `Remainder`, `Max`, `Min`, `Sign`, `Power` with an exponent proved
nonnegative, `Factorial`, `Binomial`, `Choose`, `GCD`, `LCM`, `Fibonacci`),
the comparisons (also a chain, `0 < n < m`), `And`, `Or`, `Not`, `If` with
an else, `Which` with a `True` clause, `Block`, `Sum` and `Product` with
integer bounds, `List`, `Range`, `Length`, `At`, `Sort`, `Map`, `Filter`,
`Reduce`, `ReplaceAt`, `Loop` and user functions with integer parameters
compile. A loop counts with a `bigint` index, so `Sum(Mod(k, 7), k = 1..n)`
is exact at any `n`.

**What declines.** A node off the integer lane declines with the code
`'bigint-lane'`; an operator that the mode does not spell declines with
`'outside-profile'`. The expression then runs on the interpreter, as every
decline does. Examples, with `n`, `m: integer` and `x: real`:

| Expression                                    | Reason of the decline                                         |
| --------------------------------------------- | ------------------------------------------------------------- |
| `n + x`, `n + 10π`                            | a real value                                                  |
| `Floor(n/3)`, `n < 7/2`, `Sum(i, i = 1..n/2)` | a rational constant has no `bigint` value                     |
| `Floor(Sqrt(n))`                              | `Sqrt` of an integer is not an integer                        |
| `n^m`                                         | the exponent is not proved nonnegative (`n^m` is a rational at `m < 0`) |
| `Factorial2(n)`                               | its value is not an integer (`(−5)!! = 1/3`)                  |
| `If(n < 0, n)`                                | an `If` with no else has the value `NaN`                      |
| `IsPrime(n)`, `DigitSum(n)`, `String(n)`      | an operator that the mode does not spell                      |

`Floor`, `Ceil`, `Round` and `Truncate`, `Max` and `Min` of a list, a
`Sum` or a `Product` with an `iterationBudget`, a draw, an integral and
the option `vars` decline too.

**Inputs.** An integer input takes a `bigint`, or a `number` that is a safe
integer. The emitted code converts a `number` with `BigInt()` at each read,
also with `entryChecks: false`. With the entry checks on (the default), a
`number` that is not a safe integer throws a `TypeError` that names the
input: `"n" was compiled in mode 'bigint' as an integer, and received the
number 1.5. Pass a bigint, or a number that is a safe integer.` With the
checks off, a `number` that is not an integer throws the `RangeError` of
`BigInt()`, and another value outside the type gives an unspecified result.
A `list<integer>` input is an array of `bigint`. With the entry checks on,
its `number` cells are converted in a copy, and a cell that is not an
integer throws a `TypeError` that names the cell; with the checks off, the
host must give `bigint` cells.

**Results.** A result on the lane is a `bigint` for every finite integer,
also a small one, and a list result is an array of `bigint`. A boolean
result is a `boolean`. A result is a `number`, `NaN` or `Infinity`, when a
sub-expression had no finite value (a pole): a helper at a pole throws a
`NonFiniteValue` that carries the `number`, and one catch around the
compiled entry returns it. `Infinity` is the value for a `~oo` of the
interpreter (`(−1)!`), and `NaN` for a form with no value (`Mod(n, 0)`, an
index out of range). A pole in one cell of a list makes the whole result a
`number`.

A `number` result has no defined relation to the value of `evaluate()`.
This is the exception to the rule of "Fail closed". The compiler does not
test where a pole can occur: the throw ends the whole computation, so no
operator receives a non-finite value and no finite result is computed from
one, but the operators between the pole and the result do not change the
`number`. Examples at `n = −1`:

| Expression                   | `evaluate()`                | Compiled                   |
| ---------------------------- | --------------------------- | -------------------------- |
| `n! > 5`                     | `False`                     | `Infinity` (not a boolean) |
| `Map(k ↦ k!, Range(−1, 1))`  | `[~oo, 1, 1]`               | `Infinity` (the whole list) |
| `If(n < 0, 0, n!)`           | `0`                         | `0n`                       |

A host that needs the value at such an input evaluates the expression with
the interpreter.

**The size limit.** `Power`, `Factorial`, `Binomial` and `Fibonacci`
estimate the number of decimal digits of their result before they compute
it. Past 1,000,000 digits, the limit of the interpreter, they throw a
`RangeError` that names the operation: `Fibonacci(n)` at `n = 10^9` throws
"Fibonacci(1000000000): the result has about 208987640 decimal digits, more
than the limit of 1000000 of the bigint mode". The interpreter leaves such
an expression unevaluated. Both mean "no value", but the host receives a
`RangeError` from the compiled code and an unevaluated expression from the
interpreter. The loops and the `*` operator have no limit:
`Product(k, k = 1..n)` computes `n!` with no limit. A host that compiles
expressions it does not trust limits its inputs.

**Constant folding.** A closed node on the lane is the exact value of
`evaluate()`: `Mod(2^60 + 1, 10)` compiles to `7n`, and no rounding occurs.
A closed node whose value is not an integer (`(−1)!`, `Mod(5, 0)`) is
lowered as written, so its helper throws the pole where it is evaluated.

**The batch runners refuse the mode.** `broadcast()` and `broadcastAsync()`
call the code for each element and write `Float64Array` outputs, which
cannot hold a `bigint`. In the `bigint` mode they throw an error whose
message starts `Code compiled in mode 'bigint' cannot be broadcast`. The
code that `load()` rebuilds gives the same values as `run()`, because the
conversion of the inputs and the catch are in the emitted code.

Design and the deferred shapes (ROADMAP CE-715.2 to
CE-715.8): `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`.

## User functions and dispatch

A user function is lowered once per compilation, keyed by its definition
(`compilation/ir/README.md`, "User functions"). A compiled artifact contains
each user function as it was defined when `compile()` ran. Assigning a new
definition later does not change an artifact that is already compiled. The
public `compile()` keeps no cache: each call compiles again and reads the
current definitions.

A recursive or mutually recursive user function compiles to real recursion on
the JavaScript target, with no depth guard: a runaway recursion throws a
`RangeError` from the JavaScript stack, as an unbounded `Loop` already runs
without a guard. The shader targets cannot recurse, so a recursive function
declines there ("a recursive function (…) on glsl").

### A string at a collection parameter

A string is a collection of its characters, so a parameter that the body
reads as a collection has a collection type: in `s ↦ Length(s)`, `s` is a
`collection`. Compiled code on JavaScript holds a scalar string (an input of
type `string`, a literal, the text operators: "The string lane" of
`src/compute-engine/compilation/ir/README.md`) and a list of strings (a
literal, `Characters(s)`, a list operation or an input, read by `StringJoin`,
an element read, `Sort` or as the result), but no collection read of a string, so `g(t)` with
`g := s ↦ Length(s)` and `t: string`,
and `g("abc")`, decline (`outside-profile`) and run on the interpreter;
`Length(t)` compiles. Every other target declines a string.

### Function values

Compiled code calls a function only when it can see the callee (user decision
of 2026-11-02, options page 5, option B, in
`docs/plans/2026-11-02-language-axes-options.md`). A call of a defined
function compiles, and so does a function literal at the call site: the
callback of `Map` or `Filter` written as a literal of one parameter
(`Map(x ↦ 2x, L)`), and an `Apply` of a literal. A library operator given
by its name to `Map` compiles (`Map(Sin, L)`). A derivative callee,
`Apply(Derivative(f, n), x)` (the parse of `f'(x)`), compiles when `f` is a
defined function: the code is the closed form of the derivative
(`f := t ↦ t^3` gives `3 * (_.x * _.x)` for `f'(x)`).

Every other function value declines, with a reason that names the form:

- a partial application or a curried call: `Apply(Apply(f, 1), u)`;
- a function value passed as an argument to a user function (`h(x ↦ x + u)`)
  or held in a block local (`Declare(h, "function", t ↦ 2t)`);
- a parameter of the root declared with a function type
  (`(h: (real) -> real) ↦ Map(h, [1, 2])`);
- `Sort` with an ordering function;
- a function literal applied to itself, `Apply(f, f, L)` with
  `f = (self, t) ↦ If(Length(t) = 0, 0, First(t) + self(self, Rest(t)))`
  (#639): the argument `self` is a function value passed to a function.

A recursion compiles written as a named user function with a declared
signature (see "User functions and dispatch": real recursion on JavaScript,
no depth guard, a decline on the shader targets). With `T: list<integer>`,
`ce.declare("s", "(list<integer>) -> integer")` and
`s := t ↦ If(Length(t) = 0, 0, First(t) + s(Rest(t)))`, `s(T)` compiles and
gives 6 at `T = [1, 2, 3]`, as the self-application above does in the
interpreter. Without the signature the parameter `t` has the type
`indexed_collection<number>` and the call declines ("the parameter t of s is
not a scalar"). A recursion into a tree whose depth is not stated (a list of
lists of lists...) has no settled shape and declines in either form.

The interpreter keeps first-class functions: lambdas, closures, currying,
partial application and function values.

### Parameters with a default value

A parameter with a default value (`(x, k = 2) => x * k`, the MathJSON
parameter `["Optional", "k", 2]`) is filled when a call leaves its argument
out, and only then. A call written with fewer arguments is completed at
canonicalization: its canonical form already holds the default (`f(3)` is
`f(3, 2)`).

Compiled code has no default parameter. A function literal with a parameter
that has a default declines ("a parameter that is not a name"), also as the
root of the compilation and as the callback of `Map`, and so does a call of
a user function that has one (`g(x)` and `g(x, 4)` with
`g := (y, k = 2) ↦ y k`). Such a program runs on the interpreter. The rest of this section is the interpreter's rule.

An absent value supplied at a defaulted position, written or computed, is
passed through as the argument. The interpreter then applies the rule of
`Missing` (`docs/ERROR-MODEL.md`): `g(First([]))` with
`g = (k: real = 2) ↦ k + 1` passes `Missing` to `g`, and the call is
`Missing`. This reverses the "or absent" half of rule R6 of
`docs/plans/2026-11-01-absent-value-contract.md` (user decision of
2026-11-02).

A default is a constant: a number, a boolean, a string, `[]`, `{}`, or a
constant symbol. A constant symbol is one of two kinds
(`isConstantSymbolDefault()`):

- a constant: a symbol that the scope of the declaration binds to a constant
  value definition. This is a constant of the standard library (`Integers` in
  `over: set = Integers`, `Pi`), or a symbol that the host or the program
  declared constant (`ce.declare('W0', { isConstant: true, value: 5 })`, an
  Epsil `const`);
- a symbol that the parameter type lists as a literal symbol type: `Auto` in
  `mode: symbol<Auto> | symbol<Manual> = Auto`.

The default is boxed once, where the function is declared, and a call that
leaves out the argument receives that symbol, as if the call had written it.
Nothing is read where the call is made: a local of the same name in the scope
of the call does not change the default. A default that names a variable
(`(k = n) ↦ k` with `n` a user symbol), or a symbol that is not declared and
that no `symbol<…>` parameter type lists, is a static error whose message
says to write a constant or to pass the argument. A default on a function
with a rest (variadic) parameter is a static error too
(`boxed-expression/parameter-defaults.ts`,
`canonicalFunctionLiteralArguments()` in `function-utils.ts`, and the Epsil
parser's `default-value-invalid`).

### Variables that a function assigns

A function literal compiled to JavaScript can assign a variable of the
engine that it closes over, such as the state of an animation:

```js
executeEpsil(ce, `let s = 0.5
let advance = (t: real) => do { s = s + t / 1000 }`);
const result = compile(ce.box('advance').evaluate());
result.assigns;            // ['s']
result.run(16);            // NaN: the body ends in an assignment (Nothing)
ce.box('s').evaluate();    // 0.516
```

Each call of `run()` reads the value of each variable of `assigns` in the
engine, runs the code, and writes the new values back to the engine as
machine numbers, as an evaluation of the call writes them. An exact value
(`1/30 * pi`, which an interpreted call can write) is read as its machine
number. A call that throws writes nothing. A variable that holds no value,
or a complex number for a variable of type `number`, throws a `TypeError`
before the call, as an input of type `number` does. The `code` takes the value of each variable
after the arguments and returns an array of the value of the function and
the new value of each variable: `load()` of the code gives
`f(16, 0.5)` → `[NaN, 0.516]` and reads no engine. Such a result is not
`shippable`, and the engine's own compilations (`Map`, the quadrature and the
other implicit callers) interpret the function: they can compute an element
a second time.

The variable is a variable of the scope of the compilation, not a local or a
parameter of the literal, with a declared type whose lane is `real`,
`integer` or `boolean` (`let s = 0.5` in Epsil declares `s`), or a list of
such values of no stated length (`let L = [0, 0, 0]` declares
`list<number>`). A list variable is a list local that the body writes whole,
and its length can change at each call: `L = L + [1, 2, 3]`,
`L = Append(L, t)`, `M[2] = M[2] + 1` and `M[2] += 1` compile. The code takes it as an
array and returns its new value as an array; `run()` reads its elements in
the engine (also a list that an interpreted call holds lazily, such as
`Rest(List(1, 2, 3))`) and writes back a `List` of machine numbers or of
booleans. These decline:

- another target, `interval-js` and the `bigint` mode;
- a variable whose type is inferred from its value (`ce.assign('u', 1)`
  with no declaration): declare its type;
- a constant, a tuple, a string or a complex variable, a list of lists
  (`let g = [[1, 0], [0, 1]]`), a list of a stated length and a list of
  points;
- a variable with no value at the compilation, and a name of the `vars`,
  `symbolic` or `inputs` option: it is an input of the host;
- a value of another lane: `n = n + 0.5` for `n: integer`;
- a user function that the body calls and that reads the variable
  (`let get = () => s` and `do { s = s + 1; get() }`), and one that assigns
  it;
- an expression that is not a function literal and assigns a variable
  (`Block(Assign(s, s + 1))`).

A function that only reads a variable still holds its value at the
compilation as a literal (`pure = (t: real) => s + t` gives `0.5 + a0`).

### Functions of the host

Compiled JavaScript calls a function that the host declared with
`ce.declare()` and an `evaluate` function, such as the `draw` of a notebook:

```js
ce.declare('hostDraw', {
  signature: '(real) -> nothing',
  evaluate: (ops) => { record(ops[0].re); return ce.symbol('Nothing'); },
});
executeEpsil(ce, 'let tick = (t: real) => hostDraw(t / 1000)');
const result = compile(ce.box('tick').evaluate());
result.hostCalls;          // ['hostDraw']
result.run(16);            // NaN: the value Nothing; record(0.016) ran
```

Each call in the code evaluates the call in the engine, as the interpreter
evaluates it, at each evaluation and in the order of the program: two equal
calls are two calls, a call in a `Sum` is made at each pass, and a call
with constant arguments is made when the code runs, not when it is
compiled. One exception: a `Map` builds every element, so a call in its
callback is made for each element, also where the interpreter's lazy `Map`
reads fewer positions (`First`, `At`, `Length` of the `Map`; "Known
limitations"). The value is read on the lane of the static type of the
call: a machine number (an exact value such as `Sqrt(3)` is read as its
number; NaN for a value that is not a real number, and for a call that
`evaluate` leaves unevaluated, which is not evaluated again), a boolean (a
`TypeError` for another value), or nothing. The code calls the definition
that the call was bound to, also where the engine holds another definition
of the name when the code runs (a scope pushed later). The `code` calls the
engine, so `load()` and the batch loaders refuse it with an error that names
the functions, and the result is not `shippable`. The
engine's own compilations (`Map`, the quadrature and the other implicit
callers) interpret the function, as for `assigns`.

A function of the host is a definition with an `evaluate` function that is
not of the library, not lazy, and not a function literal, a definition with
clauses or a method of a protocol (those are the program's own functions).
These decline:

- another target, `interval-js` and the `bigint` mode;
- an argument that is not a real, an integer, a boolean or a string (a list,
  a tuple, a complex number), and more than four arguments;
- a static type of the call other than `real`, `integer`, `boolean` or
  `nothing`: `(real) -> any` gives no settled shape (R3);
- a value `nothing` read anywhere but as the value of the root function
  literal (`[hostDraw(t)]`, `'possible-nothing'`); a statement is not read;
- a call in a function that assigns a variable of the engine
  (`do { s = s + t; hostDraw(s) }`): the host function could read the
  variable before the code writes it back.

A value of a named tuple type of the program is a record on JavaScript
(`compilation/ir/README.md`, "Records"; CE-1652): each field has a settled
shape, from its declared type, or, for a field typed `any`, `list` or
`string | color | nothing`, from the value that the constructor receives. With
`type P = tuple<x: real, y: real>` and `f(t: real) = P(cos(t), sin(t))`,
`f(t)` compiles, and `run({ t: 1 })` gives the object `{ x: 0.5403…,
y: 0.8414… }`; a `Nothing` field is `null`. A `Tuple` or a `List` of
elements of several lanes (`[t, "a"]`) is a record with no names, an array at
`run()`. A record is read at a constant position only (`p.x`, `q[1]`). Two
records of one engine type whose fields have different shapes (a filled and
an unfilled `Figure`) are two shapes, so an `If` with a run-time condition
whose arms give them declines (R3). GLSL, `interval-js` and the `bigint` mode
decline a record. A parameter of a user function of no stated type, of type
`any` or of a named tuple type takes a record (one of no stated type or `any`
also a string or a colour), and the function is compiled once for each type
of record it is given: with `shift(p: P, d: real) = P(p.x + d, p.y)`,
`shift(P(cos(t), sin(t)), 1)` compiles. A parameter of a named tuple type
takes a record of that type only (R5), and a recursive function whose
parameter or result is a record declines. A list of elements of several lanes
given to a parameter that the interpreter maps over a list (`tag(x) =
("sample", x)`, `tag([t, "a"])`) declines; a tuple there is passed whole
(`tag((t, "a"))` compiles). A local declared with no type widens a real to
`number` (`docs/TYPE-SYSTEM.md`, "Initialization-defined Program and Block
contracts"), so `let m = fig.matrix` is a `tuple<number, …>`, and a field
typed `real` given `m[1]` declines (R5). A local declared with a tuple type
declines too; read the field where it is used (`fig.matrix[1]`), or declare
a local of each element (`let a: real = fig.matrix[1]`). A record
passed to a function of the host, and a method of a protocol, still decline
(CE-1652, steps 4 and 5).

## Collections

Compiled broadcasting preserves the interpreter's strict lifted regime.
Compiled pairing preserves shortest-input semantics. `PointList`, elementwise
selection, Map lowering/fusion, exact-map proof, and collection callbacks must
retain evaluation-once and effect ordering.

A `PointList` with list components compiles on the JavaScript target to a
map over the shortest component, scalar components repeated in each point.
The `iterationBudget` option is not applied to the length of the list: the
code builds every point, also past the budget (at `L = [1, 2, 3, 4]`
with `iterationBudget: 2`, `PointList(L, 2L)` gives four points). Compiled
code need not cap its iterations: "Hosts that care about this can run in a
worker to avoid blocking the main thread" (user ruling of 2026-11-16, which
replaces the truncation of the user decision of 2026-07-31).

A restriction `value\{conditions\}` (`If(conditions, value)`) whose
condition is a scalar compiles: its value is `NaN` where the condition is
false (`x\{y > 0\}` at `y = -1`). The value of a restriction of a flat list
of numbers or of a list of points (`(x·L)\{x > 0\}` with `L: list<real>`)
is then the list of `NaN` (of points of `NaN`) of the length of the list,
where no operator can tell that list from an absent one: as the result of
the program; as the list that `At`, `First` or `Last` reads
(`At((x·L)\{x > 0\}, 1)` is `NaN`, the absent element; an `At` with a list
or a `Range` as index gives a list of `NaN`, which must be read in one of
these ways too); as an operand of
`Max`, `Min`, or of a `Sum` or a `Product` with no index (`NaN` where the
interpreter gives `Missing`); and as an operand of arithmetic whose own value
is read in one of these ways (`2·(x·L)\{x > 0\}` as the result,
`At(2·(x·L)\{x > 0\}, 1)`). A compiled list is never absent, and the
interpreter's value is `Missing`: a restriction of a list that another
operator reads declines (`IsMissing`, `Coalesce`, `AssertPresent`, `Length`,
`Rest` and the other list operators, a binding, an argument of a function, an
element of a list, also through arithmetic: `Length(2·(x·L)\{x > 0\})`),
because the list of `NaN` would give a finite value there (`Length` gives 3
where the interpreter gives `Missing`). A restriction that is the value of a
name (`C` declared with the value `If(0 ≤ x ≤ 6, x + [0, 4, 2])`) compiles
where each occurrence of the name in the program is in one of these places
(`At(C, 1)` is `NaN` at `x = 7`); it declines when the program also reads the
name in another way (`At(C, 1) + Length(C)`), and when the value of another
name or the body of a user function that the program reaches has the name
(`M` with the value `At(C, 1)`, `g(t) ≔ t + At(C, 1)`). A length that the
restricted value makes itself (`Range(1, ⌊x⌋)\{x > 0\}`) declines too. A restriction whose condition is a list (an
element-wise selection, `x\{L > 0\}` with `L: list<real>`) selects position
by position, as the interpreter (`docs/BROADCAST-MODEL.md`); a restricted
list is read to the shorter of the condition and the list.

`Chunk(L, k)` and `Partition(L, n)` whose rows can have different lengths
(`L: list<real>` of run-time length, a last row that is shorter), and the two
groups of `Partition(L, p)`, compile on the JavaScript target when `L` is an
input or a literal list of numbers or booleans: as the result of the program,
`run()` returns an array of plain arrays and the compilation result has
`rows: true` (no batch form: `broadcast()`, `broadcastAsync()` and the batch
loaders throw); a consumer that reduces each row, `Map(r ↦ Sum(r), Chunk(L, k))`,
`Length(Partition(L, n))` or `At(Partition(L, p), 1)`, reads the rows one by
one. Where the interpreter leaves the form unevaluated (a count below 1, a
count of `Chunk` above 10,000), a constant count declines and a count known at
run time throws a `RangeError`. Any other use of the value declines, and so does
`Chunk` of a computed list (a `Range`, a `Map`): the interpreter leaves it
unevaluated past `maxCollectionSize` (`compilation/ir/README.md`, "The rows
lane").

An infinite collection declines: a `Range` with an infinite end ("a Range of
an operand that is a constant infinity or NaN") and an `Iterate`, also under
`Take` or `TakeWhile`. `Sort` with an ordering function and `Pipe` decline
(`compilation/ir/README.md`, "Lists", lists the list operators that
compile).

A symbol declared `any` or `value` can hold a number or a list, and compiled
code does not test the shape of a value at run time. The JavaScript
and `interval-js` targets decline an element-wise site, `Max`, `Min`, `Sum` and
`Product` over such a symbol (a parameter declared `any` or `value`, an input
declared `value`, or a symbol declared `any` or `value` that has a value), with
the code `unsettled-shape` and the symbol in `unsupported`, and the interpreter
computes the value: `Function(p + q, p: any, q: any)` declines, and
`run([1, 2], [3, 4])` gives `[4, 6]`. The argument of a call does not change
this: the function has one body for every call, so `((t: any) ↦ 2t)(x)` with
`x: real` declines too. An input declared `any` with no value
is refused before, with `untyped-input`. The host declares the shape
(`real`, `list<real>`) to compile such a program. A shader gives each input one
fixed shape, so the GLSL target does not use this decline. An input
declared `expression` (or with an alias of it) can hold a list too, so the
JavaScript target declines a read of it as an input, and the interpreter computes the value: with
`ce.declare("x", "expression")`, `2x` declines, and `run({ x: [1, 2] })`
gives `[2, 4]`. A symbol declared `expression` with an assigned value is not
an input: its value is folded, and the expression compiles. A parameter
declared `expression` declines in the shapes that ROADMAP CE-693 lists.

**Calls.** A compiled call of a user function or of a function literal
decides at compile time, from the static types of its arguments, whether it
maps over a list argument or binds it whole, and emits no run-time test of
their shape (R2 in "Shapes are settled at compile time";
`compilation/ir/README.md`, "User functions"). With `f := t ↦ 2t`:

- An argument of a scalar type calls the compiled function: with
  `a: real`, `1 + f(a)` is `1` plus that call.
- An argument of a list type, at a parameter that the body reads as a
  scalar, maps the body over the list, as the interpreter maps it: with
  `L: list<real>`, `f(L)` is `[2, 4]` and `1 + f(L)` is `[3, 5]` for
  `L = [1, 2]`.
- A point (a tuple) is bound whole beside a mapped list, as the
  interpreter binds it: with `P: tuple<real, real>` and
  `g := (p, x) ↦ x + 1`, `g(P, L)` gives `[2, 3]` for `L = [1, 2]`.
- A parameter whose type is a collection type (`k := (L: list<real>) ↦
  Sum(L)`) takes the list whole, with no map.

**Callbacks.** The callback of `Map` or `Filter` compiles when it is a
literal of one parameter or the name of a library operator (`Map(Sin, L)`);
it is lowered as the body of the loop that builds the result. A defined
function given by its name declines ("Function values"). An input of type
`list<list<real>>` is read only by `M[i][j]` ("Lists of two run-time
lengths"), so `Map(t ↦ 2t, M)` over such an `M` runs on the interpreter.

An argument on the complex lane at a parameter declared `real` declines
with `lane-mismatch`: with `p` declared `(real) -> real`, `p(√y)` declines
in the `complex` mode.

The norm of a point is computed from its coordinates: with
`n := p ↦ ‖p‖`, `n((x, 4))` is `5` at `x = 3`. An input of a tuple type
with a coordinate of no settled shape (`tuple<unknown, number>`) declines.

Implicit Map compilation obeys the engine-wide `jit` gate. Exact-mode Map
compilation requires an explicit proof that native-number execution preserves
the requested exact result. Structural or ABI failures are cached at the
appropriate expression-instance boundary.

### List updates

On `javascript` a block local whose value is a list of reals, integers or
booleans of rank 1 can be written with `L = ReplaceAt(L, i, v)` and
`L[i] += e` (`AddTo(At(L, i), e)`). The code writes the element of the
array in place, with these rules:

- The local owns its array: the declaration copies its value, so an input
  (`let L = H`) or a constant (`let L = C`) is not changed.
- A read of the whole list (`let M = L`, `f(L)`, `[L, M]`, `sum(L)`, `L` in
  the `Tuple` that a block returns) reads a copy of the array at that point:
  the interpreter's lists are values (`let M = L; L[1] += 5; M` is the old
  list), and compiled code shares no array that a write changes. The value of
  the block (its last statement `L`, also `Typed(L, …)`) is the array after
  the last write. `L` in a function literal (`map(x => L[x], [1, 2])`)
  declines, since the function could run after a later write. A copy has an
  effect, so an operation that declines an operand with an effect
  (`reverse(L)`) declines on such a read.
- The element type is the declared type of the local (`let L: list<real> =
  …`) or the type of its value. A real written to a list of integers of no
  declared type (`let L = [0 for k in 1..n]`, then `L[k] = 0.5`) puts the
  list on reals from its declaration, as the interpreter widens it; the
  elements before the write are the same numbers. A written value of
  another lane declines: a real for a declared `list<integer>` (the
  interpreter gives an `incompatible-type` error), a complex number or a
  boolean for a list of integers.
- A list of tuples (of points) written in place declines (one written
  whole compiles, below).
- A negative index counts from the end, as in the interpreter. An index out
  of range, 0 or not an integer throws `out-of-range` at run time, where the
  interpreter gives an error; a constant index out of a stated length
  declines.
- `L[i] += e` evaluates `i` once, before `e`.

`ReplaceAt(L, i, v)` used as a value, not as the right side of a write of
`L` (`let M = replaceAt(H, 1, 5)`), is a copy of the list with the element
replaced; `H` is not changed. It takes a list of reals, integers or booleans
and a value of the same kind (a real in a list of integers gives a list of
reals). A constant index that is 0 or out of a stated length declines (the
interpreter leaves `ReplaceAt` unevaluated); an index known only at run time
throws `out-of-range` there, on JavaScript only. GLSL and the interval mode
compile a constant index (GLSL: of a list of a constant length), and decline
an index known at run time.

On `javascript` a block local whose value is a list can also be written
whole, `L = value`, when every write of it in its scope is of that form
(CE-1481): a list of reals, integers or booleans of rank 1, or a list of
points of reals or integers, whose length can change at each write
(`out = [...out, (k, x, y)]`, `out = [...take(out, i), c, ...drop(out, i)]`,
`L = f(L)`). A list of a run-time length is one shape whatever its length
("Shapes are settled at compile time"), so the length can differ between
the passes of a loop and between the arms of an `if`. Each write gives a new
value and no array is changed, so any read of `L` is allowed. The type is
the declared one or that of the value (a declared empty list `[]` is the
empty list of that type); a written value of another rank, another length
of its points, or a lane that is not a sub-lane declines, except a real list
written to a list of integers of no declared type, which puts the local on
reals as above.

Every other write to a list local declines: a local with both a whole write
and a write in place (`L = [...L, 2]` and `L[1] = 5`), a tuple (a point)
written whole, an empty list of no stated type (`let L = []`), a write in a
`Sum` or a `Product` body to a list local declared outside it, and
`xs = Append(xs, v)` (the operator `Append` is not compiled). GLSL and the
interval mode decline a list local that its block writes.

### Dictionary literals

A dictionary literal declines (`{a -> x + 1}`: "not a number, a symbol or
a function"), and the interpreter computes it.

### GPU `At`

On GLSL, `At` keeps the engine's 1-based indexing. With a run-time index the
code tests the index before it reads the array: an index from the end when
negative, and NaN (`uintBitsToFloat(0x7fc00000u)`) for an index that is 0,
not an integer or out of range (`At(P, i)` with `P: tuple<real, real, real>`).
A constant index (also one that the passes fold) that is 0, not an integer
or past the stated length of its list declines, where JavaScript gives NaN:
with `P: tuple<real, real>`, `At(P, 3)` declines ("the index 3 of At is
outside the 2 elements of its list on glsl"), so that a host can key a retry
on the refusal (`compilation/ir/README.md`, "Options and results").

## Color values

A color VALUE on the JavaScript target is a flat object that carries the color
space of its channels:

```ts
type CompiledColorSpace = 'oklch' | 'rgb' | 'hsv' | 'hsl' | 'oklab';
interface CompiledColor {
  space: CompiledColorSpace;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
}
```

The five keys are always created in that order, so every color shares one
hidden class and a channel read stays monomorphic. `alpha` is present and
`undefined` when the color carries no alpha; it is never omitted. An alpha that
is absent, non-finite, or within `1e-9` of 1 is `undefined`, on the compiled
route and on the interpreter fallback alike.

The channel meaning follows the space. `oklch` holds `L`, `C` and `H` in
degrees; `rgb` holds `r`, `g` and `b` as 0-1 sRGB; `hsv` and `hsl` hold a hue in
degrees and two 0-1 components; `oklab` holds `L`, `a` and `b`.

The constructors `Rgb`, `Hsl`, `Hsv`, `Oklab` and `Oklch` of three channels
compile to members of `_SYS` (`_SYS.rgb`, …) that answer a color in OKLCh,
and the conversions `AsRgb`, `AsHsl`, `AsHsv`, `AsOklab` and `AsOklch`
(`_SYS.asRgb`, …) answer a color tagged with the space they name. Every
member reads the space that its operand carries (the internal `toOklch`),
so `AsRgb(AsRgb(c))` equals `AsRgb(c)` channel for channel. A color whose
operands are constants is computed once, when the code is loaded, and every
call shares the object (`compilation/ir/README.md`, "The colour lane").

The other color operators (`ColorMix`, `ColorContrast`, `ColorDelta`,
`ContrastingColor`, `GamutMap`, `Colormap`, `ColorToColorspace`, and `Color`
of a string literal) call the interpreter's kernels
(`compilation/ir/README.md`, "The colour lane"). `ColorToString` compiles
on JavaScript for a color whose channels the code has: a constructor, a name
whose value is one, a conversion of one to its own space (`AsRgb(Rgb(…))`)
or a tuple of three numbers; it formats them with the interpreter's kernel
(`formatColorString()` of `numerics/color-conversion.ts`). Any other color
is held in OKLCh, where the interpreter holds it in its own space, and a
rounding of its sRGB channels to a unit could differ: it declines.
`ColorFromColorspace` declines, and so do an alpha (a fourth operand), a color
input, a color string, a tuple of components other than three real numbers
at a color position (`AsRgb((x, 0.5, 0.2, 1))`), arithmetic on a color and
the `bigint` mode. A list of colors is an array of color objects on JavaScript, and
declines on GLSL.

A color value whose `space` is not one of the five spellings is not a color:
the readers switch on the space, so an object tagged `srgb` reaching a helper
through `vars` throws a `TypeError` naming the offending spelling.

Both routes read the channels of a color by one rule, `readColorChannels` in
`src/compute-engine/numerics/color-conversion.ts`:

- `Rgb` channels are extended sRGB. A finite channel outside `[0, 1]` is a color
  outside the sRGB gamut (a Display P3 screen can show it), and it is kept on
  every route: no clamp, and no gamut mapping in the conversions among `Rgb`,
  `Oklab` and `Oklch`, in `ColorMix`, or in `ColorToColorspace`. Gamut mapping
  is the job of the renderer. The sRGB transfer function is sign-extended
  (`sign(c)·f(|c|)`, as CSS Color 4 does for extended sRGB), so a negative
  channel converts to OKLab and back.
- `Hsv`/`Hsl` describe only the sRGB gamut. Their saturation, value and
  lightness are clamped into `[0, 1]`, an infinite one included (`+∞` reads as 1
  and `−∞` as 0), and the hue is reduced modulo 360. A conversion of an extended
  `Rgb` color to `Hsv`/`Hsl` first maps it into the sRGB gamut with the CSS
  Color 4 gamut mapping (`srgbGamutChannels`): the OKLCh chroma is reduced at
  constant lightness and hue, and a color inside the gamut is not changed.
- A color with a `NaN` channel, or with an infinite channel that is not clamped
  (an sRGB channel, a hue, an OKLab/OKLCh channel), is `incompatible-type` on
  the interpreter. On the JavaScript target it is the same object with `NaN`
  channels, in the space the answering helper names: the numeric projection of
  that error.

The shader helpers apply the same rule. They do not clamp an sRGB channel (the
canvas clamps at output), they clamp the HSV/HSL channels, and an infinite sRGB
or OKLab channel makes `NaN` channels through the arithmetic of the conversion.

The interpreter FALLBACK answers the same object, and CONSUMES one. A declining
color expression run under `fallback: true` comes back as
`{space, c0, c1, c2, alpha}` read off the interpreter's typed color head
(`Rgb(...)` → `rgb`, `Hsv(...)` → `hsv`, and so on), and a list of colors comes
back as an array of those objects. In the other direction, a color object a
compiled runner produced is boxed back to the head that names its space when it
is passed in as a `vars` value, recursively inside arrays, so a color can cross
from a compiled runner into a declining expression.

On GLSL a color is an OKLCh `vec3` with no run-time tag and no alpha.
`Oklch(l, c, h)` is `vec3(l, c, h)`; `Oklab` and `Rgb` convert their
channels with the helpers `_gpu_ir_lch` and `_gpu_ir_srgb_lab`, and `Hsv`
and `Hsl` convert to sRGB first with `_gpu_ir_hsv` and `_gpu_ir_hsl`.
`AsOklch` is its operand. `AsOklab` (`_gpu_ir_lab`) and `AsRgb`
(`_gpu_ir_lab_srgb`), which give the channels of their space, compile only
as the result of the program (`AsOklab(Rgb(x, 0.5, 0.2))` is
`_gpu_ir_lab(_gpu_ir_lch(_gpu_ir_srgb_lab(vec3(x, 0.5, 0.2))))`), since a
`vec3` does not carry its space; elsewhere they decline. `AsHsl` and `AsHsv`
(`_gpu_ir_hsl_of`, `_gpu_ir_hsv_of`) are admitted in the same way, and
`Colormap` declines on GLSL. The space is not a type: there is no `color<space>` in the
type lattice.

## Sums and objects

Compiled code has no tagged representation of a sum: an input whose type is
a union of shapes declines (`real | string`: `outside-profile`; R4). Mutable
boxed objects do not cross into compiled code.

## Value kinds

A value of a value kind (a residue class, an element of a finite field, a
kind declared by a host with the `arithmetic` field of an operator
definition; `TYPE-SYSTEM.md`, "Value kinds and kind types") is not a number,
and the number lowerings compute a wrong value for it with no error: `c - c`
lowered to `0`, `c / c` to `1`. So every target declines it, except an
enclosure on `interval-js` (below). A kind declared by a host has no
compiled form.

The boundary uses the STRICT recognition: an expression that holds a kind
value for certain, or whose result type is a kind type for certain,
declines, with a message that names the kind type ("holds a residue class
(type 'residue')", "holds a value of the kind type 'gf8'"). An expression
that only MAY hold a kind value (a parameter typed `number | residue`, a
symbol of a signature that admits a kind) compiles as a number, as before.

The library kinds `measurement` and `quantity` have no compiled form, and
the library kind `enclosure` has one on the `interval-js` target only
(see "The enclosure on `interval-js`" below). So an expression with a
`Measurement` or a `Quantity` value, or with an `Enclosure` value on any
other target, declines with
the kind message ("holds a value of the kind type 'measurement'"). A
physical constant symbol (`SpeedOfLight`) is declared `value`, so the strict
recognition does not see its quantity: `x · SpeedOfLight` declines at the
`Quantity` call of its value, with the message "Could not compile
`Quantity`".

**The result.** `CompilationResult.valueKinds` lists the kind types whose
representation the code reads or makes: `['enclosure']` on `interval-js`,
absent otherwise. Such code is not `shippable`, and cannot be stored and
loaded again (see "Running stored JavaScript" and "The limits kept from
phase 1" below).

**Limits.**

- An expression that holds a COLLECTION of kind values (`L + L` with
  `L: list<gf8>`, a list literal of kind values) declines on every target:
  the entry check of a kind describes one value.
- On `interval-js`, the only kind with a compiled form is the enclosure; the
  runner checks the inputs of that kind (below). A residue class, a
  measurement and a quantity decline on every target.
- A kind is never compiled through the number rules.

The design is `docs/plans/2026-10-26-value-kinds.md`, section 4.8.

### The enclosure on `interval-js`

`Enclosure(lo, hi)`, an interval that holds one real (`TYPE-SYSTEM.md`,
"Enclosures"), is the one library kind with a compiled form, on the target
`interval-js` only: the interval mode of the IR pipeline lowers it
(`compilation/ir/lower-enclosure.ts`; `compilation/ir/README.md`, "The
interval mode", "Enclosures"). Every other target declines with the kind
message. The design is section 4.9.2 of
`docs/plans/2026-10-26-value-kinds.md`, "Compilation".

**The representation.** An enclosure is the `{ lo, hi }` interval of the
`_IA` runtime
(`freeSymbolTypes.x` is `{ type: 'enclosure', lowered: 'interval',
provenance: 'declared' }`). A literal `Enclosure(a, b)` with endpoints that
are number literals or exact constants lowers to a record whose endpoints
are converted to doubles OUTWARD (`lo` down, `hi` up), the conversion of
the interpreter under `.N()`; when the canonical order of the endpoints was
not decided (`Enclosure(Sin(10^600), 0)`) the record is
`{ lo: min, hi: max }` of the converted endpoints, never reversed. A number
operand beside an enclosure is a point: `_IA.point(c)` when `c` is a
double, else the record of its outward conversion (`0.1` is
`{ lo: 0.09999999999999999, hi: 0.1 }`). A complex literal and an endpoint
with a free variable decline.

**One kernel for each form.** The lowering emits, operation by operation, the
`_IA` call that the `.N()` route of the interpreter makes for the same form
(`enclosure-arithmetic.ts`), so the compiled code and `.N()` give the same
doubles: `add`/`mul` folds, `div`, `sub`, `negate`; for a power, one kernel
for each exponent form (`square` for `2`, `sqrt` for `1/2`, `pow` for
another integer, `powRational` for a rational with an odd denominator,
`powRealBranch` or `pow` for a float exponent by the target's selection
rule, `exp` for the base `e`, `powInterval` for an exponent that is not a
point, only when the base is provably positive); a negative integer power
as `1 / x^|n|`; the step of `Round`/`Floor`/`Ceil`/`Truncate` as
`round(x / k) · k` (an exact step `1/m` or `m` through the point `m`);
`Log(x)` with `log10`, `Log(x, 2)` with `log2`,
another base with `div(ln x, ln b)`; `mod`, `hypot`, `atan2`; the unary
functions of the `apply` table through `ENCLOSURE_UNARY_KERNELS`. Three
run-time helpers of `IntervalArithmetic` (`interval/util.ts`) connect the
library's results to the interpreter's rules:

- `_IA.enclose(r)` wraps every ARITHMETIC result. It removes the metadata
  (`partial`, and `singular` with a value, give the value; `singular` with
  no value and `entire` give the whole line), because the interpreter's
  enclosure has no such marker: `Sqrt(x) < 3` run with `x: [-1, 4]` is
  `'true'`, as the interpreter's `Enclosure(0, 2) < 3` is. It answers
  `empty` (the indeterminate value) for `empty`, for a `NaN` endpoint and
  for an infinite singleton (`[+∞, +∞]` holds no real).
- `_IA.stripEnclosure(r)` is the metadata part only. The comparisons read
  their operands through it, and the extrema (`Max`, `Min`, `Clamp`,
  `ElementMax`, `ElementMin`, through `_IA.max`, `_IA.min`, `_IA.clamp`)
  wrap their result in it. It keeps an infinite singleton (`x < y` run with
  `y: Infinity` is `'true'`, and `Max(x, y)` is `[+∞, +∞]`) and the
  `empty` result, and an interval with a `NaN` endpoint (the numeric
  absence marker) as it is.
- `_IA.finiteOperand(v)` takes each operand of an arithmetic operation
  BEFORE the kernel, and answers `empty` for an infinite singleton: the
  kernels would answer `[0, +∞]` for `[0, 1] · [+∞, +∞]` and `[0, 0]` for
  `[1, 2] / [+∞, +∞]`, where the interpreter answers the indeterminate
  value. So `x + y`, `x · y` and `x / y` run with `y: Infinity` give `empty`.

**A possible enclosure.** On this target only, an operand whose type has
an `enclosure` arm (`real | enclosure`, the value of `If(t > 0, x, 0)` with
`x: enclosure`) is lowered as a certain one, and a free symbol with such a
type is an interval input with its entry check. A number is a point
interval on this target, so the code of the kind is valid for it. The
heads that hold, pass or choose a value (`If`, `Which`, `Block`, `Loop`,
`List`, `Tuple`) are lowered as for an interval. So `Factorial(y)` with `y: real | enclosure` declines, as the
interpreter leaves `Factorial` of an enclosure unevaluated.

**The entry check of the interval runner.** For each free symbol whose type
has an `enclosure` arm, `run()` checks the host value BEFORE it
converts the inputs, and OUTSIDE the `try` whose `catch` answers `entire`,
so a refused value throws. The entry check admits a record `{ lo, hi }`
of two numbers with `lo <= hi`, `±Infinity` allowed but not the same
infinity twice, no `NaN`; or a finite number. A UNION input is checked by
arm: a record by the entry check, a number by the numeric arms
(`NaN` admitted when an arm admits `nan` or `missing`, `±Infinity` when an
arm admits an infinity), so `y: number | enclosure` admits `Infinity` and
`y: enclosure | nan` admits `NaN`. `broadcast()` and `broadcastAsync()`,
which call the compiled body without the `run()` wrapper, check every cell
BEFORE the loop (outside the per-cell `try`): a cell whose two bounds are
the same value is read as that number when the type has a numeric arm, any
other cell by the entry check. One refused cell throws, or rejects the
promise, for the whole call. Every other input keeps the pass-through of
the runner, including a `NaN` input. (A `real | missing` input cannot be
declared since 2026-11-02.)

**No interpreter fallback.** A decline of an expression with an input
whose type has an `enclosure` arm, or whose result type has one, THROWS on
`interval-js`, also with `compile(…, { fallback: true })`. The fallback of
this target collapses each `{ lo, hi }` input to its midpoint
(`collapseIntervalInput()`), which would give a number to a symbol typed
`enclosure`, and reads a scalar result through `.N().re`, which is `NaN`
for an enclosure. `Measurement`, `Quantity` and the `javascript` target keep
the fallback.

**The declines.** The heads of the kind are an allow-list that fails
closed: a node with an operand or a result that may be an enclosure
declines with the kind message when its head is not in the list, and
where the interpreter leaves the call unevaluated: an operator that is not in the `apply` table (`Factorial`),
`Gamma(s, x)` with two operands, `Log` with an enclosure base, `Round`
with an enclosure step, `Mod` with a divisor that is not a point, a power
with a base that is not provably positive and an exponent that is not a
point (`(-2)^Enclosure(1, 2)`), and an integer exponent that is not a safe
integer. `Mean`, `Sum`, `Product`, `Integrate` and `NIntegrate` decline
too when an operand reads an enclosure: the library has no kernel for them,
and the mode's loop would add the terms by the rules of a real. So does a
call of a user function or of a host's `compile` handler with an argument
that may be an enclosure: its body would be lowered by the rules of a real
(`f(t) = t^{-2}` at `x: [-1, 1]` would be `singular`, where `.N()` gives
`Enclosure(1, +oo)`).

**Accepted differences between the interpreter and the compiled code.**

1. **The identity shortcut of the six comparisons.** The interpreter
   decides a comparison of two identical operands before any hook:
   `c = c` and `c <= c` are `True`, `c < c` and `c != c` are `False`. The
   compiled code has no identity information, so `_IA.equal(c, c)` and
   `_IA.lessEqual(c, c)` are `'maybe'` for an enclosure that is not a
   point.
2. **Doubles, not the working precision.** The interpreter compares two
   points exactly at its working precision; the compiled comparisons compare
   doubles exactly, as the `javascript` target does for numbers. Elsewhere the
   compiled answer is the target's three-valued one: `'maybe'` where the
   interpreter stays unevaluated, `'true'` for the touching `LessEqual`
   that the interpreter answers `True` too.
3. **An angular mode other than radians.** The compiled code multiplies
   the operand of a direct trigonometric function by the outward interval
   of the exact factor (`π/180` in degrees), so the result contains the
   true value; the `.N()` route multiplies each endpoint exactly and
   converts the product once. The endpoints of the two routes may differ
   by the rounding of the factor (`Sin(x)` at `x: [30, 30]` in degrees is
   `[0.4999999999999998, 0.5000000000000002]` compiled and
   `[0.4999999999999999, 0.5000000000000001]` under `.N()`). The result of
   an inverse function is multiplied by the same interval on both
   routes.
4. **A non-integer point exponent with a negative base at run time.** An
   exponent that is a free symbol of a number type (`x^n` with
   `n: integer`) lowers to `_IA.powInterval`, whose run-time point shortcut
   covers an integer and, for a negative point base, answers the symmetric
   hull over an exponent interval. At a non-integer point exponent with a
   negative base (`n: 0.5`, `x: [-8, -8]`) it answers `empty`, where the
   interpreter, which sees the value, uses the real branch.

**The limits kept from phase 1.**

- Code that reads or makes an enclosure (`valueKinds: ['enclosure']`)
  cannot be loaded again from its stored form: the loaders of
  `createIntervalRuntime()` (`load()`, `loadBroadcast()`,
  `loadBroadcastSlice()`) refuse code that names a kind type, because the
  entry check is a function, which stored code cannot carry. The `run()`, `broadcast()` and
  `broadcastAsync()` of the result apply the checks and then run a copy
  without `valueKinds`. `shippable` is `false`, so the kernel pool is not
  used and `willUsePool()` answers `false`.
- An input typed `list<enclosure>` declines (the entry check describes
  one value).

Lifting these two limits needs a serializable entry check (ROADMAP
CE-507.12).
