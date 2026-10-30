#! bash

# Usage: npm run release [-- <patch|minor|major|x.y.z>] [--yes]
#
# Without a version argument, the release is a minor release.
#
# Makes a release in one command:
#
#   1. Refuses unless the tree has no uncommitted change and nothing is
#      staged, and unless npm accepts the login (`npm whoami`). Then runs
#      the checks of `npm run ci` that the full test suite does not run
#      (scripts/release-checks.sh). These checks run first so that a refusal
#      leaves nothing to undo.
#   2. `npm version <bump> --no-git-tag-version`. Its `version` hook
#      (scripts/version.sh) writes the version and date in CHANGELOG.md and
#      the version of the VS Code extension.
#   3. `npm run doc`, after the version change, so that the generated
#      references show the release version.
#   4. Shows the changed files and asks for confirmation (`--yes` skips the
#      question), then commits them as "<version>".
#   5. `npm publish`. Its hooks build the package, run the full test suite
#      at the release commit when no passing run covers it, and upload the
#      package (scripts/prepublish-check.sh). Its `postpublish` hook, which
#      packages the VS Code extension, is skipped (CE_RELEASE_SKIP_VSIX=1),
#      so that a non-zero exit of `npm publish` means the upload did not
#      happen.
#   6. Tags the release commit `v<version>`, only after the upload, so that a
#      failed publish leaves no tag to move. The tag names the commit made in
#      step 4, not the HEAD of that moment: another session can commit
#      during the publish. The publish check refuses, before the upload,
#      when HEAD is not that commit (CE_RELEASE_SHA).
#   7. Packages the VS Code extension (scripts/package-vsix.sh).
#
# Nothing is pushed. The script prints the push command at the end.
#
# When step 5 fails, the release commit stays and nothing is published. Fix
# the cause, commit, and run `npm publish`, then tag the release commit.

set -o pipefail
cd "$(dirname "$0")/.."

BUMP="minor"
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    patch | minor | major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    *)
      echo "Usage: npm run release [-- <patch|minor|major|x.y.z>] [--yes]" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo ""
  echo "✗ $1"
  echo ""
  exit 1
}

# The files that steps 2 and 3 write. The documentation list is the output of
# scripts/doc.sh.
VERSION_FILES="package.json package-lock.json CHANGELOG.md vscode-epsil/package.json vscode-epsil/package-lock.json"
DOC_FILES="src/api.md src/epsil/docs/errors.md src/epsil/docs/library.md src/epsil/docs/reference"

# Step 1: checks that change nothing.
if [ -n "$(git diff --cached --name-only)" ]; then
  fail "Files are staged. Commit them, or remove them from the index, then run the release again."
fi
# The files that the release writes must have no uncommitted change: the
# release would overwrite it, commit it, or remove it with the undo command
# below. The publish check allows uncommitted markdown outside src/ and
# test/, CHANGELOG.md included, so it does not cover this case.
# shellcheck disable=SC2086 # The file lists are split on purpose.
OWN_CHANGES=$(git status --porcelain --untracked-files=all -- $VERSION_FILES $DOC_FILES)
if [ -n "$OWN_CHANGES" ]; then
  echo "$OWN_CHANGES"
  fail "The release writes these files, and they have uncommitted changes. Commit or remove them, then run the release again."
fi
# The same rule as the check of `npm publish` (scripts/prepublish-check.sh),
# so that a tree it refuses is refused here, before the version changes:
# `suite-status.mjs release-check` exits 1 for an uncommitted change or an
# untracked file that a test can see, and exits 3 when no passing full run
# covers HEAD (the publish then runs the suite). Without that helper, any
# uncommitted change or untracked file is refused.
SUITE_STATUS="$HOME/.claude/scripts/suite-status.mjs"
if [ -f "$SUITE_STATUS" ]; then
  CHECK_OUTPUT=$(node "$SUITE_STATUS" release-check --repo . 2>&1)
  CHECK_STATUS=$?
  case "$CHECK_STATUS" in
    0) ;;
    3)
      # A failed full run is worth knowing before the release commit: the
      # suite that the publish runs will probably fail too.
      if printf '%s' "$CHECK_OUTPUT" | grep -q 'latest full run at .* failed'; then
        echo "⚠ $CHECK_OUTPUT"
      fi
      ;;
    1)
      echo "$CHECK_OUTPUT"
      fail "Commit or remove the uncommitted changes named above, then run the release again."
      ;;
    *)
      echo "$CHECK_OUTPUT"
      fail "The release check failed with exit $CHECK_STATUS: it cannot tell whether the tree is clean."
      ;;
  esac
