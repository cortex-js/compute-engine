#!/bin/bash

set -e  # exit immediately on error
set -o nounset   # abort on unbound variable
set -o pipefail  # don't hide errors within pipes
# set -x    # for debuging, trace what is being executed.

cd "$(dirname "$0")/.."

# Read the first argument, set it to "test" if not set
VARIANT="${1-test}"

export TEST="true"
# Forward Jest options while retaining the historical test/<name> shorthand.
JEST_ARGS=()
if [ "$#" -gt 0 ]; then
  case "$1" in
    test|-test|coverage|-coverage|snapshot|-snapshot) shift ;;
    --*) VARIANT=test ;;
    *) shift ;;
  esac
  JEST_ARGS=("$@")
fi


if [ "$VARIANT" = "coverage" ] || [ "$VARIANT" = "-coverage" ]; then
    npx --no-install jest --coverage "${JEST_ARGS[@]}"
    echo 'Running checkpoint bypass canary'
    CE_CHECKPOINT_CANARY=1 npx --no-install jest \
      --reporters summary "${JEST_ARGS[@]}" -- test/compute-engine/checkpoint-differential.test.ts
elif [ "$VARIANT" = "test" ] || [ "$VARIANT" = "-test" ]; then
    # The jest cache stays ON for the full suite: the transform cache is
    # content-keyed (a changed file re-transpiles, an unchanged one does not),
    # and the timing cache is what lets jest schedule the slowest test files
    # first — without it files are ordered by SIZE, and a small-but-slow file
    # scheduled last extends the whole run by its own duration.
    npx --no-install jest --reporters summary "${JEST_ARGS[@]}"
    # The checkpoint journal's bypass canary (CE_CHECKPOINT_CANARY) is a
    # module-load flag, so its assertions are inert in the run above. Re-run
    # the one differential-harness file in a fresh process with the flag set:
    # every state event a checkpoint window sees must be backed by a journal
    # hook of the matching kind, or a write has bypassed the journal.
    echo 'Running checkpoint bypass canary'
    CE_CHECKPOINT_CANARY=1 npx --no-install jest \
      --reporters summary "${JEST_ARGS[@]}" -- test/compute-engine/checkpoint-differential.test.ts
elif [ "$VARIANT" = "snapshot" ]  || [ "$VARIANT" = "-snapshot" ]; then
    npx --no-install jest  --updateSnapshot "${JEST_ARGS[@]}"
else
    # Skip Declaration Type test for specific test files - run it directly
    echo "${VARIANT}".test.ts
    # Jest 30 changed positional path-pattern matching: a leading `./` no longer
    # matches, so pass the path without it (e.g. `test/foo`, not `./test/foo`).
    npx --no-install jest test/"${VARIANT}" --verbose false "${JEST_ARGS[@]}"
fi
