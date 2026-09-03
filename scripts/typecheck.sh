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

echo "Running TypeScript type check..."
"$TSC" --target es2022 --module es2022 --moduleResolution bundler --types node \
  --skipLibCheck -d --allowImportingTsExtensions true --emitDeclarationOnly \
  --ignoreConfig --outDir /tmp/typecheck ./src/compute-engine.ts

echo "Checking Epsil CLI..."
"$TSC" --target es2022 --module es2022 --moduleResolution bundler --types node \
  --skipLibCheck --allowImportingTsExtensions true --noEmit \
  --ignoreConfig ./src/cli/epsil.ts

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
echo "Checking type-level pins in the test suite..."
"$TSC" --target es2022 --module es2022 --moduleResolution bundler --types node,jest \
  --skipLibCheck --allowImportingTsExtensions true --noEmit --ignoreConfig \
  ./test/compute-engine/compile-free-function-typing.test.ts \
  ./test/compute-engine/compile-mode-plumbing.test.ts \
  ./test/compute-engine/user-collection-handlers.test.ts

# Circular dependency check
MAX_CYCLES=0
echo ""
echo "Checking circular dependencies (budget: $MAX_CYCLES)..."

CYCLE_OUTPUT=$(npx madge --circular --extensions ts src/compute-engine 2>&1) || true
CYCLE_COUNT=$(
  echo "$CYCLE_OUTPUT" | grep -oE 'Found [0-9]+ circular' | grep -oE '[0-9]+' || true
)

if [ -z "$CYCLE_COUNT" ]; then
  echo "No circular dependencies found."
  CYCLE_COUNT=0
fi

echo "Found $CYCLE_COUNT circular dependencies (budget: $MAX_CYCLES)"

if [ "$CYCLE_COUNT" -gt "$MAX_CYCLES" ]; then
  echo ""
  echo "FAIL: Circular dependency count ($CYCLE_COUNT) exceeds budget ($MAX_CYCLES)."
  echo "A new cycle was likely introduced. Run 'npx madge --circular --extensions ts src/compute-engine' to see details."
  exit 1
fi

if [ "$CYCLE_COUNT" -lt "$MAX_CYCLES" ]; then
  echo ""
  echo "NOTE: Cycle count ($CYCLE_COUNT) is below budget ($MAX_CYCLES)."
  echo "Please lower MAX_CYCLES in scripts/typecheck.sh to $CYCLE_COUNT to lock in progress."
fi

echo ""
echo "Checking public type surfaces for explicit 'any'..."

# Spelled in POSIX extended syntax only — `[[:space:]]` for a blank and an
# explicit identifier boundary instead of `\s` and `\b`, which are GNU and
# ripgrep extensions that a strict `grep -E` does not know. `rg` reads the
# same pattern.
ANY_PATTERN='as any([^[:alnum:]_]|$)|:[[:space:]]*any([^[:alnum:]_]|$)|<any>|any\[\]'
# Comment-ONLY lines are excluded: the check targets TypeScript type
# surfaces, and doc comments legitimately spell the ENGINE's type-language
# literals (`collection<any>`, `list<any>`), which are unrelated to
# TypeScript `any`. A line is dropped (content = after the rg `file:line:`
# prefix) only when it is comment to its end:
#   - `//…`                        line comment
#   - `* …` or a lone `*`          doc-comment interior prose — `*` must be
#                                  followed by whitespace/EOL, so a generator
#                                  method (`*items(x: any)`) and a
#                                  close-then-code line (`*/ code`) are KEPT
#   - `/*…` never closing, or      whole-line block comment — `/* c */ code`
#     closing exactly at EOL       does NOT match and is KEPT
# Known gap (fails LOUD, not silent): a block-comment interior line written
# without the conventional leading `*` is not dropped and still trips the
# gate; prettier formats doc comments with the `*` prefix, so that spelling
# does not occur in practice.
# `rg` is not installed on every machine that runs this script. When it is
# missing, `rg … || true` used to swallow the "command not found" failure,
# so the check printed its success line without having searched anything.
# The search falls back to `grep -rE` (the `--include` globs cover the same
# files as the `rg` globs: `types*.ts` also matches `types-*.ts`), and both
# spellings of the pattern are plain ERE, so the two tools agree.
if command -v rg >/dev/null 2>&1; then
  ANY_MATCHES=$(rg -n --glob 'types*.ts' --glob 'types-*.ts' --glob 'global-types.ts' "$ANY_PATTERN" src/compute-engine || true)
else
  ANY_MATCHES=$(grep -rnE --include='types*.ts' --include='global-types.ts' "$ANY_PATTERN" src/compute-engine || true)
fi
ANY_OUTPUT=$(
  printf '%s\n' "$ANY_MATCHES" |
    grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*([[:space:]]|$)|/\*([^*]|\*[^/])*(\*/)?[[:space:]]*$)' || true
)

if [ -n "$ANY_OUTPUT" ]; then
  echo "$ANY_OUTPUT"
  echo ""
  echo "FAIL: Explicit 'any' found in public type surfaces."
  echo "Use 'unknown' plus narrowing, or a constrained generic."
  exit 1
fi

echo "No explicit 'any' found in public type surfaces."

echo ""
echo "All checks passed."
