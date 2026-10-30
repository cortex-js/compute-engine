# The caches of evaluated values: audit and proposed design

Date: 2026-10-30, revision 2 (revision 1 had a dual review; its findings are
in `docs/scratch/EVALUATION-CACHE-ARCHITECTURE_SPEC_REVIEW.md`, and section 10
says where each one is handled). Session `compute-engine-aa`. Task:
`docs/plans/2026-10-28-evaluation-cache-audit-handoff.md`. Input: the census
written by the work on the memo of shared subexpressions
(`docs/plans/2026-10-28-ce-601-cache-census.md`, ROADMAP CE-601).

The code references are to HEAD `d7c8fe8b902fbee7d5fe64d79aefe9079e992b6f`.
The measurements of sections 3.3 and 3.4 were made at HEAD
`9b86a09321c2430f2bfd7ef185041d0502803561`, except the two workloads that
section 3.4 marks as measured again at `d7c8fe8b9`. The five commits between
them change no cache of evaluated values, except CE-620 (`00869b80a`, the
element memo) and the type-constant commit (`d7c8fe8b9`, fewer reads of the
type parse cache). Paths are relative to `src/compute-engine/` unless they
start with `src/`, `test/`, `docs/` or `benchmarks/`.

This document changes no source code. It found three defects, filed as
ROADMAP CE-628, CE-647 and CE-648; step 1 fixes them.

**Status of the steps (2026-10-30).** Steps 0 and 1 are committed
(`5029c5d77`). Step 5 is staged: the enclosure endpoint cache and both
contour memos are removed, and CE-659 (a `Series` result depended on the zero
tests made before it) is fixed by the user's option (a). On 2026-10-30 the
user reduced the plan: step 4 and a narrow fix of CE-645 remain; steps 2, 3b
and 6 are postponed until a defect needs them; step 7 is not done (decision
2). The current state and the next work are in
`docs/plans/2026-10-30-evaluation-cache-status-handoff.md`.

## 1. Summary

- **The census is correct but not complete.** Every cache that it lists still
  exists. A search of the source found about 120 more caches; the list is in
  the appendix `docs/plans/2026-10-30-evaluation-cache-inventory.md`. Most of
  them keep types, effects, structure or static data and run no evaluation.
  Five of them keep a value that an evaluation computed and are not in the
  census: the dictionary evaluation memo, the enclosure endpoint cache, the
  derivative chains (two maps), the memos of the Rubi integrator, and a
  compiler fold memo.
- **Three defects** (section 2.2):
  - the derivative chains keep a value that host code computed (CE-628);
  - the derivative chains do not see a retype of a symbol that the function
    reads (CE-647);
  - the zero-test and simplification caches of the Rubi integrator keep a
    value that host code computed (CE-648).
- **The caches use five different validity rules** (section 3.2), and each
  one applies the host-code rule and the "fail-closed" rules in its own code.
  Seven process-wide counts tell that a computation must not be stored (host
  code ran, a cycle was cut, a sequence read stopped, and four more), and an
  eighth count tells the asynchronous route that an object field was read.
  The 16 files that store an evaluated value each read a different subset of
  them (section 5.1). That is why each review round of CE-601 found one more
  cache that did not follow the rule of the moment.
- **The caches compare seven engine-wide versions, 14 other counts and 11
  settings** (section 4). One function advances the seven versions
  (`noteStateEvent`). They overlap: for example, each event that advances the
  world version also advances the semantic version.
- **Measured benefit** (sections 3.3 and 3.4). Without the type cache no
  workload finishes. Without the memo of shared subexpressions or the effects
  cache, a shared node takes 2,000 to 5,000 times longer. The application
  memo (8×), the type parse cache (up to 4× before `d7c8fe8b9`, 1.5× after),
  the sequence term memo (3×) and the stored value memo (2×) each save time
  on one or more workloads. The dictionary, lazy value, element and `at()`
  caches show no gain on the workloads, but their own tests fail without them
  (one runs out of memory). Nine caches show no gain on any workload and no
  test fails without them: facet, slice bounds, contour, approximations,
  `Limit` probes, eager source values, factor, enclosure endpoints, `Map`
  compile. But timed on the case that each one was added for (section 3.5),
  four of them save time: slice bounds (16×), `Limit` probes (4.5×), `Map`
  compile (85× on repeated `at()` reads) and approximations (1.7×); the
  factor memo is at the threshold (1.26 to 1.55×). Two more stay for a reason
  that no probe shows: the facet memo (its recorded case is a document open
  with 210,000 facet probes) and the eager source values (they decide how
  often host code runs). Only the contour memos and the enclosure endpoint
  cache show no gain on any case.
- **Proposed design** (section 6): five kinds of cache, each with one rule;
  one store guard that samples every fail-closed count before a computation
  and decides at the end whether the value may be stored, with an explicit
  list of the counts each site accepts; one interned "numeric context stamp"
  for the settings that can change a numeric value; one dependency stamp for
  the caches that track the values they read. The migration has eight steps
  that can land one at a time (section 7).
- **Decisions** (section 8), all made by the user on 2026-10-30: remove the
  contour memos and the enclosure endpoint cache, keep the factor memo
  (decision 1); no per-call key for the type and sign caches now (decision
  2); an explicit retype or extension moves the world version (decision 3,
  option (c)); the store-guard accept lists are narrowed in one change
  (decision 6). CE-615 (decision 4) stays open; the steps do not depend on
  it.

## 2. Method

### 2.1 Inventory

1. The census tables were checked one by one against the code.
2. A search of `src/compute-engine/` and `src/common/` for module-level
   `Map`, `WeakMap` and `WeakSet` objects, for fields named `memo`, `cache`,
   `_cached` or `_memoized`, and for lazily set fields. Each hit was
   classified by what it stores and whether its value can depend on an
   evaluation. The result is the appendix
   (`docs/plans/2026-10-30-evaluation-cache-inventory.md`); each cache of an
   evaluated value was read again by hand.

### 2.2 Probes of behavior

The probes are in `docs/scratch/2026-10-30-cache-audit-probes/` (its README
says how to run each one). A probe that needs an off switch runs in a linked
worktree with `cache-switches.patch` applied; the others read the main tree.

| Probe | What it checks | Result |
|---|---|---|
| `uncensused.mts` A | Whether `h(2)` is pure, where `h(x) = x + k` is a host operator with no purity statement and `k` a JavaScript variable | Not pure, not constant |
| `uncensused.mts` B, B2 | Enclosure endpoints with a host call, before and after a change of `k` | New value after the change: the evaluation of `Enclosure` evaluates its endpoints before the cache reads them |
| `uncensused.mts` C | `Tuple(d, d)`, where `d` is a dictionary that holds `h(2)` | 2 host calls, as the rule expects: the shared memo marks the host node impure first |
| `deriv.mts` | Derivative chains with a host call | **Wrong value: CE-628** |
| `sgn.mts` | Sign, `Sqrt` and `Abs` of an expression that holds a host call, before and after a change of `k` | The sign of `h(2)` is `undefined` (the sign cache does not evaluate a host call); `Sqrt` and `Abs` give the new value |
| `defchange.mts` | A retype (a symbol `b` declared `integer`, then typed `real`) and an extension (`g(x) = x + 1`, then `{ extend: true }` with `g(x) = x + 100`) under each value cache: fill an entry, change the definition, read the same node again; compared with the same run with the value caches off | The value caches give the same output on and off for both changes, except the derivative chains after a retype (**CE-647**, confirmed with `deriv-retype.mts`). After an extension, a node boxed before it keeps the old definition with the caches on or off: that is CE-615, not a cache defect |
| `rubi.mts` | The Rubi zero test of `h(1) − 2`, twice in one integration call, with `k` changed between the two | **Wrong value: CE-648** |

### 2.3 Measurement of benefit

A probe worktree (not for delivery) adds an off switch to 23 caches:
`CE_CACHE_OFF=<name>[,<name>…]`, read once by a module with no imports
(`cache-switches.ts`). A switch turns off the look-up of a cache (a store can
still happen, so the measured time is the time saved by the hits). The
switches do not turn off the parts of a cache that decide a result: the
"incomplete walk" answer of the facet memo and the per-read terms of a
sequence stay on.

Workloads (`workloads.mts`, median of 5 runs after one warm-up, one Node
process per setting):

| Workload | What it does | The caches it aims at |
|---|---|---|
| `tycho-evaluate` | The 15 surface bodies of `benchmarks/tycho-document-open/evaluate.ts`, evaluated on a new engine | Lazy views, element and facet memos, types |
| `rebind` | `benchmarks/tycho-document-open/rebind.ts`, 1,994 canonical rebinds | Types, effects, canonical forms |
| `shared-max-22` | `Max(t, t)` nested 22 deep over `x + y` | Shared subexpressions |
| `recursion-fib` | `f(16)` with `f(n) := if n < 2 then n else f(n-1) + f(n-2)` | Application memo |
| `lazy-reads` | `Sum`, `Count` and `At` of one `Map` over 3,000 elements, read 20 times | Element, facet, lazy value memos |
| `accumulator` | A `Loop` that appends 400 times to a list | Lazy value memo (constant key) |
| `sequence` | `F_300` of `ce.declareSequence` Fibonacci, 5 times | Sequence term memo |
| `limits-series` | Four limits, 3 times, and one `Series` | `Limit` probes, contour memos |
| `compare-constants` | `√2 + √3 < √10`, 200 times | Approximations of the comparisons |
| `simplify-factor` | Five simplifications, 3 times, and `Factor(x^8 - 1)` | Factor memo, types |
| `map-compile` | At machine precision, the numeric view (`.N()`) of a `Map` over 20,000 elements, drained 5 times | `Map` compile cache |
| `stored-values` | `p·p·p` with `p := √2 + 3q`, read 300 times with an unrelated write between reads | Stored value memo |
| `type-reads` | The type and sign of a sum, 300 times with an unrelated write between reads | Type and sign caches |

