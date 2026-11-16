# Sol review of the later Program integration fixes

Independent Sol review, 2026-11-15. Read-only; no tests or production edits.

The bounded review found one introduced defect: Program JSON emitted canonical
function-first order and discarded the existing source permutation. A source
constant used in a function default could therefore be admitted initially but
refused when its Program JSON was boxed in a fresh engine. The recommended fix
is serialization in authored order using the existing `PROGRAM_SOURCE_ORDER`,
while keeping canonical sorted operands internally. This does not require a new
binding algorithm, representation or prepared-type bridge. Fix validation is
pending; this report does not certify the corrected source.

A tentative failed-declaration rollback concern was withdrawn. Existing boxed
symbol home-scope lookup re-resolves the restored scope records. Implementer
source probes covered scalar and tuple rollback, synchronous and asynchronous
execution, both in the current Program and a subsequent Program; all retained
the prior values. The independent reviewer confirmed that source mechanism.

No other regression was found in this bounded delta; the trap scan passed.
This does not replace final runtime tests or review of subsequent fixes.
