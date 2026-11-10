# Compute Engine — Roadmap

This file lists the features, performance work, designs and tasks that remain:
work that nobody reported as a problem. A defect, a wrong value, a reported
performance problem, a design question about a defect or a documentation error
is an issue, a file in `issues/`, as `docs/ISSUE_TRACKING.md` describes; it is
never an entry here. A request from Tycho is an issue file with `source: tycho`.

This file records FUTURE work only. Work in progress has no entry: the session
that does it holds the state, in the plan document or the handoff file, and
`CHANGELOG.md` and the git history keep the record of finished work. Work that
another record tracks, a GitHub issue or an issue file, gets no entry that
repeats it; an entry exists only for the part of that work this file adds (a
design, the steps), and it links the other record.

## How to use this file

**References.** Each entry has a reference `CE-<n>`. A sub-item that can be
done alone has a reference `CE-<n>.<m>`. Use the reference in commit messages,
code comments, plans and replies, for example "CE-42.3".

- A reference does not change. Do not renumber entries, and do not give the
  number of a removed entry to a new entry.
- A new entry takes the number in `issues/NEXT.md`, the counter that issue
  files and this file share, and increases that file in the same edit.
  `node scripts/issues.mjs lint` fails when the counter is not above every
  `CE-<n>` here.
- Put a new entry in the section of its topic. In a section, entries are not in
  number order.

**Entry format.**

```markdown
### CE-<n>. <What to do>

**Status:** <state>; <kind>[, <size>].[ <decision>.][ <links>.]
**Witness:** <strength>; <the request, the document or the measurement that asks for it>.

<What the feature gives, the design and the steps.>

- **CE-<n>.1** <A sub-item that can be done alone.>
```

- `<state>` tells an agent whether it may start the work without asking:
  - `ready`: an agent may start it. An entry is `ready` only when the user
    approved it, and its status line records that approval with its date
    ("approved 2026-11-01"). A request from Tycho or a GitHub issue that asks
    for a capability is `ready` when the user says so.
  - `waits for user (<reason>)`: the user acts before an agent starts. The
    reason is `decision` (the entry states the question, the options with
    their costs, and the option the agent recommends), `design` (the next step
    is a design document that the user approves; an agent that judges the
    change worth it writes the document and says so in its report), or
    `approval` (an idea the user has not approved yet; the user makes the
    entry `ready`, with the date, or deletes it).

  There is no `in progress`: the session that starts an item removes the entry
  (see "Started and finished work").
- `<kind>` is `capability`, `performance` (an improvement with no reported
  problem), `design` or `task`.
- `<size>` is an estimate: `S` (one function or file and its tests), `M`
  (several files in one part of the engine), or `L` (several parts of the
  engine, or a plan document first).
- `<strength>` is `corpus` (a Tycho document or request, a GitHub issue, a
  benchmark, a program a host sent) or `plausible` (a program a user would
  write); `docs/ISSUE_TRACKING.md` defines both. The line is optional for an
  idea the user recorded.
- An idea for a capability, a performance change, a design or a task goes in
  the agent's report to the user, and becomes an entry
  (`waits for user (approval)`) only when the user says to record it. A defect
  that an agent finds is an issue file, never an entry here.
- Record a user decision once, in the status line, as `approved <date>`; the
  body of the entry states what was decided, with no date and no "decided by
  the user". Link the plan document, the GitHub issue or PR, and the issue
  file when there is one.
- Write what a person needs to do the work: the design, the files and
  functions, the options and their costs. Do not record who found the item,
  when, or how.

**Started and finished work.** An entry is removed when its work starts, not
when it ends: the session that does the work keeps the entry's content where
it needs it (the plan document, the task brief, the handoff file), and the
commit and `CHANGELOG.md` record the result. When the work stops before it is
done, the session writes the entry again, with the same reference, saying only
what remains. When a sub-item starts, delete its bullet and keep the numbers of
the other sub-items. An entry that waits for a decision or a design stays
until the decision is made or the design is written; then the work starts and
the entry goes.

**Related documents.** `docs/ISSUE_TRACKING.md` (issues), `docs/epsil/ROADMAP.md`
(Epsil language and tools), `docs/TYPE_SYSTEM_ROADMAP.md` and
`docs/INFERENCE_ROADMAP.md` (type system), `docs/rubi/RUBI.md` (Rubi
integration rules), `docs/fungrim/FUNGRIM.md` (Fungrim identities),
`docs/mathnet/README.md` (MathNet parser corpus), `benchmarks/README.md`
(benchmarks), `docs/plans/` (plans and design records).

## Sections

