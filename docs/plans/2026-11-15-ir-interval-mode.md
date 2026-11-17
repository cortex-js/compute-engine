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
  target (section 4). Batch 4 removed the need for it: a float exponent is
  now read as the interpreter reads it (section 4, "Since batch 4").
- An integer that the program shows to be one number (a constant, a loop
  index, integer arithmetic on those) is a JavaScript number: the pass
  `plain` of section 5 is part of the design.
- The mode compiles `Integrate` before the existing target is deleted
  (batch 6, section 17). A `Loop`, a `Break`, a recursive function and the
  `Enclosure` kind stay declines.
- A decimal literal is the point at its double (approved 2026-11-15, after
  batch 4; section 4, "Since batch 4").
- A sum is added from the lower bound up (2026-11-15, reversing the
  approval of the same day to add a sum of constant bounds from the upper
  bound down, as the existing target does): an ascending loop of
  outward-rounded additions contains the value that the scalar code
  computes by adding upward in doubles; the descending order is narrower
  and misses that value at some points (section 17, batch 7). Tycho's
  Fourier sum stays an exception against the existing target.
- `x^a` with an exponent known at run time keeps the interpreter's reading
  of a point exponent, and its time above the criterion is accepted
  (2026-11-15): 1.16 with `a` fixed at 0.2, 1.36 with a point `a` that
  changes at every call. The existing target does not read the exponent
  and answers `empty` at `x = -8`, `a = 0.2`, where the interpreter and the
  JavaScript code give -1.5157.

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

**Since batch 4** (section 17), two rules of this section are replaced.

A number that is not exact (a decimal, a machine number) is the point at its
double: `1.8` is `[1.8, 1.8]`. Only an exact number with no double value
(`1/3`, a radical), `Pi` and a folded closed node keep an enclosure. This is
the caveat "the precision of the target" of compiled code: the existing
target and the JavaScript code read the double too. Its cost, pinned by a
test: at `x` equal to the double of 1.8, `Ceil(x - 1.8)` is 0 in the mode, on
the existing target, in the JavaScript code and in the interpreter at machine
precision, and 1 in the interpreter at the default precision, which subtracts
the decimal 1.8 and gets 4.4·10⁻¹⁷.

A float exponent `e` that is not an integer is read as the interpreter reads
it (`realPowerBranchTerms()`): at the compilation for a literal, in the
kernel `_IA.powReal(x, e, digits)` for an exponent known at run time, with
the digits of the compiling engine written in the code. A reading `p/q` of
odd `q` over a base that can be negative is `_IA.powRealBranch(x, e, p odd)`,
the real root with its sign and the magnitude `|x|^e` of the double, as the
interpreter at machine precision and the JavaScript code compute it. Every
other float, and every float over a base that the lowering proves
non-negative from its operations (`nonnegative()`: `Abs`, an even power,
`exp`), is the principal power `_IA.pow(x, e)`, with no real value over a
negative base. The widening and the `k/1024` rule are gone. An exact
rational literal keeps root then integer power. The existing target computes
`x^(p/q)` with `_IA.powRational` when `p/q` is the double: `x^2.2` at 32 is
exactly `[2048, 2048]` there, and `Math.pow(32, 2.2)` is
`2048.0000000000014`; the mode contains the latter, and such programs are in
the test's list of exceptions against the existing target.

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

1. A float exponent that is not an integer over a negative base was the
   symmetric hull (section 4) until batch 4. Since batch 4 the mode computes
   `|x|^e` with the double `e` where the existing target computes
   `x^(p/q)`, and it reads an exponent known at run time, which the existing
   target does not.
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
6. **A recursive function declines.** (Reversed by the user on 2026-11-16:
   section 18.3.) Alternative: compile it; an undecided
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
- The closed form of an integral (batch 6) calls `closedFormIntegral()` of
  `compilation/compile-integrals.ts`, a file of the shared layer of the old
  compilers, through one function of `compilation/interval-quadrature.ts`.
  Before that layer is deleted, the symbolic step moves to a module of its
  own: `compile-integrals.ts` lines 40 to 280 (the degree-mode refusal, the
  budgets, the timeout records and their key), `shadowedOperandSymbols()`,
  `closedFormIntegral()` without its `vars` test, and the four
  `antiderivative*` counters and the `ANTIDERIVATIVE_*` constants of
  `compiler-state.ts`; about 500 lines, imported by 8 source files and 9
  test files. A move with no change of behavior, reviewed on its own.
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
4. Then what the measure ranks first: lists (section 15), then integrals.
   A packed build of batch 2 (`2f6274edecb93fee440093a969125e7e56da704f`)
   went to `tycho-desk` on 2026-11-15 for its audit of the interval seam.

## 15. Lists (batch 3)

Lists are the first decline of both corpora: 171 of Tycho's 5,230 records
(`At` in 105, most of them of a list literal with a constant or a computed
index), and 247 of the 995 declines of the mode in CE's suite, with 59 more
for the step of a `Range`. The IR has lists (README, "Lists" and "Tuples");
the mode needs their representation and spellings. The rules:

- **Representation.** A list or a tuple is a JavaScript array of the
  values of the mode (intervals, verdicts, or arrays for rank 2), as on the
  existing target. `run()` already converts an array input element by
  element (`processInput()`) and wraps an array result element by element
  (`freshIntervalValue()`). A list input is listed in `listInputs`, which
  `broadcast()` reads as the inputs that every cell shares.
- **A length is a plain integer**: a number, with the bound 2^32 of an
  index (`plain`). So a reduction (`Sum(L)`, `Max(L)`) is a loop over
  number indexes, and `elem`, the read of an element at an index in range,
  is `$0[$1]` of a plain index. An index that is an interval goes through
  `number`.
- **`At`** is `_IA.at(list, index)`: the kernel is the interval extension
  of the interpreter's rule. The index is an interval, so the result is
  the hull of the elements that its integers select, `partial` when some
  select nothing, `empty` when none does.
- **Element-wise operations** are the `map` of the table: the kernel of
  the operation at each index.
