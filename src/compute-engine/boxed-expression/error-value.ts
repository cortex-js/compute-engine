import type { Expression, FunctionInterface } from '../global-types.js';
import { isFunction, isNumber, isString } from './type-guards.js';

/**
 * Structural containers whose contents are DATA, not the structure of a
 * failing computation, and which carry NO `collection` handler block (so
 * `isCollectionHead()` cannot derive them from the definition):
 *
 * - `Dictionary` has no operator definition at all — a dictionary literal
 *   canonicalizes to the engine's compact `BoxedDictionary` representation;
 * - `KeyValuePair` canonicalizes to a `Tuple` when both operands are valid, so
 *   the only `KeyValuePair` NODES that survive are the invalid ones — exactly
 *   the case this set has to cover.
 */
const STRUCTURAL_CONTAINERS = new Set(['Dictionary', 'KeyValuePair']);

/**
 * True if `expr`'s head denotes a COLLECTION — a container whose operands are
 * elements, not the structure of a computation.
 *
 * Derived from the DEFINITION (the `collection` handler block the engine uses
 * to decide collection-ness everywhere else), not from a name list; the
 * literal set above only fills in the two structural containers that have no
 * such block. Deliberately NOT `expr.isCollection`, which is hard-wired to
 * `false` for an invalid expression — the only case that reaches here.
 */
export function isCollectionHead(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (STRUCTURAL_CONTAINERS.has(expr.operator)) return true;
  return expr.baseDefinition?.collection !== undefined;
}

/**
 * Collection heads whose contents are DATA, not the structure of a failing
 * computation. `firstEmbeddedError()` does not descend into them.
 *
 * This is deliberately the rung-2 list, NOT `isCollectionHead()`: it governs
 * descent into an APPLICATION's arguments (`f([1, err])`), a landed contract,
 * whereas `isCollectionHead()` governs the rung-3 rule about a node bubbling
 * its OWN operands. The latter is a superset (it also covers `Take`, `Map`, …,
 * which produce collections); widening the descent set would silently change
 * rung-2 behavior.
 */
const COLLECTION_OPERATORS = new Set([
  'List',
  'Set',
  'Tuple',
  'Dictionary',
  'KeyValuePair',
]);

/**
 * One breadcrumb frame: the error sat in operand `index` (1-based) of an
 * application of `operator`.
 */
export type ErrorFrame = { operator: string; index: number };

/**
 * The error carried by a value, per `docs/LANGUAGE-MODEL.md`:
 *
 * - an `Error`-headed value **is** its own error;
 * - an INVALID value — a frozen tree that *embeds* a validation error, e.g.
 *   the canonical form of `"a" + 1` — yields its **first** embedded `Error`
 *   subexpression;
 * - anything else yields `undefined`.
 *
 * The returned error carries a **breadcrumb** (§2a): the chain of
 * `(operator, operand index)` frames from the failure site outwards, walked
 * here plus the optional `frame` describing the hop that CONSUMED `expr` (the
 * bubbling node itself). Frames already on the error — from an earlier hop —
 * are kept, with the new ones appended (innermost first).
 *
 * **Collections are not descended into.** An error inside a collection
 * literal is an error in one ELEMENT, not a failure of the collection: making
 * `f([1, "a" + 1])` bubble would discard the whole list (and every valid
 * element in it) to report one cell. Such an application freezes as before.
 * An invalid non-collection tree (`Error(…) + 1`) still bubbles its first
 * error. This is why the walk here is a bounded mirror of `.errors`
 * (`getSubexpressions('Error')`, which descends everywhere) rather than a
 * call to it.
 *
 * `isValid` is `false` exactly when a tree contains an `Error` node (only
 * `BoxedFunction` overrides it), so the walk runs only on values already known
 * to carry one, and prunes on it at every level.
 *
 * A leaf module (types + type guards only): `boxed-function.ts`,
 * `function-utils.ts` and `library/core.ts` all need it, and it must sit
 * upstream of `function-utils.ts`.
 */
