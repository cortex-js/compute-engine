# Design Plans

This directory is a working set, not a permanent archive.

A document belongs here only while either:

1. its implementation or product decision is still active; or
2. current source/tests cite it for a design invariant that has not yet been
   moved into `ARCHITECTURE.md` or a focused normative model.

When work completes, preserve public behavior in `doc/`, architectural
invariants in the appropriate current specification, genuinely remaining work
in `ROADMAP.md`, and initiative-level history in `docs/STATUS_REPORT.md`. Then
remove the plan. Git history is the detailed execution archive.

## Active work

The current working set includes:

- solver follow-ups: Diophantine solving, `Series`, statistics, and `explain`;
- unresolved scoping and tuple/point semantics;
- the remaining broadcast-typing, parse-scope, and compile-CSE decisions;
- deep-tree boxing;
- first-class types;
- strict linear-session and checkpoint/restore work.

The status header inside each document is authoritative. If a plan says
`IMPLEMENTED`, `COMPLETE`, `CLOSED`, or `SHIPPED`, it is retained only because
the implementation still links to it. Such links should be migrated to a
current specification during the next change to that subsystem, after which
the plan should be removed.
