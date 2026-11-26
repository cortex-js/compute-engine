/**
 * CE-1831: in the interpreter, each write of an element of a long list in a
 * loop cost a time in proportion to the length of the list.
 *
 * Run: npx tsx scripts/repros/2026-11-25-ce1831-list-write-cost.mts [length writes]...
 *
 * Each case runs on a new engine with no time limit, measured in the process
 * (the start of the process is not counted):
 *
 *   let fb: list<integer> = [0 for k in 1..<length>]
 *   for k in 1..<writes> { fb[k] = k % 256 }
 *   fb[<writes>]
 *
 * The default cases are (20000, 2000) and (20000, 20000).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const args = process.argv.slice(2).map(Number);
const cases: [number, number][] = [];
for (let i = 0; i + 1 < args.length; i += 2) cases.push([args[i], args[i + 1]]);
if (cases.length === 0)
  cases.push(
    [20000, 2000],
    [20000, 20000]
  );

for (const [length, writes] of cases) {
  const ce = new ComputeEngine();
  ce.timeLimit = Infinity;
  const src = `let fb: list<integer> = [0 for k in 1..${length}]
for k in 1..${writes} { fb[k] = k % 256 }
fb[${writes}]`;
  const t0 = performance.now();
  const r = executeEpsil(ce, src) as any;
  const ms = performance.now() - t0;
  const v = r?.value ?? r;
  console.log(
    `length ${length}, writes ${writes}: ${v?.toString?.() ?? JSON.stringify(r)} in ${(ms / 1000).toFixed(2)} s`
  );
}
