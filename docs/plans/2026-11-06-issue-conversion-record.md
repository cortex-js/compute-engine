# Conversion of the ROADMAP defect entries to issue files (2026-11-06)

Migration step 2 of `docs/ISSUE_TRACKING.md`. Five agents converted the
entries of `ROADMAP.md` at commit `5784d4aec`, one group of sections each. The
full text of every converted entry is in `ROADMAP.md` at that commit.

| Measure                                              | Value |
| ---------------------------------------------------- | ----- |
| Entries in `ROADMAP.md` before                       | 126   |
| Entries converted to issue files (same number)       | 98    |
| Sub-items that became their own file (new numbers)   | 28    |
| Entries deleted as fixed (no longer reproduce)       | 2     |
| Entries kept in `ROADMAP.md` (capability, task, idea) | 26    |
| Issue files after                                    | 126   |
| `issues/NEXT.md` after                               | 1009  |

Priorities after conversion: 24 P2, 63 P3, 39 P4, no P0 or P1. States: 95
`open`, 21 `needs-design`, 10 `needs-decision`. Fifteen files carry
`needs-review`; every other file has `reviewed: 2026-11-06`, so the first
board list shows only those fifteen, the decisions and the designs.

Every converted file carries the same `CE-<n>` as its entry. Sub-item files
took numbers from a range per agent, so CE-838 to CE-879, CE-885 to CE-919,
CE-924 to CE-959, CE-969 to CE-999 are unused; a number is never reused, so
these stay gaps.

## Deleted as fixed

Both were checked at commit `5784d4aec` on 2026-11-06 and no longer
reproduce:

- **CE-175**: `Sum(j, Limits(i, 5, 5), Limits(j, i, 10))` gives 45, the
  correct value.
- **CE-185**: `\int_0^{1/2} dt/(t \ln t)` gives −∞ under `.N()` and
  `NIntegrate`. Its sub-item .2 still gives a wrong finite value (about
  −99963 ± 32 for an integral that is +∞) with a `crafted` witness; it was not
  filed. Reopen it as an issue with `probability: low` if wanted.

## Converted although they no longer reproduce (`needs-review`, recommend close)

- **CE-770** and **CE-777** (compilation): the programs compile and give the
  expected value today.
- **CE-639**: the recorded `incompatible-type` error no longer happens;
  `.N()` gives 0.3333, `evaluate()` leaves the integral unevaluated.
- **CE-133**: the Range and Interval assumptions now work; the file asks to
  restore the switched-off tests.
- **CE-968** (from CE-206.1): the engine is right and the mpmath reference of
  the test is wrong from the 42nd digit.

## Choices the board can reverse

The agents recorded each choice in the body of the file. The ones that change
a priority:

- **Every compiled-code decline is `minor`** (CE-785, 646, 592, 244, 837,
  249), the interpreter being the workaround. `major` would move the corpus
  items to P2 and the plausible ones to P3.
- **A static type that leaves out a value is `critical`** (CE-836, CE-772,
  CE-72), because compiled code that trusts the type gives a wrong shape.
  `major` would give P3.
- **Performance entries with a measurement were converted** (21 files), most
  as `minor`/`high`, P3. The `regression` flag was applied against the release
  the entry measured (0.156.0, 0.73.0, 0.118.2), not the previous one, on
  CE-689, CE-349 and CE-351, which moves them to P2. Without the flag they are
  P3.
- **`crafted` compiled-code differences were converted** (CE-735, CE-722)
  although `docs/ISSUE_TRACKING.md` sends them to the known-limitations list.
  Close them and add the lines, or keep them at P3/P4.
- **Probability lowered below the corpus default with a reason in the body:**
  CE-131 and CE-141/CE-960 (the Fungrim and benchmark corpora are reference
  sets, not user programs), CE-329 (the JavaScript part is fixed).
- **State set against the `ready` → `open` rule:** CE-531 (`needs-design`, its
  text calls itself a design question), CE-532 (`needs-decision`, the proposed
  API has no recorded approval).
- **Kind and impact where no kind fits exactly:** a wrong form with the same
  value is `error`/`confidence` (CE-293, CE-296, CE-922, CE-881); a symbolic
  leftover where a value is expected is `major` (CE-638, CE-625, CE-781), not
  `critical`.
- **Design and refactor entries converted as `design` issues** that could
  return to `ROADMAP.md` as features: CE-51, CE-71 (both `needs-review`),
  CE-173 (`request`, has a workaround).
- **Recommendations the conversion added** where the entry had none: CE-545,
  CE-682 (option a), CE-960 (a), CE-961 (b), CE-963 (b, conditional on the
  measurement). CE-709 and CE-649 state the options with no recommendation.
- **`open` items whose cause is not traced** and fit `investigate` better:
  CE-249, CE-837, CE-771, CE-783, CE-921, CE-767.

## Kept in `ROADMAP.md`

CE-79, CE-111, CE-123, CE-148, CE-153, CE-158, CE-168, CE-170, CE-186, CE-218,
CE-233, CE-253, CE-264, CE-269, CE-270, CE-272, CE-280, CE-297, CE-311, CE-314,
CE-334, CE-350, CE-568, CE-624, CE-715, and the `Types and type inference` and
`Tests, tools, documentation and release tasks` sections are empty and were
removed. CE-123 (a validation phase, "do it when a third instance appears") and
CE-334 (the measured saving was small) were kept as ideas.
