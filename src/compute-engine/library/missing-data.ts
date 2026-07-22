import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isSymbol } from '../boxed-expression/type-guards.js';

/**
 * Yield the individual data of a data-consuming operator (`Mean`, `Max`, …):
 * a scalar argument contributes itself, a finite collection argument
 * contributes its elements.
 */
export function* flattenArguments(
  args: ReadonlyArray<Expression>
): Generator<Expression> {
  // Go over each argument and yield it if a scalar, otherwise yield its elements
  for (const arg of args) {
    // `Nothing` is an ERASURE marker: a `Nothing` datum is SKIPPED, never
    // folded into a statistic. Collection literals already splice it out at
    // canonicalization, but a lazy source can still yield one, so the skip is
    // made explicit here (the guarantee, not an accident of canonicalization).
    if (isSymbol(arg, 'Nothing')) continue;
    if (arg.isFiniteCollection) {
      for (const x of arg.each()) if (!isSymbol(x, 'Nothing')) yield x;
    } else yield arg;
  }
}

/**
 * `Missing` PROPAGATES through a data-consuming operator (the statistics, and
 * `Max`/`Min`/`Supremum`/`Infimum`): an aggregate over data containing an
 * absent-but-positioned value is itself `Missing` (Julia/R semantics — there
 * is no defensible value to report). Contrast `Nothing`, which is an ERASURE
 * marker and is skipped by `flattenArguments`. `NaN` propagates on its own
 * through the numeric kernels.
 *
 * Returns the `Missing` symbol when any datum is `Missing`, else `undefined`.
 */
export function missingDatum(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  for (const op of flattenArguments(ops))
    if (isSymbol(op, 'Missing')) return ce.Missing;
  return undefined;
}
