#! bash

# This script is run by npm as the `prepublishOnly` hook, i.e. before the
# package is prepared/packed for `npm publish` (and ONLY for publish, never
# for a plain `npm install`).
#
# Why: `npm publish` runs the full production build (via `prepack`) and only
# then talks to the registry. When the npm auth token has expired, that
# multi-minute build is wasted and the failure surfaces at the very end,
# sometimes without a helpful message. Checking auth first fails fast.
#
# `npm whoami` performs an authenticated request against the configured
# registry, so it detects a missing OR expired token (exit code ENEEDAUTH).
# We cannot run `npm login` here on the user's behalf: the outer `npm publish`
# process has already loaded its config (and token) at startup, so a login
# performed inside this hook would not be picked up by it. Instead we stop
# with instructions to log in and re-run.

cd "$(dirname "$0")/.."

# Honor a scoped/publishConfig registry if one is set, else the default.
REGISTRY=$(npm config get registry)

if ! NPM_USER=$(npm whoami --registry "$REGISTRY" 2>/dev/null); then
  echo ""
  echo "✗ Not authenticated with the npm registry ($REGISTRY)."
  echo "  Your npm token is missing or has expired."
  echo ""
  echo "  Run:  npm login"
  echo "  then re-run:  npm publish"
  echo ""
  exit 1
fi

echo "✓ Authenticated with $REGISTRY as $NPM_USER"

# scripts/release.sh sets CE_RELEASE_SHA to the release commit that it made.
# Another session can commit before this hook runs: the package would then
# contain that commit, not the release commit. This check runs before the
# build and again after it, before the upload (an upload cannot be undone),
# also when the full-suite check below is skipped.
if [ -n "${CE_RELEASE_SHA:-}" ] && [ "$(git rev-parse HEAD)" != "$CE_RELEASE_SHA" ]; then
  echo ""
  echo "✗ HEAD is $(git rev-parse --short HEAD), not the release commit ${CE_RELEASE_SHA:0:9}:"
  echo "  another commit was made after the release commit. Nothing was published."
  echo ""
  exit 1
fi

# A session does not run the full test suite before each commit, so a
# release must make sure that the full suite passed on the code being
# published. `suite-status.mjs release-check` refuses uncommitted source
# changes (exit 1), and accepts HEAD when the last passing full run was at
# HEAD, or when every change since that run is markdown outside src/ and
# test/ or a version number (what `npm version` writes).
#
# npm runs this script twice. As `prepublishOnly`, before the build, it does
# only the fast checks (npm login, uncommitted changes) and records HEAD.
# As `postpack` (`--after-pack`), after the build and before the upload, it
# checks again (other sessions apply their changes to this tree, and the
# build reads the files on disk), and when no passing full run covers HEAD
# (exit 3) it runs the full suite on that commit (`scripts/ci-nightly.sh run
# --commit`, in a worktree, under the box lock; about 7 minutes once it has
# the lock). So a failing build is found before the long test run, and a
# publish never depends on whether the nightly job ran or anyone read its
# result.
#
# The check is skipped in two cases:
# - In GitHub Actions (`GITHUB_ACTIONS=true`): the publish workflow
#   (.github/workflows/publish.yml) runs `npm run ci:extended`, the full suite, on the
#   same checkout just before `npm publish`, and the helper script below
#   does not exist there.
# - `CE_FULL_SUITE_PASSED=1`: the person publishing ran `npm run ci:extended` on this
#   tree and it passed. Use it on a machine without the helper script.
# Rules: ~/.claude/SHARED-BOX-PROTOCOL.md, section 5.7 (user decision
# 2026-10-28).
# mark_upload_next: scripts/release.sh sets CE_RELEASE_UPLOAD_MARK to a file
# path. The file is created when the last check before the upload has
# passed, so that release.sh knows whether a failure of `npm publish` came
# before the upload (nothing was published) or after this point (the upload
# may have succeeded).
mark_upload_next() {
  if [ "${1:-}" = "--after-pack" ] && [ -n "${CE_RELEASE_UPLOAD_MARK:-}" ]; then
    touch "$CE_RELEASE_UPLOAD_MARK"
  fi
}

if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CE_FULL_SUITE_PASSED:-}" = "1" ]; then
  echo "✓ Full test suite: checked by the caller (GitHub Actions or CE_FULL_SUITE_PASSED=1)"
  mark_upload_next "${1:-}"
  exit 0
