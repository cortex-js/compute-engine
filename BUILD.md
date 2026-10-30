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
`src/**/*.{ts,js,css,md}` files and preserves unstaged edits. Agents still stage
only their intended hunks and never commit on the user's behalf. CI is the
formatting gate even when hooks are bypassed.

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
| Preparing a release           | Follow the release sequence below, including `npm run ci:extended`.          |

Prettier runs automatically on staged source files when committing. Normal
checks do not require Python. Release CI runs extended validation, and slower
suites also run nightly. Run extended validation locally before publishing to
npm.

On the shared development machine, follow the
[shared-box specifics](docs/COMPUTE-ENGINE-BOX-SPECIFICS.md) for worker limits,
locks, review, and the core tests required before staging. Do not run aggregate
CI before every staging action.

Jest discovers `jest.config.cjs` automatically. For example, run
`npx jest -w 2 -- test/compute-engine/arithmetic.test.ts`; no `--config` flag is
needed.

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

Bump the version before generating documentation, so generated references use
the release version. Defer npm's automatic commit and tag until the
documentation is included:

```sh
npm version patch --no-git-tag-version # or minor, major, or an explicit version
npm run doc
# Review and commit the version changes and generated documentation.
# Tag that release commit as v<version> when ready.
npm run ci:extended
npm publish
```

The version hook updates the changelog and the VS Code extension's version and
stages those files. Review them alongside the root package/lockfile changes.
Without `--no-git-tag-version`, `npm version` creates its commit and tag before
the subsequent documentation generation.

On a shared machine, take the box lock for aggregate validation/build runs as
required by the shared protocol. Agents leave commits and publishing to the user
unless explicitly instructed otherwise.

`npm publish` automatically checks release eligibility and performs a clean
production build with consumer smoke tests. Documentation must be generated
beforehand and included in the release commit.

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
