/**
 * Finite-group kernel benchmark. Bundle this file for Node with target ES2022,
 * then run the bundle on Node 26. Output is JSON with raw warmed samples.
 * Table import is measured separately: query samples include a fresh session
 * and ledger, but exclude validation of the shared immutable table.
 */
import { cpus } from 'node:os';
import {
  FiniteGroupTable,
  GroupWork,
} from '../src/compute-engine/group-theory/finite-group.js';
import {
  finiteAutomorphisms,
  finiteMinimalGenerators,
  finiteEulerianFunction,
} from '../src/compute-engine/group-theory/finite-structure.js';

const warmups = 3;
const repetitions = 9;
const workLimit = 50_000_000;
type Measurement = {
  name: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  samplesMs: number[];
  work: number;
  result: unknown;
};
function measure<T>(
  name: string,
  operation: (work: GroupWork) => T,
  describe: (result: T) => unknown
): Measurement {
  const samplesMs: number[] = [];
  let work = 0,
    result: unknown;
  for (let i = 0; i < warmups + repetitions; i++) {
    const ledger = new GroupWork(workLimit);
    const start = process.hrtime.bigint();
    const value = operation(ledger);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (i >= warmups) samplesMs.push(elapsed);
    work = ledger.used;
    result = describe(value);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    name,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1)!,
    samplesMs,
    work,
    result,
  };
}
const elementaryRows = Array.from({ length: 128 }, (_, a) =>
  Array.from({ length: 128 }, (_, b) => a ^ b)
);
const dihedralRows = Array.from({ length: 128 }, (_, a) =>
  Array.from(
    { length: 128 },
    (_, b) =>
      (((a % 64) + (a < 64 ? 1 : -1) * (b % 64) + 64) % 64) +
      (a < 64 !== b < 64 ? 64 : 0)
  )
);
const measurements: Measurement[] = [];
for (const [name, rows] of [
  ['C2^7', elementaryRows],
  ['D128', dihedralRows],
] as const)
  measurements.push(
    measure(
      name + ' table validation',
      (work) => FiniteGroupTable.fromTable(rows, work),
      (group) => group.order
    )
  );
const elementary = FiniteGroupTable.fromTable(
  elementaryRows,
  new GroupWork(workLimit)
);
const dihedral = FiniteGroupTable.fromTable(
  dihedralRows,
  new GroupWork(workLimit)
);
measurements.push(
  measure(
    'C2^7 Sylow(2)',
    (work) => {
      const session = elementary.session(work);
      return session.sylow(session.whole, 2).order;
    },
    (result) => result
  ),
  measure(
    'C2^7 Frattini',
    (work) => elementary.session(work).frattini().order,
    (result) => result
  ),
  measure(
    'C2^7 simplicity',
    (work) => elementary.session(work).isSimple(),
    (result) => result
  ),
  measure(
    'C2^7 minimum generators',
    (work) => finiteMinimalGenerators(elementary.session(work)).length,
    (result) => result
  ),
  measure(
    'C2^7 generating 7-tuples',
    (work) => finiteEulerianFunction(elementary.session(work), 7),
    (result) => result.toString()
  ),
  measure(
    'D128 automorphisms',
    (work) => finiteAutomorphisms(dihedral.session(work)).length,
    (result) => result
  )
);
process.stdout.write(
  JSON.stringify(
    {
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      warmups,
      repetitions,
      workLimit,
      timing: 'process.hrtime.bigint; milliseconds; fresh session per query',
      measurements,
    },
    null,
    2
  ) + '\n'
);
