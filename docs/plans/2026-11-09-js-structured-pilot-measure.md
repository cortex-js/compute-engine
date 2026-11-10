# The structured scalar emitter pilot, measured (step 4)

**Status: measured 2026-11-09 at `7939b5fac2207d8e69178caab0974d0bb36ea3b5`.
Documentation and a benchmark harness only; no compiler source changed.**

This is the measurement of step 4 of
[the JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md). It
compares the structured emitter of the scalar fragment target (steps 2 and
3) with the existing JavaScript compiler, and applies the decision rules of
step 4 to the numbers in the last section. The user decides with this
report; no work of step 5 starts before that decision.

## Result

- **Values.** All configurations give the same value on all 8,809 inputs of
  the 551 fixtures, with the sign of each zero.
- **Compilation.** The structured route (D) compiles faster than the
  ordinary target with the same options (B). For warm compilation of the
  fixtures, D/B is 0.30 to 0.68 and D/A is 0.25 to 0.56. In a fresh process,
  D/B is 0.41 to 0.61. Both are outside the calibration spread. On the
  corpus, D/B is about 0.78, biased toward D by up to the calibration ratio:
  this shows only that D is not slower.
- **Execution.** Through `run()` (44 to 77 ns a call) and through the bare
  body (6 to 14 ns a call), D/B is 0.97 to 1.03. That is inside the
  calibration spread, so it is not resolved.
- **Emitted code.** D writes 2.5 to 6.7 times the bytes of B per fixture,
  and 4.8 times on the corpus.
- **Source.** The pilot is 1,539 code lines. The existing handlers that it
  could replace are at most 907 lines, and about 190 lines by an estimate of
  the part that serves only what the pilot covers.
- **Corpus.** 546 corpus programs are inside the vocabulary. Their variety is
  low: 299 of them come from one row.

The harness has two complete timing runs (run 1 for the fixtures, run 2 for
the fixtures and the corpus). Each has a known defect of its design, which
the section "Calibration" states. The section "What the numbers cannot show"
lists what these measurements cannot show.

## What was measured

### Configurations

All four configurations compile the same boxed expression on the same engine,
in one process. The ordinary target is called as
`new JavaScriptTarget().compile(expr, options)`, which is the method that the
fragment target extends. The public `compile()` adds its own option checks
around that call; the harness verifies that both give the same code for every
fixture (551 of 551).

| Name | Compiler | Options |
| --- | --- | --- |
| A | `JavaScriptTarget` | default (`fallback: false`) |
| A2 | the same as A, a second configuration | default; the calibration |
| B | `JavaScriptTarget` | `cse: false, constantFold: false` |
| C | `new ScalarFragmentJavaScriptTarget()`: the annotation of step 1, then the existing emitter | as B |
| D | `new ScalarFragmentJavaScriptTarget('structured')`: annotation, lowering, verifier and structured emitter | as B |
| Dp | D with an `onPhase` observer | as B |

C refuses `Multiply`, `Less`, `Equal`, `And`, `Or`, `Min` and `Max`, so it
applies only to the programs without these operators. Dp gives the six phases
of D; it reads the clock twelve times per compilation, so its total is not
used as the total of D.

### Fixtures

| Fixture | Operations | C applies | Source |
| --- | ---: | --- | --- |
| `heatwall` | 6 | no (`And`) | step 3 test fixture, from Tycho's heat showcase |
| `heatcell` | 8 | no (`Min`) | step 3 test fixture; a `Function` literal that calls the helper `heatwall` |
| `complex-if`, `If(C, x, z) + y` | 2 | yes | step 3 test fixture, the complex fixture of the pilot design |
| `deep-full` | 198 | no | generated: Add, Negate, Multiply, Min, Max, If, Less, Equal, And, Or |
| `deep-add-if` | 200 | yes | generated: Add, Negate, If on a boolean input |
| corpus | 546 programs, 1 to 19 operations | 433 of 546 | Tycho codegen audit records, below |

The operation counts are the function nodes of the canonical expression,
without `Function`, `Block`, `Declare` and `Typed`. The two deep trees come
from a seeded generator in the harness; a child never has the operator of its
parent, so that the canonical form does not flatten them.

**The corpus.** The repository has no list of the scalar expressions of a real
corpus: the typed records of
[the profile audit](2026-11-08-js-profile-audit/evidence/) keep the operator
counts of each record but not its tree, and the fixture of
`benchmarks/tycho-document-open/` holds 255 trees inside the vocabulary, each
a literal, a negated literal or a bare symbol. The Tycho codegen audit
artifacts keep, for each compilation, the LaTeX serialization of the compiled
expression (`input`) and the type of each free symbol. `MODE=extract` reads
two of them:

| Artifact (`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/`) | CE | Tycho | Records | SHA-256 |
| --- | --- | --- | ---: | --- |
| `ce-0.184.0.json` (CORE) | 0.184.0 | `a40372202` | 1,101 | `4d15c703…bddfaed` |
| `ce-0.185.0-all.json` (ALL) | 0.185.0 | `e7acb26e0` | 17,421 | `1323eda2…cb008` |