- **Regions.** `build` (a `Map`, a comprehension, the elements of a
  `Range`) is a loop that fills an array. `filter` keeps an element when
  its verdict is `'true'`, drops it for `'false'`, and for `'maybe'` the
  length of the result is not one number: it throws through
  `_IA.undecided`, and the result is `entire`. The count of a `Range` is
  the engine's `rangeCount()` on numbers (operands that are intervals go
  through `number`).
- **Soundness of a length.** Every list of the mode has one length at run
  time, known as a number: a list whose length would depend on the box
  (a filter, a range bound) is `entire`, never a list of a guessed length.
- **Declines stay declines**: what the pipeline declines for JavaScript
  (a list of complex numbers, a write to a list local, `At` of a nested
  list out of range, a comprehension of several clauses), and a `Loop`.

Not in this batch: `Integrate` (58 of Tycho's records), a seeded
`RandomChoice`, `Linspace`.

WRITTEN and reviewed on 2026-11-15. What it settled beyond these rules: a
`Range` of an operand of a real type declines; the emitted code copies no
result (`run()` copies, and no kernel writes to an operand); a comparison
of two plain integers is computed on numbers; `At` with a constant index in
range of a stated length is an `elem`; the `iterationBudget` does not count
the elements of a list, as on the JavaScript target, and a list of 2^32
elements or more is `entire`. 13,487 containment checks, element by
element, none within the slack; no exception against the existing target.
Time, six list programs: median ratio 1.00; `Max(List(x, y, x·y))` is at
1.20, because the lowering folds over the list where the existing target
writes two `max` calls (`Max(x, y, x·y)` of scalars is the same two
calls). 163 lines added under `ir/`. The census of CE's suite (the shadow
measure on the full suite at `d6667422d` plus the batch, no test failure):
the mode admits 1,222 of the 1,974 interval compilations that the existing
target compiles (61.9%, from 48.3% after batch 2), fails on none, and
admits 41 that the existing target declines.

## 16. Tycho's audit of batches 1 and 2

From session `tycho-desk`, 2026-11-15, on a packed build of
`2f6274edecb93fee440093a969125e7e56da704f`, over all Desmos states, with the
document functions live (records in
`~/dev/compute-engine-recovery/interval-dump/`: `t1-declines.json`,
`t1-exceptions.json`, `t1-misses.json`, `t1-times.json`).

**Admitted.** 4,607 of 5,230 distinct calls (88%); 623 declined. 475 of the
declines are Tycho's own `compile` handlers on `Which` (348) and `At` (127),
which the pipeline does not call ("the definition of Which has its own
lowering"). That decline is a user decision of 2026-11-14 (the status
document of the JavaScript compiler: no hook in the new compiler; a host
rewrites the MathJSON before it compiles; a definition with a host handler
declines until the host removes it), so these calls are Tycho's row MK,
not a change of the mode. On `interval-js` the `Which` handler returns
`undefined`, and the `At` handler only rewrites the index to the Desmos
rule (`At(L, Max(Floor(i + 2ε·Max(1, |i|)), 0))`), which the mode compiles
when Tycho writes it in the MathJSON. The others: lists (about 34), a
document function whose body is a list (20), `Integrate` (43), `Choose`
(7), `Break` (5), an `If` with arms of two types (5), `Apply` of a
`Derivative` (5), and a few operators with no row.

**Results.** 4,598 programs at 12 boxes each (55,176 boxes), each box
checked at 6 points against the scalar JavaScript code (330,640 points). No
miss is new in the mode: 59 points in 3 programs miss on both interval
targets (`GCD` with a zero operand, `issues/CE-1341.md`, now with a corpus
witness; `100/M` with `M = [0, 0]`; `Arccos` outside its domain, where the
scalar code continues into the complex numbers). Against the existing
target, by box: equal within 4 ulps 51,045; wider 3,304; shifted 224;
tighter 203; a change of kind about 390; a change of verdict 14. The
classes, with the fix where there is one:

- A decimal literal (`y - 1.8`): the mode enclosed it by one ulp, the
  existing target reads it as its double. This is most of the wider boxes
  (1,529 of the 2,339 sampled are wider by less than 10⁻⁹ of the width),
  and at a point box the mode gave an interval of a few ulps where the
  existing target gives a point. CHOICE: a decimal literal is a point at
  its double, as on the existing target and in the JavaScript code (the
  caveat "the precision of the target"). The alternative is the enclosure:
  rigorous against the interpreter's decimal, and the cause of these
  differences. `Pi`, `1/3` and a folded closed node keep their enclosure,
  as on the existing target.
- A float exponent (`x^3.87`, `x^0.0333…`, `x^2.2`): `empty → interval`
  (119 boxes), `partial → interval`, `interval → singular`. Fix: the
  interpreter's reading of the float (`realPowerBranchTerms()`) decides, at
  compile time for a literal and in the kernel for a run-time exponent.
- `partial ↔ singular` (about 190 boxes in three documents): the literal
  again. Tycho compiles at `ce.precision = 'machine'`, where a literal is a
  machine number, and the mode enclosed every such literal that is not an
  integer by one ulp, `0.5` included, which is a double. So
  `0.5·Sin(2x) + 0.5` reached `-1.7·10⁻¹⁶`, and `1/f` had a pole inside
  its operand (`singular`, where the existing target gives the half-line
  `[1, +∞]` as `partial`), and `Sqrt(f)` had a domain clip (`partial`,
  where the existing target keeps the jump of a `Mod` as `singular`). The
  one `false → maybe` has the same cause. Fixed by the choice above.
- `singular → entire` (9, `neyret/pmciiapek6`): `1/N · Sum(…, i = 1..N)`
  over a box where `N` is not one integer. The mode answers `entire` for
  the loop bound (section 14, batch 2); the existing target answers
  `singular` for the pole of `1/N`. Both say that the box has no enclosure.
  An exception that stays.
- `maybe → false` (1): the mode is tighter. In the arm `0 < x` the pass
  `narrow` clamps `x`, so `Floor(x)` is 0 and the value is negative.
- `true → maybe` (12): `Equal(x, x)`, which the existing target folds.
- `interval → partial` (35): one case is Tycho's test
  `contradicted-partial.test.ts`, a two-clause `cases` whose second clause
  is `Arccos(2x)`; to reproduce.

