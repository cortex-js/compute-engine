#! bash

# This script is run by npm as the `prepublishOnly` hook, i.e. before the
# package is prepared/packed for `npm publish` (and ONLY for publish, never
# for a plain `npm install`).
#
# Why: `npm publish` runs the full production build (via `prepare`) and only
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

# A session does not run the full test suite before each commit, so a
# release must make sure that the full suite passed on the code being
# published. `suite-status.mjs release-check` refuses uncommitted source
# changes (exit 1), and accepts HEAD when the last passing full run was at
# HEAD, or when every change since that run is markdown outside src/ and
# test/ or a version number (what `npm version` writes). When the tree is
# clean but no passing run covers HEAD (exit 3), this script runs the full
# suite now on that commit (`scripts/ci-nightly.sh run --commit`, in a
# worktree, under the box lock; about 7 minutes once it has the lock) and
# checks again. So a publish never depends on whether the nightly job ran or
# anyone read its result.
#
# The build (`prepare`) runs after this hook and reads the files on disk,
# and other sessions apply their changes to this tree. So the same check
# runs again as the `postpack` hook (`--after-pack`), after the build and
# before the upload, and the HEAD must not have moved.
#
# The check is skipped in two cases:
# - In GitHub Actions (`GITHUB_ACTIONS=true`): the publish workflow
#   (.github/workflows/publish.yml) runs `npm test`, the full suite, on the
#   same checkout just before `npm publish`, and the helper script below
#   does not exist there.
# - `CE_FULL_SUITE_PASSED=1`: the person publishing ran `npm test` on this
#   tree and it passed. Use it on a machine without the helper script.
# Rules: ~/.claude/SHARED-BOX-PROTOCOL.md, section 5.7 (user decision
# 2026-10-28).
if [ "${GITHUB_ACTIONS:-}" = "true" ] || [ "${CE_FULL_SUITE_PASSED:-}" = "1" ]; then
  echo "✓ Full test suite: checked by the caller (GitHub Actions or CE_FULL_SUITE_PASSED=1)"
  exit 0
fi
SUITE_STATUS="$HOME/.claude/scripts/suite-status.mjs"
if [ ! -f "$SUITE_STATUS" ]; then
  echo ""
  echo "✗ $SUITE_STATUS is missing, so this script cannot tell whether the"
  echo "  full test suite passed at HEAD. Run 'npm test'; if it passes, run"
  echo "  'CE_FULL_SUITE_PASSED=1 npm publish'."
  echo ""
  exit 1
fi
HEAD_FILE="$(git rev-parse --git-dir)/ce-publish-head"

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

if [ "${1:-}" = "--after-pack" ]; then
  # `postpack` also runs for a plain `npm pack`, which publishes nothing.
  [ "${npm_command:-}" = "publish" ] || exit 0
  node "$SUITE_STATUS" release-check --repo . || refuse_status $?
  if [ "$(git rev-parse HEAD)" != "$(cat "$HEAD_FILE" 2>/dev/null)" ]; then
    echo ""
    echo "✗ HEAD moved during the build: the package may not be the code that was checked."
    echo "  Re-run npm publish."
    echo ""
    exit 1
  fi
  echo "✓ Full test suite: still passed at HEAD after the build"
  exit 0
fi

node "$SUITE_STATUS" release-check --repo .
STATUS=$?
if [ "$STATUS" -eq 3 ]; then
  echo ""
  echo "→ Running the full test suite at HEAD now. It waits for the box lock, then"
  echo "  takes about 7 minutes. (A one-time password given with --otp expires"
  echo "  meanwhile: in that case run 'bash scripts/ci-nightly.sh run' first.)"
  echo ""
  bash scripts/ci-nightly.sh run --commit "$(git rev-parse HEAD)"
  node "$SUITE_STATUS" release-check --repo .
  STATUS=$?
  if [ "$STATUS" -eq 3 ]; then
    echo ""
    echo "✗ The full test suite did not pass at HEAD, or did not complete (no box"
    echo "  lock, or interrupted). Its log is named above. Fix the cause, commit,"
    echo "  and re-run npm publish."
    echo ""
    exit 1
  fi
fi
[ "$STATUS" -eq 0 ] || refuse_status "$STATUS"
git rev-parse HEAD > "$HEAD_FILE"