It parses each distinct `input` of a successful JavaScript record on a fresh
engine with the recorded types, and compiles it with D. Of 8,950 distinct
inputs, 608 compile and 8,342 decline (7,673 an operator outside the
vocabulary, 346 an arity, 274 a free symbol without a scalar type, for example
`nan | real | signed_infinity`, 23 an invalid expression, 21 a comparison
that reads no symbol, 5 a `Less` with three operands). Of the
608, 41 are literals, 7 bare symbols and 14 closed expressions; **546 programs
have at least one operation and one free symbol**, after deduplication by
canonical MathJSON and the types of the symbols they read. They are written to
`benchmarks/js-structured-pilot-corpus.json` with their provenance.

The corpus is larger than the 20 programs that the plan asks for, but it is
not varied: the 546 programs come from 133 rows of 77 documents, one document
(`rmoigzwr8h`, the row `y=L(300)`) gives 299 programs of the form
`y + c`, and the median program has 2 operations. The operators read are
`Add` 521 times, `Multiply` 75, `Less` 71, `Negate` 46, `Max` 21, `And` 19,
`Equal` 6, `Or` 2 and `Min` 1 (counts of the stored MathJSON). No corpus
program calls a helper or has an `If`. The tables below give each corpus
measure for all 546 programs and for one program per row (133). A program
is reconstructed from its LaTeX, so it is the compiled expression as the
serializer wrote it, not necessarily the identical tree.

**Inputs.** The named fixtures use the inputs of the step 3 test. Each deep
tree and each corpus program has 16 inputs from a seeded generator, within the
declared range of each symbol (at most [-10, 10]).

### Measures

- **Cold compilation, fresh engine**: the first compilation of the expression
  on a new engine, in a process where the modules are loaded and other
  fixtures were compiled before. Engine construction and boxing are not timed.
  9 trials per configuration (3 for each corpus program).
- **Cold compilation, fresh process**: the first compilation in a new Node
  process (`COLD_PROCESS=5`: 5 processes per configuration and fixture, not
  for the corpus). The module loading is not timed.
- **Warm compilation**: 5 compilations to warm up, then 9 rounds of one batch
  of 10 compilations per configuration, each with a new target, on the same
  boxed expression.
- **Warm execution of `run()`**: the compiled `run` called on every input in a
  loop that adds each result to a sum (a complex value adds `re + im`, `true`
  adds 1), and the sum is stored in a module variable, so that the JIT cannot
  remove the calls. The number of passes over the inputs is set so that a
  batch takes about 2 ms; 3 batches to warm up, then 9 rounds. Each
  configuration has its own loop function, made with `new Function`, so that
  each has its own call site. `floor` is the same loop around `() => 0`.
- **Warm execution of the body (`rawCall`)**: the same loop around
  `run.rawCall`, the compiled body without the entry check, the precision
  frame and the normalization of `run()`. It exists only when the compiled
  function reads a vars object; `heatcell`, a `Function` literal, has no such
  measure. A control checks that `rawCall` gives the value of `run()` on every
  input.
- **Emitted bytes**: UTF-8 length of `result.code` and of `result.preamble`.

The two runs that this report uses ran an earlier version of the harness,
which differs from the committed one in two ways (section "Calibration"):
the configurations of each round ran in an order that rotated by one
position from round to round, and run 2 ran one full garbage collection per
round instead of one per batch. Each table gives the median of the rounds and, in parentheses, the range
(smallest to largest). A ratio X/B is computed in each round from the two
batches of that round, and the table gives the median and the range of those
ratios.

### Machine, runs and commands

Apple M5 Max, 18 cores, Node v26.13.0, source loaded through `tsx`, commit
`7939b5fac2207d8e69178caab0974d0bb36ea3b5` with no change under `src/`. Both
runs held the box lock. No Jest process ran during either run. During both
runs, two Chrome renderer processes used about 100% of one core each, and a
Tycho `esbuild` used 20% to 30% (CPU samples every 15 s). These processes
could not be stopped. They load other cores than the single-threaded harness,
and every configuration ran under the same load.

| Run | Harness design | Content | Start load (1/5/15 min) | Duration |
| --- | --- | --- | --- | --- |
| 1 | rotating order, one GC per batch, all 546 programs held in memory | fixtures complete (with 5 fresh processes per configuration); the corpus was stopped by the 40-minute timeout | 3.8 / 4.1 / 4.3 | 40 min (timeout) |
| 2 | rotating order, one GC per round, one program in memory at a time | fixtures and the 546 corpus programs, complete | 3.9 / 5.9 / 7.0 | 33 min |

Both runs used the command

```sh
COLD_PROCESS=5 node --expose-gc --import tsx benchmarks/js-structured-pilot.ts
```

on the harness version of their time. A third design (seeded random order) is
in the committed harness, but **no complete run of it exists**: its two runs
were stopped so that the box lock went back to the other sessions. The
committed harness has two modes:

```sh
# Default, a few minutes (an estimate: about 3 minutes from the times per
# program of run 2): the fixtures and a sample of 40 corpus programs (the
# first program of each of the first 40 rows), one GC per round.
node --expose-gc --import tsx benchmarks/js-structured-pilot.ts

# The full corpus, with fresh processes and one GC per batch: more than an
# hour.
CORPUS=all COLD_PROCESS=5 GC=batch node --expose-gc --import tsx benchmarks/js-structured-pilot.ts

# The value agreement of all 546 programs, no timing (about 1 minute).
CORPUS=all MODE=check node --import tsx benchmarks/js-structured-pilot.ts
```

The raw outputs of runs 1 and 2 (one JSON object per line, with every round)
and the process snapshots taken before and after each run are in
[`2026-11-09-js-structured-pilot-measure/`](2026-11-09-js-structured-pilot-measure/).
The tables below copy their numbers.

## Calibration

A2 is the same configuration as A, compiled and timed as a second
configuration. In each round the harness computes A2/A from the two batches
of that round. A difference X/B counts as **resolved** only when the median
of the per-round ratios X/B lies outside the per-round range of A2/A for the
same fixture and measure. Otherwise it is **not resolved**.

| Measure | Run 1: A2/A median (range), per fixture | Run 2: A2/A median (range), per fixture |
| --- | --- | --- |
| Cold, fresh engine | 0.99 to 1.06 (0.70 to 1.26) | 0.81 to 0.97 (0.57 to 1.37) |
| Cold, fresh process | 0.98 to 1.06 (0.89 to 1.21) | 0.96 to 1.00 (0.87 to 1.45) |
| Warm compilation | 0.95 to 1.05 (0.69 to 1.56) | 0.85 to 0.97 (0.70 to 1.29) |
| Warm execution, `run()` | 0.99 to 1.00 (0.60 to 1.22) | 0.99 to 1.07 (0.87 to 1.13) |
| Warm execution, body | not measured | 0.98 to 1.02 (0.94 to 1.10) |

**The order bias of run 2.** In both runs, the configurations of a round ran
in the order A, A2, B, (C,) D, Dp, rotated by one position in each round. A2
therefore came directly after A in most rounds, and D directly after B. With
one full garbage collection per round (run 2), a batch that comes directly
after a batch of the same compiler ran faster. As a result, A2/A for warm
compilation is **0.83 on the corpus** (median of the per-program medians;
10th to 90th percentile 0.78 to 0.85), and **0.85 to 0.97 on the fixtures**.
In run 1, with one collection before each batch, the medians are 0.95 to
1.05. The same bias favours D over B in run 2, because D also follows B.
The size of that effect on D is not known; it is at most about the
calibration ratio (about 17%). The fixture ratios D/B of the two runs agree
within 0.07 (table below), so the bias does not change the fixture result.
The corpus ratios of run 2 have no unbiased counterpart.

The committed harness puts the configurations in a new random order in each
round (fixed seed). That design has no complete run.

## Value agreement

Before any timing, `MODE=check` (and the first part of each timing run) calls
A, A2, B, C (where it applies) and D on every input of every fixture and
compares each value with that of A: numbers by `Object.is` (NaN equals NaN, 0
differs from -0), complex values by part, booleans by `===`. **Over 551
fixtures and 8,809 inputs, no value differs, and no value differs by the sign
of a zero.** The step 3 tests compare the same fixtures with the interpreter;
this harness does not.

## Warm compilation (ms per compilation)

Run 1 (one collection per batch):

| Fixture | Ops | A | B | C | D | A2/A | D/B | D/A | C/B |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 6 | 0.437 (0.392–0.526) | 0.361 (0.300–0.430) | — | 0.177 (0.159–0.248) | 1.04 (0.79–1.51) | **0.49** (0.40–0.80) | 0.40 (0.31–0.59) | — |
| heatcell | 8 | 1.32 (1.22–1.70) | 1.03 (1.01–1.30) | — | 0.331 (0.321–0.350) | 0.95 (0.89–1.06) | **0.32** (0.27–0.32) | 0.25 (0.20–0.27) | — |
| complex-if | 2 | 0.250 (0.228–0.363) | 0.197 (0.182–0.281) | 0.230 (0.206–0.343) | 0.141 (0.129–0.636) | 1.05 (0.69–1.56) | **0.68** (0.49–3.23) | 0.56 (0.46–1.75) | 1.08 (0.82–1.79) |
| deep-full | 198 | 4.87 (4.76–5.71) | 3.99 (3.81–4.81) | — | 1.98 (1.96–2.26) | 1.00 (0.95–1.02) | **0.50** (0.47–0.52) | 0.40 (0.39–0.43) | — |
| deep-add-if | 200 | 4.74 (4.31–4.95) | 3.56 (3.29–4.38) | 4.13 (3.67–4.25) | 2.11 (1.99–2.38) | 1.00 (0.97–1.13) | **0.61** (0.52–0.64) | 0.46 (0.43–0.50) | 1.14 (0.96–1.22) |

Run 2 (one collection per round; A2/A biased, see "Calibration"):

