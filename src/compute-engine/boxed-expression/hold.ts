import type { BoxedExpression } from '../global-types';

import { flatten } from './flatten';
import { isFunction } from './type-guards';

/** Apply the function `f` to each operand of the expression `expr`,
 * account for the 'lazy' property of the operator definition:
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  expr: BoxedExpression,
  f: (x: BoxedExpression) => BoxedExpression | null
): ReadonlyArray<BoxedExpression> {
  if (!isFunction(expr)) return [];

  let xs = expr.ops;

  const def = expr.operatorDefinition;

  if (!def || xs.length === 0) return xs;

  // f(a, f(b, c), d) -> f(a, b, c, d)
  if (def?.associative) xs = flatten(xs, expr.operator, false);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: BoxedExpression[] = [];
  for (const x of xs) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' && isFunction(x) ? x.op1 : x;
      if (op) {
        const y = f(op);
        if (y !== null) result.push(y);
      }
    }
  }
  return def?.associative ? flatten(result, expr.operator, false) : result;
}

export async function holdMapAsync(
  expr: BoxedExpression,
  f: (x: BoxedExpression) => Promise<BoxedExpression | null>
): Promise<ReadonlyArray<BoxedExpression>> {
  if (!isFunction(expr)) return [];

  let xs = expr.ops;

  const def = expr.operatorDefinition;

  if (!def || xs.length === 0) return xs;

  // f(a, f(b, c), d) -> f(a, b, c, d)
  if (def?.associative) xs = flatten(xs, expr.operator, false);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: BoxedExpression[] = [];
  for (const x of xs) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' && isFunction(x) ? x.op1 : x;
      if (op) {
        const y = await f(op);
        if (y !== null) result.push(y);
      }
    }
  }
  return def?.associative ? flatten(result, expr.operator, false) : result;
}
