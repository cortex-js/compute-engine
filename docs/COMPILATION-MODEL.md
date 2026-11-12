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
  target's absent object (`undefined` on `javascript`, `None` on
  `python`) otherwise. A declared type cannot name `missing` (user
  decision of 2026-11-02, `docs/ERROR-MODEL.md`, "`Missing` is a result
  only"), so an input is never declared absent. The structure that moves it without computing on it:
  `At`, `First`, `Last`, `Rest`, `Length`, `Reverse`, and the binding of a
  callback parameter by `Map` and its relatives (`Length([1, Missing])` is 2
  on every route). Its discharge: `IsMissing`, `Coalesce` (`??`),
  `AssertPresent` (`?!`), which give the
  interpreter's value for an absent operand of any spelling (`Missing`,
  `NaN`, `undefined`, `None`). A parameter default is not a discharge: it
  fills only an argument that the call leaves out (see "Function values").
  A point (a tuple of numbers, `tuple<real,
  real>` included) is tested at a discharge with the point
  test, which also reads the point of `NaN` coordinates as absent: no point
  is proved present by its type, as no `real` is, because a read out of
  range gives that point whatever the type says. The test is chosen from
  the static type; the emitted code tests no type at run time. A false
  restriction of a point, `If(c, (1, 2))`, is the point of `NaN`
  coordinates (user decision of 2026-11-03) on `javascript` (`[NaN, NaN]`),
  `python` (a tuple of `nan`), the shader targets (a `vec2` of
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
  real is a value outside its declared type (next item).
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

- `javascript`, `x: real`: `Digamma(x)` at `x = +Infinity` gives `NaN`. The
  interpreter gives `+Infinity`.
- `javascript` (crafted), `x: real`, `g` assigned `0.75` with no declared
  type, `angularUnit = 'deg'`, the `complex` mode: in
  `Block(Declare(t, real, x), Assign(t, Block(Declare(b0, unknown, g), Arctan(b0))), t)`
  the existing compiler writes `57.29577951308232 * _SYS.catan(_SYS.cplx(b0))`,
  a number times a complex object, and gives `NaN`; the `numeric-kernel`
  profile gives `36.86989764584402`.
- `javascript` (crafted), `x`, `y: real`, both routes: the real kernels of
  `BesselJ(x, y)`, `BesselY`, `BesselI`, `BesselK` do not end for an order
  `x` of a magnitude of `2^53` or more (`x = 2^60, y = -2.5`), nor
  `Gamma(x, y)` (`_SYS.gammaUpper`) for `x = -1e300, y = 0.3`. The
  interpreter leaves the Bessel functions unevaluated and gives `+∞` for the
  `Gamma`.
- `javascript`, `x: real`, `z: complex`, both modes, both routes: an
  intermediate double overflows and the code gives `NaN` (or `Infinity`)
  where the interpreter has a finite value:
  - `Coth(x)` at `x = 1000` gives `NaN`; the interpreter gives `1`.
  - `Tanh(z)` at `z = 1000` gives `NaN`; the interpreter gives `1`.
  - `Cot(z)`, `Sec(z)`, `Csc(z)` at `z = 0.5 + 1000i` give `NaN`; the
    interpreter gives `0`.
  - `Sech(z)`, `Csch(z)` at `z = 1000 + 0.5i` give `NaN`; the interpreter
    gives `0`.
  - `Arcsch(x)` at `x = 1e-309` gives `Infinity` (`Math.asinh(1 / x)`); the
    interpreter gives `712.19194091572`.
- `javascript`: a list whose length is random, then another draw:
  `Function(Block(Declare(A, 'list<integer>', Comprehension(j, Element(j, Range(1, 2 + Random(Range(1, 3)))))), Declare(r, 'real', Random()), 1000·r + Length(A)), u)`
  applied to `0.5` under the seed 1 gives `211.47662186831073`. The interpreter gives
  `987.4569781146947`: its comprehension is a lazy view, so it draws for `r`
  before it draws for the range. The `numeric-kernel` profile declines a
  draw in the range of a comprehension.
- `javascript`, profile `numeric-kernel`: a sum that is not in canonical
  form and has a sum as an operand (`Add(Add(x, 1), Add(x, 1))`, nested four
  times) can differ in the last place from the existing compiler with
  `cse: false` (`20.800000000000008` and `20.8`): the existing emitter writes
  the terms of the nested sums as one sum from left to right
  (`_.x + 1 + _.x + 1`), the profile adds each nested sum first. A canonical
  sum has no sum as an operand
  (`docs/plans/2026-11-11-structured-shared-subexpressions.md`).
- `javascript`, profile `numeric-kernel` (crafted): the existing compiler
  searches again for the closed form of an integral at each place where it
  writes it (each occurrence, each term of an unrolled `Sum`), and the
  searches of one compilation share a pool of 600,000 steps; when its
  searches spend the pool, a later integral gets quadrature
  (`_SYS.integrate`) where the profile, which searches once per node and
  declines a program whose searches spend more than 10,000 steps, writes
  the closed form. The doubles then differ in the last places.
- `javascript`, profile `numeric-kernel` (crafted): a search for a closed
  form also stops at a wall-clock guard of 30 s (`closedFormIntegral()`),
  shared by the searches of one compilation. A search near the guard can
  find a closed form on one compiler and stop on the other; the record of
  a search that timed out makes the next compilation skip it.
- `javascript`, profile `numeric-kernel` (crafted): in an integral with no
  closed form, the existing compiler searches for the closed forms of the
  integrals of its integrand before those of its bounds, from the last
  clause to the first; the profile searches the bounds first, clause by
  clause, then the integrand. The two orders spend the shared pool of
  steps alike unless it runs out, as in the line above.
- `javascript`, profile `numeric-kernel` (crafted): a name of the
  integrand that is assigned after the integral is boxed is read as an
  input in the closed form. `e = ce.box(['Integrate', ['Multiply', 'x',
  'y'], ['Limits', 0, 1]])`, then `ce.assign('y', 5)`: the profile writes
  `0.5 * _.y` (`NaN` for `run({})`), the existing compiler `(0.5 * 5)`,
  the interpreter 5/2. With `y` assigned before boxing, both give 2.5
  (since slice 1, `f56cd5f29`; `binder-mechanism.test.ts`).
- `javascript`, with a `symbolDeps` capture, `seven` and `tenth` assigned
  `7/10` and `1/10` with no declared type: `x + Mod(seven, tenth)` is not
  folded and gives `x + _SYS.floorMod(0.7, 0.1)`, about `x + 0.0999…`;
  without `symbolDeps` it is folded to `x + 0`. The interpreter gives `x`.
  The profile `numeric-kernel` gives the code of the existing compiler in
  both cases.
- `javascript`, `x: real`, `strict` mode: `WithRandomSeed(3, ln(x)) + x` at
  `x = 3` gives `{ re: NaN, im: undefined }`. The node has the type
  `complex | signed_infinity`, so the parent
  reads the parts of a complex value, and the handler writes the real body
  `Math.log(x)`. The interpreter gives `4.0986…`. The profile
  `numeric-kernel` declines it.
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
- `javascript`, `L: list<real>`: `Arctan2(0/L, -1)`, and the simplified form of
  `Arctan2(L - L, -1)`, at `L = [-1, 2]` give `[-π, π]`. The code computes
  `0 * -1` or `0 / -1`, which is `-0`, and `Math.atan2(-0, -1)` is `-π`. The
  interpreter gives `[π, π]`.
- `plausible?` — `javascript`, `n: integer`: in
  `function g(n: integer) { sum(map((x) => sum([random() for j in 1..2]), 1..n)) }`,
  `WithRandomSeed(7, (g(m), random()))` at `m = 2` gives `[1.2722…, 0.2160…]`;
  the interpreter gives `(0.5609…, 0.2415…)`. The interpreter evaluates the
  comprehension in the function literal as one instance, so the two calls read
  one draw set (`docs/RANDOMNESS-MODEL.md` §6, "One instance, one draw set");
  the compiled code draws at each call.
- `plausible?` — `javascript`, `b: boolean`, `u: list<real>`, a non-canonical
  box: `ce.box(['Not', ['And', 'b', ['Greater', 'u', 0]]], { form: 'raw' })` at
  `b = true`, `u = [1, 2, 3]` gives `true`, and the same box of
  `['Add', 'u', 1]` gives the string `"1,2,31"`. A non-canonical box has no
  static types, so the code uses the scalar JavaScript operators. The
  interpreter, and the compiled `.canonical` form of the box, give
  `[False, False, False]` for the first box.
- `plausible?` — `javascript`, `glsl`, `x: real`, `y: real`: `Arctan2(y, -x)` at
  `x = 0`, `y = 0`. The interpreter gives `0`. JavaScript gives `π`, because
  `-x` is `-0` and `Math.atan2(0, -0)` is `π`. The GLSL code is
  `atan(y, -x)`, and `atan(0.0, -0.0)` with uniform operands gave `NaN` in WebGL2
  on ANGLE Metal on an Apple M5 Max, where `atan(0.0, 0.0)` gave `0`. That GPU is
  the only one measured.
- `glsl`, `L: real | list<real>`: `L + 1` compiles to `L + 1.0`, a
  shader code for a scalar `L`, so a host that gives a list has no
  declaration of `L` that the code accepts. The interpreter at `L = [1, 2]`
  gives `[2, 3]`. A list input of unknown length declines (`list<real>`),
  but a union with such a member does not: the engine gives wide unions to
  symbols that the shader reads as scalars. The same applies to an input
  of type `record`, which compiles to its bare name.
- `javascript`, `L: list<real>`, `n: integer`: `Sum(Take(Sum(L·i, i, 1,
  n), 2))` and `Sum(TakeWhile(Sum(L·i, i, 1, n), x ↦ x > 0))` at `n = 0`
  throw (`.slice is not a function`, `findIndex is not a function`): the
  empty indexed `Sum` is the number `0`, and the `Take` lowering reads it
  as an array. The interpreter gives `0`.
- A custom target whose own `var` hook resolves a symbol `C` declared with
  the bare type `list` while `C` holds a list of numbers: an element read
  `C[i]` is compiled as a number (`isHeldNumericListRead()` in
  `compilation/provable-kind.ts` tests `vars` and bound names, not the
  hook), so when the hook's value of `C` is a list of lists, an indexed
  `Sum` over `C[i+1]x^i` adds arrays with `+` and gives a string; the
  interpreter gives the sum of the lists.
- `javascript`, a `Block` local declared with the bare type `list` and
  holding a list of lists: `Block(Declare(C, 'list', [[1, 2], [3, 4]]),
  Sum(C[i+1]·x^i, i, 0, Length(C) − 1))` compiles to a scalar loop over
  `_SYS.at(C, i + 1) * _SYS.pow(_.x, i)` and gives `null` (also in
  0.178.0); the interpreter gives the list `[3x + 1, 4x + 2]`.
- `interval-js`, `x: real`, `f: (real) -> real` given with the `functions`
  option as a host function that counts its calls in a global:
  `If(And(x < 0, f(x) > 0), 1, 2)` at `x = 1` calls `f` once and gives
  `[2, 2]`. The interval lowering of `And` and `Or` in a value
  (`_IA.and`, `_IA.or`) evaluates every operand. The interpreter stops at
  the first operand that decides the result, gives `2`, and does not call
  `f`. The condition of an `If` statement in a `Loop` body keeps the order
  of the interpreter.
- `glsl`, `s: (real) -> complex` with `s := t ↦ If(t > 0, t > 1,
  t)`, `x: real`: `s(x)` compiles with success to
  `vec2(((0.0 < t) ? (1.0 < t) : (t)), 0.0)`. The two branches mix a
  boolean and a float, which the shader compiler refuses. The interpreter
  gives an `incompatible-type` error at `x = 2` and `-1` at `x = -1`.
- `glsl`, caller code evaluated on a condition with no statement of its
  own (crafted): with `vars: { W: 'nextValue()' }`, `canCompile()` answers
  `{ ok: true }` and `compile()` declines for a `Loop` whose guard or later
  clause holds `W` (`Element(i, Range(1, n), 0 < W)`), for a user function
  whose body has `And`, `Or` or a chained comparison with `W` after the
  first operand (`g(x) := x < 1 < W < 2`; the prepare stage writes these as
  an `If` in the root tree only), and for such a head that the caller maps
  through `functions`. The code would run on a condition where no
  temporary can be placed. No program compiles to wrong code.
- `glsl`, a shared node of caller code in a user-function body (crafted):
  the body of a user function that the host builds with one node object of
  caller code at two places
  (`Add(hx, hx)` with one boxed `hx = h(x0)` and `functions: { h: 'myH' }`),
  written in place of its call: the binding is keyed by node, so the shader
  calls `myH` once where the interpreter calls it twice. A body that is
  parsed or boxed from MathJSON has one node per occurrence.
- `glsl`, `Max(L)` and `Min(L)` of a list input held as a uniform array of
  more than 4 elements (crafted): with `L: list<real^5>`, `canCompile()`
  answers `{ ok: true }` and `compile()` declines, because the shader code
  has no list of the elements of a uniform array to fold over. No program
  compiles to wrong code, and `compile()` declined it before the fragment
  pass too. `Sum(L)` and `Product(L)` are refused by the pass.

- `javascript`, `x: real | nan`: `Arcsec(x)` and `Arccsc(x)` at `x = 0.5`,
  and `InverseHaversine(x)` at `x = 4`, compile to the real lowering
  (`Math.acos(1 / x)`, `2 * Math.asin(Math.sqrt(x))`) and give `NaN`; the
  interpreter gives a complex value (`Arcsec(0.5)` is `1.3170i`). With
  `x: real` the same programs take the complex lane and agree.
- `plausible?` — `javascript`, the default mode (`strict`), `z: real`:
  `Gamma(s, z)` at `s = 1`, `z = -1` gives `NaN`; the interpreter gives
  `e`, a real value. The real lowering of the upper incomplete gamma has no
  value for `z < 0`; `mode: 'complex'` gives the interpreter's value. Since
  the removal of `mode: 'auto'` (2026-11-03) this is the default, as it was
  already the value of `strict`.
- `plausible?` — `javascript`, `mode: 'complex'`, `x: real`, `b: real`,
  `f: (real) -> unknown` with `f(t) := sin(b·t)`:
  `Block(Declare(L, "unknown", List(f(x)^2, 1)), L[1] + 1)` at `x = 1.3`,
  `b = 2` gives the string `"[object Object]1"`; the interpreter gives
  `1.2657`. `f(x)^2` is typed `real<0..>` but its code is a `{re, im}`
  object, and the list element keeps that object while `L[1] + 1` reads a
  number. The scalar case is converted at the binding of a real local
  (`realLaneLocalBinding` in `compile-complexness.ts`); a list local is not.
- `plausible?` — `javascript`, `mode: 'complex'`, `y: real`, with
  `g := x ↦ If(x > 0, Mod(x, 3), x)` (a function defined on the engine, a
  `Block` local or an `Apply` of the literal): `g(Sqrt(y))` at `y = -16`
  gives `NaN`; the interpreter gives `4i`. The use in `Mod` types the
  parameter `x` as `real`, so the body reads it on the real lane, and the
  call passes the real projection of the argument (`_SYS.crealElements`),
  which is `NaN` for a non-real value. At `y = 16` both give `1`.
- `plausible?` — `javascript`, `mode: 'complex'`, `y: real`: in
  `Block(Assign(x, Sqrt(y)), Assign(f, x ↦ x + 1), f(Sqrt(y)) + x)` the
  parameter `x` of `f` has the name of a local of the block, and the literal
  compiles to `(x) => x + 1`, on the real lane, so at `y = 16` the result is
  `{re: NaN, im: NaN}`; the interpreter gives `9`. An `Apply` of the literal
  gives the same. The lowering puts each parameter in a shape frame of its
  own when an enclosing frame names it, and that frame holds `false` for a
  parameter that is not declared with a non-real type, also when the type
  of the parameter is wide.
- `javascript`: in a loop with an outer `a = 100`, `function f() { a }` and
  `let (a, b) = (k, f())`, the compiled `b` is `k`; the interpreter gives
  `b = 100` (was CE-756).
- `python`: `At(L, 1.5)` with `L: list<real>` holding `[10, 20]` reads
  `_l[int(_i) - 1]` and gives `10`; the interpreter gives `NaN` (a finite
  index that is not an integer reads the absent value of the domain).
- `javascript`, `python`: dependent `Sum` clauses with an outer `k = 3`,
  `Sum(j + k, Limits(j, 1, k), Limits(k, 1, k))`, give 36; the interpreter
  gives 24.
- `javascript`, `w: real`, `y: real` at `w = y = 0`: `Take(Range(1, ∞), w/y)`
  and `Take(Drop(Range(1, ∞), w/y), 3)` give `[]` (a lazy stream with a `NaN`
  count); the interpreter leaves them unevaluated.
- `javascript`, `c: boolean`, `xs: list<real>`, `w: real`, `y: real` at
  `c = true`, `w = y = 0`: `Unique(If(c, Take(xs, w/y), xs))` gives `[]` (the
  `If` hides the slice with no value from the guard of `Unique`); the
  interpreter leaves it unevaluated.
- `python`, `c: boolean | integer`: `If(c, 1, 2)` at `c = 1` compiles to
  `((1) if (c) else (2))` and gives `1`; the interpreter leaves it
  unevaluated. The JavaScript target declines it.
- `python`, `n: integer`: `Linspace(0, 1e20, n)` at `n = 2` raises a NumPy
  `UFuncTypeError`. The target writes `1e20` as the Python integer
  `100000000000000000000`, which `np.linspace` cannot convert to a float. The
  interpreter gives `[0, 1e20]`.
- `javascript`, the interpreter fallback of a decline: with `L: list<real>`
  and `p: any` assigned `2L`, `compile(p + 1, { constantFold: false })`
  declines and `run({ L: [1, 2] })` gives `null` (the fallback does not pass
  the input `L` to the value of `p`); the interpreter gives `[3, 5]`.
- `javascript`, `z: complex`, `v: list<real>` at `z = 1+2i`, `v = [1, 2]`:
  `Map((p) ↦ Real(p), When(z, v > 0))` gives `[{re: 1, im: 2}, {re: 1, im: 2}]`
  (the type of the `When` is `list<number>`, so the parameter compiles as a
  real number and `Real(p)` as `p`); the interpreter gives `[1, 1]`. Over a
  declared `list<complex>` the same `Map` agrees.
- `javascript`, a `vars` entry whose caller code names `_c`: with
  `s: string | missing`, `t: string`, `vars: { t: '_c' }` and the preamble
  `const _c = "ok";`, `IsMissing(Coalesce(s, t))` at `s = undefined` gives
  `true` (the `Coalesce` lowering binds its operand to `_c`, and caller code
  is not renamed); the interpreter gives `false`.
- `javascript`, `h: (broadcastable<integer>) -> broadcastable<integer>`,
  `h := n ↦ n + 1`, `S: list<string>` at `S = ["a", "b"]`: `h(S)` gives
  `["a1", "b1"]` (a collection argument at a `broadcastable<T>` parameter
  compiles without a test of its cells); the interpreter gives an
  `incompatible-type` error for each cell.
- `javascript`, a `vars` entry whose code is not a primary expression: with
  `p: real` and `vars: { p: '2+3' }`, `2p` compiles to `2 * 2+3` and gives 7
  (the code is spliced without parentheses); the interpreter, with `p = 5`,
  gives 10. The `python` target groups such code.
- `javascript`: `Fold((acc, x = 100) ↦ If(IsMissing(x), acc, acc + x), 0,
  [1, 2, Missing])` gives 103; the interpreter gives 3. The callback's
  default is a JavaScript default parameter, which also fills a supplied
  `undefined` (the compiled `Missing`), so the discharge `IsMissing(x)` in
  the body reads 100. The `python` callback fills a supplied `None` the same
  way (`100 if x is None else x`). The same wrapper is used for the value of
  a user function with a default passed as a callback.
- `javascript`, `constantFold: false`, `vars: { Pi: '_.Pi' }`: with
  `f := (x, k = Pi) ↦ x + k`, `f(1)` at `Pi = 3` gives 4 (the default `Pi`
  is filled by its name, and `vars` maps the name to the input); the
  interpreter gives `1 + π`. A library constant or a `symbol<…>` symbol
  used as a default is filled by its name, so a `vars` entry or a local of
  the same name can hide it; a constant declared by the program or the host
  is filled by its value instead.
- `javascript`: `Block(Declare(mk, "function", (a, k = 2) ↦ (x ↦ x + a +
  k)), mk(1))` compiles, and `run()` returns a JavaScript function, where the
  rule of function values declines a function returned from a call: the
  call of a block-local function has the static type `unknown`, so the
  decline of a call whose type is a function type does not see it. The
  values agree with the interpreter: `Apply(mk(1), 5)` gives 8 in both.
- `interval-js`, with `constantFold: false`: `PointX([Missing, []])` gives
  one `empty` result (the empty row is skipped when the reading of the list
  is decided, so the list is read as one point); the interpreter gives
  `[Missing, Missing]`.
- `interval-js`, `y: real` at `y = 3`: `Coalesce(1/(y - 3), 2)` gives the
  interval `[2, 2]` (`_IA.coalesce` reads the `empty` result of a pole as
  absent); the interpreter gives `~∞`.
- `javascript`, `x: real`, `W: list<real>`, `vector` declared
  `(real) -> list<real^2>` with the body `t ↦ W` (crafted: the body breaks
  the declared width): `Sum(vector(x))` at `W = [1, 2, 3]` gives 3 (the sum
  is written for two terms); the interpreter gives 6.
- `javascript`, `B: broadcastable<number>`, `P: tuple<real, real>` at
  `B = 1` (plausible?): `If(B < 0, P)` gives `undefined` (the condition
  can be a list, so the run-time selection `_SYS.selectAbsent` gives
  `undefined` for the whole value when the condition is one `false`); the
  interpreter gives `(NaN, NaN)`, a false restriction of a point (user
  decision of 2026-11-03). With `c: boolean | list<boolean>`, `If(c, P)`
  agrees: the declared union compiles one body per member.
- `javascript`, `x: real`, the option `operators: { Add: ['*', 11] }`:
  `Min(Map(k ↦ x + k, [0, 1, 2, 3, 4, x]))` at `x = 2` gives 2, where the
  caller's `*` applied to each element gives 0 (`2 * 0`). The interpreter
  does not read the option and gives 2. The unroll pass (`tryUnrollMap()` in `compilation/fixed-width-unroll.ts`)
  writes out a `Map` over a list of five or more elements, and the
  substitution builds `x + 0` again in canonical form, as `x`, so the
  caller's operator is lost. The same applies to the shader targets, which
  write out a `Map` of any width. A `Map` under a `Min` or a `Max` over a
  narrower list declines this rewrite when the caller supplies a head in it.
- `javascript`, `u: string | list<real>` at `u = "abc"` (crafted: a union
  of a string and a list at a collection parameter):
  `Block(Assign(g, s ↦ Length(s)), g(u))`, and `f(u)` with `f := s ↦
  Length(s)` defined on the engine, throw `RangeError: Length: the operand
  is not a list or a set at run time` (the function compiled with the
  parameter typed `string` is used only for an argument whose static type is
  a string); the interpreter gives 3.
- `python`, `t: string` at a `t` of three code points, `e`, U+0301
  (combining acute accent) and `x` (crafted: a character made of two code
  points): `Block(Assign(g, s ↦ Reverse(s)), g(t))` gives the code points
  `x`, U+0301, `e` (the body is compiled for a list, as `s[::-1]`, which
  reverses the code points of a string); the interpreter gives the code
  points `x`, U+00E9, the accented `e` kept as one character.
  `Reverse(t)` written without the function declines.
- `javascript`, a `+=` inside a dictionary value of a `parallel for` body
  (crafted, MathJSON only): `Block(Declare(s, 0), ParallelLoop(Block(
  Dictionary(KeyValuePair('a', AddTo(s, k)))), Element(k, Range(1, 4))), s)`
  declines ("the value of the key "a" has the type `any`"), and the
  interpreter gives 10. `lowerParallelHeads()` (`parallel-lowering.ts`) does
  not walk into a `Dictionary`, so the `AddTo` in it is not rewritten.
- `glsl`, a target object of `GLSLTarget.createTarget()` passed straight to
  `BaseCompiler.compile(expr, target)` (crafted): for `v: list<real^3>` and
  `x: real`, `Arctan2(v, x)` gives the code `atan(v, x)`, which no shader
  compiler accepts, where `compile()` declines. In the same way, a block
  local that holds a list of points, a matrix, or a value whose type admits
  a point and a list of points gives a declaration that disagrees with its
  assignment (`Block(Assign(m, Matrix(…)), x)` gives `float m; m = mat2(…);`),
  and so does a local whose bindings have different shapes (a scalar and a
  point, in either order). A gather
  with a list index (`At(v, [1, 3])`) does not check that its base is pure,
  so an impure base can be computed more than once, or not at all when every
  index is out of range. `BaseCompiler.compile()` runs no fragment pass, and
  the GLSL lowerings and the declarations of block locals do not check
  shapes. `compile()` with the target object as the `target` option runs
  the pass first (`raw-target-check.ts`), so it declines what `compile()`
  with `to: 'glsl'` declines; the pass types the tree of that preparation,
  which writes point values and some calls of user functions in place,
  while the raw route writes a tree that is prepared less, and its code is
  not checked again.
- `javascript`, the `complex` mode, `u` with no declared type (crafted):
  `u + Round(0)` at `u = -0` gives `-0` with the existing compiler, which
  writes the sum without its term `Round(0)`. The `numeric-kernel` profile
  and the interpreter give `0`.
- `javascript`, both routes, `A: matrix` at `A = [[1, 2, 3], [4, 5, 6]]`
  (crafted: a matrix that is not square): `Trace(A)` gives `6` and
  `MatrixPower(A, 1)` gives `A`; the interpreter gives the error
  `expected-square-matrix`.
- `javascript`, both routes, `v: list<real>` at `v = []` (crafted):
  `Diagonal(v)` gives `[]`; the interpreter keeps `Diagonal([])`
  unevaluated.
- `javascript`, the `numeric-kernel` profile, `A: matrix` at `A = [[]]`
  (crafted: a matrix of no column): a local declared `matrix` that holds
  `Transpose(A)`, the empty list, is read as a matrix of one row or more
  (`hasRows()` trusts the declared type of a name), so `Sum(S)` of it gives
  `[]` where the existing compiler gives `0` (the sum of no row); the
  interpreter keeps `Sum(Transpose([[]]))` unevaluated.

## The worker pool and `parallel for`: `runAsync()`

A `javascript` result called with an object of variables
(`calling: 'expression'`) has `runAsync(inputs, options?)` and
`willParallelize(passes?)`. `run()` does not change: it runs each
`parallel for` in order, on the calling thread.

`runAsync()` runs a second, asynchronous copy of the program. The copy is the
code of `run()`, except at each `parallel for` that can run on the engine's
worker pool (`ce.workers`, from `createKernelPool()`). At such a loop, the
calling thread computes the count of passes with the code of the in-order
loop (with its checks), splits the passes into one sub-range of consecutive
passes for each worker, and sends each worker one call of the loop compiled
as a function of its own. Each worker adds the terms of its passes to zero.
When all calls are done, the calling thread adds the sums to the
accumulators, one sub-range after the other. The statements outside these
loops run on the calling thread, with the code of `run()`, and the calling
thread is free only while the program waits for the workers.

`runAsync()` returns a promise of the value of `run(inputs)`, except for the
order of the additions (see "Values" below). It checks `inputs` and converts
the value as `run()` does. An error of the program rejects the promise;
`runAsync()` never throws. A program with no loop that can run on the pool
has no copy, and its `runAsync()` gives `run(inputs)`. The host must not
change the values of `inputs` until the promise settles.

The options:

- `signal`: an `AbortSignal` (see "Errors, failures and abort").
- `minPasses`: the smallest count of passes that goes to the pool, a positive
  integer. Default: 20 000, the count from which `broadcastAsync()` starts to
  use the pool. Another value rejects the promise with a `TypeError`.
- `onLoop(report)`: called once for each run of a loop that can run on the
  pool, with `{ passes, route, reason }`. `route` is `'pool'` or
  `'calling-thread'`. With `'calling-thread'`, `reason` is `'no-pool'`,
  `'pool-unusable'` (the workers hold another runtime version),
  `'below-threshold'`, `'too-large'` or `'pool-declined'`. A loop that runs in
  order because of a condition of the compiler (below) never calls it.

`willParallelize(passes?)` is `true` when the program has a loop that can run
on the pool (also inside a function that it calls), the engine has a usable
pool, and `passes`, when it is given, is at least 20 000. It does not know the
range of a loop, does not read `minPasses`, and does not check the size limit.

```js
// let L = H
// parallel for k in 1..n { L[k % 3 + 1] += 1 }
// L
const count = compile(ce.box(['Block', ['Assign', 'L', 'H'],
  ['ParallelLoop', ['AddTo', ['At', 'L', ['Add', ['Mod', 'k', 3], 1]], 1],
    ['Element', 'k', ['Range', 1, 'n']]],
  'L']));
count.willParallelize(900_000);              // ➔ true (with a pool)
await count.runAsync({ H: [0, 0, 0], n: 900_000 }, { onLoop: console.log });
// onLoop: { passes: 900000, route: 'pool' }
// ➔ [300000, 300000, 300000]
```

### The loops that run in order

A loop that fails one of these conditions runs in order inside `runAsync()`,
with the code of `run()`, and does not call `onLoop`. No condition makes a
compilation decline. `result.parallelLoops` (internal) records the reason of
each loop (`PoolLoopReason` in `compilation/types.ts`). The examples are
Epsil; `H` is an input `list<number>`, and
`total(L, n) = { let s = 0; parallel for k in 1..n { s += L[k] * k }; s }` is
a function of the engine.

1. **Position** (`'position'`). The asynchronous copy can wait for the pool
   only at a loop that is a statement of the program, or of a user function
   that the program calls in a position that can wait (see the next section).
   `total(H, 4) + 1`, `max(total(H, 4), 1)`,
   `map((x) => total(H, x), [1, 2])` and `WithRandomSeed(7, total(H, 4))` run
   their loop in order: the call is an operand, an argument or a callback.
2. **Domain** (`'domain'`). The domain is a range that the compiler emits as
   a counted loop, with bounds and a step that make no random draw.
   `parallel for x in [1, 2, 3] { s += x }` runs in order: its domain is a
   list.
3. **Accumulators** (`'accumulator-scope'`, `'accumulator-type'`, `'mode'`).
   Each accumulator is a local variable of the function or block that holds
   the loop, and is a number (`s += e`) or a list of numbers with one index
   (`L[i] += e`), not both. The program is compiled in the default mode:
   with `mode: 'complex'`, `parallel for k in 1..3 { s += k }` runs in order.
   The `bigint` mode declines a block of statements before this analysis.
4. **No read of an accumulator** (`'accumulator-read'`). In the loop as
   written, before `lowerParallelHeads()` rewrites `+=`, the name of each
   accumulator is only the target of a `+=`.
   `parallel for k in 1..2 { L[k] += L[k + 1] }` runs in order (the Epsil
   checker also reports it, as `parallel-accumulator-read`).
5. **No other write, and no jump out** (`'outer-write'`, `'jump'`). The body,
   and each user function that it calls, assign only their own locals, and no
   `return`, `break` or `continue` leaves the loop. The Epsil checker refuses
   these; the compiler checks them again for MathJSON:
   `ParallelLoop(Block(Assign(t, k), AddTo(s, k)), Element(k, Range(1, 4)))`
   and `ParallelLoop(Block(AddTo(s, k), If(k > 2, Break())), …)` run in
   order.
6. **The body reads data only** (`'function-value'`, `'outer-type'`). Each
   outer variable that the body reads has a static type that is a number, a
   boolean, a string, or a list or tuple of these. A function value cannot go
   to a worker: with `let h = (x) => x + 1`,
   `parallel for k in 1..3 { s += h(k) }` runs in order.
7. **The loop can run on a worker** (`'not-shippable'`,
   `'function-declined'`). The loop compiled as a function of its own is
   shippable: it makes no random draw, names no identifier of the host, and
   calls no function of the `functions` or `operators` option. Its
   compilation must not decline, and its code must not read the object of
   variables of the program (a user function that reads an input of the
   program).
   `parallel for k in 1..3 { s += random() * 0 + k }` runs in order. A
   function object given in `functions` is copied as source, and a `compile`
   handler can declare itself shippable: as for `broadcastAsync()`, such a
   function must read only its arguments and have no effect, or the value of
   `runAsync()` is unspecified.
8. **No pass budget** (`'iteration-budget'`). A program compiled with
   `iterationBudget` counts its passes in one counter for the call, which a
   worker cannot share.

A program whose code reads or makes a value of a kind (`valueKinds`) gets no
asynchronous copy: its `runAsync()` gives `run(inputs)`.

At run time, a loop that passes these conditions goes to the pool when the
engine has a usable pool (otherwise `'no-pool'` or `'pool-unusable'`), the
count of passes is at least `minPasses` (otherwise `'below-threshold'`), and
the private lists of the workers hold at most 16 million numbers together
(otherwise `'too-large'`). Each worker has a private list of the length of
each list accumulator, so the count is the sum of these lengths times the
count of sub-ranges (the size of the pool, or the count of passes when it is
smaller). A number accumulator does not count. In each of these cases the
loop runs in order on the calling thread and `onLoop` receives
`route: 'calling-thread'` with the reason.

A loop that the program reaches while a random frame of the engine is
installed runs in order and does not call `onLoop`: a wait there would leave
the frame installed while other code runs. For example, a host function that
starts `runAsync()` while the interpreter evaluates `WithRandomSeed(7, …)`.

### The positions that can wait

An `await` is valid only directly inside an `async` JavaScript function, so
the copy makes `async` each function between the entry and a loop that waits,
and awaits each call of such a function (`pool-async.ts`). These positions
can wait:

- a `parallel for` that is a statement of the program (a `Block`) or of the
  body of a user function, of the engine (an Epsil `function` that
  `executeEpsil` defines) or of the program (`function f(…) { … }` in a
  block);
- the same inside a nested block, the branches of an `if` statement, and the
  body of a `for` or `while` loop, at any depth;
- a call of a user function whose body can wait, when the call is a whole
  statement, the value of a declaration or of an assignment
  (`let a = f(…)`, `a = f(…)`), the last value of a body, or the whole body
  of a function. The function can call a second function in the same
  positions.

```epsil
let a = total(H, 4)                        // waits
if a > 0 { a = total(H, 3) }               // waits
for j in 1..2 { a = total(H, j) }          // waits
```

Every other position keeps the in-order loop of `run()`: an operand
(`total(H, 4) + 1`), an argument (`max(total(H, 4), 1)`), a callback of a
library function (`map`), the body of another `parallel for`, the argument
of `WithRandomSeed`, two calls in one statement. The remedy is a statement
of its own: `let t = total(H, 4)`, then `t + 1`.

A user function has only its asynchronous form in the copy. So when the
program also uses the function in a position that cannot wait, its loops run
in order, also at its calls that could wait:
`function g(m) { let s = 0; parallel for k in 1..m { s += k }; s }` then
`let a = g(4); a + max(g(2), 1)` runs both loops in order (the reason is
`'position'`). With `let a = g(4); let b = g(2); a + b`, both run on the
pool. The same applies to a function that the copy makes `async` only because
it awaits another one, and to the functions that it awaits.

These forms of a function also keep its loops in order:

- a body that the compiler substitutes into its caller (a one-statement
  body, `compile-user-calls.ts`): the analysis finds no body block that
  declares the accumulator (`isLocalOfEnclosing()` in `pool-loop.ts`), so
  the loop runs in order and never calls `onLoop`;
- a variant of a function for one shape of call, the loop form of a list
  recursion, and a function wrapped to convert its arguments or to fill a
  default value of a parameter
  (`function g(m: integer, c: integer = 2) { … }`, then `g(4)`).

The copy is a second emission of the whole program. When a function has a use
that is not a waited call, or the text does not compile (an `await` inside a
JavaScript function that is not `async`), the copy is emitted again without
the loops concerned, or with each loop tried alone. After at most 6 emissions
the program gets no copy, and each loop runs in order with the reason
`'position'`.

### Values

`run()` adds each term to the accumulator in the order of the passes. The pool
adds the terms of each sub-range to zero, then adds these sums to the
accumulator in the order of the sub-ranges. The `parallel for` rules leave the
order of the additions unspecified.

- **Equal to `run()`:** an accumulator of static type `integer` (a number, or
  a list of integers), while its value before the loop and every partial sum
  stay within ±2^53. The statements outside the pool loops run the code of
  `run()`, so they give its values when the accumulators are equal.
- **Can differ from `run()`:** an accumulator of real numbers, and one of
  integers beyond 2^53. The difference is that of another grouping of a
  floating-point sum. It is usually in the last bits: the sum of `1/k` for
  `k` in `1..1000000` gave `14.392726722864989` with `run()` and
  `14.392726722865703` with `runAsync()` on 3 workers. It can be larger
  (terms that cancel, a sum that overflows in one grouping only), and a later
  test of the value (`if s > 2000`) can then take another branch. The grouping
  depends on the size of the pool.
- **The sign of zero:** an element of a list accumulator that holds `-0`
  before the loop, and whose sum in each sub-range is exactly 0, keeps `-0`
  (an element whose sum is 0 is not written); `run()` gives `+0` when a pass
  adds `+0` to it. An element that no pass writes keeps its value in both
  (`-0`, `NaN`, an infinity).

The input list and a second variable that holds the list of an accumulator
before the loop (`const before = L`) keep their values, as with `run()`: the
sums are written in place only where the in-order loop writes in place
(`in-place-update.ts`).

### Errors, failures and abort

- **An error of a pass, a worker that fails.** When a worker does not complete
  its sub-range (an error of a pass, a worker that fails or refuses the call,
  a pool that turns out to be unusable), the calling thread runs that
  sub-range again with the same function, in the order of the sub-ranges, and
  `onLoop` receives `route: 'calling-thread'`, `reason: 'pool-declined'`. A
  sub-range that fails there too throws, and the promise rejects with the
  error of the first such sub-range: the error of the first failing pass,
  which `run()` throws.
- **Limits.** Each call carries the engine's iteration limit
  (`ce.iterationLimit`), so a pass that exceeds it on a worker fails as in
  `run()`.
- **Abort.** A signal that is already aborted at the call rejects the promise
  with `signal.reason` before any statement runs. An abort while the program
  waits for the workers rejects it with `signal.reason`: the program stops at
  that loop. The pool drops the calls that it has not sent, and a worker that
  still runs a sub-range is terminated and replaced after the grace period of
  the pool. An abort while the calling thread runs statements is seen at the
  next loop that can run on the pool, before its other checks: that loop
  throws `signal.reason` also when its count of passes is under `minPasses`.

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
`If(m < 3, m, 0)` declines, and `unsupported` is `["m"]`. An input with no
declared type has the type that the compiled expression requires of it
(below). A declared union of
shapes (`real | list<real>`) is a type, and compiles (R4). "An input with no
type declines", under "Fail closed", gives the details. One exception: the
experimental `numeric-kernel` profile of the JavaScript target takes an input
with no declared type as a scalar number ("The `numeric-kernel` profile of
the JavaScript target", below).

**R2. The static type of an argument selects the code of a call.** A
function is compiled once for each argument shape that the program gives
it. With `f := t ↦ 2t`:

- with `u: real`, `f(u)` compiles to `_fn_f(_.u)`;
- with `L: list<real>`, `f(L)` compiles to `_SYS.mapFn(_fn_f, [1], _.L)`, the
  scalar code mapped over one list level, as the interpreter maps it;
- with `M: list<list<real>>`, `Map(f, M)` gives the callback the code
  compiled for one element of `M` (`_fn_f$m1`, which maps over one level);
- with `P: tuple<real, real>`, `f(P)` calls a function compiled for one
  point (`_fn_f_tuple_real__real_`).

No test of a shape runs in these calls. A parameter or an input that the
host declares with a union of shapes is a request for a test: the code tests
the value once, where it is bound, and has one body for each member of the
union, with no test inside the body. This test is the only run-time test of
a shape in compiled code, and the host selects it by its declaration.

**R3. A value with no settled shape declines.** When the program makes a
value whose shape depends on a run-time value, the compilation declines with
the code `'unsettled-shape'`, and `unsupported` holds the node: with
`x: real`, `If(x > 0, [1, 2], 3) + 1` declines, and `unsupported` is
`["If(0 < x, [1,2], 3)"]`. This is the simple, sound version: it can decline
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
`L = [[1, 2], [3, 4]]`. The host declares the element type
(`list<list<real>>`) to compile it (`assertSettledFoldElements()`,
`compilation/compile-admission.ts`). When the type settles the shape of the
elements (all numbers, or all lists and points), the fold tests no shape of
the elements at run time, and no shape of a source that is an array by its
structure (the third exception below): with `L: list<tuple<real, real>>`,
`Sum(L)` compiles to
`(_.L).reduce((_a, _b) => _SYS.add(_a, _b), 0)`. A source typed as a union
of a number and a list with elements of a settled shape (a parameter
declared `list<real> | real`, `k(x)` with a host function
`k: (real) -> real | list<real>`) keeps one test of its own shape on
JavaScript: a number is the fold of itself, as in the interpreter. The
same holds for three other consumers of a list, when the list is an
array by its structure. The loop of an indexed `Sum` or `Product` whose
innermost term is typed as a list copies the first term with no test of
its shape: with `L: list<real>` and `n: integer`,
`Sum(L·i, i, 1, n)` seeds its accumulator with `_t.slice()`. `Max` or
`Min` of one operand typed as a list (`Min(P·(1 − v) + Q·v)` with
`P, Q: list<real>`) reduces the list with no test of its shape. On
`interval-js`, the fold of an input typed as a list of numbers
(`Sum(L)`) reads the array with no test of its shape. These consumers
still test the value for absence: on JavaScript, the `NaN` of a length
mismatch and `undefined` are tested by value (`_v !== _v`), and the
result stays `NaN`; on `interval-js`, a source other than a symbol or a
list literal can be the absence marker of that target, an interval, and
the fold keeps the `Array.isArray` test that tells it from a list. That
test is a test of absence: the fold of an `interval-js` source that can
be a number or a list (a `broadcastable<real>`, `Max(2b)` with
`b: broadcastable<real>`, or a `Which` with a list branch and a number
branch) declines with `unsettled-shape`, and the interpreter evaluates
it. On JavaScript, `Max` or `Min` of an operand that can be a number or a
list declines in the same way, alone or beside other operands: with
`S: indexed_collection`, `Min(Distance(S, (1, 2)))` declines, because
`Distance(S, (1, 2))` has the type `list<number> | number`; with
`S: list<list<real>>` it compiles. A symbol declared with such a union (an
input or a parameter) keeps its one test, as R2 allows.

Two consumers on JavaScript are exceptions to R3, and keep a run-time
test of the shape of a value whose type is a union of a number and a
list:

- The term of an indexed `Sum` or `Product` written as a loop. The loop
  seeds its accumulator with a copy of the first term when the term is
  an array, and with the term itself when it is a number. Corpus witness:
  `\sum_{i=1}^{\mathrm{Length}(U)} \begin{cases}i & C=U[i]\\0 &
  \top\end{cases}` with `C` and `U` lists, where the condition compares the
  list `C` with a number, so the term can be a number or a list. A decline
  would make this document evaluate each value with the interpreter. A
  polynomial `\sum_{i=0}^{\mathrm{Length}(C)-1} C[i+1]x^i` is not an
  exception when `C` is an input whose element type is declared, or a
  symbol that holds a list of numbers: the compiled code folds the held
  list into a constant, so `C[i+1]` is a number even when `C` is declared
  with the bare type `list` (`isHeldListArithmetic()` in
  `compilation/provable-kind.ts`). A `C` that the host supplies through
  `vars` is not folded, and keeps the test.
- A component of a `PointList` whose type is `broadcastable<T>`, or a
  component of a type that does not settle its shape. The component is
  one coordinate when it is a number and a list of coordinates when it
  is an array. Corpus witness: a recursive point function,
  `Q(i) = \operatorname{PointList}(1, 0)` for `i ≤ 0` and
  `\operatorname{PointList}(Q(i-1).x + Q(i-1).y, Q(i-1).x - Q(i-1).y)`
  otherwise, whose inferred return type is wider than the point it
  returns, so the components `Q(i-1).x + Q(i-1).y` can be a number or a
  list.

A declaration removes the test when the union comes from an open type:
declare the element type of a list input (`C: list<real>`) or the result
type of the function (`Q: (real) -> tuple<real, real>`), and the compiled
code has the settled form.

A third exception, on JavaScript and `interval-js`, has no declaration
that removes it: a value whose type is a list, but that is not an array by
its structure. An indexed `Sum` or `Product` over a list of unknown length
gives the number `0` or `1` for an empty range, as the interpreter does
(`emptyBigOpValue()` in `symbolic/big-op-identity.ts`), so a value typed
as a list that is computed through one can be a number at run time. With
`L: list<real>` and `n: integer`, the inner sum of
`Sum(L·j, i, 1, n, j, 1, i − 1)` is `0` at `i = 1`, and
`Max(2·Sum(L·i, i, 1, n))` is `0` at `n = 0`. The compiled code tests no
shape of a list only when the value is an input of the host typed as a
list, a `List`, `Tuple` or `PointList` literal, element-wise arithmetic
with one such operand, `Map(f, x)` over such a value, or `At(x, i)` of
such an input or literal (`isGuaranteedArray()` in
`compilation/javascript-target.ts`). Any other
list value (a call, a `Block` local, a symbol with a value, an indexed
`Sum` or `Product`) keeps the run-time test of its shape in the consumers
above: the seed of an indexed `Sum` or `Product`, `Max` or `Min` of a list
operand, alone or beside other operands, the fold of `Sum` or `Product` of
a collection of numbers or of lists, and the fold of `interval-js`. A
number is then the fold or the extremum of itself, as in the interpreter:
with the same `L` and `n`, `Sum(Sum(L·i, i, 1, n))` and
`Max(2·Sum(L·i, i, 1, n), 1)` are `0` and `1` at `n = 0`. `Max`, `Min`
and the fold of `Sum` or `Product` of a collection of numbers also test no
shape of a symbol with a declared list type (a parameter of a function
literal, or a local of a `Declare` statement), of a `Take` or `TakeWhile`,
and of an `If` or `Which` whose value branches are all such values
(`foldNeedsNoShapeTest()`). The interpreter gives an `incompatible-type`
error for a number at a declared parameter or local, and the compiled code
throws there. A `Take` or `TakeWhile` of an array or of a lazy stream
(`Sum(Take(Map(x ↦ x², 1..∞), 10))`) gives an array; of a number it
throws (see "Known limitations"). The fold of a
list whose type states a width of fewer than five terms (`vector<3>`) is
written term by term with no test: an indexed `Sum` or `Product` of such a term is a list of
that width for an empty range, not a number.

**R4. A declared union at an input follows R2.** With
`y: real | tuple<real, real>` and `f := t ↦ 2t`, `f(y)` compiles to
`(Array.isArray(_.y) ? _fn_f_tuple_real__real_(_.y) : _fn_f(_.y))`, and gives
`6` for `y = 3` and `[2, 4]` for `y = [1, 2]`. The host pays one test for
each run. When the body of one member declines,
the compilation declines with the reason of that body: with
`U: real | list<real>`, `Sum(U)` declines, because `Sum` of a number has no
indexing set, and no body for both members tests the shape of `U` inside it.

**R5. The compiler assumes that every value holds its static type.** It
emits no test of it, for the values of the program and for the values of the
host.

- A value of the program: where the static type of an assigned value, or of
  the result of a call, does not prove the declared type, the compilation
  declines. With `x: real`, `Block(Declare(p, "real"); p ≔ (x, 2); p)`
  declines with `'unsettled-shape'`. With `h` declared `(number) -> number`
  and `h := t ↦ [t, t]`, every call of `h` declines; the interpreter gives
  an `incompatible-type` error for `h(3)`. An argument whose static type
  does not prove a parameter type that admits only some real numbers
  (`integer`, `real<0..>`) is assumed to hold it: with `g` declared
  `(integer) -> integer`, `g := t ↦ 2t` and `y: real`, `g(y)` compiles to
  `_fn_g(_.y)` and gives `5` at `y = 2.5`, where the interpreter gives an
  `incompatible-type` error. Only an argument whose static type has no value
  of the parameter type declines.
- A condition: compiled JavaScript does not test at run time that a
  condition of `If`, `Which` or `Boole` is a boolean. When the static type
  of the condition admits a value that is neither a boolean nor absent, the
  compilation to JavaScript declines with `'unsettled-shape'`
  (`assertBooleanOrAbsentCondition()`, `compilation/compile-conditions.ts`):
  with `c: boolean | integer`, `If(c, 1, 2)` declines, and so does a
  condition of type `unknown` (the untyped parameter `c` of
  `(c ↦ If(c, 1, 2))(b)`). The interpreter gives an unevaluated form for
  such a value. One run-time check of this kind stays: the result of the
  predicate of `Filter`, `Count`, `Any`, `TakeWhile` and the other
  operators that take one, when its static type does not prove a boolean,
  goes through `_SYS.predicateResult`, which throws for a value that is not
  a boolean (`predicateResultCheck()`, `javascript-target.ts`). The type of
  a predicate literal is computed without the element type of its source,
  so it often does not prove a boolean (`c ↦ c[4] = d` over a list of
  tuples is typed `boolean | list<…>`).
- A value that the host gives outside the declared type of an input: the
  result is undefined. It can equal the value of the interpreter, differ
  from it, throw or not end, and it can differ between targets. With
  `x: real`, `x + 1` gives `2` for `x = true` and `"ab1"` for `x = "ab"` on
  `javascript`. A throw is one of these undefined results, so one run-time
  check stays (user decision 2026-11-02): an `At` read of a list from
  outside the compiled code whose static element type is numeric, declared
  or inferred, goes through `_SYS.atNumeric`, which throws when the element
  is a list. With `h := v ↦ v[1] + 1`, `h(xs)` throws for
  `xs = [[1, 2], [3, 4]]`, where JavaScript would give the string `"1,21"`.
  The check costs nothing on the common read: each compiled function has its
  own copy of the helper, which returns a number element at an integer index
  in range before the check runs.
- An input that the host leaves out: the result is undefined in the same
  way. On `javascript`, `x > 0` compiles to `0 < _.x` and gives `false` for
  `run({})`, and `If(x > 0, 1, -1)` compiles to `((0 < _.x) ? (1) : (-1))`
  and gives `-1`. With `L: list<real>`, `Sum(L)` compiles to
  `(_.L).reduce((_a, _b) => _a + _b, 0)`: `run({})` throws a `TypeError` on
  `javascript`, and gives `undefined` on `interval-js`.
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
- When an input can have two shapes, compile one function for each shape,
  or declare the union (`real | tuple<real, real>`). The first has no
  run-time test. The second costs one test for each run, where the input is
  bound (R4).
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
an error in the expression from an operator that has no lowering
(`throwStaticTypeError()`, `compilation/compile-static-type-error.ts`; the
token is added by `buildInterpreterFallback()`,
`compilation/compile-references.ts`); its diagnostic has the code
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
global `G` whose body has the type `error`, `G() + u` with `G` replaced
through `functions` declines; a symbol that a `Block` assigns, such as `v` in
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
- A non-finite value for an input declared `real` (`real` holds only finite
  values). Today the `javascript` target computes with the IEEE value, as it
  would for an input declared `real | signed_infinity | nan`, and a GPU
  target can assume a finite value (`a - a` is `0`, `a/a` is `1`). This is
  an observation, not a guarantee. `NaN` and `±Infinity` keep their meaning
  in an input declared `real | signed_infinity | nan`.

  On the shader targets, a call of `sin`, `cos`, `max`, `min` or `clamp`
  uses the built-in when its argument is proven finite in f32 from the
  declared types and ranges of the inputs, the declared ranged result types
  of the user functions, the declared ranges of their parameters, the
  values that the calls of a user function pass, the literals and the
  operators of the expression. Otherwise it calls a helper that gives `NaN`
  for an infinite argument, as the interpreter does. The compiler does not
  read the body of another function to prove a call of it: the host
  declares the range of an input (`t: real<-5.5..5.5>`) or a result type
  with a range for a function (`(real) -> real<-1..1>`) to get the
  built-in. That range is read as the bound of the call: `sin(1000·f(x))`
  calls the built-in. A result type with no range (`(real) -> real`) is not
  enough, since the body is computed in f32 and can overflow
  (`f(u) := exp(u)`). A body whose f32 value leaves its declared range
  gives a value outside its type, and the compiled value is then
  unspecified. In the body of a user function, a parameter is finite for
  certain when every call of the function in the compiled expression passes
  a value that is proven finite at its position, or when the host declared
  the parameter with a range (`(real<-1..1>) -> real`); an argument outside
  that range is a value outside its type. With `x: real<-1e15..1e15>` and
  `F(a) := sin(a)`, `F(x)` emits `sin(a)` in `_fn_F`; a second call
  `F(exp(y))` with `y: real` makes it `_gpu_sin(a)`, since `exp(y)` can
  overflow in f32. A bare declared `real` parameter is not enough, for the
  same reason. With `t: real<-5.5..5.5>`,
  Tycho's `sin(10000(51.1⌊t⌋ − 3.9))` compiles to
  `sin(10000.0 * (51.1 * floor(t) + -0.000026879834))` on GLSL. With
  `x: real` and `f(u) := cos(u)/2`, whose result type is `number`,
  `sin(f(x))` compiles to `_gpu_sin(_fn_f(x))`; with `f` declared
  `(real) -> real<-1..1>`, it compiles to `sin(_fn_f(x))`. The helper and
  the built-in give the same value on a finite argument.
- A value outside a declared range (`7` for `real<0..5>`): today the
  `javascript` target computes with the value; a GPU target can use the
  range (it can drop `|x|` for `x` in `real<0..5>`).
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
(`real | list<real>`) is a type, and is not refused. A parameter of a
function literal, of a user function or of the root function is not an input
and is not refused: `t ↦ 2t` compiles, and a list passed to its untyped
parameter is a value outside the type that the body implies (`2t` reads a
number), so the result is unspecified. The parameter names passed to
`compileFunction(expr, name, params)` are inputs, not the parameters of a
root `Function` literal: the host chooses them and passes their values, so
their types come from the engine's declarations, and a name whose type is
`unknown` or `any` declines with `'untyped-input'`. With `i` declared `any`,
`compileFunction(At(b, i), "f", ["b", "i"])` declines. A host that wants an
untyped parameter compiles a root `Function` with a `Typed` parameter
instead. A transparent alias of `unknown` or
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
the compilation declines. The check is `assertAdmitted()`
(`compilation/compile-admission.ts`).

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
its last one, the body of a `Loop`, and a branch of such a conditional. An
`Assign` has the type of its value, and
`Block(p ≔ (0, 0); n ≔ 0; If(x > 0, p ≔ (1, 2), n ≔ 3); n)` compiles.
A branch of an element-wise selection (a condition that is a list) whose
type is a point or a list of points also declines on JavaScript: with a host
function `W` declared `(real) -> tuple<real, real> | list<tuple<real, real>>`
and `F: list<boolean>`, `If(F, W(t), (0, 0))` declines with
`'unsettled-shape'`. An input declared with this union compiles as such a
branch, because the code tests the input where it is bound (R4). In the same
way, a sum with a point or with a list of points (on JavaScript), and the
absolute value (on every target), of a value whose type admits a point and
another shape decline (the absolute value of `list<number> |
tuple<number, number>` included): with `L: list<tuple<real, real>>`, `W(t) + L` and
`Sum(L) + (1, 1)` decline (the type of `Sum(L)` is
`integer | tuple<real, real>`, because the sum of an empty list is `0`).
A component of a `PointList` that is a coordinate of such a value declines
too: with `p` undeclared, `PointList(p.y, p.x)` infers `collection<any> |
tuple` for `p` and declines; declared `tuple<real, real> |
list<tuple<real, real>>`, `p` is tested where it is bound (R4).

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

- A declaration has a value: `Declare(x, type, v)`, or a first
  `Assign(x, v)` at the block's own level, which is the declaration. A
  `Declare` with no value, a first assignment inside a branch, a loop body or
  a `Match` case, and a use of a local before its declaration are static
  errors (`declaration-without-value`, `first-assignment-in-branch`,
  `read-before-declaration`), so the compilation declines. No compiled code
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
| `Block(Assign(a, 1), If(c, Assign(a, 2)), a)`                 | compiles (JavaScript, GLSL; Python declines the `If` with no `else`) |
| `Block(Declare(a), If(c, Assign(a, 1)), a)`                   | static error: `a` has no value                     |
| `Block(Assign(a, 1), Assign(a, "x"), a)`                      | static error: `"x"` is not a `number`              |
| `f(a ≔ 2) + a`                                                | static error: an assignment is a statement         |
| `c ≔ n + 1` with `c` a symbol of the engine                   | declines                                           |
| `y ≔ Loop(…)`                                                 | declines: a loop has no value                      |
| `1 + Block(Assign(b, x), 2b)`                                 | declines: a block with an assignment is not an operand |
| `1 + (a - ⌊a⌋ where a ≔ 3.7x)`                                | compiles: a block of declarations is a value       |
| `[1, Block(b ≔ 2)]`                                           | declines: the value of the block is `Nothing`      |

The lane of a local follows its static type (see "Compile modes"). With
`c: real` and `x: real`, the local `a` of
`Block(a ≔ 1; If(c > 0, a ≔ √(-x)); a)` has the type `number`. In mode
`strict` the compilation declines (`unsettled-shape`: the local gets a real
and a complex value; with the complex literal `2 + 3i` in place of `√(-x)`
it declines with `lane-mismatch`). In mode `complex`, on JavaScript, it
compiles and gives the values of the interpreter: `2i` at `c = 1, x = 4`,
`1` at `c = -1`, `2` at `c = 1, x = -4`.

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
its value: `Block(s ≔ 0; Loop(s ≔ s + k, k ∈ 1..3); s)` compiles. Only a
loop with no indexing set and no `Break` of its own compiles where its value
is used: it ends only through a `Return` or never ends, so its value is the
value of the `Return`. A loop with an indexing set declines also when it has
a `Return` and is the body of its function, or the last statement of a block
in tail position. For example, with `x: real`, the search loop
`((p) ↦ Loop(If(k > p, Return(k)), k ∈ 1..5))(x)` gives `3` for `x = 2` and
`Nothing` for `x = 9`, where no `Return` runs; the compiled function gave
`undefined` (JavaScript) or `None` (Python) for `x = 9`, so the loop
declines. To compile a search loop, put the loop in a statement position,
store the value that it finds in a local, and end the block with that local:
`Block(r ≔ 0; Loop(If(k > x, Block(r ≔ k, Break())), k ∈ 1..5); r)` compiles
on JavaScript and Python, and gives `3` for `x = 2` and `0` for `x = 9`, as
the interpreter does for this block. No compiled form gives `Nothing` when
no value is found: the initial value of the local (here `0`) takes its
place, and `r ≔ Nothing` declines. A loop in a case of a `Match` whose value
is used is checked in the same way. The loop check is `unsettledShapeIn()`
(`compilation/compile-admission.ts`).

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
of the value of a dictionary entry (`assertNoNothingElement()` and
`hasNothingArm()`, `compilation/compile-inner.ts` and
`common/type/subtype.ts`). `any` and `unknown` have no explicit
`nothing` arm, and do not decline here. The reason: compiled code produces
`Nothing` only from the symbol `Nothing` read as a value, or from a
statement read as a value (a loop, a block that ends in a declaration), and
both decline where they occur. A `Nothing` that the host supplies for a
value typed `any` is a value outside its type, and the result is
unspecified. A value typed `any` or `unknown` can still decline for another
rule: an input typed `any` (R1) or a value with no settled shape
(R3), such as `Sum(w)` with `w: collection<any>`. So
`Map(u ↦ If(c, Nothing, 7), [1, 2])` declines at the symbol `Nothing`, and `(u ↦ 7)(P)` over a list of points
`P: list<tuple<real, real>>`, which the compiler maps over the points with a
call typed `any`, compiles to `[7, 7, …]`. The test reads the result type
of the callback, not the result type of the `Map`: the type of `Map` adds
a `nothing` arm to its elements when the callback result is `any`, and
`Map(h, 1..3)` with a local function `h := k ↦ k + 1` compiles to
`[2, 3, 4]`.

On the shader targets, a conditional whose value the code discards (with
branches of different shapes) declines too, because its shader code is a
conditional expression (`c ? a : b`) whose branches must have the same
type. Points of different sizes (`If(x > 0, (1, 2), (3, 4, 5))`)
conflict only on the shader targets, where they are a `vec2` and a `vec3`;
on the other targets a point of any size is one array, and the union of the
two tuple types compiles. A written `NaN` is a number, so a `NaN` branch
beside a point or a list declines: `If(c, (x, y), NaN)` is a point when `c`
is true and the number `NaN` when `c` is false. A branch that a condition
known when the code is generated excludes is not compared: a condition that
is `True` or `False`, or whose static type is the literal `True` or `False`
(`2 < 3`), selects its branch, so `Which(2 < 3, [1, 2], True, 0)` compiles
to the list. On the shader targets, only the branches that the shader code
keeps are compared, as every branch in the shader must have the same type:
an `If` whose condition has a literal static type keeps one branch
(`If(2 < 3, (1, 2), 0)` compiles to `vec2(1.0, 2.0)`), but an `If` whose
condition is the symbol `True` or `False` keeps both, and a `Which` keeps
every value up to its first `True` clause, so `If(False, (1, 2), 0)` and
`Which(2 < 3, (1, 2), True, 0)` decline there. A conditional inside a
branch that the code drops is not checked, because the code never evaluates
it: `If(2 < 3, 0, If(x > 0, [1, 2], 3))` compiles to `0` on every target.
In the same way, a name that occurs only in a dropped branch is not an
input: with `z` undeclared, `If(2 < 3, 0, z)` compiles, also when `vars`
maps `z`. A name that occurs anywhere in the code that is kept, also where a
binder binds it, stays an input: the check cannot always tell a bound name
from a read of the outer input (the variable of an indefinite integral), so
`If(2 < 3, 0, x) + Integrate(x^2, Limits(x, Nothing, Nothing))` with `x`
undeclared declines, and so does
`List(If(2 < 3, 0, z), Sum(z, Limits(z, 1, 3)))`, although the `z` of the
sum is its index. On the shader
targets, `If(True, 0, z)` keeps both branches, so it reads `z` and `z` is
refused there. A sub-expression of static type `error` declines also in a
dropped branch. The conditional is found before the code is generated
(`unsettledShapeIn()`), and the decline is thrown after the code was
generated with no other decline (`assertAdmitted()`), so a more specific
reason of the target stays the reason: `If(x > 0, [1, 2], 3) + 1` on `glsl`
declines because a shader array has no arithmetic. These are rules R1 and R3
of "Shapes are settled at compile time" above; the design record is
`docs/plans/2026-10-31-static-shape-compilation.md`.

A typed array for a `list` input and a string for a bare
`indexed_collection` input are values of their types. Compiled code cannot
read them correctly, so the JavaScript runner refuses them with a
`TypeError` that names the binding (see "Target boundaries"). The other
checks, which existed only for the unspecified cases, are removed (R6 in
"Shapes are settled at compile time"); the decision and the survey of these
checks are in `docs/plans/2026-10-31-compiled-code-contract-for-errors.md`.

One value carve-out is ruled (pole-encoding ruling, 2026-08-28): where the
interpreter answers the projective infinity `~oo` — a division pole, a Gamma
or Factorial pole, an embedded `~oo` constant — a float-only target answers
the IEEE `Infinity` instead of declining. The projection keeps the infinite
magnitude and drops the direction `~oo` never had; it is what the bare
division instruction already answers at a runtime pole, so folded and
runtime spellings of the same pole agree. `NaN` remains reserved for the
genuinely indeterminate (`0/0`, `0 · ∞`) and for NaN propagation under
Contract B's `propagate` policy.

For a form with no value (`0/0`, `0 · ∞`, `0^0`, `Mod(x, 0)`) the
interpreter answers `NaN` on the exact route, with a float operand and
under `.N()`, and every compiled target answers the IEEE `NaN`: `NaN` in
JavaScript, `np.nan` in Python and `_gpu_nan()` in the shaders. The input
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
`+Infinity` at entry (`isUnsignedPole` in the JavaScript target), so one
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
| `\{1/x > 0: 1, 0\}` | `x = 0` | `1` (also `python`, with a NumPy `x`) | `0` (`~oo` has no order, user decision 2026-10-21) |
| `Sign(1/x)` | `x = 0` | `1` | `NaN` |
| `Floor(1/x)` | `x = 0` | `Infinity` | `~oo` |

In the first two rows, the argument `~oo` (`{re: Infinity, im: Infinity}`)
becomes `Infinity` at the entry of the compiled function. In the third
row and the last two rows, the pole is computed inside the compiled code:
`1/0` is the double `Infinity`, and the comparison, `Sign` and `Floor` read
it as `+∞`.

A CONSTANT pole in an ordering comparison is not a divergence. When an
operand of `Less`, `LessEqual`, `Greater` or `GreaterEqual` is a closed
operand whose exact value is `~oo` (`1/0`, `(-1)!`, `1/0 + 2`, a symbol
assigned `1/0`), the comparison compiles to the target's `False` on every
target, as the interpreter answers (`~oo` has no order, user decision
2026-10-21): `x < 1/0` at `x = 1` is `false` on `javascript`, `python`,
`glsl` and `interval-js` (`'false'`), and so is `0 < 1/0`. This
applies when the other operands are pure and cannot be lists at run time;
otherwise the comparison keeps its code, with the pole as `Infinity`
(`constantPoleOrdering` in `base-compiler.ts`, ROADMAP CE-211). The value
`False` was chosen because no single compiled value of the pole gives the
interpreter's answers both in an ordering and in arithmetic: `NaN` gives
`false` in every ordering, but `x + 1/0` would then be `NaN` where the
interpreter answers `~oo`, which the projection spells `Infinity`. An
equality is not changed: `x = 1/0` compiles to `x === Infinity`, `false`
for a finite `x`, as the interpreter answers, and `1/0 = 1/0` folds to
`false` on `javascript`, `glsl` and `python`, also under
`constantFold: false`. `interval-js` does not fold an equality and answers
`'true'` for `1/0 = 1/0` (`docs/ERROR-MODEL.md`, "a value with no order").

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

### Folds over rows of unequal length give `NaN` (user decision 2026-10-17)

This is a named exception to the rule of `docs/ERROR-MODEL.md` §6 that a
compiled expression does not answer `NaN` where the interpreter answers an
error. With `v: list<list<real>>`, compiled `Sum(v)`, `Product(v)`,
`Reduce(v, Add)` and `Scan(v, Add)` combine the rows element by element. Two
rows of unequal length have no element-wise sum, and the compiled
element-wise combiner (`_SYS.add`) answers `NaN` for them, as the compiled
`Add` of two lists of unequal length does:

| `v` | Compiled | Interpreter |
|---|---|---|
| `[[1, 2], [3]]`, `Sum(v)` | `NaN` | `Error("incompatible-dimensions", "1 vs 2")` |
| `[[1, 2], [3]]`, `Product(v)` | `NaN` | `Error("incompatible-dimensions", "2 vs 1")` |
| `[[1, 2], [3]]`, `Reduce(v, Add)` | `NaN` | `Error("incompatible-dimensions", "1 vs 2")` |
| `[[1, 2], [3]]`, `Scan(v, Add)` | `[[1, 2], NaN]` | `[[1, 2], Error("incompatible-dimensions", "1 vs 2")]` |
| `[[1, 2], [3, 4]]`, `Sum(v)` | `[4, 6]` | `[4, 6]` |

The type `list<list<real>>` does not fix the length of a row, so a compiler
that obeys §6 would have to refuse every fold over such a list, including
the correct ones (the last row). A list of rows is the usual input of a plot,
and an input with rows of unequal length already shows the failure as
`NaN`, so the compiled fold is kept. A caller that needs the error evaluates
through the interpreter. The test "rows of unequal length…" in
`test/compute-engine/compile-absent-collection-operand.test.ts` pins this
behavior.

A second value carve-out is ruled (compiled-equality ruling, 2026-09-09):
compiled `Equal` and `NotEqual` on numeric operands are EXACT, the IEEE 754
comparison (`===` on JavaScript, `==` on Python, `==` on the shader targets),
with no tolerance. The interpreter compares two numbers within
`engine.tolerance`, so `0.1 + 0.2 = 0.3` evaluates to `True` and compiles to
`false`. The compiled lanes serve plot kernels, where every comparison runs
per sample and a tolerance test costs a subtraction, an absolute value and a
compare each time, and where the exact answer is the one the reference
graphing calculators give. The same rule covers `KroneckerDelta`, the
element-wise and whole-collection equality helpers (`_SYS.eq`, `_ce_eqcoll`),
and the `IndexOf` element test, which was already exact. `NotEqual` is the
negation of the `Equal` test, so it answers `true` on a `NaN` operand, as the
interpreter does. The value of a comparison over an absent operand is not
specified in compiled code (see "Caveats of compiled code"): with `x, y: real`,
`x = y` compiles to `((_.x) === (_.y))`, which is `true` when the caller
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
compiled `Equal` or `NotEqual` over collections (`_SYS.eq`, `_SYS.neq` on
JavaScript) is a boolean, and so is a whole-collection comparison. With
`Equal([1, Missing], 1)`, the compiled code gives `[true, false]` and the
interpreter gives `[True, False]`; the compiled cell is a value computed from
an absent operand, which the caveats of compiled code leave unspecified. A
branch condition compiles to the same code as the comparison. A condition
whose static type admits a value that is neither a boolean nor absent
declines (R5). A condition that can be absent goes through `_SYS.cond` on
JavaScript, which reads `undefined`, `null` and `NaN` as `false`, so a
branch with an absent condition takes its next arm, as in the interpreter.
The element-wise selection runtime (`_SYS.select`) reads an absent condition cell the same way:
the position is not selected by that clause, and a later clause can select
it. A comprehension guard that is not provably a boolean is tested with
`=== true` on JavaScript and with the Python test of `pythonGuardTest()` on
Python. `KroneckerDelta` is not a comparison: its codomain is numeric, and
it gives `0` where the operands are not equal.

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
For these operations, an operand beyond the safe integer range, or an
infinite operand, is an error. The compiled JavaScript throws a `RangeError`
that names the operation and the value (`Mod: Infinity is beyond the safe
integer range of compiled code …`). The CLI's compile mode reports it as an
error value. The operations are `Mod`, `Remainder`, `GCD` and `LCM` (the
runtime helper `integerOperand` in `compilation/javascript-runtime.ts`). The
Python target raises a `ValueError` for `Mod` and `Remainder` (`GCD` and `LCM`
have no Python lowering); there a Python integer is exact at any magnitude and
passes `Mod`. A `NaN` operand is not an error: it propagates as through the
other arithmetic. `Mod` by the literal `1` is not checked, because the
remainder by `1` of every double beyond the range is `0`, which is also the
exact answer.

The `bigint` mode of the JavaScript target (`compile(expr, { mode:
'bigint' })`, "Compile modes") is exact beyond this range. It computes every
integer value of an integer-typed expression as a `bigint`, so `Mod(n, 10)`
at `n = 2^60 + 1` gives `7n`, and `Mod`, `Remainder`, `GCD` and `LCM` do not
throw. It has a size limit: `Power`, `Factorial`, `Factorial2`, `Binomial`
and `Fibonacci` throw a `RangeError` when their result would have more than
1,000,000 decimal digits, where the interpreter leaves the expression
unevaluated. Both mean that there is no value, but the host receives a
different answer from each.

Constant folding follows the same rule. A constant subtree is folded with the
interpreter's `.N()`, which rounds each operand to the working precision
first, so an integer operation then reads a rounded operand as exact:
`DigitSum(2^1000)` folded to `84` where `evaluate()` answers `1366`. When an
operand of `Mod`, `Remainder`, `GCD`, `LCM`, or an operand at a parameter
that the operator's signature declares `integer`, is beyond the safe integer
range, the fold uses the value of `evaluate()` when that value is exact and
every such operand evaluates to an exact rational. Otherwise the fold
declines, and the structural lowering throws at run time, or declines when
the target has no lowering for the operator (`DigitSum`, `IntegerDigits`).
The shader and interval targets have no error channel and are not changed.

Whether a constant subtree is folded at all is decided by a deterministic
estimate of the work its evaluation can cost (`foldCostEstimate` in
`base-compiler.ts`), never by a time limit. The estimate depends on the
expression only, so the same input always compiles to the same code on any
machine and under any load. A definite integral is priced at the worst case of
the adaptive quadrature, so a nested integral declines to fold.

## Running stored JavaScript

The code of a JavaScript compilation result reads only `_SYS` and `_`.
`@cortex-js/compute-engine/runtime` exports `createJavaScriptRuntime(options)`,
the `_SYS` that `run()` uses, with no engine behind it, so code compiled in one
place (a worker, a build) runs in another with only the numerics it calls. Its
type exposes `load`, `frame` (set with `setFrame`), `iterationLimit`, `deadline`
and `runtimeVersion`;
the helper table is internal and may change in any release. `load()` evaluates
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
`runtime.frame.next`),
`iterationLimit` (`Infinity` when 0 or less) and `deadline`. A denied draw
throws a `CapabilityDeniedError`, a different class in each bundle: test
`e.name`, not `instanceof`. Tolerance, angular unit and the digits a negative
base's float exponent is read to (`reconstructionDigits`, 15 to 17 by the
engine's precision) are fixed at compile time, and compiled code always uses
machine floats.

The result and the runtime both carry `runtimeVersion`; a mismatch means the
code was compiled by another release, and `runtime.load()` refuses it, as it
refuses code with no `runtimeVersion`.

`runtime.load()` and `runtime.loadBroadcast()` also refuse code compiled with
the compile contract of a value kind (see "Value kinds" below): the result
lists the kind types in `valueKinds`, and the entry plan lists the bindings
of a kind type in `entryPlan.kinds`. Such code reads a host value for a
symbol of a kind type through the `entry` check of the kind's contract, which
is a function of the host that compiled the code, and stored code cannot
carry a function. Code that reads no binding of a kind type and whose
contracts all say `shippable: true` is accepted by the batch loaders that a
worker of the kernel pool uses; `load()` refuses it. There is no `store()`:
such code runs only through the `run()` of its compilation result.

Functions passed in the `functions` or `imports` compile options are copied into
the code as source (`toString()`): a closure loses its enclosing scope, and a
function given by name must exist where the code runs.

`compilation/javascript-runtime.ts` holds the helpers and imports no engine code
(`test/compute-engine/js-runtime.test.ts` bundles the entry point and checks
it). `run.SYS` is built from the same factory.

## Target boundaries

The JavaScript target supports the broadest dynamic representation. Python,
GLSL, interval, and other targets expose narrower capabilities and must
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
collection or a `{re, im}` result comes back as the code built it, with no
copy: it may be a value the runner keeps for every later call (a hoisted
constant list literal, a bound symbol value), so a caller that writes to a
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
compiled code still reads it as UTF-16 code units. The Python target binds its parameters as plain Python names and
has no entry check, so it has no equivalent of this refusal. Typed arrays
are not used inside the artifact: a typed pipeline measured no faster than the
plain one on the witness that asked for it, so the container would add
per-helper result-kind rules for no gain. The measurements and the decision
are in
`docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.

### The GLSL fragment and `canCompile()`

The `glsl` target compiles a fixed list of forms, the GLSL fragment. A shader
renders pixels in f32 on each frame and does not compute stored data, so the
target takes a small language and checks it before it writes code. An
expression is in the fragment when each node of its canonical, typed tree is
in this list:

- **Values.** A real scalar (`float`), an integer, a boolean, a complex
  number (`vec2`), a point or vector of 2 to 4 real components, a color, a
  constant list of at most 256 reals or points, and a list input. A list
  input of at most 256 elements is a uniform array. A longer one must be
  named in the `storage` option with the hint `'sampler2D'`, which has no
  limit on the length; otherwise it is refused, and the diagnostic gives its
  length, the limit and the option (`storage: { H: 'sampler2D' }`). Each free
  symbol has one of these types, declared or inferred. A symbol of type
  `unknown`, `any`, `expression`, `symbol`, `string`, `function` or `value`,
  or a collection with no static count, is outside, and the diagnostic names
  the symbol: the host repairs it with a declaration. The `vars` option is
  spelling and is accepted, except an entry that is code where the shader
  code would write that code twice.
- **Heads.** Arithmetic, the elementary and special functions that the
  shared GPU table lowers, the parts of a complex number, the operations on
  points and vectors (`Dot`, `Cross`, `Norm`, `Normalize`, `Distance`,
  `Reflect`, `Refract`, the components, and `Length`, which is the count of
  the components), the colors, the comparisons and logical operators on real
  or boolean operands, and `If` and `Which` when every branch has the same
  type. An `If` with no else branch is a value. Where its condition fails,
  the interpreter gives the absence value of the type of the branch, and
  the shader code gives the same value: `If(x > 0, x)` is
  `((0.0 < x) ? (x) : (_gpu_nan()))`, a point or a complex number has a
  `NaN` in each lane, and a boolean branch gives `false`. A color or a
  list of more than 4 elements has no `NaN` in the shader code, so such an
  `If`, or a `Which` with no default clause of such a type, is refused.
- **Aggregates and indexing.** `Sum` and `Product` over one or more integer
  index ranges (`Limits`, or `Element(k, Range(a, b))` with a step of 1),
  whose bounds can read an input or an outer index. Each one is a counted
  loop. A bound of type `real` is floored, as the interpreter floors it:
  `Sum(k, k, 1, r)` at `r = 2.5` is 3 on both. `At` with a numeric index on
  a constant list, a list input or a point; an index that is not an integer
  gives `NaN`, as in the interpreter (`At([10, 20, 30], 1.5)`). `Range` only as an
  index set. `Sum` and `Product` of one list with no index set add or
  multiply its elements, which the shader code writes one by one: the list
  is a point, a list of 2 to 4 numbers or a list literal of at most 256
  elements (`Sum(L)` with `L: list<real^3>` is
  `((L.x) + (L.y) + (L.z))`). A list input held as a uniform array of more
  than 4 elements, or in a texture, is refused there: the shader code has no
  list of its elements.
- **User functions.** A call of a user function whose parameters and result
  have fragment types and whose body is in the fragment, with no recursion.
  A parameter with no declared type takes the type of its argument at the
  first call: with `sq(u) := u^2`, `sq(x)` for `x: real` compiles with a
  `float` parameter and `sq(z)` for `z: complex` with a `vec2` parameter. A
  later call with an argument of another type (`sq(x) + Re(sq(z))`) is
  refused, and the diagnostic names the parameter and the two types. A
  parameter whose type is a list with no length (`list<number>`, the type
  that the engine infers from the `At` reads of
  `d(a, b) := a[1] b[1] + a[2] b[2]`) is read the same way: an argument
  `[x, y]` or `(x, y)` gives a `vec2` parameter. Another list parameter is
  admitted only when each call binds it to a list input; the function is
  then emitted once for each list.
- **User functions called with a list.** A call with a list of 2 to 4 reals
  has the value that the interpreter gives. When every parameter of the
  function has a scalar type (or no type), the interpreter applies the
  function to each element of the list, and the shader code does the same
  with a wrapper: with `f(u) := u mod 1`, `f([-x, -y])` compiles to
  `_fn_f_each2_1(vec2(-x, -y))`, which calls `float _fn_f(float u)` on each
  component. The function must have a real value and no complex or colour
  parameter, and all the mapped lists of one call must have one length; a
  point argument is not mapped. When a parameter of the function is not
  scalar, a list binds its parameter whole, as in the interpreter: a
  parameter with no declared type, or a point parameter whose type the
  engine inferred from index reads alone (`l(p) := sqrt(p[1]^2 + p[2]^2)`),
  takes the list as a `vec2` to `vec4`. With
  `R(V, t) := [Sum(V·[cos t, -sin t]), Sum(V·[sin t, cos t])]`,
  `R([x, y], 0.5)` compiles to `_fn_R_vector_real_2_number(vec2(x, y), 0.5)`.
  A point parameter that is declared, or that a call in the body requires,
  is a contract that the interpreter checks: a list there is refused. A
  later call with an argument of another type is refused, as for any
  parameter with no declared type.
- **Blocks**, as the body of a user function and at the root: `let` and
  `const` declarations of scalar, point or complex locals, an assignment to
  a local, a tuple assignment of locals, a `Loop` over an integer range with
  `Break`, `If` statements and a final expression. The forms nest. Epsil's
  `s += e` on a scalar local is in, and so is a `parallel for` over an
  integer range whose accumulators are scalar locals: the shader runs its
  passes in order, which gives the value of the interpreter. A list local
  and a write to an input are outside.
- **Compile-time work.** Constant folding, the closed-form derivative,
  common-subexpression elimination, and the unrolling of a comprehension or
  a `Map` over constant ranges or a constant list of at most 256 elements.
- **A number beside a declared shader vector.** `Add` and `Subtract` take a
  number beside a name that `compileShader()` or `compileFunction()`
  declares with a GLSL vector type, as GLSL does: `gl_FragCoord + 1` compiles
  to `gl_FragCoord + 1.0`. A point of the expression beside a number stays
  refused, because the interpreter refuses `(1, 2) + 2`.

Outside the fragment are, among others: random draws (`Random`,
`WithRandomSeed`), matrices, `Match`, `Return`, `Integrate`, the symbolic
heads (`Simplify`, `Solve`, `D` at run time), strings, dictionaries and
records, `Map`, `Filter`, `Reduce` and the other callback forms over a
collection with no static count, a comprehension whose range reads an input,
function literals and function values, `Apply` other than the application of
a derivative with a closed form, and `Range` as a value.

**The predicate.** `canCompile(expr, options)`, exported from
`@cortex-js/compute-engine/compile` beside `compile()`, tells whether
`compile(expr, options)` gives code, without writing code. It takes the
options of `compile()`, runs the preparation of the tree that `compile()`
runs (constant folding, common-subexpression elimination, the unrolling) and
then the typing pass, and answers `{ ok: true }` or
`{ ok: false, diagnostic }`. The diagnostic has the code `outside-fragment`,
the kind `capability`, a message, the node in `value`, and the head of the
first node outside the fragment in `operator` (`Integrate`), or a name in
`binding` (a free symbol with no fragment type, a parameter called with two
types, a list input over the limit). A host counts declines by head with
`operator`. The predicate never throws: an invalid expression, an invalid
option or an error of the preparation gives `ok: false` with the message of
the error. Its answer depends only on the expression, the options and the
declarations that the expression reaches (the types of its free symbols, the
definitions of the functions it calls), so a host can keep it until one of
those declarations changes. Only `glsl` has a fragment: for another target
the answer is `ok: false`, with a message that says so, except for
`javascript` with the `numeric-kernel` profile (below).

```js
canCompile(ce.parse('\\sin(x) + x^2'), { to: 'glsl' });
// ➔ { ok: true }
canCompile(ce.parse('\\int_0^x \\sin(t)\\,dt'), { to: 'glsl' }).diagnostic;
// ➔ { code: 'outside-fragment', kind: 'capability',
//     message: 'The head `Integrate` is outside the GLSL fragment.',
//     value: 'int_(0)^(x)(sin(t) dt)', operator: 'Integrate' }
```

**The compile runs the pass first.** `compile()`, and `compileFunction()`,
`compileShader()` and `compileToSource()` of the GLSL target, run the same
pass before they write code. When the pass refuses a node, `compile()`
declines with the diagnostic of `canCompile()` (`success: false` and the
interpreter, or an error with `fallback: false`), and the three other entries
throw an error with its message. When the preparation of the tree fails
(`1 + Block(acc := x², acc + 1)`, a block with an assignment used as an
operand), `canCompile()` gives its message with the code `outside-fragment`,
and `compile()` gives the diagnostic of the preparation (here
`unsettled-shape`). Emission does not decline an expression that the pass
accepts, except in the cases of the known limitations below; any other such
decline is a defect. A compile that succeeds keeps its warnings, such as
`float32-unsafe-argument`.

**The pass cap.** `compile()` to `glsl` counts the passes of the loops that
the shader runs: each pass of a `Sum`, a `Product`, a `Loop` and a
`parallel for`, also in the bodies of user functions, adds one to one count
for each evaluation of the compiled expression. The count is of the loops in
the emitted code: two equal sums that common-subexpression elimination
writes once count once, and with `cse: false` both count. Over the cap, the
loops stop and the value is `NaN` (`false` for a boolean value), so a slider
that raises a bound past the cap gives `NaN` pixels and no new compilation.
The cap is the `iterationBudget` option, with a default of 10,000 passes on
this target. `Infinity` sets no cap, and the code then counts no pass. A
finite budget is floored and kept at most 2^30, so that the counter cannot
overflow an `int`. `NaN` or a budget of at most 0 is refused. Only
`compile()` reads the option: `compileFunction()`, `compileShader()` and
`compileToSource()` count no pass.

```glsl
// Sum(k·x, k, 1, n) with { to: 'glsl', iterationBudget: 100 }
_gpu_passes = 0;
float _tv1 = 0.0;
for (int k = 1; k <= int(floor(n)); k++) {
  if (++_gpu_passes > 100) break;
  _tv1 += float(k) * x;
}
float _tv2 = _tv1;
return _gpu_passes > 100 ? _gpu_nan() : _tv2;
```

The `javascript`, `interval-js` and `python` targets have no fragment: they
take the whole language with their own declines. The `numeric-kernel`
profile of `javascript` (below) is a list of the same kind.

The list and the decisions are in `docs/plans/2026-11-08-glsl-fragment-spec.md`
(section 2 and decisions 1 to 18); the typing pass is
`src/compute-engine/compilation/fragment.ts` and
`src/compute-engine/compilation/glsl-fragment.ts`, and its design is
`docs/plans/2026-11-08-glsl-fragment-annotation-design.md`.

### The `numeric-kernel` profile of the JavaScript target

**Experimental.** With the option `profile: 'numeric-kernel'`, `compile()`
to `javascript` uses the structured compiler of the JavaScript target: an
admission and a typing pass (`javascript-fragment-target.ts`), a lowering
to a structured representation (`javascript-structured-lower.ts`), a
verifier, an emitter (`javascript-structured-emit.ts`), and the assembly of
the existing JavaScript target, which gives the result its `run`,
`broadcast`, `broadcastAsync` and `runAsync`. For each program it admits,
the value equals the interpreter's within the caveats of compiled code, and
the doubles equal those of the existing compiler with `cse: false` and
`constantFold: false`. The profile folds no constant: against the default
options of the existing compiler, which fold `√2 + √3 + 1/3` to one
literal, a result can differ in the last place. Without the option,
nothing changes.

| Admitted | Examples |
| --- | --- |
| Arithmetic of reals, integers and complex numbers | `Add`, `Negate`, `Multiply`, `Divide`, `Power` of a real base with the exponent 2, an integer exponent 3 to 5 or −2, another constant exponent that the existing emitter writes with `Math.pow` (`x^10`, `x^-3`, `x^1.1`, `x^(5/2)`), 1.5, the base `e`, a real exponent that is not a literal (`s^(d/2)`, a real result), or a float literal exponent with an odd recovered denominator and a base not proved non-negative (`u^1.6`); `Root` with the degree 3 or a degree that is not a literal; `Power` and `Root` of two finite number literals, written as the literal that the existing emitter folds them to (`10^1.5` is `31.622776601683793`, `(-8)^(2/3)` is `4`, `Root(-8, 3)` is `-2`, `(-8)^(3/2)` the complex value `-22.627…i`). With a complex operand: a product of any number of operands, a real operand not converted (`x·z`, `i·x`, `x + i·y`, `2i·x·y`); a quotient, with the guarded formula of the existing emitter for a complex divisor (`z/x`, `1/(t·ln t)`); `Power` of a complex base with a number literal exponent (`z^3`, `z^1.1`), and `Power` with a complex base or exponent and an exponent that is not a number literal (`z^x`, `x^z`, `2^z`: `_SYS.cpow`) |
| Functions | `Sqrt`, `Ln`, `Log` (base 10, 2 or a real base of a real logarithm), `Exp`, `Sin`, `Cos`, `Tan` (also of `π·u`), `Cot`, `Sec`, `Csc`, `Tanh`, `Sinh`, `Cosh`, `Arctan`, `Arsinh`, `Arcsin`, `Arccos`, `Arcosh`, `Artanh` (complex where the type of the node is complex: `Arcsin(x)` with `x: real`), `Arctan2`, `Hypot` (two operands), `Abs`, `Sign`, `Gamma` (one operand), `Erf`, `Erfc`, `Digamma`, `Haversine`, `Conjugate`, `Min`, `Max`, `Floor`, `Ceil`, `Round` (ties away from zero), `Truncate`, `Fract` (of an arithmetic operand or a call with no identity lowering), `Mod`, `Factorial`, `Factorial2`, `Arccot`, `Arcsch`, `Arccsc`, `Arcsec`, `Arcoth`, `Arsech` (complex where the type of the node is complex: `Arccsc(x)` with `x: real`), `Coth`. The library functions that the existing emitter writes as calls of real kernels, of real and integer operands: `Heaviside`, `GammaLn`, `Sinc`, `Erfi`, `ErfInv`, `Trigamma`, `FresnelS`, `FresnelC`, `SinIntegral`, `CosIntegral` of a non-negative operand (the existing kernel gives `Ci(|x|)` for a negative `x`, where the value is complex; CE-1225), `ExpIntegralEi`, `LogIntegral`, `DirichletEta`, `DirichletBeta`, `Zeta` (one or two operands), `StieltjesGamma` (one or two), `GammaRegularized` of a non-negative second operand, `Beta` of positive operands, `Binomial`, `Choose`, `ClausenCl`, `EllipticF`, `EllipticPi` and `EllipticE` of two operands, `BesselJ`, `BesselY`, `BesselI`, `BesselK`, `AGM` of non-negative operands, `PolyGamma`, `Chop`, `Remainder`, `GCD` and `LCM` (two operands or more), `KroneckerDelta`, `Clamp`, `Boole`, and `Real`, `Imaginary` and `Argument` of a real operand; `HurwitzZeta`, `PolyLog`, `LambertW`, `EllipticK`, `EllipticE` of one operand and `Gamma` of two operands (of a non-negative second operand), in the `complex` mode only where the existing compiler proves the value real (`complexContinuation()`: `HurwitzZeta(k, y)` with `k: integer`, `Gamma(s, p)` with `p: real<0..>`). An operand that names a parameter, a local or an index is not provably in the range of a kernel, and in the `complex` mode such an operand of a continuation head or of `Chop` declines: the engine answers its sign and its type from an engine symbol of the same name (`Function(CosIntegral(t), t)` with `t := 5`). `KroneckerDelta`, `GCD` and `LCM` of three operands or more decline when an operand after the second can throw (`GCD(x, y, Remainder(x, y))`): the existing compiler evaluates every operand before it compares or folds. A complex operand, in both modes: any for `Sin`, `Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Arctan`, `Arsinh`, `Arcsin`, `Arccos`, `Arccot`, `Arcsch`, `Arccsc`, `Arcsec`, `Arcoth`, `Arsech`, `Sign`, `Gamma`, `Ln`, `Sqrt` and `Conjugate` (`cos(arccos(a))` with `a: real`, `sin(t)/t` in the `complex` mode); one that does not read `Pi` for `Exp`, `Sinh`, `Cosh`, `Tanh`, `Coth`, `Sech` and `Csch` (`e^(i·x)`); a name for `Abs`, and for `Arcosh` and `Artanh` in the `strict` mode |
| Conditions | `If`, `If(c, v)` and `Which` with real or integer values (`NaN` when no condition holds and there is no `True` clause), `Less`, `LessEqual`, `Equal`, `NotEqual` (real and integer operands), also as a chain of three operands or more (`0 < x < 1`, `a = b = c`): the conjunction of its adjacent pairs, each operand evaluated once, a later operand only when the pairs before it hold, `And`, `Or`, `Not` |
| Sums and products | `Sum` and `Product` of a real or integer body over one or more `Limits(k, a, b)` clauses, with bounds that are number literals, captured numbers, or real or integer values of the program (floored, as the existing compiler does); with an iteration budget, a range over it gives `NaN` |
| Names | inputs of a numeric or boolean type, `list<real>`, `list<integer>`, unnamed `tuple<real, …>` and lists of such tuples (`list<tuple<real, real>>`) as inputs and parameters, in the `strict` mode also with `number` elements (`list<number>`, `vector<n>`, `vector`, `list<tuple<number, number, number, integer>>`, real there, as the existing compiler reads them: `_SYS.atNumeric(L, i, "number")`), captured numbers (a snapshot), captured lists of finite real numbers and lists of such lists (`L: list<integer> = [10, 20, 30]`, `rows := [[1, 2], [3]]`: one array of the doubles of the elements, or of the rows, made once when the compiled function is made (`preambleOnce`) and shared by every call and every helper; no update writes it or one of its rows, and a value of the program that can be that array, a row of it, or hold one as a row is a copy to that depth (`rows` is `_tv1?.map((_r) => _r?.slice())`), and a value of rank 3 or more declines (`[rows, rows]`, `[[CL]]`); the name is in `symbolDeps`), captured complex numbers with finite parts (`z0 := -0.524 - 0.566i`, written at each read as the object of its parts, as the existing compiler writes it, in both modes), a name whose value is an expression (`lv := x + 1`, `ls := [x, 2y]`, `sv := y`, a chain `b := 2a + sin(x)`: the value, rewritten for the angular unit, computed once per call, before the body, where its names are the inputs, as the existing compiler computes `const _val_lv = _.x + 1;`, and a value that is a name read at each read, as the existing compiler writes it (a value of a name declared `complex` that is not complex-valued declines: the existing compiler lifts it to the complex lane); the name and each name whose value it reads are in `symbolDeps`, and a new compilation reads a new value), the value of a name in the frame of the call that the interpreter is making (`d` in `f(d) := Sum(Map(x ↦ x + d, …))`), names with no declared type and names declared `number` (below); a parameter of the root `Function` that the body never reads, whatever its type (`(p: real, q: any) ↦ 2p`) |
| Nodes that read no input | a jump function of closed exact operands that the existing compiler folds (`closedExactJump()`, `tryConstantFold()`, also with `constantFold: false`): `Floor((25! − 1)/24!)`, `Sign(offset)`, `Less(a, b)` of two captured rationals; the profile writes the same literal. `Mod(a, 1)` of a dividend that is not integer-valued, as `_SYS.fract(a)` |
| Functions of the program | a `Function` literal with typed parameters, a body with locals (`Declare`, `let`, `let c: integer = …`), writes to locals, `If` statements, `Loop` over `Element(k, Range(a, b))` or over the elements of a list that a name holds (`for c in all`), `Break` at the end of a branch of an `If` in a loop; calls of user functions with a declared signature (a parameter of the `Function` literal with no annotation has the type of the signature) or with no declared signature (below), whose body is one value or a body of the same form (locals, writes, `If` statements, loops, `Break`). Each such function is compiled once, not inlined; a function that calls itself, directly or through others, declines. A `Block` with statements as the root of the compiled expression has the body of the same form, and its free symbols are the inputs (`{ a ⩴ x^2; a + 1 }`) |
| Blocks and locals | a block statement, whose locals are not visible after it; a block in a block (`Block(Block(…))`, the form of an Epsil program), and a block with statements as the value of a body; a block whose statements are declarations with a value, as an operand (`{ a ⩴ 3.7x; a − ⌊a⌋ } + 1`, the body of a `Sum`, a branch, a condition), written in the region of the operand, in order; a local declared `unknown` with a value (`m \coloneq x + 1`), which has the type of its value, as a `let`; in the `strict` mode a local declared `number`, which is a real local; a first write to a name that the block binds and no `Declare` declares (`s ⩴ x²` with `s` new), as in the interpreter and the existing compiler (`let s; s = …`) |
| Local functions | in the `strict` mode, a statement `Declare(g, 'function', (t) ↦ …)` (or `unknown`, or a `let`), `DefineFunction(g, …)` or a first write `g ≔ (t) ↦ …` of the body of the root: a function of the program compiled once, whose parameters are those of the literal, then the names of the body around it that the literal reads (an input, a parameter, a local declared before the definition), passed at each call with their values there, as a closure reads them (`a ⩴ 2x; g(t) \coloneq t + a; a ⩴ 10; g(3)` gives `13`) |
| Lists and tuples | A list literal of reals or integers (`[x, y, 1]`, `[]`) and a tuple of reals (`(x, y)`), as values of the program, of a local (also of a nested block, of a block of declarations as an operand, of `Declare(a, 'unknown', v)` and of a first write to an undeclared name), of a branch of an `If`, as parameters and results of a local function, and as results of the program and of a user function (a JavaScript array); `At` and `Length` of a list or a tuple; `Sum`, `Product`, `Max` and `Min` of one list or tuple (`Max` of an empty list is `NaN`); element-wise `Add`, `Subtract`, `Negate`, `Multiply` and `Divide` of a list and reals or integers (`L + 1`, `2·L`, `x/L`), and of two lists whose lengths are equal by construction (the same name, list literals of one length, `L + 2·L`); `Comprehension(body, Element(j, Range(a, b)))`, also with a pure guard (`[k for k in 1..64 if B[k] == p]`) whose bounds are integer literals or a `Length`; `ReplaceAt`. A list of tuples of one size: a literal (`[(1, 2), (x, 3)]`), a comprehension of tuples, `At`, `First` and `Last` (`_SYS.atPoint`, a tuple of `NaN` out of range), `Length`, `Count`, a local declared `list<tuple<…>>` (from `[]` too) |
| The `bigint` mode (`mode: 'bigint'`) | a program that the lane analysis of the mode accepts ("The `bigint` mode"), with `integer` inputs (each read once at the entry, a `number` converted): `Add`, `Subtract`, `Negate`, `Multiply`, `Power` with an exponent typed `integer<0..>` and `(−1)^k`, `Abs`, `Sign`, `Min`, `Max`, `Mod`, `Remainder`, `GCD`, `LCM`, `Factorial`, `Factorial2`, `Binomial`, `Fibonacci`, `IsPrime`, `Boole`, `If`, `Which`, `And`, `Or`, `Not`, the comparisons, also with a rational constant (`n < 7/2` is `2n < 7`); `Floor`, `Ceil`, `Round`, `Truncate` and an integer `Typed` of a quotient, a product with a rational factor, a power and (not `Typed`) a square root, rounded exactly; constants folded exactly from `evaluate()` (`2^70 + n`), and constant poles (`(−1)! + n`); `Sum` and `Product` with integer bounds (no pass when the upper bound is less than the lower one); the calls of a user function that is not recursive and reads no input; `list<integer>` inputs, `List`, `Range` (also with a step), `At`, `First`, `Last`, `Length`, `Count`, `Take`, `Drop` and `ReplaceAt`, and a list result; a `Function` literal at the root, whose parameters are its inputs. The `bigint`, `boolean`, each element of a list, and the error of the existing compiler with `cse: false, constantFold: false`; a pole is a `number` (`NaN`, `Infinity`), also an index of `At` out of range |
| Random draws | `Random()`, `Random(Interval(a, b))` with number literals `a < b`, `Random(Range(…))` of number literals with an integer first element and step; `WithRandomSeed(seed, body)` with a scalar body and a real seed, a complex seed in the `complex` mode, or a number or string literal; calls of functions whose body draws, or whose signature states `random`. The same draws as the existing compiler, in the same order, the same number of times, on the same paths: a compiled function called inside an interpreted `WithRandomSeed` draws from that frame |
| Functions of lists and function operands | `Norm` (no order), `Mean`, `Median`, `Variance` of a list or a tuple; `Dot` of two lists or two tuples of one length (two lists of different lengths give `NaN`, as `_SYS.matmul` does); `Take`, `Drop` with an integer or a real count (`.slice`; a negative count from the end; a real count rounded with `Math.round`), `Rest`, `Reverse`, `Sort`, `Join` of lists; `First`, `Last` (`NaN` for an empty list), `Count` of a list or a tuple; `Range(n)`, `Range(a, b)` with integer bounds and `Range(a, b, s)` with real or integer operands as a value (`Range(1, 0)` is `[1, 0]`; `_SYS.range`, which throws for more than 2^32 − 1 elements); `RotateLeft`, `RotateRight` of a list (`_SYS.rotl`, `_SYS.rotr`), also as operands of an element-wise sum (`life`); `Take`, `Drop`, `Rest`, `Reverse`, `Join`, `ListJoin`, a rotation, `Map` with a function literal, `Filter` and `Count` with a predicate literal of a list of tuples (a new outer array that holds the tuples of its operand; `Map` can make tuples); `Map(f, L)` and `Map(f, P)` with a function literal of one parameter, or (`strict` mode) the operators `Sin`, `Cos`, `Tan`, `Sec`, `Cot`, `Arctan`, `Arcsin`, `Exp`, `Ln`, `Abs`, `Tanh`, `Sinh`, `Cosh`, `Arsinh`, `Sign`, `Erf`, `Erfc`, `Gamma`, `Factorial`, `Factorial2`, `Truncate`, `Coth`, `Arccot`, `Arcsch`, `Sqrt`, `Negate`, and `Floor` in both modes; `Filter(L, p)` and `Count(L, p)` with a predicate literal; `Reduce(L, op)` and `Scan(L, op)` with `Add`, `Multiply`, `Max` or `Min`, with or without an initial value, and with a function literal of two parameters (`Reduce` with an initial value); `Apply` of a function literal to numbers (`strict` mode); in the `strict` mode a user function in place of each function literal (`Map(f, L)`, `Reduce(L, g, 0)`, one call of the helper per element). A function operand is written inline, once per element in index order, as the existing compiler calls it; its body is pure. The functions of flat lists of numbers: `PopulationVariance`, `StandardDeviation`, `PopulationStandardDeviation`, `Skewness`, `Kurtosis`, `Mode`, `InterquartileRange` of a list or a tuple, `Covariance` and `Correlation` of two lists (the runtime helpers); `Ordering`, `Unique`, `IndexOf`, `Contains` (`-0` is `0`, a `NaN` matches a `NaN`), `Second`, `Third`, `Most`, `IsEmpty`, `Append(L, x)`; `Repeat(x, n)` with an integer count, `Linspace(a, b, n)` and `Linspace(a, b)` with finite literal bounds, `Slice(L, a, b)`; `At(L, x)` with a real index (`NaN` for a fraction) and `At(L, I)` with a list or a `Range` of indexes (a gather, `NaN` at an index out of range); `CountIf`, `Any`, `All` (stopping at the first element that decides, as `some` and `every`), `Find` (`NaN` for none), `IndexWhere`, `Position`, `TakeWhile`, `DropWhile` with a predicate literal or a user function, and `Tabulate(f, n)` of one dimension with an integer count |
| Lists of lists | in the `strict` mode, inputs, parameters, locals and helper results of the types `list<list<real>>`, `list<list<integer>>`, `matrix`, `matrix<m×n>` (`number` cells read as reals), `list<list<tuple<real, real>>>` and rank 3 (a JavaScript array of arrays); literals of rows, ragged too (`[[x, 1], [2]]`); a row read `At(M, i)` (`undefined` out of range, as the existing compiler reads it) as the base of an `At`, the operand of `Length` (`NaN` for an absent row), an element of a list literal, the body of a comprehension, the row of a `ReplaceAt` (a swap of two rows), a branch of an `If` and the value of the program; `At(M, i, j)` and a chained `At` (`NaN` for an absent row); `Length` of each level; `First`, `Last`, `Count`, `Rest`, `Take`, `Drop`, `Reverse`, `RotateLeft`, `RotateRight`, `Join`, `ListJoin` of rows (a new outer array that holds the rows); comprehensions of rows; `ReplaceAt` of a row and of an element of a row (`ReplaceAt(M, i, j, x)`: row `i` copied); helpers that take and return lists of lists; element-wise `Add`, `Multiply` by a number, `Negate` and `Divide` of lists of lists with real operands, and of two lists of lists whose lengths are equal at every depth by construction (one name, an element-wise result, stated dimensions: `matrix<2x2> + matrix<2x2>`); `Sum` and `Product` of the rows of a matrix of one row or more by its type; `Map` of a function literal over the rows, with a number or a row as its value; the matrix functions `Determinant`, `Trace`, `Inverse`, `MatrixPower` (an integer exponent), `MatrixMultiply`, `Dot` of a matrix, `Transpose` and `Diagonal` of a matrix by its type, `RowReduce`, `Flatten`, `Norm` of any rank and with a numeric order, each the runtime helper of the existing compiler (`_SYS.det`, `_SYS.inv`, `_SYS.matpow`, `_SYS.matmul`, …); the product `A·B` of two matrices, of a matrix and a list, of a list and a matrix whose types state their ranks (`_SYS.mul`). A matrix result that can have no value (a singular `Inverse`, a `MatrixPower` with an exponent that can be negative, a product whose dimensions the types do not prove to agree: `NaN` in place of the matrix, as on the existing compiler) is admitted as the value of the program, as the operand of a matrix function and as the list of `At` only. Inputs are never written at any depth; a result can share rows with an input, and is read-only |
| Integrals and derivatives with a closed form | in the `strict` mode, `Integrate` with one or more `Limits` clauses (constant bounds, input bounds, bounds that are expressions, nested integrals, an integral in a `Sum`, an `If`, a list or the body of a helper) and an indefinite `Integrate`, `D` of one or more variables, `ND` at a number, and `Apply(Derivative(f, n…), x…)` of a library function, a user function or a function literal, when the engine finds a closed form at compile time: the node is the closed form that the existing compiler writes in its place (`closedFormIntegral()`, `derivativeClosedForm()`), found once per node at the admission. Each name whose stored definition the closed form can hold (a value, a user function, at any depth) is in `symbolDeps` |
| Integrals with no closed form | in the `strict` mode, a definite `Integrate` over one or more `Limits(t, a, b)` clauses with no closed form: the call `_SYS.integrate` of the existing compiler, the integrand a function of its variable, one call per clause, nested, the first clause outermost (`∫₀ᵃ √(1 + t⁴) dt`, `∫₀¹∫₀ᵘ sin(u v³) dv du`), with the same starting panel count; bounds that are numbers, `±∞`, inputs or expressions (a bound of a later clause can read the variables before it); an integrand that reads inputs, captured numbers, the locals of a block, a loop index, the parameter of a function literal, or calls a user function; an integral in a branch, a `Loop`, `Map`, `Apply`, a nested integral, the body of a user function. The integrand is evaluated at the same points, in the same order, as on the existing compiler, and the result is not `pure` (the runtime keeps the count of the integrals in progress and an evaluation budget between calls, and samples the entropy source of the engine when an outermost integral does not converge) and not `shippable`. An integrand that the existing compiler computes again in log space where its value is not finite (`∫₀ᵃ t^{b+3} e^{-t} dt`, `logSpaceProduct()`) has the same second function and `_SYS.finiteOr`; with the option `quadrature: 'monte-carlo'`, each clause is `_SYS.integrateMC`, which draws its 10⁷ points from the same entropy source as the existing code |
| Derivatives and limits computed numerically | in the `strict` mode, a derivative with no closed form that the engine finds at compile time: `D(body, v)` of one symbol, `ND(f, x)` and `Apply(Derivative(f, n), x)` of a function literal of one parameter or of a user function whose definition is one, whose result type is a number: the stencil `_SYS.nd(f, n, 'scalar')(x)` of the existing compiler (`D(ζ(x), x)`, `ND(t ↦ ζ(t)·t, x)`); `Limit(f, x)` and `Limit(f, x, d)` of a function literal of one parameter at a point of the type `real` or `integer`, a finite literal, or `±∞` from the side of its sign: `_SYS.limit(f, x[, d])`, the call that the existing compiler writes with `constantFold: false` (no symbolic attempt: a constant limit that the default options fold, `lim_{t→0} sin t / t`, gives the double of the extrapolation, `1.0000000000000002`). The variable can have the name of a name around it (`D(ζ(x), x)` in a block that reads `x`). The body is evaluated at the same points, in the same order, as on the existing compiler, at each occurrence; the result is `pure` and keeps the `shippable` answer of the existing compiler. A derivative in a `Sum` or a `Product` is admitted (`_SYS.nd` does not throw), a limit there declines (row of sums below) |

| Declined with `outside-profile` | Example |
| --- | --- |
| A head outside the list | `BetaRegularized(x, a, b)`, `LerchPhi`, `Hypergeometric1F1` and `EllipticPi` of three operands (the representation has functions of one and two operands only), `Pipe`, `EvaluateAt`, `Cross`, `LogGamma(x)`, `NIntegrate`, `RandomChoice(L, 2)` (`operator: 'RandomChoice'`), `RandomSample`, `RandomShuffle` |
| A calculus node with no closed form, or outside the form | a derivative with no closed form of a function whose value is a point or a list, or whose result type says nothing (the existing compiler writes the vector stencil, or probes the function once); a derivative with no closed form of several variables, of a multi-index `Derivative`, of a local function, or of a function literal whose parameter is not a plain name; a limit of a function that is not a literal (`Limit(g, a)`), whose body draws or reads the host, at an infinity whose sign is not the sign of the direction (1 when there is none: `_SYS.limit` computes the limit at the infinity of the sign of the direction, `Limit(arctan, -∞)` is π/2 there and -π/2 on the interpreter), or at a point whose type admits an infinity (`a: real | signed_infinity`, `w: number`, `1/a`); an indefinite integral with no closed form; an integral with no closed form whose bound reads the variable of its own clause or of a later one (`∫₀ˣ √(1 + x⁴) dx`), or whose integrand reads or calls the host, holds a `Loop` or a `WithRandomSeed` or calls a user function that does; a `Sum` or a `Product` whose terms hold such an integral (the row of sums below); an integral whose integrand draws; a derivative that is a function (`Derivative(Sin)`); an applied derivative that the existing compiler computes with Taylor jets; a variable that can hold a list (`Integrate(g², g)` with `g: list<real>`, which the existing compiler declines too); a variable of `D` that holds a value; a complex number in the node or its closed form (`(∫ᵢ⁰ t dt)²`: the existing compiler reads the node on the complex lane); a closed form `0` as an operand (the existing compiler writes the term `(0)`); any calculus node in the `complex` mode; a program whose closed-form searches spend more than 10,000 steps |
| A draw outside the form | a draw in the body of a `Comprehension` (the interpreter's comprehension draws when an element is read), `Random` of a domain with a symbol or of a list (`Random(Range(1, n))`), a `WithRandomSeed` with a boolean seed, a seed that is a string expression or a list body, a statement that is only a draw, a binding whose value draws (`r := Random()`), a function value that draws (`Map`); two or more draws when one is in a complex value (`Random() + Sqrt(Random(Range(-2, 8, 2)))` in the `complex` mode: the existing emitter evaluates the complex operand first); a `WithRandomSeed` with a real body whose type the existing compiler reads as complex in the `strict` mode (`WithRandomSeed(3, ln(x))`), or whose type is neither real nor wide in the `complex` mode (`integer \| missing`, `infinity \| nan \| real`) |
| A form the existing emitter writes in a special way | `x^0.5`, `x^(8/5)`, `Mod(k, 1)` of an integer dividend (`%`, which is `-0` at `-0`), a `Which` with a condition of the type `false` before a condition that is not constant (`Which(3 < 2, x, x < 1, y, True, 0)`, which it writes with the first clause dropped; an `If` or a `Which` whose constant conditions select a branch is that branch at the root of the program or of a function body, `If(2 < 3, x, Sqrt(y))` is `x`, and as an operand only when the branch is a symbol with no value), such a selection as an operand of another branch (`z + Which(2 < 3, 0, True, 1)`, `2 / Which(2 < 3, hav(t), True, 0)`: it writes the selection as a computed operand in parentheses, where the route would write the branch in the parent), an `If` of three operands whose condition has a constant type and whose selected branch is not a symbol or a number (`2 · If(2 < 3, x + 1, 0)`, which it writes `2 * _.x + 1`, with no parentheses around the branch; CE-1224), such a selection whose selected branch is a complex constant (`x + Which(2 < 3, i, True, 0)`, which it reads as a computed complex value: `{re: 0, im: 1}` at `x = -0`), such a selection whose node has a type that is not a number type (a dead branch `u` with no declared type: the existing compiler writes the parent from that type, `2/3 · (x + Which(1.5 ≤ 1, u, True, 0.5))` as a broadcast), in the `complex` mode a continuation head whose value can be complex (`HurwitzZeta(x, y)`, `Gamma(x, y)`, `LambertW(x)`: the complex kernel of lifted operands) and a `Chop` of the type `number` (`Chop(7 · (1/x))`, which it reads as a complex value), in an angular unit other than radians a `Product` of a list literal with an element that is an inverse trigonometric function (`Product([p, Arcsec(-1)])`, which it writes `_.p * 57.29577951308232 * Math.acos(…)`, a product in another order), `Sinh(i·π·x)`, `e^(x + i·π·y)`, `\|x + i\|`, a closed comparison, a power or a root of two literals that it folds to `NaN` where the interpreter has a finite value (`Root(-2, -4)`), the literal `-(0^-1)` (an undirected infinity that it writes `Infinity`), an ordering with a closed operand whose value is the undirected infinity (`x ≤ 1/0`, `x ≤ cot(π)`, which it writes `false`), a `Haversine` where it writes the haversine in its parent with no parentheses (`2 / hav(x)`, `h · (hav(1)/x)`, a product of haversines, a local whose value is a haversine, a haversine as the value of an operand block, `0.5·hav(r)` with `r` a read of the host), `Sech` and `Csch` of a real operand (`1 / Math.cosh(x)`, which a parent groups as written: `2 / sech(x)` is `2 / 1 / Math.cosh(x)`), `Fract` of an operand whose code can be a name or digits (`2 * b - Math.floor(b)` for `2·Fract(b)` and for `2·Fract(Abs(p))` with `p: real<0..>`), an `At` of a list whose element type is not real (`x · At(Comprehension(√y, …), 2)`, which it reads as a complex value), and in the `complex` mode a real call or square that it wraps as a complex value (`x·sin(a/y)`, `ln(a^2)^2` with `a`, `y` real), a read of a scalar `let` local whose type is not real (`let t = 1/b; t`), except as a bound or an index, and a real value of a local declared `complex` (`Declare(t, 'complex', x)`, which it holds as a number and reads as `{re: 4, im: 0}` after a write and `NaN` with none) |
| A value of a local of another kind than its declared type | `let t: real = 1 + 2i`, `let t: real = sqrt(x)` in the `strict` mode (`x: real`), `Declare(R, "list<real>", 3)`; an integer value of a `real` local and a list of integers of a `list<real>` local are admitted |
| A complex form with no compilation of the engine that needs it | `Real(z)`, `Imaginary(z)`, `Argument(z)`, `KroneckerDelta(z)`, a complex operand of a real kernel (`GammaRegularized(z, y)`), `Equal(z, w)`; a complex power whose exponent has no unknown (`z^π`, which the existing emitter can read as a constant) |
| A list or a tuple outside the form | a list literal of lists and other values (`[[x], y]`, `operator: 'List'`), a list literal of tuples of two sizes, `ReplaceAt` of a list of tuples, in the `complex` mode `At` and `ListJoin` of a list of tuples and a quotient by a list whose engine element type is not real (`1.5 / [cn for j in 3..2]` with `cn: number`, which the existing compiler divides on the complex lane), a list or a tuple of booleans or of complex numbers, element-wise arithmetic on a tuple (`P + (1, 2)`) or with a complex operand, two lists whose lengths are not equal by construction (`L + M` of two inputs: the existing compiler gives `NaN` for different lengths), `Power`, a function or `Max` of a list with other operands (`L^2`, `sin(L)`, `Max(L, x)`), a guard of a `Comprehension` that is not pure (`Random()`) or a bound of a guarded `Comprehension` that is an input, a captured value that is not pure (`r := 2 + Random()`, which the existing compiler draws at each read), that reads a name or a function of the host (a `vars` entry; a list value in a compilation with `functions`), that reads a name that a form binds where it is read (`Sum(lv·x, x, 1, 3)` with `lv := x + 1`: the existing compiler reads the `x` of the engine there, and refuses a parameter of the root `Function`), that a helper or a local function reads, whose operations can throw or abort (`mv := Mod(k, y)`: the place where it is computed is then seen), that reads its own name (`c1 := c2 + 1`, `c2 := c1 + 1`), and a real value of a name declared `complex` (the existing compiler reads `_SYS.cplx(5)`), in the `complex` mode `list<number>` and `vector<n>`, a list local read by a local function (it would be an extra parameter), and in the `complex` mode a tuple local; a fold of an operand other than a name whose type is not real (`Sum(I/2.5)` with `I: list<real>`; in the `strict` mode only when the operand has a node whose type is a number that is not real, or that makes a type that is not real from real operands: `Sum(L·√x)` with `x: real`, which the existing compiler folds on the complex lane, while `Sum(L + 1)` with `L: list<number>` and `Max((2, x))` are admitted), an argument of a user function whose parameter is declared a list of a stated width and whose type does not state that width (`f(L)` with `f: (list<real^3>) -> real` and `L: list<real>`: the existing compiler reads the width), and in the `complex` mode a `Sum` or a `Product` of a local or of a type with `NaN` or an infinity (the existing compiler wraps these in `_SYS.cplx`); `Sum` of a list literal with a sum as an element (`Sum([2, x - 0.1])`) and `Product` of one with a product as an element, which the existing emitter writes as one chain, and in the body of a helper an `At` of an element-wise sum or product of a list literal (`([1, 2] + (x - 0.1))[2]`, which the existing compiler writes there as one sum in an order of its own); in the `complex` mode element-wise arithmetic with a name of no declared type (in the `strict` mode such a name is a real scalar, and `L·u` is admitted); an operation other than a comparison or a connective with an operand whose type admits a list and a number (`10·(2/f(L))` and `exp(f(L) + 2)` with `f: (list<real>) -> real`, whose call has the type `list<any> \| real`) or an expression of the type `any` (`g·(-f(L)/x)`), except a sum or a negation of real operands in the `strict` mode |
| A list of lists outside the form | `tensor` and a union of ranks (`list<matrix<2x2> \| vector<2>>`), complex cells, the `complex` and `bigint` modes; `M·M` and `M^2` of a `list<list<real>>` or a `tensor` (the existing compiler chooses the product by the value: declare `matrix`), a product of more than two factors (`x·A·B`); two lists of lists whose lengths are not equal by construction (`A + B` of two `matrix` inputs) or of different ranks (`M + v`); `Sum` and `Product` of rows that can have different lengths or no row (`Sum(M)` of a `list<list<real>>`); `Map` of an operator over rows, `Filter`, `Reduce`, `Scan`, `Sort`, `Max`, `Min` of rows; `Trace` of a `list<list<real>>` (the type `number \| tensor`), `Transpose` and `Diagonal` of rows of different lengths, a matrix function of a value whose type is not a list (`Determinant(MatrixMultiply(A, B))`: the existing compiler declines it), `MatrixPower` with an exponent that is not an integer by its type, `Norm` with a named order, `Flatten([])` (of the type `list`), `IdentityMatrix`, `Shape`, `Rank`, `Reshape`; a `Sum` or a `Product` with an index whose term computes `Inverse` or `MatrixPower` other than with the same operands in every term (`Sum(Det(A^k), k)`: `_SYS.matpow` throws for a matrix that is not square, where the existing compiler stops at its first `NaN` term); a matrix product of an element-wise sum whose shape its type does not state (`A·B + A` of `matrix<2x3>` and `matrix<3x2>`); a matrix of a stated count of no row as a fold of rows (`Sum(A)`, `A: matrix<0x3>`); element-wise arithmetic, `Sum`, `Product`, `Map` and the matrix functions of a list of lists in a program that places a row read in a list (`Map(r ↦ -r, ReplaceAt(M, -1, At(M, k)))`: the existing compiler gives `NaN` for an absent row; `RowReduce([[1, 0], At(M, i)])`: `_SYS.rref` throws for it); a matrix that can have no value used elsewhere than as the value of the program, an operand of a matrix function or the list of `At` (`Length(Inverse(A))`, `Inverse(A) + 1`, an argument, a local, the value of a helper); a row read as a local, an argument, the value of a helper or the operand of any other head (`Sum(At(M, i))`); `Length` of an `If` of row reads; `ReplaceAt` with more than two indexes or of a list whose type does not settle a list at each level; an element of rows whose engine type is `missing` (`At([[]], k, -1)`); in the `complex` mode, a captured list of lists |
| A function of lists or a function operand outside the form | `Norm(L, "Frobenius")` (a named order), `Take` of a tuple, `Repeat(x, y)` with a real count (the existing code throws for a fraction), `Linspace` with a bound that is not a finite number literal (the existing code gives the number `NaN`, not a list), `Tabulate` of two dimensions or of a real count, `Ordering(L, f)`, `Find` of a list of tuples, `Contains`, `IndexOf` and `Unique` of a list of tuples or of lists, `Element(x, L)`, `Quartiles`, `DeleteAt`, `Insert`, `Partition`, `Chunk`, `Zip`, `ListFrom`, a predicate that is an operator, `At` of a list of tuples or of lists with a real or a list index, `Range(1, n, 0)` (a literal step 0) and `Range(a, b)` with a real bound, `RotateLeft(L, x)` with a real shift, `Sort` of a list of tuples, `Dot(L, P)`, `Sort(L, f)`, `Map` over two lists, `Map(f, L)` with a user function `f` that has no function literal as its value, a local function (`Map(lg, L)`: the engine types its call `unknown`), a user function whose name a `vars`, `functions` or `operators` entry maps, a parameter annotation that the element type does not prove (`(p: tuple<integer, integer>) ↦ …` over `list<tuple<real, real>>`, a user function or a function literal), or in the `complex` mode, `Map(Ceil, L)`, `Map(Fract, L)` and the other operators outside the list, a function literal and `Apply` in the `complex` mode, a mapped operator other than `Floor` in the `complex` mode, a trigonometric operator when the angular unit is not radians, a function whose value is a boolean or a list (`Map((t) ↦ t < 1, L)`), `Reduce` with a function literal and no initial value (the existing compiler declines it), `Reduce` by `Subtract`, `Reduce` of a tuple, a function of the elements of the empty list literal (`Map(Sin, [])`), a value whose elements are numbers that are not real (`Map(Ln, L)`, of the type `list<complex | signed_infinity>`: the existing compiler reads it on the complex lane), a function body that is not pure, draws, reads or calls the host or holds a `Loop` or a `WithRandomSeed` (`Map((t) ↦ t + Random(), L)`: the interpreter's `Map`, `Filter` and `Scan` compute an element when it is read), a library operator as the function that a `vars` entry maps (`Map(Sin, L)` with `vars: { Sin: … }`: the existing compiler calls the source) |
| A sum, a product or a `Which` outside the form | `Sum(x)` of a number, a bound `+∞`, a bound that does not floor to a safe integer, a complex body, `Which` with the value `Nothing`; a `Sum` or a `Product` whose term can throw, integrates numerically or computes a limit, also through a user function or a function that `Map` or `Reduce` calls (`Sum(Mod(1, j/k), Limits(j, 0, n))`: the existing compiler stops at the first term that is `NaN`, at `k = 0` the first, and gives `NaN`; the later terms, which throw or sample an integrand, are not evaluated). A `Mod` throws only for an operand beyond ±(2^53 − 1), and one whose operands are each an index of the aggregate, an integer literal, or (where every term evaluates it) the same value in every term is admitted (`Sum(Mod(k, 3))`, `Sum(Mod(k, m))` with an input `m`); a `Mod` of another operand in a term declines, also where it cannot exceed the range (`Sum(Mod(k·y, 3))`, which the existing compiler gives the same value; a call of a user function whose body has a `Mod`). A `Sum` or a `Product` of fewer than 4 written-out terms (constant bounds) is not refused: the existing compiler writes it as one chain and evaluates every term |
| A name declared with a type that is not numeric | `x + u` with `u` declared `any` (`binding: 'u'`), a parameter of the type `tuple<x: real, y: real>` (`binding` is its name) |
| An input of a union of shapes | `u + 1` with `u: list<real> \| real`, `2v` with `v: integer \| vector<integer^2>`: the existing compiler compiles one body per member, with one test of the shape at the binding (R4: `(Array.isArray(_.u) ? _SYS.bcast(…) : _.u + 1)`); the profile has no such dispatch. Declare one member, or compile one function per member |
| A comparison chain outside the form | a chain with a list or a tuple operand (an element-wise comparison); an ordering chain whose first operand draws or calls the host and that calls a helper (a local function is caller code of the existing compiler); an equality chain whose middle operand reads or calls the host or calls a helper (the existing emitter evaluates it once per pair) |
| A statement outside the list | `ParallelLoop` and `ParallelComprehension` (the existing compiler installs the frames of the passes, which consume an index of an enclosing seeded frame, and records the loop for the worker pool), `Continue` in a `Loop` (`operator: 'Continue'`), a `Break` that is not the last statement of a branch of an `If`, a `Loop` over a list that is not a name (`Element(c, Take(L, 2))`), a write to a name of the engine or an input, a `Block` with a statement other than a declaration with a value as an operand (`{ a ⩴ 0; a ≔ x; 2a } + 1`, which the existing compiler declines too), a block operand of a type that is not numeric or boolean, an empty `Block` |
| A local or a local function outside the form | a product, a quotient or a power with an operand that is an arithmetic expression of a call of a local function (`x · (-1/3) / lf(1)`: the existing compiler reads the call, of the type `unknown`, as a possible list and writes the operand as one value with `_SYS.bcast`); in the `strict` mode a call of a local function whose value is complex (the existing compiler reads it as a real number: `tanh(lf(0.3))` is `NaN`); a local of a nested block with the name of a parameter, an input or an outer local (no shadowing), a first write that reads the name, in the `strict` mode a `let` local written a real and a complex value (as the existing compiler declines it); a local function in a branch, a loop, a nested block statement, an operand or the body of a user function, one that calls itself, is defined twice, is declared with a signature, has the name of an operator of the library (`Declare(sin, 'function', …)`), whose parameter has the name of a local, or that is used as a value (`Map(L, g)`, also in the body of another local function); a local function in the `complex` mode (the existing compiler reads the value of its calls as a complex value); one that reads a read of the host (`vars: { T: 'next()' }`: the existing closure reads it where its body does), or an input while the options have a read of the host or a host function that is not declared pure (which can change the inputs object between the call and the read); in another angular unit than radians, a `let` local or a local function with its value in a dictionary (`Declare(a, {value: sin(x)})`, `Declare(g, {value: (t) ↦ sin(t)})`, which the rewrite for the angular unit does not reach, CE-1207), and in the `complex` mode a first write that declares a local (`t ≔ x; arctan(t)`: the existing compiler reads the local of the rebuilt block as a complex value, and gives `NaN`) |
| An option outside the profile | the function form of `operators`; in the `bigint` mode, `vars`, `functions`, `operators`, `preamble` and `imports` |
| A program of the `bigint` mode outside the form | a decline of the lane analysis of the mode (`n/2`, `n + x` with `x: real`), with its reason; `Map`, `Reduce` and `Fold` (a function operand), a recursive user function, a user function that reads an input, a nested list (the existing compiler compiles them); a constant that the interpreter leaves unevaluated (`Fibonacci(10^9)`) |
| An entry of an option of the host outside the form (below) | a `functions` or `operators` entry for an operator of the library (`functions: { Sin: … }`), an `operators` entry that is an infix operator (`['+', 11]`), a `vars` source that is not one operand (`'Math.PI / 4'`), a `vars` entry for a constant of the library (`Pi`) or for a name with a value and no declared type, a mapped name that the body of the root `Function` or of a user function reads, a read or a call of the host in the `complex` mode, a function of the host whose result type is not real, integer or `number` |
| A program of more than 100,000 operations | a subexpression in both branches of an `If`, nested 14 times: the profile writes it once per branch (no `operator`) |

**The `bigint` mode under the profile.** The admission is the lane analysis
of the mode ("The `bigint` mode"), and the program is lowered with a second
policy of the JavaScript target, in which an integer is a `bigint` and a
real number has no representation: the verifier refuses a real value. A
pole aborts the program: the code catches the `NonFiniteValue` that the
helper throws, as the existing compiler does, and the call gives `NaN` or
`Infinity`; the size limit of 10^6 digits and an `exact` quotient with a
remainder (`Typed(n/2, integer)` at odd `n`) throw a `RangeError`. When
two operations can abort, the first in the order of the existing compiler
decides the result. A node object reached twice is computed once where the
first occurrence dominates the second, also when it can abort, but not
across the body of a loop or of a function. A `Sum` or a `Product` is a
loop with a `bigint` counter, with no iteration budget, as in the existing
compiler; a user function is one function of the code, with no catch of its
own; a list of integers is an array of `bigint` values, which the call does
not change (`ReplaceAt` copies). The result
reports `mode: 'bigint'`, `pure: true` and `shippable: true`, and
`broadcast()` throws as for the existing compiler. The design is
`docs/plans/2026-11-11-structured-bigint-mode.md`.

**A name with no declared type.** Under the profile, a parameter of a
`Function` literal or a free symbol with no declared type is a real number
in the `strict` mode and a complex number in the `complex` mode (the
compiled code then accepts a number or a complex value for it). Boxing
writes no type on a definition of the host's scopes, so a type there comes
from a call of the host: `ce.infer()`, `ce.assume()` or `ce.assign()`
(an evaluated assignment too). Such a type is read as a declared type is,
with the same kinds: after `ce.infer([ce.box(['Mod', 'x', 2])])`, `x` is
real in both modes and is not in `defaultedSymbols`, and after
`ce.assume(ce.parse('x > 0'))` it has the type `real<0<..>`; after
`ce.infer([ce.parse('x + 1')])` it is `number`. So a host declares each
name, or calls
`ce.infer()` before `compile()`. A type that boxing writes on a parameter
of a `Function` literal or on a local of the program is not read, so the
kind of a name never depends on what was boxed before.
The host supplies a scalar number for a name with no declared type; a
value of another shape is outside its type. The result,
and the positive answer of `canCompile()`, list these names in
`defaultedSymbols`: with `u` undeclared, `x + u` compiles and `u` is an
input. A symbol with a value and no declared type (`ce.assign('a', 3)`) is
captured as a number copied at compile time, with the kind of its value. A
name declared `number` (an input, a parameter of a `Function` literal or of
a user function) has the same kind as a name with no declared type, as on
the existing compiler: real in the `strict` mode, complex in the `complex`
mode, where an input or a parameter of the root accepts a number or a
complex value; a name declared a union of a real type with `nan` or
`signed_infinity` (`nan | real | signed_infinity`) is real in both modes.
Such a name has a declared type, so `defaultedSymbols` does not list it. A
user function declared with the result `number` returns the kind of its
body, as on the existing compiler (`(real) -> number` with the body `t + 1`
returns a number in the `complex` mode). In the `complex` mode a parameter
of a user function declared `number` is complex, and a real argument
declines (the existing compiler converts it in the body). A parameter of
the `Function` literal of a user function with a declared signature that
has no annotation has the type of the signature when that type is a base
kind (`real`, `integer`, `number`, `complex`, `boolean`), a list or a tuple
of the profile (`list<real>`, `list<number>`, `vector<2>`,
`tuple<number, number>`), as on the
existing compiler, which writes the same function with and without the
annotation (`g: (real) -> real`, `g := t ↦ 2t`); a parameter whose
signature type is `unknown` (`f: (unknown) -> number`, `f := t ↦ t² + 1`)
has the default kind of the mode, with the rule of a signature that the
engine inferred (below); another signature type (`broadcastable<real>`,
`collection`, `string`) declines with its name; a signature type with a
range or a literal (`(real<0..>) -> real`) declines, because the existing
compiler reads the range in the body (`Abs(t)` is `t`) and asks for an
annotation. A name declared
`number` with a real number value is captured as a number, with the kind of
its value. A name declared with a type that the profile has no kind for
(`any`, `finite_number`) declines. A local declared `number` is real in
the `strict` mode and declines in the `complex` mode, where the existing
compiler reads each read of it as `_SYS.cplx(a)`. The same rule applies to a call of a user function whose
signature the engine inferred (`f(x) := x^2 + 1`, or a literal with an
annotation on some parameters only): each parameter with no annotation
has the default kind, the result has the kind of the body, an argument of
another kind declines (a list, a boolean, a real argument in the `complex`
mode), and `defaultedSymbols` lists the name of the function. A function
declared `function` (`ce.declare('f', 'function')`, then a `Function`
literal as its value) has the same rule in the `strict` mode, with the
annotation of a parameter of the literal as its type, and declines in the
`complex` mode, where the existing compiler reads each parameter and the
value as complex values. A function with an optional or a variadic
parameter, a type parameter or an effect other than `random` declines.
Four limits:

- A body that uses the name as a list, as a condition or as an integer (a
  loop bound, an index) declines: declare the name.
- Some rules read the type of a node, which the engine computes from the
  type that the uses of the name in the expression require. Another use can
  then make a program decline (`Exp(Sqrt(x)) + Mod(x, 2)`, where
  `Exp(Sqrt(x))` alone compiles); it never changes the code of a program
  that compiles.
- An assumption does not change the kind: with `n` assumed an integer and
  not declared, `Floor(n)` is `Math.floor(_.n)`, the interpreter's value for
  every real `n`. The existing compiler reads the assumption and writes
  `_.n`.
- In the `complex` mode, the existing compiler reads such a name by the
  type that the engine inferred from its uses, also from a use that the
  canonical form drops: `(0·3·Mod(1, u) + x)/u` is `x/u`, which the
  existing compiler writes `_.x / _.u` (the type of `u` is real, from
  `Mod`) and the profile as the complex quotient of `_SYS.cplx(_.u)`. The
  value is the same; its shape is `{re, im}` on the profile.

**The options of the host.** Under the profile, `vars`, `functions`,
`operators`, `imports`, `preamble` and `broadcast` give the code of the
existing compiler with `cse: false` and `constantFold: false`, and the host
calls and reads in the same number and order:

- A `vars` entry whose source reads an entry of the vars object (`_.w`,
  `_["w"]`) makes the name an input that the code reads at that source. The
  name has its declared type, also when it has a value (the compilation
  hides the value, as on the existing compiler), or the default kind, and
  `defaultedSymbols` then lists it. `varsObjectRefs` records the source
  only when it is the spelling of the name itself (`u: '_.u'`), as on the
  existing compiler, and only such an input gets the entry check of its
  type.
- A `vars` entry with another source that is one operand (a name, a
  number, a call, a member access or an expression in parentheses:
  `next()`, `state.t`) is a read of the host: an operation whose effect is
  `unknown`. Each occurrence of the name reads the source once, in the order
  of the program, and is bound to a `const`; the result is not `pure` and not
  `shippable`. The name has its declared real, integer or `number` type, or
  the default kind. `Power(u, -2)` of a mapped name is `Math.pow(u, -2)`,
  as the existing emitter writes it for such a name.
- A `functions` entry (a string, a function value, or `{ source, pure }`)
  for a head that is not an operator of the library, and an `operators`
  entry `[name, precedence]` whose operator is a name, make each call of the
  head a call of the host: one operation whose effect is `pure` when the
  entry declares it pure (`entryIsPure()`, as for the existing compiler) and
  `unknown` otherwise. Its operands are evaluated first, in order; each call
  is evaluated once, also a pure one that occurs twice, and is bound to a
  `const`. A pure call keeps the result `pure`, and a result with a call of
  the host is never `shippable`: a worker does not have the function. The
  signature of the head gives the types: its result must be real, integer
  or `number`. A function value goes in the preamble, as on the existing
  route. The existing emitter evaluates the source of the callee before
  the arguments, and the profile after them, so the source must be a name,
  a dotted path of names (`Math.hypot`, `_.f`) or a function expression in
  parentheses with a pure arithmetic body (`((t) => t * t + 1)`,
  `inferSourcePurity()`); another source (`_.getTransform()`) declines.
- `imports` and `preamble` go to the assembly of the existing route: an
  import that is not a function throws ``Unsupported import `x` ``, and a
  preamble makes the result not `shippable`. A preamble that is not blank
  runs on every call, and the profile does not read it: the result is not
  `pure`. An import is a function definition, which runs only when the code
  calls it (through `functions`), so it changes neither fact.
- A source of `vars` or `functions` with a line terminator or a comment
  (`'\n next()'`, `'_.w // width'`) declines: the existing emitter writes
  the source as it is, where `return` followed by a line terminator returns
  `undefined` without evaluating the source.
- `broadcast` is ignored: the result has no `batch`, and the values are
  those of `broadcast: false`, which equal those of the batch body of the
  existing compiler.

Reads and calls of the host are in the `strict` mode only: in the `complex`
mode the existing compiler evaluates a host read once per part of a complex
value (`_SYS.cplx(next())`). A read or a call of the host counts as a draw
in the rule of two draws (above): two or more draws, reads or calls of the
host decline when one of them is in a complex value (`next() + i·f(x)`),
because the existing emitter evaluates the complex operand first. In the
body of a `Comprehension` or of a `Sum`, the host is called once per
element, as on the existing compiler. A `Sum` or a `Product` that calls a
function declared pure declines: the existing emitter skips such a call in
the terms after a sum of `NaN`. An `If` statement whose branch calls the
host is kept, also when its result is not read, because the existing
compiler evaluates the call there. A read or a call of the host that is not
declared pure can change the vars object: no value computed before it is
reused after it (`h(√x, g(x), √x)` with one node object for `√x`
computes the square root twice, as the existing compiler does). In a
program with such a read or call, a read of an input counts as a draw in
the rule of two draws: `x + g(1)·Arcosh(x)` declines, because the existing
emitter reads `_.x` for the real operand after the complex operand that
calls `g`.

```js
const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('f', '(real, real) -> real');
compile(ce.box(['Add', 'x', 'u']), {
  profile: 'numeric-kernel',
  vars: { u: '_.w' },
}).code;
// ➔ "_.w + _.x"
compile(ce.box(['Add', ['f', 'x', 1], 1]), {
  profile: 'numeric-kernel',
  functions: { f: { source: 'Math.hypot', pure: true } },
});
// ➔ code "(() => { const _tv1 = Math.hypot(_.x, 1); return _tv1 + 1; })()",
//   pure: true, shippable: false
```

The decline follows the `fallback` option, as any other decline: with
`fallback: true` (the default of `compile()`), `success: false` and the
interpreter; with `fallback: false`, a `CompileDeclineError`. The diagnostic
has the code `outside-profile`, the kind `capability`, the message of the
refusal, the node in `value` (absent for a node whose text would write more
than 100,000 nodes, such as a subexpression reached on many paths), and its
head in `operator` or a name in `binding`. A decline that the preparation of the existing compiler gives
first keeps its own code. The existing
compiler is never used for a part of the program. An error of the lowering,
the verifier, the analysis or the emitter is not a decline of the profile:
it is a `compile-error` whose message names the phase.

The message of an `outside-profile` decline names the profile: the
refusals of the structured compiler say "the profile" for "the structured
route", and a clause that compares with the existing compiler is removed
(`publicReason()` in `javascript-fragment-target.ts`). An error of the
preparation that is not a refusal of the profile (a `TypeError` of a
defect, for example) is a `compile-error` too.

`cse` and `constantFold` are ignored under the profile: the structured
compiler does neither, and the code is the same with or without them. An
empty object of `functions`, `operators` or `vars` is an absent option. With
another target than `javascript`, with a direct target, or in the
`compile()` method of a target object (`new JavaScriptTarget().compile()`,
and the same for the GLSL, Python and interval targets), the option
is an error, thrown whatever `fallback` says.

**The facts of the result.** A result compiled with the profile has
`profile: 'numeric-kernel'`, `pure` and `shippable`, from the analysis of
the structured program (`analyzeExecution()` in `structured-execution.ts`):
`pure` when no operation of the program or of a function it calls has an
effect or an effect that its definition does not state, and no array that
the host passed is written. A draw from the random stream outside every
`WithRandomSeed` region is such an effect: two calls give different values,
and a call inside an interpreted `WithRandomSeed` advances its frame. A
`WithRandomSeed` region whose body only draws has no effect, so a program
whose draws are all in such regions is `pure`. A read of the host (a
`vars` source that is not an entry of the vars object) and a call of a
function of the host that is not declared pure are effects too; a call
declared pure is not. A `preamble` option that is not blank makes the
result not `pure`. `shippable` when, in
addition, every function the code calls is in the program (a call of the
host, also a pure one, is not), every captured
value is a number, the code neither draws nor seeds the random stream, also
in a region, and the checks of the existing assembly (no random helper in
the code) agree. A `Function` literal has `shippable` too under the profile. The
kernel pool reads the same value: a result that is not shippable never goes
to a worker.

**`canCompile()`.** With the profile, `canCompile(expr, options)` runs the
whole compilation with `fallback: false` and answers `{ ok: true, pure,
shippable }` when it gives code, or `{ ok: false, diagnostic }` with the
diagnostic of the decline. Its cost is the cost of `compile()`.

```js
const ce = new ComputeEngine();
ce.declare('x', 'real');
canCompile(ce.box(['Add', 'x', ['Sin', 'x']]), { profile: 'numeric-kernel' });
// ➔ { ok: true, pure: true, shippable: true }
canCompile(ce.box(['Add', 'x', ['Random']]), { profile: 'numeric-kernel' });
// ➔ { ok: true, pure: false, shippable: false }
canCompile(ce.box(['WithRandomSeed', 42, ['Add', 'x', ['Random']]]), {
  profile: 'numeric-kernel',
});
// ➔ { ok: true, pure: true, shippable: false }
ce.declare('L', 'list<real>');
canCompile(ce.box(['RandomChoice', 'L', 2]), { profile: 'numeric-kernel' })
  .diagnostic;
// ➔ { code: 'outside-profile', kind: 'capability',
//     message: "Could not compile with the profile 'numeric-kernel': unsupported head RandomChoice",
//     operator: 'RandomChoice', value: 'RandomChoice(L, 2)' }
```

The decisions are in `docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md`;
the rules of each admitted form, with the cases where the existing emitter
writes other code, are in `docs/plans/2026-11-09-js-pilot-emission-rewrites.md`.

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
  `Min(L)` with `L = []`, a broadcast over lists of different lengths, and a
  conditional whose undecided arms are a number and a list all give `empty`.
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
gives the same shapes: a number is the `interval` result of a point, and an
absent value is `empty`.

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
interpreter gives no function). No selection is made, and the root declines,
when the `functions` option maps the `If` head or a head in the condition,
since the caller's code runs on the compiled route only. The branch that is
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

### Statement order on GLSL

In the GLSL fragment, a `Block` is a list of statements in two places: the
body of a user function, and the root of the compiled expression. Its
statements are a declaration, an assignment of a local of the function, a
counted `Loop` over an integer range, an `If` or `Which` whose branches are
statements, a nested `Block`, and `Break` in a loop (next section). Each one
is written as a GLSL statement, in the order of the block.

GLSL has no let-expression, so a lowering inside an expression that needs
statements (a loop-form `Sum` or `Product`, a `Block` used as a value, the
statement form of a conditional, the temporary of a piece of caller code) is
hoisted into the enclosing statement list, ahead of the whole enclosing
expression. With `x` declared `real`,
`x + Block(Declare(b, "real", x²), b)` compiles to:

```glsl
float _tv1;
{
  float b;
  b = (x * x);
  _tv1 = b;
}
return x + _tv1;
```

An operand written earlier in that expression (here `x`) therefore runs
after the hoisted statements, where the interpreter runs it first. In the
GLSL fragment this order cannot be observed, except for code that the caller
supplies (below): the fragment has no random draw (`Random` and
`WithRandomSeed` are not in it), an assignment writes only a local of its
function, and a block used as an operand may only declare names with a value
before its last statement (the `block-value` decline of
`compile-admission.ts`, which `canCompile()` runs too), so it writes no local
declared outside it. `x + Block(Assign(b, x²), b)`, where the block assigns
`b`, declines. The other impure nodes are calls of functions whose body is a
block, which write only their own locals. Pure expressions, which every
corpus document has at this position, are unaffected.

Code that the caller supplies runs once per occurrence, in the order of the
interpreter. Such code is a `vars` entry whose value is shader source other
than a plain read (`nextValue()`, `vec3(u + v)`; a uniform name such as `u_x`
or `params.x` is a plain read), a head mapped through `functions` (unless the
entry is declared `pure: true`), and an operator's own `compile` handler. It
can count its calls or draw a number, and the compiler does not see inside
it. The values of the symbols that an expression reads and the bodies of the
user functions it calls are looked through, as the shader inlines them,
except the value of a symbol that reads an input (a plain `vars` read, a
bound variable): with `vars: { T: 'u_T' }`, `T` emits `u_T` whatever value
`T` has.

Before a statement is compiled, each piece of caller code that the statement
evaluates unconditionally is computed into a temporary of its shader type,
in the order of the interpreter, and the statement reads the temporary
(`gpuBindCallerCode()`, `gpu-caller-binding.ts`). So a form that writes an
operand twice, or that computes part of the statement in a statement ahead
of it, writes a read of the temporary. With
`vars: { W: 'nextValue()', V: 'vec3(nextValue())' }`:

- `W + Max(V)` is `float _tv1 = nextValue(); vec3 _tv2 = vec3(nextValue());`
  then `return _tv1 + max(…_tv2.x, _tv2.y, _tv2.z…);`, and `Cot(W)` is
  `float _tv1 = nextValue();` then `cos(_tv1) / sin(_tv1)`.
- Each occurrence is one evaluation, as in the interpreter: `W + W` computes
  `nextValue()` twice. One node object that the caller puts at several places
  of the tree is copied before the other rewrites of the prepare stage, so
  that each place gets its own temporary (`gpuSeparateCallerCode()`). A graph
  whose code would then pass the size limit declines with the size message.
- A position that is evaluated on a condition, or once per iteration, is
  computed at the start of its branch or of each iteration: the selection
  takes its statement form (`If(c, Max(V), 0)` computes `V` inside
  `if (c) { … }`), and a loop body starts with its own temporaries
  (`W + Sum(W + k, k, 1, n)` calls `nextValue()` once before the loop and once
  per iteration). The node that holds such a position is itself computed at
  its place in the order, so its caller code runs after the caller code
  written before it. `And(a, b)` and `Or(a, b)` whose later operand holds
  caller code are written `If(a, b, False)` and `If(a, True, b)`, and a
  chained comparison whose third or later operand holds caller code,
  `Less(a, b, c)`, is written `If(Less(a, b), Less(b, c), False)`: the
  interpreter stops at the first pair that is false.
- Caller code can write a variable that a plain read reads. So a part of the
  statement that reads a `vars` key and that the interpreter evaluates
  before a piece of caller code is read into a temporary first: with
  `vars: { U: 'state.value' }`, `(U, Max(V))` reads `state.value` before it
  computes `V`. A read with no caller code after it stays in place.
- A selection whose branch holds caller code and that cannot take its
  statement form (its branches have no one shader type, or a part of its
  statement writes a binding that it could read) declines, and so do the
  forms listed in the known limitations above (a `Loop` guard, `And` in the
  body of a user function).
- The body of a user function written as a shader function binds its own
  caller code at its start; a body written in place of the call binds it at
  the place of the call.
- A piece whose value has no shader type for a temporary (a uniform array)
  declines.

A statement with no caller code compiles as before. A GLSL target object
passed to `compile()` as the `target` option has no statement sink, so
nothing is bound there. That route does not install the `vars` sources or
the `functions` entries (`Cot(W)` is `cos(W) / sin(W)` with the bare name
`W`); a `compile` handler that reaches it is written in place, and a form
that writes its operand twice runs the handler's code twice.

### `Break` on GLSL

`Continue` is not in the GLSL fragment: the typing pass refuses it in every
position, and the interpreter runs the program. A jump is a statement in
GLSL. So `Break` compiles only as a statement of the body of a counted
`Loop`, in a block at the root of the compiled expression or in the body of a
user function: alone, in a nested `Block`, or as the branch of an `If` with
no else branch or of a `Which` with one clause: `If(c, Break())`,
`Which(c, Break())`, `If(c, Block(m ≔ k, Break()))`. With `a` a local of the
block, `Block(a ≔ 0; Loop(Block(If(a > 3, Break()), a ≔ a + 1), k ∈ 1..8); a)`
compiles to this code on GLSL:

```glsl
for (int k = 1; k <= 8; k++) {
  if (++_gpu_passes > 10000) break;
  if (3.0 < a) {
    break;
  }
  a = a + 1.0;
}
```

The first statement of the loop is the pass cap ("A limit on `Loop`
passes", below). In a nested loop, `break` leaves the innermost `for`
statement, as `Break` leaves the innermost `Loop` in the interpreter. The
same loop in the body of a user function `f` is written in the GLSL
definition of that function, `_fn_f`.

Each other position declines, with a diagnostic of `canCompile()`:

- An `If` with an else branch: `If(c, Break(), m ≔ 1)`, and also
  `If(c, Break(), Nothing)`, since the fragment gives `Nothing` no type. When
  the first branch always leaves the loop, write the else branch as the
  statement after the `If`.
- A `Break` with a value, `Break(f(k))`. The compiled `break` has no value, and
  the interpreter evaluates the operand before it leaves the loop.
- A jump in a value: `s ≔ If(c, Break(), 1)`.
- A jump with no `Loop`. A `break` outside a loop is an error that only the
  driver reports, after the compilation has reported success.
- A jump in a `Sum` or `Product` body: the boxing of the expression writes an
  `Error` node for it (`incompatible-type`).
- A `Loop` over several `Element` clauses, with or without a `Break`: the
  fragment has only the counted loop over one integer range.

On a NaN operand, the shader and the interpreter take the same action: a
relation is `false`, so `If(v > 4, Break())` does not jump, and `≠` is `true`,
so `If(v ≠ 4, Break())` jumps.

### NaN-safe helpers on the shader targets

On GLSL, `sin`, `cos`, `sign`, `min`, `max` and `clamp` call a
NaN-safe helper (`_gpu_sin`, `_gpu_min`, …), because a GPU built-in can turn a
NaN operand into a number. The built-in is emitted only when the operand is
finite for certain (`gpuProvablyFinite()`,
`src/compute-engine/compilation/gpu-finite-proof.ts`). The proof includes f32
overflow, rounding, the flush of subnormal values to 0, and the error of the
GPU functions. When the proof is not certain, the helper stays.

The host provides the proof, and the compiler uses all of it. It reads the
declared types and ranges of the inputs, the declared ranged result types of
the user functions, the declared ranges of their parameters, the number
literals and the operators of the operand. In the body of a user function, a
parameter is also finite when every call of the function in the compiled
expression passes a value that is proven finite at its position from these
declarations (`gpuRecordCallSiteFacts()`), with the bound of the largest
argument; the functions are taken callers first, so a bound passes from
one body to the next. The `compileFunction` route runs no
common-subexpression pass, and proves no operand. The proof does not read
the body of a user function to prove a call of it, and does not read the
index of a `Sum`, `Product` or loop as finite. A call
never declines for want of a proof: it calls the helper, which gives the
same value as the built-in on a finite argument. The caveat on the shader
targets in "Caveats of compiled code" gives the examples.

## A limit on `Loop` passes

A compiled `Loop` has no check of its own. `Block(k := 0, Loop(k := k + 1))`
compiles to `while (true) { k = k + 1 }`, which does not return, also under
`ce.withTimeLimit({ ms: 500 })`: the time limit belongs to the engine, and the
emitted code does not read it. The interpreter stops the same loop at
`ce.iterationLimit`. A host that runs an imported document sets a limit when it
compiles the code:

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
`_IA.countLoopPass(n)` on `interval-js`, and the code resets the total first
with `resetLoopPasses()`: as the first statement of the preamble that runs on
each call, or of each call of a compiled `Function` literal. On a direct target
the reset is in `code`, before the expression or in each call of a `Function`
literal at the root. The total is on the runtime and not in a local of the
code, because the definition of a user function can live outside the function
that the host calls, and stored code reads only `_SYS` and `_` (see "Running
stored JavaScript"). `createJavaScriptRuntime()` and `createIntervalRuntime()`
keep the limit.

**Targets.** Python declines a program with a `Loop` when the option is set,
because its code has no count. A `Sum` or a `Product` still compiles there, with
no limit. A shader cannot throw, so GLSL has a cap of its own, with a default
of 10,000 passes and `NaN` over it ("The GLSL fragment and `canCompile()`",
"The pass cap"); a `Loop` with no indexing set declines there.

**Not covered.**

- A `Sum` or a `Product` keeps its own rule: the loop gives `NaN`, or the
  `entire` interval on `interval-js`, before its first pass.
- A `Comprehension` has no count, and a guard that keeps few elements can run
  over a long range: `Comprehension(1, Element(i, 1..m, i < 0))` with `m` at 3e7
  runs all of its elements.
- A helper of the runtime over a list that exists is finite, and one long call
  inside a pass is not interrupted.
- On the JavaScript target, a for-each over a `Range` of more than 2^32 elements
  throws a `RangeError` before its first pass, with or without the option. A
  counted loop over a literal range of that size has no such test, and the limit
  stops it.
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
modes, `python` offers the first two, and `interval-js` and `glsl`
offer `strict` only. A request for a mode that the target does not offer
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
`complex` compiles wide numeric bindings through complex kernels. This includes the cells of a list or tensor input whose cell type
admits a complex value (`list<number>`, `tensor<number>`, `list<unknown>`):
the element-wise lowering of arithmetic and of the cell functions uses the
complex-aware kernels (`_SYS.sadd`, `_SYS.smul`, `_SYS.csqrt`, …), as for
`list<complex>`, while cells typed `real` or `integer` keep the real lane.
The element-wise lowering reads such a cell with its cell type: `r·10^i`
with `i: list<integer>` takes the real power, as `r·10^k` with
`k: integer` does.
In the `complex` mode an unknown-sign radical or logarithm (`Sqrt`, `Ln`,
`Log`, an even `Root`, a non-integer `Power`) is promoted to the complex
kernel. A kernel compiled in the `complex` mode returns a JavaScript
number when its value is real and a `{re, im}` object only when the
imaginary part is nonzero: `Sqrt(x)^2` at `x = -4` is the number `-4`,
`Sqrt(x)` at `x = -4` is `{re: 0, im: 2}`. The result records its mode and,
on a decline, its diagnostic.

Real-only kernels guard and project only where the model explicitly permits
it. `Mean`, `Variance`, `StandardDeviation` and their population forms are
the exception on JavaScript (`CompileTarget.complexLowering`): in the
`complex` mode, data that may hold a complex entry takes `_SYS.cmean`, `_SYS.cvariance`
and the like, which compute the interpreter's value (`Mean([3, 4i])` is
`1.5 + 2i`; the variance is the real sum of `|x − mean|²` over `n − 1`)
instead of `NaN`. Real data gives the same bits as the real lowerings. A
caller's own lowering of these heads is used as it is. The `strict` mode
still declines such data.

A `Power` whose base type does not give its rank and cannot hold a point
(`tensor<number>`, `list<list<number>>`, `broadcastable<number>`) decides on
the value at run time, as the interpreter does: `_SYS.matrixPowerShape` gives
the matrix power for an integer power of a square matrix, and of each matrix
of a tensor of rank 3, throws for an integer power other than 1 of a matrix
that is not square (the interpreter's `expected-square-matrix` error; the
`matrix<…>` lowering `_SYS.matpow` throws it too), and the element-wise power
runs for any other shape. The interpreter takes the matrix power for an EXACT
integer exponent only, so the compiler reads the exponent expression: one
with a float in it (`1.5x`) keeps the element-wise code; an exact one (a
symbol, an integer-typed expression, `n/2`, `2^k`) takes the matrix power at
an integer value; and one whose exactness it cannot read (`2x` on a `real`
input, a user function, `sin x`) throws where the value is a matrix and the
exponent an integer other than 1. An exponent that is not an integer but
within a relative `1e-12` of a nonzero integer throws too where the base holds
a matrix: it is most likely an exact integer computed in floating point
(`√n·√n` at `n = 2` is `2.0000000000000004`). `Inverse` and `m^-1` of a
non-square `matrix<…>` throw the same error. A caller's own `Power` lowering
(`functions`, `operators`) is used as it is, with no dispatch. A list exponent is paired with
the base level by level, as in the interpreter; when that pairing meets a
matrix with an integer entry (`p^[1, 2]` for `p` of rank 3), the code throws,
since it does not compute that matrix power. A point is an array at run time,
so a list of points and a matrix have the same value there. A base whose type
can hold a point but not a matrix (`list<tuple<…>>`) keeps the element-wise
power. A base whose type can hold both (a bare `list`, `list<unknown>`,
`list<any>`, `indexed_collection`, and a value of type `any`: an element
`p[1]` of such a list, also in `\sum_k p_k^2`, or a call of a function
declared `(real) -> any`) declines with `unsettled-shape` (rule R3) for an exponent that
can be an exact integer: with `p: list` holding `[[1, 2], [3, -4]]`, the
interpreter gives the matrix power `[[7, -6], [-9, 22]]` for `p^2`, and the
element-wise code gave `[[1, 4], [9, 16]]`. A product of such an operand with
another array (`p·q`, `p·[1, 2]`) declines in the same way; its product with a
number keeps its code. Declare the element type (`list<list<real>>`, or
`list<tuple<real, real>>` for points) to compile it.

A declared real result is real on every mode. A function declared with a real
result type (`p: (real) -> real`, also `-> finite_real` and `-> nan | real`)
has its body wrapped in a real ascription, `Typed(body, 'real')`. When the
body is complex only because of promotion — complex with promotion on, real
with promotion off — the ascription selects the real lane for the body: the
body compiles with promotion off, as `strict` compiles it, also in the
`complex` mode. An unknown-sign `Sqrt`, `Ln`, `Log`, even `Root` or
non-integer `Power` in the body then gives `NaN` outside its real domain, the
same value that `strict` gives. This is the reading that a real-typed symbol
already has: the type `real` excludes `NaN`, and `NaN` is the answer when a
real result has no value. For example, with `p := k ↦ sin(2.4k)·√((k − 0.5)/16)`, `p(x)` compiles to
`Math.sin(2.4 * k) * Math.sqrt(0.0625 * (k + -0.5))` and is `NaN` at `x = 0`.

The rule applies only where it changes the lane of the body:

- A body that is real also with promotion on (`|√k|`) keeps its promoted
  heads, and `|√(−4)|` is `2`, as the interpreter computes it.
- A body that is complex also with promotion off still declines with "Could
  not compile `Typed`: the value … is complex, but its ascribed type `real`
  says it is real". Such a body has an operand that is complex by its type
  (`q := z ↦ z²` called with a `complex` argument), a call of a user function
  whose definition is complex (a definition is shared by every call site, so
  it is never recompiled on the real lane for one caller), or, in the `complex`
  mode, a node whose type admits a complex value. The `complex` mode reads
  such a node as complex without promotion: a parameter declared `unknown`
  (`(unknown) -> real`), and also a radical over a parameter that the
  function literal leaves untyped, which types `number`. A call that the
  compiler inlines substitutes the typed argument and avoids this. An emitted
  definition (a recursive function, for example) is compiled in the `complex`
  mode with the parameter types of the declared signature when they are real
  types narrower than the literal's, so `p: (real) -> real` assigned a
  recursive `k ↦ …` compiles there too (ROADMAP CE-230.1).
- A result type that admits a complex value (`-> number`, `-> complex`) is not
  a real result, and the body promotes as before.
- The value of an assigned symbol that the body reads is compiled with
  promotion off too, as the rest of the body: with `a := √(c − 1)` and
  `p := y ↦ a·y`, `p(x)` reads `Math.sqrt(c - 1)`, `NaN` for `c < 1`. The
  shared preamble local of the value (`_val_a`) keeps the promotion of the
  mode for the other readers; a value that is complex only by promotion gets a
  second local with promotion off (`_val_a$r`) for the readers in a real
  ascription (ROADMAP CE-230.2). A user-function definition is not recompiled
  this way: it is shared by every call site.
- The shader targets never promote, so nothing changes there.

The fold-before-shape rule: the analysis that decides whether a node is
complex (`BaseCompiler.isComplexValued`) and the emitters that write the node
must give the same answer, so they ask one question in one place. For a closed
constant, that place reads the memoized constant fold first
(`_withFoldedRealOverride` in `base-compiler.ts`): `√(5 − √5)` has a type that
admits a complex value, but it folds to a real number, so it is read as real
and emitted as a real literal. The fold is memoized for each target and
expression, so the answer cannot change between analysis and emission. A
change to how a shape is read must go into that shared question, not into one
consumer: a consumer that reads the shape on its own wraps a plain number in
the `{re, im}` convention, which turns a safe decline into a silent `NaN`.
Where the compilation does not fold (`constantFold: false`, a `symbolDeps`
capture, a target other than JavaScript), the type alone decides.

A `Sum` or `Product` over a small constant range is unrolled by mapping the
index NAME to a literal in the emitted code, so the analysis reads a body in
which the index is still a free symbol. Each unrolled term therefore also
hands the analysis its own index VALUES: a subtree that mentions the index and
folds to a real constant under those values is real-emitted, which keeps a
radical such as `√(1 − 0.025²(i − 0.5)²)` on the real kernel in every term.

Three conditions hold this to the shape invariant. The clause must have a
single indexing set with constant bounds inside the unroll limit, so the
terms the analysis reads are the terms the emitter writes. Every term must be
real under its own value, because the terms feed ONE accumulator, which holds
plain numbers or `{re, im}` objects and never a mix; a clause whose terms
disagree keeps the index-masked verdict and its uniform lowering. And the
question is asked in one place — the target's `unrolledClauseLane` — which
both the emitter and `isComplexValued`'s answer for the whole `Sum` read, so
the enclosing expression expects the shape the terms produce.

A subtree that does NOT mention the index is left to the ordinary
fold-before-shape rule, because loop-invariant hoisting may compile it once
outside any term. The whole mechanism is inert wherever the compilation does
not fold constants (`constantFold: false`, a `symbolDeps` capture, a
non-JavaScript target).

A function whose result jumps at a point (`JUMP_FUNCTIONS` in
`jump-functions.ts`: `Floor`, `Fract`, `Mod`, `Sign`, the comparisons, …)
applied to closed exact operands is folded on every target except
`interval-js`, also under `constantFold: false` and under a `symbolDeps`
capture. The structural code computes the operands as doubles, and a double
can be on the other side of the jump from the exact value:
`Floor((25! − 1)/24!)` is `24`, but the double of the operand is `25.0`. The
fold reads the exact value, as the interpreter does. A comparison folded this
way is emitted as the target's boolean constant (`True` on Python). Under a
`symbolDeps` capture the fold records every symbol whose value it reads, and
declines when the operand calls a user function. Operands with a free
variable, operands with a float literal, and operands that are all integer
literals in the safe integer range keep their structural code. The interval
target is excluded because its code computes an enclosure, and the enclosure
of such a node contains the exact value (`closedExactJump` in
`base-compiler.ts`).

A rounding function (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`) whose
operand adds an integer-typed variable `v` (a loop index, an integer-typed
symbol, a sum of them with integer coefficients) to closed exact terms `c`
that no double holds exactly is compiled from a form that rounds `c` alone:
`Floor(v + c) = v + Floor(c)`, `Ceil(v + c) = v + Ceil(c)`,
`Fract(v + c) = Fract(c)`, `Round(v + c) = v + Round(c)` when `c` is not
halfway between two integers, and `Truncate(v + c) = If(v ≥ −Floor(c),
v + Floor(c), v + Ceil(c))`, since truncation is not shift-invariant across 0.
The rounded constant is then a closed exact jump node, folded as above. So
`Sum(x·Floor(k + (25! − 1)/24!), k, 1, 300)` gives the interpreter's value in
the unrolled form and in the loop form. Every other shape whose variables are
all integer-typed declines with the `correctness` diagnostic
`inexact-jump-operand`: a variable part that is not an integer
(`Floor(k/3 + 1/7)`), a product (`Floor(k·π)`), a constant inside a variable
term (`Floor(k·√2 + 1)`), a step form, and a `Round` whose constant may be a
tie. A shape with a variable that is not integer-typed keeps its structural
code on every target, GLSL included: `Floor(π·x)`, `Floor(x + 1/3)`,
`Floor(x/√2)`, `Floor(y/3 + 1/7)` for a real `x` or `y`, and also
`Floor(k + x + c)` with an integer `k` and a real `x`. There, the double of the
constant moves the jump by about one unit in the last place, as in any float
code. So `Floor(x + (25! − 1)/24!)` at `x = 1` gives 26 in the compiled code,
where the interpreter gives 25: the double of `(25! − 1)/24!` is 25.0. A
literal that a double holds exactly (`Floor(k + 1/2)`) and a rational factor
whose numerator and denominator a double holds (`Floor(2k/3)`, emitted as a
division and a multiplication by integers) keep their structural code, as do
an operand with a float literal and the interval target (`jumpShiftRewrite`
in `base-compiler.ts`).

