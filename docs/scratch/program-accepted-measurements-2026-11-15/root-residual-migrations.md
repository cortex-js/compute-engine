# Coordinator test migrations after the residual census

The residual run covered 83 suites: 3,099 passed tests, 42 failed tests, 25
passed snapshots. Its source remained unchanged. The failures are not accepted
as a passing gate. Subsequent test edits preserve the following controls:

- A helper compiling a function body unwraps a parsed Program into a lexical
  Block, while retaining direct `g`/`Apply` bodies. The same-statement registry
  test extracts the single declaration from its Program before exercising the
  explicit statement-route marker; object identity controls remain intact.
- Coarse callable binding types do not adopt replacement argument contracts;
  old and fresh calls still compare their evaluated result. Stored literal
  contracts remain enforced.
- A final declaration returns Nothing, including CLI sessions and lazy
  comprehension declarations. The lazy collection is explicitly listed before
  asserting its elements. A refused protocol function is asserted through the
  diagnostic hook and leaves the caller's object unchanged.
- The decided-record effect control now declares its record binding through the
  host API. The previous fixture called a noncallable record type and produced
  an unresolved initializer; it did not establish a decided record receiver.
- Literal tuple types stay precise. Program variable collection widths and
  numeric contracts widen under existing Block rules. Three formerly expected
  compilation failures now pass their original assertions and are promoted to
  ordinary tests; no assertion is removed.
- Typed-let provenance records both inferred and declared transitions where
  canonical preparation produces them. A host assignment control still expects
  only its original declared transition and retains its cause.
- Earlier functions see the later Program constant contract. The diagnostics
  name constant-assignment; ordinary reads before initialization still report
  read-before-declaration. First-site note positions follow canonical report
  order, and remain tied to their separate source declarations.

The Epsil documentation example runner supplied the observed outputs for the
updated numeric type and erased collection-width examples. No snapshots were
updated. Production defects (overlap checking, failed fresh declaration cleanup,
duplicate detail and Program serialization) remain source-fix obligations.
Final test and snapshot totals belong to the final validation report.
