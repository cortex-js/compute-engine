# Compute Engine Engineering Documents

This directory contains internal specifications, active design work, corpus
tooling, and historical migration guides. User-facing documentation is under
[`doc/`](../doc/) and published at
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/).

## Start Here

For installation, quick-start examples, and the main public API entrypoints,
read the repository [`README.md`](../README.md).

## Documentation Map

| Goal | Recommended doc |
| --- | --- |
| Learn package usage quickly | [`../README.md`](../README.md) |
| Understand the overall architecture | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Review internal architecture history | [`STATUS_REPORT.md`](./STATUS_REPORT.md) |
| Understand simplification invariants | [`SIMPLIFY.md`](./SIMPLIFY.md) |
| Understand seeding, `Random` draws, and cross-target parity | [`RANDOMNESS-MODEL.md`](./RANDOMNESS-MODEL.md) |
| Understand time budgets and cancellation | [`TIMEOUT-MODEL.md`](./TIMEOUT-MODEL.md) |
| Understand checkpoint/restore and notebook replay | [`CHECKPOINT-MODEL.md`](./CHECKPOINT-MODEL.md) |
| Understand broadcast length-mismatch policy (strict lifting vs shortest pairing) | [`BROADCAST-MODEL.md`](./BROADCAST-MODEL.md) |
| Understand effects and effect inference | [`EFFECTS-MODEL.md`](./EFFECTS-MODEL.md) |
| Understand implemented type-system invariants | [`TYPE-SYSTEM.md`](./TYPE-SYSTEM.md) |
| Understand binding and scope invariants | [`SCOPING-MODEL.md`](./SCOPING-MODEL.md) |
| Understand collection representation and execution | [`COLLECTIONS-MODEL.md`](./COLLECTIONS-MODEL.md) |
| Understand compilation invariants | [`COMPILATION-MODEL.md`](./COMPILATION-MODEL.md) |
| Understand Epsil lowering semantics | [`LANGUAGE-MODEL.md`](./LANGUAGE-MODEL.md) |
| Track active Epsil language and tooling work | [`epsil/ROADMAP.md`](./epsil/ROADMAP.md) |
| Understand open type-system direction | [`TYPE_SYSTEM_ROADMAP.md`](./TYPE_SYSTEM_ROADMAP.md) |
| Understand collection-element inference | [`INFERENCE_ROADMAP.md`](./INFERENCE_ROADMAP.md) |
| Understand string and character invariants | [`STRING_ROADMAP.md`](./STRING_ROADMAP.md) |
| Reproduce parser corpus checks | [`mathnet/README.md`](./mathnet/README.md) |
| Upgrade from an old release | [`MIGRATIONS.md`](./MIGRATIONS.md) |
| Write or review code comments | [`COMMENTING-GUIDELINES.md`](./COMMENTING-GUIDELINES.md) |

## Document lifecycle

- Current public behavior belongs in `doc/`.
- Current internal behavior belongs in `ARCHITECTURE.md` or a focused model.
- `plans/` is for active work only.
- Internal initiative history is summarized in `STATUS_REPORT.md`.
- Completed execution plans, review transcripts, generated findings, and
  scratch probes are removed after their durable conclusions are incorporated.
- The versioned migration guides are historical documents and should not be
  read as current API reference.
