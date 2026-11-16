# Initialization-contract controls

Pinned before production edits against CE `dbcfdca7e5b5a8852b6554a1ad359dfac4724c1e`
in `/private/tmp/ce-init-contracts-20261116`. The focused test file is
`test/epsil/initialization-contracts.test.ts`; its accepted expectations distinguish
planned static-type changes from existing runtime observations.

Command: `npx jest --watchman=false -w 2 -- test/epsil/initialization-contracts.test.ts`.
Original result: 26 tests, 23 pass, three expected failures, direct exit 1.
See [raw original log](original-controls.log). Tests were added and run before
production modifications; this is not a candidate correctness result.

| Source | Original static type, before/evaluate/N | Accepted static type |
| --- | --- | --- |
| `let xs=[]; xs=[1,2]; xs` | `list<number>` at all three points | `list<unknown>` at all three points |
| `let x; if true {x=1}; x` | `number` at all three points | `unknown` at all three points |
| `let x; for k in [1] {x=1}; x` | `number` at all three points | `unknown` at all three points |

Other controls cover ordinary updates, explicit collection contracts, nested tuple
widening/writes, straight-line initialization, unknown initializers, function
replacement/aliases, constants, duplicate declarations, forward functions, closures,
loop-carried lists, nested shadowing and failed siblings. The implementer is adding
runtime uninitialized-read controls to distinguish the previous declaration error
plus symbolic read from an accepted uninitialized declaration with a checked read.
The existing Match/rest control returns nested unevaluated `Rest` forms; that
observation is not evidence that it returns an empty concrete list.

All performance-harness original/current controls passed separately (38 processes,
19 per arm). Their identities, independent oracles and raw command paths are in
[the measurement plan/report](MEASUREMENTS.md). No candidate parity or performance
claim follows from those baseline controls.

The unchanged consolidated-control witness suites also passed: 4 suites, 66 tests,
exit 0 (`--watchman=false -w 4`): `tycho-item-332-compiled-program-parity`,
`tycho-item-332-untyped-program-compile`, `recursive-list-builder-compile`, and
`block-local-list-rank-join`. These pin the original unannotated/annotated fixtures
before candidate expectation changes. Raw results: [JSON](baseline-witnesses.json)
and [log](baseline-witnesses.log).
