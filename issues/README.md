# Issues

One file per open issue, `CE-<n>.md`. The process, the fields and the priority
table are in `docs/ISSUE_TRACKING.md`. `node scripts/issues.mjs` lints the
files, prints the lists and creates a new file (`new`). `NEXT.md` holds the next
free `CE-<n>` number, shared with `ROADMAP.md`; `new` takes it and increases it.
