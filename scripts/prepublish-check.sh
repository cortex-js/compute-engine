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