elif [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${CE_FULL_SUITE_PASSED:-}" != "1" ]; then
  # prepublish-check.sh refuses in this case too, but only after the release
  # commit.
  fail "$SUITE_STATUS is missing, so the publish check cannot tell whether the full test suite passed. Run 'npm run ci:extended'; if it passes, run 'CE_FULL_SUITE_PASSED=1 npm run release -- $BUMP'."
elif [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  git status --short --untracked-files=all
  fail "The tree has uncommitted changes or untracked files (above). Commit or remove them, then run the release again."
fi
# npm settings that change what the release does: with ignore-scripts,
# `npm version` and `npm publish` skip their hooks (the changelog, the build,
# the checks); with dry-run, `npm publish` uploads nothing, but the commit and
# the tag would still be made.
for setting in ignore-scripts dry-run; do
  if [ "$(npm config get "$setting")" = "true" ]; then
    fail "The npm setting '$setting' is on. Turn it off ('npm config delete $setting', or unset npm_config_$(printf '%s' "$setting" | tr - _)), then run the release again."
  fi
done
REGISTRY=$(npm config get registry)
NPM_USER=$(npm whoami --registry "$REGISTRY" 2>/dev/null) ||
  fail "Not authenticated with the npm registry ($REGISTRY). Run 'npm login', then run the release again."
echo "✓ Authenticated with $REGISTRY as $NPM_USER"
# The checks of `npm run ci` that the full suite does not run. They are
# skipped when the caller says that `npm run ci:extended` passed, as the
# publish check does (GITHUB_ACTIONS=true or CE_FULL_SUITE_PASSED=1).
# CHECKED_SHA is the commit that they checked: the release commit must have
# it as its parent (step 4).
CHECKED_SHA=$(git rev-parse HEAD)
if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${CE_FULL_SUITE_PASSED:-}" != "1" ]; then
  bash scripts/release-checks.sh ||
    fail "A release check failed (above). Nothing was changed. Fix the cause, commit, then run the release again."
fi
# scripts/version.sh replaces the "[Unreleased]" heading with the version
# and date. Without that heading the release has no changelog entry.
if ! grep -q '\[Unreleased\]' CHANGELOG.md; then
  echo "⚠ CHANGELOG.md has no '## [Unreleased]' heading: this release gets no changelog entry."
fi

# Step 2: the version.
OLD_VERSION=$(node -pe "require('./package.json').version")
bash scripts/run-quietly.sh "Version ($BUMP)" npm version "$BUMP" --no-git-tag-version ||
  fail "npm version failed. Restore the changed files listed by 'git status' before running the release again."
VERSION=$(node -pe "require('./package.json').version")
TAG="v$VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
  fail "The tag $TAG exists already. Restore the files changed by 'npm version' (git status lists them)."
fi
# The version must be new on the registry too. Step 5 relies on this: when
# the upload fails, finding this version on the registry then proves that
# this release uploaded it.
# registry_has_version: prints "yes" when the registry has $PACKAGE@$VERSION,
# "no" when it answers that the version does not exist (error E404), and
# "unknown" for any other answer, such as a network error.
PACKAGE=$(node -pe "require('./package.json').name")
registry_has_version() {
  npm view "$PACKAGE@$VERSION" version --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let v; try { v = JSON.parse(s); } catch { v = undefined; }
      if (v === process.argv[1]) console.log("yes");
      else if (v?.error?.code === "E404") console.log("no");
      else console.log("unknown");
    });' "$VERSION"
}
case "$(registry_has_version)" in
  no) ;;
  yes) fail "$PACKAGE@$VERSION is already on the registry. Restore the files changed by 'npm version' (git status lists them), then choose another version." ;;
  *) fail "The registry did not say whether $PACKAGE@$VERSION exists (network error?). Restore the files changed by 'npm version' (git status lists them), then run the release again." ;;
