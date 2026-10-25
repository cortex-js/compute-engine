import type { Type } from '../../common/type/types.js';
import {
  EXTENDED_REAL_TYPE,
  SIGNED_INFINITY_TYPE,
} from '../../common/type/primitive.js';
import type { Expression } from '../global-types.js';
import { isSymbol } from './type-guards.js';

/**
 * The number-set symbols an assumption can name, and the type each one
 * proves about its member.
 *
 * A leaf module: the tables are read both by `assume()`, which records the
 * membership fact, and by the fact index, which turns that fact back into a
 * type contribution. Keeping them here lets the index module stay free of
 * imports that could close a dependency cycle.
 */

/** The type an extended number set proves about its members: the finite
 * tier of the set together with its infinite values. Each type is the
 * element type that the definition of the set in `library/sets.ts` declares
 * (`elttype`), so `assume(x ∈ S)` and `x ∈ S` read the same tier. */
const EXTENDED_SET_TYPES: Record<string, Type> = {
  ExtendedRealNumbers: EXTENDED_REAL_TYPE,
  ExtendedRationalNumbers: {
    kind: 'union',
    types: ['rational', SIGNED_INFINITY_TYPE],
  },
  ExtendedIntegers: { kind: 'union', types: ['integer', SIGNED_INFINITY_TYPE] },
  ExtendedComplexNumbers: { kind: 'union', types: ['complex', 'infinity'] },
};

/** The type a PRIMITIVE (unsigned) number set proves about its members, or
 * `'unknown'` when the expression names no such set. The extended sets
 * (`ExtendedRealNumbers` and the others) are primitive sets too: their type
 * adds the infinite values to the finite tier. */
export function domainToType(expr: Expression): Type {
  if (!isSymbol(expr)) return 'unknown';
  // An own-property check: a symbol named `constructor`, `toString` or
  // `__proto__` must not read a value inherited from `Object.prototype`.
  if (Object.hasOwn(EXTENDED_SET_TYPES, expr.symbol))
    return EXTENDED_SET_TYPES[expr.symbol];
  if (expr.symbol === 'Numbers') return 'number';
  if (expr.symbol === 'ComplexNumbers') return 'complex';
  if (expr.symbol === 'ImaginaryNumbers') return 'imaginary';
  if (expr.symbol === 'RealNumbers') return 'real';
  if (expr.symbol === 'RationalNumbers') return 'rational';
  if (expr.symbol === 'Integers') return 'integer';
  return 'unknown';
}

/**
 * Signed number-set symbols that decompose into a base type plus a single
 * sign bound. `domainToType` only maps the *unsigned* primitive sets (ℂ, ℝ,
 * ℚ, ℤ, …); these carry a sign that must also be stored as a bound fact for
 * `isPositive`/`isNegative`/`isNonNegative`/`isNonPositive` to fire.
 *
 * Integer variants use ±1 rather than 0 for the strict cases so the bound is
 * the tight integer bound (`PositiveIntegers` ⇒ `≥ 1`, `NegativeIntegers` ⇒
 * `≤ −1`); the real variants use an open bound at 0.
 */
export const SIGNED_NUMBER_SETS: Record<
  string,
  {
    type: Type;
    op: 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual';
    value: number;
  }
> = {
  PositiveNumbers: { type: 'real', op: 'Greater', value: 0 },
  NonNegativeNumbers: { type: 'real', op: 'GreaterEqual', value: 0 },
  NegativeNumbers: { type: 'real', op: 'Less', value: 0 },
  NonPositiveNumbers: { type: 'real', op: 'LessEqual', value: 0 },
  PositiveIntegers: { type: 'integer', op: 'GreaterEqual', value: 1 },
  NonNegativeIntegers: { type: 'integer', op: 'GreaterEqual', value: 0 },
  NegativeIntegers: { type: 'integer', op: 'LessEqual', value: -1 },
  NonPositiveIntegers: { type: 'integer', op: 'LessEqual', value: 0 },
};