| Fixture | A | B | C | D | A2/A | D/B | D/A | C/B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 0.343 (0.308–0.414) | 0.265 (0.249–0.355) | — | 0.139 (0.123–0.175) | 0.92 (0.81–1.12) | **0.51** (0.39–0.62) | 0.40 (0.35–0.50) | — |
| heatcell | 1.16 (1.13–1.23) | 0.968 (0.865–1.07) | — | 0.282 (0.272–0.351) | 0.93 (0.83–1.29) | **0.30** (0.28–0.39) | 0.25 (0.23–0.31) | — |
| complex-if | 0.204 (0.176–0.283) | 0.152 (0.137–0.214) | 0.172 (0.161–0.231) | 0.0986 (0.0917–0.121) | 0.85 (0.70–1.25) | **0.65** (0.47–0.86) | 0.51 (0.38–0.59) | 1.19 (0.86–1.52) |
| deep-full | 4.70 (4.36–5.53) | 3.65 (3.57–3.91) | — | 1.73 (1.55–1.84) | 0.95 (0.91–1.08) | **0.46** (0.43–0.51) | 0.38 (0.33–0.40) | — |
| deep-add-if | 3.95 (3.58–4.55) | 3.00 (2.91–3.13) | 3.31 (3.20–3.63) | 1.64 (1.53–1.74) | 0.97 (0.90–1.13) | **0.54** (0.50–0.60) | 0.43 (0.36–0.45) | 1.10 (1.06–1.25) |

In both runs, the median D/B of every fixture lies below the smallest
per-round A2/A of that fixture: the difference is resolved. On the 200-operation
trees, D costs about 10 µs per operation and B about 18 to 20 µs (run 1).
The annotation alone (C/B) costs 8% to 19% more than B. The corpus result is
in its own section below.

## The six phases of D, warm (ms per compilation, run 1)

| Fixture | Preparation | Annotation | Lowering | Verification | Emission | Assembly | Sum (Dp) | D |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 0.028 | 0.037 | 0.009 | 0.023 | 0.009 | 0.073 | 0.189 (0.160–0.255) | 0.177 (0.159–0.248) |
| heatcell | 0.036 | 0.104 | 0.020 | 0.045 | 0.017 | 0.104 | 0.331 (0.301–0.469) | 0.331 (0.321–0.350) |
| complex-if | 0.019 | 0.026 | 0.006 | 0.015 | 0.006 | 0.067 | 0.145 (0.126–0.229) | 0.141 (0.129–0.636) |
| deep-full | 0.348 | 0.463 | 0.140 | 0.450 | 0.161 | 0.440 | 1.99 (1.96–2.18) | 1.98 (1.96–2.26) |
| deep-add-if | 0.306 | 0.387 | 0.141 | 0.562 | 0.219 | 0.480 | 2.12 (1.97–2.36) | 2.11 (1.99–2.38) |

Each phase is the median of 9 rounds; the per-round ranges are in the raw
output. Lowering, verification and emission together take 0.75 ms
(deep-full) to 0.92 ms (deep-add-if): 38% to 43% of D. On the deep trees,
verification costs as much as the annotation or more. On the small fixtures, assembly (the existing
code around the body: entry plan, references, the runner) is the largest
phase. The phases of run 2 have the same order of size.

## Cold compilation (ms, first compilation)

Fresh process, 5 processes per configuration, run 1:

| Fixture | A | B | C | D | A2/A | D/B | D/A | C/B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 11.0 (9.7–11.2) | 9.62 (8.99–10.0) | — | 5.23 (4.64–5.48) | 1.06 (0.89–1.21) | **0.55** (0.48–0.58) | 0.48 (0.43–0.50) | — |
| heatcell | 20.3 (18.7–21.0) | 18.3 (16.4–19.2) | — | 7.54 (7.48–8.89) | 0.98 (0.95–1.02) | **0.44** (0.39–0.49) | 0.39 (0.36–0.42) | — |
| complex-if | 8.76 (8.67–11.1) | 8.51 (7.47–8.54) | 9.26 (8.28–9.65) | 4.68 (4.49–5.31) | 0.99 (0.91–1.15) | **0.61** (0.53–0.67) | 0.52 (0.48–0.53) | 1.10 (1.09–1.16) |
| deep-full | 23.6 (23.1–26.2) | 19.8 (19.1–20.8) | — | 8.71 (8.59–8.89) | 1.00 (0.99–1.08) | **0.44** (0.42–0.46) | 0.37 (0.33–0.38) | — |
| deep-add-if | 20.2 (20.0–21.5) | 16.9 (15.9–19.9) | 18.5 (17.3–19.6) | 9.22 (8.89–9.32) | 1.03 (1.00–1.14) | **0.53** (0.45–0.58) | 0.45 (0.41–0.46) | 1.09 (0.98–1.16) |

Run 2 gives D/B 0.41 to 0.60 in fresh processes, with A2/A 0.96 to 1.00.
The first compilation in a fresh process costs 5 to 30 times a warm one: it
includes the first execution of the compiler code.

Fresh engine in a loaded process, 9 trials, run 1:

| Fixture | A | B | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- |
| heatwall | 1.07 (0.90–1.38) | 0.905 (0.738–1.05) | 0.639 (0.529–0.782) | 1.00 (0.70–1.24) | 0.72 (0.59–0.92) | 0.61 (0.38–0.69) |
| heatcell | 2.81 (2.46–3.45) | 2.47 (2.29–2.66) | 1.38 (1.25–1.59) | 0.99 (0.85–1.15) | **0.56** (0.53–0.60) | 0.49 (0.45–0.54) |
| complex-if | 0.761 (0.709–0.998) | 0.618 (0.570–0.744) | 0.501 (0.474–0.769) | 1.06 (0.82–1.14) | 0.81 (0.67–1.24) | 0.66 (0.52–0.91) |
| deep-full | 7.83 (7.06–8.31) | 6.45 (5.80–7.68) | 2.71 (2.63–3.92) | 1.03 (0.92–1.21) | **0.42** (0.36–0.61) | 0.35 (0.33–0.51) |
| deep-add-if | 6.30 (5.67–7.56) | 5.09 (4.36–6.98) | 2.64 (2.58–3.21) | 1.00 (0.99–1.26) | **0.51** (0.42–0.60) | 0.42 (0.37–0.51) |

On a fresh engine, the D/B median of heatwall lies inside the A2/A range in
both runs, and that of complex-if lies just outside it in run 1 (0.81
against 0.82) and inside it in run 2 (0.79 against 0.68 to 1.37): these two
are not resolved on this measure. The other three are resolved.

## Warm execution (ns per call)

Through `run()`, run 1:

| Fixture | A | B | C | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 44.8 (43.2–74.2) | 43.3 (42.9–47.9) | — | 43.5 (42.6–44.1) | 1.00 (0.60–1.22) | 1.00 (0.90–1.03) | 0.98 (0.58–1.02) |
| heatcell | 53.4 (52.7–53.8) | 53.4 (52.6–65.6) | — | 52.5 (51.7–53.3) | 1.00 (0.99–1.01) | 0.98 (0.80–1.01) | 0.99 (0.97–1.00) |
| complex-if | 48.4 (47.6–49.8) | 48.2 (47.5–59.8) | 48.2 (47.7–61.1) | 47.8 (47.4–48.4) | 1.00 (0.97–1.04) | 1.00 (0.79–1.02) | 0.99 (0.97–1.00) |
| deep-full | 76.9 (74.9–89.8) | 75.2 (74.0–90.4) | — | 75.2 (73.0–87.4) | 0.99 (0.89–1.06) | 1.00 (0.97–1.01) | 1.00 (0.83–1.13) |
| deep-add-if | 67.0 (66.0–69.6) | 67.4 (65.8–80.7) | 67.3 (64.9–76.2) | 68.2 (66.0–75.2) | 0.99 (0.99–1.03) | 1.00 (0.93–1.03) | 1.01 (0.97–1.12) |

Run 2 gives D/B 0.99 to 1.03 through `run()`. In both runs, the D/B median
lies inside the A2/A range, with one exception: the heatcell D/B median
(0.98) lies just below its narrow A2/A range (0.99 to 1.01) in run 1, and is
1.03 in run 2. The two runs do not agree on its direction. Execution is
**not resolved**.

The compiled body without `run()` (`rawCall`), run 2:

| Fixture | A | B | C | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- | --- |
| heatwall | 6.36 (6.32–6.40) | 6.36 (6.32–6.45) | — | 6.32 (6.27–6.50) | 1.00 (0.99–1.01) | 0.99 (0.98–1.02) | 1.00 (0.99–1.02) |
| complex-if | 7.76 (7.42–8.06) | 7.73 (7.50–7.77) | 7.70 (7.48–7.75) | 7.60 (7.37–7.78) | 0.99 (0.95–1.02) | 0.98 (0.98–1.01) | 0.98 (0.94–1.00) |
| deep-full | 13.4 (12.4–14.4) | 13.8 (12.8–15.1) | — | 13.3 (12.2–14.4) | 1.02 (0.95–1.10) | 0.97 (0.86–1.12) | 0.97 (0.91–1.13) |
| deep-add-if | 9.54 (9.16–9.96) | 9.25 (9.11–10.3) | 9.41 (9.13–10.0) | 9.40 (9.19–9.97) | 1.00 (0.94–1.06) | 1.02 (0.90–1.07) | 0.99 (0.92–1.05) |

The loop around a function that returns 0 costs about 3 ns per call (corpus
`floor`). In run 2, `run()` adds 38 to 58 ns to the body: its entry check,
the precision frame and the normalization of the result. The body of a 200-operation
tree runs in 9 to 14 ns. D writes each value to a `const` and each `If`
as a statement inside an arrow function. In these measurements V8 gives this
code the speed of the expression that B writes, within the resolution of the
harness. `heatcell` has no body measure: its compiled function is a `Function`
literal, which has no `rawCall`.

## The corpus (run 2)

546 programs; the order bias of run 2 applies to every ratio here. "Per
program" is the distribution of the per-program median ratios (median, 10th
and 90th percentiles). "One per row" keeps the first program of each of the
133 rows.

