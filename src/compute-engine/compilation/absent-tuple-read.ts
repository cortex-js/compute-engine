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
  // The compiled lanes read the open form of a broadcast over an operand
  // of type `unknown` as `broadcastable<R>` (`resolveTypeForCompiledLanes`).
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';

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
 * type of the read: `NaN` for a number, `Missing` otherwise. Only a base
 * typed by one tuple, with or without a `missing` arm
 * (`missing | tuple<number, string>`, the row read `At(b, 1)` for
 * `b: list<tuple<number, string>>`), decides the type of the read: it comes
 * from the slots of that tuple (`absentTupleReadIsNumeric`). Any other base
 * keeps the marker `Missing`.
 */
export function absentBaseReadIsNumeric(
  coll: Expression,
  position: number | undefined
): boolean {
  if (position === undefined || !Number.isInteger(position) || position === 0)
    return false;
  const r = resolveTypeForCompilation(stripMissingFromType(coll.type.type));
  return (
    typeof r !== 'string' &&
    r.kind === 'tuple' &&
    absentTupleReadIsNumeric(r, position)
  );
}
