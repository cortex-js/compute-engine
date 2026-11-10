# The structured scalar emitter pilot, measured (step 4)

**Status: measured 2026-11-09 at `7939b5fac2207d8e69178caab0974d0bb36ea3b5`.
Documentation and a benchmark harness only; no compiler source changed.**
**Revised 2026-11-10: the emitter writes expressions, and the measure was
repeated (section "The revised emitter (2026-11-10)"). The sections before
that one are the record of the first measure.**

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

## The revised emitter (2026-11-10)

### What changed

Only the emitter (`javascript-structured-emit.ts`) changed. The
representation, the lowering and the verifier are as before. The rules of the
revised emitter:

- The value of an operation is written at its use, as part of the
  expression of the use, when the operation is `pure`, the value has exactly
  one use, that use is in the region of the definition (not in a nested
  region), and every operation between the definition and the use is `pure`.
  Every other value binds a `const`. An operation whose effect is
  `effectful` or `unknown` is always a statement, and no value moves across
  it.
- A read of an input has the effect `pure` (the annotation gives it that
  fact, and the entry of the compiled function normalizes the inputs before
  the body runs), so it is written at its use.
- An operand of a complex sum counts as two uses, because its text is
  written once per component: it binds a `const` and is evaluated once.
- An `if` whose two regions are one expression each is `c ? a : b`; an
  `and` or `or` whose regions after the first operand are one expression each
  is `&&` or `||`. A region that still needs statements keeps the block form
  of the first version. When the whole body is one expression, the assembly
  (`emitDelegatedBody()`, unchanged) writes it with no arrow function around
  it.
- Parentheses come from the precedence of the JavaScript operators. A
  negative literal, `-0` and `-Infinity` have the precedence of a unary
  minus (`x + -1`, `-1 * x`, `-(-1)`). The operand of a unary minus is in
  parentheses unless it is a name, a non-negative literal or a call, so
  `-(-x)` is never `--x`. An operand after the first of `+`, `*`, `<`, `===`,
  `&&` and `||` is in parentheses when its precedence is the same, so
  `a + (b + c)` keeps the order of a floating-point sum. An object literal is
  in parentheses.

The design choices and their alternatives:

| Choice | Alternative not taken | Reason |
| --- | --- | --- |
| Parentheses from precedence | Parentheses around every compound operand | Fewer bytes; the made-program tests check each precedence case (negative literals, unary minus after a binary operator, `-0`, nested conditionals, `&&` inside `||` and the reverse). |
| An operation with one use in a nested region keeps its `const` | Move it into the region | The task rule. Moving a pure value into a branch would also skip work when the branch is not taken, but it changes where the program evaluates the value. |
| An `and` or `or` with one region that needs statements is written whole as statements | A partial expression (`let t = a && b; if (t) {...}`) | Simpler; no fixture or corpus program reaches this case. |
| A complex-sum operand counts as two uses | Write the operand twice | Writing it twice evaluates it twice, and reads an input twice. |

**The test changes.** In
`test/compute-engine/compile-javascript-structured-emit.test.ts`:

- The step 3 test "only the inputs of the selected branch are read, in
  order" is now "only the inputs of the selected branch are read". It
  compares the set of the reads, not their order: the order of the reads of
  inputs is no longer a property of the emitted code.
- New order tests with the traced test operation: a pure value between two
  effectful operations is not moved across them (a made program, because
  the structured route admits no top-level `Block`; the test asserts the
  statements and the trace entries, not the order of the getter reads); an
  effectful operation is a statement even when only pure operations lie
  between it and its one use (a made program); an effectful local whose use
  comes after another effectful operation keeps its order; a value used in
  a nested region keeps its binding. With the "pure" condition of the
  emitter removed, the first two fail (checked once, then restored).
- A made program of a complex sum: each operand is read twice, so the
  conversion and the complex input each bind a `const`, and the sum is the
  object literal with `.re` and `.im` reads.
- The exact emitted code of `heatwall` and `heatcell`, so that a change of
  size shows.
- 19 made programs that check the parentheses, each with its exact code and
  its value on 24 inputs against a JavaScript function written by hand.
- All 27 differential fixtures of step 3 pass unchanged in value.

### The code of `heatwall`

```js
// B (62 bytes)
0.5 < _.obstacle && ((_.c) === (16)) && (_.r < 13 || 18 < _.r)

// D before the revision (322 bytes)
(() => { const _tv1 = _.obstacle; const _tv2 = 0.5 < _tv1; let _tv3 = _tv2; if (_tv3) { const _tv4 = _.c; const _tv5 = _tv4 === 16; _tv3 = _tv5; if (_tv3) { const _tv6 = _.r; const _tv7 = _tv6 < 13; let _tv8 = _tv7; if (!_tv8) { const _tv9 = _.r; const _tv10 = 18 < _tv9; _tv8 = _tv10; } _tv3 = _tv8; } } return _tv3; })()

// D after the revision (56 bytes)
0.5 < _.obstacle && _.c === 16 && (_.r < 13 || 18 < _.r)
```

The code of `heatcell` after the revision (234 bytes; 747 before, B 262).
The local `a` has one use, in the else branch, so it keeps its `const`:

```js
(v, s, d, c, r, obstacle) => { function _tv1(_tv2, _tv3, _tv4) { return 0.5 < _tv4 && _tv2 === 16 && (_tv3 < 13 || 18 < _tv3); }
const _tv5 = Math.min(0.25, Math.max(0, d)); return _tv1(c, r, obstacle) ? v : _tv5 * (s + -4 * v) + v; }
```

### New fixtures

Three named fixtures where the common-subexpression pass and the constant
folding of A matter. B and D do neither.

| Fixture | Ops | Program | A writes | B and D write |
| --- | ---: | --- | --- | --- |
| `cse-repeat` | 17 | `x·y + max(s, t)` four times, under `Max`, `Min`, `Multiply` and `Negate`, so that the canonical form does not merge them | one `_cse1`, read four times | the subexpression four times |
| `fold` | 4 | `x + min(0.25, max(0, 0.5))·y` | `_.x + _.y * 0.25` | the two calls |
| `local-reads` | 7 | a `Function` literal with a local `a = max(0, x + y)` read four times | one `let a` | one `let a` (B) or `const` (D) |

The structured route admits the constant subtree `min(0.25, max(0, 0.5))`
(admission refuses only a comparison that reads no symbol), so no nearer form
was needed. The deep trees of the first measure are unchanged.

### Runs

Three complete runs of the default mode (the 8 named and deep fixtures and
the 40-program corpus sample), each with the seeded random order for every
timing, one garbage collection per round, 9 rounds, under the box lock. No
Jest process ran. In the process snapshots, a Tycho `esbuild` used about 27%
of one core and two Chrome helpers about 8% each (snapshots in
[`2026-11-09-js-structured-pilot-measure/revised-run-environment.txt`](2026-11-09-js-structured-pilot-measure/revised-run-environment.txt);
raw outputs `revised-run1.jsonl.gz` to `revised-run3.jsonl.gz` in the same
directory).

| Run | Emitter | Start (UTC) | Load at start (1/5/15 min) | Duration |
| --- | --- | --- | --- | --- |
| R1 | first version of the revision | 13:17:28 | 2.4 / 2.2 / 1.9 | 89 s |
| R2 | first version of the revision | 13:19:01 | 3.6 / 2.7 / 2.1 | 87 s |
| R3 | final structure of the code (`operation()` returns the expression) | 13:21:57 | 2.7 / 2.7 / 2.2 | 87 s |

The command was
`node --expose-gc --import tsx benchmarks/js-structured-pilot.ts` at base
`52f112927818ed72e78c85d13705f6ae6e961617` with the revised emitter, in a
worktree. R1, R2 and R3 write the same code, byte for byte, for every
fixture. After R3, one change made negative literals unparenthesized
(`x + -1` instead of `x + (-1)`). It changes only the bytes (the tables of
"Emitted bytes" below are for the final code); V8 parses both texts to the
same tree, so it cannot change execution. A fourth run on the final code
was not made: another session took the box lock for about 90 minutes after
R3.

### Calibration

A2/A, per fixture: the median and the range over the rounds.

| Measure | R1 | R2 | R3 |
| --- | --- | --- | --- |
| Warm compilation | 0.93 to 1.07 (0.75 to 1.25) | 0.87 to 1.05 (0.71 to 1.29) | 0.90 to 1.05 (0.77 to 1.30) |
| Warm execution, `run()` | 0.93 to 1.05 (0.87 to 1.19) | 0.93 to 1.03 (0.86 to 1.15) | 0.95 to 1.05 (0.86 to 1.16) |
| Warm execution, body | 1.00 to 1.01 (0.93 to 1.12) | 0.99 to 1.00 (0.90 to 1.25) | 0.99 to 1.01 (0.90 to 1.08) |
| Cold, fresh engine | 0.96 to 1.02 (0.81 to 1.35) | 0.93 to 1.04 (0.79 to 1.23) | 0.99 to 1.06 (0.61 to 1.42) |
| Corpus totals, warm compilation | 0.98 (0.92 to 1.06) | 0.98 (0.94 to 1.06) | 0.97 (0.93 to 1.07) |

With the random order, A2/A is about 1.00 on the corpus totals, where the
rotating order of the first measure gave 0.83. The order bias of the first
measure does not appear here.

### Emitted bytes, before and after the revision

UTF-8 bytes of `result.code`; no configuration writes a preamble. "D before"
is the emitter of `52f112927`, measured with the same harness (`MODE=check`).

| Fixture | A | B | D before | D after | D/B before | D/B after | D/A after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| heatwall | 62 | 62 | 322 | 56 | 5.2 | 0.90 | 0.90 |
| heatcell | 262 | 262 | 747 | 234 | 2.9 | 0.89 | 0.89 |
| complex-if | 113 | 113 | 288 | 154 | 2.5 | 1.36 | 1.36 |
| cse-repeat | 134 | 170 | 926 | 170 | 5.4 | 1.00 | 1.27 |
| fold | 16 | 44 | 180 | 44 | 4.1 | 1.00 | 2.75 |
| local-reads | 112 | 112 | 356 | 120 | 3.2 | 1.07 | 1.07 |
| deep-full | 2,062 | 2,032 | 11,059 | 1,838 | 5.4 | 0.90 | 0.89 |
| deep-add-if | 1,743 | 1,743 | 11,719 | 1,363 | 6.7 | 0.78 | 0.78 |
| corpus sample, 40 programs | 1,215 | 1,215 | 7,021 | 1,204 | 5.8 | 0.99 | 0.99 |

On the corpus sample, D writes the same code length as B for 36 programs,
less for 3 and more for 1. `complex-if` is the largest D/B:

```js
// B (113 bytes)
(() => { const _tv1 = ((_.C) ? (({ re: _.x, im: 0 })) : (_.z)); return ({ re: _.y + _tv1.re, im: _tv1.im }); })()
// D (154 bytes)
(() => { const _tv1 = ({ re: _.y, im: 0 }); const _tv2 = _.C ? ({ re: _.x, im: 0 }) : _.z; return ({ re: _tv1.re + _tv2.re, im: _tv1.im + _tv2.im }); })()
```

