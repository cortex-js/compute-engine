# Error Model

**Status:** part normative reference, part proposal — revision 3,
incorporating two rounds of external review (2026-08-25). Each section is
marked:

- **Settled** — describes behavior that is shipped and ruled; the section is
  documentation, not a request.
- **Proposed** — a rule recommended for adoption. Not yet ruled; deviations
  from it are listed in §7, not silently absorbed.
- **Open** — a question that needs a ruling before it can be settled either
  way.
- **Agreed direction, implementation pending** — the intended rule is
  decided, but current behavior still differs. Do not use it as an
  implemented guarantee.

The Compute Engine serves two audiences with different needs. As the
infrastructure for Epsil, precise early diagnostics with source provenance
are valuable. As an interactive symbolic/numeric system, leeway and low
ceremony are valuable: guide the user when they did something they surely
did not mean, but do not reject input that could still become meaningful.
This document says how those two needs are reconciled: which failure channel
answers which kind of wrongness, when each fires (boxing time vs. evaluation
time), how each propagates, and what function signatures do and do not
promise.

### Inference and content contracts — clarification of 2026-10-20

**Implemented 2026-10-21** (`docs/plans/2026-10-21-unknown-inference-marker.md`):
`unknown` is an inference marker/placeholder, not a concrete content type.
It asks the engine to determine a type. It does not promise either the
presence or absence of a datum, and it does not establish that a runtime
value satisfies the type a consumer requires. In the subtype relation every
type is a subtype of `unknown` (the markers and `any` included) and
`unknown` is a subtype only of `any` and itself. A site that needs
EVIDENCE that a type admits a marker asks `provablyAdmits()`
(`common/type/subtype.ts`), which does not read an `unknown` arm as a
proof.

Use explicit content contracts for those restrictions:

- `value` accepts data values, excluding functions, symbols, and the
  immediate markers `missing`, `nothing`, and `error`.
- `expression` also accepts functions and symbolic expressions, but still
  excludes those immediate markers.
- `any` accepts unrestricted content types, including the markers.
- `list<expression>` excludes immediate `missing`, `nothing`, and `error`
  elements.
  `list<expression | missing>` permits missing elements; a missing whole
  list is instead expressed by `list<expression> | missing`.
- `list<unknown>` asks to infer an element type from each assignment, as
  the bare `list` does, and imposes no absence restriction:
  `xs: list<unknown> := [1, Missing]` reports `list<integer | missing>`.

These are immediate-content restrictions, not guarantees about every nested
element. A collection containing `Missing` is itself a collection value.
Both `value` and `expression` include numeric `nan`, and therefore `NaN`
and `Indeterminate`. These contracts alone do not establish presence for
`IsMissing`, `??`, or the presence assertion `x?!` (`AssertPresent`); the
absence predicate (`isMissingValue`) includes both numeric markers.
Evaluation failure is separate: an expression with a successful-value
contract may still fail when evaluated.

A join derived from a value keeps the unresolved part
(`joinUnresolvedArm()` in `subtype.ts`: the slots of a tuple and the
element join of `ListJoin`), so a value-derived type does not drop a slot it
could not resolve. The general join is neutral in `unknown`
(`widen(unknown, integer)` is `integer`), because the inference joins read
`unknown` as "no information yet". `never` is the bottom type, below every content type; it is
neither an absent datum nor an inference placeholder.

Raw callback results in lazy views (R) are selected, with explicit
materialization and omission through `ListFrom`. Follow-up decisions select
aggregates skipping `Nothing`, no implicit compaction from
storing/passing/nesting views, and preserved data-tuple slots. Open record
types are retained. Record-field omission remains open.

The presence contracts were decided and implemented on 2026-10-21 (user
decisions P1 to P5, `docs/plans/2026-10-21-presence-contracts-and-assertion.md`;
the decision records are in section 4 of this file, "What a signature
promises"). A
declared type refuses an absent value (`s: string` refuses `Missing`); a
library parameter that excludes absence refuses an absent argument with
`incompatible-type`; the Epsil static check reports a possibly absent value
at such a parameter or declaration. The presence assertion is the postfix
`x?!` (alias `⁈`, MathJSON `AssertPresent`). It is a runtime check that uses
the same absence predicate as `??`: it fails with `expected-present` for
`Missing`, `Undefined`, `NaN` and `Indeterminate`, and passes `Nothing`
through. Its type is `presentType()` of the operand (`coalesce.ts`), which
removes those absence forms and keeps `nothing`. A compiler omits the check
only when the operand's type proves presence; the JavaScript and Python
targets raise, and a target that cannot raise compiles the identity without
reading the assertion as a proof. See the
[design note](plans/2026-10-20-bare-tuple-record-any.md) for the collection
rules and [type-system reference](TYPE-SYSTEM.md) for current subtyping.
In particular, accepting a possibly absent argument can mean
propagating it, handling it, or checking it at runtime; it does not make
`missing` a subtype of the parameter's content type.

### Numeric absence handling — agreed change of 2026-10-20

**Implemented** (the presence assertion since 2026-10-21): treat `NaN` and
`Indeterminate` alike in `IsMissing`, `Coalesce` / `??`, and the presence
assertion `x?!`. Both count as absent, both select a fallback, and both
fail the assertion. `Missing` and `Undefined` continue to do so;
`Nothing` remains an omission marker rather than an absent datum.

This supersedes the earlier D7 rule that exact `Indeterminate` bypasses
absence handling. The old distinction is migration history; current checks
and fallbacks handle both numeric markers.
The invariant is uniform treatment by these three observer, fallback, and
assertion operations while preserving distinct numeric representations and
existing exact arithmetic propagation: `Mean([1, Indeterminate])` and
`Max(1, Indeterminate)` retain exact `Indeterminate`, while
`Coalesce(Indeterminate, 5)` returns `5`. Consumers may need separate
policies; this does not prescribe a helper name or mechanically broaden
every absence gate, nor decide field omission or tuple normalization.

### An undefined operand makes a comparison false, in a branch too — user decision of 2026-10-20

**Settled, implemented 2026-10-20** (Tycho ledger rows 411 and 413; Desmos
and IEEE 754 parity). An ordered comparison (`<`, `≤`, `>`, `≥`) or an
equality (`=`) whose operand is an undefined numeric value (`NaN`,
`Indeterminate`) is `False`. This was already its value when it is
evaluated alone; it is now also its value in the condition of an `If` or a
`Which`, so the branch takes its next arm (the else arm). The rule holds on
every route: the interpreter, the `javascript` and `python` compile
targets, and `interval-js` for an operand that is undefined over the WHOLE
cell (`empty`). The GPU targets (`glsl`, `wgsl`) already selected by the
IEEE `false` and did not change.

| Input | Before 2026-10-20 | Now |
| --- | --- | --- |
| `0/0 > 0`, `0/0 = 0`, evaluated alone | `False` | `False` (unchanged) |
| `\left\{\frac{0}{0}>0:1,0\right\}` (also `<`, `≤`, `≥`, `=`), interpreter | `Missing` | `0` |
| `If(0/0 > 0, 1, 0)`, interpreter | `Missing` | `0` |
| `\left\{x > 0: 1, 0\right\}`, `javascript`, run at `{x: NaN}` | `NaN` | `0` |
| the same, `python`, `x = nan` | `nan` | `0` |
| `0 < \sqrt{x}`, `interval-js`, `x` = [-1, -1] (`\sqrt{x}` is `empty`) | `'maybe'` | `'false'` |
| the same, `x` = [-1, 1] (`\sqrt{x}` is `partial`) | `'maybe'` | `'maybe'` (unchanged) |
| `\sqrt{x} \ge 0`, `interval-js`, `x` = [-1, 1] | `'true'` | `'maybe'` |
| `\mathrm{NaN} \ne 0`, interpreter | `True` | `True` (unchanged) |
| `\sum_{n=0}^{100} M(n)` with `M(n) := \{K(n) > 0: 1, 0\}` and `K(0)` undefined | `NaN` | `100` |

What the decision does NOT change:

- **`≠` (`NotEqual`)** kept its earlier behavior until the user decision of
  2026-10-23: a branch on a `NotEqual` with a NaN operand took no arm
  (`Missing` in the interpreter, `NaN` on the `javascript` and `python`
  targets). Since that decision `NaN ≠ 0` is `True` in a branch condition
  too, as IEEE reads it and as the cell of an element-wise condition always
  was, so `If(NaN ≠ 0, a, b)` takes `a` on the interpreter and on the
  `javascript` and `python` targets, the same arm as `If(¬(NaN = 0), a, b)`.
  The GPU targets took the then arm before and still do. `interval-js`
  still answers `'maybe'` for `\sqrt{x} \ne 0` over an `empty` operand.
- **`Missing`** keeps its Kleene reading: `Less(Missing, 1)` is `Missing`,
  and an `If` on it is the absent-condition error (§3.D); compiled, a
  `missing`-typed operand still makes the branch take no arm. On
  `javascript` and `python` such an operand is tested both for the object
  null and for NaN, because NaN is the value a nested else-less `If` or a
  default-less `Which` with a numeric result answers when it selects no
  arm: `If(If(c > 0, 1) > 0, 1, 0)` at `c = -1` is `NaN`, as the
  interpreter gives the absent-condition error. A consequence: a NaN that
  such an operand holds as a value (an arm that is itself NaN) also makes
  the branch take no arm. Arithmetic over a `missing`-typed value is typed
  `number` and is not tested: `Missing + 1` is `NaN` in the interpreter
  too, and `If(If(c > 0, 1) + 1 > 0, 1, 0)` at `c = -1` is `0` in the
  interpreter, on `javascript` and on `python`. On `interval-js` the no-selection value of a default-less `Which`
  and a written `Missing` is the `empty` result with the `missing` flag,
  and a comparison with it is `'maybe'`, not `'false'` (`hasEmptyOperand`,
  `interval/comparison.ts`): `Which(x > 5, 1) > 0` over `x` = [0, 1] is
  `'maybe'`. A `When` whose condition is false and an `At` that selects
  nothing are numeric undefined values in the interpreter (`When(1, False)`
  is `NaN`), so they keep the plain `empty` and a comparison with them is
  `'false'`.
- **A comparison of two collections with an absent cell** keeps the
  2026-09-21 marker ruling: the comparison is `Missing` and a branch on it
  takes no arm.
- **An unsupplied variable** of a compiled JavaScript function (a variable
  the caller leaves out of the vars object, which reads as `undefined`)
  still makes a branch on a comparison that reads it take no arm (`NaN`),
  whether the comparison reads it directly (`x > 0`) or through arithmetic
  (`2x > 0`, `\sin x > 0`). The compiled guard tests each variable the
  comparison reads for `undefined` (`_.x !== undefined`) instead of testing
  each operand for NaN (`_.x === _.x`). The test applies to a variable of
  any type (`p.x > 0` tests `_.p`), and to a variable the comparison reads
  through an assigned value (`a := \sin x`, then `\cos a > 0` tests `_.x`)
  or through the body of a user function it calls. A local of a `Block` is
  followed to every value the block assigns to it, in a loop or a branch
  too: `Block(a := n + 1, a < m)` at `{m: 5}` has no value, and so has the
  `If` over it. When the local is assigned more than once, the test requires
  the variables of all its values, so it can give no value where the
  interpreter has one (`a := 1; If(m > 0, a := n); a < m` at `{m: -5}`),
  never the reverse. A local that no statement before the read assigns at
  the top level of the block (it is assigned only in a branch or a loop) is
  tested for `undefined` too (`blockLocalValueFrame`). A variable read only by
  an ARM of a nested `If`, `Which` or `When`, or by a later condition of a
  `Which`, is not tested, since it is read only when that arm is selected:
  `If(If(x > 0, y, 1) > 0, 1, 0)` at `x = -1` is `1` with `y` unsupplied, as
  in the interpreter. The operands of `Coalesce` and `IsMissing` are not
  tested either. What remains: when such an arm IS selected and reads an
  unsupplied variable, its value is `NaN` (or `undefined`), and the branch
  takes no arm only when the nested conditional's result may be absent (no
  else arm, no default; see the `Missing` item above); otherwise the
  comparison decides false, as for any NaN operand
  (`BaseCompiler.operandInputNodes`, `compilation/base-compiler.ts`).

  A comparison that is not a branch condition, but whose value is the result,
  has no value when it reads an unsupplied variable (user decision
  2026-10-30). For `x > 0` with `x` declared `real`, input `{}`: before, the
  compiled function returned `false` (`0 < undefined`); now it returns
  `undefined`, as the interpreter has no value. `x ≠ 0` at `{}` returned
  `true` and now returns `undefined`. A supplied `NaN` still decides:
  `x = y` at `{x: NaN}` with `y` unsupplied is `false`. A chain is the
  three-valued `And` of its links, so one decided `false` link decides it:
  `x < y + 1 < 2` at `{y: 2}` is `false`, and so is `NaN < x` at `{}`. The
  rule applies to a variable of any declared type, `unknown` included. An
  operand that reads an absent value as a number (`Boole(x > 0) = 0`) cannot
  let the comparison run first, since `0 = 0` is `true`: the tests come
  first there. Where only the truth of a numeric comparison is read (`Boole`,
  a `Filter` predicate), the plain comparison is emitted with no test,
  because `false` and `undefined` give the same result there; not for a
  string comparison (`Boole(s = t)` at `{}` is `0`)
  (`BaseCompiler.unsuppliedComparisonGuard`, `compilation/base-compiler.ts`).
- **A `partial` operand** on `interval-js` (undefined over part of the cell
  only) gives at most `'maybe'`: where it is undefined the comparison is
  false, so it cannot hold over the whole cell. Before 2026-10-20 the
  verdict was read off the enclosure of the defined part alone, so
  `\sqrt{x} \ge 0` over [-1, 1] answered `'true'`; it now answers `'maybe'`
  (`holds`, `interval/comparison.ts`). A `partial` operand that is false
  where it is defined stays `'false'`.

History: from 2026-09-02 (compiled) and 2026-09-03 (interpreter) to
2026-10-20, a NaN operand of any of these relations, `≠` included, made the
branch take no arm — see the 2026-09-02 entry in §7. From 2026-10-20 to
2026-10-23 `≠` kept that rule. Implementation: `evaluateCondition`
(`library/control-structures.ts`, which now flags only the `Missing` of an
undecided whole-collection comparison), `BaseCompiler.conditionNode`
(`compilation/base-compiler.ts`, which reads a chain link by link), and
`hasEmptyOperand` and `holds` (`interval/comparison.ts`). Pinned in
`test/compute-engine/condition-nan-undecided.test.ts`.

#### Extension: a value with no order — user decision of 2026-10-21

**Settled, implemented 2026-10-21** (Tycho ledger row 413 (a)). A value
that is undefined for an ordering also decides `False` in an ordered
comparison, in a branch and everywhere else. Such a value is the pole
`ComplexInfinity` (`~oo`, the value of `1/0`), a number that is not real
(`i`, `\sqrt{-1}`, `\ln(-1)`, any value with a nonzero imaginary part), or
any other numeric value that is not a real number. The real numbers include
`+∞` and `−∞`: `0 < \infty` stays `True`. The ordering of such a value is
not defined, so `<`, `≤`, `>` and `≥` answer `False`, and an `If` or a
`Which` on such a comparison takes its next arm.

For `=`, the two kinds differ:

- an operand that is the pole decides `False`: the pole has no value, so
  `1/0 = 1/0` is `False`, as `NaN = NaN` is;
- an operand that is a complex number keeps the ordinary equality, which is
  defined: `i = i` is `True`, `i = 0` is `False`, unchanged.

| Input | Before 2026-10-21 | Now |
| --- | --- | --- |
| `0 < \frac{1}{0}` | `Less(0, ComplexInfinity)` (unevaluated) | `False` |
| `\frac{1}{0} = \frac{1}{0}` | `True` | `False` |
| `\frac{1}{0} = 0` | `False` | `False` (unchanged) |
| `0 < i` | `Less(0, Complex(0, 1))` | `False` |
| `0 < \ln(-1)` | `Less(0, Ln(-1))` | `False` |
| `i = i`, `i = 0` | `True`, `False` | unchanged |
| `\left\{\frac{1}{0} > 0: 1, 0\right\}` | the held `Which` | `0` |
| `\left\{\sqrt{-1} > 0: 1, 0\right\}` | the held `Which` | `0` |
| `\frac{1}{0} \ne 0` | `True` | `True` (unchanged) |
| `0 < \infty`, `\infty = \infty` | `True` | `True` (unchanged) |
| `0 < x`, `x` free | `Less(0, x)` | `Less(0, x)` (unchanged) |
| `x < i`, `x` free | `Less(x, Complex(0, 1))` | `False` |
| `\ln(-1) \le \ln(-1)` | `True` | `False` |
| `0 < i < \mathrm{Missing}` | `Missing` | `False` |
| `\sum_{n=0}^{10} M(n)` with `M(n) := \left\{\frac{1}{n} > 0: 1, 0\right\}` | a held sum | `10` |

What the extension does NOT change:

- **`≠` (`NotEqual`)**, as in the 2026-10-20 decision: `1/0 ≠ 0` stays
  `True`, and `i ≠ 0` is `True`.
- **`Missing`** keeps its Kleene reading: `Less(Missing, i)` is `Missing`.
  A chain is the conjunction of its adjacent pairs, and it stops at the
  first pair that is `False`: `0 < i < Missing` is `(0 < i) ∧ (i <
  Missing)`, which is `False ∧ Missing`, so `False`, and the operands after
  that pair are not evaluated. A pair with a `Missing` operand is not decided
  by the rule, so `Missing < 0 < i` is `False` too (the pair `0 < i`), as
  `Missing < 2 < 1` is. A pair with a `NaN` operand is `False` the same way
  (user decision 2026-10-23): `0 < NaN < Missing` and `Missing < 0 < NaN` are
  `False`, on the interpreter and the compiled targets; before, the absent
  operand won and the chain was `Missing`. `NaN < Missing < 0` stays
  `Missing`: each of its pairs has the absent operand. A branch over a chain
  is decided link by link on the compiled targets too: with `x = 1` and `w`
  absent, `If(x < 0 < w, 1, 2)` is `2`, where the compiled code answered
  `NaN`. One case compiled numeric code cannot tell apart: for an operand
  declared with a `missing` arm (`w: number | missing`), NaN is also the
  numeric spelling of the absent value, so a link `0 < w` with `w = NaN` is
  undecided on the compiled targets, where the interpreter, given the value
  `NaN`, decides it `False`.

The comparison stays inert only when no operand has a value with no order
and every operand that is not a number is a free symbol or an unevaluated
form that depends on one: `0 < x` with `x` free stays `Less(0, x)`, and so
does `0 < ix`. A value with no order decides `False` also next to a free
symbol, as `NaN` does (`x < NaN` is `False`): `x < i`, `\ln(-1) < x` and
`x < \frac{1}{0}` are `False`, and so is `\frac{1}{0} = x`.

How an operand is read:

- A number literal is read without a tolerance: `1 + 10^{-800}i` is not
  real, although its imaginary part is the double `0` (`isComplex`).
- A constant expression with no free variable that `evaluate()` leaves
  symbolic (`\ln(-1)`, `e^{25} + \ln(-1)`) is approximated to find its
  imaginary part, when the comparison methods did not decide the comparison
  and when a `≤` or `≥` was decided `True` (a tie: `\ln(-1) \le \ln(-1)` is
  `False`, as `i \le i` is). An imaginary part of that approximation of at
  most `10^{-14}` times the modulus is not read as nonzero: it can be the
  rounding error of a real value computed through complex values. This is
  the noise rule of `boxComplexResult()` in `library/arithmetic.ts`. The
  approximation of a quadrature is a `Measurement`, read through its
  nominal value: `0 < \int_0^1 e^{ix^2} dx` is `False`.
- No approximation is made for an operand whose type is `real`, or that
  holds a `Sum`, `Product`, `Limit`, `NLimit` or `NDSolve` (an iteration with
  no fixed bound): `0 < \sum_{k=1}^{\infty} \frac{\ln(-k)}{k^3}` stays
  unevaluated, and costs one numeric evaluation of the sum, not two.
- `=` is not approximated: only the literal `ComplexInfinity` decides it
  (`1/0`, `\Gamma(0)` and `\tan(\pi/2)` evaluate to it).

The engine builds some conditions as ordered comparisons. Those that can
see a complex constant are written for it:

- the convergence condition of an improper integral is on the real part of
  the exponent: `\int_0^1 x^{i\pi} dx` is `\frac{1}{1 + i\pi}` (the
  condition `0 < \operatorname{Re}(1 + i\pi)` is `True`), where
  `0 < 1 + i\pi` would have dropped the value;
- the root of an equation in a logarithm with a base that is not real has
  the condition `b \ne 0 \land b \ne 1`, not `0 < b`: `\log_{1+i}(x) = 2`
  has the root `2i`.
- **The comparison methods** (`isLess()`, `isGreater()`, `isLessEqual()`,
  `isGreaterEqual()`) still answer `undefined` for a complex operand. Engine
  code reads a `false` from them as "the other order holds", which is not
  true of a complex value.

Compiled routes. The compiled arithmetic does not change. On the
`javascript` and `python` targets a pole computed at run time, and the
constant pole next to a variable, is the IEEE `Infinity`, which is ordered
(on `interval-js` the constant pole is a hoisted constant that compares as
`+∞`): this is a lane difference, recorded with the other divergences of
the `Infinity` projection in `docs/COMPILATION-MODEL.md`. Measured
2026-10-21:

| Expression | Input | Compiled | Interpreter |
| --- | --- | --- | --- |
| `\left\{\frac{1}{x} > 0: 1, 0\right\}` | `x = 0`, `javascript` | `1` (`(0 < 1 / _.x) ? 1 : 0`) | `0` |
| the same | `x = 0`, `python`, `x` a NumPy float | `1.0` (a plain Python float raises `ZeroDivisionError`) | `0` |
| `\frac{1}{x} = \frac{1}{x}` | `x = 0`, `javascript` and `python` | `true` | `False` |
| `\left\{\frac{1}{x} > 0: 1, 0\right\}` | `x` = [0, 0], `interval-js` | [0, 0] (`\frac{1}{x}` is `empty`, so the comparison is `'false'`) | `0` |
| `\left\{\sqrt{x} > 0: 1, 0\right\}` | `x = -1`, `javascript` | `0` (the runtime rule of the complex modes) | `0` |
| `x < \frac{1}{0}` | `x = 1`, `javascript`, `python`, `interval-js` | `true` (`_.x < Infinity`, `x < np.inf`, `'true'`) | `False` |
| `\frac{1}{0} = x` | `x = 1`, the same targets | `false` (`true` at `x = Infinity` on `javascript`) | `False` |
| `0 < \frac{1}{0}`, closed | `interval-js` | `'true'` (`_IA.less(_k1, _k2)`; no fold) | `False` |
| `\frac{1}{0} = \frac{1}{0}`, closed | `interval-js` | `'true'` (`_IA.equal(_k1, _k1)`; no fold) | `False` |

A closed comparison (no variable) folds to the value of the interpreter on
`javascript`, `glsl`, `wgsl` and `python`, with or without `constantFold`
(a comparison folds under the opt-out because its result jumps at a point;
`closedExactJump`, `compilation/base-compiler.ts`, which reads the pole
`ComplexInfinity` as a value with no order, not as a float). Measured
2026-10-21, the same code with `constantFold: true` and `constantFold:
false`:

| Expression | `javascript` | `glsl`, `wgsl` | `python` | `interval-js` |
| --- | --- | --- | --- | --- |
| `0 < \frac{1}{0}` | `false` | `false` | `False` | `'true'` (no fold) |
| `\frac{1}{0} = \frac{1}{0}` | `false` | `false` | `False` | `'true'` (no fold) |
| `\frac{1}{0} = 0` | `false` | `false` | `False` | `'false'` (no fold) |
| `\frac{1}{0} \ne 0` | `true` | `true` | `True` | `'true'` (no fold) |
| `0 < i`, `0 < \ln(-1)` | `false` | `false` | `False` | compile-time decline |
| `i = i` | `true` | `true` | `True` | compile-time decline |
| `0 \le \infty` | `true` | `true` | `True` | `'true'` |

Before, the interpreter left the comparisons with a value with no order
unevaluated, the fold failed and the code was structural (`0 < Infinity`,
`true`), and on `python` and under `constantFold: false` the code of a
comparison with the pole stayed structural also after the interpreter
decided it, since the pole is not an exact number. `interval-js` never
folds a comparison: its code computes an enclosure. `i < x` is still the
compile-time decline of a statically non-real operand, although the
interpreter answers `False` for it.

On `interval-js`, `1/x` over the point [0, 0] is already `empty`, so the
comparison is `'false'` (the 2026-10-20 rule) and nothing changed there.
Other kernels answer a pole over a point cell with `singular`, not `empty`:
`\frac{1}{x^2}`, `\cot x`, `\csc x` and `\Gamma(x)` at [0, 0], and
`\sec(x - \frac{\pi}{2})` at [0, 0]. A comparison with them is `'maybe'`,
which is sound but not the `'false'` of the interpreter; a `singular` result
does not record the cell, so the comparison cannot tell a point cell from a
wider one.

