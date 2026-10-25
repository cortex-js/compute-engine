import type { Expression } from '../global-types.js';

import { flatten } from './flatten.js';
import { isFunction, isContinuationOperand } from './type-guards.js';
import { EventLoopPacer } from '../../common/cooperative-steps.js';
import { CancellationError } from '../../common/interruptible.js';

/** Apply the function `f` to each operand of the expression `expr`,
 * account for the 'lazy' property of the operator definition:
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 *
 * The second argument of `f` is the position of the operand in `expr.ops`,
 * the operands as written before any flattening. An operand unwrapped from
 * `ReleaseHold` has the position of the `ReleaseHold` wrapper. An operand
 * lifted out of a nested application of an associative operator, or out of
 * a `Sequence`, has the position `-1`: it does not occupy a position of
 * `expr.ops` by itself. The operand objects cannot give the position (with
 * `indexOf`), because the same interned object (a symbol, a small integer)
 * can occur at more than one position.
 */
export function holdMap(
  expr: Expression,
  f: (x: Expression, index: number) => Expression | null
): ReadonlyArray<Expression> {
  if (!isFunction(expr)) return [];

  let xs = expr.ops;

  const def = expr.operatorDefinition;

  if (!def || xs.length === 0) return xs;

  // f(a, f(b, c), d) -> f(a, b, c, d)
  // Ellipsis fold barrier: a `ContinuationPlaceholder` operand marks a
  // notational sum/product; do not lift nested associative operands (it would
  // tear a coefficient out of an anchor like the `2n` in `Multiply(2, n)`).
  const hasContinuation = xs.some((x) => isContinuationOperand(x));
  let positions: ReadonlyArray<number> | undefined;
  if (def?.associative && !hasContinuation)
    [xs, positions] = flattenWithPositions(xs, expr.operator);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: Expression[] = [];
  for (const [k, x] of xs.entries()) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' && isFunction(x) ? x.op1 : x;
      if (op) {
        const y = f(op, positions?.[k] ?? k);
        if (y !== null) result.push(y);
      }
    }
  }
  return def?.associative && !hasContinuation
    ? flatten(result, expr.operator, false)
    : result;
}

/** The asynchronous twin of `holdMap()`. The second argument of `f` is the
 * position of the operand in `expr.ops`, as for `holdMap()`.
 *
 * An `await` of `f` gives a turn to the microtasks only: the event loop
 * runs no timer, no input and no rendering until the walk ends. So, when
 * about 8 ms passed since the walk started or since the last turn, the
 * walk waits for a macrotask (`EventLoopPacer`) before the next operand.
 * After that wait, an aborted `signal` stops the walk with a
 * `CancellationError` whose `cause` is the reason of the signal. A
 * `Tuple` or another operator that is not lazy with many slow operands
 * then lets a timer run, and an abort that a timer makes is seen within a
 * slice. */
export async function holdMapAsync(
  expr: Expression,
  f: (x: Expression, index: number) => Promise<Expression | null>,
  signal?: AbortSignal
): Promise<ReadonlyArray<Expression>> {
  if (!isFunction(expr)) return [];

  let xs = expr.ops;

  const def = expr.operatorDefinition;

  if (!def || xs.length === 0) return xs;

  // f(a, f(b, c), d) -> f(a, b, c, d)
  // Ellipsis fold barrier (see `holdMap`): a `ContinuationPlaceholder` operand
  // marks a notational sum/product; keep nested associative anchors intact.
  const hasContinuation = xs.some((x) => isContinuationOperand(x));
  let positions: ReadonlyArray<number> | undefined;
  if (def?.associative && !hasContinuation)
    [xs, positions] = flattenWithPositions(xs, expr.operator);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: Expression[] = [];
  const pacer = new EventLoopPacer();
  for (const [k, x] of xs.entries()) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' && isFunction(x) ? x.op1 : x;
      if (op) {
        const y = await f(op, positions?.[k] ?? k);
        if (y !== null) result.push(y);
      }
    }
    if (pacer.due) {
      await pacer.pace();
      if (signal?.aborted)
        throw new CancellationError({ cause: signal.reason });
    }
  }
  return def?.associative && !hasContinuation
    ? flatten(result, expr.operator, false)
    : result;
}

/**
 * `flatten(xs, operator, false)`, and for each resulting operand its
 * position in `xs`: the index of an operand that is kept as it is, and `-1`
 * for an operand lifted out of a nested `operator` application or a
 * `Sequence` (or the skipped `Nothing`, which has no result operand).
 * `flatten` treats each operand by itself, so flattening the operands one
 * by one gives the same list as flattening them all at once.
 */
function flattenWithPositions(
  xs: ReadonlyArray<Expression>,
  operator: string
): [ReadonlyArray<Expression>, ReadonlyArray<number> | undefined] {
  const flat = flatten(xs, operator, false);
  // Nothing to flatten: the positions are the indexes.
  if (flat === xs) return [xs, undefined];
  const ys: Expression[] = [];
  const positions: number[] = [];
  for (const [i, x] of xs.entries()) {
    const parts = flatten([x], operator, false);
    const kept = parts.length === 1 && parts[0] === x;
    for (const y of parts) {
      ys.push(y);
      positions.push(kept ? i : -1);
    }
  }
  return [ys, positions];
}