A real-only head (an ordering comparison, `Floor`, `Mod`, `Min`, `Erf`, …)
over an operand that may be complex at run time takes the runtime rule in the
`complex` mode: the operand is bound once, the head's real
lowering runs on its real part when the imaginary part is exactly zero, and
the value is `NaN` (or `false`, for an ordering) otherwise. A statically
non-real operand (`i`, `2i`, an `imaginary`-typed symbol, a list literal every
element of which is non-real) is a compile-time decline. When such an operand
is an ARRAY at run time — `√L` over a real list `L`, a `list<complex>` symbol,
a selection with such an arm — the rule is element-wise: every maybe-complex
operand of the head is replaced by its element-wise real projection (each
exactly-real element as its real part, every other element as `NaN`), and the
real lowering broadcasts or reduces over the projections. `⌊√L⌋` floors each
real root and answers `NaN` at a complex one; `min(√L)` is `NaN` as soon as
one root is complex; `√L < 1` is `false` at a complex root; `L < w` at a
complex scalar `w` is `false` at every element (the value keeps the head's
shape). In `strict` mode nothing changes: such an operand fails closed.
Targets provide the projection through the `complexRealElements` hook
(`_SYS.crealElements` on JavaScript, `_ce_creal_elems` on Python); a target
without it keeps the compile-time decline. The `complexPromotion` option, a
compatibility alias of `mode: 'complex'` since 0.115.0, is removed with no
warning: a call that still passes `true` is compiled in the default
`strict` mode. The `realOnly` option, which projected a compiled unit's
RESULT to a real number (or `NaN`) after the kernel had run, is removed, and
so is its warning: a compiled value whose
imaginary part is exactly zero is already returned as a plain number, so a
consumer tests `typeof v === 'number'` per sample and maps a `{re, im}` at its
own value boundary.

