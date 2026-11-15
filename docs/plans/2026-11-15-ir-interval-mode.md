# Interval arithmetic as a mode of the IR pipeline: design note

Status: APPROVED by the user on 2026-11-15, with the decisions listed below.
Written by session `ce-interval` on 2026-11-15 at
`52a408a81e65f6a358b71219721642211e73514b`, from the brief
`docs/scratch/2026-11-15-ir-interval-mode-handoff.md`.

User decisions of 2026-11-15, which the text below includes:

- A verdict stays a string (`'true'`, `'false'`, `'maybe'`).
- The criterion of results and the criterion of time of section 12.
- `Random()` is the interval `[0, 1]`, as on the existing target.
- A float exponent over a negative base may be wider than on the existing
  target (section 4).
- An integer that the program shows to be one number (a constant, a loop
  index, integer arithmetic on those) is a JavaScript number: the pass
  `plain` of section 5 is part of the design.

The values in the examples were measured at that commit. "Interpreter" is
`expr.subs({…}).N()` at points of the box. "Existing" is
`compile(expr, { to: 'interval-js' }).run(box)`. "Proposed" is the result of
the `_IA` kernels called in the order the mode would call them, then passed
through `freshIntervalValue()`: the mode does not exist yet, so these values
show the rule, not an implementation.

## 1. What is proposed

`compileSlice(expr, { target: 'javascript', mode: 'interval' })` compiles a
program with the lowering of the JavaScript target and prints it with a third
JavaScript syntax table, `JS_INTERVAL`, in which each IR operation is the
`_IA` kernel that encloses it. The mode is an abstract interpretation of the
same IR:

| IR                                   | JavaScript                | Interval mode                                                          |
| ------------------------------------ | ------------------------- | ---------------------------------------------------------------------- |
| a `real` or `integer` value          | a number                  | an `Interval` or an `IntervalResult`, what the `_IA` kernels take and give; a plain integer (section 5) is a number |
| a `boolean` value                    | a boolean                 | a verdict: `'true'`, `'false'` or `'maybe'`                             |
| an operation `add`, `sin`, `lt`, …   | `($0 + $1)`, `Math.sin`   | `_IA.add($0, $1)`, `_IA.sin($0)`, `_IA.less($0, $1)`                    |
| a constant                           | a number literal          | a point `{ lo: c, hi: c }`, or an enclosure of one ulp on each side (section 4) |
| `if (c) { A } else { B }`            | one arm                   | `A` unless `c` is `'false'`, `B` unless `c` is `'true'`, the hull of both for `'maybe'` |
| a counted loop                       | `for`                     | `for` over numbers: a bound that is an interval is converted, and must be a point at run time |
| a call of a user function            | a call                    | the same call, of a function printed with the same table               |

The interval library `src/compute-engine/interval/` is the runtime and gains
two functions (section 8). `to: 'interval-js'` stays the public spelling, and
the result keeps the fields and the `run()` contract of the existing target
(section 5).

The lanes are `real`, `integer` and `boolean`. A program that the mode does
not compile declines, as on the other targets of the pipeline.

Three properties come from the construction and need no code of their own:

- Every kernel accepts and gives `empty`, `entire`, `singular` and `partial`,
  so the mode never reads the kind of a value (section 7).
- A local of a `Block` is an SSA value, and an `If` that assigns it is an
  `if` instruction with one result per assigned local. The join of the two
  arms is the hull, so a local assigned in both arms has the hull of both
  values after an undecided `If`. The existing target gets this case wrong
  (section 10).
- An operation that the table does not spell declines (`admits()`).

## 2. Conditions (question 1)

A comparison is the kernel of its row (`_IA.less`, `_IA.lessEqual`,
`_IA.equal`, `_IA.notEqual`, …) and gives a verdict. `And`, `Or` and `Not`
are `_IA.and`, `_IA.or`, `_IA.not` (Kleene logic). The lowering writes the
operands of `And`, `Or` and a chain lazily, as arms; the `hoist` pass makes a
pure arm a plain `and` or `or`, and an arm that is kept is an `if` whose join
is the hull of two verdicts, which is the same truth table
(`hull('maybe', 'false')` is `'maybe'`).

`If`, `Which` and every other conditional of the lowering are the IR
instruction `if`. The mode prints it with each arm once:

```js
// If(x > 0, Sqrt(x), -x)
const c1 = _IA.less({ lo: 0, hi: 0 }, _.x);
let v5, v5_a, v5_b;
if (c1 !== 'false') {
  v5_a = _IA.sqrt(_IA.max(_.x, { lo: 0, hi: 0 })); // x narrowed, see below
}
if (c1 !== 'true') {
  v5_b = _IA.negate(_IA.min(_.x, { lo: 0, hi: 0 }));
}
v5 = c1 === 'true' ? v5_a : c1 === 'false' ? v5_b : _IA.hull(v5_a, v5_b);
```

The text is linear in the program: a nest of `If` does not double at each
level. The existing target writes the first arm twice, or calls
`_IA.piecewise` with two closures over 2,000 characters.

**The arm of a "maybe".** Both arms are evaluated, the first before the
second, and the value is `_IA.hull` of the two. An arm is not evaluated when
the condition excludes it.

**The missing arm.** `If(c, a)` and a `Which` with no `True` clause have the
constant NaN as their other arm in the IR. The mode spells a NaN constant
`{ kind: 'empty' }`, so the join is `_IA.hull(a, empty)`, which is what
`_IA.restrict` gives: `empty` for `'false'`, `partial` for `'maybe'`.

**An arm with an effect.** The only operation that is not pure and that the
mode admits is a read of the inputs object by a `vars` text (`_.c`,
`readsVarsObject()`), which Tycho's `hideValues` makes. Reading it in both
arms changes nothing. `Random()` is the constant interval `{ lo: 0, hi: 1 }`,
the support of a draw, and a `WithRandomSeed` frame is its body: no seed
narrows the support. Both are the existing target's rule (user decision,
2026-11-15), and neither draws, so two evaluated arms draw nothing. The
frames have no warning in the mode. The mode declines a `vars` text that is
not a read of the inputs object: with two arms evaluated, such a text would
run where the interpreter does not run it. A recursive user function
declines: with an undecided guard, both arms are evaluated and the recursion
does not end.

