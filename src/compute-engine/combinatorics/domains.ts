import type { Domain } from './areas.js';

/** A permutation is its one-line list: a bijection of 1..n. */
export const PERMUTATION: Domain = {
  collection: 'Permutations',
  type: 'permutation',
  accepts(values) {
    const seen = new Uint8Array(values.length + 1);
    for (const v of values) {
      if (v < 1 || v > values.length || seen[v]) return false;
      seen[v] = 1;
    }
    return true;
  },
  alsoReads: 'Permutation',
};

/** An integer partition is its parts: positive integers, non-increasing. */
export const INTEGER_PARTITION: Domain = {
  collection: 'Integer partitions',
  type: 'integer_partition',
  accepts(values) {
    for (let i = 0; i < values.length; i++)
      if (values[i] < 1 || (i > 0 && values[i] > values[i - 1])) return false;
    return true;
  },
};