**Time.** `run()`: median ratio 0.988; `broadcast()`, per cell: 1.038,
above the criterion. The programs above 1.1 are 994 for `run()` and 1,753
for `broadcast()`, with a sample of 600 calls per round (476 programs are
below 0.9 too, so part of it is noise). What is not noise: 334 programs
that the existing target compiles to a constant (a comparison that it can
decide at compile time, `(…)^2 < 0`), median ratio 2.4; a few programs of
document functions at 3 to 10 times (`neyret/sc3azg0frd`), not explained
yet; and the per-cell cost of `broadcast()`. Fixes: a decided comparison is
a constant; constants are named once per artifact.

**Tycho's tests** with only the interval seam switched: 32 failures
against 30. The two new ones: the `contradicted-partial` case above, and
`compiled-iteration-budget.test.ts`, where a `Loop` whose values are not
read is removed by the pipeline and so counts no pass (a rule of the
pipeline, README "Effects"; the existing target and the interpreter stop
at the budget).

## 17. The batches after the audit

Two batches, from section 16. Each has the tests and the measures of the
earlier ones, and ends with a build for Tycho's audit.

**Batch 4, results.**

1. A decimal literal is a point at its double (section 16). The mark
   `inexact` stays for a number with no double value that the engine holds
   exactly (`1/3`, `Pi`, a radical) and for a folded closed node.
2. `_IA.powReal(x, e, digits)`: for an exponent that is a point and not an
   integer, the kernel asks the interpreter's reader of a float exponent
   (`realPowerBranchTerms()`, with the digits recorded at the compilation,
   as the JavaScript code records `reconstructionDigits`). A rational of
   odd denominator: `_IA.powRealBranch`, the real root with its sign, as
   the interpreter computes it. Anything else: `_IA.powInterval` with the
   point, so a negative base has no value (`empty`), as the interpreter
   gives a complex number. This replaces the widening of the exponent and
   its `k/1024` exception, for a literal and for a run-time exponent. A
   literal rational stays root then integer power.
3. `Binomial` and `Choose` of real operands (`_IA.binomial`), which the
   existing target compiles.
4. `issues/CE-1341.md`: `GCD` with a zero operand, in the interval library.
5. Tycho's guard case: `Which(x ≥ 0.5, 0, True, Arccos(2x))` over
   `[0.49, 0.51]` at machine precision must be `interval`.
6. The kind changes `partial ↔ singular` and `singular → entire` of the
   audit, from the definitions in `t1-document-definitions.json`: the cause
   of each, a fix where it is simple and sound, a line in the report
   otherwise.

**Batch 5, time.**

1. A comparison that the engine decides for every value of its inputs is a
   constant verdict (`(…)^2 < 0`, `Equal(x, x)`), by the rule the existing
   target uses: 334 of Tycho's programs are constants there.
2. Values that depend on no input are computed once per artifact, in
   `preambleOnce`: a constant, a pure operation or a list of such values,
   and a call of a pure user function of such values (wrapped, so that a
   refusal of a loop makes the value `entire` and not a failure of the
   load). This names each constant once (the per-cell time of
   `broadcast()`) and computes `b(3π)` once (`neyret/ielrzhke1a`, 3.6 times
   slower today).
3. `cse` merges two calls of one pure function with the same arguments, on
   every target of the pipeline (agreed with `ce-compiler`; `passes.ts`):
   `neyret/sc3azg0frd`, whose functions call each other five times with one
   argument, is 9.8 times slower today. Not merged: a function that draws,
   has an effect or is on a cycle, and a call whose value is not visible
   (an arm, a loop body).

