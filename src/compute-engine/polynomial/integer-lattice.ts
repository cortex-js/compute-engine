import {
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient as Rational,
} from './exact-field.js';

const sub = (a: Rational, b: Rational) => Q.add(a, Q.neg(b));
const less = (a: Rational, b: Rational) =>
  a.numerator * b.denominator < b.numerator * a.denominator;
const nearest = (a: Rational) => {
  const n = a.numerator,
    d = a.denominator;
  return n < 0n ? -((-2n * n + d) / (2n * d)) : (2n * n + d) / (2n * d);
};

/** Independent integer row generators, preserving the entire row lattice. */
export function integerRowBasis(
  input: readonly (readonly bigint[])[],
  work: PolynomialWork
): bigint[][] {
  const rows = input.map((row) => [...row]);
  const width = rows[0]?.length ?? 0;
  if (rows.some((row) => row.length !== width))
    throw new RangeError('Expected rectangular rows');
  let rank = 0;
  for (let column = 0; column < width && rank < rows.length; column++) {
    const pivot = rows.findIndex((row, i) => i >= rank && row[column] !== 0n);
    if (pivot < 0) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    for (let i = rank + 1; i < rows.length; i++) {
      while (rows[i][column] !== 0n) {
        work.tick(width);
        const quotient = rows[rank][column] / rows[i][column];
        rows[rank] = rows[rank].map((c, j) => c - quotient * rows[i][j]);
        [rows[rank], rows[i]] = [rows[i], rows[rank]];
      }
    }
    if (rows[rank][column] < 0n) rows[rank] = rows[rank].map((c) => -c);
    for (let i = 0; i < rank; i++) {
      const quotient = nearest(q(rows[i][column], rows[rank][column]));
      if (quotient) {
        work.tick(width);
        rows[i] = rows[i].map((c, j) => c - quotient * rows[rank][j]);
      }
    }
    rank++;
  }
  return rows.slice(0, rank);
}

/** Exact Gram-Schmidt data without constructing rational orthogonal vectors. */
function fractionFreeGramSchmidt(
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
  const lambda = Array.from({ length: n }, () => Array<bigint>(n).fill(0n));
  const determinants = [1n];
  const dot = (a: readonly bigint[], b: readonly bigint[]) => {
    work.tick(width);
    return a.reduce((s, x, i) => s + x * b[i], 0n);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let value = dot(basis[i], basis[j]);
      for (let k = 0; k < j; k++) {
        work.tick();
        // Fraction-free elimination of the Gram matrix: all divisions are
        // exact, avoiding a rational normalization for every cubic update.
        value =
          (determinants[k + 1] * value - lambda[i][k] * lambda[j][k]) /
          determinants[k];
      }
      if (j === i) {
        if (value <= 0n)
          throw new RangeError('Linearly dependent lattice basis');
        determinants.push(value);
      } else lambda[i][j] = value;
    }
  }
  return { lambda, determinants };
}

export function integerGramSchmidt(
  basis: readonly (readonly bigint[])[],
  work: PolynomialWork
) {
  const { lambda, determinants } = fractionFreeGramSchmidt(basis, work);
  const mu = lambda.map((row, i) =>
    row.map((x, j) => (j < i ? q(x, determinants[j + 1]) : Q.zero))
  );
  const norms = determinants.slice(1).map((d, i) => q(d, determinants[i]));
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
  const mu = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const norms: number[] = [];
  const exact = integerGramSchmidt(basis, work);
  const ratio = (a: Rational) => {
    const negative = a.numerator < 0n;
    const numerator = negative ? -a.numerator : a.numerator;
    const nb = Math.max(0, numerator.toString(2).length - 52);
    const db = Math.max(0, a.denominator.toString(2).length - 52);
    return (
      (negative ? -1 : 1) *
      (Number(numerator >> BigInt(nb)) / Number(a.denominator >> BigInt(db))) *
      2 ** (nb - db)
    );
  };
  for (let i = 0; i < n; i++) {
    norms.push(ratio(exact.norms[i]));
    for (let j = 0; j < i; j++) mu[i][j] = ratio(exact.mu[i][j]);
  }
  if (norms.some((x) => !(x > 0) || !Number.isFinite(x))) return;
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
  const { lambda, determinants: d } = fractionFreeGramSchmidt(basis, work);
  for (let k = 1; k < n;) {
    work.tick();
    for (let j = k - 1; j >= 0; j--) {
      const numerator = lambda[k][j],
        denominator = d[j + 1];
      const c =
        numerator < 0n
          ? -((-2n * numerator + denominator) / (2n * denominator))
          : (2n * numerator + denominator) / (2n * denominator);
      if (c === 0n) continue;
      work.tick(basis[k].length + n + j);
      basis[k] = basis[k].map((x, i) => x - c * basis[j][i]);
      transformation[k] = transformation[k].map(
        (x, i) => x - c * transformation[j][i]
      );
      for (let i = 0; i < j; i++) lambda[k][i] -= c * lambda[j][i];
      lambda[k][j] -= c * d[j + 1];
    }
    const l = lambda[k][k - 1];
    if (4n * d[k + 1] * d[k - 1] >= 3n * d[k] * d[k] - 4n * l * l) {
      k++;
      continue;
    }
    [basis[k], basis[k - 1]] = [basis[k - 1], basis[k]];
    [transformation[k], transformation[k - 1]] = [
      transformation[k - 1],
      transformation[k],
    ];
    // With d[j] the jth Gram determinant, lambda[i][j]/d[j+1]
    // is mu[i][j]. Fraction-free adjacent swaps use exact integer divisions
    // and avoid rational gcd normalization at every projection update.
    work.tick(2 * n);
    const current = d[k],
      next = d[k + 1];
    const replacement = (d[k - 1] * next + l * l) / current;
    for (let j = 0; j < k - 1; j++)
      [lambda[k][j], lambda[k - 1][j]] = [lambda[k - 1][j], lambda[k][j]];
    for (let i = k + 1; i < n; i++) {
      const old = lambda[i][k];
      lambda[i][k] = (next * lambda[i][k - 1] - l * old) / current;
      lambda[i][k - 1] = (replacement * old + l * lambda[i][k]) / next;
    }
    d[k] = replacement;
    k = Math.max(1, k - 1);
  }
  return {
    basis,
    transformation,
    squaredNorms: d.slice(1).map((value, i) => q(value, d[i])),
  };
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
