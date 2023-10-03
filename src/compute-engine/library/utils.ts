import { MAX_ITERATION, asSmallInteger } from '../numerics/numeric';
import { BoxedExpression } from '../public';

export function normalizeLimits(
  range: BoxedExpression
): [index: string, lower: number, upper: number, isFinite: boolean] {
  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index = 'Nothing';
  let isFinite = true;
  if (
    range.head === 'Tuple' ||
    range.head === 'Triple' ||
    range.head === 'Pair' ||
    range.head === 'Single'
  ) {
    index =
      (range.op1.head === 'Hold' ? range.op1.op1.symbol : range.op1.symbol) ??
      'Nothing';
    lower = asSmallInteger(range.op2) ?? 1;

    if (!Number.isFinite(lower)) isFinite = false;

    if (range.op3.isNothing || range.op3.isInfinity) {
      isFinite = false;
    } else {
      const u = asSmallInteger(range.op3);
      if (u === null) isFinite = false;
      else {
        upper = u;
        if (!Number.isFinite(upper)) isFinite = false;
      }
    }
    if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;
  }
  return [index, lower, upper, isFinite];
}
