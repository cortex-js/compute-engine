# Shared-box protocol: Compute Engine specifics

Read `~/.claude/SHARED-BOX-PROTOCOL.md` for shared-machine coordination. Section
numbers below refer to that protocol. This file contains only Compute Engine
rules; [BUILD.md](../BUILD.md) owns build, validation, formatting, and release
commands.

## §1 Worktrees and applying changes

Use a worktree for multi-file tasks. Link its dependencies to the main checkout:

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

Take the box lock for full suites, aggregate CI, builds, corpus checks, and
`npm run test:python`. Timing tests (`npm run test:perf`) also require the lock
and run serially. Type checking and capped targeted tests do not need the lock.
Worktrees share these CPU limits.

Exception: a local release (`npm run release`, or `npm publish`) takes no lock
for its checks and builds (`scripts/release-checks.sh`, `npm run doc`, the
production build, the VS Code extension), because the user releases only when
no other session is active (user decision 2026-10-30). The full test suite of a
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
- Production code, dependency versions, Jest/build configuration, and CI
  workflows require dual review.
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

Use `npx tsx scripts/where.ts <Operator>` to find tests for an operator. After
import changes, also run `npm run check:deps`; no circular dependencies are
allowed. Follow the shared protocol's staging queue and review requirements.

Normally, leave the full suite to the nightly pipeline. Run it before staging
when any of these applies:

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
records its result. It takes the lock automatically.

### Formatting, hooks, and releases

Prettier formats staged source at commit time. It does not replace validation,
review, or staging-queue checks. Husky owns `core.hooksPath` (`.husky/_`);
`.husky/post-commit` forwards to the common Git directory's local post-commit
hook for queue cleanup. Integrate additional hooks without replacing that path.

Follow [BUILD.md](../BUILD.md#releasing-to-npm) for releases.

## §8 Handoff

Before a long run, write `docs/scratch/<date>-<topic>-handoff.md` as required by
the shared protocol. Record the command, log path, and actual exit status when
it finishes; keep the handoff current.
