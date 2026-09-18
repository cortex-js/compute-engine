# Codegen reassessment — 2026-09-18

This supersedes the priorities in the [September 16 advice](2026-09-16-codegen-audit-optimization-advice.md).
No compiler or Tycho source was modified for this review.

## Evidence and version boundaries

- Latest complete saved audit: `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.130.0-all.json`, generated September 18 at 02:18 UTC, Tycho `f9ed1474e`.
- Current CE: `f99a23a5`, with existing working-tree effects/entropy changes. Current Tycho source: `3e6d6c6dd`; subsequent commits through `778f69958` during this review changed documentation only.
- A fresh **19-document** audit bundled both current source trees and used the product audit's registration/classification/resolution/compilation route. Only document selection and output/version labels were changed in the scratch instrument. It recorded 621 calls / 560 distinct records.
- Scratch results and probe sources: `/private/tmp/ce-codegen-reassessment-0918/`. `head-targeted.json` is the targeted audit, not a replacement for a complete all-states baseline.

The complete saved audits give:

| Target | 0.128.13 success / decline | 0.130.0 success / decline |
| --- | ---: | ---: |
| JavaScript | 8,934 / 112 | 9,017 / 113 |
| interval-js | 4,471 / 188 | 4,477 / 182 |
| GLSL | 4,844 / 148 | 4,844 / 148 |

These are records, not equally weighted runtime workloads. Both audits have
684 documents contributing compilation records; their document summaries list
734 attempted documents. Tycho also changed between the two audits, so the
counts do not isolate engine changes. The 0.130.0 audit predates the latest
interval absence/point work and today's Tycho interpreted sharing pass.

## What is complete

**The three measured runtime recommendations landed in CE 0.130.0 and Tycho
has adopted them.** The saved full audit confirms the emission changes:

| Witness | Earlier emission | 0.130.0 emission |
| --- | --- | --- |
| `vwbagbcerj`, 11-term interval sum | 30,708-character body; 50,883 including constants | 751-character body; 3,424 total; constant indices select their elements at compile time |
| `vwbagbcerj`, 400-term interval sum | 400-element array constructed in every iteration | Array constructed once per artifact; body 2,982 → 291 characters |
| `lwuwgb9ic5`, derivative | 83,798 characters; repeated minimum in each stencil callback | 17,514 characters; synthesized lambdas receive CSE |
| `thpezd39zq`, integration | Invariant Gamma/normalization evaluated per sample | First-use invariant initialization beside the callback, on both JavaScript and interval targets |

The larger integration source is beneficial: the extra declarations and
first-use guard remove repeated work and preserve the no-samples case.
Do not schedule these fixes again.

**The original census out-of-memory blocker has been addressed.** CE added
collection evaluation memoization and sharing-aware reference analysis; Tycho
removed several MathJSON tree round trips, adopted `ce.rebind` and
`expr.digest`, and improved expansion memoization. Complete newer audits now
exist. This does not imply the terrain document is fully served: in this
review's current-source run, four `nxlddeh5zv` JavaScript calls still declined,
now at `Length` rather than the saved audit's enormous folded-source-size
diagnostic. Those recorded calls took 14–31 ms; the document route took 8.2 s.
Its remaining typing/shape issue should be triaged separately from the old OOM.

**Tycho's repeated computed-collection evaluation has also improved.** Its
September 18 sharing pass binds evaluated repeated subexpressions in the
resolver's child scope. The Tycho report measures `s8ishknvhe` at 10,000 points
as 11.3 s expanded → 2.1 s shared / 2.5 s through the resolver, with identical
values. Those are the Tycho team's measurements, not a new timing reproduced
here. The by-reference replacement of document helpers was explicitly rejected
by their value checks: it changes whole-list semantics for untyped parameters.

References: CE CHANGELOG 0.130.0; Tycho
`docs/COMPUTE_ENGINE_LOG.md` (0.130.0 adoption) and
`docs/scratch/2026-09-18-computed-collection-body-expansion.md`.

## Current unpublished interval work has real gains

The source now supports absence across its admitted value model, coordinate
access over point lists, and coordinate-wise point arithmetic. The old advice
to start with nine numeric-absence rows is obsolete. The CHANGELOG records
eight rows unlocked by absence, followed by a point-arithmetic round that
unlocked thirty interval rows in a 17-document probe; these are separate
reported measurements and should not be added into a projected full-corpus
count without matching their records.

My independent 19-document run found **25 matched decline → success records**,
all interval-js, and **no matched success → decline records**:

- `hpr2q4kles`: 18.
- `mqm2eamst1`: 4.
- `37c316659d`: 2.
- `7vqnkhdhoj`: 1.

Matching used target, corpus/document, input hash, and options, pairing
identical outcomes first. There were 221 old records and 16 new records with
unmatched keys. The same 19 documents had 765 records in the released audit
versus 560 now. Changes in input expansion, member generation and
materialization/deadline behavior prevent treating those unmatched records as
wins or regressions. This is partial verification, not whole-corpus regression
certification or a value-enclosure check of every new successful row.

The 25 current interval declines in this sample are: List 8, PointList 5,
Apply 5, At 3, Join 2, D 1, and an unknown helper 1. All eight List declines
are in `sgtdqnj2ox`; the five PointList and three At declines are in
`n7uhaaoq1q`. That concentration argues for document-specific reproduction
before broadening the target further. Much of the latter document is
parametric geometry, so establish that its interval path is useful first.

