# Program binding/diagnostic witness observations

Current-source evidence for the [semantic decision proposal](../../plans/2026-11-15-program-binding-diagnostic-rules.md).
No proposed rule is implemented by this instrument.

Executed on Node v26.13.0 using the source imports in `probe.mts`:

```sh
node --import tsx docs/scratch/program-binding-diagnostic-evidence-2026-11-15/probe.mts > docs/scratch/program-binding-diagnostic-evidence-2026-11-15/observed.json
```

Exit 0. The equivalent initial temporary-path instrument also exited 0;
parsed JSON outputs compared equal. Thirteen single-program cases and five
caller-scope scenarios cover the stop report's literal calls, replacement,
constants, aliases, literal evidence, explicit contracts and redeclarations.
The instrument prints observed behavior rather than asserting a proposed rule.
It is a bounded investigation, not a test suite or performance measurement.
No production source or existing tests changed.

The source/test mtime fingerprint before and after execution was
`e21f362e92bb51827504c55f15452d1afdd023c6`. The checkout read before the probe
was `24a8a41cb61a9d1594f547c4974e518ff7158240`; the shared checkout can move.
`source-hashes.json` identifies the relevant current files more precisely.

`observed.json` includes raw value MathJSON, diagnostic codes/ranges, binding
representation and public type. The `runs` entries use one engine and one
pushed caller scope per scenario; `checkEpsil` precedes each `executeEpsil`.
For every recorded check, binding identity and public type after checking
equaled their state before checking. This is not proof of no transient writes:
the existing checker mutates definitions and restores them.

Rerun declarations install the new runtime function but can retain a false
old-signature diagnostic. That observation is [CE-1352](../../../issues/CE-1352.md).
Across-cell examples here are CE caller-scope controls; they do not execute
Tycho's notebook evaluator, graph, containment or publication policy.

No compiler/IR execution was necessary for the architectural assessment:
source inspection traces the producer stages and restrictions. No full/core
suite, build, corpus, timing, worktree or production review was needed. An
independent Sol reviewer read the D11 and IR source contracts. All proposed
runtime/static-type changes and diagnostic precision choices remain pending
acceptance; no line budget is assigned.