**Batches 4 and 5, as written.** Batch 4 has the five items above, with
the float exponent as section 4 ("Since batch 4") states it. Batch 5a: a
pure node whose type is the value `true` or `false` is that verdict (the
existing target's rule, `booleanClaim()`), and a decided condition takes its
arm in the lowering; all 152 constant verdicts of the existing target on
Tycho's programs are the same in the mode. Values that read no input are
computed once: a constant read at each call and a pure operation or list of
such values when the code is loaded (`preambleOnce`); an operation that can
fail and a call of a function with no effect, not on a cycle, at a top
level that runs at every call, at the first call under a flag
(`preamblePerCall`), so that `compile()` and a load run no loop of the
program; a failure there is thrown again at each call, which answers
`entire`. Batch 5b is item 3.

Measure of batch 4 on the exception records of Tycho's audit that can be
replayed (2,328 of 3,000; `_TASKS/2026-11-15-interval-mode/`,
`replay-t1-exceptions.mts`), class against the existing target before and
after: equal within 4 ulps 0 and 1,850; tighter 142 and 286; wider 1,786
and 127; shifted 109 and 5; a change of kind 289 and 59; a change of
verdict 2 and 1. Batches 5a and 5b change no class. What is left: 112
wider boxes of one document, a sum of 100 terms that the loop adds in
another order (batch 7, below); 54 `singular → partial`, where the pass `narrow` clamps `x` in
the arm of `If(0 < x, …)` and the mode has a value where the existing
target reports a pole; the 5 `singular → entire` of section 16.

Measure of batch 5a, time against the existing target (5,000 `run()` calls
and 5,120 `broadcast()` cells per program): 209 programs that the existing
target folds to a constant, median 8.47 before and 0.64 after per call,
17.4 and 0.90 per cell; 188 other programs that the audit had above 1.1,
1.19 and 1.02 per call, 1.19 and 1.05 per cell, with 45 still above 1.1
(32 of the first 60 looked at are float or run-time exponents, measured
before batch 4). Batch 5b: `neyret/sc3azg0frd` from 7.0 to 1.07.

Above the criterion of time after batch 4: `x^a` with an exponent that
changes at every call, 1.36 (the mode reads the exponent, the existing
target does not), and with `a` fixed at 0.2, 1.16 (the mode computes the
real root over a negative base, where the existing target gives `empty`).

**Batch 7: the order of a sum stays, and a reduction of a literal list.**
The 112 wider boxes are `2/π · Sum(sin(i·x)/i, i = 1..100) + 3`
(`neyret/0jqrzf0b8u`): the class of section 9, item 3, at 100 terms.
Measured: the kernels are not the cause (`_IA.scale` and `_IA.scaleDiv`
take a point and give what `_IA.mul` and `_IA.div` give; a rewrite to them
changed one record and was dropped). The cause is the order: each
`_IA.add` is rounded outward by an ulp of its result, the loop adds from
the first term, and the existing target writes a sum of constant bounds
out as `add(t1, add(t2, …))`, which adds from the last. `Sum(x/i, i =
1..100)` at `x = -1.62` has the width 1.78·10⁻¹³ in the mode and
3.91·10⁻¹⁴ there. A loop from the upper bound down for a `Sum` with two
constant bounds was written and reviewed: it brings the wider records of
the replay from 127 to 13. It was NOT landed, by user decision: the
descending sum encloses the exact sum but not always the value that the
scalar JavaScript code and the interpreter at machine precision compute
by adding upward in doubles. On 100,000 random points, with the kernels,
`Sum(sin(i·x)/i, i = 1..100)` misses that value at 169 points (worst by 5
ulps) and `Sum(x^i/i, i = 1..20)` at 700 (worst by 4 ulps), and the
existing target has the same misses; the ascending loop contains it by
construction. So the sums stay exceptions against the existing target
(wider by about 10⁻¹⁴ relative), and a test pins a point where the mode
contains the interpreter's value and the existing target does not. The
experiments are patches in `_TASKS/2026-11-15-interval-mode/`
(`b7-*.patch`). What batch 7 lands: a reduction (`Sum`, `Max`, `Min`) of
one literal `List` of numbers is the reduction of its elements, with no
array, on every target (`Max(List(x, y, x·y))` from 1.04 to 0.89 of the
existing target's time; `Sum(List(x, y, x·y))` is at 1.11, the addition
of the identity, kept so that `Sum(List(-0))` is the interpreter's `+0` on
JavaScript). Committed `b5fb3e563cc86de269edff6837b7b32df4359b05`.

**Batch 6, integrals** (user decision; 43 of Tycho's programs).

The lowering already makes the region `integrate` (`integral()` in
`lower.ts`); the mode has no spelling of it. The existing target's rule
(`compileIntervalIntegrate()`) has two parts:

1. The enclosure `_IA.integrate(f, lo, hi, n)`: a partition of `n` pieces,
   `n` from the budget of integrand evaluations and the count and depth of
   the integrals in the expression tree (`integrateStats()`), a decline
   when `n` would be under 4; an integral that a function call hides is
   bounded at run time by the library. The mode takes this rule as it is,
   with the same `n`, so that the bounds are the existing target's.
2. The closed form: when the engine finds an antiderivative, the existing
   target emits it under `_IA.integrateClosed`, which returns it only when
   a scan of the integrand finds no pole. It is tighter than the
   enclosure. Batch 6 first measures, on Tycho's programs and on the
   suite's, how many integrals have a closed form there and how much wider
   the enclosure alone is; the closed form is added if that measure shows
   boxes outside the criterion of results.

**Batch 6, as written** (`3592da6cbad8f3c51dd3c7208ad9689466c804a8`; batches
4 and 5 are `7af390c0d3162980ceea5e59f1b5feb6e9292bc2`). The sizing moved to
`compilation/interval-quadrature.ts`, which both targets call; the lowering
carries the count on the instruction. The measure asked for the closed
form: of the 8 Tycho records that could be rebuilt and compile, 3 use it on
the existing target, and without it a Gaussian from `-oo` to `x` was
`entire` on 12 of 12 boxes and `∫ 0.1·√(t² + 1) dt` wider by a width ratio
of about 5,000. With it, 7 of the 8 are equal on all 12 boxes. The closed
form calls `closedFormIntegral()` of the shared layer through
`integralClosedForm()` (section 13 records the move that the deletion of
that layer needs). It is not used with an angular unit other than radians,
nor when the operands reach an `NIntegrate`, directly or through a
definition; one that the lowering declines (`FresnelS`, `SinIntegral`: no
row) leaves the enclosure. A part of the integrand that does not read the
variable and is made of pure library operators is computed before the
region. Still declined: several `Limits`, an integrand of several
variables, an integrand that reads a `vars` entry. An indefinite integral
over an undeclared name compiles (its closed form types the name by use,
as `x^3/3` written directly), where the existing target refuses it: the
two programs by which the shadow measure's count of "declined by the
existing target, admitted by the mode" exceeds the run before (27 against
25). Issues filed with these batches: CE-1346 (the interpreter's
`Choose(x, 2)` just above 1) and CE-1347 (the interval library answers
`empty` for an integral whose bound ranges over a box that reaches below
the domain of the integrand, on both targets); CE-1341 is closed.

## 18. The sweep of the whole corpus, and what is slower than the existing target

Tycho's second audit was stopped by the user (a 3-hour run on a build with
a known slowdown). In its place `tycho-desk` made a dump of every document
with its definitions (`~/dev/compute-engine-recovery/interval-dump/`,
`t12-interval-js-document-definitions.json`: 532 documents, 5,155 distinct
programs; `t12-javascript-glsl-document-definitions.json` for the other
seams), and the measures are made on the CE side:
`_TASKS/2026-11-15-interval-mode/sweep-t12.mts` rebuilds each document's
engine and, per program, records the admission or the cause of the decline,
the class of the result against the existing target at six boxes sampled
inside the declared types of the inputs, the containment of the scalar
JavaScript value at three points per box, and the time per `run()` call.
About 160 s on one core, under the box lock. It is run before every commit
of this workstream; `one.mts` beside it shows one program with both codes.

On main `641dbcc11aad526d1569b61fe46189031852acae` (batches 1 to 7; before
the loop-invariant pass):

- Admission: the existing target compiles 4,828 programs in the replay
  engine (the others call operators of Tycho's that the replay does not
  have); the mode admits 4,763; both 4,748. The existing target compiles and
  the mode declines 80: a symbol that holds a value that is not a number or
  a list (16), a recursive function (17), a function whose result is a list
  (15), a list passed to a function of a scalar (13), `Break` (5),
  `Apply(Derivative…)` (3). The mode admits and the existing target
  declines 15.
