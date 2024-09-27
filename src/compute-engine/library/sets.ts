// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { isSubtype } from '../../common/type/subtype.ts';
import {
  each,
  iterator,
  isFiniteIndexableCollection,
  MAX_SIZE_EAGER_COLLECTION,
} from '../collection-utils.ts';
import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
  SymbolDefinition,
} from '../public.ts';

export const SETS_LIBRARY: IdentifierDefinitions = {
  //
  // Constants
  //
  EmptySet: {
    type: 'set',
    constant: true,
    wikidata: 'Q226183',
    eq: (b) => isSubtype(b.type, 'set') && b.size === 0,
    collection: {
      size: () => 0,
      contains: () => false,
      subsetOf: () => true,
      eltsgn: () => undefined,
      elttype: () => 'never',
    },
  } as SymbolDefinition,

  Numbers: {
    type: 'set<number>',
    constant: true,
    collection: {
      size: () => Infinity,
      contains: (_, x) => isSubtype(x.type, 'number'),
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace')
          return true;
        return (
          isSubtype(rhs.type, 'set<number>') &&
          (!strict || rhs.symbol !== 'Numbers')
        );
      },
      eltsgn: () => 'unsigned',
      elttype: () => 'number',
    },
  },

  ComplexNumbers: {
    type: 'set<complex>',
    constant: true,
    collection: {
      size: () => Infinity,
      contains: (_, x) => isSubtype(x.type, 'complex'),
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace')
          return true;
        return (
          isSubtype(rhs.type, 'set<complex>') &&
          (!strict || rhs.symbol !== 'ComplexNumbers')
        );
      },
      eltsgn: () => 'unsigned',
      elttype: () => 'complex',
    },
  },

  ImaginaryNumbers: {
    type: 'set<imaginary>',
    constant: true,
    collection: {
      size: () => Infinity,
      contains: (_, x) => isSubtype(x.type, 'imaginary'),
      subsetOf: (_, rhs, strict) =>
        isSubtype(rhs.type, 'set<imaginary>') &&
        (!strict || rhs.symbol !== 'ImaginaryNumbers'),
      eltsgn: () => 'unsigned',
      elttype: () => 'complex',
    },
  },

  Integers: {
    type: 'set<integer>',
    constant: true,
    collection: {
      contains: (_, x) => isSubtype(x.type, 'integer'),
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') return true;
        return (
          isSubtype(rhs.type, 'set<integer>') &&
          (!strict || rhs.symbol !== 'Integers')
        );
      },
      eltsgn: () => undefined,
      elttype: () => 'integer',
    },
  },

  RationalNumbers: {
    type: 'set<rational>',
    constant: true,
    collection: {
      size: () => Infinity,
      contains: (_, x) => isSubtype(x.type, 'rational'),
      subsetOf: (_, rhs, strict) =>
        isSubtype(rhs.type, 'set<rational>') &&
        (!strict || rhs.symbol !== 'RationalNumbers'),
      eltsgn: () => undefined,
      elttype: () => 'rational',
    },
  },

  // < 0
  NegativeNumbers: {
    type: 'set<real>',
    constant: true,
    collection: {
      size: () => Infinity,
      contains: (_, x) => isSubtype(x.type, 'real') && x.isNegative === true,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low < 0 && high < 0;
        }
        return (
          isSubtype(rhs.type, 'set<real>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
          (!strict || rhs.symbol !== 'NegativeNumbers')
        );
      },

      eltsgn: () => 'negative',
      elttype: () => 'real',
    },
  },

  // <= 0
  NonPositiveNumbers: {
    type: 'set<real>',
    constant: true,
    collection: {
      contains: (_, x) => isSubtype(x.type, 'real') && x.isNonPositive === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low >= 0 && high >= 0;
        }

        return (
          isSubtype(rhs.type, 'set<real>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || rhs.symbol !== 'NonPositiveNumbers')
        );
      },
      eltsgn: () => 'non-positive',
      elttype: () => 'real',
    },
  },

  PositiveNumbers: {
    type: 'set<real>',
    constant: true,
    collection: {
      contains: (_, x) => isSubtype(x.type, 'real') && x.isPositive === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          isSubtype(rhs.type, 'set<real>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || rhs.symbol !== 'PositiveNumbers')
        );
      },
      eltsgn: () => 'positive',
      elttype: () => 'real',
    },
  },

  NegativeIntegers: {
    type: 'set<integer>',
    constant: true,
    collection: {
      contains: (_, x) => isSubtype(x.type, 'integer') && x.isNegative === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low < 0 && high < 0;
        }

        return (
          isSubtype(rhs.type, 'set<integer>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
          (!strict || rhs.symbol !== 'NegativeIntegers')
        );
      },
      eltsgn: () => 'negative',
      elttype: () => 'integer',
    },
  },

  NonPositiveIntegers: {
    type: 'set<integer>',
    constant: true,
    collection: {
      contains: (_, x) =>
        isSubtype(x.type, 'integer') && x.isNonPositive === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low <= 0 && high <= 0;
        }
        return (
          isSubtype(rhs.type, 'set<integer>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || rhs.symbol !== 'NonPositiveIntegers')
        );
      },
      eltsgn: () => 'non-positive',
      elttype: () => 'integer',
    },
  },

  PositiveIntegers: {
    type: 'set<integer>',
    constant: true,
    collection: {
      contains: (_, x) => isSubtype(x.type, 'integer') && x.isPositive === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          isSubtype(rhs.type, 'set<integer>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || rhs.symbol !== 'PositiveIntegers')
        );
      },
      eltsgn: () => 'non-positive',
      elttype: () => 'integer',
    },
  },

  // >= 0
  NonNegativeInteger: {
    type: 'set<integer>',
    constant: true,
    collection: {
      contains: (_, x) =>
        isSubtype(x.type, 'integer') && x.isNonNegative === true,
      size: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          isSubtype(rhs.type, 'set<integer>') &&
          rhs.symbolDefinition?.collection?.eltsgn?.(rhs) === 'non-negative' &&
          (!strict || rhs.symbol !== 'NonNegativeInteger')
        );
      },
      eltsgn: () => 'non-negative',
      elttype: () => 'integer',
    },
  },

  //
  // Predicates
  //
  Element: {
    complexity: 11200,
    signature: '(value, collection|string) -> boolean',
    evaluate: ([value, collection], { engine: ce }) => {
      const result = collection.contains(value);
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotElement: {
    complexity: 11200,
    signature: '(value, collection|string) -> boolean',
    evaluate: ([value, collection], { engine: ce }) => {
      const result = collection.contains(value);
      if (result === true) return ce.False;
      if (result === false) return ce.True;
      return undefined;
    },
  },

  Subset: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(lhs, rhs);
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  SubsetEqual: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(lhs, rhs, false);
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotSubset: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(lhs, rhs);
      if (result === true) return ce.False;
      if (result === false) return ce.True;
      return undefined;
    },
  },

  Superset: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(rhs, lhs); // reversed
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  SupersetEqual: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(rhs, lhs, true); // reversed
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotSuperset: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(rhs, lhs); // reversed
      if (result === true) return ce.False;
      if (result === false) return ce.True;
      return undefined;
    },
  },

  NotSupersetEqual: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      const result = subset(rhs, lhs, true); // reversed
      if (result === true) return ce.False;
      if (result === false) return ce.True;
      return undefined;
    },
  },
  // NotSubsetNotEqual: {
  //   complexity: 11200,
  //   signature: {
  //     domain: 'Predicates',
  //     canonical: (args, { engine: ce }) =>
  //       ce._fn('Not', [ce.function('SubsetEqual', args)]),
  //   },
  // },

  //
  // Functions
  //

  CartesianProduct: {
    // Aka the product set, the set direct product or cross product
    // Notation: \times
    wikidata: 'Q173740',
    signature: '(set, ...set) -> set',
    // evaluate: cartesianProduct, // @todo
  },

  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent sets
    wikidata: 'Q242767',
    signature: '(set, ...set) -> set',
    //     evaluate: (ops, { engine: ce }) => { // @todo
  },

  Intersection: {
    // notation: \cap
    wikidata: 'Q185837',
    associative: true,
    commutative: true,
    involution: true,
    signature: '(set, ...set) -> set',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      if (args.length === 1) return ce.symbol('EmptySet');
      return ce._fn('Intersection', args);
    },
    evaluate: intersection,
  },

  Union: {
    // Works on set, but can also work on lists
    wikidata: 'Q185359',
    associative: true,
    commutative: true,
    involution: true,
    signature: '(collection, ...collection) -> set',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      // Even if there is only one argument, we still need to call Union
      // to canonicalize the argument, since it may not be a set (it could
      // be a collection)
      return ce._fn('Union', args);
    },
    evaluate: union,

    // These handlers will get called if we have a lazy collection,
    // that is a union of collections with more than MAX_SIZE_EAGER_COLLECTION
    // elements. Otherwise, when we evaluated the union, we got a set literal.
    collection: {
      contains: (col, x) => col.ops!.some((op) => op.contains(x)),
      size: (col) => {
        // If any of the collections is infinite, the union is infinite
        if (col.ops!.some((op) => op.size === Infinity)) return Infinity;

        // Count the unique elements in the union
        const seen: BoxedExpression[] = [];
        let count = 0;
        for (const op of col.ops!) {
          for (const elem of each(op)) {
            if (seen.every((e) => !e.contains(elem))) count += 1;
          }
          seen.push(op);
        }

        return count;
      },

      iterator: (col) => {
        const seen: BoxedExpression[] = [];
        let current = 0;
        let iter = iterator(col.ops![current]);
        if (!iter) return { next: () => ({ value: undefined, done: true }) };

        return {
          next: () => {
            let found = false;
            let iterResult;
            do {
              iterResult = iter!.next();
              if (iterResult.done) {
                seen.push(col.ops![current]);
                current += 1;
                if (current === col.ops!.length)
                  return { value: undefined, done: true };
                iter = iterator(col.ops![current])!;
                if (!iter) return { value: undefined, done: true };
              }
              found = seen.every((e) => !e.contains(iterResult!.value));
            } while (!found);
            return { value: iterResult!.value, done: false };
          },
        };
      },
    },
  },

  SetMinus: {
    wikidata: 'Q18192442',
    signature: '(set, ...value) -> set',
    evaluate: setMinus,
    collection: {
      contains: (expr, x) => {
        const [col, ...values] = expr.ops!;
        return (
          (col.contains(x) ?? false) && !values.some((val) => val.isSame(x))
        );
      },
      iterator: (expr) => {
        const [col, ...values] = expr.ops!;
        // Iterate over the values of col, but skip the values that are in values
        const iter = iterator(col);
        if (!iter) return { next: () => ({ value: undefined, done: true }) };
        return {
          next() {
            let result = iter.next();
            while (
              !result.done &&
              values.some((val) => val.isSame(result.value))
            )
              result = iter.next();
            return result;
          },
        };
      },
    },
  },

  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    wikidata: 'Q1147242',
    signature: '(set, set) -> set',
  },
};

