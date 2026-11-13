# The slice compiler

An experiment: a table-driven compiler with an SSA representation and two thin
printers, JavaScript and GLSL ES 3.00. `compile()` uses it only with the
experimental option `profile: 'ir'` ("Selecting the pipeline" below). The entry
is `compileSlice(expr, { target, passes, extend, iterationBudget })` in
`index.ts`; it returns the code and its `warnings`. Anything out of scope throws
a `Decline` with the fields `node`, `head` and `cause`, also for a refusal of
the target profile. A failure of the verifier or of the effect-trace check is a
`SliceInternalError`: a defect of the compiler, not a decline.

## Layers

| File                           | Does                                                                           | Does not                                 |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `operators.ts`                 | One row per operator (arity, signatures, effect, fold, alias); region rows     | Name a target                            |
| `lower.ts`                     | The one walk: the head's binding, the constructs, scopes and arms              | Optimize; spell                          |
| `lower-lists.ts`               | List sources (an input, a `Range`, a build), reductions, `Max` and `Min`       |                                          |
| `lower-functions.ts`           | User functions by definition, signatures, the fixed point of their effects     |                                          |
| `lower-context.ts`             | The types the three lowering files share; `Decline`                            |                                          |
| `ir.ts`                        | Types, instructions, functions, the builder, the def-use index                 | Know a target                            |
| `effects.ts`                   | The effect of an instruction and of a function; the eligibility queries; trace |                                          |
| `verify.ts`                    | Definitions, dominance (of values and lengths), types from the tables, calls   | Re-derive a type rule                    |
| `passes.ts`                    | `scalarize`, `fold`, `strength`, `hoist`, `cse`, `dce`                         | Change the effect trace                  |
| `print.ts`                     | The shared statement printer, the inline policy, the copy of a result          | Decide anything that depends on a target |
| `print-js.ts`, `print-glsl.ts` | A `Syntax`: spellings, types, statement forms; the JavaScript runtime          | Analyse the program                      |
| `index.ts`                     | The target profiles and their one check (`admits()`); the frame warnings       |                                          |

Every table (`OPERATORS`, `REGION_ROWS`, `REDUCTIONS`, `JS`, `GLSL`, `TARGETS`)
is frozen, and every cache lives in one `lower()` call: the emitted text is a
function of the expression, the options and the definitions it reads, and
nothing persists from one compilation to the next. A test adds rows, spellings
and helpers with the `extend` option.

The head decides first: a head bound to a user function (by its definition, not
its name) is a call, also when it is named `At` or `Sin`; a library head is
compiled only when `isLibraryOperator()` holds; anything else declines. Then a
sub-expression that the slice would lower and that has no free name, no name
bound by the walk, no effectful operation and no loop is evaluated once with
`N()` and becomes a literal (`Mod(1, 1/10)` is exactly 0). A closed `Sinh(3)` is
not folded, because `Sinh` is not in the slice. A throw of `N()` means "not
folded": the node is lowered as written, except a `CancellationError`, which
propagates. A row that depends on an engine setting declines when the setting is
not the default.

A root `Function` literal compiles to a function of positional parameters, then
the inputs object for its free names: `run(3, 4, { x: 1.5 })`.

A free name that has a value in the engine (a constant, or a variable) is that
value, lowered at compile time as a literal, only when the value is a number of
the engine (an integer, a rational, a radical such as `Sqrt(2)`, a complex) or a
list of such numbers: no symbol and no other application. The value is read from
the innermost binding of the name (`ce.lookupDefinition`), as the interpreter
reads a symbol that is not a call. Any other value declines, also a closed one
(`Pi + 1`), since the names in a stored expression have bindings of their own
(an outer `a = 2` and `v := a + 1` give 3 in the interpreter under a scope that
declares `a = 10`). The program lists the name in `captures` (`symbolDeps`),
unless its binding is the library's. A name with a value read in the body of a
user function declines: the interpreter reads the binding of the body, which
need not be the one of the name where the call is compiled. `Pi` and
`ExponentialE` decline when the innermost binding of the name is not the library
constant. A reassignment after the compilation does not change the code, and the
inputs object is not read for that name (the existing compiler also writes
`ce.assign('v', 10)` into `v + x` as `10 + _.x`).

