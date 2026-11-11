# Moving the engine's own compilations to the `numeric-kernel` profile (step 7, second part)

**Status: approved 2026-11-10** (the switch over all consumers, "profile
first", off by default).

## The situation

The `numeric-kernel` profile of the JavaScript target
([spec](2026-11-10-js-numeric-kernel-profile-spec.md)) is public and
experimental. Only tests and a host that passes the option use it. The
[plan](2026-11-09-js-compiler-status-and-plan.md) asks, as the second part of
step 7, to move the engine's own consumers of compiled code one at a time,
behind a switch, to get evidence from real use.

A survey of `src/` (2026-11-10) found 15 places where the engine compiles
for its own numeric work. All of them call one function,
`implicitCompile()` in `src/compute-engine/implicit-compile.ts`, which calls
`ce._compile(expr, { …options, fallback: false, entryChecks: false })` and
returns `undefined` on any decline. No switch selects a compiler today.

| Consumer | File | Contract beyond "a number" |
| --- | --- | --- |
| `ND` sampler | `library/calculus.ts`, `numericApplier()` | none; no cache; a decline interprets |
| Bounds of a multiple integral | `calculus.ts`, `mkBound()` | none |
| `NLimit`, limit probes | `calculus.ts`, `symbolic/limit.ts` | iteration budget; the probes have a cache |
| `Reduce` under `N` | `library/collections.ts` | a finite number, else the interpreter takes over |
| Integrands (`NIntegrate`, `Integrate`) | `calculus.ts` | retry in the `complex` mode on `NaN`; retry in log space if pure |
| Solve by enumeration, periodic roots | `boxed-expression/solve-domain.ts` | a decline changes the search budget; exact confirmation after |
| `FindFit`, `FindRoot` | `nonlinear-fit.ts` | ships code to workers |
| Stochastic equality | `boxed-expression/stochastic-equal.ts` | recomputes a `NaN` point |
| `NDSolve` | `differential-equation-utils.ts` | no fallback: a decline gives no answer |
| `Map`, `Filter`, `Any`, `All` | `library/map-auto-compile.ts` | the largest: exact integers, complex results, a cache with invalidation by dependency, a store guard |
| Series (`vars` option), interval proof (`interval-js`) | | cannot use the profile |

## Proposal

**One switch in `implicitCompile()`, "profile first"** (the option I
recommend). With the switch on, `implicitCompile()` first compiles with
`profile: 'numeric-kernel'`. When the profile declines, it compiles with the
existing compiler, exactly as today. The switch is off by default.

- A consumer never loses a compilation: a decline of the profile costs one
  admission pass, then the existing compiler runs.
- The requirement of the profile makes the switch safe to judge: for a
  program it admits, the doubles equal those of the existing compiler. So
  with the switch on, every test of the repository must give the same
  result. A test that changes is a defect of the profile or a part of a
  consumer's contract that the profile does not meet, and each one is a
  concrete finding.
- The switch records, per consumer, how many compilations the profile
  admitted and declined, and the first refusal of each decline. This gives
  the coverage on the engine's real programs, which the prelude census does
  not.
- The consumers that pass `vars` or `to: 'interval-js'` are left out by the
  function itself: it does not try the profile for them.

**The switch.** An internal setting of the engine, read by
`implicitCompile()` only, set by a test or by the environment variable
`CE_JS_PROFILE=numeric-kernel`. It is not a public option and has no
documentation outside `docs/`. Each call site passes its name, so that the
switch can also be limited to a list of consumers.

**Order of work.**

1. The switch, the counters, and the names at the 15 call sites. With the
   switch off, nothing changes; the existing tests show it.
2. Run the whole test suite with the switch on. Report: the tests that
   change, and the table of admitted and declined compilations per
   consumer.
3. Fix or decline what step 2 finds in the profile. A consumer whose
   contract the profile cannot meet is taken off the list, with the reason.
4. A decision for the user, with the numbers of step 2: which consumers get
   the profile by default, if any.

## The alternatives

- **One consumer at a time, starting with `ND`.** `ND` has the smallest
  contract, so the risk is the lowest; but it is one call site with few
  tests, so it gives little evidence, and each next consumer needs its own
  change. The switch above with a list of one consumer is the same thing.
- **`Map` first**, as the plan named it. It is the most used and has the
  largest contract (exact integers, complex results, a cache). It would
  give the most evidence and has the most ways to go wrong. Under the
  proposal it is one of the consumers of step 2, and its findings are
  listed with the others.
- **Replace the existing compiler in a consumer, with no second attempt.**
  A decline of the profile then falls to the interpreter, which makes the
  consumer slower for every program outside the profile. Not proposed
  before the coverage is known.

## What is not in this change

- No default changes. The switch is off.
- No change in Tycho. A Tycho cell can pass the public option itself.
- No removal of code from the existing compiler.

## Checks

- With the switch off: the full suite, unchanged.
- With the switch on: the full suite; each difference is reported with its
  test and its cause, none is hidden by a snapshot change.
- The time of the full suite with the switch on and off, as a first measure
  of the cost of the second admission pass.
- `Map`: the cache and its invalidation by dependency (`symbolDeps`,
  `varsObjectRefs`, the free-symbol gate that reads them also after a
  decline) are checked by a test with the switch on, because the survey
  could not confirm from the source that the profile fills them before a
  decline.

## Result of steps 1 and 2 (2026-11-10)

Step 1 is `943f1eb0f4b8f91d4c3fee9f299bb5a1efacb13d`: `ce._jsProfile`
(`CE_JS_PROFILE`, `CE_JS_PROFILE_CONSUMERS`), a consumer name at each of the
call sites, the counters (`js-profile-switch.ts`, `CE_JS_PROFILE_STATS`,
`scripts/js-profile-stats.mjs`). A consumer that passes `vars` (`series`) or
another target (`interval-proof`) is not tried.

Step 2, the full suite in a clean worktree, before the last review fixes
(which changed tests, the file name of the counters and the `vars` rule):

| Switch | Tests passed | Snapshots | Failures |
| --- | --- | --- | --- |
| off | 82,851 | 4,247 unchanged | 0 |
| on | 82,851 | 4,247 unchanged | 0 |

| Consumer | Attempts | Admitted | Declined |
| --- | --- | --- | --- |
| `limit-probe` | 1,773 | 0 | 1,773 |
| `fit` | 1,756 | 295 | 1,461 |
| `integrand` | 875 | 3 | 872 |
| `stochastic-equal` | 592 | 157 | 435 |
| `map-exact` | 224 | 58 | 166 |
| `periodic-roots` | 223 | 18 | 205 |
| `series` (tried in this run) | 194 | 0 | 194 |
| `map` | 192 | 4 | 188 |
| `multiple-integral` | 161 | 1 | 160 |
| `integrand-complex` | 135 | 0 | 135 |
| `nd` | 53 | 0 | 53 |
| `map-predicate` | 45 | 31 | 14 |
| `solve-enumeration` | 43 | 0 | 43 |
| `nlimit` | 38 | 0 | 38 |
| `ndsolve` | 29 | 24 | 5 |
| `reduce` | 28 | 0 | 28 |
| `integrand-log` | 23 | 0 | 23 |
| other | 8 | 0 | 8 |
| total | 6,392 | 591 | 5,801 |

No attempt failed. The declines by cause, from the five most frequent
messages of each consumer:

- about 3,400: "explicit distinct scalar parameters required". The engine
  builds its `Function` literals with parameters that have no declared type.
- about 1,800: "unsupported binding `x`" (`_ff_p0`, `a`, …). A free name
  with no numeric type, whose value the consumer passes at run time.
- 194: the `vars` option.
- about 50: a capture that is not a number.
- under 100: an operator outside the profile (`Tan`, `Arcsin`, `Arccos`,
  `LogGamma`, `Haversine`, `Cot`, `Sinh`, `Conjugate`), a `Power` form.

**A correction to this note.** "For a program it admits, the doubles equal
those of the existing compiler" holds against the existing compiler with
`constantFold: false`. `implicitCompile()` passes no such option, so the
existing compiler folds constants and the profile does not: for
`x·(√2 + √3 + 1/3)` the existing code multiplies by `3.479597703275306` and
the profile by `3.4795977032753056`. `NIntegrate` of it over 0 to 1 gives
`1.7397988516376528` and `1.7397988516376526`. A search over 3,000 constant
subexpressions found 6 that differ, all orderings of that sum, and no test of
the suite changed. Both values are within the precision caveat of compiled
code.

**Found on the way.** `issues/CE-1193.md`: the log-space evaluation of an
integrand is skipped for a typed parameter.

## After the rule for names with no declared type (2026-11-10)

`6b3e1e341858468e2b04ce64e3e3ffbaafb6705d`
([the rule](2026-11-10-js-numeric-kernel-profile-spec.md)). The full suite
in a clean worktree, before two tests were added to the new test file:

| Switch | Tests passed | Snapshots | Failures |
| --- | --- | --- | --- |
| off | 82,946 | 4,247 unchanged | 0 |
| on | 82,946 | 4,247 unchanged | 0 |

| Consumer | Attempts | Admitted | Declined |
| --- | --- | --- | --- |
| `limit-probe` | 1,773 | 1,391 | 382 |
| `fit` | 1,765 | 1,617 | 148 |
| `integrand` | 875 | 388 | 487 |
| `stochastic-equal` | 592 | 474 | 118 |
| `map-exact` | 224 | 163 | 61 |
| `periodic-roots` | 223 | 177 | 46 |
| `map` | 192 | 104 | 88 |
| `multiple-integral` | 161 | 143 | 18 |
| `integrand-complex` | 135 | 10 | 125 |
| `nd` | 54 | 28 | 26 |
| `map-predicate` | 45 | 41 | 4 |
| `solve-enumeration` | 43 | 27 | 16 |
| `nlimit` | 39 | 24 | 15 |
| `ndsolve` | 30 | 26 | 4 |
| `reduce` | 29 | 8 | 21 |
| `integrand-log` | 23 | 3 | 20 |
| other | 8 | 3 | 5 |
| total | 6,211 | 4,627 (74%) | 1,584 |

No attempt failed, and no test changed: the constant folding that the
profile does not do changed no exact comparison of the suite. The declines
of `limit-probe`, the largest group: `Erf` 142, a `Power` form outside the
profile 124, `Gamma` 33, `Root` 24.
