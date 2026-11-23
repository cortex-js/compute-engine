# Combinatorics data

Rows and match records for the optional `combinatorics` library
(`@cortex-js/compute-engine/combinatorics`, see `docs/combinatorics/COMBINATORICS.md`).

| Path | Contents |
|---|---|
| `examples/<area>.json` | Example rows: `id`, `head`, `input` (MathJSON), `expected` (or `unevaluated: true` for an element outside the domain) and `source`. Read by `test/compute-engine/combinatorics/examples.test.ts`. |
| `findstat/matches.json` | Which FindStat statistic each head equals, by value. Generated. |
| `findstat/values/<id>.json` | FindStat's values for that statistic on every object up to a size. See `findstat/README.md`. |
| `MANIFEST.json` | Counts. Generated. |

Elements are the engine's own lists: a permutation is its one-line list, an
integer partition a list of non-increasing parts.

`npx tsx scripts/combinatorics/generate.ts` writes the generated files (the
`compiled.ts` of the library included); `--check` (the `corpus-pipeline` CI
step) fails when they are stale or the rows are invalid, and takes seconds.
`--values` also evaluates every head on every FindStat fixture object and fails
on a difference, so a match record is a measurement; it takes about half an hour.
A statistic without a FindStat identifier has no record and no fixture.
