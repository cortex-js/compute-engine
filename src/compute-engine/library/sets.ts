// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { isDomain } from '../boxed-expression/boxed-domain';
import { checkArity } from '../boxed-expression/validate';
import { each, isFiniteIndexableCollection } from '../collection-utils';
import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
} from '../public';

export const SETS_LIBRARY: IdentifierDefinitions = {
  //
  // Constants
  //
  EmptySet: {
    domain: 'Sets',
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
      domain: 'Predicates',
      canonical: (ce, args) => {
        args = checkArity(ce, args, 2);
        if (args.length === 2 && args[0].isValid && isDomain(args[1]))
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
      domain: 'Predicates',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Element', args)]),
    },
  },
  Subset: {
    complexity: 11200,
    signature: { domain: 'Predicates' },
  },
  NotSubset: {
    complexity: 11200,
    signature: {
      domain: 'Predicates',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Subset', args)]),
    },
  },
  Superset: {
    complexity: 11200,
    signature: { domain: 'Predicates' },
  },
  SupersetEqual: {
    complexity: 11200,
    signature: { domain: 'Predicates' },
  },
  NotSuperset: {
    complexity: 11200,
    signature: {
      domain: 'Predicates',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('Superset', args)]),
    },
  },
  NotSupersetEqual: {
    complexity: 11200,
    signature: {
      domain: 'Predicates',
      canonical: (ce, args) => ce.fn('Not', [ce.fn('SupersetEqual', args)]),
    },
  },
  SubsetEqual: {
    complexity: 11200,
    signature: { domain: 'Predicates' },
    // evaluate: subsetEqual,
  },
  NotSubsetNotEqual: {
    complexity: 11200,
    signature: {
      domain: 'Predicates',
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
    signature: { domain: ['FunctionOf', 'Sets', ['VarArg', 'Sets'], 'Sets'] },
    // evaluate: cartesianProduct,
  },
  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent lists
    wikidata: 'Q242767',
    signature: { domain: ['FunctionOf', 'Sets', 'Sets'] },
  },
  Intersection: {
    // notation: \cap
    wikidata: 'Q185837',
    associative: true,
    commutative: true,
    involution: true,
    signature: {
      domain: ['FunctionOf', 'Collections', ['VarArg', 'Collections'], 'Sets'],
      canonical: (ce, args) => {
        if (args.length === 0) return ce.symbol('EmptySet');
        if (args.length === 1) return ce.symbol('EmptySet');
        return ce._fn('Intersection', args);
      },
      evaluate: intersection,
    },
  },
  Union: {
    // Works on set, but can also work on lists
    wikidata: 'Q185359',
    associative: true,
    commutative: true,
    involution: true,
    signature: {
      domain: ['FunctionOf', 'Collections', ['VarArg', 'Collections'], 'Sets'],
      canonical: (ce, args) => {
        if (args.length === 0) return ce.symbol('EmptySet');
        // Even if there is only one argument, we still need to call Union
        // to canonicalize the argument, since it may not be a set (it could
        // be a collection)
        return ce._fn('Union', args);
      },
      evaluate: union,
    },
  },
  // {
  //   name: 'Set',
  //   domain: ['FunctionOf', ['VarArg', 'Anything'], 'Sets'],
  //   // @todo! set has multiple forms
  //   // Set(Sequence)
  //   // Set(Sequence, Condition)
  //   // Set(Set, Condition)
  // }, // disjoint union Q842620 ⊔
  SetMinus: {
    wikidata: 'Q18192442',
    signature: {
      domain: ['FunctionOf', 'Sets', 'Values', 'Sets'],
      evaluate: setMinus,
    },
  },
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    wikidata: 'Q1147242',
    signature: { domain: ['FunctionOf', 'Sets', ['VarArg', 'Sets'], 'Sets'] },
  },
};

function subset(ce: IComputeEngine, _ops: BoxedExpression[]): BoxedExpression {
  // @todo
  return ce.False;
}
function subsetEqual(
  ce: IComputeEngine,
  _ops: BoxedExpression[]
): BoxedExpression {
  // @todo
  return ce.False;
}

function union(ce: IComputeEngine, ops: BoxedExpression[]): BoxedExpression {
  const elements: BoxedExpression[] = [];
  for (const op of ops) {
    if (isFiniteIndexableCollection(op)) {
      for (const elem of each(op)) {
        if (elements.every((e) => !e.isEqual(elem))) elements.push(elem);
      }
    } else {
      // Not a collection, assume it's a collection made of this single element
      if (elements.every((elem) => !elem.isEqual(op))) elements.push(op);
    }
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

function intersection(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  let elements: BoxedExpression[] = ops[0].ops ?? [];

  // Remove elements that are not in all the other sets
  for (const op of ops.slice(1)) {
    if (isFiniteIndexableCollection(op)) {
      elements = elements.filter((element) =>
        [...each(op)].some((op) => element.isEqual(op))
      );
    } else {
      // Not a collection, assume it's a collection made of this single element
      elements = elements.filter((element) => element.isEqual(op));
    }
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
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
    if (lhs.string && rhs.string.includes(lhs.string)) return ce.True;
    return ce.False;
  }

  // Is the key `lhs` in the dictionary `rhs`?
  if (rhs.keys) {
    if (lhs.string)
      for (const key of rhs.keys) if (key === lhs.string) return ce.True;
    return ce.False;
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
        if (found) return ce.True;
      }

      return ce.False;
    }
    // Is the `lhs` element inside the list?
    const val = lhs.head === 'Hold' ? lhs.op1 : lhs;
    for (const elem of rhs.ops!) if (val.isEqual(elem)) return ce.True;

    return ce.False;
  }

  if (isDomain(rhs) && lhs.domain) {
    if (lhs.domain.isCompatible(ce.domain(rhs))) return ce.True;
    return ce.False;
  }

  return ce._fn('Element', [lhs, rhs]);
}
