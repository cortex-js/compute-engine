// Set operations:
// https://query.wikidata.org/#PREFIX%20wd%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fentity%2F%3E%0APREFIX%20wdt%3A%20%3Chttp%3A%2F%2Fwww.wikidata.org%2Fprop%2Fdirect%2F%3E%0A%0ASELECT%20DISTINCT%20%3Fitem%0AWHERE%20%7B%0A%20%20%20%20%3Fitem%20wdt%3AP31%2a%20wd%3AQ1964995%0A%7D%0A

import { Complex } from 'complex-esm';
import { kleeneAnd, kleeneNot, kleeneOr } from '../../common/kleene.js';
import { parseType } from '../../common/type/parse.js';
import { reduceType, typesOverlap } from '../../common/type/reduce.js';
import { isEmptyType } from '../../common/type/subtype.js';
import { collectionElementType } from '../../common/type/utils.js';
import { EXTENDED_REAL_TYPE } from '../../common/type/primitive.js';
import type { Type } from '../../common/type/types.js';
import { flatten } from '../boxed-expression/flatten.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import { validateArguments } from '../boxed-expression/validate.js';
import {
  contextAssumptions,
  getFactIndex,
  hasAssumptions,
  isFactTrue,
  subjectKey,
  subjectOf,
} from '../boxed-expression/constraint-subject.js';
import { domainToType } from '../boxed-expression/utils.js';
// The `'types'`-shape twins of the shared type-handler helpers: they take
// one `OperandDescriptor` per operand instead of the operand expression,
// which is what the `typeHandlerKind: 'types'` flag on the two definitions
// below selects.
import { adjoinType, quotientRingType } from './type-handlers-types.js';
import {
  declareTypeSaturatedSet,
  enumerableFromAllSources,
  enumerableFromSource,
  typeSaturatedSubsetOf,
  isTextAtom,
  isValuelessCollectionTyped,
  MAX_SIZE_EAGER_COLLECTION,
} from '../collection-utils.js';
import type {
  Expression,
  Sign,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  cantorEnumerateComplexNumbers,
  cantorEnumerateIntegers,
  cantorEnumeratePositiveRationals,
  cantorEnumerateRationals,
} from '../numerics/numeric.js';

function typeIntersection(a: Type, b: Type): Type {
  return reduceType({ kind: 'intersection', types: [a, b] });
}

// The element types of the `Extended*` number sets.
//
// Every bare numeric name is FINITE, so a set that contains the infinities has
// to name them. This is the one place in the engine where an infinity is a
// MEMBER rather than a marker of unbounded extent: "extended" is exactly the
// claim that the two points at infinity have been added to the line. (A span
// constructor such as `Interval(0, +oo)` reads its infinite endpoint as extent
// and excludes it.)
//
// The two SIGNED infinities only: the extended real line is the two-point
// compactification, so the unsigned `~oo` of the Riemann sphere is not a
// member of any of these three. The extended COMPLEX plane is the one that
// takes it, and it takes every infinite magnitude with it.
//
// The infinities are named by the TYPE `non_finite_number` — the signed pair
// {+∞, −∞} — and not by the two value types `+oo | -oo`. A value type only
// admits that one value, so an operand whose type is `non_finite_number`
// itself (`Ln(0)`, or a symbol declared `non_finite_number`) is not a subtype
// of `real | +oo | -oo` and its membership would stay undecided.
// `non_finite_number` excludes both `~oo` and NaN, so the two-point claim
// above is unaffected.
const EXTENDED_RATIONAL_TYPE = parseType('rational | non_finite_number');
const EXTENDED_INTEGER_TYPE = parseType('integer | non_finite_number');
const EXTENDED_COMPLEX_TYPE = parseType('complex | infinity');

/**
 * Build the `subsetOf` handler of a number set that contains EVERY value of
 * `elementType` whose sign satisfies `sign` — `Integers` is every value of
 * type `integer` with no sign constraint, `PositiveNumbers` every
 * `real` whose sign is `positive`, and so on.
 *
 * Two such sets are compared by their descriptions alone, with no
 * enumeration. Recording the description with `declareTypeSaturatedSet()` also
 * lets any OTHER collection — a `Range`, a `Set` literal, an `Interval` —
 * decide its own inclusion in this set from its element type and sign, again
 * without enumerating: see `collectionSubset()` in `collection-utils.ts`.
 *
 * `elementType` and `sign` must agree with the set's own `elttype`/`eltsgn`
 * handlers, which report the same two facts to the rest of the engine.
 */
