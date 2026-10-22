import {
  FieldPolynomials,
  integerGcd,
  rationalCoefficient as q,
  type ExactField,
  type PolynomialWork,
  type RationalCoefficient,
} from './exact-field.js';
import { SmallPrimePolynomials } from './small-prime.js';
import type {
  NumberFieldElement,
  RationalNumberField,
} from './number-field.js';

class UnusablePrime extends Error {}

/** A reduced finite quotient algebra; inversion rejects zero divisors. */
function quotientArithmetic(
  P: SmallPrimePolynomials,
  modulus: number[]
): ExactField<number[]> {
  return {
    zero: [],
    one: [1],
    add: (a, b) => P.add(a, b),
    neg: (a) => P.scale(a, P.prime - 1),
    mul: (a, b) => P.divrem(P.mul(a, b), modulus)[1],
    inv: (a) => {
      if (P.gcd(a, modulus).length !== 1) throw new UnusablePrime();
      return P.inverseMod(a, modulus);
    },
    isZero: (a) => !a.length,
    fromInteger: (a) => P.trim([P.field.fromInteger(a)]),
  };
}

function reduceRational(
  c: RationalCoefficient,
  P: SmallPrimePolynomials
): number {
  const denominator = P.field.fromInteger(c.denominator);
  if (!denominator) throw new UnusablePrime();
  return P.field.mul(
    P.field.fromInteger(c.numerator),
    P.field.inv(denominator)
  );
}

function sqrtFloor(n: bigint): bigint {
  if (n < 2n) return n;
  let a = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  while (true) {
    const b = (a + n / a) / 2n;
    if (b >= a) return a;
    a = b;
  }
}

/** Unique reduced a/b with |a|, b <= sqrt(M/2), when it exists. */
export function reconstructNumberFieldRational(
  residue: bigint,
  modulus: bigint
): RationalCoefficient | undefined {
  return numberFieldRationalReconstructor(modulus)(residue);
}

/** Reuse a precision's uniqueness bound across all coefficient coordinates. */
export function numberFieldRationalReconstructor(
  modulus: bigint
): (residue: bigint) => RationalCoefficient | undefined {
  if (modulus < 2n) throw new RangeError('Reconstruction modulus must be >= 2');
  const bound = sqrtFloor(modulus / 2n);
  return (residue) => {
    let r0 = modulus,
      r1 = residue,
      t0 = 0n,
      t1 = 1n;
    while (r1 > bound) {
      const quotient = r0 / r1;
      [r0, r1] = [r1, r0 - quotient * r1];
      [t0, t1] = [t1, t0 - quotient * t1];
    }
    if (
      !t1 ||
      (t1 < 0n ? -t1 : t1) > bound ||
      integerGcd(r1, t1) !== 1n ||
      integerGcd(t1, modulus) !== 1n
    )
      return undefined;
    const result = q(r1, t1);
    if ((result.numerator - residue * result.denominator) % modulus)
      return undefined;
    return result;
  };
}

/**
 * One-sided rejection in finite quotient algebras. A monic divisor survives
 * every defined reduction, even when the defining polynomial splits or is
 * ramified. Passing or encountering denominator primes proves nothing.
 */
export function numberFieldDivisibilityFilter(
  field: RationalNumberField,
  input: readonly NumberFieldElement[],
  work: PolynomialWork,
  excludedPrime?: number
): (candidate: readonly NumberFieldElement[]) => boolean {
  const reductions = [101, 103, 107]
    .filter((p) => p !== excludedPrime)
    .map((p) => {
      let cached:
        | {
            S: FieldPolynomials<number[]>;
            a: number[][];
            reduce: (cs: readonly NumberFieldElement[]) => number[][];
          }
        | null
        | undefined;
      return (
        candidate: readonly NumberFieldElement[]
      ): boolean | undefined => {
        try {
          if (cached === undefined) {
            cached = null;
            const R = new SmallPrimePolynomials(p, work);
            const m = R.trim(
              field.definingPolynomial.map((c) => reduceRational(c, R))
            );
            const S = new FieldPolynomials(quotientArithmetic(R, m), work);
            const reduce = (cs: readonly NumberFieldElement[]) =>
              S.trim(
                cs.map((c) => {
                  work.tick(c.coefficients.length);
                  return R.trim(
                    c.coefficients.map((v) => reduceRational(v, R))
                  );
                })
              );
            // Cache unavailable input reductions too; candidate denominators are
            // checked separately and must not disable this prime for later trials.
            cached = { S, a: reduce(input), reduce };
          }
          if (!cached) return undefined;
          const b = cached.reduce(candidate);
          if (!b.length || b.at(-1)!.length !== 1 || b.at(-1)![0] !== 1)
            return undefined;
          return !cached.S.divrem(cached.a, b)[1].length;
        } catch (e) {
          if (e instanceof UnusablePrime) return undefined;
          throw e;
        }
      };
    });
  return (candidate) => {
    for (const reduce of reductions) {
      const result = reduce(candidate);
      if (result !== undefined) return result;
    }
    return true;
  };
}

