# Bounded structured IR experiment

Instrument: `structured-ir.mjs`. Results: `structured-ir-results.json`.
Pinned baseline: CE `9c126c5d8`; actual full revision and Node version are stored
in the JSON. No production source changed.

## Result

Five fixtures passed with local CSE both disabled and enabled, for 36 input
cases compared against the existing JavaScript compiler and independent
mathematical oracles. The effect fixture additionally checked exact branch
call traces against legacy emitted code. Four deliberately corrupted IRs were tested in both CSE modes (eight
negative controls) and rejected by the verifier: undefined use, operand type mismatch, branch-region
escape, and loop-carried type mismatch. These are correctness checks, not
performance measurements.

| Fixture | IR instruction count without/with CSE | Generated body bytes without/with CSE |
| --- | --- | --- |
| Repeated arithmetic | 9 / 6 | 212 / 158 |
| Lazy conditional | 5 / 5 | 157 / 157 |
| Accumulator loop, explicit positive step | 5 / 5 | 254 / 254 |
| Lazy effect trace | 5 / 5 | 179 / 179 |
| Default descending range | 5 / 5 | 270 / 270 |

The instruction count includes structured control operations and nested body
instructions, not region parameters. The JSON also contains legacy source,
but its source-byte count is not an apples-to-apples size comparison: entry
wrappers, declaration formatting and runtime infrastructure differ.

## What the prototype establishes

A small direct-style representation can lower a fixed MathJSON vocabulary to
typed value IDs, explicit lazy branch regions, and loop-carried values. Its
verifier checks lexical visibility and value/result types before JavaScript
emission. Region-local CSE eliminates three repeated pure operations in the
first case. Branches and loops have separate regions; effectful calls clear
the local CSE cache. No CPS conversion or flat control-flow graph was needed
for these fixtures.

Range normalization matters before loop lowering. `Range(1, 0)` descends
through 1 and 0, so it is not an empty loop. The main accumulator fixture uses
`Range(1, n, 1)` for a genuine zero-iteration case at n=0. A separate fixture
checks automatic descending direction at n=0 and n=-2. This is an existing
language rule, not a discovered compiler defect.

## Limits

This is an intentionally closed experiment, not a new compiler or a profile
implementation. It lowers the provided MathJSON directly and does not consume
CE fragment annotations, resolve arbitrary bindings, validate user functions,
or share CE preparation. Its local names and unit-step finite integer loops
are restricted by construction. It has no complex/absence semantics,
iteration budgets, general exits or mutation, worker support, runtime packaging,
or host input validation. The fixture declarations guarantee finite numeric
inputs; n is a small integer. It does not establish sound general CSE in the
presence of mutable memory or arbitrary host effects.

The comparison uses `constantFold:false` and `cse:false` for legacy CE;
prototype CSE is tested in both states. Legacy CE remains free to make its
normal canonical/preparation transformations. Numerical equality allows a
1e-12 relative tolerance and does not distinguish signed zero. No timing,
allocation or memory claims are made. No test suite, build, lint or typecheck
was run because the instrument is isolated research JavaScript, not shipped
source. Independent reviews and their resolution are recorded in evidence/review-status.json.

## Replay

Set CE_ROOT to a checkout of the recorded revision with dependencies available.
Set OUTPUT_DIR to an isolated destination. The instrument reports the actual
checkout revision and imports that checkout's source. It does not verify that
the checkout is clean; use a detached clean worktree for reproducibility.

```sh
CE_ROOT=/path/to/pinned-ce OUTPUT_DIR=/tmp/ir-results \
  node --import /path/to/pinned-ce/node_modules/tsx/dist/loader.mjs \
  /path/to/structured-ir.mjs
```

Executed command (exit 0):

```sh
CE_ROOT=/tmp/wt-js-profile-audit OUTPUT_DIR=/tmp/js-profile-audit-results \
  node --import /tmp/wt-js-profile-audit/node_modules/tsx/dist/loader.mjs \
  /tmp/js-profile-audit-results/structured-ir.mjs
```

The correctness probe ran with parent permission while its box lock
`codex-js-profile-audit` was held. No benchmark timing was collected.

The November 9 review rerun used the same pinned source at `/tmp/wt-js-profile-prior`,
with the revised instrument retained here. Its exact log is
`evidence/structured-ir-review.log`; the earlier command above is historical.