## The contracts

1. **Numbers.** On JavaScript a `real` is an `f64` and an `integer` is exact
   within 2^53; on GLSL a `real` is an `f32` and an `integer` exact within 2^24.
   No rewrite changes the operation of an integer computation (an integer `Mod`
   stays an integer `Mod`); a rewrite of a real computation keeps the value
   within the target's precision.
2. **Agreement.** There is no promise of identical bits across executions or
   compilations: two executions of the same program agree within 1e-12 relative
   on JavaScript, and within single-float precision on GLSL. (A test checks that
   the passes on and off give the same bits on JavaScript; that is a test, not a
   contract.)
3. **Order.** No order of execution is promised for pure operations. An
   operation that is not pure is evaluated exactly once per evaluation that the
   program asks for, in program order: the operands of an operation in canonical
   order, before it; an arm only when taken (also the operands of `And` and `Or`
   after one that decides, the pairs of a chain after a false one); a loop or
   build body once per index, in increasing order; the arguments of a call
   before it. The compiler does not reproduce the interpreter's order between
   operands.
4. **Determinism.** The emitted text is a function of the expression, the
   options and the definitions it reads.

`Power` is on the real lane. On JavaScript it calls the engine's real-power
function (`realPow` in `operators.ts`, through `_rt.pow`), which the fold also
uses: a negative base with a rational exponent of odd denominator gives the
interpreter's real root (`(-8)^(1/3)` is -2), also for a run-time exponent. On
GLSL it is `pow()`, whose value for a negative base is undefined in GLSL ES
3.00: the driver gives NaN, 0 or any value. A real literal at or above 2^53 is a
real. An integer value of 2^53 or more is a double and its low digits are
unspecified (`Mod(2^60 + n, 3)`; rule 3 of
`docs/plans/2026-11-12-js-route-course-correction.md`): the compiler makes no
analysis of integer ranges. A closed node keeps the interpreter's value
(`Mod(2^60 + 1, 3)` is 2). At run time, `Mod` (`_rt.mod`, `floorMod()`) throws a
`RangeError` for an operand beyond ±(2^53 − 1) or infinite, as the existing
compiler does (`docs/COMPILATION-MODEL.md`, "Integer operations beyond the safe
integer range"): `Mod(n!, 7)` at n = 25 is 0, and the remainder of the double
is 6. So `Mod` is `may-fail`. GLSL has no error channel: there `mod()` of a
value beyond 2^24 is the remainder of the float, unspecified.

The real functions (`Erf`, `Gamma`, `Root`, the inverse trigonometric and
hyperbolic functions, ...) are rows whose operation the JavaScript runtime calls
by name from `REAL_FUNCTIONS` in `operators.ts`, which the fold of the row calls
too. Each gives the interpreter's real value within the precision of a double
(`Zeta` below about -171 is a known limitation, `docs/COMPILATION-MODEL.md`); a
pole is ±∞ and a value that is not real is NaN (`Root(-4, 2)`, `Arcsin(2)`). On
GLSL a row has a spelling only where GLSL ES 3.00 has a builtin defined on every
real (`atan`, `asinh`, `sign`, `trunc`, `fract`); the other rows decline there.

Inputs: a scalar with no declared type, or of type `unknown` or `number`, is a
real in the `strict` mode (a deliberate difference from the existing compiler)
and a complex in the `complex` mode; a scalar `complex` input is on the complex
lane, and a number given for a complex input is lifted to `{re, im: 0}`, also
with `entryChecks: false`. A list of complex elements declines: an entry of such
a list can be a number or a `{re, im}` object (the ABI of
`docs/COMPILATION-MODEL.md`), and only a run-time test tells them apart. An
outer list of no stated length (`list<real>`, `vector`, `list<list<real^2>>`)
has a run-time length (JavaScript only), also as a parameter of a root function
literal: the length is a positional parameter before the list, read from the
argument. `any` and a list element of type `unknown` or `any` decline with the
input's name.

A `Declare` in a `Block` has a value, positional or in its attributes
(`Declare(t, {value: 0})`; a declaration with no value is an error of the
canonical form), and a type `real`, `integer` or `boolean`, as a string or a
symbol; with the type `unknown`, or none, the local is a real (a boolean for a
boolean value), as the interpreter admits a real write to `let t = 0`. Another
attribute (`constant`) declines.

## The complex lane

A third lane, `complex`, is a `{re, im}` object on JavaScript; a real or an
integer is converted to it where a complex is read (`cplx`, which `apply()`, the
arms of a conditional, a list, a local and an accumulator insert), so the lane
of every value is settled at compile time and no code tests a value. The rows
`Add`, `Subtract`, `Negate`, `Multiply`, `Divide`, `Power`, `Root`, `Sqrt`,
`Exp`, `Ln`, `Log`, the trigonometric and hyperbolic rows, `Abs` (real), `Real`,
`Imaginary`, `Conjugate`, `Argument` (real), `Equal` and `NotEqual` have a
complex signature; another row (a comparison, `Floor`, `Mod`, `Max`, ...)
declines a complex operand. The JavaScript runtime calls `COMPLEX_FUNCTIONS`
(`operators.ts`), which the fold calls too: the engine's machine complex
functions (`SYS_HELPERS` of the existing runtime), and the ring operations part
by part. GLSL declines the lane. In the `strict` mode a program whose root is
complex returns a `{re, im}` object, also when its imaginary part is 0. In the
`complex` mode the adapter returns a complex root of imaginary part exactly 0 as
the number, as the ABI of the mode says (`CompileMode`); it states no such rule
for the elements of a list, which stay `{re, im}`. A program whose root is real
returns a number.

The mode. A row with `leaves` (`Sqrt`, `Ln`, `Log`, `Power`, `Root`, `Arcsin`,
`Arccos`, `Arcsec`, `Arccsc`, `Arcosh`, `Artanh`, `Arcoth`, `Arsech`) takes its
complex signature in both modes when its operands are finite constants on which
its real function is NaN: `Ln(-2)·x` is complex, with and without
`constantFold`, as the `strict` contract says of a logarithm or a radical of a
provably negative operand. Otherwise, in the default `mode: 'strict'` a row
takes the signature of its operands' lanes: a real operation outside its real
domain is NaN (`Sqrt(x)` at `x = -4`). In `mode: 'complex'` a row with `leaves`
takes its complex signature unless an operand proves the real value by what
cannot change after the compilation: an exponent on the integer lane (`x^2`,
`x^n`), or a base or radicand that is a nonnegative constant, or a value of
`Abs`, `Exp`, an even power, or a sum or a product of such values
(`Sqrt(x^2 + 1)`). The type of an input is not read: an assumption narrows it
(`assume(s >= 0)` makes it `real<0..>`) and `forget()` widens it again after the
compilation. `Sqrt(x)` at `x = -4` is then `{re: 0, im: 2}`.

Inputs in the complex mode: an input of type `number`, `unknown` or no declared
type is complex (`CompileMode`), so a comparison of it declines; an input
declared `real` or `integer` stays real. The strict mode reads such an input as
a real.

Declined: `Max`, `Min`, `Floor` and the other integer rows of a complex, a
comparison other than `Equal` and `NotEqual`, the real functions (`Gamma`,
`Erf`, `Zeta`, ...) of a complex, a complex `Max` or `Min` reduction, and
`ComplexInfinity` as a literal; a real pole (`Gamma(-2)`) stays a real infinity.

Ill-conditioned points (docs/plans/2026-11-12-js-route-course-correction.md,
rule 1): near a branch point, a pole or a cancellation the lane gives the
function's value at an argument within a few ulps of the given one, which can
differ from the interpreter by more than 1e-12 or be ±∞ or NaN where the
interpreter is finite (`Arctan(Ln(x))` at `x = 0` is NaN, the interpreter gives
`-π/2`; `Ln(x)·y` at `x = 0` is `-∞ + NaN·i`). On a branch cut the side follows
the sign of the zero part, IEEE style (`Argument(-Z)` at `Z = 0` is π); the
adapter makes a `-0` part of a complex input `+0`.

## Lists

A length is a number or an integer SSA value: the length of an input is a
parameter before it, the count of a `Filter` and of a `Range` an instruction.
Two lists with the same length value have one length (`D + Map(f, D)`,
`Range(1, n) + Range(1, n)`, after `cse`); the verifier checks that a length
value is visible where a type names it. `elem` reads an element from 0; `At` is
the interpreter's rule (from 1, from the end when negative, NaN outside), and
the fold turns an `At` of a constant index in range into an `elem`. A boolean or
nested list that can be out of range declines. `build` and `filter` are region
rows. A `Length`, a reduction, a `Map` or a `Filter` of a `Range` reads its
count and the arithmetic of its elements, so `Length(Range(1, n))` makes no
list. `Max` and `Min` fold from -∞ and +∞ over all their operands, and give NaN
when the total count of elements and scalars is 0. Whether a list result can
hold an input is read from the rows (`alias`): such a result is returned as a
copy.

## Effects

`pure` (merged, removed, moved, folded, evaluated where it was not written),
`may-fail` (removed when unused; shared by the lowering with an evaluation of
the same node that dominates it; nothing else), `effectful` (keeps its place,
count and order). The effect of a user function is the least fixed point over
its calls, from `pure`, and from `may-fail` for a function on a cycle of calls:
a recursive function may not terminate, so it and its callers are at least
`may-fail`, and a guarded recursive call is not evaluated before its guard. A
node is memoised by the effect of what it emitted: a node whose lowering emitted
an effectful instruction is lowered again at each use; a `may-fail` lowering (a
loop, a build, a call of a recursive function) is shared, because the evaluation
that dominates the use fails first if it fails. So the budget counts the passes
that run, and a `Loop` whose carried values are not read is removed and counts
none. The operands of `And`, `Or` and a chain are lowered lazily, in arms; the
`hoist` pass makes a speculatable arm a plain `and` or `or`. After each pass a
check compares the sequence of effectful instructions (operation, operands,
results and region); the same check runs over the printer's order.

A `WithRandomSeed` frame whose body has one draw site evaluated once (not under
a loop, a `Map`, `Filter`, `Sum` or `Product` body, or a call of an effectful
function) gives the interpreter's draws bit for bit: its draws start at index 0
on entry of the frame. Any other frame compiles, in the compiler's order,
deterministically, and the result carries a warning `seeded-draw-order` that
names the frame and why. A draw is the engine's own (`makeRandomHelpers()` over
the engine's frame slot): a compiled draw reads the frame it runs in.

## Loops and the runtime

On JavaScript each pass of a loop or a build begins with `_rt.tick()`, which
checks the engine's deadline (`ce.withTimeLimit()`) every 1024 passes. The
`iterationBudget` option follows the rule of `compile()`
(`CompilationOptions.iterationBudget`): a pass of a `Loop` (a `loop` instruction
with `passes`) begins with `_rt.pass()`, which also adds one to one count for a
call of `run()`, nested loops and the loops of user functions included; over the
budget, `run()` throws a `CancellationError` with the cause
`iteration-limit-exceeded` (`docs/COMPILATION-MODEL.md`, "A limit on `Loop`
passes"). The count is in the runtime, reset when `run()` starts. A `Sum` or a
`Product` with `Limits` whose count of passes is more than the budget is NaN
(`hi - lo < budget` is false), each loop by its own count: the lowering writes
that test as an `if`. A `Loop` in an integrand counts its passes once per sample
of the quadrature, whose number of samples is unspecified. A build, a `Filter`
and a reduction of a list count no pass. GLSL has no deadline and counts no
`Loop` pass.

`Loop(body, Element(i, L), …)` is a statement whose value is `Nothing`: one
counted loop per clause over the source of `L` (an input list, a list, a
`Range`), a later clause lowered in the body of the one before, so it reads its
index. The locals declared outside the loop that the body writes are its carried
values. A `Loop` with no `Element` clause, a `Break`, a `Continue`, a `Return`,
a write to the index and a `Loop` whose value is read decline: the structured
regions have no early exit.

`Integrate(f, Limits(t, a, b))` and `NIntegrate(f, a, b)` of real bounds
(infinite ones too) and a real integrand (a function literal of one parameter,
or a body in the name of the `Limits`) are the region `integrate`: the integrand
is an arrow function that the runtime passes to the existing compiler's
quadrature (`SYS_HELPERS.integrate`: adaptive Gauss-Kronrod, stated tolerance
1e-10 relative and 1e-12 absolute, with a Monte-Carlo fallback that draws from
the engine). As for any pure operation, the number of evaluations of an integral
is unspecified (an unused one is removed), and the fallback's draws are not the
program's. An integrand with an effectful operation declines (the routine
chooses its samples), as do two variables and the option
`quadrature: 'monte-carlo'`. GLSL has no spelling.

## User functions

A user function is lowered once per compilation, keyed by its definition: the
parameter types from the signature of its binding (`real` when unknown), the
result from the signature or the body. A recursive one needs a result type
(declared, or inferred by the engine). A capture, a function value other than
the literal of a `Map` or `Filter` or the root, a list argument, and a list
parameter decline.

## How to add

- An operator: one row in `OPERATORS`; a spelling in `JS.ops` and `GLSL.ops` for
  each new IR operation (`op.int` falls back to `op`). A target with no spelling
  declines the operation.
- A list-reading operator: a row with a `'list'` operand (as `At`), or a
  reduction in `REDUCTIONS` (it reads its list through a source).
- A construct: one case in `lower.ts`. A construct with a body is a region row
  in `REGION_ROWS` (arguments, parameters, result types, alias) and a region
  spelling per target; no new instruction kind.
- A pass: a function over `rewrite()` that asks `effects.ts` first.
- A target: a `Syntax` (operation spellings, region spellings, types, statement
  forms) and a `Profile` in `TARGETS` (`lanes`, `rank`, `runtimeLengths`,
  `draws`, `frames`, `recursion`, `elementwise`). `admits()` is the one check.

## Limits

- A loop or a build of 2^32 iterations or more throws on JavaScript; GLSL clamps
  its `int` bounds to ±2^30. GLSL has no run-time length, region, draw, frame or
  recursion.
- A list of lists of run-time length (other than an input's outer list), a
  `Range` of reals, a string seed, a list of run-time length made in a random
  frame, and `Random` of a domain decline.
- A copied list result is a `structuredClone`: two rows that are the same list
  in the result (`[L, L]`) stay one object in the copy.
- A `real` local declared or assigned a value outside its type (NaN, a complex
  number) is an error of the interpreter; the compiled code goes on with the
  value, and can overwrite it (`Block(Declare(t, real, Sqrt(x)), t := 2, t)`
  gives 2 at x = -1).

## Selecting the pipeline

`compile(expr, { profile: 'ir' })` on the `javascript` target compiles with this
pipeline (experimental: the option can change or go without notice). All the
glue is in `adapter.ts`; `compile-expression.ts` dispatches to it next to the
`numeric-kernel` profile.

- **A decline** (`Decline`, also a refusal of the target) is the public
  diagnostic `'outside-profile'`, with the head in `operator` and the node in
  `value`; any other error of the pipeline (`SliceInternalError`, a printer
  error) is a `'compile-error'`. Both follow `fallback` as for the
  `numeric-kernel` profile: the interpreter, or a throw with `fallback: false`.
  A `CancellationError` is thrown as it is.
- **Options.** One table classifies every option of `compile()` (`IR_OPTIONS` in
  `adapter.ts`; `compile-expression.ts` fails the type check when an option has
  no class). Mapped: `iterationBudget` ("Loops and the runtime"), `vars`
  (below), `quadrature` (`'adaptive'`; `'monte-carlo'` declines), `entryChecks`
  (a `{re, im}` value for a scalar real or integer input or parameter, and a
  value that is not an array for a list input, throw a `TypeError` that names
  it; a number for a scalar complex input or parameter is lifted to
  `{re, im: 0}` and a `-0` part made `+0`, in any case), `mode: 'complex'`
  (reported in the result's `mode`), `cse: false` (the passes without `cse`),
  `constantFold: false` (the lowering evaluates no closed sub-expression with
  `N()`, and the `fold` pass is off), `symbolDeps` (the user functions compiled
  in and the names whose value the code holds, `captures`) and `varsObjectRefs`
  (the inputs read from the inputs object, filled also when a literal declines
  for a free name). Admitted with no effect: `storage` (the JavaScript target
  ignores it, `CompilationOptions.storage`), `mode: 'strict'`,
  `broadcast: false` (the result has no `broadcast()`), and an empty
  `functions`, `operators`, `imports` or blank `preamble`. Declined by name:
  `functions`, `operators` (both forms), `imports`, `preamble`, the `mode`
  `'bigint'`, `broadcast: true`, `strictTypes: true`.
- **`vars`.** A mapped name is read as the host's text at each use, in program
  order (an effectful operation, so `w - w` with `w: '_.draw()'` calls `draw`
  twice), in the scope of the entry, where `_` is the inputs object. The mapping
  wins over the engine's value of the name and is never folded; a local of the
  same name shadows it. Its lane is the name's type (a wide or `any` type is a
  real). A read in a user function or a root function literal (no such scope), a
  call of a mapped name, a list or complex type, and a text with `$` and a digit
  decline. A mapped name is not an input (`freeSymbols`).
- **Calling convention.** The result is `calling: 'expression'`, `run(inputs)`,
  or, for a root `Function` literal, `calling: 'lambda'`, `run(a0, a1, …)`, as
  the existing compiler's result is called by `implicitCompile()`; a literal of
  no parameter (`Function(42)`) is a `lambda` too. A literal whose body reads a
  free name declines: that convention has no object for it (`compileSlice()`
  itself takes one after the arguments). The inputs of an expression are in
  `freeSymbols` and `varsObjectRefs`. A warning of a random frame is in
  `warnings` (`kind: 'correctness'`). `profile` is `'ir'`, `shippable` is
  `false` and `preamble` is empty: the code holds its helpers and reads the
  runtime `_rt`, so it cannot be stored or sent to a worker (no
  `runtimeVersion`). There is no `pure`, `freeSymbolTypes`, `broadcast()`,
  `runAsync()` or `entryPlan`.
- **The measures.** `CE_JS_PROFILE=ir` makes the engine's own compilations
  (`implicitCompile()`) try the profile first and fall back to the existing
  compiler; `CE_JS_PROFILE_SHADOW=ir` also compiles every JavaScript `compile()`
  with the profile, discards the result and counts it (`CE_JS_PROFILE_SHADOW=1`
  still measures `numeric-kernel`). With `CE_JS_PROFILE_STATS=<dir>`,
  `node scripts/js-profile-stats.mjs <dir>` prints the counts
  (`docs/plans/2026-11-10-js-profile-first-consumer.md`).