## Recommended next work

### 1. Finish the release/adoption measurement

Publish/adopt the interval and conjugate parsing work through the normal
release process, then take a controlled complete audit and selected rendering
measurements. This review did not publish or install anything. The saved
0.130.0 census cannot certify the new source changes.

Track member counts, selected compiled/interpreted route, interval exclusion
quality and document open/update time alongside compilation success. Tycho's
0.130.0 adoption already caught a materialization timeout that shipped
unsubstituted family members; that defect was fixed after the saved audit.
Changed census populations need explanation, not just a lower decline total.

### 2. Next codegen task: project collections before building points

**New concrete witness: `woeywky0kj`, full-audit record 16828.** The current
source still emits exactly the same 295,869-character JavaScript kernel
(current targeted record 560). Of this, 295,460 characters are a literal table
of **7,225 two-coordinate points**.

The expression computes a point-list affine transformation and immediately
reads `PointX`. Emitted code constructs the nested point table, scales both
coordinates, adds a point to every point, projects x with `.map`, then
broadcasts the outer sine/arithmetic. The y-coordinate is computed and
allocated even though the result does not use it.

Recommendation: extend the existing point-accessor projection rules through
proved point/list arithmetic, then fuse the scalar collection operations.
Pool the immutable projected data once. This is a projection/loop change,
not a request to unroll thousands of elements or globally raise size caps.
Preserve point-versus-list semantics, error positions, effects, live-source
reads, and mutation isolation. `foldPointAccessor` in
`compilation/fixed-width-unroll.ts` already has related rules and guards;
extend the missing shape rather than invent a separate algebraic simplifier.

A manual emitted-kernel prototype that keeps only the x table and one scalar
loop returned **bit-identical arrays at t = 0, 0.5, 2**. Two warmed,
interleaved local runs measured medians around **14.9–15.2 ms → 0.54–0.56 ms**.
The box was loaded and individual timings varied substantially, but the
projected variant was faster than the original throughout both runs. Merely
pooling the original two-coordinate table had overlapping timing ranges with
the original, so pooling alone is not a demonstrated speedup from this probe.
This is evidence for an implementation experiment, not a production speedup
claim or a proof of the general rewrite.

### 3. Remove repeated unproductive symbolic integration attempts

The runtime integrand work is fixed; compile latency is not. `thpezd39zq`
still makes five compilation requests that each spend approximately two
seconds before emitting numeric integration. Current targeted records
534–538 reproduced this, for roughly ten seconds total.

Measure and share closed-form search work for equivalent requests with the
same bindings, angular settings, assumptions and relevant options. Consider a
deterministic supported-form check or an explicit caller policy when numeric
integration is wanted. Avoid caching a timeout permanently as proof that a
closed form does not exist.

Constant folding already has deterministic cost/depth/visit bounds. Its own
wall-clock cutoff was removed by user ruling to preserve reproducible code;
do **not** reinstate the earlier report's wall-clock suggestion. The symbolic
antiderivative attempt is a separate path with its existing 2,000 ms budget.

The older `7kn7eakzkd` slow decline is intermittent: one current targeted
record took 14 s, but an isolated follow-up separating LaTeX serialization
from compilation gave interval declines in 2–19 ms. Treat it as a profiling
lead, not a confirmed reproducible 14-second compiler regression.

### 4. Make the remaining collection fallback compile, one witness at a time

`s8ishknvhe` still declines at `Abs` and `Hsv` on current source. The conjugate
parse fix and Tycho sharing make interpretation viable, but the compiler has
not gained this workload. Start from the actual `C_cf` body and retain its
whole-list semantics; do not replace expanded document helpers with bare
named calls.

A current-source probe resolved `C_c` to 50 numeric 3-D points, then compiled
the expanded body with a live C_c input. Narrowing its declaration from the
ambiguous collection/point union to `list<tuple<number, number, number>>`
changed coordinate accessor results to `list<number>`, but the full body
**still declined at Abs**. Thus the earlier roadmap suggestion that narrowing
alone makes this witness compile is not sufficient in this experiment. Trace
the remaining broadcast/type/lowering gate with this narrow case before
choosing a Tycho typing fix, CE lowering fix, or both.

Further evaluator optimization should target per-element canonical boxing
and deadline responsiveness. Tycho has already removed repeated expression
evaluation for this route, so implementing that same sharing again in CE is
lower priority unless another caller or witness needs it.

### 5. Keep unrolling and interval fusion as measured follow-ups

The 100-term JavaScript and interval unroll limits remain. The Fourier cases
still produce about 18–23 KB including their constant tables. A cost-sensitive
loop/table choice is worth benchmarking, particularly shared n-dependent
coefficients across two reductions, but shorter code alone is not a win.

Interval broadcast and map/reduce fusion remain candidates after measuring
allocation and plotting cost. Wide-bound range/sum refinement should be
driven by `entire` rates and cell subdivision counts. General GLSL collection
bindings/quadrature and interval AD are larger projects; the present evidence
does not put them ahead of the concrete hot kernels above.

## Verification limits

The full-corpus counts came from the saved files; only the named 19 documents
were freshly audited. Source bundles went to `/private/tmp`, leaving installed
packages and repository build artifacts alone. Existing working-tree changes
were left intact. No compiler implementation or test suite was changed.
The kernel prototype checks only the stated inputs; the new lowering wins
still need release-level value/render validation.
