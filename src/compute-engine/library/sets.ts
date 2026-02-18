// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { BoxedType } from '../../common/type/boxed-type';
import { parseType } from '../../common/type/parse';
import { reduceType } from '../../common/type/reduce';
import type { Type } from '../../common/type/types';
import { flatten } from '../boxed-expression/flatten';
import { isFunction, sym } from '../boxed-expression/type-guards';
import { validateArguments } from '../boxed-expression/validate';
import {
  isFiniteIndexedCollection,
  MAX_SIZE_EAGER_COLLECTION,
} from '../collection-utils';
import type {
  Expression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import {
  cantorEnumerateComplexNumbers,
  cantorEnumerateIntegers,
  cantorEnumeratePositiveRationals,
  cantorEnumerateRationals,
} from '../numerics/numeric';

function typeIntersection(a: Type, b: Type): Type {
  return reduceType({ kind: 'intersection', types: [a, b] });
}

/**
 * Transform a List or Tuple with exactly 2 elements to an Interval in set contexts.
 *
 * This enables contextual parsing where `[a, b]` and `(a, b)` are interpreted as
 * intervals when used as operands of set operations like Element, Union, etc.
 *
 * - `["List", a, b]` → `["Interval", a, b]` (closed interval [a, b])
 * - `["Tuple", a, b]` → `["Interval", ["Open", a], ["Open", b]]` (open interval (a, b))
 *
 * Returns the original expression unchanged if it's not a 2-element List/Tuple.
 */
function listToIntervalInSetContext(
  ce: ComputeEngine,
  expr: Expression
): Expression {
  // Transform List with 2 elements to closed Interval
  if (isFunction(expr, 'List') && expr.nops === 2) {
    return ce.function('Interval', [expr.op1.canonical, expr.op2.canonical]);
  }

  // Transform Tuple with 2 elements to open Interval
  if (isFunction(expr, 'Tuple') && expr.nops === 2) {
    return ce.function('Interval', [
      ce.function('Open', [expr.op1.canonical]),
      ce.function('Open', [expr.op2.canonical]),
    ]);
  }

  return expr.canonical;
}

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
          (!strict || sym(other) !== 'Numbers')
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
          (!strict || sym(rhs) !== 'ComplexNumbers')
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
          (!strict || sym(rhs) !== 'ComplexNumbers')
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
        (!strict || sym(rhs) !== 'ImaginaryNumbers'),
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
        (!strict || sym(rhs) !== 'RealNumbers'),
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
        (!strict || sym(rhs) !== 'ExtendedRealNumbers'),
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
          (!strict || sym(rhs) !== 'Integers')
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
          (!strict || sym(rhs) !== 'ExtendedIntegers')
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
        (!strict || sym(rhs) !== 'RationalNumbers'),
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
        (!strict || sym(rhs) !== 'ExtendedRationalNumbers'),
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
        if (
          (rhs.operator === 'Range' || rhs.operator === 'Linspace') &&
          isFunction(rhs)
        ) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low < 0 && high < 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
          (!strict || sym(rhs) !== 'NegativeNumbers')
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
        if (
          (rhs.operator === 'Range' || rhs.operator === 'Linspace') &&
          isFunction(rhs)
        ) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low >= 0 && high >= 0;
        }

        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || sym(rhs) !== 'NonPositiveNumbers')
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
        if (
          (rhs.operator === 'Range' || rhs.operator === 'Linspace') &&
          isFunction(rhs)
        ) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low <= 0 && high <= 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-negative' &&
          (!strict || sym(rhs) !== 'NonNegativeNumbers')
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
        if (
          (rhs.operator === 'Range' || rhs.operator === 'Linspace') &&
          isFunction(rhs)
        ) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setReal) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || sym(rhs) !== 'PositiveNumbers')
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
        if (isFunction(rhs, 'Range')) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low < 0 && high < 0;
        }

        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'negative' &&
          (!strict || sym(rhs) !== 'NegativeIntegers')
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
        if (isFunction(rhs, 'Range')) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low <= 0 && high <= 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-positive' &&
          (!strict || sym(rhs) !== 'NonPositiveIntegers')
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
        if (isFunction(rhs, 'Range')) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'non-negative' &&
          (!strict || sym(rhs) !== 'NonNegativeIntegers')
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
        if (isFunction(rhs, 'Range')) {
          const low = rhs.ops[0].re;
          const high = rhs.ops[1].re;
          return low > 0 && high > 0;
        }
        return (
          rhs.type.matches(BoxedType.setInteger) &&
          rhs.baseDefinition?.collection?.eltsgn?.(rhs) === 'positive' &&
          (!strict || sym(rhs) !== 'PositiveIntegers')
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
    // EL-3: Extended signature to support optional condition for filtered iteration
    // The condition is used by Sum/Product to filter values when iterating
    signature: '(value, collection, boolean?) -> boolean',
    description:
      'Test whether a value is an element of a collection. ' +
      'Optional third argument is a boolean expression (condition) for filtered iteration in Sum/Product.\n\n' +
      'Element supports two modes of operation:\n' +
      '1. Set membership: Element(3, [List, 1, 2, 3]) checks if 3 is in the list\n' +
      '2. Type-style membership: Element(x, integer) checks if x has type integer\n\n' +
      'Type-style membership works with:\n' +
      '- Mathematical sets: Integers, RealNumbers, ComplexNumbers, etc.\n' +
      '- Type names: integer, real, number, finite_real, positive_integer, etc.\n' +
      '- Invalid type names remain unevaluated (e.g., Element(2, "Booleans"))',
    canonical: (args, { engine: ce }) => {
      // Let default signature validation handle missing required arguments
      if (args.length === 0) {
        return ce._fn('Element', [ce.error('missing'), ce.error('missing')]);
      }
      if (args.length === 1) {
        return ce._fn('Element', [args[0].canonical, ce.error('missing')]);
      }

      const [value, collection, condition] = args;
      // Transform List/Tuple with 2 elements to Interval in set context
      const canonicalCollection = listToIntervalInSetContext(ce, collection);

      // Validate collection type
      if (
        !canonicalCollection.type.matches('collection') &&
        !sym(canonicalCollection) &&
        !canonicalCollection.isValid
      ) {
        return ce._fn('Element', [
          value.canonical,
          ce.error([
            'incompatible-type',
            `'collection'`,
            canonicalCollection.type.toString(),
          ]),
          ...(condition ? [condition.canonical] : []),
        ]);
      }

      // Validate optional third argument
      if (condition && sym(condition) !== 'Nothing') {
        if (!condition.type.matches('boolean')) {
          return ce._fn('Element', [
            value.canonical,
            canonicalCollection,
            ce.error([
              'incompatible-type',
              `'boolean'`,
              collection.type.toString(),
            ]),
          ]);
        }
        return ce._fn('Element', [
          value.canonical,
          canonicalCollection,
          condition.canonical,
        ]);
      }
      return ce._fn('Element', [value.canonical, canonicalCollection]);
    },
    evaluate: ([value, collection, _condition], { engine: ce }) => {
      // Note: condition is only used during Sum/Product iteration,
      // not for standalone Element evaluation

      // Check if collection has a contains method before calling it
      if (collection && typeof collection.contains === 'function') {
        const result = collection.contains(value);
        if (result === true) return ce.True;
        if (result === false) return ce.False;
      }

      // Support type-style membership checks, e.g. Element(x, finite_real) or
      // Element(x, Integers). Try to interpret the collection as a type.
      const typeName = sym(collection);
      if (typeName) {
        try {
          const type = ce.type(typeName);
          if (!type.isUnknown) {
            const valueType = value.type;
            if (valueType.matches(type)) return ce.True;
            if (typeIntersection(valueType.type, type.type) === 'nothing')
              return ce.False;
          }
        } catch {
          // If type parsing fails (e.g., "Booleans" is not a valid type),
          // fall through and return undefined
        }
      }

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

      // Support type-style membership checks, e.g. NotElement(x, real).
      const typeName = sym(collection);
      if (typeName) {
        const type = ce.type(typeName);
        if (!type.isUnknown) {
          const valueType = value.type;
          if (valueType.matches(type)) return ce.False;
          if (typeIntersection(valueType.type, type.type) === 'nothing')
            return ce.True;
        }
      }

      return undefined;
    },
  },

  Subset: {
    complexity: 11200,
    signature: '(lhs:collection, rhs: collection) -> boolean',
    description:
      'Test whether the first collection is a strict subset of the second.',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('Subset', args);
      // Transform List/Tuple with 2 elements to Interval in set context
      return ce._fn('Subset', [
        listToIntervalInSetContext(ce, args[0]),
        listToIntervalInSetContext(ce, args[1]),
      ]);
    },
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
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('SubsetEqual', args);
      // Transform List/Tuple with 2 elements to Interval in set context
      return ce._fn('SubsetEqual', [
        listToIntervalInSetContext(ce, args[0]),
        listToIntervalInSetContext(ce, args[1]),
      ]);
    },
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
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('Superset', args);
      // Transform List/Tuple with 2 elements to Interval in set context
      return ce._fn('Superset', [
        listToIntervalInSetContext(ce, args[0]),
        listToIntervalInSetContext(ce, args[1]),
      ]);
    },
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
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('SupersetEqual', args);
      // Transform List/Tuple with 2 elements to Interval in set context
      return ce._fn('SupersetEqual', [
        listToIntervalInSetContext(ce, args[0]),
        listToIntervalInSetContext(ce, args[1]),
      ]);
    },
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
        if (!isFunction(expr)) return false;
        const [col, ...others] = expr.ops;
        return (
          (col.contains(x) ?? false) && others.every((set) => !set.contains(x))
        );
      },
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        return countMatchingElements(expr, (elem) =>
          expr.ops.slice(1).every((set) => !set.contains(elem))
        );
      },

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
      // Transform List/Tuple with 2 elements to Interval in set context
      const transformedArgs = args.map((arg) =>
        listToIntervalInSetContext(ce, arg)
      );
      const validatedArgs =
        validateArguments(
          ce,
          flatten(transformedArgs, 'Intersection'),
          parseType('(set+) -> set')
        ) ?? transformedArgs;
      return ce._fn('Intersection', validatedArgs);
    },
    evaluate: intersection,
    collection: {
      contains: containsAll,
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        return countMatchingElements(expr, (elem) =>
          expr.ops.slice(1).every((op) => op.contains(elem))
        );
      },
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
      // Transform List/Tuple with 2 elements to Interval in set context
      const transformedArgs = args.map((arg) =>
        listToIntervalInSetContext(ce, arg)
      );
      const validatedArgs =
        validateArguments(
          ce,
          flatten(transformedArgs, 'Union'),
          parseType('(collection+) -> set')
        ) ?? transformedArgs;
      // Even if there is only one argument, we still need to call Union
      // to canonicalize the argument, since it may not be a set (it could
      // be a collection)
      return ce._fn('Union', validatedArgs);
    },
    evaluate: union,

    // These handlers will get called if we have a lazy collection,
    // that is a union of collections with more than MAX_SIZE_EAGER_COLLECTION
    // elements. Otherwise, when we evaluated the union, we got a set literal.
    collection: {
      contains: (col, x) =>
        isFunction(col) && col.ops.some((op) => op.contains(x)),
      count: (col) =>
        countMatchingUnion(col, (elem, seen) =>
          seen.every((e) => !e.contains(elem))
        ),
      isEmpty: (col) =>
        isFunction(col) && col.ops.every((op) => op.isEmptyCollection),
      isFinite: (col) =>
        isFunction(col) && col.ops.every((op) => op.isFiniteCollection),
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
        if (!isFunction(expr)) return false;
        const [col, ...values] = expr.ops;
        return (
          (col.contains(x) ?? false) && !values.some((val) => val.isSame(x))
        );
      },
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        return countMatchingElements(expr, (elem) => {
          const [_col, ...values] = expr.ops;
          return !values.some((val) => val.isSame(elem));
        });
      },
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
        if (!isFunction(expr)) return false;
        const [a, b] = expr.ops;
        const inA = a.contains(x) ?? false;
        const inB = b.contains(x) ?? false;
        return (inA && !inB) || (!inA && inB);
      },
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        return countMatchingElements(expr, (elem) => {
          const [a, b] = expr.ops;
          const inA = a.contains(elem) ?? false;
          const inB = b.contains(elem) ?? false;
          return (inA && !inB) || (!inA && inB);
        });
      },
      iterator: symmetricDifferenceIterator,
    },
  },
};

