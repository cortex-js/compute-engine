/** Focused diagnostic, not a cold-start CAS performance ranking.
 * Build this script with esbuild, then pass independently built CE bundles:
 * node build/profile-definite.mjs --engine build/ce.mjs [--rules build/rules.mjs]
 */
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cases } from '../test/compute-engine/fixtures/competition-exact';
import {
  cases as families,
  polynomialCases as polynomials,
  reciprocalCases as reciprocal,
} from '../test/compute-engine/fixtures/integration-families';
import type { Expression } from '../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../src/compute-engine/boxed-expression/type-guards';

function exactLeaves(e: Expression): boolean {
  if (isNumber(e)) return e.isExact;
  return !isFunction(e) || e.ops.every(exactLeaves);
}

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    rules: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    timeout: { type: 'string', default: '4000' },
    suite: { type: 'string', default: 'competition' },
  },
});
if (!values.engine) throw new Error('--engine is required');
if (
  !['competition', 'families', 'polynomials', 'reciprocal'].includes(
    values.suite
  )
)
  throw new Error('Unknown suite');
const repeats = Number(values.repeats),
  timeout = Number(values.timeout);
if (
  !Number.isSafeInteger(repeats) ||
  repeats < 1 ||
  !Number.isFinite(timeout) ||
  timeout <= 0
)
  throw new Error('Invalid repetition count or timeout');
const { ComputeEngine } = await import(
  pathToFileURL(resolve(values.engine)).href
);
const rules = values.rules
  ? await import(pathToFileURL(resolve(values.rules)).href)
  : undefined;
const ce = new ComputeEngine();
ce.timeLimit = timeout;
if (rules)
  rules.loadIntegrationRules(ce, { timeLimitMs: timeout, stepBudget: 300000 });
const sha = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
console.log(
  JSON.stringify({
    kind: 'configuration',
    node: process.version,
    engineSha256: sha(values.engine),
    rulesSha256: values.rules ? sha(values.rules) : null,
    repeats,
    timeoutMs: timeout,
    suite: values.suite,
    method:
      'one untimed warmup per case; warm evaluation medians; no cross-machine ranking',
  })
);
const fixtures = { competition: cases, families, polynomials, reciprocal };
for (const [name, body, a, b, expected] of fixtures[
  values.suite as keyof typeof fixtures
]) {
  const request = ['Integrate', body, ['Limits', 'x', a, b]];
  try {
    ce.box(request).evaluate();
  } catch {
    /* Timed iterations record failures. */
  }
  const times: number[] = [];
  let result: unknown,
    error: string | undefined,
    exactMatch = true;
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    let value: Expression;
    try {
      value = ce.box(request).evaluate();
    } catch (e) {
      times.push(performance.now() - start);
      error = String(e);
      exactMatch = false;
      continue;
    }
    times.push(performance.now() - start);
    result = value.json;
    try {
      exactMatch =
        exactMatch &&
        exactLeaves(value) &&
        !value.has('Integrate') &&
        ce
          .function('Subtract', [value, ce.box(expected)])
          .simplify()
          .isSame(0);
    } catch (e) {
      error = `Reference comparison failed: ${String(e)}`;
      exactMatch = false;
    }
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      kind: 'case',
      name,
      medianMs: times[Math.floor(times.length / 2)],
      timesMs: times,
      exactMatch,
      result,
      error,
    })
  );
  if (!exactMatch) process.exitCode = 1;
}
