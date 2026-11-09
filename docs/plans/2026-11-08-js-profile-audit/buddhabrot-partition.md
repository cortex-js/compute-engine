# Buddhabrot partition correctness experiment

Executed 2026-11-08 in `/tmp/wt-tycho-js-profile-audit`, Node v26.13.0, installed CE 0.184.0. Root's box lock `codex-js-profile-audit` held. No workers, concurrency, speedup, cancellation, or memory allocation measured.

## Instrument and command

Source `scripts/repros/js-profile-buddhabrot-partition.mts` in the isolated Tycho worktree; preserved copy `buddhabrot-partition.mts` beside this report. Copy that instrument to the same relative path in a Tycho checkout for replay, since its imports are relative. Results: `buddhabrot-partition.json`; output: `buddhabrot-partition.log`.

Command (from Tycho worktree):

```sh
node ~/.claude/scripts/box-lock.mjs check codex-js-profile-audit && node --import tsx scripts/repros/js-profile-buddhabrot-partition.mts > /tmp/js-profile-audit-results/buddhabrot-partition.log 2>&1
```

Final exit: **0**. Initial attempt exit 1 exposed an instrument assumption about zero samples, explained below; original Epsil and product sources were unchanged.

## Actual compilation, not an extracted algorithm substitute

The instrument loads the actual Buddhabrot showcase prelude, removes only `const H_1 = step(H_0, 1200000)` to avoid the full picture computation, and runs the remaining prelude through Tycho's runner. Both setup value statements (`N`, `H_0`) report compiled route. It then declares `histogramInput: list<integer>` and `sampleCount: integer`, compiles the bound `step(histogramInput, sampleCount)` through `resolveCECompile`, and asserts successful compilation and the 90,001-entry output shape. Iteration budget is 100 million.

Independent oracle: exact JavaScript `stepReference` function copied from Tycho's existing `prelude-lanes.test.ts`. Its `for(k=1;k<=n;k++)` matches the Epsil step for positive counts; for zero jobs the experiment's scheduler skips calling either algorithm and returns the input unchanged. No claim that raw Epsil `step(H,0)` is identity.

Source prelude SHA-256: `122c4b10d0a1eec9fe01e312d59db81e88d37c3f934ad249a77565b3c721c90a`.
Generated code SHA-256: `8fdc449f22c485b56786e85c74ab7f90a77a1110969683f487931e1f831acb17`.

## Partition algorithm and results

Initial histogram has counts 7, 11 and 5 in three distinct bins (sum 23), cursor 137. Partition offsets are `floor(samples*p/partitions)`; each nonempty partition starts with zero count planes and cursor equal to 137 plus its offset. Results merge into the original histogram, excluding each private cursor. Final cursor is set to 137 plus total samples once. The instrument simulates this sequentially, using independent arrays.

Every case compares all 90,001 entries against both the compiled serial result and the independent reference. Reverse merge order is also identical; retrying every nonempty range reproduces its private result (empty identities are separate). One sample with four partitions exercises empty jobs.

| Samples | Partitions | Final sum of histogram bins | Correct cursor | Incorrect sum of private cursors | Exact checks |
| --- | --- | --- | --- | --- | --- |
| 0 | 2 | 23 | 137 | 274 | pass |
| 0 | 4 | 23 | 137 | 548 | pass |
| 1 | 2 | 41 | 138 | 275 | pass |
| 1 | 4 | 41 | 138 | 549 | pass |
| 101 | 2 | 1781 | 238 | 425 | pass |
| 101 | 4 | 1781 | 238 | 799 | pass |
| 1000 | 2 | 18405 | 1137 | 1774 | pass |
| 1000 | 4 | 18405 | 1137 | 3048 | pass |

The naive cursor-sum negative control is detected in all eight cases. Nonzero initial bins ensure the merge preserves starting state rather than merely comparing zero-seeded runs. Results support partition invariance for these exact workloads; they do not prove every numeric reduction can be reordered.

## Zero-sized chunks

The first run incorrectly called raw `step(H,0)` as an empty interval. Epsil `1..0` is a descending inclusive range `[1,0]`, documented in CE `docs/RANDOMNESS-MODEL.md:718`; the copied JS oracle's conventional ascending loop does no work. Raw compiled `step` with zero bins and cursor 137 produced **24 histogram increments**, retaining cursor 137. This is expected language semantics, not a compiler defect.

The corrected scheduler explicitly skips all zero-count jobs; raw behavior remains recorded in JSON. Future partition lowering must represent empty iteration spaces explicitly, or avoid invoking this application function with zero count. It cannot infer emptiness from a descending implicit-step range.

## Memory and cancellation implications

Dense numeric payload of each returned list is 90,001 × 8 = 720,008 bytes under an 8-byte-number assumption: two private outputs 1,440,016 bytes; four 2,880,032 bytes. This is a payload estimate, not measured JS heap use. Inputs, reducer output, transport copies and runtime structures add to it; a scheduler that does not allocate empty jobs needs less storage than this prototype.

Retry identity is confirmed, but committing a range twice still double-counts. A real coordinator needs stable range/job identities, duplicate suppression, disjoint complete coverage, and one atomic final histogram/cursor publication. Cancellation should discard uncommitted partials, or retain them only under an explicit resumable job contract. This experiment does not establish child-worker termination, responsiveness, or time-to-cancel; those remain separate runtime tests before enabling internal parallelism in the prelude worker.

No repository production changes, no defect issues, no timing claims.