- Results, 28,488 boxes: equal within 4 ulps 28,055; tighter 259; wider 144
  (sums added in loop order, section 17); `singular → partial` 15 (the pass
  `narrow`); `partial → interval` 4; `empty → entire` 6 (one program, an
  artefact of the sweep's inputs); 5 others.
- Containment of the scalar value: 65,585 points, 50 misses in 6 programs,
  the same 50 on the existing target.
- Time: median ratio 0.981; 349 programs above 1.1, 50 above 1.5, 9 above
  3, 7 above 10.

The causes of the programs above 1.5, read in the emitted code. Each is a
thing the existing compilers do and the pipeline does not:

1. No loop-invariant motion: `showcase/voronoi-diagram` at 55 to 63 (its
   functions call each other inside sums of 16 terms), and on JavaScript
   `neyret/51a4237846` at 1,356. A pass `invariants` in `ir/passes.ts` is
   written (not landed when this was written): voronoi from 40.8 ms to 4.2
   ms per call (existing 0.8 ms), on JavaScript from 0.43 ms to 0.054 ms
   (existing 0.013 ms).
2. An invariant inside a called function: `n(x, y, k)` calls `F(x, y)` and
   is called 16 times by each of four functions (what is left of voronoi,
   5.8; `showcase/exoplanet-transit`, 1.8). The existing compilers inline
   user functions.
3. A sub-expression shared by the arms of nested conditionals is lowered
   again in each arm: four programs of `showcase/joukowsky-airfoil` at 14 to
   20 (58,000 characters of code against 3,300). The existing target names
   it once before the conditionals.
4. A region over constants (a `PointX` of a literal list of points, built
   element by element) is rebuilt at each call: `neyret/ac6kkpwrep` at 17,
   `neyret/nbbj88wunw` at 186 (there the existing target also decides the
   comparison `0 ≤ Min(squares)` after it folded the list, and emits
   `'true'`).
5. In a sum of constant bounds the parts that read only the index are
   computed at each pass, where the existing target writes the sum out with
   constants: `neyret/ielrzhke1a` 1.5, `neyret/0jqrzf0b8u` 2.3.

Items 1 to 3 are in the shared pipeline and slow JavaScript too
(`ce-compiler`'s replay of the same dump: 299 of 8,826 JavaScript programs
above 1.5, 28 above 10).

### 18.1 After the loop-invariant pass: the programs above 1.1, by cause

The pass `invariants` is on main (`6711724add10a79533ab5055e90ee351e4127c88`).
The sweep on it: no program changes admission or the class of a result; time
median 0.976; 36 programs above 1.5 (50). The sweep's own timings are noisy
when the machine is loaded (three programs that looked 1.8 to 2.5 times
slower were equal when timed alone), so every program above 1.08 was timed
again under the box lock with interleaved runs of both targets, and both
emitted codes were saved
(`_TASKS/2026-11-15-interval-mode/retime-slow.mts`, record
`retime-slow-with-invariants.json`, 489 programs). Of the 4,748 programs
that both targets compile, 182 are above 1.1 (71 documents), 64 above 1.25,
31 above 1.5 and 8 above 3:

| Cause | Programs | Ratio | State |
| --- | --- | --- | --- |
| A run-time exponent: `_IA.powReal` where the existing target has `_IA.powInterval` (1.26 to 1.30 at the kernel) | 81 | median 1.18 | accepted by the user (section 17) |
| A `Sum`, or an operation on a list, of constant size that the existing target writes out with the index as a constant: the parts that read only the index (`(-1)^i / i`, `cos(π n / 6)`) are constants of its preamble, and kernel calls at each pass in the mode | about 40 | 1.3 to 2.5 | to do: write out at most 100 passes at the lowering |
| A rational exponent: `pow(nthRootInterval(x, 2), 3)` where the existing target has `pow(x, 1.5)` (3.8 at the kernel) | 20 | median 1.27 | fixed (denominator a power of 2), not landed when written |
| `add(a, negate(b))` where the existing target has `sub(a, b)` (1.55 at the kernel) | 24 as the main cause | 1.10 to 1.17 | fixed, not landed when written |
| Conditionals: a part shared by the arms lowered in each arm | 9 | airfoil 15 to 17, others 1.5 to 1.9 | to do: a pass |
| Calls: an invariant in a callee (voronoi 5.6), calls of calls (`greek-wave-frieze` 2.3), `At(S(x), 1)` of a list-valued function | 5 | 2 to 5.6 | voronoi: the inlining batch of `ce-compiler` |
| Singles: a comparison decided after folding (`nbbj88wunw` #1, 182), two integrals with a run-time exponent | 3 | | not assigned |

`mul` by a constant against the existing target's `scale` makes no
difference at the kernel (0.98).

Found by the same reading: an exponent whose denominator is even and not a
power of 2 (`5/6`) is enclosed as the root then the power by the mode and as
the power of the nearest double by the existing target; each misses one of
the interpreter's two readings (the rational at the default precision, the
double at machine precision) at `x = 10¹⁰` and beyond, by about 3·10⁻¹⁵
relative. It is a crafted line of the known-limitations list of
`docs/COMPILATION-MODEL.md`, and a test pins it.

Landed after the pass: the structural memo of the lowering
(`b2d967ab9c477e823585ae8ac0bed94fec50bc64`: equal sub-expressions written
as separate nodes are lowered once; `neyret/51a4237846` #9 on JavaScript
from 36 ms to 2.7 µs per call, `neyret/ac6kkpwrep` #1 from 15.3 to 1.1) and
the two kernel choices (`7f6ce285d19d95ec9d6f8095d5049a7c275b5caf`). The
sweep on main plus both: no program changes admission; 29 boxes go from
wider to equal, none moves away; time median 0.974, 221 programs above 1.1
in the sweep's own timing (286), 32 above 1.5 (36), 3 above 10 (5). In
flight when this was written: the sums of constant bounds written out, and
the values common to the arms of a conditional.

### 18.2 A defect of the sweep, the corrected baseline, and the constant sums

The sweep did not supply an input that the option `vars` maps to
`_.<name>` when the document gives that name a value (81 programs in 22
documents): both targets then threw to `entire`, the existing one at its
first statement and the mode after running the whole program, so the time
ratio meant nothing and the comparison of results was empty. The airfoil's
15 to 17 times was this: with `R` supplied, two of its four programs were
9.9 times slower before the structural memo (the shared parts lowered once
per arm, 64,000 characters of code) and all four are at 0.9 to 1.1 after it.
`sweep-t12.mts` and `retime-slow.mts` now give such a name the point at its
document value. The pass for a value common to the arms of an `if` was
dropped after a diagnosis: one instruction of the airfoil is of the kind
that rule moves (1 to 3 %).

The corrected baseline, on main `b3fc5a4a2` (`sweep-t12-at-b3fc5a4a2-vars`):
4,748 programs both targets compile; boxes equal 28,068 of 28,488, tighter
274, wider 117 (sums), `singular → partial` 15, `empty → entire` 6, shifted
4, `partial → interval` 4; 65,571 points, 54 containment misses in 6
programs, the same on both targets; 32 programs above 1.5 times the
existing target, 5 above 3, 1 above 10.

The sums of constant bounds written out are on main
(`4b7d135c01dc5e28e4a67f723878a9174376b4b1`; README, "Lists"). The sweep
with them: no program admitted before declines, every class of result is
the same box by box, 17 programs above 1.5 (32), 4 above 3 (5). What is
above 1.5: the comparison decided after folding (`nbbj88wunw` #1, 172),
`buddhabrot` (5.9, an artefact of the sweep's list input), voronoi (5.7:
the inlining of small functions, `ce-compiler`'s batch G21), two integrals
with a run-time exponent (4.8 and 2.5), `At(S(x), k)` of a list-valued
function (three programs, about 2), and about nine programs between 1.5 and
2.5 that take under 2 µs and were not timed again on a quiet machine. The
run-time exponent (`powReal`, 1.16 to 1.36, accepted by the user) is below
1.5 and is the largest class above 1.1.

`ir/` is 9,882 lines on main; the user's limit of 10,000 was set before the
interval mode existed (about 1,620 lines of the directory are the mode's
alone), and `ce-compiler` asks the user how it counts.


### 18.3 The landings of 2026-11-15 and 2026-11-16, and the baseline on main `87f8cf3e7`

The user's decisions since section 18.2: the limit of `ir/` is 12,000 lines
(after a simplification pass by both sessions); `Loop` and `Break` are
revisited; a per-pass count may be dropped where it costs against the time
bound; and, on 2026-11-16, decision 6 of section 11 is reversed (below).

On main, newest last:

- `887bc8ab3f1a616fcba26c26e2fdeab5c9c0b2c3`: `undecided()` keeps one frozen
  `Error` per message, so a throw of the undecided error costs no stack
  capture.
- `9b9e79fd866ac4f6db01617f92672a8610279385`: a simplification of the mode
  (159 lines fewer). `dropClosedForms()` stays: the Bose integral reaches it.
- `85752a2d0942602ffdec01a5d38745b6230c892f`: a `Loop` without `Break`
  compiles; each pass counts against a finite `iterationBudget`
  (`_IA.countLoopPass(budget)`). The count measured free.
- `e18d04999de8a51a6ed5c55125859aaeec5c5457` (A): a name whose held value is
  an expression is lowered as that expression. `5e286aa36514d36114e9b8155cffc3bb5cf488c7`
  (E): a list argument of a user function of scalars is the function mapped
  over the list. Together: interval +33 programs, JavaScript +71, GLSL +63.
- `87f8cf3e734956c6191bb1229219a6a11d255d65`: the budget of the inlining
  pass per site rule (`INLINE_BUDGET = { loop: 1000, repeated: 4000 }`);
  voronoi runs at 0.72 times the existing target.
- `15f8c6ca499a1fb4b7125a730939c8e8e92ec586` (D): a user function whose
  result is a list of elements of no stated type takes the shape of its
  lowered body; a parameter that the body reads as a list takes a flat list
  argument whole. Interval +15, JavaScript +16, GLSL +6. One reviewer ran
  (Codex was out on a usage limit; its review is owed).

The baseline on main `87f8cf3e7` (`sweep-t12-at-87f8cf3e7`, before D): the
mode admits 4,801 of 5,155 programs, the existing target 4,828; 28,255
boxes equal, 281 tighter, 124 wider (sums); 51 containment misses in 5
programs, the same on both targets. With D the mode admits 4,816.

The quiet re-timing (`retime-slow-at-87f8cf3e7.json`): 99 programs above 1.1
times the existing target, 82 of them the accepted class of the run-time
exponent; 20 above 1.25, 10 above 1.5, 3 above 3. The causes that are not
accepted:

- an integral with an infinite bound, which `_IA.integrate` answers with
  `entire` at once, where the mode computes the invariants of the integrand
  first (`neyret/thpezd39zq` #0 and #1, 5.3 and 2.8);
- one element of a list that a function or a build makes, where the existing
  target writes the element out (`ccoc40kfhj` #9 to #11 at about 2,
  `cxlreu2mu9` #10, `1d8vyqtvoj` #0, and `pqflulcixs` #0 to #2 at 1.2 to 1.5
  since D);
- a result that is `entire` by a throw (`zrklhsz34x` #4, `n3nirm8khz` #4);
- a boolean `If(c, b)` evaluated eagerly as `_IA.and` (`3qkygakl9m` #1,
  2.2);
- a comparison that the existing target proves at compile time
  (`nbbj88wunw` #1, 155; recommended as an exception);
- `g2vyb7i2oi` #4 (1.4, not diagnosed), programs under a microsecond, and
  `buddhabrot` (an artefact of the sweep's list input).

What only the existing target compiled on `87f8cf3e7`: 45 programs:
recursion 17, the list results of D 16 (15 admitted since), `Break` 5
(`ce-compiler`'s batch G23), and 7 others (a `Range` of a real step 2, arms
of two types 2, an `indexed_collection` input 2, a list of no single
length 1).

**Decision 6 reversed (user, 2026-11-16).** A recursive function compiles in
the mode in a bounded form: inside a function on a cycle of calls, a
conditional whose verdict is undecided throws the undecided error, so the
call answers `entire`; with every guard decided, the code follows the one
path that every point of the box follows. In the shared lowering, a
recursive function with no declared result is assumed to return a real
scalar, and the body is checked after one lowering. The pass `cse` merges
two equal calls of a function on a cycle that is not `effectful`, so a
function that makes the same recursive call twice per level runs in a time
proportional to the depth (`neyret/ndqj7hupta`: 20 calls where there were
2^20). This batch is in the commit that adds this paragraph: 19 programs
compile on JavaScript and 19 in the mode (`xvviql5z8f` 9, `ond0vgpslf` 3,
`ndqj7hupta` 7, which the existing compilers decline); the recursive
programs that both interval targets compile run at 0.7 to 0.9 times the
existing target, with equal classes; a recursion that never ends answers
`entire` in 1.5 ms (the existing target: 1.4 ms). Five programs still
decline (`tdyz9z5uxb` #2 to #6: a recursive function that reads an input).

The sweep on main `69c88b4e2` (with `ce-compiler`'s `Break` and `Continue`)
plus this batch (`sweep-t12-rec-on-69c88b4e2`): the mode admits 4,840 of
5,155 programs, the existing target 4,828; 13 programs compile only on the
existing target and 25 only in the mode; 28,426 boxes equal, 295 tighter,
124 wider; 51 containment misses in 5 programs, the same on both targets.

### 18.4 The afternoon of 2026-11-16: recursion, Tycho's run of a joint build, and the replay

On main after section 18.3, newest last (each with the Claude reviewer;
the Codex reviews are owed, Codex being out until 2026-11-18):

- `fe117a62f5fc8b3479a39a47a88c2f2f2b4a6f6b`: the recursion batch of
  section 18.3.
- `30dac31b16badf5198facdd2772ae3fa504f5864`: a function that calls itself
  in its own body can read an input of the program (`tdyz9z5uxb` #2 to #6).
  A cycle through another function that reads an input still declines.
- `9d5784648353afb82086cbb277d47505050c38aa`: the result of a function
  whose body has a list length known at compile time carries that length
  as a number (`62urmx2dcm` #1).
- `1a936864861229e8faae33498e3b51de17f39444`: an integral whose bound draws
  has no closed form (a defect of the mode: the closed form held one draw
  made at compile time); nothing is computed before an integral with a
  literal infinite bound (`thpezd39zq` #0 and #1: 3 to 6 times the existing
  target, now 0.86 to 0.90); the result has `freeSymbols`,
  `freeSymbolTypes`, `unsupported` and `mode`.
- `301cd2e888f06157a60bf30061a43e611c453bc5`: a list of a constant length
  of at most 16 is written out (`MAX_UNROLLED_LIST`, the field
  `unrollBuilds`; 0 on JavaScript and GLSL): builds, reductions,
  element-wise operations, and a call whose result is such a list is
  copied into its caller. Seven of the eight programs at 1.2 to 2.4 times
  the existing target are under 1.1.
- `d6e29c7e9cdb0bf726415b78b7809f0d21f5e510`: a function declared with the
  bare type `function` whose body is a list takes the shape of its body
  (below).

By `ce-compiler` in the same period, with an effect on this seam:
`69c88b4e2` (`Break` and `Continue`), `0203570bf` (the closed form of an
integral on JavaScript; the antiderivative budget of nested compilations),
`3783bedeb` (a closed constant `Range` in a value position is a literal
list of the interpreter's elements: `rwhqbsp4wq` #2 and #4, a `Range` of a
real step, compile; `1d8vyqtvoj` #0 goes from 1.58 to 1.04).

**Tycho's run of a joint build** (a local tarball of `1a9368648`, requested
by `ce-compiler` after the user's approval; results in
`~/dev/compute-engine-recovery/interval-dump/t13-results.json`, the dump of
the interval calls with Tycho's outcome per program in
`t13-interval-js-document-definitions.json`). On the interval seam: 4,697
of 5,213 distinct programs admitted (calls: 5,957 of 6,474); no run-time
throw of a compiled interval function; no new failure of Tycho's tests with
the interval seam alone; 0 changed pixels in the 32 rendered states. Of
the 517 calls that fell back, 477 are Tycho's own definitions of `Which`
(348) and `At` (129): the pipeline declines a definition that has a
handler of its own (the user's decision of 2026-11-14), and on this seam
the `Which` handler returns `undefined` and the `At` handler only rewrites
the index. `ce-compiler` reported three options to the user; the decision
is pending, and the mode as the public default waits for it.

**The replay was not faithful for functions held as values.** Tycho
declares a document function as a value of the bare type `function`; the
replay scripts of both sessions assigned it, and the engine then infers
`(unknown, …) -> list<unknown>`. The rule of `15f8c6ca4` (section 18.3, D)
applies to that inferred type only, so 17 interval programs compiled in the
replay and fell back in Tycho ("a body of V that is not a scalar or a point
of numbers (a result of no stated type)"). The corpus counts of D and of
the later commits are therefore replay counts, higher than Tycho's for
these functions. Two corrections: `d6e29c7e9` gives a function of no
stated result the same rule, and the scripts declare a value whose dumped
type is the bare `function` (a full signature in the dump is what the
engine inferred: declaring it made three programs decline that Tycho
compiles). With both, the replay of `t13` agrees with Tycho's recorded
outcome on 4,560 of 5,213 programs; the others are Tycho's `Which` and `At`
definitions (424), host operators that the dump does not hold (216), the
two fixes that landed after the build (10), and 3 programs not explained
(Tycho declines them on the complex lane: there the dumped signature is a
declaration, which the dump does not tell from an inferred one). To ask of
Tycho at its next run: a `declared` flag per definition.

Known differences of the result fields against the existing target, over
the 4,815 programs both compiled at `1a9368648`: `freeSymbols` holds the
same names in another order in 302 (Tycho reads the order in two places,
neither of which changes a value: a GLSL preamble's text and a cache key),
and an entry of `freeSymbolTypes` differs in 14.

**The baseline on main `d6e29c7e9`** (`sweep-t12-at-d6e29c7e9`, the
corrected replay of the older dump; `retime-slow-at-d6e29c7e9.json`): the
mode admits 4,848 of 5,155 programs, the existing target 4,835; 5 programs
compile only on the existing target, each a decline by a rule of the
compilation model (arms of two types 2, an input typed
`indexed_collection<number>` 2, a list of no single length 1); 25 compile
only in the mode. Boxes: 28,515 equal, 295 tighter, 124 wider (sums); 51
containment misses in 5 programs, the same on both targets. The quiet
re-timing of the 501 programs that the sweep put above 1.05: 84 above 1.1
times the existing target (99 on `87f8cf3e7`), 12 above 1.25 (20), 4 above
1.5 (10), 2 above 3 (3). Of the 84, 71 hold a run-time exponent (the
accepted class; two of them are above its usual range: `3qkygakl9m` #1 at
2.19, whose boolean `If(c, b)` is also evaluated eagerly, and `jdnefd99lw`
#0 at 1.89 for 0.16 µs). The other 13: `nbbj88wunw` #1 (153: a comparison
that the existing target decides at compile time; recommended as an
exception), `buddhabrot` #0 (4.9: an artefact of the sweep's list input),
`g2vyb7i2oi` #4 (1.46: a fourth derivative), `zrklhsz34x` #4 and
`n3nirm8khz` #4 (1.44 and 1.39: sums of 15 µs), `pvzphgx1eo` #1 (1.25),
`3mhkarzpoz` #3 (1.21), `3mssd5t0lj` #2 and #4 (1.15), `ccoc40kfhj` #9
(1.12: no `_IA.scale` spelling of a point constant times an interval), and
three at 1.10. Their causes are not diagnosed yet, except where stated.

### 18.5 The evening of 2026-11-16: the programs above 1.1, cause by cause

The user asked what the run-time exponent costs and what could be gained
back. On main `d6e29c7e9`, 427 corpus programs hold `_IA.powReal`; 71 ran
above 1.1 times the existing target after a quiet re-timing (median 1.17,
about 0.1 µs more per call). In the sweep's boxes no box of that class goes
from `empty` on the existing target to a value in the mode, so the corpus
sample shows the cost of the decision and not its benefit; the witness
stays `x^a` at `x = -8`, `a = 0.2`. A diagnosis of every other program
above 1.1 followed (each cause confirmed by a hand edit of the emitted code
and a quiet timing). On main since section 18.4, newest last, each with the
Claude reviewer (the Codex reviews are owed):

- `7fbb0870f4179f70bad96eba412f1381407a6944`: a run-time real exponent over
  a base whose printed enclosure is proved to have a lower end `>= 0`
  (`nonnegative(v, depth, enclosed)`: a constant, `abs`, `exp`, `square`,
  `sqrt`, an even power, sums and a `max` of such) is `_IA.powInterval`, as
  on the existing target: the reading of the exponent cannot matter there;
  and `_IA.powReal` goes through one `liftJump`. 253 programs change. The
  reading stays where the base can be negative: the decision is unchanged.
- `0641b9c6203e79594734aef23ed58545e0cc062d`: a wrong value, found by
  `ce-compiler`: `facts()` did not read the values of the dictionary of a
  `Declare`, so a sum written out gave every term the first term's value
  (`[2.5, 2.5]` for 7.5). No corpus program.
- `2bf11ff24140ee82fc09fc8ff515dd3bedb1ddc6`: the pass `hoist` is off in
  the mode, and a boolean `if` one of whose arms is the deciding constant
  is printed lazily (`verdictIf.lazy`): an operand of `And` or `Or` after
  the first runs only where the operands before it do not decide. 171
  programs, geometric mean of time 0.845, results byte-identical.
- `b5e5f4a554a087d9113ecfa3a9a37a7103aaa86c`: a rational times an inexact
  constant is one constant (`(π / q)·p`, the existing target's, at machine
  precision); an `add` of an exact zero is its other operand (a sum written
  out starts at its first term); `div(neg(a), b)` is `_IA.negDiv`. 316
  programs.

Three reviews of this period found a wrong value before or after a
landing that no corpus program shows: `Reduce(L, f, init)` over a short
list (section 18.4), a constant near 0 marked inexact taken as never
negative, and a constant that occurs twice in a product with a rational.
Each was reached by a reviewer's probe, not by the sweep.

Filed: `issues/CE-1372.md`: both interval targets answer `[1, 1]` for
`0^0` with a run-time exponent, where the interpreter and the JavaScript
targets give `NaN`.

**The baseline on main `b5e5f4a55`** (`sweep-t12-at-b5e5f4a55`,
`retime-slow-at-b5e5f4a55.json`): admission and classes as in section 18.4
(4,848 of 5,155; 28,520 boxes equal, 292 tighter, 123 wider; 51 containment
misses in 5 programs, the same on both targets). After the quiet re-timing
of the 244 programs that the sweep put above 1.05, 12 programs are above
1.1 times the existing target (84 on `d6e29c7e9`), 6 above 1.25, 4 above
1.5, 2 above 3, and none of them holds `_IA.powReal`:

| Program | Ratio | Cause |
| --- | --- | --- |
| `neyret/nbbj88wunw` #1 | 159 | a comparison that the existing target decides at compile time (recommended as an exception) |
| `showcase/buddhabrot` #0 | 6.2 | an artefact of the sweep's list input |
| `neyret/jdnefd99lw` #0 | 1.78 (0.16 µs) | an undecided bound throws where the existing target returns `entire` in place; the mode gives up in those boxes either way |
| `art/mavxszbvzk` #0 | 1.52 (0.07 µs) | a constant program; not diagnosed |
| `neyret/zrklhsz34x` #4, `neyret/n3nirm8khz` #4 | 1.46, 1.43 | the same `Sum` loop computed twice (`cse` does not merge loops: `ce-compiler`'s CE-1373) |
| `neyret/pvzphgx1eo` #1 | 1.20 | invariants computed before a loop that makes no pass in the sweep's boxes |
| `neyret/sjjo3qgnfp` #69, #118, #76 | 1.14, 1.13, 1.10 | not diagnosed |
| `art/h2rbqjefo3` #0, `neyret/7vqnkhdhoj` #12 | 1.10 | not diagnosed |
