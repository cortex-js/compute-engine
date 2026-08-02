# Dependency-precise element-memo invalidation

**Status: IMPLEMENTED 2026-08-02** (same day; amendments A1–A5 below record where the implementation refined the draft)
**Motivation:** Tycho item 127 (one slider tick colds every memo in the
engine: the element memo delivers ~14× on a static re-read and ~0× during any
interaction), and the general principle that a cache should be invalidated by
what an instance depends on, not by unrelated writes.
**Prior art in-repo:** `validCompiled` in `library/map-auto-compile.ts`
already implements the target pattern for the compiled-function cache
("an unrelated per-frame `ce.assign` bumping the global axis must not thrash
the cache", review 13): cheap generation check, fall through to a
per-dependency walk on mismatch, re-stamp when clean. This design gives the
element memo the same property, by splitting the counter instead of
re-stamping.

## 1. The problem

Element-memo validation (`boxed-expression/collection-element-memo.ts`)
currently requires

```
entry.mutationGeneration === ce._mutationGeneration   // ①  global axis
AND config stamps match (tolerance/precision/angularUnit)
AND per-dep checks pass                               // ②  precise axis
```

`_mutationGeneration` is bumped by **every** semantic mutation, including
every non-ephemeral value write. So ① makes the memo dependency-blind: a
per-frame `assign('t', …)` colds the memos of `P`, `X`, `Y` — collections
that cannot reference `t` — even though axis ② would have validated them
perfectly. Axis ② already runs on every validation; ① is not saving its
cost, only overruling its answer.

## 2. The inversion

Introduce a second, **rarely-bumped** counter and re-point the memo's
equality requirement at it:

- **`_semanticEpoch`** — bumped by every current `_mutationGeneration` site
  EXCEPT the value setter in `boxed-value-definition.ts`. Concretely:
  `assume`/`forget` (engine-assumptions ×3), assumption-dirty scope pops
  (engine-scope ×2, incl. `inScope`), operator/type redefinition
  (engine-declarations ×2, sequence.ts, multi-clause.ts,
  type-constructors.ts), signature inference (boxed-function.ts,
  boxed-symbol.ts), matrix-inference repair (validate.ts ×2), and
  `reset()`. These are the operations RULED acceptable as global
  invalidators (2026-08-02): they are rare, and per-dep tracking for them
  (operator-def versions, per-symbol assumption keys) is deliberately out
  of scope.

- **`_mutationGeneration` is untouched** — same name, same bump sites, same
  semantics. Its other consumers keep exact behavior: the map-exact-proof
  guard, the auto-compile cheap check, and — critically — the element
  memo's own `externalStamp` **suspended-walk dirty detection**, where a
  consumer's value write between two pulls MUST still mark the walk dirty.

Element-memo validation becomes:

```
entry.semanticEpoch === ce._semanticEpoch             // rare global axis
AND config stamps match
AND per-dep checks pass                               // carries value writes
```

The cache entry stores `semanticEpoch` instead of `mutationGeneration`.
Nothing else in the validation loop changes.

## 3. Why the per-dep axis is now sufficient for value writes

A memoized instance has an **exhaustive dependency closure by
construction** — `snapshotDeps` marks any instance it cannot fully track as
ineligible (never memoized). The closure was hardened in the two item-126
review rounds, and each closure rule maps onto a way a value write can reach
an instance:

| write reaches the instance via | caught by |
|---|---|
| a tracked definition's value/type write | `_writeVersion` compare |
| an `updateDef` swap of the inner definition | `occurrence.valueDefinition` identity re-read |
| a fresh declaration changing what a name resolves to | resolution axis (`resolveDepBinding` re-resolution, scoped vs ambient per `depResolutionScope`) |
| a transitive dependency (stored value, user-operator lambda body) | transitive dep walk (`seen`-terminated) |
| an ephemeral loop-index write (enclosing binder) | `_writeVersion` compare |
| a valueless binding later assigned through the declare path | ineligibility (valueless-unreachable gate) |
| assumptions, operator redefinition, signature inference | `_semanticEpoch` (global, by ruling) |

**Risk to state honestly:** the global axis was also a safety net — any
undiscovered dep-closure leak is today a *performance* bug (spurious refill)
and becomes a *correctness* bug (stale serve) under this design. Two
countermeasures:

1. **Paranoid canary mode** (`CE_MEMO_PARANOID=1`, env-gated like
   `CE_DEBUG_BINDINGS`): validation additionally computes the OLD
   `_mutationGeneration` check and `console.assert`s whenever the new
   validation serves an entry the old one would have refused **and** a
   fresh re-walk would disagree with the cached elements. Run in the memo
   test suites and available for soak runs; stripped from production builds
   with the other `console.*` calls.
2. The item-127 probe battery (below) pins the intended asymmetry —
   unrelated-assign warm, related-assign cold — for every dependency class
   (direct, transitive-value, transitive-operator-lambda, enclosing-index,
   shadow-declare).

## 4. Scope across the caches

- **Element memo (Map & co + Comprehension)** — the subject of §2. One
  implementation site (`validElementMemo` + the two commit sites), since the
  Comprehension unification already landed.
- **Map auto-compile cache** — already dependency-precise for value writes
  (`validCompiled` re-stamp). Change: AND `_semanticEpoch` into the
  fall-through path, so `assume`/`forget`/operator-redefinition force a
  **recompile** instead of being re-stamped away. Today an assumption
  change does NOT invalidate compiled code whose canonicalization may have
  consulted it — a latent soundness gap this closes for free, at the cost
  of a recompile on rare operations.
- **map-exact-proof memo** — DEFERRED. It keeps `_mutationGeneration`
  equality; its runtime per-element interval guard makes staleness safe,
  and proof recomputation is cheap relative to a drain. Noted here so the
  deferral is a recorded decision, not an oversight.
- **`_generation`-keyed caches (`sgn`/`type`, operator pool)** — untouched;
  cheap per-expression caches with different semantics.

## 5. Prefix commit on abandoned walks (item 127, ask 2)

The recording stream currently commits only on a COMPLETE drain, so Tycho's
budget/deadline-bounded sampling walks commit nothing. Change: in the
stream's `finally`, an abandoned walk (early `.return()` or a thrown
deadline) commits its buffer as a `complete: false` **prefix** entry when
`!dirty && !overflow` and the dep snapshot is eligible — the same partial
shape `elementMemoFillTo` already writes. `each()` continues to serve only
complete entries; `at()`/`fillTo` serve any covering prefix, so an abandoned
walk's work benefits later indexed reads and fill-to-n calls. A subsequent
complete drain overwrites the prefix with a complete entry.

