import type { Expression, EvaluateOptions } from '../global-types.js';
import { isDictionary, isFunction, isSymbol } from './type-guards.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';

/**
 * Await the ASYNCHRONOUS-ONLY descendants of a lazy operator's held operands
 * before its synchronous handler runs — for an operator that demands every
 * held operand (the caller, in `boxed-function.ts`, keeps a selecting,
 * scoping or quoting operator away from this pass).
 *
 * A lazy operator's handler receives its operands unevaluated and evaluates
 * them itself, synchronously: a comparison compares `op.evaluate()`.
 * `evaluate()` cannot run an operator that has only an `evaluateAsync`
 * handler — a user-declared asynchronous operator — so such a descendant
 * stayed unevaluated inside the held operand, and
 * `Less(15, AsyncOnly(2)).evaluateAsync()` answered `15 < AsyncOnly(2)`. The
 * asynchronous route calls this first: every asynchronous-only application
 * inside a held operand is awaited, in operand order, and the operand is
 * rebuilt with the values in place, so the handler finds them already
 * evaluated. A node with no such descendant is returned as it is (the same
 * object) and its operand list is not copied, so a walk that changes nothing
 * costs the visit and no allocation.
 *
 * A node whose operator SELECTS among its held operands (`If`, `Which`, a
 * short-circuit connective) is not entered — its unselected arm must not
 * run — but it is awaited WHOLE through its own asynchronous handler, which
 * honors the selection, so an asynchronous-only application in the arm it
 * does take is still awaited; a selecting operator without an asynchronous
 * handler is left as it is. Two kinds of node are not entered at all: a
 * SCOPED operator (`Sum`, a comprehension, a function literal, a block),
 * which owns the evaluation of its body, where a bound index may still be
 * free; and an operator that QUOTES its operand, which holds it as data. An
 * asynchronous-only application under either stays for that operator to
 * handle. One exception: a `ReleaseHold` whose operand is a `Hold` evaluates
 * the held expression, so when that expression holds an asynchronous-only
 * application, the `ReleaseHold` is awaited whole.
 */
