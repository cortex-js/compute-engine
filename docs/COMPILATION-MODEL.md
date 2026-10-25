# Compilation Model

**Status:** normative internal reference for implemented compilation behavior.

## Fail closed

Compilation is an optional acceleration route. A target emits code only when
it can preserve the interpreter's value, effects, evaluation count, and error
contract. Unsupported heads, representations, guards, or numeric lanes decline
with a structured diagnostic. They never emit plausible but different code.

With fallback enabled, a decline returns an interpreted runner. With fallback
disabled, the decline is visible to the caller. Runtime exceptions from
successfully compiled user code are not silently reinterpreted.

One value carve-out is ruled (pole-encoding ruling, 2026-08-28): where the
interpreter answers the projective infinity `~oo` — a division pole, a Gamma
or Factorial pole, an embedded `~oo` constant — a float-only target answers
the IEEE `Infinity` instead of declining. The projection keeps the infinite
magnitude and drops the direction `~oo` never had; it is what the bare
division instruction already answers at a runtime pole, so folded and
runtime spellings of the same pole agree. `NaN` remains reserved for the
genuinely indeterminate (`0/0`, `0 · ∞`) and for NaN propagation under
Contract B's `propagate` policy.

For an indeterminate form the two routes spell the answer differently, and
the compiled output did not change for it. Since 2026-09-29 the
interpreter's exact route answers `Indeterminate` for an exact form with no
value (`0/0`, `0 · ∞`, `0^0`, `Mod(x, 0)`), and answers `NaN` for the same
form with a float operand and under `.N()`. Every compiled target has only
the IEEE `NaN`, so it answers `NaN` for both: an `Indeterminate` constant
compiles to `NaN` in JavaScript, `np.nan` in Python and `_gpu_nan()` in the
shaders. This agrees with the interpreter's numeric route. Design:
`docs/plans/2026-09-28-indeterminate-value.md`.

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
| `Sign(1/x)` | `x = 0` | `1` | `Indeterminate` (`evaluate()`), `NaN` (`.N()`) |
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
`glsl`, `wgsl` and `interval-js` (`'false'`), and so is `0 < 1/0`. This
applies when the other operands are pure and cannot be lists at run time;
otherwise the comparison keeps its code, with the pole as `Infinity`
(`constantPoleOrdering` in `base-compiler.ts`, ROADMAP CE-211). The value
`False` was chosen because no single compiled value of the pole gives the
interpreter's answers both in an ordering and in arithmetic: `NaN` gives
`false` in every ordering, but `x + 1/0` would then be `NaN` where the
interpreter answers `~oo`, which the projection spells `Infinity`. An
equality is not changed: `x = 1/0` compiles to `x === Infinity`, `false`
for a finite `x`, as the interpreter answers, and `1/0 = 1/0` folds to
`false` on `javascript`, `glsl`, `wgsl` and `python`, also under
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
interpreter does. Two absent operands (`undefined` on JavaScript, `None` on
Python) are not equal in the SCALAR lowering: the interpreter answers `Missing`
for `Equal(Missing, Missing)`, and the emitted test guards the left operand when
both sides may be absent. That scalar answer stays a genuine boolean on purpose,
because the branch machinery is written against one.

The ELEMENT-WISE runtime is three-valued, and that is where an absence shows.
An absent CELL makes its comparison undecided, so the runtime marks exactly that
position with `NaN` — how a real target renders `Missing` in a cell — instead of
answering a decided `false`: `Equal([1, 2, 3], Missing)` compiles to three marks
as the interpreter answers `[Missing, Missing, Missing]`, and
`Equal([1, Missing], 1)` compiles to `[true, NaN]` as the interpreter answers
`[True, Missing]`. A `NaN` OPERAND is not an absence — it is a number that
equals nothing — and still answers a decided `false`. Two consumers already read
the mark: the selection runtime consumes a position whose condition cell is
absent instead of offering it to a later clause, so an element-wise piecewise
answers absent there rather than taking a branch; and the element-wise
connective guard tests absence as `x !== x`, so a marked cell combines
three-valued with `And`/`Or` and a decided `false` still absorbs it.
`KroneckerDelta` is unaffected, since its codomain is numeric and it answers `0`.

