# Build, test, and release

This is the command reference for contributors and agents. `package.json` owns
command definitions; this document explains their responsibilities. Agent
coordination, worker limits, review, and staging policy live in
[the Compute Engine shared-box specifics](docs/COMPUTE-ENGINE-BOX-SPECIFICS.md)
and the shared protocol it references.

## Setup and formatting

Use Node.js **26.13.0 or newer**. Run `npm ci` after cloning. Installation
enables Husky hooks; it does not build bundles or generate documentation. Git
installs also need `npm run build` before using package exports. Worktree setup
is documented in the shared-box specifics.

All source files use Prettier. The pre-commit hook runs lint-staged on staged
`src/**/*.{ts,js,css,md}` and `vscode-epsil/{src,test}/**/*.{ts,mjs}` files and
preserves unstaged edits. Agents still stage only their intended hunks and never
commit on the user's behalf. CI is the formatting gate even when hooks are
bypassed.

- `npm run format`: format all source files explicitly.
- `npm run format:check`: check source formatting without modifying files.
- `npm run lint`: Oxlint plus the formatting check. The public explicit-`any`
  policy is an Oxlint rule, with narrow documented exceptions.

## Shared agent skills

Project skills live in the version-controlled `.agents/skills` directory. Codex
loads them there. For Claude Code, run `npm run setup:agents` once after
cloning; it creates local links under `.claude/skills`. It can be rerun safely
and never replaces an existing local skill. Both tools then read the same skill
files.

- `add-operator`: implementation across evaluation, types, syntax, targets, and
  tests.
- `benchmarks`: choosing a harness and interpreting reproducible measurements.

Skills refer to this guide and the architecture/style documents; they do not
maintain copies of their rules. Keep shared skill instructions portable across
agents. Repository-wide validation remains the orchestrator's responsibility.

## Validation frequency

| When                          | What to run                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Developing a change           | Typecheck and tests for the changed area; see delegated-task guidance below. |
| Opening a PR                  | `npm run ci`. GitHub also builds and checks the package.                     |
| Changing the Python compiler  | `npm run test:python` in addition to the normal checks.                      |
| Changing documentation inputs | `npm run doc`; review the generated changes.                                 |
| Preparing a release           | `npm run release`; see the release sequence below.                           |

Prettier runs automatically on staged source files when committing. Normal
checks do not require Python. Release CI runs extended validation, and slower
suites also run nightly. A local release runs the same checks: the publish check
runs the full test suite (`scripts/ci-nightly.sh`), and
`scripts/release-checks.sh` runs the checks of `npm run ci` that the full suite
does not run.

On the shared development machine, follow the
[shared-box specifics](docs/COMPUTE-ENGINE-BOX-SPECIFICS.md) for worker limits,
locks, review, and the core tests required before staging. Do not run aggregate
CI before every staging action.

Jest discovers `jest.config.cjs` automatically. For example, run
`npx jest -w 2 -- test/compute-engine/arithmetic.test.ts`; no `--config` flag is
needed.

A file-name pattern does not select every compiler test. The pattern
`test/compute-engine/compile-` misses `compile.test.ts` and
`list-valued-summand-compile.test.ts`, and about 35 other test files compile to
GLSL or WGSL, some through a helper such as `glslCode(…)` that a search for
`to: 'glsl'` does not find. After a change to emitted code, search `test/` for
the emitted text that changed, or run the full suite.

## Completing delegated tasks

The orchestrator owns the validation plan. The task prompt can adapt these
defaults to the scope, risk, available checks, and work being done in parallel.

Before returning a delegated implementation:

1. Run the checks assigned in the task. Otherwise, use focused tests or probes
   when they provide useful implementation feedback. A compiler check can help
   with a type-heavy change; repository-wide validation is not required from
   every sub-agent.
2. Report changed files, exact commands and results, checks not run and why,
   recommended remaining validation, and unresolved issues. Returning unchecked
   work is acceptable when validation is delegated; identify it as unchecked.
3. Leave integration and release validation to the orchestrator unless assigned
   a validation role. Do not independently repeat aggregate checks merely to
   satisfy a generic completion checklist.
4. For each defect found and not fixed, say which of these applies: a user
   decision blocks the fix (name it, with an example), or the defect is in
   older code that the task does not change (report it as a follow-up task,
   with a reproduction). "Out of scope" alone is not a reason; a defect that
   the change introduces, or in code it rewrites, is fixed in the change.
