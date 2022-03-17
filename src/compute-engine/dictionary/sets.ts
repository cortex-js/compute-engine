// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { BoxedExpression, Dictionary, IComputeEngine } from '../public';

export const SETS_DICTIONARY: Dictionary = {
  symbols: [
    //
    // Constants
    //
    {
      name: 'EmptySet',
      domain: 'Set',
      constant: true,
      wikidata: 'Q226183',
      // contains: () => false, // @todo not quite true...
      // includes: () => true, // The empty set is a subset of every set
    },
  ],
  functions: [
    //
    // Predicates
    //
    {
      name: 'Element',
      domain: 'MaybeBoolean',
      complexity: 11200,
      // evaluate: subset,
    },
    {
      name: 'NotElement',
      domain: 'MaybeBoolean',
      complexity: 11200,
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Element', args)]),
      // evaluate: subset,
    },
    {
      name: 'Subset',
      domain: 'MaybeBoolean',
      complexity: 11200,
      // evaluate: subset,
    },
    {
      name: 'NotSubset',
      domain: 'MaybeBoolean',
      complexity: 11200,
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Subset', args)]),
      // evaluate: subset,
    },
    {
      name: 'Superset',
      domain: 'MaybeBoolean',
      complexity: 11200,
      // evaluate: subset,
    },
    {
      name: 'SupersetEqual',
      domain: 'MaybeBoolean',
      complexity: 11200,
      // evaluate: subset,
    },
    {
      name: 'NotSuperset',
      domain: 'MaybeBoolean',
      complexity: 11200,
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Superset', args)]),
      // evaluate: subset,
    },
    {
      name: 'NotSupersetEqual',
      domain: 'MaybeBoolean',
      complexity: 11200,
      canonical: (ce, args) => ce.fn('Not', [ce.fn('SupersetEqual', args)]),
      // evaluate: subset,
    },
    {
      name: 'SubsetEqual',
      domain: 'MaybeBoolean',
      complexity: 11200,
      // evaluate: subsetEqual,
    },
    {
      name: 'NotSubsetNotEqual',
      domain: 'MaybeBoolean',
      complexity: 11200,
      canonical: (ce, args) => ce.fn('Not', [ce.fn('SubsetEqual', args)]),
    },

    //
    // Functions
    //

    {
      name: 'CartesianProduct',
      // Aka the product set, the set direct product or cross product
      // Notation: \times
      domain: 'Set',
      wikidata: 'Q173740',
      // evaluate: cartesianProduct,
    },
    {
      name: 'Complement',
      // Return the elements of the first argument that are not in any of
      // the subsequent lists
      domain: 'Set',
      wikidata: 'Q242767',
    },
    {
      name: 'Intersection',
      // notation: \cap
      domain: 'Set',
      wikidata: 'Q185837',
      threadable: true,
      associative: true,
      commutative: true,
      involution: true,
      evaluate: intersection,
    },
    {
      name: 'Union',
      // Works on set, but can also work on lists
      domain: 'Set',
      wikidata: 'Q185359',
      threadable: true,
      associative: true,
      commutative: true,
      involution: true,
      evaluate: union,
    },
    {
      name: 'Set',
      domain: 'Set',
      // @todo! set has multiple forms
      // Set(Sequence)
      // Set(Sequence, Condition)
      // Set(Set, Condition)
    }, // disjoint union Q842620 ⊔
    {
      name: 'SetMinus',
      domain: 'Set',
      wikidata: 'Q18192442',
      evaluate: setMinus,
    },
    {
      name: 'SymmetricDifference',
      // symmetric difference = disjunctive union  (circled minus)
      /* = Union(Complement(a, b), Complement(b, a) */
      /* Corresponds to XOR in boolean logic */
      domain: 'Set',
      wikidata: 'Q1147242',
    },
  ],
};

function subset(ce: IComputeEngine, _ops: BoxedExpression[]): BoxedExpression {
  return ce.symbol('False');
}
function subsetEqual(
  ce: IComputeEngine,
  _ops: BoxedExpression[]
): BoxedExpression {
  return ce.symbol('False');
}

function union(ce: IComputeEngine, _ops: BoxedExpression[]): BoxedExpression {
  return ce.symbol('False');
}

function intersection(
  ce: IComputeEngine,
  _ops: BoxedExpression[]
): BoxedExpression {
  return ce.symbol('EmptySet');
}

function setMinus(
  ce: IComputeEngine,
  _ops: BoxedExpression[]
): BoxedExpression {
  return ce.symbol('EmptySet');
}
function cartesianProduct(
  ce: IComputeEngine,
  _ops: BoxedExpression[]
): BoxedExpression {
  return ce.symbol('EmptySet');
}
