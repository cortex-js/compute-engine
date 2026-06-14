// Build-time: bundle the translated Chapter-1 corpus into a single ordered
// JSON the shippable loader imports. Uses the same `readCorpusDocs` walk as
// the benchmark's `compileSection`, so the bundled rule priority can't drift
// from the benchmark's.
import * as fs from 'node:fs';
import { readCorpusDocs } from './compile';

const corpusDir = 'data/rubi/corpus/1 Algebraic functions';
const out = 'src/compute-engine/rubi/rubi-rules-data.json';
const docs = readCorpusDocs(corpusDir);
fs.writeFileSync(out, JSON.stringify(docs));
const rules = docs.reduce((n, d) => n + d.rules.length, 0);
console.log(`wrote ${docs.length} docs / ${rules} rules → ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
