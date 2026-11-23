# FindStat

[FindStat](https://www.findstat.org), the combinatorial statistic finder, is
how the statistics of this library are identified: a statistic is held equal,
value by value, to a FindStat statistic.

## What is committed

- `matches.json`: our head, our domain type, and the FindStat identifier
  (`St000004`) with the collection name. These are identifiers and our own
  records of the comparison (how many objects, up to which size). No FindStat
  title, description, code, reference or generating function is copied.
- `values/<id>.json`: for each matched statistic, FindStat's published values
  on the objects up to a small size (permutations of length at most 5,
  partitions of at most 6, fewer for a few slow statistics). The file is a test fixture: the tests assert that
  our value equals FindStat's on every object. The values are mathematical
  facts (the value of a statistic on an object), credited to FindStat.

## Regenerating

`scripts/combinatorics/extract-findstat-values.ts` copies a fixture from a
local crawl of FindStat's published JSON. FindStat asks crawlers to wait a long
time between requests; do not crawl for a handful of statistics when a
maintainer can be asked for the values.

Cite FindStat as requested at <https://www.findstat.org/Citations>.
