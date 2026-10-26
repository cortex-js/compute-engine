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
 * Is this expression one of the two SYMBOLS that stand for an absent value —
 * `Missing` or `Undefined`?
 *
 * `Missing` is the position-preserving absent datum of `docs/ERROR-MODEL.md`
 * §1. `Undefined` is the symbol the engine writes for a value that does not
 * exist, and a user can write it directly. The two names are read as the same
 * absence everywhere the engine tests for one (user rulings of 2026-09-21 for
 * the numeric absence gate, 2026-09-22 for the operators that own their
 * absence semantics). `Undefined` keeps its own meaning otherwise: its
 * declared type is still `unknown`, and a bare `Undefined` evaluates to
 * itself.
 *
 * This is the single choke point both absence tests share: `isAbsentValue`
 * below, which adds a `NaN` arm on top of it, and `isAbsentScalarSymbol`
 * (`boxed-expression/validate.ts`), which is this predicate under the name
 * the numeric absence gate reads it by — that gate deliberately has no `NaN`
 * arm, because a `NaN` operand already propagates through numeric evaluation
 * natively and some operators give a literal `NaN` a bespoke meaning.
 */
export function isAbsentSymbol(expr: Expression | null | undefined): boolean {
  return isSymbol(expr, 'Missing') || isSymbol(expr, 'Undefined');
}

/**
 * True when `expr` is an absence symbol (`Missing` or `Undefined`), or an
 * arithmetic node that the arithmetic methods build around one: a `Negate`,
 * `Multiply`, `Divide` or `Power` with such an operand, at any depth
 * (`-Missing`, `2·Missing`, `1/Missing`, `Missing^2`).
 *
 * Arithmetic with an absent operand is `NaN` (user decision of 2026-09-25).
 * The `.add()`/`.mul()`/`.div()` methods read such an operand as `NaN` through
 * this test, as the `Add`/`Multiply`/`Divide` operators do at evaluation.
 * Before, the methods kept the symbol: `ce.box('Missing').mul(ce.box(2))`
 * was `2·"Missing"` while `Multiply(2, Missing)` evaluated to `NaN`.
 */
export function isAbsentArithmeticOperand(
  expr: Expression | null | undefined
): boolean {
  if (isAbsentSymbol(expr)) return true;
  if (!isFunction(expr)) return false;
  const h = expr.operator;
  if (h !== 'Negate' && h !== 'Multiply' && h !== 'Divide' && h !== 'Power')
    return false;
  return expr.ops.some((x) => isAbsentArithmeticOperand(x));
}

/**
 * True when a value is an absence MARKER — an absence symbol (`Missing` or
 * `Undefined`) or a `NaN` number — regardless of provenance (I6). This is the
 * value-level test the missing-value runtime gate and chained-`At` absorption
 * use (`docs/TYPE-SYSTEM.md`).
 *
 * It is also the test the operators that OWN their absence semantics run —
 * the ones declared `missingBehavior: 'handle'`, such as the statistics
 * reducers and `Min`/`Max`. `Mean([1, Undefined, 3])` is `NaN` exactly as
 * `Mean([1, Missing, 3])` is.
 *
 * The `Indeterminate` literal is NOT absent, although its value is `NaN`: it
 * is the exact answer to an indeterminate form (`0/0`), a value with no
 * number, not a missing entry. The reducers above forward it
 * (`Mean([1, Indeterminate])` is `Indeterminate`, see `nanOperandAnswer()`).
 * Explicit absence checks and fallbacks instead use `isMissingValue`,
 * which handles both numeric markers.
 */
export function isAbsentValue(expr: Expression | null | undefined): boolean {
  return (
    isAbsentSymbol(expr) ||
    (isNumber(expr) && expr.isNaN === true && !expr.isIndeterminate)
  );
}

/**
 * Absence handled by `IsMissing` and `Coalesce`. Both numeric markers count
 * as absent here; arithmetic consumers keep their distinct propagation rules.
 * `Nothing` is an omission marker and passes through these operations.
 */
export function isMissingValue(expr: Expression | null | undefined): boolean {
  return isAbsentSymbol(expr) || (isNumber(expr) && expr.isNaN === true);
}

