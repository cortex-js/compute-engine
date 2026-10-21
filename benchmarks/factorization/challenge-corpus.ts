import type { FactoringCase } from './corpus.js';
import {
  FieldPolynomials,
  PolynomialWork,
  rationalField as Q,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field.js';

/** Orthogonal challenges: coefficient height, local splitting and many factors. */
export function challengeCorpus(): FactoringCase[] {
  const P = new FieldPolynomials(Q, new PolynomialWork(100_000_000));
  const cases: FactoringCase[] = [];
  const add = (family: string, factors: bigint[][]) => {
    const f = factors.reduce(
      (a, b) =>
        P.mul(
          a,
          b.map((c) => q(c))
        ),
      [Q.one]
    );
    cases.push({
      id: `challenge-${cases.length.toString().padStart(3, '0')}`,
      family,
      coefficients: f.map((c) => [String(c.numerator), String(c.denominator)]),
      expected: {
        coefficient: ['1', '1'],
        factors: factors.map((g) => ({
          coefficients: g.map(String),
          multiplicity: 1,
        })),
      },
    });
  };
  for (const degree of [4, 8, 12])
    for (const bits of [32, 64, 128, 256]) {
      for (const count of [2, 3]) {
        const height = 1n << BigInt(bits);
        add(
          'high-height-eisenstein-products',
          Array.from({ length: count }, (_, j) => {
            const f = Array<bigint>(degree + 1).fill(0n);
            // Eisenstein at 2 independently proves each supplied factor irreducible.
            f[0] = 2n * (2n * height + BigInt(2 * j + 1));
            f[1] = 2n * (height + BigInt(j));
            f[degree] = 1n;
            return f;
          })
        );
      }
    }
  const cyclotomic = (degree: number) => [
    1n,
    ...Array<bigint>(degree - 1).fill(0n),
    1n,
  ];
  for (const degree of [4, 8, 16, 32, 64]) {
    add('cyclotomic-local-splitting', [cyclotomic(degree)]);
    add('cyclotomic-products', [cyclotomic(degree / 2), cyclotomic(degree)]);
  }
  for (const count of [4, 8, 12, 16])
    add(
      'many-quadratic-factors',
      Array.from({ length: count }, (_, i) => [BigInt(i + 1), 0n, 1n])
    );
  // Products over all sign choices of sums of independent square roots.
  // Their orbit under the multiquadratic Galois group has size 2^k, proving
  // irreducibility. Each unramified modular factor has degree at most two.
  let swinnerton = [0n, 1n];
  for (const prime of [2n, 3n, 5n, 7n, 11n, 13n]) {
    const a = Array<bigint>(swinnerton.length).fill(0n);
    const b = Array<bigint>(swinnerton.length).fill(0n);
    for (let i = 0; i < swinnerton.length; i++) {
      let binomial = 1n;
      for (let j = 0; j <= i; j++) {
        (j % 2 ? b : a)[i - j] +=
          swinnerton[i] * binomial * prime ** BigInt(Math.floor(j / 2));
        binomial = (binomial * BigInt(i - j)) / BigInt(j + 1);
      }
    }
    const A = a.map((c) => q(c)),
      B = b.map((c) => q(c));
    swinnerton = P.sub(P.mul(A, A), P.scale(P.mul(B, B), q(prime))).map(
      (c) => c.numerator
    );
    if (swinnerton.length >= 9) add('swinnerton-dyer', [swinnerton]);
  }
  return cases;
}
