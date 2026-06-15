// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { Complex } from 'complex-esm';
import { BoxedType } from '../../common/type/boxed-type';
import { parseType } from '../../common/type/parse';
import { reduceType } from '../../common/type/reduce';
import type { Type } from '../../common/type/types';
import { flatten } from '../boxed-expression/flatten';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards';
import { validateArguments } from '../boxed-expression/validate';
import {
  getFactIndex,
  hasAssumptions,
  subjectKey,
  subjectOf,
} from '../boxed-expression/constraint-subject';
import { domainToType } from '../boxed-expression/utils';
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
 * Three-valued type membership test used by the `contains` handlers of the
 * mathematical number sets.
 *
 * - `true`: `x` is definitely of type `t` (its type is a subtype of `t`).
 * - `false`: `x` is definitely *not* of type `t` — either its type is disjoint
 *   from `t`, or it is a concrete number literal whose exact value (reflected
 *   in its narrow type) does not match.
 * - `undefined`: membership is indeterminate — e.g. `x` is a symbol of unknown
 *   or broader type that could, but need not, be of type `t`.
 *
 * Returning `undefined` (rather than a spurious `false`) is what allows
 * `Element(x, Integers)` and similar to stay unevaluated for symbols of
 * indeterminate type, instead of collapsing to `False`.
 *
 * The `false` refutation relies on the type lattice computing a correct
 * *meet* for intersections: overlapping numeric primitives intersect to
 * their greatest lower bound (e.g. `integer ∩ finite_real` =
 * `finite_integer`), so `'nothing'` genuinely means "disjoint types"
 * (REVIEW.md G15; see `meetPrimitiveTypes` in `common/type/subtype.ts`).
 * This is what makes the precise per-set types used by the `contains`
 * handlers below (e.g. `finite_complex`, `imaginary`) sound: a symbol
 * declared `finite_real` is *not* refuted as an integer.
 */
export function typeMembership(x: Expression, t: Type): boolean | undefined {
  const vt = x.type;
  if (vt.matches(t)) return true;
  if (typeIntersection(vt.type, t) === 'nothing') return false;
  // The static type overlaps `t` but does not entail it. A concrete number
  // literal has an exact value, so a non-match is definitive; a symbol of
  // indeterminate type is unknown.
  if (isNumber(x)) return false;
  return undefined;
}

/**
 * Three-valued membership for a set defined by a base type together with a
 * sign predicate (e.g. the negative reals). `sign` is the relevant three-valued
 * sign property of `x` (e.g. `x.isNegative`).
 */
function signedMembership(
  x: Expression,
  baseType: Type,
  sign: boolean | undefined
): boolean | undefined {
  const inBase = typeMembership(x, baseType);
  if (inBase === false) return false; // wrong type → definitely not a member
  if (sign === false) return false; // wrong sign → definitely not a member
  if (sign === true) return inBase; // right sign; membership tracks the type
  return undefined; // sign indeterminate
}

/**
 * Kleene three-valued OR: `true` as soon as any value is `true`, `false`
 * only when every value is `false`, `undefined` otherwise.
 *
 * Used by the `contains` handlers of compound sets (e.g. `Union`) so that an
 * indeterminate member test does not collapse to a definitive `false`
 * (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.2 invariant).
 */
function kleeneOr(values: Iterable<boolean | undefined>): boolean | undefined {
  let indeterminate = false;
  for (const v of values) {
    if (v === true) return true;
    if (v === undefined) indeterminate = true;
  }
  return indeterminate ? undefined : false;
}

/**
 * Kleene three-valued AND: `false` as soon as any value is `false`, `true`
 * only when every value is `true`, `undefined` otherwise.
 */
function kleeneAnd(values: Iterable<boolean | undefined>): boolean | undefined {
  let indeterminate = false;
  for (const v of values) {
    if (v === false) return false;
    if (v === undefined) indeterminate = true;
  }
  return indeterminate ? undefined : true;
}