Making the SCALAR comparison undecided as well was measured and declined: it
reaches the fused selection lane, the value-position connectives, the
operand-binding rules and the short-circuit order of a chained comparison, which
is a far wider change than the cell-level defect it would fix. The remaining
divergences are recorded in `ROADMAP.md`.

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
conversions of `run()` from `entryPlan` (a real given to a complex-declared
symbol is lifted, a complex value for a real symbol is refused, a string or a
typed array for a symbol read as an array is refused). The
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

Functions passed in the `functions` or `imports` compile options are copied into
the code as source (`toString()`): a closure loses its enclosing scope, and a
function given by name must exist where the code runs.

`compilation/javascript-runtime.ts` holds the helpers and imports no engine code
(`test/compute-engine/js-runtime.test.ts` bundles the entry point and checks
it). `run.SYS` is built from the same factory.

## Target boundaries

The JavaScript target supports the broadest dynamic representation. Python,
GLSL, WGSL, interval, and other targets expose narrower capabilities and must
decline outside them. A feature implemented for JavaScript is not implicitly a
cross-target promise.

Values crossing the compiled boundary use the target ABI. Complex values use
the documented scalar-or-`{re, im}` convention; nested collections retain
their shape. Target entry checks reject values incompatible with the compiled
lane assumptions.

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
is the route that validates. The `strict` mode, and the default `auto` mode
when it does not escalate, read the entries of a `list<number>` on the real
lane; the `complex` mode reads them on the complex lane (see "Complex
modes"). Any other value passes untouched and the
lowerings dispatch on its runtime shape: a scalar there is not an error,
because a declared type is routinely wider than the value a caller binds and
several lowerings project on the runtime shape — a `list`-typed summand of
an element-wise big operator bound to a number gives the scalar sum. A
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
  the operand is undefined. An absent operand (an `empty` with the `missing`
  flag) gives `'maybe'` for every relation.

The interpreter fallback (`success: false`, with `fallback` not `false`)
gives the same shapes: a number is the `interval` result of a point, and an
absent value is `empty`.

A conditional whose condition is undecided over the cell gives the hull of
its arms. When one arm is `empty` — the missing default of a `Which`, or an
arm with no value, such as an `At` out of range — the other arm is present
over part of the cell only, and the hull is that arm clipped as an undecided
`When` clips it: an `interval` becomes `partial`, and a list is clipped
element by element. `Which(x < 0, 1)` over `x = [−1, 1]` gives
`{ kind: 'partial', value: { lo: 1, hi: 1 }, domainClipped: 'both' }`; before
2026-10-18 it gave an `interval` result, a value claimed over the whole cell
(`hullValues`, `interval/comparison.ts`).

### Statement order on the shader targets

GLSL and WGSL have no let-expression, so a lowering that needs statements — a
loop-form `Sum` or `Product`, a `Block` used as a value, the statement form of
a conditional, a lowering that binds an impure operand to a temporary — is
hoisted into the enclosing statement sink, AHEAD of the whole enclosing
expression. An operand written EARLIER in that expression therefore runs after
the hoisted statements where the interpreter runs it first. With constant
folding off, `(Random(), Σ_{n=1}^{⌊t⌋} Random())` emits the loop and then
`return vec2(_gpu_rnd_draw(…), _tv1);`, so the first component is the draw
after the loop's; `(k := 1, Σ_n k·n)` reads `k` before the assignment. This is
a documented difference of the shader targets (decided 2026-09-21): an
expression that mixes a hoisting operand with an effect written before it does
not keep the interpreter's order. A general reordering (bind an earlier operand
ahead of a hoisting sibling, decided per occurrence at the parent's lowering
dispatch) was built and withdrawn in 2026-09 after review kept finding compile
paths it did not cover; it is not planned. Pure expressions, which every corpus
document has at this position, are unaffected.

