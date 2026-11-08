#! bash

# Usage: bash scripts/release-format.sh
#
# Formats the source with Prettier (`npm run format`) and commits the files
# that Prettier changed, as one commit "Format the source with Prettier".
# The release checks (scripts/release-checks.sh) run this script first, so
# that a release does not stop because a file is not formatted. No commit
# hook formats the source, so commits between releases can hold unformatted
# code.
#
# Prettier rewrites every file in the directories that `npm run format`
# names (src, vscode-epsil/src, vscode-epsil/test). When one of these
# directories has an uncommitted change or an untracked file, the commit
# would hold work that its author did not commit. In that case the script
# does not format: it runs `npm run format:check` and fails when a file is
# not formatted.
#
# The commit names its files (`git commit -- <files>`). Git then commits
# only these files; changes staged for other files stay staged and are not
# committed.
#
# Prints one line, followed by the list of the files that it committed. On a
# failure, it prints the output of the failed command.

cd "$(dirname "$0")/.."

FORMAT_DIRS=(src vscode-epsil/src vscode-epsil/test)
START=$SECONDS
printf '→ Formatting … '

DIRTY=$(git status --porcelain --untracked-files=all -- "${FORMAT_DIRS[@]}")
if [ -n "$DIRTY" ]; then
  if OUT=$(npm run --silent format:check 2>&1); then
    echo "· checked, not formatted ($((SECONDS - START))s): uncommitted changes in ${FORMAT_DIRS[*]}"
    exit 0
  fi
  echo "failed"
  printf '%s\n' "$OUT"
  echo ""
  echo "  These files have uncommitted changes, so the source was not formatted:"
  printf '%s\n' "$DIRTY"
  echo "  Commit or remove them, then run the release again: it formats and commits."
  exit 1
fi

# With --list-different, `prettier --write` prints the path of each file
# that it changed, one per line, and nothing for the other files.
if ! CHANGED=$(npm run --silent format -- --list-different 2>/dev/null); then
  echo "failed"
  npm run --silent format:check
  exit 1
fi
if [ -z "$CHANGED" ]; then
  echo "done, no file changed"
  exit 0
fi

FILES=()
while IFS= read -r FILE; do
  [ -n "$FILE" ] && FILES+=("$FILE")
done <<< "$CHANGED"

if ! git commit --quiet -m "chore format" -- "${FILES[@]}"; then
  echo "✗ failed"
  echo "  git commit failed. These files are formatted but not committed:"
  printf '  %s\n' "${FILES[@]}"
  exit 1
fi
echo "done, ${#FILES[@]} files formatted and committed"
# printf '  %s\n' "${FILES[@]}"
