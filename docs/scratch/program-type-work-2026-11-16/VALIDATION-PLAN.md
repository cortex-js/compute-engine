# Validation ownership

Sol ran whole typechecking and changed-file oxlint once in the isolated
`050a14088` worktree. Main's five changed files are byte-identical; those results
are reused. The patch does not add imports, public operators or public APIs.

Root will run focused Program/check/execute, point/absence, literal-scope effects,
recursive-signature and loop-widening tests after integration, plus the core set.
Both runs disable Watchman because the previous sandboxed attempt returned zero
without running suites. Verify suite counts and capture direct exits and source
fingerprints. No snapshot update is authorized.

The changed boxed type machinery is shared broadly. The repository's hot-file
rule also calls for one full suite, under the box lock, in the isolated source
worktree to exclude concurrent peer fixes. No second aggregate run is planned
without a new failure or source change. Independent Sol delta review follows
passing typecheck and focused tests; it must examine demanded-branch read order,
generic/error fallback, effect scope, inferred contracts and absence semantics.

Timing, diagnostic traces and tests run in separate phases under the box lock.
The measurement agent owns one matched original/current/revision protocol using
frozen production sources and adapters; root must not run tests during timing.
No broad notebook/showcase or scalar-control repeat is needed for this delta.
