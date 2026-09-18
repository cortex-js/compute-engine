# Codegen optimization advice from the CE 0.128.13 all-states audit

Reviewed 2026-09-16 against compute-engine HEAD `c5a6272e`.

Update: the priority list below is historical. See the
[September 18 reassessment](2026-09-18-codegen-reassessment.md) for landed fixes,
current-source probes, and the next recommendations.

Input: `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.128.13-all-tycho5ce55d2bd.json`.
Design context: [interval collection handoff](2026-09-15-interval-js-collection-lowerings-handoff.md), especially sections 8–9.
This is an advisory review; no compiler implementation was changed.

## Scope and baseline

The file has 18,697 records from 684 documents. Counts below are records, not
runtime execution frequencies; `occurrences` is not used as a performance
weight. `durationMs` measures compilation, not generated-kernel execution.

| Target | Success | Decline | Documents with a decline | Median / p99 source characters, successful records |
| --- | ---: | ---: | ---: | ---: |
| JavaScript | 8,934 | 112 | 38 | 137 / 3,758 |
| GLSL | 4,844 | 148 | 55 | 115 / 1,473 |
| interval-js | 4,471 | 188 | 66 | 162 / 3,702 |

Source size includes `code` plus `preamble`. Large source alone is not a defect:
for example record 11359 has a 73,164-character preamble containing a baked
numeric dataset. Its data and executable overhead should be measured separately.

## Recommended order

1. Unblock the current Tycho census: fix repeated evaluation of lazy collection
   arguments and bound expensive compile-time evaluation.
2. Hoist constant interval **arrays**, including arrays reached through a symbol.
3. Apply CSE to generated derivative callbacks and their repeated reductions.
4. Hoist integration callback invariants; avoid repeated symbolic integration
   timeouts across equivalent compilation requests.
5. Make sum/product unrolling sensitive to emitted cost.
6. Re-run the census on current Tycho declarations, then address narrowly proved
   numeric absence and collection failures.
7. Consider interval broadcast/reduce fusion and shader array bindings after
   measuring plotting workloads that use them.

Items 2–4 have direct runtime evidence below. They deserve a place ahead of
broad new lowering support in the handoff's decline-focused ranking.

## 1. Constant interval arrays are still rebuilt inside hot kernels

Witnesses: `vwbagbcerj`, interval records **16541** and **16544**.

- 16541, an 11-term cosine sum, repeats the same 400-element `[_k3, …, _k402]`
  array **11 times**. The expression is 30,708 characters; its preamble is
  another 20,175 characters.
- 16544, a 400-term cosine sum, emits the array literal **inside the loop**:
  400 array constructions and 160,000 element placements per kernel call at
  the source level. The interval elements themselves are already pooled.
- A scan finds 31 literal arrays of at least ten `_k` entries across 19
  interval records in nine documents. That is a candidate set, not a claim
  that all have the same hot-loop behavior.

Recommendation: pool immutable constant collections at artifact construction,
or bind them once at the narrowest valid enclosing scope. Let the collection
look-through and invariant analysis see a symbol's emitted list value. For an
unrolled term with a proven integer index, subsequently fold the access to the
selected element, avoiding both the full table and `_IA.at` when legal.

Relevant code: `compileIntervalCollectionValue`, `compileIntervalSumProduct`,
and `hoistIntervalConstants` in `compilation/interval-javascript-target.ts`.
The current constant hoist recognizes scalar interval spellings, not arrays.
Respect caller-mapped inputs, effects, and mutation isolation for returned
values; a live list cannot be treated as an artifact constant.

This reproduces on current source with a deterministic assigned 400-element
list. Importantly, **scalar interval constants already have once-per-artifact
storage** in `ComputeEngineIntervalFunction`; the older ROADMAP description of
all such constants being per-call is stale. The remaining opportunity is the
array container and accesses.

## 2. Generated derivative callbacks miss substantial sharing

Witness: `lwuwgb9ic5`, JavaScript record **11459**.

The emitted expression is **83,798 characters**, including 1,883 textual
`_SYS.pow2` calls and two `_SYS.nd` callbacks. Within **each callback**, the
same minimum of 20 squared distances appears **21 times**; each callback has
920 textual square calls. The outer expression has some CSE, but it does not
eliminate this callback duplication. Re-parsing the recorded input and
compiling against current source reproduces the exact source length and counts.