The workload driver prints a digest of the results of each workload, so that
a run with a cache off shows a changed result. This audit driver made the
digest from `toString()`, which prints only the first and last five elements
of a long collection, so its "same digest" was a weaker check than it says.
The driver of step 0 (`benchmarks/evaluation-caches.ts`) serializes every
element, and the timings of section 3.5 compare full results.

**Correction.** In the runs of revision 1, `lazy-reads` and `map-compile`
wrote `Map` with its arguments in the wrong order (the signature is
`Map(mapping, collection)`), so both timed an error expression, and
`map-compile` did not drain its view, so no element was compiled. Both are
corrected and were measured again (section 3.4). The other 11 workloads were
checked by printing their results: they compute what the table says.

The tests: `node scripts/test-core.mjs` (18 files, 5,414 tests, 4 workers)
with no switch and with every switch except the type cache.

**Load.** All the timing runs held the box lock
(`compute-engine-aa:cache-audit`), but the box was busy: the load average was
32.5 at the start of the first run and 5.3 at its end, and the baseline ran
first. A ratio under about 1.5× in that run is noise. The second run pairs
each setting with a baseline run made just before it (section 3.4).

The hit counts come from the engine's own statistics switch
(`CE_CACHE_STATS=1`, `src/common/cache-stats.ts`), on the two Tycho document
benchmarks.

## 3. Inventory

### 3.1 The caches of evaluated values

"Lifetime" is one evaluation (a top-level `evaluate()`), one call (of the
named function), one node (the cache entry dies with the expression node), or
one engine. "Host rule" says whether the cache reads `uncachedHostCallCount()`
(`boxed-expression/host-handler-changes.ts`) before it stores. "State it
depends on" uses these words: **values** (stored values of symbols),
**definitions** (operator and type definitions), **numeric settings**
(working precision, decimal precision, requested precision, angular unit,
rounding rule, tolerance), **assumptions**, **scope** (the lexical scope of
the read), **objects** (fields of mutable objects), **draws** (random draws).

| # | Cache (file, symbol) | Stores | Key | Lifetime | Validity rule (section 3.2) | State it depends on | Host rule |
|---|---|---|---|---|---|---|---|
| 1 | Memo of shared subexpressions (`boxed-expression/shared-evaluation-memo.ts`, `memos`) | Result of a pure node | Node, frame, exact or numeric | One evaluation | E: `_evaluationVersion`, impure count, 7 settings | Values, definitions, numeric settings, assumptions, scope, draws, the verify flag, the effects registry | Yes (`failClosedCount()`) |
| 2 | Application memo (`function-utils.ts`, `validApplicationMemo`, `ce._applicationMemo`) | Result of a call of a pure function literal | Literal, then precision and the arguments | One engine (4,096 results per literal) | D: world version, object-store epoch, dependency snapshot | Values and definitions the body reads, working precision, objects | Yes |
| 3 | Lazy value memo (`boxed-expression/boxed-function.ts`, `_memoizedLazyCollectionValue`, field `_value`) | Value of a lazy view, or inert result | Node | One node | G+: `_anyVersion` or none (constant node), world version, scope, facts hidden, object dependencies | Values, definitions, assumptions, scope, objects | Yes |
| 4 | Element memo (`boxed-expression/collection-element-memo.ts`, `elementMemoCaches`) | Elements by index | Node | One node | D, plus semantic version, scope and facts hidden | Values and definitions the collection reads, assumptions, scope, draws. Not the numeric settings (CE-645) | Yes. It also defines a result: one instance gives one set of random draws (`docs/RANDOMNESS-MODEL.md` §6) |
| 5 | Facet memo (`boxed-function.ts`, `_memoizedFacet`) | `count`, `isEmpty`, `isFinite` | Node and facet | One node | D, plus facts hidden | Values and definitions the collection handlers read, assumptions | Yes |
| 6 | `at()` materialization (`boxed-function.ts`, `_materializedAt`, `_eagerSource`) | Full `evaluate()` of a collection node | Node | One node | G: `_cacheGeneration()` | Values, definitions, assumptions (all through the generation) | Yes (clears the cell) |
| 7 | Slice bounds (`library/collections.ts`, `SLICE_BOUNDS_MEMO`) | Start and end of a `Slice` | Node | One node | D, plus facts hidden | `count` of the source, so the values and definitions it reads | Yes |
| 8 | Stored value (`boxed-expression/boxed-symbol.ts`, `_memoizedStoredValue`, `STORED_VALUE_MEMOS`) | Evaluated value of a symbol's value | Value and route | One node | D, plus facts hidden | Values and definitions the stored value reads, assumptions | Yes |
| 9 | Sequence terms (`sequence.ts`, `memo`, `numericMemo`, `declined`) | Terms of a sequence | Index (and precision) | One sequence definition | D, plus semantic version when no snapshot | Values and definitions the recurrence reads, working precision | Yes |
| 10 | Contour memos (`symbolic/contour.ts`, `zeroMemo`, `partsMemo`) | "Is exactly 0"; exact real and imaginary parts | Structure (hash, `isSame`), angular unit, precision, `_definitionVersion` | One engine (2,000 entries, then cleared) | S; a zero verdict on an expression with non-constant symbols adds `_cacheGeneration()` | Definitions, constant values, angular unit, working precision; values for the non-constant verdicts | Yes |
| 11 | Approximations (`boxed-expression/compare.ts`, `approximations`) | Value with an error bound | Node, then working and decimal precision, angular unit, rounding | Two keys per node | S | Definitions, constant values, numeric settings | Yes |
| 12 | `Limit` probes (`symbolic/limit.ts`, `probeCache`) | Machine-float function, or "cannot compile" | Node and variable | One node | D, plus `_definitionVersion`, facts hidden; journaled by the checkpoint | Values, definitions, assumptions | Yes |
| 13 | `Map` compile (`library/map-auto-compile.ts`, `mapCompileCaches`) | Compiled element function, or "no compile" | Node | One node | Own list: `_semanticVersion`, per-dependency write versions, world version, tolerance, angular unit, rounding | Values the compiler folds, definitions, tolerance, angular unit, rounding | Yes |
| 14 | Eager source values (`boxed-expression/eager-source-values.ts`, `keptByEngine`, `hostKeptByEngine`, `shared`) | Value of an operand that a finiteness read evaluated | Operand node | One evaluation (host values), the evaluations in progress (others) | E-like: `_anyVersion`, world version, object-store epoch, scope; object field reads counted with `objectReadCount()` | The operand: values, definitions, scope, objects | Yes. It also defines a result: host code runs once per evaluation |
| 15 | **Dictionary evaluation memo** (`boxed-expression/boxed-dictionary.ts`, `dictionaryEvaluationMemo`) | Evaluated pure dictionary | Node, options, `_anyVersion` | One outermost dictionary evaluation | E-like: `_anyVersion` | Values and definitions of the entries | No. Probe C gives the expected 2 host calls: the shared memo marks the host node impure first |
| 16 | **Enclosure endpoints** (`library/enclosure-arithmetic.ts`, `SETTINGS_PAYLOADS`) | Endpoint class, outward doubles | Node, decode function | One node | S: angular unit, precision | Constant values, definitions, angular unit, working precision (not the rounding rule) | No. Probes B and B2 give the new value |
| 17 | **Derivative chains** (`symbolic/derivative.ts`, `derivativeChains`, `partialDerivativeChains`) | n-th and partial derivatives of a function literal | Literal (and engine) | One literal | Semantic version and a dependency snapshot | Definitions (types included), values that simplification folds | **No: CE-628. Also misses a retype: CE-647** |
| 18 | **Rubi memos** (`rubi/driver.ts`, `RubiDriver.memo`; `rubi/rubi-utils.ts`, `activeCaches`) | Antiderivatives, zero tests, simplifications | Variable and integrand text | One integration call | None | The integrand: values, definitions, host results | **No: CE-648.** The Rubi rules are an opt-in package |
| 19 | **Compiler fold memos** (`compilation/base-compiler.ts`, `_foldValueMemo` and its siblings, `_knownExponentMemo`) | Constant folds | Node | One outermost compile | None needed (one compile) | Constant values | Not needed: a compiled function is a snapshot by design |

The census also lists caches that need no host rule (the sign and type
caches, the factor memo, the folded interval code, the function `value` of a
constant, the structure-only caches, the caches of one call, and the kernel
pool). They are unchanged. The factor memo keeps a symbolic input under
`_cacheGeneration()` and a constant input with no version (section 6.1).

### 3.2 The five validity rules

| Rule | Name | How it checks | Used by |
|---|---|---|---|
| G | Generation | One integer: `_cacheGeneration()` (the `any` version, doubled, plus one while the assumptions are hidden). Any state event that can change a cached answer advances it | Type, sign, structural form, `at()` materialization, factor memo (symbolic inputs), contour zero verdicts with non-constant symbols, call result types, LaTeX strings; the effects cache uses `_callableVersion` and the lexical scope instead |
| G+ | Generation with a constant key | G, except that a pure node whose operands are all constants keeps its entry across value writes, checked only against the world version | Lazy value memo |
| D | Dependencies | The world version (rare global events), the object-store epoch or per-object versions, and a snapshot of the definitions that the value reads, each with its `_writeVersion` (`snapshotMemoDeps()`, `memoDepsStillValid()`) | Application, element, facet, slice, stored value, sequence, `Limit` probes, derivative chains; `Map` compile has its own variant |
| E | One evaluation | The entry dies when the top-level evaluation ends. Inside it: `_evaluationVersion` and a count of impure evaluations, and the settings that change without an event | Shared subexpressions; the eager source values and the dictionary memo use variants |
| S | Structure and settings | The structure of the expression and a few settings; used only for expressions whose symbols are all constants | Contour memos, approximations, enclosure endpoints, factor memo (constant inputs) |

