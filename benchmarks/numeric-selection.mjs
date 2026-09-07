// Compare source checkouts on the 200² Life witness. --check verifies outputs
// without timing; measured runs require an uncontended machine and the box lock.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
const checkOnly = process.argv.includes('--check');
const roots = process.argv.slice(2).filter((x) => x !== '--check');
if (roots.length !== 2)
  throw new Error('Expected baseline and candidate source roots');
const modules = await Promise.all(
  roots.map(
    (root) => import(pathToFileURL(resolve(root, 'src/compute-engine.ts')))
  )
);
const N = 200,
  size = N * N;
const shifts = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1];
const neighbours = ['Add', ...shifts.map((k) => ['RotateLeft', 'S', k])];
const json = [
  'Which',
  ['Equal', neighbours, 3],
  1,
  ['Equal', neighbours, 2],
  'S',
  'True',
  0,
];
const compiled = modules.map(({ ComputeEngine, compile }) => {
  const ce = new ComputeEngine();
  ce.declare('S', 'list<number>');
  const result = compile(ce.expr(json), {
    to: 'javascript',
    constantFold: false,
    fallback: false,
  });
  assert.equal(result.success, true);
  return result;
});
const results = [];
let checksum = 0;
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const real of [false, true]) {
  const board = Array.from({ length: size }, (_, i) =>
    (i * 2654435761) % 100 < 35 ? (real ? 0.75 : 1) : 0
  );
  const typed = Float64Array.from(board),
    reused = new Float64Array(size);
  const step = (source, output) => {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let k = 0; k < shifts.length; k++) {
        let j = i + shifts[k];
        if (j < 0) j += size;
        else if (j >= size) j -= size;
        sum += source[j];
      }
      output[i] =
        Math.abs(sum - 3) <= 1e-10
          ? 1
          : Math.abs(sum - 2) <= 1e-10
            ? source[i]
            : 0;
    }
    return output;
  };
  // The filing's original reference uses exact comparisons on a binary board
  // and reuses its typed output. Keep that reference separate from the
  // tolerance-preserving, allocating plain-array control.
  const typedReference = () => {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        let j = i + shifts[k];
        if (j < 0) j += size;
        else if (j >= size) j -= size;
        sum += typed[j];
      }
      reused[i] = sum === 3 ? 1 : sum === 2 ? typed[i] : 0;
    }
    return reused;
  };
  const vars = { S: board };
  const cases = [
    ['baseline', () => compiled[0].run(vars)],
    ['candidate', () => compiled[1].run(vars)],
    ['plain Array, fresh output', () => step(board, new Array(size))],
    ['typed array, reused output', typedReference],
  ];
  const expected = step(board, new Array(size));
  for (const [, run] of cases) assert.deepEqual(Array.from(run()), expected);
  if (checkOnly) continue;
  const sample = (run, reps) => {
    const start = performance.now();
    for (let i = 0; i < reps; i++) {
      const out = run();
      checksum += out[(i * 997) % size];
    }
    return (performance.now() - start) / reps;
  };
  for (const [, run] of cases) sample(run, 200);
  const timings = cases.map(() => []);
  for (let round = 0; round < 9; round++) {
    const order = [0, 1, 2, 3];
    if (round % 2) order.reverse();
    for (const i of order) timings[i].push(sample(cases[i][1], 100));
  }
  const medians = timings.map(median);
  results.push({
    board: real ? 'real-valued' : 'binary',
    milliseconds: Object.fromEntries(
      cases.map(([name], i) => [name, medians[i]])
    ),
    candidateToTyped: medians[1] / medians[3],
    candidateToAllocatingArray: medians[1] / medians[2],
    baselineToCandidate: medians[0] / medians[1],
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      load: loadavg(),
      checkOnly,
      numericalAgreement: true,
      codeLengths: compiled.map((x) => x.code.length),
      results,
      checksum,
    },
    null,
    2
  )
);
