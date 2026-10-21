import { factoringCorpus } from './corpus.js';
import { factorRationalPolynomial } from '../../src/compute-engine/polynomial/factor-rational.js';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field.js';

// Run with Node --cpu-prof. The selected general family has no repeated
// factors, so square-free preprocessing should not dominate factorization.
const cases = factoringCorpus(120).filter(
  (c) => c.family === 'eisenstein-products'
);
for (let repeat = 0; repeat < 3; repeat++)
  for (const c of cases) {
    const result = factorRationalPolynomial(
      c.coefficients.map(([n, d]) => q(BigInt(n), BigInt(d)))
    );
    if (result.status !== 'complete')
      throw new Error(`${c.id}: ${result.status}`);
  }
console.log(`Profiled ${cases.length * 3} complete factorizations`);
