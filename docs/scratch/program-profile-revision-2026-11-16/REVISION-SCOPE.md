# Bounded profiling and reduction revision

The coordinator accepted the Program consolidation as a simplification, not a
performance pass. This revision preserves that distinction. The accepted source
is commit `4cb2e040ba01`; causal measurements use the frozen pre-consolidation and
accepted variants from the preceding packet, without unrelated compiler changes.

Before edits, V8 CPU and sampled-allocation profiles were captured for Program
boxing, parsing plus boxing, checking and real Tycho notebook cell reruns. Public
API counters show fewer boxing calls after consolidation; repeating public raw
boxing is not the observed regression. Extra costs occur inside canonicalization,
type/signature computation and metadata construction. Inclusive profile rows
share descendants and must not be added together.

One bounded patch is authorized: guard unnecessary named-argument splitting,
avoid empty diagnostic entries and unused sequence metadata, and avoid demanding
validity/signature information before a structural guard establishes a need for
it. Existing canonicalization, signature validation, assignment evidence and
read-before-declaration ownership remain. No persistent cache, compiler lowering,
Document preparation or alternative binding/checking path is introduced.

The prior deletion ledger remains frozen. This revision will add a separate,
integer line ledger against the accepted commit and recompute the cumulative
baseline-to-final code delta. Tests and measurement instruments are counted
separately. The 947-line named retirement inventory remains mandatory; none of
those retired mechanisms may return. No new line budget is asserted.

Validation reuses unchanged route, consumer and semantic coverage from the
accepted packet. The delta gets focused sequence/checker/function tests,
typechecking, lint, core checks and independent review. Affected matched timing
and allocation measurements will be repeated. Remaining regressions will be
reported, without changing acceptance margins or starting another optimization
round.
