# The fact-withholding experiment harness

The measurement instrument behind §5.7 of
`docs/plans/2026-08-22-type-handlers-on-types.md` ("What each fact buys —
measured by withholding it"), checked in so the experiment is re-runnable —
it is the acceptance test for any change that moves value facts into the
type channel (the 2026-08-23 literal handler-visible types were accepted
with it).

## What it measures

At the one call site that hands operands to a `type` handler
(`boxed-function.ts`, `def.type(expr.ops, …)`), every operand is wrapped in
a proxy that withholds ONE family of value facts (selected by the
`CE_WITHHOLD` environment variable: `sgn`, `literal`, `closed`, `finite`).
Type-channel reads — `.type`, `._literalType` — are forwarded, with the
receiver set to the target so private-field getters still work. Running the
full suite once per family, against a baseline run of the same tree, then
splitting each new failure into a **type pin** (an assertion comparing
`.type` to a string — records the status quo, says nothing about
consequences) and a **behavior change** (everything else) measures what the
withheld facts actually buy.

## How to run it

1. Make a worktree of the tree under test (never patch the shared tree):
   `git worktree add <dir> <ref>`, symlink `node_modules` into it.
2. Apply the shim: `python3 scripts/withhold-experiment/withhold-patch.py
   <worktree>/src/compute-engine/boxed-expression/boxed-function.ts`.
   The patch asserts its anchor (the `def.type(expr.ops, …)` call) is
   unique; if the call site moved, update the anchor strings in the script.
3. Under the box lock, run the baseline and each family
   (`~5 min per full suite`):

   ```sh
   cd <worktree>
   npx jest --config ./config/jest.config.cjs --json --outputFile=$OUT/rerun-baseline.json
   CE_WITHHOLD=sgn npx jest --config ./config/jest.config.cjs --json --outputFile=$OUT/rerun-withhold-sgn.json
   CE_WITHHOLD=literal npx jest --config ./config/jest.config.cjs --json --outputFile=$OUT/rerun-withhold-literal.json
   ```

4. Split pins from behavior: `python3 scripts/withhold-experiment/compare.py`
   (run it from the directory holding the JSON files, or edit `S` at the
   top; `-v` prints each behavior change's failure text).

## Known artifacts (not findings)

- `pipe-type-read-purity` fails under ANY proxy run: `Pipe`'s type memo is
  keyed on operand identity, fresh proxies miss it, and the re-derivation
  advances the cache axis the test pins at zero.
- Under `CE_WITHHOLD=literal` the proxy masks `_kind`, so `isNumber(op)` is
  `false` for a wrapped literal; handlers prove literal-ness through the
  forwarded `_literalType` instead (see `poleReciprocalType`).

## Accepted residue (as of 2026-08-23)

With literal handler-visible types in place, the `sgn` and `literal` runs
show zero behavior changes except the pipe artifact above and the
`power-negative-base-branch` rows whose exact huge-denominator rational
exponent (`10000003/10000001`) no type can carry — the loss ruling O4
accepts (rational literal types are not wanted).