/** Kleene three-valued NOT. */
function kleeneNot(v: boolean | undefined): boolean | undefined {
  return v === undefined ? undefined : !v;
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
    eq: (b: Expression) => b.type.matches('set') && b.isEmptyCollection,
    collection: {
      iterator: () => ({
        next: () => ({ value: undefined, done: true }),
      }),
      count: () => 0,
      isEmpty: () => true,
      isFinite: () => true,
      contains: () => false,
      // `other` ⊆ EmptySet iff `other` is itself empty. A strict subset is
      // impossible (EmptySet has no elements to spare).
      subsetOf: (_, other, strict) =>
        !strict && other.isEmptyCollection === true,
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

      contains: (_, x) => typeMembership(x, 'number'),
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
      contains: (_, x) => typeMembership(x, 'finite_complex'),
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
      contains: (_, x) => typeMembership(x, 'complex'),
      subsetOf: (_, rhs, strict) => {
        if (rhs.operator === 'Range' || rhs.operator === 'Linspace')
          return true;
        return (
          rhs.type.matches(BoxedType.setComplex) &&
          (!strict || sym(rhs) !== 'ExtendedComplexNumbers')
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
      contains: (_, x) => typeMembership(x, 'imaginary'),
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
      contains: (_, x) => typeMembership(x, 'finite_real'),
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
      contains: (_, x) => typeMembership(x, 'real'),
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
      contains: (_, x) => typeMembership(x, 'finite_integer'),
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
      contains: (_, x) => typeMembership(x, 'integer'),
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
      contains: (_, x) => typeMembership(x, 'finite_rational'),
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
      contains: (_, x) => typeMembership(x, 'rational'),
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
      contains: (_, x) => signedMembership(x, 'real', x.isNegative),
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
      contains: (_, x) => signedMembership(x, 'real', x.isNonPositive),
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
      contains: (_, x) => signedMembership(x, 'real', x.isNonNegative),
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
      contains: (_, x) => signedMembership(x, 'real', x.isPositive),
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
      contains: (_, x) => signedMembership(x, 'integer', x.isNegative),
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
      contains: (_, x) => signedMembership(x, 'integer', x.isNonPositive),
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
      contains: (_, x) => signedMembership(x, 'integer', x.isNonNegative),
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
      contains: (_, x) => signedMembership(x, 'integer', x.isPositive),
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
      if (!collection) return undefined;
      const result = membershipKleene(ce, value, collection);
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
      if (!collection) return undefined;
      const result = membershipKleene(ce, value, collection);
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
      // Three-valued: `x ∈ col ∧ x ∉ s1 ∧ x ∉ s2 ∧ …` with Kleene
      // combination — indeterminate member tests yield `undefined`, not a
      // spurious definitive answer.
      contains: (expr, x) => {
        if (!isFunction(expr)) return undefined;
        const [col, ...others] = expr.ops;
        return kleeneAnd([
          col.contains(x),
          ...others.map((set) => kleeneNot(set.contains(x))),
        ]);
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
      // Kleene OR over the members: any `true` → `true`, all `false` →
      // `false`, otherwise `undefined` (an indeterminate member test must
      // not collapse to a definitive `false`).
      contains: (col, x) =>
        isFunction(col)
          ? kleeneOr(col.ops.map((op) => op.contains(x)))
          : undefined,
      count: (col) =>
        countMatchingUnion(col, (elem, seen) =>
          seen.every((e) => !e.contains(elem))
        ),
      // A union is empty iff every operand is empty (Kleene AND).
      isEmpty: (col) =>
        isFunction(col)
          ? kleeneAnd(col.ops.map((op) => op.isEmptyCollection))
          : undefined,
      // A union is finite iff every operand is finite (Kleene AND).
      isFinite: (col) =>
        isFunction(col)
          ? kleeneAnd(col.ops.map((op) => op.isFiniteCollection))
          : undefined,
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
      // Three-valued: `x ∈ col ∧ ¬excluded(v1, x) ∧ …` with Kleene
      // combination (mirrors the `membershipKleene` SetMinus decomposition).
      contains: (expr, x) => {
        if (!isFunction(expr)) return undefined;
        const [col, ...values] = expr.ops;
        return kleeneAnd([
          col.contains(x),
          ...values.map((val) =>
            kleeneNot(isExcludedByKleene(expr.engine, val, x))
          ),
        ]);
      },
      count: (expr) => {
        if (!isFunction(expr)) return 0;
        return countMatchingElements(expr, (elem) => {
          const [_col, ...values] = expr.ops;
          return !values.some((val) => isExcludedBy(val, elem));
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
      // Three-valued XOR: decided only when both member tests are decided.
      contains: (expr, x) => {
        if (!isFunction(expr)) return undefined;
        const [a, b] = expr.ops;
        const inA = a.contains(x);
        const inB = b.contains(x);
        if (inA === undefined || inB === undefined) return undefined;
        return inA !== inB;
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
  // The empty set is a subset of every set (strictly so unless `rhs` is also
  // empty). Handle it here since its generic `set` type defeats the
  // type-based per-set handlers below.
  if (lhs.isEmptyCollection === true)
    return !strict || rhs.isEmptyCollection !== true;
  // The `subsetOf(collection, other, strict)` handler tests whether every
  // element of `other` is in `collection` (i.e. `other` ⊆ `collection`).
  // To test `lhs` ⊆ `rhs`, dispatch on the candidate *superset* `rhs`,
  // passing `lhs` as the candidate subset.
  if (rhs.baseDefinition?.collection?.subsetOf?.(rhs, lhs, strict)) return true;
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

/** A trailing SetMinus operand excludes its *members* when it is itself a
 * set/collection, and excludes itself as a value otherwise. */
function isExcludedBy(val: Expression, x: Expression): boolean {
  if (val.isCollection) return val.contains(x) === true;
  return val.isSame(x);
}

/**
 * Three-valued version of `isExcludedBy` for the `SetMinus.contains`
 * handler: `true` when `x` is definitely excluded by the operand, `false`
 * when definitely not, `undefined` when indeterminate.
 */
function isExcludedByKleene(
  ce: ComputeEngine,
  val: Expression,
  x: Expression
): boolean | undefined {
  if (val.isCollection) return val.contains(x);
  // Scalar exclusion: `x` is excluded iff `x = val`
  return kleeneNot(notEqualKleene(ce, x, val));
}

/**
 * Three-valued disequality `x ≠ e`, used by the `SetMinus` query
 * decomposition (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1c/§5.1d).
 *
 * - `false` when `x` is (structurally or as a concrete number) equal to `e`;
 * - `true` when concrete numbers differ, or when a `NotEqual(x, e)` fact is
 *   stored in the assumptions DB (read directly from the fact index, so it
 *   works inside `verify()`);
 * - `undefined` otherwise (never a definitive answer for an unconstrained
 *   symbol — design §5.2 invariant).
 */
function notEqualKleene(
  ce: ComputeEngine,
  x: Expression,
  e: Expression
): boolean | undefined {
  if (x.isSame(e)) return false;

  // Concrete numbers decide definitively
  if (isNumber(x) && isNumber(e)) {
    const r = x.isEqual(e);
    if (r !== undefined) return !r;
    return undefined;
  }

  // Stored disequality facts for the subject (bare symbol or part term)
  if (hasAssumptions(ce)) {
    const subject = subjectOf(x);
    if (subject !== undefined) {
      const facts = getFactIndex(ce).bySubject.get(subjectKey(subject));
      if (facts?.notEqual.some((v) => v.isSame(e))) return true;
    }
  }

  return undefined;
}

/**
 * Three-valued bound conjunct for the query-side Range/Interval
 * decomposition (`membershipKleene` step 2b), mirroring `assumeBound`
 * (assume.ts):
 *
 * - finite numeric bound → the corresponding three-valued comparison
 *   (which consults stored bound facts);
 * - infinite bound on its natural side (lower −∞ / upper +∞) → vacuously
 *   satisfied, exactly as the assume side skips it;
 * - infinite bound on the wrong side, or a symbolic bound → indeterminate
 *   (the assume side stores no fact that could entail it).
 */
function boundKleene(
  x: Expression,
  op: 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual',
  bound: Expression
): boolean | undefined {
  const b = bound.re;
  // Symbolic bound (e.g. Range(1, q − 1)): indeterminate
  if (Number.isNaN(b)) return undefined;
  if (!isFinite(b)) {
    // Lower bound of −∞ / upper bound of +∞: vacuously satisfied
    if (b === -Infinity && (op === 'Greater' || op === 'GreaterEqual'))
      return true;
    if (b === Infinity && (op === 'Less' || op === 'LessEqual')) return true;
    // Degenerate direction (e.g. x ≥ +∞): cannot be decided here
    return undefined;
  }
  if (op === 'Less') return x.isLess(b);
  if (op === 'LessEqual') return x.isLessEqual(b);
  if (op === 'Greater') return x.isGreater(b);
  return x.isGreaterEqual(b);
}

/**
 * Three-valued set membership `x ∈ collection`, shared by the
 * `Element`/`NotElement` evaluate handlers (design §5.1c).
 *
 * In order:
 * 1. `SetMinus` queries are decomposed exactly like `SetMinus` assumptions —
 *    `x ∈ SetMinus(S, T)` ⇔ `x ∈ S ∧ x ∉ T` with Kleene combination — instead
 *    of using the generic `contains` handler, which collapses an unknown
 *    base membership to a definitive `false` for symbolic elements.
 * 2. The collection's `contains` handler (concrete membership, unchanged).
 * 3. Type-style membership for type names (e.g. `Element(x, finite_real)`).
 * 4. Primitive number-set symbols mapped to types via `domainToType` — the
 *    query-side mirror of the assume-side type refinement, so
 *    `Element(z, ComplexNumbers)` verifies after the same assumption.
 * 5. Stored membership/exclusion facts, matched exactly (`isSame`).
 *
 * Returns `undefined` when membership is indeterminate (design §5.2).
 */
function membershipKleene(
  ce: ComputeEngine,
  x: Expression,
  collection: Expression,
  depth = 0
): boolean | undefined {
  if (depth > 4) return undefined;

  // 1. SetMinus query decomposition (signature is `(set, value*)`: trailing
  //    operands exclude their members when they are collections, themselves
  //    otherwise — mirroring `isExcludedBy`)
  if (isFunction(collection, 'SetMinus') && collection.nops >= 1) {
    const [base, ...excluded] = collection.ops;
    let result = membershipKleene(ce, x, base, depth + 1);
    if (result === false) return false;
    for (const val of excluded) {
      let conjunct: boolean | undefined;
      if (isFunction(val, 'Set')) {
        // Finite exclusion set: a disequality conjunct per element
        conjunct = true;
        for (const e of val.ops) {
          const ne = notEqualKleene(ce, x, e);
          if (ne === false) return false;
          if (ne === undefined) conjunct = undefined;
        }
      } else if (val.isCollection) {
        // Non-finite exclusion: `x ∉ val`
        const m = membershipKleene(ce, x, val, depth + 1);
        conjunct = m === undefined ? undefined : !m;
      } else {
        conjunct = notEqualKleene(ce, x, val);
      }
      if (conjunct === false) return false;
      if (conjunct === undefined) result = undefined;
    }
    return result;
  }

  // 2. The collection's `contains` handler
  if (typeof collection.contains === 'function') {
    const result = collection.contains(x);
    if (result === true) return true;
    if (result === false) return false;
  }

  // 2b. Range/Interval queries with a symbolic element: mirror the
  // assume-side decomposition (`assumeElementOfSet` cases 2 & 3, design
  // §3.2/§5.1c) — a type conjunct plus one bound conjunct per finite
  // numeric endpoint, with infinite endpoints skipped exactly as
  // `assumeBound` skips them. Facts stored decomposed thus answer queries
  // decomposed. Symbolic endpoints yield an indeterminate conjunct (the
  // assume side drops them, so no stored fact can entail the bound).
  if (isFunction(collection, 'Range') && collection.nops >= 2) {
    let [lo, hi] = collection.ops;
    const step = collection.ops[2];
    if (step !== undefined && step.isSame(-1)) [lo, hi] = [hi, lo];
    // Non-unit steps do not decompose (assume keeps only the type there)
    if (step === undefined || step.isSame(1) || step.isSame(-1)) {
      const r = kleeneAnd([
        x.type.matches('integer') ? true : undefined,
        boundKleene(x, 'GreaterEqual', lo),
        boundKleene(x, 'LessEqual', hi),
      ]);
      if (r !== undefined) return r;
    }
  }

  if (isFunction(collection, 'Interval') && collection.nops === 2) {
    let [lo, hi] = collection.ops;
    let loStrict = false;
    let hiStrict = false;
    if (isFunction(lo, 'Open')) {
      loStrict = true;
      lo = lo.op1;
    }
    if (isFunction(hi, 'Open')) {
      hiStrict = true;
      hi = hi.op1;
    }
    const r = kleeneAnd([
      x.type.matches('real') ? true : undefined,
      boundKleene(x, loStrict ? 'Greater' : 'GreaterEqual', lo),
      boundKleene(x, hiStrict ? 'Less' : 'LessEqual', hi),
    ]);
    if (r !== undefined) return r;
  }

  const typeName = sym(collection);
  if (typeName) {
    // 3. Type-style membership, e.g. Element(x, finite_real)
    try {
      const type = ce.type(typeName);
      if (!type.isUnknown) {
        // Three-valued: in particular, a concrete number literal whose type
        // overlaps but does not match is definitively excluded (e.g.
        // `Element(2.5, integer)` → False, even though
        // `finite_rational ∩ integer` is non-empty), while a symbol of
        // overlapping type stays indeterminate (falls through).
        const r = typeMembership(x, type.type);
        if (r !== undefined) return r;
      }
    } catch {
      // If type parsing fails (e.g., "Booleans" is not a valid type),
      // fall through
    }

    // 4. Primitive number-set symbols map to types (query-side mirror of
    //    the assume-side refinement)
    const domType = domainToType(collection);
    if (domType !== 'unknown') {
      const r = typeMembership(x, domType);
      if (r !== undefined) return r;
    }
  }

  // 5. Stored membership/exclusion facts, matched exactly (design §5.1c)
  if (hasAssumptions(ce)) {
    const xSymbol = sym(x);
    if (xSymbol) {
      const facts = getFactIndex(ce).membership.get(xSymbol);
      if (facts) {
        if (facts.in.some((s) => s.isSame(collection))) return true;
        if (facts.notIn.some((s) => s.isSame(collection))) return false;
      }
    } else {
      // Compound subject (e.g. `NotElement(1 + ℓ + iη, NonPositiveIntegers)`
      // guards): the fact index is keyed by bare symbols, so match stored
      // Element/NotElement facts verbatim against the assumptions DB.
      // `x` reaches this point evaluated, while stored facts are canonical
      // but unevaluated — also compare the evaluated fact subject (cheap:
      // only for facts whose set already matches).
      for (const [fact, truth] of ce.context.assumptions) {
        if (truth !== true || !isFunction(fact)) continue;
        if (fact.operator !== 'Element' && fact.operator !== 'NotElement')
          continue;
        if (fact.nops !== 2) continue;
        if (!fact.op2.isSame(collection)) continue;
        if (!fact.op1.isSame(x) && !fact.op1.evaluate().isSame(x)) continue;
        return fact.operator === 'Element';
      }
    }
  }

  return undefined;
}

function setMinus(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // Compute the difference only when the source collection is finite and
  // enumerable; otherwise stay symbolic — the `contains`/iterator handlers
  // provide the semantics for infinite sets (e.g. SetMinus(ComplexNumbers, {0})).
  const [col, ...values] = ops;
  if (!col || col.isFiniteCollection !== true) return undefined;

  const elements = [...col.each()].filter(
    (element) => !values.some((val) => isExcludedBy(val, element))
  );

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
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
        value: self.engine.number(new Complex(0, n / d)),
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
      return {
        value: self.engine.number(new Complex(re, im)),
        done: false,
      };
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
    if (!values.some((val) => isExcludedBy(val, elem))) {
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

/**
 * Three-valued `contains` for `Intersection`: Kleene AND over the member
 * tests — `false` as soon as one operand definitively excludes `x`, `true`
 * only when every operand definitively contains it, `undefined` otherwise.
 */
function containsAll(expr: Expression, x: Expression): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  return kleeneAnd(expr.ops.map((op) => op.contains(x)));
}
