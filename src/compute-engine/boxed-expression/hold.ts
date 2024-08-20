import type { BoxedExpression, Hold } from './public';

import { flattenOps } from './flatten';

export function shouldHold(skip: Hold, count: number, index: number): boolean {
  if (skip === 'all') return true;

  if (skip === 'none') return false;

  if (skip === 'first') return index === 0;

  if (skip === 'rest') return index !== 0;

  if (skip === 'last') return index === count;

  if (skip === 'most') return index !== count;

  return true;
}

/** Apply the function `f` to each operand of the expression `expr`,
 * account for the 'hold' property of the function definition:
 * - `all`: don't apply f to any elements
 * - `none`: apply `f` to all elements
 * - `first`: apply `f` to all elements except the first
 * - `rest`: apply `f` to the first element, skip the  others
 * - 'last': apply `f` to all elements except the last
 * - 'most': apply `f` to the last elements, skip the others
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
  // @fastpath
  const skip = def?.hold ?? 'none';
  if (skip === 'all') return xs;
  if (skip === 'none') {
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

  const result: BoxedExpression[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].operator === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].operator === 'ReleaseHold') y = xs[i].op1;
      else if (!shouldHold(skip, xs.length - 1, i)) y = xs[i];
      else result.push(xs[i]);

      if (y) {
        const x = f(y);
        if (x !== null) result.push(x);
      }
    }
  }
  return flattenOps(result, associativeHead);
}
