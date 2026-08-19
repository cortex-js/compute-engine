# Checkpoint and Replay Model

**Status:** normative internal reference for the implemented checkpoint API.

The checkpoint API supports linear notebook replay:

```text
restore(cp[k-1]); run(P'k … P'm)
  ≡ fresh engine at baseline B; run(P1 … Pk-1, P'k … P'm)
```

It rewinds engine state. It does not make external effects replay-transparent.

## API

- `ce.checkpoint(label?)` returns an opaque, engine-owned checkpoint.
- `ce.restore(cp)` rewinds to it and invalidates every younger checkpoint.
- `ce.discard(cp)` releases that checkpoint while preserving the ability of
  older checkpoints to undo the discarded interval.
- Checkpoints form one stack. There is no branching or cross-engine restore.

The token exposes identity, optional label, and liveness for diagnostics, but
clients must not inspect implementation snapshots or journal windows.

## Quiescence

Checkpoint operations are legal only at the session base between cells: no
evaluation (including suspended async evaluation), Epsil batch/static pass,
inference rollback, boxing repair, or pushed scope may be active. A refusal is
a no-op and throws `CheckpointError` with a stable code.

Dead tokens and tokens from another engine are rejected. If mutation fails
during restore, the engine is poisoned; the client must rebuild it and replay
from its baseline.

## State coverage

Bounded state is snapshotted at checkpoint creation: type/protocol registries,
assumptions, host-visible engine configuration, rule stores, compilation
targets, and sequence registries.

Unbounded mutable state is copy-on-write journaled after the checkpoint:
definition fields, scope-map changes, object slots/versions, and expression
memos without a safe generation key. Derived state that is cheaper to rebuild
is purged on restore.

Journal hooks are attached to mutation funnels, not individual callers. A new
field or write path must either join the snapshot/journal, be safely derived,
or be listed as an explicit host precondition.

## Identity and invalidation

Restore rewrites existing definition records and mutable containers in place.
Replacing them would strand boxed expressions and closures on obsolete object
identities. Containers captured by a runtime closure are cleared/restored in
place for the same reason.

Monotone generation counters advance across restore; they never rewind.
Over-invalidation costs recomputation, while reviving an old generation can
return a wrong cached value. A boxed expression created before a checkpoint
remains valid after restore. A live boxed expression created inside a discarded
window is outside the contract; clients persist serialized cell artifacts
instead.

## Effects and exclusions

Replay re-executes random draws, I/O, clocks, and host callbacks. These may
produce different external observations even when engine state is restored.
Process-global state and host mutation of injected services/dictionaries are
not silently captured.

Object serials and similar identity-bearing display fields need not match a
fresh engine byte-for-byte; semantic comparison strips those fields. The
active differential harness defines the comparator for results, types,
diagnostics, serialization, and `About()` output.

## Remaining work

The randomized differential harness and the strict linear-session posture flip
remain active in `plans/2026-08-18-checkpoint-restore-design.md`. Once those
gates close, that plan is removed; this document remains the contract.
