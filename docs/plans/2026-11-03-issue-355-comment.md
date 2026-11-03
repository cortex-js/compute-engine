A follow-up on this proposal: in the language release, the exact `Indeterminate` value and the floating-point `NaN` merge back into one value, `NaN`.

**What changes.** The exact route now answers `NaN` for a form with no value, as `.N()` and every compiled target already did: `0/0`, `∞ − ∞`, `0^0`, `Mod(5, 0)` and the variance of one datum are `NaN`. The marker no longer propagates exactly: `Mean([1, 0/0])` and `Max(1, 0/0)` are `NaN`. `isIndeterminate` is removed; `isNaN` is true for the one value.

**What does not change.** The spellings still parse: `"Indeterminate"` in MathJSON, `\operatorname{Indeterminate}` in LaTeX and `Indeterminate` in Epsil all give `NaN`, so no stored document breaks. The serializer writes `NaN` (`\operatorname{NaN}` in LaTeX). A cross-check that maps both values to Wolfram's `Indeterminate`, as you described, gives the same result as before.

**Why.** The release narrows the language to one static error (an `Error` expression) and one dynamic no-value per domain (`NaN` for a number). The second marker had to be carried by hand through every exact producer, the folds of `Sum` and `Product`, the reducers and the statistics, and a final map under `.N()`: about 380 mentions in about 60 source files. No user of the engine that we know of reads the difference between the two values, and you map both to one value. We considered a flag for "exact" on the one `NaN` and did not take it, for the reason the original design gave: an exact value keeps forms inert, so the flag would bring back the same propagation rules.

Thank you again for the report: it made us state which forms have no value, and that list stays, now with `NaN` as the answer.
