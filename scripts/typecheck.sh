#!/bin/bash
set -e

# TypeScript type checking
# Runs on the native (Go) compiler (@typescript/native, npm:typescript@7),
# referenced by its explicit path because it and the TS 6 API package
# (@typescript/typescript6, aliased as `typescript`) both ship a `tsc` bin.
# A git WORKTREE has no node_modules of its own, so when the local path is
# absent the binary is resolved through the main checkout, which every
# worktree shares via the repository's common git directory.
# A file argument makes tsc ignore tsconfig.json (error TS5112), so the full
# option set is passed on the CLI with --ignoreConfig. "bundler" replaces the
# removed node10 resolution; --types node restores @types/node (no longer
# auto-discovered); strict is on by default.
TSC=./node_modules/@typescript/native/bin/tsc
if [ ! -x "$TSC" ]; then
  MAIN_ROOT="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  MAIN_ROOT="${MAIN_ROOT%/.git}"
  TSC="$MAIN_ROOT/node_modules/@typescript/native/bin/tsc"
  if [ ! -x "$TSC" ]; then
    echo "FAIL: cannot find @typescript/native's tsc (looked in ./node_modules and $MAIN_ROOT/node_modules)."
    exit 1
  fi
fi

node ./scripts/types.mjs

# Type-LEVEL pins in the test suite.
#
# These files assert things about the public TYPES — that a narrowing generic
# is accepted, that a removed option is rejected, that a `@ts-expect-error`
# line still errors. ts-jest does NOT type-check in this repo (a test file
# containing `const n: number = 'a'` passes), so running the suite proves
# nothing about them; measured 2026-08-21, when a shipped migration example
# that did not compile passed its own test. They are checked here instead, so
# a broken type pin fails `npm run typecheck`.
#
# An `@ts-expect-error` in these files is a real assertion under this run: if
# the line it guards stops erroring, tsc reports the unused directive.
echo ""
echo "Checking CLI and type-level assertions..."
"$TSC" --target es2022 --module es2022 --moduleResolution bundler --types node,jest \
  --skipLibCheck --allowImportingTsExtensions true --noEmit --ignoreConfig \
  ./src/cli/epsil.ts \
  ./test/compute-engine/compile-free-function-typing.test.ts \
  ./test/compute-engine/compile-mode-plumbing.test.ts \
  ./test/compute-engine/user-collection-handlers.test.ts \
  ./test/compute-engine/declare-definition-input.test.ts \
  ./test/compute-engine/bigint-count.test.ts \
  ./test/compute-engine/ce-581-runner-list-argument-type.test.ts

echo 'PASS typecheck'
