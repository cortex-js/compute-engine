# Executed research checks

- Corrected typed Tycho CORE census: exit 0; 97 documents, 1316 calls, 1101 records.
- Unmodified Tycho CORE control: exit 0; identical 1101 records for code, options, types, outcomes, contexts and occurrences, excluding timing.
- Burning Ship instrument control: exit 0; instrumented/unmodified records identical excluding timing.
- Existing CE compilation-cost harness: exit 0; RUNS=5 ITERATIONS=10, 17 cases.
- Buddhabrot partition experiment: exit 0; 8 partition cases. Initial zero-range assumption corrected as documented.
- Structured IR experiment: exit 0; 36 ordinary value comparisons, 8 verifier controls after November 9 review, plus effect controls.
- Independent Codex instrument review: no actionable findings.
- Claude instrument review: later authenticated execution exited 0; five low-severity evidence gaps corrected in November 9 reruns/addendum.
- Local document links, retained JSON and gzip validation: passed.
- `node scripts/issues.mjs lint`: 87 files, 0 errors. No issues added or removed.

All timing/corpus runs held the box lock. First measurement group acquired at
load 2.9 / 4.1 / 3.6 and released at 3.0 / 3.9 / 3.7. Final full-control
run acquired at 2.6 / 3.7 / 3.7 and released at 3.4 / 3.7 / 3.7.
The handoff used during runs was in the temporary Tycho worktree; this file
records its final outcomes. No production patches are delivered.