export async function awaitAsyncOnlyDescendants(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<ReadonlyArray<Expression>> {
  const result = await awaitAsyncOnlyInEach(ops, options);
  return result ?? ops;
}

/** The operands with their asynchronous-only descendants awaited, or
 * `undefined` when none changed (no copy is made then). */
async function awaitAsyncOnlyInEach(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression[] | undefined> {
  let result: Expression[] | undefined;
  for (let i = 0; i < ops.length; i++) {
    const awaited = await awaitAsyncOnlyIn(ops[i], options);
    if (awaited !== ops[i] && result === undefined) result = ops.slice(0, i);
    if (result !== undefined) result.push(awaited);
  }
  return result;
}

async function awaitAsyncOnlyIn(
  x: Expression,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  if (!isFunction(x)) return x;
  const def = x.operatorDefinition;
  if (def !== undefined) {
    if (def.evaluateAsync !== undefined && def.evaluate === undefined)
      return x.evaluateAsync(options);
    if (def.selectsOperands)
      return def.evaluateAsync !== undefined ? x.evaluateAsync(options) : x;
    if (def.scoped || def.holdClass === 'quote') return x;
  }
  // `ReleaseHold(Hold(y))` evaluates `y`, which the walk does not enter
  // (`Hold` quotes it). When `y` holds an asynchronous-only application,
  // the `ReleaseHold` is awaited whole through its asynchronous handler.
  if (
    x.operator === 'ReleaseHold' &&
    isFunction(x.op1, 'Hold') &&
    containsAsyncOnly(x.op1.op1, true)
  )
    return x.evaluateAsync(options);
  const ops = await awaitAsyncOnlyInEach(x.ops, options);
  if (ops === undefined) return x;
  // A value-safe rebuild: the values stand where the applications stood, as
  // they would after the handler evaluated the operand itself.
  return x.engine.withEvaluationContext(options, () =>
    x.engine.function(x.operator, ops)
  );
}

/**
 * Whether `x` contains an application of an ASYNCHRONOUS-ONLY operator (one
 * with an `evaluateAsync` handler and no `evaluate` handler), at any depth
 * except under an operator that QUOTES its operand, which holds it as data.
 * One quoted operand is looked into: the operand of a `Hold` that is the
 * operand of a `ReleaseHold`, because the `ReleaseHold` evaluates it.
 * An engine that has never declared such an operator answers `false` at
 * once. The scoped operators that own the evaluation of their body (`Sum`,
 * `Product`, `Block`) ask this before taking their asynchronous per-term
 * route, so the synchronous fold stays the common path.
 */
export function hasAsyncOnlyApplication(
  x: Expression,
  includeSymbolCallbacks = false
): boolean {
  if (!x.engine._hasAsyncOnlyOperator) return false;
  return containsAsyncOnly(x, false, includeSymbolCallbacks);
}

/**
 * Whether the evaluation of `x`, or of a callback in it, applies an operator
 * that has only an `evaluateAsync` handler. As {@link hasAsyncOnlyApplication},
 * this finds the applications (`slowF(1)`) and the helpers whose bodies hold
 * one. A symbol that names such an operator counts too, except at a position
 * known to hold DATA, where its value is never applied:
 * - `x` itself: the value of a view or of an inner result is its elements;
 * - an operand of `List`, `Tuple` or `Set`, and a value of a dictionary,
 *   when that constructor is itself at a data position;
 * - the branches of an `If` and the last statement of a `Block` at a data
 *   position: their value is the value of the `If` or the `Block`;
 * - the body of a function literal at a data position (the function is not
 *   applied there), and the body of the callback of a `FlatMap` at a data
 *   position: the callback result is spliced into the elements of the view.
 * At every other position (an operand of `Map`, `Sort`, `Tabulate`,
 * `Iterate`, `Apply`, `First`, ...), an operator can apply the symbol, or
 * give it to an operator that applies it, so the symbol counts. So
 * `FlatMap([1, 2], x ↦ [x, slowF])` gives `slowF` as data, but
 * `FlatMap([1, 2], x ↦ Sort([x, 3], slowLess))` applies `slowLess`. A
 * symbol at a position that is not in the list above counts as applied,
 * also where its value is data, so the check can decline without need.
 *
 * The callback of a `FlatMap` at a data position is applied: a symbol there
 * counts when its own definition is asynchronous only, and its body (a user
 * function `f(x) := [x, slowF]`) is examined by the same rule, with the
 * result position as data. The value of a symbol (`alias := slowF`) is
 * examined at the position of the symbol.
 */
export function appliesAsyncOnlyOperator(x: Expression): boolean {
  if (!x.engine._hasAsyncOnlyOperator) return false;
  return containsAsyncOnly(x, false, false, true);
}

/**
 * Whether the emptiness of the view `x` can depend on an operator that has
 * only an `evaluateAsync` handler, for a walk that stops at the first
 * element of `x` (`finiteUncountedIsEmpty()`, `collection-utils.ts`). The
 * rule is the one of {@link appliesAsyncOnlyOperator}, with one more data
 * position: a `Map` at a data position has as many elements as its source,
 * whatever its callback gives, so its callback is not examined, and its
 * source is at a data position. So the emptiness of
 * `FlatMap([1, 2], x ↦ Map(slowF, Range(1, x)))` is decided by the walk
 * (the view is not empty), although its elements are known only when
 * `slowF` is awaited. The `isEmpty` facet of `Map` reads its source in the
 * same way.
 */
export function emptinessAppliesAsyncOnlyOperator(x: Expression): boolean {
  if (!x.engine._hasAsyncOnlyOperator) return false;
  return containsAsyncOnly(x, false, false, true, true);
}

/** The operators whose operands keep the position of the operator: an
 * operand at a data position is data. */
const DATA_CONSTRUCTORS = new Set(['List', 'Tuple', 'Set']);

/**
 * `held` is `true` inside the operand of a released `Hold`. That operand is
 * not bound, so its applications carry no operator definition: the
 * definition is then looked up by name in the current scope.
 *
 * With `dataPositions` (see {@link appliesAsyncOnlyOperator}), a symbol
 * counts except at a data position; `includeSymbolCallbacks` is then not
 * read.
 */
function containsAsyncOnly(
  x: Expression,
  held = false,
  includeSymbolCallbacks = false,
  dataPositions = false,
  emptinessOnly = false
): boolean {
  // A released quote can reach the same raw node as an ordinary operand,
  // so keep those two resolution contexts separate. Shared nodes and
  // recursive helper definitions are each examined once per context.
  // With `dataPositions`, the same node can be at a data position at one
  // place and at another position elsewhere, and the body of a callback can
  // be a data position or not, so these are two more contexts.
  const seen = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Set<Expression>());
  // `data`: the value of `e` is data (see `appliesAsyncOnlyOperator()`).
  // `bodyIsData`: `e` is the callback of a `FlatMap` at a data position, so
  // the result position of its body is data.
  const visit = (
    e: Expression,
    inHeld: boolean,
    data = false,
    bodyIsData = false
  ): boolean => {
    const visited =
      seen[(inHeld ? 1 : 0) + (data ? 2 : 0) + (bodyIsData ? 4 : 0)];
    if (visited.has(e)) return false;
    visited.add(e);
    if (isDictionary(e))
      return e.values.some((v) => visit(v, inHeld, dataPositions && data));
    if (!isFunction(e) && !isSymbol(e)) return false;
    const name = isSymbol(e) ? e.symbol : e.operator;
    const symbolCounts =
      isSymbol(e) && (dataPositions ? !data : includeSymbolCallbacks);
    const binding =
      e.baseDefinition === undefined && (inHeld || symbolCounts)
        ? e.engine.lookupDefinition(name)
        : undefined;
    const def =
      e.operatorDefinition ??
      (isOperatorDef(binding) ? binding.operator : undefined);
    if (def !== undefined) {
      if (
        (isFunction(e) || symbolCounts) &&
        def.evaluateAsync !== undefined &&
        def.evaluate === undefined
      )
        return true;
      if (def.holdClass === 'quote') return false;
    }
    // A helper application can hide the only asynchronous application in
    // its body. Follow callable values and operator literals transitively.
    // The body of the callback of a `FlatMap` at a data position has its
    // result at a data position: a function literal is visited with
    // `bodyIsData`, and a bare body at a data position. This holds only when
    // `e` is a symbol: its definition is the callback. When `e` is an
    // application at the callback position (`mk(0)`, with
    // `mk := n ↦ slowEmpty`), the body of its definition computes the
    // callback, which can be applied, so the body has no data position.
    const calleeBodyIsData = bodyIsData && isSymbol(e);
    const valueDef =
      e.valueDefinition ?? (isValueDef(binding) ? binding.value : undefined);
    if (def?._lambdaLiteral !== undefined) {
      if (visit(def._lambdaLiteral, false, false, calleeBodyIsData))
        return true;
    } else if (def?.lambda?.body !== undefined) {
      if (visit(def.lambda.body, false, calleeBodyIsData)) return true;
    }
    // A multi-clause user function has no single body: its definition
    // selects one of the function literals of its clauses at each call, so
    // each of these literals is examined. The clause records are under the
    // key that `multi-clause.ts` stores them at. That module imports
    // `boxed-function.ts`, which imports this one, so the records are read
    // structurally here, as `appliesLiteral()` (`function-utils.ts`) does.
    const clauses = (
      def as
        | {
            _multiClauseFunction?: {
              clauses?: ReadonlyArray<{ literal: Expression }>;
            };
          }
        | undefined
    )?._multiClauseFunction?.clauses;
    if (clauses?.some((c) => visit(c.literal, false, false, calleeBodyIsData)))
      return true;
    // The value of a symbol is examined at the position of the symbol: an
    // alias `alias := slowF` at a callback position is applied. The value
    // of the operator of an application (`mk` in `mk(0)`) is the function
    // that the application calls, not the value of the application: it has
    // no data position.
    if (
      valueDef?.value !== undefined &&
      (isSymbol(e)
        ? visit(valueDef.value, false, data, bodyIsData)
        : visit(valueDef.value, false))
    )
      return true;
    if (!isFunction(e) || e._numericStore !== undefined) return false;
    if (e.operator === 'ReleaseHold' && isFunction(e.op1, 'Hold'))
      return visit(e.op1.op1, true);
    if (dataPositions) {
      // See `emptinessAppliesAsyncOnlyOperator()`: the callback of a `Map`
      // at a data position does not change the count of the `Map`.
      // The shortcut holds when the callback is a function literal or a
      // symbol. Another callback expression (`mk(0)`) is evaluated to find
      // the function, so it is visited at a position that is not data.
      if (emptinessOnly && data && e.operator === 'Map' && e.nops === 2) {
        const callback = e.op1;
        if (!isFunction(callback, 'Function') && !isSymbol(callback)) {
          if (visit(callback, inHeld)) return true;
        }
        return visit(e.op2, inHeld, true);
      }
      return e.ops.some((op, i) =>
        visit(op, inHeld, ...operandPosition(e, i, data, bodyIsData))
      );
    }
    return e.ops.some((op) => visit(op, inHeld));
  };
  return visit(x, held, dataPositions);
}

/** The `data` and `bodyIsData` flags of the operand `i` of `e` (see
 * `containsAsyncOnly()`), when `e` is at a data position (`data`), or is the
 * callback of a `FlatMap` at a data position (`bodyIsData`). */
function operandPosition(
  e: Expression,
  i: number,
  data: boolean,
  bodyIsData: boolean
): [boolean, boolean] {
  if (!isFunction(e)) return [false, false];
  const op = e.operator;
  // The body of a function literal: its result is the callback result of
  // the `FlatMap`, or the function is data and its body is not applied.
  if (op === 'Function') return [i === 0 && (data || bodyIsData), false];
  if (!data) return [false, false];
  if (DATA_CONSTRUCTORS.has(op)) return [true, false];
  if (op === 'If') return [i > 0, false];
  if (op === 'Block') return [i === e.nops - 1, false];
  // The callback of a `FlatMap` is applied, and its result is data.
  if (op === 'FlatMap' && i === 1) return [false, true];
  return [false, false];
}