## Complex modes

`strict` preserves real-lane assumptions and declines on an incompatible
complex boundary. `complex` compiles wide numeric bindings through complex
kernels. This includes the cells of a list or tensor input whose cell type
admits a complex value (`list<number>`, `tensor<number>`, `list<unknown>`):
the element-wise lowering of arithmetic and of the cell functions uses the
complex-aware kernels (`_SYS.sadd`, `_SYS.smul`, `_SYS.csqrt`, …), as for
`list<complex>`, while cells typed `real` or `integer` keep the real lane.
`auto` first attempts strict mode and retries once in complex mode on a lane
mismatch. The result records its effective mode, promotion, escalation,
and diagnostic.

Unknown-sign radical operations are the promotion trigger. Real-only kernels
guard and project only where the model explicitly permits it. `Mean`,
`Variance`, `StandardDeviation` and their population forms are the exception
on JavaScript (`CompileTarget.complexLowering`): in the `auto` and `complex`
modes, data that may hold a complex entry takes `_SYS.cmean`, `_SYS.cvariance`
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
since it does not compute that matrix power. A base whose type may hold a
point (`list<unknown>`, a bare `list`, `list<tuple<…>>`) keeps the
element-wise power: a point is an array at run time, so a list of points and
a matrix have the same value there, and hosts pass lists of points.

A declared real result is real on every mode. A function declared with a real
result type (`p: (real) -> real`, also `-> finite_real` and `-> nan | real`)
has its body wrapped in a real ascription, `Typed(body, 'real')`. When the
body is complex only because of promotion — complex with promotion on, real
with promotion off — the ascription selects the real lane for the body: the
body compiles with promotion off, as `strict` compiles it, in the `auto` mode
and in the `complex` mode. An unknown-sign `Sqrt`, `Ln`, `Log`, even `Root` or
non-integer `Power` in the body then gives `NaN` outside its real domain, the
same value that `strict` gives. This is the reading that a real-typed symbol
already has: the type `real` excludes `NaN`, and `NaN` is the answer when a
real result has no value. The result reports `promoted: false` for such a body.
For example, with `p := k ↦ sin(2.4k)·√((k − 0.5)/16)`, `p(x)` compiles to
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
code on every target, GLSL and WGSL included: `Floor(π·x)`, `Floor(x + 1/3)`,
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
`auto` and `complex` modes: the operand is bound once, the head's real
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
without it keeps the compile-time decline. The deprecated
`complexPromotion` option is a compatibility shim, not separate semantics. The
`realOnly` option, which projected a compiled unit's RESULT to a real number
(or `NaN`) after the kernel had run, is removed: a compiled value whose
imaginary part is exactly zero is already returned as a plain number, so a
consumer tests `typeof v === 'number'` per sample and maps a `{re, im}` at its
own value boundary.

The remaining quiet-machine performance measurement is tracked in
`plans/2026-08-16-compile-complex-mode.md`.

## User functions and dispatch

Single and multi-clause functions compile once per artifact. Multi-clause
dispatch uses the same specificity order as the interpreter. If any required
guard cannot be expressed, the entire function declines; compiling a subset of
clauses would change dispatch.

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

## Collections

Compiled broadcasting preserves the interpreter's strict lifted regime.
Compiled pairing preserves shortest-input semantics. `PointList`, elementwise
selection, Map lowering/fusion, exact-map proof, and collection callbacks must
retain evaluation-once and effect ordering.