5. Before you ask the orchestrator or the user to decide, check the facts the
   question rests on: run the probe, and read the documented contract in
   `docs/` with its context. Several questions on 2026-10-30 rested on a
   misread decision or an untested claim.

The orchestrator sorts every unfixed defect of a sub-agent report before writing
its own summary: fix it (or send it back), queue it as the next task when it is
in older code that the change does not touch, ask the user for the blocking
decision, or state why it is not a defect. Only a defect that waits for a user
decision goes to `ROADMAP.md` as an open entry. A queued follow-up is listed in
the report and done after the current change is staged.

The orchestrator combines the results and normally runs typecheck, lint,
dependency checks, and the required test sets once on that combined tree. It can
assign this work to a designated validator. It may reuse earlier results when
the relevant code, configuration, and dependencies are unchanged; fixes require
only the checks they can affect. Send concrete failures back to the responsible
sub-agent when that is the most effective way to resolve them.

`npm run check:docs` is part of CI and can be run directly after instruction or
command changes. It checks maintained entry-point documents and shared skills,
not historical plans, external URLs, anchors, or generated API examples.

These are ownership defaults, not a fixed sequence. Apply judgment to avoid
redundant work while retaining evidence for the applicable completion and
release requirements. Worker limits and box-lock rules still apply.

<details>
<summary>Full command reference</summary>

| Command                                      | Work                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run test:core`                          | Run the curated core files with four workers; extra Jest options are forwarded.                                   |
| `npm run check:docs`                         | Check local file links and npm script names in maintained guidance and shared skills.                             |
| `npm run test:tools`                         | Test the validation/setup helpers with isolated fixtures.                                                         |
| `npm run types`                              | Incrementally check all public library entry points and emit declarations to `dist/types`.                        |
| `npm run typecheck`                          | Run `types`, then check the CLI and compile-time API assertions.                                                  |
| `npm run test:types`                         | Refresh declarations and compile the consumer declaration fixture.                                                |
| `npm run check:deps`                         | Enforce the zero-circular-dependency policy with Madge. Separate from `typecheck`.                                |
| `npm test`                                   | Run the normal runtime suite, then the checkpoint canary in a fresh process.                                      |
| `npm test -- compute-engine/arithmetic -w 2` | Run a targeted suite using the historical path shorthand.                                                         |
| `npm test -- --watchman=false`               | Forward Jest options to the normal full run and canary.                                                           |
| `npm run snapshot`                           | Update snapshots; never update a snapshot marked `@fixme`.                                                        |
| `npm run coverage`                           | Runtime coverage and checkpoint canary.                                                                           |
| `npm run test:python`                        | Check Python dependencies and run suites with Python execution assertions.                                        |
| `npm run test:nightly`                       | Run only the additional `CE_NIGHTLY`-gated suites; not the full nightly pipeline.                                 |
| `npm run test:perf`                          | Run timing assertions serially with `CE_PERF=1`.                                                                  |
| `npm run ci:corpus-pipeline`                 | Check corpus regressions and generated rule artifacts.                                                            |
| `npm run ci`                                 | Lint/format, typecheck, dependencies, corpus checks, consumer declarations, and normal runtime tests.             |
| `npm run ci:extended`                        | Normal CI plus Python execution validation.                                                                       |
| `npm run build`                              | Incremental declarations, both JavaScript bundle variants, version stamping, and production consumer smoke tests. |
| `npm run build -- development`               | Generate declarations and bundles without production consumer smoke tests.                                        |
| `npm run clean`                              | Remove `build` and `dist`, including declaration cache metadata.                                                  |
| `npm start`                                  | Start the development watcher/server.                                                                             |
| `npm run doc`                                | Generate documentation explicitly; independent of builds and installation.                                        |

</details>

<details>
<summary>Specialized checks and troubleshooting</summary>

`npm run test:python` finds the local interpreter, checks NumPy/SciPy, selects
the relevant suites, and enables execution checks. No test flags or environment
variables are required for a configured checkout. If setup is missing, use an
interpreter with NumPy/SciPy at `venv/bin/python3`, or set `CE_PYTHON` to its
path. Normal tests still check Python code generation without starting an
interpreter.

`npm run test:nightly` runs only the additional nightly suites. The local
`bash scripts/ci-nightly.sh run` checks committed HEAD in an isolated worktree
and records a green mark for the shared-machine release guard. It handles the
box lock and test configuration itself; it does not replace lint or corpus CI.

Declaration generation and source validation share `tsconfig.types.json`.
`typecheck` checks the public-entry graph, CLI, and compile-time API assertions;
Jest checks runtime behavior. Consumer checks validate generated declarations
and bundles. For unrelated files outside the public-entry graph, use
`./node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`. Avoid
bare `npx tsc`, because two compiler packages coexist. After-edit hooks may
already perform the whole-source check; they do not replace repository checks.

</details>

## Releasing to npm

One command makes a release:

```sh
npm run release # a minor release; or: npm run release -- patch (major, or an explicit version)
                # --yes skips the confirmation question
