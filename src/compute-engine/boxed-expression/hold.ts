import type { BoxedExpression } from '../global-types';

import { flattenOps } from './flatten';

/** Apply the function `f` to each operand of the expression `expr`,
 * account for the 'lazy' property of the function definition:
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  expr: BoxedExpression,
  f: (x: BoxedExpression) => BoxedExpression | null
): ReadonlyArray<BoxedExpression> {
  if (!expr.ops) return [];

  let xs = expr.ops;

  const def = expr.functionDefinition;

  if (!def || xs.length === 0) return xs;

  const associativeHead = def?.associative ? def.name : '';

  // f(a, f(b, c), d) -> f(a, b, c, d)
  xs = flattenOps(xs, associativeHead);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: BoxedExpression[] = [];
  for (const x of xs) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' ? x.op1 : x;
      if (op) {
        const y = f(op);
        if (y !== null) result.push(y);
      }
    }
  }
  return flattenOps(result, associativeHead);
}

export async function holdMapAsync(
  expr: BoxedExpression,
  f: (x: BoxedExpression) => Promise<BoxedExpression | null>
): Promise<ReadonlyArray<BoxedExpression>> {
  if (!expr.ops) return [];

  let xs = expr.ops;

  const def = expr.functionDefinition;

  if (!def || xs.length === 0) return xs;

  const associativeHead = def?.associative ? def.name : '';

  // f(a, f(b, c), d) -> f(a, b, c, d)
  xs = flattenOps(xs, associativeHead);

  //
  // Apply the hold as necessary
  //
  if (def.lazy) return xs;

  const result: BoxedExpression[] = [];
  for (const x of xs) {
    const h = x.operator;
    if (h === 'Hold') result.push(x);
    else {
      const op = h === 'ReleaseHold' ? x.op1 : x;
      if (op) {
        const y = await f(op);
        if (y !== null) result.push(y);
      }
    }
  }
  return flattenOps(result, associativeHead);
}
