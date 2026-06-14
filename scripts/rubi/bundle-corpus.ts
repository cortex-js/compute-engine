// Build-time: bundle the translated Chapter-1 corpus into a single ordered
// JSON the shippable loader imports. Uses the same `readCorpusDocs` walk as
// the benchmark's `compileSection`, so the bundled rule priority can't drift
// from the benchmark's.
import * as fs from 'node:fs';
import { readCorpusDocs } from './compile';

const corpusDir = 'data/rubi/corpus/1 Algebraic functions';
const out = 'src/compute-engine/rubi/rubi-rules-data.json';
// Strip the `source` (original WL text) field — it is runtime-dead (only the
// dev-time RUBI_DEBUG_FIRE traces use it) and ~22% of the bundle.
const docs = readCorpusDocs(corpusDir).map((d) => ({
  file: d.file,
  rules: d.rules.map(({ source, ...rest }) => rest),
}));
fs.writeFileSync(out, JSON.stringify(docs));
const rules = docs.reduce((n, d) => n + d.rules.length, 0);
console.log(`wrote ${docs.length} docs / ${rules} rules → ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
