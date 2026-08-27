import type { Type, ListType } from '../../common/type/types.js';
import {
  isAtomicValueType,
  stripNumericRanges,
  widen,
} from '../../common/type/utils.js';

import type { Expression } from '../global-types.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { computeBroadcastCell } from './broadcast-cell-widening.js';

/**
 * The result of analyzing one level of a (possibly nested) literal-`List`
 * structure: the dimensions rooted at this level, and the flat list of every
 * leaf cell type reachable underneath it.
 */
type ShapeAnalysis = { dims: number[]; cells: Type[] };

/**
 * The **honest** shape-derived `Type` of a literal `List` node whose children
 * are `ops` (§D3 of `docs/COLLECTIONS-MODEL.md`).
 *
 * Returns a **dimensioned** `list` type (`{kind:'list', elements: C,
 * dimensions:[…]}`) when the list is shape-regular over atomic cells; returns
 * `null` (no shape claim) otherwise — in which case the caller falls back to
 * its plain `list<widen(...)>` behavior.
 *
 * Cell classification (per element):
 * - a **literal `List` child** (`operator === 'List'`) → a nested axis
 *   (recurse);
 * - an **inference-pending bare symbol** (a symbol typed `unknown`) → a cell of
 *   type `number` (the generic-symbol fold — bare SYMBOLS only, never an
 *   application, which could return a collection);
 * - an element whose type is **atomic** (§D5, `isAtomicValueType`) → a cell of
 *   that type;
 * - anything else → **blocks** (no shape claim).
 *
 * A shape claim additionally requires: no blocked element; no level mixing
 * cells and nested Lists; for rank ≥ 2 every child is a literal `List` with
 * identical dimensions (cell types need not match row-to-row); no empty level
 * (any zero-length axis → no claim); and the global widened cell type is
 * union-free.
 *
 * The element type `C` is the widened type, reported honestly
 * (`finite_integer`, `finite_real`, `color`, `boolean`, `tuple<…>`, …).
 * No numeric lift to `number`: the broadcast typing contract requires an
 * evaluated value's type to be a SUBTYPE of the statically declared
 * `list<R>` (`evaluated.matches(declared)`, `list-broadcast-typing.test.ts`),
 * and lifting `finite_real` cells to `number` widens past `R`, breaking it.
 * The honest widening satisfies the contract by construction.
 */
export function shapedListType(ops: ReadonlyArray<Expression>): Type | null {
  const analysis = analyzeLevel(ops);
  if (analysis === null) return null;

  const { dims, cells } = analysis;
  if (cells.length === 0) return null;

  const widened = widen(...cells);

  // A heterogeneous cell population (`widen(number, color) = number | color`)
  // makes no kernel or signature sense — no shape claim. But the ANALYZED
  // widening (which includes the bare-symbol number fold) is still the honest
  // element type: return it unshaped rather than `null`, so the caller's raw
  // fallback — where `widen(unknown, color)` would absorb the unknown and
  // unsoundly claim `list<color>` for `[x, Rgb]` — never applies here.
  if (typeof widened !== 'string' && widened.kind === 'union')
    return { kind: 'list', elements: widened };

  const result: ListType = {
    kind: 'list',
    elements: widened as Type,
    dimensions: dims,
  };
  return result;
}

/**
 * Analyze one level of a literal-`List` structure whose children are `ops`.
 * Returns `null` if this level (or anything nested under it) blocks a shape
 * claim; otherwise the dimensions and the flat list of leaf cell types.
 */
function analyzeLevel(ops: ReadonlyArray<Expression>): ShapeAnalysis | null {
  // No empty level: a zero-length axis is never claimed.
  if (ops.length === 0) return null;

  const childShapes: ShapeAnalysis[] = [];
  const cellTypes: Type[] = [];

  for (const op of ops) {
    // A literal `List` child (a plain `List` function) is a nested axis.
    if (isFunction(op, 'List')) {
      const sub = analyzeLevel(op.ops);
      if (sub === null) return null;
      childShapes.push(sub);
    } else {
      const cell = classifyCell(op);
      if (cell === null) return null;
      cellTypes.push(cell);
    }
  }

  // No level mixing cells and nested Lists.
  if (childShapes.length > 0 && cellTypes.length > 0) return null;

  // All cells → a rank-1 level.
  if (childShapes.length === 0) return { dims: [ops.length], cells: cellTypes };

  // All nested Lists → rank ≥ 2. Every child must have identical dimensions
  // (cell types need not match row-to-row).
  const firstDims = childShapes[0].dims;
  for (let i = 1; i < childShapes.length; i++)
    if (!sameDims(childShapes[i].dims, firstDims)) return null;

  const cells: Type[] = [];
  for (const cs of childShapes) cells.push(...cs.cells);

  return { dims: [ops.length, ...firstDims], cells };
}

/**
 * Classify a non-`List` element as a cell type, or `null` if it blocks a shape
 * claim.
 */
function classifyCell(op: Expression): Type | null {
  // A number literal's public type carries its value or sign (ruling O9:
  // `finite_rational<0.5..0.5>`, `(finite_real<0..>) & !0`) — decorated
  // OBJECT nodes that `isAtomicValueType` blocks, which silently withdrew
  // the shape claim from every exact-rational or radical matrix
  // (`MatrixRank` of `[[1/2, 1/3], …]` went inert). The claim is about the
  // cell's TIER, so project a literal's decoration back to it. Non-literal
  // ranged cells (an unevaluated `Abs(x)`) keep blocking, as they did
  // before literals carried these types.
  // The numeric branch discards the literal decoration on the very next
  // step, so deriving it is wasted work — and this runs once per element of
  // a materialized list. Read that leaf's type with the literal type
  // withheld (`broadcast-cell-widening.ts`): the getter then answers with
  // the tier `stripNumericRanges` was going to reduce it to anyway, so the
  // claim is unchanged.
  //
  // Scoped to the NUMBER-LITERAL branch on purpose. A composite cell (a
  // tuple, a nested list) computes and CACHES its type, and that memo is not
  // covered by the no-memo-write rule the window relies on, so a widened
  // component type would outlive the window and be seen by a later reader.
  // Those cells are read outside it.
  const t = isNumber(op)
    ? stripNumericRanges(
        computeBroadcastCell(op.engine, () => op.type.type)
      )
    : op.type.type;

  // `unknown`/`any` govern cell classification only via the fold: an
  // inference-pending BARE SYMBOL folds to `number`; anything else typed
  // `unknown`/`any` (notably an application, which could return a collection)
  // blocks.
  if (t === 'unknown' || t === 'any') {
    if (t === 'unknown' && isSymbol(op)) return 'number';
    return null;
  }

  if (isAtomicValueType(t)) return t;

  return null;
}

function sameDims(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
