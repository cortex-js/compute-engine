/**
 * Indexed scalar blocks whose declared result also permits collections.
 * Run on a quiet machine under the shared-box lock:
 *   node --import tsx benchmarks/scalar-accumulator.ts [baseline-entry.ts]
 * With a baseline, rounds alternate order and values must match exactly.
 * Add --check to validate results and code shape without running timings.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../src/compute-engine.js';

const checkOnly = process.argv.includes('--check');
const baselinePath = process.argv.slice(2).find((arg) => arg !== '--check');
const baseline: typeof current | undefined = baselinePath
  ? await import(pathToFileURL(resolve(baselinePath)).href)
  : undefined;
const modules = baseline
  ? ([
      ['baseline', baseline],
      ['current', current],
    ] as const)
  : ([['current', current]] as const);
const iterations = 20_000;

for (const N of [16, 128]) {
  const cases = modules.map(([label, module]) => {
    const ce = new module.ComputeEngine();
    ce.declare('N', 'integer');
    ce.declare('x', 'real');
    const expr = ce.box([
      'Sum',
      [
        'Block',
        ['Declare', 'q', "'broadcastable<number>'"],
        ['Assign', 'q', ['Multiply', 'i', 'x']],
        'q',
      ],
      ['Limits', 'i', 1, 'N'],
    ]);
    const r = module.compile(expr);
    assert(r.success && r.run, `${label}: compilation failed`);
    const run = r.run;
    const source = (r.preamble ?? '') + (r.code ?? '');
    for (const x of [-1, -0, 0.5, 2]) {
      assert.equal(run({ N, x }), ((N * (N + 1)) / 2) * x);
    }
    const vars = { N, x: 1 };
    const batch = () => {
      let checksum = 0;
      for (let i = 0; i < iterations; i++) {
        vars.x = (i % 8) + 1;
        checksum += run(vars) as number;
      }
      return checksum;
    };
    if (!checkOnly) batch();
    return { label, source, batch, samples: [] as number[], checksum: 0 };
  });
  if (checkOnly) {
    for (const c of cases)
      console.log(
        JSON.stringify({
          label: c.label,
          N,
          broadcasts: (c.source.match(/_SYS\.bcast\(/g) ?? []).length,
          codeBytes: Buffer.byteLength(c.source),
          checked: true,
        })
      );
    continue;
  }
  for (let round = 0; round < 7; round++) {
    const order = round % 2 ? [...cases].reverse() : cases;
    for (const c of order) {
      const start = performance.now();
      c.checksum = c.batch();
      c.samples.push(((performance.now() - start) * 1e6) / iterations);
    }
    if (cases.length === 2) assert.equal(cases[0].checksum, cases[1].checksum);
  }
  for (const c of cases) {
    const sorted = [...c.samples].sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        label: c.label,
        N,
        iterations,
        rounds: c.samples.length,
        medianNs: sorted[Math.floor(sorted.length / 2)],
        samplesNs: c.samples,
        broadcasts: (c.source.match(/_SYS\.bcast\(/g) ?? []).length,
        codeBytes: Buffer.byteLength(c.source),
        checksum: c.checksum,
      })
    );
  }
}
