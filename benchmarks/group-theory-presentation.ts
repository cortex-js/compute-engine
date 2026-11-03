/**
 * Collected presentation benchmarks: construction validates cyclic-extension
 * consistency; queries collect exact coordinates without enumerating elements.
 * Bundle for ES2022 and run on Node 26; construction is separate from queries.
 */
import { strict as assert } from 'node:assert';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { CollectedPcGroup } from '../src/compute-engine/group-theory/polycyclic-presentation.js';
import { GroupWork } from '../src/compute-engine/group-theory/finite-group.js';

const warmups = 3;
const samples = 9;
const workLimit = 50_000_000;
const budget = () => new GroupWork(workLimit);
const metadata = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  warmups,
  samples,
  workLimit,
};

function cyclic(order: bigint, work: GroupWork): CollectedPcGroup {
  return CollectedPcGroup.extend(
    CollectedPcGroup.trivial(work),
    {
      relativeOrder: order,
      power: [],
      conjugates: [],
      inverseConjugates: [],
    },
    work
  );
}

function elementary(work: GroupWork): CollectedPcGroup {
  let group = CollectedPcGroup.trivial(work);
  for (let i = 0; i < 40; i++) {
    const images = Array.from({ length: group.rank }, (_, j) =>
      group.generator(j, work)
    );
    group = CollectedPcGroup.extend(
      group,
      {
        relativeOrder: 2n,
        power: group.identity(),
        conjugates: images,
        inverseConjugates: images,
      },
      work
    );
  }
  return group;
}

function dihedral(work: GroupWork): CollectedPcGroup {
  return CollectedPcGroup.extend(
    cyclic(1_000_000_000_000n, work),
    {
      relativeOrder: 2n,
      power: [0n],
      conjugates: [[999_999_999_999n]],
      inverseConjugates: [[999_999_999_999n]],
    },
    work
  );
}

function metacyclic(work: GroupWork): CollectedPcGroup {
  return CollectedPcGroup.extend(
    cyclic(257n, work),
    {
      relativeOrder: 1_000_000_000_000n,
      power: [0n],
      conjugates: [[3n]],
      inverseConjugates: [[86n]],
    },
    work
  );
}

function measure(
  name: string,
  phase: 'construction' | 'query',
  operation: (work: GroupWork) => Record<string, string | number>
): void {
  const elapsed: number[] = [];
  let logicalWork = 0;
  let result: Record<string, string | number> = {};
  for (let i = 0; i < warmups + samples; i++) {
    const work = budget();
    const start = performance.now();
    result = operation(work);
    const milliseconds = performance.now() - start;
    if (i >= warmups) elapsed.push(milliseconds);
    logicalWork = work.used;
  }
  elapsed.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      ...metadata,
      name,
      phase,
      medianMs: elapsed[Math.floor(samples / 2)],
      minMs: elapsed[0],
      maxMs: elapsed.at(-1),
      logicalWork,
      ...result,
    })
  );
}

for (const [name, construct, expected] of [
  [
    'C(10^12)',
    (work: GroupWork) => cyclic(1_000_000_000_000n, work),
    1_000_000_000_000n,
  ],
  ['C2^40', elementary, 1n << 40n],
  ['D(2*10^12)', dihedral, 2_000_000_000_000n],
  ['C257 by C(10^12)', metacyclic, 257_000_000_000_000n],
] as const) {
  measure(name, 'construction', (work) => {
    const group = construct(work);
    assert.equal(group.order, expected);
    return {
      order: String(group.order),
      rank: group.rank,
      storedCoefficients: group.storedCoefficients,
    };
  });
}

const largeCyclic = cyclic(1_000_000_000_000n, budget());
measure('C(10^12) power', 'query', (work) => {
  const result = largeCyclic.power([123456789n], -123456789012345678901n, work);
  assert.deepEqual(
    largeCyclic.multiply(result, largeCyclic.inverse(result, work), work),
    [0n]
  );
  return { coordinate: String(result[0]) };
});
const elementaryGroup = elementary(budget());
const binaryCoordinates = Array<bigint>(40).fill(1n);
measure('C2^40 multiply', 'query', (work) => {
  assert.deepEqual(
    elementaryGroup.multiply(binaryCoordinates, binaryCoordinates, work),
    elementaryGroup.identity()
  );
  return { rank: elementaryGroup.rank };
});
const dihedralGroup = dihedral(budget());
measure('D(2*10^12) reflection square', 'query', (work) => {
  assert.deepEqual(dihedralGroup.power([1n, 123456789n], 2n, work), [0n, 0n]);
  return { identity: 1 };
});
const metacyclicGroup = metacyclic(budget());
measure('C257 by C(10^12) long automorphism power', 'query', (work) => {
  const result = metacyclicGroup.multiply(
    [0n, 1n],
    [999_999_999_999n, 0n],
    work
  );
  assert.deepEqual(result, [999_999_999_999n, 86n]);
  return { coordinate: String(result[1]) };
});
