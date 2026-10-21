import { PolynomialWork } from './exact-field.js';
import { ModularPolynomials } from './hensel.js';
import { reduceIntegerLattice } from './integer-lattice.js';

class ProbeLimit extends Error {}
class ProbeWork extends PolynomialWork {
  constructor(
    readonly parent: PolynomialWork,
    limit: number
  ) {
    super(limit);
  }
  override tick(count = 1): void {
    this.parent.tick(count);
    this.operations += count;
    if (this.operations > this.limit) throw new ProbeLimit();
  }
}

/**
 * Partition VERIFIED irreducible modular factors into blocks that cannot split
 * over Q. The caller must still recover and exactly divide every block before
 * claiming completion. Null means inconclusive, never irreducible.
 *
 * For a monic divisor g of f, f*g'/g has kth coefficient bounded by
 * n*binomial(n-1,k)*||f||_1: expand over roots and bound each omitted-root
 * product by the Mahler measure of f. Thus its scaled indicator/log-derivative
 * vector has squared norm <= (r+s)*B^2 in the constructed integer lattice.
 * Removing trailing Gram-Schmidt vectors with squared norm above that bound
 * preserves every true divisor indicator. Equal projected columns in the
 * retained span are therefore inseparable. This does not assume that LLL's
 * short rows themselves are factor indicators.
 */
export function latticeFactorPartition(
  f: readonly bigint[],
  factors: readonly (readonly bigint[])[],
  modulus: bigint,
  parent: PolynomialWork,
  columns = 2,
  maxProbeOperations = 100_000,
  maxDimension = 12
): number[][] | null {
  if (
    !Number.isSafeInteger(columns) ||
    columns < 1 ||
    !Number.isSafeInteger(maxProbeOperations) ||
    maxProbeOperations < 0 ||
    !Number.isSafeInteger(maxDimension) ||
    maxDimension < 1
  )
    throw new RangeError('Invalid lattice probe limits');
  const work = new ProbeWork(
    parent,
    Math.min(
      maxProbeOperations,
      Math.max(0, Math.floor((parent.limit - parent.operations) / 4))
    )
  );
  try {
    const n = f.length - 1,
      r = factors.length,
      s = Math.min(columns, n - 1);
    if (n < 2 || r < 2 || f[n] !== 1n) return null;
    // Exact rational projection data grows rapidly with dimension. Refusing a
    // probe preserves the exhaustive fallback; callers can explicitly enlarge
    // this diagnostic limit without silently spending the whole parent budget.
    if (r + s > maxDimension) return null;
    const norm = f.reduce((sum, c) => sum + (c < 0n ? -c : c), 0n);
    let choose = 1n,
      bound = 0n;
    for (let j = 1; j <= s; j++) {
      work.tick();
      choose = (choose * BigInt(n - j)) / BigInt(j);
      const b = BigInt(n) * choose * norm;
      if (b > bound) bound = b;
    }
    if (modulus <= 2n * bound) return null;
    const R = new ModularPolynomials(modulus, work);
    if (factors.some((g) => g.length < 2 || g[g.length - 1] !== 1n))
      throw new Error('Invalid lifted factors');
    const product = factors.reduce((a, b) => R.mul(a, b), [1n]);
    if (R.sub(product, f).length)
      throw new Error('Lifted factors do not reconstruct');
    const rows: bigint[][] = factors.map((g, i) => {
      const [quotient, remainder] = R.divrem(f, g);
      if (remainder.length) throw new Error('Invalid lifted divisor');
      const logarithmic = R.mul(
        quotient,
        g.slice(1).map((c, j) => BigInt(j + 1) * c)
      );
      return [
        ...Array.from({ length: r }, (_, j) => (i === j ? bound : 0n)),
        ...Array.from({ length: s }, (_, j) => {
          const c = logarithmic[n - 2 - j] ?? 0n;
          return c > modulus / 2n ? c - modulus : c;
        }),
      ];
    });
    for (let i = 0; i < s; i++)
      rows.push([
        ...Array<bigint>(r).fill(0n),
        ...Array.from({ length: s }, (_, j) => (i === j ? modulus : 0n)),
      ]);
    const { basis, squaredNorms } = reduceIntegerLattice(rows, work);
    const squaredBound = BigInt(r + s) * bound * bound;
    let keep = basis.length;
    while (
      keep &&
      squaredNorms[keep - 1].numerator >
        squaredBound * squaredNorms[keep - 1].denominator
    )
      keep--;
    if (!keep) throw new Error('Lattice lost the full-polynomial indicator');
    const groups = new Map<string, number[]>();
    for (let i = 0; i < r; i++) {
      const key = basis
        .slice(0, keep)
        .map((row) => row[i])
        .join(',');
      const group = groups.get(key) ?? [];
      group.push(i);
      groups.set(key, group);
    }
    // A full-rank projected span supplies no grouping information. Singleton
    // exact recovery is already cheaper and independently certified upstream.
    if (groups.size === r) return null;
    return [...groups.values()];
  } catch (e) {
    if (e instanceof ProbeLimit) return null;
    throw e;
  }
}
