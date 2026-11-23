// One-off collector (not run in CI): copies FindStat's values for the
// statistics of the match table, up to a size, from a local crawl of
// FindStat's published statistic JSON, into data/combinatorics/findstat/values/.
//
//   node scripts/combinatorics/extract-findstat-values.ts --crawl <dir> St000004 St000147
//
// `<dir>` holds `StatisticsDatabase/<id>.json`. Fetch each statistic page
// politely (FindStat asks for a long delay between requests) and do not
// re-crawl what a crawl already holds.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  options: {
    crawl: { type: 'string' },
    through: { type: 'string', default: '5' },
  },
  allowPositionals: true,
});
if (!values.crawl || positionals.length === 0) {
  console.error(
    'usage: extract-findstat-values.ts --crawl <dir> [--through 5] <St id>...'
  );
  process.exit(2);
}
const through = Number(values.through);
const outDir = new URL(
  '../../data/combinatorics/findstat/values/',
  import.meta.url
);

/** Size of an object by FindStat's collection: a permutation's length, a partition's sum. */
const SIZE: Record<string, (parts: number[]) => number> = {
  'Permutations': (p) => p.length,
  'Integer partitions': (p) => p.reduce((a, b) => a + b, 0),
};

for (const id of positionals) {
  const stat = JSON.parse(
    readFileSync(join(values.crawl, 'StatisticsDatabase', `${id}.json`), 'utf8')
  );
  const size = SIZE[stat.StatisticCollection];
  if (!size)
    throw new Error(`${id}: no size rule for ${stat.StatisticCollection}`);
  const rows: [string, number][] = Object.entries<number>(
    stat.StatisticData
  ).filter(([key]) => {
    const parts = key === '[]' ? [] : key.slice(1, -1).split(',').map(Number);
    return size(parts) <= through;
  });
  const lines = rows.map(
    ([key, value]) => `    ${JSON.stringify(key)}: ${value}`
  );
  writeFileSync(
    new URL(`${id}.json`, outDir),
    `{\n  "findstat": "${id}",\n  "collection": ${JSON.stringify(stat.StatisticCollection)},\n  "through": ${through},\n  "source": "https://www.findstat.org/${id}",\n  "values": {\n${lines.join(',\n')}\n  }\n}\n`
  );
  console.log(id, rows.length);
}
