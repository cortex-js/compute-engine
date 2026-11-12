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

## Result: the copy before a loop and the rows in place

(2026-11-11, on `4e960b7d6`.) A loop that updated one element of a list per
pass copied the whole list on every pass when the carried list started from
a value that the program does not own (an input, a constant, a parameter of
a helper, a row read, a list that other code reads after the loop): the
initial value was not consumable by the loop, so the carried parameter was
not unique and every `replace-at` of the body copied. A row read (`at` with
a list result) is never unique, so `ReplaceAt(S, i, j, x)` also copied the
row on every pass, even for a local made from a literal. Two rules of
`structured-in-place.ts` remove both costs; the values do not change.

**The copy before a loop (`withOwnedCopies()`).** A new operation `copy`
(`IRCopy`, `levels` 1 or 2) makes a new array, and with two levels a new
array for each row; an absent row stays absent. It is unique for
`inPlaceUpdates()` (rule 1), and its use of the operand is a read (rule 3:
a new array). The lowering ends with `withOwnedCopies()`, before the
verifier: for each loop whose body updates a list (in the order of the
program, an outer loop before the loops of its body), and each carried
list, it analyzes the program with the initial value taken as consumable
(one level) or as owning its rows (two levels), and puts the copy before
the loop only when that analysis writes in place an update of the body (or
of a loop in it) that the current one copies; two levels only when they
write in place an update that one level does not. A copy is put in the
region of its loop. A loop in the body of another loop, of a build or of a
`routine` (the integrand of a numeric integral, which runs at each sample)
gets a copy of one level only: a copy of every
row on each outer pass can cost more than the row copies that it saves
(`S = replaceAt(S, 2, S[1])` in the outer pass would make the inner loop
copy the whole list once per outer pass). After the trials, a copy is
dropped when the analysis without it writes in place every update that the
analysis with it writes (an outer copy that an inner copy made useless).
The copy replaces the initial operand of the loop; nothing else of the
program changes. The answers of the analysis (`unique()`, `ownsRows()`,
`consumable()`, `consumableRows()`) are remembered per value and consumer,
and per set of assumptions of the loop checks, so each analysis is linear
in the size of the program: a chain of 40 `S = if c { replaceAt(S, 1, 1, …) }
else { S }` in a loop compiles in about 20 ms with about 6,700 computed
answers (without the memo, 18 such updates took 1.4 s and 10 in a loop did
not finish in 300 s). At most 32 loops are tried, each with one or two
analyses, and one more analysis per kept copy. The
emitter writes `list?.slice()` or `list?.map((_r) => _r?.slice())`, so an
absent row stays `undefined` at both levels (`[M[5], M[1]]`; the existing
compiler's `_SYS.ownedCopyLevels` throws there). The
verifier checks the type, the representation, the levels (2 only for a
list of lists) and the effect; the JavaScript policy has the operation, the
`bigint` policy does not (its lowering does not call the pass).

*Why the values are the same.* The copy reads the initial value where the
loop read it, before the first pass, and the first pass reads the same
elements in the copy. No code reads the copy but the loop, so every write
in place that the analysis of the final program proves is a write into the
copy or into an array made from it; the emitter analyzes the program that
it emits, not the hypothesis, so a copy that does not pay costs one copy
and no value. A loop that runs no pass gives the copy, a new array with
the elements of the initial value, where it gave the initial value: the
same values.

**The body of a `routine`.** Rule 2 admits between a definition and its
consumer only a branch of an `if`, an operand of an `and` or an `or`, and
the body of a `seeded`; a `routine` body (or any region kind that a later
change adds) is refused, so a list defined outside an integrand and updated
in it is copied at each sample. A list updated in place before the
integral is final when the integrand reads it: the integrand is a closure
that runs after the operations before the `routine`. A loop inside an
integrand that carries a list defined inside it may get a copy of one
level, in the body; loops in an integrand are not in the profile yet.

**The rows in place (rules 4 to 6 of `inPlaceUpdates()`).** The lowering
of `ReplaceAt(S, i, j, x)` is `r = at(S, i)`, `R2 = replace-at(r, j, x)`,
`R1 = replace-at(S, i, R2)`. R2 writes the row in place when the three are
in one region in this order, R1 reads S, the index value of the `at` and
R2 (which has no other use), S is consumable by R1 and owns its rows, and
every other use of S and of its rows that can run with R2 runs before it
and makes a number or a new array (`length`, an `at` of an element, a
function of lists with a number result, a `copy` of two levels).

*The invariant.* A value S of a list of lists owns its rows when each row
of S is an array that no other value of the program, no other slot of S,
no input, no constant and no caller holds. The definitions that give it: a
`copy` of two levels; a `build` whose element is consumable by the yield
of its body (a new row per pass); a `list` whose operands are each
consumable by it (`[R, R]` uses R twice, and fails); a `replace-at` of a
list that owns its rows, consumed with rule 6 at the update (the row of the
pair of rule 4 allowed), and of a row that it consumes; a call of a
function whose body yields such a value; an `if`, a conversion that keeps
the representation and a carried value of a loop, by the rule of 1. An
input, a parameter, a constant, a row read, a function of lists (`take`,
`reverse`, `join`, a rotation share the rows of their operand) and every
other value do not own their rows.

*Proof sketch.* By induction on the definitions, a value that owns its rows
holds each of its rows in one slot, and only the values that a use of it
made can also hold one: a row read, or a value made from a row read. Rule
6 limits those uses, for the uses that can run with R2, to uses that have
run before R2 and made numbers or new arrays, and requires the rows that
the program read to be used only before R2. So when R2 runs, the row r is
held by the slot i of S and by the value r, which R2 consumes; no code
reads r after R2 but R1, which puts r (now updated) back into the slot i,
in place (R1 is in place by rule 1 to 3, so no code reads the old S). The
code reads, at every position, the value of the program, where R2 makes a
new row. The result of R1 holds the same rows, each in one slot, and owns
its rows again; with the carried values of a loop, each pass starts with a
list that owns its rows. The emitter keeps the order of evaluation across
R2 (`mutatesInPlace()`).

*What stays a copy, and why.* A row read stored in a local and read after
the update, a row of an input (or of another list) written into S, a row
swap, a row written at another index than the one read
(`ReplaceAt(S, 2, ReplaceAt(S[1], 1, x))`), a list that `take`, `reverse`
or `join` made, a call or a lambda that reads the list in the pass, a
branch that writes an input to the carried list: the row (or the list) can
be held by another value, and the update copies. A straight-line update of
a list that the program does not own copies once, as before (no copy before
it would pay). A list carried through a `Which` is not in the profile.

**The guard of the execution analysis.** `hostArrays()`
(`structured-execution.ts`) now follows a row read of an array of the host,
and of a list that can hold a row of the host: a copy of one level, a
`list`, a `build`, a conversion, a function of lists or an update with such
an operand or element (`[M[1], M[2]]`, `[M[j] for j in 1..2]`, `take(M, 2)`,
`reverse(M)`, `join(M, M)`). The row is an array of the host, so an update
in place of it is reported.

**Tests.** `compile-javascript-structured-inplace2.test.ts`: 19 patterns
that write in place after one copy (or none; two with an absent row), and
11 that must copy (one with a row placed twice in each outer pass: one copy
of one level, before the outer loop), each
compared with the existing compiler (`Object.is` at every depth), with the
inputs compared with deep copies after the call, a second call, a write of
the host into every array of the result and a third call, and an assertion
on the emitted code (`_SYS.replaceAt(` absent or present); the structure of
the copy in the representation, the checks of the verifier, the guard of
the execution analysis on a wrong set of updates made by hand, and the cost
of a chain of 20 and 40 conditional row updates (computed answers, and
time under 5 s). Changed
existing tests: 6 (the `initialUnique` of two loop judgments, the alias
test of `hostArrays()`, which now reads the list in the pass so that the
lowering puts no copy, the copy of a loop whose initial value is read after
the loop, the helper `fill`, and the row of a literal, now in place).

**Measures** (one local run each, estimates; the median time per call
after a warm-up, `strict` mode; the existing compiler with its default
options; the time of a call depends on the calls made before it in the
process, by up to 10x for the shared runtime helpers).

| Program | Route before | Route after | Existing |
| --- | --- | --- | --- |
| Flat witness, 10,000 elements, 1,000 passes | 3,050 µs | 5.9 µs | 6.1 µs |
| Nested witness, 100×100, 1,000 passes | 104 µs | 70 µs | 77 µs |
| Nested witness, 10 rows of 10,000, 1,000 passes | 3,240 µs | 700 µs | 2,790 µs |
| `heatstep`, 32×32 (code unchanged) | 37.5 µs | 31.8 µs | 33 to 53 µs |
| `life`, 5×5 (code unchanged) | 1.3 µs | 1.3 µs | 0.6 µs |

The nested witness on 100×100 is bound by the code of each pass (two
`_SYS.at` row reads with the absence wrapper, `_SYS.atNumeric` and two
`_SYS.replaceAtInPlace` calls), not by the copies, which were two arrays of
100 elements per pass. The existing compiler copies on every pass there too:
the pass reads the row `S[1]` before the write (`_SYS.replaceAtPath`); it
copies once (`_SYS.ownedCopyLevels`) only when the pass reads no row of
the local. The compilation time of the four
programs is the same before and after (0.8 to 3.4 ms, medians of 40). The
code of `heatstep` and of `life` is unchanged: `heatstep` starts from a
`build`, `life` has no loop that updates a list.

**Fuzz runs** (`scripts/js-profile-fuzz.ts`, extended with
`genCarriedList()` and a write of the host into the value followed by a
new call on the profile): seeds 231 and 232 (10,000 programs each), 233
with `--random` and 234 with `--host` (5,000 each), and 235 with
`--size 100` (5,000): 0 profile failures (no `compile-error`), no input
written, no difference of value or shape but one in seed 232
(`u + Round(0)` at `u = -0` in the `complex` mode, `0` on the profile and
in the interpreter, `-0` on the existing compiler, which drops the term;
it is the same at `4e960b7d6` and does not involve a list). Of the carried
lists that the generator made, 229 programs of seed 235 and 126 of seed 231
compile on the profile; 124 and 83 of them have a copy (63 and 54 of two
levels), 75 and 58 write a row in place (after the review fixes: the memo,
one level in a repeated region, the absent row in a copy of two levels,
the rows of the host in `hostArrays()`).
