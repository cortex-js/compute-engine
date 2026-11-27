// Run under the shared-box lock with node --import tsx.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { compile } from '../../src/compile.js';
import { ComputeEngine, createKernelPool } from '../../src/compute-engine.js';
import { executeEpsil } from '../../src/epsil/execute-epsil.js';
import { median } from './common.mts';

const workerCount = 8;
const warmups = 3;
const repetitions = 7;
const workerUrl = new URL('../../src/kernel-worker.ts', import.meta.url);
const pool = createKernelPool({
  size: workerCount,
  create: () => new Worker(workerUrl),
});
const histogram = new Array<number>(90_001).fill(0);
const buddhabrot = readFileSync(
  new URL(
    '../../docs/plans/2026-11-09-shared-annotation-contract/instruments/parallel.epsil',
    import.meta.url
  ),
  'utf8'
);

const cases = [
  {
    label: 'cheap sum',
    name: 'cheap',
    expression: `function cheap(n: integer) -> integer {
      let s: integer = 0
      parallel for k in 1..n { s += k }
      s
    }`,
    counts: [2000, 20_000, 1_200_000],
  },
  {
    label: 'uniform work',
    name: 'uniform',
    expression: `function uniform(n: integer) -> integer {
      let s: integer = 0
      parallel for k in 1..n { for j in 1..128 { s += Mod(k * j, 97) } }
      s
    }`,
    counts: [2000, 20_000, 80_000],
  },
  {
    label: 'clustered work',
    name: 'clustered',
    expression: `function clustered(n: integer) -> integer {
      let s: integer = 0
      parallel for k in 1..n {
        if k <= floor(n / 8) {
          for j in 1..1024 { s += Mod(k * j, 97) }
        }
      }
      s
    }`,
    counts: [20_000, 80_000],
  },
  {
    label: 'Buddhabrot',
    name: 'step',
    expression: buddhabrot,
    counts: [20_000, 150_000, 1_200_000],
  },
];

try {
  await pool.prewarm();
  console.log(
    `${process.version} · ${cpus()[0].model} · ${workerCount} workers · machine precision · ${warmups} warmups, median of ${repetitions} interleaved runs`
  );
  console.log('workload\tpasses\trun ms\tpool ms\tspeedup');
  for (const { label, name, expression, counts } of cases) {
    const ce = new ComputeEngine({ workers: pool });
    ce.precision = 'machine';
    const definition = executeEpsil(ce, expression);
    assert.deepEqual(
      definition.diagnostics.filter((d) => d.severity === 'error'),
      []
    );
    ce.declare('n', 'integer');
    const call = name === 'step' ? [name, 'H', 'n'] : [name, 'n'];
    if (name === 'step') ce.declare('H', 'list<integer>');
    const runner = compile(ce.box(call), { to: 'javascript', fallback: false });
    assert(runner.success && runner.runAsync && runner.willParallelize?.(1, 1));
    for (const n of counts) {
      const inputs = name === 'step' ? { n, H: histogram } : { n };
      const expected = runner.run(inputs);
      if (name === 'cheap') assert.equal(expected, (n * (n + 1)) / 2);
      if (name === 'step') {
        assert(Array.isArray(expected));
        assert.equal(expected[90_000], n);
      }
      const serial: number[] = [];
      const parallel: number[] = [];
      for (let i = -warmups; i < repetitions; i++) {
        const t0 = performance.now();
        const baseline = runner.run(inputs);
        const t1 = performance.now();
        const routes: string[] = [];
        const result = await runner.runAsync(inputs, {
          minPasses: 1,
          onLoop: (report) => routes.push(report.route),
        });
        const t2 = performance.now();
        assert.deepEqual(routes, ['pool']);
        assert.deepEqual(baseline, expected);
        assert.deepEqual(result, expected);
        if (i >= 0) {
          serial.push(t1 - t0);
          parallel.push(t2 - t1);
        }
      }
      const run = median(serial);
      const workers = median(parallel);
      console.log(
        `${label}\t${n}\t${run.toFixed(3)}\t${workers.toFixed(3)}\t${(run / workers).toFixed(2)}x`
      );
    }
  }
} finally {
  pool.dispose();
}
