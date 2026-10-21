import type { FactoringCase } from './corpus.js';
import {
  FieldPolynomials,
  PolynomialWork,
  rationalField as Q,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field.js';

/** Theorem-certified factors, including cases intentionally beyond default limits. */
export function stressCorpus(): FactoringCase[] {
  const P = new FieldPolynomials(Q, new PolynomialWork(100_000_000));
  const cases: FactoringCase[] = [];
  const add = (
    family: string,
    factors: bigint[][],
    multiplicities = factors.map(() => 1)
  ) => {
    let polynomial = [Q.one];
    factors.forEach((f, i) => {
      for (let k = 0; k < multiplicities[i]; k++)
        polynomial = P.mul(
          polynomial,
          f.map((c) => q(c))
        );
    });
    cases.push({
      id: `stress-${cases.length.toString().padStart(3, '0')}`,
      family,
      coefficients: polynomial.map((c) => [
        String(c.numerator),
        String(c.denominator),
      ]),
      expected: {
        coefficient: ['1', '1'],
        factors: factors.map((f, i) => ({
          coefficients: f.map(String),
          multiplicity: multiplicities[i],
        })),
      },
    });
  };
  const cyclotomic = new Map<number, bigint[]>();
  for (let n = 1; n <= 128; n++) {
    let f = Array<bigint>(n + 1).fill(0n);
    f[0] = -1n;
    f[n] = 1n;
    for (let d = 1; d < n; d++)
      if (n % d === 0) {
        f = P.exactDivide(
          f.map((c) => q(c)),
          cyclotomic.get(d)!.map((c) => q(c))
        ).map((c) => {
          if (c.denominator !== 1n)
            throw new Error('Nonintegral cyclotomic polynomial');
          return c.numerator;
        });
      }
    cyclotomic.set(n, f);
  }
  for (const n of [8, 12, 16, 24, 30, 32, 48, 60, 64, 96, 128]) {
    add(
      'roots-of-unity',
      [...cyclotomic].filter(([d]) => n % d === 0).map(([, f]) => f)
    );
    add('cyclotomic-irreducible', [cyclotomic.get(n)!]);
  }
  for (const n of [12, 24, 48, 64, 96, 128]) {
    const f = Array<bigint>(n + 1).fill(0n);
    f[0] = 2n;
    f[n] = 1n;
    add('high-degree-eisenstein', [f]);
  }
  for (const n of [6, 12, 24, 48]) {
    add(
      'clustered-integer-roots',
      Array.from({ length: n }, (_, i) => [-(10n ** 6n + BigInt(i)), 1n])
    );
    add(
      'repeated-nonmonic',
      [
        [1n, 3n],
        [1n, 1n, 5n],
      ],
      [n, n]
    );
  }
  for (const bits of [256, 512, 1024, 2048, 4096, 8192])
    add('coefficient-growth', [
      [1n, 1n << BigInt(bits)],
      [1n, 1n, 1n],
    ]);
  return cases;
}