function subset(lhs: Expression, rhs: Expression, strict = true): boolean {
  if (!lhs.isCollection || !rhs.isCollection) return false;
  if (lhs.baseDefinition?.collection?.subsetOf?.(lhs, rhs, strict)) return true;
  return false;
}

function union(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // ops should be collections. If there are scalars, convert them to singleton sets
  const xs = ops.map((op) => (op.isCollection ? op : ce.function('Set', [op])));

  const totalSize = xs.reduce((acc, op) => acc + (op.count ?? 0), 0);
  if (totalSize > MAX_SIZE_EAGER_COLLECTION) return ce._fn('Union', xs);

  // Keep only unique elements
  const elements: Expression[] = [];
  for (const op of xs) {
    for (const elem of op.each()) {
      if (elements.every((e) => !e.isSame(elem))) elements.push(elem);
    }
  }

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

function intersection(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression {
  // @fixme: need to account for eager/lazy collections. See Union
  const firstOps = isFunction(ops[0]) ? ops[0].ops : [];
  let elements: Expression[] = [...firstOps];

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
  _ops: Expression[],
  { engine: ce }: { engine: ComputeEngine }
): Expression {
  return ce.symbol('EmptySet');
}

function imaginaryIterator(
  self: Expression
): Iterator<Expression, undefined, any> {
  const iterator = cantorEnumerateRationals();
  return {
    next: (): IteratorResult<Expression, undefined> => {
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
  self: Expression
): Iterator<Expression, undefined, any> {
  const iterator = cantorEnumerateComplexNumbers();
  return {
    next: (): IteratorResult<Expression, undefined> => {
      const { value, done } = iterator.next();
      if (done) return { value: undefined, done: true };
      const [re, im] = value;
      return { value: self.engine.number({ re, im }), done: false };
    },
  };
}

function* rationalIterator(
  self: Expression,
  options?: { sign?: '+' | '-' | '+-'; includeZero?: boolean }
): Generator<Expression> {
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

function* integerIterator(self: Expression): Generator<Expression> {
  for (const n of cantorEnumerateIntegers()) yield self.engine.number(n);
}

function* integerRangeIterator(
  ce: ComputeEngine,
  start: number,
  step: number
): Generator<Expression> {
  let n = start;
  while (true) {
    yield ce.number(n);
    n += step;
  }
}

function* unionIterator(
  col: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(col)) return;
  const seen: Expression[] = [];
  for (const op of col.ops) {
    for (const elem of op.each()) {
      if (seen.every((e) => !e.contains(elem))) {
        yield elem;
      }
    }
    seen.push(op);
  }
}

function* setMinusIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const [col, ...values] = expr.ops;
  for (const elem of col.each()) {
    if (!values.some((val) => val.isSame(elem))) {
      yield elem;
    }
  }
}
function* complementIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const [col, ...others] = expr.ops;
  for (const elem of col.each()) {
    if (others.every((set) => !set.contains(elem))) {
      yield elem;
    }
  }
}

function* intersectionIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  for (const elem of expr.ops[0].each()) {
    if (expr.ops.slice(1).every((op) => op.contains(elem))) {
      yield elem;
    }
  }
}
function* symmetricDifferenceIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const [a, b] = expr.ops;
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
  expr: Expression,
  filter: (elem: Expression) => boolean
): number {
  if (!isFunction(expr)) return 0;
  if (expr.ops.some((op) => op.count === Infinity)) return Infinity;
  let count = 0;
  for (const elem of expr.ops[0].each()) {
    if (filter(elem)) count += 1;
  }
  return count;
}

function countMatchingUnion(
  expr: Expression,
  isUnique: (elem: Expression, seen: Expression[]) => boolean
): number {
  if (!isFunction(expr)) return 0;
  if (expr.ops.some((op) => op.count === Infinity)) return Infinity;
  const seen: Expression[] = [];
  let count = 0;
  for (const op of expr.ops) {
    for (const elem of op.each()) {
      if (isUnique(elem, seen)) count += 1;
    }
    seen.push(op);
  }
  return count;
}

function containsAll(expr: Expression, x: Expression): boolean {
  if (!isFunction(expr)) return false;
  return expr.ops.every((op) => op.contains(x) ?? false);
}
