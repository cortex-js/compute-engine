/** Warm, single-engine diagnostics; not a cross-machine performance ranking.
 * Bundle with esbuild, then pass --engine, --rules and --output paths. */
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    rules: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.engine || !values.rules || !values.output)
  throw new Error('Supply --engine, --rules, and --output');
const { ComputeEngine } = await import(
  pathToFileURL(resolve(values.engine)).href
);
const { loadIntegrationRules } = await import(
  pathToFileURL(resolve(values.rules)).href
);
const ce = new ComputeEngine();
const loaded = loadIntegrationRules(ce, {
  timeLimitMs: 4000,
  stepBudget: 300000,
});
const fixtures = [
  ['log-cos', ['Cos', ['Ln', 'x']]],
  ['log-sin', ['Sin', ['Ln', 'x']]],
  ['affine-log-cos', ['Cos', ['Ln', ['Add', 2, ['Multiply', 3, 'x']]]]],
  ['log-frequency', ['Cos', ['Add', 1, ['Multiply', 2, ['Ln', 'x']]]]],
  [
    'log-polynomial',
    ['Multiply', ['Power', ['Ln', 'x'], 2], ['Sin', ['Ln', 'x']]],
  ],
  ['power-log', ['Multiply', ['Power', 'x', 2], ['Cos', ['Ln', 'x']]]],
  ['exp-cos', ['Multiply', ['Exp', 'x'], ['Cos', 'x']]],
  [
    'poly-exp-sin',
    [
      'Multiply',
      ['Power', 'x', 4],
      ['Exp', ['Multiply', -2, 'x']],
      ['Sin', ['Multiply', 3, 'x']],
    ],
  ],
  [
    'fractional-log',
    ['Divide', ['Ln', ['Add', 1, ['Sqrt', ['Add', 1, 'x']]]], ['Add', 1, 'x']],
  ],
  [
    'inverse-tangent',
    ['Divide', ['Exp', ['Arctan', 'x']], ['Add', 1, ['Power', 'x', 2]]],
  ],
  ['control-polynomial', ['Power', 'x', 12]],
  ['control-linear-trig', ['Cos', ['Add', 2, ['Multiply', 3, 'x']]]],
];
const results = [];
for (const [name, body] of fixtures) {
  const input = ['Integrate', body, 'x'];
  try {
    ce.withTimeLimit(4000, () => ce.box(input).evaluate());
  } catch {
    /* Timed repetitions record failures. */
  }
  const times: number[] = [];
  let answer: unknown;
  let status = 'unevaluated';
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    try {
      const value = ce.withTimeLimit(4000, () => ce.box(input).evaluate());
      answer = value.json;
      status = value.has('Integrate')
        ? 'unevaluated'
        : value.isValid === false
          ? 'error'
          : 'answer';
    } catch (error) {
      status =
        error instanceof Error && error.name === 'CancellationError'
          ? 'timeout'
          : 'error';
      answer = String(error);
    }
    times.push(performance.now() - start);
  }
  results.push({
    name,
    input,
    status,
    answer,
    medianMs: [...times].sort((a, b) => a - b)[1],
    timesMs: times,
  });
  console.log(name, status);
}
const hash = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(
  values.output,
  JSON.stringify(
    {
      node: process.version,
      engineSha256: hash(values.engine),
      rulesSha256: hash(values.rules),
      loaded,
      method:
        'one warmup and three warm evaluations; 4000 ms cooperative guard; no global-domain proof',
      results,
    },
    null,
    2
  )
);
