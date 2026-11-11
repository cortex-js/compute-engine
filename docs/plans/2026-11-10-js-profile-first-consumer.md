# Moving the engine's own compilations to the `numeric-kernel` profile (step 7, second part)

**Status: proposal, not approved. No code is written.**

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
