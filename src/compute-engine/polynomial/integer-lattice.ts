import {
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient as Rational,
} from './exact-field.js';

const sub = (a: Rational, b: Rational) => Q.add(a, Q.neg(b));
const divide = (a: Rational, b: Rational) => Q.mul(a, Q.inv(b));
const less = (a: Rational, b: Rational) =>
  a.numerator * b.denominator < b.numerator * a.denominator;
const nearest = (a: Rational) => {
  const n = a.numerator,
    d = a.denominator;
  return n < 0n ? -((-2n * n + d) / (2n * d)) : (2n * n + d) / (2n * d);
};

/** Exact Gram-Schmidt data without constructing rational orthogonal vectors. */
export function integerGramSchmidt(
  basis: readonly (readonly bigint[])[],
  work: PolynomialWork
) {
  const n = basis.length,
    width = basis[0]?.length ?? 0;
  if (!n || n > width || basis.some((r) => r.length !== width))
    throw new RangeError(
      'Expected a nonempty rectangular independent row basis'
    );
  work.tick(n * n);
  const mu = Array.from({ length: n }, () => Array<Rational>(n).fill(Q.zero));
  const norms: Rational[] = [];
  const dot = (a: readonly bigint[], b: readonly bigint[]) => {
    work.tick(width);
    return q(a.reduce((s, x, i) => s + x * b[i], 0n));
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      let value = dot(basis[i], basis[j]);
      for (let k = 0; k < j; k++) {
        work.tick();
        value = sub(value, Q.mul(Q.mul(mu[i][k], mu[j][k]), norms[k]));
      }
      mu[i][j] = divide(value, norms[j]);
    }
    let norm = dot(basis[i], basis[i]);
    for (let j = 0; j < i; j++) {
      work.tick();
      norm = sub(norm, Q.mul(Q.mul(mu[i][j], mu[i][j]), norms[j]));
    }
    if (norm.numerator <= 0n)
      throw new RangeError('Linearly dependent lattice basis');
    norms.push(norm);
  }
  return { mu, norms };
}

export interface IntegerLatticeReduction {
  basis: bigint[][];
  /** Unimodular row transformation: basis = transformation * input. */
  transformation: bigint[][];
  squaredNorms: Rational[];
}

/**
 * Floating projections propose integer row operations only. They never certify
 * reduction or discard vectors: every operation is applied to bigint rows and
 * the transformation, then exact LLL below checks/finishes the result. Poor
 * conditioning, overflow or an iteration cap merely ends this preconditioner.
 */
function preconditionLattice(
  basis: bigint[][],
  transformation: bigint[][],
  work: PolynomialWork
): void {
  const n = basis.length,
    width = basis[0].length;
  if (n < 6) return;
  const mu = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const norms: number[] = [],
    orthogonal: number[][] = [];
  let bits = 0;
  for (const row of basis)
    for (const c of row)
      bits = Math.max(bits, (c < 0n ? -c : c).toString(2).length);
  const shift = BigInt(Math.max(0, bits - 450));
  for (let i = 0; i < n; i++) {
    const v = basis[i].map((c) => Number(c >> shift));
    for (let j = 0; j < i; j++) {
      work.tick(2 * width);
      const projection =
        v.reduce((s, c, k) => s + c * orthogonal[j][k], 0) / norms[j];
      if (!Number.isFinite(projection)) return;
      mu[i][j] = projection;
      for (let k = 0; k < width; k++) v[k] -= projection * orthogonal[j][k];
    }
    work.tick(width);
    const norm = v.reduce((s, c) => s + c * c, 0);
    if (!(norm > 0) || !Number.isFinite(norm)) return;
    orthogonal.push(v);
    norms.push(norm);
  }
  for (
    let k = 1, iterations = 0;
    k < n && iterations < 4 * n * n;
    iterations++
  ) {
    work.tick();
    for (let j = k - 1; j >= 0; j--) {
      const c = Math.round(mu[k][j]);
      if (!Number.isSafeInteger(c)) return;
      if (c === 0) continue;
      work.tick(width + n + j);
      const integer = BigInt(c);
      basis[k] = basis[k].map((x, i) => x - integer * basis[j][i]);
      transformation[k] = transformation[k].map(
        (x, i) => x - integer * transformation[j][i]
      );
      for (let i = 0; i < j; i++) mu[k][i] -= c * mu[j][i];
      mu[k][j] -= c;
    }
    const oldMu = mu[k][k - 1],
      oldNorm = norms[k - 1];
    if (norms[k] >= (0.75 - oldMu * oldMu) * oldNorm) {
      k++;
      continue;
    }
    const combined = norms[k] + oldMu * oldMu * oldNorm;
    if (!(combined > 0) || !Number.isFinite(combined)) return;
    work.tick(2 * n);
    [basis[k], basis[k - 1]] = [basis[k - 1], basis[k]];
    [transformation[k], transformation[k - 1]] = [
      transformation[k - 1],
      transformation[k],
    ];
    const newMu = (oldMu * oldNorm) / combined;
    norms[k] *= oldNorm / combined;
    norms[k - 1] = combined;
    for (let j = 0; j < k - 1; j++)
      [mu[k][j], mu[k - 1][j]] = [mu[k - 1][j], mu[k][j]];
    mu[k][k - 1] = newMu;
    for (let i = k + 1; i < n; i++) {
      const old = mu[i][k];
      mu[i][k] = mu[i][k - 1] - oldMu * old;
      mu[i][k - 1] = old + newMu * mu[i][k];
    }
    k = Math.max(1, k - 1);
  }
}

