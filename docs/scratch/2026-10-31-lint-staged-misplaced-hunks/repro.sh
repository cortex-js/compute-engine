#!/bin/zsh
# Minimal reproduction: lint-staged restores an unstaged hunk at the wrong line
# of a partly staged file, with no error.
#
# Mechanism. Before the tasks, lint-staged writes the unstaged changes of each
# partly staged file as a patch with no context lines (`git diff --unified=0`).
# After the tasks (here `prettier --write`), it applies that patch again with
# `git apply --recount --unidiff-zero`. A hunk that only inserts lines has no
# old line to match, so git places it by its line number alone. When Prettier
# changed the number of lines above that point (here it joins a 4-line import
# into 1 line), the insertion lands 3 lines too low, inside other code.
#
# The script works in a new temporary repository, so it changes nothing in
# the repository that calls it. It uses the lint-staged and Prettier that are
# installed in the repository given as $1 (default: the current directory).
#
# Usage: zsh repro.sh [/path/to/repo-with-node_modules]
# Exit 0: the bug reproduced. Exit 1: the file came back as intended.
# Exit 2: the commit was refused and the working tree equals the intended file.
# Exit 3: the commit was refused but the working tree changed.
set -eu
REPO=${1:-$PWD}
LS="$REPO/node_modules/lint-staged/bin/lint-staged.js"
PRETTIER="$REPO/node_modules/.bin/prettier"
T=$(mktemp -d)
cd "$T"
git init -q .
git config user.email repro@example.invalid
git config user.name repro
echo '{ "singleQuote": true }' > .prettierrc

# Commit 1: the base file.
cat > f.ts <<'EOF'
import { a } from './x.js';
import { c, d } from './y.js';

export function g(x: number): number {
  if (x === 0) return 0;
  return x + 1;
}
EOF
git add f.ts .prettierrc
git commit -q -m base

# Staged change: a new import name `b`, written over 4 lines that Prettier
# joins into one line.
cat > f.ts <<'EOF'
import {
  a,
  b,
} from './x.js';
import { c, d } from './y.js';

export function g(x: number): number {
  if (x === 0) return 0;
  return x + 1;
}
EOF
git add f.ts

# Unstaged changes on top: two pure insertions.
cat > f.ts <<'EOF'
import {
  a,
  b,
  e,
} from './x.js';
import { c, d } from './y.js';

export function g(
  ce: number,
  x: number): number {
  if (x === 0) return 0;
  return x + 1;
}
EOF
cp f.ts intended.ts

cat > lsrc.json <<EOF
{ "*.ts": "$PRETTIER --write" }
EOF
# PRE_CHECK, when set, is a command that runs first, as a hook step would.
# LS_FLAGS adds options to lint-staged, for example --fail-on-changes.
if [ -n "${PRE_CHECK:-}" ]; then
  if ! eval "$PRE_CHECK"; then
    echo 'RESULT: the pre-check refused the commit; the working tree is unchanged'
    diff -q intended.ts f.ts && exit 2
    exit 3
  fi
fi
if ! node "$LS" --config lsrc.json --quiet ${=LS_FLAGS:-}; then
  echo 'RESULT: lint-staged failed the commit'
  diff -u intended.ts f.ts && echo 'working tree equals the intended file'
  exit 2
fi
git commit -q -m 'commit after lint-staged'

echo '--- committed f.ts'
git show HEAD:f.ts
echo '--- working tree f.ts minus intended (should differ only by Prettier format, never by placement)'
diff -u intended.ts f.ts || true
# The intended unstaged lines are "  e," after "  b," and "  ce: number," after "g(".
if grep -A1 -n '^  b,$' f.ts | grep -q '  e,' && grep -A1 'function g($' f.ts | grep -q 'ce: number'; then
  echo 'RESULT: unstaged hunks restored at the right lines'
  exit 1
fi
echo 'RESULT: BUG REPRODUCED, unstaged hunks restored at the wrong lines'
echo "repo kept at $T"
exit 0