**Narrowing.** Without more, an arm guarded by its condition is evaluated
over the whole box: `If(x > 0, Sqrt(x), -x)` over `[-1, 1]` evaluates
`Sqrt([-1, 1])`, which is `partial`, and the result is `partial` although
the function has a value at every point. I propose one pass of the mode,
`narrow`: for an `if` whose condition is one comparison (`lt`, `le`, `gt`,
`ge`) of a value `v` with a constant `c`, the arm where `v ≥ c` holds reads
`_IA.max(v, c)` in place of `v`, and the arm where `v ≤ c` holds reads
`_IA.min(v, c)`. It is sound: on the arm, `v` is in the narrowed interval.
The existing target has the same rule for a symbol and a literal, on arms
that can clip only (`compileNarrowedIntervalArm` and its tables, lines 2626
to 3072 of `interval-javascript-target.ts`); the pass is an estimated 70
lines because the IR has the comparison and the arms as data.

| Program, box                                             | Interpreter                    | Existing                        | Proposed, no narrowing          | Proposed, with `narrow`      |
| -------------------------------------------------------- | ------------------------------ | ------------------------------- | ------------------------------- | ---------------------------- |
| `If(x > 0, Sqrt(x), -x)`, x in [-1, 1]                    | 0.5 at -0.5, 0.707… at 0.5     | `interval` [-1, 1]              | `partial` [-1, 1], clipped `lo` | `interval` [0, 1]            |
| the same, x in [1, 4]                                     | 1 at 1, 2 at 4                 | `interval` [1, 2]               | `interval` [1, 2]               | `interval` [1, 2]            |
| `If(x > 0, 2x)`, x in [-1, 1]                             | NaN at -0.5, 1 at 0.5          | `partial` [-2, 2]               | `partial` [-2, 2]               | `partial` [0, 2] (not run)   |
| `If(x > 0, Ln(x), 0)`, x in [-1, 1]                       | 0 at -0.5, -0.69… at 0.5       | `partial` [-∞, 0], clipped `lo` | `partial` [-∞, 0], clipped `lo` | `partial` [-∞, 0], clipped `lo` |
| `Which(x < 0, -1, x < 1, x^2, True, 2)`, x in [-0.5, 0.5] | -1 at -0.25, 0.0625 at 0.25    | `interval` [-1, 0.25]           | `interval` [-1, 0.25]           | not run                      |
| `x < 1`, x in [0, 2]                                      | `True` at 0.5, `False` at 1.5  | `'maybe'`                       | `'maybe'`                       |                              |
| `And(x > 0, 1/x > 2)`, x in [-2, -1]                      | `False` at -1.5                | `'false'`                       | `'false'`                       |                              |
| the same, x in [-1, 1]                                    | `False` at -0.5, `True` at 0.25 | `'maybe'`                      | `'maybe'`                       |                              |
| `Or(Not(x < 1), y < 0)`, x in [0, 0.5], y in [1, 2]       | `False`                        | `'false'`                       | `'false'`                       |                              |
| `If(x > 0, Random(), 0)`, x in [-1, 1]                    | a draw or 0                    | `interval` [0, 1]               | `interval` [0, 1] (not run)     |                              |

`Ln(x)` with `x` narrowed to `[0, 1]` is still `partial`: 0 is not in the
domain. That is the kernel's answer and the existing target gives the same.

## 3. Passes (question 2)

