/**
 * Operations on single permutations: disjoint cycles, element order, power,
 * conjugate and commutator.
 *
 * This is a kernel module. It does not import the compute engine (the GCD
 * helper comes from `polynomial/exact-field.ts`, which has no imports). The
 * input values were validated when they were made. `permutationCycles()`,
 * `permutationElementOrder()` and `permutationPower()` check the degree limit
 * of the caller, and `permutationPower()` checks the exponent.
 * `conjugatePermutation()` and `permutationCommutator()` check no limit.
 *
 * The conventions are the ones of `values.ts`: points start at 1,
 * `images[p - 1]` is the image of `p`, and a product `a * b` applies `a`
 * first and then `b`.
 */
import { integerGcd } from '../../polynomial/exact-field.js';
import {
  PermutationValue,
  PermutationInputError,
  degreeLimit,
  composePermutations,
  inversePermutation,
  type PermutationWork,
} from './values.js';

/**
 * Check receiving degree policy; values are already validated by
 * construction.
 *
 * Throws `permutation-degree-limit` when `supportDegree` is larger than the
 * degree limit of `work`, and `invalid-permutation-degree-limit` when
 * `work.maxDegree` is not valid.
 */
function receive(value: PermutationValue, work: PermutationWork) {
  work.check?.();
  if (value.supportDegree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
}

/**
 * Nontrivial disjoint cycles, each starting at its least point.
 *
 * Each cycle `[c0, c1, ..., ck]` means `c0 -> c1 -> ... -> ck -> c0`. The
 * cycles are sorted by their first point. Fixed points (cycles of length 1)
 * are not in the result, so the identity gives an empty list. Example:
 * `[2, 3, 1, 5, 4]` gives `[[1, 2, 3], [4, 5]]`.
 *
 * Cost: O(n) for n = `supportDegree`; each point is visited once. Calls
 * `work.check` once per point.
 */
export function permutationCycles(
  value: PermutationValue,
  work: PermutationWork = {}
): readonly (readonly number[])[] {
  receive(value, work);
  const seen = new Uint8Array(value.supportDegree);
  const result: (readonly number[])[] = [];
  for (let root = 1; root <= value.supportDegree; root++) {
    work.check?.();
    if (seen[root - 1]) continue;
    const cycle: number[] = [];
    let point = root;
    do {
      work.check?.();
      seen[point - 1] = 1;
      cycle.push(point);
      point = value.images[point - 1];
    } while (point !== root);
    if (cycle.length > 1) result.push(cycle);
  }
  return result;
}

/**
 * The order is the exact least common multiple of disjoint-cycle lengths.
 *
 * The order is the smallest k > 0 such that the k-th power is the identity;
 * the identity has order 1. The result is a `bigint` because the LCM can be
 * larger than 2^53 for a degree well below the degree limit.
 */
export function permutationElementOrder(
  value: PermutationValue,
  work: PermutationWork = {}
): bigint {
  let order = 1n;
  for (const cycle of permutationCycles(value, work)) {
    work.check?.();
    const n = BigInt(cycle.length);
    // lcm(order, n) = order / gcd(order, n) * n. Divide first to keep the
    // intermediate value small.
    order = (order / integerGcd(order, n)) * n;
  }
  return order;
}

/**
 * Reduce an exact signed exponent independently modulo each cycle length.
 *
 * Returns `value^exponent`. A negative exponent gives a power of the
 * inverse; 0 gives the identity. On a cycle of length n, the power moves
 * each point `exponent mod n` steps forward along the cycle, so the cost is
 * O(supportDegree) for every exponent, with no repeated products.
 *
 * Throws `PermutationInputError`:
 * - `permutation-degree-limit` from the degree check of `receive()`;
 * - `invalid-permutation-exponent` when `exponent` is not a `bigint`;
 * - `permutation-exponent-limit` when `|exponent|` has more than 16384 bits.
 *   This limits the cost of the `bigint` remainders.
 */
export function permutationPower(
  value: PermutationValue,
  exponent: bigint,
  work: PermutationWork = {}
): PermutationValue {
  receive(value, work);
  if (typeof exponent !== 'bigint')
    throw new PermutationInputError('invalid-permutation-exponent');
  if ((exponent < 0n ? -exponent : exponent).toString(2).length > 16384)
    throw new PermutationInputError('permutation-exponent-limit');
  const images = Array.from({ length: value.supportDegree }, (_, i) => {
    work.check?.();
    return i + 1;
  });
  // Start from the identity on 1..supportDegree and write the new image of
  // each point of each nontrivial cycle.
  for (const cycle of permutationCycles(value, work)) {
    // The `bigint` `%` keeps the sign of the dividend, so add n and take the
    // remainder again to get a shift in 0..n-1.
    const n = cycle.length,
      shift = Number(((exponent % BigInt(n)) + BigInt(n)) % BigInt(n));
    for (let i = 0; i < n; i++) {
      work.check?.();
      images[cycle[i] - 1] = cycle[(i + shift) % n];
    }
  }
  // This module cannot use the trusted constructor of `values.ts`, so the
  // result goes through the public validation. That costs one more O(n)
  // walk and also removes trailing fixed points.
  return PermutationValue.fromImages(images, work);
}

/**
 * Right-action conjugation: by⁻¹ * value * by, using three linear image
 * walks.
 *
 * With products read left to right (first factor applied first), a point
 * `p` goes to `by(value(by⁻¹(p)))`. So the result maps `by(x)` to
 * `by(value(x))`: each cycle of `value` is relabeled by `by`. Example: the
 * conjugate of (1 2) by (2 3) is (1 3), that is `[3, 2, 1]`.
 *
 * This function and `permutationCommutator()` do not check the degree limit
 * of `work`: the library operators check it when they read their arguments.
 */
export function conjugatePermutation(
  value: PermutationValue,
  by: PermutationValue,
  work: PermutationWork = {}
): PermutationValue {
  return composePermutations(
    composePermutations(inversePermutation(by, work), value, work),
    by,
    work
  );
}
/**
 * The commutator is left⁻¹ * right⁻¹ * left * right, in that order.
 *
 * The factors are applied from left to right: `left⁻¹` first and `right`
 * last. The result is the identity exactly when `left` and `right` commute.
 * Example: for (1 2) and (2 3) the result is `[2, 3, 1]`, the cycle
 * (1 2 3). Cost: two inverses and three products, each O(n).
 */
export function permutationCommutator(
  left: PermutationValue,
  right: PermutationValue,
  work: PermutationWork = {}
): PermutationValue {
  return composePermutations(
    composePermutations(
      composePermutations(
        inversePermutation(left, work),
        inversePermutation(right, work),
        work
      ),
      left,
      work
    ),
    right,
    work
  );
}