Each rule is coded again at each cache. For example, "facts hidden" is a
boolean field in the element, facet, slice, stored value and `Limit` caches,
the odd bit of the generation in the G caches, and a field of the entry in
the shared memo.

### 3.3 Measured benefit

The table gives the ratio of the time with the cache off to the time with
all caches on (higher means the cache saves more). "DNF" means that the run
did not finish in 15 minutes. Numbers are from the first timing run, whose
baseline ran at load 31; see section 2.3. **Section 3.4 replaces these
numbers with the paired run**, and the `lazy-reads` and `map-compile` numbers
of this run are not valid (section 2.3, correction).

| Cache off | Clear effect (> 2×) | Other workloads |
|---|---|---|
| Shared subexpressions | `shared-max-22`: 4,694× (5.9 ms → 28 s) | Noise |
| Effects | `shared-max-22`: 2,226×. The shared memo reads `isPure` at each node, and without the effects cache each read walks the subtree again | Noise |
| Type | `tycho-evaluate`: DNF. A second run left `tycho-evaluate` out; its first workload (`shared-max-22`) did not finish in 10 minutes, so the others did not run | — |
| Application memo | `recursion-fib`: 8.5× | Noise |
| Sequence terms | `sequence`: 3.5× | Noise |
| Stored value | `stored-values`: 3.0× | Noise |
| Type parse (`TYPE_CACHE`, `src/common/type/parse.ts`) | `shared-max-22` 3.1×, `recursion-fib` 2.2× | |
| All except the type cache | `shared-max-22` 4,388×, `recursion-fib` 12×, `stored-values` 5.2×, `sequence` 4.1×, `tycho-evaluate` 1.9× | |
| The other 14 | None | |

Hit counts with `CE_CACHE_STATS=1` (`tycho-evaluate`, one run, before
`d7c8fe8b9`):

| Class | Reads | Hit rate | Generation misses that gave the same answer again |
|---|---|---|---|
| `type` | 6,321,163 | 95.7% | 28,672 of 28,672 (100%) |
| `effects` | 403,615 | 61.9% | 11,082 of 11,082 (100%) |
| `typeParse` | 463,618 | 99.9% | — (2,270 reads after `d7c8fe8b9`) |
| `collectionFacet` | 80,082 | 48.0% | — |
| `lazyValue` | 38,804 | 9.2% (30,078 stores refused) | 396 of 396 |
| `sgn` | 2,524 | 72.1% | — |
| `elementMemo` | 24 | 0% | — |

The `rebind` benchmark gives the same picture: `type` 95.1% of 2,480,399
reads, and every generation miss gave the same answer again (30,206 of
30,206). A generation miss that gives the same answer is a miss caused by a
write to a definition that the node does not read. These numbers bound what
a dependency-precise key for the type cache could save on these workloads:
about 0.5% of the type reads (section 8, decision 2).

The core tests take 19.0 s with all caches on and 15.5 s with all except the
type cache off: no measurable benefit for the test suite, and the load moved
between the two runs.

### 3.4 Paired timing run

Each setting ran right after a baseline run with all caches on, both under
the box lock (load average 3.9 to 13.7 at the start of each pair; the load
at the start of each baseline is in the second column). Ratio of the median
with the cache off to the median of its baseline. A ratio between 0.75 and
1.25 is inside the noise of this run: the same code gave ratios from 0.62 to
1.35 on workloads that the cache cannot reach. Baseline medians (first pair):
`tycho-evaluate` 2,475 ms, `rebind` 1,082 ms, the other workloads 4 to 55 ms.

The `lazy-reads` and `map-compile` columns come from a separate paired run at
HEAD `d7c8fe8b9` with the corrected workloads (load average 25 at the start,
16 at the end; baseline medians 30 to 39 ms and 42 to 50 ms).

| Cache off | Load | tycho-evaluate | shared-max-22 | recursion-fib | lazy-reads | sequence | map-compile | stored-values | type-reads | rebind |
|---|---|---|---|---|---|---|---|---|---|---|
| Shared subexpressions | 13.7 | 1.27 | **5,313** | 1.20 | 1.08 | 1.01 | 1.00 | 1.02 | 1.06 | 1.06 |
| Effects | 8.9 | 0.83 | **2,319** | 1.35 | 1.03 | 1.25 | 1.06 | 1.51 | 1.29 | 1.17 |
| Application memo | 6.5 | 0.98 | 1.08 | **8.32** | 1.11 | 1.03 | 0.91 | 1.00 | 1.10 | 0.92 |
| Sequence terms | 4.5 | 1.00 | 1.04 | 1.02 | 0.89 | **3.08** | 1.04 | 1.01 | 1.05 | 1.03 |
| Type parse | 6.7 | 1.19 | **3.54** | **2.55** | 1.53 | 1.36 | 1.39 | 1.86 | 1.81 | 1.47 |
| Stored value | 5.8 | 1.03 | 1.02 | 1.07 | 1.20 | 1.04 | 0.96 | **1.99** | 1.02 | 0.83 |
| Sign | 10.7 | 1.05 | 1.34 | 1.12 | 1.15 | 1.29 | 0.95 | 1.29 | 1.63 | 1.00 |
| `Map` compile | 7.1 | 1.09 | 1.00 | 1.14 | 1.14 | 1.08 | 0.98 | 1.35 | 1.29 | 0.97 |
| Lazy value | 6.5 | 1.06 | 1.04 | 1.16 | 1.21 | 1.03 | 1.05 | 1.10 | 0.97 | 0.91 |
| Element | 5.1 | 1.04 | 1.02 | 1.06 | 0.85 | 1.11 | **2.23** | 1.13 | 1.03 | 0.98 |
| Facet | 4.2 | 1.05 | 1.02 | 0.96 | 1.05 | 0.91 | 1.02 | 0.89 | 0.94 | 0.97 |
| `at()` materialization | 5.5 | 1.01 | 0.96 | 1.01 | 1.07 | 1.01 | 0.98 | 1.07 | 0.95 | 0.97 |
| Slice bounds | 5.6 | 1.16 | 1.16 | 0.92 | 1.05 | 1.03 | 0.97 | 1.02 | 1.00 | 0.88 |
| Contour | 3.9 | 1.05 | 1.08 | 1.17 | 1.08 | 0.71 | 0.94 | 0.94 | 1.04 | 0.82 |
| Approximations | 12.3 | 1.09 | 1.12 | 1.13 | 0.94 | 1.08 | 0.95 | 1.02 | 1.16 | 1.03 |
| `Limit` probes | 10.0 | 1.00 | 1.06 | 1.00 | 1.04 | 0.97 | 1.01 | 0.99 | 1.04 | 1.11 |
| Eager source values | 7.3 | 1.01 | 0.96 | 0.95 | 1.00 | 0.99 | 1.02 | 1.00 | 0.92 | 1.13 |
| Factor | 5.9 | 1.26 | 1.09 | 1.30 | 0.99 | 0.88 | 1.00 | 0.89 | 0.97 | 1.10 |
| Dictionary | 7.3 | 1.01 | 1.19 | 1.09 | 1.10 | 0.93 | 0.99 | 0.97 | 1.15 | 1.05 |
| Enclosure endpoints | 10.8 | 0.91 | 0.85 | 0.89 | 1.17 | 0.92 | 1.04 | 0.84 | 0.85 | 0.84 |

The type parse ratios of `lazy-reads` and `map-compile` were measured after
`d7c8fe8b9`, which removed most of the reads of that cache; the other type
parse ratios were measured before it.

**The `Map` compile cache.** In `map-compile`, the element memo keeps the
elements of the view, so every drain after the first reads the element memo
and the `Map` compile cache is read once (the compile statistics
`ce._mapAutoCompileStats` show one compile attempt and 20,000 compiled
calls). With the element memo off, every drain compiles again with the
`Map` compile cache off (5 attempts) and reads the cache with it on (1
attempt), and the time is the same (169.8 ms and 168.7 ms): a compile attempt
is small next to 20,000 element calls. So the `Map` compile cache shows no
gain on full drains, and the element memo gives 2.2× on this workload. It
does save time when the elements are read one at a time with `at()`: each
`at()` is its own drain (section 3.5).

The four workloads not shown (`accumulator`, `limits-series`,
`compare-constants`, `simplify-factor`) show no ratio above 1.25 except for
the effects (up to 1.60), sign (up to 1.77), type parse (up to 2.25) and
`Map` compile (`limits-series` 1.22) caches. The `Limit` probe cache gives
1.25 on `limits-series`, at the edge of the noise.

**The tests that came with each cache.** A workload of this audit that
shows no gain does not prove that a cache has no use: several caches were
added for a slow case of a consumer. So 15 test files that check the number
of evaluations, walks or host calls ran in the probe worktree with each
candidate cache off (`npx jest -w 4`). All pass with all caches on (424
tests).

