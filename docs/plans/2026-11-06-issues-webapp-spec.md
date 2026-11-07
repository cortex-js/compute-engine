# The issues web app: specification

The Bug Review Board (the user) reviews issues in a browser, not in a terminal
table. The terminal lists of `scripts/issues.mjs` are not readable at the
width of a board review, and the one edit the script cannot make, writing the
board's decision into the body, is the most frequent one. This page describes
the app that replaces the lists for the board. Agents keep using the script.

## What it is

`node scripts/issues-ui.mjs` starts a local server (Node, no dependency, the
`node:http` module) and prints its address; `--open` opens it in the browser.
It reads `issues/` of the main worktree on every request, so an edit by an
agent or a `git pull` shows at the next refresh, and it writes through the
same code as the script, so the files stay valid: the server imports the
functions of `scripts/issues.mjs` (which exports them when imported, and runs
its command line only when executed), or shells out to the script. Every
write runs `lint` on the file and shows the error in the page when it fails.

The page is one HTML file with inline CSS and JavaScript, served by the
script, no build step and no framework. Phone width is not needed; the page is
read on a laptop screen.

## Views

Three views, a tab bar at the top, the counts in the tab labels.

**Board** (the default). The sections of `issues.mjs board`, in the same
order, each a list of cards, not a table. A card shows, in this order:

1. The id, the priority as a colored badge (P0 red, P1 orange, P2 yellow, P3
   grey, P4 light grey), the state, the size, the source with its reference,
   the flags as small tags.
2. The first body line, in large text.
3. The `ask` line, in bold, when there is one.
4. A row of controls (below).
5. A "details" toggle that opens the rest of the body, rendered as Markdown
   (code blocks kept monospace), with the table value of the priority next to
   the recorded one.

**Backlog.** The two lists of `issues.mjs backlog` (release scope, pool) and
the P4 count, as the same cards, with a text filter on id, title and source.

**All.** Every file, sorted by id, same cards, same filter, plus the closed
log (`issues/CLOSED.md`) rendered at the bottom.

## Controls on a card

Every control writes at once, with no save button, and the card redraws from
the file after the write:

- **Priority**: a menu P0 to P4. Writes `priority`, and `reviewed: today`.
  Choosing P0 sets `needs-review` unless the board also confirms it.
- **State**: a menu with the states, except `in-progress` (the script refuses
  it; `start` is an agent action). Choosing `close` opens a one-line field for
  `close-reason` and refuses an empty one. Choosing a state away from
  `in-progress` clears owner and start date, as the script does.
- **Flags**: a toggle per flag (`needs-review`, `regression`, `blocker`,
  `workaround`). `needs-review` off also writes `reviewed: today`.
- **Confirm P0**: a button shown on a P0 with `needs-review`; writes
  `confirmed: today`, which removes the flag.
- **Release**: a text field with the versions already in use as suggestions.
- **Ask**: an editable one-line field.
- **Decision**: a text area and a button "Record decision". The button appends
  a `## Decision` section to the body (or a new paragraph to an existing one)
  with `User decision <today>: <text>`, sets `reviewed: today`, and removes
  `needs-review`. This is the edit the script does not make, and the reason
  the page exists.
- **Reviewed**: a button "Mark reviewed" (writes `reviewed: today`), shown
  when the item has no `reviewed` date or has `needs-review`.
- **Close all**: one button at the top of the Board view, enabled when at
  least one item has `state: close`, which runs `close --all` after a
  confirmation line that lists the ids.

A write that changes the body must preserve the header, the comments after
two spaces and `#`, and the other sections; the server reads the file, changes
the one field or section, and writes it back, then runs the lint on it.

## What the server does not do

- No git command: the user stages and commits, as `docs/ISSUE_TRACKING.md`
  says. The page shows a line "N files changed since HEAD" from
  `git status --short issues/` (a read-only command the script may run) so the
  board knows when to commit.
- No `start`, no `new` (agents' actions), no edit of `NEXT.md`.
- No authentication: it binds to 127.0.0.1 only.
- No dashboard of counts over time; the counts in the tab labels are enough.

## Size and checks

About one session. Deliverables: `scripts/issues-ui.mjs`, the export change in
`scripts/issues.mjs` (the command line still works unchanged, checked by the
existing fixture tests in the scratchpad of the session that writes it), a
section "The web app" in `docs/ISSUE_TRACKING.md` with the command, and a
screenshot in the report. Check with a fixture directory (`--dir`) that each
control writes the field the script would write, that the lint passes after
every control, and that a write to a file with a header comment keeps the
comment. Review: one Opus reviewer round on the server's file writes.

## Continuation prompt

"Build the issues web app from `docs/plans/2026-11-06-issues-webapp-spec.md`.
Read `docs/ISSUE_TRACKING.md` and `scripts/issues.mjs` first. The files in
`issues/` are real; test on a copy in your scratchpad with `--dir`. Stage with
the staging helper when done, do not commit."
