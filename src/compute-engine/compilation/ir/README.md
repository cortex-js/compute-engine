# The slice compiler

An experiment: a table-driven compiler with an SSA representation and two thin
printers, JavaScript and GLSL ES 3.00. It is not wired into `compile()`. The
entry is `compileSlice(expr, { target, passes, extend, iterationBudget })` in
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
bound by the walk, no effect and no loop is evaluated once with `N()` and
becomes a literal (`Mod(1, 1/10)` is exactly 0). A closed `Zeta(3)` is not
folded, because `Zeta` is not in the slice. A throw of `N()` means "not folded":
the node is lowered as written, except a `CancellationError`, which propagates.
A row that depends on an engine setting declines when the setting is not the
default.

A root `Function` literal compiles to a function of positional parameters, then
the inputs object for its free names: `run(3, 4, { x: 1.5 })`.

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
real.

Inputs: a scalar with no declared type, or of type `unknown` or `number`, is a
real (a deliberate difference from the existing compiler). An outer list of no
stated length (`list<real>`, `list<list<real^2>>`) has a run-time length
(JavaScript only). `any` and a list element of type `unknown` or `any` decline
with the input's name.

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
`may-fail` (removed when unused; nothing else), `effectful` (keeps its place,
count and order). The effect of a user function is the least fixed point from
`pure` over its calls, so a pure recursive function is pure. A node is memoised
by the effect of what it emitted: a node whose lowering emitted an effectful
instruction is lowered again at each use. The operands of `And`, `Or` and a
chain are lowered lazily, in arms; the `hoist` pass makes a speculatable arm a
plain `and` or `or`. After each pass a check compares the sequence of effectful
instructions (operation, operands and region); the same check runs over the
printer's order.

A `WithRandomSeed` frame whose body has one draw site evaluated once (not under
a loop, a `Map`, `Filter`, `Sum` or `Product` body, or a call of an effectful
function) gives the interpreter's draws bit for bit: its draws start at index 0
on entry of the frame. Any other frame compiles, in the compiler's order,
deterministically, and the result carries a warning `seeded-draw-order` that
names the frame and why. A draw is the engine's own (`makeRandomHelpers()` over
the engine's frame slot): a compiled draw reads the frame it runs in.

## Loops and the runtime

On JavaScript each pass of a loop or a build begins with `_rt.tick()`: it checks
the engine's deadline (`ce.withTimeLimit()`) every 1024 passes, and with the
`iterationBudget` option it adds one to one count for a call of `run()`, nested
loops, builds and the loops of user functions included; over the budget, `run()`
throws a `CancellationError` with the cause `iteration-limit-exceeded`, as
`compile()` does (`docs/COMPILATION-MODEL.md`, "A limit on `Loop` passes"). The
count is in the runtime, reset when `run()` starts, and is not in the IR. GLSL
has no deadline and no budget.

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
