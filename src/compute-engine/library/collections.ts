import { IdTable } from '../public';

export const COLLECTIONS_LIBRARY: IdTable = {
  Sequence: {
    signature: {
      domain: 'Function',
    },
  },
};
// Keys: { domain: 'Function' },
// Entries: { domain: 'Function' },
// Dictionary: { domain: 'Collection' },
// Dictionary: {
//   domain: 'Function',
//   range: 'Dictionary',
// },
// List: { domain: 'Collection' },
// Tuple: { domain: 'Collection' },
// Sequence: { domain: 'Collection' },
// Reverse
// ForEach / Apply
// Map
// ReduceRight
// ReduceLeft
// first    or head
// rest     or tail
// cons -> cons(first (element), rest (list)) = list
// append -> append(list, list) -> list
// reverse
// rotate
// in
// map   ⁡ map(2x, x, list) ( 2 ⁢ x | x ∈ [ 0 , 10 ] )
// such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}
// select : picks out all elements ei of list for which crit[ei] is True.
// sort
// contains / find