fi
SUITE_STATUS="$HOME/.claude/scripts/suite-status.mjs"
if [ ! -f "$SUITE_STATUS" ]; then
  echo ""
  echo "✗ $SUITE_STATUS is missing, so this script cannot tell whether the"
  echo "  full test suite passed at HEAD. Run 'npm run ci:extended'; if it passes, run"
  echo "  'CE_FULL_SUITE_PASSED=1 npm publish'."
  echo ""
  exit 1
fi
HEAD_FILE="$(git rev-parse --git-dir)/ce-publish-head"

# release_check: run `suite-status.mjs release-check` and set STATUS to its
# exit code. Exit 3 means that no passing full run covers HEAD. That is
# expected before a release, and this script handles it by running the
# suite, so its message is hidden, except when the cause is a full run that
# failed: that message names the failed jobs and the log.
release_check() {
  local out
  out=$(node "$SUITE_STATUS" release-check --repo . 2>&1)
  STATUS=$?
  if [ "$STATUS" -ne 0 ] && { [ "$STATUS" -ne 3 ] || printf '%s' "$out" | grep -q 'latest full run at .* failed'; }; then
    echo "$out"
  fi
}

# refuse_status <exit code of release-check>: the message for a refusal.
refuse_status() {
  echo ""
  if [ "$1" -eq 1 ]; then
    echo "✗ Commit or remove the uncommitted changes named above, then re-run npm publish."
  else
    echo "✗ The release check failed with exit $1: the state of the full test suite is unknown."
  fi
  echo ""
  exit 1
}

if [ "${1:-}" != "--after-pack" ]; then
  # Before the build: only the fast refusal. The full suite, when it is
  # needed, runs after the build (below), so that a failing build, a failing
  # declaration or documentation step, or a failing consumer smoke test is
  # found in a minute or two and not after the test run.
  release_check
  [ "$STATUS" -eq 0 ] || [ "$STATUS" -eq 3 ] || refuse_status "$STATUS"
  if [ "$STATUS" -eq 3 ]; then
    echo "· Full test suite: no passing run at HEAD yet; it runs after the build."
  fi
  # The checks of `npm run ci` that the full suite does not run (lint,
  # documentation references, circular imports, script tests, corpus).
  # scripts/release.sh runs them before the version change and sets
  # CE_RELEASE_CHECKS_DONE=1.
  if [ "${CE_RELEASE_CHECKS_DONE:-}" != "1" ]; then
    bash scripts/release-checks.sh || {
      echo ""
      echo "✗ A release check failed (above). Nothing was built or published."
      echo ""
      exit 1
    }
  fi
  git rev-parse HEAD > "$HEAD_FILE"
  exit 0
fi

# After the build (`postpack`), before the upload. `postpack` also runs for
# a plain `npm pack`, which publishes nothing.
[ "${npm_command:-}" = "publish" ] || exit 0
if [ "$(git rev-parse HEAD)" != "$(cat "$HEAD_FILE" 2>/dev/null)" ]; then
  echo ""
  echo "✗ HEAD moved during the build: the package may not be the code that was checked."
  echo "  Re-run npm publish."
  echo ""
  exit 1
fi
release_check
if [ "$STATUS" -eq 3 ]; then
  echo "→ Running the full test suite at HEAD. It waits for the box lock, then"
  echo "  takes about 7 minutes. (A one-time password given with --otp expires"
  echo "  meanwhile: in that case run 'bash scripts/ci-nightly.sh run' first.)"
  bash scripts/ci-nightly.sh run --commit "$(git rev-parse HEAD)"
  release_check
  if [ "$STATUS" -eq 3 ]; then
    node "$SUITE_STATUS" release-check --repo .
    echo ""
    echo "✗ The full test suite did not pass at HEAD, or did not complete (no box"
    echo "  lock, or interrupted). Its log is named above. Fix the cause, commit,"
    echo "  and re-run npm publish."
    echo ""
    exit 1
  fi
fi
[ "$STATUS" -eq 0 ] || refuse_status "$STATUS"
# The tree must not have changed while the suite ran either.
if [ "$(git rev-parse HEAD)" != "$(cat "$HEAD_FILE" 2>/dev/null)" ]; then
  echo ""
  echo "✗ HEAD moved while the checks ran: the package may not be the code that was checked."
  echo "  Re-run npm publish."
  echo ""
  exit 1
fi
echo "✓ Full test suite: passed at HEAD; the package is the checked code"
mark_upload_next "${1:-}"
