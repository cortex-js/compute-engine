import { factoringCorpus } from './corpus.js';
import { stressCorpus } from './stress-corpus.js';
import { parseArgs } from 'node:util';
import { factorRationalPolynomial } from '../../src/compute-engine/polynomial/factor-rational.js';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field.js';

// Run with Node --cpu-prof; setup and corpus generation are also profiled.
const { values } = parseArgs({
  options: {
    corpus: { type: 'string', default: 'regular' },
    id: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    operations: { type: 'string', default: '2000000' },
  },
});
if (!['regular', 'stress'].includes(values.corpus!))
  throw new Error('Unknown corpus');
const cases = (
  values.corpus === 'stress' ? stressCorpus() : factoringCorpus(120)
).filter((c) =>
  values.id
    ? c.id === values.id
    : values.corpus === 'stress' || c.family === 'eisenstein-products'
);
if (!cases.length) throw new Error('No matching cases');
const repeats = Number(values.repeats),
  operations = Number(values.operations);
if (
  !Number.isSafeInteger(repeats) ||
  repeats < 1 ||
  !Number.isSafeInteger(operations) ||
  operations < 0
)
  throw new Error('Invalid profile options');
for (let repeat = 0; repeat < repeats; repeat++)
  for (const c of cases) {
    const result = factorRationalPolynomial(
      c.coefficients.map(([n, d]) => q(BigInt(n), BigInt(d))),
      { maxOperations: operations }
    );
    if (values.corpus === 'stress' || values.id)
      console.log(
        JSON.stringify({
          id: c.id,
          status: result.status,
          reason: result.reason,
          statistics: result.statistics,
        })
      );
  }
console.log(`Profiled ${cases.length * repeats} factorizations`);
