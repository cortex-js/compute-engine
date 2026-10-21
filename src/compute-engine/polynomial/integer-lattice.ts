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

/** Exact delta=3/4 LLL; size reductions and swaps preserve the integer lattice. */
export function reduceIntegerLattice(
  input: readonly (readonly bigint[])[],
  work = new PolynomialWork()
): IntegerLatticeReduction {
  let { mu, norms } = integerGramSchmidt(input, work);
  const basis = input.map((r) => [...r]),
    n = basis.length;
  const transformation: bigint[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1n : 0n))
  );
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
    ({ mu, norms } = integerGramSchmidt(basis, work));
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
