import {
  union,
  intersection,
  setminus,
  cartesianProduct,
} from '../compute-engine/sets';
import type { Dictionary, Expression, ComputeEngine } from '../public';

// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

export const SETS_DICTIONARY: Dictionary = {
  EmptySet: {
    domain: 'EmptySet',
    constant: true,
    wikidata: 'Q226183',
  },
  CartesianProduct: {
    // Aka the product set, the set direct product or cross product
    // Notation: \times
    domain: 'Function',
    wikidata: 'Q173740',
    signatures: [
      {
        args: [
          ['lhs', 'Set'],
          ['rhs', 'Set'],
        ],
        result: 'Set',
        evaluate: cartesianProduct,
      },
    ],
  },
  Intersection: {
    // notation: \Cap
    domain: 'Function',
    wikidata: 'Q185837',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    involution: true,
    signatures: [
      { rest: ['sets', 'Set'], result: 'Set', evaluate: intersection },
    ],
  },
  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent lists
    domain: 'Function',
    wikidata: 'Q242767',
  },
  Union: {
    // Works on set, but can also work on lists
    domain: 'Function',
    wikidata: 'Q185359',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    involution: true,
    signatures: [{ rest: ['sets', 'Set'], result: 'Set', evaluate: union }],
  },
  // disjoint union Q842620 ⊔
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    domain: 'Function',
    wikidata: 'Q1147242',
  },
  Subset: {
    domain: 'Predicate',
    signatures: [
      {
        args: [
          ['lhs', 'Set'],
          ['rhs', 'Set'],
        ],
        result: 'MaybeBoolean',
        evaluate: (
          engine: ComputeEngine,
          lhs: Expression,
          rhs: Expression
        ): Expression => {
          const c = engine.compare(lhs, rhs);
          return c < 0 ? 'True' : c >= 0 ? 'False' : 'Maybe';
        },
      },
    ],
  },
  SubsetEqual: {
    domain: 'Predicate',
    signatures: [
      {
        args: [
          ['lhs', 'Set'],
          ['rhs', 'Set'],
        ],
        result: 'MaybeBoolean',
        evaluate: (
          engine: ComputeEngine,
          lhs: Expression,
          rhs: Expression
        ): Expression => {
          const c = engine.compare(lhs, rhs);
          return c <= 0 ? 'True' : c > 0 ? 'False' : 'Maybe';
        },
      },
    ],
  },
  SetMinus: {
    domain: 'Function',
    wikidata: 'Q18192442',
    signatures: [
      {
        args: [
          ['lhs', 'Set'],
          ['rhs', 'Set'],
        ],
        result: 'Set',
        evaluate: setminus,
      },
    ],
  },
};