```

`scripts/release.sh` does these steps, in this order:

1. It refuses when files are staged, when a file that the release writes (the
   version files, `CHANGELOG.md`, the generated documentation) has uncommitted
   changes, when the publish check would refuse the tree (an uncommitted change
   or an untracked file that a test can see; markdown outside `src/` and `test/`
   is allowed), or when npm does not accept the login. It warns when
   `CHANGELOG.md` has no `## [Unreleased]` heading, and when the latest full
   test run failed. Then it runs `scripts/release-checks.sh`: lint,
   `check:docs`, `check:deps`, `test:tools` and the corpus pipeline, the checks
   of `npm run ci` that the full test suite does not run.
2. `npm version <bump> --no-git-tag-version`. The version hook
   (`scripts/version.sh`) writes the version and date in the changelog and the
   version of the VS Code extension.
3. `npm run doc`. It runs after the version change, so that the generated
   references show the release version.
4. It shows the changed files, asks for confirmation, and commits only those
   files as `<version>`.
5. `npm publish` (see below), without its VS Code extension step, so that a
   failure of `npm publish` means that nothing was uploaded.
6. After the upload, it tags the release commit `v<version>`.
7. It packages the VS Code extension (`scripts/package-vsix.sh`). It does not
   push; it prints the push command.

When `npm publish` fails, nothing is published, and the release commit stays
without a tag. Fix the cause, commit, run `npm publish`, then tag the published
commit. When only step 7 fails, fix the cause and run
`bash scripts/package-vsix.sh`.

A local release takes no box lock, except for the full test suite, which
`scripts/ci-nightly.sh` runs under the lock: no other session is active during a
release (user decision 2026-10-30). Agents leave commits and publishing to the
user unless explicitly instructed otherwise.

`npm publish` checks release eligibility, runs `scripts/release-checks.sh`
(unless `npm run release` ran it already), performs a clean production build
with consumer smoke tests, runs the full test suite at HEAD when no passing run
covers it, uploads the package, and packages the VS Code extension. When you run
`npm publish` without `npm run release`, generate the documentation first and
include it in the release commit.

<details>
<summary>Local release guard and previously completed validation</summary>

The shared-machine release guard requires a passing recorded run covering HEAD.
If needed, publishing runs the local nightly pipeline after the build.
`npm run ci:extended` does not record that green mark, so validation may repeat.

If extended validation already passed on the unchanged release tree, use
`CE_FULL_SUITE_PASSED=1 npm publish` to assert that result. This is also the
supported path without the local suite-status helper. Never use this assertion
for an unverified or subsequently changed tree.

The build and the VS Code extension packaging print one line per step. Their
output goes to a log in `$TMPDIR/compute-engine-publish/`, and a failing step
prints the end of its log. `CE_VERBOSE=1 npm publish` shows all the output.

</details>

Alternatively, push the version commit and create a GitHub release tagged
`v<version>`. The publish workflow installs Python dependencies, runs
`ci:extended`, and publishes; `prepack` creates the production artifacts. The
workflow does not generate documentation, so include it in the release commit.
`npm pack` also triggers the clean production build.

### Names that published versions point to

Every published version of `@cortex-js/compute-engine` contains these URLs in
its `package.json`, and a published version cannot be changed:

- `homepage`: `https://cortexjs.io/compute-engine/`
- `repository`: `https://github.com/cortex-js/compute-engine.git`
- `bugs`: `https://github.com/cortex-js/compute-engine/issues/`

Keep the GitHub organization `cortex-js` and the domain `cortexjs.io` registered
permanently, also after a rename or a move of the project. GitHub redirects a
moved repository only while its old name is not taken. If the organization is
released, anyone can register it and receive the repository URL of every
published version. If the domain moves, keep its redirect path-preserving
(`cortexjs.io/compute-engine/` must reach the documentation).
