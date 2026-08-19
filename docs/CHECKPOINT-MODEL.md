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

The funnels, named because the code comments at each site refer to them:

- **Value writes** — the value-definition value setter.
- **Type writes** — its type setter and the element-refinement write. The type
  setter is a hidden VALUE writer: an explicit write of `unknown` wipes the
  stored value and reports no value-write event.
- **Binding-half swaps** — `updateDef`, which exchanges a record's value and
  operator halves (`let f = 5` becoming a lambda, and back).
- **Declarations and scope-map writes** — the declare routes plus the direct
  set/delete sites for minted type constructors and protocol dispatchers. A
  fresh declaration builds its record with the value already inside, so no
  setter fires: this is the only hook that sees the first assignment to a new
  name, which is the commonest notebook write.
- **Bare-field writes** — fields written without a setter (`holdUntil`, the
  constant flag, effects-annotation provenance, statement-declaration
  markers).
- **In-place operator updates** — `_update`, which can move a signature,
  handlers, the effect set and a stored lambda literal with no half swap.
- **Object slots** — the single store funnel on the object value kind.
- **Unstamped expression-keyed memos** — the resolved-type-operand map and the
  limit probe cache, neither of which carries a version key of its own.

Definition records take ONE snapshot of their whole mutable field set per
window rather than one entry per field: the tuple is exhaustive, so a
per-field key would take more snapshots to cover the same state and restore it
no more faithfully. Adding a mutable field to either definition class means
extending that tuple; a drift-guard test compares each snapshot's key set
against the record's own property names.

Snapshots must COPY anything mutated in place — a provenance array, a
base-case map, a rule store — rather than hold a reference that tracks the
very edits the restore exists to undo.

## Generation keys and constant nodes

A cache entry stamped with NO generation is reached by no invalidation counter
and therefore survives every restore. That shape is only sound when nothing
can change the entry's answer, and "all operands are constant and the node is
pure" does not establish it: the premise holds for the operands and says
nothing about the OPERATOR. Rewriting a user function's definition in place
changes what `f(2)` types as while `2` stays every bit as constant.

So the type, sign and eager-collection-source caches on a function expression
key on the engine generation unconditionally. Keying them honestly measured
free. The lazy-collection evaluate memo is the one slot that keeps a
generation-independent key, because a hit there additionally requires its
recorded epoch to equal the engine's current world version, and a redefinition
advances that version.

The general rule for a checkpointed engine: a memo with no version key is a
memo a restore cannot invalidate. Either give it one, or journal its writes so
the rewind can drop the entries the window created.

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

Two things the harness should treat as classes of defect rather than as
one-off bugs, because both were found by review after a full green suite:

- **A snapshot that replaces a container the runtime closed over restores
  nothing.** A sequence's memoization map is created by its handler and
  captured by it; the registry metadata merely holds the same reference.
  Assigning a fresh map on restore left the handler reading the old one, so
  values memoized after the checkpoint survived the rewind while the
  introspection API reported an empty cache — correct-looking from the
  outside, stale underneath.
- **A key absent from a snapshot cannot be cleared by merging that snapshot
  over the live record.** A pending sequence has no recurrence field until one
  is added in place, so a snapshot taken before that point could not remove a
  recurrence added during the window.
