import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import assert from 'node:assert/strict';
import {
  PermutationValue,
  PermutationAction,
} from '../../src/compute-engine/group-theory/permutation/values';
import { PermutationGroupValue } from '../../src/compute-engine/group-theory/permutation/groups';
import { PermutationStabilizerChain } from '../../src/compute-engine/group-theory/permutation/stabilizer-chain';
import {
  GroupWork,
  GroupLimitError,
  FiniteGroupTable,
  finitePermutationModel,
} from '../../src/compute-engine/group-theory/finite-group';
import { FinitePcgs } from '../../src/compute-engine/group-theory/polycyclic';
import {
  naturalLinearGroup,
  primeFieldMatrixGroupOrder,
} from '../../src/compute-engine/group-theory/matrix';
const w = () => new GroupWork(50_000_000);
const limits = { maxWork: 50_000_000 };
function symmetric(n: number) {
  return new PermutationGroupValue(
    [
      new PermutationValue([2, 1]),
      new PermutationValue(
        Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1)
      ),
    ],
    new PermutationAction(n)
  );
}
function bench(name: string, f: () => unknown, count = 15) {
  try {
    for (let warmup = 0; warmup < 5; warmup++) f();
    const times: number[] = [];
    let result: unknown;
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      result = f();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          name,
          median_ms: +times[Math.floor(count / 2)].toFixed(3),
          min_ms: +times[0].toFixed(3),
          max_ms: +times.at(-1)!.toFixed(3),
          runs: count,
          result,
        },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v)
      )
    );
  } catch (e) {
    if (!(e instanceof GroupLimitError)) throw e;
    console.log(JSON.stringify({ name, error: String(e) }));
  }
}
assert.equal(process.versions.node.split('.')[0], '26');
console.log(
  JSON.stringify({
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    build: 'minified ES2022 ESM, production, no TypeScript loader',
    method:
      '5 warm-ups + 15 measured runs; preconstructed descriptors; no deadline callback; kernel timings, not Epsil latency',
  })
);
for (const [n, order] of [
  [4, 24],
  [5, 120],
  [10, 3628800],
  [20, 2432902008176640000n],
] as const) {
  const g = symmetric(n);
  bench('S' + n + ' verified chain construction', () => {
    const c = PermutationStabilizerChain.compute(g, limits);
    assert.equal(c.order, BigInt(order));
    return { order: c.order, work: c.workUsed };
  });
  if (n <= 5)
    bench('S' + n + ' complete finite model', () => {
      const work = w(),
        m = finitePermutationModel(g, 256, work);
      assert.equal(m.table.order, Number(order));
      return { order: m.table.order, work: work.used };
    });
}
const s4 = finitePermutationModel(symmetric(4), 256, w());
bench('S4 subgroup lattice, table already built', () => {
  const work = w(),
    s = s4.table.session(work),
    hs = s.subgroups();
  assert.equal(hs.length, 30);
  return { subgroups: hs.length, work: work.used };
});
bench('S4 automatic pcgs, table already built', () => {
  const work = w(),
    pc = FinitePcgs.compute(s4.table, work);
  assert.ok(pc);
  assert.equal(
    pc.relativeOrders.reduce((a, b) => a * b, 1),
    24
  );
  return { relativeOrders: pc.relativeOrders, work: work.used };
});
const cyclicRows = Array.from({ length: 256 }, (_, i) =>
  Array.from({ length: 256 }, (_, j) => (i + j) % 256)
);
bench('C256 exhaustive table validation only', () => {
  const work = w(),
    t = FiniteGroupTable.fromTable(cyclicRows, work);
  return { order: t.order, work: work.used };
});
const c = symmetric(20),
  chain = PermutationStabilizerChain.compute(c, limits);
