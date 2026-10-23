import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  PolynomialInvariantError,
  type ExactField,
  type PolynomialWork,
} from './exact-field.js';
import { SmallPrimePolynomials } from './small-prime.js';

/** Frobenius irreducibility test, checking every possible proper factor degree. */
export function isIrreducibleModPrime(
  modulus: readonly number[],
  P: SmallPrimePolynomials
): boolean {
  const n = modulus.length - 1;
  if (n < 1 || modulus[n] !== 1) return false;
  const x = P.divrem([0, 1], modulus)[1];
  let h = x;
  for (let i = 1; i <= n; i++) {
    h = P.powmod(h, BigInt(P.prime), modulus);
    if (i <= Math.floor(n / 2) && P.gcd(modulus, P.sub(h, x)).length > 1)
      return false;
  }
  return !P.sub(h, x).length;
}

/** Exact F_p[a]/m arithmetic; construction certifies that m is irreducible. */
export function finiteExtension(
  modulus: readonly number[],
  prime: number,
  work: PolynomialWork
): ExactField<number[]> | undefined {
  const P = new SmallPrimePolynomials(prime, work);
  const m = P.trim(modulus),
    n = m.length - 1;
  if (!isIrreducibleModPrime(m, P)) return undefined;
  return {
    zero: [],
    one: [1],
    isZero: (a) => !a.length,
    fromInteger: (a) => P.trim([P.field.fromInteger(a)]),
    add: (a, b) => P.add(a, b),
    neg: (a) => P.scale(a, prime - 1),
    inv: (a) => (a.length === 1 ? [P.field.inv(a[0])] : P.inverseMod(a, m)),
    mul: (a, b) => {
      if (!a.length || !b.length) return [];
      if (a.length === 1) return P.scale(b, a[0]);
      if (b.length === 1) return P.scale(a, b[0]);
      const r = P.mul(a, b);
      // The fixed monic modulus needs no Euclidean division or inversion.
      for (let i = r.length - 1; i >= n; i--) {
        if (!r[i]) continue;
        work.tick(n);
        const c = r[i];
        for (let j = 0; j < n; j++)
          r[i - n + j] = P.field.add(
            r[i - n + j],
            P.field.neg(P.field.mul(c, m[j] ?? 0))
          );
      }
      return P.trim(r.slice(0, n));
    },
  };
}

/**
 * Absolute Berlekamp factorization. The fixed space of p-Frobenius on
 * F_(p^d)[x]/f has dimension equal to the number of irreducible factors over
 * F_(p^d). Working over F_p avoids exponentiation by p^d during splitting.
 */
export function factorFiniteExtension(
  input: readonly number[][],
  P: FieldPolynomials<number[]>,
  prime: number,
  extensionDegree: number
): number[][][] {
  const f = P.trim(input),
    K = P.field;
  if (f.length < 2 || P.sub([f.at(-1)!], [K.one]).length !== 0)
    throw new RangeError('Expected a monic nonconstant polynomial');
  if (P.gcd(f, P.derivative(f)).length !== 1)
    throw new RangeError('Expected square-free reduction');
  const n = f.length - 1,
    d = extensionDegree,
    dimension = n * d;
  if (n === 1) return [f];
  if (dimension > 512)
    throw new PolynomialBudgetExceeded('finite-extension-dimension-limit');
  P.work.tick(dimension * dimension);
  const B = new SmallPrimePolynomials(prime, P.work),
    F = B.field;
  const matrix = Array.from({ length: dimension }, () =>
    Array<number>(dimension).fill(0)
  );
  const xp = P.powmod([K.zero, K.one], BigInt(prime), f);
  const alpha = d === 1 ? K.one : [0, 1];
  let ap = K.one,
    base = alpha,
    exponent = prime;
  while (exponent) {
    if (exponent % 2) ap = K.mul(ap, base);
    exponent = Math.floor(exponent / 2);
    if (exponent) base = K.mul(base, base);
  }
  const powers = [K.one];
  for (let j = 1; j < d; j++) powers.push(K.mul(powers[j - 1], ap));
  let xColumn = [K.one];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const column = P.scale(xColumn, powers[j]),
        index = i * d + j;
      for (let k = 0; k < n; k++)
        for (let h = 0; h < d; h++)
          matrix[k * d + h][index] = column[k]?.[h] ?? 0;
      matrix[index][index] = F.add(matrix[index][index], prime - 1);
    }
    if (i + 1 < n) xColumn = P.divrem(P.mul(xColumn, xp), f)[1];
  }
  const pivots: number[] = [];
  for (let j = 0; j < dimension; j++) {
    const r = pivots.length;
    let pivot = r;
    while (pivot < dimension && !matrix[pivot][j]) pivot++;
    if (pivot === dimension) continue;
    [matrix[pivot], matrix[r]] = [matrix[r], matrix[pivot]];
    const inverse = F.inv(matrix[r][j]);
    P.work.tick(dimension - j);
    for (let k = j; k < dimension; k++)
      matrix[r][k] = F.mul(matrix[r][k], inverse);
    for (let i = 0; i < dimension; i++) {
      if (i === r || !matrix[i][j]) continue;
      const c = matrix[i][j];
      P.work.tick(dimension - j);
      for (let k = j; k < dimension; k++)
        matrix[i][k] = F.add(matrix[i][k], F.neg(F.mul(c, matrix[r][k])));
    }
    pivots.push(j);
  }
  const basis: number[][][] = [];
  for (let j = 0; j < dimension; j++) {
    if (pivots.includes(j)) continue;
    const v = Array<number>(dimension).fill(0);
    v[j] = 1;
    for (let i = 0; i < pivots.length; i++) v[pivots[i]] = F.neg(matrix[i][j]);
    basis.push(
      P.trim(
        Array.from({ length: n }, (_, i) => B.trim(v.slice(i * d, (i + 1) * d)))
      )
    );
  }
  let result = [f];
  for (const b of basis) {
    if (b.length <= 1) continue;
    for (let s = 0; s < prime && result.length < basis.length; s++) {
      const next: number[][][] = [];
      for (const g of result) {
        if (g.length === 2) {
          next.push(g);
          continue;
        }
        const divisor = P.gcd(g, P.sub(b, [K.fromInteger(BigInt(s))]));
        if (divisor.length > 1 && divisor.length < g.length)
          next.push(divisor, P.exactDivide(g, divisor));
        else next.push(g);
      }
      result = next;
    }
  }
  if (result.length !== basis.length)
    throw new PolynomialInvariantError(
      'Incomplete finite extension Berlekamp decomposition'
    );
  const reconstructed = result.reduce((a, b) => P.mul(a, b), [K.one]);
  if (P.sub(reconstructed, f).length)
    throw new PolynomialInvariantError(
      'Finite extension factor reconstruction failed'
    );
  return result;
}
