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
    # Runs on the native (Go) compiler (@typescript/native, npm:typescript@7),
    # referenced by explicit path (both it and the TS 6 API package ship a `tsc`
    # bin). --ignoreConfig avoids TS5112 (tsconfig present + file on CLI). TS 7
    # removed --baseUrl, so main.ts imports dist/types by relative path instead;
    # the flag set matches the .d.ts build so the import resolves under bundler
    # resolution.
    ./node_modules/@typescript/native/bin/tsc --noEmit --ignoreConfig \
      --target es2022 --module es2022 --moduleResolution bundler --types node \
      --skipLibCheck --allowImportingTsExtensions true \
      ./test/public-ts-declarations/main.ts
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
    # Jest 30 changed positional path-pattern matching: a leading `./` no longer
    # matches, so pass the path without it (e.g. `test/foo`, not `./test/foo`).
    npx jest --config ./config/jest.config.cjs test/"${1}" --verbose false
fi
