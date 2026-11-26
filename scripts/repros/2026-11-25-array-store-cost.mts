/**
 * Mutable arrays, acceptance case 7 (`docs/plans/2026-11-25-mutable-arrays-spec.md`,
 * section 18): an interpreted store to an array of 1,000,000 cells takes the
 * time of a store to an array of 100 cells within a factor of 2.
 *
 * Run: npx tsx scripts/repros/2026-11-25-array-store-cost.mts [stores runs]
 *
 * For each count of cells, on a new engine with no time limit, the program
 *
 *   let a = arrayFrom(repeat(0, <cells>), "integer<0..255>")
 *   for k in 1..<stores> { a[(k % 100) + 1] = k % 256 }
 *
 * is run <runs> times after one warm-up run; the construction, a statement
 * of its own, is not timed. Prints the median time of the loop for each count
 * of cells, and the ratio of the two medians. The defaults are 20000 stores
 * and 7 runs.
 */
import { performance } from 'node:perf_hooks';

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const [storesArg, runsArg] = process.argv.slice(2).map(Number);
const stores = Number.isFinite(storesArg) && storesArg > 0 ? storesArg : 20000;
const runs = Number.isFinite(runsArg) && runsArg > 0 ? runsArg : 7;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function timeStores(cells: number): number {
  const times: number[] = [];
  for (let run = 0; run <= runs; run++) {
    const ce = new ComputeEngine();
    ce.timeLimit = Infinity;
    executeEpsil(
      ce,
      `let a = arrayFrom(repeat(0, ${cells}), "integer<0..255>")`
    );
    const t0 = performance.now();
    const r = executeEpsil(
      ce,
      `for k in 1..${stores} { a[(k % 100) + 1] = k % 256 }\na[1]`
    );
    const ms = performance.now() - t0;
    if (r.value?.operator === 'Error')
      throw new Error(`the loop failed: ${r.value.toString()}`);
    // The first run warms up the engine and is not counted.
    if (run > 0) times.push(ms);
  }
  return median(times);
}

const small = timeStores(100);
const large = timeStores(1_000_000);
console.log(`${stores} stores, median of ${runs} runs`);
console.log(`array of 100 cells:       ${small.toFixed(1)} ms`);
console.log(`array of 1,000,000 cells: ${large.toFixed(1)} ms`);
console.log(`ratio: ${(large / small).toFixed(2)} (acceptance: under 2)`);
