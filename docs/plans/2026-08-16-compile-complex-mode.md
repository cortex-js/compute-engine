# Compile complex-mode benchmark follow-up

**Date:** 2026-08-16
**Status:** ACTIVE — implementation complete; one quiet-machine measurement
and consumer cost decision remain.

The implemented compilation contract is normative in
`docs/COMPILATION-MODEL.md`. Git history contains the full seven-revision
implementation design and acceptance record. This plan retains only the work
that is not complete.

## Question

Measure the cost of the `auto` default on representative promoted expressions
without shared-machine contention, then decide whether Tycho needs a
document-scoped mode choice or can rely on per-result reporting.

The default is currently approved: `strict` avoids retry cost but declines a
useful class; `auto` retries only on a lane mismatch and reports `mode`,
`promoted`, `escalation`, and `diagnostic` on the compilation result.

## Measurement protocol

Run only when the shared-box protocol reports a quiet machine.

1. Measure the promoted chain `abs(sqrt(u + 1) / 2 - 1)` over 200,000 points
   under `strict`, `auto`, and `complex`. The pre-mode observation was roughly
   9 ms strict versus 21 ms promoted, but that observation was made before the
   final implementation and is not a baseline.
2. Run the representative fractal corpus under `strict` and `auto`. Shapes
   that do not promote should emit byte-identical code and have statistically
   indistinguishable runtime.
3. Separate compile time from runner time. Record warmup, sample count, median,
   dispersion, Node version, CPU, and machine load.
4. Confirm the result flags classify every measured row correctly; consumers
   must not infer promotion by inspecting emitted code.

## Decision gate

After the measurements, choose one:

- keep per-result reporting as the only consumer control;
- recommend a document-scoped `strict`/`auto` selection in Tycho; or
- reopen the default only if a representative non-promoting workload regresses
  materially.

Record the result in `ROADMAP.md`, update `docs/COMPILATION-MODEL.md` if the
contract changes, then delete this plan.