| Cache off | Result |
|---|---|
| Dictionary | `dictionary-shared-value-evaluation.test.ts`: the Jest worker ran out of memory. The memo of shared subexpressions does not cover a dictionary node (a `BoxedDictionary` is not evaluated through `BoxedFunction.evaluate`) |
| Lazy value | 6 failures: `ce-603-map-chain-element-evaluated-once.test.ts` (chains of 2, 4, 6 levels; a shared graph comparison) and `inert-evaluate-memo.test.ts` (a second evaluate of an inert node; a user function applied to its own result) |
| Element | 18 failures in `collection-element-memo.test.ts`, `comprehension-memo.test.ts`, `ce-516-lazy-chain-index-reads.test.ts`, `impure-stored-value-reads.test.ts`: linear scans become quadratic, and the invalidation tests (which check that a value is kept between reads) fail |
| `at()` materialization | 1 failure: `eager-collection-enumerability.test.ts`, "the evaluated form is computed once per walk, not per index" |
| Facet, slice, contour, approximations, `Limit` probes, eager source values, factor, enclosure endpoints, `Map` compile | All pass |

The commits that added the caches in the last row: the facet memo
`87a07c34c` (2026-08-14, "facet probe storm"), the slice bounds `e523dab98`
(2026-08-16), the `Limit` probes `a2b789283` (2026-07-02), the `Map` compile
cache `0eb257562` (2026-07-19), the factor memo `458389f6c` (2026-09-22), the
approximations `5e29489a6` (2026-09-24), the eager source values `c239f12f4`
(2026-10-16), the contour memos `f43af0ee1` (2026-10-18), the enclosure
endpoints `22d77a2ea` (2026-10-27).

The comment on `_memoizedFacet()` (`boxed-function.ts`) records the case of
the facet memo: the facet probes during canonicalization reached 210,000 per
document open (84% of the open), and without a deadline the allocation churn
exhausted a 4 GB heap. No workload of this audit reproduces that case.

### 3.5 The case that each cache was added for

The workloads of section 3.4 do not reproduce every case for which a cache
was added. So each of the seven caches that decision 1 of revision 2 proposed
to remove was timed on its own case, found in its comment, the commit that
added it, or its tests (`docs/scratch/2026-10-30-cache-audit-probes/origin/`).
Median of 5 runs after one warm-up, the cache on and then off in the same
pair, under the box lock (load average 6 to 32), two timed runs. Every probe
gave the same result digest with the cache on and off.

| Cache | Case and source | On → off (ms), ratio | Result |
|---|---|---|---|
| Slice bounds | Element reads of a `Slice(xs, RangeOf(xs, needle))` that was not evaluated (the test "the span is resolved once per node" in `sequence-search.test.ts`, commit `e523dab98`); 400 elements, needle of 100, `each()` and every `at(k)` | 0.47 → 7.69, 16.4; 0.43 → 7.83, 18.2. After `evaluate()` the span is a `Range` and there is no gain (0.88 to 0.96) | Keep |
| `Limit` probes | Gruntz limits at +∞ (commit `a2b789283`: compiled probes took nested-exponential limits from about 18 minutes to 4 ms); 6 limits | 31.3 → 139.9, 4.47; 25.7 → 123.2, 4.79. Probe compilations per run: 29 on, 603 off. The switch turns off only the cache, not the compiling | Keep |
| `Map` compile | `docs/plans/2026-07-19-map-auto-compile-design.md` (commit `0eb257562`): a numeric `Map` over 2,469 elements read in three ways | 5 full drains: 0.89; 1.03 (the element memo serves them). 5 drains with the element memo cleared: 1.40; 1.53. 500 `at()` reads: 8.2 → 766, 93; 7.6 → 645, 85 (500 compile attempts with the cache off) | Keep |
| Approximations | `Sort` of values closer than the rounding error, which alternates two precisions (comment; test `exact-ordering-fixes.test.ts`, commit `5e29489a6`); `Sort` and `Max` of 40 values `√(2 + k·10⁻³⁰)` | 22.7 → 37.8, 1.67; 20.5 → 35.7, 1.75 | Keep (just above 1.5) |
| Factor memo | Derivatives of `√(x+√(x+√(x+√(x+x))))` (comment; test `factor-nested-quotients.test.ts`, commit `458389f6c`) | 2nd derivative: 214 → 271, 1.26; 184 → 271, 1.47. 3rd derivative: 1,794 → 2,773, 1.55; 1,684 → 2,613, 1.55. Factorizations: 52 against 20,883 (2nd), 709 against 240,927 (3rd) | At the threshold |
| Contour memos | Residues, series and limits at algebraic and transcendental points, and contour integrals with algebraic poles (comments; commits `b82b50ef3`, `f43af0ee1`) | 431 → 489, 1.14; 411 → 431, 1.05. Contour integrals only: 1.14; 1.13 | No gain |
| Enclosure endpoints | Commit `22d77a2ea` records no slow case (a review moved the decodes that read the settings into this cache). Probe built for this audit: a 40-step Horner polynomial in two enclosures, `Max`, `Less`, `Sin`; and a variant with special-function endpoints | 408 → 455, 1.12; 360 → 391, 1.09. Variant: 1.15; 1.11 | No gain |

The factor memo cuts the number of factorizations by a factor of 400 on the
3rd derivative, but each factorization is cheap, so the time falls much less.
The number of factorizations without the memo grows exponentially with the
nesting depth of the input (the comment on `FACTOR_MEMO` records 1,166,395
for the 3rd derivative when the memo was added; it is 240,927 at
`d7c8fe8b9`).

## 4. The validity counters

### 4.1 Engine versions advanced by `noteStateEvent`

One function (`EngineConfigurationLifecycle.noteStateEvent`,
`engine-configuration-lifecycle.ts`) advances all of them. A write site
reports an event kind; `axisMaskOf()` and the conditions in
`noteStateEvent` select the versions.

| Counter | Advanced by | Read by | What it means |
|---|---|---|---|
| `_anyVersion` (and `_cacheGeneration()`) | Value writes (the ephemeral writes of a loop index included), declarations that are not scratch and not parameters, retypes, binding repairs, inferences (a value-type inference only later, when idle), assumptions, configuration, dirty scope pops | Rule G caches, the lazy value memo, the eager source values, the dictionary memo, protocol and declaration caches | Something changed |
| `_semanticVersion` | Non-ephemeral value writes, redefinitions of a callable, assumptions, configuration, signature inferences, scope pops that revert an assumption. **Not a retype** | `Map` compile, sequence fallback, derivative chains, the element memo, the erasure memo, declared-parameter results, `_definitionsKey()`, Epsil | A change that is not a loop index write, not a declaration and not a retype |
| `_worldVersion` | Redefinitions of a callable, assumptions, configuration, signature inferences, scope pops that revert an assumption | Rule D caches, the lazy value memo, the eager source values, `_definitionsKey()` | A rare global change. It does not move on a value write, a declaration, a retype, or an extension that replaces an `evaluate` handler |
| `_callableVersion` | The events of `callableAxisSelects()`: world events, callable value writes, declarations of callables, retypes and swaps, dirty pops | The effects cache, protocol caches | The effects of a callable can have changed |
| `_definitionVersion` | Retypes, declarations that shadow a callable, other callable events; not a scratch event, a fresh binding repair, or a narrowing inference | Contour memos, `Limit` probes, `declaredResultMemoKey()` (`boxed-expression/declared-parameter-result.ts`), `_definitionsKey()` (`boxed-expression/boxed-value-definition.ts`) | An existing definition changed |
| `_evaluationVersion` | Every event except a declaration that neither shadows a callable nor changes a frame binding, a clean scope pop, and a binding repair with no `any` advance | The shared memo | Something that a frame on the stack can read changed |
| `_persistentEvaluationVersion` | `_evaluationVersion` less the ephemeral value writes | The host handler check (`withHostHandlerCall()`) | A host handler changed state that outlives it |

### 4.2 Other counters

| Counter | Advanced by | Read by |
|---|---|---|
| Per-definition `_writeVersion` | A write to the definition | Dependency snapshots (rule D) |
| `_objectStoreEpoch` and per-object versions (`boxed-expression/object-deps.ts`) | A store to a field of a mutable object (`boxed-object.ts`) | Rule D caches, `cachedValue()`, the eager source values |
| `objectReadCount()` (`boxed-expression/object-deps.ts`) | Each read of an object field | The asynchronous route of the lazy value memo (`_settledLazyCollectionValueAsync()`) and the eager source values. The object-dependency collector cannot span an `await`, so these routes refuse to store when the count moved. It is a dependency check, not a fail-closed count |
| `_conformanceVersion`, `kindGeneration()` | Protocol conformance changes; the value-kind registry | Protocol and kind caches (no evaluated values) |
| `topLevelEvaluationEpoch()` (`boxed-expression/evaluation-epoch.ts`) | The start of each top-level evaluation; each asynchronous evaluation has its own | `Block` locals, the unresolved call memo, the host eager source values |
| `uncachedHostCallCount()` | Each call of host code that does not state its purity, and each host handler call that changed state | 16 store sites (section 5.1) |
| Fail-closed counts: `cycleDetectionCount()`, `sequenceReadStopCount()`, `reentrantSignatureReadCount()`, `incompleteWalkCount()`, `iterationLimitCancellationCount()`, `_lazyValueProvisionalReads` (`boxed-function.ts`), `_provisionalReads` (`cache.ts`) | A provisional answer, a cut cycle, a stopped read, an incomplete walk, an iteration limit | Each store site reads its own subset (section 5.1) |

### 4.3 Settings that change without a state event

These are compared field by field by the caches that need them: working
precision (`ce.precision`), decimal precision (`BigDecimal.precision`), the
precision requested by an enclosing `N(x, n)` (`_requestedPrecision`),
angular unit, rounding rule (`roundingTies`), tolerance, whether the
assumptions are hidden (`_factsHidden()`), the random seed frame
(`_randomFrame`), whether `verify()` runs (`isVerifying`), the registry of
host capabilities (`_evaluationEffects`), and the transient-configuration
window (`_atTransientConfiguration`), in which several caches do not store at
all.

