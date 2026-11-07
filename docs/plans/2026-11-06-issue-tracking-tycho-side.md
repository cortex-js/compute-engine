# Issue tracking, the Tycho side: text for migration step 3 of `docs/ISSUE_TRACKING.md`

To be applied by the user or a Tycho session in `~/dev/tycho/docs/COMPUTE_ENGINE.md`
(and the Tycho agent instructions). Nothing in this draft was written to the
Tycho repository.

## 1. Replace the "INSTRUCTIONS FOR THE CE TEAM" section with

### Requests to CE

A request to CE (a defect, a wrong value, a hang, a performance problem, a
documentation error, a design question) is a file in the Compute Engine
repository, `compute-engine/issues/CE-<n>.md`, written as
`compute-engine/docs/ISSUE_TRACKING.md` says. Tycho sessions may edit that
directory directly, and run no git command in that repository; the CE sessions
stage and commit it. This file no longer holds open requests; the sections
below are our integration reference.

How a Tycho session files a request:

1. Reproduce it against the INSTALLED bundle (the version read off its
   `package.json`), fresh engine per shape, every negative paired with a
   positive control, as "INSTRUCTIONS FOR THE TYCHO TEAM" says. Write the
   instrument in `scripts/repros/` and name it `<date>-ce<NNN>-<topic>.mts`,
   where `<NNN>` is the issue number.
2. Take the number from `compute-engine/issues/NEXT.md` and increase it in the
   same step. Search `compute-engine/issues/` and
   `compute-engine/issues/CLOSED.md` first: a match is a decided item, and a
   re-report adds a line to the match only with new evidence.
3. Write the file with `source: tycho`, `source-ref: Tycho <document, row or
   ROADMAP id>`, `instrument: <Tycho path>`, the `impact` from the table of
   `ISSUE_TRACKING.md`, the `probability` from the share of Tycho users the
   issue reaches (`high`: a shipped document or a basic feature; `medium`: a
   non-default setting or an unusual value; `low`: a contrived case), and the
   flags `blocker` (it stops a Tycho ROADMAP item or an adoption) and
   `workaround` (Tycho has a way around it) as they apply. The first body line
   says what the Tycho user sees. A design ask is `state: needs-design`.
4. Set `priority` to the table value. Set `needs-review` only for a proposed P0
   or P1.

What CE does: within one day, a CE session writes in the body the priority it
confirms or proposes, the disposition (this release, next release, close,
needs-decision) and the workaround when one exists, as
`CE (<date>): …` in a `## CE answer` section, which the 150-word cap of the body leaves out. The fix follows the priority, not the source. When the
fix is committed, CE sets `state: fixed` and `release: <version>`; the file
stays until Tycho verifies.

What Tycho does at adoption: for every `state: fixed` file with the adopted
release, run the instrument against the installed bundle on the production
route. Verified: delete the file (CE commits the deletion) and write the
reading in the adoption commit message and in `COMPUTE_ENGINE_LOG.md`. Not
verified: set `state: open`, add the reading to the body, and tell CE the same
day.

Citations of CE files keep the `compute-engine/` prefix (Tycho's
`npm run lint:doc-paths` reads a bare `docs/` path as a Tycho file).

## 2. In "The Ledger Protocol", replace rules 2 and 5

2. **VERIFIED ⇒ DELETE THE FILE** in `compute-engine/issues/`. No closed
   markers. Evidence goes to the log and the commit message; mechanism facts
   future code depends on go to the relevant source docstring.

5. Until 1 to 4 hold for every `fixed` file of the release, the status is
   "0.x.y installed, adoption IN FLIGHT, N items owed". Take the issue number
   from `compute-engine/issues/NEXT.md` just before you write the file, and give
   the instrument that number in the same step.

## 3. Move "Per-adoption checklist" to `COMPUTE_ENGINE_CHECKLIST.md`

The section "Per-adoption checklist — what every CE bump must re-run" (about
240 lines) and the "Baseline" heading move to `docs/COMPUTE_ENGINE_CHECKLIST.md`.
`COMPUTE_ENGINE.md` keeps a one-line pointer.

## 4. Convert the open rows

Rows 463, 506 and 509 become `compute-engine/issues/CE-<n>.md` files with the
next free numbers (the row number goes in `source-ref`, and the instrument
keeps its current name). Row 463 is `state: needs-design`. The "Open Requests
for CE Maintainers" section is then deleted; its "Public replacements for CE
internals" census and the standing rulings move to the reference part of the
file.

## 5. Tycho agent instructions

Add: "Tycho sessions may edit `compute-engine/issues/` directly, as
`compute-engine/docs/ISSUE_TRACKING.md` says; run no git command in that
repository, and list each file you wrote in the report."