A compiled user-function call whose parameters are all scalar carries a
runtime `Array.isArray` guard around each argument that is not a literal, so
a `run()` caller that supplies a list gets the interpreter's broadcast instead
of a silent wrong answer (user ruling 2026-08-30). The guard is not emitted
for an argument whose scalar type is an explicit declaration or is constructed
from such values by scalar arithmetic (user ruling 2026-09-07): the
declaration is the caller's input contract, and the interpreter itself refuses
a list for a `number`-declared symbol. A symbol whose scalar type was inferred
from its use in a scalar parameter keeps the guard, because that inference is
not a promise about the value the caller passes.

Two values inherit that same "scalar by construction" standing. A call of an
engine-defined function whose every argument is such a value is one, when the
callee's body yields a single scalar under scalar parameters — the body's
static type says so, or its `Block`, `If`/`Which` arms and nested calls all
do. And inside an emitted body, a parameter whose type in the function's
signature is a scalar one — `number` and its subtypes, `boolean`, `string`,
whether the author wrote that type or the engine inferred it (user ruling
2026-09-08) — is one. Every emitted call site of such a function hands that
parameter a scalar, because a call whose argument is not provably scalar is
dispatched element-wise or guarded, and the only form that passes an argument
straight through is the one an explicit caller declaration already exempts —
a caller that hands that form a list has broken its own declared contract.
The inference is trusted here, unlike at a top-level input, because the body
never chooses what reaches it: the call sites do, and they are all
broadcast-aware.

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

A parameter typed `unknown` or `any` has the same standing (user ruling
2026-09-09). The argument for it is the one above, and it does not depend on
the parameter's own type at all: what makes the parameter a run-time scalar is
that every emitted call site of its function is broadcast-aware, which is a
property of the FUNCTION — none of its parameters binds an argument whole — not
of the type inference. So `f(x) := g(x) + 1` emits the bare `_fn_g(x)`, the
same call an explicitly annotated `f(x: number)` emits, and a caller that
passes a list is broadcast element-wise at its own call site, so the body runs
once per element with a scalar bound. The body's own arithmetic already assumes
this: `x * x` is written for a product, not for a Hadamard product. This
matters because a whole class of consumer input cannot be annotated — a Desmos
macro chain is a chain of small untyped functions of one or two variables — and
each dispatch it used to emit cost roughly a factor of two in run time.

A COLLECTION parameter is the exception and keeps its dispatch: such a body
legitimately receives a list whole, the way `k(L) := Sum(L)` does, so its call
sites emit a bare call that could hand a list to a scalar sibling parameter. A
tuple- or point-typed parameter is excluded for the same reason.

The runtime broadcast of a user-function call is handed the emitted function
itself (`_SYS.bcastFn(_fn_f, …)`). A closure is emitted only when an argument
needs the `{ re, im }` coercion inside it; otherwise the closure would be an
eta-expansion of the callee.

An ATOMIC argument — a tuple (a point) or a nominal value — is bound whole by
the interpreter and never mapped over, yet it lowers to a JS array the runtime
broadcast would descend into. Such an argument is therefore HELD: it is bound
to a temporary once, and the broadcast closes over that temporary and maps the
other arguments only. So `f((a, b), [u, v])` with `f(p, x) := g(x)` runs the
body once per element of the list with the point bound whole, which is what the
interpreter does. Every argument that is not a literal is bound in the same
outer call, so an argument is evaluated exactly once and in source order — a
random draw in a coordinate draws one number. When every argument that is not
atomic is provably scalar, there is nothing to map over and the call is the
bare direct one.

A function REFERENCED AS A VALUE — the callback of `Map`, `Filter`, `Reduce`,
a comparator, a `PointList` role — is a call site too, and it is shape-aware
for the same reason the others are. The consumer of a function value hands the
callee whatever element the source holds, and an element can itself be a
collection: a row of a matrix. So a function whose parameters are all scalar
is handed out as a wrapper instead of the bare name — one closure per
function, emitted next to the function itself, which tests its arguments with
`Array.isArray`. Whether a function gets that wrapper follows what the
INTERPRETER does with a collection element at that callback:

