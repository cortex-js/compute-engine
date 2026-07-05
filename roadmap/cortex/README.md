# Cortex Language — Implementation Plans

Detailed plans for the Cortex language revival. The top-level tracker —
status, audit findings, architecture decisions, phase checklists — is
[`CORTEX_ROADMAP.md`](../../CORTEX_ROADMAP.md) at the repo root; these
documents carry the per-phase design detail. Update the relevant plan when
a design decision is ratified or a phase's scope changes.

| Document | Scope | Depth |
| --- | --- | --- |
| [`language-review.md`](./language-review.md) | Consistency review of `src/cortex/docs/` + language design gaps (type system, scoping, control flow, …), each gap assigned to a phase | Complete review |
| [`phase-0-hygiene.md`](./phase-0-hygiene.md) | Mechanical fixes to current code + docs; runs in parallel with Phase 1 | Detailed |
| [`phase-1-parser-foundation.md`](./phase-1-parser-foundation.md) | New lexer/parser (house style of `common/type`), diagnostics + recovery model, port strategy, `point-free-parser` retirement | Detailed |
| [`phase-2-expression-layer.md`](./phase-2-expression-layer.md) | Shared operator table, Pratt + whitespace rule, calls/collections/dictionaries, type-annotation subparser, `$…$` LaTeX islands | Detailed |
| [`phase-3-round-trip.md`](./phase-3-round-trip.md) | Serializer completion + parse∘serialize property test, loose-syntax compat check | Scoped |
| [`phase-4-semantics.md`](./phase-4-semantics.md) | Execution model, declarations/scoping, function definitions, control flow, pragma security, Tycho integration | Scoped, open decisions flagged |
| [`phase-5-ship.md`](./phase-5-ship.md) | Build targets, package export, docs sync, announcement | Checklist |

**Dependency order**: 0 ∥ 1 → 2 → (3 ∥ 4) → 5. Phase 2's open questions
(pipe precedence, chained relationals) and Phase 4's design decisions
(anonymous functions, loop form) are flagged inline and should be settled
before their implementation starts.
