/**
 * The type and the absence marker of an element read whose base is typed by
 * a tuple, shared by the JavaScript and Python targets.
 *
 * The interpreter reads one slot of a tuple: `At(p, 1)` for
 * `p: tuple<unknown, number>` is typed `unknown`, not `number`, the join of
 * the slots. When the base is absent at run time, the interpreter answers
 * `NaN` when the read is typed as a number and `Missing` otherwise. The
 * compiled code of each target must give the same answer, so both targets
 * ask these functions.
 */

import type { Expression } from '../global-types.js';
import type { Type, TupleType } from '../../common/type/types.js';
import {
  collectionElementType,
  resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { isOperatorDef } from '../boxed-expression/definition-guards.js';

/**
 * The type of the slot at the 1-based `position` (a negative position counts
 * from the end) of a base typed by one tuple, with or without a `missing`
 * arm (`missing | tuple<unknown, number>`, the row read `At(b, 1)` for
 * `b: list<tuple<unknown, number>>`). `undefined` for any other base type.
 *
 * A position outside the tuple reads no slot. The interpreter then takes
 * the marker from the cells of the value when a slot is `unknown` or `any`
 * (`absenceMarker()`, `library/collections.ts`): `Missing` for `("s", 2)`,
 * `NaN` for `(3, 2)`. The answer is then `unknown`, which makes the
 * lowerings pick the marker from the value as well. With no such slot, the
 * answer is `undefined` and the join of the slots decides, as before.
 *
 * The element type of a tuple (`indexElementType`) joins its slots, and the
 * join ignores an `unknown` slot: the element type of
 * `tuple<unknown, number>` is `number`. A read of the first slot was then
 * compiled as a numeric read and gave `NaN` for an absent base, where the
 * interpreter types the read `unknown` and answers `Missing`. The `At`,
 * `First`, `Second`, `Third` and `Last` lowerings read the slot type
 * instead, as the interpreter does.
 */
export function tupleSlotReadType(
  baseType: Type,
  position: number
): Type | undefined {
  if (!Number.isInteger(position) || position === 0) return undefined;
  const r = resolveTypeForCompilation(stripMissingFromType(baseType));
  if (typeof r === 'string' || r.kind !== 'tuple') return undefined;
  const k = position > 0 ? position - 1 : r.elements.length + position;
  if (k >= 0 && k < r.elements.length) return r.elements[k].type;
  return r.elements.some((x) => {
    const slot = resolveTypeForCompilation(stripMissingFromType(x.type));
    return slot === 'unknown' || slot === 'any';
  })
    ? 'unknown'
    : undefined;
}

/**
 * Whether the read at the 1-based `position` (a negative position counts
 * from the end) of a base typed `tuple` gives `NaN`, not `Missing`, when the
 * base is absent, as the interpreter decides it. The interpreter takes the
 * marker from the type of the read, without its `missing` arm
 * (`absentMarkerIsNumeric()`, `boxed-expression/validate.ts`):
 * - a position in the tuple reads the type of the slot: `NaN` when it is a
 *   number type (`number`, `real`, `integer`, ...), `Missing` when it is
 *   `unknown`, `any` or not a number;
 * - a position outside the tuple is typed by the marker of the join of the
 *   slots (`markerType()`, `library/collections.ts`): `NaN` when a slot can
 *   be a number (`tuple<number, string>`), or when every slot is `unknown`
 *   or `any`, and `Missing` otherwise (`tuple<string, string>`).
 */
function absentTupleReadIsNumeric(t: TupleType, position: number): boolean {
  const n = t.elements.length;
  const k = position > 0 ? position - 1 : n + position;
  const isTop = (x: Type): boolean => x === 'any' || x === 'unknown';
  const present = (x: Type): Type =>
    resolveTypeForCompilation(stripMissingFromType(x));
  if (k >= 0 && k < n) {
    const slot = present(t.elements[k].type);
    return !isTop(slot) && slot !== 'never' && isSubtype(slot, 'number');
  }
  const slots = t.elements.map((x) => present(x.type));
  if (slots.length > 0 && slots.every(isTop)) return true;
  return slots.some((x) => {
    const arms = typeof x !== 'string' && x.kind === 'union' ? x.types : [x];
    return arms.some((a) => {
      const r = resolveTypeForCompilation(a);
      return !isTop(r) && r !== 'never' && isSubtype(r, 'number');
    });
  });
}

/**
 * Whether the element read at the 1-based `position` of `coll` gives `NaN`,
 * not `Missing`, when `coll` is absent at run time. The compiled JavaScript
 * passes the answer to `_SYS.atWithValueMarker`, which otherwise answers
 * `Missing` (`undefined`) for an absent base. The compiled Python uses the
 * answer as the marker of an absent base (`float('nan')` or `None`).
 *
 * The interpreter takes the marker of a read of an absent base from the
 * type of the read: `NaN` for a number, `Missing` otherwise.
 *
 * - A base typed by one tuple, with or without a `missing` arm
 *   (`missing | tuple<number, string>`, the row read `At(b, 1)` for
 *   `b: list<tuple<number, string>>`): the type of the read comes from the
 *   slots of that tuple (`absentTupleReadIsNumeric`).
 * - A base whose collection comes from a symbol typed `any` or `unknown`
 *   (through element reads and calls of functions defined by the user): the
 *   interpreter computes the type of the read from the values, since such a
 *   symbol has the type of its value. So with `tup := t ↦ (t, 2t)` (typed
 *   `(unknown) -> tuple<number, number>`), `x: any` and `x = []`, the
 *   interpreter types `At(tup(x), 1)` as `missing | tuple<number, number>`
 *   (`tup(x)` is an empty list of tuples) and `At(At(tup(x), 1), 2)` as
 *   `number`: it answers `NaN`. The compiled code only has the static type
 *   of `x`, `any`, which types the base `list<any> | missing | number |
 *   tuple<number, number>`. The base is absent only when `tup(x)` is an
 *   empty list, and the interpreter then reads the slot of the tuple. So
 *   the compiled code reads the tuples in the type of the base (user
 *   decision 2026-10-25, option (c) of ROADMAP CE-214.4): `NaN` when there
 *   is at least one tuple and each tuple gives `NaN`. An arm that is a
 *   number is skipped (an index into a number is an error), and so is a
 *   list whose element type is `any` or `unknown`, which says nothing. A
 *   list whose elements are not numbers keeps the marker `Missing`.
 * - Any other base keeps the marker `Missing`. A base typed by declarations
 *   only (`b: list<list<any> | tuple<number, number>>`) keeps that type in
 *   the interpreter too, which answers `Missing` for a read typed `any`.
 */
export function absentBaseReadIsNumeric(
  coll: Expression,
  position: number | undefined
): boolean {
  if (position === undefined || !Number.isInteger(position) || position === 0)
    return false;
  const r = resolveTypeForCompilation(stripMissingFromType(coll.type.type));
  if (typeof r !== 'string' && r.kind === 'tuple')
    return absentTupleReadIsNumeric(r, position);
  const isTop = (t: Type): boolean => t === 'any' || t === 'unknown';
  // Whether the value of the base can come from a symbol typed `any` or
  // `unknown`. Only the operands that give the collection are read: the
  // collection of an element read (`At(tup(x), 1)` reads `tup(x)`), and the
  // arguments of a call of a function defined by the user (`tup(x)` reads
  // `x`). An index (`i` in `At(b, i)`) and the body of a function literal
  // do not give the collection, so a symbol typed `any` there does not
  // change the type of the base in the interpreter: `At(b, i)` for
  // `b: list<list<any> | tuple<number, number>>` and `i: any` keeps the
  // declared type of `b`. Any other expression gives no answer here, and
  // the read keeps the marker `Missing`.
  const isUserFunctionCall = (e: Expression): boolean => {
    const def = e.engine.lookupDefinition(e.operator);
    if (isOperatorDef(def) && def.operator._lambdaLiteral !== undefined)
      return true;
    const value = e.engine._getSymbolValue(e.operator);
    return value !== undefined && isFunction(value, 'Function');
  };
  const mentionsTopTypedSymbol = (e: Expression): boolean => {
    if (isSymbol(e))
      return isTop(
        resolveTypeForCompilation(stripMissingFromType(e.type.type))
      );
    if (!isFunction(e)) return false;
    if (
      ['At', 'First', 'Second', 'Third', 'Last'].includes(e.operator) &&
      e.ops.length > 0
    )
      return mentionsTopTypedSymbol(e.ops[0]);
    return isUserFunctionCall(e) && e.ops.some(mentionsTopTypedSymbol);
  };
  if (!mentionsTopTypedSymbol(coll)) return false;
  const arms = typeof r !== 'string' && r.kind === 'union' ? r.types : [r];
  let tupleArm = false;
  for (const arm of arms) {
    const a = resolveTypeForCompilation(arm);
    if (a === 'missing' || a === 'nothing' || a === 'never') continue;
    if (isSubtype(a, 'number')) continue;
    if (typeof a !== 'string' && a.kind === 'tuple') {
      if (!absentTupleReadIsNumeric(a, position)) return false;
      tupleArm = true;
      continue;
    }
    const elt = collectionElementType(a);
    if (elt === undefined) return false;
    const e = resolveTypeForCompilation(stripMissingFromType(elt));
    if (isTop(e) || e === 'never') continue;
    if (!isSubtype(e, 'number')) return false;
  }
  return tupleArm;
}