- A function whose parameters are all scalar is applied ELEMENT-WISE by the
  interpreter: `Map(f, [[1, 2], [3, 4]])` over `f(x) := 2x` answers
  `[[2, 4], [6, 8]]`. It is handed out as a broadcasting wrapper (`_fn_f$b`)
  that dispatches through `_SYS.bcastFn`. The parameter TYPES make no
  difference here: a declared signature such as `(number) -> number`
  broadcasts exactly as an inferred `unknown` one does, which is the user
  ruling of 2026-09-22. Before that ruling the interpreter refused a
  declared-scalar callback at a callback position, and such a function was
  handed out as a second, guarding wrapper (`_fn_f$s`) that projected an array
  argument to NaN. Both halves now broadcast, so the two routes also agree on
  a source only SOME of whose elements are collections: `[[1, 2], 3]` answers
  `[[2, 4], 6]` compiled and interpreted alike.
- A function with a parameter that is not scalar at all keeps the bare
  reference, because the interpreter binds its arguments whole as well.

A MULTI-CLAUSE function is handed out through the same wrapper, under the same
rule read over the whole clause set: a clause that binds a collection, a tuple
or a nominal value whole keeps the bare dispatcher, and every other clause set
broadcasts. Its wrapper takes a REST parameter, where a single-clause one takes
a fixed parameter list, because the dispatcher selects its clause on the number
of arguments. That is safe because every consumer this compiler emits applies a
function value through an arrow of the arity it means to pass — `(_x) => _f(_x)`
for `Map`, `(_a, _b) => _f(_a, _b)` for a `Reduce` combiner — so none of them
supplies the extra index and source arguments `Array.prototype.map` would.

Where a parameter also needs the `{ re, im }` coercion, the wrapper takes the
coercing shim as its callee, so an element reaches the body coerced.

The other two things that can stand in a callback position both broadcast, and
take a wrapper of the first kind. A bare BUILT-IN operator name
(`Map(Sin, xs)`) is eta-expanded into a scalar kernel, so an element-wise
operator is handed out as `_fn_Sin$b`; its
wrapper dispatches through `_SYS.bcast`, the OPERATOR broadcast; a function
literal takes `_SYS.bcastFn`. The two follow the same element-wise rule,
empty operand included — a broadcast over a lone empty operand answers the
empty list (`Sin([])` is `[]`). A built-in that consumes its argument whole,
such as `Length` or `First`, is not broadcast by the interpreter either and
keeps the bare name. An INLINE function literal (`Map((x) ↦ 2x, xs)`) takes
the `_SYS.bcastFn` wrapper a named user function gets; having no name of its
own, the arrow is bound once — a `const` where a statement sink exists, an
immediately applied arrow otherwise — so the wrapper's two mentions of its
callee do not build a fresh closure per element. A literal with a
collection-typed parameter keeps the bare arrow.

Implicit Map compilation obeys the engine-wide `jit` gate. Exact-mode Map
compilation requires an explicit proof that native-number execution preserves
the requested exact result. Structural or ABI failures are cached at the
appropriate expression-instance boundary.

### GPU `At`

GPU `At` preserves the engine's 1-based indexing through a guarded target
projection. A statically sized real-scalar vector/array base and a scalar index
may lower; negative indices count from the end, while zero, out-of-range,
non-integer, and missing indices project to the target's NaN value. Literal
integer gathers may fold or lower when every selected element preserves
evaluation count. A discarded impure element forbids folding.

Dynamic gathers, runtime boolean masks, point-list bases, unknown extents, and
non-real element/index shapes decline. GLSL/WGSL bounds behavior is never
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

On the SHADER targets (GLSL, WGSL) a color is a bare `vec3` with no run-time
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

## CSE and naming

Common-subexpression elimination is region-based and must respect effects,
bindings, evaluation order, and target representation. Compiler-internal types
stay structurally opaque where importing boxed-expression types would create a
module cycle. The remaining CSE design work is in the active
`plans/2026-07-28-compile-cse-design.md`.
