# Shared-box protocol: Compute Engine specifics

Read `~/.claude/SHARED-BOX-PROTOCOL.md` for shared-machine coordination. Section
numbers below refer to that protocol. This file contains only Compute Engine
rules; [BUILD.md](../BUILD.md) owns build, validation, formatting, and release
commands. The user has approved every rule in this file: follow each rule as
written, and propose a change to a rule rather than skip it.

## §1 Worktrees and applying changes

Choose the main tree or a worktree as the shared protocol §1 says: the main
tree by default, a worktree when it helps (a subagent writes the change, the
tree stays broken for a while, or a peer's unfinished edits keep the main tree
from type-checking). When you make a worktree, link its dependencies to the
main checkout:

```sh
ln -s /Users/arno/dev/compute-engine/node_modules /tmp/wt-<session-name>/node_modules
```

No other Git-ignored files are required for normal development.

**Files prone to conflicts:** snapshots under `test/` and files under
`src/compute-engine/boxed-expression/`. Apply completed changes from your
worktree promptly to reduce conflicts with other sessions. This is separate from
the full-suite requirements in §5.

After applying a worktree's changes, rerun the targeted tests in the main
checkout before review.

## §2 Worker limits and the box lock

Jest defaults to 12 local workers. Set a smaller limit for targeted runs:

| Run           | Command                    |
| ------------- | -------------------------- |
| One test file | `npx jest -w 2 -- <path>`  |
| Several files | `npx jest -w 4 -- <paths>` |

Jest discovers the root `jest.config.cjs` automatically. Confirm that the
expected test files ran. In zsh, use `${=FILES}` to split a variable containing
several paths.

