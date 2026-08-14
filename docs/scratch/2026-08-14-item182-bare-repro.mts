/**
 * Tycho item 182 BARE repro (no Tycho code): the canonicalization-time
 * collection-facet probe storm, in its undeadlined form — an OOM crash.
 *
 * State: fresh source engine + lizeqlnn5e's real `L` (a ~19,000-element
 * literal list) + the document's user functions + `D` assigned the
 * UNEVALUATED lazy comprehension over slices of `L`. Then parsing ONE slot
 * of the C₂ head exhausts a 4 GB heap in ~130 s (measured 2026-08-14);
 * the full three-slot head ran >180 s before an external kill. Under a
 * 5 s `withTimeLimit` the same state degrades to Tycho's ~9.4 s span
 * overrun (their document-open refusal). `Length(D)` itself evaluates in
 * 3 ms and stays symbolic — resolving `D` is NOT the cost; the storm is
 * the uncached facet probes (see the "Tycho item 182" ROADMAP row for the
 * measured mechanism: 210K Range count probes via `checkNumericArgs` →
 * `isFiniteIndexedCollection` and `addType` → `isFixedShapeCollection`).
 *
 * Prereq: /tmp/lizeq-cells.json — regenerate with
 *   cd ../tycho && npx tsx docs/scratch/d21-dump-cells.mts
 * (the Tycho-side dump of the converted document's 17 cell LaTeX strings).
 *
 *   npx tsx docs/scratch/2026-08-14-item182-bare-repro.mts        # OOMs
 *   npx tsx docs/scratch/2026-08-14-item182-bare-repro.mts 5000   # 5 s limit
 */
import { ComputeEngine } from '../../src/compute-engine.ts';
import { readFileSync } from 'node:fs';

const limitMs = Number(process.argv[2] ?? 0);
const cells: string[] = JSON.parse(
  readFileSync('/tmp/lizeq-cells.json', 'utf8')
);
const ce = new ComputeEngine();

for (const [name, lit] of [
  ['P_roj', 'M \\mapsto \\operatorname{PointList}(R(M)[1], R(M)[2])'],
  ['R', 'M \\mapsto R_{xz}(R_{yz}(M-\\bigl\\lbrack0, 0, Y\\bigr\\rbrack))'],
  [
    'R_yz',
    'M \\mapsto \\bigl\\lbrack M[1], M[2]\\cos(a)-M[3]\\sin(a), M[2]\\sin(a)+M[3]\\cos(a)\\bigr\\rbrack',
  ],
  [
    'R_xz',
    'M \\mapsto \\bigl\\lbrack M[1]\\cos(c)-M[3]\\sin(c), M[2], M[1]\\sin(c)+M[3]\\cos(c)\\bigr\\rbrack',
  ],
] as const) {
  try {
    ce.assign(name, ce.parse(lit, { strict: false }));
  } catch {}
}

let t = performance.now();
ce.parse(cells[14], { strict: false }).evaluate(); // L := ⟨19k literal⟩
console.log(`assign L: ${(performance.now() - t).toFixed(0)} ms`);

t = performance.now();
ce.assign('D', ce.parse(cells[2].replace(/^D=/, ''), { strict: false }));
console.log(`assign D (lazy comprehension): ${(performance.now() - t).toFixed(0)} ms`);

// One slot of the C₂ head — enough to OOM without a deadline.
const frag =
  '\\frac{255(0.5+\\frac{1}{60}L[1+3(0..(\\mathrm{Length}(D)-1))])}{255}';
t = performance.now();
let outcome = 'ok';
try {
  if (limitMs > 0)
    ce.withTimeLimit(limitMs, () => ce.parse(frag, { strict: false }));
  else ce.parse(frag, { strict: false });
} catch (e) {
  outcome = String(e).slice(0, 80);
}
console.log(
  `one-slot C_2 fragment parse: ${(performance.now() - t).toFixed(0)} ms  ${outcome}`
);
