# Independent Sol review

An independent `gpt-6.1-sol` reviewer inspected the implementation after focused
controls, typechecking and changed-source lint passed. Subsequent reviews covered
only fixes deltas. Root also inspected source and the semantic boundary. No Claude
review was required or claimed; the requested independent Sol review was used.

Two introduced P2 findings were resolved:

1. Deferred initialization bypassed the absence-domain helper. Declaration and
   deferred routes now share `initializationType`; the original helper's relocation
   earns no deletion credit. With the final conservative call barrier, the deferred
   missing-row case keeps unknown, but admits the later row and returns `[5,6]`.
2. The deferred initializer scan skipped an intervening helper that used the slot.
   `function init() scope {x="a";x}; let x; let y=init(); x=1; y` incorrectly fixed
   x as number. Calls now stop deferred inference, including calls nested in the
   candidate RHS. The witness retains unknown and returns `"a"`.

The reviewer verified explicit-unknown JSON roundtrips, activation reset, callable
replacement/default aliases, constants, uninitialized reads/calls, absence and
parameter mutation. Final call-barrier delta review found no new regressions.
Changed-source trap scans passed; a first attempt included the deleted solver file
and was corrected to scan only existing changed files.

Broader validation also found and fixed a duplicate runtime diagnostic for a
constant callable write, and a misplaced compiler guard that rejected generated
temporaries while missing nested source declarations. The corrected guard is in
the existing source admission traversal. Failed-value numeric stores were classified
as an accepted fixed-contract change: refusal retains the last admitted value and
reports a diagnostic, rather than storing Error into the numeric slot.

Full-suite triage prompted another bounded correction round:

- The initial uninitialized check confused hidden values with empty slots and
  affected pre-existing Program hoisting. Source-only no-value metadata and
  physical `storedValue` presence preserve existing initialized declarations and
  deliberate shields. Review caught the deferred-initialization shield variant;
  both scalar and callable controls now cover it.
- Anonymous partial application had exposed its saturated result type as the
  initializer contract. Existing `curriedSignature` logic is shared, with unknown
  for mapped/uncertain partial results. The helper move is neutral. Unannotated
  constant callable provenance is retained for permissive inferred-call checks.
- Strict compilation of a local complex tuple produced the wrong string instead
  of `2+i`. Reusing existing `pointLaneMismatch` in source admission declines
  known lane-erasing initialization and later assignment. Complex-mode and real
  controls pass. The conservative guard can also decline an annotated strict
  sibling: no annotation-restores-strict-coverage claim is made.
- Removing parameter assignment evidence exposed a misleading numeric result
  type. Existing assigned-binding metadata now fixes unannotated written
  parameters as unknown. Resolving a first-write parameter through its existing
  shadow frame covers either statement order; no RHS inference or new tracker.

The independent reviewer inspected the final source deltas and reported no new
defect. Production search found no retired solver references. Review of expectation
migrations caught two dropped runtime controls; the Match result `2` and abstract
collection accessor result `5` were restored alongside their compile declines.
Original unannotated observations are reported separately from explicit host-input
and annotation migrations. Snapshots were not rewritten.

No review result substitutes for the combined validation or measurement results.
