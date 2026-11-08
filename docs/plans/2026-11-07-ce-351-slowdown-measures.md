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

## Measures of 2026-11-08 (session cebatch-351)

Profile of `∫₁² 1/x dx` (bundle of the source with the options of the
release build, one warm process): three reads compute the full type of a
function literal, 11.8 % of the integral. Two of them only read the
effects on its arrow, for `isPure`: the literal `F` of `EvaluateAt`
(5.1 %) and, at the end of `evaluate()`, the integrand literal (3.2 %).
The third is `integrateListIntegrand()`, which reads the result type of the
integrand literal (3.5 %). The integrand is typed two times because the
type cache key (`_typeCacheGeneration()`) moves during the evaluation: each
literal that the integration boxes declares its parameter in a new scope,
and the declaration, the inference of the parameter type and the pop of
the scope each advance the type version. Of the type of a literal, the
type of the body is 7.4 % and the effects walk 1.7 %.

The change: when the type of an inline literal is not in its cache, its
latent effects are computed alone (`BoxedFunction._literalArrowEffects()`,
`functionLiteralArrowEffects()`), with the function that the type
computation calls for its effect slot, in the same static view of the
bindings. 150 related test files and the Epsil tests pass with
`CE_EFFECTS_PARANOID=1`, which compares the two sets at each call.
Medians of seven rounds of `benchmarks/type-derivation.mjs`, both orders of
the two bundles, box lock held, load 1.4 to 1.9 on 18 cores, µs:

```
case                  before → after (order 1)   before → after (order 2)
∫₁² 1/x dx              137.0 → 120.2 (−12%)      138.7 → 123.2 (−11%)
```

The other cases of the harness do not change (within 2 %).

What remains for `∫₁² 1/x dx`: the application of the literal of
`EvaluateAt` through `invoke()` (about 9 % for its call frame, its
declarations and its clean-up), boxing the input and the literal, and the
types computed again after each move of the type version. Not moving the
type version for the declarations of the parameters of a literal while it
is boxed would keep the cached types, but it is a change of the rule of the
type cache (`typeVersion`, `engine-configuration-lifecycle.ts`), and needs
its own analysis of soundness.

## Measures of 2026-11-08, second session (session cebatch-351)

The source of that day (`1f2e45346`) against published versions, in one
process (`benchmarks/type-derivation.mjs`, eleven bundles, box lock held,
load 2.2 at the start, medians of seven rounds, µs). The bundle of the
source is built from `src/compute-engine.ts` with the options of the release
build (`console.assert` removed, not minified); the published bundles are
minified.

```
case         0.118.2 0.124.3 0.133.0 0.140.0 0.150.0 0.160.0 0.167.0 0.172.0 0.178.0 0.184.0 source
box               14      13      15      15      16      18      17      19      20      16     15
simplify         138     126     150     151     171     189     175     186     200     179    175
nested-root       36      37      40      43      49      64      61      64      66      66     65
integral        1005    1028    1117    1259    1637    1687    1576    1630    1694    1476   1464
definite          42      50      58      64      80     112     114     145     179     140    140
```

The slowdown is a sum of steps of 5 to 30 % each, and no release carries
more than a third of it. The steps of the definite integral were followed to
commits: at each commit a bundle of the source was built with the same
options and timed between the two nearest published bundles in one process
(medians of five rounds of sixty calls, the three bundles alternated). The
reading of one bundle varies by about 10 % from one run to the next, so a
step under about 8 % is not resolved, and a step is accepted only when the
commit before it reads as the earlier bundle and the commit itself as the
later one.

- `4a2328c46` (0.158.0): the definite integral tests its value for an
  imaginary part (`hasImaginaryPart()`, a numeric approximation), +11 %.
  The commit `f32d05973` of 2026-11-07 reads the type of the value first,
  which removes most of it.
