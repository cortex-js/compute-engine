# Internal Architecture Status

Last updated: 2026-08-19.

This report records the internal and architectural history that remains useful
after an implementation initiative is complete. It is not a user-facing
changelog and does not replace [`ROADMAP.md`](../ROADMAP.md), which tracks work
that remains, or [`ARCHITECTURE.md`](../ARCHITECTURE.md), which describes the
current system.

## Current posture

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) is the canonical map of the current
  codebase and its dependency rules.
- The normative behavior of the type, effect, inference, string, randomness,
  and broadcast systems is maintained in the focused documents indexed by
  [`docs/README.md`](./README.md).
- Public behavior belongs in [`doc/`](../doc/). Internal documents should not
  duplicate public guides.
- [`docs/plans/`](./plans/) contains only active work. Completed execution
  plans are summarized here and retained in Git history; source comments must
  cite a normative model rather than keeping a completed plan alive.
- Corpus programs, fixtures, and reproducibility tooling are engineering
  assets, even when they currently live below `docs/`; they are not treated as
  narrative documentation.

## Architecture initiatives

### Engine modularization and dependency direction — complete

The February 2026 architecture work split the engine into kernel type
contracts, concrete type wrappers, runtime services, and a composition root.
It also made `LatexSyntax` injectable, established explicit package entry
points, added runtime validation around extension contracts, and eliminated
runtime circular dependencies. The resulting structure and its enforcement
commands are documented in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

The original architecture reviews, refactor proposals, and cycle-elimination
plans were implementation records. Their current conclusions have been
incorporated into the architecture guide; their detailed chronology remains in
Git history.

### Numeric and package foundations — complete

The early 2026 implementation rounds introduced the native `BigDecimal`
implementation, precision-scaled special functions, package subpath
modularization, compilation constant folding, colors, and parser cleanup. The
current public contracts live in the numeric, compilation, color, and LaTeX
guides under [`doc/`](../doc/). Release-facing behavior remains in the already
published changelog entries; architectural details are represented by the
current code and architecture guide.

### Fungrim and Rubi integration — operational

The Fungrim translator, rule dispatcher, assumptions support, corpus loader,
and opt-in identities package have shipped. Rubi integration is also shipped as
an opt-in package. Current package behavior is documented in the public
Fungrim and integration-rule guides. Internal corpus provenance, loader
boundaries, and current coverage are kept in the concise subsystem notes under
[`docs/fungrim/`](./fungrim/) and [`docs/rubi/`](./rubi/).

### Parser corpus hardening — operational

The July 2026 MathNet and mathematical-genre sweeps converted real-world parser
failures into regression corpora and eliminated the crashing cases found by
the campaign. The lasting artifacts are the curated inputs, round-trip
exceptions, test cases, and reproducibility scripts under
[`docs/mathnet/`](./mathnet/). Narrative sweep reports and completed execution
plans are historical rather than normative.

### Correctness and performance review campaign — complete

The July 2026 multi-round review campaign dispositioned its P0/P1 findings,
promoted durable cases into the test suite, and completed its benchmark and
arbitrary-precision follow-ups. Raw findings tables, ad-hoc gates, and progress
logs were useful execution artifacts but are not maintained documentation. The
lasting outcomes are tests, benchmark harnesses, current public behavior, and
Git history.

### Runtime semantics — implemented with focused residuals

The random-family redesign, timeout spans, lazy collection regimes, tensor
unification, missing-value typing, binder mechanism, conditional values,
overload resolution, and compilation parity work have landed. Their durable
contracts live in the focused model documents and public guides. Remaining
edge cases are tracked in [`ROADMAP.md`](../ROADMAP.md), not in completed
implementation plans.

### Normative-model consolidation — complete

The August 2026 documentation pass retired the accumulated implementation
plans for shipped type, scope, collection, compilation, language, string,
randomness, and state work. Current contracts now live in the focused models
indexed by [`docs/README.md`](./README.md), while source/test references point
to those models. `docs/plans/` was reduced to the active working set; detailed
decision chronology remains available from Git history.

### Epsil language revival and roadmap consolidation — complete

The July 2026 Cortex-language revival shipped the hand-written parser,
serializer, evaluator, declarations and control flow, diagnostics, CLI/REPL,
MCP server, executable documentation, and the experimental package entry
point. The language was subsequently renamed Epsil and its implementation and
public documentation moved to `src/epsil/`.

The former `roadmap/cortex/` held 2,022 lines of phase plans, audit snapshots,
agent-evaluation notes, and completion logs. The phase work and most later
findings had landed; durable behavior is covered by `LANGUAGE-MODEL.md` and the
executable public docs. The small applicable residue was consolidated into
`docs/epsil/ROADMAP.md`; detailed chronology remains in Git history.

### Type, protocol, object, and effect systems — active evolution

Parameterized types, generic functions, protocols and compiled dispatch,
named arguments, first-class type values, inference provenance, and effect
provenance have implemented foundations. Their current contracts live in:

- [`TYPE-SYSTEM.md`](./TYPE-SYSTEM.md)
- [`TYPE_SYSTEM_ROADMAP.md`](./TYPE_SYSTEM_ROADMAP.md)
- [`EFFECTS-MODEL.md`](./EFFECTS-MODEL.md)
- [`INFERENCE_ROADMAP.md`](./INFERENCE_ROADMAP.md)

Sum compilation and mutable objects remain active implementation initiatives.

The inference-rollback and trial-overload initiative is complete. Its
microbenchmark finished within the approved gates: the post-optimization
median was about 1.15× the filter baseline, the worst measured row about 1.5×,
and workloads without overload sets stayed within noise. The implemented
rollback invariant is in `TYPE-SYSTEM.md`; the benchmark remains executable.

Implementation journals should be folded into these documents only when they
state a current invariant; completed sequencing and review narratives belong
here at initiative granularity or in Git history.

### Strings and regular expressions — implemented foundation

Strings are indexed collections of characters, with current preservation,
search, joining, and regular-expression behavior documented publicly under
[`doc/97-reference-strings.md`](../doc/97-reference-strings.md). The internal
[`STRING_ROADMAP.md`](./STRING_ROADMAP.md) remains the design authority for
cross-subsystem invariants and explicitly deferred work.

### Linear sessions and checkpoint/restore — active

The strict linear-session posture and checkpoint/restore work is active as of
this report. Its current design records are retained in `docs/plans/` while the
implementation and consumer contract settle. Once complete, its durable state
model belongs in `ARCHITECTURE.md` and its public API belongs in `doc/`; the
execution plans should then be removed.

## Documentation maintenance rule

When a plan completes:

1. Put user-visible behavior in `doc/` and the public API reference.
2. Put current architectural invariants in `ARCHITECTURE.md` or a focused
   normative model.
3. Put genuinely remaining work in `ROADMAP.md`.
4. Add a short initiative-level result here only when internal history will
   help future architectural decisions.
5. Remove the completed plan, review transcript, and temporary probes. Git
   history remains the detailed record.

Do not add internal implementation chronology to `CHANGELOG.md`.
