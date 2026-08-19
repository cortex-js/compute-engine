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
of every matching phrase. Remaining concentration areas include
`engine-protocols.ts`, `compilation/base-compiler.ts`, the largest library
definition files, and long regression narratives in Epsil tests. Files already
modified in the working tree were not broadly rewritten during this pass, to
avoid mixing the cleanup with in-progress functional changes.
