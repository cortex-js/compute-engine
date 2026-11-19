# `parallel for` and list locals in the IR compiler

**Status:** approved by the user on 2026-11-18: D1, all of sections 4.1 to
4.4; D2, the worker pool is a fast follow (section 6), not dropped.
**Issue:** CE-1462 (`issues/CE-1462.md`, `source: tycho`), the `buddhabrot`
showcase entry. Witness strength: `corpus`.
**Earlier designs:** `docs/plans/2026-11-07-ce1093-parallel-for.md` (the
construct and its rules, sections 2 to 4) and
`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md` (the worker pool).
Both were written for the compilers that 0.194.0 removed.

## 1. Problem

Tycho's `buddhabrot` prelude runs `const H_1 = step(H_0, 1200000)`. The
function `step(H: list<integer>, n: integer) -> list<integer>` copies its grid
(`let L = H`), runs `parallel for k in 1..n` over about 28 million inner loop
passes, and adds to cells of the grid with `L[c] += 1`. On 0.193.0 the step
compiled and ran in about 333 ms on one thread and 123 ms on 8 pool workers
(tycho-desk's measurement). On 0.194.0 it declines, and the interpreter does
not finish within Tycho's 30 s deadline, so the showcase entry does not open.

Tycho's minimum is that the step compiles; running it in order on one thread is
acceptable. The pool is a nice-to-have.

## 2. What declines today

Measured on `9d9931734a25a0981666c0992a88fae4e265cf5b` by compiling
`step(Hin, nin)` (`Hin: list<integer>`, `nin: integer`) with
`{ fallback: false }`, after `executeEpsil` of the prelude. Each line is the
first decline after the program was changed by hand to remove the one before:

1. `ParallelLoop(…)`: "the operator ParallelLoop is not supported by the
   compiler". (Changed: `parallel for` to `for`.)
2. `Assign(Tuple(a, b), Tuple(…))`: "a write that is not to a name", from
   `(a, b) := (a^2 - b^2 + p, 2*a*b + q)`. (Changed: two assignments through
   a temporary.)
3. `AddTo(At(L, c), 1)`: "the operator AddTo is not supported by the
   compiler". `AddTo(s, k)` of a scalar local declines too. (Changed:
   `L = replaceAt(L, c, L[c] + 1)`.)
4. `Assign(L, ReplaceAt(L, c, …))`: "a write to a constant … or to a list
   local". This is the documented rule of `docs/COMPILATION-MODEL.md`, "List
   updates": a block local cannot hold a list that the block changes.

The scalar part compiles. With every list write replaced by a sum into a
scalar `acc` (`step` returns `acc`), the program compiles on JavaScript, and
at `n = 2000`, `H = 0…0` it gives `1258854933`, the value of the same loop
written by hand in JavaScript. The interpreter gives `1258515027`: it does
not round `0.7548776662 * (r + k)` and its `fract` to f64, and the orbits are
chaotic, so a difference in the last bit of `p` or `q` moves the cells of an
orbit. That is the precision of the target (`docs/COMPILATION-MODEL.md`,
"Caveats of compiled code"), not a defect, and it decides the test of step 5.
GLSL declines `Hin` (a list of run-time length); the step is a JavaScript
program.

So `parallel for` is the smallest of four pieces. The largest is item 4: a
list local that the program changes, written in place.

## 3. The interpreter's values (probed)

Probed with `executeEpsil` on the same commit:

| Program | Value |
|---|---|
| `L = replaceAt(L, 5, 1)` with `L = [0, 0, 0]` | `out-of-range` error |
| `replaceAt(L, -1, 7)` | `[0, 0, 7]` (index from the end) |
| `replaceAt(L, 0, 7)` | `out-of-range` error |
| `replaceAt(L, 1.5, 7)` | `incompatible-type` error |
| `replaceAt(L, 1, 0.5)` of a list of integers | `[0.5, 0, 0]` (the element type widens) |
| `L[4] += 1`, `L[-1] += 1` | `out-of-range`; `[0, 0, 1]` |
| `let M = L; L[1] += 5; [L, M]` | `[[5, 0], [0, 0]]` (value semantics) |
| `f(A)` with `let L = H; L[1] += 1` in `f` | `A` is unchanged |
| `parallel for … { s = s + k }` | `6`, with the diagnostic `parallel-outer-write` |
| `parallel for … { s += k; t += s }` | `[6, 10]` (the read in order), with `parallel-accumulator-read` |
| `parallel for … { … break }` | `3`, with `parallel-exit` |