Two of them are not engine fields that a setter changes:

- `BigDecimal.precision` is a static field of `src/big-decimal/big-decimal.ts`,
  shared by every engine of the process, with no setter. `src/` assigns it
  directly 99 times (26 in `numerics/special-functions.ts`, 18 in
  `src/big-decimal/transcendentals.ts`, 14 in
  `numeric-value/big-numeric-value.ts`, and others), mostly to open a
  temporary precision window.
- `_requestedPrecision` is assigned directly at 8 sites
  (`effects-registry.ts`, `library/core.ts`).

| Cache | Settings it compares |
|---|---|
| Shared memo | Working precision, requested precision, facts hidden, angular unit, random frame, verify flag, effects registry (7) |
| Approximations | Working precision, decimal precision, angular unit, rounding rule (4) |
| `Map` compile | Tolerance, angular unit, rounding rule (3) |
| Contour memos | Angular unit, working precision |
| Enclosure endpoints | Angular unit, working precision (not the rounding rule) |
| Element memo | Facts hidden; the transient window only when it stores the walk (CE-645). A change of the working precision or angular unit through the setter moves the world version (`_reset()`); a change inside a transient window does not |

The element memo must not compare the random frame: a materialized
collection keeps its draws when it is read under another seed frame
(`docs/RANDOMNESS-MODEL.md` §6).

### 4.4 Overlaps and gaps

- **Nested versions.** Every event that advances `_worldVersion` advances
  `_semanticVersion`, and every event that advances `_semanticVersion`
  advances `_anyVersion`, except a redefinition of a callable, which advances
  `semantic` and `world` but not `any` (`axisMaskOf`, case `redefine`). A
  cache that reads two of them reads more than it needs.
- **The world version does not see a change of definition.** A retype and an
  extension with `{ extend: true }` do not move it, and a retype does not
  move the semantic version either. `_definitionVersion` was added for the
  caches that need that. The probe `defchange.mts` (section 2.2) filled each
  value cache, retyped a symbol or extended an operator that the entry read,
  and read the same node again: only the derivative chains kept a value
  computed with the old definition after a retype (CE-647). The other value
  caches see a retype through their dependency snapshot or their generation.
  After an extension, a node boxed before it keeps the old definition object
  (CE-615), with or without the caches.
- **The evaluation version and the `any` version** differ only on
  declarations and clean scope pops. The `any` version moves at each call of
  a function literal (the activation of its parameters, CE-531, CE-334); the
  evaluation version does not.
- **Gap: the enclosure endpoint cache** keys on precision and angular unit,
  not on the rounding rule or a definition change. No probe found a wrong
  value, because the evaluation of `Enclosure` evaluates its endpoints
  before the cache reads them.
- **Gap: the derivative chains** do not read the host-code count (CE-628)
  and do not see a retype (CE-647).
- **Gap: the Rubi caches** do not read the host-code count (CE-648).
- **Known gaps already filed**: CE-645 (the element memo can store elements
  computed inside a temporary precision or angular-unit window), CE-621.1 to
  CE-621.4 (host rule on the asynchronous route and in the eager source
  store; .1, .3 and .4 fixed by step 1d), CE-615 (an extension does not reach
  expressions boxed before it), CE-36 (a derivation inside a cached type read
  can miss a widening). Filed during step 1: CE-657 (a cache keeps a random
  draw or an impure value when the node does not look impure) and CE-649 (an
  asynchronous host handler that evaluates its own node waits on itself).

## 5. Problems with the current structure

### 5.1 The store requirement is coded at each site

A cache may store a value only when the computation ran no host code that
the rule excludes and met no provisional answer. Today each site reads its
own subset of the counts. Number of reads of each count in the files that
store an evaluated value (`grep -c`, HEAD `9b86a0932`):

| File | host | cycle | sequence stop | re-entrant signature | incomplete walk | iteration limit | provisional |
|---|---|---|---|---|---|---|---|
| `shared-evaluation-memo.ts` | 1 | 1 | 1 | 1 | 0 | 0 | 1 |
| `function-utils.ts` (application memo) | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| `boxed-function.ts` (lazy value, facet, `at()`) | 10 | 6 | 0 | 0 | 14 | 2 | 17 |
| `collection-element-memo.ts` | 7 | 0 | 7 | 0 | 7 | 0 | 0 |
| `library/collections.ts` (slice) | 2 | 0 | 0 | 0 | 7 | 0 | 0 |
| `boxed-symbol.ts` (stored value) | 2 | 2 | 2 | 0 | 0 | 0 | 0 |
| `sequence.ts` | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| `symbolic/contour.ts` | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| `boxed-expression/compare.ts` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `symbolic/limit.ts` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `library/map-auto-compile.ts` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `eager-source-values.ts` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `symbolic/derivative.ts` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `boxed-dictionary.ts` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `boxed-expression/factor.ts` | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| `boxed-expression/cache.ts` (`cachedValue`) | 0 | 1 | 0 | 0 | 0 | 0 | 9 |

Some of the zeros are correct (a count that cannot move under that
computation). The table shows why a review could not tell: the reason for
each zero is not written anywhere. Each new count (the host count was the
latest) must be added to each site by hand.

### 5.2 The same rule is written several times

Rule D is written in the element memo (with the most detail), and again in
the application memo, the stored value memo, the slice memo, the facet memo,
the sequence memo, the `Limit` probes, the derivative chains and the `Map`
compile cache, each with its own entry type and its own subset of the
stamps (facts hidden, object-store epoch or object dependencies, definition
version, semantic version, scope).

### 5.3 Each function call clears the generation caches

The `any` version moves at each call of a function literal, so each rule G
entry is out of date after a call. The hit counts in section 3.3 show that
every generation miss on the two Tycho benchmarks gave the same answer again.
CE-531, CE-334 and CE-321 record the cost and the reason a simple exemption
is not sound: a body node can read the value of a parameter through the call
frame (`BoxedSymbol.sgn` reads the value by name).

## 6. Proposed design

### 6.1 Five kinds of cache

| Kind | Rule | Lifetime | Members |
|---|---|---|---|
| **Description** | One version: the `any` generation (types, signs, structural forms, LaTeX) or the callable version (effects). No evaluation runs while it computes, so no host rule | One node | Type, sign, effects, structural form, LaTeX strings, call result types |
| **Value with generation** | The `any` generation (G), or G+ for the constant entries of the lazy value memo; the store guard (6.2) | One node | Lazy value memo, `at()` materialization, factor memo (symbolic inputs), contour zero verdicts with non-constant symbols |
| **Value with dependencies** | One dependency stamp (6.4); the store guard | One node, literal, symbol or sequence | Application, element, facet, slice, stored value, sequence terms, `Limit` probes, `Map` compile, derivative chains |
| **One evaluation** | Evaluation version, impure count, the numeric context stamp (6.3) and the other settings of the shared memo; the store guard; the entries die when the evaluation ends | One top-level evaluation (the dictionary memo: one outermost dictionary evaluation) | Shared subexpressions, eager source values, dictionary memo, Rubi memos (one integration call) |
| **Constant structure** | Structure, the numeric context stamp, the definition version and the world version; only for expressions whose symbols are all constants; the store guard | One engine, bounded (2,000 entries for the contour memos) or one node (weak map) | Contour memos (constant entries), approximations, enclosure endpoints, factor memo (constant inputs) |

The lazy value memo and the `at()` cell stay on the generation rule. Their
generation key is what invalidates a body node's value after each call of a
function literal (CE-334, CE-531); a change to rule D would need its own
soundness argument and tests, and no measurement shows a benefit.

"Stays separate" in this document means: the cache keeps its own entry type
and its own code, and is converted to the store guard and the stamps like the
others. No cache is exempt from the store guard except the compiler fold
memos (a compiled function is a snapshot by design).

### 6.2 One store guard

A new module (proposed name `boxed-expression/store-guard.ts`) holds the list
of the counts of section 4.2 that tell a store to stop, and imports the
functions that read them from the modules that own them:

```ts
const guard = beginStoreGuard(); // samples every count
const value = compute();
if (guard.allowsStore(ACCEPTS)) store(value); // ACCEPTS: the counts this site accepts
```

- One place applies the host-code rule. A new count is added once, and each
  site then refuses a store when it moved, unless the site's accept list
  names it.
- **The accept list of each site is explicit**, written next to the store,
  with the reason for each accepted count. The first conversion (step 1b)
  gives each site the accept list that reproduces what it reads today, so
  that no store decision changes: a site accepts every count that it does not
  read today (section 5.1). Narrowing an accept list is a separate commit per
  site (step 1c).
- **Sites that define a result** keep exactly today's accept list: the
  element memo (one instance gives one draw set) and the eager source values
  (host code runs once per evaluation). For them, refusing more stores would
  change how often host code runs or which random draws a read sees.
- **`objectReadCount()` is not in the guard**: it is a dependency check. The
  asynchronous route of the lazy value memo and the eager source values keep
  their own comparison of it next to the guard; the guard does not replace
  it.
- **Concurrency.** The counts are process-wide. Two asynchronous evaluations
  that run at the same time move each other's counts, so the guard refuses
  more stores than needed under concurrency, never fewer. It does not fix
  the CE-621 gaps, which are about ownership and release of entries, not
  about counts (step 1d).
- `failClosedCount()` in `shared-evaluation-memo.ts` becomes this guard.
- Cost: a guard samples about eight integers. Step 1b measures `shared-max-22`
  (the workload with the most stores per millisecond) before and after.

Step 1b's accept lists, from section 5.1 (a count that the site reads today
is refused; every other count is accepted):

