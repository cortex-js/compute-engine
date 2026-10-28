/**
 * Exact matrix group benchmarks, independent of the expression adapter.
 * Bundle for an ES2022 Node target before timing to exclude TypeScript loading.
 * Each sample constructs fresh query ledgers; descriptors carry no order cache.
 */
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  ExactMatrixField,
  ExactMatrixValue,
  ExactMatrixGroup,
  naturalLinearGroup,
  primeFieldMatrixGroupOrder,
  invariantRationalGroupLattice,
} from '../src/compute-engine/group-theory/matrix.js';
import { GroupWork } from '../src/compute-engine/group-theory/finite-group.js';

const maxWork = 50_000_000;
const warmups = 3;
const samples = 9;
const metadata = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  warmups,
  samples,
  maxWork,
};

function measure(
  name: string,
  phase: 'construction' | 'query',
  operation: (work: GroupWork) => Record<string, string | number>
) {
  for (let i = 0; i < warmups; i++) operation(new GroupWork(maxWork));
  const times: number[] = [];
  let result: Record<string, string | number> = {};
  let logicalWork = 0;
  for (let i = 0; i < samples; i++) {
    const work = new GroupWork(maxWork);
    const start = performance.now();
    result = operation(work);
    times.push(performance.now() - start);
    logicalWork = work.used;
  }
  const samplesMs = [...times];
  times.sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify({
      ...metadata,
      name,
      phase,
      samplesMs,
      medianMs: times[Math.floor(samples / 2)],
      minMs: times[0],
      maxMs: times[samples - 1],
      logicalWork,
      ...result,
    }) + '\n'
  );
}

for (const [dimension, prime, special] of [
  [4, 2, false],
  [5, 2, false],
  [6, 2, false],
  [2, 3, true],
] as const) {
  const name = (special ? 'SL' : 'GL') + '(' + dimension + ',' + prime + ')';
  measure(name, 'construction', (work) => ({
    generators: naturalLinearGroup(dimension, prime, special, work).generators
      .length,
  }));
  const group = naturalLinearGroup(
    dimension,
    prime,
    special,
    new GroupWork(maxWork)
  );
  measure(name + ' exact order', 'query', (work) => ({
    order: String(primeFieldMatrixGroupOrder(group, 1000, work)),
  }));
}

const small = naturalLinearGroup(2, 3, false, new GroupWork(maxWork));
measure('GL(2,3) explicit table', 'query', (work) => ({
  order: small.finiteModel(48, work).table.order,
}));
const formGroup = naturalLinearGroup(2, 2, true, new GroupWork(maxWork));
measure('SL(2,2) bilinear invariants', 'query', (work) => ({
  dimension: formGroup.invariantBilinearForms(work).length,
}));
measure('SL(2,2) quadratic invariants', 'query', (work) => ({
  dimension: formGroup.invariantQuadraticForms(work).length,
}));

const rational = new ExactMatrixField();
function rationalInvolution(work: GroupWork) {
  return new ExactMatrixGroup(
    rational,
    2,
    [
      ExactMatrixValue.fromRows(
        rational,
        [
          [0n, 2n],
          [{ numerator: 1n, denominator: 2n }, 0n],
        ],
        work
      ),
    ],
    work
  );
}
measure('rational C2', 'construction', (work) => ({
  generators: rationalInvolution(work).generators.length,
}));
const rationalGroup = rationalInvolution(new GroupWork(maxWork));
measure('rational C2 invariant lattice', 'query', (work) => {
  const basis = invariantRationalGroupLattice(rationalGroup, 2, work);
  return {
    basis: basis.rows
      .map((row) =>
        row
          .map(
            (value) => String(value.numerator) + '/' + String(value.denominator)
          )
          .join(',')
      )
      .join(';'),
  };
});
