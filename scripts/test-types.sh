#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
run_declaration_type_tests() {
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
    echo 'PASS declaration consumers'
}

run_declaration_type_tests