- [Collections, absence and broadcasting](#collections-absence-and-broadcasting)
- [Evaluation, canonical forms and scoping](#evaluation-canonical-forms-and-scoping)
- [Symbolic computation](#symbolic-computation)
- [Numeric evaluation and special functions](#numeric-evaluation-and-special-functions)
- [Compilation](#compilation)
- [LaTeX parsing and serialization](#latex-parsing-and-serialization)
- [Epsil](#epsil)
- [Performance](#performance)

## Collections, absence and broadcasting

### CE-79. Indexing and slicing a collection whose count is a `bigint`

**Status:** ready; capability. User decision 2026-10-06: `at()` and the readers
that compute an index from the count accept a `bigint` index. Issue #416.
**Witness:** corpus; Ready with user decision 2026-10-06; GitHub issue #416 (`Last(Range(1, 10^20))` stays unevaluated).

A collection count that is not a safe integer is a `bigint` (`expr.count`, the
`count` collection handler; see `smallCount()` in
`boxed-expression/collection-count.ts`). The readers that index or slice with
the count still take a `number`, so they treat such a count as unknown: `at()`
takes a `number` index, and `Last(Range(1, 10^20))` stays unevaluated because
the last index, 10^20, is not a safe integer. To do: make `at()` and the readers
that compute an index from the count (`Last`, a negative index, `Take`/`Drop`
with a negative count, `Most`, the rotations) accept a `bigint` index, so that
these give their value.

## Evaluation, canonical forms and scoping

### CE-111. Some lazy operators still run synchronously under `evaluateAsync`

**Status:** ready; capability. Issue #392. Approved 2026-11-01.
**Witness:** corpus; CE-111.4 approved 2026-10-31 (async iterator, spec ready); CE-111.1, .5 are design (keep); rest proposed under issue #392.

An operator opts in to the asynchronous route with `evaluatesOperands` ("the
handler demands and evaluates every held operand and reads nothing else of their
structure"): the route then awaits each held operand in order and runs the
handler on the values. A handler that stops early, or evaluates only some of its
operands, has an asynchronous twin of its own. `N`, `Add`, `Multiply`,
`Evaluate`, `ReleaseHold`, the chainable relations, and the lazy operators
listed in the code (flag, twin on the operand, or twin on the walk of a
collection through `runAsync`) already yield and honour an abort signal.

- These operators stay synchronous by design, because an `await` between
  operands does not interrupt their long step. They read the structure of an
  operand or build a definition: `Numerator`, `Denominator`,
  `NumeratorDenominator`, `Interpret`, `Head`, `Tail`, `Type`, `Signature`,
  `About`, `Symbol`, `Subscript`, `Unevaluated`, `Function`, `Rule`,
  `Predicate`, `IsSame`, `Same`, `MatchesType`, `Conforms`, `IsCompatibleUnit`,
  `UnitDimension`, `Spread`, `Declare*`, `DefineFunction`, `Assume`,
  `Condition`. They transform an operand symbolically: the polynomial heads,
  `Together`, `Apart`, `PartialFraction`, `Cancel`, `Expand*`, `Factor`,
  `Distribute`, `TrigExpand`, `TrigReduce`, `TrigToExp`, `ReplaceAll`,
  `Derivative`, `JacobianMatrix`, `InverseFunction`. They hand a held function
  or expression to a synchronous solver or quadrature: `Solve`, `DSolve`,
  `RSolve`, `FindRoot`, `FindFit`, `NIntegrate`, `NLimit`, `Limit`, `Residue`,
  `ND`, `NDSolve`, `InterpolatingFunction`, `EvaluateAt`.
- **CE-111.1** These operators stay synchronous, can have a long operand, and
  need a design: `Assign` (the right-hand side is evaluated in about ten
  branches, interleaved with writes to the scope), `When` and
  `Match` (conditional evaluation of a branch, with a large handler), `Timing` (a
  wall-clock measure that would include the yields), `WithRandomSeed` and
  `HoldValues` (their frame, a seed or a value shield, cannot span an `await`),
  and `NumericApproximation` (the marker of a lazy `Map`, evaluated per
  element).
- **CE-111.2** A user function whose body is already suspended on this engine (a
  recursive body, or a second call of the literal from another evaluation) and
  one with a free symbol in an argument run synchronously, because the scope of
  the body has room for one suspended frame. A recursive function yields in the
  statements of its outermost call only.
- **CE-111.5** Design needed. Under `evaluateAsync()`, `IndexWhere` checks
  whether a predicate step met a collection whose elements are not known (an
  incomplete walk) only up to the first `await` of that step. The synchronous
  search (`searchIndex`, `library/collections.ts`) gives no answer when the
  predicate meets such a collection, so that a missed element can never
  become a "found" or "not found" answer. The asynchronous walk
  (`indexWhereAsyncWalk`) reads the count `incompleteWalkCount()` before and
  after each step, but that count is shared by the whole engine
  (`boxed-expression/incomplete-walks.ts`), and another evaluation can change
  it during an `await`. So when the part of a predicate step after its first
  `await` walks a collection with unknown elements and still answers `True`,
  `evaluateAsync()` can give an index where `evaluate()` gives no answer. No
  input that shows the difference has been found: a predicate such as
  `y ↦ AsyncOnly(y) > 0 ∧ Count(FlatMap([1, 2], x ↦ Join([x], v))) > 0`
  (with `v` valueless) stays undecided on both routes, because the `Count`
  stays unevaluated. A fix needs an incomplete-walk count that belongs to one
  evaluation (its evaluation context), so that each `noteIncompleteWalk()`
  call adds to the count of the evaluation that is current. The same count
  would let the other asynchronous walks over lazy sources (CE-111.4) check
  their reads across an `await`. Documented in the CHANGELOG entry of
  `07b9f66fa`.
- **CE-111.4** Design needed. The elements of a lazy collection are computed
  synchronously when they are read, also under `evaluateAsync()`. So an
  operator that has only an `evaluateAsync` handler stays unevaluated in each
  element. With `AsyncOnly` declared `(number) -> number` with only an
  `evaluateAsync` handler that returns `x + 5`,
  `await Take(Apply(y ↦ AsyncOnly(y), Range(1, 100000)), 2).evaluateAsync()`
  gives `[AsyncOnly(1), AsyncOnly(2)]`; it should give `[6, 7]`. `Apply` makes
  a lazy `Map` for a large source or a source of unknown length
  (`applyLiteralMapped`, `library/core.ts`), and the reader computes each
  element with `evaluate()`. A small source is mapped eagerly and is awaited
  (`Apply(y ↦ AsyncOnly(y), [1, 2])` is `[6, 7]`). `Map` and `Filter` are
  always lazy views, for a source of any size: `Map` has no `evaluate` or
  `evaluateAsync` handler, and its elements are computed when the view is read
  (`materialize()`, `boxed-function.ts`). So, at commit `80a1c36c2`,
  `await Map(AsyncOnly, [1, 2]).evaluateAsync()` and
  `await Pipe([1, 2], Map(AsyncOnly)).evaluateAsync()` read
  `[AsyncOnly(1), AsyncOnly(2)]`, and `Map(y ↦ -AsyncOnly(y), [1, 2])` and
  `Map(Composition(Negate, AsyncOnly), [1, 2])` read
  `[-AsyncOnly(1), -AsyncOnly(2)]`; `Filter([1, 2, 3], y ↦ AsyncOnly(y) > 7)`
  reads as the error "Filter predicate must return "True" or "False"". Until
  the iterator exists, `evaluateAsync({ materialization: true })` gives the
  awaited values for `Map` (`[6, 7]` and `[-6, -7]`), because
  `materializeAsync()` awaits each element; it does not help `Filter`, which
  then throws the same error, because the predicate is still applied
  synchronously. A fix needs a way for a
  lazy collection to give its elements asynchronously (an asynchronous
  iterator next to `each()`, used by the asynchronous readers), or a rule
  that a lazy collection whose element expression holds an operator with only
  an asynchronous handler is made eager under `evaluateAsync()`. The first
  keeps the size of a large source; the second is simple but computes every
  element. User decision 2026-10-31: the first option, an asynchronous
  iterator of the elements of a lazy collection, used by the asynchronous
  readers. A one-page spec comes before the implementation: which lazy
  operators get the iterator, which readers use it, and how an abort signal
  and the evaluation context carry across each `await`.
  Done 2026-11-07 (CE-767): `FlatMap` has an `evaluateAsync` twin of its
  listing (spec section 4, item 3), which awaits the callback but still reads
  the source and each inner result with `each()`; `Max`, `Min`, `Supremum`,
  `Infimum` and `Sum` list a `FlatMap` operand with it. A view over the
  `FlatMap` (`Max(Take(FlatMap(…), 3))`) and the other readers of spec
  section 4, item 6 (`Mean`, `Median`, `Total`) still read it synchronously.

### CE-123. A validation phase before canonicalization, so that a probe does not declare

**Status:** waits for user (design); design.
**Witness:** none; Validation phase idea, "do it when a third instance appears".

Two computations must VALIDATE an expression (decide what it is or what it would
produce) without changing the environment. Each pays for this with a scratch
scope plus an exemption from cache invalidation:

- the `Pipe` implicit-map type handler (`PIPE_IMPLICIT_MAP_TYPE`,
  `library/core.ts`) canonicalizes held operands to decide whether a stage maps
  implicitly, and keeps a memo of the generation observed AFTER the derivation;
- the fix of item 219 ("Reading a nested lazy view's type was exponential in
  depth").

The user's proposal (2026-08-21): give the engine a phase before
canonicalization whose job is validation. Regular canonicalization calls it, and
internal constructions can SKIP it and use a cheaper canonicalization without
validation. A probe that needs only "what type would this application have" then
takes the cheap option and never declares, so no scratch-scope exemption is
necessary. Not scoped or scheduled. Do it when a third instance of the pattern
appears.

## Symbolic computation

### CE-148. A complex-valued function whose parts cannot be separated has no symbolic limit

**Status:** ready; capability, small. Issue #396. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #396.

`complexLimitAtPosInf` (`symbolic/limit.ts`) separates the real and imaginary
parts of a complex-valued function only for sums, products, quotients, integer
powers and the exponential. So `Limit(t ↦ t·Gamma(2 + i·t), ∞)` stays
unevaluated, although its limit is `0`; `.N()` gives a value near `0` for it.

### CE-153. Contour integration does not certify the complex roots of most polynomials of degree 3 or more

**Status:** ready; capability, small. PR #410. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with PR #410.

`ce.contourIntegrate()` needs every root of a denominator in exact form. For a
polynomial of degree 3 or more that is not even, it uses `solve()`, which
returns only the real roots. The pole set is then not certified and the status
is `unsupported`: `1/(z³ − 2)` and `z/(z⁷ − 1)` on `|z| = 2` stay unevaluated.
An attempt that wrote the roots of `zⁿ − c` as `|c|^(1/n)(cos θ + i sin θ)` gave
correct values, but took 1.2 s to 1.5 s for `n = 3` and reached the 5 s time
limit for `n = 5` and `n = 7`. Most of the time goes to the exact sign tests and
the Laurent expansions at points that contain `cos(2π/n)`. A fix needs a cheaper
residue at a simple pole of `h(z)/(zⁿ − c)`, which is `h(p)·p/(n·c)`, computed
before the Laurent kernel runs, and a measurement of where the remaining time
goes.

### CE-158. Definite integrals of `Abs` and `Sign`: undecided sign changes

**Status:** ready; capability, small. Issue #352. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #352.

A definite integral whose integrand has `Abs(u)` or `Sign(u)`, with `u` linear
or quadratic in the integration variable, is split at the points where `u`
changes sign, and each piece is integrated with `Abs(u)` replaced by `±u` and
`Sign(u)` by `±1` (`integrateAcrossKinks`, `library/calculus.ts`).

- **CE-158.2** When the position of a sign change relative to the bounds cannot
  be decided, the integral is not split. An antiderivative with a `Sign(u)` term
  that depends on the variable then leaves the integral unevaluated, because
  `F(b) − F(a)` includes the jump of that term if the sign change is between the
  bounds. Examples: `\int_2^a |x|\cos x\,dx` (it gave
  `\sin(a)|a| + \cos(a)\operatorname{sgn}(a) - 2\sin 2 - \cos 2`, correct for
  `a > 0` and wrong for `a < 0`) and `\int_0^1 |x - c|\cos x\,dx`. A conditional
  value (a `When` over the sign of `a`, or of `c`), or a use of the assumptions
  on `a`, would give these a value again.

### CE-168. Wester problems with no CE API: periodic decimals, real QE, matrix functions, tests

**Status:** waits for user (design); capability. Decision 2026-07-05: do not alias
Mathematica spellings.
**Witness:** none; Wester problems with no CE API.

These Wester problems have no CE API to express them, so they cannot be a
`test.skip`. Each needs a naming and design decision first; then its acceptance
test goes into `wester.test.ts`. The Mathematica→CE table is in
`docs/MATHEMATICA-NAMES.md`. Probe CE's own names before you add an item here:
many heads that seem missing exist under CE names (`NthPrime`, `NPartition`,
`PowerMod`, `ModularInverse`, `StirlingS1`, `Rationalize`, `PrimitiveRoot`,
`ContinuedFraction`, matrix ∞-`Norm`, `BaseForm`, finite-domain
`ForAll`/`Exists`).

- **CE-168.1** Repeating decimals, producer direction: an equivalent of
  `ToPeriodicForm` that renders an exact rational as a periodic-decimal object.
  The `repeatingDecimal` option of the LaTeX serializer covers only float
  display. (Repeating-decimal literals already box as exact rationals.)
- **CE-168.2** Quantifier elimination over ℝ. `ForAll`/`Exists` evaluate only
  over finite domains; the Wester and Liska–Steinberg stability problems need QE
  over real closed fields (CAD or virtual substitution). A major subsystem,
  listed for completeness, not planned.
- **CE-168.3** `MatrixExp` and general matrix functions (sine of a matrix).
  `Exp` of a matrix broadcasts element-wise (documented); it is not the matrix
  exponential.
- **CE-168.4** Symbolic singular values (`SVD` is float-only).
- **CE-168.5** Jordan and Smith normal forms.
- **CE-168.6** Hypothesis testing (`MeanTest` and others), not declared. Do it
  only if the statistics work needs it.

### CE-170. Rubi: integration coverage by chapter

**Status:** ready; capability. Rung history: `docs/rubi/RUBI.md` §5. Approved 2026-11-01.
**Witness:** corpus; Proposed Rubi coverage work with benchmark scores, no wrong results.

The shipped bundle (`src/compute-engine/rubi/rubi-rules-data.json`, through
`@cortex-js/compute-engine/integration-rules`) holds Chapters 1 (Algebraic), 2
(Exponentials), 3 (Logarithms), 5 (Inverse trig), 6 (Hyperbolics), 7 (Inverse
hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant and §8.8 Polylogarithm: 6,574
rules, 6.98 MB. CI checks that the bundle is up to date. The history of each
rung (R1 to R32: mechanism, score changes, dead ends) is in `docs/rubi/RUBI.md`
§5 and in Git history; it is not repeated here.

Scores (seed 5, s120 unless stated, 2026-07-12):

- 4.1 Sine 107/120 and 331/400 (file 4.1.11 93/113); 4.3 Tangent 72/120; 4.5
  Secant 69/120.
- Chapter 3 Logarithms 70/120.
- Chapter 5: 5.1 sine 65, 5.2 cosine 76 to 78 (the verify deadline makes it
  vary), 5.3 tangent 64, 5.4 cotangent 62, 5.5 secant 56, 5.6 cosecant 52 (at
  least 375/720, about 52 %; the 5.5 and 5.6 scores are older than the last
  re-runs).
- Chapter 7: 7.1 sine 79, 7.2 cosine 51, 7.3 tangent 85, 7.4 cotangent 95, 7.5
  secant 44, 7.6 cosecant 54 (408/720 = 56.7 %).
- 1.1 Binomial products 112/120; 1.1.3 General 185/200 (s200; the one unsolved
  problem, #259, is an integer-power rational); Chapter 1 exhaustive about 90 to
  91 %; Chapter 2 about 72 % effective (seed 42); Chapter 6 Hyperbolics 73/120
  (0 wrong); Wester indefinite integrals 6/8.

**Wrong results.** No suite has a genuine wrong result. Every flagged "wrong" is
a known false wrong of the verifier: numeric ₂F₁/AppellF1 grading at a
non-integer symbolic-exponent substitution, `√(sin²)=|sin|`, and the cube-root
or fractional-power branch at a negative x. Before you believe a wrong flag,
differentiate the antiderivative and compare at integer substitutions.

**Where the trig routing is.** The runtime part (`rubi-utils.ts`, `driver.ts`)
holds `deactivateTrig` (only x-free, linear or bare-monomial arguments become
inert; composite quadratic or √-inner arguments stay active for the substitution
rules), `cofunctionShift` (`sec → csc[θ+π/2]` and `cot → −tan[θ+π/2]`, both on
by default), `unifyInertTrig` and its cofunction product clauses,
`standaloneCosineShift`, `reciprocalToPower` (it does not apply under fractional
powers, for branch safety, and keeps reflection-produced `csc[·+π/2]` heads raw,
with a `(a+b·sec²)^p` exception that sends 4.5.7 to the sin/cos rules), and the
driver fallbacks. Each fallback checks its result (numeric evaluability or a
derivative check) and fails closed.

A/B environment switches: `RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`, `RUBI_NO_COFN`,
`RUBI_NO_COFN_COT`, `RUBI_NO_SKELETON`, `RUBI_NO_SICI`, `RUBI_NO_SICI_COMPLEX`,
`RUBI_NO_SECBIN`, `RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`, `RUBI_NO_TRIGSUB`
(subproblem trig bridge), `RUBI_NO_R25` (quartic-denominator ExpandIntegrand
guard), `RUBI_NO_R26` (rational normal form retry in the exp-substitution
fallback), `RUBI_NO_R27` (poly×trig product reduction), `RUBI_NO_R28`
(mixed-parity Laurent numerator × binomial radical linearity split),
`RUBI_NO_R29` (algebraic-in-hyperbolic `u = Sinh/Cosh/Tanh[v]` substitution),
`RUBI_NO_R30` (rational-in-hyperbolic cyclotomic-factored `t = e^v`
substitution), `RUBI_NO_R8` (poly×single-angle-hyperbolic → `y = e^w` PolyLog),
`RUBI_NO_R31` (nested-radical substitution, pre-filter
`hasNestedRadicalCandidate`), `RUBI_NO_R32` (Euler substitution
`t = √a·x + √Q`).

**Driver budgets.** The driver stops after a step budget (300,000 steps per
integral, `RUBI_STEP_BUDGET`), not after a time. Its two sub-searches (the
native rational fallback and the clean-up simplify) have their own step budgets.
What still depends on the clock is listed in the entry "Big-decimal coefficients
grow to thousands of digits in the polynomial GCD of a Rubi simplification".
`loadIntegrationRules(ce, { stepBudget, timeLimitMs })` is independent of a
`withTimeLimit` span: a heavy test must raise the loader budget and also set a
long enough span.

**Numeric zero tests.** Do not gate Rubi's `PossibleZeroQ` (`zeroQ`) or the
`PosAux` sign heuristic (`rubi/rubi-utils.ts`) on `.unknowns`. `.N()` resolves
symbolic identities with free variables that `simplify()` cannot see
(`(4-root b / 4-root a)^2 - sqrt(b)/sqrt(a)` numericizes to `0`), and a gated
`zeroQ` lost a closed form (integration-rules #544). The same applies to
`numericMagnitude` (`symbolic/solver-utils.ts`, used by
`symbolic/recurrences.ts`) and the rationalize-denominator test
(`symbolic/simplify-power.ts`): each keeps a bare `.N()` with a comment. The
rule for the gate in `boxed-expression/numerics.ts` (`numberLiteralOf()`,
`numericValueOf()`, `complexValueOf()`): use it only where "no numeric value"
sends the caller to its give-up branch. Do not cache `unknowns` for the gate:
the gate is 2 to 50 times cheaper than the `.N()` it replaces.

**Benchmark command.**
`npx tsx scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine" --sample 120 --seed 5 --report /tmp/x.json`.

- Always pass `--report`: the default path overwrites the committed baseline.
- `--rubi` mode preloads the Chapter 1/2/3/4.1/4.3/4.5/5/6/7/§8.8 foundation, as
  the shipped bundle does (`RUBI_NO_FOUNDATION` disables it). 4.1 baselines from
  before 2026-07-04 are not comparable.
- Run suites one after the other: concurrent runs change each other's driver and
  verifier timing.
- A `--rubi` target that is a Chapter 4 subsection (for example
  `.../4 Trig functions/4.1 Sine`) sets `corpusRoot` to the Chapter 4 folder, so
  no foundation loads and the score (58) is lower than the shipped §4.1 score
  (107, `loadIntegrationRules`). Measure Chapter 4 sections through the shipped
  bundle.
- After a change, `solved-correct` must go up while genuine `wrong` and
  `not-evaluable` stay 0.

**How to find the next change.** The "unimplemented-predicate" trace census
gives wrong priorities: the late catch-all rules (`FunctionOfTrigOfLinearQ`,
`TrigSimplifyQ`) are checked on nearly every unsolved problem but are not the
blocker. Count the actual rule-fail and inner-condition reasons, trace the
residual integrand, and use `wolframscript` to see Rubi's real chain:

```mathematica
Get["~/dev/rubi/Rubi-4.17.3.0/Rubi/Rubi.m"];
Trace[Rubi`Int[Cos[x]^4, x], HoldPattern[Rubi`Int[_, _]]]
Rubi`Private`DeactivateTrig[Cos[x]^4, x]   (* -> sin[Pi/2 + x]^4 *)
```

Open items, in priority order:

- Chapter 3 unsolved tail: 43/120 (s120 seed 5). 15 are expected `Unintegrable`
  (Rubi also returns them unevaluated, so CE's inert `Integrate` is correct).
  About 30 are deep. Family table: `docs/rubi/RUBI.md` §5 R19/R20.
  - **CE-170.1** Poly×log by-parts residuals that end in `∫artanh(√)/x`,
    symbolic-order-`k` `PolyLog` recurrences, or `ArcSinh·Log` (3.1.4, 3.1.5).
    The bundled Chapter 5 and 7 base cases do not reach these shapes. The lever
    is a symbolic-order `PolyLog` recurrence.
  - **CE-170.2** 6 problems `∫Log[Sin/Tan/Csc²]` (3.5). Two parts are missing: a
    `D` reduction for the inert trig heads (CE's `D` knows `Tan`, not the inert
    `tan` head that the driver carries), and a Chapter 4 foundation for the
    by-parts sub-integral (only 4.1, 4.3 and 4.5 are bundled).
  - **CE-170.3** 4 problems `∫Log[·]/rational` → `PolyLog[2]`; 3 problems
    `(a+b·Log[c(d+ex)ⁿ])^p × rational` with half-integer residuals; 4 problems
    with a fractional or negative power in the log argument →
    `Gamma`/`Ei`/`LogIntegral` with an `x^(2/3)` or `e/√x` substitution. All
    need new production rules or kernels, not more bundled rules.
- **CE-170.4** Deep half-integer and elliptic chains in Chapter 4.1: #53 (a
  23-step half-integer Fresnel chain), #248 (48 steps), and the composite
  `cot^m/(a+b·sin)^n` and `(a+b·sin²)^(p/2)` tan/cot-power recursions (4.1.1.3,
  4.1.7), which may fold into CE-170.5.
- **CE-170.5** `TrigSimplify`/`TrigSimplifyQ` (Pythagorean reductions). Low
  value: do it only if a concrete residual class needs it. One known member: #93
  (`csc^(−1/2)·sin` cancellation).
- **CE-170.6** A circular `TrigReduce` (multiple-angle elementary form) for
  `sin^n` products. The exp-form reduction works, but it verifies past the
  harness budget and takes precedence over trig-form rules in the whole chapter,
  so it is switched off.
- **CE-170.7** Hard cubic-and-higher x-denominator Si/Ci shapes decline (they
  stay unsolved, not wrong). The complex-argument
  `ExpIntegralEi`/`SinIntegral`/`CosIntegral`, negative-order incomplete Γ and
  `Shi`/`Chi` kernels exist (branch details: `docs/rubi/RUBI.md` §5 R18/R21).
- **CE-170.8** Chapter 5 residual: only the ₃F₂/`HypergeometricPFQ` terminal
  forms remain (the one `not-evaluable` row in each of 5.1 and 5.2 at s120 seed
  5 is such a form). They need a generalized ₚFq head, which CE does not have
  (out of scope). Chapter 7 has the same shape on a smaller scale, and the
  hyperbolic fallback covers it.
- Chapter 6 residuals (mostly shared capability):
  - **CE-170.9** Function-of-exp rows with a residual of degree 4 or more
    (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
    `Coth⁵/(a+b·Coth)`): the symbolic quartic-or-higher residual needs a real
    root finder. 7 more rows are expected `Unintegrable`.
  - **CE-170.10** Extend the shared linear-factor partial fraction
    (`expandRationalOverLinears`) to repeated roots (`Csch²`/`Coth²` →
    `(y−1)²(y+1)²`) and complex roots (`Tanh` → `y²+1`). #243, #408 and #455
    decline today; the change also reaches the similar trig rows of the
    single-angle trig-to-exp fallback (`singleAngleTrigExpFallback`).
  - **CE-170.11** By-parts machinery for rows whose numerator hyperbolic is a
    power in the additive denominator (for example `a+b·Sinh⁴`).
  - **CE-170.12** The bare `(a+b·Sinh²)^(3/2)` even-parity shape (EllipticE/F),
    the ₚFq row #518, and the `√(Sinh·Tanh)`/`√(Cosh·Coth)` quarter-power rows
    (6.7.1 #560/#563).

## Numeric evaluation and special functions

### CE-186. Oscillatory integrals whose lobe sums have no period or converge slowly are `NaN`

**Status:** ready; capability, small. User decision 2026-10-04: until a method
gives a value, the result stays `NaN`; do not let these integrals fall back to
Monte Carlo. Issue #405. Approved 2026-11-01.
**Witness:** corpus; Proposed capability with issue #405; result is an honest `NaN` by user decision.

Both cases are in `integrateSemiInfiniteOscillatory`
(`numerics/oscillatory-quadrature.ts`). Monte Carlo gave wrong values with small
errors for them (`-0.033 ± 0.027` for `∫_{100}^∞ sin t·cos 3t/t dt`, true value
`-0.0019`; `0.072 ± 0.018` for `∫₀^∞ sin t·cos(√2·t)/t dt`, true value 0).

- **CE-186.1** Two frequencies whose ratio is not rational:
  `∫₀^∞ sin t·cos(√2·t)/t dt = 0` and `∫₀^∞ sin t·cos(√3·t)/√t dt` are `NaN`.
  The lobes of such an integrand have no period, so their sums are not
  accelerated by the ε-algorithm (the values move irregularly) or by the Levin
  u-transform of the sums of one period of lobes (there is no period). After
  2000 lobes, the routine returns `NaN` rather than a value with an error that
  is too small. `(sin t + sin(√2·t))/t` has a value after 2000 lobes, with an
  error of `6.8e-6`.
- **CE-186.2** A lower bound far from 0 with lobes that repeat a pattern: from
  0, `∫ sin t·cos 3t/t dt`, `∫ sin t·(2 + cos t)/t dt` and
  `∫ (sin t + sin 2t)/t dt` have a value. From `a = 100`, `1000` or `10⁴` they
  are `NaN`. The sums of their lobes converge as `1/k`, so the ε-algorithm does
  not find the integral, and they need the Levin u-transform of the block sums
  (`blockLevin`). Far from 0, the block sums decrease slowly in the index `j` of
  the block (as `(a/W + j)^(−2)`, with `W` the width of a block), the estimate
  of the exponent of the decrease is less than `LEVIN_MIN_BLOCK_DECAY`, and no
  Levin value is returned. `∫ₐ^∞ sin(t/2)·cos 2t/t dt` has a value from these
  bounds, because its ε values converge. A Levin u-transform with the index
  shifted by `a/W` was tried and not kept: for `sin t·(2 + cos t)/t` from `10⁴`
  its value was `1.8e-4` from the integral, with a range of its values of only
  `7e-8`.

A method that does not depend on the lobes is necessary. Possible methods:

- write the integral as `∫ₐ^X f + ∫_X^∞ f` and find the tail from an asymptotic
  expansion of `f`;
- accelerate the partial integrals `∫ₐ^X f` as a function of `X` (Sidi's mW
  transformation with a period of each frequency);
- when the integrand is a known product of sines and cosines, write the integral
  as the sum of the integrals of each frequency.

## Compilation

### CE-715. The `bigint` compile mode: the shapes it declines

**Status:** ready; capability. The mode `compile(expr, { mode: 'bigint' })`
on the `javascript` target computes integer values as JavaScript `bigint`
values (`docs/COMPILATION-MODEL.md`, "Compile modes"; spec
`docs/plans/2026-10-31-ce715-bigint-compile-mode.md`). The sub-items below
are the shapes that the mode declines (the expression then runs on the
interpreter), with a priority by how often each occurs (AGENTS.md: a decline
is a defect). Example: with `n: integer`, `DigitSum(n)` declines with the
diagnostic code `bigint-lane`. The reply to GitHub issue #503 is deferred by
the user.
**Witness:** corpus; Declines of the `bigint` mode, named for GitHub #503; check that #503 needs these shapes, else drop as declines.

- **CE-715.2** (medium) A rational `Range`/`Sum`/`Product` bound (`Sum(i, i = 1..n/2)`
  is `3` at `n = 5`).
- **CE-715.3** (high) Integer-typed heads not on the allow-list (`DigitSum`,
  `IntegerDigits`, `IndexOf`), boolean heads other than the comparisons and
  `IsPrime` (`IsEven`), and every string head, `String` included: the
  interpreter prints `String(n^2)` at `n = 10^15` as `"1e+30"`, and the
  JavaScript `String` of a `bigint` prints all the digits, so `String` needs
  a helper that prints as the interpreter does.
- **CE-715.4** (low) A binding typed `integer | infinity` as a lane input.
- **CE-715.5** (medium) A `bigint` output form for `broadcast()`,
  `broadcastAsync()` and the stored batch loaders.
- **CE-715.7** (low) The Python target's `Rational` lowering as an exact
  `fractions.Fraction`.
- **CE-715.8** (medium) Control and comparison shapes that the lane analysis
  declines in the first version (user decision 2026-10-31): `Piecewise` (its
  engine type is not a number type, so its branches need their own refined
  type), a chained comparison (`a < n < b`), a `Block` with more than one
  statement, an `If` with no else branch, and a `Which` with no final `True`
  clause. With `n: integer`, `Piecewise(…)` over integer branches runs on the
  interpreter in the mode today.

### CE-218. Compiled absence checks need a representation of `Nothing` distinct from `Missing`

**Status:** waits for user (design); capability. User decision 2026-10-20: keep refusing
omission-capable sources. Plan:
`docs/plans/2026-10-20-bare-tuple-record-any.md`.
**Witness:** corpus; Lifts refusals of `Nothing`-capable sources (Tycho 332).

`IsMissing(x)` and non-final operands of `Coalesce` refuse compilation when
their types admit `nothing`, including `any`, `nothing`, and unions such as
`integer | nothing`. The current target representations cannot tell an omission
(unit) result from an absent datum. Treating both as missing would break the
rule that `Nothing` passes through. Constant expressions may fold before this
check; a final fallback is returned without an absence test.

`Map`, `Filter`, predicate-form `Count`, `Covariance`, `PopulationCovariance`,
`Correlation` and the numeric aggregates (including the seeded `Multiply` fold
that represents `Product(collection)`) also refuse compilation when the source
element types admit `Nothing`. Single-source paired statistics inspect tuple
coordinates. Tuple slots and union alternatives are checked before their element
types can absorb omission. Data tuple construction and `Zip` refuse compilation
when coordinates may be `Nothing`. A `Map` with a broad result type compiles
when the callback body proves that every return path excludes omission; an
opaque callback result stays `any`, and an input type cannot stand in for it. So
an unconstrained `collection<any>` needs an annotation that excludes `Nothing`
(for example `list<real>`) to compile. Under the user decision, the unannotated
Tycho 332 and recursive gasket programs stay refused; their numeric collection
annotations compile and give the same 224 circles.

Separate decisions, not part of this item: structural conversion (`TupleFrom`
still omits an immediate `Nothing`), ordinary arguments, the unit/empty-tuple
type, and the capture of bindings (question Q11 of
`docs/plans/2026-10-20-bare-tuple-record-any.md`).

- **CE-218.1** A target that lifts the refusal must represent `Nothing`
  separately from `Missing`/`Undefined`/numeric absence, preserve it across
  inputs, intermediate values and results, and implement checks and fallbacks
  that leave it untouched. Cover interpreter/compiled parity and side-effect
  counts. Coordinate with the raw view representation and serialization of the
  plan above. This is a compiler capability, not a change to the omission
  policy. An unseeded `Reduce` over an empty list is `Nothing` in the
  interpreter and `NaN` when compiled (`Reduce([], Multiply)`), the stand-in for
  `Nothing` pinned in `compile.test.ts`.
- **CE-218.2** Tuple-call lowering can leave an unannotated pass-through result
  typed `any` even when the argument is a numeric tuple, so the tuple
  constructor refuses compilation. Annotating the parameter with its numeric
  tuple type restores compilation. A better proof here does not need a change to
  the slot policy, and must not treat omission as missing data.

### CE-233. Integer and string operators that the JavaScript target does not lower (Epsil corpus)

**Status:** ready; capability. Approved 2026-11-01.
**Witness:** corpus; Epsil corpus report counts declines from missing integer and string lowerings (`IntegerDigits` 7, ..); a corpus decline. State is proposed.

In the Epsil corpus report (`npm run epsil:corpus-report`, run of 2026-10-06),
46 of the 59 compile declines come from a missing lowering. Operators the corpus
uses that the JavaScript target does not lower, by number of programs blocked:
`IntegerDigits` 7, `StringSplit` 3, `Set` 3, `Simplify` 3, `Divisors` 2,
`UnicodeScalars` 2, `NumberFrom` 2, `N` 2, `DigitSum` 2, and one each of
`Iterate`, `IntegerString`, `Permutations`, `LinearSolve`, `FactorInteger`,
`PolynomialQuotient`, `Factor`, `Solve`. The symbolic ones are expected; the
integer and string ones are candidates for a lowering.

The other declines are typing refusals: `At` on a value not provably an indexed
collection, 4; `String`/`Characters` on a value not provably text, 5; a `Loop`
or `Sum` bound that is not a finite number, 4; multi-index `At`, 2; a `Find`
over an infinite range; a `Sort` of characters; a mixed-string ordering; a
`Filter` over a value that may be text.

### CE-568. CSE: share a pure call across the statements of a `Block`

**Status:** ready; performance. Approved 2026-11-01.
**Witness:** corpus; Proposed performance idea names Tycho `hyvhlz4chj` but no measured cost.

Each statement value of a `Block` is its own CSE region, so a pure call repeated
in two statements is computed once per statement. Tycho `hyvhlz4chj`: the body
of `f_Bm` (a Desmos `with` lowered to a `Block` of two statements) calls
`p_rand(n + s_eed, n, n)` in both. Sharing across statements needs the temporary
to be bound before the first statement and to stay valid across any assignment
the statements make to a symbol the call reads.

### CE-253. `Sum(At(P, Range(a, b)))` materializes the range on the JavaScript target

**Status:** ready; capability. Approved 2026-11-01.
**Witness:** corpus; Proposed optimization counts 24 corpus `Array.from` sites but no measured cost and no wrong value.

The 24 `Array.from` range sites in the corpus are all places where the range is
needed as a list (7 gather indices, 15 spread elements, 2 broadcast operands);
no site needs only a counting loop. The 7 gather sites need a gather/reduce
fusion in `emitCollectionReduce` (`javascript-target.ts`), which is a new
lowering.

### CE-264. Clause sets that dispatch on `infinity`, `nan` or `non_finite_number` do not compile

**Status:** waits for user (design); capability.
**Witness:** crafted; `g(1/w - 1/w)` with an `infinity` clause; the set declines today.

Compiled float arithmetic does not keep a pole. The interpreter's `~oo - ~oo` is
`~oo`; compiled, it is `Infinity - Infinity`, which is `NaN`. So a guard on a
produced value asks a different question than the interpreter. Example: with
`g(a: infinity) = 1; g(x: number) = 0`, compiled `g(1 / w - 1 / w)` at `w = 0`
answers 0 where the interpreter answers 1. `jsClauseParamGuard`
(`src/compute-engine/compilation/base-compiler.ts`) therefore declines the whole
clause set for those tiers and for the non-finite VALUE types, and the set runs
interpreted (pinned in `test/compute-engine/multi-clause-compile.test.ts`).

A change to the guard does not fix this (measured 2026-08-30). Compilation needs
either a float encoding in which a pole stays a pole through arithmetic, or a
compiler that never folds a pole into a plain JavaScript number.

### CE-269. A DAG-shared symbol value above the fold-size guard does not compile

**Status:** ready; capability, low priority. Approved 2026-11-01.
**Witness:** corpus; Tycho census: four terrain triangle rows of `art/nxlddeh5zv` decline at the fold-size guard; a corpus decline.

On the `javascript` and `interval-js` targets, a symbol's compound pure value is
emitted once as a preamble local (`ensureFoldedValueEmitted`,
`base-compiler.ts`). The inline targets (Python) still fold a value into the
emission at each reference, so `MAX_FOLD_EXPANDED_NODES = 20 000`
(`expandedFoldSize` / `assertFoldableSize`, `base-compiler.ts`; fail closed by
decision 2026-08-23) refuses a pathological DAG-shared tower there. The public
`fallback: true` route falls back to interpreted evaluation; the direct
registered-target route throws (pinned in `compile-fold-size-guard.test.ts`).

- **CE-269.1** Inline targets: add the same preamble binding, or a
  runtime-binding channel (a `_SYS` engine-value lookup) so a compiled member
  does not fall back. Tycho's ledger prefers the runtime-binding channel. Tycho
  states no urgency: it now binds document functions as by-reference lambdas,
  and the item-225 witness (`art/nxlddeh5zv`) no longer runs out of memory, but
  its interpreted member sweep still takes more than 300 s on the fallback.
- **CE-269.2** Sharing INSIDE one symbol's value, on every target. The preamble
  binding is per SYMBOL. Tycho publishes the height map of that document with
  the helper bodies substituted (measured 2026-09-16 on Tycho `03ebe4fc8`): the
  value of `h_eightMap` is one expression of 236,663 distinct nodes, in which
  the dozen reads of each level share the argument of the level below; as text
  it is 25 billion nodes, and `b_ase` holds no value. On the JavaScript target
  the four terrain triangle rows decline at the guard (census 2026-09-16).
  Evaluating the closed value first does not help: at size 64 the literal is
  8,192 points, above the guard alone. Fix: a runtime-binding channel for a
  symbol value, or a binding per node for each sub-expression with several
  parents.

### CE-270. Compile declines in the code-generation census of CE 0.171.0

**Status:** ready; capability. Plan:
docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md (§9). Approved 2026-11-01.
**Witness:** corpus; Census of 0.171.0 on the Tycho corpus lists declines per target (270.1 to 270.4); corpus declines.

Declines (distinct records) per target on the all-states Tycho corpus, CE
0.171.0, measured 2026-10-27 (757 documents, 17,782 records): javascript 35 in
28 documents, glsl 68 in 36, interval-js 89 in 39. At CE 0.128.13 (2026-09-16,
734 documents) they were 112 in 38, 148 in 55 and 188 in 66. Run:
`npx tsx scripts/audit-ce-codegen.mts --all` in Tycho. Open candidates:

- **CE-270.1** JavaScript scalar arithmetic over a list-valued operand: 5 rows
  in 3 documents (was 33), all a point list plus a scalar or a list index
  (`0.7C[C_i] + A`, `Q(T) + \frac{1}{3}[\operatorname{PointList}(0,0), D]`)
  (CE-268).
- **CE-270.2** GLSL `At` over a collection with no static length: 12 rows in 7
  documents (was 32).
- **CE-270.3** GLSL `Integrate`: 1 row (was 15).
- **CE-270.4** interval-js rows over a collection: 14 rows in 5 documents (a
  condition that may be a list, a seeded `RandomChoice` list, a `Which` over a
  collection condition, an absent position) (CE-240).

Other classes in that run: GLSL recursive user functions (9 rows), GLSL constant
collections over 256 elements (7), interval-js ordering over a complex operand
(20), interval-js operators with no lowering (27 rows: `Mandelbrot`, `Julia`,
`GeometricVector`, `D`, `Range` in a comprehension source, `Real`), and the rows
of CE-564. `D`, `PointList` and the complex rows on the interval target are
design limits, not candidates.

### CE-272. Element-wise `Which` over fixed-size collections declines on `glsl` and `interval-js`

**Status:** ready; capability. Tycho item 206.
**Witness:** corpus; 272.2: Tycho `5qn5kcrszu`, 6 javascript records decline (Tycho item 206); 272.1 (no witness) and 272.3 (zero demand) are drop.

The evaluator broadcasts `Which` element-wise over collection-valued operands,
and the `javascript` target lowers the same shape (`compileJSSelection`,
`javascript-target.ts`). The `glsl` and `interval-js` targets fail closed: the
interval target holds one interval per quantity (no collection values, by
design), and the GPU element-wise selection (`compileGPUSelection`,
`gpu-target.ts`) lowers only static `vec2`–`vec4` shapes.

The pre-pass `fixed-width-unroll.ts` covers part of this (pinned in
`test/compute-engine/compile-elementwise-selection-unroll.test.ts`). It pushes a
literal index through a `Which`/`If` whose first condition is a list, and on
through the ordering relations, `Equal`/`NotEqual` against a scalar, `Mod`, the
other element-wise heads and a literal `Range`, down to the literal list. It
also writes a `Which`/`If` whose first condition is a WIDE list built from
non-constant lists (five or more elements, at most 64) as the list of its
per-position selections. This covers `ccoc40kfhj` (24 `interval-js` records).

- **CE-272.1** A selection with no default clause and a point arm is not
  covered: a position that no clause selects is `NaN` element-wise but `Missing`
  for a scalar selection.
- **CE-272.2** A `Which` in statement form inside a lambda that the pass does
  not enter (`5qn5kcrszu`, 6 `javascript` records).
- **CE-272.3** Tycho's Voronoi second-minimum idiom
  (`Min(Which(d == m, 10^9, True, d))`, with `d` a broadcast expression over a
  20-point `PointList` literal): its condition is built from a list of POINTS
  (`|P − (x, y)|`), and the width walk reads lists of scalars only. The
  `javascript` target compiles this shape and gives the correct second minimum,
  so the urgency is low. Tycho measured zero demand on 0.116.1 after a fix on
  its side.

The general design is target-independent: a static broadcast unroll before
target lowering. When every collection leaf in the `Which` clauses is statically
enumerable (materialized `List`/`PointList`/`Range` literals) with one common
length N, project the broadcast expression per element and rewrite to N scalar
selections. `compileGPUExtremum` already folds compile-time component lists of
any length, and the interval `Min`/`Max` handlers fold n scalar arguments. The
projection must fail closed when a collection subterm is not statically
enumerable, when lengths disagree, or when an index-sensitive operator (`Sort`,
`Unique`, …) sits between the leaf and the selection.

Caution: on `glsl`, `Power`/`Square` of a vec operand with a scalar exponent
fails closed on its own (`_gpu_powi` is scalar-only, and the `pow` builtin
requires matching genTypes), pinned in
`test/compute-engine/compile-gpu-shape-gate-holes.test.ts`. Unrolling to SCALAR
selections avoids it; a design that lifts the vec-width cap meets it.

### CE-280. Compile-target coverage: heads and shapes that decline on GLSL

**Status:** ready; capability. Ledger: do one sub-item per session. Approved 2026-11-01. Revised 2026-11-08 for the GLSL fragment (`docs/plans/2026-11-08-glsl-fragment-spec.md`): the WGSL target is dropped, and CE-280.1 (`Integrate` on glsl) and CE-280.5 (dictionary and string-key forms of `At`) are removed, since the fragment puts quadrature, dictionaries and strings outside the target by contract. The sub-items that remain are inside the fragment.
**Witness:** corpus; the `At` and `PointList` sub-items drop (no witness; 280.9 allowed).

A decline on a shader target demotes the row from GPU to CPU. Counts are from
the same Tycho corpus as the JavaScript coverage ledger.

Width ceiling, accepted by CE and the consumer: an expression-level shader value
is a vec2 to vec4, so rows of arbitrary width (a 10-curve family, a 900-element
board) have no `vecN` to live in. The consumer handles that with instanced
draws. If profiles ever justify one shader body for such rows, the ask is
array-uniform loop codegen, and it needs witnesses first.

- `At` on GPU: the scalar-index and literal-gather tiers over statically-sized
  numeric bases are done. The design and the D4 disposition table are in
  `docs/COMPILATION-MODEL.md`; do not derive the table again. Do not retire the
  26-state count until the consumer measures again. Remaining, on demand:
  - **CE-280.2** Static-count dynamic gather (near-zero cost: the same helpers
    in a constructor; a witness count was requested from the consumer).
  - **CE-280.3** Gather with K > 4 (width ceiling).
  - **CE-280.4** Gather with K 0 or 1 (the pinned 1-element-list contract has no
    shader shape).
  - Not work: runtime-valued boolean masks (the result length is not static, so
    there is no shader value shape) and bases or index lists of unknown length.
- `PointList`/`PointZ`: rules in `docs/COLLECTIONS-MODEL.md`. GPU construction
  stays fail-closed by decision (no runtime-length GPU expression values).
  Remaining, all on demand:
  - **CE-280.7** Components that are not `isListType` (tuple, set, a union with
    a collection) still decline on JavaScript. The lowering is narrower than the
    typing on purpose: such a slot has no per-point representation.
  - **CE-280.8** `hasPointElementType` (`collections.ts` ~684) accepts only
    `{kind:'tuple'}` nodes, not the bare `'tuple'` string (same family as the
    tuple component of `PointList`, refused since 2026-10-18).
  - **CE-280.9** Projecting an EMPTY point list diverges: compiled `[]`,
    interpreter absence. The evaluated empty transpose types `list<never>`, so
    the point-ness cannot be recovered. Pinned as a known parity edge in
    `pointlist-compile-zip.test.ts`.
  - The consumer must count again how much of the 11 states / 36 members + 2
    states closed. Do not mark this bucket resolved on CE numbers.
- **CE-280.10** Complex-element collections in the generic shape check.
  `gpuOperandShape` reads a list of complex elements as `scalar` (through the
  operand fallback of `isComplexValued`), so the generic check
  (`gpuIsComponentwise` / `gpuOperandShape` / `gpuCheckOperandShapes`) has no
  effect for them. The unary fan-out declines them explicitly; the generic
  codegen needs its own complex-element rule.
- Not a gap: a loop-form `Sum`/`Product` inside a conditionally evaluated arm
  stays fail-closed (7 members / 1 state). GLSL's `?:` short-circuits, so
  hoisting a loop out of an arm that it never feeds would shift every later
  `Random()` draw in the shader. The other option (an `if`/`else` lowering with
  a temporary) needs a second witness; the count is one.

### CE-1110. GPU targets: read a parameter declared `real` as an argument that is not NaN, for `Max` and `Min`

**Status:** waits for user (approval); performance, S. Recorded by the user
2026-11-07. Issue `CE-1105` (closed, not a defect) holds the observation.
**Witness:** plausible; the prelude function `tone` of the Tycho showcase entry
`buddhabrot`.

The GLSL and WGSL targets emit the NaN-safe helper `_gpu_max` (or `_gpu_min`)
in place of the built-in `max` when they cannot prove that each operand is
finite (`compileGPUElementExtremum` in
`src/compute-engine/compilation/gpu-extrema.ts`). For
`max(0, v)` in the body of a user function `t`, called as `t(z)` with `z`
undeclared, the current source gives:

| How `t` is written                                   | Body emitted          |
| ---------------------------------------------------- | --------------------- |
| Function literal with `["Typed", "v", "'real'"]`     | `max(0.0, v)`         |
| `t` declared `(real) -> real`                        | `_gpu_max(0.0, v)`    |
| `t` declared `(real<-1..1>) -> real`                 | `max(0.0, v)`         |

A declared signature gives a parameter a finite fact only when its type has two
finite bounds (`gpuDeclaredParameterRanges` in
`src/compute-engine/compilation/gpu-finite-proof.ts`). A bare `real` is not
enough for the general finite proof, because the argument is computed in f32:
`exp(x)` is a `real` that is `+∞` in f32 for `x > 88.7`, and a sum, product or
quotient of it can then be NaN.

`Max` and `Min` need less than a finite operand: the helper exists only for a
NaN operand, and `max(0.0, +∞)` is defined. A NaN argument is outside the type
`real`, so its compiled value is unspecified. The change: for the extremum
helpers only, accept a parameter that the host declared `real` (or any subtype
of `real`) in the signature, and keep the bounded-range rule for every other
use of the finite proof. Make the Function-literal form follow the same rule,
so that the two ways of writing `t` give the same code. Measure: the number of
`_gpu_max` and `_gpu_min` helpers in the Tycho corpus before and after, and 0
changed values.

### CE-1149. The compiler selects the lowering of a call from the definition of the call, not from its name

**Status:** waits for user (approval); capability, M. Recorded by the user
2026-11-08. Follows CE-1109 (`docs/plans/2026-11-07-ce1109-definition-identity.md`).
**Witness:** plausible; the Epsil program
`function Floor(x) { std::floor(x) + 1 }`, the use of `std::` that
`src/epsil/docs/naming.md` describes.

Since CE-1109, a canonical call is bound to its definition: `std::floor(y)`
is a `Floor` call bound to the library operator, also inside a user function
named `Floor`. The interpreter reads that definition. The compiler does not:
it selects the lowering of a call by the name of its head in the scope where
the compilation runs (`lookupApplicable()` and `shadowsLibraryName()`). When
that name reads another definition than the one of the node, the compilation
declines and the result falls back to the interpreter
(`compileReadsOtherDefinition()` and `shadowedLibraryLoweringError()` in
`src/compute-engine/compilation/compile-definitions.ts`). The values are
correct; the declines are the cost. With the current source:

| Program                                                                                | Compiles | Value at `y = 2.5` |
| -------------------------------------------------------------------------------------- | -------- | ------------------ |
| A user `Floor` is `x ↦ std::floor(x) + 1`; compile `Floor(y)` in its scope             | no       | 3 (interpreter)    |
| The same scope; compile `std::floor(y)`                                                | no       | 2 (interpreter)    |
| A library `Sqrt(y)` boxed first, compiled in a scope that declares a user `Sqrt` with a `compile` handler | no | 2 at `y = 4` (interpreter) |
| A call of that user `Sqrt`, compiled after its scope is popped                         | no       | 104 at `y = 4` (interpreter) |

The change: the compiler reads `node.operatorDefinition` (or the value
definition of a user function) to select the lowering. A call bound to the
library operator gets the library lowering of the target (`target.functions`,
`target.operators`, the named lowerings such as `If` and `Sum`). A call bound
to a user operator definition gets its `compile` handler, or declines when it
has none. A call bound to a user function compiles that function. Then
`compileReadsOtherDefinition()` and the by-name branches of
`shadowedLibraryLoweringError()` are removed.

The current source has 16 calls of `lookupApplicable()` and
`shadowsLibraryName()` in 11 files of `src/compute-engine/compilation/`
(`compile-expr-handlers.ts`, `compiler-core.ts`, `compile-operators.ts`,
`compile-user-functions.ts`, `compile-protocol-dispatch.ts`,
`builtin-callback.ts`, `compile-complexness.ts`, `compile-real-analysis.ts`,
`compile-definitions.ts`, `javascript-target.ts`,
`interval-javascript-target.ts`). Not each one selects a lowering: some read
a free variable or a parameter. The first step is a census of these calls
that sorts them into the two groups.

Measure: the four programs of the table compile on the JavaScript target with
the interpreter's values; the number of lines removed from the compilation
directory; the corpus declines before and after (not measured when this entry
was written), and 0 changed values.

## LaTeX parsing and serialization

### CE-297. The lenient grammar makes reading choices that a host cannot detect

**Status:** ready; capability. User decision 2026-10-01: a parenthesized
name is never a function head, and lenient `+-` is `±`. Plan:
`docs/plans/2026-10-01-lenient-ambiguity-codes.md`. Approved 2026-11-01.
**Witness:** corpus; Tycho request (repro file, Tycho reply) that "CE accepted"; the header makes a Tycho request `ready`, the label says `proposed`.

Goal: a host that converts pasted plain text, such as Tycho's
`plainTextToLatex`, should not need its own parser; the lenient grammar
(`ce.parse(text, { strict: false })`) should give it what it needs. Tycho's
converter keeps a first stage (a closed list of tokens and an adjacency table)
because the lenient grammar reads almost any text and gives no signal when it
picks one of two common readings. Tycho will remove that stage if CE publishes
the list of reading choices the lenient grammar makes, with a diagnostic code
(one `ambiguous-*` group) for each choice that has another common reading. Tycho
counts a choice with no code as a CE defect, and CE accepted this commitment.

Of 300 inputs that the converter refuses
(`tycho/scripts/repros/2026-10-01-paste-refused-inputs.json`), the lenient
grammar on CE main reads about 210 with no signal. The full reply is in Tycho's
`docs/COMPUTE_ENGINE.md`, "CE reply 2026-10-01 to answer 4".

- **CE-297.1** Publish the list of reading choices, and give a diagnostic code
  to each choice with another common reading. The classes, with examples: the
  end of an unbraced exponent (`e^2pi`, `x^2y`); an implicit subscript (`x2`); a
  comma outside brackets (`1,5`); `5!=120`; a name, a space and a number
  (`x 2`); a function name with no parentheses before several factors
  (`sin x y`, `log 2 x` = `log_2 x`); a document function with no parentheses
  (`f x`); list labels (`1. y = x`); equation numbers (`y = x^2 (2)`);
  juxtaposed groups (`(a)(b)`); the extent of a radical (`3√8`, `√2π`); `+-` and
  `±`; `<-`; `a..b..c`; `in` after an equation; `Δx`; chains of `=`; bars that
  pair two ways; dates and phone numbers; `atan3(y)`; Greek capitals that look
  like Latin letters.
- **CE-297.2** `(a)(b)` is the call `a(b)` in the canonical form (strict too).
  This may be a defect rather than an ambiguity (see the decision above).
- **CE-297.3** `±1` is `Measurement(0, 1)`. This may be a defect.
- **CE-297.4** `+-` is two signs (see the decision above).
- **CE-297.5** `mod`, `pow`, `trunc`, `Re` and `Im` are not lenient function
  names. This may be a defect.

## Epsil

### CE-311. Make cross-program redefinition an error on the Epsil route and delete the old mechanism

**Status:** ready; task. User decision 2026-08-18. Plan:
`docs/plans/2026-08-18-checkpoint-restore-design.md`. Approved 2026-11-01.
**Witness:** corpus; User decision 2026-08-18 approves the work and the text says the stage can start; label `proposed` conflicts.

User decision 2026-08-18 (Tycho agrees): a cross-program redefinition of types,
protocols, conformances or same-signature clauses becomes an ERROR on the Epsil
(`executeEpsil`) route only. The box route and the host API keep the current
replace/throw semantics permanently: Tycho's recompute passes re-assert
declarations through the box route every 300 ms and depend on idempotency. The
notebook edit gesture uses the engine `checkpoint()`/`restore()` API, which is
shipped (contract in `docs/CHECKPOINT-MODEL.md`; tests include
`checkpoint-in-scope.test.ts` and the differential harness).

- **CE-311.1** The last stage: flip the Epsil route to strict and delete the
  superseded machinery (about 1,384 source lines, 1,891 test lines and 92 test
  changes; §5 of the plan). Tycho's requirement is met: its notebook restores
  the checkpoint before the first changed cell and replays the cells from there
  since 2026-10-16 (Tycho `docs/COMPUTE_ENGINE.md`, section "Checkpoint /
  Restore"). So this stage can start. Until it lands, both mechanisms exist
  together.

## Performance

### CE-624. The interpreter cannot compute a nested integral of a user-function call

**Status:** ready; capability. Found 2026-10-28 while fixing CE-614. Approved 2026-11-01.
**Witness:** corpus; Tycho row 476 definitions; `NIntegrate` gives NaN with jit off.

With Tycho's row-476 definitions (`c(y, D, e) := \int_{-D}^{D} n(x, y, e)\,dx`)
and `L := 0.5`, `.N()` of `\int_0^1 y\,c(y, L, 0.001)\,dy` gives 1.98376 only
through the compiled route; with `jit = 'off'` it stays unevaluated, and
`NIntegrate` gives NaN after about 6 s.

### CE-314. Worker threads for parallel numeric kernels: the Epsil route and the API name

**Status:** ready; capability. User decision 2026-10-20: the Epsil asynchronous
route waits for Tycho's integration feedback. Tycho's feedback is written
(2026-10-24, Tycho commit `74eea7228`; moved 2026-10-26 to
`~/dev/tycho/docs/COMPUTE_ENGINE_LOG.md`, section "Two standing Tycho-side
follow-ups closed on 2026-10-24 and 2026-10-25": `FindFit.evaluateAsync()` on CE
0.164.0 and `broadcastAsync()` on CE 0.165.0). Tycho has nothing pending on this
entry. Its asks (a time limit and event-loop turns on the asynchronous routes,
`inline: false`, `willUsePool()`, `shippable`, and the `route` of a batch or a
fit) are done; CE-430 is what remains of them. Plan:
`docs/plans/2026-10-20-worker-kernel-pool.md`,
`docs/plans/2026-10-20-findfit-global-grid.md`.
**Witness:** corpus; Ready with user decision 2026-10-20 in status; Tycho row 441; only CE-314.1 (c) remains open.

A compiled function evaluated over an array of inputs, and the starts of a
`FindFit` global search, are pure-number work that worker threads run in
parallel. Steps 1 to 5 of the design are done: `broadcast`/`broadcastAsync` on
compiled results, `INTERVAL_KIND`, `createIntervalRuntime`, `createKernelPool`,
`ce.workers`, the `kernel-worker` entry, and `FindFit.evaluateAsync()`, which
scans on `ce.workers` (1,000 rows over `[0.3, 628]` in 65 ms on 8 workers, 233
ms inline). The default pool size is `hardwareConcurrency - 1`, capped at 8.
There is no whole-engine worker protocol for now.

Sizes measured 2026-10-20 (`benchmarks/workers/*.mts`): an implicit plot of
512×512 interval cells takes 152 ms serially and 27 ms on 8 workers; a 5-point
fit or a 2000-column plot takes under 10 ms and cannot gain. Tycho caps fits at
10 000 rows and samples 500 for the global search.

- **CE-314.1** The Epsil asynchronous route. Epsil has no keyword for parallel
  execution: the engine decides from purity, compilability and size, as it does
  for compilation (design section 5.7). Tycho row 441 (filed 2026-10-24, Tycho
  commit `aa31fffac`) asks for it: a notebook Epsil cell runs through
  `executeEpsil` on the main thread under a 2 s limit, so one large batch of
  independent values (a map over 100 000 elements, a large sum, a grid of
  samples) cannot finish. Ask: run such a batch on `ce.workers` with the same
  result as on the calling thread, and an asynchronous run of the program with
  an abort signal. READY when an Epsil cell that maps a costly function over 100
  000 elements runs on the pool from an engine inside a worker, with the same
  values and faster than on one thread. Measured 2026-10-24:
  `sum(map(x => N(sin(x) + x^2), 1..100000))` takes 4.3 s on one thread with the
  default precision, because the marked tier of the `Map` auto-compilation
  (`map-auto-compile.ts`) declines when the engine prefers bignums; with
  `ce.precision = 'machine'` every element runs compiled and the program takes
  0.2 s. The pool route must answer which precision it runs at. Done 2026-10-24
  (first step): `executeEpsilAsync(ce, source, { signal })`
  (`src/epsil/execute-epsil.ts`), and `evaluateAsync` handlers for `Assign` and
  `Declare`, so that `let fit = findFit(…)` takes the asynchronous route of its
  value. Left: (a) the pool route of a large `Map`/`Sum` drain. User decision
  2026-10-24: machine precision only (the rule of the marked tier). A prototype
  was written and measured on 2026-10-24 (not landed; worktree
  `/tmp/wt-ce3141`): before the drain of `Sum(Map(f, xs))` on the asynchronous
  route, the pool computes the compiled `f` over the source (`Apply(literal, x)`
  compiled to a `broadcast` result), and the runner of `map-auto-compile.ts`
  reads the values by position. Values identical to one thread, but no useful
  gain: for 100,000 elements at machine precision, `N(sin(x) + x^2)` took
  209–235 ms on one thread and 241–259 ms with a pool of 4; bodies of special
  functions 257 → 241 ms and 364 → 290 ms. A compiled element costs under 1 µs;
  the drain itself (the runner's checks, boxing the value, adding the term)
  costs 2 to 3 µs per element on the calling thread. The drain cost is now gone
  for `Sum` (2026-10-24: the sum of a compiled `Map` is computed on doubles,
  about 45 ms for 100,000 elements), so the pool route could pay only for a
  costly compiled body. User decision 2026-10-24: a body with a loop or an inner
  collection stays interpreted, because its compiled values can differ from the
  interpreter's `N` in the last digits (measurements: an exact loop sum
  `1.066407470350872` against the compiled `1.0664074703508735`, an exact
  product `231` against `230.99999999999994`). So the pool route of (a) is NOT
  DONE, by decision, and its prototype is not kept. (c) While
  `executeEpsilAsync` waits on a statement, the engine keeps the fields of the
  run (`_epsilBatchId`, `_epsilStatementResultHook`, `_epsilDeclarationRoute`),
  because the asynchronous parts of the statement read them after their own
  waits; other work on the engine during the wait would see them, so the
  documentation forbids it. Lifting the limit means carrying the three fields
  with the asynchronous evaluation, as its context stack carries the deadline
  frame (`deadlineFrameOf()`, `evaluation-epoch.ts`). Part 2 of row 441 (a pool
  for an engine inside a dedicated worker) needed no change: tested in Node and
  in three browsers on 2026-10-24
  (`test/compute-engine/ce-314-3-nested-pool.test.ts`,
  `benchmarks/workers/nested-pool-browser-probe.mjs`) and documented in
  `cortexjs.io/docs/compute-engine/13-guide-compile.md`.
- The name stays `broadcast`/`broadcastAsync` (Tycho's feedback 2026-10-24: "one
  formula, many points"; `runMany` says less).

### CE-334. Each call of a user function invalidates every generation-keyed cache

**Status:** ready; performance. Decision 2026-09-24: no general per-call cache
design now; reduce the per-call costs instead. Approved 2026-11-01.
**Witness:** corpus; Tycho document `hyvhlz4chj`; same cause as CE-321.

`invoke` → `declareParameterActivation` declares the parameters of the function
in a new activation scope, and the `declare` state event advances the `any`
cache axis. So a value cached against `ce._cacheGeneration()` misses after any
user-function call in between.

2026-10-24: a declaration no longer scans or types again a list argument that is
written-out data, so the declaration cost does not grow with the length of the
list. For a scalar call the declaration is about 10% of the call: about 4%
building `_BoxedValueDefinition` and 2.6% `isValidSymbol` on the parameter name.

What remains: the cost of each parameter declaration
(`declareParameterActivation`). The closed form of `Derivative(f, n)`
(`symbolic/derivative.ts`) is now keyed on the definitions it reads, and
`skipBroadcastForVectorOps` returns early when the operator declares no
broadcast exemption.

- Marking every activation declaration `scratch` (it advances no axis) is NOT
  sound: three tests of `lambda-param-collection-inference.test.ts` overflow the
  stack (`countdown(xs)` with the body
  `if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) }`, and the two
  mutual-recursion tests). The body node `Length(xs) == 0` is shared by every
  call and its value cache is keyed on the generation, so the second call reads
  the answer of the first call (4) and the base case is never reached. The type
  and sign of a body SYMBOL are safe (its definition is fixed when it is boxed),
  but a cached answer of a compound body node can read the values of the call
  through `_contextValue()`. A sound version needs the caches of a body node to
  depend on the call: for example a per-activation stamp in the key of the value
  and facet caches of a node that reads a parameter, or an axis that only
  activation declarations advance. See the `declare` case of `axisMaskOf`
  (`engine-configuration-lifecycle.ts`).
- Measured 2026-09-24 at machine precision, with the unsound `scratch` change as
  an upper bound: removing every activation advance saves nothing measurable on
  realistic interpreted workloads (the noise functions of Tycho document
  `hyvhlz4chj` on a 20×20 grid, 18,820 calls: 465 → 442 ms), and 30% on a list
  recursion (77 → 52 ms).
- Profile of the Tycho case (40×40 grid, 1,264 ms, top self time):
  development-only `console.assert` calls 8.0%, `viewOfExpression` 7.4%, a V8
  built-in 5.7%, garbage collection 5.1%, then `isSubtype`, `lookup` and
  `declareParameterActivation` at 1–2% each.

### CE-350. Bignum kernels: remaining speed-ups against mpmath

**Status:** ready; performance, low priority. Approved 2026-11-01.
**Witness:** corpus; mpmath benchmark.

At 1000 digits, `ln`, `exp`, `kˣ`, `sqrt` and `Γ` are as fast as mpmath or
faster.

- **CE-350.1** r-step / rectangular splitting in `fpexp`. The kernel gets about
  3× faster, but it is less than 10 % of `exp(.N())` time, so users see little
  change. Lowest priority.
- **CE-350.2** Base-2 special-function kernels (`gammaln` and others). `Γ` is
  still about 5 to 7 times slower than mpmath at 200 digits. The elementary
  kernels run on a base-2 fixed-point grid, where "round to p bits" is a free
  bit shift. The special functions (`gammalnCore` and the Bernoulli Stirling
  code, `digamma`/`trigamma`/`polygamma`, `zeta`, `beta`) still run on base-10
  `BigDecimal` and pay for the rounding. The port is large: the argument-shift
  product, the Bernoulli-rational series, the reflection formula and the
  `exp`/`ln` glue all move to `bits`-scaled `bigint`s. It should close most of
  the gap. The remaining factor of about 2 is V8 `BigInt` against GMP and needs
  a different bigint backend (for example WASM GMP). The special functions are
  already 130 to 170 times faster than 0.59.0, so this is not a correctness or
  capability gap.

