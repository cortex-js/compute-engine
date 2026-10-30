#! bash

# Usage: bash scripts/run-quietly.sh <label> <command> [<argument>...]
#
# Runs the command with its output (stdout and stderr) written to a log
# file, and prints one progress line: "<label> … done (12s)". When the
# command fails, it prints the last lines of the log and the log path, and
# exits with the command's exit code.
#
# The publish hooks (`prepack`, `postpublish`) use it so that a successful
# `npm publish` prints only a few lines, while a failure still shows its
# details.
#
# Set CE_VERBOSE=1 to run the command with its output shown, as before.

LABEL="$1"
shift

if [ "${CE_VERBOSE:-}" = "1" ]; then
  "$@"
  exit $?
fi

LOG_DIR="${TMPDIR:-/tmp}"
LOG_DIR="${LOG_DIR%/}/compute-engine-publish"
mkdir -p "$LOG_DIR"
# The label becomes the file name: keep letters, digits and dashes.
SLUG=$(printf '%s' "$LABEL" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//; s/-$//')
LOG="$LOG_DIR/$SLUG.log"

# The number of log lines shown when the command fails. The full log stays
# at $LOG.
TAIL_LINES=150

START=$SECONDS
printf '%s … ' "$LABEL"
"$@" > "$LOG" 2>&1
STATUS=$?
ELAPSED=$((SECONDS - START))

if [ "$STATUS" -eq 0 ]; then
  echo "done (${ELAPSED}s)"
  exit 0
fi

echo "FAILED (exit $STATUS, ${ELAPSED}s)"
echo ""
LINES=$(wc -l < "$LOG" | tr -d ' ')
if [ "$LINES" -gt "$TAIL_LINES" ]; then
  echo "── last $TAIL_LINES of $LINES lines of $LOG ──"
  tail -n "$TAIL_LINES" "$LOG"
else
  echo "── $LOG ──"
  cat "$LOG"
fi
echo "──"
echo ""
exit "$STATUS"
