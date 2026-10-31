# CE-695: the area next to a bound when the corner shells decrease like a power (spec)

Status: implemented 2026-10-31 (approved by the user 2026-10-31). Code:
`src/compute-engine/numerics/endpoint-quadrature.ts` (`cornerModelArea()`,
`powerCornerArea()`, `POWER_MODEL_MIN_SHELLS`, `POWER_MODEL_RESIDUAL`). Tests:
`test/compute-engine/quadrature-power-corner.test.ts`. Measured against
commit `2bc8daf560a0f4fe722044008afed980f01260b8`. Scripts:
`docs/scratch/2026-10-30-ce691-quadrature/` (`clean-power.mts` is new). The
dual review of this spec (`docs/scratch/2026-10-31-ce695-power-corner-area_SPEC_REVIEW.md`)
changed these points:

- A power area is capped so that `UNCOUNTED_SAFETY` times it is at most
  `POWER_AREA_LIMIT = Number.MAX_VALUE / 16` (a tail that overflows is
  capped too). An error of `+∞` takes away `singularCorner`, and a caller
  can then use Monte Carlo; the cap keeps the sums of the bounds finite. (The
  first version gave 0 for such an area; the code review, round 3, asked for
  the cap, which keeps the largest bound the sums can hold.)
- The run needs 8 shells, not 12, and a fit range of fewer than 4 shells is
  not fitted. With these, all the cases of `clean-power.mts` and the
  logarithmic exponents 1.02 and 1.05 are covered.
- The residual limit is a new constant, `POWER_MODEL_RESIDUAL = 2e-3`: with
  8 shells the largest residual of a power corner is `8.1e-4`, close to the
  `1e-3` of `SHELL_MODEL_RESIDUAL`.

## The defect, by cause

`sweep-zero.mts` (162 cases) has 81 results whose error is smaller than the
true error; 65 of them are not extrapolated. The return route of
`resolveCorners()` was recorded for each of the 65. They have three causes:

1. **33 cases: the geometric model of the left-out area (this change).**
   `1/(x·ln²x)` plus a step or a bump. The integrand overflows at the nodes of
   the last corner panel `[0, 5e-324]`, so the adaptive quadrature leaves that
   panel out, and `uncountedArea()` bounds its area with `cornerModelArea()`:
   2 times the tail of a geometric series fitted to 4 deep shells. The shells
   of a logarithmic corner decrease like `1/kᵅ` (`α = 2` here). For such
   shells, the geometric tail is about `(α − 1)/α` of the true tail, so the
   factor 2 is not sufficient: `± 1.28e-3` for a true error of `1.38e-3`. The
   extrapolation is refused (`featureAfterShells`), with `spread: 0`, and
   tanh-sinh does not run (`shellsHaveOneSign` reads the overflowed shells).
   So nothing else covers the tail.
2. **7 cases: a false divergence (not this change, ROADMAP CE-701).** A step
   of area `1e-6` at `1e-80` to `1e-300` from 0 on `1/(x·(−ln x)³)`, or at
   `1e-300` on `1/(x·ln²x)`: the result is `divergent: true`. The integral
   has a value.
3. **25 cases: the converged route (not this change, ROADMAP CE-702).**
   `x^(−1/2)·(−ln x)`: the Gauss–Kronrod result converged, and tanh-sinh
   agreed with it or did not converge. A feature at `1e-40` or nearer is
   inside the last corner panel, which no sample reaches (the true error is
   the whole area of the feature). Nearer features are partly seen, and the
   error is up to 100 times too small.

The new corpus `clean-power.mts` (140 cases, `u^(−1)·(−ln u)^(−q)` with no
feature, `q` from 1.1 to 4, at 7 endpoints) has 21 results with an error that
is too small, at the endpoints 1, 1000.5 and `10⁶`. Example: `10⁶`, `q = 1.1`:
`± 1.24` for a true error of `7.32`. The mechanism is cause 1. At 1 and 1000.5
the extrapolation is refused because rounding noise makes a shell inaccurate
(as in CE-690). At `10⁶` only 6 shells pass the test of `accurateShells()`.

## The design

`cornerModelArea(corner, δ, fallback)` returns the largest of its two
geometric areas (as before) and `UNCOUNTED_SAFETY` times
`powerCornerArea(corner, δ)`. The power term does not read `fallback`.
`powerCornerArea`:

1. A shell `k` (its index in `corner.shells`) is usable when it is finite, not
   zero, at least `UNCOUNTED_MODEL_SPACINGS` spacings wide, and its QUADPACK
   relative error is at most `MODEL_SHELL_RELATIVE_ERROR` (`2.5e-3`, the noise
   level that `cornerModel()` reads). The run is found from the deepest shell:
   skip the shells that are not usable, then extend toward the interior while
   the shells are usable and have the sign of the deepest one. The first such
   run of at least `POWER_MODEL_MIN_SHELLS` (8) shells is used, from `first`
   to `last`. With no such run, the area is 0.
