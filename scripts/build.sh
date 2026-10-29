#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export BUILD="${1-production}"
if [ "$#" -gt 1 ] || [[ ! "$BUILD" =~ ^(production|development)$ ]]; then
  echo 'Usage: npm run build -- [production|development]' >&2
  exit 1
fi
node scripts/types.mjs
# Preserve declarations and their incremental metadata between builds.
rm -rf dist/esm dist/esm-min
node scripts/build.mjs
node scripts/stamp-build.mjs
if [ "$BUILD" = production ]; then
  for smoke in nodenext epsil-runtime js-runtime epsil-cli; do
    node "test/consumer/$smoke-smoke.mjs"
  done
  node test/consumer/require-smoke.cjs
fi
echo "PASS build ($BUILD)"
