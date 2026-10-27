import type { Expression } from '../global-types.js';
import type { FunctionInterface } from '../types-expression.js';
import { isFunction, isSymbol } from './type-guards.js';
import { isPointElementType } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';

/**
 * Whether `e` is a coordinate accessor (`PointX`, `PointY`, `PointZ`) whose
 * value may be a list at run time: its type does not prove a number, and its
 * operand is not provably one point. The accessors broadcast over a list of
 * points, so `PointY(v)` with `v` a list of points is the list of the
 * y-coordinates.
 *
 * The case arises inside a function literal applied to a list of points,
 * `(v ↦ PointList(PointY(v), PointX(v)))([(1, 2, 3), (4, 5, 6)])`: the
 * parameter is typed from its uses in the body (`collection<any> | tuple`,
 * the parameter type of the accessors), before any argument is known, so the
 * accessor is typed `unknown`. `PointList` reads an `unknown` component as a
 * scalar slot, which is right for a free plot variable but wrong here: the
 * compiled point list was `[NaN, NaN]` where the interpreter gives
 * `[(2, 1), (5, 4)]` (ROADMAP CE-514, Tycho row 447). Read by the `PointList`
 * compile handler (`library/collections.ts`) and by `compileJSPointList()`
 * (`compilation/javascript-target.ts`), which decide the role of such a
 * component at run time from the value of the OPERAND: a list whose elements
 * are all arrays is a list of points, and the accessor is a zip source; any
 * other operand gives one slot. The accessor's own value cannot decide it: a
 * coordinate of a flat list can be a tuple (`PointY([5, (1, 2)])` is
 * `(1, 2)`), which is an array at run time too.
 *
 * Only an accessor typed `unknown` or `any` is matched: a type that proves a
 * number or a list keeps the static routes of `PointList`. The operand must
 * be a symbol, so that the compiled code can read it a second time for the
 * role test at no cost and with no effect.
 */
export function isAccessorOfPossibleList(
  e: Expression
): e is Expression & FunctionInterface {
  if (!isFunction(e)) return false;
  const h = e.operator;
  if (h !== 'PointX' && h !== 'PointY' && h !== 'PointZ') return false;
  const own = e.type.type;
  if (own !== 'unknown' && own !== 'any') return false;
  if (!isSymbol(e.op1)) return false;
  const t = e.op1.type.type;
  // One point: its coordinate is one value. A string is read as one value
  // too (its coordinate is a character).
  if (isPointElementType(t) || isSubtype(t, 'string')) return false;
  return true;
}
