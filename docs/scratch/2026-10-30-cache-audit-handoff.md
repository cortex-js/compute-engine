# Handoff: evaluation-cache audit timing run (2026-10-30)

Session `compute-engine-aa`. Task:
`docs/plans/2026-10-28-evaluation-cache-audit-handoff.md`. No source change in
the main tree; the only main-tree edit is ROADMAP CE-628.

- Probe worktree: `/tmp/wt-compute-engine-aa-cache` (HEAD `9b86a09321c2430f2bfd7ef185041d0502803561`),
  with a probe-only switch module `src/compute-engine/boxed-expression/cache-switches.ts`
  (`CE_CACHE_OFF=<names>`) and one switch at each of 21 caches. Not for
  delivery; remove the worktree when the design document is reviewed.
- Command: `box-lock acquire compute-engine-aa:cache-audit 60 … --wait=240`, then
  `zsh <scratchpad>/probes/timing.sh` (each switch: the workload driver
  `probes/workloads.mts` with RUNS=5 and `benchmarks/tycho-document-open/rebind.ts`
  with RUNS=3; then `scripts/test-core.mjs` with no switch and with every switch
  but `type`), then `release`.
- Logs: `<scratchpad>/timing/`. Scratchpad:
  `/private/tmp/claude-501/-Users-arno-dev-compute-engine/df7feba9-536e-4e9c-8a9b-32c8dbe0afff/scratchpad`.
- Exit status: first run exit 0 (all settings; with the type cache off the
  workloads timed out, exit 124; core tests with all but the type cache off
  exit 1, one identity test of the type parse cache). Paired run
  (`probes/timing2.sh`, logs `<scratchpad>/timing2/`) exit 0. Lock released.
- Results are in the design document, sections 3.3 and 3.4. Dual review:
  `docs/scratch/EVALUATION-CACHE-ARCHITECTURE_SPEC_REVIEW.md`.

## Revision 2 (2026-10-30, same session)

- The design document was revised for the 26 review findings; its section 10
  says where each one is handled.
- Two workloads of revision 1 (`lazy-reads`, `map-compile`) wrote `Map` with
  its arguments in the wrong order and timed an error expression. Corrected,
  and measured again in a paired run at HEAD
  `d7c8fe8b902fbee7d5fe64d79aefe9079e992b6f` (`timing3.sh`, under the box
  lock, exit 0, lock released).
- New probe worktree `/tmp/wt-compute-engine-aa-cache2` (detached at
  `d7c8fe8b9`, switch patch applied, plus a `derivative` switch). The old
  worktree `/tmp/wt-compute-engine-aa-cache` is no longer needed. Remove both
  when the document is accepted.
- New defects: CE-647 (derivative chains miss a retype), CE-648 (Rubi caches
  keep host values).
- The probes, the switch patch and the timing scripts are in
  `docs/scratch/2026-10-30-cache-audit-probes/`; the search results are in
  `docs/plans/2026-10-30-evaluation-cache-inventory.md`.
- Session `compute-engine-3e` implements steps 0 and 1 of revision 1
  (worktree `/tmp/wt-compute-engine-3e-cachestep01`); it was told about the
  review and is sent revision 2.
