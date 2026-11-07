# CE-351: measures of the slowdown since 0.118.2

This document holds the measures and the analysis of issue `issues/CE-351.md`, moved out of the issue file on 2026-11-07 because an issue body is at most 150 words (`docs/ISSUE_TRACKING.md`, "Rules for the body"). The issue file keeps the summary and the next steps.

## Witness

Measured 2026-11-06, µs per call, medians of seven rounds of
`node benchmarks/type-derivation.mjs <0.118.2 bundle> <0.182.0 bundle>`
(the published `dist/esm-min/compute-engine.js` of each version, from
`npm pack`), box lock held, box load 11 on 18 cores:

```
case                  0.118.2  0.182.0  ratio
box  √6x + √2x           13.9     20.3   1.46
simplify √6x + √2x        134      186   1.39
simplify √(3+2√2)          37       67   1.81
solve x⁴+x²−1=0          1131      670   0.59  (different form of the result)
∫1/(x³+1)dx              1052     1599   1.52
∫₁² 1/x dx                 45      194   4.33
```

The commit "CE-351: the Multiply type handler types a product of scalar
factors before its tests for points, collections and NaN arms" made box 18 %,
simplify 9 % and `∫1/(x³+1)dx` 8 % faster than 0.182.0 (same harness, box load
16 to 19). The other cases did not change. What remains, from CPU profiles of
an unminified bundle: the definite integral spends about 40 % of its time in
boxing the function literal `["Function", F, x]` of `EvaluateAt` and applying
it, and in the many methods that the definite integrator tries before the
antiderivative (`integratePiecewise`, `integrateAcrossKinks` and the
`definiteFallback` chain of `Integrate`, `src/compute-engine/library/`). In
boxing, `checkNumericArgs()` still reads the type of each operand, and the
`Add` type handler has the same series of tests for collections before its
scalar case as `Multiply` had (the same shortcut may apply; not measured).
The simplification of `√(3+2√2)` was not profiled.

Older measurement (0.124.2 build, the 2026-09 harness):

µs per call, 0.124.2 build, medians of five rounds:

```
case                  0.118.2  0.124.2  ratio
box  √6x + √2x             41       44   1.07
simplify √6x + √2x        234      279   1.19
simplify √(3+2√2)          85       87   1.02
solve x⁴+x²−1=0          2475     2859   1.16
∫1/(x³+1)dx              1985     2393   1.21
∫₁² 1/x dx                173      220   1.27
```

0.124.3 is 7 to 25 % faster than 0.124.2 on four cases; not measured against
0.118.2 since. To measure: build, take the box lock, run
`CE_PUBLISHED_BUNDLE=<bundle> node benchmarks/runners/run_ce_rubi.mjs`.

## Cause and options

One type derivation of a function node: `Add(x, y)` / `Power(x, 2)` /
`Multiply(√6, x)` types in 2.3 / 2.8 / 3.3 µs against 1.2 / 1.1 / 2.5 µs on
0.118.2, spread over many functions. The definite integral loses in boxing
(`makeCanonicalFunctionCore` 110 against 81 µs). Experiments (CE-351.1 to .4):
a scalar arithmetic dispatch, a literal-type cache per value, a descriptor
pool, a memo of `broadcastsOverTuples` per definition. Keep literal-tier types
(decision 2026-09-06). Plan: `docs/plans/2026-09-06-type-facts-per-type.md`.

Full text: ROADMAP.md at commit 5784d4aec.

## Measures of 2026-11-07 (session cebatch-351)

Profiles of an unminified bundle of the source (`esbuild`, one warm process)
for `∫₁² 1/x dx`, in percent of its time: boxing the input 19 %; the
`Integrate` evaluate handler 71 %. In the handler: the value of `EvaluateAt`
18 %, boxing the function literal and the `EvaluateAt` 12 %, the
antiderivative 10 %, the effects of the literal (`isPure` reads its signature
type) 4.5 %, `hasImaginaryPart()` 4 %, and five lifts of the integrand out of
its literal (`liftIntegrand()`) about 9 %.

The change of that day lifts the integrand once in the handler scope (one
lift inside the value shield is still necessary, because there the names bind
to other definitions) and reads the type of a value before its numeric
approximation in `hasImaginaryPart()`. Medians of five alternated runs of each
bundle, in separate processes: `∫₁² 1/x dx` 187 → 173 µs, `∫₀^π x sin x dx`
449 → 397 µs.

Boxing `√6x + √2x`: its operands are typed `number`, and the `Add` type
handler takes about 2 % of the time. Most of the time is in
`checkNumericArgs()` (28 %), which reads the type of each operand.

## Measures of 2026-11-07, second change (session cebatch-351)

Three changes that give the same types and values: the enclosure type of
an exact literal is kept by tier, sign and double value
(`literalEnclosureType()`, `boxed-number.ts`); `excludedFromScalarInference()`
(`validate.ts`) excludes a number literal, whose `_infer()` writes nothing;
`withMatrixProductNaNCells()` (`boxed-function.ts`) returns early when fewer
than two operands of a product can be lists. Bundles built from the source
with the options of the release build (`console.assert` removed), each case
run five times in separate processes, the two bundles alternated, box lock
held. Medians in µs, before → after, two runs:

```
case                  run 1 (load 4.8→9.9)   run 2 (load 5.2→5.0)
box  √6x + √2x         15.6 → 12.4  (−21%)    11.8 → 10.6  (−10%)
simplify √6x + √2x      143 → 133   (−7%)      136 → 136    (0%)
simplify √(3+2√2)      59.4 → 56.8  (−4%)     59.2 → 56.4   (−5%)
∫₁² 1/x dx              144 → 154   (+7%)      133 → 132    (−1%)
∫1/(x³+1)dx            1735 → 1631  (−6%)     1530 → 1475   (−4%)
```

The first run had a rising load; the second is the reliable one.

What remains, from CPU profiles of the same bundles. The profiles are
flat: no function takes more than 4 % of its case on its own.

- Boxing `√6x + √2x`: `checkNumericArgs()` 38 %, of which the type of each
  `Multiply` operand 21 % (`boundCallType()`: the type handler 4 %, the rest
  is the general steps for absence, broadcast and kind values, each 1 to
  2 %), and `inferNumericArgs()` 10 %. The getters `isCollection` and
  `isFiniteCollection` of a symbol enter a cycle query (a `Map` write and
  delete) also for a symbol with no value, about 2 %.
- `∫₁² 1/x dx`: the `EvaluateAt` value 26 % (two applications of the
  function literal through `invoke()` 14 %, spread over the call frame,
  its declarations and its clean-up), boxing the input 14 %, boxing the
  function literal and the `EvaluateAt` 12 %, the antiderivative 12 %, and
  the `isPure` read of the shared evaluation memo, which computes the full
  signature type of each function literal to read its effects, about 9 %.
  Reading the effects of an inline literal without its type would save part
  of this, but the type is computed in the static view of the bindings and
  kept per generation, and a second route would have to give the same
  answer.