/**
 * CRT reconstruction in the supplied power basis. A good modular degree bounds
 * the characteristic-zero GCD from above; exact divisibility attains that bound.
 * Reducible field polynomials modulo p are allowed, but nonunit pivots are not.
 */
export function modularNumberFieldGcd(
  field: RationalNumberField,
  a: readonly NumberFieldElement[],
  b: readonly NumberFieldElement[],
  P: FieldPolynomials<NumberFieldElement>,
  work: PolynomialWork,
  maxPrimes = 32
): NumberFieldElement[] | undefined {
  let modulus = 1n,
    residues: bigint[][] = [],
    best = Infinity;
  let previousCandidate = '';
  let prime = 101;
  for (let attempt = 0; attempt < maxPrimes; attempt++) {
    while (true) {
      let isPrime = true;
      for (let d = 2; d * d <= prime; d++)
        if (prime % d === 0) {
          isPrime = false;
          break;
        }
      if (isPrime) break;
      prime++;
    }
    const p = prime++;
    work.tick();
    try {
      const R = new SmallPrimePolynomials(p, work);
      const m = R.trim(
        field.definingPolynomial.map((c) => reduceRational(c, R))
      );
      if (
        m.length !== field.degree + 1 ||
        R.gcd(m, R.derivative(m)).length !== 1
      )
        continue;
      const F = quotientArithmetic(R, m),
        S = new FieldPolynomials(F, work);
      const reduce = (cs: readonly NumberFieldElement[]) =>
        S.trim(
          cs.map((c) => R.trim(c.coefficients.map((v) => reduceRational(v, R))))
        );
      const am = reduce(a),
        bm = reduce(b);
      if (am.length !== a.length || bm.length !== b.length) continue;
      // Unit leading coefficients ensure degree preservation in every residue
      // field, even when the power-basis modulus splits modulo p.
      F.inv(am[am.length - 1]);
      F.inv(bm[bm.length - 1]);
      const g = S.gcd(am, bm),
        degree = g.length - 1;
      if (degree === 0) return [field.one];
      if (degree > best) continue;
      if (degree < best) {
        best = degree;
        modulus = 1n;
        previousCandidate = '';
        residues = Array.from({ length: g.length }, () =>
          Array<bigint>(field.degree).fill(0n)
        );
      }
      const inverse = R.field.inv(R.field.fromInteger(modulus));
      for (let i = 0; i < residues.length; i++)
        for (let j = 0; j < field.degree; j++) {
          work.tick();
          const old = residues[i][j];
          const correction = R.field.mul(
            R.field.add(g[i]?.[j] ?? 0, R.field.neg(R.field.fromInteger(old))),
            inverse
          );
          residues[i][j] = old + modulus * BigInt(correction);
        }
      modulus *= BigInt(p);
      const rational = residues.map((row) =>
        row.map((c) => reconstructNumberFieldRational(c, modulus))
      );
      if (rational.some((row) => row.some((c) => c === undefined))) continue;
      const signature = rational
        .map((row) =>
          row.map((c) => `${c!.numerator}/${c!.denominator}`).join(',')
        )
        .join(';');
      const stable = signature === previousCandidate;
      previousCandidate = signature;
      if (!stable) continue;
      const candidate = rational.map((row) =>
        field.element(row as RationalCoefficient[], work)
      );
      // Stability avoids expensive trial division at inadequate precision.
      // It is not a certificate: both exact divisions are still required.
      if (
        !P.divrem(a, candidate)[1].length &&
        !P.divrem(b, candidate)[1].length
      )
        return candidate;
    } catch (e) {
      if (!(e instanceof UnusablePrime)) throw e;
    }
  }
  return undefined;
}
