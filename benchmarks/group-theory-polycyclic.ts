/**
 * Finite polycyclic workloads on already validated table groups.
 * Run with the project's supported TypeScript runner or an ES2022 bundle.
 * Table validation is measured separately; coordinate and quotient timings
 * exclude construction of their parent values.
 */
import { strict as assert } from 'node:assert';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  FiniteGroupTable,
  GroupWork,
} from '../src/compute-engine/group-theory/finite-group.js';
import { FinitePcgs } from '../src/compute-engine/group-theory/polycyclic.js';
import { FiniteModuloPcgs } from '../src/compute-engine/group-theory/polycyclic-quotient.js';
import { finitePcOrbitStabilizer } from '../src/compute-engine/group-theory/polycyclic-actions.js';
import {
  PermutationValue,
  PermutationAction,
} from '../src/compute-engine/group-theory/permutation/values.js';
import { PermutationGroupValue } from '../src/compute-engine/group-theory/permutation/groups.js';

const warmups = 3;
const samples = 9;
const budget = () => new GroupWork(50_000_000);
const elementaryRows = Array.from({ length: 128 }, (_, a) =>
  Array.from({ length: 128 }, (_, b) => a ^ b)
);
const cyclicRows = Array.from({ length: 128 }, (_, a) =>
  Array.from({ length: 128 }, (_, b) => (a + b) % 128)
);
const elementary = FiniteGroupTable.fromTable(elementaryRows, budget());
const cyclic = FiniteGroupTable.fromTable(cyclicRows, budget());
const symmetric = FiniteGroupTable.fromPermutationGroup(
  new PermutationGroupValue(
    [
      PermutationValue.fromImages([2, 3, 4, 1]),
      PermutationValue.fromImages([2, 1]),
    ],
    new PermutationAction(4)
  ),
  24,
  budget()
);
const symmetricPcgs = FinitePcgs.compute(symmetric.table, budget())!;
const elementaryPcgs = FinitePcgs.compute(elementary, budget())!;
const elementarySession = elementary.session(budget());
const denominator = elementarySession.generated([1, 2, 4]);
const section = new FiniteModuloPcgs(
  elementaryPcgs,
  elementarySession.whole,
  denominator,
  budget()
);

console.log(
  JSON.stringify({
    benchmark: 'finite-polycyclic',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    warmups,
    samples,
    timing: 'milliseconds; parent construction excluded unless named',
  })
);

function measure(name: string, operation: (work: GroupWork) => void): void {
  const elapsed: number[] = [];
  let workUnits = 0;
  for (let i = 0; i < warmups + samples; i++) {
    const work = budget();
    const start = performance.now();
    operation(work);
    const milliseconds = performance.now() - start;
    if (i >= warmups) elapsed.push(milliseconds);
    workUnits = work.used;
  }
  const samplesMs = [...elapsed];
  elapsed.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name,
      samplesMs,
      medianMs: elapsed[Math.floor(samples / 2)],
      minMs: elapsed[0],
      maxMs: elapsed[samples - 1],
      workUnits,
    })
  );
}

measure('validate table C2^7', (work) => {
  assert.equal(FiniteGroupTable.fromTable(elementaryRows, work).order, 128);
});
for (const [name, group] of [
  ['S4', symmetric.table],
  ['C128', cyclic],
  ['C2^7', elementary],
] as const) {
  measure('construct pcgs ' + name, (work) => {
    const pcgs = FinitePcgs.compute(group, work)!;
    assert.equal(
      pcgs.relativeOrders.reduce((product, order) => product * order, 1),
      group.order
    );
  });
}
measure('construct section C2^7 / C2^3', (work) => {
  const quotient = new FiniteModuloPcgs(
    elementaryPcgs,
    elementarySession.whole,
    denominator,
    work
  );
  assert.equal(quotient.pcgs.group.order, 16);
});
measure('all 128 coordinate roundtrips in C2^7', (work) => {
  for (let element = 0; element < elementary.order; element++)
    assert.equal(
      elementaryPcgs.element(elementaryPcgs.exponents(element, work), work),
      element
    );
});
measure('all 16 section projection/lift roundtrips', (work) => {
  for (let element = 0; element < section.pcgs.group.order; element++)
    assert.equal(section.project(section.lift(element, work), work), element);
});
measure('S4 pc orbit/stabilizer including action validation', (work) => {
  const result = finitePcOrbitStabilizer(
    symmetricPcgs,
    symmetric.elements,
    new PermutationAction(4),
    1,
    work
  );
  assert.equal(result.points.length, 4);
  assert.equal(result.stabilizer.subgroup.order, 6);
});
