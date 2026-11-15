# Delivering Compute Engine to Tycho without npm, and a monorepo

Status: DRAFT for the user and tycho-desk. Nothing in this plan is
implemented. Part A can start when the user approves it; part B is a
direction to decide, with no work item yet.

## 1. The problem

Tycho takes a CE change in three steps today:

1. Before the change lands in CE, tycho-desk runs Tycho's gates on a packed
   CE build (`CE_ALT_PKG` and `scripts/repros/ce-alt-hook.mjs` in Tycho;
   for example "a packed build of 465774a80" in the message of `a67cb8a26`).
2. The user releases CE to npm: the release checks, the full suite under the
   box lock (it can wait in the queue for a long time; since `5989211fa` the
   release waits at the front of the queue, behind the holder), the upload,
   and about 10 minutes until npm serves the version.
3. Tycho pins the npm version (`"@cortex-js/compute-engine": "0.190.0"` in
   Tycho's `package.json`) and `scripts/ce-adopt.sh` runs the gates again,
   about 20 minutes with the Chromium lane, under the box lock.

The gates of step 1 and step 3 test the same code. Step 2 is on the
critical path of every Tycho adoption, and Tycho adopted nearly every CE
release (0.185.1 to 0.190.0 each have an adoption commit in Tycho).

## 2. Part A: Tycho pins a CE build by commit

### 2.1 The mechanism

- CE makes a build of a commit with `npm pack` (the `prepack` script runs
  the clean production build and the consumer smoke tests). The file is
  about 7.6 MB (the 0.190.0 tarball from npm: 7,595,743 bytes).
- The version in the tarball is a prerelease of the next version, so that
  the build names its commit: `0.193.0-tycho.<short sha>`. npm orders a
  prerelease before the release it names.
- The tarball is uploaded as an asset of a GitHub prerelease in
  `cortex-js/compute-engine`, tagged `tycho-<short sha>`.
- Tycho's `package.json` names the asset URL:
  `"@cortex-js/compute-engine": "https://github.com/cortex-js/compute-engine/releases/download/tycho-<sha>/cortex-js-compute-engine-0.193.0-tycho.<sha>.tgz"`.
  `package-lock.json` records its integrity hash, so `npm ci` installs the
  same bytes on the Mac Studio, on eniac and in Tycho's GitHub CI
  (`.github/workflows/ci.yml` runs `npm ci` on `ubuntu-latest`).
- Adoption becomes: pack, run the gates once on the packed build (step 1 of
  today), pin. Step 3 disappears; step 2 leaves the critical path.
- The npm release stays as it is, for every other user, at a time the user
  chooses. Its full suite gates what npm users get, not what Tycho runs.

### 2.2 What changes, by repo

CE:

- A script `scripts/tycho-build.sh <commit>`: makes a worktree at the
  commit, `npm ci`, sets the prerelease version, `npm pack`, creates the
  GitHub prerelease with the asset (`gh release create --prerelease`), prints
  the URL and the integrity hash, removes the worktree. It refuses a commit
  that is not on `origin/main`, so that every pinned build can be rebuilt
  from public history.
- The `gh release create` step publishes to GitHub: the user runs it, or
  approves once that the script may run it.
- BUILD.md: a section "Builds for Tycho".

Tycho (done by tycho-desk, after the user approves):

- `scripts/ce-adopt.sh` accepts a commit or a URL besides a version.
- The adoption records name the CE commit and the build version instead of
  only a release number: `docs/COMPUTE_ENGINE_LOG.md`, the "Tycho half on
  adoption" lines of the CE issue files with `source: tycho`, and
  `scripts/ce-changelog-decisions.mjs`, which reads the CHANGELOG entries
  between two versions. Between two commits there is no CHANGELOG section
  yet: it reads the `## [Unreleased]` entries added in the range
  (`git diff <a>..<b> -- CHANGELOG.md`).
- `docs/COMPUTE_ENGINE_CHECKLIST.md`, "Per-adoption checklist".

### 2.3 Costs and risks

- The release's full suite no longer gates Tycho. Tycho's gates and the CE
  nightly run (a full run, but after the fact) replace it. A commit that
  breaks the nightly is fixed like any nightly failure.
- If the CE repo becomes private (an open decision of the user's), the asset
  URL needs a token in Tycho's CI and on eniac. Part B removes the problem.
- GitHub keeps one prerelease per adopted build. They can be deleted after
  the next npm release that contains them; the lock hash then names a URL
  that no longer exists, so a deletion is safe only for builds that no Tycho
  commit still pins. Recommended: keep them.
- Each build is a `prepack` build in a fresh worktree: `npm ci` plus the
  production build. Its time is not measured yet. It takes no box lock under
  the current rule (BUILD.md: a release's build takes none); if it is slow
  on a loaded box, it can run on eniac, since it runs no timing test.

### 2.4 Alternatives considered

- A tarball committed to Tycho (`file:vendor/….tgz`): works with no network
  and no token, but adds about 7.6 MB to Tycho's history at each adoption
  (Tycho's pack is 329 MB today).
- An npm prerelease under a dist-tag (`npm publish --tag tycho`): no GitHub
  release, but it keeps npm's wait and the npm login, so it removes only
  the release checks.
- A git dependency (`github:cortex-js/compute-engine#<sha>`): npm builds the
  package at install, which needs CE's dev dependencies and the full build
  in every `npm ci` of Tycho. Rejected.

## 3. Part B: one private monorepo

### 3.1 The idea

One private repository holds CE and Tycho. A public `cortex-js/compute-engine`
repository receives an export of the CE subset. Tycho then uses CE from the
same tree (an npm workspace, or a path dependency on the built package), and
a change that spans both is one commit with one set of gates.

### 3.2 What it removes

- Part A entirely: no build, no asset, no pin, no adoption step.
- The Tycho request process across repos: an issue with `source: tycho`
  becomes an ordinary issue, and the row protocol of Tycho's
  `docs/COMPUTE_ENGINE.md` goes.
- The cross-repo paths: 60 tracked CE files name `dev/tycho` paths and 8
  Tycho files name the CE checkout, and `ci-remote.sh` copies CE's
  `issues/` to eniac for Tycho's `lint:ce-waits`.

### 3.3 What it costs

- The public repo needs an export: a filtered history of the CE directories
  (`git filter-repo` or a subtree split, run on each export), or a sync
  tool such as Copybara. The export must leave out every Tycho file, every
  reference to Tycho in the CE files that are exported (the 60 files above
  include source and test files), and the issues and plans that name Tycho
  or its users. That is a review step on each export. Not verified: which
  tool fits; none is set up on this machine.
- External contributions arrive on the public repo and have to be imported.
  Every fork PR so far has been landed by hand (the visibility record of
  2026-10-18), so the process changes little.
- CI minutes: CE's test workflow uses about 4,200 GitHub Actions minutes a
  month, and a private repo on the free plan gets 2,000 (same record). In a
  private monorepo, CE's CI moves into the private minutes, unless it keeps
  running on the public export only.
- The two toolchains stay different: CE uses Jest 30 and TypeScript 6
  (`@typescript/typescript6`), Tycho uses Vitest 5; both need Node 26.13 or
  later. A monorepo does not require one runner, but the shared-box rules,
  the two nightly jobs, the box-lock owners and the staging queue (one per
  repository root) were written for two repos.
- The history: CE has 5,674 commits and a 122 MB pack, Tycho 6,905 commits
  and a 329 MB pack. Both histories can be kept (CE imported under a
  subdirectory).

### 3.4 How A and B relate

Part A is small and reversible, and it is useful until B exists. B makes A
unnecessary. Recommended: do A now; decide B together with the open
decision on the visibility of the CE repo, because a private monorepo with a
public export is one answer to that decision (a private CE where only an
export is public).

## 4. Decisions for the user

1. Part A: approve the mechanism of 2.1, the GitHub prerelease asset.
   Recommended. Alternative: the tarball committed to Tycho (2.4).
2. Part A: who runs `gh release create`: the script, with a one-time
   approval (recommended), or the user each time.
3. Part B: a direction to study, decided with the visibility of the CE repo.
   A study would measure the export (which files and references leave, which
   tool) and the CI minutes. No work until the user asks.
