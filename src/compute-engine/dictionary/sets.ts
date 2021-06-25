import type { Expression } from '../../public';
import type { Dictionary, ComputeEngine } from '../public';

// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

export const SETS_DICTIONARY: Dictionary = {
  EmptySet: {
    domain: 'Set',
    constant: true,
    wikidata: 'Q226183',
    isElementOf: () => false,
    isSubsetOf: () => false,
  },
  CartesianProduct: {
    // Aka the product set, the set direct product or cross product
    // Notation: \times
    domain: 'Function',
    wikidata: 'Q173740',
    range: 'Set',
    evaluate: cartesianProduct,
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
    range: 'Set',
    evaluate: intersection,
  },
  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent lists
    domain: 'Function',
    wikidata: 'Q242767',
    range: 'Set',
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
    range: 'Set',
    evaluate: union,
  },
  // disjoint union Q842620 ⊔
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    domain: 'Function',
    wikidata: 'Q1147242',
    range: 'Set',
  },
  Subset: {
    domain: 'Predicate',
    range: 'MaybeBoolean',
    evaluate: subset,
  },
  SubsetEqual: {
    domain: 'Predicate',
    range: 'MaybeBoolean',
    evaluate: subsetEqual,
  },
  SetMinus: {
    domain: 'Function',
    wikidata: 'Q18192442',
    range: 'MaybeBoolean',
    evaluate: setMinus,
  },
};

function subset(
  _engine: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): Expression {
  return 'False';
}
function subsetEqual(
  _engine: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): Expression {
  return 'False';
}

function union(_engine: ComputeEngine, ..._args: Expression[]): Expression {
  return 'EmptySet';
}

function intersection(
  _engine: ComputeEngine,
  ..._args: Expression[]
): Expression {
  return 'EmptySet';
}

function setMinus(
  _engine: ComputeEngine,
  _lhs: Expression[],
  _rhs: Expression[]
): Expression {
  return 'EmptySet';
}
function cartesianProduct(
  _engine: ComputeEngine,
  _lhs: Expression[],
  _rhs: Expression[]
): Expression {
  return 'EmptySet';
}
