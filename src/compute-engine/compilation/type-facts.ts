/**
 * Facts about the static type of a binding or of a result that the
 * compiler (`ir/`) reads.
 */

import type { Type } from '../../common/type/types.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';

/**
 * True when a binding of type `t` holds a boolean or is absent:
 * `boolean`, or `boolean | missing`. Shared by the targets that read such
 * a binding in a special way (an empty array is an empty `broadcast()`
 * column; the interval target reads `'true'`/`'false'`).
 */
export function isBooleanBindingType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  const r = resolveTypeForCompilation(stripMissingFromType(t));
  return r !== 'never' && isSubtype(r, 'boolean');
}

/**
 * The count of values per cell that `broadcast()` writes by default for an
 * expression of type `t`: the arity of a tuple of two or more elements whose
 * every element can be a number (the compiled code then returns a JavaScript
 * array of that length), and 1 for any other type, a tuple of one element
 * included. An element counts when its type overlaps `number`, not only when
 * it is a subtype of it: an undeclared symbol has the type `unknown`, so
 * `(x, y)` has the type `tuple<unknown, unknown>`, and a subtype test would
 * give 1 and a `NaN` for every cell with nothing that tells the caller to
 * pass `outputs`. An element that is not a number at run time gives `NaN`
 * in its slot in all cases, so the wider test loses nothing. An element that
 * cannot be a number (`(x, "a")` is `tuple<number, string>`) gives 1.
 */
export function broadcastStrideOfType(t: Type): number {
  if (typeof t !== 'object' || t.kind !== 'tuple') return 1;
  const n = t.elements.length;
  if (n < 2) return 1;
  return t.elements.every((e) => couldMatch(e.type, 'number')) ? n : 1;
}

/**
 * The type `t` as a host writes it in a declaration. The type printer
 * leaves out the entry type `number` of a vector or a matrix
 * (`matrix<number>` prints `matrix`), and a diagnostic that asks for
 * `matrix<real>` must show the `number` it replaces. The type report of a
 * compilation (`freeSymbolTypes`) and the run-time entry diagnostic of the
 * JavaScript runner both use this spelling, so that one symbol has one
 * spelling in both.
 */
export function declaredTypeText(t: Type): string {
  // A tensor of unknown rank with `number` cells prints `tensor` (the
  // printer leaves the cell type out); the diagnostic shows the cells.
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    t.elements === 'number' &&
    t.dimensions === null
  )
    return 'tensor<number>';
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    t.elements === 'number' &&
    t.dimensions &&
    (t.dimensions.length === 1 || t.dimensions.length === 2)
  ) {
    const head = t.dimensions.length === 1 ? 'vector' : 'matrix';
    if (t.dimensions.every((d) => d < 0)) return `${head}<number>`;
    const dims = t.dimensions.map((d) => (d < 0 ? '?' : `${d}`)).join('x');
    return `${head}<number^${dims}>`;
  }
  return typeToString(t);
}