/** Exact delta=3/4 LLL; size reductions and swaps preserve the integer lattice. */
export function reduceIntegerLattice(
  input: readonly (readonly bigint[])[],
  work = new PolynomialWork()
): IntegerLatticeReduction {
  const width = input[0]?.length ?? 0;
  if (
    !input.length ||
    input.length > width ||
    input.some((r) => r.length !== width)
  )
    throw new RangeError(
      'Expected a nonempty rectangular independent row basis'
    );
  work.tick(input.length * width);
  const basis = input.map((r) => [...r]),
    n = basis.length;
  const transformation: bigint[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1n : 0n))
  );
  preconditionLattice(basis, transformation, work);
  const { mu, norms } = integerGramSchmidt(basis, work);
  for (let k = 1; k < n;) {
    work.tick();
    for (let j = k - 1; j >= 0; j--) {
      const c = nearest(mu[k][j]);
      if (c === 0n) continue;
      work.tick(basis[k].length + n + j);
      basis[k] = basis[k].map((x, i) => x - c * basis[j][i]);
      transformation[k] = transformation[k].map(
        (x, i) => x - c * transformation[j][i]
      );
      for (let i = 0; i < j; i++)
        mu[k][i] = sub(mu[k][i], Q.mul(q(c), mu[j][i]));
      mu[k][j] = sub(mu[k][j], q(c));
    }
    const required = Q.mul(
      sub(q(3n, 4n), Q.mul(mu[k][k - 1], mu[k][k - 1])),
      norms[k - 1]
    );
    if (!less(norms[k], required)) {
      k++;
      continue;
    }
    [basis[k], basis[k - 1]] = [basis[k - 1], basis[k]];
    [transformation[k], transformation[k - 1]] = [
      transformation[k - 1],
      transformation[k],
    ];
    // Adjacent swapping changes only two orthogonal lengths and their
    // projections. Exact updates avoid cubic Gram-Schmidt recomputation.
    work.tick(2 * n);
    const oldMu = mu[k][k - 1],
      oldNorm = norms[k - 1];
    const combined = Q.add(norms[k], Q.mul(Q.mul(oldMu, oldMu), oldNorm));
    const newMu = divide(Q.mul(oldMu, oldNorm), combined);
    norms[k] = divide(Q.mul(oldNorm, norms[k]), combined);
    norms[k - 1] = combined;
    for (let j = 0; j < k - 1; j++)
      [mu[k][j], mu[k - 1][j]] = [mu[k - 1][j], mu[k][j]];
    mu[k][k - 1] = newMu;
    for (let i = k + 1; i < n; i++) {
      const old = mu[i][k];
      mu[i][k] = sub(mu[i][k - 1], Q.mul(oldMu, old));
      mu[i][k - 1] = Q.add(old, Q.mul(newMu, mu[i][k]));
    }
    k = Math.max(1, k - 1);
  }
  return { basis, transformation, squaredNorms: norms };
}

/** Read-only check of the exact size-reduction and Lovasz inequalities. */
export function isReducedIntegerLattice(
  basis: readonly (readonly bigint[])[],
  work = new PolynomialWork()
): boolean {
  const { mu, norms } = integerGramSchmidt(basis, work);
  for (let i = 1; i < basis.length; i++) {
    for (let j = 0; j < i; j++)
      if (
        2n *
          (mu[i][j].numerator < 0n ? -mu[i][j].numerator : mu[i][j].numerator) >
        mu[i][j].denominator
      )
        return false;
    if (
      less(
        norms[i],
        Q.mul(sub(q(3n, 4n), Q.mul(mu[i][i - 1], mu[i][i - 1])), norms[i - 1])
      )
    )
      return false;
  }
  return true;
}
