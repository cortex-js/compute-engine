import type { Expression } from '../../math-json/math-json-format';
import type {
  Dictionary,
  ComputeEngine,
  Domain,
} from '../../math-json/compute-engine-interface';

// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

export const SETS_DICTIONARY: Dictionary = {
  //
  // Constants
  //
  EmptySet: {
    domain: 'Set',
    constant: true,
    wikidata: 'Q226183',
    isElementOf: () => false, // @todo not quite true...
    isSubsetOf: () => true, // The empty set is a subset of every set
  },

  //
  // Predicates
  //
  Subset: {
    domain: 'Predicate',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'MaybeBoolean' : null,
    evaluate: subset,
  },
  SubsetEqual: {
    domain: 'Predicate',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'MaybeBoolean' : null,
    evaluate: subsetEqual,
  },

  //
  // Functions
  //

  CartesianProduct: {
    // Aka the product set, the set direct product or cross product
    // Notation: \times
    domain: 'Function',
    wikidata: 'Q173740',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
    evaluate: cartesianProduct,
  },
  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent lists
    domain: 'Function',
    wikidata: 'Q242767',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
  },
  Intersection: {
    // notation: \cap
    domain: 'Function',
    wikidata: 'Q185837',
    threadable: true,
    associative: true,
    commutative: true,
    involution: true,
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
    evaluate: intersection,
  },
  Union: {
    // Works on set, but can also work on lists
    domain: 'Function',
    wikidata: 'Q185359',
    threadable: true,
    associative: true,
    commutative: true,
    involution: true,
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
    evaluate: union,
  },
  Set: {
    domain: 'Function',
    // @todo! set has multiple forms
    // Set(Sequence)
    // Set(Sequence, Condition)
    // Set(Set, Condition)
    evalDomain: (_ce: ComputeEngine, ..._args: Domain[]): Domain | null => null,
  }, // disjoint union Q842620 ⊔
  SetMinus: {
    domain: 'Function',
    wikidata: 'Q18192442',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
    evaluate: setMinus,
  },
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    domain: 'Function',
    wikidata: 'Q1147242',
    evalDomain: (ce: ComputeEngine, ...args: Domain[]): Domain | null =>
      args.every((x) => ce.isSubsetOf(x, 'Set')) ? 'Set' : null,
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