function subset(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  strict = true
): boolean {
  if (!lhs.isCollection || !rhs.isCollection) return false;
  if (lhs.symbolDefinition?.collection?.subsetOf?.(lhs, rhs, strict))
    return true;
  return false;
}

function union(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
): BoxedExpression | undefined {
  // ops should be collections. If there are scalars, convert them to singleton sets
  const xs = ops.map((op) => (op.isCollection ? op : ce._fn('Set', [op])));

  const totalSize = xs.reduce((acc, op) => acc + (op.size ?? 0), 0);
  if (totalSize > MAX_SIZE_EAGER_COLLECTION) return ce._fn('Union', xs);

  // Keep only unique elements
  const elements: BoxedExpression[] = [];
  for (const op of xs) {
    for (const elem of each(op))
      if (elements.every((e) => !e.isSame(elem))) elements.push(elem);
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

function intersection(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
): BoxedExpression {
  // @fixme: need to account for eager/lazy collections. See Union
  let elements: BoxedExpression[] = [...(ops[0].ops ?? [])];

  // Remove elements that are not in all the other sets
  for (const op of ops.slice(1)) {
    if (isFiniteIndexableCollection(op)) {
      elements = elements.filter((element) =>
        [...each(op)].some((op) => element.isSame(op))
      );
    } else {
      // Not a collection, assume it's a collection made of this single element
      elements = elements.filter((element) => element.isSame(op));
    }
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

function setMinus(
  _ops: BoxedExpression[],
  { engine: ce }: { engine: IComputeEngine }
): BoxedExpression {
  return ce.symbol('EmptySet');
}

function cartesianProduct(
  _ops: BoxedExpression[],
  { engine: ce }: { engine: IComputeEngine }
): BoxedExpression {
  return ce.symbol('EmptySet');
}

function setEqual(a: BoxedExpression, b: BoxedExpression): boolean {
  if (a.isCollection && b.isCollection) {
    if (a.symbol && b.symbol && a.symbol === b.symbol) return true;
    if (a.size === Infinity && b.size === Infinity) {
      // If the sets have infinite size, compare their elements
      // @todo
    }
    if (a.size !== b.size) return false;
    if (a.size === Infinity || b.size === Infinity) return false;
    for (const elem of each(a)) if (!b.contains(elem)) return false;
    return true;
  }
  return false;
}