| Site | Refused today (so refused by the guard in 1b) | Accepted in 1b |
|---|---|---|
| Shared memo | host, cycle, sequence stop, re-entrant signature, provisional | incomplete walk, iteration limit |
| Application memo | host, sequence stop | the other five |
| Lazy value, facet, `at()` | host, cycle, incomplete walk, iteration limit, provisional | sequence stop, re-entrant signature |
| Element memo | host, sequence stop, incomplete walk | the other four (kept: defines a result) |
| Slice bounds | host, incomplete walk | the other five |
| Stored value | host, cycle, sequence stop | the other four |
| Sequence, contour, approximations, `Limit` probes, `Map` compile, eager source values | host | the other six (eager source values: kept, defines a result) |
| Derivative chains (after CE-628), Rubi memos (after CE-648) | host | the other six |
| Factor memo | cycle | the other six |
| `cachedValue()` | cycle, provisional | the other five |
| Dictionary memo | none | all seven (step 4 changes this) |

The table counts per file; where one file holds several caches (the lazy
value, facet and `at()` caches), step 1b reads each store site and writes the
subset that site reads.

**What step 1 does (decision 6, option (a)).** Every site refuses a store
when any count moved, except three sites that keep exactly the rule they had
before step 1, because their store decision defines a result:

| Site | Rule kept | Why |
|---|---|---|
| Element memo | Refuses on host, sequence stop and incomplete walk only | One instance gives one set of random draws |
| Eager source values | Refuses on host only | Host code runs once per evaluation |
| `at()` cell | Is cleared on host only | The cell value ends a recursive read of the same node |

Two sites accept one or two counts for a stated reason, and the sequence term
memo refuses more than before (the commit message of `5029c5d77` says that it
keeps its counts; the code does not):

