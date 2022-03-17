#!/bin/bash

set -e  # exit immediately on error
set -o nounset   # abort on unbound variable
set -o pipefail  # don't hide errors within pipes
# set -x    # for debuging, trace what is being executed.

cd "$(dirname "$0")/.."

# Read the first argument, set it to "coverage" if not set
VARIANT="${1-coverage}"

export TEST="true"

if [ "$VARIANT" = "coverage" ] || [ "$VARIANT" = "-coverage" ]; then
    npx jest --config ./config/jest.config.js --coverage --no-cache
elif [ "$VARIANT" = "snapshot" ]  || [ "$VARIANT" = "-snapshot" ]; then
    npx jest --config ./config/jest.config.js  --updateSnapshot
else
    echo "${1}".test.ts
    npx jest --config ./config/jest.config.js ./test/"${1}" --verbose false
fi