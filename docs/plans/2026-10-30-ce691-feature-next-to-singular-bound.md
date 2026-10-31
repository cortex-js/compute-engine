# CE-691: a step or a bump next to a singular bound (spec)

Status: implemented 2026-10-30, option A (user decision 2026-10-30). Code:
`src/compute-engine/numerics/endpoint-quadrature.ts` (`featureNearEndpoint`,
`cornerModelArea`). Changes after the dual reviews of this spec and of the
code:

- Change 2 takes the larger of the two areas (with and without the noisy
  windows) and does not change the model that `lastPanelGap` and
  `lastPanelHoldsFeature` read, so no error becomes smaller.
- The samples go past each end of the tested range. At the outer end, when
  the corner panel leaves no room, the outer octave is not tested (CE-697): a
  noise level from one side refused smooth integrands.
- A sample of 0 in the tested range, a sample that is not finite farther than
  the last accurate shell, and a sample whose sign is not the sign of the
  shells stop the extrapolation.
- A refused extrapolation keeps its correction and its error in the
  uncertainty of the Gauss–Kronrod result.
- Not done, recorded: ROADMAP CE-695, CE-696, CE-697.
Measurements: the scripts in `docs/scratch/2026-10-30-ce691-quadrature/`.

## The defect

`adaptiveQuadrature(f, c − 0.3, c, { singularEndpoints: true })` for
`f = (c − x)^(−1/2)` plus a step or a bump at the distance `d` from `c`
reports an error smaller than the true error in 187 of the 900 sweep cases
(`sweep.mts`). Three mechanisms, found by reading the corner series of each
case:

1. **Feature nearer than the last accurate shell (132 cases).** The
   extrapolation reads the shells down to `D = width/2^n`, about `2²⁰`
   spacings of the doubles at `c` (`accurateShells()`). The value nearer than
   `D` is a model of a singularity AT `c`. Example: a step of height 1 at
   `d = 1.27e-10` from `c = 0.3` is in shell 27, the first inaccurate one;
   shells 28 and after are not wide, so `featureAfterShells` does not look at
   them. Today: `± 1.4e-13`, true error `1.3e-10`.
2. **Small feature inside the accurate shells (48 cases).** The shell that
   holds the step passes `SHELL_RELATIVE_ERROR`, and the ε-algorithm reads a
   series that is not geometric there. Example: step `1e-4` at
   `d = 2.59e-7` from 0.7: today `± 2.5e-12`, true error `2.6e-11`.
3. **One-double last panel (7 cases, all at `c = 0.3`).** These results are
   not extrapolated. The last corner panel is one double wide: its value is
   `f(c − u)·u = 7.45e-9` with an error 0, and its true area is `1.49e-8`.
   The bound of the tanh-sinh loss, `cornerModelArea()`, reads the model from
   the deepest shells, 2 to 16 doubles wide, whose values have errors of 5 to
   9 %: their ratios fall (`0.745, 0.721, 0.56`), and the model ratio `0.567`
   gives `4.7e-9` instead of about `2e-8`. Today: `± 4.7e-9`, true error
   `1.08e-8`.

## The proposal

**Change 1: read the integrand next to the bound before an extrapolation is
used.** After `extrapolateCorner()` succeeds, sample `|f|` at 4 points per
octave of the distance `t` from the bound, from the outer edge of the last 21
accurate shells (the shells that the ε-algorithm reads) down to the larger of
`64` spacings and `D/2²⁰`. Each sample is at a double; `t` is its exact
distance. The local exponent `e_i = ln(|f_{i+1}|/|f_i|)/ln(t_i/t_{i+1})` of a
singularity `t^(−p)·h(t)` changes smoothly with `i` (a constant for a power,
`p + O(1/ln t)` for a logarithmic factor, `p + O(t)` for a smooth factor). A
step between two samples changes one `e_i`; a bump changes two. The test reads
the fourth difference `Δ⁴e_i` and compares it with the median of `|Δ⁴e|` on
each side (8 values, the 5 values that the point changes left out). A point
whose `|Δ⁴e_i|` is more than `100` times the larger median (plus `1e-13`) is a
feature. Not run when the accurate shells change sign (an oscillation such as
`cos(ln t)/t^0.999`: its exponents have poles at the zeros of `cos`). On a
feature, the corner is not extrapolated: the same decision as
`featureAfterShells` today, so the result is the Gauss–Kronrod or tanh-sinh
value with its widened error.

