# Bounded Program type-work trace

The trace supports narrowing unnecessary output demands, rather than treating
same-node calls as interchangeable. It does not prove an unchanged-input
recomputation in these fixtures. A subsequent three-arm timing protocol is
queued separately; no timing conclusion follows from these diagnostic events.

## Method and identity

Production sources were not edited. The private observer fork was copied from
the frozen guard root `/private/tmp/program-only-profile-revision-20261116`,
the causal accepted source plus the preceding three-file guard patch. This
preserves the older source anchor and excludes unrelated current-main edits.
`IDENTITY.json` references the private complete source-copy identity by hash,
records the unchanged guard source certificate and diagnostic bundle hashes.
`INSTRUMENTATION.json` and `instrumentation.diff` identify each private source
probe. Raw events, private sources/builds and exact commands remain under
`/private/tmp/program-type-work-20261116`.

Nine private source files receive fixed probes. These wrap the actual
`boundCallType`, literal call/full signature derivations, natural expression and
binding type/value reads, lookups, evidence sessions/sites/rejoins and writes.
Reason spans surround the existing operand-map expressions at the tuple-coordinate,
point/number sum, absence-through and absent-answer codomain demands. They do not
compute a type or value to discover the state. Binding snapshots read own data
descriptors: identity, stored type/value slots, write version, evidence flag and
placeholder/signature skeletons. Context snapshots include scope/frame identity,
engine lifecycle axes, suppression depth and passive assumption-store state.

The observer records requester stacks and parent span IDs. It does not add a
cache, share a preparation or construct a production dependency graph. Module-local
overlays, static-view state and arbitrary host state are not fully observed;
therefore matching observations would still be classified as unknown. A changed
context/version does not mean every semantic input changed; it precludes the
claim that all inputs were shown equal.

Each fixture has three warmup operations and three traced operations. Results
are checked before tracing and after each operation, outside enabled tracing.
The original Program returns 10 with zero checker diagnostics; real persistent
Tycho notebook rerun gives 4 and edit gives 5. CE Program/check use precision 21;
the notebook document profile uses precision 15; both use CE JIT auto. Node is
v26.13.0, V8 14.6.202.34-node.40, Darwin arm64.

Eight unmodified-guard/instrumented-bundle controls and two instrumented-source
Program/check controls exit 0. Five initial traces and the refined notebook
control/trace exit 0, with no dropped events. CPU durations are not measurements
of production latency. `CONTROLS.json` and `status*.json` preserve outcomes and
exact invocation arguments.

The observer was refined after the initial five traces to record naturally
computed assignment proposals, evidence markers and post-write versions for the
specific notebook question. The refined instrumentation manifest/diff covers
that final notebook checkpoint; initial counts are preliminary diagnostic data.
Final matched guard/revision traces will use one identical observer revision.
Unused private observer builds during setup are retained; no original build was
replaced. Source-map generation was not used for this trace.

The diagnostic lock was `codex-program-type-work:trace`, acquired for 15 minutes
at load 5.0/4.1/3.6 and released at 3.6/3.8/3.7 on 18 cores, passing the reservation
to the queued Tycho session. No ordinary timing ran in that window.

## Actual derivations and demands

Counts below are per logical operation, not per `.type` getter query.

| Fixture | `boundCallType` | Literal call signature | Full literal signature | Evidence site rejoins |
| --- | ---: | ---: | ---: | ---: |
| Box | 8 | 2 | 2 | 1 |
| Parse+box | 8 | 2 | 2 | 1 |
| Checker | 11 | 3 | 4 | 1 |
| Notebook rerun | 4 | 0 | 0 | 2 |
| Notebook edit | 4 | 0 | 0 | 2 |

Box/parse+box derive heads `Function`, `Block`, `Multiply` and `square`, two of
each per operation. Checker derives three each of `Function`, `Block` and
`Multiply`, plus two `square` calls. Notebook derives only `Add`, four per
operation, across analysis and execution preparations with distinct bindings.

Box/parse+box each perform two single-scope full literal signatures. Checker
performs two single-scope signatures plus one written-scope and one current-scope
full signature. The two-scope caller keeps slots/result from the written-scope
answer and only effects from the current-scope answer. Those contexts intentionally
differ. The trace supports testing the existing effects-only query for the latter
demand; it does not support sharing two full answers based on scope equivalence.

The tuple-coordinate map has two nested `boundCallType` derivations per box or
parse+box operation, and three per checker operation, at `Block`. The other
three labelled maps have no nested `boundCallType` derivation here. No full literal
signature in these fixtures has any of the four map reasons as an ancestor.
The maps also issue natural type getter queries which can avoid a fresh
`boundCallType`; those are counted separately in `SUMMARY.json`. Getter queries
without nested derivation are not counted as fresh full-signature work.

This distinguishes cheap rejection before operand-type demand from required
result/evidence typing. It does not justify saying that the eager maps caused
all of the original signature allocation cost. The notebook's `Add` demands
are distinct from metadata `Block` demands; relevant arithmetic guards must keep
their operand types.

## Evidence timeline and repeated inputs

Every observed evidence rejoin settles on pass index 0, without coarse widening,
and returns false. That is an observation of these fixtures, not permission to
skip the general fixpoint or its first rejoin.

In refined notebook operation 0, the first preparation shows:

| Event | Binding / node | Observed state |
| --- | --- | --- |
| First Add derivation | Add node 51 | Engine type/any versions 91/119 |
| Initial evidence target | `b`, binding 39 | Stored `unknown`, evidence false, write version 0 |
| Actual evidence write | binding 39 | Proposed `number`; stored `number`, evidence true, write version 1; engine type/any 92/120 |
| Pass-0 rejoin | Same Add node 51 | Derives under changed 92/120 versions; recorded and assigned `number`, evidence true; no further write |

The next preparation uses a fresh `b` binding 77 and Add node 89. It likewise
writes `unknown` to `number`, evidence false to true and write version 0 to 1;
engine type/any move 95/124 to 96/125. Skeletons remain undefined. This is a real
input change, not a demonstrated same-number setter no-op. No evidence/setter
change is supported by this witness.

Across the three operations, all same-node repeated derivations encounter
changed observed context/versions: box has 3 bound-call pairs, checker 12
bound-call and 6 full-signature pairs, and refined notebook 6 bound-call pairs.
No pair establishes unchanged inputs. Full records include binding identity,
stored type/value identity and write versions; equal printed types alone are
never used as an equivalence key.

## Next comparison

The causal five-file revision source is prepared at
`/private/tmp/program-only-type-work-revision-20261116/ce`: it copies the frozen
guard and applies only `/private/tmp/program-type-work-sol.patch`, after
`git apply --check`. `causal-revision-source.json` records exact changed-file
preimages, postimages and patch SHA. It does not copy current-main files.

The queued protocol compares original baseline, frozen guard and this revision
in one window, with identical fixtures, warmups, calibrated batches, hooks,
correctness controls and strict external-work monitoring. Final private traces
will distinguish actual derivations from getter requests and verify retained
evidence passes. Any unavailable controls or contention remain explicit.
