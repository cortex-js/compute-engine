import {
  RationalNumberField,
  factorNumberFieldPolynomial,
} from '../../src/compute-engine/polynomial/number-field.js';
import {
  FieldPolynomials,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field.js';
// A focused strategy ablation, separate from the full public coverage run.
for (const m of [
  [-2, 0, 1],
  [-2, 0, 0, 1],
  [1, 0, 0, 0, 1],
]) {
  const K = RationalNumberField.create(m.map((c) => q(BigInt(c))));
  const P = new FieldPolynomials(K);
  const f = P.mul([K.one, K.zero, K.one], [K.fromInteger(3n), K.zero, K.one]);
  for (let trial = 0; trial < 3; trial++) {
    const start = performance.now();
    const r = factorNumberFieldPolynomial(K, f, {
      numberFieldStrategy: 'trager',
      profile: true,
      maxOperations: 20_000_000,
    });
    const actual = r.factors.reduce(
      (a, g) => {
        for (let i = 0; i < g.multiplicity; i++) a = P.mul(a, g.coefficients);
        return a;
      },
      [r.coefficient]
    );
    if (r.status !== 'complete' || P.sub(actual, f).length)
      throw new Error('Unverified norm result');
    console.log(
      JSON.stringify({
        modulus: m,
        trial,
        ms: performance.now() - start,
        operations: r.operations,
        statistics: r.statistics,
      })
    );
  }
}