| Site | Rule after step 1 | Before step 1 |
|---|---|---|
| Shared memo | Accepts `incompleteWalk` (compared with its own sample, which a taken-back walk can bring below the guard's) and `lazyValueProvisional` (a re-entrant lazy-collection evaluation computes the full value of its node in its own frame) | Refused host, cycle, sequence stop, re-entrant signature |
| Application memo | Accepts `lazyValueProvisional` and `reentrantSignature` (the first application of a recursive function reads its own signature while it is derived) | Refused host, sequence stop |
| Sequence term memo | Accepts `lazyValueProvisional` only | Refused host only. The review of 2026-10-30 found no input where a newly refused count moves while the terms stay numeric (a stopped read already declines its own terms); the effect is fewer stores. CE-657 decides whether this memo defines a result (one draw per term) |

The paired benchmark of step 1 on the 13 workloads gave median ratios from
0.93 to 1.06, and no round above 1.19.

### 6.3 One numeric context stamp

The settings that can change a numeric value are interned: each new
combination gets an integer (`ce._numericContextStamp()`). It covers the
working precision, the requested precision, the angular unit, the rounding
rule and the tolerance. A cache compares one integer instead of up to five
fields. This also closes the class of defect where a cache forgot a setting
(the enclosure endpoint cache does not compare the rounding rule).

Rules:

- **How a change is detected.** The stamp is computed again by the setters of
  the working precision, the angular unit, the rounding rule and the
  tolerance, by `_withTransientPrecision()` and `_withTransientAngularUnit()`
  (`engine-numeric-configuration.ts`) at entry and exit, and by the code that
  sets `_requestedPrecision`. Step 2 routes the 8 direct assignments of
  `_requestedPrecision` through one function that also refreshes the stamp.
  A checkpoint restore computes it again after it sets the configuration
  (a restore does not call the setters).
- **Not in the stamp: `BigDecimal.precision`.** It is process-wide, shared by
  every engine, and assigned directly 99 times. A cache that depends on it
  (the approximations) keeps comparing it at each look-up, as it does today.
  Routing the 99 writes through one function is not part of this plan.
- **Not in the stamp: the random frame, the verify flag, the effects
  registry, the facts-hidden flag.** The shared memo keeps comparing these
  four itself. The element memo must not compare the random frame
  (`docs/RANDOMNESS-MODEL.md` §6); the facts-hidden flag is part of the
  dependency stamp (6.4).
- **Which caches read it:** the shared memo, the approximations, the contour
  memos, the `Map` compile cache, the enclosure endpoint cache, the
  application memo (which keys on precision today) and the sequence terms
  (numeric memo), and the element memo. For the element memo, reading the
  stamp at the start of a walk and at its store fixes CE-645: a walk during
  which a transient window changed the precision or the angular unit is not
  stored. A cache that reads more settings than it needs gets more misses,
  never a wrong value.

### 6.4 One dependency stamp

`snapshotMemoDeps()` and `memoDepsStillValid()` already exist in
`collection-element-memo.ts`. The proposal moves them into one type
(`ValueStamp`) with two functions (`stampNow(expr)`,
`stampStillValid(stamp)`). A `ValueStamp` holds:

- the world version and the definition version;
- the numeric context stamp (6.3);
- the facts-hidden flag;
- the lexical scope of the read (`ce.context?.lexicalScope`), which the
  element memo compares today: without it, a value of another call frame can
  be served (the failure recorded in CE-334);
- the semantic version, for the caches that read it today (element memo,
  `Map` compile, sequence fallback, derivative chains), until step 6 decides
  per cache;
- the dependency snapshot and the object dependencies.

Each value cache keeps its own entry type and replaces its stamp fields with
one `ValueStamp`.

**When a stamp is taken during an iteration.** The element memo fills its
entry over several pulls of an iterator, and it checks state between pulls.
The `ValueStamp` replaces only two of its stamps:

- the baseline, taken after `each()` returns and before the first pull (the
  rule of CE-620);
- the stamp compared when the walk is stored.

Its other checks stay as they are: the comparison between pulls that tells
the element body's own writes from a consumer's writes (`suspendedWrite`,
`suspendedEpochChange`, `suspendedScopeChange`), the refusal of a mixed
buffer, and the refusal while an iterator is suspended. Tests: a change
before the first pull, a change between two pulls by the consumer, a change
by the element body, and a suspended iterator that resumes after a change.

### 6.5 Which caches go, which stay separate

- **The dictionary memo is not merged into the shared memo.** Their lifetimes
  differ: the dictionary memo lives for the outermost dictionary evaluation;
  the shared memo is started by `BoxedFunction.evaluate()`, is off when the
  engine has objects or a debugger hook, and is used only for plain and
  numeric evaluations. A standalone `BoxedDictionary.evaluate()` starts no
  shared memo, and without the dictionary memo
  `dictionary-shared-value-evaluation.test.ts` (CE-372) runs out of memory.
  Instead, step 4 gives the dictionary memo the store guard (it has no host
  rule today) and the settings of the shared memo.
- **Remove** (decision 1): the two caches with no measured gain on any
  workload or on their own case (section 3.5): the contour memos and the
  enclosure endpoint cache. The factor memo is at the threshold (decision 1).
- **Stay separate**, with a reason (besides the caches that save time on the
  workloads):
  - the slice bounds memo, the `Limit` probes, the `Map` compile cache and the
    approximations: each saves time on the case it was added for (section
    3.5); the probe of each case becomes a workload of the driver;
  - the element memo: it defines a result (one instance, one draw set);
  - the eager source values: they define how often host code runs in one
    evaluation;
  - the facet memo: its recorded case (210,000 facet probes in one document
    open, a 4 GB heap without the memo) is not reproduced by the workloads;
  - the per-read terms of a sequence: without them a recurrence is
    exponential within one read;
  - the type cache: without it no workload finishes, and it is the
    terminator of a recursive type read (the empty-cell answer of
    `cachedValue()`);
  - the effects cache: the shared memo reads `isPure` at each node;
  - the dictionary memo: see above;
  - the Rubi memos: one integration call; they get the store guard
    (CE-648);
  - the compiler fold memos: one compile, and a compiled function is a
    snapshot by design.

### 6.6 Checkpoint and restore

`docs/CHECKPOINT-MODEL.md` requires that a memo either has a version key that
a restore advances, or has its writes journaled so that a restore drops the
entries made after the checkpoint.

- The "Constant structure" kind keeps the world version in its key (the
  lazy value memo's constant entries are sound for the same reason: a
  redefinition advances the world version).
- The numeric context stamp is derived state: a restore computes it again
  (6.3). It is not journaled.
- The `Limit` probe cache is one of the two "unstamped expression-keyed
  memos" that the checkpoint journal lists. It stays (section 3.5), so its
  journal hook stays until step 3b gives it a version key that a restore
  advances.
- Steps 2, 3 and 5 update `docs/CHECKPOINT-MODEL.md` and run
  `test/compute-engine/checkpoint-journal.test.ts`; step 3 adds a test that
  fills a value cache after a checkpoint, restores, and reads the entry.

## 7. Migration plan

Each step can land alone. No step may change a result except to fix a defect;
each such defect is filed in `ROADMAP.md` with a `CE-<n>` number first.
"Benchmark" means the workload driver of step 0 plus
`benchmarks/tycho-document-open/evaluate.ts` and `rebind.ts`, under the box
lock, paired with a baseline run made just before. All test paths are under
`test/compute-engine/`.

| Step | Requires | Change | Tests | Benchmark |
|---|---|---|---|---|
| 0 | — | Keep the off switches (`CE_CACHE_OFF`, read once, like `CE_CACHE_STATS`) and add the workload driver as `benchmarks/evaluation-caches.ts`. Pass criteria of the switch test: each switch name matches a cache, and with each switch on alone the 13 workloads give the same digests as with all caches on | `cache-stats-member.test.ts`, a new switch test | The driver itself; record the baseline |
| 1a | — | Fix CE-628, CE-647 (the derivative chains read the host count and the definition version) and CE-648 (the Rubi memos read the host count). Nothing else | `derivative-closed-form-cache.test.ts`, new tests from the repros of the three entries, the Rubi tests (`rubi-utils.test.ts`) | `simplify-factor` |
| 1b | 1a | Add the store guard (6.2) and convert every store site with the accept list of the table in 6.2, so that no store decision changes | `ce-601-shared-evaluation.test.ts`, `impure-stored-value-reads.test.ts`, `inert-evaluate-memo.test.ts`, `collection-element-memo.test.ts`, `comprehension-memo.test.ts`, `sequences.test.ts`, `declare-extend.test.ts`, `recursive-application-memo-across-evaluations.test.ts`, `object-caching.test.ts`, the full suite (the change is under `boxed-expression/`) | `shared-max-22` (cost of the guard), all workloads (no change expected) |
| 1c | 1b | With 1b in one change (decision 6). Narrow the accept list of every site (not the element memo or the eager source values), each with a test that counts host calls or random draws on that site | The site's own tests and the new one | The workload of that site |
| 1d | 1b | CE-621: one change and one deterministic test per item. .1 (concurrent `evaluateAsync()` calls join one pending promise), .3 (look-up order of the eager source values), .4 (release after a synchronous throw); .2 (a nested asynchronous evaluation releases its parent's host values) needs one in-progress count per evaluation number, shared by the synchronous and asynchronous routes | A new test per CE-621 item, and an asynchronous read, field store, read test for `objectReadCount()` | — |
| 2 | 1b | Numeric context stamp (6.3); replace the settings fields of the shared memo, the approximations, the contour memos, the `Map` compile cache, the enclosure endpoint cache, the application memo, the sequence numeric memo and the element memo (fixes CE-645); route the `_requestedPrecision` writes through one function | `ce-601-shared-evaluation.test.ts`, `relational-operators.test.ts`, `compare-set-and-scalar-or-collection.test.ts`, `limit-*.test.ts`, `compile-lazy-collections.test.ts`, `checkpoint-journal.test.ts`, a new test per cache that changes each setting through the setter and inside a transient window, a test with two engines at different precisions, a test of the CE-645 repro, a test that reads one random collection under two seed frames and outside both and gets the same draws | `compare-constants`, `limits-series`, `map-compile` |
| 3a | — | Count, on the two Tycho document benchmarks, the `type-write` events that come from an explicit retype or extension and those that come from an inference. Report the counts to the user for decision 3 | — | `tycho-evaluate`, `rebind` |
| 3b | 1b, 2, 3a | Dependency stamp (6.4) for the value-with-dependencies caches, one cache per commit. For each cache, a test that fills an entry, retypes a symbol it read, and reads the same entry; and a test that fills an entry, extends an operator it read, and compares the same entry with the value computed with the cache off (CE-615 decides what a node boxed before the extension gives; the test checks only that the cache does not change it). Decision 3 is (c) (user decision 2026-10-30), so this step also adds a flag on the `type-write` event that tells an explicit retype from an inferred one, makes an explicit retype and an extension with `{ extend: true }` move the world version, and moves the readers of `_definitionVersion` that read it only to see a retype or an extension to the world version, with a test of each | The cache's own tests, the new ones, `lambda-param-collection-inference.test.ts` and `recursive-application-memo-across-evaluations.test.ts` for the element and application memos, `checkpoint-journal.test.ts` with a restore test | The workload of that cache |
| 4 | 1b, 2 | The dictionary memo: store guard with no accepted host count, and the settings of the shared memo (6.5) | `dictionary-shared-value-evaluation.test.ts`, extended with a standalone `BoxedDictionary.evaluate()`, an engine with objects, a debugger hook, `evaluateAsync()`, and a dictionary that holds a host call | A new dictionary workload |
| 5 | 0 | Remove the caches of decision 1 (option (a): the contour memos and the enclosure endpoint cache), one commit each. Can land before steps 1 to 3, so that the removed caches are not converted first. Add the probes of section 3.5 for the kept caches to the workload driver | Their own tests (a test that checks only that a cache hit happens is removed with the cache), the residue, series and contour-integral tests, the enclosure tests | All workloads, and the contour and enclosure probes of section 3.5 |
| 6 | 3b | Counters: for each cache that reads both the semantic version and a dependency snapshot (`Map` compile, derivative chains, element memo), decide whether the semantic version is still needed; remove it only with a test that shows the snapshot sees each event the semantic version saw. The element memo keeps it for its between-pull checks | `compile-lazy-collections.test.ts`, `derivative-closed-form-cache.test.ts`, `collection-element-memo.test.ts` | `map-compile` |
| 7 | 3b | Not done (decision 2 is no). Only with decision 2: a per-activation key for the description caches of body nodes (CE-531, CE-334, CE-321) | `lambda-param-collection-inference.test.ts`, `inert-evaluate-memo.test.ts`, `ce-535-531-binder-declaration-cache.test.ts`, the full suite | `recursion-fib`, `type-reads`, Tycho row 453 repro |

**Steps 0 and 1 as done** (session `compute-engine-3e`, staged 2026-10-30;
from that session's report):

- Step 0: the off switches and `benchmarks/evaluation-caches.ts`, with the
  corrected `Map` workloads (a 150,000-element drain, larger than the element
  memo's cap, and a check that the compile statistics moved).
- Steps 1a to 1c, in one change (decision 6): the fixes of CE-628, CE-647 and
  CE-648, and the store guard with the rules of the table in 6.2.
  `objectReadCount()` stays a separate check next to the guard.
- Step 1d: CE-621.1, .3 and .4 fixed with tests; CE-621.2 stays open.
- Beyond the plan:
  - The lazy value memo no longer gives the constant key (rule G+) to a node
    that calls a user function, to a dictionary that holds such a call, or
    to an operator that the host declared in the system scope.
  - An asynchronous evaluation that joins another one's pending walk reads
    the memo in its own context; when the joined walk is rejected, it runs
    its own walk; an impure node never joins.
- Taken out of step 1 by user decision (2026-10-30, option (b)) and filed:
  CE-657, a cache keeps a random draw or the value of an impure operator when
  the node does not look impure (four designs were tried and none held; it
  needs a design).
- Also filed: CE-649, an asynchronous host handler that evaluates the node
  that contains it waits on itself (design options: `AsyncLocalStorage`, or
  never join for a caller that host code started).

## 8. Open decisions

### Decision 1: remove the caches that have no measured benefit?

**User decision 2026-10-30: option (a).** Step 5 removes the contour memos
and the enclosure endpoint cache, one commit each; the factor memo stays.

**The situation.** Each cache is code that must follow the host-code rule and
the fail-closed rules; each review round of CE-601 found a cache that did
not. The audit turned off each cache, timed 13 workloads (the two Tycho
document benchmarks among them) in pairs with a baseline, and ran 15 test
files that count evaluations. Nine caches show no gain on any workload and no
failing test. Then each of them was timed on the case it was added for
(section 3.5). Four save time there: the slice bounds memo (16×), the
`Limit` probes (4.5×), the `Map` compile cache (85× on repeated `at()`
reads) and the approximations (1.7×). Two stay for a reason that no probe
shows (section 6.5): the facet memo and the eager source values. That leaves
three:

- the contour memos: no gain on any workload or on their case (1.05 to
  1.14);
- the enclosure endpoint cache: no gain (1.09 to 1.15), and its commit
  records no slow case;
- the factor memo: at the threshold. On the second derivative of
  `√(x+√(x+√(x+√(x+x))))` (the case in its comment) it saves 1.26 to 1.47×;
  on the third derivative, 1.55×. Without it, the number of factorizations
  grows exponentially with the nesting depth (709 against 240,927 on the
  third derivative).

**The removal rule.** A cache is removed only when all three hold: (1) no
workload gives a ratio above 1.5 in a paired run; (2) no test fails with the
cache off; (3) a probe made from the case for which the cache was added
gives a ratio of 1.5 or less.

**Example.** The contour memos keep, for each constant expression, whether
it is exactly 0 and its exact real and imaginary parts. A residue at
`1 + √2` asks this of the same constants several times. Five residues, two
series, one limit and eight contour integrals take 431 ms with the memos and
489 ms without them (1.14), inside the noise. Each conversion to the store
guard and the stamps is code to review at each new rule, and each review
round of CE-601 found a cache that did not follow the rule of the moment.

**Options.**

- (a) Remove the contour memos and the enclosure endpoint cache (migration
  step 5), each in its own commit; keep the factor memo. Less code to keep
  correct. The risk: a consumer case that no probe reproduces becomes slower.
  A removed cache comes back by reverting its commit.
- (b) Remove the factor memo too. It is the only one of the three that
  changes the growth rate of a computation, so a deeper nesting than the
  test's case can become much slower.
- (c) Keep all three and convert them to the store guard and the stamps
  (steps 1 to 3). No risk of a slowdown; the code stays.
- If nothing is decided: they stay, as in (c).

**Recommendation.** (a). The factor memo turns an exponential walk into a
linear one; a measured 1.5× on a small input is the lower bound of what it
saves on a larger one.

### Decision 2: give the type and sign caches a key per call now?

**User decision 2026-10-30: no (option (b)).** The decision of 2026-09-24
in CE-334 stays; step 7 is not done.

**The situation.** Each call of a user function declares its parameters in a
new scope. That declaration advances the engine's `any` version, which is
the key of the type, sign and structural caches of every node. So after a
call, every cached type in the engine is out of date and is computed again
on its next read.

**Example.** On the Tycho `evaluate` benchmark, 28,672 type reads missed
because of such an advance, and each of them computed the same type again.
That is 0.5% of 6.3 million type reads. CE-334 measured an upper bound of the
gain on a document of noise functions: 465 → 442 ms (5%); a list recursion:
77 → 52 ms (30%).

**Options.**

- (a) Design a key per activation now (step 7). It changes the type cache,
  which every evaluation uses; CE-334 found that the simple version (no
  advance at a call) gives wrong results (a base case of a recursion read
  the answer of the first call).
- (b) Keep the decision of 2026-09-24 in CE-334 ("no general per-call cache
  design now"). Steps 0 to 6 do not need it.
- If nothing is decided: (b).

**Recommendation.** (b): the measured gain on the real workloads is small
(0.5% of the type reads, 5% on the noise document).

### Decision 3: must the world version move when a definition changes?

**User decision 2026-10-30: option (c)**, below the user comment: an
explicit retype and an extension with `{ extend: true }` move the world
version; the retypes that an inference makes and the declarations that
shadow a callable do not. Step 3b implements it. The step 3a counts (at the
end of this section) show no explicit retype or extension on the two Tycho
document benchmarks, so (c) adds no world event there.

**The situation.** The value caches check the world version, which moves on
rare global events only. A retype or an extension with `{ extend: true }`
does not move it. So a second counter, `_definitionVersion`, exists. Four
caches read it: the contour memos, the `Limit` probes, the declared-parameter
results (`declaredResultMemoKey()`) and the value-definition key
(`_definitionsKey()`). The other value caches rely on their dependency
snapshot to see a changed definition; the probe of section 4.4 found one
that does not (CE-647).

**Example.** `ce.declare('g', { evaluate: … }, { extend: true })` gives `g`
a new `evaluate` handler. The world version does not move. A cache that keys
on the world version and keeps a value computed with the old `g` sees the
change only if its snapshot recorded `g`. (CE-615 is a separate problem: an
expression boxed before the extension keeps the old definition object.)

**Options.**

- (a) Make the world version move on every event that moves the definition
  version, and remove `_definitionVersion`. One counter less, and the value
  caches see every definition change. Cost: the definition version moves on
  each retype and on each declaration that shadows a callable; those events
  are frequent while a document is typed (the comment on `definitionVersion`
  in `engine-configuration-lifecycle.ts` records that a narrowing inference
  made a Tycho document three times slower when it was counted). The four
  readers move to the world version, and the regressions named in that
  comment (the signature derivations) must be measured on the Tycho document
  benchmarks first.
- (b) Keep the two counters, and put both in the dependency stamp (6.4), so
  that every value cache reads both. One integer comparison more per
  look-up.
- If nothing is decided: (b) is what step 3b does.

**Recommendation.** (b).

**User comment 2026-10-30.** An explicit retype or extension of a symbol is
very rare, and the user accepts to make it a world event if that makes the
logic simpler. This is a third option: (c) an explicit retype (a `declare`
or a type assignment by the caller) and an extension with `{ extend: true }`
move the world version; the `type-write` events that an inference emits (for
example the operator-to-value swap in `boxed-symbol.ts`) and the
declarations that shadow a callable do not. The same event kind
`type-write` is used today for both, so (c) needs a flag on the event that
tells an explicit retype from an inferred one. Step 3 measures, on the Tycho
document benchmarks, how often each kind occurs, then decides between (b)
and (c). If (c) is chosen, the caches that read `_definitionVersion` only to
see a retype or an extension can read the world version instead.

(Revision 2: the measurement is step 3a, and the flag is part of step 3b.
The decision between (b) and (c) is the user's, with the counts of step 3a.)

**Step 3a result (2026-10-30, HEAD `d7c8fe8b9`).** A probe counted each
event that advances the definition version on the two Tycho document
benchmarks, with the code site that caused it (one run each, under the box
lock; the counter is `event-sites.patch` in
`docs/scratch/2026-10-30-cache-audit-probes/`).

| Event | `evaluate` | `rebind` |
|---|---|---|
| Explicit retype (`declare` of an existing name, a type assignment by the caller) or extension with `{ extend: true }` | 0 | 0 |
| `type-write` from an inference: the type that an assignment gives to a binding that was typed only from its uses (`writeEvidenceType()`, `library/core.ts`) | 10 | 200 |
| `type-write` from an inference: the type that an assignment derives when the incumbent type is a callable guess (`deriveAndWriteAssignedType()`, `engine-declarations.ts`) | 10 | 0 |
| Declaration that shadows a callable (`declareSymbolValue()`) | 0 | 38 |
| Signature inference | 0 | 2 |
| Configuration (`_reset()`: engine creation, precision, angular unit) | 3 | 3 |

All 20 and 200 `type-write` events change a binding from a callable type to
a value type. So on these benchmarks option (c) adds no world event. Option
(a) adds 20 world events on `evaluate` and 238 on `rebind` (the
`type-write` events and the shadowing declarations; the configuration events
and the signature inferences move the world version already). Each added
world event empties every value cache that keys on the world version.

### Decision 5 (user request 2026-10-30): static types instead of type strings

The type parse cache is effective, but a type that is known when the source
is written does not need a parse or a cache read at run time. A separate
pass finds the calls of `parseType()` with a literal string (72 in `src/`
at the time of writing) and the type strings in definitions that are parsed
on each read, and replaces them with `Type` objects built once at module
load. This pass is independent of the migration steps.

(Revision 2: commit `d7c8fe8b9` did this for the hot run-time sites: the
parse cache reads of `tycho-evaluate` dropped from 463,619 to 2,270. Type
strings parsed when a definition is built are left as they are, once per
engine.)

### Decision 4 (already open): CE-615

Whether an extension must reach the expressions boxed before it. It is a
binding problem, not a cache problem. Step 3b's extension tests do not depend
on the answer: they compare the cached read with the read with the cache off.

### Decision 6: narrow the store-guard accept lists in one commit or one per site?

**User decision 2026-10-30: option (a).** Steps 1b and 1c land as one
change, on the conditions of the recommendation below: a paired benchmark
on all 13 workloads shows no ratio above 1.25, and the element memo and the
eager source values keep the counts they read today.

**The situation.** Section 5.1 shows that each store site reads its own
subset of the seven fail-closed counts. The store guard makes every site
refuse a store when any count moved, unless the site names the count in its
accept list. Session `compute-engine-3e` has converted every site in one
change, with most sites refusing more counts than they read today (the
element memo and the eager source values keep today's set).

**Example.** The slice bounds memo reads the host count and the
incomplete-walk count today. After the change it also refuses a store when a
cycle was cut during the computation. A `Slice` whose bounds were computed
while a cycle guard cut a recursive read is then computed again on the next
read instead of served from the memo. The value is the same; the time is
longer.

**Options.**

- (a) Keep the one-commit change (steps 1b and 1c together). Less work; a
  refused store gives the same value, so the results do not change. The risk:
  if one site's narrowing makes a workload slower, the cause is harder to
  find in one commit.
- (b) Split as section 7 says: 1b reproduces today's subsets exactly, then
  one commit per site narrows it, each with a test.
- If nothing is decided: (a), because the work exists and passed the full
  suite.

**Recommendation.** (a), on the condition that the benchmark of step 1b runs
paired on all 13 workloads and shows no ratio above 1.25, and that the
element memo and the eager source values keep today's accept lists.

## 9. How to repeat the measurements

Everything is in `docs/scratch/2026-10-30-cache-audit-probes/`: the switch
patch (apply it in a linked worktree at `d7c8fe8b9`), the workload driver, the
three timing scripts and the probes. Its README says how to run each one.
The timing logs stayed in the session scratchpad and are not kept.

## 10. Where each review finding of revision 1 is handled

Findings of `docs/scratch/EVALUATION-CACHE-ARCHITECTURE_SPEC_REVIEW.md`:

| Finding | Where |
|---|---|
| 1 `BigDecimal.precision` | 4.3, 6.3 |
| 2 CE-621 | 6.2 (concurrency), step 1d |
| 3 Accept lists, step 1 split | 6.2 table, steps 1a to 1c, decision 6 |
| 4 Scope and semantic version | 6.4 |
| 5 Random frame | 4.3, 6.3, step 2 test |
| 6 `objectReadCount()` | 4.2, 6.2, step 1b test |
| 7 Lazy value and `at()` rule | 6.1 (they stay on rule G) |
| 8 Base out of date | Header, 4.3, 4.4 (CE-620 removed, CE-645 added), step 2 |
| 9 Nine or eight | 1, 3.5, 6.5, decision 1 (each cache timed on its own case) |
| 10 "The switches make it simple to put one back" | Decision 1 (revert of one commit) |
| 11 Facet memo, removal rule | 3.4, 6.5, decision 1 |
| 12 Checkpoint | 6.6, steps 2, 3b, 5 |
| 13 Retype and extension probes | 2.2, 4.4, CE-647 |
| 14 Tests of invalidation | Step 3b |
| 15 Decision 3 option (c) | Steps 3a, 3b; decision 3 |
| 16 Readers of the definition version | 4.1, decision 3 |
| 17 Stamps during an iteration | 6.4 |
| 18 Dictionary merge | 6.5 (no merge), step 4 |
| 19 Factor and contour entries | 3.1, 3.2, 6.1 |
| 20 Rubi memos | 2.2, CE-648, step 1a |
| 21 Full list, state dimensions | Appendix, 3.1 |
| 22 "Stay separate", lifetimes | 6.1 |
| 23 Probe results | 2.2 |
| 24 Evidence in the scratchpad | 9 |
| 25 "With no imports" | 6.2 |
| 26 Step order, paths, pass criteria | 7 |
