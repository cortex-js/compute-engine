# The pre-commit hook restores unstaged hunks at the wrong lines

Date: 2026-10-31. Status: the user chose option A on 2026-10-31. It is
installed as `scripts/check-partly-staged-formatted.mjs`, called first in
`.husky/pre-commit`, with tests in
`scripts/tests/check-partly-staged-formatted.test.mjs`. `package.json` and the
dependencies are unchanged.

## 1. What happened

Commit `a4d2de2d5` staged only part of
`src/compute-engine/boxed-expression/named-arguments.ts`. The pre-commit hook
(`.husky/pre-commit`: `npx --no-install lint-staged`, with lint-staged 16.4.0
and `prettier --write` on `src/**/*.{ts,js,css,md}`) committed the staged part
correctly, but it wrote two unstaged hunks back at the wrong lines:

- `literalParameterDefault,` went into the next import block (`./utils.js`
  names), not into the `./parameter-defaults.js` import.
- `ce: ComputeEngine,` went into the body of `inlineLiteralSignature()`, 3
  lines below the parameter list.

lint-staged exited with status 0. The files `named-arguments.intended.ts.txt`,
`named-arguments.after-commit.ts.txt` and `intended-vs-after-commit.diff` in
this directory show the result.

## 2. Cause

Read in `node_modules/lint-staged/lib/gitWorkflow.js` (16.4.0):

1. Before the tasks, for each partly staged file, lint-staged writes the
   unstaged changes as a patch: `git diff --unified=0 … --output <patch>`.
   `--unified=0` gives each hunk no context lines.
2. It removes the unstaged changes (`git checkout --force -- <files>`) and runs
   `prettier --write` on the staged content, then `git add`s the result.
3. It applies the patch again with
   `git apply -v --whitespace=nowarn --recount --unidiff-zero`. Only if that
   fails does it retry with `--3way`, and only if that also fails does it
   report an error.

A hunk that only inserts lines has no old lines. With no context lines either,
git has nothing to compare, so it inserts the lines at the line number written
in the hunk header. When Prettier changed the number of lines above that
point, the number is wrong, and git inserts the lines at the wrong place with
no error.

In `a4d2de2d5`, the staged import was written on 4 lines:

```ts
import {
  boxParameterDefault,
  callSiteDefault,
} from './parameter-defaults.js';
```

Prettier joined it into 1 line. Every line below moved up by 3. The two
unstaged hunks were pure insertions (`  literalParameterDefault,` after
`  callSiteDefault,`, and `  ce: ComputeEngine,` after
`export function inlineLiteralSignature(`), so each landed 3 lines too low.

## 3. Reproductions (both run on 2026-10-31)

- `repro.sh` in this directory: a minimal case in a new temporary repository,
  with the lint-staged and Prettier installed in this repo. Run:
  `zsh docs/scratch/2026-10-31-lint-staged-misplaced-hunks/repro.sh "$PWD"`.
  It prints `RESULT: BUG REPRODUCED` and exits 0. The inserted line `  e,` lands
  below the import block. Its second unstaged hunk (`ce: number,`) changes an
  existing line, so git matches it by content and places it correctly: only
  pure insertions are misplaced.
- The real incident, in a detached linked worktree at `e3ca9c1a6` (the parent
  of `a4d2de2d5`). The staged content was rebuilt as the committed file with
  the import written on 4 lines; the working file was
  `named-arguments.intended.ts.txt`. After lint-staged (exit 0), the working
  file was byte-identical to `named-arguments.after-commit.ts.txt`, and the
  throwaway commit had the same blob as `a4d2de2d5` for that file. The worktree
  is removed.

## 4. What does not fix it (verified)

