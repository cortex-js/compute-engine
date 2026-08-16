import { anyObjectExists } from './object-deps.js';

import type {
  Expression,
  ExpressionInput,
  DictionaryInterface,
  NumberLiteralInterface,
  SymbolInterface,
  FunctionInterface,
  StringInterface,
  CharacterInterface,
  TensorInterface,
  CollectionInterface,
  IndexedCollectionInterface,
  ObjectInterface,
} from '../global-types.js';
import type { NumericValue } from '../numeric-value/types.js';

function isExpressionImpl(x: unknown): x is Expression {
  const boxed = x as { _kind?: unknown } | null | undefined;
  return (
    boxed !== null &&
    boxed !== undefined &&
    typeof boxed === 'object' &&
    '_kind' in boxed &&
    typeof boxed._kind === 'string'
  );
}

/** Preferred guard for runtime expressions. */
export function isExpression(x: unknown): x is Expression {
  return isExpressionImpl(x);
}

export function isNumber(
  expr: Expression | null | undefined
): expr is Expression & NumberLiteralInterface {
  return expr?._kind === 'number';
}

export function isSymbol(
  expr: Expression | null | undefined,
  name?: string
): expr is Expression & SymbolInterface {
  return (
    expr?._kind === 'symbol' &&
    (name === undefined ||
      (expr as Expression & SymbolInterface).symbol === name)
  );
}

/**
 * True when a value is an absence MARKER — the `Missing` symbol or a `NaN`
 * number — regardless of provenance (I6). This is the value-level test the
 * missing-value runtime gate and chained-`At` absorption use
 * (`docs/plans/2026-07-22-missing-value-typing-design.md`).
 */
export function isAbsentValue(expr: Expression | null | undefined): boolean {
  return isSymbol(expr, 'Missing') || (isNumber(expr) && expr.isNaN === true);
}

export function isFunction(
  expr: Expression | null | undefined,
  operator?: string
): expr is Expression & FunctionInterface {
  return (
    expr?._kind === 'function' &&
    (operator === undefined || expr!.operator === operator)
  );
}

export function isString(
  expr: Expression | null | undefined
): expr is Expression & StringInterface {
  return expr?._kind === 'string';
}

/**
 * Is this expression a **character** — exactly one grapheme cluster?
 *
 * A character is a DISJOINT sibling of a string, not a special case of one:
 * `isString` answers `false` for a character and vice versa. Code that wants
 * "text content, either kind" tests both and reads `.string`, which both
 * interfaces expose.
 */
export function isCharacter(
  expr: Expression | null | undefined
): expr is Expression & CharacterInterface {
  return expr?._kind === 'character';
}

/**
 * The unified tensor guard (§D4.1): a genuine tensor VALUE — a canonical
 * `List` `BoxedFunction` whose (generation-cached) honest type carries a
 * shape claim (`dimensions`). Because the `List` type handler and this guard
 * share one predicate, `isTensor`, `.shape`, `.rank` and `.type` can never
 * disagree. NOT for hot dispatch paths (reads `.type` on first access) —
 * those use `candidateShape` (`tensor-view.ts`).
 */
export function isTensor(
  expr: Expression | null | undefined
): expr is Expression & TensorInterface {
  if (!isFunction(expr, 'List')) return false;
  const t = expr.type.type;
  return (
    typeof t !== 'string' && t.kind === 'list' && t.dimensions !== undefined
  );
}

export function isDictionary(
  expr: Expression | null | undefined
): expr is Expression & DictionaryInterface {
  return expr?._kind === 'dictionary';
}

/**
 * Is this expression an **object** — the engine's mutable value kind?
 *
 * A `_kind` string check, never `instanceof`: plugin bundles re-bundle engine
 * code, so a class-identity check would answer `false` for an object that
 * crossed the host/plugin boundary.
 */
export function isObject(
  expr: Expression | null | undefined
): expr is Expression & ObjectInterface {
  return expr?._kind === 'object';
}

/**
 * Is `expr` an object belonging to a DIFFERENT engine than `ce`?
 *
 * An object belongs to the engine that constructed it: its pinned type, its
 * state events and its cache-dependency records all speak to that engine, so
 * adopting one into another engine's expression would produce a value whose
 * invalidation and typing are wired to the wrong place. Every ingress that
 * adopts a pre-boxed value checks this and rejects with
 * `object-foreign-engine`. The comparison is host reference identity on the
 * engine, which is safe across bundle copies.
 *
 * (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Lifetime": an object cannot be
 * handed to a different engine.)
 */
export function isForeignEngineObject(
  expr: Expression | null | undefined,
  ce: unknown
): boolean {
  return expr?._kind === 'object' && expr.engine !== ce;
}