| Pass        | In the mode | Reason                                                                                                                                                         |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scalarize` | off         | It runs only for a target with no element-wise operation. It is sound (one operation per element is the meaning).                                             |
| `fold`      | off         | It computes with doubles, and a double result is not an enclosure of the real value. The lowering has already folded every closed sub-expression (section 4). The same switch as in the `bigint` mode. |
| `strength`  | off         | Sound and wider: it writes `x^2` as `x·x`, and the product of two intervals does not know that its operands are one value.                                    |
| `hoist`     | on          | Sound: every kernel is total (it gives `empty` or `singular`, it does not throw), so an operand evaluated outside its arm cannot fail. Same tightness: `_IA.and(c, y)` and the join of the arm have one truth table. |
| `cse`       | on          | Sound, same tightness: it reads a value that is already computed. No kernel writes to an operand.                                                             |
| `dce`       | on          | Sound.                                                                                                                                                         |
| `narrow`    | on (new)    | Section 2. It runs first, in the mode only.                                                                                                                    |
| `plain`     | on (new)    | Section 5. It runs last, in the mode only: it changes the representation of a value, not its value.                                                            |

| Program, box            | Interpreter                 | Existing           | Proposed           | With `strength` on |
| ----------------------- | --------------------------- | ------------------ | ------------------ | ------------------ |
| `x^2`, x in [-1, 2]      | 1 at -1, 0 at 0, 4 at 2     | `interval` [0, 4]  | `interval` [0, 4]  | `interval` [-2, 4] |
| `x^3 - x`, x in [-1, 1]  | 0 at -1, -0.375 at 0.5, 0 at 1 | `interval` [-2, 2] | `interval` [-2, 2] |                 |
| `x/49`, x in [49, 49]    | 1                           | `interval` [1, 1]  | `interval` [1, 1]  |                    |

`x^3 - x` shows the limit that no pass of this note removes: `[-2, 2]` holds
the range `[-0.385, 0.385]`, and the host subdivides. The rewrites of the
lowering are kept: a product with a rational `p/q` is `(p·factors)/q`
(`div.q` is `_IA.div`), and the factor of an angular unit is a product.

## 4. Constants and powers

Two rules that the questions do not name and that soundness needs.

**A constant that is not a double.** The kernels round outward, so that a
result encloses the real value. The lowering gives `Pi`, `1/3`, `Sqrt(2)` or
a folded `Sin(1)` as the double nearest to the value, which is not the value:
the interpreter's `Pi` is `3.14159265358979323846` at the default precision,
and the point `[Math.PI, Math.PI]` does not hold it. In the mode, a real
literal carries a mark `inexact` unless the lowering proves that the double
is the number (an integer, or a literal whose exact value is a double:
`exactDoubleValue()` of `numeric-value/exact-integer-value.ts`, which the
existing target's `literalHasNoDoubleValue()` calls), and the table spells a
marked literal as the
enclosure of one ulp on each side. The enclosure is in the emitted text, so
it costs nothing at run time. `0.5` stays a point, so `Floor(0.5·x)` at
`x = 4` is 2 and not a jump.

| Program | Interpreter                 | Existing                                     | Proposed                                     |
| ------- | --------------------------- | -------------------------------------------- | -------------------------------------------- |
| `5`     | 5                           | [5, 5]                                       | [5, 5]                                       |
| `Pi`    | 3.14159265358979323846      | [3.1415926535897927, 3.1415926535897936]     | [3.1415926535897927, 3.1415926535897936]     |
| `1/3`   | 0.333333333333333333333     | [0.33333333333333326, 0.33333333333333337]   | [0.33333333333333326, 0.33333333333333337]   |

**`Power`.** `_IA.powInterval(base, exponent)` gives the integer power when
the exponent is a point that is an integer (`[-1, 2]^2` is `[0, 4]`), and for
an exponent that is not a point it encloses the real roots of a negative base
by the symmetric hull `[-M, M]`. For a point exponent that is not an integer
it gives `empty` over a negative base, where the interpreter can give a real
root: `x^0.2` at -8 is -1.5157…, because the interpreter reads the float as
`1/5`. So `pow` is spelled as a new kernel `_IA.powReal`: `powInterval` with
an exponent that is a point and not an integer widened by one ulp on each
side. That is sound for every reading of the exponent and has no table of
exponent forms. One exponent is not widened: a double that is `k/1024` for
an integer `k` (`1.5`, `2.5`, `0.75`). The interpreter reads a float as a
rational `p/q` only within about 10⁻¹⁴ of it and for `q` under about
3·10⁵ (`realPowerBranchTerms()`), and no rational of odd denominator is
that close to `k/1024`, so a negative base has no real value there and the
result is `empty`, as on the existing target. The exponent 2 is
`_IA.square` (section 12a).

A literal rational exponent `p/q` is lowered, in the mode, as the integer
power `p` of the root of degree `q`, the composition that `_IA.powRational`
is made of. Both operations exist as rows (`Root`, `Power`), and `_IA.pow`
and `_IA.nthRootInterval` give the tight result for an integer.

| Program, box                 | Interpreter                 | Existing                               | Proposed                              |
| ---------------------------- | --------------------------- | -------------------------------------- | ------------------------------------- |
| `x^(1/3)`, x in [-8, -1]      | -2 at -8, -1 at -1          | [-2, -1] (canonical `Root(x, 3)`)      | [-2, -1] (`Root`, `nthRootInterval`)  |
| `x^(2/3)`, x in [-8, -1]      | 4 at -8, 1 at -1            | [1, 4] (`powRational`)                 | [1, 4] with the root rule (not run); [-4.000000000000002, 4.000000000000002] without it |
| `x^0.2`, x in [-8, -1]        | -1.5157… at -8, -1 at -1    | [-1.5157165665103987, -1]              | [-1.5157165665103984, 1.5157165665103984] |
| `x^0.2`, x in [1, 8]          | 1 at 1, 1.5157… at 8        | [1, 1.5157165665103987]                | [0.9999999999999999, 1.5157165665103984] |
| `x^2.5`, x in [-8, -1]        | not real                    | `empty`                                | `empty`                               |
| `x^-2`, x in [-1, 8]          | 1 at -1, 0.015625 at 8      | `singular` (a pole)                    | `singular`                            |
| `x^n`, x in [-2, 3], n = 2    | 4 at -2, 9 at 3             | [0, 9]                                 | [0, 9]                                |

The float exponent over a negative base is the one case of this note where
the mode is known to be wider than the existing target by more than an ulp.

## 5. The result contract (question 3)

**Who makes each kind.**

| Kind       | Made by                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interval` | the kernels; `freshIntervalValue()` for a bare `{ lo, hi }` at the exit (a constant, an input)                                                                  |
| `empty`    | the kernels outside a domain (`Ln([-2, -1])`); the NaN constant of the lowering (a missing arm, a closed value that is not real); `freshIntervalValue()` for an enclosure with a NaN bound |
| `partial`  | the kernels at the edge of a domain (`Ln([-1, 1])`); `_IA.hull` of a value and `empty` (a one-armed `If` whose condition is `'maybe'`)                           |
| `singular` | the kernels: a pole (`1/[-1, 1]`, `Tan([1, 2])`) or a jump with its enclosure (section 7); `_IA.hull` and every kernel carry it on                               |
| `entire`   | the kernels where no bound exists; the runner, for any error of the code other than a `ReferenceError` or a cancellation (`createIntervalRuntime().load()`)     |

The mode makes no kind itself. `run()` is the function that
`createIntervalRuntime().load()` builds from the stored result, so `run()`
and stored code loaded on a worker agree by construction, as the JavaScript
adapter does with `load()` of `createJavaScriptRuntime()`. The runner of the
existing target (`ComputeEngineIntervalFunction`) is not used.

**What `run()` takes.** The inputs object, with for each input an interval
`{ lo, hi }`, or a number, which `processInput()` makes a point; for a
boolean input a boolean or a verdict string. A root `Function` literal is
`calling: 'lambda'` and takes its arguments, each converted the same way
(`runIntervalLambda()`). The result is a kinded `IntervalResult` for a
number, a verdict string for a boolean, never a bare `{ lo, hi }`
(`docs/COMPILATION-MODEL.md`, "Interval results"). `broadcast()` and
`broadcastAsync()` are `broadcastIntervals()` and `makeBroadcastAsync()` over
the raw call, as today.

**An integer is an interval, or a number where the program shows it.** An
integer that can depend on a box is an interval: `Floor(x)`, an integer
input (the host may give it an interval), and everything computed from
them. An integer that cannot is one number, and computing it with kernels
costs 33 ns for a sum where a number costs 8 ns with the point made from
it (section 12). The pass `plain` of the mode settles which, by structure
and with no analysis of ranges:

- A value is a plain integer when it is an integer constant, the index of a
  loop, or the sum, difference, negation or product (`add.int`, `sub.int`,
  `neg.int`, `mul.int`) of plain integers. The pass keeps a bound of the
  magnitude of each: the constant itself, 2^32 for an index, the sum or the
  product of the bounds for an operation. A value whose bound reaches 2^53
  is not plain, so a plain integer is always an exact double.
