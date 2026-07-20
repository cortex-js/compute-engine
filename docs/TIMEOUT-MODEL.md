# Timeout Model — Design Note

**Status**: release-N work COMPLETE (§8 steps 1–5 done; see strikethroughs),
including the dual-review fix round: factorization made interruptible
(deadline threading through Pollard rho + `POLLARD_RHO_MAX_ITERATIONS`
budget — the review's one HIGH, a regression the §6.2 rewrite had introduced);
ambient frames now append their synthesized label to `spans`; Rubi swallow
sites rethrow caller-owned timeouts (`isRubiOwnedCancellation` predicate:
swallow own-label/ambient/unattributed, rethrow foreign span labels); Dedup
iterator guarded (with `count` joining the Filter-family swallow contract —
CHANGELOG'd behavior narrowing for >iterationLimit finite sources);
`withTimeLimit` rejects Promise-returning callbacks at the type level.
Model (§2), API (§3), and the §7 decisions are settled and implemented.
Remaining: §8 step 6 — the N+1 removal — plus the N+1 items called out inline
(item-61 block rewrite, precondition-raise deletions, `driver.ts`
`_timeRemaining` check, `numeric.ts:448` comment refresh, §7.3 cache
exemption).

## 1. Current state

There is one *concept* (a deadline: an absolute ms timestamp in
`engine-runtime-state.ts`) but **two places that arm it**:

1. **`ce.withTimeLimit(ms, fn)`** — `index.ts:810-840`. Arms one deadline for
   the whole block: `min(prev, now + ms)`. Restores `prev` in `finally`.
   Monotone — nesting can only shorten.

2. **`withDeadline()`** — `boxed-function.ts:2462-2487`. Wraps *every*
   `evaluate()` / `simplify()` (`:1167`, `:1178`) and arms
   `min(ambient, now + ce.timeLimit)` — **including calls already inside a
   span**.

Everything else only *consumes* `ce._deadline`: ~90 `checkDeadline()` sites and
22 `run(gen, ce._timeRemaining)` sites.

### The defect this generates

Arming point 2 fires inside spans. So the budget silently **refreshes
mid-span** at each nested evaluate. A `withTimeLimit(500, …)` block containing
twenty evaluations does not reliably terminate in 500ms — each inner evaluate
re-arms against `ce.timeLimit`, and whether that shortens or effectively
extends the practical bound depends on how the work is decomposed into
evaluate calls. `CHANGELOG.md:140-144` records a prior fix in exactly this
seam; the seam is still there.

A second, related failure: because `withTimeLimit` uses `min()`, a
`CancellationError` caught inside a span may belong to an **enclosing** budget.
The catching code cannot tell. `CancellationError` (`interruptible.ts:15-43`)
carries only `cause: 'timeout'`, a fixed message, and an optional partial
`value` — no origin information at all.

### Evidence the 2s default is miscalibrated

Nearly every serious consumer raises it: `test/utils.ts:16-24` → 20s (with a
comment that 2s is too tight), distributions → 20s, series → 20s, interpret →
15s, map-auto-compile → 20s. Rubi ignores it and runs its own 10s/30s budget.
A default that every caller overrides upward is not protecting callers.

## 2. Proposed model

**One mechanism: spans.** A deadline is armed only by entering a span, and is
never re-armed while a span is active. Work outside a span is unbounded.

`ce.timeLimit` is **deprecated and removed**. Two arguments, both fatal:

- **Scope is undefinable.** "What does `timeLimit` apply to?" resolves today to
  "whatever calls `withDeadline`" — `evaluate`, `simplify`, their async forms,
  and a private copy in `explain.ts`. There is no principled answer for `.N()`,
  `compile()`, collection drains outside an evaluate, or `toString()` (which
  catches `CancellationError` today). It cannot be documented because it is not
  a rule.
- **Precedence is invisible.** Even fully specified — a span wins, `timeLimit`
  is inert inside one — a knob that silently stops applying in the presence of
  another knob is not discoverable from the API surface. Retaining it as a
  "default span duration" preserves exactly the ambiguity this redesign exists
  to remove.

A consumer wanting a blanket bound wraps its entry point in one span. That is a
single line at the boundary, and it is honest about its scope in a way
`ce.timeLimit` never was.

Documented contract for `withTimeLimit`:

> Runs `fn` with **at most** `ms` milliseconds. A tighter deadline may already
> be in effect from an enclosing span, in which case that one preempts this
> limit. Use the `label` and the `attribution` field on `CancellationError` to
> determine which limit fired.

## 3. API

### 3.1 `withTimeLimit`

```ts
// Backward compatible: existing 2-arg calls are unaffected.
withTimeLimit<T>(
  limit: number | { ms: number; label?: string },
  fn: () => T
): T;
```

The object form is preferred for new code because the label reads before the
callback and the shape stays extensible:

```ts
ce.withTimeLimit({ ms: 500, label: 'plot:sample' }, () => …);
```

Rejected alternative: `withTimeLimit(ms, fn, label?)`. Trailing-argument
metadata after a callback reads poorly and does not extend.

An async counterpart is needed; `withDeadlineAsync`
(`boxed-function.ts:2489-2511`) is currently internal and deliberately never
tightens an already-armed deadline, because spans restore synchronously. That
limitation must be stated in the public contract or fixed — see §6.4.

### 3.2 `CancellationError`

```ts
class CancellationError<T = unknown> extends Error {
  cause: CancellationCause | unknown;
  value?: T;             // partial result; generator paths only

  attribution?: string;  // label of the span owning the deadline that fired
  spans?: string[];      // all active span labels, outermost first
}
```

`attribution` answers "was this my budget or my caller's?" — a direct
comparison against the label the caller passed. `spans` gives the full nesting
for diagnostics and logging.

During stage 1 (§5.2) the surviving implicit top-level span gets a synthesized
label — `engine.timeLimit:<operator>`, e.g. `engine.timeLimit:Integrate` — so
ambient timeouts are attributable while they still exist. This is the part that
addresses the original complaint, and it ships before any breaking change.
After stage 2 every deadline has a caller-supplied label by construction.

### 3.3 Runtime state

`_deadline: number | undefined` becomes a frame:

```ts
interface DeadlineFrame {
  at: number;            // absolute ms
  owner?: string;        // label of the span whose deadline is effective
  spans: string[];       // all active span labels, outermost first
}
```

`checkDeadline()` (`interruptible.ts:55`) takes the frame and populates
`attribution`/`spans` when it throws. Same for the two `run`/`runAsync`
construction sites (`:130`, `:153`) and the abort site (`:125`).

`ce._deadline` is `@internal` but read directly in many places; it needs a
compatibility accessor returning `frame?.at` during migration.

### 3.4 Nesting stays `min()`

A labelled span must not be able to *extend* past an enclosing budget —
otherwise an inner span can defeat a caller's bound. Labels are for
attribution, not for control.

## 4. Load-bearing prerequisite: Rubi

`rubi/driver.ts:485-509` and `:1801-1812` **write** `ce.timeLimit` to install a
sub-budget for native factoring and simplify, restoring it in `finally`:

```ts
ce.timeLimit = Math.max(1, Math.min(remainingMs, 5000));
```

This depended on `ce.timeLimit` being an arming mechanism; under the proposed
model it becomes inert and the bound would silently vanish.

**DONE** — both sites now use `ce.withTimeLimit(budgetMs, …)`. Typecheck clean;
185 rubi tests and 413 integration tests (calculus, integration-rules,
explain-integrate, compile-integrate) pass. A sweep confirms `src/` now has
**zero** non-implementation writers of `ce.timeLimit`.

Notes from the conversion:

- The `Math.max(1, Math.min(remainingMs, 5000))` clamp was **kept**, not
  dropped as redundant. `withTimeLimit` composes `min()` against the *engine's*
  ambient deadline, but the driver's `this.deadline` is a separate wall-clock
  field never installed on the engine — the clamp is the only expression of
  "respect the driver's remaining budget, and cap this dead end at 5s".
- Site 1 (`nativeRationalFallback`) is where the tightening is observable: the
  span now bounds the whole `evaluate()` + `containsIntegrate` + `has()`
  sequence at one deadline instead of re-arming 5s per nested evaluate. That is
  the intent, and no currently-passing integral regressed. Site 2
  (`cleanExpansionResult`) wraps a single `simplify()` and is behaviourally
  identical.
- Unwind ordering is safe: `withTimeLimit` restores the previous deadline in
  its `finally`, so the ambient deadline is already restored before the
  driver's `catch` converts the `CancellationError` to `null`.
- Labels are not applied yet — they arrive with the release-N API change (§3.1).
  Retrofit as `rubi:native-fallback` and `rubi:clean-expansion`.

Rubi's own deadline (`driver.ts:232, :385`, default 30s; loader default 10s)
and its `matchAll` deadline (`match.ts:29-37`, a module-global) are
independent and unaffected.

**Open, not urgent** — `driver.ts:524` checks `ce._timeRemaining <= 0`, which
reads the *per-evaluate* budget, a different quantity from the span deadline.
It is belt-and-braces: the same line also checks `Date.now() > this.deadline`,
which is load-bearing. Natural replacement at release N+1 is a check against
`ce.deadline`. Also `numerics/numeric.ts:448` is a *comment* referencing
`ce.timeLimit = 2000` (documenting a deadline-escape hazard in the
Euler–Mascheroni limit) — inert today, wants a prose refresh at removal.

## 5. Deprecating `ce.timeLimit`

This is a **breaking change to a documented public property**
(`src/api.md:245-248`, `:7488-7491`; `types-engine.ts:239`). It needs a staged
retirement, and the staging has one non-obvious constraint.

### 5.1 The deprecation-warning trap

`console.*` calls are stripped from the minified production build. A
`console.warn` in the `timeLimit` setter would therefore fire in development
and be **silently absent in production** — precisely where a consumer on an old
build most needs to learn the property stopped working. Do not rely on it as
the sole channel.

Use the diagnostics mechanism instead (the same channel as
`parseDiagnostics`), so the signal survives minification and is
programmatically observable.

### 5.2 Stages

Project policy: mark `@deprecated` for **one minor release**, remove in the
**next minor**. Two stages, not three — there is no intermediate "inert"
release.

**Release N — deprecated, still fully functional.**
`timeLimit` keeps arming the implicit top-level span exactly as today; behavior
is unchanged. Mark `@deprecated` in JSDoc and `src/api.md`, emit a diagnostic
on set, and land the additive half of the design: `withTimeLimit`'s label,
`CancellationError.attribution`/`spans`, and the synthesized
`engine.timeLimit:<operator>` label. Non-breaking. CHANGELOG callout with the
migration snippet from §5.3.

**Release N+1 — removed.**
Property deleted from `IComputeEngine`, `ExpressionComputeEngine`,
`types-engine.ts:239`, and `src/api.md`. The mid-span re-arm
(`boxed-function.ts:2477-2478`) and its `explain.ts` duplicate go with it. Work
outside a span becomes unbounded.

**Consequence of the two-stage policy**: because there is no inert release, the
behavioral change lands all at once at N+1. Everything in §6.1, §6.2, and the
test conversions in §6.5 must therefore be **complete within release N** — they
cannot be staged behind a middle release that no longer exists. Release N is
the whole migration window.

Release N alone delivers the attribution fix, which is the original complaint.

### 5.3 Migration for consumers

```ts
// Before
ce.timeLimit = 500;
const r = expr.evaluate();

// After
const r = ce.withTimeLimit({ ms: 500, label: 'my-app:eval' }, () =>
  expr.evaluate()
);
```

Tycho has already adopted `withTimeLimit`, so the path is exercised rather than
theoretical. The blanket-bound case is one wrap at the app's entry point.

## 6. Work items

### 6.1 Blocking

- Convert the two Rubi `ce.timeLimit` writes to spans (§4).
- Remove the re-arm in `withDeadline` when a span is already active
  (`boxed-function.ts:2477-2478`).
- Apply the same treatment to the **duplicated** `withDeadline` in
  `explain.ts:649-668` (used at `:78`, `:424`, `:436`). It is a private copy
  and will otherwise keep the old behavior.

### 6.2 Blocks release N+1 — unguarded loops

`checkDeadline(undefined)` is a **silent no-op** and `_timeRemaining` returns
`+Infinity` when unarmed. So an unbounded path produces a hang, not an error.

An earlier draft of this note claimed five areas were deadline-only. **Verified
against the code and empirically probed with the deadline disabled
(`ce.timeLimit = 0` → `Infinity`): four of the five claims are false.** The
original list was assembled from `checkDeadline` call sites without checking
whether a counter guard bounded the same loop, and it cited one site
(`limit.ts:1066`) that does not exist. Corrected findings:

| Area | Guard on the same loop | Terminates without deadline |
|---|---|---|
| `simplify.ts:530` | dedup set + `MAX_SIMPLIFY_STEPS = 1000` (`:117-125`, `:232-240`) | yes — 31.3s |
| `series.ts` | order bound `for k=0..W` (`:244`, `:490`) | yes — 30-271ms |
| limit ladder | `MAX_DEPTH = 14` (`:147`, `:157`, `:332`, `:612`, `:689`) | yes — 2-52ms |
| Fungrim | inherits rule-machinery counters (`rules.ts:1313`) | yes |
| **`number-theory.ts` divisor family** | **none** | **NO** |

`simplify`'s `checkDeadline` sits at the top of `simplifyExpression`, which is
the body of the counter-bounded `do…while` at `:232` — same loop, bounded three
ways. The limit ladder's sites each sit beside a `MAX_DEPTH` test on the same
recursion.

**Only the number-theory divisor family is genuinely deadline-only**, and its
loops are bounded by the *input magnitude*, which is caller-controlled:

- `:948` Sigma0, `:962` Sigma1, `:978` SigmaMinus1, `:996` IsPerfect —
  `for (let i = 1n; i <= k; i++)`
- `:927` Totient — `for (let i = 2n; i < k; i++)`
- `:889` PrimePi — `for (let k = 3n; k <= bound; k += 2n)`

The `steps` counter in these loops is *only* a stride for amortizing
`Date.now()`; it never terminates anything. Measured with no deadline armed:
`Sigma1(1000000007)` → 13.7s; `Sigma1(100000000003)` → still running at 45s.

`DigitSum`/`bigintDigitsLSB` (`:76`, `:88`, `:112`, `:122`) are bounded by digit
count and are fine. `divisorsAscending` (`:1286`) is O(√m).

**DONE** — fixed algorithmically rather than with a guard, which removes the
pathology at its root:

| Function | Fix |
|---|---|
| `Sigma0` | `∏(aᵢ+1)` from the factorization |
| `Sigma1` | `∏(p^(a+1)−1)/(p−1)` |
| `SigmaMinus1` | `σ₁(n)/n` (divisors pair `d ↔ n/d`) |
| `IsPerfect` | `σ₁(n) = 2n` |
| `Totient` | reuses the **already-present** `eulerPhi()` — the O(n) loop was duplicating it |
| `PrimePi` | budget guard only; no factorization-based fix exists |

Reuses the existing `bigPrimeFactors` (Pollard rho above 2³², trial division
below) rather than a new factorizer. New module constant
`MAX_VALUE_SCALED_ITERATIONS = 1e7`, deliberately **not** `ce.iterationLimit`
(1024 would break `Sigma1(2000)` = 4836). `PrimePi` throws
`cause: 'iteration-limit-exceeded'`.

Measured: `Sigma1(1000000007)` 13.7s → **1ms**; `Sigma1(100000000003)`
>45s → **0ms**; `PrimePi(1e12)` with no deadline → throws at 2.2s.
Verified against 120 values captured from the *old* implementation plus an
independent brute-force cross-check over n=1..3000 (12000 comparisons clean).

**Landmine worth remembering**: `bigPrimeFactors(1n)` returns `{1: 1}` — its
`n <= 3` fast path returns the operand as its own factor. Unguarded that makes
σ₀(1) = 2. Both new helpers early-return on `n <= 1n`.

**Consequence for the test suite**: 4 tests in `timeout.test.ts` asserted that
these functions *time out* on large inputs — they used the O(n) pathology as a
vehicle for testing deadline enforcement. Rewritten as correctness assertions,
with `PrimePi` taking over as the number-theory timeout vehicle (it retains the
budget guard and has no algorithmic fix).

**Coverage gap found and closed while doing so**: the replacement `PrimePi`
test runs under the suite's `ce.timeLimit = 200`, so it throws via the
**deadline**, not the budget — it would pass even if
`MAX_VALUE_SCALED_ITERATIONS` were broken. Since that budget becomes the *sole*
protection at release N+1, a second test now disables the deadline
(`ce.timeLimit = 0`) and asserts `cause === 'iteration-limit-exceeded'`
explicitly. Verified: throws at 2.18s. This is the general shape of the risk —
**every guard that is currently a backstop behind the deadline becomes primary
at N+1, and any of them that is only tested through the deadline is untested
protection.**

#### Guard-coverage sweep (done)

All twelve non-deadline guards audited for deadline-independent test coverage:

**INDEPENDENT** (a test exercises the guard with no deadline, or the guard is
structural and fires far below any deadline): loop `iterationLimit`
(cortex asserts the `iteration-limit-exceeded` cause directly),
`recursionLimit` (cause-string asserted), `maxCollectionSize` (structural cap,
`a3-lists`), `MAX_ITERATION` Sum/Product cap (deterministic value cap),
series order bound (`series.test`: order 500 → `O(x^101)`), Rubi's own
deadline (`rubi-match` passes an explicit past deadline), and the new
`PrimePi` budget test.

**SHADOWED/UNTESTED** per the sweep — each then investigated empirically.
Outcomes:

1. `DiophantineBudgetError` (20M) — **turned out to be a non-issue.** The
   diophantine kernels are engine-free and never consult the deadline, so the
   budget is *already* the sole protection today; removal changes nothing.
   Through public `Solve` the budget surfaces as graceful degrade
   (`boxed-expression/diophantine.ts:451` catches → unsolved), never a throw.
   The fastest budget-exhausting input found (`sqrtMod` over a product of 24
   distinct primes) takes ~11.5s and ~16M allocations — untestable at
   reasonable cost. No test shipped; recorded here instead.
2. `LIMIT_PROBE_ITERATION_BUDGET` — **test shipped** (`calculus.test.ts`):
   γ-limit `lim (Σ 1/k − ln n)` on a fresh engine with `timeLimit = 0`;
   over-budget rungs read NaN, ladder truncates, converges to γ in ~35ms.
   Without the budget this documented-hangs >30s.
3. `PrimitiveRoot` budget — **unreachable in practice, no test.** The loop
   stops at the smallest primitive root; `hasPrimitiveRoot` pre-checks
   existence, and least-root growth is so slow that primes up to 6.7×10⁹
   yield roots ≤ 11. The guard stays as a pure worst-case backstop.
4. Collections-walk `iterationLimit` — **test shipped**
   (`collections.test.ts`): `Filter(Range(1,∞), never-true)` with
   `timeLimit = 0`; `.isEmptyCollection` trips the guard, swallow-to-
   `undefined` contract, ~73ms.
5. `MAX_SIMPLIFY_STEPS` — guard only `console.warn`s and returns partial
   (never throws); risk limited by the dedup set. Acceptable residual.
6. `MAX_DEPTH` (limit ladder) — fires at depth 14, tiny runtime. Acceptable
   residual.

**Latent bugs found by this work:**

- **Filter `at` positive-index path — FIXED.** It iterated the RAW source
  `expr.op1.each()` rather than the guarded Filter iterator — no
  `iterationLimit` guard at all; `First(Filter(Range(1,∞), never-true))` with
  the deadline disabled hung indefinitely (verified by repro, killed at 10s).
  Rerouted through the guarded iterator with the established swallow contract
  (`iteration-limit-exceeded` → `undefined` → `First` yields `Nothing`,
  matching the `count`/`isEmpty` pins). Verified: repro now returns `Nothing`
  in 16ms. Fail-without-fix proven by reverting: the raw walk blocks the event
  loop so hard that even jest's own 15s timeout cannot fire (90s external
  kill). `TakeWhile.at` had the same raw-walk pattern and got the same
  reroute (it was index-bounded, so lower severity; note its invalid-predicate
  error now throws via the iterator instead of silently returning undefined).
- **`Dedup` iterator — BEING FIXED THIS ROUND** (upgraded from "open
  follow-up" by review: any deadline-only path is a hard prerequisite for
  N+1, not a soft deferral). `Second(Dedup(Cycle([1,1])))` hangs with no
  deadline (verified by direct repro, killed at 10s); with a deadline armed —
  ambient or span — it IS interrupted at ~2s, so at release N the exposure is
  `timeLimit = 0` callers only. NOT the raw-walk pattern: the Dedup *iterator*
  itself (`collections.ts` ~:4223) has an unguarded internal `while(true)` —
  its index only advances on distinct elements — so rerouting `at` through
  `each()` would not help; the fix is an `iterationLimit` counter inside the
  iterator. CAUTION honored: the collections-laziness audit pinned subtle
  `Dedup`/`ChunkBy` finiteness behavior (use `takeCount`, not bound-based
  `Take.isFinite`) — the guard bounds the walk only, no finiteness logic
  touched. `Scan.at`/`Cumulate` walk raw but advance unconditionally
  (index-bounded) — not bugs.

**Two residual items, neither blocking:**

- `PrimitiveRoot` has the same unbounded `for (let a = 2n; a < n; a++)` shape
  and was **missed by the original survey** — the `:889` line reference in that
  survey pointed at `PrimitiveRoot`, not `PrimePi`. Being given the same budget
  guard. (Third bad reference from that survey; see the note above about how it
  was assembled.)
- `bigPrimeFactors` (`numerics/primes.ts`) has no iteration budget on Pollard
  rho for a hard large semiprime, and is now reachable from the σ/φ functions.
  Cost is ~O(n^¼), far from the O(n) pathology, and it is shared with
  `PrimeFactors`/`PrimitiveRoot`/`carmichaelLambda`. Deferred, recorded here.

**Async does not substitute for this** — and, per §6.4, async does not
substitute for much of anything today. Abort is polled at the same instrumented
sites as the deadline, so a loop that polls neither hangs identically under sync
and async.

Existing non-deadline guards for reference: `iterationLimit` (1024),
`recursionLimit` (256), `maxCollectionSize` (10_000), `MAX_ITERATION` (10_000),
`LIMIT_PROBE_ITERATION_BUDGET`, `DiophantineBudgetError`.

### 6.3 Consumers that catch timeouts

Audit the swallow sites — with `attribution` they can distinguish "my
sub-budget expired, degrade gracefully" from "the user's budget expired,
propagate":

- `rubi/driver.ts:451`, `:506` → `return null` (integration silently degrades)
- `rubi/driver.ts:1809`, `rubi/normal-form.ts:205`, `rubi-utils.ts:469-474`
- `monte-carlo.ts:122` → returns partial estimate
- `cortex/execute-cortex.ts:104-116` → converts to a boxed `["Error", …]`

Note these test `e.name === 'CancellationError'` rather than `instanceof`, for
cross-bundle safety. Preserve that.

### 6.4 Async — cancellation is much weaker than it appears

An earlier draft treated async + `AbortSignal` as a first-class escape hatch for
unbounded work. **Empirical testing shows it is not one today.** This changes
what we can honestly claim in the guide.

**Surface.** There is exactly one async entry point:
`evaluateAsync(options?): Promise<Expression>` (`types-expression.ts:1913`,
impl `boxed-function.ts:1181`). No `simplifyAsync`, no `NAsync` — they do not
exist. `N()` is sync-only. It does **not** return a signal or cancel handle;
the signal flows *in* via `EvaluateOptions.signal`
(`types-kernel-evaluation.ts:86-87`) and the caller supplies its own
`AbortController`.

**Reach.** Only four handlers in the entire library reach the one signal check
at `interruptible.ts:124`: `Loop` (`control-structures.ts:143`), `Factorial`
(`arithmetic.ts:684`), `Product` (`arithmetic.ts:3085`), and `Sum`
(`:3212`, `:3244`). Every other operator falls through to the synchronous
`evaluate` handler and is uninterruptible by signal. Note `checkDeadline` never
consults the signal — `interruptible.ts:124` is the only signal check anywhere.

**Deliverability.** The only macrotask yield is `interruptible.ts:138`
(`setTimeout(r, 0)`), reached after a 16ms chunk of an *instrumented*
generator. The recursive `await x.evaluateAsync(...)` awaits are microtask-only
and never drain the timer queue. So if the computation is not already inside
`runAsync`, the `abort()` callback cannot fire at all — the single-threaded
loop is blocked.

**Measured** (abort requested at 300ms in every case, `timeLimit` set to 600s
so it cannot be confused for a timeout):

| Case | Result |
|---|---|
| `(700!)!` — instrumented `Factorial` | aborted cleanly, ~10ms latency |
| large `Sum` — instrumented | aborted cleanly, ~10ms latency |
| operator with a 3s tight-loop `evaluate` | **abort callback never ran; promise resolved with the full result** |
| nested `Sum` with a sync inner evaluate | **abort landed at 110.8s** — callback blocked until 54.5s |

**Zero tests** exercise `AbortController`/`AbortSignal` anywhere in `test/`.

**Consequences for this design:**

1. Do not claim in the rewritten guide (§6.5) that async cancellation bounds
   runaway work. It bounds `Loop`/`Factorial`/`Sum`/`Product` and nothing else.
   Overclaiming here would be worse than the ambiguity we are removing.
2. Genuine runaway protection needs a worker or isolate, not a signal. Worth
   saying plainly in the guide rather than implying the signal suffices.
3. Before exposing a public `withTimeLimitAsync`: `withDeadlineAsync`
   (`boxed-function.ts:2489-2511`) deliberately never tightens an already-armed
   deadline, because spans restore synchronously and would otherwise unarm a
   deadline still in use by pending async work. Either fix the span lifetime
   (context-tracked rather than `finally`-restored) or do not expose the async
   span form.
4. Broadening signal coverage beyond the four handlers is a separate,
   larger piece of work. Recorded here, not scoped into this redesign.

### 6.5 Docs and tests

- `doc/_99-guide-execution-constraints.md` — full rewrite (`:21`, `:36`,
  `:42`, `:64`, `:67`)
- `doc/10-guide-evaluate.md:157, :161, :174`
- `ARCHITECTURE.md:424`
- `withTimeLimit` is absent from `src/api.md` — add it (regenerated by
  `npm run doc`, do not hand-edit)
- `test/compute-engine/timeout.test.ts:556-629` — the item-61 describe block
  tests the per-evaluate/span interaction being removed; it becomes
  meaningless and must be rewritten against the new contract
#### Test conversion — treat as an upgrade, not a chore

The suite should adopt the new API deliberately: **labelled spans make our own
timeout failures self-diagnosing**, which is the same benefit we are selling to
consumers. Today a timing-flake failure reports only "Timeout exceeded"; with
attribution it reports which span owned the deadline.

- `test/utils.ts:16-24` sets `timeLimit = 20_000` suite-wide. Replace with a
  shared labelled-span helper (e.g. `withTestLimit(label, fn)`) so suite-wide
  bounds survive removal *and* carry attribution. Without it, jest's
  `testTimeout` becomes the only backstop and hangs surface with no indication
  of which engine loop is spinning.
- Convert the ~12 suites that assert a throw via the ambient limit — these
  would **hang** rather than fail at release N+1, so they must move during
  release N: `cortex/execute.test.ts:397`, `bug-fixes.test.ts:184`,
  `parser-for-comprehension.test.ts:201-203`,
  `limit-special-functions.test.ts:275-309`,
  `compile-integrate.test.ts:169-175`, `interpret.test.ts:351-368`, plus the
  suites that merely raise the limit as a precondition (distributions, series,
  rubi-utils, map-auto-compile, assign-recursion).
- `timeout.test.ts` is largely written against the ambient limit (`:12` sets it
  suite-wide) and needs a structural rewrite, not edits. New coverage to add:
  `attribution` identifies the correct span under nesting; an inner span does
  not extend past a tighter outer one; unlabelled spans yield
  `attribution: undefined` without error.
- Known timing-flake suites (calculus, timeout, fungrim-loader, rubi-utils)
  should be re-run isolated before attributing any failure to this work.

## 7. Resolved decisions

**7.1 Unlabelled spans are allowed.** `withTimeLimit(500, fn)` stays valid and
produces `attribution: undefined`. The label exists for the consumer's benefit;
a consumer that cannot act on attribution — because it cannot recover from a
timeout anyway — has no reason to supply one. Do not synthesize labels from
call sites and do not require them. Document the object form as preferred, and
leave it there.

**7.2 No "requires an enclosing deadline" assertion.** Internal paths that care
about being bounded create their own span with `withTimeLimit`; paths that do
not care run unbounded. This is the same rule consumers get, applied to
ourselves — no special internal-only mechanism, no assertion API. It is also
what §4 already requires of Rubi.

**7.3 Cache builds are exempt from timeouts entirely.** Rather than the current
un-arm-then-push-forward accounting (`index.ts:1936-1948`), a cache build runs
outside any deadline: warm-up is never charged to a caller's budget, and a
build in progress is never interrupted by an enclosing span's expiry. Express
this as an explicit "no deadline" span rather than as arithmetic on the
enclosing deadline, so it composes predictably with labelled spans.

Note the implication for §6.2: a cache build that hits an unguarded loop is
unbounded with no escape at all. This is another reason the counter budgets are
a prerequisite rather than a nicety.

## 8. Implementation order

1. ~~Bound the number-theory divisor family, §6.2~~ — **DONE** (algorithmic
   fix; `PrimePi`/`PrimitiveRoot` budget-guarded).
2. ~~Rubi conversion, §4~~ — **DONE**.
3. ~~Additive API: label, `attribution`, `spans`, `DeadlineFrame`, synthesized
   ambient label, `@deprecated` markers, CHANGELOG~~ — **DONE**. Attribution
   semantics verified empirically: inner-wins → `attribution: 'inner'`;
   outer-preempts → `attribution: 'outer'` with `spans: ['outer','inner']`;
   unlabelled numeric form → `attribution: undefined`; ambient →
   `'engine.timeLimit:Sum'`. ~56 `checkDeadline` sites converted to frames;
   all 22 `run`/`runAsync` sites attributed; Rubi spans labelled
   (`rubi:native-fallback`, `rubi:clean-expansion`). `checkDeadline` sites fed
   by a locally-computed numeric deadline (rubi/match, richardson,
   monte-carlo, and parameter-threaded `deadline` options) stay numeric and
   produce unattributed timeouts — converting them means widening their own
   signatures; deferred. **§5.1 caveat resolved against the diagnostic**: no
   engine-level runtime diagnostics channel exists (`parseDiagnostics` is
   parse-time only), so the deprecation is JSDoc + CHANGELOG; a
   diagnostic-on-set would require building a runtime warning channel first —
   a product decision, not smuggled in here. Note: `## [Unreleased]` heading
   did not exist in CHANGELOG.md and was created (verbatim, brackets —
   release-process load-bearing).
4. ~~Test-suite conversion to labelled spans, §6.5~~ — **DONE** (release N
   scope). Converted to labelled spans (`test:*`): cortex execute, bug-fixes
   (#29 Gruntz tower), parser-for-comprehension (IndexOf/∞-Range),
   limit-special-functions (two Gruntz cases), compile-integrate
   (degrade-to-quadrature — degrade verified to still occur under a span),
   interpret (recurrence anchor), plus the two 2000ms cases in
   deadline-regressions (`BellNumber(20000)`, `LucasL(1e9)`) found by a
   post-conversion sweep. A grep sweep found no other short-limit
   throw-asserters outside timeout.test.ts. Attribution probed on two
   conversions (span label confirmed as `attribution`); shipped tests keep
   their original assertions only. NOT converted, by design: the
   precondition-raising suites and test/utils.ts's 20s (functional until N+1,
   deleted with the property), and timeout.test.ts's item-61 composition block
   (tests behavior that exists until N+1; annotated as going with it). Note
   from the conversion: interpret's recurrence path throws with
   `attribution: undefined` — it reads a parameter-threaded numeric deadline
   (the known unattributed class from step 3).
5. ~~Doc rewrite, §6.5~~ — **DONE**. `doc/_99-guide-execution-constraints.md`
   rewritten around spans/attribution/budgets with an honest §6.4-faithful
   async section; `doc/10-guide-evaluate.md` migrated; `ARCHITECTURE.md`
   one-liner; `src/api.md` regenerated via `npm run doc` (diff verified
   initiative-only: deprecation strikethroughs + `withTimeLimit` entries).
   Every guide snippet executed against source and verified against its
   prose. The old guide's `Totient` timeout example no longer times out
   (it is O(√n) now) — replaced with a large `Sum`.
6. Remove `timeLimit`, the mid-span re-arm, and the `explain.ts` duplicate;
   cache-build exemption (§7.3). → **release N+1**.

Steps 1 and 2 are safe to land immediately and independently — neither depends
on the deprecation decision.