## 4. Design (JavaScript first)

### 4.1 A list local written in place

A `Block` local whose value is a list of reals, integers or booleans of rank 1
may be written with `Assign(L, ReplaceAt(L, i, v))` and `AddTo(At(L, i), e)`.
The code writes the element of the array in place. The sound and simple rules:

- **The local owns its array.** The declaration copies the value
  (`.slice()`) unless the value is a build that no other name holds (a
  `Comprehension`, a `Range`, a list literal that is not shared through
  `preambleOnce`). `let L = H` of an input copies, so the input is not
  changed (inputs are read-only, `docs/COMPILATION-MODEL.md`).
- **No alias.** Every occurrence of `L` in its scope is one of: `At(L, …)`,
  `Length(L)`, the target of a write above, or the result position of the
  block. Any other read (`M = L`, `f(L)`, `List(L)`, a capture in a function
  literal) declines the write. This keeps the value semantics of the
  interpreter's `alias` row without an analysis of aliases.
- **The lane does not change.** A written value whose lane is not a sub-lane
  of the element lane declines (`replaceAt(L, 1, 0.5)` of a list of
  integers), since the interpreter widens the list and the compiled array
  has one lane. The element type comes from the declared type of the local
  or of the value.
- **The index.** A negative index reads from the end, as in the interpreter.
  An index out of range, 0 or not an integer throws: a throw where the
  interpreter gives an error is within the caveats. A constant index out of a
  stated length declines.
- **Order.** `AddTo(At(L, i), e)` evaluates `i` once, before `e`, as the
  definition of `AddTo` says.
- GLSL and the interval mode decline a written list local.

This replaces the rule "List updates" of `docs/COMPILATION-MODEL.md` for
these forms; every other write to a list local still declines.

### 4.2 `AddTo` of a scalar local

`AddTo(s, e)` is `Assign(s, Add(s, e))` for a local `s`, with the lane rules
of `Assign`. On every target that compiles `Assign`.

### 4.3 Parallel assignment

`Assign(Tuple(a_1, …, a_n), Tuple(e_1, …, e_n))` of scalar locals evaluates
every `e_i`, then writes every `a_i`. Two equal names, a target that is not a
local, a right side that is not a `Tuple` literal of the same length, or a
lane change decline. On every target that compiles `Assign`.

### 4.4 `ParallelLoop` in order

`ParallelLoop(body, Element(x, coll))` compiles as `Loop(body, Element(x,
coll))`: the passes run in order, on one thread, as the interpreter runs
them, so the values are the interpreter's, also for the read of an
accumulator (section 3). It declines when:

- the body writes a variable declared outside the loop other than with
  `AddTo` (`parallel-outer-write`);
- the body has a `Break` or a `Continue` of the parallel loop itself
  (`parallel-exit`); those of an inner `Loop` are allowed;
- the program has a draw or a `WithRandomSeed` anywhere. Inside a frame the
  loop consumes one draw index and each pass draws from its own frame
  (`docs/RANDOMNESS-MODEL.md`, "Pass frames of a parallel loop"); compiled
  code has no pass frames. The buddhabrot step draws nothing.

A compiled program with no draw called by the interpreter inside a
`WithRandomSeed` frame does not consume the loop's draw index, so a later
draw of the interpreter in that frame differs. This is a `crafted` case: a
known-limitations line.

`runAsync()` keeps resolving to `run()`, and `willParallelize()` stays
`false`. GLSL may compile the same in-order loop for scalar accumulators,
but no corpus program needs it: GLSL declines in this version.

### 4.6 A list local reassigned whole

