import { integerGcd } from '../../polynomial/exact-field.js';
import {
  PermutationValue,
  PermutationInputError,
  degreeLimit,
  composePermutations,
  inversePermutation,
  type PermutationWork,
} from './values.js';

/** Check receiving degree policy; values are already validated by construction. */
function receive(value: PermutationValue, work: PermutationWork) {
  work.check?.();
  if (value.supportDegree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
}

/** Nontrivial disjoint cycles, each starting at its least point. */
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

/** The order is the exact least common multiple of disjoint-cycle lengths. */
export function permutationElementOrder(
  value: PermutationValue,
  work: PermutationWork = {}
): bigint {
  let order = 1n;
  for (const cycle of permutationCycles(value, work)) {
    work.check?.();
    const n = BigInt(cycle.length);
    order = (order / integerGcd(order, n)) * n;
  }
  return order;
}

/** Reduce an exact signed exponent independently modulo each cycle length. */
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
  for (const cycle of permutationCycles(value, work)) {
    const n = cycle.length,
      shift = Number(((exponent % BigInt(n)) + BigInt(n)) % BigInt(n));
    for (let i = 0; i < n; i++) {
      work.check?.();
      images[cycle[i] - 1] = cycle[(i + shift) % n];
    }
  }
  return PermutationValue.fromImages(images, work);
}

/** Right-action conjugation: by⁻¹ * value * by, using three linear image walks. */
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
/** The commutator is left⁻¹ * right⁻¹ * left * right, in that order. */
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
