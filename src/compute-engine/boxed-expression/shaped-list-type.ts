import type { Type, ListType } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
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
 * structure: the dimensions rooted at this level. The leaf cell types are
 * not part of the result; the walk appends them to the shared `cells` list
 * of the `ShapeWalk` as it reaches them.
 */
type ShapeAnalysis = { dims: number[] };

/**
 * The state of one `shapedListType` call.
 *
 * `memo` holds the analysis of every nested `List` node already visited, by
 * node identity; a blocked level records `null`. `cells` collects the
 * distinct leaf cell types in the order the walk first reaches them, and
 * `seen` is the set behind that list. Each distinct node contributes its
 * cells once, so the list is bounded by the number of leaf nodes rather than
 * by the number of paths.
 *
 * The cells are widened ONCE, in that order, at the end. This reproduces the
 * fold the analysis made when it collected one entry per path: `widen` folds
 * left to right, its running result is a supertype of every cell folded so
 * far, and folding a cell again into a supertype of itself changes nothing —
 * so dropping the repeats leaves the result unchanged. Widening level by
 * level would NOT: for unrelated cell types `widen` answers a union whose
 * members depend on the grouping (`integer, integer, color, real` gives
 * `integer | color | real` folded flat but `color | real` folded by level).
 */
type ShapeWalk = {
  memo: Map<Expression, ShapeAnalysis | null>;
  cells: Type[];
  seen: Set<Type>;
};

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
 * (`integer`, `real`, `color`, `boolean`, `tuple<…>`, …).
 * No numeric lift to `number`: the broadcast typing contract requires an
 * evaluated value's type to be a SUBTYPE of the statically declared
 * `list<R>` (`evaluated.matches(declared)`, `list-broadcast-typing.test.ts`),
 * and lifting `real` cells to `number` widens past `R`, breaking it.
 * The honest widening satisfies the contract by construction.
 */
export function shapedListType(ops: ReadonlyArray<Expression>): Type | null {
  const walk: ShapeWalk = { memo: new Map(), cells: [], seen: new Set() };
  const analysis = analyzeLevel(ops, walk);
  if (analysis === null) return null;

  const { dims } = analysis;
  const { cells } = walk;
  if (cells.length === 0) return null;

  // Folded pairwise rather than spread into one call: a wide literal has as
  // many distinct leaves as it has elements, and a spread of that many
  // arguments would exceed the call stack.
  let widened: Readonly<Type> = cells[0];
  for (let i = 1; i < cells.length; i++) widened = widen(widened, cells[i]);

  // A heterogeneous cell population (`widen(number, color) = number | color`)
  // makes no kernel or signature sense — no shape claim. But the ANALYZED
  // widening (which includes the bare-symbol number fold) is still the honest
  // element type: return it unshaped rather than `null`, so the caller's raw
  // fallback — where `widen(unknown, color)` would absorb the unknown and
  // unsoundly claim `list<color>` for `[x, Rgb]` — never applies here.
  //
  // A NUMERIC union is not heterogeneous: `complex | infinity` and
  // `real | signed_infinity` are the carriers the declared-domain operators
  // infer into a fresh symbol (`Abs(a)` types `a` as `complex | infinity`),
  // and a matrix of such symbols is as much a matrix as one of `number`
  // symbols — `Determinant([[a, b], [c, d]])` went inert with an
  // `incompatible-type` error once `a` had been used under `Abs`. The
  // shape claim stands, with the union as the honest element type.
  if (
    typeof widened !== 'string' &&
    widened.kind === 'union' &&
    !isSubtype(widened, 'number')
  )
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
 * claim; otherwise the dimensions. The leaf cell types are appended to
 * `walk.cells`.
 *
 * A boxed expression is a DAG: a list built from one sub-list referenced
 * twice holds the same object twice, and `List(t, t)` nested 26 times has
 * 27 distinct nodes but 2^26 paths to the leaf. The analysis is therefore
 * memoized per nested `List` node (`walk.memo`), so a shared node is
 * analyzed once and its cells are collected once. Walking the tree once per
 * path, and spreading every leaf into one `widen(...cells)` call, overflowed
 * the stack at 18 levels while canonicalizing `Length` over such a list.
 */
function analyzeLevel(
  ops: ReadonlyArray<Expression>,
  walk: ShapeWalk
): ShapeAnalysis | null {
  // No empty level: a zero-length axis is never claimed.
  if (ops.length === 0) return null;

  const childShapes: ShapeAnalysis[] = [];
  let cellCount = 0;

  for (const op of ops) {
    // A literal `List` child (a plain `List` function) is a nested axis.
    if (isFunction(op, 'List')) {
      let sub = walk.memo.get(op);
      if (sub === undefined) {
        sub = analyzeLevel(op.ops, walk);
        walk.memo.set(op, sub);
      }
      if (sub === null) return null;
      childShapes.push(sub);
    } else {
      const cell = classifyCell(op);
      if (cell === null) return null;
      cellCount++;
      if (!walk.seen.has(cell)) {
        walk.seen.add(cell);
        walk.cells.push(cell);
      }
    }
  }

  // No level mixing cells and nested Lists.
  if (childShapes.length > 0 && cellCount > 0) return null;

  // All cells → a rank-1 level.
  if (childShapes.length === 0) return { dims: [ops.length] };

  // All nested Lists → rank ≥ 2. Every child must have identical dimensions
  // (cell types need not match row-to-row).
  const firstDims = childShapes[0].dims;
  for (let i = 1; i < childShapes.length; i++)
    if (!sameDims(childShapes[i].dims, firstDims)) return null;

  return { dims: [ops.length, ...firstDims] };
}

/**
 * Classify a non-`List` element as a cell type, or `null` if it blocks a shape
 * claim.
 */
function classifyCell(op: Expression): Type | null {
  // A number literal's public type carries its value or an enclosing range
  // (ruling O9: `rational<0.5..0.5>`, `real<1.4..1.5>`) —
  // decorated
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
    ? stripNumericRanges(computeBroadcastCell(op.engine, () => op.type.type))
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