- A plain integer is a JavaScript number, and its operations take the
  spellings of the JavaScript table (`($0 + $1)`).
- Where an interval operation reads a plain integer, the pass adds the
  operation `point` (`{ lo: n, hi: n }`). Where a loop reads an interval as
  a bound, it adds the operation `number`, the new kernel `_IA.number(x)`:
  the number of a point, and a throw of the library's
  `UndecidedConditionError` for anything else or for a magnitude over 2^32,
  which `run()` and `broadcast()` already answer with `entire`.

So the bounds and the index of every loop are numbers, the representation
of each value is settled at compile time, and no code tests one. Every other
integer operation (`Mod`, `Power`, a comparison, `Max`) reads points.

| Program, box                                     | Interpreter               | Existing                      | Proposed                                  |
| ------------------------------------------------ | ------------------------- | ----------------------------- | ----------------------------------------- |
| `Sum(Sin(k·x), k = 1..3)`, x in [0, 0.1]          | 0 at 0, 0.594… at 0.1     | [0, 0.5940229541032293]       | [0, 0.5940229541032293]                   |
| `Sum(x^k, k = 1..n)`, x in [0, 0.5], n = 3        | 0.875 at 0.5              | [0, 0.875]                    | [0, 0.875]: `_IA.number(n)` is 3 (run by hand, section 12) |
| `Sum(Sin((2k+1)x)/(2k+1), k = 0..9)`              |                           | 6,472 ns per call             | 3,034 ns per call: `2k+1` is a number (section 12) |
| the same, n in [2, 4]                             | 0.75 at n = 2, 0.9375 at n = 4 | `entire`                 | `entire`: `_IA.number(n)` throws          |
| `g(x) + g(-x)`, `g(t) := t^2 + 1`, x in [-1, 2]   | 4 at -1, 10 at 2          | [2, 10]                       | [2, 10]                                   |
| `x`, x in [1, 2]                                  | 1.5 at 1.5                | `interval` [1, 2]             | `interval` [1, 2]                         |

**The options.** Tycho's `hideValues`, `scalarInputs` and `byReference` are
not options of CE: `resolveCECompile()` (`~/dev/tycho/src/plot-core/ce-module-registry.ts`)
turns them into CE's `inputs` and `vars`.

