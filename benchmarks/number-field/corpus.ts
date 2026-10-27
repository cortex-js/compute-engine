import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field.js';
import {
  FieldPolynomials,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field.js';
import { SmallPrimePolynomials } from '../../src/compute-engine/polynomial/small-prime.js';
import { extendedCases } from './extended-corpus.js';

export type Rational = [string, string];
export type Element = Rational[];
export interface Case {
  id: string;
  family: string;
  modulus: Rational[];
  coefficients: Element[];
  expected: {
    coefficient: Element;
    factors: { coefficients: Element[]; multiplicity: number }[];
  };
  provenance?: {
    kind: 'generated' | 'published' | 'adapted';
    source?: string;
    description: string;
    irreducibility: string;
  };
}

export type CorpusKind = 'regular' | 'challenge' | 'extended';

/** Generated inputs; linearity and unramified Eisenstein certify the factors. */
export function corpus(kind: CorpusKind = 'regular'): Case[] {
  if (kind === 'extended') return [...corpus('challenge'), ...extendedCases()];
  const result: Case[] = [];
  const moduli = [
    [-2, 0, 1],
    [1, 0, 1],
    [-2, 0, 0, 1],
    [-2, 0, 0, 0, 1],
    [-1, -1, 0, 0, 0, 1],
    [-2, 0, 0, 0, 0, 0, 1],
    [-2, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ];
  if (kind === 'challenge')
    for (const degree of [10, 12, 16])
      moduli.push([-2, ...Array<number>(degree - 1).fill(0), 1]);
  for (const [index, modulus] of moduli.entries()) {
    const K = RationalNumberField.create(modulus.map((n) => q(BigInt(n))));
    const P = new FieldPolynomials(K);
    const encode = (a: typeof K.one): Element =>
      a.coefficients.map((c) => [String(c.numerator), String(c.denominator)]);
    for (
      let variant = 0;
      variant < (kind === 'challenge' ? 10 : 6);
      variant++
    ) {
      const linear = [
        K.add(K.generator, K.fromInteger(BigInt(variant + 1))),
        K.one,
      ];
      const other = [
        K.add(K.mul(K.generator, K.generator), K.fromInteger(-3n)),
        K.one,
      ];
      const prime = 101 + (variant % 2) * 2;
      const F = new SmallPrimePolynomials(prime);
      const m = F.fromIntegers(modulus.map(BigInt));
      if (F.gcd(m, F.derivative(m)).length !== 1)
        throw new Error('Ramified Eisenstein prime');
      // A square-free reduction of the monic integral field polynomial makes
      // p unramified. At every prime over p, this polynomial is Eisenstein.
      const nonlinear = [
        K.fromInteger(BigInt(prime)),
        K.mul(K.fromInteger(BigInt(prime)), K.generator),
        ...(variant === 5 ? [K.zero] : []),
        K.one,
      ];
      let factors =
        variant < 3
          ? [
              { coefficients: linear, multiplicity: variant === 1 ? 3 : 1 },
              { coefficients: other, multiplicity: 1 },
            ]
          : [
              { coefficients: nonlinear, multiplicity: variant === 4 ? 2 : 1 },
              { coefficients: linear, multiplicity: 1 },
            ];
      let coefficient =
        variant === 2 ? K.element([q(1n, 3n), q(2n, 5n)]) : K.one;
      if (variant === 6)
        factors = [
          {
            coefficients: [nonlinear[0], nonlinear[1], K.zero, K.zero, K.one],
            multiplicity: 1,
          },
        ];
      if (variant === 7) {
        const R = new SmallPrimePolynomials(107);
        const m = R.fromIntegers(modulus.map(BigInt));
        if (R.gcd(m, R.derivative(m)).length !== 1)
          throw new Error('Ramified second Eisenstein prime');
        factors = [
          { coefficients: nonlinear, multiplicity: 1 },
          {
            coefficients: [
              K.fromInteger(107n),
              K.mul(K.fromInteger(107n), K.generator),
              K.one,
            ],
            multiplicity: 1,
          },
        ];
      }
      if (variant === 8) {
        factors = [
          { coefficients: nonlinear, multiplicity: 2 },
          {
            coefficients: [K.element([q(1n << 40n, 101n), q(1n, 103n)]), K.one],
            multiplicity: 1,
          },
        ];
        coefficient = K.element([q(-7n, 13n), q(2n, 17n)]);
      }
      if (variant === 9)
        factors = Array.from({ length: 9 }, (_, i) => ({
          coefficients: [
            K.add(
              K.mul(K.generator, K.generator),
              K.fromInteger(BigInt(i + 1))
            ),
            K.one,
          ],
          multiplicity: 1,
        }));
      let input = [coefficient];
      for (const f of factors)
        for (let i = 0; i < f.multiplicity; i++)
          input = P.mul(input, f.coefficients);
      result.push({
        id: `field-${index}-case-${variant}`,
        family: [
          'linear',
          'repeated-linear',
          'nonmonic-rational',
          'eisenstein-quadratic',
          'repeated-nonlinear',
          'eisenstein-cubic',
          'irreducible-quartic',
          'nonlinear-products',
          'large-denominators',
          'many-linear-factors',
        ][variant],
        modulus: modulus.map((n) => [String(n), '1']),
        coefficients: input.map(encode),
        expected: {
          coefficient: encode(coefficient),
          factors: factors.map((f) => ({
            coefficients: f.coefficients.map(encode),
            multiplicity: f.multiplicity,
          })),
        },
      });
    }
  }
  return result;
}
