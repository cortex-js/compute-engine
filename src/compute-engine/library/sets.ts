// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { BoxedType } from '../../common/type/boxed-type';
import { parseType } from '../../common/type/parse';
import { flatten } from '../boxed-expression/flatten';
import { validateArguments } from '../boxed-expression/validate';
import {
  isFiniteIndexedCollection,
  MAX_SIZE_EAGER_COLLECTION,
} from '../collection-utils';
import type {
  BoxedExpression,
  SymbolDefinitions,
  ComputeEngine,
} from '../global-types';
import {
  cantorEnumerateComplexNumbers,
  cantorEnumerateIntegers,
  cantorEnumeratePositiveRationals,
  cantorEnumerateRationals,
} from '../numerics/numeric';

export const SETS_LIBRARY: SymbolDefinitions = {
  //
  // Constants
  //
  EmptySet: {
    type: 'set',
    isConstant: true,
    wikidata: 'Q226183',
    description: 'The empty set, a set containing no elements.',
    eq: (b) => b.type.matches('set') && b.isEmptyCollection,
    collection: {
      iterator: () => ({
        next: () => ({ value: undefined, done: true }),
      }),
      count: () => 0,
      isEmpty: () => true,
      isFinite: () => true,
      contains: () => false,
      subsetOf: () => true,
      eltsgn: () => undefined,
      elttype: () => 'never',
    },
  },

  Numbers: {
    type: 'set<number>',
    isConstant: true,
    description: 'The set of all numbers.',
    collection: {
      iterator: complexIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,

      contains: (_, x) => x.type.matches('number'),
      subsetOf: (_, other, strict) => {
        if (other.operator === 'Range' || other.operator === 'Linspace')
          return true;
        return (
          other.type.matches(BoxedType.setNumber) &&
          (!strict || other.symbol !== 'Numbers')
        );
      },
      eltsgn: () => 'unsigned',
      elttype: () => 'number',
    },
  },

  ComplexNumbers: {
    type: 'set<finite_complex>',
    isConstant: true,
    description: 'The set of all finite complex numbers.',
    collection: {
      iterator: complexIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => x.type.matches('finite_complex'),
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace')
          return true;
        return (
          rhs.type.matches(BoxedType.setComplex) &&
          (!strict || rhs.symbol !== 'ComplexNumbers')
        );
      },
      eltsgn: () => 'unsigned',
      elttype: () => 'finite_complex',
    },
  },

  ExtendedComplexNumbers: {
    type: 'set<complex>',
    isConstant: true,
    description: 'The set of all complex numbers, including infinities.',
    collection: {
      iterator: complexIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => x.type.matches('complex'),
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace')
          return true;
        return (
          rhs.type.matches(BoxedType.setComplex) &&
          (!strict || rhs.symbol !== 'ComplexNumbers')
        );
      },
      eltsgn: () => 'unsigned',
      elttype: () => 'complex',
    },
  },

  ImaginaryNumbers: {
    type: 'set<imaginary>',
    isConstant: true,
    description: 'The set of all imaginary numbers.',
    collection: {
      iterator: imaginaryIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => x.type.matches(BoxedType.setImaginary),
      subsetOf: (_, rhs, strict) =>
        rhs.type.matches(BoxedType.setImaginary) &&
        (!strict || rhs.symbol !== 'ImaginaryNumbers'),
      eltsgn: () => 'unsigned',
      elttype: () => 'imaginary',
    },
  },

  RealNumbers: {
    type: 'set<finite_real>',
    isConstant: true,
    description: 'The set of all finite real numbers.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => x.type.matches('finite_real'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) =>
        rhs.type.matches(BoxedType.setReal) &&
        (!strict || rhs.symbol !== 'RealNumbers'),
      eltsgn: () => undefined,
      elttype: () => 'finite_real',
    },
  },

  ExtendedRealNumbers: {
    type: 'set<real>',
    isConstant: true,
    description: 'The set of all real numbers, including infinities.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => x.type.matches('real'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) =>
        rhs.type.matches(BoxedType.setReal) &&
        (!strict || rhs.symbol !== 'ExtendedRealNumbers'),
      eltsgn: () => undefined,
      elttype: () => 'real',
    },
  },

  Integers: {
    type: 'set<finite_integer>',
    isConstant: true,
    description: 'The set of all finite integers.',
    collection: {
      iterator: integerIterator,
      contains: (_, x) => x.type.matches('finite_integer'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') return true;
        return (
          rhs.type.matches(BoxedType.setFiniteInteger) &&
          (!strict || rhs.symbol !== 'Integers')
        );
      },
      eltsgn: () => undefined,
      elttype: () => 'finite_integer',
    },
  },

  ExtendedIntegers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all integers, including infinities.',
    collection: {
      iterator: integerIterator,
      contains: (_, x) => x.type.matches('integer'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') return true;
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          (!strict || rhs.symbol !== 'ExtendedIntegers')
        );
      },
      eltsgn: () => undefined,
      elttype: () => 'integer',
    },
  },

  RationalNumbers: {
    type: 'set<finite_rational>',
    isConstant: true,
    description: 'The set of all finite rational numbers.',
    collection: {
      iterator: (self) => rationalIterator(self),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => x.type.matches('finite_rational'),
      subsetOf: (_, rhs, strict) =>
        rhs.type.matches(BoxedType.setRational) &&
        (!strict || rhs.symbol !== 'RationalNumbers'),
      eltsgn: () => undefined,
      elttype: () => 'finite_rational',
    },
  },

  ExtendedRationalNumbers: {
    type: 'set<rational>',
    isConstant: true,
    description: 'The set of all rational numbers, including infinities.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => x.type.matches('rational'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) =>
        rhs.type.matches(BoxedType.setRational) &&
        (!strict || rhs.symbol !== 'ExtendedRationalNumbers'),
      eltsgn: () => undefined,
      elttype: () => 'rational',
    },
  },

  // < 0
  NegativeNumbers: {
    type: 'set<real>',
    isConstant: true,
    description: 'The set of all negative real numbers.',
    collection: {
      iterator: (self) =>
        rationalIterator(self, { sign: '-', includeZero: false }),
      count: () => Infinity,
      contains: (_, x) => x.type.matches('real') && x.isNegative === true,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low < 0 && high < 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
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
    isConstant: true,
    description: 'The set of all non-positive real numbers.',
    collection: {
      iterator: (self) =>
        rationalIterator(self, { sign: '-', includeZero: true }),
      contains: (_, x) => x.type.matches('real') && x.isNonPositive === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low >= 0 && high >= 0;
        }

        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || rhs.symbol !== 'NonPositiveNumbers')
        );
      },
      eltsgn: () => 'non-positive',
      elttype: () => 'real',
    },
  },

  // >= 0
  NonNegativeNumbers: {
    type: 'set<real>',
    isConstant: true,
    description: 'The set of all non-negative real numbers.',
    collection: {
      iterator: (self) =>
        rationalIterator(self, { sign: '+', includeZero: true }),
      contains: (_, x) => x.type.matches('real') && x.isNonNegative === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low <= 0 && high <= 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-negative' &&
          (!strict || rhs.symbol !== 'NonNegativeNumbers')
        );
      },
      eltsgn: () => 'non-negative',
      elttype: () => 'real',
    },
  },

  // > 0
  PositiveNumbers: {
    type: 'set<real>',
    isConstant: true,
    description: 'The set of all positive real numbers.',
    collection: {
      iterator: (self) =>
        rationalIterator(self, { sign: '+', includeZero: false }),
      contains: (_, x) => x.type.matches('real') && x.isPositive === true,
      count: () => Infinity,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || rhs.symbol !== 'PositiveNumbers')
        );
      },
      eltsgn: () => 'positive',
      elttype: () => 'real',
    },
  },

  // <= -1
  NegativeIntegers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all negative integers.',
    collection: {
      iterator: (self) => integerRangeIterator(self.engine, -1, -1),
      contains: (_, x) => x.type.matches('integer') && x.isNegative === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low < 0 && high < 0;
        }

        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
          (!strict || rhs.symbol !== 'NegativeIntegers')
        );
      },
      eltsgn: () => 'negative',
      elttype: () => 'integer',
    },
  },

  // <= 0
  NonPositiveIntegers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all non-positive integers.',
    collection: {
      iterator: (self) => integerRangeIterator(self.engine, 0, -1),
      contains: (_, x) => x.type.matches('integer') && x.isNonPositive === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low <= 0 && high <= 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || rhs.symbol !== 'NonPositiveIntegers')
        );
      },
      eltsgn: () => 'non-positive',
      elttype: () => 'integer',
    },
  },

  // >= 0
  NonNegativeIntegers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all non-negative integers.',
    collection: {
      iterator: (self) => integerRangeIterator(self.engine, 0, 1),
      contains: (_, x) => x.type.matches('integer') && x.isNonNegative === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-negative' &&
          (!strict || rhs.symbol !== 'NonNegativeIntegers')
        );
      },
      eltsgn: () => 'non-negative',
      elttype: () => 'integer',
    },
  },

  // >= 1
  PositiveIntegers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all positive integers.',
    collection: {
      iterator: (self) => integerRangeIterator(self.engine, 1, 1),
      contains: (_, x) => x.type.matches('integer') && x.isPositive === true,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range') {
          const low = rhs.ops![0].re;
          const high = rhs.ops![1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || rhs.symbol !== 'PositiveIntegers')
        );
      },
      eltsgn: () => 'positive',
      elttype: () => 'integer',
    },
  },

  //
  // Predicates
  //
  Element: {
    complexity: 11200,
    signature: '(value, collection) -> boolean',
    description: 'Test whether a value is an element of a collection.',
    evaluate: ([value, collection], { engine: ce }) => {
      const result = collection.contains(value);
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotElement: {
    complexity: 11200,
    signature: '(value, collection) -> boolean',
    description: 'Test whether a value is not an element of a collection.',
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
    description:
      'Test whether the first collection is a strict subset of the second.',
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
    description:
      'Test whether the first collection is a subset (possibly equal) of the second.',
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
    description:
      'Test whether the first collection is not a strict subset of the second.',
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
    description:
      'Test whether the first collection is a strict superset of the second.',
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
    description:
      'Test whether the first collection is a superset (possibly equal) of the second.',
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
    description:
      'Test whether the first collection is not a strict superset of the second.',
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
    description:
      'Test whether the first collection is not a superset (possibly equal) of the second.',
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

  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent sets
    wikidata: 'Q242767',
    signature: '(set+) -> set',
    description:
      'Return the elements of the first set that are not in any of the subsequent sets.',
    collection: {
      contains: (expr, x) => {
        const [col, ...others] = expr.ops!;
        return (
          (col.contains(x) ?? false) && others.every((set) => !set.contains(x))
        );
      },
      count: (expr) =>
        countMatchingElements(expr, (elem) =>
          expr.ops!.slice(1).every((set) => !set.contains(elem))
        ),

      iterator: complementIterator,
    },
  },

  Intersection: {
    // notation: \cap
    wikidata: 'Q185837',
    signature: '(set+) -> set',
    description: 'Return the intersection of two or more sets.',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      if (args.length === 1) return ce.symbol('EmptySet');
      args =
        validateArguments(
          ce,
          flatten(args, 'Intersection'),
          parseType('(set+) -> set')
        ) ?? args;
      return ce._fn('Intersection', args);
    },
    evaluate: intersection,
    collection: {
      contains: containsAll,
      count: (expr) =>
        countMatchingElements(expr, (elem) =>
          expr.ops!.slice(1).every((op) => op.contains(elem))
        ),
      iterator: intersectionIterator,
    },
  },

  Union: {
    // Works on set, but can also work on lists
    wikidata: 'Q185359',
    signature: '(collection+) -> set',
    description: 'Return the union of two or more collections as a set.',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      args =
        validateArguments(
          ce,
          flatten(args, 'Union'),
          parseType('(collection+) -> set')
        ) ?? args;
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
      count: (col) =>
        countMatchingUnion(col, (elem, seen) =>
          seen.every((e) => !e.contains(elem))
        ),
      isEmpty: (col) => col.ops!.every((op) => op.isEmptyCollection),
      isFinite: (col) => col.ops!.every((op) => op.isFiniteCollection),
      iterator: unionIterator,
    },
  },

  SetMinus: {
    wikidata: 'Q18192442',
    signature: '(set, value*) -> set',
    description:
      'Return the set difference between the first set and subsequent values.',
    evaluate: setMinus,
    collection: {
      contains: (expr, x) => {
        const [col, ...values] = expr.ops!;
        return (
          (col.contains(x) ?? false) && !values.some((val) => val.isSame(x))
        );
      },
      count: (expr) =>
        countMatchingElements(expr, (elem) => {
          const [col, ...values] = expr.ops!;
          return !values.some((val) => val.isSame(elem));
        }),
      iterator: setMinusIterator,
    },
  },
  SymmetricDifference: {
    // symmetric difference = disjunctive union  (circled minus)
    /* = Union(Complement(a, b), Complement(b, a) */
    /* Corresponds to XOR in boolean logic */
    wikidata: 'Q1147242',
    signature: '(set, set) -> set',
    description:
      'Return the symmetric difference of two sets (elements in either set but not both).',
    collection: {
      contains: (expr, x) => {
        const [a, b] = expr.ops!;
        const inA = a.contains(x) ?? false;
        const inB = b.contains(x) ?? false;
        return (inA && !inB) || (!inA && inB);
      },
      count: (expr) =>
        countMatchingElements(expr, (elem) => {
          const [a, b] = expr.ops!;
          const inA = a.contains(elem) ?? false;
          const inB = b.contains(elem) ?? false;
          return (inA && !inB) || (!inA && inB);
        }),
      iterator: symmetricDifferenceIterator,
    },
  },
};

