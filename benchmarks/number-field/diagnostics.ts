import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ComputeEngine,
  factorDetailed,
  type ExpressionInput,
} from '../../src/compute-engine.js';
import { decodePublicFactor, verify } from './verify.js';
import type { Case, Element, Rational } from './corpus.js';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.baseline || !values.output)
  throw new Error('Supply baseline and fresh output');
mkdirSync(values.output);
const cases: Case[] = JSON.parse(
  readFileSync(join(values.baseline, 'corpus.json'), 'utf8')
);
const rows = readFileSync(join(values.baseline, 'results.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((s) => JSON.parse(s));
const ids = new Set<string>(
  rows.filter((r) => r.status !== 'verified').map((r) => r.id)
);
const q = ([n, d]: Rational): ExpressionInput => [
  'Rational',
  { num: n },
  { num: d },
];
for (const c of cases.filter((c) => ids.has(c.id))) {
  const ce = new ComputeEngine();
  const g: ExpressionInput = [
    'AlgebraicGenerator',
    ['List', ...c.modulus.map(q)],
  ];
  const coefficient = (e: Element): ExpressionInput => [
    'Add',
    ...e.map((a, j): ExpressionInput => ['Multiply', q(a), ['Power', g, j]]),
  ];
  const input = ce.expr([
    'Add',
    ...c.coefficients.map((e, j): ExpressionInput => [
      'Multiply',
      coefficient(e),
      ['Power', 'x', j],
    ]),
  ]);
  const start = performance.now();
  let record: object;
  try {
    const r = ce.withTimeLimit(15000, () =>
      factorDetailed(input, { variable: 'x', generator: g, profile: true })
    );
    if (r.status === 'complete')
      verify(c, decodePublicFactor(c.modulus, r.expression.json));
    record = {
      id: c.id,
      status: r.status,
      reason: 'reason' in r ? r.reason : undefined,
      statistics: r.statistics,
      milliseconds: performance.now() - start,
    };
  } catch (e) {
    record = {
      id: c.id,
      error: String(e),
      milliseconds: performance.now() - start,
    };
  }
  writeFileSync(
    join(values.output, c.id + '.json'),
    JSON.stringify(record, null, 2)
  );
  console.log(JSON.stringify(record));
}
