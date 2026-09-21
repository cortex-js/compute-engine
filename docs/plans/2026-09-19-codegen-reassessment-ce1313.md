# Codegen reassessment after Tycho adopted CE 0.131.3

This updates the [September 18 recommendations](2026-09-18-codegen-reassessment.md).
The release/adoption prerequisite is complete. The next implementation should
still target coordinate projection through point-list arithmetic, followed by
repeated symbolic integration searches and the remaining computed-list fallback.
The collection-selection interval work has made further progress and should
not be scheduled again.

## Evidence

- Installed Tycho package: CE **0.131.3**, verified from its package manifest.
- Adoption artifact: `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.131.3.json`,
  generated September 19, Tycho `9d1a5339a`. This is CORE plus showcase,
  **not an all-states census**. The latest saved all-states census remains 0.130.0.
- Fresh check: the same 19 problem documents examined September 18, using
  Tycho source at `a2f1459f1` plus its existing working-tree changes and the
  **installed release**, not CE's newer source. The audit was bundled before
  execution; later source edits cannot change that bundle. Only selection,
  import paths, and output scope were changed in the instrument.
- Scratch instrument, emitted-code artifact and log:
  `/private/tmp/ce-codegen-reassessment-0919/`. The run completed with 757
  calls and 696 distinct records. Installed dependencies and Tycho artifacts
  were not modified.

The targeted run overlapped other machine work (observed load 17.5 on eight
cores). Its timings are not performance comparisons. Product deadlines can also
change the population of generated members under load. Comparisons below use
document, target, input hash and compilation options; groups with multiple
emissions are compared as groups rather than silently overwriting a record.

## What the adoption audit actually establishes

| Target | 0.131.1 success / decline | 0.131.3 success / decline |
| --- | ---: | ---: |
| JavaScript | 464 / 4 | 499 / 0 |
| interval-js | 124 / 11 | 124 / 3 |
| GLSL | 164 / 2 | 160 / 2 |

All **749 shared records have identical emitted code and outcomes**. All 20
old-only and 39 new-only inputs belong to `n7uhaaoq1q`. Its old-only records
include eight interval declines, four JavaScript declines, four JavaScript
successes and four GLSL successes; the 39 new records are JavaScript successes.
Thus the eight fewer interval declines do not mean eight newly compiled
interval kernels. The set of expressions reaching compilation changed.

Tycho's adoption log reports a same-source, same-corpus engine substitution
that reproduces this population change. The new PointList static-width typing
is a plausible mechanism, but that control does not isolate the specific fix.
The remaining CORE declines are interval Mandelbrot, Julia and List, and two
GLSL dynamic-collection At cases. They are not a census of the broader backlog.

The adoption log records passing typecheck, lint, 14,814 Node tests, 2,621 Worker
tests and 3,067 Chromium tests. Those are adoption results, not suites rerun for
this review.

### Rendering evidence needs a narrower claim

The saved 0.131.3 CORE render arm reports 20 rendered and four no-paint states.
However, direct comparison of the files contradicts the log's claim that all
member counts and pixel counters match except for the previously hanging state:

- `n7uhaaoq1q` has **70 → 109 series**. Both arms are no-paint in the
  `no-webgl` environment, so these images do not validate its new geometry.
- Several pixel counters differ materially: `bdkswbqr6x` chromatic fraction
  changes from 0.52627 to 0; `0ugzbaxw5r` dark fraction from 0.53094 to 0.09947.
- The new `khpocp8io0` result contains `resolverDeferred: 1`, despite the log's
  description of zero degradation counters.

This is an evidence discrepancy, not proof of a CE rendering regression:
Tycho's colour system changed between arms too. Correct the adoption summary
and validate the changed geometry with WebGL on a controlled Tycho tree before
claiming unchanged rendering or member counts.

## Fresh check of the broader problem documents

| Target | September 18 source probe success / decline | 0.131.3 release probe success / decline |
| --- | ---: | ---: |
| JavaScript | 309 / 23 | 403 / 19 |
| interval-js | 166 / 25 | 232 / 9 |
| GLSL | 30 / 7 | 26 / 7 |

There are 510 shared input/option groups: **six decline-to-success changes,
all interval-js in `sgtdqnj2ox`, and no success-to-decline changes**. The other
504 shared groups retain their emission and outcome. The six gains correspond
to collection-valued Which arms in consuming positions, implemented after the
previous probe (`bf15bcf3`). No interval declines remain for that document in
this run. This retires the previous recommendation to investigate its eight
List declines; two of the old inputs are absent, so only six are direct matches.

There are 45 old-only and 181 new-only input groups. Most new ones are
`sjjo3qgnfp` (121) and `n7uhaaoq1q` (43). These are population changes, not 181
independent lowering improvements. No enclosure/value validation of all newly
emitted kernels was performed here.

The remaining nine interval declines are Apply (five), Join (two), D (one),
and an unresolved helper (one). The JavaScript sample still includes nine
Multiply declines in `hpr2q4kles`, four terrain Length declines, and the two
`s8ishknvhe` failures. These concentrated witnesses are more useful than
reopening the handoff's historical categories wholesale.

## Recommended order

1. **Project coordinates before constructing and transforming point lists.**
   `woeywky0kj` still emits the same **295,869-character** JavaScript kernel
   (new record 696, same code hash as the previous witness). It constructs
   7,225 two-coordinate points, transforms both coordinates and then keeps x.
   Extend the existing point-accessor rules through proven point arithmetic,
   pool the required immutable coordinate data, and fuse the resulting scalar
   maps. Do not increase the unrolling limit. The earlier manual prototype
   motivates this experiment; its timings were not revalidated here. Measure
   allocation and warm update time on a quiet machine, alongside value parity,
   effects, live-input and mutation controls.

2. **Avoid repeating unsuccessful symbolic integration work.**
   `thpezd39zq` still issues five calls that emit numeric integration after
   symbolic search. The current compiler retains its 2,000 ms per-attempt and
   4,000 ms per-compilation budgets. This run again records roughly two seconds
   per call, but is not a timing regression measurement. Investigate reuse
   across equivalent requests or an explicit numeric-integration policy,
   respecting bindings, assumptions, angular settings and relevant options.
   A timeout is not proof that a closed form does not exist. Keep the existing
   deterministic constant-fold bounds; do not restore its retired wall-clock
   cutoff.

3. **Make the actual `s8ishknvhe` computed-list body compile.**
   Abs and Hsv still decline (new records 146 and 149). The conjugate fixes and
   interpreted sharing are shipped; they do not remove these codegen gates.
   Preserve whole-list helper semantics and trace the remaining type/broadcast
   admission failure. The previous narrow-input probe still matters: declaring
   a list of numeric 3-D points alone did not make the full body compile.

4. **Refresh the all-states baseline before selecting another broad lowering.**
   Pair it with member counts and actual route usage. In particular, determine
   which remaining point/list JavaScript failures affect displayed output and
   whether interval declines affect exclusion work. Then rank cost-sensitive
   unrolling, interval fusion, dynamic GLSL collection access or interval
   differentiation by measured consumer demand.

Constant table pooling, constant-index selection, synthesized-callback CSE and
integrand invariant hoisting remain present in the emitted witnesses. The
derivative is still 17,514 characters, and the small interval Fourier body is
still 751 characters plus 2,673 of constants. Those earlier wins are complete.

No implementation changes were made. A new all-states run and runtime
benchmarks were not launched while another session held the box for its full
test suite. This review establishes targeted emission/outcome changes, not a
whole-corpus performance or rendering certification.