function subset(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  strict = true
): boolean {
  if (!lhs.isCollection || !rhs.isCollection) return false;
  if (lhs.baseDefinition?.collection?.subsetOf?.(lhs, rhs, strict)) return true;
  return false;
}

function union(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // ops should be collections. If there are scalars, convert them to singleton sets
  const xs = ops.map((op) => (op.isCollection ? op : ce.function('Set', [op])));

  const totalSize = xs.reduce((acc, op) => acc + (op.count ?? 0), 0);
  if (totalSize > MAX_SIZE_EAGER_COLLECTION) return ce._fn('Union', xs);

  // Keep only unique elements
  const elements: BoxedExpression[] = [];
  for (const op of xs) {
    for (const elem of op.each()) {
      if (elements.every((e) => !e.isSame(elem))) elements.push(elem);
    }
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

function intersection(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression {
  // @fixme: need to account for eager/lazy collections. See Union
  let elements: BoxedExpression[] = [...(ops[0].ops ?? [])];

  // Remove elements that are not in all the other sets
  for (const op of ops.slice(1)) {
    if (isFiniteIndexedCollection(op)) {
      elements = elements.filter((element) =>
        [...op.each()].some((op) => element.isSame(op))
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
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression {
  return ce.symbol('EmptySet');
}

function cartesianProduct(
  _ops: BoxedExpression[],
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression {
  return ce.symbol('EmptySet');
}

function imaginaryIterator(
  self: BoxedExpression
): Iterator<BoxedExpression, undefined, any> {
  const iterator = cantorEnumerateRationals();
  return {
    next: (): IteratorResult<BoxedExpression, undefined> => {
      const { value, done } = iterator.next();
      if (done) return { value: undefined, done: true };
      const [n, d] = value;
      return {
        value: self.engine.number({ re: 0, im: n / d }),
        done: false,
      };
    },
  };
}

function complexIterator(
  self: BoxedExpression
): Iterator<BoxedExpression, undefined, any> {
  const iterator = cantorEnumerateComplexNumbers();
  return {
    next: (): IteratorResult<BoxedExpression, undefined> => {
      const { value, done } = iterator.next();
      if (done) return { value: undefined, done: true };
      const [re, im] = value;
      return { value: self.engine.number({ re, im }), done: false };
    },
  };
}

function* rationalIterator(
  self: BoxedExpression,
  options?: { sign?: '+' | '-' | '+-'; includeZero?: boolean }
): Generator<BoxedExpression> {
  const signOpt = options?.sign ?? '+-';
  const includeZero = options?.includeZero ?? true;

  const iterator =
    signOpt === '+-'
      ? cantorEnumerateRationals()
      : cantorEnumeratePositiveRationals();

  if (!includeZero) iterator.next();

  for (const value of iterator) {
    if (signOpt === '+-') {
      yield self.engine.number(value);
    } else {
      const sign = signOpt === '-' ? -1 : 1;
      const [n, d] = value;
      yield self.engine.number([sign * n, d]);
    }
  }
}

function* integerIterator(self: BoxedExpression): Generator<BoxedExpression> {
  for (const n of cantorEnumerateIntegers()) yield self.engine.number(n);
}

function* integerRangeIterator(
  ce: ComputeEngine,
  start: number,
  step: number
): Generator<BoxedExpression> {
  let n = start;
  while (true) {
    yield ce.number(n);
    n += step;
  }
}

function* unionIterator(
  col: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  const seen: BoxedExpression[] = [];
  for (const op of col.ops!) {
    for (const elem of op.each()) {
      if (seen.every((e) => !e.contains(elem))) {
        yield elem;
      }
    }
    seen.push(op);
  }
}

function* setMinusIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  const [col, ...values] = expr.ops!;
  for (const elem of col.each()) {
    if (!values.some((val) => val.isSame(elem))) {
      yield elem;
    }
  }
}
function* complementIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  const [col, ...others] = expr.ops!;
  for (const elem of col.each()) {
    if (others.every((set) => !set.contains(elem))) {
      yield elem;
    }
  }
}

function* intersectionIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  for (const elem of expr.ops![0].each()) {
    if (expr.ops!.slice(1).every((op) => op.contains(elem))) {
      yield elem;
    }
  }
}
function* symmetricDifferenceIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  const [a, b] = expr.ops!;
  for (const elem of a.each()) {
    if (!(b.contains(elem) ?? false)) {
      yield elem;
    }
  }
  for (const elem of b.each()) {
    if (!(a.contains(elem) ?? false)) {
      yield elem;
    }
  }
}

// Helpers for efficient counting of set elements
function countMatchingElements(
  expr: BoxedExpression,
  filter: (elem: BoxedExpression) => boolean
): number {
  if (expr.ops!.some((op) => op.count === Infinity)) return Infinity;
  let count = 0;
  for (const elem of expr.ops![0].each()) {
    if (filter(elem)) count += 1;
  }
  return count;
}

function countMatchingUnion(
  expr: BoxedExpression,
  isUnique: (elem: BoxedExpression, seen: BoxedExpression[]) => boolean
): number {
  if (expr.ops!.some((op) => op.count === Infinity)) return Infinity;
  const seen: BoxedExpression[] = [];
  let count = 0;
  for (const op of expr.ops!) {
    for (const elem of op.each()) {
      if (isUnique(elem, seen)) count += 1;
    }
    seen.push(op);
  }
  return count;
}

function containsAll(expr: BoxedExpression, x: BoxedExpression): boolean {
  return expr.ops!.every((op) => op.contains(x) ?? false);
}