export function errorValue(
  expr: Expression | undefined | null,
  frame?: ErrorFrame
): Expression | undefined {
  if (!expr || expr.isValid) return undefined;
  const path: ErrorFrame[] = [];
  const err = firstEmbeddedError(expr, path);
  if (err === undefined) return undefined;
  // `path` is collected outermost-first on the way down; the breadcrumb reads
  // innermost (failure site) first.
  path.reverse();
  if (frame !== undefined) path.push(frame);
  return withErrorFrames(err, path);
}

/** The first `Error` node in `expr`, not descending into collection values.
 * `path` accumulates the frames traversed to reach it, outermost first. */
function firstEmbeddedError(
  expr: Expression,
  path: ErrorFrame[]
): Expression | undefined {
  if (isFunction(expr, 'Error')) return expr;
  if (!isFunction(expr) || COLLECTION_OPERATORS.has(expr.operator))
    return undefined;
  const ops = expr.ops;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === undefined || op.isValid) continue;
    path.push({ operator: expr.operator, index: i + 1 });
    const err = firstEmbeddedError(op, path);
    if (err !== undefined) return err;
    path.pop();
  }
  return undefined;
}

//
// ─── Breadcrumb (design §2a) ──────────────────────────────────────────────
//
// `["Error", code, where?, ["ErrorTrace", ["ErrorFrame", "'Add'", 2], …]]`
//
// The trace is the LAST operand and is identified by its `ErrorTrace` HEAD,
// never by position: an `Error` without a breadcrumb keeps its historical
// 1- and 2-operand shape byte for byte. Read `where` with `errorWhere()`.
//

/** The `ErrorTrace` operand of an `Error` value, if it carries one. */
export function errorTrace(
  err: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(err, 'Error')) return undefined;
  const last = err.ops[err.nops - 1];
  return isFunction(last, 'ErrorTrace') ? last : undefined;
}

/** The breadcrumb frames of an `Error` value, innermost (failure site) first. */
export function errorFrames(err: Expression): ErrorFrame[] {
  const trace = errorTrace(err);
  if (trace === undefined) return [];
  const frames: ErrorFrame[] = [];
  for (const f of trace.ops) {
    if (!isFunction(f, 'ErrorFrame')) continue;
    const operator = isString(f.op1) ? f.op1.string : undefined;
    const index = isNumber(f.op2) ? f.op2.re : undefined;
    if (
      operator === undefined ||
      index === undefined ||
      !Number.isFinite(index)
    )
      continue;
    frames.push({ operator, index });
  }
  return frames;
}

/** The `Error` operands that are not the breadcrumb — `[code]` or
 * `[code, where]`, i.e. the historical shape. */
export function errorOpsWithoutTrace(
  err: Expression
): ReadonlyArray<Expression> {
  if (!isFunction(err)) return [];
  const ops = err.ops;
  if (ops.length === 0) return ops;
  const last = ops[ops.length - 1];
  return isFunction(last, 'ErrorTrace') ? ops.slice(0, -1) : ops;
}

/** The context/location operand of an `Error` (`["Error", code, where]`),
 * skipping a breadcrumb that may occupy the same position. */
export function errorWhere(err: Expression): Expression | undefined {
  return errorOpsWithoutTrace(err)[1];
}

/** `err` with `frames` appended to its breadcrumb (a no-op for an empty
 * chain). The historical operands are preserved untouched. */
function withErrorFrames(
  err: Expression,
  frames: ReadonlyArray<ErrorFrame>
): Expression {
  if (frames.length === 0) return err;
  if (!isFunction(err, 'Error')) return err;
  const ce = err.engine;
  const trace = errorTrace(err);
  const items = [
    ...(trace?.ops ?? []),
    ...frames.map((f) =>
      ce._fn('ErrorFrame', [ce.string(f.operator), ce.number(f.index)], {
        canonical: false,
      })
    ),
  ];
  // `Error` holds its operands raw (see `box.ts`), so the trace is built
  // non-canonically — `ErrorTrace`/`ErrorFrame` are pure data heads with no
  // operator definition.
  return ce._fn('Error', [
    ...errorOpsWithoutTrace(err),
    ce._fn('ErrorTrace', items, { canonical: false }),
  ]);
}