esac

# Step 3: the documentation.
# undo_hint: the command that removes the changes of steps 2 and 3.
undo_hint() {
  echo "  To remove them: git restore --staged --worktree -- $VERSION_FILES $DOC_FILES"
  echo "  (and delete any new file that 'git status' lists under src/epsil/docs/reference)."
}

bash scripts/run-quietly.sh "Documentation" npm run doc || {
  echo ""
  echo "✗ npm run doc failed. The version change ($OLD_VERSION → $VERSION) is in the tree, not committed."
  undo_hint
  exit 1
}

# Step 4: the release commit.
# shellcheck disable=SC2086 # The file lists are split on purpose.
git add -- $VERSION_FILES $DOC_FILES || fail "git add failed."
echo ""
echo "Release $OLD_VERSION → $VERSION. Changes to commit:"
# shellcheck disable=SC2086 # The file lists are split on purpose.
git diff --cached --stat -- $VERSION_FILES $DOC_FILES
echo ""
# The staged content of the release files, as shown above. It is compared
# again after the question: another session can stage a change meanwhile.
# shellcheck disable=SC2086 # The file lists are split on purpose.
SHOWN_INDEX=$(git ls-files -s -- $VERSION_FILES $DOC_FILES)
if [ "$YES" -ne 1 ]; then
  read -r -p "Commit these changes as \"$VERSION\" and publish? [y/N] " answer
  case "$answer" in
    y | Y | yes) ;;
    *)
      echo ""
      echo "✗ Stopped. The changes are staged, not committed."
      undo_hint
      exit 1
      ;;
  esac
fi
# `git commit --only` commits the working-tree content of these files, so
# a file changed after the list above was shown would go in unseen.
# shellcheck disable=SC2086 # The file lists are split on purpose.
if [ -n "$(git diff --name-only -- $VERSION_FILES $DOC_FILES)" ] ||
  [ "$(git ls-files -s -- $VERSION_FILES $DOC_FILES)" != "$SHOWN_INDEX" ] ||
  [ "$(node -pe "require('./package.json').version")" != "$VERSION" ]; then
  git diff --stat -- $VERSION_FILES $DOC_FILES
  echo ""
  echo "✗ These files changed after the list above was shown. Nothing was committed."
  undo_hint
  exit 1
fi
# `--only` commits these files and nothing else: another session can stage
# its own files while the question waits.
# shellcheck disable=SC2086 # The file lists are split on purpose.
PARENT_SHA=$(git rev-parse HEAD)
# Another session can commit after the checks of step 1, for example while
# the question waited. The release checks did not see that commit, and
# CE_RELEASE_CHECKS_DONE=1 below would skip them in the publish check.
if [ "$PARENT_SHA" != "$CHECKED_SHA" ]; then
  echo ""
  echo "✗ HEAD moved from ${CHECKED_SHA:0:9} to ${PARENT_SHA:0:9} after the release checks. Nothing was committed."
  undo_hint
  exit 1
fi
git commit -q -m "$VERSION" --only -- $VERSION_FILES $DOC_FILES ||
  fail "git commit failed. The changes are staged."
RELEASE_SHA=$(git rev-parse HEAD)
# Another session can commit between `git commit` and the line above: HEAD
# would then be its commit. The release commit has the version as its
# message and the HEAD before the commit as its parent.
if [ "$(git log -1 --format=%s "$RELEASE_SHA")" != "$VERSION" ] ||
  [ "$(git rev-parse "$RELEASE_SHA^")" != "$PARENT_SHA" ]; then
  fail "HEAD moved right after the release commit: ${RELEASE_SHA:0:9} is not it. Nothing was published. Find the commit \"$VERSION\" with 'git log', then run 'npm publish' from a tree where it is HEAD."
fi
echo "✓ Committed ${RELEASE_SHA:0:9} \"$VERSION\""
# With `--only`, a pre-commit hook that rewrites a file (the lint-staged
# prettier step) leaves the old content staged, as a change that would undo
# the rewrite in the next commit. The generated documentation is excluded
# from prettier today (.prettierignore), so this is a guard.
# shellcheck disable=SC2086 # The file lists are split on purpose.
if [ -n "$(git diff --cached --name-only -- $VERSION_FILES $DOC_FILES)" ]; then
  git diff --cached --stat -- $VERSION_FILES $DOC_FILES
  fail "The commit hook changed these files: the index still holds their old content. Run 'git add' on them before any other commit, then run 'npm publish'."