/**
 * Does the operand make a numeric result inexact: the `NaN` literal, or a
 * finite float (a machine or big-decimal number that is not exact)? The
 * `Indeterminate` literal is not inexact (it is the answer of an exact
 * computation), and neither is an exact number or an infinity.
 *
 * This is the test of the rule that a float operand makes a numeric result a
 * float (user decision of 2026-09-27), applied to `Indeterminate`: an
 * operation with an `Indeterminate` operand answers `Indeterminate` only when
 * no operand is inexact, and `NaN` otherwise (`Indeterminate + 1.5` is
 * `NaN`).
 */
export function isInexactOperand(x: Expression): boolean {
  // A `Measurement(v, σ)` is as inexact as its nominal `v`: a measurement
  // with a float nominal is a float datum, so `Max(Measurement(1.5, 0.1),
  // Indeterminate)` is `NaN`, as `Max(1.5, Indeterminate)` is.
  if (isFunction(x, 'Measurement')) return isInexactOperand(x.op1);
  // A `Quantity` is as inexact as its magnitude: `Max(Quantity(1.5, m),
  // Indeterminate)` is `NaN`, as `Max(1.5, Indeterminate)` is.
  if (isFunction(x, 'Quantity')) return isInexactOperand(x.op1);
  if (!isNumber(x) || x.isIndeterminate) return false;
  if (x.isNaN === true) return true;
  return x.isFinite === true && !x.isExact;
}

/**
 * The answer of an operation that has at least one operand whose value is
 * `NaN` and that propagates it (the `propagate` policy of the evaluation
 * gate, the `Add`/`Multiply` folds, the reducers `Max`, `Min`, `Mean` and
 * the others): `Indeterminate` when an operand is the `Indeterminate` literal
 * and no operand is inexact (`isInexactOperand()`: the `NaN` literal or a
 * float), and `NaN` otherwise. So `Sqrt(Indeterminate)` and
 * `Max(1, Indeterminate)` are `Indeterminate`, `Max(Indeterminate, NaN)` and
 * `Arctan2(Indeterminate, 1.5)` are `NaN`.
 *
 * Provenance: `docs/plans/2026-09-28-indeterminate-value.md` §4.
 */
export function nanOperandAnswer(
  ce: Expression['engine'],
  ops: ReadonlyArray<Expression>
): Expression {
  let sawIndeterminate = false;
  for (let x of ops) {
    // A `Measurement(v, σ)` answers as its nominal `v` does
    // (`isInexactOperand()`).
    if (isFunction(x, 'Measurement')) x = x.op1;
    if (isNumber(x)) {
      if (x.isIndeterminate) sawIndeterminate = true;
      else if (isInexactOperand(x)) return ce.NaN;
    } else if (isSymbol(x) && (isAbsentSymbol(x) || x.isNaN === true)) {
      // An absent operand (`Missing`, `Undefined`) makes the answer `NaN`,
      // the absence marker; so does a symbol whose value is `NaN`, which
      // is not the `Indeterminate` literal. (A function operand is not
      // asked: the question would compute its type, and a function
      // expression never answers `isNaN === true`.)
      return ce.NaN;
    }
  }
  return sawIndeterminate ? ce.Indeterminate : ce.NaN;
}

/**
 * The answer of an exact indeterminate form, such as `0/0`, `0·∞`, `∞ − ∞`,
 * `0^0` or `Mod(5, 0)`: an operation whose operands have values but whose
 * result has none. The answer is `Indeterminate` when every operand is exact
 * (an exact number, an infinity, or `Indeterminate` itself), and `NaN` when
 * any operand is inexact (`isInexactOperand()`: a float or the `NaN`
 * literal), absent (`Missing`, `Undefined`) or a symbol whose value is
 * `NaN`. So `0/0` is `Indeterminate`, and `0/0.0` and `0.0·∞` are `NaN`, as a
 * float operand makes a numeric result a float.
 *
 * `ops` are the operands of the form, not the arguments of the whole
 * expression. A caller must use this only where the form has no value: a
 * pole (`5/0` is `~oo`), a value outside the domain of a function, or a
 * failure of a numeric kernel stays `NaN`.
 *
 * Provenance: `docs/plans/2026-09-28-indeterminate-value.md` §6, Phase 2.
 */