The lowering converts the real `y` to a complex value before the sum, and
the sum reads each operand twice, so both operands bind a `const`. B adds
the real number to the real part directly. That is a difference of the
lowering, which this revision does not change. The 546-program corpus was
not run again; the first measure gave D/B 4.8 on it.

### Warm compilation (ms per compilation)

R3 (the final structure). The bold ratios lie outside the A2/A range of
their fixture.

| Fixture | Ops | A | B | D | A2/A | D/B | D/A |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| heatwall | 6 | 0.319 (0.302–0.346) | 0.258 (0.235–0.288) | 0.128 (0.120–0.163) | 1.03 (0.94–1.14) | **0.51** (0.46–0.62) | **0.40** (0.35–0.52) |
| heatcell | 8 | 1.02 (0.972–1.31) | 0.846 (0.771–1.11) | 0.277 (0.232–0.355) | 0.97 (0.89–1.01) | **0.33** (0.23–0.40) | **0.27** (0.20–0.30) |
| complex-if | 2 | 0.182 (0.160–0.210) | 0.130 (0.123–0.232) | 0.0887 (0.0849–0.106) | 0.93 (0.79–1.13) | **0.68** (0.46–0.71) | **0.52** (0.44–0.58) |
| cse-repeat | 17 | 0.493 (0.444–0.546) | 0.463 (0.443–0.506) | 0.221 (0.212–0.276) | 1.04 (0.90–1.14) | **0.49** (0.42–0.60) | **0.48** (0.43–0.60) |
| fold | 4 | 0.295 (0.253–0.349) | 0.172 (0.156–0.219) | 0.0889 (0.0780–0.0967) | 0.90 (0.77–1.30) | **0.51** (0.36–0.57) | **0.28** (0.26–0.36) |
| local-reads | 7 | 0.493 (0.447–0.544) | 0.390 (0.377–0.418) | 0.142 (0.124–0.194) | 1.05 (0.87–1.16) | **0.37** (0.32–0.46) | **0.29** (0.23–0.43) |
| deep-full | 198 | 4.33 (4.11–4.90) | 3.63 (3.33–3.73) | 1.69 (1.55–1.81) | 1.01 (0.89–1.14) | **0.49** (0.43–0.51) | **0.37** (0.35–0.42) |
| deep-add-if | 200 | 3.60 (3.38–3.88) | 2.83 (2.65–2.99) | 1.64 (1.49–1.72) | 1.02 (0.93–1.09) | **0.58** (0.52–0.63) | **0.45** (0.41–0.48) |

D/B in the three runs:

| Fixture | R1 | R2 | R3 |
| --- | --- | --- | --- |
| heatwall | 0.52 (0.46–0.64) | 0.51 (0.45–0.59) | 0.51 (0.46–0.62) |
| heatcell | 0.32 (0.26–0.37) | 0.33 (0.27–0.35) | 0.33 (0.23–0.40) |
| complex-if | 0.69 (0.50–0.75) | 0.68 (0.52–0.73) | 0.68 (0.46–0.71) |
| cse-repeat | 0.49 (0.42–0.57) | 0.49 (0.42–0.59) | 0.49 (0.42–0.60) |
| fold | 0.51 (0.42–0.59) | 0.52 (0.40–0.55) | 0.51 (0.36–0.57) |
| local-reads | 0.37 (0.32–0.50) | 0.37 (0.32–0.49) | 0.37 (0.32–0.46) |
| deep-full | 0.47 (0.44–0.52) | 0.49 (0.44–0.52) | 0.49 (0.43–0.51) |
| deep-add-if | 0.57 (0.52–0.62) | 0.57 (0.53–0.64) | 0.58 (0.52–0.63) |

The three runs agree within 0.02. The D/B ratios are those of the first
measure (0.30 to 0.68): the revision did not change the cost of
compilation. In R1 and R2 the emission phase of D is 0.007 ms
(`complex-if`) to 0.22 ms (the deep trees), as in the first measure (0.006
to 0.22 ms).

On the cold measure (first compilation on a fresh engine), D/B is 0.45 to
0.85 and D/A 0.36 to 0.68 in all three runs; every median except
`complex-if` in R1 (0.82, inside its A2/A range 0.82 to 1.35) lies outside
the A2/A range.

### Warm execution (ns per call)

Through `run()`, R3:

| Fixture | A | B | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- |
| heatwall | 43.3 (39.4–44.9) | 42.2 (39.0–62.1) | 39.9 (39.1–44.4) | 0.99 (0.89–1.10) | 0.93 (0.67–1.14) | 0.93 (0.89–1.13) |
| heatcell | 48.1 (46.8–51.0) | 50.2 (46.4–51.4) | 49.1 (46.7–50.8) | 1.04 (0.97–1.07) | 1.01 (0.91–1.05) | 1.03 (0.93–1.08) |
| complex-if | 47.7 (42.3–52.2) | 44.9 (42.2–46.3) | 44.4 (41.7–55.1) | 0.95 (0.86–1.05) | 1.00 (0.91–1.25) | 0.96 (0.86–1.14) |
| cse-repeat | 45.1 (42.8–48.7) | 45.4 (42.7–49.1) | 47.1 (43.7–49.2) | 1.00 (0.92–1.09) | 1.02 (0.91–1.13) | 1.00 (0.92–1.13) |
| fold | 37.0 (35.7–38.0) | 37.0 (36.4–37.9) | 37.3 (34.4–38.3) | 0.97 (0.95–1.03) | 0.99 (0.94–1.03) | 1.01 (0.92–1.05) |
| local-reads | 46.4 (42.7–49.6) | 44.7 (41.9–48.2) | 45.7 (41.9–49.3) | 0.97 (0.89–1.16) | 1.00 (0.94–1.08) | 0.95 (0.88–1.16) |
| deep-full | 68.3 (63.9–70.6) | 69.3 (64.5–71.0) | 65.9 (64.9–71.0) | 0.96 (0.91–1.09) | 0.94 (0.92–1.10) | 1.00 (0.92–1.10) |
| deep-add-if | 60.8 (59.4–66.5) | 60.9 (59.6–65.5) | 60.5 (58.6–65.4) | 1.05 (0.92–1.09) | 1.01 (0.91–1.08) | 0.99 (0.91–1.09) |

The body alone (`rawCall`), R3 (a `Function` literal has no body measure):

| Fixture | A | B | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- |
| heatwall | 6.03 (5.96–6.25) | 5.99 (5.96–6.11) | 5.99 (5.95–6.18) | 1.00 (0.96–1.04) | 1.00 (0.99–1.01) | 0.99 (0.97–1.02) |
| complex-if | 7.21 (7.11–7.37) | 7.24 (7.20–7.34) | 7.20 (7.18–7.40) | 0.99 (0.98–1.05) | 1.00 (0.99–1.01) | 1.00 (0.98–1.03) |
| cse-repeat | 7.51 (7.38–7.69) | 7.46 (7.38–8.10) | 7.51 (7.41–7.66) | 1.01 (0.98–1.01) | 1.00 (0.93–1.02) | 1.00 (0.97–1.01) |
| fold | 6.76 (6.62–6.94) | 6.85 (6.62–6.99) | 6.73 (6.56–7.13) | 1.00 (0.96–1.08) | 0.99 (0.96–1.03) | 1.00 (0.97–1.03) |
| deep-full | 12.9 (12.8–14.0) | 13.1 (12.4–14.1) | 13.3 (12.3–13.6) | 1.00 (0.90–1.05) | 1.02 (0.89–1.09) | 1.01 (0.89–1.06) |
| deep-add-if | 8.65 (8.51–9.02) | 8.92 (8.52–9.53) | 8.82 (8.51–9.10) | 1.00 (0.96–1.07) | 0.96 (0.91–1.05) | 1.02 (0.94–1.06) |

R1 and R2 give the same picture: through `run()`, D/B 0.91 to 1.05 and D/A
0.92 to 1.04; on the body, D/B 0.98 to 1.01 and D/A 0.99 to 1.10. Every
median lies inside the A2/A range of its fixture, with two exceptions that
the other runs do not repeat: `heatwall` through `run()` in R1 (D/B 0.91 and
D/A 0.93, just below the A2/A range 0.94 to 1.19; R2 gives D/B 0.98 and D/A
0.92, and R3 0.93 and 0.93, inside their ranges), and none on the body. `deep-full` body
D/A is 1.10 in R2, inside its A2/A range (0.90 to 1.25), and 1.02 and 1.01
in R1 and R3.

**The common-subexpression pass and constant folding of A make no measured
difference to execution on these fixtures.** On `cse-repeat`, A computes the
subexpression once and D four times; on `fold`, A writes `0.25` and D two
calls of `Math`. D/A is 0.99 to 1.01 on the body in all three runs (A2/A
ranges 0.96 to 1.08). The subexpression of `cse-repeat` is three cheap
operations; the pilot vocabulary has no costly operation (a transcendental
function, a call that loops) to repeat, so a case where the pass matters
more cannot be written in it.

### The corpus sample (40 programs, one per row)

Totals per round, R3 (median and range of 9 rounds):

| Measure | A | B | D | A2/A | D/B | D/A |
| --- | --- | --- | --- | --- | --- | --- |
| Warm compilation, ms | 7.01 (6.38–7.22) | 5.68 (5.31–5.95) | 3.77 (3.66–3.85) | 0.97 (0.93–1.07) | **0.68** (0.63–0.70) | **0.54** (0.52–0.60) |
| Cold, fresh engine, ms | 27.2 (26.7–28.6) | 23.0 (22.5–23.2) | 19.0 (18.6–19.0) | 1.02 (0.99–1.02) | **0.83** (0.82–0.83) | **0.69** (0.67–0.70) |
| Execution `run()`, ns summed | 1,442 (1,433–1,451) | 1,444 (1,417–1,480) | 1,455 (1,440–1,469) | 1.00 (0.99–1.01) | 1.00 (0.98–1.04) | 1.01 (1.00–1.02) |
| Execution body, ns summed | 253 (251–257) | 253 (252–257) | 256 (252–258) | 1.00 (0.99–1.01) | 1.00 (1.00–1.01) | 1.01 (1.00–1.01) |

R1 and R2 give warm compilation D/B 0.68 and 0.68, cold D/B 0.84 and 0.81,
and execution D/B 1.00 on both measures. Per program (median, 10th to 90th
percentile, R3): warm compilation D/B 0.72 (0.58–0.90) with A2/A 0.95
(0.79–1.32); execution of the body D/B 1.00 (0.98–1.01) with A2/A 1.00
(0.99–1.01). **With the random order, the corpus compilation result is
resolved: D compiles the 40 programs in 0.68 of the time of B**, outside the
A2/A range of the totals. The 546-program corpus was not run (the task
limits this measure to the default mode).

### Line counts

`MODE=lines` on the final code, by the rule of the first measure:

| Part | First measure | Revised |
| --- | ---: | ---: |
| `javascript-structured-ir.ts` | 417 | 417 |
| `javascript-structured-lower.ts` | 436 | 436 |
| `javascript-structured-emit.ts` | 187 | 276 |
| `javascript-fragment-target.ts`, lines of `4c4f1c163` or `7939b5fac` | 411 | 411 |
| `javascript-target.ts`, lines of `4c4f1c163` or `7939b5fac` | 88 | 88 |
| **Total** | **1,539** | **1,628** |

