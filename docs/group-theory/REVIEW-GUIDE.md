# Group-theory foundation review

This draft proposes an opt-in native group-theory library for Epsil and Compute Engine. The immediate goal is maintainer feedback on architecture and API direction. Further commits can extend or revise the foundation. It is not a completed implementation of GAP chapters 39, 43, 44 or 45.

## Suggested reading order

1. [Current scope and limits](FINITE-MATRIX-POLYCYCLIC.md).
2. [Checked permutation values](VALIDATED-PERMUTATIONS.md), [descriptors](GROUPS-AND-CLOSURE.md) and [orbit witnesses](ORBITS-AND-TRANSVERSALS.md).
3. [Verified permutation chains](VERIFIED-GROUP-BASELINE.md).
4. [Node 26 validation and performance](PERFORMANCE.md).
5. [Chapter coverage ledger](CHAPTER-COVERAGE.json), [product requirements](PRD.md) and [research architecture](PHASE0-ARCHITECTURE.md). The research documents contain proposed future infrastructure as well as implemented findings.

## Architectural feedback requested

- Does the division between pure mathematical kernels and the opt-in CE adapter fit the engine? The installer uses checked nominal constructors, existing evaluation, cancellation and checkpoints; it changes no parser or default library behavior.
- Should permutation action domains remain explicit? Elements, generated subgroup descriptors and computed certificates are deliberately separate. Structural descriptor equality is distinct from mathematical subgroup equality.
- Should specialized dispatch and resource limits evolve into a shared engine protocol? Current dispatch is explicit, several result signatures are broad, and budgets are positional arguments.
- Is the bounded finite-table backend useful as a reference implementation alongside scalable representation-specific methods? It is capped at 256 elements; the pcgs layer currently depends on it.
- Are the certificate lifecycle and bounded session caches appropriate? Serialized descriptors are revalidated; imported certificates are not trusted. No module-global mathematical fact cache is introduced.
- How should general homomorphism/quotient values and a future independent polycyclic collection engine fit the public API?

## Important boundaries

The algorithms are original Epsil/TypeScript implementations informed by public mathematical references and GAP architecture. There is no GAP parser, interpreter, executable dependency or production bridge.

Only the opt-in installer exposes the foundation. Existing public exports and the default library remain unchanged. The only core-engine source change is a comment clarifying the existing mint:false constructor escape hatch.

Current validation covers group kernels, Epsil integration, exact serialization and a minified ESM application with a fresh Node worker. Node 26 is required by the group validation runner. No full CE suite, GAP differential run, clean dependency installation or real browser run is claimed. The inventory and performance report describe remaining scope and measured limits.