## 6. Test plan

- **Item-127 pin (the headline):** fill a `Map` and a `Comprehension` memo
  reading `k`; `assign` an unrelated `t` three times; walks stay warm
  (0 element evaluations). Then `assign('k', …)` → cold. Model the probe on
  Tycho's `ce-slider-invalidation-probe.mts` shape.
- Unrelated-assign warmness for each dep class: transitive helper,
  operator-lambda helper, enclosing-binder nesting (warm across unrelated
  writes, refill on index advance as today).
- `assume`/`forget` and operator redefinition still cold (epoch) — existing
  tests already pin these.
- Suspended-walk mutation still refuses the commit (externalStamp on
  `_mutationGeneration`) — existing test.
- Auto-compile: `assume()` between drains now recompiles (new pin);
  unrelated assign still re-stamps without recompiling (existing pin).
- Prefix commit: abandon a walk after k elements → `at(≤k)` serves with 0
  evaluations; `each()` still walks; a complete drain then upgrades the
  entry.
- Full suite + snapshot blast-radius measurement before staging.

## 7. Out of scope (recorded)

- Per-symbol assumption keying and operator-definition `_writeVersion`
  (would make `assume`/redefinition dependency-precise too) — revisit only
  with a witness; the operations are rare.
- Resumable fill iterators (the sequential `at(1…n)` O(n²) fill) — separate
  concern, unchanged by this design.
- map-exact-proof migration (§4).

## 8. As-built amendments (2026-08-02)

The implementation refined the draft in five places; the sections above are
kept as drafted for the decision record, with these amendments authoritative:

- **A1 — the epoch also covers the engine-configuration inputs, and the
  tolerance AND jit setters were fixed.** §2's bump list gains: `ce.tolerance = …`
  (whose setter previously bumped NO counter — a latent staleness bug, fixed:
  `setTolerance` now reports change like its siblings and the engine setter
  bumps `_generation`/`_mutationGeneration`/`_semanticEpoch`, without a full
  `_reset()`), and `precision`/`angularUnit` via `_reset()`. Consequently the
  element memo's config stamps are DELETED — §2's "config stamps match"
  clause is gone; the memo's axes are the epoch and the deps, nothing else.
  Two additional bump sites were classified during implementation:
  `library/core.ts` ×2 (`updateDef` swaps replacing a minted constructor —
  operator redefinition). `ce.jit` — previously a plain field, so toggling
  it was counter-silent — is now an accessor that bumps all three counters
  on change: compiled and interpreted routes differ by the documented
  ~1 ulp on unit-scaled arguments, so serving a compiled-era cache under
  `jit = 'off'` is wrong both for the ulp cases and for the flag's
  diagnostic purpose (the first soak run caught exactly this: 102
  divergences in the angularUnit parity test, all from a cross-route
  serve).
- **A2 — no `_mutationGeneration` fast path in `validElementMemo`.** The
  draft's §7-adjacent idea of a re-stampable generation fast path is
  UNSOUND for the element memo: ephemeral loop-index writes bump
  `_writeVersion` but not the generation, so generation equality does not
  prove deps unchanged — the dep loop is the ephemeral-write detector and
  must always run. (The auto-compile cache's fast path stays sound because
  compiled lambdas cannot capture enclosing binder indices.)
- **A3 — the suspended-walk dirty logic is dependency-precise, with an
  epoch exception.** §5's "!dirty" is refined: an integer
  `_mutationGeneration` boundary flag marks suspended-gap writes; a flagged
  walk commits anyway when a start-of-walk dep snapshot matches the
  commit-time one (an unrelated consumer write between pulls cannot mix the
  buffer — without this, a consumer loop assigning an unrelated accumulator
  would permanently block commits). A `_semanticEpoch` change observed
  across a yield boundary refuses the commit UNCONDITIONALLY — the dep diff
  cannot cure it, and the post-change epoch stamp would otherwise certify a
  straddling buffer. Walk-internal bumps of either counter remain absorbed
  (the ruled side-effecting-body behavior).
- **A4 — prefix commits extend to overflow, with a never-shrink guard.**
  Abandoned AND overflowed walks commit their buffer as a `complete: false`
  prefix, unless a still-valid existing entry already covers at least as
  many elements (a complete entry always wins).
- **A5 — the canary is a soak tool, not a suite mode.** §3's sketch is
  implemented at the `each()` seam: under `CE_MEMO_PARANOID`, a served
  complete cache is cross-checked element-wise against a live re-walk —
  PURE bodies only (an impure body legitimately differs by the draw-set
  ruling), behind a re-entrancy latch (the re-walk or a diagnostic
  serialization can reach `each()` again — `toString()` MATERIALIZES a
  collection — and an unlatched canary recurses exponentially). It
  re-evaluates element bodies, so count-asserting suites fail under it by
  construction; a self-contained smoke test manages the flag, and full-suite
  soak runs are the intended usage.

## 9. As-built results

- Slider-model measurement (probe mirroring Tycho's
  `ce-slider-invalidation-probe.mts`; tsx on source): Comprehension
  cold 2042 ms → warm 0.1 ms; after 1 unrelated `t` tick 0.1 ms; after 4
  ticks 0.1 ms; after a RELATED `N` assign 1656 ms (cold, correct). `Map`
  twin: 1745 → 0.0 / 0.3 / 0.0 / 1703 ms. On 0.99.0 Tycho measured every
  post-tick walk COLD (~400 ms).
- Full suite green, zero snapshot churn (details in the session record).
  The first full-suite soak under `CE_MEMO_PARANOID=1` surfaced 102
  divergences — all one root cause, the counter-silent `ce.jit` toggle
  above (a genuine catch, though of a config-input gap rather than a
  dep-closure leak); zero divergences after the fix. Note the soak run
  fails the warm-count pins in the memo suites by construction (A5).
