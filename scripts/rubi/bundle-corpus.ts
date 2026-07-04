// Build-time: bundle the translated corpus into a single ordered JSON the
// shippable loader imports. Uses the same `readCorpusDocs` walk as the
// benchmark's `compileSection`, so the bundled rule priority can't drift
// from the benchmark's.
//
// Scope: all of Chapter 1 (algebraic), Chapter 2 (exponentials), and Chapter 6
// (hyperbolics) — all fully ported (active heads, ~Chapter-1 difficulty;
// docs/rubi/RUBI.md §5, Phase R3+) — plus the full Chapter-4 §4.1 Sine family
// (RUBI.md §5, Phase R4). The whole `4.1 Sine` section is walked (all 21 files
// compile clean, 0 skips, 918 rules): the inert-trig bridge (deactivateTrig /
// unifyInertTrig cofunction unification in rubi/rubi-utils.ts) now routes the
// bare-sine/cosine and (a+b sin)^m·… families through these rules, so they are
// live rather than dead compile weight. Append further Chapter-4 sections
// (4.2 Cosine, …) here as they are verified.
//
// Chapter 6 also relies on driver-level fallbacks (rubi/driver.ts: the
// hyperbolic→exponential expansion and the FunctionOfExponential substitution)
// that ship with the runtime regardless of the bundle; the corpus rules here
// add the rule-driven nonlinear-argument families (ExpandTrigReduce).
import * as fs from 'node:fs';
import { readCorpusDocs } from './compile';

const ch1Dir = 'data/rubi/corpus/1 Algebraic functions';
const ch2Dir = 'data/rubi/corpus/2 Exponentials';
const ch6Dir = 'data/rubi/corpus/6 Hyperbolic functions';
const trigSineDir = 'data/rubi/corpus/4 Trig functions/4.1 Sine';
const out = 'src/compute-engine/rubi/rubi-rules-data.json';

// Strip the `source` (original WL text) field — it is runtime-dead (only the
// dev-time RUBI_DEBUG_FIRE traces use it) and ~22% of the bundle.
const docs = [
  ...readCorpusDocs(ch1Dir),
  ...readCorpusDocs(ch2Dir),
  ...readCorpusDocs(ch6Dir),
  ...readCorpusDocs(trigSineDir),
].map((d) => ({
  file: d.file,
  rules: d.rules.map(({ source, ...rest }) => rest),
}));
fs.writeFileSync(out, JSON.stringify(docs));
const rules = docs.reduce((n, d) => n + d.rules.length, 0);
console.log(`wrote ${docs.length} docs / ${rules} rules → ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