| Measure | A2/A per program | D/B per program | D/B one per row | D/A per program |
| --- | --- | --- | --- | --- |
| Cold, fresh engine | 0.84 (0.69–1.01) | 0.75 (0.64–0.91) | 0.80 (0.68–0.91) | 0.67 (0.52–0.79) |
| Warm compilation | 0.83 (0.78–0.85) | 0.82 (0.70–0.83) | 0.75 (0.59–0.84) | 0.67 (0.55–0.69) |
| Warm execution, `run()` | 1.01 (1.00–1.09) | 1.00 (0.99–1.09) | 1.04 (0.99–1.10) | 1.00 (0.98–1.09) |
| Warm execution, body | 1.00 (0.99–1.01) | 1.00 (0.99–1.01) | 1.00 (0.99–1.01) | 1.00 (0.99–1.01) |

Totals over the 546 programs, per round (median and range of 9 rounds):

| Measure | A | B | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- |
| Warm compilation, ms | 65.3 (57.1–88.9) | 50.5 (48.4–74.8) | 39.4 (36.2–51.3) | 0.82 (0.64–1.53) | 0.78 (0.53–1.06) | 0.65 (0.44–0.73) |
| Execution `run()`, ns summed | 18,500 (18,100–20,300) | 18,500 (18,100–20,400) | 18,600 (18,100–20,200) | 1.03 (0.89–1.12) | 1.01 (0.94–1.09) | 1.01 (0.90–1.12) |
| Execution body, ns summed | 3,730 (3,710–3,950) | 3,730 (3,720–3,790) | 3,730 (3,720–3,800) | 1.00 (0.96–1.02) | 1.00 (0.99–1.01) | 1.00 (0.96–1.01) |

**Warm compilation on the corpus: D/B is about 0.78, biased toward D by up
to the calibration ratio (0.83). It is not resolved beyond "D is not
slower".** On the 433 programs that C admits, C/B is 1.18 (1.16 to 1.19);
C ran directly after B in the rotation, so the bias, if anything, favours C.
Execution, through `run()` and of the body, is not resolved. The sum of the
per-program median phases of D is 34.5 ms: preparation 4.9, annotation 6.2,
lowering 0.9, verification 3.3, emission 0.9 and assembly 18.3. On these small
programs, assembly is more than half of D.

## Emitted bytes

UTF-8 bytes of `result.code`. No configuration writes a preamble for these
fixtures: the helper of `heatcell` is defined inside the code of its
`Function` literal on both routes.

| Fixture | A | B | C | D | D/B |
| --- | ---: | ---: | ---: | ---: | ---: |
| heatwall | 62 | 62 | — | 322 | 5.2 |
| heatcell | 262 | 262 | — | 747 | 2.9 |
| complex-if | 113 | 113 | 113 | 288 | 2.5 |
| deep-full | 2,062 | 2,032 | — | 11,059 | 5.4 |
| deep-add-if | 1,743 | 1,743 | 1,743 | 11,719 | 6.7 |
| corpus, 546 programs | 10,847 | 10,851 | — | 51,845 | 4.8 |
| corpus, the 433 programs that C admits | — | 7,853 | 7,853 | 34,991 | 4.5 |

This is a cost of D. D binds each value to a `const`, reads each input once
per read into a `const`, and writes `And`, `Or` and `If` as statements in an
arrow function that is called at once. The code of `heatwall`:

```js
// B (62 bytes)
0.5 < _.obstacle && ((_.c) === (16)) && (_.r < 13 || 18 < _.r)

// D (322 bytes)
(() => { const _tv1 = _.obstacle; const _tv2 = 0.5 < _tv1; let _tv3 = _tv2;
  if (_tv3) { const _tv4 = _.c; const _tv5 = _tv4 === 16; _tv3 = _tv5;
  if (_tv3) { const _tv6 = _.r; const _tv7 = _tv6 < 13; let _tv8 = _tv7;
  if (!_tv8) { const _tv9 = _.r; const _tv10 = 18 < _tv9; _tv8 = _tv10; }
  _tv3 = _tv8; } } return _tv3; })()
```

(The D code is one line; it is broken here for reading.) The code size makes
no measured difference to warm execution (section above). Its cost in parse
time, in memory, and for a host that stores or sends the code was not
measured.

## Line counts

By the rule of [the measurement document](2026-11-09-js-emitter-measurement-gate.md):
lines that are not blank and do not begin with `//`, `/*` or `*`, at
`7939b5fac` (`MODE=lines`).

**(i) The pilot: 1,539 lines.**

| Part | Lines |
| --- | ---: |
| `javascript-structured-ir.ts` (representation, verifier) | 417 |
| `javascript-structured-lower.ts` (lowering) | 436 |
| `javascript-structured-emit.ts` (emitter) | 187 |
| `javascript-fragment-target.ts`, lines last changed by `4c4f1c163` or `7939b5fac` | 411 |
| `javascript-target.ts`, lines last changed by `4c4f1c163` or `7939b5fac` | 88 |
| **Total** | **1,539** |

The last two rows use `git blame` at `7939b5fac`. A line that one of the two
commits changed but did not add also counts. The annotation of step 1
(`0cc601329`) is not counted: it stays if the structured emitter is deleted.

