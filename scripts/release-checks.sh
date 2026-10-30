#! bash

# Usage: bash scripts/release-checks.sh
#
# Runs the checks of `npm run ci` that the full test suite does not run
# (scripts/ci-nightly.sh runs the typecheck, the declaration tests, the
# Python tests and the Jest tests): lint, the documentation references, the
# circular-import check, the tests of the scripts, and the corpus pipeline.
# A release runs them before it changes anything: scripts/release.sh in its
# first step, and scripts/prepublish-check.sh before the build of a plain
# `npm publish`.
#
# Each check prints one line, and a failing check prints its log
# (scripts/run-quietly.sh). The script stops at the first failure.
#
# The checks run without the box lock of the shared machine, as do the
# other steps of a release (the builds, `npm ci`): no other session is
# active during a release (user decision 2026-10-30).

cd "$(dirname "$0")/.."

QUIET="bash scripts/run-quietly.sh"
$QUIET "Lint" npm run lint &&
  $QUIET "Documentation references" npm run check:docs &&
  $QUIET "Circular imports" npm run check:deps &&
  $QUIET "Script tests" npm run test:tools &&
  $QUIET "Corpus pipeline" npm run ci:corpus-pipeline