- **Upgrade.** The latest version on npm is 17.6.0 (`npm view lint-staged
  version`). Its `lib/gitWorkflow.js` (read from the npm tarball) has the same
  `--unified=0` diff arguments and the same `--unidiff-zero` apply. The
  changelog from 16.4.0 to 17.6.0 has no entry about the placement of restored
  hunks. A search of the lint-staged GitHub issues (queries `unified=0`,
  `unidiff-zero`, `partially staged prettier`, `unstaged changes corrupted`,
  `hunk applied wrong location` and others) found no report of this defect.
  Also, 17.6.0 (PR #1854) now stages changes that the tasks make to **any**
  tracked file, not only to the originally staged files. That is an additional
  risk on a shared machine.
- **`--fail-on-changes`.** Tested with `repro.sh` (`LS_FLAGS=--fail-on-changes`).
  The commit is refused, but lint-staged still writes the unstaged patch back
  onto the reformatted file, so the working file is damaged in the same way.
- **`--no-hide-partially-staged`.** Prettier then formats the working file,
  and lint-staged `git add`s the whole file, so the unstaged hunks go into the
  commit (read in the source, and in the changelog entry of PR #1563). Not
  tested, because that result is the opposite of what the hook must do.
- **`--hide-unstaged`, `--no-stash`.** They use the same patch and the same
  apply (read in the source).

## 5. What does fix it (verified)

An apply with context lines. With the real file, a patch made with
`--unified=3` and applied without `--unidiff-zero`:

- the plain apply fails on the import hunk ("patch does not apply");
- the `--3way` retry places `ce: ComputeEngine,` in the parameter list of
  `inlineLiteralSignature()` (correct), writes conflict markers for the import
  hunk, and exits with status 1, so lint-staged would report an error and
  restore the original state.

So context lines turn a silent wrong result into a correct result or a loud
failure. Context lines can still match at a wrong place when the same 3 lines
appear nearer to the stated line number, but that is much less likely than
with no context at all.

## 6. Options

The user decides. Each option is described with the same example: a file whose
staged part has the 4-line import above, and whose unstaged part inserts one
line below it.

### Option A (recommended): refuse the commit before lint-staged runs

Add a hook step before `npx --no-install lint-staged`:
`node scripts/check-partly-staged-formatted.mjs`. For each partly staged
file that a `prettier` glob of the lint-staged configuration matches, it
formats the staged content (`git show :<file>`) with Prettier and refuses the
commit when the result differs.

- Example: today the commit succeeds and the file is damaged. With option A,
  the commit is refused with the file name; nothing is changed. The author
  formats the file, stages the same hunks again, and commits.
- Why it is enough: when the step passes, Prettier changes no partly staged
  file, so no line moves, and the zero-context patch goes back to the lines it
  came from. Tested: refuses the reproduction (working file unchanged), passes
  a case where the staged part is already formatted (commit made, working file
  equals the intended file), passes on the main tree as it is today.
- Cost: a commit with a partly staged, unformatted file is refused. Fully
  staged files are still formatted by lint-staged as today. About 200 lines of
  script, no new dependency (it uses `picomatch` and `prettier`, which are
  installed).
- Limit: it covers only the `prettier` tasks, which are the only tasks in the
  configuration today. A new task that rewrites files would need the same
  check.

### Option B: the hook writes nothing; it only checks

Replace lint-staged with a hook step that runs a Prettier check on the staged
content of every staged file that the globs match, and refuses the commit when
one is not formatted. No hiding, no restore, no `git stash`.

- Example: the same commit is refused, as with A. A fully staged but
  unformatted file is also refused (today lint-staged formats it and commits).
- Advantage: the hook never changes the working tree or the index. lint-staged
  16.4.0 also creates a backup stash in the shared `refs/stash`, and when a
  task fails it runs `git reset --hard HEAD` and then `git stash apply --index`
  (read in `restoreOriginalState()`); an edit that a peer session makes between
  those two commands is lost. Option B removes that risk too.
- Cost: more refused commits, also for commits that the user makes by hand.
  `lint-staged` and its dependencies can be removed from `package.json`.

### Option C: patch lint-staged to use context lines

Use `patch-package` (a new dependency) to change `--unified=0` to
`--unified=3` and to remove `--unidiff-zero` in `gitWorkflow.js`, and report
the defect upstream with `repro.sh`.

- Example: the same commit fails with "Unstaged changes could not be restored
  due to a merge conflict", and lint-staged restores the original state. A
  commit where the context still matches succeeds with the hunks in the right
  place.
- Cost: a patch to keep across lint-staged versions; the `reset --hard` risk of
  option B stays; a context match at a wrong place is still possible.

### Option D: format only fully staged files, silently skip partly staged ones

A lint-staged function configuration that removes partly staged files from the
`prettier --write` list.

- Example: the commit succeeds, the unstaged hunks come back correctly, but the
  4-line import is committed unformatted.
- Cost: unformatted code reaches HEAD with no message. Not recommended; A gives
  the same safety and tells the author.

### If nothing is decided

The hook stays as it is. Each commit with a partly staged file whose staged
part Prettier rewraps can damage the working file with no message. Under the
shared-machine staging rule (§5.4: stage only one's own hunks with
`git apply --cached`), partly staged files are common, so the defect can occur
again.