bench('S20 100 membership sifts with existing chain', () => {
  for (let i = 0; i < 100; i++)
    assert.equal(chain.sift(c.generators[i % 2], limits).member, true);
  return { queries: 100 };
});
for (const n of [3, 4]) {
  const g = naturalLinearGroup(n, 2, false, w());
  bench('GL(' + n + ',2) vector action plus verified chain', () => {
    const work = w(),
      order = primeFieldMatrixGroupOrder(g, 100000, work);
    assert.equal(order, n === 3 ? 168n : 20160n);
    return { order, work: work.used };
  });
}
const elementaryRows = Array.from({ length: 32 }, (_, i) =>
  Array.from({ length: 32 }, (_, j) => i ^ j)
);
const elementary = FiniteGroupTable.fromTable(elementaryRows, w());
const start = performance.now(),
  work = w();
try {
  const hs = elementary.session(work).subgroups();
  console.log(
    JSON.stringify({
      name: 'C2^5 subgroup lattice, one attempt',
      elapsed_ms: performance.now() - start,
      subgroups: hs.length,
      work: work.used,
    })
  );
} catch (e) {
  if (!(e instanceof GroupLimitError)) throw e;
  console.log(
    JSON.stringify({
      name: 'C2^5 subgroup lattice, one attempt',
      elapsed_ms: performance.now() - start,
      error: String(e),
      work: work.used,
    })
  );
}

import { ComputeEngine } from '../../src/compute-engine/index';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installGroupTheory } from '../../src/compute-engine/library/group-theory';
function epsilBench(name: string, n: number, generic: boolean) {
  const times: number[] = [];
  const source =
    'let G=PermutationGroup([Permutation([2,1]),Permutation([' +
    Array.from({ length: n }, (_, i) => ((i + 1) % n) + 1).join(',') +
    '])],PermutationAction(' +
    n +
    '))\n' +
    (generic
      ? 'GroupOrder(G,256,50000000)'
      : 'PermutationGroupOrder(G,50000000)');
  for (let i = 0; i < 12; i++) {
    const ce = new ComputeEngine();
    installGroupTheory(ce);
    const start = performance.now();
    const result = executeEpsil(ce, source);
    const elapsed = performance.now() - start;
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.value.json,
      ce.number(n === 5 ? 120 : 2432902008176640000n).json
    );
    if (i >= 5) times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name,
      median_ms: times[3],
      min_ms: times[0],
      max_ms: times.at(-1),
      runs: 7,
      scope:
        'fresh engine per trial; engine creation and library install excluded; parsing and evaluation included',
    })
  );
}
for (const n of [64, 128]) {
  const rows = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i ^ j)
  );
  const table = FiniteGroupTable.fromTable(rows, w()),
    work = w(),
    start = performance.now();
  try {
    const hs = table.session(work).subgroups();
    console.log(
      JSON.stringify({
        name: 'C2^' + Math.log2(n) + ' lattice, one attempt',
        elapsed_ms: performance.now() - start,
        subgroups: hs.length,
        work: work.used,
      })
    );
  } catch (e) {
    if (!(e instanceof GroupLimitError)) throw e;
    console.log(
      JSON.stringify({
        name: 'C2^' + Math.log2(n) + ' lattice, one attempt',
        elapsed_ms: performance.now() - start,
        error: String(e),
        work: work.used,
      })
    );
  }
}
epsilBench('Epsil S5 generic order', 5, true);
epsilBench('Epsil S5 specialized order', 5, false);
epsilBench('Epsil S20 specialized order', 20, false);

const e128 = FiniteGroupTable.fromTable(
  Array.from({ length: 128 }, (_, i) =>
    Array.from({ length: 128 }, (_, j) => i ^ j)
  ),
  w()
);
bench(
  'C2^7 automatic pcgs, table already built',
  () => {
    const work = w(),
      pc = FinitePcgs.compute(e128, work);
    assert.ok(pc);
    assert.equal(
      pc.relativeOrders.reduce((a, b) => a * b, 1),
      128
    );
    return { work: work.used };
  },
  3
);
