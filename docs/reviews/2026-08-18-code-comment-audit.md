# Code Comment Audit — First Pass

Date: 2026-08-18

## Scope

This was a representative audit of TypeScript and JavaScript under `src/` and
`test/`. It sampled comment-dense files in the Epsil parser, type system,
compiler, boxed-expression layer, numerical code, and tests. Generated rule
data, snapshots, benchmark expressions, public API reference prose, and
mathematical derivations were excluded from cleanup unless they contained a
clear defect.

The screening queries found approximately 216 references to an unnamed
“Appendix A/B,” 1,655 numbered-section references, 472 phase labels, 997
historical markers such as “used to” or “previously,” 35 ambiguous “see
above/below” references, and 16 bare `TODO`/`FIXME` comments. These counts are
candidate counts, not defect counts: a section link, historical note, or
capitalized word can be justified in context.

## Representative findings

### Local comments depended on design-document coordinates

Comments frequently used “Appendix B,” “§5.2 G3,” “R5,” “D6,” “Phase 1,” or a
review item number as the explanation. These references are hard to resolve
when the path appears only at the top of a long file, and they become wrong
when a living design document is reorganized.

The durable part is usually a short invariant: a lazy operand must not be
hoisted, a value-type inference event must not invalidate the computation that
triggered it, or a shader target must reject a shape it cannot represent. The
cleanup states that invariant locally and keeps a design link only when it
adds useful background.

### Decision history obscured current behavior

Several production comments narrated migrations, reversals, dated rulings,
measurements, and earlier bugs before saying what the code does now. This was
especially visible in cache invalidation, common-subexpression elimination,
the compilation targets, and Epsil parsing.

Regression history remains valuable in version control, tests, and design
records. At the code site, present-tense behavior and the reason it matters are
more useful. Compatibility chronology is retained only where callers can still
observe the older contract.

### References pointed to removed documentation

Multiple source and test comments referred to files such as
`doc/08-guide-types.md`, `doc/06-guide-augmenting.md`,
`doc/82-reference-collections.md`, and `doc/97-reference-strings.md`, none of
which exists in this repository. The useful claims were restated locally or
linked to current files such as `src/epsil/docs/types.md` and
`docs/STRING_ROADMAP.md`.

### Project shorthand and all-caps emphasis increased density

Comments used unexplained labels such as “G1b,” “D6,” “Tycho item 120,”
“pre-cutover,” and “zero-mask branch,” often combined with all-caps emphasis.
Some domain vocabulary is necessary, but temporary review vocabulary should
not become the primary description of production code. The cleanup preserves
identifier names and established mathematical terms while replacing review
labels with ordinary prose.

### Commented-out implementations and bare action markers had no contract

Dormant formatter, polynomial, and rule implementations were stored as
comments. Several unsupported SymPy and ordering paths had only `@todo`, which
did not say whether the fallback was conservative, erroneous, or intentional.

Commented-out implementations were removed. Bare action markers were replaced
with the current unsupported behavior and its fallback. This audit did not
invent issue numbers for untracked work.

### Some comments restated syntax or remote context

Comments such as “see above,” “see below,” and “see docstring” required a reader
to search manually. Others translated a branch immediately below without
explaining its purpose. High-confidence cases now name the relevant symbol or
state the invariant directly.

## Patterns worth keeping

The audit also found many comments that should remain:

- numerical derivations and precision/error-bound explanations;
- parser recovery invariants and source-span rules;
- compatibility behavior that is still externally observable;
- links to standards or upstream algorithms when they identify the authority
  for a mathematical or serialization choice;
- test comments that explain a surprising fixture or distinguish two plausible
  semantics;
- safety notes describing why a simpler implementation would miscompile,
  recurse, lose precision, or invalidate a cache incorrectly.

## Resulting policy

The repository policy is in
[`docs/COMMENTING-GUIDELINES.md`](../COMMENTING-GUIDELINES.md) and is linked
from `CONTRIBUTING.md`, `AGENT.md`, and the documentation map. Its central rule
is that a local comment must explain current intent or an invariant without
requiring an unnamed historical document.

## Implementation pass and residual work

The first cleanup pass touched source and tests across the major subsystems. It
removed archival prose, dead commented-out code, absent-document references,
ambiguous cross-references, and bare action markers while preserving behavior.

This is intentionally a high-confidence pass rather than a mechanical removal
of every matching phrase. A follow-up pass addressed the initial concentration
areas in `engine-protocols.ts`, `compilation/base-compiler.ts`,
`library/collections.ts`, `library/core.ts`, `epsil/parser.ts`, and representative
Epsil tests. That pass also found and removed orphaned doc comments whose helper
had moved, and condensed active comments that still carried retired-feature or
dated benchmark narratives.

Those files remain naturally comment-dense because they enforce parser,
dispatch, compilation-safety, and compatibility invariants. Further cleanup
should proceed by subsystem alongside functional changes, not by deleting every
remaining phase label or historical phrase mechanically.

A compilation-focused pass then covered the shared compilation contracts,
JavaScript, Python, GPU, protocol dispatch, common-subexpression elimination,
and deprecated-option normalization. Besides reducing jargon and historical
narratives, it found three concrete documentation defects:

- the JavaScript string-equality comment described a normalization divergence
  that the current `_SYS.eqt` lowering no longer has;
- the Python broadcasting contract was attached to the complex-helper table
  instead of the broadcast helper and contradicted the helper's current
  length-mismatch behavior;
- protocol-dispatch and CSE helpers had orphaned or incomplete doc comments.

Those comments now describe the active lowering contracts at the relevant
symbols. The largest residual compilation clusters are the random-stream and
compiled-pattern paths in `gpu-target.ts`, the `Match` and multi-clause
function paths in `base-compiler.ts`, and the CSE emission machinery. They
should be revisited when those paths next receive functional changes because
their safety explanations are tightly coupled to control flow.