Implementation: `nonRealKind()`, `undecidedOrderedRelation()`,
`trueOrderedRelation()` and `unorderedChainPair()`
(`library/relational-operator.ts`), called by `decideLess`,
`decideLessEqual`, `decideEqual` and the adjacent-pair deciders of a chain
(`CHAIN_PAIR_IS_FALSE`). The conditions built over a real part:
`guardRealPart()` (`library/calculus.ts`) and the logarithm roots in
`boxed-expression/solve.ts`. Pinned in
`test/compute-engine/condition-nan-undecided.test.ts` ("Tycho row 413
(a)").

## 1. The response channels — Settled taxonomy; the host-throw amendment is Proposed

When an operator receives an argument that is wrong in some way, the engine
answers through one of four channels. Which channel is not a per-operator
style choice; it is determined by *what kind* of wrongness it is.

**`Error` — the out-of-band diagnostic channel.** An `Error` expression
(type `error`) means *a language or operation contract was violated*: a
type mismatch (`Sin("banana")`), a parse fragment (`1+`), an arity
violation, a runtime conformance failure (a deferred type check that
settles against the slot), a failed dispatch (a non-function callee), a
violated precondition (an invalid option value, a dimension mismatch), or
an explicitly constructed `Error(…)`. It is the channel for wrongness that
is *about the program*, not about a mathematical value. A WRITTEN
`Error(…)` is therefore a static diagnostic node — it invalidates every
tree above it — and a program that wants to *produce* an error value at
run time calls `RuntimeError(code)` (ruled 2026-09-03), a valid application
typed `never` whose evaluation yields the `Error(code)` value. Its consumer is a
human or an IDE, so it carries provenance: an error code, the offending
sub-expression, and (as it propagates) a breadcrumb of the operators it
passed through. As a content type, `error` is a subtype of `any`, but not
of `value` or `expression`. It is a subtype of the inference marker
`unknown`, which restricts nothing. An explicit `any` or a union containing `error` can
describe error content, while ordinary successful-value signatures need
not enumerate evaluation failure.

**`NaN` — the in-band numeric indeterminacy value.** `NaN` means *the
mathematics was performed and has no answer in the numeric codomain*:
`Mod(1, 0)`, `0 * oo` (on the exact route these two answer the second
member of `nan`, `Indeterminate`, described below; with a float operand or
under `.N()` they answer `NaN`). It carries no provenance and follows IEEE 754
semantics: quiet, absorbing through numeric operations, `NaN == NaN` is
`False`. Within the numeric hierarchy, `NaN` is admitted **by `number`
and its own type `nan`** — the other numeric branches exclude
it (`complex`, `real`, `rational`, `integer`, all of which are
finite-only; `infinity`; and the signed-pair spelling `+oo | -oo`, which
is `±oo` exactly). `~oo` (`ComplexInfinity`) is likewise outside `complex`, but
it now has a home of its own: it is a member of `infinity`. The top
therefore decomposes with nothing left over —
`number = complex ⊔ infinity ⊔ nan` — and the exceptional points that
§5 set out to name are named. (The non-finite typing convention is in
`ARCHITECTURE.md`, "Non-finite typing convention for type handlers";
`src/common/type/types.ts` documents the numeric tower.) By the missing-value ruling of 2026-07-24 (next paragraph) `NaN`
also serves as the *absence* marker inside numeric domains.

**`Indeterminate` — the exact-route answer to a form with no value**
(shipped 2026-09-29). The type `nan` has two members. `NaN` is the
floating-point failure and the numeric absence marker, as described above.
`Indeterminate` is the answer of the EXACT route to a form that has no
value: `0/0`, `∞/∞`, `0·∞`, `∞ − ∞`, `0^0`, `∞^0`, `1^∞`, `(−1)^±∞`,
`Mod(x, 0)`, `Remainder(x, 0)`, `Fract(±∞)`, `Log(1, 1)`, a special
function at an infinite point where it has no limit (`Gamma(−∞)`), and
`Variance([5])`. The same form with a float operand (`0.0/0.0`,
`Mod(5.0, 0)`), every form under `.N()` or
`evaluate({numericApproximation: true})`, and every compiled target answer
`NaN`: a float operand makes a numeric result a float, and the final step
of numeric evaluation maps `Indeterminate` to `NaN`. Both values are number
literals with `isNaN` true; only `Indeterminate` has `isIndeterminate`
true. `isExact` is `false` for both, so a numeric function of either still
evaluates and does not stay inert. `isSame` holds for each value only to
itself (`Indeterminate.isSame(NaN)` is `false`), and `Equal` with either on
a side is `False`. The spellings are the MathJSON symbol
`"Indeterminate"`, the LaTeX `\operatorname{Indeterminate}` and the Epsil
name `Indeterminate`. A pole stays `~oo` (`5/0`, `Gamma(0)`), and an absent
operand still gives `NaN` (`Missing + 2`, `Length(Missing)`). The design
and the list of switched producers are in
`docs/plans/2026-09-28-indeterminate-value.md`.

**`Missing` — the position-preserving absent datum.** For non-numeric
domains, "there is no element there" is answered by the `Missing` symbol
(type `missing`), with Kleene three-valued comparison semantics. In
numeric domains absence is absorbed into `NaN` instead — deliberately,
because compile targets are float-only and `NaN` propagates there for
free, whereas a symbolic marker cannot compile. This is an accepted,
deliberate **information loss** and should be understood as such:
`IsMissing(NaN) → True` means the engine cannot distinguish "a numeric
datum was absent" from "a numeric computation produced `NaN`".
An exact indeterminate form retains its distinct `Indeterminate` result,
but `IsMissing(0/0)` and `IsMissing(Indeterminate)` are `True`, as on the
numeric route. The fallback operator handles both numeric markers too.
(The
propagation behavior is analogous to Julia's `missing`; note that Julia
itself keeps `missing` as a distinct singleton type separate from `NaN` —
the conflation is this engine's trade, made for the compile-target
reason above.) Out-of-band collection access is type-directed: numeric
element type → `NaN`, otherwise → `Missing`. When the element type does not
establish a numeric domain (the `unknown`/`any` paths in the implementation),
the marker falls back to runtime
evidence: a bounded prefix of a small, finite collection is probed,
yielding `NaN` only when the probe saw numbers and nothing else, `Missing`
otherwise (including for anything lazy, oversized, or empty). Dictionary
and record access uses the *value* type, not the key/value iteration pair.
All of this is implemented in `absenceMarker()` in
`src/compute-engine/library/collections.ts`, whose doc comments are the
reference for the fine print. This model is settled; do not re-litigate
`At([1,2], 99)` returning `NaN`. (The original design plan,
"missing-value typing" revision 6, landed 2026-07-24 and was retired from
`docs/plans/` in the 2026-08-19 doc cleanup; this section and the
behavioral rules in §3 are now the durable record.) The marker needs a
PROOF that the position is outside the collection: a miss from the `at`
handler of a collection whose count is finite, a position past a finite
count, a position counted from the end of a collection of infinite count
(`Last(Range(1, ∞))` — there is no last element), or any position of a
collection that produces no elements (`Range(-∞, -1)`). A positive
position into an enumerable collection of infinite count has no such
proof — its handler can decline a position it cannot compute while the
position exists — so `At(xs, 5000)` over it stays unevaluated
(`isProvablyOutOfRange`, issue #449).

**Inert — "not yet", never "no".** An application that stays unevaluated is
a claim that evidence might still arrive: a symbol may get a value, a type
may be narrowed. Inertness is not a failure channel, and it must never be
the terminal answer to a question the engine could decide from what it
already has. Distinguish this from an application that *has* evaluated to
its own exact symbolic form (`Arcsin(2)`, `Ln(2)`): that is a decided exact
value awaiting numericization under the exactness contract (§2), not a
pending question.

Distinct from all four: **`Nothing` is an erasure marker, not a failure
channel.** Current implementation splices it out at argument and collection
construction boundaries; the agreed direction below narrows those boundaries.
“Erasure marker” does not imply universal erasure: `Nothing` is retained
outcome data at specified boundaries and an omission request only at others.
This boundary policy is distinct from the open question of an ordinary unit
type and does not require that question to be decided.
Using it for a failed computation or an out-of-band access
would silently shorten a result and misalign positional data — that is
exactly what the `Missing` ruling fixed.

The October 20 implementation retains a `Nothing` callback result in an
indexed lazy view's iteration, indexing, count, and display. Constructing
a list from that view erases it. Thus a view exposing `[1, Nothing]`
counts two results, while its constructed list `[1]` counts one.
“Nothing always erases from collections” is not an accurate description of
this behavior. The user selected this raw-result model (R), with
`ListFrom(view)` explicitly materializing a list and omitting `Nothing`.
**Implemented for numeric aggregates:** sums, products, extrema, and the
univariate statistics skip `Nothing` data without requiring a materialized list. For a raw
view exposing `[1, Nothing, Nothing]`, `Length` is 3, while `Sum` and `Mean`
are 1. The mean counts participating results; an all-omitted input uses the
ordinary empty-input rule. This does not make `Missing` skippable.

`Map` now bypasses its callback for immediate `Nothing` inputs and preserves
that raw position. `Filter` drops immediate `Nothing` inputs without calling
its predicate; its filtered positions and count exclude those inputs. With
multiple map sources, any omitted coordinate bypasses the whole callback. `Missing` and markers nested inside a datum still reach the
callback. `Covariance`, `PopulationCovariance`, and `Correlation` skip whole
observations with an omitted coordinate (or an omitted pair row), after checking
raw source lengths. Every term uses the same retained observations. Maps,
filters, predicate counts, and these paired statistics refuse compilation when source element
types admit omission until the target can preserve that distinction. Maps also
check whether their callback results may be omitted.

Storing, passing, or nesting a view does not implicitly compact it.
Data tuples retain `Nothing` in its slot, and ordinary arguments do not
shift when one evaluates to `Nothing`. This requires changes to current
construction and assignment paths. Record fields, custom folds, ordering
operations, and serialization still need detailed policies. See the design
note; do not assume these follow-up rules or honest element/length typing
are already implemented.

Current dictionary construction omits an entry whose value is `Nothing`,
including a value that becomes `Nothing` during evaluation. The user's
current preference is to omit `Missing` fields instead and retain `Nothing`
fields. **Open:** this omission candidate is not final; required versus
optional keys and omission of
the `Missing` marker versus all absence forms still need explicit rules.
If omission is adopted, constructing `{a -> f(x)}` when `f(x)` may return
`Missing` cannot promise a required `a` key.
An existing key can instead be removed by filtering the
dictionary's key/value entries and rebuilding with `DictionaryFrom`;
this constructs a replacement dictionary. Retaining open record types
does not decide whether a field value erases its key.

**Host exceptions.** The settled core: throws are reserved for API misuse
by the embedding program, cancellation, and compiled-code boundaries per
`docs/COMPILATION-MODEL.md`. Beyond that core, current behavior is more
throw-friendly than this model proposes, in two distinct ways:

- **Native faults from built-in strict handlers are converted, not
  loud.** A `TypeError`/`RangeError`/`ReferenceError` escaping a
  built-in, non-lazy `evaluate` handler is deliberately converted to a
  boxed error value (`boxed-function.ts`, the crash-conversion wrapper) —
  a shipped fix for real host crashes: an engine bug must not kill the
  embedding editor mid-evaluation. Amended and shipped 2026-09-02 (ruled
  the same day): the conversion is kept (host resilience is right), and
  the boxed error carries the distinct `internal-error` code with the
  message and the first frames of the stack as the parts of its
  `ErrorCode`, so an engine fault is never disguised as a user mistake and
  a bug report can be traced without re-running the crash
  (`handlerThrowToErrorValue`, `boxed-function.ts`; pinned in
  `test/compute-engine/runtime-conformance.test.ts`).
- **A set of language-level contractual throws exists and is
  test-pinned**: the `Assign` redefinition discipline, a predicate returning a
  non-boolean (`Count`/`Filter`), a
  mistyped key function (`GroupBy`), element-wise failures enriched with
  broadcast context. *Proposed amendment (2026-08-25 review, pending
  ratification):* convert these to `Error` values; the inventory above is
  the migration list, and each is pinned by a test that will need an
  inline update. Function over-application ("Too many arguments") was
  converted on 2026-10-09 (user decision): a function literal applied to
  more arguments than it declares evaluates to
  `Error("unexpected-argument", <the first surplus argument>)`, with the
  frame of the call (`makeLambda`, `function-utils.ts`). A literal with no
  parameter — including the shorthand constant function, `Apply(3, 5)` is
  `3` — ignores its arguments. `Pipe` and `Map` are stricter than `Apply`: a
  number literal in the function position is the `incompatible-type` error
  (`5 |> 3` and `Map(3, [1, 2])`), because it is never a function. A symbol
  in that position is not refused, so that it can be assigned later: `5 |> f`
  evaluates to `f(5)`.

## 2. Which channel, when — Proposed (codifies current behavior, with the deviations listed in §7)

One definition the rules below lean on — *the exactness contract*:
`evaluate()` returns the most exact form — a function of an exact argument
stays exact or symbolic (`Ln(2)` stays `Ln(2)`) — while `.N()`
(equivalently `evaluate({numericApproximation: true})`) produces a float;
an inexact (float) argument numericizes under plain `evaluate()` too
(`Sin(5.1) → -0.925…`). (Previously written down only in the untracked
`ARCHITECTURE.md`; this sentence is its durable statement.)

Given an operator receiving a wrong or dubious argument, apply the first
rule that matches. The gate throughout is **evidence-based**: reject when
disjointness is *provable*, admit when types overlap or are unknown, and
re-check whenever new evidence settles.

1. **Provable contract violation, at the earliest layer that can prove
   it** — the operand's type is provably disjoint from the parameter type
   (the check argument validation performs in
   `src/compute-engine/boxed-expression/validate.ts`), or the defect is
   structural: a parse fragment, a missing or excess argument, an unknown
   named argument. Produce an `Error` at that layer — the parser for
   syntax, canonicalization for types and arity — wrapping the offending
   operand in place and preserving the surrounding structure
   (`Sin("banana")` boxes as `Sin(Error(…))`, not as a bare error), so
   diagnostics keep their position. Wrapping in place rather than
   collapsing is what keeps the expression a *document*: an expression can
   carry several independent error nodes and report them all at once, it
   still serializes back to the user's original formula with each offender
   annotated in place, and a structural repair (replace the one bad
   operand) has something to grab. The collapse still happens — at
   evaluation (§3), and in the type channel, where any invalid tree
   reports type `error` without being evaluated. This is the same division
   compiler frontends use: parse errors become error *nodes* in a full
   tree, never a bare error *value*, so downstream tooling keeps working
   on broken input.

2. **Admission for the uncertain** — an operand whose type merely
   *overlaps* the parameter type, or is unknown, is admitted at boxing.
   The interactive user gets leeway; evidence may arrive later. The check
   re-runs when it does: if evaluation settles the type against the slot,
   the same `incompatible-type` `Error` is produced then, at runtime
   (`Sum(["a", "b"])` boxes inertly because the list's element type was
   indeterminate, and evaluates to `Error(incompatible-type)` when the
   accumulator meets a string). This is the permissive-boxing posture the
   arithmetic operators already use: box permissively, guard in the
   evaluate handler.

3. **Value outside the naive domain, but mathematics has a standard
   extension** — return the extension, in no failure channel at all:
   `1/0 → ~oo` (projective infinity), `Ln(0) → -oo`, `Arcsin(2)` stays
   exact and numericizes into the complex plane, `Factorial(-2) → ~oo`
   (pole of Gamma). The empty-range conventions belong here too
   (`Sum` over an empty index range is `0`).

4. **A well-typed mathematical operation with no result in its codomain —
   return the codomain's absence marker at evaluation.** This rule is for
   *domain* failures of otherwise well-formed mathematical questions
   (`Mod(1, 0)` — a false `definedWhen` condition, in §4's terms), not
   for violated preconditions — an invalid option value, a dimension
   mismatch, an ill-formed index kind are contract violations (`requires`
   conditions, §4) and belong to rules 1/6. The marker is a function of the
   declared result type: `NaN` when the result type is numeric
   (`Mod(1, 0) → Indeterminate` on the exact route and `NaN` under `.N()`,
   both members of `nan`, §1), `Missing` when it is a settled non-numeric type
   (carried through comparisons by Kleene semantics, discharged by
   `IsMissing`/`Coalesce`), the union of the two when it is
   indeterminate. This is conceptually the same `marker(T)` rule the
   collections layer implements (`markerType()`/`withMarker()`,
   `src/compute-engine/library/collections.ts`), though the current
   helper is coarser than the concept — it answers `number` where the
   sharp answer would be `nan` (§5). There is one primitive quiet datum —
   `Missing` — and `NaN` is `Missing` absorbed into a numeric domain (the
   2026-07-24 absence ruling: `Sin(Missing) → NaN`); the quiet channel
   always speaks the codomain's own vocabulary. Quiet, no provenance. In
   one sentence against rule 1: an `Error` answers an ill-formed
   question; `marker(S)` answers a well-formed question that has no
   answer.

5. **Absent element or out-of-band access** — the operation is
   *well-formed* but there is nothing at the place it points to: an index
   out of range, a key not present, an empty collection's first element.
   This is the access instance of rule 4: the marker is computed from the
   element type of the access — `NaN` for numeric elements, `Missing`
   otherwise. Never `Nothing`, never an `Error`.

6. **Runtime contract violations** — return an `Error` from evaluation.
   The line against rules 4/5: the marker applies when the operation is
   well-formed and simply has no answer or finds nothing there; an
   `Error` applies when the operation *itself* violates its contract (a
   failed `requires` condition, in §4's terms) and that only became
   provable at runtime. The known producers: the
   deferred check of rule 2 settling against the slot; an ill-formed
   operation on strings, collections, or structures (wrong index kind,
   invalid option, dimension mismatch); a non-function callee applied to
   arguments (`a := 5; a(x)`); a handler failure surfaced as an
   evaluation error rather than a host throw.

7. **Cannot decide** — the operand is symbolic, the type is indeterminate,
   the value is not yet known: stay inert. By the definition in §1, an
   operator may stay inert only while a later re-evaluation could still
   change the answer.

## 3. Propagation — Settled, demanded operands included (implemented 2026-08-28)

**`Error` is the absorbing element of strict evaluation — over demanded
operands.** Evaluating an expression that demands an error-carrying
operand yields the first embedded error, with the traversed frames pushed
onto its breadcrumb: `err + 1 → err`, `Sin(err) → err`, and a
user-function application `f(err) → err`. The sanctioned exceptions (the
first three in `_invalidValue()`,
`src/compute-engine/boxed-expression/boxed-function.ts`):

- **Observers** — operators flagged `inspectsErrors` run their handler on
  error operands instead of bubbling: `IsError(err) → True`, `Type(err)`
  reports `error`, and `Match` can dispatch on an error subject. Surface
  `match` is the sanctioned recovery boundary in Epsil.
- **Collections freeze the failed cell.** A collection-headed node (`List`,
  `Tuple`, `Set`, `Take`, …) never bubbles its operands' errors: an error
  in an element is a failure of that *cell*, not of the container, so
  `[1, err, 3]` stays a length-3 iterable list with the error in place.
  The exception is keyed on collection-ness (the definition has a
  `collection` handler block), not on laziness. To be precise about
  status: the frozen container is *preserved and iterable*, but its tree
  is still **invalid** — `isValid` is `false` for any tree containing an
  `Error` node, container or not (`error-value.ts`). Its type is still a
  collection type: the element type of a list literal leaves the failed cell
  out (`[1, err, 3]` is typed `vector<integer^3>`), so `[1, err, 3]` retains a
  collection type, not the whole-value type `error`, and `ListJoin` splices it
  as it splices any list. A declared variable still refuses it: assigning
  `[1, err, 3]` to a variable declared `list<number>` throws, because the
  assignment checks each cell and `error` is not a subtype of `number`.
  Giving containers a validity notion distinct from their cells (a valid list
  with invalid cells) is a possible future refinement, not current behavior.

  The element type is a statement about the cells that did not fail, not a
  contract that every cell is present and successful. It does not change
  error propagation or container validity.

  **A `List` or `Set` literal with a failed cell is a collection that can be
  iterated** (decided 2026-10-19). Although its tree is invalid,
  `isCollection` is `true`, its count is the number of its cells, and a walk
  of its elements (`each()`, `at()`) gives the failed cell as the value of
  that element. A collection operator whose only errors sit in the cells of
  such literals (`Map(f, [1, err])`, `Reverse([1, err])`), or under a
  selecting operator such as an `If` in its callback
  (`Map(u ↦ If(u = 2, 1/"a", u), Range(1, 5))`, whose second element is the
  error), is a collection too, typed by its own type handler. An operator that reads the cells gives
  the failed cell to its body or callback, and the ordinary rules apply to
  what the body computes with it:

  - A positional operator keeps the cell: `Length([1, err, 3])` and
    `Count([1, err, 3])` are `3`, `First([1, err, 3])` is `1`, `[1, err,
    3][2]` is the error, and `Reverse`, `Take`, `Append` keep it in place.
  - A loop runs one turn for each cell, a `Map`, a comprehension and a
    broadcast give the cell to the body: `Map(u ↦ u + 1, [1, err, 3])`,
    `[x + 1 for x in [1, err, 3]]`, `[1, err, 3] + 1` and `Sin([1, err, 3])`
    are lists whose second cell is the error. A user function applied to the
    failed cell is the error (rung 2), so its body does not run for that
    cell. A selection keeps the error of a predicate or a guard in place:
    `Filter([1, err, 3], x ↦ x > 1)` is `[err, 3]`, as is the comprehension
    with the guard `x > 1`. An Epsil loop body that discards a value holding
    the error reports it as a nested statement.
  - An operator that demands the value of every cell answers the error of
    the first failed cell: `Sum`, `Product`, `Reduce`, `Max`, `Min`, `Mean`
    and the other statistics, `Sort`, `Ordering`, `ArgMax`, `MaxBy` and
    their `Min` twins, and `CountIf`. `Sort` and `Ordering` read the
    elements of a lazy source once, so a valid source that computes a failed
    element gives its error too: with `h(2)` an error, `Sort(Map(h, [3, 2,
    1]))` is that error.
  - `Count(xs, p)` gives the error only when the verdict of `p` for an
    element is an error. A failed cell that `p` selects is counted:
    `Count([1, err, 3], IsError)` is `1`, and `Count([[2, err], [1]], u ↦
    True)` is `2`. A user function applied to a bare failed cell is the
    error (rung 2), so `Count([1, err, 3], u ↦ True)` is the error.
  - **Membership and equality.** An answer that a valid cell decides is
    given; an answer that depends on the value of a failed cell is that
    cell's error. `Element(1, [1, err])`, `Contains([1, err], 1)` and `1 ∈
    {1, err}` are `True`; `Element(2, [1, err])` and `NotElement(2, [1,
    err])` are the error. `IndexOf(xs, v)` is the position of a match found
    before the first failed cell, otherwise the error. `Count(xs, v)`,
    `Union`, `Intersection`, `SetMinus` and `SymmetricDifference` are the
    error, since whether a failed cell is the same as another element
    depends on its value. `Unique` and `Tally` are the error only when
    there are at least two distinct elements (by `isSame()`): with one,
    nothing is compared, so `Unique([err])` and `Unique([err, err])` are
    `[err]` (two cells that are the same expression have the same value).
    Two collections are `Equal` (and not `NotEqual`) to the error when the
    comparison reaches a failed cell, and `False` (`NotEqual`: `True`) when
    their counts differ or two valid cells at the same position differ,
    before or after the failed cell: `[1, err] = [1, err]` is the error,
    `[1, err] = [2, err]` is `False`. The facts that decide the equality of
    two valid collections come first, with no walk: a set and a sequence,
    a string and another collection, or a `Tuple` and another collection
    are never equal, and neither are two collections whose counts are
    known and differ, an infinite count included (`[1, err] =
    Range(1, 10^12)`, `[1, err] = Range(1, +oo)` and `{1, err} = [1, 2]`
    are `False` at once). Otherwise the two collections are walked
    together, and the walk stops at the first pair that differs. A
    comparison that would walk more than `maxCollectionSize` pairs (all
    levels of nesting and all pairs of a chain together) stays undecided,
    also when it already met a failed cell, since a pair that it did not
    see could still differ. A chain decides pair by pair: a pair that
    differs makes `Equal` `False`, and a pair that is equal makes
    `NotEqual` `False` (`NotEqual([1], [1], [2, err])` is `False`). An
    operand that is not a collection value yet (`X` declared
    `list<number>` with no value) keeps the comparison inert before any
    failed cell is read. Two sets are compared by value, so a failed cell
    makes their equality the error. `isSame()` and `isEqual()` do not change: they
    compare the trees. A quantifier combines the answers by three-valued
    (Kleene) logic, as `Or` and `And` do (see "The connectives with a failed
    operand" below), so the order of the cells does not change the answer:
    an element that decides wins wherever it is. `Any([1, err, 3], x ↦ x >
    2)` is `True`, `All([1, err, -3], x ↦ x > 0)` is `False`, and
    `Any([1, err], x ↦ x > 2)` and `All([1, err, 3], x ↦ x > 0)` are the
    error. When no element decides, the answer is the error of the first
    failed element, also beside an element whose answer is undetermined or
    `Missing`. The walk still stops at the first element that decides. After
    a failed element it goes on to look for one. A source that is known to
    be finite is read to its end, however large. Any other source
    (`Range(1, +oo)`, `Repeat(5)`, a `Filter` over an unbounded range) is
    read for at most `iterationLimit` elements, the cap of the index
    searches over such a source, with or without a failed element: when no
    element decides before the cap, the quantifier stays unevaluated, since
    an element that decides can come later. `Any(Range(1, +oo), u ↦ u < 0)`
    stays unevaluated (it walked forever before), and
    `Any(Range(1, +oo), u ↦ u > 500)` is `True`. `ForAll` and `Exists` over
    a finite domain (`x ∈ [1, 2, 3]`, `x ∈ Range(1, 5)`) follow the same
    rule, and so does `ExistsUnique`, where a second witness decides
    `False`: `Exists(x ∈ [1, 2], (x = 2 ? err : x) > 5)` is the error (it
    was `False`), and an answer with a free symbol (`Exists(x ∈ [1, 2], x >
    n)`) keeps the quantifier unevaluated (it was `False`). Their domain is
    never walked past 1000 elements: a larger or infinite domain keeps them
    unevaluated.
    `Dedup` compares each element with the element before it, so a failed
    cell next to an element that is not the same expression gives the
    error: `Dedup([1, err, 1])` is the error (it is `[1]` if the cell is
    `1`), while `Dedup([err])` and `Dedup([err, err])` are `[err]`. `Dedup`
    evaluates a source that is not a lazy view once, with the numeric
    request of the evaluation (`Dedup([1/2, 0.5]).N()` is `[0.5]`), and
    works on that value, on the synchronous and the asynchronous route
    alike. The same rules apply to a
    valid lazy source that computes a failed element: with `h(2)` an error,
    `Element(5, Map(h, [1, 2]))`, `Contains(Map(h, [1, 2]), 5)`,
    `IndexOf(Map(h, [1, 2, 3]), 3)` and `Dedup(Map(h, [1, 2, 3]))` are that
    error, and `Element(1, Map(h, [1, 2]))` is `True`. Only a source that
    can hold a failed cell is read again for this check: an invalid
    collection, or a view that evaluates something for each element (`Map`,
    `Filter`, a comprehension), whose elements are memoized. A `Range` or an
    `Interval` keeps its arithmetic test (`Element(0.5, Range(1, 10^6))` is
    `False` with no walk), and an infinite source is not walked
    (`Element(0, Map(h, Range(1, +oo)))` stays unevaluated). A `List` or
    `Set` literal is read in full. A lazy view is read at most
    `maxCollectionSize` elements, and a read that stops there leaves the
    answer undecided, since a failed element can come later. A set
    operation over several operands gives a definite error that it finds
    in any operand, also when the walk of another operand stopped early.
    The `contains` handler of a valid view decides alone when it declines:
    `Filter` declines when its predicate gives an error for the searched
    value, and the membership stays undecided. A search over
    a valid source that its own handler leaves undecided stays undecided:
    `Element(1.5, Filter([1.5, 2.5], (n: integer) ↦ n > 0))` stays
    unevaluated.
  - **A nested failed cell.** A cell that is itself a `List` or `Set`
    holding an error (`[1, err]` in `[[1, err], 2]`) is a failed cell. An
    operator that demands its value answers the first error at any depth of
    the cell, never the inner list: `Mean([[1, err], 2])` and `Sort([[2,
    err], [1]])` are the error. A function applied to such a cell receives
    it as a value, as it receives any list (`Map(u ↦ 1, [[1, err], [3]])` is
    `[1, 1]`), and a broadcast reaches the inner list (`[[1, err], 2] + 1`
    is `[[2, err], 3]`). The helper is `failedCellError()`.

  A `Tuple` is not included: it is one value (a point), so a failed
  coordinate keeps the whole tuple frozen, and `f((1, err))` stays as it is.
  A `Map` cell whose argument is such a tuple is the tuple's error:
  `Map(u ↦ 1, [(2, err)])` is `[err]`, not the absence marker `NaN`.
  A lazy operator holds its operands as written: a held `List` or `Set`
  literal with a failed cell is bound when the operator reads it (the
  `canonical` getter binds such a literal, while it keeps any other invalid
  tree as it is), so `ce.box(["Sum", ["List", 1, ["Error", "'oops'"], 3]])`
  is the error on the box route as on the parse route.
  Compilation is unchanged: a tree that holds a failed cell does not compile.
  The predicates are `isIterableWithFailedCells` and
  `isInvalidNonCollection` (`boxed-expression/error-value.ts`).

  Absorption looks at operands, not arbitrarily deep through collection
  values: `Sin([err])` is not the error, it is the list `[err]` (the
  broadcast gives the cell to `Sin`), while `Sin(err)` bubbles. The operands of
  a lazy view are cells too: the rule is keyed on the `collection` handler
  block, so a view such as `Take`, `Reverse` or `Rest` keeps an error in any
  of its operands in place, its source collection included — with `n := 5`,
  `Reverse(n)` evaluates to `Reverse(Error(…))`, not to the error. Unlike a
  collection literal, the view is not opaque to an enclosing operator, which
  descends into it and bubbles the error: `Sin(Reverse(n))` evaluates to the
  error with the frames `{Reverse, 1}` and `{Sin, 1}`. The lazy operators
  that evaluate a held source (`Map`, `Filter`, `Differences` and the other
  operators listed in `docs/COLLECTIONS-MODEL.md`) are the exception for a
  source that is not a collection yet: when its value cannot be a collection,
  the error is the value of the node, so `Filter(n, f)` with `n := 5`
  evaluates to the error with the frame `{Filter, 1}`, while the literal
  `Filter(5, f)`, refused at boxing, keeps the error in place.
- **A non-function callee reports its own problem first** (`a := 5;
  a(err)` reports that `a` is not callable rather than bubbling the
  argument's error).
- **A selecting operator propagates only what it demands** — ratified
  2026-08-27 with Contract B, implemented 2026-08-28. An error in an
  operand such an operator never demands does not bubble at evaluation:
  `If(True, 5, err).evaluate()` is `5`, and so are `And(False, err)` →
  `False` and `Coalesce(5, err)` → `5`. The boxed expression still carries
  the error for editor diagnostics — static analysis sees dead code;
  evaluation does not execute it. This matches the declared lazy semantics
  ("lazy in unselected arms", `docs/LANGUAGE-MODEL.md`). The dual
  obligation holds: a handler that *does* demand an operand and gets an
  error propagates it (`If(False, 5, err)`, `If(err, 5, 7)`). The
  implementation DEFERS absorption past the handler rather than skipping
  it, which is what discharges the dual obligation automatically — an
  error the handler demanded is embedded in its result and bubbles from
  there. The scope is the `selectsOperands` definition flag, NOT laziness:
  most lazy operators demand every operand, and several answer something
  else entirely when a demanded operand is unusable, so they keep
  absorbing before the handler runs (§7, the 2026-08-28 entry).

  **The rule holds under composition.** It is a property of the
  expression, not of the root: `1 + If(True, 5, err)` is `6`,
  `Not(And(False, err))` is `True`, and `[If(True, 5, err)]` is `[5]`,
  each the same answer the selecting subexpression gives on its own. An
  enclosing operator therefore treats a selecting subtree as opaque when
  it looks for errors to absorb, and evaluates it like any other operand;
  what that evaluation *returns* is what bubbles. The dual obligation
  still holds one level up — `Sin(If(False, 5, err))` is the error,
  because the selection demanded the failing arm and the error is then
  the operand's value. A selection that is not decided yet
  (`If(x == 4, 5, err)` with a free `x`, `Coalesce(x, err)`) stays inert
  with its diagnostic in place: it has neither demanded nor rejected the
  failing arm.

  **The connectives with a failed operand** (decided 2026-10-19). `Or`,
  `And`, `Nand`, `Nor` and `Implies` use three-valued (Kleene) logic for an
  operand that evaluates to an error, so the answer does not depend on the
  order of the operands. An operand that decides the answer decides it
  wherever it is, also after a failed operand: a `True` operand of `Or` or
  `Nor`, a `False` operand of `And` or `Nand`, and for `Implies(p, q)` a
  `False` antecedent or a `True` consequent. So `Or(err, True)` and
  `Or(True, err)` are `True`, `And(err, False)` is `False`,
  `Nand(err, False)` is `True`, `Nor(err, True)` is `False` and
  `Implies(err, True)` is `True`. When no operand decides, the answer is the
  error of the first failed operand, in the written order, also beside an
  unknown or an absent operand: `Or(err, False)`, `Or(err, A)`, `Or(A, err)`,
  `Or(err, Missing)` and `Implies(True, err)` are the error. An operand that
  is not a boolean is such a failed operand, since canonicalization replaces
  it with an `incompatible-type` error: `And(1, False)` and `And(False, 1)`
  are `False`, and `And(1, True)` is the error. Evaluation still goes left
  to right and stops at the first operand that decides, so the operands
  after it do not run; a failed operand does not stop it, so the operands
  after a failed one run, with their side effects. Symbolic operands keep
  their rules (`Or(A, True)` is `True`, `Or(A, False)` is `A`). `Xor` and
  `Equivalent` have no operand that decides the answer, so an error operand
  stays the answer. `Any` and `All` follow the same rule over the cells of a
  collection (see "Membership and equality" above). Compiled code does not
  change: a tree that holds an error does not compile, and the fallback
  evaluates it by these rules. The handlers are `evaluateShortCircuit` and
  its async twin (`src/compute-engine/library/logic.ts`),
  `quantifierWalk` (`src/compute-engine/library/collections.ts`) and
  `foldQuantifierAnswers` (`src/compute-engine/library/logic-analysis.ts`).

**Why collapse at evaluation rather than stay inert.** Expressions are
immutable, so evaluating does not destroy the in-place, multi-error
document form — the caller still holds the boxed expression; `evaluate()`
*selects* a result, it does not overwrite the original. Given that, an
inert result would add almost nothing for diagnostics (the boxed form
already serves them, and an invalid tree already reports type `error`
unevaluated) while costing the value-consuming side: every host consumer
would have to search a tree for the failure certificate instead of being
handed one, breadcrumbs (the evaluation path — an exception's stack
trace) would not exist, and — decisively — invalid trees flowing inert
through evaluation would be pattern-matchable by every rule and handler,
so a rewrite like `x·0 → 0` could silently launder a malformed input into
a clean-looking value unless every rule carried its own validity guard.
Absorption makes "garbage never becomes a plausible value" a locally
checkable invariant enforced at one choke point. The dividing principle
for the exceptions above: **absorb where a value was demanded of the
error; freeze or skip where the error is merely stored or never
demanded** — `Sin(err)` demanded a value, `[1, err, 3]` stores one,
`If(True, 5, err)` never asks.

**`NaN` propagates by IEEE**: absorbing through numeric operations,
`Equal(NaN, NaN) → False`, orderings involving `NaN` are `False`.
Aggregates propagate it (`Max(1, NaN, 3) → NaN`) and absence-discharge
operators treat it as absent (`IsMissing(NaN) → True`) — with the
information loss stated in §1.

**`Indeterminate` propagates as `NaN` does, and keeps its name while no
float is involved** (shipped 2026-09-29). The propagate gate is the check
that runs before the handler when an operand of a `propagate` slot is
`NaN`-valued. It answers `Indeterminate` when every `NaN`-valued operand is
`Indeterminate` and no operand is inexact, and `NaN` otherwise:
`Sqrt(Indeterminate)`, `Sin(Indeterminate)` and `Factorial(Indeterminate)`
are `Indeterminate`, and `Arctan2(Indeterminate, NaN)` is `NaN`. The
`reject` policy is unchanged (an error). `Add` and `Multiply` are lazy and
do not run the gate, so their fold classes `Sum` and `Product` apply the
same rule themselves: `Indeterminate + 1` and `2·Indeterminate` are
`Indeterminate`; `Indeterminate + 1.5` and `Indeterminate·NaN` are `NaN`.
The reducers that do not run the gate — `Max`, `Min`, the statistics
reducers (`Mean`, `Median`, the variance family) and the quantile family —
apply the rule in their handlers: `Max(1, Indeterminate)` and
`Mean([1, Indeterminate])` are `Indeterminate`, and
`Max(Indeterminate, NaN)` is `NaN`. Any other handler that receives an
`Indeterminate` operand computes through its numeric kernel and answers
`NaN` (`GCD(Indeterminate, 2)` is `NaN`).
Absence checks and fallbacks treat `Indeterminate` and `NaN` alike:
`IsMissing` returns `True` for either, and `Coalesce` selects the fallback.
This does not change arithmetic propagation. Comparisons
(`Equal`, `Less`) with `Indeterminate` are `False`, and a Boolean context
(`And`, `Not`, `If`) rejects it with `incompatible-type`, as for `NaN`.
Provenance: `docs/plans/2026-09-28-indeterminate-value.md` §4 and §5.

**`Missing` propagates by Kleene** in comparisons (`Less(Missing, 1) →
Missing`) and preserves positional slots. Whether it omits a key during
record/dictionary construction remains open, as described in §1.
In a *numeric* slot, `Missing` is
normalized to `NaN` at the boundary (numeric domains absorb absence, per
§1), so numeric operators never need a `missing` arm; a `| missing` arm
survives only on data/object-domain results.

The comparisons are the exception (user decision 2026-10-23, ROADMAP CE-93):
a comparison with an absent operand is `Missing`, in a numeric slot too, as
the condition of an `If` reads it. With `w: number | missing` holding
`Missing`, `w > 0` is `Missing` (typed `boolean | missing`) and
`If(w > 0, 1, 0)` has no value; before, the slot read its absent value as
`NaN`, and `w > 0` was `False` while the `If` had no value. A `NaN` is a
value, and a comparison with it keeps the IEEE answer. Compiled code reads
the absent object the host passes (`undefined` in JavaScript, `None` in
Python) the same way; on the GPU targets an absent number can only be `NaN`,
so a comparison there keeps the IEEE answer. One case compiled numeric code
cannot tell apart: a nested `If` with no else branch is `NaN` there and
`Missing` in the interpreter, so a comparison on it is `false` in compiled
code.

The normalization is to the marker of the CODOMAIN, exactly as rule 4 of §2
states. The codomain is read off the type of the application itself, with
its `missing` arm stripped, not off the operator's declared result: the
answer is `NaN` when that type is a subtype of `number`, and `Missing` when
it is a point, a collection, or any type that is not provably numeric. An
absent addend or an absent factor beside a tuple makes the whole point
absent under the mathematical-point arithmetic contract. Explicit data-tuple
construction has a different rule: it preserves every coordinate, including
`Nothing`, `Missing` and `Undefined`. `(Missing, Missing)` is a present pair,
not `Missing`; indexing it returns a missing coordinate, and its count is two.
A user function that explicitly rebuilds a tuple from the coordinates of an
absent point therefore returns a present tuple of missing coordinates.
`Zip` follows the same construction rule, preserving row and coordinate
alignment even when every coordinate of a row is missing.
For example, with `P` declared `list<tuple<number, number, number>>`
and holding two points, the out-of-range access `P[0]` is `Missing`, so
`2 · P[0]` is `Missing` — an absent point scaled is an absent point — and
`2 · P[0] + (1, 1, 1)` is `Missing` in turn. It was the scalar `NaN`
before, which then failed against the point operand with an
`incompatible-type` error. An all-numeric absence is unaffected:
`2 · Missing` is still `NaN`. One boxing-time exception,
ruled 2026-09-09: a big-operator bound WRITTEN as the literal `NaN` or the
symbol `Missing` (`Sum(x, (x, NaN, 3))`) is a program defect and is
rejected at boxing with a type error, like a string bound; a bound that only
EVALUATES to an absence (a piecewise call with no matching arm) is a
run-time value and the operator answers `NaN`. The per-operator policy — an
operator can reject, propagate, handle, or pass through an absent operand
— is the `missingBehavior` mechanism in
`src/compute-engine/types-definitions.ts`; elementwise and broadcast
interactions follow `docs/COLLECTIONS-MODEL.md` and
`docs/BROADCAST-MODEL.md`.

The tuple constructor no longer performs all-absent point normalization.
Whole-point absence still propagates through point arithmetic; further point
normalization must be specified by the mathematical operation rather than by
erasing an explicitly constructed data tuple.

`Nothing` is omitted when constructing an ordinary list;
`Missing`/`NaN` preserve positions. Statistics over a constructed list
therefore see no erased `Nothing` cells. The selected aggregate policy
also skips immediate `Nothing` results in raw lazy views, without changing
their raw counts or indices. This is implemented for sums, products, extrema,
and univariate statistics. Binning, ordering, and custom-fold policies remain
separate; see §1 and the design note.

**`Undefined` in a numeric slot takes the same route as `Missing`** (ruled
2026-09-21). The `Undefined` symbol names a value that does not exist. When
it reaches a numeric slot of an operator whose missing behavior is
`propagate`, the absence gate normalizes it to the codomain's marker exactly
as it normalizes `Missing`: `Cos(Undefined)` is `NaN` under `evaluate()` and
under `.N()`, `Undefined + 1` is `NaN`, and an `Undefined` cell of a list
under a broadcast head is `NaN` at that position. This closes the gap with
the compiled lanes, which already answered `NaN` for the same input, and with
the `Add` fold, which already read `Undefined` as `NaN`. A bare `Undefined`
still evaluates to itself and its declared type is still `unknown`. That is
a current representation mismatch to address during the inference-marker
migration: known absence must not be hidden as merely unresolved type
information. The numeric gate and its async twin share `isAbsentScalarSymbol`
(`src/compute-engine/boxed-expression/validate.ts`).

**The operators that OWN their absence semantics read `Undefined` as absent
too** (ruled 2026-09-22, extending the rule above). When an operator declared
`missingBehavior: 'handle'` reads a `Missing` element or operand as absent, an
`Undefined` element or operand is absent in the same way, and answers the
same: `Mean([1, Undefined, 3])` is `NaN`, as `Mean([1, Missing, 3])` is; so
are `Median`, the variance family, `Max`/`Min`, `Quantile` and `Covariance`.
`IsMissing(Undefined)` is `True`, `Coalesce(Undefined, 2)` is `2`, a chained
`At` absorbs an `Undefined` base or index, and `Count`/`Tally` treat an
`Undefined` cell exactly as a `Missing` one (both count it — neither erases a
position). Until this ruling those operators read `Undefined` as an ordinary
value, so `Mean([1, Undefined, 3])` stayed symbolic. Arithmetic consumers use
`isAbsentValue` (`src/compute-engine/boxed-expression/type-guards.ts`), which
excludes exact `Indeterminate` so those consumers can preserve it. The
explicit checks and fallbacks use `isMissingValue`, which includes both
numeric markers. Both share `isAbsentSymbol` with the numeric gate's
`isAbsentScalarSymbol`; the symbol test recognizes `Missing` and `Undefined`.

Two families are deliberately NOT covered, because their scalar arm reads the
`Missing` symbol BY NAME on a separate Kleene route rather than through that
predicate: the relational operators (`Equal`, `Less`, …) and the boolean
connectives (`And`, `Or`, `Not`). `Equal(Undefined, 1)` is still `False` where
`Equal(Missing, 1)` is `Missing`, and `And(Undefined, True)` answers
`Undefined` where `And(Missing, True)` answers `Missing`. The
whole-collection comparison of the next section is an exception inside that
family: it tests the cells with `isAbsentScalarSymbol`
(`absentCollectionComparison`, `library/relational-operator.ts`), so
`Equal([1, Undefined], [1, Undefined])` already answered `Missing` at the
2026-09-21 ruling. Its element-wise sibling does not — `Equal([1, Undefined], 1)`
is `[True, False]` where `Equal([1, Missing], 1)` is `[True, Missing]`.

**The two symbols that name an absent datum — `Missing` and `Undefined` — are
read alike by the comparison operators, by the logical connectives, and by the
handlers that own their absence semantics** (user ruling of 2026-09-22).
`Equal(Undefined, 1)` is `Missing`, `Not(Undefined)` is `Missing`,
`First(Undefined)` is `Missing`, and `Distance(Undefined, (1, 1))` is `NaN` —
each the answer the same expression gives for `Missing`.

**A comparison of two COLLECTIONS asks about the collections as a whole, and
one element pair with no answer leaves that whole question unanswered** (user
ruling of 2026-09-21). `Equal` and `NotEqual` then answer the marker of this
section — `Missing` in the interpreter, `NaN` in compiled code — and never a
confident truth. An absent cell (`Missing` or `Undefined`) on either side is
what makes a pair undecided: the cell can stand for any value, so no walk of
the cells that ARE there can tell whether the two collections hold the same
values. The rule holds even when another pair is decidedly unequal:
`Equal([1, Missing, 3], [2, Missing, 3])` answers `Missing`, not `False`, and
the compiled kernel answers `NaN`, not `false`. `NotEqual` answers the same
marker, because a question with no answer has no answer under negation
either. Three shapes stay decided: a length mismatch is `False`, since no
value an absent cell could hold makes 2 elements equal 3; a cell pair of
different shape — a nested list against a scalar — is `False` whatever the
cells hold; and a pair left undecided by FREE VARIABLES is not absence, so
`Equal([x], [y])` stays inert, exactly as the scalar `x = y` does, which keeps
a list equation usable as an equation. This is the whole-collection shape
only: the element-wise shape, a collection against a scalar
(`Equal([1, Missing], 1)`), still marks exactly the absent POSITIONS and
answers `[True, Missing]`. Branching on the marker takes no arm, not the else
arm and not the absent-condition error, because the marker reports an
undecided COMPARISON, not absent condition data:
`Which(Equal([1, Missing], [1, Missing]), 1, True, 0)` answers `Missing`, and
the compiled kernel answers `NaN`, the same answer a condition resting on a
`NaN` operand already gives. The marker passes through `Not`, `And` and `Or`
by the ordinary Kleene table, so a settling sibling still decides the branch.

**A WRITTEN absence symbol lowers to the target's object-domain null** —
`undefined` on JavaScript, and the target's numeric marker where there is no
object axis (the shader targets, the interval target) or where the object null
would break the numeric library (the Python target spells `math.nan`, since
numpy raises on `None`). It is
a value the compiler spells out, not a free variable the caller supplies, so
`compile(Missing).freeSymbols` is empty; the object null rather than the
numeric marker, because the whole-collection rule above must keep an absent
cell distinct from a `NaN` one, and each target's numeric absence test
therefore reads the object null as absent too (2026-09-22).

**A Python caller passes `None` for an absent INPUT, and compiled arithmetic
reads it as `NaN`** (user decision 2026-10-25, ROADMAP CE-395). With
`p: number | missing`, `p + 1`, `1 / p` and `np.sin(p)` raised a `TypeError`
for `p = None`, where the interpreter answers `NaN` for `Missing + 1` and
compiled JavaScript gives `NaN` (`undefined + 1`). The compiled code now
reads such an input as `(float('nan') if p is None else p)` at a numeric
parameter of an operator that propagates absence (`Add`, `Divide`, `Sin`:
`resolvedMissingBehavior` is `propagate`). Only an input (a free symbol, a
parameter of `compileFunction`/`compileLambda`, a `vars` source) whose type
states that it admits `missing` (`number | missing`, `any`; not the inference
marker `unknown`) pays for the test. An operator that handles absence keeps
the `None`: a comparison keeps its `is None` test, so `p ≠ 0` stays undecided
(`None`) for an absent `p`, and `Max(p, 5)` ignores it.

**An absent OBJECT in compiled arithmetic is the object null too** (user
decision of 2026-09-27). On the JavaScript target, arithmetic whose operand
is an absent point, tuple or list (`2·P\{c\}`, `P\{c\} + Q`, `L\{c\} + 1`)
answers `undefined` for the whole value, and a list of points answers
`undefined` in each absent cell; before, the same static type gave three
spellings (`undefined` for a read, `[NaN, NaN]` for point + point, `NaN` for
scalar × point). A numeric read of an absent object (`PointX(P\{c\})`,
`|P\{c\}|`) is a numeric slot and stays `NaN`. The interpreter fallback of a
compiled function spells an absent result by the type of its position, so it
gives the same answers. Code for operands that cannot be absent is unchanged
(`_SYS.bcastAbsent` is emitted only when a static type admits `missing`).

**Absent values in collection operators: five rules** (user decisions of
2026-09-26; the design record with the precedent for each rule is
`docs/plans/2026-09-26-absent-values-in-collection-operators.md`; the tests are
`test/compute-engine/collections-absent.test.ts`). "Absent cell" means an
element that is `NaN`, `Missing` or `Undefined`; "absent collection" means the
whole operand is `Missing` or `Undefined`. The rules rest on the two notions of
"same" the engine already keeps apart: structural identity (`Same`, `isSame`),
under which a marker is the same as itself, and value equality (`Equal`), under
which `NaN` equals nothing and `Missing` compared with anything is `Missing`.

- **A. Positional operators keep an absent cell in place.** `Length`, `Count`
  of a collection, `Join`, `Append`, `Insert`, `Reverse`, `Take`, `Drop`,
  `Zip`, `Sort`, `Unique`, `Tally`, `Map`, `At`, `First`, `Last`. An absent
  cell is a position like any other: `Length([1, Missing, 3])` is `3`,
  `Append([1], Missing)` is `[1, Missing]`, `Sort` puts absent cells last,
  `Unique` and `Set` keep one absent cell (by structural identity, so
  `Unique([Missing, Undefined])` keeps both), and `Map` applies the function
  to the cell, which answers by its own absence rule (`Map(x ↦ 2x, [1,
  Missing, 3])` is `[2, NaN, 6]`, typed `list<number>`). Only an explicit
  removal shortens a collection: `Nothing` in a literal, or a `Filter` on
  `IsMissing`.
- **B. Aggregates propagate.** `Sum`, `Product`, `Mean`, `Median`, `Max`,
  `Min`, the variance family, `Quantile`, `Reduce`: one absent cell makes the
  aggregate the marker of its codomain, `NaN`. The empty collection answers
  the identity (`Sum([])` is `0`), not a marker. Skipping is opt-in, by
  removing the cells first.
- **C. Search is structural: a marker is found where the same marker sits.**
  `Contains`, `IndexOf`, `Element`, `NotElement`, `Count(xs, value)` compare
  by structural identity, the notion `Unique`, `Set` and `Tally` use.
  `IndexOf([1, NaN], NaN)` is `2`, `Contains([1, Missing], Missing)` is
  `True`, `Element(NaN, [1, NaN])` is `True`. A marker cell matches only the
  same marker, so the other cells decide every other answer:
  `Contains([Missing, 5], 5)` is `True`, `Contains([1, Missing], 5)` is
  `False`, and `IndexOf([1, NaN], Missing)` is `0`. A search never answers a
  marker, except for an absent collection (rule E). The needle is read as a
  VALUE, so a needle that evaluates to `NaN` (a restricted number whose
  condition failed) is found where `NaN` sits, and a needle that evaluates to
  `Missing` (a `Which` with no selected branch) is not. This is the majority
  precedent for container membership (JavaScript `includes`, R `match`,
  Julia `isequal`, Mathematica `Position`, Python `in`); it replaces the
  unpublished rule of the same day under which a marker was never found.
  Membership and comparison are different questions: `NaN = NaN` stays
  `False` and `Equal([1, Missing], [1, 5])` stays `Missing`.
- **D. Selection keeps only a decided `True`; the quantifiers are Kleene.**
  The predicate is applied to each cell, and a comparison answers `Missing`
  for a `Missing`/`Undefined` cell (Kleene) and `False` for a `NaN` cell
  (IEEE). `Filter`, `Count(xs, p)`, `CountIf`, `Position`, `IndexWhere` and
  `Find` read a `Missing` answer as "not selected": `Filter([1, Missing, 3],
  x ↦ x > 0)` is `[1, 3]` and `Count([1, Missing, 3], x ↦ x > 0)` is `2`,
  the rule of a database `WHERE` clause; `Partition` puts such a cell in the
  false group. `Any` and `All` combine the answers by the Kleene table of
  `Or` and `And`: `Any([1, Missing, 3], x ↦ x > 2)` is `True`, `Any([1,
  Missing], x ↦ x > 2)` is `Missing`, `All([1, Missing, 3], x ↦ x > 0)` is
  `Missing`, `All([1, Missing, -1], x ↦ x > 0)` is `False`. A symbolic answer
  (`x > n` with `n` free) still keeps a quantifier inert, because evidence may
  still arrive. A predicate that answers `True` on the marker selects it
  (`Filter(xs, IsMissing)`), which is how the markers are located. The
  implementation is `selectionVerdict` and `evaluateQuantifier` in
  `src/compute-engine/library/collections.ts`. Before this rule `Count` threw
  and `Filter` returned its error message as a value on an absent cell.
- **E. An absent collection makes the whole result absent** (ruled
  2026-09-26, above): `Length(Missing)` and `IndexOf(Missing, 3)` are `NaN`,
  `Reverse(Missing)` and `Contains(Missing, 3)` are `Missing`. `NaN` in a
  collection slot is a number, not an absent collection, so `Length(NaN)` is
  the same `incompatible-type` error as `Length(5)`, and `Join([1], NaN)`
  lifts the scalar to `[1, NaN]`.

On the compiled routes, rule C holds through SameValueZero element tests
(`includes`, and `_SYS.eqt` on JavaScript; `_ce_same` on Python, whose float
leaf reads `nan` as the same as `nan`). Two refusals keep them faithful: a
needle that may be a COMPUTED absence (its type has a `missing` arm, and it is
not the written symbol) is not compiled on JavaScript, because an unselected
numeric `Which` lowers to `NaN` there and would be found where `NaN` sits; on
Python the written symbol is refused as well, because it lowers to `nan`. For
rule D, `Any` and `All` over a collection whose element type has a `missing`
arm are not compiled on either target, because `some`/`every` cannot answer
`Missing`; the selecting operators need no refusal, since "not decidedly true"
is "not selected" on both routes.

**A collection whose elements may be absent is admitted where a collection of
present values is expected** (user decision of 2026-10-07). A dictionary lookup
or an index with a computed key is typed `T | missing`, so a `Map` over such
reads is typed `list<T | missing>`, even when every element exists. One value
typed `T | missing` is admitted at a parameter that expects `T`, and the
operator checks the value at run time: with `xs = ["a", "b"]`,
`ToUpperCase(xs[3])` is accepted when the call is boxed, and evaluates to the
error "expected `character | string`, got `missing`". A collection of such
values is now admitted in the same way. At a parameter whose type is a
collection kind (list, set, collection, indexed collection, tuple, dictionary,
record), an operand whose element types, tuple components, dictionary values or
record fields have a `missing` member is admitted when the operand, with every
`missing` member removed, fits the parameter. "Fits" is the test for any other
collection operand: a subtype of the parameter, or not refuted by the deferred
collection test. So `list<missing | string>` is admitted at
`collection<character | string>` and at `list<string>`, `list<integer |
missing>` at `collection<number>`, and a symbol declared
`collection<string | missing>` at `collection<string | character>`, while
`list<string>` is still refused at `collection<integer>`. The rule reads the
type of the operand, not where the type came from.
The subtype relation keeps the written element constraint:
`list<missing | string>` is not a subtype of `collection<string>`, and
the admission is made by argument validation alone
(`absentElementsMatchParam`, `boxed-expression/validate.ts`). Bare `list`, `set`,
`dictionary`, `collection`, and `indexed_collection`
now admit unrestricted contents, just like their explicit `<any>` forms.
Bare tuple and record likewise cover their entire families. Explicit content
contracts such as `list<string>` or `list<expression>` retain their restrictions;
a missing whole list is still different from a list containing missing cells.
The inference-marker role of `unknown` is implemented (2026-10-21).
The current `NaN`-to-`Missing` repair in `boxed-expression/validate.ts`
applies only within nested `List` expressions, not to record/dictionary
values.

A collection containing only missing data is not universally refused.
`Map(x ↦ x + 10, [Missing, Missing])` is accepted and yields `[NaN, NaN]`;
a text consumer such as `StringJoin` refuses an all-missing collection.
Acceptance depends on the operation's argument policy, not just the fact
that the element type is `missing`. The transform for deferred checking
strips `missing` from a scalar operand (`stripMissingFromType`, through
`stripMissingFromElements` in `src/common/type/utils.ts`), so the scalar case
and the collection case cannot give different types.

At run time, the operator that reads an absent element decides, by the rules
above and by its `missingBehavior`. A text operator answers the error a scalar
absent operand gets, and the error names the element: `StringJoin(["a",
Missing, "b"])` and `Trim("xax", ["x", Missing])` are "expected `character |
string`, got `missing`" at `Missing` (an `Undefined` element is absent too,
because a list types it as a `missing` cell). An aggregate answers `NaN` (rule
B), a positional operator keeps the cell (rule A), and a selection skips it
(rule D). In Epsil, `stringJoin(map(i => xs[i], [1, 2]), "")` is `"ab"` with no
diagnostic, and with the indices `[1, 3]` the static check accepts the program
and the run answers that error. The `??` operator at the element
(`xs[i] ?? ""`) is still the way to supply a fallback instead.

Because errors absorb *before* ordinary handlers run, an ordinary
operator handler never receives an error operand and needs no error
tests — laziness does not change that, since a lazy handler that demands
every operand is served by the same pre-absorption. A **selecting**
handler (`selectsOperands`) is the exception: it runs on the invalid tree
and owns propagation for the operands it demands. An operator that wants
to *see* errors must be declared an observer. Any
future recovery operator (an `IfError(expr, fallback)` in the style of
Mathematica's `Check`) would be built on the same `inspectsErrors` flag
plus a hold on its first operand; the mechanism already exists.

## 4. What a signature promises — RATIFIED 2026-08-27: Contract B adopted

(Contract B below was adopted 2026-08-27 as part of the numeric-lattice
ratification package — decision record:
`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`, ruling R-A.
Contract A remains documented as the status quo being migrated away from.
The per-operator signature style — precision versus readability, leniency,
boxing-time versus evaluation-time surfacing — is governed by
`docs/SIGNATURE-GUIDELINES.md`.)

The shared core, in either contract:

> **The declared result type of a signature constrains *successful* values.
> It does not assert that the function is defined for every argument
> admitted by the parameter types.**

This is the optimistic (partial-function) reading, and it is what every
practical language does: a Java `int f(int)` may still throw; Haskell's
`head :: [a] -> a` is partial on `[]`. Two consequences hold under both
contracts below:

- **Evaluation failure is implicit; ordinary signatures need not append
  `| error`.** A successful-value signature does not guarantee that
  evaluation succeeds. This is distinct from explicitly describing error
  content with `error`, a union containing it, or `any`.
- **Input positions need no `| error` either**: §3's absorption guarantees
  a non-observer strict handler never receives an error operand.

The following contracts distinguish what declared types *describe*; Contract
B was adopted, while the broader presence questions remain in the design
note. A signature is
asked to do three jobs at once — **admission** (what input is a type
error), **domain description** (where the successes live), and
**documentation** (what a user, a doc page, or an Epsil hover learns) —
and the two contracts split those jobs differently. Take `Heaviside` as
the running example: its truth is "defined exactly on the real line
(`H(±oo)` included), where it takes exactly the values 0, ½, 1".

### Contract A — admission signatures (historical model being migrated away from)

The parameter type is the admission contract and must stay wide enough for
anything the operator should quietly tolerate: `NaN` types as bare
`number`, so a numeric parameter narrower than `number` turns a quiet
runtime `NaN` into a boxing-time `incompatible-type` `Error` under the
current checker (verified 2026-08-24: with `f` declared
`(real) -> number`, `f(NaN)` boxes as `f(Error(incompatible-type))`). The
declared result type must likewise stay wide enough to admit failure
values. So `Heaviside` declares `(number) -> number`, and the sharp truth
lives only in the per-operator type handler (`realOnlyStepType` answers
`rational<0..1>` for a proven-real argument, wide `number` otherwise).

The cost, and it is real: **the public signature is nearly
information-free.** The most valuable facts about the operator — its
domain, its exact success values — are invisible in the API surface, the
generated documentation, and any tool that reads signatures; they exist
only as an implementation detail of the typing layer.

### Contract B — domain signatures — Ratified 2026-08-27 (as amended by both review rounds)

A definition declares **three separable facts**, of which only the first
is mandatory:

1. **The carrier signature** `(D₁, D₂, …) -> S`: each parameter's
   mathematical domain type, and the exact success type. Prefer the
   *precise* carriers — `real`, `complex`, `integer` — over bare
   `number`: since `NaN` (and `~oo`) inhabit only `number`, writing bare
   `number` as a parameter type smuggles the exceptional points into the
   domain and blurs the policies below. Bare `number` in a signature
   should be read as a smell.
2. **A per-parameter NaN policy** `nanBehavior: propagate | handle |
   reject`, symmetric with the existing `missingBehavior`. `propagate` —
   a `NaN` in this slot makes the application evaluate to `NaN`.
   `handle` — the handler sees the `NaN` and answers in its own codomain
   (membership predicates: `IsPrime(NaN) → False`). `reject` — `NaN` in
   this slot is a contract violation → `Error` (an index, a digit count,
   a dimension). The default is derived per parameter by a *mechanical*
   test — the conformance sweep depends on it being computable from the
   declaration alone: `propagate` when the slot's carrier is a subtype
   of `complex` that is **not** a subtype of `integer`, *and* the result
   type is numeric; `reject` otherwise. So `At(xs, NaN)` and
   `N(expr, NaN)` (integer slots) reject with no annotation, and `Sin`
   and `Heaviside` propagate with no annotation. The test is a default,
   not an inference of role — an integer slot can be a mathematical
   operand rather than an administrative index (`GCD`), and such an
   operator overrides explicitly. `handle` is always an explicit opt-in
   — a boolean codomain never implies the handler understands `NaN`.
   `propagate` is only *legal* on declarations whose result type is
   numeric: a quiet failure must speak the codomain's vocabulary
   (rule 4), so a non-numeric-result operator handles or rejects.
3. **A partiality declaration.** Being inside the carrier types does
   **not** prove success — `Mod(1, 0)` has both arguments proven finite
   integers and still has no answer; `0 · oo` makes a `nan` value
   (`Indeterminate` on the exact route, `NaN` under `.N()`) from
   `NaN`-free inputs. Two *distinct* kinds of condition attach to a
   declaration, because they feed different channels — the distinction
   is central to the taxonomy:
   - **`definedWhen(args)`** — the *mathematical* domain condition;
     false → the rule-4 marker (`Mod`: `definedWhen: b ≠ 0`).
     `partiality: total` is the claim that no such condition exists
     (`Heaviside` on `real`); `may-marker` concedes a domain failure is
     possible without naming the condition. **Omitted partiality means
     `may-marker`** — the sound default; inferring `total` would
     recreate the `Mod(1, 0)` unsoundness. Authors opt into `total`, or
     supply the predicate so the gate — or a static analysis — can
     discharge it and recover sharpness.

     **RULED 2026-09-01: the omitted default is a RUNTIME contract only
     — it does not add `| nan` or `| missing` to the result type.**
     With no `partiality` declared, the
     value of an application may still be the codomain marker at
     runtime (rule 4 of §2, the `definedWhen` gate, and NaN propagation
     all keep their obligations), but the derived application type
     retains the success type `S` unless more specific typing applies.
     The rationale was to avoid adding the marker indiscriminately: a
     default alone cannot distinguish applications that return present
     results from those that can produce a marker. Spelling it on every
     handler-less head would lose precision (measured
     2026-09-01: binding `S | marker(S)` engine-wide broke 412 tests
     across 86 suites, turning `vector<integer^3>` into
     `list<integer | nan^3>`). For a numeric codomain this also matches
     the IEEE expectation that any numeric value may be `NaN` and that
     `NaN` propagates. A type therefore describes the *successes*; the
     result type says `| nan` (or `| missing`) exactly when an author
     DECLARES the partiality
     (`partiality: 'may-marker'`, or a `definedWhen` predicate that the
     arguments do not discharge) or the operands PROVE it (a provably
     `NaN` argument in a propagating slot). `total` stays meaningful as
     the stronger, auditable claim that even the runtime cannot produce
     the marker. The same holds on the INPUT side, for the same reason
     `| error` is never spelled there: an operand may arrive as a marker
     (`Length(First(t))` receives `Missing` when `t` is empty) without
     the parameter type saying so, and the per-parameter
     `missingBehavior` / `nanBehavior` policies govern what happens —
     a `propagate` slot absorbs it to the result marker, `reject`
     errors, `handle` lets the handler answer.

     **Clarification:** this rule describes the existing successful-value
     convention, not proof that markers cannot occur. For example,
     `Length(Missing)` produces `NaN`. Analysis and compiled code must not
     use the absence of a displayed marker union as a presence guarantee.
     Preserving known absence while keeping concise signatures is part of
     the design note; it does not require turning `unknown` into a content
     type that excludes markers.

     `may-marker` also covers
     *numeric-route* failures, not only mathematical ones: an exact
     value whose float image is not representable produces the marker
     too (`Sin(10000i)` is mathematically finite, but `.N()` overflows
     to `NaN` — verified 2026-08-25), so `total` asserts
     representability on the numeric route as well as mathematical
     definedness.
   - **`requires(args)`** — a *contract* precondition; false → `Error`
     (`MatrixMultiply`: `requires: columns(a) = rows(b)`; an option
     value in range; a well-formed index kind). This is the declared
     form of §2 rule 6.

   Both attach **per overload**, not to the operator as a whole.
   Mathematical domains can be *relational*, so the framework
   centralizes the mechanics but the operator supplies the condition:
   as a declared predicate, or as a check inside the handler routed to
   the matching channel.

**A declared type is a contract on every value the symbol takes — decided
2026-10-21 (decision P1 of
`docs/plans/2026-10-21-presence-contracts-and-assertion.md`), reversing the
rule of 2026-09-09.** From 2026-09-09 to 2026-10-21 an assignment removed the
value's `missing` member before the subtype test, so `ce.declare("s",
"string")` followed by `ce.assign("s", Missing)` bound, and `s` reported
`string` while evaluating to `Missing`; the rule had been written for a
restricted value `3 {a > 0}`, which then typed `integer | missing`. Since the
decision of 2026-09-25 a numeric restriction masks to `NaN` and types
`integer | nan`, which `number` admits with no strip, so the strip admitted
exactly what a contract should refuse: the bare markers `Missing` and
`Undefined`, and a restricted non-numeric value such as `(1, 2) {a > 0}`
(typed `missing | tuple<integer, integer>`). Now the value is checked as it
is: `s: string` refuses `Missing` and `Undefined` as it refuses `5`; a
declared element contract is checked too (`xs: list<string>` refuses `["a",
Missing]`, decision P1b); `string | missing`, `any`, and a refining
declaration (`list`, `list<unknown>`) admit absence; a `number` declaration
admits `NaN`, while `real`, `integer` and `complex` hold finite values and
refuse it (`real | nan` admits it). The Epsil static check (`declaredTypeMismatch`,
`static-diagnostics.ts`), the Epsil run time and the engine's assignment
route (`matchesDeclaredTypeAxes`, `effects-inference.ts`) agree. The reader
of a declared symbol can trust the declaration; an inferred type keeps its
`T | missing` member as before. The assumption check still asks what a value
is when it is present (`presentedValueType`), because an assumption is a
constraint on the present value. Pinned by
`test/compute-engine/declared-contract-presence.test.ts`.

**An absent argument at a library parameter that excludes absence is refused
— decided 2026-10-21 (decision P2).** The resolved absence behavior of an
operator (`resolvedMissingBehavior`, `boxed-operator-definition.ts`) used to
leave the `pass-through` class with no rule: the handler received the absent
value and answered as it happened to (an error value from `ToUpperCase`, a
value computed from the marker by `Parse` or `IsSquareMatrix`, the marker
from `ToCNF`). Now `refusesAbsentOperandAt(i)` gives one default: an absent
scalar operand at a position whose declared parameter type excludes absence
and is read as data (not a number, a collection, a function, `expression`,
`symbol`, `any` or `unknown`) is an `incompatible-type` error naming the
parameter, the answer a user function gives for the same argument. A
declared `handle`, a resolved `propagate`, an operator that holds its
operands (`lazy`, a hold class other than `evaluate`) and a function literal
are exempt. The Epsil static check reports a possibly absent argument at
such a parameter, as it does at a `function`'s annotated parameter
(decision P3), and narrows a symbol an `isMissing` guard proves present
(`presence-narrowing.ts`). The presence assertion `x?!` (`AssertPresent`,
`library/core.ts`) is the third discharge beside `??` and a guard: the value
when present, an `expected-present` error when absent (decision P4). Pinned
by `test/compute-engine/absent-argument-library-default.test.ts`,
`test/compute-engine/assert-present.test.ts` and
`test/epsil/presence-narrowing.test.ts`.

**An absent argument at an annotated parameter of a function literal —
RULED 2026-09-30.** A function literal with at least one annotated
parameter (an Epsil `function`, a lambda `(p: T) ↦ …`) checks each
argument against the annotation when it is applied. It does not use the
`missingBehavior` policy of a library operator: before this ruling, such a
function whose parameters were all numeric or collections resolved to
`propagate` and answered the absence marker without running its body,
while the same function declared through `ce.declare` with a signature
answered an error. The rule, for the value bound to one parameter:

- annotated with a type that has no `missing` member (a point, a list, a
  string): an absent value is an `incompatible-type` error.
  `f(p: tuple<number, number>) = p[1] + 1` answers
  `Error(ErrorCode("incompatible-type", "tuple<number, number>", "missing"), "Missing")`
  for `f(Missing)`;
- annotated with a numeric type (`number`, `integer`, `real`): the absent
  value is read as `NaN`, the marker of a numeric domain (§3), and `NaN` is
  accepted there (next ruling). `f(x: real) = x + 1` answers `NaN`;
- annotated `T | missing`: the body receives the absent value;
- not annotated: the body runs with the absent value, as it does for a
  function with no annotation at all.

The type of the call is the type of a success, with no `missing` member
added for an argument that may be absent. At boxing the engine still
admits an argument typed `missing | T` at a parameter annotated `T`
(`enforcesParameterAnnotations`, `boxed-operator-definition.ts`): the
value is usually present, and a LaTeX document has no notation to remove
the absent case from `P[i]`, `First(xs)` or a restricted point. An
argument typed `missing` alone (the literal `Missing`) is absent on every
route and is refused at boxing. The Epsil static pre-pass is stricter and
also reports the argument that may be absent (`refusesAbsentArgument`,
`boxed-expression/validate.ts`), because an Epsil author can write
`first(xs) ?? fallback`. What remains open (a declared scalar parameter on
the declare-then-assign route, compiled code) is in `ROADMAP.md`.

**A user function accepts `NaN` at a numeric parameter — RULED
2026-09-30.** `NaN` is what a numeric computation answers when it has no
value: a restricted number whose condition fails, a read past the end of a
list of numbers, `0/0` with a float. In the lattice `nan` is a member of
`number` and not of `integer` or `real`, so `f(n: integer)` refused an
argument that `f(n: number)` accepts, an Epsil `function` answered an
`incompatible-type` error where the same body declared through
`ce.declare` answered `NaN`, and the literal `NaN` was refused at boxing on
both routes. A user function with one clause (a function literal, a
function held as a value, an Epsil `function` with one parameter list) now
accepts a `NaN` argument at every parameter typed with a numeric type, at
boxing (`acceptsNaNArgument`, `boxed-expression/validate.ts`) and when it is
applied (`acceptNaNAtNumericParams`, `function-utils.ts`). A function with
several clauses does NOT accept `NaN` at a numeric parameter (user decision
2026-10-17, which amends this ruling): the clauses are selected by the value
of the argument, and no clause is the correct one for `NaN` (`fib(NaN)` with
the clauses `fib(0)`, `fib(1)` and `fib(n: integer)` would select `fib(0)`, or
recurse on `NaN − 1` until the recursion limit). With the clauses
`f(n: integer)` and `f(s: string)`, `f(NaN)` is
`Error(incompatible-type, "integer | string", NaN)`, and `f(x)` with
`x: number := NaN` is the same error with the type `number`; the one-clause
`g(n: integer) = n + 1` gives `g(NaN) = NaN`. A clause whose parameter is
the literal `NaN` (`f(NaN) = 0`) still matches `NaN`. The function is
applied and its body computes with `NaN`: this is not a `propagate`
policy, and the conservative floor of §4 (a user callable has unknown NaN
behavior) is unchanged. `Indeterminate` is accepted in the same way. A
number that is not `NaN` is checked as before (`1.5` at `integer` is
refused), and library operators keep their own `NaN` policy.

**A declared scalar parameter is checked against the evaluated argument —
RULED 2026-09-30.** A function declared with
`ce.declare(name, { signature })` and then assigned its body was checked at
boxing only, against the static type of each argument. A NON-SCALAR
declared type (a point, a list) is written on the stored literal and the
application checks it; a scalar one is not written, because that would
change how the body is canonicalized, so nothing checked the value: `f`
declared `(integer) -> unknown` answered `2.5` for an argument whose value
`1.5` is known only at evaluation, a declared `string` parameter received
`Missing`, a declared `boolean` parameter received `5`. The evaluated
arguments are now checked against the scalar parameter types of the
declaration before the function is applied (`declaredScalarConformance`,
`boxed-expression/boxed-function.ts`), and a value that does not fit is the
`incompatible-type` error an Epsil `function` with the same annotation
answers. Not checked: a symbolic argument; a collection or a point at a
scalar parameter of a function that broadcasts (the function is applied to
the elements); a slot declared `unknown` or `any`; `NaN`, and an absent
value, at a numeric parameter. An absent value at another scalar parameter
is refused unless the declared type has a `missing` member.

**An accessor states the absent case only when it can happen — RULED
2026-09-30.** `First`, `Second`, `Third`, `Last` and `At` with a literal
index are typed `T | marker(T)` (§3.C) when the access can find nothing,
and `T` when the operand is proved to hold the position: a list type with
a length (the type of a list literal), a string literal, a `Range` with
literal bounds (`provenLengthD`, `library/collections.ts`).
`First([(1, 2)])` is `tuple<integer, integer>`; `First(Filter(xs, p))` is
`missing | tuple<integer, integer>`. A position proved not to exist keeps
`T | marker(T)`, so that a chained read still chooses its marker from the
element type (`M[7][1]` over a matrix is `NaN`).

The three worked declarations:

```
Heaviside: (real) -> rational<0..1>          // partiality: total
Sin:       (complex) -> complex              // may-marker: sin(±oo) has no
                                             //   limit; float overflow
Mod:       (real, real) -> real              // definedWhen: b ≠ 0
```

with every `nanBehavior` above left to its derived default (`propagate`).

**The derived application type** follows from the three facts and stays
honest about what has and has not been proven:

```
S
  | marker(S)   while a DECLARED partiality condition is not discharged
  | nan         while a propagating parameter might receive NaN
```

narrowing to exactly `S` when *both* are discharged: the declared
partiality (`may-marker`, or a `definedWhen` predicate) is absent,
`total`, or proven for these arguments, *and* every propagating slot's
argument type excludes `NaN`. (Per the 2026-09-01 ruling above, only a
DECLARED partiality puts `marker(S)` into the type; an omitted one does
not.) This needs the `nan`
singleton of §5 to be expressible — `rational<0..1> | nan` says vastly
more than a collapse to bare `number`. `realOnlyStepType` is a
hand-written special case of this derivation; under B it and its class
become the framework default read off the declaration.

**The derived behavior table.** For each argument of a declared
`(D) -> S`, the first matching row wins — and the `NaN` row runs
**before** domain membership, so the policy applies whether or not the
carrier happens to contain `NaN`:

| The argument… | Behavior | Phase |
| --- | --- | --- |
| is `NaN` | per that slot's `nanBehavior`: propagate → `NaN` · handle → handler answers · reject → `Error` | evaluate |
| provably inside `D` | handler runs; success in `S`, or the rule-4 marker where the partiality condition fails | evaluate |
| provably disjoint from `D` | `Error(incompatible-type)` | the moment disjointness is provable |
| overlaps `D`, not settled | admitted; inert until evidence arrives, then a row above | boxing admits; evaluate re-tests |

Signed infinities need no row of their own — they are ordinary values of
`real`/`complex` and land in the membership rows. `~oo` lands in the
membership rows too once it has a nameable type (§5): outside every
carrier below `number`, hence provably disjoint from a `(real)` or
`(complex)` parameter — `Heaviside(~oo)` → `Error` at boxing. Until that
singleton exists, `~oo` types bare `number`, which *overlaps* `real`, so
the gate must recognize the concrete value to reject it early — one of
the two reasons §5 proposes the singletons now.

**NaN composition.** The precise ordering, so multi-argument cases have
exactly one answer:

1. At boxing, the NaN policy is tested *before* ordinary type
   disjointness: a proven `NaN` in a `reject` slot becomes an `Error`
   immediately; a proven `NaN` in a `propagate` or `handle` slot is
   admitted even though `nan` lies outside the carrier.
2. At evaluation, every demanded strict operand is still evaluated —
   quiet propagation never skips a sibling operand's effects and never
   changes evaluation counts.
3. Across operands, the stronger channel wins: an embedded `Error` or a
   `reject`-slot `NaN` → `Error`; else any `propagate`-slot `NaN` →
   `NaN`; else `handle` slots and ordinary evaluation proceed.

So a function receiving `NaN` in both a rejecting and a propagating slot
produces the `Error`, and a propagating `NaN` alongside an effectful
strict sibling still runs the sibling.

Today's box-error / evaluate-error / inert variability stops being three
policies an author chooses among: it is one policy indexed by *when the
argument's evidence settles* (a literal settles at boxing; a collection
element may settle at evaluation; an unbound symbol never does). Because
success is claimed only where the partiality declaration says so,
inertness means exactly "no value yet" — never "a value the handler
declined". The user-facing summary needs no per-operator knowledge:
wrong kind of thing → immediate error; `NaN` in → `NaN` out unless the
signature says otherwise; a well-formed question with no answer → the
codomain's marker; unknown → waits. The residual judgment — carriers,
policy overrides, partiality — is the operator's mathematical definition
itself, irreducible but made once, in one declaration, guided by the
criteria below. And the table is executable: a conformance sweep can
derive each operator's expected behavior from its declaration, probe it
with the canonical kit (a string, `NaN`, `~oo`, `i`, a non-integer, an
unknown symbol), and turn library-wide drift into a test failure instead
of an anecdote.

**Choosing carriers.** For the real-vs-complex choice on numeric
operators the criterion is crisp: *does the definition depend on the
order of the real line?* Order is exactly what the complex numbers lack,
so order-dependent operators (`Heaviside`, `Max`/`Min`,
`Floor`/`Ceil`/`Round`, comparisons) declare `(real)`, and operators with a
genuine complex extension (`Sin`, `Sqrt`, `Ln`, `Exp`, `Arcsin`, `Erf`, and
`Sign`, whose complex extension is `z/|z|`) declare `(complex)`.

The carrier is not "the narrowest interesting input" — it can push the
other way. **Predicates declare wide**: a membership-style predicate
(`IsPrime`, `IsInteger`, …) is a claim "x ∈ S", and `False` is a
*success* value, not a failure — "3.5 is not prime" is a well-formed true
sentence, so `IsPrime` is genuinely total on its numeric carrier and
declares `(number) -> boolean` with `nanBehavior: handle` (explicit),
answering `False` for a provably non-integer argument, `NaN` included.
The one part of `number` it does not accept — the infinities — is
enforced by the HANDLER, not written into the signature: a declared
parameter type is also what an undeclared argument symbol is inferred
from, so the narrower spelling declared the caller's own `n` as
`complex | nan`. Put in the signature what a caller should be held to;
put in the handler what only the implementation knows.
`IsPrime(~oo)`, by contrast, is an `Error` (outside the carrier), and the
asymmetry with `IsPrime(NaN) → False` is deliberate:
`NaN` is the one value governed by a *policy* channel — IEEE gives it
dataflow semantics of its own — while `~oo` is an ordinary, if
exceptional, value governed by carrier types like any other. A pure
membership reading could defensibly answer `False` instead; the
carrier-discipline reading is chosen for predictability, and the
convention is stated here so the boundary is deliberate, not accidental.
It
does not widen to `any`: for a string the question is type confusion, not
membership, and the boxing Error is the wanted diagnostic (Mathematica's
fully-total `PrimeQ["banana"] → False` is the cautionary tale — typos
flow through as `False` forever). The general criterion: when the
codomain contains a truthful off-domain answer, the carrier widens to
everywhere that answer is truthful; when it does not (`Heaviside(i)` has
no value under any convention), the carrier stays the success region.

**One implementation, not one per operator.** The table, the marker rule,
and the derived typing belong in the generic dispatch path, not in
operator definitions. The evaluation pipeline already has three generic
stages no operator implements for itself — error absorption
(`_invalidValue()`), signature validation, and hold processing — and B
adds the remaining ones in the same style: the evidence-based admission
test in the validation layer, and a pre-handler gate applying the table.
What the framework *cannot* do is prove relational mathematical domains;
those enter as declared predicates or in-handler checks (fact 3 above),
and the handler otherwise contains only mathematics. The sanctioned
opt-outs remain the existing flags (observers, collection heads, lazy
operands). The known migration hazard: operators with canonical handlers
currently bypass declared-signature validation entirely, so the generic
gate must claim that class too — otherwise they remain exactly the drift
population this section exists to eliminate.

**Policies are part of a callable's contract.** `nanBehavior` and
partiality shape both runtime semantics and the derived application
type, so higher-order call sites need them: `Map(f, xs)` and a function
value stored in a symbol must let the engine derive whether applying `f`
can produce `nan` or a marker. The representation is an open
implementation design (§7): carry the policies as effects/refinements in
the function type; attach definition metadata to callable values; or —
the conservative floor that must hold regardless of representation —
treat an unknown or user-defined callable as `may-marker` with unknown
NaN behavior. This touches function subtyping, callback validation, and
compilation.

Why B is feasible now rather than aspirational: the operand-descriptor
layer has already stopped trusting declared result types as unconditional
truths about applications — application finiteness is read from the
expression's own evidence as a backstop, a posture adopted after
measurement showed contract-only reasoning wrong. That is exactly the
consumer discipline B requires. The remaining migration cost is every
reader of a *declared* type that treats it as an unconditional claim
(type-keyed guards, compile lowerings reading declared ranges): each must
either condition on the derived application type or on proven domain
membership. Signature flips can then land operator-by-operator.

Precedents for B's shape: refinement-type systems (Liquid Haskell, F*)
declare exactly such domain/success types with side conditions discharged
separately — `partiality: predicate(args)` is a refinement condition by
another name; Lean makes partial reals total with a junk value
(`Real.sqrt (-1) = 0`) — the marker is that junk value, IEEE's own; and
IEEE itself is the precedent for per-slot `NaN` propagation combined with
documented domains.

### The worked example under each contract

| | Contract A (status quo) | Contract B (as amended) |
| --- | --- | --- |
| Declared | `(number) -> number` | `(real) -> rational<0..1>` · partiality `total` · `nanBehavior` derived (`propagate`) |
| What a user/doc/hover learns | nothing beyond "numeric" | domain, exact success values, NaN policy, totality |
| `Heaviside("banana")` | `Error` at boxing | `Error` at boxing |
| `Heaviside(i)` | admitted; inert forever today | `Error` at boxing |
| `Heaviside(~oo)` | admitted; inert forever today | `Error` — at boxing with the §5 singleton, at evaluation without it |
| `Heaviside(NaN)` | admitted; inert today | `NaN` at evaluation |
| `Heaviside(±oo)` | `1` / `0` | `Error` at boxing — `real` is finite-only, so `±oo` is out of the declared domain; `(real \| +oo \| -oo) -> …` is the spelling that keeps admitting it |
| `Heaviside(x)`, `x` unproven | `.type` = `number` (type handler) | `.type` = `rational<0..1> \| nan`, derived |
| `Heaviside(x)`, `x` proven real | `.type` = `rational<0..1>` (type handler) | `.type` = `rational<0..1>` exactly (total + `real` excludes `NaN`), derived |
| Where the sharp claim lives | bespoke type handler | the declaration itself |

## 5. The exceptional numeric points and the lattice — RATIFIED 2026-08-27 (singletons adopted; placement superseded by the lattice flip)

(The singleton refinements below were adopted 2026-08-27 — ruling R-B of
`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md` — together
with the finite-by-default lattice flip, which supersedes this section's
placement premise as the amendment paragraph at the end of the section
describes: the `~oo` singleton is spelled `~oo` and is a member of the new
`infinity` type.)

Settled placement (ruled 2026-08-21, pinned in
`test/compute-engine/non-finite-typing.test.ts`): `NaN` **and** `~oo`
are admitted only by the top type `number`. Every carrier below `number`
excludes both. `~oo` is *undirected* — a value counts as `~oo` exactly
when its imaginary part is infinite; a directed infinite value (`∞ + i`,
`±oo`) is a different thing and lives inside `complex`/`real`. Do not
"fix" `~oo` back into `complex`: that state existed, produced three
sign-consistency bugs, and was deliberately removed. (Note in passing:
the pre-flip numeric-tower comment decomposed `complex` into its finite
twin plus the signed pair `non_finite_number`, which under-counted —
mixed directed infinities like `∞ + i` were `complex` but in neither
named part. The flip closes that hole: such values are members of
`infinity`, which is defined by infinite magnitude.)

Proposed — **introduce two singleton refinements now** (upgraded from
"demand-driven" by the 2026-08-25 reviews):

- `nan <: number`, disjoint from `complex` and everything below it,
  disjoint from `error`;
- `complex_infinity <: number`, likewise disjoint from `complex` and
  from `nan` (its value population is exactly the engine's
  `isComplexInfinity` test).

These are *new names for existing regions*, not moves: `~oo` and `NaN`
keep matching `number` and keep not matching `complex`, so the 2026-08-21
ruling and its pins stand. What the names buy: Contract B's derived types
stay sharp (`rational<0..1> | nan` instead of a collapse to
`number`); and provable-disjoint early rejection works by ordinary
subtype tests (`Heaviside(~oo)` → `Error` at boxing) instead of
concrete-value recognition wired into the gate. With both singletons the
top decomposes exactly: `number = complex ⊔ nan ⊔ complex_infinity`.
Migration caution, learned the hard way: retyping the `~oo` and `NaN`
*literals* changes what type-keyed guards see (a previous retyping of
`~oo` silently disabled an `Add` guard), so the flip needs the same
guard-sweep discipline the literal-types rollout used.

Rejected: making `nan` a subtype of `error`. The two channels answer
different questions (§1): `0/0` is a perfectly well-formed question whose
answer is indeterminate, not a violated contract. Merging them would make
every numeric signature reject its own outputs (`Sin: (complex) ->
complex` would no longer accept `Sin(0/0)` as input to a further
`Sin`), and would pull `error` — deliberately outside `expression` — into
the value lattice. `~oo` is likewise *not* an error and not a `nan`: it
is a definite point with defined arithmetic (`1/~oo = 0`, `2·~oo = ~oo`),
unlike `NaN`, which absorbs.

Amendment — the finite-by-default lattice flip
(`docs/TYPE_SYSTEM_ROADMAP.md` §8), ratified 2026-08-27 and shipped.
The bare numeric types `integer`/`rational`/`real`/`complex` are
finite-only, and an `infinity` type (whose members include the
singletons `+oo`, `-oo`, `~oo`) joins the `nan` singleton, so the top
decomposes as `number = complex ⊔ infinity ⊔ nan`; the
`complex_infinity` singleton proposed above is absorbed as the `~oo`
member of `infinity`. This replaces the settled placement premise
above: the directed infinities no longer inhabit `real`/`complex`, and
the pins on `matches('real')` for `±oo` flipped with it.

Amendment — the `Indeterminate` value
(`docs/plans/2026-09-28-indeterminate-value.md`), decided 2026-09-28 and
shipped 2026-09-29. The word "singleton" above no longer applies to `nan`:
the type `nan` has two members, `NaN` (the floating-point failure and the
numeric absence marker) and `Indeterminate` (the exact-route answer to a
form with no value, §1). Each literal has its own value type, printed
`NaN` and `Indeterminate`, and both value types widen to `nan`, so
`matches('nan')` is `true` for both and a list `[1, 0/0]` is still typed
`list<integer | nan^2>`. No type-keyed guard changed, because the type
`nan` itself did not change; the decomposition
`number = complex ⊔ infinity ⊔ nan` stands.

## 6. Interpreter vs. compiled code — Settled: compilation is fail-closed

Compilation policy is owned by `docs/COMPILATION-MODEL.md`, which is
normative and already answers this model's question: **a target emits
code only when it can preserve the interpreter's value, effects,
evaluation count, and error contract — it never emits plausible but
different code.** This error model adds nothing to that rule; it only
maps its channels onto it:

- A compiled expression may *erase* a check when static evidence proves
  it unnecessary. Note the direction of proof: any parameter type below
  `number` that excludes `nan` — which is now every bare numeric carrier
  — proves no `NaN` *enters* through that slot; only a discharged
  partiality condition (§4) proves the operation cannot *produce* a
  marker — `Mod(1, 0)` makes `NaN` from `NaN`-free inputs. Proof, not
  hope, and the two proofs are different.
- Where the outcome cannot be proven away and the target can represent
  it, the compiler *guards* — the `NaN` channel is usually free here,
  since IEEE propagation is native to every float target; preserving
  per-slot `propagate` costs nothing.
- Where the target cannot represent an outcome (a boxed `Error` on a
  numeric-only GLSL/WGSL/interval lane, a `Missing` on a float lane), the
  compiler *declines* with a structured diagnostic — interpreted fallback
  when enabled, a visible decline otherwise. It does not quietly
  reinterpret an `Error` as a throw, a `NaN`, or a plausible ordinary
  value.
- Any native-semantics escape hatch must be an **explicitly named unsafe
  mode**, chosen by the caller — never a silent default.
- The compiled targets have only the IEEE `NaN`, so an `Indeterminate`
  constant and every exact indeterminate form compile to the target's
  `NaN` (`NaN` in JavaScript, `np.nan` in Python, `_gpu_nan()` in the
  shaders). This agrees with `.N()`, which also answers `NaN` for
  `Indeterminate` (§1), so it is not a divergence.

An earlier revision of this document proposed that compiled code "sheds
the Error channel" and leaves residual failures to target semantics; that
contradicted the fail-closed contract and is withdrawn. Consequence worth
acting on: any compiled behavior that disagrees with the interpreter on
these channels is a bug against `COMPILATION-MODEL.md`, not a documented
divergence — the review reported `compile(Heaviside)(NaN) → 1` (not yet
reproduced here); if confirmed, that is exactly the "plausible but
different" class the rule prohibits, and the compiled-lane conformance
probes belong in the §7 sweep. The exceptions that the user accepted are
named in `docs/COMPILATION-MODEL.md`: the `Infinity` spelling of `~oo` on a
real target, with the sign tests it changes (`Heaviside`, `Sign`, `Floor`,
comparisons, a point divided by zero), and the `NaN` of a compiled fold over
rows of unequal length.

## 7. Conformance snapshot and open questions

First probed 2026-08-24/25 against `src/` and re-probed 2026-08-28/29
after the conformance round (route: `ce.box(json)` then `.evaluate()` /
`.N()`; every row is also executed on all three construction routes by
the suite named at the end of this section). "exact, unreduced" means the
application evaluated to its own exact symbolic form and awaits
numericization (§1) — it is not rule-7 inertness.

| Input | Boxed | `evaluate()` | `.N()` | Verdict vs. §2 |
| --- | --- | --- | --- | --- |
| `Sin("banana")`, `Sin(True)` | `Sin(Error(incompatible-type))` | `Error` | `Error` | conforms (rule 1) |
| `"banana" + 1` | `Error(…) + 1` | `Error` | `Error` | conforms (rules 1, §3) |
| `Sum(["a", "b"])` | inert (element type indeterminate) | `Error(incompatible-type)` | `Error` | conforms (rules 2, 6) |
| `1/0` | `~oo` | `~oo` | `~oo` | conforms (rule 3) |
| `Factorial(-2)` | inert | `~oo` | `~oo` | conforms (rule 3) |
| `Arcsin(2)` | exact, unreduced | exact, unreduced | complex value | conforms (rule 3) |
| `Ln(0)` | exact, unreduced | `-oo` | `-oo` | conforms (rule 3) |
| `Mod(1, 0)` | inert | `Indeterminate` | `NaN` | conforms (rule 4; `Indeterminate` since 2026-09-29, §1) |
| `At([1,2], 99)` | inert | `NaN` | `NaN` | conforms (rule 5, numeric elements) |
| `First([])` | inert | `Missing` | `Missing` | conforms (rule 5) |
| `First(E)`, `At(E, 5)` with `E: list<integer>` and `E := []` | inert | `NaN` | `NaN` | conforms (rule 5: the element type of the read is the declared one, user decision 2026-10-20; with `E: list<string>`, or `E := []` with no declaration, it is `Missing`) |
| `Sin(NaN)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `Heaviside(NaN)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `IsPrime(3.5)`, `IsPrime(π)`, `IsPrime(i)`, `IsPrime(NaN)` | inert | `False` | `False` | conforms (§4 predicates) |
| `IsPrime(-7)` | inert | `False` | `False` | conforms (convention ruled 2026-08-29) |
| `IsPrime(~oo)`, `IsPrime(±oo)` | valid | `Error(incompatible-type)` | `Error` | conforms (outside the carrier, ruling L9) |
| `If(True, 5, err)` | error preserved in place | `5` | `5` | conforms (demanded operands, §3) |
| `1 + If(True, 5, err)`, `[If(True, 5, err)]` | error preserved in place | `6`, `[5]` | same | conforms (demanded operands under composition, §3) |
| `Factorial(NaN)`, `Root(NaN, 3)`, `GCD(NaN, 2)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `Sum(x, (n, 5, 1))` | inert | `0` | `0` | conforms (rule 3, empty range) |

Conformance record. Each entry was a gap — a place where the engine did
not do what this model asks — until the ruling named in it settled the
answer and the fix landed. An entry with no FIXED date is still open.

- **FIXED 2026-08-28: `Sin(NaN)` evaluates to `NaN`.** `NaN` is a float,
  and by the exactness contract (§2) a numeric function of an inexact
  argument numericizes under plain `evaluate()`; the per-slot `propagate`
  policy says the same, and the aggregates already behaved this way
  (`Max(1, NaN, 3) → NaN`). The cause was a single shared exactness test:
  `BoxedNumber.isExact` admitted every non-finite raw number as exact, so
  a `NaN` operand looked like an exact value with something to preserve —
  while the same value stored as a `MachineNumericValue` or a
  `BigNumericValue` already reported `false`, so one mathematical value
  answered two ways depending on how it happened to be stored. Excluding
  `NaN` there conformed the whole numeric family at once (`Sin`, `Cos`,
  `Tan`, `Exp`, `Ln`, `Sqrt`, `Arctan`, `Sinh`, `Abs`, `Gamma`, `Floor`,
  `Round`, `Erf`, …), not `Sin` alone. The signed infinities are untouched
  and stay exact.
- **FIXED 2026-08-28: `Heaviside(NaN)` answers `NaN` under `evaluate()`
  and `.N()`.** Same propagate class as `Sin(NaN)`, but its handler is a
  sign dispatch, not a numeric kernel: all three of its sign tests are
  `false` for `NaN`, so the shared exactness fix does not reach it and it
  carries its own `NaN` arm. `Sign` had the identical handler shape and
  was fixed with it. This also closes the route divergence the compiled
  lane opened: `compile(Heaviside)(NaN)` had been conformed to `NaN`
  first, leaving the interpreter inert.
- **FIXED 2026-08-28: the `IsPrime` family answers `False` for a decidable
  non-member.** A membership predicate's `False` is a success value, so
  `IsPrime(3.5)`, `IsPrime(π)`, `IsPrime(i)` and `IsPrime(NaN)` are all
  `False` (`docs/SIGNATURE-GUIDELINES.md` §3.3). The predicate answers
  `False` whenever the argument is provably not an integer — from its
  value, or, for a constant with no literal integrality answer (`π`, `e`,
  `φ`), from its type not overlapping `integer`; an argument that could
  still be an integer stays inert. `IsPrime(~oo)` (and the signed pair) is
  the wanted `incompatible-type` Error under ruling L9, minted by the
  HANDLER: the declared carrier stays the wide `(number)`, because a
  declared parameter type is also what an undeclared argument symbol is
  inferred from, and the narrower `complex | nan` spelling declared the
  caller's own `n` as `complex | nan`. `NaN` needs no arm of its own —
  it rides in on `number` and the handler answers `False`, which is what
  Contract B will name `nanBehavior: 'handle'`. A negative integer
  answers `False` too, under
  the convention ruled 2026-08-29 (below). `IsComposite` gained a real
  definition in the same change: it used to canonicalize to
  `Not(IsPrime(n))`, which called `0` and `1` composite and would have
  called `3.5` and `NaN` composite once `IsPrime` started deciding them.
- **FIXED 2026-08-28: `If(True, 5, err)` evaluates to `5`.** The
  demanded-operands rule (§3) now has an implementation: absorption is
  DEFERRED past the handler for an operator that chooses among its
  operands, instead of happening before it. Deferring rather than skipping
  is what keeps the dual obligation — an operand the handler does demand
  comes back as the error, so the error is embedded in the handler's
  result and bubbles from there (`If(False, 5, err)`, `If(err, 5, 7)`,
  `And(True, err)`). The scope is a new definition flag,
  `selectsOperands`, set on `If`, `Which`, `And`, `Or`, `Implies`, `Nand`,
  `Nor` and `Coalesce`; keying it on `lazy` instead was measured and is
  wrong, because most lazy operators demand every operand and several
  answer something else entirely when a demanded operand is unusable
  (`Numerator(err)` answered `Nothing`, `D(err, x)` threw out of the
  handler). `If` and `Which` gained an explicit propagation of their
  condition's error, which is the obligation the flag imposes.
- **FIXED 2026-08-29: the demanded-operands rule holds under
  composition.** `If(True, 5, err)` answered `5` on its own but made
  every expression it was nested in fail — `1 + If(True, 5, err)`,
  `Not(And(False, err))`, `Block(If(True, 5, err))` were all the error,
  and `[If(True, 5, err)]` froze the unevaluated `If` into the list.
  The cause was that an enclosing node's absorption walked the whole
  operand tree, straight through the selecting head. The error walks now
  treat a selecting subtree as opaque at any depth, and a node whose
  errors all sit behind one EVALUATES instead of freezing; what the
  subtree returns is what bubbles. A selection that is undecided
  (`If(x == 4, 5, err)` with a free `x`) stays inert with its diagnostic
  in place. The absorption a selecting operator owes is now attached to
  its RESULT rather than to its operands, which also restored the
  breadcrumb frame those operators had been dropping: `If(err, 1, 2)`
  records `{If, 1}` the way `Sin(err)` records `{Sin, 1}`.
- **FIXED 2026-08-29: the multi-argument numeric heads propagate `NaN`.**
  `Root(NaN, 3)`, `Mod(NaN, 2)`, `Binomial(NaN, 2)` and `Power(2, NaN)`
  stayed inert even under `.N()`. Their kernels are reached through
  `apply2`, whose real branch skipped a NaN operand outright and left the
  application with no result — reading a propagated NaN as the kernels'
  "outside my implemented domain" signal, which it is not. `apply2` now
  answers `NaN` for a NaN argument, as `applyN` already did, and `apply`
  carries the same guard. `Factorial`, `Factorial2`, `GCD` and `LCM`
  compute without those dispatchers, so each gained its own arm. The
  INFINITE arguments of the factorial family remain inert (`ROADMAP.md`,
  the 2026-08-29 conformance round).
- **FIXED 2026-08-28: `markerType()` answers `nan`.** The §5 singleton is
  live, so the type-level absence marker of a numeric slot names exactly
  `NaN` instead of the whole `number` tier, and `withMarker(T)` is a
  genuinely additive `T | nan` — the `NaN ∈ number` absorption reasoning
  was repealed by the lattice flip. The stored types of the
  out-of-band-capable accessors sharpened accordingly:
  `At([1,2,3], 99)`, `First([1,2,3])` and `Last([1,2,3])` type
  `integer | nan` where they typed a bare `number`. The arms are joined
  with `reduceType`, not `widen`: widening climbs the numeric ladder and
  would answer `number` for `integer ⊔ nan`, losing the element tier
  again. Values did not move — an out-of-band numeric access is still
  `NaN`, and `Missing` is still the non-numeric marker.
- **FIXED 2026-09-03: an operand that becomes an error only by EVALUATING
  it bubbles like one that was an error at boxing time.** `Sin(Length(5))`
  evaluated to the invalid tree `sin(Error(…))`, `1 + Length(5)` to
  `1 + Error(…)`, and `Sin(g(-1))` for a user function that fails likewise —
  inert answers to decided failures, against §3 (`Sin(err) → err`, which
  draws no line between the two). Cause: the pre-handler scan over the
  evaluated operands (step 4-err of `_computeValueUnabsorbed`) and the late
  absorption on the result were both gated on the node being INVALID at
  boxing time, so an error minted during the evaluation itself never
  propagated. Both now also run for a node that was valid, under the same
  exclusions (an observer sees the error, a collection keeps its failed
  cell, a selecting operator decides for itself —
  `_absorbsEvaluatedOperandError`); the async lane, which had neither step,
  mirrors both, and so do a spread argument that evaluates to an error and a
  broadcast lift that does. Breadcrumbs gain the operator hop (`Sin` argument
  1). A consequence for user functions: the inert refusal form a literal
  answers when an annotated parameter rejects its argument
  (`Apply((n) => n + 1, Error(…))`, the document form of decision 6 in the
  lambda design) now collapses to the error at the call, with the hop named
  after the function the user wrote (`bump` argument 1) — so an element-wise
  failure's cell is the error itself, still carrying its `ErrorBroadcast`
  context. Pinned by `test/compute-engine/evaluation-time-error-bubbling.test.ts`
  and the updated `broadcast-error-context.test.ts`.
  Since 2026-10-03 the anonymous application collapses the same way:
  `Apply((u: real) ↦ 7, "abc")` is the error `Error(incompatible-type, …)`,
  with the hop `Apply` argument 2, and not the inert
  `Apply((u) => 7, Error(…))`. The inert form is now only an internal step:
  the literal's own application (`makeLambda` in `function-utils.ts`) still
  returns it, and each route that calls a literal replaces it with the
  error (`_refusedArgumentError` for a named call,
  `refusedLiteralArgumentError` for `Apply` and for the cells of a mapped
  list). An argument whose type certainly does not match (a string or a
  boolean at a `real` parameter) is refused when the call is boxed, on all
  three routes, so the call is invalid and typed `error` before it is
  evaluated. Pinned by `test/compute-engine/apply-literal-maps.test.ts` and
  `typed-function-literals.test.ts`.
  On the two named routes, an assignment can later replace the function
  (`h := (u: real) ↦ 7`, or `f` declared `function` and then assigned), so
  that refusal states only what the name held when the call was boxed. The
  call keeps the operands it was written with, and its evaluation and its
  type box it again against the function that the name holds now
  (`BoxedFunction._recheckedCall()`): with `f` declared `function` and
  assigned `(u: real) ↦ 7`, `f("abc")` boxed then is typed `error`; after
  `f` is assigned `(u: string) ↦ 1`, the same call is typed `integer` and
  evaluates to `1`, as a call boxed after the assignment does. The same
  applies when the call is an operand at any depth: an expression that
  contains a refused call is boxed again from the checked calls when it is
  evaluated or typed (`BoxedFunction._recheckedTree()`), so `f("abc") + 1`
  evaluates to `2` and `[f("abc"), 1]` to `[1, 1]` after the assignment.
  When the callee is still the same, the expression still runs its handler
  instead of bubbling the error first, because one of its own statements can
  replace the callee: `Block(Assign(h, u ↦ 7), h("abc") + 1)` evaluates to
  `8` after `h := (u: real) ↦ 7`. If the call is still refused after the
  handler, the error bubbles as before, with the same breadcrumb, and a
  collection keeps the refused call in its cell. Because the handler runs,
  its effects are those of an error that appears at evaluation:
  `Assign(x, h("abc") + 1)` assigns the error to `x`, as
  `Assign(x, Length(5) + 1)` does. The boxed expression
  itself does not change, so its `isValid` stays `false` even when it
  evaluates to a value: `isValid` reports the tree as it was boxed. A
  declared signature (`ce.declare('k', '(real) -> real')`) is a contract
  that an assignment cannot change, and its refusal is not checked again.
  The opposite direction is covered too: a call that the function
  ACCEPTED when it was boxed records the definition of its name and a
  change counter of that definition (`BoxedFunction._calleeStamp`; the
  counter is `_writeVersion` on the value or operator definition). When
  the type of the call is read, or the call is evaluated, after the name
  got another definition or the definition changed, the call is boxed
  again against the definition as it is now, and the type and the value
  are those of the new call (`BoxedFunction._reboxedForCallee()`). With
  `h := (u) ↦ 1`, the call `h("abc")` is typed `integer`; after
  `h := (u: real) ↦ 7` the same call is typed `error` and evaluates to the
  `incompatible-type` error, as a call boxed after the assignment. Its
  `isValid` stays `true`, for the reason given above. When the definition
  did not change, the cost is one comparison of the definition and one of
  the counter. This applies to a call of a user function (an operator
  definition from an assigned function literal or an Epsil `function`) and
  to a call through a variable declared `function` or with no declaration;
  a variable declared with a signature is not checked again, because the
  signature is a contract. The new call is used only when it is bound to
  the same binding as the old one. A named call through a variable with no
  declared type also keeps the names it was written with, so that its names
  are matched against the function the variable holds when the call is
  evaluated: with `alias = bob_S` (`(x, factor)`), the call
  `alias(x: 3, factor: 5)` evaluates to `bob_S(3, 5)`, and after
  `alias = other` (`(factor, x)`) to `other(5, 3)`. Pinned by
  `test/compute-engine/call-follows-function-reassignment.test.ts`.
- **RULED and IMPLEMENTED 2026-09-03: `RuntimeError(code)` constructs an
  error value at run time.** A written `Error(…)` stays what §1 says it is —
  a static diagnostic node that invalidates its tree, so a function whose
  body spells `Error("neg")` never gets a function type and its declaration
  is inert (the trap Epsil's `if let` docs first hit). The ruling adds the
  runtime counterpart instead of exempting held bodies from the validity
  rule: `RuntimeError("neg")` is a valid application, typed `never` because
  a signature describes the successes (§4) and it has none, whose evaluation
  produces `Error("neg")`. So `(x) => If(x > 0, x, RuntimeError("neg"))`
  types `(unknown) -> number`, is declarable, and answers `Error("neg")`
  for a non-positive argument. Only the code is taken — the `where` operand
  of `Error` names the offending sub-expression of a static diagnostic,
  which a runtime failure does not have (user ruling). The `javascript`
  target has no lowering and fails closed, naming the operator. Pinned by
  `test/compute-engine/runtime-error.test.ts` and
  `test/epsil/runtime-error.test.ts`.
- **FIXED 2026-09-03: a user function answers with the error value its
  body evaluates to.** Application of a function literal (`makeLambda`,
  `src/compute-engine/function-utils.ts`) DECLINED when the body's result
  was invalid — a gate from 2024 that predates this model — so the call
  stayed inert: `len := x ↦ Length(x); len(5)` answered `len(5)` where
  `Length(5)` is the `incompatible-type` error, an Epsil
  `function head(xs: list) { match xs { [h, ...] => h } }` applied to `[]`
  answered `head([])` instead of the `match-no-case` error, and no Epsil
  function could ever return an error value. §3's rule — "Error values
  propagate through ordinary function application", as
  `docs/LANGUAGE-MODEL.md` states it — now holds for user functions: an `Error` result — or one embedding an error reachable without
  crossing a selecting operator or a collection literal — is the
  application's value; a frozen container or an undecided selection is
  returned as it is, with its diagnostic in place (`bodyResultValue`).
  Pinned by `test/compute-engine/user-function-error-result.test.ts`. Still
  OPEN, and a ruling: a WRITTEN `Error(…)` in a function body makes the
  literal itself invalid (type `error`), so the declaration never takes
  effect — see `ROADMAP.md`, "a written `Error(…)` literal in a function
  body".
- **FIXED 2026-09-02 (ruled the same day): native handler faults carry
  the `internal-error` code with the stack.** A `TypeError`, `RangeError`
  or `ReferenceError` thrown inside a built-in, non-lazy handler used to
  be converted to `Error(evaluation-error, message)` — the same code a
  legitimate domain failure reports, so an engine bug was
  indistinguishable from bad input and the stack was lost. It now converts
  to `Error(ErrorCode("internal-error", message, stack))` with the first
  frames of the stack; the conversion itself (no host exception) is
  unchanged (`handlerThrowToErrorValue`, `boxed-function.ts`).
- **FIXED 2026-08-28: `compile(Heaviside)(NaN)` answers `NaN`** under
  ratified Contract B's derived `propagate` default (it answered `1` — a
  fail-closed violation, confirmed 2026-08-26: both comparisons in the
  kernel are false for NaN, so the final arm caught it). All three
  lowerings were swept: the JavaScript kernel gained a leading
  `Number.isNaN` arm; the interval kernel propagates a NaN interval
  (it answered `singular at 0`); the GPU preambles propagate through an
  arithmetic carrier (`0.5 + 0.0 * x` on the fall-through arm — `isnan`
  is unreliable under fast-math, so shader NaN answers stay best-effort
  by design). Conformed pin in `test/compute-engine/error-model.test.ts`.
- **RULED 2026-08-28 (pole encoding): a float-only compile target answers
  the IEEE `Infinity` where the interpreter answers `~oo`** — the float
  projection keeps the magnitude and drops the direction `~oo` never had,
  and it is what the bare division instruction already answers at a
  runtime pole. The constant fold, the embedded `~oo` literal, the
  `Factorial` negative-integer pole and the GPU `Gamma` pole guard were
  aligned (they answered `NaN`, so the same pole spelled differently by
  fold and by runtime). `NaN` stays reserved for the indeterminate
  (`0/0`, `0·∞`, which the interpreter's exact route answers with
  `Indeterminate` since 2026-09-29) and for `propagate`. Documented as the float-target
  carve-out in `docs/COMPILATION-MODEL.md`; conformed pins in the suite.
- **RULED 2026-08-30 (pole-encoding extension, shipped): the projection
  also applies at the argument boundary** — a `~oo` value passed into
  compiled code becomes `+Infinity` at entry instead of throwing (a
  genuine complex value still rejects on a real lane). The second half
  of the proposal — re-admitting `infinity`/`nan` parameter clause
  guards under the now-faithful encoding — was REFUTED by measurement:
  float arithmetic degrades one non-finite class into another before a
  guard runs (compiled `1/w - 1/w` at `w = 0` is `NaN`; the
  interpreter's operand stays `~oo`), so every non-finite primitive
  clause type AND every non-finite value-literal clause still declines
  the whole function. Two accepted divergences, recorded in
  `ROADMAP.md`: compiled `Heaviside(~oo)` → `1` and compiled
  `~oo > 0` → `true`, both symbolic in the interpreter at the time (since
  2026-10-21 the interpreter answers `~oo > 0` → `False`: see "An undefined
  operand makes a comparison false" at the top of this document). Details
  in `docs/COMPILATION-MODEL.md`.

Open questions (each phrased so it can be answered without this
document's history):

- **RULED 2026-08-27: Contract B as amended (§4) is ratified** — the
  headline ruling, adopted as ruling R-A of the numeric-lattice
  ratification package
  (`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`). The
  adopted package: carrier signatures with precise domains and success
  types; `error` as implicit effect; the `nan` and `complex_infinity`
  singletons (§5); per-parameter `nanBehavior` with derived defaults and
  the composition rule; the `definedWhen`/`requires` split with
  `may-marker` as the omitted default; evidence-based admission;
  demanded-operands error propagation (§3); fail-closed compilation
  (§6). Implementation has not started; the callable-metadata
  representation (next item) remains an open implementation design item,
  and the ROADMAP defects gated on the NaN policy (compiled
  `Heaviside(NaN)`, the compiled-lane pole encodings) are now unblocked.
- **RULED 2026-09-02: callables carry NO policy metadata — the
  conservative floor is the representation.** A user function (a lambda,
  a declared-then-assigned function, a multi-clause definition) is
  `may-marker` with unknown NaN behavior at every consumer, and the
  precision a caller wants comes only from a DECLARED signature with
  precise carriers (`(real) -> real`), which the derivation already reads.
  Weighed and not taken: inferring `nanBehavior`/`partiality` from a
  literal's body (a new inference pass with its own soundness questions —
  a body that branches on `IsNaN(x)` must infer `handle`), and policies
  as effects in the function type (`(real) -> real ! nan-propagate`; the
  type grammar, parser, printer and subtyping would all grow). Measured
  before ruling: at the VALUE level a user function already behaves like
  a library one (`g := x ↦ √x`; `g(NaN)` is NaN; `Map(g, [1, NaN])` is
  `[1, NaN]`), and only the sharper static claim (`nan` instead of
  `number`) is lost, which no higher-order consumer needs today. Revisit
  only when one does.
- **RULED 2026-09-01: the omitted `may-marker` default is a runtime
  contract only — it does not add `| nan` or `| missing` to the result
  type** (§4, with the derived-type block amended).
  Weighed after re-measuring the doc-faithful alternative once Phase F
  was complete: binding `S | marker(S)` for every head with no declared
  partiality failed 412 tests across 86 suites (and 7 snapshots) —
  `integer → integer | nan`, `string → missing | string`, shape claims
  such as `vector<integer^3>` collapsing to `list<integer | nan^3>` —
  and the alternative of declaring `partiality: 'total'` on every total
  builtin was judged a library-wide migration for no sharpness gain
  over silence. Adopted: a type describes the successes; the marker
  arm appears only from a declared partiality or from proven NaN
  evidence; `total` remains the stronger auditable claim; on the input
  side the marker is governed by `missingBehavior`/`nanBehavior`, never
  spelled in the parameter type. Recorded expectation: this may surface
  as a user surprise ("`Length` said `integer` and returned `Missing`")
  — for `NaN` it is the IEEE expectation, for `Missing` it is the same
  bargain as `error`; revisit if feedback shows otherwise.
- **RULED 2026-08-27: `~oo` is a singleton member of the `infinity`
  type.** The options weighed were: (a) inside `complex` — rejected: it
  breaks `complex`'s structural promise (every complex value has
  real/imaginary parts; `~oo` has no direction); (b) bare `number` with
  gates recognizing the concrete value — the former status quo,
  workable, imprecise; (c) a `complex_infinity` singleton that names the
  region without moving it; (d) the `~oo` member of `infinity`, which
  the lattice flip made available and which subsumes (c). (d) was
  adopted with the flip.
- **RULED 2026-08-27, shipped 2026-08-28: the finite-by-default lattice
  flip** (`docs/TYPE_SYSTEM_ROADMAP.md` §8). Bare numeric types are
  finite-only; `±oo` moved out of `real`/`complex` into the `infinity`
  type, which sits beside the `nan` singleton under `number`; the
  extended real line is spelled `real | +oo | -oo` (the
  `EXTENDED_REAL_TYPE` constant — `real | infinity` would also admit the
  unsigned `~oo`). The five `finite_*`
  twins have retired: `finite_integer`, `finite_rational`,
  `finite_real`, `finite_complex` and `finite_number` remain
  parse-accepted deprecated aliases for one release cycle — normalizing
  to `integer`, `rational`, `real`, `complex` and `complex`
  respectively — and are never emitted. `non_finite_number` initially
  survived the flip, repositioned below `infinity` — and then RETIRED on
  2026-08-31 (the name was misleading: `~oo` and `∞ + i` are non-finite
  numbers, yet neither was a member). The signed pair is spelled
  `+oo | -oo`; the old name is a one-cycle parse alias for that union,
  never emitted. The flip amends §5's
  placement (the singletons stay; the directed infinities moved) and
  strengthens Contract B's carrier discipline (§4) by giving the
  precise carriers the short names.
- **RULED 2026-08-29: `IsPrime(-7)` is `False` — a prime is a positive
  integer greater than 1.** This is the general rule about per-operator
  conventions, settled on its type case. Where references diverge, the
  authority is this engine's own documented definition, not external
  agreement: Mathematica's `PrimeQ` accepts the negatives of primes
  (primality up to units), SymPy's `isprime` does not (naturals above 1).
  That is a definitional difference, not a mathematical indeterminacy, so
  "references disagree → return the marker" is NOT the rule — CE picks one
  definition, writes it in the operator's definition with the precedent
  cited, and the conformance suite pins it. External practice is evidence
  for the choice, never the decider. SymPy's convention was adopted: it
  keeps the uniform set-membership reading the predicate gives every other
  decidable non-member (`3.5`, `π`, `i`, `NaN` are all `False`), so no
  argument in the carrier is answered by inertness except one that could
  genuinely still be prime. `IsComposite` inherits it through its
  positivity test, so no negative integer is composite either. Recorded in
  `isPrime` (`src/compute-engine/boxed-expression/predicates.ts`) and
  pinned on all three routes in the conformance suite.
- **RULED 2026-08-27: a selection with no selected branch answers
  `Missing`** — unconditionally, not the type-directed marker of the
  arms. `Which()` (and `Which` where every guard is `False` or
  `Undefined`) and the else-less `If(False, x)` now both answer
  `Missing`, the position-preserving absent datum; both operators' scalar
  result types carry a `missing` arm exactly when no default clause
  exists. Before the ruling the two control operators disagreed (measured
  2026-08-26): `Which` answered `Undefined` — a fifth "no answer" citizen
  invented locally before the absence ruling — and `If` answered
  `Nothing`, the positional erasure marker §1 forbids as a
  failed-selection answer. Unchanged, deliberately: the masking
  `Undefined` of the `When` restriction operator (plot consumers skip
  masked points), decision 9's fall-through for an `Undefined` guard, and
  the element-wise no-match cell (`NaN` for numeric cells — `Missing`
  absorbed into a numeric domain, per the absence ruling). Pinned in the
  conformance suite (`test/compute-engine/error-model.test.ts`).
- **RULED 2026-09-09: the `When` restriction masks to `Missing` too, and
  its type carries the `missing` arm.** This amends the exemption the
  2026-08-27 ruling above made for `When`. `When(e, False)` — and
  `When(e, Undefined)`, decision 9's fall-through — now answers `Missing`,
  the position-preserving absent datum, where it answered the `Undefined`
  symbol; the element-wise form masks each cell the same way
  (`[10,20,30]{[1,2,3] > 2}` is `[Missing, Missing, 30]`). The reason the
  exemption gave — "plot consumers skip masked points" — had no reader:
  `Undefined` has no standing in §1 (its type is `unknown`), the engine's
  only reader of it was the `Add` fold that turned it into `NaN`, Tycho's
  masked-point test reads `Missing`, and plots take the mask from compiled
  code, where every target already emitted `NaN`. The compiled lanes are
  unchanged (amended 2026-09-27 for object values: an absent point, tuple
  or list in compiled JavaScript arithmetic is `undefined`, see §3). The `When` type handler now answers `missing | T` for every
  condition except the literal `True` symbol (the same shape a default-less
  `Which` and the else-less `If` carry, Option A of the same day), and
  `list<T | missing>` for a list-of-booleans condition — so a list holding a
  masked cell no longer types as a full `vector<integer^3>`. Amended
  2026-09-25 for a LIST value under a scalar condition (user decision): the
  restriction stays ONE held `When` over the evaluated list while the
  condition is undecided, `[1,2,3]{c}`, and its type is the list's own type
  under the `missing` arm, `missing | vector<integer^3>`. The held form
  presents its cells through the `When` collection handlers (`count`,
  `each()`, `At`), but it is threaded WHOLE by every operator, never mapped
  over cell by cell (it is not an indexed collection for the broadcast
  machinery): `\sin([1,2,3]{c})` is `[sin 1, sin 2, sin 3]{c}`, `Missing`
  once `c` fails. Before, the cells were copied into a `List` of `When`s,
  `[1{c}, 2{c}, 3{c}]`, a value typed `list<integer | missing>` that the type
  did not admit, and that re-evaluated to `[Missing, Missing, Missing]` once
  `c` failed while a fresh evaluation — and the compiled code — answered
  `Missing`. A LITERAL list of restricted cells, `[1{c}, 2{c}]`, is a
  different value, typed `list<integer | missing>` and masked cell by cell;
  where its length matters — the `vector` parameter of `Dot` and `Cross` —
  the argument validation reads it from the value (`strippedMatchesParam`,
  `boxed-expression/validate.ts`), so `Dot([1,2]{[0<t, t<0]}, [1,1])` is
  accepted and `Dot([1, Missing], [1,1])` is `NaN`. An operand that can be
  absent as a whole AND cell by cell counts as both in `absorbOperandAbsence`
  (`broadcast-lift-type.ts`).
- **RULED 2026-09-25: a collection operator propagates absence.** An
  operator with no declared `missingBehavior` propagates an absent operand
  when every parameter of its signature is a number, a collection or a
  function and at least one is a number or a collection
  (`signatureParamsPropagateAbsence`, `boxed-operator-definition.ts`); before,
  only an all-numeric signature did. So `Reverse(Missing)`, `Sort(Missing)`,
  `Take(Missing, 1)`, `Zip(L, Missing)`, `Map(f, Missing)` and
  `Filter(Missing, p)` answer `Missing`, the marker of a collection codomain,
  where they were `incompatible-type` errors or stayed raw; `Length(Missing)`
  and `Reduce(Missing, f, 0)` answer `NaN`, the marker of a number (`Length`
  and `Reduce` declare the policy, their signatures having an `any` or
  `value` parameter). The absence gate stands aside beside a collection
  operand for a BROADCASTABLE operator only (`Add(Missing, matrix)` lands in
  each cell); a collection operator computes on the whole operand, so an
  absent one makes the whole answer absent. The collection-operand check of
  the canonical handlers (`checkCollectionOperand`, `library/collections.ts`)
  admits an absent symbol for the same reason. A restricted collection,
  `[1,2]{c}`, is threaded whole by these operators (`threadsConditionals`):
  `Reverse([1,2]{c})` is the held `Reverse([1,2]){c}`, a collection of the
  present elements, `Missing` once `c` fails; read cell by cell it used to
  materialize as a `Set`. Known consequence, not ruled: a numeric result
  computed from a restricted list, `Length([1,2]{c})` or `Sum([1,2]{c})`, is
  `2{c}` or `3{c}`, which masks to `Missing` (the `When` rule) while the same
  expression evaluated fresh with `c` false gives the marker `NaN`; the same
  holds for every numeric operator threaded over a scalar restriction
  (`2·x{c}` is `2x{c}`, `2·Missing` is `NaN`).
- **RULED 2026-09-25 (later the same day): a restriction masks to the
  absence marker of its VALUE'S type.** `x{c}` with `c` false is `NaN` when
  `x` is a number, and `Missing` when it is a point, a list, a string or a
  value not provably numeric (`maskedValue`, `library/control-structures.ts`);
  a masked numeric cell of a list mask is `NaN` too (`[10,20,30]{[1,2,3] > 2}`
  is `[NaN, NaN, 30]`). This amends the 2026-09-09 rule above, which masked
  every value to `Missing`: that was the one place the engine spelled an
  absent number as `Missing`, so `2·x{c}`, threaded to `2x{c}`, answered
  `Missing` on the held route and `NaN` when evaluated fresh (`2·Missing`),
  and `Length([1,2]{c})` answered `2{c}` → `Missing` against a fresh `NaN`.
  One rule for absence, then: every operator answers the marker of its
  codomain for an absent operand (§2 rule 4), and a restriction answers the
  marker of its value. The type of a numeric restriction is its tier with a
  `nan` arm and no `missing` arm, `integer | nan` for `1{c}` (it was
  `integer | missing`); a list mask over numbers is `list<number>`. The
  compiled code, which always emitted `NaN` for a masked number, is
  unchanged. With it, a SCALAR restriction beside a collection or a point
  operand of a broadcastable operator lands in each cell of the result
  (`threadConditional`, `restrictCells`): `[1,2,3] + 2{c}` is
  `[3{c}, 4{c}, 5{c}]` and `2{c}·(1,2)` is `(2{c}, 4{c})`, `NaN` cells once
  `c` fails, as the fresh route answers; restricting the whole result made it
  `Missing` on the held route. A restricted collection or point operand
  (`[1,2]{c} + 1`, `P{c} + (1,1)`) still restricts the whole result, and
  when both kinds meet under different conditions (`[1,2]{a>0} + 2{b>0}`)
  the guards stay apart, `[3{b>0}, 4{b>0}]{a>0}`: the list is still one
  restriction, `Missing` once `a` fails. The
  read-back of a gated value at assignment (`restrictionValueType`,
  `effects-inference.ts`) reads the held literal through the `nan`-armed
  type and through a list mask. Not changed: a `Which` with no selected
  clause and the else-less `If` still answer `Missing` for a number (the
  no-selection ruling of 2026-08-27). Known consequence, not ruled: an
  element read of an absent ROW, `At([[1,2]{c}, [3,4]], 1, 2)`, is `Missing`
  when evaluated fresh (§3.C: an access into an absent collection is absent)
  but `2{c}` on the held route, which masks to `NaN`. Consumers fixed
  with it: the invisible-operator gates read an operand's type with the
  absence marker stripped (`typeIgnoringAbsence`,
  `boxed-expression/invisible-operator.ts`), so `2x{x>0}`, `t P{0 ≤ t ≤ 1}`
  over a point list and `2 If(c, x)` over an undeclared `x` stay products
  rather than becoming silent `Tuple`s. Found on the way and fixed with it:
  the value-form else-less `If(c, t)` was refused by every compile target
  ("wrong number of arguments") while the interpreter answered `Missing`;
  it is now lowered as the one-clause `Which(c, t)` on every target, and
  answers the codomain's absence marker (`NaN` for a number) when the
  condition is false. A two-operand `If` whose arm is a STATEMENT keeps its
  guard-statement reading (JavaScript statement-forms it; the other targets
  decline it, each for a verified reason —
  `test/compute-engine/compile-elseless-if-statement.test.ts`). Ruled the
  same day, after the alignment: the compiled absent value of `Which`, `If`
  and `When` follows ONE rule per target (`BaseCompiler.absenceKind`) —
  the object null (`undefined`, Python `None`) only when every arm is
  provably not a number, `NaN` for a number and for an unknown type, since a
  bare symbol arm is a number until proven otherwise and an object null there
  would turn its arithmetic consumers into a host `TypeError`. Pinned in
  the conformance suite and in `conditional-values.test.ts`,
  `when-list-broadcast.test.ts`, `a2-restrictions.test.ts`.
- **SUPERSEDED the same day — RULED 2026-09-26: searching for an absent
  value means not found.** This entry is kept as history. It was reversed
  later on 2026-09-26, before any release carried it, by rule C of §3,
  "Absent values in collection operators": a search is structural, and a
  marker IS found where the same marker sits (`IndexOf([1, NaN], NaN)` is
  `2`, `Contains([NaN], NaN)` is `True`). The function this entry cites,
  `isAbsentSearchedValue`, was deleted with the reversal. What survives of
  this entry is the held undecided restriction (`Contains([1, 2], 2{c})`
  stays unevaluated while `c` is not known) and the absent-collection rule.
  The original text: When
  the value that `Contains`, `IndexOf`, `Count`, `Element` or `NotElement`
  searches for is absent, the answer is the "not found" answer of the
  operator: `False` for `Contains` and `Element`, `0` for `IndexOf` and
  `Count`, and `True` for `NotElement`. The searched value is absent when its
  VALUE is `Missing`, `Undefined` or `NaN`: in a numeric domain `NaN` is the
  absence marker (`Missing` absorbed into a number, §2), and an IEEE `NaN`
  is equal to nothing, itself included. So a search never finds an absent
  value, whatever the collection holds: `IndexOf([1, Missing], Missing)`,
  `IndexOf([1, NaN], NaN)` and `Count([NaN, NaN], NaN)` are `0`,
  `Contains([NaN], NaN)` and `Element(Missing, [1, Missing])` are `False`.
  An absent or `NaN` element of the collection does not change the answer,
  except that it cannot match. The test reads only the evaluated value
  (`isAbsentSearchedValue`, `collection-utils.ts`), never the operand as
  written, so a restricted number whose condition is false (`2{c}` is
  `NaN`), a piecewise value with no selected clause, an `If` with an absent
  branch, an element read of a restricted list (`First([5, 6]{c})`) and an
  arithmetic result (`5{c} + 1`) all give the same answer, on every route:
  held, fresh, `.N()`, compiled JavaScript and compiled Python. Amended the
  same day: the first version of this rule found a `NaN` that was written as
  `NaN` (`IndexOf([1, NaN], NaN)` was `2`) and decided the absence of a
  `NaN` from the operand as written, which gave different answers for a
  nested selection (interpreter against compiled code), for a value derived
  from a restriction (fresh against held), evaluated a random condition a
  second time, and missed the `nan` of an absent `If` branch in Python. A
  searched value that holds a restriction, a piecewise value or an `If`
  whose condition is not decided is not moved out of the application: the
  application stays unevaluated and gives the correct answer once the
  condition is decided either way. `Contains([1, 2], 2{c})` stays
  `Contains([1, 2], 2{c})` while `c` is not known, and then gives `True` or
  `False`. Before, the searched value was threaded, the held result was
  `True{c}`, and it became `Missing` (or `NaN` for `IndexOf` and `Count`)
  when `c` failed, while a fresh evaluation gave `False` (or `0`); and
  `Element(2{c}, [1, 2])` was `False` while `c` was not known, and stayed
  `False` after `c` became true. The collection operand is not changed: an
  absent collection makes the answer absent (`Contains(Missing, 2)` is
  `Missing`, `IndexOf(Missing, 2)` and `Count(Missing, 2)` are `NaN`;
  `Element(2, Missing)` stays unevaluated), and a restricted collection is
  threaded. The searched position does not strip `missing`
  (`missingStrip: [0]`), and the absence gate and the type absorption now
  read `missingStrip` (`boxed-expression/boxed-function.ts`,
  `derive-application-type.ts`), so the handler receives the absent value.
  An absent element of the collection does not make the answer absent
  either, and does not widen its type: `IndexOf([1, Missing], 2)` is typed
  `integer` (`ABSENT_CELLS_PASS_THROUGH`, `broadcast-lift-type.ts`). The
  compiled code tests the run-time value of the searched operand before the
  element test (`compileSearchedValue`, `pySearchedValue`): in JavaScript
  `v == null || v !== v`, in Python `v is None` or a float `v != v`, gives
  the "not found" answer.
- **RULED 2026-09-26: Insert, ReplaceAt and Append on an absent collection
  answer Missing.** `Insert(Missing, 1, 2)`, `ReplaceAt(Missing, 1, 2)` and
  `Append(Missing, 1)` answer `Missing` on every route, typed with a
  `missing` arm (`list<integer> | missing`). Before, a boxed absent
  collection was an `incompatible-type` error, while a restricted collection
  whose condition failed gave `Missing`. The operators declare
  `missingBehavior: 'propagate'` with `missingStrip: [0]`, because their
  value parameters are not collections and the default policy does not
  apply. Only the collection position strips `missing`: an absent index and
  an absent appended value are still refused, and an absent value stored by
  `Insert` or `ReplaceAt` is kept as one element of the result
  (`Insert([1], 1, Missing)` is `[Missing, 1]`). By the rule of 2026-09-25
  (a collection operator propagates absence), `Join(Missing, [1])` is
  `Missing` too (it was `[Missing, 1]`: the absent operand was wrapped as one
  element), and `Union`, `Intersection` and `SetMinus` over an absent set,
  or over a restricted set whose condition is false, answer `Missing` (they
  were `incompatible-type` errors). A restricted set whose condition is not
  decided is threaded by these three operators:
  `Union({1, 2}{c}, {2, 3})` is `{1, 2, 3}{c}`. An absent element inside a
  set is not changed: `Union({1, Missing}, {2})` keeps it as an element.
- **Container vs. cell validity (§3) — DEFERRED by ruling 2026-09-02; the
  iteration part DECIDED 2026-10-19.** Should a collection whose cells
  include errors eventually be a *valid* container of partially-invalid
  cells, with a type that says so (`list<number | error>`)? Today one error
  cell still makes the whole tree invalid: `[1, Sin("a"), 3]` has
  `isValid === false`, and `.errors` lists the error. Its type is
  `vector<integer^3>`, the type of `[1, 2, 3]`: a type describes the
  successes (§4), so an element typed `error` is left out of the element
  type of a list or set literal when another element of the same level
  succeeded (user decision 2026-10-22). A level whose elements all failed
  keeps the type `list<unknown>` (`[Sin("a")]`), because a cell type
  `never` would be read as a type with no value. A symbol with a declared
  type still refuses such a list unless the declared element type admits
  `error` (`any`, `unknown`, an explicit `error` arm): the declared-type
  check reads the elements of the value, not only its type
  (`failedElementRefusedBy`, `boxed-expression/type-compatibility-error.ts`).
  A parameter binding does not refuse it: a call of a function whose
  parameter is declared `list<number>` with the argument `[1, Sin("a")]`
  runs. It was
  `list<unknown>` from 2026-10-19 to 2026-10-22, and `error` before
  2026-10-19, when `ListJoin` wrapped such a list as one element. A NaN or
  `~oo` cell is an
  ordinary value (`[1, 1/0, 3]` is the valid `[1, ~oo, 3]`). The behavior
  this entry asked for is in place since 2026-10-19 without the validity
  change: the list is a collection that can be iterated (`isCollection` is
  `true`), so `Length` answers the length (`3`: the count is known, and
  reading it demands no cell), `Sum` demands every cell and answers the
  error, and a `Map`, a loop or a comprehension gives the failed cell to the
  body (§3). Before, `isCollection` was `false` for the invalid tree, so
  `Length` stayed inert, a loop ran no turn and `Map` returned the list
  unchanged. What stays open is the validity of the container itself (a
  `true` `isValid`, an `error` cell type in the lattice); no consumer has
  asked for it, so no change is scheduled.
- **FIXED 2026-09-02 (ruled the same day): `Length` and `Count` refuse a
  decided non-collection.** `Length(5)` and `Length(Missing)` — what
  `Length(First([]))` receives for an empty list — stayed inert on a
  decided question, which §1 forbids, while `Count(5)` already answered an
  `incompatible-type` Error and `Count(First([]))` answered that Error
  nested inside an unevaluated `Count`. Both now answer the bare Error, with
  one identical diagnostic: a number has no length, so asking for one is a
  defect in the program, not a partial function. The declared carrier of
  `Length` stays `(any)` (the IsPrime precedent: a declared parameter type
  is also what an undeclared argument symbol is inferred from); the
  evaluate handler mints the error for a value that refutes the collection
  contract (`nonCollectionSizeOperandError`, `collections.ts`). Strings
  keep their length; an undeclared or valueless collection-typed symbol
  stays inert; an operand that is already an error is not re-diagnosed.
  The ruling had named a third head, `Dimensions`; there is no such
  operator (the measured inertness was that of any undeclared head), and
  `Shape(5) = ()` keeps its documented APL semantics — a scalar has the
  empty shape — which is a design, not a defect.
- **FIXED 2026-09-02 (ruled the same day): an infinite leg dominates a NaN
  leg in every Euclidean norm, and `~oo` counts as infinite.**
  `Norm((+oo, NaN))` and `Abs` of that point answered NaN while
  `Hypot(+oo, NaN)` answered `+oo` under the IEEE rule ruled 2026-08-31;
  `Hypot(~oo, 3)` was an `incompatible-type` Error while `Norm((~oo, 3))`
  was `+oo`. One rule now: an infinite leg — signed or `~oo`, whose
  modulus is `+oo` by definition — makes the norm `+oo`; otherwise a NaN
  leg makes it NaN. `Hypot`'s carrier admits `~oo`. `Distance` follows
  the same rule by a follow-up ruling the same day: `Distance(p, q)` is
  `Norm(p − q)`, so `Distance((+oo, 0), (0, 0))` is `+oo` and
  `Distance((NaN, 0), (0, 0))` is NaN, in band, where a `!isFinite` guard
  used to answer an out-of-band `Error("expected-value")`.
- **FIXED 2026-09-02 (ruled the same day): a compiled `If`/`Which` takes
  no branch on an undecided condition.** SUPERSEDED IN PART 2026-10-20 by
  the user decision at the top of this document ("An undefined operand
  makes a comparison false, in a branch too"): a NaN operand of `<`, `≤`,
  `>`, `≥` or `=` now decides the comparison `False` on every route, and
  the branch takes its next arm; what follows is the history, and it still
  holds for `≠`, for an absent (`Missing`) operand, and for an unsupplied
  variable. The compiled JavaScript picked a
  branch by JavaScript truthiness — `If(x > 0, 1, -1)` at `x = NaN`
  returned `-1`, an unset boolean parameter returned the else arm — while
  the interpreter holds such an application inert. A compiled condition
  that is not exactly `true`/`false` now yields `NaN`, the numeric
  codomain marker, which is what the compiled element-wise `Which` already
  answers for a no-match cell. Weighed and not taken: throwing (a NaN
  sample in a drawing loop would abort the plot) and documenting the
  truthiness (a silently selected branch). An unsupplied variable reads
  as `undefined` whatever its declared type, so every numeric condition
  operand is guarded, `real`-typed ones included. Two follow-up rulings
  the same day: a STATEMENT-form `If` in a loop or block body executes no
  branch on an undecided condition and the body continues (the
  interpreter's inertness; "throw" and "keep truthiness" were weighed and
  not taken); and the `And`/`Or`/`Not` connectives, which short-circuited
  by JavaScript logic when every reached operand was undecided, now get a
  three-valued (Kleene) lowering — FIXED 2026-09-02, the same day: the
  condition compiles to a short-circuiting three-valued value (a
  decided-false guard never evaluates what follows it; an undecided one
  still does) and is selected through the value-shaped test, on the
  JavaScript and Python targets; `If(x > 0 ∧ y > 0, 1, -1)` at `x = 1,
  y = NaN` is `NaN`, at `x = -1, y = NaN` it is `-1`. A third follow-up
  ruling the same day settles the other compile targets:
  the Python target, which has a real NaN, takes the same operand guard;
  the GPU targets (GLSL/WGSL) keep JavaScript-style selection for now,
  because NaN propagation is not guaranteed on every driver, and stay on
  the ROADMAP item that records that reason. CORRECTION (measured
  2026-09-02): "the interpreter holds such an application inert" is true
  of an UNKNOWN operand (a free symbol), where the interpreter is Kleene;
  for a NaN VALUE the interpreter's ordered comparison answers `False`
  (IEEE) and `If(NaN > 0, 1, -1)` evaluates to `-1`, so the two lanes
  disagreed at a literal NaN. RULED 2026-09-03 (Arno): the INTERPRETER
  changes — a NaN operand of a branch condition is undecided, so the
  `If`/`Which` selects no arm (the comparison itself keeps its IEEE
  `False` everywhere else); the compiled lane's answer stands. Three
  companion rulings the same day: the three-valued lowering extends to
  IMPURE conditions (every leaf bound once — the triple-evaluation reason
  for the exemption no longer holds under the lazy shape; FIXED
  2026-09-04: `conditionDecidability` admits an impure operand whenever
  the target can bind it, and `If(Random() > 0.5 ∧ x > 0, a, b)` draws
  once per call and answers `NaN` at `x = NaN` — pinned in
  `test/compute-engine/compile-impure-condition.test.ts`); a repeated
  vars-object member read inside a guard stays free (a getter with
  effects is outside the compiled contract); a desugared `while` exit
  test keeps the no-arm rule (an undecided loop condition runs to the
  iteration cap). FIXED 2026-09-03: the `If`/`Which` evaluate handlers
  read their condition through `evaluateCondition`
  (`library/control-structures.ts`), which reads the NaN evidence on the
  OPERANDS of a relational head (`Less`, `LessEqual`, `Greater`,
  `GreaterEqual`, `Equal`, `NotEqual`) before the relation's own value
  has lost it, and combines `And`/`Or`/`Not` (and `Nand`/`Nor`/`Implies`
  through their `And`/`Or` spelling) three-valued as the compiled lowering
  does, keeping the short circuit: an operand a decided one guards is
  never evaluated, an error operand propagates, a still-symbolic sibling
  holds the connective inert with its original sub-conditions, and a
  collection-shaped operand takes the element-wise path unflagged. A condition decided by a NaN operand selects no arm and
  the application answers `Missing` — the no-selection value an else-less
  `If` and an unselected `Which` already answer — where the compiled lane
  answers `NaN`, its spelling of the same marker. A reached `Which` guard
  with a NaN operand ends the selection (no fall-through). A
  statement-form `If` in a block runs neither branch and the block
  continues. An element-wise condition is unchanged: a NaN CELL takes the
  else cell on both lanes (measured). Pinned in
  `test/compute-engine/condition-nan-undecided.test.ts`. REVERSED
  2026-10-20 by the user (Tycho rows 411 and 413, Desmos and IEEE parity)
  for `Less`, `LessEqual`, `Greater`, `GreaterEqual` and `Equal`: a NaN or
  `Indeterminate` operand decides them `False` in a branch as everywhere
  else, on the interpreter and the compiled lanes, so `If(NaN > 0, 1, -1)`
  is `-1` again and the two lanes now agree on the IEEE answer instead of
  on no arm. REVERSED for `NotEqual` too on 2026-10-23 by the user: a NaN
  operand decides it `True`, so `If(NaN ≠ 0, 1, -1)` is `1`. The compiled
  operand test keeps no NaN conjunct (it tests each variable the comparison
  reads for an unsupplied value, so the 2026-09-02 rule for an unsupplied
  variable holds). A link of a chain with an absent operand kept the NaN
  conjunct until the user decision of 2026-10-23 that `Less(0, NaN,
  Missing)` is `False`. Consequences for the companion rulings above:
  `If(Random() > 0.5 ∧ x > 0, a, b)` at `x = NaN` answers `b`; a desugared
  `while` whose exit test compares a NaN with `<`, `≤`, `>`, `≥` or `=`
  exits instead of running to the iteration cap, and one whose exit test is
  a `≠` with a NaN operand keeps running. The table and the
  exceptions are in the decision at the top of this document.
- **FIXED 2026-09-02 (ruled the same day): a provably non-boolean
  condition is refused at boxing.** The 2026-08-31 inertness ruling
  removed the host throw that carried the only diagnostic for
  `Which(10, …)`. A condition whose static type is disjoint from `boolean`
  — a number, a string, a symbol declared with such a type — now becomes
  an `incompatible-type` error OPERAND at boxing, as a wrong-typed argument
  to `Sin` does, and the evaluate handlers propagate it as the demanded
  condition's error. A symbol of unknown type (a misspelled `Tru` is a
  free variable), a relation with free variables, a `missing`-admitting
  type, and a collection whose cells could be condition values (a list of
  booleans selects element-wise; a bare or `unknown`-element collection
  may) stay inert. A collection that can never select — a tuple, which
  binds whole; a set, a dictionary or a record; a string; an indexed
  collection with provably non-boolean cells such as `list<number>` or
  `range` — is refused like a scalar; an empty collection (`list<never>`)
  is not, since it has no cell to contradict and broadcasts to an empty
  result (`conditionOperand`, `control-structures.ts`; pinned in
  `test/compute-engine/condition-diagnostic.test.ts`). The check exposed
  one parser defect, fixed with it: a `\begin{cases}` row with a trailing
  `&` and an empty condition cell parsed to a `Nothing` condition — a dead
  row — and now parses to the `True` default clause.
- **The executable conformance suite EXISTS** (built 2026-08-26;
  146 tests as of 2026-08-29): `test/compute-engine/error-model.test.ts`
  — every row of the table above across the three construction routes
  (`ce.box`, `ce.parse`, `ce.function` with pre-boxed arguments), the §3
  propagation rules, the §5 `~oo` arithmetic, and the compiled-lane rows.
  The block that pinned the documented gaps as CURRENT behavior is gone:
  the rulings settled every gap it held, so those rows are ordinary
  conformance pins now, grouped under the rule that decides each. A new
  gap goes back into a labeled block naming the eventual behavior, and the
  pin is what measures the change. One negative finding worth keeping: the
  three routes AGREED on every probe in the canonical kit — no route
  divergence exists there today. Amended 2026-09-25: an ABSENT
  operand is no longer a refused non-collection — `Length(Missing)`,
  `Count(Missing)` and `Length(First([]))` answer `NaN`, the marker of
  their numeric result, as every collection operator answers the marker of
  its codomain for an absent operand (the ruling of 2026-09-25 below). A
  number or a boolean is still refused with the identical diagnostic.

## Related documents

- `docs/COMPILATION-MODEL.md` — the normative fail-closed compilation
  contract this model defers to in §6.
- `docs/LANGUAGE-MODEL.md` — normative one-paragraph statements this model
  expands: error propagation, recovery boundaries, host-throw policy,
  lazy semantics.
- `docs/COLLECTIONS-MODEL.md` and `docs/BROADCAST-MODEL.md` — elementwise
  and broadcast behavior of the absence markers.
- `ARCHITECTURE.md` — the non-finite typing convention (ruled
  2026-08-21) that places `NaN` and `~oo` under `number` only.
- `src/common/type/types.ts` — the numeric tower.
- `src/compute-engine/boxed-expression/boxed-function.ts`
  (`_invalidValue()`, the handler crash-conversion wrapper) and
  `src/compute-engine/boxed-expression/error-value.ts` — the
  error-absorption implementation, its exceptions, and the validity walk.
- `src/compute-engine/library/collections.ts` (`absenceMarker()`,
  `markerType()`, `withMarker()`) — the type-directed absence marker,
  including the bounded runtime probe.
- `test/compute-engine/non-finite-typing.test.ts` — the pins for the
  `NaN`/`~oo` placement.
