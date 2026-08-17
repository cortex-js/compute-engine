# Shared-box protocol

Several Claude sessions work on this machine at once, across two repos
(`compute-engine` and the `tycho` consumer). On 2026-08-16 there were **ten
concurrent sessions on an 8-core box**, which sat at **load ~11 with no tests
running at all**. Baseline oversubscription is the normal state here: "wait
for the box to go quiet" is not an available strategy, and any wall-clock
number taken on this machine is contended by construction.

This document is the coordination protocol. It exists because the rules below
were each learned from a failure in a single afternoon, and because relaying
them session-to-session does not work — a session that starts later, or misses
one message, behaves incorrectly while believing it is compliant.

**If you are a session starting work here, read this first.** Nothing in it is
optional, and none of it is expensive.

---

## 1. Test runs: cap the workers, not the file count

`config/jest.config.cjs` sets **`maxWorkers: 6` unconditionally**. There is no
"light" jest invocation in this repo: a targeted three-file run fans out to six
workers at 60–90% CPU each, exactly like a full suite. Selecting fewer test
files does not reduce load.

| Situation | Command |
| --- | --- |
| Single file | `npx jest --config ./config/jest.config.cjs -w 1 -- <path>` |
| Several files | `npx jest --config ./config/jest.config.cjs -w 2 -- <paths>` |
| Full suite | take the lock (§2), then run normally |

`npm run typecheck` is single-shot and entry-points-only — it is fine at any
time. The whole-`src/` native run
(`./node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`) is
heavy: treat it like a full suite.

**Consumer side, same axis:** Tycho's `playwright.config.ts` also defaults to 6
workers locally. Use `PW_WORKERS=2` for a multi-spec run, `PW_WORKERS=1` for a
single spec.

## 2. The lock — for anything over ~60 seconds

```
node /Users/arno/dev/tycho/scripts/box-lock.mjs check <owner> && <your command>
node /Users/arno/dev/tycho/scripts/box-lock.mjs acquire <owner> <minutes> "<what>"
node /Users/arno/dev/tycho/scripts/box-lock.mjs release
node /Users/arno/dev/tycho/scripts/box-lock.mjs status
```

The lock is **advisory** — it never kills anything. `check` exits non-zero
while another owner holds it, which is the point: **put it in the command**,
not in your notes. A rule that lives in a briefing does not reach an agent you
dispatched before you read the briefing, and that is precisely how a full
battery landed thirty seconds after seven sessions agreed to hold one.

A lock voids automatically when its recorded pid is dead, or when it overruns
its declared window by more than ten minutes, so a crashed run cannot hold the
box permanently. It prints the load average at acquire and release — keep those
numbers with any timing you report.

**A WRITER holds the lock too.** This is the rule most easily missed. The lock
serializes *runs*; it says nothing about *edits* — and a suite is invalidated by
a concurrent write just as thoroughly as by CPU load, because jest loads test
files **lazily** across the whole run. A save at minute three tears a run that
started at minute zero. Twice in one hour a session ran with correct gates and
got garbage: one passed both the lock check and a no-jest gate, then died on a
peer's mid-write `compile-expression.ts` — **186 suites failed to load** on a
syntax error. A writer invalidates other people's results where a runner only
slows them, so the writer's claim on the lock is the stronger one. Acquire it
while you are actively editing shared source, and release before you tell a
peer the tree is stable.

**A writer takes the lock in SHORT BURSTS, and yields.** The writer rule
protects other people's runs; it is not a licence to hold the box for a whole
editing session. An edit session can last an hour, and a peer needing a
fifteen-minute suite would never get in — the lock would have converted a
contention problem into a starvation problem. So: declare a realistic window
(minutes, not hours), release as soon as the tree is consistent rather than as
soon as you are finished thinking, and if a peer is waiting on a run, finish
the file you are on and hand over. Two writers editing disjoint files do not
need to serialize against each other at all — the lock is only about whether
someone might be RUNNING against your half-written tree.

If you cannot reach a consistent tree quickly, say so and give the waiting
session an estimate. A peer who knows they have a thirty-minute wait can do
something else; a peer watching a lock that never clears cannot.

**Known weakness:** the script lives in the `tycho` repo, so every session in
this repo invokes it by absolute path into another project. Moving it somewhere
neutral needs agreement from both desks; until then, use the path above.

## 3. Verifying that the box is actually clear

```
pgrep -f "bin/[j]est"       # the jest RUNNER
pgrep -f "[j]est-worker"    # the WORKERS — check this too
```

Two independent traps:

- **The bracket matters.** `pgrep -f "jest --config"` matches the checking
  shell's own command line, so it reports a false "busy". One-shot that only
  wastes a launch; inside an `until` loop it never exits — two agents hung for
  35+ minutes on that loop, and their zombies then made every later check in
  every session report "busy" with no jest running.
- **`bin/[j]est` cannot see orphans.** Killing a runner can leave workers alive,
  re-parented to launchd (`ppid 1`), burning a full core while the runner check
  correctly reports empty. That happened here: a peer killed a suite, verified
  clean in good faith, and one worker ran on at 62–100% CPU for four more
  minutes. Treat any `ppid 1` worker as needing a direct kill.

**"I killed it" is not "the box is clear."** Verify with `ps`, not with the
runner's exit.

## 4. Staging and file ownership

The project rule (`CLAUDE.md`, Source Control Protocol): stage your work only
when **nothing else is already staged**; if the index is busy, say so and wait.
Never `git add -A` or `git add .`.

**Markdown is exempt from ownership concerns.** `ROADMAP.md`, `CHANGELOG.md`,
`docs/**` and plan documents are edited by several sessions at once *by design*.
Multiple authors in one markdown file is the normal state, not a collision:
stage it, and do not caveat it or ask peers whether their markdown hunks are
final.

**For `src/**` and `test/**`, attribute before you touch or report.** Two
failure modes, both observed:

- **Read content, not paths.** `src/cli/format.ts` and `src/epsil/diagnostics.ts`
  looked like the CLI and Epsil sessions' work; both were protocol-conformance
  changes owned by a third session.
- **Read every hunk.** One file can have two authors. `boxed-function.ts` held a
  strings-workstream change and a multi-clause change simultaneously; naming an
  owner from the most *recognizable* hunk assigned the whole file to the wrong
  session.

Distinguish the porcelain columns: `M ` is staged, ` M` is unstaged. A status
reading goes stale the moment anyone commits — re-read it immediately before
attributing.

## 5. Waiting on another session

**If you are blocked on a peer's reply and 15 minutes pass, ping them again.**
Do not wait silently, and do not assume silence means "still working" — it far
more often means the message was lost behind something else. State what you are
blocked on and what you need from them.

**If you told a peer you would signal them, that promise is a debt with your
name on it.** Check your outstanding signals whenever you finish a task. A
session was asked to freeze its writes for a colleague's four-minute suite and
was never told the suite had finished; it idled for **one hour and fifty
minutes** waiting for a ping that existed only in the sender's head. The
freezing was correct — the missing release was not.

Both halves are needed. The reminder rule protects you from a distracted peer;
the debt rule stops you from being one.

## 6. Measurement hygiene

The recurring failure on this box is not bad judgement, it is **instruments
certifying states they cannot observe**. Five separate cases in one afternoon,
each of which looked green:

- a process check blind to orphaned workers (§3),
- "targeted runs are light", false because of `maxWorkers: 6` (§1),
- a lock reporting ACQUIRED while holding nothing (its smoke test only ever
  exercised the free path),
- a status reported as "pending" for two hours after the artifact had landed,
- `JSON.stringify(NaN)` returning `"null"`, manufacturing an
  interpreter/compiler divergence that did not exist.

Three rules follow, and they are cheap:

1. **Run a control first.** A decline that hits a trivial case as hard as the
   expression under test is instrument failure, not a finding. A GLSL harness
   was blamed for four probes before a plain `x+1` failed identically and
   revealed the invocation was wrong.
2. **Test the check against the state it is meant to EXCLUDE.** "Does it report
   clear when clear?" proves nothing. A mechanism nobody has run adversarially
   is a claim, not a protection.
3. **Verify, do not relay.** Re-check a peer's all-clear rather than forwarding
   it — not from distrust, but because their instrument may be narrower than the
   claim they are making with it, and they cannot see that from inside. Two
   independent readings agreeing costs seconds.

**A labelled confound you reason past is worse than an unnoticed one.** If you
write "X was live during this run", the only valid next sentences are "so I
excluded it" or "so I re-ran without it" — never "but that could not account for
an effect this large" unless you have measured what it does account for. A
contended measurement is unusable in **both** directions: load manufactures
false signal and masks real signal. One filing of a 3.4× regression against this
engine was pure load, and the same noise was simultaneously hiding a genuine
finding on the consumer's side.

Finally: **prefer `HEAD@old` vs `HEAD@new` to an archived-tree A/B.** Before
trusting any version comparison, confirm the older tree carries the fixes
written *for the version under test* — one grep for the fix's own symbol. A
"clean" 26 → 1 regression with controls and an independent reproduction turned
out to measure "the new version without our fix for the new version", and cost
three people an evening. The confound made the result look **cleaner**, not
noisier, which is why nobody doubted it.