**Run only the test files that the change can affect, and never a large
batch.** A batch of about 500 files with `-w 3` took 5 to 10 minutes,
longer than the full suite (about 4 minutes with all workers), and covered
less (measured 2026-10-30). The nightly run covers the full suite. Consider
running it before staging only in the cases of §5 ("Checks before staging
source changes"), and only when the change can affect what it tests. When you
run it, run
`npm test` with no extra argument under the box lock (a first argument that
does not start with `--` is read as a test path by `scripts/test.sh`). A
sub-agent never runs it unless its task prompt assigns it.

**Each check runs once, in one place.** The task prompt says which checks
the sub-agent runs; the orchestrator does not run them again on the same
content. When the orchestrator copies a sub-agent's files into the main tree
and `cmp` shows them byte for byte the same, the sub-agent's results for
those files stand: do not repeat its tests, its lint, or its Python tests.
On 2026-10-30 one change of 9 files ran the full suite three times, a
383-file batch on each of four fix rounds, and lint and the Python tests in
both trees; none of these runs found a defect.

Take the box lock for full suites, aggregate CI, builds, corpus checks, and
`npm run test:python`. Timing tests (`npm run test:perf`) also require the lock
and run serially. Type checking and capped targeted tests do not need the lock.
Worktrees share these CPU limits.

Exception: a local release (`npm run release`, or `npm publish`) takes no lock
for its checks and builds (`scripts/release-checks.sh`, `npm run doc`, the
production build, the VS Code extension), because the user releases only when
no other session is active. The full test suite of a
release runs through `scripts/ci-nightly.sh`, which still takes the lock.

## §3 Checking for running tests

Check both the runner and its workers:

```sh
pgrep -f "bin/[j]est"
pgrep -f "[j]est-worker"
```

## §4 Detecting source changes during a shared-tree run

Use this fingerprint before and after a run when the shared protocol requires
it:

```sh
find src test -name '*.ts' -exec stat -f "%m %N" {} + | sort | shasum
```

## §5 Review and staging

### Review scope

Both reviewers use [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md).

- Test files are exempt from dual review, in addition to the shared protocol's
  documentation and comment-only exemptions.
- Production code gets the review that the shared protocol §5.2 chooses for
  its risk. Dependency versions, Jest/build configuration, and CI workflows
  always get a dual review: their tests do not show their effect.
- Never hand-edit generated documentation, including `src/api.md`; use the
  appropriate generator described in BUILD.md.
- Never update a snapshot marked `@fixme`.

### Checks before staging source changes

The orchestrator validates the combined tree with typecheck, tests for the
changed area, and the core test set. Reuse results only when their relevant
inputs are unchanged; sub-agent handoffs follow
[BUILD.md](../BUILD.md#completing-delegated-tasks). The core test command is:

```sh
npm run test:core
```

Use `npx tsx scripts/where.ts <Operator>` to find tests for an operator. When a
change alters the emitted code of a compilation target, also run the test files
that contain a fragment of the code it changes
(`grep -rlF '<fragment>' test/`, for example `.reduce((_a, _b) => _a + _b`):
these tests compare the exact emitted string, and the operator name does not
find them. After
import changes, also run `npm run check:deps`; no circular dependencies are
allowed. Follow the shared protocol's staging queue and review requirements.

Normally, leave the full suite to the nightly pipeline. Consider running it
before staging when any of these applies:

- The change affects code under `src/compute-engine/boxed-expression/` or
  `src/common/type/`, Jest configuration (`jest.config.cjs`,
  `config/jest.config.cjs`, `config/jest-environment.cjs`,
  `test/jest-config.ts`), or package dependencies.
- The change is expected to affect many snapshots. Count and report the changed
  snapshots before accepting them.
- `node ~/.claude/scripts/suite-status.mjs train` exits 3: at least five commits
  have accumulated since the last recorded passing full run.

For affected code/configuration or broad snapshot changes, take the box lock and
run `npm test` in the checkout containing the changes. For the five-commit
limit, run `bash scripts/ci-nightly.sh run`; it checks committed HEAD and
records its result. It takes the lock automatically. It does not test the
change that you are about to stage, so its result is never a check of that
change: when the change itself needs the full suite, run `npm test` in the
tree that contains it.

### Formatting, hooks, and releases

No commit hook formats the source; the release checks formatting, and
`npm run format` fixes it (BUILD.md). Do not run Prettier on a shared file: it
rewraps lines of other sessions, which then show in your diff. Husky owns `core.hooksPath` (`.husky/_`);
`.husky/post-commit` forwards to the common Git directory's local post-commit
hook for queue cleanup. Integrate additional hooks without replacing that path.

Follow [BUILD.md](../BUILD.md#releasing-to-npm) for releases.

## §8 Handoff

Before a long run, write `docs/scratch/<date>-<topic>-handoff.md` as required by
the shared protocol. Record the command, log path, and actual exit status when
it finishes; keep the handoff current. The file is not a work queue: a defect
found during the work goes to `ROADMAP.md` with its witness (protocol §5.2),
and the file lists no next tasks. Delete it when the work is committed.

## §9 Context size, agent types and work areas

Delegate only when it helps (shared protocol §9); write a change of a few lines
yourself. When you delegate, use `implementer` (Opus) for implementation and
bug fixes, one ROADMAP item per agent, and `mechanic` (Sonnet) for recipe-driven edits, read-only audits,
sweeps and censuses. Do not use `general-purpose` for implementation: only the
two repo agents carry the stop rule, the test time limit and the git clause,
so a brief to them carries only the task. Find code with the LSP tool or
`scripts/where.ts`.

Run at most three Compute Engine sessions at the same time, each in a different
area. The areas, by the files they change most:

| Area                       | Main files                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Compilation                | `src/compute-engine/compilation/`, `src/compile.ts`, `src/runtime.ts`                         |
| Evaluation and expressions | `src/compute-engine/boxed-expression/`, the `engine-*.ts` files, `src/compute-engine/numerics/` |
| Library and symbolic       | `src/compute-engine/library/`, `src/compute-engine/symbolic/`, `src/compute-engine/rubi/`       |
| LaTeX                      | `src/compute-engine/latex-syntax/`, `src/latex-syntax.ts`                                     |
| Epsil                      | `src/epsil/`, `src/epsil.ts`                                                                  |
| Types                      | `src/common/type/`, `src/compute-engine/types-*.ts`                                          |

Two sessions in one area wait for each other at the box lock and the staging
queue, and their changes to `base-compiler.ts` and `boxed-expression/`
conflict.
