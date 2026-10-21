import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from '../../src/compute-engine/polynomial/exact-field.js';

export interface FactoringCase {
  id: string;
  family: string;
  coefficients: [string, string][];
  /** All generated factors are irreducible by degree, discriminant or Eisenstein. */
  expected: {
    coefficient: [string, string];
    factors: { coefficients: string[]; multiplicity: number }[];
  };
}

export function factoringCorpus(count = 1200): FactoringCase[] {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new RangeError('Invalid corpus size');
  const P = new FieldPolynomials(Q, new PolynomialWork(1_000_000_000));
  let state = 1729;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const cases: FactoringCase[] = [];
  for (let index = 0; index < count; index++) {
    const kind = index % 6;
    const family = [
      'quadratic-products',
      'eisenstein-products',
      'repeated-factors',
      'nonmonic-rational',
      'large-coefficients',
      'irreducible',
    ][kind];
    const scalar = q(
      BigInt(index % 2 ? -index - 1 : index + 1),
      BigInt(kind === 3 ? 2 * index + 3 : 1)
    );
    let polynomial: RationalCoefficient[] = [scalar];
    const factors: { coefficients: string[]; multiplicity: number }[] = [];
    const number = kind === 5 ? 1 : 2 + (index % 3);
    for (let j = 0; j < number; j++) {
      let f: bigint[];
      if (kind === 1 || kind === 5) {
        const degree = 3 + (next() % 6);
        f = Array.from(
          { length: degree + 1 },
          () => 2n * BigInt(Number(next() % 11) - 5)
        );
        f[0] = 2n * BigInt(2 * (index + j + 1) + 1);
        f[degree] = 1n;
      } else if (kind === 4) {
        f = [
          -(2n ** BigInt(64 + (index % 192)) + BigInt(2 * index + j + 1)),
          1n,
        ];
      } else {
        const b = BigInt(next() % 11),
          a = BigInt(kind === 3 ? 2 * j + 1 : 1);
        f = [b * b + BigInt(index + j + 1), b, a];
        // A coefficient of one makes each nonmonic factor primitive.
        if (kind === 3) f[1] = 1n;
      }
      const multiplicity = kind === 2 ? 2 + (j % 2) : 1;
      for (let k = 0; k < multiplicity; k++)
        polynomial = P.mul(
          polynomial,
          f.map((c) => q(c))
        );
      factors.push({ coefficients: f.map(String), multiplicity });
    }
    cases.push({
      id: `factor-${index.toString().padStart(5, '0')}`,
      family,
      coefficients: polynomial.map((c) => [
        String(c.numerator),
        String(c.denominator),
      ]),
      expected: {
        coefficient: [String(scalar.numerator), String(scalar.denominator)],
        factors,
      },
    });
  }
  return cases;
}