The remaining quiet-machine performance measurement is tracked in
`plans/2026-08-16-compile-complex-mode.md`.

### The `bigint` mode

**What it is for.** In the other modes every number is a double, so an
integer past `2^53 − 1` is rounded, and `Mod`, `Remainder`, `GCD` and `LCM`
throw for such an operand ("Integer operations beyond the safe integer
range"). The `bigint` mode computes every integer value as a JavaScript
`bigint`, so a counting function (a binomial sum, a ballot number, the
unranking of a Dyck path) is exact at any size. With `n: integer`, the
Catalan form `Binomial(2n, n) − Binomial(2n, n + 1)` at `n = 40n` gives
`2622127042276492108820n`, and `Mod(n, 10)` at `n = 2^60 + 1` gives `7n`
(GitHub issue #503).

**How to request it.** `compile(expr, { mode: 'bigint' })`. Only the
built-in `javascript` target offers it. A custom target that lists
`'bigint'` in its `supportedModes` still declines with
`'unsupported-mode'`. The mode is used only when a host requests it: no
compilation detects an integer past `2^53` and changes to `bigint`, and a
request for `bigint` compiles once, with no retry in another mode. The
result reports `mode: 'bigint'`. Inside the compiler the mode
is the `strict` discipline with a second setting, the integer lane
(`'bigint'` in place of `'double'`).

**Which nodes compile.** Every numeric node is on the integer lane (its
value at run time is a `bigint`), or the compilation declines. A node is on
the lane when two conditions are true:

- Its type is a subtype of `integer | nan | infinity | signed_infinity`: each
  finite value is an integer. For some heads the engine gives a wider type
  than the value that the operands permit, and the mode uses a narrower
  type, for this mode only: `Abs(n!)` is `integer<0..> | infinity`,
  `Mod(n, m)` is `integer | nan`, `n^k` with `k: integer<0..>` is `integer`,
  `Length(L)` is `integer<0..>`, and a sum, a product, `Min`, `Max`, `If`,
  `Which`, `Fold`, `Reduce`, `Sum`, `Product` or a user call whose operands
  are all on the lane is `integer` plus the non-finite members of the
  operands (`f(n) + 1` with `f := x ↦ x!`).
- Its head is on the list of the mode, or it is an integer literal, an input
  of a subtype of `integer`, or a call of a user function. The list:
  `Add`, `Subtract`, `Negate`, `Multiply`; `Power` with an exponent of type
  `integer<0..>`, and `(−1)^k` for any `k` on the lane; `Abs`, `Min`, `Max`,
  `Sign`; `Mod`, `Remainder`, `GCD`, `LCM`; `Factorial`, `Binomial`,
  `Fibonacci`, and `Factorial2` of an operand of type `integer<0..>`;
  `Floor`, `Ceil`, `Round`, `Truncate` (see below); `Sum` and `Product`;
  `Fold` and `Reduce` over a `Range` or a `list<integer>`; `Range`, `List`,
  `Map`; `If` with an else branch and `Which` with a final `True` clause;
  `Typed(…, T)` with `T` a subtype of `integer`; `Length`, `Count`,
  `Boole`; `At`, `First`, `Last`, `Take`, `Drop` and `ReplaceAt` with an
  index or a count on the lane. Many heads of type `integer` are not on the
  list, because their lowering gives a double (`DigitSum`,
  `IntegerDigits`, `RandomInteger`, `IndexOf`).

A boolean node is not on the lane. It compiles when it is a comparison
(`Less`, `Greater`, `LessEqual`, `GreaterEqual`, `Equal`, `NotEqual`) of two
operands on the lane, `IsPrime` of an operand on the lane, or `And`, `Or`,
`Not` of such nodes. A comparison with a rational constant is exact: `n < p/q`
is computed as `q·n < p` with `bigint` values. So `n ≥ (3·2^53 + 1)/2` at
`n = 3·2^52` is `false`, as in the interpreter, where a comparison with the
double of the constant gives `true`. `Equal(n, 1/3)` is `false` and
`NotEqual(n, 1/3)` is `true` for every `n`.

**A quotient under a rounding function or an integer promise.** A node of
type `rational` has no `bigint` value. Four shapes of such a node compile,
when their operands are on the lane and their parent requires an integer:
`p/q · t` (canonicalization writes `n(n + 1)/2` as
`Multiply(Rational(1, 2), n, n + 1)`), `a/b`, `a^e` with an exponent that
can be negative (`2^(−n)`), and `Sqrt(t)` (under a rounding function only).
The parent sets the lowering:

- Under `Floor`, `Ceil`, `Round` or `Truncate`, the quotient is rounded
  exactly: `Floor(n/3)`, `Ceil(n/2)`, `Floor(2^(−n))` (`0n` at `n = 3`).
  `Round` rounds a half away from zero (`Round(5/2)` is `3`, `Round(−5/2)`
  is `−3`), as the interpreter does. `Floor(Sqrt(n))` is the integer square
  root, and `Ceil` and `Round` of `Sqrt(n)` are exact too, also past `2^53`.
- Under an integer promise, the division is checked: a remainder that is not
  zero throws a `RangeError` that names the operands (`The quotient 7 / 2 is
  not an integer, but its value was promised to be an integer`). An integer
  promise is `Typed(…, T)` with `T` a subtype of `integer`, the body of a
  user function declared `-> integer`, and an argument at a parameter that
  the signature of the head declares `integer` (`Fibonacci(n/2)`). The
  interpreter gives a type error there. `Mod`, `Binomial`, `GCD`, `Range`
  and the limits of a `Sum` are not integer promises: `Mod(n/2, 7)` is `3/2`
  at `n = 3` in the interpreter, and it declines.

Such a quotient is computed for its parent only, so common-subexpression
elimination does not share it: `Floor(n/2) + Ceil(n/2)` at `n = 7` is `7n`.

**Loops.** `Sum`, `Product`, `Range` and `Fold` over a range with bounds on
the lane count with a `bigint` index, so `Sum(Mod(k, 7), k = 1..n)` at
`n = 10^6` is exact. These sums compile: `Sum(k!, k = 0..n)`,
`Sum(Floor(n/k), k = 1..n)`, and the derangement sum
`Sum((−1)^k·Binomial(n, k)·(n − k)!, k = 0..n)`. A rational bound
(`Sum(i, i = 1..n/2)`) declines.

**User functions.** A parameter of a subtype of `integer` is on the lane,
and a parameter of type `number`, `real` or `complex` is not. A call whose
argument is on the lane at a parameter that is not, or the reverse, declines:
with `h: (number) -> number`, `h(n)` declines. A function literal with no
parameter types takes the lane of its argument. A recursive function
compiles with the parameter lanes of its signature.

**What declines.** The compilation declines with the diagnostic code
`'bigint-lane'`, of kind `'capability'`, whose message names the node and
its type, and the expression runs on the interpreter, as every decline does.
Examples, with `n`, `m: integer` and `x: real`:

| Expression                                                | Reason of the decline                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `n + x`                                                    | an input that is not of a subtype of `integer`                 |
| `n(n + 1)/2`, `2^n`, `Binomial(2n, n)/(n + 1)`             | a type that is not an integer type, with no rounding parent    |
| `Sqrt(n)`                                                  | the same; `Floor(Sqrt(n))` compiles                            |
| `Mod(n/2, 7)`                                              | `Mod` is not an integer promise                                |
| `n^m`                                                      | the exponent is not of type `integer<0..>`                     |
| `Factorial2(n)`                                            | the operand is not of type `integer<0..>` (`(−5)!! = 1/3`)     |
| `DigitSum(n)`, `IsEven(n)`                                 | a head that is not on the list                                 |
| `String(n)`                                                | the interpreter writes a large integer in exponent form (`"1e+30"`) |
| `n + 10π`                                                  | a real constant has no exact `bigint` value                    |
| `h(n)` with `h: (number) -> number`                        | the argument and the parameter are on different lanes          |
| `Piecewise(…)`, `If` with no else, `0 < n < m`, a `Block` of more than one statement | not on the list in this version              |
| `Sum(i, i = 1..n/2)`                                       | a rational bound                                               |

An input whose type admits a non-finite value (`integer | infinity`)
declines too.

**Inputs.** An integer input (a free symbol or a parameter of a subtype of
`integer`) takes a `bigint`, or a `number` that is a safe integer. The
emitted code converts a `number` to a `bigint`, so the conversion is done in
every runner, also with `entryChecks: false`. With the entry checks on (the
default), a `number` that is not a safe integer (`1.5`, `2^60`), and a value
that is neither a `number` nor a `bigint`, throw a `TypeError` that names
the input: `"n" was compiled in mode 'bigint' as an integer, and received
the number 1.5`. With the checks off, a `number` that is not an integer
throws the `RangeError` of `BigInt()`, and another value outside the type
gives an unspecified result. A `list<integer>` input (also nested) is an
array of `bigint`. With the entry checks on, its `number` cells are
converted in a copy, and a cell that is not an integer throws a `TypeError`
that names the cell; with the checks off, the host must give `bigint` cells.
A function literal at the root returns a function that converts and checks
its arguments in the same way.

**Results.** A result on the lane is a `bigint` for every finite integer,
also a small one, and a list result is an array of `bigint`. A boolean
result is a `boolean`. A result is a `number`, `NaN` or `Infinity`, when a
sub-expression had no finite value (a pole): a helper at a pole throws an
internal error that carries the `number`, and one catch around the compiled
entry (and around a function returned to the host) returns it. `Infinity` is
the value for a `~oo` of the interpreter (`(−1)!`, a zero divisor with a
dividend that is not zero, `0` to a negative power), and `NaN` for a form
with no value (`Mod(n, 0)`, `0/0`, `0^0`, the square root of a negative
number, an index out of range). A recursive function has no catch of its
own: the catch of the entry gets the error. A pole in one cell of a list
makes the whole result a `number`.

A `number` result has no defined relation to the value of `evaluate()`.
This is the exception to the rule of "Fail closed". The compiler does not
test where a pole can occur: the throw ends the whole computation, so no
operator receives a non-finite value and no finite result is computed from
one, but the operators between the pole and the result do not change the
`number`. Examples at `n = −1`, `m = 0`:

| Expression                   | `evaluate()`                | Compiled                   |
| ---------------------------- | --------------------------- | -------------------------- |
| `n!`                         | `~oo`                       | `Infinity`                 |
| `−\|n!\|`                    | `−oo`                       | `Infinity`                 |
| `n! > 5`                     | `False`                     | `Infinity` (not a boolean) |
| `g(n!)`, `g := x ↦ 1`        | `1`                         | `Infinity`                 |
| `Mod(n, m)`                  | `NaN`                       | `NaN`                      |
| `Mod(n!, 7)`                 | `incompatible-type` error   | `Infinity`                 |
| `Map(Range(−1, 1), k ↦ k!)`  | `[~oo, 1, 1]`               | `Infinity` (the whole list) |
| `If(n < 0, 0, n!)`           | `0`                         | `0n`                       |

A host that needs the value at such an input evaluates the expression with
the interpreter.

The compiled `Map` builds every element, and the interpreter's `Map` is
lazy. So with `hf: (integer) -> integer := x ↦ x/2`,
`Length(Map(hf, L))` at `L = [1, 2]` is `2` in the interpreter, and the
compiled code throws the `RangeError` of the checked division at `hf(1)`.

**Two `RangeError` cases.** A checked division with a remainder under an
integer promise, and the size limit (below), throw a `RangeError` to the
caller. When an expression holds a pole and one of these, the one that the
code computes first decides whether the result is a `number` or a
`RangeError`: `n! + Fibonacci(m)` at `n = −1`, `m = 10^9` throws the
`RangeError`, because the canonical order puts `Fibonacci(m)` first. Common-subexpression
elimination computes a shared subexpression before the other code, so the
`cse` option can change which of the two the host receives. It never changes
a `bigint` or a `boolean` result. A `bigint` division by `0n` never throws
its native `RangeError`: every helper tests its divisor.

**The size limit.** `Power`, a quotient `a^e` under a rounding function,
`Factorial`, `Factorial2`, `Binomial` and `Fibonacci` estimate the number
of decimal digits of their result before they compute it. Past 1,000,000
digits, the limit of the interpreter, they throw a `RangeError` that names
the operation: `Fibonacci(n)` at `n = 10n ** 9n` throws at once. The
interpreter leaves such an expression unevaluated. Both mean "no value", but
the host receives a `RangeError` from the compiled code and an unevaluated
expression from the interpreter. A power of `0`, `1` or `−1` has no limit.
The loops and the `*` operator have no limit: `Product(k, k = 1..n)`
computes `n!` with no limit, as a loop of the other modes runs with no
limit. A host that compiles expressions it does not trust limits its
inputs.

**Constant folding.** A constant subtree on the lane is folded to a
`bigint` literal from the exact value of `evaluate()`:
`Mod(2^60 + 1, 10)` compiles to `7n`, and no rounding occurs. A constant
whose value is a finite number that is not an integer declines outside a
rounding function or an integer promise (`n + 1/2`), and so does a
constant that the interpreter leaves unevaluated (`Fibonacci(10^9)`). A
constant whose value is not finite (`(−1)!`, `0^(−1)`, `Mod(5, 0)`, or a
symbol whose value is `~oo`) is a pole: the code throws it only where the
node is evaluated, so `If(n > 0, n, (−1)!)` is `3n` at `n = 3` and
`Infinity` at `n = −2`. A constant pole is not shared by
common-subexpression elimination.

**The batch runners refuse the mode.** `broadcast()` and `broadcastAsync()`
call the code for each element and write `Float64Array` outputs, which
cannot hold a `bigint`. In the `bigint` mode they throw `Code compiled in
mode 'bigint' cannot be broadcast`. The stored JavaScript records the mode
(the `mode` field), and the batch loaders `loadBroadcast`,
`loadBroadcastSlice` and `loadBroadcastAsync` of
`createJavaScriptRuntime()` refuse it before they start a worker. The code
that `load()` rebuilds gives the same values as `run()`, because the
conversion of the inputs and the catch are in the emitted code.

The Python target does not offer the mode: a Python integer is exact at
any size already. Design and the deferred shapes (ROADMAP CE-715.2 to
CE-715.8): `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`.

## User functions and dispatch

Single and multi-clause functions compile once per artifact. Multi-clause
dispatch uses the same specificity order as the interpreter. If any required
guard cannot be expressed, the entire function declines; compiling a subset of
clauses would change dispatch.

A compiled artifact contains each user function as it was defined when
`compile()` ran. Assigning a new definition later does not change an artifact
that is already compiled. The public `compile()` keeps no cache: each call
compiles again and reads the current definitions. A caller that needs a
function it can replace after compiling passes it through the `functions`
option and reads the live implementation from `globalThis` (see "Running
stored JavaScript" for how such a function is copied).

A recursive or mutually recursive user function compiles to real recursion on
the JavaScript target, with no depth guard: a runaway recursion throws a
`RangeError` from the JavaScript stack, as an unbounded `Loop` already runs
without a guard. The shader targets cannot recurse, so a recursive function
fails closed there with a message that asks for a bounded loop. The Python
target declines it too.

Protocol calls resolve directly when static typing proves one implementation.
Dynamic JavaScript dispatch uses the receiver's runtime nominal tag. Targets
without the tag representation decline.

Common-subexpression elimination never crosses a definition boundary: each call
of a definition emitted by reference is a fresh evaluation of its body. On the
JavaScript target, a definition whose body has no observable effect (directly
or through an assigned symbol value) and whose parameters are all scalar is
wrapped in a last-call memo when the artifact calls it from inside another
definition and from two or more places in all, and its emitted body is at
least 600 characters (below that the engine inlines the definition and shares
its subexpressions itself): the wrapper remembers the arguments and result of
the most recent call and answers a repeated call with the same arguments from
that record. Every vars-object binding the body reads, directly or through a
definition it calls (a slider reaches a compiled row this way), is part of the
key next to the arguments. Keys are compared by value, with `NaN` equal to
`NaN` and `0` distinct from `-0`; a key that is not a number, a string or a
boolean, or a result that is an object or a function, bypasses the record. The
record lives in the definition's closure, so two artifacts never share it. A
definition called from one place, or only from the root, is emitted unchanged.
The rule is implemented by `memoizeSharedDefinitions` in `javascript-target.ts`.

### A string at a collection parameter

A string is a collection of its characters, so a parameter that the body
reads as a collection has a collection type: in `s ↦ Length(s)`, `s` is a
`collection`. The function is compiled for a list or a set, and that code
throws a `RangeError` for a string. On the JavaScript target, a use that
gives a string to such a parameter therefore uses the function compiled with
the parameter typed `string`. The uses are a call whose argument has a string
type, and the function given by its name as the callback of an operator
that passes one element (`Map`, `Filter`, `Count`, `Any`, `All`) over a
collection of strings.

- A function defined on the engine gets a copy with its own name
  (`_fn_f_string`; `ensureSpecializedUserCallEmitted()` in
  `compiler-core.ts`, `stringElementCallbackEta()` in
  `compile-user-functions.ts`).
- A block-local function is bound once in its block, so the function with
  the parameter typed `string` is written at the use
  (`stringTypedLocalLiteral()` in `compile-user-functions.ts`). A use that
  gives a list keeps the binding of the block.

The use of a block-local function declines when the function cannot be
written there:

| Program (`t: string`)                                              | Compiled JavaScript |
| ------------------------------------------------------------------ | ------------------- |
| `g := s ↦ Length(s)`, `g(t)`                                       | 3 at `t = "abc"`    |
| `k := 2`, `g := s ↦ Length(s) + k`, `g(t)`                         | declines: the body reads `k`, a name bound at the use |
| `k := x ↦ 2x`, `g := s ↦ k(Length(s))`, `g(t)`                     | declines: the body calls `k`, a name bound at the use |
| `g := s ↦ If(Length(s) = 0, 0, 1 + g(Rest(s)))`, `g(t)`            | declines: the body calls `g` itself |
| `g := (s, k) ↦ Length(s) + k`, `g(t, L)` with `L: list<real>`      | declines: the interpreter binds `L` whole, and the function typed `(string, k)` maps over a list |
| `Declare(g, "(list<real>) -> integer", s ↦ Length(s))`, `g(t)`     | declines: the interpreter gives an `incompatible-type` error |

The test for a name bound at the use does not tell a binder between the
definition and the use from the block that defines the function, so a body
that reads another local of that block declines too. A body that reads an
input of the compiled expression compiles.

### Function values

Compiled code calls a function only when it can see the callee (user decision
of 2026-11-02, options page 5, option B, in
`docs/plans/2026-11-02-language-axes-options.md`). A call compiles when the
callee is a defined function, a declared function with a value (a block-local
`Declare` of a function literal included), or a function literal at the call
site. The callbacks of `Map`, `Filter`, `Sort`, `Fold` and `Reduce` compile
when they are such a callee. A derivative callee, `Apply(Derivative(f, n), x)`
(the parse of `f'(x)`), compiles when `f` is a defined function: the compiler
resolves it to the closed form of `f` as a literal at the call site
(`appliedDerivativeLiteral()`).

These forms decline, with a reason that names the form:

- a partial application or a curried call: `Apply(f, 1)` for `f` with two
  parameters, `Apply(Apply(f, 1), u)` (`partial-application.ts`);
- a function value passed as an argument to a user function or to `Apply`
  (`h(x ↦ x + u)`), and a function literal with a parameter declared with a
  function type (`h = (g: function) ↦ g(1)`) (`assertNoFunctionValue()`,
  `compile-function-values.ts`). The root of a compilation is the
  exception: its parameters are the inputs of the compiled function, and
  the host passes a JavaScript function for a function-typed one, so
  `(h: (real) -> real) ↦ Map(h, [1, 2])` compiles and calls `h`;
- a call whose value is a function: a function returned from a function
  (`Apply(mk(1), u)` with `mk = a ↦ (x ↦ x + a)`);
- a call of a function value stored in a local: a block-local function that is
  assigned more than once, inside a nested statement, or from the result of a
  call (`tryCompileLocalFunctionCall()`).

The interpreter keeps first-class functions: lambdas, closures, currying,
partial application and function values.

| Input                                       | Before 3.4.5               | Now      |
| ------------------------------------------- | -------------------------- | -------- |
| `Map(x ↦ x^2, L)`                           | compiles                   | compiles |
| `Map(f, L)` with `f` defined in the scope   | compiles                   | compiles |
| `Apply(Apply(f, 1), u)`                     | compiles for one step      | declines |
| `g = (k: real = 2) ↦ k + 1`, `g()`          | compiles with the fill     | compiles (`3`, completed at compile time) |
| `h = (f: function) ↦ f(1)`, `h(x ↦ x)`      | compiles with a value ref  | declines |

### Parameters with a default value

A parameter with a default value (`(x, k = 2) => x * k`, the MathJSON
parameter `["Optional", "k", 2]`) is filled when a call leaves its argument
out, and only then, in the interpreter and in compiled code. A call written
with fewer arguments is completed at canonicalization: its canonical form
already holds the default (`f(3)` is `f(3, 2)`). The compiler completes the
other calls at compile time (`completedLiteralArguments()`): a call of a
block-local function, an `Apply` of a literal, and a callback that its
consumer calls with fewer arguments than the literal has parameters
(`Map((x, k = 2) ↦ x k, L)`: `Map` calls the literal with one argument). Every
target does this, the shaders and interval-js included.

An absent value supplied at a defaulted position, written or computed, is
passed through as the argument. The interpreter then applies the rule of
`Missing` (`docs/ERROR-MODEL.md`): `g(First([]))` with
`g = (k: real = 2) ↦ k + 1` passes `Missing` to `g`, and the call is
`Missing`. In compiled code the value is outside the type of the parameter
(`NaN` at a `real` parameter), so the result is unspecified within the caveats
below. This reverses the "or absent" half of rule R6 of
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

Compiled code reads a symbol default by its name where it fills the default:
at the call, or in the wrapper of a callback. A local of the same name there,
or a `vars` entry that maps the name to an input, would give another value
than the constant of the declaration. So compiled code fills a symbol default
by its name only when it is a constant of the standard library (`Pi`,
`Integers`) or a symbol that the parameter type lists (`mode: symbol<Auto> |
symbol<Manual> = Auto`). It is compiled as the written symbol: a target that
cannot hold the symbol declines, as it declines the written symbol.

A default that names a constant declared by the program or the host is
filled by the value of that constant, not by its name, at each place where
compiled code fills it: a call that leaves out the argument (also a call that
writes the default's symbol at that position), a call completed at compile
time, and the wrapper of a callback or of a function literal. The value is
read at compile time from the definition that the default symbol was bound to
where the function is declared, as the interpreter reads it, so a local of
the same name or a `vars` entry does not change it
(`compiledDefaultOperand()`, `compile-parameter-defaults.ts`). With
`ce.declare('W0', { isConstant: true, value: 5 })` and
`f := (k = W0) ↦ k + 1`, the compiled `f()` is `f(5)` and gives 6, as the
interpreter does. The value must be a literal that compiled code can write: a
number, a string, `True`, `False`, a `List` or `Tuple` of such values, or
`{}`. Any other value declines: with `ce.declare('WP', { isConstant: true,
value: ce.box(['Add', 'x', 1]) })`, a call that fills `(k = WP) ↦ k`
declines. An Epsil `const` declines too: the program
`const W = 5; function f(k = W) { k + 1 }; f()`, compiled as a block, has no
value for `W` at compile time, because the declaration sets it when it runs.
To compile such a function, write the value as the default (`k = 5`), or
pass the argument.

| Input                                                     | Before 3.4.5                           | Now                                      |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `g = (k: real = 2) ↦ k + 1`, `g()`                        | `3`, completed at compile time         | `3`, unchanged                           |
| `g(At(L, 100))` with `L: list<real>`                      | `3` (the `NaN` takes the default)      | `NaN + 1`, unspecified (outside `real`)  |
| `g(x)` with `x: real` supplied as `NaN` by the host       | `3`                                    | unspecified                              |
| `Map((k = 2) ↦ k * 2, [1, 2])`                            | `[2, 4]` through a filling wrapper     | `[2, 4]`, the literal takes one argument |
| `(k = n) ↦ k` with `n` a variable                         | `n` read at the call site              | static error (the default is not constant) |
| `(k = W0) ↦ k` with `W0` declared constant                | `W0` read at the call site             | `W0` of the declaration; compiled code fills its value |
| a defaulted call on GLSL or interval-js                   | completed; interval declines a `NaN`   | completed, no decline                    |

Where a function value can be called with fewer arguments than it has
parameters, the emitted function fills each left-out argument:

- JavaScript and interval-js, a function literal compiled as a value (a
  callback that is not written out, a block-local function) or a user
  function referenced as a value (`Map(f, L)`): an outer wrapper with a
  JavaScript default parameter, `((_tv1, _tv2 = 2) => f(_tv1, _tv2))`. The
  wrapper of a user function is defined once, as `_fn_f$d`.
- JavaScript, a function literal compiled at the root of `compile()`: the
  function fills each argument that the host leaves out (`undefined`) before
  its entry checks, after the definitions of its preamble.
- Python, a function literal compiled as a value: the parameter is declared
  `k=None`, and the body runs with `d if k is None else k`, so that `[]` is a
  new list at each call.

A JavaScript default parameter also fills `undefined`, and the Python fill
fills `None`, which are the spellings of `Missing` in compiled code. The
interpreter passes such an argument to the body; the result of an operator
on an absent operand is unspecified in compiled code, so the two agree within
the caveats. A multi-clause function cannot have a default (it is a
declaration error), so the multi-clause emission never sees one.

## Collections

Compiled broadcasting preserves the interpreter's strict lifted regime.
Compiled pairing preserves shortest-input semantics. `PointList`, elementwise
selection, Map lowering/fusion, exact-map proof, and collection callbacks must
retain evaluation-once and effect ordering.

A `PointList` with list components compiles on the JavaScript target to a
map over the shortest component, scalar components repeated in each point.
An `iterationBudget` option caps that length, and the list is then truncated
(user decision 2026-07-31). This differs on purpose from a `Sum` or `Product`
over budget, which gives `NaN`: a truncated point list still draws its first
points.

A restriction `value\{conditions\}` (`If(conditions, value)`) whose
condition is a list compiles on the JavaScript target through
`_SYS.restrict`, one position for each condition (user decision
2026-09-15). A list value whose length the types give has the length of the
conditions, or the expression is a static error and declines; a list whose
length is known at run time only is aligned with the conditions and truncated
to the shorter of the two, as the interpreter aligns it. A number or a point
is one value, repeated at each position. A position whose condition is not
true holds `NaN` for a number, real or complex (a plain `NaN`, not
`{ re: NaN, im: NaN }`), and a point whose coordinates are `NaN`
(`[NaN, NaN]`) for a point (selection rule of 2026-11-02,
`docs/BROADCAST-MODEL.md`; it was `undefined`). A string under a list of
conditions is a static error and declines. A value that may be either a list
or a point at run time declines. A condition whose static type does not settle
its shape (`tensor<boolean>`) compiles; when its value is a nested list, the
compiled selection gives `NaN` where the interpreter gives an
`incompatible-type` error.

An infinite collection compiles on the JavaScript target only under a
bounding consumer: `Take`, `TakeWhile`, or `First` and `At` with a constant
positive integer index. A `Range` with an infinite literal end and a `Map`,
`Filter`, `Drop` or `Rest` pipeline over one, and an `Iterate` with a
`Drop` or `Rest` pipeline over it, lower to lazy iterators
(`_SYS.rangeIter`, `_SYS.iterateIter`, `_SYS.mapIter`, …) under that
consumer; every other consumer declines with "bound it with `Take` or
`TakeWhile`". A `Map` or a `Filter` over an `Iterate` declines: the check
of the omitted elements of the stage reads the type of the `Iterate`, a
`list` with no element type. `At` with another index declines: the
interpreter answers `Missing` for an `Iterate` and `NaN` for a `Range`
there. An `Iterate` compiles only for a sequence of real numbers with an
initial value: the initial value and the result of the function must be real
numbers that cannot be absent, so that the accumulator has one shape at every
step. The function must be pure: the interpreter computes the elements before
a position again for each read, so the effects of a function that is not pure
would run more often there than in the compiled stream. A finite
collection keeps its eager array lowering. `DropWhile` over an infinite source
declines, because the interpreter leaves it unevaluated. In
`javascript-target.ts`, `isLazyStream` decides which operands take the lazy
lowering and `emitLazyStream` writes it, so the two must accept exactly the
same shapes.

`Sort` with an ordering function compiles on the JavaScript target
(`compileJSSortWithCallback`). As in the interpreter, a function whose type
says it takes one argument is a sort key, and any other function is a
comparator. A sort key compiles when its result is a real number; a comparator
compiles when its result is a boolean or a number, and its elements are real
numbers or values that cannot be numbers. A result that can compile to a
complex value (`x ↦ √x`) declines. The compiled sort orders the positions of
the elements with `Array.prototype.sort`, as the interpreter does, so the two
routes ask the same comparisons in the same order.

`Pipe(x, stage)` compiles on the JavaScript and Python targets as the
expression that it evaluates (`pipeApplication`): a call that is missing one
argument receives `x` in the slot that the interpreter selects
(`Pipe(xs, Map(f))` is `Map(f, xs)`), a function literal with one parameter is
applied to `x`, and the name of an operator is called with `x`. A call with
its own slots is lifted to a function literal whose parameters are the slots
(`Pipe(L, Take(_, 2))` is `Apply(_1 ↦ Take(_1, 2), L)`). Any other stage
declines, and so does a call stage whose piped value is itself a `Pipe` when
the static type of the inner pipe does not settle the slot: the interpreter
selects the slot from the type of the value of the inner pipe.

Two analyses decide whether an operand can be an array at run time on the
JavaScript target, and they are separate code. The comparison and connective
lowerings ask `isPossiblyCollectionTypedJS` in `javascript-target.ts`. The
arithmetic broadcast (`Add`, `Multiply`, … through `tryCompileBroadcast`) asks
`isBoundPossiblyCollectionTyped` in `compiler-type-facts.ts`, which reads
the static type of the operand. A change to one does not change the other.

A symbol declared `any` or `value` can hold a number or a list, and compiled
code does not test the shape of a value at run time. The JavaScript, Python
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

**Calls.** A compiled call of a user function, a block-local function or a
function literal selects its code from the static types of its arguments,
and emits no run-time test of their shape (R2 in "Shapes are settled at
compile time"). With `f := t ↦ 2t`:

- An argument of a scalar type calls the scalar code: with `a: real`,
  `1 + f(a)` compiles to `_fn_f(_.a) + 1`.
- An argument of a list type, at a parameter that the body reads as a
  scalar, maps the scalar code over the levels of the list, as the
  interpreter maps it: with `L: list<real>`, `f(L)` compiles to
  `_SYS.mapFn(_fn_f, [1], _.L)`. The second operand of `_SYS.mapFn` gives,
  for each argument, the number of list levels that are mapped.
- A point (a tuple) is bound whole, as the interpreter binds it, and the
  call uses a function compiled for that point type. With
  `P: tuple<real, real>` and `g := (p, x) ↦ x + 1`, `g(P, L)` compiles to
  `_SYS.mapFn(_fn_g_tuple_real__real__number, [0, 1], _.P, _.L)`: the code
  maps over `L` and gives `P` whole to each call, so it gives `[2, 3]` for
  `L = [1, 2]`.
- A parameter whose type is a collection type (`k := (L: list<real>) ↦
  Sum(L)`) takes the list whole, with no map.

The engine types `f(L)` from the variant that the call uses, so an operator
over the call reads the shape of its value from that type: `1 + f(L)`
compiles to an element-wise sum (`_SYS.bcast`) over `_SYS.mapFn(_fn_f, [1],
_.L)`, and gives `[3, 5]` for `L = [1, 2]`.

**Callbacks.** A function given as a value to a consumer (`Map`, `Filter`,
`Reduce`, a comparator, a `PointList` role) is given as the code for the
static type of the elements of the source. With `L: list<real>`, `Map(f, L)`
gives the callback `_fn_f`. With `M: list<list<real>>`, `Map(f, M)` gives
`_fn_f$m1`, which maps the scalar code over one level, so `Map(f, M)` gives
`[[2, 4], [6]]` for `M = [[1, 2], [3]]`, as the interpreter does. A built-in
operator name is given in the same way: `Map(Sin, M)` gives `_fn_Sin$m1`. A
function whose parameter takes a collection whole is given as it is. A
source whose element type is a union of shapes
(`list<real | tuple<real, real>>`) declines with `'unsettled-shape'`.

An argument on the complex lane at a parameter read as real is given as its
real part (`_SYS.creal`): with `p` declared `(real) -> real`, `p(√y)` at
`y = 4` gives the value of `p(2)`. A function value that a consumer would
give such elements declines: with `h` declared `(real) -> real`,
`Map(h, [√y, 1])` declines.

A compiled array carries no tuple-versus-list tag, and the compiled norm of
a point reads each coordinate by its static type: a scalar as is, a `tuple`
coordinate as a nested point that contributes its magnitude, a `list` or
`broadcastable` coordinate as a broadcast source, and a coordinate typed
`unknown`, bare `tuple` or `indexed_collection` — which may hold either — as
a list, the way the compiled arithmetic reads every nested array (user ruling
2026-09-11). The one value where that differs from the interpreter is a
nested point at such a coordinate, `((1, 2), 3)` under `tuple<unknown,
number>`, which the interpreter flattens into one norm and the compiled code
broadcasts. Declining the shape instead would refuse every untyped point
parameter whose body takes a norm, the commonest shape a document function
has, and the nested point is not a value the plotting consumers produce.

The Python target maps no function over a list argument, and its arithmetic
operators do not map over a list (`2 * [[1, 2], [3, 4]]` repeats the list). It
reads a parameter that is not declared with a collection type as a scalar. So
an application of a function literal (`Apply`, `ApplyWhole`) declines when an
argument can be a collection (it is one, or its type is a collection type or a
union with one) and its parameter is not declared with a collection type: at a
scalar parameter the interpreter maps the function over the elements
(`((t) ↦ 2t)([[1, 2], [3, 4]])` is `[[2, 4], [6, 8]]`, and `((t) ↦ 1)([1, 2])`
is `[1, 1]`), and at a parameter declared `any` or `value` that the body reads
it binds the collection whole and maps each element-wise operator over it. A
callback of `Map`, `Reduce`, `Filter`, … declines for the same reason when a
parameter declared `any` or `value` that the body reads receives a value that
can be a collection: `Map((t: any) ↦ 2t, [[1, 2], [3, 4]])` declines, and the
interpreter gives `[[2, 4], [6, 8]]`. An argument of a top type (`unknown`,
`any`, `value`) is read as a scalar, as everywhere else on this target. A
parameter declared with a collection type (`list<number>`) compiles, through
the list lowerings of the body. This is the simple, sound version: a precise
one would map the lambda over the collection, or compile the body at the type
of the argument (`assertPyAppliedLiteralBindsScalars` and
`assertPyCallbackWideParams` in `python-target.ts`).

Implicit Map compilation obeys the engine-wide `jit` gate. Exact-mode Map
compilation requires an explicit proof that native-number execution preserves
the requested exact result. Structural or ABI failures are cached at the
appropriate expression-instance boundary.

### List updates in place

`xs = ReplaceAt(xs, i, v)` on a block local gives a new list. On the
JavaScript target, the block copies the list once, at the first update, and
then writes that copy in place, when no other value can hold a reference to
it (`ownedLocalUpdateChains()` in `compilation/in-place-update.ts` states the
conditions). Otherwise each update copies the list, and in a loop that visits
each element once the copies cost O(n²). The Python target always copies a
block local (ROADMAP CE-329); the step of a fold can update its accumulator in
place on both targets (`inPlaceUpdateChains()`).

When a JavaScript compilation keeps the copying form for an update
`xs = ReplaceAt(xs, …)` (a chain of `ReplaceAt` included) in the body of a
`Loop`, `CompilationResult.warnings` holds one entry for each such local of
each block: `code: 'copying-list-update'`, `kind: 'capability'`, `binding`
the name of the local, `value` the first such update as `toString()` writes
it, and a message that says the list is copied on each pass because it has
another name, is used in a way that could see a write, or is declared in the
body of an enclosing loop. A host, such as an
editor, can show it to the author: a statement `ys = xs` in the loop, a
function literal that reads `xs`, or a read of a row before a write of two
positions are typical causes. A local declared in the body of a `Loop` is
never written in place, as the body gives it a new value on each pass; an
update of it in a `Loop` nested in that body is reported. An update that is
not in a loop copies the list once and is not reported, and neither are other
targets. The warning does
not change the emitted code (`copyingUpdateInLoop()`).

### Dictionary literals

A dictionary literal compiles on the `javascript` and `python` targets, with
each value compiled: `{a -> x + 1}` is `({"a": _.x + 1})` in JavaScript and
`{"a": x + 1}` in Python. Each evaluation makes a new object, which has the
run-time form of a `dictionary` input (a plain object, a `dict`). A key is a
string literal; the JavaScript literal writes the key `__proto__` as the
computed key `["__proto__"]: v`, because the plain form `"__proto__": v` sets
the prototype of the object instead of making an own key. The shape of each
value comes from its static type: a value whose type is `unknown` or `any`
declines (a call of a block-local function has the result type of its
literal; an untyped free input is refused by the admission of the inputs,
which names it in `unsupported`; an untyped parameter or local is not an
input there, and declines here). A value whose type can be `Nothing` declines:
the interpreter keeps such an entry with the value `Nothing`, and the
compiled object has no form for it. Each value compiles as a value operand (`compileValueOperand()`), so an
assignment in a value declines on Python, as in any other operand. The
values are not operands of the node, so the shared-subexpression pass does
not enter them, but it records each assignment in them: a subexpression is
not shared across a write in a value (`recordDictionaryAssignments()` in
`cse.ts`). The interval-js and GLSL targets have no dictionary value,
and a dictionary declines on them with that reason
(`CompileTarget.dictionary`, `_compileInner()` in `compiler-core.ts`).

On the JavaScript target, a result whose static type holds a dictionary or a
record at some depth (in a union member, a tuple element or a collection
element, at every level: `typeHoldsKeyedValue()`; for a `Block` that ends
with a call of a block-local function, the result type of its literal) is
returned under `normalizeKeyedRunResult()`, not
`normalizeRunResult()`: an object of such a result with the keys `re` and
`im` is a dictionary, not a complex number, so it is returned as it is. In
a value whose type holds both a record and a complex number, a complex
cell with a zero imaginary part is then returned as `{re, im: 0}`, not as a
number. A `dictionary` or `record` input or parameter has no real or complex
entry rule (`isKeyedEntryType()` in `javascript-target.ts`).

### GPU `At`

GPU `At` preserves the engine's 1-based indexing through a guarded target
projection. A statically sized real-scalar vector/array base and a scalar index
may lower; negative indices count from the end, while zero, out-of-range,
non-integer, and missing indices project to the target's NaN value. Literal
integer gathers may fold or lower when every selected element preserves
evaluation count. A discarded impure element forbids folding.

Dynamic gathers, runtime boolean masks, point-list bases, unknown extents, and
non-real element/index shapes decline. GLSL bounds behavior is never
relied upon: the emitted helper guards before indexing. Aggregate widths and
index types are read from the GPU declaration frame when the boxed expression
itself is typed `unknown`.

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

OKLCh is the preferred internal space. Every color constructor (`Rgb`, `Hsv`,
`Hsl`, `Oklab`, `Oklch`) and every operator that produces a color (`Color`,
`Colormap`, `ColorMix`, `ContrastingColor`) answers a color in it.
`ContrastingColor` normalizes the candidate it chooses, so its value is
canonical whatever space the candidate was written in. An EXPLICIT conversion
answers a color tagged with the space it names: `AsRgb` answers `rgb`,
`AsHsv` answers `hsv`, `AsOklab` answers `oklab`.

`ColorFromColorspace(components, space)` is the other head that answers a
named space. It BUILDS a color from channel values in the space it names, and
it keeps them there: the value carries those channels and is tagged with that
space, so `ColorFromColorspace((0.5, 0.1, 20), "rgb")` is
`{space: 'rgb', c0: 0.5, c1: 0.1, c2: 20, alpha: undefined}`. That is the
color the interpreter answers — the color HEAD of the named space,
`Rgb(0.5, 0.1, 20)` here — so a caller that reads `space`, or a channel, sees
the same color on both routes. Converting to OKLCh at the operator would have
shown different numbers from the interpreter for the same expression. The
operator is declared `-> color`, so its value has the color representation by
TYPE, like every other color-valued head.

`ColorToColorspace` is the opposite direction and is NOT one of these. It
answers COMPONENTS — it is declared `-> tuple`, the interpreter evaluates it
to a `Tuple`, and consumers index the result
(`At(ColorToColorspace(c, "rgb"), 1)`) — so its compiled value is the plain
array of three channels, four with an alpha. The two are inverses:
`ColorToColorspace(ColorFromColorspace(t, s), "rgb")` answers the 0-1 sRGB
components, which is how a caller reads channel values back out of a color.

A color value whose `space` is not one of the five spellings is not a color:
the readers switch on the space, so an object tagged `srgb` reaching a helper
through `vars` throws the same `TypeError` a bare numeric array gets, naming
the offending spelling.

Every helper that CONSUMES a color reads the tag through one internal
`toOklch`, so a conversion result reaching a second color operator is
understood rather than misread. `AsRgb(AsRgb(c))` therefore equals `AsRgb(c)`
channel for channel, and `ColorDelta(AsRgb(a), b)` measures the same distance
as `ColorDelta(a, b)`. Before the tag existed these nestings answered a
different color from the interpreter, and the compiler declined them
statically; the decline is gone.

A color STRING stays a JavaScript string until a helper parses it, and a LIST
of colors is a JavaScript array of color objects or color strings. So a bare
numeric array is NEVER a color on this target: it is a list. A color helper
handed one throws a `TypeError` naming the expected shape. The static gates
refuse a literal list at a color position, so that throw is a run-time
backstop for the shapes they cannot see: a `vars` input, and a caller still
passing the pre-2026-09 array representation.

A TUPLE at a color position is COMPONENTS, and how it is read depends on
whether the compiler can see it. A tuple written LITERALLY at the call site
denotes 0-1 sRGB on every route — the color operators are declared
`(color | string | tuple, …)` and the interpreter reads such a tuple — so it
is converted here with the same conversion `Rgb(r, g, b)` takes. A tuple that
arrives any OTHER way — a tuple-typed variable, or a head that answers
components such as `ColorToColorspace` — is read at a head that TAKES
components and DECLINED at a head that consumes a color.

The heads that take components are the five `As*` conversions and
`ColorToColorspace`; they are how a caller turns components into a color, so a
tuple at their operand is legitimate input whichever way it arrives, and it is
read as 0-1 sRGB components at run time. On JavaScript the reader is
`_SYS.colorFromSrgbComponents`, which builds the color of a 3- or 4-element
numeric array — the 4th component is alpha — and throws the color-shape
`TypeError` for any other shape. On a shader the operand's compiled value is
the `vec3` of its channels and `_gpu_srgb_to_oklch` makes the canonical color
of it; a tuple whose type says it is 4 wide is declined there, because a
shader color carries no alpha. On both targets a width the type states as
anything but 3 (or 4 on JavaScript) is declined at compile time. sRGB is the
reading even where `colorSpaceOf` names another space for the channels,
because the interpreter reads every tuple at a color position as 0-1 sRGB:
`AsRgb(ColorToColorspace(c, "hsv"))` answers the hue, saturation and value
read as red, green and blue on every route. A caller who means the channels in
the space they were computed in writes `ColorFromColorspace(components,
space)`, whose own first operand is components and is unaffected by any of
this.

Every OTHER color head — `ColorMix`, `ColorDelta`, `ColorContrast`,
`ContrastingColor`, `ColorToString` — consumes a color and declines such an
operand. Its value is a bare array, which this target reads as a list and
never as a color, so passing it through emitted code that threw the
color-shape `TypeError` on every run — a compile-time-provable failure behind
`success: true`. On the shader targets the same vector was read as canonical
OKLCh, which answers a color the interpreter, which refuses such an operand,
never agrees with. Declining hands the expression back to the interpreter; the
diagnostic names `AsRgb((r, g, b))` and `ColorFromColorspace(components,
space)`, the two spellings that build a color from components.

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
  `Rgb` color to `Hsv`/`Hsl` first clips each channel into `[0, 1]`.
- A color with a `NaN` channel, or with an infinite channel that is not clamped
  (an sRGB channel, a hue, an OKLab/OKLCh channel), is `incompatible-type` on
  the interpreter. On the JavaScript target it is the same object with `NaN`
  channels, in the space the answering helper names: the numeric projection of
  that error.

The shader helpers apply the same rule. They do not clamp an sRGB channel (the
canvas clamps at output), they clamp the HSV/HSL channels, and an infinite sRGB
or OKLab channel makes `NaN` channels through the arithmetic of the conversion.

A color-VALUED expression is NOT constant-folded on this target. The
interpreter's value for a color is a typed head, whose literal emission is a
bare numeric array — a list on this target, never a color — so the color
lowering runs instead and builds the object. The test is the expression's TYPE
alone, so every color-valued expression is covered whatever head built it, and
an expression that answers components rather than a color folds like any other
tuple: `ColorToColorspace(c, s)` with `s` a symbol bound to a string folds to
the interpreter's tuple, which is the same 3-array its lowering emits.

The interpreter FALLBACK answers the same object, and CONSUMES one. A declining
color expression run under `fallback: true` comes back as
`{space, c0, c1, c2, alpha}` read off the interpreter's typed color head
(`Rgb(...)` → `rgb`, `Hsv(...)` → `hsv`, and so on), and a list of colors comes
back as an array of those objects. In the other direction, a color object a
compiled runner produced is boxed back to the head that names its space when it
is passed in as a `vars` value, recursively inside arrays, so a color can cross
from a compiled runner into a declining expression.

On the SHADER target (GLSL) a color is a bare `vec3` with no run-time
tag and no alpha, read as OKLCh unless the compiler knows otherwise. The space
is a COMPILE-TIME fact instead (`colorSpaceOf`,
`compilation/color-space-fact.ts`): the constructors and the color-producing
operators answer `oklch`, each `As*` answers the space it names, and
`ColorToColorspace(c, "<literal>")` and `ColorFromColorspace(comps,
"<literal>")` answer that literal space. A color operand whose fact is a named
space other than `oklch` is converted back to OKLCh statically, with the
`_gpu_srgb_to_oklch`, `_gpu_oklab_to_oklch`, `_gpu_hsl_to_rgb` and
`_gpu_hsv_to_rgb` helpers the preamble already carries, so no nesting has to be
declined for want of a reverse conversion.

`ColorFromColorspace` therefore emits the channels themselves, and the
conversion to OKLCh appears at its CONSUMER, the same place an `AsHsv`
operand's conversion appears. A shader whose whole expression is a
`ColorFromColorspace` gets that named space as its result; `AsOklch(...)` is
how a caller asks for the canonical one.

The fact follows a value through the shapes that FORWARD one: a block's last
statement, a return-type ascription (`Typed`, the normalized spelling of a
function literal's return type), the body of a user function the engine holds,
and the arms of a selection. `Which` and `If` answer the space their value arms
agree on.

An operand whose fact is UNKNOWN — a symbol, a `vars` input, or a user function
whose body is not visible — is read as OKLCh, which is the shader's `vec3`
color contract. Where the compiler can SEE a converted color at one of the
positions the value comes from but cannot say which position it comes from —
`Which(cond, AsRgb(x), AsHsv(y))`, whose arms name two different spaces — the
operand is DECLINED instead, because reading it as OKLCh would answer a
different color for at least one of its run-time values. A plain unknown keeps
the OKLCh reading; only a visible disagreement declines.

The space is deliberately NOT a type. There is no `color<space>` in the type
lattice: on the JavaScript target the value carries the space, on the shader
targets the compiler proves it, and the interpreter already carries it in the
color's head.

## Sums and objects

A sum with representation-disjoint variants erases tags. A sum whose variants
overlap uses tagged JavaScript objects. Other targets decline unless they gain
an equivalent representation. Mutable boxed objects do not cross into compiled
code unless a target explicitly implements identity, slots, versioning, and
effects.

## Value kinds

A value of a value kind (a residue class, an element of a finite field, a
kind declared by a host with the `arithmetic` field of an operator
definition; `TYPE-SYSTEM.md`, "Value kinds and kind types") is not a number,
and the number lowerings compute a wrong value for it with no error: `c - c`
lowered to `0`, `c / c` to `1`. So the compile boundary declines it unless
the kind type gives a lowering for the target.

The boundary uses the STRICT recognition: an expression that holds a kind
value for certain, or whose result type is a kind type for certain,
declines, with a message that names the kind type ("holds a residue class
(type 'residue')", "holds a value of the kind type 'gf8'"). An expression
that only MAY hold a kind value (a parameter typed `number | residue`, a
symbol of a signature that admits a kind) compiles as a number, as before.

The library kinds `measurement` and `quantity` have no `compile` contract,
and the library kind `enclosure` has one for the `interval-js` target only
(see "The enclosure on `interval-js`" below). So an expression with a
`Measurement` or a `Quantity` value, or with an `Enclosure` value on any
other target, declines with
the kind message ("holds a value of the kind type 'measurement'"). A
physical constant symbol (`SpeedOfLight`) is declared `value`, so the strict
recognition does not see its quantity: `x · SpeedOfLight` declines at the
`Quantity` call of its value, with the message "Could not compile
`Quantity`".

**The compile contract.** The `compile` field of an `ArithmeticDefinition`
(`ArithmeticCompile`, `types-definitions.ts`; read by
`compilation/kind-lowering.ts` and `base-compiler.ts`) has two parts:

- `compile.type` belongs to the kind TYPE, because a free symbol of the
  type has no head, and every head of the type must lower `Add`, `Multiply`
  and the other operators to one representation. Its fields: `lowered()`,
  the name of the representation on the target, which
  `freeSymbolTypes[…].lowered` reports; `add()` and `multiply()`, a sum and
  a product with an operand of the kind (a number operand beside a kind
  value is the hook's to promote); `apply()`, the other arithmetic
  operators, the comparisons and the other operators with an operand of the
  kind; `entry()`, the run-time check of a host value given for a symbol of
  the type (the JavaScript runner calls it in place of its numeric and
  collection checks); `shippable` and `hostNames`.
- `compile.value` belongs to the HEAD: the source of a literal value of that
  head in the type's representation. A literal of a head without it
  declines.

Each hook receives the `OperatorCompileContext` and branches on
`context.language`, so a target registered with
`ce.registerCompilationTarget()` is reachable. `undefined` from any hook
declines, with the message "Could not compile `<Operator>` with an operand
of the kind type '<type>'". The structural and control-flow operators (`If`,
`Block`, `List`, `Tuple`, `Assign`, `Hold`, a call of a user function) do
not call the contract: they pass the representation through as an opaque
value. With two kinds that have a contract among the operands, the kinds are
asked in the order of their first occurrence and the first answer wins, as
at evaluation.

**The representation.** The value of `run()` for a kind result is returned
as the code makes it: `normalizeRunResult()`, which reads a `{ re, im: 0 }`
record as a number, is not applied. So on the JavaScript targets a kind type
may not name, with `lowered()`, a value convention of the runner (`number`,
`real`, `integer`, `complex`, `array`, `list`, `point`, `color`): the host
would read the value as a number, a complex number or a list. Such a
contract is refused with a message that asks for a representation of its
own (an object with a field that names the kind). The representation must be
faithful (the rule of "Fail closed").

**The result.** `CompilationResult.valueKinds` lists the kind types whose
representation the code reads or makes, and `StoredEntryPlan.kinds` the
bindings of a kind type (both JavaScript only, absent when no kind is
involved). A result is `shippable` only when every contract involved says
`shippable: true`, lists no `hostNames`, and no input of the code is a kind
value: a worker cannot run the host's `entry` check, and it cannot carry
the helpers that `hostNames` would name. Such code cannot be stored and
loaded again (see "Running stored JavaScript").

**Limits.**

- An expression that holds a COLLECTION of kind values (`L + L` with
  `L: list<gf8>`, a list literal of kind values) declines on every target:
  `entry` and `lowered()` describe one value.
- On `interval-js`, the only kind with a contract is the enclosure; the
  runner checks the inputs of that kind (below). A residue class, a
  measurement and a quantity decline on every target.
- A kind is never compiled through the number rules.

The design is `docs/plans/2026-10-26-value-kinds.md`, section 4.8.

### The enclosure on `interval-js`

`Enclosure(lo, hi)`, an interval that holds one real (`TYPE-SYSTEM.md`,
"Enclosures"), is the one library kind with a compile contract
(`ENCLOSURE_COMPILE`, `library/enclosure-compile.ts`). The contract answers
for the target `interval-js` only; every other target declines with the
kind message. The design is section 4.9.2 of
`docs/plans/2026-10-26-value-kinds.md`, "Compilation".

**The representation.** An enclosure is the `{ lo, hi }` interval of the
`_IA` runtime, and `lowered()` answers `'interval'`
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

**One kernel for each form.** The hooks emit, operation by operation, the
`_IA` call that the `.N()` route of the interpreter makes for the same form
(`enclosure-arithmetic.ts`), so the compiled code and `.N()` give the same
doubles: `add`/`mul` folds, `div`, `sub`, `negate`; for a power, one kernel
for each exponent form (`square` for `2`, `sqrt` for `1/2`, `pow` for
another integer, `powRational` for a rational with an odd denominator,
`powRealBranch` or `pow` for a float exponent by the target's selection
rule, `exp` for the base `e`, `powInterval` for an exponent that is not a
point, only when the base is provably positive); a negative integer power
as `1 / x^|n|`; the step of `Round`/`Floor`/`Ceil`/`Truncate` through
`intervalRoundToStep()`; `Log(x)` with `log10`, `Log(x, 2)` with `log2`,
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
`x: enclosure`) is dispatched to the hooks as a certain one, and a free
symbol with such a type sets up the kind lowering and its entry check. A
number is a point interval on this target, so the code of a hook is valid
for it. So `Factorial(y)` with `y: real | enclosure` declines, as the
interpreter leaves `Factorial` of an enclosure unevaluated.

**The entry check of the interval runner.** For each free symbol whose type
has an `enclosure` arm (`intervalKindEntries()`,
`interval-javascript-target.ts`), `run()` checks the host value BEFORE it
converts the inputs, and OUTSIDE the `try` whose `catch` answers `entire`,
so a refused value throws. The kind's `entry` admits a record `{ lo, hi }`
of two numbers with `lo <= hi`, `±Infinity` allowed but not the same
infinity twice, no `NaN`; or a finite number. A UNION input is checked by
arm: a record by the kind's `entry`, a number by the numeric arms
(`NaN` admitted when an arm admits `nan` or `missing`, `±Infinity` when an
arm admits an infinity), so `y: number | enclosure` admits `Infinity` and
`y: enclosure | nan` admits `NaN`. `broadcast()` and `broadcastAsync()`,
which call the compiled body without the `run()` wrapper, check every cell
BEFORE the loop (outside the per-cell `try`): a cell whose two bounds are
the same value is read as that number when the type has a numeric arm, any
other cell by the kind's `entry`. One refused cell throws, or rejects the
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

**The declines.** A hook answers `undefined`, and the compilation declines
with the kind message, exactly where the interpreter leaves the call
unevaluated: an operator that is not in the `apply` table (`Factorial`),
`Gamma(s, x)` with two operands, `Log` with an enclosure base, `Round`
with an enclosure step, `Mod` with a divisor that is not a point, a power
with a base that is not provably positive and an exponent that is not a
point (`(-2)^Enclosure(1, 2)`), and an integer exponent that is not a safe
integer. `Mean`, `Sum` and `Product` decline too: the library has no kernel
for them, and their list forms decline by the collection limit.

**Accepted differences between the interpreter and the compiled code.**

1. **The identity shortcut of the six comparisons.** The interpreter
   decides a comparison of two identical operands before any hook:
   `c = c` and `c <= c` are `True`, `c < c` and `c != c` are `False`. The
   compiled code has no identity information, so `_IA.equal(c, c)` and
   `_IA.lessEqual(c, c)` are `'maybe'` for an enclosure that is not a
   point.
2. **No engine tolerance.** The interpreter compares two float points
   within the engine tolerance; the compiled comparisons compare doubles
   exactly, as the `javascript` target does for numbers. Elsewhere the
   compiled answer is the target's three-valued one: `'maybe'` where the
   interpreter stays unevaluated, `'true'` for the touching `LessEqual`
   that the interpreter answers `True` too.
3. **An angular mode other than radians.** The target scales an angle by
   the exact factor (`rewriteAngularUnit(expr, { exactFactors: true })`),
   enclosed outward, so the result contains the true value. The `.N()` route
   computes the exact product and converts it once. The endpoints of the
   two routes may differ by the rounding of the factor.
4. **A non-integer point exponent with a negative base at run time.** An
   exponent that is a free symbol of a number type (`x^n` with
   `n: integer`) lowers to `_IA.powInterval`, whose run-time point shortcut
   covers an integer and, for a negative point base, answers the symmetric
   hull over an exponent interval. At a non-integer point exponent with a
   negative base (`n: 0.5`, `x: [-8, -8]`) it answers `empty`, where the
   interpreter, which sees the value, uses the real branch.

**The limits kept from phase 1.**

- Code with an enclosure input cannot be loaded again from its stored form:
  the loaders of `createIntervalRuntime()` (`load()`, `loadBroadcast()`,
  `loadBroadcastSlice()`) refuse code that names a kind type, because the
  `entry` check is a function of the host. `shippable` is `false`
  (`ENCLOSURE_COMPILE` says so), so the kernel pool is not used and
  `willUsePool()` answers `false`.
- An input typed `list<enclosure>` declines (`entry` and `lowered()`
  describe one value).

Lifting these two limits needs a serializable entry check (ROADMAP
CE-507.12).

## CSE and naming

Common-subexpression elimination is region-based and must respect effects,
bindings, evaluation order, and target representation. Compiler-internal types
stay structurally opaque where importing boxed-expression types would create a
module cycle. The remaining CSE design work is in the active
`plans/2026-07-28-compile-cse-design.md`.

A target can set its own admission thresholds for a shared subexpression
(`CompileTarget.cseMinSize` and `cseMinScore`; the defaults are 4 and 8 in
`cse.ts`). The nested harvests of user-function bodies use the same
thresholds. The `interval-js` target sets 2 and 4, so a node of size 2 or 3 is
bound once it occurs three times: every interval operation is an allocating
`_IA` call, so the size of its syntax does not measure its cost.

## Compiler internals

A lowering that rewrites one statement into several statements must be added
to each of the four places that compile a list of statements, because none of
them goes through another:

1. `BaseCompiler.compileBlock` (`base-compiler.ts`) compiles a `Block` that is
   compiled as an expression.
2. `BaseCompiler.compileLoopBody` compiles the loop bodies of the JavaScript
   and interval targets.
3. `compilePythonStatements` (`python-target.ts`) is the Python dispatcher for
   statements.
4. `BaseCompiler.compileStatementList` compiles the loop bodies of the shader
   targets, which reach statements through the ordinary `compile` route. It
   calls `compileBlock` with the value of the last statement unused, so the
   last statement is not emitted as a `return`.

On a target with a `declare` hook (Python and the shader targets), the
`Declare` case emits only the declaration, and `compileBlock` emits the initial
value as a separate assignment. A rewrite that emits `Declare(sym, type,
value)` from one of the other places therefore loses the value on those
targets. Emit `Declare(sym, type)` and `Assign(sym, value)` as two statements.
A temporary from `BaseCompiler.tempVar` must also be registered as a local of
the statement list (`BaseCompiler.loopBodyTempTarget` does this), or it is
emitted as a read of the caller's scope object (`_.name`).

Check such a lowering on `javascript`, `python` and `glsl` by reading
`.code`: a comparison of `run()` with the interpreter checks the JavaScript
target only.
