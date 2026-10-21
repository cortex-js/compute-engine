import {
  FieldPolynomials,
  PolynomialWork,
  type ExactField,
} from './exact-field.js';

export function primeField(prime: number): ExactField<bigint> {
  if (!Number.isSafeInteger(prime) || prime < 2 || prime > 65521)
    throw new RangeError('Prime must be at most 65521');
  for (let d = 2; d * d <= prime; d++)
    if (prime % d === 0) throw new RangeError('Composite field characteristic');
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
  const K = primeField(prime),
    P = new FieldPolynomials(K, work);
  const f = P.trim(input.map(K.fromInteger));
  if (f.length < 2 || f[f.length - 1] !== 1n)
    throw new RangeError('Expected a monic nonconstant polynomial');
  if (P.gcd(f, P.derivative(f)).length !== 1)
    throw new RangeError('Expected a square-free polynomial');
  const n = f.length - 1;
  const matrix = Array.from({ length: n }, () => Array<bigint>(n).fill(0n));
  const xp = P.powmod([0n, 1n], BigInt(prime), f);
  let column = [1n];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++)
      matrix[i][j] = K.add(column[i] ?? 0n, i === j ? -1n : 0n);
    column = P.divrem(P.mul(column, xp), f)[1];
  }
  const pivots: number[] = [];
  for (let j = 0; j < n; j++) {
    const r = pivots.length;
    let k = r;
    while (k < n && matrix[k][j] === 0n) k++;
    if (k === n) continue;
    [matrix[r], matrix[k]] = [matrix[k], matrix[r]];
    const inverse = K.inv(matrix[r][j]);
    matrix[r] = matrix[r].map((c) => K.mul(c, inverse));
    for (let i = 0; i < n; i++) {
      if (i === r || matrix[i][j] === 0n) continue;
      work.tick(n);
      const c = matrix[i][j];
      matrix[i] = matrix[i].map((v, h) =>
        K.add(v, K.neg(K.mul(c, matrix[r][h])))
      );
    }
    pivots.push(j);
  }
  const basis: bigint[][] = [];
  for (let j = 0; j < n; j++) {
    if (pivots.includes(j)) continue;
    const v = Array<bigint>(n).fill(0n);
    v[j] = 1n;
    for (let i = 0; i < pivots.length; i++) v[pivots[i]] = K.neg(matrix[i][j]);
    basis.push(P.trim(v));
  }
  let factors = [f];
  for (const b of basis) {
    for (let s = 0; s < prime && factors.length < basis.length; s++) {
      const next: bigint[][] = [];
      for (const g of factors) {
        const d = P.gcd(g, P.sub(b, [BigInt(s)]));
        if (d.length > 1 && d.length < g.length)
          next.push(d, P.exactDivide(g, d));
        else next.push(g);
      }
      factors = next;
    }
  }
  if (factors.length !== basis.length)
    throw new Error('Incomplete Berlekamp decomposition');
  return factors;
};
