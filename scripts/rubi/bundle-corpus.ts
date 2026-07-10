// Build-time: bundle the translated corpus into a single ordered JSON the
// shippable loader imports. Uses the same `readCorpusDocs` walk as the
// benchmark's `compileSection`, so the bundled rule priority can't drift
// from the benchmark's.
//
// Scope: all of Chapter 1 (algebraic), Chapter 2 (exponentials), Chapter 3
// (logarithms), and Chapter 6 (hyperbolics) — all fully ported (active heads,
// ~Chapter-1 difficulty; docs/rubi/RUBI.md §5, Phase R3+). Chapter 3 supplies
// the PolyLog-producing log families (∫x^k·Log[a+b·F^{gx}] telescope) that
// Chapter-2 §2.2 reduces into, plus the by-parts log rules (IntHide bindings).
// Also bundled: the full Chapter-4 §4.1 Sine family
// (RUBI.md §5, Phase R4) and §4.5 Secant (RUBI.md §5, Phase R10). The whole
// `4.1 Sine` section is walked (all 21 files compile clean, 0 skips, 918
// rules): the inert-trig bridge (deactivateTrig / unifyInertTrig cofunction
// unification in rubi/rubi-utils.ts) now routes the bare-sine/cosine and
// (a+b sin)^m·… families through these rules, so they are live rather than dead
// compile weight. `4.5 Secant` is likewise walked whole (0 skips): its
// csc-authored reduction rules plus the R10 per-section `sec` cofunctions in
// 4.5.1.1 (mirroring csc #5/#2/#3, branch-safe product form, each verified vs
// wolframscript) close the `(b·sec)^(half-integer)` power families
// (benchmark 4.5 Secant 20 → 31/120 correct, seed 5, 0 genuine wrong). Rubi has
// NO load-time sec-rule generation — it deactivates active `Sec[θ]` to inert
// `csc[π/2+θ]` at integration time and reuses the csc rules; CE keeps inert
// `sec`, so the cofunction rules are supplied per-section (see RUBI.md §5).
// `4.3 Tangent` is walked whole (RUBI.md §5, Phase R12): its tan-authored
// reduction rules are the target of the runtime `cot → −tan[θ+π/2]` cofunction
// shift (default-on since R12; see cofunctionShift in rubi/rubi-utils.ts), the
// tan/cot mirror of the 4.5 sec→csc routing. Append further Chapter-4 sections
// (4.7, …) here as they are verified.
//
// Chapter 6 also relies on driver-level fallbacks (rubi/driver.ts: the
// hyperbolic→exponential expansion and the FunctionOfExponential substitution)
// that ship with the runtime regardless of the bundle; the corpus rules here
// add the rule-driven nonlinear-argument families (ExpandTrigReduce).
import * as fs from 'node:fs';
import type { RubiRuleDoc } from '../../src/compute-engine/rubi/types';
import { readCorpusDocs } from './compile';

const ch1Dir = 'data/rubi/corpus/1 Algebraic functions';
const ch2Dir = 'data/rubi/corpus/2 Exponentials';
const ch3Dir = 'data/rubi/corpus/3 Logarithms';
const ch6Dir = 'data/rubi/corpus/6 Hyperbolic functions';
// Chapter 5 (inverse trig): the arcsin/arctan/arcsec families (5.1/5.3/5.5),
// which also author the ArcCos/ArcCot/ArcCsc cofunction variants inline (no
// runtime cofunction-shift machinery needed — all heads are active native CE
// heads). Walked whole (667 rules, 0 skips). See docs/rubi/RUBI.md §5 Phase R20.
const ch5Dir = 'data/rubi/corpus/5 Inverse trig functions';
// Chapter 7 (inverse hyperbolic): the arsinh/arcosh/artanh/arsech families
// (7.1/7.2/7.3/7.5), which also author the Arcosh/Arcoth/Arcsch co-variants
// inline (no runtime cofunction machinery — all heads are active native CE
// heads). Walked whole (716 rules, 0 skips). Result heads SinhIntegral/
// CoshIntegral now numericize (Shi/Chi kernels); PolyLog/Erfi already do;
// HypergeometricPFQ/Hypergeometric2F1 stay inert (no pFq head). See
// docs/rubi/RUBI.md §5 Phase R21.
const ch7Dir = 'data/rubi/corpus/7 Inverse hyperbolic functions';
const trigSineDir = 'data/rubi/corpus/4 Trig functions/4.1 Sine';
const trigTangentDir = 'data/rubi/corpus/4 Trig functions/4.3 Tangent';
const trigSecantDir = 'data/rubi/corpus/4 Trig functions/4.5 Secant';
// Chapter 8 is a flat directory (each subsection is a single .m/.json file,
// not a subdirectory), so only the PolyLog telescope file (§8.8, closes the
// ∫x^m·PolyLog[n, d·F^{gx}] chain that Ch3 §3.5 reduces into) is bundled here
// — not the rest of Chapter 8. `readCorpusDocs` walks a directory, so a
// single file is read directly, mirroring its doc format.
const ch8PolyLogFile =
  'data/rubi/corpus/8 Special functions/8.8 Polylogarithm function.json';
const out = 'src/compute-engine/rubi/rubi-rules-data.json';

// Strip the `source` (original WL text) field — it is runtime-dead (only the
// dev-time RUBI_DEBUG_FIRE traces use it) and ~22% of the bundle.
const docs = [
  ...readCorpusDocs(ch1Dir),
  ...readCorpusDocs(ch2Dir),
  ...readCorpusDocs(ch3Dir),
  ...readCorpusDocs(ch5Dir),
  ...readCorpusDocs(ch6Dir),
  ...readCorpusDocs(ch7Dir),
  ...readCorpusDocs(trigSineDir),
  ...readCorpusDocs(trigTangentDir),
  ...readCorpusDocs(trigSecantDir),
  JSON.parse(fs.readFileSync(ch8PolyLogFile, 'utf8')) as RubiRuleDoc,
].map((d) => ({
  file: d.file,
  rules: d.rules.map(({ source, ...rest }) => rest),
}));
fs.writeFileSync(out, JSON.stringify(docs));
const rules = docs.reduce((n, d) => n + d.rules.length, 0);
console.log(`wrote ${docs.length} docs / ${rules} rules → ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
