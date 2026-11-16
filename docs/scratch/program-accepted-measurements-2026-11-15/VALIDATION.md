# Final Program validation

Integration was isolated at `85752a2d0942`, including newer committed IR work,
with only this Program patch. The causal measurement baseline remains
`ffff1d44fc566ef01fb52a0ce67b6797797f4dcf`. Main and the integration tree's
changed production/test files matched after integrating generated API output.
No source edits occurred during certification; before/after TS hashes match.

| Check | Result |
| --- | --- |
| Production build, declarations, nodenext, Epsil/runtime/CLI/require smokes | Exit 0 |
| 90 targeted suites | Exit 0; 3,598 tests, all snapshots pass |
| Core set | Exit 0; 18 suites, 5,593 pass, 15 skipped; 1,368 snapshots pass |
| Full suite | Exit 1; 2,053 suites and 85,705 tests pass; one deep IR case fails; 11 suites/780 tests skipped, 2 todo |
| Full snapshots | 4,264 pass; zero added, removed or updated |
| Exact failing IR file, unchanged source, browser access enabled | Exit 0; all 68 tests pass in 6.071 s; flaky expectation recorded as CE-1360 |
| Generated API/errors/library/reference documentation | Exit 0; generator output integrated, no hand edits |
| Editor build, DAP and LSP | All exit 0 |
| Current-HEAD dependency graph | Exit 0; 710 files, no cycles |
| Latest exact-source typecheck / changed-file oxlint | Pass (Sol implementation logs) |
| Issue lint | 188 files, 0 errors; existing CE-1254 priority warning |

Commands were `npm run build`, `npm run doc`, `npx jest --watchman=false -w4`
with the 90-file list, `npm run test:core -- --watchman=false`,
`npm test -- --watchman=false`, editor `node build.mjs` and DAP/LSP scripts,
then `npm run check:deps`. The full/targeted commands use a results processor
that omits circular failureDetails only; assertions and failure messages remain.
The isolated rerun uses `-w2`. Browser/MCP socket checks require the authorized
unsandboxed execution. Worker limits, timeouts and the shared-machine lock were
observed. Raw exits were captured directly, never through a filtering pipe.

The full-run exception is explicit; this report does not call that command an
exit 0. It passed on immediate unchanged-content rerun under the repository's
full-only-flake procedure. No IR implementation or test expectation was changed.
The first sandboxed isolated attempt passed the deep case but lacked browser
permission; the authoritative isolated rerun above enabled browser access.

Coverage includes execute/check, direct synchronous/asynchronous Program,
compile and JSON round trips, paired signatures/function clauses, failed
siblings, retained Error values, constants/aliases/replacement, interleaved
prepared declarations, tuple rollback, source ranges/debugging and cancellation.
Independent Sol and Claude final delta reviews found no introduced regression;
Claude's named-argument concern was closed with three no-diagnostic controls.
The parsed-consumer audit found only the three authorized Tycho integrations.
Tycho workload and heap/performance evidence is reported separately.

Earlier failed censuses and all expectation migrations are retained. The case
ledgers distinguish accepted runtime/public-type/diagnostic/coverage changes
from the introduced defects repaired in source. No snapshot was updated to hide
a failure. No unchanged broad test run is repeated after this certification.

The staging set additionally typechecks alone at HEAD `5e286aa36`, after later
unrelated IR commits; `stage-alone-typecheck.log` records the successful check.
