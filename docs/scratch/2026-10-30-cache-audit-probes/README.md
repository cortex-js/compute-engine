# Probes and timing scripts of the evaluation-cache audit (2026-10-30)

These files support `docs/plans/2026-10-30-evaluation-cache-architecture.md`.
They are kept so that the measurements can be repeated. They are not part of
the build.

- `cache-switches.patch`: adds an off switch to 23 caches
  (`CE_CACHE_OFF=<name>[,<name>…]`, or `all`), read once by
  `src/compute-engine/boxed-expression/cache-switches.ts`. A switch turns off
  the look-up of a cache. Apply it in a linked worktree at HEAD
  `d7c8fe8b902fbee7d5fe64d79aefe9079e992b6f`, never in the main tree.
- `workloads.mts`: the 13 workloads. `npx tsx workloads.mts <repo root>
  [<workload>,…]`; `RUNS=<n>` sets the number of timed runs (default 5);
  `DUMP=1` prints the first result of each workload.
- `timing.sh`, `timing2.sh`, `timing3.sh`: the first run, the paired run, and
  the paired run of the two corrected workloads. They hold absolute paths of
  the session's scratchpad and worktrees: change them before use. Take the
  box lock first (`~/.claude/SHARED-BOX-PROTOCOL.md`).
- `origin/`: the probes of section 3.5 of the design document, one per cache
  (`probe-<cache>.mts`), each timed on the case for which the cache was
  added; `run-all.sh` runs them with the cache on and off (it holds absolute
  paths of the session's scratchpad: change them before use), and
  `summarize.py` prints the table of medians from its logs. The logs are not
  kept (git ignores `*.log`); the results are in section 3.5.
- `event-sites.patch`: a counter of the state events by kind and code site.
  Apply it in the same worktree after `cache-switches.patch`, then run a
  benchmark with `CE_EVENT_SITES=1`; the counts are printed on stderr when
  the process exits. Used for step 3a of the migration.
- `stats-wrap.mts`: runs a benchmark module with `CE_CACHE_STATS=1` and
  prints the hit counts.
- Probes of behavior, each runnable with `npx tsx <file> <repo root>`:
  - `uncensused.mts`: the caches of evaluated values that the census did not
    list, with a host operator that does not state its purity.
  - `deriv.mts`: CE-628 (derivative chains and host code).
  - `deriv-retype.mts`: CE-647 (derivative chains and a retype).
  - `rubi.mts`: CE-648 (Rubi zero-test cache and host code).
  - `sgn.mts`: the sign cache of an expression that holds a host call.
  - `defchange.mts`: a retype and an extension under each value cache. Run it
    twice in the probe worktree, with and without
    `CE_CACHE_OFF=<the value caches>`, and compare the output.