The existing handlers for the same operators are unchanged: at most 907
lines, and about 190 by estimate.

### The decision rules of step 4, applied again

**1. "A wrong value, a wrong shape or a hidden use of the existing emitter:
correct it, or stop."** Does not hold. On the 48 fixtures of the default mode
(761 inputs), no value differs between A, A2, B, C and D, with the sign of
each zero. The step 3 differential tests against the interpreter pass on all
27 fixtures; the test that makes the readers of the existing emitter throw
from preparation to emission passes. The revision added no import to the
emitter.

**2a. "A reproducible cost above 10% in total compilation, against the
ordinary target with the same options."** Does not hold. Warm D/B is 0.32 to
0.69 on every fixture in three runs, cold D/B 0.45 to 0.85, and 0.68 on the
corpus sample totals. Each is outside the calibration range except one cold
median. D is faster.

**2b. "A reproducible cost above 5% in warm execution."** Not resolved, and
no such cost was seen. On the body, every D/B median is 0.96 to 1.02 and
every D/A median 0.99 to 1.10, and each lies inside its A2/A range; the one
value above 1.05 (`deep-full` D/A 1.10 in R2) is not reproduced in R1 or R3.
Through `run()`, the medians are 0.91 to 1.05, inside the calibration range
except `heatwall` in R1, which is below 1 and not reproduced.

**3. "A difference smaller than the variability of the harness: time is then
not a reason for either choice. The two line counts decide."** For
execution, this rule applies. Its two conditions:

- **"The pilot is smaller than the handlers it would replace."** Does not
  hold. The pilot is now 1,628 lines; the handlers are at most 907, and
  about 190 by estimate. The emitted code is no longer a cost: D writes
  0.78 to 1.36 times the bytes of B per fixture, and 0.99 on the corpus
  sample, against 2.5 to 6.7 times in the first measure.
- **"It removed a class of defect that has a `corpus` or `plausible`
  witness."** Does not hold, as in the first measure.

By this rule, expansion is not proposed.

**4. "Stop means: the structured emitter and its representation are
deleted; the annotation and the rule of step 1 stay."** Unchanged: the
rules above do not decide between stopping and keeping the pilot.

### What is resolved and what is not

Resolved:

- The size of the emitted code. It was the one measured cost of D in the
  first measure; after the revision D writes about as many bytes as B.
- The corpus compilation ratio. With the random order, A2/A is about 1.00,
  and D/B 0.68 on the 40-program sample is outside its range.
- The cost of the absence of common subexpressions and folding in D, on
  `cse-repeat` and `fold`: no difference in execution (D/A 0.99 to 1.01 on
  the body).

Not resolved:

- Execution differences below about 5% through `run()` and about 2% on the
  body.
- The bytes and the timings on the 546-program corpus (not run).
- A second complete run of the final code: R3 is the only run of the final
  structure of the emitter, and no run measured the last change (negative
  literals without parentheses), which changes only bytes.
- The cost of the absence of common subexpressions for a costly repeated
  operation: the pilot vocabulary has none.
