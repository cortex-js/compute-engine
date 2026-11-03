/**
 * Public expression-path benchmark. Every sample has a fresh engine so a cached
 * evaluation or stabilizer chain cannot masquerade as a first query. Engine
 * construction/loading is reported separately from boxing plus evaluation.
 * Bundle for Node with ES2022; no Node version is required by the library itself.
 */
import { cpus } from 'node:os';
import { ComputeEngine } from '../src/compute-engine.js';
import { loadGroupTheory } from '../src/group-theory.js';
import type { MathJsonExpression } from '../src/math-json/types.js';

const permutation = (images: number[]): MathJsonExpression => [
  'Permutation',
  ['List', ...images],
];
const group = (generators: number[][], degree: number): MathJsonExpression => [
  'PermutationGroup',
  ['List', ...generators.map(permutation)],
  ['PermutationAction', degree],
];
const symmetric = group(
  [[2, 1], Array.from({ length: 100 }, (_, i) => ((i + 1) % 100) + 1)],
  100
);
const elementary = group(
  Array.from({ length: 7 }, (_, i) =>
    Array.from({ length: 14 }, (_, j) =>
      j === 2 * i ? j + 2 : j === 2 * i + 1 ? j : j + 1
    )
  ),
  14
);
const s3 = group(
  [
    [2, 1],
    [2, 3, 1],
  ],
  3
);
const c3 = group([[2, 3, 1]], 3);
const collectedCyclic: MathJsonExpression = [
  'PcGroup',
  ['List', 1000000000000],
  ['List', ['List']],
  ['List', ['List']],
  ['List', ['List']],
];
const cases: {
  name: string;
  input: MathJsonExpression;
  expected: MathJsonExpression;
}[] = [
  {
    name: 'S100 order',
    input: ['GroupOrder', symmetric],
    expected: {
      num: Array.from({ length: 100 }, (_, i) => BigInt(i + 1))
        .reduce((a, b) => a * b, 1n)
        .toString(),
    },
  },
  {
    name: 'C2^7 Frattini order',
    input: ['GroupOrder', ['GroupFrattiniSubgroup', elementary]],
    expected: 1,
  },
  {
    name: 'C2^7 pc relative orders',
    input: ['GroupPcRelativeOrders', ['GroupPcgs', elementary]],
    expected: ['List', 2, 2, 2, 2, 2, 2, 2],
  },
  {
    name: 'GL4/2 order by faithful action',
    input: ['GroupOrder', ['GeneralLinearGroup', 4, 2]],
    expected: 20160,
  },
  {
    name: 'C10^12 collected power coordinates',
    input: [
      'PcCoordinates',
      ['PcPower', ['PcElement', collectedCyclic, ['List', 7]], 999999999999],
    ],
    expected: ['List', 999999999993],
  },
  {
    name: 'S3/C3 quotient order',
    input: ['GroupOrder', ['GroupQuotientGroup', ['GroupQuotient', s3, c3]]],
    expected: 2,
  },
];
const warmups = 3,
  repetitions = 9;
const summarize = (xs: number[]) => {
  const ys = [...xs].sort((a, b) => a - b);
  return {
    medianMs: ys[Math.floor(ys.length / 2)],
    minMs: ys[0],
    maxMs: ys.at(-1),
    samplesMs: xs,
  };
};
const results = cases.map(({ name, input, expected }) => {
  const setup: number[] = [],
    query: number[] = [];
  for (let i = 0; i < warmups + repetitions; i++) {
    const start = process.hrtime.bigint(),
      ce = new ComputeEngine();
    loadGroupTheory(ce);
    const loaded = process.hrtime.bigint();
    const answer = ce.box(input).evaluate();
    const end = process.hrtime.bigint();
    if (!answer.isSame(ce.box(expected)))
      throw new Error(name + ': ' + JSON.stringify(answer.json));
    if (i >= warmups) {
      setup.push(Number(loaded - start) / 1e6);
      query.push(Number(end - loaded) / 1e6);
    }
  }
  return { name, setup: summarize(setup), query: summarize(query) };
});
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      target: 'ES2022',
      warmups,
      repetitions,
      cache: 'fresh engine per sample',
      results,
    },
    null,
    2
  )
);