function numberSetSubsetOf(
  name: string,
  elementType: Type,
  sign?: Sign
): (
  collection: Expression,
  other: Expression,
  strict: boolean
) => boolean | undefined {
  return typeSaturatedSubsetOf(
    declareTypeSaturatedSet(name, { elementType, sign })
  );
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
 * their greatest lower bound (e.g. `integer ∩ real` =
 * `integer`), so an EMPTY meet genuinely means "disjoint types"
 * (`isEmptyType`, `common/type/subtype.ts`) — the empty type is `never`, not
 * `nothing`, which is the unit type inhabited by the symbol `Nothing`
 * (REVIEW.md G15; see `meetPrimitiveTypes` in `common/type/subtype.ts`).
 * This is what makes the precise per-set types used by the `contains`
 * handlers below (e.g. `complex`, `imaginary`) sound: a symbol
 * declared `real` is *not* refuted as an integer.
 */
export function typeMembership(x: Expression, t: Type): boolean | undefined {
  const vt = x.type;
  if (vt.matches(t)) return true;
  if (isEmptyType(typeIntersection(vt.type, t))) return false;
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

// The `contains` handlers of compound sets (e.g. `Union`) combine their
// sub-queries with the three-valued connectives of `common/kleene.ts`, so that
// an indeterminate member test does not collapse to a definitive `false`
// (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.2 invariant).

// Note: the interval reading of ambiguous bracket pairs (`x \in [1, 5]`,
// `(-\infty, 0) \cup (0, \infty)`) happens at the LaTeX boundary
// (`parsedIntervalOperand` in `latex-syntax/dictionary/definitions-sets.ts`).
// A directly-constructed MathJSON `["List", a, b]` or `["Tuple", a, b]` is a
// two-element collection, never an interval, so set operations here apply
// plain collection semantics to it.

/** A literal-only membership claim: a number or string literal tested
 * against a `List`/`Set` literal whose elements are all number or string
 * literals decides `Element` at the type level (boolean value types,
 * `docs/plans/2026-08-29-boolean-value-types.md` §3.1). A member that is
 * the SAME value (`isSame`) proves `true` for both kinds. A `false` proof
 * must match the evaluated `Element`: a `List` holds by `isSame` only, but
 * a `Set` also admits a number within `engine.tolerance` of a member
 * (`literalSetContains`, `library/collections.ts`), so a number tested
 * against a `Set` with a number member closer than the tolerance keeps
 * `boolean`. Any other operand shape (a symbol, a range, a type-style
 * membership, a filtered three-operand form) keeps the declared `boolean`. */
function elementLiteralType(ops: ReadonlyArray<Expression>): Type {
  if (ops.length !== 2) return 'boolean';
  const [value, collection] = ops;
  const isLiteral = (x: Expression): boolean => isNumber(x) || isString(x);
  if (!isLiteral(value)) return 'boolean';
  const isSet = isFunction(collection, 'Set');
  if (!isSet && !isFunction(collection, 'List')) return 'boolean';
  if (!collection.ops.every(isLiteral)) return 'boolean';
  if (collection.ops.some((x) => x.isSame(value)))
    return { kind: 'value', value: true };
  if (isSet && isNumber(value)) {
    const v = value.re;
    const tol = value.engine.tolerance;
    const near = collection.ops.some(
      (x) => isNumber(x) && Math.abs(x.re - v) <= tol
    );
    if (near) return 'boolean';
  }
  return { kind: 'value', value: false };
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
    eq: (b: Expression) => b.type.matches('set<any>') && b.isEmptyCollection,
    collection: {
      iterator: () => ({
        next: () => ({ value: undefined, done: true }),
      }),
      count: () => 0,
      isEmpty: () => true,
      isFinite: () => true,
      contains: () => false,
      // The empty set is a subset of every collection; it is a STRICT subset
      // of every collection that has an element to spare. (Per the handler
      // contract the receiver is the candidate subset — see
      // `types-definitions.ts`.)
      subsetOf: (_, other, strict) => {
        if (!strict) return true;
        if (other.isEmptyCollection === undefined) return undefined;
        return !other.isEmptyCollection;
      },
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
      subsetOf: numberSetSubsetOf('Numbers', 'number'),
      // Elements include the reals, so no sign claim ('unsigned' would
      // assert a definite imaginary part or NaN).
      eltsgn: () => undefined,
      elttype: () => 'number',
    },
  },

  ComplexNumbers: {
    type: 'set<complex>',
    isConstant: true,
    description: 'The set of all finite complex numbers.',
    collection: {
      iterator: complexIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => typeMembership(x, 'complex'),
      subsetOf: numberSetSubsetOf('ComplexNumbers', 'complex'),
      // real ⊂ complex: elements include the reals, so no sign claim.
      eltsgn: () => undefined,
      elttype: () => 'complex',
    },
  },

  ExtendedComplexNumbers: {
    type: 'set<complex | infinity>',
    isConstant: true,
    description: 'The set of all complex numbers, including infinities.',
    collection: {
      iterator: complexIterator,
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => typeMembership(x, EXTENDED_COMPLEX_TYPE),
      subsetOf: numberSetSubsetOf(
        'ExtendedComplexNumbers',
        EXTENDED_COMPLEX_TYPE
      ),
      // real ⊂ complex: elements include the reals, so no sign claim.
      eltsgn: () => undefined,
      elttype: () => EXTENDED_COMPLEX_TYPE,
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
      subsetOf: numberSetSubsetOf('ImaginaryNumbers', 'imaginary', 'unsigned'),
      eltsgn: () => 'unsigned',
      elttype: () => 'imaginary',
    },
  },

  RealNumbers: {
    type: 'set<real>',
    isConstant: true,
    description: 'The set of all finite real numbers.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => typeMembership(x, 'real'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: numberSetSubsetOf('RealNumbers', 'real'),
      eltsgn: () => undefined,
      elttype: () => 'real',
    },
  },

  ExtendedRealNumbers: {
    type: 'set<real | non_finite_number>',
    isConstant: true,
    description: 'The set of all real numbers, including infinities.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => typeMembership(x, EXTENDED_REAL_TYPE),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: numberSetSubsetOf('ExtendedRealNumbers', EXTENDED_REAL_TYPE),
      eltsgn: () => undefined,
      elttype: () => EXTENDED_REAL_TYPE,
    },
  },

  Integers: {
    type: 'set<integer>',
    isConstant: true,
    description: 'The set of all finite integers.',
    collection: {
      iterator: integerIterator,
      contains: (_, x) => typeMembership(x, 'integer'),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: numberSetSubsetOf('Integers', 'integer'),
      eltsgn: () => undefined,
      elttype: () => 'integer',
    },
  },

  ExtendedIntegers: {
    type: 'set<integer | non_finite_number>',
    isConstant: true,
    description: 'The set of all integers, including infinities.',
    collection: {
      iterator: integerIterator,
      contains: (_, x) => typeMembership(x, EXTENDED_INTEGER_TYPE),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: numberSetSubsetOf('ExtendedIntegers', EXTENDED_INTEGER_TYPE),
      eltsgn: () => undefined,
      elttype: () => EXTENDED_INTEGER_TYPE,
    },
  },

  RationalNumbers: {
    type: 'set<rational>',
    isConstant: true,
    description: 'The set of all finite rational numbers.',
    collection: {
      iterator: (self) => rationalIterator(self),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      contains: (_, x) => typeMembership(x, 'rational'),
      subsetOf: numberSetSubsetOf('RationalNumbers', 'rational'),
      eltsgn: () => undefined,
      elttype: () => 'rational',
    },
  },

  ExtendedRationalNumbers: {
    type: 'set<rational | non_finite_number>',
    isConstant: true,
    description: 'The set of all rational numbers, including infinities.',
    collection: {
      iterator: (self) => rationalIterator(self),
      contains: (_, x) => typeMembership(x, EXTENDED_RATIONAL_TYPE),
      count: () => Infinity,
      isEmpty: () => false,
      isFinite: () => false,
      subsetOf: numberSetSubsetOf(
        'ExtendedRationalNumbers',
        EXTENDED_RATIONAL_TYPE
      ),
      eltsgn: () => undefined,
      elttype: () => EXTENDED_RATIONAL_TYPE,
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
      subsetOf: numberSetSubsetOf('NegativeNumbers', 'real', 'negative'),

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
      subsetOf: numberSetSubsetOf('NonPositiveNumbers', 'real', 'non-positive'),
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
      subsetOf: numberSetSubsetOf('NonNegativeNumbers', 'real', 'non-negative'),
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
      subsetOf: numberSetSubsetOf('PositiveNumbers', 'real', 'positive'),
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
      subsetOf: numberSetSubsetOf('NegativeIntegers', 'integer', 'negative'),
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
      subsetOf: numberSetSubsetOf(
        'NonPositiveIntegers',
        'integer',
        'non-positive'
      ),
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
      subsetOf: numberSetSubsetOf(
        'NonNegativeIntegers',
        'integer',
        'non-negative'
      ),
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
      subsetOf: numberSetSubsetOf('PositiveIntegers', 'integer', 'positive'),
      eltsgn: () => 'positive',
      elttype: () => 'integer',
    },
  },

  //
  // Predicates
  //
  Element: {
    type: elementLiteralType,
    complexity: 11200,
    keywords: ['element of', 'member'],
    // EL-3: Extended signature to support optional condition for filtered iteration
    // The condition is used by Sum/Product to filter values when iterating
    signature: '(value, collection<any>, boolean?) -> boolean',
    description:
      'Test whether a value is an element of a collection. ' +
      'Optional third argument is a boolean expression (condition) for filtered iteration in Sum/Product.\n\n' +
      'Element supports two modes of operation:\n' +
      '1. Set membership: Element(3, [List, 1, 2, 3]) checks if 3 is in the list\n' +
      '2. Type-style membership: Element(x, integer) checks if x has type integer\n\n' +
      'Type-style membership works with:\n' +
      '- Mathematical sets: Integers, RealNumbers, ComplexNumbers, etc.\n' +
      '- Type names: integer, rational, real, number, positive_integer, etc.\n' +
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
      const canonicalCollection = collection.canonical;

      // `\mathbb{C}^+` sugar: the open upper half-plane is the part predicate
      // Im(value) > 0. Canonicalize membership away so assume()/verify(),
      // literal evaluation, and the modular/theta guards all see the
      // inequality directly. There is no standalone UpperHalfPlane set — it is
      // pure LaTeX input shorthand for the constraint.
      if (sym(canonicalCollection) === 'UpperHalfPlane' && !condition) {
        return ce.function('Greater', [
          ce.function('Imaginary', [value]),
          ce.Zero,
        ]);
      }

      // Validate collection type
      if (
        !canonicalCollection.type.matches('collection<any>') &&
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

      // `c in digits` on a not-yet-typed FUNCTION PARAMETER is element-type
      // evidence, the membership counterpart of the collection evidence
      // `Length(cs)` writes onto its operand (see the `Length` canonical
      // handler): narrow the parameter to the collection's element type.
      // Binding-only — a scalar element type never surfaces on a function
      // literal's arrow (`inferredCollectionParameterType` filters it), so
      // the lambda auto-broadcast default is unaffected.
      //
      // Two deliberate confinements:
      // - PARAMETERS ONLY (the shadowed-parameter stack is populated exactly
      //   while a literal's body canonicalizes). Membership is a PREDICATE —
      //   `x in [1, 2, 3]` on a string-valued `x` is legitimately `False`,
      //   not a type error — so it must not retype a global symbol: a Solve
      //   domain spec (`Element(x, Range(1, 9))`) would otherwise
      //   permanently narrow the unknown it merely constrains.
      // - VALUE collections only (a list, a string's characters, a range) —
      //   membership in a SET (`x ∈ ℤ`, `x ∈ {1,2,3}`) is how an assumption
      //   is spelled, and set refinements belong to the assume machinery,
      //   which applies them SCOPED (P1-6: a refinement in a pushed scope
      //   must not leak).
      const canonicalValue = value.canonical;
      if (
        isSymbol(canonicalValue) &&
        ce._isShadowedParameter(canonicalValue.symbol) &&
        canonicalValue.valueDefinition?.inferredType &&
        canonicalValue.type.type === 'unknown' &&
        !canonicalCollection.type.matches('set<any>')
      ) {
        const elt = collectionElementType(canonicalCollection.type.type);
        if (elt !== undefined && elt !== 'any' && elt !== 'unknown')
          canonicalValue._infer(elt, 'narrow');
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

      // A `Tuple`/`List`/`Sequence` of plain SYMBOLS against a scalar (number)
      // collection is the universal math idiom "a, b ∈ ℤ": distribute the
      // membership over the symbols — `Element((a,b), S)` → `And(Element(a,S),
      // Element(b,S))`. Only when every element is a symbol (a tuple of *values*
      // may legitimately be a product-set membership test) and the collection's
      // element type is a number (not itself a tuple/collection).
      if (
        value !== undefined &&
        (isFunction(value, 'Tuple') ||
          isFunction(value, 'List') ||
          isFunction(value, 'Sequence')) &&
        value.nops >= 1 &&
        value.ops.every((el) => sym(el) !== undefined)
      ) {
        const et = collectionElementType(collection.type.type);
        if (et !== undefined && ce.type(et).matches('number'))
          return ce
            .function(
              'And',
              value.ops.map((el) => ce.function('Element', [el, collection]))
            )
            .evaluate();
      }

      const result = membershipKleene(ce, value, collection);
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotElement: {
    complexity: 11200,
    signature: '(value, collection<any>) -> boolean',
    description: 'Test whether a value is not an element of a collection.',
    canonical: (args, { engine: ce }) => {
      // Same collection leniency as `Element` (which accepts `K_a \in BC`):
      // without this handler, generic signature validation rejects a label
      // collection (`K_a \notin BC`, where `BC` is a geometry line label).
      if (args.length < 2)
        return ce._fn('NotElement', [
          args[0]?.canonical ?? ce.error('missing'),
          ce.error('missing'),
        ]);
      const [value, collection] = args;
      return ce._fn('NotElement', [value.canonical, collection.canonical]);
    },
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
    description:
      'Test whether the first collection is a strict subset of the second.',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('Subset', args);
      return ce._fn('Subset', [args[0].canonical, args[1].canonical]);
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
    description:
      'Test whether the first collection is a subset (possibly equal) of the second.',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('SubsetEqual', args);
      return ce._fn('SubsetEqual', [args[0].canonical, args[1].canonical]);
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
    description:
      'Test whether the first collection is a strict superset of the second.',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('Superset', args);
      return ce._fn('Superset', [args[0].canonical, args[1].canonical]);
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
    description:
      'Test whether the first collection is a superset (possibly equal) of the second.',
    canonical: (args, { engine: ce }) => {
      if (args.length !== 2) return ce._fn('SupersetEqual', args);
      return ce._fn('SupersetEqual', [args[0].canonical, args[1].canonical]);
    },
    evaluate: ([lhs, rhs], { engine: ce }) => {
      // Not strict: "superset, possibly equal" is the mirror of `SubsetEqual`.
      const result = subset(rhs, lhs, false); // reversed
      if (result === true) return ce.True;
      if (result === false) return ce.False;
      return undefined;
    },
  },

  NotSuperset: {
    complexity: 11200,
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
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
    signature: '(lhs:collection<any>, rhs: collection<any>) -> boolean',
    description:
      'Test whether the first collection is not a superset (possibly equal) of the second.',
    evaluate: ([lhs, rhs], { engine: ce }) => {
      // Not strict: the negation of "superset, possibly equal".
      const result = subset(rhs, lhs, false); // reversed
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

  // Note: `Intersection`, `Union`, `SetMinus` and `NotElement` tolerate
  // *label operands* (see `isLabelOperand`) where a set is expected:
  // olympiad geometry uses `P = AC \cap BD` (lines through points) and group
  // theory uses `x \in G \setminus H`, `|H \cap xH|`. Such expressions stay
  // inert instead of flagging `incompatible-type`.

  //
  // Ring constructions (inert, v1)
  //
  // `Adjoin` and `QuotientRing` transcribe the two standard ring-construction
  // notations. They are **inert**: they carry an honest type but have no
  // evaluate behavior — no membership test, no arithmetic in the constructed
  // ring. Staying symbolic IS the exact form here (Evaluate-vs-N contract), so
  // neither declares an `evaluate` handler.
  //
  Adjoin: {
    description: [
      'The ring obtained by adjoining one or more elements to a base ring.',
      '`Adjoin(Integers, Sqrt(2))` is ℤ[√2]; `Adjoin(Integers, ["Complex", 0, 1])` is the Gaussian integers ℤ[i]; `Adjoin(Integers, "x")` is the polynomial ring ℤ[x].',
      'Inert: the adjunction is not expanded, and membership in it is not decided.',
    ],
    // LaTeX: `\mathbb{Z}[\sqrt2]`, `\mathbb{Z}[\sqrt2,\sqrt3]`, `\mathbb{Z}[x]`.
    // Field adjunction written with PARENTHESES — `\mathbb{Q}(\sqrt2)` — is
    // deliberately NOT parsed in v1: bare parentheses after a symbol are
    // multiplication/application everywhere else in the grammar.
    // `any` (not `value`) for the adjuncts: an indeterminate is typically an
    // undeclared free variable, and a narrower parameter type would INFER a
    // declaration for it (`\Z[x]` retyping `x` for the engine's lifetime).
    signature: '(set<any>, any+) -> set',
    typeHandlerKind: 'types',
    type: adjoinType,
  },

  QuotientRing: {
    description: [
      'The quotient of a ring by the ideal generated by the second argument.',
      '`QuotientRing(Integers, n)` is ℤ/nℤ, the integers modulo `n`.',
      'Inert: the residues are not enumerated, and membership is not decided.',
    ],
    // LaTeX: `\mathbb{Z}_n` and `\mathbb{Z}/n\mathbb{Z}` both parse to this;
    // the subscript form is what it serializes back to.
    //
    // NOTE: the engine reads `\mathbb{Z}_p` as ℤ/pℤ (the integers mod p), NOT
    // as the p-adic integers. Both readings are current in the literature; the
    // mod-n reading is the one that dominates the corpus this engine parses,
    // so it is the one claimed. A p-adic ring has no notation in v1.
    //
    // Sign-restricted spellings (`\mathbb{Z}_+`, `\mathbb{R}_-`,
    // `\mathbb{Z}_{\ge0}`, …) are NOT quotients: they are matched by their own,
    // longer LaTeX triggers and resolve to the named sets (`PositiveIntegers`,
    // …) before any subscript parselet runs.
    // `any` for the modulus: see the note on `Adjoin` — a narrower parameter
    // type would infer a declaration for a free `n`/`p`.
    signature: '(set<any>, any) -> set',
    typeHandlerKind: 'types',
    type: quotientRingType,
  },

  Complement: {
    // Return the elements of the first argument that are not in any of
    // the subsequent sets
    wikidata: 'Q242767',
    signature: '(set<any>+) -> set',
    description:
      'Return the elements of the first set that are not in any of the subsequent sets.',
    collection: {
      isEnumerable: enumerableFromSource,
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
    // Accepts any finite collection operand (e.g. a `List`), not just sets:
    // list operands are coerced to a set (deduped) by `intersection`, so
    // `Intersection([1,2,3], [2,3,4])` works without building sets by hand.
    wikidata: 'Q185837',
    signature: '(collection<any>+) -> set',
    description: 'Return the intersection of one or more collections as a set.',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      // A single operand is NOT the empty set: the intersection of one
      // collection is that collection (as a set — `Intersection([1, 2])`
      // evaluates to `Set(1, 2)`), symmetric with single-operand `Union`.
      // Keep the operator so the `intersection` evaluate handler dedups it.
      const validatedArgs = validateSetArguments(
        ce,
        flatten(
          args.map((arg) => arg.canonical),
          'Intersection'
        ),
        '(collection<any>+) -> set'
      );
      return ce._fn('Intersection', validatedArgs);
    },
    evaluate: intersection,
    collection: {
      isEnumerable: enumerableFromAllSources,
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
    signature: '(collection<any>+) -> set',
    description: 'Return the union of two or more collections as a set.',
    canonical: (args, { engine: ce }) => {
      if (args.length === 0) return ce.symbol('EmptySet');
      const validatedArgs = validateSetArguments(
        ce,
        flatten(
          args.map((arg) => arg.canonical),
          'Union'
        ),
        '(collection<any>+) -> set'
      );
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
      isEnumerable: enumerableFromAllSources,
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
    signature: '(set<any>, value*) -> set',
    description:
      'Return the set difference between the first set and subsequent values.',
    canonical: (args, { engine: ce }) => {
      // Label tolerance (`G \setminus H`, `G \setminus \{e\}`): without
      // this handler, generic signature validation rejects a label first
      // operand (e.g. `G`, the gravitational constant, types real).
      return ce._fn(
        'SetMinus',
        validateSetArguments(ce, args, '(set<any>, value*) -> set')
      );
    },
    evaluate: setMinus,
    collection: {
      isEnumerable: enumerableFromSource,
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
    signature: '(set<any>, set<any>) -> set',
    description:
      'Return the symmetric difference of two sets (elements in either set but not both).',
    evaluate: symmetricDifference,
    collection: {
      isEnumerable: enumerableFromAllSources,
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

/**
 * Is `lhs` ⊆ `rhs` (strictly, if `strict`)? `undefined` when undecided.
 *
 * `subsetOf()` answers `receiver ⊆ argument`, so the dispatch is on `lhs`, the
 * candidate SUBSET. That is the direction the public method documents
 * (`Expression.subsetOf`, `types-expression.ts`) and the one the handlers
 * implement.
 */
function subset(
  lhs: Expression,
  rhs: Expression,
  strict = true
): boolean | undefined {
  for (const op of [lhs, rhs]) {
    if (op.isCollection) continue;
    // `isCollection` is also `false` for a symbol DECLARED with a collection
    // type and not yet assigned, and for an inert set-valued shell. Answering
    // `False` for those would be a claim that a later assignment contradicts,
    // so only an operand whose TYPE rules out a collection is a definitive
    // `false`.
    return typesOverlap(op.type.type, 'collection') ? undefined : false;
  }
  return lhs.subsetOf(rhs, strict);
}

function union(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // ops should be collections. Keep set-/collection-VALUED operands as sets —
  // including inert set-valued shells whose `isCollection` is false because
  // they carry no collection handler (e.g. `Interior(D)`, a Fungrim
  // member-guard set): wrapping such an operand in `Set([op])` would collapse
  // the whole set into a single literal element (SYM P3-10). Only a genuine
  // scalar (neither a collection nor set-typed) is promoted to a singleton set.
  //
  // The type test is `collection`, not `set`: a symbol declared `list<number>`
  // with no value yet is collection-SHAPED, so promoting it committed the same
  // collapse — `Union(L, Set(1))` answered `Set(L, 1)`, with `L` as a single
  // ELEMENT, where the assigned `L := [5]` gives `Set(5, 1)`. Widening to
  // `collection` subsumes the `set` case (a set is a collection) and leaves
  // such an operand unwrapped, so the finiteness gate below keeps the whole
  // `Union` symbolic until the value arrives.
  const xs = ops.map((op) =>
    op.isCollection || op.type.matches('collection<any>')
      ? op
      : ce.function('Set', [op])
  );

  // A Set literal can only be folded when every operand is a FINITE,
  // enumerable collection. If any operand is infinite (Integers, Interval) or
  // non-enumerable (an inert set shell, a set-builder), keep the union
  // symbolic so the set-valued operand is preserved structurally rather than
  // dropped or collapsed into a literal element (SYM P3-10).
  if (!xs.every((op) => op.isFiniteCollection === true))
    return ce._fn('Union', xs);

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
): Expression | undefined {
  // Stay symbolic unless every operand is a collection and the first is
  // finite and enumerable (mirrors `union`/`setMinus`). Folding unknown
  // symbols or tolerated label operands (`H \cap K`, `AC \cap BD`) to
  // literal elements produced a spurious `EmptySet`, as did an infinite
  // first operand (`Intersection(Integers, Set(1,2))`).
  // A single operand is that collection as a set. A set-shaped operand
  // needs no enumeration or dedup — return it directly (what lets
  // `Intersection(Integers)` evaluate to `Integers`). A finite non-set
  // collection falls through to the dedup path below; an infinite non-set
  // collection stays symbolic.
  if (ops.length === 1 && ops[0].type.matches('set<any>')) return ops[0];

  if (!ops.every((op) => op.isCollection)) return undefined;
  const first = ops[0];
  if (first.isFiniteCollection !== true) return undefined;
  if ((first.count ?? Infinity) > MAX_SIZE_EAGER_COLLECTION) return undefined;

  // Remove elements that are not in all the other sets. Use `.contains()`
  // (not `isFiniteIndexedCollection` + `.each()`) since a `Set` is a finite
  // collection but not an *indexed* one: `isFiniteIndexedCollection(Set(2))`
  // is `false`, which previously fell through to the "not a collection"
  // branch and compared each candidate element to the whole `Set` operand
  // (never matching), so e.g. `Intersection(Set(1,2), Set(2))` always
  // produced `EmptySet`. `.contains()` also works for non-indexed and
  // infinite collections (e.g. `Integers`) without enumerating them.
  let elements = [...first.each()];
  for (const op of ops.slice(1))
    elements = elements.filter((element) => op.contains(element) === true);

  // Preserve set semantics of the result: dedup (the first operand may be a
  // list with repeated elements).
  const unique: Expression[] = [];
  for (const elem of elements)
    if (unique.every((e) => !e.isSame(elem))) unique.push(elem);

  if (unique.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', unique);
}

/**
 * A *label operand*: a symbol conventionally naming a geometric object or a
 * group — a single letter, optionally subscripted or primed (`G`, `K_a`,
 * `C_1`, `B'`) — or an implicit product of such symbols (`AC`, `xH`,
 * `CC_1`). Set operations tolerate these where a set is expected so that
 * olympiad geometry (`P = AC \cap BD`) and group theory
 * (`x \in G \setminus H`) stay inert instead of flagging
 * `incompatible-type`. A *bare* operand must start with an uppercase letter
 * (`G`, `K_a`); inside a product any single-letter symbols qualify (`xH`).
 */
// Some single-letter glyphs bind to well-known constants at parse time
// (`G` → CatalanConstant, `e` → ExponentialE, `i` → ImaginaryUnit). In a
// label context those glyphs still name points or groups, so map the
// constant back to its glyph for the label test.
const CONSTANT_GLYPHS: Record<string, string> = {
  CatalanConstant: 'G',
  ExponentialE: 'e',
  ImaginaryUnit: 'i',
};

function labelSymbolName(x: Expression): string | null {
  if (isFunction(x) && x.operator === 'Prime') return labelSymbolName(x.ops[0]);
  const s = sym(x);
  if (!s) return null;
  const glyph = CONSTANT_GLYPHS[s];
  if (glyph !== undefined) return glyph;
  return /^[a-zA-Z](_.*)?$/.test(s) ? s : null;
}

function isLabelOperand(expr: Expression): boolean {
  if (
    isFunction(expr) &&
    (expr.operator === 'Multiply' || expr.operator === 'InvisibleOperator')
  ) {
    // A product label needs at least one uppercase letter (`AC`, `xH`,
    // `CC_1`): an all-lowercase run such as `kstr` is a genuine type error
    // (see tier4-structural.test.ts), not a geometry/group label.
    const names = expr.ops.map(labelSymbolName);
    return (
      expr.ops.length >= 2 &&
      names.every((n) => n !== null) &&
      names.some((n) => /^[A-Z]/.test(n!))
    );
  }
  const name = labelSymbolName(expr);
  return name !== null && /^[A-Z]/.test(name);
}

/** Validate `args` against `signature`, but keep label operands (see
 * `isLabelOperand`) as-is where validation flagged them. */
function validateSetArguments(
  ce: ComputeEngine,
  args: ReadonlyArray<Expression>,
  signature: string
): ReadonlyArray<Expression> {
  const validated = validateArguments(ce, args, parseType(signature));
  if (!validated) return args;
  return validated.map((v, i) =>
    !v.isValid && isLabelOperand(args[i]) ? args[i] : v
  );
}

/** A trailing SetMinus operand excludes its *members* when it is itself a
 * set/collection, and excludes itself as a value otherwise.
 *
 * TEXT is ATOMIC here and excludes ITSELF. A string is an indexed collection
 * of its grapheme clusters, so reading it as a collection made
 * `SetMinus(Set("ab", "cd"), "ab")` remove the CHARACTERS `"a"` and `"b"` —
 * neither of which is a member — and leave `"ab"` in the set it was asked to
 * remove it from. Removing a string's characters is spelled explicitly as
 * `SetMinus(s, Characters(t))` (`docs/STRING_ROADMAP.md`, design constraint
 * 5). */
function isExcludedBy(val: Expression, x: Expression): boolean {
  if (val.isCollection && !isTextAtom(val)) return val.contains(x) === true;
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
  // Text is atomic — see `isExcludedBy`, whose rule this mirrors: a string
  // operand excludes itself as a value, never its characters as members.
  if (val.isCollection && !isTextAtom(val)) return val.contains(x);
  // A valueless collection-typed operand excludes its MEMBERS, which are not
  // knowable yet — so the answer is UNDECIDED, not the scalar disequality
  // below. Falling through asked `x = L` where the question is `x ∈ L`; both
  // happen to be undecided for a free `L` today, so this arm currently only
  // corrects the REASON rather than the verdict. Stating it explicitly keeps
  // the three `SetMinus` exclusion rules (this one, `setMinus`'s eager fold,
  // and the `membershipKleene` query decomposition) on one rule: a partial fix
  // reopens the hole on whichever route was left behind, and `notEqualKleene`
  // growing stronger on free variables would turn this into a wrong verdict.
  if (isValuelessCollectionTyped(val)) return undefined;
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
 * 3. Type-style membership for type names (e.g. `Element(x, real)`).
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
      } else if (isValuelessCollectionTyped(val)) {
        // Third copy of the exclusion rule (see `isExcludedByKleene` and the
        // eager fold in `setMinus`): a valueless collection-typed operand
        // excludes its unknown MEMBERS, so the conjunct is undecided rather
        // than the scalar disequality below.
        conjunct = undefined;
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
    // 3. Type-style membership, e.g. Element(x, real)
    try {
      const type = ce.type(typeName);
      if (!type.isUnknown) {
        // Three-valued: in particular, a concrete number literal whose type
        // overlaps but does not match is definitively excluded (e.g.
        // `Element(2.5, integer)` → False, even though
        // `rational ∩ integer` is non-empty), while a symbol of
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
      for (const [fact, records] of contextAssumptions(ce)) {
        if (!isFactTrue(records) || !isFunction(fact)) continue;
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

  // An exclusion operand that is DEFINITELY collection-typed but carries no
  // value — a symbol declared `list<number>`, or a call whose head returns one
  // — excludes its MEMBERS, and they are not knowable yet. `isExcludedBy` is
  // two-valued and would fall to its scalar arm (`val.isSame(element)`, always
  // false here), so every element survived and the fold committed a set that
  // the same expression contradicts once the symbol is assigned:
  // `Element(1, SetMinus(Set(1,2), L))` answered `True`, and `False` once
  // `L := [1]`. INVERTING a membership answer is the worst shape this can
  // take, because a wrong `True` feeds assumption discharge. Stay symbolic;
  // the `contains`/iterator handlers answer once `L` has a value.
  if (values.some(isValuelessCollectionTyped)) return undefined;

  const elements = [...col.each()].filter(
    (element) => !values.some((val) => isExcludedBy(val, element))
  );

  if (elements.length === 0) return ce.symbol('EmptySet');
  return ce._fn('Set', elements);
}

/** `SymmetricDifference(a, b)` = elements in `a` or `b` but not both. Only
 * reduced to a literal `Set` when both operands are finite; otherwise stays
 * symbolic (the `collection` handlers above provide membership/iteration
 * semantics for the unevaluated form). */
function symmetricDifference(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  const [a, b] = ops;
  if (!a || !b) return undefined;
  if (a.isFiniteCollection !== true || b.isFiniteCollection !== true)
    return undefined;

  const elements: Expression[] = [];
  for (const elem of a.each())
    if (b.contains(elem) !== true) elements.push(elem);
  for (const elem of b.each())
    if (a.contains(elem) !== true && elements.every((e) => !e.isSame(elem)))
      elements.push(elem);

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