- Parse time and memory of the emitted code (not measured; the code is now
  about the size of B's).

## After step 5 (2026-11-10)

The second change of step 5 adds to the structured route: `Sqrt`, with its
real or complex result decided from facts (`structuredSqrtRule()`); helpers
that call helpers, each lowered once; and captured bindings read as
snapshots (`IRCaptureRead`). This section measures that code.

### New fixtures

| Fixture | What it measures |
| --- | --- |
| `sqrt-repeat` | `√(max(0, x) + y·s + 1)` four times, under `Max`, `Min`, `Multiply` and `Negate`, so that the canonical form keeps four occurrences. A computes the root once (`_cse1`); B and D four times. |
| `helper-chain` | `h1(x) + h1(y)`, where `h1` calls `h2` and `h2` calls `h3`. |
| `capture` | `g(x) + offset·y`, with `offset = 2.5` read in the root and in the helper `g`. |
| `local-writes` | A local written in both branches of an `If` statement and after it, then read. |

### The run

One complete run of the default mode
(`node --expose-gc --import tsx benchmarks/js-structured-pilot.ts`): the 12
named and deep fixtures and the 40-program corpus sample, with the seeded
random order for every timing, one garbage collection per round, 9 rounds.
It ran under the box lock, from 14:46:43 to 14:48:21 UTC (98 s), in a
worktree at base `5e496c6adae3b4fd52e2b6ccee6f8d5b5c3ab2dd` with the
uncommitted change. Load at the start: 2.58 / 2.67 / 2.53. A Tycho
`esbuild` used about 33% of one core. No Jest process ran.

The run used the code before six review fixes. None of them changes the
code emitted for a fixture: they change tests, verifier checks and
comments; the admission of closed complex nodes, which no fixture has; and
the sign of an `Add`, `Multiply`, `Min` or `Max` with no operand, which the
canonical form does not make.

**Values.** No value differs between A, A2, B, C and D on the 52 programs
(12 fixtures and 40 corpus programs, 825 inputs), with the sign of each
zero. D admits all 40 corpus programs; C admits 6.

### Calibration

A2/A, the median and the range over the rounds:

| Measure | Per fixture |
| --- | --- |
| Warm compilation | 0.86 to 1.07 (0.73 to 1.30) |
| Warm execution, `run()` | 0.94 to 1.06 (0.86 to 1.17) |
| Warm execution, body | 0.99 to 1.03 (0.70 to 1.17) |
| Cold, fresh engine | 0.97 to 1.06 (0.81 to 1.45) |
| Corpus totals, warm compilation | 0.99 (0.93 to 1.07) |
| Corpus totals, execution | 1.00 (0.98 to 1.03) |

### Emitted bytes (code and preamble)

| Fixture | A | B | D | D/B |
| --- | ---: | ---: | ---: | ---: |
| `heatwall` | 62 | 62 | 56 | 0.90 |
| `heatcell` | 262 | 262 | 234 | 0.89 |
| `complex-if` | 113 | 113 | 154 | 1.36 |
| `cse-repeat` | 134 | 170 | 170 | 1.00 |
| `fold` | 16 | 44 | 44 | 1.00 |
| `local-reads` | 112 | 112 | 120 | 1.07 |
| `sqrt-repeat` | 147 | 218 | 218 | 1.00 |
| `helper-chain` | 142 | 142 | 173 | 1.22 |
| `capture` | 52 | 52 | 64 | 1.23 |
| `local-writes` | 112 | 112 | 88 | 0.79 |
| `deep-full` | 2,062 | 2,032 | 1,838 | 0.90 |
| `deep-add-if` | 1,743 | 1,743 | 1,363 | 0.78 |
| Corpus sample (40 programs) | 1,215 | 1,215 | 1,204 | 0.99 |

The old fixtures have the bytes of the revised emitter. D writes more than
B for `helper-chain` and `capture` because each helper is a `function`
declaration where B writes an arrow function.

### Warm compilation (ms per compilation; ratios: median and range over the rounds)

| Fixture | A | B | D | D/B | D/A |
| --- | ---: | ---: | ---: | --- | --- |
| `heatwall` | 0.314 | 0.249 | 0.144 | 0.56 (0.50 to 0.69) | 0.46 (0.37 to 0.53) |
| `heatcell` | 1.052 | 0.874 | 0.309 | 0.36 (0.29 to 0.39) | 0.30 (0.25 to 0.36) |
| `complex-if` | 0.187 | 0.134 | 0.099 | 0.70 (0.61 to 0.77) | 0.54 (0.43 to 0.73) |
| `cse-repeat` | 0.513 | 0.482 | 0.239 | 0.49 (0.34 to 0.59) | 0.47 (0.42 to 0.53) |
| `fold` | 0.311 | 0.169 | 0.096 | 0.53 (0.42 to 0.78) | 0.31 (0.25 to 0.40) |
| `local-reads` | 0.465 | 0.387 | 0.159 | 0.40 (0.35 to 0.53) | 0.34 (0.25 to 0.43) |
| `sqrt-repeat` | 0.565 | 0.565 | 0.282 | 0.51 (0.48 to 0.60) | 0.52 (0.45 to 0.64) |
| `helper-chain` | 0.754 | 0.615 | 0.223 | 0.35 (0.26 to 0.38) | 0.29 (0.22 to 0.31) |
| `capture` | 0.358 | 0.296 | 0.128 | 0.43 (0.33 to 0.62) | 0.37 (0.30 to 0.50) |
| `local-writes` | 0.471 | 0.414 | 0.178 | 0.43 (0.37 to 0.55) | 0.37 (0.32 to 0.49) |
| `deep-full` | 4.463 | 3.625 | 1.812 | 0.52 (0.47 to 0.56) | 0.40 (0.36 to 0.48) |
| `deep-add-if` | 3.770 | 2.886 | 1.750 | 0.59 (0.55 to 0.69) | 0.46 (0.41 to 0.49) |
| Corpus totals | 7.05 | 5.87 | 4.11 | 0.68 (0.66 to 0.76) | 0.57 (0.54 to 0.63) |

Per corpus program, D/B has the median 0.74 (0.47 to 1.03), and D/A the
median 0.60 (0.45 to 0.99). Cold, on a fresh engine, D/B is 0.49 to 0.82
per fixture and 0.85 on the corpus totals.

### Warm execution (ns per call)

| Fixture | `run()`: A | B | D | D/B | D/A | Body: D/B | Body: D/A |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| `heatwall` | 42 | 42 | 39 | 0.95 (0.91 to 1.10) | 0.93 (0.91 to 1.10) | 1.00 (0.96 to 1.02) | 1.01 (0.98 to 1.02) |
| `heatcell` | 48 | 50 | 50 | 1.01 (0.90 to 1.05) | 1.03 (0.89 to 1.08) | — | — |
| `complex-if` | 45 | 42 | 42 | 1.01 (0.90 to 1.16) | 0.98 (0.87 to 1.12) | 0.98 (0.90 to 1.00) | 0.99 (0.87 to 1.04) |
| `cse-repeat` | 47 | 47 | 48 | 1.02 (0.95 to 1.10) | 1.02 (0.92 to 1.18) | 0.99 (0.93 to 1.01) | 1.00 (0.97 to 1.02) |
| `fold` | 37 | 38 | 37 | 0.97 (0.94 to 1.01) | 0.99 (0.93 to 1.10) | 1.01 (0.96 to 1.02) | 1.00 (0.99 to 1.01) |
| `local-reads` | 48 | 45 | 46 | 0.99 (0.92 to 1.09) | 0.96 (0.87 to 1.14) | — | — |
| `sqrt-repeat` | 46 | 46 | 46 | 1.01 (0.91 to 1.04) | 1.01 (0.88 to 1.05) | 1.00 (0.97 to 1.02) | 0.99 (0.94 to 1.01) |
| `helper-chain` | 40 | 41 | 38 | 0.95 (0.86 to 0.98) | 0.95 (0.90 to 0.99) | 0.93 (0.88 to 1.03) | 0.93 (0.90 to 1.04) |
| `capture` | 37 | 37 | 37 | 0.99 (0.93 to 1.05) | 0.99 (0.93 to 1.06) | 1.00 (0.96 to 1.02) | 1.00 (0.90 to 1.01) |
| `local-writes` | 47 | 44 | 45 | 1.03 (0.88 to 1.12) | 0.96 (0.89 to 1.05) | — | — |
| `deep-full` | 71 | 68 | 70 | 1.01 (0.92 to 1.13) | 0.99 (0.92 to 1.14) | 0.95 (0.89 to 1.36) | 0.95 (0.91 to 1.11) |
| `deep-add-if` | 61 | 60 | 60 | 1.01 (0.92 to 1.06) | 1.00 (0.95 to 1.08) | 0.99 (0.92 to 1.06) | 0.99 (0.95 to 1.03) |

"Body" is `rawCall`, which a `Function` literal does not have (—). On the
corpus totals, D/B is 1.01 (0.99 to 1.03) through `run()` and 1.00 (0.99
to 1.01) on the body.

**The cost of emitting without common subexpressions, on `sqrt-repeat`.**
Not resolved. D computes the square root four times and A once, and D/A is
0.99 (0.94 to 1.01) on the body and 1.01 (0.88 to 1.05) through `run()`:
inside the calibration range, with all three at about 8 ns per call on the
body. One explanation is that the JIT finds the four identical pure
`Math.sqrt` calls and computes them once; this run does not show that it
does. The measure therefore does not show a cost, and does not show that a
larger repeated operation, or a call that the JIT cannot merge, has none.

### Line counts

`MODE=lines`, by the rule of the first measure. `javascript-fragment-target.ts`
and `javascript-target.ts` count the lines of the pilot commits
(`4c4f1c163`, `7939b5fac`) and of the first change of step 5 (`5e496c6ad`);
after this change, also the uncommitted lines (`REV=worktree`), which
include lines of the existing route that the change moved
(`numericSnapshot()`).

| Part | Base `5e496c6ad` | After the second change |
| --- | ---: | ---: |
| `structured-ir.ts` (core) | 127 | 143 |
| `structured-verify.ts` (core) | 371 | 423 |
| `javascript-structured-policy.ts` | 36 | 37 |
| `javascript-structured-lower.ts` | 571 | 629 |
| `javascript-structured-emit.ts` | 289 | 297 |
| `javascript-fragment-target.ts`, lines of the commits above | 521 | 859 |
| `javascript-target.ts`, lines of the commits above | 88 | 88 |
| **Total** | **2,003** | **2,476** |

The core is 498 lines before and 566 after; the JavaScript files 1,505 and
1,910. After the six review fixes: `structured-verify.ts` 417,
`javascript-fragment-target.ts` 863, total 2,474.

The handlers of the existing emitter for the operators now covered are 942
lines: the 907 of the first measure, and 35 for `Sqrt`. The `Sqrt` handler
(`JAVASCRIPT_FUNCTIONS.Sqrt`) is 23 lines, `complexSqrtLiteral()` 4 lines and
`promotesToComplexLane()` 8 lines (it also serves `Ln`, `Log` and `Power`).
`isComplexValued()`, `assumedRealNonNegative()` and the capture reads of the
existing compiler are not counted, as in the first measure.

### The decision rules of step 4, applied again

**1. "A wrong value, a wrong shape or a hidden use of the existing emitter:
correct it, or stop."** Does not hold. No value differs on the 52 programs
(825 inputs). The differential tests of step 5 against the interpreter pass
in both modes. The facts of `Sqrt` equal `isComplexValued()` on 30 programs
in both modes, except two programs that decline. The test that makes the
readers of the existing compiler throw from preparation to emission passes
on the new programs in both modes.

**2a. "A reproducible cost above 10% in total compilation, against the
ordinary target with the same options."** Does not hold. Warm D/B is 0.35
to 0.70 per fixture, and 0.68 on the corpus totals. Each median is below the
calibration range of its fixture; one range touches it (`fold`, D/B up
to 0.78, A2/A from 0.78). Cold D/B is 0.49 to 0.82 per fixture. D is faster
on each new fixture too.

**2b. "A reproducible cost above 5% in warm execution."** Not resolved, and
no such cost was seen. Through `run()`, every D/B and D/A median is 0.93 to
1.03; on the body, 0.93 to 1.01; each lies inside its calibration range.
This includes `sqrt-repeat`, where A computes the repeated root once.

**3. "A difference smaller than the variability of the harness: time is then
not a reason for either choice. The two line counts decide."** For
execution, this rule applies:

- **"The pilot is smaller than the handlers it would replace."** Does not
  hold. The pilot is 2,476 lines; the handlers that it covers are 942.
- **"It removed a class of defect that has a `corpus` or `plausible`
  witness."** Does not hold. The structured route admits programs that the
  existing route refuses (several captured bindings, a captured binding in
  the root, helpers that call helpers, `Sqrt` in a bound body, `Sqrt`
  inside another compilation), but the existing route refuses these; it
  does not give a wrong value for them.

The decision to expand (approved 2026-11-10) was made for the compile-time
result and the objectives of the representation, not for these two rules,
and nothing in this run changes the facts it was based on.

**4. "Stop means: the structured emitter and its representation are
deleted; the annotation and the rule of step 1 stay."** Unchanged.

### What is resolved and what is not

Resolved: the compile time of D on the new operations (helpers, captures,
`Sqrt`, merges) keeps the ratio of the earlier fixtures; the emitted bytes
of the new fixtures (D/B 0.79 to 1.23).

Not resolved: the execution cost of emitting without common subexpressions
for a costly repeated operation (see above); execution differences below
about 5% through `run()` and about 2% on the body; a second run of this
code; the 546-program corpus.

## After step 6 (2026-11-10)

Step 6 adds to the structured route a loop over an integer range with
carried values (6a, `111ef6da5`), lists as inputs and parameters read with
`At` and `Length` (6b, `567f7d53f`), and lists that the program builds and
updates, with update in place decided on the representation (6c part 1,
`6f4d798e4`). This section measures that code, with the first analysis for
concurrency (`analyzeExecution()` in `structured-execution.ts`, uncommitted
when measured).

### Fixtures

| Fixture | What it measures |
| --- | --- |
| `loop-sum` | `s := s + k²` for `k` from 1 to `n`: a carried scalar. |
| `loop-complex-iteration` | `z := z² + c`, sixteen times, complex. |
| `heatneighbor` | The neighbour read of Tycho's heat showcase: a list input of 32 × 32 cells, the capture `N`, a call of `heatwall`. |
| `heatstep` | One step of the heat showcase as `executeEpsil()` defines it: a list built by a comprehension, carried by a loop and updated in place. |
| `heatpaint` | The brush of the showcase: a comprehension over the 32 × 32 cells. |

The heat fixtures now include the inputs of the heat test
(`test/compute-engine/compile-javascript-structured-heat.test.ts`): for
`heatstep`, the seed, uniform, corner and spot fields, wall on and off,
insulated and cooled, diffusivity 0.22, 0 and 10 (48 inputs); for
`heatneighbor` and `heatpaint`, the cells and the brushes of that test on
the seed field. The seed field is computed in JavaScript (the structured
route declines `heatseed`). C declines the three heat fixtures. The
benchmark compares A, B and D with each other; the comparison with the
interpreter is in the heat test, which passes.

### The run

One complete run of the default mode
(`node --expose-gc --import tsx benchmarks/js-structured-pilot.ts`): 17
named and deep fixtures and the 40-program corpus sample, in the seeded
random order, one garbage collection per round, 9 rounds. Then `MODE=heat`
and `MODE=workers`. It ran under the box lock, from 17:31:54 to 17:33:45 UTC
(the default mode 108 s), in a worktree at base `6f4d798e4` with
`structured-execution.ts` uncommitted. The load average was 19.3 / 21.7 /
17.2 at the start of the default mode, from processes that do not take the
lock (no Jest process of this session ran), and 7.0 / 16.6 / 15.7 at its
end. A second run was not made: another session was waiting for the lock.

**Values.** No value differs between A, A2, B, C and D on the 57 programs
(17 fixtures and 40 corpus programs, 1,034 inputs), with the sign of each
zero. D admits all 40 corpus programs; C admits 6.

### Calibration

A2/A, the median per fixture (the range over the rounds in parentheses):

| Measure | Per fixture |
| --- | --- |
| Warm compilation | 0.84 to 1.08 (0.74 to 1.30) |
| Warm execution, `run()` | 0.91 to 1.02; `heatstep` 0.93 (0.46 to 2.02) |
| Cold, fresh engine | 0.92 to 1.05 |
| Corpus totals, warm compilation | 1.00 (0.92 to 1.08) |
| Corpus totals, execution | 0.99 (0.98 to 1.01) |

The execution of `heatstep` through the default mode has a wide spread: one
call takes about 30 to 60 µs and makes an array of 1,024 numbers, so a batch
of 2 ms holds few calls and a collection can fall in it. The time of 100
steps below is the better measure for it.

### Emitted bytes (code and preamble)

| Fixture | A | B | D | D/B |
| --- | ---: | ---: | ---: | ---: |
| `loop-sum` | 326 | 326 | 194 | 0.60 |
| `loop-complex-iteration` | 319 | 319 | 327 | 1.03 |
| `heatneighbor` | 404 | 404 | 375 | 0.93 |
| `heatstep` | 1,186 | 1,596 | 1,296 | 0.81 |
| `heatpaint` | 472 | 675 | 604 | 0.89 |

The other fixtures have the bytes of the section "After step 5".

### Warm compilation (ms per compilation; ratios: median and range over the rounds)

| Fixture | A | B | D | D/B | D/A |
| --- | ---: | ---: | ---: | --- | --- |
| `loop-sum` | 0.450 | 0.364 | 0.192 | 0.55 (0.42 to 0.64) | 0.41 (0.37 to 0.49) |
| `loop-complex-iteration` | 0.394 | 0.330 | 0.183 | 0.52 (0.45 to 0.72) | 0.46 (0.35 to 0.62) |
| `heatneighbor` | 1.346 | 1.097 | 0.470 | 0.44 (0.35 to 0.49) | 0.36 (0.28 to 0.37) |
| `heatstep` | 3.340 | 2.751 | 1.125 | 0.42 (0.39 to 0.43) | 0.33 (0.30 to 0.36) |
| `heatpaint` | 1.858 | 1.437 | 0.539 | 0.38 (0.36 to 0.44) | 0.29 (0.28 to 0.34) |
| Corpus totals | 7.21 | 6.09 | 4.77 | 0.79 (0.73 to 0.88) | 0.65 (0.62 to 0.72) |

On the older fixtures, D/B is 0.40 to 0.82 per fixture. Per corpus program,
D/B has the median 0.84 (0.56 to 1.18), and D/A 0.72 (0.48 to 1.08); 10% of
the programs have D/B above 1.07. Cold, on a fresh engine, D/B is 0.50 to
0.91 per fixture.

### Warm execution

Through `run()`, ns per call:

| Fixture | A | B | D | D/B | D/A |
| --- | ---: | ---: | ---: | --- | --- |
| `loop-sum` | 57 | 60 | 33 | 0.56 (0.54 to 0.59) | 0.59 (0.54 to 0.61) |
| `loop-complex-iteration` | 138 | 140 | 107 | 0.76 (0.69 to 0.79) | 0.77 (0.72 to 0.80) |
| `heatneighbor` | 65 | 65 | 66 | 1.01 (0.93 to 1.10) | 1.02 (0.91 to 1.10) |
| `heatstep` | 62,316 | 59,439 | 31,253 | 0.59 (0.38 to 0.70) | 0.50 (0.36 to 0.85) |
| `heatpaint` | 8,180 | 8,453 | 8,635 | 1.02 (0.98 to 1.08) | 1.06 (1.01 to 1.10) |

On the older fixtures, D/B is 0.94 to 1.02 and D/A 0.90 to 1.05; on the
corpus totals, D/B is 1.00 (0.99 to 1.02).

**`heatstep`, 100 steps in sequence** (`MODE=heat`; each step on the field
of the previous one, from the seed field, diffusivity 0.22, insulated, wall
off; ms per 100 steps, 9 rounds):

| A | A2 | B | D | D/B | D/A | A2/A |
| ---: | ---: | ---: | ---: | --- | --- | --- |
| 5.40 | 5.47 | 5.68 | 3.02 | 0.53 (0.50 to 0.55) | 0.56 (0.54 to 1.04) | 1.02 (0.98 to 1.89) |

The final fields of A, A2, B and D are equal. In one round A took 2.99 ms,
the time of D; the run does not show why.

**Arrays made per call of `heatstep`**, counted as the heat test counts them
(the `[]` literals of the code, and the calls of the runtime helpers
`_SYS.replaceAt`, which copies, and `_SYS.replaceAtInPlace`, which does
not): A, B and D each write one array literal, copy no array, and write
1,024 elements in place. One array per call on every configuration. So the
difference in time does not come from allocations; this run does not show
where it comes from.

### Independent calls in practice (`MODE=workers`)

`heatstep` on a grid of 128 × 128 cells (the prelude with `N = 128`),
compiled once by D, called on 16 different fields: in sequence on the main
thread, and split over 2 and over 4 `worker_threads` workers of a kernel
pool. Each worker rebuilds the function from its stored form
(`createJavaScriptRuntime().load()` in `src/kernel-worker.ts`). Every value
from the workers equals the value of the call in sequence. Times, ms for the
16 calls, median and range over 9 rounds:

| Sequential | 2 workers | 4 workers |
| ---: | ---: | ---: |
| 6.64 (6.56 to 7.05) | 6.90 (6.80 to 7.25) | 4.31 (4.10 to 4.81) |

An observation, not a measure of parallel speed: the pool copies each field
of 16,384 numbers to a worker and the result back, and nothing is tuned for
a parallel run.

### The analysis for the heat functions

`analyzeExecution()` on the programs of D:

| Function | Independent calls | Worker portable | Loops |
| --- | --- | --- | --- |
| `heatneighbor` | yes | yes | none |
| `heatstep` | yes, no caveat (no iteration budget) | yes | one, a candidate: carried list `L`, index `k`, initial list unique, no run-time condition, cannot abort |
| `heatpaint` | yes | yes | none (the comprehension is a `build`, not a `loop`) |

The run measured the analysis before six review fixes. The fixes add the
fields `initialUnique` and `conditions` of a candidate (the row of
`heatstep` gives their values after the fixes, from the tests), and make the
rule refuse more loops; they change no answer for the heat functions and no
emitted code. The line count of `structured-execution.ts` below is the one
before the fixes.

### Line counts

`MODE=lines`, by the rule of the first measure. `javascript-fragment-target.ts`
and `javascript-target.ts` count the lines of the commits of the pilot, of
step 5 (`5e496c6ad`, `571be48ca`) and of step 6 (`111ef6da5`, `567f7d53f`,
`6f4d798e4`); the last column also counts the uncommitted lines
(`REV=worktree`).

| Part | End of step 5 (`571be48ca`) | `6f4d798e4` | With the analysis |
| --- | ---: | ---: | ---: |
| `structured-ir.ts` (core) | 143 | 191 | 191 |
| `structured-verify.ts` (core) | 417 | 700 | 700 |
| `structured-in-place.ts` (core) | — | 222 | 222 |
| `structured-execution.ts` (core) | — | — | 356 |
| `javascript-structured-policy.ts` | 37 | 58 | 58 |
| `javascript-structured-lower.ts` | 629 | 1,055 | 1,055 |
| `javascript-structured-emit.ts` | 297 | 459 | 459 |
| `javascript-fragment-target.ts`, lines of the commits above | 863 | 1,747 | 1,747 |
| `javascript-target.ts`, lines of the commits above | 88 | 86 | 86 |
| **Total** | **2,474** | **4,518** | **4,874** |

The core is 560 lines at the end of step 5, 1,113 at `6f4d798e4` and 1,469
with the analysis; the JavaScript files 1,914 and 3,405.

The handlers of the existing emitter for the operators now covered are at
most 1,616 lines: the 942 of the section "After step 5", and 674 for step 6.
`JAVASCRIPT_FUNCTIONS.At` 135, `Length` 38, `ReplaceAt` 19, `Mod` 30, `Floor`
7; in `compile-loops.ts`, `compileLoop` 135, `compileLoopBound` 27,
`compileForLoop` 101, `compileCountedRange` 93, `loopPassCount` 5,
`loopPassHelpers` 8 and `compileComprehension` 76. Each is counted whole, as
before: each also handles forms that the structured route declines (a loop
over a list, a step, `Break`, nested lists, a comprehension over a list), so
the count is an upper bound of what the route would replace. The runtime
helpers that both routes call (`_SYS.atNumeric`, `_SYS.replaceAtInPlace`,
`_SYS.floorMod`) are not counted.

### Dependencies of the structured route on the existing compiler

`MODE=deps` now compiles the named, step 5, step 6 and deep fixtures (16
programs; the first measure compiled 5, so the counts are not comparable
with it). Run on D, it finds 315 functions:

| Group | Functions |
| --- | ---: |
| The structured files (`structured-ir.ts` 7, `structured-verify.ts` 6, `structured-in-place.ts` 5, `javascript-structured-policy.ts` 2, `-lower.ts` 35, `-emit.ts` 18) | 73 |
| The route and the annotation (`javascript-fragment-target.ts` 51, `fragment.ts` 23, `javascript-fragment-facts.ts` 3) | 77 |
| The existing compiler, 39 files | 165 |

Run on B, the count is 742. The groups of the existing compiler are those of
the first measure, preparation and assembly: `javascript-target.ts` 28,
`fixed-width-unroll.ts` 19, `compile-references.ts` 10,
`compile-declarations.ts` 7, `javascript-runtime.ts` 7. Two are new with
step 6, and neither is an emitter: `compile-loops.ts` 3
(`loopPassHelpers`, `loopPassReset`, `loopPassResetCall`: the assembly writes
the reset of the iteration budget at the start of a call when the code counts
passes) and `in-place-update.ts` 1 (`copyingUpdateWarnings`, in preparation).
`isComplexValued()` still runs in assembly only, as in the first measure.
`structured-execution.ts` does not run: no compilation calls the analysis.

### The decision rules of step 4, applied again

**1. "A wrong value, a wrong shape or a hidden use of the existing emitter:
correct it, or stop."** Does not hold. No value differs on the 57 programs
(1,034 inputs). The heat tests compare D with the interpreter on the heat
fields and pass, and the test that makes the readers of the existing
compiler throw from preparation to emission passes on `heatstep`.

**2a. "A reproducible cost above 10% in total compilation, against the
ordinary target with the same options."** Does not hold. Warm D/B is 0.38 to
0.55 on the step 6 fixtures and 0.40 to 0.82 on the others; 0.79 on the
corpus totals. Cold D/B is 0.50 to 0.91. Per corpus program, D/B is above
1.07 for 10% of the programs (maximum 1.18); the totals and the median (0.84)
are below 1.

**2b. "A reproducible cost above 5% in warm execution."** Not resolved. On
one fixture a cost above 5% was seen once: `heatpaint`, D/A 1.06 (1.01 to
1.10), above its calibration (A2/A 1.01, 0.96 to 1.04); against B, the
configuration with the same options, D/B is 1.02 (0.98 to 1.08). A second
run is needed to know whether it is reproducible. D is faster on the loops:
`loop-sum` D/B 0.56, `loop-complex-iteration` 0.76, `heatstep` 0.59 per call
and 0.53 on 100 steps, with the same number of arrays made per call.

**3. "A difference smaller than the variability of the harness: time is then
not a reason for either choice. The two line counts decide."** For the
programs where execution does not differ:

- **"The pilot is smaller than the handlers it would replace."** Does not
  hold. The structured route is 4,874 lines with the analysis (4,518
  without); the handlers that it covers are at most 1,616.
- **"It removed a class of defect that has a `corpus` or `plausible`
  witness."** Does not hold. The route gives the same values as the existing
  route on the heat functions; CE-1191 (a rounding of a product with a local
  that holds an exact fraction is 1 too small) has the same limit on both
  routes.

**4. "Stop means: the structured emitter and its representation are
deleted; the annotation and the rule of step 1 stay."** Unchanged. The
decision to expand (approved 2026-11-10) was made for the compile-time
result and the objectives of the representation; this run adds a faster
execution on the loops, and nothing that changes the facts of that decision.

### What is resolved and what is not

Resolved: the compile time of D on loops and lists keeps the ratio of the
earlier fixtures; D makes one array per call of `heatstep`, as A and B do;
the calls of `heatstep` give the same values in two and four workers as in
sequence.

Not resolved: whether the cost of D on `heatpaint` against A (6%) is
reproducible; why D runs the loops faster; a second run of this code; the
546-program corpus.

## Second run and causes (2026-11-10)

This section repeats the default mode on the code of
`bce12318883b155f6631a77a6fce87022801a5a0`, with another order of the
configurations, and finds by experiment why D runs `heatstep` faster than A
and `heatpaint` slower. No compiler source changed. The harness has two
additions: `ORDER_SEED` (the seed of the order of the configurations,
default 12345) and `MODE=variants` (`modeVariants()`).

### The runs

All runs held the box lock, in a linked worktree at `bce12318883b` (the main
tree had uncommitted changes of other sessions in
`javascript-target.ts` and `compile-references.ts`, which A and B run). Node
v26.13.0, Apple M5 Max, 18 cores. Commands, times and load averages are in
[`2026-11-09-js-structured-pilot-measure/step6-runs-environment.txt`](2026-11-09-js-structured-pilot-measure/step6-runs-environment.txt);
the raw outputs are in the same directory.

| Run | Code | Seed | Load at start / end | Raw output |
| --- | --- | --- | --- | --- |
| First (section "After step 6") | `6f4d798e4` and the analysis | 12345 | 20.8 / 6.7 | `step6-run1.jsonl.gz` |
| Second, complete | `bce12318883b` | 20261110 | 3.9 / 5.3 | `step6-run2.jsonl.gz` |
| Third, `heatpaint` and the three new fixtures only | `bce12318883b` | 777 | 2.5 / 2.9 | `step6-run3-new-fixtures.jsonl.gz` |

The load of the second and third runs is from processes outside the lock;
the first run had a load of about 20 at its start.

**Values.** No value differs between A, A2, B, C and D on the 59 programs
of the second run (20 fixtures and 39 corpus programs, 1,053 inputs), with
the sign of each zero. D now declines one program of the 40-program sample,
`corpus-69` (`x = x`): `bce12318883b` makes the structured route refuse a
closed comparison, which the existing emitter folds. The corpus totals of
the second run are over 39 programs, those of the first over 40.

### Warm compilation, both runs

Ratios: the median and the range over the 9 rounds. "Agree" compares the
medians of the two runs: yes when they differ by less than the calibration,
the largest distance of A2/A from 1 in either run (in parentheses).

| Fixture | A2/A, 1st | A2/A, 2nd | D/B, 1st | D/B, 2nd | D/A, 1st | D/A, 2nd | Agree (D/B, D/A) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `heatwall` | 1.07 (0.91 to 1.22) | 1.00 (0.76 to 1.30) | 0.66 (0.53 to 0.85) | 0.73 (0.63 to 1.47) | 0.56 (0.49 to 0.65) | 0.52 (0.40 to 1.20) | yes, yes (±0.30) |
| `heatcell` | 0.94 (0.91 to 1.08) | 0.99 (0.90 to 1.18) | 0.40 (0.36 to 0.46) | 0.37 (0.27 to 0.50) | 0.34 (0.30 to 0.37) | 0.31 (0.23 to 0.40) | yes, yes (±0.18) |
| `complex-if` | 0.97 (0.76 to 1.17) | 1.07 (0.53 to 1.52) | 0.82 (0.65 to 0.88) | 1.10 (0.61 to 1.44) | 0.64 (0.51 to 0.76) | 0.70 (0.33 to 0.97) | yes, yes (±0.52) |
| `cse-repeat` | 1.04 (0.91 to 1.13) | 1.06 (0.91 to 1.61) | 0.62 (0.55 to 0.65) | 0.60 (0.51 to 0.73) | 0.60 (0.56 to 0.65) | 0.64 (0.57 to 0.78) | yes, yes (±0.61) |
| `fold` | 0.84 (0.74 to 1.27) | 0.99 (0.78 to 1.13) | 0.62 (0.45 to 0.71) | 0.64 (0.48 to 0.82) | 0.36 (0.30 to 0.44) | 0.41 (0.35 to 0.48) | yes, yes (±0.27) |
| `local-reads` | 1.03 (0.78 to 1.23) | 0.93 (0.87 to 1.14) | 0.48 (0.42 to 0.61) | 0.46 (0.39 to 0.63) | 0.41 (0.32 to 0.47) | 0.37 (0.36 to 0.48) | yes, yes (±0.23) |
| `sqrt-repeat` | 1.08 (0.89 to 1.15) | 0.98 (0.86 to 1.13) | 0.63 (0.57 to 0.70) | 0.65 (0.57 to 0.76) | 0.64 (0.55 to 0.70) | 0.67 (0.57 to 0.76) | yes, yes (±0.15) |
| `helper-chain` | 1.04 (0.91 to 1.07) | 0.97 (0.90 to 1.13) | 0.42 (0.35 to 0.47) | 0.38 (0.35 to 0.49) | 0.33 (0.29 to 0.35) | 0.31 (0.27 to 0.39) | yes, yes (±0.13) |
| `capture` | 1.04 (0.90 to 1.30) | 0.93 (0.77 to 1.20) | 0.47 (0.41 to 0.63) | 0.55 (0.35 to 0.65) | 0.42 (0.37 to 0.53) | 0.40 (0.34 to 0.63) | yes, yes (±0.30) |
| `local-writes` | 1.05 (0.89 to 1.19) | 1.16 (0.94 to 1.30) | 0.49 (0.42 to 0.64) | 0.58 (0.42 to 0.71) | 0.44 (0.36 to 0.57) | 0.47 (0.35 to 0.62) | yes, yes (±0.30) |
| `loop-sum` | 1.01 (0.84 to 1.24) | 0.95 (0.73 to 1.17) | 0.55 (0.42 to 0.64) | 0.46 (0.41 to 0.48) | 0.41 (0.37 to 0.49) | 0.39 (0.28 to 0.44) | yes, yes (±0.27) |
| `loop-complex-iteration` | 1.01 (0.87 to 1.19) | 0.86 (0.60 to 1.42) | 0.52 (0.45 to 0.72) | 0.51 (0.33 to 0.60) | 0.46 (0.35 to 0.62) | 0.38 (0.25 to 0.53) | yes, yes (±0.42) |
| `heatneighbor` | 0.95 (0.89 to 1.05) | 0.92 (0.73 to 1.17) | 0.44 (0.35 to 0.49) | 0.42 (0.39 to 0.49) | 0.36 (0.28 to 0.37) | 0.33 (0.24 to 0.41) | yes, yes (±0.27) |
| `heatstep` | 0.97 (0.94 to 1.10) | 1.07 (0.57 to 1.69) | 0.42 (0.39 to 0.43) | 0.41 (0.23 to 0.95) | 0.33 (0.30 to 0.36) | 0.33 (0.20 to 0.80) | yes, yes (±0.69) |
| `heatpaint` | 0.99 (0.87 to 1.10) | 0.96 (0.61 to 1.14) | 0.38 (0.36 to 0.44) | 0.43 (0.38 to 0.57) | 0.29 (0.28 to 0.34) | 0.31 (0.22 to 0.39) | yes, yes (±0.39) |
| `heatseed` | — | 1.01 (0.90 to 1.12) | — | 0.47 (0.35 to 0.53) | — | 0.29 (0.22 to 0.33) | one run |
| `roadstep` | — | 1.03 (0.94 to 1.12) | — | 0.46 (0.40 to 0.49) | — | 0.36 (0.33 to 0.39) | one run |
| `tone` | — | 1.08 (0.77 to 1.35) | — | 0.51 (0.28 to 0.75) | — | 0.43 (0.30 to 0.60) | one run |
| `deep-full` | 1.02 (0.90 to 1.08) | 0.99 (0.91 to 1.08) | 0.62 (0.56 to 0.66) | 0.59 (0.53 to 0.71) | 0.50 (0.43 to 0.56) | 0.50 (0.45 to 0.55) | yes, yes (±0.10) |
| `deep-add-if` | 1.02 (0.91 to 1.06) | 0.93 (0.89 to 1.04) | 0.72 (0.66 to 0.77) | 0.72 (0.69 to 0.88) | 0.56 (0.55 to 0.61) | 0.55 (0.51 to 0.65) | yes, yes (±0.11) |
| Corpus totals | 1.00 (0.92 to 1.08) | 0.99 (0.97 to 1.05) | 0.79 (0.73 to 0.88) | 0.82 (0.77 to 0.90) | 0.65 (0.62 to 0.72) | 0.69 (0.66 to 0.73) | yes, yes (±0.08) |

The third run gives D/B 0.41 to 0.49 for `heatpaint`, `heatseed`,
`roadstep` and `tone`, with A2/A 0.89 to 1.04 (ranges 0.77 to 1.28). Per
corpus program in the second run, D/B has the median 0.85 (0.62 to 1.19),
and 10% of the programs are above 1.07, as in the first run. Cold, on a
fresh engine, D/B is 0.55 to 0.93 per fixture (first run 0.50 to 0.91).

### Warm execution, both runs (ns per call through `run()`)

| Fixture | A2/A, 1st | A2/A, 2nd | D/B, 1st | D/B, 2nd | D/A, 1st | D/A, 2nd | Agree (D/B, D/A) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `heatwall` | 1.01 (0.96 to 1.03) | 0.91 (0.59 to 1.00) | 0.99 (0.96 to 1.01) | 1.05 (0.88 to 1.16) | 0.99 (0.93 to 1.01) | 0.96 (0.59 to 1.37) | yes, yes (±0.41) |
| `heatcell` | 1.01 (0.93 to 1.05) | 0.93 (0.84 to 1.20) | 1.02 (0.90 to 1.04) | 0.90 (0.82 to 1.08) | 0.99 (0.93 to 1.07) | 0.96 (0.89 to 1.10) | yes, yes (±0.20) |
| `complex-if` | 0.98 (0.89 to 1.12) | 0.99 (0.93 to 1.13) | 1.00 (0.90 to 1.12) | 0.99 (0.87 to 1.14) | 0.98 (0.87 to 1.12) | 0.99 (0.82 to 1.14) | yes, yes (±0.13) |
| `cse-repeat` | 1.00 (0.96 to 1.05) | 1.02 (0.70 to 1.07) | 1.00 (0.97 to 1.03) | 1.00 (0.92 to 1.34) | 1.00 (0.96 to 1.05) | 1.00 (0.94 to 1.11) | yes, yes (±0.30) |
| `fold` | 1.00 (0.96 to 1.08) | 0.97 (0.92 to 1.03) | 0.98 (0.83 to 1.10) | 0.99 (0.95 to 1.04) | 1.03 (0.73 to 1.10) | 0.95 (0.91 to 1.02) | yes, no (±0.08) |
| `local-reads` | 1.01 (0.91 to 1.14) | 0.97 (0.88 to 1.14) | 1.01 (0.92 to 1.08) | 1.01 (0.89 to 1.14) | 0.96 (0.88 to 1.12) | 1.01 (0.91 to 1.11) | yes, yes (±0.14) |
| `sqrt-repeat` | 1.01 (0.98 to 1.04) | 1.10 (0.85 to 1.16) | 1.00 (0.92 to 1.04) | 1.00 (0.93 to 1.14) | 1.05 (0.95 to 1.08) | 0.97 (0.87 to 1.12) | yes, yes (±0.16) |
| `helper-chain` | 1.01 (0.95 to 1.07) | 0.98 (0.92 to 1.05) | 0.94 (0.89 to 0.98) | 0.94 (0.87 to 0.95) | 0.95 (0.90 to 0.97) | 0.91 (0.86 to 0.92) | yes, yes (±0.08) |
| `capture` | 1.01 (0.93 to 1.09) | 1.01 (0.94 to 1.12) | 0.98 (0.95 to 1.04) | 0.99 (0.90 to 1.13) | 0.98 (0.94 to 1.05) | 1.02 (0.95 to 1.06) | yes, yes (±0.12) |
| `local-writes` | 0.97 (0.89 to 1.13) | 0.95 (0.81 to 1.05) | 1.01 (0.89 to 1.12) | 1.04 (0.85 to 1.42) | 0.98 (0.88 to 1.11) | 1.03 (0.81 to 1.30) | yes, yes (±0.19) |
| `loop-sum` | 1.00 (0.91 to 1.08) | 0.98 (0.91 to 1.10) | 0.56 (0.54 to 0.59) | 0.58 (0.54 to 0.70) | 0.59 (0.54 to 0.61) | 0.59 (0.55 to 0.66) | yes, yes (±0.10) |
| `loop-complex-iteration` | 1.01 (0.94 to 1.06) | 1.03 (0.98 to 1.12) | 0.76 (0.69 to 0.79) | 0.77 (0.72 to 0.80) | 0.77 (0.72 to 0.80) | 0.78 (0.74 to 0.81) | yes, yes (±0.12) |
| `heatneighbor` | 1.00 (0.89 to 1.10) | 1.02 (0.90 to 1.16) | 1.01 (0.93 to 1.10) | 1.04 (0.88 to 1.11) | 1.02 (0.91 to 1.10) | 1.04 (0.94 to 1.09) | yes, yes (±0.16) |
| `heatstep` | 0.93 (0.46 to 2.02) | 0.78 (0.44 to 2.36) | 0.59 (0.38 to 0.70) | 0.59 (0.34 to 0.75) | 0.50 (0.36 to 0.85) | 0.64 (0.38 to 1.59) | yes, yes (±1.36) |
| `heatpaint` | 1.01 (0.96 to 1.04) | 1.00 (0.95 to 1.04) | 1.02 (0.98 to 1.08) | 1.04 (0.97 to 1.09) | 1.06 (1.01 to 1.10) | 1.03 (0.98 to 1.09) | yes, yes (±0.05) |
| `heatseed` | — | 0.98 (0.88 to 1.05) | — | 1.06 (0.96 to 1.12) | — | 1.09 (0.93 to 1.18) | one run |
| `roadstep` | — | 0.61 (0.57 to 1.55) | — | 0.46 (0.43 to 0.98) | — | 0.50 (0.48 to 0.79) | one run |
| `tone` | — | 1.00 (0.95 to 1.05) | — | 0.99 (0.95 to 1.07) | — | 0.98 (0.92 to 1.05) | one run |
| `deep-full` | 0.91 (0.80 to 1.09) | 0.99 (0.90 to 1.04) | 1.00 (0.93 to 1.16) | 0.94 (0.90 to 1.12) | 0.90 (0.88 to 1.13) | 1.01 (0.91 to 1.08) | yes, yes (±0.20) |
| `deep-add-if` | 1.02 (0.91 to 1.11) | 0.99 (0.90 to 1.12) | 1.01 (0.90 to 1.12) | 1.06 (0.94 to 1.12) | 1.03 (0.91 to 1.10) | 1.02 (0.86 to 1.24) | yes, yes (±0.12) |
| Corpus totals | 0.99 (0.98 to 1.01) | 1.00 (0.98 to 1.05) | 1.00 (0.99 to 1.02) | 1.00 (0.97 to 1.01) | 1.00 (0.98 to 1.02) | 1.00 (0.98 to 1.01) | yes, yes (±0.05) |

The third run (seed 777): `heatpaint` D/B 1.04 (0.94 to 1.07), D/A 1.00
(0.95 to 1.07), A2/A 0.99 (0.95 to 1.09); `heatseed` D/B 1.08 (1.01 to
1.12), D/A 1.11 (1.02 to 1.14), A2/A 1.02 (0.92 to 1.10); `roadstep` D/B
0.47 (0.42 to 0.79), A2/A 1.52 (0.61 to 1.59); `tone` D/B 0.97 (0.94 to
1.03).

The two complete runs agree on every ratio but one: `fold` D/A, 1.03 and
0.95, with a calibration of ±0.08; D/B of `fold` agrees (0.98 and 0.99).
The calibration of `heatstep` and `roadstep` is wide in every run (A2/A
from 0.44 to 2.36 on `heatstep`): the cause is the first finding below.

### Why D runs `heatstep` faster

The two codes, shortened to the parts that differ (`run()` of A and D;
`H[k]` stands for the read `_SYS.atNumeric(H, k, "real")`, which is the same
on both routes):

```js
// A (the existing emitter, default options)
(H, diffusivity, boundary, obstacle) => {
  const _fn_heatwall = (c, r, obstacle) => …;
  const _fn_heatneighbor = (H, c, r, center, boundary, obstacle) => … _fn_heatwall(c, r, obstacle) … H[c + 32*r + 1] …;
  return (() => {                                          // (1) the body in an arrow function made and called per call
    let a = Math.min(0.25, Math.max(0, diffusivity));
    let L = _SYS.ownedCopy((() => {                        // (2) a copy; (3) the comprehension in an arrow function
      const result = []; for (let _tv1 = 0; _tv1 < 1024; _tv1++) { const j = 1 + (1) * _tv1; result.push(0); } return result; })());
    for (let _tv2 = 0; _tv2 < 1024; _tv2++) { const k = 1 + (1) * _tv2;   // (5) the loop header
      let c = _SYS.floorMod(k + -1, 32); let r = Math.floor((k + -1) / 32); let v = H[k];
      if (_fn_heatwall(c, r, obstacle)) { L = _SYS.replaceAtInPlace(L, k, v) }      // (6) an if statement and a local
      else { let neighbors = _fn_heatneighbor(H, c + -1, r, v, boundary, obstacle) + …;
             L = _SYS.replaceAtInPlace(L, k, a * (neighbors + -4 * v) + v) } }
    return L
  })(); }

// D (the structured emitter)
(H, diffusivity, boundary, obstacle) => {
  function _tv1(_tv3, _tv4, _tv5) { return …; }            // (4) function declarations
  function _tv2(_tv6, …, _tv11) { return …; }
  const _tv12 = Math.min(0.25, Math.max(0, diffusivity)); const _tv13 = 32 * 32;
  const _tv14 = []; for (let _tv15 = 1, _tv16 = _tv13 < _tv15 ? -1 : 1, _tv17 = _tv16 * (_tv13 - _tv15); _tv17 >= 0; _tv15 += _tv16, _tv17--) { _tv14.push(0); }
  const _tv18 = 32 * 32; let _tv19 = _tv14;
  for (let _tv20 = 1, _tv21 = _tv18 < _tv20 ? -1 : 1, _tv22 = _tv21 * (_tv18 - _tv20); _tv22 >= 0; _tv20 += _tv21, _tv22--) {
    const _tv23 = _SYS.floorMod(_tv20 + -1, 32); const _tv24 = Math.floor((_tv20 + -1) / 32); const _tv25 = H[_tv20];
    _tv19 = _tv1(_tv23, _tv24, obstacle) ? _SYS.replaceAtInPlace(_tv19, _tv20, _tv25)
          : _SYS.replaceAtInPlace(_tv19, _tv20, _tv12 * (_tv2(H, _tv23 + -1, _tv24, _tv25, boundary, obstacle) + … + -4 * _tv25) + _tv25); }
  return _tv19; }
```

B has the code of A with another loop header (`_SYS.rangeCount` and a test
of the length). A makes two arrays per call, not one: the section "After
step 6" counted the `[]` literals and the calls of `replaceAt`, and missed
the copy of `_SYS.ownedCopy` (2).

**The experiment** (`MODE=variants`). The harness makes, from the emitted
source, the function of A and of D, each with a `_SYS` of its own and called
directly (`A.raw`, `D.raw`, without the entry check and the normalization
of the result of `run()`), a second copy of `A.raw` (the calibration), and
one variant of A for each difference, with only that difference removed.
Each function must give the value of A on the 48 inputs before it is timed.
The share of a variant is (A.raw − variant) / (A.raw − D.raw), per round.
15 rounds, a full collection before each round, the functions in a new
random order in each round.

A first version of the mode gave every copy the same source text, and its
calibration failed (A.raw2/A.raw 0.67 in a short check): V8 gives two
`new Function` results with the same source one compiled function and one
set of type feedback, so the two `_SYS` objects made each `_SYS` call
polymorphic. Each function now has a source of its own (a comment that
names it). Its output is kept as `variants-shared-source.json.gz`, not used.

Batches of 20 ms, two seeds (`variants-final-seed20261110.json.gz`,
`variants-final-seed777.json.gz`):

| Function | ns per call, seed 1 | / A.raw, seed 1 | / A.raw, seed 2 | Share of the gap, seed 1 | Share, seed 2 |
| --- | ---: | --- | --- | --- | --- |
| `A.raw` | 29,076 | 1 | 1 | 0 | 0 |
| `A.raw2` (calibration) | 25,092 | 0.99 (0.83 to 1.03) | 1.00 (0.82 to 1.02) | 0.04 (−0.22 to 0.55) | 0.01 (−0.15 to 0.60) |
| `D.raw` | 20,695 | 0.70 (0.65 to 0.91) | 0.71 (0.69 to 0.89) | 1 | 1 |
| (1) `no-body-iife` | 20,952 | 0.72 (0.66 to 0.89) | 0.71 (0.69 to 0.90) | **1.00 (0.90 to 1.23)** | **0.98 (0.92 to 1.26)** |
| (2) `no-owned-copy` | 24,908 | 1.01 (0.83 to 1.15) | 1.00 (0.82 to 1.11) | −0.02 (−0.52 to 0.57) | 0.01 (−0.36 to 0.61) |
| (3) `no-comprehension-iife` | 26,286 | 1.00 (0.84 to 1.04) | 1.00 (0.83 to 1.02) | −0.01 (−0.29 to 0.51) | 0.01 (−0.16 to 0.56) |
| (4) `function-helpers` | 25,038 | 1.00 (0.81 to 1.08) | 1.00 (0.82 to 1.08) | −0.00 (−0.26 to 0.62) | −0.02 (−0.26 to 0.59) |
| (5) `loop-header` (the header of D) | 26,522 | 1.02 (0.87 to 1.06) | 1.04 (0.86 to 1.07) | −0.07 (−0.52 to 0.43) | −0.19 (−0.62 to 0.47) |
| (6) `conditional-expression` | 25,130 | 1.00 (0.83 to 1.01) | 1.00 (0.82 to 1.01) | 0.01 (−0.10 to 0.57) | 0.01 (−0.05 to 0.61) |
| `all` (1, 3 without the copy, 4, 5, 6) | 21,248 | 0.73 (0.67 to 0.90) | 0.73 (0.71 to 0.90) | 0.92 (0.77 to 1.08) | 0.93 (0.79 to 1.04) |
| `A.run` | 29,878 | 1.07 (0.97 to 1.11) | 1.08 (1.03 to 1.11) | | |
| `D.run` | 22,715 | 0.75 (0.73 to 0.93) | 0.74 (0.73 to 0.94) | | |

`A.raw` runs at one of two speeds, about 23,600 ns or about 29,000 ns per
call; the medians of the variants without (1) fall on either one, which
makes their ranges wide. Every function without (1) runs at the time of D.

**The batch length.** The default mode times batches of about 2 ms after a
full collection; the gap there is larger (D/A 0.50 and 0.64 in the two
runs). The same variants with batches of 2 ms and of 200 ms
(`variants-heatstep-batch2ms.json.gz`, `variants-heatstep-batch200ms.json.gz`):

| Batch | `A.raw`, ns | `D.raw` / `A.raw` | `no-body-iife` / `A.raw` | Share of `no-body-iife` | `A.raw2` / `A.raw` |
| --- | ---: | --- | --- | --- | --- |
| 2 ms (2 passes over the 48 inputs) | 49,250 (46,526 to 72,228) | 0.53 (0.37 to 0.58) | 0.53 (0.36 to 2.57) | 1.00 (−3.27 to 1.14) | 0.99 (0.51 to 2.27) |
| 20 ms (seed 1 above) | 29,076 (23,628 to 31,309) | 0.70 (0.65 to 0.91) | 0.72 (0.66 to 0.89) | 1.00 (0.90 to 1.23) | 0.99 (0.83 to 1.03) |
| 200 ms | 29,517 (29,143 to 31,198) | 0.70 (0.67 to 0.73) | 0.70 (0.66 to 0.77) | 1.00 (0.78 to 1.16) | 0.99 (0.94 to 1.02) |

D takes about 21,000 ns in every batch length, and about 26,000 ns with
2 ms batches; A takes about 29,000 ns in long batches and about 49,000 ns
in short batches after a collection. A small model of the two forms, run
with `--trace-opt` (`iife-trace-model.mjs` and its output
`iife-trace-model.txt`; an observation, not a timing), shows the mechanism
that this agrees with: after each full collection V8 compiles the arrow
function of the body again (Maglev with on-stack replacement, then
TurboFan), while the function without it stays optimized. The extra
compilations of `prepare()` (`PRIOR=1` and `PRIOR=3`, as the check pass of
the default mode makes) change nothing (D.raw/A.raw 0.71 in each), and the
fixtures that run before `heatstep` in the default mode change nothing
either: a default-mode run of `heatstep` and `heatpaint` alone gives A
64,363 ns, D 30,453 ns, D/A 0.46 (0.34 to 0.83).

**Result.** The existing route spends about 30% of its time on `heatstep`
in the arrow function that it makes and calls on each call around the body
(`return (() => { … })()`): 0.70 (0.65 to 0.91) in 20 ms batches, 0.70
(0.67 to 0.73) in 200 ms batches. In 2 ms batches after a full collection,
as in the default mode, it spends about 47% there (0.53, 0.37 to 0.58).
Removing that arrow function alone gives the time of D (share 0.98 to
1.00). The copy of `_SYS.ownedCopy`, the arrow function of the
comprehension, the `const` arrow helpers, the loop header and the `if`
statement each account for none of the gap (shares −0.19 to 0.04). The
same arrow function also explains the wide calibration of `heatstep` in the
default mode. Not explained: why `A.raw` runs at two speeds in 20 ms
batches.

`roadstep` has the same arrow function around its body in A (and D/B 0.46
and 0.47 in the two runs), but no variant of it was timed.

Idea, not done: the existing emitter could write the statements of a block
body in the function itself, instead of in `return (() => { … })()`.

### Why D runs `heatpaint` slower

```js
// A
(H, p, q, obstacle) => { const _fn_heatwall = (c, r, obstacle) => …;     // (1) a const arrow helper
  { const result = []; for (let _tv1 = 0; _tv1 < 1024; _tv1++) { const k = 1 + (1) * _tv1;   // (2) the loop header
    result.push((!_fn_heatwall(_SYS.floorMod(k + -1, 32), Math.floor((k + -1) / 32), obstacle)
                 && _SYS.pow2(-p + _SYS.floorMod(k + -1, 32) + 0.5) + _SYS.pow2(-q + Math.floor((k + -1) / 32) + 0.5) <= 9)   // (3) one expression, (4) pow2
                ? (1) : (H[k])); } return result; } }

// D
(H, p, q, obstacle) => { function _tv1(_tv2, _tv3, _tv4) { return …; }
  const _tv5 = 32 * 32; const _tv6 = [];
  for (let _tv7 = 1, _tv8 = _tv5 < _tv7 ? -1 : 1, _tv9 = _tv8 * (_tv5 - _tv7); _tv9 >= 0; _tv7 += _tv8, _tv9--) {
    let _tv12 = !_tv1(_SYS.floorMod(_tv7 + -1, 32), Math.floor((_tv7 + -1) / 32), obstacle);
    if (_tv12) { const _tv10 = -p + _SYS.floorMod(_tv7 + -1, 32) + 0.5; const _tv11 = -q + Math.floor((_tv7 + -1) / 32) + 0.5;
                 _tv12 = _tv10 * _tv10 + _tv11 * _tv11 <= 9; }
    _tv6.push(_tv12 ? 1 : H[_tv7]); } return _tv6; }
```

The variants change D (the slower code) toward A. The share is
(D.raw − variant) / (D.raw − A.raw). Batches of 20 ms, two seeds:

| Function | / D.raw, seed 1 | / D.raw, seed 2 | Share, seed 1 | Share, seed 2 |
| --- | --- | --- | --- | --- |
| `D.raw2` (calibration) | 0.99 (0.93 to 1.07) | 1.00 (0.95 to 1.01) | 0.15 (−0.21 to 0.92) | 0.01 (−0.22 to 0.47) |
| `A.raw` | 0.95 (0.89 to 1.13) | 0.93 (0.89 to 0.94) | 1 | 1 |
| (1) `arrow-helper` | 1.00 (0.94 to 1.04) | 1.00 (0.96 to 1.02) | −0.01 (−1.00 to 0.67) | −0.02 (−0.26 to 0.36) |
| (2) `loop-header` (the header of A) | 0.96 (0.92 to 0.99) | 0.95 (0.90 to 0.96) | **0.56 (−0.26 to 3.16)** | **0.67 (0.48 to 0.86)** |
| (2') `constant-step` (the header of D, step 1 and count 1023 written as numbers) | 1.01 (0.98 to 1.07) | 1.00 (0.95 to 1.02) | −0.07 (−2.04 to 0.46) | −0.03 (−0.33 to 0.43) |
| (4) `pow2` | 1.00 (0.97 to 1.06) | 1.00 (0.98 to 1.02) | −0.04 (−0.68 to 1.59) | 0.04 (−0.27 to 0.26) |
| (3, 4) `one-expression` | 1.00 (0.98 to 1.06) | 1.01 (0.99 to 1.03) | 0.01 (−0.66 to 0.86) | −0.12 (−0.47 to 0.07) |
| `all` (1, 2, 3 and 4) | 0.94 (0.88 to 0.99) | 0.93 (0.92 to 0.95) | 0.91 (−0.48 to 3.12) | 0.86 (0.64 to 1.13) |
| `D.argsys` (the form of `run()`) | 1.06 (0.99 to 1.29) | 1.07 (1.02 to 1.09) | | |
| `A.argsys` | 0.97 (0.93 to 1.00) | 0.97 (0.96 to 1.00) | | |
| A.run / D.run | 0.91 (0.84 to 0.98) | 0.92 (0.91 to 0.94) | | |

The three earlier variant runs (`variants-prior0/1/3.json.gz`) give the
loop header the shares 0.82, 0.74 and 0.64, and every other variant less
than 0.15.

**`heatseed`**, the same comparison (D slower; its code differs from A in
the loop header and in the squares, `_tv6 * _tv6` with locals in D,
`_SYS.pow2(…)` in A):

| Function | / D.raw, seed 1 | / D.raw, seed 2 | Share, seed 1 | Share, seed 2 |
| --- | --- | --- | --- | --- |
| `D.raw2` (calibration) | 1.00 (0.96 to 1.02) | 1.00 (0.98 to 1.03) | 0.05 (−0.31 to 0.33) | 0.00 (−0.36 to 0.19) |
| `A.raw` | 0.91 (0.88 to 0.93) | 0.91 (0.89 to 0.96) | 1 | 1 |
| `loop-header` (the header of A) | 0.92 (0.90 to 0.94) | 0.91 (0.88 to 0.98) | **0.87 (0.79 to 0.99)** | **0.91 (0.60 to 1.76)** |
| `pow2` | 0.97 (0.95 to 0.99) | 0.97 (0.94 to 0.99) | 0.32 (0.14 to 0.53) | 0.36 (0.13 to 0.56) |
| `all` | 0.90 (0.88 to 0.97) | 0.91 (0.89 to 0.93) | 1.01 (0.38 to 1.19) | 1.05 (0.83 to 2.55) |

**Result.** The structured route spends about 4% to 5% of its time on
`heatpaint` (0.95 to 0.96, ranges 0.90 to 0.99) and about 8% to 9% on
`heatseed` (0.91 to 0.92, ranges 0.88 to 0.98) in its loop header. Writing
the step and the count as numbers does not change it (1.00 to 1.01), so the
cost is the form of the header (the index and a count carried together, the
index increased by a variable), not the computation of the step from the
bounds. On `heatpaint`, about a third of the gap (shares 0.56 and 0.67 for
the header) is not explained by one difference alone; all of them together
give 0.86 to 0.91 of it. On `heatseed`, the header and the squares together
give all of it (`pow2` alone 0.32 to 0.36; the shares are not additive).
Not explained: in the form of `run()` (`_SYS` as an argument) the gap on
`heatpaint` is larger than between the raw functions: D.argsys / A.argsys
is about 1.09 to 1.10 (1.06 to 1.07 against 0.97, both relative to
D.raw), and D.raw / A.raw is 1.05 to 1.08; `run()` itself gives 1.09 to
1.10. The default mode gives a smaller gap on `heatpaint` (D/A 1.06, 1.03
and 1.00 in the three runs) than this harness.

Idea, not done: the structured emitter could write the loop header of A (a
counter from 0, the index computed in the body).

### The decision rules of step 4, applied to both runs

**2b. "A reproducible cost above 5% in warm execution, against the ordinary
target with the same options" (D/B).**

- `heatpaint`: does not hold. D/B 1.02 (0.98 to 1.08), 1.04 (0.97 to
  1.09) and 1.04 (0.94 to 1.07) in the three runs; each median is below
  1.05, and each range includes 1. Against A, the configuration with
  default options, D/A is 1.06, 1.03 and 1.00, and 1.05 to 1.08 between the
  raw functions of the variants mode: a cost of up to about 8% against A,
  above 5% in some runs and not in others. Its cause is the loop header of
  D (above).
- `heatseed` (new): holds. D/B 1.06 (0.96 to 1.12) in the second run and
  1.08 (1.01 to 1.12) in the third, with A2/A 0.98 (0.88 to 1.05) and 1.02
  (0.92 to 1.10); D/A 1.09 and 1.11; about 1.10 between the raw functions
  (A.raw / D.raw 0.91 in both seeds). The cause is the loop header of D (shares 0.87 and 0.91 of
  the gap against A). B was not timed in the variants mode; the loop header
  of B is a counter from 0, as in A.
- Every other fixture and the corpus totals: no reproducible cost above 5%
  in either run (the medians of D/B are 0.46 to 1.06 per fixture, and the
  ranges of the medians above 1.03 include 1). D is faster on `loop-sum`
  (0.56, 0.58), `loop-complex-iteration` (0.76, 0.77), `heatstep` (0.59,
  0.59; the cause is in the existing emitter, above) and `roadstep` (0.46,
  0.47).

The rule says "revise the design before any expansion". The revision that
the measure points to is the form of the loop header of the structured
emitter; this section does not make it.

### What is resolved and what is not

Resolved: the second run agrees with the first within the calibration on
every ratio except `fold` D/A (D/B agrees); D is faster on `heatstep`
because the existing emitter runs the body in an arrow function made per
call, which V8 optimizes again after each full collection; D is slower on
`heatpaint` and `heatseed` mainly because of its loop header; A makes two
arrays per call of `heatstep`, not one.

Not resolved: why `A.raw` of `heatstep` runs at two speeds; the part of
the `heatpaint` gap that no single difference explains; why the form of
`run()` widens the `heatpaint` gap; a run of the variants with B; the
546-program corpus.
