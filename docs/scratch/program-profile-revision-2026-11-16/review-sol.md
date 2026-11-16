# Independent Sol reduction-delta review

Result: **no actionable introduced regression or rewritten P1 defect found**. Recommend accepting this bounded source reduction after the coordinator's remaining gates. This is a correctness review, not a performance pass; the remaining measured regression remains reportable.

Scope: `/private/tmp/program-reduction-sol.patch`, three production files, 26 added and 23 deleted physical/code-bearing lines, against accepted `4cb2e040ba0165f4f943646db152cef07dc07878`. Main and frozen `/tmp/wt-program-reduction-sol` copies compared byte for byte equal for all three files.

- The read-before-declaration walk uses structural operands, dictionaries and existing local-scope bindings. Moving it before validity changes which validity memo is demanded, not binding or typing ownership. `BoxedFunction.isValid` is a structural Error/operand check; a found use still requires a valid statement before replacement.
- The initializer shortcut recognizes only a structurally valid Function. Malformed/invalid literals retain the existing type fallback and validity exit; aliases and other callable values retain the original `value.type.matches('function')` path. Parameter/annotation canonicalization and later signature/effect admission remain with their existing owners.
- Optional sequence maps are accessed only under Program branches. Block canonicalization no longer allocates them; Program cancellation-prefix capture, earlier-constant defaults, previous initializer bindings and source/result bookkeeping retain their paths. Reusing the empty declaration set is read-only.
- Named-argument splitting now follows the same known-literal/carrier guards that previously controlled normalization. `splitNamedArguments` always returns a split object, including malformed-carrier status, so removing its earlier unconditional call and redundant truthiness guard preserves malformed/named argument handling. Empty flow results remain equivalent to absence because the consumer reads `flow.get(statement) ?? []`.

Reviewer verification: required `ast-grep scan` on the three changed files exited 0 with no hits; source/context review and byte comparisons only. No probes, tests, typecheck, lint, builds or timing repeated. Coordinator-owned `validation.json` records matching before/after fingerprints and successful targeted/core exits; the supplied results are 11 targeted suites/525 tests and 18 core suites/5,593 passed/15 skipped/1,368 snapshots, with no snapshot updates. Production, tests and index were not edited.

Reviewed SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `src/compute-engine/library/control-structures.ts` | `cce59270c20ad00e5b1ff90f28f9641fad1107d1c89e64f38e4171e49ce08d55` |
| `src/compute-engine/library/core.ts` | `303fe36d781532ddedb413b0c07238ba64a60b42a6d877d9050d1ed0dfc6c867` |
| `src/epsil/diagnostic-flow.ts` | `84894361eb86994997cba812e3bc14f01e881a79e1755643d570bf679f861cf1` |