- `f29912a45` (0.171.0, value kinds phase 2): the `Abs` type handler built a
  new union type `nan | real<0..> | signed_infinity` at each call, +10 %.
  `magnitudeOrNaNType()` (`type-handlers.ts`) now keeps the union per
  magnitude type; 2.7 % of the integral remained in the handler, half of it
  in the `collection` fact of the operand descriptor, which asked the operand
  after its type had already excluded a collection.
- `2abc19a20` (0.171.0, CE-538 and CE-533, `subs()` of a binder variable
  and the quadrature error estimates): +10 %, spread over `liftIntegrand()`
  (3.3 → 6.1 % of the integral), the canonical form of `Divide` and the
  application of the literal, with no single function responsible.
- `28f74e381` (0.174.0, CE-601, a shared subexpression is evaluated once):
  the `isPure` test of the evaluation memo computed the full type of each
  function literal operand, +16 %. The commit `acd490ae8` of 2026-11-08
  computes the effects alone; 3.6 % of the integral remain in that test.

The steps of 0.150 → 0.160 of the two simplifications (`√6x + √2x` +10 %,
`√(3+2√2)` +30 %) were not followed to commits.

An experiment on the open question of the previous section: the type
version was set back after each state event during one evaluation, so that
no cached type was computed again. `∫₁² 1/x dx` changed by 1 %, boxing and
simplifying `√6x + √2x` by 0 % (medians of five alternated rounds in one
process). The types computed again after a move of the version are not a
measurable cost, and the rule of the type cache stays as it is.

A change tried in this session and not kept: the collection tests of a
symbol (`isCollection`, `isIndexedCollection`, `isFiniteCollection`,
`isLazyCollection`, `boxed-symbol.ts`) read the value of the symbol before
they enter the cycle guard (`cycle-guard.ts`, a `Map` write and a delete
per query), so that a symbol with no value answers at once. In the profile
of boxing `√6x + √2x` the guards were 3 % of the time and were gone, but
the benchmark could not resolve the gain (box 16 → 16 and 15 → 15 µs in
two alternated runs), and the review found two reads that the guard must
cover and that the reordering moved out of it: the value of a definition
is computed at its first read from LaTeX or from a host function
(`BoxedValueDefinition.storedValue`), and the lookup of the binding in the
context (`bindingInContext()`, `binders.ts`) reads the value of a shadowing
definition (`readsNoOtherBinding()`). Each computation boxes an expression
whose type derivation asks the same test, and the guard is what ends that
recursion. A fast path needs a lookup that provably runs no computation,
which the binding resolution does not offer; a cheaper guard (a flag on the
definition record in place of the `Map`) would keep every semantics but
changes the shape of a plain record that other code copies. The same
review refused a second change, which made the `collection` and `indexed`
facts of an operand descriptor trust a type that excludes a collection
without asking the operand: the type of a symbol is the type of its static
definition, while its value can come from a run-time copy of the binding.
Neither change is in the source.

What remains in `∫₁² 1/x dx` (profile of the source, percent of the
integral): boxing the input 32 % (of which the binder scope of `Integrate`
12 %, and the function literal of the integrand 6.5 %); the value of
`EvaluateAt` 21 % (the two applications of the literal through `invoke()`
13.5 %, of which the declaration of the parameter 2.5 %); building the
literal of `EvaluateAt` and the `EvaluateAt` node 12 %, of which
`rebindParameters()` 7 %: the antiderivative is built in the scope of the
handler, and each node that holds the variable is built again, canonical,
with the parameter in its place; the antiderivative 11 %;
`liftIntegrand()` 3.4 %, the inverse rebuild. The proposed next step is to
compute the antiderivative inside the body scope of the integrand literal,
where a minted `ce.symbol(variable)` binds to the parameter: neither rebuild
is then needed (about 10 % of the integral). It changes the scoping of the
`Integrate` handler (the value shield and the independent parameters are
declared in the handler scope today) and needs its own design and the
integration test suites.
