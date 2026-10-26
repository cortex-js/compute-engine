import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { corpus, type CorpusKind } from './corpus.js';
import {
  RationalNumberField,
  factorNumberFieldPolynomial,
} from '../../src/compute-engine/polynomial/number-field.js';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field.js';

const { values } = parseArgs({
  options: {
    id: { type: 'string', default: 'field-4-case-3' },
    repeats: { type: 'string', default: '3' },
    corpus: { type: 'string', default: 'regular' },
  },
});
if (!['regular', 'challenge', 'extended'].includes(values.corpus!))
  throw new Error('Unknown corpus');
const repeats = Number(values.repeats);
if (!Number.isSafeInteger(repeats) || repeats < 1)
  throw new Error('Invalid repeat count');
const c = corpus(values.corpus as CorpusKind).find((c) => c.id === values.id);
if (!c) throw new Error('Unknown case');
const K = RationalNumberField.create(
  c.modulus.map(([n, d]) => q(BigInt(n), BigInt(d)))
);
const input = c.coefficients.map((e) =>
  K.element(e.map(([n, d]) => q(BigInt(n), BigInt(d))))
);
for (let i = 0; i < repeats; i++) {
  const started = performance.now();
  const r = factorNumberFieldPolynomial(K, input, {
    profile: true,
    check: () => {
      if (performance.now() - started > 10000)
        throw new Error('Profile deadline');
    },
  });
  console.log(
    JSON.stringify({
      status: r.status,
      reason: r.reason,
      operations: r.operations,
      ms: performance.now() - started,
      statistics: r.statistics,
    })
  );
}