**(ii) The existing handlers for the same operators: at most 907 lines, and
about 190 by estimate.** These are AST spans, without the leading
documentation comment. Every function here also serves other cases:
collections, complex products, constant folding, strings and other targets.
So the total is an upper bound of what the pilot could replace. The
"estimate" column is my reading of each function: the lines that serve only
what the pilot covers (real and complex `Add` and `Negate`; real `Multiply`,
`Less`, `Equal`, `Min`, `Max`; `And`, `Or`; `If` with a scalar condition; a
call of a helper with scalar arguments). It is an estimate, not a count.

| Handler | Lines (span) | Estimate (scalar, pilot vocabulary) |
| --- | ---: | ---: |
| `JAVASCRIPT_OPERATORS` entries `Add`, `Negate`, `Multiply`, `Less`, `And`, `Or` (`javascript-target.ts` 1150–1163) | 6 | 6 |
| `JAVASCRIPT_FUNCTIONS.Add` (4654–4746): real sum and complex sum | 60 | 55 |
| `JAVASCRIPT_FUNCTIONS.Negate` (8976–8993) | 16 | 16 |
| `JAVASCRIPT_FUNCTIONS.Multiply` (8994–9184): only the real branch is in the pilot | 123 | 12 |
| `JAVASCRIPT_FUNCTIONS.Min`, `Max` (one line each) | 2 | 2 |
| `JAVASCRIPT_FUNCTIONS.Equal` | 2 | 2 |
| `JAVASCRIPT_FUNCTIONS.Less`, `And`, `Or`: reached only when an operand may be a collection | 6 | 0 |
| `compileJSEquality` (1513–1724): string, tuple and collection gates, chained comparisons | 103 | 12 |
| `compileExtremum` (16293–16546): mostly lists and folds | 137 | 5 |
| `compileExprOperator` (`compile-operators.ts` 292–935): all infix operators of all targets | 302 | 30 |
| `compileExprIf` (`compile-conditionals.ts` 59–133): also selections over collections | 55 | 30 |
| `guardCondition` (`compile-conditions.ts` 596–606) | 11 | 6 |
| `emitUserFunctionCall` (`compile-user-calls.ts` 190–303): also calls mapped over lists | 84 | 15 |
| **Total** | **907** | **about 190** |

The list follows the task brief. It leaves out the code that writes the
definition of a helper (`userFunctionsPreamble()` and what it calls), which
the pilot also replaces for a helper with scalar parameters. That code is not
counted in either column.

## Dependencies of the structured route on the existing compiler

`MODE=deps` compiles the five fixtures under V8 precise coverage (function
granularity) and lists the functions of `src/compute-engine/compilation/`
that run. Run on D, it finds 243 functions:

| Group | Functions |
| --- | ---: |
| The pilot files (`javascript-structured-ir.ts`, `-lower.ts`, `-emit.ts`) | 40 |
| The route and the annotation of step 1 (`javascript-fragment-target.ts` 25, `fragment.ts` 17, `javascript-fragment-facts.ts` 3) | 45 |
| The existing compiler, 36 files | 158 |

Run on B, the same count gives 623 functions. The 158 functions of the
existing compiler are preparation and assembly. Preparation is
`JavaScriptTarget.prepareCompilation()`: the fixed-width unroll
(`fixed-width-unroll.ts`, 19 functions), partial application, the shadowing
and point-inlining rewrites, and the declaration checks. Assembly is
`compileToTarget()` and the result: entry plans, references and
`freeSymbolTypes`, the runner (`ComputeEngineFunction`), the naming context
and the runtime helpers. The largest groups are `javascript-target.ts` (28
functions, one of them new: `emitDelegatedBody`), `fixed-width-unroll.ts`
(19), `compile-references.ts` (9), `compile-declarations.ts` (7),
`javascript-runtime.ts` (7) and `compiler-naming.ts` (6).

One reader of the existing emitter still runs on the structured route:
`isComplexValued()` (`compiler-core.ts`). It runs after the emission, in
assembly: from `varsEntryPlan()` (`javascript-target.ts`) and from
`defaultLoweredSymbolType()` in `freeSymbolTypes()` (`compile-references.ts`),
which builds the reported types of the free symbols. The step 3 test makes
this reader throw from preparation to the end of emission, so it does not
cover assembly. This is not a use of the existing emitter: no code that it
writes reaches the result. It is a dependency that a removal of
`isComplexValued()` would have to replace. The coverage also shows that the
functions of `compile-conditions.ts` (5), `compile-user-calls.ts` (3) and
`compile-cse.ts` (3) that run on D are type and shape tests and the setup
of a CSE session, not emitters (the phase in which each runs was not
traced): `booleanClaim`,
`isProvablyCollectionValued*`, `containsEarlyReturn`,
`expressionParameterReadAt`, `isExpressionParameterType`,
`pointOrPointListUnion`, `openCseSession` and `assignedNamesIn`.

## Counts of the step 3 tests

