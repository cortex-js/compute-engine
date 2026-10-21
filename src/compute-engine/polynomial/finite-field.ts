import { PolynomialWork, type ExactField } from './exact-field.js';
import { checkSmallPrime, SmallPrimePolynomials } from './small-prime.js';

export function primeField(prime: number): ExactField<bigint> {
  checkSmallPrime(prime);
  const p = BigInt(prime);
  const mod = (a: bigint) => ((a % p) + p) % p;
  return {
    zero: 0n,
    one: 1n,
    add: (a, b) => mod(a + b),
    neg: (a) => mod(-a),
    mul: (a, b) => mod(a * b),
    inv: (a) => {
      let r = p,
        s = mod(a),
        u = 0n,
        v = 1n;
      if (!s) throw new RangeError('Division by zero in prime field');
      while (s) {
        const q = r / s;
        [r, s] = [s, r - q * s];
        [u, v] = [v, u - q * v];
      }
      return mod(u);
    },
    isZero: (a) => mod(a) === 0n,
    fromInteger: mod,
  };
}

/** Backends accept monic square-free polynomials over the specified prime field. */
export type ModularFactorBackend = (
  f: readonly bigint[],
  prime: number,
  work: PolynomialWork
) => bigint[][];

/** Deterministic Berlekamp factorization, including characteristic two. */
export const factorFiniteField: ModularFactorBackend = (input, prime, work) => {
  const P = new SmallPrimePolynomials(prime, work),
    K = P.field;
  const f = P.fromIntegers(input);
  if (f.length < 2 || f[f.length - 1] !== 1)
    throw new RangeError('Expected a monic nonconstant polynomial');
  if (P.gcd(f, P.derivative(f)).length !== 1)
    throw new RangeError('Expected a square-free polynomial');
  const n = f.length - 1;
  if (n === 1) return [f.map(BigInt)];
  const matrix = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const xp = P.powmod([0, 1], BigInt(prime), f);
  let column = [1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++)
      matrix[i][j] = K.add(column[i] ?? 0, i === j ? prime - 1 : 0);
    column = P.divrem(P.mul(column, xp), f)[1];
  }
  const pivots: number[] = [];
  for (let j = 0; j < n; j++) {
    const r = pivots.length;
    let k = r;
    while (k < n && matrix[k][j] === 0) k++;
    if (k === n) continue;
    [matrix[r], matrix[k]] = [matrix[k], matrix[r]];
    const inverse = K.inv(matrix[r][j]);
    for (let h = j; h < n; h++) matrix[r][h] = K.mul(matrix[r][h], inverse);
    for (let i = 0; i < n; i++) {
      if (i === r || matrix[i][j] === 0) continue;
      work.tick(n - j);
      const c = matrix[i][j];
      for (let h = j; h < n; h++) {
        const v = (matrix[i][h] - c * matrix[r][h]) % prime;
        matrix[i][h] = v < 0 ? v + prime : v === 0 ? 0 : v;
      }
    }
    pivots.push(j);
  }
  const basis: number[][] = [];
  for (let j = 0; j < n; j++) {
    if (pivots.includes(j)) continue;
    const v = Array<number>(n).fill(0);
    v[j] = 1;
    for (let i = 0; i < pivots.length; i++) v[pivots[i]] = K.neg(matrix[i][j]);
    basis.push(P.trim(v));
  }
  let factors = [f];
  for (const b of basis) {
    if (b.length <= 1) continue;
    for (let s = 0; s < prime && factors.length < basis.length; s++) {
      const next: number[][] = [];
      for (const g of factors) {
        if (g.length === 2) {
          next.push(g);
          continue;
        }
        const d = P.gcd(g, P.sub(b, [s]));
        if (d.length > 1 && d.length < g.length)
          next.push(d, P.exactDivide(g, d));
        else next.push(g);
      }
      factors = next;
    }
  }
  if (factors.length !== basis.length)
    throw new Error('Incomplete Berlekamp decomposition');
  return factors.map((g) => g.map(BigInt));
};