**Issue:** CE-1481 (user decision (a), 2026-11-18). **Witness** (`corpus`):
Tycho's `apollonian-gasket` prelude. `allCirclesLocal = fillGap(…,
allCirclesLocal)` in a `for` loop, where `fillGap` copies its list
(`let out = found`) and rebuilds it (`out = [...out, (c[1], c[2], c[3],
depth)]`, `out = fillGap(…, out)`); and `generations`, whose
`let out: list<tuple<number, number, number, integer>> = []` is rebuilt with
`out = [...take(out, i), c, ...drop(out, i)]`. 0.193.0 compiled them: its
JavaScript was a `let` of an array that each statement bound again.

The shape rule (`docs/COMPILATION-MODEL.md`, R1 to R6) allows it: the shape
of a value is its form (a number, a list, a point, …), and a list of a
run-time length is one shape whatever its length. A write that keeps the
rank, the lengths after the first and the tuple mark keeps the shape; only
the first length changes. The rules:

- **Which local.** A `Block` local whose value is a list, every write of
  which in its scope is `Assign(L, value)` (no `ReplaceAt(L, …)` value and
  no `AddTo`, which are the §4.1 forms, no parallel assignment, no write in
  a function literal). A list of reals, integers or booleans of rank 1, or
  a list of points of reals or integers. The type is the declared one
  (`list<tuple<number, number, number, integer>>`: a list of points of four
  reals) or the type of the value. A declared empty list `[]` is the empty
  list of that type.
- **An SSA value per write**, as for a scalar local. Nothing is written in
  place, so a read can share the array (`M = L`, `f(L)`): there is no
  alias rule. A `Loop` carries two values for the local, its length
  and the list of that length; an `if` whose arms leave two lengths gives
  the length of the arm taken as a result before the list (the rule of list
  arms, extended to lists of points for such a local); a random frame gives
  the length as a result too.
- **A written value of another type declines**: another rank, another
  inner length (`(1, 2, 3)` into a list of pairs), a tuple, a lane that is
  not a sub-lane. One exception, as for §4.1 (CE-1480): a real list written
  to a list of integers of no declared type puts the local on the real lane
  from its declaration, as the interpreter widens it. A declared
  `list<integer>` gives an `incompatible-type` error in the interpreter and
  declines.
- **Interaction with §4.1.** A local with both forms (`L = [...L, 2]` and
  `L[1] = 5`) declines, with the §4.1 cause. The two kinds never meet in one
  local: the in-place local stays one array, the whole local a value per
  write.
- **Declines.** An empty list of no stated type (`let L = []`: no lane), a
  point (a tuple local) written whole, a list of lists. GLSL (no run-time
  length), the interval mode and the `bigint` mode decline the local.

`Append` is not supported by the compiler, so `L = Append(L, v)` still
declines, as an operator.

## 5. Steps and definition of done

1. (Done, section 2.) The scalar part of `step` compiles.
2. 4.2 and 4.3, with tests against the interpreter.
3. 4.1, with tests of each row of section 3 and of the alias, copy and lane
   rules.
4. 4.4, with tests of the three declines.
5. The buddhabrot step compiles on JavaScript with `fallback: false`; its
   value equals that of the step written by hand in JavaScript at
   `n = 2000` (not the interpreter's, section 2), and the interpreter's on a
   non-chaotic variant (a body whose cells do not depend on an orbit); and
   `step(H_0, 1200000)` runs within a time to measure against the 333 ms of
   0.193.0.
6. Docs: `ir/README.md`, `docs/COMPILATION-MODEL.md` ("List updates",
   "`parallel for` and `runAsync()`"), `docs/MIGRATION-0.194.md` is not
   changed (it describes 0.194.0), CHANGELOG `[Unreleased]`, and the guide
   `13-guide-compile.md`.
7. The random-program and corpus checks of the brief, and a review by Codex
   and a Claude reviewer.

## 6. The fast follow: the worker pool

0.193.0 ran a `parallel for` on the worker pool (`runAsync()`, the CE-1163
spec), so its absence is a regression, and it follows sections 4.1 to 4.4
directly, under CE-1462. It needs the merge of the accumulators of the passes
(the CE-1163 spec, sections 3 to 5) on the IR's code; its design is a
section added to this note before its code.

## 6a. Not in this version

- Pass frames in compiled code (draws inside a `parallel for`).
- `ParallelComprehension`.
- A written list local on GLSL.

## 7. Decisions

- **D1** (user, 2026-11-18): all of sections 4.1 to 4.4.
- **D2** (user, 2026-11-18): the pool after 4.4, as a fast follow (section 6);
  0.193.0 had it, so it is a regression.
