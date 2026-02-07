#!/bin/bash
set -e

# TypeScript type checking
echo "Running TypeScript type check..."
tsc --target es2022 -d --moduleResolution node --allowImportingTsExtensions true --emitDeclarationOnly --outDir /tmp/typecheck ./src/compute-engine.ts

# Circular dependency check
MAX_CYCLES=43
echo ""
echo "Checking circular dependencies (budget: $MAX_CYCLES)..."

CYCLE_OUTPUT=$(npx madge --circular --extensions ts src/compute-engine 2>&1) || true
CYCLE_COUNT=$(echo "$CYCLE_OUTPUT" | grep -oE 'Found [0-9]+ circular' | grep -oE '[0-9]+')

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
echo "All checks passed."