| Tycho option   | CE option that the mode sees                          | In the mode                                                                                         |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scalarInputs` | `inputs: { k: 'real' }` (or the declared subtype)     | An input of that type, as on JavaScript. A number given for it is a point. Nothing else distinguishes a slider from an axis: both are intervals. |
| `hideValues`   | `vars: { c: '_.c' }`                                  | A read of the inputs object at each use, never folded. Another text declines.                       |
| `byReference`  | `inputs: { S: <the type of S> }`                      | An input of that type. A list type declines in the first version (section 6).                       |

The other options of `compile()`: `iterationBudget` (a `Sum` or a `Product`
of more passes than the budget throws `UndecidedConditionError` before its
first pass and is `entire`, the documented rule: the lowering writes no NaN
test in the mode, because NaN reads as `empty`, "no value"; when `Loop` is
admitted, each of its passes calls `_IA.countLoopPass(n)`, which throws the
cancellation, as today);
`cse: false` and `constantFold: false` as on JavaScript; `symbolic`,
`symbolDeps`, `varsObjectRefs` as on JavaScript; `mode` other than
`'strict'`, `functions`, `operators`, `imports`, `preamble` and
`strictTypes: true` decline; `entryChecks`, `storage` and `broadcast` have no
effect (the runner converts every input and checks none, as today).

**Selection.** While the mode is built:
`compile(expr, { to: 'interval-js', profile: 'ir' })` compiles with it, and a
decline is `'outside-profile'`; with `fallback`, the existing target then
compiles the expression, as for GLSL. The census switches
(`CE_JS_PROFILE_SHADOW=ir`, `CE_JS_PROFILE_PUBLIC=ir`) get the interval
calls. At the end the mode is the implementation, and a decline falls back
to the interpreter as today.

## 6. Scope of the first version (question 4)

Proposed, and to be confirmed by the measure of step 2, which is not run
(it needs the switch, which is code):

- **Lanes:** real, integer, boolean.
- **Constructs:** the scalar rows of `OPERATORS` that `_IA` has a kernel
  for, about 70 of them: arithmetic, `Power`, `Root`, `Sqrt`, `Exp`, the
  logarithms, the trigonometric and hyperbolic functions and their inverses,
  `Abs`, `Floor`, `Ceil`, `Round`, `Truncate`, `Fract`, `Mod`, `Sign`, `Max`,
  `Min` of scalars, `Hypot`, `Arctan2`, `Erf`, `Erfc`, `Gamma`, `GammaLn`,
  `Factorial`, `Factorial2`, `Binomial`, `GCD`, `LCM`; the comparisons,
  `And`, `Or`, `Not`; `If`, `Which`; `Block` with locals; user functions that
  are not recursive; `Apply` of a literal; `Sum` and `Product` with `Limits`;
  a root `Function` literal; `Random()` and a `WithRandomSeed` frame of a
  number seed.
- **Declines:** lists, tuples and points (every shape of rank 1 or more);
  complex and colour values; `Random` of a domain, a string seed (the
  lowering declines both); `Integrate`; a recursive function; a `Loop` (its source is a list, or a `Range`, whose
  count `rangecount` has no kernel); an input of a value kind (`enclosure`);
  `Zeta` and `Haversine` (no kernel).
- **Not a decline:** a loop bound that is an interval is `entire` at run
  time (section 5). A compile-time decline is not possible without losing
  `Sum(…, k = 1..n)` of a slider `n`, because a slider and an axis have the
  same type.

What the existing target compiles and the first version does not, to be
ranked by the measure: collections (lists, ranges, `Map`, element-wise
operations, points, `At`, `Length`, reductions of lists), `Integrate`
(`_IA.integrate`), a seeded `RandomChoice`, `Loop` with `Break`, `Reduce`, `Match`, `Clamp`,
`Heaviside`, `Sinc`, the Fresnel integrals, `Remainder`, `Chop`, `Coalesce`
and `IsMissing`, the `functions` option, and the `Enclosure` value kind. The
operators among them are rows of `OPERATORS` to add, with a spelling in the
mode. Lists are the largest item: the IR has them (element-wise operations,
`build`, `filter`, reductions), and the mode needs their spellings and
`_IA.number()` at each index.

The suite has 205 test files that name `interval-js` (1,195 lines). Those
that pin the emitted text of the existing target will change at the switch;
their count is not measured.

## 7. The discontinuous operators (question 5)

Each kernel reports the discontinuity itself, and every kernel is exported
through `liftJump`, which carries a jump of an operand to the result. The
mode calls kernels only, so it passes the report through with no code. The
join of an `if` is `_IA.hull`, which is `unionResults()` and keeps a pole or
the earliest jump. A comparison reads the enclosure of a jump and gives
`'maybe'` when it must.

| Operator                 | Kernel          | Report                                                              | Example, box              | Interpreter          | Existing and proposed (the same kernel call)                   |
| ------------------------ | --------------- | ------------------------------------------------------------------- | ------------------------- | -------------------- | -------------------------------------------------------------- |
| `Floor`                  | `_IA.floor`     | `singular` with `value`, `at`, `continuity: 'right'`                | x in [0.5, 1.5]           | 0 at 0.5, 1 at 1.5   | `singular`, at 1, right, value [0, 1]                          |
| `Ceil`                   | `_IA.ceil`      | the same, `continuity: 'left'`                                      | x in [0.5, 1.5]           | 1, 2                 | `singular`, at 1, left, value [1, 2]                           |
| `Round`                  | `_IA.round`     | a jump at each half-integer                                         | x in [0.2, 0.8]           | 0, 1                 | `singular`, at 0.5, right, value [0, 1]                        |
| `Mod`                    | `_IA.mod`       | a jump at each multiple of the modulus                              | `Mod(x, 2)`, x in [1.5, 2.5] | 1.5, 0.5          | `singular`, at 2, right, value [0, 2]                          |
| `Fract`                  | `_IA.fract`     | a jump at each integer                                              | x in [0.5, 1.5]           | 0.5, 0.5             | `singular`, at 1, right, value [0, 1]                          |
| `Sign`                   | `_IA.sign`      | a jump at 0, no side                                                | x in [-1, 1]              | -1, 1                | `singular`, at 0, value [-1, 1]                                |
| a division across 0      | `_IA.div`       | `singular` with no value (a pole); `partial` when 0 is an end       | `1/x`, x in [-1, 1]       | -2 at -0.5, 2 at 0.5 | `singular`                                                     |
| `Tan`                    | `_IA.tan`       | `singular` with `at`                                                | x in [1, 2]               | 1.557…, -2.185…      | `singular`, at 1.5707963267948966                              |
| a jump under arithmetic  | `liftJump`      | the jump of the operand, with the enclosure of the result           | `2·Floor(x) + 1`, x in [0.5, 1.5] | 1, 3         | `singular`, at 1, right, value [1, 3]                          |
| a jump under a comparison | `_IA.less`     | the verdict of the enclosure                                        | `Floor(x) > 0`, x in [0.5, 1.5] | `False`, `True` | `'maybe'`                                                      |

`Truncate` is `_IA.trunc`, and `Cot`, `Sec`, `Csc`, `Coth`, `Csch` have
kernels that report their poles. `Round` reads the engine's tie rule as on
JavaScript: the row declines when `roundingTies` is not the default.

`_IA.number()` is the one place where the mode needs a point: a jump or a
pole as a loop bound throws, and the result is `entire`.

## 8. Size (question 6)

Estimates, in lines.

| File                                   | New or changed | Lines | Holds                                                                                                             |
| -------------------------------------- | -------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `ir/print-interval.ts`                 | new            | 190   | `JS_INTERVAL`: the spellings, the constant, the three-way `if`, the loop; `printInterval()`: the stored code and `run()` through `createIntervalRuntime().load()` |
| `ir/adapter-interval.ts`               | new            | 170   | the options, the declines, the result of `compile()` (`broadcast`, `broadcastAsync`, `booleanInputs`, `shippable`) |
| `ir/narrow.ts`                         | new            | 70    | the pass `narrow`                                                                                                 |
| `ir/plain.ts`                          | new            | 100   | the pass `plain` (section 5), with the rows of its operations                                                     |
| `ir/print.ts`                          | changed        | 20    | an optional member of `Syntax` for an `if` with a join; absent, the text is what it is today                       |
| `ir/index.ts`                          | changed        | 25    | `mode: 'interval'`: its lanes, its passes, its table, its printer                                                 |
| `ir/lower.ts`, `ir/lower-lists.ts`     | changed        | 25    | the mark of a literal that is not a double; the root rule of a rational exponent; no NaN test of the budget        |
| `ir/ir.ts`                             | changed        | 5     | `Literal.inexact`, and its place in the key of a constant                                                         |
| Sum in `ir/`                           |                | 605   | the pipeline goes from 7,482 to about 8,090 lines; the brief planned 400 to 600 for the mode                       |
| `interval/` (the runtime)              | changed        | 40    | `_IA.number`, `_IA.powReal`; `INTERVAL_RUNTIME_VERSION` changes                                                    |
| `compile-expression.ts`, `js-profile-switch.ts` | changed | 30   | the dispatch of `to: 'interval-js'` with the profile; the interval calls in the census                             |

Batch 1 as written (2026-11-15, before review) adds 566 lines under `ir/`
(`print-interval.ts` 204, `adapter-interval.ts` 153, `index.ts` 91,
`lower.ts` 90, `ir.ts` 22, `passes.ts` 6), where this table gave about 400
for the same content: the estimates above are low by about 40%. With
`narrow`, `plain`, the `if` and the loops of batch 2, the mode is likely
about 850 lines, and the pipeline about 8,350.

Every change of a shared file is behind `mode === 'interval'` or an optional
member that the JavaScript and GLSL tables do not define, so the emitted
code of the other targets and modes is the same bytes. A test checks that on
the programs of the `ir-` tests.

Later batches add spellings and rows (lists: an estimate of 100 to 150
lines). At the deletion of `interval-javascript-target.ts` (7,741 lines) the
interpreter fallback of the target (`buildIntervalFallback()`,
`toIntervalValue()`, `collapseIntervalInput()`, `booleanFallbackInputs()`,
about 300 lines, an estimate from their line ranges) moves to a file that
stays.

Tests: `test/compute-engine/ir-interval-*.test.ts`. Each batch has the
containment test of the brief (random boxes, random points of each box, the
interpreter's value inside the result, or no real value where the result is
`empty`), the comparison of width with the existing target (reported), and
the three robustness tests.

## 9. What differs from the existing target

Known before any measure:

1. A float exponent that is not an integer over a negative base is the
   symmetric hull (section 4).
2. A `WithRandomSeed` frame with a string seed declines (the lowering has no
   string); the existing target compiles it.
3. A sum with constant bounds is a loop; the existing target writes it out
   term by term. The bounds can differ in the last digits, because the loop
   adds in another order (section 12).
4. Constants are written at each use as object literals; the existing target
   binds each to a name evaluated once. `_IA.scale` and `_IA.square`, which
   the existing target chooses for a constant factor and an exponent 2, are
   not chosen. The effect on the time per call is not measured: the measure
   of step 2 compares the time per call on Tycho's programs, and a loss is
   reported before any switch.
5. Narrowing applies to every arm that reads the compared value, not only to
   an arm that can clip, and to any value, not only to a symbol:
   `If(x > 0, Sqrt(x), -x)` over `[-1, 1]` is `[0, 1]`, the existing target
   gives `[-1, 1]`.

## 10. A defect of the existing target, found while probing

`Block(Declare(t, real, 0), If(x > 0, Assign(t, 2x), Assign(t, -1)), t)`
over x in [-1, 1]: the interpreter gives -1 at x = -0.5 and 1 at x = 0.5.
The existing target gives `interval` [-1, -1], which excludes 1. Its code
evaluates both arms in turn for an undecided condition, and each arm writes
the local, so the local keeps the value of the second arm:

```js
let t = _k1;
(… : _IA.hull(((_tv1) => t = _IA.scale(_k2, _tv1))(_IA.max(_.x, _k1)), t = _k3));
return t
```

The mode gives `[-1, 2]` with `narrow` (`[-2, 2]` without), from the join of
the `if`. No issue in `issues/` or `issues/CLOSED.md` names it. I could not
tell a `plausible` witness from a `crafted` one, so it is a line marked
`plausible?` in the known-limitations list of `docs/COMPILATION-MODEL.md`.

## 11. Choices, each with its alternative

1. **Integers.** DECIDED 2026-11-15: an interval, except a plain integer,
   which is a number (the pass `plain`, section 5). The first draft had one
   representation (every integer an interval, converted where JavaScript
   needs a number): simpler by about 100 lines, and 48% slower than the
   existing target on a sum whose term computes with its index.
2. **`narrow` in the batch of the conditions.** Alternative: no narrowing,
   70 lines fewer; a guarded arm then reports `partial` where the function
   has a value everywhere. Recommended: `narrow`, unless the measure shows
   no program of Tycho's corpus where it changes a kind.
3. **Effects in the mode.** DECIDED 2026-11-15: `Random()` is the constant
   interval `[0, 1]` and a frame is its body, as on the existing target. A
   `vars` text other than a read of the inputs object declines.
4. **`fold` off and marked constants.** Alternative: point constants at the
   double, which the `fold` pass could then fold; the result can miss the
   real value by half an ulp, and a comparison at a constant can be decided
   wrongly. Recommended: enclosures.
5. **The root rule for a rational exponent, and the widened exponent for a
   float.** Alternative: the existing target's selection of a kernel per
   exponent form (`powRational`, `powRealBranch`, with the interpreter's
   reading of a float as a rational), which is tight for a float exponent
   over a negative base: the `Power` and `Root` handlers of the existing
   target (lines 3585 to 3683) and `negativeBaseFloatPower()` of
   `compile-real-analysis.ts`, a file of the shared layer.
   DECIDED 2026-11-15: the simple rule; the float case is recorded as a
   known limitation with `x^0.2` over a negative box.
6. **A recursive function declines.** Alternative: compile it; an undecided
   guard then recurses until the stack ends, and the runner answers
   `entire`. Recommended: decline.
7. **During the work the mode is behind `profile: 'ir'`**, and the public
   `to: 'interval-js'` is the existing target until the measure of Tycho's
   corpus passes.

## 12. Timings, and the two criteria

Measured on 2026-11-15 with hand-written code in the form the mode would
print, against the stored result of the existing target, both loaded with
`createIntervalRuntime().load()`, 64 boxes, median of 7 rounds of 300,000
calls. The machine was loaded (another session held the box lock), so only
the ratios within one run mean something.

| Program                                    | Existing | Mode form | Same result as existing (of 64 boxes)                       |
| ------------------------------------------ | -------- | --------- | ----------------------------------------------------------- |
| `x^3 - 2x + y/3`                            | 1,046 ns | 1,109 ns  | 64                                                          |
| `If(x > 0, Sqrt(x), -x)`, both arms narrowed | 1,143 ns | 1,285 ns  | 54; the other 10 are tighter (`[0, 0.6]` for `[-0.1, 0.6]`) |
| `Sum(x^k, k = 1..n)`, n = 6                 | 1,202 ns | 1,210 ns  | 64                                                          |
| `Sum(Sin((2k+1)x)/(2k+1), k = 0..9)`, the index an interval | 6,472 ns | 9,551 ns | 0; the bounds differ in the last digits (the order of the additions) |
| the same, the index and `2k+1` as numbers   | 6,472 ns | 3,034 ns  | 0, the same reason                                          |

One call of a kernel costs 20 ns (`negate`) to 120 ns (`less`); `add` 36,
`mul` and `scale` 58 and 56, `div` and `scaleDiv` 63 and 59, `pow(x, 3)` 88,
`powInterval(x, [3, 3])` 103. A sum of two integers as numbers, with the
point made from it, costs 8 ns; as `_IA.add` of two points, 33 ns. So the
time of a program is the number of kernel calls, and naming the constants
once gains nothing (1,168 ns against 1,109 ns for the first program). Why
the existing target's written-out sum is slower than a loop of the same 40
kernel calls is not explained; it was not profiled.

The representation of a verdict has no measurable effect:
`And(x < 1, 0 < y)` followed by a three-way test takes 20.2 ns with the
strings and 21.3 ns with `true`, `false` and `undefined`, the logic being
the same.

**Criterion of results** (decided 2026-11-15). The brief says that the
existing target's output is not a reference. On every program of Tycho's
corpus and of CE's interval tests, at random boxes, the mode's result (1)
contains the interpreter's values, and (2) has the kind of the existing
target's result and bounds that are equal within 4 ulps, or tighter. Each
program that fails (2) is listed with both results, and the user accepts
the difference or the batch gets a handler. Identical bits are not a
criterion: a sum added in another order differs in the last digit.

**Criterion of time** (decided 2026-11-15). On Tycho's interval programs,
the time per call of `run()` and per cell of `broadcast()` has a median no
higher than the existing target's and no program above 1.1 times; a batch
that fails is not switched on. The reference is the existing interval
target, `interval-javascript-target.ts`, the code that Tycho runs today.
The `numeric-kernel` profile is not a reference: it is one of the two
earlier attempts at a JavaScript compiler, it never compiled for
`interval-js`, and it is being removed (user decision of 2026-11-15,
`docs/plans/2026-11-09-js-compiler-status-and-plan.md`). The mode is a mode
of the pipeline that replaces it, the profile `'ir'`.

Two spellings of that pipeline's JavaScript printer are measured slow in
the status document, and the mode does not take them: the deadline check
on every pass of a loop (`_SYS.tick()`; the interval runtime has no
deadline), and a list built with `Array.from({ length }, fn)`, which the
batch of the lists must not use.

With the criterion of time, a sum whose term computes with its index fails
when every integer is an interval (the fourth row). The pass `plain` of
section 5 is the answer (the fifth row).

## 12a. Measure of step 2: Tycho's core corpus

From session `tycho-desk`, 2026-11-15: every distinct interval compilation
of Tycho's codegen audit over its 115 core documents, at CE 0.192.0
(`~/dev/compute-engine-recovery/interval-dump/tycho-interval-js-core-0.192.0.json`;
the run over all Desmos states is pending). 61 documents have interval
calls: 206 distinct records, 263 calls. The existing target compiles 196 of
the 206.

By the constructs in the expression itself (the bodies of the document
functions that it calls are not in the dump, so each count is an upper
bound for its batch):

| Class                                                        | Records | Of which call a document function |
| ------------------------------------------------------------ | ------- | --------------------------------- |
| Batch 1: arithmetic, elementary functions, comparisons        | 164     | 62                                |
| Batch 2: `Which`, `If`, `Sum`, `Block` with locals            | 18      | 13                                |
| Lists: `At` (19 records), `List`, `Range`, a list input       | 20      | 4                                 |
| `Loop` with a `Break` under an `If` (an escape-time iteration) | 2       |                                   |
| `Mandelbrot` with a complex operand (the existing target declines) | 2   |                                   |

What it changes or confirms:

- **`x^2`.** `Power` has the literal exponent 2 in 2,425 places, 3 in 5,
  `2/3` in 2 (`|x|^(2/3) + |y|^(2/3) - 1`), a float in 1
  (`blackhole(x, y, a)^0.6`), and a computed exponent in about 10. The mode
  spells the exponent 2 as `_IA.square` (52 ns against 103 ns for
  `powInterval`): added to batch 1.
- **The pass `plain` has a corpus witness**: `showcase/fourier-harmonics` is
  `Sum(Sin(x(2k - 1))/(2k - 1), k = 1..Floor(n))`. Two other sums pass the
  index to a document function or to `Log`.
- **Options.** Every call passes `iterationBudget` (1,000,000) and
  `symbolic`; 73 records pass `vars`, and each of its 279 texts is the read
  `_.<name>` of the inputs object; 60 pass `inputs`, of type `real` (98
  names) or a list (`list<real>`, `vector<real^1024>`,
  `vector<integer^90001>`: 14 names). No call passes `functions`,
  `constantFold` or `mode`.
- **Lists are mostly `At`**: of a name with a constant index (17 places),
  of a list literal with a computed index (7), of a name with a computed
  index (4, the large vectors), of the result of a document function (4).
  The batch of the lists starts with `At` (`_IA.at`) and list inputs.
- **`Loop` with `Break`** (2 records, `showcase/burning-ship` is one) stays
  a decline of the pipeline, which has no early exit: to be listed at
  Tycho's audit as a program that the existing target compiles and the mode
  does not.

**All Desmos states** (`tycho-interval-js-all-states-0.192.0.json` in the
same folder, 2026-11-15): 5,230 distinct records from 6,496 calls in 533
documents; the existing target compiles 5,159. By the constructs in the
expression, with the same caveat for document functions:

| Class                                                   | Records | Share | Existing target compiles |
| ------------------------------------------------------- | ------- | ----- | ------------------------ |
| Batch 1 (arithmetic, functions, comparisons)             | 4,516   | 86.3% | 4,498                    |
| Batch 2 (`Which` 233, `If` 172, `Sum` 126, `Block` 72)   | 457     | 8.7%  | 435                      |
| Lists (`At` 105, `List` 39, points, list inputs)         | 171     | 3.3%  | 154                      |
| `Integrate` (58), `D`, `Derivative`, `Apply` of a literal | 77      | 1.5%  | 70                       |
| `Loop` with `Break`                                      | 2       |       | 2                        |
| Complex                                                  | 7       |       | 0                        |

- `ElementMax` (659 records) and `ElementMin` (66) have scalar operands
  in all but 5 records: they are the row `emax`, in batch 1.
- Exponents of `Power`: 2 in 11,653 places, 3 in 1,345, another integer in
  453, a name in 255, a computed value in 898, a float in 184 (`3.87` and
  `0.2583…` 40 each, `2.2` 15), a rational in 66 (`3/2`, `5/2`, `7/2`,
  `9/2`, and `2/3` in 7). So an integer exponent other than 2 needs
  `_IA.pow(x, n)` for the criterion of time (batch 2), and the float
  exponents are frequent enough that the wider result over a negative base
  will show in Tycho's audit: `x^3.87` is `empty` there on the existing
  target and a symmetric hull in the mode. The remedy, if the audit lists
  them: for a literal float exponent, ask the interpreter's reader
  (`realPowerBranchTerms()`) at compile time, and widen only when it reads
  a rational of odd denominator.
- Options: as in the core corpus. Every `vars` text (298) is `_.<name>`;
  `inputs` are `real` (1,466 names) or lists (233 names in 31 records).
- `At` is of a list literal in most places (1,352 of about 1,500).

## 12b. Measure of step 2: the interval compilations of CE's suite

Run on 2026-11-15 at `a56ceaa265cbd9e3aeb66af8ba46b5cc3742b192` in a
worktree, with temporary instrumentation that did not land
(`_TASKS/2026-11-15-interval-mode/census-instrumentation.patch`): each
`compile()` for `interval-js` in the 204 test files that name the target
was also lowered by the pipeline as a JavaScript program, and the outcome
and the shape of the program were recorded
(`ce-suite-interval-census.jsonl` and `census-report.py` in the same
folder). 203 files ran; `ce-595-cse-conditional-arm-time.test.ts` ended
with a worker out of memory under the measure and is not counted. This
predicts what the mode can admit; it does not run the mode.

2,049 compilations, 1,695 distinct programs. The existing target compiles
1,236 of them:

| Of the 1,236                                                     | Programs |
| ---------------------------------------------------------------- | -------- |
| In the scope of batch 1                                           | 298      |
| In the scope of batch 2 (an `if`, a loop, `Random`)               | 151      |
| Lowered by the pipeline, outside the first version                | 269      |
| Declined by the pipeline's own lowering                           | 518      |

The 269: lists (210), a `build` region (74, a `Map` or a comprehension),
an integral (20), a `vars` text (15), `Zeta` (5), a complex value (10),
recursion (1); a program can be in two groups.

The 518, by the cause of the decline: a function value or a local function
(86), the `Enclosure` value kind (81), an input of a union or wide type
(67), `Break`, `Return`, `Continue` (28), rounding with a step,
`Floor(x, n)` (27), arms of two types (26), `Missing` and the absence
operators (26), `RandomChoice` and seeds (21), `Linspace` (17), a name whose
value is not a number or a list (16), an operator with no row (16: `Chop`,
`Clamp`, `Heaviside`, `Sinc`, the Fresnel integrals, `Remainder`, `D`, …),
an option that the pipeline declines (14), recursion with no declared
result (8), complex (8), other (77).

What it says: the suite's interval programs are mostly written to pin the
existing target's handling of lists, absence, the enclosure kind and
control flow. After batches 1 and 2 the mode would admit 449 of the 1,236
(36%); Tycho's corpus, the yardstick, is at 182 of 206 by the same reading
(section 12a). The tests of the other 787 programs pin the existing
target's results, and at the switch each of them either gets the mode's
coverage, or becomes a test of the interpreter fallback, or goes. That
count is the cost of the last step of the brief ("CE's suite is green,
the target is deleted"), and most of it is outside what Tycho compiles.

## 13. Open, not for this approval

- The `Enclosure` value kind compiles on `interval-js` only, through the
  shared layer of the old compilers. The mode declines it. Before the
  deletion, either the mode gets it or its compile contract goes.
- `IntervalJavaScriptTarget` is exported from `src/compute-engine.ts`. Its
  deletion is a breaking change of the public API.
- A message to `ce-compiler` before batch 1, naming the shared files and
  functions of section 8.

## 14. Next steps after approval

1. Step 2 of the brief: the interval calls in the shadow measure of CE's
   suite; a request to `tycho-desk` for its audit of the interval seam
   (calls admitted, decline causes with one program each, containment
   against the existing target and the scalar compiler, time per call).
2. Batch 1: scalar arithmetic and the elementary functions of real inputs,
   constants, `Power`, the result contract and the adapter. WRITTEN,
   reviewed and staged on 2026-11-15: 15,366 containment checks against the
   interpreter (2 within the 2-ulp slack), five pinned exceptions against
   the existing target (`x^0.2` and `x^0.6` over a negative base, `x^(3/2)`
   5 ulps wider, a decimal equal to the double of e, and `Mod(1, 1/10) + x`,
   where the existing target reports a jump that is not there), a median
   time ratio of 1.00 to 1.01 over seven programs with `x^3` at 1.08 to
   1.15 until batch 2; the full suite passes on it. The census switch for
   the interval calls is not in it: it goes on top of `ce-compiler`'s
   removal of the `numeric-kernel` profile, which rewrites the same lines.
3. Batch 2: conditions, `narrow`, `Block` locals, user functions, `Sum` and
   `Product` with the pass `plain`, `Random`. WRITTEN and reviewed on
   2026-11-15, with the census consumer `interval:public` of the shadow
   measure and of the public switch. What it settled beyond this note:
   - `narrow` clamps with two kernels made for it, `_IA.atLeast(v, c)` and
     `_IA.atMost(v, c)`, which return `v` itself when nothing changes (every
     decided condition). With the full `max` and `min` kernels the median
     time ratio was 1.02 to 1.03; with the clamps it is 0.99 and 0.98 over
     seven programs. `And(x > 0, 1/x > 2)` measured 1.08 and 1.11 under
     load, and 420 ns against 407 ns in isolation: one clamp that the
     existing target does not make.
   - A loop over the budget, or of more than 2^32 passes, throws through
     `_IA.undecided(message)`; the lowering gets no budget in the mode.
   - Any plain exponent, a loop index included, is `_IA.pow(x, n)`.
   - A plain constant is a second literal marked `plain`, printed as a
     number; a product of two indexes is not plain (2^32 · 2^32).
   - 19,279 containment checks (2 within the slack, both of batch 1). New
     pinned exceptions against the existing target: the local assigned in
     both arms (section 10), and two sums whose bounds differ by more than
     4 ulps near 0 because the loop adds in another order
     (`Sum(Sin(k·x), k = 1..3)`, `Sum((-1)^k·x^k/k, k = 1..6)`).
   - Size: 404 lines added under `ir/` (`plain.ts` 168, `narrow.ts` 98);
     the mode is about 1,000 lines.
   - The census of CE's suite with the mode itself (the shadow measure on
     the full suite at `b33abda07` plus the batch, no test failure): 2,435
     interval compilations, of which the existing target compiles 1,923;
     the mode admits 928 of those (48.3%), declines 995 and fails on none,
     and admits 18 that the existing target declines. The most frequent
     declines: a list (247), the step of a `Range` (59), the `Enclosure`
     kind (53), `Break` (20).
4. Then what the measure ranks first.
