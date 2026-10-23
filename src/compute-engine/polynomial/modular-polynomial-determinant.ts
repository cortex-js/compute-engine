import {
  integerGcd,
  PolynomialBudgetExceeded,
  rationalCoefficient as q,
  type PolynomialWork,
  type RationalCoefficient,
} from './exact-field.js';
import { SmallPrimePolynomials } from './small-prime.js';

/**
 * Determinant of a rational-polynomial matrix by evaluation, interpolation and
 * CRT. Row denominator clearing and the Leibniz L1 bound give a proven stopping
 * modulus; no stabilization heuristic is used to certify coefficients.
 */
export function modularPolynomialDeterminant(
  matrix: readonly (readonly (readonly RationalCoefficient[])[])[],
  work: PolynomialWork
): RationalCoefficient[] {
  const n = matrix.length;
  if (!n) return [q(1n)];
  if (matrix.some((row) => row.length !== n))
    throw new RangeError('Expected a square matrix');
  let denominator = 1n,
    bound = 1n,
    degree = 0;
  const integers = matrix.map((row, index) => {
    let d = 1n,
      maxDegree = 0;
    for (const p of row)
      for (const c of p) {
        work.tick();
        d = (d / integerGcd(d, c.denominator)) * c.denominator;
      }
    denominator *= d;
    let maxNorm = 0n;
    const entries = row.map((p) => {
      maxDegree = Math.max(maxDegree, p.length - 1);
      const a = p.map((c) => c.numerator * (d / c.denominator));
      const norm = a.reduce((s, c) => s + (c < 0n ? -c : c), 0n);
      if (norm > maxNorm) maxNorm = norm;
      return a;
    });
    degree += maxDegree;
    bound *= BigInt(index + 1) * maxNorm;
    return entries;
  });
  if (!bound) return [];
  // Interpolation nodes must be distinct; these primes also keep each
  // multiply-add exact within JavaScript's integer significand.
  let prime = 65521,
    modulus = 1n;
  const coefficients = Array<bigint>(degree + 1).fill(0n);
  while (modulus <= 2n * bound) {
    while (true) {
      let isPrime = true;
      for (let d = 2; d * d <= prime; d++)
        if (prime % d === 0) {
          isPrime = false;
          break;
        }
      if (isPrime) break;
      prime--;
    }
    // The primes descend from 65521. The interpolation needs a prime above
    // the degree, and a large bound consumes many primes, so a large enough
    // input exhausts them. That is a limit of this method, not invalid
    // input: callers report it as an incomplete result.
    if (prime <= degree || prime < 2)
      throw new PolynomialBudgetExceeded('determinant-prime-limit');
    const R = new SmallPrimePolynomials(prime, work),
      F = R.field;
    const reduced = integers.map((row) => row.map((p) => p.map(F.fromInteger)));
    const values: number[] = [];
    for (let x = 0; x <= degree; x++) {
      const a = reduced.map((row) =>
        row.map((p) => {
          let value = 0;
          work.tick(p.length);
          for (let i = p.length - 1; i >= 0; i--)
            value = F.add(F.mul(value, x), p[i]);
          return value;
        })
      );
      let det = 1;
      for (let k = 0; k < n; k++) {
        let pivot = k;
        while (pivot < n && !a[pivot][k]) pivot++;
        if (pivot === n) {
          det = 0;
          break;
        }
        if (pivot !== k) {
          [a[k], a[pivot]] = [a[pivot], a[k]];
          det = F.neg(det);
        }
        det = F.mul(det, a[k][k]);
        const inverse = F.inv(a[k][k]);
        for (let i = k + 1; i < n; i++) {
          const c = F.mul(a[i][k], inverse);
          work.tick(n - k);
          for (let j = k + 1; j < n; j++)
            a[i][j] = F.add(a[i][j], F.neg(F.mul(c, a[k][j])));
        }
      }
      values.push(det);
    }
    // Forward differences give sum Delta^k f(0) * binomial(x,k).
    let polynomial: number[] = [],
      basis = [1];
    for (let k = 0; k <= degree; k++) {
      polynomial = R.add(polynomial, R.scale(basis, values[0]));
      for (let i = 0; i < degree - k; i++)
        values[i] = F.add(values[i + 1], F.neg(values[i]));
      if (k < degree)
        basis = R.scale(R.mul(basis, [F.neg(k), 1]), F.inv(k + 1));
    }
    const inverse = F.inv(F.fromInteger(modulus));
    for (let i = 0; i <= degree; i++) {
      work.tick();
      const correction = F.mul(
        F.add(polynomial[i] ?? 0, F.neg(F.fromInteger(coefficients[i]))),
        inverse
      );
      coefficients[i] += modulus * BigInt(correction);
    }
    modulus *= BigInt(prime--);
  }
  const result = coefficients.map((c) =>
    q(c > modulus / 2n ? c - modulus : c, denominator)
  );
  while (result.length && !result.at(-1)!.numerator) result.pop();
  return result;
}