fi

# Step 5: the publish, with the build and test checks of its hooks.
# CE_RELEASE_SHA makes prepublish-check.sh refuse, before the upload, when
# HEAD is not the release commit (another session committed meanwhile).
# CE_RELEASE_UPLOAD_MARK: prepublish-check.sh creates this file when its last
# check before the upload passes. A failure without it happened before the
# upload. A failure with it can come after a successful upload (for example,
# the connection drops before the registry answers), so the registry decides.
UPLOAD_MARK="$(git rev-parse --git-dir)/ce-release-upload-mark"
rm -f "$UPLOAD_MARK"
if ! CE_RELEASE_SKIP_VSIX=1 CE_RELEASE_CHECKS_DONE=1 CE_RELEASE_SHA="$RELEASE_SHA" CE_RELEASE_UPLOAD_MARK="$UPLOAD_MARK" npm publish; then
  if [ ! -f "$UPLOAD_MARK" ]; then
    fail "npm publish failed before the upload; nothing was published. The release commit ${RELEASE_SHA:0:9} stays. Fix the cause, commit, run 'npm publish', then tag the commit that was published: 'git tag $TAG <commit>'."
  fi
  rm -f "$UPLOAD_MARK"
  # The registry can take several minutes to show a new version: ask every
  # 30 seconds, for up to 10 minutes.
  echo ""
  echo "npm publish failed during the upload. Asking the registry whether $PACKAGE@$VERSION is there (up to 10 minutes)…"
  FOUND=0
  for _ in $(seq 1 20); do
    if [ "$(registry_has_version)" = "yes" ]; then
      FOUND=1
      break
    fi
    sleep 30
  done
  if [ "$FOUND" -ne 1 ]; then
    fail "The registry does not show $PACKAGE@$VERSION after 10 minutes: the upload most likely failed. The release commit ${RELEASE_SHA:0:9} stays. Run 'npm publish' again, then 'git tag $TAG ${RELEASE_SHA:0:9}'."
  fi
  echo "✓ The registry shows $PACKAGE@$VERSION: the upload succeeded."
fi
rm -f "$UPLOAD_MARK"

# Step 6: the tag.
git tag "$TAG" "$RELEASE_SHA" ||
  fail "Published, but 'git tag $TAG $RELEASE_SHA' failed. Run it by hand, then 'bash scripts/package-vsix.sh'."
echo "✓ Published $VERSION and tagged ${RELEASE_SHA:0:9} as $TAG"

# Step 7: the VS Code extension.
# The extension bundles the engine from the source files on disk, which is
# the shared tree, and reads the engine version from the root package.json.
# It must contain the published engine: HEAD must still be the release
# commit, and these files must have no uncommitted change, before and after
# the packaging (another session can edit them). Untracked files count too:
# the packaging includes them. Its own outputs (dist/, *.vsix,
# node_modules/) are ignored by git, so they do not count.
same_tree_as_release() {
  [ "$(git rev-parse HEAD)" = "$RELEASE_SHA" ] &&
    [ -z "$(git status --porcelain --untracked-files=all -- src vscode-epsil package.json package-lock.json)" ]
}
same_tree_as_release ||
  fail "The package is published and tagged, but the tree is no longer the release commit (HEAD moved, or src/, vscode-epsil/ or package.json has uncommitted changes). Package the extension from a checkout of $TAG: 'bash scripts/package-vsix.sh'."
bash scripts/package-vsix.sh ||
  fail "The package is published and tagged, but packaging the VS Code extension failed. Fix the cause, then run 'bash scripts/package-vsix.sh'."
same_tree_as_release ||
  fail "The tree changed while the VS Code extension was packaged: vscode-epsil/epsil.vsix may not contain the published engine. Package it again from a checkout of $TAG."
echo ""
echo "✓ Released $VERSION. To push the commit and the tag:"
echo "    git push && git push origin $TAG"