2. `β = max(1, −log₂(width))`, as in `extrapolateCorner()`. The run must pass
   `shellsDecayAsPower(run, β + first)`.
3. With `n = last − first + 1`, `half = first + ⌊n/2⌋` and `quarter = ⌊n/4⌋`,
   the ranges (half-open) are `[half, last + 1)`, `[last + 1 − quarter, last + 1)`
   and `[half, last + 1 − quarter)`. A range of fewer than 4 shells is not
   fitted (a power fits 2 or 3 shells with no residual). Each other range is
   fitted with `fitShellModel(…, 'power')` (`y = k + β + ½`). A fit with a
   residual above `POWER_MODEL_RESIDUAL` (`2e-3`) or `q ≥ −1` makes the area
   0. `q ≥ −1` gives 0, not `+∞`: shells of a convergent integral that fit
   such a power are not a power (`x^(−0.99)·(1 + 100u)` next to `10⁶` fits
   `q = −0.135`).
4. The area is the largest `modelTail()` of the fits from the depth
   `β + log₂(width) − log₂(δ)` (a difference of logarithms: `width/δ`
   overflows for a denormal `δ`). It is capped at
   `POWER_AREA_LIMIT / UNCOUNTED_SAFETY`.

The code review also changed `shellDecayExponent()`: it compares the signs of
the two shells, not their product, which underflows to 0 for small shells
(`1e-200`). This also changes the test for `extrapolateCorner()`. Measured: 72
integrals `x^(−p)·h(x)` next to 0 (`p` from 0 to 0.33, three factors, three
widths) give the same results as at `2bc8daf56`, and so do the five corpora.

The area only grows, and the routes of `resolveCorners()` read only whether
`uncountedArea()` is 0, which does not change. `lastPanelGap()` and
`lastPanelHoldsFeature()` read `cornerModel()` and do not change.

Measured residuals: power corners of `clean-power.mts` at most `8.1e-4`
(next to 0.7, `q = 1.1`). Shells that are not a power: `2.8e-2` to `4.0e-2`
(the shells after a step at 1000.5 in `sweep.mts`), `1.7e-2`
(`x^(−0.9)·(1 + 100u)` at `10⁶`), `3.5e-3` (`x^(−0.99)·(1 + 100u)` at 1000.5).

## Measured (final code against `2bc8daf56`)

| Corpus                  | Result |
| ----------------------- | ------ |
| `sweep-zero.mts` (162)  | 0 newly uncovered, 33 newly covered, 48 still uncovered (16 CE-696, 7 CE-701, 25 CE-702). 64 errors larger: the new error is 1.56 to 2.10 times the old one, and at most 2.0 times the true error. No extrapolation changed (the script does not record convergence). |
| `sweep.mts` (900)       | no error changed, 0 uncovered |
| `cancel.mts` (80)       | `covered 80` |
| `clean.mts` (420)       | no error changed, no extrapolation or convergence lost |
| `clean-power.mts` (140) | 0 newly uncovered, 21 newly covered, 0 still uncovered. 72 errors larger, no extrapolation or convergence lost. The largest error is 13.7 times the true error (`3.7`, `q = 4`, width `1e-3`), and it was 13 times before. |

Also measured: `q` = 1.02 and 1.05 at 0, 0.3, 1000.5 and `10⁶` (widths 0.25
and `1e-3`) are all covered (6 were not). `1/(x·(−ln x)·ln²(−ln x))` on
`[0, 0.01]` and `1/(t·(ln 1000 − ln t)^1.1)` on `[0, ½]` were covered before
and after. The 16 test files of the quadrature (844 tests, 5 new) pass.

## Options not chosen

- **A: when `featureAfterShells` refuses the extrapolation, keep the model of
  the missing tail in `spread`** (the `missing` term of `modelled()` in
  `extrapolateCorner()`). It covers the 33 cases and the refusals at 1 and
  1000.5. It does not cover `10⁶`, where `extrapolateCorner()` returns
  `spread: 0` because there are fewer than 12 accurate shells. It counts the
  same tail twice with `uncountedArea()` (about 4 times the true error), and
  the tanh-sinh bound still uses the geometric model.
- **B: increase `UNCOUNTED_SAFETY`.** Every corner, also the geometric
  corners, gets a larger error. A logarithmic corner with `α` near 1 needs an
  unbounded factor.
- **C: `shellsHaveOneSign()` reads only the finite shells** (as `oneSign` in
  `resolveCorners()` does). Then these results go to tanh-sinh, which can
  return a value with a smaller error. This changes the route of results, and
  it is not necessary for the coverage. It is a separate item (ROADMAP CE-703).

## What stays open

CE-701 (false divergence) and CE-703 (tanh-sinh not tried) are defects in
older code with other causes; they are the next tasks after this change is
staged. CE-702 needs a decision of the user on the cost of sampling every
octave next to the bound (about 4300 evaluations next to 0).
