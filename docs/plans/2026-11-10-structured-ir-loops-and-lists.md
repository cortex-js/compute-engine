# Structured representation: loops and lists (step 6)

**Status: design for step 6 of the
[JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md),
approved 2026-11-10 as part of the decision to continue. The choices marked
"choice" below were made by the agent and can be reversed.**

Step 6 adds what a numeric kernel needs beyond scalars: a loop over an
integer range, values carried from one iteration to the next, lists of
numbers that are read, built and updated. It follows the three objectives of
the plan: no target in the core, one definition per value, effects that name
what they touch.

## The fixtures

The heat showcase of Tycho
(`~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`), parsed with
`parseEpsil()` and boxed, gives these forms:

```
heatneighbor(H: list<real>, c, r: integer, center, boundary, obstacle: real) -> real
  If(c < 0 || N <= c || r < 0 || N <= r,
     If(0.5 < boundary, 0, center),
     If(heatwall(c, r, obstacle), center, At(H, c + N*r + 1)))

heatstep(H: list<real>, diffusivity, boundary, obstacle: real) -> list<real>
  Declare(a, min(0.25, max(0, diffusivity)))
  Declare(L, Comprehension(0, Element(j, Range(1, N^2))))
  Loop(Block(
         Declare(c, Mod(k - 1, N)); Declare(r, Floor((k - 1)/N)); Declare(v, At(H, k));
         If(heatwall(c, r, obstacle),
            Assign(L, ReplaceAt(L, k, v)),
            Block(Declare(neighbors, heatneighbor(...) + ... four calls ...),
                  Assign(L, ReplaceAt(L, k, a*(neighbors - 4v) + v))))),
       Element(k, Range(1, N^2)))
  L
```

`N` is a captured constant (32). `GreaterEqual` is written as `LessEqual`
with the operands exchanged. A `let` is `Declare(name, {value -> …})`, and
it occurs inside a loop body and inside a branch.

## Three changes

| Change | Adds | Fixture |
| --- | --- | --- |
| 6a | `Loop` over an integer range with carried scalar values; `Declare` in a loop body and in a branch; `LessEqual`, `Mod`, `Floor`, `Divide`, `Power` with the literal exponent 2 | a sum of squares; an iteration `z := z² + c` with a fixed count |
| 6b | lists as inputs and parameters, read only: `At`, `Length` | `heatneighbor` |
| 6c | lists that the program makes: `Comprehension` over a range, `ReplaceAt`, a list carried by a loop; the first analysis for concurrency | `heatstep`, `heatpaint` |

Each change is reviewed and committed alone. `Break`, `Return`, a loop over
the elements of a list, nested lists, tuples and strings are not in step 6
and decline.

## The core

**Types.** The semantic types gain `list of T`, with `T` a scalar kind. The
length is not part of the type. A target policy gives the representation
(JavaScript: an array; a GLSL policy would need a length known at compile
time and refuses the others).

**A list is a value, not a place in memory** (choice). `ReplaceAt(L, k, v)`
gives a new list value; no operation stores into a list. The reasons: every
value keeps one definition; a read needs no order relative to a write, because
it names the value it reads; and an analysis of two calls or two iterations
compares values, with no alias question. The alternative, a `store`
operation on a mutable list with an order of effects, matches the emitted
JavaScript more closely and makes each of those three points an analysis.
The cost of the choice is in the emitter: it must find where an update in
place is allowed (below).

**Operations.**

- `loop`: operands `from` and `to` (integers, evaluated once, before the
  first iteration); a body region with parameters: the index, and one
  parameter per carried value. The body yields the next value of each carried
  value, in order. The loop has one result per carried value. With no
  iteration, a result is the initial value. A local written in the body and
  read after the loop, or read in the body before its write, is a carried
  value; a local declared in the body is a value of the body region. The
  loop records the iteration budget of the compilation, so that each target
  writes its own check; the rule is the one of the existing compiler.
- `build`: operand `count`; a body region with the index as a parameter,
  that yields one element. The result is a list. It is the lowering of
  `Comprehension(body, Element(j, Range(1, n)))`.
- `at`: a list and an integer index, counted from 1 as in the language. The
  result has the element type. An index out of range gives the absent value
  of the target, as the existing emitter gives it
  (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code": `At` keeps
  absence, and every other operator applied to it is unspecified).
- `length`, and `replace-at` (list, index, element; result: a list).
- Scalars: `less-equal`, `mod` (the result has the sign of the divisor, as
  the interpreter gives it; a target that has another remainder writes the
  correction), `floor` (integer result), `divide`.

The verifier checks, for a region with parameters: each parameter is defined
once and is visible in that region only; the count, order, type and
representation of the yields against the carried values and the results; the
initial value, the parameter and the next value of one carried value agree.

**Effects.** `at`, `length`, `build`, `replace-at` and `loop` are pure when
their regions are. No memory effect exists, by the choice above.

## Update in place

`replace-at` copies the list unless the emitter can update in place. It can
when the operand list has no other use after this operation and was made by
this invocation (a `build`, a `replace-at`, a loop parameter whose initial
value was made by this invocation). A list that is an input or a parameter
of the root is never updated in place: the host owns it. In `heatstep`, `L`
is made by `build`, carried by the loop, and its only use in each branch is
the `replace-at`, so every update is in place; `H` is only read.

This is a rule of the emitter, checked on use counts of the representation.
If it cannot prove the condition, it copies. A test counts allocations on
`heatstep`: one list per call.

## The first analysis for concurrency

With lists as values, two properties are decidable on the representation
without new facts. Change 6c adds `analyzeExecution(program)` in the core,
with tests; it is not exposed as a compile option.

- **Independent calls**: two calls of the compiled function can run at the
  same time. It holds when no operation is `effectful` or `unknown`, and no
  input is updated in place (guaranteed by the rule above). Captures are
  snapshots, so they cannot change between two calls.
- **Worker portable**: the code and what it reads can be sent to a worker.
  It holds when every function called is in the program, and every capture
  is a snapshot of a number.

The answer names the operation that makes a property fail. The third
property of the original proposal, parallel iterations of one loop, needs
the dependence between iterations: a loop whose only carried value is a list
written at the index of the iteration, and read nowhere in the body, is the
candidate. `heatstep` has that form. The analysis reports the candidate; it
proves nothing more in step 6.

## What a second target needs from this design

Checked against what `glsl-fragment.ts` admits: a GLSL policy refuses a list
without a compile-time length and a loop whose bounds are not constants, and
writes `at` with a clamp or its own absence rule. Nothing in the operations
above assumes closures, garbage collection or dynamic arrays; `build` and
`replace-at` on a fixed-length array are a loop and an element assignment.
No GLSL lowering is written in step 6.

## Measure at the end of step 6

The paired measure of step 4, with `heatneighbor` and `heatstep` on a 32×32
grid: values against the interpreter on the inputs of Tycho's showcase test
(uniform field, cooled corner, wall, clamp of the diffusivity), compilation
and execution time against the ordinary target, emitted bytes, allocations
per call of `heatstep`, and the line counts of the core and of the JavaScript
files.