export function indeterminateFormAnswer(
  ce: Expression['engine'],
  ops: ReadonlyArray<Expression>
): Expression {
  for (const x of ops) {
    if (isNumber(x)) {
      if (isInexactOperand(x)) return ce.NaN;
    } else if (isSymbol(x) && (isAbsentSymbol(x) || x.isNaN === true)) {
      return ce.NaN;
    }
  }
  return ce.Indeterminate;
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

/**
 * Are these the operands of a `Set` whose ORDER is not significant?
 *
 * The elements of a set are not ordered, so `isSame` compares two set
 * literals as multisets of elements (`Set(2, 1)` is the same as `Set(1, 2)`)
 * and `hash` combines their hashes with an order-independent operation. The
 * two must use this one test, so that two sets that `isSame` accepts always
 * hash alike.
 *
 * A set-builder (a comprehension) is not a literal set: its two operands are
 * a body and an indexing set (`Set(2k, Element(k, S))`,
 * `Set(Element(k, S), Condition(p))`), and their positions give them their
 * meaning. Any two-operand `Set` with an `Element` or a `Condition` operand
 * is therefore compared by position. This test is wider than the
 * comprehension test of the `Set` operator (a literal `{x, k ∈ S}` is
 * compared by position too), but it reads only the operator names of the
 * operands, so two sets with the same elements always give the same answer.
 *
 * A set with an ellipsis (a `ContinuationPlaceholder` element, from
 * `\{a_1, a_2, \dots, a_n\}`) is a notation for a progression: the ellipsis
 * stands between the elements around it, so their positions carry meaning
 * too, and the set is compared by position.
 *
 * The canonical `Set` handler sorts the elements of a set only when this
 * test is `true`.
 */
export function isUnorderedSet(
  operator: string,
  ops: ReadonlyArray<Expression>
): boolean {
  if (operator !== 'Set') return false;
  if (ops.length < 2) return false;
  if (ops.some((op) => isContinuationOperand(op))) return false;
  if (ops.length > 2) return true;
  return !ops.some(
    (op) => isFunction(op, 'Element') || isFunction(op, 'Condition')
  );
}

/**
 * The largest element count of a `Range` that `isSame` and `hash` compare by
 * its elements (see `integerRangeElements`). It is a constant, not an engine
 * setting: a hash is cached on the expression, and a limit that changes later
 * would make a cached hash disagree with `isSame`.
 */
export const MAX_RANGE_IDENTITY_COUNT = 10_000;

/**
 * If `expr` is a finite `Range` of integers, return its first element, its
 * step and its element count. Otherwise return `undefined`.
 *
 * The range must have one, two or three operands, each a number literal with
 * a safe integer value, a step that is not zero, and at most
 * `MAX_RANGE_IDENTITY_COUNT` elements. One operand `n` is read as
 * `Range(1, n)`, which is its canonical form; a raw or structural `Range(n)`
 * keeps the one operand. With no step operand, the step is `1` when the
 * upper bound is not less than the lower bound and `-1` otherwise, as for
 * the `Range` operator: `Range(0)` is the descending range `[1, 0]`.
 *
 * Such a range and the `List` literal of its integers are the same element
 * for `isSame` and have the same `hash`: `Range(1, 3)`, `Range(1, 3, 1)` and
 * `[1, 2, 3]` are the same, so a set does not hold two of them, and
 * `[1, 2, 3]` is an element of `[Range(1, 3)]`. An empty range, such as
 * `Range(5, 1, 1)`, is the same as `[]`. The same rule applies to a
 * character and a one-cluster string with the same content. The limit on the
 * count keeps `isSame` and `hash` from reading the elements of a very large
 * range: a larger range is compared by its operands only.
 * (User decision 2026-10-25, option A, which follows the decision that a
 * `Range` element of a collection literal stays a `Range`, ROADMAP CE-39.3.)
 */
export function integerRangeElements(
  expr: Expression
): { start: number; step: number; count: number } | undefined {
  if (!isFunction(expr, 'Range')) return undefined;
  const nops = expr.nops;
  if (nops < 1 || nops > 3) return undefined;
  const read = (op: Expression): number | undefined => {
    if (!isNumber(op) || op.im !== 0 || !op.isInteger) return undefined;
    const v = op.re;
    return Number.isSafeInteger(v) ? v : undefined;
  };
  const start = nops === 1 ? 1 : read(expr.op1);
  const end = read(nops === 1 ? expr.op1 : expr.op2);
  if (start === undefined || end === undefined) return undefined;
  const step = nops === 3 ? read(expr.op3) : end >= start ? 1 : -1;
  if (step === undefined || step === 0) return undefined;
  // The span and the quotient are computed with `bigint`: the difference of
  // two safe integers is not always a safe integer, and a rounded span can
  // give one element too many. Each element `start + k * step` with
  // `k < count` is between `start` and `end`, so it is a safe integer, and a
  // reader that adds `step` to the previous element gets its exact value.
  const span =
    step > 0 ? BigInt(end) - BigInt(start) : BigInt(start) - BigInt(end);
  if (span < 0n) return { start, step, count: 0 };
  const count = span / BigInt(Math.abs(step)) + 1n;
  if (count > BigInt(MAX_RANGE_IDENTITY_COUNT)) return undefined;
  return { start, step, count: Number(count) };
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
  // A shape claim is a dimension list. A `List` value is typed from its
  // cells, so it never carries the `null` dimensions of a tensor of unknown
  // rank; that spelling is a declared type, and it makes no shape claim.
  return typeof t !== 'string' && t.kind === 'list' && !!t.dimensions;
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
 * it. (`docs/TYPE-SYSTEM.md`,
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
  ce: unknown,
  memo: Map<Expression, boolean>
): boolean {
  // A node settles without a visit to its children when it is not boxed
  // (raw MathJSON has no `_kind` and cannot contain boxed objects owned by
  // another engine), when it is already in the memo, when it is an object,
  // or when it is neither a function nor a dictionary.
  //
  // The memo (one per adoption — see the caller) is what keeps this walk
  // linear in DISTINCT nodes: an operand referenced more than once (a
  // function applied to its own previous result shares its subtrees) would
  // otherwise be re-scanned once per path, and this guard runs on every
  // function boxing — constructing a depth-n shared tree cost 2^n scans.
  const settle = (x: ExpressionInput | Expression | null | undefined) => {
    if (x === null || typeof x !== 'object') return false;
    const e = x as Expression;
    if (e._kind === undefined) return false;
    const cached = memo.get(e);
    if (cached !== undefined) return cached;
    if (isObject(e)) {
      const result = e.engine !== ce;
      memo.set(e, result);
      return result;
    }
    if (isFunction(e) || isDictionary(e)) return undefined;
    memo.set(e, false);
    return false;
  };

  const first = settle(expr);
  if (first !== undefined) return first;

  // The walk uses an explicit work stack, not recursion, so that the depth of
  // the tree does not limit it: a tree a few thousand levels deep (which
  // boxing can build, see `boxOperands` in `box.ts`) would otherwise exhaust
  // the JS call stack here. Each frame holds a node and the index of the next
  // child to examine. The children are examined in order and the walk stops
  // at the first one that holds a foreign object, as `Array.some` would.
  type Frame = { node: Expression; children: readonly Expression[]; i: number };
  const frame = (node: Expression): Frame => ({
    node,
    children: isFunction(node)
      ? node.ops
      : isDictionary(node)
        ? node.values
        : [],
    i: 0,
  });
  const stack: Frame[] = [frame(expr as Expression)];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    let result: boolean | undefined = false;
    let descended = false;
    while (top.i < top.children.length) {
      const child = top.children[top.i];
      const r = settle(child);
      if (r === undefined) {
        stack.push(frame(child));
        descended = true;
        break;
      }
      if (r) {
        result = true;
        break;
      }
      top.i += 1;
    }
    if (descended) continue;
    memo.set(top.node, result);
    stack.pop();
  }
  return memo.get(expr as Expression)!;
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
  const memo = new Map<Expression, boolean>();
  return ops.some((op) => containsForeignEngineObject(op, ce, memo));
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
 * A product with a direct `ContinuationPlaceholder` operand, such as
 * `2 · 4 · … · 2n`. Such a product is a notation, not an arithmetic value:
 * its operands must not be lifted into an enclosing product, and no factor of
 * the enclosing product must be folded into it.
 */
export function isNotationalProduct(
  expr: Expression | null | undefined
): boolean {
  return (
    isFunction(expr, 'Multiply') &&
    expr.ops.some((x) => isContinuationOperand(x))
  );
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
