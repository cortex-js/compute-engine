#!/bin/bash

set -e  # exit immediately on error
set -o nounset   # abort on unbound variable
set -o pipefail  # don't hide errors within pipes
# set -x    # for debuging, trace what is being executed.

cd "$(dirname "$0")/.."

# Read the first argument, set it to "test" if not set
VARIANT="${1-test}"

export TEST="true"

run_declaration_type_tests() {
    echo -e "\n🧐 Running Declaration Type test suite..."
    npx tsc --noEmit --baseUrl ./dist/types ./test/public-ts-declarations/main.ts
    echo -e "\033[2K\033[80D\033[32m✔ \033[0m Declaration Type test suite complete"
}

if [ "$VARIANT" = "coverage" ] || [ "$VARIANT" = "-coverage" ]; then
    run_declaration_type_tests
    npx jest --config ./config/jest.config.cjs --coverage --no-cache
elif [ "$VARIANT" = "test" ] || [ "$VARIANT" = "-test" ]; then
    run_declaration_type_tests
    npx jest --config ./config/jest.config.cjs --no-cache --reporters summary
elif [ "$VARIANT" = "snapshot" ]  || [ "$VARIANT" = "-snapshot" ]; then
    run_declaration_type_tests
    npx jest --config ./config/jest.config.cjs  --updateSnapshot
else
    # Skip Declaration Type test for specific test files - run it directly
    echo "${1}".test.ts
    npx jest --config ./config/jest.config.cjs ./test/"${1}" --verbose false
fi
