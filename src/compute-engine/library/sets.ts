// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { BoxedExpression, SymbolTable, IComputeEngine } from '../public';

export const SETS_LIBRARY: SymbolTable = {
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
      complexity: 11200,
      signatures: [{ domain: 'Predicate' }],
    },
    {
      name: 'NotElement',
      complexity: 11200,
      signatures: [
        {
          domain: 'Predicate',
          canonical: (ce, args) => ce.fn('Not', [ce.fn('Element', args)]),
        },
      ],
    },
    {
      name: 'Subset',
      complexity: 11200,
      signatures: [{ domain: 'Predicate' }],
    },
    {
      name: 'NotSubset',
      complexity: 11200,
      signatures: [
        {
          domain: 'Predicate',
          canonical: (ce, args) => ce.fn('Not', [ce.fn('Subset', args)]),
        },
      ],
    },
    {
      name: 'Superset',
      complexity: 11200,
      signatures: [{ domain: 'Predicate' }],
    },
    {
      name: 'SupersetEqual',
      complexity: 11200,
      signatures: [{ domain: 'Predicate' }],
    },
    {
      name: 'NotSuperset',
      complexity: 11200,
      signatures: [
        {
          domain: 'Predicate',
          canonical: (ce, args) => ce.fn('Not', [ce.fn('Superset', args)]),
        },
      ],
    },
    {
      name: 'NotSupersetEqual',
      complexity: 11200,
      signatures: [
        {
          domain: 'Predicate',
          canonical: (ce, args) => ce.fn('Not', [ce.fn('SupersetEqual', args)]),
        },
      ],
    },
    {
      name: 'SubsetEqual',
      complexity: 11200,
      signatures: [{ domain: 'Predicate' }],
      // evaluate: subsetEqual,
    },
    {
      name: 'NotSubsetNotEqual',
      complexity: 11200,
      signatures: [
        {
          domain: 'Predicate',
          canonical: (ce, args) => ce.fn('Not', [ce.fn('SubsetEqual', args)]),
        },
      ],
    },

    //
    // Functions
    //

    {
      name: 'CartesianProduct',
      // Aka the product set, the set direct product or cross product
      // Notation: \times
      wikidata: 'Q173740',
      signatures: [{ domain: ['Function', 'Set', ['Some', 'Set'], 'Set'] }],
      // evaluate: cartesianProduct,
    },
    {
      name: 'Complement',
      // Return the elements of the first argument that are not in any of
      // the subsequent lists
      wikidata: 'Q242767',
      signatures: [{ domain: ['Function', 'Set', 'Set'] }],
    },
    {
      name: 'Intersection',
      // notation: \cap
      wikidata: 'Q185837',
      threadable: true,
      associative: true,
      commutative: true,
      involution: true,
      signatures: [
        {
          domain: ['Function', 'Set', ['Some', 'Set'], 'Set'],
          evaluate: intersection,
        },
      ],
    },
    {
      name: 'Union',
      // Works on set, but can also work on lists
      wikidata: 'Q185359',
      threadable: true,
      associative: true,
      commutative: true,
      involution: true,
      signatures: [
        {
          domain: ['Function', 'Set', ['Some', 'Set'], 'Set'],
          evaluate: union,
        },
      ],
    },
    // {
    //   name: 'Set',
    //   domain: ['Function', ['Some', 'Anything'], 'Set'],
    //   // @todo! set has multiple forms
    //   // Set(Sequence)
    //   // Set(Sequence, Condition)
    //   // Set(Set, Condition)
    // }, // disjoint union Q842620 ⊔
    {
      name: 'SetMinus',
      wikidata: 'Q18192442',
      signatures: [
        { domain: ['Function', 'Set', 'Value', 'Set'], evaluate: setMinus },
      ],
    },
    {
      name: 'SymmetricDifference',
      // symmetric difference = disjunctive union  (circled minus)
      /* = Union(Complement(a, b), Complement(b, a) */
      /* Corresponds to XOR in boolean logic */
      wikidata: 'Q1147242',
      signatures: [{ domain: ['Function', 'Set', ['Some', 'Set'], 'Set'] }],
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