/**
 * Does `expr` hold — at any depth — an object constructed by an engine other
 * than `ce`?
 *
 * The transitive form of {@link isForeignEngineObject}. A DIRECT check on the
 * adopted expression is not enough, because a pre-boxed container is not
 * itself an object: `ce.box(otherList)` where `otherList` is a `List` holding
 * a foreign object adopts the container whole and smuggles the object in with
 * it. (`docs/plans/2026-08-14-object-representation-decision.md`,
 * "Cross-engine ingress", and invariant 8 in the same note.)
 *
 * The walk stops AT an object — an object's own slots were checked against
 * ITS engine when they were stored, so descending would re-litigate a
 * different engine's invariant — and otherwise descends only into function
 * operands and dictionary values, both finite trees, so it always terminates
 * (a cycle can only run THROUGH an object, which is where it stops).
 *
 * It only inspects already-boxed values. A raw MathJSON container holding a
 * boxed object needs no scan here: every leaf of a raw form is boxed by
 * `boxInternal` (`box.ts`), which applies this same check to it on the way in.
 *
 * Callers MUST gate this behind `anyObjectExists()`: it runs on the
 * per-operand loop of every function boxing, one of the engine's hottest
 * paths, and in a session that has never constructed an object the answer is
 * `false` by construction. {@link adoptsForeignEngineObject} applies that gate
 * for them, which is why it, and not this function, is what ingress points
 * call.
 */
function containsForeignEngineObject(
  expr: ExpressionInput | Expression | null | undefined,
  ce: unknown
): boolean {
  if (expr === null || typeof expr !== 'object') return false;
  const x = expr as Expression;
  // A raw MathJSON array or dictionary literal has no `_kind`; see above for
  // why it needs no scan.
  if (x._kind === undefined) return false;
  if (isObject(x)) return x.engine !== ce;
  if (isFunction(x))
    return x.ops.some((op) => containsForeignEngineObject(op, ce));
  if (isDictionary(x))
    return x.values.some((v) => containsForeignEngineObject(v, ce));
  return false;
}

/**
 * {@link containsForeignEngineObject} over a whole operand list, with the
 * process-wide gate applied ONCE for the list. Every cross-engine ingress
 * point that adopts operands calls this one — the boxing routes, `ce._fn`,
 * `subs()` substitution values and the `ce.assign`/`Assign` route — so neither
 * the gate nor the transitivity is forgotten at a call site.
 *
 * It lives here rather than in `box.ts` so that the assignment routes in
 * `engine-declarations.ts` can call it: `box.ts` reaches
 * `engine-declarations.ts` through `named-arguments.ts` → `multi-clause.ts`,
 * so an import the other way would close a dependency cycle.
 */
export function adoptsForeignEngineObject(
  ops: readonly (ExpressionInput | Expression)[],
  ce: unknown
): boolean {
  if (!anyObjectExists()) return false;
  return ops.some((op) => containsForeignEngineObject(op, ce));
}

export function isCollection(
  expr: Expression | null | undefined
): expr is Expression & CollectionInterface {
  return expr?.isCollection === true;
}

export function isIndexedCollection(
  expr: Expression | null | undefined
): expr is Expression & IndexedCollectionInterface {
  return expr?.isIndexedCollection === true;
}

/**
 * Ellipsis fold barrier predicate.
 *
 * Returns `true` if `expr` is a continuation operand: either the bare
 * `ContinuationPlaceholder` symbol, or a `Negate` whose single operand is it
 * (as produced by parsing `… - \dots`, i.e. a subtraction-spelled ellipsis).
 *
 * An `Add`/`Multiply` carrying such an operand is a notational object (e.g.
 * `1 - 2 + 4 - \dots`) and must be left inert — no folding of the surrounding
 * samples, source order preserved. All fold-barrier sites use this predicate.
 */
export function isContinuationOperand(
  expr: Expression | null | undefined
): boolean {
  if (isSymbol(expr, 'ContinuationPlaceholder')) return true;
  if (isFunction(expr, 'Negate')) {
    const fn = expr as Expression & FunctionInterface;
    return fn.nops === 1 && isSymbol(fn.ops[0], 'ContinuationPlaceholder');
  }
  return false;
}

/**
 * Depth-aware companion to {@link isContinuationOperand}: does `expr` carry a
 * continuation operand anywhere below it, descending through `Multiply` and
 * `Sequence` nesting? A raw (unflattened) product can hold its ellipsis at any
 * depth, e.g. `Multiply(a, Multiply(b, ContinuationPlaceholder))`.
 */
export function containsContinuationOperand(
  expr: Expression | null | undefined
): boolean {
  if (isContinuationOperand(expr)) return true;
  if (isFunction(expr, 'Multiply') || isFunction(expr, 'Sequence'))
    return (expr as Expression & FunctionInterface).ops.some(
      containsContinuationOperand
    );
  return false;
}

/** A nested product that is an ellipsis-fold barrier: do not splice it. */
export function isFoldBarrierProduct(
  expr: Expression | null | undefined
): boolean {
  return isFunction(expr, 'Multiply') && containsContinuationOperand(expr);
}

/**
 * Return the numeric value if `expr` is a number literal, otherwise `undefined`.
 *
 * Convenience helper that combines `isNumber()` with `.numericValue` access.
 */
export function numericValue(
  expr: Expression | null | undefined
): number | NumericValue | undefined {
  return isNumber(expr) ? expr.numericValue : undefined;
}

/**
 * Get the symbol name if `expr` is a symbol expression, otherwise `undefined`.
 *
 * Convenience helper that combines `isSymbol()` with `.symbol` access
 * so callers can write `sym(expr) === 'Pi'` instead of
 * `isSymbol(expr, 'Pi')`.
 */
export function sym(expr: Expression | null | undefined): string | undefined {
  return expr?._kind === 'symbol'
    ? (expr as Expression & SymbolInterface).symbol
    : undefined;
}
