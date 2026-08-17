# Shared-box protocol

Several Claude sessions work on this machine at once, across two repos
(`compute-engine` and the `tycho` consumer). As a result, oversubscription on 
this box may occur: "wait for the box to go quiet" is not an effective 
strategy.

This document is the coordination protocol. It exists because the rules below
were each learned from experience.

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

**`<owner>` must be the name your session answers to.** The lock's owner field
is the only handle a blocked peer has, and it is useless if it names something
no one can reach. Use one identifier for your session name, your lock owner, 
and the name you sign messages with.

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
started at minute zero. A writer invalidates other people's results where a 
runner only slows them, so the writer's claim on the lock is the stronger 
one. Acquire it while you are actively editing shared source, and release 
before you tell a peer the tree is stable.

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

### Certifying a run against concurrent writes

The writer rule in §2 is **prevention**, and prevention is not always available
to you: a peer who never read this document, or a human editing directly, will
write into your run regardless. Detection always is. Fingerprint the tree
immediately before starting and immediately after jest exits:

```
find src test -name '*.ts' -exec stat -f "%m %N" {} + | sort | shasum
```

Identical values mean nothing was written while the suite ran, and the result
is certifiable. Different values mean it was torn — and you know, instead of
reporting a green run that straddled two source states.

**One reading proves nothing: mtime is last-write-only, so it can falsify but
never confirm.** Checking that the tree looks quiet before you start says
nothing about minute three. The pair is the instrument; a single check is not a
weaker version of it, it is a different and useless one.

This is not hypothetical. A full suite held the lock 06:59–07:18, a peer saved
`src/common/type/subtype.ts` at 07:02:58, and the run came back green across
555 suites — uncertifiable, because jest loads test files **lazily**, so some
suites read the old source and some the new. The owner of that run then blocked
for twenty minutes trying to establish *who* had written, when a pair of
fingerprints would have told them *whether* it mattered in four.

**Prefer measuring the thing you care about over identifying who caused it.**
Attribution is slow, needs everyone to answer, and is wrong by default — two
sessions each concluded the other had made the edit, from matching mtimes.

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
- **The writer may be the human.** This document models sessions as the only
  writers, and that assumption is wrong often enough to be expensive. An
  unattributed edit is at least as likely to be the user working directly as a
  session that failed to announce itself — so **check that first, before
  opening an owner hunt.** One unattributed `subtype.ts` save cost six sessions
  a round of polling and blocked a seventh for twenty minutes; the answer was
  that the user had written it himself, and one session had said so early from
  the timing (a human commit in the sibling repo interleaved with the edits)
  and been talked past. The corollary is in §3 and is the more important half:
  **holding the lock is not grounds to certify a run**, because no lock reaches
  a human editing their own tree. The before/after tree fingerprint is the
  certification standard precisely because it is robust to writers the lock
  cannot see.

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

Four rules follow, and they are cheap:

1. **Run a control first.** A decline that hits a trivial case as hard as the
   expression under test is instrument failure, not a finding. A GLSL harness
   was blamed for four probes before a plain `x+1` failed identically and
   revealed the invocation was wrong.
2. **A repro you FILE must carry its control.** A durable entry's repro will
   be re-run by whoever fixes it, months later, with none of your context —
   so a repro that cannot discriminate will read to them as evidence the
   finding was overstated, and the strongest argument in the entry gets
   dropped. This is not hypothetical: an intersection-subtyping entry filed
   `f(n)` staying symbolic as proof that an intersection parameter type
   rejects its argument, but a plain `(number) -> number` signature stays
   symbolic identically — a declared-but-UNDEFINED function on a valueless
   symbol always does. Giving the operator an `evaluate` body separated them
   at once, and turned a supposed silent decline into a user-visible
   `incompatible-type` error on a literal `7`. Show the control's output next
   to the repro's, and when you replace a bad probe, say IN the entry that it
   failed its control rather than quietly swapping it.
3. **Test the check against the state it is meant to EXCLUDE.** "Does it report
   clear when clear?" proves nothing. A mechanism nobody has run adversarially
   is a claim, not a protection.
4. **Verify, do not relay.** Re-check a peer's all-clear rather than forwarding
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