//
// ─── Element-wise (broadcast) context ─────────────────────────────────────
//
// A user function with scalar parameters is auto-broadcast over an indexed
// collection argument (the vectorization default). When that fires
// unexpectedly, an element's failure reads as a bare error with no hint that
// a broadcast was in flight. The context is recorded as an extra entry in the
// SAME `ErrorTrace` breadcrumb (§2a):
//
//   ["ErrorBroadcast", "'skipWs'", index, length]
//
// A distinct head — not `ErrorFrame`, whose index means an ARGUMENT position.
// Readers that only understand `ErrorFrame` skip it, so an error that never
// went through a broadcast keeps its historical shape byte for byte.
//

/**
 * One breadcrumb entry recording an ELEMENT-WISE application: the failure
 * happened while `operator` was broadcast over a collection of `length`
 * elements, at 1-based element `index` (collections are 1-indexed).
 */
export type BroadcastFrame = {
  operator: string;
  index: number;
  length: number;
};

/** A human-readable rendering of a broadcast breadcrumb entry. Also used for
 * the message of an error THROWN out of an element evaluation, which never
 * becomes an `Error` value and so cannot carry a breadcrumb. */
export function broadcastContextMessage(
  operator: string,
  length: number | undefined,
  index?: number
): string {
  const over =
    length === undefined
      ? ''
      : ` over ${length} element${length === 1 ? '' : 's'}`;
  const at = index === undefined ? '' : ` (element ${index})`;
  return `while applying '${operator}' element-wise${over}${at}`;
}

/** The broadcast entries of an `Error` value's breadcrumb, outermost
 * broadcast last. Empty for an error that never went through one. */
export function broadcastFrames(err: Expression): BroadcastFrame[] {
  const trace = errorTrace(err);
  if (trace === undefined) return [];
  const frames: BroadcastFrame[] = [];
  for (const f of trace.ops) {
    if (!isFunction(f, 'ErrorBroadcast')) continue;
    const operator = isString(f.op1) ? f.op1.string : undefined;
    const index = isNumber(f.op2) ? f.op2.re : undefined;
    const length = isNumber(f.ops[2]) ? f.ops[2].re : undefined;
    if (
      operator === undefined ||
      !Number.isFinite(index) ||
      !Number.isFinite(length)
    )
      continue;
    frames.push({ operator, index: index!, length: length! });
  }
  return frames;
}

/**
 * `expr` with `frame` recorded on the `Error` value(s) it carries.
 *
 * Only the invalid spine is rebuilt — `isValid` prunes at every level, and a
 * valid `expr` is returned untouched — so a successful element pays nothing
 * beyond the `isValid` test the surrounding `List` performs anyway. As in
 * `firstEmbeddedError()`, collection literals are not descended into: an error
 * in a nested collection belongs to an inner element (and an inner broadcast
 * has already annotated it).
 *
 * The VALUE is unchanged: an error element stays an error element with the
 * same code and `where`; only the breadcrumb grows.
 */
export function withBroadcastFrame(
  expr: Expression,
  frame: BroadcastFrame
): Expression {
  if (expr.isValid) return expr;
  if (isFunction(expr, 'Error')) return withBroadcastTrace(expr, frame);
  if (!isFunction(expr) || COLLECTION_OPERATORS.has(expr.operator)) return expr;
  let changed = false;
  const ops = expr.ops.map((op) => {
    if (op.isValid) return op;
    const rewritten = withBroadcastFrame(op, frame);
    if (rewritten !== op) changed = true;
    return rewritten;
  });
  if (!changed) return expr;
  // Rebuilt non-canonically: this is a frozen invalid tree, and
  // re-canonicalizing it would re-run validation on the error it carries.
  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

/** `err` with a broadcast entry appended to its breadcrumb. */
function withBroadcastTrace(
  err: Expression,
  frame: BroadcastFrame
): Expression {
  const ce = err.engine;
  const trace = errorTrace(err);
  const items = [
    ...(trace?.ops ?? []),
    ce._fn(
      'ErrorBroadcast',
      [
        ce.string(frame.operator),
        ce.number(frame.index),
        ce.number(frame.length),
      ],
      { canonical: false }
    ),
  ];
  return ce._fn('Error', [
    ...errorOpsWithoutTrace(err),
    ce._fn('ErrorTrace', items, { canonical: false }),
  ]);
}
