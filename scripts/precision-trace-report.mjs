// Summarizes the reads of `BigDecimal.precision` that
// `precision-trace-setup.ts` recorded (see its header).
//
//   node scripts/precision-trace-report.mjs <dir> [path-prefix...]
//
// Prints the number of reads per call site, `site <- caller`, keeping only
// the sites under one of the prefixes when some are given (`src/`), then the
// number of call sites per file.
import * as fs from 'node:fs';
import * as path from 'node:path';

const [dir, ...prefixes] = process.argv.slice(2);
const sites = new Map();
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.jsonl')) continue;
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    const { reads } = JSON.parse(line);
    for (const [site, n] of Object.entries(reads))
      sites.set(site, (sites.get(site) ?? 0) + n);
  }
}
const keep = (s) => prefixes.length === 0 || prefixes.some((p) => s.startsWith(p));
const rows = [...sites].filter(([s]) => keep(s)).sort((a, b) => b[1] - a[1]);
for (const [s, n] of rows) console.log(String(n).padStart(10), s);
const byFile = new Map();
for (const [s, n] of rows) {
  const file = s.split(' <- ')[0].replace(/:\d+$/, '');
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}
console.log('\ncall sites by file:');
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]))
  console.log(String(n).padStart(6), f);
