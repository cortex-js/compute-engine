# Design Plans

This directory is a working set, not a permanent archive.

A document belongs here only while its implementation or product decision is
still active. Source and tests cite `ARCHITECTURE.md` or a focused normative
model for implemented invariants; a citation is never a reason to retain a
completed plan.

When work completes, preserve public behavior in `doc/`, architectural
invariants in the appropriate current specification, genuinely remaining work
in `ROADMAP.md`, and initiative-level history in `docs/STATUS_REPORT.md`. Then
remove the plan. Git history is the detailed execution archive.

## Active work

The current working set is intentionally small:

- solver/product work: Diophantine porting assessment, `Series`, statistics,
  and the remaining conditional-value adopters;
- semantic decisions: nested-block capture, tuple/point semantics, central
  broadcast typing, parse-scope control, and declared `broadcastable<T>`;
- compilation: CSE and the remaining quiet-machine complex-mode benchmark;
- type/runtime initiatives: sum-type sugar/compilation, mutable objects, and
  deep-tree boxing;
- checkpoint/restore for strict linear notebook replay.

The status header inside each document is authoritative. A plan marked
`IMPLEMENTED`, `COMPLETE`, `CLOSED`, `FIXED`, `LANDED`, or `SHIPPED` does not
belong here: move its durable contract to a normative model, record any real
residual in `ROADMAP.md`, summarize the initiative in `STATUS_REPORT.md`, and
delete the plan in the same change.
