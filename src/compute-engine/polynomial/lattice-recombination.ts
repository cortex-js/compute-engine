import { PolynomialInvariantError, PolynomialWork } from './exact-field.js';
import { ModularPolynomials } from './hensel.js';
import { integerRowBasis, reduceIntegerLattice } from './integer-lattice.js';

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

/** Precision reserve for useful truncated constraints, not an irreducibility bound. */
export function minimumLatticeModulus(
  f: readonly bigint[],
  count: number
): bigint {
  const n = f.length - 1;
  const norm = f.reduce((sum, c) => sum + (c < 0n ? -c : c), 0n);
  return (
    BigInt(n) *
    BigInt(n - 1) *
    norm *
    (1n << BigInt(Math.min(96, Math.max(8, 2 * count))))
  );
}

function columnGroups(
  basis: readonly (readonly bigint[])[],
  count: number
): number[][] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = basis.map((row) => row[i]).join(',');
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Add truncated logarithmic-derivative constraints one at a time. The retained
 * integer lattice contains every true divisor indicator. For a coefficient
 * bounded by B, set a_i=floor(T*c_i/M), where 0<=c_i<M and T*B<=M.
 * A true 0/1 indicator has |sum(e_i*a_i)-k*T|<=r+1. This bound includes
 * all truncation error; floating-point proposals never supply the certificate.
 */
export function gradualLatticePartition(
  f: readonly bigint[],
  factors: readonly (readonly bigint[])[],
  modulus: bigint,
  work: PolynomialWork,
  observe?: (column: number, rank: number, operations: number) => void
): number[][] | null {
  const n = f.length - 1,
    r = factors.length;
  if (n < 2 || r < 2 || f[n] !== 1n) return null;
  const R = new ModularPolynomials(modulus, work);
  const norm = f.reduce((sum, c) => sum + (c < 0n ? -c : c), 0n);
  let choose = 1n;
  const logarithms = factors.map((g) => {
    const [quotient, remainder] = R.divrem(f, g);
    if (remainder.length)
      throw new PolynomialInvariantError('Invalid lifted divisor');
    return R.mul(
      quotient,
      g.slice(1).map((c, j) => BigInt(j + 1) * c)
    );
  });
  function* constraints(): Iterable<IndicatorConstraint> {
    for (let j = 1; j < n; j++) {
      choose = (choose * BigInt(n - j)) / BigInt(j);
      yield {
        bound: BigInt(n) * choose * norm,
        coefficients: logarithms.map((g) => g[n - 1 - j] ?? 0n),
      };
    }
  }
  return gradualIndicatorPartition(
    r,
    modulus,
    constraints(),
    work,
    (groups) => partitionDivides(f, factors, groups, R, work),
    observe
  );
}

/** Canonical residues of a linear form bounded on every true 0/1 indicator. */
export interface IndicatorConstraint {
  coefficients: readonly bigint[];
  bound: bigint;
}

function gradualIndicatorPartition(
  r: number,
  modulus: bigint,
  constraints: Iterable<IndicatorConstraint>,
  work: PolynomialWork,
  accept?: (groups: number[][]) => boolean,
  observe?: (column: number, rank: number, operations: number) => void
): number[][] | null {
  let basis: bigint[][] = Array.from({ length: r }, (_, i) =>
    Array.from({ length: r }, (_, j) => (i === j ? 1n : 0n))
  );
  let column = 0;
  for (const { bound, coefficients: residues } of constraints) {
    column++;
    if (
      bound <= 0n ||
      residues.length !== r ||
      residues.some((c) => c < 0n || c >= modulus)
    )
      throw new PolynomialInvariantError('Invalid indicator constraint');
    const available = (modulus / bound).toString(2).length - 1;
    if (available < 8) continue;
    const squaredBound = BigInt(r + (r + 1) ** 2);
    let rows = basis.map((row) => [...row, 0n]);
    rows.push([...Array<bigint>(r).fill(0n), 1n]);
    let previousScale = 1n,
      previous = Array<bigint>(r).fill(0n);
    const targetBits = Math.min(96, available);
    for (
      let bits = Math.min(32, targetBits);
      ;
      bits = Math.min(bits + 16, targetBits)
    ) {
      const scale = 1n << BigInt(bits),
        ratio = scale / previousScale;
      const coefficients = residues.map((c) => (c * scale) / modulus);
      const delta = coefficients.map((c, i) => c - ratio * previous[i]);
      // Increasing precision maps (e,z) to (e, ratio*z + e*delta).
      // The integer k in z=e*a-k*T is unchanged, so the true short vector
      // remains present after every preceding exact removal.
      rows = rows.map((row) => {
        work.tick(r);
        return [
          ...row.slice(0, r),
          row[r] * ratio +
            row.slice(0, r).reduce((sum, c, i) => sum + c * delta[i], 0n),
        ];
      });
      const reduced = reduceIntegerLattice(rows, work);
      let keep = reduced.basis.length;
      while (
        keep &&
        reduced.squaredNorms[keep - 1].numerator >
          squaredBound * reduced.squaredNorms[keep - 1].denominator
      )
        keep--;
      if (!keep)
        throw new PolynomialInvariantError(
          'Lattice lost the full-polynomial indicator'
        );
      rows = reduced.basis.slice(0, keep);
      previousScale = scale;
      previous = coefficients;
      if (bits === targetBits || keep < basis.length) break;
    }
    // Project away the constraint column, then remove only integer-dependent
    // generators. This keeps every true indicator while preventing the next
    // reduction's dimension and short-vector bound from accumulating columns.
    basis = integerRowBasis(
      rows.map((row) => row.slice(0, r)),
      work
    );
    observe?.(column, basis.length, work.operations);
    const groups = columnGroups(basis, r);
    // A span of block indicators needs no further constraints if those blocks
    // recover exactly. The caller checks every division before accepting it.
    if (groups.length < r && basis.length === groups.length && accept?.(groups))
      return groups;
  }
  const groups = columnGroups(basis, r);
  return groups.length === r ? null : groups;
}