The median of each side is the local noise of `f`. A noise estimate from the
neighboring doubles of a sample does not work: for `1/√(1 − x²)` near 1,
`x²` moves by an exact step between neighbors, and the rounding error of
`1 − x²` (`e_i` noise `2e-9`) is the same for neighbors. One median over a
window of both sides did not work either: in Tycho row 422 (interpreted
`y^(−1/2)·e^(−y/2)`), the samples farther than `3e-11` from the bound jitter by
`2e-6` and the nearer ones do not, and at the border the median came from the
clean side.

**Change 2: a window of 4 shells in `cornerModel()` with a noisy shell gives no
model.** A window is skipped (the search goes to wider shells) when a shell in
it has a QUADPACK error above `UNCOUNTED_RATIO_SPREAD/4` of its value: the
ratios of such shells are not more accurate than the spread test. The rule
"ratios that fall below 1/2 give no model" (a zero of the integrand next to
the bound) is kept for a noisy window: for `(x − e)^(−0.9)·(x − e − 10⁻⁷)` at
`e = 10⁹` the deepest shells are noisy and their ratios fall below 1/2, and
going past them gave a model that was wrong (`± 1.1e-7` for a true error of
`1.9e-7`).

## Measurements (prototype, `K = 100`)

| Corpus                                             | Today                 | Proposal                                                                     |
| -------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `sweep.mts` (900)                                  | 187 uncovered         | 0 uncovered, 0 newly uncovered                                               |
| sweep with heights `1e-6`, `1e-8` (600)            | 2 uncovered           | 1 uncovered (`1.93e-13` for `± 1.57e-13`), 0 newly uncovered                 |
| `cancel.mts` (80)                                  | covered 80            | covered 80                                                                   |
| clean `t^(−p)·h(t)`, 7 endpoints × 5 `p` × 6 `h` × 2 sides (420) | 250 extrapolated | 250 extrapolated, 0 converged lost; 56 errors change (Change 2), 0 uncovered of the 140 with a known value |
| 14 quadrature test files (828 tests)               | pass                  | pass                                                                         |
| evaluations, 32 clean integrals                    | 129,665               | 132,148 (+1.9 %; at most about 164 per corner)                               |

The factors `K = 20, 100, 1000` gave the same counts in every corpus above.

## The trade-off

Which results stop being extrapolated: in the sweep, 402 of the 420
extrapolated results (every feature inside the window is found), 222 of them
correct today. For those 222 the error grows from about `1e-13` to `1e-8`
(median per endpoint: `4.2e-12 → 1e-8` at 0.3, `1.9e-13 → 6e-8` at 0.7,
`4.5e-11 → 1.9e-6` at 1000.5), and the value is the Gauss–Kronrod value, with
true errors of the same order. No clean integrand loses its extrapolation.

Option B (measured, not proposed): when the feature is nearer than `D`, keep
the extrapolation and add `2·max|Σ (shell − model)|` plus a rounding term over
the narrow shells down to `2¹⁶` spacings (the model is the geometric
continuation of the last accurate shells, with the drift of their ratio).
Refuse only for a feature inside the accurate shells. Sweep: 1 uncovered, 195
results stop being extrapolated, and 207 keep their value with a median error
of `5e-10` (today `3.4e-13`, true `3.9e-12`). It keeps a more accurate value,
but its errors are of a similar size, and it adds a second model with its own
constants. Recommendation: A, the simple version. B is a later task if a user
needs the value of such integrals to more than about 8 digits.

If nothing is decided: the 187 wrong error bars stay.

## Hard cases

- Endpoint 0: no narrow region (the doubles are dense near 0), but a small
  feature inside the accurate shells is read the same way.
- Integrands with rounding noise (`cancel.mts`, `1/√(1 − x²)` near 1): the
  medians follow the noise, so the test does not fire. A feature smaller than
  100 times the noise is not found.
- A pole a few doubles outside the bound: its exponents change smoothly over
  about 2 octaves, and `offsetSingularity()` still adds its error.
- A bump narrower than a quarter of an octave of `t` can fall between two
  samples; the Gauss–Kronrod nodes can miss it too.