Binding just that repeated minimum once per callback invocation reduces the
whole expression to **23,452 characters**, without changing the numerical
derivative stencil. It also removes 800 textual square calls per callback.
Further sharing of the individual distances is possible.

Recommendation: give synthesized derivative functions a fresh CSE harvest,
with their parameters and captured variables correctly scoped. Audit repeated
variadic reductions in the surrounding expression as well. Do not reuse a
distance computed at the outer point for a perturbed stencil point.

Start with `compileNumericDerivativeFallback` in `library/calculus.ts` and
`withNestedCseHarvest` / function-literal compilation in
`compilation/base-compiler.ts`. The former constructs a new function during
emission. The exact missed-admission mechanism still needs a focused fix;
merely reducing CSE thresholds is not justified by this evidence.

The corpus contains `_SYS.nd` in 25 successful records across ten documents;
not all necessarily have the same duplication.

## 3. Integration callbacks recompute scalar invariants

Witness: `thpezd39zq`, JavaScript **15491** and interval **15492**.

Both generated integrands recompute `Gamma(k/2)`, `sqrt(2)^k`, and the exponent
`k/2-1` at every quadrature sample although only `y` changes. Instrumenting the
JavaScript runtime at `x=2, k=5` measured **300 Gamma calls** for one integral.
The same emission reproduces on current source.

Recommendation: extend the existing loop-invariant machinery to integrand
callbacks, including scalar invariants. Preserve evaluation behavior when no
samples are requested; use the existing purity/totality rules, an appropriate
guard, or first-use initialization. For nested integrals, choose scope from
the actual bound-variable dependencies.

Start at `compileIntegrate` in `compilation/javascript-target.ts` and
`compileIntervalIntegrate` in `compilation/interval-javascript-target.ts`.
Their callback construction currently compiles the body directly. There are
81 successful JavaScript records with `_SYS.integrate`, and 44 interval
records with `_IA.integrate`: a useful inspection set, not an estimated fix count.

## 4. Compile-time latency is concentrated and independently actionable

- Interval **4560/4562**, `7kn7eakzkd`, spend **8.80/8.88 seconds** before
  declining with a non-literal `Apply`. Investigate repeated symbolic
  derivative/evaluation work, budget it, and reject a provably unsupported
  shape before expensive work when that does not preclude a valid rewrite.
- Five records in `thpezd39zq` take about **2.003 seconds each**, then emit
  numeric integration. This matches the 2,000 ms symbolic antiderivative
  attempt budget. Current source reproduces the timeout for 15491. A
  caller-mapped `k` skips the symbolic attempt and compiled the same kernel
  in about 6 ms in the probe; that demonstrates the source of the delay,
  not a proposal to change the caller's binding contract.
- The handoff's `nxlddeh5zv` lazy-argument explosion remains the top blocker
  for a HEAD census. This review did not rerun that known out-of-memory case.

Bound work inside `.N()` / symbolic evaluation, not just the size of its
result. A timer checked after synchronous evaluation returns cannot prevent a
hang. Use cooperative evaluation budgets or a pre-evaluation cost guard.
Consider scope- and definition-version-aware caching of deterministic
antiderivative misses; do not permanently cache a timeout as a proof that no
closed form exists.

## 5. Unrolling should consider body cost and coefficient reuse

Witnesses: interval **1431** (`0jqrzf0b8u`) emits 23,338 total characters for a
100-term Fourier sum; **8345/8346** (`eufhj7vcya`) emit 18,289/18,933 total
characters for two 100-term reductions.

Both JavaScript and interval sum lowering use a term-count limit of 100. A
100-term lightweight arithmetic sum and a 100-term callback-heavy sum have
very different source costs. Use a body-cost/source-size budget, with loops
and compact precomputed coefficient tables as alternatives. Avoid a blanket
threshold reduction: unrolling currently enables useful constant folding.

In 8346, `n^(-a_0)` is evaluated in both sums (200 emitted power calls), and
`phi_2(n)` is called for 100 constant arguments. A proved-pure closed helper
could be specialized into a coefficient table. A table dependent on `a_0`
belongs per invocation or in a host cache invalidated when `a_0` changes,
not in an unconditional artifact constant. Preserve numerical accumulation
semantics and interval enclosure when changing the loop structure.

## 6. Re-rank the remaining declines using actionable subsets

