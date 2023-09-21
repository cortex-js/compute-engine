// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { isValidDomain } from '../boxed-expression/boxed-domain';
import { validateArgumentCount } from '../boxed-expression/validate';
import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
} from '../public';
import { canonical, flattenSequence } from '../symbolic/flatten';

export const SETS_LIBRARY: IdentifierDefinitions = {
  //
  // Constants
  //
  EmptySet: {
    domain: 'Set',
    constant: true,
    wikidata: 'Q226183',
    // contains: () => false, // @todo not quite true...
    // includes: () => true, // The empty set is a subset of every set
  },
  //
  // Predicates
  //
  Element: {
    complexity: 11200,
    hold: 'all',
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => {
        args = validateArgumentCount(ce, flattenSequence(canonical(args)), 2);
        if (args.length === 2 && isValidDomain(args[1]))
          return ce._fn('Element', [args[0], ce.domain(args[1])]);
        return ce._fn('Element', args);
      },
      evaluate: (ce, args) => evaluateElement(ce, args),
    },
  },
  NotElement: {
    complexity: 11200,
    hold: 'all',
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Element', args)]),
    },
  },
  Subset: {
    complexity: 11200,
    signature: { domain: 'Predicate' },
  },
  NotSubset: {
    complexity: 11200,
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Subset', args)]),
    },
  },
  Superset: {
    complexity: 11200,
    signature: { domain: 'Predicate' },
  },
  SupersetEqual: {
    complexity: 11200,
    signature: { domain: 'Predicate' },
  },
  NotSuperset: {
    complexity: 11200,
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Superset', args)]),
    },
  },
  NotSupersetEqual: {
    complexity: 11200,
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('SupersetEqual', args)]),
    },
  },
  SubsetEqual: {
    complexity: 11200,
    signature: { domain: 'Predicate' },
    // evaluate: subsetEqual,
  },
  NotSubsetNotEqual: {
    complexity: 11200,
    signature: {
      domain: 'Predicate',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('SubsetEqual', args)]),
    },
  },

  //
  // Functions
  //

  CartesianProduct: {
    // Aka the product set, the set direct product or cross product
    // Notation: \times
    wikidata: 'Q173740',
    signature: { domain: ['Function', 'Set', ['Sequence', 'Set'], 'Set'] },
    // evaluate: cartesianProduct,
  },
  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent lists
    wikidata: 'Q242767',
    signature: { domain: ['Function', 'Set', 'Set'] },
  },
  Intersection: {
    // notation: \cap
    wikidata: 'Q185837',
    threadable: true,
    associative: true,
    commutative: true,
    involution: true,
    signature: {
      domain: ['Function', 'Set', ['Sequence', 'Set'], 'Set'],
      evaluate: intersection,
    },
  },
  Union: {
    // Works on set, but can also work on lists
    wikidata: 'Q185359',
    threadable: true,
    associative: true,
    commutative: true,
    involution: true,
    signature: {
      domain: ['Function', 'Set', ['Sequence', 'Set'], 'Set'],
      evaluate: union,
    },
  },
  // {
  //   name: 'Set',
  //   domain: ['Function', ['Sequence', 'Anything'], 'Set'],
  //   // @todo! set has multiple forms
  //   // Set(Sequence)
  //   // Set(Sequence, Condition)
  //   // Set(Set, Condition)
  // }, // disjoint union Q842620 ⊔
  SetMinus: {
    wikidata: 'Q18192442',
    signature: {
      domain: ['Function', 'Set', 'Value', 'Set'],
      evaluate: setMinus,
    },
  },
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    wikidata: 'Q1147242',
    signature: { domain: ['Function', 'Set', ['Sequence', 'Set'], 'Set'] },
  },
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

function evaluateElement(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  console.assert(ops.length === 2);
  const [lhs, rhs] = ops;
  if (rhs.string) {
    if (lhs.string && rhs.string.includes(lhs.string)) return ce.symbol('True');
    return ce.symbol('False');
  }

  // Is the key `lhs` in the dictionary `rhs`?
  if (rhs.keys) {
    if (lhs.string)
      for (const key of rhs.keys)
        if (key === lhs.string) return ce.symbol('True');
    return ce.symbol('False');
  }

  // Is the element `lhs` or the sublist `lhs` inside `rhs`?
  if (rhs.head === 'List') {
    if (lhs.head === 'List') {
      let found = false;
      for (let i = 0; i < 1 + (rhs.nops - lhs.nops); ++i) {
        found = true;
        for (let j = 0; j < lhs.nops; ++j) {
          if (!rhs.ops![i + j].isEqual(lhs.ops![j])) {
            found = false;
            break;
          }
        }
        if (found) return ce.symbol('True');
      }

      return ce.symbol('False');
    }
    // Is the `lhs` element inside the list?
    const val = lhs.head === 'Hold' ? lhs.op1 : lhs;
    for (const elem of rhs.ops!)
      if (val.isEqual(elem)) return ce.symbol('True');

    return ce.symbol('False');
  }

  if (isValidDomain(rhs)) {
    if (lhs.domain.isCompatible(ce.domain(rhs))) return ce.symbol('True');
    return ce.symbol('False');
  }

  return ce._fn('Element', [lhs, rhs]);
}