`test/compute-engine/compile-javascript-structured-emit.test.ts` ("the count
of accepted programs, declines and failures") asserts these counts: **27
programs accepted** (its 27 fixtures), **14 intended declines** (a head
outside the vocabulary, `Divide`, a list, a free symbol with no scalar type,
`cse` not `false` twice, `constantFold` not `false`, and the options
`broadcast`, `functions`, `operators`, `vars`, `preamble`, `imports` and the
`bigint` mode), **0 unexpected declines** and **0 emitter failures**. Jest was
not run for this report; the counts are the values that the test asserts at
`7939b5fac`.

## What the numbers cannot show

- **No unbiased corpus timing.** The corpus timings come only from run 2,
  whose order bias makes A2/A 0.83. The committed harness has a random order,
  but it has no complete run.
- **A narrow corpus.** The 546 programs have a median of 2 operations, 299
  come from one row, and none has an `If` or a helper call. The corpus
  supports no statement about per-operation cost, branches or calls. The
  deep trees are generated, not taken from a document.
- **Execution is dominated by `run()`.** Its 38 to 58 ns of fixed work hide
  the body. The body measure resolves about ±5% (body A2/A 0.94 to 1.10). A
  difference in the body smaller than that is not seen. The inputs are few
  (2 to 30 per fixture), and they repeat in each pass.
- **Background load.** Two Chrome renderers used one core each during both
  runs. Their effect on these single-threaded timings was not measured
  separately.
- **Parse cost and memory of the larger code** were not measured. Neither
  were GLSL and `interval-js`: the pilot exists only for JavaScript.
- **The line counts are not a forecast** of the source after a replacement.
  The existing handlers stay as long as any program needs them, and the
  pilot vocabulary is nine operators. The "about 190" column is an estimate.
- **The corpus is reconstructed** from the LaTeX serialization of each
  compiled expression, not from the compiled tree itself.

## The decision rules of step 4, applied

The rules are those of step 4 of
[the plan](2026-11-09-js-compiler-status-and-plan.md). Each is applied to the
numbers above, one at a time. "Holds" means that the condition of the rule
is met.

**1. "A wrong value, a wrong shape or a hidden use of the existing emitter:
correct it, or stop."** Does not hold. No value or shape differs between A,
B, C and D on 8,809 inputs (a complex value and a real number compare as
different, so a shape difference would show). The step 3 test makes
`isComplexValued()`, `staticTypeOf()`, `userFunctionParamLanes()`,
`core.compile` and `compileCseRoot` throw from preparation to the end of
emission, and the fixtures compile. The coverage of this report finds no
emitter of the existing compiler on the structured route.
`isComplexValued()` still runs in assembly, after the emission (section
"Dependencies"): this is a reader in the assembly, not a use of the existing
emitter.

**2a. "A reproducible cost above 10% in total compilation, against the
ordinary target with the same options."** Does not hold. On every fixture,
in both runs, D compiles faster than B (warm D/B 0.30 to 0.68, fresh-process
D/B 0.41 to 0.61). These differences are resolved: they lie outside the
calibration range. On the corpus, D/B is about 0.78, biased toward D by up to
the calibration ratio. This shows that D is not slower, not by how much it is
faster. No regression.

**2b. "A reproducible cost above 5% in warm execution."** Not resolved.
Through `run()`, D/B is 0.98 to 1.03. On the body alone it is 0.97 to 1.02,
and on the corpus 1.00. Every median except one lies inside the calibration
range, and the exception (heatcell, run 1, 0.98) is not reproduced in run 2
(1.03). No cost above 5% was seen, but the harness does not resolve 5% on
`run()` for every fixture: A2/A reaches 0.60 to 1.22 on heatwall in run 1.

**3. "A difference smaller than the variability of the harness: time is then
not a reason for either choice. The two line counts decide."** For
compilation, the difference is larger than the variability and favours D;
this rule does not apply to compilation, and the rules say nothing more
about a pilot that compiles faster. For execution, the rule applies: time is
not a reason for either choice. Its two conditions for proposing an
expansion to the user:

- **"The pilot is smaller than the handlers it would replace."** Does not
  hold. The pilot is 1,539 lines. The existing handlers for the same
  operators are at most 907 lines, and about 190 lines for the part that
  serves only what the pilot covers (an estimate). The emitted code of D is
  also 2.5 to 6.7 times larger than that of B.
- **"It removed a class of defect that has a `corpus` or `plausible`
  witness."** Does not hold. Steps 1 to 3 found one wrong value:
  `Add(x, If(p(True), 1, Sqrt(-2)))`, with `p` the identity on booleans,
  gave `NaN` at `x = 1` with constant folding on, on the fragment route
  only. Step 1 removed it by a refusal of a closed complex node
  (`refuseClosedComplex()`), not by the structured emitter. Its witness was
  made for the test; it is neither `corpus` nor `plausible`. This report
  found no value on which the existing emitter and the structured emitter
  differ.

By this rule, expansion is not proposed.

**4. "Stop means: the structured emitter and its representation are
deleted; the annotation and the rule of step 1 stay."** This states what
stopping means. The rules above do not decide between stopping and keeping
the pilot as it is; the user decides.

**The GLSL and `interval-js` question.** The plan asks this report to ask it
again: should a structured representation be built for GLSL and
`interval-js`? These measurements are of JavaScript only. They show a pilot
that compiles faster than the existing JavaScript emitter, gives the same
values, does not change execution time measurably, writes 2.5 to 6.7 times
more code, and is larger in source than the code it would replace. They
contain no measurement of either other target.