The handoff's completed A/C work should not be proposed again, and its section
8 correction about D supersedes the original candidate D.

| Family | What the file actually contains | Advice |
| --- | --- | --- |
| Interval object-domain absence | 34 records / 11 documents; **9** have `broadcastable<number>` or nested numeric broadcastable types | Start with a target-specific numeric absence choice plus the consuming lowerings. A whole-NaN interval is plausible there. Removing the first guard alone does not establish full compilation. |
| Other interval absence | 15 coordinate-accessor unions; 6 vector-related; 2 boolean; 1 point-list; 1 expression union | Separate semantics and downstream blockers. Do not advertise all 34 as a small numeric-sentinel fix. |
| JS scalar arithmetic over a list | **35 / 11**, comprising 33 Add, 1 Power, 1 Multiply | The handoff's 33 / 9 counts Add only. Twenty of the 35 come from `2ki2hjsouf`, already identified as a problematic document. Re-test current Tycho declarations and validity before widening dispatch. |
| GLSL dynamic `At` | **38 / 10** | The handoff's 32 / 5 counts only `indexed_collection<number>`; another six use integer, real, or unparameterized collection types. Prefer host-known capacity/length plus array or buffer bindings; arbitrary dynamic collection representation is not a local At patch. |
| GLSL Integrate | 15 / 3 | Inspect recoverable closed forms and host precomputation first. General shader quadrature is a larger runtime/accuracy decision than these counts suggest. |
| Interval Map | 7 / 2 | Six `lrpzqnemhy` rows are already addressed by the unreleased lazy Map/Range symbol fix. Re-audit instead of implementing them again. |
| Interval List | 9 / 6 | Triage individually: relations/nested lists, helper declarations, and recursion have different causes. There is already numeric root-list support. |

Keep interval finite-difference derivatives, complex values, arbitrary
point-list geometry, and list-valued relations out of a quick optimization
batch. Closed-form D already lowers; a sound general interval derivative
needs interval AD. A list of tri-state predicates needs a result-contract
decision, not just numeric broadcasting.

## 7. Follow-up: interval fusion and useful enclosures

There are 45 `_IA.bcast` sites in 18 successful records across nine documents.
Records **880/882**, `mavxszbvzk`, have a chain of five broadcasts; **4590**,
`7vqnkhdhoj`, builds intermediate arrays before a reduction. Fuse proved
numeric elementwise chains, and then map/reduce chains, to reduce array
allocation and traversal. Preserve empty/mismatched-list behavior, evaluation
order, missing elements, and interval result markers; the existing JavaScript
fusion has documented semantic edge cases, so it is not a blind template.

Wide-bound Range/Sum returning `entire` is another performance opportunity,
but the audit records source, not quadtree exclusion effectiveness. Measure
`entire` frequency, cell subdivision counts, and time before investing in
the handoff's bounded prefix-sum/hull refinement. Successful compilation
alone cannot measure the benefit of tighter enclosures.

## Probe evidence and limits

Local Node 22.13.1 probes used the recorded emitted source with the current
runtime, manually replacing only the indicated computation. Timings are the
median of five warmed batches, in microseconds per raw kernel call. Interval
constants were constructed once in both arms. These are not end-to-end Tycho
benchmarks or validated production compiler transformations.

| Probe | Before | After | Checks |
| --- | ---: | ---: | --- |
| 16541: pool repeated constant array | 40.9 µs | 8.3 µs | Identical interval endpoints at x=0.3 |
| 16544: move constant array out of loop | 599.8 µs | 438.3 µs | Identical interval endpoints at x=0.3, alpha=1.1 |
| 11459: bind callback minimum once | 18.7 µs | 6.0 µs | Exact agreement at three sampled points |
| 15491: hoist denominator and exponent | 36.2 µs | 17.5 µs | Exact agreement at x=2, k=5 |

Probe sources are in `/private/tmp/ce-codegen-advice/` for this session.
Current-source reproductions confirmed the array allocation, derivative
duplication, integrand invariants, and symbolic integration timeout. No full
corpus rerun, plotting benchmark, or compiler test suite was performed because
this task made no implementation changes.

For the implementation rounds, retain these exact record IDs as benchmarks,
add semantic edge cases appropriate to each transformation, and report source
size, compile latency, execution latency, and interval exclusion quality
separately. Keep the existing staged ROADMAP and handoff changes intact.