/** Bounded shared reducer; exhaustion is inconclusive and preserves caller budgets. */
export function latticeIndicatorPartition(
  count: number,
  modulus: bigint,
  constraints: (work: PolynomialWork) => Iterable<IndicatorConstraint>,
  parent: PolynomialWork,
  accept?: (groups: number[][]) => boolean,
  observe?: (column: number, rank: number, operations: number) => void,
  maxProbeOperations = 1_200_000
): number[][] | null {
  if (!Number.isSafeInteger(maxProbeOperations) || maxProbeOperations < 0)
    throw new RangeError('Invalid lattice probe limit');
  if (count < 2 || count > 64 || modulus < 2n) return null;
  const work = new ProbeWork(
    parent,
    Math.min(
      maxProbeOperations,
      Math.max(0, Math.floor((15 * (parent.limit - parent.operations)) / 16))
    )
  );
  try {
    return gradualIndicatorPartition(
      count,
      modulus,
      constraints(work),
      work,
      accept,
      observe
    );
  } catch (e) {
    if (e instanceof ProbeLimit) return null;
    throw e;
  }
}

function partitionDivides(
  f: readonly bigint[],
  factors: readonly (readonly bigint[])[],
  groups: readonly (readonly number[])[],
  ring: ModularPolynomials,
  work: PolynomialWork
): boolean {
  let remainder = [...f];
  for (const group of groups) {
    const divisor = group
      .reduce((a, i) => ring.mul(a, factors[i]), [1n])
      .map((c) => (c > ring.modulus / 2n ? c - ring.modulus : c));
    if (divisor.length < 2 || divisor.length > remainder.length) return false;
    const quotient = Array<bigint>(remainder.length - divisor.length + 1).fill(
      0n
    );
    for (let i = remainder.length - 1; i >= divisor.length - 1; i--) {
      const c = remainder[i],
        offset = i - divisor.length + 1;
      quotient[offset] = c;
      work.tick(divisor.length);
      for (let j = 0; j < divisor.length; j++)
        remainder[offset + j] -= c * divisor[j];
    }
    if (remainder.some((c) => c !== 0n)) return false;
    remainder = quotient;
  }
  return remainder.length === 1 && remainder[0] === 1n;
}

/**
 * Partition verified irreducible modular factors into blocks that cannot split
 * over Q. The caller must still recover and exactly divide every block before
 * claiming completion. Null means inconclusive, never irreducible.
 *
 * For a monic divisor g of f, f*g'/g has kth coefficient bounded by
 * n*binomial(n-1,k)*||f||_1: expand over roots and bound each omitted-root
 * product by the Mahler measure of f. Truncation normalizes each constraint
 * with an explicit error bound, independent of the input coefficient height.
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
  maxProbeOperations = 1_200_000,
  maxDimension = 65
): number[][] | null {
  if (
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
      Math.max(0, Math.floor((15 * (parent.limit - parent.operations)) / 16))
    )
  );
  try {
    const n = f.length - 1,
      r = factors.length;
    if (n < 2 || r < 2 || f[n] !== 1n) return null;
    if (r + 1 > maxDimension) return null;
    if (modulus < minimumLatticeModulus(f, r)) return null;
    const R = new ModularPolynomials(modulus, work);
    if (factors.some((g) => g.length < 2 || g[g.length - 1] !== 1n))
      throw new PolynomialInvariantError('Invalid lifted factors');
    const product = factors.reduce((a, b) => R.mul(a, b), [1n]);
    if (R.sub(product, f).length)
      throw new PolynomialInvariantError('Lifted factors do not reconstruct');
    return gradualLatticePartition(f, factors, modulus, work);
  } catch (e) {
    if (e instanceof ProbeLimit) return null;
    throw e;
  }
}
