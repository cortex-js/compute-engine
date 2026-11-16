# Bounded phase-1 revision: fixed acceptance criteria

Frozen before any revised candidate measurement. Baseline commit:
`817f3a87ce4cb10aac942ca465604d1d9d6bf0ad`. This is one bounded F01–F09 revision,
not authorization for phase-2 implementation or production migration. Phase-2a
selection/costing is read-only in Tycho and cannot supply actual deletion credit.

## Order and semantic boundary

1. Profile unchanged evaluate and N on the frozen prototype and native current
   with identical production options, external diagnostic maps, precision 50,
   CE JIT off, ordinary V8, 5,000 warmup and exactly 100,000 profiled calls.
   CPU and sampled allocation profiles run in separate fresh processes. CPU
   interval is 100 microseconds; fewer than 1,000 samples requires a new matched
   pair at 50 microseconds, not unequal amounts of profiled work. Obtain three
   independent processes per arm/operation/instrument. Keep inclusive categories
   non-additive and report self samples separately. Insufficient attribution is
   an explicit limitation, not evidence for a cache.
2. Try direct prepared entry handles first. Resolve handles once, as native
   callers retain boxed expressions; include handle creation/resolution in
   preparation and preparation-plus-first-execution. Report the existing
   name-based convenience route separately. Do not add indexed value slots
   unless the profiles justify them.
3. Only if direct access fails the runtime gate and profiling shows repeated
   computation remains material, consider one bounded instance-owned cache.
   No dependency collection, automatic environment analysis, or general evaluator
   extension. Any cache must account for accepted/refused writes, unrelated
   writes, precision, exact/N mode and effects; its records and transitions count
   as additions. Measure the direct-only trial before adding it.

F01–F09 and the ten concrete throwing-entry probes must continue to pass, with
nonzero positive controls and a nonempty armed static-read sweep. Old revisions,
cross-revision refusals, failed initialization and rejected-write preservation
remain unchanged. F06 declarative-source and F08 opaque-refusal restrictions
remain explicit. No broader syntax/operator support is part of this revision.

## Timing and allocation

Matched timing arms: native current at the frozen base, frozen prototype, and
each revised trial. All use the same source/toolchain and production options,
separate processes, serial alternating order, before/after source/bundle/harness
certification, lock and contention checks. Profiling/GC flags never enter timing.

- Primary runtime route is a retained prepared handle versus a retained native
  boxed expression. Ten rounds, 5,000 warmup, 100,000 calls for unchanged
  function evaluate/N and relevant/unrelated writes; scalar controls use the
  same protocol. Candidate/reference median must be at most 1.0 for each case.
  The name route is reported even if slower; it cannot stand in for the handle
  measurement. One-time handle resolution is not hidden from construction costs.
- Preserve phase-0 construction/preparation-plus-first caps, and also report
  matched frozen-prototype ratios. Six rounds, 1,000 warmup and 10,000 calls.
  Historical caps do not override a fresh runtime regression.
- Three fresh processes per sampled allocation case after 5,000 warmup and
  100,000 sampled calls; include collected objects and a known allocating
  control. Per-case candidate median must not exceed the matched native current
  median or the original phase-0 allocation cap, whichever is smaller. Report
  the frozen-prototype comparison separately.
- A ratio or cap comparison within observed process spread is inconclusive.
  One longer matched retry (ten rounds, 10,000 warmup, 200,000 calls) is allowed
  for decision-critical timing uncertainty. Do not average protocols or waive an
  individual regression with an aggregate score. Remaining uncertainty is a
  revise/stop result, not a pass.

## Warmed retention

Use the same reduced arithmetic/named-function document (four prelude functions,
64 cells, no closures), eight live documents and twelve replacements per batch.
Prepare, instantiate and first execute 200 discarded revisions before the
post-GC baseline. Then retain eight, run four windows of twenty replacement
batches each, and drop all document roots. Every replacement is instantiated
and first executed. Run three independent processes per arm; no allocation/CPU
profiler or snapshots in these numerical processes. A separate snapshot process
uses the same lifecycle, including deliberately retained obsolete handles as a
positive control. A harness-only process preallocates the same checkpoint
storage and runs the collection/checkpoint protocol without documents.

Acceptance requires all of the following in every candidate numerical process:

- Post-GC fixed-live-set heap increase over the warmed no-document baseline is
  at most **2 MiB** at every checkpoint; after dropping document roots it is at
  most **1 MiB**. These absolute budgets retain total memory as a gate. They are
  fixed from the prior prototype's approximately 0.8-MB eight-document footprint
  and 1.2-MB unwarmed residual, with the latter tightened after explicit warmup.
- Growth from the end of window 2 to window 4 is at most **256 KiB**, and from
  window 3 to window 4 at most **128 KiB**. This permits bounded residual process
  growth rather than requiring perfectly flat heap, but caps its late rate.
- Snapshot document-family counts return to eight live documents after obsolete
  handles drop, and to the warmed baseline after all document roots drop; no
  obsolete document family survives. Root paths must identify any survivors.
- Measure and report total heap, code/trusted spaces, snapshot code/metadata,
  RSS and harness growth separately. Do not deduct code or harness bytes to turn
  a failed total-memory gate into a pass. If the harness-only run exceeds a
  **128-KiB** late-growth bound (window 2 to 4), the experiment is inconclusive
  and needs instrument revision, rather than an enlarged candidate allowance.

All absolute values, distributions and frozen/native comparisons are reported
even when a gate passes. These finite-window budgets are not a proof of an
asymptotic plateau, nor compliance for closures or the real Tycho document path.

## Decision and complexity

Count source, tests, diagnostics, generated evidence and temporary scaffolding
separately; projected deletions are zero credit. No new general evaluator, no
production migration, and no phase-2 implementation. A failed or inconclusive
gate yields an explicit revise/stop recommendation. After this one bounded
revision, stop for coordinator review, including phase-2a's concrete path,
removable methods, retained policy, missing CE constructs and cost uncertainty.
