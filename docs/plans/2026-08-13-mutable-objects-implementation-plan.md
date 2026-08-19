# Mutable objects — remaining serialization and compilation work

**Date:** 2026-08-13
**Status:** ACTIVE — core objects, field access/store, effects, caching,
protocol integration, and re-settling are implemented; serialization and
compiled-boundary phases remain.

`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B is the normative feature spec and
`docs/TYPE-SYSTEM.md` records the implemented object model. Git history keeps
the completed prerequisite, representation, store, protocol, and review
workstreams.

## Phase 3 — Serialization

### Structural export

Extend `DictionaryFrom(object)` ahead of its collection guard. Export stored
fields by a deep structural walk:

- lazy and non-finite collection values remain recipes whose operands are
  walked;
- a back-edge becomes `CircularReference(depth, type?)`;
- a cross-edge duplicates structurally;
- a function literal whose captured environment cannot be represented declines
  with an error marker;
- every object read records its object-version dependency.

The export is a record, not an object reconstruction. Reloading it therefore
loses identity and object-only operations, by design.

### Provenance and API option

Use the inert provenance form `Object(record, typeName)` for MathJSON output;
it is transparent on evaluation and never a constructor.

Settle the public option spelling (current candidate:
`objects: 'record' | 'reject'`):

- default `record` exports object positions structurally;
- `reject` emits a subexpression-local `object-serialization-unsupported`;
- explicit `DictionaryFrom` and option-driven output are byte-identical.

Display serializers show fields with cycle guards and do not need the option.

### Acceptance

- one-way round trip: exported/reloaded values are records;
- cycle snapshots carry depth and nominal type;
- explicit and option-driven export are byte-identical;
- non-object serialization is unchanged;
- listener/dependency counts remain stable.

## Phase 4 — Compilation boundary

Implement or deliberately preserve fail-closed behavior:

- JavaScript/Python may accept object-typed parameters into a compiled unit;
  object-typed results decline;
- GLSL/WGSL decline objects entirely;
- object field reads/stores preserve evaluation order and the `state` effect;
- field-backed protocol accessors lower to the same field load/store machinery,
  or dynamic dispatch containing such an arm declines as a whole;
- no target uses `instanceof` for cross-bundle object recognition.

Acceptance covers static and dynamic protocol dispatch, direct field access,
parameter input, result decline, and every target's diagnostic.

## Explicit non-goals

- mutable arrays and `ArrayFrom`;
- contents-based object equality and `Equatable`;
- `ObjectFrom` reconstruction;
- subscript accessors, protocol-derived shape, and effect polymorphism.

## Exit criteria

- Serializer spelling is ruled and public docs updated.
- Phase 3 and 4 acceptance suites pass with full route/target parity.
- `docs/TYPE-SYSTEM.md`, `docs/COMPILATION-MODEL.md`, and Appendix B reflect
  the result.

Then remove this plan.
